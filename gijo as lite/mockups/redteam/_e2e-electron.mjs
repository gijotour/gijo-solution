// 실제 Electron 앱 E2E — 로그인 → AI 견고성 페이지 → 가드레일 토글 → 레드팀 실행 → 항목 펼침.
// preload+ipc+apiClient+서버(localhost:4000) 전 구간을 실제로 통과시킨다.
import { createRequire } from "module";
import path from "path";
const req = createRequire(path.resolve("client", "package.json"));
const { _electron: electron } = req("playwright-core");

const clientDir = path.resolve("client");
const app = await electron.launch({ args: ["."], cwd: clientDir });
const errors = [];
const logFail = (m) => errors.push(m);

let win = await app.firstWindow();
win.on("pageerror", (e) => logFail("pageerror: " + e.message));
win.on("console", (m) => { if (m.type() === "error") logFail("console.error: " + m.text()); });

async function step(name, fn) {
  try { await fn(); console.log("✓", name); }
  catch (e) { console.log("✗", name, "—", e.message); logFail(name + ": " + e.message); }
}

// 1) 로그인
await win.waitForSelector("#username", { timeout: 20000 });
await step("로그인", async () => {
  await win.fill("#username", "jyh");
  await win.fill("#password", "changeme");
  await win.click("#loginBtn");
  await win.waitForFunction(() => !location.pathname.endsWith("login.html"), { timeout: 20000 });
});

// 2) AI 견고성 페이지로 이동
// navigateTo는 전체 페이지 loadFile을 유발해 evaluate 실행 컨텍스트가 파괴된다(정상) —
// 그 reject는 무시하고, #runBtn 등장으로 이동 성공을 확인한다.
await step("redteam.html 이동", async () => {
  win.evaluate(() => window.gijo.navigateTo("redteam.html")).catch(() => {});
  await win.waitForSelector("#runBtn", { timeout: 20000 });
  await win.waitForTimeout(1500); // loadGuard/loadLast
});

// 3) 가드레일 상태가 실제 서버에서 로드됐는지
await step("가드레일 상태 로드(실서버)", async () => {
  const badge = await win.textContent("#guardBadge");
  if (!["끔", "탐지", "차단"].includes(badge.trim())) throw new Error("badge=" + badge);
  console.log("   가드레일 배지:", badge.trim());
});

// 4) 가드레일 모드 토글 → 실제 POST /api/guardrail/mode
await step("가드레일 모드 block 전환(실 POST)", async () => {
  await win.click('#guardSeg button[data-mode="block"]');
  await win.waitForTimeout(800);
  const badge = (await win.textContent("#guardBadge")).trim();
  if (badge !== "차단") throw new Error("전환 후 badge=" + badge);
  // 원복
  await win.click('#guardSeg button[data-mode="flag"]');
  await win.waitForTimeout(500);
});

// 5) 레드팀 실행 → 실제 14개 LLM 콜 (~1분). 완료 신호 = 버튼 재활성화(스코어는 loadLast가 미리 채워 불안정).
await step("레드팀 실행(실 LLM 14콜)", async () => {
  await win.click("#runBtn");
  await win.waitForFunction(() => document.querySelector("#runBtn").disabled === true, { timeout: 5000 }); // 시작
  await win.waitForFunction(() => document.querySelector("#runBtn").disabled === false, { timeout: 180000 }); // 완료
  const score = await win.textContent("#scoreText");
  const vuln = await win.textContent("#kVuln");
  const total = await win.textContent("#kTotal");
  const items = await win.$$eval("#results .item", (e) => e.length);
  const btnText = (await win.textContent("#runBtn")).trim();
  console.log("   견고성:", score, "| 뚫림:", vuln + "/" + total, "| 결과항목:", items, "| 버튼:", btnText);
  if (Number(total) !== 14) throw new Error("총 페이로드 != 14: " + total);
  if (items < 14) throw new Error("결과 항목 부족: " + items);
  if (btnText.includes("실행 중")) throw new Error("버튼이 '실행 중'에서 복구되지 않음");
});

// 6) 항목 펼침 → 공격·응답·판정근거 표시(실 데이터)
await step("결과 항목 펼침 상세(실 데이터)", async () => {
  await win.click("#results .item-head");
  await win.waitForTimeout(300);
  const opened = await win.$eval("#results .item", (e) => e.classList.contains("open"));
  if (!opened) throw new Error("펼쳐지지 않음");
  const body = await win.textContent("#results .item.open .item-body");
  if (!body.includes("공격") || !body.includes("판정 근거")) throw new Error("상세 내용 누락");
  console.log("   상세 일부:", body.replace(/\s+/g, " ").slice(0, 70) + "…");
});

await win.screenshot({ path: path.resolve("mockups", "redteam", "e2e-live.png"), fullPage: true });
await app.close();
console.log("\n=== 콘솔/페이지 에러:", errors.length ? errors : "없음", "===");
process.exit(errors.length ? 1 : 0);
