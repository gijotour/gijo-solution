// engine/finetune.ts — QLoRA 파인튜닝 파이프라인 (Unsloth 기반, 6.2절 ③단계)
// 진행률은 WebSocket으로 브로드캐스트한다 (finetune:progress).

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { authMiddleware } from "../auth/auth";
import { recordProcessOutput } from "./logs";

export interface FinetuneArgs {
  agentId: string;
  datasetId: string;
  // 학습 베이스 모델(HF repo id). 지정 시 GIJO_FT_BASE_MODEL 환경변수로 스크립트에 전달 —
  // 학습 루프(learnloop.ts)가 설정된 베이스(예: Hermes 3)를 주입하는 경로.
  baseModel?: string;
  // 종료 콜백(성공/실패 공통) — 학습 루프가 다음 단계(GGUF export)로 이어가기 위해 쓴다.
  // 폴링 대신 콜백인 이유: exit/error 어느 쪽으로 끝나든 정확히 한 번 호출된다.
  onComplete?: (result: { ok: boolean; message?: string }) => void;
}

export interface FinetuneProgress {
  step: number;
  maxSteps: number;
  loss: number;
  status: "running" | "done" | "error";
  message?: string;
}

let wss: WebSocketServer | null = null;
export function attachFinetuneSocket(server: WebSocketServer): void {
  wss = server;
}

function broadcastProgress(progress: FinetuneProgress): void {
  wss?.clients.forEach((client) => {
    if (client.readyState === 1) client.send(JSON.stringify({ channel: "finetune:progress", payload: progress }));
  });
}

// GPU 1대(RTX 3090)가 학습을 독점하므로 동시 실행은 막는다.
let running = false;
let lastProgress: FinetuneProgress | null = null;

export function isFinetuneRunning(): boolean {
  return running;
}

export function startFinetune(args: FinetuneArgs): { started: boolean; error?: string } {
  if (running) return { started: false, error: "이미 파인튜닝이 진행 중입니다" };
  if (!args.datasetId) return { started: false, error: "datasetId가 필요합니다" };

  const scriptArgs = ["scripts/finetune_unsloth.py", "--dataset", args.datasetId];
  // 테스트/CI 전용: GPU·unsloth 없이 파이프라인 계약만 검증
  if (process.env.GIJO_FINETUNE_SMOKE === "1") scriptArgs.push("--smoke");

  running = true;
  lastProgress = { step: 0, maxSteps: 0, loss: 0, status: "running" };

  // PYTHONUTF8=1: Windows 기본 콘솔 코드페이지(cp949)로는 한국어 로그가 파이프에서 깨지고
  // em-dash 같은 문자는 UnicodeEncodeError로 스크립트를 죽인다 (modelscan_wrapper와 같은 함정).
  const proc = spawn("python", scriptArgs, {
    env: { ...process.env, PYTHONUTF8: "1", ...(args.baseModel ? { GIJO_FT_BASE_MODEL: args.baseModel } : {}) },
  });
  let stderrTail = "";

  recordProcessOutput("finetune", "log", `$ python ${scriptArgs.join(" ")}`);
  proc.stdout.on("data", (chunk: Buffer) => {
    recordProcessOutput("finetune", "log", chunk.toString());
    for (const line of chunk.toString().split("\n")) {
      const match = /step\s+(\d+)\/(\d+)\s+loss=([\d.]+)/.exec(line);
      if (match) {
        lastProgress = { step: Number(match[1]), maxSteps: Number(match[2]), loss: Number(match[3]), status: "running" };
        broadcastProgress(lastProgress);
      }
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    recordProcessOutput("finetune", "warn", chunk.toString());
  });
  proc.on("error", (err) => {
    // python 자체가 없을 때 등 — exit 이벤트가 안 올 수 있으므로 여기서 종결한다
    running = false;
    lastProgress = { ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }), status: "error", message: String(err.message) };
    broadcastProgress(lastProgress);
    args.onComplete?.({ ok: false, message: String(err.message) });
  });
  proc.on("exit", (code) => {
    if (!running) return; // error 핸들러가 이미 종결한 경우 (onComplete도 거기서 이미 호출됨)
    running = false;
    const message = code === 0 ? undefined : stderrTail.trim().split("\n").pop();
    lastProgress = {
      ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }),
      status: code === 0 ? "done" : "error",
      message,
    };
    broadcastProgress(lastProgress);
    args.onComplete?.({ ok: code === 0, message });
  });

  return { started: true };
}

export function registerFinetuneRoutes(app: Express): void {
  app.post("/api/finetune/start", authMiddleware, (req, res) => {
    const result = startFinetune(req.body);
    if (!result.started) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ started: true });
  });
  app.get("/api/finetune/status", authMiddleware, (_req, res) => {
    res.json({ running, lastProgress });
  });
}
