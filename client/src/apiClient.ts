// GIJO AS 클라이언트 — API Client
// 서버(gijo-as-server)와의 모든 통신은 이 모듈을 통해서만 이루어진다.
// preload.ts가 이 모듈을 사용해 window.gijo.* 표면을 구성한다.
//
// 인증: 로그인 성공 시 서버가 발급한 access token(짧은 만료, JWT) + refresh token(회전형)을 보관한다.
// [실기동 검증 중 발견된 버그] 이 페이지들은 SPA가 아니라 매번 mainWindow.loadFile()로
// 전체 페이지 네비게이션을 한다 — Electron은 네비게이션마다 preload 스크립트를 처음부터
// 다시 실행하므로, 모듈 내부 변수에만 저장하면 로그인 직후 다음 페이지로
// 이동하는 순간 토큰이 사라져 즉시 로그인 화면으로 튕기는 무한 루프가 발생했다.
// 그래서 메인 프로세스(페이지 이동에도 살아있는 유일한 곳)에 상태를 동기 IPC로 위임한다.
import { ipcRenderer } from "electron";

const DEFAULT_SERVER_URL = process.env.GIJO_SERVER_URL ?? "http://localhost:4000";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  serverUrl: string | null;
}

const persisted = ipcRenderer.sendSync("auth:getState") as AuthState;

let serverUrl = persisted.serverUrl ?? DEFAULT_SERVER_URL;
let accessToken: string | null = persisted.accessToken;
let refreshToken: string | null = persisted.refreshToken;

function persist(): void {
  ipcRenderer.send("auth:setState", { accessToken, refreshToken, serverUrl });
}

export function setServerUrl(url: string): void {
  serverUrl = url.replace(/\/+$/, "");
  persist();
}

export function getServerUrl(): string {
  return serverUrl;
}

export function setAuthTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  persist();
}

export function isAuthenticated(): boolean {
  return accessToken !== null;
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  skipAuthRetry?: boolean;
}

