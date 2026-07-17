// engine/localengine.ts — 로컬 LLM 엔진(llama-server) 프로세스 관리 (VRAM 예산 멀티모델 풀)
// 서버가 GPU(RTX 3090)가 있는 머신에서 실행되며, 이 프로세스들을 단독 소유한다.
//
// 멀티모델 풀: 예전엔 채팅 모델을 1개만 올리고 다른 모델이 필요하면 스왑(기존 종료 후 재기동)했다.
// 하지만 7~9B 양자화 모델은 24GB에 2~3개가 동시에 들어가므로(실측: lily-7b+qwythos-9b+bge-m3 = 16GB),
// 이제 각 모델을 자기 포트에 상주시키는 풀로 관리한다. 새 모델을 올릴 VRAM이 모자라면(대형 30B 등)
// nvidia-smi로 실측한 여유 VRAM을 보고 가장 오래 안 쓴 모델부터 내려 자리를 만든다.
// nvidia-smi가 없으면 개수 상한(MAX_LOADED_MODELS)으로 폴백한다.

import type { Express } from "express";
import { spawn, execFile, ChildProcess } from "child_process";
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

// 제품 확정 모델 (2026-07-17 변경: gijo-main-orchestrator — GIJO 자체 오케스트레이터 LLM).
// "마지막 사용 모델" 기록이 없을 때의 기본. models/gijo-main-orchestrator/gijo-main-orchestrator.gguf.
// (이전 확정 모델 Lily-Cybersecurity-7B는 modeldex 카탈로그에 옵션으로 남아 있어 언제든 선택 가능.)
const DEFAULT_MODEL_ID = process.env.GIJO_DEFAULT_MODEL_ID ?? "gijo-main-orchestrator";

// RAG 임베딩용 별도 llama-server (llm.ts의 EMBEDDING_SERVER_URL과 짝). 스왑/풀 대상이 아니라
// 부팅 시 1회 자동 기동만 관리한다.
const EMBEDDING_MODEL_ID = process.env.GIJO_EMBEDDING_MODEL_ID ?? "bge-m3";
const EMBEDDING_PORT = Number(process.env.GIJO_EMBEDDING_PORT ?? 8081);

// 풀 파라미터
const READY_TIMEOUT_MS = Number(process.env.GIJO_MODEL_READY_TIMEOUT_MS ?? 120000);
// 새 모델 로드에 필요하다고 보는 VRAM(MB) = 파일 크기 + 이 오버헤드(KV 캐시·런타임). 32K 컨텍스트
// 7~9B 기준 여유 있게 잡는다. GIJO_MODEL_VRAM_OVERHEAD_MB로 조정.
const MODEL_VRAM_OVERHEAD_MB = Number(process.env.GIJO_MODEL_VRAM_OVERHEAD_MB ?? 5000);
// nvidia-smi를 못 쓸 때의 폴백: 동시에 올려둘 채팅 모델 최대 개수.
const MAX_LOADED_MODELS = Number(process.env.GIJO_MAX_LOADED_MODELS ?? 2);
// 풀이 쓸 포트 범위(EMBEDDING_PORT는 건너뛴다). 첫 모델은 PORT(8080)를 받아 하위호환.
const PORT_RANGE_END = PORT + 12;

interface LoadedModel {
  modelId: string;
  port: number;
  process: ChildProcess;
  ready: boolean;
  lastUsed: number;
  loadingPromise?: Promise<boolean>;
}

// 채팅 모델 풀 (modelId -> 로드된 llama-server). 임베딩은 별도 단일 프로세스.
const pool = new Map<string, LoadedModel>();
let embeddingProcess: ChildProcess | null = null;
let embeddingModelId: string | null = null;

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

export interface LoadedModelInfo {
  modelId: string;
  port: number;
  ready: boolean;
}

export interface LocalEngineStatus {
  running: boolean;
  port: number;
  modelId: string | null; // 하위호환: 대표(8080) 또는 첫 모델
  loaded: LoadedModelInfo[]; // 풀에 상주 중인 모든 채팅 모델
  embedding: { running: boolean; port: number; modelId: string | null };
}

