// engine/logs.ts — 서버 콘솔 로그 캡처 + 실시간 브로드캐스트
// 이전에는 서버 로그를 보려면 별도 터미널에서 stdout을 tail하는 수밖에 없었다.
// console.log/warn/error를 가로채 링버퍼에 남기고 WebSocket으로 브로드캐스트해서
// (collaboration.ts/finetune.ts/assets.ts와 동일 패턴) 클라이언트 설정 화면에서
// 실시간으로 볼 수 있게 한다. 원래 stdout 출력도 그대로 유지한다.

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { authMiddleware } from "../auth/auth";

export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

const MAX_ENTRIES = 500;
let buffer: LogEntry[] = [];
let wss: WebSocketServer | null = null;

export function attachLogsSocket(server: WebSocketServer): void {
  wss = server;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function recordLog(level: LogEntry["level"], ...args: unknown[]): LogEntry {
  const entry: LogEntry = { level, message: args.map(safeStringify).join(" "), timestamp: Date.now() };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "log:event", payload: entry }));
    }
  });
  return entry;
}

// index.ts에서 부팅 시 1회만 호출한다 — 전역 console.*을 감싸므로 테스트(createApp() 반복 호출)에서는
// 절대 호출하지 않는다. 테스트는 recordLog()를 직접 써서 캡처/브로드캐스트 로직만 검증한다.
let installed = false;
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  (["log", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      recordLog(level, ...args);
    };
  });
}

export function listLogs(): LogEntry[] {
  return buffer;
}

// 테스트 전용: buffer는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetLogsForTests(): void {
  buffer = [];
}

export function registerLogsRoutes(app: Express): void {
  app.get("/api/logs", authMiddleware, (_req, res) => res.json(listLogs()));
}
