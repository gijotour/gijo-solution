import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("app.html"));
console.log("프레임:", p.frames().map((f) => f.url().split("/").pop().split("?")[0]).join(" | "));
for (const f of p.frames()) {
  const has = await f.evaluate(() => ({ gcw: !!document.getElementById("gcwIn"), widget: !!document.getElementById("gijoChatWidget"), url: location.pathname.split("/").pop() })).catch(() => null);
  if (has) console.log("  ", has.url, "gcwIn:", has.gcw, "위젯div:", has.widget);
}
await b.close();
