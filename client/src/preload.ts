// GIJO AS 클라이언트 — preload 스크립트
// contextIsolation 환경에서 렌더러가 접근 가능한 안전한 API 표면을 정의한다.
// [CS 구조 변경] 기존에는 ipcRenderer.invoke()가 메인 프로세스의 로컬 엔진을 직접 호출했으나,
// 지금은 apiClient.ts를 통해 원격 GIJO AS 서버(REST)를 호출한다.
// 실시간 이벤트(collaboration:event, finetune:progress, asset:updated, log:event, hf-download:progress)는 WebSocket(wsClient.ts)으로 수신한다.

import { contextBridge, ipcRenderer } from "electron";
import * as api from "./apiClient";
import { connectWebSocket, onChannel } from "./wsClient";
import { classifyChatbotCommand } from "./terminalPolicy";

const gijoApi = {
  // 서버 연결 설정
  setServerUrl: (url: string) => api.setServerUrl(url),
  getServerUrl: () => api.getServerUrl(),
  checkServerHealth: () => api.healthApi.check(),

  // 인증(보안담당자별 로그인) — force: 이미 다른 곳에서 로그인 중이어도 강제로 이 세션을 새 세션으로 대체
  login: (username: string, password: string, force?: boolean) => api.authApi.login(username, password, force),
  logout: () => api.authApi.logout(),
  me: () => api.authApi.me(),
  isAuthenticated: () => api.isAuthenticated(),
  listActiveSessions: () => api.authApi.sessions(), // 접속 중 클라이언트(외부 콘솔) — 팀 사무실 presence

  // 계정 관리(admin 전용 목록/생성/삭제 — 본인 비밀번호 변경은 누구나)
  listUsers: () => api.usersApi.list(),
  listAssignableUsers: () => api.usersApi.assignable(), // 담당자 배정용 — admin 아니어도 조회 가능
  createUser: (args: { username: string; password: string; displayName: string; role: "security_officer" | "admin" }) =>
    api.usersApi.create(args),
  deleteUser: (id: string) => api.usersApi.remove(id),
  changeUserPassword: (id: string, password: string) => api.usersApi.changePassword(id, password),
  setUserRole: (id: string, role: "security_officer" | "admin") => api.usersApi.setRole(id, role),
  listSessions: () => api.usersApi.sessions(),
  terminateUserSession: (id: string) => api.usersApi.terminateSession(id),

  // 네비게이션(렌더러 내 페이지 전환은 메인 프로세스에 위임)
  navigateTo: (page: string) => ipcRenderer.invoke("navigate:to", page),
  // "우리 AI 팀 사무실" 별도 창(시안 B) — 열기 + 항상 위 고정 토글
  openTeamOffice: () => ipcRenderer.invoke("office:open"),
  setOfficeAlwaysOnTop: (on: boolean) => ipcRenderer.invoke("office:setAlwaysOnTop", on),
  listDir: (relPath: string) => ipcRenderer.invoke("fs:list", relPath) as Promise<{ root: string; rootName: string; path: string; items: { name: string; dir: boolean }[] }>,
  pickWorkFolder: () => ipcRenderer.invoke("fs:pickRoot") as Promise<{ cancelled: boolean; root?: string; rootName?: string }>,
  readFile: (relPath: string) => ipcRenderer.invoke("fs:readFile", relPath) as Promise<{ name: string; size: number; content: string }>,

  // 에이전트 AI / 지시(디스패처)
  listAgents: () => api.agentsApi.list(),
  setAgentModel: (agentId: string, modelId: string | null) => api.agentsApi.setModel(agentId, modelId),
  setAgentName: (agentId: string, name: string | null) => api.agentsApi.setName(agentId, name),
  getAgentRecommendations: () => api.modelDexApi.agentRecommendations(),
  listModels: () => api.localEngineApi.models(),
  sendInstruction: (text: string, sessionId?: string) => api.dispatchApi.send(text, sessionId),
  // 결재판 승인 실행 — 쓰기 도구는 이 경로로만 실행된다(지시만으로는 실행 안 됨).
  approveAgentTool: (tool: string, args: Record<string, string>, instruction = "") => api.dispatchApi.approve(tool, args, instruction),
  undoAgentTool: (id?: string) => api.dispatchApi.undo(id),

  // 작업 세션(대화 세션형) — 오케스트레이터 지시·응답을 세션 대화로 묶어 관리.
  listWorkSessions: () => api.workSessionsApi.list(),
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
  listLlmActivity: () => api.llmActivityApi.history(),

  // 작업 큐
  listTasks: () => api.tasksApi.list(),
  getToday: (withBrief?: boolean) => api.todayApi.get(withBrief),
  addTask: (text: string, opts?: import("./apiClient").NewTaskOptions) => api.tasksApi.add(text, opts),
  getRoutineSuggestions: () => api.tasksApi.routineSuggestions(),
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
  getProductFields: (id: string) => api.securityProductsApi.getFields(id),
  saveProductFields: (id: string, fields: { key: string; value: string }[]) => api.securityProductsApi.saveFields(id, fields),
  draftProductFields: (id: string, filename: string, content: string) => api.securityProductsApi.draftFields(id, filename, content),

  // 자산 인벤토리
  listAssets: () => api.assetsApi.list(),
  getAsset: (id: string) => api.assetsApi.get(id),
  // 자산 허브(자산 목록·AI-BOM·취약점 통합 뷰)
  assetHub: () => api.assetHubApi.overview(),
  assetHubDetail: (id: string) => api.assetHubApi.detail(id),
  shadowAi: () => api.assetHubApi.shadowAi(),
  scanAsset: (id: string) => api.assetsApi.scan(id),
  uploadAuto: (filename: string, content: string, forceType?: import("./apiClient").UploadType, productName?: string) =>
    api.uploadApi.auto(filename, content, forceType, productName),
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
  computeWeightsHash: (id: string, filePath?: string) => api.assetsApi.weightsHash(id, filePath),
  importVulnScan: (content: string, format: "json" | "csv" | "html" | "nessus", source: string) => api.assetsApi.importVulnScan(content, format, source),
  listModelDex: () => api.modelDexApi.list(),
  planMerge: (modelA: string, modelB: string) => api.mergeApi.plan(modelA, modelB),
  mergePreflight: (a?: string, b?: string) => api.mergeApi.preflight(a, b),
  listLlmGuide: () => api.modelDexApi.guide(),
  listApprovals: () => api.approvalsApi.list(),
  // status·note·assignee·dueDate를 부분 갱신. status만 주면 기존 승인/반려 동작과 동일.
  setFindingReview: (assetId: string, key: string, patch: api.ReviewPatch) => api.approvalsApi.set(assetId, key, patch),
  notifyAssignee: (assetId: string, key: string, to: string) => api.approvalsApi.notify(assetId, key, to),
  listActionPriorities: (limit?: number) => api.approvalsApi.priorities(limit),
  aiTriage: (limit?: number) => api.approvalsApi.triage(limit),
  listCompliance: () => api.complianceApi.list(),
  setComplianceStatus: (code: string, status: string, note: string) => api.complianceApi.setStatus(code, status, note),
  complianceDraft: (code: string) => api.complianceApi.draft(code),
  onAssetUpdated: (cb: (asset: unknown) => void) => onChannel("asset:updated", cb),

  // SBOM
  generateSbom: (assetId: string) => api.sbomApi.generate(assetId),
  exportSbom: (assetId: string, format: "cyclonedx" | "spdx") => api.sbomApi.export(assetId, format),
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
  ingestMemoryFile: (filename: string, content: string, scope?: string) => api.memoryApi.ingestFile(filename, content, scope),
  queryMemory: (question: string, topK?: number, agentId?: string) => api.memoryApi.query(question, topK, agentId),
  listMemoryDocuments: () => api.memoryApi.listDocuments(),
  memoryDocumentChunks: (documentId: string, limit?: number) => api.memoryApi.documentChunks(documentId, limit),
  deleteMemoryDocument: (documentId: string, withFile?: boolean) => api.memoryApi.deleteDocument(documentId, withFile),
  kbHygiene: () => api.memoryApi.hygiene(),
  kbHygieneScan: () => api.memoryApi.hygieneScan(),
  // 서버 보관 원본을 임시 파일로 받아 OS 기본 뷰어(PDF 등)로 연다.
  openMemoryDocumentFile: async (documentId: string) => {
    const f = await api.memoryApi.documentFile(documentId);
    return ipcRenderer.invoke("doc:open-temp", f.filename, f.content) as Promise<{ path: string }>;
  },

  // 선택적 클라우드 LLM 하이브리드(Gemini/Claude/OpenAI) — 기본 OFF·admin 설정, egress 게이트 통과분만.
  cloudStatus: () => api.cloudApi.status(),
  getCloudConfig: () => api.cloudApi.getConfig(),
  saveCloudConfig: (patch: { enabled?: boolean; activeProvider?: import("./apiClient").CloudProvider; provider?: import("./apiClient").CloudProvider; apiKey?: string; model?: string; clearKey?: boolean }) =>
    api.cloudApi.saveConfig(patch),
  askCloud: (question: string) => api.cloudApi.ask(question),
  screenCloud: (question: string) => api.cloudApi.screen(question),
  cloudEgressLog: (limit?: number) => api.cloudApi.egressLog(limit),
  saveCloudAnswerToKb: (question: string, answer: string, providerLabel: string, model: string) =>
    api.cloudApi.saveToKb(question, answer, providerLabel, model),
  cloudUsage: () => api.cloudApi.usage(),
  enrichIngest: (a: import("./apiClient").EnrichIngestArgs) => api.docsApi.enrichIngest(a),

  // 온톨로지(지식 그래프)
  listOntology: (filter?: { scope?: string; subject?: string }) => api.ontologyApi.list(filter),
  addOntologyTriple: (t: { subject: string; predicate: string; object: string; scope?: string; source?: string }) => api.ontologyApi.add(t),
  removeOntologyTriple: (id: string) => api.ontologyApi.remove(id),
  expandOntology: (text: string, agentId?: string) => api.ontologyApi.expand(text, agentId),
  ontologyStats: () => api.ontologyApi.stats(),
  seedOntology: () => api.ontologyApi.seed(),

  // 통합 보안 분석(관제) 허브
  analysisEvents: () => api.analysisHubApi.events(),
  analysisAttackPaths: () => api.analysisHubApi.attackPaths(),
  analysisRebuildVuln: () => api.analysisHubApi.rebuildVuln(),
  analysisIngest: (filename: string, content: string) => api.analysisHubApi.ingest(filename, content),
  analysisAnalyze: (eventId: string) => api.analysisHubApi.analyze(eventId),
  analysisSetStatus: (eventId: string, status: import("./apiClient").EventStatus, note?: string) => api.analysisHubApi.setStatus(eventId, status, note),

  // AI 견고성: 레드팀 + 가드레일
  runRedTeam: (opts?: { modelId?: string; assetId?: string }) => api.redteamApi.run(opts),
  lastRedTeam: (target?: string) => api.redteamApi.last(target),
  redteamTargets: () => api.redteamApi.targets(),
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
  addCustomCtiFeed: (name: string, apiKey: string) => api.ctiApi.addCustomFeed(name, apiKey),
  disconnectCtiFeed: (feedId: string) => api.ctiApi.disconnectFeed(feedId),

  // 통합 보안 KPI 대시보드
  getSecurityKpi: () => api.kpiApi.get(),

  // 내부 리포트
  generateReport: (opts: { type: "weekly" | "quarterly" | "ondemand"; assetIds?: string[]; audience?: "internal" | "official"; format?: "docx" | "pdf" | "both" }) =>
    api.reportApi.generate(opts.type, opts.assetIds, { audience: opts.audience, format: opts.format }),
  downloadReportFile: (name: string) => api.reportApi.file(name),
  listReportHistory: () => api.reportApi.history(),
  deleteReport: (base: string) => api.reportApi.remove(base),
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
  getSiemConfig: () => api.siemApi.getConfig(),
  saveSiemConfig: (config: Partial<import("./apiClient").SiemConfig>) => api.siemApi.saveConfig(config),
  testSiem: () => api.siemApi.test(),
  sendReportEmail: (to: string[], subject: string, attachmentPath: string) =>
    api.emailApi.sendReport(to, subject, attachmentPath),

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
    install: (version: string) => ipcRenderer.invoke("update:install", version) as Promise<{ ok: boolean }>,
    onProgress: (cb: (pct: number) => void) => ipcRenderer.on("update:progress", (_e, pct: number) => cb(pct)),
    listReleases: () => api.clientReleaseApi.listAll(),
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
    let lastActivity = Date.now();
    const note = () => { lastActivity = Date.now(); };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, note, { passive: true, capture: true }));
    // iframe에서 전달된 활동 신호
    window.addEventListener("message", (m) => {
      if (m && m.data && (m.data as { __gijoActivity?: boolean }).__gijoActivity) note();
    });
    setInterval(() => {
      if (!api.isAuthenticated()) return;                        // 로그아웃 상태면 핑 안 함
      if (Date.now() - lastActivity > ACTIVE_WINDOW_MS) return;  // 자리 비움 → 유휴 만료되게 둠
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
