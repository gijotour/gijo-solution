// engine/localengine.ts — 로컬 LLM 엔진(llama-server) 프로세스 관리 (VRAM 예산 멀티모델 풀)
// 서버가 GPU(RTX 3090)가 있는 머신에서 실행되며, 이 프로세스들을 단독 소유한다.
//
// 멀티모델 풀: 예전엔 채팅 모델을 1개만 올리고 다른 모델이 필요하면 스왑(기존 종료 후 재기동)했다.
// 하지만 7~9B 양자화 모델은 24GB에 2~3개가 동시에 들어가므로(실측: lily-7b+qwythos-9b+bge-m3 = 16GB),
// 이제 각 모델을 자기 포트에 상주시키는 풀로 관리한다. 새 모델을 올릴 VRAM이 모자라면(대형 30B 등)
// nvidia-smi로 실측한 여유 VRAM을 보고 가장 오래 안 쓴 모델부터 내려 자리를 만든다.
// nvidia-smi가 없으면 개수 상한(MAX_LOADED_MODELS)으로 폴백한다.

import type { Express } from "express";
import { spawn, execFile, execFileSync, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { llamaBinPath } from "../util/llamabin";
import { db } from "../db";
import { emitLlmActivity, modelBasename } from "./llmactivity";
import { adaptModel, getAdaptation, type ModelAdaptation } from "./modelquirks";
import { adoptedAdaptersFor, type LoraAdapter } from "./adapters";

const LLAMA_SERVER_PATH = process.env.GIJO_LLAMA_SERVER_PATH ?? llamaBinPath("llama-server");
const MODELS_DIR = process.env.GIJO_MODELS_DIR ?? "models";
const PORT = Number(process.env.GIJO_LOCAL_LLM_PORT ?? 8080);
const DEFAULT_CTX_SIZE = Number(process.env.GIJO_LOCAL_LLM_CTX_SIZE ?? 32768);
// Java 참고 구현(LocalEngineService)과 동일하게 10초까지 정상 종료를 기다린 뒤 강제 종료한다.
const STOP_TIMEOUT_MS = Number(process.env.GIJO_LOCAL_LLM_STOP_TIMEOUT_MS ?? 10000);

// 제품 확정 모델 — "마지막 사용 모델" 기록이 없을 때의 기본.
//
// 2026-08-09 승격: gijo-main-orchestrator(7.6B) → **qwen3-14b**.
//   기준 모델을 14B 단일로 바꾸기로 한 결정(2026-08-07)이 코드에 반영되지 않고 있었다.
//   운영은 app_state의 lastModelId가 14B를 덮고 있어 멀쩡히 돌았지만, 그건 **예전에
//   골라 둔 기억**일 뿐이다 — 새로 설치한 기계에는 그 기억이 없어 7.6B로 부팅한다.
//   Mac 올인원 dmg에서 실제로 7.6B를 물고 뜬 것을 Mac이 잡아냈다(2026-08-09 인계 ④).
//   근거: qwen3-14b가 평가 게이트 통과(routing 66/66 · korean 24/24 · 견고성 29→71).
// ⚠ 「돌고 있다」와 「기본값이 맞다」는 다르다. 기억이 덮고 있으면 기본값이 틀려도 안 드러난다.
// (옛 모델들은 modeldex 카탈로그에 남아 있어 언제든 선택 가능.)
const DEFAULT_MODEL_ID = process.env.GIJO_DEFAULT_MODEL_ID ?? "qwen3-14b";

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
  // 스폰 시 --lora로 함께 올린 전문가 어댑터들(채택분). llama-server의 요청별 lora 선택은
  // **적재 순서 인덱스**로 어댑터를 가리키므로 그 순서를 그대로 보존한다.
  adapters: { id: string; index: number; topic: string | null }[];
}

// 채팅 모델 풀 (modelId -> 로드된 llama-server). 임베딩은 별도 단일 프로세스.
const pool = new Map<string, LoadedModel>();
let embeddingProcess: ChildProcess | null = null;
let embeddingModelId: string | null = null;

const getStateStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");

