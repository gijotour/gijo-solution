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

// 🌙 **오래된 초록은 초록이 아니다**(2026-08-31). 야간 회귀(152상황)가 며칠째 안 돌았는데
//   게시하면, 「매일 도는 감시가 지킨다」는 전제 위에서 근거 없이 내보내는 것이 된다.
//   실제로 08-25·26 두 밤이 결석했고 아무도 몰랐다(그 전 08-12에도 같은 일이 있었다).
//   ⚠ 하루는 흔하다(기계 꺼짐·시차) — **사흘 넘게** 비면 멈춘다. 원인 ⑤로 센다.
{
  const { 결석현황 } = await import("./nightly-gap.mjs");
  const 결석 = 결석현황(repo);
  console.log("[ui관문] 🌙 " + 결석.문장);
  if (결석.빈날 > 2) {
    console.error("[ui관문] exit 3 원인⑤: 야간 회귀가 " + 결석.빈날 + "일째 안 돌았습니다 — 게시 중단.");
    console.error("  회귀 증거 없이 내보내지 않습니다. `node tools/ops-sim.mjs`로 한 회차를 돌리고 다시 게시하세요.");
    process.exit(3);
  }
}

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
// ⚠ 「정확히 1개」에서 완화(2026-08-21 연계성 라운드) — 화면별 이어가기 칩이 붙을 수 있다.
//   하한(≥1)과 「쉽게 설명」 포함은 그대로 지킨다 — 0개 통과 구멍은 안 만든다.
ok("일반형: 칩 ≥1(쉽게 설명 포함)", 일반.chips.length >= 1 && 일반.chips.some((c) => /쉽게 설명/.test(c)), JSON.stringify(일반.chips));
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
  // 행 선택은 화면을 유지한다(검토관 상1 — 자동 복귀는 결재 확인창·모달을 삼켜 폐지).
  // 맥락 문장이 「…다루는 중」으로 바뀌고, 머리가 「골랐습니다」를 알린다. 접기는 ⊟ 화면 접기(사람)뿐.
  const 선택후 = await 셸.evaluate(() => ({
    무대유지: document.body.classList.contains("stage-on"),
    표시: /골랐습니다|화면 접기/.test((document.getElementById("stageBack") || {}).textContent || ""),
  }));
  ok("행 선택: 🎯 달고 화면 유지(접기는 ⊟ 화면 접기)", 선택후.무대유지 && 선택후.표시, JSON.stringify(선택후));
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

