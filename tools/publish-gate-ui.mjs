// tools/publish-gate-ui.mjs — 게시 전 실화면 관문 (2026-08-20, 외부 조사 3순위 도입)
//
// ■ 왜: 게이트 4층(WSL 시험·소스 감시·검토관·배선 계약)은 전부 **정적**이라
//   「로드는 됐는데 런타임에 안 눌리는」 부류를 원리상 못 잡는다 — 2026-08-19~20
//   실사고 두 번(nextChips 죽은 줄·부품 로드 누락 5화면) 다 실화면만 잡았다.
//   이 스크립트가 그 실화면 검사를 **게시 관문으로 상설화**한 것이다.
//   publish-release.mjs가 게시 전에 자동으로 부른다(--skip-ui-gate로만 우회).
//
// ■ 무엇을: release/win-unpacked(= Setup exe와 같은 asar)를 **전용 포트 9227**로 띄워
//   로그인 → 선택카드 3유형 → 감사 행 배선 → 부품 로드 → 허브 릴레이 → 히트맵 카드를
//   실제로 누르고 판정한다. 검사 목록은 배선이 늘 때마다 여기 더한다.
//
// ■ 안전 수칙(fail-closed):
//   · 선행 점검에서 GIJO AS·electron 프로세스가 하나라도 떠 있으면 **게시 중단(exit 3)** —
//     사장님 앱을 절대 죽이지 않는다(수칙). userData 공유라 단일 인스턴스 잠금과도 충돌한다.
//   · 포트는 9227 전용 — 9223(개발·수동검사)에 떠 있는 남의 앱에 붙는 사고를 원천 차단.
//   · 자기가 띄운 프로세스만 끝에 정리한다(taskkill /PID {자기pid} /T).
//
// 사용: node tools/publish-gate-ui.mjs   (GIJO_ADMIN_PASSWORD 필요 · 운영 4000 로그인)
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require2 = createRequire(path.join(repo, "client", "package.json"));
const { chromium } = require2("playwright-core");

const EXE = path.join(repo, "client", "release", "win-unpacked", "GIJO AS.exe");
const PORT = Number(process.env.GIJO_GATE_CDP_PORT || 9227);
// 앱 로그인 계정 — 게시 계정(gijo-publish)은 서버 API 전용이라 여기 못 쓴다.
// 게시 셸이 GIJO_PUBLISH_*만 실었을 수 있으므로(게시 문서 §4) User 스코프 env까지 스스로 읽는다
// (검토관 S1 — 안 읽으면 문서대로 꾸린 게시 셸에서 관문이 기계적으로 멈춘다).
function userEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command",
      `[Environment]::GetEnvironmentVariable('${name}','User')`], { encoding: "utf8" }).trim();
  } catch { return ""; }
}
const USER = process.env.GIJO_ADMIN_USER || "claude-deploy";
const PASS = userEnv("GIJO_ADMIN_PASSWORD");
const SERVER = process.env.GIJO_SERVER_URL || "http://localhost:4000";

const 실패 = [];
function ok(name, cond, extra) {
  console.log("[ui관문] " + (cond ? "✓ " : "✕ ") + name + (extra ? " — " + extra : ""));
  if (!cond) 실패.push(name);
}

