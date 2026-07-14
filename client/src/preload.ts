// GIJO AS 클라이언트 — preload 스크립트
// contextIsolation 환경에서 렌더러가 접근 가능한 안전한 API 표면을 정의한다.
// [CS 구조 변경] 기존에는 ipcRenderer.invoke()가 메인 프로세스의 로컬 엔진을 직접 호출했으나,
// 지금은 apiClient.ts를 통해 원격 GIJO AS 서버(REST)를 호출한다.
// 실시간 이벤트(collaboration:event, finetune:progress, asset:updated, log:event)는 WebSocket(wsClient.ts)으로 수신한다.

import { contextBridge, ipcRenderer } from "electron";
import * as api from "./apiClient";
import { connectWebSocket, onChannel } from "./wsClient";

const gijoApi = {
  // 서버 연결 설정
  setServerUrl: (url: string) => api.setServerUrl(url),
  getServerUrl: () => api.getServerUrl(),
  checkServerHealth: () => api.healthApi.check(),

  // 인증(보안담당자별 로그인)
  login: (username: string, password: string) => api.authApi.login(username, password),
  logout: () => api.authApi.logout(),
  me: () => api.authApi.me(),
  isAuthenticated: () => api.isAuthenticated(),

  // 네비게이션(렌더러 내 페이지 전환은 메인 프로세스에 위임)
  navigateTo: (page: string) => ipcRenderer.invoke("navigate:to", page),

  // 에이전트 AI / 지시(디스패처)
  listAgents: () => api.agentsApi.list(),
  sendInstruction: (text: string) => api.dispatchApi.send(text),
  onCollaborationEvent: (cb: (evt: unknown) => void) => onChannel("collaboration:event", cb),
  listCollaborationHistory: () => api.collaborationApi.history(),

  // 작업 큐
  listTasks: () => api.tasksApi.list(),
  addTask: (text: string) => api.tasksApi.add(text),
  completeTask: (id: string) => api.tasksApi.complete(id),

  // 자산 인벤토리
  listAssets: () => api.assetsApi.list(),
  getAsset: (id: string) => api.assetsApi.get(id),
  registerAsset: (args: { id: string; name: string; path: string; assetType?: string; owner?: string }) =>
    api.assetsApi.register(args),
  onAssetUpdated: (cb: (asset: unknown) => void) => onChannel("asset:updated", cb),

  // SBOM
  generateSbom: (assetId: string) => api.sbomApi.generate(assetId),
  exportSbom: (assetId: string, format: "cyclonedx" | "spdx") => api.sbomApi.export(assetId, format),

  // 로컬 LLM(서버가 보유한 GPU 머신의 llama.cpp 프로세스를 원격 제어)
  getLocalEngineStatus: () => api.localEngineApi.status(),
  startLocalEngine: (modelId: string) => api.localEngineApi.start(modelId),
  stopLocalEngine: () => api.localEngineApi.stop(),
  chat: (agentId: string, message: string) => api.llmApi.chat(agentId, message),

  // 메모리(RAG) / 파인튜닝(장기 기억)
  ingestDocument: (path: string) => api.memoryApi.ingest(path),
  queryMemory: (question: string, topK?: number) => api.memoryApi.query(question, topK),
  startFinetune: (agentId: string, datasetId: string) => api.finetuneApi.start(agentId, datasetId),
  onFinetuneProgress: (cb: (p: unknown) => void) => onChannel("finetune:progress", cb),

  // HuggingFace 모델 검색
  searchHfModels: (query: string) => api.hfModelsApi.search(query),
  loadHfModel: (modelId: string) => api.hfModelsApi.load(modelId),

  // CTI(딥웹/다크웹 피드)
  listCtiFeeds: () => api.ctiApi.feeds(),
  listCtiFindings: () => api.ctiApi.findings(),
  configureCtiFeed: (feedId: string, apiKey: string) => api.ctiApi.configureFeed(feedId, apiKey),
  disconnectCtiFeed: (feedId: string) => api.ctiApi.disconnectFeed(feedId),

  // 내부 리포트
  generateReport: (opts: { type: "weekly" | "quarterly" | "ondemand"; assetIds?: string[] }) =>
    api.reportApi.generate(opts.type, opts.assetIds),

  // 사용량 · 요금
  getUsageSummary: (sinceMs?: number) => api.usageApi.summary(sinceMs),

  // 서버 로그
  listLogs: () => api.logsApi.list(),
  onLogEvent: (cb: (entry: unknown) => void) => onChannel("log:event", cb),
};

contextBridge.exposeInMainWorld("gijo", gijoApi);

// 로그인 성공 이후 렌더러가 이 시점에 WebSocket을 연다(인증 전 연결 방지).
contextBridge.exposeInMainWorld("gijoRealtime", {
  connect: () => connectWebSocket(),
});

export type GijoApi = typeof gijoApi;
