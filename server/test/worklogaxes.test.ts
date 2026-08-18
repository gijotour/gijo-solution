// 작업 내역 구분 3축 — 승인 시안 mockups/작업내역_구분 (2026-08-18 구현)
//
// ⚠ 이 시험이 있는 이유 — 「전부 남긴다」가 **세 번** 터졌고 셋 다 예외 목록으로 막았다:
//   ① 로그인 기록 도배 ② 같은 일이 두 번 ③ 스스로를 먹는 고리(2,100건을 지워도 총계 824건 그대로)
//   예외 목록은 행위가 늘 때마다 새로 샌다. 축은 그 구조를 바꾼 것이라, **축이 조용히
//   안 채워지면 옛 구조로 돌아간 것과 같다** — 그런데 화면은 멀쩡해 보인다. 시험만 잡는다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import {
  createSession, markSession, getSession, listSessionsFiltered, appendTurn,
} from "../src/engine/worksessions";
import { db } from "../src/db";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 화면 = 읽기("../../client/src/renderer/pages/sessions.html");
const 디스패처 = 읽기("../src/engine/dispatcher.ts");
const 엔진 = 읽기("../src/engine/worksessions.ts");

beforeEach(() => {
  db.exec("DELETE FROM work_session_turns; DELETE FROM work_sessions;");
});

describe("작업 내역 구분 — 저장", () => {
  it("축을 주면 그대로 저장되고 다시 읽힌다", () => {
    const s = createSession("테스트", undefined, "홍길동", {
      origin: "user", opKind: "action", qa: false,
      fold: { asset: "web-01", target: "CVE-2020-1472", act: "완료 처리", result: "재스캔 확인" },
    });
    const got = getSession(s.id)!;
    expect(got.origin).toBe("user");
    expect(got.opKind).toBe("action");
    expect(got.qa).toBe(false);
    expect(got.fold?.asset).toBe("web-01");
    expect(got.fold?.result).toBe("재스캔 확인");
  });

  it("★ 축을 안 주면 **비워 둔다** — 모르는 값을 추측해 채우지 않는다", () => {
    // 구분이 생기기 전에 쌓인 기록이 바로 이 모양이다. 여기서 한쪽으로 몰면
    // 「시스템이 한 일을 담당자가 한 것으로」 지어내거나, 옛 기록을 통째로 숨기게 된다.
    const s = createSession("옛 기록");
    const got = getSession(s.id)!;
    expect(got.origin).toBeUndefined();
    expect(got.opKind).toBeUndefined();
    expect(got.fold).toBeUndefined();
    expect(got.qa).toBe(false);
  });

  it("★ 실행이 조회를 이긴다 — 한 세션에서 묻다가 바꿨으면 「바꾼 일」이다", () => {
    const s = createSession("혼합");
    markSession(s.id, { origin: "user", opKind: "query", fold: { q: "몇 개야?", a: "3개" } });
    expect(getSession(s.id)!.opKind).toBe("query");
    markSession(s.id, { origin: "user", opKind: "action", fold: { asset: "web-01", act: "완료 처리" } });
    expect(getSession(s.id)!.opKind, "실행이 조회에 덮여 사라졌다").toBe("action");
    // 되돌아가지도 않는다.
    markSession(s.id, { origin: "user", opKind: "query" });
    expect(getSession(s.id)!.opKind, "실행이 조회로 내려갔다").toBe("action");
  });

  it("QA 표시는 한 번 켜지면 안 꺼진다 — 시험이 실사용으로 둔갑하면 안 된다", () => {
    const s = createSession("게이트");
    markSession(s.id, { qa: true });
    markSession(s.id, { qa: false });
    expect(getSession(s.id)!.qa, "QA 표시가 꺼져 실사용으로 섞였다").toBe(true);
  });
});

