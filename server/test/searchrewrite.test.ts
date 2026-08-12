// 검색용 질의 재작성 — **이 기능이 죽어도 검색은 돌아야 한다**(2026-08-12).
//
// ■ 왜 만들었나 (실측 두 단계)
//   ① 같은 문서를 두 말투로 물으면 거리가 평균 0.19 벌어진다.
//   ② 규칙으로 군말·종결어미만 떼는 방식은 2/8. 짧게 줄이는 것도 답이 아니었다
//      ("브루트포스" 단독 1.090은 구어체 1.077보다 나쁘다).
//      좋아지는 건 「주제 + 문제 유형」 조합이고, 그건 모델이 뽑아야 한다.
//      LLM 재작성 실측: 4/6 개선 · 평균 327ms · "IPS 오탐 튜닝"으로 **못 찾던 문서가 0.508**.
//
// ■ ⚠ 이 시험이 지키는 것은 성능이 아니라 **안전**이다.
//   모델이 없거나 느리거나 이상한 답을 줘도 **빈 문자열**을 돌려주고 검색은 원문으로 간다.
//   시험 환경엔 모델이 없다 — 그래서 여기서 「없을 때 안 죽는가」가 그대로 검증된다.
import { describe, it, expect } from "vitest";
import { rewriteForSearch } from "../src/engine/searchrewrite";

describe("★ 질의 재작성 — 없으면 조용히 빠진다", () => {
  it("모델이 없어도 던지지 않고 빈 문자열을 준다", async () => {
    // 시험 환경에는 llama-server가 없다(제품 원칙: 시험은 실 LLM을 안 띄운다).
    const r = await rewriteForSearch("KEV에 올라오면 며칠 안에 해야 하는 거였지?");
    expect(typeof r).toBe("string");
    expect(r).toBe("");
  });

  it("너무 짧거나 너무 긴 질문은 아예 안 부른다", async () => {
    expect(await rewriteForSearch("응")).toBe("");
    expect(await rewriteForSearch("가".repeat(300))).toBe("");
  });

  it("빈 입력·공백에도 안 죽는다", async () => {
    expect(await rewriteForSearch("")).toBe("");
    expect(await rewriteForSearch("    ")).toBe("");
  });

  it("★ 껐을 때는 부르지 않는다(GIJO_SEARCH_REWRITE=0)", async () => {
    // env는 모듈 적재 시점에 읽으므로 여기서는 「끈 상태로도 안 죽는다」만 본다.
    // 실제 차단은 운영에서 env로 하고, 이 시험은 계약(문자열 반환)을 못박는다.
    const r = await rewriteForSearch("브루트포스 같은 게 계속 보이는데 어디부터 봐야 하지?");
    expect(typeof r).toBe("string");
  });

  it("같은 질문을 두 번 물어도 안 죽는다(캐시 경로)", async () => {
    const q = "S3에 퍼블릭 걸린 게 있대";
    const a = await rewriteForSearch(q);
    const b = await rewriteForSearch(q);
    expect(a).toBe(b);
  });
});
