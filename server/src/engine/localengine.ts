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
import * as fs from "fs";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import { emitLlmActivity, modelBasename } from "./llmactivity";

const LLAMA_SERVER_PATH =
  process.env.GIJO_LLAMA_SERVER_PATH ??
  path.join("llama.cpp", "build", "bin", "Release", "llama-server.exe");
const MODELS_DIR = process.env.GIJO_MODELS_DIR ?? "models";
const PORT = Number(process.env.GIJO_LOCAL_LLM_PORT ?? 8080);
const DEFAULT_CTX_SIZE = Number(process.env.GIJO_LOCAL_LLM_CTX_SIZE ?? 32768);
// Java 참고 구현(LocalEngineService)과 동일하게 10초까지 정상 종료를 기다린 뒤 강제 종료한다.
const STOP_TIMEOUT_MS = Number(process.env.GIJO_LOCAL_LLM_STOP_TIMEOUT_MS ?? 10000);

// 제품 확정 모델 (다음단계 가이드 3.3, 2026-07-15). 최초 기동처럼 "마지막 사용 모델" 기록이
// 없을 때의 자동 시작 후보다.
const DEFAULT_MODEL_ID = process.env.GIJO_DEFAULT_MODEL_ID ?? "lily-cybersecurity-7b-v0.2";

// RAG 임베딩용 별도 llama-server (llm.ts의 EMBEDDING_SERVER_URL과 짝). 채팅 모델과 달리
// 스왑 개념이 없어 부팅 시 1회 자동 기동만 관리한다.
const EMBEDDING_MODEL_ID = process.env.GIJO_EMBEDDING_MODEL_ID ?? "bge-m3";
const EMBEDDING_PORT = Number(process.env.GIJO_EMBEDDING_PORT ?? 8081);

let serverProcess: ChildProcess | null = null;
let currentModelId: string | null = null;
let embeddingProcess: ChildProcess | null = null;
let embeddingModelId: string | null = null;

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

export interface LocalEngineStatus {
  running: boolean;
  port: number;
  modelId: string | null;
  embedding: { running: boolean; port: number; modelId: string | null };
}

export function getLocalEngineStatus(): LocalEngineStatus {
  return {
    running: !!serverProcess,
    port: PORT,
    modelId: currentModelId,
    embedding: { running: !!embeddingProcess, port: EMBEDDING_PORT, modelId: embeddingModelId },
  };
}

function modelFilePath(modelId: string): string {
  return path.join(MODELS_DIR, modelId, `${modelId}.gguf`);
}

// models/ 아래 실제로 배치된 채팅 모델 목록 (models/<id>/<id>.gguf 패턴). 임베딩 모델은
// 채팅용이 아니므로 제외한다. 에이전트 모델 할당 드롭다운·검증의 단일 진실 소스.
export function listAvailableModels(): { id: string; running: boolean }[] {
  if (!fs.existsSync(MODELS_DIR)) return [];
  return fs
    .readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== EMBEDDING_MODEL_ID && fs.existsSync(modelFilePath(d.name)))
    .map((d) => ({ id: d.name, running: d.name === currentModelId }));
}

export function isModelAvailable(modelId: string): boolean {
  return fs.existsSync(modelFilePath(modelId));
}

// 부팅 자동 시작 후보: 마지막 사용 모델 → 제품 기본 모델 순으로, 실제 .gguf가 있는 첫 번째.
// 없으면 null (자동 시작 안 함 — 파일도 없는데 spawn 에러를 내지 않는다).
export function pickAutoStartModelId(): string | null {
  const last = (getStateStmt.get("lastModelId") as { value: string } | undefined)?.value;
  for (const candidate of [last, DEFAULT_MODEL_ID]) {
    if (candidate && fs.existsSync(modelFilePath(candidate))) return candidate;
  }
  return null;
}

