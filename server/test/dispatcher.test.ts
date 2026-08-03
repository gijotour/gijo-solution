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
  // 2026-08-03: dispatcher가 runAdapter를 직접 부르지 않고 모델스캔()을 거치게 바뀌었다
  //   (안 맞는 자산에 파이썬을 띄우지 않으려고). 여기 모의가 그 함수를 안 가지고 있어
  //   스캔이 통째로 조용히 죽었고 이 시험이 잡았다.
  // ⚠ 여기서는 **대상 판정을 통과한 것으로 두고** 경로 전달만 본다. 판정 자체(IP 호스트는
  //   제외, 모델 파일은 통과)는 findingsrestore.test.ts가 진짜 함수로 확인한다.
  모델스캔대상인가: () => true,
  모델스캔: (assetPath: string) => mockRunAdapter("modelscan", assetPath),
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

  it("도움말 지시는 화면별 가이드로 결정적으로 답한다(LLM 미경유)", async () => {
    const res = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "이 화면 뭐 할 수 있어?", screen: "hardening.html" });
    expect(res.status).toBe(200);
    expect(res.body.output).toContain("하드닝");
    expect(res.body.output).toContain("이 화면에서 대화창으로 할 수 있는 것");
    // 화면을 안 주면 전체 개요
    const res2 = await request(app)
      .post("/api/dispatch")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "사용법 알려줘" });
    expect(res2.body.output).toContain("사용 안내");
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

  describe("작업 세션 연결 — sessionId로 지시하면 턴이 기록된다", () => {
    it("세션과 함께 지시하면 user·assistant 턴이 저장되고 응답에 sessionId가 실린다", async () => {
      const created = await request(app)
        .post("/api/work-sessions")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      const sessionId = created.body.id as string;

      const res = await request(app)
        .post("/api/dispatch")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "오늘 상태 어때?", sessionId });
      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe(sessionId);

      const detail = await request(app).get(`/api/work-sessions/${sessionId}`).set("Authorization", `Bearer ${token}`);
      expect(detail.body.turns).toHaveLength(2);
      expect(detail.body.turns[0].role).toBe("user");
      expect(detail.body.turns[0].content).toBe("오늘 상태 어때?");
      expect(detail.body.turns[1].role).toBe("assistant");
      // 첫 user 턴이 세션 제목을 자동으로 지었는지
      expect(detail.body.session.title).toBe("오늘 상태 어때?");

      // 세션 지시·응답이 실시간 협업 로그에도 세션 제목 꼬리표로 흘렀는지
      const collab = await request(app).get("/api/collaboration/history").set("Authorization", `Bearer ${token}`);
      const sessionEvents = collab.body.filter((e: { message: string }) => e.message.includes("[오늘 상태 어때?]"));
      expect(sessionEvents.length).toBeGreaterThanOrEqual(2); // 지시(💬) + 응답(💬)
      expect(sessionEvents.some((e: { from: string }) => e.from === "세션")).toBe(true);
    });

    it("sessionId 없이 지시해도 세션이 자동 생성된다(모든 행위를 작업 세션에 — 2026-07-20)", async () => {
      const before = await request(app).get("/api/work-sessions").set("Authorization", `Bearer ${token}`);
      const res = await request(app)
        .post("/api/dispatch")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "오늘 상태 어때?" });
      expect(res.body.sessionId).toBeTruthy(); // 자동 생성된 세션을 돌려줘 클라가 이어갈 수 있다
      const after = await request(app).get("/api/work-sessions").set("Authorization", `Bearer ${token}`);
      expect(after.body.length).toBe(before.body.length + 1);
      const created = after.body.find((s: { id: string }) => s.id === res.body.sessionId);
      expect(created).toBeTruthy();
      expect(created.title).toContain("오늘 상태"); // 첫 지시로 제목 자동 지정
    });
  });

  describe("학습 루프 실행 지시 — 확인 절차(오발동 방지)", () => {
    it.each(["학습 루프 실행해줘", "파인튜닝 시작해줘", "학습루프 돌려줘"])(
      "'%s'는 바로 실행하지 않고 confirm(learnloop)으로 확인을 요구한다",
      async (text) => {
        const res = await request(app)
          .post("/api/dispatch")
          .set("Authorization", `Bearer ${token}`)
          .send({ text });
        expect(res.status).toBe(200);
        expect(res.body.confirm?.type).toBe("learnloop");
        expect(Array.isArray(res.body.confirm.datasets)).toBe(true);
        expect(res.body.output).toContain("일시 중단");
        expect(res.body.task.done).toBe(true);
        expect(mockRunAdapter).not.toHaveBeenCalled(); // 스캔 파이프라인을 타지 않는다
      }
    );

    it("학습 루프를 언급만 한 지시(실행 동사 없음)는 확인 절차를 타지 않는다", async () => {
      const res = await request(app)
        .post("/api/dispatch")
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "학습 루프가 뭐야?" });
      expect(res.body.confirm).toBeUndefined();
    });
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
