// GIJO AS 클라이언트 — preload 스크립트
// contextIsolation 환경에서 렌더러가 접근 가능한 안전한 API 표면을 정의한다.
// [CS 구조 변경] 기존에는 ipcRenderer.invoke()가 메인 프로세스의 로컬 엔진을 직접 호출했으나,
// 지금은 apiClient.ts를 통해 원격 GIJO AS 서버(REST)를 호출한다.
// 실시간 이벤트(collaboration:event, finetune:progress, asset:updated, log:event, hf-download:progress)는 WebSocket(wsClient.ts)으로 수신한다.

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
  listDir: (relPath: string) => ipcRenderer.invoke("fs:list", relPath) as Promise<{ root: string; rootName: string; path: string; items: { name: string; dir: boolean }[] }>,
  pickWorkFolder: () => ipcRenderer.invoke("fs:pickRoot") as Promise<{ cancelled: boolean; root?: string; rootName?: string }>,
  readFile: (relPath: string) => ipcRenderer.invoke("fs:readFile", relPath) as Promise<{ name: string; size: number; content: string }>,

  // 에이전트 AI / 지시(디스패처)
  listAgents: () => api.agentsApi.list(),
  setAgentModel: (agentId: string, modelId: string | null) => api.agentsApi.setModel(agentId, modelId),
  setAgentName: (agentId: string, name: string | null) => api.agentsApi.setName(agentId, name),
  getAgentRecommendations: () => api.modelDexApi.agentRecommendations(),
  listModels: () => api.localEngineApi.models(),
  sendInstruction: (text: string) => api.dispatchApi.send(text),
  onCollaborationEvent: (cb: (evt: unknown) => void) => onChannel("collaboration:event", cb),
  listCollaborationHistory: () => api.collaborationApi.history(),
  onLlmActivity: (cb: (evt: unknown) => void) => onChannel("llm:event", cb),
  listLlmActivity: () => api.llmActivityApi.history(),

  // 작업 큐
  listTasks: () => api.tasksApi.list(),
  addTask: (text: string, opts?: import("./apiClient").NewTaskOptions) => api.tasksApi.add(text, opts),
  completeTask: (id: string) => api.tasksApi.complete(id),
  toggleTask: (id: string, done: boolean) => api.tasksApi.toggle(id, done),
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
  getMaintenanceHistory: (id: string) => api.maintenanceApi.history(id),
  getMaintenanceNotify: () => api.maintenanceApi.getNotify(),
  sendMaintenanceNotify: (to: string[]) => api.maintenanceApi.notify(to),

  // 보안제품 등록부(종류별 관리 + 제품/로그 매뉴얼)
  listSecurityProducts: () => api.securityProductsApi.list(),
  listSecurityProductsGrouped: () => api.securityProductsApi.grouped(),
  getProductCategories: () => api.securityProductsApi.categories(),
  createSecurityProduct: (args: { name: string; category: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    api.securityProductsApi.create(args),
  updateSecurityProduct: (id: string, patch: { name?: string; category?: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    api.securityProductsApi.update(id, patch),
  deleteSecurityProduct: (id: string) => api.securityProductsApi.remove(id),
  addProductDoc: (id: string, args: { kind: string; title: string; note?: string; filename?: string; content?: string }) =>
    api.securityProductsApi.addDoc(id, args),
  deleteProductDoc: (docId: string) => api.securityProductsApi.removeDoc(docId),
  importProductManual: (filename: string, content?: string) => api.securityProductsApi.importDoc(filename, content),

  // 자산 인벤토리
  listAssets: () => api.assetsApi.list(),
  getAsset: (id: string) => api.assetsApi.get(id),
  deleteAsset: (id: string) => api.assetsApi.remove(id),
  registerAsset: (args: { id: string; name: string; path: string; assetType?: string; owner?: string; service?: string }) =>
    api.assetsApi.register(args),
  getServiceImpact: () => api.serviceImpactApi.get(),
  importAssets: (content: string, format: "json" | "csv", source: string) => api.assetsApi.import(content, format, source),
  scanRepos: (args: { provider: string; owner: string; token?: string; baseUrl?: string; maxRepos?: number }) => api.assetsApi.scanRepos(args),
  updateAiBom: (id: string, aibom: unknown) => api.assetsApi.updateAiBom(id, aibom as import("./apiClient").AiBom),
  importVulnScan: (content: string, format: "json" | "csv" | "html" | "nessus", source: string) => api.assetsApi.importVulnScan(content, format, source),
  listModelDex: () => api.modelDexApi.list(),
  planMerge: (modelA: string, modelB: string) => api.mergeApi.plan(modelA, modelB),
  mergePreflight: (a?: string, b?: string) => api.mergeApi.preflight(a, b),
  listLlmGuide: () => api.modelDexApi.guide(),
  listApprovals: () => api.approvalsApi.list(),
  setFindingApproval: (assetId: string, key: string, status: "approved" | "rejected" | "pending", note?: string) =>
    api.approvalsApi.set(assetId, key, status, note),
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
  ingestMemoryFile: (filename: string, content: string, scope?: string) => api.memoryApi.ingestFile(filename, content, scope),
  queryMemory: (question: string, topK?: number, agentId?: string) => api.memoryApi.query(question, topK, agentId),

  // 온톨로지(지식 그래프)
  listOntology: (filter?: { scope?: string; subject?: string }) => api.ontologyApi.list(filter),
  addOntologyTriple: (t: { subject: string; predicate: string; object: string; scope?: string; source?: string }) => api.ontologyApi.add(t),
  removeOntologyTriple: (id: string) => api.ontologyApi.remove(id),
  expandOntology: (text: string, agentId?: string) => api.ontologyApi.expand(text, agentId),
  ontologyStats: () => api.ontologyApi.stats(),
  seedOntology: () => api.ontologyApi.seed(),
  startFinetune: (agentId: string, datasetId: string) => api.finetuneApi.start(agentId, datasetId),
  onFinetuneProgress: (cb: (p: unknown) => void) => onChannel("finetune:progress", cb),
  convertDataset: (rawText: string) => api.datasetApi.convert(rawText),
  saveDataset: (id: string, examples: { question: string; answer: string }[]) => api.datasetApi.save(id, examples),
  listDatasets: () => api.datasetApi.list(),
  extractDocument: (filename: string, content: string) => api.datasetApi.extract(filename, content),

  // 헤르메스 폐쇄형 학습 루프(수집→정제→학습→배포)
  getLearnloopPreflight: () => api.learnloopApi.preflight(),
  listLearnloopLogs: (limit?: number, offset?: number) => api.learnloopApi.logs(limit, offset),
  rateLearnloopLog: (id: string, rating: 1 | -1 | 0) => api.learnloopApi.rate(id, rating),
  deleteLearnloopLog: (id: string) => api.learnloopApi.removeLog(id),
  buildLearnloopDataset: (includeUnrated?: boolean) => api.learnloopApi.buildDataset(includeUnrated),
  startLearnloopRun: (datasetId?: string) => api.learnloopApi.run(datasetId),
  getLearnloopStatus: () => api.learnloopApi.status(),
  listLearnloopRuns: () => api.learnloopApi.runs(),
  getLearnloopConfig: () => api.learnloopApi.getConfig(),
  putLearnloopConfig: (patch: Partial<api.LearnloopConfig>) => api.learnloopApi.putConfig(patch),
  onLearnloopProgress: (cb: (run: unknown) => void) => onChannel("learnloop:progress", cb),

  // HuggingFace 모델 검색 · 다운로드(백그라운드 큐 — load()는 잡을 반환하고 즉시 끝난다)
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
  disconnectCtiFeed: (feedId: string) => api.ctiApi.disconnectFeed(feedId),

  // 통합 보안 KPI 대시보드
  getSecurityKpi: () => api.kpiApi.get(),

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
