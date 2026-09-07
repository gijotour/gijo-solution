// GIJO AS 클라이언트 — preload 스크립트
// contextIsolation 환경에서 렌더러가 접근 가능한 안전한 API 표면을 정의한다.
// [CS 구조 변경] 기존에는 ipcRenderer.invoke()가 메인 프로세스의 로컬 엔진을 직접 호출했으나,
// 지금은 apiClient.ts를 통해 원격 GIJO AS 서버(REST)를 호출한다.
// 실시간 이벤트(collaboration:event, finetune:progress, asset:updated, log:event, hf-download:progress)는 WebSocket(wsClient.ts)으로 수신한다.

import { contextBridge, ipcRenderer } from "electron";
import * as api from "./apiClient";
import { connectWebSocket, onChannel, onWsState } from "./wsClient";
import { classifyChatbotCommand } from "./terminalPolicy";

// keepalive/세션 상태 — 아래 IIFE(실사용 감지)와 gijoApi(세션 칩 UI)가 공유한다.
// idleTimeoutMs는 서버 GIJO_IDLE_TIMEOUT_MS 기본값(30분)과 맞춘다.
const keepalive = { lastActivity: Date.now(), idleTimeoutMs: 30 * 60 * 1000 };

const gijoApi = {
  // 서버 연결 설정
  setServerUrl: (url: string) => api.setServerUrl(url),
  getServerUrl: () => api.getServerUrl(),
  checkServerHealth: () => api.healthApi.check(),

  // 인증(보안담당자별 로그인) — force: 이미 다른 곳에서 로그인 중이어도 강제로 이 세션을 새 세션으로 대체
  login: (username: string, password: string, force?: boolean) => api.authApi.login(username, password, force),
  // 로그인 2단계(2차 인증) — login()이 code:"mfa_required"와 함께 준 mfaToken을 들고 6자리를 보낸다.
  loginMfa: (mfaToken: string, code: string, isRecovery?: boolean) => api.authApi.loginMfa(mfaToken, code, isRecovery),
  // 2차 인증 등록·해제·관리(설정 화면). 등록 확인이 성공하면 apiClient가 토큰 승격까지 처리한다.
  mfaStatus: () => api.authApi.mfaStatus(),
  mfaStart: () => api.authApi.mfaStart(),
  mfaConfirm: (code: string) => api.authApi.mfaConfirm(code),
  mfaDisable: (password: string) => api.authApi.mfaDisable(password),
  mfaRegenerateRecovery: (password: string) => api.authApi.mfaRegenerateRecovery(password),
  mfaUserList: () => api.authApi.mfaUserList(),
  docboxList: () => api.docboxApi.list(),
  docboxRead: (id: string) => api.docboxApi.read(id),
  docboxSearch: (q: string) => api.docboxApi.search(q),
  personalDocsList: () => api.personalDocsApi.list(),
  personalDocsRead: (id: string) => api.personalDocsApi.read(id),
  personalDocsCreate: (b: { title: string; body: string }) => api.personalDocsApi.create(b),
  personalDocsUpdate: (id: string, b: { title: string; body: string }) => api.personalDocsApi.update(id, b),
  personalDocsRag: (id: string, on: boolean) => api.personalDocsApi.setRag(id, on),
  personalDocsShare: (id: string, on: boolean) => api.personalDocsApi.setShared(id, on), // 위치 인자(객체면 500)
  personalDocsExport: (id: string, fmt: "docx" | "pdf" | "html") => api.personalDocsApi.export(id, fmt), // 위치 인자
  // 첨부(캡처) — 우리가 약속한 「화면 캡처 Ctrl+V 삽입」. 본문엔 표기만 들어가고 파일은 서버에.
  personalDocsFiles: (id: string) => api.personalDocsApi.files(id),
  personalDocsAddFile: (id: string, b: { name: string; mime: string; content: string }) => api.personalDocsApi.addFile(id, b),
  personalDocsReadFile: (fileId: string) => api.personalDocsApi.readFile(fileId),
  personalDocsRemoveFile: (fileId: string) => api.personalDocsApi.removeFile(fileId),
  // 버전 이력 — 약속 목록의 「문서 이력」.
  personalDocsVersions: (id: string) => api.personalDocsApi.versions(id),
  personalDocsVersionBody: (versionId: number) => api.personalDocsApi.versionBody(versionId),
  personalDocsDelete: (id: string) => api.personalDocsApi.remove(id),
  docRequestBuild: (input: Parameters<typeof api.docRequestApi.build>[0]) => api.docRequestApi.build(input),
  docRequestList: () => api.docRequestApi.list(),
  // 챗 모델 폴더 — 화면이 실제 경로를 보여주고(getModelsFolderPath) 「폴더 열기」로 탐색기까지 연다.
  //   라이트 첫날 「.gguf 어디 넣지?」를 없앤다(순환 참조 수리, 2026-08-14).
  getModelsFolderPath: () => ipcRenderer.invoke("models:folder-path") as Promise<string>,
  openModelsFolder: () => ipcRenderer.invoke("models:open-folder") as Promise<{ path: string }>,
  // 라이트 「보안 장비 등록부」 직접 접근 — 장비 관리 URL을 OS 기본 앱(브라우저·SSH·RDP)으로 넘긴다.
  //   ⚠ 스킴은 메인에서 검사한다(http/https/ssh/rdp/vnc만). 비밀번호는 절대 실어 보내지 않는다.
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url) as Promise<{ ok: boolean }>,
  //   도달 확인 — 지정 host:port에 TCP로 붙어 보고 살아있나만 본다(ICMP 아님, 권한 불필요).
  probeHost: (host: string, port: number, timeoutMs?: number) =>
    ipcRenderer.invoke("net:probe", host, port, timeoutMs) as Promise<{ up: boolean; ms: number }>,
  dbCryptStatus: () => api.dbCryptApi.status(),
  dbCryptRotateRecovery: () => api.dbCryptApi.rotateRecovery(),
  // 저장 암호화 켜기 — **서버가 아니라 메인 프로세스**가 한다. 전환에 서버 정지가 필요한데
  // 그 서버를 띄운 것이 이 앱이기 때문이다(main.ts의 dbcrypt:enable 주석 참고).
  dbCryptCanEnableInApp: () => ipcRenderer.invoke("dbcrypt:canEnableInApp"),
  dbCryptEnable: () => ipcRenderer.invoke("dbcrypt:enable"),
  // 첫 설치 — 관리자 계정을 고객이 정한다(setup.html). 서버는 이 값을 받아 계정을 만든다.
  setupNeeded: () => ipcRenderer.invoke("setup:needed"),
  setupCreateAdmin: (username: string, password: string) => ipcRenderer.invoke("setup:createAdmin", username, password),
  // 에디션 조회·라이트 모드 전환(2026-08-13 사장님 지시 2번) — main.ts의 seam(edition:get/set)에
  // 닿는 **유일한 다리**다. ⚠ 이 두 줄이 없으면 seam은 「설계는 됐고 쓰인 적 없다」가 된다
  //   (max가 정확히 그렇게 짚었다: 「preload 다리 0 · 설정 토글 0 — 켜고 끌 방법이 없다」).
  //   스위치 UI는 시안 승인 후 설정 화면에 얹는다 — 다리는 UI가 아니므로 먼저 놓는다.
  // 원격 GPU(BridgeAI · VPN 전용) — 설정 카드(라이트·표준 공용)가 쓴다.
  remoteLlmGet: () => api.remoteLlmApi.get(),
  remoteLlmTest: (url: string) => api.remoteLlmApi.test(url),
  remoteLlmSet: (enabled: boolean, url: string) => api.remoteLlmApi.set(enabled, url),
  // 담당자도 「내 질문이 원격으로 나가나」를 볼 수 있어야 한다(admin 전용 조회와 별개).
  remoteLlmWhere: () => api.remoteLlmApi.where(),
  // 이 PC를 원격 GPU로 내주기(받는 쪽) — 붙는 쪽만 있고 붙을 상대를 만들 길이 없던 구멍을 메운다.
  llmServeGet: () => api.llmServeApi.get(),
  llmServeSet: (enabled: boolean) => api.llmServeApi.set(enabled),
  editionGet: () => ipcRenderer.invoke("edition:get"),
  // 셸 모드(standard/pro) — **에디션과 다른 축**이다. 에디션은 「어떤 상품인가」(데이터 폴더·도구 수),
  // 셸 모드는 「화면을 어떻게 그리나」다. 프로는 도구도 데이터도 스탠다드와 같다.
  shellModeGet: () => ipcRenderer.invoke("shell:get") as Promise<{ 현재: string; 쓸수있나: boolean }>,
  shellModeSet: (mode: string) => ipcRenderer.invoke("shell:set", mode) as Promise<{ ok: boolean; 현재?: string; error?: string }>,
  editionSet: (mode: string) => ipcRenderer.invoke("edition:set", mode),
  mfaResetUser: (userId: string) => api.authApi.mfaResetUser(userId),
  mfaPolicy: () => api.authApi.mfaPolicy(),
  mfaSetPolicy: (on: boolean) => api.authApi.mfaSetPolicy(on),
  logout: () => api.authApi.logout(),
  me: () => api.authApi.me(),
  isAuthenticated: () => api.isAuthenticated(),
  listActiveSessions: () => api.authApi.sessions(), // 접속 중 클라이언트(외부 콘솔) — 팀 사무실 presence
  // 세션 잔여 시간(유휴 만료까지) — 상단 세션 칩 표시용. 실사용 감지 keepalive가 찍는 마지막 활동 기준.
  sessionActivity: () => ({
    idleTimeoutMs: keepalive.idleTimeoutMs,
    remainingMs: Math.max(0, keepalive.idleTimeoutMs - (Date.now() - keepalive.lastActivity)),
  }),
  // 세션 연장(상단 "연장" 버튼) — 활동 시각 리셋 + 인증 핑으로 서버 lastSeenAt 갱신.
  extendSession: () => {
    keepalive.lastActivity = Date.now();
    return api.authApi.me();
  },

  // 계정 관리(admin 전용 목록/생성/삭제 — 본인 비밀번호 변경은 누구나)
  listUsers: () => api.usersApi.list(),
  listAssignableUsers: () => api.usersApi.assignable(), // 담당자 배정용 — admin 아니어도 조회 가능
  createUser: (args: { username: string; password: string; displayName: string; role: "security_officer" | "admin" }) =>
    api.usersApi.create(args),
  deleteUser: (id: string) => api.usersApi.remove(id),
  changeUserPassword: (id: string, password: string) => api.usersApi.changePassword(id, password),
  setUserRole: (id: string, role: "security_officer" | "admin") => api.usersApi.setRole(id, role),
  setUserClearance: (id: string, clearance: string) => api.usersApi.setClearance(id, clearance),
  listSessions: () => api.usersApi.sessions(),
  terminateUserSession: (id: string) => api.usersApi.terminateSession(id),

  // 네비게이션(렌더러 내 페이지 전환은 메인 프로세스에 위임)
  //
  // ★ 탭 안(embed)에서 부르면 **탭 하나 더 열기**로 바꾼다(2026-07-31).
  //   그전에는 앱을 통째로 갈아치워, 취약점 화면에서 한 건을 누르는 순간 옆 탭에 걸어 둔
  //   조건과 스크롤이 전부 사라졌다(실측). 담당자는 "그냥 눌렀을 뿐"인데 작업이 날아간다.
  //
  //   호출부가 60곳이 넘어 하나씩 고치면 반드시 빠뜨린다. 그렇다고 nav.js에서 이 함수를
  //   갈아끼울 수도 없다 — contextBridge로 노출한 객체는 **렌더러에서 못 고친다**(조용히 무시된다.
  //   실제로 그렇게 시도했다가 아무 일도 안 일어났다). 그래서 다리인 여기서 판단한다.
  //   ⚠ login.html은 예외 — 로그아웃·인증 만료는 앱을 통째로 되돌리는 게 맞다.
  navigateTo: (page: string) => {
    const p = String(page ?? "");
    const 탭안 =
      window.parent !== window &&
      /(^|[?&])embed=1(&|$)/.test(window.location.search);
    if (탭안 && p && !p.startsWith("login.html")) {
      window.parent.postMessage({ type: "gijo:openTab", page: p, label: null }, "*");
      return Promise.resolve();
    }
    return ipcRenderer.invoke("navigate:to", p);
  },
  // 🚀 프로 팝업 배관(2026-08-19) — 별도 창에서는 window.top이 자기 자신이라 postMessage가
  // 셸에 못 닿는다. 이 세 다리가 그 길을 놓는다(처리 코드는 셸의 기존 리스너 재사용).
  closeShellPopout: (page: string) => ipcRenderer.invoke("shell:closePopout", page),
  closeAllPopouts: () => ipcRenderer.invoke("shell:closeAllPopouts"), // 💬 새 대화 — 팝업 전부 닫기(2026-08-20)
  bridgeToShell: (d: unknown) => ipcRenderer.send("gijo:bridge", d),
  onShellBridge: (cb: (d: unknown) => void) => { ipcRenderer.on("gijo:bridge", (_e, d) => cb(d)); },
  broadcastToWindows: (d: unknown) => ipcRenderer.send("gijo:broadcast", d),
  flashShell: () => ipcRenderer.send("shell:flash"),
  // (openSmartMd — 2026-08-22 제거. 문서 작성이 「내 문서」 화면 안으로 들어왔다.)
  // "우리 AI 팀 사무실" 별도 창(시안 B) — 열기 + 항상 위 고정 토글
  openTeamOffice: () => ipcRenderer.invoke("office:open"),
  setOfficeAlwaysOnTop: (on: boolean) => ipcRenderer.invoke("office:setAlwaysOnTop", on),
  // 팝업 셸 "창으로 분리"(혼합 방식) — 팝업으로 보던 화면을 별도 창으로 떼어낸다(shell-popup.js가 사용).
  // orient="portrait"면 세로(피벗) 모니터용 길쭉한 창 — 세로 모니터가 있으면 거기 자동 배치.
  openShellPopout: (page: string, title?: string, orient?: string, theme?: string) => ipcRenderer.invoke("shell:popout", page, title, orient, theme),
  // 분리창 자신이 가로/세로를 전환한다(hub.html 헤더 버튼) — 모니터 배치는 그 창에서.
  setPopoutOrientation: (orient: string) => ipcRenderer.invoke("shell:popoutOrient", orient),
  // 분리창이 "지금 보고 있는 탭"을 대시보드에 알린다 — 그 화면을 향해 바로 지시할 수 있게.
  reportPopoutTab: (page: string, label: string) => ipcRenderer.invoke("shell:popoutTab", page, label),
  // ── 대화 콘솔 창(4.0.0) — 기본은 셸 아래 도킹, 모니터가 여럿이면 창으로 빼낸다.
  openConsoleWindow: (theme?: string) => ipcRenderer.invoke("console:popout", theme), // 위치 인자 관례
  // 지휘소(별도 대화 창)에서 본창에 탭을 연다. navigateTo와 다르다 — 그건 본창을 통째로
  // 갈아치워 열려 있던 탭이 다 사라진다. 이건 **탭 하나 추가**다.
  openTabInShell: (page: string, label?: string) => ipcRenderer.invoke("shell:openTab", page, label),
  onShellOpenTab: (cb: (i: { page: string; label: string | null }) => void) => {
    ipcRenderer.removeAllListeners("shell:openTab");
    ipcRenderer.on("shell:openTab", (_e, i) => cb(i));
  },
  // 어느 화면·어느 창에서든 지휘소(대화창)에 지시를 건넨다. 화면이 스스로 dispatch를 부르면
  // 결재판을 못 그려 쓰기 지시가 막다른 길이 된다 — 지시는 대화창 한 곳으로 모은다.
  askConsole: (text: string, sessionId?: string) => ipcRenderer.invoke("console:ask", text, sessionId),
  onConsoleAsk: (cb: (text: string, sessionId: string | null) => void) => {
    ipcRenderer.removeAllListeners("console:ask");
    ipcRenderer.on("console:ask", (_e, i) => cb(String((i && i.text) || ""), (i && i.sessionId) || null));
  },
  // ★ 프로 셸 이탈 금지(2026-08-19) — main이 화면 파일 직접 로드 요청을 탭 열기로 승격해 보낸다.
  onOpenTabPush: (cb: (page: string) => void) => {
    ipcRenderer.removeAllListeners("shell:openTabPush");
    ipcRenderer.on("shell:openTabPush", (_e, i) => cb(String((i && i.page) || "")));
  },
  dockConsoleWindow: () => ipcRenderer.invoke("console:dock"),
  // 셸이 "지금 보고 있는 탭"을 콘솔 창에 알린다(별도 창은 활성 탭을 직접 못 본다).
  sendConsoleContext: (screen: string | null, label: string | null) => ipcRenderer.invoke("console:context", screen, label),
  onConsoleContext: (cb: (info: { screen: string | null; label: string | null }) => void) => {
    ipcRenderer.removeAllListeners("console:context");
    ipcRenderer.on("console:context", (_e, i) => cb(i));
  },
  // 콘솔 창이 닫히면 셸이 다시 아래에 붙인다 — 안 그러면 대화할 곳이 사라진다.
  onConsoleClosed: (cb: () => void) => {
    ipcRenderer.removeAllListeners("console:closed");
    ipcRenderer.on("console:closed", () => cb());
  },
  // 🔑 셸 단축키(2026-09-02 여정 점검 F3-04) — Ctrl/Cmd+K(화면 찾기)·Alt+←/→(뒤로·앞으로)·Ctrl+B(왼쪽 판).
  // 화면(iframe)에 포커스가 있으면 렌더러 keydown은 그 iframe 문서에서만 터져 셸에 닿지 않는다.
  // 메인 프로세스의 before-input-event만이 **모든 프레임의 키**를 본다 — 거기서 잡아 이 다리로 넘긴다.
  // ⚠ 받는 쪽은 키를 누른 그 창이다(main.ts가 mainWindow가 아니라 win에 보낸다).
  onShellHotkey: (cb: (kind: "finder" | "back" | "forward" | "leftpane") => void) => {
    ipcRenderer.removeAllListeners("shell:hotkey");
    ipcRenderer.on("shell:hotkey", (_e, kind: string) => cb(kind as "finder" | "back" | "forward" | "leftpane"));
  },

  // 대시보드가 분리창의 포커스·탭·닫힘을 받아 명령 맥락에 반영한다.
  onPopoutContext: (cb: (kind: "focus" | "tab" | "closed", info: Record<string, unknown>) => void) => {
    ipcRenderer.removeAllListeners("shell:popoutFocus");
    ipcRenderer.removeAllListeners("shell:popoutTab");
    ipcRenderer.removeAllListeners("shell:popoutClosed");
    ipcRenderer.on("shell:popoutFocus", (_e, i) => cb("focus", i));
    ipcRenderer.on("shell:popoutTab", (_e, i) => cb("tab", i));
    ipcRenderer.on("shell:popoutClosed", (_e, i) => cb("closed", i));
  },

  // 화면 크기(UI 배율) — 설정 › 화면 크기와 단축키(Cmd/Ctrl +·-·0)가 쓴다.
  // 배율은 메인 프로세스가 webContents 단위로 걸어 허브 iframe까지 함께 적용된다.
  getUiZoom: () => ipcRenderer.invoke("ui:getZoom"),
  setUiZoom: (factor: number) => ipcRenderer.invoke("ui:setZoom", factor),
  stepUiZoom: (dir: number) => ipcRenderer.invoke("ui:stepZoom", dir),
  // 타이틀바 ⚙ 메뉴(C안): 전체화면 토글·앱 재시작·진단 정보(titlebar.js가 사용)
  toggleFullscreen: () => ipcRenderer.invoke("ui:toggleFullscreen") as Promise<boolean>,
  restartApp: () => ipcRenderer.invoke("app:restart"),
  getAppInfo: () =>
    ipcRenderer.invoke("app:info") as Promise<{ version: string; electron: string; platform: string; arch: string; osRelease: string }>,
  listDir: (relPath: string) => ipcRenderer.invoke("fs:list", relPath) as Promise<{ root: string; rootName: string; path: string; items: { name: string; dir: boolean }[] }>,
  pickWorkFolder: () => ipcRenderer.invoke("fs:pickRoot") as Promise<{ cancelled: boolean; root?: string; rootName?: string }>,
  readFile: (relPath: string) => ipcRenderer.invoke("fs:readFile", relPath) as Promise<{ name: string; size: number; content: string }>,

  // 에이전트 AI / 지시(디스패처)
  listAgents: () => api.agentsApi.list(),
  // AI 팀 감독(2026-08-20 ②) — ⚠ 위치 인자(객체로 바꾸면 500 — preload API 관례)
  aiteamSupervision: (days: number) => api.agentsApi.supervision(days),
  setAgentModel: (agentId: string, modelId: string | null) => api.agentsApi.setModel(agentId, modelId),
  // 팀원별 두뇌 위치 — null이면 전역 따름. 총괄은 서버가 막는다(라우팅 판단에 느린 두뇌 금지).
  setAgentLocation: (agentId: string, location: string | null) => api.agentsApi.setLocation(agentId, location),
  setAgentName: (agentId: string, name: string | null) => api.agentsApi.setName(agentId, name),
  // AI팀 구성 한눈에(2026-08-09) — 기반 두뇌·전문성·☁ 외부 상담역 집계(설정·팀 사무실 공용)
  getTeamComposition: () => api.agentsApi.composition(),
  getAgentRecommendations: () => api.modelDexApi.agentRecommendations(),
  listModels: () => api.localEngineApi.models(),
  // screen: 지시가 들어온 화면 맥락 — 팝업 셸에서는 "지금 보고 있는 팝업"이 맥락이 된다(없으면 현재 문서).
  // selection: 화면에서 골라 둔 항목 — 「이거」의 대상(2026-08-09 2단계).
  // docIds: ☑ 근거 지정 · attachSessions: 📎 지난 작업 첨부(노트북형 2026-08-30) — 위치 인자로
  // 뒤에 더한다(preload API는 위치 인자 관례 — 객체로 바꾸면 기존 호출부가 조용히 깨진다).
  sendInstruction: (text: string, sessionId?: string, screen?: string, progressId?: string, selection?: string, docIds?: string[], attachSessions?: string[]) =>
    api.dispatchApi.send(text, sessionId, screen, progressId, selection, docIds, attachSessions),
  // 답 스트리밍(전-7) — 산문이 생성되는 대로 onDelta(토막)·onStart(새 산문 시작)가 불린다.
  // contextBridge는 인자로 넘긴 함수를 프록시로 감싸 렌더러로 되돌려 부른다.
  // 반환값은 출구 관문을 지난 최종 결과 — 화면은 흐르던 글자를 반드시 이것으로 갈아 끼운다.
  sendInstructionStream: (
    text: string,
    sessionId: string | undefined,
    screen: string | undefined,
    progressId: string | undefined,
    selection: string | undefined,
    onDelta: (t: string) => void,
    onStart?: () => void,
    docIds?: string[],
    attachSessions?: string[]
  ) => api.dispatchApi.sendStream(text, sessionId, screen, progressId, selection, { delta: onDelta, start: onStart }, docIds, attachSessions),
  dispatchProgress: (progressId: string) => api.dispatchApi.progress(progressId),
  // 화면 열기 → 현황 카드(2026-08-20) — 셸이 메뉴 열기 때 부른다(조회 전용).
  screenCard: (page: string, scope?: string) => api.dispatchApi.screenCard(page, scope),
  // 결재판 승인 실행 — 쓰기 도구는 이 경로로만 실행된다(지시만으로는 실행 안 됨).
  approveAgentTool: (tool: string, args: Record<string, string>, instruction = "") => api.dispatchApi.approve(tool, args, instruction),
  undoAgentTool: (id?: string) => api.dispatchApi.undo(id),

  // 작업 세션(대화 세션형) — 오케스트레이터 지시·응답을 세션 대화로 묶어 관리.
  listWorkSessions: () => api.workSessionsApi.list(),
  // 작업 내역 구분 축(승인 시안 2026-08-18) — 주체(👤내가/🤖시스템)·종류(🔧실행/🔍조회)·QA 표시.
  listWorkSessionsWithAxes: (f?: { origin?: string; opKind?: string; qa?: boolean }) =>
    api.workSessionsApi.listWithAxes(f ?? {}),
  sessionPatterns: (days?: number) => api.workSessionsApi.patterns(days),
  // 열린 창 목록·이동 — 빼낸 창이 본창 뒤에 숨어 못 찾는 일을 없앤다(4.0.1).
  listWindows: () => ipcRenderer.invoke("windows:list") as Promise<
    { id: string; kind: "main" | "popout" | "console" | "office"; label: string; focused: boolean; minimized: boolean }[]
  >,
  focusWindow: (id: string) => ipcRenderer.invoke("windows:focus", id) as Promise<{ ok: boolean }>,
  closeWindow: (id: string) => ipcRenderer.invoke("windows:close", id) as Promise<{ ok: boolean }>,
  createWorkSession: (title?: string, contextRef?: string) => api.workSessionsApi.create(title, contextRef),
  getWorkSession: (id: string) => api.workSessionsApi.get(id),
  updateWorkSession: (id: string, patch: { title?: string; status?: import("./apiClient").WorkSessionStatus }) => api.workSessionsApi.update(id, patch),
  deleteWorkSession: (id: string) => api.workSessionsApi.remove(id),
  pruneWorkSessions: (olderThanDays: number) => api.workSessionsApi.prune(olderThanDays),
  deleteAllWorkSessions: () => api.workSessionsApi.deleteAll(),
  addWorkSessionTurn: (id: string, role: "user" | "assistant", content: string, tool?: string) => api.workSessionsApi.addTurn(id, role, content, tool),
  onCollaborationEvent: (cb: (evt: unknown) => void) => onChannel("collaboration:event", cb),
  listCollaborationHistory: () => api.collaborationApi.history(),
  onLlmActivity: (cb: (evt: unknown) => void) => onChannel("llm:event", cb),
  // 실시간 연결 상태(2026-09-02 F6-11) — 끊긴 것을 화면이 알아야 「멈춘 판」을 알릴 수 있다.
  onWsState: (cb: (s: { 연결됨: boolean; 끊긴시각: number | null }) => void) => onWsState(cb),
  listLlmActivity: () => api.llmActivityApi.history(),

  // 작업 큐
  listTasks: () => api.tasksApi.list(),
  getToday: (withBrief?: boolean) => api.todayApi.get(withBrief),
  addTask: (text: string, opts?: import("./apiClient").NewTaskOptions) => api.tasksApi.add(text, opts),
  getRoutineSuggestions: () => api.tasksApi.routineSuggestions(),
  completeTask: (id: string) => api.tasksApi.complete(id),
  toggleTask: (id: string, done: boolean) => api.tasksApi.toggle(id, done),
  // 내 업무 — 목록·가이드·담기·단계 완료(2026-07-31)
  myWork: () => api.myWorkApi.list(),
  workGuide: (key: string) => api.myWorkApi.guide(key),
  myWorkRoutines: () => api.myWorkApi.routines(),
  myWorkAdopt: (body: { text: string; ref?: string; origin?: string; dueAt?: number; recur?: string }) =>
    api.myWorkApi.adopt(body),
  myWorkStep: (id: string, step: number, done: boolean) => api.myWorkApi.step(id, step, done),
  deleteTask: (id: string) => api.tasksApi.remove(id),

  // 유지보수 일정 · 점검서 · 승인(거버넌스 검증)
  listMaintenance: () => api.maintenanceApi.list(),
  listDueMaintenance: () => api.maintenanceApi.due(),
  listMaintenanceByAsset: (assetId: string) => api.maintenanceApi.byAsset(assetId),
  createMaintenance: (args: { title: string; productName: string; scheduleDate: string; intervalDays?: number; assetId?: string; productId?: string }) =>
    api.maintenanceApi.create(args),
  reportMaintenance: (id: string, args: { note: string; filename?: string; content?: string }) =>
    api.maintenanceApi.report(id, args),
  approveMaintenance: (id: string) => api.maintenanceApi.approve(id),
  rejectMaintenance: (id: string, reason: string) => api.maintenanceApi.reject(id, reason),
  maintenanceHistory: (id: string) => api.maintenanceApi.history(id),
  getMaintenanceHistory: (id: string) => api.maintenanceApi.history(id),
  getMaintenanceNotify: () => api.maintenanceApi.getNotify(),
  sendMaintenanceNotify: (to: string[]) => api.maintenanceApi.notify(to),

  // 보안제품 등록부(종류별 관리 + 제품/로그 매뉴얼)
  outboundRequestsList: (productId?: string) => api.outboundReqApi.list(productId),
  outboundRequestsMine: () => api.outboundReqApi.listMine(), // 📨 조치 요청서 판(내 것만)
  outboundRequestSetStatus: (id: string, status: string) => api.outboundReqApi.setStatus(id, status), // 위치 인자
  listSecurityProducts: () => api.securityProductsApi.list(),
  listSecurityProductsGrouped: () => api.securityProductsApi.grouped(),
  getProductCategories: () => api.securityProductsApi.categories(),
  createSecurityProduct: (args: { name: string; category: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    api.securityProductsApi.create(args),
  updateSecurityProduct: (id: string, patch: { name?: string; category?: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    api.securityProductsApi.update(id, patch),
  previewDeleteSecurityProduct: (id: string) => api.securityProductsApi.deletePreview(id),
  deleteSecurityProduct: (id: string, manuals?: "keep" | "kb" | "file") => api.securityProductsApi.remove(id, manuals ?? "keep"),
  addProductDoc: (id: string, args: { kind: string; title: string; note?: string; filename?: string; content?: string }) =>
    api.securityProductsApi.addDoc(id, args),
  deleteProductDoc: (docId: string) => api.securityProductsApi.removeDoc(docId),
  importProductManual: (filename: string, content?: string) => api.securityProductsApi.importDoc(filename, content),
  getProductFields: (id: string) => api.securityProductsApi.getFields(id),
  saveProductFields: (id: string, fields: { key: string; value: string }[]) => api.securityProductsApi.saveFields(id, fields),
  draftProductFields: (id: string, filename: string, content: string) => api.securityProductsApi.draftFields(id, filename, content),

  // 자산 인벤토리
  listAssets: () => api.assetsApi.list(),
  getAsset: (id: string) => api.assetsApi.get(id),
  // 자산 허브(자산 목록·AI-BOM·취약점 통합 뷰)
  workflowStages: () => api.workflowApi.stages(),   // 업무 절차 5단계 현황(절차 띠)
  assetHub: () => api.assetHubApi.overview(),
  // ⓪ 자산 — 한 자산의 ③ 조치 현황(승인 시안 2026-08-18).
  assetProgress: (id: string) => api.assetHubApi.progress(id),
  assetHubDetail: (id: string) => api.assetHubApi.detail(id),
  shadowAi: () => api.assetHubApi.shadowAi(),
  scanAsset: (id: string) => api.assetsApi.scan(id),
  uploadAuto: (filename: string, content: string, forceType?: import("./apiClient").UploadType, productName?: string, keepOriginal?: boolean, replacesReceiptId?: string) =>
    api.uploadApi.auto(filename, content, forceType, productName, keepOriginal, replacesReceiptId),
  deleteAsset: (id: string) => api.assetsApi.remove(id),
  assetCoverage: () => api.assetsApi.coverage(),
  updateAssetOwnership: (id: string, patch: { owner?: string; service?: string | null }) =>
    api.assetsApi.updateOwnership(id, patch),
  registerAsset: (args: { id: string; name: string; path: string; assetType?: string; owner?: string; service?: string }) =>
    api.assetsApi.register(args),
  getServiceImpact: () => api.serviceImpactApi.get(),
  importAssets: (content: string, format: "json" | "csv", source: string) => api.assetsApi.import(content, format, source),
  scanRepos: (args: { provider: string; owner: string; token?: string; baseUrl?: string; maxRepos?: number }) => api.assetsApi.scanRepos(args),
  updateAiBom: (id: string, aibom: unknown) => api.assetsApi.updateAiBom(id, aibom as import("./apiClient").AiBom),
  setAssetCategory: (id: string, category: string | null) => api.assetsApi.setCategory(id, category),
  computeWeightsHash: (id: string, filePath?: string) => api.assetsApi.weightsHash(id, filePath),
  importVulnScan: (content: string, format: "json" | "csv" | "html" | "nessus", source: string) => api.assetsApi.importVulnScan(content, format, source),
  listModelDex: () => api.modelDexApi.list(),
  listLlmGuide: () => api.modelDexApi.guide(),
  listApprovals: () => api.approvalsApi.list(),
  // 「미배정」 판정 — **제품 전체에서 한 곳**이다(2026-09-07 승인 배지). 사이드바 ③ 조치 배지(nav.js
  //   refreshApvBadge)와 ③ 조치 허브의 ✅ 조치·승인 판 배지(grouppanels.js)가 **같은 수**를 말해야
  //   하는데, 각자 식을 쓰면 한쪽만 고치는 날 두 숫자가 갈린다(grouppanels.js:98 주석의 계보 —
  //   판 배지·하위 목록·실화면이 서로 다른 수를 가리키고 있었다).
  //   원천은 서버 approvals.ts:253이고 실화면 approvals.html도 같은 식이다 — 완료·반려·**위험수용**은
  //   담당자를 안 붙이는 것이 정상이라 세지 않는다.
  // ⚠ 화면 스크립트가 이 식을 **다시 쓰지 않는다**(clientglobals.test가 소스로 감시한다).
  //   preload에 둔 이유: nav.js는 모든 화면이 싣고 grouppanels.js는 허브 화면만 싣는다 — 공용 .js를
  //   새로 만들면 그 script 태그를 한 화면에서 빠뜨려도 조용히 통과한다(부품 로드 누락 5화면 「거짓
  //   초록」 전례). preload는 모든 렌더러에 **먼저** 붙어 로드 순서 사고가 없다.
  isUnassignedApproval: (x: { assignee?: string | null; status?: string }) =>
    !x.assignee && x.status !== "approved" && x.status !== "rejected" && x.status !== "accepted",
  // status·note·assignee·dueDate를 부분 갱신. status만 주면 기존 승인/반려 동작과 동일.
  setFindingReview: (assetId: string, key: string, patch: api.ReviewPatch) => api.approvalsApi.set(assetId, key, patch),
  notifyAssignee: (assetId: string, key: string, to: string) => api.approvalsApi.notify(assetId, key, to),
  // 조치 검증 — 찾은 취약점이 실제로 닫혔는지 대상에 접속해 확인(판정 근거까지 함께 받는다)
  canVerify: (assetId: string, key?: string) => api.verifyApi.can(assetId, key),
  runVerify: (assetId: string, key?: string) => api.verifyApi.run(assetId, key),
  // 소속 팀 지정(관리자) — 자산 접근 권한의 근거
  setUserTeam: (id: string, team: string | null) => api.usersApi.setTeam(id, team),
  // 파일 받기 결과 — Electron은 저장 경로를 정해줘야 실제로 파일이 생긴다(main.ts will-download).
  // 화면은 "어디에 저장됐는지"를 사용자에게 알려줘야 한다 — 받았다는데 안 보이면 실패로 느낀다.
  onDownloadDone: (cb: (info: { ok: boolean; path: string | null; filename: string; state: string }) => void) => {
    ipcRenderer.removeAllListeners("download:done");
    ipcRenderer.on("download:done", (_e, info) => cb(info));
  },
  revealDownload: (filePath: string) => ipcRenderer.invoke("download:reveal", filePath),
  // VEX — 승인 상태를 국제 표준 문서로 내보내기(요약 미리보기 + 파일)
  vexSummary: (assetId?: string) => api.vexApi.summary(assetId),
  vexExport: (assetId?: string) => api.vexApi.exportDoc(assetId),
  // 자산 기본 담당자 — 새 취약점이 이 사람에게 자동 배정된다
  setAssetDefaultAssignee: (assetId: string, assignee: string | null) => api.assetsApi.setDefaultAssignee(assetId, assignee),
  listActionPriorities: (limit?: number) => api.approvalsApi.priorities(limit),
  aiTriage: (limit?: number) => api.approvalsApi.triage(limit),
  listCompliance: () => api.complianceApi.list(),
  setComplianceStatus: (code: string, status: string, note: string) => api.complianceApi.setStatus(code, status, note),
  complianceDraft: (code: string) => api.complianceApi.draft(code),
  onAssetUpdated: (cb: (asset: unknown) => void) => onChannel("asset:updated", cb),

  // SBOM
  generateSbom: (assetId: string) => api.sbomApi.generate(assetId),
  exportSbom: (assetId: string, format: "cyclonedx" | "spdx") => api.sbomApi.export(assetId, format),
  // 공급망 점검(타사 SBOM 검수) — 보기 전용. 넣기는 대화창 ＋의 「📦 타사 SBOM」 유형이 진다.
  listSbomReviews: () => api.sbomReviewApi.list(),
  getSbomReview: (id: string) => api.sbomReviewApi.get(id),
  deleteSbomReview: (id: string) => api.sbomReviewApi.remove(id),
  setSbomReviewMeta: (id: string, body: { vendor?: string; assetId?: string }) => api.sbomReviewApi.setMeta(id, body),
  exportAiBom: (assetId: string) => api.sbomApi.aibomExport(assetId),
  aibomThreats: (assetId: string) => api.sbomApi.aibomThreats(assetId),

  // 로컬 LLM(서버가 보유한 GPU 머신의 llama.cpp 프로세스를 원격 제어)
  getLocalEngineStatus: () => api.localEngineApi.status(),
  startLocalEngine: (modelId: string) => api.localEngineApi.start(modelId),
  stopLocalEngine: () => api.localEngineApi.stop(),
  getLlmTier: () => api.localEngineApi.tier(),
  setLlmTier: (tier: string) => api.localEngineApi.setTier(tier),
  chat: (agentId: string, message: string) => api.llmApi.chat(agentId, message),

  // 장기 기억(RAG) / 파인튜닝(학습)
  ingestDocument: (path: string, scope?: string) => api.memoryApi.ingest(path, scope),
  ingestMemoryFile: (filename: string, content: string, scope?: string, keepOriginal?: boolean) => api.memoryApi.ingestFile(filename, content, scope, keepOriginal),
  // 업로드 화면이 「무엇을 읽을 수 있다」고 말하기 전에 **서버에게 물어본다**(2026-08-22 검토관 [높음]).
  getExtractCapability: () => api.memoryApi.extractCapability(),
  setDocCategory: (documentId: string, category: string) => api.memoryApi.setDocumentCategory(documentId, category),
  setAssetDisplayName: (id: string, displayName: string | null) => api.assetHubApi.setDisplayName(id, displayName),
  saveIngestReport: (input: Parameters<typeof api.ingestReportApi.save>[0]) => api.ingestReportApi.save(input),
  screenTips: (screen?: string) => api.screenTipsApi.get(screen),
  screenGuide: (screen?: string, question?: string) => api.screenGuideApi.get(screen, question),
  longAnswersPending: () => api.longAnswerApi.pending(),
  longAnswerAck: (id: string) => api.longAnswerApi.ack(id),
  handoverVerify: (documentIds: string[]) => api.handoverApi.verify(documentIds),
  handoverComplete: (p: { documentIds: string[]; cited: number; total: number; passRate: number; batchId?: string }) => api.handoverApi.complete(p),
  queryMemory: (question: string, topK?: number, agentId?: string) => api.memoryApi.query(question, topK, agentId),
  listMemoryDocuments: () => api.memoryApi.listDocuments(),
  // ★ 반입 영수증 — 「내가 넣은 모든 파일」. listMemoryDocuments와 **다른 것**이다(지식에 안 든 것도 온다).
  listUploadReceipts: (limit?: number) => api.memoryApi.uploadReceipts(limit),
  // 📂 지켜보는 폴더(2026-08-31) — 내 문서 판 조회 전용(위치 인자 관례).
  watchFolders: () => api.memoryApi.watchFolders(),
  // 📚 침해사고 히스토리(2026-09-03) — 판·칩 조회 전용(위치 인자 관례). 등록·삭제는 대화창 결재판이 유일한 문.
  incidentCases: (q?: string, cve?: string, year?: number, limit?: number) => api.incidentCasesApi.list({ q, cve, year, limit }),
  incidentCasesSimilar: (cves: string[], limit?: number) => api.incidentCasesApi.similar(cves, limit),
  incidentSources: () => api.incidentCasesApi.sources(),
  // 오늘 새로 들어온 문서 수(사이드바 배지). 이 기기의 자정(현지시각)을 ISO로 계산해 서버에 넘긴다 —
  //   서버 ingestedAt은 UTC ISO라 문자열 비교로 맞고, "오늘"의 경계는 사람이 있는 시간대가 정한다.
  recentDocCount: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return api.memoryApi.recentDocCount(d.toISOString()); },
  memoryDocumentChunks: (documentId: string, limit?: number) => api.memoryApi.documentChunks(documentId, limit),
  setMemoryDocumentGrade: (documentId: string, grade: string) => api.memoryApi.setDocumentGrade(documentId, grade),
  deleteMemoryDocument: (documentId: string, withFile?: boolean) => api.memoryApi.deleteDocument(documentId, withFile),
  kbHygiene: () => api.memoryApi.hygiene(),
  kbHygieneScan: () => api.memoryApi.hygieneScan(),
  knowledgeBundleStatus: () => api.memoryApi.knowledgeBundleStatus(),
  // 「이 답 이상해요」 접수 — noev·quotes를 **함께** 싣는다(2026-09-07). 빠지면 서버가 갈래를
  //   정할 재료가 없어 전부 「미분류」로 눌리고, 결재판의 🤖 초안은 재료가 없어 못 만든다.
  sendAnswerFeedback: (b: { kind: string; question: string; answer: string; note?: string; expected?: string; screen?: string; noev?: string; quotes?: import("./api/knowledge").AnswerFeedbackQuote[] }) => api.answerFeedbackApi.send(b),
  // 「고칠 것」 원장(결재판 두 번째 원장) — **위치 인자 관례**(객체로 넘기면 500).
  //   ⚠ 이 여섯 줄이 빠지면 결재판이 통째로 죽는데 화면은 **조용히 빈 목록**을 그린다.
  //     짝 시험: server/test/answerflagui.test.ts ③.
  listAnswerFeedback: (days?: number, status?: import("./api/knowledge").AnswerFeedbackStatus, fixkind?: import("./api/knowledge").AnswerFeedbackFixKind | "unclassified") =>
    api.answerFeedbackApi.list(days, status, fixkind),
  setAnswerFeedbackStatus: (id: number, status: import("./api/knowledge").AnswerFeedbackStatus, expected?: string) =>
    api.answerFeedbackApi.setStatus(id, status, expected),
  setAnswerFeedbackKind: (id: number, fixkind: import("./api/knowledge").AnswerFeedbackFixKind | null) =>
    api.answerFeedbackApi.setKind(id, fixkind),
  setAnswerFeedbackExpected: (id: number, expected: string | null) => api.answerFeedbackApi.setExpected(id, expected),
  buildAnswerFeedbackDraft: (id: number) => api.answerFeedbackApi.draft(id),
  removeAnswerFeedback: (id: number) => api.answerFeedbackApi.remove(id),
  timeSaved: (days?: number) => api.timeSavedApi.status(days),
  setTimeSavedBaseline: (kind: string, minutes: number) => api.timeSavedApi.setBaseline(kind, minutes),
  // 서버 보관 원본을 임시 파일로 받아 OS 기본 뷰어(PDF 등)로 연다.
  openMemoryDocumentFile: async (documentId: string) => {
    const f = await api.memoryApi.documentFile(documentId);
    return ipcRenderer.invoke("doc:open-temp", f.filename, f.content) as Promise<{ path: string }>;
  },
  // 추출본(.md) 보기/고치기 — 「내 문서」 상세의 .md 뷰어·편집용(문서관리 통합).
  memoryDocumentMarkdown: (documentId: string) => api.memoryApi.documentMarkdown(documentId),
  saveMemoryDocumentMarkdown: (documentId: string, text: string) => api.memoryApi.documentMarkdownSave(documentId, text),

  // 선택적 클라우드 LLM 하이브리드(Gemini/Claude/OpenAI) — 기본 OFF·admin 설정, egress 게이트 통과분만.
  cloudStatus: () => api.cloudApi.status(),
  getCloudConfig: () => api.cloudApi.getConfig(),
  saveCloudConfig: (patch: { enabled?: boolean; activeProvider?: import("./apiClient").CloudProvider; provider?: import("./apiClient").CloudProvider; apiKey?: string; model?: string; clearKey?: boolean; customBaseUrl?: string }) =>
    api.cloudApi.saveConfig(patch),
  askCloud: (question: string) => api.cloudApi.ask(question),
  screenCloud: (question: string) => api.cloudApi.screen(question),
  cloudEgressLog: (limit?: number) => api.cloudApi.egressLog(limit),
  saveCloudAnswerToKb: (question: string, answer: string, providerLabel: string, model: string) =>
    api.cloudApi.saveToKb(question, answer, providerLabel, model),
  cloudUsage: () => api.cloudApi.usage(),
  enrichIngest: (a: import("./apiClient").EnrichIngestArgs) => api.docsApi.enrichIngest(a),

  // 온톨로지(지식 그래프)
  listOntology: (filter?: { scope?: string; subject?: string; source?: string }) => api.ontologyApi.list(filter),
  addOntologyTriple: (t: { subject: string; predicate: string; object: string; scope?: string; source?: string }) => api.ontologyApi.add(t),
  removeOntologyTriple: (id: string) => api.ontologyApi.remove(id),
  expandOntology: (text: string, agentId?: string) => api.ontologyApi.expand(text, agentId),
  ontologyStats: () => api.ontologyApi.stats(),
  seedOntology: () => api.ontologyApi.seed(),

  // 통합 보안 분석(관제) 허브
  analysisEvents: () => api.analysisHubApi.events(),
  analysisRemoveFile: (ref: string) => api.analysisHubApi.removeFile(ref),
  logAnalysisFiles: () => api.logAnalysisApi.files(),
  listProductIntros: () => api.productIntroApi.list(),
  removeProductIntro: (id: string) => api.productIntroApi.remove(id),
  logAnalysisGuide: (eventId: string) => api.logAnalysisApi.guide(eventId),
  analysisAttackPaths: () => api.analysisHubApi.attackPaths(),
  analysisRebuildVuln: () => api.analysisHubApi.rebuildVuln(),
  analysisIngest: (filename: string, content: string) => api.analysisHubApi.ingest(filename, content),
  analysisAnalyze: (eventId: string) => api.analysisHubApi.analyze(eventId),
  analysisSetStatus: (eventId: string, status: import("./apiClient").EventStatus, note?: string) => api.analysisHubApi.setStatus(eventId, status, note),

  // AI 견고성: 레드팀 + 가드레일
  runRedTeam: (opts?: { modelId?: string; assetId?: string }) => api.redteamApi.run(opts),
  lastRedTeam: (target?: string) => api.redteamApi.last(target),
  redteamTargets: () => api.redteamApi.targets(),
  redteamEffectiveLast: () => api.redteamApi.effectiveLast(),
  runRedteamEffective: () => api.redteamApi.runEffective(),
  guardrailStatus: () => api.guardrailApi.status(),
  guardrailLog: (limit?: number) => api.guardrailApi.log(limit),
  setGuardrailMode: (mode: import("./apiClient").GuardMode) => api.guardrailApi.setMode(mode),
  startFinetune: (agentId: string, datasetId: string) => api.finetuneApi.start(agentId, datasetId),
  onFinetuneProgress: (cb: (p: unknown) => void) => onChannel("finetune:progress", cb),
  convertDataset: (rawText: string) => api.datasetApi.convert(rawText),
  saveDataset: (id: string, examples: { question: string; answer: string }[]) => api.datasetApi.save(id, examples),
  listDatasets: () => api.datasetApi.list(),
  extractDocument: (filename: string, content: string) => api.datasetApi.extract(filename, content),

  // 헤르메스 폐쇄형 학습 루프(수집→정제→학습→배포)
  getLearnloopPreflight: () => api.learnloopApi.preflight(),
  listLearnloopTopics: () => api.learnloopApi.topics(),
  listLearnloopLogs: (limit?: number, offset?: number) => api.learnloopApi.logs(limit, offset),
  rateLearnloopLog: (id: string, rating: 1 | -1 | 0) => api.learnloopApi.rate(id, rating),
  deleteLearnloopLog: (id: string) => api.learnloopApi.removeLog(id),
  // 학습 후보함(환류 1단계) — 코드가 고른 후보를 담당자가 승인(=👍)/제외
  listLearnCandidates: (days?: number, limit?: number) => api.learnloopApi.candidates(days, limit),
  decideLearnCandidate: (id: string, accept: boolean) => api.learnloopApi.decideCandidate(id, accept),
  acceptStrongLearnCandidates: (minScore?: number) => api.learnloopApi.acceptStrongCandidates(minScore),
  buildLearnloopDataset: (includeUnrated?: boolean) => api.learnloopApi.buildDataset(includeUnrated),
  startLearnloopRun: (datasetId?: string, topic?: string) => api.learnloopApi.run(datasetId, topic),
  listAdapters: () => api.adaptersApi.list(),
  deleteAdapter: (id: string) => api.adaptersApi.remove(id),
  getLearnloopStatus: () => api.learnloopApi.status(),
  listLearnloopRuns: () => api.learnloopApi.runs(),
  getLearnloopConfig: () => api.learnloopApi.getConfig(),
  putLearnloopConfig: (patch: Partial<api.LearnloopConfig>) => api.learnloopApi.putConfig(patch),
  onLearnloopProgress: (cb: (run: unknown) => void) => onChannel("learnloop:progress", cb),

  // HuggingFace 모델 검색 · 다운로드(백그라운드 큐 — load()는 잡을 반환하고 즉시 끝난다)
  listRecommendedModels: () => api.hfModelsApi.recommended(),
  searchHfModels: (query: string) => api.hfModelsApi.search(query),
  loadHfModel: (modelId: string) => api.hfModelsApi.load(modelId),
  listHfDownloadJobs: () => api.hfModelsApi.jobs(),
  getHfDownloadJob: (id: string) => api.hfModelsApi.job(id),
  onHfDownloadProgress: (cb: (job: unknown) => void) => onChannel("hf-download:progress", cb),

  // CTI(딥웹/다크웹 피드)
  listCtiFeeds: () => api.ctiApi.feeds(),
  listCtiFindings: () => api.ctiApi.findings(),
  getCtiAssetMatches: () => api.ctiApi.assetMatches(),
  configureCtiFeed: (feedId: string, apiKey: string) => api.ctiApi.configureFeed(feedId, apiKey),
  addCustomCtiFeed: (name: string, apiKey: string) => api.ctiApi.addCustomFeed(name, apiKey),
  disconnectCtiFeed: (feedId: string) => api.ctiApi.disconnectFeed(feedId),

  // 통합 보안 KPI 대시보드
  getSecurityKpi: () => api.kpiApi.get(),

  // 내부 리포트
  generateReport: (opts: { type: "weekly" | "quarterly" | "ondemand" | "work-progress"; assetIds?: string[]; sessionIds?: string[]; days?: number; audience?: "internal" | "official"; format?: "docx" | "pdf" | "both" }) =>
    api.reportApi.generate(opts.type, opts.assetIds, { audience: opts.audience, format: opts.format, sessionIds: opts.sessionIds, days: opts.days }),
  downloadReportFile: (name: string) => api.reportApi.file(name),
  listReportHistory: () => api.reportApi.history(),
  deleteReport: (base: string) => api.reportApi.remove(base),
  maintenanceRemove: (id: string) => api.maintenanceApi.remove(id),
  pruneReports: (olderThanDays: number) => api.reportApi.prune(olderThanDays),
  deleteAllReports: () => api.reportApi.removeAll(),

  // 정기 리포트(주간/분기) 자동 생성 스케줄 — report.html "예약 설정" 패널이 사용. 챗봇도 같은 데이터를 조회.
  reportSchedules: {
    list: () => api.reportScheduleApi.list(),
    create: (input: api.CreateReportScheduleInput) => api.reportScheduleApi.create(input),
    update: (id: string, patch: Partial<api.CreateReportScheduleInput> & { enabled?: boolean }) => api.reportScheduleApi.update(id, patch),
    remove: (id: string) => api.reportScheduleApi.remove(id),
    runNow: (id: string) => api.reportScheduleApi.runNow(id),
    runs: (scheduleId?: string, limit?: number) => api.reportScheduleApi.runs(scheduleId, limit),
  },

  // 이메일(SMTP) 설정
  getSmtpConfig: () => api.emailApi.getConfig(),
  saveSmtpConfig: (config: api.SmtpConfigInput) => api.emailApi.saveConfig(config),
  getSmtpInboundConfig: () => api.smtpInboundApi.getConfig(),
  saveSmtpInboundConfig: (config: { enabled: boolean; port: number; allowedIpsText?: string }) => api.smtpInboundApi.saveConfig(config),
  getSmtpInboundStatus: () => api.smtpInboundApi.getStatus(),
  // 정기 알림(메일) 상태 — 등록·변경은 대화창, 화면은 상태만(2026-08-19).
  listAlertSchedules: () => api.alertScheduleApi.list(),
  getSiemConfig: () => api.siemApi.getConfig(),
  saveSiemConfig: (config: Partial<import("./apiClient").SiemConfig>) => api.siemApi.saveConfig(config),
  testSiem: () => api.siemApi.test(),
  sendReportEmail: (to: string[], subject: string, attachmentPath: string) =>
    api.emailApi.sendReport(to, subject, attachmentPath),

  // 법령·판례 조회(법제처) — settings.html이 부르는데 통로가 빠져 있었다(2026-07-28 발견)
  lawConfig: () => api.lawApi.getConfig(),
  setLawKey: (key: string, domain?: string) => api.lawApi.setKey(key, domain ?? ""),
  lawSearch: (query: string, target?: string, limit?: number) => api.lawApi.search(query, target, limit),

  // 모델 받기 인증(HuggingFace 토큰·프록시) — 토큰은 넣기만 하고 다시 나오지 않는다
  getModelAuth: () => api.modelAuthApi.get(),
  saveModelAuth: (patch: { token?: string; proxyUrl?: string }) => api.modelAuthApi.save(patch),
  testModelAuth: () => api.modelAuthApi.test(),

  // 사용량 · 요금
  getUsageSummary: (sinceMs?: number) => api.usageApi.summary(sinceMs),

  // 서버 로그
  listLogs: () => api.logsApi.list(),
  onLogEvent: (cb: (entry: unknown) => void) => onChannel("log:event", cb),

  // 작업 기록(감사 로그)
  listAudit: (kind?: string, limit?: number) => api.auditApi.list(kind, limit),
  recordAudit: (action: string, target?: string, detail?: string, kind?: string, result?: string) => api.auditApi.record(action, target, detail, kind, result),

  // 담당자 PC CLI 터미널 — 앱 안에서 담당자 PC의 셸을 실행(서버 아님). 위험 명령은 실행 전 차단.
  terminal: {
    start: () => ipcRenderer.invoke("terminal:start") as Promise<{ ok: boolean; shell: string; cwd: string }>,
    exec: (cmd: string) => ipcRenderer.invoke("terminal:exec", cmd) as Promise<{ ok?: boolean; blocked?: boolean; reason?: string; error?: string }>,
    check: (cmd: string) => ipcRenderer.invoke("terminal:check", cmd) as Promise<{ blocked: boolean; reason: string }>,
    kill: () => ipcRenderer.invoke("terminal:kill"),
    onData: (cb: (data: string) => void) => ipcRenderer.on("terminal:data", (_e, data: string) => cb(data)),
  },
  // 클라이언트 자동 업데이트 — 이 GIJO AS 서버 자체가 배포처(외부 서비스 없음). 다운로드·설치
  // 실행·앱 종료는 메인 프로세스가 처리(대용량 스트리밍 + 실행 파일 실행이 렌더러에선 불가).
  update: {
    checkForUpdate: () => ipcRenderer.invoke("update:check") as Promise<api.ClientUpdateCheckResult>,
    currentVersion: () => ipcRenderer.invoke("update:currentVersion") as Promise<string>,
    // verified — sha256 대조를 실제로 했는가(2026-09-02 F6-02). 화면 문구가 이 값을 따라간다.
    install: (version: string) => ipcRenderer.invoke("update:install", version) as Promise<{ ok: boolean; verified: boolean }>,
    onProgress: (cb: (pct: number) => void) => ipcRenderer.on("update:progress", (_e, pct: number) => cb(pct)),
    // 설치 프로그램 **실행 실패** — install()이 이미 반환한 뒤에 오는 소식이라 별도 채널로 온다
    //   (2026-09-02 F6-05). 이걸 안 받으면 화면은 「설치 창 열림」인 채로 앱이 꺼진다.
    onInstallError: (cb: (reason: string) => void) => ipcRenderer.on("update:installError", (_e, reason: string) => cb(reason)),
    listReleases: () => api.clientReleaseApi.listAll(),
    downloadLog: () => api.clientReleaseApi.downloadLog(),
  },
  // 로그인 히스토리(접근 서버·ID·PW) — 빠른 선택용. PW는 메인 프로세스가 OS 키체인으로 암호화 저장.
  creds: {
    list: () => ipcRenderer.invoke("creds:list") as Promise<{ serverUrl: string; username: string; hasPw: boolean }[]>,
    getPassword: (serverUrl: string, username: string) => ipcRenderer.invoke("creds:getPassword", serverUrl, username) as Promise<string>,
    save: (serverUrl: string, username: string, password: string, savePw: boolean) => ipcRenderer.invoke("creds:save", serverUrl, username, password, savePw) as Promise<void>,
    remove: (serverUrl: string, username: string) => ipcRenderer.invoke("creds:remove", serverUrl, username) as Promise<void>,
    pwSupported: () => ipcRenderer.invoke("creds:pwSupported") as Promise<boolean>,
  },
  // 챗봇 명령 정책 판정(허용목록/위험) — 렌더러가 승인 UI 결정에 쓴다.
  classifyCommand: (cmd: string) => classifyChatbotCommand(cmd),
  // 챗봇에게 명령 제안 받기(서버 LLM) — 제안만, 실행은 위 terminal.exec + 사람 승인.
  suggestCommand: (requestText: string) => api.terminalApi.suggest(requestText),
  // 보안장비 하드닝 점검(표준 기준 체크리스트 실행·리포트) — 챗봇 "점검해줘" 인텐트가 호출.
  hardeningChecklists: () => api.hardeningApi.checklists(),
  hardeningScan: (standard: "kisa" | "cis", target?: string) => api.hardeningApi.scan(standard, target),
  // 원격 SSH 정기점검 — 대상(장비)·스케줄·이력 관리(관제 대시보드 hardening.html이 사용).
  hardeningTargets: {
    list: () => api.hardeningApi.listTargets(),
    create: (t: api.NewTarget) => api.hardeningApi.createTarget(t),
    remove: (id: string) => api.hardeningApi.deleteTarget(id),
    probe: (id: string) => api.hardeningApi.probeTarget(id),
    scan: (id: string, standard: "kisa" | "cis") => api.hardeningApi.scanTarget(id, standard),
  },
  hardeningSchedules: {
    list: () => api.hardeningApi.listSchedules(),
    create: (targetId: string, standard: "kisa" | "cis", intervalHours: number) => api.hardeningApi.createSchedule(targetId, standard, intervalHours),
    toggle: (id: string, enabled: boolean) => api.hardeningApi.toggleSchedule(id, enabled),
    remove: (id: string) => api.hardeningApi.deleteSchedule(id),
  },
  hardeningRuns: (targetId?: string, limit?: number) => api.hardeningApi.runs(targetId, limit),
};

contextBridge.exposeInMainWorld("gijo", gijoApi);

// ★ 2026-08-22 — Smart MD 창을 없애면서 이 아래 판단도 **대상이 사라졌다.** 남겨 두는 이유는
//   판단 자체가 유효하기 때문이다: **남의 저장소 코드를 창으로 실을 때 이 preload를 주지 않는다.**
//   (아래는 그때의 기록. 새로 그런 창을 만드는 사람이 같은 실수를 하지 않게 그대로 둔다.)
//
// ⚠ Smart MD가 찾는 `window.gijoDesktop`은 **여기 두지 않는다**(2026-08-14 검토관 지적 H6).
//   처음엔 「preload를 두 벌 두면 어긋난다」는 이유로 이 파일에 넣었는데, 그러면 Smart MD 창이
//   이 preload를 쓰게 되고 — 이 preload는 로드 시점에 토큰을 복원해 **인증된 전 API**를 준다.
//   그 창에 실리는 코드는 다른 저장소에서 받아온 것이라, 저쪽 push 한 번이 터미널 실행·파일 읽기·
//   서버 전 라우트를 얻는다. 그래서 그 창 전용 최소 preload(src/smartmd-preload.ts)로 옮겼다.
//   ▶ 두 벌이 되는 비용보다 **표면을 줄이는 값**이 크다 — 보안 제품에서는 그쪽이 정답이다.

// 로그인 성공 이후 렌더러가 이 시점에 WebSocket을 연다(인증 전 연결 방지).
contextBridge.exposeInMainWorld("gijoRealtime", {
  connect: () => connectWebSocket(),
});

// ── 실사용 감지 keepalive ──────────────────────────────────────────────
// 서버는 인증 REST 요청마다 세션의 lastSeenAt을 갱신하므로, 클릭·이동 등 조작을 하는
// 동안엔 유휴(30분) 시계가 리셋돼 세션이 계속 살아있다. 다만 한 화면만 오래 "보고만"
// 있으면 REST 호출이 없어 만료될 수 있다. → 실제 사용자 입력(마우스·키보드·스크롤)이
// 최근에 있었으면 주기적으로 가벼운 인증 핑(me)을 보내 세션을 유지한다. 자리를 비우면
// (지정 시간 이상 입력 없음) 핑을 멈춰 유휴 만료 규칙을 그대로 지킨다.
//
// 토큰(회전형 refresh)은 프레임마다 별도 메모리라, 여러 프레임이 동시에 refresh하면
// 회전 경쟁이 난다. 그래서 타이머·핑은 최상위 프레임에서만 돌리고, iframe(허브 하위
// 페이지)은 자신의 입력 활동만 top 프레임으로 전달한다.
(() => {
  const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "wheel", "touchstart"];
  const PING_INTERVAL_MS = 5 * 60 * 1000;   // 5분마다 점검
  const ACTIVE_WINDOW_MS = 10 * 60 * 1000;  // 최근 10분 내 입력이 있어야 "사용 중"으로 보고 핑
  const FORWARD_THROTTLE_MS = 15 * 1000;    // iframe→top 활동 전달 쓰로틀
  const isTop = (() => { try { return window.top === window; } catch { return true; } })();

  if (isTop) {
    const note = () => { keepalive.lastActivity = Date.now(); };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, note, { passive: true, capture: true }));
    // iframe에서 전달된 활동 신호
    window.addEventListener("message", (m) => {
      if (!m || !m.data || !(m.data as { __gijoActivity?: boolean }).__gijoActivity) return;
      // 발신자 검증(2026-08-20) — 내 프레임 트리의 자손(탭 iframe·허브 무대 2겹)만.
      // ⚠ 한계: 자손 프레임이 입력 없이 위조 신호를 보내는 것까지는 못 막는다(전부 로컬 파일 전제).
      try {
        let w = m.source as Window | null;
        let n = 0, ok = false;
        while (w && n < 6) {
          if (w === window) break;
          if (w.parent === window) { ok = true; break; }
          if (w.parent === w) break;
          w = w.parent; n++;
        }
        if (!ok) return;
      } catch { return; }
      note();
    });
    setInterval(() => {
      if (!api.isAuthenticated()) return;                                    // 로그아웃 상태면 핑 안 함
      if (Date.now() - keepalive.lastActivity > ACTIVE_WINDOW_MS) return;    // 자리 비움 → 유휴 만료되게 둠
      // me()는 인증 REST라 서버 lastSeenAt 갱신 + 액세스 토큰 만료 시 자동 재발급까지 처리한다.
      api.authApi.me().catch(() => { /* 만료/네트워크 오류는 다음 API 호출의 가드가 처리 */ });
    }, PING_INTERVAL_MS);
  } else {
    // iframe: 자신의 입력 활동을 top으로만 알린다(쓰로틀). 타이머·토큰은 top이 단독 관리.
    let lastForward = 0;
    const forward = () => {
      const now = Date.now();
      if (now - lastForward < FORWARD_THROTTLE_MS) return;
      lastForward = now;
      try { window.top?.postMessage({ __gijoActivity: true }, "*"); } catch { /* noop */ }
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, forward, { passive: true, capture: true }));
  }
})();

export type GijoApi = typeof gijoApi;
