#!/usr/bin/env node
// tools/mac-gatekeeper-check.mjs — 배포 산출물이 **고객 기계에서 삭제되지 않는지** 기계가 잡는다.
//
// 왜 만들었나 (2026-08-09 Mac 실측):
//   dmg를 설치하고 실행하면 macOS가 경고가 아니라 **앱을 삭제**했다.
//       "악성 코드가 차단되고 휴지통으로 이동함"
//   원인은 「서명이 없어서」가 아니라 「서명이 깨져서」였다. build.mac의 identity:null이
//   electron-builder의 서명 단계를 건너뛰게 하고, **Electron 원본의 ad-hoc 링커 서명이
//   그대로 남는다.** 번들 id는 ai.gijo.as인데 서명 식별자는 Electron —
//   macOS는 이걸 "정품 앱을 누가 뜯어고쳤다"로 읽는다.
//   afterSign 훅(client/build/mac-adhoc-sign.cjs)으로 고쳤지만, **그 훅이 빠지거나
//   조용히 실패하면 그대로 재발한다.** 그때 알아채는 자리가 여기다.
//
// ─── 이 검사가 존재하는 진짜 이유 ────────────────────────────────────────────
// 같은 날 안전망을 두 개 만들었는데 둘 다 사람 손을 탔다.
//   · keyleak-check → 만든 날 확인해 보니 **아무도 부르지 않았다**
//   · dmg 검증      → 사람이 손으로 A/B/C/D를 돌렸다
// 손으로 도는 검사는 다음 빌드에 조용히 사라진다. 그래서 기계가 부르게 만든다.
//
// ─── ⚠ 검증할 때 빠지기 쉬운 함정 (실제로 한 번 빠질 뻔했다) ─────────────────
// 격리 표시를 **.app에 직접** 붙이면 오탐이 난다:
//     xattr -w com.apple.quarantine "0081;...;Safari;" "GIJO AS.app"   ← 틀린 방법
//     → 실행 8초 뒤 삭제된다. 그래서 "아직 안 고쳐졌다"고 볼 뻔했다.
// 그런데 그 상태는 **실제로 생기지 않는다.** OS가 dmg·zip에서 앱을 꺼낼 때 앱에 쓰는
// 값은 `0281;00000000;;` 이고, 그 상태에서는 삭제되지 않는다.
//     → 반드시 **컨테이너(dmg·zip)에 격리를 붙이고 마운트·해제로 전파**시켜야 한다.
//       이 스크립트가 그렇게 한다. 아래 「격리 전파」 검사가 그 전제를 매번 확인한다.
//
// ─── ⚠ 판정을 로그로 하지 말 것 ──────────────────────────────────────────────
// `log show`는 전체 디스크 접근 권한이 없으면 **빈 결과**를 준다(오류가 아니라 0줄).
// ~/.Trash도 Operation not permitted다. syspolicyd 로그가 조용하다고 "격리 시도 0건"이라
// 판정하면 **근거 없는 초록불**이다 — 실제로 한 번 냈다.
// 판정은 **앱이 설치 자리에 남아 있는가**로 한다.
//
// 사용:
//   node tools/mac-gatekeeper-check.mjs             정적 검사 (서명·봉인·격리전파) — 빠름
//   node tools/mac-gatekeeper-check.mjs --launch    실제 설치·실행해서 생존까지 확인
//   node tools/mac-gatekeeper-check.mjs --artifact <경로>   특정 dmg/zip만
//
// 종료 코드: 실패 있으면 1, 아니면 0
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const DO_LAUNCH = process.argv.includes("--launch");
const ART_ARG = (() => {
  const i = process.argv.indexOf("--artifact");
  return i >= 0 ? process.argv[i + 1] : null;
})();

if (process.platform !== "darwin") {
  console.error("이 검사는 macOS 전용입니다 (현재: " + process.platform + ").");
  process.exit(2);
}

const 결과 = [];
const 기록 = (이름, 통과, 내용) => 결과.push({ 이름, 통과, 내용: String(내용 ?? "").slice(0, 200) });

/** 기대하는 서명 식별자 — client/package.json의 appId가 정답이다. */
function 기대식별자() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO, "client/package.json"), "utf8")).build?.appId ?? null;
  } catch {
    return null;
  }
}

