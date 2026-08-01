// 근거 원문·근거 배지가 **주 대화창(지휘소, console.js)** 에 뜨는가.
// ⚠ 입력칸은 #chatInput 이다(셸 app.html의 cs-dock). 느슨한 선택자를 쓰면 '화면 찾기'
//   검색창을 잡아 엉뚱한 데 쳐 놓고 "안 뜬다"고 오판한다(2026-08-01 실측).
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

const 있나 = await p.evaluate(() => !!document.getElementById("chatInput"));
console.log("지휘소 입력칸(#chatInput):", 있나);
if (!있나) { console.log("셸 구조가 바뀌었다 — 확인 필요"); await b.close(); process.exit(1); }

await p.evaluate((q) => {
  const c = document.getElementById("chatInput");
  c.value = q;
  c.dispatchEvent(new Event("input", { bubbles: true }));
  c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 13 }));
}, "개인정보 접속기록 보관 기간이 몇 년이야?");
console.log("물었습니다. 답을 기다립니다…");
await p.waitForTimeout(28000);

const r = await p.evaluate(() => {
  const t = document.body.innerText;
  return {
    배지: /📄 근거:/.test(t),
    원문줄: /근거 원문/.test(t),
    답: (t.match(/접속기록[^|]{0,120}/) || [""])[0],
  };
});
console.log("\n📄 근거 배지:", r.배지 ? "✅" : "❌");
console.log("📄 근거 원문 줄:", r.원문줄 ? "✅" : "❌");
console.log("답:", r.답.replace(/\n/g, " ").slice(0, 120));

// 펴 본다 — 접힌 것이 실제로 열리는가
if (r.원문줄) {
  await p.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => /근거 원문/.test(d.textContent) && d.children.length === 0);
    el?.click();
  });
  await p.waitForTimeout(700);
  const 펴짐 = await p.evaluate(() => /보관 기간|시행령|제30조/.test(document.body.innerText.split("근거 원문")[1] || ""));
  console.log("펴 봤을 때 원문 나옴:", 펴짐 ? "✅" : "❌");
}
await p.screenshot({ path: process.env.SP + "/quote-ui.png" });
await b.close();