// ── GIJO 구동 티어(Lite/Standard/Pro) ────────────────────────────────────────
// GPU VRAM에 따라 동시 LLM 수·컨텍스트·오버헤드를 한 묶음으로 전환한다(VRAM 티어 구동 가이드라인의
// 환경변수 3종을 묶은 것). 화면에서 고른 티어는 app_state("gijoTier")에 영속되며 환경변수보다
// 우선한다 — 환경변수는 설치 시 기본값, 티어는 운영 중 조정값. 세 값 모두 함수 경유로 읽히므로
// 노드 프로세스 재시작 없이 채팅 모델 풀 재기동만으로 적용된다(ctx는 스폰 인자라서).
export interface GijoTierSpec {
  id: "lite" | "standard" | "pro";
  label: string;
  vramLabel: string;
  maxLoadedModels: number;
  ctxSize: number;
  overheadMb: number;
  desc: string;
}
export const GIJO_TIERS: GijoTierSpec[] = [
  { id: "lite", label: "Lite", vramLabel: "12GB급", maxLoadedModels: 1, ctxSize: 16384, overheadMb: 3500, desc: "채팅 LLM 1개 · 16K 컨텍스트 — 1인 담당자·엔트리 GPU" },
  { id: "standard", label: "Standard", vramLabel: "24GB급", maxLoadedModels: 2, ctxSize: 32768, overheadMb: 5000, desc: "채팅 LLM 2개 · 32K — 2~3인 팀(현행 기본값)" },
  { id: "pro", label: "Pro", vramLabel: "32GB급", maxLoadedModels: 3, ctxSize: 32768, overheadMb: 5000, desc: "채팅 LLM 3개 · 32K — SOC 팀·대용량 GPU" },
];
function storedTier(): GijoTierSpec | null {
  try {
    const v = (getStateStmt.get("gijoTier") as { value: string } | undefined)?.value;
    return GIJO_TIERS.find((t) => t.id === v) ?? null;
  } catch {
    return null;
  }
}
export function currentTierSettings(): { tier: GijoTierSpec["id"] | null; maxLoadedModels: number; ctxSize: number; overheadMb: number } {
  const t = storedTier();
  if (t) return { tier: t.id, maxLoadedModels: t.maxLoadedModels, ctxSize: t.ctxSize, overheadMb: t.overheadMb };
  return { tier: null, maxLoadedModels: MAX_LOADED_MODELS, ctxSize: DEFAULT_CTX_SIZE, overheadMb: MODEL_VRAM_OVERHEAD_MB };
}
// VRAM 총량 기준 권장 티어 — tools/model-benchmark.mjs 판정과 동일 기준.
export function recommendTier(totalMb: number): GijoTierSpec["id"] {
  return totalMb < 16000 ? "lite" : totalMb < 28000 ? "standard" : "pro";
}
const setStateStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

export interface LoadedModelInfo {
  modelId: string;
  port: number;
  ready: boolean;
  // BYOM 자동 적응 내용(thinking 끔·ctx 맞춤) — 화면·리포트가 "무엇을 맞췄는지" 보여줄 근거.
  adaptation?: ModelAdaptation | null;
  // 함께 적재된 전문가 어댑터(채택분) — 화면이 "이 베이스에 어떤 전문성이 실려 있나"를 보여줄 근거.
  adapters?: { id: string; index: number; topic: string | null }[];
}

export interface LocalEngineStatus {
  running: boolean;
  port: number;
  modelId: string | null; // 하위호환: 대표(8080) 또는 첫 모델
  loaded: LoadedModelInfo[]; // 풀에 상주 중인 모든 채팅 모델
  embedding: { running: boolean; port: number; modelId: string | null };
}

export function getLocalEngineStatus(): LocalEngineStatus {
  const loaded: LoadedModelInfo[] = [...pool.values()].map((m) => ({ modelId: m.modelId, port: m.port, ready: m.ready, adaptation: getAdaptation(m.modelId), adapters: m.adapters }));
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

/**
 * 부팅 자동 시작 후보: **운영자가 고른 모델 → 제품 기본 모델 → (마지막 수단)마지막 로드 모델**.
 *
 * ⚠ [2026-07-30 실사고] 예전엔 "마지막 로드 모델"(lastModelId)을 최우선으로 썼다. 그런데
 *   lastModelId는 **어떤 이유로든 모델이 올라갈 때마다** 갱신된다 — 채택 검토(adopt.mjs)가
 *   후보 모델을 시험 삼아 올린 것도 포함이다. 그래서 게이트가 탈락시킨 합성 모델이
 *   부팅 기본값으로 굳어, 재시작마다 **운영이 탈락한 모델로 조용히 돌아갔다**(오늘 3회 발생,
 *   그 중 한 번은 게이트가 엉뚱한 모델을 재느라 판정까지 무효가 됐다).
 *   시험용으로 잠깐 올린 것이 운영 기본이 되어서는 안 된다 — 기본값은 사람이 고른 것만이다.
 */
export function pickAutoStartModelId(): string | null {
  const chosen = (getStateStmt.get("defaultModelId") as { value: string } | undefined)?.value;
  const last = (getStateStmt.get("lastModelId") as { value: string } | undefined)?.value;
  for (const candidate of [chosen, DEFAULT_MODEL_ID, last]) {
    if (candidate && fs.existsSync(modelFilePath(candidate))) return candidate;
  }
  return null;
}

// ── VRAM 예산 & 포트 할당 ────────────────────────────────────────────────────
// Apple Silicon(mac)은 통합메모리라 GPU(Metal)가 시스템 RAM을 공유한다 — nvidia-smi가 없으므로
// "여유 VRAM" = 여유 시스템 메모리로 본다. 이렇게 하면 makeRoom·티어 판정이 mac에서도 실수치로 돈다.
const IS_MAC = process.platform === "darwin";
function getFreeVramMb(): Promise<number | null> {
  if (IS_MAC) return Promise.resolve(Math.round(os.freemem() / 1024 / 1024));
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], (err, stdout) => {
      if (err) return resolve(null);
      const mb = parseInt(String(stdout).trim().split("\n")[0], 10);
      resolve(Number.isFinite(mb) ? mb : null);
    });
  });
}

