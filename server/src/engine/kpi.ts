// engine/kpi.ts — 통합 보안 KPI 대시보드 (여러 도메인 지표를 한곳에 모으고 일일 스냅샷으로 추세)
//
// 자산 위험도·유지보수 점검·finding 승인·CTI 자산영향·컴플라이언스·학습 활동을 각 엔진의 기존
// 목록/요약 함수로 집계해 하나의 스냅샷으로 만든다(별도 수집 로직 없음 — 재사용). 매일 한 번
// security_kpi_snapshots에 저장(하루 한 행)해 시계열 추세를 만든다. "KPI로 향후 방향성 결정"을
// 지원하는 임원/팀장용 통합 뷰.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import { listAssets } from "./assets";
import { listMaintenanceItems } from "./maintenance";
import { maintenanceSummary } from "./report";
import { listFindingReviews, approvalSummary } from "./approvals";
import { listCompliance } from "./compliance";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { listLearnloopRuns } from "./learnloop";

export interface KpiSnapshot {
  date: string; // YYYY-MM-DD
  at: number;
  assets: { total: number; highRisk: number; midRisk: number; lowRisk: number };
  findings: { total: number; pending: number; approved: number; rejected: number };
  inspections: { total: number; overdue: number; pendingApproval: number; approved: number; rejected: number };
  cti: { totalFindings: number; matchedFindings: number; affectedAssets: number; criticalMatches: number };
  compliance: { total: number; covered: number; coverageRate: number };
  learning: { totalRuns: number; deployedModels: number };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// 자산 위험도 등급: critical/high finding이 하나라도 있으면 고위험, medium만 있으면 중위험, 그 외 저위험.
function riskCounts(): { total: number; highRisk: number; midRisk: number; lowRisk: number } {
  let highRisk = 0;
  let midRisk = 0;
  let lowRisk = 0;
  const assets = listAssets();
  for (const a of assets) {
    const sev = new Set(a.findings.map((f) => f.severity));
    if (sev.has("critical") || sev.has("high")) highRisk++;
    else if (sev.has("medium")) midRisk++;
    else lowRisk++;
  }
  return { total: assets.length, highRisk, midRisk, lowRisk };
}

export async function computeKpiSnapshot(): Promise<KpiSnapshot> {
  const assets = listAssets();

  const reviews = listFindingReviews();
  const fa = approvalSummary(reviews);

  const items = listMaintenanceItems();
  const ms = maintenanceSummary(items);

  const ctiFindings = await listFindings();
  const cti = matchCtiToAssets(ctiFindings, assets).summary;

  const compliance = listCompliance();
  const covered = compliance.filter((c) => c.status === "covered").length;
  const applicable = compliance.filter((c) => c.status !== "na").length;

  const runs = listLearnloopRuns();

  return {
    date: todayStr(),
    at: Date.now(),
    assets: riskCounts(),
    findings: { total: fa.total, pending: fa.pending, approved: fa.approved, rejected: fa.rejected },
    inspections: {
      total: ms.total,
      overdue: ms.overdue,
      pendingApproval: ms.reported,
      approved: ms.approved,
      rejected: ms.rejected,
    },
    cti: {
      totalFindings: cti.totalFindings,
      matchedFindings: cti.matchedFindings,
      affectedAssets: cti.affectedAssets,
      criticalMatches: cti.criticalMatches,
    },
    compliance: {
      total: compliance.length,
      covered,
      coverageRate: applicable ? Math.round((covered / applicable) * 100) : 0,
    },
    learning: {
      totalRuns: runs.length,
      deployedModels: runs.filter((r) => r.stage === "done").length,
    },
  };
}

const upsertSnapshotStmt = db.prepare(
  "INSERT INTO security_kpi_snapshots (date, metrics, at) VALUES (@date, @metrics, @at) ON CONFLICT(date) DO UPDATE SET metrics = excluded.metrics, at = excluded.at"
);
const listSnapshotsStmt = db.prepare("SELECT * FROM security_kpi_snapshots ORDER BY date DESC LIMIT ?");

// 오늘 스냅샷을 저장(하루 한 행, 최신값으로 갱신)한다 — 매번 조회 시 호출해 추세가 쌓이게 한다.
export function persistDailySnapshot(snapshot: KpiSnapshot): void {
  upsertSnapshotStmt.run({ date: snapshot.date, metrics: JSON.stringify(snapshot), at: snapshot.at });
}

// 최근 N일 스냅샷을 시간순(과거→현재)으로 돌려준다 — 추세 그래프용.
export function listKpiTrend(limit = 30): KpiSnapshot[] {
  const rows = listSnapshotsStmt.all(limit) as { date: string; metrics: string; at: number }[];
  return rows.map((r) => JSON.parse(r.metrics) as KpiSnapshot).reverse();
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetKpiForTests(): void {
  db.exec("DELETE FROM security_kpi_snapshots");
}

export function registerKpiRoutes(app: Express): void {
  // 현재 KPI를 계산해 오늘 스냅샷으로 저장하고, 현재값 + 추세(최근 스냅샷들)를 함께 돌려준다.
  app.get(
    "/api/kpi",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      const current = await computeKpiSnapshot();
      persistDailySnapshot(current);
      res.json({ current, trend: listKpiTrend(30) });
    })
  );
}
