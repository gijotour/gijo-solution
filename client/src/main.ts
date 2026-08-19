// GIJO AS 클라이언트 — Electron 메인 프로세스
// [CS 구조 변경] engine/ 모듈을 더 이상 임포트하지 않는다(전부 서버로 이전됨).
// main.ts는 창 관리와 페이지 네비게이션만 담당하는 얇은 셸이다.

import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, screen, session } from "electron";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import * as os from "os";
import { 셸옮길자리 } from "./util/layout";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import { URL } from "url";
import { isDangerous } from "./terminalPolicy";

let mainWindow: BrowserWindow | null = null;
let docboxWindow: BrowserWindow | null = null; // 문서함 별도 창 — 제품 화면 셸(탭) 밖에서 돈다(사용자 결정 2026-07-30)
let officeWindow: BrowserWindow | null = null; // "우리 AI 팀 사무실" 별도 창(시안 B) — 관제 모니터 상시용
let smartMdWindow: BrowserWindow | null = null; // GIJO Smart MD Studio — 로그인 고객 무료 제공(2026-08-14)
let quitConfirmed = false; // 메인 창 닫기 확인을 통과했는가 — 재시작·업데이트는 true로 건너뛴다
let bundledServerProcess: ChildProcess | null = null;
/** 이 앱이 서버를 직접 띄웠을 때만 채워진다 — 저장 암호화 전환처럼 **서버를 멈춰야 하는 일**에 쓴다. */
let 번들서버: { entry: string; serverRoot: string; dataRoot: string; env: NodeJS.ProcessEnv } | null = null;

// 페이지 전체 네비게이션(loadFile) 시마다 preload가 재실행되어 사라지는 인증 토큰/서버 주소를
// 여기(메인 프로세스, 앱 생명주기 동안 유지됨)에 보관한다 — apiClient.ts가 동기 IPC로 읽고 쓴다.
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
}
let authState: AuthState = { accessToken: null, refreshToken: null, serverUrl: null };

/**
 * 에디션이 정하는 **기본 포트** — 라이트 7445 · 스탠다드/프로 7446 (사장님 지시 2026-08-13).
 *
 * ⚠ **여기가 단일 출처다.** 예전에는 `4000`이 네 곳에 따로 박혀 있었고(서버 listen · 헬스 폴링 ·
 *   렌더러 기본 주소 · login 안내문), 네 곳이 **전부 같아야 첫 로그인이 된다.** 하나만 어긋나면
 *   화면은 멀쩡히 뜨는데 로그인만 **조용히** 실패한다 — 아래 헬스 폴링 주석이 이미 경고하던 자리다.
 *
 * ⚠ **프로는 스탠다드와 같은 포트(7446)를 쓴다**(사장님 결정 2026-08-13, max 권고안 B).
 *   프로는 별도 빌드가 아니라 스탠다드의 **런타임 티어**(app_state gijoTier)라 같은 프로세스다.
 *   포트는 **부팅 때** 정해지는데 티어는 **부팅 후 DB에서** 읽으므로, 포트를 가르려면 런처가
 *   부팅 전에 티어를 알아야 한다 — 그 상태와 DB 티어가 어긋나면 엉뚱한 포트로 뜬다.
 *   프로는 「기능 등급」이지 「다른 서버」가 아니므로 가를 실익이 없다.
 *
 * ⚠ 지금 4000에서 도는 앱은 그대로 둔다 — **다음 빌드부터** 새 포트다(사장님 「그대로 두고 다음부터」).
 *   env로 명시한 값이 있으면 그것이 이긴다(개발·원격 지정).
 */
function 서버포트(): number {
  const 지정 = Number(process.env.GIJO_SERVER_PORT);
  if (Number.isFinite(지정) && 지정 > 0) return 지정;
  return 에디션() === "lite" ? 7445 : 7446;
}

/** 이 앱이 기본으로 붙을 서버 주소 — 렌더러(core.ts)가 auth:getState로 이 값을 집는다. */
function 기본서버주소(): string {
  return process.env.GIJO_SERVER_URL ?? `http://localhost:${서버포트()}`;
}

ipcMain.on("auth:getState", (event) => {
  // ⚠ serverUrl을 **첫 실행에 seed**한다(2026-08-13). core.ts는 렌더러라 에디션을 모르고
  //   `persisted.serverUrl ?? DEFAULT_SERVER_URL`로 떨어지는데, 그 DEFAULT가 literal 4000이었다.
  //   여기서 채워 주면 core.ts의 상수를 안 건드리고도 에디션 포트가 렌더러까지 흐른다.
  if (!authState.serverUrl) authState.serverUrl = 기본서버주소();
  event.returnValue = authState;
});
ipcMain.on("auth:setState", (_event, state: AuthState) => {
  authState = state;
});

// ── 로그인 히스토리(접근 서버·ID·PW) — 빠른 선택용 ─────────────────────────
// 서버 주소·아이디는 평문(민감정보 아님), 비밀번호는 OS 키체인(safeStorage/DPAPI)으로 암호화해
// userData 파일에 저장한다. 암호화가 불가한 환경(리눅스 키링 없음 등)에서는 비밀번호를 저장하지
// 않는다(서버·ID만). 목록 조회 시 비밀번호 평문은 절대 반환하지 않는다(선택 시 별도 복호화 요청).
interface LoginEntry { serverUrl: string; username: string; encPw: string | null; savedAt: number }
const CREDS_FILE = path.join(app.getPath("userData"), "gijo-logins.json");
function readCreds(): LoginEntry[] {
  try { return JSON.parse(fs.readFileSync(CREDS_FILE, "utf-8")) as LoginEntry[]; } catch { return []; }
}
function writeCreds(list: LoginEntry[]): void {
  try { fs.writeFileSync(CREDS_FILE, JSON.stringify(list.slice(0, 10)), "utf-8"); } catch { /* 저장 실패는 무시 */ }
}
const pwEncAvailable = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };

// 목록 — 최근순, 비밀번호 저장 여부(hasPw)만 노출(평문 아님).
ipcMain.handle("creds:list", () =>
  readCreds().sort((a, b) => b.savedAt - a.savedAt).map((e) => ({ serverUrl: e.serverUrl, username: e.username, hasPw: Boolean(e.encPw) }))
);
// 선택 시 그 항목의 비밀번호를 복호화해 돌려준다(로그인 폼 자동채움용).
ipcMain.handle("creds:getPassword", (_e, serverUrl: string, username: string) => {
  const hit = readCreds().find((e) => e.serverUrl === serverUrl && e.username === username);
  if (!hit || !hit.encPw || !pwEncAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(hit.encPw, "base64")); } catch { return ""; }
});
// 로그인 성공 시 저장(같은 서버·ID는 갱신·최상단). savePw=false면 비밀번호는 저장하지 않는다.
ipcMain.handle("creds:save", (_e, serverUrl: string, username: string, password: string, savePw: boolean) => {
  if (!serverUrl || !username) return;
  const list = readCreds().filter((e) => !(e.serverUrl === serverUrl && e.username === username));
  let encPw: string | null = null;
  if (savePw && password && pwEncAvailable()) {
    try { encPw = safeStorage.encryptString(password).toString("base64"); } catch { encPw = null; }
  }
  list.unshift({ serverUrl, username, encPw, savedAt: Date.now() });
  writeCreds(list);
});
ipcMain.handle("creds:remove", (_e, serverUrl: string, username: string) => {
  writeCreds(readCreds().filter((e) => !(e.serverUrl === serverUrl && e.username === username)));
});
ipcMain.handle("creds:pwSupported", () => pwEncAvailable());

/**
 * "단일 데스크톱 모드": 서버가 같은 배포 패키지에 동봉된 경우 클라이언트가 자체적으로
 * 서버를 localhost로 기동한다. 세 경로를 순서대로 찾는다:
 *   1) 패키징된 배포판 — electron-builder의 extraResources가 client/server-dist/를
 *      resources/server-dist/로 그대로 복사해 넣으므로 process.resourcesPath 아래를 찾는다.
 *   2) dev 환경에서 `npm run build-server-dist`로 client/server-dist/를 직접 만들어둔 경우.
 *   3) dev 환경에서 서버를 따로 안 빌드해 sibling ../server/dist만 있는 경우.
 * 사내망에 별도 서버(RTX 3090 머신)가 이미 떠 있는 "분산 모드"에서는 GIJO_SERVER_URL
 * 환경변수만 그 서버 주소로 지정하고 이 로직은 건너뛴다.
 *
 * 주의(네이티브 모듈 ABI): 이 스폰은 ELECTRON_RUN_AS_NODE로 Electron에 내장된 Node 런타임을
 * 쓴다(사용자 PC에 별도 Node.js 설치를 요구하지 않기 위해). server의 better-sqlite3(db.ts)는
 * 네이티브 애드온이라 시스템 Node ABI로 빌드된 바이너리는 여기서 로드에 실패한다
 * (ERR_DLOPEN_FAILED로 서버 프로세스가 즉시 죽고 로그인이 "서버 연결 끊김"으로 보임).
 * client/server-dist/는 `npm run build-server-dist`로 생성되며, 그 안의 better-sqlite3는
 * Electron ABI로 이미 재빌드되어 있다 — dev 환경에서 ../server/dist를 직접 쓸 때는
 * `npm run rebuild-server-native`로 그때그때 재빌드해야 한다(테스트/독립 실행과 ABI가
 * 상충하므로 되돌리려면 `cd server && npm rebuild better-sqlite3`).
 */
/**
 * **첫 설치인가** — 아직 DB가 없어서 관리자 계정이 만들어지기 전인가.
 *
 * ⚠ 반드시 **서버를 띄우기 전에** 판정한다. 서버가 뜨면 그 자리에서 DB가 생겨 판정이 뒤집힌다.
 * 왜 필요한가(2026-08-09 실측): 배포본이 고객 기계에 **jyh/changeme**를 만들고 있었다.
 * users.ts의 computeInitialAdmin은 「운영이면 랜덤 비번을 만들어 콘솔에 1회 출력」하는데,
 * 그 갈래는 NODE_ENV==="production"일 때만 돌고 **Electron은 그 값을 설정하지 않는다.**
 * 그래서 개발용 기본값이 그대로 고객에게 나갔다 — 게다가 고객 화면에 개발자 이름이 떴다.
 * 랜덤 비번으로 바꾸는 것만으로는 더 나빠진다: 그 값이 찍히는 **콘솔을 고객은 볼 수 없어**
 * 아예 못 들어간다. 그래서 **고객이 직접 정하게** 한다 — 보관할 비밀도, 잠기는 경우도 없다.
 */
let 첫설치 = false;
export function 첫설치인가(): boolean {
  return 첫설치;
}