// ── ③‴ AI 팀 로스터 · 🌐 외부지원 명패(승인 시안 agent-external-member, 2026-09-02) ─────────
//   ⚠ **무엇을 재는지 정직하게 적는다.** 이 관문 환경은 원격 GPU가 꺼져 있어 명패가 하나도
//     안 붙는 것이 **정상**이다(외부지원인가()가 전원 false). 그러니 「명패가 보인다」로는 못 잰다.
//   그래서 이 셋을 잰다:
//    ① **카드 > 0** — `extTagHtml(a)`는 카드 템플릿 **안**에서 불린다. 그것이 던지면
//       `agentGrid.innerHTML` 대입 자체가 실패해 **카드가 0이 된다.** 즉 카드 수가 곧
//       명패 함수의 생존 증거다(가장 무서운 실패 모드 — 화면이 하얘지는 것 — 를 잡는다).
//    ② **#extStrip 존재** — 새 자리가 실제로 실렸는가(파일이 안 갔거나 되돌려졌으면 없다).
//    ③ **낡은 숫자 0** — 「32B 약 37초 · 72B 약 90초」가 화면 글에 다시 나타나면 실패.
//       원격이 Qwen3.8(125B)로 바뀐 뒤에도 그대로였던 **틀린 안내**가 되살아나는 것을 막는다.
//   ⚠ `renderExtStrip()`이 던지는 경우는 이 셋으로 못 잡는다(카드 뒤에 불린다) — 알고 남긴다.
//     원격이 켜진 환경에서 관문을 돌릴 수 있게 되면 그때 「명패 > 0」을 더한다.
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("agent.html", "AI 팀", { dock: true }));
  const fr = await 프레임찾기("agent.html", 8);
  const r = fr
    ? await fr
        .evaluate(async () => {
          for (let i = 0; i < 20; i++) {
            if (document.querySelector(".agent-card")) break;
            await new Promise((x) => setTimeout(x, 400));
          }
          const 글 = document.body.innerText || "";
          return {
            카드: document.querySelectorAll(".agent-card").length,
            띠자리: !!document.getElementById("extStrip"),
            명패: document.querySelectorAll(".ext-tag").length, // 원격 꺼짐이면 0이 정상
            낡은숫자: /32B\s*약?\s*\d+\s*초|72B\s*약?\s*\d+\s*초/.test(글),
          };
        })
        .catch(() => null)
    : null;
  ok(
    "AI 팀 로스터(카드>0 = 명패 함수 생존 · 띠자리 · 낡은숫자 0)",
    !!r && r.카드 > 0 && r.띠자리 && !r.낡은숫자,
    JSON.stringify(r)
  );
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

  // ── ③⁗ 2026-08-22에 새로 생긴 두 갈래 — **읽기 검토가 원리상 못 잡는 것**을 여기서 잰다.
  //
  // ■ 왜 관문에 더하나: 그날 검토 네 라운드가 잡은 [높음] 둘이 **렌더링 결함**이었다 —
  //   반입 목록의 파일명 칸이 0px로 접힌 것, 담당자 편집 폼이 대비 1.07:1이 된 것.
  //   둘 다 코드를 읽어서는 폭·대비를 손으로 계산해야 겨우 나오고, **띄워 보면 즉시 보인다.**
  //   이 저장소 규칙 그대로다: 「새 배선은 관문에 검사를 더하는 것이 정석」.
  if (fr) {
    const s = await fr.evaluate(async () => {
      const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
      const 재기 = (el) => (el ? el.getBoundingClientRect().width : 0);
      // 🩹 반입 탭으로
      const 반입노드 = document.querySelector('#tabs .v4node[data-t="ingest"]');
      if (반입노드) { 반입노드.click(); await 잠깐(1200); }
      const 머리 = document.querySelector("#list .g-rows-head");
      const 첫줄 = document.querySelector("#list .g-rows-r");
      const 칸수 = 머리 ? (getComputedStyle(머리).gridTemplateColumns || "").trim().split(/\s+/).length : 0;
      // ★ 파일명 칸(첫 칸)이 실제로 폭을 갖는가 — 0px로 접히면 파일명이 아예 안 보인다.
      const 첫칸폭 = 머리 ? parseFloat((getComputedStyle(머리).gridTemplateColumns || "0").trim().split(/\s+/)[0]) : 0;
      const 머리칸수 = 머리 ? 머리.querySelectorAll("span").length : 0;
      const 줄칸수 = 첫줄 ? 첫줄.querySelectorAll(":scope > span").length : 0;

      // 📞 연락처 → ✏ 담당자 관리 (셸 배색을 따르는지)
      const 연락처노드 = document.querySelector('#tabs .v4node[data-t="contacts"]');
      if (연락처노드) { 연락처노드.click(); await 잠깐(900); }
      const 관리단추 = document.getElementById("cxManage");
      if (관리단추) { 관리단추.click(); await 잠깐(1500); }
      const 틀 = document.getElementById("cxContactsFrame");
      const 틀높이 = 틀 ? 틀.getBoundingClientRect().height : 0;
      const 틀주소 = 틀 ? String(틀.getAttribute("src") || "") : "";
      return { 칸수, 첫칸폭, 머리칸수, 줄칸수, 줄있나: !!첫줄, 틀높이, 틀주소 };
    }).catch(() => null);

    // 줄이 없을 수도 있다(영수증 0건) — 그때는 칸 계산만 잰다. 없는 것을 실패로 만들지 않는다.
    ok("반입 탭: 칸 수 일치 · **파일명 칸이 접히지 않음**(≥90px)",
      !!s && s.칸수 === 4 && s.머리칸수 === 4 && s.첫칸폭 >= 90 && (!s.줄있나 || s.줄칸수 === 4),
      JSON.stringify(s && { 칸수: s.칸수, 첫칸폭: Math.round(s.첫칸폭), 머리칸수: s.머리칸수, 줄칸수: s.줄칸수 }));

    // 담당자 관리 창 — **열리고 쓸 만한 높이**이고 배색 신호를 실었는가.
    //   (그전엔 부모에 높이가 없어 iframe이 기본 150px로 접혔다 — 「열리지만 못 쓰는」 상태였다.)
    ok("담당자 관리: 문서창에서 열리고 높이가 산다(≥300px) + 셸 배색 신호 전달",
      !!s && s.틀높이 >= 300 && /theme=(host|light)/.test(s.틀주소),
      JSON.stringify(s && { 틀높이: Math.round(s.틀높이), 틀주소: s.틀주소 }));

    // ── ③⁙ 노트북형(시안 mydocs-notebook, 2026-08-30) — ☑ 근거 지정·📎 지난 작업.
    //   읽기 검토가 못 잡는 것: 체크→postMessage→셸 재조립→근거띠 칩까지 **네 단계 릴레이**라
    //   한 단계만 끊겨도 화면은 멀쩡해 보인다(칩이 안 뜰 뿐). 띄워서 끝까지 잰다.
    const nb = await fr.evaluate(async () => {
      const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
      // ⚠ 직전 검사(연락처 관리)가 문서창 스테이지를 열어 둔 채다 — 그 상태로 탭을 누르면
      //   쓰던글확인()이 **gijoAsk 모달**(#gijoDlg)을 띄우고 답을 기다려 전환이 영영 멈추고,
      //   이 검사는 직전 탭의 잔상을 재게 된다(1·2차 실행 실측 — 단독 실행은 ☑ 120개 정상).
      //   스테이지를 닫고, 되묻는 모달이 뜨면 「확인(.ok)」으로 답해 준다(사람이 하는 그대로).
      const 모달확인 = async () => {
        const ok = document.querySelector("#gijoDlg .ok");
        if (ok) { ok.click(); await 잠깐(400); }
      };
      const 닫기 = document.getElementById("v4close");
      if (닫기 && 닫기.offsetParent !== null) { 닫기.click(); await 잠깐(500); await 모달확인(); }
      await 모달확인(); // 탭 전환이 이미 모달에 걸려 있던 경우까지
      // 📎 지난 작업 탭이 그려지는가(빈 목록이어도 머리·빈 안내는 떠야 한다)
      const 작업노드 = document.querySelector('#tabs .v4node[data-t="work"]');
      if (작업노드) { 작업노드.click(); await 잠깐(700); await 모달확인(); await 잠깐(700); }
      // ★ 잔상 방지 — 「지난 작업」 탭이 진짜 활성인지까지 본다(직전 탭 머리를 재면 헛계측)
      const 작업활성 = !!document.querySelector('#tabs .v4node.on[data-t="work"]');
      const 작업머리 = 작업활성 && (!!document.querySelector("#list .g-rows-head") || !!document.querySelector("#list .empty"));
      // 회사 지식 탭에서 첫 ☑ 체크 → gijo:docscope 발신
      const 지식노드 = document.querySelector('#tabs .v4node[data-t="know"]');
      if (지식노드) { 지식노드.click(); await 잠깐(700); await 모달확인(); await 잠깐(700); }
      const 첫체크 = document.querySelector("#list .dchk");
      if (첫체크) { 첫체크.click(); await 잠깐(600); }
      return { 작업노드: !!작업노드, 작업머리, 체크있나: !!첫체크, 체크됨: !!(첫체크 && 첫체크.checked) };
    }).catch(() => null);
    // 셸(대화창)에 근거띠 칩이 실제로 떴는가 — 릴레이 종점 실측
    const 칩 = await 셸.evaluate(() => {
      const g = document.getElementById("csGround");
      const c = g && g.querySelector(".cs-gchip.gdoc");
      return { 띠있나: !!g, 칩글: c ? c.textContent.trim().slice(0, 30) : "" };
    }).catch(() => null);
    ok("노트북형: 📎 지난 작업 탭 렌더 + ☑ 체크 → 근거띠 칩(4단계 릴레이 실측)",
      !!nb && nb.작업노드 && nb.작업머리 && nb.체크있나 && nb.체크됨
        && !!칩 && 칩.띠있나 && /근거: 문서 1/.test(칩.칩글),
      JSON.stringify({ nb, 칩 }));
    // 칩 ×(전체 해제) → mydocs 체크도 풀리는가 — 역방향 릴레이(화면-칩 딴말 방지)
    await 셸.evaluate(() => {
      const x = document.querySelector("#csGround .cs-gchip.gdoc .gx");
      if (x) x.click();
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, 600));
    const 해제 = await fr.evaluate(() =>
      ![...document.querySelectorAll("#list .dchk")].some((k) => k.checked)
    ).catch(() => null);
    const 칩후 = await 셸.evaluate(() => !document.querySelector("#csGround .cs-gchip.gdoc")).catch(() => null);
    ok("노트북형: 칩 × → 칩 사라짐 + 화면 체크 해제(역방향 릴레이)", 해제 === true && 칩후 === true,
      JSON.stringify({ 해제, 칩사라짐: 칩후 }));
  }
}

