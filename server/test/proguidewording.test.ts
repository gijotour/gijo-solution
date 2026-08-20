// 🚀 프로 셸에서 챗봇이 **없는 곳을 가리키지 않는다** (사장님 지시 2026-08-19)
//
// ■ 왜
//   길찾기 안내가 「**취약점** — 사이드바 ② 우선순위 안에 있습니다」라고 답한다.
//   그런데 프로 셸에는 **사이드바가 없다**(56px 레일 + 호출식 ☰ 전체 메뉴).
//   그대로 두면 챗봇이 없는 UI를 가리키고, 담당자는 그 자리를 찾다 못 찾는다.
//
// ■ 어떻게 — **낱말 하나를 파라미터로**
//   프로용 안내표(PRO_OVERVIEW)를 따로 만들지 않는다. 라이트는 **없는 기능**을 설명해야 해서
//   LITE_OVERVIEW가 옳았지만, 프로는 도구도 화면도 스탠다드와 **완전히 같다** — 다른 건
//   「사이드바」라는 낱말뿐이다. 표를 복제하면 screenguide.ts가 스스로 경고한
//   「서버가 그 목록을 베끼면 반드시 어긋난다」를 되풀이한다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { 화면위치안내 } from "../src/engine/screenguide";
import { parseShellMark, stripShellMark, SHELL_MARK, ALL_MARKS, stripPickMarks } from "../src/engine/picklist";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const 안내 = 읽기("../src/engine/screenguide.ts");
const 디스패처 = 읽기("../src/engine/dispatcher.ts");
const 대화창 = 읽기("../../client/src/renderer/pages/console.js");

describe("길찾기 안내 — 셸에 맞는 자리를 말한다", () => {
  it("표준은 예전 그대로 「사이드바」라고 말한다", () => {
    const s = 화면위치안내("triage.html", "우선순위");
    expect(s, "표준 안내가 바뀌었다 — 옛 호출부가 전부 달라진다").toContain("사이드바");
    expect(s).not.toContain("☰ 전체 메뉴");
  });

  it("★ 프로는 「☰ 전체 메뉴」라고 말한다 — 없는 사이드바를 가리키지 않는다", () => {
    const s = 화면위치안내("triage.html", "우선순위", true);
    expect(s, "프로인데 사이드바를 가리킨다 — 거기 없다").not.toContain("사이드바");
    expect(s, "프로에서 갈 곳을 안 알려 준다").toContain("☰ 전체 메뉴");
  });

  it("★ 절차 화면이 아닌 것도 셸에 맞게 말한다", () => {
    // 「사이드바 메뉴에서 찾을 수 있습니다」 갈래도 함께 바뀌어야 한다 — 한쪽만 고치면 절반이 샌다.
    const 표준 = 화면위치안내("settings.html", "설정");
    const 프로 = 화면위치안내("settings.html", "설정", true);
    expect(표준).toContain("사이드바");
    expect(프로, "비-절차 화면 갈래가 안 바뀌었다").not.toContain("사이드바");
  });

  it("★★ **말이 되는 문장**이어야 한다 — 낱말만 갈아 끼우면 겹친다", () => {
    // ⚠ 2026-08-19 실제 응답에서 드러났다: 낱말 하나만 바꿨더니
    //   「☰ 전체 메뉴**의 메뉴**에서 찾을 수 있습니다」가 됐다.
    //   앞선 시험은 「사이드바가 없나 · 전체 메뉴가 있나」만 봐서 **통과했다** —
    //   낱말 유무가 아니라 **문장**을 봐야 잡힌다.
    for (const [screen, title] of [["settings.html", "설정"], ["triage.html", "우선순위"]] as const) {
      for (const pro of [false, true]) {
        const s = 화면위치안내(screen, title, pro);
        expect(s, `${screen}(pro=${pro})에서 「메뉴」가 겹친다`).not.toMatch(/메뉴의?\s*메뉴/);
        expect(s, `${screen}(pro=${pro})에서 조사가 겹친다`).not.toMatch(/의\s*의|에서\s*에서/);
      }
    }
    // 프로의 비-절차 안내는 **어디를 눌러야 하는지**까지 말한다(레일 ☰ 또는 Ctrl+K).
    expect(화면위치안내("settings.html", "설정", true)).toMatch(/왼쪽 레일 맨 위 ☰ 또는 Ctrl\+K/);
  });

  it("★ 기본값이 false다 — 인자를 안 넘기는 옛 호출부가 그대로 돈다", () => {
    // 이 기본값 덕분에 기존 시험(screen-where)이 「사이드바」를 찾는 것도 그대로 통과한다.
    expect(안내, "기본값이 없어 옛 호출부가 깨진다").toMatch(/화면위치안내\(screen: string, title: string, pro = false\)/);
  });

  it("★ 프로용 안내표를 **따로 만들지 않았다** — 표를 복제하면 어긋난다", () => {
    // ⚠ **주석을 세지 말 것.** 「PRO_OVERVIEW 같은 것을 만들지 않는다」고 적은 주석 자신이
    //   걸려 헛실패했다(2026-08-19). 오늘만 세 번째로 밟은 함정이라 규칙을 코드에 남긴다:
    //   **감시 정규식은 언제나 주석을 걷고 본다.**
    const 코드만 = 안내
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    expect(코드만, "프로용 안내표 사본을 만들었다").not.toMatch(/PRO_OVERVIEW|PRO_GUIDES/);
  });
});