/** 번들 서버의 자리와 실행 조건. **띄우지 않고** 계산만 한다(첫 설치 판정에 먼저 필요하다). */
function 번들서버구성(): { entry: string; serverRoot: string; dataRoot: string; env: NodeJS.ProcessEnv; 패키징본: boolean } | null {
  if (process.env.GIJO_SERVER_URL) return null; // 원격 서버를 명시적으로 지정한 경우 번들 서버 기동 안 함

  // ⚠ 라이트는 서버도 **라이트 진입점**으로 띄워야 한다(max 실물 확인 2026-08-13) —
  //   setToolAllowlist를 부르는 곳이 dist/lite/index.js **한 곳뿐**이라, 본 진입점으로 띄우면
  //   화면만 라이트고 **도구는 78개 그대로**다. 라이트 게이트 32/33이 뜻을 잃는 자리였다.
  //   라이트 진입점은 require("../index")로 본 서버를 그대로 올리고 도구만 줄인다 — 딴 분기 없음.
  const 서버몸통 = 에디션() === "lite" ? "dist/lite/index.js" : "dist/index.js";
  // ⚠ 진입점이 dist/ 한 단 아래가 아닐 수 있게 됐으므로(라이트는 dist/lite/), serverRoot를
  //   dirname 횟수로 셈하지 않고 **뿌리 후보를 찾고 진입점을 그 밑에서 조립**한다 —
  //   dirname(dirname()) 셈법이면 라이트의 뿌리가 dist/로 어긋나 data/가 엉뚱한 곳에 생긴다.
  const 뿌리후보 = [
    path.join(process.resourcesPath, "server-dist"), // 패키징된 배포판(extraResources)
    path.join(__dirname, "../server-dist"), // dev: npm run build-server-dist
    path.join(__dirname, "../../server"), // dev: sibling 폴더의 서버 직접 빌드
  ];
  const serverRoot = 뿌리후보.find((r) => fs.existsSync(path.join(r, 서버몸통)));
  if (!serverRoot) return null; // 서버가 동봉되지 않은 배포(순수 클라이언트)
  const 패키징경로 = path.join(뿌리후보[0], 서버몸통);
  // cwd를 고정한다 — db.ts/memory.ts가 "data/..." 같은 상대경로를 쓰기 때문에, 지정하지 않으면
  // Electron이 실행된 위치에 따라 데이터가 엉뚱한 곳에 생긴다.
  const bundledServerEntry = path.join(serverRoot, 서버몸통);

  // ⚠ **패키징본에서는 serverRoot에 쓰면 안 된다** — 그 자리가 앱 번들 **안**이다.
  //   2026-08-09 mac 실측(첫 실행 한 번):
  //     /Applications/GIJO AS.app/Contents/Resources/server-dist/data/
  //       gijo-as.sqlite(마이그레이션 37건) · -wal 3.1MB · kev.json · memory.lancedb · backups/
  //     codesign --verify → "a sealed resource is missing or invalid"
  //   따라오는 피해가 셋이다:
  //     ① **업데이트가 고객 데이터를 지운다** — 새 .app으로 교체하면 DB가 통째로 없어진다.
  //        가장 확실하고 무거운 쪽이다.
  //     ② **코드 서명 봉인이 첫 실행에 깨진다** — 같은 날 XProtect가 앱을 「악성」으로 보고
  //        휴지통에 넣었던 그 상태다(client/build/mac-adhoc-sign.cjs 주석 참고). 승인된
  //        앱은 당장 지워지지 않았지만, 다시 격리되는 경로(백업 복원·재다운로드·다른 기계로
  //        이동)에서 되살아난다. verify가 실패하는 앱은 MDM·EDR 점검에서도 변조로 잡힌다.
  //     ③ 쓰기 권한이 없는 자리(관리되는 Mac, Windows의 Program Files)에서는 아예 못 뜬다.
  //
  //   그래서 패키징본만 **사용자별 쓰기 가능한 자리**(userData)로 보낸다. 읽기 전용 자산
  //   (docs/·docs-manifest.json)은 여전히 번들 안이므로 환경변수로 그 자리를 알려 준다 —
  //   그 우회로는 서버에 이미 있었다(knowledgebundle.ts·docsbundle.ts·docbox.ts).
  //
  // ⚠ dev에서는 **바꾸지 않는다.** dev의 serverRoot는 server/(또는 client/server-dist/)라
  //   원래 맞는 자리고, 여기서 userData로 옮기면 담당자가 쓰던 개발 DB를 못 보게 된다.
  const 패키징본 = bundledServerEntry === 패키징경로;
  // ⚠ **라이트 모드로 전환한 스탠다드 배포본은 데이터 폴더를 가른다**(사장님 결정 2026-08-13).
  //   스탠다드로 쌓은 회사 데이터(자산·결재)가 라이트 화면엔 안 보이고, 라이트로 만든 것이
  //   스탠다드에 섞이면 같은 DB에 **도구 13개와 78개가 번갈아** 답하게 된다.
  //   ⚠ 라이트 **전용** 배포본은 앱 이름이 달라 userData가 이미 따로다 — 거기서 또 가르면
  //     지금 도는 라이트 dmg의 데이터가 하루아침에 안 보인다. 그래서 **전환한 경우만** 가른다.
  const dataRoot = 패키징본
    ? (라이트모드전환() ? path.join(app.getPath("userData"), "lite") : app.getPath("userData"))
    : serverRoot;
  // ⚠ 포트를 **spawn env로 넘긴다** — server/src/index.ts:42가 `GIJO_SERVER_PORT ?? 4000`이라
  //   env가 이긴다. 서버 쪽 기본값(4000)은 손대지 않는다(직접 띄우는 개발 경로를 안 깨려고).
  //   서버포트()가 이미 process.env 지정을 존중하므로 여기서 또 갈래를 두지 않는다.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    GIJO_SERVER_PORT: String(서버포트()),
  };
  if (패키징본) {
    try { fs.mkdirSync(dataRoot, { recursive: true }); } catch { /* 이미 있으면 그만 */ }
    env.GIJO_DOCS_DIR = path.join(serverRoot, "docs");
    env.GIJO_DOCS_MANIFEST = path.join(serverRoot, "docs-manifest.json");
  }
  return { entry: bundledServerEntry, serverRoot, dataRoot, env, 패키징본 };
}