// ── 📂 지켜보는 폴더 판(2026-08-31 2단계 — 「새 배선은 관문에 검사 추가」 정석) ──────────
// 딥링크 ?tab=watch로 열려 판이 실제로 그려지는지 — 서버 조회(watchFolders)가 죽으면
// 목록도 빈 상태 안내도 없이 하얗다(그게 이 검사가 잡는 부류다).
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("mydocs.html?tab=watch", "지켜보는 폴더", { dock: true }));
  const fr = await 프레임찾기("mydocs.html", 8);
  const r = fr ? await fr.evaluate(async () => {
    for (let i = 0; i < 15; i++) {
      const t = (document.getElementById("list")?.innerText || "");
      if (t.includes("지켜보는 폴더")) break;
      await new Promise((x) => setTimeout(x, 400));
    }
    const node = document.querySelector('#tabs .v4node[data-t="watch"]');
    return {
      탭있음: !!node,
      탭활성: !!(node && node.classList.contains("on")),
      판글: (document.getElementById("list")?.innerText || "").slice(0, 60),
    };
  }).catch(() => null) : null;
  ok("📂 지켜보는 폴더 판: 딥링크로 열리고 목록/빈 상태가 그려진다",
    !!r && r.탭있음 && r.탭활성 && r.판글.includes("지켜보는 폴더"),
    r ? JSON.stringify(r) : "프레임 못 찾음");
}

