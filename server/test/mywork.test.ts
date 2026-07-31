// 내 업무 — 진행 가이드 · 반복 업무 · 출처 구분 (2026-07-31 사용자 지시)
//
// 사용자 지시의 핵심: "사용자가 주요 업무를 해당 화면에서 **가이드 주는 대로 일하는 데
// 문제없게** 하는 게 핵심. 가이드를 받고 진행한다가 핵심."
// → 가이드가 틀리거나 진행이 사라지면 이 화면은 존재 이유가 없다. 거기를 집중해서 본다.
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTask, listTasks, setTaskDone, setGuideStepDone, getTask, nextRecurrence, resetTasksForTests,
} from "../src/engine/tasks";
import { getGuide, guessGuideKey, listGuides } from "../src/engine/workguide";

beforeEach(() => resetTasksForTests());

describe("가이드 카탈로그 — 담당자가 따라갈 순서", () => {
  it("모든 가이드에 단계가 있고, 여는 화면은 실재해야 한다", async () => {
    // ⚠ 없는 화면을 열면 담당자는 "고장났다"고 느끼고 그 순간 가이드 전체를 안 믿는다.
    //   (실제로 assets.html 같은 없는 이름을 쓴 적이 있다 — 그래서 여기서 막는다.)
    const fs = await import("node:fs");
    const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);
    const pages = new Set(fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html")));
    for (const g of listGuides()) {
      expect(g.steps.length, `${g.key}에 단계가 없다`).toBeGreaterThan(0);
      for (const s of g.steps) {
        if (s.kind === "open") {
          expect(s.page, `${g.key}의 open 단계에 화면이 없다`).toBeTruthy();
          expect(pages.has(s.page!), `${g.key} → 없는 화면 ${s.page}`).toBe(true);
        }
        if (s.kind === "ask") expect(s.question, `${g.key}의 ask 단계에 질문이 없다`).toBeTruthy();
        expect(s.title.length).toBeGreaterThan(1);
      }
    }
  });

  it("단계 종류는 셋뿐이다 — 담당자가 배울 것을 늘리지 않는다", () => {
    for (const g of listGuides()) {
      for (const s of g.steps) expect(["open", "ask", "note"]).toContain(s.kind);
    }
  });
});

describe("업무 유형 알아보기", () => {
  it.each([
    ["방화벽 월간 정기점검", undefined, "product-maint"],
    ["취약점 조치하기", undefined, "vuln-remediate"],
    ["주간 현황 보고서 만들기", undefined, "weekly-report"],
    ["담당자 인수인계 남기기", undefined, "handover"],
    ["이 작업이 규정에 맞는지 확인", undefined, "compliance-check"],
    ["전체 자산 재스캔", undefined, "rescan"],
    ["정책 백업 점검", undefined, "policy-backup"],
    ["차단 로그 검토", undefined, "log-review"],
  ])("문장으로 고른다: %s", (text, ref, expected) => {
    expect(guessGuideKey(text, ref)).toBe(expected);
  });

  it("참조(ref)가 문장보다 확실하다 — today 항목이 이 형태로 들어온다", () => {
    expect(guessGuideKey("무슨 말인지 모를 제목", "vulnhost:10.0.0.1")).toBe("vuln-remediate");
    expect(guessGuideKey("아무 제목", "hardening:5")).toBe("hardening-check");
    expect(guessGuideKey("아무 제목", "maint:3")).toBe("product-maint");
  });

  it("★ 확신이 없으면 아무것도 붙이지 않는다", () => {
    // 엉뚱한 가이드를 붙이면 담당자가 엉뚱한 순서로 일한다 — 없는 편이 낫다.
    expect(guessGuideKey("점심 뭐 먹지")).toBeNull();
    expect(guessGuideKey("김대리한테 전화")).toBeNull();
    expect(guessGuideKey("")).toBeNull();
  });

  it("업무를 만들면 가이드가 자동으로 붙는다 — 담당자가 유형을 고를 필요가 없다", () => {
    const t = createTask({ text: "방화벽 월간 정기점검 진행" });
    expect(t.guideKey).toBe("product-maint");
    expect(getGuide(t.guideKey)?.steps.length).toBeGreaterThan(0);
  });
});

