// engine/handover.ts — 퇴사자 인수인계 자동 검증 (Knowledge Transfer Verify)
//
// 담당자가 노하우 문서를 RAG에 올린 뒤 "AI가 정말 이 문서로 답하는가"를 기계가 확인한다:
//   문서 조각 샘플 → LLM이 그 문서로만 답할 수 있는 실무 질문 1개 생성 → 실제 디스패치
//   → 응답의 근거 문서(sources — dispatcher.computeOfferSignals가 채움)에 해당 문서가 오르는지 판정.
// 회귀 하네스(tools/regress)와 같은 "생성-실행-대조" 메커니즘이고, sources 인프라(근거 배지)를 재사용한다.
// 결과 리포트는 퇴사 절차의 감사 증적(무엇을 이관했고 검증 통과율 몇 %)으로 쓸 수 있다.

import type { Express, Request } from "express";
import { db } from "../db";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";

// ── 이관 이력 (해자 슬라이스 2, 2026-08-06) ─────────────────────────────────
// 실태(설계문서): 검증 결과가 담당자 PC(localStorage)에만 남고 **서버는 알지 못했다** —
// 퇴사자가 떠나면 "무엇을 이관했고 그게 실제로 작동했나"가 통째로 사라졌다.
// 이제 검증 한 회차를 배치로 묶어 서버에 남긴다. 이것이 조직에 쌓이는 자산(해자)이다.
//
// ★ 개인정보 경계 — 남길 것과 안 남길 것을 먼저 정했다:
//   남긴다: 문서 이름 · 자동 생성 질문 · 인용 여부 · 근거 문서 이름 3개까지 · 이관자 표시이름
//           (증적의 최소 단위 — 무엇을, 언제, 누가, 통했나)
//   안 남긴다: **답변 본문(answerPreview)** · 근거 전체 목록.
//           답변에는 사내 문서 내용이 그대로 실린다. 증적에 필요한 것은 "통했다/아니다"이지
//           그때 무슨 말이 오갔는지가 아니다 — 남기면 나중에 열람 통제 대상이 늘기만 한다.
db.exec(`CREATE TABLE IF NOT EXISTS handover_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batchId TEXT NOT NULL,        -- 검증 한 회차(같은 실행이면 같은 값)
  verifiedAt TEXT NOT NULL,
  documentId TEXT NOT NULL,
  question TEXT,                -- 자동 생성 질문(사람 발화가 아니다)
  cited INTEGER NOT NULL,       -- 1이면 그 문서가 답변 근거로 올랐다 = 이관 성공
  sourceNames TEXT,             -- 실제 근거 문서 **이름**(최대 3, JSON 배열) — 본문은 저장하지 않는다
                                --   ⚠ 이름이다, ID가 아니다(2026-09-06 수리). 아래 insert 주석 참고.
                                --   ⚠ 예전에는 「쉼표로 이어 붙인 한 칸」이었다. 담기는 값이 쉼표를
                                --     못 쓰던 내부 ID에서 **쉼표를 쓸 수 있는 사람 제목**으로 바뀌자
                                --     항목 경계가 사라졌다(「보안 서약서, 처리 절차」가 둘로 읽힌다).
                                --     → JSON 배열로 남긴다. 읽기는 근거이름읽기() 한 곳에서만 한다
                                --       (옛 행은 쉼표 꼴이라 그 함수가 함께 받아 준다).
  actor TEXT,                   -- 이관자 표시이름
  completedAt TEXT              -- 인수인계 완료 처리 시각(마감 전에는 NULL)
)`);
const insertHistoryStmt = db.prepare(
  `INSERT INTO handover_history (batchId, verifiedAt, documentId, question, cited, sourceNames, actor)
   VALUES (@batchId, @verifiedAt, @documentId, @question, @cited, @sourceNames, @actor)`
);

/**
 * 저장된 「근거 문서 이름」 칸을 **읽는 단 한 곳**.
 *
 * ★ 왜 함수인가: 새 행은 JSON 배열이고 옛 행은 쉼표로 이어 붙인 한 칸이다(2026-09-06 이전).
 *   읽는 자리마다 각자 가르면 한쪽만 고쳐져 어긋난다 — 이 저장소가 가장 자주 밟은 자리다.
 * ⚠ 옛 행에는 **내부 ID**가 들어 있을 수 있다(B1 수리 이전에 쌓인 것). 지어내서 이름처럼
 *   꾸미지 않고 **있는 그대로** 돌려준다 — 증적은 꾸미는 것이 아니라 보이는 것이다.
 */
