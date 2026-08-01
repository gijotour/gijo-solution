// 「내 업무」를 화면 없이 대화창에서 할 수 있는가 — 도구 3종(조회·완료·담기).
//
// 사용자 결정(2026-08-01): "내업무 메뉴는 삭제하고 그 안의 모든 내용은 대화창에서" +
// "메뉴는 보기용도, 대화창에서 입력 및 설정 다 한다가 핵심 기능".
//
// ★ 결재판 경계(승인됨): **나에게만 영향**을 주는 것(완료·담기)은 결재판 없이 즉시 처리하고
//   되돌릴 길을 준다. 체크칸 하나에도 승인 팝업이 뜨면 아무도 안 쓴다.
//   **남에게 영향**을 주는 것(재배정)만 결재판을 거친다.
import { describe, it, expect, beforeEach } from "vitest";
import { findAgentTool } from "../src/engine/agenttools";
import { createTask, listTasks, resetTasksForTests } from "../src/engine/tasks";

const 도구 = (n: string) => findAgentTool(n)!;

describe("할 일 도구가 있다", () => {
  it("조회·완료·담기 셋 다 등록돼 있다", () => {
    // ⚠ my_tasks는 뺐다 — 조회는 picklist의 결정적 경로가 이미 맡는다(두 길이 겹치면 어긋난다).
    for (const n of ["complete_task", "add_task"]) {
      expect(도구(n), `${n} 도구가 없다 — 대화창에서 내 업무를 할 수 없다`).toBeTruthy();
    }
  });

  it("★ 완료·담기는 결재판을 안 거친다 (나에게만 영향)", () => {
    // write:true면 결재판이 떠서 체크 한 번에 승인 팝업이 뜬다 — 그러면 아무도 안 쓴다.
    expect(도구("complete_task").write, "완료가 결재판을 거친다 — 과잉이다").toBeFalsy();
    expect(도구("add_task").write, "담기가 결재판을 거친다 — 과잉이다").toBeFalsy();
  });

  it("★ 남에게 영향을 주는 재배정은 여전히 결재판을 거친다", () => {
    // 경계가 무너지지 않았는지 함께 본다 — "전부 즉시"로 흘러가면 안 된다.
    expect(도구("assign_finding").write, "재배정이 결재판을 안 거친다").toBe(true);
  });

  it("★ 시키는 말은 목록 경로가 비켜 준다", async () => {
    // "할 일 추가: ○○"·"○○ 완료"가 목록 경로에 걸리면 도구가 영영 안 불리고 모델이
    // "완료했습니다"라고 지어낸다(2026-08-01 실측으로 확인함).
    const { isMyWorkAsk } = await import("../src/engine/picklist");
    expect(isMyWorkAsk("오늘 할 일"), "묻는 말은 목록이 맡아야 한다").toBe(true);
    expect(isMyWorkAsk("할 일 추가: 방화벽 점검"), "시키는 말인데 목록이 가로챈다").toBe(false);
    expect(isMyWorkAsk("방화벽 점검 완료"), "시키는 말인데 목록이 가로챈다").toBe(false);
  });
});

describe("담기·완료가 실제로 동작한다", () => {
  beforeEach(() => resetTasksForTests());

  it("담으면 목록에 생긴다", () => {
    const out = 도구("add_task").run({ text: "방화벽 정책 점검", due: "오늘" }) as string;
    expect(out).toContain("담았습니다");
    expect(listTasks().some((t) => t.text === "방화벽 정책 점검")).toBe(true);
  });

  it("완료하면 닫히고 **되돌리는 말**을 함께 준다", async () => {
    createTask({ text: "방화벽 정책 점검" });
    const out = String(await 도구("complete_task").run({ task: "방화벽" })); // 일부만 적어도 찾는다
    expect(out).toContain("완료로 옮겼습니다");
    expect(out, "즉시 처리하면서 되돌릴 길을 안 알려 준다").toContain("되돌리려면");
    expect(listTasks().find((t) => t.text === "방화벽 정책 점검")?.done).toBe(true);
  });

  it("없는 것을 완료하라면 **없다고 하지 않고 못 찾았다고 한다**", async () => {
    createTask({ text: "방화벽 정책 점검" });
    const out = String(await 도구("complete_task").run({ task: "존재하지않는일xyz" }));
    expect(out).toContain("못 찾았습니다");
    expect(out).toMatch(/전체 \d+건 중/);
  });

  it("빈 인자면 무엇이 필요한지 말한다(조용히 돌아가지 않는다)", async () => {
    expect(String(await 도구("complete_task").run({ task: "" }))).toContain("알려주세요");
    expect(String(await 도구("add_task").run({ text: "" }))).toContain("알려주세요");
  });
});
