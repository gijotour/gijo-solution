// engine/worklog.ts — 자동화 작업 원장: "AI가 실제로 대신 처리한 일"을 일어난 그 순간에 기록한다.
// (계획서 중-2 "AI가 아낀 시간" KPI의 밑바닥. 시간 환산은 timesaved.ts가 이 원장 위에서 한다.)
//
// 왜 감사 로그를 쓰지 않았나(실측 2026-07-29): 운영 감사 로그 15,522건 중 auth 7,313·config 5,483이
// 로그인·설정이라 자동화와 무관하고, write 2,660건도 971건이 **내 시험·배포 계정 흔적**이었다
// (claude-deploy의 "작업 세션 삭제" 946건). 그걸 세어 시간으로 환산하면 고객의 절감 숫자가
// 내 테스트로 부풀려진다 — 보안 구매자가 가장 먼저 알아채는 종류의 거짓이다(계획서 전-6 정직 경계).
// 그래서 원장은 ① 자동화가 한 일만 ② 종류를 정해서 ③ 시험 흔적은 처음부터 배제해 담는다.
//
// 담지 않는 것: 사람이 화면에서 직접 한 일(그건 절감이 아니다), 로그인·설정 변경, 평가 게이트·QA 실행.
import type { Express, Request } from "express";
import { db, migrate } from "../db";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";

migrate(
  "work-events-2026-07-29",
  `CREATE TABLE IF NOT EXISTS work_events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,      -- 작업 종류(WORK_KINDS) — 시간 환산의 단위
     detail TEXT,             -- 도구명·대상 등 사람이 확인할 근거 한 줄
     actor TEXT,              -- 지시한 사람(없으면 자동 실행)
     source TEXT NOT NULL     -- chat | schedule | api
   );
   CREATE INDEX IF NOT EXISTS idx_work_events_at ON work_events(at);
   CREATE INDEX IF NOT EXISTS idx_work_events_kind ON work_events(kind);`
);

/**
 * 작업 종류 — 시간 환산의 단위이자 화면에 그대로 보이는 이름.
 * 종류를 잘게 쪼개면 기준시간을 정할 수 없고(근거가 없다), 뭉치면 설명이 안 된다.
 * "담당자가 손으로 하면 한 덩어리로 하는 일"을 기준으로 갈랐다.
 */
export const WORK_KINDS = {
  question_answered: "질문 답변(자료 찾아 정리)",
  status_compiled: "현황 집계(여러 화면 대신 확인)",
  finding_triaged: "취약점 분류·우선순위 판단",
  remediation_guided: "조치 절차 안내",
  report_generated: "보고서 작성",
  hardening_scanned: "보안설정 점검 실행·정리",
  document_ingested: "문서 정리·분류(지식화)",
  action_checked: "규정 대조 판정",
  verification_run: "조치 검증",
} as const;
export type WorkKind = keyof typeof WORK_KINDS;

/**
 * 도구 → 작업 종류. 여기 없는 도구는 **세지 않는다**(0건). 적게 세는 쪽이 정직하다 —
 * 모르는 것을 절감으로 밀어 넣으면 숫자가 부풀고, 부푼 숫자는 한 번만 들켜도 전부를 잃는다.
 *
 * 쓰기 도구(자산 등록·상태 변경·담당 배정 등)는 **일부러 뺐다**: 무엇을 바꿀지는 사람이 결재판에서
 * 판단했고 AI는 입력을 대신했을 뿐이라, 절감으로 세면 사람의 판단 시간을 AI 공으로 돌리게 된다.
 * 화면에도 이 사실을 적는다.
 */
export const TOOL_WORK_KIND: Record<string, WorkKind> = {
  // 현황 집계 — 담당자가 여러 화면을 열어 세던 일
  aibom_status: "status_compiled",
  analysis_status: "status_compiled",
  asset_coverage: "status_compiled",
  compliance_status: "status_compiled",
  finding_status: "status_compiled",
  handover_status: "status_compiled",
  hardening_schedule_list: "status_compiled",
  knowledge_status: "status_compiled",
  kpi_status: "status_compiled",
  maintenance_status: "status_compiled",
  product_status: "status_compiled",
  report_schedule_list: "status_compiled",
  scan_status: "status_compiled",
  system_log_status: "status_compiled",
  work_session_status: "status_compiled",
  list_assets: "status_compiled",
  get_asset: "status_compiled",
  briefing: "status_compiled",
  // 판단·안내
  today: "finding_triaged", // 무엇부터 조치할지 — 사람이 하면 목록을 놓고 따져야 하는 일
  remediation: "remediation_guided",
  // 자료 찾아 답하기
  search: "question_answered",
  explain: "question_answered",
  ontology_query: "question_answered",
  law_lookup: "question_answered",
  threats: "question_answered",
  audit_search: "question_answered",
  // 실행
  run_hardening_scan: "hardening_scanned",
};

export interface WorkEvent {
  id: number;
  at: number;
  kind: WorkKind;
  detail: string | null;
  actor: string | null;
  source: "chat" | "schedule" | "api";
}

const insertStmt = db.prepare(
  "INSERT INTO work_events (at, kind, detail, actor, source) VALUES (?, ?, ?, ?, ?)"
);

/**
 * 작업 1건 기록. 실패해도 제품 동작을 막지 않는다 — 원장은 부가 기록이지 본업이 아니다.
 * qa=true(평가 게이트·회귀 하네스)면 아예 담지 않는다: 시험이 절감 숫자를 만들면 안 된다.
 */
export function recordWork(e: {
  kind: WorkKind;
  detail?: string | null;
  actor?: string | null;
  source?: WorkEvent["source"];
  qa?: boolean;
}): void {
  if (e.qa) return;
  try {
    insertStmt.run(Date.now(), e.kind, e.detail ?? null, e.actor ?? null, e.source ?? "chat");
  } catch {
    /* 기록 실패가 답변을 막지 않는다 */
  }
}

export function listWork(sinceMs: number, limit = 500): WorkEvent[] {
  return db
    .prepare("SELECT * FROM work_events WHERE at >= ? ORDER BY at DESC LIMIT ?")
    .all(sinceMs, Math.min(Math.max(limit, 1), 2000)) as WorkEvent[];
}

/** 기간 내 종류별 건수 — 시간 환산의 입력. */
export function countWorkByKind(sinceMs: number, untilMs = Date.now()): Record<string, number> {
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS n FROM work_events WHERE at >= ? AND at <= ? GROUP BY kind")
    .all(sinceMs, untilMs) as { kind: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = r.n;
  return out;
}

/** 원장이 언제부터 쌓였는지 — "이 기간은 아직 데이터가 없다"를 정직하게 말하기 위해 필요하다. */
export function workLedgerStart(): number | null {
  const row = db.prepare("SELECT MIN(at) AS t FROM work_events").get() as { t: number | null };
  return row?.t ?? null;
}

export function resetWorkForTests(): void {
  db.exec("DELETE FROM work_events");
}

export function registerWorkLogRoutes(app: Express): void {
  // 원장 열람 — 절감 숫자의 근거를 담당자가 직접 확인할 수 있어야 한다(주장만 있고 원장이 없으면 못 믿는다).
  app.get("/api/work-log", authMiddleware, (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    const since = Date.now() - days * 86400000;
    res.json({
      days,
      kinds: WORK_KINDS,
      counts: countWorkByKind(since),
      ledgerStart: workLedgerStart(),
      entries: listWork(since, Number(req.query.limit ?? 200)),
      viewer: (req as Request & { user?: GijoUser }).user?.displayName ?? null,
    });
  });
}
