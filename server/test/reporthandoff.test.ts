// 보고서꼴 조기 전환 — [2026-08-07 · 150상황 재측정(14B)에서 보고서 3건이 32~42초]
//
// 원칙: 전환은 "미리 판단"이 아니라 "시간 넘으면"이다(longanswer.ts 머리말). 이 기능은 그
//   원칙의 **좁은 예외**다 — "보고서 만들어줘"는 리포트가 곧 요청물이라, 리포트로 저장해
//   알리는 것이 답을 깎는 게 아니다. 그래도 3초는 기다린다(가벼운 데이터면 그 자리에서 답).
// ⚠ 판별은 보고서꼴() **한 곳**이다 — ops-sim 판정기는 서버 신호(wouldHandoff)를 받는다.
//   판정기가 판별을 흉내 내기 시작하면 두 판별이 어긋나고 측정이 제품과 다른 것을 잰다.
import { describe, it, expect } from "vitest";
import { 보고서꼴, REPORT_HANDOFF_MS, LONG_ANSWER_MS } from "../src/engine/longanswer";

describe("보고서꼴 판별 — 만드는 동사가 붙은 보고서·리포트만", () => {
  it("★ 재측정에서 32~42초 걸린 세 문장을 받는다", () => {
    expect(보고서꼴("내부 검토용 리포트 만들어줘")).toBe(true);
    expect(보고서꼴("경영진 보고용으로 짧게 요약해줘")).toBe(true);
    expect(보고서꼴("미조치 취약점 보고서 만들어줘")).toBe(true);
  });
  it("★★ 조회·일정은 받지 않는다 — 빠른 답을 리포트로 밀어내면 오히려 불편", () => {
    expect(보고서꼴("리포트 스케줄 확인해줘")).toBe(false);
    expect(보고서꼴("다음 정기 리포트 언제야?")).toBe(false);
    expect(보고서꼴("어제 만든 보고서 어디 있어?")).toBe(false);
    expect(보고서꼴("오늘 뭐부터 볼까?")).toBe(false);
  });
  it("문턱 — 보고서꼴은 3초, 일반은 30초 그대로", () => {
    expect(REPORT_HANDOFF_MS).toBe(3_000);
    expect(LONG_ANSWER_MS).toBe(30_000);
    expect(REPORT_HANDOFF_MS).toBeLessThan(LONG_ANSWER_MS);
  });
});
