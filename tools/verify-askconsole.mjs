// 「대화창에서 이어서 지시하기」가 **정말 대화창에 닿는가** — 실앱에서 누르고 확인한다.
// 보내는 길만 만들고 받는 쪽이 없어 "눌러도 아무 일 없음"이 되는 것이 이 저장소 단골 사고라,
// 소스가 아니라 **누른 뒤 대화창 입력칸/대화에 글이 들어왔는지**로 판정한다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
let p = ctx.pages().find((x) => !x.url().startsWith("devtools://"));
console.log("설치본:", p.url().includes("app.asar"), "| url:", p.url().split("/").pop());

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
await p.waitForTimeout(2500);

const 결과 = [];
function 적기(이름, 통과, 비고) {
  결과.push({ 이름, 통과, 비고 });
  console.log((통과 ? "✅ " : "❌ ") + 이름 + (비고 ? " — " + 비고 : ""));
}

// ① 통로가 실제로 뚫려 있나 — preload에 askConsole이 있고, 대화창이 받아서 입력칸을 채우는가.
const 통로 = await p.evaluate(() => ({
  askConsole: !!(window.gijo && window.gijo.askConsole),
  onConsoleAsk: !!(window.gijo && window.gijo.onConsoleAsk),
  gijoConsole: !!window.gijoConsole,
}));
적기("askConsole 통로가 있다", 통로.askConsole && 통로.onConsoleAsk, JSON.stringify(통로));

// ② 실제로 보내 본다. 빈 글이면 커서만, 글이 있으면 대화창에 들어가야 한다.
//    ⚠ 진짜 지시를 보내면 LLM이 돌아 오래 걸리고 데이터도 바뀐다 — ask()가 입력칸을 채우는지까지만
//    본 뒤 곧바로 지운다. "닿았는가"가 이 시험의 질문이다.
// ⚠ window.gijoConsole.submit을 갈아끼우는 건 **안 통한다**(첫 판에 이걸로 헛짚었다) —
//   console.js의 ask()는 클로저 안의 submit을 부르지 창밖에 내놓은 것을 부르지 않는다.
//   대신 입력칸의 value를 가로챈다: 쓰는 값은 붙잡아 두고, 읽을 땐 빈 문자열을 돌려준다.
//   submit()이 빈 값이면 그냥 돌아가므로(755행) **진짜 지시는 나가지 않는다.**
// ⚠ 대화창은 **셸 아래에 있을 수도, 창으로 빠져 있을 수도** 있다. 어느 쪽에 있든 지금 보이는
//   쪽으로 가는 것이 이 기능의 요점이라, 두 창에 다 덫을 놓고 **어느 하나가 받으면 통과**로 본다.
//   (첫 판엔 셸만 보다가 "안 닿는다"고 헛짚었다 — 실제로는 콘솔 창이 받고 있었다.)
const 대화창들 = ctx.pages().filter((x) => /app\.html|console\.html/.test(x.url()));
console.log("   대화창 후보:", 대화창들.map((x) => x.url().split("/").pop()).join(", "));

const 넣은글 = "확인용-" + Date.now();
const 덫놓기 = (page) => page.evaluate(() => {
  window.__닿음 = null;
  const i = document.getElementById("chatInput");
  if (!i) return false;
  Object.defineProperty(i, "value", {
    configurable: true,
    get() { return ""; }, // submit()이 빈 값이면 돌아간다 → 진짜 지시는 안 나간다
    set(v) { window.__닿음 = v; },
  });
  return true;
});
const 덫회수 = (page) => page.evaluate(() => {
  const v = window.__닿음;
  const i = document.getElementById("chatInput");
  if (i) delete i.value;
  return v;
});

for (const page of 대화창들) await 덫놓기(page);
await p.evaluate((글) => window.gijo.askConsole(글), 넣은글);
await p.waitForTimeout(1800);
const 받은것 = [];
for (const page of 대화창들) 받은것.push({ 창: page.url().split("/").pop(), 글: await 덫회수(page) });
const 닿음 = (받은것.find((x) => x.글 === 넣은글) || {}).글 ?? null;
console.log("   창별 수신:", JSON.stringify(받은것));
적기("보낸 글이 대화창에 닿는다", 닿음 === 넣은글, "받은 글: " + JSON.stringify(닿음));

// ③ 빈 글은 보내지 않는다(할 말을 안 정한 사람에게 빈 지시를 던지면 AI가 엉뚱한 답을 만든다).
for (const page of 대화창들) await 덫놓기(page);
await p.evaluate(() => window.gijo.askConsole(""));
await p.waitForTimeout(1200);
const 빈수신 = [];
for (const page of 대화창들) 빈수신.push(await 덫회수(page));
const 빈전송 = 빈수신.find((v) => v != null) ?? null;
적기("빈 글은 보내지 않는다", 빈전송 === null, "입력칸에 들어온 값=" + JSON.stringify(빈전송));

// ④ 작업 내역 화면에 버튼이 실제로 보이고, 옛 입력칸은 사라졌는가.
await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
await p.waitForTimeout(400);
await p.evaluate(() => {
  const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) =>
    /작업 내역|작업내역/.test(e.querySelector(".gn-label")?.textContent || ""));
  it?.querySelector(".gn-label").click();
});
await p.waitForTimeout(6500);
const 세션화면 = await p.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  const d = f && f.contentDocument;
  if (!d) return { 못봄: true };
  return {
    버튼: !!d.getElementById("goConsoleBtn"),
    버튼글: (d.getElementById("goConsoleBtn") || {}).textContent || "",
    옛입력칸: !!d.getElementById("chatInput"),
    옛보내기: !!d.getElementById("sendBtn"),
  };
});
적기("작업 내역: 버튼 있고 옛 입력칸 없다",
  세션화면.버튼 && !세션화면.옛입력칸 && !세션화면.옛보내기, JSON.stringify(세션화면));

console.log("\n판정: " + (결과.every((r) => r.통과) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((r) => !r.통과).length + "건"));
await b.close();
process.exit(결과.every((r) => r.통과) ? 0 : 1);
