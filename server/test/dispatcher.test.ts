import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// bridge.ts spawns a real python process for modelscan; stub it so tests don't depend on
// python being installed and always exercise the same deterministic "no adapter" error path.
vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.token as string;
}

describe("dispatcher + intent + assets integration", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("routes a scan instruction to the scan agent and extracts the mentioned asset id", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "fraud-detect-llm 스캔해줘" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("scan");
    expect(res.body.targetAssetId).toBe("fraud-detect-llm");
  });

  it("falls back to unknown-asset when the instruction doesn't mention a registered asset", async () => {
    const res = await request(app)
      .post("/api/intent/route")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "아무거나 스캔해줘" });

    expect(res.body.action).toBe("scan");
    expect(res.body.targetAssetId).toBeUndefined();
  });

  it("dispatching a scan records findings on the correct asset (regression: used to always write to 'unknown-asset')", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

    const dispatchRes = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "fraud-detect-llm 스캔해줘" });

    expect(dispatchRes.status).toBe(200);
    expect(dispatchRes.body.route.targetAssetId).toBe("fraud-detect-llm");

    const assetRes = await request(app).get("/api/assets/fraud-detect-llm").set("Authorization", `Bearer ${token}`);
    expect(assetRes.body.findings.length).toBeGreaterThan(0);
    expect(assetRes.body.lastScannedAt).not.toBeNull();

    const unknownRes = await request(app).get("/api/assets/unknown-asset").set("Authorization", `Bearer ${token}`);
    expect(unknownRes.status).toBe(404);
  });

  it("chat-routed instructions call the (mocked) LLM and mark the task done", async () => {
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "오늘 상태 어때?" });

    expect(res.body.route.action).toBe("chat");
    expect(res.body.output).toBe("[mock] LLM 응답");
    expect(res.body.task.done).toBe(true);
  });
});
