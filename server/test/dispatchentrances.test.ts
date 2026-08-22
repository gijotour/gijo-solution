// 지시를 보내는 자리가 **결재판을 그릴 줄 아는 곳뿐**인지 대조한다.
//
// ⚠ 실사고(2026-08-01, 이 시험을 쓰게 만든 것):
//   팀 사무실(office.html)이 "…조치를 진행해줘"를 직접 sendInstruction으로 보내고 있었다.
//   그 지시는 **쓰기**다. 쓰기 도구는 서버가 곧바로 실행하지 않고 결재판(approval)을 돌려주며,
//   담당자가 승인해야 실행된다. 그런데 이 화면은 결재판을 그릴 줄 몰라 응답의 approval을 버렸다 —
//   담당자는 "AI 팀에 맡겼다"고 믿지만 **아무것도 실행되지 않는다.**
//   게다가 응답에서 result.summary·reply·message를 읽었는데 dispatch 응답에 그런 필드는 없다
//   (있는 건 output). 그래서 응답조차 한 글자도 안 보였다 — 눌러도 침묵.
//
//   왜 못 잡았나:
//     · 타입 검사 — HTML 안 <script>는 검사 대상이 아니다
//     · 스윕 — 화면이 뜨는지만 본다. 「맡기기」를 눌러 보지 않는다
//     · clientglobals — sendInstruction은 **실제로 있는** 함수라 통과한다. 없는 함수가 아니라
//       "있는 함수를 그릴 줄 모르는 자리에서 부른 것"이라 이름 대조로는 안 걸린다
//   그래서 **부를 자격**을 대조한다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);

// 지시를 보낼 자격이 있는 자리 = 근거·결재판을 그리는 대화창 구현체.
//   console.js  — 지휘소(셸 아래 도킹 + 별도 창, 같은 파일을 쓴다)
//   chatwidget.js — 분리창 위젯(「⧉ 창으로」 뺐을 때 유일한 창구)
// 다른 화면은 window.gijo.askConsole()로 **대화창에 넘겨야** 한다.
// ⚠ **lite-chat.html은 2026-08-22에 목록에서 빠졌다 — 자격을 잃은 것이 아니라 사라진 것이다.**
//   그 파일은 이제 화면이 아니라 **이름표**다(console.html로 넘긴다). 사장님 지시
//   「AI에게 물어보기도 우리 대화창을 그대로 이관하자」로 라이트가 프로 대화창을 그대로 쓴다.
//   → 라이트의 대화창 구현체도 이제 **console.js**이므로, 자격은 그 파일이 이미 갖고 있다.
//   ⚠ 옛 기록은 지우지 않는다(2026-08-13 max 신설분): 처음 올라온 판은 결재판 없이
//     sendInstruction만 불러 이 감시에 걸렸고 — **감시가 옳았다.** 화면 스스로
//     「확인(결재)을 거쳐 실행됩니다」라 약속하는데 그리는 코드가 없어 쓰기 지시가 조용히
//     증발할 자리였다. 그 교훈이 이 파일의 존재 이유이므로 남겨 둔다.
const 자격있는자리 = new Set(["console.js", "chatwidget.js"]);

