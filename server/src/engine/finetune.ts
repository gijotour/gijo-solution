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

export function startFinetune(args: FinetuneArgs): void {
  const proc = spawn("python", ["scripts/finetune_unsloth.py", "--dataset", args.datasetId]);
  proc.stdout.on("data", (chunk: Buffer) => {
    const match = /step\s+(\d+)\/(\d+)\s+loss=([\d.]+)/.exec(chunk.toString());
    if (match) {
      broadcastProgress({ step: Number(match[1]), maxSteps: Number(match[2]), loss: Number(match[3]) });
    }
  });
}

export function registerFinetuneRoutes(app: Express): void {
  app.post("/api/finetune/start", authMiddleware, (req, res) => {
    startFinetune(req.body);
    res.json({ started: true });
  });
}