describe("작업 내역 구분 — 목록", () => {
  const 만들기 = (n: string, m: Parameters<typeof createSession>[3]) => {
    const s = createSession(n, undefined, "테스터", m);
    appendTurn(s.id, "user", n);
    return s;
  };

  it("★ 기본은 담당자가 시킨 일 — 시스템 기록은 접힌다", () => {
    만들기("내가 한 일", { origin: "user", opKind: "action" });
    만들기("시스템이 한 일", { origin: "system", opKind: "action" });
    const r = listSessionsFiltered(100);
    expect(r.items.map((s) => s.title)).toEqual(["내가 한 일"]);
    expect(r.hidden.system, "시스템 기록이 안 걸러졌다").toBe(1);
  });

  it("★★ 구분 이전 기록은 **어느 축에서도 안 사라진다**", () => {
    // 이게 무너지면 담당자는 「내 기록이 날아갔다」고 읽는다. 축은 정리하려고 넣은 것이지
    // 지우려는 게 아니다 — 시안이 다루지 않은 자리라 구현에서 정한 계약이다.
    만들기("옛 기록", undefined);
    만들기("내가 한 일", { origin: "user", opKind: "action" });
    만들기("시스템", { origin: "system", opKind: "action" });
    for (const f of [{}, { origin: "user" as const }, { opKind: "query" as const }, { origin: "system" as const }]) {
      const r = listSessionsFiltered(100, f);
      expect(r.items.map((s) => s.title), `필터 ${JSON.stringify(f)}에서 옛 기록이 사라졌다`).toContain("옛 기록");
    }
  });

  it("★ QA는 기본으로 숨고, 토글하면 나온다", () => {
    만들기("실사용", { origin: "user", opKind: "action" });
    만들기("게이트가 만든 것", { origin: "user", opKind: "action", qa: true });
    const 기본 = listSessionsFiltered(100);
    expect(기본.items.map((s) => s.title)).toEqual(["실사용"]);
    expect(기본.hidden.qa).toBe(1);
    const 포함 = listSessionsFiltered(100, { includeQa: true });
    expect(포함.items.map((s) => s.title).sort()).toEqual(["게이트가 만든 것", "실사용"]);
    expect(포함.hidden.qa).toBe(0);
  });

  it("★ 숨긴 건수와 보이는 목록이 **같은 모집단**에서 나온다", () => {
    // 다른 모집단끼리 빼면 「3건 감춰짐」인데 실제로는 5건이 빠진 상황이 생긴다.
    만들기("A", { origin: "user", opKind: "action" });
    만들기("B", { origin: "system", opKind: "action" });
    만들기("C", { origin: "system", opKind: "query" });
    만들기("D", undefined);
    const r = listSessionsFiltered(100);
    expect(r.items.length + r.hidden.total, "보인 것 + 감춘 것이 전체와 다르다").toBe(r.counts.all);
  });

  it("칩 숫자가 실제 건수와 맞는다 — 구분 이전도 센다", () => {
    만들기("u1", { origin: "user", opKind: "action" });
    만들기("u2", { origin: "user", opKind: "query" });
    만들기("s1", { origin: "system", opKind: "action" });
    만들기("old", undefined);
    const c = listSessionsFiltered(100, { origin: "all" }).counts;
    expect(c).toMatchObject({ user: 2, system: 1, unmarked: 1, action: 2, query: 1, qa: 0, all: 4 });
  });

  it("옛 통로(listSessions)는 **배열 그대로** — 다른 곳이 조용히 깨지지 않게", () => {
    만들기("아무거나", { origin: "system", opKind: "action" });
    // report.ts·에이전트 도구가 이 모양을 기대한다. 기본 필터도 안 걸린다(전부 준다).
    const arr = listSessionsFiltered(100, { origin: "all", opKind: "all", includeQa: true }).items;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);
  });
});

