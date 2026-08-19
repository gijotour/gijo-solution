// 기능 가이드 ①②④⑤ (2026-08-19 사장님 「추가 기능 가이드 진행」) — 시나리오 대장의 끊김 닫기.
// 위험: ①「조치 시작」이 완료로 굳는 것 ②범위 분기가 남의 영토(하드닝 표준)를 삼키는 것
// ③시나리오 칩이 안 받아주는 문장을 파는 것 ⑤스케줄이 지어낸 시각으로 걸리는 것.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "{}"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { normalizeStatus, runUpdateFindingStatus } from "../src/engine/agenttools/handlers";
import { findAgentTool } from "../src/engine/agenttools";
import { registerAsset, recordFindings, resetAssetsForTests, getAsset } from "../src/engine/assets";
import { findingKey, listFindingReviews } from "../src/engine/approvals";
import { runWithViewer } from "../src/engine/viewerctx";
import { db } from "../src/db";
import { isScopeCommand, scopeCommandAnswer } from "../src/engine/scopecmd";
import { isScenarioAsk, scenarioAnswer, SCENARIOS } from "../src/engine/scenarios";
import { listSchedules, deleteSchedule } from "../src/engine/reportschedule";

describe("① 조치 상태 전이 — 시작·검증요청이 대화로", () => {
  beforeEach(() => resetAssetsForTests());

  it("★ 「조치 시작」이 완료로 굳지 않는다 — 순서가 전부다", () => {
    expect(normalizeStatus("조치 시작")).toBe("in_progress");
    expect(normalizeStatus("이거 착수할게")).toBe("in_progress");
    expect(normalizeStatus("검증 요청")).toBe("verifying");
    expect(normalizeStatus("재스캔 요청해줘")).toBe("verifying");
    // 기존 어휘 회귀 없음
    expect(normalizeStatus("조치완료")).toBe("approved");
    expect(normalizeStatus("패치 다 했어")).toBe("approved");
    expect(normalizeStatus("오탐이야")).toBe("rejected");
  });

  it("진행중·검증대기가 검토대장에 실제로 박힌다", () => {
    registerAsset({ id: "fg-a1", name: "전이-자산", path: "-", assetType: "서버" });
    recordFindings("fg-a1", [{ finding_type: "약한 암호화", severity: "high", evidence: "e", source_tool: "s" }]);
    const f = getAsset("fg-a1")!.findings[0];
    const key = findingKey("fg-a1", f);
    const 대장 = () => listFindingReviews().find((r) => r.assetId === "fg-a1" && r.findingKey === key);
    const out1 = runUpdateFindingStatus({ assetId: "fg-a1", finding: "key:" + key, status: "조치 시작" });
    expect(out1).toContain("진행중");
    expect(대장()?.status).toBe("in_progress");
    const out2 = runUpdateFindingStatus({ assetId: "fg-a1", finding: "key:" + key, status: "검증 요청" });
    expect(out2).toContain("검증 대기");
    expect(대장()?.status).toBe("verifying");
  });

  it("verify_finding — 로그인 없음·대상 없음 둘 다 정직하게 거절한다(「검증했는데 이상 없음」 금지)", async () => {
    registerAsset({ id: "fg-a2", name: "대상없는-자산", path: "-", assetType: "서버" });
    recordFindings("fg-a2", [{ finding_type: "약한 암호화", severity: "high", evidence: "e", source_tool: "s" }]);
    const tool = findAgentTool("verify_finding")!;
    expect(tool.write).toBe(false); // 읽기 도구(자동 완료 금지 원칙)
    // 사람 없음 — 보안 경계가 먼저 선다
    expect(String(await tool.run({ assetId: "fg-a2" }))).toContain("로그인");
    // 사람 있음 + 점검 대상 미등록 — 실행 자체를 거절(가짜 「이상 없음」 금지)
    const jyh = db.prepare("SELECT id FROM users WHERE username = 'jyh'").get() as { id: string } | undefined;
    const out = await runWithViewer({ userId: jyh?.id ?? null }, () => tool.run({ assetId: "fg-a2" }));
    expect(String(out)).toContain("점검 대상");
    expect(String(out)).toContain("등록");
  });
});

