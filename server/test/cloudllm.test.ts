// 선택적 클라우드 LLM 하이브리드 — 설정(admin-gated·기본off)·유출게이트·감사로그 통합 검증.
// 실제 클라우드 호출은 global.fetch를 가로채 "무엇이 나가는지"까지 확인한다(내부맥락 미포함 증명).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resetAssetsForTests, registerAsset } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const res = await request(app).post("/api/auth/login").send({ username, password });
  return res.body.accessToken as string;
}

const db = (await import("../src/db")).db;

describe("cloud LLM 하이브리드", () => {
  let app: ReturnType<typeof createApp>;
  let admin: string;

  beforeEach(async () => {
    resetAssetsForTests();
    db.exec("DELETE FROM cloud_llm_keys; DELETE FROM cloud_egress_log; DELETE FROM app_state WHERE key LIKE 'cloud:%'");
    app = createApp();
    admin = await login(app);
  });
  afterEach(() => vi.restoreAllMocks());

  it("기본은 비활성(off)이고 설정은 관리자 전용이다", async () => {
    const cfg = await request(app).get("/api/cloud/config").set("Authorization", `Bearer ${admin}`);
    expect(cfg.status).toBe(200);
    expect(cfg.body.enabled).toBe(false);
    expect(cfg.body.providers.every((p: { hasKey: boolean }) => !p.hasKey)).toBe(true);
    // 인증 없이는 401
    expect((await request(app).get("/api/cloud/config")).status).toBe(401);
  });

  it("API 키는 저장하되 평문을 다시 내려주지 않는다(hasKey만)", async () => {
    await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
      .send({ provider: "openai", apiKey: "sk-secret-should-not-leak", model: "gpt-4o-mini" });
    const cfg = await request(app).get("/api/cloud/config").set("Authorization", `Bearer ${admin}`);
    const openai = cfg.body.providers.find((p: { provider: string }) => p.provider === "openai");
    expect(openai.hasKey).toBe(true);
    expect(JSON.stringify(cfg.body)).not.toContain("sk-secret-should-not-leak");
  });

  it("비활성 상태면 클라우드로 나가지 않는다", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`).send({ question: "SQL 인젝션이 뭐야?" });
    expect(r.body.routedToCloud).toBe(false);
    expect(r.body.error).toContain("비활성");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("내부 정보가 있으면 클라우드 호출 없이 차단하고 감사 로그에 남긴다", async () => {
    registerAsset({ id: "ai-secbot-01", name: "사내 챗봇XYZ", path: "p" });
    await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
      .send({ enabled: true, activeProvider: "openai", provider: "openai", apiKey: "sk-x", model: "gpt-4o-mini" });

    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`)
      .send({ question: "ai-secbot-01 자산 안전한가?" });

    expect(r.body.blocked).toBe(true);
    expect(r.body.routedToCloud).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled(); // 절대 외부로 안 나감

    const log = await request(app).get("/api/cloud/egress-log").set("Authorization", `Bearer ${admin}`);
    expect(log.body[0].decision).toBe("blocked");
    expect(log.body[0].reasons.length).toBeGreaterThan(0);
  });

  it("안전한 질문은 클라우드로 나가되, 나가는 body엔 순수 질문+일반 시스템프롬프트만 있다", async () => {
    // 내부 자산을 등록해두고도, 그와 무관한 일반 질문은 통과해야 하고 자산 정보가 섞이면 안 된다.
    registerAsset({ id: "ai-secbot-01", name: "사내 챗봇XYZ", path: "p" });
    await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
      .send({ enabled: true, activeProvider: "openai", provider: "openai", apiKey: "sk-x", model: "gpt-4o-mini" });

    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "SQL 인젝션은 …입니다." } }] }), { status: 200 })
    );

    const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`)
      .send({ question: "SQL 인젝션 방어 일반적인 방법 알려줘" });

    expect(r.body.routedToCloud).toBe(true);
    expect(r.body.answer).toContain("SQL 인젝션");
    expect(r.body.providerLabel).toContain("OpenAI");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 나가는 요청 검증 — OpenAI 엔드포인트, 내부 자산명·RAG가 절대 섞이지 않음.
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("api.openai.com");
    const sentBody = JSON.parse((init as RequestInit).body as string);
    const bodyText = JSON.stringify(sentBody);
    expect(bodyText).not.toContain("ai-secbot-01");
    expect(bodyText).not.toContain("사내 챗봇XYZ");
    expect(sentBody.messages.find((m: { role: string }) => m.role === "user").content).toBe("SQL 인젝션 방어 일반적인 방법 알려줘");

    const log = await request(app).get("/api/cloud/egress-log").set("Authorization", `Bearer ${admin}`);
    expect(log.body[0].decision).toBe("allowed");
  });

  it("/screen은 실제 호출 없이 판정만 미리보기한다", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const blocked = await request(app).post("/api/cloud/screen").set("Authorization", `Bearer ${admin}`).send({ question: "10.0.0.5 취약점" });
    expect(blocked.body.allowed).toBe(false);
    const ok = await request(app).post("/api/cloud/screen").set("Authorization", `Bearer ${admin}`).send({ question: "CVSS 점수 계산법" });
    expect(ok.body.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
