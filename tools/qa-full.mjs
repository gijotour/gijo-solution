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
//   promise     화면이 적어 둔 「누르면 …됩니다」 약속이 실제 버튼 이름과 맞는가 (promise-check)
//   viz         그림 띠를 눌렀을 때 좁혀진 목록이 **그 화면에 보이는가** (viz-gap-measure — CDP 9223)
//   drawer      대화창 서랍이 약속한 질문이 실제로 되는가 (tools/drawer-audit.mjs)
//   docs        리포지토리 ↔ 운영 문서 폴더 ↔ 지식 저장소가 갈렸나 (tools/docs-drift.mjs — win 호스트 전용)

import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { 계층결과, 기호, 변경목록 } from "./qa-layer-result.mjs";

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
// ⚠ porcelain은 **원문 그대로** 넘긴다 — git()의 .trim()이 첫 줄 앞 공백을 깎아 경로의 첫 글자를
//   먹던 자리다(2026-09-05 실측: 첫 항목이 ools/local-digest.mjs 로 나왔다). 그러면 그 파일의
//   계층 매핑이 통째로 빗나가 **돌아야 할 계층이 조용히 안 돈다.** 읽는 규칙은 qa-layer-result 한 곳.
changed = [...new Set([...changed, ...변경목록(execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }))])];

// ── ② 변경 영역 → 계층 매핑 ─────────────────────────────────────────────────────
// 답변 품질에 닿는 엔진(LLM·RAG·라우팅·그래프)이 바뀌면 지식·시나리오·회귀까지 돈다.
const QUALITY_RE = /^server\/src\/engine\/(llm|memory|hybridsearch|dispatcher|agentloop|intent|orchestrator-|ontology|docgraph|gateway|screenguide|agenttools|webreport|vulnscan)/;

// ★★ 계층 이름표는 **여기 한 곳에만** 적는다 (2026-09-06 적발·수리).
//   무슨 일이 있었나: --all과 「첫 실행」이 **같은 배열을 각자** 들고 있었다. 그래서 2026-08-08에
//   새로 만든 docs 계층이 ⓐ 매핑 규칙에도 ⓑ --all 배열에도 ⓒ 첫 실행 배열에도 안 담겼고,
//   run("docs", …)는 파일에 멀쩡히 있는데 picks에 "docs"가 들어갈 길이 없어
//   **신설 이래 한 번도 안 돌았다.** 2026-09-05에 붙인 「판정 못 함(exit 2) 회색」 처리까지
//   통째로 죽은 코드였다 — 이 파일이 스스로 여러 번 경고하던 「만들어 놓고 조용히 안 도는 검사」다.
//   (더 아픈 대목: 그 09-05 변경 목록에 tools/docs-drift.mjs가 들어 있었는데도 안 돌았다.)
//   ⚠ 새 계층을 만들 때: ⓐ 여기에 이름을 넣고 ⓑ run(같은 이름, …)을 부르고 ⓒ 매핑 규칙을 준다.
//     ⓐ와 ⓑ가 어긋나면 server/test/qafulllayers.test.ts(짝 시험)가 잡는다.
const 전계층 = ["vitest", "client", "knowledge", "maintenance", "regress", "verify", "shell",
  "download", "sweep", "windows", "viz", "drawer", "routing", "promise", "docprobe", "docs"];