// ── 📨 조치 요청서 판(2026-08-31) — 📂와 **같은 계약**이라 적었으면 등록도 같아야 한다
//    (검토관 [중간]: 커밋이 같은 계약이라 해 놓고 관문 등록만 빠졌다). 여기는 새 서버
//    창구(mine=1)까지 지나는 자리라, 창구가 죽으면 판이 빈손인 채 조용히 뜬다 —
//    「보기 전용 판」은 **눌러도 아무 일이 없는 것이 정상**이라 사람 눈으로는 구별이 안 된다.
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("mydocs.html?tab=req", "조치 요청서", { dock: true }));
  const fr = await 프레임찾기("mydocs.html", 8);
  const r = fr ? await fr.evaluate(async () => {
    for (let i = 0; i < 15; i++) {
      const t = (document.getElementById("list")?.innerText || "");
      if (t.includes("조치 요청서")) break;
      await new Promise((x) => setTimeout(x, 400));
    }
    const node = document.querySelector('#tabs .v4node[data-t="req"]');
    const 줄 = document.querySelector('#list .g-rows-r[data-req]');
    return {
      탭있음: !!node,
      탭활성: !!(node && node.classList.contains("on")),
      판글: (document.getElementById("list")?.innerText || "").slice(0, 60),
      // 보기 전용 계약: 줄이 있으면 반드시 .noclick — 없으면 클릭이 일반 처리기로 흘러
      //   좁은 폭에서 **빈 문서창이 목록을 덮는다**(2026-08-22 vendor 탭 전례의 재발).
      줄있음: !!줄,
      보기전용: !줄 || 줄.classList.contains("noclick"),
    };
  }).catch(() => null) : null;
  ok("📨 조치 요청서 판: 딥링크로 열리고, 줄은 보기 전용(.noclick)이다",
    !!r && r.탭있음 && r.탭활성 && r.판글.includes("조치 요청서") && r.보기전용,
    r ? JSON.stringify(r) : "프레임 못 찾음");
}

