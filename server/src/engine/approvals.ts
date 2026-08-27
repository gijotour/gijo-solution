// engine/approvals.ts — 승인 워크플로우 (스캔 finding 검토 → 승인/반려, 6.4절)
//
// 스캔으로 나온 finding을 보안담당자가 검토해 "확정(approved)" 또는 "오탐(rejected)"으로 처리한다.
// finding 자체는 안정적인 id가 없으므로(bridge.ts StandardFinding = 내용만) (assetId + finding 내용
// 해시)를 키로 삼아 검토 상태를 finding_approvals에 저장한다. 저장 행이 없으면 pending(미검토).
// 반려(오탐)로 처리된 finding은 SBOM 취약점 반영에서 제외된다(sbom.ts가 isFindingRejected를 참조).

import type { Express, Request } from "express";
import * as crypto from "crypto";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { todayLocal } from "../util/date";
import { db } from "../db";
import { listAssets, getAsset } from "./assets";
import type { StandardFinding } from "./bridge";
import { isRealVulnerability } from "./agenttools";
import type { GijoUser } from "../auth/users";
import { PLAIN_LANGUAGE_RULE } from "./promptstyle";
import { sendMail, getSmtpConfig } from "./email";
import { recordAudit } from "./audit";

// 조치 생애주기(2026-07-22 확장). 기존 3상태에 진행중·검증을 앞에 끼워 넣었다 — approved는
// "완료(확정·해결)" 의미를 그대로 유지해 sbom/today/chatbot 등 기존 참조를 깨지 않는다.
//   pending(미검토) → in_progress(진행중) → verifying(검증·재스캔대기) → approved(완료) / rejected(반려)
//   + accepted(위험수용, 2026-08-20 외부검증 1순위) — 「고치지 않기로 결정했다」를 기록하는 상태.
//     반려(오탐)와 다르다: 취약점은 실재하지만 사업 판단으로 기한(acceptUntil)까지 수용한다.
//     기한이 지나면 재검토로 부상한다(영구 수용 금지 — ISO 27005·NIST RMF 관례).
export type ApprovalStatus = "pending" | "in_progress" | "verifying" | "approved" | "rejected" | "accepted";
// 반려 사유(모범사례: 오탐과 보상통제를 반드시 구분). 증거·승인자·날짜는 note/reviewedBy/reviewedAt에 보존.
export type RejectReason = "false_positive" | "compensating_control";

export interface FindingApprovalRow {
  assetId: string;
  findingKey: string;
  // 이제 pending도 저장될 수 있다 — 판정(오탐 여부)은 미정이어도 담당자·기한을 배정할 수 있기 때문.
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: number | null;
  note: string | null;
  assignee: string | null; // 실제 수행 담당자(조치)
  securityOwner: string | null; // 보안담당자(감독·검토·SLA 책임)
  dueDate: string | null; // 조치 기한(SLA) 'YYYY-MM-DD'
  rejectReason: string | null; // 반려 사유(false_positive | compensating_control)
  acceptUntil: string | null; // 위험수용 기한 'YYYY-MM-DD' — accepted일 때만 값이 있다
  acceptedBy: string | null; // 위험수용 처리자(수용 시점의 actor)
  verifyRequestedAt: number | null; // 실수행담당자가 조치 완료 보고한 시각(→검증)
  verifyRequestedBy: string | null;
  resolvedAt: number | null; // 재스캔에서 사라져 해결 확인된 시각(→완료)
  snapshot: string | null; // finding 내용 JSON — 재스캔에서 사라진 뒤에도 완료/검증 목록에 표시하려 보존
}

export interface FindingReview {
  assetId: string;
  assetName: string;
  findingKey: string;
  finding: StandardFinding;
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  note?: string;
  assignee?: string;
  securityOwner?: string;
  dueDate?: string;
  rejectReason?: string;
  verifyRequestedAt?: number;
  verifyRequestedBy?: string;
  resolvedAt?: number;
  acceptUntil?: string; // 위험수용 기한 — accepted일 때만
  acceptedBy?: string; // 위험수용 처리자
  overdue?: boolean; // dueDate가 지났고 아직 미해결(rejected·approved 제외)
  gone?: boolean; // 최신 스캔에 더는 없음(재스캔에서 사라짐) — 검증/완료 표시에 씀
}

