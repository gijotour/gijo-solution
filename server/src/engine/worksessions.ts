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

import type { Express, Request } from "express";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { onAudit, recordAudit } from "./audit";
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
// 누가 시작한 세션인지 — 여러 담당자가 쓰는데 목록만 보고는 알 수 없었다(2026-07-26 사용자 지적).
migrate("work_sessions-createdBy", "ALTER TABLE work_sessions ADD COLUMN createdBy TEXT");

// status: active(진행중) | done(완료) | ignored(무시). 새 세션은 active로 시작한다.
export type SessionStatus = "active" | "done" | "ignored";
const STATUSES: SessionStatus[] = ["active", "done", "ignored"];
// 화면에서 '작업 세션'을 '작업 내역'으로 바꾸면서 이 기본 제목도 함께 바꿨다(2026-07-28 사용자 지시).
// '세션'은 로그인 세션과도 겹치는 개발자 말이라 담당자에게는 '작업'이 곧다.
const DEFAULT_TITLE = "새 작업";
// 이미 DB에 "새 세션"으로 저장된 건들이 있다. 아래 자동 제목 붙이기가 그것들도 계속
// "제목 없음"으로 보고 첫 지시로 이름을 달아 주도록 옛 이름도 같이 본다.
const UNTITLED = new Set([DEFAULT_TITLE, "새 세션"]);

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
  createdBy?: string;  // 이 세션을 시작한 사람(표시 이름). 자동 생성이면 "시스템".
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
  createdBy: string | null;
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
    createdBy: r.createdBy ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
function rowToTurn(r: TurnRow): SessionTurn {
  return { id: r.id, sessionId: r.sessionId, role: r.role === "assistant" ? "assistant" : "user", content: r.content, tool: r.tool ?? undefined, at: r.at };
}

export function createSession(title?: string, contextRef?: string, createdBy?: string): WorkSession {
  const now = Date.now();
  const s: WorkSession = {
    id: randomUUID(), title: (title && title.trim()) || DEFAULT_TITLE, status: "active",
    contextRef: contextRef || undefined, createdBy: createdBy || undefined, createdAt: now, updatedAt: now,
  };
  db.prepare("INSERT INTO work_sessions (id, title, status, contextRef, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    s.id, s.title, s.status, s.contextRef ?? null, s.createdBy ?? null, s.createdAt, s.updatedAt
  );
  return s;
}

