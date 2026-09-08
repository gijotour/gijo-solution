// #3 일일 브리핑 + #4 SLA 알림.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { resetApprovalsForTests, listFindingReviews, updateFindingReview } from "../src/engine/approvals";
import { slaAlerts, buildDailyBriefing, resetBriefingSnapshotsForTests, saveBriefingSnapshotForTests } from "../src/engine/briefing";
import { plusDaysLocal } from "../src/util/date";

function ymd(daysFromNow: number): string {
  return plusDaysLocal(daysFromNow);
}

beforeEach(() => {
  resetAssetsForTests();
  resetApprovalsForTests();
  resetBriefingSnapshotsForTests(); // 기준점을 앞 시험에서 물려받으면 「신규」 판정이 흔들린다
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

    // ⚠ 2026-09-08 계약 변경 — 예전엔 여기서 0을 기대했다. 그 0이 **바로 그 결함**이었다:
    //   첫 답이 기준점을 자기 자신으로 덮어써서 두 번째 물음부터 신규 줄이 사라졌다.
    //   이제 기준점은 「오늘 이전」이라 같은 날 몇 번을 물어도 답이 같다.
    const second = await buildDailyBriefing({ save: false });
    expect(second.newFindings.length, "같은 날 다시 물었더니 신규가 사라졌다").toBe(2);
  });

  // ★★ 2026-09-08 검토관 [상] — 「지난 브리핑 이후 신규」가 **두 번째 물음부터 사라졌다**
  //   부를 때마다 스냅샷을 먹어 첫 답이 기준점을 자기 자신으로 덮어썼기 때문이다.
  //   같은 아침에 「간밤에 뭐 터진 거 있어?」 → 「오늘 브리핑 해줘」를 잇달아 치면 바로 겪는다
  //   (야간 하네스 마당①이 정확히 그 차례라 **매 회차** 나빠지고 있었다).
  it("★ 같은 날 두 번 불러도 「신규」가 사라지지 않는다 — 스냅샷은 하루 한 번만 먹는다", async () => {
    const 첫번 = await buildDailyBriefing({ save: true });
    expect(첫번.newFindings.length, "첫 브리핑: 기준점이 없으니 전부 신규").toBe(2);

    // 도구가 부르는 것과 **똑같이** save:true로 한 번 더 — 여기서 줄이 사라지면 안 된다.
    const 두번 = await buildDailyBriefing({ save: true });
    expect(두번.newFindings.length, "두 번째 물음에서 「지난 브리핑 이후 신규」가 통째로 사라졌다").toBe(2);
  });

  // ⚠ 사람이 「확인했다」를 누른 것(ack 창구)만 기준점을 지금으로 옮긴다.
  // ⚠ 어제 것이 기준점이 된다 — 이것이 「어제 대비 신규」의 실물이다.
  it("★ 어제 스냅샷이 있으면 그 뒤에 생긴 것만 신규다", async () => {
    const 어제 = Date.now() - 26 * 60 * 60 * 1000;
    // 어제 시점엔 critical 결함 하나만 있었다고 두면, 오늘 신규는 high 하나여야 한다.
    const 하나 = listFindingReviews()[0];
    saveBriefingSnapshotForTests(어제, [`${하나.assetId}::${하나.findingKey}`]);
    const b = await buildDailyBriefing({ save: false });
    expect(b.newFindings.length, "어제 이후 새로 생긴 것만 세야 한다").toBe(1);
  });
});
