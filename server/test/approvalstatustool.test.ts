// 결재·승인 대기 현황 도구 — 핸들러 계약 (2026-09-11, 고객 QA 예행 2026-09-10 밤 수리)
//
// FORCED_INTENTS[88](agentloop.ts) → tool: "approval_status"가 「승인 기다리는 것 있어?」·
// 「결재 대기 있어?」처럼 종류를 안 밝힌 물음을 여기로 보낸다(라우팅 시험은 approval-routing.test.ts). 이 파일은 핸들러
// runApprovalStatus 자체의 계약만 본다 — 취약점 결재(approvals.ts)와 점검 승인(report.ts)을
// **함께**, **숫자로** 세고, 기존 폴백 문구 감시(drawer-audit.mjs FAIL_MARKS)에 안 걸린다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runApprovalStatus } from "../src/engine/agenttools/handlers";
import { resetAssetsForTests } from "../src/engine/assets";
import { resetApprovalsForTests, listFindingReviews, approvalSummary, isUnassignedReview } from "../src/engine/approvals";
import { resetMaintenanceForTests, listMaintenanceItems } from "../src/engine/maintenance";
import { maintenanceSummary } from "../src/engine/report";

// ⚠ FAIL_MARKS는 **글자로 베끼지 않는다** — drawer-audit.mjs를 읽어 배열을 뽑는다.
//   베끼면 두 곳이 어긋난다(한쪽만 고쳐지는 사고, 이 저장소가 반복해 겪은 계보).
function FAIL_MARKS목록(): string[] {
  const 경로 = path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs");
  const src = fs.readFileSync(경로, "utf8");
  const 시작 = src.indexOf("const FAIL_MARKS = [");
  if (시작 < 0) throw new Error("FAIL_MARKS를 못 찾았다 — drawer-audit.mjs가 낡았다(이 시험을 손볼 것)");
  const 끝 = src.indexOf("];", 시작);
  const 몸통 = src.slice(시작, 끝);
  const 마크 = [...몸통.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (마크.length === 0) throw new Error("FAIL_MARKS를 하나도 못 뽑았다 — 추출 정규식이 낡았다");
  return 마크;
}

describe("결재·승인 대기 현황 — runApprovalStatus", () => {
  beforeEach(() => {
    resetAssetsForTests();
    resetApprovalsForTests();
    resetMaintenanceForTests();
  });

  it("데이터 0에서도 두 종류 결재 대기를 **숫자로** 0건이라 말한다", () => {
    const 답 = runApprovalStatus();
    expect(답, "취약점 결재 대기 숫자가 안 보인다").toContain("취약점 결재 대기 0건");
    expect(답, "점검 승인 대기 숫자가 안 보인다").toContain("점검 승인 대기 0건");
  });

  it("답에 폴백·거절 문구(FAIL_MARKS)가 하나도 안 섞인다", () => {
    const 답 = runApprovalStatus();
    for (const 마크 of FAIL_MARKS목록()) {
      expect(답, `「${마크}」가 0건 답에 섞였다 — 폴백처럼 읽힌다`).not.toContain(마크);
    }
  });

  it("갈 곳 한 줄(▸ 다음:)이 있다", () => {
    expect(runApprovalStatus()).toContain("▸ 다음:");
  });

  it("잣대는 approvalSummary·maintenanceSummary 한 곳과 맞는다 — 새로 세지 않는다", () => {
    const fa = approvalSummary(listFindingReviews());
    const ms = maintenanceSummary(listMaintenanceItems());
    const 미배정 = listFindingReviews().filter(isUnassignedReview).length;
    const 답 = runApprovalStatus();
    expect(답).toContain(`취약점 결재 대기 ${fa.pending}건(담당자 미배정 ${미배정}건)`);
    expect(답).toContain(`점검 승인 대기 ${ms.reported}건`);
  });
});
