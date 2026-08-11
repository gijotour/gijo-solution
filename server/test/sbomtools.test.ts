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
    // ★ 2026-08-04: **사람이 읽는 이름**으로 말한다. 예전엔 내부 id("bare-llm")를 그대로 냈는데,
    //   운영 데이터에서는 그게 `vuln:192.168.219.98` 같은 글자라 담당자가 못 읽는다.
    expect(out).toContain("빈 자산");
    expect(out, "내부 id는 사람에게 보이지 않는다").not.toContain("bare-llm");
    // ★ 숫자만 주고 끝내지 않는다 — 다음 걸음이 붙어야 대화창에서 일이 끝난다.
    expect(out).toContain("SBOM 만들어줘");
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

  // 실측(2026-07-19): 취약점 스캔으로 들어온 IP 기반 IT 자산까지 세어 "자산 7건 중 미완성 6건"으로
  // 보고했다 — 모델·프롬프트가 없는 게 정상인 방화벽·호스트를 문제로 올려 담당자를 오도한 결함.
  // 전체 집계 제외는 그때 고쳤으나 **단건 조회와 제외 안내 두 자리가 3주간 비어 있었다**(2026-08-12 반영).
  describe("IT 자산(취약점 스캔 유입 호스트) 분리", () => {
    beforeEach(() => {
      // vulnscan.ts가 호스트를 등록하는 형태 그대로: id는 "vuln:" 접두사, assetType은 infra-host.
      registerAsset({ id: "vuln:fortigate-vpn-01", name: "방화벽 (10.0.0.1)", path: "10.0.0.1", assetType: "infra-host", owner: "nessus-scan.csv" });
      registerAsset({ id: "vuln:10.20.0.5", name: "10.20.0.5", path: "10.20.0.5", assetType: "infra-host", owner: "nessus-scan.csv" });
    });

    it("전체 현황은 AI 자산만 센다 — IT 자산이 섞여도 미완성 건수가 오염되지 않는다", () => {
      const out = findAgentTool("aibom_status")!.run({}) as string;
      expect(out).toContain("AI 자산 2건"); // 전체 4건 중 AI만
      expect(out).toContain("AI-BOM 미완성 1건"); // bare-llm 하나뿐 — IT 자산 2건은 불포함
      expect(out).toContain("SBOM 미생성 1건");
      expect(out).not.toContain("방화벽"); // 목록에도 안 나온다(표시이름 기준)
      expect(out).not.toContain("10.20.0.5");
    });

    it("전체 수와 다른 이유를 알 수 있게 IT 자산 건수를 짚어준다", () => {
      const out = findAgentTool("aibom_status")!.run({}) as string;
      expect(out).toContain("IT 자산 2건");
    });

    it("IT 자산이 없으면 군더더기 문구를 붙이지 않는다", () => {
      resetAssetsForTests();
      registerAsset({ id: "solo-llm", name: "단독", path: "models/solo.gguf", assetType: "LLM 서비스" });
      const out = findAgentTool("aibom_status")!.run({}) as string;
      expect(out).toContain("AI 자산 1건");
      expect(out).not.toContain("IT 자산");
    });

    // 전체 현황이 IT 자산을 빼놓고 단건 조회만 0/13으로 답하면 앞뒤가 안 맞는다.
    it("IT 자산 단건 조회는 0/13 미기재가 아니라 '대상 아님'으로 답한다", () => {
      const out = findAgentTool("aibom_status")!.run({ assetId: "vuln:fortigate-vpn-01" }) as string;
      expect(out).toContain("AI-BOM 대상이 아닙니다");
      expect(out).toContain("infra-host");
      expect(out).not.toContain("미기재:");
      expect(out).not.toContain("프롬프트·시스템프롬프트"); // 방화벽에 요구하면 안 되는 항목
    });

    it("AI 자산이 하나도 없으면 지어내지 않고 없다고 말한다", () => {
      resetAssetsForTests();
      registerAsset({ id: "vuln:10.20.0.9", name: "10.20.0.9", path: "10.20.0.9", assetType: "infra-host", owner: "nessus" });
      const out = findAgentTool("aibom_status")!.run({}) as string;
      expect(out).toContain("AI/모델 자산이 없습니다");
      expect(out).not.toContain("미완성");
    });

    // 유형이 IT라도 AI-BOM 핵심 항목이 채워져 있으면 AI 자산으로 본다(isAiAsset의 긍정 판별 보완).
    it("유형이 애매해도 AI-BOM이 기재돼 있으면 AI 자산으로 집계한다", () => {
      registerAsset({ id: "etc-ai", name: "수동 등록 AI", path: "/srv/ai/bot", assetType: "기타" });
      const b = emptyAiBom();
      b.model = { ...b.model, foundationModel: "Qwen2.5-7B" };
      updateAiBom("etc-ai", b);
      const out = findAgentTool("aibom_status")!.run({}) as string;
      expect(out).toContain("AI 자산 3건");
      expect(out).toContain("수동 등록 AI"); // 목록은 표시이름으로 낸다(내부 id를 사람에게 안 보인다)
    });
  });
});
