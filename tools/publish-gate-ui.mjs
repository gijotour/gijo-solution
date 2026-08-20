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
  // 2026-08-20 B라운드: 📌 칩(.cs-sel) → 맥락 문장 한 줄(.cs-line, 「…을 다루는 중」)로 흡수.
  const 칩 = await 셸.evaluate(() => (document.querySelector(".cs-line") || {}).textContent || "");
  ok("행 클릭 → 맥락 문장(다루는 중)", /다루는 중/.test(칩), String(칩).slice(0, 60));
  // 행 선택은 무대를 유지한다(검토관 상1 — 자동 복귀는 결재 확인창·모달을 삼켜 폐지).
  // 맥락 문장이 「…다루는 중」으로 바뀌고, 무대 머리가 「골랐습니다」를 알린다. 내리기는 ← 대화로(사람)뿐.
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

// ── ③′ AI 지식 엑셀형(승인 시안 knowledge-rows, 2026-08-20) — 행 목록이 실데이터로 그려지는가.
//    운영에 문서 90여 건이 있으므로 행 0이면 렌더가 죽은 것이다(옛 .dm-li로 되돌아간 것도 실패).
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("memory.html", "AI 지식", { dock: true }));
  const fr = await 프레임찾기("memory.html", 8);
  const r = fr ? await fr.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      if (document.querySelector(".g-rows--docs .g-rows-r")) break;
      await new Promise((x) => setTimeout(x, 400));
    }
    return {
      행: document.querySelectorAll(".g-rows--docs .g-rows-r").length,
      그룹: document.querySelectorAll(".g-rows--docs .g-rows-gh").length,
      옛것: document.querySelectorAll(".dm-li").length,
    };
  }).catch(() => null) : null;
  ok("AI 지식 엑셀형(행·그룹·옛 목록 0)", !!r && r.행 > 0 && r.그룹 > 0 && r.옛것 === 0, JSON.stringify(r));
}

// ── ③″ 고르기 모드(승인 시안 stage-picker, 2026-08-20) — 행 클릭이 대화로 돌아오는가.
//    pickdone 신호→선택 달림→무대 내림까지 실측(운영 취약점 190여 건이라 행 0이면 렌더 사망).
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("pick.html?kind=vuln", "고르기"));
  const fr = await 프레임찾기("pick.html", 8);
  // ⚠ 전(前) 상태를 먼저 잰다(관문 헛계측 교훈 — 부정 경로 필수): 무대가 올라가 있고,
  //   문장에 아직 「다루는 중」이 없어야 클릭의 **전이**를 잰 것이다. 0→0이면 헛초록.
  const 전 = await 셸.evaluate(() => ({
    무대: document.body.classList.contains("stage-on"),
    다루는중: /다루는 중/.test((document.getElementById("csCtx") || {}).textContent || ""),
  }));
  let r = null;
  if (fr) {
    r = await fr.evaluate(async () => {
      for (let i = 0; i < 20; i++) {
        if (document.querySelector(".pk-row")) break;
        await new Promise((x) => setTimeout(x, 400));
      }
      const row = document.querySelector(".pk-row");
      if (!row) return { 행: 0 };
      row.click();
      return { 행: document.querySelectorAll(".pk-row").length };
    }).catch(() => null);
  }
  await new Promise((x) => setTimeout(x, 800));
  const 후 = await 셸.evaluate(() => ({
    무대내림: !document.body.classList.contains("stage-on"),
    문장: (document.getElementById("csCtx") || {}).textContent || "",
  }));
  ok("고르기: 무대↑·행 클릭 → 무대 내림+선택(다루는 중, 전이 실측)",
    전.무대 && !전.다루는중 && !!r && r.행 > 0 && 후.무대내림 && /다루는 중/.test(후.문장),
    JSON.stringify({ 전, 행: r && r.행, 무대내림: 후.무대내림, 문장: String(후.문장).slice(0, 50) }));
}

