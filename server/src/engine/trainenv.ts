// engine/trainenv.ts — **학습(LoRA) 실행 환경을 결정하는 단 한 곳.**
//
// ■ 왜 생겼나 — 원클릭 루프가 "준비물이 없다"며 죽었다(2026-08-08 실사고)
//   루프의 세 단계(사전 점검 · 학습 · GGUF 변환)가 **각자 다른 파이썬**을 부르고 있었다.
//   셋 다 그냥 `python`이라 서버 자신의 가상환경(server/venv)이 잡혔는데, 학습에 필요한
//   것들은 거기 없다. 실제 학습 환경은 따로 있다(venv-train — 1회전에서 어댑터를 실제로
//   구워낸 환경). 화면은 "pip install unsloth"라고 안내했지만 그건 **낡은 처방**이다:
//   지금 쓰는 학습 스크립트(finetune_qlora14b.py)는 unsloth 없이 transformers+peft로 돈다.
//   설치해도 다음 단계에서 또 막혔을 것이다.
//
// ■ 그래서 규칙 — 학습 관련 파이썬·경로는 **여기서만** 정한다.
//   호출부가 저마다 "python"이라 적으면 이 사고가 그대로 재발한다. 세 곳(finetune.spawnTraining ·
//   learnloop.runAdapterExport · learnloop.preflightCheck)이 전부 이 모듈을 거치는지는
//   server/test/trainenv.test.ts가 **소스를 읽어** 지킨다(함수를 만들어도 안 부르면 소용없다).

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

/** 학습 스크립트 — unsloth 없이 도는 현행 경로(구 finetune_unsloth.py는 은퇴). */
export const TRAIN_SCRIPT = path.join("scripts", "finetune_qlora14b.py");

/**
 * 학습 전용 파이썬. 우선순위:
 *   ① GIJO_TRAIN_PYTHON(운영자가 지정) → ② venv-train(관례 위치) → ③ python(마지막 폴백)
 * ③으로 떨어지면 십중팔구 의존성이 없어 실패하지만, **거짓으로 성공한 척하지 않는다** —
 * 사전 점검이 어느 파이썬을 봤는지 detail에 적어 담당자가 원인을 바로 본다.
 */
export function trainPython(): string {
  const fromEnv = process.env.GIJO_TRAIN_PYTHON;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const dir of trainVenvDirs()) {
    const bin = process.platform === "win32"
      ? path.join(dir, "Scripts", "python.exe")
      : path.join(dir, "bin", "python");
    if (fs.existsSync(bin)) return bin;
  }
  return "python";
}

/** venv-train 후보 위치 — 서버 작업 디렉터리 기준(운영 WSL: /home/gijo/gijo-as/venv-train). */
function trainVenvDirs(): string[] {
  return [path.join(process.cwd(), "venv-train"), path.join(process.cwd(), "..", "venv-train")];
}

/** 지금 쓰는 학습 경로가 **실제로** 필요로 하는 것들(unsloth는 여기 없다 — 안 쓴다). */
export const TRAIN_DEPS = [
  { key: "torch", label: "torch (CUDA)" },
  { key: "transformers", label: "transformers" },
  { key: "peft", label: "peft (LoRA)" },
  { key: "bitsandbytes", label: "bitsandbytes (4bit)" },
  { key: "gguf", label: "gguf (GGUF 변환)" },
] as const;

/**
 * 학습 파이썬에 의존성이 있는지 — find_spec으로만 본다(모듈을 실제로 로드하면 CUDA 초기화까지
 * 일어나 사전 점검이 수 초간 멈추고, GPU를 잡아 학습과 충돌할 수 있다).
 */
export function probeTrainDeps(python = trainPython()): Record<string, boolean> {
  const keys = TRAIN_DEPS.map((d) => d.key);
  const code =
    "import importlib.util as u,json;print(json.dumps({" +
    keys.map((k) => `'${k}':u.find_spec('${k}') is not None`).join(",") +
    "}))";
  const probe = spawnSync(python, ["-c", code], { encoding: "utf-8" });
  try {
    const parsed = JSON.parse((probe.stdout || "").trim()) as Record<string, boolean>;
    return Object.fromEntries(keys.map((k) => [k, !!parsed[k]]));
  } catch {
    return Object.fromEntries(keys.map((k) => [k, false]));
  }
}

/** HF 허브 캐시 후보 — 학습 베이스 가중치가 받아져 있는 곳. */
export function hfHubDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.HF_HUB_CACHE) dirs.push(process.env.HF_HUB_CACHE);
  if (process.env.HF_HOME) dirs.push(path.join(process.env.HF_HOME, "hub"));
  dirs.push(path.join(os.homedir(), ".cache", "huggingface", "hub"));
  return dirs;
}

/**
 * 베이스 모델의 **스냅샷 폴더 실경로**. GGUF 변환(convert_lora_to_gguf.py)이 `--base`로
 * config.json이 든 폴더를 요구한다 — 리포지터리 id(Qwen/Qwen3-14B)를 그대로 주면
 * 네트워크를 타려 하고, 폐쇄망에선 그대로 실패한다(1회전에서 실경로로 넘겨 통과시킨 길).
 */
export function hfSnapshotDir(baseModel: string): string | null {
  const cacheName = "models--" + baseModel.replace(/\//g, "--");
  for (const hub of hfHubDirs()) {
    const snapRoot = path.join(hub, cacheName, "snapshots");
    if (!fs.existsSync(snapRoot)) continue;
    // 스냅샷은 커밋 해시 폴더다. config.json이 실제로 있는 것만 고른다(빈 폴더 방어).
    const withConfig = fs
      .readdirSync(snapRoot)
      .map((d) => path.join(snapRoot, d))
      .filter((d) => fs.existsSync(path.join(d, "config.json")));
    if (withConfig.length) return withConfig[0];
  }
  return null;
}

/** 베이스 가중치가 캐시에 있는가(사전 점검) — 스냅샷 실경로가 잡히면 있는 것이다. */
export function isBaseModelCached(baseModel: string): boolean {
  return hfSnapshotDir(baseModel) !== null;
}

/**
 * 학습이 HF LoRA를 떨구는 자리 = 변환이 읽어 가는 자리. **두 단계가 같은 상수를 봐야 한다** —
 * 예전엔 학습은 `--output`을 받고 변환은 `outputs/<ds>/lora-adapter`를 가정해, 배선이
 * 어긋나 있어도 학습이 먼저 죽는 바람에 아무도 몰랐다.
 */
export function adapterWorkDir(datasetId: string): string {
  return path.join("outputs", datasetId, "lora-adapter");
}