/** 서버가 쓸 DB 파일의 실제 경로 — 첫 설치 판정과 암호화 전환이 **같은 것**을 봐야 한다. */
function DB경로(구성: { dataRoot: string; env: NodeJS.ProcessEnv }): string {
  return path.resolve(구성.dataRoot, 구성.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite"));
}

function maybeStartBundledServer(추가환경?: NodeJS.ProcessEnv): void {
  const 구성 = 번들서버구성();
  if (!구성) return;
  const env = { ...구성.env, ...(추가환경 ?? {}) };
  // 계산한 값을 **그대로 보관한다.** 저장 암호화 전환(dbcrypt:enable)이 같은 DB를 봐야 하는데,
  // 규칙을 그쪽에 한 번 더 적으면 언젠가 어긋나 **딴 DB를 암호화한다.**
  번들서버 = { ...구성, env };
  bundledServerProcess = spawn(process.execPath, [구성.entry], {
    cwd: 구성.dataRoot,
    env,
    stdio: "inherit",
  });
}

// ── 저장 암호화 켜기 (앱이 직접 서버를 띄운 경우에만) ──────────────────────────
//
// 왜 앱이 해야 하나 (2026-08-09 실측): 새로 설치한 앱의 DB를 **열쇠 없이 그대로 읽었다.**
// 설정 화면은 정직하게 「꺼져 있습니다」라고 말하고 켜는 방법도 안내하는데, 그 방법이
// "서버를 멈추고 node scripts/encrypt-db.mjs 실행"이었다. 올인원 고객에게는
//   · 따로 멈출 서버가 없고(앱이 곧 서버다)
//   · 터미널을 여는 흐름이 없고
//   · 애초에 그 스크립트가 배포본에 들어 있지도 않았다
// 즉 **따를 수 없는 안내**였다. 서버를 쥐고 있는 것은 이 앱이므로, 멈추고·전환하고·다시
// 띄우는 일을 앱이 한다. 전환 자체는 이미 검증된 scripts/encrypt-db.mjs를 그대로 쓴다 —
// 백업 → 열쇠 생성 → rekey → 행 수 대조 검증 → 실패 시 백업으로 자동 복원이 그 안에 있다.
// 여기서 암호화를 새로 구현하지 않는다.
function 전환스크립트경로(): string | null {
  if (!번들서버) return null;
  const p = path.join(번들서버.serverRoot, "scripts", "encrypt-db.mjs");
  return fs.existsSync(p) ? p : null;
}

ipcMain.handle("dbcrypt:canEnableInApp", () => {
  if (!번들서버) return { can: false, why: "이 앱이 서버를 띄우지 않았습니다 — 분산 모드(사내 서버)에서는 서버 쪽에서 켜야 합니다." };
  if (!전환스크립트경로()) return { can: false, why: "전환 도구가 이 설치에 없습니다." };
  return { can: true };
});

ipcMain.handle("dbcrypt:enable", async () => {
  const 스크립트 = 전환스크립트경로();
  if (!번들서버 || !스크립트) return { ok: false, error: "이 설치에서는 켤 수 없습니다." };

  // ① 서버를 멈춘다 — DB를 쥔 채로 rekey하면 안 된다.
  if (bundledServerProcess) {
    bundledServerProcess.kill();
    bundledServerProcess = null;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ② 전환. DB 경로는 **서버가 쓰는 것과 같은 규칙**으로 정한다(어긋나면 딴 DB를 암호화한다).
  const dbPath = 번들서버.env.GIJO_DB_PATH ?? path.join("data", "gijo-as.sqlite");
  const 결과 = await new Promise<{ code: number; out: string }>((resolve) => {
    const p = spawn(process.execPath, [스크립트, "--db", dbPath], {
      cwd: 번들서버!.dataRoot,
      env: { ...번들서버!.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout?.on("data", (d) => (out += String(d)));
    p.stderr?.on("data", (d) => (out += String(d)));
    p.on("close", (code) => resolve({ code: code ?? -1, out }));
  });

  // ③ 서버를 다시 띄운다 — 성공이든 실패든 **반드시** 한다. 여기서 안 띄우면 앱이 먹통이 된다.
  maybeStartBundledServer();

  if (결과.code !== 0) {
    // 스크립트가 검증에 실패하면 스스로 백업으로 되돌린다 — 여기서 손대지 않는다.
    return { ok: false, error: (결과.out.split("\n").filter(Boolean).pop() ?? "전환 실패").slice(0, 300) };
  }

  // ④ 복구 열쇠를 뽑는다. **위치가 아니라 형식으로** 찾는다 — 안내 문구가 바뀌어도 견딘다.
  //    형식은 실측으로 확인했다: 5자 6묶음(EEFSF-KUD7C-MATSB-RMMDY-UAHQN-8YYXS).
  const recoveryKey = /\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){5}\b/.exec(결과.out)?.[0] ?? null;
  return {
    ok: true,
    recoveryKey, // null이면 전환은 됐는데 열쇠를 못 읽은 것 — 화면이 그렇게 말한다
    note: recoveryKey ? null : "전환은 끝났지만 복구 열쇠를 화면에 옮기지 못했습니다. 설정에서 «복구 열쇠 재발급»으로 새로 받으세요.",
  };
});

// ── 첫 설치: 관리자 계정을 **고객이 정한다** ────────────────────────────────
// 서버는 이미 GIJO_INITIAL_ADMIN_USERNAME/PASSWORD 를 받게 돼 있다(users.ts). 여기서는
// 그 값을 받아 서버를 띄우기만 한다 — 서버 코드는 고치지 않는다.
ipcMain.handle("setup:needed", () => 첫설치인가());
ipcMain.handle("setup:createAdmin", async (_e, username: string, password: string) => {
  if (!첫설치) return { ok: false, error: "이미 설정이 끝났습니다." };
  const id = String(username ?? "").trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(id)) return { ok: false, error: "아이디는 영문·숫자와 . _ - 만 쓸 수 있고 3~32자입니다." };
  const pw = String(password ?? "");
  // 제품 최소는 8자다. 화면에서 12자 이상을 권하되, 여기서는 제품 규칙보다 엄하게 막지 않는다 —
  // 두 곳이 다르면 화면이 통과시킨 값을 여기서 되돌려보내는 일이 생긴다.
  if (pw.length < 8) return { ok: false, error: "비밀번호는 8자 이상이어야 합니다." };

  maybeStartBundledServer({ GIJO_INITIAL_ADMIN_USERNAME: id, GIJO_INITIAL_ADMIN_PASSWORD: pw });

  // 계정이 만들어질 때까지 기다린다 — 여기서 안 기다리면 로그인 화면이 먼저 떠서 실패한다.
  // ⚠ 포트는 **서버포트() 한 곳**에서 온다(2026-08-13). 예전엔 여기·렌더러·login 안내문에
  //   `4000`이 따로 박혀 있었고, 하나만 어긋나면 첫 로그인이 **조용히** 실패했다.
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${서버포트()}/api/health`);
      if (r.ok) { 첫설치 = false; return { ok: true }; }
    } catch { /* 아직 안 떴다 */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, error: "서버가 뜨지 않았습니다. 앱을 다시 실행해 주세요." };
});

// 본 창 크기 — 화면(작업영역)에 맞춘다.
// ⚠ 예전에는 1440×900·최소 1180으로 숫자가 박혀 있었다. 세로 모니터(예: 1080×1920)에서는
//    창이 화면보다 넓게 열리려다 잘리고, 최소 너비(1180)가 화면 너비(1080)보다 커서
//    담당자가 창을 화면에 맞게 줄일 수조차 없었다(2026-07-27 실측). 사무실 창은 이미
//    작업영역을 보고 여는데 본 창만 안 하고 있었다 — 같은 방식으로 맞춘다.
function mainWindowBounds(): { width: number; height: number; minWidth: number; minHeight: number } {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  return {
    // 넉넉한 화면이면 1440×900을 넘지 않고, 좁은 화면이면 화면에 맞춘다(가장자리 여백 40px).
    width: Math.max(720, Math.min(1440, wa.width - 40)),
    height: Math.max(600, Math.min(900, wa.height - 40)),
    // 최소 크기는 화면보다 클 수 없다 — 크면 창을 화면 안에 넣을 방법이 없어진다.
    minWidth: Math.min(900, Math.max(600, wa.width - 40)),
    minHeight: Math.min(620, Math.max(480, wa.height - 40)),
  };
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    ...mainWindowBounds(),
    backgroundColor: "#262624",
    title: "GIJO AS — AI Security Manager OS",
    // C안(2026-07-25): OS 타이틀바 제거 — 각 페이지의 .header가 타이틀바 역할(드래그 영역, titlebar.js).
    // 창 컨트롤(─ ▢ ✕)은 OS가 오버레이로 그린다(직접 구현 안 함). mac은 신호등이 좌측 인셋.
    // ⚠ 최대화(▢)는 **켜 둔다**. 하루 안에 두 번 뒤집힌 자리라 사연을 남긴다(2026-08-02):
    //   ① "네모는 없어도 될 것 같다" → maximizable:false로 껐다.
    //   ② "전체화면이 없으니 불편, 상단 두 번 누르면 전체화면" → 최대화가 도로 필요해졌다.
    //   Windows의 titleBarOverlay는 세 버튼(─ ▢ ✕)을 **통째로** 그려 ▢만 골라 숨길 수 없다.
    //   숨기려면 오버레이를 걷고 ─·✕까지 직접 그려야 한다(닫기까지 우리 책임이 된다).
    //   "그냥 네모칸 넣자"는 결정으로 OS에 맡긴다 — 제목 줄 더블클릭 최대화도 이때 같이 살아난다.
    maximizable: true,
    titleBarStyle: "hidden",
    // 높이 44 = 셸 탭줄(.tabbar) 높이(2026-08-07 상단 통합 — 조작줄을 없애 탭줄이 곧 상단 바다).
    titleBarOverlay: { color: "#1f1e1d", symbolColor: "#b3ada4", height: 44 }, // 상단 바와 같은 색이어야 한 줄로 보인다
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 허브 탭(hub.html)이 기존 페이지를 iframe으로 품는다 — 서브프레임에도 preload(window.gijo)를
      // 주입해야 탭 안의 페이지가 동작한다(메뉴 C안 통합, 2026-07-23).
      nodeIntegrationInSubFrames: true,
    },
  });

  // 상단 기본 메뉴바(File, Edit, View, Window, Help) 제거
  mainWindow.removeMenu();

  // 저장된 화면 크기(배율)를 이 창에 적용 — 페이지를 옮겨도 유지되게 did-finish-load에 묶는다.
  bindZoom(mainWindow);

  // 최초 화면은 로그인. 인증 성공 후 renderer/core.ts가 대시보드로 전환한다.
  // 첫 설치면 로그인 대신 **관리자 계정 만들기**부터다 — 계정이 없는데 로그인 화면을 띄우면
  // 고객은 들어갈 방법이 없다(예전엔 개발용 jyh/changeme가 그 자리를 메우고 있었다).
  mainWindow.loadFile(
    path.join(__dirname, `../src/renderer/pages/${첫설치인가() ? "setup.html" : "login.html"}`)
  );

  // 대시보드(메인) 창 닫기 확인(2026-07-26 사용자 요청) — 진행 중 대화·열린 팝업이 있는 채로
  // 실수로 X를 눌러 통째로 잃는 것을 막는다. 팝업·사무실·분리 창은 해당 없음(닫아도 잃을 게 없다).
  // 앱 재시작(app:restart)·업데이트 설치는 quitConfirmed로 확인 없이 지나간다.
  mainWindow.on("close", (e) => {
    if (quitConfirmed || !mainWindow) return;
    const r = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      buttons: ["닫기", "취소"],
      defaultId: 1,
      cancelId: 1,
      title: "GIJO AS 종료",
      message: "GIJO AS를 닫을까요?",
      detail: "진행 중인 대화와 열린 팝업 화면이 함께 닫힙니다.\n대화는 작업 세션에 저장돼 다음 접속 때 이어볼 수 있습니다.",
    });
    if (r !== 0) {
      e.preventDefault();
      return;
    }
    quitConfirmed = true;
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── 에디션 판별 — 이 배포본이 라이트인가 (2026-08-13) ─────────────────────────
//
// ■ 왜 필요한가
//   로그인 성공 뒤 `login.html:302`가 **app.html로 못박아** 부른다. 라이트는 화면이 9개인데
//   app.html은 40개짜리 탭 셸이라, 그대로 두면 **도구는 13개인데 화면은 40개**가 보인다 —
//   「없는 기능이 보이는」 가장 나쁜 조합이다(max 지적, a83cf52).
//
// ■ ⚠ 왜 `GIJO_EDITION` 환경변수만 보지 않는가 — **패키징본에서는 아무도 그걸 안 넣는다.**
//   그 이름은 저장소에 **문서에만** 있었고(서버 쪽 설계 문서·인계 메모), 클라 빌드·실행
//   어디에도 설정하는 곳이 없다. electron-builder는 앱 실행 환경변수를 심는 물건이 아니다.
//   env만 보고 분기했으면 **패키징본에서 항상 거짓** — 고쳤다고 믿는데 안 고쳐진 자리가 된다.
//   그래서 **빌드 산출물 안에 글로 남긴다**: `electron-builder.lite.json`의 `extraMetadata`가
//   라이트 빌드의 package.json에만 `gijoEdition: "lite"`를 박는다. 지우려면 빌드 설정을
//   고쳐야 하므로 실수로 사라지지 않는다.
//   env는 **개발 중 흉내내기**용으로만 남긴다(`GIJO_EDITION=lite npm start`).
/** 빌드에 박힌 에디션 — 라이트 전용 배포본은 여기서 **잠긴다**(고객이 못 바꾼다). */
function 빌드에디션(): string {
  // __dirname은 dev에서 client/dist, 패키징본에서 app.asar/dist — 둘 다 ../package.json이다.
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")).gijoEdition ?? "";
  } catch { return ""; }
}

/** 런타임 선택(스탠다드 배포본에서 「라이트 모드」를 고른 경우)을 담아 두는 자리. */
const 에디션파일 = () => path.join(app.getPath("userData"), "gijo-edition.txt");
function 저장된에디션(): string {
  try { return fs.readFileSync(에디션파일(), "utf8").trim(); } catch { return ""; }
}

/**
 * 이 실행이 라이트인가 (2026-08-13 — 사장님 지시 2번: 기존 클라에 라이트 모드를 「선택 사항」으로).
 *
 * 우선순위: ① env(개발 흉내내기) → ② **빌드 고정**(라이트 전용 배포본은 잠김) → ③ 런타임 선택
 *
 * ⚠ ②가 ③보다 먼저인 것이 핵심이다. 라이트 전용 dmg는 package.json이 `lite`라 **항상 라이트**이고
 *   고객이 못 바꾼다(그게 그 상품이다). 런타임 선택은 **스탠다드 배포본에서만** 뜻을 갖는다.
 * ⚠ 부팅 때 한 번만 읽는다(캐시) — 서버 도구 13 vs 78과 진입점이 **부팅 때** 갈리므로,
 *   모드 변경은 **재시작을 요구**한다. 실행 중에 바꿔 봐야 반만 바뀌어 더 나쁘다.
 */
let 에디션캐시: string | null = null;
function 에디션(): string {
  if (에디션캐시) return 에디션캐시;
  let 값 = process.env.GIJO_EDITION ?? "";
  if (!값) 값 = 빌드에디션();                    // ② 라이트 전용 배포본은 여기서 잠긴다
  if (!값) 값 = 저장된에디션();                  // ③ 스탠다드 배포본의 런타임 선택
  에디션캐시 = 값 === "lite" ? "lite" : "standard";
  return 에디션캐시;
}

/**
 * **스탠다드 배포본이 런타임으로 라이트를 고른 상태**인가 — 데이터 폴더를 가르는 기준.
 *
 * ⚠ 라이트 **전용** 배포본은 앱 이름이 달라 userData가 이미 따로다 — 여기서 또 가르면
 *   지금 도는 라이트 dmg의 데이터가 하루아침에 안 보인다. 그래서 **전환한 경우만** 가른다.
 */
function 라이트모드전환(): boolean {
  return 에디션() === "lite" && 빌드에디션() !== "lite";
}

// 라이트 모드 전환 읽기·쓰기 — 화면(설정)이 이 통로로 켜고 끈다.
// ⚠ **화면은 아직 없다.** 스위치 UI는 시안 승인 후에 얹는다(UI는 시안 1개 먼저가 이 제품의 규칙).
//   여기까지가 「자리를 여는」 몫이고, BridgeAI 1단계와 같은 구조다.
ipcMain.handle("edition:get", () => ({
  현재: 에디션(),
  빌드고정: 빌드에디션() === "lite",   // true면 라이트 전용 배포본 — 고객이 못 바꾼다
  전환됨: 라이트모드전환(),
}));
// ── 프로 판정(사장님 결정 2026-08-18: 「프로 판정부터 먼저 만들기」) ──────────────
//
// ⚠ **에디션에 「pro」를 더하지 않는다.** 둘은 다른 축이다:
//     · 에디션(lite/standard) = **어떤 상품인가.** 데이터 폴더·진입점·도구 개수(13 vs 78)를 가른다.
//     · 셸 모드(standard/pro) = **화면을 어떻게 그리나.** 프로는 도구도 데이터도 스탠다드와 같다.
//   같은 칸에 넣으면 프로를 고른 순간 데이터 폴더가 갈리거나 도구가 줄어든다 — 아무도 원치 않는 일이다.
//   (2026-08-18 착수 전 검토가 짚은 자리: 「프로는 edition이 아니라 tier」.)
//
// ⚠ **서버 등급을 못 읽었다고 스탠다드로 단정하지 않는다.** 서버가 잠깐 죽었을 뿐인데
//   셸이 통째로 바뀌면 담당자는 제품이 고장 난 줄 안다. 마지막으로 확인된 값을 그대로 쓴다.
const 셸모드파일 = () => path.join(app.getPath("userData"), "gijo-shell-mode.txt");
function 저장된셸모드(): string {
  try {
    const v = fs.readFileSync(셸모드파일(), "utf8").trim();
    return v === "standard" ? "standard" : "pro";
  } catch { return "pro"; } // 기본=프로(사장님 2026-08-19 「표준은 프로」 — 프로가 기준 모델)
}
ipcMain.handle("shell:get", () => ({
  현재: 저장된셸모드(),
  // 라이트는 자기 셸(lite-app.html)이 따로라 프로 셸이 뜻이 없다 — 화면이 이걸 보고 감춘다.
  쓸수있나: 에디션() !== "lite",
}));
ipcMain.handle("shell:set", (_e, 모드: string) => {
  if (에디션() === "lite") return { ok: false, error: "라이트에서는 프로 셸을 쓸 수 없습니다." };
  const 값 = 모드 === "pro" ? "pro" : "standard";
  try { fs.writeFileSync(셸모드파일(), 값, "utf8"); }
  catch (e) { return { ok: false, error: `셸 모드를 저장하지 못했습니다: ${(e as Error).message}` }; }
  // ⚠ 에디션과 달리 **재시작을 요구하지 않는다** — 셸 모드는 화면 그리기일 뿐이라
  //   진입점·도구가 안 바뀐다. 화면이 그 자리에서 다시 그리면 된다.
  return { ok: true, 현재: 값 };
});

ipcMain.handle("edition:set", (_e, 모드: string) => {
  if (빌드에디션() === "lite") return { ok: false, error: "이 배포본은 라이트 전용이라 모드를 바꿀 수 없습니다." };
  const 값 = 모드 === "lite" ? "lite" : "standard";
  try {
    fs.writeFileSync(에디션파일(), 값, "utf8");
  } catch (e) {
    return { ok: false, error: `모드를 저장하지 못했습니다: ${(e as Error).message}` };
  }
  // ⚠ 캐시를 지우지 않는다 — 이 실행에서 바꾸면 진입점·도구는 그대로인 채 화면만 바뀌어
  //   「도구 13개인데 화면 40개」의 거울상이 된다. **다음 실행부터** 적용된다고 알린다.
  return { ok: true, 재시작필요: true, 다음실행: 값 };
});
/**
 * 라이트에서 열어도 되는 화면인가.
 *
 * ■ 왜 접두사로 가르나 — `lite-screens.json`이 화면 9개의 **단일 출처**이고, 그 규칙이
 *   「화면 파일은 전부 `lite-` 접두사로 새로 만든다」이다. 여기서 그 목록을 다시 읽으면
 *   **같은 것을 두 곳에 적는 것**이 된다(이 저장소가 반복해 겪은 유형). 그래서 여기는
 *   **거친 문지기**만 한다 — `lite-*`인가. 정확한 9개 대조는 셸 안에서 `lite-nav.js`가
 *   이미 하고 있다(없는 화면이면 안 열고 경고). 두 겹이지만 **출처는 하나**다.
 * ■ setup·login은 에디션과 무관한 **입구**다. 막으면 첫 실행과 로그아웃이 죽는다.
 */
function 라이트에서열수있나(file: string): boolean {
  return file.startsWith("lite-") || file === "login.html" || file === "setup.html";
}
/**
 * 라이트에서 본 제품 화면으로 가는 것을 막는다.
 *
 * ■ 왜 필요한가 — 라이트는 도구가 13개인데 본 제품 화면은 40개다. 한 곳이라도 새면
 *   **없는 기능이 보이는** 가장 나쁜 조합이 된다(그 화면들은 회사 데이터를 전제해 「없습니다」만 낸다).
 * ■ 사람에게 따로 안내하지 않고 라이트 셸로 되돌린다 — 여기 걸린다는 건 **코드가 잘못 부른 것**이라
 *   들을 사람은 담당자가 아니라 개발자다. 그래서 경고는 로그로 남긴다.
 *   (담당자가 누를 수 있는 자리는 셸 안이고, 거기선 lite-nav.js가 이미 「라이트에 없는 화면」이라 알린다.)
 * ⚠ 남은 구멍: 별도 창(office·docbox·console)은 `navigate:to`를 안 거친다. 라이트 셸에 그 버튼이
 *   없어 지금은 안 닿지만, 라이트에서 그 창을 열 길이 생기면 여기와 같은 문지기가 필요하다.
 */
function 셸화면보정(file: string): string {
  if (에디션() !== "lite") return file;
  if (file === "app.html") return "lite-app.html";
  if (!라이트에서열수있나(file)) {
    console.warn(`[navigate] 라이트에 없는 화면 ${file} → lite-app.html로 되돌림`);
    return "lite-app.html";
  }
  return file;
}

ipcMain.handle("navigate:to", async (_e, page: string) => {
  if (!mainWindow) return;
  // 파일 경로와 쿼리를 분리해 loadFile에 넘긴다(settings.html?s=ai 같은 구역 딥링크 지원).
  const [요청파일, qs] = String(page).split("?");
  const file = 셸화면보정(요청파일);
  // 로그아웃·인증 만료(login.html)면 별도 창들을 **함께** 닫는다(2026-08-20 검토관 중간6) —
  // 본창만 로그인으로 돌아가고 팝업·대화·사무실 창이 남으면 사내 데이터가 화면에 그대로
  // 떠 있다(서버 세션은 끊겼어도 이미 그려진 내용은 보인다). 보안 경계라 예외 없이 닫는다.
  if (file === "login.html") {
    for (const w of popoutWindows.values()) { try { if (!w.isDestroyed()) w.close(); } catch { /* 이미 닫힘 */ } }
    try { if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.close(); } catch { /* 이미 닫힘 */ }
    try { if (officeWindow && !officeWindow.isDestroyed()) officeWindow.close(); } catch { /* 이미 닫힘 */ }
  }
  // ★ 프로 셸 이탈 금지(2026-08-19 사장님 실사고 — 「발견·수집을 누르니 표준 모드로 돌아가네」):
  //   구식 통로(navigateTo 폴백)가 본창을 화면 파일로 **직접** 로드하면 프로 셸이 통째로
  //   파괴되고 표준 사이드바 모양이 뜬다. 본창이 셸(app.html)로 떠 있는 한, 화면 파일 요청은
  //   전부 **셸의 탭 열기로 승격**한다 — 발원지가 몇이든 여기 한 곳이 막는다.
  //   ⚠ 단 login.html은 승격하지 않는다(2026-08-20 정찰 발견) — 로그아웃·인증 만료는
  //   본창을 로그인으로 **통째 교체**하는 것이 맞다. 승격하면 로그인이 셸 탭으로 열려
  //   로그아웃이 안 되는 화면이 된다(preload.ts navigateTo의 login 예외와 같은 이유).
  if (file !== "app.html" && 저장된셸모드() === "pro" && file !== "login.html" && mainWindow.webContents.getURL().includes("app.html")) {
    mainWindow.webContents.send("shell:openTabPush", { page: String(page) });
    mainWindow.focus();
    return;
  }
  const query: Record<string, string> = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  // ── 프로 셸 신호를 **주소에 실어** 보낸다(2026-08-18) ──────────────────────
  //
  // ⚠ **비동기로는 늦는다.** 프로 여부의 출처는 `shell:get`인데 그건 Promise다.
  //   그런데 app.html이 console.js→nav.js→titlebar.js를 **동기로** 싣고, 그것들이
  //   그 자리에서 사이드바와 상단 단추를 다 그린다. 값이 도착할 때는 이미 표준 모양으로
  //   그려진 뒤라 다시 그리면 **표준으로 깜빡였다가 프로로 바뀐다.**
  // ⚠ 그래서 `embed=1`·`popout=1`과 **같은 관례**를 쓴다 — 주소에 실으면 스크립트가
  //   첫 줄에서 동기로 읽는다. 새 통로를 만들지 않는다.
  if (file === "app.html" && 저장된셸모드() === "pro") query.shell = "pro";
  let target = path.join(__dirname, `../src/renderer/pages/${file}`);
  // 없는 화면의 안전망(2026-07-29 검토 #8) — 삭제된 화면(hub.html 등)을 옛 바로가기·링크가
  // 부르면 loadFile이 실패해 흰 오류 화면이 뜬다. 예전엔 nav.js의 리다이렉트가 안전망인 척
  // 했지만 파일이 없으면 nav.js 자체가 실리지 못한다 — 안전망은 로드 전에, 여기서만 가능하다.
  if (!fs.existsSync(target)) {
    // ⚠ 안전망도 에디션을 따른다 — 라이트에서 없는 화면을 부르면 본 제품 셸로 떨어지던 자리다.
    const 셸 = 셸화면보정("app.html");
    console.warn(`[navigate] 없는 화면 ${file} → ${셸}로 대체`);
    target = path.join(__dirname, `../src/renderer/pages/${셸}`);
    await mainWindow.loadFile(target);
    return;
  }
  // ⚠ `qs`(원래 주소에 쿼리가 있었나)가 아니라 **지금 실을 것이 있나**를 본다.
  //   예전엔 `qs ? {query} : undefined`였는데, 그러면 우리가 위에서 붙인 `shell=pro`가
  //   **원래 쿼리가 없을 때 통째로 버려진다** — `navigateTo("app.html")`이 바로 그 경우다.
  //   실측(2026-08-18): 프로로 바꿔도 주소에 안 실려 셸이 표준 그대로 떴다.
  await mainWindow.loadFile(target, Object.keys(query).length ? { query } : undefined);
});

// "우리 AI 팀 사무실" 별도 창 — 이미 열려 있으면 앞으로만 가져온다(중복 창 방지).
// 인증 토큰은 메인 프로세스 authState에 있으므로(위 auth:getState) 새 창도 로그인 상태를 공유한다.
ipcMain.handle("office:open", async () => {
  if (officeWindow && !officeWindow.isDestroyed()) {
    officeWindow.focus();
    return;
  }
  officeWindow = new BrowserWindow({
    // 2열(할일 236 · 사무실) 기준 — 브리핑 열(250px)은 2026-08-06 대화창 이동으로 빠졌다.
    // (예전 3열 기준 1360/1080은 2026-07-26 결정 — 열이 빠진 만큼 260px 줄인다.)
    // 화면이 작으면 그 화면에 맞춰 줄인다 — 창이 화면 밖으로 나가는 게 더 나쁘다.
    width: Math.min(1100, Math.max(900, screen.getPrimaryDisplay().workAreaSize.width - 120)),
    height: Math.min(840, Math.max(700, screen.getPrimaryDisplay().workAreaSize.height - 120)),
    minWidth: 820,
    minHeight: 620,
    backgroundColor: "#262624",
    title: "GIJO AS — 우리 AI 팀 사무실",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  officeWindow.removeMenu();
  bindZoom(officeWindow); // 사무실 창도 같은 화면 크기를 따른다
  officeWindow.on("closed", () => { officeWindow = null; });
  await officeWindow.loadFile(path.join(__dirname, "../src/renderer/pages/office.html"));
});

// 문서함 — 가이드·아키텍처를 읽는 별도 창. 제품 화면 탭 안에 넣지 않는다:
// 문서를 옆에 띄워두고 제품을 조작할 수 있어야 한다(사용자 지시 2026-07-30
// "클라이언트 실행시 별도로 사용 — 제품 안에서 동작하는 게 아니고").
ipcMain.handle("docbox:open", async () => {
  if (docboxWindow && !docboxWindow.isDestroyed()) {
    docboxWindow.focus();
    return;
  }
  docboxWindow = new BrowserWindow({
    // 2단(목차 250 + 본문)이라 좁으면 표가 깨진다. 화면이 작으면 그 화면에 맞춘다.
    width: Math.min(1180, Math.max(920, screen.getPrimaryDisplay().workAreaSize.width - 200)),
    height: Math.min(860, Math.max(640, screen.getPrimaryDisplay().workAreaSize.height - 140)),
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#262624",
    title: "GIJO AS — 문서함",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  docboxWindow.removeMenu();
  bindZoom(docboxWindow); // 문서함도 같은 화면 크기(배율)를 따른다
  docboxWindow.on("closed", () => { docboxWindow = null; });
  await docboxWindow.loadFile(path.join(__dirname, "../src/renderer/pages/docbox.html"));
});

// ── GIJO Smart MD Studio — 로그인한 고객에게 주는 **무료 문서 작성 도구** ────────────────
//
// ■ 사장님 결정(2026-08-14): 「클라이언트에서 로그인할 때 제공되는 무료 툴로 같이 배포하고
//   사용할 수 있게끔」. 전 에디션 공통이다(라이트·스탠다드·프로).
//
// ■ 왜 별도 창인가 — 탭(iframe) 안에 넣지 않는다. ① Smart MD는 자기 단축키·붙여넣기 처리·
//   전체화면 편집을 전제한 **독립 편집기**다 ② app.html의 healFrames가 탭 iframe을 되살리며
//   다시 로드하는데, 편집 중이던 글이 그때 날아간다 ③ 문서를 옆에 띄워 두고 GIJO를 조작하는
//   쓰임이 문서함·사무실 창과 같다. 그 셋과 같은 패턴을 쓴다.
//
// ■ 없어도 GIJO가 돈다(사장님 원칙 ④ — 포함이 아니라 연동). 자산은 게시 때
//   scripts/fetch-smartmd.mjs가 원본 저장소에서 받아 담는다. 개발 트리에 없을 수 있으므로
//   **없으면 조용히 죽지 않고 사람이 읽을 안내**를 준다.
//
// ⚠ 라이트 문지기: 이 창은 셸화면보정을 안 거친다(navigate:to가 아니다). Smart MD는
//   **전 에디션 공통 무료 도구**라 라이트에서 열려도 맞다 — 막지 않는 것이 의도다.
//   (라이트에 없는 *제품* 화면을 별도 창으로 여는 길이 생기면 그때는 문지기가 필요하다.)
function smartMdIndex(): string {
  // 설치본에서는 asar 안(app/smartmd), 개발에서는 client/smartmd.
  return path.join(__dirname, "../smartmd/index.html");
}

ipcMain.handle("smartmd:open", async () => {
  const index = smartMdIndex();
  if (!fs.existsSync(index)) {
    return {
      ok: false,
      error: "Smart MD Studio가 이 설치본에 담겨 있지 않습니다. 개발 중이라면 client 폴더에서 `node scripts/fetch-smartmd.mjs`를 한 번 실행하세요.",
    };
  }
  if (smartMdWindow && !smartMdWindow.isDestroyed()) {
    smartMdWindow.focus();
    return { ok: true, reused: true };
  }
  smartMdWindow = new BrowserWindow({
    // 원본 앱의 기본 크기(1300×900)를 따르되, 작은 화면에서는 그 화면에 맞춘다.
    width: Math.min(1300, Math.max(900, screen.getPrimaryDisplay().workAreaSize.width - 120)),
    height: Math.min(900, Math.max(640, screen.getPrimaryDisplay().workAreaSize.height - 120)),
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#262624",
    title: "GIJO Smart MD Studio — 문서 작성(무료 제공)",
    webPreferences: {
      // ⚠ 제품 preload를 붙이지 않는다(검토관 지적 H6). 제품 preload는 로드 시점에 토큰을
      //   복원해 **인증된 전 API**(터미널·파일·서버 전 라우트)를 그 창에 준다. 이 창에 실리는
      //   코드는 **다른 저장소에서 받아온 것**이라, 저쪽 push 한 번이 그 전부를 얻게 된다.
      //   그래서 이 창만 쓰는 최소 preload를 둔다 — gijoDesktop 두 함수뿐이다.
      preload: path.join(__dirname, "smartmd-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // ⚠ **전용 세션**에 가둔다(2026-08-14). 아래 CSP를 기본 세션에 걸면 GIJO 화면 전체가
      //   그 규칙을 받는다 — 그건 이 창 하나를 막으려다 제품을 막는 일이다.
      //   덤으로 쿠키·저장소도 제품과 갈린다(남의 코드가 우리 세션 저장소를 못 본다).
      partition: "persist:gijo-smartmd",
    },
  });
  smartMdWindow.removeMenu();
  // ⚠ **이 창은 바깥으로 나가지 못한다**(2026-08-14 재검토 B-6). 고객 안내서에 「만든 글은 이 PC를
  //   벗어나지 않습니다」라고 적었는데, 그 창의 코드는 **다른 저장소에서 받아온 것**이라 코드가
  //   그것을 보장하고 있지 않았다(문구가 코드보다 앞서 나간 자리). CSP로 못 박는다:
  //   connect-src 'none' — fetch·XHR·WebSocket이 아예 안 나간다. 편집기는 로컬 자산만 쓴다.
  //   (위 partition으로 이 창만의 세션이므로, 이 규칙은 GIJO 제품 화면에 영향을 주지 않는다.)
  smartMdWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": ["default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; img-src 'self' data: blob:; font-src 'self' data:;"],
      },
    });
  });
  // 바깥으로 나가는 요청 자체를 세션 층에서도 막는다 — CSP는 페이지가 지키는 규칙이라
  // 브라우저 밖 경로(예: 미래에 추가될 preload 기능)까지 덮지 못한다. 두 겹으로 둔다.
  smartMdWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const 로컬 = /^(file|devtools|blob|data):/i.test(details.url);
    if (!로컬) console.warn(`[smartmd] 바깥 요청 차단: ${details.url.slice(0, 120)}`);
    callback({ cancel: !로컬 });
  });
  // ⚠ 배율(bindZoom)은 걸지 않는다 — Smart MD는 자기 확대/축소를 가진 편집기다.
  //   GIJO 화면 배율을 강제하면 편집기 안에서 글자 크기를 조절하는 기능과 부딪힌다.
  smartMdWindow.on("closed", () => { smartMdWindow = null; });
  // 드롭한 파일·링크가 창을 딴 데로 끌고 가지 못하게(원본 main.js의 방어를 그대로 옮긴다).
  smartMdWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  // ⚠ **새 창을 열지 못하게 막는다**(검토관 의심 1). Smart MD는 마크다운을 렌더링하므로
  //   문서 안의 링크가 `target=_blank`거나 window.open을 부르면, Electron이 **우리 통제 밖의
  //   창**을 띄운다(will-navigate는 그 길을 막지 못한다 — 다른 사건이다).
  //   외부 주소는 기본 브라우저로 보낸다(그쪽이 샌드박스다). 그 외 스킴은 그냥 버린다.
  smartMdWindow.webContents.setWindowOpenHandler(({ url }) => {
    // ⚠ **바깥으로 열어 주지 않는다**(3차 검토 M-1). 처음엔 http(s)를 기본 브라우저로 넘겼는데,
    //   그게 위의 두 겹(CSP·세션 차단)을 **우회하는 세 번째 문**이었다:
    //   `window.open("https://…/?d=<본문>")` 한 줄이면 편집 중인 글을 URL에 실어 내보낼 수 있다.
    //   이 창의 위협 모델은 「저쪽 저장소 push 한 번」이고, 고객 안내서에 「이 PC를 벗어나지
    //   않습니다」라고 적었다 — 그 약속과 이 문은 함께 설 수 없다.
    //   ▶ 전부 거절하고 로그만 남긴다. 문서 안 링크를 열어야 할 일이 생기면, 그때 사람에게
    //     주소를 보여 주고 확인받는 길을 따로 만든다(조용히 여는 것과 다르다).
    console.warn(`[smartmd] 새 창 요청 거절: ${String(url).slice(0, 120)}`);
    return { action: "deny" };
  });
  await smartMdWindow.loadFile(index);
  return { ok: true };
});

// Smart MD의 PDF 내보내기 — 원본 앱이 자기 main.js에서 하던 일을 여기서 대신한다.
// printBackground가 없으면 어두운 코드블록 배경이 빠져 흰 바탕에 흰 글씨가 된다(원본 주석).
ipcMain.handle("smartmd:exportPdf", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  // ⚠ **Smart MD 창에서 온 것만** 받는다(검토관 지적 L6). 자기 창을 PDF로 뜨는 것뿐이라
  //   위험이 크지 않지만, 표면은 줄일 수 있으면 줄인다.
  if (!win || win !== smartMdWindow) return null;
  const buffer = await win.webContents.printToPDF({ printBackground: true });
  return new Uint8Array(buffer); // Buffer를 구조화 복제에 태우면 판본에 따라 조용히 멎는다(원본 주석)
});

// 관제 모니터 상시용 — 항상 위 고정 토글(office.html 헤더의 📌 버튼).
ipcMain.handle("office:setAlwaysOnTop", async (_e, on: boolean) => {
  if (officeWindow && !officeWindow.isDestroyed()) officeWindow.setAlwaysOnTop(Boolean(on));
  return { on: Boolean(on) };
});

// 팝업 셸 "창으로 분리"(혼합 방식, 2026-07-26 결정) — 대시보드 위 팝업으로 보던 화면을
// 사무실 창처럼 별도 창으로 떼어낸다(모니터 2대에서 화면을 펼쳐놓고 대시보드에서 지시하는 용도).
// 페이지당 1개 — 이미 떠 있으면 앞으로만 가져온다. 인증은 메인 프로세스 authState 공유.
const popoutWindows = new Map<string, BrowserWindow>();

// 분리창은 "화면 절반"으로 연다(2026-07-26 사용자 요청) — 나머지 절반을 다른 용도로 쓰고,
// 위아래 크기는 자유롭게 조정한다(minHeight를 낮게 둬 절반보다 더 줄일 수도 있게).
// · 가로: 기준 창이 떠 있는 모니터의 오른쪽 절반 — 왼쪽에 대시보드를 두고 보면서 지시하는 배치.
//   절반이 콘텐츠 최소폭(760)보다 좁으면 760까지는 보장(주 모니터가 세로형인 환경 실측).
// · 세로: 세로로 세운 모니터가 있으면 그 모니터의 위쪽 절반, 없으면 기준 모니터에 세로 비율 절반.
// 가로/세로 전환은 분리창 자신이 헤더 버튼으로 요청한다(shell:popoutOrient) — 2026-07-26 사용자 결정.
function popoutBounds(portrait: boolean, ref?: Electron.Rectangle): { x?: number; y?: number; width: number; height: number } {
  if (portrait) {
    const pd = screen.getAllDisplays().find((d) => d.workAreaSize.height > d.workAreaSize.width);
    if (pd) {
      return { x: pd.workArea.x + 12, y: pd.workArea.y + 12, width: pd.workArea.width - 24, height: Math.round(pd.workArea.height / 2) };
    }
    const wa = (ref ? screen.getDisplayMatching(ref) : screen.getPrimaryDisplay()).workArea;
    return { width: Math.min(1000, Math.max(760, Math.round(wa.height * 0.62))), height: Math.round(wa.height / 2) };
  }
  const base = ref ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : undefined);
  const disp = base ? screen.getDisplayMatching(base) : screen.getPrimaryDisplay();
  // ★ 보조 모니터 자동 배치(2026-08-19 승인 시안 프로_도킹패널 §10-4).
  //   본창이 좁은 디스플레이(세로 모니터 등 — 내부폭 1400 미만)에 있고 다른 디스플레이가 있으면,
  //   팝업은 그중 가로(landscape) 우선 디스플레이의 작업영역에 크게 띄운다 — 세로=대화·판단,
  //   가로=증거 화면(관제실 배치). 모니터가 하나면 이 분기를 안 타므로 기존 동작 그대로(회귀 없음).
  //   표준 셸의 「⧉ 창으로」도 같은 함수라 이 개선을 함께 받는다(의도된 공유).
  if (disp.workAreaSize.width - 56 < 1400) {
    const others = screen.getAllDisplays().filter((d) => d.id !== disp.id);
    if (others.length) {
      const landscape = others
        .filter((d) => d.workAreaSize.width > d.workAreaSize.height)
        .sort((a, b) => b.workAreaSize.width - a.workAreaSize.width)[0];
      const target = landscape ?? others[0];
      const wa2 = target.workArea;
      return { x: wa2.x + 20, y: wa2.y + 20, width: wa2.width - 40, height: wa2.height - 40 };
    }
  }
  const wa = disp.workArea;
  const half = Math.max(760, Math.round(wa.width / 2));
  return { x: wa.x + Math.max(0, wa.width - half), y: wa.y, width: Math.min(half, wa.width), height: wa.height };
}

ipcMain.handle("shell:popout", async (_e, page: string, title?: string, orient?: string) => {
  const portrait = orient === "portrait";
  const key = String(page); // 페이지당 창 1개 — 가로/세로는 그 창 안에서 전환하므로 키에 넣지 않는다
  const existing = popoutWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const pb = popoutBounds(portrait);
  const win = new BrowserWindow({
    x: pb.x,
    y: pb.y,
    width: pb.width,
    height: pb.height,
    minWidth: 700,
    minHeight: 420,
    backgroundColor: "#262624",
    title: title ? `GIJO AS — ${title}` : "GIJO AS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 4.0.0에서 분리창은 화면 하나를 직접 띄운다(허브가 없어졌다). 그래도 서브프레임 주입은
      // 켜 둔다 — 화면 안에 iframe을 쓰는 곳이 있고, 빠뜨리면 그 안이 "불러오지 못했습니다"로 죽는다
      // (2026-07-26 실화면 검증에서 실제로 잡은 버그).
      nodeIntegrationInSubFrames: true,
    },
  });
  win.removeMenu();
  bindZoom(win); // 분리 창도 같은 화면 크기를 따른다
  popoutWindows.set(key, win);

  // 분리창도 대시보드의 "명령 맥락"이 된다(2026-07-26 사용자 요청).
  // 규칙은 단순하게 — **보고 있는 것이 맥락**: 창을 클릭해 포커스하면 그 창이 맥락이 되고,
  // 닫으면 해제된다. 담당자가 따로 지정할 필요 없이 화면을 보며 바로 지시할 수 있다.
  const notifyMain = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  win.on("focus", () => notifyMain("shell:popoutFocus", { key, label: title ?? key }));
  win.on("closed", () => {
    popoutWindows.delete(key);
    notifyMain("shell:popoutClosed", { key });
  });
  // popout=1·orient — 분리창임을 페이지에 알린다(nav.js가 메뉴를 숨기고 가로/세로 버튼을 그린다).
  // ⚠ 로드 주소에 창 구분용 접미사를 섞으면 화면 자신의 쿼리(?s=ai 등)가 오염된다(실측 버그).
  const [file, qs] = String(page).split("?");
  const query: Record<string, string> = { popout: "1", orient: portrait ? "portrait" : "landscape" };
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  await win.loadFile(path.join(__dirname, `../src/renderer/pages/${file}`), { query });
});

// 분리창이 "지금 어느 탭을 보고 있는지"를 대시보드에 알린다 — 명령 맥락이 탭 단위로 정확해진다.
// (앱 안 팝업은 postMessage로 부모에게 알리지만, 별도 창은 부모가 없어 메인 프로세스를 거친다.)
ipcMain.handle("shell:popoutTab", async (e, page: string, label: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return { ok: false };
  const key = [...popoutWindows.entries()].find(([, w]) => w === win)?.[0];
  if (key && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("shell:popoutTab", { key, page, label, focused: win.isFocused() });
  }
  return { ok: true };
});

// ── 열린 창 목록 / 창 앞으로 (4.0.1) ────────────────────────────────────────
// 왜 필요한가: 화면이나 대화를 별도 창으로 빼내면 그 창이 **본창 뒤로 숨는다.** 담당자는
// 빼낸 것을 잃어버리고 "아까 그거 어디 갔지"가 된다(2026-07-28 사용자가 실제로 겪음 —
// 본창 뒤에 반쯤 걸친 창을 보고 "저게 뭐냐"고 물었다).
// 작업표시줄에도 뜨지만 아이콘이 다 같아 구분이 안 된다. 앱이 자기 창을 알고 있으니
// 앱이 알려주는 게 맞다.
type WinKind = "main" | "popout" | "console" | "office";
function listAppWindows(): { id: string; kind: WinKind; label: string; focused: boolean; minimized: boolean }[] {
  const out: { id: string; kind: WinKind; label: string; focused: boolean; minimized: boolean }[] = [];
  const add = (id: string, kind: WinKind, label: string, w: BrowserWindow | null) => {
    if (!w || w.isDestroyed()) return;
    out.push({ id, kind, label, focused: w.isFocused(), minimized: w.isMinimized() });
  };
  add("main", "main", "본 창 (탭)", mainWindow);
  for (const [key, w] of popoutWindows) {
    // 창 제목이 "GIJO AS — 취약점" 꼴이라 뒷부분만 쓰면 사람이 읽는 이름이 된다.
    const t = w.isDestroyed() ? "" : w.getTitle();
    add("popout:" + key, "popout", t.replace(/^GIJO AS\s*—\s*/, "") || key, w);
  }
  add("console", "console", "대화", consoleWindow);
  add("office", "office", "팀 사무실", officeWindow);
  return out;
}
function findAppWindow(id: string): BrowserWindow | null {
  if (id === "main") return mainWindow;
  if (id === "console") return consoleWindow;
  if (id === "office") return officeWindow;
  if (id.startsWith("popout:")) return popoutWindows.get(id.slice(7)) ?? null;
  return null;
}

// ── 🚀 프로 팝업 배관(2026-08-19, 승인 시안 mockups/프로_팝업배치) ─────────────────
//
// ⚠ 왜 IPC인가: 별도 창(BrowserWindow)에서는 `window.top`이 **자기 자신**이라
//   gijo:select·scope 같은 postMessage 배관이 본창(셸)에 절대 닿지 않는다(코드 10곳 전수 확인).
//   렌더러끼리는 직접 통신이 불가하므로 메인이 다리를 놓는다.
// 팝업 → 본창: 화면이 보낸 gijo:*를 본창에 그대로 전한다(본창은 자기 window에 재주입해
//   기존 message 리스너가 처리 — 처리 코드를 복제하지 않는다).
ipcMain.on("gijo:bridge", (_e, d: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("gijo:bridge", d);
});
// 본창 → 모든 팝업: 🗂 범위 같은 상태를 열린 창 전부에 퍼뜨린다(본창 제외).
ipcMain.on("gijo:broadcast", (_e, d: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (mainWindow && w.id === mainWindow.id) continue;
    if (!w.isDestroyed()) w.webContents.send("gijo:bridge", d);
  }
});
// 결재판이 왔는데 본창이 뒤에 있으면 작업표시줄을 깜빡인다 — 강제 포커스 전환은
// 표준 관행이 금하는 focus stealing이라 쓰지 않는다(시안이 대안 비교 후 채택).
// ⇤ 붙이기(승인 시안 프로_도킹패널 §10-3) — 본창이 「이 팝업을 도킹으로 되돌리라」고 정한 뒤
// 그 팝업 창을 닫아 달라고 부른다. 판단(폭·슬롯)은 전부 본창 몫 — 여기는 닫기만 한다.
ipcMain.handle("shell:closePopout", (_e, page: string) => {
  const w = popoutWindows.get(String(page));
  if (w && !w.isDestroyed()) w.close();
});

ipcMain.on("shell:flash", () => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.flashFrame(true);
});

ipcMain.handle("windows:list", async () => listAppWindows());
ipcMain.handle("windows:focus", async (_e, id: string) => {
  const w = findAppWindow(String(id));
  if (!w || w.isDestroyed()) return { ok: false };
  // 최소화돼 있으면 먼저 복원해야 한다 — focus()만으로는 아이콘 상태 그대로다.
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return { ok: true };
});
ipcMain.handle("windows:close", async (_e, id: string) => {
  const w = findAppWindow(String(id));
  // 본 창은 이 메뉴로 닫지 않는다 — 앱이 통째로 꺼져 놀란다. 창 버튼(✕)이 그 자리다.
  if (!w || w.isDestroyed() || w === mainWindow) return { ok: false };
  w.close();
  return { ok: true };
});

// ── 대화 콘솔 창(4.0.0) ──────────────────────────────────────────────────────
// 콘솔은 기본적으로 셸 아래에 붙어 있지만, 모니터가 여럿이면 별도 창으로 빼내는 편이 낫다
// (화면은 100%로 넓어지고 대화도 원하는 만큼 커진다 — 2026-07-28 사용자 결정).
// 빼낸 상태는 렌더러가 기억하고, 여기서는 창의 생사와 맥락 중계만 맡는다.
let consoleWindow: BrowserWindow | null = null;
// 마지막 맥락을 기억한다 — 창이 뜨는 데 시간이 걸려서, 셸이 곧바로 보낸 맥락은 아직 듣는 쪽이
// 없어 그대로 유실된다(2026-07-28 실측: 창을 빼면 맥락이 '대시보드'로 남았다).
let lastConsoleContext: { screen: string | null; label: string | null } = { screen: null, label: null };

// 도킹으로 돌아갈 때 되돌릴 셸 자리. 창을 옆으로 밀었을 때만 채워진다.
let 셸복귀: { x: number; y: number; width: number; height: number; wasMaximized: boolean } | null = null;

// 대화창을 창으로 뺄 때, 셸이 있던 자리를 **비켜 준다.**
//
// ⚠ 예전엔 안 비켜 줬다(2026-08-01 확인). 대화 창이 화면 오른쪽 끝에 뜨는데 셸은 그대로라
//   모니터 한 대에서 앱을 최대화해 두면 **오른쪽 4분의 1이 가려졌다.** 담당자 눈에는
//   "창으로 뺐더니 화면이 잘렸다"가 된다 — 도킹보다 나쁘다.
//   같은 모니터에 겹칠 때만 비켜 준다. 대화 창을 다른 모니터로 옮겨 두었다면 건드리지 않는다.
function 셸을옆으로(consoleBounds: { x: number; y: number; width: number; height: number }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const 셸 = mainWindow.getBounds();
  // 계산은 util/layout.ts에 있다 — 여기 두면 시험할 방법이 없다(이 개발 머신은 세로 모니터라
  // 실앱에서 "비켜 주는 쪽"을 못 본다).
  const 옮길자리 = 셸옮길자리(셸, consoleBounds);
  if (!옮길자리) return;
  // ⚠ 최대화 상태를 **먼저 적어 두고** 푼다 — 풀고 나서 물으면 언제나 false다.
  const 최대화였나 = mainWindow.isMaximized();
  if (최대화였나) mainWindow.unmaximize(); // 최대화 상태에선 크기를 못 바꾼다
  셸복귀 = { x: 셸.x, y: 셸.y, width: 셸.width, height: 셸.height, wasMaximized: 최대화였나 };
  mainWindow.setBounds(옮길자리);
}

function 셸자리복구(): void {
  if (!셸복귀 || !mainWindow || mainWindow.isDestroyed()) return;
  const b = 셸복귀;
  셸복귀 = null;
  mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  if (b.wasMaximized) mainWindow.maximize();
}

ipcMain.handle("console:popout", async () => {
  if (consoleWindow && !consoleWindow.isDestroyed()) { consoleWindow.focus(); return { ok: true }; }
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.max(420, Math.round(wa.width * 0.28));
  셸을옆으로({ x: wa.x + wa.width - w, y: wa.y, width: w, height: wa.height });
  consoleWindow = new BrowserWindow({
    x: wa.x + wa.width - w, y: wa.y, width: w, height: wa.height,
    minWidth: 360, minHeight: 320,
    backgroundColor: "#1f1e1d",
    title: "GIJO AS — 대화",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  consoleWindow.removeMenu();
  bindZoom(consoleWindow);
  consoleWindow.on("closed", () => {
    consoleWindow = null;
    셸자리복구(); // 비켜 줬던 셸을 원래 자리로 — 안 돌리면 앱이 좁아진 채로 남는다
    // 창이 닫히면 셸이 콘솔을 다시 아래에 붙여야 한다 — 안 알리면 대화할 곳이 사라진다.
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("console:closed", {});
  });
  // 창이 다 뜬 뒤 기억해 둔 맥락을 건넨다 — 이때가 듣는 쪽이 준비된 첫 시점이다.
  consoleWindow.webContents.once("did-finish-load", () => {
    if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.webContents.send("console:context", lastConsoleContext);
  });
  await consoleWindow.loadFile(path.join(__dirname, "../src/renderer/pages/console.html"));
  return { ok: true };
});

// 아무 창에서나 → 지휘소(대화창)에 지시를 건넨다.
// ⚠ 화면이 자기 자리에서 직접 /api/dispatch를 부르면 **쓰기 지시가 막다른 길이 된다** —
//   쓰기 도구는 결재판(approval)으로만 나가는데, 그걸 그릴 줄 아는 곳은 대화창뿐이다.
//   실제로 팀 사무실이 그렇게 부르고 있었고, 없는 필드(summary)를 읽어 응답조차 안 보였다
//   (2026-08-01 확인). 그래서 지시는 전부 대화창으로 모은다.
ipcMain.handle("console:ask", async (_e, text: string, sessionId?: string) => {
  const 글 = String(text ?? "").trim();
  // 분리돼 있으면 그 창이 대화창이고, 아니면 셸 아래에 도킹돼 있다. 둘 다 console.js가 받는다.
  const target = consoleWindow && !consoleWindow.isDestroyed() ? consoleWindow : mainWindow;
  if (!target || target.isDestroyed()) return { ok: false, why: "대화창이 없습니다" };
  if (target.isMinimized()) target.restore();
  target.focus();
  // 세션을 함께 넘긴다 — 「작업 내역에서 이어서 지시」가 **그 작업에** 붙어야 한다.
  //   안 넘기면 대화창이 자기가 기억하는 세션에 붙여, 47번 작업을 열고 눌러도 엉뚱한 곳에
  //   기록된다(2026-08-01 검토 지적: 버튼 이름이 거짓말이 된다).
  target.webContents.send("console:ask", { text: 글, sessionId: sessionId ? String(sessionId) : null });
  return { ok: true };
});

ipcMain.handle("console:dock", async () => {
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.close(); // closed 이벤트가 셸에 알린다
  return { ok: true };
});

// 셸 → 콘솔 창: "지금 보고 있는 탭이 맥락이다". 콘솔이 별도 창이면 활성 탭을 직접 못 보므로 중계한다.
ipcMain.handle("console:context", async (_e, screenPage: string | null, label: string | null) => {
  lastConsoleContext = { screen: screenPage, label };
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.webContents.send("console:context", lastConsoleContext);
  return { ok: true };
});

// 지휘소(별도 대화 창) → 본창에 탭 열기.
// ⚠ navigate:to를 쓰면 안 된다 — 그건 본창을 loadFile로 **통째로 갈아치워** 열려 있던
//   탭이 전부 사라진다(2026-07-31 확인). 대화창에서 화면을 여는 것은 "탭 하나 추가"지
//   "앱을 그 화면으로 바꾸기"가 아니다. 그래서 셸에게 부탁하는 통로를 따로 둔다.
ipcMain.handle("shell:openTab", async (_e, page: string, label?: string) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, why: "본창이 없습니다" };
  mainWindow.webContents.send("shell:openTab", { page: String(page), label: label ? String(label) : null });
  // 화면을 열었으면 그 창을 앞으로 — 안 그러면 "열었다는데 안 보인다"가 된다.
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  return { ok: true };
});

// 분리창 안에서 가로/세로 전환(2026-07-26 사용자 결정 — 모니터 배치는 그 창에서 바꾼다).
ipcMain.handle("shell:popoutOrient", async (e, orient: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return { orient };
  const cur = win.getBounds();
  const pb = popoutBounds(orient === "portrait", cur);
  win.setBounds({ x: pb.x ?? cur.x, y: pb.y ?? cur.y, width: pb.width, height: pb.height });
  return { orient };
});

// ── 화면 크기(UI 배율) ────────────────────────────────────────────────────────
// 담당자마다 모니터·시력이 달라 "한 화면에 더 많이" vs "글씨 크게"가 갈린다. 자동 반응형만으로는
// 이 취향을 못 맞추므로 배율을 직접 고르게 한다(설정 › 화면 크기, 단축키 Cmd/Ctrl +·-·0).
//
// 렌더러의 webFrame이 아니라 webContents에 건다 — 허브(hub.html)가 화면을 iframe으로 품기 때문에
// 프레임별로 걸면 탭 안쪽이 따로 놀지만, webContents 단위는 하위 프레임까지 한 번에 적용된다.
// 값은 userData 파일에 남겨 다음 실행에도 유지한다(explorer-root.txt와 같은 방식).
const ZOOM_DEFAULT = 1.25; // ⚠ 반드시 ZOOM_STEPS 안의 값이어야 한다(설정 화면이 프리셋만 그린다). 기본 배율 — 라벨(설정 › 화면 크기)의 「기본」과 반드시 같아야 한다
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.5;
const ZOOM_STEPS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
// ★ 기본을 125%로 올린다(2026-08-02 사용자 지적: "글씨가 너무 작고 특히 안내 글씨는 거의 안 보임").
//   같은 날 화면 안 글자의 **바닥**도 올렸다(8.5~11.5px → 11~12.5px). 배율만 올리면 작은 글씨는
//   여전히 본문보다 한참 작아 보이고, 크기만 올리면 배치가 흔들린다 — 둘을 같이 해야 한다.
//   본문 글자가 화면마다 9.5~13px이라 100%에서는 작다. 31화면의 크기를 일일이 고치면
//   표가 밀리고 칩이 줄바꿈되는 등 어디가 깨졌는지 못 찾는다 — 배율은 **전체를 같은 비율로**
//   키워서 배치가 안 흔들린다. 담당자가 고른 값이 있으면 그대로 따른다(아래 loadSavedZoom).
let uiZoom = ZOOM_DEFAULT;

function zoomStateFile(): string {
  // ⚠ 파일 이름에 2가 붙은 이유: 기본 배율이 바뀔 때마다 **옛 저장값이 새 기본을 덮어쓴다**.
  //   (2026-08-02 실측 — 기본을 올렸는데 예전에 고른 80%가 남아 있어 그대로 작게 떴다.)
  //   기본을 바꾸는 날엔 이름도 바꿔 한 번은 새 기본으로 시작하게 한다.
  return path.join(app.getPath("userData"), "ui-zoom2.txt");
}
function clampZoom(v: number): number {
  return Number.isFinite(v) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)) : ZOOM_DEFAULT;
}
function loadSavedZoom(): void {
  try {
    uiZoom = clampZoom(Number(fs.readFileSync(zoomStateFile(), "utf-8").trim()));
  } catch {
    /* 저장값 없음 — 위 기본값(110%) 유지 */
  }
}
// 창이 새 페이지를 띄울 때마다 다시 걸어 준다. Chromium의 배율은 origin 단위로 기억되는데,
// file:// 로딩에서는 유지가 보장되지 않아 did-finish-load마다 명시적으로 맞추는 편이 안전하다.
function applyZoom(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(uiZoom);
}
function bindZoom(win: BrowserWindow): void {
  win.webContents.on("did-finish-load", () => applyZoom(win));
  applyZoom(win);
  // ⚠ 설정 화면이 "⌘/Ctrl + · − · 0(기본값)으로도 바꿀 수 있다"고 **안내만 하고 있었다**
  //   (2026-08-02 실측 — preload에 stepUiZoom은 있는데 그걸 부르는 자리가 어디에도 없었다).
  //   말과 코드가 어긋난 자리라 여기서 실제로 건다. bindZoom은 모든 창이 거치므로
  //   대시보드·사무실·문서함·분리 창 어디서 눌러도 같게 동작한다.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown" || input.alt || !(input.control || input.meta)) return;
    const k = String(input.key);
    if (k === "+" || k === "=") {
      e.preventDefault();
      화면크기한칸(1);
    } else if (k === "-" || k === "_") {
      e.preventDefault();
      화면크기한칸(-1);
    } else if (k === "0") {
      e.preventDefault();
      화면크기적용(ZOOM_DEFAULT);
    }
  });
}

/** 배율을 정하고 저장하고 모든 창에 반영한다 — 단축키와 설정 화면이 **같은 한 길**을 쓴다. */
function 화면크기적용(factor: number): number {
  uiZoom = clampZoom(Number(factor));
  try {
    fs.writeFileSync(zoomStateFile(), String(uiZoom), "utf-8");
  } catch {
    /* 저장 실패는 무시 — 이번 실행에는 적용된다 */
  }
  for (const w of BrowserWindow.getAllWindows()) applyZoom(w);
  return uiZoom;
}
/** 현재 값에서 프리셋 한 칸 이동. 화면이 직접 계산하지 않게 여기서 처리한다. */
function 화면크기한칸(dir: number): number {
  const d = Number(dir) > 0 ? 1 : -1;
  let i = ZOOM_STEPS.findIndex((s) => Math.abs(s - uiZoom) < 0.001);
  if (i === -1) i = ZOOM_STEPS.findIndex((s) => s >= uiZoom); // 프리셋 밖의 값이면 가까운 칸부터
  if (i === -1) i = ZOOM_STEPS.length - 1;
  return 화면크기적용(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + d))]);
}

ipcMain.handle("ui:getZoom", () => ({ zoom: uiZoom, steps: ZOOM_STEPS, min: ZOOM_MIN, max: ZOOM_MAX, default: ZOOM_DEFAULT }));
ipcMain.handle("ui:setZoom", (_e, factor: number) => 화면크기적용(factor));
ipcMain.handle("ui:stepZoom", (_e, dir: number) => 화면크기한칸(dir));

// ── 타이틀바 ⚙ 메뉴용 IPC (C안, 2026-07-25) ─────────────────────────────────
// 전체 화면(관제 모드) 토글 — 대형 모니터 상시 표시용. 현재 상태를 돌려줘 UI가 표시를 맞춘다.
ipcMain.handle("ui:toggleFullscreen", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});
// 앱 재시작 — 업데이트 적용·화면 이상 시 원클릭 복구.
ipcMain.handle("app:restart", () => {
  quitConfirmed = true; // 의도된 재시작 — 닫기 확인을 띄우지 않는다
  app.relaunch();
  app.exit(0);
});
// 진단 정보 — 문의/AS 때 "복사해서 붙여넣기" 용도. 서버 URL·사용자는 렌더러가 보태서 조합한다.
ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
}));

// 읽기 전용 파일 탐색기 — 대시보드에서 폴더 트리를 본다. 명령 실행은 없다.
// 루트를 벗어나는 경로(.. 등)는 거부해 선택한 루트 밖이 노출되지 않게 한다.
// 기본 루트는 마지막에 고른 폴더 → (없으면) 프로젝트 폴더. 폴더 선택 시 파일로 영속 저장한다.
const DEFAULT_EXPLORER_ROOT = path.resolve(process.env.GIJO_EXPLORER_ROOT ?? path.join(__dirname, "..", ".."));
let explorerRoot = DEFAULT_EXPLORER_ROOT;

function rootStateFile(): string {
  return path.join(app.getPath("userData"), "explorer-root.txt");
}
function loadSavedRoot(): void {
  // 기본 루트는 담당자 '내 문서'(제품 문서 번들이 아니라 본인 PC 파일을 보게). 환경변수 지정 시 그대로 존중.
  if (!process.env.GIJO_EXPLORER_ROOT) {
    try { const docs = app.getPath("documents"); if (docs && fs.existsSync(docs)) explorerRoot = docs; } catch { /* 문서 폴더 못 찾으면 기존 기본 유지 */ }
  }
  try {
    const saved = fs.readFileSync(rootStateFile(), "utf-8").trim();
    if (saved && fs.existsSync(saved) && fs.statSync(saved).isDirectory()) explorerRoot = path.resolve(saved);
  } catch {
    /* 저장된 위치 없음/삭제됨 — 기본 루트 유지 */
  }
}
function saveRoot(dir: string): void {
  try {
    fs.writeFileSync(rootStateFile(), dir, "utf-8");
  } catch {
    /* 저장 실패는 무시(다음 실행 때 기본으로) */
  }
}

ipcMain.handle("fs:list", async (_e, relPath: string) => {
  const target = path.resolve(explorerRoot, relPath || ".");
  if (target !== explorerRoot && !target.startsWith(explorerRoot + path.sep)) {
    throw new Error("루트 밖 경로는 접근할 수 없습니다");
  }
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  const items = entries
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { root: explorerRoot, rootName: path.basename(explorerRoot), path: path.relative(explorerRoot, target), items };
});

// 탐색기에서 고른 파일 하나를 읽어 base64로 돌려준다(장기 기억에 올리기 등). 읽기 전용 원칙에 맞게
// 파일 내용을 읽기만 하며, fs:list와 같은 루트 이탈 방지 + 크기 상한(200MB — 대용량 매뉴얼 PDF 허용)을 건다.
const FS_READ_MAX_BYTES = 200 * 1024 * 1024;
ipcMain.handle("fs:readFile", async (_e, relPath: string) => {
  const target = path.resolve(explorerRoot, relPath || ".");
  if (target !== explorerRoot && !target.startsWith(explorerRoot + path.sep)) {
    throw new Error("루트 밖 경로는 접근할 수 없습니다");
  }
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new Error("파일이 아닙니다");
  if (stat.size > FS_READ_MAX_BYTES) throw new Error("파일이 너무 큽니다 (200MB 초과)");
  const buf = await fs.promises.readFile(target);
  return { name: path.basename(target), size: stat.size, content: buf.toString("base64") };
});

// 서버에 보관된 문서 원본(base64)을 임시 파일로 저장하고 OS 기본 프로그램(PDF 뷰어 등)으로 연다.
// 렌더러가 base64를 preload(apiClient)로 받아 여기로 넘긴다 — 파일 쓰기·shell은 메인 프로세스 몫.
ipcMain.handle("doc:open-temp", async (_e, filename: string, base64: string) => {
  const dir = path.join(os.tmpdir(), "gijo-docs");
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, path.basename(String(filename || "document")));
  await fs.promises.writeFile(target, Buffer.from(String(base64), "base64"));
  const errMsg = await shell.openPath(target); // 빈 문자열이면 성공
  if (errMsg) throw new Error(`파일을 열 수 없습니다: ${errMsg}`);
  return { path: target };
});

// ── 챗 모델 폴더 — 화면이 실제 경로를 직접 보여주고 「폴더 열기」로 탐색기까지 연다 (2026-08-14) ──
//   왜: 라이트 고객 첫날, .gguf를 넣을 자리를 화면·안내서가 서로 미뤄(순환 참조) 아무도 못 얻었다.
//   preload가 이 경로를 내려주면 서버가 아직 안 떠 있어도 화면에 값이 뜬다(dataRoot는 메인이 안다).
//   ⚠ 폴더 이름과 파일 이름이 완전히 같아야 서버가 인식한다(server localengine.ts) — 화면이 그림으로 안내.
function 모델폴더경로(): string {
  const 구성 = 번들서버 ?? 번들서버구성();
  const root = 구성 ? 구성.dataRoot : app.getPath("userData");
  return path.join(root, "models");
}
ipcMain.handle("models:folder-path", () => 모델폴더경로());
ipcMain.handle("models:open-folder", async () => {
  const dir = 모델폴더경로();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 이미 있으면 그만 — 서버가 부팅마다 만든다 */ }
  const errMsg = await shell.openPath(dir); // 빈 문자열이면 성공
  if (errMsg) throw new Error(`폴더를 열 수 없습니다: ${errMsg}`);
  return { path: dir };
});

// 라이트 「보안 장비 등록부」·「나만의 연락처」 직접 접근 — OS 기본 앱으로 연다.
//   ⚠ 스킴을 검사한다: 웹(http/https)·원격(ssh/rdp/vnc)·연락(mailto/tel)만 허용.
//   javascript:·file:·data: 등은 막는다. mailto·tel은 나만의 연락처(⑤)의 이메일·전화 직접 연락용.
//   렌더러가 넘긴 주소를 그대로 여는 게 아니라, 여기서 한 번 더 거른다(주입 방어).
const 허용스킴 = new Set(["http:", "https:", "ssh:", "rdp:", "vnc:", "mailto:", "tel:"]);
ipcMain.handle("shell:openExternal", async (_e, rawUrl: string) => {
  const s = String(rawUrl || "").trim();
  if (!s) throw new Error("주소가 비었습니다");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error("주소 형식이 올바르지 않습니다 (예: https://192.168.0.1)");
  }
  if (!허용스킴.has(u.protocol)) {
    throw new Error(`이 방식(${u.protocol})은 열 수 없습니다 — 웹·SSH·RDP·VNC만 됩니다`);
  }
  await shell.openExternal(u.toString());
  return { ok: true };
});

// 도달 확인 — host:port에 TCP로 붙어 살아있나만 본다. ICMP(ping)가 아니라 권한이 필요 없다.
//   ⚠ 이 앱이 임의 호스트로 대량 접속하는 통로가 되지 않게, 한 번에 하나·짧은 타임아웃만 건다.
ipcMain.handle("net:probe", async (_e, host: string, port: number, timeoutMs?: number) => {
  const h = String(host || "").trim();
  const p = Number(port);
  if (!h) throw new Error("호스트가 비었습니다");
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("포트가 올바르지 않습니다 (1~65535)");
  const limit = Math.min(Math.max(Number(timeoutMs) || 2000, 300), 5000);
  const started = Date.now();
  return await new Promise<{ up: boolean; ms: number }>((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (up: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* 무해 */ }
      resolve({ up, ms: Date.now() - started });
    };
    sock.setTimeout(limit);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    try { sock.connect(p, h); } catch { finish(false); }
  });
});

// 사용자가 작업 폴더를 직접 고른다(폴더 선택 다이얼로그). 선택하면 그 폴더가 새 루트가 된다.
ipcMain.handle("fs:pickRoot", async () => {
  if (!mainWindow) return { cancelled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "작업 폴더 선택",
    properties: ["openDirectory"],
    defaultPath: explorerRoot,
  });
  if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
  explorerRoot = path.resolve(result.filePaths[0]);
  saveRoot(explorerRoot); // 다음 실행 때 이 폴더로 시작
  return { cancelled: false, root: explorerRoot, rootName: path.basename(explorerRoot) };
});

// ── 담당자 PC CLI 터미널 (①) ─────────────────────────────────────────────
// 담당자 PC의 셸(PowerShell)을 앱 안에서 직접 실행한다. 세션을 유지하려고 지속형 셸을 하나 띄우고
// stdin으로 명령을 흘려 넣는다(cwd·변수 보존). 출력은 terminal:data 이벤트로 렌더러에 스트리밍.
// 위험 명령은 isDangerous로 실행 전 차단한다(수동·챗봇 무관). 서버가 아니라 이 PC에서 돈다.
let termShell: ChildProcess | null = null;
function termSend(data: string): void {
  mainWindow?.webContents.send("terminal:data", data);
}
function startTermShell(): void {
  if (termShell) return;
  const isWin = process.platform === "win32";
  const shellCmd = isWin ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
  const shellArgs = isWin ? ["-NoLogo", "-NoExit", "-Command", "-"] : ["-i"];
  termShell = spawn(shellCmd, shellArgs, { cwd: os.homedir(), env: process.env });
  termShell.stdout?.on("data", (d: Buffer) => termSend(d.toString()));
  termShell.stderr?.on("data", (d: Buffer) => termSend(d.toString()));
  termShell.on("exit", (code) => { termSend(`\n[셸 종료 코드 ${code}]\n`); termShell = null; });
  termShell.on("error", (err) => { termSend(`\n[셸 오류: ${err.message}]\n`); termShell = null; });
}
ipcMain.handle("terminal:start", async () => {
  startTermShell();
  return { ok: true, shell: process.platform === "win32" ? "PowerShell" : (process.env.SHELL || "bash"), cwd: os.homedir() };
});
// 위험 검사만(실행 안 함) — 챗봇 경로가 사전 판정에 쓴다.
ipcMain.handle("terminal:check", async (_e, cmd: string) => isDangerous(String(cmd ?? "")));
ipcMain.handle("terminal:exec", async (_e, cmd: string) => {
  const line = String(cmd ?? "");
  const danger = isDangerous(line);
  if (danger.blocked) return { blocked: true, reason: danger.reason };
  if (!termShell) startTermShell();
  try {
    termShell?.stdin?.write(line.replace(/\r?\n$/, "") + "\n");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.handle("terminal:kill", async () => {
  if (termShell) { termShell.kill(); termShell = null; }
  return { ok: true };
});

// ── 클라이언트 자동 업데이트 — GIJO AS 서버 자체가 배포처(외부 서비스 없음) ─────────────────
// 렌더러의 apiClient.request()로는 대용량 스트리밍 다운로드·설치파일 실행·앱 종료를 못 하므로,
// 메인 프로세스가 authState(로그인 시 렌더러가 IPC로 동기해 둔 토큰)로 직접 처리한다.
interface UpdateCheckResult {
  latest: { version: string; notes: string | null; size: number; publishedAt: number; sha256: string } | null;
  updateAvailable: boolean;
}
ipcMain.handle("update:check", async (): Promise<UpdateCheckResult> => {
  if (!authState.serverUrl || !authState.accessToken) return { latest: null, updateAvailable: false };
  try {
    const res = await fetch(`${authState.serverUrl}/api/client/latest-release?current=${encodeURIComponent(app.getVersion())}`, {
      headers: { Authorization: `Bearer ${authState.accessToken}` },
    });
    if (!res.ok) return { latest: null, updateAvailable: false };
    return (await res.json()) as UpdateCheckResult;
  } catch {
    return { latest: null, updateAvailable: false };
  }
});
ipcMain.handle("update:currentVersion", () => app.getVersion());

// url을 destPath로 스트리밍 다운로드(전체를 메모리에 안 올림) — 진행률은 progress 콜백으로.
function downloadToFile(urlStr: string, headers: Record<string, string>, destPath: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { headers }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`다운로드 실패: HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      const file = fs.createWriteStream(destPath);
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total) onProgress(Math.round((received / total) * 100));
      });
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      // 시스템 오류 코드(EBUSY·ENOSPC 등)가 그대로 화면에 나가면 담당자가 뭘 해야 할지 모른다.
      // 무엇이 막혔고 어떻게 풀지를 한국어로 알려 준다.
      file.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EBUSY" || err.code === "EPERM") {
          reject(new Error("설치 파일을 저장하지 못했습니다 — 이전 설치 프로그램이 아직 실행 중일 수 있습니다. 그 창을 닫고 다시 시도하세요."));
        } else if (err.code === "ENOSPC") {
          reject(new Error("디스크 공간이 부족해 설치 파일을 받지 못했습니다 (약 200MB 필요)."));
        } else {
          reject(err);
        }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

/** 순단에 강한 다운로드 — 전송 중 끊김(ECONNRESET 등)은 한 번 스스로 재시도한다.
 *  ⚠ 왜(2026-08-19 사장님 실사고): 업데이트 내려받기 도중 서버 재시작·게시 순간과 겹치면
 *    연결이 리셋되는데, 영문 오류(read ECONNRESET)가 그대로 화면에 나갔고 담당자는
 *    다시 누르면 되는 일인지 알 수 없었다. 한 번은 기계가 다시 해 보고, 그래도 안 되면
 *    한국어로 「다시 시도」를 알려 준다. 재시도는 새 파일로 처음부터(이어받기 없음 — 단순 우선). */
async function downloadToFileRetry(urlStr: string, headers: Record<string, string>, destPath: string, onProgress: (pct: number) => void): Promise<void> {
  const 순단인가 = (e: unknown) => /ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT|EPIPE/i.test(String((e as Error)?.message ?? e));
  try {
    await downloadToFile(urlStr, headers, destPath, onProgress);
  } catch (e) {
    if (!순단인가(e)) throw e;
    try { fs.unlinkSync(destPath); } catch { /* 없거나 잠김 — 새 이름이라 무해 */ }
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await downloadToFile(urlStr, headers, destPath, onProgress);
    } catch (e2) {
      if (순단인가(e2)) throw new Error("서버와의 연결이 도중에 끊겼습니다 — 서버가 재시작 중일 수 있습니다. 잠시 뒤 업데이트를 다시 눌러 주세요.");
      throw e2;
    }
  }
}

