// 셸의 상단·하단 고정 바가 **창 안에 머무는 구조인지** 지킨다 (2026-08-02 신설).
//
// 왜: 사용자 신고 "상단 하단 고정탭 아직도 문제있음 … 고정값이 필요할듯".
//   실측하니 하단 바가 창 밖(위치 912 / 창 900)으로 밀려나 아예 안 보였다.
//   원인은 격자 줄 높이가 **auto**라 내용이 요구하는 만큼 늘어난 것 —
//   안쪽이 900px를 요구해 854px 칸을 넘겼고 그만큼 아래가 밀렸다.
//   좌표는 실앱에서만 재지만, **줄 높이를 못 박는 규칙이 사라지는 것**은 여기서 잡는다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = fs.readFileSync(
  path.resolve(__dirname, "../../client/src/renderer/pages/app.html"),
  "utf-8"
);

// 주석은 **역사 기록이라 남긴다** — 왜 그렇게 했는지가 다음 사람을 살린다.
// 그래서 "옛 규칙이 되살아났나"를 볼 때는 **실행되는 코드만** 본다.
// (2026-08-08 실측: 주석에 옛 선택자를 적어 두었더니 그 주석이 자기 감시에 걸렸다.)
const 코드만 = (s: string) => s
  .replace(/<!--[\s\S]*?-->/g, "")   // HTML 주석
  .replace(/\/\*[\s\S]*?\*\//g, "")  // 블록 주석
  .replace(/^\s*\/\/.*$/gm, "");     // 줄 주석

describe("셸 뼈대 — 상단·하단 고정 바", () => {
  it("본문 격자의 **줄 높이를 못 박는다** — auto면 내용이 밀어내 하단 바가 창 밖으로 나간다", () => {
    const m = APP.match(/\.app\{[^}]*\}/s);
    expect(m, ".app 규칙이 없다").toBeTruthy();
    expect(m![0]).toContain("grid-template-rows:minmax(0,1fr)");
  });

  // 2026-08-07 상단 통합(시안 승인): 조작줄(#shellHeader 46px)을 없애고 **탭줄 하나(44px)**가
  // 상단 바다. 경로 표시가 두 함수에서 따로 갱신돼 어긋나던 사고의 구조적 제거 — 옛 조작줄이
  // 되살아나면 그 사고도 되살아나므로, 없는 것을 여기서 못 박는다.
  it("옛 조작줄(#shellHeader)은 없다 — 되살리면 경로 어긋남 사고도 되살아난다", () => {
    expect(APP).not.toContain('id="shellHeader"');
  });

  it("세로 층 — 몸통이 flex 세로이고 상단 조작 줄·하단 줄은 줄어들지 않는다", () => {
    expect(APP).toMatch(/body\{[^}]*flex-direction:column/s);
    const 상단 = APP.match(/\.topbar\{[^}]*\}/s);
    const 하단 = APP.match(/\.shellfoot\{[^}]*\}/s);
    expect(상단![0]).toContain("flex:0 0 auto");   // 눌리면 OS 창 버튼이 삐져나온다
    expect(하단![0]).toContain("flex:0 0 auto");
  });

  it("가운데 칸만 늘어난다(flex:1) — 그래야 위·아래가 제자리에 남는다", () => {
    const m = APP.match(/\.app\{[^}]*\}/s);
    expect(m![0]).toContain("flex:1");
    expect(m![0]).toContain("min-height:0");
  });

  // 2026-08-08: 탭이 아래로 내려가 이 자리는 조작 줄(#shellTop)이 됐다. 창 버튼은 OS가
  // 상단에 그리므로 **높이를 맞추는 대상이 바뀐 것이 아니라 요소만 바뀌었다**.
  it("상단 조작 줄 높이(44px)는 OS 창 버튼(titleBarOverlay)과 같다 — 다르면 버튼이 삐져나온다", () => {
    const 상단 = APP.match(/\.topbar\{[^}]*\}/s);
    expect(상단![0]).toMatch(/height:44px/);
    const MAIN = fs.readFileSync(path.resolve(__dirname, "../../client/src/main.ts"), "utf-8");
    expect(MAIN, "main.ts 오버레이 높이가 상단 줄과 다르다").toMatch(/titleBarOverlay:\s*\{[^}]*height:\s*44/);
  });

  // ── 2026-08-08 시안 ㉯: 탭을 아래로 ──
  describe("탭은 하단 줄에 있다", () => {
    it("탭 컨테이너(#tabBar)가 하단 줄(.shellfoot) 안에 있다", () => {
      const 하단 = APP.match(/<div class="shellfoot">[\s\S]*?<\/div>\s*<\/div>/);
      expect(하단, ".shellfoot 블록을 못 찾았다").toBeTruthy();
      expect(하단![0], "탭줄이 하단 줄 밖으로 나갔다").toContain('id="tabBar"');
    });

    it("상단에는 조작 줄(#shellTop)만 있고 탭이 없다", () => {
      const 상단 = APP.match(/<div class="topbar" id="shellTop">[\s\S]*?<\/div>\s*<\/div>/);
      expect(상단, "#shellTop 블록을 못 찾았다").toBeTruthy();
      expect(상단![0], "탭이 위로 되돌아왔다").not.toContain('id="tabBar"');
      expect(상단![0], "시계·세션 자리가 상단에 없다").toContain('id="tbInfo"');
    });

    // 창을 끄는 손잡이는 하나뿐이어야 한다. 탭줄에 남겨 두면 탭을 누르려다 창이 끌린다.
    it("창 손잡이(drag)는 상단 조작 줄에만 있다", () => {
      const 상단 = APP.match(/\.topbar\{[^}]*\}/s);
      expect(상단![0], "상단 줄이 창 손잡이가 아니다 — 창을 못 옮긴다").toContain("-webkit-app-region:drag");
      expect(코드만(APP), "탭줄에 drag가 남아 있다").not.toMatch(/\.tabbar\{-webkit-app-region:drag\}/);
    });

    // 조작 단추가 못 붙을 때 조용히 탭줄(하단)로 흘러가면 "단추가 어디 갔지"가 된다.
    it("조작 단추는 #shellTop에 붙고 탭줄로 폴백하지 않는다", () => {
      const TB = fs.readFileSync(
        path.resolve(__dirname, "../../client/src/renderer/pages/titlebar.js"), "utf-8");
      expect(TB).toMatch(/셸인가 \? document\.getElementById\("shellTop"\)/);
      expect(코드만(TB), "탭줄 폴백이 남아 있다").not.toMatch(/getElementById\("tabBar"\)/);
    });
  });

  it("탭줄에 정보 자리(#tbInfo)가 있다 — 시계·세션이 셸 한 곳에 모인 자리", () => {
    expect(APP).toContain('id="tbInfo"');
  });

  // ── 2026-08-08 사용자 지시·시안 승인: 창 조작을 하단바로, 연결상태 배지 삭제 ──
  // 약속해 놓고 코드가 안 지키는 것을 혼자서는 못 찾는다(주석만 남고 자리는 되돌아간 전례).
  describe("창 조작은 하단바에 있다 (2026-08-08 이사)", () => {
    const 하단바 = APP.match(/<div class="shellfoot">[\s\S]*?<\/div>\s*<\/div>/);
    const 상단줄 = APP.match(/<div class="topbar" id="shellTop">[\s\S]*?<\/div>\s*<\/div>/);

    it("네 단추가 모두 하단 줄 안에 있다", () => {
      expect(하단바, ".shellfoot 블록을 못 찾았다").toBeTruthy();
      for (const id of ["tbPopout", "tbCloseAll", "tbConsoleSide", "tbWins"]) {
        expect(하단바![0], `${id}가 하단 줄에 없다`).toContain(`id="${id}"`);
      }
    });

    it("상단 조작 줄에는 그 단추가 하나도 없다 — 되돌아오면 자리를 다시 잃는다", () => {
      expect(상단줄, "#shellTop 블록을 못 찾았다").toBeTruthy();
      for (const id of ["tbPopout", "tbCloseAll", "tbConsoleSide", "tbWins"]) {
        expect(상단줄![0], `${id}가 위로 되돌아왔다`).not.toContain(`id="${id}"`);
      }
    });

    // 단추가 아래로 내려갔으므로 목록도 **위로** 열려야 한다. top이면 창 밖이라 한 줄도 안 보인다.
    it("창 목록(winpop)은 위로 열린다", () => {
      const m = APP.match(/\.winpop\{[^}]*\}/s);
      expect(m, ".winpop 규칙이 없다").toBeTruthy();
      expect(m![0], "winpop이 아래로 열린다 — 하단바에서는 창 밖이다").toContain("bottom:calc(100% + 5px)");
      expect(m![0]).not.toMatch(/[^-]top:calc/);
    });

    // 실사고: `.shellfoot span{margin-left:auto}`가 버튼 **안의** <span id="tbWinCnt">까지 걸어
    // 「🗔 창」과 숫자를 갈라놓았다. 선택자를 다시 넓히면 그 증상이 그대로 돌아온다.
    it("하단바 오른쪽 밀기는 .brand에만 걸린다 — span 전체면 창 개수가 갈라진다", () => {
      expect(APP).toMatch(/\.shellfoot \.brand\{[^}]*margin-left:auto/);
      expect(코드만(APP), "span 전체 선택자가 되살아났다").not.toMatch(/\.shellfoot\s+span\{margin-left:auto/);
    });
  });

  describe("대화 되돌리기 줄은 왼쪽 패널에 있다 (2026-08-08 이사)", () => {
    const TB = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/renderer/pages/titlebar.js"), "utf-8");

    it("본문 아래 가로 줄(.console-out)은 없앴다 — 대화창을 뺄수록 화면이 좁아지던 자리", () => {
      expect(APP, "console-out이 되살아났다").not.toContain('id="consoleOut"');
      expect(APP).not.toContain('class="console-out"');
    });

    it("단추는 사용자 영역 안에서 문서함 줄 **위**에 만들어진다", () => {
      expect(TB).toContain('backRow.id = "csBackRow"');
      expect(TB).toContain('backBtn.id = "csBackBtn"');
      const 순서 = TB.indexOf("area.appendChild(backRow)");
      const 사용자줄 = TB.indexOf("area.appendChild(row)");
      expect(순서, "backRow 생성부를 못 찾았다").toBeGreaterThan(0);
      expect(순서, "되돌리기 줄이 사용자 줄 아래로 갔다").toBeLessThan(사용자줄);
    });

    it("분리했을 때만 보인다 — 붙어 있을 때 자리를 먹지 않는다", () => {
      expect(APP).toMatch(/#csBackRow\{display:none;\}/);
      expect(APP).toMatch(/body\.console-popped #csBackRow\{display:block;\}/);
    });

    // 셸이 아닌 문서(분리창·직접 연 화면)에는 되돌릴 대화창 자체가 없다.
    it("셸에서만 만든다", () => {
      expect(TB).toMatch(/if \(document\.getElementById\("screens"\)\) \{[\s\S]{0,400}csBackRow/);
    });

    // getElementById로 잡으면 titlebar.js가 만들기 전이라 null → 셸 초기화가 통째로 죽는다.
    it("손잡이는 문서 위임으로 건다 — 직접 잡으면 없는 것을 부르게 된다", () => {
      expect(APP, "csBackBtn을 직접 잡고 있다").not.toMatch(/\$\("csBackBtn"\)/);
      expect(APP).toMatch(/closest\("#csBackBtn"\)/);
    });
  });

  describe("서버 연결상태 배지는 없앴다 (2026-08-08)", () => {
    const TB = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/renderer/pages/titlebar.js"), "utf-8");

    it("배지를 만들지 않는다 — 늘 초록이라 자리만 먹었다", () => {
      expect(코드만(TB), "연결상태 배지가 되살아났다").not.toMatch(/pill\.innerHTML\s*=/);
      expect(코드만(TB)).not.toMatch(/"서버 연결상태 (양호|불량)"/);
    });

    // 세션 칩이 그 배지 **뒤에** 붙던 구조라, 배지를 지우면 자리를 잃고 끝으로 밀렸다
    // (사용자 신고 "세션이 메인화면 아래로 나온다"). 자리는 남에게 기대지 않는다.
    it("세션 칩은 시계 왼쪽으로 못 박는다 — 배지를 찾아 붙지 않는다", () => {
      expect(TB, "세션 칩이 다시 배지를 찾고 있다").not.toMatch(/statusPill/);
      expect(TB).toMatch(/right\.insertBefore\(sessChip, clock\)/);
    });
  });

  // 2026-08-07 사본 23개 삭제. 한 화면에라도 헤더 사본이 되살아나면 문구·시계가 다시 갈라진다
  // (실측: 삭제 전 이미 "연결 확인 중"/"운영중"/하드코딩 아바타로 갈라져 있었다).
  it("화면 파일에 헤더 사본이 없다 — 상단 바는 titlebar.js 한 곳", () => {
    const pages = ["handover", "dashboard", "sessions", "sbom", "redteam", "learnloop", "threat",
      "syslog", "memory", "inventory", "analysis", "hardening", "vulnscan", "products", "report",
      "approvals", "compliance", "audit", "agent", "kpi", "terminal", "settings"];
    for (const p of pages) {
      const html = fs.readFileSync(path.resolve(__dirname, `../../client/src/renderer/pages/${p}.html`), "utf-8");
      expect(html, `${p}.html에 헤더 사본이 되살아났다`).not.toContain('<div class="header">');
    }
  });
});