// ── ④′ 화면 열기 → 현황 카드 자동(2026-08-20 사장님 — 「메뉴를 누르면 상위 카드」) ──
const 카드전 = await 셸.evaluate(() => document.querySelectorAll(".dc-card").length);
await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("assets.html", "자산 고르기")); // 무dock=메뉴성 — 화면+카드가 나란히 떠야 한다(2026-08-31 개정)
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
  // ★ 계약 개정(2026-08-31 사장님 — 실화면 캡처 3장 「안티그래비티처럼, 3번 그림처럼」):
  //   메뉴성 열기도 **화면을 연다**(왼쪽 도킹) + 카드도 온다(5.38 계약 존속). 종전
  //   「카드가 전부」(2026-08-20 ×3)의 0→0 검사를 0→1로 뒤집었다 — 그대로 두면
  //   나란히로 고친 코드가 이 관문에서 막힌다(관문도 계약과 함께 개정).
  // ⚠ assets는 앞선 검사가 이미 열어 iframe이 잔존하므로, 이 관문에서 한 번도 안 연
  //   sessions.html(신설 작업내역 카드)로 0→1을 확인한다.
  const 프레임수 = (nm) => ctx.pages().reduce((n, p) => n + p.frames().filter((f) => f.url().includes(nm)).length, 0);
  const 전 = 프레임수("sessions.html");
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("sessions.html", "작업 내역"));
  let 세션카드 = false;
  for (let i = 0; i < 10 && !세션카드; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    세션카드 = await 셸.evaluate(() => [...document.querySelectorAll(".dc-card")].some((c) => (c.textContent || "").includes("작업 내역 — 대화 세션")));
  }
  const 후 = 프레임수("sessions.html");
  ok("메뉴 열기 → 화면이 열리고(0→1) 카드도 온다(2026-08-31 개정)", 세션카드 && 전 === 0 && 후 === 1, "신설카드 " + 세션카드 + " · 프레임 " + 전 + "→" + 후);
}
// assets 부품 확인 — 위 sessions 열기가 도킹을 교체해 assets 프레임은 닫혔다(2026-08-31
// 개정 후 메뉴 열기=도킹 교체). dock 명시로 다시 열어 부품을 확인한다.
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("assets.html", "자산 고르기", { dock: true })); // 부품 확인은 진짜 열어서
  const fr = await 프레임찾기("assets.html", 6);
  const has = fr ? await fr.evaluate(() => typeof window.gijoSelectNotify === "function").catch(() => false) : false;
  ok("부품 로드: assets.html", has, fr ? "" : "프레임 못 찾음");

  // ── 💬 대화창 온디맨드 실측 — 2026-08-31 사장님 「대화창은 필요할 때만 불러서 보고」 ──
  // ⚠ 계약 두 번째 개정: 2026-08-23 「나란히 상시」를 같은 사장님이 개정하셨다(시안
  //   shell-chat-ondemand). 화면이 열리면 기본=접힘(화면 전폭+오른쪽 💬 손잡이), 부르면
  //   나란히, ⊮로 다시 접고, ⓘ·질문 얹기(toChat)는 접힘을 강제로 푼다. 접힌 동안 도착분은
  //   배지. **기본값 자체는 소스 감시(wiringcontract) 몫** — 여기는 동작을 잰다(설치본
  //   프로필의 저장된 접힘 기억이 켜켜이 달라 기본값 실측은 비결정적이다).
  //   클래스 이름(stage-on)은 그대로다(QA·titlebar가 읽는다 — 갈면 여섯 곳이 어긋난다).
  const 상태읽기 = () => 셸.evaluate(() => {
    const con = document.querySelector(".work .console");
    const cs = getComputedStyle(con);
    const sm = document.getElementById("conSummon");
    return {
      무대: document.body.classList.contains("stage-on"),
      접힘: document.body.classList.contains("console-folded"),
      대화보임: cs.display !== "none" && con.offsetWidth > 0,
      화면보임: document.querySelector(".work .screens").offsetWidth > 0,
      손잡이보임: !!sm && getComputedStyle(sm).display !== "none",
      접기단추: !!document.getElementById("stageBack") && document.getElementById("stageBack").offsetParent !== null,
      옛팝업단추: !!document.getElementById("dockPop"),
      머리접기단추: !!document.getElementById("csFold"),
    };
  });
  await 셸.evaluate(() => window.gijoTabs.foldConsole());
  await new Promise((r) => setTimeout(r, 500));
  const 접힘상 = await 상태읽기();
  ok("온디맨드①: 접기 → 화면 전폭 + 💬 손잡이",
    접힘상.무대 && 접힘상.접힘 && !접힘상.대화보임 && 접힘상.화면보임 && 접힘상.손잡이보임,
    JSON.stringify(접힘상));
  await 셸.evaluate(() => window.gijoTabs.summonConsole());
  await new Promise((r) => setTimeout(r, 500));
  const 무대 = await 상태읽기();
  ok("온디맨드②: 부르기 → 화면 왼쪽·대화 오른쪽 나란히(⊟·⊮ 단추)",
    무대.무대 && !무대.접힘 && 무대.대화보임 && 무대.화면보임 && 무대.접기단추 && 무대.머리접기단추 && !무대.옛팝업단추,
    JSON.stringify(무대));
  // ⚠ 1차본은 gijoTabs.toChat()을 **직접** 불렀다 — 사람은 그 길로 가지 않는다(ⓘ·「이어서
  //   지시」는 console.js의 ask를 거친다). 직접 부르면 ask 안의 분기(무대가 켜졌으면 접힘만
  //   푼다)를 **건너뛰어**, 화면을 지우는 옛 행동이 돌아와도 관문이 통과시킨다. 사람이 가는
  //   길(gijoConsole.ask)로 재고, **접힘이 풀리는 것과 화면이 남는 것을 함께** 본다
  //   (2026-08-31 실측: 옛 판은 stage-on이 꺼지고 대화창이 폭을 다 먹었다).
  await 셸.evaluate(() => { window.gijoTabs.foldConsole(); });
  await new Promise((r) => setTimeout(r, 400));
  //   ⚠ ask가 아니라 prefill을 쓴다 — **같은 갈래(대화앞으로)를 지나면서 아무것도 보내지**
  //   **않는다.** ask로 재면 게시할 때마다 운영 대화에 QA 질문이 실입력으로 남는다(2026-08-19
  //   운영 리셋 이후 운영 데이터는 전부 실입력이라는 약속을 관문이 깨뜨리게 된다).
  await 셸.evaluate(() => window.gijoConsole && window.gijoConsole.prefill("이 화면에서 뭐 할 수 있어?"));
  await new Promise((r) => setTimeout(r, 900));
  const 강제 = await 상태읽기();
  ok("온디맨드③: ⓘ(사람 길)가 접힘을 풀되 **화면을 안 지운다**",
    !강제.접힘 && 강제.무대 && 강제.화면보임 && 강제.대화보임,
    JSON.stringify({ 접힘: 강제.접힘, 무대: 강제.무대, 화면: 강제.화면보임, 대화: 강제.대화보임 }));

  // ── 🧭 길찾기(0-5) — ☰는 길 잃은 사람이 오는 자리다. 묶음을 가르치고, 못 찾으면
  //    대화창으로 넘긴다. 셋 다 **문구**라 소스 감시로는 「있다」밖에 못 본다 — 실제로
  //    떠서 눌리는지는 여기서만 잡힌다.
  {
    await 셸.evaluate(() => window.gijoOpenFinder && window.gijoOpenFinder());
    await new Promise((r) => setTimeout(r, 700));
    const 길 = await 셸.evaluate(() => {
      const f = document.querySelector(".gtb-fmask");
      if (!f) return { 열림: false };
      const inp = f.querySelector("input");
      const chips = [].map.call(f.querySelectorAll(".gtb-fgb"), (e) => e.textContent);
      return { 열림: true, 문구: inp ? inp.placeholder : "", 칩수: chips.length, 칩: chips,
               순번남음: chips.some((t) => /^[①②③④⑤]/.test(t)) };
    });
    ok("길찾기①: ☰에 5묶음 칩이 뜨고 순번(①)은 안 보인다",
      길.열림 && 길.칩수 === 5 && !길.순번남음 && /묶음/.test(길.문구 || ""), JSON.stringify(길));
    const 막 = await 셸.evaluate(async () => {
      const i = document.querySelector(".gtb-fmask input");
      if (!i) return { 없음: "(입력칸 없음)" };
      i.value = "냉장고"; i.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 250));
      const n = document.querySelector(".gtb-fnone"), k = document.querySelector(".gtb-fask");
      return { 없음: n ? n.textContent : "", 대화길: k ? k.textContent : "" };
    });
    ok("길찾기②: 못 찾으면 대화창으로 넘기는 길이 있다(막다른 골목 아님)",
      /없습니다/.test(막.없음 || "") && /대화창에/.test(막.대화길 || ""), JSON.stringify(막));
    await 셸.evaluate(() => { const el = document.querySelector(".gtb-fmask"); if (el) el.remove(); });
  }

  // ── 셸 배치는 **전 화면 공통**(사장님 2026-08-29 「메뉴 판·‖ 접기·대화창 폭 조절
  //    전체 대시보드에 적용」) — 배선이 body 수준이라 이미 전역인데, 그 사실을 여기 못박는다.
  //    앞 검사들이 mydocs 아닌 탭(assets 등)을 여러 개 연 **지금 상태**에서 재야 뜻이 있다.
  {
    // ⚠ 1차본이 헛계측이었다(검토관 — 없는 API `gijoTabs.active()`를 불러 늘 ""이었고, 그 값을
    //   판정에 쓰지도 않았다). 고침: **mydocs 아닌 화면을 실제로 활성으로 만들고**(assets 도킹),
    //   실제 API activeScreen()으로 그 사실까지 판정식에 넣는다 — 부정 경로가 있는 검사만 검사다.
    await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("assets.html", "자산", { dock: true }));
    await new Promise((r) => setTimeout(r, 1200));
    const 전역 = await 셸.evaluate(() => {
      const nav = document.getElementById("gijoNav");
      const rsz = document.getElementById("conResize");
      const 활성 = (window.gijoTabs && window.gijoTabs.activeScreen && window.gijoTabs.activeScreen()) || "";
      return {
        // ⚠ **폭이 아니라 「살아 있나」를 잰다**(2026-09-02 F3-11 설계 검토).
        //   좁은 창에서 메뉴 판이 **자동으로 접히면**(--menu-w:0) offsetWidth가 0이 되어,
        //   창이 좁은 기계에서 게시할 때만 관문이 죽는 부류가 된다. 접힘은 정상 동작이지 결함이 아니다.
        //   qa-auto.mjs가 이미 쓰는 잣대(display !== "none")로 맞춘다 — 잣대를 둘로 두지 않는다.
        메뉴판: !!nav && getComputedStyle(nav).display !== "none",
        끌개: !!rsz && rsz.offsetParent !== null,
        활성: String(활성),
        비mydocs활성: !!활성 && !/mydocs/.test(String(활성)),
      };
    }).catch(() => null);
    ok("셸 전역: 메뉴 판·대화폭 끌개가 mydocs 아닌 **활성** 화면에서도 산다(전체 대시보드 계약)",
      !!전역 && 전역.메뉴판 && 전역.끌개 && 전역.비mydocs활성, JSON.stringify(전역));
  }
  // ⊟ 화면 접기 — 대화가 전폭이 되고, 화면(탭)은 산 채로 남는다(필터·스크롤 보존 계약).
  await 셸.evaluate(() => document.getElementById("stageBack").click());
  const 내림 = await 셸.evaluate(() => ({
    대화전폭: !document.body.classList.contains("stage-on") && document.body.classList.contains("chat-home"),
    탭산다: !!(window.gijoTabs && window.gijoTabs.list && window.gijoTabs.list().some((t) => String(t.page || t).includes("assets.html"))),
  }));
  ok("⊟ 화면 접기: 대화 전폭·화면 보존", 내림.대화전폭 && 내림.탭산다, JSON.stringify(내림));
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
  const 약자들 = 로스터.slice(0, 8).map((b) => (b.title || ""));
  // 대시보드 프레임(도킹)에서 팀 카드·지식창고 확인
  return {
    로스터수: 로스터.length,
    약자적용: 약자들.filter((t) => /^\[[가-힣]{2}\] /.test(t)).length, // 툴팁 [약자] 이름(표시는 아이콘 — 사장님 정정)
  };
});
ok("레일 로스터 12개(팀8+부품4)", 가시화.로스터수 === 12, "개수=" + 가시화.로스터수);
ok("로스터 약자(등록부 단일 출처) 반영", 가시화.약자적용 === 8, "약자 " + 가시화.약자적용 + "/8");

