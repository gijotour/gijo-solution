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

export interface LlmActivityEvent {
  // search=RAG 조회(hybridSearch — 4개 검색 경로 공용 지점) · guard=입구 검사(gateway.gateUserInput)
  // — 2026-08-20 AI 팀 가시화(레일 로스터 깜박임의 실신호. 값이 움직이면 실제로 일어난 것).
  kind: "chat" | "embed" | "load" | "swap" | "search" | "guard";
  phase: "start" | "done" | "error";
  agent?: string; // 표시용 에이전트 이름
  model?: string; // 모델 파일 basename (또는 임베딩 모델)
  detail?: string; // 사람이 읽는 한 줄
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSec?: number; // 생성 속도 — llama.cpp timings.predicted_per_second 실측치
  latencyMs?: number;
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

export function emitLlmActivity(evt: Omit<LlmActivityEvent, "timestamp">): void {
  const full: LlmActivityEvent = { ...evt, timestamp: Date.now() };
  log.push(full);
  if (log.length > HISTORY_LIMIT) log.splice(0, log.length - HISTORY_LIMIT);
  // 감독용 일 단위 영속 집계(2026-08-20 ②) — start는 안 세고 done/error만(이중 셈 방지).
  if (full.phase !== "start") {
    try {
      dailyUpsert.run(new Date().toISOString().slice(0, 10), full.agent || "-", full.kind,
        full.phase === "done" ? 1 : 0, full.phase === "error" ? 1 : 0,
        full.phase === "done" && full.latencyMs ? Math.round(full.latencyMs) : 0);
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
  const from = new Date(Date.now() - Math.max(0, days - 1) * 86400000).toISOString().slice(0, 10);
  return db.prepare("SELECT day, agent, kind, calls, errors, latencyMsSum FROM llm_activity_daily WHERE day >= ? ORDER BY day")
    .all(from) as { day: string; agent: string; kind: string; calls: number; errors: number; latencyMsSum: number }[];
}

/** 에이전트별 대화 호출 수(chat_logs — 영속이라 과거 기간도 즉시 가능). */
export function chatCallsByAgent(days: number): Record<string, number> {
  const from = Date.now() - Math.max(1, days) * 86400000;
  const rows = db.prepare("SELECT agentId, COUNT(*) AS n FROM chat_logs WHERE createdAt >= ? GROUP BY agentId")
    .all(from) as { agentId: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.agentId] = r.n;
  return out;
}

export function registerLlmActivityRoutes(app: Express): void {
  app.get("/api/llm-activity/history", authMiddleware, (_req, res) => res.json(log.slice(-60)));
  // AI 팀 감독(2026-08-20 ②) — 기간별 에이전트 일지표. 숫자는 chat_logs(호출)와
  // llm_activity_daily(응답·오류 — 도입일부터 축적) 두 실측 원천뿐이다.
  app.get("/api/aiteam/supervision", authMiddleware, (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 1));
    // 최근 오류 1줄(에이전트별) — 인메모리 최근 200건에서. 재시작하면 비는 것이 정직한 한계
    // (메시지 원문은 집계 테이블에 안 남긴다 — 개수는 daily가 영속으로 담당).
    const recentErrors: Record<string, { detail: string; timestamp: number }> = {};
    for (const e of log) {
      if (e.phase === "error" && e.agent) recentErrors[e.agent] = { detail: e.detail || "(내용 없음)", timestamp: e.timestamp };
    }
    res.json({ days, calls: chatCallsByAgent(days), daily: activityDaily(days), recentErrors });
  });
}
