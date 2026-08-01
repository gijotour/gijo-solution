// 절차 카드 — 「내 업무」 화면에서 하던 단계 밟기를 대화창에서 할 수 있는가.
//
// 사용자 결정(2026-08-01): "내업무 메뉴는 삭제하고 그 안의 모든 내용은 대화창에서" +
// "메뉴는 보기 용도, 대화창에서 입력 및 설정 다 한다".
//
// ★ 이 파일이 지키는 것은 **약속과 코드의 일치**다. 목록 답변이
//   "○○ 어떻게 해?라고 물으면 순서를 알려드립니다"라고 담당자에게 약속하는데,
//   실제로는 엉뚱한 CVSS 설명이 나왔다(2026-08-01 운영 실측). 말만 하고 코드가
//   안 지키는 종류의 결함은 동작 QA로는 안 잡힌다 — 여기서 못 박는다.
import { describe, it, expect, beforeEach } from "vitest";
import { findAgentTool } from "../src/engine/agenttools";
import { createTask, listTasks, resetTasksForTests } from "../src/engine/tasks";
import { listGuides } from "../src/engine/workguide";
import { myWorkAnswer } from "../src/engine/picklist";

const 도구 = (n: string) => findAgentTool(n)!;
const 실행 = async (n: string, args: Record<string, string>) => String(await 도구(n).run(args));

/** 가이드가 실제로 붙는 일감 하나를 만든다(가이드 이름을 그대로 쓰면 guessGuideKey가 문다). */
function 가이드있는일감() {
  const g = listGuides()[0];
  expect(g, "가이드 템플릿이 하나도 없다 — 절차 카드를 시험할 수 없다").toBeTruthy();
  createTask({ text: g.label });
  const t = listTasks().find((x) => x.text === g.label)!;
  expect(t.guideKey, `"${g.label}"에 가이드가 안 붙었다`).toBeTruthy();
  return { g, t };
}

describe("절차 도구가 있다", () => {
  it("보기·단계완료·되돌리기 셋 다 등록돼 있다", () => {
    for (const n of ["work_steps", "step_done", "step_undo"]) {
      expect(도구(n), `${n} 도구가 없다 — 대화창에서 절차를 밟을 수 없다`).toBeTruthy();
    }
  });

  it("★ 단계 체크는 결재판을 안 거친다 (나에게만 영향)", () => {
    expect(도구("step_done").write, "단계 체크에 승인 팝업이 뜬다 — 아무도 안 쓴다").toBeFalsy();
    expect(도구("step_undo").write).toBeFalsy();
  });
});

