import { describe, it, expect, vi } from "vitest";

// 관측 소스(모델 파일·엔진 풀·에이전트 배정)와 자산을 모킹해 Shadow 판정 로직만 검증.
vi.mock("../src/engine/assets", () => ({
  listAssets: () => [
    { assetType: "llm-service", aibom: { model: { modelRef: "models/gijo-main-orchestrator/gijo-main-orchestrator.gguf", foundationModel: "" } } },
  ],
  isAiAsset: () => true,
}));
vi.mock("../src/engine/localengine", () => ({
  listAvailableModels: () => [{ id: "gijo-main-orchestrator", running: true }, { id: "rogue-model-x", running: false }],
  getLocalEngineStatus: () => ({ loaded: [{ modelId: "gijo-main-orchestrator", port: 8080, ready: true }, { modelId: "unregistered-live", port: 8082, ready: true }], modelId: "gijo-main-orchestrator", embedding: { running: true, port: 8081, modelId: "bge-m3" } }),
}));
vi.mock("../src/engine/agents", () => ({
  listAgents: () => [{ id: "a1", name: "분석가", assignedModelId: "unregistered-live" }],
}));

const { detectShadowAi, formatShadowAi } = await import("../src/engine/shadowai");

describe("Shadow AI 탐지", () => {
  it("자산에 연결된 모델은 shadow가 아니고, 미등록만 잡는다", () => {
    const r = detectShadowAi();
    const ids = r.shadow.map((s) => s.modelId);
    expect(ids).not.toContain("gijo-main-orchestrator"); // 거버넌스됨
    expect(ids).toContain("rogue-model-x"); // 파일만 있고 미등록
    expect(ids).toContain("unregistered-live"); // 로드·에이전트 사용 중인데 미등록
  });
  it("로드·사용 중이면 severity high", () => {
    const r = detectShadowAi();
    const live = r.shadow.find((s) => s.modelId === "unregistered-live");
    expect(live?.severity).toBe("high");
    expect(live?.usedByAgents).toContain("분석가");
    const dormant = r.shadow.find((s) => s.modelId === "rogue-model-x");
    expect(dormant?.severity).toBe("medium");
  });
  it("formatShadowAi — 발견 개수와 안내 포함", () => {
    const t = formatShadowAi();
    expect(t).toContain("미등록 AI 모델");
    expect(t).toContain("자산");
  });
});
