// tools/gui-walkthrough.mjs — 실행 중인 Electron 앱(CDP :9223)에 붙어 로그인 후 전 화면을 순회하며
// 실제 GUI 스크린샷을 찍는다(스텁 아님 — 진짜 앱·진짜 서버·진짜 데이터). 육안 검증용.
import * as fs from "fs";
import { account } from "./qa-account.mjs";
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const OUT = path.join(ROOT, "mockups", "gui-walkthrough");
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["dashboard.html", "01-dashboard"],
  ["kpi.html", "02-kpi"],
  ["inventory.html", "03-inventory"],
  ["sbom.html", "04-sbom-aibom"],
  ["vulnscan.html", "05-vulnscan"],
  ["approvals.html", "06-approvals"],
  ["threat.html", "07-threat"],
  ["products.html", "08-products"],
  ["report.html", "09-report"],
  ["compliance.html", "10-compliance"],
  ["agent.html", "11-agent"],
  ["memory.html", "12-memory"],
  ["settings.html", "14-settings"],
];

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function main() {
  // Electron 창이 뜰 때까지 CDP 재시도
  let browser;
  for (let i = 0; i < 20; i++) {
    try {
      browser = await chromium.connectOverCDP("http://localhost:9223");
      break;
    } catch {
      await sleep(800);
    }
  }
  if (!browser) throw new Error("CDP(9223) 연결 실패 — Electron 미기동?");
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) throw new Error("페이지 없음");
  console.log("연결됨:", page.url());

  // 로그인 화면이면 로그인
  // ⚠ 계정을 여기 박지 않는다 — tools/qa-account.mjs 한 곳에서 환경변수로 읽는다.
  //   예전엔 jyh/changeme가 박혀 있었다. 감시 시험(no-hardcoded-credentials)이 changeme를
  //   「공개된 초기값」으로 일부러 넘겨 주기 때문에 걸리지 않았고, 그래서 남아 있었다.
  //   비밀번호를 바꾼 기계에서는 이 도구가 조용히 로그인에 실패한다(2026-08-09 실측).
  if (page.url().includes("login")) {
    const { user, pass } = account("화면 순회 촬영");
    await page.fill("#serverUrl", "http://localhost:4000").catch(() => {});
    await page.fill("#username", user);
    await page.fill("#password", pass);
    await page.click("#loginBtn");
    await sleep(2500);
    page = ctx.pages()[0];
    console.log("로그인 후:", page.url());
  }

  for (const [file, name] of PAGES) {
    try {
      await page.evaluate((f) => window.gijo.navigateTo(f), file);
    } catch {
      /* navigate 중 컨텍스트 파괴 — 새 로드로 계속 */
    }
    await sleep(1800);
    page = ctx.pages()[0]; // loadFile 후 같은 target 재사용이지만 안전하게 재취득
    // 대시보드 첫 방문 온보딩 오버레이가 덮으면 닫는다(육안검증은 각 화면 본문이 목적).
    await page
      .evaluate(() => {
        const h = window.__gijoOnboarding;
        if (h && typeof h.close === "function") h.close();
        const ov = document.getElementById("gijoOnboardingOverlay");
        if (ov) ov.remove();
      })
      .catch(() => {});
    await sleep(300);
    const out = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: out });
    console.log("✓", name, "|", page.url().split(/[\\/]/).pop());
  }
  console.log("완료:", OUT);
  await browser.close();
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
