// tools/verify-topbar.mjs — 상단 조작 줄 실앱 검증 (2026-08-02 개편)
//
// 무엇을 보는가
//   ① 조작 5개(☰ 설정 · ▣ 접기 · 🔍 찾기 · ← 뒤로 · → 앞으로)가 실제로 붙어 있나
//   ② ▣가 정말 사이드바를 접나 (모양·저장값까지)
//   ③ 🔍 겹판이 열리고 한글로 찾아 Enter로 열리나
//   ④ 갈 곳 없는 ← →가 흐려져 있나 ('눌러도 아무 일 없는 자리' 금지)
//   ⑤ 화면 한가운데 ◀ 딱지가 사라졌나 · 사용자 줄 끝이 📚로 바뀌었나
//   ⑥ 오른쪽 OS 창 버튼 자리를 침범하지 않나
//
// 쓰는 법: 클라를 CDP 9223으로 띄운 뒤
//   QA_USER=... QA_PASS=... node tools/verify-topbar.mjs [포트]
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const PORT = process.argv[2] || "9223";
let 실패 = 0;
const 확인 = (조건, 말) => { console.log(`  ${조건 ? "✓" : "✗"} ${말}`); if (!조건) 실패++; };

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = b.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("app.html")) || ctx.pages()[0];

// ── 로그인 (계정당 세션 1개 — 이미 붙어 있으면 강제 로그인) ─────────────────
if (!(await page.evaluate(() => !!(window.gijo && window.gijo.isAuthenticated && window.gijo.isAuthenticated())))) {
  await page.evaluate(([u, p]) => {
    const el = (id) => document.getElementById(id);
    if (el("serverUrl")) el("serverUrl").value = "http://localhost:4000";
    if (el("username")) el("username").value = u;
    if (el("password")) el("password").value = p;
    el("loginBtn") && el("loginBtn").click();
  }, [process.env.QA_USER, process.env.QA_PASS]);
  await page.waitForTimeout(3500);
  for (const btn of await page.$$("button")) {
    const t = (await btn.innerText().catch(() => "")).trim();
    if (t.includes("강제 로그인")) { await btn.click(); await page.waitForTimeout(4500); break; }
  }
  await page.waitForTimeout(1500);
  page = ctx.pages().find((p) => p.url().includes("app.html")) || page;
}
console.log("창:", page.url().split("/").pop(), "| 설치본?", page.url().includes("app.asar"));

// ── ① 조작 줄이 붙어 있나 ────────────────────────────────────────────────
const 줄 = await page.evaluate(() => {
  const acts = document.querySelector(".gtb-acts");
  if (!acts) return null;
  const 단추 = [...acts.querySelectorAll(".gtb-ib")].map((b) => ({ title: b.title, 흐림: b.disabled }));
  const r = acts.getBoundingClientRect();
  return { 단추, 왼쪽: Math.round(r.left), 어디: (acts.querySelector(".gtb-where") || {}).textContent || "" };
});
console.log("\n[① 조작 줄]");
확인(!!줄, "상단에 조작 줄이 있다");
if (줄) {
  확인(줄.단추.length === 5, `단추 5개 (실제 ${줄.단추.length}개)`);
  for (const 말 of ["설정", "접기", "찾기", "뒤로", "앞으로"]) {
    확인(줄.단추.some((b) => b.title.includes(말)), `「${말}」 단추가 있다`);
  }
}

// ── ② ▣ 접기 ────────────────────────────────────────────────────────────
console.log("\n[② ▣ 메뉴 접기]");
const 접기단추 = (await page.$$(".gtb-acts .gtb-ib"))[1];
await 접기단추.click(); await page.waitForTimeout(600);
확인(await page.evaluate(() => document.body.classList.contains("gn-left-collapsed")), "누르면 접힌다");
확인(await page.evaluate(() => {
  const n = document.getElementById("gijoNav");
  return !n || getComputedStyle(n).display === "none";
}), "접히면 왼쪽 메뉴가 실제로 사라진다");
확인(await page.evaluate(() => !!document.querySelector(".gtb-acts")), "접혀도 조작 줄은 남는다");
await 접기단추.click(); await page.waitForTimeout(600);
확인(!(await page.evaluate(() => document.body.classList.contains("gn-left-collapsed"))), "다시 누르면 펼쳐진다");

