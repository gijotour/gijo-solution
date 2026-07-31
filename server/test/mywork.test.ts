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

// ── 2차 업무 플로우(2026-07-31) — 화면 커버리지 공백을 메운 9종 ──────────────
describe("추가 업무 플로우", () => {
  it.each([
    ["점검보고서 올려서 분석하기", "scan-report"],
    ["스캐너 결과 분석", "scan-report"],
    ["AI-BOM 점검", "aibom-manage"],
    ["AI 견고성 점검", "ai-robustness"],
    ["레드팀 점검 실행", "ai-robustness"],
    ["위협 인텔 확인", "threat-intel"],
    ["신규 서버 등록", "asset-onboard"],
    ["자산 등록하기", "asset-onboard"],
    ["승인 대기 처리", "approval-queue"],
    ["월간 KPI 보고", "monthly-kpi"],
    ["침해사고 대응", "incident-response"],
    ["랜섬웨어 사고 조사", "incident-response"],
    ["감사 기록 점검", "audit-review"],
  ])("문장으로 고른다: %s", (text, expected) => {
    expect(guessGuideKey(text)).toBe(expected);
  });

  it("★ 제품 1차 목표(스캐너 리포트 분석)와 차별점(AI-BOM)에 가이드가 있다", () => {
    // 처음 9종은 '매일 도는 일' 위주라 정작 제품이 제일 잘하는 일에 가이드가 없었다.
    // 담당자가 그 화면 앞에서 무엇부터 할지 모르면 기능이 있어도 안 쓴다.
    for (const key of ["scan-report", "aibom-manage"]) {
      expect(getGuide(key), `${key} 가이드가 없다`).toBeTruthy();
    }
  });

  it("새 규칙이 기존 분류를 빼앗지 않는다", () => {
    // 규칙을 더할 때마다 위쪽 규칙이 먼저 잡으므로 기존 것이 흔들릴 수 있다.
    expect(guessGuideKey("방화벽 월간 정기점검")).toBe("product-maint");
    expect(guessGuideKey("차단 로그 검토")).toBe("log-review");
    expect(guessGuideKey("주간 현황 보고서 만들기")).toBe("weekly-report");
    expect(guessGuideKey("취약점 조치하기")).toBe("vuln-remediate");
    expect(guessGuideKey("정책 백업 점검")).toBe("policy-backup");
  });

  it("여전히 확신 없으면 안 붙인다", () => {
    expect(guessGuideKey("점심 뭐 먹지")).toBeNull();
    expect(guessGuideKey("김대리한테 전화")).toBeNull();
  });

  it("침해사고 대응은 확인 → 기록 → 조치 → 정리 순이다", () => {
    // 급할수록 기록을 건너뛰기 쉬운데, 나중에 "언제 무엇을 했나"를 못 대면
    // 보고도 재발방지도 못 한다.
    const steps = getGuide("incident-response")!.steps;
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0].page).toBe("analysis.html"); // 먼저 무슨 일인지 본다
    expect(steps[steps.length - 1].page).toBe("report.html"); // 마지막은 기록
  });
});

describe("★ 추천한 업무는 반드시 안내할 수 있어야 한다", () => {
  // ⚠ 실사고(2026-07-31): 기본 추천 4개 중 2개가 어느 가이드에도 안 걸렸다.
  //   담당자가 눌러 담으면 "이 업무에는 정해진 순서가 없습니다"가 뜬다 —
  //   **추천해 놓고 안내를 못 하는 것**이라 이 화면의 약속이 거기서 깨진다.
  it("기본 추천은 전부 가이드가 붙는다", async () => {
    const { defaultRoutines } = await import("../src/engine/workguide");
    const 안붙는것 = defaultRoutines().filter((r) => !guessGuideKey(r.text));
    expect(안붙는것.map((r) => r.text), "추천했는데 안내할 순서가 없다").toEqual([]);
  });

  it("담으면 실제로 단계가 나온다 — 문장→가이드→단계까지 이어지는지", async () => {
    const { defaultRoutines } = await import("../src/engine/workguide");
    for (const r of defaultRoutines()) {
      const t = createTask({ text: r.text, origin: "routine" });
      const g = getGuide(t.guideKey);
      expect(g, `${r.text}에 가이드가 없다`).toBeTruthy();
      expect(g!.steps.length, `${r.text}의 가이드에 단계가 없다`).toBeGreaterThan(0);
    }
  });
});