// 문서 표류 — 문서를 고쳐도 운영 AI가 **옛 판으로 답하던** 자리(2026-08-08 실사고).
//   ⚠ 대상 문서 목록의 **정본은 server/docs-manifest.json**이다. 여기에 「루트의 md 전부」 같은
//     규칙을 따로 적으면 대장에 없는 루트 md 100여 개까지 걸려 **매번** 돈다 — 늘 도는 계층은
//     아무도 결과를 안 보게 되어 없는 것과 같아진다. 그래서 대장을 그대로 읽는다.
let 문서대장 = new Set();
try {
  문서대장 = new Set(
    (JSON.parse(fs.readFileSync(path.join(ROOT, "server", "docs-manifest.json"), "utf8")).files ?? [])
      .map((f) => f.file)
  );
} catch { /* 대장을 못 읽으면 아래 규칙만으로 판정한다(없는 것보다 낫다) */ }
// ⚠ 정규식을 문자열로 짓는다 — 이 파일은 짝 시험이 소스를 읽어 대조하므로 형태를 단순하게 둔다.
const DOCS_RE = new RegExp("^knowledge/|^server/docs-manifest[.]json$|^tools/docs-drift[.]mjs$");
const 문서변경 = (f) => DOCS_RE.test(f) || 문서대장.has(f);

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
const ROUTING_RE = /^server\/src\/engine\/(agentloop|dispatcher|routes)\.ts$|^tools\/route-explain\.mjs$/;
const DRAWER_RE = /^client\/src\/renderer\/pages\/console\.js$|^server\/src\/engine\/(howto|picklist|screenguide|workguide)\.ts$|^tools\/drawer-audit\.mjs$/;
const DOWNLOAD_RE = /^client\/src\/(main|preload)\.ts$|^client\/src\/renderer\/pages\/(approvals|report)\.html$/;
for (const f of changed) {
  if (VERIFY_RE.test(f)) { picks.add("verify"); picks.add("vitest"); reasons.push(`${f} → 조치검증·VEX 계층`); }
  if (SHELL_RE.test(f)) { picks.add("shell"); reasons.push(`${f} → 탭 셸 계층`); }
  if (DOWNLOAD_RE.test(f)) { picks.add("download"); reasons.push(`${f} → 파일 받기 계층`); }
  if (QUALITY_RE.test(f)) { picks.add("knowledge"); picks.add("maintenance"); picks.add("regress"); picks.add("vitest"); picks.add("docprobe"); reasons.push(`${f} → 지식·시나리오·회귀`); }
  else if (f.startsWith("server/")) { picks.add("vitest"); reasons.push(`${f} → 서버 단위테스트`); }
  else if (f.startsWith("client/src/")) { picks.add("client"); picks.add("sweep"); picks.add("windows"); picks.add("viz"); picks.add("promise"); reasons.push(`${f} → 클라 실페이지·스윕·띠 자리·적어 둔 약속`); }
  if (DRAWER_RE.test(f)) { picks.add("drawer"); reasons.push(`${f} → 서랍 약속 점검`); }
  if (문서변경(f)) { picks.add("docs"); reasons.push(`${f} → 문서 표류(리포↔운영↔지식)`); }
  if (ROUTING_RE.test(f)) { picks.add("routing"); picks.add("vitest"); reasons.push(`${f} → 라우팅 겹침·규칙표`); }
  else if (f.startsWith("tools/regress/") || f.startsWith("rag-seed/")) { picks.add("regress"); reasons.push(`${f} → 회귀 하네스`); }
}
if (ALL) for (const l of 전계층) picks.add(l);
if (FAST) { picks.delete("vitest"); picks.delete("maintenance"); }
// ★ keyleak은 **변경 파일과 무관하게 늘 담는다.** 개인키는 코드를 안 고쳐도 새기 때문이다
//   (2026-08-09: 하루에 두 번, 둘 다 파일을 옮기다 났고 커밋은 없었다).
//   run()이 picks를 보므로 여기 안 담으면 위에서 run을 불러도 조용히 안 돈다 —
//   오늘 종일 잡은 「만들어 놓고 안 도는 검사」가 될 뻔했다. --fast에서도 뺀다.
picks.add("keyleak");

// ★ 2026-08-10: vitest를 돌린다면 **Windows 전용 2개도 같이** 돈다(WSL 사본이 못 도는 것들).
//   ⚠ picks에 안 담으면 run()이 **조용히 건너뛴다** — 바로 위 주석이 경고하는 그 함정이다.
if (picks.has("vitest") && process.platform === "win32") picks.add("vitest-win");

console.log(`■ QA 전수조사 — 기준: ${since ? since.slice(0, 8) + "..HEAD" : "(첫 실행 — 마커 없음, 전 계층)"}`);
if (!since) for (const l of 전계층) { if (!FAST || (l !== "vitest" && l !== "maintenance")) picks.add(l); }
console.log(`  변경 파일 ${changed.length}개 → 계층 [${[...picks].join(", ")}]${ALL ? " (--all)" : ""}${FAST ? " (--fast)" : ""}`);
for (const r of reasons.slice(0, 8)) console.log(`   · ${r}`);
if (reasons.length > 8) console.log(`   · … 외 ${reasons.length - 8}건`);

