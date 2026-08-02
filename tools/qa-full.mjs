#!/usr/bin/env node
// QA 전수조사 — 변경사항을 확인하고 영향 계층만 골라 도는 오케스트레이터 (2026-07-25).
//
// 동작: ① 마지막 실행 마커(.tmp-reports/qa-last-run.json)의 커밋 이후 변경 파일을 git으로 수집
//      ② 변경 영역 → QA 계층 매핑으로 돌릴 것을 선택(변경 없어도 스모크=서버 계층은 항상)
//      ③ 계층별 실행 → 결과 요약 + 마커 갱신 + .tmp-reports/qa-full-report.md
//
// 사용: QA_USER=... QA_PASS=... node tools/qa-full.mjs [--all] [--fast]
//   --all  변경과 무관하게 전 계층 실행
//   --fast 서버 단위테스트(vitest, ~90초)와 LLM 시나리오 계층 생략(빠른 확인용)
//
// 계층 목록(무엇을 검증하나):
//   server      운영 HTTP 13 시나리오 (qa-auto --layer=server) — 항상 실행(스모크)
//   vitest      서버 단위테스트 전체 (server/ npm test)
//   client      실페이지 렌더 5 시나리오 (qa-auto --layer=client)
//   knowledge   RAG 검색 6 시나리오 (qa-auto --layer=knowledge)
//   maintenance 유지보수 실 LLM 6 시나리오 (qa-auto --layer=maintenance)
//   regress     답변 회귀 하네스 11케이스 (tools/regress/run.mjs)
//   verify      조치 검증·VEX·자산 기본 담당자 (tools/qa-verify.mjs — 운영 서버 자신을 점검 대상으로)
//   shell       대시보드 팝업 셸 (tools/qa-shell.mjs — CDP 9223 필요)
//   download    파일 받기가 실제로 저장되는가 (tools/qa-download.mjs — ⚠ Playwright 금지·순수 CDP)
//   sweep       Electron 전 화면 스윕 (menu-sweep — CDP 9223 필요, 없으면 안내 후 스킵)
//   drawer      대화창 서랍이 약속한 질문이 실제로 되는가 (tools/drawer-audit.mjs)

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".tmp-reports");
fs.mkdirSync(OUT, { recursive: true });
const MARKER = path.join(OUT, "qa-last-run.json");
const ALL = process.argv.includes("--all");
const FAST = process.argv.includes("--fast");

const USER = process.env.QA_USER || process.env.GIJO_ADMIN_USER;
const PASS = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
if (!USER || !PASS) { console.error("QA_USER/QA_PASS (또는 GIJO_ADMIN_*) 환경변수가 필요합니다"); process.exit(2); }
const env = { ...process.env, QA_USER: USER, QA_PASS: PASS, GIJO_ADMIN_USER: USER, GIJO_ADMIN_PASSWORD: PASS };

// ── ① 변경사항 수집 — 마커 커밋..HEAD + 미커밋(working tree) ─────────────────────
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8" }).trim();
const head = git("rev-parse HEAD");
let since = null;
try { since = JSON.parse(fs.readFileSync(MARKER, "utf8")).commit; git(`cat-file -t ${since}`); } catch { since = null; }
let changed = [];
if (since && since !== head) changed = git(`diff --name-only ${since}..HEAD`).split("\n").filter(Boolean);
changed = [...new Set([...changed, ...git("status --porcelain").split("\n").filter(Boolean).map((l) => l.slice(3).trim())])];

