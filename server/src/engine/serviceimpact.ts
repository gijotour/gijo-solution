// engine/serviceimpact.ts — 서비스 영향도 (자산 → 업무 서비스 의존성 집계)
//
// "이 보안제품/자산에 문제가 생기면 어느 업무 서비스가 영향받는가"를 자동 산출한다. 자산의 service
// 필드로 서비스를 그룹핑하고, 각 서비스의 영향도를 그 서비스에 속한 자산들의 위험 신호로 계산한다:
//  · 자산 위험도(스캔 finding 심각도) · CTI 위협 매칭(ctimatch) · 지연된 유지보수 점검(maintenance).
// 자산·CTI·점검 세 도메인을 서비스 단위로 엮어, 담당자가 "지금 위험한 서비스"를 바로 본다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { listAssets, Asset } from "./assets";
import { listMaintenanceItems } from "./maintenance";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";

export type ImpactLevel = "high" | "mid" | "low" | "none";

export interface ServiceAssetImpact {
  id: string;
  name: string;
  risk: ImpactLevel; // finding 심각도 기반
  ctiThreat: boolean; // CTI 위협에 매칭됨
  overdueInspections: number;
}

export interface ServiceImpact {
  service: string;
  assetCount: number;
  highRiskAssets: number;
  ctiAffectedAssets: number;
  overdueInspections: number;
  impactLevel: ImpactLevel;
  assets: ServiceAssetImpact[];
}

function assetRisk(asset: Asset): ImpactLevel {
  const sev = new Set(asset.findings.map((f) => f.severity));
  if (sev.has("critical") || sev.has("high")) return "high";
  if (sev.has("medium")) return "mid";
  if (asset.findings.length) return "low";
  return "none";
}

const LEVEL_RANK: Record<ImpactLevel, number> = { none: 0, low: 1, mid: 2, high: 3 };

// 순수 함수(테스트 용이): 주어진 자산·CTI 영향 자산·지연점검 집계로 서비스별 영향도를 계산한다.
export function computeServiceImpact(
  assets: Asset[],
  ctiAffectedAssetIds: Set<string>,
  overdueByAsset: Map<string, number>
): { services: ServiceImpact[]; summary: { totalServices: number; atRisk: number; unassignedAssets: number } } {
  const byService = new Map<string, Asset[]>();
  let unassignedAssets = 0;
  for (const a of assets) {
    const svc = a.service?.trim() || "미지정";
    if (!a.service?.trim()) unassignedAssets++;
    if (!byService.has(svc)) byService.set(svc, []);
    byService.get(svc)!.push(a);
  }

  const services: ServiceImpact[] = [];
  for (const [service, svcAssets] of byService) {
    const assetImpacts: ServiceAssetImpact[] = svcAssets.map((a) => ({
      id: a.id,
      name: a.name,
      risk: assetRisk(a),
      ctiThreat: ctiAffectedAssetIds.has(a.id),
      overdueInspections: overdueByAsset.get(a.id) ?? 0,
    }));
    const highRiskAssets = assetImpacts.filter((a) => a.risk === "high").length;
    const ctiAffectedAssets = assetImpacts.filter((a) => a.ctiThreat).length;
    const overdueInspections = assetImpacts.reduce((n, a) => n + a.overdueInspections, 0);

    let impactLevel: ImpactLevel = "none";
    if (highRiskAssets > 0 || ctiAffectedAssets > 0 || overdueInspections > 0) impactLevel = "high";
    else if (assetImpacts.some((a) => a.risk === "mid")) impactLevel = "mid";
    else if (assetImpacts.some((a) => a.risk === "low")) impactLevel = "low";

    services.push({
      service,
      assetCount: svcAssets.length,
      highRiskAssets,
      ctiAffectedAssets,
      overdueInspections,
      impactLevel,
      assets: assetImpacts,
    });
  }

  // 영향도 높은 서비스 먼저. 동률이면 자산 많은 순.
  services.sort((a, b) => LEVEL_RANK[b.impactLevel] - LEVEL_RANK[a.impactLevel] || b.assetCount - a.assetCount);
  return {
    services,
    summary: { totalServices: services.length, atRisk: services.filter((s) => s.impactLevel === "high").length, unassignedAssets },
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 지연(오늘 이하·미완료) 점검을 자산별로 집계한다.
function overdueInspectionsByAsset(): Map<string, number> {
  const t = today();
  const map = new Map<string, number>();
  for (const m of listMaintenanceItems()) {
    if (m.status === "scheduled" && m.scheduleDate <= t && m.assetId) {
      map.set(m.assetId, (map.get(m.assetId) ?? 0) + 1);
    }
  }
  return map;
}

export async function getServiceImpact(): Promise<ReturnType<typeof computeServiceImpact>> {
  const assets = listAssets();
  const ctiFindings = await listFindings();
  const affected = new Set(matchCtiToAssets(ctiFindings, assets).matches.flatMap((m) => m.matchedAssets.map((a) => a.assetId)));
  return computeServiceImpact(assets, affected, overdueInspectionsByAsset());
}

export function registerServiceImpactRoutes(app: Express): void {
  app.get(
    "/api/service-impact",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json(await getServiceImpact());
    })
  );
}