/**
 * codesign -dv 의 출력을 읽는다.
 * ⚠ codesign -dv는 **stderr로 쓴다.** execFileSync는 stdout만 돌려주므로 그걸 쓰면
 *   결과가 늘 빈 문자열이고 모든 검사가 조용히 통과한다 — afterSign 훅에서 실제로
 *   그 버그가 있었다(2026-08-09, 1e0b5d8에서 수정). 두 갈래를 다 받아야 한다.
 */
function 서명정보(appPath) {
  const r = spawnSync("codesign", ["-dvvv", appPath], { encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

function 임시폴더() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gijo-gk-"));
}

/** 컨테이너(dmg·zip)에 「사파리로 받은 파일」 표시를 붙인다 — 고객 경로를 그대로 만든다. */
function 격리부착(파일) {
  const stamp = Math.floor(Date.now() / 1000).toString(16);
  execFileSync("xattr", ["-w", "com.apple.quarantine", `0081;${stamp};Safari;`, 파일]);
}

/** dmg를 열어 안의 .app 경로를 주고, 끝나면 반드시 분리한다. */
function dmg안에서(dmgPath, 하기) {
  const out = execFileSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly"], { encoding: "utf8" });
  const mnt = out.trim().split("\n").pop().split("\t").pop().trim();
  try {
    const app = fs.readdirSync(mnt).find((f) => f.endsWith(".app"));
    if (!app) throw new Error("dmg 안에 .app이 없습니다");
    return 하기(path.join(mnt, app));
  } finally {
    // 분리는 실패해도 검사 결과를 뒤집지 않는다 — 남은 마운트는 재부팅으로 정리된다.
    try { execFileSync("hdiutil", ["detach", mnt, "-quiet"]); } catch {}
  }
}

/** zip을 풀어 안의 .app 경로를 준다. ditto를 쓰는 이유: unzip은 격리 표시를 전파하지 않는다. */
function zip안에서(zipPath, 하기) {
  const dir = path.join(임시폴더(), "x");
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("ditto", ["-x", "-k", zipPath, dir]);
  const app = fs.readdirSync(dir).find((f) => f.endsWith(".app"));
  if (!app) throw new Error("zip 안에 .app이 없습니다");
  return 하기(path.join(dir, app));
}

// ── 검사 본체 ────────────────────────────────────────────────────────────────
function 산출물검사(라벨, appPath) {
  const 기대 = 기대식별자();
  const info = 서명정보(appPath);
  const id = /Identifier=(\S+)/.exec(info)?.[1];
  const sealed = /Sealed Resources[^\n]*/.exec(info)?.[0] ?? "";

  // ① 식별자 — Electron으로 남아 있으면 **고객 기계에서 앱이 삭제된다.** 이게 핵심이다.
  if (!id) {
    기록(`${라벨} 서명 식별자`, false, "읽지 못함 — 확인 없이 내보낼 수 없습니다");
  } else if (id === "Electron") {
    기록(`${라벨} 서명 식별자`, false, "Electron — afterSign 재서명이 안 먹었습니다. 이대로 내보내면 macOS가 앱을 지웁니다");
  } else if (기대 && id !== 기대) {
    기록(`${라벨} 서명 식별자`, false, `${id} (기대 ${기대})`);
  } else {
    기록(`${라벨} 서명 식별자`, true, id);
  }

  // ② 리소스 봉인 — none이면 "누가 뜯어고쳤다"로 읽힌다.
  const 봉인됨 = sealed && !/none/i.test(sealed);
  기록(`${라벨} 리소스 봉인`, !!봉인됨, 봉인됨 ? sealed.trim() : "Sealed Resources=none — 봉인이 없습니다");

  // ③ 서명 정합성 — 봉인과 실제 파일이 맞는지.
  const v = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], { encoding: "utf8" });
  기록(`${라벨} 서명 정합성`, v.status === 0,
    v.status === 0 ? "verify --deep --strict 통과" : (v.stderr || "").trim().slice(0, 160));

  // ④ 격리 전파 — **이 검사가 시험 자체의 신뢰성을 지킨다.**
  //    앱이 격리 표시를 물려받지 못했다면 우리는 고객 경로를 재현하지 못한 것이고,
  //    그 상태의 "통과"는 아무것도 보장하지 않는다. 통과로 위장시키지 않는다.
  const q = spawnSync("xattr", ["-p", "com.apple.quarantine", appPath], { encoding: "utf8" });
  const 격리값 = (q.stdout ?? "").trim();
  기록(`${라벨} 격리 전파`, q.status === 0 && !!격리값,
    격리값 ? `${격리값} (OS가 전파한 값 — .app에 손으로 붙이면 오탐)` : "전파 안 됨 — 고객 경로를 재현하지 못했습니다");

  return appPath;
}