// 다운로드 → NSIS 설치파일 실행 → 이 앱 종료 → 설치 후 새 버전 자동 실행.
// 설치 프로그램이 실행 중인 exe를 덮어써야 하므로, spawn 직후 반드시 이 앱을 끝내야 한다.
//
// ⚠ 인자 두 개가 반드시 함께 필요하다(2026-07-27 실측으로 확인).
//   이 빌드는 oneClick=false(마법사형)라 electron-builder의 installSection.nsh가 이렇게 판단한다:
//       ${if} ${isForceRun} ${andIf} ${Silent} → 앱 실행
//   즉 **/S(무인)와 --force-run을 둘 다** 줘야 설치 후 앱이 다시 켜진다.
//   예전에는 인자 없이 띄워서 ① 제품 소개부터 시작하는 설치 마법사가 다시 떴고
//   ② [마침]을 누르지 않으면 앱이 안 켜졌다. 업데이트는 이미 앱에서 확인을 받았으니
//   설치 화면을 또 보여줄 이유가 없다 — 조용히 깔고 바로 다시 켠다.
ipcMain.handle("update:install", async (event, version: string) => {
  if (!authState.serverUrl || !authState.accessToken) throw new Error("로그인이 필요합니다");
  // ⚠ 받는 파일 이름을 버전마다 고정하면 안 된다(2026-07-27 실사고).
  //   앞서 받다 만 파일이나 아직 떠 있는 설치 프로그램이 그 파일을 잡고 있으면
  //   덮어쓰기가 EBUSY로 죽는다 — 담당자 화면에 영문 오류가 그대로 나갔다
  //   ("EBUSY: resource busy or locked, open '...GIJO-AS-Setup-3.6.1.exe'").
  //   매번 다른 이름으로 받으면 남의 파일을 건드릴 일이 없다.
  const dest = path.join(os.tmpdir(), `GIJO-AS-Setup-${version}-${Date.now()}.exe`);
  // 지난 번에 남은 설치 파일은 지워 둔다(용량 회수). 잠겨 있으면 그냥 넘어간다 —
  // 여기서 실패한다고 이번 업데이트를 막을 이유가 없다.
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!/^GIJO-AS-Setup-.*\.exe$/i.test(f)) continue;
      try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { /* 잠김 — 다음에 */ }
    }
  } catch { /* 임시 폴더를 못 읽어도 진행 */ }
  // ⚠ 진행률은 **호출한 프레임**으로 보내야 한다. 업데이트 화면은 허브 탭(iframe) 안에 있는데
  //   webContents.send()는 맨 바깥 프레임에만 닿아, 다운로드는 되면서 막대가 0%에 멈춰 있었다
  //   (2026-07-27 사용자 지적). senderFrame으로 보내면 그 iframe이 받는다.
  const sendProgress = (pct: number) => {
    try {
      const f = event.senderFrame;
      if (f) { f.send("update:progress", pct); return; }
    } catch { /* 프레임이 이미 사라졌으면 아래 폴백 */ }
    try { event.sender.send("update:progress", pct); } catch { /* 창이 닫혔다 — 무시 */ }
  };
  await downloadToFileRetry(
    `${authState.serverUrl}/api/client/download/${encodeURIComponent(version)}`,
    { Authorization: `Bearer ${authState.accessToken}` },
    dest,
    sendProgress
  );
  // ⚠ 예전엔 "/S"(무음)로 돌렸다. 설치는 되지만 **화면에 아무것도 안 나온다** —
  //   앱이 갑자기 꺼지고, 한참 뒤에야 새 앱이 뜬다. 그 사이 담당자는 설치가 되는 중인지
  //   실패했는지 알 방법이 없어 앱을 다시 눌러 보거나 그냥 기다린다
  //   (2026-07-29 사용자 신고: "다운로드 이후 설치화면이 안 보임 / 시간 지나면 설치는 됨").
  //   설치본은 마법사형(oneClick:false)이라 화면을 띄우면 진행 상황이 그대로 보인다.
  //   끝나면 runAfterFinish:true가 새 버전을 다시 띄운다.
  const child = spawn(dest, ["--force-run"], { detached: true, stdio: "ignore" });
  child.unref();
  quitConfirmed = true; // 업데이트 설치를 위한 의도된 종료 — 닫기 확인을 띄우지 않는다
  // 설치 창이 화면에 뜬 것을 담당자가 본 뒤에 우리 창이 사라져야 한다. 먼저 꺼지면
  // "앱이 그냥 죽었다"로 보인다. 1.2초면 설치 첫 화면이 그려진다(실측).
  setTimeout(() => app.quit(), 1200);
  return { ok: true };
});

