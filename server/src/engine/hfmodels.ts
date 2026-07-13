// engine/hfmodels.ts — HuggingFace 보안 특화 모델 검색 · 불러오기

import type { Express } from "express";
import { spawn } from "child_process";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";

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

// huggingface-cli(huggingface_hub 패키지)가 PATH에 설치되어 있어야 한다 — 2.3절 다운로드 명령과 동일.
export async function loadHfModel(modelId: string): Promise<{ localPath: string }> {
  const localDir = path.join("models", modelId.replace("/", "__"));
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("huggingface-cli", ["download", modelId, "--local-dir", localDir]);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`huggingface-cli exited with code ${code}`))));
    proc.on("error", reject);
  });
  return { localPath: localDir };
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
      res.json(await loadHfModel(req.body.modelId));
    })
  );
}
