// 🧠 **「누가 답했나」가 응답까지 실제로 닿는가** — 두 입구 모두 (2026-09-10)
//
// ⚠ 왜 라우트를 행동으로 재나: chat()이 표식을 남겨도 **라우트가 그릇을 안 놓으면** 그 보고는
//   조용히 버려진다(brainmark의 store.getStore()가 undefined). 소스 문자열 대조는 「그릇을 놓는
//   줄이 있다」까지만 말하고 「done에 실렸다」는 못 잰다 — citesource가 같은 자리에서 겪은 일이다.
// ⚠ 그래서 llm을 목으로 바꿔 **chat이 표식을 보고하게** 하고, 응답에 그 값이 나오는지만 본다.
//   폴백 판정 자체(원격이 죽으면 이 PC로)는 remotefallback.test가 진짜 chat으로 잰다.
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { 두뇌표식보고 } from "../src/engine/brainmark";

// ★★ 2026-09-10 검토관(high) — 목이 **한 가지 답만** 하면 이 시험은 원리상 순서를 못 잰다.
//   실제 dispatch는 chat을 여러 번 부른다: ① 총괄 의도 분류기(intent.ts:106 — explain 없음·언제나
//   이 PC) ② 도구 결정(responseSchema) ③ **담당자가 읽는 답**(explain:true). 종전 목은 셋을
//   구별 없이 같은 값으로 보고해서, 분류기가 표식을 가로채는 실제 결함을 **초록으로 통과시켰다.**
//   그래서 목이 args를 보고 **셋을 다르게** 보고한다 — 응답에 실린 값이 곧 「어느 호출이 이겼나」다.
const 계측 = vi.hoisted(() => ({ 분류기: 0, 결정: 0, 답: 0 }));

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  // 목이 **진짜 잎 모듈로 보고한다** — 라우트가 그릇을 놓았는지가 이 시험의 대상이다.
  chat: vi.fn(async (args: { explain?: boolean; responseSchema?: unknown }) => {
    if (args?.responseSchema) {
      계측.결정++;
      두뇌표식보고({ location: "local", fallback: false, model: "결정용-14b", 결정호출: true, 사람이읽는답: false });
      return "{}";
    }
    if (args?.explain !== true) {
      // ① 총괄 분류기 — 총괄은 언제나 이 PC(llm.ts ⓪). 이것이 담기면 표식이 **언제나 local**이 된다.
      계측.분류기++;
      두뇌표식보고({ location: "local", fallback: false, model: "분류기-14b", 결정호출: false, 사람이읽는답: false });
      return "[mock] 분류 결과";
    }
    // ③ 담당자가 그대로 읽는 답 — 이것만이 「답한 두뇌」다.
    계측.답++;
    두뇌표식보고({ location: "remote", fallback: false, model: "qwen3.8-flash-next", 결정호출: false, 사람이읽는답: true });
    return "[mock] 원격 큰 두뇌가 쓴 답";
  }),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";

const app = createApp();
const 로그인 = async () => {
  const r = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return r.body.accessToken as string;
};

describe("★ /api/dispatch — 답에 두뇌 표식이 실린다", () => {
  it("사람 응답: 위치·폴백은 실리고 **모델 이름은 안 실린다**", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘" });
    expect(r.status).toBe(200);
    expect(r.body.brain, "라우트가 그릇을 안 놓았다 — chat의 보고가 통째로 버려진다").toBeTruthy();
    expect(계측.분류기, "헛돎 방지 — 분류기 chat이 아예 안 돌았다면 순서를 못 잰 것이다").toBeGreaterThan(0);
    expect(r.body.brain.location, "분류기(local)가 표식을 가로챘다 — 원격이 답했는데 local이라 말한다").toBe("remote");
    expect(r.body.brain.fallback).toBe(false);
    expect(r.body.brain.model, "사람 응답에 모델 이름이 샜다").toBeUndefined();
  });

  it("qa 응답: 모델 이름까지 실린다 — 하네스가 「어느 두뇌였나」를 기록한다", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘", qa: true });
    expect(r.status).toBe(200);
    expect(r.body.brain?.model, "답한 두뇌가 아니라 **분류기 모델**이 실렸다 — 하네스 기록이 통째로 딴 두뇌다").toBe("qwen3.8-flash-next");
  });
});

describe("★ /api/dispatch/stream — done에도 같은 표식이 실린다", () => {
  it("두 입구가 같은 계약이다 — 한 곳만 실으면 스트림 쓰는 화면에서 그대로 샌다", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch/stream").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘" });
    expect(r.status).toBe(200);
    const done = r.text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as { t: string; result?: { brain?: { location?: string; fallback?: boolean; model?: string } } })
      .find((e) => e.t === "done");
    expect(done, "done 이벤트가 없다").toBeTruthy();
    expect(done?.result?.brain?.location, "스트림 done에 표식이 없거나 분류기 것이다 — 두 입이 딴말을 한다").toBe("remote");
    expect(done?.result?.brain?.fallback).toBe(false);
    expect(done?.result?.brain?.model, "스트림 사람 응답에 모델 이름이 샜다").toBeUndefined();
  });
});
