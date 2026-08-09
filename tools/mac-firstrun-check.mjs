#!/usr/bin/env node
// tools/mac-firstrun-check.mjs — **깨끗한 기계에서의 첫 실행**을 기계가 밟아 본다.
//
// 왜 만들었나 (2026-08-09):
//   그날 나온 결함 셋이 전부 같은 뿌리였다 — **우리 기계에는 있고 고객 기계에는 없는 것.**
//     · 기본 채팅 모델이 7.6B  — app_state의 기억(lastModelId)이 덮어서 안 드러났다
//     · mac 통합메모리 여유 0  — 캐시가 찬 정상 상태라 「그럴듯한 숫자」가 나왔다
//     · 고객 DB가 앱 번들 안   — dev의 serverRoot는 원래 맞는 자리라 증상이 없었다
//   셋 다 **개발 기계에서는 절대 안 드러난다.** 우리는 늘 데이터가 쌓인 기계에서만 확인했다.
//   그날은 사람이 손으로 밟아서 찾았는데, 손으로 하는 검증은 다음 빌드에 사라진다.
//
// 무엇을 보는가 — 첫 실행이 **앱 자신을 더럽히지 않는지**:
//   ① 앱 번들 안에 data/가 생기지 않는다
//      (생기면 ⑴ 업데이트가 고객 데이터를 지우고 ⑵ 코드 서명 봉인이 깨진다)
//   ② 첫 실행 **뒤에도** codesign --verify --deep --strict 가 통과한다
//      — afterSign 훅이 맞춰 내보내도 앱 자신의 첫 실행이 되돌리면 헛일이다
//   ③ 고객 데이터가 userData 쪽에 제대로 생긴다(아무 데도 안 생기는 것도 결함이다)
//
// ⚠ 원본 .app을 건드리지 않는다 — 임시 폴더로 복사해서 띄운다. userData도 임시로 준다
//   (--user-data-dir). 그래서 담당자가 쓰던 설치본·데이터에 손대지 않는다.
//   패키징본은 app.setPath("userData")를 하지 않으므로(!app.isPackaged 갈래) 이 스위치가 먹는다.
//   단일 인스턴스 잠금도 userData 기준이라 떠 있는 설치본과 충돌하지 않는다.
//
// 사용:
//   node tools/mac-firstrun-check.mjs                 client/release/mac-arm64 의 .app
//   node tools/mac-firstrun-check.mjs --app <경로>
//
// 종료 코드: 실패 있으면 1
import { execFileSync, spawnSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const APP_ARG = (() => { const i = process.argv.indexOf("--app"); return i >= 0 ? process.argv[i + 1] : null; })();
const CDP_PORT = 9231; // 담당자가 쓰는 9223과 겹치지 않게 — 검사가 남의 앱에 붙으면 안 된다

/**
 * 첫 설치 화면을 대신 밟는다 — 2026-08-09부터 첫 실행은 로그인이 아니라 **관리자 계정 만들기**다.
 * 계정을 넣기 전에는 서버가 뜨지 않으므로, 이 단계를 밟지 않으면 「데이터가 안 생긴다」는
 * 거짓 실패가 난다(이 검사가 실제로 그렇게 한 번 빨간불이 됐다).
 *
 * ⚠ 여기 쓰는 계정은 **임시 폴더에서만 사는 검사용**이다. 검사가 끝나면 폴더째 지운다.
 * ⚠ CDP는 --user-data-dir와 함께 써도 **된다.** 다만 포트가 열리고 응답이 오기까지
 *   30초 넘게 걸릴 수 있다 — 일찍 포기하면 「CDP가 안 된다」고 오판한다(실제로 한 번 그랬다).
 */
async function 설정화면밟기() {
  const 잠깐비동기 = (ms) => new Promise((r) => setTimeout(r, ms));
  let 대상 = null;
  for (let i = 0; i < 80; i++) { // 최대 80초
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      대상 = l.find((x) => x.type === "page" && /setup\.html|login\.html|app\.html/.test(x.url));
      if (대상) break;
    } catch { /* 아직 안 열렸다 */ }
    await 잠깐비동기(1000);
  }
  if (!대상) return "CDP에 붙지 못했습니다";
  if (!대상.url.includes("setup.html")) return null; // 첫 설치가 아니다 — 밟을 것이 없다

  const ws = new WebSocket(대상.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const 답 = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) 답.set(m.id, m); };
  ws.send(JSON.stringify({
    id: 1, method: "Runtime.evaluate",
    params: {
      returnByValue: true,
      expression: `(()=>{
        const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
        set(document.getElementById('id'),'checkadmin');
        set(document.getElementById('pw'),'firstrun-check-1234');
        set(document.getElementById('pw2'),'firstrun-check-1234');
        document.getElementById('go').click(); return 'ok';
      })()`,
    },
  }));
  for (let i = 0; i < 100; i++) { if (답.has(1)) break; await 잠깐비동기(50); }
  ws.close();
  return 답.has(1) ? null : "설정 화면을 밟지 못했습니다";
}

