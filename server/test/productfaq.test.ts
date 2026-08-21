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
  it("★ 제품 상태·성숙도(2026-08-21 코퍼스 QA — GA 공식출시 환각 차단)", () => {
    // GA·출시·성숙도·파일럿 물음은 영업 유도로 결정적 답(지어내지 않음)
    for (const q of ["GIJO AS의 GA 판정 상태나 향후 계획이 어떻게 돼?", "제품 성숙도 어때?", "정식 출시 됐어?", "파일럿 대상이 누구야?"]) {
      expect(faqAnswerFor(q)?.id, q).toBe("product-status");
    }
    // 답이 「영업 문의」로 유도하고, 거짓 GA 주장이 없어야 한다
    const a = faqAnswerFor("GIJO AS GA 상태?")!.answer;
    expect(/영업|도입 담당/.test(a), "영업 유도").toBe(true);
    expect(/GA\s*상태에?\s*(있|이며)|공식\s*출시된/.test(a), "거짓 GA 주장 없어야").toBe(false);
  });
});

describe("좁은 판별 — 딴 물음은 안 삼킨다", () => {
  it("★★ 데이터 조회·쓰기·무관 질문은 통과시킨다", () => {
    expect(faqAnswerFor("CEF 로그 최근 것 보여줘")).toBeNull();      // 데이터 조회
    expect(faqAnswerFor("지금 학습 시작해줘")).toBeNull();            // 쓰기
    expect(faqAnswerFor("오늘 뭐부터 볼까?")).toBeNull();             // 무관
    expect(faqAnswerFor("미조치 취약점 알려줘")).toBeNull();          // 데이터 조회
    expect(faqAnswerFor("GIJO AS가 뭘 해?")).toBeNull();             // 기능(제품소개 몫) — 제품상태 아님
    expect(faqAnswerFor("에디션 뭐가 있어?")).toBeNull();             // 에디션 안내 몫
    expect(faqAnswerFor("GAP 분석 어떻게 해?")).toBeNull();          // GA 오발 방지
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
