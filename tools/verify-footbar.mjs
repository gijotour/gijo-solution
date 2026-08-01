import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("app.html"));
let 실패 = 0;
const 확인 = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) 실패++; };

// ① 셸
확인(await page.evaluate(() => !!document.querySelector(".shellfoot")), "셸에 하단바");
// ② 탭 안에는 **없어야** 한다(두 줄이 되면 안 된다)
await page.evaluate(() => { try { window.gijoTabs.closeAll(); } catch (e) {} });
await page.waitForTimeout(300);
await page.evaluate(() => window.gijoTabs.open("threat.html", "위협 인텔"));
await page.waitForTimeout(3200);
const fr = page.frames().find((f) => f.url().includes("threat.html") && f.url().includes("embed"));
// ⚠ `.footer:not([style*='none'])`는 **인라인 style만** 본다. 우리 숨김은 CSS 규칙이라
//   인라인이 비어 있어 늘 걸렸다 — 제품은 멀쩡한데 시험만 빨갰다(2026-08-02).
확인(!(await fr.evaluate(() => {
  const fb = document.querySelector(".gijo-footbar");
  const ft = document.querySelector(".footer");
  return !!fb || !!(ft && getComputedStyle(ft).display !== "none");
})), "탭 안에는 하단바가 겹치지 않는다");
확인(!(await fr.evaluate(() => /구독 중인 딥웹|등록된 도메인/.test(document.body.innerText))), "옮긴 설명글이 화면에서 사라졌다");

// ③ 별도 창 — 팀 사무실을 열어 확인
await page.evaluate(() => window.gijo.openTeamOffice && window.gijo.openTeamOffice());
await page.waitForTimeout(4000);
const 사무실 = ctx.pages().find((p) => p.url().includes("office.html"));
if (사무실) {
  const r = await 사무실.evaluate(() => {
    const f = document.querySelector(".gijo-footbar");
    return f ? { 있음: true, 높이: Math.round(f.getBoundingClientRect().height), 글: f.innerText.trim(), 바닥: Math.round(f.getBoundingClientRect().bottom), 창: window.innerHeight } : { 있음: false };
  });
  확인(r.있음, "팀 사무실 창에 하단바");
  if (r.있음) {
    확인(r.높이 === 34, `높이 34px (${r.높이})`);
    확인(Math.abs(r.바닥 - r.창) < 3, `창 바닥에 붙음 (${r.바닥}/${r.창})`);
    확인(r.글 === "GIJO Technology", `문구 통일 (${r.글})`);
  }
} else 확인(false, "팀 사무실 창을 못 찾음");
console.log(`\n실패 ${실패}건`);
await b.close();
process.exit(실패 ? 1 : 0);