describe("② 범위 걸기 — 대화로", () => {
  beforeEach(() => resetAssetsForTests());

  it("트리거 — 걸기·풀기만 받고 남의 영토는 지나간다", () => {
    expect(isScopeCommand("web-01로 범위 걸어줘")).toBe(true);
    expect(isScopeCommand("이거 기준으로 잡아줘")).toBe(true);
    expect(isScopeCommand("범위 풀어줘")).toBe(true);
    expect(isScopeCommand("KISA 기준으로 설정해줘"), "하드닝 표준 변경 의도").toBe(false);
    expect(isScopeCommand("점검 기준 알려줘")).toBe(false);
    expect(isScopeCommand("미조치 취약점 뭐 있어?")).toBe(false);
  });

  it("자산 이름으로 걸고, ⌗선택이 있으면 그 자산이 우선이다", () => {
    registerAsset({ id: "fg-web01", name: "web-01", path: "-", assetType: "서버" });
    registerAsset({ id: "fg-db01", name: "db-01", path: "-", assetType: "서버" });
    const r1 = scopeCommandAnswer("web-01로 범위 걸어줘");
    expect(r1.scopeSet).toMatchObject({ kind: "asset", id: "fg-web01" });
    const r2 = scopeCommandAnswer("이거로 범위 걸어줘", "자산 db-01 ⌗fg-db01::0123456789abcdef");
    expect(r2.scopeSet).toMatchObject({ kind: "asset", id: "fg-db01" });
  });

  it("못 찾으면 신호 없이 되묻고, 풀기는 clear 신호다", () => {
    registerAsset({ id: "fg-web03", name: "web-03", path: "-", assetType: "서버" }); // 등록부가 비면 「등록 전」 안내가 맞다
    const r = scopeCommandAnswer("없는자산으로 범위 걸어줘");
    expect(r.scopeSet).toBeUndefined();
    expect(r.output).toContain("찾지 못했습니다");
    expect(scopeCommandAnswer("범위 풀어줘").scopeSet).toEqual({ kind: "clear" });
  });

  it("dispatcher 경유 — scopeSet이 응답에 실린다", async () => {
    registerAsset({ id: "fg-web02", name: "web-02", path: "-", assetType: "서버" });
    const { dispatchInstruction } = await import("../src/engine/dispatcher");
    const r = await dispatchInstruction("web-02로 범위 걸어줘", undefined, undefined, undefined, true);
    expect(r.scopeSet).toMatchObject({ kind: "asset", id: "fg-web02" });
  });
});

describe("④ 시나리오 실행(프롬프트북)", () => {
  it("트리거 — 시나리오 낱말이 있어야만 받는다", () => {
    expect(isScenarioAsk("시나리오 목록 보여줘")).toBe(true);
    expect(isScenarioAsk("시나리오: 아침 브리핑")).toBe(true);
    expect(isScenarioAsk("아침에 뭐부터 할까"), "시나리오 낱말 없음").toBe(false);
  });

  it("목록 → 이름 → 단계 칩으로 이어진다", () => {
    const 목록 = scenarioAnswer("시나리오 목록");
    expect(목록.output).toContain("아침 브리핑");
    expect(목록.nextChips!.length).toBeGreaterThan(0);
    const 단계 = scenarioAnswer("시나리오: 아침 브리핑");
    expect(단계.output).toContain("오늘 브리핑");
    expect(단계.nextChips).toEqual(["오늘 브리핑", "지금 손댈 일 뭐야?", "오늘 할 일"]);
  });

  it("★ 모든 단계 문장에 「안됨」류 표기·빈 값이 없다(칩은 실측 검증 문장만)", () => {
    for (const s of SCENARIOS) {
      expect(s.steps.length, s.name).toBeGreaterThanOrEqual(3);
      for (const step of s.steps) {
        expect(step.trim().length, s.name).toBeGreaterThan(3);
        expect(step, s.name).not.toMatch(/안됨|안 됨|도구 없음/);
      }
    }
  });
});

describe("⑤ 정기 리포트 스케줄 — 대화로", () => {
  it("autoFill이 「매주 금요일 오후 5시」를 주간·금·17로 정정한다", () => {
    const tool = findAgentTool("report_schedule_add")!;
    const filled = tool.autoFill!({ type: "", hour: "5" }, "주간 리포트 매주 금요일 오후 5시로 걸어줘");
    expect(filled.type).toBe("주간");
    expect(filled.dayOfWeek).toBe("금");
    expect(filled.hour).toBe("17");
  });

  it("실행하면 스케줄이 실제로 생기고, 엉뚱한 주기·시각은 정직하게 거절한다", async () => {
    const tool = findAgentTool("report_schedule_add")!;
    const out = String(await tool.run({ type: "주간", dayOfWeek: "금", hour: "17" }));
    expect(out).toContain("주간");
    const made = listSchedules().find((s) => s.type === "weekly" && s.hour === 17 && s.dayOfWeek === 5);
    expect(made, "스케줄이 등록부에 실제로 있어야 한다").toBeTruthy();
    if (made) deleteSchedule(made.id); // 시험 정리
    expect(String(await tool.run({ type: "가끔", hour: "17" }))).toContain("해석하지 못했습니다");
    expect(String(await tool.run({ type: "주간", hour: "25" }))).toContain("0~23");
  });
});

describe("배선 감시", () => {
  it("콘솔이 scopeSet 신호를 소비한다(서버 신호→클라 실행)", () => {
    const s = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js"), "utf8");
    const i = s.indexOf("r.scopeSet");
    expect(i).toBeGreaterThan(0);
    expect(i, "응답 처리 블록 안(IIFE 밖 죽은 줄 금지 — nextChips 실사고)").toBeLessThan(s.indexOf("attachApproval(replyEl"));
    expect(s).toContain('r.scopeSet.kind === "clear"');
  });
});
