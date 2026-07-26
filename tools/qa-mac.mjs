// tools/qa-mac.mjs — Mac 전용 QA 하네스 (2026-07-26 신설)
//
// 왜 별도인가: 기존 QA(qa-full·qa-auto·qa-suite)는 Windows/WSL 운영 기준으로 작성돼 있다.
// Mac에서 같은 걸 다시 도는 건 낭비고, "Mac에서만 잡히는 것"을 놓치는 게 진짜 손실이다.
// 이 하네스는 Windows에서 절대 실행되지 않는 경로와 macOS 고유 사고만 본다.
//
// 검사 대상 (근거: GIJO_AS_MAC_QA_계획.md)
//   A. 플랫폼 분기 코드 4곳 — llamabin·preflight·localengine·hardeningscan
//   B. 배포 위생          — Electron 코드서명(XProtect 격리 이력), 네이티브 ABI
//   C. 상시 회귀          — 서버 3종 생존, VPN(TCP로 확인), hub 도달, 작업트리
//
// 사용:  node tools/qa-mac.mjs            (기본)
//        node tools/qa-mac.mjs --json     (기계 판독용)
//        node tools/qa-mac.mjs --no-net   (VPN·hub 검사 생략 — 오프라인)
//
// 종료 코드: FAIL 있으면 1, 아니면 0 (CI/스크립트 연동용)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const exec = promisify(execFile);
const REPO = path.resolve(import.meta.dirname, "..");
const JSON_OUT = process.argv.includes("--json");
const NO_NET = process.argv.includes("--no-net");

const results = [];
/** 검사 1건 기록. status: PASS | FAIL | WARN | SKIP */
function add(cat, name, status, detail) {
  results.push({ cat, name, status, detail: String(detail ?? "").slice(0, 200) });
}
async function sh(file, args, timeout = 15000) {
  try {
    const { stdout, stderr } = await exec(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, out: (stdout || "").trim(), err: (stderr || "").trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").trim(), err: (e.stderr || e.message || "").trim() };
  }
}
async function http(url, timeoutMs = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: c.signal });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, body: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// ── 0. 환경 전제 ────────────────────────────────────────────────────────────
if (process.platform !== "darwin") {
  console.error("이 하네스는 macOS 전용입니다 (현재: " + process.platform + ").");
  process.exit(2);
}
add("환경", "플랫폼", "PASS", `${process.platform}/${process.arch} · macOS ${os.release()}`);

// ── A. 플랫폼 분기 코드 — Windows에서 절대 안 도는 경로 ──────────────────────
// 빌드 산출물(dist)을 직접 import 해서 darwin 분기의 실제 반환값을 확인한다.
//
// ⚠ 반드시 server/ 로 cwd를 옮긴 뒤 import 한다. 서버 모듈은 "data/..."·"models/..."
//   같은 상대경로를 쓰므로, 저장소 루트에서 import하면 (a) preflight가 모델·바이너리를
//   못 찾아 거짓 FAIL을 내고 (b) db.js가 루트에 빈 DB(data/)를 실제로 만들어 버린다.
//   — 2026-07-26 이 하네스 첫 실행에서 실제로 발생. 아래 chdir이 그 재발 방지다.
const DIST = path.join(REPO, "server", "dist");
const CWD0 = process.cwd();
if (!fs.existsSync(DIST)) {
  add("A.분기", "서버 빌드", "FAIL", "server/dist 없음 — npm run build 먼저");
} else {
  process.chdir(path.join(REPO, "server"));
  // A-1. llamabin — darwin은 Release/*.exe가 아니라 build/bin/*
  try {
    const { llamaBinPath } = await import(path.join(DIST, "util/llamabin.js"));
    const p = llamaBinPath("llama-server");
    const okPath = !p.includes("Release") && !p.endsWith(".exe");
    add("A.분기", "llamabin 경로", okPath ? "PASS" : "FAIL", p);
  } catch (e) {
    add("A.분기", "llamabin 경로", "FAIL", e.message);
  }

  // A-2. preflight — darwin이면 GPU가 "Apple Metal"로 pass여야 한다(nvidia-smi 아님)
  try {
    const { runPreflight } = await import(path.join(DIST, "engine/preflight.js"));
    const r = await runPreflight();
    const gpu = r.checks.find((c) => c.name.includes("GPU"));
    const okGpu = gpu && gpu.status === "pass" && /Metal/.test(gpu.detail);
    add("A.분기", "preflight GPU", okGpu ? "PASS" : "FAIL", gpu ? `${gpu.name}: ${gpu.detail}` : "GPU 항목 없음");
    const fails = r.checks.filter((c) => c.status === "fail");
    add("A.분기", "preflight 전체", fails.length ? "FAIL" : "PASS",
      fails.length ? fails.map((f) => f.name).join(", ") : `ready=${r.ready}`);
  } catch (e) {
    add("A.분기", "preflight", "FAIL", e.message);
  }

  // A-3. localengine — darwin은 nvidia-smi가 없으므로 통합메모리를 VRAM으로 실측해야 한다
  try {
    const le = await import(path.join(DIST, "engine/localengine.js"));
    const gpu = await le.getGpuUsage?.();
    const okVram = gpu && gpu.available && gpu.memTotalMb > 0;
    add("A.분기", "통합메모리 인식", okVram ? "PASS" : "FAIL",
      gpu ? `총 ${(gpu.memTotalMb / 1024).toFixed(1)}GB · 사용 ${(gpu.memUsedMb / 1024).toFixed(1)}GB` : "조회 실패");
    if (okVram && le.recommendTier) {
      add("A.분기", "티어 판정", "PASS", `권장=${le.recommendTier(gpu.memTotalMb)}`);
    }
  } catch (e) {
    add("A.분기", "통합메모리 인식", "FAIL", e.message);
  }

  // A-4. hardeningscan — 호스트 실행기가 darwin에서 동작하는지(하드닝·조치검증 공용 수집 계층)
  try {
    const hs = await import(path.join(DIST, "engine/hardeningscan.js"));
    const r = await hs.hostRunner("echo gijo-qa-ok");
    add("A.분기", "hostRunner", r.out.includes("gijo-qa-ok") ? "PASS" : "FAIL", r.out || r.err);
  } catch (e) {
    add("A.분기", "hostRunner", "FAIL", e.message);
  }
  process.chdir(CWD0); // 원복 — 이후 git·경로 검사가 저장소 루트 기준이어야 한다
}

