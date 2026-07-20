// 정기 리포트(주간/분기) 자동 생성 스케줄 — 다음 실행 계산·CRUD·자동/수동 실행·챗봇 조회 도구를 검증한다.
// report.ts를 그대로 재사용하므로 REPORT_DIR을 report.test.ts와 동일하게 임시 디렉터리로 격리한다
// (운영 data/reports를 절대 건드리지 않기 위함 — 과거 테스트가 실 데이터 폴더를 오염시킨 사고가 있었다).
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpReportDir = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-reportsched-"));
process.env.GIJO_REPORT_DIR = tmpReportDir;

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock] 경영진 요약"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

const { db } = await import("../src/db");
const { createApp } = await import("../src/app");
const { resetAssetsForTests } = await import("../src/engine/assets");
const {
  computeNextRun,
  createSchedule,
  listSchedules,
  getSchedule,
  updateSchedule,
  setScheduleEnabled,
  deleteSchedule,
  runScheduleNow,
  runDueSchedules,
  listScheduleRuns,
  scheduleSummaryText,
  resetReportSchedulesForTests,
} = await import("../src/engine/reportschedule");
const { findAgentTool } = await import("../src/engine/agenttools");

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
  return res.body.accessToken as string;
}

describe("reportschedule — computeNextRun(다음 실행 계산)", () => {
  it("weekly: 지정 요일·시각이 아직 안 지났으면 이번 주", () => {
    const from = new Date(2026, 6, 20, 8, 0); // 2026-07-20(월) 08:00
    const next = computeNextRun("weekly", 1, 9, 0, from); // 매주 월 09:00
    const d = new Date(next);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(20); // 오늘(월) 09:00 — 아직 안 지남
    expect(d.getHours()).toBe(9);
  });

  it("weekly: 지정 시각이 이미 지났으면 다음 주로 넘어간다", () => {
    const from = new Date(2026, 6, 20, 10, 0); // 월 10:00 — 09:00은 이미 지남
    const next = computeNextRun("weekly", 1, 9, 0, from);
    const d = new Date(next);
    expect(d.getDate()).toBe(27); // 다음 주 월요일
  });

  it("quarterly: 분기 시작월 1일이 주말이면 다음 월요일로 밀린다", () => {
    // 2026-10-01은 목요일 → 밀리지 않아야 함
    const from = new Date(2026, 8, 1, 0, 0); // 9/1
    const next = computeNextRun("quarterly", null, 9, 0, from);
    const d = new Date(next);
    expect(d.getMonth()).toBe(9); // 10월(0-indexed 9)
    expect(d.getDate()).toBe(1);
    expect(d.getDay()).not.toBe(0);
    expect(d.getDay()).not.toBe(6);
  });

  it("quarterly: 해를 넘기면 다음 해 1월로 계산된다", () => {
    const from = new Date(2026, 11, 15, 0, 0); // 12/15 — 올해 분기 시작월(1/4/7/10) 모두 지남
    const next = computeNextRun("quarterly", null, 9, 0, from);
    const d = new Date(next);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});

describe("reportschedule — CRUD", () => {
  beforeEach(() => {
    resetReportSchedulesForTests();
  });

  it("생성 → 목록·조회 → 수정 → 토글 → 삭제", () => {
    const sch = createSchedule({ type: "weekly", format: "both", audience: "official", dayOfWeek: 1, hour: 9, minute: 0 });
    expect(sch.enabled).toBe(true);
    expect(listSchedules().map((s) => s.id)).toContain(sch.id);

    const updated = updateSchedule(sch.id, { hour: 18, minute: 30 });
    expect(updated?.hour).toBe(18);
    expect(updated?.minute).toBe(30);

    setScheduleEnabled(sch.id, false);
    expect(getSchedule(sch.id)?.enabled).toBe(false);

    deleteSchedule(sch.id);
    expect(getSchedule(sch.id)).toBeUndefined();
  });

  it("assetIds를 지정하면 전체 자산이 아니라 해당 자산만 스코프로 저장된다", () => {
    resetAssetsForTests();
    const sch = createSchedule({ type: "quarterly", format: "docx", audience: "internal", hour: 9, minute: 0, assetIds: ["asset-x"] });
    expect(sch.assetIds).toEqual(["asset-x"]);
    expect(sch.dayOfWeek).toBeNull(); // quarterly는 dayOfWeek 미사용
  });
});

describe("reportschedule — 실행(수동/자동)", () => {
  beforeEach(() => {
    resetReportSchedulesForTests();
  });

  it("runScheduleNow(manual)은 실제 리포트를 생성하고 이력을 남기되 다음 실행 시각은 그대로 둔다", async () => {
    const sch = createSchedule({ type: "weekly", format: "docx", audience: "official", dayOfWeek: 1, hour: 9, minute: 0 });
    const before = sch.nextRunAt;

    const after = await runScheduleNow(sch.id, "manual");
    expect(after?.lastResult).toBe("success");
    expect(after?.lastReportBase).toMatch(/^weekly-\d+$/);
    expect(after?.nextRunAt).toBe(before); // manual은 다음 정기 실행을 건드리지 않음

    const runs = listScheduleRuns(sch.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].result).toBe("success");
    expect(runs[0].source).toBe("manual");
  });

  it("실패하면 lastResult=fail·lastError가 남고, scheduled면 다음 실행 시각도 다음 주기로 넘어간다", async () => {
    const sch = createSchedule({ type: "weekly", format: "docx", audience: "official", dayOfWeek: 1, hour: 9, minute: 0 });
    // "만기됨"을 재현 — nextRunAt을 과거로 당긴 뒤 실패를 주입한다(실사용에서 scheduled는 항상 만기된 것만 실행됨).
    const before = Date.now() - 1000;
    db.prepare("UPDATE report_schedules SET nextRunAt = ? WHERE id = ?").run(before, sch.id);
    const failing = vi.fn(async () => { throw new Error("LLM 응답 지연"); });

    const after = await runScheduleNow(sch.id, "scheduled", failing);
    expect(after?.lastResult).toBe("fail");
    expect(after?.lastError).toContain("LLM 응답 지연");
    expect(after?.nextRunAt).toBeGreaterThan(before); // 실패해도 다음 주기로는 넘어가야 함(하드루프 방지)

    const runs = listScheduleRuns(sch.id);
    expect(runs[0].result).toBe("fail");
  });

  it("runDueSchedules는 만기된 스케줄만 골라 실행하고 만기 전 스케줄은 건드리지 않는다", async () => {
    const due = createSchedule({ type: "weekly", format: "docx", audience: "official", dayOfWeek: 1, hour: 9, minute: 0 });
    const notDue = createSchedule({ type: "weekly", format: "docx", audience: "official", dayOfWeek: 1, hour: 9, minute: 0 });
    // computeNextRun은 항상 미래를 반환하므로, "만기됨"을 결정적으로 재현하려면 DB의 nextRunAt을 직접 과거로 당긴다.
    const past = Date.now() - 1000;
    db.prepare("UPDATE report_schedules SET nextRunAt = ? WHERE id = ?").run(past, due.id);

    const ran = await runDueSchedules(Date.now(), vi.fn(async () => ({ filePath: path.join(tmpReportDir, "weekly-x.docx"), executiveSummary: "s", audience: "official" as const })));
    expect(ran).toBe(1);
    expect(getSchedule(due.id)?.lastRunAt).not.toBeNull();
    expect(getSchedule(notDue.id)?.lastRunAt).toBeNull(); // 만기 전이라 실행 안 됨
  });
});

describe("reportschedule — 챗봇 조회(scheduleSummaryText / report_schedule_list 도구)", () => {
  beforeEach(() => {
    resetReportSchedulesForTests();
  });

  it("스케줄이 없으면 안내 문구를 준다", () => {
    expect(scheduleSummaryText([])).toContain("없습니다");
  });

  it("등록된 스케줄의 주기·다음 실행·상태를 요약 텍스트에 담는다", () => {
    createSchedule({ type: "weekly", format: "both", audience: "official", dayOfWeek: 1, hour: 9, minute: 0 });
    const text = scheduleSummaryText();
    expect(text).toContain("주간");
    expect(text).toContain("전체 자산");
    expect(text).toContain("켜짐");
  });

  it("report_schedule_list 도구가 레지스트리에 등록돼 있고 실행하면 스케줄 텍스트를 돌려준다", async () => {
    createSchedule({ type: "quarterly", format: "docx", audience: "internal", hour: 9, minute: 0 });
    const tool = findAgentTool("report_schedule_list");
    expect(tool).toBeTruthy();
    expect(tool!.write).toBe(false);
    const out = await tool!.run({});
    expect(out).toContain("분기");
  });
});

describe("reportschedule — REST API", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    resetReportSchedulesForTests();
    resetAssetsForTests();
    app = createApp();
    token = await login(app);
  });

  it("등록 → 목록 → 수정(enabled 토글) → 지금 실행 → 삭제까지 실 HTTP로 동작한다", async () => {
    const created = await request(app)
      .post("/api/report/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "weekly", format: "docx", audience: "official", dayOfWeek: 3, hour: 9, minute: 0 });
    expect(created.status).toBe(200);
    const id = created.body.schedule.id;

    const list = await request(app).get("/api/report/schedules").set("Authorization", `Bearer ${token}`);
    expect(list.body.schedules.map((s: { id: string }) => s.id)).toContain(id);

    const toggled = await request(app)
      .patch(`/api/report/schedules/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(toggled.body.schedule.enabled).toBe(false);

    const ran = await request(app).post(`/api/report/schedules/${id}/run`).set("Authorization", `Bearer ${token}`);
    expect(ran.status).toBe(200);
    expect(ran.body.schedule.lastResult).toBe("success");

    const runs = await request(app).get(`/api/report/schedules/runs?scheduleId=${id}`).set("Authorization", `Bearer ${token}`);
    expect(runs.body.runs).toHaveLength(1);

    const del = await request(app).delete(`/api/report/schedules/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.body.ok).toBe(true);
    const after = await request(app).get("/api/report/schedules").set("Authorization", `Bearer ${token}`);
    expect(after.body.schedules.map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it("weekly인데 dayOfWeek가 없으면 400", async () => {
    const res = await request(app)
      .post("/api/report/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "weekly", format: "docx", audience: "official", hour: 9, minute: 0 });
    expect(res.status).toBe(400);
  });

  it("존재하지 않는 자산 id를 assetIds로 주면 400", async () => {
    const res = await request(app)
      .post("/api/report/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "quarterly", format: "docx", audience: "official", hour: 9, minute: 0, assetIds: ["no-such-asset"] });
    expect(res.status).toBe(400);
  });
});
