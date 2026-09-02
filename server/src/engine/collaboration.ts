// engine/collaboration.ts — 에이전트 간 협업 로그 + 실시간 브로드캐스트
// Electron 단일앱 시절엔 win.webContents.send()로 직접 UI에 밀어넣었지만,
// CS 구조에서는 여러 클라이언트가 동시에 붙어있으므로 WebSocket 브로드캐스트로 대체한다.

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { authMiddleware } from "../auth/auth";

export interface CollaborationEvent {
  from: string;
  to: string;
  message: string;
  timestamp: number;
}

// 인메모리 링버퍼 — 상한이 없으면 장시간 구동 시 무한히 쌓인다(llmactivity.ts와 같은 방식으로 상한).
// history 라우트가 최근 100개만 돌려주므로 그보다 넉넉히 잡아 근래 이력을 보존한다.
const MAX_EVENTS = 500;
const log: CollaborationEvent[] = [];
let wss: WebSocketServer | null = null;

export function attachCollaborationSocket(server: WebSocketServer): void {
  wss = server;
}

export function emitCollaboration(evt: Omit<CollaborationEvent, "timestamp">): void {
  const full: CollaborationEvent = { ...evt, timestamp: Date.now() };
  log.push(full);
  if (log.length > MAX_EVENTS) log.splice(0, log.length - MAX_EVENTS);
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "collaboration:event", payload: full }));
    }
  });
}

// 테스트 전용: log는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
/** 최근 협업 말풍선(메모리 기록) — 시험·진단용 읽기. 재시작하면 비는 것이 정직한 한계. */
export function collaborationHistory(limit = 100): CollaborationEvent[] {
  return log.slice(-Math.max(1, limit));
}

export function resetCollaborationForTests(): void {
  log.length = 0;
}

export function registerCollaborationRoutes(app: Express): void {
  app.get("/api/collaboration/history", authMiddleware, (_req, res) => res.json(log.slice(-100)));
}
