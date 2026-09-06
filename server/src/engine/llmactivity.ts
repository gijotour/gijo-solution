// engine/llmactivity.ts — 로컬 LLM 실동작 실시간 스트림
// chat()/embed()가 실제로 llama-server를 호출할 때마다, 그리고 모델을 로드/스왑할 때마다
// 실측 데이터(모델 이름·토큰 수·생성 속도·지연)를 llm:event 채널로 브로드캐스트한다.
// agent.html "실시간 협업 현황" / "터미널"에서 라이브로 보인다.
//
// 목적: LLM이 진짜 로드돼서 돌고 있음을 눈으로 확인하는 것. 여기 실리는 promptTokens/
// completionTokens/tokensPerSec는 llama.cpp가 응답에 실어 주는 usage·timings 실측치라
// 장식이 아니다 — 값이 움직이면 실제로 추론이 일어난 것이다.

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { authMiddleware } from "../auth/auth";
import { db } from "../db";
import { todayLocal } from "../util/date";

export interface LlmActivityEvent {
  // search=RAG 조회(hybridSearch — 4개 검색 경로 공용 지점) · guard=입구 검사(gateway.gateUserInput)
  // — 2026-08-20 AI 팀 가시화(레일 로스터 깜박임의 실신호. 값이 움직이면 실제로 일어난 것).
  // cite=근거 없는 인용을 출구에서 뗀 일(llm.ts guardCitations, 2026-09-05). 답 하나에 한 번만
  //   실리므로 calls는 **뗀 답의 수**이고, 뗀 건수는 detail 한 줄에 있다(집계 칸을 안 늘려도 된다).
  // ⚠ 새 kind는 **뒤에 붙인다** — wiringcontract.test가 `"search" | "guard"` 연접을 글자로 본다.
  kind: "chat" | "embed" | "load" | "swap" | "search" | "guard" | "cite";
  phase: "start" | "done" | "error";
  // ⚠ agent는 **에이전트 id**다(orchestrator·scan…) — 일 집계(llm_activity_daily)와 감독
  //   카드가 id로 매칭한다. 표시명을 넣으면 지표가 영원히 0이 된다(검토관 2026-08-20 상1 —
  //   표시명은 사용자가 바꿀 수 있어 집계 키로도 못 쓴다). 사람 눈용은 agentName에.
  agent?: string;
  agentName?: string; // 표시용 이름(레일·사무실 창) — 집계에는 안 쓴다
  model?: string; // 모델 파일 basename (또는 임베딩 모델)
  detail?: string; // 사람이 읽는 한 줄
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSec?: number; // 생성 속도 — llama.cpp timings.predicted_per_second 실측치
  latencyMs?: number;
  // ✂ 사유별 건수(2026-09-06 · 승인 시안 mockups/cite-reasons) — kind="cite"에서만 쓴다.
  // ⚠ calls(답 개수)와 **다른 잣대**다: 답 하나에서 세 군데를 떼면 여기 합은 3, calls는 1이다.
  //   세는 곳은 citeguard.사유별집계() 하나 — 부르는 쪽이 그 결과를 그대로 넘긴다.
  // ⚠ 인용 원문은 안 싣는다(사내 문서 본문이 감독 화면·WS로 새면 안 된다). 개수만이다.
  citeReasons?: Record<string, number>;
  timestamp: number;
}

const HISTORY_LIMIT = 200;
const log: LlmActivityEvent[] = [];
let wss: WebSocketServer | null = null;

export function attachLlmActivitySocket(server: WebSocketServer): void {
  wss = server;
}

const dailyUpsert = db.prepare(`
  INSERT INTO llm_activity_daily (day, agent, kind, calls, errors, latencyMsSum) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(day, agent, kind) DO UPDATE SET
    calls = calls + excluded.calls, errors = errors + excluded.errors,
    latencyMsSum = latencyMsSum + excluded.latencyMsSum
`);

const citeReasonUpsert = db.prepare(`
  INSERT INTO cite_reason_daily (day, agent, reason, count) VALUES (?, ?, ?, ?)
  ON CONFLICT(day, agent, reason) DO UPDATE SET count = count + excluded.count
`);

/**
 * 답 하나의 집계를 **한 트랜잭션**으로 쓴다 — 답 개수(llm_activity_daily)와 사유 건수
 * (cite_reason_daily)가 반쪽만 남는 자리를 없앤다. 반쪽이 남으면 화면이 「답 3개인데 사유 0건」
 * 처럼 **말이 안 되는 두 숫자**를 사람에게 보여 준다(이 저장소의 「절반 수리」 계열).
 */
const 집계쓰기 = db.transaction((day: string, agent: string, kind: string,
  calls: number, errors: number, latency: number, reasons: Record<string, number> | undefined) => {
  dailyUpsert.run(day, agent, kind, calls, errors, latency);
  if (reasons) {
    for (const [reason, count] of Object.entries(reasons)) {
      if (!(count > 0)) continue; // 0건 사유는 안 쌓는다 — 표에 「겹침없음 0」 줄이 늘어날 뿐이다
      citeReasonUpsert.run(day, agent, reason, count);
    }
  }
});

