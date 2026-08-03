// engine/kpi.ts — 통합 보안 KPI 대시보드 (여러 도메인 지표를 한곳에 모으고 일일 스냅샷으로 추세)
//
// 자산 위험도·유지보수 점검·finding 승인·CTI 자산영향·컴플라이언스·학습 활동을 각 엔진의 기존
// 목록/요약 함수로 집계해 하나의 스냅샷으로 만든다(별도 수집 로직 없음 — 재사용). 매일 한 번
// security_kpi_snapshots에 저장(하루 한 행)해 시계열 추세를 만든다. "KPI로 향후 방향성 결정"을
// 지원하는 임원/팀장용 통합 뷰.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { todayLocal } from "../util/date";
import { db, assertTestDb } from "../db";
import { listAssets } from "./assets";
import { listMaintenanceItems } from "./maintenance";
import { maintenanceSummary } from "./report";
import { listFindingReviews, approvalSummary } from "./approvals";
import { listCompliance } from "./compliance";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { 표식 } from "./tone";
import { listLearnloopRuns } from "./learnloop";
import { listTasks } from "./tasks";
import { buildHub } from "./assethub";
// 점검 실패 기록(scan_error 등)을 취약점에서 걸러 내는 판정 — 승인함·KPI가 같은 것을 쓴다.
import { isRealVulnerability } from "./agenttools";

export interface KpiSnapshot {
  date: string; // YYYY-MM-DD
  at: number;
  assets: { total: number; highRisk: number; midRisk: number; lowRisk: number };
  // scanFailed = 스캔이 실패해 결과를 못 받은 건수. 취약점이 아니라 **스캐너를 고칠 일**이라
  //   pending에 섞지 않는다(2026-08-01: 605건 중 602건이 스캔 오류였다).
  findings: { total: number; pending: number; approved: number; rejected: number; scanFailed: number };
  inspections: { total: number; overdue: number; pendingApproval: number; approved: number; rejected: number };
  cti: { totalFindings: number; matchedFindings: number; affectedAssets: number; criticalMatches: number };
  compliance: { total: number; covered: number; coverageRate: number };
  learning: { totalRuns: number; deployedModels: number };
  // 취약점 조치 현황(번다운·측정) — 인프라 호스트 자산의 최근 스캔 기준. 일일 스냅샷이 쌓이면
  // vulnerabilities.active 추세가 곧 조치 번다운(줄어들수록 좋음)이 된다.
  vulnerabilities: {
    hosts: number;
    active: number; // 현재 열린 취약점(fixed 제외)
    critical: number;
    high: number;
    medium: number;
    low: number;
    kev: number; // 실제 악용 확인(CISA KEV)
    newCount: number; // 최근 스캔에서 새로 생김
    resurfaced: number; // 재발
    newlyFixed: number; // 최근 스캔에서 고쳐짐
    remediationRate: number; // 고쳐짐 / (열림 + 고쳐짐) %
    // 점검이 **실패한** 기록(scan_error·scan_not_supported). 취약점이 아니다 — 그런데도
    // active에 함께 세어 왔다(2026-08-01 발견: 602건 전부가 이것인데 "활성 46건"으로 보고).
    // 취약점에서 빼되 **감추지는 않는다** — 601건이 점검 실패라는 건 그 자체로 큰일이다.
    scanFailed: number;
  };
  // 조치 항목(SLA) 추적 — 취약점에서 등록된 조치 태스크(ref가 vuln:)의 기한 준수 현황.
  remediation: {
    tasks: number; // 조치 항목 수
    open: number;
    done: number;
    overdue: number; // 기한 초과 미완료
    dueSoon: number; // 3일 내 마감(미완료)
    slaCompliance: number; // 기한 초과 안 한 비율 %
  };
  // 종합 보안태세 점수(0~100) — 기존 실지표를 가중 합성한 한 줄 대표값(임원 보고용). 규칙 기반.
  posture: { score: number; band: "good" | "fair" | "poor"; factors: { label: string; value: number }[] };
  // MTTR(평균 조치 소요일) — 완료된 조치 태스크의 (완료−생성) 평균. 표본이 적으면 null(집계 중).
  mttrDays: number | null;
  // AI 보안(LLM) — 자산 허브의 OWASP LLM 도출·AI-BOM·레드팀 견고성을 KPI로. 제품 차별점 강조.
  aiSecurity: {
    aiAssets: number; // AI 자산 수
    owaspOpen: number; // AI 자산 전체의 미대응 OWASP LLM 위험 합
    topRisk: { code: string; title: string; count: number } | null; // 가장 많이 미대응인 위험
    aibomComplete: number; // AI-BOM/SBOM 생성된 AI 자산 수
    aibomMissing: number; // AI-BOM 미생성 AI 자산 수
    redteamTested: number; // 레드팀 견고성 점검된 AI 자산 수
    avgRobustness: number | null; // 견고성 평균(점검된 자산 대상), 없으면 null
  };
}