// finding 내용의 안정 키 — 본체는 잎 모듈 findingkey.ts로 내려갔다(2026-08-27 화살 #2:
// 순수 해시 하나 때문에 네 모듈이 결재 엔진 전체를 물고 들어왔다). 여기서 **재수출**해
// 기존 호출부(src 4곳 + 시험 8곳)는 한 줄도 안 바뀐다. 해시 조립은 그 파일의 ⚠⚠ 참조.
export { findingKey } from "./findingkey";
import { findingKey } from "./findingkey";

const getStmt = db.prepare("SELECT * FROM finding_approvals WHERE assetId = ? AND findingKey = ?");
const allRowsStmt = db.prepare("SELECT * FROM finding_approvals");
const upsertStmt = db.prepare(`
  INSERT INTO finding_approvals (assetId, findingKey, status, reviewedBy, reviewedAt, note, assignee, securityOwner, dueDate, rejectReason, verifyRequestedAt, verifyRequestedBy, resolvedAt, snapshot, acceptUntil, acceptedBy)
  VALUES (@assetId, @findingKey, @status, @reviewedBy, @reviewedAt, @note, @assignee, @securityOwner, @dueDate, @rejectReason, @verifyRequestedAt, @verifyRequestedBy, @resolvedAt, @snapshot, @acceptUntil, @acceptedBy)
  ON CONFLICT(assetId, findingKey) DO UPDATE SET
    status = excluded.status, reviewedBy = excluded.reviewedBy, reviewedAt = excluded.reviewedAt,
    note = excluded.note, assignee = excluded.assignee, securityOwner = excluded.securityOwner,
    dueDate = excluded.dueDate, rejectReason = excluded.rejectReason,
    verifyRequestedAt = excluded.verifyRequestedAt, verifyRequestedBy = excluded.verifyRequestedBy,
    resolvedAt = excluded.resolvedAt, snapshot = excluded.snapshot,
    acceptUntil = excluded.acceptUntil, acceptedBy = excluded.acceptedBy
`);
const deleteStmt = db.prepare("DELETE FROM finding_approvals WHERE assetId = ? AND findingKey = ?");
const setResolvedStmt = db.prepare("UPDATE finding_approvals SET status='approved', resolvedAt=@at WHERE assetId=@assetId AND findingKey=@findingKey");

function storedStatus(assetId: string, key: string): FindingApprovalRow | undefined {
  return getStmt.get(assetId, key) as FindingApprovalRow | undefined;
}

// SBOM용: 이 finding이 오탐(rejected)으로 처리됐는가. 반려된 것만 SBOM 취약점에서 제외한다
// (미검토 pending은 아직 반영 — "확인 안 됨"을 "안전"으로 오해시키지 않기 위함).
export function isFindingRejected(assetId: string, f: StandardFinding): boolean {
  return storedStatus(assetId, findingKey(assetId, f))?.status === "rejected";
}

// 조치 기한이 지났고 아직 미해결이면 overdue. 반려(오탐/보상통제)·완료(해결)는 조치 대상이 아니라 제외.
function isOverdue(dueDate: string | null | undefined, status: ApprovalStatus): boolean {
  // accepted(위험수용)도 제외 — 수용 중 SLA 기한이 지나도 「지연」이 아니다(기한 관리는
  // acceptUntil이 맡고, 만료는 acceptExpired로 따로 센다 — 검토관 중1: 빨간 점+수용 표기 충돌).
  if (!dueDate || status === "rejected" || status === "approved" || status === "accepted") return false;
  return dueDate < todayLocal(); // 'YYYY-MM-DD' 로컬(KST) 달력 기준 비교
}

// ── 「지연」·「미배정」의 단일 출처 ────────────────────────────────────────────
// ⚠ 2026-08-21 설계관이 **같은 이름으로 다른 것을 세는 곳 3군데**를 찾았다:
//   · agenttools/handlers.ts 「기한 초과」가 status === "pending"만 세어 **진행중·검증의
//     지연을 놓쳤다** — 담당자에게 「지연 없음」이라 답하는데 실제로는 있는 상황.
//   · agenttools/handlers.ts·briefing.ts 「미배정」이 !assignee만 보아 **완료·반려·위험수용
//     까지 셌다** — 끝난 일을 「담당자 지정하세요」라고 권했다.
//   · briefing.ts slaAlerts가 approved를 안 빼서 **끝난 건이 기한 초과로 올라왔다.**
//   화면·판·서버는 2026-08-20에 통일됐는데 이 셋만 옛 잣대로 남아 있었다.
//   같은 것을 여러 곳에 적으면 어긋난다 — 이제 이 두 함수가 유일한 출처다.
export function isOverdueReview(r: { dueDate?: string | null; status: ApprovalStatus }): boolean {
  return isOverdue(r.dueDate ?? null, r.status);
}
export function isUnassignedReview(r: { assignee?: string | null; status: ApprovalStatus }): boolean {
  return !r.assignee && r.status !== "approved" && r.status !== "rejected" && r.status !== "accepted";
}