// ── ③ 계층 실행 ─────────────────────────────────────────────────────────────────
const results = [];
function run(name, cmd, args, opts = {}) {
  if (!picks.has(name)) return;
  const t = Date.now();
  console.log(`\n── [${name}] ${cmd} ${args.join(" ")}`);
  // ⚠ opts.noShell — 인자에 **공백이 든 경로**가 있으면 셸이 쪼갠다(2026-08-10 실측:
  //   `bash "/mnt/d/Connect AI/tools/wsl-test.sh"`가 0초 만에 실패했다). 그럴 땐 셸을 끄고
  //   인자를 그대로 넘긴다.
  const useShell = opts.noShell ? false : process.platform === "win32";
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env, stdio: "inherit", shell: useShell });
  const ms = Date.now() - t;
  // ⚠⚠ **「판정 못 함」은 「어긋남」이 아니다**(2026-09-05).
  //   tools/docs-drift.mjs는 fc396fdb부터 종료 코드에 뜻을 나눠 준다 — 0=같음 · 1=어긋남 · **2=판정 못 함**.
  //   그런데 이 함수는 status===0 하나로만 봐서 **2를 1과 똑같이 ✗ 실패로** 세었다. 그러면
  //   「도구를 돌릴 환경이 아니었다」가 「문서가 어긋났다」로 보고되고, 마커까지 안 갱신돼 다음 실행이
  //   같은 변경을 다시 돈다. **재지 못한 것을 빨강으로 칠하는 것도 거짓말이다** — 이 저장소는 반대
  //   방향(거짓 초록)으로 이미 데었고 뿌리가 같다. 그래서 세 번째 자리를 만든다:
  //   초록도 빨강도 아닌 **회색(?) + 원인 문구**.
  //   ⚠ 약속한 계층에만 적용한다 — opts.판정못함코드를 안 준 계층은 종전 그대로 0/그 외다.
  //     (아무 계층에나 「2는 봐준다」를 걸면 이번엔 진짜 실패가 회색에 숨는다.)
  //   판정 규칙 자체는 tools/qa-layer-result.mjs **한 곳**에 있다 — 가짜 종료 코드로 재 볼 수 있게
  //   꺼내 두었다(server/test/qalayerresult.test.ts). 여기서 다시 적으면 두 곳이 어긋난다.
  results.push(계층결과(name, r.status, ms, opts));
}

// Electron이 필요한 계층(스윕·팝업 셸)은 CDP가 살아 있을 때만 — 없으면 스킵 사유를 남긴다
// (자동 기동은 하지 않는다: 쓰고 있는 세션을 방해하지 않기 위해).
if (picks.has("sweep") || picks.has("shell") || picks.has("download") || picks.has("viz") || picks.has("windows")) {
  const cdpUp = await fetch("http://127.0.0.1:9223/json/version").then((r) => r.ok).catch(() => false);
  if (!cdpUp) {
    console.log("\n── [sweep/shell/download] 스킵 — Electron(CDP 9223) 미기동. /GIJOAS클라시작 후 로그인하고 다시 돌리면 포함됩니다.");
    for (const l of ["sweep", "shell", "download", "viz", "windows"]) {
      if (picks.has(l)) { picks.delete(l); results.push({ name: l, ok: null, ms: 0, note: "스킵(Electron 미기동)" }); }
    }
  }
}

// ⚠ 순서가 중요하다 — **화면 계층(CDP)을 먼저** 돌린다(2026-08-05 실측).
//   아래 API 계층들(regress·drawer 등)은 QA 계정으로 force 로그인하는데, 이 제품은
//   계정당 세션이 하나다. 그래서 regress가 먼저 돌면 **띄워 둔 Electron이 로그인 화면으로
//   튕겨** sweep·download·shell이 "셸에 못 들어감"으로 실패한다 — 제품 잘못이 아니라
//   점검 도구가 스스로를 깨뜨린 것이다. 화면 계층을 앞에 두면 이 자충수가 사라진다.
run("shell", "node", ["tools/qa-shell.mjs"]);
run("download", "node", ["tools/qa-download.mjs"]);
run("sweep", "node", ["tools/menu-sweep.mjs"]);
// 별도 창(문서함·팀 사무실·대화 분리창) — 본창 탭 스윕의 사각지대였다(2026-08-07 실사고:
// 문서함이 gijomd.js를 안 실어 모든 문서 열기가 TypeError였는데 스윕이 못 잡음).
run("windows", "node", ["tools/window-sweep.mjs"]);
// 띠 자리 — "누르면 목록이 좁혀집니다"라 적어 두고 결과가 화면 밖에 있으면 안내가 거짓이 된다.
//   실측(2026-08-06): 작업 내역 880px·위협 인텔 5,791px 밖이었고, 눈으로는 둘 다 멀쩡해 보였다.
run("viz", "node", ["tools/viz-gap-measure.mjs"]);

