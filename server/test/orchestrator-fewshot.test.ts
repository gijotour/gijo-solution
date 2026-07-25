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

// ── 도구 결과 부정 방지 안전망 ──────────────────────────────────────────────
// 실측(2026-07-25): search가 자산·취약점을 반환했는데 7B 최종답이 "찾을 수 없습니다"로 뒤집었다.
// 프롬프트 강화로도 재발 → 코드로 막는다(7B 교정은 코드로 한다는 원칙).
import { guardAgainstDenial } from "../src/engine/agentloop";

describe("guardAgainstDenial", () => {
  const dataCall = [
    {
      tool: "search",
      args: { query: "안전대부" },
      result:
        "AI 자산 1건:\n  - vuln:certify.aj-safe.co.kr | 안전대부 본인인증 웹 서버 | infra-host | finding 3건\n취약점 3건(우선순위순):\n  - [medium] [IW-32] 데이터 평문 전송",
    },
  ];

  it("도구가 데이터를 줬는데 LLM이 부정하면 조회 결과 원문으로 되돌린다", () => {
    const out = guardDenial("안전대부 웹서버에 대한 취약점 정보를 찾을 수 없습니다.", dataCall);
    expect(out).toContain("조회 결과입니다");
    expect(out).toContain("IW-32");
  });

  it("정상 답변(데이터를 다룬 답)은 그대로 통과시킨다", () => {
    const good = "안전대부 본인인증 웹 서버에서 3건이 확인됐습니다. [IW-32] 데이터 평문 전송이 medium으로 가장 시급합니다.";
    expect(guardDenial(good, dataCall)).toBe(good);
  });

  it("도구 결과가 실제로 0건이면 '없다'는 답을 유지한다(거짓 양성 방지)", () => {
    const empty = [{ tool: "search", args: { query: "없는것" }, result: '"없는것"에 해당하는 자산·취약점·보안제품·문서·온톨로지 관계를 찾지 못했습니다.' }];
    const ans = "해당 자산을 찾을 수 없습니다.";
    expect(guardDenial(ans, empty)).toBe(ans);
  });

  it("도구 호출이 없으면 그대로 통과", () => {
    const ans = "관련 정보를 찾을 수 없습니다.";
    expect(guardDenial(ans, [])).toBe(ans);
  });
});

// 헬퍼 — 테스트 가독성을 위해 인자 타입만 좁혀 감싼다.
function guardDenial(answer: string, calls: { tool: string; args: Record<string, string>; result: string }[]): string {
  return guardAgainstDenial(answer, calls);
}
