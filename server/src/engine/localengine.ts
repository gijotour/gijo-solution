// engine/localengine.ts — 로컬 LLM 엔진(llama-server) 프로세스 관리
// 서버가 GPU(RTX 3090)가 있는 머신에서 실행되며, 이 프로세스를 단독 소유한다.
//
// 모델 스왑: RTX 3090 24GB로는 대형 모델 여러 개를 동시에 올릴 수 없으므로,
// startLocalEngine()에 요청된 modelId가 현재 떠 있는 모델과 다르면 기존 프로세스를
// graceful shutdown 한 뒤 새로 띄운다 — server-java-reference의
// LocalEngineService.java와 동일한 스왑 방식.

import type { Express } from "express";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

const LLAMA_SERVER_PATH =
  process.env.GIJO_LLAMA_SERVER_PATH ??
  path.join("llama.cpp", "build", "bin", "Release", "llama-server.exe");
const MODELS_DIR = process.env.GIJO_MODELS_DIR ?? "models";
const PORT = Number(process.env.GIJO_LOCAL_LLM_PORT ?? 8080);
const DEFAULT_CTX_SIZE = Number(process.env.GIJO_LOCAL_LLM_CTX_SIZE ?? 32768);
// Java 참고 구현(LocalEngineService)과 동일하게 10초까지 정상 종료를 기다린 뒤 강제 종료한다.
const STOP_TIMEOUT_MS = Number(process.env.GIJO_LOCAL_LLM_STOP_TIMEOUT_MS ?? 10000);

let serverProcess: ChildProcess | null = null;
let currentModelId: string | null = null;

export interface LocalEngineStatus {
  running: boolean;
  port: number;
  modelId: string | null;
}

export function getLocalEngineStatus(): LocalEngineStatus {
  return { running: !!serverProcess, port: PORT, modelId: currentModelId };
}

export async function startLocalEngine(modelId: string): Promise<LocalEngineStatus> {
  if (serverProcess) {
    if (modelId === currentModelId) {
      return { running: true, port: PORT, modelId: currentModelId };
    }
    console.log(`[localengine] swapping local LLM: ${currentModelId} -> ${modelId}`);
    await stopLocalEngine();
  }

  const modelPath = path.join(MODELS_DIR, modelId, `${modelId}.gguf`);
  const spawned = spawn(
    LLAMA_SERVER_PATH,
    ["-m", modelPath, "-ngl", "-1", "--ctx-size", String(DEFAULT_CTX_SIZE), "--port", String(PORT)],
    { stdio: "pipe" }
  );
  serverProcess = spawned;
  currentModelId = modelId;

  spawned.on("exit", () => {
    if (serverProcess === spawned) {
      serverProcess = null;
      currentModelId = null;
    }
  });
  spawned.on("error", (err) => {
    console.error(`[localengine] llama-server 기동 실패 (model=${modelId}):`, err);
    if (serverProcess === spawned) {
      serverProcess = null;
      currentModelId = null;
    }
  });

  return { running: true, port: PORT, modelId };
}

// graceful shutdown: 먼저 정상 종료 신호를 보내고, STOP_TIMEOUT_MS 안에 죽지 않으면 강제 종료한다.
export async function stopLocalEngine(): Promise<void> {
  const proc = serverProcess;
  if (!proc) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const forceKillTimer = setTimeout(() => {
      if (!settled) proc.kill("SIGKILL");
    }, STOP_TIMEOUT_MS);

    proc.once("exit", () => {
      settled = true;
      clearTimeout(forceKillTimer);
      resolve();
    });
    proc.kill();
  });

  if (serverProcess === proc) {
    serverProcess = null;
    currentModelId = null;
  }
}

export function registerLocalEngineRoutes(app: Express): void {
  app.get("/api/localengine/status", authMiddleware, (_req, res) => {
    res.json(getLocalEngineStatus());
  });
  app.post(
    "/api/localengine/start",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await startLocalEngine(req.body.modelId));
    })
  );
  app.post(
    "/api/localengine/stop",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      await stopLocalEngine();
      res.json({ ok: true });
    })
  );
}
