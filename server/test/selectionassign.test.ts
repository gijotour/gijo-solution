// 고르기 → 배정·판정 연계 — ⌗기계 키 배관 (2026-08-19 QA ③⑤ 실사고 수리)
//
// 실사고: 「고른 항목」이 이름·IP 문자열만 넘겨 LLM이 자산 id를 추정 → 같은 IP를 가진
// **다른 자산**(vuln:10.0.0.100)으로 배정이 갔고, 표시명("< 2.15.0 RCE")과 등록부 원문
// ("2.15.0 Remote Code Execution")이 달라 실행이 400으로 죽었다. 덤으로 말한 적 없는
// 기한(과거 날짜)까지 채워졌다. 이 시험은 그 배관 전체를 키 기반으로 못박는다.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { registerAsset, recordFindings, resetAssetsForTests, getAsset } from "../src/engine/assets";
import { findingKey, listFindingReviews } from "../src/engine/approvals";
import { findAgentTool } from "../src/engine/agenttools";
import { resolveFinding } from "../src/engine/agenttools/handlers";

function 시드() {
  // 같은 IP가 두 자산에 있는 실사고 지형 그대로 — 키가 없으면 추정이 엉뚱한 쪽을 잡는다.
  registerAsset({ id: "sample-web01", name: "샘플-웹서버 (10.0.0.100)", path: "-", assetType: "서버" });
  recordFindings("sample-web01", [
    { finding_type: "Apache Log4j < 2.15.0 RCE (CVE-2021-44228)", severity: "critical", evidence: "log4j-core-2.11.0.jar", source_tool: "샘플" },
  ]);
  registerAsset({ id: "vuln:10.0.0.100", name: "10.0.0.100", path: "-", assetType: "서버" });
  recordFindings("vuln:10.0.0.100", [
    { finding_type: "Apache Log4j 2.15.0 Remote Code Execution (CVE-2021-44228)", severity: "critical", evidence: "웹리포트", source_tool: "webreport" },
  ]);
  const a = getAsset("sample-web01")!;
  return findingKey("sample-web01", a.findings[0]);
}

describe("⌗기계 키 — autoFill 강제 정정", () => {
  beforeEach(() => resetAssetsForTests());

  it("★ 지시문의 ⌗키가 LLM이 추정한 엉뚱한 자산·표시명을 덮는다(실사고 재현)", () => {
    const 키 = 시드();
    const tool = findAgentTool("assign_finding")!;
    // LLM이 채운 값 = 실사고 그대로(엉뚱한 자산 + 표시명 + 지어낸 과거 기한)
    const filled = tool.autoFill!(
      { assetId: "vuln:10.0.0.100", finding: "Apache Log4j < 2.15.0 RCE (CVE-2021-44228)", assignee: "김도희", dueDate: "2026-07-24" },
      `자산 샘플-웹서버 (10.0.0.100)의 취약점 Apache Log4j < 2.15.0 RCE ⌗sample-web01::${키} 담당자 배정해줘`
    );
    expect(filled.assetId).toBe("sample-web01");
    expect(filled.finding).toBe("key:" + 키);
    expect(filled.dueDate, "말한 적 없는 기한은 비운다(⑤)").toBe("");
  });

  it("사용자가 실제로 말한 기한은 지운지 않는다", () => {
    시드();
    const tool = findAgentTool("assign_finding")!;
    const filled = tool.autoFill!(
      { assetId: "sample-web01", finding: "Log4j", assignee: "김", dueDate: "2026-09-01" },
      "Log4j 취약점 2026-09-01까지 담당자 배정해줘"
    );
    expect(filled.dueDate).toBeUndefined(); // 정정할 것 없음 — 말한 날짜 그대로
  });

  it("판정 도구(update_finding_status)도 같은 키 강제를 받는다", () => {
    const 키 = 시드();
    const tool = findAgentTool("update_finding_status")!;
    const filled = tool.autoFill!(
      { assetId: "vuln:10.0.0.100", finding: "표시명", status: "" },
      `이 취약점 오탐 처리해줘 ⌗sample-web01::${키}`
    );
    expect(filled.assetId).toBe("sample-web01");
    expect(filled.finding).toBe("key:" + 키);
    expect(filled.status).toBe("오탐");
  });

  it("키 표식이 없으면 옛 동작 그대로 — 추정 정정만(무해)", () => {
    시드();
    const tool = findAgentTool("assign_finding")!;
    const filled = tool.autoFill!(
      { assetId: "샘플-웹서버 (10.0.0.100)", finding: "Log4j", assignee: "김" },
      "샘플-웹서버 Log4j 담당자 배정해줘"
    );
    expect(filled.assetId).toBe("sample-web01"); // resolveAsset 이름→id 정정(기존 동작)
    expect(filled.finding).toBeUndefined();
  });
});

describe("resolveFinding — 키 직행", () => {
  beforeEach(() => resetAssetsForTests());

  it("key: 접두어·맨 16자리 키 둘 다 글자 대조 없이 그 건을 잡는다", () => {
    const 키 = 시드();
    for (const needle of ["key:" + 키, 키]) {
      const r = resolveFinding("sample-web01", needle);
      expect(r.ok, needle).toBe(true);
      if (r.ok) expect(r.hit.key).toBe(키);
    }
  });

  it("없는 키는 실패로 — 새로고침·다시 고르기 안내(조용히 딴 건을 잡지 않는다)", () => {
    시드();
    const r = resolveFinding("sample-web01", "key:0123456789abcdef");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("다시 골라");
  });

  it("★ 실행까지 — 키로 배정하면 검토대장에 정확히 그 건이 박힌다", () => {
    const 키 = 시드();
    const tool = findAgentTool("assign_finding")!;
    const out = tool.run({ assetId: "sample-web01", finding: "key:" + 키, assignee: "김도희" }) as string;
    expect(out).toContain("김도희");
    const row = listFindingReviews().find((r) => r.assetId === "sample-web01" && r.findingKey === 키);
    expect(row?.assignee).toBe("김도희");
  });
});

describe("배선 감시 — 생산(화면)→릴레이(셸)→전송(콘솔)→서버가 끊기면 잡는다", () => {
  const pages = join(__dirname, "..", "..", "client", "src", "renderer", "pages");
  it("vulnscan이 fields에 assetId·findingKey를 동봉한다", () => {
    const s = readFileSync(join(pages, "vulnscan.html"), "utf8");
    expect(s).toContain("data-fkey");
    expect(s).toMatch(/assetId:\s*asset\.id/);
    expect(s).toMatch(/findingKey:\s*item\.dataset\.fkey/);
  });
  it("셸 허용키에 assetId·findingKey가 있다(릴레이에서 조용히 사라지는 함정)", () => {
    const s = readFileSync(join(pages, "app.html"), "utf8");
    const 줄 = s.split("\n").find((l) => l.includes("허용키 = ["));
    expect(줄).toContain("assetId");
    expect(줄).toContain("findingKey");
  });
  it("콘솔 전송부가 ⌗키를 조립한다", () => {
    const s = readFileSync(join(pages, "console.js"), "utf8");
    expect(s).toContain('" ⌗" + sel.fields.assetId + "::" + sel.fields.findingKey');
  });
  it("자산 상세 API가 fkey를 동봉한다(키의 생산자)", () => {
    const s = readFileSync(join(__dirname, "..", "src", "engine", "assets.ts"), "utf8");
    expect(s).toMatch(/fkey:\s*findingKey\(asset\.id,\s*f\)/);
  });
});
