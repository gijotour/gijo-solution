// engine/merge.ts — 보안 LLM 합성(모델 병합) 설정 생성 · 사전 점검 (6.3절 R&D)
//
// 두 보안 특화 LLM(같은 아키텍처·크기)을 SLERP로 병합하는 mergekit 설정을 만들어준다.
// 실제 병합 실행은 mergekit + GPU가 필요하고 fp16 원본(수십 GB)을 받아야 하는 무거운 과정이라
// 앱 안에서 자동 실행하지 않는다(문서 §4.4에서 동결) — 대신 바로 돌릴 수 있는 mergekit 설정(YAML)과
// 실행 명령을 생성하고, 준비물(mergekit·llama.cpp·모델 캐시)을 사전 점검해준다. 학습 루프 preflight와
// 같은 원칙: "환경이 갖춰졌는지 확인하고 실행은 담당자가 GPU 머신에서 직접".

import type { Express } from "express";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import { llamaBinPath } from "../util/llamabin";
import { serverPython } from "../util/pythonbin";
import { SECURITY_LLM_DEX, DexModel } from "./modeldex";

const OUTPUTS_DIR = process.env.GIJO_OUTPUTS_DIR ?? "outputs";
const LLAMA_CPP_DIR = process.env.GIJO_LLAMA_CPP_DIR ?? "llama.cpp";

function findDex(id: string): DexModel | undefined {
  return SECURITY_LLM_DEX.find((m) => m.id === id);
}

// 병합 산출 modelId — 두 모델의 짧은 이름을 이어 소문자/하이픈만 남긴다(GGUF 배치·서빙 id 규칙).
export function mergedModelId(a: DexModel, b: DexModel): string {
  const short = (id: string) => id.split("/").pop() ?? id;
  return `merged-${short(a.id)}-${short(b.id)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

// SLERP mergekit 설정(YAML). 레이어 수는 7B/8B 기준 32를 기본으로 하되 담당자가 모델에 맞게
// 조정하도록 안내한다(모델별로 다를 수 있음). 가중치 t=0.5(구면 선형 보간 중간).
export function buildMergeConfig(a: DexModel, b: DexModel, ratio = 0.5, layers = 32): string {
  return [
    "# GIJO AS 자동 생성 — mergekit SLERP 설정",
    `# ${a.name} + ${b.name} → 보안 특화 합성 모델`,
    "# 주의: layer_range는 모델 레이어 수에 맞게 조정하세요(7B/8B 기본 32).",
    "slices:",
    "  - sources:",
    `      - model: ${a.id}`,
    `        layer_range: [0, ${layers}]`,
    `      - model: ${b.id}`,
    `        layer_range: [0, ${layers}]`,
    "merge_method: slerp",
    `base_model: ${a.id}`,
    "parameters:",
    "  t:",
    `    - value: ${ratio}`,
    "dtype: float16",
    "",
  ].join("\n");
}

export interface MergePlan {
  ok: boolean;
  reason?: string;
  modelA?: DexModel;
  modelB?: DexModel;
  outputModelId?: string;
  config?: string;
  configPath?: string;
  commands?: string[];
}

// 두 모델의 합성 가능 여부를 검증하고(같은 arch·size, 서로 다름), 가능하면 설정 파일을 만들어
// outputs/ 에 저장한 뒤 실행 명령까지 돌려준다.
export function planMerge(idA: string, idB: string): MergePlan {
  const a = findDex(idA);
  const b = findDex(idB);
  if (!a || !b) return { ok: false, reason: "도감에 없는 모델입니다." };
  if (a.id === b.id) return { ok: false, reason: "서로 다른 모델을 선택하세요." };
  if (a.arch !== b.arch || a.size !== b.size) {
    return { ok: false, reason: `아키텍처·크기가 달라 SLERP 합성이 불가합니다 (${a.arch}·${a.size} vs ${b.arch}·${b.size}).` };
  }

  const outputModelId = mergedModelId(a, b);
  const config = buildMergeConfig(a, b);
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
  const configPath = path.join(OUTPUTS_DIR, `merge-${outputModelId}.yml`);
  fs.writeFileSync(configPath, config, "utf-8");

  const mergedDir = path.join(OUTPUTS_DIR, outputModelId, "merged");
  // 변환은 f16 중간 파일(<id>.f16.gguf)로 내고, 양자화가 그걸 읽어 최종 <id>.gguf를 만든다.
  // (예전엔 변환이 <id>.gguf로 바로 써서 양자화 입력 파일명과 어긋났다 — 실행해보고 잡은 버그.)
  const f16Path = `models/${outputModelId}/${outputModelId}.f16.gguf`;
  const commands = [
    `mergekit-yaml ${configPath} ${mergedDir} --cuda`,
    `python ${path.join(LLAMA_CPP_DIR, "convert_hf_to_gguf.py")} ${mergedDir} --outfile ${f16Path} --outtype f16`,
    `${llamaBinPath("llama-quantize", LLAMA_CPP_DIR)} ${f16Path} models/${outputModelId}/${outputModelId}.gguf Q5_K_M`,
  ];
  return { ok: true, modelA: a, modelB: b, outputModelId, config, configPath, commands };
}

