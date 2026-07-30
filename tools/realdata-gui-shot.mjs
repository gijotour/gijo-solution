// 실데이터가 실제 화면에 뜨는지 육안 확인 — 분석허브·취약점 페이지 스크린샷.
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
const require = createRequire(pathToFileURL("D:/Connect AI/client/package.json"));
const { chromium } = require("playwright-core");
const OUT = "D:/Connect AI/mockups/ai-team-office";
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

let browser;
for (let i = 0; i < 25; i++) { try { browser = await chromium.connectOverCDP("http://localhost:9224"); break; } catch { await sleep(800); } }
const ctx = browser.contexts()[0];
let page = ctx.pages()[0];
if (page.url().includes("login")) {
  await page.fill("#serverUrl", "http://127.0.0.1:4100").catch(() => {});
  await page.fill("#username", "jyh");
  await page.fill("#password", "changeme");
  await page.click("#loginBtn");
  await sleep(2500);
  const f = await page.$("text=강제 로그인"); if (f) { await f.click(); await sleep(2500); }
  page = ctx.pages()[0];
}
await page.setViewportSize({ width: 1600, height: 950 }).catch(() => {});

for (const [pg, name] of [["analysis.html", "realdata-analysis"], ["vulnscan.html", "realdata-vulnscan"]]) {
  const cur = ctx.pages()[0];
  await cur.evaluate((p) => window.gijo.navigateTo(p), pg).catch(() => {});
  await sleep(4000);
  const pp = ctx.pages().find((x) => x.url().includes(pg)) || ctx.pages()[0];
  await pp.setViewportSize({ width: 1600, height: 950 }).catch(() => {});
  await sleep(1500);
  await pp.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("✓ 캡처:", name);
}
// 실데이터 규모 요약(화면 텍스트에서)
const vpage = ctx.pages().find((x) => x.url().includes("vulnscan.html"));
if (vpage) { const t = (await vpage.textContent("body")).replace(/\s+/g, " "); console.log("취약점 화면 텍스트 일부:", t.slice(0, 300)); }
await (ctx.pages()[0]).evaluate(() => window.gijo.logout()).catch(() => {});
await browser.close();