export function 근거이름읽기(raw: string | null | undefined): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
    } catch { /* 깨진 값은 아래 옛 꼴로 한 번 더 본다 */ }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export interface HandoverHistoryBatch {
  batchId: string; verifiedAt: string; actor: string | null;
  total: number; cited: number; passRate: number; completedAt: string | null; documents: string[];
  /**
   * 그 회차에서 **실제로 답변 근거로 오른 문서 이름**(중복 없이 5개까지).
   *
   * ★ 2026-09-06 수리 — 이 칸은 표에 쌓이기만 하고 **읽는 경로가 0이었다**(SELECT에 없었다).
   *   증적을 남겨 놓고 꺼낼 길이 없으면 안 남긴 것과 같다. 감사·내보내기가 쓰는 창구는
   *   `/api/handover/history` 하나뿐이라, 그 창구가 이 칸을 함께 돌려준다.
   * ⚠ 챗봇 답(runHandoverStatus)에는 **일부러 안 싣는다** — 그 답은 등급으로 걸러진 문서만
   *   보여 주는데(listVisibleDocuments), 이력의 이름은 그 체를 안 거친다. 실으면 열람 등급이
   *   없는 사람에게 문서 제목이 새는 길이 생긴다(직접-열람 등급 누출 수리와 같은 계보).
   */
  sourceNames: string[];
}

/** 회차별로 묶어 돌려준다 — 목록은 "언제 누가 몇 건을 넘겼고 몇 %가 통했나"가 보여야 쓸모 있다. */
export function listHandoverHistory(limit = 20): HandoverHistoryBatch[] {
  const rows = db.prepare(
    `SELECT batchId, verifiedAt, actor, documentId, cited, sourceNames, completedAt FROM handover_history
      ORDER BY id DESC LIMIT ?`
  ).all(Math.max(1, Math.min(500, limit * 10))) as {
    batchId: string; verifiedAt: string; actor: string | null; documentId: string; cited: number;
    sourceNames: string | null; completedAt: string | null;
  }[];
  const byBatch = new Map<string, HandoverHistoryBatch>();
  for (const r of rows) {
    let b = byBatch.get(r.batchId);
    if (!b) {
      b = { batchId: r.batchId, verifiedAt: r.verifiedAt, actor: r.actor, total: 0, cited: 0, passRate: 0, completedAt: r.completedAt, documents: [], sourceNames: [] };
      byBatch.set(r.batchId, b);
    }
    b.total += 1;
    b.cited += r.cited ? 1 : 0;
    if (b.documents.length < 5) b.documents.push(r.documentId);
    // 같은 문서가 여러 물음의 근거로 오르므로 **중복을 빼고** 5개까지만 — 목록을 통째로 쌓지 않는다.
    for (const 이름 of 근거이름읽기(r.sourceNames)) {
      if (b.sourceNames.length >= 5) break;
      if (!b.sourceNames.includes(이름)) b.sourceNames.push(이름);
    }
    if (r.completedAt && !b.completedAt) b.completedAt = r.completedAt;
  }
  const out = [...byBatch.values()].map((b) => ({ ...b, passRate: b.total ? Math.round((b.cited / b.total) * 100) : 0 }));
  return out.slice(0, limit);
}

/** 완료 처리 — 그 회차 줄들에 완료 시각을 찍는다(어느 검증이 실제 인계로 이어졌나). */
export function markHandoverCompleted(batchId: string): number {
  return db.prepare(`UPDATE handover_history SET completedAt = ? WHERE batchId = ? AND completedAt IS NULL`)
    .run(new Date().toISOString(), batchId).changes;
}

export interface HandoverCheck {
  documentId: string;
  question: string; // 자동 생성된 검증 질문
  cited: boolean; // 답변 근거에 이 문서가 올랐는가 = 이관 성공
  sources: string[]; // 실제로 오른 근거 문서 **ID** — 판정(cited)이 쓰는 기계용 키다
  /**
   * 그 근거 문서들의 **사람이 읽는 제목** — sources와 같은 순서(dispatcher.sourceTitles 계약).
   * ⚠ 빈 문자열은 「제목 생략」이다 — ID를 대신 싣지 않는다(memory.사람이읽는문서제목 규율).
   * ⚠ 옛 경로·시험 흉내처럼 제목이 아예 안 오면 빈 배열이다 — 그때는 증적에 이름을 안 남긴다.
   */
  sourceTitles: string[];
  answerPreview: string;
  error?: string;
}

