// 정기 리포트 일정 바꾸기·지우기 (2026-08-31 · 대장 §6 끊김 2)
//
// 왜: 조회(report_schedule_list)·등록(report_schedule_add)은 있는데 **바꾸기·지우기가 없어**
// 「주간 리포트를 매주 금요일 5시로 바꿔줘」가 안 됐다. 엔진(updateSchedule·deleteSchedule)은
// 처음부터 있었고 화면 IPC만 그것을 썼다 — 대화창에는 길이 없었다.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { createSchedule, listSchedules } from "../src/engine/reportschedule";
import {
  runUpdateReportSchedule,
  runDeleteReportSchedule,
  주기해석,
  요일해석,
} from "../src/engine/agenttools/handlers";

beforeEach(() => {
  db.exec("DELETE FROM report_schedule_runs");
  db.exec("DELETE FROM report_schedules");
});

const 주간 = () => createSchedule({ type: "weekly", format: "pdf", audience: "internal", dayOfWeek: 1, hour: 9, minute: 0 });

describe("주기·요일 해석 — 사본을 만들지 않는다", () => {
  it("우리말과 영문을 함께 읽는다", () => {
    expect(주기해석("주간")).toBe("weekly");
    expect(주기해석("매주")).toBe("weekly");
    expect(주기해석("weekly")).toBe("weekly");
    expect(주기해석("매월")).toBe("monthly");
  });
  it("★ 못 읽으면 **null** — 지어내지 않는다", () => {
    expect(주기해석("가끔")).toBeNull();
    expect(주기해석("")).toBeNull();
    expect(요일해석("아무때나")).toBeNull();
  });
  it("요일은 「금」과 「금요일」을 같이 읽는다", () => {
    expect(요일해석("금")).toBe(5);
    expect(요일해석("금요일")).toBe(5);
    expect(요일해석("일")).toBe(0);
  });
});

describe("일정 바꾸기", () => {
  it("★ 대장이 지적한 그 물음 — 요일·시각을 바꾼다", async () => {
    주간();
    const 답 = await runUpdateReportSchedule({ target: "주간", dayOfWeek: "금", hour: "17" });
    expect(답).toContain("바꿨습니다");
    const s = listSchedules()[0];
    expect(s.dayOfWeek, "요일이 안 바뀌었다").toBe(5);
    expect(s.hour, "시각이 안 바뀌었다").toBe(17);
  });

  it("안 준 값은 **그대로 둔다** — 빈 값으로 덮지 않는다", async () => {
    주간();
    await runUpdateReportSchedule({ target: "주간", hour: "17" });
    const s = listSchedules()[0];
    expect(s.hour).toBe(17);
    expect(s.dayOfWeek, "안 준 요일이 지워졌다").toBe(1);
  });

  it("★ 바꿀 값이 하나도 없으면 **묻는다** — 조용히 아무것도 안 하지 않는다", async () => {
    주간();
    const 답 = await runUpdateReportSchedule({ target: "주간" });
    expect(답).toContain("무엇을 바꿀지");
    expect(listSchedules()[0].hour, "값 없이 바뀌었다").toBe(9);
  });

  it("시각이 범위 밖이면 막고 그 값을 되돌려 말한다", async () => {
    주간();
    const 답 = await runUpdateReportSchedule({ target: "주간", hour: "25" });
    expect(답).toContain("0~23");
    expect(답, "받은 값을 보여 줘야 사람이 고칠 수 있다").toContain("25");
    expect(listSchedules()[0].hour).toBe(9);
  });

  it("일정이 없으면 **거는 법**을 알려 준다(빈손으로 안 돌려보낸다)", async () => {
    const 답 = await runUpdateReportSchedule({ target: "주간", hour: "17" });
    expect(답).toContain("등록된 정기 리포트 일정이 없습니다");
    expect(답, "다음에 무엇을 할지 알려 줘야 한다").toContain("걸어줘");
  });

  it("여럿이면 고르라고 한다 — 아무거나 안 집는다", async () => {
    주간();
    createSchedule({ type: "monthly", format: "pdf", audience: "internal", dayOfWeek: null, hour: 8, minute: 0 });
    const 답 = await runUpdateReportSchedule({ hour: "17" });
    expect(답).toContain("어느 일정인지");
    expect(listSchedules().every((s) => s.hour !== 17), "고르지도 않고 바꿨다").toBe(true);
  });

  it("주기로 고르면 그 하나만 바꾼다", async () => {
    주간();
    createSchedule({ type: "monthly", format: "pdf", audience: "internal", dayOfWeek: null, hour: 8, minute: 0 });
    await runUpdateReportSchedule({ target: "매월", hour: "20" });
    expect(listSchedules().find((s) => s.type === "monthly")?.hour).toBe(20);
    expect(listSchedules().find((s) => s.type === "weekly")?.hour, "딴 일정이 바뀌었다").toBe(9);
  });
});

describe("일정 지우기", () => {
  it("지우면 목록에서 사라진다", async () => {
    주간();
    const 답 = await runDeleteReportSchedule({ target: "주간" });
    expect(답).toContain("지웠습니다");
    expect(listSchedules().length).toBe(0);
  });

  it("★ 이미 만든 리포트는 남는다고 **말한다**(오해를 미리 막는다)", async () => {
    주간();
    const 답 = await runDeleteReportSchedule({ target: "주간" });
    expect(답).toContain("이미 만들어진 리포트는 그대로");
  });

  it("없는 것을 지우라 하면 있는 것을 보여 준다", async () => {
    주간();
    const 답 = await runDeleteReportSchedule({ target: "분기" });
    expect(답).toContain("못 찾았습니다");
    expect(listSchedules().length, "엉뚱한 것을 지웠다").toBe(1);
  });
});

describe("배선 — 대장의 물음이 이 도구로 온다", () => {
  const 규칙 = (tool: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const 루프 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const i = 루프.indexOf(`tool: "${tool}"`);
    expect(i, `${tool} 강제 규칙이 없다`).toBeGreaterThan(-1);
    const 앞 = 루프.lastIndexOf("    re: ", i);
    return eval(루프.slice(앞 + 8, 루프.indexOf("\n", 앞)).replace(/,\s*$/, "").replace(/\r$/, "")) as RegExp;
  };

  it("「주간 리포트를 매주 금요일 5시로 바꿔줘」가 걸린다", () => {
    expect(규칙("report_schedule_update").test("주간 리포트를 매주 금요일 5시로 바꿔줘")).toBe(true);
  });

  it("★ 남의 말을 안 삼킨다 — 등록·담당자 변경·조회", () => {
    const up = 규칙("report_schedule_update");
    for (const 남의것 of ["주간 리포트 매주 금요일 5시로 걸어줘", "1번 담당자 바꿔줘", "리포트 스케줄 알려줘"]) {
      expect(up.test(남의것), `${남의것}을 삼킨다 — 낱말 가로채기`).toBe(false);
    }
  });

  it("지우기는 **일정**과 **문서 삭제**를 가른다", () => {
    const del = 규칙("report_schedule_delete");
    expect(del.test("주간 리포트 자동 생성 그만해줘")).toBe(true);
    expect(del.test("리포트 만들어줘"), "생성을 삼킨다").toBe(false);
  });
});
