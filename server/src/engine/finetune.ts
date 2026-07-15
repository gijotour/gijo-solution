// engine/finetune.ts — QLoRA 파인튜닝 파이프라인 (Unsloth 기반, 6.2절 ③단계)
// 진행률은 WebSocket으로 브로드캐스트한다 (finetune:progress).

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { authMiddleware } from "../auth/auth";

export interface FinetuneArgs {
  agentId: string;
  datasetId: string;
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
  const proc = spawn("python", scriptArgs, { env: { ...process.env, PYTHONUTF8: "1" } });
  let stderrTail = "";

  proc.stdout.on("data", (chunk: Buffer) => {
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
    console.error(`[finetune] ${chunk.toString().trimEnd()}`);
  });
  proc.on("error", (err) => {
    // python 자체가 없을 때 등 — exit 이벤트가 안 올 수 있으므로 여기서 종결한다
    running = false;
    lastProgress = { ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }), status: "error", message: String(err.message) };
    broadcastProgress(lastProgress);
  });
  proc.on("exit", (code) => {
    if (!running) return; // error 핸들러가 이미 종결한 경우
    running = false;
    lastProgress = {
      ...(lastProgress ?? { step: 0, maxSteps: 0, loss: 0 }),
      status: code === 0 ? "done" : "error",
      message: code === 0 ? undefined : stderrTail.trim().split("\n").pop(),
    };
    broadcastProgress(lastProgress);
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
