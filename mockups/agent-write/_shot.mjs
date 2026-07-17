import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";
const req = createRequire(path.resolve("client", "package.json"));
const { chromium } = req("playwright-core");
const dir = path.resolve("mockups", "agent-write");
const b = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
for (const [f, n, w] of [["design-A-inline", "A", 820], ["design-B-approval", "B", 820], ["design-C-worksheet", "C", 1060]]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(pathToFileURL(path.join(dir, f + ".html")).href, { waitUntil: "load" });
  await p.waitForTimeout(500);
  const out = path.join(dir, "shot-" + n + ".png");
  await p.screenshot({ path: out, fullPage: true });
  console.log("캡처:", out);
  await p.close();
}
await b.close();