// access token이 만료돼 401이 오면, refresh token으로 한 번만 조용히 재발급받고 원 요청을 재시도한다.
// refresh도 실패하면(만료/폐기) 토큰을 지워서 다음 API 호출들이 즉시 401로 실패 -> 각 페이지의
// isAuthenticated() 가드가 로그인 화면으로 돌려보낸다.
//
// [2026-07-26 실사용 사고] 서버의 refresh token은 회전형(한 번 쓰면 즉시 폐기)이다. 그런데
// 토큰 사본이 이 모듈의 지역 변수에도 있어서, 창·프레임이 여럿이면 각자 낡은 사본을 들고 있다.
// 한 창이 갱신에 성공해 토큰이 회전하면 나머지는 폐기된 토큰으로 갱신을 시도해 실패하고,
// 실패 처리로 공용 상태까지 지워버려 멀쩡하던 세션이 통째로 끊겼다
// (증상: 업로드는 되는데 "리포트 저장 실패 401 unauthorized").
// 그래서 ① 갱신은 이 컨텍스트에서 한 번만 돌고(single-flight), ② 갱신 전후로 메인 프로세스의
// 공용 상태를 다시 읽어 남이 이미 갱신했으면 그 토큰을 받아 쓰고, ③ 내가 쓴 토큰이 여전히
// 최신일 때만 지운다.
function readShared(): AuthState {
  const s = ipcRenderer.sendSync("auth:getState") as AuthState;
  accessToken = s.accessToken;
  refreshToken = s.refreshToken;
  if (s.serverUrl) serverUrl = s.serverUrl;
  return s;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(usedAccessToken: string | null): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    // 다른 창이 이미 갱신했다면 새 토큰을 받아 쓰기만 하면 된다.
    const shared = readShared();
    if (shared.accessToken && shared.accessToken !== usedAccessToken) return true;
    if (!refreshToken) return false;

    const usedRefresh = refreshToken;
    const res = await fetch(`${serverUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: usedRefresh }),
    }).catch(() => null);

    if (!res || !res.ok) {
      // 내가 보내는 사이에 남이 갱신했을 수 있다 — 다시 읽어 확인하고, 그래도 그대로면 그때 지운다.
      const after = readShared();
      if (after.accessToken && after.accessToken !== usedAccessToken) return true;
      if (after.refreshToken === usedRefresh) setAuthTokens(null);
      return false;
    }
    const result = (await res.json()) as { accessToken: string; refreshToken: string };
    setAuthTokens(result);
    return true;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sentToken = accessToken;
  if (sentToken) headers["Authorization"] = `Bearer ${sentToken}`;

  const res = await fetch(`${serverUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.skipAuthRetry && (await tryRefresh(sentToken))) {
    return request<T>(path, { ...opts, skipAuthRetry: true });
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* 응답 본문이 JSON이 아닌 경우 무시 */
    }
    throw new Error(`GIJO AS 서버 오류 ${res.status} ${path} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── 인증 ──────────────────────────────────────────────────────────────
// 중복로그인 방지: 이미 다른 곳에서 로그인 중이면 서버가 409(already_logged_in)를 준다.
// request()의 예외는 contextBridge를 건너며 커스텀 속성이 사라지므로, login()은 던지지 않고
// 결과를 구조화된 값으로 돌려준다 — 렌더러가 "강제 로그인하시겠습니까?" 확인 UI를 그릴 수 있게.
export interface LoginResult {
  ok: boolean;
  code?: "already_logged_in" | "invalid_credentials" | "locked" | "error";
  message?: string;
  user?: { id: string; displayName: string; role: string };
}

export const authApi = {
  login: async (username: string, password: string, force = false): Promise<LoginResult> => {
    const res = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...(force ? { force: true } : {}) }),
    }).catch(() => null);
    if (!res) return { ok: false, code: "error", message: "서버에 연결할 수 없습니다." };
    const data = (await res.json().catch(() => ({}))) as {
      accessToken?: string;
      refreshToken?: string;
      user?: { id: string; displayName: string; role: string };
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      const code = res.status === 409 && data.error === "already_logged_in" ? "already_logged_in" : res.status === 429 ? "locked" : "invalid_credentials";
      return { ok: false, code, message: data.message ?? data.error ?? "로그인에 실패했습니다." };
    }
    setAuthTokens({ accessToken: data.accessToken!, refreshToken: data.refreshToken! });
    return { ok: true, user: data.user };
  },
  logout: async () => {
    await request("/api/auth/logout", { method: "POST", body: { refreshToken } });
    setAuthTokens(null);
  },
  me: () => request("/api/auth/me"),
  sessions: () => request<ActiveSessionInfo[]>("/api/auth/sessions"),
};

// 접속 중 세션(외부 콘솔 클라이언트) — 팀 사무실 창 presence 표시용.
export interface ActiveSessionInfo {
  userId: string;
  username: string;
  displayName: string;
  role: "security_officer" | "admin";
  ip: string | null;
  since: number;
  lastSeenAt: number;
}

// ── 에이전트 AI ───────────────────────────────────────────────────────
export interface AgentInfo {
  id: string;
  name: string;
  defaultName: string;
  role: string;
  desc: string; // 업무 연계 설명(파이프라인에서 누구와 어떻게 이어지는지)
  assignedModelId: string | null;
  status: "idle" | "working" | "watching";
  defaultStatus: "idle" | "working" | "watching";
}

export const agentsApi = {
  list: () => request<AgentInfo[]>("/api/agents"),
  setModel: (agentId: string, modelId: string | null) =>
    request<AgentInfo>(`/api/agents/${agentId}/model`, { method: "POST", body: { modelId } }),
  setName: (agentId: string, name: string | null) =>
    request<AgentInfo>(`/api/agents/${agentId}/name`, { method: "POST", body: { name } }),
};

// ── 지시(디스패처) ────────────────────────────────────────────────────
export interface OrchestrationStepResult {
  action: "scan" | "analyze" | "report";
  label: string;
  output: string;
  assetIds?: string[];
  findingCount?: number;
}
export interface DispatchResult {
  task: { id: string; priority: string; text: string; agentId?: string; done: boolean; createdAt: number };
  route: { agentId: string; action: "scan" | "analyze" | "report" | "chat"; targetAssetId?: string };
  output: string;
  steps?: OrchestrationStepResult[]; // 복합(멀티스텝) 지시일 때만
  toolCalls?: { tool: string; args: Record<string, string>; result: string }[]; // 에이전트 루프가 실행한 조회 도구
  approval?: PendingApproval; // 쓰기 지시일 때 — 승인해야 실행된다
}

// 결재판 — 쓰기 도구는 지시만으로 실행되지 않고 이 구조가 화면에 떠서 사람의 승인을 받는다.
// source: said=지시에서 뽑음 · auto=서버 규칙이 채움 · guess=LLM 추정(검증 필요) · empty=입력 필요
export interface ApprovalField {
  key: string;
  label: string;
  value: string;
  source: "said" | "auto" | "guess" | "empty";
  required: boolean;
  hint: string;
}
export interface PendingApproval {
  tool: string;
  label: string;
  fields: ApprovalField[];
  effect: string;
  undo: string;
  missing: string[];
}

// 지금 보고 있는 화면의 파일명. 렌더러가 아닌 곳(테스트·메인 프로세스)에서 부르면 undefined.
function currentScreen(): string | undefined {
  const path = (globalThis as { location?: { pathname?: string } }).location?.pathname;
  if (!path) return undefined;
  const file = path.split(/[\\/]/).pop();
  return file && file.endsWith(".html") ? file : undefined;
}

export const dispatchApi = {
  // sessionId를 주면 지시·응답이 그 작업 세션의 턴으로 기록되고, 직전 대화가 맥락으로 실린다.
  // screen: 지시가 들어온 화면(예: "vulnscan.html"). 서버가 모호한 지시를 해석하는 힌트로 쓴다
  // — 취약점 화면에서 "정리해줘"는 우선순위 정리로 본다(server/engine/screencontext.ts).
  // 호출자가 안 주면 현재 문서 경로에서 자동으로 채운다.
  send: (text: string, sessionId?: string, screen?: string) =>
    request<DispatchResult>("/api/dispatch", {
      method: "POST",
      body: { text, ...(sessionId ? { sessionId } : {}), screen: screen ?? currentScreen() },
    }),
  plan: (text: string) =>
    request<{ steps: OrchestrationStepResult[]; multi: boolean }>("/api/dispatch/plan", { method: "POST", body: { text } }),
  // 결재판 승인 — 사람이 값을 확인·수정하고 누른 뒤에만 호출된다.
  // instruction: 이 결재판을 만든 원 지시 — 서버가 승인된 (지시→도구)를 파인튜닝 골드로 누적(Phase 4).
  approve: (tool: string, args: Record<string, string>, instruction = "") =>
    request<{ output: string; undoId?: string }>("/api/agent/approve", { method: "POST", body: { tool, args, instruction } }),
  // #7 원클릭 undo — 방금 승인 실행을 통째로 되돌린다(id 생략 시 가장 최근).
  undo: (id?: string) => request<{ ok: boolean; message: string }>("/api/agent/undo", { method: "POST", body: { id } }),
};

// ── 작업 세션(대화 세션형) ────────────────────────────────────────────
export type WorkSessionStatus = "active" | "done" | "ignored";
export type WorkSessionDoneBy = "user" | "auto"; // 완료 경위 — 사용자 완료 / 30분 무대화 등 자동 완료
export interface WorkSession {
  id: string;
  title: string;
  status: WorkSessionStatus;
  doneBy?: WorkSessionDoneBy; // status가 done일 때만
  contextRef?: string; // 탐색기 대상 참조(asset:.. / vuln:.. / product:.. / today)
  createdAt: number;
  updatedAt: number;
}
export interface WorkSessionSummary extends WorkSession {
  turnCount: number;
  lastPreview: string;
  lastRole: "user" | "assistant" | null;
}
export interface WorkSessionTurn {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  tool?: string;
  at: number;
}
export const workSessionsApi = {
  list: () => request<WorkSessionSummary[]>("/api/work-sessions"),
  create: (title?: string, contextRef?: string) =>
    request<WorkSession>("/api/work-sessions", { method: "POST", body: { ...(title ? { title } : {}), ...(contextRef ? { contextRef } : {}) } }),
  get: (id: string) => request<{ session: WorkSession; turns: WorkSessionTurn[] }>(`/api/work-sessions/${id}`),
  update: (id: string, patch: { title?: string; status?: WorkSessionStatus }) =>
    request<WorkSession>(`/api/work-sessions/${id}`, { method: "PATCH", body: patch }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/work-sessions/${id}`, { method: "DELETE" }),
  prune: (olderThanDays: number) =>
    request<{ deleted: number }>("/api/work-sessions/prune", { method: "POST", body: { olderThanDays } }),
  deleteAll: () => request<{ deleted: number }>("/api/work-sessions/delete-all", { method: "POST" }),
  addTurn: (id: string, role: "user" | "assistant", content: string, tool?: string) =>
    request<WorkSessionTurn>(`/api/work-sessions/${id}/turns`, { method: "POST", body: { role, content, ...(tool ? { tool } : {}) } }),
};

// ── 작업 큐 ───────────────────────────────────────────────────────────
export interface NewTaskOptions {
  priority?: "P0" | "P1" | "P2" | "P3";
  dueAt?: number;
  assignee?: string;
  ref?: string;
  routineFeedback?: boolean; // 직접 입력한 일과 — 학습 신호로 기록돼 다음 추천 가이드에 반영
}
export interface RoutineSuggestion {
  cadence: "daily" | "weekly";
  text: string;
  source: string;
}
export const tasksApi = {
  list: () => request("/api/tasks"),
  add: (text: string, opts?: NewTaskOptions) => request("/api/tasks", { method: "POST", body: { text, ...(opts || {}) } }),
  routineSuggestions: () => request<RoutineSuggestion[]>("/api/tasks/routine-suggestions"),
  complete: (id: string) => request(`/api/tasks/${id}/complete`, { method: "POST" }),
  toggle: (id: string, done: boolean) => request(`/api/tasks/${id}/toggle`, { method: "POST", body: { done } }),
  remove: (id: string) => request(`/api/tasks/${id}`, { method: "DELETE" }),
};

// ── 유지보수 일정 · 점검서 · 승인(거버넌스 검증) ──────────────────────
export interface MaintenanceItem {
  id: string;
  title: string;
  productName: string;
  scheduleDate: string;
  intervalDays?: number;
  status: "scheduled" | "reported" | "approved" | "rejected";
  assetId?: string;
  assetName?: string;
  productId?: string; // 연결된 보안제품(security_products) — 서버가 제품명 유사 매칭으로 자동 해석
  reportNote?: string;
  reportDocName?: string;
  reportedBy?: string;
  reportedAt?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MaintenanceEvent {
  id: string;
  itemId: string;
  event: "created" | "reported" | "approved" | "rejected";
  actor?: string;
  note?: string;
  at: number;
}

export const maintenanceApi = {
  list: () => request<MaintenanceItem[]>("/api/maintenance"),
  due: () => request<MaintenanceItem[]>("/api/maintenance/due"),
  byAsset: (assetId: string) => request<MaintenanceItem[]>(`/api/assets/${encodeURIComponent(assetId)}/maintenance`),
  create: (args: { title: string; productName: string; scheduleDate: string; intervalDays?: number; assetId?: string; productId?: string }) =>
    request<MaintenanceItem>("/api/maintenance", { method: "POST", body: args }),
  report: (id: string, args: { note: string; filename?: string; content?: string }) =>
    request<MaintenanceItem>(`/api/maintenance/${id}/report`, { method: "POST", body: args }),
  approve: (id: string) => request<MaintenanceItem>(`/api/maintenance/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) =>
    request<MaintenanceItem>(`/api/maintenance/${id}/reject`, { method: "POST", body: { reason } }),
  history: (id: string) => request<MaintenanceEvent[]>(`/api/maintenance/${id}/history`),
  getNotify: () => request<{ recipients: string[]; dueCount: number }>("/api/maintenance/notify"),
  notify: (to: string[]) => request<{ sent: boolean; count: number }>("/api/maintenance/notify", { method: "POST", body: { to } }),
};

// ── 보안제품 등록부(종류별 관리 + 제품/로그 매뉴얼) ─────────────────────
export interface ProductDoc {
  id: string;
  productId: string;
  kind: string; // manual | logManual | etc
  title: string;
  docName?: string;
  note?: string;
  uploadedBy?: string;
  at: number;
}
export interface SecurityProduct {
  id: string;
  name: string;
  category: string;
  vendor?: string;
  model?: string;
  assetId?: string;
  assetName?: string;
  note?: string;
  docs: ProductDoc[];
  createdAt: number;
  updatedAt: number;
}
export interface ProductCategoryMeta {
  id: string;
  label: string;
  icon: string;
}
export interface ProductGroup {
  category: string;
  label: string;
  icon: string;
  products: SecurityProduct[];
}
// 제품 "정형 정보"(온톨로지 기반 양식) — 매뉴얼 업로드가 RAG 검색용 텍스트로만 남던 것을 보완해,
// 고정된 9개 항목(펌웨어·시리얼·관리IP 등)을 구조화된 값으로 관리한다.
export interface ProductFieldValue {
  key: string;
  label: string;
  value: string;
}

export const securityProductsApi = {
  list: () => request<SecurityProduct[]>("/api/security-products"),
  grouped: () => request<ProductGroup[]>("/api/security-products/grouped"),
  categories: () =>
    request<{ categories: ProductCategoryMeta[]; docKinds: { id: string; label: string }[] }>("/api/security-products/categories"),
  create: (args: { name: string; category: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    request<SecurityProduct>("/api/security-products", { method: "POST", body: args }),
  update: (id: string, patch: { name?: string; category?: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    request<SecurityProduct>(`/api/security-products/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/security-products/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addDoc: (id: string, args: { kind: string; title: string; note?: string; filename?: string; content?: string }) =>
    request<ProductDoc>(`/api/security-products/${encodeURIComponent(id)}/docs`, { method: "POST", body: args }),
  removeDoc: (docId: string) =>
    request<{ ok: boolean }>(`/api/security-products/docs/${encodeURIComponent(docId)}`, { method: "DELETE" }),
  getFields: (id: string) => request<ProductFieldValue[]>(`/api/security-products/${encodeURIComponent(id)}/fields`),
  saveFields: (id: string, fields: { key: string; value: string }[]) =>
    request<ProductFieldValue[]>(`/api/security-products/${encodeURIComponent(id)}/fields`, { method: "POST", body: { fields } }),
  // 매뉴얼 파일에서 AI가 정형 정보 초안을 뽑는다 — 저장 안 됨, 화면에서 확인 후 saveFields로 별도 저장.
  draftFields: (id: string, filename: string, content: string) =>
    request<ProductFieldValue[]>(`/api/security-products/${encodeURIComponent(id)}/fields/draft`, { method: "POST", body: { filename, content } }),
  // 매뉴얼 자동 분류 임포트 — 파일명으로 제품 매칭(없으면 자동 등록)·종류·문서구분까지 반영.
  importDoc: (filename: string, content?: string) =>
    request<{
      filename: string;
      productId: string;
      productName: string;
      category: string;
      kind: string;
      createdProduct: boolean;
      reason: string;
      docName?: string;
    }>("/api/security-products/import-doc", { method: "POST", body: { filename, content } }),
};

// ── 협업 로그 ─────────────────────────────────────────────────────────
export interface CollaborationEvent {
  from: string;
  to: string;
  message: string;
  timestamp: number;
}

export const collaborationApi = {
  history: () => request<CollaborationEvent[]>("/api/collaboration/history"),
};

// ── 로컬 LLM 실동작 스트림 (llm:event) ────────────────────────────────
export interface LlmActivityEvent {
  kind: "chat" | "embed" | "load" | "swap";
  phase: "start" | "done" | "error";
  agent?: string;
  model?: string;
  detail?: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSec?: number;
  latencyMs?: number;
  timestamp: number;
}

export const llmActivityApi = {
  history: () => request<LlmActivityEvent[]>("/api/llm-activity/history"),
};

// ── 스마트 통합 업로드 — 파일 유형 자동 판별·라우팅(취약점 스캔/매뉴얼/문서 분류) ──
export type UploadType = "asset" | "log" | "document" | "guideline" | "vulnreport";
export interface AutoUploadResult {
  filename: string;
  routedTo: "vulnscan" | "product-manual" | "memory" | "decision";
  reason: string;
  needsDecision?: boolean;
  guess?: UploadType;
  guessProductName?: string;
  vulnscan?: { hosts: number; findings: number };
  manual?: { productName: string; kind: string; createdProduct: boolean };
  memory?: { chunks: number; docClass?: string; linkedProduct?: string; category?: string };
  category?: string; // 확정된 업무영역(취약점·장비운영·사내규정·위협대응·일반) — 승인카드 표시용
}
export const uploadApi = {
  auto: (filename: string, content: string, forceType?: UploadType, productName?: string) =>
    request<AutoUploadResult>("/api/upload/auto", {
      method: "POST",
      body: { filename, content, ...(forceType ? { forceType } : {}), ...(productName ? { productName } : {}) },
    }),
};

// ── 선택적 클라우드 LLM 하이브리드 (Gemini/Claude/OpenAI) ─────────────────
export type CloudProvider = "gemini" | "claude" | "openai";
export interface CloudConfig {
  enabled: boolean;
  activeProvider: CloudProvider;
  providers: { provider: CloudProvider; label: string; hasKey: boolean; model: string }[];
}
export interface CloudAskResult {
  routedToCloud: boolean;
  blocked: boolean;
  reasons: string[];
  provider?: CloudProvider;
  providerLabel?: string;
  model?: string;
  answer?: string;
  error?: string;
}
export interface EgressScreen {
  allowed: boolean;
  reasons: string[];
}
export interface EgressLogEntry {
  id: string;
  at: number;
  userId: string | null;
  provider: string | null;
  decision: "allowed" | "blocked";
  reasons: string[];
  questionPreview: string | null;
}
export interface CloudStatus {
  enabled: boolean;
  activeProvider: CloudProvider;
  providerLabel: string;
}
export const cloudApi = {
  status: () => request<CloudStatus>("/api/cloud/status"),
  getConfig: () => request<CloudConfig>("/api/cloud/config"),
  saveConfig: (patch: { enabled?: boolean; activeProvider?: CloudProvider; provider?: CloudProvider; apiKey?: string; model?: string; clearKey?: boolean }) =>
    request<CloudConfig>("/api/cloud/config", { method: "POST", body: patch }),
  ask: (question: string) => request<CloudAskResult>("/api/cloud/ask", { method: "POST", body: { question } }),
  screen: (question: string) => request<EgressScreen>("/api/cloud/screen", { method: "POST", body: { question } }),
  egressLog: (limit?: number) => request<EgressLogEntry[]>(`/api/cloud/egress-log${limit ? `?limit=${limit}` : ""}`),
  saveToKb: (question: string, answer: string, providerLabel: string, model: string) =>
    request<{ documentId: string; chunks: number }>("/api/cloud/save-to-kb", { method: "POST", body: { question, answer, providerLabel, model } }),
  usage: () => request<CloudUsageSummary>("/api/cloud/usage"),
};
export interface CloudUsageRow {
  provider: CloudProvider;
  providerLabel: string;
  model: string;
  calls: number;
  inTokens: number;
  outTokens: number;
  estimatedCost: number;
}
export interface CloudUsageSummary {
  rows: CloudUsageRow[];
  totalCalls: number;
  totalTokens: number;
  estimatedCost: number;
}

// ── 문서 보강 인입 (영문 매뉴얼·장애노트 → 한글 RAG + 온톨로지) ──────────────
export interface EnrichIngestArgs {
  productName: string;
  section: string;
  sourceDoc?: string;
  mode?: "auto" | "cloud" | "local" | "manual";
  text?: string; // AI 모드: 원본(영문/원문)
  korean?: string; // manual 모드: 사람이 작성한 한글 본문
  triples?: { subject: string; predicate: string; object: string }[];
}
export interface EnrichIngestResult {
  documentId: string;
  chunks: number;
  triples: number;
  translated: boolean;
  via: "cloud" | "local" | "manual" | "none";
}
export const docsApi = {
  enrichIngest: (a: EnrichIngestArgs) => request<EnrichIngestResult>("/api/docs/enrich-ingest", { method: "POST", body: a }),
};

// ── 장기 기억(RAG) ────────────────────────────────────────────────────
// 인수인계(Knowledge Transfer) — 올린 문서가 실제 답변 근거로 인용되는지 자동 검증 + 완료 증적.
export interface HandoverCheck {
  documentId: string;
  question: string;
  cited: boolean;
  sources: string[];
  answerPreview: string;
  error?: string;
}
export interface HandoverReport {
  total: number;
  cited: number;
  passRate: number;
  results: HandoverCheck[];
}
export const handoverApi = {
  verify: (documentIds: string[]) =>
    request<HandoverReport>("/api/handover/verify", { method: "POST", body: { documentIds } }),
  complete: (p: { documentIds: string[]; cited: number; total: number; passRate: number }) =>
    request<{ ok: boolean }>("/api/handover/complete", { method: "POST", body: p }),
};

export const memoryApi = {
  ingest: (path: string, scope?: string) =>
    request<IngestResult>("/api/memory/ingest", { method: "POST", body: { path, scope } }),
  ingestFile: (filename: string, content: string, scope?: string) =>
    request<IngestResult>("/api/memory/ingest-file", { method: "POST", body: { filename, content, scope } }),
  query: (question: string, topK?: number, agentId?: string) =>
    request<string[]>("/api/memory/query", { method: "POST", body: { question, topK, agentId } }),
  // 올린 문서 관리(장기기억) — 목록·조각 미리보기·삭제.
  listDocuments: () =>
    request<MemoryDocument[]>("/api/memory/documents"),
  documentChunks: (documentId: string, limit?: number) =>
    request<{ chunkIndex: number; text: string }[]>("/api/memory/document/chunks", { method: "POST", body: { documentId, limit } }),
  // 업무영역(취약점·장비운영·사내규정·위협대응·일반) 수정 — 승인카드의 [영역 수정]용.
  setDocumentCategory: (documentId: string, category: string) =>
    request<{ ok: boolean; documentId: string; category: string }>("/api/memory/document/category", { method: "POST", body: { documentId, category } }),
  deleteDocument: (documentId: string, withFile?: boolean) =>
    request<{ documentId: string; deletedChunks: number; deletedFile: boolean }>("/api/memory/document/delete", { method: "POST", body: { documentId, withFile } }),
  // 서버에 보관된 업로드 원본(base64) — "원본 열기"용.
  documentFile: (documentId: string) =>
    request<{ filename: string; content: string }>("/api/memory/document/file", { method: "POST", body: { documentId } }),
  // 지식베이스 위생 점검(상충·중복·신선도) — 삭제는 하지 않고 리포트만.
  hygiene: () => request<KbHygieneReport>("/api/kb-hygiene"),
  hygieneScan: () => request<KbHygieneReport>("/api/kb-hygiene/scan", { method: "POST" }),
};

export interface KbHygieneFinding { type: "duplicate" | "version_conflict" | "stale"; severity: "high" | "medium" | "low"; documents: string[]; reason: string; suggestion: string }
export interface KbHygieneReport { scannedAt: string; totalDocs: number; findings: KbHygieneFinding[]; clean: boolean }

export interface IngestResult {
  documentId: string;
  chunks: number;
  embeddingModel: string;
  scope: string;
  docClass?: string; // Scan·Analyze Agent 분류(매뉴얼/보고서/정책/기타)
  linkedProduct?: string; // '매뉴얼' 분류 시 자동 연결된 기존 보안제품명
  category?: string; // 업무영역 5종 — 화면 맥락 검색·승인카드 표시용
}

export interface MemoryDocument {
  documentId: string;
  scope: string;
  chunks: number;
  embeddingModel: string | null;
  ingestedAt: string | null;
  hasSource: boolean;
  docClass: string | null;
  uploadedBy?: string | null; // 작업 귀속 — 누가 올렸는지
}

// ── 온톨로지 (지식 그래프 / 하이브리드 지식모델의 의미 계층) ──────────────
export interface OntologyTriple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  scope: string;
  source: string | null;
  createdAt: number;
}
export const ontologyApi = {
  list: (filter?: { scope?: string; subject?: string; source?: string }) => {
    const q = new URLSearchParams();
    if (filter?.scope) q.set("scope", filter.scope);
    if (filter?.subject) q.set("subject", filter.subject);
    if (filter?.source) q.set("source", filter.source); // 문서 파일별 관리 — "이 파일이 만든 연결" 조회
    const qs = q.toString();
    return request<OntologyTriple[]>(`/api/ontology/triples${qs ? `?${qs}` : ""}`);
  },
  add: (t: { subject: string; predicate: string; object: string; scope?: string; source?: string }) =>
    request<OntologyTriple>("/api/ontology/triple", { method: "POST", body: t }),
  remove: (id: string) => request<{ deleted: boolean }>(`/api/ontology/triple/${encodeURIComponent(id)}`, { method: "DELETE" }),
  expand: (text: string, agentId?: string) =>
    request<OntologyTriple[]>("/api/ontology/expand", { method: "POST", body: { text, agentId } }),
  stats: () => request<{ count: number }>("/api/ontology/stats"),
  seed: () => request<{ inserted: number; sources: string[] }>("/api/ontology/seed", { method: "POST" }),
};

// ── AI 견고성: 레드팀(사후 실측) + 가드레일(실시간 방어) ────────────────
export interface RedTeamResult {
  id: string;
  category: string;
  severity: string;
  desc: string;
  vulnerable: boolean;
  prompt: string;
  basis: string;
  responseExcerpt: string;
}
export interface RedTeamReport {
  ranAt: number;
  model: string;
  total: number;
  vulnerable: number;
  robustnessScore: number;
  byCategory: Record<string, { total: number; vulnerable: number }>;
  results: RedTeamResult[];
}
export interface RedTeamTargetAsset {
  id: string;
  name: string;
  assetType: string;
  modelRef: string;
  robustness: { score: number | null; vulnerable: number; total: number; ranAt: number; modelId: string };
}
export interface RedTeamTargets {
  models: { id: string; running: boolean }[];
  assets: RedTeamTargetAsset[];
}
export const redteamApi = {
  // opts 없음=오케스트레이터, {modelId}=특정 로컬 모델, {assetId}=AI-BOM 자산(결과가 자산에 기록됨).
  run: (opts?: { modelId?: string; assetId?: string }) =>
    request<RedTeamReport & { targetKey?: string }>("/api/redteam/run", { method: "POST", body: opts ?? {} }),
  last: (target?: string) => request<RedTeamReport>(`/api/redteam/last${target ? `?target=${encodeURIComponent(target)}` : ""}`),
  targets: () => request<RedTeamTargets>("/api/redteam/targets"),
  payloads: () => request<{ id: string; category: string; severity: string; desc: string }[]>("/api/redteam/payloads"),
};

export type GuardMode = "off" | "flag" | "block";
export interface GuardEvent {
  at: number;
  source: string;
  excerpt: string;
  categories: string[];
  blocked: boolean;
}
export const guardrailApi = {
  status: () => request<{ mode: GuardMode; flaggedCount: number; blockedCount: number }>("/api/guardrail/status"),
  log: (limit = 50) => request<GuardEvent[]>(`/api/guardrail/log?limit=${limit}`),
  setMode: (mode: GuardMode) =>
    request<{ mode: GuardMode; flaggedCount: number; blockedCount: number }>("/api/guardrail/mode", { method: "POST", body: { mode } }),
};

// ── 통합 보안 분석(관제) 허브 — 취약점·로그·운영리포트 3소스 정규화 ──────────
export type EventStatus = "open" | "ack" | "inprogress" | "done" | "ignored";
export interface AnalysisEvent {
  id: string;
  source: "vuln" | "log" | "product";
  title: string;
  entity: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  priority: "P0" | "P1" | "P2" | "P3";
  detail: string;
  signals: string[];
  aiSummary: string;
  ref: string;
  at: number;
  status?: EventStatus;
  statusNote?: string;
}
export interface AnalysisCorrelation {
  entity: string;
  sources: ("vuln" | "log" | "product")[];
  eventIds: string[];
  note: string;
}
export interface AnalysisHubData {
  events: AnalysisEvent[];
  summary: {
    total: number;
    bySource: { vuln: number; log: number; product: number };
    byPriority: { P0: number; P1: number; P2: number; P3: number };
    overall: "높음" | "보통" | "낮음";
  };
  correlations: AnalysisCorrelation[];
}
export const analysisHubApi = {
  events: () => request<AnalysisHubData>("/api/analysis-hub/events"),
  rebuildVuln: () => request<{ inserted: number }>("/api/analysis-hub/rebuild-vuln", { method: "POST" }),
  analyze: (eventId: string) => request<{ aiSummary: string }>("/api/analysis-hub/analyze", { method: "POST", body: { eventId } }),
  setStatus: (eventId: string, status: EventStatus, note = "") =>
    request<{ ok: boolean; status: EventStatus }>(`/api/analysis-hub/events/${encodeURIComponent(eventId)}/status`, { method: "POST", body: { status, note } }),
  // 드롭존 통합 인입 — 서버가 로그/리포트를 자동 판별해 라우팅.
  ingest: (filename: string, content: string) =>
    request<{ routedTo: "log" | "report"; created: number; events: AnalysisEvent[] }>("/api/analysis-hub/ingest", {
      method: "POST",
      body: { filename, content },
    }),
  attackPaths: () => request<{ paths: AttackPath[] }>("/api/analysis-hub/attack-paths"),
};

export interface AttackPathStep { kind: "entry" | "foothold" | "lateral"; entity: string; label: string; source: string; severity: string }
export interface AttackPath { id: string; entity: string; reachability: "확인됨" | "높음" | "보통"; reachScore: number; steps: AttackPathStep[]; note: string }

// ── LLM 브리지 / 채팅 ─────────────────────────────────────────────────
export const bridgeApi = {
  run: (payload: unknown) => request("/api/bridge/run", { method: "POST", body: payload }),
  adapters: () => request("/api/bridge/adapters"),
};

// 오늘의 할일(가이드형) — 서버가 취약점·정기점검·유지보수를 합쳐 계산해 내려준다.
export interface TodayItem {
  id: string; axis: "vuln" | "device"; urgency: "now" | "today";
  title: string; subtitle: string; why: string; action: string; badges: string[];
  ref?: string; kev?: boolean; epssPct?: number;
}
export interface TodayBrief {
  items: TodayItem[]; counts: { now: number; today: number; later: number };
  brief: string; briefBy: "llm" | "rule"; generatedAt: number;
}
export const todayApi = {
  // brief=false면 LLM을 부르지 않고 즉답한다(첫 렌더용).
  get: (withBrief = true) => request<TodayBrief>(`/api/today?brief=${withBrief ? 1 : 0}`),
};

export const llmApi = {
  chat: (agentId: string, message: string) =>
    request("/api/llm/chat", { method: "POST", body: { agentId, message } }),
};

// ── 로컬 엔진(llama.cpp 서버) ─────────────────────────────────────────
export interface GijoTierInfo {
  gpu: { totalMb: number; usedMb: number; freeMb: number; utilization: number } | null;
  current: { tier: "lite" | "standard" | "pro" | null; maxLoadedModels: number; ctxSize: number; overheadMb: number };
  recommended: "lite" | "standard" | "pro" | null;
  reason: string;
  tiers: { id: string; label: string; vramLabel: string; maxLoadedModels: number; ctxSize: number; desc: string }[];
}

export const localEngineApi = {
  status: () => request("/api/localengine/status"),
  models: () => request<{ id: string; running: boolean }[]>("/api/localengine/models"),
  start: (modelId: string) => request("/api/localengine/start", { method: "POST", body: { modelId } }),
  stop: () => request("/api/localengine/stop", { method: "POST" }),
  // GIJO 구동 티어(Lite/Standard/Pro) — GPU 실측·권장 판정 조회와 적용(채팅 모델 풀 재기동 수반).
  tier: () => request<GijoTierInfo>("/api/localengine/tier"),
  setTier: (tier: string) => request<{ applied: string; restarting: boolean }>("/api/localengine/tier", { method: "POST", body: { tier } }),
};

// ── 파인튜닝(학습 — 모델 가중치에 지식 내재화) ───────────────────────────
export const finetuneApi = {
  start: (agentId: string, datasetId: string) =>
    request("/api/finetune/start", { method: "POST", body: { agentId, datasetId } }),
};

// ── 데이터셋 ──────────────────────────────────────────────────────────
export interface ConversationExample {
  question: string;
  answer: string;
}

export const datasetApi = {
  convert: (rawText: string) =>
    request<ConversationExample[]>("/api/dataset/convert", { method: "POST", body: { rawText } }),
  amplify: (examples: ConversationExample[], factor?: number) =>
    request<ConversationExample[]>("/api/dataset/amplify", { method: "POST", body: { examples, factor } }),
  save: (id: string, examples: ConversationExample[]) =>
    request<{ id: string; examples: number }>("/api/dataset/save", { method: "POST", body: { id, examples } }),
  list: () => request<{ id: string; examples: number }[]>("/api/dataset/list"),
  extract: (filename: string, content: string) =>
    request<{ text: string }>("/api/dataset/extract", { method: "POST", body: { filename, content } }),
};

// ── 헤르메스 폐쇄형 학습 루프 ─────────────────────────────────────────
// 수집(대화 로그) → 정제(👍만 데이터셋으로) → 학습(QLoRA) → 배포(GGUF→에이전트 할당).
// 실행 진행은 learnloop:progress WebSocket 채널로 밀려온다.
export interface LearnloopChatLog {
  id: string;
  agentId: string;
  question: string;
  answer: string;
  rating: number | null;
  usedInDataset: boolean;
  createdAt: number;
}

export interface LearnloopRun {
  id: string;
  datasetId: string;
  baseModel: string;
  outputModelId: string;
  stage: "stopping-engines" | "training" | "exporting" | "deploying" | "restarting-engines" | "done" | "error";
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface LearnloopConfig {
  autoCollect: boolean;
  baseModel: string;
  modelPrefix: string;
  targetAgent: string;
}

export interface LearnloopPreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail?: string;
  hint?: string;
}

export const learnloopApi = {
  preflight: () => request<{ checks: LearnloopPreflightCheck[]; ready: boolean }>("/api/learnloop/preflight"),
  logs: (limit?: number, offset?: number) =>
    request<{ logs: LearnloopChatLog[]; kpis: { total: number; positive: number; negative: number; unused: number } }>(
      `/api/learnloop/logs?limit=${limit ?? 50}&offset=${offset ?? 0}`
    ),
  rate: (id: string, rating: 1 | -1 | 0) =>
    request<LearnloopChatLog>(`/api/learnloop/logs/${encodeURIComponent(id)}/rate`, { method: "POST", body: { rating } }),
  removeLog: (id: string) => request(`/api/learnloop/logs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  buildDataset: (includeUnrated?: boolean) =>
    request<{ datasetId: string; examples: number }>("/api/learnloop/build-dataset", { method: "POST", body: { includeUnrated } }),
  run: (datasetId?: string) => request<LearnloopRun>("/api/learnloop/run", { method: "POST", body: { datasetId } }),
  status: () => request<{ running: boolean; run: LearnloopRun | null }>("/api/learnloop/status"),
  runs: () => request<LearnloopRun[]>("/api/learnloop/runs"),
  getConfig: () => request<LearnloopConfig>("/api/learnloop/config"),
  putConfig: (patch: Partial<LearnloopConfig>) => request<LearnloopConfig>("/api/learnloop/config", { method: "PUT", body: patch }),
};

// ── HuggingFace 모델 ──────────────────────────────────────────────────
// 다운로드는 서버가 백그라운드 큐로 처리한다 — load()는 잡을 큐에 넣고 즉시 반환하며,
// 실제 진행률은 hf-download:progress WebSocket 채널(또는 jobs() 폴링)로 따라간다.
export interface HfDownloadJob {
  id: string;
  modelId: string;
  file?: string;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  error?: string;
  localPath?: string;
  createdAt: number;
  updatedAt: number;
}
export const hfModelsApi = {
  search: (query: string) => request(`/api/hfmodels/search?q=${encodeURIComponent(query)}`),
  load: (modelId: string) => request<HfDownloadJob>("/api/hfmodels/load", { method: "POST", body: { modelId } }),
  jobs: () => request<HfDownloadJob[]>("/api/hfmodels/jobs"),
  job: (id: string) => request<HfDownloadJob>(`/api/hfmodels/jobs/${encodeURIComponent(id)}`),
};

// ── Git 동기화 ────────────────────────────────────────────────────────
export const gitSyncApi = {
  sync: (remoteUrl: string, branch: string) =>
    request("/api/gitsync/sync", { method: "POST", body: { remoteUrl, branch } }),
};

// ── 의도 라우팅 ───────────────────────────────────────────────────────
export const intentApi = {
  route: (text: string) => request("/api/intent/route", { method: "POST", body: { text } }),
};

// ── 도구(Tools) ───────────────────────────────────────────────────────
export const toolsApi = {
  list: () => request("/api/tools"),
  run: (name: string, params: unknown) => request("/api/tools/run", { method: "POST", body: { name, params } }),
};

// ── 이메일 리포트 발송 ────────────────────────────────────────────────
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  hasPassword: boolean;
  fromAddress: string;
}

export interface SmtpConfigInput {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromAddress: string;
}

export const emailApi = {
  sendReport: (to: string[], subject: string, attachmentPath: string) =>
    request("/api/email/sendReport", { method: "POST", body: { to, subject, attachmentPath } }),
  getConfig: () => request<SmtpConfig | null>("/api/email/config"),
  saveConfig: (config: SmtpConfigInput) => request<SmtpConfig>("/api/email/config", { method: "POST", body: config }),
};

// ── 인바운드 SMTP(알림 집수) ─────────────────────────────────────────
export interface SmtpInboundConfig {
  enabled: boolean;
  port: number;
  allowedIps: string[];
  bannerName: string;
}
export interface SmtpInboundStatus {
  running: boolean;
  lastError: string | null;
  lastReceivedAt: number | null;
  receivedCount: number;
}
export const smtpInboundApi = {
  getConfig: () => request<SmtpInboundConfig>("/api/smtp-inbound/config"),
  saveConfig: (config: { enabled: boolean; port: number; allowedIpsText?: string }) =>
    request<SmtpInboundConfig>("/api/smtp-inbound/config", { method: "POST", body: config }),
  getStatus: () => request<SmtpInboundStatus>("/api/smtp-inbound/status"),
};

export interface SiemConfig { enabled: boolean; host: string; port: number; format: "rfc5424" | "cef"; minSeverity: "info" | "high" | "critical" }
export const siemApi = {
  getConfig: () => request<SiemConfig>("/api/siem/config"),
  saveConfig: (config: Partial<SiemConfig>) => request<SiemConfig>("/api/siem/config", { method: "POST", body: config }),
  test: () => request<{ sent: boolean; format: string; target: string }>("/api/siem/test", { method: "POST" }),
};

// ── SBOM ─────────────────────────────────────────────────────────────
export const sbomApi = {
  generate: (assetId: string) => request(`/api/sbom/${assetId}/generate`, { method: "POST" }),
  export: (assetId: string, format: "cyclonedx" | "spdx") =>
    request(`/api/sbom/${assetId}/export`, { method: "POST", body: { format } }),
  aibomExport: (assetId: string) =>
    request<{ path: string; filename: string; json: string }>(`/api/sbom/${assetId}/aibom-export`, { method: "POST" }),
  aibomThreats: (assetId: string) => request<AiBomThreatReport>(`/api/assets/${assetId}/aibom/threats`),
};

export interface AiBomThreatMatch {
  code: string;
  name: string;
  category: string;
  categoryLabel: string;
  matchedAreas: string[];
  status: "covered" | "partial" | "na" | "open";
  owasp: string[];
  nist: string[];
}
export interface AiBomThreatReport {
  assetId: string;
  assetName: string;
  matches: AiBomThreatMatch[];
  summary: { relevant: number; covered: number; partial: number; na: number; open: number };
}

// ── CTI(위협 인텔리전스) ──────────────────────────────────────────────
export interface CtiAssetMatch {
  finding: { id: string; detectedAt: string; type: string; target: string; source: string; severity: "info" | "warning" | "critical" };
  matchedAssets: { assetId: string; assetName: string; matchedOn: string[] }[];
}

export const ctiApi = {
  feeds: () => request("/api/cti/feeds"),
  findings: () => request("/api/cti/findings"),
  configureFeed: (feedId: string, apiKey: string) =>
    request(`/api/cti/feeds/${feedId}/configure`, { method: "POST", body: { apiKey } }),
  // 커스텀 벤더 직접 추가 — 이름을 직접 입력해 등록·키 설정.
  addCustomFeed: (name: string, apiKey: string) =>
    request("/api/cti/feeds", { method: "POST", body: { name, apiKey } }),
  disconnectFeed: (feedId: string) => request(`/api/cti/feeds/${feedId}/disconnect`, { method: "POST" }),
  assetMatches: () =>
    request<{ matches: CtiAssetMatch[]; summary: { totalFindings: number; matchedFindings: number; affectedAssets: number; criticalMatches: number } }>(
      "/api/cti/asset-matches"
    ),
};

// ── 통합 보안 KPI 대시보드 ────────────────────────────────────────────
export interface KpiSnapshot {
  date: string;
  at: number;
  assets: { total: number; highRisk: number; midRisk: number; lowRisk: number };
  findings: { total: number; pending: number; approved: number; rejected: number };
  inspections: { total: number; overdue: number; pendingApproval: number; approved: number; rejected: number };
  cti: { totalFindings: number; matchedFindings: number; affectedAssets: number; criticalMatches: number };
  compliance: { total: number; covered: number; coverageRate: number };
  learning: { totalRuns: number; deployedModels: number };
  vulnerabilities?: { hosts: number; active: number; critical: number; high: number; medium: number; low: number; kev: number; newCount: number; resurfaced: number; newlyFixed: number; remediationRate: number };
  remediation?: { tasks: number; open: number; done: number; overdue: number; dueSoon: number; slaCompliance: number };
  posture?: { score: number; band: "good" | "fair" | "poor"; factors: { label: string; value: number }[] };
  mttrDays?: number | null;
  aiSecurity?: {
    aiAssets: number; owaspOpen: number; topRisk: { code: string; title: string; count: number } | null;
    aibomComplete: number; aibomMissing: number; redteamTested: number; avgRobustness: number | null;
  };
}

export interface BurndownPoint {
  at: number;
  active: number;
  critical: number;
  high: number;
  kev: number;
  fixed: number;
}

export const kpiApi = {
  get: () => request<{ current: KpiSnapshot; trend: KpiSnapshot[]; burndown: BurndownPoint[] }>("/api/kpi"),
};

// ── 내부 리포트 ───────────────────────────────────────────────────────
export const reportApi = {
  generate: (
    type: "weekly" | "quarterly" | "ondemand",
    assetIds?: string[],
    opts?: { audience?: "internal" | "official"; format?: "docx" | "pdf" | "both" }
  ) => request("/api/report/generate", { method: "POST", body: { type, assetIds, audience: opts?.audience, format: opts?.format } }),
  // 생성된 리포트 파일 내용(base64) — 클라이언트가 blob으로 만들어 열기/저장.
  file: (name: string) =>
    request<{ name: string; mime: string; base64: string }>(`/api/report/file/${encodeURIComponent(name)}`),
  // 저장된 리포트 이력(과거 생성분 포함).
  history: () =>
    request<ReportHistoryEntry[]>("/api/report/history"),
  // 리포트 삭제(docx·pdf·메타 일괄).
  remove: (base: string) =>
    request<{ deleted: string[] }>(`/api/report/${encodeURIComponent(base)}`, { method: "DELETE" }),
  // N일 이전 리포트 일괄 삭제.
  prune: (olderThanDays: number) =>
    request<{ deletedReports: number; deletedFiles: number }>("/api/report/prune", { method: "POST", body: { olderThanDays } }),
  // 전체 리포트 삭제.
  removeAll: () =>
    request<{ deletedReports: number; deletedFiles: number }>("/api/report/delete-all", { method: "POST" }),
};

export interface ReportHistoryEntry {
  base: string;
  type: string;
  createdAt: number;
  audience?: "internal" | "official";
  assetIds: string[];
  assetNames: string[];
  summary?: string;
  docx?: string;
  pdf?: string;
  createdBy?: string; // 작업 귀속 — 누가 생성했는지
}

// ── 정기 리포트(주간/분기) 자동 생성 스케줄 ────────────────────────────────
export interface ReportSchedule {
  id: string;
  type: "ondemand" | "daily" | "weekly" | "monthly" | "quarterly";
  assetIds: string[] | null;
  format: "docx" | "pdf" | "both";
  audience: "internal" | "official";
  dayOfWeek: number | null;
  hour: number;
  minute: number;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number;
  lastResult: "success" | "fail" | null;
  lastError: string | null;
  lastReportBase: string | null;
  createdAt: number;
}
export interface ReportScheduleRunEntry {
  id: string; scheduleId: string; at: number; source: "scheduled" | "manual"; result: "success" | "fail"; detail: string | null;
}
export interface CreateReportScheduleInput {
  type: "ondemand" | "daily" | "weekly" | "monthly" | "quarterly";
  assetIds?: string[] | null;
  format: "docx" | "pdf" | "both";
  audience: "internal" | "official";
  dayOfWeek?: number | null;
  hour: number;
  minute: number;
}

export const reportScheduleApi = {
  list: () => request<{ schedules: ReportSchedule[] }>("/api/report/schedules"),
  create: (input: CreateReportScheduleInput) => request<{ schedule: ReportSchedule }>("/api/report/schedules", { method: "POST", body: input }),
  update: (id: string, patch: Partial<CreateReportScheduleInput> & { enabled?: boolean }) =>
    request<{ schedule: ReportSchedule }>(`/api/report/schedules/${id}`, { method: "PATCH", body: patch }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/report/schedules/${id}`, { method: "DELETE" }),
  runNow: (id: string) => request<{ schedule: ReportSchedule }>(`/api/report/schedules/${id}/run`, { method: "POST" }),
  runs: (scheduleId?: string, limit?: number) => {
    const q = new URLSearchParams();
    if (scheduleId) q.set("scheduleId", scheduleId);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return request<{ runs: ReportScheduleRunEntry[] }>(`/api/report/schedules/runs${qs ? `?${qs}` : ""}`);
  },
};

// ── 사용량 · 요금 ─────────────────────────────────────────────────────
export interface UsageSummary {
  service: string;
  callCount: number;
  estimatedCost: number;
}

export const usageApi = {
  summary: (sinceMs?: number) =>
    request<UsageSummary[]>(`/api/usage/summary${sinceMs ? `?sinceMs=${sinceMs}` : ""}`),
};

// ── 서버 헬스체크 ─────────────────────────────────────────────────────
export const healthApi = {
  check: () => request<{ ok: boolean; service: string }>("/api/health"),
};

// ── 클라이언트(Electron) 설치파일 배포 — 이 서버 자체가 배포처(외부 서비스 없음) ──────────
export interface ClientReleaseInfo {
  version: string;
  notes: string | null;
  size: number;
  publishedAt: number;
  sha256: string;
}
export interface ClientUpdateCheckResult {
  latest: ClientReleaseInfo | null;
  updateAvailable: boolean;
}
export interface ClientReleaseFull {
  version: string;
  notes: string | null;
  filename: string;
  sha256: string;
  size: number;
  publishedAt: number;
}
export const clientReleaseApi = {
  // 실제 다운로드·설치·재시작은 main.ts(메인 프로세스)가 authState로 직접 처리한다(대용량 스트리밍 +
  // 설치 파일 실행 + 앱 종료가 필요해 렌더러의 request() 헬퍼로는 못 한다).
  checkLatest: (currentVersion: string) => request<ClientUpdateCheckResult>(`/api/client/latest-release?current=${encodeURIComponent(currentVersion)}`),
  // 관리자 전용 — 게시 이력 전체(update.html의 관리자 패널).
  listAll: () => request<{ releases: ClientReleaseFull[] }>("/api/client/releases"),
};

// ── 계정 관리 (admin 전용 목록/생성/삭제, 본인 비밀번호 변경은 누구나) ──────
export interface GijoUserPublic {
  id: string;
  username: string;
  displayName: string;
  role: "security_officer" | "admin";
  createdAt: number;
}

export const usersApi = {
  list: () => request<GijoUserPublic[]>("/api/users"),
  // 조치 담당자 배정용(승인 화면 자동완성) — 관리자 아니어도 조회 가능.
  assignable: () => request<{ id: string; displayName: string; role: string }[]>("/api/users/assignable"),
  create: (args: { username: string; password: string; displayName: string; role: "security_officer" | "admin" }) =>
    request<GijoUserPublic>("/api/users", { method: "POST", body: args }),
  remove: (id: string) => request(`/api/users/${id}`, { method: "DELETE" }),
  changePassword: (id: string, password: string) =>
    request(`/api/users/${id}/password`, { method: "POST", body: { password } }),
  setRole: (id: string, role: "security_officer" | "admin") =>
    request<GijoUserPublic>(`/api/users/${id}/role`, { method: "POST", body: { role } }),
  sessions: () => request<ActiveSessionInfo[]>("/api/users/sessions"),
  terminateSession: (id: string) => request<{ terminated: boolean }>(`/api/users/${id}/terminate-session`, { method: "POST" }),
};

export interface ActiveSessionInfo { userId: string; username: string; displayName: string; role: "security_officer" | "admin"; ip: string | null; since: number; lastSeenAt: number }

// ── 서버 로그 ─────────────────────────────────────────────────────────
export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

export const logsApi = {
  list: () => request<LogEntry[]>("/api/logs"),
};

// ── 작업 기록(감사 로그) ──────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  at: number;
  kind: "cli" | "approval" | "write" | "block" | "auth" | "config";
  actor: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  result: "ok" | "blocked" | "error" | "pending";
}
export const auditApi = {
  list: (kind?: string, limit?: number) => {
    const q = new URLSearchParams();
    if (kind) q.set("kind", kind);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return request<{ entries: AuditEntry[]; summary: { total: number; byKind: Record<string, number> } }>(`/api/audit${qs ? `?${qs}` : ""}`);
  },
  record: (action: string, target?: string, detail?: string, kind?: string, result?: string) =>
    request<{ ok: boolean }>("/api/audit", { method: "POST", body: { action, target, detail, kind, result } }),
};

// ── 터미널 명령 제안(챗봇 → CLI, 제안만·실행은 클라이언트가 승인 후) ──────────
export const terminalApi = {
  suggest: (requestText: string) =>
    request<{ command: string; explanation: string }>("/api/terminal/suggest", { method: "POST", body: { request: requestText } }),
};

// ── 보안장비 하드닝(보안설정) 점검 — 표준 기준 체크리스트 실행·리포트 ──────────
export type HardeningStatus = "PASS" | "FAIL" | "WARN" | "NA";
export interface HardeningItem { id: string; cat: string; title: string; ref: string; remediation: string; status: HardeningStatus; evidence: string }
export interface HardeningReport {
  standard: "kisa" | "cis";
  standardLabel: string;
  target: string;
  startedAt: string;
  durationMs: number;
  items: HardeningItem[];
  summary: { total: number; pass: number; fail: number; warn: number; na: number; scored: number; rate: number; verdict: string };
}
export interface HardeningChecklist { id: "kisa" | "cis"; label: string; count: number; items: { id: string; cat: string; title: string; ref: string }[] }

// 원격 SSH 정기점검 — 대상(장비)·스케줄·이력
export type HardeningAuth = "local" | "key" | "password";
export interface HardeningTargetPublic { id: string; label: string; host: string; port: number; username: string | null; authMethod: HardeningAuth; hasSecret: boolean }
export interface HardeningScheduleRow { id: string; targetId: string; targetLabel: string; standard: "kisa" | "cis"; intervalHours: number; enabled: number; lastRunAt: number | null; nextRunAt: number; lastRate: number | null; lastFail: number | null; createdAt: number }
export interface HardeningRun { id: string; targetId: string; targetLabel: string; standard: string; at: number; rate: number; pass: number; fail: number; warn: number; na: number; source: string; summary: string | null }
export interface NewTarget { label: string; host: string; port?: number; username?: string; authMethod: HardeningAuth; secret?: string }

export const hardeningApi = {
  checklists: () => request<{ standards: HardeningChecklist[] }>("/api/hardening/checklists"),
  scan: (standard: "kisa" | "cis", target?: string) =>
    request<{ report: HardeningReport; markdown: string; summary: string }>("/api/hardening/scan", { method: "POST", body: { standard, target } }),
  // 대상(장비)
  listTargets: () => request<{ targets: HardeningTargetPublic[] }>("/api/hardening/targets"),
  createTarget: (t: NewTarget) => request<{ target: HardeningTargetPublic }>("/api/hardening/targets", { method: "POST", body: t }),
  deleteTarget: (id: string) => request<{ ok: boolean }>(`/api/hardening/targets/${id}`, { method: "DELETE" }),
  probeTarget: (id: string) => request<{ ok: boolean; detail: string }>(`/api/hardening/targets/${id}/probe`, { method: "POST", body: {} }),
  scanTarget: (id: string, standard: "kisa" | "cis") =>
    request<{ report: HardeningReport; summary: string }>(`/api/hardening/targets/${id}/scan`, { method: "POST", body: { standard } }),
  // 스케줄
  listSchedules: () => request<{ schedules: HardeningScheduleRow[] }>("/api/hardening/schedules"),
  createSchedule: (targetId: string, standard: "kisa" | "cis", intervalHours: number) =>
    request<{ schedule: HardeningScheduleRow }>("/api/hardening/schedules", { method: "POST", body: { targetId, standard, intervalHours } }),
  toggleSchedule: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/api/hardening/schedules/${id}`, { method: "PATCH", body: { enabled } }),
  deleteSchedule: (id: string) => request<{ ok: boolean }>(`/api/hardening/schedules/${id}`, { method: "DELETE" }),
  // 이력
  runs: (targetId?: string, limit?: number) => {
    const q = new URLSearchParams();
    if (targetId) q.set("targetId", targetId);
    if (limit) q.set("limit", String(limit));
    const qs = q.toString();
    return request<{ runs: HardeningRun[] }>(`/api/hardening/runs${qs ? `?${qs}` : ""}`);
  },
};

// ── 자산 인벤토리 ─────────────────────────────────────────────────────
export interface AssetComponent {
  name: string;
  version: string;
  license: string;
}

export interface Finding {
  finding_type: string;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string;
  source_tool: string;
}

export interface AiBomRobustness {
  score: number | null;
  vulnerable: number;
  total: number;
  ranAt: number;
  modelId: string;
}
export interface AiBom {
  model: { foundationModel: string; finetuneHistory: string; architecture: string; weightsHash: string; intendedUse: string; limitations: string; modelRef: string };
  dataset: { sources: string; vectorDbLocation: string };
  prompt: { systemPrompt: string; guardrails: string };
  agentTool: { apis: string; mcpServers: string };
  infrastructure: { compute: string; hostingProvider: string };
  robustness: AiBomRobustness;
}

// sample = 데모용 시드 데이터, scanner = 취약점 스캔 반입, registered = 직접 등록·저장소 스캔
export type AssetOrigin = "sample" | "scanner" | "registered";

export interface Asset {
  origin: AssetOrigin;
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  service: string | null;
  components: AssetComponent[];
  findings: Finding[];
  aibom: AiBom;
  category: string | null;
  hostname: string | null;
  ip: string | null;
  registeredAt: number;
  updatedAt: number | null;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

// ── 자산 커버리지(무엇을 모르는가) ────────────────────────────────────
export type AssetGapKind = "owner" | "service" | "sbom" | "unscanned";

export interface AssetGap {
  kind: AssetGapKind;
  severity: "high" | "mid";
  title: string;
  why: string;
  fixLabel: string;
  assetIds: string[];
}

export interface RankedAsset {
  id: string;
  name: string;
  gaps: AssetGapKind[];
  openFindings: number;
  maxSeverity: string;
  kev: boolean;
  why: string;
  score: number;
}

export interface AssetCoverage {
  total: number;
  complete: number;
  gaps: AssetGap[];
  ranked: RankedAsset[];
}

// ── 자산 허브(통합 뷰) ────────────────────────────────────────────────
export type OwaspStatus = "open" | "covered" | "na";
export interface OwaspRiskState { code: string; title: string; status: OwaspStatus; evidence: string }
export interface AssetHubVuln { critical: number; high: number; medium: number; low: number; kev: number; open: number }
export interface AssetHubRow {
  id: string; name: string;
  displayName: string | null; // 담당자가 붙인 표시 이름(별칭) — 화면은 있으면 이걸 보여준다
  sourceFile: string | null;  // 이 자산이 등록된 출처 파일. 직접 등록이면 null
  assetType: string; isAi: boolean; owner: string; service: string | null; host: string | null;
  vuln: AssetHubVuln;
  bomAreas: { model: number; dataset: number; prompt: number; agentTool: number; infrastructure: number; total: number };
  sbomGenerated: boolean; robustnessScore: number | null; owaspOpen: number; owaspTopCodes: string[];
  exposureScore: number; riskBand: "critical" | "high" | "medium" | "ok";
}
export interface AssetHubSummary {
  totalAssets: number; aiAssets: number; itAssets: number; overallExposure: number;
  bands: { aiAssetAvg: number; externalAvg: number; internalAvg: number };
  owaspOpenByCode: { code: string; title: string; count: number }[];
  vuln: { open: number; critical: number; high: number; medium: number; kev: number };
  sbomMissing: number;
}
// 파일(출처) 단위 묶음 — 올린 파일 기준으로 자산을 정리해 본다.
export interface HubSourceGroup {
  sourceFile: string | null;
  label: string;
  assetIds: string[];
  assetCount: number;
  vuln: AssetHubVuln;
  lastScannedAt: number | null;
}
export interface AssetHubOverview { summary: AssetHubSummary; rows: AssetHubRow[]; sourceGroups: HubSourceGroup[] }
export interface AssetHubDetail {
  row: AssetHubRow;
  owasp: OwaspRiskState[];
  findings: { title: string; severity: string; kev: boolean; evidence: string; state: string }[];
  aibom: AiBom;
  host: string | null;
}

// ── 서비스 영향도 ─────────────────────────────────────────────────────
export interface ServiceImpact {
  service: string;
  assetCount: number;
  highRiskAssets: number;
  ctiAffectedAssets: number;
  overdueInspections: number;
  impactLevel: "high" | "mid" | "low" | "none";
  assets: { id: string; name: string; risk: "high" | "mid" | "low" | "none"; ctiThreat: boolean; overdueInspections: number }[];
}

export const serviceImpactApi = {
  get: () =>
    request<{ services: ServiceImpact[]; summary: { totalServices: number; atRisk: number; unassignedAssets: number } }>("/api/service-impact"),
};

// 자산 허브(자산 목록·AI-BOM·취약점 통합 뷰) — 서버 assethub.ts 집계.
export interface ShadowModel { modelId: string; sources: string[]; running: boolean; usedByAgents: string[]; severity: "high" | "medium"; suggestion: string }
export interface ShadowAiReport { scannedAt: string; observedCount: number; governedCount: number; shadow: ShadowModel[] }

export const assetHubApi = {
  overview: () => request<AssetHubOverview>("/api/assethub"),
  detail: (id: string) => request<AssetHubDetail>(`/api/assethub/${encodeURIComponent(id)}`),
  shadowAi: () => request<ShadowAiReport>("/api/shadow-ai"),
  // 표시 이름(별칭) 변경 — null/빈 문자열이면 원래 이름으로 되돌린다.
  setDisplayName: (id: string, displayName: string | null) =>
    request<Asset>(`/api/assets/${encodeURIComponent(id)}/display-name`, { method: "POST", body: { displayName } }),
};

// 파일 업로드 진행내역 리포트(선택 저장) — 감사·인수인계 증빙용.
export interface IngestReportInput {
  filename: string; routedTo: string; reason: string;
  steps?: string[]; assetIds?: string[]; hosts?: number; findings?: number; chunks?: number;
}
export const ingestReportApi = {
  save: (input: IngestReportInput) =>
    request<{ base: string; path: string; savedAt: number }>("/api/upload/ingest-report", { method: "POST", body: input }),
};

// 오래 걸려 리포트로 돌린 요청 — 다 되면 화면이 팝업으로 알린다(2026-07-26).
export interface LongAnswerNotice {
  id: string; instruction: string; status: "done" | "failed";
  reportBase: string | null; error: string | null; startedAt: number; finishedAt: number | null;
}
export const longAnswerApi = {
  pending: () => request<{ notices: LongAnswerNotice[] }>("/api/long-answers/pending"),
  ack: (id: string) => request<{ ok: true }>(`/api/long-answers/${encodeURIComponent(id)}/ack`, { method: "POST" }),
};

export const assetsApi = {
  list: () => request<Asset[]>("/api/assets"),
  get: (id: string) => request<Asset>(`/api/assets/${id}`),
  // 경량 단건 재스캔(대시보드 팝오버) — dispatch 파이프라인 없이 어댑터만 실행.
  scan: (id: string) => request<{ assetId: string; findings: number }>(`/api/assets/${id}/scan`, { method: "POST" }),
  register: (args: { id: string; name: string; path: string; assetType?: string; owner?: string; service?: string; components?: AssetComponent[] }) =>
    request<Asset>("/api/assets", { method: "POST", body: args }),
  import: (content: string, format: "json" | "csv", source: string) =>
    request<{ imported: number; skipped: number; assets: Asset[] }>("/api/assets/import", {
      method: "POST",
      body: { content, format, source },
    }),
  scanRepos: (args: { provider: string; owner: string; token?: string; baseUrl?: string; maxRepos?: number }) =>
    request<{ scanned: number; registered: number; assets: Asset[] }>("/api/reposcan", { method: "POST", body: args }),
  updateAiBom: (id: string, aibom: AiBom) => request<Asset>(`/api/assets/${id}/aibom`, { method: "PUT", body: { aibom } }),
  // ④ 카테고리(그룹) 지정/해제 — null이면 미분류.
  setCategory: (id: string, category: string | null) =>
    request<Asset>(`/api/assets/${encodeURIComponent(id)}/category`, { method: "PATCH", body: { category } }),
  weightsHash: (id: string, filePath?: string) =>
    request<{ assetId: string; filePath: string; sizeBytes: number; weightsHash: string }>(`/api/assets/${id}/aibom/weights-hash`, { method: "POST", body: { filePath } }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // 자산 정보 결손 현황 — 화면 커버리지 탭과 챗봇이 같은 계산을 본다.
  coverage: () => request<AssetCoverage>("/api/assets/coverage"),
  // 담당부서·서비스 정정 — 결손을 메우는 경로.
  updateOwnership: (id: string, patch: { owner?: string; service?: string | null }) =>
    request<Asset>(`/api/assets/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  importVulnScan: (content: string, format: "json" | "csv" | "html" | "nessus", source: string) =>
    request<{ hosts: number; findings: number; rows: number; assets: Asset[]; uncredentialedHosts: string[] }>("/api/vulnscan/import", {
      method: "POST",
      body: { content, format, source },
    }),
};

export interface ThreatCompliance {
  code: string;
  category: string;
  categoryLabel: string;
  name: string;
  aibomAreas: string[];
  owasp: string[];
  nist: string[];
  mitre: string[];
  status: "covered" | "partial" | "na" | "open";
  note: string;
  updatedAt: number | null;
  criteria: { impact: string; good: string; weak: string; diagnosis: string };
}

export interface DexModel {
  id: string; name: string; base: string; arch: string; size: string; focus: string; note?: string; lang: string;
}
export interface AgentModelRecommendation {
  agentId: string;
  id: string;
  name: string;
  size: string;
  approxGb: string;
  desc: string;
  tag?: string;
  reason: string;
}

export const modelDexApi = {
  list: () => request<{ models: DexModel[]; groups: { arch: string; models: DexModel[] }[] }>("/api/modeldex"),
  guide: () => request("/api/llmguide"),
  agentRecommendations: () => request<Record<string, AgentModelRecommendation>>("/api/modeldex/agent-recommendations"),
};

// ── 보안 LLM 합성(모델 병합) ──────────────────────────────────────────
export interface MergePlan {
  ok: boolean;
  reason?: string;
  modelA?: DexModel;
  modelB?: DexModel;
  outputModelId?: string;
  config?: string;
  configPath?: string;
  commands?: string[];
}
export interface MergePreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail?: string;
  hint?: string;
}
export const mergeApi = {
  plan: (modelA: string, modelB: string) => request<MergePlan>("/api/merge/plan", { method: "POST", body: { modelA, modelB } }),
  preflight: (a?: string, b?: string) =>
    request<{ checks: MergePreflightCheck[]; ready: boolean }>(
      `/api/merge/preflight${a && b ? `?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : ""}`
    ),
};

// ── 승인 워크플로우(스캔 finding 검토 → 승인/반려) ──────────────────────
export type ApprovalStatus = "pending" | "in_progress" | "verifying" | "approved" | "rejected";
export type RejectReason = "false_positive" | "compensating_control";

export interface FindingReview {
  assetId: string;
  assetName: string;
  findingKey: string;
  finding: { finding_type: string; severity: "low" | "medium" | "high" | "critical"; evidence: string; source_tool: string };
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  note?: string;
  assignee?: string; // 실수행담당자
  securityOwner?: string; // 보안담당자(감독)
  dueDate?: string;
  rejectReason?: RejectReason;
  verifyRequestedAt?: number;
  verifyRequestedBy?: string;
  resolvedAt?: number;
  overdue?: boolean;
  gone?: boolean; // 재스캔에서 사라짐
}

export interface ReviewPatch {
  status?: ApprovalStatus;
  note?: string;
  assignee?: string;
  securityOwner?: string;
  dueDate?: string;
  rejectReason?: RejectReason | "";
}

export interface ApprovalSummary {
  total: number; pending: number; in_progress: number; verifying: number; approved: number; rejected: number; overdue: number;
}

export const approvalsApi = {
  list: () =>
    request<{ reviews: FindingReview[]; summary: ApprovalSummary }>("/api/approvals"),
  // status·note·assignee·dueDate를 부분 갱신(merge). 판정 없이 담당자·기한만 배정도 가능.
  set: (assetId: string, key: string, patch: ReviewPatch) =>
    request(`/api/approvals/${encodeURIComponent(assetId)}/${encodeURIComponent(key)}`, { method: "POST", body: patch }),
  // 담당자에게 조치 배정 메일 발송 — 서버가 배정 정보·취약점 내용으로 본문 구성, 수신 주소만 전달.
  notify: (assetId: string, key: string, to: string) =>
    request<{ ok: boolean }>(`/api/approvals/${encodeURIComponent(assetId)}/${encodeURIComponent(key)}/notify`, { method: "POST", body: { to } }),
  // 오늘의 조치 — 전 자산 finding을 KEV·EPSS·VPR·심각도로 정렬한 우선순위 목록.
  priorities: (limit = 10) =>
    request<{ items: (FindingReview & { score: number })[] }>(`/api/approvals/priorities?limit=${limit}`),
  // AI 조치 브리핑 — 상위 취약점 [근거·권장조치·기한] 초안(로컬 LLM).
  triage: (limit = 5) => request<{ draft: string; count: number }>("/api/approvals/triage", { method: "POST", body: { limit } }),
};

export const complianceApi = {
  list: () => request<ThreatCompliance[]>("/api/compliance"),
  setStatus: (code: string, status: string, note: string) =>
    request<ThreatCompliance>(`/api/compliance/${code}`, { method: "PUT", body: { status, note } }),
  // AI 초안 — 위협별 대응 상태 제안(저장 아님). 담당자 검토용.
  draft: (code: string) => request<{ status: string; note: string }>(`/api/compliance/${code}/draft`, { method: "POST" }),
};
