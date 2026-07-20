// tools/ai-team-office-shots.mjs — AI 팀 사무실 시안 3종을 PNG로 렌더 (Edge headless).
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const DIR = path.join(ROOT, "mockups", "ai-team-office");
const FILES = [
  ["variant-a-modal.html", "variant-a.png", { width: 1100, height: 900 }],
  ["variant-b-window.html", "variant-b.png", { width: 1100, height: 900 }],
  ["variant-c-widget.html", "variant-c.png", { width: 1100, height: 1450 }],
];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
for (const [file, out, viewport] of FILES) {
  await page.setViewportSize(viewport);
  await page.goto(pathToFileURL(path.join(DIR, file)).href);
  await page.waitForTimeout(2600); // 애니메이션·말풍선 뜰 시간
  await page.screenshot({ path: path.join(DIR, out) });
  console.log("✓", out);
}
await browser.close();
