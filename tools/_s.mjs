const { createRequire } = await import("node:module");
const require_ = createRequire(new URL("../server/package.json", import.meta.url));
const { chromium } = require_("playwright-core");
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const shell = ctx.pages().find(p => { try { return p.url().includes("app.html"); } catch { return false; } });
await shell.screenshot({ path: ".tmp-reports/kv-after.png" });
console.log("ok"); await b.close();
