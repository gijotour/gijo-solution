// 4.13.0 게시 전 실화면 검증 — 이번 변경 화면 + 회귀 표본.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const OUT = process.env.SP;
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
console.log("URL:", p.url());
console.log("★ 설치본인가(app.asar):", p.url().includes("app.asar"));

if (/login\.html/.test(p.url())) {
  await p.fill("#username", "claude-deploy").catch(() => {});
  await p.fill("#password", process.env.GIJO_ADMIN_PASSWORD).catch(() => {});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(6000);
  const f = await p.$('button:has-text("강제"), button:has-text("계속")');
  if (f) { await f.click(); await p.waitForTimeout(4000); }
}
p = ctx.pages().find((x) => x.url().includes("app.html")) || p;
console.log("로그인 후:", p.url().split("/").pop());
p.on("dialog", (d) => d.accept().catch(() => {}));
await p.waitForTimeout(1500);

const 열기 = async (라벨) => {
  await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
  await p.waitForTimeout(400);
  await p.evaluate((lab) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent.trim() === lab);
    it?.querySelector(".gn-label").click();
  }, 라벨);
  // ⚠ 5.5초는 짧다 — 서버를 두 번 부르는 화면(조치·승인·유지보수)이 아직 비어 있어
  //   "렌더 실패"로 오판했다(2026-08-01). 9초로 늘린다.
  await p.waitForTimeout(9000);
  return p.evaluate(() => {
    const f = document.querySelector("#screens iframe.on");
    if (!f) return { err: "활성 탭 없음" };
    const d = f.contentDocument;
    return {
      화면: f.getAttribute("src"),
      본문: d.body.innerText.length,
      띠: !!d.querySelector(".todo-strip"),
      띠줄: d.querySelectorAll(".todo-row").length,
      등급배지: d.querySelectorAll(".dm-grade").length,
      열람등급셀렉트: d.querySelectorAll("[data-clear]").length,
    };
  });
};

const 버전 = await p.evaluate(async () => (await window.gijo.appVersion?.()) ?? "(API 없음)").catch(() => "(오류)");
console.log("앱 버전:", 버전, "\n");

for (const [라벨, 기대] of [["보안 KPI", "띠"], ["유지보수 점검", "띠"], ["기억·학습 (RAG)", "등급배지"], ["관리자", "열람등급셀렉트"], ["조치·승인", null], ["대시보드", null]]) {
  const r = await 열기(라벨);
  const ok = r.err ? false : r.본문 > 200 && (!기대 || r[기대] > 0);
  console.log((ok ? "✅" : "❌") + " " + 라벨.padEnd(14) + JSON.stringify(r));
}
await p.screenshot({ path: OUT + "/verify-4130.png" });
await b.close();