// 개인키가 새기 쉬운 자리에 있는지 — **항상 돈다**(변경 파일과 무관).
// 2026-08-09 하루에 두 번 발행키가 대화창으로 샜다. 규칙에 적어 뒀는데도 두 번 다
// 안 지켜졌다 — 사람의 주의력에 기대는 대신 매 전수조사가 파일 위치를 본다.
// ⚠ 만들고 안 돌리면 오늘 종일 잡은 「조용히 안 도는 검사」가 된다. 그래서 여기 박는다.
run("keyleak", "node", ["tools/keyleak-check.mjs", "--quiet"]);
run("server", "node", ["tools/qa-auto.mjs", "--layer=server"]);
// ★ 2026-08-10: 서버 시험은 **WSL에서** 돌린다.
//   ⚠ 왜: 제품이 WSL에서 돈다. Windows 호스트에서 재면 **딴 환경을 검증**하는 것이고
//     (그 python3은 0바이트 껍데기다), 무엇보다 **너무 느려 끝나지 않는다** —
//     실측 Windows 파일당 수 분 vs WSL 전체 2,995개 27초. 이 계층이 오늘 실패한 이유다.
//   ⚠ 이 규칙은 CLAUDE.md 「환경별 역할」에 못 박혀 있었는데 **이 도구엔 반영이 안 돼 있었다** —
//     같은 것을 여러 곳에 적으면 어긋난다는 그 함정을 이 파일이 그대로 밟고 있었다.
//   ⚠ WSL 사본에서 구조적으로 못 도는 2개(git·이미지 필요)는 wsl-test.sh가 빼므로
//     **Windows에서 따로** 돌린다 — 각 0.5초라 부담이 없다. 두 쪽을 다 돌려야 「전부 통과」다.
if (process.platform === "win32") {
  run("vitest", "wsl", ["-d", "Ubuntu-24.04", "--", "bash", "/mnt/d/Connect AI/tools/wsl-test.sh"], { noShell: true });
  run("vitest-win", "npx", ["vitest", "run", "test/no-hardcoded-credentials.test.ts", "test/shotlist.test.ts"], {
    cwd: path.join(ROOT, "server"),
  });
} else {
  run("vitest", "npm", ["test"], { cwd: path.join(ROOT, "server") });
}
run("client", "node", ["tools/qa-auto.mjs", "--layer=client"]);
run("knowledge", "node", ["tools/qa-auto.mjs", "--layer=knowledge"]);
run("maintenance", "node", ["tools/qa-auto.mjs", "--layer=maintenance"]);
run("regress", "node", ["tools/regress/run.mjs"]);
run("verify", "node", ["tools/qa-verify.mjs"]);
// 서랍은 "이건 된다"고 약속하는 자리다 — 한 번 확인하고 두면 데이터가 바뀌며 늙는다.
run("drawer", "node", ["tools/drawer-audit.mjs"]);
// 화면이 적어 둔 「누르면 …됩니다」 약속 — 특히 **버튼 이름을 콕 집은 안내**가 실제 이름과
//   맞는지. 실측(2026-08-06): 레드팀 화면이 「실효 점검 실행」을 누르라는데 버튼은 「▶ 지금 점검」
//   이었다. 빈 화면 안내는 처음 온 사람만 보는 글이라 평소 눈에 안 띈다.
run("promise", "node", ["tools/promise-check.mjs"]);
// 라우팅 겹침 — 규칙을 넓힐 때마다 사람이 기억해서 돌리는 방식은 반드시 샌다.
//   실측(2026-08-02): 넓은 규칙을 앞에 넣어 today를 가로챘고 라우팅이 100%→96.9%로 떨어졌는데,
//   평가 게이트(20분)를 돌리고서야 알았다. 여기서는 1초에 알린다.
run("routing", "node", ["tools/route-explain.mjs", "--겹침"]);
// 지식 문서가 **실제 질문에 걸리는지** — 문서가 멀쩡해 보이는데 안 걸리는 경우는 눈으로 못 잡는다.
//   실측(2026-08-09): 월간 점검 7항목이 「장비 공통」으로만 적혀 「방화벽」이 한 번도 안 나왔고,
//   담당자가 늘 하는 질문("방화벽 월간 정기점검 절차")에 **상위 6건에도 못 들었다** —
//   대신 샘플 데모 파일이 1위였다. 문서를 고쳐 30/30을 만들었고, 여기서 지킨다.
run("docprobe", "node", ["tools/doc-probe.mjs"]);
// 문서를 고쳐도 운영 AI가 **옛 판으로 답하던** 것(2026-08-08 실사고) — 배포가 소스만 옮기고
//   문서는 아무도 안 옮겼고, 운영 서버에는 같은 이름의 사본이 세 곳에 있었다.
//   리포지토리 ↔ 운영 문서 폴더 ↔ 지식 저장소를 한 줄로 대조한다.
//   ⚠ 이 도구는 **win 호스트 전용**이다(운영 값을 wsl로 읽는다) — 그래서 「못 쟀다」가 실제로 난다.
//     0=같음 · 1=어긋남 · **2=판정 못 함**. 2를 실패로 세면 환경 문제가 문서 결함으로 둔갑한다.
run("docs", "node", ["tools/docs-drift.mjs"], {
  판정못함코드: [2],
  판정못함사유: "이 도구는 win 호스트 전용이다(운영 값을 wsl로 읽는다) — WSL·gb10 안에서 돌렸거나 운영 값을 못 읽었다",
});

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
  // ? = 판정 못 함(초록도 빨강도 아니다) · ― = 안 돌림(스킵) · ✓/⚠/✗ = 실제로 쟀다
  const mark = 기호(r, !!k);
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
// ⚠ 미판정을 요약에서 한 번 더 크게 말한다 — 표의 ? 한 글자는 스크롤에 묻힌다.
const 미판정 = results.filter((r) => r.판정못함);
if (미판정.length) {
  console.log("\n? 판정 못 한 계층 — **통과가 아니다**(재지 못했다는 뜻). 원인을 없앤 뒤 다시 돌리세요");
  for (const r of 미판정) console.log("   · " + r.name + ": " + r.note);
}
console.log(
  fails.length
    ? "\n✗ 실패 " + fails.length + "계층 — 마커를 갱신하지 않습니다(다음 실행이 같은 변경을 다시 봄)"
    : "\n✓ 잰 계층은 전부 통과" +
      (knownOnly.length ? " (알려진 이슈 제외)" : "") +
      (미판정.length ? " — ⚠ 다만 " + 미판정.length + "계층은 **재지 못했다**(위 ? 목록)" : ""),
);