export function getSession(id: string): WorkSession | null {
  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

// 화면에 보여줄 최대 개수. 그보다 오래된 것은 파일로 옮긴다(archiveOldSessions).
// 왜 자르나: 세션은 대화할 때마다 늘어 실제로 824건까지 쌓였다(2026-07-27 실측).
// 목록이 길어지면 찾기만 어려워지고, 담당자가 실제로 되짚는 건 최근 것뿐이다.
// 지우는 게 아니라 **파일로 옮기는** 것이라 나중에 찾아볼 수 있다.
export const SESSION_KEEP = Number(process.env.GIJO_SESSION_KEEP ?? 100);

export function listSessions(limit = SESSION_KEEP): SessionSummary[] {
  const rows = db
    .prepare("SELECT * FROM work_sessions ORDER BY updatedAt DESC LIMIT ?")
    .all(Math.max(1, limit)) as SessionRow[];
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


/**
 * 맥락에 쓸 두 덩이를 **필요한 만큼만** 읽는다 — 끝 N턴 + 그보다 **앞선 사용자 턴** M건.
 *
 * ⚠ 왜 한 번에 안 읽고 두 번 읽나: 요지는 「끝 N턴보다 앞에 있는 **사용자** 턴 12건」이다.
 *   "끝에서 50턴만 읽자" 같은 어림 상한으로 바꾸면, 그 50턴 안에 사용자 턴이 12건보다 적을 때
 *   **요지가 조용히 짧아진다** — 빨라지는 대신 AI가 앞 얘기를 덜 기억하게 되는 셈이고,
 *   그건 성능을 얻자고 기능을 깎는 것이다. 그래서 두 질의로 **결과를 그대로 보존**한다.
 *
 * ⚠ 경계는 **(at, rowid) 짝**으로 가른다 — 어느 한쪽만으로는 옛 방식과 갈린다(2026-08-18 검토 지적):
 *   · `at`(시각)만 보면 — 같은 밀리초에 들어온 턴이 양쪽에 겹치거나 빠진다.
 *   · `rowid`만 보면 — 이 표는 `id TEXT PRIMARY KEY`라 rowid가 암시적이고 **AUTOINCREMENT가 없다.**
 *     SQLite는 그런 표에서 **가장 큰 rowid 행이 지워지면 그 번호를 다시 쓴다.** 방금 끝낸 세션을
 *     지운 뒤 예전 세션을 이어서 쓰면 새 턴이 옛 턴보다 **작은** rowid를 받아, 최신 턴이 양쪽에
 *     중복되거나 옛 사용자 턴이 빠진다.
 *   짝으로 비교하면 옛 방식의 「(at ASC, rowid ASC) 순서에서 몇 번째」와 정확히 같아진다.
 */
export function getContextTurns(id: string, maxTurns: number, olderUserLimit: number): { recent: SessionTurn[]; olderUser: SessionTurn[] } {
  const n = Math.max(0, Math.floor(maxTurns));
  const recentRows = n
    ? (db.prepare("SELECT rowid AS _rid, * FROM work_session_turns WHERE sessionId = ? ORDER BY at DESC, rowid DESC LIMIT ?").all(id, n) as (TurnRow & { _rid: number })[])
    : [];
  recentRows.reverse();
  const m = Math.max(0, Math.floor(olderUserLimit));
  // 끝 N턴 중 **가장 앞선** 것이 경계다. N턴이 0이면 경계가 없으니 전부가 '앞선 턴'이다.
  const 첫 = recentRows.length ? recentRows[0] : null;
  const olderRows = m
    ? (첫
        ? (db
            .prepare(
              // SQLite 행 값 비교 — (at, rowid)를 사전식으로 견준다. 두 열을 따로 비교하는
              // 조건문으로 풀어 쓰면 경계에서 어긋나기 쉬워 한 줄로 둔다.
              "SELECT * FROM work_session_turns WHERE sessionId = ? AND (at, rowid) < (?, ?) AND role = 'user' ORDER BY at DESC, rowid DESC LIMIT ?"
            )
            .all(id, 첫.at, 첫._rid, m) as TurnRow[])
        : (db
            .prepare("SELECT * FROM work_session_turns WHERE sessionId = ? AND role = 'user' ORDER BY at DESC, rowid DESC LIMIT ?")
            .all(id, m) as TurnRow[]))
    : [];
  olderRows.reverse();
  return { recent: recentRows.map(rowToTurn), olderUser: olderRows.map(rowToTurn) };
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
  if (role === "user" && UNTITLED.has(session.title)) {
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

// ── 오래된 세션을 파일로 옮기기 ─────────────────────────────────────────
// 최근 SESSION_KEEP건만 DB에 두고, 그보다 오래된 것은 대화까지 통째로 파일에 적은 뒤 지운다.
// 형식은 JSONL(한 줄에 세션 하나) — 나중에 사람이 열어 읽을 수도, 도구로 다시 읽을 수도 있다.
//
// ⚠ 파일에 다 쓴 것을 **확인한 뒤에만** DB에서 지운다. 순서가 바뀌면 기록이 사라진다.
export function sessionArchiveDir(): string {
  return process.env.GIJO_SESSION_ARCHIVE_DIR ?? path.join("data", "session-archive");
}

export interface ArchiveResult {
  archived: number;
  file: string | null;
  remaining: number;
}

export function archiveOldSessions(keep = SESSION_KEEP): ArchiveResult {
  const { n: total } = db.prepare("SELECT COUNT(*) AS n FROM work_sessions").get() as { n: number };
  if (total <= keep) return { archived: 0, file: null, remaining: total };

  // 최근 keep건을 뺀 나머지(오래된 순으로 골라야 최근 것이 남는다)
  const rows = db
    .prepare("SELECT * FROM work_sessions ORDER BY updatedAt DESC LIMIT -1 OFFSET ?")
    .all(keep) as SessionRow[];
  if (rows.length === 0) return { archived: 0, file: null, remaining: total };

  const dir = sessionArchiveDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `sessions-${stamp}.jsonl`);

  const turnStmt = db.prepare("SELECT * FROM work_session_turns WHERE sessionId = ? ORDER BY at ASC, rowid ASC");
  const lines = rows.map((r) => {
    const turns = (turnStmt.all(r.id) as TurnRow[]).map(rowToTurn);
    return JSON.stringify({ ...rowToSession(r), turns });
  });
  // 먼저 쓰고 디스크에 내려간 것을 확인한 뒤에 지운다.
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
  const written = fs.statSync(file).size;
  if (written <= 0) throw new Error(`세션 보관 파일이 비어 있습니다 — 삭제를 중단합니다 (${file})`);

  const ids = rows.map((r) => r.id);
  const tx = db.transaction(() => {
    for (const id of ids) {
      db.prepare("DELETE FROM work_session_turns WHERE sessionId = ?").run(id);
      db.prepare("DELETE FROM work_sessions WHERE id = ?").run(id);
    }
  });
  tx();
  return { archived: ids.length, file, remaining: total - ids.length };
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
  // ⚠ 예전엔 `getSessionTurns`로 **세션 전체**를 꺼내 놓고 끝 6턴과 그 앞 사용자 12턴만 썼다.
  //   질문 한 번마다 그랬다. 필요한 두 덩이만 DB에서 집어 온다(2026-08-18) — 결과는 동일.
  const { recent, olderUser } = getContextTurns(sessionId, maxTurns, 12);
  if (!recent.length) return "";
  const lines = recent.map((t) => `${t.role === "user" ? "사용자" : "AI"}: ${t.content.replace(/\s+/g, " ").trim().slice(0, 300)}`);

  // ── 오래된 턴 요지(2026-08-09, 중-1 연장 — "긴 세션에서 아까 말한 그 서버를 잊는다") ──
  // 예전엔 최근 6턴 이전을 **통째로 버렸다**. 7턴째부터 담당자가 앞서 말한 자산·결정이
  // 사라져, 대화가 길수록 AI가 바보가 되는 역설이 있었다.
  // LLM 요약이 아니라 **결정적 압축**으로 한다: 7B/14B 요약은 지어냄이 섞일 수 있고
  // (실측: 리포트 요약 서두 메타복창), 요약 오류가 이후 모든 턴에 주입되는 위치라 위험이
  // 배가된다. "사용자가 말한 것의 앞머리"는 지어낼 수 없다.
  //   · 사용자 턴만 싣는다 — 지시·언급된 자산이 담긴 쪽이고, AI 답은 다시 만들 수 있다.
  //   · 오래된 순으로 최대 12턴, 턴당 80자, 전체 1,000자 상한 — 맥락 창을 잠식하지 않게.
  const old = olderUser; // 끝 maxTurns턴보다 앞선 **사용자** 턴 12건(오래된 순) — DB에서 이미 그만큼만 왔다
  if (old.length) {
    const digest: string[] = [];
    let budget = 1000;
    for (const t of old) {
      const line = `· ${t.content.replace(/\s+/g, " ").trim().slice(0, 80)}`;
      if (budget - line.length < 0) break;
      budget -= line.length;
      digest.push(line);
    }
    if (digest.length) {
      return [
        `이전 대화 요지(더 오래된 사용자 지시 ${digest.length}건, 오래된 순):`,
        ...digest,
        "",
        "이전 대화 맥락(같은 세션):",
        ...lines,
      ].join("\n");
    }
  }
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
// 담당자가 한 일이 아니라 시스템이 스스로 남긴 기록은 세션 목록에 넣지 않는다 — 목록이 도배된다.
// (2026-07-26: "오래 걸린 요청을 리포트로 저장"이 세션 목록에 [실행] long_answer_saved로 쌓였다.
//  그 요청 자체는 이미 담당자의 세션으로 남아 있어 같은 일이 두 번 보이는 셈이었다.)
// ⚠ 세션 자체를 손대는 행위는 반드시 제외해야 한다 — 안 그러면 스스로를 먹는 고리가 된다.
//   세션 삭제 → 감사 기록 → 이 훅이 새 세션 생성 → 그것도 지우면 또 새 세션…
//   실제로 목록이 "[실행] 작업 세션 삭제 — [실행] 작업 세션 삭제 — …"로 재귀 제목이 되어 있었고,
//   테스트 세션 2,100건을 지워도 총계가 824건 그대로였다(2026-07-27 정리 중 발견).
//   보관(archive)도 같은 이유로 제외한다.
const SESSION_EXCLUDED_ACTIONS = new Set(["long_answer_saved"]);
// 문자열을 하나씩 나열하면 나중에 행위가 늘 때 빠뜨린다 — 접두사로 통째로 막는다.
// "작업 세션"으로 시작하는 행위(삭제·전체 삭제·정리·보관…)는 세션으로 만들지 않는다.
const SESSION_SELF_ACTION_RE = /^작업\s*세션/;
onAudit((e) => {
  if (e.kind === "auth") return;
  // config = 전 메뉴 사용 기록(activityaudit 미들웨어). 요청마다 하나씩 남으므로 세션으로 옮기면
  // 목록이 도배된다 — 감사 화면에서만 본다(2026-07-26 테스트가 잡아냈다: 세션 27→28).
  if (e.kind === "config") return;
  if (SESSION_EXCLUDED_ACTIONS.has(e.action)) return;
  if (SESSION_SELF_ACTION_RE.test(e.action)) return; // 스스로를 먹는 고리 차단(위 주석 참고)
  try {
    const title = `[${AUDIT_KIND_LABEL[e.kind] ?? e.kind}] ${e.action}${e.target ? " — " + e.target : ""}`.slice(0, 90);
    const s = createSession(title, undefined, e.actor ?? "시스템");
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
    // 보관은 따로 감싼다 — 보관이 실패해도 자동 완료는 계속되어야 한다(그 반대도 마찬가지).
    try {
      const r = archiveOldSessions();
      if (r.archived > 0) console.log(`[worksessions] 오래된 세션 ${r.archived}건을 파일로 옮김 → ${r.file} (남은 ${r.remaining}건)`);
    } catch (e) {
      console.error("[worksessions] 세션 보관 실패(기록은 그대로 남습니다):", e instanceof Error ? e.message : e);
    }
  }, 5 * 60 * 1000);
  timer.unref?.(); // 이 타이머가 프로세스 종료를 막지 않게
}

// ── 세션 종료 리포트 ─────────────────────────────────────────────────
// 세션을 "완료"로 바꾸면 그 대화 전체(지시·응답·도구 태그·시각)를 DOCX로 남긴다.
// report.ts의 이력 관례(파일 + .json 사이드카)를 그대로 따라 리포트 화면 이력에 함께 나타난다.
// LLM 호출 없음 — 결정적(빠르고 실패 없음). 실패해도 상태 변경 자체는 유효해야 하므로 호출부에서 감싼다.
const REPORT_DIR = process.env.GIJO_REPORT_DIR || path.join("data", "reports");
// dayPeriod를 명시하지 않으면 Node 버전에 따라 오전/오후 대신 영어 AM/PM이 나온다(실측:
// 운영 Node 20은 AM/PM, Node 24는 오전/오후 — ICU/CLDR 버전 차이). 명시해서 버전 무관하게 고정.
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", dayPeriod: "short" });

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
    const who = (req as Request & { user?: GijoUser }).user?.displayName ?? undefined;
    res.json(createSession(title, contextRef, who));
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
  // 오래된 세션을 지금 바로 파일로 옮긴다(평소엔 5분 스위프가 알아서 한다).
  // keep을 주면 그만큼만 남긴다 — 기본은 SESSION_KEEP(100).
  app.post("/api/work-sessions/archive", authMiddleware, (req, res) => {
    try {
      const keep = Number(req.body?.keep);
      res.json(archiveOldSessions(Number.isFinite(keep) && keep >= 1 ? keep : SESSION_KEEP));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.delete("/api/work-sessions/:id", authMiddleware, (req, res) => {
    // 지우기 전에 제목을 확보한다 — 지운 뒤에는 무엇이 사라졌는지 알 수 없다.
    const before = getSession(req.params.id);
    const ok = deleteSession(req.params.id);
    if (ok) recordAudit({ kind: "write", action: "작업 세션 삭제", target: before?.title ?? req.params.id,
      detail: before?.createdBy ? `담당 ${before.createdBy}` : undefined, actor: (req as Request & { user?: GijoUser }).user?.displayName ?? null });
    res.json({ ok });
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
