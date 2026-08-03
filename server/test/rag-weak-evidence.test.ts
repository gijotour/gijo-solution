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
    expect(llm소스, "답을 버리고 있다").toMatch(/근거 약함[^\n]*\\n\\n\$\{reply\}/);
  });

  it("이미 「못 찾았다」고 말한 답에는 두 번 안 붙인다", () => {
    expect(llm소스, "같은 말을 두 번 붙인다").toMatch(/!\/근거 약함\|없습니다\|확인되지\//);
  });

  it("모델에게 시키는 게 아니라 코드가 붙인다", () => {
    expect(llm소스).toContain("코드가 문장을 붙인다");
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    expect(llm소스.length, "llm.ts를 못 읽었다").toBeGreaterThan(20000);
    expect(memory소스, "graded 조회가 없다").toContain("queryMemoryGraded");
  });
});

describe("★ 재는 쪽과 재이는 쪽이 같은 말을 쓰지 않는다", () => {
  // 실측(2026-08-03): 처음 쓴 문구가 「직접적인 사내 자료는 **찾지 못했습니다**」였는데,
  //   그 말이 서랍 점검의 **폴백 문구 목록**에 그대로 있었다(drawer-audit.mjs FAIL_MARKS).
  //   → **좋은 답에도 실패 딱지**가 붙었다.
  //   반대로 평가 게이트는 `없|찾지 못|확인되지`를 정직 표현으로 **인정**해,
  //   나쁜 답이 문구 덕에 통과할 수도 있었다 — 같은 말이 한쪽에선 벌, 한쪽에선 상이었다.
  //
  // ⚠ 측정 도구가 오염되면 **그 뒤 숫자를 전부 못 믿는다.** 그래서 여기서 못 박는다.
  const 서랍 = fs.readFileSync(path.join(__dirname, "../../tools/drawer-audit.mjs"), "utf8");

  /** 제품이 실제로 붙이는 근거-약함 머리말을 소스에서 뽑는다(문구를 시험에 복사하지 않는다). */
  function 실제문구(): string {
    // ⚠ 정규식으로 뽑다 두 번 틀렸다(줄바꿈 이스케이프). **줄을 찾아 잘라** 쓴다.
    const 줄 = llm소스.split("\n").find((l) => l.includes("reply = `${표식.") && l.includes("**"));
    if (!줄) return "";
    const i = 줄.indexOf("} ") + 2;                 // 표식 뒤부터
    return 줄.slice(i).replace(/\*/g, "").split("—")[0].trim();
  }

  it("근거-약함 문구가 폴백 목록과 겹치지 않는다", () => {
    const 문구 = 실제문구();
    expect(문구.length, "제품 문구를 소스에서 못 뽑았다 — 이 감시가 헛돈다").toBeGreaterThan(3);
    const 목록 = /const FAIL_MARKS = \[([\s\S]*?)\];/.exec(서랍);
    expect(목록, "폴백 목록을 못 읽었다").toBeTruthy();
    const 폴백말 = [...목록![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(폴백말.length, "폴백 말이 하나도 없다").toBeGreaterThan(5);
    const 겹침 = 폴백말.filter((w) => 문구.includes(w));
    expect(겹침, `제품 문구 "${문구}"가 폴백 말과 겹친다: ${겹침.join(", ")} — 좋은 답에 실패 딱지가 붙는다`).toEqual([]);
  });

  it("측정 도구도 근거-약함 머리말을 떼고 본다(이중 안전장치)", () => {
    // 제품이 문구를 또 바꿔도 측정이 안 깨지게, 재는 쪽에서도 한 번 더 거른다.
    expect(서랍, "서랍 점검이 근거-약함 머리말을 안 떼고 본다").toContain("근거약함머리");
  });
});
