// 정기 알림 (계획서 후-1 "GA 잔여 P0" — 알림 스케줄).
// [전중후 계획서 정렬] 지키는 것: 보낼 게 없으면 안 보낸다(늑대 소년 방지) ·
// 같은 시각에 두 번 보내지 않는다 · 발송 실패를 조용히 삼키지 않는다.
import { describe, it, expect, beforeEach, vi } from "vitest";

const sent: { to: string[]; subject: string }[] = [];
vi.mock("../src/engine/email", () => ({
  sendMail: vi.fn(async (a: { to: string[]; subject: string }) => { sent.push(a); }),
  registerEmailRoutes: vi.fn(),
}));

import { db } from "../src/db";
import {
  createAlertSchedule, listAlertSchedules, runDueAlerts, buildAlertBody, alertScheduleText, resetAlertsForTests, setAlertEnabled,
} from "../src/engine/alertschedule";

beforeEach(async () => {
  resetAlertsForTests();
  sent.length = 0;
  // tasks.ts는 import 시점에 샘플 조치 작업을 시드한다(seedSampleRemediationTasksIfEmpty).
  // 먼저 모듈을 불러 시드를 끝낸 뒤 비운다 — 순서를 바꾸면 지운 직후 다시 채워진다.
  await import("../src/engine/tasks");
  db.exec("DELETE FROM tasks");
});

// agentId는 비운다 — agentId가 있으면 '에이전트 실행 기록'이라 담당자 할 일 목록에서 빠진다
// (listTasks 기본 동작. KPI·리포트도 같은 규칙을 쓴다). SLA 알림이 재는 것은 사람의 조치 항목이다.
function addDueTask(text: string, dueInDays: number) {
  db.prepare("INSERT INTO tasks (id, priority, text, agentId, done, createdAt, dueAt) VALUES (?,?,?,NULL,0,?,?)")
    .run(`t-${Math.random().toString(36).slice(2)}`, "P1", text, Date.now(), Date.now() + dueInDays * 86400000);
}

describe("정기 알림 등록", () => {
  it("시각과 받는 사람을 검증한다", () => {
    expect(() => createAlertSchedule("sla_due", 25, ["a@b.c"])).toThrow();
    expect(() => createAlertSchedule("sla_due", 9, [])).toThrow();
    expect(() => createAlertSchedule("없는종류" as never, 9, ["a@b.c"])).toThrow();
    const s = createAlertSchedule("sla_due", 9, ["a@b.c", " d@e.f "]);
    expect(s.recipients).toBe("a@b.c,d@e.f");
    expect(listAlertSchedules()).toHaveLength(1);
  });
});

describe("보낼 것이 없으면 보내지 않는다", () => {
  it("기한 임박이 없으면 본문이 만들어지지 않는다", async () => {
    expect(await buildAlertBody("sla_due")).toBeNull();
  });

  it("기한 임박이 있으면 본문이 만들어진다", async () => {
    addDueTask("OpenSSH 패치", 1);
    const b = await buildAlertBody("sla_due");
    expect(b?.subject).toContain("조치 기한 임박");
    expect(b?.text).toContain("OpenSSH 패치");
  });

  it("실행해도 보낼 게 없으면 skipped로 남고 메일은 안 나간다 — 매일 오는 '이상 없음'은 아무도 안 읽는다", async () => {
    const now = new Date();
    createAlertSchedule("sla_due", now.getHours(), ["a@b.c"]);
    const r = await runDueAlerts(now);
    expect(r.ran).toBe(1);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(1);
    expect(sent).toHaveLength(0);
    expect(listAlertSchedules()[0].lastResult).toBe("skipped");
  });
});

describe("발송", () => {
  it("보낼 게 있으면 보내고 결과를 남긴다", async () => {
    addDueTask("기한 임박 건", 0);
    const now = new Date();
    createAlertSchedule("sla_due", now.getHours(), ["a@b.c"]);
    const r = await runDueAlerts(now);
    expect(r.sent).toBe(1);
    expect(sent[0].to).toEqual(["a@b.c"]);
    expect(listAlertSchedules()[0].lastResult).toBe("sent");
  });

  it("같은 시각에 두 번 보내지 않는다 — 틱이 1분마다 도므로 없으면 60번 간다", async () => {
    addDueTask("기한 임박 건", 0);
    const now = new Date();
    createAlertSchedule("sla_due", now.getHours(), ["a@b.c"]);
    await runDueAlerts(now);
    await runDueAlerts(now);
    expect(sent).toHaveLength(1);
  });

  it("다른 시각의 알림은 건드리지 않는다", async () => {
    addDueTask("기한 임박 건", 0);
    const now = new Date();
    createAlertSchedule("sla_due", (now.getHours() + 3) % 24, ["a@b.c"]);
    expect((await runDueAlerts(now)).ran).toBe(0);
  });

  it("중지한 알림은 돌지 않는다", async () => {
    addDueTask("기한 임박 건", 0);
    const now = new Date();
    const s = createAlertSchedule("sla_due", now.getHours(), ["a@b.c"]);
    setAlertEnabled(s.id, false);
    expect((await runDueAlerts(now)).ran).toBe(0);
  });
});

describe("현황 요약", () => {
  it("등록이 없으면 왜 필요한지와 함께 안내한다", () => {
    const t = alertScheduleText();
    expect(t).toContain("등록된 정기 알림이 없습니다");
    expect(t).toContain("보낼 것이 없는 날에는 보내지 않습니다");
  });

  it("등록이 있으면 시각·대상·최근 결과를 낸다", async () => {
    const now = new Date();
    createAlertSchedule("system_health", now.getHours(), ["a@b.c"]);
    await runDueAlerts(now);
    const t = alertScheduleText();
    expect(t).toContain("시스템 이상");
    expect(t).toMatch(/발송|보낼 것 없어 건너뜀|실패/);
  });
});
