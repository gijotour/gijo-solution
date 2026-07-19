import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// 라우트 스택만 검증한다 — 임베딩/LLM은 목킹(실제 모델 불필요).
vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "ok"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { registerAsset, resetAssetsForTests, getAsset } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("자산 커버리지 REST — 인증 → 조회 → 결손 정정 왕복", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("인증 없이는 401", async () => {
    await request(app).get("/api/assets/coverage").expect(401);
  });

  it("coverage가 자산 id로 잡히지 않는다 — :id 라우트보다 먼저 등록돼야 한다", async () => {
    const res = await request(app).get("/api/assets/coverage").set(auth()).expect(200);
    // 자산 조회 응답(단건 Asset)이 아니라 커버리지 응답이어야 한다.
    expect(res.body).toHaveProperty("gaps");
    expect(res.body).toHaveProperty("ranked");
    expect(res.body).not.toHaveProperty("assetType");
  });

  it("담당부서가 빈 자산이 owner 결손으로 잡힌다", async () => {
    registerAsset({ id: "a1", name: "a1", path: "p", assetType: "model", owner: "", components: [] });
    const res = await request(app).get("/api/assets/coverage").set(auth()).expect(200);
    const owner = res.body.gaps.find((g: { kind: string }) => g.kind === "owner");
    expect(owner.assetIds).toContain("a1");
    expect(owner.why).toBeTruthy();
    expect(owner.fixLabel).toBeTruthy();
  });

  it("PATCH로 담당부서를 지정하면 그 결손이 사라진다", async () => {
    registerAsset({ id: "a1", name: "a1", path: "p", assetType: "model", owner: "", components: [] });

    await request(app).patch("/api/assets/a1").set(auth()).send({ owner: "정보보안팀" }).expect(200);
    expect(getAsset("a1")!.owner).toBe("정보보안팀");

    const res = await request(app).get("/api/assets/coverage").set(auth()).expect(200);
    const owner = res.body.gaps.find((g: { kind: string }) => g.kind === "owner");
    expect(owner?.assetIds ?? []).not.toContain("a1");
  });

  it("PATCH로 서비스를 연결할 수 있고, 빈 문자열은 미지정으로 저장된다", async () => {
    registerAsset({ id: "a1", name: "a1", path: "p", assetType: "model", owner: "보안팀", components: [] });

    await request(app).patch("/api/assets/a1").set(auth()).send({ service: "대외 웹서비스" }).expect(200);
    expect(getAsset("a1")!.service).toBe("대외 웹서비스");

    await request(app).patch("/api/assets/a1").set(auth()).send({ service: "  " }).expect(200);
    expect(getAsset("a1")!.service).toBeNull();
  });

  it("PATCH는 주지 않은 필드를 건드리지 않는다", async () => {
    registerAsset({ id: "a1", name: "a1", path: "p", assetType: "model", owner: "보안팀", service: "대외 웹", components: [] });
    await request(app).patch("/api/assets/a1").set(auth()).send({ owner: "인프라팀" }).expect(200);
    const a = getAsset("a1")!;
    expect(a.owner).toBe("인프라팀");
    expect(a.service).toBe("대외 웹"); // 그대로여야 한다
  });

  it("빈 PATCH는 400, 없는 자산은 404", async () => {
    registerAsset({ id: "a1", name: "a1", path: "p", assetType: "model", owner: "보안팀", components: [] });
    await request(app).patch("/api/assets/a1").set(auth()).send({}).expect(400);
    await request(app).patch("/api/assets/nope").set(auth()).send({ owner: "x" }).expect(404);
  });

  it("인증 없이는 PATCH도 막힌다", async () => {
    registerAsset({ id: "a1", name: "a1", path: "p", assetType: "model", owner: "보안팀", components: [] });
    await request(app).patch("/api/assets/a1").send({ owner: "탈취" }).expect(401);
    expect(getAsset("a1")!.owner).toBe("보안팀");
  });
});
