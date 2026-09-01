// engine/preflight.ts — 설치 후 준비 상태 자가 진단(고객 self-install).
// "고객이 직접 깔았을 때, 이 머신이 GIJO AS를 제대로 돌릴 준비가 됐는가?"를 항목별로 점검한다.
// GPU·llama-server·모델·시크릿·기본계정 등. 각 항목 pass/warn/fail로 반환해 설치자가 조치하게 한다.

import type { Express } from "express";
import * as fs from "fs";
import * as os from "os";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { llamaBinPath } from "../util/llamabin";
import { gpuMemoryReport } from "../util/unifiedmem";
import { usingDefaultCredential } from "../auth/users";
import { dbCryptStatus } from "./dbcrypt";
// 개발 모드 판정은 **원천 한 곳**에서만 읽는다(util/devmode) — 자리마다 env를 직접 읽으면
// 어느 곳은 켜졌다고, 어느 곳은 꺼졌다고 말하는 날이 온다.
import { 개발모드 } from "../util/devmode";

export interface PreflightCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

function gpuAvailable(): { ok: boolean; detail: string } {
  // macOS(Apple Silicon)는 Metal GPU + 통합메모리를 쓴다 — nvidia-smi가 없어도 정상 구동 환경이다.
  if (process.platform === "darwin") {
    const totalGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(0);
    return { ok: true, detail: `Apple Metal · 통합메모리 ${totalGb}GB` };
  }
  // ⚠ nvidia-smi를 여기서 직접 읽지 않는다. 예전엔 출력을 그대로 detail에 넣어 GB10에서
  //   "NVIDIA GB10, [N/A]"를 띄웠고, **pass로 넘겼다** — 같은 순간 구동 티어는 「GPU 없음」이라
  //   말해 두 화면이 서로 모순됐다(2026-08-11 실측). 판정은 util/unifiedmem.ts 한 곳에서 받는다.
  const 보고 = gpuMemoryReport();
  if (보고.kind === "none") return { ok: false, detail: "nvidia-smi 없음 — GPU 미감지(로컬 LLM이 느리거나 불가)" };
  if (보고.kind === "unified") {
    // 통합메모리(ARM CUDA — GB10·Jetson): GPU 전용 메모리를 따로 셀 수 없다. 시스템 총량을 적는다.
    const totalGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(0);
    return { ok: true, detail: `${보고.name} · 통합메모리 ${totalGb}GB(CPU와 공유 — GPU 전용 메모리 없음)` };
  }
  return { ok: true, detail: `${보고.name} · VRAM ${보고.totalMb} MiB` };
}

export async function runPreflight(): Promise<{ checks: PreflightCheck[]; ready: boolean }> {
  const checks: PreflightCheck[] = [];

  // Node.js 버전 (18+ 필요)
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js", status: major >= 18 ? "pass" : "fail", detail: `v${process.versions.node}${major >= 18 ? "" : " — 18 이상 필요"}` });

  // GPU
  const gpu = gpuAvailable();
  checks.push({ name: process.platform === "darwin" ? "GPU (Metal)" : "GPU (nvidia-smi)", status: gpu.ok ? "pass" : "warn", detail: gpu.detail });

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

  // 저장 암호화(at-rest) — 자가 진단이 **말하지 않으면 없는 일이 된다**.
  //
  // 왜 넣었나(2026-08-09): 새로 설치한 올인원 앱의 DB를 열쇠 없이 그대로 읽었다
  // (마이그레이션 37건·사용자 1명이 평문으로 나왔다). 설계상 암호화는 opt-in이고
  // 설정 화면은 그 상태를 정직하게 보여주지만, **자가 진단은 이 항목을 아예 안 봤다.**
  // 고객은 「이상 없음」을 받고 넘어간다 — 노트북을 잃으면 자산·취약점·감사로그가 그대로 읽힌다.
  //
  // ⚠ fail이 아니라 warn이다. 꺼져 있는 것은 **의도된 기본값**이라, fail로 만들면
  //   모든 새 설치가 ready=false가 되어 「못 쓰는 제품」이라고 거짓말하게 된다
  //   (ready = fail이 하나도 없을 때). 보이게 하되, 과장하지 않는다.
  try {
    const enc = dbCryptStatus();
    checks.push({
      name: "저장 암호화",
      status: enc.encrypted ? "pass" : "warn",
      detail: enc.encrypted
        ? "켜짐 — DB 파일이 밖으로 나가도 열리지 않습니다"
        : enc.enableAvailableHere
          ? "꺼짐 — DB 파일을 가져가면 내용이 그대로 보입니다. 켜기: node scripts/encrypt-db.mjs"
          : "꺼짐 — DB 파일을 가져가면 내용이 그대로 보입니다. 이 설치에는 전환 도구가 없어 지금은 켤 수 없습니다(디스크 암호화로 보호하세요)",
    });
  } catch (e) {
    checks.push({ name: "저장 암호화", status: "warn", detail: "상태 확인 실패: " + (e as Error).message });
  }

  // 🔓 개발 모드 — **출하 전에 반드시 되돌릴 것**을 잊지 않게 하는 항목(2026-09-01 신설).
  //   GIJO_DEV_MODE=1이면 업무정보 등급(기밀·민감) 열람 제한이 통째로 꺼진다(grades.ts).
  //   ⚠ **fail로 둔다.** 저장 암호화(warn)는 「안 켰다」는 선택이지만, 개발 모드는 **제품이
  //     스스로 규칙을 끈 상태**라 그대로 출하되면 통제 없는 제품이 나간다.
  //   ⚠ 끄는 것은 사장님 결정이다 — 이 항목은 **끄라는 명령이 아니라 잊지 말라는 표지**다.
  try {
    const 개발 = 개발모드();
    checks.push({
      name: "개발 모드",
      status: 개발 ? "fail" : "pass",
      detail: 개발
        ? "켜짐 — **업무정보 등급(기밀·민감) 열람 제한이 꺼져 있습니다.** 개발 동안 일부러 푼 것이라면 그대로 두시고, **출하 전에는 반드시** gijo-as.env의 GIJO_DEV_MODE 줄을 지우고 재시작하세요."
        : "꺼짐 — 등급 열람 제한이 정상 작동합니다",
    });
  } catch (e) {
    checks.push({ name: "개발 모드", status: "fail", detail: "상태 확인 실패(모호하면 막는다): " + (e as Error).message });
  }

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
