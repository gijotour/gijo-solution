import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const dir = path.resolve("mockups", "redteam-targets");
const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [f, n] of [["design-A-dropdown","A"],["design-B-matrix","B"],["design-C-asset-embedded","C"]]) {
  const p = await b.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(pathToFileURL(path.join(dir, f + ".html")).href, { waitUntil: "load" });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(dir, "shot-" + n + ".png"), fullPage: true });
  console.log("캡처:", n);
  await p.close();
}
await b.close();
