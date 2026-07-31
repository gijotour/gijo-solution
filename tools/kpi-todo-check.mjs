// KPI 「지금 손댈 일」 실화면 확인 — menu-sweep과 같은 경로(메뉴 클릭)로 연다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const OUT = process.env.SP;
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => x.url().includes("app.html"));
if (!p) {
  const any = ctx.pages().find((x) => !/devtools:/.test(x.url()));
  await any.evaluate(() => window.gijo && window.gijo.navigateTo("app.html")).catch(() => {});
  await any.waitForTimeout(4000);
  p = ctx.pages().find((x) => x.url().includes("app.html"));
}
if (!p) { console.error("셸에 못 들어감"); process.exit(2); }
p.on("dialog", (d) => d.accept().catch(() => {}));

const 라벨 = await p.evaluate(() =>
  [...document.querySelectorAll("#gijoNav .gn-label")].map((e) => e.textContent.trim()).filter((t) => /KPI|지표/.test(t))
);
console.log("메뉴에서 찾은 이름:", 라벨.join(", ") || "(없음)");
await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
await p.waitForTimeout(400);
await p.evaluate((lab) => {
  const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent.trim() === lab);
  it?.querySelector(".gn-label").click();
}, 라벨[0]);
await p.waitForTimeout(6000);

const r = await p.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  if (!f) return { err: "활성 탭 없음" };
  const d = f.contentDocument;
  const strip = d.querySelector(".todo-strip");
  return {
    화면: f.getAttribute("src") || f.contentWindow.location.pathname.split("/").pop(),
    타일수: d.querySelectorAll(".tile").length,
    띠있음: !!strip,
    제목: strip?.querySelector(".ts-t")?.innerText,
    빈안내: d.querySelector(".todo-none")?.innerText,
    rows: [...d.querySelectorAll(".todo-row")].map((el) => ({
      글: el.querySelector(".tw")?.innerText.replace(/\n/g, " · ").slice(0, 68),
      담기: el.querySelector("[data-todo]")?.textContent,
      화면: el.querySelector("[data-page]")?.dataset.page,
    })),
  };
});
console.log("\n화면:", r.화면, "| 타일", r.타일수, "개");
console.log("「지금 손댈 일」 띠:", r.띠있음, "|", r.제목 || r.빈안내 || "(없음)");
(r.rows || []).forEach((x, i) => console.log(` ${i + 1}. ${x.글}\n     [${x.담기}] → ${x.화면}`));

if (r.rows?.length) {
  const 전 = await p.evaluate(async () => (await window.gijo.listTasks()).length);
  await p.evaluate(() => document.querySelector("#screens iframe.on").contentDocument.querySelector("[data-todo='0']").click());
  await p.waitForTimeout(2500);
  const 후라벨 = await p.evaluate(() => document.querySelector("#screens iframe.on").contentDocument.querySelector("[data-todo='0']")?.textContent);
  const 목록 = await p.evaluate(async () => await window.gijo.listTasks());
  const 새것 = 목록[목록.length - 1];
  console.log(`\n눌러 봄 → 버튼 "${후라벨}" · 할 일 ${전} → ${목록.length}건`);
  console.log("생긴 것:", 새것 ? `[${새것.priority}] ${새것.text}  (ref=${새것.ref})` : "(없음)");
  const 통과 = 목록.length > 전 && /담김/.test(후라벨 || "");
  console.log("\n판정:", 통과 ? "✅ 눌러서 실제로 할 일이 생긴다" : "❌ 안 생긴다");
  if (통과) { await p.evaluate((id) => window.gijo.deleteTask(id), 새것.id); console.log("(시험으로 만든 할 일 삭제함)"); }
}

// 화면 열기 버튼 — 실제로 그 화면이 열리나
if (r.rows?.length) {
  await p.evaluate(() => document.querySelector('#screens iframe.on').contentDocument.querySelector('.todo-row [data-page]').click());
  await p.waitForTimeout(4000);
  const 간곳 = await p.evaluate(() => {
    const f = document.querySelector('#screens iframe.on');
    return { src: f?.getAttribute('src'), 본문: f?.contentDocument?.body?.innerText?.length || 0 };
  });
  console.log('\n「화면 열기」 누른 뒤 →', 간곳.src, '| 본문', 간곳.본문, '자');
  console.log('판정:', /approvals/.test(간곳.src||'') && 간곳.본문 > 200 ? '✅ 실제로 그 화면이 열린다' : '❌ 안 열린다');
}
await p.screenshot({ path: OUT + '/kpi-todo.png' });
await b.close();
