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
import type { GijoUser } from "../auth/users";
import { PLAIN_LANGUAGE_RULE } from "./promptstyle";
import { sendMail, getSmtpConfig } from "./email";
import { recordAudit } from "./audit";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface FindingApprovalRow {
  assetId: string;
  findingKey: string;
  // 이제 pending도 저장될 수 있다 — 판정(오탐 여부)은 미정이어도 담당자·기한을 배정할 수 있기 때문.
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: number | null;
  note: string | null;
  assignee: string | null; // 조치 담당자
  dueDate: string | null; // 조치 기한(SLA) 'YYYY-MM-DD'
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
  dueDate?: string;
  overdue?: boolean; // dueDate가 지났고 아직 조치 안 됨(rejected 제외)
}

// finding 내용으로 안정적인 키를 만든다 — 같은 finding이면 재스캔 후에도 검토 상태가 유지된다.
export function findingKey(assetId: string, f: StandardFinding): string {
  return crypto
    .createHash("sha1")
    .update(`${assetId}\0${f.finding_type}\0${f.severity}\0${f.evidence}\0${f.source_tool}`)
    .digest("hex")
    .slice(0, 16);
}

const getStmt = db.prepare("SELECT * FROM finding_approvals WHERE assetId = ? AND findingKey = ?");
const upsertStmt = db.prepare(`
  INSERT INTO finding_approvals (assetId, findingKey, status, reviewedBy, reviewedAt, note, assignee, dueDate)
  VALUES (@assetId, @findingKey, @status, @reviewedBy, @reviewedAt, @note, @assignee, @dueDate)
  ON CONFLICT(assetId, findingKey) DO UPDATE SET
    status = excluded.status, reviewedBy = excluded.reviewedBy, reviewedAt = excluded.reviewedAt,
    note = excluded.note, assignee = excluded.assignee, dueDate = excluded.dueDate
`);
const deleteStmt = db.prepare("DELETE FROM finding_approvals WHERE assetId = ? AND findingKey = ?");

function storedStatus(assetId: string, key: string): FindingApprovalRow | undefined {
  return getStmt.get(assetId, key) as FindingApprovalRow | undefined;
}

// SBOM용: 이 finding이 오탐(rejected)으로 처리됐는가. 반려된 것만 SBOM 취약점에서 제외한다
// (미검토 pending은 아직 반영 — "확인 안 됨"을 "안전"으로 오해시키지 않기 위함).
export function isFindingRejected(assetId: string, f: StandardFinding): boolean {
  return storedStatus(assetId, findingKey(assetId, f))?.status === "rejected";
}

// 조치 기한이 지났고 아직 조치되지 않았으면 overdue. rejected(오탐)는 조치 대상이 아니라 제외.
function isOverdue(dueDate: string | null | undefined, status: ApprovalStatus): boolean {
  if (!dueDate || status === "rejected") return false;
  return dueDate < todayLocal(); // 'YYYY-MM-DD' 로컬(KST) 달력 기준 비교
}

