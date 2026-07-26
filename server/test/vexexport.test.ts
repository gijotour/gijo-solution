// VEX 출력 — "영향 없음(not_affected)"을 근거 없이 내보내지 않는 것이 이 모듈의 핵심 계약이다.
// 이건 남에게 배포되는 선언이라, 빈 근거로 나가면 우리가 거짓말을 퍼뜨리는 셈이 된다.
import { describe, it, expect } from "vitest";
import { toVexAnalysis, cvesOf, buildVexDocument } from "../src/engine/vexexport";
import type { FindingReview } from "../src/engine/approvals";

const R = (over: Partial<FindingReview>): FindingReview => ({
  assetId: "a1", assetName: "웹서버-01", findingKey: "k1",
  finding: { finding_type: "Apache Log4j < 2.15.0 RCE (CVE-2021-44228)", severity: "critical", evidence: "", source_tool: "test" },
  status: "pending", overdue: false, gone: false, ...over,
} as FindingReview);

describe("toVexAnalysis — 승인 상태 → VEX 상태", () => {
  it("미검토 → under_investigation", () => {
    expect(toVexAnalysis("pending").state).toBe("under_investigation");
  });
  it("진행중 → affected", () => {
    expect(toVexAnalysis("in_progress").state).toBe("affected");
  });
  it("검증대기도 affected — 아직 닫히지 않았다", () => {
    expect(toVexAnalysis("verifying").state).toBe("affected");
  });
  it("완료 → fixed", () => {
    expect(toVexAnalysis("approved").state).toBe("fixed");
  });

  it("반려(오탐) → not_affected + 취약코드 없음 근거", () => {
    const a = toVexAnalysis("rejected", "false_positive");
    expect(a.state).toBe("not_affected");
    expect(a.justification).toBe("vulnerable_code_not_present");
  });

  it("반려(보상통제) → not_affected + 완화조치 근거", () => {
    const a = toVexAnalysis("rejected", "compensating_control");
    expect(a.state).toBe("not_affected");
    expect(a.justification).toBe("protected_by_mitigating_control");
  });

  // 가장 중요한 계약
  it("사유 없는 반려는 not_affected로 내보내지 않는다 — 근거 없는 '영향 없음'은 배포 금지", () => {
    const a = toVexAnalysis("rejected", null);
    expect(a.state).toBe("under_investigation");
    expect(a.detail).toContain("반려 사유가 기록되지 않아");
  });

  it("메모가 있으면 detail로 실어 보낸다(받는 쪽이 판단 근거를 본다)", () => {
    expect(toVexAnalysis("approved", null, "2026-07-26 패치 적용").detail).toBe("2026-07-26 패치 적용");
  });
});

describe("cvesOf — CVE 추출", () => {
  it("제목에서 뽑는다", () => {
    expect(cvesOf(R({}))).toEqual(["CVE-2021-44228"]);
  });
  it("근거에 여러 개면 전부(중복 제거)", () => {
    const r = R({ finding: { ...R({}).finding, finding_type: "Oracle CPU 미적용", evidence: "CVE-2022-21432, CVE-2022-21432, CVE-2022-21445" } });
    expect(cvesOf(r)).toEqual(["CVE-2022-21432", "CVE-2022-21445"]);
  });
  it("CVE가 없으면 빈 배열", () => {
    const r = R({ finding: { ...R({}).finding, finding_type: "설정 미흡", evidence: "" } });
    expect(cvesOf(r)).toEqual([]);
  });
});

describe("buildVexDocument", () => {
  it("CycloneDX 1.5 VEX 형식으로 만든다", () => {
    const doc = buildVexDocument([R({ status: "approved" })]);
    expect(doc.bomFormat).toBe("CycloneDX");
    expect(doc.specVersion).toBe("1.5");
    expect(doc.vulnerabilities).toHaveLength(1);
    expect(doc.vulnerabilities[0].id).toBe("CVE-2021-44228");
    expect((doc.vulnerabilities[0].analysis as { state: string }).state).toBe("fixed");
  });

  it("CVE 없는 finding은 담지 않는다 — 받는 쪽이 쓸 수 없는 항목은 소음이다", () => {
    const noCve = R({ finding: { ...R({}).finding, finding_type: "설정 미흡", evidence: "" } });
    expect(buildVexDocument([noCve]).vulnerabilities).toHaveLength(0);
  });

  it("CVE가 여러 개면 각각 한 항목으로 나간다(VEX는 취약점 단위 문서)", () => {
    const multi = R({ finding: { ...R({}).finding, finding_type: "Oracle CPU (CVE-2022-21432 외)", evidence: "CVE-2022-21445" } });
    expect(buildVexDocument([multi]).vulnerabilities).toHaveLength(2);
  });

  it("자산·상태·검토자를 속성으로 함께 실어 추적 가능하게 한다", () => {
    const doc = buildVexDocument([R({ status: "rejected", rejectReason: "compensating_control", reviewedBy: "이보안", reviewedAt: 1753000000000 })]);
    const props = doc.vulnerabilities[0].properties as { name: string; value: string }[];
    expect(props.find((p) => p.name === "gijo:asset")!.value).toBe("웹서버-01");
    expect(props.find((p) => p.name === "gijo:reviewedBy")!.value).toBe("이보안");
  });

  it("영향 자산(affects)이 붙는다", () => {
    const doc = buildVexDocument([R({})]);
    expect(doc.vulnerabilities[0].affects).toEqual([{ ref: "a1" }]);
  });
});
