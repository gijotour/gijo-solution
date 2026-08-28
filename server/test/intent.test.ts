import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("intent routing (LLM-first with regex fallback)", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    mockChat.mockReset();
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("uses the LLM's classification when it returns well-formed JSON", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

    mockChat.mockResolvedValue('{"action":"scan","targetAssetId":"fraud-detect-llm"}');

    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "fraud-detect-llm 좀 봐줘" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ agentId: "scan", action: "scan", targetAssetId: "fraud-detect-llm" });
  });

  it("strips markdown code fences before parsing the LLM response", async () => {
    mockChat.mockResolvedValue('```json\n{"action":"report","targetAssetId":null}\n```');

    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "지난달 요약해줘" });

    expect(res.body).toEqual({ agentId: "report", action: "report" });
  });

  it("ignores a targetAssetId the LLM invents that isn't in the asset registry", async () => {
    mockChat.mockResolvedValue('{"action":"scan","targetAssetId":"not-a-real-asset"}');

    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "뭔가 스캔해줘" });

    expect(res.body).toEqual({ agentId: "scan", action: "scan" });
  });

  it("falls back to regex routing when the LLM reply isn't valid JSON", async () => {
    mockChat.mockResolvedValue("죄송하지만 형식을 지킬 수 없습니다.");

    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "재스캔 해줘" });

    expect(res.body).toEqual({ agentId: "scan", action: "scan" });
  });

  it("falls back to regex routing when the LLM reports an unknown action value", async () => {
    mockChat.mockResolvedValue('{"action":"delete","targetAssetId":null}');

    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "보고서 만들어줘" });

    expect(res.body).toEqual({ agentId: "report", action: "report" });
  });
});