// 실 GPU 사용률(utilization %)·VRAM을 nvidia-smi로 실측. LRU 모델 축출 판단·hang 진단 스냅샷에 쓴다
// (대시보드 표시용 폴링은 제거됨 — 2026-07-21, VRAM 이슈 조사 중 단순화 결정).
// GPU가 없으면 available:false.
export interface GpuUsage {
  available: boolean;
  utilization: number; // 0~100 (%)
  memUsedMb: number;
  memTotalMb: number;
  memPercent: number; // 0~100
}
export function getGpuUsage(): Promise<GpuUsage> {
  // mac(Metal): nvidia-smi가 없다. 통합메모리를 "GPU 메모리"로 간주해 available:true로 보고한다
  // → 티어 자동판정·구동 가능 판정이 mac에서도 동작(utilization은 별도 도구 없이 못 재므로 0).
  if (IS_MAC) {
    const totalMb = Math.round(os.totalmem() / 1024 / 1024);
    const usedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    return Promise.resolve({
      available: true,
      utilization: 0,
      memUsedMb: usedMb,
      memTotalMb: totalMb,
      memPercent: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
    });
  }
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

// hang 진단 스냅샷 — 재기동 직전 GPU·CPU·모델 프로세스 상태를 한 줄로 남긴다.
// 반복되는 hang이 앱 로직(GPU 경합) 때문인지 호스트 차원의 순간 정지(WSL/드라이버) 때문인지
// 실측(2026-07-21: embed→chat 순서였다가 chat→embed 순서로 뒤바뀜)만으로는 못 가른다 —
// 다음 재현 때 이 스냅샷으로 바로 판별하기 위함(opslog-watch.mjs가 이 로그 라인도 findings로 잡는다).
export async function captureHangDiagnostics(): Promise<string> {
  const gpu = await getGpuUsage();
  const load = os.loadavg().map((n) => n.toFixed(2)).join(",");
  const memFreePct = Math.round((os.freemem() / os.totalmem()) * 100);
  const models = [...pool.values()].map((m) => `${m.modelId}:${m.process.pid}${m.process.killed ? "(dead)" : ""}`).join(", ");
  return (
    `GPU ${gpu.available ? `${gpu.utilization}%·${gpu.memUsedMb}/${gpu.memTotalMb}MiB` : "조회불가"} · ` +
    `CPU load ${load} · 여유메모리 ${memFreePct}% · 로드된 모델: ${models || "없음"}`
  );
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
  const tier = currentTierSettings(); // 티어 전환이 즉시 반영되도록 호출 시점에 읽는다
  const needMb = modelFileSizeMb(modelId) + tier.overheadMb;
  const free = await getFreeVramMb();
  if (free === null) {
    // nvidia-smi 없음 → 개수 상한 폴백
    while (pool.size >= tier.maxLoadedModels) {
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
    const reclaimed = modelFileSizeMb(victim) + tier.overheadMb;
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

// llama-server 자식의 stdout/stderr를 반드시 소비한다 — stdio:"pipe"로 띄우고 아무도 읽지 않으면
// 64KB 파이프 버퍼가 차는 순간 자식이 로그 쓰기에서 블록돼 **멈춘 것처럼 보인다**(2026-07-23 실측:
// 대량 인입에서 요청 로그가 버퍼를 채우자 임베딩 서버가 1분 만에 무응답 → 워치독 재기동 루프).
// 마지막 몇 줄은 링버퍼로 남겨 비정상 종료 진단에 쓴다.
function drainProcessOutput(p: ChildProcess, label: string): () => string {
  const tail: string[] = [];
  const keep = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      tail.push(t.slice(0, 300));
      if (tail.length > 30) tail.shift();
    }
  };
  p.stdout?.on("data", keep);
  p.stderr?.on("data", keep);
  p.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[localengine] ${label} 비정상 종료(code=${code}, signal=${signal ?? "-"}) — 마지막 출력:\n${tail.slice(-8).join("\n")}`);
    }
  });
  return () => tail.join("\n");
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
  // BYOM 자동 적응(modelquirks, 2026-08-05) — 올린 모델을 이 환경에 맞춘다:
  //   · thinking(추론) 모델이면 생각을 끈다(--reasoning off) — Qwen3를 기본으로 띄우면
  //     생각이 토큰 예산을 다 써 **답이 빈칸**이 되는 것을 실측으로 확인했다.
  //   · 컨텍스트는 모델 native보다 크게 안 띄운다(로드 실패·rope 왜곡 방지).
  //   비-thinking 모델은 extraArgs가 비어 **기존과 완전히 같다**(현행 함대 무영향).
  const adaptation = adaptModel(modelId, modelFilePath(modelId), currentTierSettings().ctxSize);
  if (adaptation.thinking || (adaptation.nativeCtx && adaptation.fittedCtx !== currentTierSettings().ctxSize)) {
    console.log(
      `[localengine] 모델 적응: ${modelId} —${adaptation.thinking ? " thinking 끔" : ""}` +
      `${adaptation.nativeCtx ? ` · ctx ${adaptation.fittedCtx}(native ${adaptation.nativeCtx})` : ""} [판별: ${adaptation.판별}]`
    );
  }
  // 전문가 어댑터(재설계 1단계): 이 모델을 베이스로 하는 **채택** 어댑터를 스케일 0으로 함께
  // 적재한다(--lora-init-without-apply). 기본 동작은 베이스 그대로이고, 요청이 lora 필드로
  // 명시할 때만 어댑터가 켜진다 — 어댑터가 하나도 없으면 인자가 비어 기존과 완전히 같다.
  const 어댑터들 = adoptedAdaptersFor(modelId);
  const loraArgs = 어댑터들.length
    ? ["--lora-init-without-apply", ...어댑터들.flatMap((a) => ["--lora", a.file])]
    : [];
  if (어댑터들.length) {
    console.log(`[localengine] 전문가 어댑터 ${어댑터들.length}개 적재: ${어댑터들.map((a) => a.id).join(", ")} (베이스 ${modelId})`);
  }
  const spawned = spawn(
    LLAMA_SERVER_PATH,
    ["-m", modelFilePath(modelId), "-ngl", "-1", "--ctx-size", String(adaptation.fittedCtx), ...확인용칸(adaptation.fittedCtx), "--port", String(port), ...adaptation.extraArgs, ...loraArgs],
    { stdio: "pipe" }
  );
  drainProcessOutput(spawned, `채팅 모델 ${modelId}`);
  const model: LoadedModel = {
    modelId,
    port,
    process: spawned,
    ready: false,
    lastUsed: Date.now(),
    adapters: 어댑터들.map((a: LoraAdapter, index: number) => ({ id: a.id, index, topic: a.topic })),
  };
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
/**
 * 운영자가 **명시적으로 고른** 모델을 올린다(화면 · 관리 API 경로).
 * 이 선택만이 부팅 기본값(defaultModelId)이 된다 — 아래 pickAutoStartModelId 주석 참조.
 */
export async function startLocalEngine(modelId: string): Promise<LocalEngineStatus> {
  if (isModelAvailable(modelId)) {
    setStateStmt.run("defaultModelId", modelId); // 사람이 고른 것 = 재시작 후에도 이것
    await ensureModelLoaded(modelId);
  }
  return getLocalEngineStatus();
}

// 풀의 모든 채팅 모델을 종료한다 (앱 종료 시).
export async function stopLocalEngine(): Promise<void> {
  await Promise.all([...pool.keys()].map((id) => unloadModel(id)));
}

// ── 부팅 자동 시작 (index.ts에서 1회 호출) ──────────────────────────────────
// createApp()에서 부르지 않는다 — 테스트가 실제 llama-server를 스폰하면 안 되므로 부트 전용.
/**
 * 지난 프로세스가 남긴 llama-server 고아를 정리한다(임베딩은 살려 둔다).
 *
 * ⚠ [2026-07-30 실사고] 서비스가 재시작되자(systemd Restart) 이전 Node가 띄운 llama-server
 *   자식들이 **고아로 남아 VRAM을 붙들었다** — 합성 모델 3벌이 23.6GB/24.6GB를 먹어
 *   새 엔진이 뜨지 못하고 "AI 모델이 아직 준비되지 않았습니다"만 나왔다. 화면은 멀쩡한데
 *   챗봇이 통째로 죽은, 이 프로젝트가 가장 경계하는 '조용한 고장'이다.
 *   재시작마다 우리 것이 아닌 채팅 모델 프로세스를 먼저 걷어 낸다.
 *   임베딩(8081)은 재사용 설계라 건드리지 않는다.
 */
function reapOrphanEngines(): void {
  if (process.platform === "win32") return; // 운영은 리눅스(WSL) — 개발 머신에서는 건너뛴다
  try {
    // ⚠⚠ **다른 GIJO 서버가 이미 돌고 있으면 정리하지 않는다**(2026-08-05 실사고).
    //   "부팅 시점이니 채팅 모델은 전부 고아"라는 가정은 **서버가 하나일 때만** 참이다.
    //   에어갭 봉인을 실증하려고 별 포트(4100)·별 DB로 임시 인스턴스를 띄웠더니, 그 부팅이
    //   **운영(4000)이 띄운 llama-server 2개를 고아로 보고 죽였다**. 포트·DB를 갈라도
    //   llama 자식은 공유 자원이라 격리가 안 된다 — 담당자 전원의 채팅이 조용히 멎는다.
    //   살아 있는 형제가 있으면 그 자식이 누구 것인지 우리는 알 수 없다. **모르면 안 죽인다.**
    const 형제 = execFileSync("pgrep", ["-af", "node"], { encoding: "utf-8" })
      .split("\n")
      .filter((l) => /dist[/\\]index\.js/.test(l) && !l.includes("pgrep"))
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .filter((pid) => Number.isFinite(pid) && pid !== process.pid);
    if (형제.length) {
      console.warn(
        `[localengine] 다른 GIJO 서버가 돌고 있어(pid ${형제.join(", ")}) 고아 정리를 건너뜁니다 — ` +
        "한 머신에서 서버 둘을 띄우면 서로의 llama-server를 죽입니다. 시험용이면 운영을 먼저 내리세요."
      );
      return;
    }
    // 형제가 없으면 채팅 모델 프로세스는 전부 고아다(우리가 방금 띄운 것은 아직 없다).
    const out = execFileSync("pgrep", ["-af", "llama-server"], { encoding: "utf-8" });
    const orphans = out
      .split("\n")
      .filter((l) => l.includes("llama-server") && !l.includes("--embedding") && !l.includes("pgrep"))
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .filter((pid) => Number.isFinite(pid) && pid !== process.pid);
    for (const pid of orphans) {
      try {
        process.kill(pid, "SIGKILL");
        console.log(`[localengine] 고아 llama-server 정리: pid ${pid}`);
      } catch { /* 이미 죽었으면 무시 */ }
    }
  } catch {
    /* pgrep 없음·매칭 0건 — 정리할 것이 없다는 뜻이라 조용히 넘긴다 */
  }
}

export async function autoStartLocalEngines(): Promise<void> {
  reapOrphanEngines();
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
  // 이전 서버 프로세스가 남긴 임베딩 llama-server가 이미 포트를 잡고 정상 서빙 중이면 재사용한다.
  // 실측(2026-07-17): 서버 재시작 시 자식 llama-server가 고아로 살아남아 새 스폰이 포트 충돌로
  // 죽고, 임베딩이 "반쯤 죽은" 상태(간헐 hang/실패)가 됐다 — 중복 스폰이 원인이라 선점 감지로 막는다.
  // /v1/models만 확인하면 "반쯤 죽은"(모델은 응답, 임베딩은 hang) 서버를 재사용해버린다 — 실제 임베딩을
  // 한 번 돌려보고 성공할 때만 재사용한다. 실패(먹통)면 새로 띄운다.
  const alive = await fetch(`http://localhost:${EMBEDDING_PORT}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: "healthcheck" }),
    signal: AbortSignal.timeout(4000),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (alive) {
    console.log(`[localengine] 임베딩 서버 이미 동작 중(port ${EMBEDDING_PORT}) — 재사용, 중복 스폰 생략`);
    embeddingModelId = EMBEDDING_MODEL_ID;
    return;
  }
  if (fs.existsSync(embPath)) {
    spawnEmbeddingServer(embPath);
  } else {
    console.log(
      `[localengine] 임베딩 서버 자동 시작 건너뜀 — ${embPath} 없음. RAG를 쓰려면 임베딩 모델을 배치하거나 GIJO_EMBEDDING_MODEL_ID를 설정하세요.`
    );
  }
}

// 임베딩 llama-server를 스폰한다(재기동에서도 재사용). -ngl -1: bge-m3를 GPU에 상주시켜 배치
// 임베딩이 CPU로 느려지지 않게 한다(채팅 모델과 동일 설계).
function spawnEmbeddingServer(embPath: string): void {
  console.log(`[localengine] 임베딩 서버 시작: ${EMBEDDING_MODEL_ID} (port ${EMBEDDING_PORT}, GPU 상주)`);
  // --ctx-size/--batch-size/--ubatch-size를 bge-m3 최대(8192)로 명시한다. 기본값(n_ubatch=512)으로
  // 뜨면 512토큰 초과 입력에 HTTP 500을 돌려줘 큰 청크(매뉴얼 등)가 조용히 인입 실패한다
  // (2026-07-20 실측: 2000자↑ 입력 → 500. 모니터가 임베딩을 기본 인자로 재기동하며 RAG가 degraded).
  const spawned = spawn(
    LLAMA_SERVER_PATH,
    ["-m", embPath, "--embedding", "-ngl", "-1", "--ctx-size", "8192", "--batch-size", "8192", "--ubatch-size", "8192", "--port", String(EMBEDDING_PORT)],
    { stdio: "pipe" }
  );
  drainProcessOutput(spawned, "임베딩 서버 bge-m3");
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
}

// 지정 포트를 잡고 있는 프로세스를 강제 종료한다 — 재기동 시 고아 프로세스가 포트를 잡고 있어
// 새 스폰이 충돌로 죽는 걸 막는다(실측 2026-07-17의 중복 스폰 문제와 같은 뿌리). Windows는 netstat+
// taskkill, unix는 lsof+kill. 실패해도 비치명적(재기동이 어차피 재시도).
function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("cmd", ["/c", `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`], () => resolve());
    } else {
      execFile("sh", ["-c", `lsof -ti tcp:${port} | xargs -r kill -9`], () => resolve());
    }
  });
}