describe("작업 내역 구분 — 배관이 살아 있나", () => {
  it("★ 감사 훅이 축을 채운다 — 안 채우면 옛 구조로 돌아간 것이다", () => {
    expect(엔진, "onAudit이 origin을 안 정한다").toMatch(/const origin: SessionOrigin =/);
    expect(엔진, "onAudit이 createSession에 축을 안 넘긴다").toMatch(
      /createSession\(title, undefined, e\.actor \?\? "시스템", \{ origin, opKind: "action", fold \}\)/
    );
  });

  it("★ 주체 판정을 **행위 이름으로 하지 않는다** — 그게 두더지 잡기의 재발이다", () => {
    // actor(누가) 하나로 갈라야 행위가 늘어도 안 샌다. 행위 이름 정규식으로 가르면
    // 새 도구가 생길 때마다 또 새는, 이 시안이 걷어내려던 그 구조로 되돌아간다.
    const 훅 = 엔진.slice(엔진.indexOf("onAudit((e) =>"),엔진.indexOf("// ── 30분 무대화"));
    expect(훅, "주체를 actor가 아니라 행위 이름으로 가른다").not.toMatch(/origin[^\n]*e\.action/);
    expect(훅).toMatch(/e\.actor && e\.actor !== "scheduler"/);
  });

  it("★ 대화창 지시도 축이 붙는다 — dispatcher가 markSession을 부른다", () => {
    const 호출 = (디스패처.match(/^[ \t]*try \{ markSession\(session\.id, 세션축\(/gm) || []).length;
    expect(호출, "대화 세션에 축이 안 붙는다 — 화면에서 전부 「구분 이전」으로 보인다").toBeGreaterThanOrEqual(1);
    expect(디스패처, "세션축 함수가 없다").toMatch(/function 세션축\(/);
  });

  it("★★ 실행/조회를 **낱말이 아니라 쓰기 선언으로** 가른다", () => {
    // "바꿔줘"·"해줘" 같은 말로 가르면 새 표현마다 샌다. registry의 write 선언이 단일 출처다.
    const fn = 디스패처.slice(디스패처.indexOf("function 세션축("));
    expect(fn, "쓰기 도구 선언을 안 본다").toContain("findAgentTool(c.tool)?.write === true");
    expect(fn, "결재판(쓰기 대기)을 실행으로 안 본다").toContain("Boolean(result.approval)");
    expect(fn, "낱말로 실행을 판정한다").not.toMatch(/지시문[^\n]{0,40}(includes|test)\([^\n]*("해줘"|"바꿔")/);
  });

  it("★★ 접힌 한 줄은 AI가 새로 쓴 문장이 아니다 — 값 조합이다", () => {
    // 여기서 LLM을 부르면 요약 오류가 되짚기 전체를 오염시킨다(recentTurnsText의 같은 판단).
    const fn = 디스패처.slice(디스패처.indexOf("function 세션축("), 디스패처.indexOf("function 세션축(") + 2200);
    expect(fn, "접힌 줄을 만들며 모델을 부른다").not.toMatch(/await\s+(chat|llm|generate|complete)\(/);
    expect(엔진, "감사 훅이 접힌 줄을 만들며 모델을 부른다").not.toMatch(/fold[\s\S]{0,200}await\s+chat\(/);
  });

  it("★ 화면이 축을 그리고, 숨긴 건수를 **적는다**", () => {
    for (const v of ["user", "system", "all"]) expect(화면, `주체 칩 ${v}가 없다`).toContain(`data-axis="origin" data-v="${v}"`);
    for (const v of ["action", "query", "all"]) expect(화면, `종류 칩 ${v}가 없다`).toContain(`data-axis="opKind" data-v="${v}"`);
    expect(화면, "QA 토글이 없다").toContain('id="qaToggle"');
    // 「감췄으면 감췄다고 보인다」 — 이 줄이 없으면 기본이 좁아진 화면에서 기록이 사라진 것처럼 보인다.
    expect(화면, "숨긴 건수를 적는 자리가 없다").toContain('id="hiddenNote"');
    expect(화면, "숨긴 건수를 실제로 안 채운다").toMatch(/감춰짐 — 위 칩을 눌러 펼칠 수 있습니다/);
    expect(화면, "구분 이전 기록을 안 알린다").toMatch(/구분이 생기기 전[^\n]*그대로 보입니다/);
  });

  it("★ 화면이 축 전용 통로로 부른다 — 안 그러면 숨긴 건수를 못 받는다", () => {
    expect(화면, "축 통로를 안 쓴다").toContain("listWorkSessionsWithAxes");
    // 옛 판(다리 없는 preload)에서도 화면이 죽지 않아야 한다.
    expect(화면, "옛 판 대비가 없다 — 다리가 없으면 목록이 통째로 안 뜬다").toMatch(
      /if \(window\.gijo\.listWorkSessionsWithAxes\)[\s\S]{0,400}else[\s\S]{0,200}listWorkSessions\(\)/
    );
  });

  it("기본값이 시안대로다 — 주체=내가 · 종류=전체 · QA=숨김", () => {
    expect(화면, "기본 축이 시안과 다르다").toMatch(/const 축 = \{ origin: "user", opKind: "all", qa: false \}/);
  });

  it("★ 스스로를 먹는 고리 차단은 **그대로 둔다** — 축은 표시 문제, 고리는 생성 문제다", () => {
    // 세션 삭제 → 감사 → 새 세션 → 또 삭제…는 축으로 안 막힌다(만들어지는 것 자체가 문제).
    // 축을 넣었다고 이 방어를 걷으면 2026-07-27의 「2,100건을 지워도 824건」이 재발한다.
    expect(엔진, "자기참조 고리 차단이 사라졌다").toContain("SESSION_SELF_ACTION_RE");
    expect(엔진, "자기참조 차단을 실제로 안 쓴다").toMatch(/if \(SESSION_SELF_ACTION_RE\.test\(e\.action\)\) return;/);
  });
});
