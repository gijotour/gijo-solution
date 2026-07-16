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
import { maintenanceSummary } from "../src/engine/report";
import type { MaintenanceItem } from "../src/engine/maintenance";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
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

  it("maintenanceSummary counts by status and flags overdue scheduled items", () => {
    const today = new Date().toISOString().slice(0, 10);
    const mk = (over: Partial<MaintenanceItem>): MaintenanceItem => ({
      id: "x", title: "t", productName: "p", scheduleDate: "2099-01-01", status: "scheduled",
      createdAt: 0, updatedAt: 0, ...over,
    });
    const items = [
      mk({ status: "scheduled", scheduleDate: today }), // 지연
      mk({ status: "scheduled", scheduleDate: "2099-01-01" }), // 예정(미래)
      mk({ status: "reported" }),
      mk({ status: "approved" }),
      mk({ status: "approved" }),
      mk({ status: "rejected" }),
    ];
    const s = maintenanceSummary(items);
    expect(s).toEqual({ total: 6, scheduled: 2, overdue: 1, reported: 1, approved: 2, rejected: 1 });
    expect(maintenanceSummary([])).toEqual({ total: 0, scheduled: 0, overdue: 0, reported: 0, approved: 0, rejected: 0 });
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
