// 법령 답의 원문 발췌가 답을 2,000자 너머로 밀지 않는가 (2026-08-16, 야간회귀 하락 대응)
//
// ■ 왜: 「개인정보 접속기록 몇 년 보관?」 답이 야간회귀 3연속으로 「너무 긺」(2,588자)이었다.
//   내용은 정답인데 길이만 초과 — 담당자는 2,000자 넘으면 안 읽는다(하네스 판정 기준).
//   원인: 답 본문에는 상한(400토큰≈800자)이 있는데, 거기 붙는 **법제처 원문(law.result)**에는
//   상한이 없어 조문이 길면 통째로 넘쳤다. 원문은 참고라 앞부분만 보이고 접는다.
import { describe, it, expect } from "vitest";
import { 법령한계를밝힌다 } from "../src/engine/agentloop";
import type { AgentToolCall } from "../src/engine/agentloop";

// 사내지식 꼬리표 도구가 함께 있어야 「원문 덧붙이기」 갈래로 간다(그 갈래가 길어지던 자리).
function calls(원문: string): AgentToolCall[] {
  return [
    { tool: "law_lookup", args: {}, result: 원문 },
    { tool: "사내지식", args: {}, result: "사내 규정: 접속기록은 1년 이상 보관." },
  ] as unknown as AgentToolCall[];
}

describe("법령 원문 발췌 — 답을 2,000자 너머로 밀지 않는다", () => {
  const 본문 = "개인정보처리시스템의 접속기록은 최소 1년 이상 보관해야 합니다."; // 답 본문(짧음)

  it("★ 긴 조문 원문이 붙어도 전체 답이 2,000자를 넘지 않는다", () => {
    const 긴원문 = "제29조(안전조치의무) ".repeat(300); // ~4,000자짜리 조문 원문
    const 답 = 법령한계를밝힌다(본문, calls(긴원문));
    expect(답.length, `답이 ${답.length}자 — 담당자가 안 읽는 길이`).toBeLessThan(2000);
    expect(답, "원문을 접었다는 표시가 없다").toContain("앞부분만 보입니다");
    expect(답, "면책 꼬리는 그대로 있어야 한다").toContain("법률 자문이 아닙니다");
  });

  it("짧은 원문은 그대로 둔다 — 접기는 넘칠 때만", () => {
    const 짧은원문 = "제29조(안전조치의무) 개인정보처리자는 안전성 확보에 필요한 조치를 하여야 한다.";
    const 답 = 법령한계를밝힌다(본문, calls(짧은원문));
    expect(답, "짧은 원문을 불필요하게 접었다").not.toContain("앞부분만 보입니다");
    expect(답).toContain(짧은원문.trim());
  });

  it("law_lookup이 없으면 답을 건드리지 않는다(기존 계약)", () => {
    const 그대로 = 법령한계를밝힌다(본문, [{ tool: "search", args: {}, result: "x" }] as unknown as AgentToolCall[]);
    expect(그대로).toBe(본문);
  });
});
