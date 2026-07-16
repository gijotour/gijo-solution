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
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
  source_tool: string;
  // 취약점 스캐너가 주면 함께 보관하는 실제 위협 지표(없으면 undefined).
  // severity(CVSS 기반)만으로는 "지금 실제로 털리는 것"이 후순위로 밀리므로 함께 저장한다.
  epss?: number; // 0~1, 30일 내 악용될 확률 (FIRST EPSS)
  vpr?: number; // 0~10, Tenable VPR (실제 위협 기반 우선순위)
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
