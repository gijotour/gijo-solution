// GIJO AS 클라이언트 API — 보안 운영(제품 등록부·분석 허브·SBOM·CTI·하드닝·승인·조치 검증·AI 견고성)
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request } from "./core";
import type { ThreatCompliance } from "./assets";

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
  remove: (id: string) => request<{ ok: boolean }>(`/api/maintenance/${encodeURIComponent(id)}`, { method: "DELETE" }),
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

// 조치·수정 요청(2026-08-21) — 밖으로 나간 요청의 현황·상태 전환.
export interface OutboundReq {
  id: string; kind: string; targetName?: string; recipient?: string; dueDate?: string;
  status: string; docId?: string; createdAt: number; sentAt?: number;
}
/** 서버가 **좁혀 줬는지**. 없으면 mine=1을 모르는 옛 서버다 — 화면은 그때 아무것도 안 그린다. */
export type ReqScope = "mine" | "all" | undefined;
export const outboundReqApi = {
  list: (productId?: string) =>
    request<{ requests: OutboundReq[] }>(`/api/outbound-requests${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`),
  // 📨 내 문서 판 — **내가 만든 것만**(2026-08-31). 전역 목록을 소유로 좁히는 창구다.
  listMine: () => request<{ requests: OutboundReq[]; scope?: ReqScope }>("/api/outbound-requests?mine=1"),
  setStatus: (id: string, status: string) =>
    request<{ ok: boolean }>(`/api/outbound-requests/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } }),
};

export const securityProductsApi = {
  list: () => request<SecurityProduct[]>("/api/security-products"),
  grouped: () => request<ProductGroup[]>("/api/security-products/grouped"),
  categories: () =>
    request<{ categories: ProductCategoryMeta[]; docKinds: { id: string; label: string }[] }>("/api/security-products/categories"),
  create: (args: { name: string; category: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    request<SecurityProduct>("/api/security-products", { method: "POST", body: args }),
  update: (id: string, patch: { name?: string; category?: string; vendor?: string; model?: string; assetId?: string; note?: string }) =>
    request<SecurityProduct>(`/api/security-products/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
  // 제품을 지우면 걸려 있던 매뉴얼이 어떻게 되는지 미리 본다(다른 제품과 공용인 건 보존된다).
  deletePreview: (id: string) =>
    request<{
      productName: string;
      manuals: { docName: string; title: string; sharedWith: string[] }[];
      removable: number;
      shared: number;
    }>(`/api/security-products/${encodeURIComponent(id)}/delete-preview`),
  // manuals: keep=지식베이스에 남김 · kb=임베딩만 삭제(재업로드로 복구) · file=원본까지 삭제(복구 불가)
  remove: (id: string, manuals: "keep" | "kb" | "file" = "keep") =>
    request<{ ok: boolean; removed: string[]; keptShared: { docName: string; sharedWith: string[] }[] }>(
      `/api/security-products/${encodeURIComponent(id)}?manuals=${manuals}`,
      { method: "DELETE" }
    ),
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
  /** 못 잰 문항 수(호출 실패·빈 응답). 0이 아니면 부분 측정이다. */
  errored: number;
  /** ⚠ **null이면 「못 쟀다」** — 0점(다 뚫림)도 100점(안전)도 아니다. 화면에서 채우지 말 것. */
  robustnessScore: number | null;
  /** 못 잰 문항이 하나도 없을 때만 true. */
  complete: boolean;
  byCategory: Record<string, { total: number; vulnerable: number; errored: number }>;
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
  // 제품 경로 실효 견고성 — 담당자가 실제로 쓰는 경로(가드레일 뒤)로 같은 공격을 보낸 결과.
  // 위 run/last의 "맨몸 점수"와는 다른 것을 잰다(섞으면 안 된다 — 화면에서도 구분해 보여준다).
  effectiveLast: () => request<EffectiveReport | null>("/api/redteam/effective/last"),
  runEffective: () => request<EffectiveReport>("/api/redteam/effective", { method: "POST", body: {} }),
};

export interface EffectiveReport {
  ranAt: number;
  total: number;
  blockedAtGate: number; // 입구에서 막힘(모델에 닿지 않음)
  modelHeld: number; // 모델이 버팀
  leaked: number; // 실제로 뚫림
  effectiveScore: number;
  leakedIds: string[];
  results: { id: string; severity: string; outcome: "blocked" | "held" | "leaked"; excerpt: string }[];
}

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
// ── 보안 로그 파일 분석(추가 기능, 2026-08-09) ─────────────────────────
export interface LogFileSummary { ref: string; events: number; p0: number; p1: number; open: number; latestAt: number }
export interface LogResponseGuide { kind: string; title: string; basis: string; steps: string[]; followup: string }
// 제품 소개자료 — 보안제품 등록부와 **별도 대장**(2026-08-09 사용자 지시)
export interface ProductIntroItem { id: string; name: string; category: string; vendor: string | null; summary: string | null; docName: string | null; createdAt: number }
export const productIntroApi = {
  list: () => request<{ items: ProductIntroItem[] }>("/api/product-intro"),
  remove: (id: string) => request<{ ok: boolean }>(`/api/product-intro/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const logAnalysisApi = {
  files: () => request<{ files: LogFileSummary[] }>("/api/loganalysis/files"),
  guide: (eventId: string) => request<{ guide: LogResponseGuide | null; message?: string }>(`/api/loganalysis/guide/${encodeURIComponent(eventId)}`),
};

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
  // 파일(ref) 단위 삭제(2026-08-19 삭제 일관화) — 스냅샷 후 삭제는 서버가 한다.
  removeFile: (ref: string) => request<{ ok: boolean; deleted: number }>(`/api/analysis-hub/file?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }),
};