// ── 선행 점검(fail-closed) — exit 3의 원인은 4가지다: ①비번 없음 ②win-unpacked 없음
//    ③GIJO AS/electron 떠 있음 ④9227 점유. 메시지가 각각 원인을 말한다(검토관 S1 부수). ──
if (!PASS) { console.error("[ui관문] exit 3 원인①: GIJO_ADMIN_PASSWORD가 없습니다(User 스코프에서도 못 읽음) — 게시 중단"); process.exit(3); }
if (!fs.existsSync(EXE)) { console.error("[ui관문] exit 3 원인②: win-unpacked가 없습니다(먼저 npm run dist): " + EXE); process.exit(3); }
try {
  // 개수로 센다(검토관 M4) — Path는 다른 사용자·승격 프로세스에서 접근 거부로 비어
  // 「떠 있는데 없음」이 될 수 있다. PowerShell 자체가 실패하면 fail-closed(중단).
  const cnt = Number(execFileSync("powershell", ["-NoProfile", "-Command",
    "@(Get-Process 'GIJO AS','electron' -ErrorAction SilentlyContinue).Count"],
    { encoding: "utf8" }).trim() || "0");
  if (cnt > 0) {
    console.error("[ui관문] exit 3 원인③: GIJO AS/electron 프로세스 " + cnt + "개가 떠 있습니다 — 게시 중단.");
    console.error("  사람이 쓰는 앱은 이 관문이 절대 닫지 않습니다. 앱을 닫고 다시 게시하세요.");
    process.exit(3);
  }
} catch {
  console.error("[ui관문] exit 3: 프로세스 점검 자체가 실패했습니다 — 모호하면 게시를 멈춥니다(fail-closed).");
  process.exit(3);
}
try {
  const r = await fetch("http://localhost:" + PORT + "/json/version", { signal: AbortSignal.timeout(1500) });
  if (r.ok) { console.error("[ui관문] exit 3 원인④: 포트 " + PORT + "에 이미 CDP가 떠 있습니다 — 게시 중단."); process.exit(3); }
} catch { /* 닫혀 있음 — 정상 */ }

// ── 앱 기동(전용 포트) ────────────────────────────────────────────────────
const app = spawn(EXE, ["--remote-debugging-port=" + PORT], { stdio: "ignore" });
const 정리 = () => { try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* 이미 종료 */ } };
process.on("exit", 정리);
process.on("SIGINT", () => { 정리(); process.exit(1); }); // Ctrl+C에도 앱이 남지 않게(검토관 L5)
await new Promise((r) => setTimeout(r, 7000));

let browser;
try {
  browser = await chromium.connectOverCDP("http://localhost:" + PORT, { timeout: 20000 });
} catch (e) {
  console.error("[ui관문] CDP 연결 실패: " + e.message);
  process.exit(1);
}
const ctx = browser.contexts()[0];

// ── 로그인 ────────────────────────────────────────────────────────────────
let page = ctx.pages().find((p) => p.url().includes("login")) || ctx.pages()[0];
await page.waitForLoadState("domcontentloaded");
if (page.url().includes("login")) {
  await page.fill("#serverUrl", SERVER);
  await page.fill("#username", USER);
  await page.fill("#password", PASS);
  await page.click("#loginBtn");
  await new Promise((r) => setTimeout(r, 3000));
  const dup = await page.evaluate(() => {
    const d = document.getElementById("dupBox");
    return d && d.style.display !== "none";
  }).catch(() => false);
  if (dup) await page.click("#dupForce"); // claude-deploy 세션만 끊긴다 — 단 이 계정이 다른 머신에 로그인돼 있으면 그 세션도 끊긴다(사람 계정 아님)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (ctx.pages().some((p) => p.url().includes("app.html"))) break;
  }
}
page = ctx.pages().find((p) => p.url().includes("app.html")) || ctx.pages()[0];
ok("프로 셸 도착", page.url().includes("app.html"), page.url().slice(-40));
const 셸 = page.mainFrame();

