// 답변 지적 → 회귀셋 흡수 (계획서 중-1의 개발 몫).
// [전중후 계획서 정렬] 중-1의 약속은 "오답·미답 지적은 회귀셋으로 흡수". 이 시험이 지키는 것은
// ① 지적이 버려지지 않는다 ② 자동으로 문항이 되지는 않는다(사람이 편입) ③ 정답을 지어내지 않는다.
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordFeedback, listFeedback, setFeedbackStatus, feedbackSummaryText, feedbackAsGateCases, resetFeedbackForTests,
} from "../src/engine/answerfeedback";

beforeEach(() => resetFeedbackForTests());

describe("답변 지적 수집", () => {
  it("지적을 남기면 그대로 보관된다", () => {
    const f = recordFeedback({
      kind: "wrong", question: "KEV 조치 기한이 며칠이야?", answer: "30일입니다",
      note: "KEV는 2주가 기본인데 30일로 답했다", expected: "2주", actor: "정요한",
    });
    expect(f.id).toBeGreaterThan(0);
    const rows = listFeedback(7);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toContain("2주가 기본");
    expect(rows[0].status).toBe("open");
  });

  it("질문이 없으면 받지 않는다 — 무엇에 대한 지적인지 모르면 쓸 수 없다", () => {
    expect(() => recordFeedback({ kind: "wrong", question: "   ", answer: "x" })).toThrow();
  });

  it("처리해도 지워지지 않는다 — 무엇을 못 고쳤는지가 정보다", () => {
    const f = recordFeedback({ kind: "missing", question: "반출 절차 알려줘", answer: "못 찾음" });
    setFeedbackStatus(f.id, "dismissed", "검토자");
    const rows = listFeedback(7);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("dismissed");
  });
});

describe("회귀 문항 초안", () => {
  it("미처리 지적만 문항 초안이 된다", () => {
    const a = recordFeedback({ kind: "wrong", question: "질문A", answer: "답A", expected: "정답A" });
    recordFeedback({ kind: "wrong", question: "질문B", answer: "답B" });
    setFeedbackStatus(a.id, "promoted");
    const cases = feedbackAsGateCases(30);
    expect(cases.map((c) => c.q)).toEqual(["질문B"]); // 편입 끝난 건 다시 안 나온다
  });

  it("담당자가 정답을 적어 준 경우에만 expect를 만든다 — 없으면 지어내지 않는다", () => {
    recordFeedback({ kind: "wrong", question: "질문C", answer: "답C" });
    const [c] = feedbackAsGateCases(30);
    expect(c.expect).toBeUndefined();
    expect(c._출처).toContain("실사용 지적");
  });

  it("정규식 특수문자가 든 정답도 안전하게 문항이 된다", () => {
    recordFeedback({ kind: "wrong", question: "질문D", answer: "답D", expected: "CVE-2021-44228 (Log4Shell)" });
    const [c] = feedbackAsGateCases(30);
    expect(new RegExp(c.expect![0]).test("CVE-2021-44228 (Log4Shell)")).toBe(true);
  });

  it("말투 지적은 게이트 문항 감이 아니다", () => {
    recordFeedback({ kind: "style", question: "질문E", answer: "답E", note: "너무 딱딱함" });
    expect(feedbackAsGateCases(30)).toHaveLength(0);
    expect(listFeedback(7)).toHaveLength(1); // 그래도 기록은 남는다
  });
});

describe("주간 요약", () => {
  it("지적이 없으면 없다고 말하고, 알려 달라고 안내한다", () => {
    expect(feedbackSummaryText(7)).toContain("지적이 없습니다");
  });

  it("있으면 종류별 건수와 미처리 목록을 낸다", () => {
    recordFeedback({ kind: "wrong", question: "KEV 기한?", answer: "30일", note: "2주가 맞다" });
    recordFeedback({ kind: "missing", question: "반출 절차", answer: "못 찾음" });
    const t = feedbackSummaryText(7);
    expect(t).toContain("2건");
    expect(t).toContain("틀린 답");
    expect(t).toContain("2주가 맞다");
    expect(t).toContain("자동 편입은 하지 않습니다"); // 사람이 검토한다는 약속
  });
});