// 실제 임베딩 요청으로 서버가 살아있는지 확인한다. /v1/models(또는 프로세스 존재)만으론 "반쯤 죽은"
// (프로세스는 살아있고 실제 임베딩은 hang) 상태를 못 잡는다(실측 2026-07-19: GPU 경합으로 임베딩이
// 무응답이 되어 문서 인입이 통째로 실패). 짧은 타임아웃으로 실제 임베딩을 한 번 돌려본다.
async function probeEmbeddingAlive(timeoutMs = 6000): Promise<boolean> {
  return fetch(`http://localhost:${EMBEDDING_PORT}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: "healthcheck" }),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (r) => r.ok && Array.isArray((await r.json())?.data))
    .catch(() => false);
}

// ── 임베딩 서버 hang 감시·자동 재기동 ────────────────────────────────────────
// 주기적으로 실제 임베딩을 찔러보고, 연속 실패하면(일시적 부하와 진짜 hang을 구분하려 2회) 서버를
// 죽이고 새로 띄운다. 부팅 시 1회 시작하며(index.ts), 이후 자가 치유한다.
let embeddingMonitorTimer: NodeJS.Timeout | null = null;
let embeddingProbeFailures = 0;
let embeddingRestarting = false;
const EMBED_MONITOR_INTERVAL_MS = Number(process.env.GIJO_EMBED_MONITOR_INTERVAL_MS ?? 30000);
const EMBED_FAIL_THRESHOLD = Number(process.env.GIJO_EMBED_FAIL_THRESHOLD ?? 2);

// 재기동 직후엔 GPU가 모델 로딩으로 바빠 "다른" 모델이 일시 무응답이 되고, 그걸 hang으로 오판해
// 또 재기동 → 연쇄 재기동(폭주)이 생긴다(실측 2026-07-20: 임베딩→채팅→임베딩 순 재기동 반복,
// GPU는 여유). 어느 모델이든 재기동하면 이 시각까지 두 감시가 모두 진정(probe 건너뜀+실패카운트
// 리셋)해 오판 연쇄를 끊는다. 진짜 hang은 진정 구간이 끝난 뒤 다시 감지된다.
let healSettleUntil = 0;
const HEAL_SETTLE_MS = Number(process.env.GIJO_HEAL_SETTLE_MS ?? 60000);

// 임계 도달 시 "죽이기 전에 한 번 더" 확인하는 관용 타임아웃. 실측(2026-07-22): CPU/GPU가 유휴인데
// (실제 요청 없음) 프로브만 ~30s 타임아웃 → 재기동. WSL2 GPU 계층의 일시 정지가 스스로 풀리는
// 경우가 많아, 넉넉히 한 번 더 기다려 응답하면 불필요한 재기동을 취소한다(진짜 hang과 일시 지연 구분).
const CONFIRM_TIMEOUT_MS = Number(process.env.GIJO_HEAL_CONFIRM_TIMEOUT_MS ?? 25000);
let transientSkips = 0; // 재기동을 취소한 "일시 지연" 횟수(운영 관측용)
export function getTransientSkipCount(): number { return transientSkips; }

async function checkAndHealEmbedding(): Promise<void> {
  if (embeddingRestarting || chatHealing) return; // 재기동 중이면 건너뜀(중복·GPU 경합 방지)
  if (Date.now() < healSettleUntil) { embeddingProbeFailures = 0; return; } // 최근 재기동 직후 진정 구간
  const embPath = modelFilePath(EMBEDDING_MODEL_ID);
  if (!fs.existsSync(embPath)) return; // 임베딩 모델 미배치 — 감시 대상 아님
  const alive = await probeEmbeddingAlive();
  if (alive) {
    embeddingProbeFailures = 0;
    return;
  }
  embeddingProbeFailures += 1;
  console.warn(`[localengine] 임베딩 서버 무응답 감지 (${embeddingProbeFailures}/${EMBED_FAIL_THRESHOLD})`);
  if (embeddingProbeFailures < EMBED_FAIL_THRESHOLD) return;

  // 재확인·재기동 동안 다른 감시 틱이 겹치지 않게 **먼저** 잠근다. 재확인(CONFIRM_TIMEOUT_MS)이
  // 감시 주기(30s)보다 길어질 수 있어, 잠금을 재확인 뒤로 두면 다음 틱이 중복 진입해 이중 재기동이
  // 난다(실측 2026-07-22: 22:28:13 재기동 직후 22:28:18에 3/2로 또 재기동).
  embeddingRestarting = true;
  try {
    // 죽이기 전 최종 재확인 — 넉넉한 타임아웃으로 한 번 더. 되살아났으면 일시 지연이므로 재기동 취소.
    if (await probeEmbeddingAlive(CONFIRM_TIMEOUT_MS)) {
      embeddingProbeFailures = 0;
      transientSkips += 1;
      console.warn(`[localengine] 임베딩 서버 일시 지연(WSL2 GPU 추정) — 재확인 응답 정상, 재기동 취소 (누적 취소 ${transientSkips})`);
      return;
    }
    // 최종 재확인도 실패 — 진짜 hang. 죽이고 새로 띄운다.
    healSettleUntil = Date.now() + HEAL_SETTLE_MS; // 채팅 감시도 잠시 진정(연쇄 재기동 방지)
    const diag = await captureHangDiagnostics().catch(() => "진단 실패");
    console.warn(`[localengine] 임베딩 서버 hang — 자동 재기동 | 진단: ${diag}`);
    await stopEmbeddingEngine().catch(() => {});
    await killProcessOnPort(EMBEDDING_PORT).catch(() => {}); // 고아 프로세스가 포트를 잡고 있을 수 있음
    spawnEmbeddingServer(embPath);
    // 새 서버가 실제 임베딩에 응답할 때까지 대기(최대 ~40s).
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await probeEmbeddingAlive()) {
        console.log(`[localengine] 임베딩 서버 재기동 완료 — 정상 응답 확인`);
        embeddingProbeFailures = 0;
        break;
      }
    }
  } finally {
    embeddingRestarting = false;
  }
}

export function startEmbeddingMonitor(): void {
  if (embeddingMonitorTimer) return;
  embeddingMonitorTimer = setInterval(() => {
    void checkAndHealEmbedding();
  }, EMBED_MONITOR_INTERVAL_MS);
  console.log(`[localengine] 임베딩 서버 감시 시작 (${EMBED_MONITOR_INTERVAL_MS / 1000}s 간격, 연속 ${EMBED_FAIL_THRESHOLD}회 실패 시 자동 재기동)`);
}

export function stopEmbeddingMonitor(): void {
  if (embeddingMonitorTimer) {
    clearInterval(embeddingMonitorTimer);
    embeddingMonitorTimer = null;
  }
}

// ── 채팅 모델 hang 감시·자동 재기동 ──────────────────────────────────────────
// 임베딩과 같은 문제가 채팅 모델에도 있다: llama-server의 /health는 200인데 실제 추론이
// 무응답(hang)이 될 수 있다(실측 2026-07-19: 요청 폭주 후 채팅 모델 무응답 → 임베딩과 달리
// 자동복구가 없어 사람이 수동 재시작해야 했음). 짧은 완성 요청을 실제로 돌려보고, 연속 실패하면
// 그 모델을 죽이고 새로 띄운다. 타임아웃을 넉넉히(30s) 잡아 정상적인 긴 응답을 hang으로 오판하지
// 않게 하고, 2회 연속 실패(≈3분 무응답)일 때만 재기동한다.
/**
 * 상태 점검(ping)이 담당자의 프롬프트 캐시를 밀어내지 않도록 **칸(slot)을 하나 더** 준다.
 *
 * 실측(2026-08-09) — 이 한 줄이 없을 때 담당자가 겪던 것:
 *   ① "머부터해야되나요"  43.2초   ← 유휴 뒤 첫 질문
 *   ② 바로 다시            0.7초   ← 캐시가 살아 있음
 *   ③ 감시 ping 발사 후    34.4초   ← **ping이 캐시를 밀어냈다**
 *   ④ 다시                 0.6초
 * 90초마다 도는 상태 점검이 칸 하나를 통째로 덮어써서, 그 뒤 첫 질문은 시스템 프롬프트를
 * 처음부터 다시 읽어야 했다. 아침에 앱을 열고 처음 묻는 사람은 **매번** 40초를 기다린 셈이다.
 *
 * llama.cpp는 앞부분이 가장 많이 겹치는 칸을 고른다 — 칸이 둘이면 짧은 ping은 남는 칸으로 가고
 * 담당자의 긴 프롬프트는 제 칸에 그대로 남는다. 총 문맥은 --ctx-size 그대로이고 칸끼리 나눠 쓰므로
 * **메모리는 늘지 않는다.** 다만 칸당 문맥이 절반이 되니, 절반이 8192 미만이면 칸을 안 나눈다
 * (문맥을 줄여 가며 얻을 속도가 아니다).
 */
function 확인용칸(fittedCtx: number): string[] {
  const 칸당 = Math.floor(fittedCtx / 2);
  if (칸당 < 8192) return [];
  return ["--parallel", "2"];
}

async function probeChatAlive(port: number, timeoutMs = 30000): Promise<boolean> {
  return fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], max_tokens: 1, temperature: 0 }),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then((r) => r.ok)
    .catch(() => false);
}

let chatMonitorTimer: NodeJS.Timeout | null = null;
const chatProbeFailures = new Map<string, number>(); // modelId -> 연속 실패 수
let chatHealing = false;
const CHAT_MONITOR_INTERVAL_MS = Number(process.env.GIJO_CHAT_MONITOR_INTERVAL_MS ?? 90000);
const CHAT_FAIL_THRESHOLD = Number(process.env.GIJO_CHAT_FAIL_THRESHOLD ?? 2);

async function checkAndHealChat(): Promise<void> {
  if (chatHealing || embeddingRestarting) return; // 재기동 중이면 건너뜀(GPU 경합·중복 방지)
  if (Date.now() < healSettleUntil) { chatProbeFailures.clear(); return; } // 최근 재기동 직후 진정 구간
  const models = [...pool.values()].filter((m) => m.ready);
  for (const m of models) {
    const alive = await probeChatAlive(m.port);
    if (alive) {
      chatProbeFailures.set(m.modelId, 0);
      continue;
    }
    const fails = (chatProbeFailures.get(m.modelId) ?? 0) + 1;
    chatProbeFailures.set(m.modelId, fails);
    console.warn(`[localengine] 채팅 모델 무응답 감지: ${m.modelId} (${fails}/${CHAT_FAIL_THRESHOLD})`);
    if (fails < CHAT_FAIL_THRESHOLD) continue;

    // 재확인·재기동 동안 다른 감시 틱 겹침 방지 — **먼저** 잠근다(임베딩과 동일: 재확인이 주기보다 길어질 수 있음).
    chatHealing = true;
    try {
      // 죽이기 전 최종 재확인 — 넉넉한 타임아웃으로 한 번 더. 되살아났으면 일시 지연이므로 재기동 취소.
      if (await probeChatAlive(m.port, CONFIRM_TIMEOUT_MS)) {
        chatProbeFailures.set(m.modelId, 0);
        transientSkips += 1;
        console.warn(`[localengine] 채팅 모델 일시 지연(WSL2 GPU 추정) — 재확인 응답 정상, 재기동 취소: ${m.modelId} (누적 취소 ${transientSkips})`);
        chatHealing = false;
        continue;
      }

      // 최종 재확인도 실패 — 진짜 hang. 한 번에 한 모델만 죽이고 새로 띄운다(GPU 부담·중복 방지).
      healSettleUntil = Date.now() + HEAL_SETTLE_MS; // 임베딩·다른 채팅 감시도 잠시 진정(연쇄 재기동 방지)
      const diag = await captureHangDiagnostics().catch(() => "진단 실패");
      console.warn(`[localengine] 채팅 모델 hang — 자동 재기동: ${m.modelId} | 진단: ${diag}`);
      await unloadModel(m.modelId).catch(() => {});
      await killProcessOnPort(m.port).catch(() => {}); // 고아 프로세스가 포트를 잡고 있을 수 있음
      const reloaded = await ensureModelLoaded(m.modelId).catch(() => null);
      if (reloaded && (await probeChatAlive(reloaded.port))) {
        console.log(`[localengine] 채팅 모델 재기동 완료 — 정상 응답 확인: ${m.modelId}`);
        chatProbeFailures.set(m.modelId, 0);
      }
    } finally {
      chatHealing = false;
    }
    break;
  }
}

export function startChatMonitor(): void {
  if (chatMonitorTimer) return;
  chatMonitorTimer = setInterval(() => void checkAndHealChat(), CHAT_MONITOR_INTERVAL_MS);
  console.log(`[localengine] 채팅 모델 감시 시작 (${CHAT_MONITOR_INTERVAL_MS / 1000}s 간격, 연속 ${CHAT_FAIL_THRESHOLD}회 실패 시 자동 재기동)`);
}

export function stopChatMonitor(): void {
  if (chatMonitorTimer) {
    clearInterval(chatMonitorTimer);
    chatMonitorTimer = null;
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

// 요청별 전문가 어댑터 선택(재설계 1단계) — llm.ts가 chat/completions 본문에 펼쳐 넣는다.
//
// 서빙 모델에 어댑터가 하나도 안 실려 있으면 **빈 객체**를 돌려줘 기존 요청과 완전히 같다
// (현행 함대 무영향 보장). 어댑터가 실려 있으면:
//   · 배정 어댑터가 있고 그 모델에 적재돼 있으면 lora:[{id: 적재 인덱스, scale:1}]
//   · 배정이 없으면 lora:[] (모든 어댑터 스케일 0 = 베이스 그대로를 명시)
//   · 어느 쪽이든 cache_prompt:false — llama-server가 어댑터가 다른 요청끼리 프롬프트 KV를
//     재사용해 **답이 이전 어댑터에 오염되는 실측 이슈**(ggml-org/llama.cpp#26207)의 방어.
//     프롬프트 재처리 비용이 들지만, 오염된 답보다 느린 답이 낫다. 팀원별 슬롯 고정은 후속 최적화.
export async function agentRequestExtras(agentId: string): Promise<Record<string, unknown>> {
  const { getAgentModel, getAgentAdapter } = await import("./agents.js");
  const assignedModel = getAgentModel(agentId);
  const model =
    assignedModel && pool.has(assignedModel)
      ? pool.get(assignedModel)!
      : [...pool.values()].find((m) => m.port === PORT) ?? null;
  if (!model || model.adapters.length === 0) return {};
  const adapterId = getAgentAdapter(agentId);
  const loaded = adapterId ? model.adapters.find((a) => a.id === adapterId) : undefined;
  if (adapterId && !loaded) {
    console.warn(`[localengine] 에이전트 ${agentId}의 어댑터 ${adapterId}가 서빙 모델 ${model.modelId}에 안 실려 있어 베이스로 답합니다`);
  }
  return { lora: loaded ? [{ id: loaded.index, scale: 1 }] : [], cache_prompt: false };
}

// 임의의 로컬 모델을 서빙 보장하고 그 OpenAI 호환 base URL을 돌려준다(레드팀 대상 다변화용).
// 모델 파일(models/<id>/<id>.gguf)이 없으면 던진다 — 호출측이 대상 없음을 처리하게.
export async function ensureModelServed(modelId: string): Promise<string> {
  if (!isModelAvailable(modelId)) throw new Error(`로컬 모델 없음: ${modelId}`);
  const model = await ensureModelLoaded(modelId);
  return `http://localhost:${model.port}/v1`;
}

export function registerLocalEngineRoutes(app: Express): void {
  app.get("/api/localengine/status", authMiddleware, (_req, res) => {
    res.json(getLocalEngineStatus());
  });
  // GIJO 구동 티어 조회 — GPU 실측 + 현재 티어 + 권장 판정 + 티어 사양표. 설정 화면 "구동 티어" 구역용.
  app.get(
    "/api/localengine/tier",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      const gpu = await getGpuUsage();
      const current = currentTierSettings();
      const recommended = gpu.available ? recommendTier(gpu.memTotalMb) : null;
      res.json({
        gpu: gpu.available ? { totalMb: gpu.memTotalMb, usedMb: gpu.memUsedMb, freeMb: gpu.memTotalMb - gpu.memUsedMb, utilization: gpu.utilization } : null,
        current,
        recommended,
        reason: gpu.available
          ? IS_MAC
            ? `Apple Metal · 통합메모리 ${(gpu.memTotalMb / 1024).toFixed(1)}GB — ${GIJO_TIERS.find((t) => t.id === recommended)?.desc ?? ""}`
            : `총 VRAM ${(gpu.memTotalMb / 1024).toFixed(1)}GB — ${GIJO_TIERS.find((t) => t.id === recommended)?.desc ?? ""}`
          : "NVIDIA GPU를 찾지 못했습니다(nvidia-smi 없음) — 로컬 LLM 구동 미지원 환경입니다.",
        tiers: GIJO_TIERS,
      });
    })
  );
  // 티어 적용 — app_state 영속 후 채팅 모델 풀을 새 설정(ctx 등)으로 재기동한다. 임베딩 서버는
  // 티어와 무관(고정 8192)하므로 건드리지 않는다. 재기동 완료를 기다리지 않고 바로 응답한다
  // (모델 로드 ~30초 — 화면은 status 폴링으로 준비 상태를 본다).
  app.post(
    "/api/localengine/tier",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const tier = String(req.body?.tier ?? "");
      const spec = GIJO_TIERS.find((t) => t.id === tier);
      if (!spec) {
        res.status(400).json({ error: "tier는 lite·standard·pro 중 하나여야 합니다" });
        return;
      }
      setStateStmt.run("gijoTier", tier);
      console.log(`[localengine] 구동 티어 변경: ${spec.label} (LLM ${spec.maxLoadedModels}개 · ctx ${spec.ctxSize}) — 채팅 모델 풀 재기동`);
      const reloadId = pickAutoStartModelId();
      void stopLocalEngine()
        .then(() => (reloadId ? ensureModelLoaded(reloadId) : undefined))
        .catch((err) => console.warn(`[localengine] 티어 적용 재기동 실패: ${err instanceof Error ? err.message : String(err)}`));
      res.json({ applied: tier, settings: spec, restarting: true });
    })
  );
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
