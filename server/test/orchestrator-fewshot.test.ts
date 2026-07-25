// 골드 few-shot 동적 주입(파인튜닝 대체) — 유사 검색·카탈로그 필터·블록 형식을 검증한다.
// 실 LLM은 부르지 않는다(순수 함수 검증). LLM 효과는 tools/regress 회귀 하네스가 실서버로 잰다.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { findSimilarDecisions, fewshotBlockFor, SEED_DECISIONS } from "../src/engine/orchestrator-dataset";

describe("골드 few-shot 검색(findSimilarDecisions)", () => {
  it("오탐 선언형 지시는 update_finding_status 시드를 최상위로 찾는다(Phase 4 약점 영역)", () => {
    const hits = findSimilarDecisions("이거 오탐 처리해줘, ai-web-03 SSL 만료", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].decision.tool).toBe("update_finding_status");
  });

  it("완전히 무관한 지시는 임계 미달로 빈 배열 — 무관 예시를 주입해 오염시키지 않는다", () => {
    expect(findSimilarDecisions("바나나와 코끼리의 무게 비율", 3)).toEqual([]);
  });

  it("allowedTools에 없는 도구 예시는 제외한다(좁힌 카탈로그 밖 도구 호출 유도 방지)", () => {
    const q = "이거 오탐 처리해줘, ai-web-03 SSL 만료";
    const withTool = findSimilarDecisions(q, 3, new Set(["update_finding_status"]));
    expect(withTool.some((h) => h.decision.tool === "update_finding_status")).toBe(true);
    const withoutTool = findSimilarDecisions(q, 3, new Set(["search"]));
    expect(withoutTool.every((h) => h.decision.tool !== "update_finding_status")).toBe(true);
  });

  it("final(잡담) 예시는 allowedTools와 무관하게 후보에 남는다", () => {
    const hits = findSimilarDecisions("고마워", 3, new Set(["search"]));
    expect(hits.some((h) => h.decision.action === "final")).toBe(true);
  });

  it("k 상한을 지킨다(7B 프롬프트 길이 민감 — 최대 3건)", () => {
    expect(findSimilarDecisions("오탐 처리해줘 SSL 만료 ai-web-03", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("fewshotBlockFor", () => {
  it("유사 예시가 있으면 '지시 → JSON' 한 줄 형식 블록을 만든다", () => {
    const block = fewshotBlockFor("이거 오탐 처리해줘, ai-web-03 SSL 만료");
    expect(block).toContain("승인·검증된 예시");
    expect(block).toContain('"action":"tool"');
    expect(block.split("\n").filter((l) => l.startsWith("지시 ")).length).toBeLessThanOrEqual(3);
  });

  it("무관 지시는 빈 문자열 — 프롬프트에 아무것도 붙이지 않는다", () => {
    expect(fewshotBlockFor("바나나와 코끼리의 무게 비율")).toBe("");
  });

  it("시드 데이터가 살아있다(파인튜닝 폐기 후에도 few-shot 소스로 사용)", () => {
    expect(SEED_DECISIONS.length).toBeGreaterThanOrEqual(30);
  });
});
