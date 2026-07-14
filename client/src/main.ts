// GIJO AS 클라이언트 — Electron 메인 프로세스
// [CS 구조 변경] engine/ 모듈을 더 이상 임포트하지 않는다(전부 서버로 이전됨).
// main.ts는 창 관리와 페이지 네비게이션만 담당하는 얇은 셸이다.

import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;
let bundledServerProcess: ChildProcess | null = null;

// 페이지 전체 네비게이션(loadFile) 시마다 preload가 재실행되어 사라지는 인증 토큰/서버 주소를
// 여기(메인 프로세스, 앱 생명주기 동안 유지됨)에 보관한다 — apiClient.ts가 동기 IPC로 읽고 쓴다.
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
}
let authState: AuthState = { accessToken: null, refreshToken: null, serverUrl: null };

ipcMain.on("auth:getState", (event) => {
  event.returnValue = authState;
});
ipcMain.on("auth:setState", (_event, state: AuthState) => {
  authState = state;
});

/**
 * "단일 데스크톱 모드": ../server 디렉터리가 존재하면(같은 배포 패키지에 서버가
 * 동봉된 경우) 클라이언트가 자체적으로 서버를 localhost로 기동한다.
 * 사내망에 별도 서버(RTX 3090 머신)가 이미 떠 있는 "분산 모드"에서는
 * GIJO_SERVER_URL 환경변수만 그 서버 주소로 지정하고 이 로직은 건너뛴다.
 *
 * 주의(네이티브 모듈 ABI): 이 스폰은 ELECTRON_RUN_AS_NODE로 Electron에 내장된 Node 런타임을
 * 쓴다(사용자 PC에 별도 Node.js 설치를 요구하지 않기 위해). 그런데 server의 better-sqlite3(db.ts)는
 * 네이티브 애드온이라 `npm install`로 받은 기본 바이너리는 *시스템* Node ABI로 컴파일돼 있고,
 * 이 시스템 Node ABI 바이너리는 Electron의 내장 Node ABI와 달라 여기서 로드에 실패한다
 * (ERR_DLOPEN_FAILED로 서버 프로세스가 즉시 죽고 로그인이 "서버 연결 끊김"으로 보임).
 * 단일 데스크톱 모드를 로컬에서 띄워볼 때는 먼저
 *   cd client && npm run rebuild-server-native
 * 로 better-sqlite3를 Electron ABI로 재빌드할 것 — 이후 server/의 `npm test`나
 * `node dist/index.js`(시스템 Node 직접 실행)를 다시 돌리려면
 *   cd server && npm rebuild better-sqlite3
 * 로 시스템 Node ABI로 되돌려야 한다(같은 node_modules가 두 ABI를 동시에 지원 못 함).
 * 진짜 해결책은 패키징 파이프라인에서 배포용 서버 사본에만 리빌드를 적용하는 것 —
 * 지금은 electron-builder files에 server/가 아예 포함돼 있지 않아 실제 패키징 자체가
 * 아직 이 흐름을 타지 않는다(9.3절 단일 데스크톱 모드는 현재 dev 환경 전제).
 */
function maybeStartBundledServer(): void {
  if (process.env.GIJO_SERVER_URL) return; // 원격 서버를 명시적으로 지정한 경우 번들 서버 기동 안 함

  const bundledServerEntry = path.join(__dirname, "../../server/dist/index.js");
  if (!fs.existsSync(bundledServerEntry)) return; // 서버가 동봉되지 않은 배포(순수 클라이언트)

  bundledServerProcess = spawn(process.execPath, [bundledServerEntry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#0a0e1a",
    title: "GIJO AS — AI Security Manager OS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 상단 기본 메뉴바(File, Edit, View, Window, Help) 제거
  mainWindow.removeMenu();

  // 최초 화면은 로그인. 인증 성공 후 renderer/core.ts가 대시보드로 전환한다.
  mainWindow.loadFile(path.join(__dirname, "../src/renderer/pages/login.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("navigate:to", async (_e, page: string) => {
  if (!mainWindow) return;
  await mainWindow.loadFile(path.join(__dirname, `../src/renderer/pages/${page}`));
});

app.whenReady().then(() => {
  maybeStartBundledServer();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (bundledServerProcess) bundledServerProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (bundledServerProcess) bundledServerProcess.kill();
});
