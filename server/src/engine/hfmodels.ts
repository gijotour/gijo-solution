// engine/hfmodels.ts — HuggingFace 보안 특화 모델 검색 · 불러오기
//
// 다운로드는 huggingface_hub CLI를 쓴다. 1.x부터 `huggingface-cli`가 폐기되고 `hf`로 바뀌었으므로
// `hf`를 우선 사용하고, 없으면(구버전) `huggingface-cli`로 폴백한다.
// GGUF 저장소는 여러 양자화본이 들어 있으므로 저장소 전체가 아니라 단일 파일(Q4_K_M 우선) 하나만
// 받고, 로컬 LLM 로더가 인식하는 이름(models/<id>/<id>.gguf)으로 배치한다.
//
// 다운로드는 비동기 큐로 처리한다(finetune.ts와 같은 패턴): POST /load는 큐에 넣고 즉시
// 잡을 반환하며, 실제 전송은 백그라운드에서 진행되고 진행률은 WebSocket(hf-download:progress)으로
// 브로드캐스트한다. HTTP 요청 하나에 다운로드 전체를 묶어두지 않으므로 클라이언트가 페이지를
// 이동하거나 다른 작업을 해도 다운로드는 계속된다. 동시 대역폭 경쟁을 피하려고 한 번에 하나씩만 받는다.

