// tools/dash-tweaks-e2e.mjs — 대시보드 3종 수정 검증:
// ① 내 업무 바로가기 6열 대형 타일 ② 작업 세션 행(일자·주체·진행) + ✓완료→리포트 ③ 전송 독 소형.
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
if (!browser) throw new Error("CDP 연결 실패");
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
await page.setViewportSize({ width: 1600, height: 950 }).catch(() => {});
await sleep(2500);

// ① 메뉴 그리드 6열 확인
const cols = await page.$eval(".dm-grid", (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
console.log(cols === 6 ? "✓ 업무 바로가기 6열" : `✗ 그리드 열수 ${cols}`);

// ③ 전송 독 크기
const sendH = await page.$eval("#dockSend", (el) => el.offsetHeight);
console.log(sendH <= 30 ? `✓ 전송 버튼 소형(${sendH}px)` : `✗ 전송 버튼 ${sendH}px`);

// ② 작업 세션 — 아코디언 펼치고 세션 준비(없으면 생성+턴)
await page.click("[data-acc='sessions']").catch(() => {});
await sleep(800);
let rows = await page.$$(".dash-sitem2");
if (!rows.length) {
  await page.evaluate(async () => {
    const s = await window.gijo.createWorkSession("검증용 세션");
    await window.gijo.addWorkSessionTurn(s.id, "user", "취약점 우선순위 정리해줘");
    await window.gijo.addWorkSessionTurn(s.id, "assistant", "KEV 2건이 최우선입니다.", "today");
  });
  await page.reload(); await sleep(2500);
  await page.click("[data-acc='sessions']").catch(() => {});
  await sleep(800);
  rows = await page.$$(".dash-sitem2");
}
console.log(`세션 행 ${rows.length}개`);
const meta = rows.length ? await rows[0].$eval(".s-r2", (el) => el.textContent) : "";
console.log("첫 행 메타:", meta.trim());
if (!/\d+\.\d+ \d+:\d+/.test(meta)) throw new Error("일자 표기 없음");
if (!/나|AI 팀|—/.test(meta)) throw new Error("주체 표기 없음");
if (!/진행중|완료|무시/.test(meta)) throw new Error("진행상태 표기 없음");
console.log("✓ 일자·주체·진행상태 표기");

await page.screenshot({ path: path.join(OUT, "live-dash-tweaks.png") });

// ✓ 완료 → 리포트 생성 확인
const before = await page.evaluate(() => window.gijo.listReportHistory());
const activeRow = await page.$(".dash-sitem2:not(.st-done)");
if (activeRow) {
  await activeRow.scrollIntoViewIfNeeded();
  await activeRow.hover();
  await (await activeRow.$(".s-done")).click();
  await sleep(2200);
  const note = await page.$(".dash-srep");
  console.log(note ? "✓ 리포트 생성 알림 표시" : "✗ 알림 없음");
  const after = await page.evaluate(() => window.gijo.listReportHistory());
  const newSession = after.filter((r) => r.type === "session").length - before.filter((r) => r.type === "session").length;
  console.log(newSession >= 1 ? `✓ 세션 리포트 이력 등록(+${newSession})` : "✗ 이력에 세션 리포트 없음");
  const latest = after.find((r) => r.type === "session");
  if (latest) console.log("  →", latest.base, "/", latest.summary?.slice(0, 60));
  await page.screenshot({ path: path.join(OUT, "live-dash-session-report.png") });
} else {
  console.log("⚠ 진행중 세션 없음 — 완료 테스트 생략");
}

await page.evaluate(() => window.gijo.logout()).catch(() => {});
console.log("세션 반납 완료");
await browser.close();
