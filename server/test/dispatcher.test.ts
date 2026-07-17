import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// bridge.ts spawns a real python process for modelscan; stub it so tests don't depend on
// python being installed and always exercise the same deterministic "no adapter" error path.
vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

const mockRunAdapter = vi.fn();
vi.mock("../src/engine/bridge", () => ({
  runAdapter: (...args: unknown[]) => mockRunAdapter(...args),
  listAdapters: () => [{ id: "modelscan", name: "ModelScan" }],
  registerBridgeRoutes: vi.fn(),
}));

import { createApp } from "../src/app";
import { resetAssetsForTests } from "../src/engine/assets";
import { planInstruction } from "../src/engine/dispatcher";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("dispatcher + intent + assets integration", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    resetAssetsForTests();
    mockRunAdapter.mockReset();
    mockRunAdapter.mockResolvedValue([
      { finding_type: "outdated_dependency", severity: "low", evidence: "stub finding", source_tool: "modelscan" },
    ]);
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

  it("scans the asset's registered file path, not its id", async () => {
    await request(app)
      .post("/api/assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

    await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "fraud-detect-llm 스캔해줘" });

    expect(mockRunAdapter).toHaveBeenCalledWith("modelscan", "models/fraud.gguf");
  });

  it.each([
    ["critical", "P0"],
    ["high", "P1"],
    ["medium", "P2"],
    ["low", "P3"],
  ] as const)("escalates task priority to %s -> %s based on the worst finding severity", async (severity, expectedPriority) => {
    mockRunAdapter.mockResolvedValue([
      { finding_type: "test_finding", severity, evidence: "stub", source_tool: "modelscan" },
    ]);

    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "아무거나 스캔해줘" });

    expect(res.body.task.priority).toBe(expectedPriority);
  });

  describe("복합 지시(멀티스텝 오케스트레이션)", () => {
    it("planInstruction builds ordered steps; single action stays single (1 step)", () => {
      expect(planInstruction("오늘 상태 어때?")).toHaveLength(0);
      expect(planInstruction("fraud-detect-llm 스캔해줘").map((s) => s.action)).toEqual(["scan"]);
      expect(planInstruction("스캔하고 우선순위 분석해서 리포트까지 작성해줘").map((s) => s.action)).toEqual([
        "scan",
        "analyze",
        "report",
      ]);
    });

    it("resolves 'CTI 영향 자산' scope for scan steps", () => {
      const steps = planInstruction("CTI 영향 자산 스캔하고 리포트까지");
      expect(steps.map((s) => s.action)).toEqual(["scan", "report"]);
      expect(steps[0].scope).toEqual({ type: "cti-affected" });
    });

    it("runs a 스캔→리포트 compound end to end, returning per-step results", async () => {
      await request(app)
        .post("/api/assets")
        .set("Authorization", `Bearer ${token}`)
        .send({ id: "fraud-detect-llm", name: "fraud-detect-llm", path: "models/fraud.gguf" });

      const res = await request(app)
        .post("/api/dispatch")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "fraud-detect-llm 스캔하고 리포트 작성해줘" });

      expect(res.status).toBe(200);
      // 스캔 뒤 GIJO Agent(normaltic)가 자동 투입돼 용어·사례를 부연한다(스캔·분석 후 1회, 리포트 전).
      expect(res.body.steps).toHaveLength(3);
      expect(res.body.steps[0].action).toBe("scan");
      expect(res.body.steps[0].assetIds).toEqual(["fraud-detect-llm"]);
      expect(res.body.steps[1].action).toBe("enrich");
      expect(res.body.steps[1].output).toBe("[mock] LLM 응답");
      expect(res.body.steps[2].action).toBe("report");
      expect(res.body.task.done).toBe(true);
      // 스캔이 실제로 자산에 finding을 기록했는지(누적 → 리포트 범위)
      const asset = await request(app).get("/api/assets/fraud-detect-llm").set("Authorization", `Bearer ${token}`);
      expect(asset.body.findings.length).toBeGreaterThan(0);
    });

    it("a CTI-affected compound scans the assets matched to seeded CTI threats", async () => {
      // 시드된 샘플 CTI 'KoBERT ...'와 매칭되도록 KoBERT 컴포넌트 자산 등록
      await request(app)
        .post("/api/assets")
        .set("Authorization", `Bearer ${token}`)
        .send({ id: "doc-ai", name: "문서 분류 AI", path: "models/doc.gguf", components: [{ name: "KoBERT", version: "1", license: "Apache" }] });

      const res = await request(app)
        .post("/api/dispatch")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "CTI 영향 자산 스캔하고 리포트까지" });

      expect(res.body.steps[0].action).toBe("scan");
      expect(res.body.steps[0].assetIds).toContain("doc-ai");
    });

    it("POST /api/dispatch/plan previews steps without executing", async () => {
      const res = await request(app)
        .post("/api/dispatch/plan")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "스캔하고 리포트까지" });
      expect(res.body.multi).toBe(true);
      expect(res.body.steps.map((s: { action: string }) => s.action)).toEqual(["scan", "report"]);
      // 실행되지 않았으므로 스캔 어댑터는 호출되지 않는다
      expect(mockRunAdapter).not.toHaveBeenCalled();
    });
  });
});
