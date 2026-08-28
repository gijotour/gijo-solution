// 파일(출처) 기준 자산 묶음 + 표시 이름(별칭) — 2026-07-25 사용자 요청 기능.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { sourceFileOf, buildSourceGroups, buildHubRow, type AssetHubRow } from "../src/engine/assethub";
import { registerAsset, recordFindings, getAsset, updateAssetDisplayName, listAssets, type Asset } from "../src/engine/assets";

function mkAsset(id: string, name: string, srcFile: string | null, sevs: ("critical" | "high" | "medium" | "low")[]): Asset {
  registerAsset({ id, name, path: id, assetType: "infra-host", owner: "" });
  if (srcFile) {
    recordFindings(
      id,
      sevs.map((severity, i) => ({ finding_type: `취약점${i}`, severity, evidence: "e", source_tool: srcFile, key: `k${i}`, state: "active" as const }))
    );
  }
  return getAsset(id)!;
}

describe("sourceFileOf — 자산의 출처 파일 판정", () => {
  it("findings의 source_tool(업로드 파일명)을 돌려준다", () => {
    const a = mkAsset("src-t1", "웹서버1", "점검보고서_A.pdf", ["medium", "low"]);
    expect(sourceFileOf(a)).toBe("점검보고서_A.pdf");
  });

  it("findings가 없으면 null(직접 등록 자산)", () => {
    const a = mkAsset("src-t2", "직접등록자산", null, []);
    expect(sourceFileOf(a)).toBeNull();
  });

  it("여러 출처가 섞이면 가장 많이 등장한 파일을 대표로 본다(재점검 대응)", () => {
    registerAsset({ id: "src-t3", name: "혼합", path: "h", assetType: "infra-host", owner: "" });
    recordFindings("src-t3", [
      { finding_type: "v1", severity: "low", evidence: "e", source_tool: "새보고서.pdf", key: "a", state: "active" },
      { finding_type: "v2", severity: "low", evidence: "e", source_tool: "새보고서.pdf", key: "b", state: "active" },
      { finding_type: "v3", severity: "low", evidence: "e", source_tool: "옛보고서.pdf", key: "c", state: "active" },
    ]);
    expect(sourceFileOf(getAsset("src-t3")!)).toBe("새보고서.pdf");
  });
});

describe("buildSourceGroups — 파일별 묶음", () => {
  it("같은 파일의 자산을 한 묶음으로 모으고 취약점을 합산한다", () => {
    const a1 = mkAsset("grp-a1", "서버A", "묶음보고서.pdf", ["high", "low"]);
    const a2 = mkAsset("grp-a2", "서버B", "묶음보고서.pdf", ["medium"]);
    const rows = [buildHubRow(a1), buildHubRow(a2)];
    const g = buildSourceGroups(rows, [a1, a2]).find((x) => x.sourceFile === "묶음보고서.pdf")!;
    expect(g.assetCount).toBe(2);
    expect(g.assetIds.sort()).toEqual(["grp-a1", "grp-a2"]);
    expect(g.vuln.open).toBe(3);
    expect(g.vuln.high).toBe(1);
    expect(g.vuln.medium).toBe(1);
  });

  it("직접 등록(파일 없음) 묶음은 라벨이 붙고 맨 뒤로 정렬된다", () => {
    const direct = mkAsset("grp-direct", "직접등록", null, []);
    const withFile = mkAsset("grp-file", "파일등록", "정렬보고서.pdf", ["critical"]);
    const rows = [buildHubRow(direct), buildHubRow(withFile)];
    const groups = buildSourceGroups(rows, [direct, withFile]);
    expect(groups[groups.length - 1].sourceFile).toBeNull();
    expect(groups[groups.length - 1].label).toContain("직접 등록");
  });

  it("허브 row에 displayName·sourceFile이 실린다(화면이 바로 쓴다)", () => {
    const a = mkAsset("row-src", "행자산", "행보고서.pdf", ["low"]);
    const row: AssetHubRow = buildHubRow(a);
    expect(row.sourceFile).toBe("행보고서.pdf");
    expect(row.displayName).toBeNull();
  });
});

describe("updateAssetDisplayName — 표시 이름(별칭)", () => {
  it("별칭을 설정하면 displayName에 담기고 원래 name은 보존된다", () => {
    mkAsset("dn-1", "안전대부 본인인증 웹 서버 (certify.example.com)", "보고서.pdf", ["low"]);
    const updated = updateAssetDisplayName("dn-1", "안전대부 본인인증");
    expect(updated?.displayName).toBe("안전대부 본인인증");
    expect(updated?.name).toBe("안전대부 본인인증 웹 서버 (certify.example.com)"); // 원래 이름 그대로
    expect(updated?.id).toBe("dn-1"); // ID·추적성 유지
  });

  it("빈 문자열·null이면 별칭을 지워 원래 이름으로 되돌린다", () => {
    mkAsset("dn-2", "원래이름", "보고서.pdf", ["low"]);
    updateAssetDisplayName("dn-2", "별칭");
    expect(getAsset("dn-2")?.displayName).toBe("별칭");
    updateAssetDisplayName("dn-2", "");
    expect(getAsset("dn-2")?.displayName).toBeNull();
    updateAssetDisplayName("dn-2", "다시별칭");
    updateAssetDisplayName("dn-2", null);
    expect(getAsset("dn-2")?.displayName).toBeNull();
  });

  it("없는 자산이면 undefined", () => {
    expect(updateAssetDisplayName("없는자산", "x")).toBeUndefined();
  });

  it("과도하게 긴 별칭은 120자로 자른다", () => {
    mkAsset("dn-3", "긴이름테스트", "보고서.pdf", ["low"]);
    const long = "가".repeat(200);
    expect(updateAssetDisplayName("dn-3", long)?.displayName?.length).toBe(120);
  });

  it("자산 목록에도 별칭이 함께 실린다", () => {
    mkAsset("dn-4", "목록확인", "보고서.pdf", ["low"]);
    updateAssetDisplayName("dn-4", "목록별칭");
    expect(listAssets().find((a) => a.id === "dn-4")?.displayName).toBe("목록별칭");
  });
});
