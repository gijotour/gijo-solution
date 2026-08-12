// 담당자 말투를 검색용으로 다듬는다 — 뜻은 그대로, 군말·종결 물음만(2026-08-12).
//
// ■ 왜 만들었나 (실측)
//   같은 문서를 두 말투로 물으면 **거리가 평균 0.19 벌어졌다**. 8쌍 중 6쌍이 밀렸고
//   2쌍은 「근거 약함」 문턱(0.85)을 넘었다. `aws_s3`는 0.849로 **0.001 차이**로 겨우 통과했다.
//     "KEV에 올라오면 며칠 안에 해야 하는 거였지?"  0.888  ← 문턱 밖
//     "CISA KEV 조치 기한"                        0.541
//   담당자는 말로 묻는데 문서는 문어체다. 그 간극이 「자료가 있는데 못 닿는다」의 큰 몫이었다.
//
// ■ ⚠ 이 시험이 지키는 것은 **「주제어가 살아남는가」**다.
//   많이 깎을수록 거리는 좋아지지만, 뜻이 사라지면 엉뚱한 문서를 부른다.
//   그래서 원문 검색을 **버리지 않고 합치는** 설계이고(memory.ts), 여기서는 깎는 쪽을 못박는다.
import { describe, it, expect } from "vitest";
import { normalizeForSearch } from "../src/engine/hybridsearch";

describe("말투 다듬기 — 군말·종결만 뗀다", () => {
  const 사례: [string, string[]][] = [
    // [질문, 반드시 남아야 하는 주제어들]
    ["KEV에 올라오면 며칠 안에 해야 하는 거였지?", ["KEV", "며칠"]],
    ["브루트포스 같은 게 계속 보이는데 어디부터 봐야 하지?", ["브루트포스"]],
    ["S3에 퍼블릭 걸린 게 있대. 뭐부터 확인해?", ["S3", "퍼블릭"]],
    ["개인정보 샜을 때 언제까지 알려야 해?", ["개인정보", "언제까지"]],
    ["log4j 그거 어떻게 막아?", ["log4j"]],
    ["IPS가 자꾸 같은 걸 잡는데 어떡하지?", ["IPS"]],
  ];
  for (const [질문, 남을것] of 사례) {
    it(`주제어가 남는다: "${질문.slice(0, 22)}…"`, () => {
      const r = normalizeForSearch(질문);
      // 빈 문자열이면 "안 쓴다"는 뜻이라 원문만 검색한다 — 그것도 안전한 결과다.
      if (!r) return;
      for (const 낱말 of 남을것) {
        expect(r, `주제어가 사라졌다: ${낱말} — "${질문}" → "${r}"`).toContain(낱말);
      }
      expect(r.length, `원문보다 길어졌다: "${r}"`).toBeLessThanOrEqual(질문.length);
    });
  }

  it("★ 너무 많이 깎이면 아예 안 쓴다(빈 문자열)", () => {
    // 뜻이 안 남을 만큼 깎였는데 그걸로 검색하면 엉뚱한 문서를 부른다. 그럴 바엔 원문만 쓴다.
    expect(normalizeForSearch("그거 뭐지?")).toBe("");
    expect(normalizeForSearch("어떡하지?")).toBe("");
  });

  it("★ 바꿀 것이 없으면 빈 문자열 — 같은 질의를 두 번 태우지 않는다", () => {
    // 원문과 같으면 임베딩·검색을 한 번 더 하는 값이 없다.
    expect(normalizeForSearch("CISA KEV 조치 기한")).toBe("");
    expect(normalizeForSearch("브루트포스 탐지 룰")).toBe("");
  });

  it("빈 입력·공백에도 안 죽는다", () => {
    expect(normalizeForSearch("")).toBe("");
    expect(normalizeForSearch("   ")).toBe("");
  });
});
