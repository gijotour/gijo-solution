// 학습에 무엇이 들어가는가 — **후보함 위생** (계획서 중-4 "게이트 통과분만 배포"의 앞단)
//
// 운영 실측(2026-07-31): 학습 후보 200건 중 **서로 다른 질문은 27개**뿐이었고,
// 그중에는 회귀 하네스 문항 5건과 "이전 대화 맥락(같은 세션): …"으로 시작하는 덩어리가 있었다.
// 이대로 학습하면
//   ① 같은 27문항만 잘 답하는 모델이 되고(과적합),
//   ② 회귀 하네스가 자기가 가르친 걸 채점하게 되며(시험 무효),
//   ③ 모델이 "이전 대화 맥락:"으로 시작하는 이상한 입력 형식을 배운다.
// 그래서 **무엇을 기록하는가**를 시험으로 못 박는다.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";

const llmSrc = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
const dispSrc = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");

describe("★ 학습 기록에는 사람이 한 질문만 남는다", () => {
  it("chat()이 맥락 덩어리(message) 대신 logQuestion을 기록한다", () => {
    // recordChatLog(args.message, …)로 되돌아가면 맥락이 다시 질문 자리에 저장된다.
    const call = llmSrc.slice(llmSrc.indexOf("recordChatLog(args."), llmSrc.indexOf("recordChatLog(args.") + 90);
    expect(call, "맥락이 붙은 message를 그대로 기록하면 안 된다").toContain("logQuestion");
  });

  it("dispatcher가 맥락을 붙인 곳마다 logQuestion을 함께 넘긴다", () => {
    // 맥락을 붙이는 자리(= [현재 지시] 를 만드는 곳)의 수만큼 logQuestion이 있어야 한다.
    const 맥락붙임 = (dispSrc.match(/\[현재 지시\]/g) || []).length;
    const 원문전달 = (dispSrc.match(/logQuestion: instructionText/g) || []).length;
    expect(맥락붙임, "맥락을 붙이는 자리를 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(0);
    expect(원문전달, `맥락을 붙인 ${맥락붙임}곳 중 ${원문전달}곳만 원문을 넘긴다`).toBe(맥락붙임);
  });

  it("맥락 머리말 문구는 한 곳에서만 만들어진다", () => {
    // 여러 곳에서 만들면 한쪽만 고쳐 놓고 고쳤다고 믿게 된다.
    const src = fs.readFileSync(new URL("../src/engine/worksessions.ts", import.meta.url), "utf8");
    expect(src).toContain("이전 대화 맥락(같은 세션):");
    expect(dispSrc.includes("이전 대화 맥락"), "머리말을 dispatcher가 또 만들면 안 된다").toBe(false);
  });
});

describe("QA·게이트 호출은 학습에 들어가지 않는다", () => {
  it("qa=true면 recordChatLog까지 가지 않는다", () => {
    // 게이트 문항 수백 건이 후보함에 흘러들면 "가르친 걸 채점"하게 된다.
    // 실측으로 게이트 문항 99개 중 후보와 겹치는 것은 0건이었다 — 이 조건이 지키고 있다.
    const 조건 = "if (args.remember && !args.qa && reply)";
    const g = llmSrc.indexOf(조건);
    const r = llmSrc.indexOf("recordChatLog(args.");
    expect(g, "qa를 거르는 조건문이 사라졌다 — 게이트 문답이 학습에 섞인다").toBeGreaterThan(0);
    expect(r, "학습 수집 호출을 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(0);
    expect(r, "학습 수집이 qa 조건 밖으로 나가면 게이트가 무의미해진다").toBeGreaterThan(g);
  });
});
