// engine/localengine.ts — 로컬 LLM 엔진(llama-server) 프로세스 관리
// 서버가 GPU(RTX 3090)가 있는 머신에서 실행되며, 이 프로세스를 단독 소유한다.

import type { Express } from "express";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

let serverProcess: ChildProcess | null = null;
let currentModelId: string | null = null;

export interface LocalEngineStatus {
  running: boolean;
  port: number;
  modelId: string | null;
}

export async function startLocalEngine(modelId: string): Promise<LocalEngineStatus> {
  if (serverProcess) return { running: true, port: 8080, modelId: currentModelId };

  const modelPath = path.join("models", modelId, `${modelId}.gguf`);
  serverProcess = spawn(
    path.join("llama.cpp", "build", "bin", "Release", "llama-server.exe"),
    ["-m", modelPath, "-ngl", "-1", "--ctx-size", "32768", "--port", "8080"],
    { stdio: "pipe" }
  );
  currentModelId = modelId;
  serverProcess.on("exit", () => {
    serverProcess = null;
    currentModelId = null;
  });
  return { running: true, port: 8080, modelId };
}

export function stopLocalEngine(): void {
  serverProcess?.kill();
  serverProcess = null;
  currentModelId = null;
}

export function registerLocalEngineRoutes(app: Express): void {
  app.get("/api/localengine/status", authMiddleware, (_req, res) => {
    res.json({ running: !!serverProcess, port: 8080, modelId: currentModelId } as LocalEngineStatus);
  });
  app.post(
    "/api/localengine/start",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await startLocalEngine(req.body.modelId));
    })
  );
  app.post("/api/localengine/stop", authMiddleware, (_req, res) => {
    stopLocalEngine();
    res.json({ ok: true });
  });
}