export function emitLlmActivity(evt: Omit<LlmActivityEvent, "timestamp">): void {
  const full: LlmActivityEvent = { ...evt, timestamp: Date.now() };
  log.push(full);
  if (log.length > HISTORY_LIMIT) log.splice(0, log.length - HISTORY_LIMIT);
  // 감독용 일 단위 영속 집계(2026-08-20 ②) — start는 안 세고 done/error만(이중 셈 방지).
  if (full.phase !== "start") {
    try {
      집계쓰기(todayLocal(), full.agent || "-", full.kind,
        full.phase === "done" ? 1 : 0, full.phase === "error" ? 1 : 0,
        full.phase === "done" && full.latencyMs ? Math.round(full.latencyMs) : 0,
        full.citeReasons);
    } catch { /* 집계는 부가 기능 — 방송 자체를 막지 않는다 */ }
  }
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "llm:event", payload: full }));
    }
  });
}

// llama-server가 돌려주는 모델 경로(models\qwythos-9b\qwythos-9b.gguf)에서 표시용 이름만 뽑는다.
export function modelBasename(m?: string): string {
  if (!m) return "로컬 LLM";
  const last = m.split(/[\\/]/).pop() ?? m;
  return last.replace(/\.gguf$/i, "");
}

export function resetLlmActivityForTests(): void {
  log.length = 0;
}

/** 감독 집계 — 최근 N일의 에이전트×종류 합(오늘 포함). 숫자는 전부 실측 이벤트의 합. */
export function activityDaily(days: number): { day: string; agent: string; kind: string; calls: number; errors: number; latencyMsSum: number }[] {
  const from = todayLocal(new Date(Date.now() - Math.max(0, days - 1) * 86400000)); // 로컬(KST) 달력 — UTC면 0~9시에 하루 밀린다(중6)
  return db.prepare("SELECT day, agent, kind, calls, errors, latencyMsSum FROM llm_activity_daily WHERE day >= ? ORDER BY day")
    .all(from) as { day: string; agent: string; kind: string; calls: number; errors: number; latencyMsSum: number }[];
}

/**
 * ✂ 사유 집계 — 최근 N일의 에이전트×사유 합(오늘 포함). 숫자는 전부 실측 이벤트의 합.
 * ⚠ 날짜 계산은 `activityDaily`와 **같은 것**을 쓴다(todayLocal 로컬 달력) — UTC로 재면
 *   0~9시에 하루가 밀려 **답 개수와 사유가 다른 날을 가리킨다**.
 */
export function citeReasonsDaily(days: number): { day: string; agent: string; reason: string; count: number }[] {
  const from = todayLocal(new Date(Date.now() - Math.max(0, days - 1) * 86400000));
  return db.prepare("SELECT day, agent, reason, count FROM cite_reason_daily WHERE day >= ? ORDER BY day")
    .all(from) as { day: string; agent: string; reason: string; count: number }[];
}

/** 에이전트별 대화 호출 수 — llm_activity_daily(kind=chat)에서. chat_logs로 세지 않는다:
 *  그건 학습 자동수집 스위치·noLearn 계정에 좌우되어 「수집 끄면 전 팀원 0」이 되고(검토관
 *  중7 — 규칙 계산인 척 잘못된 결론), 기록 키도 라우팅 id라 실제 일한 전문가가 0으로 남는다. */
export function chatCallsByAgent(days: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of activityDaily(days)) {
    if (d.kind === "chat") out[d.agent] = (out[d.agent] || 0) + d.calls;
  }
  return out;
}

export function registerLlmActivityRoutes(app: Express): void {
  app.get("/api/llm-activity/history", authMiddleware, (_req, res) => res.json(log.slice(-60)));
  // AI 팀 감독(2026-08-20 ②) — 기간별 에이전트 일지표. 원천은 llm_activity_daily 하나
  // (도입일부터 축적 — 호출·응답·오류 전부. 원천이 하나라 숫자가 서로 어긋날 길이 없다).
  app.get("/api/aiteam/supervision", authMiddleware, (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 1));
    // 최근 오류 1줄(에이전트별) — 인메모리 최근 200건에서. 재시작하면 비는 것이 정직한 한계
    // (메시지 원문은 집계 테이블에 안 남긴다 — 개수는 daily가 영속으로 담당).
    const recentErrors: Record<string, { detail: string; timestamp: number }> = {};
    for (const e of log) {
      if (e.phase === "error" && e.agent) recentErrors[e.agent] = { detail: e.detail || "(내용 없음)", timestamp: e.timestamp };
    }
    // ✂ 사유별 건수(2026-09-06) — **새 창구를 만들지 않는다**. 감독 화면은 지금도 이 한 API만
    //   부르므로 칸을 여기 더한다. daily(답 개수)와 다른 잣대라 칸을 갈라 둔다(섞으면 거짓).
    res.json({ days, calls: chatCallsByAgent(days), daily: activityDaily(days), recentErrors, citeReasons: citeReasonsDaily(days) });
  });
}
