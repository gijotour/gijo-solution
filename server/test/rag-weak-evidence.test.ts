// 근거가 **멀 때는 멀다고 먼저 말한다.**
//
// 왜 필요한가(2026-08-03 실측): "우리 회사 2019년 정보보호 감사 결과 알려줘"에
//   **2024년 사이버 위협 동향 보고서** 내용을 답했다(그 조각의 거리 0.908).
//   3회 재현에 3회 다 다른 답이 나왔다 — 흔들리는 답은 맞아도 못 믿는다.
//
// ★ 거리 실측(운영 지식베이스 84문서):
//     있는 자료  방화벽 절차 0.56 · 레드팀 0.77 · AI-BOM 0.80 · SLA 0.82 · KISA 0.85
//     없는 자료  ISMS 지적 0.77 · 개인정보 유출 0.80 · **2019 감사 0.91** · 창립기념일 1.13
//   **두 무리가 겹친다.** 그래서 문턱 하나로는 못 자른다 —
//   0.85로 내리면 KISA(0.849)가 아슬아슬하고, 0.95로 두면 위 사고가 난다.
//   자르는 대신 **세기를 밝힌다.**
//
// ⚠ 모델에게 "약하면 밝혀라"라고 시키지 않는다 — 프롬프트로 행동을 교정하는 방식은
//   이 프로젝트에서 반복해 실패했다(7B 규칙 추가 3회 실패). **코드가 문장을 붙인다.**
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RAG_STRONG_MAX_DISTANCE, RAG_RELEVANCE_MAX_DISTANCE } from "../src/engine/memory";

const llm소스 = fs.readFileSync(path.join(__dirname, "../src/engine/llm.ts"), "utf8");
const memory소스 = fs.readFileSync(path.join(__dirname, "../src/engine/memory.ts"), "utf8");

describe("근거 세기 두 단계", () => {
  it("가까움 문턱이 무관 문턱보다 엄격하다", () => {
    expect(RAG_STRONG_MAX_DISTANCE).toBeLessThan(RAG_RELEVANCE_MAX_DISTANCE);
  });

  it("★ 실측한 「있는 자료」가 전부 가까움으로 남는다", () => {
    // 이 값들이 문턱 위로 올라가면 근거를 굶겨 「모른다」만 하는 제품이 된다 — 반대 방향의 사고.
    const 있는자료거리 = { "방화벽 절차": 0.559, 레드팀: 0.767, "AI-BOM": 0.797, SLA: 0.822, KISA: 0.849 };
    const 밀려난것 = Object.entries(있는자료거리).filter(([, d]) => d > RAG_STRONG_MAX_DISTANCE).map(([k]) => k);
    expect(밀려난것, `문턱이 너무 엄격하다 — 있는 자료가 「멀다」로 분류된다: ${밀려난것.join(", ")}`).toEqual([]);
  });

  it("★ 사고를 낸 「2019 감사」(0.908)는 멂으로 분류된다", () => {
    expect(0.908).toBeGreaterThan(RAG_STRONG_MAX_DISTANCE);
    expect(0.908).toBeLessThanOrEqual(RAG_RELEVANCE_MAX_DISTANCE); // 버리지는 않는다
  });

  it("코드가 글자 그대로 걸린 것은 거리와 무관하게 가까운 근거로 본다", () => {
    // CVE-2021-44228처럼 코드가 조각에 실제로 있으면 그건 확실한 근거다.
    expect(memory소스, "lexicalHit를 안 본다 — CVE 질문이 「멀다」로 분류된다").toContain("c.lexicalHit ||");
  });
});

describe("★ 붙이는 방식이 정직한가 — 소스 감시", () => {
  it("답을 버리지 않고 **앞에 한 줄만** 붙인다", () => {
    expect(llm소스, "약한 근거 처리가 없다").toContain("약한근거만");
    // 답을 통째로 대체하면 담당자는 실마리조차 못 받는다.
    expect(llm소스, "답을 버리고 있다").toMatch(/찾지 못했습니다[^\n]*\\n\\n\$\{reply\}/);
  });

  it("이미 「못 찾았다」고 말한 답에는 두 번 안 붙인다", () => {
    expect(llm소스, "같은 말을 두 번 붙인다").toMatch(/!\/찾지 못\|없습니다\|확인되지\//);
  });

  it("모델에게 시키는 게 아니라 코드가 붙인다", () => {
    expect(llm소스).toContain("코드가 문장을 붙인다");
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    expect(llm소스.length, "llm.ts를 못 읽었다").toBeGreaterThan(20000);
    expect(memory소스, "graded 조회가 없다").toContain("queryMemoryGraded");
  });
});
