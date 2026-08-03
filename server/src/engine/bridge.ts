// engine/bridge.ts — 오케스트레이터 ↔ 스캐너 어댑터 브릿지 (서버 측)

import type { Express } from "express";
import { execFile } from "child_process";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { recordProcessOutput } from "./logs";

export interface ScanAdapter {
  id: string;
  name: string;
  run: (assetPath: string) => Promise<StandardFinding[]>;
}

export interface StandardFinding {
  finding_type: string;
  /**
   * ⚠ **info는 취약점이 아니다.** 스캐너가 "무엇이 깔려 있는지" 알아낸 것이다
   *   (Nessus severity 0 = None). 2026-08-04까지 이걸 `low`로 받아 **취약점으로 세고 있었다** —
   *   운영 4,833건 중 1,400여 건이 그것이었고 그 숫자가 임원 보고까지 갔다.
   *   지금은 갈라서 세되 **감추지는 않는다**(scan_error를 다루는 방식과 같다).
   */
  severity: "info" | "low" | "medium" | "high" | "critical";
  evidence: string;
  source_tool: string;
  // 취약점 스캐너가 주면 함께 보관하는 실제 위협 지표(없으면 undefined).
  // severity(CVSS 기반)만으로는 "지금 실제로 털리는 것"이 후순위로 밀리므로 함께 저장한다.
  epss?: number; // 0~1, 30일 내 악용될 확률 (FIRST EPSS)
  vpr?: number; // 0~10, Tenable VPR (실제 위협 기반 우선순위)
  kev?: boolean; // CISA KEV 등재 — 실제로 악용이 확인된 취약점(최우선)
  kevCves?: string[]; // 이 취약점의 CVE 중 KEV에 등재된 것들
  // 재스캔 간 상태 추적(취약점 스캐너 자산 전용). key는 스캔 사이 동일 취약점을 잇는 안정적 식별자.
  key?: string;
  state?: "new" | "active" | "fixed" | "resurfaced";
  // "Fixed"가 인증(credentialed) 재스캔으로 검증됐는지(Tenable §조치 검증 요건). 비인증 스캔에서
  // 사라진 것은 정말 고쳐진 게 아니라 스캐너 가시성이 준 것일 수 있어 신뢰할 수 없다.
  // true=인증 재스캔으로 검증됨, false=비인증이라 미검증(재확인 필요), undefined=인증 여부 불명.
  fixedVerified?: boolean;
}

const adapters: Record<string, ScanAdapter> = {
  modelscan: {
    id: "modelscan",
    name: "ModelScan",
    run: (assetPath) =>
      new Promise((resolve, reject) => {
        recordProcessOutput("modelscan", "log", `$ python modelscan_wrapper.py ${assetPath}`);
        execFile("python", ["modelscan_wrapper.py", assetPath], (err, stdout, stderr) => {
          if (stderr) recordProcessOutput("modelscan", "warn", stderr);
          if (err) {
            recordProcessOutput("modelscan", "error", err.message);
            return reject(err);
          }
          try {
            const findings = JSON.parse(stdout) as StandardFinding[];
            recordProcessOutput("modelscan", "log", `스캔 완료 — ${findings.length}건 발견`);
            resolve(findings);
          } catch (e) {
            reject(e);
          }
        });
      }),
  },
  // penligent: { ... } // TODO: Penligent 어댑터 추가 (2번째 어댑터, 로드맵 Phase 5)
};

export async function runAdapter(adapterId: string, assetPath: string): Promise<StandardFinding[]> {
  const adapter = adapters[adapterId];
  if (!adapter) throw new Error(`unknown adapter: ${adapterId}`);
  return adapter.run(assetPath);
}

/**
 * ModelScan은 **AI 모델 파일**을 뜯어보는 도구다 — IP 호스트나 서비스에는 맞지 않는다.
 *
 * ★ 왜 가리는가(2026-08-03 실측): 전체 자산 스캔이 IP 호스트에도 modelscan을 돌렸고,
 *   매번 `python modelscan_wrapper.py 192.168.219.98`이 실패해 `scan_error` 한 줄을 남겼다.
 *   한 자산에서만 **76번** 그랬다. 2026-08-02 가드가 생기기 전에는 그 한 줄이 진짜 취약점을
 *   덮어썼다 — 자산 46개에서 4,817건이 그렇게 사라졌다.
 *
 *   가드가 덮어쓰기는 막지만, **맞지도 않는 도구를 돌려 실패를 쌓는 것 자체가 잘못**이다.
 *   실패 기록은 "스캐너에 문제가 있다"는 신호인데, 애초에 대상이 아닌 것을 돌려 놓고
 *   실패라 부르면 그 신호가 못 쓰게 된다. 대상이 아니면 **돌리지 않고 그렇게 적는다.**
 */
export function 모델스캔대상인가(assetPath: string): boolean {
  const p = String(assetPath || "").trim().toLowerCase();
  if (!p) return false;
  // IP·호스트명만 적힌 자산(취약점 스캐너가 만든 자산)은 파일이 아니다.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p)) return false;
  return /\.(pkl|pickle|pt|pth|bin|safetensors|h5|onnx|pb|joblib|dill|gguf|ckpt|npz|keras|tflite|pmml)$/.test(p);
}

/**
 * 자산 하나에 모델 스캔을 시도한다 — **부르는 곳은 여기만 본다.**
 * 대상이 아니면 파이썬을 띄우지 않고 `scan_not_supported`로 적는다(실패가 아니라 해당 없음).
 */
export async function 모델스캔(assetPath: string): Promise<StandardFinding[]> {
  if (!모델스캔대상인가(assetPath)) {
    return [{
      finding_type: "scan_not_supported",
      severity: "low",
      evidence: `모델 파일 스캐너(ModelScan)의 대상이 아닙니다 — ${assetPath}. 이 자산은 취약점 스캐너 보고서로 점검합니다.`,
      source_tool: "modelscan",
    }];
  }
  return runAdapter("modelscan", assetPath).catch((err) => [
    { finding_type: "scan_error", severity: "low" as const, evidence: String(err), source_tool: "modelscan" },
  ]);
}

export function listAdapters(): { id: string; name: string }[] {
  return Object.values(adapters).map(({ id, name }) => ({ id, name }));
}

export function registerBridgeRoutes(app: Express): void {
  app.post(
    "/api/bridge/run",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await runAdapter(req.body.adapterId, req.body.assetPath));
    })
  );
  app.get("/api/bridge/adapters", authMiddleware, (_req, res) => res.json(listAdapters()));
}
