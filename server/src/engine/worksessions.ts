// engine/worksessions.ts — 작업 세션(대화 세션형)
//
// 오케스트레이터에게 내린 지시와 그 응답을 하나의 "세션"(대화 스레드)으로 묶어 영속 저장한다.
// ChatGPT 히스토리처럼 과거 대화를 목록에서 훑고·검색하고·이어서 지시할 수 있게 하는 것이 목적.
//
// 기존 "대화 맥락"(agentloop.ts의 전역 lastTarget)은 1인 운영 전제의 휘발성 단일 슬롯이라
// 재시작하면 사라지고 "지난 주에 뭘 물어봤지"를 되짚을 수 없었다. 이 모듈은 그 대화를
// (세션, 턴) 2단 테이블로 디스크에 남겨 조회 가능한 업무 이력으로 승격한다.
//
// dispatcher가 sessionId와 함께 지시를 받으면: ① 지시를 user 턴으로, ② 응답을 assistant 턴으로
// 여기 기록하고, ③ recentTurnsText로 직전 턴들을 모델 맥락에 실어 "이어서" 지시가 되게 한다.

import type { Express } from "express";
import { randomUUID } from "crypto";
import * as fsp from "fs/promises";
import * as path from "path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { onAudit } from "./audit";
import { db } from "../db";
import { migrate } from "../db";

migrate(
  "work_sessions-2026-07",
  `CREATE TABLE IF NOT EXISTS work_sessions (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     status TEXT NOT NULL,
     createdAt INTEGER NOT NULL,
     updatedAt INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS work_session_turns (
     id TEXT PRIMARY KEY,
     sessionId TEXT NOT NULL REFERENCES work_sessions(id),
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     tool TEXT,
     at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_work_session_turns_sessionId ON work_session_turns(sessionId);`
);

// contextRef: 이 세션이 탐색기의 어떤 대상에서 열렸는지("asset:chatbot-01" / "vuln:호스트|키" /
// "product:id" / "today"). 세션을 다시 열 때 그 대상의 상태 카드·추천 다음 단계를 재구성하는 데 쓴다.
// 별도 마이그레이션으로 추가해 기존 work_sessions 테이블에도 적용되게 한다(원 마이그레이션은 불변).
migrate("work_sessions-contextRef", "ALTER TABLE work_sessions ADD COLUMN contextRef TEXT");

// doneBy: 이 세션이 "완료(done)"가 된 경위 — "user"(사람이 명시적으로 완료) / "auto"(30분 무대화
// 자동 완료·감사 단발행위 등 시스템 완료) / null(아직 완료 아님). 사용자 완료와 자동 완료를 화면에서
// 구분해 표시하기 위함(2026-07-20 요청). done이 아닌 상태로 되돌리면 null로 지운다.
migrate("work_sessions-doneBy", "ALTER TABLE work_sessions ADD COLUMN doneBy TEXT");

// status: active(진행중) | done(완료) | ignored(무시). 새 세션은 active로 시작한다.
export type SessionStatus = "active" | "done" | "ignored";
const STATUSES: SessionStatus[] = ["active", "done", "ignored"];
const DEFAULT_TITLE = "새 세션";

export interface SessionTurn {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tool?: string; // 응답에 쓰인 도구/경로 태그(예: today, 결재판, 3단계) — 화면 배지용
  at: number;
}

// 완료 경위 — 사용자 완료와 자동 완료(30분 무대화 등)를 구분한다.
export type DoneBy = "user" | "auto";

export interface WorkSession {
  id: string;
  title: string;
  status: SessionStatus;
  doneBy?: DoneBy; // status가 done일 때만 채워짐(user/auto). 그 외엔 undefined.
  contextRef?: string; // 탐색기 대상 참조(asset:.. / vuln:.. / product:.. / today). 없으면 일반 세션.
  createdAt: number;
  updatedAt: number;
}

// 목록 표시용 — 마지막 턴 미리보기·턴 수를 함께 실어 한 번의 조회로 카드를 그린다.
export interface SessionSummary extends WorkSession {
  turnCount: number;
  lastPreview: string;
  lastRole: "user" | "assistant" | null;
}

