// GIJO AS 클라이언트 — Electron 메인 프로세스
// [CS 구조 변경] engine/ 모듈을 더 이상 임포트하지 않는다(전부 서버로 이전됨).
// main.ts는 창 관리와 페이지 네비게이션만 담당하는 얇은 셸이다.

import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, screen, session } from "electron";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { isDangerous } from "./terminalPolicy";

let mainWindow: BrowserWindow | null = null;
let officeWindow: BrowserWindow | null = null; // "우리 AI 팀 사무실" 별도 창(시안 B) — 관제 모니터 상시용
let quitConfirmed = false; // 메인 창 닫기 확인을 통과했는가 — 재시작·업데이트는 true로 건너뛴다
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
    backgroundColor: "#0a0e1a",
    title: "GIJO AS — AI Security Manager OS",
    // C안(2026-07-25): OS 타이틀바 제거 — 각 페이지의 .header가 타이틀바 역할(드래그 영역, titlebar.js).
    // 창 컨트롤(─ ▢ ✕)은 OS가 오버레이로 그린다(직접 구현 안 함). mac은 신호등이 좌측 인셋.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0e1526", symbolColor: "#8b93ab", height: 46 },
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
  mainWindow.loadFile(path.join(__dirname, "../src/renderer/pages/login.html"));

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

ipcMain.handle("navigate:to", async (_e, page: string) => {
  if (!mainWindow) return;
  // 허브 딥링크(hub.html?g=assets&t=vulnscan.html) 지원 — 파일 경로와 쿼리를 분리해 loadFile에 넘긴다.
  const [file, qs] = String(page).split("?");
  const query: Record<string, string> = {};
  if (qs) for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  await mainWindow.loadFile(path.join(__dirname, `../src/renderer/pages/${file}`), qs ? { query } : undefined);
});

// "우리 AI 팀 사무실" 별도 창 — 이미 열려 있으면 앞으로만 가져온다(중복 창 방지).
// 인증 토큰은 메인 프로세스 authState에 있으므로(위 auth:getState) 새 창도 로그인 상태를 공유한다.
ipcMain.handle("office:open", async () => {
  if (officeWindow && !officeWindow.isDestroyed()) {
    officeWindow.focus();
    return;
  }
  officeWindow = new BrowserWindow({
    // 3열(할일 236 · 사무실 · 브리핑 250)이 다 들어가야 글이 안 잘린다(2026-07-26 사용자 결정).
    // 화면이 작으면 그 화면에 맞춰 줄인다 — 창이 화면 밖으로 나가는 게 더 나쁘다.
    width: Math.min(1360, Math.max(1000, screen.getPrimaryDisplay().workAreaSize.width - 120)),
    height: Math.min(840, Math.max(700, screen.getPrimaryDisplay().workAreaSize.height - 120)),
    minWidth: 1080,
    minHeight: 620,
    backgroundColor: "#0a0e1a",
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
    backgroundColor: "#0a0e1a",
    title: title ? `GIJO AS — ${title}` : "GIJO AS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 분리 창은 허브(hub.html)를 띄운다 — 허브는 화면을 iframe으로 품으므로 서브프레임에도
      // preload(window.gijo)가 필요하다(메인 창과 동일). 빠뜨리면 탭 안이 "불러오지 못했습니다"로 죽는다
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
  // popout=1·orient — 분리창임을 페이지에 알린다(허브가 가로/세로 전환 버튼을 그린다).
  // ⚠ 로드 주소에 창 구분용 접미사를 섞으면 g 파라미터가 오염돼 "알 수 없는 허브"가 뜬다(실측 버그).
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
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.5;
const ZOOM_STEPS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
let uiZoom = 1;

function zoomStateFile(): string {
  return path.join(app.getPath("userData"), "ui-zoom.txt");
}
function clampZoom(v: number): number {
  return Number.isFinite(v) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)) : 1;
}
function loadSavedZoom(): void {
  try {
    uiZoom = clampZoom(Number(fs.readFileSync(zoomStateFile(), "utf-8").trim()));
  } catch {
    /* 저장값 없음 — 100% 유지 */
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
}

ipcMain.handle("ui:getZoom", () => ({ zoom: uiZoom, steps: ZOOM_STEPS, min: ZOOM_MIN, max: ZOOM_MAX }));
ipcMain.handle("ui:setZoom", (_e, factor: number) => {
  uiZoom = clampZoom(Number(factor));
  try {
    fs.writeFileSync(zoomStateFile(), String(uiZoom), "utf-8");
  } catch {
    /* 저장 실패는 무시 — 이번 실행에는 적용된다 */
  }
  for (const w of BrowserWindow.getAllWindows()) applyZoom(w);
  return uiZoom;
});
// 단축키(+/-)용 — 현재 값에서 프리셋 한 칸 이동. 화면이 직접 계산하지 않게 여기서 처리한다.
ipcMain.handle("ui:stepZoom", (_e, dir: number) => {
  const d = Number(dir) > 0 ? 1 : -1;
  let i = ZOOM_STEPS.findIndex((s) => Math.abs(s - uiZoom) < 0.001);
  if (i === -1) i = ZOOM_STEPS.findIndex((s) => s >= uiZoom); // 프리셋 밖의 값이면 가까운 칸부터
  if (i === -1) i = ZOOM_STEPS.length - 1;
  uiZoom = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + d))];
  try {
    fs.writeFileSync(zoomStateFile(), String(uiZoom), "utf-8");
  } catch {
    /* 저장 실패는 무시 */
  }
  for (const w of BrowserWindow.getAllWindows()) applyZoom(w);
  return uiZoom;
});

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
  await downloadToFile(
    `${authState.serverUrl}/api/client/download/${encodeURIComponent(version)}`,
    { Authorization: `Bearer ${authState.accessToken}` },
    dest,
    sendProgress
  );
  const child = spawn(dest, ["/S", "--force-run"], { detached: true, stdio: "ignore" });
  child.unref();
  quitConfirmed = true; // 업데이트 설치를 위한 의도된 종료 — 닫기 확인을 띄우지 않는다
  setTimeout(() => app.quit(), 300); // 설치 프로그램이 뜰 시간을 살짝 준다
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
      // 렌더러가 "어디에 저장됐는지"를 사용자에게 보여줄 수 있게 알린다.
      win?.webContents.send("download:done", {
        ok: state === "completed",
        path: state === "completed" ? dest : null,
        filename: path.basename(dest),
        state,
      });
    });
  });
}

// 저장된 파일이 있는 폴더 열기 — "받았다는데 어디 있지?"를 없앤다.
ipcMain.handle("download:reveal", async (_e, filePath: string) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return { ok: true };
});

app.whenReady().then(() => {
  loadSavedRoot(); // 마지막에 고른 파일 탐색기 폴더 복원 (userData는 ready 이후 접근)
  loadSavedZoom(); // 마지막에 고른 화면 크기(배율) 복원
  setupDownloads(); // 파일 받기 저장 경로 — 이게 없으면 내려받기가 조용히 실패한다
  maybeStartBundledServer();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

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
