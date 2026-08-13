import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listAgentTools, listToolsFor, findAgentTool } from "../src/engine/agenttools";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";
import { prioritizedReviews, listFindingReviews } from "../src/engine/approvals";

describe("취약점(vuln) 도메인 역량", () => {
  // 자산·검토 상태는 모듈 전역이라 다른 테스트 파일과 공유된다. 정리를 빠뜨리면 이 파일이
  // 남긴 자산 때문에 다른 테스트가 실패한다(실제로 겪었다 — 실행 순서에 따라 결과가 달라졌다).
  afterEach(() => resetAssetsForTests());

  beforeEach(() => {
    resetAssetsForTests();
    registerAsset({ id: "test-llm", name: "테스트 LLM", path: "models/test.gguf", assetType: "LLM 서비스" });
    recordFindings("test-llm", [
      { finding_type: "pickle 역직렬화", severity: "critical", evidence: "data.pkl", source_tool: "modelscan" },
      { finding_type: "미서명 모델 파일", severity: "medium", evidence: "no signature", source_tool: "modelscan" },
    ]);
  });

  it("취약점 도구가 vuln 도메인에 등록돼 있다", () => {
    const vulnTools = listAgentTools().filter((t) => t.domain === "vuln").map((t) => t.name);
    expect(vulnTools).toContain("finding_status");
    expect(vulnTools).toContain("review_finding");
    // 취약점을 다루는 기존 도구도 vuln으로 옮겼다(원래 assets로 잘못 분류돼 있었다)
    expect(vulnTools).toContain("assign_finding");
    expect(vulnTools).toContain("update_finding_status");
  });

  it("취약점 화면에서 vuln 도구가 노출된다", () => {
    const names = listToolsFor(["vuln", "assets"]).map((t) => t.name);
    expect(names).toContain("finding_status");
    expect(names).toContain("review_finding");
  });

  it("finding_status — 현황을 요약한다", () => {
    const out = findAgentTool("finding_status")!.run({}) as string;
    expect(out).toContain("취약점");
    expect(out).toContain("담당자 미배정");
    // ⚠ 내부 id가 아니라 **이름**이 나온다(2026-08-03 말투 규범 — `vuln:10.10.20.41`이
    //   담당자 화면에 그대로 나갔다). 등록된 이름은 "테스트 LLM"이다.
    expect(out).toContain("테스트 LLM");
    expect(out, "내부 id가 사람에게 나간다").not.toMatch(/(vuln|asset|finding):/);
  });

  it("finding_status — 조건으로 좁힌다", () => {
    const critical = findAgentTool("finding_status")!.run({ filter: "critical" }) as string;
    // 조건은 영문으로 받아도 **답은 우리말로** 한다.
    expect(critical).toContain("매우 심각");
    expect(critical, "영문 심각도가 그대로 나간다").not.toMatch(/\[(critical|high|medium|low)\]/);
    expect(critical).not.toContain("미서명");

    // 2026-08-01: "없습니다"→"못 찾았습니다"(전체 건수 포함)로 바꿨다 — 조건 불일치를
    // "없다"로 말하면 담당자가 할 일이 없다고 믿는다(실사고: 활성 46건을 "없습니다"로 답함).
    const none = findAgentTool("finding_status")!.run({ filter: "존재하지않는조건xyz" }) as string;
    expect(none).toContain("못 찾았습니다");
    expect(none).toMatch(/전체 \d+건 중/);

    // ★ 우리말 상태어로 물어도 걸려야 한다. 예전엔 저장값(pending)에 글자 그대로 대조해
    //   "미조치"가 언제나 0건이었다 — 이 줄이 그 사고의 회귀 차단선이다.
    const 미조치 = findAgentTool("finding_status")!.run({ filter: "미조치" }) as string;
    expect(미조치).not.toContain("못 찾았습니다");
  });

  it("review_finding — 반려(오탐) 처리가 실제로 저장된다", () => {
    const out = findAgentTool("review_finding")!.run({
      assetId: "test-llm",
      finding: "critical pickle",
      decision: "반려",
    }) as string;
    expect(out).toContain("반려");

    // prioritizedReviews는 설계상 오탐을 제외하므로("오늘의 조치" 대상이 아니다)
    // 저장 확인은 전체 목록으로 한다.
    const saved = listFindingReviews().find((r) => r.assetId === "test-llm" && r.finding.finding_type.includes("pickle"));
    expect(saved?.status).toBe("rejected");

    // 반려했으니 우선순위 목록에서는 빠져야 한다 — 이게 반려의 실질적 효과다.
    const inPriority = prioritizedReviews(50).some((r) => r.assetId === "test-llm" && r.finding.finding_type.includes("pickle"));
    expect(inPriority).toBe(false);
  });

  it("review_finding — 없는 자산·취약점은 지어내지 않고 못 찾았다고 답한다", () => {
    const noAsset = findAgentTool("review_finding")!.run({ assetId: "없는자산", finding: "x", decision: "승인" }) as string;
    expect(noAsset).toContain("찾을 수 없습니다");

    const noFinding = findAgentTool("review_finding")!.run({ assetId: "test-llm", finding: "존재하지않는취약점xyz", decision: "승인" }) as string;
    expect(noFinding).toContain("검색되지 않았습니다");
  });

  it("쓰기 도구는 결재판 대상으로 표시된다", () => {
    expect(findAgentTool("review_finding")!.write).toBe(true);
    expect(findAgentTool("finding_status")!.write).toBe(false);
  });
});