// ── ③‴ 문서 허브 v4(승인 시안 docs-hub-v4-workspace, 2026-08-21) — 제품 안내 실렌더 +
//    문서창 안 편집. 문서함 창은 폐지됐다 — 여기가 제품 안내의 **유일한** 읽기 자리라,
//    행 0이면 제품 안내 전체가 사라진 것이다(출하 문서 12건이 담겨 있어 0은 원리상 렌더 사망).
//    편집기는 전(닫힘)→후(열림) 전이로 잰다(관문 헛계측 교훈 — 전 상태 단언 필수).
//    ⚠ v4에서 자리가 바뀐 것: 탭줄 → 사이드바(.v4node) · 전폭 스테이지 → 문서창(#v4doc) 안.
//    📖 열어 보기는 이제 **행을 누르면 자동**이라, 단추를 눌러도 안 눌러도 본문이 와야 한다.
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("mydocs.html?tab=guide", "내 문서", { dock: true }));
  const fr = await 프레임찾기("mydocs.html", 8);
  const r = fr ? await fr.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      if (document.querySelector(".g-rows--hub-guide .g-rows-r")) break;
      await new Promise((x) => setTimeout(x, 400));
    }
    const 행들 = document.querySelectorAll(".g-rows--hub-guide .g-rows-r");
    if (!행들.length) return { 안내행: 0 };
    // v4 껍데기 — 목록이 위로 올라왔는지(세로 시작점)와 3단이 실제로 섰는지
    const 목록시작 = Math.round(행들[0].getBoundingClientRect().top);
    const 문서창 = document.getElementById("v4doc");
    const 사이드 = document.getElementById("v4side");
    행들[0].click();
    let 본문 = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((x) => setTimeout(x, 400));
      const rb = document.getElementById("readBody");
      if (rb && rb.textContent && rb.textContent.length > 200 && !/여는 중/.test(rb.textContent)) { 본문 = true; break; }
    }
    // ⚠ 열람 중에도 목록이 **보여야** 한다 — v4의 핵심(왕복 없음). 노드 수만 세면 v3에서도
    //   참이고(v3는 #cols를 display:none으로 감췄을 뿐 노드는 남았다), v4 자신의 좁은 폭
    //   (문서창이 목록을 덮는 상태)도 통과한다. **실제로 보이는지**를 재야 계약을 지킨다.
    //   (검토관 2026-08-21 상1 — 「DOM 존재는 보임의 증거가 아니다」)
    const 첫행 = document.querySelector(".g-rows--hub-guide .g-rows-r");
    const 열람중목록 = 첫행 && 첫행.offsetParent !== null && 첫행.getBoundingClientRect().width > 0
      ? document.querySelectorAll(".g-rows--hub-guide .g-rows-r").length : 0;
    // 📖 단추가 **실제로 다시 연다**는 것까지 잰다(존재만 보면 그 갈래가 죽어도 통과한다 — 중5).
    const 열어보기 = document.querySelector('#detail button[data-act="read"]');
    let 재열림 = false;
    if (열어보기) {
      document.getElementById("readBody").innerHTML = "";
      열어보기.click();
      for (let i = 0; i < 15; i++) {
        await new Promise((x) => setTimeout(x, 400));
        const rb = document.getElementById("readBody");
        if (rb && rb.textContent.length > 200 && !/여는 중/.test(rb.textContent)) { 재열림 = true; break; }
      }
    }
    document.getElementById("readBack").click();
    // ⚠ 가드로 넘기지 않는다 — 선택자가 죽으면 여기서 조용히 건너뛰고 **뒤 판정만으로 초록**이 된다
    //   (btnNew는 도구줄이 숨어 있어도 programmatic click이 먹는다 — 검토관 중6).
    const mineBtn = document.querySelector('#tabs .v4node[data-t="mine"]');
    if (mineBtn) mineBtn.click();
    await new Promise((x) => setTimeout(x, 300));
    const 편집전 = document.getElementById("editStage").classList.contains("on"); // 전 상태 — false여야 전이를 잰 것
    document.getElementById("btnNew").click();
    await new Promise((x) => setTimeout(x, 250));
    const 편집열림 = document.getElementById("editStage").classList.contains("on");
    // 편집기가 문서창 **안에서** 열렸는가 — 전폭 스테이지로 되돌아가면 v4가 아니다
    const 편집이문서창안 = 편집열림 && 문서창.contains(document.getElementById("editStage"));
    // 폭 계약을 **잰다**(검토관 하11) — 「40px 이상」은 접힘 44와 펼침 200을 구분하지 못해
    // 아무것도 안 지켰다. 계약은 「1000px 미만이면 접힌다」이므로 그대로 확인한다.
    const 루트폭 = Math.round(document.getElementById("v4root").getBoundingClientRect().width);
    const 접힘 = 사이드.classList.contains("collapsed");
    return {
      안내행: 행들.length, 목록시작, 본문, 열람중목록, 재열림,
      편집전, 편집열림, 편집이문서창안,
      루트폭, 접힘, 폭계약: 접힘 === (루트폭 < 1000),
      사이드바폭: Math.round(사이드.getBoundingClientRect().width),
      템플릿: document.querySelectorAll("#tplDrawer .tpl-chip").length,
      노드클릭됨: !!document.querySelector('#tabs .v4node[data-t="mine"]'),
    };
  }).catch(() => null) : null;
  ok("문서 허브 v4: 제품 안내 렌더+행클릭 본문+열람 중 목록 **보임**+📖 재열기+문서창 편집 전이+폭 계약+템플릿 8종",
    !!r && r.안내행 > 0 && r.본문 && r.열람중목록 > 0 && r.재열림 && r.노드클릭됨
      && !r.편집전 && r.편집열림 && r.편집이문서창안 && r.템플릿 === 8
      && r.목록시작 < 140 && r.폭계약,
    JSON.stringify(r));
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
  // SVG fill=var() 실기 계측(배색 검토관 「확인 필요」) — 스윕이 만든 presentation attribute의
  // var()가 무효면 computed가 검정으로 떨어진다. 흰 바탕에서 검정 그래프는 그 자체가 답.
  // ⚠ 대상은 fill=var(가 실재하는 dashboard(카드예외라 dock으로 열림) — hardening으로 재던
  //   첫 판은 ①도킹 교체로 프레임이 이미 닫혔고 ②그 화면엔 fill=var(가 0곳이라 한 번도
  //   실측되지 않았다(검토관 백로그 상1 — 프레임 없으면 통과·실패 어느 쪽도 안 남던 것 포함).
  await 셸.evaluate(() => window.gijoTabs.open("dashboard.html", "대시보드", { dock: true }));
  const svgFr = await 프레임찾기("dashboard.html", 6);
  const svg색 = svgFr ? await svgFr.evaluate(() => {
    const el = document.querySelector('svg [fill^="var("], svg [stroke^="var("]');
    if (!el) return "대상 없음";
    const st = getComputedStyle(el);
    return el.hasAttribute("fill") ? st.fill : st.stroke;
  }).catch(() => "평가 실패") : "프레임 못 찾음";
  ok("SVG 토큰 색 해석(fill=var)", svg색 !== "rgb(0, 0, 0)" && svg색 !== "평가 실패" && svg색 !== "프레임 못 찾음", String(svg색));
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

