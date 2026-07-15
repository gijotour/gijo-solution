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
function maybeStartBundledServer(): void {
  if (process.env.GIJO_SERVER_URL) return; // 원격 서버를 명시적으로 지정한 경우 번들 서버 기동 안 함

  const candidates = [
    path.join(process.resourcesPath, "server-dist/dist/index.js"), // 패키징된 배포판(extraResources)
    path.join(__dirname, "../server-dist/dist/index.js"), // dev: npm run build-server-dist
    path.join(__dirname, "../../server/dist/index.js"), // dev: sibling 폴더의 서버 직접 빌드
  ];
  const bundledServerEntry = candidates.find((p) => fs.existsSync(p));
  if (!bundledServerEntry) return; // 서버가 동봉되지 않은 배포(순수 클라이언트)

  // cwd를 서버 자신의 위치(dist/의 부모)로 고정한다 — db.ts/memory.ts가 "data/..." 같은 상대경로를
  // 쓰기 때문에, 지정하지 않으면 Electron이 실행된 위치에 따라 데이터가 엉뚱한 곳에 생긴다.
  const serverRoot = path.dirname(path.dirname(bundledServerEntry));
  bundledServerProcess = spawn(process.execPath, [bundledServerEntry], {
    cwd: serverRoot,
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
