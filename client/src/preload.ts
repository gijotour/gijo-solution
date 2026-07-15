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

  // 계정 관리(admin 전용 목록/생성/삭제 — 본인 비밀번호 변경은 누구나)
  listUsers: () => api.usersApi.list(),
  createUser: (args: { username: string; password: string; displayName: string; role: "security_officer" | "admin" }) =>
    api.usersApi.create(args),
  deleteUser: (id: string) => api.usersApi.remove(id),
  changeUserPassword: (id: string, password: string) => api.usersApi.changePassword(id, password),

  // 네비게이션(렌더러 내 페이지 전환은 메인 프로세스에 위임)
  navigateTo: (page: string) => ipcRenderer.invoke("navigate:to", page),
  listDir: (relPath: string) => ipcRenderer.invoke("fs:list", relPath) as Promise<{ root: string; path: string; items: { name: string; dir: boolean }[] }>,

  // 에이전트 AI / 지시(디스패처)
  listAgents: () => api.agentsApi.list(),
  setAgentModel: (agentId: string, modelId: string | null) => api.agentsApi.setModel(agentId, modelId),
  setAgentName: (agentId: string, name: string | null) => api.agentsApi.setName(agentId, name),
  listModels: () => api.localEngineApi.models(),
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
  importAssets: (content: string, format: "json" | "csv", source: string) => api.assetsApi.import(content, format, source),
  scanRepos: (args: { provider: string; owner: string; token?: string; baseUrl?: string; maxRepos?: number }) => api.assetsApi.scanRepos(args),
  updateAiBom: (id: string, aibom: unknown) => api.assetsApi.updateAiBom(id, aibom as import("./apiClient").AiBom),
  importVulnScan: (content: string, format: "json" | "csv", source: string) => api.assetsApi.importVulnScan(content, format, source),
  listModelDex: () => api.modelDexApi.list(),
  listCompliance: () => api.complianceApi.list(),
  setComplianceStatus: (code: string, status: string, note: string) => api.complianceApi.setStatus(code, status, note),
  onAssetUpdated: (cb: (asset: unknown) => void) => onChannel("asset:updated", cb),

  // SBOM
  generateSbom: (assetId: string) => api.sbomApi.generate(assetId),
  exportSbom: (assetId: string, format: "cyclonedx" | "spdx") => api.sbomApi.export(assetId, format),

  // 로컬 LLM(서버가 보유한 GPU 머신의 llama.cpp 프로세스를 원격 제어)
  getLocalEngineStatus: () => api.localEngineApi.status(),
  startLocalEngine: (modelId: string) => api.localEngineApi.start(modelId),
  stopLocalEngine: () => api.localEngineApi.stop(),
  chat: (agentId: string, message: string) => api.llmApi.chat(agentId, message),

  // 장기 기억(RAG) / 파인튜닝(학습)
  ingestDocument: (path: string, scope?: string) => api.memoryApi.ingest(path, scope),
  queryMemory: (question: string, topK?: number, agentId?: string) => api.memoryApi.query(question, topK, agentId),
  startFinetune: (agentId: string, datasetId: string) => api.finetuneApi.start(agentId, datasetId),
  onFinetuneProgress: (cb: (p: unknown) => void) => onChannel("finetune:progress", cb),
  convertDataset: (rawText: string) => api.datasetApi.convert(rawText),
  saveDataset: (id: string, examples: { question: string; answer: string }[]) => api.datasetApi.save(id, examples),
  listDatasets: () => api.datasetApi.list(),

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

  // 이메일(SMTP) 설정
  getSmtpConfig: () => api.emailApi.getConfig(),
  saveSmtpConfig: (config: api.SmtpConfigInput) => api.emailApi.saveConfig(config),
  sendReportEmail: (to: string[], subject: string, attachmentPath: string) =>
    api.emailApi.sendReport(to, subject, attachmentPath),

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
