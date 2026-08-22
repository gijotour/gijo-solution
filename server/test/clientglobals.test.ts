// 화면이 **있지도 않은 함수**를 부르고 있지 않은지 전수 대조한다.
//
// ⚠ 실사고(2026-07-31, 사용자 신고 "복구 열쇠 재발급 메뉴 클릭이 안 되는데"):
//   settings.html이 `window.gijoDialog.confirm(...)`을 불렀는데 **gijoDialog는 이 제품에
//   존재하지 않았다.** 저장소를 통틀어 그 한 줄만 그 이름을 썼다. 버튼을 누르면 TypeError로
//   죽고 **아무 일도 일어나지 않는다** — 화면은 멀쩡히 보이고 버튼도 눌리는데 반응만 없다.
//
//   왜 못 잡았나:
//     · 타입 검사 — window.* 는 any라 통과한다
//     · 스윕(menu-sweep) — 화면이 렌더되는지만 본다. 버튼을 눌러 보지 않는다
//     · 실화면 검증 — 그 버튼을 안 눌러 봤다(admin 파괴적 동작이라 자동으로 누르기 조심스럽다)
//   그래서 **부르는 이름과 노출된 이름을 대조**한다. 누르지 않고도 잡힌다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);
const preloadSrc = fs.readFileSync(new URL("../../client/src/preload.ts", import.meta.url), "utf8");
const pageFiles = fs.readdirSync(pagesDir).filter((f) => /\.(html|js)$/.test(f));
const pageSrc = new Map(pageFiles.map((f) => [f, fs.readFileSync(new URL(f, pagesDir), "utf8")]));

