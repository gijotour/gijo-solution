// 모델 채택 원장 (계획서 중-4 "게이트 통과분만 배포").
// [전중후 계획서 정렬] 지키는 것: 모델 변경에 근거가 남는다 · 근거 없는 변경을 감추지 않는다.
import { describe, it, expect, beforeEach } from "vitest";
import { recordAdoption, listAdoptions, currentBasis, adoptionSummaryText, resetAdoptionsForTests } from "../src/engine/modeladoption";

const GATE = {
  verdict: "통과",
  axes: { routing: { passRate: 100 }, safety: { passRate: 100 }, korean: { passRate: 95.8 } },
  robustness: { score: 36 },
  meta: { caseSetHash: "abc123", gitRev: "deadbee" },
};

beforeEach(() => resetAdoptionsForTests());

describe("모델 채택 원장", () => {
  it("채택하면 게이트 근거가 함께 남는다", () => {
    recordAdoption({ agentId: "orchestrator", fromModel: "a", toModel: "b", verdict: "pass", gate: GATE, decidedBy: "정요한" });
    const basis = currentBasis("orchestrator");
    expect(basis?.toModel).toBe("b");
    expect(JSON.parse(basis!.gate!).axes.routing.passRate).toBe(100);
  });

  it("보류는 채택 근거가 되지 않는다 — 되돌린 후보가 '지금 쓰는 모델'로 보이면 안 된다", () => {
    recordAdoption({ agentId: "orchestrator", fromModel: "a", toModel: "b", verdict: "pass", gate: GATE });
    recordAdoption({ agentId: "orchestrator", fromModel: "b", toModel: "c", verdict: "hold", gate: GATE });
    expect(currentBasis("orchestrator")?.toModel).toBe("b");
  });

  it("게이트 없이 바꾼 변경은 '근거 없음'으로 남고 요약에서 먼저 경고한다", () => {
    recordAdoption({ agentId: "analysis", fromModel: null, toModel: "x", verdict: "none" });
    const t = adoptionSummaryText(10);
    expect(t).toContain("근거 없이");
    expect(t).toContain("1건은 평가 게이트 근거 없이");
  });

  it("기록이 없으면 절차를 안내한다", () => {
    expect(adoptionSummaryText(10)).toContain("adopt.mjs");
  });

  it("이력은 최신순으로 쌓인다", () => {
    recordAdoption({ agentId: "a1", verdict: "pass", gate: GATE });
    recordAdoption({ agentId: "a2", verdict: "hold", gate: GATE });
    expect(listAdoptions(10).map((r) => r.agentId)).toEqual(["a2", "a1"]);
  });
});
