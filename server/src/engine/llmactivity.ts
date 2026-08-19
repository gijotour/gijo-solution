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

export function emitLlmActivity(evt: Omit<LlmActivityEvent, "timestamp">): void {
  const full: LlmActivityEvent = { ...evt, timestamp: Date.now() };
  log.push(full);
  if (log.length > HISTORY_LIMIT) log.splice(0, log.length - HISTORY_LIMIT);
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

export function registerLlmActivityRoutes(app: Express): void {
  app.get("/api/llm-activity/history", authMiddleware, (_req, res) => res.json(log.slice(-60)));
}
