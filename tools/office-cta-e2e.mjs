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
  // ⚠ 예전엔 여기서 `.gn-ic[title='AI']`를 눌러 그룹을 폈다. 두 가지가 달라져 **죽은 줄**이 됐다
  //   (2026-08-05 검토): ① 팀 사무실은 스크롤 밖 **고정 자리**(gn-pin)로 올라가 펼 필요가 없고,
  //   ② 아이콘이 이모지에서 단선 SVG(.gn-ic, title 없음)로 바뀌어 저 선택자는 아무것도 못 잡는다.
  //   `.catch(() => {})`가 감싸고 있어 헛클릭이 조용히 넘어갔다 — 없애는 게 맞다.
  //   같은 이유로 항목 글자에서도 🏢가 빠졌다. 이모지를 박은 선택자는 아이콘이 바뀔 때마다
  //   깨지므로, **바뀌지 않는 이름**으로 찾는다.
  const item = await agentPage.$('.gn-item:has-text("팀 사무실")');
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
