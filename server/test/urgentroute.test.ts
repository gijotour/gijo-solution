// 급한 것·컴플라이언스 부정형 결정화 — [2026-08-07 · 150상황 재측정(14B 전환 직후)]
//
// 발견: 모델이 도구를 **맞게 고르는데 고르는 데만 30~41초**를 썼다(답 자체는 0.2초짜리 결정적
//   도구 출력). 규칙이 아슬하게 못 받는 꼴이었다 — 「급한 (취약점|건|것)」은 있는데 「급한 게」가
//   없었고, 컴플라이언스는 현황/요약 꼴만 있고 「대응 안 된」 부정형이 없었다.
// 계약: 겹침 0 — 기존 규칙의 영토(급한 취약점→today, 배정 흐름)는 그대로 둔다.
import { describe, it, expect } from "vitest";
import { forcedToolFor } from "../src/engine/agentloop";

describe("[53] 대상 없는 「급한」 — urgent_todo 결정화", () => {
  it("★ 재측정에서 41초·31초 걸리던 두 문장이 즉시 잡힌다", () => {
    expect(forcedToolFor("지금 제일 급한 게 뭐야?", {})?.tool).toBe("urgent_todo");
    expect(forcedToolFor("지금 제일 급한 위험 뭐야?", {})?.tool).toBe("urgent_todo");
  });
  it("변형도 잡는다", () => {
    expect(forcedToolFor("오늘 가장 급한 일 알려줘", {})?.tool).toBe("urgent_todo");
    expect(forcedToolFor("지금 급한 거 뭐 있어?", {})?.tool).toBe("urgent_todo");
  });
  it("★★ 「급한 취약점」은 today 영토 그대로 — 취약점 우선순위가 정답", () => {
    expect(forcedToolFor("지금 가장 급한 취약점 알려줘", {})?.tool).toBe("today");
  });
  it("★★ 쓰기 재료 흐름은 삼키지 않는다 — 「급한 거 김보안한테 배정해줘」", () => {
    const r = forcedToolFor("오늘 제일 급한 거 김보안한테 배정해줘", {});
    expect(r?.tool ?? "(없음)").not.toBe("urgent_todo");
  });
});

describe("[54] 컴플라이언스 부정형 — compliance_status 결정화", () => {
  it("★ 재측정에서 31.5초 걸리던 문장이 즉시 잡힌다", () => {
    expect(forcedToolFor("컴플라이언스 대응 안 된 항목 알려줘", {})?.tool).toBe("compliance_status");
  });
  it("변형 — 미대응·미이행", () => {
    expect(forcedToolFor("컴플라이언스 미대응 항목 보여줘", {})?.tool).toBe("compliance_status");
    expect(forcedToolFor("규제 미이행 항목 있어?", {})?.tool).toBe("compliance_status");
  });
  it("긍정형(현황·요약)은 기존 규칙이 그대로 받는다 — 겹침이 아니라 분담", () => {
    expect(forcedToolFor("컴플라이언스 현황 요약해줘", {})?.tool).toBe("compliance_status");
  });
});