interface SessionRow {
  id: string;
  title: string;
  status: string;
  doneBy: string | null;
  contextRef: string | null;
  createdAt: number;
  updatedAt: number;
}
interface TurnRow {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  tool: string | null;
  at: number;
}

function rowToSession(r: SessionRow): WorkSession {
  const status = (STATUSES.includes(r.status as SessionStatus) ? r.status : "active") as SessionStatus;
  return {
    id: r.id,
    title: r.title,
    status,
    doneBy: status === "done" && (r.doneBy === "user" || r.doneBy === "auto") ? r.doneBy : undefined,
    contextRef: r.contextRef ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
function rowToTurn(r: TurnRow): SessionTurn {
  return { id: r.id, sessionId: r.sessionId, role: r.role === "assistant" ? "assistant" : "user", content: r.content, tool: r.tool ?? undefined, at: r.at };
}

export function createSession(title?: string, contextRef?: string): WorkSession {
  const now = Date.now();
  const s: WorkSession = { id: randomUUID(), title: (title && title.trim()) || DEFAULT_TITLE, status: "active", contextRef: contextRef || undefined, createdAt: now, updatedAt: now };
  db.prepare("INSERT INTO work_sessions (id, title, status, contextRef, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(
    s.id, s.title, s.status, s.contextRef ?? null, s.createdAt, s.updatedAt
  );
  return s;
}

export function getSession(id: string): WorkSession | null {
  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessions(): SessionSummary[] {
  const rows = db.prepare("SELECT * FROM work_sessions ORDER BY updatedAt DESC").all() as SessionRow[];
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM work_session_turns WHERE sessionId = ?");
  const lastStmt = db.prepare("SELECT role, content FROM work_session_turns WHERE sessionId = ? ORDER BY at DESC, rowid DESC LIMIT 1");
  return rows.map((r) => {
    const { n } = countStmt.get(r.id) as { n: number };
    const last = lastStmt.get(r.id) as { role: string; content: string } | undefined;
    return {
      ...rowToSession(r),
      turnCount: n,
      lastPreview: last ? last.content.slice(0, 80) : "",
      lastRole: last ? (last.role === "assistant" ? "assistant" : "user") : null,
    };
  });
}

export function getSessionTurns(id: string): SessionTurn[] {
  const rows = db.prepare("SELECT * FROM work_session_turns WHERE sessionId = ? ORDER BY at ASC, rowid ASC").all(id) as TurnRow[];
  return rows.map(rowToTurn);
}

// 첫 user 턴이 들어올 때 세션 제목이 아직 기본값이면 그 지시문 앞부분으로 제목을 자동 지정한다
// (ChatGPT가 첫 질문으로 대화 이름을 짓는 것과 같은 UX). 이후엔 사용자가 rename하지 않는 한 유지.
function autoTitleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40) + "…" : t || DEFAULT_TITLE;
}

export function appendTurn(sessionId: string, role: "user" | "assistant", content: string, tool?: string): SessionTurn | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const turn: SessionTurn = { id: randomUUID(), sessionId, role, content, tool, at: Date.now() };
  db.prepare("INSERT INTO work_session_turns (id, sessionId, role, content, tool, at) VALUES (?, ?, ?, ?, ?, ?)").run(
    turn.id, turn.sessionId, turn.role, turn.content, turn.tool ?? null, turn.at
  );
  // 첫 user 턴이면 자동 제목. (제목이 기본값이고 아직 user 턴이 없던 경우에만)
  let title = session.title;
  if (role === "user" && session.title === DEFAULT_TITLE) {
    const priorUser = db.prepare("SELECT COUNT(*) AS n FROM work_session_turns WHERE sessionId = ? AND role = 'user'").get(sessionId) as { n: number };
    if (priorUser.n <= 1) title = autoTitleFrom(content);
  }
  db.prepare("UPDATE work_sessions SET updatedAt = ?, title = ? WHERE id = ?").run(turn.at, title, sessionId);
  return turn;
}

export function renameSession(id: string, title: string): WorkSession | null {
  const s = getSession(id);
  if (!s) return null;
  const nt = (title && title.trim()) || DEFAULT_TITLE;
  db.prepare("UPDATE work_sessions SET title = ?, updatedAt = ? WHERE id = ?").run(nt, Date.now(), id);
  return getSession(id);
}