// ── ② 변경 영역 → 계층 매핑 ─────────────────────────────────────────────────────
// 답변 품질에 닿는 엔진(LLM·RAG·라우팅·그래프)이 바뀌면 지식·시나리오·회귀까지 돈다.
const QUALITY_RE = /^server\/src\/engine\/(llm|memory|hybridsearch|dispatcher|agentloop|intent|orchestrator-|ontology|docgraph|gateway|screenguide|agenttools|webreport|vulnscan)/;
const picks = new Set(["server"]); // 스모크는 항상
const reasons = [];
// 조치 검증 계열은 "판정을 어디에 쓰는가"가 위험 지점이라 실 상태전이까지 보는 계층을 따로 둔다.
const VERIFY_RE = /^server\/src\/engine\/(verify|vexexport|autoassign|versioncmp|netmikorunner|approvals|hardening)/;
// 탭 셸(4.0.0)의 구성 파일 — shell-popup·hub는 삭제됐고 app(셸)·console(대화)·dialog(확인창)가
// 그 자리다. 옛 이름을 그대로 두면 셸을 고친 커밋이 정작 셸 검사(qa-shell 25검사)를 건너뛴다
// (2026-07-29 검토 #2 — 69867ca·9fc74da에서 실제로 그랬다).
// ⚠ 이름 뒤에 점(.)을 요구한다 — 안 그러면 app이 approvals.html까지 잡는다(2026-07-29 실측).
const SHELL_RE = /^client\/src\/renderer\/pages\/(app|console|dialog|dashboard|nav)\./;
// 파일 받기는 메인 프로세스(will-download)·preload·받기 버튼이 걸린 화면이 바뀌면 다시 본다.
// 서랍 목록(console.js)과 서랍이 기대는 결정적 경로(howto·picklist)가 바뀌면 다시 묻는다.
const ROUTING_RE = /^server/src/engine/(agentloop|dispatcher|routes).ts$|^tools/route-explain.mjs$/;
const DRAWER_RE = /^client\/src\/renderer\/pages\/console\.js$|^server\/src\/engine\/(howto|picklist|screenguide|workguide)\.ts$|^tools\/drawer-audit\.mjs$/;
const DOWNLOAD_RE = /^client\/src\/(main|preload)\.ts$|^client\/src\/renderer\/pages\/(approvals|report)\.html$/;
for (const f of changed) {
  if (VERIFY_RE.test(f)) { picks.add("verify"); picks.add("vitest"); reasons.push(`${f} → 조치검증·VEX 계층`); }
  if (SHELL_RE.test(f)) { picks.add("shell"); reasons.push(`${f} → 탭 셸 계층`); }
  if (DOWNLOAD_RE.test(f)) { picks.add("download"); reasons.push(`${f} → 파일 받기 계층`); }
  if (QUALITY_RE.test(f)) { picks.add("knowledge"); picks.add("maintenance"); picks.add("regress"); picks.add("vitest"); reasons.push(`${f} → 지식·시나리오·회귀`); }
  else if (f.startsWith("server/")) { picks.add("vitest"); reasons.push(`${f} → 서버 단위테스트`); }
  else if (f.startsWith("client/src/")) { picks.add("client"); picks.add("sweep"); reasons.push(`${f} → 클라 실페이지·스윕`); }
  if (DRAWER_RE.test(f)) { picks.add("drawer"); reasons.push(`${f} → 서랍 약속 점검`); }
  if (ROUTING_RE.test(f)) { picks.add("routing"); picks.add("vitest"); reasons.push(`${f} → 라우팅 겹침·규칙표`); }
  else if (f.startsWith("tools/regress/") || f.startsWith("rag-seed/")) { picks.add("regress"); reasons.push(`${f} → 회귀 하네스`); }
}
if (ALL) for (const l of ["vitest", "client", "knowledge", "maintenance", "regress", "verify", "shell", "download", "sweep", "drawer", "routing"]) picks.add(l);
if (FAST) { picks.delete("vitest"); picks.delete("maintenance"); }

console.log(`■ QA 전수조사 — 기준: ${since ? since.slice(0, 8) + "..HEAD" : "(첫 실행 — 마커 없음, 전 계층)"}`);
if (!since) for (const l of ["vitest", "client", "knowledge", "maintenance", "regress", "verify", "shell", "download", "sweep", "drawer", "routing"]) { if (!FAST || (l !== "vitest" && l !== "maintenance")) picks.add(l); }
console.log(`  변경 파일 ${changed.length}개 → 계층 [${[...picks].join(", ")}]${ALL ? " (--all)" : ""}${FAST ? " (--fast)" : ""}`);
for (const r of reasons.slice(0, 8)) console.log(`   · ${r}`);
if (reasons.length > 8) console.log(`   · … 외 ${reasons.length - 8}건`);