const todayStr = todayLocal;

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

// 인프라 호스트 자산(취약점 스캔 대상)의 최근 스캔 findings로 조치 현황을 집계한다.
// state 태깅(vulnscan.ts)에 기대 — active/new/resurfaced는 열린 것, fixed는 고쳐진 것.
function vulnerabilityMetrics(): KpiSnapshot["vulnerabilities"] {
  const hosts = listAssets().filter((a) => a.assetType === "infra-host");
  const v = { hosts: hosts.length, active: 0, critical: 0, high: 0, medium: 0, low: 0, kev: 0, newCount: 0, resurfaced: 0, newlyFixed: 0, remediationRate: 0, scanFailed: 0 };
  for (const a of hosts) {
    for (const f of a.findings) {
      // ⚠ 점검 실패 기록은 취약점이 아니다. 안 걸러서 "활성 46건"이라 보고했는데 실제 취약점은
      //   0건이고 602건 전부가 scan_error였다(2026-08-01). 임원 보고에 들어가는 숫자다.
      //   isRegular…가 아니라 **이미 있던 판정 함수를 안 부른 것**이 원인 — 오늘 승인함에서
      //   똑같은 일이 있었다(같은 함수, 다른 호출부).
      if (!isRealVulnerability(f)) {
        v.scanFailed++;
        continue;
      }
      if (f.state === "fixed") {
        v.newlyFixed++;
        continue;
      }
      v.active++;
      if (f.severity === "critical") v.critical++;
      else if (f.severity === "high") v.high++;
      else if (f.severity === "medium") v.medium++;
      else v.low++;
      if (f.kev) v.kev++;
      if (f.state === "new") v.newCount++;
      else if (f.state === "resurfaced") v.resurfaced++;
    }
  }
  const denom = v.active + v.newlyFixed;
  v.remediationRate = denom ? Math.round((v.newlyFixed / denom) * 100) : 0;
  return v;
}

// 스캔 기반 취약점 번다운(측정) — 일일 KPI 스냅샷과 달리 실제 저장된 scan_runs 이력에서
// 재구성한다. 매 스캔 시각마다 "그 시점의 포트폴리오 상태"(각 호스트의 그 시각 이하 최신 스캔)를
// 집계해, 재스캔을 거듭하며 열린 취약점이 실제로 줄고 있는지 보여준다(Tenable §측정: 재스캔으로
// 위험 감소 추적). 일일 스냅샷이 없어도(막 도입) 과거 스캔 이력만 있으면 곧바로 추세가 나온다.
export interface BurndownPoint {
  at: number;
  active: number; // 열린 취약점(fixed 제외)
  critical: number;
  high: number;
  kev: number;
  fixed: number; // 누적 고쳐진 것
}

export function vulnerabilityBurndown(): BurndownPoint[] {
  const hosts = listAssets().filter((a) => a.assetType === "infra-host");
  const times = new Set<number>();
  for (const h of hosts) for (const r of h.scanHistory) times.add(r.scannedAt);
  const sorted = [...times].sort((a, b) => a - b);
  return sorted.map((t) => {
    const pt: BurndownPoint = { at: t, active: 0, critical: 0, high: 0, kev: 0, fixed: 0 };
    for (const h of hosts) {
      // scanHistory는 오래된 순 — t 이하의 마지막 스캔 스냅샷을 그 호스트의 "그 시점 상태"로 쓴다.
      let latest: (typeof h.scanHistory)[number] | undefined;
      for (const r of h.scanHistory) {
        if (r.scannedAt <= t) latest = r;
        else break;
      }
      if (!latest) continue;
      for (const f of latest.findings) {
        if (!isRealVulnerability(f)) continue; // 점검 실패 기록은 번다운에도 넣지 않는다
        if (f.state === "fixed") {
          pt.fixed++;
          continue;
        }
        pt.active++;
        if (f.severity === "critical") pt.critical++;
        else if (f.severity === "high") pt.high++;
        if (f.kev) pt.kev++;
      }
    }
    return pt;
  });
}

