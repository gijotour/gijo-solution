import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("app.html"));
const r = await p.evaluate(() => {
  const d = document.querySelector("#screens iframe.on").contentDocument;
  const w = d.getElementById("gijoChatWidget");
  return { 있음: !!w, 내용: w ? w.innerHTML.length : 0, 보임: w ? w.offsetHeight : 0 };
});
console.log("챗 위젯:", JSON.stringify(r));
// 다른 화면(approvals)과 비교 — 이 화면만 안 뜨는 건지 원래 그런 건지
await p.evaluate(() => { window.gijoTabs.closeAll(); });
await p.waitForTimeout(400);
await p.evaluate(() => {
  const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent.trim() === "조치·승인");
  it?.querySelector(".gn-label").click();
});
await p.waitForTimeout(5000);
const r2 = await p.evaluate(() => {
  const d = document.querySelector("#screens iframe.on").contentDocument;
  const w = d.getElementById("gijoChatWidget");
  return { 있음: !!w, 내용: w ? w.innerHTML.length : 0, 보임: w ? w.offsetHeight : 0 };
});
console.log("비교(조치·승인):", JSON.stringify(r2));
await b.close();