function rowToReview(row: FindingApprovalRow, finding: StandardFinding, assetName: string, gone: boolean): FindingReview {
  return {
    assetId: row.assetId,
    assetName,
    findingKey: row.findingKey,
    finding,
    status: row.status,
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt ?? undefined,
    note: row.note ?? undefined,
    assignee: row.assignee ?? undefined,
    securityOwner: row.securityOwner ?? undefined,
    dueDate: row.dueDate ?? undefined,
    rejectReason: row.rejectReason ?? undefined,
    verifyRequestedAt: row.verifyRequestedAt ?? undefined,
    verifyRequestedBy: row.verifyRequestedBy ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
    acceptUntil: row.acceptUntil ?? undefined,
    acceptedBy: row.acceptedBy ?? undefined,
    overdue: isOverdue(row.dueDate, row.status),
    gone,
  };
}

// 전체 자산의 finding을 검토 상태와 함께 나열한다(현재 asset.findings = 최신 스캔 결과 기준).
// 재스캔에서 사라진 finding도 검증/진행중 상태였다면 "해결 확인(완료)"으로 되살려 목록에 남긴다.
export function listFindingReviews(): FindingReview[] {
  const reviews: FindingReview[] = [];
  const seen = new Set<string>();
  const assetNameById = new Map<string, string>();
  for (const asset of listAssets()) {
    assetNameById.set(asset.id, asset.name);
    for (const finding of asset.findings) {
      const key = findingKey(asset.id, finding);
      seen.add(`${asset.id}\0${key}`);
      const row = storedStatus(asset.id, key);
      const status = row?.status ?? "pending";
      reviews.push({
        assetId: asset.id,
        assetName: asset.name,
        findingKey: key,
        finding,
        status,
        reviewedBy: row?.reviewedBy ?? undefined,
        reviewedAt: row?.reviewedAt ?? undefined,
        note: row?.note ?? undefined,
        assignee: row?.assignee ?? undefined,
        securityOwner: row?.securityOwner ?? undefined,
        dueDate: row?.dueDate ?? undefined,
        rejectReason: row?.rejectReason ?? undefined,
        verifyRequestedAt: row?.verifyRequestedAt ?? undefined,
        verifyRequestedBy: row?.verifyRequestedBy ?? undefined,
        resolvedAt: row?.resolvedAt ?? undefined,
        acceptUntil: row?.acceptUntil ?? undefined,
        acceptedBy: row?.acceptedBy ?? undefined,
        overdue: isOverdue(row?.dueDate, status),
        gone: false,
      });
    }
  }

  // 최신 스캔에 더는 없는 저장 행 — 조치 흐름을 타던 건(진행중/검증/완료)은 스냅샷으로 이어 보여준다.
  // 검증·진행중이던 것이 재스캔에서 사라졌으면 = 해결 확인 → 완료(approved)로 자동 확정한다(closed-loop).
  for (const row of allRowsStmt.all() as FindingApprovalRow[]) {
    if (seen.has(`${row.assetId}\0${row.findingKey}`)) continue;
    if (!["in_progress", "verifying", "approved", "accepted"].includes(row.status)) continue; // 미검토·반려는 사라지면 그냥 드롭
    let finding: StandardFinding;
    try {
      finding = row.snapshot ? (JSON.parse(row.snapshot) as StandardFinding) : { finding_type: "(내용 없음)", severity: "low", evidence: "", source_tool: "" };
    } catch {
      finding = { finding_type: "(내용 없음)", severity: "low", evidence: "", source_tool: "" };
    }
    let effective = { ...row };
    if (row.status === "in_progress" || row.status === "verifying" || row.status === "accepted") {
      // 수용 중이던 것도 재스캔에서 사라졌으면 해결된 것 — 없는 취약점의 수용 기한을
      // 관리하는 것은 소음이다(closed-loop, 진행중·검증과 같은 규칙).
      const at = Date.now();
      setResolvedStmt.run({ assetId: row.assetId, findingKey: row.findingKey, at }); // 재스캔에서 사라짐 → 완료
      effective = { ...row, status: "approved", resolvedAt: at };
    }
    reviews.push(rowToReview(effective, finding, assetNameById.get(row.assetId) ?? row.assetId, true));
  }
  return reviews;
}