// ── ③ 계층 실행 ─────────────────────────────────────────────────────────────────
const results = [];
function run(name, cmd, args, opts = {}) {
  if (!picks.has(name)) return;
  const t = Date.now();
  console.log(`\n── [${name}] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env, stdio: "inherit", shell: process.platform === "win32" });
  results.push({ name, ok: r.status === 0, ms: Date.now() - t });
}

// Electron이 필요한 계층(스윕·팝업 셸)은 CDP가 살아 있을 때만 — 없으면 스킵 사유를 남긴다
// (자동 기동은 하지 않는다: 쓰고 있는 세션을 방해하지 않기 위해).
if (picks.has("sweep") || picks.has("shell") || picks.has("download")) {
  const cdpUp = await fetch("http://127.0.0.1:9223/json/version").then((r) => r.ok).catch(() => false);
  if (!cdpUp) {
    console.log("\n── [sweep/shell/download] 스킵 — Electron(CDP 9223) 미기동. /GIJOAS클라시작 후 로그인하고 다시 돌리면 포함됩니다.");
    for (const l of ["sweep", "shell", "download"]) {
      if (picks.has(l)) { picks.delete(l); results.push({ name: l, ok: null, ms: 0, note: "스킵(Electron 미기동)" }); }
    }
  }
}

run("server", "node", ["tools/qa-auto.mjs", "--layer=server"]);
run("vitest", "npm", ["test"], { cwd: path.join(ROOT, "server") });
run("client", "node", ["tools/qa-auto.mjs", "--layer=client"]);
run("knowledge", "node", ["tools/qa-auto.mjs", "--layer=knowledge"]);
run("maintenance", "node", ["tools/qa-auto.mjs", "--layer=maintenance"]);
run("regress", "node", ["tools/regress/run.mjs"]);
run("verify", "node", ["tools/qa-verify.mjs"]);
run("shell", "node", ["tools/qa-shell.mjs"]);
run("download", "node", ["tools/qa-download.mjs"]);
run("sweep", "node", ["tools/menu-sweep.mjs"]);
// 서랍은 "이건 된다"고 약속하는 자리다 — 한 번 확인하고 두면 데이터가 바뀌며 늙는다.
run("drawer", "node", ["tools/drawer-audit.mjs"]);
// 라우팅 겹침 — 규칙을 넓힐 때마다 사람이 기억해서 돌리는 방식은 반드시 샌다.
//   실측(2026-08-02): 넓은 규칙을 앞에 넣어 today를 가로챘고 라우팅이 100%→96.9%로 떨어졌는데,
//   평가 게이트(20분)를 돌리고서야 알았다. 여기서는 1초에 알린다.
run("routing", "node", ["tools/route-explain.mjs", "--겹침"]);

// ── ④ 요약·마커·리포트 ──────────────────────────────────────────────────────────
// 알려진 이슈 — 원인이 규명됐고 사용자가 "지금은 이대로 둔다"고 결정한 것만(tools/qa-known-issues.json).
// ⚠ 감추지 않는다: 매 실행 ⚠로 계속 출력하고 리포트에도 남긴다. 구분하는 이유는 하나 —
//   **새로 생긴 실패**가 이미 아는 실패에 묻히지 않게 하기 위해서다.
let known = [];
try {
  known = (JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "qa-known-issues.json"), "utf8")).issues ?? []);
} catch { /* 파일이 없으면 알려진 이슈 없음 */ }
const knownIds = new Set(known.map((k) => k.id));

// 계층 실패가 "알려진 이슈 그것 하나뿐"인지 판정한다 — qa-auto가 실패 id를 stdout에 남기므로
// 여기서는 계층 이름만으로 판정할 수 없다. 계층별 결과 JSON에서 실패 케이스 id를 읽어 대조한다.
function failedCaseIds(layer) {
  const f = {
    server: "qa-auto-server.json", client: "qa-auto-client.json",
    knowledge: "qa-auto-knowledge.json", maintenance: "qa-auto-maintenance.json",
    // regress도 2026-07-28부터 케이스별 판정을 남긴다 — 그전에는 어떤 regress 실패도
    // 알려진 이슈로 구분될 수 없어 늘 새 실패처럼 보였다.
    regress: "qa-auto-regress.json",
  }[layer];
  if (!f) return null; // 케이스 단위 결과가 없는 계층(vitest 등)은 대조 불가
  try {
    return (JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")).results ?? [])
      .filter((r) => r.pass === false).map((r) => r.id);
  } catch { return null; }
}

const rawFails = results.filter((r) => r.ok === false);
const fails = [];
const knownOnly = [];
for (const r of rawFails) {
  const ids = failedCaseIds(r.name);
  if (ids && ids.length && ids.every((id) => knownIds.has(id))) knownOnly.push({ ...r, ids });
  else fails.push(r);
}

console.log("\n■ 전수조사 결과");
for (const r of results) {
  const k = knownOnly.find((x) => x.name === r.name);
  const mark = r.ok === null ? "―" : r.ok ? "✓" : k ? "⚠" : "✗";
  const tail = k ? ` — 알려진 이슈만(${k.ids.join(", ")})` : r.note ? " — " + r.note : "";
  console.log(`  ${mark} ${r.name} (${(r.ms / 1000).toFixed(0)}s)${tail}`);
}
if (knownOnly.length) {
  console.log("\n⚠ 알려진 이슈(원인 규명·수용됨) — 해결되면 tools/qa-known-issues.json에서 지웁니다");
  for (const k of knownOnly) {
    for (const id of k.ids) {
      const info = known.find((x) => x.id === id);
      console.log(`   · ${id}: ${info?.무엇이 ?? ""}`);
      if (info?.결정) console.log(`     결정: ${info.결정}`);
    }
  }
}
console.log(fails.length ? `\n✗ 실패 ${fails.length}계층 — 마커를 갱신하지 않습니다(다음 실행이 같은 변경을 다시 봄)` : "\n✓ 전 계층 통과" + (knownOnly.length ? " (알려진 이슈 제외)" : ""));

if (!fails.length) fs.writeFileSync(MARKER, JSON.stringify({ commit: head, at: new Date().toISOString(), layers: [...picks], knownIssues: [...knownIds] }, null, 2));
fs.writeFileSync(path.join(OUT, "qa-full-report.md"), [
  `# QA 전수조사 (${new Date().toISOString().slice(0, 16)})`,
  `- 기준: ${since ? since.slice(0, 8) : "(첫 실행)"} → ${head.slice(0, 8)} · 변경 ${changed.length}파일`,
  `- 계층: ${results.map((r) => {
    const k = knownOnly.find((x) => x.name === r.name);
    return `${r.name}=${r.ok === null ? "스킵" : r.ok ? "통과" : k ? "알려진이슈" : "실패"}`;
  }).join(" · ")}`,
  ...(knownOnly.length
    ? ["", "## ⚠ 알려진 이슈(원인 규명·수용됨)",
       ...knownOnly.flatMap((k) => k.ids.map((id) => {
         const i = known.find((x) => x.id === id);
         return `- **${id}** — ${i?.무엇이 ?? ""}\n  - 원인: ${i?.원인 ?? "-"}\n  - 결정: ${i?.결정 ?? "-"}`;
       }))]
    : []),
  "", "## 변경 파일", ...changed.map((f) => `- ${f}`),
].join("\n"));
console.log(`리포트: .tmp-reports/qa-full-report.md`);
process.exit(fails.length ? 1 : 0);
