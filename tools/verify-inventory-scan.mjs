// 자산 화면의 [스캔] 버튼이 오케스트레이터를 거치지 않고 **직접 스캔 API**를 부르는가.
// ⚠ 진짜로 누르면 실제 스캔이 돈다. 그래서 누르지 않고, 네트워크 요청을 지켜보다가
//   버튼을 눌렀을 때 /api/assets/<id>/scan 이 뜨는지 본다(/api/dispatch가 뜨면 실패).
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const shell = ctx.pages().find((x) => x.url().includes("app.html"));
if (!shell) { console.log("❌ 셸이 없다"); process.exit(1); }

await shell.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
await shell.waitForTimeout(400);
await shell.evaluate(() => {
  const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) =>
    (e.querySelector(".gn-label")?.textContent || "").trim() === "자산 목록");
  it?.querySelector(".gn-label").click();
});
await shell.waitForTimeout(7000);

const 요청 = [];
shell.on("request", (r) => { if (/\/api\//.test(r.url())) 요청.push(r.method() + " " + r.url().replace(/^https?:\/\/[^/]+/, "")); });

const 눌림 = await shell.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  const d = f && f.contentDocument;
  if (!d) return { 못봄: true };
  const btn = d.querySelector("[data-scan]");
  if (!btn) return { 버튼없음: true, 표본: [...d.querySelectorAll("[data-gen],[data-scan]")].length };
  btn.click();
  return { 눌렀다: btn.textContent, 대상: btn.dataset.scan };
});
await shell.waitForTimeout(6000);

const 스캔호출 = 요청.filter((u) => /\/api\/assets\/.+\/scan/.test(u));
const 디스패치 = 요청.filter((u) => /\/api\/dispatch/.test(u));
console.log("누른 결과:", JSON.stringify(눌림));
console.log("스캔 API 호출:", JSON.stringify(스캔호출));
console.log("오케스트레이터 호출:", JSON.stringify(디스패치));

const ok = !눌림.버튼없음 && !눌림.못봄 && 스캔호출.length > 0 && 디스패치.length === 0;
console.log((ok ? "✅" : "❌") + " 스캔 버튼이 직접 API를 부른다(오케스트레이터 안 거침)");
await b.close();
process.exit(ok ? 0 : 1);
