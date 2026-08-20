// tools/window-sweep.mjs — **별도 창** 스윕: 문서함·팀 사무실·대화 분리창.
//
// 왜(2026-08-07 사용자 신고 "문서함 문서열려?"): 문서함이 공용 렌더러(gijomd.js)를 안 실어
// **모든 문서 열기가 TypeError로 죽어 있었는데**, 26화면 스윕(menu-sweep)은 본창 탭만 돌아
// 못 잡았다. 별도 창은 각자 script 로드를 갖는 독립 문서라 공용 모듈 이관 때 빠지기 쉽다.
// 이 스윕은 창을 **실제로 열고**, 콘솔 오류를 듣고, 핵심 동작(문서면 본문 열기)까지 누른다.
//
// 판정: 창이 안 열리면 FAIL · pageerror/console.error가 잡히면 FAIL · 핵심 내용 검사 FAIL.
// 사용: Electron이 CDP 9223으로 떠 있고 로그인된 상태에서 `node tools/window-sweep.mjs`.
import { createRequire } from "module";
// playwright-core는 client/node_modules에 있다 — tools/에서 실행해도 찾도록 명시 해석(menu-sweep과 동일).
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = browser.contexts()[0];
const app = ctx.pages().find((p) => p.url().includes("app.html"));
if (!app) { console.error("✗ 본창(app.html)이 없다 — 로그인된 앱이 필요하다"); process.exit(1); }

const 창들 = [
  // (문서함 창은 2026-08-20 내 문서 허브에 흡수돼 목록에서 뺐다 — 「문서 열기까지」 검사의
  //  의도는 publish-gate-ui ③‴(제품 안내 렌더+열람 본문)이 본창 쪽에서 승계한다.)
  {
    이름: "팀 사무실", 열기: "openTeamOffice", 파일: "office.html",
    검사: async (page) => {
      await sleep(2500);
      const len = await page.evaluate(() => (document.body.textContent || "").trim().length);
      return len < 100 ? `화면이 비었다(본문 ${len}자)` : null;
    },
  },
  {
    이름: "대화 분리창", 열기: "openConsoleWindow", 파일: "console.html",
    검사: async (page) => {
      await sleep(2500);
      // ⚠ 입력칸은 `<input id="chatInput">`로 **type 속성이 없다** — input[type=text] 선택자는
      //   못 잡는다(첫 실행에서 이 가정 오류로 오탐). 실제 id로 본다.
      const ok = await page.evaluate(() => !!document.querySelector("#chatInput, textarea"));
      return ok ? null : "입력칸(#chatInput)이 없다 — 대화창이 제 모습이 아니다";
    },
  },
];

let 실패 = 0;
for (const w of 창들) {
  const errors = [];
  try {
    await app.evaluate((fn) => window.gijo[fn](), w.열기);
    await sleep(2500);
    const page = ctx.pages().find((p) => p.url().includes(w.파일));
    if (!page) { console.log(`✗ ${w.이름} — 창이 안 열림(${w.열기})`); 실패++; continue; }
    // 콘솔 오류·페이지 오류를 듣는다 — TypeError는 여기로 나온다(화면은 멀쩡해 보인다).
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 120)}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 120)}`); });
    const 문제 = await w.검사(page);
    if (문제) { console.log(`✗ ${w.이름} — ${문제}`); 실패++; }
    else if (errors.length) { console.log(`✗ ${w.이름} — 오류 ${errors.length}건: ${errors[0]}`); 실패++; }
    else console.log(`✓ ${w.이름} — 열림·내용·동작 정상`);
    await page.close().catch(() => {});
  } catch (e) {
    console.log(`✗ ${w.이름} — 스윕 자체가 죽음: ${String(e && e.message).slice(0, 100)}`);
    실패++;
  }
}
console.log(실패 ? `\n■ 별도 창 스윕 — ${실패}/${창들.length} 실패` : `\n■ 별도 창 스윕 — ${창들.length}/${창들.length} 통과`);
process.exit(실패 ? 1 : 0);
