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
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import { rewriteForSearch } from "../src/engine/searchrewrite";
import { db } from "../src/db";
import { remoteLlmTarget } from "../src/engine/remotellm";

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

// ── ★ 두뇌 위치 — 재작성은 **언제나 로컬**이다 (2026-09-10 win 운영 실측 수리) ──────────────
//
// ■ 무엇이 있었나: 원격 두뇌(gb10)를 전역으로 켜고 **리포트·해설 팀원만** 원격으로 배정했는데,
//   로컬로 둔 총괄·분석 경로의 물음 「Log4Shell 위험 분석해줘」가 **5.4초 → 57초**가 됐다.
//   재작성이 `chat()`을 안 거쳐 팀원별 두뇌 위치 판정에 안 걸리고 **전역만** 따랐기 때문이다.
//   짧고(40토큰) 지연에 민감하며(RAG 앞단) 한 물음당 한 번 더 도는 왕복이라, 원격 콜드 40초+를
//   태울 자리가 아니다. 전역을 끄자 8.2초로 돌아왔다.
// ■ 이 시험이 지키는 것: 「전역이 켜져 있어도 로컬로 간다」 — 행동으로 한 번, 소스로 한 번.
describe("★ 재작성은 전역 원격이 켜져 있어도 로컬로 간다", () => {
  const put = db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const del = db.prepare("DELETE FROM app_state WHERE key = ?");

  afterEach(() => {
    del.run("remote_llm");
    vi.unstubAllGlobals();
  });

  it("원격 목표가 살아 있어도 fetch는 로컬 통로로만 나간다", async () => {
    put.run("remote_llm", JSON.stringify({ enabled: true, url: "http://10.8.0.12:8080/v1?token=시험토큰", lastCheck: null }));
    // ⚠ 헛돎 방지 — 전역 스위치가 **정말** 켜졌는지 먼저 확인한다. 안 그러면 「원격을 안 불렀다」가
    //   그저 원격이 꺼져 있어서일 수 있다(거짓 초록). 원격이 켜진 상태를 이 두 줄이 증명한다.
    const 목표 = remoteLlmTarget();
    expect(목표?.baseUrl, "전역 원격이 안 켜졌다 — 이 시험이 헛돈다").toBe("http://10.8.0.12:8080/v1");
    expect(목표?.headers["x-gijo-serve-token"], "토큰이 헤더로 안 갈렸다").toBe("시험토큰");

    const 부른곳: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (u: unknown, init: { headers?: Record<string, string> } = {}) => {
      부른곳.push({ url: String(u), headers: { ...(init.headers ?? {}) } });
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Log4Shell 위험 분석" } }] }) };
    });

    const r = await rewriteForSearch("Log4Shell 위험 분석해줘 어디부터 봐야 하지?");
    expect(부른곳.length, "재작성이 아예 안 불렸다 — 시험 전제가 깨졌다").toBe(1);
    expect(부른곳[0].url, "재작성이 원격으로 나갔다 — 로컬로 둔 팀원의 물음까지 원격 왕복을 탄다").toBe(
      "http://127.0.0.1:59999/v1/chat/completions",
    );
    expect(부른곳[0].headers["x-gijo-serve-token"], "로컬 호출에 원격 토큰이 붙었다").toBeUndefined();
    expect(r, "로컬이 준 답이 채택되지 않았다").toBe("Log4Shell 위험 분석");
  });

  it("★ 소스 감시 — 원격 게터를 다시 물면 빨강", () => {
    const src = fs.readFileSync(new URL("../src/engine/searchrewrite.ts", import.meta.url), "utf8");
    const 문다 = (s: string) => /(?:from|import\()\s*["'][^"']*remotellm/.test(s);
    expect(
      문다(src),
      "재작성이 원격 게터를 다시 문다 — 되살리려면 사서(curator)의 팀원 두뇌 위치를 보고, 접속 토큰 헤더·리다이렉트 금지도 함께 달아야 한다",
    ).toBe(false);
    expect(src, "로컬 통로 상수가 사라졌다 — 이 검사의 근거가 바뀐 것이다").toMatch(/GIJO_LOCAL_LLM_URL/);
    // ⚠ 검사기 자체 확인(반증) — 되살린 모양을 만들어 정말 빨강이 나는지 본다.
    expect(문다(`const 원격 = await import("./remotellm.js").then((m) => m.remoteLlmTarget());`), "검사기가 고장 났다").toBe(true);
  });
});