// ── 통합 우선순위(오늘의 조치) ──────────────────────────────────────────
// 지침 정책: CISA KEV(실제 악용) 최우선 → EPSS(악용확률) → VPR → CVSS 심각도. 전 자산을 가로질러
// 하나의 정렬된 조치 목록을 만든다("오늘 뭐부터"에 답). 오탐(rejected)은 조치 대상이 아니라 제외.
const SEV_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export function priorityScore(f: StandardFinding): number {
  const kev = f.kev ? 1000 : 0;            // 실제 악용 확인 = 압도적 최우선
  const epss = (f.epss ?? 0) * 100;        // 0~100 (악용확률)
  const vpr = (f.vpr ?? 0) * 5;            // 0~50 (Tenable VPR)
  const sev = SEV_WEIGHT[f.severity] ?? 0; // 1~4 (동점 보정)
  return kev + epss + vpr + sev;
}

export interface PrioritizedFinding extends FindingReview {
  score: number;
}

// assetIds를 주면 그 자산들의 finding만 추린다(자산 스코프 리포트용). 없으면 전 자산(종전과 동일).
export function prioritizedReviews(limit = 10, assetIds?: string[]): PrioritizedFinding[] {
  const scope = assetIds && assetIds.length ? new Set(assetIds) : null;
  return listFindingReviews()
    // ★ 스캐너 오류는 취약점이 아니다 — 일감 목록에서 뺀다(2026-08-01 실측: 605건 중 602건).
    //   이 함수가 "오늘 뭐부터"·조치·승인 화면·KPI의 **공통 원천**이라 여기 한 곳에서 거른다.
    //   감추는 게 아니라 세는 자리를 나누는 것이다 — 스캔 실패 건수는 scanFailureCount()로 따로 낸다.
    .filter((r) => isRealVulnerability(r.finding))
    // 오탐(rejected)과 조치완료(fixed)는 "오늘의 조치" 대상이 아니므로 제외한다.
    .filter((r) => r.status !== "rejected" && r.finding.state !== "fixed")
    // 위험수용(accepted)은 기한 안이면 일감이 아니다 — 기한이 지나면 다시 부상한다
    // (재검토 대상 — 감춰지는 게 아니라 「수용 만료」로 돌아온다. 승인 화면에는 늘 보인다).
    .filter((r) => !(r.status === "accepted" && r.acceptUntil && r.acceptUntil >= todayLocal()))
    .filter((r) => !scope || scope.has(r.assetId))
    .map((r) => ({ ...r, score: priorityScore(r.finding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

/**
 * 한 자산의 ③ 조치 현황(승인 시안 mockups/자산_0단계, 2026-08-18).
 *
 * ⚠ `approvalSummary`를 그대로 못 쓴다 — 거기엔 **미배정 칸이 없다**.
 * ⚠ 세는 규칙은 `workflow.ts`의 ③ 조치와 **똑같아야 한다.** 다르면 같은 자산을 두 화면이
 *   다른 숫자로 말한다 — 이 저장소가 「같은 것을 여러 곳에 적으면 어긋난다」로 반복해 겪은 것이다.
 *   그래서 규칙을 여기 다시 쓰지 않고 **같은 원천(listFindingReviews + isRealVulnerability)**에
 *   같은 조건(in_progress / 미배정)을 건다. 조건이 바뀌면 `workflowstage.test`가 짝을 잡는다.
 */
export function assetProgress(assetId: string): { inProgress: number; unassigned: number } {
  let inProgress = 0, unassigned = 0;
  try {
    for (const r of listFindingReviews()) {
      if (r.assetId !== assetId) continue;
      if (!isRealVulnerability(r.finding)) continue;   // 스캔 오류는 취약점이 아니다
      if (r.status === "in_progress") inProgress++;
      if (!r.assignee && r.status !== "approved" && r.status !== "rejected" && r.status !== "accepted") unassigned++; // 수용 건은 담당자를 안 붙이는 게 정상(중3)
    }
  } catch { /* 대장을 못 읽으면 0 — 화면은 「—」로 그린다 */ }
  return { inProgress, unassigned };
}

// ── AI 조치 브리핑(자동 triage) ─────────────────────────────────────────
// 우선순위 상위 취약점에 대해 [우선순위 근거 + 권장 조치 + 권장 기한] 초안을 로컬 LLM이 작성한다.
// 온톨로지 완화통제를 근거로 주입해 근거 기반 조치를 유도한다. 자동 적용이 아니라 담당자 검토용 초안.
export function buildTriagePrompt(top: PrioritizedFinding[], ontologyContext: string | null): string {
  const lines = top.map((r, i) => {
    const f = r.finding;
    const flags = [f.kev ? "CISA KEV(실제 악용)" : "", f.epss != null ? `EPSS ${Math.round(f.epss * 100)}%` : "", f.vpr != null ? `VPR ${f.vpr}` : ""]
      .filter(Boolean).join(", ");
    return `${i + 1}. [${f.severity}] ${f.finding_type} — 자산 ${r.assetName}${flags ? ` (${flags})` : ""}`;
  });
  return [
    "당신은 보안담당자의 조치 결정을 돕는 보안 AI입니다. 아래 '우선순위 상위 취약점'에 대해 '오늘의 조치 브리핑'을 작성하세요.",
    PLAIN_LANGUAGE_RULE,
    "각 항목마다 세 가지를 간결히: ① 왜 이 우선순위인지 근거(KEV·EPSS·VPR를 활용) ② 권장 조치(아래 '관련 규칙·관계'의 완화통제가 있으면 반영) ③ 권장 조치 기한(CISA KEV=즉시~24시간, 높은 EPSS=수일 내, 그 외=위험도에 맞게).",
    "번호 목록으로, 군더더기 없이. 주어진 데이터 범위 안에서만 판단하고 지어내지 마세요.",
    "【언어 규칙 — 매우 중요】 출력은 처음부터 끝까지 반드시 한국어로만 작성합니다. 중국어(汉字 단어)·일본어를 절대 섞지 마세요. 소제목·라벨도 한국어로(예: '우선순위 근거', '권장 조치', '권장 기한'). 고유명사·CVE·제품명·버전만 원문 유지.",
    "",
    "[우선순위 상위 취약점]",
    ...lines,
    ontologyContext ? `\n${ontologyContext}` : "",
  ].join("\n");
}

export async function buildTriageDraft(limit = 5, assetIds?: string[]): Promise<{ draft: string; count: number }> {
  const top = prioritizedReviews(limit, assetIds);
  if (top.length === 0) return { draft: "조치 대상 취약점이 없습니다 — 스캔 결과를 먼저 업로드하세요.", count: 0 };
  let ontologyContext: string | null = null;
  try {
    const { ontologyContextFor } = await import("./ontology.js");
    const text = top.map((r) => `${r.finding.finding_type} ${r.finding.evidence}`).join("\n");
    ontologyContext = ontologyContextFor(text, [], undefined);
  } catch {
    /* 온톨로지 없으면 근거 없이 진행 */
  }
  const { chat } = await import("./llm.js");
  const draft = await chat({ agentId: "orchestrator", message: buildTriagePrompt(top, ontologyContext), remember: false, maxTokens: 800, trusted: true });
  return { draft, count: top.length };
}

export interface ApprovalSummary {
  total: number;
  pending: number;
  in_progress: number;
  verifying: number;
  approved: number; // 완료(해결·확정)
  rejected: number;
  accepted: number; // 위험수용(기한부) — 일감은 아니지만 감춰지지 않는다
  acceptExpired: number; // 수용 기한이 지나 재검토로 부상한 건
  overdue: number; // 기한 지난 미조치 건
  // 스캔이 실패해 결과를 못 받은 건수 — **취약점이 아니라 스캐너 문제**다.
  // 위 숫자들과 섞지 않고 따로 낸다. 0이 아니면 화면이 "스캔이 안 된 자산 N건"으로 안내한다.
  scanFailed: number;
}

export function approvalSummary(reviews: FindingReview[]): ApprovalSummary {
  // ★ 스캐너 오류를 취약점으로 세지 않는다(2026-08-01 실측: 605건 중 602건이 스캔 오류였고,
  //   화면에는 "검토 대기 602건"이 떴다. 실제 일감은 3건 — 담당자는 밀린 일이 602건인 줄 안다).
  //   감추지 않는다: scanFailed로 따로 세어 "스캔이 안 된 자산"이라는 다른 일감으로 보여준다.
  const 일감 = reviews.filter((r) => isRealVulnerability(r.finding));
  const s: ApprovalSummary = { total: 일감.length, pending: 0, in_progress: 0, verifying: 0, approved: 0, rejected: 0, accepted: 0, acceptExpired: 0, overdue: 0, scanFailed: reviews.length - 일감.length };
  const 오늘 = todayLocal();
  for (const r of 일감) {
    s[r.status]++;
    if (r.overdue) s.overdue++;
    if (r.status === "accepted" && r.acceptUntil && r.acceptUntil < 오늘) s.acceptExpired++; // 수용 만료 — 재검토 대상
  }
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUS: ApprovalStatus[] = ["pending", "in_progress", "verifying", "approved", "rejected", "accepted"];
const VALID_REJECT: RejectReason[] = ["false_positive", "compensating_control"];

export interface ReviewPatch {
  status?: ApprovalStatus;
  note?: string;
  assignee?: string; // 실수행담당자
  securityOwner?: string; // 보안담당자(감독)
  dueDate?: string; // 'YYYY-MM-DD' 또는 ""(해제)
  rejectReason?: RejectReason | ""; // 반려 사유
  acceptUntil?: string; // 위험수용 기한 'YYYY-MM-DD' — accepted로 갈 때 필수(영구 수용 금지)
}

// 저장 행에 남길 게 있는지 — pending이면서 담당·기한·메모·사유가 전부 비면 삭제(미검토·미배정 원복).
function isEmptyReview(status: ApprovalStatus, note: string | null, assignee: string | null, owner: string | null, dueDate: string | null): boolean {
  return status === "pending" && !note && !assignee && !owner && !dueDate;
}

// 검토/조치 정보를 부분 갱신(merge)한다. 상태·담당자(2종)·기한·메모·반려사유를 한 번에 또는 따로 설정.
export function updateFindingReview(assetId: string, key: string, patch: ReviewPatch, actor: string): void {
  if (patch.status && !VALID_STATUS.includes(patch.status)) {
    throw new Error(`status는 ${VALID_STATUS.join("/")}만 가능합니다`);
  }
  if (patch.dueDate && patch.dueDate !== "" && !DATE_RE.test(patch.dueDate)) {
    throw new Error("dueDate는 'YYYY-MM-DD' 형식이어야 합니다");
  }
  if (patch.rejectReason && !VALID_REJECT.includes(patch.rejectReason)) {
    throw new Error("rejectReason은 false_positive/compensating_control만 가능합니다");
  }
  if (patch.acceptUntil && patch.acceptUntil !== "" && !DATE_RE.test(patch.acceptUntil)) {
    throw new Error("acceptUntil은 'YYYY-MM-DD' 형식이어야 합니다");
  }
  const prev = storedStatus(assetId, key);
  const status: ApprovalStatus = patch.status ?? prev?.status ?? "pending";
  const note = patch.note !== undefined ? (patch.note.trim() || null) : (prev?.note ?? null);
  const assignee = patch.assignee !== undefined ? (patch.assignee.trim() || null) : (prev?.assignee ?? null);
  const securityOwner = patch.securityOwner !== undefined ? (patch.securityOwner.trim() || null) : (prev?.securityOwner ?? null);
  const dueDate = patch.dueDate !== undefined ? (patch.dueDate.trim() || null) : (prev?.dueDate ?? null);
  // 반려 사유는 반려 상태일 때만 유지 — 다른 상태로 넘어가면 비운다(오탐 사유가 완료건에 남지 않게).
  const rejectReason = status !== "rejected" ? null : (patch.rejectReason !== undefined ? (patch.rejectReason || null) : (prev?.rejectReason ?? null));
  // 위험수용 기한·처리자 — accepted일 때만 산다(rejectReason과 같은 관례). 기한 없는 수용은
  // 영구 수용이라 금지(ISO 27005·NIST RMF — 위험수용은 반드시 재검토 주기를 갖는다).
  // 사유(note)도 필수 — 「왜 수용했나」가 없으면 감사에서 답할 수 없다.
  const acceptUntil = status !== "accepted" ? null : (patch.acceptUntil !== undefined ? (patch.acceptUntil.trim() || null) : (prev?.acceptUntil ?? null));
  const acceptedBy = status !== "accepted" ? null : (prev?.status === "accepted" ? (prev?.acceptedBy ?? actor) : actor);
  if (status === "accepted") {
    if (!acceptUntil) throw new Error("위험수용에는 기한(acceptUntil, 'YYYY-MM-DD')이 필수입니다 — 기한 없는 수용은 영구 수용이라 허용하지 않습니다");
    if (!note) throw new Error("위험수용에는 사유(note)가 필수입니다 — 왜 수용하는지 없이는 감사에 답할 수 없습니다");
  }

  if (isEmptyReview(status, note, assignee, securityOwner, dueDate)) {
    deleteStmt.run(assetId, key);
    return;
  }

  // 검증 요청(진행중→검증) 시각·보고자 기록. 검증에서 벗어나면(되돌리거나 완료로 확정) 유지하되
  // 다시 진행중 이전 상태로 돌아가면 지운다.
  let verifyRequestedAt = prev?.verifyRequestedAt ?? null;
  let verifyRequestedBy = prev?.verifyRequestedBy ?? null;
  if (patch.status === "verifying" && prev?.status !== "verifying") {
    verifyRequestedAt = Date.now();
    verifyRequestedBy = actor;
  } else if (status === "pending" || status === "in_progress") {
    verifyRequestedAt = null;
    verifyRequestedBy = null;
  }
  // 완료(approved) 확정 시각. 완료에서 벗어나면 초기화.
  const resolvedAt = status === "approved" ? (prev?.resolvedAt ?? Date.now()) : null;

  // finding 내용 스냅샷 — 재스캔에서 사라진 뒤에도 완료/검증 목록에 제목·심각도를 보여주려 저장.
  let snapshot = prev?.snapshot ?? null;
  const live = getAsset(assetId)?.findings.find((f) => findingKey(assetId, f) === key);
  if (live) snapshot = JSON.stringify({ finding_type: live.finding_type, severity: live.severity, evidence: live.evidence, source_tool: live.source_tool });

  upsertStmt.run({
    assetId, findingKey: key, status, reviewedBy: actor, reviewedAt: Date.now(),
    note, assignee, securityOwner, dueDate, rejectReason, verifyRequestedAt, verifyRequestedBy, resolvedAt, snapshot,
    acceptUntil, acceptedBy,
  });
}

// 하위호환 래퍼(기존 호출부 유지).
export function setFindingApproval(assetId: string, key: string, status: ApprovalStatus, reviewedBy: string, note?: string): void {
  updateFindingReview(assetId, key, { status, note }, reviewedBy);
}

// 테스트 전용: db는 모듈 싱글턴이라 createApp()을 새로 호출해도 초기화되지 않는다.
export function resetApprovalsForTests(): void {
  db.exec("DELETE FROM finding_approvals");
}

export function registerApprovalsRoutes(app: Express): void {
  app.get("/api/approvals", authMiddleware, (_req, res) => {
    const 전부 = listFindingReviews();
    // ★ 목록과 요약이 같은 것을 세야 한다(2026-08-01). 요약만 걸러 놓고 목록에 605줄을 내리면
    //   "위에는 3이라는데 아래는 605줄"이 되어 담당자가 무엇을 믿어야 할지 모른다.
    //   스캔 실패는 감추지 않고 scanFailed 숫자로 따로 알린다 — 그건 스캐너를 고칠 일이지
    //   취약점을 검토할 일이 아니다.
    const reviews = 전부.filter((r) => isRealVulnerability(r.finding));
    res.json({ reviews, summary: approvalSummary(전부) });
  });

  // 오늘의 조치 — 전 자산 finding을 KEV·EPSS·VPR·심각도로 정렬한 우선순위 목록.
  // ⓪ 자산 화면의 ③ 조치 칸(승인 시안 2026-08-18). 읽기만 하므로 담당자 누구나.
  app.get("/api/assets/:id/progress", authMiddleware, (req, res) => {
    res.json(assetProgress(String(req.params.id)));
  });

  app.get("/api/approvals/priorities", authMiddleware, (req, res) => {
    const limit = Number(req.query.limit) || 10;
    res.json({ items: prioritizedReviews(limit) });
  });

  // AI 조치 브리핑 — 상위 취약점에 대한 [근거·권장조치·기한] 초안(로컬 LLM). 담당자 검토용.
  app.post("/api/approvals/triage", authMiddleware, asyncRoute(async (req, res) => {
    const limit = Number(req.body?.limit) || 5;
    res.json(await buildTriageDraft(limit));
  }));

  // finding 검토/조치 갱신. 상태(생애주기)·담당자 2종·기한·메모·반려사유를 부분 갱신한다.
  // status만 보내면 판정만, assignee/securityOwner/dueDate만 보내면 판정 없이 배정만 한다.
  app.post("/api/approvals/:assetId/:key", authMiddleware, (req, res) => {
    const body = req.body ?? {};
    if (body.status !== undefined && !VALID_STATUS.includes(String(body.status) as ApprovalStatus)) {
      res.status(400).json({ error: `status는 ${VALID_STATUS.join(", ")}만 가능합니다` });
      return;
    }
    const user = (req as Request & { user?: GijoUser }).user;
    try {
      updateFindingReview(
        String(req.params.assetId),
        String(req.params.key),
        { status: body.status, note: body.note, assignee: body.assignee, securityOwner: body.securityOwner, dueDate: body.dueDate, rejectReason: body.rejectReason, acceptUntil: body.acceptUntil },
        user?.displayName ?? "-"
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 담당자에게 조치 배정 메일 보내기 — 저장된 배정 정보(담당자·기한)와 취약점 내용으로 메일 본문을
  // 서버가 구성해 발송한다. 수신 주소만 클라이언트가 준다. SMTP 미설정이면 안내와 함께 거절.
  app.post("/api/approvals/:assetId/:key/notify", authMiddleware, asyncRoute(async (req, res) => {
    const assetId = String(req.params.assetId);
    const key = String(req.params.key);
    const to = String(req.body?.to ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { res.status(400).json({ error: "받는 사람 이메일 주소가 올바르지 않습니다" }); return; }
    if (!getSmtpConfig()) { res.status(400).json({ error: "메일 서버(SMTP)가 설정되지 않았습니다 — 설정 화면에서 먼저 등록하세요" }); return; }

    const asset = getAsset(assetId);
    const finding = asset?.findings.find((f) => findingKey(assetId, f) === key);
    const review = listFindingReviews().find((r) => r.assetId === assetId && r.findingKey === key);
    const title = finding?.finding_type ?? "취약점";
    const sev = finding?.severity ? finding.severity.toUpperCase() : "-";
    const assignee = review?.assignee ?? "미지정"; // 실수행담당자
    const owner = review?.securityOwner ?? "미지정"; // 보안담당자(감독)
    const due = review?.dueDate ? review.dueDate : "미정";
    const user = (req as Request & { user?: GijoUser }).user;

    const subject = `[GIJO AS] 취약점 조치 배정 — ${title}`;
    const lines = [
      `${assignee} 님께 취약점 조치가 배정되었습니다.`,
      "",
      `• 자산: ${asset?.name ?? assetId}`,
      `• 취약점: ${title}`,
      `• 심각도: ${sev}`,
      `• 실수행 담당자: ${assignee}`,
      `• 보안담당자(감독): ${owner}`,
      `• 조치 기한: ${due}`,
      finding?.evidence ? `• 근거: ${finding.evidence.slice(0, 300)}` : "",
      "",
      `조치 완료 후에는 '검증(재스캔)'으로 실제 해결 여부를 확인합니다.`,
      `배정: ${user?.displayName ?? "-"} · ${new Date().toLocaleString("ko-KR")}`,
      "본 메일은 GIJO AS 조치·승인에서 자동 발송되었습니다.",
    ].filter(Boolean);
    try {
      await sendMail({ to: [to], subject, text: lines.join("\n") });
      recordAudit({ kind: "write", actor: user?.displayName ?? null, action: "조치 배정 메일 발송", target: `${asset?.name ?? assetId} · ${title}`, detail: `수신 ${to} · 담당 ${assignee}`, result: "ok" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "메일 발송 실패: " + (err instanceof Error ? err.message : String(err)) });
    }
  }));
}
