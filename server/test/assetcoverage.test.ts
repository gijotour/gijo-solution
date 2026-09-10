import { describe, it, expect } from "vitest";
import {
  computeAssetCoverage,
  coverageSummaryText,
  gapsOf,
  isOwnerMissing,
  ownerGapDetail,
  type AssetCoverage,
} from "../src/engine/assetcoverage";
import { emptyAiBom, isAiAsset, type Asset } from "../src/engine/assets";

function asset(over: Partial<Asset> & { id: string }): Asset {
  return {
    name: over.id,
    path: "",
    assetType: "model",
    owner: "보안팀",
    service: "대외 웹",
    components: [],
    findings: [],
    scanHistory: [],
    aibom: emptyAiBom(),
    registeredAt: 1,
    lastScannedAt: 1000,
    sbomGeneratedAt: 1000,
    ...over,
  } as Asset;
}

const finding = (severity: string, over: Record<string, unknown> = {}) =>
  ({ finding_type: "t", severity, evidence: "e", source_tool: "s", ...over }) as never;

describe("자산 커버리지 — 무엇을 모르는가", () => {
  it("파일명처럼 생긴 담당부서는 '없음'으로 센다", () => {
    // 반입 파일명이 담당부서로 저장되던 버그의 잔재. 있음으로 세면 커버리지가 거짓말을 한다.
    expect(isOwnerMissing("nessus-scan-sample.csv")).toBe(true);
    expect(isOwnerMissing("oracle_nl4mm9.html")).toBe(true);
    expect(isOwnerMissing("")).toBe(true);
    expect(isOwnerMissing("   ")).toBe(true);
    expect(isOwnerMissing(null)).toBe(true);
    expect(isOwnerMissing("보안팀")).toBe(false);
    // 부서명에 점이 들어가도 확장자가 아니면 유효하다
    expect(isOwnerMissing("보안팀 A.그룹")).toBe(false);
  });

  it("결손 4종을 각각 잡아낸다", () => {
    expect(gapsOf(asset({ id: "a" }))).toEqual([]);
    expect(gapsOf(asset({ id: "a", owner: "" }))).toEqual(["owner"]);
    expect(gapsOf(asset({ id: "a", service: null }))).toEqual(["service"]);
    expect(gapsOf(asset({ id: "a", sbomGeneratedAt: null }))).toEqual(["sbom"]);
    expect(gapsOf(asset({ id: "a", lastScannedAt: null }))).toEqual(["unscanned"]);
  });

  it("isAiAsset — AI 유형이거나 AI-BOM(모델참조·파운데이션)이 채워지면 AI 자산", () => {
    expect(isAiAsset(asset({ id: "a", assetType: "LLM 서비스" }))).toBe(true);
    expect(isAiAsset(asset({ id: "a", assetType: "이상탐지 모델" }))).toBe(true);
    // IT 유형이라도 AI-BOM에 모델 참조가 있으면 AI 자산으로 본다.
    const withModel = asset({ id: "a", assetType: "서버" });
    withModel.aibom.model.modelRef = "models/x.gguf";
    expect(isAiAsset(withModel)).toBe(true);
    // 방화벽·스캐너 IP 호스트 등 AI-BOM이 빈 IT 자산은 AI 자산 아님.
    expect(isAiAsset(asset({ id: "vuln:10.0.0.1", assetType: "infra-host" }))).toBe(false);
    expect(isAiAsset(asset({ id: "a", assetType: "방화벽" }))).toBe(false);
  });

  it("SBOM 결손은 소프트웨어·AI 자산에만 — 스캐너 IP 호스트·인프라 호스트는 제외", () => {
    // 방화벽·DB 같은 IT 자산까지 'SBOM 없음'으로 세면 거짓 결손이 된다(2026-07-19 수정).
    expect(gapsOf(asset({ id: "vuln:10.0.0.1", sbomGeneratedAt: null }))).not.toContain("sbom");
    expect(gapsOf(asset({ id: "a", assetType: "infra-host", sbomGeneratedAt: null }))).not.toContain("sbom");
    // 소프트웨어·AI 자산은 종전대로 SBOM 결손을 짚는다.
    expect(gapsOf(asset({ id: "a", assetType: "LLM 서비스", sbomGeneratedAt: null }))).toContain("sbom");
    // 담당부서·미점검 같은 다른 결손은 IT 자산에도 그대로 적용된다(SBOM만 제외).
    expect(gapsOf(asset({ id: "vuln:10.0.0.1", owner: "", sbomGeneratedAt: null }))).toEqual(["owner"]);
  });

  it("fixed 처리된 취약점은 현재 위험으로 세지 않는다", () => {
    const cov = computeAssetCoverage([
      asset({ id: "a", findings: [finding("critical", { state: "fixed" })] }),
    ]);
    expect(cov.ranked[0].openFindings).toBe(0);
  });

  it("취약점이 있는데 담당자를 모르는 자산이 맨 위로 온다", () => {
    const cov = computeAssetCoverage([
      asset({ id: "완비", findings: [finding("critical")] }),
      asset({ id: "sbom없음", sbomGeneratedAt: null }),
      asset({ id: "위험+담당불명", owner: "scan.csv", findings: [finding("critical"), finding("high")] }),
    ]);
    expect(cov.ranked[0].id).toBe("위험+담당불명");
    expect(cov.ranked[0].why).toContain("연락할 담당자를 모름");
  });

  it("KEV 보유 자산은 결손이 없어도 우선순위가 올라간다", () => {
    const cov = computeAssetCoverage([
      asset({ id: "결손많음", owner: "", service: null, sbomGeneratedAt: null }),
      asset({ id: "kev보유", findings: [finding("high", { kev: true })] }),
    ]);
    expect(cov.ranked[0].id).toBe("kev보유");
    expect(cov.ranked[0].kev).toBe(true);
  });

  it("결손 없는 자산 수를 센다", () => {
    const cov = computeAssetCoverage([
      asset({ id: "a" }),
      asset({ id: "b" }),
      asset({ id: "c", owner: "" }),
    ]);
    expect(cov.total).toBe(3);
    expect(cov.complete).toBe(2);
  });

  it("결손 묶음마다 이유와 조치가 붙는다 — 숫자만으로는 판단할 수 없다", () => {
    const cov = computeAssetCoverage([asset({ id: "a", owner: "" }), asset({ id: "b", owner: "" })]);
    const owner = cov.gaps.find((g) => g.kind === "owner")!;
    expect(owner.assetIds).toEqual(["a", "b"]);
    expect(owner.severity).toBe("high");
    expect(owner.why.length).toBeGreaterThan(10);
    expect(owner.fixLabel).toBeTruthy();
  });

  // ★ 2026-09-10 고객 QA 예행 결함 6 — 뒤 두 절은 예전엔 고정 문자열이었다. 업무 데이터 0에서
  //   시작한 새 인스턴스(키트 1개)에는 「출처 파일명이 잘못 저장돼 있습니다」가 거짓이 된다.
  it("★ owner가 전부 빈칸이면 출처 파일명 절이 안 나온다", () => {
    const cov = computeAssetCoverage([asset({ id: "a", owner: "" }), asset({ id: "b", owner: "   " })]);
    const owner = cov.gaps.find((g) => g.kind === "owner")!;
    expect(owner.why).not.toContain("출처 파일명");
    expect(owner.why).toContain("스캐너로 들여온 자산은 담당부서가 비어 있습니다");
  });

  it("★ owner: \"scan.csv\"가 섞이면 출처 파일명 절이 나온다", () => {
    const cov = computeAssetCoverage([asset({ id: "a", owner: "scan.csv" }), asset({ id: "b" })]);
    const owner = cov.gaps.find((g) => g.kind === "owner")!;
    expect(owner.why).toContain("출처 파일명");
  });

  it("ownerGapDetail — 데이터가 없으면 빈 문자열(정규식 베끼기 금지 계약, 시험이 직접 부른다)", () => {
    expect(ownerGapDetail([])).toBe("");
    expect(ownerGapDetail(["보안팀"])).toBe("");
    expect(ownerGapDetail([""])).toContain("스캐너로 들여온");
    expect(ownerGapDetail(["oracle_nl4mm9.html"])).toContain("출처 파일명");
  });

  it("담당부서 결손이 SBOM 결손보다 위에 온다", () => {
    const cov = computeAssetCoverage([asset({ id: "a", owner: "", sbomGeneratedAt: null })]);
    const kinds = cov.gaps.map((g) => g.kind);
    expect(kinds.indexOf("owner")).toBeLessThan(kinds.indexOf("sbom"));
  });

  it("자산이 없으면 결손도 없다", () => {
    const cov = computeAssetCoverage([]);
    expect(cov).toMatchObject({ total: 0, complete: 0, gaps: [], ranked: [] });
    expect(coverageSummaryText(cov)).toContain("등록된 자산이 없습니다");
  });

  it("요약문은 결손 없을 때와 있을 때를 구분해 말한다", () => {
    const clean: AssetCoverage = computeAssetCoverage([asset({ id: "a" })]);
    expect(coverageSummaryText(clean)).toContain("결손이 없습니다");

    const dirty = computeAssetCoverage([asset({ id: "a", owner: "scan.csv", findings: [finding("critical")] })]);
    const text = coverageSummaryText(dirty);
    expect(text).toContain("담당부서");
    expect(text).toContain("먼저 볼 자산");
    expect(text).toContain("a");
  });
});
