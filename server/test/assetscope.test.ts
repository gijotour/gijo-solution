// ⓪ 자산 + 🗂 지금 범위 — 승인 시안 mockups/자산_0단계 (2026-08-18 구현)
//
// ⚠ 이 시험이 있는 이유 — 착수 전 검토가 **네 가지 실제 충돌**을 찾았고, 셋은 「오류도 안 나고
//   그냥 아무 일도 안 일어나는」 부류다. 그런 것은 QA도 화면 확인도 못 잡는다:
//   ① 갈아타기 표가 「전체 관리 열기」를 영영 되돌린다(무한 되돌기)
//   ② 범위가 화면만 좁히고 지시에는 안 실린다 → 화면 문구가 거짓말이 된다
//   ③ 새 화면에 안내·맥락이 없어 대화만 조용히 멍청해진다
//   ④ 판을 뺐는데 격자가 4칸 고정이라 빈칸이 남는다
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseScopeMark, stripScopeMark, SCOPE_MARK } from "../src/engine/picklist";
import { getScreenContext } from "../src/engine/screencontext";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 화면 = 읽기("../../client/src/renderer/pages/assets.html");
const nav = 읽기("../../client/src/renderer/pages/nav.js");
const 셸 = 읽기("../../client/src/renderer/pages/app.html");
const 대화창 = 읽기("../../client/src/renderer/pages/console.js");
const 루프 = 읽기("../src/engine/agentloop.ts");
const 디스패처 = 읽기("../src/engine/dispatcher.ts");
const 안내 = 읽기("../src/engine/screenguide.ts");
const 판들 = 읽기("../../client/src/renderer/pages/grouppanels.js");