if (process.platform !== "darwin") {
  console.error("이 검사는 macOS 전용입니다 (현재: " + process.platform + ").");
  process.exit(2);
}

const 결과 = [];
const 기록 = (이름, 통과, 내용) => 결과.push({ 이름, 통과, 내용: String(내용 ?? "").slice(0, 200) });
const 잠깐 = (초) => spawnSync("sleep", [String(초)]);

// ── 대상 찾기 ────────────────────────────────────────────────────────────────
let 원본 = APP_ARG;
if (!원본) {
  const dir = path.join(REPO, "client/release/mac-arm64");
  const found = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith(".app"));
  if (found) 원본 = path.join(dir, found);
}
if (!원본 || !fs.existsSync(원본)) {
  console.error("검사할 .app이 없습니다 — client에서 npm run dist 먼저 (또는 --app <경로>).");
  process.exit(2);
}

const 임시 = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-firstrun-"));
const 앱 = path.join(임시, path.basename(원본));
const 사용자데이터 = path.join(임시, "userdata");
let 자식 = null;

try {
  execFileSync("cp", ["-R", 원본, 앱]);
  fs.mkdirSync(사용자데이터, { recursive: true });

  const 번들데이터 = path.join(앱, "Contents/Resources/server-dist/data");
  // 복사 직후에 이미 있으면 **빌드 산출물에 개발 데이터가 섞여 나간 것**이다 — 그것부터 알린다.
  기록("배포본이 깨끗한가", !fs.existsSync(번들데이터),
    fs.existsSync(번들데이터) ? "빌드 산출물에 이미 data/가 들어 있습니다 — 개발 데이터가 섞여 나갑니다" : "data/ 없음");

  const 전 = spawnSync("codesign", ["--verify", "--deep", "--strict", 앱], { encoding: "utf8" });
  기록("실행 전 봉인", 전.status === 0, 전.status === 0 ? "통과" : (전.stderr || "").trim().slice(0, 120));

  // ── 첫 실행 ──────────────────────────────────────────────────────────────
  // open이 아니라 실행 파일을 직접 띄운다 — 이미 떠 있는 설치본을 활성화해 버리는 일을 막고,
  // 끝나고 확실히 죽일 수 있다. (2026-08-09에 open을 써서 옛 인스턴스가 살아난 적이 있다)
  const 실행파일 = path.join(앱, "Contents/MacOS", path.basename(앱, ".app"));
  자식 = spawn(실행파일, [`--user-data-dir=${사용자데이터}`, `--remote-debugging-port=${CDP_PORT}`], { stdio: "ignore", detached: false });

  // 첫 실행은 계정을 받아야 서버가 뜬다 — 그 화면을 대신 밟는다(없으면 그냥 지나간다).
  const 설정문제 = await 설정화면밟기();
  if (설정문제) 기록("첫 설치 화면", false, 설정문제);

  const DB = path.join(사용자데이터, "data", "gijo-as.sqlite");
  let 생김 = false;
  for (let i = 0; i < 30; i++) { // 최대 60초
    잠깐(2);
    if (fs.existsSync(DB)) { 생김 = true; break; }
  }

  // ── 판정 ─────────────────────────────────────────────────────────────────
  기록("★ 앱 번들을 더럽히지 않는다", !fs.existsSync(번들데이터),
    fs.existsSync(번들데이터)
      ? `번들 안에 data/가 생겼습니다: ${fs.readdirSync(번들데이터).join(", ")} — 업데이트하면 고객 데이터가 사라지고 서명 봉인이 깨집니다`
      : "번들 안 data/ 없음");

  const 후 = spawnSync("codesign", ["--verify", "--deep", "--strict", 앱], { encoding: "utf8" });
  기록("★ 실행 후에도 봉인 유지", 후.status === 0,
    후.status === 0 ? "통과" : `${(후.stderr || "").trim().slice(0, 120)} — afterSign으로 맞춰도 첫 실행이 되돌립니다`);

  기록("고객 데이터가 userData에 생긴다", 생김,
    생김 ? `${fs.readdirSync(path.join(사용자데이터, "data")).join(", ")}` : "60초 안에 안 생겼습니다 — 서버가 못 떴을 수 있습니다(포트 4000 점유 여부 확인)");

  // ── 업데이트가 고객 데이터를 지우지 않는가 ────────────────────────────────
  //
  // 데이터를 앱 번들 밖(userData)으로 옮긴 **이유가 바로 이것**이다. 그런데 옮겨 놓고
  // 「업데이트해도 남는가」를 재보지 않으면 반쪽이다 — 고치려던 그 사고가 그대로일 수 있다.
  //
  // 고객이 하는 그대로 한다: 앱을 끄고, **.app을 통째로 새 것으로 바꾸고**, 다시 켠다.
  // ⚠ 판정은 「파일이 있다」가 아니라 **「같은 파일인가」**로 한다. 지워지고 새로 만들어져도
  //   파일은 있기 때문이다 — 그러면 고객은 데이터를 잃고도 「멀쩡해 보이는 빈 앱」을 본다.
  //   그래서 inode와 생성 시각을 대조한다.
  if (생김) {
    const 전 = fs.statSync(DB);
    자식?.kill("SIGTERM");
    잠깐(4);
    spawnSync("pkill", ["-f", 임시]);
    잠깐(2);

    fs.rmSync(앱, { recursive: true, force: true }); // 고객의 「교체하시겠습니까? → 예」
    execFileSync("cp", ["-R", 원본, 앱]);
    자식 = spawn(실행파일, [`--user-data-dir=${사용자데이터}`, `--remote-debugging-port=${CDP_PORT}`], { stdio: "ignore", detached: false });
    잠깐(15);

    const 남음 = fs.existsSync(DB);
    const 후 = 남음 ? fs.statSync(DB) : null;
    const 같은파일 = !!후 && 후.ino === 전.ino && Math.abs(후.birthtimeMs - 전.birthtimeMs) < 1000;
    기록("★ 업데이트가 고객 데이터를 지우지 않는다", 같은파일,
      !남음
        ? "DB가 사라졌습니다 — 업데이트가 고객 데이터를 지웁니다"
        : 같은파일
          ? "같은 DB 파일이 그대로 남았습니다(inode·생성시각 일치)"
          : "파일은 있지만 **새로 만들어졌습니다** — 고객은 빈 앱을 보게 됩니다");

    // 재서명 봉인은 업데이트 뒤에도 살아 있어야 한다(새 .app이 곧 다시 더럽혀지면 같은 사고다).
    const 봉인 = spawnSync("codesign", ["--verify", "--deep", "--strict", 앱], { encoding: "utf8" });
    기록("업데이트 뒤에도 봉인 유지", 봉인.status === 0,
      봉인.status === 0 ? "통과" : (봉인.stderr || "").trim().slice(0, 120));
  }
} catch (e) {
  기록("검사", false, e.message);
} finally {
  // 띄운 앱을 반드시 정리한다 — 남으면 다음 검사가 「이미 떠 있는 인스턴스」에 걸린다.
  try { if (자식 && !자식.killed) 자식.kill("SIGTERM"); } catch { /* 이미 죽었으면 그만 */ }
  잠깐(2);
  spawnSync("pkill", ["-f", 임시]); // 자식이 띄운 서버·헬퍼까지
  잠깐(1);
  try { fs.rmSync(임시, { recursive: true, force: true }); } catch { /* 남아도 tmp라 곧 정리된다 */ }
}

const 실패 = 결과.filter((r) => !r.통과).length;
console.log("\n━━ mac 첫 실행 검사 (깨끗한 기계 흉내) ━━━━━━━━━━━━━━━━━━");
for (const r of 결과) console.log(`  ${r.통과 ? "✅" : "❌"} ${r.이름.padEnd(24)} ${r.내용}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  통과 ${결과.length - 실패} · 실패 ${실패}`);
if (실패) {
  console.log("\n  ❌ 첫 실행이 앱 자신을 더럽힙니다.");
  console.log("     확인할 곳: client/src/main.ts 의 maybeStartBundledServer —");
  console.log("     패키징본의 cwd가 app.getPath(\"userData\")인지, GIJO_DOCS_* 를 넘기는지.");
}
console.log("");
process.exit(실패 > 0 ? 1 : 0);
