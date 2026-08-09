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
import { airgapChildEnv } from "./airgap";
import { getModelAuthSecrets } from "./modelauth";

const HF_API_BASE = "https://huggingface.co/api";

export interface HfModelResult {
  id: string;
  format: string;
  tags: string[];
  downloads: number;
}

/**
 * 조회에 붙일 인증 헤더(2026-07-28). 등록된 토큰이 있으면 쓴다.
 * 없어도 공개 저장소는 그대로 보이므로 실패하지 않는다.
 */
function hfHeaders(): Record<string, string> {
  const { token } = getModelAuthSecrets();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function searchHfModels(query: string): Promise<HfModelResult[]> {
  const url = `${HF_API_BASE}/models?search=${encodeURIComponent(query)}&filter=gguf&limit=20`;
  const res = await fetch(url, { headers: hfHeaders() }).catch(() => null);
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
// ⚠ 401/403은 "파일이 없다"가 아니라 "볼 권한이 없다"다 — 구분해서 던져야 담당자가 토큰을 등록한다.
async function fetchRepoGgufFiles(modelId: string): Promise<string[]> {
  const res = await fetch(`${HF_API_BASE}/models/${modelId}`, { headers: hfHeaders() }).catch(() => null);
  // ⚠ HF는 **없는 저장소에도 401**을 준다(존재 자체를 숨긴다). 그래서 "gated다"라고 단정하면
  //    단순 오타를 인증 문제로 오진한다 — 두 가능성을 함께 알린다.
  if (res && (res.status === 401 || res.status === 403)) {
    throw new Error(
      getModelAuthSecrets().token
        ? `이 저장소를 볼 수 없습니다(${res.status}). 저장소 이름이 맞는지, 그리고 HuggingFace에서 이 모델의 라이선스에 동의했는지 확인하세요.`
        : `이 저장소를 볼 수 없습니다(${res.status}). 저장소 이름이 틀렸거나, 라이선스 동의가 필요한(gated) 모델일 수 있습니다 — 후자라면 설정 > 모델 받기·인증에 HuggingFace 토큰을 등록하세요.`
    );
  }
  if (!res || !res.ok) return [];
  const data = (await res.json()) as { siblings?: { rfilename: string }[] };
  return (data.siblings ?? []).map((s) => s.rfilename).filter((f) => /\.gguf$/i.test(f));
}

/**
 * 다운로드 프로세스에 넘길 환경변수(2026-07-28).
 * ⚠ 토큰은 명령 인자가 아니라 **환경변수**로 넘긴다 — 인자로 주면 프로세스 목록(ps)에 그대로 보인다.
 */
export function buildDownloadEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { token, proxyUrl } = getModelAuthSecrets();
  const env: NodeJS.ProcessEnv = { ...base };
  if (token) env.HF_TOKEN = token;
  if (proxyUrl) {
    env.HTTPS_PROXY = proxyUrl;
    env.HTTP_PROXY = proxyUrl;
  }
  // 에어갭 봉인(후-4) — 자식 프로세스는 우리 fetch 관문 **밖**이라 오프라인 스위치로 누른다.
  //   봉인이 아니면 빈 객체라 아무 영향이 없다.
  return { ...env, ...airgapChildEnv() };
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
    // 설정에 등록해 둔 인증 정보를 그대로 쓴다(2026-07-28) — 담당자가 서버에 들어가
    // 'hf auth login'을 칠 일이 없어진다. 없으면 예전처럼 익명으로 받는다.
    // ⚠ 토큰은 인자가 아니라 **환경변수**로 넘긴다. 인자로 주면 프로세스 목록(ps)에 그대로 보인다.
    const { token, proxyUrl } = getModelAuthSecrets();
    const env = buildDownloadEnv();
    recordProcessOutput(
      "hf-download",
      "log",
      `$ ${cli} download ${modelId} ${chosen} --local-dir ${localDir}` +
        `${token ? " (등록된 토큰 사용)" : ""}${proxyUrl ? ` (프록시 ${proxyUrl})` : ""}`
    );
    const proc = spawn(cli, ["download", modelId, chosen, "--local-dir", localDir], { env });
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
  // 권장 모델 목록 — 고객이 「무엇을 받을까」를 고르지 않게 한다(2026-08-10, 시안 승인).
  //
  // ⚠ 목록을 **그대로 믿지 않는다.** 2026-08-08에 추천 카탈로그를 지운 이유가
  //   「추천 모델이 서버에 없는 죽은 안내를 냈다」였다. 그래서 화면에 뿌리기 전에
  //   저장소가 실제로 있는지 확인하고, 확인 못 하면 그 사실을 함께 돌려준다.
  //   ⚠ 확인에 실패해도 **목록을 감추지 않는다** — 사내망에서는 조회가 막혀도
  //     받기(프록시 경유 CLI)는 될 수 있기 때문이다. 상태만 정직하게 붙인다.
  app.get(
    "/api/hfmodels/recommended",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      const { 권장모델목록, 로컬폴더후보 } = await import("./modelcatalog.js");
      const { isModelAvailable } = await import("./localengine.js");
      const 결과 = await Promise.all(
        권장모델목록.map(async (m) => {
          let 확인: "있음" | "없음" | "확인못함" = "확인못함";
          try {
            const r = await fetch(`${HF_API_BASE}/models/${m.repo}`, {
              headers: hfHeaders(),
              signal: AbortSignal.timeout(8_000),
            });
            확인 = r.ok ? "있음" : r.status === 404 ? "없음" : "확인못함";
          } catch {
            확인 = "확인못함"; // 사내망·에어갭 — 못 봤다는 뜻이지 없다는 뜻이 아니다
          }
          // ⚠ 이름이 **한 가지가 아니다.** 받기가 만드는 `org__repo`와, 운영에 실제로 있는
          //   짧은 이름(qwen3-14b·bge-m3)을 다 본다 — 하나만 보면 이미 가진 모델에 「받기」가
          //   떠서 8.4GB를 다시 받게 된다(2026-08-10 실측으로 잡음).
          return {
            ...m,
            저장소확인: 확인,
            이미받음: 로컬폴더후보(m.repo).some((n) => isModelAvailable(n)),
          };
        })
      );
      res.json(결과);
    })
  );
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