// ── ③ 🔍 찾기 겹판 ───────────────────────────────────────────────────────
console.log("\n[③ 🔍 화면 찾기]");
await (await page.$$(".gtb-acts .gtb-ib"))[2].click();
await page.waitForTimeout(500);
확인(await page.evaluate(() => !!document.querySelector(".gtb-fmask")), "겹판이 열린다");
await page.evaluate(() => {
  const i = document.querySelector(".gtb-fpal input");
  i.value = "취약점";
  i.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(400);
const 결과 = await page.evaluate(() => [...document.querySelectorAll(".gtb-fr")].map((e) => e.textContent));
확인(결과.length > 0 && 결과.some((t) => t.includes("취약점")), `한글로 찾으면 걸린다 (${결과.length}건)`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
확인(!(await page.evaluate(() => !!document.querySelector(".gtb-fmask"))), "Esc로 닫힌다");

// ── ④ ← → 이력 ──────────────────────────────────────────────────────────
// ⚠ 셸에서는 화면이 iframe 탭이라 **주소가 안 바뀐다**. 주소 이력으로 재면 늘 통과해 버리므로
//   실제로 화면 두 개를 열고 되짚어 본다(약속한 "본 화면 순서"를 그대로 시험한다).
console.log("\n[④ ← → 이력]");
const 뒤로 = (await page.$$(".gtb-acts .gtb-ib"))[3];
const 앞으로 = (await page.$$(".gtb-acts .gtb-ib"))[4];
확인(await 앞으로.evaluate((e) => e.disabled), "앞으로 갈 곳이 없으면 흐리다");

// ⚠ 이력은 창이 살아 있는 동안 쌓인다 — 하네스를 두 번 돌리면 그만큼 길어진다.
//   그래서 **길이 자체**가 아니라 이번 실행에서 얼마나 늘었는지를 잰다(전에 여기서 헛발질했다).
const 전길이 = await page.evaluate(() => (JSON.parse(sessionStorage.getItem("gijo:navhist") || '{"stack":[]}').stack || []).length);
await page.evaluate(() => window.gijoTabs.open("vulnscan.html", "취약점"));
await page.waitForTimeout(900);
await page.evaluate(() => window.gijoTabs.open("inventory.html", "자산 목록"));
await page.waitForTimeout(900);
const 지금1 = await page.evaluate(() => window.gijoTabs.activeScreen());
확인(지금1 === "inventory.html", `두 번째 화면이 열렸다 (${지금1})`);
확인(!(await 뒤로.evaluate((e) => e.disabled)), "화면을 옮기면 뒤로가 켜진다");

await 뒤로.click(); await page.waitForTimeout(900);
const 지금2 = await page.evaluate(() => window.gijoTabs.activeScreen());
확인(지금2 === "vulnscan.html", `←로 이전 화면으로 돌아간다 (${지금2})`);
확인(!(await 앞으로.evaluate((e) => e.disabled)), "돌아가면 앞으로가 켜진다");

await 앞으로.click(); await page.waitForTimeout(900);
const 지금3 = await page.evaluate(() => window.gijoTabs.activeScreen());
확인(지금3 === "inventory.html", `→로 다시 앞 화면으로 간다 (${지금3})`);

const 이력 = await page.evaluate(() => sessionStorage.getItem("gijo:navhist"));
const 쌓임 = 이력 ? JSON.parse(이력) : { stack: [] };
const 늘어난것 = 쌓임.stack.length - 전길이;
확인(늘어난것 === 2,
  `되짚어도 이력이 부풀지 않는다 — 화면 2개를 열었으니 2칸만 는다 (실제 +${늘어난것}칸, 끝: ${쌓임.stack.slice(-3).map((s) => s.label || s).join(" → ")})`);
const 어디 = await page.evaluate(() => (document.querySelector(".gtb-where") || {}).textContent || "");
확인(어디.includes("자산 목록"), `「지금 보는 곳」이 화면을 따라간다 (${어디})`);

// ── ⑤ 옛 자리 정리 ──────────────────────────────────────────────────────
console.log("\n[⑤ 옛 자리 정리]");
확인(!(await page.evaluate(() => !!document.getElementById("gnLeftEdge"))), "화면 한가운데 ◀ 딱지가 없다");
확인(!(await page.evaluate(() => !!document.getElementById("gnFind"))), "사이드바 찾기 입력칸이 없다");
const 줄끝 = await page.evaluate(() => {
  const g = document.querySelector(".gtb-userarea .gtb-gear");
  return g ? { 글자: g.textContent.trim(), 설명: g.title } : null;
});
확인(줄끝 && 줄끝.글자 === "📚", `사용자 줄 끝이 문서함이다 (${줄끝 ? 줄끝.글자 : "없음"})`);
확인(!!줄끝 && 줄끝.설명.includes("문서함"), "설명도 문서함을 가리킨다");
// 왼쪽 목록에는 문서함이 없어야 한다(같은 것이 두 번 보이지 않게) — 다만 찾기로는 닿아야 한다.
확인(!(await page.evaluate(() => [...document.querySelectorAll("#gijoNav .gn-item")].some((e) => e.textContent.includes("문서함")))),
  "왼쪽 메뉴 목록에는 문서함이 없다");
확인(await page.evaluate(() => (window.gijoScreenList() || []).some((i) => (i.label || "").includes("문서함"))),
  "그래도 🔍 찾기로는 문서함을 찾을 수 있다");

// 이름을 누르면 설정 › 내 설정 — 구역 키(s=my)까지 확인한다. s=me로 적으면 빈 화면이 뜬다.
await page.evaluate(() => document.querySelector(".gtb-userarea .ua-row").click());
await page.waitForTimeout(1200);
const 이름눌러간곳 = await page.evaluate(() => window.gijoTabs && window.gijoTabs.activeScreen());
확인(이름눌러간곳 === "settings.html?s=my", `이름을 누르면 내 설정으로 간다 (${이름눌러간곳})`);
확인(await page.evaluate(() => !!document.getElementById("screens")), "셸이 통째로 바뀌지 않고 탭으로 열린다");
const 내설정보임 = await page.evaluate(() => {
  const f = [...document.querySelectorAll("iframe.screen")].find((x) => (x.src || "").includes("s=my"));
  if (!f) return null;
  try { return (f.contentDocument.body.innerText || "").slice(0, 60); } catch (e) { return "읽기 실패"; }
});
확인(!!내설정보임 && !!내설정보임.trim(), `내 설정 화면에 내용이 뜬다 (${(내설정보임 || "").replace(/\n/g, " ").slice(0, 40)})`);

// ── ⑥-0 ⚙ 설정 메뉴가 오른쪽으로 펴지나 ─────────────────────────────────
console.log("\n[⑥ ⚙ 설정 메뉴]");
await (await page.$$(".gtb-acts .gtb-ib"))[0].click();
await page.waitForTimeout(500);
const 메뉴 = await page.evaluate(() => {
  const m = document.querySelector(".gtb-menu");
  if (!m) return null;
  const r = m.getBoundingClientRect(), b = document.querySelector(".gtb-acts .gtb-ib").getBoundingClientRect();
  return { 왼쪽: Math.round(r.left), 단추왼쪽: Math.round(b.left), 오른쪽: Math.round(r.right), 창폭: window.innerWidth, 글: m.innerText.slice(0, 20) };
});
확인(!!메뉴, "⚙를 누르면 메뉴가 열린다");
확인(메뉴 && Math.abs(메뉴.왼쪽 - 메뉴.단추왼쪽) < 12, `메뉴가 단추에서 **오른쪽으로** 펴진다 (단추 ${메뉴 && 메뉴.단추왼쪽}px → 메뉴 ${메뉴 && 메뉴.왼쪽}px)`);
확인(메뉴 && 메뉴.왼쪽 >= 0 && 메뉴.오른쪽 <= 메뉴.창폭, "메뉴가 창 밖으로 잘리지 않는다");
// 보이는 닫기 — 바깥을 눌러야만 닫히면 "닫는 법을 모르겠다"가 된다.
확인(await page.evaluate(() => !!document.querySelector(".gtb-menu .gtb-mx")), "메뉴에 닫기(✕)가 있다");
await page.evaluate(() => document.querySelector(".gtb-menu .gtb-mx").click());
await page.waitForTimeout(400);
확인(!(await page.evaluate(() => !!document.querySelector(".gtb-menu"))), "✕를 누르면 닫힌다");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ── ⑦ OS 창 버튼 자리 ───────────────────────────────────────────────────
console.log("\n[⑥ OS 창 버튼 자리]");
const 자리 = await page.evaluate(() => {
  const h = document.querySelector(".header");
  const acts = document.querySelector(".gtb-acts");
  if (!h || !acts) return null;
  return { 헤더오른쪽: Math.round(h.getBoundingClientRect().right), 조작오른쪽: Math.round(acts.getBoundingClientRect().right), 창폭: window.innerWidth };
});
확인(자리 && 자리.창폭 - 자리.조작오른쪽 > 138, `조작 줄이 오른쪽 창 버튼 자리를 안 넘는다 (여유 ${자리 ? 자리.창폭 - 자리.조작오른쪽 : "?"}px)`);

await page.screenshot({ path: ".tmp-reports/topbar-after.png" });
console.log(`\n실패 ${실패}건 · 스크린샷 .tmp-reports/topbar-after.png`);
await b.close();
process.exit(실패 ? 1 : 0);