// 주석은 걷어내고 본다 — "옛 sendInstruction()은 지웠다" 같은 **설명**을 위반으로 잡으면
// 사고를 기록한 주석을 지우게 된다. 기록이 시험에 밀려 사라지는 건 손해다.
function 주석걷기(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const 페이지 = fs
  .readdirSync(pagesDir)
  .filter((f) => /\.(html|js)$/.test(f))
  .map((f) => ({ 이름: f, 내용: 주석걷기(fs.readFileSync(new URL(f, pagesDir), "utf8")) }));

describe("지시 입구 — 결재판을 그리는 곳에서만 보낸다", () => {
  it("★ 자격의 조건 — 목록에 오른 자리는 결재판을 **실제로** 그린다 (2026-08-13)", () => {
    // 목록만 늘리고 결재판을 안 그리면 이 감시는 구멍이 된다 — 자격 조건을 함께 못박는다.
    // ⚠ 이 시험이 lite-chat.html **하나만** 보고 있었다(2026-08-22까지). 그 파일이 이름표가 되면서
    //   시험이 죽었는데, 죽은 이유가 「검사 대상이 사라져서」였다 — 자격자는 그대로 있는데.
    //   → **목록 전체**를 돌게 고친다. 목록에 뭘 더하든 자격이 함께 검사된다(원래 뜻이 그것이다).
    expect(자격있는자리.size, "자격자가 없으면 이 시험이 헛돈다").toBeGreaterThan(0);
    for (const 이름 of 자격있는자리) {
      const p = 페이지.find((x) => x.이름 === 이름);
      expect(p, `${이름}이 없다 — 목록과 실제 파일이 어긋났다`).toBeTruthy();
      expect(p!.내용, `${이름}: 결재판을 안 그린다 — 쓰기 지시가 조용히 증발한다`).toMatch(/approval/);
      expect(p!.내용, `${이름}: 승인 실행 다리(approveAgentTool)를 안 부른다`).toMatch(/approveAgentTool/);
    }
  });

  it("sendInstruction을 부르는 화면은 대화창 구현체뿐이다", () => {
    const 위반 = 페이지
      .filter((p) => !자격있는자리.has(p.이름))
      .filter((p) => /\bsendInstruction\s*\(/.test(p.내용))
      .map((p) => p.이름);
    expect(
      위반,
      `이 화면들이 지시를 직접 보낸다 — 쓰기 지시면 결재판이 안 떠서 실행되지 않는다. ` +
        `window.gijo.askConsole(지시)로 대화창에 넘길 것: ${위반.join(", ")}`,
    ).toEqual([]);
  });

  it("자격 있는 자리는 실제로 결재판을 그린다", () => {
    for (const 이름 of 자격있는자리) {
      const p = 페이지.find((x) => x.이름 === 이름);
      expect(p, `${이름}이 없어졌다 — 자격 목록을 고칠 것`).toBeTruthy();
      // 응답의 approval을 **읽어서 그리는** 호출이 있어야 한다(주석만으로는 안 된다).
      expect(
        /(attachApproval|appendApproval|renderApproval)\s*\(/.test(p!.내용),
        `${이름}이 결재판을 그리지 않는다 — 여기서 쓰기 지시를 보내면 막다른 길이 된다`,
      ).toBe(true);
    }
  });

  it("dispatch 응답에서 없는 필드를 읽지 않는다", () => {
    // 응답은 { task, route, output, approval, sources, quotes, steps, toolCalls }다.
    // summary·reply·message는 없다 — 읽으면 언제나 undefined라 화면이 조용히 빈다.
    //
    // ⚠ 이름만 보고 싸잡지 않는다. 처음엔 `\w+\.(summary|reply|message)`로 훑었다가
    //   err.message·로그인 응답 r.message·감사화면 r.summary까지 잡아 **멀쩡한 화면 3개를
    //   틀렸다고 판정**했다(오늘만 이런 오판이 여러 번이다). dispatch 응답을 **받은 변수**에
    //   한해서 본다.
    const 위반: string[] = [];
    for (const p of 페이지) {
      const 받은변수 = [...p.내용.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*await\s+window\.gijo\.sendInstruction\s*\(/g)].map((m) => m[1]);
      for (const v of 받은변수) {
        if (new RegExp(`\\b${v}\\s*\\.\\s*(summary|reply|message)\\b`).test(p.내용)) 위반.push(`${p.이름}(${v})`);
      }
    }
    expect(
      위반,
      `dispatch 응답에 없는 필드를 읽는다(있는 건 output) — 화면이 조용히 빈다: ${위반.join(", ")}`,
    ).toEqual([]);
  });

  it("askConsole은 preload에 실제로 있다", () => {
    const preload = fs.readFileSync(new URL("../../client/src/preload.ts", import.meta.url), "utf8");
    expect(/askConsole\s*:/.test(preload), "askConsole이 preload에 없다 — 넘기는 쪽이 조용히 실패한다").toBe(true);
    expect(/onConsoleAsk\s*:/.test(preload), "onConsoleAsk가 없으면 받는 쪽이 없어 눌러도 아무 일이 없다").toBe(true);
    // 받는 쪽 — console.js가 실제로 등록해야 한다(이 저장소 단골 사고: 보내는 길만 만들기).
    const console_js = 페이지.find((p) => p.이름 === "console.js")!.내용;
    expect(/onConsoleAsk\s*\(/.test(console_js), "console.js가 onConsoleAsk를 등록하지 않는다").toBe(true);
  });
});
