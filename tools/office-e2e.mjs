// tools/office-e2e.mjs — "우리 AI 팀 사무실" 창 실사용 검증 (진짜 앱·진짜 서버·진짜 데이터).
// 흐름: CDP 연결 → 로그인 → AI 그룹 → 팀 사무실(창) 클릭 → 새 창에서
//   ① 에이전트 상태·피드·할일 로드 확인 ② 할일 추가/삭제 왕복 ③ 스크린샷.
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const OUT = path.join(ROOT, "mockups", "ai-team-office");
const SERVER = process.env.GIJO_E2E_SERVER || "http://10.8.0.1:4000";
const USER = process.env.GIJO_E2E_USER || "test1";
const PASS = process.env.GIJO_E2E_PASS || "showmegijo1";
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

let browser;
for (let i = 0; i < 25; i++) {
  try { browser = await chromium.connectOverCDP("http://localhost:9223"); break; } catch { await sleep(800); }
}
if (!browser) throw new Error("CDP(9223) 연결 실패 — Electron 미기동?");
const ctx = browser.contexts()[0];
let page = ctx.pages()[0];
console.log("연결됨:", page.url());

if (page.url().includes("login")) {
  await page.fill("#serverUrl", SERVER).catch(() => {});
  await page.fill("#username", USER);
  await page.fill("#password", PASS);
  await page.click("#loginBtn");
  await sleep(2500);
  // 중복로그인 409 → 강제 로그인 확인 다이얼로그가 뜨면 확인
  const forceBtn = await page.$("text=강제 로그인");
  if (forceBtn) { await forceBtn.click(); await sleep(2500); }
  page = ctx.pages()[0];
  console.log("로그인 후:", page.url());
}
if (page.url().includes("login")) throw new Error("로그인 실패");

// 대시보드 상단 툴바의 🏢 버튼 → 팀 사무실(창). (방금 수정한 HTML을 반영하려 reload)
await page.reload();
await sleep(2000);
await page.click("#officeBtn");
await sleep(2500);

const officePage = ctx.pages().find((p) => p.url().includes("office.html"));
if (!officePage) throw new Error("office.html 창이 열리지 않음 — pages: " + ctx.pages().map((p) => p.url()).join(", "));
console.log("✓ 사무실 창 열림:", officePage.url());
await officePage.setViewportSize({ width: 1000, height: 760 }).catch(() => {});

// ① 로드 확인: 통계줄·할일 목록·피드
await sleep(2500);
const stat = await officePage.textContent("#statLine");
console.log("에이전트 상태줄:", stat.trim());
if (!/작업중|주시|대기/.test(stat)) throw new Error("에이전트 상태 로드 실패: " + stat);
const todoHtml = await officePage.innerHTML("#todoList");
console.log("할일 목록:", todoHtml.includes("t-item") ? "항목 있음" : "비어 있음(문구 확인)");
const feedText = await officePage.textContent("#feed");
console.log("피드:", feedText.trim().slice(0, 120).replace(/\s+/g, " "));

await officePage.screenshot({ path: path.join(OUT, "live-office-loaded.png") });

// ② 할일 추가 → 확인 → 삭제 (운영 큐 오염 방지 위해 왕복)
const MARK = "office창 검증용 " + Date.now();
await officePage.fill("#todoInput", MARK);
await officePage.click("#todoAddBtn");
await sleep(1200);
let listNow = await officePage.textContent("#todoList");
if (!listNow.includes("office창 검증용")) throw new Error("할일 추가가 목록에 반영되지 않음");
console.log("✓ 할일 추가 반영");
await officePage.screenshot({ path: path.join(OUT, "live-office-task-added.png") });

// 방금 추가한 항목의 ✕ 클릭
const items = await officePage.$$(".t-item");
for (const it of items) {
  const txt = await it.textContent();
  if (txt.includes("office창 검증용")) { await (await it.$(".t-del")).click(); break; }
}
await sleep(1200);
listNow = await officePage.textContent("#todoList");
if (listNow.includes("office창 검증용")) throw new Error("할일 삭제가 반영되지 않음");
console.log("✓ 할일 삭제 반영 (운영 큐 원복)");

// ③ 항상 위 고정 토글(에러 없이 왕복하는지)
await officePage.click("#pinBtn"); await sleep(300);
await officePage.click("#pinBtn"); await sleep(300);
console.log("✓ 항상 위 고정 토글 왕복");

// ④ 사이드바(레일) 진입점도 있는지 — agent.html로 이동해 항목 존재 확인
await page.evaluate(() => window.gijo.navigateTo("agent.html"));
await sleep(2500);
const mainPage = ctx.pages().find((p) => p.url().includes("agent.html"));
const railItem = mainPage ? await mainPage.$("text=🏢 팀 사무실 (창)") : null;
console.log(railItem ? "✓ 사이드바 진입점 존재 (AI 그룹)" : "✗ 사이드바 진입점 없음");

console.log("완료 — 스크린샷:", OUT);
await browser.close();
