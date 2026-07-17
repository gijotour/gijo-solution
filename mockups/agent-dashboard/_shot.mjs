import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const dir = path.resolve("mockups", "agent-dashboard");
const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [f, n] of [["design-A-roster","A"],["design-B-command","B"],["design-C-workspace","C"]]) {
  const p = await b.newPage({ viewport: { width: 1160, height: 800 }, deviceScaleFactor: 2 });
  await p.goto(pathToFileURL(path.join(dir, f + ".html")).href, { waitUntil: "load" });
  await p.waitForTimeout(600);
  const out = path.join(dir, "shot-" + n + ".png");
  await p.screenshot({ path: out });
  console.log("캡처:", out);
  await p.close();
}
await b.close();
