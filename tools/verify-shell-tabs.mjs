// **왼쪽 메뉴를 누르면 탭이 열리는가** — 셸이 살아 있는지 실앱에서 확인한다.
//
// ⚠ 실사고(2026-08-01). app.html에서 코드를 잘라내며 고아 `});`를 남겼고, 그 한 줄이
//   셸 스크립트를 통째로 죽여 window.gijoTabs가 안 만들어졌다. 그러면 nav.js가
//   "탭 열기" 대신 navigateTo로 빠져 **앱을 통째로 갈아치운다** — 열어 둔 탭도 대화창도
//   전부 사라진다. 취약점·보안 KPI·작업 내역 전부 그랬고, **게시본으로 나갈 뻔했다.**
//
//   문법 검사는 빌드에 넣었지만 그것만으로는 부족하다 — 문법이 맞아도 gijoTabs가
//   안 만들어질 수 있다(예: 앞선 줄이 예외를 던지면 그 뒤 대입이 통째로 안 돈다).
//   그래서 **실제로 눌러 본다.** 이 검사가 셸의 마지막 관문이다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 오류 = [];
const 붙이기 = (pg) => {
  pg.on("pageerror", (e) => 오류.push(pg.url().split("/").pop() + " ⟶ " + String(e).slice(0, 160)));
  pg.on("console", (m) => { if (m.type() === "error") 오류.push(pg.url().split("/").pop() + " ⟶ " + m.text().slice(0, 160)); });
};
ctx.pages().forEach(붙이기);
ctx.on("page", 붙이기);

let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
if (/login\.html/.test(p.url())) {
  await p.fill("#username", "claude-deploy").catch(() => {});
  await p.fill("#password", process.env.GIJO_ADMIN_PASSWORD).catch(() => {});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(7000);
  const f = await p.$('button:has-text("강제")');
  if (f) { await f.click(); await p.waitForTimeout(5000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.dismiss().catch(() => {}));
await p.waitForTimeout(2000);

const 결과 = [];
const 적기 = (n, ok, 비고) => { 결과.push(ok); console.log((ok ? "✅ " : "❌ ") + n + (비고 ? " — " + 비고 : "")); };

// ① 셸의 뼈대가 실제로 만들어졌는가 — 이게 없으면 메뉴가 앱을 갈아치운다.
const 뼈대 = await p.evaluate(() => ({
  gijoTabs: typeof window.gijoTabs,
  gijoConsole: typeof window.gijoConsole,
  메뉴수: document.querySelectorAll("#gijoNav .gn-item").length,
}));
적기("셸 뼈대(window.gijoTabs)가 있다", 뼈대.gijoTabs === "object", JSON.stringify(뼈대));
// ⚠ 로그인 화면의 409는 **정상**이다 — 중복 로그인 방지가 "이미 로그인 중"이라고 답한 것이고,
//   그 뒤 강제 전환으로 들어간다. 이런 걸 실패로 잡으면 하네스가 거짓말을 한다(오늘만 여러 번).
//   여기서 보려는 것은 **셸 스크립트가 죽었는가**뿐이므로 app.html 것만 본다.
const 셸오류 = 오류.filter((x) => x.startsWith("app.html"));
적기("셸 스크립트가 안 죽었다", 셸오류.length === 0, 셸오류[0] || (오류.length ? `(다른 화면 ${오류.length}건은 무시: ${오류[0].slice(0, 60)})` : ""));

// ② 실제로 눌러 본다 — 탭으로 열리고 셸이 살아 있어야 한다.
for (const 메뉴 of ["취약점", "보안 KPI", "작업 내역"]) {
  const shell = ctx.pages().find((x) => x.url().includes("app.html"));
  if (!shell) { 적기(`${메뉴} — 탭으로 열린다`, false, "셸이 이미 사라졌다(앞 메뉴에서 갈아치워짐)"); continue; }
  await shell.evaluate((m) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find(
      (e) => (e.querySelector(".gn-label")?.textContent || "").trim() === m);
    it?.querySelector(".gn-label").click();
  }, 메뉴);
  await shell.waitForTimeout(5000);
  const 살아있나 = !!ctx.pages().find((x) => x.url().includes("app.html"));
  적기(`${메뉴} — 탭으로 열린다(셸이 안 죽는다)`, 살아있나, 살아있나 ? "" : "앱이 통째로 갈아치워졌다");
}

console.log("\n판정: " + (결과.every(Boolean) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((x) => !x).length + "건"));
await b.close();
process.exit(결과.every(Boolean) ? 0 : 1);