/** 실제 설치 자리에 넣고 실행해서 **살아남는지** 본다. 판정은 존재 여부로만 한다. */
function 생존검사(라벨, appPath) {
  const 대상 = path.join("/Applications", path.basename(appPath));
  if (fs.existsSync(대상)) {
    기록(`${라벨} 설치·생존`, true, "건너뜀 — 이미 설치본이 있습니다(덮어쓰지 않습니다). 지운 뒤 --launch로 다시 도세요");
    return;
  }
  try {
    execFileSync("cp", ["-R", appPath, "/Applications/"]);
    spawnSync("open", ["-a", 대상]);
    // 실측에서 삭제는 실행 후 8초 안에 일어났다. 넉넉히 20초 본다.
    const 끝 = Date.now() + 20000;
    let 사라진시각 = null;
    while (Date.now() < 끝) {
      if (!fs.existsSync(대상)) { 사라진시각 = Math.round((20000 - (끝 - Date.now())) / 1000); break; }
      spawnSync("sleep", ["1"]);
    }
    기록(`${라벨} 설치·생존`, 사라진시각 === null,
      사라진시각 === null ? "20초 관찰 — 살아 있음" : `+${사라진시각}초에 macOS가 삭제했습니다`);
  } finally {
    spawnSync("pkill", ["-f", path.basename(appPath)]);
    spawnSync("sleep", ["2"]);
    try { fs.rmSync(대상, { recursive: true, force: true }); } catch {}
  }
}

// ── 산출물 찾기 ──────────────────────────────────────────────────────────────
const RELEASE = path.join(REPO, "client/release");
let 산출물 = [];
if (ART_ARG) {
  산출물 = [path.resolve(ART_ARG)];
} else if (fs.existsSync(RELEASE)) {
  산출물 = fs.readdirSync(RELEASE)
    .filter((f) => f.endsWith(".dmg") || f.endsWith(".zip"))
    .map((f) => path.join(RELEASE, f));
}

if (!산출물.length) {
  console.error("검사할 산출물이 없습니다 — client에서 npm run dist 먼저 (또는 --artifact <경로>).");
  process.exit(2);
}

for (const art of 산출물) {
  const 라벨 = path.extname(art).slice(1);
  try {
    // 고객 경로 재현: **컨테이너에** 격리를 붙이고 OS가 앱으로 전파하게 둔다.
    const 사본 = path.join(임시폴더(), path.basename(art));
    fs.copyFileSync(art, 사본);
    격리부착(사본);

    const 안에서 = art.endsWith(".dmg") ? dmg안에서 : zip안에서;
    안에서(사본, (appPath) => {
      // dmg는 읽기전용 마운트라 앱을 밖으로 꺼내야 격리 전파·설치 시험이 된다.
      const 작업 = path.join(임시폴더(), path.basename(appPath));
      execFileSync("cp", ["-R", appPath, 작업]);
      산출물검사(라벨, 작업);
      if (DO_LAUNCH) 생존검사(라벨, 작업);
    });
  } catch (e) {
    기록(`${라벨} 검사`, false, e.message);
  }
}

// ── 출력 ────────────────────────────────────────────────────────────────────
const 실패 = 결과.filter((r) => !r.통과).length;
console.log("\n━━ mac 배포 산출물 검사 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
for (const r of 결과) console.log(`  ${r.통과 ? "✅" : "❌"} ${r.이름.padEnd(20)} ${r.내용}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  통과 ${결과.length - 실패} · 실패 ${실패}`);
if (!DO_LAUNCH) console.log("  (--launch 를 주면 실제 설치·실행까지 확인합니다)");
if (실패) {
  console.log("\n  ❌ 이대로 내보내면 고객 기계에서 앱이 삭제될 수 있습니다.");
  console.log("     확인할 곳: client/build/mac-adhoc-sign.cjs 가 afterSign으로 등록돼 있는지,");
  console.log("     빌드 로그에 \"[mac-adhoc-sign] ✓ 식별자 ...\" 가 찍혔는지.");
}
console.log("");
process.exit(실패 > 0 ? 1 : 0);