// ── ⑤″ 「진행중 작업」 배지가 **갈 곳이 있는가**(2026-09-02) ───────────────────────
// 상단바의 🕘(작업 내역)를 숨기면서, 그 배지를 보이는 자리가 **메뉴의 「작업 내역」 항목 하나**만
// 남았다(사장님 물음 「작업내역 메뉴 오른쪽에 표시하면 안될까?」 — 확인해 보니 이미 그렇게 돼 있었다).
// ⚠ 값이 아니라 **자리**를 잰다. 배지는 진행중이 0이면 스스로 숨으므로(0을 알릴 일은 없다)
//   「보이는가」로 재면 진행중 작업이 없는 날 관문이 거짓으로 죽는다. 그래서 **DOM에 붙어 있는가**만 본다.
// ⚠ 이 자리가 없으면 조용히 아무 데도 안 쓴다 — 오류도 안 난다. 2026-08-01 사고가 그 모양이었다.
const 배지자리 = await 셸.evaluate(() => {
  const 배지 = document.querySelector("#gijoNav .gn-sessbadge");
  // ⚠ 2026-09-03: 처음엔 closest("a,button,div[data-page],[data-page]")로 찾았다가 **게시가 막혔다.**
  //   메뉴 항목은 `div.gn-item`이고 **data-page 속성이 없다**(nav.js 전수 확인) — 선택자가 틀렸던 것이고
  //   제품은 정상이었다. 관문이 「확인 못 함」을 통과로 넘기지 않고 멈춰 준 것이 옳았다.
  const 행 = 배지 && 배지.closest(".gn-item");
  return {
    있나: !!배지,
    작업내역행: !!(행 && /작업 내역/.test(행.textContent || "")),
    갱신됨: !!(배지 && 배지.getAttribute("aria-label")), // refreshSessionBadge가 한 번은 돌았다는 증거
  };
});
ok("「진행중 작업」 배지 자리가 메뉴에 있다(🕘 숨김 뒤 유일한 자리)", 배지자리.있나, JSON.stringify(배지자리));
ok("그 배지가 「작업 내역」 항목에 붙어 있다", 배지자리.작업내역행, JSON.stringify(배지자리));
ok("배지 갱신이 실제로 한 번은 돌았다(aria-label 기록)", 배지자리.갱신됨, JSON.stringify(배지자리));
{
  await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("dashboard.html", "대시보드", { dock: true }));
  const df = await 프레임찾기("dashboard.html", 8);
  const r = df ? await df.evaluate(() => {
    const 카드 = document.getElementById("aiteamRow");
    const 칩 = 카드 ? 카드.querySelectorAll(".aiteam-chip").length : 0;
    // 「접기는 접은 채로, 검증 땐 펴서 잰다」 — 접혀 있으면 **실제로 펴서** KPI를 본다.
    // ⚠ 2026-08-31 정정: 여기는 접기 머리를 잡아 놓고 **누르지 않았다**(죽은 변수) —
    //   주석이 약속한 「펴서」가 코드에 없었다. 접힌 채로 재면 kbKpi가 비어 보여
    //   「렌더 실패」로 오판하거나, 반대로 접힌 채 통과해 아무것도 안 보게 된다.
    const head = document.querySelector(".gjf-h");
    if (head && !head.classList.contains("on")) head.click();
    const kb = document.getElementById("kbKpi");
    return { 칩, kb있음: !!kb, kb내용: kb ? (kb.textContent || "").length : 0 };
  }).catch(() => null) : null;
  ok("대시보드 팀 카드 8칩", !!r && r.칩 === 8, r ? "칩=" + r.칩 : "프레임 못 찾음");
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