import type { Express } from "express";
import type { WebSocketServer } from "ws";
import { spawn, spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { attachProcessLogging, recordProcessOutput } from "./logs";

const HF_API_BASE = "https://huggingface.co/api";

export interface HfModelResult {
  id: string;
  format: string;
  tags: string[];
  downloads: number;
}

export async function searchHfModels(query: string): Promise<HfModelResult[]> {
  const url = `${HF_API_BASE}/models?search=${encodeURIComponent(query)}&filter=gguf&limit=20`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return [];
  const data = (await res.json()) as { id: string; tags?: string[]; downloads?: number }[];
  return data.map((m) => ({
    id: m.id,
    format: m.tags?.includes("gguf") ? "GGUF" : "unknown",
    tags: m.tags ?? [],
    downloads: m.downloads ?? 0,
  }));
}

// 저장소에 들어 있는 .gguf 파일 목록 (HF 모델 info의 siblings).
async function fetchRepoGgufFiles(modelId: string): Promise<string[]> {
  const res = await fetch(`${HF_API_BASE}/models/${modelId}`).catch(() => null);
  if (!res || !res.ok) return [];
  const data = (await res.json()) as { siblings?: { rfilename: string }[] };
  return (data.siblings ?? []).map((s) => s.rfilename).filter((f) => /\.gguf$/i.test(f));
}

// 분할(-00001-of-000NN) 파일인지.
const SHARD_RE = /-\d{4,5}-of-\d{4,5}\.gguf$/i;

// 받을 양자화본 하나를 고른다: 단일 파일 우선, 그중 Q4_K_M > Q4 > Q5 > Q8 … 순.
export function pickGgufFile(files: string[]): string | null {
  if (files.length === 0) return null;
  const single = files.filter((f) => !SHARD_RE.test(f));
  const pool = single.length ? single : files;
  const prefs = [/Q4_K_M\.gguf$/i, /Q4_K_S\.gguf$/i, /Q4_0\.gguf$/i, /Q5_K_M\.gguf$/i, /Q4/i, /Q5/i, /Q6/i, /Q8/i, /Q3/i, /Q2/i];
  for (const re of prefs) {
    const hit = pool.find((f) => re.test(f));
    if (hit) return hit;
  }
  return pool[0];
}

// `hf`(신규) 우선, 없으면 `huggingface-cli`(구버전). huggingface_hub 1.x는 huggingface-cli가 폐기됨.
let cachedCli: string | null = null;
function resolveHfCli(): string {
  if (cachedCli) return cachedCli;
  for (const cli of ["hf", "huggingface-cli"]) {
    try {
      if (spawnSync(cli, ["--version"], { encoding: "utf-8" }).status === 0) {
        cachedCli = cli;
        return cli;
      }
    } catch {
      /* 다음 후보 */
    }
  }
  cachedCli = "hf";
  return cachedCli;
}

function hfDownloadError(code: number | null, stderr: string): string {
  const tail = stderr.split("\n").filter((l) => l.trim()).slice(-4).join(" ").slice(-300);
  if (/401|403|gated|awaiting|access|you must|token|authenticate|permission/i.test(stderr)) {
    return `접근 권한이 필요한(gated) 모델입니다. HuggingFace 페이지에서 라이선스에 동의하고 'hf auth login'으로 토큰 로그인 후 다시 시도하세요. ${tail}`;
  }
  if (/proxy|SSL|connection|timed out|network|resolve/i.test(stderr)) {
    return `네트워크/프록시 문제로 다운로드에 실패했습니다. ${tail}`;
  }
  return `다운로드 실패 (code ${code}). ${tail}`;
}

// tqdm 진행률 바 형식(예: "model.Q4_K_M.gguf: 34%|███▍ | 512M/1.50G [00:20<00:38, 25.1MB/s]")에서
// 퍼센트만 뽑는다. \r로 같은 줄을 반복 갱신하므로 청크 하나에 여러 갱신이 들어있을 수 있어
// 마지막 값을 쓴다.
const PROGRESS_RE = /(\d{1,3})%\|/g;

async function runHfDownload(modelId: string, onProgress: (pct: number) => void): Promise<{ localPath: string; file: string }> {
  const dirName = modelId.replace(/\//g, "__");
  const localDir = path.join("models", dirName);

  const ggufFiles = await fetchRepoGgufFiles(modelId);
  const chosen = pickGgufFile(ggufFiles);
  if (!chosen) {
    throw new Error("이 저장소에서 받을 .gguf 파일을 찾지 못했습니다. GGUF 형식 저장소인지 확인하세요.");
  }
  if (SHARD_RE.test(chosen)) {
    throw new Error(`이 모델은 여러 조각으로 분할된 대용량 GGUF뿐입니다(${chosen}). 단일 파일 양자화본이 있는 더 작은 모델을 선택하세요.`);
  }

  const cli = resolveHfCli();
  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    recordProcessOutput("hf-download", "log", `$ ${cli} download ${modelId} ${chosen} --local-dir ${localDir}`);
    const proc = spawn(cli, ["download", modelId, chosen, "--local-dir", localDir]);
    attachProcessLogging(proc, "hf-download");
    proc.stderr?.on("data", (d) => {
      const text = String(d);
      stderr += text;
      let lastPct: number | null = null;
      let match: RegExpExecArray | null;
      PROGRESS_RE.lastIndex = 0;
      while ((match = PROGRESS_RE.exec(text))) lastPct = Number(match[1]);
      if (lastPct !== null) onProgress(Math.min(99, lastPct)); // 100%는 배치까지 끝나야 확정
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(hfDownloadError(code, stderr)))));
    proc.on("error", (err) =>
      reject(
        new Error(
          /ENOENT/.test(err.message)
            ? "huggingface CLI(hf)를 찾을 수 없습니다. 'pip install -U huggingface_hub'로 설치 후 다시 시도하세요."
            : err.message
        )
      )
    );
  });

  // 로더가 인식하는 이름으로 배치: models/<dir>/<dir>.gguf
  const target = path.join(localDir, `${dirName}.gguf`);
  let src = path.join(localDir, chosen);
  if (!fs.existsSync(src)) src = findGgufIn(localDir) ?? src; // hf가 다른 하위경로에 뒀을 때 대비
  if (!fs.existsSync(src)) {
    throw new Error("다운로드가 끝났지만 gguf 파일을 찾지 못했습니다. models 폴더를 확인하세요.");
  }
  if (path.resolve(src) !== path.resolve(target)) {
    fs.renameSync(src, target);
  }
  recordProcessOutput("hf-download", "log", `배치 완료: ${target}`);
  return { localPath: target, file: chosen };
}

