import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listAgentTools, listToolsFor, findAgentTool } from "../src/engine/agenttools";
import { registerAsset, updateAiBom, markSbomGenerated, resetAssetsForTests, getAsset, emptyAiBom } from "../src/engine/assets";

describe("AI-BOM(sbom) 도메인 역량", () => {
  afterEach(() => resetAssetsForTests());

  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "bare-llm", name: "빈 자산", path: "models/bare.gguf", assetType: "LLM 서비스" });
    registerAsset({ id: "full-llm", name: "채운 자산", path: "models/full.gguf", assetType: "LLM 서비스" });
    const filled = emptyAiBom();
    filled.model = { foundationModel: "Llama-3.1-8B", finetuneHistory: "없음", architecture: "decoder-only", weightsHash: "sha256:abc", intendedUse: "사내 문의 응대", limitations: "의료·법률 자문 불가", modelRef: "full-llm" };
    filled.dataset = { sources: "사내 위키", vectorDbLocation: "data/memory.lancedb" };
    filled.prompt = { systemPrompt: "보안 어시스턴트", guardrails: "인젝션 차단" };
    filled.agentTool = { apis: "내부 REST", mcpServers: "없음" };
    filled.infrastructure = { compute: "RTX 3090", hostingProvider: "온프렘" };
    updateAiBom("full-llm", filled);
    markSbomGenerated("full-llm");
  });

  it("sbom 도메인에 등록돼 있고 AI-BOM 화면에서 노출된다", () => {
    expect(listAgentTools().filter((t) => t.domain === "sbom").map((t) => t.name)).toContain("aibom_status");
    expect(listToolsFor(["sbom", "assets"]).map((t) => t.name)).toContain("aibom_status");
  });

  it("전체 현황 — 미완성·미생성 건수를 짚는다", () => {
    const out = findAgentTool("aibom_status")!.run({}) as string;
    expect(out).toContain("자산 2건");
    expect(out).toContain("AI-BOM 미완성 1건"); // bare-llm만 비어 있다
    expect(out).toContain("SBOM 미생성 1건");
    expect(out).toContain("bare-llm");
  });

  it("빈 자산 — 무엇이 빠졌는지 항목까지 알려준다", () => {
    const out = findAgentTool("aibom_status")!.run({ assetId: "bare-llm" }) as string;
    expect(out).toContain("미기재");
    expect(out).toContain("모델·기반모델");
    expect(out).toContain("SBOM 미생성");
    expect(out).toContain("견고성 미점검");
  });

  it("채운 자산 — 완료로 보고한다", () => {
    const out = findAgentTool("aibom_status")!.run({ assetId: "full-llm" }) as string;
    expect(out).toContain("5영역 모두 기재 완료");
    expect(out).toContain("SBOM 생성됨");
    expect(out).not.toContain("미기재:");
  });

  it("없는 자산은 지어내지 않는다", () => {
    const out = findAgentTool("aibom_status")!.run({ assetId: "없는자산xyz" }) as string;
    expect(out).toContain("찾을 수 없습니다");
  });

  it("조회 전용이라 결재판을 거치지 않는다", () => {
    expect(findAgentTool("aibom_status")!.write).toBe(false);
  });

  it("자산 등록 직후 AI-BOM은 비어 있다(기준선 확인)", () => {
    expect(getAsset("bare-llm")?.aibom.model.foundationModel).toBe("");
  });
});