// 파일 내려받기 — Electron은 브라우저와 다르다. will-download를 처리하지 않으면 저장 경로가
// 정해지지 않아 **파일이 그냥 사라진다**(2026-07-26 실측: VEX·리포트 받기를 눌러도 아무 일도
// 안 일어났다. 화면은 성공으로 표시돼 더 헷갈렸다).
// 그래서 여기서 저장 위치를 정하고, 끝나면 어디에 저장됐는지 화면에 알려준다.
function setupDownloads(): void {
  session.defaultSession.on("will-download", (_e, item, contents) => {
    const dir = app.getPath("downloads");
    // 같은 이름이 있으면 덮어쓰지 않고 (1), (2)를 붙인다 — 이전 리포트를 날리면 안 된다.
    const base = item.getFilename();
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let dest = path.join(dir, base);
    for (let i = 1; fs.existsSync(dest); i++) dest = path.join(dir, `${stem} (${i})${ext}`);
    item.setSavePath(dest);

    item.once("done", (_ev, state) => {
      const win = BrowserWindow.fromWebContents(contents);
      const info = {
        ok: state === "completed",
        path: state === "completed" ? dest : null,
        filename: path.basename(dest),
        state,
      };
      // 렌더러가 "어디에 저장됐는지"를 사용자에게 보여줄 수 있게 알린다.
      // ⚠ webContents.send는 **최상위 프레임에만** 닿는다 — 받기 버튼과 안내 칩은 탭·허브
      //   iframe 안(approvals 등)에 있어 통보가 영영 안 오고, 버튼이 "저장 중…"으로 굳는다
      //   (2026-08-08 실측 — 파일은 생기는데 화면만 모른다). 모든 프레임에 알린다.
      for (const f of win?.webContents.mainFrame.framesInSubtree ?? []) {
        try { f.send("download:done", info); } catch { /* 떠나는 중인 프레임 */ }
      }
    });
  });
}