export function getLocalEngineStatus(): LocalEngineStatus {
  const loaded: LoadedModelInfo[] = [...pool.values()].map((m) => ({ modelId: m.modelId, port: m.port, ready: m.ready }));
  const primary = loaded.find((m) => m.port === PORT) ?? loaded[0];
  return {
    running: pool.size > 0,
    port: primary?.port ?? PORT,
    modelId: primary?.modelId ?? null,
    loaded,
    embedding: { running: !!embeddingProcess, port: EMBEDDING_PORT, modelId: embeddingModelId },
  };
}

function modelFilePath(modelId: string): string {
  return path.join(MODELS_DIR, modelId, `${modelId}.gguf`);
}

function modelFileSizeMb(modelId: string): number {
  try {
    return fs.statSync(modelFilePath(modelId)).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

// models/ 아래 실제로 배치된 채팅 모델 목록 (models/<id>/<id>.gguf 패턴). 임베딩 모델은 제외.
// running = 지금 풀에 상주 중인지.
export function listAvailableModels(): { id: string; running: boolean }[] {
  if (!fs.existsSync(MODELS_DIR)) return [];
  return fs
    .readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== EMBEDDING_MODEL_ID && fs.existsSync(modelFilePath(d.name)))
    .map((d) => ({ id: d.name, running: pool.has(d.name) }));
}

export function isModelAvailable(modelId: string): boolean {
  return fs.existsSync(modelFilePath(modelId));
}

// 부팅 자동 시작 후보: 마지막 사용 모델 → 제품 기본 모델 순으로, 실제 .gguf가 있는 첫 번째.
export function pickAutoStartModelId(): string | null {
  const last = (getStateStmt.get("lastModelId") as { value: string } | undefined)?.value;
  for (const candidate of [last, DEFAULT_MODEL_ID]) {
    if (candidate && fs.existsSync(modelFilePath(candidate))) return candidate;
  }
  return null;
}

// ── VRAM 예산 & 포트 할당 ────────────────────────────────────────────────────
function getFreeVramMb(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], (err, stdout) => {
      if (err) return resolve(null);
      const mb = parseInt(String(stdout).trim().split("\n")[0], 10);
      resolve(Number.isFinite(mb) ? mb : null);
    });
  });
}

// 실 GPU 사용률(utilization %)·VRAM을 nvidia-smi로 실측. 대시보드 로고 발광 강도에 쓴다.
// GPU가 없으면 available:false — 클라이언트는 그때 발광을 기본값으로 둔다(가짜 수치 안 만듦).
export interface GpuUsage {
  available: boolean;
  utilization: number; // 0~100 (%)
  memUsedMb: number;
  memTotalMb: number;
  memPercent: number; // 0~100
}
export function getGpuUsage(): Promise<GpuUsage> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
      (err, stdout) => {
        if (err) return resolve({ available: false, utilization: 0, memUsedMb: 0, memTotalMb: 0, memPercent: 0 });
        // 여러 GPU면 첫 줄만(단일 RTX 3090 가정). "12, 8192, 24576"
        const parts = String(stdout).trim().split("\n")[0].split(",").map((s) => parseInt(s.trim(), 10));
        const [util, used, total] = parts;
        if (![util, used, total].every(Number.isFinite)) return resolve({ available: false, utilization: 0, memUsedMb: 0, memTotalMb: 0, memPercent: 0 });
        resolve({
          available: true,
          utilization: Math.max(0, Math.min(100, util)),
          memUsedMb: used,
          memTotalMb: total,
          memPercent: total > 0 ? Math.round((used / total) * 100) : 0,
        });
      }
    );
  });
}

