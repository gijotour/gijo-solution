// GIJO AS 클라이언트 API — 모델·학습(로컬 엔진·파인튜닝·학습 루프·클라우드 하이브리드·합성)
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request } from "./core";
import type { DexModel } from "./assets";

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

// ── 로컬 엔진(llama.cpp 서버) ─────────────────────────────────────────
export interface GijoTierInfo {
  gpu: { totalMb: number; usedMb: number; freeMb: number; utilization: number } | null;
  current: { tier: "lite" | "standard" | "pro" | "max" | null; maxLoadedModels: number; ctxSize: number; overheadMb: number };
  recommended: "lite" | "standard" | "pro" | "max" | null;
  reason: string;
  tiers: { id: string; label: string; vramLabel: string; maxLoadedModels: number; ctxSize: number; desc: string; planned?: boolean }[];
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
  // 주제별 승인 진척(중-4) — 전문가 어댑터 조건(주제별 300건)의 시계다.
  topics: () =>
    request<{ 목표승인건수: number; 주제: { topic: string; total: number; approved: number; 준비됨: boolean; 남은건수: number }[] }>("/api/learnloop/topics"),
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
  // topic: 주제별 전문가 어댑터 학습(재설계 3단계) — 서버가 승인 300 개시선을 강제한다.
  run: (datasetId?: string, topic?: string) => request<LearnloopRun>("/api/learnloop/run", { method: "POST", body: { datasetId, topic } }),
  // 학습 후보함(환류 1단계, 2026-07-29) — 코드가 고른 후보를 승인/제외. 승인=👍 기록.
  candidates: (days?: number, limit?: number) =>
    request<{
      candidates: {
        id: string; source: "chatlog" | "worksession"; question: string; answer: string; createdAt: number;
        signals: { cite: boolean; tool: boolean; accepted: boolean; lengthOk: boolean }; score: number;
      }[];
      kpis: { candidates: number; strong: number; excludedByReason: Record<string, number> };
    }>(`/api/learnloop/candidates?days=${days ?? 30}&limit=${limit ?? 60}`),
  decideCandidate: (id: string, accept: boolean) =>
    request<{ ok: true }>("/api/learnloop/candidates/decide", { method: "POST", body: { id, accept } }),
  acceptStrongCandidates: (minScore?: number) =>
    request<{ accepted: number }>("/api/learnloop/candidates/accept-strong", { method: "POST", body: { minScore } }),
  status: () => request<{ running: boolean; run: LearnloopRun | null }>("/api/learnloop/status"),
  runs: () => request<LearnloopRun[]>("/api/learnloop/runs"),
  getConfig: () => request<LearnloopConfig>("/api/learnloop/config"),
  putConfig: (patch: Partial<LearnloopConfig>) => request<LearnloopConfig>("/api/learnloop/config", { method: "PUT", body: patch }),
};

// ── 전문가 어댑터 등록부 (재설계 1단계, 2026-08-08) ─────────────────────
// 보기 전용 — 채택·해제·배정 지시는 대화창에서(메뉴는 보기용 원칙).
export interface LoraAdapterInfo {
  id: string;
  topic: string | null;
  baseModelId: string;
  adopted: boolean;
  note: string | null;
  createdAt: number;
}
export const adaptersApi = {
  list: () => request<{ adapters: LoraAdapterInfo[] }>("/api/adapters"),
  // 등록부 삭제(admin) — 반입 도구가 "삭제로 되돌릴 수 있다"고 안내하므로 이 길이 실재해야 한다.
  remove: (id: string) => request<{ ok: boolean }>(`/api/adapters/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
/** 권장 모델 한 줄(2026-08-10). 서버 modelcatalog.ts가 단일 출처 — 여기 값을 다시 적지 않는다. */
export interface RecommendedModel {
  용도: string;
  repo: string;
  파일?: string;
  대략크기: string;
  권장장비: string;
  주의?: string;
  기준?: boolean;
  /** 저장소를 실제로 봤는가. 「확인못함」은 사내망에서 정상이다 — 없다는 뜻이 아니다. */
  저장소확인: "있음" | "없음" | "확인못함";
  이미받음: boolean;
}

export const hfModelsApi = {
  recommended: () => request<RecommendedModel[]>("/api/hfmodels/recommended"),
  search: (query: string) => request(`/api/hfmodels/search?q=${encodeURIComponent(query)}`),
  load: (modelId: string) => request<HfDownloadJob>("/api/hfmodels/load", { method: "POST", body: { modelId } }),
  jobs: () => request<HfDownloadJob[]>("/api/hfmodels/jobs"),
  job: (id: string) => request<HfDownloadJob>(`/api/hfmodels/jobs/${encodeURIComponent(id)}`),
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