// 취약점에서 등록된 조치 항목(task.ref가 "vuln:")의 SLA 준수 현황.
function remediationMetrics(): KpiSnapshot["remediation"] {
  const now = Date.now();
  const tasks = listTasks().filter((t) => (t.ref ?? "").startsWith("vuln:"));
  const done = tasks.filter((t) => t.done).length;
  const open = tasks.length - done;
  const overdue = tasks.filter((t) => !t.done && t.dueAt != null && t.dueAt < now).length;
  const dueSoon = tasks.filter((t) => !t.done && t.dueAt != null && t.dueAt >= now && t.dueAt - now <= 3 * 86400000).length;
  // SLA 준수 = 기한을 넘기지 않은 것(완료했거나 아직 기한 전) 비율.
  const compliant = tasks.filter((t) => t.dueAt == null || t.done || t.dueAt >= now).length;
  const slaCompliance = tasks.length ? Math.round((compliant / tasks.length) * 100) : 100;
  return { tasks: tasks.length, open, done, overdue, dueSoon, slaCompliance };
}

// MTTR(평균 조치 소요일) — 완료시각이 기록된 조치 태스크(vuln:)의 (완료−생성) 평균.
// 표본이 3건 미만이면 신뢰할 수 없어 null(집계 중)로 둔다. 완료시각 컬럼 도입 전 완료건은 제외된다.
function computeMttrDays(): number | null {
  const done = listTasks().filter((t) => (t.ref ?? "").startsWith("vuln:") && t.done && t.completedAt && t.completedAt >= t.createdAt);
  if (done.length < 3) return null;
  const avgMs = done.reduce((s, t) => s + ((t.completedAt as number) - t.createdAt), 0) / done.length;
  return Math.round((avgMs / 86400000) * 10) / 10; // 소수 1자리 일
}

// 종합 보안태세 점수(0~100) — 기존 실지표를 가중 합성. 높을수록 좋음. 규칙 기반(결정적).
// 요소: 취약점 조치율·SLA 준수·컴플라이언스 대응률(양의 기여) + KEV/Critical·기한초과·고위험자산(감점).
function computePosture(
  v: KpiSnapshot["vulnerabilities"],
  rem: KpiSnapshot["remediation"],
  compRate: number,
  assets: KpiSnapshot["assets"]
): KpiSnapshot["posture"] {
  const highRiskRatio = assets.total ? assets.highRisk / assets.total : 0;
  // 100에서 시작해 위험 요인만큼 감점 — 각 요인은 상한이 있어 한 요인이 점수를 독식하지 않는다.
  let score = 100;
  score -= Math.min(25, v.kev * 8 + v.critical * 4); // 실제 악용·치명 취약점
  score -= Math.min(15, rem.overdue * 5); // SLA 기한 초과
  score -= Math.min(15, Math.round(highRiskRatio * 30)); // 고위험 자산 비중
  score -= Math.min(15, Math.round((100 - rem.slaCompliance) * 0.15)); // SLA 미준수
  score -= Math.min(15, Math.round((100 - compRate) * 0.15)); // 컴플라이언스 미대응
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = score >= 80 ? "good" : score >= 55 ? "fair" : "poor";
  return {
    score,
    band,
    factors: [
      { label: "취약점 조치율", value: v.remediationRate },
      { label: "SLA 준수율", value: rem.slaCompliance },
      { label: "컴플라이언스 대응률", value: compRate },
    ],
  };
}

/**
 * 「이 취약점 조치하면 점수 얼마나 올라?」 — **감점 요인을 그대로 펼쳐 보여 준다.**
 *
 * ★ 왜(2026-08-03 실전 147상황): 이 물음에 33.5초를 쓰고 벤더 문서의 진단 방법론을
 *   읽어 줬다. 점수는 computePosture가 **규칙으로** 내는 값이라 지어낼 이유가 없다.
 *
 * ⚠ **한 건을 고쳐도 점수가 안 움직일 수 있다** — 각 감점에 상한이 있어서다.
 *   지금 운영이 그렇다: KEV 21건×8 + 치명 419건×4 = 상한 25점에 이미 걸려 있다.
 *   "고치면 오릅니다"라고 답하면 담당자는 한 건 고치고 점수를 확인하다 제품을 안 믿게 된다.
 *   **몇 건을 닫아야 숫자가 움직이는지**를 함께 말한다.
 */