async function 프레임찾기(pg, tries) {
  for (let i = 0; i < (tries || 12); i++) {
    for (const p of ctx.pages()) for (const f of p.frames()) if (f.url().includes(pg)) return f;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// ── ① 선택카드 3유형(2026-08-20 검토관 심각2 계약) ──────────────────────
async function 선택카드검사(label, fields) {
  return await 셸.evaluate(async ({ label, fields }) => {
    window.postMessage({ type: "gijo:select", label, text: label, fields }, "*");
    await new Promise((r) => setTimeout(r, 600));
    const cards = [...document.querySelectorAll(".cm")];
    const last = cards[cards.length - 1];
    const txt = last ? last.textContent : "";
    const chips = last ? [...last.parentElement.querySelectorAll(".cs-chip")].map((c) => c.textContent) : [];
    return { txt: (txt || "").slice(0, 200), chips };
  }, { label, fields });
}
const 일반 = await 선택카드검사("관문-일반형", { title: "일반형 표본", status: "점검 2건" });
// ⚠ 부정 단언만 있으면 카드가 아예 안 그려져도 통과한다(검토관 L2) — 존재부터 단언.
ok("일반형: 카드가 그려짐", 일반.txt.includes("일반형 표본"), 일반.txt.slice(0, 50));
ok("일반형: 담당 미배정 없음", !일반.txt.includes("담당 미배정"));
ok("일반형: 칩 1개(쉽게 설명)", 일반.chips.length === 1 && /쉽게 설명/.test(일반.chips[0] || ""), JSON.stringify(일반.chips));
const 취약 = await 선택카드검사("관문-취약점형", { title: "SQLi 표본", severity: "높음", findingKey: "abcdef0123456789" });
ok("취약점형: 담당 미배정 표시", 취약.txt.includes("담당 미배정"));
ok("취약점형: 배정 칩", 취약.chips.some((c) => /담당자 배정/.test(c)));
await 셸.evaluate(() => window.postMessage({ type: "gijo:select" }, "*")); // 해제

// ── ② 감사(작업 기록) 행 배선 + 허브 릴레이 ─────────────────────────────
await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("records.html", "기록", { dock: true }));
const auditFrame = await 프레임찾기("audit.html");
ok("records 무대(audit) 로드", !!auditFrame);
if (auditFrame) {
  const r = await auditFrame.evaluate(async () => {
    const has부품 = typeof window.gijoSelectNotify === "function";
    for (let i = 0; i < 20; i++) {
      if (document.querySelector(".aud[data-id]")) break;
      await new Promise((x) => setTimeout(x, 500));
    }
    const row = document.querySelector(".aud[data-id]");
    if (!row) return { has부품, rows: 0 };
    row.click();
    await new Promise((x) => setTimeout(x, 400));
    return { has부품, rows: document.querySelectorAll(".aud").length, on: !!document.querySelector(".aud.on") };
  });
  ok("audit 부품·행 클릭·하이라이트", r.has부품 && r.rows > 0 && r.on, "rows=" + r.rows);
  const 칩 = await 셸.evaluate(() => (document.querySelector(".cs-sel") || {}).textContent || "");
  ok("행 클릭 → 셸 📌 칩", !!칩, String(칩).slice(0, 40));
  // 행 선택은 무대를 유지한다(검토관 상1 — 자동 복귀는 결재 확인창·모달을 삼켜 폐지).
  // 📌는 달리고, 무대 머리가 「골랐습니다」를 알린다. 내리기는 ← 대화로(사람)뿐.
  const 선택후 = await 셸.evaluate(() => ({
    무대유지: document.body.classList.contains("stage-on"),
    표시: /골랐습니다|← 대화로/.test((document.getElementById("stageBack") || {}).textContent || ""),
  }));
  ok("행 선택: 📌 달고 화면 유지(내리기는 ← 대화로)", 선택후.무대유지 && 선택후.표시, JSON.stringify(선택후));
  // 허브 릴레이 — 무대→허브→셸 두 겹을 실제로 올라가는가(2026-08-20 grouphub 릴레이+가드)
  await auditFrame.evaluate(() => window.parent.postMessage({ type: "gijo:openTab", page: "kpi.html", label: "지표" }, "*"));
  const kpiFrame = await 프레임찾기("kpi.html", 8);
  ok("허브 릴레이(무대→셸)", !!kpiFrame);
}

// ── ③ 부품 로드(배선 계약 — 「호출만 있고 로드 없음」 재발 방지 실측) ──────
// ⚠ inventory.html은 검사하지 않는다 — assets.html로 흡수된 화면(nav.js TAB_REDIRECT,
//   2026-08-02)이라 도킹으로 열면 assets로 넘어가 프레임이 없다. 팝업 시절(5.38까지)엔
//   리다이렉트를 안 타 우연히 통과했다. assets 부품은 ④′(assets를 여는 검사) 뒤에서 확인.
for (const [pg, lbl] of [["hardening.html", "검증"], ["maintenance.html", "점검"], ["report.html", "보고"], ["learnloop.html", "학습"]]) {
  await 셸.evaluate(({ pg, lbl }) => window.gijoTabs && window.gijoTabs.open(pg, lbl, { dock: true }), { pg, lbl });
  const fr = await 프레임찾기(pg, 8);
  const has = fr ? await fr.evaluate(() => typeof window.gijoSelectNotify === "function").catch(() => false) : false;
  ok("부품 로드: " + pg, has, fr ? "" : "프레임 못 찾음");
}

// ── ④′ 화면 열기 → 현황 카드 자동(2026-08-20 사장님 — 「메뉴를 누르면 상위 카드」) ──
const 카드전 = await 셸.evaluate(() => document.querySelectorAll(".dc-card").length);
await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("assets.html", "자산 고르기")); // 무dock=메뉴성 — 카드만 떠야 한다(사장님 확정 계약)
let 자동카드 = false;
for (let i = 0; i < 10 && !자동카드; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  자동카드 = await 셸.evaluate((n) => {
    const cards = [...document.querySelectorAll(".dc-card")];
    return cards.length > n && cards.some((c) => (c.textContent || "").includes("자산 — 등록 현황"));
  }, 카드전);
}
ok("메뉴 열기 → 현황 카드 자동(assets)", 자동카드);
{
  // ★ 확정 계약(2026-08-20 사장님 ×3): 메뉴성 열기는 화면을 열지 않는다 — 카드가 전부.
  // ⚠ assets는 앞선 검사(행 클릭 등)가 이미 열어 iframe이 잔존하고, 셸은 iframe을
  //   재사용하므로 assets로는 「안 열림」을 못 잰다(수 비교도 재사용이면 거짓 통과).
  //   이 관문에서 한 번도 안 연 sessions.html(신설 작업내역 카드)로 0→0을 확인한다.
  const 프레임수 = (nm) => ctx.pages().reduce((n, p) => n + p.frames().filter((f) => f.url().includes(nm)).length, 0);
  const 전 = 프레임수("sessions.html");
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("sessions.html", "작업 내역"));
  let 세션카드 = false;
  for (let i = 0; i < 10 && !세션카드; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    세션카드 = await 셸.evaluate(() => [...document.querySelectorAll(".dc-card")].some((c) => (c.textContent || "").includes("작업 내역 — 대화 세션")));
  }
  const 후 = 프레임수("sessions.html");
  ok("메뉴 열기는 화면을 열지 않는다(카드가 전부)", 세션카드 && 전 === 0 && 후 === 0, "신설카드 " + 세션카드 + " · 프레임 " + 전 + "→" + 후);
}
// assets 부품 확인 — 방금 ④′가 assets를 열었으니 프레임이 살아 있다(순서 계약).
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("assets.html", "자산 고르기", { dock: true })); // 부품 확인은 진짜 열어서
  const fr = await 프레임찾기("assets.html", 6);
  const has = fr ? await fr.evaluate(() => typeof window.gijoSelectNotify === "function").catch(() => false) : false;
  ok("부품 로드: assets.html", has, fr ? "" : "프레임 못 찾음");

  // ── 무대(대화창 자리) 실측 — 2026-08-20 사장님 승인 「팝업·옆 도킹 없애고 대화창 자리에」 ──
  // 방금 dock으로 열었으니 무대가 떠 있어야 한다: 화면 전폭 + 대화 숨김 + ← 대화로.
  const 무대 = await 셸.evaluate(() => ({
    전면: document.body.classList.contains("stage-on"),
    대화숨김: getComputedStyle(document.querySelector(".work .console")).display === "none",
    복귀단추: !!document.getElementById("stageBack") && document.getElementById("stageBack").offsetParent !== null,
    옛팝업단추: !!document.getElementById("dockPop"),
  }));
  ok("무대: 화면 전폭·대화 숨김·← 대화로", 무대.전면 && 무대.대화숨김 && 무대.복귀단추 && !무대.옛팝업단추,
    JSON.stringify(무대));
  // ← 대화로 — 대화가 앞으로, 화면(탭)은 산 채로 남는다(필터·스크롤 보존 계약).
  await 셸.evaluate(() => document.getElementById("stageBack").click());
  const 내림 = await 셸.evaluate(() => ({
    대화앞: !document.body.classList.contains("stage-on") && document.body.classList.contains("chat-home"),
    탭산다: !!(window.gijoTabs && window.gijoTabs.list && window.gijoTabs.list().some((t) => String(t.page || t).includes("assets.html"))),
  }));
  ok("← 대화로: 대화 복귀·화면 보존", 내림.대화앞 && 내림.탭산다, JSON.stringify(내림));
  // 🗔 되올리기 — 같은 화면 dock 열기가 숨긴 무대를 그대로 되올린다.
  await 셸.evaluate(() => window.gijoTabs.open("assets.html", "자산 고르기", { dock: true }));
  await new Promise((r) => setTimeout(r, 400));
  const 되올림 = await 셸.evaluate(() => document.body.classList.contains("stage-on"));
  ok("🗔 되올리기: 보던 화면 복귀", 되올림);
  // 🎨 프로=흰 바탕(2026-08-20 배색 확정 — 배색=에디션 이름표) — 셸과 무대 화면 둘 다.
  const 흰바탕 = await 셸.evaluate(() => ({
    셸클래스: document.documentElement.classList.contains("theme-light"),
    셸배경: getComputedStyle(document.body).backgroundColor,
  }));
  ok("프로 흰 바탕: 셸(theme-light·#faf8f5)", 흰바탕.셸클래스 && 흰바탕.셸배경 === "rgb(250, 248, 245)", JSON.stringify(흰바탕));
  const 화면흰 = fr ? await fr.evaluate(() => ({
    클래스: document.documentElement.classList.contains("theme-light"),
    배경: getComputedStyle(document.body).backgroundColor,
  })).catch(() => null) : null;
  ok("프로 흰 바탕: 무대 화면(theme=light 전달)", !!화면흰 && 화면흰.클래스 && 화면흰.배경 === "rgb(250, 248, 245)", JSON.stringify(화면흰));
  // 허브 중첩 속살까지 흰가(검토관 배색 상2·중6 — assets 한 장 검사는 허브·부품 다크 박힘을 통과시켰다)
  await 셸.evaluate(() => window.gijoTabs.open("fix.html", "조치", { dock: true }));
  const hubFr = await 프레임찾기("fix.html", 8);
  let 속살 = null;
  if (hubFr) {
    for (let i = 0; i < 10 && !속살; i++) {
      await new Promise((r) => setTimeout(r, 500));
      속살 = hubFr.childFrames().find((f) => f.url().includes("hub=1"));
    }
  }
  const 속살흰 = 속살 ? await 속살.evaluate(() =>
    document.documentElement.classList.contains("theme-light") &&
    getComputedStyle(document.body).backgroundColor === "rgb(250, 248, 245)").catch(() => false) : false;
  ok("프로 흰 바탕: 허브 무대 속살(theme 계승)", !!속살 && 속살흰, hubFr ? (속살 ? "" : "속살 프레임 못 찾음") : "허브 프레임 못 찾음");
  // 대화창 카드 경계·배경 실측 — 부품 JS 다크 박힘(배색 상1) 재발 방지
  const 카드경계 = await 셸.evaluate(() => {
    const c = document.querySelector(".dc-card");
    if (!c) return null;
    const st = getComputedStyle(c);
    return { bg: st.backgroundColor, b: st.borderTopColor };
  });
  ok("프로 흰 바탕: 카드 배경(부품 층)", !!카드경계 && 카드경계.bg === "rgb(255, 255, 255)", JSON.stringify(카드경계));
  // 팝업 0 — 프로에서 저절로 뜨는 창이 없다(창은 (창) 메뉴뿐 — 이 관문은 안 연다).
  const 팝업0 = ctx.pages().every((p) => {
    const u = p.url();
    return u.includes("app.html") || u.includes("login.html") || u.includes("?embed=1") || u === "about:blank";
  });
  ok("팝업 0(프로 — 창은 (창) 메뉴뿐)", 팝업0);
}