function allocPort(): number {
  const used = new Set<number>([EMBEDDING_PORT, ...[...pool.values()].map((m) => m.port)]);
  for (let p = PORT; p <= PORT_RANGE_END; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error("사용 가능한 llama-server 포트가 없습니다");
}

// 내릴 후보: exceptId를 제외하고 가장 오래 안 쓴(lastUsed 최소) 모델.
function lruVictim(exceptId: string): string | null {
  let victim: LoadedModel | null = null;
  for (const m of pool.values()) {
    if (m.modelId === exceptId) continue;
    if (!victim || m.lastUsed < victim.lastUsed) victim = m;
  }
  return victim?.modelId ?? null;
}

// modelId를 새로 올릴 자리를 만든다. nvidia-smi 실측 여유가 필요량보다 작으면 LRU부터 내린다.
async function makeRoomFor(modelId: string): Promise<void> {
  const needMb = modelFileSizeMb(modelId) + MODEL_VRAM_OVERHEAD_MB;
  const free = await getFreeVramMb();
  if (free === null) {
    // nvidia-smi 없음 → 개수 상한 폴백
    while (pool.size >= MAX_LOADED_MODELS) {
      const victim = lruVictim(modelId);
      if (!victim) break;
      emitLlmActivity({ kind: "swap", phase: "start", model: modelBasename(victim), detail: `VRAM 확보 위해 내림: ${modelBasename(victim)}` });
      await unloadModel(victim);
    }
    return;
  }
  let freeMb = free;
  while (freeMb < needMb) {
    const victim = lruVictim(modelId);
    if (!victim) break; // 더 내릴 게 없음 — 그냥 시도(정말 부족하면 llama가 실패)
    const reclaimed = modelFileSizeMb(victim) + MODEL_VRAM_OVERHEAD_MB;
    emitLlmActivity({ kind: "swap", phase: "start", model: modelBasename(victim), detail: `VRAM 확보 위해 내림: ${modelBasename(victim)}` });
    await unloadModel(victim);
    freeMb = (await getFreeVramMb()) ?? freeMb + reclaimed;
  }
}

// ── 모델 준비 대기 (health 폴링) ─────────────────────────────────────────────
// 스폰 직후엔 아직 VRAM 로딩 중이라 곧바로 추론하면 연결 거부로 실패한다. /health가 200이 될
// 때까지 기다렸다가 반환해 첫 추론이 바로 성공하게 한다. 프로세스가 죽으면 즉시 중단.
async function waitForReady(model: LoadedModel, timeoutMs = READY_TIMEOUT_MS): Promise<boolean> {
  const url = `http://localhost:${model.port}/health`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pool.get(model.modelId) !== model) return false; // 죽었거나 교체됨
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// modelId를 풀에 로드(또는 이미 있으면 재사용)하고 준비될 때까지 기다린다.
async function ensureModelLoaded(modelId: string): Promise<LoadedModel> {
  const existing = pool.get(modelId);
  if (existing) {
    existing.lastUsed = Date.now();
    if (existing.loadingPromise) await existing.loadingPromise; // 로딩 중이면 완료 대기
    return existing;
  }

  await makeRoomFor(modelId);

  const port = allocPort();
  const spawned = spawn(
    LLAMA_SERVER_PATH,
    ["-m", modelFilePath(modelId), "-ngl", "-1", "--ctx-size", String(DEFAULT_CTX_SIZE), "--port", String(port)],
    { stdio: "pipe" }
  );
  const model: LoadedModel = { modelId, port, process: spawned, ready: false, lastUsed: Date.now() };
  pool.set(modelId, model);
  setStateStmt.run("lastModelId", modelId);
  const loadStart = Date.now();
  emitLlmActivity({ kind: "load", phase: "start", model: modelBasename(modelId), detail: `모델 로드 중 (포트 ${port})` });

  spawned.on("exit", () => {
    if (pool.get(modelId) === model) pool.delete(modelId);
  });
  spawned.on("error", (err) => {
    console.error(`[localengine] llama-server 기동 실패 (model=${modelId}):`, err);
    if (pool.get(modelId) === model) pool.delete(modelId);
  });

  model.loadingPromise = waitForReady(model);
  const ready = await model.loadingPromise;
  model.ready = ready;
  model.loadingPromise = undefined;
  emitLlmActivity({
    kind: "load",
    phase: ready ? "done" : "error",
    model: modelBasename(modelId),
    detail: ready ? `모델 준비 완료 (포트 ${port})` : "모델 준비 대기 시간 초과",
    latencyMs: Date.now() - loadStart,
  });
  return model;
}

// 풀에서 모델 하나를 graceful 종료 후 제거한다.
async function unloadModel(modelId: string): Promise<void> {
  const model = pool.get(modelId);
  if (!model) return;
  pool.delete(modelId);
  const proc = model.process;
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
}

// 명시적 모델 로드 (수동 /start 라우트·부팅 자동 시작). 이미 있으면 재사용.
export async function startLocalEngine(modelId: string): Promise<LocalEngineStatus> {
  if (isModelAvailable(modelId)) await ensureModelLoaded(modelId);
  return getLocalEngineStatus();
}

// 풀의 모든 채팅 모델을 종료한다 (앱 종료 시).
export async function stopLocalEngine(): Promise<void> {
  await Promise.all([...pool.keys()].map((id) => unloadModel(id)));
}

// ── 부팅 자동 시작 (index.ts에서 1회 호출) ──────────────────────────────────
// createApp()에서 부르지 않는다 — 테스트가 실제 llama-server를 스폰하면 안 되므로 부트 전용.
export async function autoStartLocalEngines(): Promise<void> {
  const chatModelId = pickAutoStartModelId();
  if (chatModelId) {
    console.log(`[localengine] 부팅 자동 시작: ${chatModelId} (마지막 사용 모델 또는 기본 모델)`);
    await ensureModelLoaded(chatModelId);
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

// GPU 1대(RTX 3090) 전제: 파인튜닝·GGUF 병합은 VRAM을 독점해야 한다. 학습 전에 추론
// llama-server 풀과 임베딩 서버를 모두 내려 VRAM을 비우고(pause), 학습이 끝나면 부팅 때와 같은
// 자동 시작으로 되돌린다(resume). finetune.ts(단독 학습)와 learnloop.ts(학습 루프)가 공유한다.
export async function pauseInferenceEngines(): Promise<void> {
  await stopLocalEngine();
  await stopEmbeddingEngine();
}

export async function resumeInferenceEngines(): Promise<void> {
  await autoStartLocalEngines();
}

// 채팅 진입점(llm.ts chat)에서 호출 — 에이전트에 할당된 모델(없으면 기본 모델)을 풀에 보장하고
// 그 모델이 서빙되는 base URL을 돌려준다. 모델 파일 자체가 없으면 기본 포트 URL로 폴백한다.
export async function ensureAgentModel(agentId: string): Promise<string> {
  const { getAgentModel } = await import("./agents.js");
  const modelId = getAgentModel(agentId);
  // 전용 모델 할당이 없으면(대부분의 에이전트·테스트) 부팅 시 로드된 기본 모델(기본 포트)을 그대로
  // 쓴다 — 여기서 새 모델을 로드하지 않는다. 할당이 있을 때만 그 모델을 풀에 보장한다.
  if (!modelId || !isModelAvailable(modelId)) {
    if (modelId) console.warn(`[localengine] 에이전트 ${agentId}의 할당 모델 ${modelId} 파일이 없어 기본 모델을 씁니다`);
    return `http://localhost:${PORT}/v1`;
  }
  const model = await ensureModelLoaded(modelId);
  return `http://localhost:${model.port}/v1`;
}

export function registerLocalEngineRoutes(app: Express): void {
  app.get("/api/localengine/status", authMiddleware, (_req, res) => {
    res.json(getLocalEngineStatus());
  });
  // 실 GPU 사용률(로고 발광 강도용) — nvidia-smi 실측. 폴링용이라 가볍다.
  app.get("/api/localengine/gpu", authMiddleware, asyncRoute(async (_req, res) => {
    res.json(await getGpuUsage());
  }));
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
    asyncRoute(async (req, res) => {
      // 특정 모델만 내리거나(modelId 지정) 전체 종료.
      const modelId = req.body?.modelId as string | undefined;
      if (modelId) await unloadModel(modelId);
      else await stopLocalEngine();
      res.json({ ok: true });
    })
  );
}
