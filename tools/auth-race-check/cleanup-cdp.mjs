// 검증 후 정리 — 사무실 창 닫고 메인 창을 로그인 화면으로(시험서버 로그아웃).
// 이후 앱에서 운영 서버(localhost:4000)로 다시 로그인하면 된다.
import { createRequire } from "module";
const require = createRequire(new URL("../../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = browser.contexts()[0];
for (const p of ctx.pages()) {
  if (p.url().includes("office.html")) { await p.close().catch(() => {}); console.log("office 창 닫음"); }
}
const main = ctx.pages().find((p) => /dashboard\.html|hub\.html/.test(p.url()));
if (main) {
  await main.evaluate(() => { try { window.gijo.logout().catch(() => {}); } catch {} setTimeout(() => window.gijo.navigateTo("login.html"), 300); }).catch(() => {});
  await main.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {});
  console.log("메인 창 →", main.url().split("/").pop());
}
await browser.close();
