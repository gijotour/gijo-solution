// 사내 규정 조회 결정화 — [2026-08-07 · 시연 대본 대조 실측이 잡은 결함]
//
// 실측: 시연 ③이 가르치는 「접속기록 보관 기간 규정 알려줘」를 LLM이 법제처(외부 API)로
//   보냈고, 그 API가 IP 검증으로 거부하자 **오류문이 담당자에게 그대로** 나갔다.
//   사내 규정은 사내 문서(RAG)가 근거다 — explain으로 못 박는다.
// ⚠ 이웃 셋을 안 삼키는 것이 계약의 절반이다: 법령(외부가 정답)·판정 이력·행동 대조.
import { describe, it, expect } from "vitest";
import { forcedToolFor, 사내규정질문 } from "../src/engine/agentloop";

describe("사내 규정 조회 — 사내 문서로 못 박는다", () => {
  it("★ 시연 대본 문장이 explain(사내 문서)으로 간다", () => {
    expect(forcedToolFor("접속기록 보관 기간 규정 알려줘")?.tool).toBe("explain");
    expect(forcedToolFor("백업 정책 뭐야?")?.tool).toBe("explain");
    expect(forcedToolFor("패스워드 지침 확인해줘")?.tool).toBe("explain");
  });

  it("★★ 법령을 명시하면 비켜 준다 — 외부(법제처)가 정답인 질문을 뺏으면 그게 오답이다", () => {
    expect(사내규정질문("금융권 망분리 법적 근거가 뭐야?")).toBe(false);
    expect(사내규정질문("개인정보보호법 법령 알려줘")).toBe(false);
  });

  it("★★ 이웃을 안 삼킨다 — 판정 이력·행동 대조는 다른 말이다", () => {
    expect(forcedToolFor("규정 대조 이력 보여줘")?.tool, "해자 슬라이스 1의 영토").toBe("action_check_history");
    expect(사내규정질문("USB 반출 정책 완화해도 돼?"), "행동 대조(쓰기 판정) 영토").toBe(false);
    expect(사내규정질문("점검 기록 보여줘")).toBe(false);
  });
});