// doneBy: status를 done으로 바꿀 때 그 경위를 함께 저장한다(기본 "user"). done이 아니면 doneBy는 지운다.
export function setSessionStatus(id: string, status: SessionStatus, doneBy: DoneBy = "user"): WorkSession | null {
  if (!STATUSES.includes(status)) return null;
  const s = getSession(id);
  if (!s) return null;
  const by = status === "done" ? doneBy : null;
  db.prepare("UPDATE work_sessions SET status = ?, doneBy = ?, updatedAt = ? WHERE id = ?").run(status, by, Date.now(), id);
  return getSession(id);
}

export function deleteSession(id: string): boolean {
  const s = getSession(id);
  if (!s) return false;
  db.prepare("DELETE FROM work_session_turns WHERE sessionId = ?").run(id);
  db.prepare("DELETE FROM work_sessions WHERE id = ?").run(id);
  return true;
}

// N일 동안 손대지 않은(updatedAt 기준) 세션을 일괄 삭제한다.
export function pruneSessions(olderThanDays: number): number {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    throw new Error("olderThanDays는 1 이상이어야 합니다");
  }
  const cutoff = Date.now() - olderThanDays * 86400000;
  const ids = (db.prepare("SELECT id FROM work_sessions WHERE updatedAt < ?").all(cutoff) as { id: string }[]).map((r) => r.id);
  const tx = db.transaction(() => {
    for (const id of ids) {
      db.prepare("DELETE FROM work_session_turns WHERE sessionId = ?").run(id);
      db.prepare("DELETE FROM work_sessions WHERE id = ?").run(id);
    }
  });
  tx();
  return ids.length;
}

// 전체 세션 삭제(대화 포함).
export function deleteAllSessions(): number {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM work_sessions").get() as { n: number };
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM work_session_turns").run();
    db.prepare("DELETE FROM work_sessions").run();
  });
  tx();
  return n;
}

// 모델에 실을 직전 대화 맥락 — 최근 N턴을 "역할: 내용" 줄로 압축한다. 너무 길면 프롬프트가
// 폭주하므로 턴 수·각 턴 길이에 상한을 둔다. 세션이 없거나 턴이 없으면 빈 문자열(맥락 없음).
export function recentTurnsText(sessionId: string, maxTurns = 6): string {
  const turns = getSessionTurns(sessionId);
  if (!turns.length) return "";
  const recent = turns.slice(-maxTurns);
  const lines = recent.map((t) => `${t.role === "user" ? "사용자" : "AI"}: ${t.content.replace(/\s+/g, " ").trim().slice(0, 300)}`);
  return ["이전 대화 맥락(같은 세션):", ...lines].join("\n");
}

// ── 모든 행위 → 작업 세션 자동 기록(사용자 요청 2026-07-20) ────────────
// 감사 로그에 남는 행위(하드닝 점검·승인 실행·CLI·설정 변경 등)를 작업 세션 목록에도 1건씩 남긴다.
// auth(로그인/로그아웃)는 제외 — 세션 목록이 접속 기록으로 도배되는 것을 막는다(접속은 사무실 창 presence·감사에서).
// 단발 행위는 즉시 "완료"로 저장한다. setSessionStatus 직접 호출은 DOCX 리포트를 만들지 않으므로
// (리포트는 PATCH 라우트 전용) 행위마다 리포트가 쏟아지는 일은 없다.
const AUDIT_KIND_LABEL: Record<string, string> = {
  cli: "CLI", approval: "승인", write: "실행", block: "차단", config: "설정",
};
onAudit((e) => {
  if (e.kind === "auth") return;
  try {
    const title = `[${AUDIT_KIND_LABEL[e.kind] ?? e.kind}] ${e.action}${e.target ? " — " + e.target : ""}`.slice(0, 90);
    const s = createSession(title);
    // 주체: scheduler(자동 점검)는 AI 팀(assistant), 그 외(담당자 행위)는 나(user)로 — 목록의 "주체" 표기용.
    const role = e.actor === "scheduler" ? "assistant" : "user";
    const body = (e.detail || e.action) + (e.result !== "ok" ? ` (결과: ${e.result})` : "");
    appendTurn(s.id, role, body, e.actor ?? undefined);
    if (e.result !== "pending") setSessionStatus(s.id, "done", "auto"); // 단발 행위 = 시스템 자동 완료
  } catch { /* 세션 반영 실패가 본 작업·감사 기록을 막지 않게 */ }
});