export function 점수영향글(snap: KpiSnapshot): string {
  const v = snap.vulnerabilities;
  const rem = snap.remediation;
  const 감점 = [
    { 이름: "실제 악용(KEV)·치명 취약점", 값: Math.min(25, v.kev * 8 + v.critical * 4), 상한: 25, 원값: v.kev * 8 + v.critical * 4 },
    { 이름: "기한 초과", 값: Math.min(15, rem.overdue * 5), 상한: 15, 원값: rem.overdue * 5 },
    { 이름: "SLA 미준수", 값: Math.min(15, Math.round((100 - rem.slaCompliance) * 0.15)), 상한: 15, 원값: Math.round((100 - rem.slaCompliance) * 0.15) },
  ];
  const 줄 = 감점.map((d) => {
    const 걸림 = d.원값 > d.상한 ? ` — **상한 ${d.상한}점에 걸려 있습니다**(원래 ${d.원값}점어치)` : "";
    return `- ${d.이름}: −${d.값}점${걸림}`;
  });
  // KEV/치명이 상한에 걸렸다면, 상한 아래로 내려오려면 몇 건을 닫아야 하는지 센다.
  const kev치명 = 감점[0];
  const 안내 =
    kev치명.원값 > kev치명.상한
      ? `${표식.주의} 지금은 **한 건을 고쳐도 점수가 안 움직입니다.** 실제 악용·치명 취약점 감점이 상한(25점)을 넘겨 있기 때문입니다 — ` +
        `KEV ${v.kev}건과 치명 ${v.critical}건이 상한 아래(합산 25점 미만)로 내려와야 숫자가 바뀝니다. 지금은 점수보다 **KEV부터 줄이는 것**이 맞습니다.`
      : `${표식.다음} 지금은 감점이 상한 아래라 **한 건 조치가 바로 점수에 반영됩니다** — KEV 1건 −8점, 치명 1건 −4점입니다.`;
  return [
    `종합 보안태세 **${snap.posture.score}점** (100점 만점) — 규칙으로 계산한 값입니다.`,
    "무엇이 깎고 있나:",
    ...줄,
    "",
    안내,
  ].join("\n");
}

// AI 보안 지표 — 자산 허브(assethub) 집계를 재사용해 OWASP LLM·AI-BOM·견고성을 KPI로 요약한다.
function computeAiSecurity(): KpiSnapshot["aiSecurity"] {
  const hub = buildHub();
  const aiRows = hub.rows.filter((r) => r.isAi);
  const tested = aiRows.filter((r) => r.robustnessScore != null);
  const avgRobustness = tested.length
    ? Math.round(tested.reduce((s, r) => s + (r.robustnessScore as number), 0) / tested.length)
    : null;
  const top = hub.summary.owaspOpenByCode[0] ?? null;
  return {
    aiAssets: aiRows.length,
    owaspOpen: aiRows.reduce((s, r) => s + r.owaspOpen, 0),
    topRisk: top ? { code: top.code, title: top.title, count: top.count } : null,
    aibomComplete: aiRows.filter((r) => r.sbomGenerated).length,
    aibomMissing: hub.summary.sbomMissing,
    redteamTested: tested.length,
    avgRobustness,
  };
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

  const assetRisk = riskCounts();
  const vulns = vulnerabilityMetrics();
  const rem = remediationMetrics();
  const compRate = applicable ? Math.round((covered / applicable) * 100) : 0;

  return {
    date: todayStr(),
    at: Date.now(),
    assets: assetRisk,
    findings: { total: fa.total, pending: fa.pending, approved: fa.approved, rejected: fa.rejected, scanFailed: fa.scanFailed ?? 0 },
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
      coverageRate: compRate,
    },
    learning: {
      totalRuns: runs.length,
      deployedModels: runs.filter((r) => r.stage === "done").length,
    },
    vulnerabilities: vulns,
    remediation: rem,
    posture: computePosture(vulns, rem, compRate, assetRisk),
    mttrDays: computeMttrDays(),
    aiSecurity: computeAiSecurity(),
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
  assertTestDb("resetKpiForTests");
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
      // burndown: 저장된 스캔 이력에서 재구성한 실제 취약점 감소 추세(일일 스냅샷과 독립).
      res.json({ current, trend: listKpiTrend(30), burndown: vulnerabilityBurndown() });
    })
  );
}