// ── ⑨ 전 화면 얕은 렌더(2026-08-21 — 사장님 승인 묶음 3번) ─────────────────────
// ⚠ 왜: 위 검사들은 손으로 더한 목록이라 화면 43개 중 16개만 열어 봤다 — 나머지 27개는
//   **렌더가 죽어도 게시됐다**(5.56.0이 고친 analysis·settings도 관문이 이름조차 안 불렀다).
//   손 목록 자체가 구멍이므로, 목록을 **pages 디렉터리에서 자동 열거**한다 — 새 화면은
//   저절로 검사에 들어오고, 빼려면 아래 제외표에 이유를 적어야 한다(암묵 예외 금지).
// 검사는 얕게 — 프레임이 뜨고 본문에 실내용이 있는가(깊은 검사는 위 개별 검사 몫).
// ⚠ hub=1로 연다 — TAB_REDIRECT(허브 흡수 화면)를 우회하는 공식 탈출구(nav.js:250)라
//   원 파일명 프레임을 직접 확인할 수 있다.
{
  const 제외 = {
    "app.html": "셸 자신(지금 이 검사가 그 안에서 돈다)",
    "login.html": "입구 — 로그인 검사가 이미 앞에서 실제 로그인으로 확인",
    "setup.html": "첫 실행 전용 — 로그인된 세션에서는 안 뜬다",
    "console.html": "지휘소 부품 — app.html이 품어서 이미 돌고 있다",
    "office.html": "팀 사무실(별도 창) — 도킹으로 못 연다",
    // ("intro.html" — 2026-08-22 내 문서 📦 탭으로 흡수되며 **파일이 없어졌다.** 없는 파일을
    //  제외 표에 남겨 두면 아래 「제외 N개」가 부풀어, 관문이 사실과 다른 숫자를 보고한다.)
    "pick.html": "고르기 부품 — 단독 화면이 아니라 무대 부품(위 고르기 검사가 실측)",
    "merge.html": "LLM 합성(관리 전용·메뉴 밖)",
    "handover.html": "인수인계 — 메뉴 밖 별도 진입(딥링크)",
    "lawlookup.html": "법령 — 대화창 갈래가 주 진입로",
  };
  const dir = path.join(repo, "client", "src", "renderer", "pages");
  // ★ 제외 표가 **낡지 않게** 한다 (2026-08-22 검토관 [낮음]). 없어진 화면이 표에 남으면
  //   「제외 N개」가 부풀고, 다음 사람은 그 화면이 아직 있는 줄 안다. 조용히 틀리느니 실패한다.
  const 없는제외 = Object.keys(제외).filter((f) => !fs.existsSync(path.join(dir, f)));
  ok("제외 표가 실재하는 화면만 가리킨다", 없는제외.length === 0,
    없는제외.length ? "없는 화면이 제외 표에 남아 있다: " + 없는제외.join(", ") : Object.keys(제외).length + "개 전부 실재");
  const 후보 = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".html") && !f.startsWith("lite-") && !제외[f]);
  const 죽은화면 = [];
  for (const pg of 후보) {
    await 셸.evaluate((p) => window.gijoTabs && window.gijoTabs.open(p + "?hub=1", "관문-" + p, { dock: true }), pg).catch(() => {});
    const fr = await 프레임찾기(pg, 6);
    const 산다 = fr ? await fr.evaluate(async () => {
      for (let i = 0; i < 8; i++) {
        if ((document.body.innerText || "").trim().length > 30) return true;
        await new Promise((x) => setTimeout(x, 500));
      }
      return (document.body.innerText || "").trim().length > 30;
    }).catch(() => false) : false;
    if (!산다) 죽은화면.push(pg + (fr ? "(빈 본문)" : "(프레임 없음)"));
  }
  ok("전 화면 얕은 렌더(" + 후보.length + "개 자동 열거 · 제외 " + Object.keys(제외).length + "개는 사유 명시)",
    죽은화면.length === 0, 죽은화면.length ? "죽음: " + 죽은화면.join(", ") : "전부 그려짐");
}

await browser.close().catch(() => {});
정리();
console.log(실패.length ? "[ui관문] ✕ 실패 " + 실패.length + "건: " + 실패.join(", ") : "[ui관문] ✓ 전부 통과");
process.exit(실패.length ? 1 : 0);
