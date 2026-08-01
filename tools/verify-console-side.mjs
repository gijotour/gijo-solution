// 대화창이 **넓으면 옆, 좁으면 아래**로 가는가 — 실앱에서 자리를 재서 확인한다.
// 사용자 결정(2026-08-01, 시안 ③): 창 너비 1600px 기준 자동 전환 + 담당자가 언제든 바꾸기.
//
// ⚠ 한 가지로 고정하면 절반의 환경에서 나쁘다(실측): 가로 1920에서 아래 도킹은 세로의 17.6%를
//   먹지만, 세로 모니터(1080×1920)에서는 9.9%뿐이고 옆에 두면 본문이 660px만 남아 표가 깨진다.
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
  await p.waitForTimeout(7000);
  const f = await p.$('button:has-text("강제")');
  if (f) { await f.click(); await p.waitForTimeout(5000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.dismiss().catch(() => {}));
await p.waitForTimeout(1800);

const 결과 = [];
const 적기 = (n, ok, 비고) => { 결과.push(ok); console.log((ok ? "✅ " : "❌ ") + n + (비고 ? " — " + 비고 : "")); };

// ⚠ 대화창이 **창으로 빠져 있으면** 도킹 콘솔이 숨겨져 자리를 잴 수 없다(0×0).
//   첫 판에 그걸 모르고 "아래도 옆도 아니다"라는 판정을 냈다 — 도킹으로 되돌리고 잰다.
if (ctx.pages().some((x) => x.url().includes("console.html"))) {
  await p.evaluate(() => window.gijo.dockConsoleWindow());
  await p.waitForTimeout(2500);
  console.log("   (대화창이 창으로 빠져 있어 아래로 되돌리고 잽니다)");
}

// 자리를 좌표로 잰다 — 클래스만 보면 CSS가 안 먹어도 통과한다(오늘 여러 번 당한 부류).
const 잰다 = () => p.evaluate(() => {
  const 화면 = document.getElementById("screens").getBoundingClientRect();
  const 콘솔 = document.getElementById("console").getBoundingClientRect();
  return {
    창폭: window.innerWidth,
    옆인가: 콘솔.left >= 화면.right - 2, // 화면 오른쪽에 붙어 있으면 옆
    아래인가: 콘솔.top >= 화면.bottom - 2,
    콘솔: { w: Math.round(콘솔.width), h: Math.round(콘솔.height) },
    본문: { w: Math.round(화면.width), h: Math.round(화면.height) },
    버튼: (document.getElementById("tbConsoleSide") || {}).textContent,
  };
});

const 처음 = await 잰다();
console.log("   지금:", JSON.stringify(처음));
const 넓나 = 처음.창폭 >= 1600;
적기(
  넓나 ? "넓은 창이라 옆에 선다" : "좁은 창이라 아래에 붙는다",
  넓나 ? 처음.옆인가 : 처음.아래인가,
  `창폭 ${처음.창폭}`,
);
적기("본문이 표를 그릴 만큼 남는다", 처음.본문.w >= 900, `본문 ${처음.본문.w}px`);

// 담당자가 바꾸면 반대로 가야 한다.
await p.evaluate(() => document.getElementById("tbConsoleSide").click());
await p.waitForTimeout(900);
const 바꾼뒤 = await 잰다();
console.log("   바꾼 뒤:", JSON.stringify(바꾼뒤));
적기("버튼을 누르면 반대쪽으로 간다", 바꾼뒤.옆인가 !== 처음.옆인가, `${처음.옆인가 ? "옆" : "아래"} → ${바꾼뒤.옆인가 ? "옆" : "아래"}`);
적기("버튼 글자가 다음 방향을 가리킨다", String(바꾼뒤.버튼 || "") !== String(처음.버튼 || ""), `${처음.버튼} → ${바꾼뒤.버튼}`);
적기("어느 자리든 본문이 900px 이상 남는다", 바꾼뒤.본문.w >= 900, `본문 ${바꾼뒤.본문.w}px`);

// ★ 대화창을 창으로 빼면 **빈 칸이 남으면 안 된다**(실측 결함: 본문만 1196→816으로 줄었다).
await p.evaluate(() => window.gijo.openConsoleWindow());
await p.waitForTimeout(2500);
const 분리 = await 잰다();
console.log("   창으로 뺀 뒤:", JSON.stringify(분리));
적기("창으로 빼면 본문이 폭을 되찾는다", 분리.본문.w >= 처음.본문.w - 8, `본문 ${분리.본문.w}px (도킹 때 ${처음.본문.w})`);
await p.evaluate(() => window.gijo.dockConsoleWindow());
await p.waitForTimeout(2000);

// 되돌려 놓는다 — 검증이 담당자 설정을 바꿔 놓고 가면 안 된다.
await p.evaluate(() => { try { localStorage.removeItem("gijo:console:side"); } catch (e) {} });
await p.evaluate(() => window.dispatchEvent(new Event("resize")));

console.log("\n판정: " + (결과.every(Boolean) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((x) => !x).length + "건"));
await b.close();
process.exit(결과.every(Boolean) ? 0 : 1);
