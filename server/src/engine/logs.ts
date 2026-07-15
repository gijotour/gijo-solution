// engine/logs.ts — 서버 콘솔 로그 + 실행 명령 stdout/stderr 캡처 + 실시간 브로드캐스트
// 이전에는 서버 로그를 보려면 별도 터미널에서 stdout을 tail하는 수밖에 없었다.
// console.log/warn/error를 가로채고(source="console"), 서버가 spawn/execFile로 실제 실행한
// 자식 프로세스(modelscan, finetune, huggingface-cli 등)의 출력도 캡처해(source=명령 이름)
// 하나의 링버퍼에 남기고 WebSocket(log:event)으로 브로드캐스트한다. 클라이언트 "로그" 화면에서
// source별로 구분해 실시간으로 본다. 원래 stdout 출력도 그대로 유지한다.

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import type { ChildProcess } from "child_process";
import { authMiddleware } from "../auth/auth";

export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
  source: string; // "console" | 실행 명령 이름(modelscan/finetune/hf-download 등)
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

function push(entry: LogEntry): LogEntry {
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "log:event", payload: entry }));
    }
  });
  return entry;
}

export function recordLog(level: LogEntry["level"], ...args: unknown[]): LogEntry {
  return push({ level, message: args.map(safeStringify).join(" "), timestamp: Date.now(), source: "console" });
}

// 자식 프로세스 출력 한 덩어리(여러 줄일 수 있음)를 라인 단위로 기록한다.
export function recordProcessOutput(source: string, level: LogEntry["level"], chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    push({ level, message: line, timestamp: Date.now(), source });
  }
}

// spawn/execFile로 띄운 자식 프로세스의 stdout/stderr를 로그 스트림에 연결한다.
// stdout은 log, stderr는 warn으로 (에러가 아닌 진행 로그도 stderr로 나오는 도구가 많으므로).
export function attachProcessLogging(proc: ChildProcess, source: string): void {
  proc.stdout?.on("data", (buf: Buffer) => recordProcessOutput(source, "log", buf.toString()));
  proc.stderr?.on("data", (buf: Buffer) => recordProcessOutput(source, "warn", buf.toString()));
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
