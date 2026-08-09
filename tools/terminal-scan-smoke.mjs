// tools/terminal-scan-smoke.mjs — 실행 중 Electron 앱(CDP :9223)에 붙어 터미널 화면의
// "국내 CCE 점검" 칩을 실제 클릭하고, 하드닝 리포트 카드가 렌더되는지 확인한다(진짜 앱·진짜 서버).
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const { account } = await import(pathToFileURL(path.join(ROOT, "tools", "qa-account.mjs")).href);
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const { user: USER, pass: PASS } = account("터미널 화면 스모크");

async function main() {
  let browser;
  for (let i = 0; i < 20; i++) {
    try { browser = await chromium.connectOverCDP("http://localhost:9223"); break; } catch { await sleep(800); }
  }
  if (!browser) throw new Error("CDP 연결 실패");
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  ctx.on("dialog", (d) => d.accept().catch(() => {})); // 중복로그인 확인 등 자동 수락
  page.on("dialog", (d) => d.accept().catch(() => {}));
  console.log("연결됨:", page.url());

  if (page.url().includes("login")) {
    await page.fill("#serverUrl", "http://localhost:4000").catch(() => {});
    await page.fill("#username", USER);
    await page.fill("#password", PASS);
    await page.click("#loginBtn");
    await sleep(3000);
    page = ctx.pages()[0];
    console.log("로그인 후:", page.url().split(/[\\/]/).pop());
  }

  // 터미널 화면으로 이동
  await page.evaluate(() => window.gijo.navigateTo("terminal.html")).catch(() => {});
  await sleep(2500);
  page = ctx.pages()[0];
  console.log("현재 화면:", page.url().split(/[\\/]/).pop());

  // "국내 CCE 점검" 칩 클릭 (data-scan=kisa)
  const chip = await page.$('.chip[data-scan="kisa"]');
  if (!chip) throw new Error("CCE 점검 칩을 찾지 못함 — 렌더 실패");
  console.log("칩 발견 — 클릭");
  await chip.click();

  // 리포트 카드가 뜰 때까지 대기(최대 25초)
  let cardText = "";
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    cardText = await page.evaluate(() => {
      const r = document.querySelector("#proposeSlot .report");
      return r ? r.innerText : "";
    });
    if (cardText.includes("준수율") || cardText.includes("%")) break;
  }
  const termText = await page.evaluate(() => document.getElementById("termOut")?.innerText || "");

  console.log("\n===== 리포트 카드(발췌) =====");
  console.log(cardText.slice(0, 700) || "(카드 미렌더)");
  console.log("\n===== 터미널 출력(발췌) =====");
  console.log(termText.slice(-400) || "(터미널 출력 없음)");

  const rowCount = await page.evaluate(() => document.querySelectorAll("#proposeSlot .report tbody tr").length);
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll("#proposeSlot .report .grp .gname")].map((e) => e.textContent)
  );
  console.log("\n판정: 표 행 수 =", rowCount, "· 분류 그룹 =", JSON.stringify(groups),
    rowCount >= 10 && groups.length >= 3 ? "→ ✅ 그룹핑 렌더 성공" : "→ ⚠ 확인 필요");

  await page.screenshot({ path: path.join(ROOT, "mockups", "device-hardening", "terminal-scan-gui.png") }).catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
