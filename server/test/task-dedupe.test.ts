// 같은 할 일이 여러 번 담기던 것 — [2026-08-04 실화면 발견 · 계획서 전-7]
//
// 대시보드 「오늘 할 일」에 같은 줄이 2~4개씩 있었다:
//   「기한 지난 유지보수 점검 6건 수행」×3 · 「FOCS 메뉴얼 ver1 2 정기점검」×4 …
// 원인은 「＋ 할 일로 담기」를 누를 때마다 무조건 새로 만든 것. 담당자는 자기가 담았는지
// 기억하지 못해 다시 누르고, 목록은 같은 줄로 불어난다 — 그러면 목록 자체를 안 믿게 된다.
//
// ⚠ 여기서 지키는 두 가지가 서로 반대 방향이다:
//   ① 아직 안 끝난 같은 일은 **두 번 만들지 않는다**
//   ② 되풀이 일정의 다음 회차는 **반드시 만든다**(막으면 기능이 조용히 죽는다)
import { describe, expect, it, beforeEach } from "vitest";
import { createTask, listTasks, completeTask, resetTasksForTests } from "../src/engine/tasks";

describe("★ 안 끝난 같은 일은 두 번 담기지 않는다", () => {
  beforeEach(() => resetTasksForTests());

  it("같은 글을 두 번 담아도 한 줄이다", () => {
    const a = createTask({ text: "기한 지난 유지보수 점검 6건 수행", priority: "P1" });
    const b = createTask({ text: "기한 지난 유지보수 점검 6건 수행", priority: "P1" });
    expect(b.id, "이미 있던 그 일을 돌려줘야 한다").toBe(a.id);
    expect(listTasks().filter((t) => t.text.includes("기한 지난")).length).toBe(1);
  });

  it("앞뒤 공백만 다른 것도 같은 일로 본다 — 사람 눈엔 같은 줄이다", () => {
    createTask({ text: "주간 콘솔점검" });
    createTask({ text: "  주간 콘솔점검  " });
    expect(listTasks().filter((t) => t.text.trim() === "주간 콘솔점검").length).toBe(1);
  });

  it("다른 일은 그대로 따로 담긴다 — 막이가 과하면 진짜 일을 잃는다", () => {
    createTask({ text: "KEV 등재 취약점 8건 우선 조치" });
    createTask({ text: "점검 보고서 1건 검토" });
    expect(listTasks().length).toBe(2);
  });
});

describe("★★ 끝난 일과는 견주지 않는다 — 다시 담는 것은 정상이다", () => {
  beforeEach(() => resetTasksForTests());

  it("지난주에 끝낸 같은 일을 이번 주에 다시 담을 수 있다", () => {
    const a = createTask({ text: "주간 점검" });
    completeTask(a.id);
    const b = createTask({ text: "주간 점검" });
    expect(b.id, "끝난 일 때문에 새 일이 막히면 안 된다").not.toBe(a.id);
    expect(listTasks().length).toBe(2);
  });
});

describe("★★ 되풀이 일정의 다음 회차는 막지 않는다", () => {
  beforeEach(() => resetTasksForTests());

  it("중복허용을 주면 같은 글이라도 새로 만든다", () => {
    const a = createTask({ text: "월간 방화벽 점검", recur: "monthly" });
    const b = createTask({ text: "월간 방화벽 점검", recur: "monthly", 중복허용: true });
    expect(b.id).not.toBe(a.id);
  });

  it("⚠ 감시가 헛돌지 않는가 — 되풀이 생성부가 실제로 그 표를 세우고 있다", () => {
    // 플래그만 만들어 두고 정작 되풀이 경로가 안 쓰면, 이번 주 것을 끝내도
    // 다음 주 것이 안 생긴다(기능이 조용히 죽는다). 소스로 확인한다.
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "src", "engine", "tasks.ts"),
      "utf8",
    ) as string;
    expect(src).toMatch(/recur: t\.recur[\s\S]{0,300}중복허용: true/);
  });
});
