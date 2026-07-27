// 모델 받기 인증(HuggingFace 토큰·프록시) — 설정 통합 ①단계(2026-07-28).
// 가장 중요한 성질: **토큰은 넣을 수만 있고 다시 나오지 않는다.**
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { getModelAuth, saveModelAuth, getModelAuthSecrets } from "../src/engine/modelauth";
import { listAudit } from "../src/engine/audit";
import { buildDownloadEnv } from "../src/engine/hfmodels";

const TOKEN = "hf_testonlyTOKEN12345x9K";

async function login(app: ReturnType<typeof createApp>, username = "jyh", password = "changeme") {
  const r = await request(app).post("/api/auth/login").send({ username, password, force: true });
  return r.body.accessToken as string;
}

describe("모델 받기 인증", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    app = createApp();
    token = await login(app);
    saveModelAuth({ token: "", proxyUrl: "" }); // 시험마다 깨끗이
  });

  it("토큰을 넣으면 끝 4자만 돌려준다 — 전체는 어디로도 안 나간다", async () => {
    const r = await request(app).post("/api/model-auth").set("Authorization", `Bearer ${token}`).send({ token: TOKEN });
    expect(r.status).toBe(200);
    expect(r.body.hasToken).toBe(true);
    expect(r.body.tokenTail).toBe(TOKEN.slice(-4));
    // 응답 어디에도 토큰 전체가 없어야 한다
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);

    const g = await request(app).get("/api/model-auth").set("Authorization", `Bearer ${token}`);
    expect(JSON.stringify(g.body)).not.toContain(TOKEN);
    expect(g.body.hasToken).toBe(true);
  });

  it("서버 안에서는 원래 토큰을 되찾을 수 있다(다운로드가 써야 하므로)", () => {
    saveModelAuth({ token: TOKEN });
    expect(getModelAuthSecrets().token).toBe(TOKEN);
  });

  it("빈 문자열로 저장하면 지워진다", () => {
    saveModelAuth({ token: TOKEN });
    expect(getModelAuth().hasToken).toBe(true);
    saveModelAuth({ token: "" });
    expect(getModelAuth().hasToken).toBe(false);
    expect(getModelAuth().tokenTail).toBeNull();
    expect(getModelAuthSecrets().token).toBeNull();
  });

  it("프록시만 바꿀 때 토큰은 그대로 남는다", () => {
    saveModelAuth({ token: TOKEN });
    saveModelAuth({ proxyUrl: "http://10.8.0.1:3128" });
    expect(getModelAuth().hasToken).toBe(true);
    expect(getModelAuthSecrets().token).toBe(TOKEN);
    expect(getModelAuth().proxyUrl).toBe("http://10.8.0.1:3128");
  });

  it("감사 기록에 토큰 값을 남기지 않는다", async () => {
    await request(app).post("/api/model-auth").set("Authorization", `Bearer ${token}`).send({ token: TOKEN });
    const rows = listAudit({ kind: "config", limit: 200 }).filter((e) => e.action === "모델 받기 인증 변경");
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
    expect(rows[0].target).toContain("토큰 등록");
  });

  it("바꿀 값이 없으면 400", async () => {
    const r = await request(app).post("/api/model-auth").set("Authorization", `Bearer ${token}`).send({});
    expect(r.status).toBe(400);
  });

  it("인증 없이는 못 본다", async () => {
    expect((await request(app).get("/api/model-auth")).status).toBe(401);
    expect((await request(app).post("/api/model-auth/test")).status).toBe(401);
  });

  // 저장만 되고 정작 받을 때 안 쓰이면 아무 의미가 없다 — 실제 다운로드가 읽는 값을 확인한다.
  describe("등록한 값이 실제 다운로드에 전달된다", () => {
    it("토큰은 환경변수로 간다(명령 인자로 주면 ps에 노출된다)", () => {
      saveModelAuth({ token: TOKEN });
      expect(buildDownloadEnv({}).HF_TOKEN).toBe(TOKEN);
    });

    it("토큰을 지우면 환경변수도 안 간다", () => {
      saveModelAuth({ token: "" });
      expect(buildDownloadEnv({}).HF_TOKEN).toBeUndefined();
    });

    it("프록시는 HTTPS_PROXY·HTTP_PROXY 둘 다로 간다", () => {
      saveModelAuth({ proxyUrl: "http://10.8.0.1:3128" });
      const env = buildDownloadEnv({});
      expect(env.HTTPS_PROXY).toBe("http://10.8.0.1:3128");
      expect(env.HTTP_PROXY).toBe("http://10.8.0.1:3128");
    });
  });
});