describe("가이드 진행이 남는다 — 화면을 닫았다 열어도", () => {
  it("단계를 끝내면 저장되고, 취소도 된다", () => {
    const t = createTask({ text: "방화벽 월간 정기점검" });
    expect(getTask(t.id)?.guideDone ?? []).toEqual([]);
    setGuideStepDone(t.id, 0, true);
    setGuideStepDone(t.id, 2, true);
    expect(getTask(t.id)?.guideDone).toEqual([0, 2]); // 정렬돼 저장된다
    setGuideStepDone(t.id, 0, false);
    expect(getTask(t.id)?.guideDone).toEqual([2]);
  });

  it("같은 단계를 두 번 눌러도 중복으로 쌓이지 않는다", () => {
    const t = createTask({ text: "주간 현황 보고서" });
    setGuideStepDone(t.id, 1, true);
    setGuideStepDone(t.id, 1, true);
    expect(getTask(t.id)?.guideDone).toEqual([1]);
  });

  it("없는 업무에 단계를 표시하면 조용히 실패하지 않고 null을 준다", () => {
    expect(setGuideStepDone("없는id", 0, true)).toBeNull();
  });
});

describe("반복 업무 — 주기가 밀리면 안 된다", () => {
  const 월요일 = new Date("2026-08-03T09:00:00+09:00").getTime();

  it("완료하면 다음 차례가 새로 생긴다(원본은 완료로 남는다)", () => {
    const t = createTask({ text: "주간 스캔 결과 검토", dueAt: 월요일, recur: "weekly" });
    setTaskDone(t.id, true);
    const all = listTasks();
    expect(all).toHaveLength(2);
    const 원본 = all.find((x) => x.id === t.id)!;
    const 다음 = all.find((x) => x.id !== t.id)!;
    expect(원본.done, "지난주에 했다는 기록이 남아야 한다").toBe(true);
    expect(다음.done).toBe(false);
    expect(다음.recur).toBe("weekly");
    expect(다음.text).toBe(t.text);
  });

  it("★ 기준은 완료 시각이 아니라 원래 기한이다 — 늦게 끝냈다고 주기가 밀리면 안 된다", () => {
    // 월요일 점검을 목요일에 끝냈다고 다음이 '그 다음 목요일'이 되면, 매주 조금씩 밀려
    // 결국 월요일 점검이 아니게 된다.
    const t = createTask({ text: "주간 점검", dueAt: 월요일, recur: "weekly" });
    const 목요일 = 월요일 + 3 * 24 * 3600_000;
    const 다음 = nextRecurrence(t, 목요일)!;
    expect(다음.dueAt).toBe(월요일 + 7 * 24 * 3600_000); // 그 다음 월요일
  });

  it("한참 방치돼 여러 주기가 지났어도 밀린 것을 몇 개씩 만들지 않는다", () => {
    const t = createTask({ text: "주간 점검", dueAt: 월요일, recur: "weekly" });
    const 한달뒤 = 월요일 + 30 * 24 * 3600_000;
    const 다음 = nextRecurrence(t, 한달뒤)!;
    expect(listTasks().filter((x) => !x.done)).toHaveLength(2); // 원본 + 다음 하나뿐
    expect(다음.dueAt!).toBeGreaterThan(한달뒤);
  });

  it("월간 반복은 한 달 뒤다", () => {
    const t = createTask({ text: "월간 점검", dueAt: new Date("2026-08-03T09:00:00+09:00").getTime(), recur: "monthly" });
    const 다음 = nextRecurrence(t, 월요일)!;
    expect(new Date(다음.dueAt!).getMonth()).toBe(8); // 9월(0-based)
  });

  it("반복이 아니면 다음 차례를 만들지 않는다", () => {
    const t = createTask({ text: "한 번만 하는 일", dueAt: 월요일 });
    setTaskDone(t.id, true);
    expect(listTasks()).toHaveLength(1);
    expect(nextRecurrence(t)).toBeNull();
  });

  it("완료를 되돌려도 다음 차례를 지우지 않는다 — 거기 적어 둔 진행이 날아간다", () => {
    const t = createTask({ text: "주간 점검", dueAt: 월요일, recur: "weekly" });
    setTaskDone(t.id, true);
    expect(listTasks()).toHaveLength(2);
    setTaskDone(t.id, false);
    expect(listTasks(), "되돌려도 다음 차례는 남는다").toHaveLength(2);
  });

  it("이미 완료된 것을 또 완료해도 다음 차례가 겹쳐 생기지 않는다", () => {
    const t = createTask({ text: "주간 점검", dueAt: 월요일, recur: "weekly" });
    setTaskDone(t.id, true);
    setTaskDone(t.id, true);
    expect(listTasks()).toHaveLength(2);
  });
});

