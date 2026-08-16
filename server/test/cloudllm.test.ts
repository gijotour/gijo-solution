// 선택적 클라우드 LLM 하이브리드 — 설정(admin-gated·기본off)·유출게이트·감사로그 통합 검증.
// 실제 클라우드 호출은 global.fetch를 가로채 "무엇이 나가는지"까지 확인한다(내부맥락 미포함 증명).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

// 지식베이스 저장은 임베딩(LanceDB)을 타므로, 그 경로만 대역으로 두고 "무엇을 저장하는지"를 검증한다.
const ingestSpy = vi.fn(async (documentId: string) => ({ documentId, chunks: 1, embeddingModel: "mock", scope: "global" }));
vi.mock("../src/engine/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/memory")>()),
  ingestText: (documentId: string, ...rest: unknown[]) => ingestSpy(documentId, ...(rest as [])),
}));

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

  it("실제 전송된 호출의 토큰을 계측해 요금 화면 데이터로 집계한다", async () => {
    db.exec("DELETE FROM cloud_usage");
    await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
      .send({ enabled: true, activeProvider: "openai", provider: "openai", apiKey: "sk-x", model: "gpt-4o-mini" });
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "답변" } }], usage: { prompt_tokens: 100, completion_tokens: 200 } }), { status: 200 })
    );
    await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`).send({ question: "CVSS가 뭐야?" });

    const usage = await request(app).get("/api/cloud/usage").set("Authorization", `Bearer ${admin}`);
    expect(usage.body.totalCalls).toBe(1);
    expect(usage.body.totalTokens).toBe(300);
    const row = usage.body.rows.find((r: { model: string }) => r.model === "gpt-4o-mini");
    expect(row.inTokens).toBe(100);
    expect(row.outTokens).toBe(200);
    // gpt-4o-mini 표준요금(입력 0.15/출력 0.60 per 1M) → 100*.15/1e6 + 200*.6/1e6 = 0.000135
    expect(row.estimatedCost).toBeCloseTo(0.000135, 6);
  });

  it("/screen은 실제 호출 없이 판정만 미리보기한다", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const blocked = await request(app).post("/api/cloud/screen").set("Authorization", `Bearer ${admin}`).send({ question: "10.0.0.5 취약점" });
    expect(blocked.body.allowed).toBe(false);
    const ok = await request(app).post("/api/cloud/screen").set("Authorization", `Bearer ${admin}`).send({ question: "CVSS 점수 계산법" });
    expect(ok.body.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("클라우드 답변을 지식베이스에 저장하면 출처·검증경고를 붙여 인입한다(4단계)", async () => {
    ingestSpy.mockClear();
    const r = await request(app).post("/api/cloud/save-to-kb").set("Authorization", `Bearer ${admin}`)
      .send({ question: "XZ Utils 백도어가 뭐야?", answer: "리눅스 압축 도구에 심어진 공급망 백도어입니다.", providerLabel: "Google Gemini", model: "gemini-flash-latest" });
    expect(r.status).toBe(200);
    expect(r.body.documentId).toContain("☁"); // 출처 구분 접두어
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    const [docId, content] = ingestSpy.mock.calls[0];
    expect(docId).toContain("Google Gemini");
    expect(content).toContain("외부 클라우드 LLM이 생성한 내용");   // 검증 필요 경고
    expect(content).toContain("XZ Utils 백도어가 뭐야?");          // 질문 보존
    expect(content).toContain("공급망 백도어");                    // 답변 보존
  });

  it("답변 없이 저장 요청하면 400", async () => {
    const r = await request(app).post("/api/cloud/save-to-kb").set("Authorization", `Bearer ${admin}`).send({ question: "q" });
    expect(r.status).toBe(400);
  });

  // ── custom 제공자(직접 입력 · OpenAI 호환) ─────────────────────────────────
  // 사내 온프렘/타 GPU를 클라우드 답변선에 붙이는 경로. baseURL만 admin이 넣고, 나머지
  // (이탈 게이트·키 암호화·감사로그)는 다른 제공자와 "완전히 같은 코드"를 탄다 — 그걸 증명한다.
  describe("custom 제공자(직접 입력 OpenAI 호환)", () => {
    it("baseURL은 그대로 왕복하되 키는 새지 않는다", async () => {
      await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ provider: "custom", apiKey: "sk-custom-should-not-leak", model: "qwen3-14b", customBaseUrl: "http://10.8.0.12:8080/v1" });
      const cfg = await request(app).get("/api/cloud/config").set("Authorization", `Bearer ${admin}`);
      expect(cfg.body.customBaseUrl).toBe("http://10.8.0.12:8080/v1");
      const custom = cfg.body.providers.find((p: { provider: string }) => p.provider === "custom");
      expect(custom.hasKey).toBe(true);
      expect(custom.model).toBe("qwen3-14b");
      expect(custom.label).toContain("직접 입력");
      expect(JSON.stringify(cfg.body)).not.toContain("sk-custom-should-not-leak");
    });

    it("안전한 질문은 사용자가 지정한 baseURL의 /chat/completions로 나간다", async () => {
      await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ enabled: true, activeProvider: "custom", provider: "custom", apiKey: "sk-x", model: "qwen3-14b", customBaseUrl: "http://10.8.0.12:8080/v1" });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "SQL 인젝션은 …입니다." } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status: 200 })
      );
      const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`)
        .send({ question: "SQL 인젝션 방어 일반적인 방법 알려줘" });
      expect(r.body.routedToCloud).toBe(true);
      expect(r.body.providerLabel).toContain("직접 입력");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe("http://10.8.0.12:8080/v1/chat/completions"); // 사용자 지정 주소로 정확히 나감
      const sentBody = JSON.parse((init as RequestInit).body as string);
      expect(sentBody.messages.find((m: { role: string }) => m.role === "user").content).toBe("SQL 인젝션 방어 일반적인 방법 알려줘");
    });

    it("custom도 이탈 게이트를 똑같이 거친다 — 내부 식별자가 있으면 안 나간다", async () => {
      registerAsset({ id: "ai-secbot-01", name: "사내 챗봇XYZ", path: "p" });
      await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ enabled: true, activeProvider: "custom", provider: "custom", apiKey: "sk-x", model: "qwen3-14b", customBaseUrl: "http://10.8.0.12:8080/v1" });
      const fetchSpy = vi.spyOn(global, "fetch");
      const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`)
        .send({ question: "ai-secbot-01 자산 안전한가?" });
      expect(r.body.blocked).toBe(true);
      expect(r.body.routedToCloud).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled(); // 내부 식별자는 custom이어도 절대 안 나감
    });

    it("http(s)가 아닌 주소는 400으로 거부한다", async () => {
      for (const bad of ["ftp://10.8.0.12/v1", "javascript:alert(1)", "file:///etc/passwd"]) {
        const r = await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`).send({ customBaseUrl: bad });
        expect(r.status).toBe(400);
      }
    });

    it("주소를 안 넣고 custom을 켜면 크래시 없이 안전하게 실패한다", async () => {
      await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ enabled: true, activeProvider: "custom", provider: "custom", apiKey: "sk-x", model: "qwen3-14b" });
      const fetchSpy = vi.spyOn(global, "fetch");
      const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`)
        .send({ question: "CVSS 점수 계산법 알려줘" });
      expect(r.body.routedToCloud).toBe(false);
      expect(r.body.error).toContain("주소"); // "…서버 주소가 설정되지 않았습니다"
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("키 없이도 나간다 — 사내 GPU(키 없는 llama-server) 지원, Authorization 미전송", async () => {
      // 키를 아예 안 넣고(온프렘 llama-server는 키가 없다) custom을 켠다.
      await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ enabled: true, activeProvider: "custom", provider: "custom", model: "qwen3-14b", customBaseUrl: "http://10.8.0.12:8080/v1" });
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "답변" } }] }), { status: 200 })
      );
      const r = await request(app).post("/api/cloud/ask").set("Authorization", `Bearer ${admin}`)
        .send({ question: "포트 스캐닝 일반 개념 알려줘" });
      expect(r.body.routedToCloud).toBe(true); // 키 없어도 거부 안 함
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined(); // 키 없으면 Authorization 헤더 자체를 안 보냄
    });

    it("링크-로컬(169.254.x) 주소는 400 — 메타데이터 SSRF 방어, 사내망은 허용", async () => {
      const bad = await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ customBaseUrl: "http://169.254.169.254/latest/meta-data" });
      expect(bad.status).toBe(400);
      // 사내망(10.x·192.168.x·127.x)은 의도된 허용 — 막히면 안 된다.
      const ok = await request(app).post("/api/cloud/config").set("Authorization", `Bearer ${admin}`)
        .send({ customBaseUrl: "http://10.8.0.12:8080/v1" });
      expect(ok.status).toBe(200);
    });
  });
});
