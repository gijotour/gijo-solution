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

describe("CVE 설명 — 식별자가 있으면 근거 수집 경로로(모델 자유작문 27~34초 → ~9초)", () => {
  it("★ 「CVE-… 이 뭐야?」가 explain으로 간다", () => {
    const r = forcedToolFor("CVE-2021-44228이 뭐야?");
    expect(r?.tool).toBe("explain");
    expect(r?.args.topic).toBe("CVE-2021-44228");
  });
  it("★★ 조치·절차를 물으면 비켜 준다 — 플레이북의 영토", () => {
    expect(forcedToolFor("CVE-2021-44228 조치 절차 알려줘")?.tool).not.toBe("explain");
  });
});

describe("조건 일괄 배정 — 조건·집합어·이름이 셋 다 있으면 결재판까지 결정적으로", () => {
  it("★ 파일럿 리허설 문장이 bulk_update로 간다(조건·담당자 추출까지)", () => {
    const r = forcedToolFor("고위험인데 미배정인 취약점 전부 담당자 김도희로 배정해줘");
    expect(r?.tool).toBe("bulk_update");
    expect(r?.args.filter).toBe("고위험 미배정");
    expect(r?.args.assignee).toBe("김도희");
  });

  it("★★ 하나라도 빠지면 안 잡는다 — 잘못 일괄하면 4,800건을 엉뚱하게 쓴다", () => {
    expect(forcedToolFor("가장 급한 취약점에 담당자 배정해줘")?.tool, "단건(집합어 없음)").not.toBe("bulk_update");
    expect(forcedToolFor("전부 배정해줘")?.tool, "조건도 이름도 없음").not.toBe("bulk_update");
    expect(forcedToolFor("고위험 취약점 전부 배정해줘")?.tool, "담당자 이름 없음 — 되물어야 한다").not.toBe("bulk_update");
  });
});
