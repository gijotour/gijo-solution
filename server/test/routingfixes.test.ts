// 시연 실측(2026-07-29)이 잡은 라우팅 결함 3건 고정 — 계획서 전-1 검증.
// [전중후 계획서 정렬] 시연 대본의 "피해야 할 표현" 표를 비우는 것이 이 시험의 목적이다.
//   ① "리포트 작성해줘" → 스케줄 조회로 새던 것 → 실제 생성(파일)으로
//   ② "반려 사유 주로 뭐였어?" → 일반론으로 새던 것 → 사내 이력 실데이터로
//   ③ "점검은 어떻게 해?" → 실제 점검이 실행되던 것 → 방법 질문은 실행 금지
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));
// 실제 DOCX 생성은 무겁고 파일을 남긴다 — 경로 검증엔 모의로 충분.
vi.mock("../src/engine/report", () => ({
  generateReport: vi.fn(async () => ({ executiveSummary: "모의 요약", filePath: "reports/모의-리포트.docx" })),
  registerReportRoutes: vi.fn(),
}));
// 하드닝 점검이 "실행되면 안 되는" 케이스를 재기 위해 실행 자체를 기록한다.
const scanRuns: string[] = [];
vi.mock("../src/engine/hardeningscan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/engine/hardeningscan")>()),
  runHardeningScan: vi.fn(async (opts: { standard: string }) => {
    scanRuns.push(opts.standard);
    return { standard: opts.standard, results: [] };
  }),
  scanSummaryText: vi.fn(() => "점검 완료(모의)"),
}));

import { dispatchInstruction, formatRejectHistory, REPORT_CREATE_RE, REPORT_QUERY_EXCLUDE_RE } from "../src/engine/dispatcher";
import { isHowtoNotCommand } from "../src/engine/agentloop";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";
import { updateFindingReview, findingKey } from "../src/engine/approvals";
import { db } from "../src/db";

beforeEach(() => {
  resetAssetsForTests();
  db.prepare("DELETE FROM finding_approvals").run(); // 반려 이력 시험 간 격리
  db.prepare("DELETE FROM maintenance_events").run();
  db.prepare("DELETE FROM maintenance_items").run(); // 데모 시드 점검이 남아 '이력 없음' 검증을 깨뜨린다
  db.prepare("DELETE FROM work_session_turns").run();
  db.prepare("DELETE FROM work_sessions").run();
  scanRuns.length = 0;
});

describe("① 보고서 생성 라우팅", () => {
  it("'주간 보안 리포트 작성해줘'는 스케줄 조회가 아니라 실제 생성으로 간다", async () => {
    const r = await dispatchInstruction("주간 보안 리포트 작성해줘");
    expect(r.output).toContain("리포트 파일 생성됨");
    expect(r.output).toContain("모의-리포트.docx");
    expect(r.output).not.toContain("스케줄");
  });

  it("대상이 없는 짧은 지시는 기존 되물음을 유지한다", async () => {
    const r = await dispatchInstruction("보고서 만들어줘");
    expect(r.output).toContain("어떤 보고서를 만들까요");
  });

  it("조회 낱말(스케줄·언제)이 섞이면 생성 분기를 타지 않는다", () => {
    expect(REPORT_CREATE_RE.test("리포트 자동 생성 언제야")).toBe(true); // 문구 자체는 걸리지만
    expect(REPORT_QUERY_EXCLUDE_RE.test("리포트 자동 생성 언제야")).toBe(true); // 제외로 걸러진다
  });
});

describe("② 반려 이력 — 사내 실데이터로 답한다", () => {
  it("반려된 취약점의 사유·검토자가 그대로 나온다 (LLM 일반론 아님)", async () => {
    registerAsset({ id: "fw-01", name: "경계 방화벽", path: "p" });
    const f = { finding_type: "SNMP 커뮤니티 기본값", severity: "medium" as const, evidence: "public", source_tool: "nessus" };
    recordFindings("fw-01", [f]);
    updateFindingReview("fw-01", findingKey("fw-01", f), { status: "rejected", rejectReason: "false_positive", note: "모니터링 전용 세그먼트 — 시그니처 오탐" }, "김검토");
    const r = await dispatchInstruction("방화벽 반려 사유는 주로 뭐였어?");
    expect(r.output).toContain("반려 이력 요약");
    expect(r.output).toContain("오탐");
    expect(r.output).toContain("시그니처 오탐");
    expect(r.output).toContain("김검토");
    expect(r.output).not.toBe("[mock]"); // chat으로 새지 않았다
  });

  it("이력이 없으면 없다고 정직하게 답한다", () => {
    expect(formatRejectHistory("반려 사유 알려줘")).toContain("반려 이력이 아직 없습니다");
  });
});

describe("③ 점검 방법 질문 — 실행 금지", () => {
  it("방법 질문과 실행 지시를 가른다", () => {
    expect(isHowtoNotCommand("SonicWall VPN 인증서 점검은 어떻게 해?")).toBe(true);
    expect(isHowtoNotCommand("하드닝 점검 절차가 뭐야?")).toBe(true);
    expect(isHowtoNotCommand("하드닝 점검해줘")).toBe(false);
    expect(isHowtoNotCommand("이 서버 보안 점검 실행해")).toBe(false);
  });

  it("'어떻게 해?' 질문에는 점검이 실행되지 않는다", async () => {
    await dispatchInstruction("보안 설정 점검은 어떻게 해?");
    expect(scanRuns.length).toBe(0); // 실행 기록이 없어야 한다
  });

  it("명령형이면 종전대로 점검이 실행된다", async () => {
    const r = await dispatchInstruction("하드닝 점검해줘");
    expect(scanRuns.length).toBe(1);
    expect(r.output).toContain("점검 완료(모의)");
  });
});
