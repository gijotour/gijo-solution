// 대화창을 창으로 뺄 때 **셸이 자리를 비켜 주는가** — 겹침이 사라지는지 실측한다.
// ⚠ 예전엔 대화 창이 셸 위를 덮었다(2026-08-01 확인): 모니터 한 대에서 앱을 최대화해 두면
//   오른쪽 4분의 1이 가려졌다. 담당자에겐 "창으로 뺐더니 화면이 잘렸다"로 보인다.
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
  const f = await p.$('button:has-text("강제"), button:has-text("계속")');
  if (f) { await f.click(); await p.waitForTimeout(4000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.dismiss().catch(() => {}));
await p.waitForTimeout(1500);

const 자리 = (pg) => pg.evaluate(() => ({
  x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight,
  화면폭: window.screen.availWidth,
}));
const 겹치나 = (a, c) => a.x < c.x + c.w && a.x + a.w > c.x && a.y < c.y + c.h && a.y + a.h > c.y;

const 결과 = [];
const 적기 = (n, ok, 비고) => { 결과.push(ok); console.log((ok ? "✅ " : "❌ ") + n + (비고 ? " — " + 비고 : "")); };

// 도킹 상태로 맞춘다(이미 창이면 닫는다).
let con = ctx.pages().find((x) => x.url().includes("console.html"));
if (con) {
  await p.evaluate(() => window.gijo.dockConsoleWindow());
  await p.waitForTimeout(2500);
  // ⚠ 닫은 창의 손잡이를 **버려야 한다.** 안 버리면 아래 대기 루프가 "이미 있다"고 보고
  //   닫힌 페이지를 그대로 읽어 "Target page has been closed"로 죽는다(실제로 두 번 당했다).
  con = null;
}

const 전 = await 자리(p);
// 대화 창이 뜰 자리를 미리 계산한다(main.ts와 같은 규칙: 오른쪽 끝 · 화면폭의 28%, 최소 420).
const 예정 = (() => {
  const w = Math.max(420, Math.round(전.화면폭 * 0.28));
  return { x: 전.화면폭 - w, y: 0, w, h: 99999 };
})();
const 겹칠상황 = 겹치나(전, 예정);
console.log("   창으로 빼기 전 셸:", JSON.stringify(전));
console.log("   대화 창이 뜰 자리:", JSON.stringify(예정), "· 겹칠 상황:", 겹칠상황);

await p.evaluate(() => window.gijo.openConsoleWindow());
for (let i = 0; i < 20 && !con; i++) { await p.waitForTimeout(700); con = ctx.pages().find((x) => x.url().includes("console.html")); }
if (!con) { console.log("❌ 대화 창을 못 열었다"); await b.close(); process.exit(1); }
await p.waitForTimeout(1500);

const 셸후 = await 자리(p);
const 콘솔 = await 자리(con);
console.log("   뺀 뒤 셸:", JSON.stringify(셸후));
console.log("   대화 창 :", JSON.stringify(콘솔));

// 나란히 둘 **자리가 있는가**부터 본다. 대화 창을 뺀 뒤 셸에 남는 폭이 900 미만이면
// 밀어 넣지 않는 것이 맞다 — 표가 안 들어가는 폭으로 만드느니 겹치는 게 낫다.
// ⚠ 이 개발 머신은 세로 모니터(1080×1920)라 실제로 자리가 없다(420+900=1320 > 1080).
const 남을폭 = 예정.x - 전.x;
const 자리있나 = 겹칠상황 && 남을폭 >= 900;
console.log("   나란히 둘 자리:", 자리있나 ? `있다(셸 ${남을폭}px)` : `없다(셸이 ${남을폭}px밖에 안 남는다)`);

if (자리있나) {
  적기("두 창이 겹치지 않는다", !겹치나(셸후, 콘솔),
    겹치나(셸후, 콘솔) ? "셸 오른쪽 끝 " + (셸후.x + 셸후.w) + " > 대화창 왼쪽 " + 콘솔.x : "");
  적기("셸이 자리를 내줬다", 셸후.w < 전.w, `${전.w} → ${셸후.w}`);
  적기("셸이 표를 그릴 만큼은 남았다", 셸후.w >= 900, `${셸후.w}px`);
} else {
  // 자리가 없거나 애초에 안 겹치면 **건드리지 않는 것이 정답**이다. 멀쩡한 창을 흔들지 않는다.
  적기("자리가 없으니 셸을 안 건드렸다", 셸후.w === 전.w && 셸후.x === 전.x, `${전.w} → ${셸후.w}`);
}

// 다시 붙이면 원래 자리로 돌아오는가
await p.evaluate(() => window.gijo.dockConsoleWindow());
await p.waitForTimeout(2500);
const 복구 = await 자리(p);
console.log("   다시 붙인 뒤 셸:", JSON.stringify(복구));
적기("도로 붙이면 셸이 원래 폭으로 돌아온다", Math.abs(복구.w - 전.w) <= 8, `${전.w} → ${셸후.w} → ${복구.w}`);

console.log("\n판정: " + (결과.every(Boolean) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((x) => !x).length + "건"));
await b.close();
process.exit(결과.every(Boolean) ? 0 : 1);
