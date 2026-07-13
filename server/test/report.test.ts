import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock] 경영진 요약 — 이번 주 특이사항 없음"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.token as string;
}

describe("report", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("generates a real .docx file and returns the (mocked) LLM executive summary", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

    const res = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand" });

    expect(res.status).toBe(200);
    expect(res.body.executiveSummary).toBe("[mock] 경영진 요약 — 이번 주 특이사항 없음");
    expect(res.body.filePath).toMatch(/ondemand-\d+\.docx$/);

    const bytes = fs.readFileSync(res.body.filePath);
    // .docx files are zip archives; verify the real PK magic bytes, not just that a file exists.
    expect(bytes.subarray(0, 2).toString("hex")).toBe("504b");
  });

  it("scopes the report to only the requested asset ids", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "asset-a", name: "asset-a", path: "x" });
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "asset-b", name: "asset-b", path: "x" });

    const res = await request(app)
      .post("/api/report/generate")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ondemand", assetIds: ["asset-a"] });

    expect(res.status).toBe(200);
  });
});
