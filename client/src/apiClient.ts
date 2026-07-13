// GIJO AS 클라이언트 — API Client
// 서버(gijo-as-server)와의 모든 통신은 이 모듈을 통해서만 이루어진다.
// preload.ts가 이 모듈을 사용해 window.gijo.* 표면을 구성한다.
//
// 인증: 로그인 성공 시 서버가 발급한 Bearer 토큰을 보관한다.
// [실기동 검증 중 발견된 버그] 이 페이지들은 SPA가 아니라 매번 mainWindow.loadFile()로
// 전체 페이지 네비게이션을 한다 — Electron은 네비게이션마다 preload 스크립트를 처음부터
// 다시 실행하므로, 모듈 내부 변수(let authToken)에만 저장하면 로그인 직후 다음 페이지로
// 이동하는 순간 토큰이 사라져 즉시 로그인 화면으로 튕기는 무한 루프가 발생했다.
// 그래서 메인 프로세스(페이지 이동에도 살아있는 유일한 곳)에 상태를 동기 IPC로 위임한다.
import { ipcRenderer } from "electron";

const DEFAULT_SERVER_URL = process.env.GIJO_SERVER_URL ?? "http://localhost:4000";

const persisted = ipcRenderer.sendSync("auth:getState") as { token: string | null; serverUrl: string | null };

let serverUrl = persisted.serverUrl ?? DEFAULT_SERVER_URL;
let authToken: string | null = persisted.token;

function persist(): void {
  ipcRenderer.send("auth:setState", { token: authToken, serverUrl });
}

export function setServerUrl(url: string): void {
  serverUrl = url.replace(/\/+$/, "");
  persist();
}

export function getServerUrl(): string {
  return serverUrl;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  persist();
}

export function isAuthenticated(): boolean {
  return authToken !== null;
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${serverUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

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
export const authApi = {
  login: async (username: string, password: string) => {
    const result = await request<{ token: string; user: unknown }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setAuthToken(result.token);
    return result;
  },
  logout: async () => {
    await request("/api/auth/logout", { method: "POST" });
    setAuthToken(null);
  },
  me: () => request("/api/auth/me"),
};

// ── 에이전트 AI ───────────────────────────────────────────────────────
export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  brainModelId: string;
  status: "idle" | "working" | "watching";
  defaultStatus: "idle" | "working" | "watching";
}

export const agentsApi = {
  list: () => request<AgentInfo[]>("/api/agents"),
};

// ── 지시(디스패처) ────────────────────────────────────────────────────
export interface DispatchResult {
  task: { id: string; priority: string; text: string; agentId?: string; done: boolean; createdAt: number };
  route: { agentId: string; action: "scan" | "analyze" | "report" | "chat"; targetAssetId?: string };
  output: string;
}

export const dispatchApi = {
  send: (text: string) => request<DispatchResult>("/api/dispatch", { method: "POST", body: { text } }),
};

// ── 작업 큐 ───────────────────────────────────────────────────────────
export const tasksApi = {
  list: () => request("/api/tasks"),
  add: (text: string) => request("/api/tasks", { method: "POST", body: { text } }),
  complete: (id: string) => request(`/api/tasks/${id}/complete`, { method: "POST" }),
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

// ── 메모리(RAG) ───────────────────────────────────────────────────────
export const memoryApi = {
  ingest: (path: string) => request("/api/memory/ingest", { method: "POST", body: { path } }),
  query: (question: string, topK?: number) =>
    request<string[]>("/api/memory/query", { method: "POST", body: { question, topK } }),
};

// ── LLM 브리지 / 채팅 ─────────────────────────────────────────────────
export const bridgeApi = {
  run: (payload: unknown) => request("/api/bridge/run", { method: "POST", body: payload }),
  adapters: () => request("/api/bridge/adapters"),
};

export const llmApi = {
  chat: (agentId: string, message: string) =>
    request("/api/llm/chat", { method: "POST", body: { agentId, message } }),
};

// ── 로컬 엔진(llama.cpp 서버) ─────────────────────────────────────────
export const localEngineApi = {
  status: () => request("/api/localengine/status"),
  start: (modelId: string) => request("/api/localengine/start", { method: "POST", body: { modelId } }),
  stop: () => request("/api/localengine/stop", { method: "POST" }),
};

// ── 파인튜닝(장기 기억) ───────────────────────────────────────────────
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
};

// ── HuggingFace 모델 ──────────────────────────────────────────────────
export const hfModelsApi = {
  search: (query: string) => request(`/api/hfmodels/search?q=${encodeURIComponent(query)}`),
  load: (modelId: string) => request("/api/hfmodels/load", { method: "POST", body: { modelId } }),
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
export const emailApi = {
  sendReport: (to: string[], subject: string, attachmentPath: string) =>
    request("/api/email/sendReport", { method: "POST", body: { to, subject, attachmentPath } }),
};

// ── SBOM ─────────────────────────────────────────────────────────────
export const sbomApi = {
  generate: (assetId: string) => request(`/api/sbom/${assetId}/generate`, { method: "POST" }),
  export: (assetId: string, format: "cyclonedx" | "spdx") =>
    request(`/api/sbom/${assetId}/export`, { method: "POST", body: { format } }),
};

// ── CTI(위협 인텔리전스) ──────────────────────────────────────────────
export const ctiApi = {
  feeds: () => request("/api/cti/feeds"),
  findings: () => request("/api/cti/findings"),
  configureFeed: (feedId: string, apiKey: string) =>
    request(`/api/cti/feeds/${feedId}/configure`, { method: "POST", body: { apiKey } }),
  disconnectFeed: (feedId: string) => request(`/api/cti/feeds/${feedId}/disconnect`, { method: "POST" }),
};

// ── 내부 리포트 ───────────────────────────────────────────────────────
export const reportApi = {
  generate: (type: "weekly" | "quarterly" | "ondemand", assetIds?: string[]) =>
    request("/api/report/generate", { method: "POST", body: { type, assetIds } }),
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

export interface Asset {
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  components: AssetComponent[];
  findings: Finding[];
  registeredAt: number;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

export const assetsApi = {
  list: () => request<Asset[]>("/api/assets"),
  get: (id: string) => request<Asset>(`/api/assets/${id}`),
  register: (args: { id: string; name: string; path: string; assetType?: string; owner?: string; components?: AssetComponent[] }) =>
    request<Asset>("/api/assets", { method: "POST", body: args }),
};
