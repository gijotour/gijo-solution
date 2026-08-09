// GIJO AS 클라이언트 API — 보고·관리(리포트·KPI·발송·배포·로그·감사)
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request } from "./core";

// ── Git 동기화 ────────────────────────────────────────────────────────
export const gitSyncApi = {
  sync: (remoteUrl: string, branch: string) =>
    request("/api/gitsync/sync", { method: "POST", body: { remoteUrl, branch } }),
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

// 법령·판례 조회(법제처 OPEN API). 인증키는 서버가 암호화 보관하고 돌려주지 않는다 — 켜짐/꺼짐만 온다.
// 신청 도메인은 비밀이 아니라 그대로 온다(담당자가 맞게 넣었는지 화면에서 봐야 하기 때문).
export interface LawConfig { enabled: boolean; hasKey?: boolean; domain?: string; updatedAt: number | null }
export interface LawHit { title: string; meta: string; link: string; mst?: string }
export const lawApi = {
  getConfig: () => request<LawConfig>("/api/law/config"),
  setKey: (key: string, domain = "") =>
    request<LawConfig>("/api/law/config", { method: "POST", body: { key, domain } }),
  search: (query: string, target = "law", limit = 5) =>
    request<{ hits: LawHit[]; disclaimer: string }>(
      `/api/law/search?query=${encodeURIComponent(query)}&target=${encodeURIComponent(target)}&limit=${limit}`
    ),
};

// 모델 받기 인증(HuggingFace 토큰·프록시). 토큰 자체는 서버에서 돌아오지 않는다 — 끝 4자만 온다.
export interface ModelAuthPublic {
  hasToken: boolean;
  tokenTail: string | null;
  proxyUrl: string;
  updatedAt: number | null;
  updatedBy: string | null;
}
export interface ModelAuthTestResult { ok: boolean; message: string; whoami?: string }
export const modelAuthApi = {
  get: () => request<ModelAuthPublic>("/api/model-auth"),
  save: (patch: { token?: string; proxyUrl?: string }) =>
    request<ModelAuthPublic>("/api/model-auth", { method: "POST", body: patch }),
  test: () => request<ModelAuthTestResult>("/api/model-auth/test", { method: "POST", body: {} }),
};

// 전송 수단 — udp만 도착 확인이 안 된다(2026-07-31 확장).
export interface SiemConfig {
  enabled: boolean;
  host: string;
  port: number;
  format: "rfc5424" | "cef" | "json";
  transport: "udp" | "tcp" | "tls" | "hec";
  minSeverity: "info" | "high" | "critical";
  hecToken?: string;
  hecTokenSet?: boolean;
  hecPath?: string;
  tlsRejectUnauthorized?: boolean;
  stats?: SiemStats;
}
export interface SiemStats {
  sent: number; failed: number; dropped: number; queued: number;
  lastSuccessAt: number | null; lastFailureAt: number | null; lastError: string | null;
  deliveryConfirmed: boolean;
}
export const siemApi = {
  getConfig: () => request<SiemConfig>("/api/siem/config"),
  saveConfig: (config: Partial<SiemConfig>) => request<SiemConfig>("/api/siem/config", { method: "POST", body: config }),
  test: () => request<{ ok: boolean; error?: string; confirmed: boolean; target: string }>("/api/siem/test", { method: "POST" }),
  stats: () => request<SiemStats>("/api/siem/stats"),
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
    type: "weekly" | "quarterly" | "ondemand" | "work-progress",
    assetIds?: string[],
    opts?: { audience?: "internal" | "official"; format?: "docx" | "pdf" | "both"; sessionIds?: string[]; days?: number }
  ) => request("/api/report/generate", { method: "POST", body: { type, assetIds, audience: opts?.audience, format: opts?.format, sessionIds: opts?.sessionIds, days: opts?.days } }),
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
  // serverTime: 2차 인증 6자리는 시계로 만들어진다 — 로그인 화면이 인증 전에 시각 차이를
  // 비교해 보여주려면 무인증 응답에서 서버 시각을 받아야 한다.
  check: () => request<{ ok: boolean; service: string; serverTime?: number }>("/api/health"),
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
  // 관리자 전용 — 누가 어떤 버전을 받았는지(2026-07-28 신설). 어느 PC가 아직 옛 버전인지 가늠용.
  downloadLog: () =>
    request<{ downloads: { at: number; actor: string | null; version: string | null; detail: string | null }[] }>(
      "/api/client/download-log"
    ),
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
