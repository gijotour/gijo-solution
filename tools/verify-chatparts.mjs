// 공용 부품으로 옮긴 뒤 **지휘소가 그대로 동작하는가** — 리팩터링은 이게 증명이다.
// 근거 원문 · 체크칸 · 가서 하기 셋을 한 번에 본다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");
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
await p.waitForTimeout(2000);

const 부품 = await p.evaluate(() => !!(window.gijoChatParts && window.gijoChatParts.quotes && window.gijoChatParts.picks && window.gijoChatParts.open));
console.log("공용 부품 실려 있나:", 부품 ? "✅" : "❌");

async function 물어(q, 기다림) {
  await p.evaluate((t) => {
    const c = document.getElementById("chatInput");
    c.value = t;
    c.dispatchEvent(new Event("input", { bubbles: true }));
    c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 13 }));
  }, q);
  await p.waitForTimeout(기다림);
}

// ① 근거 원문
await 물어("개인정보 접속기록 보관 기간이 몇 년이야?", 26000);
// ⚠ innerText로 보면 **스크롤 밖 대화는 안 잡힌다** — 붙어 있는데 "없다"고 읽었다(2026-08-01).
//   DOM을 직접 센다. 화면에 그려졌는지는 클래스 존재로 판정하는 것이 정확하다.
let c = await p.evaluate(() => ({ 배지: document.querySelectorAll(".gcp-src").length, 원문: document.querySelectorAll(".gcp-ev").length }));
console.log("① 근거 배지:", c.배지 ? "✅ " + c.배지 + "개" : "❌", "· 근거 원문:", c.원문 ? "✅ " + c.원문 + "개" : "❌");

// ② 체크칸
await 물어("내 할 일 보여줘", 20000);
const 체크 = await p.evaluate(() => ({
  칸: document.querySelectorAll(".gcp-pi").length,
  묶음: document.querySelectorAll(".gcp-pick").length,
  조치: [...document.querySelectorAll(".gcp-pact")].map((b) => b.textContent),
}));
console.log("② 체크칸:", 체크.칸 ? "✅ " + 체크.칸 + "개" : "❌", "· 조치:", 체크.조치.join(", ") || "(없음)");

// ③ 가서 하기
await 물어("2차 인증 켜려면 어떻게 해?", 16000);
const 열기 = await p.evaluate(() => {
  const b = [...document.querySelectorAll(".gcp-open")].pop();
  return b ? b.textContent : null;
});
console.log("③ 가서 하기 버튼:", 열기 ? "✅ " + 열기 : "❌ 없음");

await p.screenshot({ path: process.env.SP + "/chatparts.png" });
await b.close();
