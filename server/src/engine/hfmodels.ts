// engine/hfmodels.ts — HuggingFace 보안 특화 모델 검색 · 불러오기
//
// 다운로드는 huggingface_hub CLI를 쓴다. 1.x부터 `huggingface-cli`가 폐기되고 `hf`로 바뀌었으므로
// `hf`를 우선 사용하고, 없으면(구버전) `huggingface-cli`로 폴백한다.
// GGUF 저장소는 여러 양자화본이 들어 있으므로 저장소 전체가 아니라 단일 파일(Q4_K_M 우선) 하나만
// 받고, 로컬 LLM 로더가 인식하는 이름(models/<id>/<id>.gguf)으로 배치한다.

import type { Express } from "express";
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

export async function loadHfModel(modelId: string): Promise<{ localPath: string; file: string }> {
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
      stderr += String(d);
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
  app.post(
    "/api/hfmodels/load",
    authMiddleware,
    asyncRoute(async (req, res) => {
      try {
        res.json(await loadHfModel(req.body.modelId));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
}
