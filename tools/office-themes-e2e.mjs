// tools/office-themes-e2e.mjs — 사무실 아트 v2 3테마 육안 검증 + 기존 동작(접속자·협업 이동) 회귀 확인.
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const OUT = path.join(ROOT, "mockups", "ai-team-office");
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

let browser;
for (let i = 0; i < 25; i++) {
  try { browser = await chromium.connectOverCDP("http://localhost:9224"); break; } catch { await sleep(800); }
}
if (!browser) throw new Error("CDP(9224) 연결 실패");
const ctx = browser.contexts()[0];
let page = ctx.pages()[0];
if (page.url().includes("login")) {
  await page.fill("#serverUrl", "http://127.0.0.1:4100").catch(() => {});
  await page.fill("#username", "jyh");
  await page.fill("#password", "changeme");
  await page.click("#loginBtn");
  await sleep(2500);
  const forceBtn = await page.$("text=강제 로그인");
  if (forceBtn) { await forceBtn.click(); await sleep(2500); }
  page = ctx.pages()[0];
}
if (page.url().includes("login")) throw new Error("로그인 실패");

await page.click("#officeBtn");
await sleep(3500);
const office = ctx.pages().find((p) => p.url().includes("office.html"));
if (!office) throw new Error("사무실 창 안 열림");
await office.setViewportSize({ width: 1000, height: 760 }).catch(() => {});

// 콘솔 에러 수집(렌더러 JS 오류 회귀 감지)
const errors = [];
office.on("pageerror", (e) => errors.push(String(e)));

// 기본 로드 + 자기 자신 입장 대기
await sleep(5000);
const stat = await office.textContent("#statLine");
console.log("상태줄:", stat.trim());
if (!/작업중/.test(stat)) throw new Error("에이전트 로드 실패");

// 협업 이동 + 파티클 유발(움직임 확인용)
await office.evaluate(() => { window.__office.collabMove("Scan", "Report", "하드닝 결과 4건 전달"); window.__office.sparkle(); });
await sleep(1200);

// 테마 3종 캡처
for (const th of ["neon", "cozy", "deep"]) {
  await office.evaluate((name) => window.__office.setTheme(name), th);
  await sleep(700);
  await office.screenshot({ path: path.join(OUT, `live-theme-${th}.png`) });
  console.log("✓ 캡처:", th);
}
// 선택 저장 확인
const saved = await office.evaluate(() => localStorage.getItem("gijo:office:theme"));
console.log("저장된 테마:", saved);
console.log("렌더러 JS 오류:", errors.length ? errors.join(" | ") : "없음");
await office.evaluate(() => window.gijo.logout()).catch(() => {});
console.log("세션 반납 완료");
await browser.close();