// ⚠ 마커에 **미판정 계층을 적어 둔다** — 안 적으면 「이 커밋은 다 돌았다」로만 남아, 재지 못한 계층이
//   기록에서 사라진다(스킵과 똑같이 취급되던 자리다).
if (!fails.length) fs.writeFileSync(MARKER, JSON.stringify({ commit: head, at: new Date().toISOString(), layers: [...picks], knownIssues: [...knownIds], 미판정: 미판정.map((r) => r.name) }, null, 2));
fs.writeFileSync(path.join(OUT, "qa-full-report.md"), [
  `# QA 전수조사 (${new Date().toISOString().slice(0, 16)})`,
  `- 기준: ${since ? since.slice(0, 8) : "(첫 실행)"} → ${head.slice(0, 8)} · 변경 ${changed.length}파일`,
  `- 계층: ${results.map((r) => {
    const k = knownOnly.find((x) => x.name === r.name);
    return `${r.name}=${r.판정못함 ? "판정못함" : r.ok === null ? "스킵" : r.ok ? "통과" : k ? "알려진이슈" : "실패"}`;
  }).join(" · ")}`,
  ...(미판정.length
    ? ["", "## ? 판정 못 한 계층(통과가 아니다 — 재지 못했다)",
       ...미판정.map((r) => "- **" + r.name + "** — " + r.note)]
    : []),
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
