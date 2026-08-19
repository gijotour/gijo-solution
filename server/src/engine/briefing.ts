// engine/briefing.ts — #3 일일 브리핑 + #4 SLA 알림.
// 보안담당자가 아침에 켜면 "어제 대비 신규·기한 임박/초과·새 위협 + 오늘 추천 3"을 한 서사로 본다.
// 데이터는 전부 기존 엔진(우선순위·검토대장·CTI)에서 조립한다. "어제 대비 신규"는 일일 스냅샷 비교.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { db } from "../db";
import { todayLocal, plusDaysLocal } from "../util/date";
import { prioritizedReviews, listFindingReviews, PrioritizedFinding, FindingReview } from "./approvals";
import { listAssets } from "./assets";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";

db.exec("CREATE TABLE IF NOT EXISTS briefing_snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT, takenAt INTEGER NOT NULL, keysJson TEXT NOT NULL)");
const insertSnap = db.prepare("INSERT INTO briefing_snapshot (takenAt, keysJson) VALUES (?, ?)");
const latestSnap = db.prepare("SELECT keysJson FROM briefing_snapshot ORDER BY takenAt DESC LIMIT 1");
const pruneSnap = db.prepare("DELETE FROM briefing_snapshot WHERE id NOT IN (SELECT id FROM briefing_snapshot ORDER BY takenAt DESC LIMIT 30)");

const today = todayLocal;
const plusDays = plusDaysLocal;

// #4 SLA 알림 — 기한 초과 + 임박(D-2 이내). rejected(오탐)·accepted(위험수용)는 조치 대상 아님
// (수용 만료는 SLA가 아니라 재검토 부상 — acceptExpired가 맡는다. 안 빼면 「기한 초과 즉시
//  처리」와 「기한까지 수용」이 같은 건에서 충돌한다 — 검토관 2026-08-20 중1).
export function slaAlerts(): { overdue: FindingReview[]; dueSoon: FindingReview[] } {
  const reviews = listFindingReviews().filter((r) => r.dueDate && r.status !== "rejected" && r.status !== "accepted");
  const t = today();
  const soon = plusDays(2);
  return {
    overdue: reviews.filter((r) => (r.dueDate as string) < t),
    dueSoon: reviews.filter((r) => (r.dueDate as string) >= t && (r.dueDate as string) <= soon),
  };
}

export interface DailyBriefing {
  date: string;
  priorities: PrioritizedFinding[]; // 오늘의 조치 상위
  newFindings: PrioritizedFinding[]; // 지난 브리핑 이후 신규
  overdue: FindingReview[];
  dueSoon: FindingReview[];
  threats: { type: string; target: string; severity: string; assets: string[] }[]; // 우리 자산에 걸리는 CTI
  recommendations: string[]; // 오늘 추천 3
}