// ── 사전 점검(preflight) — 실제 병합 전에 준비물 확인 ─────────────────
export interface MergePreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail?: string;
  hint?: string;
}

function hfHubDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.HF_HUB_CACHE) dirs.push(process.env.HF_HUB_CACHE);
  if (process.env.HF_HOME) dirs.push(path.join(process.env.HF_HOME, "hub"));
  dirs.push(path.join(os.homedir(), ".cache", "huggingface", "hub"));
  return dirs;
}

function isModelCached(modelId: string): boolean {
  const cacheName = "models--" + modelId.replace(/\//g, "--");
  return hfHubDirs().some((hub) => {
    const snap = path.join(hub, cacheName, "snapshots");
    return fs.existsSync(snap) && fs.readdirSync(snap).length > 0;
  });
}

// mergekit 설치 여부 — python 모듈 존재만 빠르게 확인(find_spec, 모듈 로드 안 함).
function mergekitInstalled(): boolean {
  const probe = spawnSync(
    serverPython(),
    ["-c", "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('mergekit') else 1)"],
    { encoding: "utf-8" }
  );
  return probe.status === 0;
}

export function mergePreflight(idA?: string, idB?: string): { checks: MergePreflightCheck[]; ready: boolean } {
  const checks: MergePreflightCheck[] = [];

  const mk = mergekitInstalled();
  checks.push({ key: "mergekit", label: "mergekit 설치", ok: mk, required: true, hint: mk ? undefined : "pip install mergekit" });

  const convertOk = fs.existsSync(path.join(LLAMA_CPP_DIR, "convert_hf_to_gguf.py"));
  const quantizeOk = fs.existsSync(llamaBinPath("llama-quantize", LLAMA_CPP_DIR));
  checks.push({ key: "llama-convert", label: "llama.cpp 변환 스크립트", ok: convertOk, required: true, hint: convertOk ? undefined : "llama.cpp 클론 필요" });
  checks.push({ key: "llama-quantize", label: "llama.cpp 양자화 빌드", ok: quantizeOk, required: true, hint: quantizeOk ? undefined : "llama.cpp 빌드 필요" });

  // 선택한 두 모델의 원본(fp16) 캐시 — 병합은 GGUF가 아니라 HF 원본이 필요하다.
  for (const [slot, id] of [["A", idA], ["B", idB]] as const) {
    if (!id) continue;
    const cached = isModelCached(id);
    checks.push({
      key: `model-${slot}`,
      label: `모델 ${slot} 원본 캐시 (${id})`,
      ok: cached,
      required: true,
      hint: cached ? undefined : `hf download ${id}`,
    });
  }

  const ready = checks.every((c) => c.ok || !c.required);
  return { checks, ready };
}

export function registerMergeRoutes(app: Express): void {
  app.get("/api/merge/preflight", authMiddleware, (req, res) => {
    res.json(mergePreflight(req.query.a as string | undefined, req.query.b as string | undefined));
  });

  app.post("/api/merge/plan", authMiddleware, (req, res) => {
    const { modelA, modelB } = req.body ?? {};
    const plan = planMerge(String(modelA ?? ""), String(modelB ?? ""));
    res.status(plan.ok ? 200 : 400).json(plan);
  });
}
