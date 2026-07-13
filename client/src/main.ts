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
let authState: { token: string | null; serverUrl: string | null } = { token: null, serverUrl: null };

ipcMain.on("auth:getState", (event) => {
  event.returnValue = authState;
});
ipcMain.on("auth:setState", (_event, state: { token: string | null; serverUrl: string | null }) => {
  authState = state;
});

/**
 * "단일 데스크톱 모드": ../server 디렉터리가 존재하면(같은 배포 패키지에 서버가
 * 동봉된 경우) 클라이언트가 자체적으로 서버를 localhost로 기동한다.
 * 사내망에 별도 서버(RTX 3090 머신)가 이미 떠 있는 "분산 모드"에서는
 * GIJO_SERVER_URL 환경변수만 그 서버 주소로 지정하고 이 로직은 건너뛴다.
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
