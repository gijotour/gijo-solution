import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { importVulnScan } from "../src/engine/vulnscan";
import { listAssets, getAsset, resetAssetsForTests, updateAssetMeta } from "../src/engine/assets";

// 최소 Nessus CSV — 호스트 1건.
const CSV = [
  "Plugin ID,CVE,CVSS v3.0 Base Score,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution",
  '19506,,,None,10.99.0.1,tcp,0,Nessus Scan Information,정보,정보,n/a',
  '12345,CVE-2021-44228,10.0,Critical,10.99.0.1,tcp,8080,Apache Log4j RCE,원격코드실행,설명,업그레이드',
].join("\n");

describe("취약점 스캔 반입 — 담당부서(owner) 오염 방지", () => {
  beforeEach(() => resetAssetsForTests());
  afterEach(() => resetAssetsForTests());

  it("출처 파일명을 담당부서에 넣지 않는다", () => {
    importVulnScan(CSV, "csv", "nessus-scan-sample.csv");

    const asset = listAssets().find((a) => a.id.includes("10.99.0.1"));
    expect(asset, "자산이 생성돼야 한다").toBeDefined();
    // 예전엔 여기에 "nessus-scan-sample.csv"가 들어갔다.
    expect(asset!.owner).not.toContain(".csv");
    expect(asset!.owner).toBe("");
  });

  it("출처는 finding의 source_tool에 남는다 — 정보를 잃는 게 아니라 제자리에 둔다", () => {
    importVulnScan(CSV, "csv", "nessus-scan-sample.csv");
    const asset = listAssets().find((a) => a.id.includes("10.99.0.1"))!;
    expect(asset.findings.length).toBeGreaterThan(0);
    expect(asset.findings.some((f) => f.source_tool === "nessus-scan-sample.csv")).toBe(true);
  });

  it("재스캔이 손으로 지정한 담당부서를 덮어쓰지 않는다", () => {
    importVulnScan(CSV, "csv", "1차-scan.csv");
    const asset = listAssets().find((a) => a.id.includes("10.99.0.1"))!;

    // 담당자가 화면에서 담당부서를 지정한 상황
    updateAssetMeta(asset.id, asset.name, "인프라운영팀", asset.components);
    expect(getAsset(asset.id)!.owner).toBe("인프라운영팀");

    // 재스캔 — 예전엔 여기서 "2차-scan.csv"로 덮여 지정값이 날아갔다
    importVulnScan(CSV, "csv", "2차-scan.csv");
    expect(getAsset(asset.id)!.owner).toBe("인프라운영팀");
  });
});
