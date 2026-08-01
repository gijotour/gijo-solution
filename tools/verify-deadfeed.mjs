// 죽은 통보를 걷은 네 화면이 **콘솔 오류 없이** 뜨고, 되살린 안내가 실제로 보이는가.
// ⚠ 코드를 지운 뒤엔 "안 부른다"가 아니라 "화면이 안 죽는다"를 봐야 한다 —
//   오늘 sendInstruction을 지우면서 남은 참조가 ReferenceError를 낼 뻔했다.
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

const 결과 = [];
const 적기 = (n, ok, 비고) => { 결과.push(ok); console.log((ok ? "✅ " : "❌ ") + n + (비고 ? " — " + 비고 : "")); };

const 오류 = [];
p.on("pageerror", (e) => 오류.push(String(e).slice(0, 160)));
p.on("console", (m) => { if (m.type() === "error") 오류.push(m.text().slice(0, 160)); });

// 탭으로 여는 화면 3개
for (const [라벨, 확인] of [
  ["자산 목록", (d) => d.querySelectorAll("tbody tr").length > 0],
  ["에이전트 AI", (d) => !!d.getElementById("terminalLog")],
  ["온톨로지", (d) => !!d.getElementById("graphCap")],
]) {
  오류.length = 0;
  await p.evaluate(() => window.gijoTabs && window.gijoTabs.closeAll());
  await p.waitForTimeout(400);
  const 열림 = await p.evaluate((lab) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) =>
      (e.querySelector(".gn-label")?.textContent || "").trim() === lab);
    if (!it) return false;
    it.querySelector(".gn-label").click();
    return true;
  }, 라벨);
  if (!열림) { 적기(라벨 + " 렌더", false, "메뉴를 못 찾음"); continue; }
  await p.waitForTimeout(7000);
  const r = await p.evaluate((fn) => {
    const f = document.querySelector("#screens iframe.on");
    const d = f && f.contentDocument;
    if (!d) return { 못봄: true };
    // eslint-disable-next-line no-new-func
    return { 통과: new Function("d", "return (" + fn + ")(d)")(d), 글: (d.body.innerText || "").slice(0, 120) };
  }, 확인.toString());
  적기(라벨 + " 렌더", !r.못봄 && r.통과 && 오류.length === 0,
    (오류.length ? "콘솔오류: " + 오류[0] : "") || (r.못봄 ? "프레임 못봄" : ""));
}

// 온톨로지 상한 안내가 실제 문장으로 뜨는가
const cap = await p.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  const d = f && f.contentDocument;
  return d ? (d.getElementById("graphCap") || {}).textContent || "" : "";
});
적기("그래프 표시 상한을 말한다", /건만 그립니다|건 전부/.test(cap), JSON.stringify(cap));

// 팀 사무실 창
const shell = p;
await shell.evaluate(() => window.gijo.openTeamOffice && window.gijo.openTeamOffice());
await shell.waitForTimeout(1500);
let office = ctx.pages().find((x) => x.url().includes("office.html"));
if (office) {
  const 오류2 = [];
  office.on("pageerror", (e) => 오류2.push(String(e).slice(0, 160)));
  office.on("console", (m) => { if (m.type() === "error") 오류2.push(m.text().slice(0, 160)); });
  await office.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await office.waitForTimeout(6000);
  const r = await office.evaluate(() => ({
    할일: !!document.querySelector(".todo .t-head"),
    브리핑: !!document.querySelector(".brief-col .bc-h"),
    머리글: (document.querySelector(".brief-col .bc-h") || {}).textContent || "",
  }));
  적기("팀 사무실 렌더", r.할일 && r.브리핑 && 오류2.length === 0,
    오류2.length ? "콘솔오류: " + 오류2[0] : JSON.stringify(r.머리글));
} else {
  적기("팀 사무실 렌더", false, "창을 못 열었다");
}

console.log("\n판정: " + (결과.every(Boolean) ? "✅ 전부 통과" : "❌ 실패 " + 결과.filter((x) => !x).length + "건"));
await b.close();
process.exit(결과.every(Boolean) ? 0 : 1);