// ── ⑦ 현황판 스트립(승인 시안 panels-overview §1, 2026-08-20 1단계) ────────────────
//    ⚠ **⑥ 새 세션 뒤에 둔다.** 스트립은 대화 홈(body.chat-home)에서만 보이는데 앞 검사들이
//      대화를 채워 홈이 아니다 — 앞에 두면 「0개」로 빨간불이 나서 제품이 아니라 검사가 틀린다
//      (관문 헛계측 교훈의 반대 짝: 상태를 안 맞추고 재면 거짓 실패가 난다).
//    무엇을 재나: 판이 실제로 그려지는가(0이면 부품 로드 실패 — 5.36.0 거짓 초록 계열) ·
//    **정직 표시**(마지막 확인 시각)가 붙는가 · 「전체 보기」가 펼쳐지는가 · 입력칸 0(메뉴는 보기용).
{
  const r = await 셸.evaluate(async () => {
    for (let i = 0; i < 25; i++) {
      if (document.querySelectorAll("#cePanels .pv-tile").length) break;
      await new Promise((x) => setTimeout(x, 400));
    }
    const 타일 = [...document.querySelectorAll("#cePanels .pv-tile")];
    const 첫 = 타일[0] ? 타일[0].textContent || "" : "";
    // ⚠ **압축(대화 홈)의 ▾를 먼저 눌러 본다**(2026-08-20 병렬 검토). 전체 보기를 먼저 누르면
    //   그 뒤 검사가 전부 「전체 지도」 쪽 단추를 재게 되어, 사장님이 실제로 쓰는 첫 화면 경로가
    //   한 번도 안 눌린 채 초록이 난다. 여기가 이번 라운드의 새 배선이라 반드시 재야 한다.
    // ⚠ **첫 번째 단추만 누르면 안 된다**(2026-08-20 설계관 경고 → 실제로 밟았다): 판 순서는
    //   「움직임 순」이라 유동적이고, 운영은 라이브 모드라 **0건이 정상인 판**(예: CTI 탐지)이
    //   첫 자리에 올 수 있다. 그러면 제품이 멀쩡한데 게시가 막힌다.
    //   → 단추를 차례로 눌러 **하나라도 실제 행이 나오면** 통과로 본다. 전부 0이면 그때는
    //     진짜 문제이므로 실패시킨다(헛초록도 막는다).
    let 압축목록행 = 0, 압축전폭 = false, 압축시도 = 0;
    const 압축단추들 = [...document.querySelectorAll('#cePanels button[data-act="rows"]')];
    for (const 압축펴기 of 압축단추들) {
      압축시도++;
      압축펴기.click();
      for (let i = 0; i < 15; i++) {
        await new Promise((x) => setTimeout(x, 300));
        압축목록행 = document.querySelectorAll("#cePanels .pv-rows .g-rows-r").length;
        if (압축목록행) break;
      }
      // 펼친 목록이 **줄 전체 폭**을 쓰는지(1열이 안 무너지는지) 확인 — 타일 한 칸 안에서는
      // 1열이 0px로 사라진다(병렬 검토 상2). 셀의 gridColumn이 넓어졌는지로 잰다.
      const cell = 압축펴기.closest(".pv-cell");
      압축전폭 = !!(cell && /1\s*\/\s*-1/.test(cell.style.gridColumn || ""));
      압축펴기.click();   // 도로 접어 다음 검사에 영향을 주지 않는다
      await new Promise((x) => setTimeout(x, 300));
      if (압축목록행) break;   // 실제 행이 나온 판을 하나 찾았으면 충분하다
    }
    const 전체보기 = document.getElementById("pvMore");
    let 펼침 = 0;
    if (전체보기) {
      전체보기.click();
      for (let i = 0; i < 25; i++) {
        await new Promise((x) => setTimeout(x, 400));
        펼침 = document.querySelectorAll("#cePanels .pv-tile").length;
        if (펼침 > 타일.length) break;
      }
    }
    // ⚠ **실패 판 수를 반드시 센다**(검토관 하18). 「확인 …」 꼬리는 실패해도 붙으므로 그것만
    //   보면 17판 전부 「불러오지 못했습니다」여도 초록이 된다 — 관문이 헛초록을 내는 자리다.
    const 실패 = [...document.querySelectorAll("#cePanels .pv-fail")].length;
    // 목록을 실제로 펴서 **첫 열에 내용이 있는지**까지 본다(단추 개수만 세면 첫 열이 전부
    //   「-」인 채로 통과한다 — 필드명 오인 5번째가 그렇게 초록이었다).
    // ⚠ 압축과 같은 이유로 **여러 판을 차례로** 눌러 본다 — 0건이 정상인 판이 첫 자리에
    //   오면 제품이 멀쩡한데 게시가 막힌다(2026-08-20 실제로 밟았다).
    let 목록행 = 0, 첫열있음 = false;
    for (const 펴기 of [...document.querySelectorAll('#cePanels button[data-act="rows"]')]) {
      펴기.click();
      for (let i = 0; i < 15; i++) {
        await new Promise((x) => setTimeout(x, 300));
        const rows = document.querySelectorAll("#cePanels .pv-rows .g-rows-r");
        if (rows.length) {
          목록행 = rows.length;
          첫열있음 = [...rows].slice(0, 5).every((row) => {
            const c = row.querySelector("span");
            const t = (c && c.textContent || "").trim();
            return t && t !== "-";
          });
          break;
        }
      }
      if (목록행) break;
      펴기.click();   // 빈 판은 도로 접는다
      await new Promise((x) => setTimeout(x, 200));
    }
    return {
      압축: 타일.length,
      확인시각: /확인 /.test(첫),          // 「조용함」과 「확인 못 함」을 가르는 정직 표시
      실패,
      압축목록행,                          // 첫 화면(사장님이 실제로 쓰는 경로)에서 잰 값
      압축전폭,                            // 펼친 목록이 줄 전체 폭을 쓰는가(1열 보존)
      입력칸: document.querySelectorAll("#cePanels input, #cePanels textarea").length,
      펼침,
      목록단추: document.querySelectorAll('#cePanels button[data-act="rows"]').length,
      목록행,
      첫열있음,
    };
  }).catch(() => null);
  ok("현황판: 홈 ▾ 목록(첫 화면 경로)·줄 전체 폭·실패 0·전체보기·첫 열 실내용·입력칸 0",
    !!r && r.압축 > 0 && r.압축 <= 6 && r.확인시각 && r.실패 === 0 && r.입력칸 === 0
      && r.압축목록행 > 0 && r.압축전폭          // 첫 화면에서 실제로 펴지고 1열이 안 무너지는가
      && r.펼침 > r.압축 && r.목록단추 > 0 && r.목록행 > 0 && r.첫열있음,
    JSON.stringify(r));
}

await browser.close().catch(() => {});
정리();
console.log(실패.length ? "[ui관문] ✕ 실패 " + 실패.length + "건: " + 실패.join(", ") : "[ui관문] ✓ 전부 통과");
process.exit(실패.length ? 1 : 0);
