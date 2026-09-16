import { createRequire } from "module"; import path from "path"; import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const dir = path.resolve("mockups", "work-sessions-v3");
const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [f, n] of [["A-analysis-twin","A"],["B-management","B"],["C-console","C"]]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
  await p.goto(pathToFileURL(path.join(dir, f + ".html")).href, { waitUntil: "load" });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(dir, "shot-" + n + ".png"), fullPage: true });
  console.log("캡처:", n);
  await p.close();
}
await b.close();