// 저장된 파일이 있는 폴더 열기 — "받았다는데 어디 있지?"를 없앤다.
ipcMain.handle("download:reveal", async (_e, filePath: string) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return { ok: true };
});

// 클라이언트는 한 번에 하나만 뜬다(2026-07-28 사용자 지시).
//
// 왜 막아야 하나 — 서버는 담당자 한 명당 세션 하나만 인정한다. 앱을 두 번째로 띄우고
// 로그인하면 **먼저 쓰던 앱이 로그인 화면으로 튕기고**, 그쪽에서 열어 둔 탭·걸어 둔 필터·
// 내려 둔 스크롤이 통째로 날아간다. 게시 계정으로 같은 사고를 이미 겪었다(CLAUDE.md 주의사항).
// 아이콘을 두 번 눌렀을 뿐인데 하던 일이 사라지는 건 사람 잘못이 아니라 앱이 막았어야 할 일이다.
//
// 두 번째 프로세스는 조용히 물러나고, 대신 이미 떠 있는 창을 앞으로 가져온다 —
// "안 떠요"가 아니라 "아, 이미 떠 있었네"가 되게.
//
// ⚠ 잠금은 userData 기준이다. 예전엔 개발 실행과 설치본이 같은 잠금을 써서, 담당자가
//   설치본을 쓰고 있으면 개발 실행이 조용히 물러났다(2026-07-29 실측 — 검증하려면 사용자
//   앱을 꺼야 했다). 개발 실행(비패키지)은 프로필을 분리해 설치본과 공존시킨다 —
//   담당자의 앱을 건드리지 않고 개발·검증할 수 있어야 한다.
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "gijo-as-client-dev"));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    loadSavedRoot(); // 마지막에 고른 파일 탐색기 폴더 복원 (userData는 ready 이후 접근)
    loadSavedZoom(); // 마지막에 고른 화면 크기(배율) 복원
    setupDownloads(); // 파일 받기 저장 경로 — 이게 없으면 내려받기가 조용히 실패한다
    // ⚠ 순서가 중요하다 — **서버를 띄우기 전에** 첫 설치를 판정한다. 서버가 뜨면 그 자리에서
    //   DB가 생겨 판정이 뒤집힌다. 그리고 첫 설치면 여기서 띄우지 않는다 —
    //   관리자 계정을 고객에게 받아 그 값을 넣고 띄워야 하기 때문이다(setup:createAdmin).
    const 서버구성 = 번들서버구성();
    첫설치 = !!서버구성 && 서버구성.패키징본 && !fs.existsSync(DB경로(서버구성));
    if (!첫설치) maybeStartBundledServer();
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

