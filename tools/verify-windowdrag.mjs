// 본창을 **마우스로 끌 수 있는가** — 끌 자리가 실제로 잡히는지 확인한다.
//
// ⚠ 실사고(2026-08-01 사용자 지적 "마우스 눌러서 창을 이동하는건데"):
//   이 앱은 윈도우 제목표시줄을 숨기고(titleBarStyle:"hidden") 버튼 셋만 OS가 그린다.
//   그런데 셸(app.html)에는 -webkit-app-region:drag 자리가 **하나도 없어서 본창을 아예
//   못 옮겼다.** 실측: 맨 위 가운데를 찍으니 DIV.spacer가 잡혔고 drag가 아니었다.
//   (titlebar.js의 끌기 띠는 #gijoTitlebarStrip인데 그건 로그인 화면 전용이라 셸엔 없다.)
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
if (/login\.html/.test(p.url())) {
  await p.fill("#username", "claude-deploy").catch(() => {});
  await p.fill("#password", process.env.GIJO_ADMIN_PASSWORD).catch(() => {});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(6000);
  const f = await p.$('button:has-text("강제")');
  if (f) { await f.click(); await p.waitForTimeout(4000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.dismiss().catch(() => {}));
await p.waitForTimeout(1500);

const 결과 = [];
const 적기 = (n, ok, 비고) => { 결과.push(ok); console.log((ok ? "✅ " : "❌ ") + n + (비고 ? " — " + 비고 : "")); };

const r = await p.evaluate(() => {
  const 끌수있나 = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const v = getComputedStyle(e).getPropertyValue("-webkit-app-region");
      if (v === "drag") return true;
      if (v === "no-drag") return false;
    }
    return false;
  };
  const 찍기 = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? { 무엇: el.tagName + "." + String(el.className || "").slice(0, 24), 끌림: 끌수있나(el) } : null;
  };
  const bar = document.querySelector(".tabbar");
  const rect = bar ? bar.getBoundingClientRect() : null;
  const 탭 = document.querySelector(".tabbar .tab");
  const 버튼 = document.getElementById("tbCloseAll");
  const 가운데 = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; };
  return {
    빈자리: rect ? 찍기(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2)) : null,
    탭: 탭 ? 찍기(...가운데(탭)) : "탭 없음",
    버튼: 버튼 ? 찍기(...가운데(버튼)) : "버튼 없음",
  };
});
console.log("   " + JSON.stringify(r));

적기("탭 띠 빈자리를 잡으면 창이 끌린다", !!r.빈자리 && r.빈자리.끌림, r.빈자리 ? r.빈자리.무엇 : "");
적기("탭은 그대로 눌린다(끌기 아님)", r.탭 === "탭 없음" || r.탭.끌림 === false, JSON.stringify(r.탭));
적기("버튼도 그대로 눌린다", r.버튼 === "버튼 없음" || r.버튼.끌림 === false, JSON.stringify(r.버튼));

console.log("\n판정: " + (결과.every(Boolean) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((x) => !x).length + "건"));
await b.close();
process.exit(결과.every(Boolean) ? 0 : 1);