export interface HandoverReport {
  batchId: string; // 이 검증 회차의 식별자 — 완료 처리 때 이 회차를 마감한다
  total: number;
  cited: number;
  passRate: number; // 0~100
  results: HandoverCheck[];
}

// 의존성 주입 — 테스트가 실 LLM·DB 없이 판정 로직을 검증할 수 있게 한다.
export interface HandoverDeps {
  sampleOf: (documentId: string) => Promise<string | null>;
  genQuestion: (sample: string) => Promise<string>;
  // ⚠ sourceTitles는 **사람에게 보여 줄 이름**이다(dispatcher가 sources와 같은 순서로 채운다).
  //   증적에 남길 이름은 이 칸에서만 온다 — sources(내부 ID)를 이름 자리에 쓰지 않는다.
  ask: (question: string) => Promise<{ output: string; sources?: string[]; sourceTitles?: string[] }>;
}

async function defaultDeps(): Promise<HandoverDeps> {
  const { getDocumentSample } = await import("./memory.js");
  const { chat } = await import("./llm.js");
  const { dispatchInstruction } = await import("./dispatcher.js");
  return {
    sampleOf: (id) => getDocumentSample(id),
    genQuestion: async (sample) =>
      chat({
        agentId: "analysis",
        message: [
          "아래는 사내 인수인계 문서의 일부다. 이 문서 내용으로만 답할 수 있는 실무 질문 1개를 한국어 한 문장으로 만들어라.",
          "질문 문장만 출력하고 다른 말은 붙이지 마라.",
          "",
          "[문서]",
          sample.slice(0, 1500),
        ].join("\n"),
        trusted: true,
        maxTokens: 120,
      }),
    ask: async (q) => {
      // qa:true — 기계가 만든 검증 질문이다. 작업 세션·협업 피드·학습 수집에 남기지 않는다.
      // (예전엔 무표식이라 검증 1회마다 작업 세션이 생기고, 수집을 출구로 옮긴 2026-08-07부터는
      //  기계 문답이 학습 후보함까지 오염시킬 뻔했다. 답 경로 자체는 실사용과 동일하다.)
      const r = await dispatchInstruction(q, undefined, undefined, "인수인계-자동검증", true);
      return { output: r.output, sources: r.sources, sourceTitles: r.sourceTitles };
    },
  };
}

const MAX_DOCS = 10; // 한 번에 검증할 문서 상한 — 문서당 LLM 2회(질문 생성+디스패치)라 배치를 제한한다