describe("절차 카드가 실제로 동작한다", () => {
  beforeEach(() => resetTasksForTests());

  it("절차를 물으면 단계가 번호와 함께 나온다", async () => {
    const { g } = 가이드있는일감();
    const out = await 실행("work_steps", { task: g.label });
    expect(out).toContain(g.label);
    expect(out, "첫 단계 제목이 안 보인다").toContain(g.steps[0].title);
    expect(out, "지금 할 단계 표시(▶)가 없다").toContain("▶");
    expect(out, `절차 0/${g.steps.length} 표기가 없다`).toContain(`/${g.steps.length}`);
  });

  it("단계를 끝내면 저장되고 다음 단계가 보인다", async () => {
    const { g } = 가이드있는일감();
    const out = await 실행("step_done", { step: "1", task: g.label });
    expect(out).toContain("끝낸 것으로 적었습니다");
    expect(out, "☑ 표시가 안 붙었다").toContain("☑");
    expect(listTasks().find((t) => t.text === g.label)?.guideDone).toEqual([0]);
    expect(out, "잘못 눌렀을 때 되돌릴 말을 안 준다").toContain("취소");
  });

  it("일감을 안 적어도 진행 중인 것을 집는다", async () => {
    // 대화창에서는 "1번 했어"만 말하는 게 자연스럽다 — 매번 일감 이름을 대라고 하면 안 쓴다.
    const { g } = 가이드있는일감();
    await 실행("step_done", { step: "1", task: g.label });
    const out = await 실행("step_done", { step: "2" });
    expect(out).toContain("끝낸 것으로 적었습니다");
    expect(listTasks().find((t) => t.text === g.label)?.guideDone).toEqual([0, 1]);
  });

  it("되돌리면 다시 열린다", async () => {
    const { g } = 가이드있는일감();
    await 실행("step_done", { step: "1", task: g.label });
    const out = await 실행("step_undo", { step: "1", task: g.label });
    expect(out).toContain("다시 열었습니다");
    expect(listTasks().find((t) => t.text === g.label)?.guideDone).toEqual([]);
  });

  it("★ 가이드가 없으면 **순서를 지어내지 않는다**", async () => {
    // mywork.html이 지키던 원칙 — 화면을 없애면서 같이 잃으면 안 된다.
    createTask({ text: "여기에맞는가이드는없는일xyz" });
    const out = await 실행("work_steps", { task: "여기에맞는가이드는없는일xyz" });
    expect(out).toContain("정해진 절차가 없습니다");
    // ⚠ 부정 단언만 두면 글자표(☐)나 번호 서식을 바꾸는 순간 **무조건 통과**한다(거짓 통과,
    //   검토 지적). 같은 도구가 절차 있는 일감에는 단계를 낸다는 **대조**를 함께 둔다.
    const { g } = 가이드있는일감();
    const 있는쪽 = await 실행("work_steps", { task: g.label });
    expect(있는쪽, "대조군이 단계를 안 낸다 — 이 시험은 아무것도 못 지킨다").toContain(g.steps[0].title);
    expect(out, "지어낸 단계 제목이 보인다").not.toContain(g.steps[0].title);
  });

  it("없는 일감이면 「없다」가 아니라 「못 찾았다」고 한다", async () => {
    createTask({ text: "방화벽 정책 점검" });
    const out = await 실행("work_steps", { task: "존재하지않는일xyz" });
    expect(out).toContain("못 찾았습니다");
  });

  it("범위 밖 단계 번호는 몇 번까지인지 알려 준다", async () => {
    const { g } = 가이드있는일감();
    const out = await 실행("step_done", { step: "99", task: g.label });
    expect(out).toContain(`1~${g.steps.length}번`);
  });

  it("빈 인자면 무엇이 필요한지 말한다(조용히 돌아가지 않는다)", async () => {
    expect(await 실행("work_steps", { task: "" })).toContain("알려주세요");
  });
});

describe("★ 목록이 한 약속을 코드가 지킨다", () => {
  beforeEach(() => resetTasksForTests());

  it("목록이 안내한 그 말이 실제로 절차를 연다", async () => {
    // 목록은 "○○ 어떻게 해?"라고 물으라 안내한다 — 그 문장을 그대로 도구에 넣어 본다.
    // (라우팅은 dispatcher가 맡고, 여기서는 **안내 문구와 도구가 짝이 맞는지**를 본다.)
    const { g } = 가이드있는일감();
    const 오늘 = listTasks().filter((t) => !t.done).map((t) => ({
      id: t.id, text: t.text, dueLabel: "오늘", overdue: false,
      guideTotal: g.steps.length, guideDoneCount: 0,
    }));
    const 목록 = myWorkAnswer({ today: 오늘 as never, week: [], later: [] });
    const 안내 = String(목록.output).match(/"([^"]+?)\s*어떻게\s*해\?"/);
    expect(안내, "목록이 「어떻게 해?」를 안내하지 않는다 — 안내를 지웠으면 이 시험도 함께 고칠 것").toBeTruthy();
    const out = await 실행("work_steps", { task: 안내![1] });
    expect(out, `목록이 안내한 "${안내![1]} 어떻게 해?"가 절차를 못 연다`).not.toContain("못 찾았습니다");
    expect(out).toContain(g.steps[0].title);
  });
});
