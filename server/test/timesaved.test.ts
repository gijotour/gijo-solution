// "AI가 아낀 시간" KPI (계획서 중-2) — 원장·환산·정직 규칙.
// [전중후 계획서 정렬] 중-2의 약속은 "자동화 처리량을 시간으로 환산해 임원 보고에 자동 포함"이다.
// 이 시험이 지키는 것은 숫자의 크기가 아니라 **숫자의 정직성**(전-6 정직 경계):
//   지어내지 않는다 · 가정을 숨기지 않는다 · 시험·사람 판단을 절감으로 세지 않는다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { recordWork, countWorkByKind, resetWorkForTests, workLedgerStart, TOOL_WORK_KIND } from "../src/engine/worklog";
import { timeSavedReport, timeSavedText, setBaseline, DEFAULT_BASELINES, RISK_ADJUSTMENT } from "../src/engine/timesaved";

beforeEach(() => {
  resetWorkForTests();
  db.prepare("DELETE FROM app_state WHERE key = 'timeSaved:minutes'").run();
});

describe("작업 원장", () => {
  it("자동화가 한 일을 종류별로 센다", () => {
    recordWork({ kind: "report_generated", detail: "weekly" });
    recordWork({ kind: "status_compiled" });
    recordWork({ kind: "status_compiled" });
    const c = countWorkByKind(Date.now() - 1000);
    expect(c.report_generated).toBe(1);
    expect(c.status_compiled).toBe(2);
  });

  it("평가 게이트·QA 실행은 담지 않는다 — 시험이 절감 숫자를 만들면 안 된다", () => {
    recordWork({ kind: "status_compiled", qa: true });
    recordWork({ kind: "question_answered", qa: true });
    expect(countWorkByKind(Date.now() - 1000)).toEqual({});
    expect(workLedgerStart()).toBeNull();
  });

  it("쓰기 도구는 매핑에 없다 — 사람이 결재한 변경을 AI 공으로 돌리지 않는다", () => {
    for (const t of ["register_asset", "update_finding_status", "assign_owner", "bulk_update", "review_finding"]) {
      expect(TOOL_WORK_KIND[t]).toBeUndefined();
    }
    // 반대로 읽기·판단 도구는 매핑돼 있다
    expect(TOOL_WORK_KIND.today).toBe("finding_triaged");
    expect(TOOL_WORK_KIND.run_hardening_scan).toBe("hardening_scanned");
  });
});

describe("시간 환산", () => {
  it("건수 × 기준시간으로 환산하고, 보수 조정한 하한을 함께 낸다", () => {
    for (let i = 0; i < 4; i++) recordWork({ kind: "report_generated" }); // 4 × 120분 = 8시간
    const r = timeSavedReport(30);
    expect(r.totalMinutes).toBe(4 * DEFAULT_BASELINES.report_generated.minutes);
    expect(r.totalHours).toBe(8);
    expect(r.riskAdjustment).toBe(RISK_ADJUSTMENT);
    expect(r.adjustedHours).toBe(6.4); // 8시간 − 20%
    expect(r.adjustedHours).toBeLessThan(r.totalHours); // 보고값은 항상 산정값 이하
  });

  it("모든 줄에 출처가 붙는다 — 근거 없는 숫자를 낼 수 없다", () => {
    recordWork({ kind: "finding_triaged" });
    const r = timeSavedReport(30);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].source.length).toBeGreaterThan(10);
    // 가정을 숨기지 않는다 — 무엇에 몇 분을 곱했는지가 그대로 나온다
    expect(r.assumptions[0]).toContain("15분");
    expect(r.note).toContain("추정");
  });

  it("조직이 기준시간을 바꾸면 그 값으로 계산되고 '우리 조직 설정'으로 표시된다", () => {
    recordWork({ kind: "report_generated" });
    setBaseline("report_generated", 60, "시험자");
    const r = timeSavedReport(30);
    expect(r.rows[0].minutesEach).toBe(60);
    expect(r.rows[0].custom).toBe(true);
    expect(r.rows[0].source).toBe("우리 조직 설정값");
  });

  it("기준시간 0분이면 그 작업은 절감에서 빠진다 — 동의하지 않는 항목을 끌 수 있다", () => {
    recordWork({ kind: "status_compiled" });
    setBaseline("status_compiled", 0);
    const r = timeSavedReport(30);
    expect(r.totalMinutes).toBe(0);
  });

  it("터무니없는 기준시간은 거부한다", () => {
    expect(() => setBaseline("report_generated", -1)).toThrow();
    expect(() => setBaseline("report_generated", 9999)).toThrow();
  });

  it("한 일이 없으면 0을 자랑하지 않고 '기록이 없다'고 말한다", () => {
    const r = timeSavedReport(30);
    expect(r.rows).toEqual([]);
    expect(timeSavedText(30)).toContain("기록이 없습니다");
  });

  it("원장이 기간 전체를 덮지 못하면 그 사실을 밝힌다 — 짧은 기록으로 긴 기간을 주장하지 않는다", () => {
    recordWork({ kind: "report_generated" });
    const r = timeSavedReport(365);
    expect(r.coversWholePeriod).toBe(false);
    expect(r.note).toContain("부터 쌓였습니다");
  });

  it("요약문은 숫자만 내보내지 않는다 — 내역과 한계를 함께 낸다", () => {
    recordWork({ kind: "hardening_scanned" });
    const t = timeSavedText(30);
    expect(t).toContain("보안설정 점검");
    expect(t).toContain("건 × ");
    expect(t).toContain("추정");
    expect(t).toContain("안전해졌다는 뜻이 아닙니다"); // 활동지표를 위험감소로 읽지 않게
  });
});
