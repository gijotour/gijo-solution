// tools/shot-report-scheduling-mockups.mjs — 리포트 스케줄 관리 시안 3종(자체완결 HTML)을 PNG로 캡처.
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const DIR = path.join(ROOT, "mockups", "report-scheduling");
const FILES = [
  ["reportScheduleA-stack.html", "variant-A.png", 1080],
  ["reportScheduleB-master-detail.html", "variant-B.png", 1140],
  ["reportScheduleC-dashboard-chat.html", "variant-C.png", 1220],
];

const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [file, out, width] of FILES) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(DIR, file)).href, { waitUntil: "load" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR, out), fullPage: true });
  console.log("saved:", out);
  await page.close();
}
await browser.close();
