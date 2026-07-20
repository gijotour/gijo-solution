// tools/office-visitors-e2e.mjs — 팀 사무실 "외부 콘솔 접속자 + 역동성" e2e (로컬 데브 서버 4100).
// ① 앱 로그인(jyh) → 사무실 창 → 자기 자신이 접속자로 입장 ② HTTP로 guest1 로그인 → 입장 연출/피드
// ③ guest1 로그아웃 → 퇴장 ④ 협업 이동·파티클 훅 육안 캡처.
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");
const OUT = path.join(ROOT, "mockups", "ai-team-office");
const SERVER = "http://127.0.0.1:4100";
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

// ── 사전: guest1 계정 준비(HTTP) ──────────────────────────────────────
async function api(pathname, opts = {}) {
  const res = await fetch(SERVER + pathname, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
{
  const login = await api("/api/auth/login", { method: "POST", body: { username: "jyh", password: "changeme", force: true } });
  if (login.status !== 200) throw new Error("사전 jyh 로그인 실패: " + JSON.stringify(login.body));
  const mk = await api("/api/users", { method: "POST", token: login.body.accessToken, body: { username: "guest1", password: "guestpass1", displayName: "외부점검자", role: "security_officer" } });
  console.log("guest1 준비:", mk.status === 200 ? "생성됨" : mk.body.error);
  await api("/api/auth/logout", { method: "POST", token: login.body.accessToken, body: { refreshToken: login.body.refreshToken } });
}

// ── 앱 연결 ──────────────────────────────────────────────────────────
let browser;
for (let i = 0; i < 25; i++) {
  try { browser = await chromium.connectOverCDP("http://localhost:9224"); break; } catch { await sleep(800); }
}
if (!browser) throw new Error("CDP(9224) 연결 실패");
const ctx = browser.contexts()[0];
let page = ctx.pages()[0];
if (page.url().includes("login")) {
  await page.fill("#serverUrl", SERVER).catch(() => {});
  await page.fill("#username", "jyh");
  await page.fill("#password", "changeme");
  await page.click("#loginBtn");
  await sleep(2500);
  const forceBtn = await page.$("text=강제 로그인");
  if (forceBtn) { await forceBtn.click(); await sleep(2500); }
  page = ctx.pages()[0];
}
if (page.url().includes("login")) throw new Error("앱 로그인 실패");
console.log("앱 로그인 완료:", page.url());

await page.reload(); await sleep(1500);
await page.click("#officeBtn");
await sleep(3000);
const office = ctx.pages().find((p) => p.url().includes("office.html"));
if (!office) throw new Error("사무실 창 안 열림");
await office.setViewportSize({ width: 1000, height: 760 }).catch(() => {});

// ① 자기 자신(jyh)이 접속자로 표시되는지
await sleep(4000); // 입장 걷기 연출 시간
const stat1 = await office.textContent("#statLine");
console.log("상태줄:", stat1.trim());
if (!/접속 <?b?>?1/.test(stat1.replace(/<[^>]+>/g, ""))) console.log("⚠ 접속 1 미표시 — 확인 필요");
await office.screenshot({ path: path.join(OUT, "live-visitor-self.png") });

// ② guest1 HTTP 로그인 → 15초 폴링 내 입장
const guest = await api("/api/auth/login", { method: "POST", body: { username: "guest1", password: "guestpass1" } });
if (guest.status !== 200) throw new Error("guest1 로그인 실패: " + JSON.stringify(guest.body));
console.log("guest1 로그인 — 입장 연출 대기…");
let entered = false;
for (let i = 0; i < 12; i++) {
  await sleep(2500);
  const feed = await office.textContent("#feed");
  if (feed.includes("guest1") && feed.includes("접속했습니다")) { entered = true; break; }
}
console.log(entered ? "✓ guest1 입장 피드 확인" : "✗ 입장 피드 없음");
await sleep(2500); // 문→좌석 걷기
await office.screenshot({ path: path.join(OUT, "live-visitor-guest-entered.png") });
const stat2 = (await office.textContent("#statLine")).replace(/\s+/g, " ");
console.log("상태줄(입장 후):", stat2.trim());

// ③ 협업 이동 + 완료 파티클(디버그 훅) — 움직임 중간을 캡처
await office.evaluate(() => { window.__office.collabMove("Scan", "Report", "하드닝 결과 4건 전달"); window.__office.sparkle(); });
await sleep(1400);
await office.screenshot({ path: path.join(OUT, "live-collab-walk.png") });
console.log("✓ 협업 이동·파티클 캡처");

// ④ guest1 로그아웃 → 퇴장
await api("/api/auth/logout", { method: "POST", token: guest.body.accessToken, body: { refreshToken: guest.body.refreshToken } });
console.log("guest1 로그아웃 — 퇴장 연출 대기…");
let left = false;
for (let i = 0; i < 12; i++) {
  await sleep(2500);
  const feed = await office.textContent("#feed");
  if (feed.includes("guest1") && feed.includes("종료되었습니다")) { left = true; break; }
}
console.log(left ? "✓ guest1 퇴장 피드 확인" : "✗ 퇴장 피드 없음");
await office.screenshot({ path: path.join(OUT, "live-visitor-guest-left.png") });

// ⑤ 정리: guest1 삭제(관리자=jyh 앱 세션으로) + 앱 로그아웃
const users = await office.evaluate(() => window.gijo.listUsers());
const g = users.find((u) => u.username === "guest1");
if (g) { await office.evaluate((id) => window.gijo.deleteUser(id), g.id); console.log("guest1 삭제(정리)"); }
await office.evaluate(() => window.gijo.logout()).catch(() => {});
console.log("세션 반납 — 완료. 스크린샷 4장:", OUT);
await browser.close();