// ── B. 배포 위생 — 이번까지 실제로 터진 사고들 ──────────────────────────────
// B-1. Electron 코드서명: npm install 하면 서명이 깨져 XProtect가 앱을 휴지통으로 보낸다.
const ELECTRON_APP = path.join(REPO, "client/node_modules/electron/dist/Electron.app");
if (!fs.existsSync(ELECTRON_APP)) {
  add("B.배포", "Electron 존재", "FAIL", "Electron.app 없음 — XProtect 격리 의심. 재설치+재서명 필요");
} else {
  const v = await sh("codesign", ["--verify", "--deep", "--strict", ELECTRON_APP], 60000);
  add("B.배포", "Electron 코드서명", v.ok ? "PASS" : "FAIL",
    v.ok ? "서명 유효" : `${v.err.slice(0, 120)} → codesign --force --deep --sign - 로 재서명`);
}

// B-2. 네이티브 모듈 ABI: better-sqlite3가 Electron ABI로 빌드돼 있어야 번들 서버가 뜬다.
const SQLITE_NODE = path.join(REPO, "server/node_modules/better-sqlite3/build/Release/better_sqlite3.node");
add("B.배포", "better-sqlite3 바이너리", fs.existsSync(SQLITE_NODE) ? "PASS" : "WARN",
  fs.existsSync(SQLITE_NODE) ? "존재(ABI는 Electron 실행 로그로 확인)" : "없음 — npm rebuild 필요");

// ── C. 상시 회귀 — 작업을 실제로 중단시켰던 것들 ────────────────────────────
// C-1. 서버 3종 생존
const health = await http("http://localhost:4000/api/health");
if (health.ok) {
  let schema = "?";
  try { schema = JSON.parse(health.body).schema?.latest ?? "?"; } catch {}
  add("C.회귀", "서버 4000", "PASS", `health ok · schema=${schema}`);
} else {
  add("C.회귀", "서버 4000", "FAIL", "무응답 — launchctl kickstart 또는 update-dev-mac.sh");
}
for (const [port, label] of [[8081, "임베딩 bge-m3"], [8080, "채팅 모델"]]) {
  const r = await http(`http://localhost:${port}/health`, 4000);
  add("C.회귀", `${label} ${port}`, r.ok ? "PASS" : "WARN", r.ok ? "응답" : "무응답(모델 미기동일 수 있음)");
}

// C-2. VPN — ICMP는 정책상 차단돼 있으므로 반드시 TCP로 확인한다(ping으로 판단하면 오진).
if (NO_NET) {
  add("C.회귀", "VPN 터널", "SKIP", "--no-net");
} else {
  const hasUtun = (await sh("ifconfig", ["utun4"])).out.includes("inet ");
  add("C.회귀", "VPN 인터페이스", hasUtun ? "PASS" : "WARN", hasUtun ? "utun4 활성" : "utun4 없음 — scutil --nc start \"client-mac\"");
  const tcp = await sh("nc", ["-z", "-w", "5", "10.8.0.1", "22"], 12000);
  add("C.회귀", "hub 도달(TCP 22)", tcp.ok ? "PASS" : "WARN",
    tcp.ok ? "SSH 포트 열림" : "무응답 — VPN 또는 Windows sshd 확인 (ping으로 판단하지 말 것)");
}

// C-3. 작업트리 — 낡은 lock 파일이 hub 머지를 막았던 이력이 있다.
const st = await sh("git", ["-C", REPO, "status", "--porcelain"]);
const dirty = st.out.split("\n").filter((l) => l.trim() && !l.includes("data.fresh-backup"));
add("C.회귀", "작업트리", dirty.length === 0 ? "PASS" : "WARN",
  dirty.length === 0 ? "깨끗" : `미커밋 ${dirty.length}건: ${dirty.map((d) => d.slice(3)).join(", ").slice(0, 100)}`);

// ── 출력 ────────────────────────────────────────────────────────────────────
const n = (s) => results.filter((r) => r.status === s).length;
const summary = { PASS: n("PASS"), FAIL: n("FAIL"), WARN: n("WARN"), SKIP: n("SKIP") };

if (JSON_OUT) {
  console.log(JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 1));
} else {
  const icon = { PASS: "✅", FAIL: "❌", WARN: "⚠️ ", SKIP: "⏭️ " };
  let lastCat = "";
  console.log("\n━━ Mac QA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const r of results) {
    if (r.cat !== lastCat) { console.log(`\n[${r.cat}]`); lastCat = r.cat; }
    console.log(`  ${icon[r.status]} ${r.name.padEnd(22)} ${r.detail}`);
  }
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  PASS ${summary.PASS} · FAIL ${summary.FAIL} · WARN ${summary.WARN} · SKIP ${summary.SKIP}`);
  if (summary.FAIL) console.log("  ❌ 실패 항목이 있습니다 — 위 detail의 조치 안내 참고");
  console.log("");
}
process.exit(summary.FAIL > 0 ? 1 : 0);