describe("담은 일이 오늘 목록에서 사라지지 않는다", () => {
  // ⚠ 실사고(2026-07-31): AI가 "오늘 하세요"로 올린 일을 담았는데 기한이 안 붙어
  //   '나중에'로 떨어졌다. 담당자 입장에선 담자마자 잃어버린 것이다.
  //   기한 없는 일은 later로 가는 게 맞으므로, **담을 때 기한을 채우는 쪽**으로 고쳤다.
  it("AI 제안·자주 하는 업무는 기한 없이 담기면 오늘로 잡힌다", async () => {
    const { buildMyWork } = await import("../src/engine/mywork");
    createTask({ text: "AI가 올린 일", origin: "ai", dueAt: Date.now() });
    const w = await buildMyWork();
    expect(w.today.some((x) => x.text === "AI가 올린 일"), "담은 일이 오늘에 있어야 한다").toBe(true);
    expect(w.later.some((x) => x.text === "AI가 올린 일")).toBe(false);
  });

  it("직접 적은 일은 '기한 없음'을 존중한다 — 담당자가 고른 것이다", async () => {
    const { buildMyWork } = await import("../src/engine/mywork");
    createTask({ text: "언젠가 할 일", origin: "me" });
    const w = await buildMyWork();
    expect(w.later.some((x) => x.text === "언젠가 할 일")).toBe(true);
  });
});

describe("출처를 감추지 않는다", () => {
  it("직접 적은 것·AI에서 담은 것·자주 하는 것이 구분돼 저장된다", () => {
    createTask({ text: "내가 적은 일", origin: "me" });
    createTask({ text: "AI가 찾은 일", origin: "ai", ref: "vulnhost:10.0.0.1" });
    createTask({ text: "자주 하는 일", origin: "routine" });
    const all = listTasks();
    expect(all.map((t) => t.origin).sort()).toEqual(["ai", "me", "routine"]);
  });
});

describe("질문은 일과로 배우지 않는다", () => {
  // ⚠ 실사고(2026-07-31, '내 업무' 화면에서 눈으로 발견): 할일 칸에 챗봇처럼 물어본 문장이
  //   그대로 학습돼 '자주 하는 업무' 추천에 떴다 — `+ 머할까?`, `+ 오늘뭐부터볼까`.
  //   누르면 그런 이름의 업무가 생긴다. 담당자는 그걸 보고 제품을 의심한다.
  it("실제로 쌓여 있던 질문들을 전부 걸러 낸다", async () => {
    const { isRoutineWorthy } = await import("../src/engine/tasks");
    for (const q of ["오늘뭐부터볼까", "머할까?", "내가 제일 먼저 처리해야될 일이 어떤게 있을까?"]) {
      expect(isRoutineWorthy(q), `못 걸렀다: ${q}`).toBe(false);
    }
  });

  it("정상 업무 문장은 통과시킨다 — 너무 세게 걸러 학습을 죽이면 안 된다", async () => {
    const { isRoutineWorthy } = await import("../src/engine/tasks");
    for (const w of [
      "방화벽·EDR 이상 알림 확인",
      "전일 스캔 결과·신규 취약점 확인",
      "전체 자산 재스캔·우선순위 갱신",
      "보안제품 정책 백업 상태 점검",
      "주간 현황 보고서 작성",
    ]) {
      expect(isRoutineWorthy(w), `헛되이 걸렀다: ${w}`).toBe(true);
    }
  });

  it("너무 짧거나 긴 것도 배우지 않는다", async () => {
    const { isRoutineWorthy } = await import("../src/engine/tasks");
    expect(isRoutineWorthy("ㅇㅇ")).toBe(false);
    expect(isRoutineWorthy("가".repeat(80))).toBe(false);
  });
});
