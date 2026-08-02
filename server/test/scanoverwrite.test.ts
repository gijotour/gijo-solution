// 실패한 스캔이 알던 취약점을 지우지 않는가.
//
// 실사고(2026-08-02): 데모 취약점 14건을 반입해 화면에서 확인까지 했는데 잠시 뒤 0건이었다.
//   recordFindings가 findings를 **통째로 교체**하는데, 전체 자산 스캔이 돌면 IP 호스트에는
//   modelscan이 맞지 않아 실패하고 그 scan_error 한 줄이 실제 취약점을 덮어썼다.
//   운영 데이터가 609건 전부 스캔 오류였던 것도 취약점이 없어서가 아니라 **지워졌기** 때문이다.
//
// ★ 지키는 것: 스캔 실패는 "모른다"이지 "없다"가 아니다. 모르는 것을 안다고 기록하면,
//   담당자가 그 화면을 보고 "다 조치됐네"라고 판단하는 순간이 사고다.
import { describe, it, expect, beforeEach } from "vitest";
import { resetAssetsForTests, registerAsset, recordFindings, getAsset } from "../src/engine/assets";
import type { StandardFinding } from "../src/engine/bridge";

const 진짜 = (t: string): StandardFinding =>
  ({ finding_type: t, severity: "critical", evidence: "e", source_tool: "nessus" } as StandardFinding);
const 실패 = (): StandardFinding =>
  ({ finding_type: "scan_error", severity: "low", evidence: "Command failed", source_tool: "modelscan" } as StandardFinding);

function 새자산(findings: StandardFinding[]) {
  registerAsset({ id: "h1", name: "h1", path: "10.0.0.1", assetType: "infra-host" });
  recordFindings("h1", findings);
}

describe("실패한 스캔은 알던 취약점을 지우지 않는다", () => {
  beforeEach(() => resetAssetsForTests());

  it("전부 스캔 실패로 들어오면 알던 취약점을 지킨다", () => {
    새자산([진짜("CVE-2021-44228"), 진짜("CVE-2024-3400")]);
    recordFindings("h1", [실패()]);
    const f = getAsset("h1")!.findings;
    const 남은진짜 = f.filter((x) => x.finding_type.startsWith("CVE-"));
    expect(남은진짜.length, "실패한 스캔이 실제 취약점을 지웠다").toBe(2);
  });

  it("실패 사실도 함께 남긴다 — 감추면 '왜 결과가 안 바뀌지'가 된다", () => {
    새자산([진짜("CVE-2021-44228")]);
    recordFindings("h1", [실패()]);
    const f = getAsset("h1")!.findings;
    expect(f.some((x) => x.finding_type === "scan_error"), "스캔 실패가 사라졌다").toBe(true);
  });

  it("정상 재스캔이 0건이면(다 고쳤다) 그대로 비운다", () => {
    // ⚠ 여기까지 막으면 조치 완료가 화면에 영영 반영되지 않는다.
    //   조건을 "들어온 것이 **전부 스캔 실패**"로 좁게 잡은 이유다.
    새자산([진짜("CVE-2021-44228")]);
    recordFindings("h1", []);
    expect(getAsset("h1")!.findings.length).toBe(0);
  });

  it("정상 재스캔 결과가 오면 그것으로 바뀐다", () => {
    새자산([진짜("CVE-2021-44228")]);
    recordFindings("h1", [진짜("CVE-2023-4966")]);
    const f = getAsset("h1")!.findings;
    expect(f.length).toBe(1);
    expect(f[0].finding_type).toBe("CVE-2023-4966");
  });

  it("지킬 진짜가 없으면(원래 실패뿐) 그냥 갱신한다", () => {
    새자산([실패()]);
    recordFindings("h1", [실패()]);
    expect(getAsset("h1")!.findings.length, "실패 기록이 쌓이면 안 된다").toBe(1);
  });
});
