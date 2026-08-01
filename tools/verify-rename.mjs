// 사용자에게 **보이는 글자**에 옛 이름이 남았는가 — 소스가 아니라 화면으로 판정한다.
// (소스에는 CSS 주석의 "챗봇"이 남아 있지만 그건 안 보인다.)
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
console.log("설치본:", p.url().includes("app.asar"));
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

// ⚠ **데이터에 든 이름은 우리 용어가 아니다**(2026-08-01 거짓 실패).
//   "보안 상담 챗봇"·"고객상담 RAG 챗봇"은 담당자가 등록한 **AI 자산 이름**이다 —
//   고객이 자기 시스템을 그렇게 부르는 것을 우리가 바꿀 수 없고, 바꿔서도 안 된다.
//   우리 UI 용어로 쓰인 것만 잡으려면 **자산 이름 꼴을 뺀 뒤** 본다.
const 자산이름 = /[가-힣A-Za-z0-9()\-]*\s*(상담|RAG|서비스|봇)\s*챗봇|보안\s*상담\s*챗봇/g;
const 옛이름 = /챗봇|명령창|컴포저/;
const 걸림 = [];
const 화면 = ["대시보드", "보안 KPI", "기억·학습 (RAG)", "취약점", "유지보수 점검", "터미널 (CLI)", "자산 통합 뷰"];
for (const 라벨 of 화면) {
  await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
  await p.waitForTimeout(400);
  await p.evaluate((lab) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent.trim() === lab);
    it?.querySelector(".gn-label").click();
  }, 라벨);
  await p.waitForTimeout(6000);
  const t = await p.evaluate(() => {
    const f = document.querySelector("#screens iframe.on");
    return f && f.contentDocument ? f.contentDocument.body.innerText : "";
  });
  const 정리 = t.replace(자산이름, "");
  const m = 정리.match(옛이름);
  console.log((m ? "❌" : "✅") + " " + 라벨 + (m ? " — 화면에 '" + m[0] + "'이 보인다" : ""));
  if (m) 걸림.push(라벨 + ": " + t.slice(Math.max(0, t.indexOf(m[0]) - 40), t.indexOf(m[0]) + 40).replace(/\n/g, " "));
}
// 셸 자체(대화창 영역 포함)
const shell = await p.evaluate(() => document.body.innerText);
const sm = shell.replace(자산이름, "").match(옛이름);
console.log((sm ? "❌" : "✅") + " 셸·대화창" + (sm ? " — '" + sm[0] + "'" : ""));

console.log("\n판정:", 걸림.length || sm ? "❌ 옛 이름이 화면에 남았다" : "✅ 화면에 옛 이름 없음");
걸림.forEach((x) => console.log("  " + x));
await b.close();
