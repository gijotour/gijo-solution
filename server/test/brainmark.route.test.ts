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
  chat: vi.fn(async (args: { agentId?: string; explain?: boolean; responseSchema?: unknown }) => {
    // ⚠ agentId를 **그대로** 넘긴다 — 팀원별 기록(두뇌기록)의 유일한 열쇠라, 목이 지어내면
    //   「누구의 두뇌인가」를 재는 아래 시험이 통째로 헛돈다.
    const agentId = String(args?.agentId ?? "-");
    if (args?.responseSchema) {
      계측.결정++;
      두뇌표식보고({ agentId, location: "local", fallback: false, model: "결정용-14b", 왕복ms: 120, 결정호출: true, 사람이읽는답: false });
      return "{}";
    }
    if (args?.explain !== true) {
      // ① 총괄 분류기 — 총괄은 언제나 이 PC(llm.ts ⓪). 이것이 담기면 표식이 **언제나 local**이 된다.
      계측.분류기++;
      두뇌표식보고({ agentId, location: "local", fallback: false, model: "분류기-14b", 왕복ms: 80, 결정호출: false, 사람이읽는답: false });
      return "[mock] 분류 결과";
    }
    // ③ 담당자가 그대로 읽는 답 — 이것만이 「답한 두뇌」다.
    계측.답++;
    두뇌표식보고({ agentId, location: "remote", fallback: false, model: "qwen3.8-flash-next", 왕복ms: 4200, 결정호출: false, 사람이읽는답: true });
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

// ── 🧠🧠 팀원별 두뇌기록 — **qa 전용 칸이 응답까지 닿는가**(2026-09-10 둘째 판) ────────────────
//
// ⚠ 왜 이 자리인가: 표식과 달리 기록은 **결정 호출·분류기까지** 담아야 값이 있다(원격 배정
//   팀원 셋은 explain 없이 돌아 표식이 원리상 안 생긴다 — ⑲ 첫 실측 23/27). 이 파일의 목은
//   이미 셋(분류기·결정·답)을 다르게 보고하므로, **응답에 몇 개가 실렸나**로 그 계약을 그대로 잰다.
describe("★★ /api/dispatch — qa 응답에 팀원별 두뇌기록이 실린다", () => {
  type 항목 = { agentId: string; location: string; fallback: boolean; model: string | null; 왕복ms: number; 결정호출: boolean; 사람이읽는답: boolean };
  const 부른수 = () => 계측.분류기 + 계측.결정 + 계측.답;

  it("★ qa: **LLM에 나간 chat 전부**가 담긴다 — 분류기·결정 호출도(표식은 하나뿐이다)", async () => {
    const token = await 로그인();
    const 앞 = 부른수();
    const r = await request(app).post("/api/dispatch").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘", qa: true });
    expect(r.status).toBe(200);
    const 기록 = r.body.두뇌기록 as 항목[] | undefined;
    expect(기록, "qa 응답에 두뇌기록이 없다 — 라우트가 안 싣거나 그릇을 안 놓았다").toBeTruthy();
    expect(기록!.length, "chat이 돈 만큼 안 담겼다 — 게이트 아래에서 쌓고 있다").toBe(부른수() - 앞);
    expect(기록!.length, "헛돎 방지 — chat이 한 번밖에 안 돌았다면 「전부 담는다」를 못 잰 것이다").toBeGreaterThan(1);
    // ★★ 이 대비가 이 판의 전부다: 표식엔 못 담기는 호출이 배열엔 담긴다.
    expect(기록!.some((x) => !x.사람이읽는답), "분류기·결정 호출이 통째로 빠졌다 — 원격 팀원을 영영 못 본다").toBe(true);
    expect(기록!.every((x) => typeof x.agentId === "string" && x.agentId.length > 0), "팀원 이름표가 없다 — 누구 두뇌인지 못 가린다").toBe(true);
    expect(기록!.every((x) => typeof x.왕복ms === "number")).toBe(true);
  });

  it("★ 표식과 **어긋나지 않는다** — 배열의 「사람이 읽는 답」 첫 항목이 곧 brain이다", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘", qa: true });
    const 기록 = r.body.두뇌기록 as 항목[];
    const 답한것 = 기록.find((x) => x.사람이읽는답 && !x.결정호출);
    expect(답한것, "「사람이 읽는 답」 항목이 없다 — 표식이 어디서 왔는지 설명할 수 없다").toBeTruthy();
    expect(r.body.brain.location, "표식과 기록이 서로 다른 두뇌를 가리킨다 — 두 벌 잣대가 생겼다").toBe(답한것!.location);
    expect(r.body.brain.model).toBe(답한것!.model);
  });

  it("★★ 사람 응답에는 칸이 **아예 없다** — 팀원 id도 모델 이름도 안 나간다", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘" });
    expect(r.status).toBe(200);
    expect(r.body.두뇌기록, "qa가 아닌 응답에 팀원별 기록이 샜다").toBeUndefined();
    expect(r.body.brain, "표식까지 사라졌다 — 사람 몫인 정직 신호는 그대로 나가야 한다").toBeTruthy();
    expect(JSON.stringify(r.body), "사람 응답에 모델 이름이 샜다").not.toContain("qwen3.8-flash-next");
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

  // ★ 갈린 자리를 **시험으로 적어 둔다**(2026-09-10 둘째 판 결정) — 「샜다」와 「일부러 안 실었다」는
  //   다른 말이다. 팀원별 기록은 사람이 볼 신호가 아니라 하네스가 회차를 견주는 재료고,
  //   하네스는 /api/dispatch만 쓴다(근거원천 칸이 여기 없는 것과 같은 까닭).
  //   스트림에서도 재야 할 날이 오면 이 시험을 뒤집고 done에 한 줄을 더한다(좋은 빨강이다).
  it("★ 스트림에는 팀원별 기록을 **일부러 안 싣는다** — qa라도 그렇다", async () => {
    const token = await 로그인();
    const r = await request(app).post("/api/dispatch/stream").set("authorization", `Bearer ${token}`).send({ text: "취약점 조치 우선순위를 알려줘", qa: true });
    const done = r.text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as { t: string; result?: { brain?: unknown; 두뇌기록?: unknown } })
      .find((e) => e.t === "done");
    expect(done?.result?.brain, "표식은 두 입구가 같은 계약이다 — 스트림에서 사라졌다").toBeTruthy();
    expect(done?.result?.두뇌기록, "스트림에 기록이 실렸다 — 두 입구의 계약을 바꿨다면 이 시험도 함께 고칠 것").toBeUndefined();
  });
});
