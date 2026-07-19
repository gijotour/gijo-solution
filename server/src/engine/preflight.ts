// engine/preflight.ts — 설치 후 준비 상태 자가 진단(고객 self-install).
// "고객이 직접 깔았을 때, 이 머신이 GIJO AS를 제대로 돌릴 준비가 됐는가?"를 항목별로 점검한다.
// GPU·llama-server·모델·시크릿·기본계정 등. 각 항목 pass/warn/fail로 반환해 설치자가 조치하게 한다.

import type { Express } from "express";
import * as fs from "fs";
import { execFileSync } from "child_process";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { llamaBinPath } from "../util/llamabin";
import { usingDefaultCredential } from "../auth/users";

export interface PreflightCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

function gpuAvailable(): { ok: boolean; detail: string } {
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { timeout: 5000 }).toString().trim();
    return { ok: true, detail: out.split("\n")[0] || "GPU 감지" };
  } catch {
    return { ok: false, detail: "nvidia-smi 없음 — GPU 미감지(로컬 LLM이 느리거나 불가)" };
  }
}

export async function runPreflight(): Promise<{ checks: PreflightCheck[]; ready: boolean }> {
  const checks: PreflightCheck[] = [];

  // Node.js 버전 (18+ 필요)
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js", status: major >= 18 ? "pass" : "fail", detail: `v${process.versions.node}${major >= 18 ? "" : " — 18 이상 필요"}` });

  // GPU
  const gpu = gpuAvailable();
  checks.push({ name: "GPU (nvidia-smi)", status: gpu.ok ? "pass" : "warn", detail: gpu.detail });

  // llama-server 바이너리 — env 미설정이면 플랫폼별 기본 경로(win: Release/*.exe, linux: */name)를 점검한다.
  const llamaPath = process.env.GIJO_LLAMA_SERVER_PATH ?? llamaBinPath("llama-server");
  checks.push({ name: "llama-server", status: fs.existsSync(llamaPath) ? "pass" : "fail", detail: fs.existsSync(llamaPath) ? llamaPath : `경로에 파일 없음: ${llamaPath}` });

  // 모델 존재 + 상업 번들 안전 개수
  try {
    const { listAvailableModels } = await import("./localengine.js");
    const { classifyAvailableModels } = await import("./modellicense.js");
    const ids = listAvailableModels().map((m) => m.id);
    if (ids.length === 0) {
      checks.push({ name: "로컬 모델", status: "fail", detail: "models/ 에 채팅 모델(.gguf) 없음 — 최소 1개 필요(BYOM)" });
    } else {
      const { summary } = classifyAvailableModels(ids);
      checks.push({ name: "로컬 모델", status: "pass", detail: `${ids.length}개 (상업번들 안전 ${summary.bundleSafe}, BYOM ${summary.byom})` });
    }
  } catch (e) {
    checks.push({ name: "로컬 모델", status: "warn", detail: "모델 목록 확인 실패: " + (e as Error).message });
  }

  // JWT 시크릿 (운영에서 기본 개발용이면 위험)
  const jwtSet = Boolean(process.env.GIJO_JWT_SECRET);
  const isProd = process.env.NODE_ENV === "production";
  checks.push({
    name: "JWT 시크릿",
    status: jwtSet ? "pass" : isProd ? "fail" : "warn",
    detail: jwtSet ? "설정됨" : isProd ? "미설정 — 운영에서 필수(서버가 뜨지 않음)" : "미설정(개발 기본값 사용)",
  });

  // 기본 계정 사용 여부 (self-install 최대 보안 위험)
  const usingDefault = usingDefaultCredential();
  checks.push({
    name: "기본 관리자 비밀번호",
    status: usingDefault ? "fail" : "pass",
    detail: usingDefault ? "기본 비밀번호(changeme)가 그대로 — 즉시 변경 필요" : "기본 비밀번호 아님(양호)",
  });

  // 데이터 디렉토리 쓰기 가능
  try {
    const probe = "data/.preflight-probe";
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    checks.push({ name: "데이터 저장소", status: "pass", detail: "data/ 쓰기 가능" });
  } catch {
    checks.push({ name: "데이터 저장소", status: "fail", detail: "data/ 쓰기 불가 — 권한·경로 확인" });
  }

  const ready = !checks.some((c) => c.status === "fail");
  return { checks, ready };
}

export function registerPreflightRoutes(app: Express): void {
  // 설치 후 준비 상태 진단 — 관리자 전용.
  app.get("/api/admin/preflight", authMiddleware, adminMiddleware, async (_req, res) => {
    res.json(await runPreflight());
  });
}
