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

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  // 목이 **진짜 잎 모듈로 보고한다** — 라우트가 그릇을 놓았는지가 이 시험의 대상이다.
  chat: vi.fn(async () => {
    두뇌표식보고({ location: "remote", fallback: true, model: "qwen3.8-flash-next", 결정호출: false });
    return "[mock] 원격이 죽어 이 PC가 만든 답";
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
    expect(r.body.brain.location).toBe("remote");
    expect(r.body.brain.fallback).toBe(true);
    expect(r.body.brain.model, "사람 응답에 모델 이름이 샜다").toBeUndefined();
  });

  it("qa 응답: 모델 이름까지 실린다 — 하네스가 「어느 두뇌였나」를 기록한다", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘", qa: true });
    expect(r.status).toBe(200);
    expect(r.body.brain?.model, "qa인데 모델 이름이 없다 — 기록이 「무엇을 쟀는지 모르는 숫자」가 된다").toBe("qwen3.8-flash-next");
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
    expect(done?.result?.brain?.location, "스트림 done에 표식이 없다 — 두 입이 딴말을 한다").toBe("remote");
    expect(done?.result?.brain?.fallback).toBe(true);
    expect(done?.result?.brain?.model, "스트림 사람 응답에 모델 이름이 샜다").toBeUndefined();
  });
});
