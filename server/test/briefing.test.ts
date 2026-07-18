// #3 일일 브리핑 + #4 SLA 알림.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { resetApprovalsForTests, listFindingReviews, updateFindingReview } from "../src/engine/approvals";
import { slaAlerts, buildDailyBriefing } from "../src/engine/briefing";
import { plusDaysLocal } from "../src/util/date";

function ymd(daysFromNow: number): string {
  return plusDaysLocal(daysFromNow);
}

beforeEach(() => {
  resetAssetsForTests();
  resetApprovalsForTests();
  registerAsset({ id: "ai-x-01", name: "자산X", path: "-" });
  recordFindings("ai-x-01", [
    { finding_type: "critical 결함", severity: "critical", evidence: "e1", source_tool: "modelscan" },
    { finding_type: "high 결함", severity: "high", evidence: "e2", source_tool: "modelscan" },
  ]);
});

describe("#4 slaAlerts — 기한 초과·임박", () => {
  it("기한이 지난 건은 overdue, D-2 이내는 dueSoon", () => {
    const reviews = listFindingReviews();
    const critical = reviews.find((r) => r.finding.severity === "critical")!;
    const high = reviews.find((r) => r.finding.severity === "high")!;
    updateFindingReview(critical.assetId, critical.findingKey, { assignee: "김보안", dueDate: ymd(-1) }, "test"); // 어제 기한 → 초과
    updateFindingReview(high.assetId, high.findingKey, { assignee: "이영희", dueDate: ymd(1) }, "test"); // 내일 기한 → 임박

    const { overdue, dueSoon } = slaAlerts();
    expect(overdue.map((r) => r.finding.finding_type)).toContain("critical 결함");
    expect(dueSoon.map((r) => r.finding.finding_type)).toContain("high 결함");
  });

  it("오탐(rejected)은 기한이 지나도 알림 대상이 아니다", () => {
    const critical = listFindingReviews().find((r) => r.finding.severity === "critical")!;
    updateFindingReview(critical.assetId, critical.findingKey, { status: "rejected", dueDate: ymd(-5) }, "test");
    expect(slaAlerts().overdue).toHaveLength(0);
  });
});

describe("#3 buildDailyBriefing", () => {
  it("우선순위·추천을 담고, 지난 스냅샷 대비 신규를 계산한다", async () => {
    const first = await buildDailyBriefing({ save: true });
    expect(first.priorities.length).toBeGreaterThan(0);
    expect(first.recommendations.length).toBeGreaterThan(0);
    expect(first.newFindings.length).toBe(2); // 첫 브리핑: 스냅샷 없음 → 전부 신규

    // 스냅샷 저장됐으니 다음 브리핑엔 신규 없음
    const second = await buildDailyBriefing({ save: false });
    expect(second.newFindings.length).toBe(0);
  });
});
