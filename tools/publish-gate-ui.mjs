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
const USER = process.env.GIJO_ADMIN_USER || "claude-deploy";
const PASS = process.env.GIJO_ADMIN_PASSWORD || "";
const SERVER = process.env.GIJO_SERVER_URL || "http://localhost:4000";

const 실패 = [];
function ok(name, cond, extra) {
  console.log("[ui관문] " + (cond ? "✓ " : "✕ ") + name + (extra ? " — " + extra : ""));
  if (!cond) 실패.push(name);
}

// ── 선행 점검(fail-closed) ────────────────────────────────────────────────
if (!PASS) { console.error("[ui관문] GIJO_ADMIN_PASSWORD가 없습니다 — 게시 중단"); process.exit(3); }
if (!fs.existsSync(EXE)) { console.error("[ui관문] win-unpacked가 없습니다(먼저 npm run dist): " + EXE); process.exit(3); }
try {
  const out = execFileSync("powershell", ["-NoProfile", "-Command",
    "Get-Process 'GIJO AS','electron' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path"],
    { encoding: "utf8" }).trim();
  if (out) {
    console.error("[ui관문] GIJO AS/electron 프로세스가 이미 떠 있습니다 — 게시 중단(exit 3).");
    console.error("  떠 있는 것: " + out.split(/\r?\n/).join(" · "));
    console.error("  사람이 쓰는 앱은 이 관문이 절대 닫지 않습니다. 앱을 닫고 다시 게시하세요.");
    process.exit(3);
  }
} catch { /* Get-Process가 아무것도 못 찾으면 non-zero — 떠 있는 것 없음 */ }
try {
  const r = await fetch("http://localhost:" + PORT + "/json/version", { signal: AbortSignal.timeout(1500) });
  if (r.ok) { console.error("[ui관문] 포트 " + PORT + "에 이미 CDP가 떠 있습니다 — 게시 중단(exit 3)."); process.exit(3); }
} catch { /* 닫혀 있음 — 정상 */ }

// ── 앱 기동(전용 포트) ────────────────────────────────────────────────────
const app = spawn(EXE, ["--remote-debugging-port=" + PORT], { stdio: "ignore" });
const 정리 = () => { try { execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* 이미 종료 */ } };
process.on("exit", 정리);
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
  if (dup) await page.click("#dupForce"); // 관문 전용 계정(claude-deploy)의 QA 세션만 끊긴다
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
ok("일반형: 담당 미배정 없음", !일반.txt.includes("담당 미배정"), 일반.txt.slice(0, 50));
ok("일반형: 칩 1개(쉽게 설명)", 일반.chips.length === 1 && /쉽게 설명/.test(일반.chips[0] || ""), JSON.stringify(일반.chips));
const 취약 = await 선택카드검사("관문-취약점형", { title: "SQLi 표본", severity: "높음", findingKey: "abcdef0123456789" });
ok("취약점형: 담당 미배정 표시", 취약.txt.includes("담당 미배정"));
ok("취약점형: 배정 칩", 취약.chips.some((c) => /담당자 배정/.test(c)));
await 셸.evaluate(() => window.postMessage({ type: "gijo:select" }, "*")); // 해제

// ── ② 감사(작업 기록) 행 배선 + 허브 릴레이 ─────────────────────────────
await 셸.evaluate(() => window.gijoTabs && window.gijoTabs.open("records.html", "기록"));
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
  // 허브 릴레이 — 무대→허브→셸 두 겹을 실제로 올라가는가(2026-08-20 grouphub 릴레이+가드)
  await auditFrame.evaluate(() => window.parent.postMessage({ type: "gijo:openTab", page: "kpi.html", label: "지표" }, "*"));
  const kpiFrame = await 프레임찾기("kpi.html", 8);
  ok("허브 릴레이(무대→셸)", !!kpiFrame);
}

// ── ③ 부품 로드(배선 계약 — 「호출만 있고 로드 없음」 재발 방지 실측) ──────
for (const [pg, lbl] of [["inventory.html", "자산"], ["hardening.html", "검증"], ["maintenance.html", "점검"], ["report.html", "보고"], ["learnloop.html", "학습"]]) {
  await 셸.evaluate(({ pg, lbl }) => window.gijoTabs && window.gijoTabs.open(pg, lbl), { pg, lbl });
  const fr = await 프레임찾기(pg, 8);
  const has = fr ? await fr.evaluate(() => typeof window.gijoSelectNotify === "function").catch(() => false) : false;
  ok("부품 로드: " + pg, has, fr ? "" : "프레임 못 찾음");
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

await browser.close().catch(() => {});
정리();
console.log(실패.length ? "[ui관문] ✕ 실패 " + 실패.length + "건: " + 실패.join(", ") : "[ui관문] ✓ 전부 통과");
process.exit(실패.length ? 1 : 0);
