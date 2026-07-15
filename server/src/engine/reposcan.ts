// engine/reposcan.ts — 코드 저장소(GitHub/GitLab) AI 종속성 정적 스캔 → 자산 자동 등록
//
// 다음단계 3.6(자립형 AI 자산 탐지)의 온프레미스 경로: 벤더 SaaS에 데이터를 보내지 않고,
// 사내 코드 저장소를 직접 훑어 AI 라이브러리 의존성이 있는 repo를 "개발형 AI 자산"으로 등록한다.
// GitHub는 api.github.com, 온프레미스 GitLab/GitHub Enterprise는 baseUrl로 지정한다.
// 토큰은 이 요청 1회 스캔에만 쓰고 저장하지 않는다(비밀 최소 보관 원칙).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { registerAsset, Asset, AssetComponent } from "./assets";
import { recordProcessOutput } from "./logs";

// 의존성 파일에서 이 이름들이 보이면 그 repo는 AI 자산으로 본다(소문자 부분일치).
const AI_LIBRARIES = [
  "openai", "anthropic", "langchain", "langgraph", "llama-index", "llama_index", "llamaindex",
  "transformers", "huggingface_hub", "huggingface-hub", "sentence-transformers", "accelerate",
  "torch", "tensorflow", "keras", "jax", "onnxruntime", "vllm", "ollama", "litellm",
  "cohere", "google-generativeai", "google-genai", "mistralai", "groq", "replicate",
  "autogen", "pyautogen", "crewai", "semantic-kernel", "haystack-ai", "guidance", "instructor",
  "dspy", "dspy-ai", "unsloth", "peft", "trl", "bitsandbytes", "faiss-cpu", "faiss-gpu",
  "chromadb", "lancedb", "pinecone-client", "weaviate-client", "qdrant-client",
];

const DEP_FILES = ["requirements.txt", "package.json", "pyproject.toml", "environment.yml", "Pipfile"];

export interface RepoScanArgs {
  provider: "github" | "gitlab";
  owner: string; // GitHub: org/user, GitLab: group/namespace
  token?: string;
  baseUrl?: string; // 온프레미스: 예 https://gitlab.mycorp.local
  maxRepos?: number;
}

export interface RepoScanResult {
  scanned: number;
  registered: number;
  assets: Asset[];
}

function matchAiLibs(text: string): string[] {
  const low = text.toLowerCase();
  return AI_LIBRARIES.filter((lib) => low.includes(lib));
}

// ── GitHub ───────────────────────────────────────────────────────────────
async function githubFetch(url: string, token?: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "gijo-as-reposcan",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
}

async function githubListRepos(base: string, owner: string, token: string | undefined, max: number): Promise<{ name: string; url: string }[]> {
  // org 우선, 404면 user로 폴백
  for (const kind of ["orgs", "users"]) {
    const res = await githubFetch(`${base}/${kind}/${owner}/repos?per_page=${Math.min(max, 100)}&sort=updated`, token);
    if (res.ok) {
      const list = (await res.json()) as { name: string; html_url: string }[];
      return list.slice(0, max).map((r) => ({ name: r.name, url: r.html_url }));
    }
    if (res.status !== 404) throw new Error(`GitHub API ${res.status} (${kind}/${owner})`);
  }
  throw new Error(`GitHub에서 ${owner}를 org/user 어느 쪽으로도 찾지 못했습니다`);
}

async function githubReadDepFiles(base: string, owner: string, repo: string, token: string | undefined): Promise<string> {
  let combined = "";
  for (const file of DEP_FILES) {
    const res = await githubFetch(`${base}/repos/${owner}/${repo}/contents/${file}`, token);
    if (!res.ok) continue;
    const body = (await res.json()) as { content?: string; encoding?: string };
    if (body.content && body.encoding === "base64") {
      combined += "\n" + Buffer.from(body.content, "base64").toString("utf-8");
    }
  }
  return combined;
}

export async function scanRepositories(args: RepoScanArgs): Promise<RepoScanResult> {
  if (args.provider !== "github") {
    // GitLab은 API 형태가 달라(별도 어댑터 필요) 아직 미지원 — 정직하게 막는다.
    throw new Error("현재 GitHub만 지원합니다 (GitLab 어댑터는 로드맵). baseUrl로 GitHub Enterprise는 가능합니다.");
  }
  const base = (args.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const max = args.maxRepos ?? 50;
  recordProcessOutput("reposcan", "log", `$ reposcan github ${args.owner} (base=${base}, max=${max})`);

  const repos = await githubListRepos(base, args.owner, args.token, max);
  recordProcessOutput("reposcan", "log", `저장소 ${repos.length}개 조회 — 의존성 파일 분석 시작`);

  const assets: Asset[] = [];
  for (const repo of repos) {
    let deps = "";
    try {
      deps = await githubReadDepFiles(base, args.owner, repo.name, args.token);
    } catch (err) {
      recordProcessOutput("reposcan", "warn", `${repo.name}: 의존성 조회 실패 — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const libs = matchAiLibs(deps);
    if (libs.length === 0) continue; // AI 라이브러리 없는 repo는 자산으로 등록하지 않는다

    const components: AssetComponent[] = libs.map((name) => ({ name, version: "-", license: "-" }));
    const asset = registerAsset({
      id: `repo:${args.owner}/${repo.name}`,
      name: repo.name,
      path: repo.url,
      assetType: "dev-ai",
      owner: args.owner,
      components,
    });
    assets.push(asset);
    recordProcessOutput("reposcan", "log", `✓ ${repo.name} — AI 종속성 ${libs.length}종 발견 (${libs.join(", ")})`);
  }

  recordProcessOutput("reposcan", "log", `스캔 완료 — 저장소 ${repos.length}개 중 ${assets.length}개를 AI 자산으로 등록`);
  return { scanned: repos.length, registered: assets.length, assets };
}

export function registerRepoScanRoutes(app: Express): void {
  app.post(
    "/api/reposcan",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { provider, owner, token, baseUrl, maxRepos } = req.body as RepoScanArgs;
      if (!owner) {
        res.status(400).json({ error: "owner(조직 또는 사용자명)가 필요합니다" });
        return;
      }
      try {
        res.json(await scanRepositories({ provider: provider ?? "github", owner, token, baseUrl, maxRepos }));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
}
