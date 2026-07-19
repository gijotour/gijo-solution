import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listAgentTools, listToolsFor, findAgentTool, toolCatalogText } from "../src/engine/agenttools";
import { registerAsset, resetAssetsForTests, updateAssetOwnership, markSbomGenerated, recordFindings, assetOriginOf, listAssets, getAsset } from "../src/engine/assets";

const getAssetOrigin = (id: string) => getAsset(id)!.origin;

const run = (args: Record<string, string>) => findAgentTool("asset_coverage")!.run(args) as string;

describe("자산 출처 판정 — 시드 샘플과 실 자산 구분", () => {
  afterEach(() => resetAssetsForTests());

  it("시드 샘플은 id로 정확히 식별한다", () => {
    expect(assetOriginOf("ai-secbot-01")).toBe("sample");
    expect(assetOriginOf("vuln:sample-web01")).toBe("sample");
  });

  it("취약점 스캔 반입분은 scanner다", () => {
    expect(assetOriginOf("vuln:10.20.0.5")).toBe("scanner");
    expect(assetOriginOf("vuln:192.168.219.98")).toBe("scanner");
  });

  it("직접 등록·저장소 스캔은 registered다", () => {
    expect(assetOriginOf("fraud-detect-llm")).toBe("registered");
    expect(assetOriginOf("repo:my-org/chatbot")).toBe("registered");
  });

  it("담당부서에 '샘플'이라 적은 실 자산을 샘플로 오인하지 않는다", () => {
    // 문자열로 추측했다면 여기서 틀린다.
    registerAsset({ id: "vuln:10.9.9.9", name: "샘플 서버", path: "p", assetType: "infra-host", owner: "샘플(예시)" });
    expect(getAssetOrigin("vuln:10.9.9.9")).toBe("scanner");
  });

  it("목록 응답에 origin이 실려 나간다 — 화면이 추측하지 않아도 된다", () => {
    registerAsset({ id: "vuln:10.9.9.9", name: "h", path: "p", assetType: "infra-host", owner: "" });
    const a = listAssets().find((x) => x.id === "vuln:10.9.9.9")!;
    expect(a.origin).toBe("scanner");
  });
});

describe("asset_coverage 역량 — 챗봇이 결손을 답한다", () => {
  afterEach(() => resetAssetsForTests());

  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "정상자산", name: "정상자산", path: "p", assetType: "model", owner: "보안팀" });
    updateAssetOwnership("정상자산", { service: "대외 웹" });
    markSbomGenerated("정상자산");
    recordFindings("정상자산", []); // 점검 이력까지 있어야 "완비"다
    registerAsset({ id: "담당없음", name: "담당없음", path: "p", assetType: "model", owner: "" });
    registerAsset({ id: "파일명오염", name: "파일명오염", path: "p", assetType: "model", owner: "scan-result.csv" });
  });

  it("assets 도메인에 등록돼 자산 화면에서 노출된다", () => {
    expect(listAgentTools().filter((t) => t.domain === "assets").map((t) => t.name)).toContain("asset_coverage");
    expect(listToolsFor(["assets"]).map((t) => t.name)).toContain("asset_coverage");
    // 무관한 도메인에서는 노출되지 않는다
    expect(listToolsFor(["report"]).map((t) => t.name)).not.toContain("asset_coverage");
  });

  it("조회 전용이다 — 결재 없이 자산을 바꾸지 않는다", () => {
    expect(findAgentTool("asset_coverage")!.write).toBe(false);
  });

  it("도구 설명이 asset_status와의 차이를 밝힌다 — LLM이 둘을 구분해야 한다", () => {
    const cat = toolCatalogText(["assets"]);
    expect(cat).toContain("asset_coverage");
    expect(findAgentTool("asset_coverage")!.description).toContain("모르는");
  });

  it("전체 요약은 건수와 이유를 함께 준다", () => {
    const out = run({});
    expect(out).toContain("자산 3건");
    expect(out).toContain("완비된 것은 1건");
    expect(out).toContain("담당부서");
    expect(out).toContain("먼저 볼 자산");
  });

  it("gap을 주면 그 결손의 자산 id를 나열한다", () => {
    const out = run({ gap: "owner" });
    expect(out).toContain("담당없음");
    expect(out).toContain("파일명오염"); // 파일명은 담당부서 없음으로 센다
    expect(out).not.toContain("정상자산");
    expect(out).toContain("조치:");
  });

  it("한글 인자도 받는다 — 담당자는 영문 키를 모른다", () => {
    expect(run({ gap: "담당부서" })).toContain("담당없음");
    expect(run({ gap: "서비스" })).toContain("서비스");
    expect(run({ gap: "미점검" })).toContain("점검");
  });

  it("모르는 gap 값은 조용히 전체를 보여주지 않고 가능한 값을 알려준다", () => {
    const out = run({ gap: "아무거나" });
    expect(out).toContain("알 수 없는");
    expect(out).toContain("owner");
  });

  it("자산이 없으면 없다고 말한다", () => {
    resetAssetsForTests();
    expect(run({})).toContain("등록된 자산이 없습니다");
  });
});
