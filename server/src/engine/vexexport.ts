// engine/vexexport.ts — VEX(취약점 활용 가능성 교환) 출력 (계획서 Phase 5)
//
// VEX는 "이 취약점이 우리 제품/자산에 실제로 영향을 주는가"를 기계가 읽을 수 있게 적는 국제 표준이다.
// 우리가 이미 하고 있는 승인 흐름이 VEX 상태값과 1:1로 대응하므로, 출력 포맷 하나만 더하면 된다.
//
//   미검토(pending)      → under_investigation  (조사 중)
//   진행중(in_progress)  → affected             (영향 있음 — 조치 중)
//   검증대기(verifying)  → affected             (아직 닫히지 않았다 — 조치 확인 전)
//   완료(approved)       → fixed                (조치됨)
//   반려(rejected)       → not_affected         (영향 없음 — 사유가 반드시 따라붙는다)
//
// ⚠ not_affected는 "괜찮다"고 남에게 선언하는 값이라 **근거 없이 쓰면 안 된다**.
//   CSAF/CycloneDX 모두 justification(왜 영향이 없는가)을 요구한다. 우리 반려 사유를 그대로 매핑한다:
//     오탐(false_positive)          → vulnerable_code_not_present      (취약 코드 자체가 없다)
//     보상통제(compensating_control) → protected_by_mitigating_control  (다른 보안이 막고 있다)
//   사유가 없는 반려는 not_affected로 내보내지 않고 under_investigation으로 낮춘다 —
//   빈 근거로 "영향 없음"을 배포하는 게 이 기능에서 가장 위험한 일이다.
//
// 왜 CycloneDX인가: 이미 AI-BOM을 CycloneDX로 내보내고 있어(sbom.ts) 같은 도구 체인에서 함께 읽힌다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import { listFindingReviews, type FindingReview, type ApprovalStatus, type RejectReason } from "./approvals";

// 문서 생성자 표기(sbom.ts와 같은 값 — 그쪽은 지역 상수라 여기서 따로 둔다)
const PRODUCT = { vendor: "GIJO Technology", name: "GIJO AS", version: "2.0.0" };

export type VexState = "under_investigation" | "affected" | "fixed" | "not_affected";
export type VexJustification = "vulnerable_code_not_present" | "protected_by_mitigating_control";

export interface VexAnalysis {
  state: VexState;
  justification?: VexJustification;
  detail?: string;
}

/** 승인 상태 → VEX 상태. 반려는 사유가 있을 때만 not_affected로 내보낸다. */
export function toVexAnalysis(status: ApprovalStatus, rejectReason?: RejectReason | null, note?: string | null, acceptUntil?: string | null): VexAnalysis {
  switch (status) {
    case "approved":
      return { state: "fixed", ...(note ? { detail: note } : {}) };
    case "accepted":
      // 위험수용 — 취약점은 실재하므로 affected가 정직하다(not_affected로 내보내면 거짓).
      // 수용 사실·기한을 detail에 남겨 받은 쪽이 재검토 시점을 안다.
      return { state: "affected", detail: `위험 수용(기한 ${acceptUntil || "미기록"})${note ? ` — ${note}` : ""}` };
    case "in_progress":
    case "verifying":
      return { state: "affected", ...(note ? { detail: note } : {}) };
    case "rejected": {
      if (rejectReason === "false_positive") {
        return { state: "not_affected", justification: "vulnerable_code_not_present", ...(note ? { detail: note } : {}) };
      }
      if (rejectReason === "compensating_control") {
        return { state: "not_affected", justification: "protected_by_mitigating_control", ...(note ? { detail: note } : {}) };
      }
      // 사유 없는 반려 — "영향 없음"이라 단언할 근거가 없다. 낮춰서 내보낸다.
      return { state: "under_investigation", detail: "반려 사유가 기록되지 않아 영향 없음으로 단언할 수 없습니다." };
    }
    default:
      return { state: "under_investigation" };
  }
}

/** finding 제목·근거에서 CVE를 뽑는다. 여러 개면 전부(VEX는 취약점 단위 문서라 각각 나간다). */
export function cvesOf(r: FindingReview): string[] {
  const text = `${r.finding.finding_type}\n${r.finding.evidence}`;
  const found = text.match(/CVE-\d{4}-\d{4,7}/gi) || [];
  const uniq = Array.from(new Set(found.map((c) => c.toUpperCase())));
  return uniq;
}

