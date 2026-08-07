// 리포트 요약 서두 — 채팅과 **같은 판정**을 쓰는가.
//
// 실측(2026-08-03 실전 147상황, "이번 달 보안 리포트 만들어줘"):
//   담당자 화면에 `우선, 1페이지 요약에 대해 알려드리겠습니다.`가 그대로 나갔다.
//   채팅 쪽(stripLeadingPreamble)은 이 문장을 잡는데, 리포트 쪽(stripMetaPreamble)이
//   **자기 목록을 따로 들고 있어서** 놓쳤다. 같은 일을 두 벌로 하면 반드시 어긋난다.
import { describe, it, expect } from "vitest";
import { stripLeadingPreamble } from "../src/engine/llm";
import { 예고서두인가 } from "../src/engine/tone";
import { stripMetaPreamble } from "../src/engine/report";

// [2026-08-07 147상황 6차 실측 추가] 시스템 프롬프트 복창 두 문장이 목록 밖이라 담당자에게
// 그대로 나갔다 — "…정보를 요청합니다. 당신은 보안 AI 입니다." 꼴을 걷어내는 계약을 못 박는다.
it("★ 프롬프트 자기소개 복창(「당신은 …입니다」)이 서두에서 걷힌다", () => {
  const 실측 = "최근 내부 보고서 작성에 필요한 정보를 요청합니다. 당신은 보안 AI 입니다.\n\n1. 주요 취약점은 매우 심각(P0)의 Apache Log4j 2.14.1 이하입니다.";
  const r = stripMetaPreamble(실측);
  expect(r).not.toContain("당신은");
  expect(r).not.toContain("정보를 요청합니다");
  expect(r, "실제 내용 문장은 보존").toContain("Apache Log4j");
});

describe("예고 서두 판정은 한 벌이다", () => {
  const 예고들 = [
    "우선, 1페이지 요약에 대해 알려드리겠습니다.",
    "취약점 현황을 정리해 드리겠습니다.",
    "보안 상황을 보고드리겠습니다.",
  ];

  it("★ 채팅이 잡는 것은 리포트도 잡는다", () => {
    for (const 예고 of 예고들) {
      const 본문 = "미조치 취약점 14건, 실제 악용(KEV) 8건입니다.";
      const 채팅 = stripLeadingPreamble(`${예고}\n\n${본문}`);
      const 리포트 = stripMetaPreamble(`${예고}\n\n${본문}`);
      expect(채팅.startsWith(예고.slice(0, 6)), `채팅이 못 잡는다: ${예고}`).toBe(false);
      expect(리포트.startsWith(예고.slice(0, 6)), `리포트가 못 잡는다: ${예고}`).toBe(false);
    }
  });

  it("★ 앞에 다른 문장이 있어도 리포트가 잡는다", () => {
    // 이것이 실제로 새어 나간 모양이다 — 앞 문장에서 채팅 쪽 잘라내기가 멈춘다.
    const 실제 = "보안 현황 요약입니다. 우선, 1페이지 요약에 대해 알려드리겠습니다.\n\n1. 자산 57건 중 취약점 14건이 확인되었습니다.";
    const out = stripMetaPreamble(stripLeadingPreamble(실제));
    expect(out, `예고가 남았다: ${out.slice(0, 60)}`).not.toContain("알려드리겠습니다");
    expect(out, "본문까지 지웠다").toContain("57건");
  });

  it("★ 오탐 방지 — 실제 내용 문장은 안 지운다", () => {
    for (const 정상 of [
      "미조치 취약점은 14건입니다.",
      "KEV 8건이 최우선 조치 대상입니다.",
      "즉시 패치를 적용해야 합니다.",
    ]) {
      expect(예고서두인가(정상), `정상 문장을 예고로 본다: ${정상}`).toBe(false);
    }
  });

  it("이 시험이 헛돌고 있지 않다", () => {
    expect(예고서두인가("정리해 드리겠습니다."), "판정 자체가 죽어 있다").toBe(true);
  });
});
