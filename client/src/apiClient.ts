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
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  skipAuthRetry?: boolean;
}

// access token이 만료돼 401이 오면, refresh token으로 한 번만 조용히 재발급받고 원 요청을 재시도한다.
// refresh도 실패하면(만료/폐기) 토큰을 지워서 다음 API 호출들이 즉시 401로 실패 -> 각 페이지의
// isAuthenticated() 가드가 로그인 화면으로 돌려보낸다.
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch(`${serverUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => null);
  if (!res || !res.ok) {
    setAuthTokens(null);
    return false;
  }
  const result = (await res.json()) as { accessToken: string; refreshToken: string };
  setAuthTokens(result);
  return true;
}

async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${serverUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.skipAuthRetry && (await tryRefresh())) {
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
export const authApi = {
  login: async (username: string, password: string) => {
    const result = await request<{ accessToken: string; refreshToken: string; user: unknown }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setAuthTokens(result);
    return result;
  },
  logout: async () => {
    await request("/api/auth/logout", { method: "POST", body: { refreshToken } });
    setAuthTokens(null);
  },
  me: () => request("/api/auth/me"),
};

// ── 에이전트 AI ───────────────────────────────────────────────────────
export interface AgentInfo {
  id: string;
  name: string;
  defaultName: string;
  role: string;
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
}

export const dispatchApi = {
  send: (text: string) => request<DispatchResult>("/api/dispatch", { method: "POST", body: { text } }),
  plan: (text: string) =>
    request<{ steps: OrchestrationStepResult[]; multi: boolean }>("/api/dispatch/plan", { method: "POST", body: { text } }),
};

// ── 작업 큐 ───────────────────────────────────────────────────────────
export interface NewTaskOptions {
  priority?: "P0" | "P1" | "P2" | "P3";
  dueAt?: number;
  assignee?: string;
  ref?: string;
}
export const tasksApi = {
  list: () => request("/api/tasks"),
  add: (text: string, opts?: NewTaskOptions) => request("/api/tasks", { method: "POST", body: { text, ...(opts || {}) } }),
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
  create: (args: { title: string; productName: string; scheduleDate: string; intervalDays?: number; assetId?: string }) =>
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

// ── 장기 기억(RAG) ────────────────────────────────────────────────────
export const memoryApi = {
  ingest: (path: string, scope?: string) => request("/api/memory/ingest", { method: "POST", body: { path, scope } }),
  ingestFile: (filename: string, content: string, scope?: string) =>
    request("/api/memory/ingest-file", { method: "POST", body: { filename, content, scope } }),
  query: (question: string, topK?: number, agentId?: string) =>
    request<string[]>("/api/memory/query", { method: "POST", body: { question, topK, agentId } }),
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
  models: () => request<{ id: string; running: boolean }[]>("/api/localengine/models"),
  start: (modelId: string) => request("/api/localengine/start", { method: "POST", body: { modelId } }),
  stop: () => request("/api/localengine/stop", { method: "POST" }),
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

// ── SBOM ─────────────────────────────────────────────────────────────
export const sbomApi = {
  generate: (assetId: string) => request(`/api/sbom/${assetId}/generate`, { method: "POST" }),
  export: (assetId: string, format: "cyclonedx" | "spdx") =>
    request(`/api/sbom/${assetId}/export`, { method: "POST", body: { format } }),
};

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
}

export const kpiApi = {
  get: () => request<{ current: KpiSnapshot; trend: KpiSnapshot[] }>("/api/kpi"),
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
  create: (args: { username: string; password: string; displayName: string; role: "security_officer" | "admin" }) =>
    request<GijoUserPublic>("/api/users", { method: "POST", body: args }),
  remove: (id: string) => request(`/api/users/${id}`, { method: "DELETE" }),
  changePassword: (id: string, password: string) =>
    request(`/api/users/${id}/password`, { method: "POST", body: { password } }),
};

// ── 서버 로그 ─────────────────────────────────────────────────────────
export interface LogEntry {
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
}

export const logsApi = {
  list: () => request<LogEntry[]>("/api/logs"),
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

export interface AiBom {
  model: { foundationModel: string; finetuneHistory: string; architecture: string; weightsHash: string };
  dataset: { sources: string; vectorDbLocation: string };
  prompt: { systemPrompt: string; guardrails: string };
  agentTool: { apis: string; mcpServers: string };
  infrastructure: { compute: string; hostingProvider: string };
}

export interface Asset {
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  service: string | null;
  components: AssetComponent[];
  findings: Finding[];
  aibom: AiBom;
  registeredAt: number;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
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

export const assetsApi = {
  list: () => request<Asset[]>("/api/assets"),
  get: (id: string) => request<Asset>(`/api/assets/${id}`),
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
  remove: (id: string) => request<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importVulnScan: (content: string, format: "json" | "csv" | "html" | "nessus", source: string) =>
    request<{ hosts: number; findings: number; assets: Asset[] }>("/api/vulnscan/import", {
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
export interface FindingReview {
  assetId: string;
  assetName: string;
  findingKey: string;
  finding: { finding_type: string; severity: "low" | "medium" | "high" | "critical"; evidence: string; source_tool: string };
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: number;
  note?: string;
}

export const approvalsApi = {
  list: () =>
    request<{ reviews: FindingReview[]; summary: { total: number; pending: number; approved: number; rejected: number } }>("/api/approvals"),
  set: (assetId: string, key: string, status: "approved" | "rejected" | "pending", note?: string) =>
    request(`/api/approvals/${encodeURIComponent(assetId)}/${encodeURIComponent(key)}`, { method: "POST", body: { status, note } }),
};

export const complianceApi = {
  list: () => request<ThreatCompliance[]>("/api/compliance"),
  setStatus: (code: string, status: string, note: string) =>
    request<ThreatCompliance>(`/api/compliance/${code}`, { method: "PUT", body: { status, note } }),
};
