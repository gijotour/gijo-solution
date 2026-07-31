// 유지보수 점검 화면 실검증 — 렌더 + 필터 + 담기 + 챗봇 안내.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const OUT = process.env.SP;
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
if (/login\.html/.test(p.url())) {
  await p.fill("#username", "claude-deploy").catch(() => {});
  await p.fill("#password", process.env.GIJO_ADMIN_PASSWORD).catch(() => {});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(6000);
  const f = await p.$('button:has-text("강제"), button:has-text("계속")');
  if (f) { await f.click(); await p.waitForTimeout(4000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
p.on("dialog", (d) => d.accept().catch(() => {}));
await p.waitForTimeout(1500);

await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
await p.waitForTimeout(400);
const 있나 = await p.evaluate(() =>
  [...document.querySelectorAll("#gijoNav .gn-label")].map((e) => e.textContent.trim()).includes("유지보수 점검"));
console.log("메뉴에 있나:", 있나);
await p.evaluate(() => {
  const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent.trim() === "유지보수 점검");
  it?.querySelector(".gn-label").click();
});
await p.waitForTimeout(5500);

const r = await p.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  if (!f) return { err: "활성 탭 없음" };
  const d = f.contentDocument;
  return {
    화면: f.getAttribute("src"),
    카드: [...d.querySelectorAll(".card")].map((c) => c.querySelector(".l").textContent + "=" + c.querySelector(".v").textContent),
    줄수: d.querySelectorAll(".tbl tbody tr").length,
    할일: [...d.querySelectorAll(".trow .w")].map((w) => w.innerText.split("\n")[0]),
    경고: d.querySelector(".ident .warn")?.textContent.trim(),
    버튼종류: [...new Set([...d.querySelectorAll(".acts .btn")].map((x) => x.textContent))],
  };
});
console.log("화면:", r.화면);
console.log("요약 카드:", (r.카드 || []).join(" | "));
console.log("정체성 경고:", r.경고);
console.log("표 줄수:", r.줄수);
console.log("지금 손댈 일:", (r.할일 || []).join(" / "));
console.log("줄 버튼:", (r.버튼종류 || []).join(", "));

// ① 카드 필터 — "기한 지남"을 누르면 표가 그 6건만 남아야 한다
await p.evaluate(() => document.querySelector("#screens iframe.on").contentDocument.querySelector('[data-filter="late"]').click());
await p.waitForTimeout(900);
const 걸러짐 = await p.evaluate(() => {
  const d = document.querySelector("#screens iframe.on").contentDocument;
  return { 줄: d.querySelectorAll(".tbl tbody tr").length, 켜진카드: d.querySelector(".card.on .l")?.textContent };
});
console.log("\n[기한 지남] 누른 뒤 → 켜진 카드:", 걸러짐.켜진카드, "· 표 줄수:", 걸러짐.줄);

// ② 할 일 담기 — 실제로 생기나
const 전 = await p.evaluate(async () => (await window.gijo.listTasks()).length);
await p.evaluate(() => document.querySelector("#screens iframe.on").contentDocument.querySelector("[data-todo='0']").click());
await p.waitForTimeout(2500);
const 라벨 = await p.evaluate(() => document.querySelector("#screens iframe.on").contentDocument.querySelector("[data-todo='0']")?.textContent);
const 목록 = await p.evaluate(async () => await window.gijo.listTasks());
const 새것 = 목록[목록.length - 1];
console.log("담기 → 버튼:", 라벨, "· 할 일", 전, "→", 목록.length);
console.log("생긴 것:", 새것 ? `[${새것.priority}] ${새것.text} (ref=${새것.ref})` : "(없음)");
if (목록.length > 전) await p.evaluate((id) => window.gijo.deleteTask(id), 새것.id);

await p.screenshot({ path: OUT + "/maintenance.png" });
await b.close();