describe("🗂 범위 표식 — 읽고 떼기", () => {
  it("정상 표식을 읽는다", () => {
    expect(parseScopeMark("미조치 뭐 있어?\n#범위 asset:web-01")).toEqual({ kind: "asset", id: "web-01" });
  });

  it("망가진 표식은 무시한다 — 조용히 전체로 돈다(엉뚱한 걸 걸지 않는다)", () => {
    for (const 나쁨 of ["#범위 asset", "#범위 :web-01", "#범위 asset:", "#범위 as set:web-01", "#범위 asset:web 01"]) {
      expect(parseScopeMark(`뭐 있어?\n${나쁨}`), `「${나쁨}」이 통과했다`).toBeNull();
    }
    expect(parseScopeMark("표식이 아예 없다")).toBeNull();
    // 너무 긴 id도 막는다 — 화면이 잘못 만든 것이다.
    expect(parseScopeMark(`x\n#범위 asset:${"a".repeat(201)}`)).toBeNull();
  });

  it("★ 표식만 떼고 다른 표식은 남긴다", () => {
    const t = "이것들 배정해줘\n#보는목록 a::1,b::2\n#범위 asset:web-01";
    const 남은 = stripScopeMark(t);
    expect(남은).toContain("#보는목록");
    expect(남은).not.toContain(SCOPE_MARK);
    expect(남은).toContain("이것들 배정해줘");
  });

  it("★★ 표식이 관문보다 **먼저** 떨어진다 — 안 그러면 되묻기가 안 뜬다", () => {
    // 2026-08-18에 `#보는목록`으로 똑같은 사고를 겪었다: 표식이 붙어 「두 글자 이하」가
    // 거짓이 되어 isTooVague·한낱말되묻기가 통째로 죽었다. 같은 실수를 두 번 하지 않는다.
    // ⚠ **import·주석을 호출로 세지 말 것.** 처음엔 `indexOf("한낱말되묻기")`로 봤는데
    //   :38의 import 줄이 먼저 걸려 시험이 헛실패했다(2026-08-18에 같은 함정을 두 번 밟았다 —
    //   worklogaxes에서는 함수 정의가 걸렸다). **실제 호출 꼴**만 찾는다.
    const i범위 = 디스패처.indexOf("const 지금범위 = parseScopeMark(instructionText)");
    const i막연 = 디스패처.indexOf("if (isTooVague(instructionText))");
    const i한낱말 = 디스패처.indexOf("const 낱말 = 한낱말되묻기(instructionText)");
    expect(i범위, "범위 표식을 안 뗀다").toBeGreaterThan(0);
    expect(i막연, "막연 판정 호출을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(i한낱말, "한낱말 되묻기 호출을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(i범위, "막연 판정보다 늦게 뗀다 — 되묻기가 죽는다").toBeLessThan(i막연);
    expect(i범위, "한낱말 되묻기보다 늦게 뗀다").toBeLessThan(i한낱말);
  });
});

describe("★★ 범위가 화면만이 아니라 **지시에도** 실린다", () => {
  it("대화창이 지시에 범위를 붙인다 — 안 붙이면 화면 문구가 거짓말이 된다", () => {
    // 화면엔 「대화창 지시도 이 자산 기준으로 갑니다」라고 적혀 있다.
    // 표식이 안 붙으면 담당자가 「미조치 뭐 있어?」라고 물었을 때 **전 자산 답**이 온다.
    expect(대화창, "범위를 지시에 안 싣는다").toMatch(/보낼글 \+ "\\n#범위 " \+ 범위\.kind \+ ":" \+ 범위\.id/);
    // 콕 집은 것(#고른건)이 있으면 안 붙인다 — 사람이 고른 것이 범위보다 우선이다.
    expect(대화창, "고른 것보다 범위를 우선한다").toMatch(/범위 && 범위\.id && text\.indexOf\("#고른건"\) < 0/);
  });

  it("★ 서버가 그 값을 **도구 인자로** 쓴다 — 프롬프트로 시키지 않는다", () => {
    // 「7B에 규칙을 더해 행동 교정하려 하지 말 것」은 이 저장소의 확립 원칙이다.
    expect(루프, "범위를 도구 인자에 안 입힌다").toMatch(/function 범위를입힌다\(/);
    expect(루프, "도구 인자 만드는 자리에서 안 부른다").toMatch(/const args = 범위를입힌다\(decision\.args \?\? \{\}, tool, scope\)/);
    expect(디스패처, "루프에 범위를 안 넘긴다").toMatch(/범위자산: 지금범위\.id/);
  });

  it("★★ **빠른 길(결정적 답)에서도** 범위가 먹는다", () => {
    // ⚠ 2026-08-18 실측: 범위가 `10.10.20.11`인데 「미조치 취약점 몇 건이야?」에
    //   **전체 3,008건**이 왔다. 이 경로는 agentloop를 안 타서 도구 인자 주입이 안 온다.
    //   화면엔 「대화창 지시가 이 자산 기준으로 갑니다」라고 적혀 있는데 거짓이 됐다.
    //   빠른 길일수록 이런 것이 샌다 — **갈래마다** 챙겨야 한다.
    expect(디스패처, "결정적 목록 경로에 범위를 안 넘긴다").toMatch(
      /findingListAnswer\(\s*\n?\s*instructionText,\s*\n?\s*지금범위 && 지금범위\.kind === "asset" \? 지금범위\.id : null/
    );
    const pl = 읽기("../src/engine/picklist.ts");
    expect(pl, "findingListAnswer가 범위를 안 받는다").toMatch(/export function findingListAnswer\(text = "", 걸린범위\?/);
    // ⚠ 좁혔으면 **머리줄에 적어야** 한다 — 안 적으면 그 수를 전체로 읽는다.
    expect(pl, "범위로 좁히고도 무엇으로 좁혔는지 안 적는다").toContain("(🗂 지금 범위)");
    // 문장 속 대상이 먼저다 — 화면 상태가 사람 말을 덮으면 안 된다.
    expect(pl, "문장 속 대상보다 범위를 우선한다").toMatch(/문장범위\.ids \|\| 문장범위\.못찾음 \|\| !걸린범위/);
  });

  it("★★ 자산 인자를 안 받던 도구가 이제 받는다 — 안 그러면 범위가 조용히 무시된다", () => {
    // ⚠ 2026-08-18 실측: 범위를 걸고 「미조치 취약점 몇 건이야?」를 물으니 `finding_status`가
    //   돌았는데, 그 도구는 `filter` 하나만 받아 **범위가 닿을 자리가 없었다** → 전체 3,008건.
    //   범위 배관은 다 살아 있었는데 마지막 한 칸이 없어 아무 일도 안 일어났다.
    const reg = 읽기("../src/engine/agenttools/registry.ts");
    const 구간 = reg.slice(reg.indexOf('name: "finding_status"'), reg.indexOf('name: "review_finding"'));
    expect(구간, "finding_status가 자산 인자를 안 받는다 — 범위가 조용히 무시된다").toMatch(
      /name: "assetId"[^\n]*기계전용: true/
    );
    // ⚠ **기계전용**이어야 한다 — 도구 설명을 건드리면 라우팅이 흔들린 전례가 있다(11/11 → 9/11).
    const h = 읽기("../src/engine/agenttools/handlers.ts");
    expect(h, "받은 자산을 실제로 안 쓴다").toMatch(/prioritizedReviews\(현황상한, 범위자산 \? \[범위자산\] : undefined\)/);
    // 좁혔으면 답에 밝힌다 — 감추면 전체로 읽는다.
    expect(h, "범위로 좁히고도 답에 안 밝힌다").toMatch(/범위말[\s\S]{0,200}범위 — /);
  });

  it("★★ 사람이 말한 자산을 범위가 **덮지 않는다**", () => {
    // 「범위는 web-01인데 db-02는 어때?」에서 범위가 이기면 화면 상태가 사람 말을 조용히 덮는다.
    const fn = 루프.slice(루프.indexOf("function 범위를입힌다("), 루프.indexOf("export async function runAgentLoop"));
    expect(fn, "이미 지정된 자산을 덮어쓴다").toMatch(/const 이미 = String\(args\[이름\] \?\? ""\)\.trim\(\);\s*\n\s*if \(이미\) return args;/);
    // 그 도구가 안 받는 인자를 넣으면 validateToolArgs가 「인자 오류」를 내고 도구가 죽는다.
    expect(fn, "도구가 받는 인자인지 안 본다 — 없는 인자를 넣으면 도구가 통째로 죽는다").toContain("tool.params.map");
  });
});

describe("★ 갈아타기 — 「전체 관리 열기」가 영영 되돌지 않는다", () => {
  it("inventory가 assets로 흡수된다", () => {
    expect(nav).toMatch(/"inventory\.html": "assets\.html"/);
    expect(nav).toMatch(/"inventory\.html\?embed=1": "assets\.html\?embed=1"/);
  });

  it("★★ 탈출구(hub=1)가 실제로 있고, 화면이 그것을 쓴다", () => {
    // 이게 없으면 「전체 관리 열기」→ inventory.html?embed=1 → 표가 assets로 되돌림 →
    // 담당자는 영영 관리 화면을 못 본다. **오류도 안 난다** — 같은 화면이 다시 뜰 뿐이다.
    expect(nav, "갈아타기 예외(hub=1)가 사라졌다").toMatch(/if \(!\/\[\?&\]hub=1\/\.test\(location\.search\)\)/);
    expect(화면, "전체 관리 열기가 hub=1 없이 연다 — 영영 못 간다").toContain('page: "inventory.html?hub=1"');
  });

  it("⓪ 자산이 사이드바 **맨 위**에 있다 — ① 앞이다", () => {
    const i0 = nav.indexOf('id: "assets0"');
    const i1 = nav.indexOf('id: "s1-find"');
    expect(i0, "⓪ 자산 그룹이 없다").toBeGreaterThan(0);
    expect(i0, "⓪가 ① 뒤에 있다").toBeLessThan(i1);
    expect(nav, "⓪ 화면이 안 걸려 있다").toContain('page: "assets.html"');
  });

  it("★ id를 `s0-`로 짓지 않는다 — 절차가 아니라는 것을 이름에서 드러낸다", () => {
    expect(nav, "s0-으로 지으면 다음 사람이 「왜 시험이 안 잡지」로 헤맨다").not.toMatch(/id: "s0-/);
  });
});

describe("★ 새 화면이 자기 안내와 맥락을 갖는다", () => {
  it("챗봇 안내(screenguide)에 카드가 있다", () => {
    expect(안내, "assets.html 안내 카드가 없다 — ⓘ가 빈손이 된다").toContain('"assets.html": {');
    // 「지금 범위」와 「④⑤가 왜 비었나」는 반드시 설명해야 한다 — 안 하면 결함으로 읽힌다.
    expect(안내).toMatch(/"지금 범위":/);
    expect(안내).toMatch(/"진행 현황":/);
  });

  it("★ 화면 맥락(screencontext)에 항목이 있다 — 없으면 대화가 조용히 멍청해진다", () => {
    // 화면은 멀쩡히 뜨고 오류도 안 난다. 도구 좁히기만 안 걸린다.
    const c = getScreenContext("assets.html");
    expect(c, "assets.html 맥락이 없다").toBeTruthy();
    expect(c!.toolDomains, "자산·취약점 도구가 안 붙었다").toEqual(["assets", "vuln"]);
  });

  it("화면에 지시 입력칸을 두지 않는다 — 지시는 대화창에서만", () => {
    // 목록을 좁히는 검색칸은 지시가 아니다(inventory.html:362와 같은 성격) — 그 하나만 허용.
    const 입력들 = 화면.match(/<input[^>]*>/g) || [];
    expect(입력들.length, "입력칸이 여럿이다 — 목록 좁히기 하나만 둔다").toBeLessThanOrEqual(1);
    expect(화면, "화면이 직접 서버에 지시를 보낸다").not.toMatch(/sendInstruction/);
  });
});

describe("★ 못 구한 값을 0으로 채우지 않는다", () => {
  it("④검증·⑤보고는 「—」로 비우고, 왜 비었는지 적는다", () => {
    // 0으로 적으면 「없다」는 뜻이 되어 사실과 달라진다(grouppanels.js:11의 같은 규칙).
    expect(화면, "④⑤에 숫자를 지어낸다").toMatch(/h: "④ 검증"[\s\S]{0,60}n: null/);
    expect(화면, "⑤에 숫자를 지어낸다").toMatch(/h: "⑤ 보고"[\s\S]{0,60}n: null/);
    expect(화면, "왜 비었는지 안 밝힌다 — 담당자는 결함으로 읽는다").toMatch(/④⑤가 「—」인 이유/);
  });

  it("③ 조치는 못 구하면 「—」 그대로 둔다", () => {
    expect(화면, "집계 실패 시 0으로 채운다").toMatch(/catch \(e\) \{ \/\* 못 구하면 「—」 그대로/);
  });
});

describe("★ 판을 뺐으면 빈칸이 남지 않는다", () => {
  it("발견·수집에서 자산 판·보안 태세 판이 빠졌다", () => {
    // 자산은 ⓪로, 지표는 ⑤보고로 — ①발견·수집은 「무엇이 있고 무엇이 들어왔나」만 본다.
    expect(판들, "자산 판이 아직 있다").not.toMatch(/\{ id: "assets", title: "🖥 자산"/);
    // ⚠ 「보안 태세」는 2026-08-18에는 **일부러 남겨 뒀다**(사장님 확인 전 — 승인 없이 화면을
    //   지우지 않는다). 2026-08-19에 승인을 받아 뺐고, 이 시험도 그때 뒤집었다.
    expect(판들, "보안 태세 판이 아직 있다").not.toMatch(/\{ id: "posture", title: "📊 보안 태세"/);
  });

  it("★ 화면을 지운 것이 아니라 **자리를 옮긴 것**이다 — 볼 곳이 남아 있다", () => {
    // 판을 빼면서 화면까지 못 보게 되면 그건 기능을 없앤 것이다. `kpi.html`은 ⑤보고에 그대로 있다.
    const i = 판들.indexOf("reporting: [");
    expect(i, "reporting 허브를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(판들.slice(i), "보안 지표를 볼 곳이 아무 데도 없다").toMatch(/id: "kpi", title: "[^"]*", page: "kpi\.html"/);
  });

  it("★ 허브 격자가 판 개수에 맞춰 늘어난다 — 4칸 고정이면 빈칸이 남는다", () => {
    for (const f of ["discover.html", "triage.html", "fix.html", "verify.html", "reporting.html"]) {
      const s = 읽기(`../../client/src/renderer/pages/${f}`);
      expect(s, `${f}의 격자가 4칸 고정이다 — 판 수가 다르면 빈칸이 남는다`).not.toMatch(
        /\.gh-strip\{display:grid;grid-template-columns:repeat\(4,1fr\)/
      );
      expect(s, `${f}의 격자가 auto-fit이 아니다`).toMatch(/grid-template-columns:repeat\(auto-fit,minmax\(200px,1fr\)\)/);
    }
  });
});

describe("★ 범위 배관 5고리 — 하나만 끊겨도 조용히 죽는다", () => {
  it("① 화면이 셸에 알린다 — 반드시 top으로", () => {
    // top 고정(2026-08-30 검토관 2차) — parent로 되돌아가면 허브 무대(그룹 판)에 실렸을 때
    // parent=grouphub가 gijo:scope를 릴레이하지 않아 범위 걸기가 조용히 죽는다(그날 고친 실결함).
    expect(화면).toMatch(/window\.top\.postMessage\(\{ type: "gijo:scope", scope: sc \}/);
    expect(화면, "parent 발신이 되살아나면 허브 안 범위 걸기가 다시 죽는다")
      .not.toMatch(/window\.parent\.postMessage\(\{ type: "gijo:scope", scope: sc \}/);
  });
  it("② 셸이 받는다", () => {
    expect(셸).toMatch(/d\.type === "gijo:scope"/);
  });
  it("③ 셸이 대화창에 넘긴다", () => {
    expect(셸).toMatch(/window\.gijoConsole\.scope\(sc\)/);
  });
  it("④ 셸이 **모든 열린 화면**에 퍼뜨린다 — 한 탭만 걸러지면 답이 갈린다", () => {
    expect(셸, "퍼뜨리는 함수가 없다").toMatch(/function 범위퍼뜨리기\(/);
    const 호출 = (셸.match(/^\s*범위퍼뜨리기\(sc\);\s*$/gm) || []).length;
    expect(호출, "함수만 있고 안 부른다 — 죽은 코드다").toBeGreaterThanOrEqual(1);
    // 새로 여는 탭도 받아야 한다.
    expect(셸, "새 탭에 범위를 안 먹인다 — 그 탭만 전체를 보여 준다").toMatch(/gijo:scope:set[\s\S]{0,200}지금범위\(\)|지금범위\(\)[\s\S]{0,200}gijo:scope:set/);
  });
  // (2026-08-20 승인 시안 pro-context-strip: 🗂 알약 → 맥락 문장 한 줄(.cs-line)의 파란
  //  강조(.rk)로 흡수. 계약의 뜻 — 「범위가 보이고, 지시에 실리고, 푸는 길이 있다」 — 은 그대로다.)
  it("⑤ 대화창이 그리고, 지시에 싣는다", () => {
    expect(대화창, "문장에 범위 강조(.rk)를 안 넣는다").toContain('<b class="rk">');
    expect(대화창, "외부에서 범위를 걸 통로가 없다").toMatch(/scope: setScope/);
    expect(대화창, "범위 푸는 길(⋯ 메뉴)이 없다").toContain("범위 풀기");
  });

  it("★ 🎯(고른 한 건)과 🗂(범위)를 **다른 색**으로 둔다", () => {
    // 수명이 반대인 둘을 같은 색으로 두면 「아까 푼 줄 알았는데 아직 걸려 있네」를 겪는다.
    expect(대화창, "범위 강조(.rk)가 파랑이 아니다").toMatch(/\.cs-line \.rk\{color:var\(--blue/);
    expect(대화창, "선택 강조(.sk)가 주황이 아니다 — 두 강조 색이 같아졌다").toMatch(/\.cs-line \.sk\{color:var\(--amber/);
  });

  it("★★ 되살린 범위를 **그린다** — 값만 살고 안 보이면 함정이 된다", () => {
    // 2026-08-18 실화면: 새로고침 뒤 값은 살아 지시에 실리는데 표시가 안 떴다.
    // 담당자는 범위가 풀린 줄 알고 묻고, 답이 왜 적은지 모른다. 보이지 않는 범위는
    // 범위가 아니라 함정이다. 문장 줄을 만든 직후(build 끝) 반드시 다시 그려야 한다.
    expect(대화창, "되살린 범위를 안 그린다").toMatch(
      /csCtxMore"\)\.addEventListener[\s\S]{0,4000}?\n\s*renderScope\(\);/
    );
  });

  it("★ 화면 전환 시 지우는 자리를 손대지 않았다 — 🎯와 🗂은 다른 변수다", () => {
    // setSelection(null)은 🎯 전용이다. 범위까지 지우면 「화면을 옮겨도 남는다」가 깨진다.
    expect(대화창, "범위가 화면 전환에 지워진다").not.toMatch(/setScope\(null\)[^\n]*ctx\.screen/);
    expect(대화창, "범위를 별도 변수로 안 둔다").toMatch(/var 범위 = null;/);
  });
});
