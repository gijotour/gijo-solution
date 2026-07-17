import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const dir = path.resolve("mockups", "explorer");
const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [f, n] of [["plan1-inline", "1"], ["plan2-popover", "2"], ["plan3-detail", "3"]]) {
  const p = await b.newPage({ viewport: { width: 1160, height: 1010 }, deviceScaleFactor: 2 });
  await p.goto(pathToFileURL(path.join(dir, f + ".html")).href, { waitUntil: "load" });
  await p.waitForTimeout(500);
  const out = path.join(dir, "shot-" + n + ".png");
  await p.screenshot({ path: out });
  console.log("캡처:", out);
  await p.close();
}
await b.close();