export interface VexDocument {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  serialNumber: string;
  version: number;
  metadata: Record<string, unknown>;
  vulnerabilities: Record<string, unknown>[];
}

/**
 * VEX 문서를 만든다. CVE가 있는 finding만 담는다 — VEX는 "이 CVE가 영향 있나"를 말하는 문서라
 * 식별자 없는 항목은 받는 쪽에서 쓸 수가 없다(넣어봐야 소음).
 */
export function buildVexDocument(reviews: FindingReview[], now = Date.now()): VexDocument {
  const vulns: Record<string, unknown>[] = [];
  for (const r of reviews) {
    const cves = cvesOf(r);
    if (!cves.length) continue;
    const analysis = toVexAnalysis(r.status, r.rejectReason as RejectReason | undefined, r.note, r.acceptUntil);
    for (const cve of cves) {
      vulns.push({
        id: cve,
        source: { name: "NVD", url: `https://nvd.nist.gov/vuln/detail/${cve}` },
        analysis: {
          state: analysis.state,
          ...(analysis.justification ? { justification: analysis.justification } : {}),
          ...(analysis.detail ? { detail: analysis.detail } : {}),
          // 누가 언제 판단했는지 — VEX를 받는 쪽이 신뢰도를 가늠할 근거
          ...(r.reviewedBy ? { response: [] as string[] } : {}),
        },
        affects: [{ ref: r.assetId }],
        properties: [
          { name: "gijo:asset", value: r.assetName },
          { name: "gijo:finding", value: r.finding.finding_type },
          { name: "gijo:status", value: r.status },
          ...(r.reviewedBy ? [{ name: "gijo:reviewedBy", value: r.reviewedBy }] : []),
          ...(r.reviewedAt ? [{ name: "gijo:reviewedAt", value: new Date(r.reviewedAt).toISOString() }] : []),
        ],
      });
    }
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${cryptoRandom()}`,
    version: 1,
    metadata: {
      timestamp: new Date(now).toISOString(),
      tools: [{ vendor: PRODUCT.vendor, name: `${PRODUCT.name} VEX`, version: PRODUCT.version }],
    },
    vulnerabilities: vulns,
  };
}

function cryptoRandom(): string {
  // 결정적일 필요가 없고(문서마다 새 일련번호), 외부 의존을 늘리지 않는다.
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-${h()}-${h()}-${h()}${h()}${h()}`;
}

export function registerVexRoutes(app: Express): void {
  // VEX 내보내기 — 자산 단위(assetId 지정) 또는 전체.
  app.get("/api/vex/export", authMiddleware, (req, res) => {
    const assetId = req.query.assetId ? String(req.query.assetId) : null;
    const all = listFindingReviews();
    const target = assetId ? all.filter((r) => r.assetId === assetId) : all;
    const doc = buildVexDocument(target);
    const user = (req as Request & { user?: GijoUser }).user;
    recordAudit({
      kind: "config", // 내보내기는 자료를 바꾸지 않지만 "누가 무엇을 반출했나"는 남겨야 한다
      actor: user?.displayName ?? null,
      action: "VEX 내보내기",
      target: assetId ?? "전체 자산",
      detail: `취약점 ${doc.vulnerabilities.length}건`,
    });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gijo-vex-${assetId ?? "all"}.json"`);
    res.send(JSON.stringify(doc, null, 2));
  });

  // 화면 미리보기용 — 파일이 아니라 요약(상태별 건수)만.
  app.get("/api/vex/summary", authMiddleware, (req, res) => {
    const assetId = req.query.assetId ? String(req.query.assetId) : null;
    const all = listFindingReviews();
    const target = assetId ? all.filter((r) => r.assetId === assetId) : all;
    const doc = buildVexDocument(target);
    const by: Record<string, number> = {};
    for (const v of doc.vulnerabilities) {
      const st = ((v.analysis as { state: string }) || { state: "?" }).state;
      by[st] = (by[st] ?? 0) + 1;
    }
    res.json({ total: doc.vulnerabilities.length, byState: by, withoutCve: target.length - new Set(target.filter((r) => cvesOf(r).length).map((r) => r.findingKey)).size });
  });
}