// ── ④ 데이터 카드 히트맵 보기(5.35.0 기능 회귀) ─────────────────────────
const 히트 = await 셸.evaluate(() => {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:560px;";
  document.body.appendChild(host);
  window.gijoChatParts.dataCard(host, {
    title: "관문-히트맵", kpis: [{ label: "표본", value: "3" }], pickKey: "t",
    table: {
      cols: [{ key: "sev", label: "심각" }, { key: "t", label: "제목" }],
      shown: [{ sev: "치명", t: "a" }, { sev: "높음", t: "b" }, { sev: "중간", t: "c" }],
      totalCount: 3,
    },
  }, {});
  const seg = host.querySelector(".dc-seg");
  if (!seg) return { seg: false };
  seg.querySelectorAll("span")[1].click();
  const cls = [...host.querySelectorAll(".dc-tile")].map((t) => t.className.replace("dc-tile", "").trim());
  host.remove();
  return { seg: true, cls };
});
ok("히트맵 토글·색사전", 히트.seg && JSON.stringify(히트.cls) === '["bad","warn","muted"]', JSON.stringify(히트.cls));

// ── ⑤′ AI 팀 가시화(2026-08-20) — 레일 로스터(팀6+부품4·약자)·대시보드 팀 카드·지식창고 ──
const 가시화 = await 셸.evaluate(async () => {
  const 로스터 = [...document.querySelectorAll("#gijoRail .rr-item")];
  const 약자들 = 로스터.slice(0, 6).map((b) => (b.title || ""));
  // 대시보드 프레임(도킹)에서 팀 카드·지식창고 확인
  return {
    로스터수: 로스터.length,
    약자적용: 약자들.filter((t) => /^\[[가-힣]{2}\] /.test(t)).length, // 툴팁 [약자] 이름(표시는 아이콘 — 사장님 정정)
  };
});
ok("레일 로스터 10개(팀6+부품4)", 가시화.로스터수 === 10, "개수=" + 가시화.로스터수);
ok("로스터 약자(등록부 단일 출처) 반영", 가시화.약자적용 === 6, "약자 " + 가시화.약자적용 + "/6");
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("dashboard.html", "대시보드", { dock: true }));
  const df = await 프레임찾기("dashboard.html", 8);
  const r = df ? await df.evaluate(() => {
    const 카드 = document.getElementById("aiteamRow");
    const 칩 = 카드 ? 카드.querySelectorAll(".aiteam-chip").length : 0;
    // 지식창고는 기본 접힘 — 「접기는 접은 채로, 검증 땐 펴서 잰다」: 펴서 KPI가 그려졌는지
    const head = document.querySelector("[data-gijo-fold] , .gjf-h");
    const kb = document.getElementById("kbKpi");
    return { 칩, kb있음: !!kb, kb내용: kb ? (kb.textContent || "").length : 0 };
  }).catch(() => null) : null;
  ok("대시보드 팀 카드 6칩", !!r && r.칩 === 6, r ? "칩=" + r.칩 : "프레임 못 찾음");
  ok("지식창고 렌더(KPI)", !!r && r.kb있음 && r.kb내용 > 0, r ? "내용 " + r.kb내용 + "자" : "");
}