export async function verifyHandover(
  documentIds: string[],
  deps?: HandoverDeps,
  meta?: { actor?: string | null; record?: boolean }
): Promise<HandoverReport> {
  const d = deps ?? (await defaultDeps());
  const results: HandoverCheck[] = [];
  for (const documentId of documentIds.slice(0, MAX_DOCS)) {
    try {
      const sample = await d.sampleOf(documentId);
      if (!sample) {
        results.push({ documentId, question: "", cited: false, sources: [], sourceTitles: [], answerPreview: "", error: "문서 조각이 검색되지 않았습니다(인입 여부 확인)" });
        continue;
      }
      // 질문 생성 실패(LLM 다운 등)면 문서명 기반 폴백 질문 — 검증 자체는 계속한다.
      let question = "";
      try {
        question = (await d.genQuestion(sample)).trim().split("\n")[0].replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 200);
      } catch {
        /* 폴백으로 */
      }
      if (!question) question = `${documentId.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")} 관련 절차를 알려줘`;
      const a = await d.ask(question);
      const sources = a.sources ?? [];
      // ⚠ 판정(cited)은 **ID**로 한다 — 제목으로 바꾸면 인수인계 검증 그 자체가 죽는다
      //   (dispatcher.sourceTitles 머리글이 이 자리를 이름으로 지목해 둔 이유다).
      results.push({
        documentId, question, cited: sources.includes(documentId), sources,
        sourceTitles: a.sourceTitles ?? [],
        answerPreview: (a.output ?? "").slice(0, 200),
      });
    } catch (err) {
      results.push({ documentId, question: "", cited: false, sources: [], sourceTitles: [], answerPreview: "", error: err instanceof Error ? err.message : String(err) });
    }
  }
  const cited = results.filter((r) => r.cited).length;
  const batchId = `hv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  // 이력 저장 — 시험이 부를 때는 남기지 않는다(record:false). 저장 실패가 검증 결과를 되돌리지 않는다.
  if (meta?.record !== false && results.length) {
    const verifiedAt = new Date().toISOString();
    try {
      for (const r of results) {
        insertHistoryStmt.run({
          batchId, verifiedAt, documentId: r.documentId,
          question: (r.question || "").slice(0, 300),
          cited: r.cited ? 1 : 0,
          // 근거 문서 **이름만** 3개까지 — 답변 본문(answerPreview)은 일부러 안 남긴다(위 경계 참고).
          //
          // ★ 2026-09-06 수리 — 여기 들어가던 것은 이름이 아니라 **내부 ID**였다(B1).
          //   칸 이름도 주석도 「근거 문서 이름」이라고 약속했는데 `r.sources`(「승인문답:dtmtl5b1fzj215l3」
          //   꼴)를 그대로 넣고 있었다. 이 줄은 퇴사 절차의 **감사 증적**이라 나중에 사람이 읽는다 —
          //   그 사람에게 아무것도 안 가리키는 키가 「근거 문서 이름」으로 남아 있었다.
          //   같은 날 배지·협업 피드에서 고친 것(dispatcher.sourceTitles)과 **같은 사고의 남은 자리**다.
          // ⚠ 빈 제목은 뺀다 — 제목을 못 구한 문서는 이름 없이 세지, ID로 채우지 않는다.
          //   그 결과 셋 다 제목이 없으면 이 칸은 null이다(「이름을 모른다」가 정직한 상태다).
          // ⚠ 2026-09-06 2차 — **쉼표로 잇지 않는다.** 이 칸에 담기는 값이 쉼표를 못 쓰던 내부
          //   ID에서 쉼표를 쓸 수 있는 **사람 제목**으로 바뀐 순간, 「보안 서약서, 처리 절차」 같은
          //   제목 하나가 둘로 읽히게 됐다(B1 수리가 데려온 짝 결함). JSON 배열로 남긴다.
          sourceNames: (() => {
            const 이름들 = r.sourceTitles.map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, 3);
            return 이름들.length ? JSON.stringify(이름들) : null;
          })(),
          actor: meta?.actor ?? null,
        });
      }
    } catch (e) {
      console.warn(`[handover] 이관 이력 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { batchId, total: results.length, cited, passRate: results.length ? Math.round((cited / results.length) * 100) : 0, results };
}

export function registerHandoverRoutes(app: Express): void {
  // 인수인계 자동 검증 — 올린 문서들이 실제로 답변 근거로 인용되는지 일괄 확인.
  app.post(
    "/api/handover/verify",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.documentIds)
        ? (req.body.documentIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      if (ids.length === 0) {
        res.status(400).json({ error: "documentIds(검증할 문서 ID 배열)가 필요합니다" });
        return;
      }
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      res.json(await verifyHandover(ids, undefined, { actor }));
    })
  );

  // 인수인계 완료 처리 — 이관자·문서 목록·검증 통과율을 감사 로그(작업 기록)에 증적으로 남긴다.
  app.post(
    "/api/handover/complete",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.documentIds)
        ? (req.body.documentIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const cited = Number(req.body?.cited ?? 0);
      const total = Number(req.body?.total ?? ids.length);
      const passRate = Number(req.body?.passRate ?? 0);
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      // 이 검증 회차를 마감한다 — 어느 검증이 실제 인계로 이어졌는지가 증적의 핵심이다.
      // batchId가 없으면(구버전 클라) 이력은 열린 채로 남고 감사 기록만 남는다 — 조용히 실패하지 않게 표시.
      const batchId = typeof req.body?.batchId === "string" ? req.body.batchId : "";
      const marked = batchId ? markHandoverCompleted(batchId) : 0;
      recordAudit({
        kind: "write",
        actor,
        action: "인수인계 완료",
        target: null,
        detail: `문서 ${total}건 이관 · 검증 인용 ${cited}/${total} (${passRate}%) — ${ids.slice(0, 10).join(", ")}${ids.length > 10 ? " 외" : ""}`,
        result: "ok",
      });
      res.json({ ok: true, marked, historyRecorded: marked > 0 });
    })
  );

  // 이관 이력 조회 — 서버가 들고 있는 증적(해자 슬라이스 2).
  app.get(
    "/api/handover/history",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
      res.json(listHandoverHistory(limit));
    })
  );
}