// 전체 자산의 finding을 검토 상태와 함께 나열한다(현재 asset.findings = 최신 스캔 결과 기준).
export function listFindingReviews(): FindingReview[] {
  const reviews: FindingReview[] = [];
  for (const asset of listAssets()) {
    for (const finding of asset.findings) {
      const key = findingKey(asset.id, finding);
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
        dueDate: row?.dueDate ?? undefined,
        overdue: isOverdue(row?.dueDate, status),
      });
    }
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
    // 오탐(rejected)과 조치완료(fixed)는 "오늘의 조치" 대상이 아니므로 제외한다.
    .filter((r) => r.status !== "rejected" && r.finding.state !== "fixed")
    .filter((r) => !scope || scope.has(r.assetId))
    .map((r) => ({ ...r, score: priorityScore(r.finding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
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
  const draft = await chat({ agentId: "orchestrator", message: buildTriagePrompt(top, ontologyContext), remember: false, maxTokens: 800 });
  return { draft, count: top.length };
}

export interface ApprovalSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  overdue: number; // 기한 지난 미조치 건
}

export function approvalSummary(reviews: FindingReview[]): ApprovalSummary {
  const s: ApprovalSummary = { total: reviews.length, pending: 0, approved: 0, rejected: 0, overdue: 0 };
  for (const r of reviews) {
    s[r.status]++;
    if (r.overdue) s.overdue++;
  }
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReviewPatch {
  status?: ApprovalStatus;
  note?: string;
  assignee?: string;
  dueDate?: string; // 'YYYY-MM-DD' 또는 ""(해제)
}

// 검토/조치 정보를 부분 갱신(merge)한다. 판정(status)·담당자(assignee)·기한(dueDate)·메모(note)를
// 한 번에 또는 따로 설정할 수 있다. 아무 것도 없는 상태(pending·담당없음·기한없음·메모없음)가 되면
// 저장 행을 지운다(=미검토·미배정 원상복귀).
export function updateFindingReview(assetId: string, key: string, patch: ReviewPatch, actor: string): void {
  if (patch.status && !["approved", "rejected", "pending"].includes(patch.status)) {
    throw new Error("status는 approved/rejected/pending만 가능합니다");
  }
  if (patch.dueDate && patch.dueDate !== "" && !DATE_RE.test(patch.dueDate)) {
    throw new Error("dueDate는 'YYYY-MM-DD' 형식이어야 합니다");
  }
  const prev = storedStatus(assetId, key);
  const status: ApprovalStatus = patch.status ?? prev?.status ?? "pending";
  const note = patch.note !== undefined ? (patch.note.trim() || null) : (prev?.note ?? null);
  const assignee = patch.assignee !== undefined ? (patch.assignee.trim() || null) : (prev?.assignee ?? null);
  const dueDate = patch.dueDate !== undefined ? (patch.dueDate.trim() || null) : (prev?.dueDate ?? null);

  // 저장할 게 아무것도 없으면 행 삭제(미검토·미배정).
  if (status === "pending" && !note && !assignee && !dueDate) {
    deleteStmt.run(assetId, key);
    return;
  }
  upsertStmt.run({ assetId, findingKey: key, status, reviewedBy: actor, reviewedAt: Date.now(), note, assignee, dueDate });
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
    const reviews = listFindingReviews();
    res.json({ reviews, summary: approvalSummary(reviews) });
  });

  // 오늘의 조치 — 전 자산 finding을 KEV·EPSS·VPR·심각도로 정렬한 우선순위 목록.
  app.get("/api/approvals/priorities", authMiddleware, (req, res) => {
    const limit = Number(req.query.limit) || 10;
    res.json({ items: prioritizedReviews(limit) });
  });

  // AI 조치 브리핑 — 상위 취약점에 대한 [근거·권장조치·기한] 초안(로컬 LLM). 담당자 검토용.
  app.post("/api/approvals/triage", authMiddleware, asyncRoute(async (req, res) => {
    const limit = Number(req.body?.limit) || 5;
    res.json(await buildTriageDraft(limit));
  }));

  // finding 검토/조치 갱신. status(오탐 판정)·assignee(담당자)·dueDate(기한)·note를 부분 갱신할 수 있다.
  // status만 보내면 기존 승인 동작과 동일(하위호환). assignee/dueDate만 보내면 판정 없이 배정만 한다.
  app.post("/api/approvals/:assetId/:key", authMiddleware, (req, res) => {
    const body = req.body ?? {};
    // status가 명시된 경우에만 유효성 검사(생략 시 기존 값 유지 = 배정만 하는 경우 허용).
    if (body.status !== undefined && !["approved", "rejected", "pending"].includes(String(body.status))) {
      res.status(400).json({ error: "status는 approved, rejected, pending만 가능합니다" });
      return;
    }
    const user = (req as Request & { user?: GijoUser }).user;
    try {
      updateFindingReview(
        String(req.params.assetId),
        String(req.params.key),
        { status: body.status, note: body.note, assignee: body.assignee, dueDate: body.dueDate },
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
    const assignee = review?.assignee ?? "미지정";
    const due = review?.dueDate ? review.dueDate : "미정";
    const user = (req as Request & { user?: GijoUser }).user;

    const subject = `[GIJO AS] 취약점 조치 배정 — ${title}`;
    const lines = [
      `${assignee} 님께 취약점 조치가 배정되었습니다.`,
      "",
      `• 자산: ${asset?.name ?? assetId}`,
      `• 취약점: ${title}`,
      `• 심각도: ${sev}`,
      `• 담당자: ${assignee}`,
      `• 조치 기한: ${due}`,
      finding?.evidence ? `• 근거: ${finding.evidence.slice(0, 300)}` : "",
      "",
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
