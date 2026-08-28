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

// ⚠ 2026-08-29(화살 #15): llm이 recordChatLog를 직접 부르지 않는다 — 등록된 수집기에게
//   알린다(수집(agentId, …)). 아래 감시들의 **앵커만** 그 호출로 바꿨고, 지키는 계약
//   세 가지(logQuestion 사용 · noLearn 게이트 · qa 조건 안쪽)는 한 글자도 안 바뀌었다.
const llmSrc = fs.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
const dispSrc = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");

describe("★ 학습 기록에는 사람이 한 질문만 남는다", () => {
  it("chat()이 맥락 덩어리(message) 대신 logQuestion을 기록한다", () => {
    // 수집(args.message, …)로 되돌아가면(옛 recordChatLog 직접 호출 시절과 같은 병) 맥락이 다시 질문 자리에 저장된다.
    const call = llmSrc.slice(llmSrc.indexOf("수집(args."), llmSrc.indexOf("수집(args.") + 90);
    expect(call, "맥락이 붙은 message를 그대로 기록하면 안 된다").toContain("logQuestion");
  });

  it("dispatcher가 맥락을 붙인 곳마다 logQuestion을 함께 넘긴다", () => {
    // 맥락을 붙이는 자리(= chat에 buildRagQuery로 만든 message를 주는 곳)의 수만큼 logQuestion이
    // 있어야 한다. 맥락 조립은 buildRagQuery 한 함수로 모았다(2026-08-10 ③ — 배지도 같은 질문을
    // 쓰게). [현재 지시]는 그 함수 안 한 곳뿐이라, chat용 message 조립(const message = buildRagQuery)을 센다.
    const 맥락붙임 = (dispSrc.match(/const message = buildRagQuery\(/g) || []).length;
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

describe("★ 배포·시험 계정의 문답은 학습에 안 들어간다", () => {
  // 실측(2026-07-31): 학습 후보 385건 중 한 질문이 66회, 그중 62건이 대화로그였다.
  // 하네스는 qa:true로 잘 격리돼 있었고 **범인은 내(배포 계정) 손 검증**이었다.
  // 담당자가 아닌 계정으로 모델을 가르치면 제품이 아니라 시험을 배운다.
  it("배포·게시 계정을 가려낸다", async () => {
    const { isNonLearningAccount } = await import("../src/engine/learnpolicy");
    expect(isNonLearningAccount("claude-deploy")).toBe(true);
    expect(isNonLearningAccount("gijo-publish")).toBe(true);
    expect(isNonLearningAccount("jyh"), "담당자 계정은 학습에 들어가야 한다").toBe(false);
    expect(isNonLearningAccount(undefined), "누군지 모르면 막지 않는다(기존 동작 유지)").toBe(false);
  });

  it("noLearn은 **학습 수집만** 끈다 — 대화 이력은 그대로", () => {
    // 이력까지 끊으면 배포 계정으로 검증할 때 사람이 쓰는 것과 다르게 동작한다
    // (실제로 처음엔 바깥 if에 걸어 이력까지 껐다 — 주석과 코드가 어긋났다).
    const cond = llmSrc.slice(llmSrc.indexOf("if (args.remember"), llmSrc.indexOf("if (args.remember") + 60);
    expect(cond, "이력 갱신 조건에 noLearn이 끼면 안 된다").not.toContain("noLearn");
    const rec = llmSrc.indexOf("수집(args.");
    expect(llmSrc.slice(rec - 80, rec), "학습 수집에는 noLearn이 걸려야 한다").toContain("!args.noLearn");
  });

  it("★ noLearn은 서버가 정한다 — 요청이 주장할 수 없다", () => {
    // trusted와 같은 이유다. req.body를 펼친 뒤에 서버 값으로 덮어써야 한다.
    const i = llmSrc.indexOf("...req.body");
    const 뒤 = llmSrc.slice(i, i + 200);
    expect(뒤, "req.body 뒤에 서버가 정한 noLearn이 와야 한다").toContain("noLearn: isNonLearningAccount");
  });

  it("디스패치 경로에도 이어져 있다", () => {
    expect(dispSrc).toContain("isNonLearningAccount(user?.username)");
    // ⚠ 인접 문자열로 검사하지 않는다 — 사이에 인자가 하나 끼면(실제로 viewer가 끼었다)
    //   동작은 멀쩡한데 시험만 깨진다. **chat 호출에 둘 다 실렸는가**를 본다.
    const calls = dispSrc.match(/await chat\(\{[^}]*\}\)/g) ?? [];
    const 사람에게가는답 = calls.filter((c) => c.includes("logQuestion: instructionText"));
    expect(사람에게가는답.length, "logQuestion을 넘기는 chat 호출을 못 찾았다").toBeGreaterThan(0);
    for (const c of 사람에게가는답) {
      expect(c, "chat 호출까지 안 닿으면 절반만 막힌다").toContain("noLearn");
    }
  });
});

describe("QA·게이트 호출은 학습에 들어가지 않는다", () => {
  it("qa=true면 recordChatLog까지 가지 않는다", () => {
    // 게이트 문항 수백 건이 후보함에 흘러들면 "가르친 걸 채점"하게 된다.
    // 실측으로 게이트 문항 99개 중 후보와 겹치는 것은 0건이었다 — 이 조건이 지키고 있다.
    const 조건 = "if (args.remember && !args.qa && reply)";
    const g = llmSrc.indexOf(조건);
    const r = llmSrc.indexOf("수집(args.");
    expect(g, "qa를 거르는 조건문이 사라졌다 — 게이트 문답이 학습에 섞인다").toBeGreaterThan(0);
    expect(r, "학습 수집 호출을 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(0);
    expect(r, "학습 수집이 qa 조건 밖으로 나가면 게이트가 무의미해진다").toBeGreaterThan(g);
  });
});