describe("화면이 부르는 window.gijo.* 는 preload가 실제로 노출한 것이어야 한다", () => {
  // preload의 최상위 키(2칸 들여쓰기 `name:`)를 노출 목록으로 본다.
  const 노출 = new Set([...preloadSrc.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));

  it("노출 목록을 실제로 읽어 온다 — 못 읽으면 이 시험이 거짓 통과다", () => {
    expect(노출.size).toBeGreaterThan(100);
    expect(노출.has("me")).toBe(true);
    expect(노출.has("navigateTo")).toBe(true);
  });

  it("없는 함수를 부르는 화면이 없다", () => {
    const 없는것: string[] = [];
    for (const [file, src] of pageSrc) {
      for (const m of src.matchAll(/window\.gijo\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (!노출.has(m[1])) 없는것.push(`${file}: window.gijo.${m[1]}`);
      }
    }
    expect([...new Set(없는것)], "부르면 TypeError로 죽는다 — 버튼이 조용히 안 먹는다").toEqual([]);
  });
});

describe("window.gijo* 전역은 정의된 것만 쓴다", () => {
  // gijoDialog처럼 **아예 존재하지 않는 전역**을 부르는 것을 잡는다.
  // 노출 경로는 두 가지다: preload의 exposeInMainWorld, 또는 화면 스크립트의 window.X = ...
  const 정의 = new Set<string>(["gijo"]);
  for (const m of preloadSrc.matchAll(/exposeInMainWorld\(\s*["']([A-Za-z0-9_]+)["']/g)) 정의.add(m[1]);
  for (const src of pageSrc.values()) {
    for (const m of src.matchAll(/window\.(gijo[A-Za-z0-9_]*)\s*=/g)) 정의.add(m[1]);
  }

  it("노출 경로를 실제로 읽어 온다", () => {
    expect(정의.has("gijoRealtime"), "preload의 exposeInMainWorld를 못 읽었다").toBe(true);
  });

  it("정의되지 않은 window.gijo* 를 부르지 않는다", () => {
    const 미정의: string[] = [];
    for (const [file, src] of pageSrc) {
      // 주석 줄은 뺀다 — 사고 이력을 주석에 적어 두는 것이 이 저장소의 관례다.
      const 코드 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
      for (const m of 코드.matchAll(/window\.(gijo[A-Za-z0-9_]*)\s*\./g)) {
        if (!정의.has(m[1])) 미정의.push(`${file}: window.${m[1]}`);
      }
    }
    expect([...new Set(미정의)], "이 전역은 어디에도 없다 — 부르는 순간 TypeError").toEqual([]);
  });
});

describe("Electron에서 네이티브 모달을 쓰지 않는다", () => {
  // ⚠ window.confirm/alert/prompt는 Electron에서 **OS 네이티브 모달**이라 렌더러가 통째로
  //   멈춘다. 사람이 직접 누르기 전까지 아무것도 못 하고 자동화는 닫지도 못한다
  //   (2026-07-29 실측: Playwright "No dialog is showing"으로 QA가 로그인을 통과 못 했다).
  //   확인은 **화면 안에서** 묻는다.
  it("확인·입력 창을 네이티브로 띄우지 않는다", () => {
    const 위반: string[] = [];
    for (const [file, src] of pageSrc) {
      const 코드 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
      // ⚠⚠ **`window.` 없는 맨 `confirm(`도 잡는다**(2026-08-18에 밟음).
      //   예전엔 `\bwindow\.(confirm|prompt)\(`만 봤는데, 실제 코드는 전부 `window.` 없이
      //   맨 `confirm(`이었다 — 그래서 **10곳이 살아 있는데 이 시험은 초록이었다.**
      //   하필 걸린 자리가 에디션 전환 3버튼·원격 GPU 켜기라, 그 버튼을 누르면 화면이 얼었다.
      //   `foo.confirm(`·`gijoConfirm(`은 아니므로 앞 글자가 `.`나 낱말이면 뺀다.
      for (const m of 코드.matchAll(/(?<![.\w])(?:window\s*\.\s*)?(confirm|prompt|alert)\s*\(/g)) {
        위반.push(`${file}: ${m[1]}()`);
      }
    }
    expect([...new Set(위반)].join("\n"), "Electron에서 렌더러가 멈춘다 — 화면 안에서 물을 것(gijoAsk·gijoTell·gijoPrompt)").toBe("");
  });

  it("헛돎 방지 — 정규식이 맨 confirm을 정말 잡는가", () => {
    // ⚠ 위 검사가 「0건」인 것이 **정말 없어서**인지 **못 봐서**인지 가른다.
    //   이 저장소는 늘 빨간불인 시험을 증거라고 우긴 전례가 있다 — 그 반대도 막는다.
    const re = /(?<![.\w])(?:window\s*\.\s*)?(confirm|prompt|alert)\s*\(/g;
    const 잡아야 = ['if (!confirm("지울까요?")) return;', "window.confirm('x')", "  alert('hi')", "if(!prompt('a'))"];
    for (const s of 잡아야) expect([...s.matchAll(re)].length, `못 잡는다: ${s}`).toBeGreaterThan(0);
    const 잡으면안됨 = ["gijoConfirm('x')", "await gijoAsk('x')", "dlg.confirm('x')", "myAlert('x')", "reconfirm('x')"];
    for (const s of 잡으면안됨) expect([...s.matchAll(re)].length, `잘못 잡는다: ${s}`).toBe(0);
  });

  it("gijoAsk·gijoTell·gijoPrompt를 쓰는 화면은 dialog.js가 실려 있다", () => {
    // ⚠ 2026-08-18에 밟음: 라이트 화면 둘은 **nav.js를 안 실어서** gijoAsk가 저절로 안 온다.
    //   (표준 화면은 nav.js의 loadDialog()가 동적으로 실어 준다.)
    //   안 싣고 부르면 **TypeError로 버튼이 조용히 죽는다** — 네이티브 모달을 없애려다
    //   버튼 자체를 없애는 꼴이 된다.
    const 위반: string[] = [];
    for (const [file, src] of pageSrc) {
      if (!/\.html$/.test(file)) continue;
      const 코드 = src.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
      if (!/\bgijo(Ask|Tell|Prompt)\s*\(/.test(코드)) continue;
      // ⚠⚠ **`<script src=` 태그 모양으로 본다**(2026-08-18 회귀 — 5.24.0에 실려 나갔다).
      //   예전엔 원본 글자에서 그냥 `nav.js`를 찾았는데, `lite-app.html`은 **주석에
      //   「lite-nav.js」**가 적혀 있어 그대로 통과했다. 실제로는 스크립트를 하나도 안 실어
      //   `gijoTell`이 undefined였고 **버튼 3개가 눌러도 아무 일도 안 일어났다.**
      //   「있다고 적힌 것」이 아니라 **「실제로 싣는 태그」**를 봐야 한다.
      const 싣는것 = [...src.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);
      // 직접 싣거나(dialog.js), nav.js 계열을 실어 그것이 실어 주거나 — 둘 중 하나면 된다.
      // ⚠ `lite-nav.js`는 dialog.js를 안 실어 준다(공용 nav.js만 loadDialog를 갖는다).
      if (!싣는것.some((s) => /(^|\/)dialog\.js$/.test(s) || /(^|\/)nav\.js$/.test(s))) 위반.push(file);
    }
    expect(위반.join(", "), "이 화면들은 gijoAsk를 부르는데 dialog.js도 nav.js도 안 싣는다 — 버튼이 조용히 죽는다").toBe("");
  });
});

describe("★ 없는 화면으로 보내지 않는다", () => {
  // 같은 계열의 사고다: 부르는 이름이 실제로 있는지 아무도 대조하지 않는다.
  //   · howto.ts — 8개 안내 중 **5개가 없는 화면**을 가리켰다(2026-07-31)
  //   · kpi.html 「지금 손댈 일」 — 첫 구현에서 6개 중 5개가 틀렸다(2026-08-01)
  // 버튼은 멀쩡히 눌리고 아무 일도 안 일어난다. 파일 목록과 맞춰 보면 누르지 않고 잡힌다.
  const 있는화면 = new Set(pageFiles.filter((f) => f.endsWith(".html")));

  it("data-page가 가리키는 화면이 전부 실재한다", () => {
    const 없음: string[] = [];
    for (const [file, src] of pageSrc) {
      for (const m of src.matchAll(/data-page=["']([a-z0-9_-]+\.html)["']/gi)) {
        if (!있는화면.has(m[1])) 없음.push(`${file} → ${m[1]}`);
      }
      // '문자열 조립' 형태(page: "x.html")도 본다 — 표에 적어 두고 배선하는 방식이 흔하다.
      for (const m of src.matchAll(/\bpage:\s*["']([a-z0-9_-]+\.html)["']/gi)) {
        if (!있는화면.has(m[1])) 없음.push(`${file} → ${m[1]}`);
      }
    }
    expect([...new Set(없음)], "눌러도 아무 일이 없는 버튼이다").toEqual([]);
  });

  it("서버가 안내하는 화면(howto·screenguide)도 실재한다", () => {
    const 서버 = ["../src/engine/howto.ts", "../src/engine/screenguide.ts"]
      .map((p) => new URL(p, import.meta.url))
      .filter((u) => fs.existsSync(u));
    const 없음: string[] = [];
    for (const u of 서버) {
      // ⚠ **주석은 걷어내고 본다**(2026-08-22). 화면을 없애면서 그 자리에 「왜 없앴나」를 적으면
      //   그 설명 안의 파일 이름이 **살아 있는 안내로 오인**돼 실패한다 — 기록을 남긴 주석이
      //   시험에 밀려 지워지는 건 손해다. 같은 실수를 이 파일 위쪽 시험에서도 한 번 겪었다.
      //   ⚠ 주석 안의 참조는 **안내가 아니다** — AI가 그리로 보내지 않는다.
      const src = fs.readFileSync(u, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")   // 블록 주석
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // 줄 주석(URL의 `//`는 앞에 `:`가 있어 안 지운다)
      for (const m of src.matchAll(/["']([a-z0-9_-]+\.html)["']/gi)) {
        if (!있는화면.has(m[1])) 없음.push(`${u.pathname.split("/").pop()} → ${m[1]}`);
      }
    }
    expect([...new Set(없음)], "AI가 없는 화면으로 안내한다").toEqual([]);
  });
});

// 「내 업무로 돌아가기」 띠(worknow.js)는 **삭제됐다**(2026-07-31).
// 사용자 신고로 세 개가 겹쳐 뜨는 것을 고쳤지만, 근본은 "화면을 떠나면 길을 잃는다"에
// 버튼을 붙인 증상 치료였다. 대화창(지휘소)이 늘 옆에 있으면 돌아갈 일 자체가 없어
// 개념을 하나 없앴다 — 고치는 것보다 없애는 편이 나은 자리였다.

describe("★ 주 대화창이 근거를 보여 준다 (2026-08-01)", () => {
  // 대화 입구가 다섯 곳이다(console·chatwidget·sessions·office·agent).
  // 그런데 **가장 많이 쓰는 지휘소(console.js)에 근거 배지가 없었다** — 담당자가 답만 보고
  // 무엇을 근거로 했는지 알 수 없었다. 화면 안 위젯에는 있었는데 그쪽은 탭에서 비어 있다.
  // 기능을 안 쓰는 곳에 넣는 실수를 다시 밟지 않도록 못 박는다.
  it("지휘소가 근거 문서 이름과 원문 대목을 그린다", () => {
    // ⚠ 그리는 코드는 공용 부품(chatparts.js)으로 옮겼다 — 지휘소는 그걸 부른다.
    //   시험이 옛 자리를 계속 보면 **정상적인 이동을 실패로 읽는다**(2026-08-01 실제로 그랬다).
    const parts = pageSrc.get("chatparts.js") ?? "";
    const src = pageSrc.get("console.js") ?? "";
    expect(parts, "근거 배지를 그리는 곳이 없다").toContain("📄 근거:");
    expect(parts, "근거 원문을 그리는 곳이 없다").toContain("근거 원문");
    expect(src, "지휘소가 서버의 quotes를 안 넘긴다").toMatch(/P\.quotes\(replyEl[^)]*quotes/);
  });

  it("서버가 실제로 quotes를 준다 — 화면만 그려 봐야 소용없다", () => {
    const disp = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    expect(disp).toContain("quotes?: SourceQuote[]");
    expect(disp, "검색 결과에서 원문을 안 뽑는다").toMatch(/quotes = relevant/);
  });
});

describe("★ 대화 부품은 한 벌만 있다 (2026-08-01 사용자 지적: \"하나의 구조가 맞지?\")", () => {
  // 지시를 넣는 자리가 둘이다 — 셸의 지휘소(console.js)와 분리창의 위젯(chatwidget.js).
  // ⚠ 위젯은 죽은 코드가 **아니다**: 분리창(⧉ 창으로)에는 지휘소가 없어 거기선 유일한 창구다.
  //   지우려다 확인해서 알았다(2026-08-01). 지웠으면 창으로 빼는 순간 물어볼 데가 사라졌다.
  // 문제는 삭제가 아니라 **어긋남**이었다: 체크칸·가서 하기가 지휘소에만 있어,
  // 같은 답인데 창으로 빼면 목록에서 고를 수가 없었다.
  const parts = pageSrc.get("chatparts.js") ?? "";
  const console_ = pageSrc.get("console.js") ?? "";
  const widget = pageSrc.get("chatwidget.js") ?? "";

  it("부품이 공용 파일에 있다", () => {
    for (const fn of ["function quotes(", "function picks(", "function open("]) {
      expect(parts, `${fn} 가 공용 파일에 없다`).toContain(fn);
    }
    expect(parts).toContain("window.gijoChatParts");
  });

  it("★ 양쪽이 같은 부품을 쓴다 — 자기 것을 또 부르지 않는다", () => {
    // ⚠ 재는 것은 "옛 코드가 파일에 남아 있나"가 아니라 **"무엇을 부르나"** 다.
    //   지휘소의 옛 구현(attachQuotes·attachOpen·attachPicks)은 아직 파일에 있다 —
    //   지우는 스크립트가 옆 함수(attachApproval 77줄)를 잘라 먹은 사고가 있어(2026-08-01)
    //   **호출만 끊고 코드는 남겨 뒀다.** 남아 있어도 안 부르면 어긋나지 않는다.
    //   다음 정리 때 이 시험이 통과하는 것을 보고 지운다.
    for (const [이름, src] of [["지휘소", console_], ["분리창 위젯", widget]] as [string, string][]) {
      expect(src, `${이름}이 공용 부품을 안 쓴다`).toContain("gijoChatParts");
      // 옛 구현을 **다시 부르면** 어긋남이 돌아온다 — 호출부를 본다.
      expect(src, `${이름}이 옛 체크칸을 다시 부른다`).not.toMatch(/\battachPicks\(replyEl|\battachPicks\(typing/);
      expect(src, `${이름}이 옛 근거원문을 다시 부른다`).not.toMatch(/\battachQuotes\(replyEl|근거원문\(r\./);
      expect(src, `${이름}이 옛 가서하기를 다시 부른다`).not.toMatch(/\battachOpen\(replyEl/);
    }
  });

  // ★ 2026-08-13 — 위 시험이 통과하는데도 **배지는 두 벌이었다.**
  //
  //   위 시험이 재는 것은 "옛 **함수**(attachQuotes…)를 다시 부르나"다. 그런데 분리창은
  //   함수를 부른 것이 아니라 `typing.innerHTML += '<div …>📄 근거: …'`로 **직접 조립**하고,
  //   부품에는 `P.quotes(typing, …, null)`로 null을 넘겨 부품 배지를 **껐다**.
  //   호출부만 보는 감시는 인라인 사본을 원리상 못 잡는다 — 이 저장소가 반복해 겪은
  //   「같은 것을 여러 곳에 적으면 어긋난다」가 감시 자신에게서 일어난 자리다.
  //
  //   그래서 재는 것을 하나 더 둔다: **부품에 실제로 넘기는가**(null이 아닌가).
  //   ⚠ 지휘소의 옛 구현(attachQuotes)에는 배지 문자열이 아직 남아 있다 — 호출이 0건이라
  //     어긋나지 않는다(이 파일의 방침: "남아 있어도 안 부르면 어긋나지 않는다").
  //     그래서 문자열 유무가 아니라 **살아 있는 호출**을 본다.
  it("★ 근거 배지도 부품 한 곳에서만 그린다 (2026-08-13)", () => {
    expect(parts, "부품에 근거 배지가 없다").toContain("📄 근거:");
    // 두 입구 모두 부품에 sources를 **넘긴다**. null을 넘기면 자기가 그리고 있다는 뜻이다.
    // ⚠ `[^)]*`를 쓰지 말 것 — 인자 안의 `(r && r.output)`이 닫는 괄호를 먼저 내서 거기서 멈춘다
    //   (2026-08-13 이 시험을 처음 쓸 때 실제로 헛실패했다). 길이로 끊는다.
    expect(console_, "지휘소가 근거를 부품에 안 넘긴다").toMatch(/P\.quotes\(replyEl[\s\S]{0,120}?sources/);
    expect(widget, "분리창이 근거를 부품에 안 넘긴다").toMatch(/P\.quotes\(typing[\s\S]{0,120}?r\.sources/);
    expect(widget, "분리창이 부품 배지를 끄고 자기가 그린다").not.toMatch(/P\.quotes\([^)]*,\s*null\s*\)/);
    // 살아 있는 인라인 사본 금지 — 배지 마크업을 직접 조립하지 않는다.
    expect(widget, "분리창이 근거 배지를 인라인으로 또 그린다").not.toMatch(/innerHTML\s*\+=[\s\S]{0,120}📄 근거:/);
  });

  it("부품을 쓰는 화면은 공용 파일을 먼저 읽는다", () => {
    // ⚠ **주석에 파일 이름이 적힌 것을 「쓴다」로 세면 안 된다** — 2026-08-01에 이미 겪은 거짓 실패다.
    //   그때 순서 검사에만 script 태그 규칙을 적용하고 **들어오는 문턱은 안 고쳤다**(반쪽 수리).
    //   2026-08-22에 그 구멍으로 또 걸렸다: `lite-chat.html`이 이름표가 되면서 머리 주석에
    //   「console.js 2,155줄에 분기가 0곳」이라 적었을 뿐인데 **부품 미탑재로 잡혔다.**
    //   → 문턱도 **script 태그**로 잰다. 기록을 남긴 주석이 시험에 밀려 지워지는 일은 없어야 한다.
    const 태그있나 = (src: string, n: string) => src.includes(`<script src="${n}"></script>`);
    const 없음: string[] = [];
    for (const [file, src] of pageSrc) {
      if (!file.endsWith(".html")) continue;
      if (!태그있나(src, "chatwidget.js") && !태그있나(src, "console.js")) continue;
      if (!태그있나(src, "chatparts.js")) { 없음.push(file); continue; }
      // 순서도 본다 — 부품이 뒤에 오면 부를 때 아직 없다.
      const 태그 = (n: string) => src.indexOf(`<script src="${n}"></script>`);
      const w = 태그("chatwidget.js");
      if (w >= 0 && 태그("chatparts.js") > w) 없음.push(file + "(순서)");
    }
    expect(없음, "부품이 없거나 늦게 읽혀 대화창이 반쪽이 된다").toEqual([]);
    // ⚠ 감시가 헛돌지 않는지 — 실제로 검사한 화면이 있어야 한다(문턱을 좁혔으니 확인한다).
    const 검사대상 = [...pageSrc].filter(([f, s]) =>
      f.endsWith(".html") && (태그있나(s, "chatwidget.js") || 태그있나(s, "console.js")));
    expect(검사대상.length, "대화 부품을 싣는 화면이 하나도 없다 — 이 감시가 헛돈다").toBeGreaterThan(0);
  });
});

// ── 탭에 파일 이름이 새지 않는다 (2026-08-18 사장님 QA 발견) ─────────────────
// 증상: 탭에 「① 발견·수집 › discover.html?p…」 — 사람에게 보일 글자가 아니다.
// 뿌리: app.html의 open(page,label)이 `label || page`로 떨어지는데, nav.js의 리다이렉트 표가
//   옛 화면 23개를 허브(?panel=…)로 넘기면서 이름은 안 바꿔 준다. 셸의 「옛탭」 표엔 4개만
//   손으로 적혀 있어 나머지 19개가 파일명을 드러냈다.
// ⇒ 표를 채우는 대신 **이름의 주인(nav.js GROUPS)에서 찾아 쓰게** 했다. 그 다리를 지킨다.
describe("★ 탭 이름 — 파일명을 사람에게 보이지 않는다", () => {
  const nav = fs.readFileSync(new URL("../../client/src/renderer/pages/nav.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../../client/src/renderer/pages/app.html", import.meta.url), "utf8");

  it("nav가 사이드바 정의를 셸에 내준다", () => {
    expect(nav, "window.gijoNavGroups로 안 내주면 셸이 이름을 못 찾는다").toContain("window.gijoNavGroups");
  });

  it("셸이 이름 없이 열 때 파일명으로 떨어지지 않는다", () => {
    expect(app, "화면이름찾기가 없다").toContain("function 화면이름찾기");
    expect(app, "읽을이름(마지막 방어)이 없다").toContain("function 읽을이름");
    // `label || page` 가 남아 있으면 그리로 다시 샌다.
    // ⚠ **주석은 세지 않는다**(2026-08-18에 밟음 — 뿌리를 설명한 주석 문장이 걸려 헛실패했다).
    //   이 저장소가 같은 함정을 여러 번 밟았다(clientglobals의 `console.js` 주석 건).
    const 코드만 = app
      .replace(/<!--[\s\S]*?-->/g, "")      // HTML 주석
      .replace(/\/\*[\s\S]*?\*\//g, "")     // 블록 주석
      .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n"); // 줄 주석·JSDoc 이어지는 줄
    expect(/label\s*\|\|\s*page(?![a-zA-Z])/.test(코드만), "아직 `label || page`로 파일명이 샌다").toBe(false);
  });

  it("리다이렉트가 넘기는 화면은 전부 사이드바에 이름이 있다", () => {
    // nav의 GROUPS에서 page→label을 모은다.
    const 이름 = new Map<string, string>();
    for (const m of nav.matchAll(/\{\s*page:\s*"([^"]+)"[^}]*label:\s*"([^"]+)"/g)) {
      const f = m[1].split("?")[0];
      if (!이름.has(f)) 이름.set(f, m[2]);
    }
    const 없음: string[] = [];
    for (const m of nav.matchAll(/"([a-z0-9_-]+\.html)"\s*:\s*"([a-z0-9_-]+\.html\?[^"]*)"/g)) {
      if (m[1].includes("embed") || m[2].includes("embed")) continue;
      const 도착 = m[2].split("?")[0];
      if (!이름.has(도착)) 없음.push(`${m[1]} → ${m[2]}`);
    }
    expect(없음, "이 화면들로 가면 탭에 파일명이 뜬다 — 사이드바에 이름을 두거나 리다이렉트를 고칠 것").toEqual([]);
  });
});