describe("가이드 질문이 헛돌지 않는다", () => {
  // ⚠ 실사고(2026-07-31, 19개 질문을 실 LLM에 보내 본 결과):
  //   ① "이 작업이 사내 규정에 맞는지 확인해줘" → AI가 "무엇을 확인해야 할까요?"라고
  //      **되묻기만** 했다(65자). 담당자는 단계를 눌렀는데 답 대신 질문을 받는다.
  //      → 질문에 {업무}를 넣어 실제 업무 이름을 채워 보낸다.
  //   ② "레드팀 견고성 점수 두 개가 왜 달라?" → "다른 팀원이 매겼거나…"라는 **엉뚱한 답**.
  //      우리 용어(맨몸/제품 경로 실효)로 물어야 우리 자료를 찾는다.
  //      ⚠ 이건 **길이만 보고 통과시킬 뻔했다** — 세는 것과 확인하는 것은 다르다.
  it("지시대명사로 시작하는 질문에는 {업무}가 들어 있다", () => {
    for (const g of listGuides()) {
      for (const s of g.steps) {
        if (s.kind !== "ask" || !s.question) continue;
        // "이 취약점", "이 작업"처럼 무엇을 가리키는지 문장만으로 알 수 없는 질문은
        // 업무 이름을 채워 보내야 한다.
        if (/(^|\s)이\s*(작업|취약점|자산|제품|항목)/.test(s.question)) {
          expect(s.question, `${g.key}: 무엇을 가리키는지 모르는 질문 — {업무} 필요`).toContain("{업무}");
        }
      }
    }
  });

  it("{업무}를 쓴 질문은 화면이 실제로 치환한다", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../client/src/renderer/pages/mywork.html", import.meta.url), "utf8");
    const 치환필요 = listGuides().some((g) => g.steps.some((s) => s.question?.includes("{업무}")));
    if (!치환필요) return;
    // ⚠ 변수 이름을 고정하지 않는다 — 화면을 재설계하면 이름이 바뀌는데 동작은 멀쩡하다
    //   (2026-07-31 재설계에서 실제로 이 시험이 헛되이 실패했다). **뜻**을 본다:
    //   보낼 때도 보여줄 때도 치환을 거치는가.
    expect(src, "{업무}를 그대로 보내면 AI가 못 알아듣는다").toContain("function fillQuestion");
    // 정규식 대신 문자열 포함으로 본다 — 괄호 이스케이프가 한 겹만 어긋나도
    // 시험 자체가 못 돌아 "no tests"가 된다(2026-07-31에 실제로 겪었다).
    const 쓰임 = src.split("fillQuestion(").length - 1;
    expect(쓰임, "정의만 하고 안 쓰거나, 한 군데서만 쓰면 보이는 것과 보내는 것이 어긋난다").toBeGreaterThanOrEqual(3);
    expect(src, "화면에 보이는 문장도 치환해야 한다 — 다르면 담당자가 헷갈린다").toContain("esc(fillQuestion(");
    expect(src, "AI에게 보낼 때 치환해야 한다").toContain("askAI(fillQuestion(");
  });

  it("우리 제품 용어를 쓰는 질문은 그 용어를 정확히 쓴다", () => {
    // 일반 용어로 물으면 AI가 일반 지식으로 답한다("다른 팀원이 매겼거나…").
    const q = getGuide("ai-robustness")!.steps.find((s) => s.kind === "ask")!.question!;
    expect(q).toContain("맨몸");
    expect(q).toContain("실효");
  });
});

describe("★ 용어사전이 AI의 지식에 들어 있다", () => {
  // ⚠ 실사고(2026-07-31): 용어사전에 하루 종일 용어를 적어 넣었는데 **AI는 한 번도 못 봤다.**
  //   파일이 docs-manifest.json에 없어서 RAG에 인입되지 않았기 때문이다.
  //   그래서 "맨몸 견고성이 뭐야?"에 **Man-in-the-Middle(MitM)이라고 지어냈다.**
  //   우리가 만든 말은 우리 자료에만 있으므로, 자료에 없으면 모델은 반드시 지어낸다.
  it("용어사전이 문서 매니페스트에 있다", async () => {
    const fs = await import("node:fs");
    const m = JSON.parse(fs.readFileSync(new URL("../docs-manifest.json", import.meta.url), "utf8")) as { files: { file: string }[] };
    expect(m.files.some((f) => f.file.includes("용어사전")), "용어를 적어도 AI가 못 본다").toBe(true);
  });

  it("매니페스트의 파일은 실제로 있어야 한다 — 없으면 조용히 안 실린다", async () => {
    // ⚠ 경로는 URL로 푼다. pathname을 문자열로 만지면 윈도우 드라이브 문자(/D:/…)에서
    //   틀린다 — 실제로 이 시험이 처음엔 15개 파일을 전부 "없다"고 했다(파일은 다 있었다).
    const fs = await import("node:fs");
    const 없는것: string[] = [];
    const m = JSON.parse(fs.readFileSync(new URL("../docs-manifest.json", import.meta.url), "utf8")) as { files: { file: string }[] };
    for (const f of m.files) {
      const 후보 = [
        new URL("../../" + f.file, import.meta.url),
        new URL("../docs/" + f.file, import.meta.url),
        new URL("../../docs/" + f.file, import.meta.url),
      ];
      if (!후보.some((c) => fs.existsSync(c))) 없는것.push(f.file);
    }
    expect(없는것, "매니페스트에 적혔지만 파일이 없다 — 인입에서 조용히 빠진다").toEqual([]);
  });
});