// 브리핑 조립 + 오늘 스냅샷 저장(다음 비교용). save=false면 스냅샷을 남기지 않는다(미리보기).
export async function buildDailyBriefing(opts: { save?: boolean } = {}): Promise<DailyBriefing> {
  const priorities = prioritizedReviews(5);
  const all = prioritizedReviews(2000);

  // 지난 스냅샷 대비 신규 finding
  let priorKeys = new Set<string>();
  const snap = latestSnap.get() as { keysJson: string } | undefined;
  if (snap) {
    try {
      priorKeys = new Set(JSON.parse(snap.keysJson) as string[]);
    } catch {
      /* 손상 시 전부 신규로 간주 */
    }
  }
  const currentKeys = all.map((r) => `${r.assetId}::${r.findingKey}`);
  const newFindings = all.filter((r) => !priorKeys.has(`${r.assetId}::${r.findingKey}`)).slice(0, 8);

  const { overdue, dueSoon } = slaAlerts();

  // 우리 자산에 걸리는 CTI 위협
  let threats: DailyBriefing["threats"] = [];
  try {
    const { matches } = matchCtiToAssets(await listFindings(), listAssets());
    threats = matches.slice(0, 5).map((m) => ({
      type: m.finding.type,
      target: m.finding.target,
      severity: m.finding.severity,
      assets: m.matchedAssets.map((a) => a.assetName),
    }));
  } catch {
    /* CTI 조회 실패 — 위협 없이 진행 */
  }

  // 오늘 추천 3 (규칙): 최우선 취약점 조치 · 기한 초과 처리 · 미배정 상위 배정
  const recommendations: string[] = [];
  if (priorities[0]) recommendations.push(`최우선 조치: [${priorities[0].finding.severity}] ${priorities[0].finding.finding_type} @ ${priorities[0].assetName}${priorities[0].finding.kev ? " (KEV·실제악용)" : ""}`);
  if (overdue.length) recommendations.push(`기한 초과 ${overdue.length}건 즉시 처리 — 담당자 독촉 또는 기한 재조정`);
  const unassigned = all.filter((r) => !r.assignee);
  if (unassigned.length) recommendations.push(`미배정 취약점 ${unassigned.length}건 — 상위부터 담당자 지정`);
  if (recommendations.length === 0) recommendations.push("긴급 항목 없음 — 정기 점검·자산 변경 반영을 권장");

  if (opts.save !== false) {
    insertSnap.run(Date.now(), JSON.stringify(currentKeys));
    pruneSnap.run();
  }

  return { date: today(), priorities, newFindings, overdue, dueSoon, threats, recommendations };
}

// 에이전트 도구·요약용 텍스트. (도구 결과는 composeFinalAnswer가 다시 서술한다.)
export async function dailyBriefingText(opts: { save?: boolean } = {}): Promise<string> {
  const b = await buildDailyBriefing(opts);
  const lines: string[] = [`📋 ${b.date} 보안 브리핑`];
  lines.push(
    `- 오늘의 조치 상위 ${b.priorities.length}건: ` +
      b.priorities.map((p) => `[${p.finding.severity}] ${p.finding.finding_type} @ ${p.assetName}${p.finding.kev ? "·KEV" : ""}`).join(" / ")
  );
  if (b.newFindings.length) lines.push(`- 지난 브리핑 이후 신규 ${b.newFindings.length}건: ` + b.newFindings.slice(0, 5).map((r) => `${r.finding.finding_type}@${r.assetName}`).join(" / "));
  if (b.overdue.length) lines.push(`- ⚠ 기한 초과 ${b.overdue.length}건: ` + b.overdue.slice(0, 5).map((r) => `${r.finding.finding_type}(기한 ${r.dueDate}, 담당 ${r.assignee || "미지정"})`).join(" / "));
  if (b.dueSoon.length) lines.push(`- 기한 임박(D-2) ${b.dueSoon.length}건: ` + b.dueSoon.slice(0, 5).map((r) => `${r.finding.finding_type}(기한 ${r.dueDate})`).join(" / "));
  if (b.threats.length) lines.push(`- 우리 자산 관련 위협 ${b.threats.length}건: ` + b.threats.map((t) => `[${t.severity}] ${t.type}→${t.assets.join(",")}`).join(" / "));
  lines.push(`- 오늘 추천: ` + b.recommendations.map((r, i) => `${i + 1}) ${r}`).join(" "));
  return lines.join("\n").slice(0, 2500);
}

export function registerBriefingRoutes(app: Express): void {
  // 대시보드용: 조립된 브리핑 데이터(스냅샷 저장은 GET에서 하지 않음 — 미리보기).
  app.get("/api/briefing/daily", authMiddleware, asyncRoute(async (_req, res) => res.json(await buildDailyBriefing({ save: false }))));
  // 브리핑 확인(스냅샷 갱신 — 다음 "신규" 기준점).
  app.post("/api/briefing/daily/ack", authMiddleware, asyncRoute(async (_req, res) => res.json(await buildDailyBriefing({ save: true }))));
  // SLA 알림만.
  app.get("/api/briefing/sla", authMiddleware, (_req, res) => res.json(slaAlerts()));
}
