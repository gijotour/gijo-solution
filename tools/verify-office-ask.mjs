// 팀 사무실의 「AI 팀에 맡기기」가 대화창으로 가는가 — 실앱에서 눌러 확인한다.
//
// ⚠ window.gijo는 contextBridge로 노출된 **덮어쓸 수 없는** 객체다. 가짜로 바꿔 무엇을 부르는지
//   보려던 첫 판은 스텁이 조용히 안 먹어 "아무것도 안 불렀다"고 헛짚었다(실제로는 진짜가 돌았다).
//   그래서 **받는 쪽(대화창 입력칸)에 덫을 놓고** 글이 닿는지로 본다. 입력칸 value를 가로채
//   읽을 땐 빈 값을 주므로 submit()이 그냥 돌아간다 — 진짜 지시는 나가지 않는다.
//   할일 등록(addTask)은 막을 수 없으므로 끝나고 지운다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
const 결과 = [];
const 적기 = (n, ok, 비고) => { 결과.push(ok); console.log((ok ? "✅ " : "❌ ") + n + (비고 ? " — " + 비고 : "")); };

let office = ctx.pages().find((x) => x.url().includes("office.html"));
if (!office) {
  const shell = ctx.pages().find((x) => x.url().includes("app.html"));
  if (!shell) { console.log("❌ 셸(app.html)이 없다 — 앱을 먼저 띄울 것"); process.exit(1); }
  await shell.evaluate(() => window.gijo && window.gijo.openTeamOffice && window.gijo.openTeamOffice());
  for (let i = 0; i < 20 && !office; i++) {
    await shell.waitForTimeout(700);
    office = ctx.pages().find((x) => x.url().includes("office.html"));
  }
}
if (!office) { console.log("❌ 팀 사무실 창을 못 열었다"); process.exit(1); }
// 개발 실행은 소스를 직접 읽으므로, 이미 떠 있던 창은 **옛 코드**다 — 다시 읽힌다.
await office.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await office.waitForTimeout(4500);
console.log("팀 사무실 창:", office.url().split("/").pop());

적기("사무실 창에 askConsole 통로가 있다",
  await office.evaluate(() => !!(window.gijo && window.gijo.askConsole)));

// 대화창(셸 아래 또는 별도 창) 양쪽에 덫을 놓는다.
const 대화창들 = ctx.pages().filter((x) => /app\.html|console\.html/.test(x.url()));
const 덫놓기 = (page) => page.evaluate(() => {
  window.__닿음 = null;
  const i = document.getElementById("chatInput");
  if (!i) return false;
  Object.defineProperty(i, "value", { configurable: true, get() { return ""; }, set(v) { window.__닿음 = v; } });
  return true;
});
const 덫회수 = (page) => page.evaluate(() => {
  const v = window.__닿음;
  const i = document.getElementById("chatInput");
  if (i) delete i.value;
  return v;
});
for (const page of 대화창들) await 덫놓기(page);

// 권고 줄을 펼치고 [▶ AI 팀에 맡기기]를 누른다.
const 준비 = await office.evaluate(() => {
  const row = document.querySelector(".g-item");
  if (row) row.click();
  return { 권고줄: document.querySelectorAll(".g-item").length };
});
await office.waitForTimeout(700);
const 눌림 = await office.evaluate(() => {
  const btn = document.querySelector(".g-item.open .g-go") || document.querySelector(".g-go");
  if (!btn) return { 버튼없음: true };
  const 지시 = (btn.closest(".g-item")?.innerText || "").split("\n")[0];
  btn.click();
  return { 지시줄: 지시 };
});
// 확인 문구는 loadGuide()·loadTasks()가 끝난 뒤에 뜨고 2.6초 뒤 사라진다 — 뜰 때까지 지켜본다.
// (고정 시간으로 한 번만 읽었다가 두 번 헛짚었다: 너무 일찍 읽거나 이미 사라진 뒤였다.)
let 버튼글 = "";
for (let i = 0; i < 30; i++) {
  버튼글 = await office.evaluate(() => (document.querySelector(".brief-col .bc-h") || {}).textContent || "");
  if (/대화창/.test(버튼글)) break;
  await office.waitForTimeout(300);
}

const 받은것 = [];
for (const page of 대화창들) 받은것.push({ 창: page.url().split("/").pop(), 글: await 덫회수(page) });
console.log("   권고 줄:", 준비.권고줄, "| 누른 줄:", JSON.stringify(눌림), "| 창별 수신:", JSON.stringify(받은것));

if (눌림.버튼없음) {
  적기("맡기기 버튼 동작", false, "버튼이 없어 확인 못 함 — 오늘 권고가 비었는지 볼 것");
} else {
  const 닿은글 = (받은것.find((x) => x.글) || {}).글 || "";
  적기("맡기기가 대화창에 닿는다", /조치를 진행해줘|을 진행해줘/.test(닿은글), "닿은 글: " + JSON.stringify(닿은글.slice(0, 70)));
  적기("화면에 확인 문구가 뜬다", /대화창/.test(버튼글), "머리글: " + JSON.stringify(버튼글));
}

// 이 시험이 만든 할일을 지운다 — 흔적을 남기지 않는다.
const 지운수 = await office.evaluate(async () => {
  const list = await window.gijo.listTasks();
  const 것들 = (list || []).filter((t) => /brief:/.test(t.ref || "") && !t.done && Date.now() - t.createdAt < 120000);
  for (const t of 것들) { try { await window.gijo.deleteTask(t.id); } catch (e) {} }
  return 것들.length;
}).catch(() => -1);
console.log("   정리: 이 시험이 만든 할일", 지운수, "건 삭제(-1=API 없어 수동 확인 필요)");

console.log("\n판정: " + (결과.every(Boolean) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((x) => !x).length + "건"));
await b.close();
process.exit(결과.every(Boolean) ? 0 : 1);