export async function startLocalEngine(modelId: string): Promise<LocalEngineStatus> {
  if (serverProcess) {
    if (modelId === currentModelId) {
      return getLocalEngineStatus();
    }
    console.log(`[localengine] swapping local LLM: ${currentModelId} -> ${modelId}`);
    emitLlmActivity({
      kind: "swap",
      phase: "start",
      model: modelBasename(modelId),
      detail: `모델 교체: ${modelBasename(currentModelId ?? "")} → ${modelBasename(modelId)}`,
    });
    await stopLocalEngine();
  }

  const modelPath = modelFilePath(modelId);
  const spawned = spawn(
    LLAMA_SERVER_PATH,
    ["-m", modelPath, "-ngl", "-1", "--ctx-size", String(DEFAULT_CTX_SIZE), "--port", String(PORT)],
    { stdio: "pipe" }
  );
  serverProcess = spawned;
  currentModelId = modelId;
  setStateStmt.run("lastModelId", modelId);
  emitLlmActivity({ kind: "load", phase: "start", model: modelBasename(modelId), detail: "모델 로드 중 (llama-server 기동)" });

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

  return getLocalEngineStatus();
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

// ── 부팅 자동 시작 (index.ts에서 1회 호출) ──────────────────────────────────
// createApp()에서 부르지 않는다 — 테스트가 실제 llama-server를 스폰하면 안 되므로
// 부트스트랩(index.ts) 전용이다.
export async function autoStartLocalEngines(): Promise<void> {
  const chatModelId = pickAutoStartModelId();
  if (chatModelId) {
    console.log(`[localengine] 부팅 자동 시작: ${chatModelId} (마지막 사용 모델 또는 기본 모델)`);
    await startLocalEngine(chatModelId);
  } else {
    console.log(
      `[localengine] 자동 시작 건너뜀 — ${MODELS_DIR}/ 에 모델 파일 없음 (기본: ${DEFAULT_MODEL_ID}). 에이전트 AI 화면에서 수동 시작하거나 모델을 배치하세요.`
    );
  }

  const embPath = modelFilePath(EMBEDDING_MODEL_ID);
  if (fs.existsSync(embPath)) {
    console.log(`[localengine] 임베딩 서버 자동 시작: ${EMBEDDING_MODEL_ID} (port ${EMBEDDING_PORT})`);
    const spawned = spawn(LLAMA_SERVER_PATH, ["-m", embPath, "--embedding", "--port", String(EMBEDDING_PORT)], {
      stdio: "pipe",
    });
    embeddingProcess = spawned;
    embeddingModelId = EMBEDDING_MODEL_ID;
    spawned.on("exit", () => {
      if (embeddingProcess === spawned) {
        embeddingProcess = null;
        embeddingModelId = null;
      }
    });
    spawned.on("error", (err) => {
      console.error(`[localengine] 임베딩 서버 기동 실패 (model=${EMBEDDING_MODEL_ID}):`, err);
      if (embeddingProcess === spawned) {
        embeddingProcess = null;
        embeddingModelId = null;
      }
    });
  } else {
    console.log(
      `[localengine] 임베딩 서버 자동 시작 건너뜀 — ${embPath} 없음. RAG를 쓰려면 임베딩 모델을 배치하거나 GIJO_EMBEDDING_MODEL_ID를 설정하세요.`
    );
  }
}

export async function stopEmbeddingEngine(): Promise<void> {
  const proc = embeddingProcess;
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
  if (embeddingProcess === proc) {
    embeddingProcess = null;
    embeddingModelId = null;
  }
}

// 채팅 진입점(llm route, dispatcher)에서 호출 — 에이전트에 전용 모델이 할당돼 있고 그게 지금
// 떠 있는 모델과 다르면 스왑한다. 할당이 없으면(대부분) 전역 모델을 그대로 쓴다. 3090 1대라
// 스왑은 수십 초 걸리므로, 모델이 다른 에이전트를 오가면 매번 재로딩이 발생한다는 점에 유의.
export async function ensureAgentModel(agentId: string): Promise<void> {
  const { getAgentModel } = await import("./agents.js");
  const modelId = getAgentModel(agentId);
  if (!modelId || modelId === currentModelId) return;
  if (!isModelAvailable(modelId)) {
    console.warn(`[localengine] 에이전트 ${agentId}의 할당 모델 ${modelId} 파일이 없어 전역 모델을 유지합니다`);
    return;
  }
  await startLocalEngine(modelId);
}

export function registerLocalEngineRoutes(app: Express): void {
  app.get("/api/localengine/status", authMiddleware, (_req, res) => {
    res.json(getLocalEngineStatus());
  });
  app.get("/api/localengine/models", authMiddleware, (_req, res) => {
    res.json(listAvailableModels());
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
