// "n번 했어"가 **엉뚱한 업무**에 붙지 않는가 (검토 지적 2026-08-01, 낮음).
//
// 일감 이름을 안 적으면 "가이드가 붙은 아무 열린 일감"을 집는데, tasks는 createdAt 오름차순이라
// **가장 오래된 것**부터 걸린다. 번호가 매겨진 다른 목록(취약점 등)을 보다가 "3번 완료"라고
// 하면 무관한 업무의 3단계가 체크될 수 있다.
//
// 판단: 완전히 막지는 않는다 — 대화창에서 "1번 했어"만 말하는 것이 자연스럽고, 매번 일감
// 이름을 대라고 하면 아무도 안 쓴다. 대신 **진행 중인 것을 먼저 집고, 답에 업무 이름을
// 반드시 실어** 담당자가 눈으로 잡을 수 있게 한다. 이 시험이 그 계약을 지킨다.
import { describe, it, expect, beforeEach } from "vitest";
import { findAgentTool } from "../src/engine/agenttools";
import { createTask, listTasks, resetTasksForTests } from "../src/engine/tasks";
import { listGuides } from "../src/engine/workguide";

const 도구 = (n: string) => findAgentTool(n)!;
const 실행 = async (n: string, a: Record<string, string>) => String(await 도구(n).run(a));

describe("★ 일감을 안 적은 「n번 했어」", () => {
  beforeEach(() => resetTasksForTests());

  it("진행 중인 것을 **먼저** 집는다 (가장 오래된 것이 아니라)", async () => {
    const [g1, g2] = listGuides();
    expect(g2, "가이드가 2종 이상 있어야 이 시험이 성립한다").toBeTruthy();
    createTask({ text: g1.label }); // 먼저 만든 것 — 손대지 않음
    createTask({ text: g2.label }); // 나중 것 — 여기서 진행을 시작한다
    await 실행("step_done", { step: "1", task: g2.label });

    await 실행("step_done", { step: "2" }); // 일감 미지정
    const 나중 = listTasks().find((t) => t.text === g2.label);
    const 먼저 = listTasks().find((t) => t.text === g1.label);
    expect(나중?.guideDone, "진행 중이던 일감에 안 붙었다").toEqual([0, 1]);
    expect(먼저?.guideDone ?? [], "손대지 않은 일감에 잘못 붙었다").toEqual([]);
  });

  it("★ 답에 **어느 업무인지**를 반드시 싣는다 (눈으로 잡을 수 있게)", async () => {
    const g = listGuides()[0];
    createTask({ text: g.label });
    const out = await 실행("step_done", { step: "1" });
    expect(out, "어느 업무의 단계인지 말해 주지 않는다 — 잘못 붙어도 모른다").toContain(g.label);
    expect(out, "되돌리는 말을 안 준다").toContain("취소");
  });

  it("가이드가 붙은 열린 일감이 없으면 **집지 않고 되묻는다**", async () => {
    createTask({ text: "여기에맞는가이드는없는일xyz" });
    const out = await 실행("step_done", { step: "1" });
    expect(out).toMatch(/어떤 일의 단계인지|정해진 절차가 없습니다/);
  });
});