// 창을 닫거나 앱을 종료할 때, 로그인돼 있으면 서버 세션을 먼저 끊는다(로그아웃).
// 이렇게 하지 않으면 강제 로그인한 세션이 그대로 남아, 다음 실행 때 "이미 로그인 중"으로 막히거나
// (동봉 서버 모드) 유령 세션이 남는다. 로그아웃은 서버를 죽이기 "전에" 해야 도달한다.
let quitCleanupDone = false;
async function logoutOnQuit(): Promise<void> {
  if (quitCleanupDone) return;
  quitCleanupDone = true;
  if (authState.accessToken && authState.serverUrl) {
    await new Promise<void>((resolve) => {
      try {
        const u = new URL(`${authState.serverUrl}/api/auth/logout`);
        const lib = u.protocol === "https:" ? https : http;
        // 세션은 refresh token으로 식별·정리되므로 반드시 본문에 실어 보낸다. 예전엔 access token 헤더만
        // 보내 서버가 revoke할 refresh token을 못 받아, 창을 닫아도 세션이 안 끊기던 버그(2026-07-23 수정).
        const body = JSON.stringify({ refreshToken: authState.refreshToken });
        const req = lib.request(
          u,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authState.accessToken}`,
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            timeout: 3000,
          },
          (res) => { res.on("data", () => {}); res.on("end", () => resolve()); }
        );
        req.on("error", () => resolve());
        req.on("timeout", () => { req.destroy(); resolve(); });
        req.write(body);
        req.end();
      } catch { resolve(); }
    });
  }
  if (bundledServerProcess) { bundledServerProcess.kill(); bundledServerProcess = null; }
}

app.on("before-quit", (e) => {
  if (quitCleanupDone) return; // 정리 끝 — 정상 종료 진행
  e.preventDefault(); // 비동기 로그아웃을 기다렸다가 다시 종료
  logoutOnQuit().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit(); // → before-quit에서 세션 정리 후 종료
});