describe("★ 자리를 못박은 다른 문장들도 프로에서 참이다", () => {
  it("문서 작성이 「사이드바」로 못박혀 있지 않다 (문서함은 2026-08-20 내 문서 허브에 흡수)", () => {
    // 프로에서 자리 이름이 다르다 — **왼쪽 아래(레일)와 ☰ 전체 메뉴**.
    // 문서함 창은 흡수돼 안내 자체가 mydocs.html로 갔다 — 옛 창 안내가 되살아나면 잡는다.
    expect(안내, "지워진 문서함 창 안내가 되살아났다 — 자리는 내 문서 📘 탭이다").not.toMatch(/"docbox\.html":\s*\{/);
    expect(안내, "문서 작성 안내가 사이드바를 못박는다").not.toMatch(/사이드바 '📝 문서 작성/);
  });

  it("「내 이름 옆」으로 자리를 못박지 않는다 — 프로 레일은 이름을 숨긴다", () => {
    // 검토관 중7(2026-08-20): 프로 셸 레일(56px)은 이름을 숨겨(titlebar nm 숨김) 「내 이름 옆」이
    // 거짓이 된다. 두 셸에서 참인 말(「계정 줄」)로 적는다.
    expect(안내, "「내 이름 옆」 자리 못박기가 되살아났다").not.toMatch(/내 이름 옆/);
  });

  it("★ 남은 「사이드바」는 **주석과 파라미터 갈래**뿐이다", () => {
    // 사용자에게 나가는 글에 사이드바가 못박혀 있으면 프로에서 거짓이 된다.
    const 줄들 = 안내.split("\n");
    const 샌것 = 줄들
      .map((l, i) => ({ l, no: i + 1 }))
      .filter(({ l }) => /사이드바/.test(l))
      .filter(({ l }) => !/^\s*(\/\/|\*)/.test(l))                 // 주석 제외
      // 셸에 따라 갈리는 자리는 정상이다 — 삼항의 **표준 쪽 가지**가 「사이드바」라고 말한다.
      //   그 두 줄은 `: \`사이드바 …\`` / `: "사이드바 …"` 꼴로 콜론에서 시작한다.
      .filter(({ l }) => !/^\s*:\s*[`"]사이드바/.test(l));
    expect(샌것.map((x) => `${x.no}: ${x.l.trim().slice(0, 70)}`), "고객이 읽는 글에 사이드바가 못박혀 있다").toEqual([]);
  });
});

describe("★ 신호가 실제로 서버까지 온다 (5고리)", () => {
  it("① 표식을 읽고 뗀다", () => {
    expect(parseShellMark("뭐야?\n#셸 pro")).toBe("pro");
    expect(parseShellMark("뭐야?"), "표식이 없는데 프로로 본다").toBeNull();
    expect(parseShellMark("뭐야?\n#셸 lite"), "모르는 값을 프로로 본다").toBeNull();
    expect(stripShellMark("뭐야?\n#셸 pro")).toBe("뭐야?");
  });

  it("★★ ② 표식이 **기록에서 자동으로 떨어진다** — 안 넣으면 담당자 대화에 남는다", () => {
    // 2026-08-18에 `#범위`로 똑같이 겪었다: 목록에 안 넣어 「자산 몇 개야? #범위 asset:…」이
    // 그대로 저장됐다. 새 표식을 만들 때마다 반복되므로 목록 대조를 시험이 센다.
    expect((ALL_MARKS as readonly string[]).includes(SHELL_MARK), "제거 목록에 #셸이 없다").toBe(true);
    expect(stripPickMarks("취약점 어디 있어?\n#셸 pro")).toBe("취약점 어디 있어?");
  });

  it("③ 대화창이 프로일 때 표식을 붙인다", () => {
    expect(대화창, "프로 신호를 안 보낸다").toMatch(/보낼글 \+ "\\n#셸 pro"/);
    // 별도 창(대화창을 빼낸 상태)에서도 알아야 한다 — 셸 문서를 못 보면 주소로 확인한다.
    expect(대화창, "별도 창에서 프로를 못 알아본다").toMatch(/shell=pro\(&\|\$\)\/\.test\(location\.search\)/);
  });

  it("④ dispatcher가 읽어 안내에 넘긴다", () => {
    expect(디스패처, "셸 표식을 안 읽는다").toMatch(/const 지금셸 = parseShellMark\(instructionText\)/);
    expect(디스패처, "안내에 셸을 안 넘긴다 — 문구가 그대로 사이드바다").toMatch(
      /화면위치안내\(찾는화면\.screen, 찾는화면\.title, 지금셸 === "pro"\)/
    );
  });

  it("★ ⑤ 표식을 관문보다 **먼저** 뗀다 — 안 떼면 되묻기가 죽는다", () => {
    // `#보는목록`으로 이미 겪은 사고다: 표식이 붙어 「두 글자 이하」가 거짓이 되어
    // isTooVague·한낱말되묻기가 통째로 안 걸렸다.
    const i셸 = 디스패처.indexOf("const 지금셸 = parseShellMark(instructionText)");
    const i막연 = 디스패처.indexOf("if (isTooVague(instructionText))");
    const i한낱말 = 디스패처.indexOf("const 낱말 = 한낱말되묻기(instructionText)");
    expect(i셸).toBeGreaterThan(0);
    expect(i막연, "막연 판정 호출을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(i셸, "막연 판정보다 늦게 뗀다").toBeLessThan(i막연);
    expect(i셸, "한낱말 되묻기보다 늦게 뗀다").toBeLessThan(i한낱말);
  });
});
