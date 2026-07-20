// tools/render-mockups.mjs — 실행 중 Electron(CDP :9223)로 목업 HTML을 열어 PNG로 렌더.
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const DIR = path.join(ROOT, "mockups", "device-hardening", "variants");
const FILES = [["variantA-category.html", "A"], ["variantB-status.html", "B"], ["variantC-dashboard.html", "C"]];

let browser;
for (let i = 0; i < 20; i++) { try { browser = await chromium.connectOverCDP("http://localhost:9223"); break; } catch { await sleep(800); } }
if (!browser) throw new Error("CDP 연결 실패");
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
for (const [file, tag] of FILES) {
  await page.goto(pathToFileURL(path.join(DIR, file)).href);
  await sleep(600);
  const el = await page.$(".report");
  const out = path.join(DIR, `report-variant-${tag}.png`);
  await (el || page).screenshot({ path: out });
  console.log("✓ 렌더:", out);
}
await browser.close();
