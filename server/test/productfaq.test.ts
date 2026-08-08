// 제품 지식 즉답 카드 — [2026-08-08 · 야간 150상황의 마지막 불편 3건에서]
//
// 계약: ① 실측에서 30초 걸리던 세 물음이 즉시 잡힌다 ② 판별은 좁다 — 같은 낱말의 조회·쓰기·
//   개념 물음은 안 삼킨다(겹침 0 원칙) ③ 카드 답에는 「이어서」 갈 곳이나 확인 자리가 있다.
import { describe, it, expect } from "vitest";
import { faqAnswerFor, FAQ_CARDS } from "../src/engine/productfaq";

describe("지식 카드 — 실측 3문이 잡힌다", () => {
  it("★ CEF 헤더 구조(야간 32.7초)", () => {
    expect(faqAnswerFor("CEF 로그 헤더 구조 알려줘")?.id).toBe("cef-header");
    expect(faqAnswerFor("CEF 헤더 형식이 뭐야?")?.id).toBe("cef-header");
  });
  it("★ 학습 내용 확인(야간 30초대)", () => {
    expect(faqAnswerFor("AI가 뭘 학습했는지 볼 수 있어?")?.id).toBe("what-ai-learned");
  });
  it("★ 지어냄 식별(야간 30.8초)", () => {
    expect(faqAnswerFor("AI가 답을 지어내면 어떻게 알아?")?.id).toBe("how-to-spot-hallucination");
  });
});

describe("좁은 판별 — 딴 물음은 안 삼킨다", () => {
  it("★★ 데이터 조회·쓰기·무관 질문은 통과시킨다", () => {
    expect(faqAnswerFor("CEF 로그 최근 것 보여줘")).toBeNull();      // 데이터 조회
    expect(faqAnswerFor("지금 학습 시작해줘")).toBeNull();            // 쓰기
    expect(faqAnswerFor("오늘 뭐부터 볼까?")).toBeNull();             // 무관
    expect(faqAnswerFor("미조치 취약점 알려줘")).toBeNull();          // 데이터 조회
  });
});

describe("답의 됨됨이", () => {
  it("모든 카드에 다음 갈 곳 또는 확인 자리가 있다 — 숫자만 주고 끝내지 않는 원칙의 지식판", () => {
    for (const c of FAQ_CARDS) {
      expect(c.answer.length, c.id).toBeGreaterThan(120);
      expect(/화면|대화창|지적|▸|\"/.test(c.answer), c.id + "에 갈 곳이 없다").toBe(true);
    }
  });
});
