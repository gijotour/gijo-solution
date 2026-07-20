// tools/office-cta-e2e.mjs — 사무실 창 CTA(운영 시작) 실 디스패치 + 레일 진입점 확인.
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const OUT = path.join(ROOT, "mockups", "ai-team-office");
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

const browser = await chromium.connectOverCDP("http://localhost:9223");
const ctx = browser.contexts()[0];

// ① 레일 진입점: 메인 창을 agent.html로 보내 항목 확인
const mainPage = ctx.pages().find((p) => !p.url().includes("office.html"));
await mainPage.evaluate(() => window.gijo.navigateTo("agent.html")).catch(() => {});
await sleep(3000);
const agentPage = ctx.pages().find((p) => p.url().includes("agent.html"));
if (agentPage) {
  await agentPage.click(".gn-ic[title='AI']").catch(() => {});
  await sleep(500);
  const item = await agentPage.$("text=🏢 팀 사무실 (창)");
  console.log(item ? "✓ 사이드바(레일) 진입점 존재" : "✗ 사이드바 진입점 없음");
  if (item) { await item.click(); await sleep(1200); } // 이미 열린 창 focus 재사용도 확인
}

// ② CTA — 열린 사무실 창에서 실행. 미완료 할일이 있으므로 실제 오케스트레이터 지시가 나간다.
const office = ctx.pages().find((p) => p.url().includes("office.html"));
if (!office) throw new Error("사무실 창 없음");
const feedBefore = await office.textContent("#feed");
await office.click("#ctaBtn");
console.log("CTA 클릭 — 오케스트레이터 응답 대기(최대 150초)…");
let ok = false;
for (let i = 0; i < 50; i++) {
  await sleep(3000);
  const feedNow = await office.textContent("#feed");
  if (feedNow.length > feedBefore.length + 10 && !(await office.$eval("#ctaBtn", (b) => b.disabled))) { ok = true; break; }
}
const feedFinal = (await office.textContent("#feed")).trim().replace(/\s+/g, " ");
console.log(ok ? "✓ 디스패치 응답 수신" : "✗ 150초 내 응답 없음(서버 LLM 상태 확인 필요)");
console.log("피드 내용:", feedFinal.slice(0, 400));
await office.screenshot({ path: path.join(OUT, "live-office-cta.png") });
console.log("스크린샷: live-office-cta.png");
await browser.close();