// ── ⑥ 💬 새 세션(2026-08-20) — 확인창(작업 내역 저장 안내) → 확인 → 대화 초기화 ──
// ⚠ 대화를 비우므로 반드시 **맨 마지막** 검사여야 한다(앞 검사들의 카드가 사라진다).
const 새세션 = await 셸.evaluate(async () => {
  const btn = document.getElementById("railHome");
  if (!btn) return { no: "railHome 없음" };
  btn.click();
  await new Promise((r) => setTimeout(r, 600));
  const dlg = document.getElementById("gijoDlg");
  if (!dlg) return { no: "확인창 안 뜸" };
  const 문구저장 = (dlg.textContent || "").includes("작업 내역");
  const okBtn = dlg.querySelector("button.ok");
  if (okBtn) okBtn.click();
  await new Promise((r) => setTimeout(r, 1000));
  const body = document.getElementById("csBody");
  // 새 세션 뒤는 「처음 화면(대화 홈)」 — 대화 행 0 + 홈 히어로(.cs-empty) 복원(검토관 M4 계약)
  return {
    문구저장,
    초기화: !!body && body.querySelectorAll(".cs-row").length === 0,
    홈복원: !!body && !!body.querySelector(".cs-empty"),
  };
});
ok("💬 새 세션: 확인창+저장 안내", !!새세션.문구저장, 새세션.no || "");
ok("💬 새 세션: 대화 초기화+홈 복원", !!새세션.초기화 && !!새세션.홈복원);

await browser.close().catch(() => {});
정리();
console.log(실패.length ? "[ui관문] ✕ 실패 " + 실패.length + "건: " + 실패.join(", ") : "[ui관문] ✓ 전부 통과");
process.exit(실패.length ? 1 : 0);
