// tools/shot-inline-chatbot-mockups.mjs — 인라인 챗봇 위젯 시안 3종(자체완결 HTML)을 PNG로 캡처.
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const DIR = path.join(ROOT, "mockups", "inline-chatbot-widget");
const FILES = [
  ["variantA-topbar.html", "variant-A.png", 1140],
  ["variantB-floating.html", "variant-B.png", 1140],
  ["variantC-inlinepanel.html", "variant-C.png", 1140],
];

const browser = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [file, out, width] of FILES) {
  const page = await browser.newPage({ viewport: { width, height: 850 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(DIR, file)).href, { waitUntil: "load" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(DIR, out), fullPage: true });
  console.log("saved:", out);
  await page.close();
}
await browser.close();