export interface AttackPathStep { kind: "entry" | "foothold" | "lateral"; entity: string; label: string; source: string; severity: string }
export interface AttackPath { id: string; entity: string; reachability: "확인됨" | "높음" | "보통"; reachScore: number; steps: AttackPathStep[]; note: string }

// ── SBOM ─────────────────────────────────────────────────────────────
export const sbomApi = {
  generate: (assetId: string) => request(`/api/sbom/${assetId}/generate`, { method: "POST" }),
  export: (assetId: string, format: "cyclonedx" | "spdx") =>
    request(`/api/sbom/${assetId}/export`, { method: "POST", body: { format } }),
  aibomExport: (assetId: string) =>
    request<{ path: string; filename: string; json: string }>(`/api/sbom/${assetId}/aibom-export`, { method: "POST" }),
  aibomThreats: (assetId: string) => request<AiBomThreatReport>(`/api/assets/${assetId}/aibom/threats`),
};

// ── 타사 SBOM 검수(공급망 점검) — 2026-08-22, 계획서 중-7 확장 ──────────────────
// ⚠ **여기에 업로드가 없는 것이 의도다.** 파일 인입 창구는 대화창 ＋ 한 곳이고(2026-07-27 결정),
//   거기에 「📦 타사 SBOM」 유형을 더해 두었다. 화면은 **보기만** 한다.
export interface SbomReviewSummary {
  id: string; name: string; vendor?: string; assetId?: string;
  format: string; formatVersion?: string; componentCount: number;
  /** 등급별 개수 — 서버(licenserisk)가 센 값 그대로. 화면이 다시 세지 않는다. */
  summary: Record<string, number>;
  notes: string[]; reviewedBy?: string; reviewedAt: string;
}
export interface SbomReviewComponent {
  name: string; version: string; license: string; licenseFrom: string[];
  tier: string; needsCheck: boolean;
  /** 「실제로 받게 되는 요구」 — 서버가 완성한 문장이다(화면이 규칙표를 갖지 않는다). */
  받게되는요구: string; 근거: string;
  purl?: string; supplier?: string;
}
export const sbomReviewApi = {
  list: () => request<{ items: SbomReviewSummary[]; 면책: string }>("/api/sbom-review/list"),
  get: (id: string) =>
    request<{ 요약: SbomReviewSummary; 부품: SbomReviewComponent[]; 면책: string }>(`/api/sbom-review/${encodeURIComponent(id)}`),
  remove: (id: string) => request<{ ok: boolean }>(`/api/sbom-review/${encodeURIComponent(id)}/delete`, { method: "POST" }),
  setMeta: (id: string, body: { vendor?: string; assetId?: string }) =>
    request<{ ok: boolean }>(`/api/sbom-review/${encodeURIComponent(id)}/meta`, { method: "POST", body }),
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
export interface HardeningScheduleRow { id: string; targetId: string; targetLabel: string; standard: "kisa" | "cis"; intervalHours: number; enabled: number; lastRunAt: number | null; nextRunAt: number; lastRate: number | null; lastFail: number | null; lastResult: "success" | "fail" | null; lastError: string | null; createdAt: number }
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
  // 스캔이 실패해 결과를 못 받은 건수 — 취약점이 아니라 **스캐너를 고칠 일**이라 따로 센다.
  // (2026-08-01: 605건 중 602건이 스캔 오류였는데 "미검토 602건"으로 보였다.)
  scanFailed?: number;
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

// ── 조치 검증 — 찾은 취약점이 실제로 닫혔는지 대상에 접속해 확인한다 ───────────
// 스캐너가 아니다(더 찾지 않는다). 판정은 서버가 결정적으로 하고, 화면은 근거를 그대로 보여준다.
export interface VerifyOutcome {
  findingKey: string;
  title: string;
  cve?: string;
  status: "PASS" | "FAIL" | "WARN" | "NA"; // PASS=조치확인 · FAIL=미조치 · NA=수동확인 필요
  evidence: string;                        // 실행한 명령과 출력 — 담당자가 판정을 믿을 근거
  expectedKind: "version" | "absent" | "config" | "cert" | "manual";
  // 사내 문서 근거(RAG) — 보상통제·장비 확인법·사내 기준. ⚠ 제안일 뿐 판정을 바꾸지 않는다.
  basis?: { kind: "device_howto" | "compensating" | "internal_rule"; label: string; excerpt: string; documentId: string }[];
  hint?: { need: string }; // 근거가 없을 때 "어떤 문서가 있으면 되는지"
}
export interface VerifyRunResult {
  assetId: string;
  assetName?: string;
  target: string;
  results: VerifyOutcome[];
  summary: { total: number; fixed: number; still: number; manual: number };
  note?: string;
}
// VEX — 승인 상태를 국제 표준 문서로 내보낸다(협력사·규제기관 문의에 캡처 대신 파일로 답).
export const vexApi = {
  summary: (assetId?: string) =>
    request<{ total: number; byState: Record<string, number>; withoutCve: number }>(
      `/api/vex/summary${assetId ? `?assetId=${encodeURIComponent(assetId)}` : ""}`
    ),
  // 파일 본문(JSON 문자열) — 화면이 blob으로 만들어 저장한다.
  exportDoc: (assetId?: string) =>
    request<Record<string, unknown>>(`/api/vex/export${assetId ? `?assetId=${encodeURIComponent(assetId)}` : ""}`),
};

export const verifyApi = {
  // 이 자산을 검증할 수 있는가(권한 + 접속 대상 등록 여부). 버튼 상태를 정하는 데 쓴다 —
  // 최종 판단은 서버 실행 API가 다시 한다(화면 판단만 믿으면 우회된다).
  can: (assetId: string, findingKey?: string) =>
    request<{ allowed: boolean; reason: string; hasTarget: boolean; targetLabel: string | null }>(
      `/api/verify/can/${encodeURIComponent(assetId)}${findingKey ? `?key=${encodeURIComponent(findingKey)}` : ""}`
    ),
  run: (assetId: string, findingKey?: string) =>
    request<VerifyRunResult>("/api/verify/run", { method: "POST", body: { assetId, ...(findingKey ? { findingKey } : {}) } }),
};

export const complianceApi = {
  list: () => request<ThreatCompliance[]>("/api/compliance"),
  setStatus: (code: string, status: string, note: string) =>
    request<ThreatCompliance>(`/api/compliance/${code}`, { method: "PUT", body: { status, note } }),
  // AI 초안 — 위협별 대응 상태 제안(저장 아님). 담당자 검토용.
  draft: (code: string) => request<{ status: string; note: string }>(`/api/compliance/${code}/draft`, { method: "POST" }),
};

// 저장 암호화(at-rest) — 상태 조회와 복구 열쇠 재발급(2026-07-30).
// 켜는 것은 화면에서 못 한다(서버 정지가 필요) — 상태를 정직하게 보여주는 것이 이 API의 일이다.
export const dbCryptApi = {
  status: () =>
    request<{
      encrypted: boolean;
      keyFilePresent: boolean;
      keyCreatedAt: number | null;
      machineBinding: { sources: number; strong: boolean };
      covers: string[];
      notCovered: string[];
      howToEnable: string | null;
      plaintextCopies: { count: number; files: string[]; totalMb: number };
    }>("/api/dbcrypt/status"),
  // 응답의 recoveryKey는 **한 번만** 내려온다. 어디에도 저장하지 않는다.
  rotateRecovery: () =>
    request<{ recoveryKey: string; notice: string }>("/api/dbcrypt/rotate-recovery", { method: "POST" }),
};

// 문서함 — 출하 문서를 담당자가 직접 읽는 통로(2026-07-31).
// id는 서버 목록이 준 것만 쓴다 — 클라이언트가 파일 경로를 정하지 않는다(서버가 화이트리스트).
export const docboxApi = {
  list: () => request<{ documents: { id: string; title: string; group: "guide" | "policy"; why?: string }[] }>("/api/docbox"),
  read: (id: string) => request<{ id: string; title: string; markdown: string }>(`/api/docbox/${encodeURIComponent(id)}`),
  search: (q: string) =>
    request<{ results: { id: string; title: string; hits: number; snippet: string }[] }>(
      `/api/docbox/search?q=${encodeURIComponent(q)}`
    ),
};

// 문서함 요청 만들기 — 서버가 문서를 조립하고, **파일 저장은 클라이언트가 한다**
// (사용자 결정 2026-07-30: 전달은 담당자가 파일을 직접 다룬다 — 메일 발송 없음).
export const docRequestApi = {
  build: (input: {
    kind: "bug" | "feature" | "ui" | "etc";
    title: string;
    tried: string;
    happened: string;
    images: string[];
    screen?: string;
    clientVersion?: string;
    platform?: string;
  }) =>
    request<{ fileName: string; markdown: string; maskedCount: number; maskedKinds: string[]; imageCount: number; sizeBytes: number }>(
      "/api/docbox/request",
      { method: "POST", body: input }
    ),
  list: () =>
    request<{ requests: { id: string; at: number; kind: string; title: string; actor: string | null; fileName: string }[] }>(
      "/api/docbox/requests"
    ),
};

// ── 원격 LLM(BridgeAI 1단계 · VPN 전용) — 서버 remotellm.ts 라우트의 소비자 ──────────
export const remoteLlmApi = {
  get: () => request<{ enabled: boolean; url: string; lastCheck: number | null; lastModel: string | null; airgap: boolean }>("/api/llm/remote"),
  test: (url: string) => request<{ ok: boolean; models?: number | null; model?: string | null; error?: string }>("/api/llm/remote/test", { method: "POST", body: { url } }),
  set: (enabled: boolean, url: string) => request<{ enabled: boolean; url: string; airgap: boolean }>("/api/llm/remote", { method: "POST", body: { enabled, url } }),
  // 「내 질문이 바깥으로 나가나」 — 로그인한 누구나(담당자 포함). 주소는 안 준다.
  // 위 get()은 admin 전용이라, 담당자 화면이 그걸 쓰면 원격이 켜져 있어도 로컬로 보였다.
  // model·checkedAt은 **주소가 아니다** — 담당자도 「어느 두뇌가 답하나」는 알아야 한다(2026-09-02).
  where: () => request<{ remote: boolean; airgap: boolean; model: string | null; checkedAt: number | null }>("/api/llm/remote/where"),
};

// ── 이 PC를 원격 GPU로 **내주기**(2026-08-14) — 서버 llmserve.ts의 소비자 ────────────
//   위가 「붙는 쪽」이면 이건 「받는 쪽」이다. 둘이 짝이라 한 파일에 붙여 둔다.
export const llmServeApi = {
  get: () => request<{ enabled: boolean; lastServedAt: number | null; airgap: boolean; port: number }>("/api/llm/serve"),
  set: (enabled: boolean) => request<{ enabled: boolean; lastServedAt: number | null; airgap: boolean; port: number }>("/api/llm/serve", { method: "POST", body: { enabled } }),
};

// ── 📚 침해사고 히스토리(2026-09-03) — 해설 팀원(normaltic)의 사례 저장소, 서버 incidentcases.ts의 소비자 ──
//   **읽기 전용 다리**다. 등록·삭제는 대화창(register_incident_case 도구 → 결재판)이 유일한 문이라
//   여기엔 POST·DELETE를 두지 않는다 — 화면이 쓰기를 직접 부르면 「지시는 대화창」 원칙이 깨진다.
//   ⚠ techniques·cves·products는 표에 JSON 문자열(TEXT)로 있지만 서버(incidentcases.ts toRow)가 **배열로 풀어 준다** —
//     그것이 계약이라 타입은 배열(IncidentCaseRow와 같은 꼴)이다. 화면(incidentcases.html 배열())은 문자열이 와도
//     스스로 푼다 — 갈래가 어긋나도 안 죽게. 여기서 `| string`을 다시 넣지 말 것(서버 계약을 흐린다).
//   ⚠ createdAt·updatedAt는 **ms 숫자**(Date.now(), INTEGER 칸)다 — 문자열로 적으면 화면이 localeCompare로 정렬해
//     조용히 틀린다(통합 검토 2026-09-03에서 잡힘). 날짜로 그릴 땐 new Date(number).
//   ⚠ 목록·유사 응답은 { cases, total } 두 칸이다(서버 계약, 2026-09-03 통합 수리). total은 **상한(limit)에 잘려도**
//     참값을 싣는다 — 화면이 cases.length로 「N건」을 적으면 상한에 닿는 순간 그 숫자가 거짓이 되기 때문이다.
//     소비자(incidentcases.html·grouppanels 📚 판)는 total로 적고, 잘렸으면 「N건 중 M건 표시」라고 밝힌다.
export interface IncidentCase {
  id: string; createdAt: number; updatedAt: number;
  title: string; oneLiner: string; plainExplain: string;
  year: number | null; industry: string | null; region: "국내" | "해외" | null;
  techniques: string[]; cves: string[]; products: string[];
  lesson: string; sourceUrl: string; sourceName: string | null;
  origin: "builtin" | "user"; registeredBy: string | null;
}
/** 사례의 샘(외부 매체) 한 줄 — 서버 incidentsources.json. 화면은 이 이름으로 그린다(name·url·kind·lang·cadence·desc). */
export interface IncidentSource {
  id?: string; name: string; url: string; kind: "youtube" | "site" | "domestic" | string;
  lang?: string; cadence?: string; desc?: string;
}
export const incidentCasesApi = {
  list: (p?: { q?: string; cve?: string; year?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (p?.q) qs.set("q", p.q);
    if (p?.cve) qs.set("cve", p.cve);
    if (p?.year != null) qs.set("year", String(p.year));
    if (p?.limit != null) qs.set("limit", String(p.limit));
    const s = qs.toString();
    return request<{ cases: IncidentCase[]; total: number }>("/api/incident-cases" + (s ? "?" + s : ""));
  },
  // 「비슷한 사례」 — 규칙만(LLM 없음). 칩(취약점 카드·대화창)과 판의 CVE 필터가 **같은 창구**를 써야
  // 칩의 N건과 판의 줄 수가 같다(세는 곳이 둘이면 어긋난다).
  // ⚠ limit은 서버 창구가 받는 인자를 그대로 비춘 것이다 — preload 다리(incidentCasesSimilar)도 2026-09-03에
  //   함께 넘기도록 고쳤다(판의 ?cve= 좁힘이 50건을 넘긴다). 안 넘기면 서버 기본은 **5건**이라, 칩이 「12건」이라
  //   해 놓고 판에 5줄만 그리는 어긋남이 났었다.
  similar: (cves: string[], limit?: number) =>
    request<{ cases: IncidentCase[]; total: number }>(
      "/api/incident-cases/similar?cves=" + encodeURIComponent(cves.join(",")) + (limit != null ? "&limit=" + String(limit) : ""),
    ),
  sources: () => request<{ sources: IncidentSource[] }>("/api/incident-cases/sources"),
  // 상세 한 건(/api/incident-cases/:id) 래퍼는 **두지 않는다**(2026-09-03 통합 검토 [낮음], 결정: 제거).
  //   판이 목록 줄을 그 자리에서 펼쳐 상세를 보여 주므로 부를 자리가 없었고, preload 다리도 없어 렌더러에서는
  //   원리상 닿지 못하는 죽은 창구였다. 서버 라우트는 그대로 있으니, 상세 카드가 생기면 그때 다리와 함께 되살린다.
};
