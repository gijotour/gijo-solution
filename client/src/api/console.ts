// GIJO AS 클라이언트 API — 대화창·오케스트레이션(에이전트·지시·작업세션·내 업무)
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request, requestStream } from "./core";

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

// AI팀 구성 한눈에(2026-08-09) — 기반 두뇌·팀원 전문성·공용 자산·☁ 외부 상담역을
// 서버가 한 번에 집계해 준다. 설정 「AI팀 구성」과 팀 사무실이 같은 그림을 본다.
export interface TeamComposition {
  base: { modelId: string | null; running: boolean };
  members: {
    id: string; name: string; defaultName: string; role: string; desc: string;
    status: "idle" | "working" | "watching";
    adapterId: string | null; overrideModelId: string | null; dedicatedDocs: number;
  }[];
  shared: { globalDocs: number; totalDocs: number; ontologyTriples: number; tools: number };
  adapters: { registered: number; adopted: number };
  cloud: { enabled: boolean; activeProvider: string | null };
}

export const agentsApi = {
  list: () => request<AgentInfo[]>("/api/agents"),
  composition: () => request<TeamComposition>("/api/team/composition"),
  setModel: (agentId: string, modelId: string | null) =>
    request<AgentInfo>(`/api/agents/${agentId}/model`, { method: "POST", body: { modelId } }),
  setName: (agentId: string, name: string | null) =>
    request<AgentInfo>(`/api/agents/${agentId}/name`, { method: "POST", body: { name } }),
  // 팀원별 두뇌 위치(2026-08-18) — null이면 전역 따름. "local" | "remote".
  // ⚠ 서버가 총괄을 막고 admin만 받는다(`agents.ts setAgentLocation` · 라우트 adminMiddleware).
  setLocation: (agentId: string, location: string | null) =>
    request<AgentInfo>(`/api/agents/${agentId}/location`, { method: "POST", body: { location } }),
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
  sources?: string[]; // 답을 만든 사내 문서 이름 — 대화창이 "📄 근거" 배지로 그린다
  // 근거 **원문 대목**. 이름만으로는 담당자가 답을 검증할 수 없다(2026-08-01 실측:
  // 문서엔 "미사용 룰 37개"인데 AI가 "27"이라고 답했고 근거 배지는 맞게 떴다).
  quotes?: { documentId: string; text: string }[];
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
  // 화면 열기 → 현황 카드(2026-08-20 사장님 지시) — 셸이 메뉴로 화면을 열 때 부른다.
  // 지시가 아니라 조회라 dispatch를 안 거친다(대화 기록에 가짜 발화를 안 남긴다).
  screenCard: (page: string, scope?: string) =>
    request<{ none?: boolean; output?: string; dataCard?: unknown; nextChips?: string[] }>(
      "/api/screen-card?page=" + encodeURIComponent(page) + (scope ? "&scope=" + encodeURIComponent(scope) : "")),
  // sessionId를 주면 지시·응답이 그 작업 세션의 턴으로 기록되고, 직전 대화가 맥락으로 실린다.
  // screen: 지시가 들어온 화면(예: "vulnscan.html"). 서버가 모호한 지시를 해석하는 힌트로 쓴다
  // — 취약점 화면에서 "정리해줘"는 우선순위 정리로 본다(server/engine/screencontext.ts).
  // 호출자가 안 주면 현재 문서 경로에서 자동으로 채운다.
  // progressId: 클라가 만든 UUID. 주면 서버가 처리 단계를 기록하고, progress()로 0.7초마다
  // 조회해 진행 카드를 그린다(2026-07-30 — "처리 중…" 침묵 구간 해소).
  // selection: 화면에서 골라 둔 항목(2026-08-09 2단계) — 「이거」의 대상. 서버가 맥락 앞머리에 싣는다.
  send: (text: string, sessionId?: string, screen?: string, progressId?: string, selection?: string) =>
    request<DispatchResult>("/api/dispatch", {
      method: "POST",
      body: {
        text,
        ...(sessionId ? { sessionId } : {}),
        ...(progressId ? { progressId } : {}),
        ...(selection ? { selection } : {}),
        screen: screen ?? currentScreen(),
      },
    }),
  // 답 스트리밍(전-7, 2026-08-09) — 같은 dispatch를 SSE로. 산문이 생성되는 대로 onDelta가
  // 불리고, 반환값은 출구 관문을 지난 **최종** 결과다 — 화면은 흐르던 글자를 이것으로 갈아 끼운다.
  sendStream: (
    text: string,
    sessionId: string | undefined,
    screen: string | undefined,
    progressId: string | undefined,
    selection: string | undefined,
    on: { start?: () => void; delta?: (text: string) => void }
  ) =>
    requestStream<DispatchResult>(
      "/api/dispatch/stream",
      {
        text,
        ...(sessionId ? { sessionId } : {}),
        ...(progressId ? { progressId } : {}),
        ...(selection ? { selection } : {}),
        screen: screen ?? currentScreen(),
      },
      on
    ),
  progress: (progressId: string) =>
    request<{
      running: boolean; stage?: "understand" | "tools" | "write" | "review"; detail?: string;
      count?: { done: number; total: number; unit: string };
      bigStep?: { index: number; total: number; label: string };
      startedAt?: number;
    }>(`/api/dispatch/progress?id=${encodeURIComponent(progressId)}`),
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
// 작업 내역 패턴 요약 — 쌓인 지시·답변에서 "무엇이 반복되고 무엇을 못 답했는가"를 뽑는다.
// 판정은 서버가 코드로 한다(LLM 아님) — 같은 입력에 같은 결과가 나와야 지난주와 비교할 수 있다.
export interface SessionPatternReport {
  기간일수: number;
  집계시각: number;
  총계: { 세션: number; 지시: number; 답변: number };
  반복지시: { 대표문장: string; 횟수: number; 마지막: number }[];
  주제분포: { 주제: string; 건수: number }[];
  지식공백: { 질문: string; 이유: string; when: number }[];
  잡담: { 건수: number; 비율: number };
  비고: string[];
}

/** 작업 내역 구분 축(승인 시안 2026-08-18). `undefined`는 「구분 이전 기록」 — 추측해 채우지 않는다. */
export interface WorkSessionAxes {
  items: WorkSessionSummary[];
  /** 필터에 걸려 안 보이는 건수 — 화면이 「N건 감춰짐」이라 적는 근거. 감췄으면 감췄다고 보인다. */
  hidden: { system: number; query: number; qa: number; total: number };
  counts: { user: number; system: number; unmarked: number; action: number; query: number; qa: number; all: number };
}

export const workSessionsApi = {
  list: () => request<WorkSessionSummary[]>("/api/work-sessions"),
  // ⚠ `axes=1`이 없으면 서버가 **옛 모양(배열)** 그대로 준다 — 이 라우트를 읽는 다른 곳
  //   (report.ts·에이전트 도구)을 깨지 않으려고 그렇게 뒀다.
  listWithAxes: (f: { origin?: string; opKind?: string; qa?: boolean } = {}) => {
    const q = new URLSearchParams({ axes: "1" });
    if (f.origin) q.set("origin", f.origin);
    if (f.opKind) q.set("opKind", f.opKind);
    if (f.qa) q.set("qa", "1");
    return request<WorkSessionAxes>(`/api/work-sessions?${q.toString()}`);
  },
  patterns: (days = 30) => request<SessionPatternReport>(`/api/session-patterns?days=${days}`),
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

// ── 내 업무 (2026-07-31) ─────────────────────────────────────────────────
// 담당자가 볼 것은 하나인데 출처는 셋(직접 적은 할 일·AI가 찾은 오늘 할 일·자주 하는 업무).
// 섞는 규칙은 서버에만 두고 화면은 받은 대로 그린다 — 화면마다 다르게 섞이면 그때부터
// "왜 여기만 다르지"가 시작된다.
export interface MyWorkItem {
  id: string;
  text: string;
  origin: "me" | "ai" | "routine";
  saved: boolean; // false면 아직 안 담긴 AI 제안
  done: boolean;
  priority: string;
  dueAt?: number;
  overdue: boolean;
  recur?: "weekly" | "monthly";
  why?: string;
  ref?: string;
  guideKey?: string;
  guideTotal: number;
  guideDoneCount: number;
  guideDoneList: number[];
}
export interface MyWorkPayload {
  today: MyWorkItem[];
  week: MyWorkItem[];
  later: MyWorkItem[];
  done: MyWorkItem[];
  routines: { text: string; cadence: "daily" | "weekly"; source: string }[];
  counts: { today: number; overdue: number; doneToday: number };
}
export interface WorkGuideStep {
  kind: "open" | "ask" | "note";
  title: string;
  desc?: string;
  page?: string;
  question?: string;
}
export interface WorkGuide { key: string; label: string; steps: WorkGuideStep[] }

export const myWorkApi = {
  list: () => request<MyWorkPayload>("/api/mywork"),
  // 자주 하는 업무 — RAG+LLM이라 몇 초 걸린다. 목록과 따로 부른다(목록을 기다리게 하지 않는다).
  routines: () => request<{ text: string; cadence: "daily" | "weekly"; source: string }[]>("/api/mywork/routines"),
  guide: (key: string) => request<WorkGuide>(`/api/mywork/guide/${encodeURIComponent(key)}`),
  adopt: (body: { text: string; ref?: string; origin?: string; dueAt?: number; recur?: string }) =>
    request<{ id: string }>("/api/mywork/adopt", { method: "POST", body }),
  step: (id: string, step: number, done: boolean) =>
    request<unknown>(`/api/mywork/${encodeURIComponent(id)}/step`, { method: "POST", body: { step, done } }),
};

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

// ── 의도 라우팅 ───────────────────────────────────────────────────────
export const intentApi = {
  route: (text: string) => request("/api/intent/route", { method: "POST", body: { text } }),
};

// ── 도구(Tools) ───────────────────────────────────────────────────────
export const toolsApi = {
  list: () => request("/api/tools"),
  run: (name: string, params: unknown) => request("/api/tools/run", { method: "POST", body: { name, params } }),
};

// ── 터미널 명령 제안(챗봇 → CLI, 제안만·실행은 클라이언트가 승인 후) ──────────
export const terminalApi = {
  suggest: (requestText: string) =>
    request<{ command: string; explanation: string }>("/api/terminal/suggest", { method: "POST", body: { request: requestText } }),
};