// ── 30분 무대화 세션 자동 완료(2026-07-20 요청) ───────────────────────────
// 대화형 세션은 "언제 끝났는지"를 시스템이 알 수 없어 진행중(active)으로 남는다. 마지막 갱신(updatedAt)이
// IDLE_MS 이상 지났고 대화가 하나라도 있는 active 세션을 자동 완료한다(doneBy="auto"). 빈 세션(턴 0)은
// 건드리지 않는다(버려진 껍데기 — prune 대상). updatedAt은 그대로 둬 "언제까지 대화했는지"를 보존한다.
// 자동 완료는 DOCX 리포트를 만들지 않는다 — 리포트는 사용자가 의도적으로 완료(PATCH)할 때만.
export const SESSION_AUTO_DONE_IDLE_MS = Number(process.env.GIJO_SESSION_AUTO_DONE_MS ?? 30 * 60 * 1000);
export function autoCompleteIdleSessions(idleMs = SESSION_AUTO_DONE_IDLE_MS): number {
  const cutoff = Date.now() - idleMs;
  const rows = db
    .prepare(
      `SELECT s.id FROM work_sessions s
       WHERE s.status = 'active' AND s.updatedAt < ?
         AND EXISTS (SELECT 1 FROM work_session_turns t WHERE t.sessionId = s.id)`
    )
    .all(cutoff) as { id: string }[];
  if (!rows.length) return 0;
  // updatedAt을 건드리지 않고 상태만 바꾼다(마지막 대화 시각 보존, 목록 정렬도 유지).
  const upd = db.prepare("UPDATE work_sessions SET status = 'done', doneBy = 'auto' WHERE id = ?");
  const tx = db.transaction((ids: string[]) => { for (const id of ids) upd.run(id); });
  tx(rows.map((r) => r.id));
  return rows.length;
}

// 서버 상주 시 주기 스위프(5분마다). 테스트 환경(:memory:)에서는 타이머를 걸지 않는다.
if (process.env.GIJO_DB_PATH !== ":memory:" && process.env.NODE_ENV !== "test") {
  const timer = setInterval(() => {
    try {
      const n = autoCompleteIdleSessions();
      if (n > 0) console.log(`[worksessions] 30분 무대화 세션 ${n}건 자동 완료`);
    } catch (e) {
      console.error("[worksessions] 자동 완료 스위프 실패:", e instanceof Error ? e.message : e);
    }
  }, 5 * 60 * 1000);
  timer.unref?.(); // 이 타이머가 프로세스 종료를 막지 않게
}

