// 원격 LLM(BridgeAI 1단계) — **진짜 원격 GPU에 붙어 답을 받는가** (실측 · 전-7 하드웨어 갈래)
//
// ■ 왜 이 파일이 따로 있나
//   remotellm.test.ts는 경계(VPN 판정·에어갭)와 **배선을 소스 감시로** 지킨다 — 「llm.ts가
//   게터를 부르는가」를 정규식으로 본다. 그건 코드가 사라지는 것은 막지만, **실제로 원격에서
//   답이 오는지**는 못 본다. 2026-08-14 그 빈 곳을 실측으로 메운다:
//   사장님 지시로 gb10(10.8.0.12)에 llama-server를 띄우고 라이트에서 원격을 골라 시험했다.
//
// ■ 평소에는 돌지 않는다(기본 skip)
//   원격 기계가 꺼져 있으면 실패하는 시험은 게이트를 흔든다 — 제품이 아니라 **그날 gb10의
//   전원 상태**를 재게 된다. 그래서 `GIJO_TEST_REMOTE_URL`을 준 사람만 돌린다:
//     GIJO_TEST_REMOTE_URL=http://10.8.0.12:8082/v1 npx vitest run test/remotellm-live.test.ts
//   ⚠ 주소는 **VPN 대역**이어야 한다 — 제품 관문이 공인 IP를 거부하므로 시험도 같이 거부된다.
//
// ■ 무엇을 증명하나 (소스 감시로는 못 하는 것)
//   ① 원격을 켜면 chat()이 **로컬 llama를 안 띄우고** 원격에서 답을 받아온다.
//      (이 시험 기계에는 로컬 llama가 없다 — 답이 오면 그건 원격에서 온 것이다.)
//   ② 껐을 때는 원격으로 안 간다 — 켜고 끄기가 실제로 갈린다.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "../src/db";
import { remoteLlmBaseUrl, remoteUrlProblem } from "../src/engine/remotellm";

const REMOTE = process.env.GIJO_TEST_REMOTE_URL ?? "";
const put = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const del = db.prepare("DELETE FROM app_state WHERE key = ?");

function 원격켜기(url: string): void {
  put.run("remote_llm", JSON.stringify({ enabled: true, url, lastCheck: null }));
}

// 원격 기계를 안 준 사람에게는 통째로 건너뛴다 — 「돌지 않았다」가 「통과했다」로 보이지 않게
// describe.skip 이름에 이유를 적는다.
const 실측 = REMOTE ? describe : describe.skip;

실측(`원격 GPU 실측 — ${REMOTE || "GIJO_TEST_REMOTE_URL 미지정이라 건너뜀"}`, () => {
  beforeEach(() => { del.run("remote_llm"); delete process.env.GIJO_AIRGAP; });
  afterAll(() => { del.run("remote_llm"); });

  it("준 주소가 제품 관문(VPN 전용)을 통과한다 — 안 그러면 아래 시험은 무의미하다", () => {
    expect(remoteUrlProblem(REMOTE), `시험 주소가 제품 규칙에 걸린다: ${REMOTE}`).toBeNull();
  });

  it("원격이 살아 있고 OpenAI 호환 /models를 답한다", async () => {
    const r = await fetch(`${REMOTE.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(8000), redirect: "error" });
    expect(r.ok, `원격에 닿지 못했다(HTTP ${r.status}) — VPN과 llama-server를 확인하라`).toBe(true);
  }, 15000);

  it("★ 원격을 켜면 chat()이 원격에서 답을 받아온다 — 이 기계엔 로컬 llama가 없다", async () => {
    원격켜기(REMOTE);
    expect(remoteLlmBaseUrl()).toBe(REMOTE);

    const { chat } = await import("../src/engine/llm");
    const 답 = await chat({
      agentId: "analysis",
      message: "KISA는 무엇의 약자인가? 한 줄로만 답하라.",
      qa: true, // 이력·학습 수집에 끼어들지 않는다
    });

    expect(typeof 답).toBe("string");
    expect(답.length, `원격이 빈 답을 줬다: ${JSON.stringify(답)}`).toBeGreaterThan(2);
    // 내용까지 본다 — 형식만 보면 폴백 문구도 통과한다(이 저장소의 반복 함정).
    expect(답, `원격 답에 기대한 낱말이 없다: ${답.slice(0, 200)}`).toMatch(/한국인터넷진흥원|인터넷진흥원|KISA/);
  }, 120000);

  it("끄면 원격 주소를 안 준다 — 켜고 끄기가 실제로 갈린다", () => {
    원격켜기(REMOTE);
    expect(remoteLlmBaseUrl()).toBe(REMOTE);
    put.run("remote_llm", JSON.stringify({ enabled: false, url: REMOTE, lastCheck: null }));
    expect(remoteLlmBaseUrl()).toBeNull();
  });
});