// ── 다운로드 큐 ───────────────────────────────────────────────────────
// finetune.ts와 같은 패턴: 백그라운드에서 실행하고 WebSocket으로 진행률을 밀어준다.
// 다만 다운로드는 여러 개를 요청받을 수 있으므로(검색 결과에서 연달아 클릭 등) 잡 큐를 둔다.

export type HfDownloadStatus = "queued" | "downloading" | "done" | "error";

export interface HfDownloadJob {
  id: string;
  modelId: string;
  file?: string;
  status: HfDownloadStatus;
  progress: number;
  error?: string;
  localPath?: string;
  createdAt: number;
  updatedAt: number;
}

let wss: WebSocketServer | null = null;
export function attachHfModelsSocket(server: WebSocketServer): void {
  wss = server;
}

function broadcastJob(job: HfDownloadJob): void {
  wss?.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(JSON.stringify({ channel: "hf-download:progress", payload: job }));
    }
  });
}

const jobs = new Map<string, HfDownloadJob>();
const queue: string[] = [];
let processingQueue = false;

function updateJob(job: HfDownloadJob, patch: Partial<HfDownloadJob>): void {
  Object.assign(job, patch, { updatedAt: Date.now() });
  broadcastJob(job);
}

export function enqueueHfDownload(modelId: string): HfDownloadJob {
  const id = `hf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job: HfDownloadJob = { id, modelId, status: "queued", progress: 0, createdAt: Date.now(), updatedAt: Date.now() };
  jobs.set(id, job);
  queue.push(id);
  broadcastJob(job);
  void processQueue();
  return job;
}

export function getHfDownloadJob(id: string): HfDownloadJob | undefined {
  return jobs.get(id);
}

export function listHfDownloadJobs(): HfDownloadJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

// 대역폭 경쟁을 피하려고 한 번에 하나씩만 받는다 — GPU 1대를 독점하는 finetune과 같은 이유.
async function processQueue(): Promise<void> {
  if (processingQueue) return;
  processingQueue = true;
  try {
    let nextId: string | undefined;
    while ((nextId = queue.shift()) !== undefined) {
      const job = jobs.get(nextId);
      if (!job) continue;
      updateJob(job, { status: "downloading" });
      try {
        const result = await runHfDownload(job.modelId, (progress) => updateJob(job, { progress }));
        updateJob(job, { status: "done", progress: 100, file: result.file, localPath: result.localPath });
      } catch (err) {
        updateJob(job, { status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    processingQueue = false;
  }
}

// localDir(하위 포함)에서 첫 .gguf 파일 경로를 찾는다.
function findGgufIn(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findGgufIn(full);
      if (found) return found;
    } else if (/\.gguf$/i.test(entry.name)) {
      return full;
    }
  }
  return null;
}

export function registerHfModelsRoutes(app: Express): void {
  app.get(
    "/api/hfmodels/search",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await searchHfModels(String(req.query.q ?? "")));
    })
  );
  // 큐에 넣고 즉시 잡을 반환한다 — 실제 다운로드는 백그라운드에서 진행되며 진행률은
  // hf-download:progress WebSocket 채널로 밀어준다. 진행 중 페이지를 이동해도 계속된다.
  app.post("/api/hfmodels/load", authMiddleware, (req, res) => {
    const modelId = String(req.body?.modelId ?? "").trim();
    if (!modelId) {
      res.status(400).json({ error: "modelId가 필요합니다" });
      return;
    }
    res.status(202).json(enqueueHfDownload(modelId));
  });
  app.get("/api/hfmodels/jobs", authMiddleware, (_req, res) => {
    res.json(listHfDownloadJobs());
  });
  app.get("/api/hfmodels/jobs/:id", authMiddleware, (req, res) => {
    const job = getHfDownloadJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: "해당 다운로드 작업을 찾을 수 없습니다" });
      return;
    }
    res.json(job);
  });
}