// ── 세션 종료 리포트 ─────────────────────────────────────────────────
// 세션을 "완료"로 바꾸면 그 대화 전체(지시·응답·도구 태그·시각)를 DOCX로 남긴다.
// report.ts의 이력 관례(파일 + .json 사이드카)를 그대로 따라 리포트 화면 이력에 함께 나타난다.
// LLM 호출 없음 — 결정적(빠르고 실패 없음). 실패해도 상태 변경 자체는 유효해야 하므로 호출부에서 감싼다.
const REPORT_DIR = path.join("data", "reports");
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export async function generateSessionReport(sessionId: string): Promise<{ base: string; docx: string } | null> {
  const s = getSession(sessionId);
  if (!s) return null;
  const turns = getSessionTurns(sessionId);
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`작업 세션 리포트 — ${s.title}`)] }),
    new Paragraph({
      children: [new TextRun({
        text: `기간 ${fmtTime(s.createdAt)} ~ ${fmtTime(s.updatedAt)} · 대화 ${turns.length}턴` + (s.contextRef ? ` · 대상 ${s.contextRef}` : ""),
        color: "666666",
      })],
    }),
    new Paragraph({ children: [] }),
  ];
  if (!turns.length) {
    children.push(new Paragraph({ children: [new TextRun("기록된 대화가 없습니다.")] }));
  }
  for (const t of turns) {
    const who = t.role === "user" ? "나" : `AI 팀${t.tool ? ` (${t.tool})` : ""}`;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun(`[${fmtTime(t.at)}] ${who}`)],
    }));
    // 턴 내용 — 줄 단위 문단, 폭주 방지로 턴당 4000자 컷
    for (const line of t.content.slice(0, 4000).split(/\r?\n/)) {
      children.push(new Paragraph({ children: [new TextRun(line || " ")] }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  await fsp.mkdir(REPORT_DIR, { recursive: true });
  const base = `session-${Date.now()}`;
  await fsp.writeFile(path.join(REPORT_DIR, `${base}.docx`), buffer);
  const firstUser = turns.find((t) => t.role === "user");
  const meta = {
    base,
    type: "session",
    audience: "internal",
    assetIds: [] as string[],
    assetNames: [s.title],
    createdAt: Date.now(),
    docx: `${base}.docx`,
    summary: `세션 "${s.title}" 종료 리포트 · ${turns.length}턴` + (firstUser ? ` · 첫 지시: ${firstUser.content.slice(0, 120)}` : ""),
  };
  await fsp.writeFile(path.join(REPORT_DIR, `${base}.json`), JSON.stringify(meta, null, 2), "utf-8");
  return { base, docx: `${base}.docx` };
}

export function registerWorkSessionRoutes(app: Express): void {
  app.get("/api/work-sessions", authMiddleware, (_req, res) => {
    res.json(listSessions());
  });

  app.post("/api/work-sessions", authMiddleware, (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    const contextRef = typeof req.body?.contextRef === "string" ? req.body.contextRef : undefined;
    res.json(createSession(title, contextRef));
  });

  app.get("/api/work-sessions/:id", authMiddleware, (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "세션을 찾을 수 없습니다" });
    res.json({ session, turns: getSessionTurns(req.params.id) });
  });

  // 제목·상태 부분 수정. 상태가 "완료"로 바뀌는 순간 세션 리포트(DOCX)를 자동 생성한다.
  app.patch("/api/work-sessions/:id", authMiddleware, asyncRoute(async (req, res) => {
    const id = req.params.id;
    let session = getSession(id);
    if (!session) return res.status(404).json({ error: "세션을 찾을 수 없습니다" });
    const wasDone = session.status === "done";
    if (typeof req.body?.title === "string") session = renameSession(id, req.body.title) ?? session;
    if (typeof req.body?.status === "string") {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: "허용되지 않은 상태" });
      session = setSessionStatus(id, req.body.status, "user") ?? session; // 화면에서 온 완료 = 사용자 완료
    }
    let report: { base: string; docx: string } | null = null;
    if (!wasDone && session.status === "done") {
      try {
        report = await generateSessionReport(id);
      } catch {
        /* 리포트 생성 실패해도 상태 변경은 유효 — 리포트 화면에서 수동 재생성 가능 */
      }
    }
    res.json(report ? { ...session, report } : session);
  }));

  // 일괄 정리 — /:id보다 먼저 등록해 'prune'·'delete-all'이 id로 안 잡히게 한다.
  app.post("/api/work-sessions/prune", authMiddleware, (req, res) => {
    try {
      res.json({ deleted: pruneSessions(Number(req.body?.olderThanDays)) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.post("/api/work-sessions/delete-all", authMiddleware, (_req, res) => {
    res.json({ deleted: deleteAllSessions() });
  });

  app.delete("/api/work-sessions/:id", authMiddleware, (req, res) => {
    res.json({ ok: deleteSession(req.params.id) });
  });

  // 세션에 턴을 직접 추가(주로 dispatcher가 서버 내부에서 호출하지만, 화면에서 메모성 턴을 남길 여지).
  app.post(
    "/api/work-sessions/:id/turns",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const role = req.body?.role === "assistant" ? "assistant" : "user";
      const content = String(req.body?.content ?? "");
      const tool = typeof req.body?.tool === "string" ? req.body.tool : undefined;
      const turn = appendTurn(req.params.id, role, content, tool);
      if (!turn) return res.status(404).json({ error: "세션을 찾을 수 없습니다" });
      res.json(turn);
    })
  );
}
