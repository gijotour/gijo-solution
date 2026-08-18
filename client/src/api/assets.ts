// GIJO AS 클라이언트 API — 자산(인벤토리·커버리지·허브·영향도·통합 업로드)
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request } from "./core";

// ── 스마트 통합 업로드 — 파일 유형 자동 판별·라우팅(취약점 스캔/매뉴얼/문서 분류) ──
export type UploadType = "asset" | "log" | "document" | "guideline" | "vulnreport";
export interface AutoUploadResult {
  filename: string;
  routedTo: "vulnscan" | "product-manual" | "memory" | "decision";
  reason: string;
  needsDecision?: boolean;
  guess?: UploadType;
  guessProductName?: string;
  vulnscan?: { hosts: number; findings: number };
  manual?: { productName: string; kind: string; createdProduct: boolean };
  memory?: { chunks: number; docClass?: string; linkedProduct?: string; category?: string };
  category?: string; // 확정된 업무영역(취약점·장비운영·사내규정·위협대응·일반) — 승인카드 표시용
}
export const uploadApi = {
  auto: (filename: string, content: string, forceType?: UploadType, productName?: string) =>
    request<AutoUploadResult>("/api/upload/auto", {
      method: "POST",
      body: { filename, content, ...(forceType ? { forceType } : {}), ...(productName ? { productName } : {}) },
    }),
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

export interface AiBomRobustness {
  score: number | null;
  vulnerable: number;
  total: number;
  ranAt: number;
  modelId: string;
}
export interface AiBom {
  model: { foundationModel: string; finetuneHistory: string; architecture: string; weightsHash: string; intendedUse: string; limitations: string; modelRef: string };
  dataset: { sources: string; vectorDbLocation: string };
  prompt: { systemPrompt: string; guardrails: string };
  agentTool: { apis: string; mcpServers: string };
  infrastructure: { compute: string; hostingProvider: string };
  robustness: AiBomRobustness;
}

// sample = 데모용 시드 데이터, scanner = 취약점 스캔 반입, registered = 직접 등록·저장소 스캔
export type AssetOrigin = "sample" | "scanner" | "registered";

export interface Asset {
  origin: AssetOrigin;
  id: string;
  name: string;
  path: string;
  assetType: string;
  owner: string;
  service: string | null;
  components: AssetComponent[];
  findings: Finding[];
  aibom: AiBom;
  category: string | null;
  hostname: string | null;
  ip: string | null;
  defaultAssignee?: string | null; // 새 취약점이 자동 배정될 담당자(없으면 미배정 유지)
  registeredAt: number;
  updatedAt: number | null;
  lastScannedAt: number | null;
  sbomGeneratedAt: number | null;
}

// ── 자산 커버리지(무엇을 모르는가) ────────────────────────────────────
export type AssetGapKind = "owner" | "service" | "sbom" | "unscanned";

export interface AssetGap {
  kind: AssetGapKind;
  severity: "high" | "mid";
  title: string;
  why: string;
  fixLabel: string;
  assetIds: string[];
}

export interface RankedAsset {
  id: string;
  name: string;
  gaps: AssetGapKind[];
  openFindings: number;
  maxSeverity: string;
  kev: boolean;
  why: string;
  score: number;
}

export interface AssetCoverage {
  total: number;
  complete: number;
  gaps: AssetGap[];
  ranked: RankedAsset[];
}

// ── 자산 허브(통합 뷰) ────────────────────────────────────────────────
export type OwaspStatus = "open" | "covered" | "na";
export interface OwaspRiskState { code: string; title: string; status: OwaspStatus; evidence: string }
export interface AssetHubVuln { critical: number; high: number; medium: number; low: number; kev: number; open: number }
export interface AssetHubRow {
  id: string; name: string;
  displayName: string | null; // 담당자가 붙인 표시 이름(별칭) — 화면은 있으면 이걸 보여준다
  sourceFile: string | null;  // 이 자산이 등록된 출처 파일. 직접 등록이면 null
  assetType: string; isAi: boolean; owner: string; service: string | null; host: string | null;
  vuln: AssetHubVuln;
  bomAreas: { model: number; dataset: number; prompt: number; agentTool: number; infrastructure: number; total: number };
  sbomGenerated: boolean; robustnessScore: number | null; owaspOpen: number; owaspTopCodes: string[];
  exposureScore: number; riskBand: "critical" | "high" | "medium" | "ok";
}
export interface AssetHubSummary {
  totalAssets: number; aiAssets: number; itAssets: number; overallExposure: number;
  bands: { aiAssetAvg: number; externalAvg: number; internalAvg: number };
  owaspOpenByCode: { code: string; title: string; count: number }[];
  vuln: { open: number; critical: number; high: number; medium: number; kev: number };
  sbomMissing: number;
}
// 파일(출처) 단위 묶음 — 올린 파일 기준으로 자산을 정리해 본다.
export interface HubSourceGroup {
  sourceFile: string | null;
  label: string;
  assetIds: string[];
  assetCount: number;
  vuln: AssetHubVuln;
  lastScannedAt: number | null;
}
export interface AssetHubOverview { summary: AssetHubSummary; rows: AssetHubRow[]; sourceGroups: HubSourceGroup[] }
export interface AssetHubDetail {
  row: AssetHubRow;
  owasp: OwaspRiskState[];
  findings: { title: string; severity: string; kev: boolean; evidence: string; state: string }[];
  aibom: AiBom;
  host: string | null;
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

// 자산 허브(자산 목록·AI-BOM·취약점 통합 뷰) — 서버 assethub.ts 집계.
export interface ShadowModel { modelId: string; sources: string[]; running: boolean; usedByAgents: string[]; severity: "high" | "medium"; suggestion: string }
export interface ShadowAiReport { scannedAt: string; observedCount: number; governedCount: number; shadow: ShadowModel[] }

/** 업무 절차 5단계 현황 — 절차 띠가 읽는다. 숫자는 서버가 한 곳에서 센다(화면마다 세면 어긋난다). */
export interface WorkflowStage { no: number; key: string; label: string; count: number | null; alert: number | null; alertLabel: string; page: string; }
export const workflowApi = {
  stages: () => request<{ stages: WorkflowStage[] }>("/api/workflow/stages"),
};

export const assetHubApi = {
  overview: () => request<AssetHubOverview>("/api/assethub"),
  detail: (id: string) => request<AssetHubDetail>(`/api/assethub/${encodeURIComponent(id)}`),
  shadowAi: () => request<ShadowAiReport>("/api/shadow-ai"),
  // ⓪ 자산 화면의 ③ 조치 칸 — 못 구하면 화면은 「—」로 둔다(0으로 채우지 않는다).
  progress: (id: string) => request<{ inProgress: number; unassigned: number }>(`/api/assets/${encodeURIComponent(id)}/progress`),
  // 표시 이름(별칭) 변경 — null/빈 문자열이면 원래 이름으로 되돌린다.
  setDisplayName: (id: string, displayName: string | null) =>
    request<Asset>(`/api/assets/${encodeURIComponent(id)}/display-name`, { method: "POST", body: { displayName } }),
};

// 파일 업로드 진행내역 리포트(선택 저장) — 감사·인수인계 증빙용.
export interface IngestReportInput {
  filename: string; routedTo: string; reason: string;
  steps?: string[]; assetIds?: string[]; hosts?: number; findings?: number; chunks?: number;
}
export const ingestReportApi = {
  save: (input: IngestReportInput) =>
    request<{ base: string; path: string; savedAt: number }>("/api/upload/ingest-report", { method: "POST", body: input }),
};

// 오래 걸려 리포트로 돌린 요청 — 다 되면 화면이 팝업으로 알린다(2026-07-26).
export interface LongAnswerNotice {
  id: string; instruction: string; status: "done" | "failed";
  reportBase: string | null; error: string | null; startedAt: number; finishedAt: number | null;
}
export const longAnswerApi = {
  pending: () => request<{ notices: LongAnswerNotice[] }>("/api/long-answers/pending"),
  ack: (id: string) => request<{ ok: true }>(`/api/long-answers/${encodeURIComponent(id)}/ack`, { method: "POST" }),
};

// 명령창 아래 팁 — 질문 예시(화면별)와 알아두기(제품 규칙). 규칙은 서버가 단일 출처라
// 규칙이 바뀌어도 클라이언트를 다시 게시할 필요가 없다(2026-07-26 사용자 지시).
export interface ScreenTips { title: string; examples: string[]; rules: string[] }
export const screenTipsApi = {
  get: (screen?: string) =>
    request<ScreenTips>(`/api/screen-tips${screen ? `?screen=${encodeURIComponent(screen)}` : ""}`),
};

// 화면 안내 본문 — 화면을 열면 대시보드 대화가 이걸 그대로 띄운다(ⓘ 아이콘 대체, 2026-07-27).
export interface ScreenGuideText { title: string; what: string; text: string }
export const screenGuideApi = {
  get: (screen?: string, question?: string) => {
    const q = new URLSearchParams();
    if (screen) q.set("screen", screen);
    if (question) q.set("question", question);
    const qs = q.toString();
    return request<ScreenGuideText>(`/api/screen-guide${qs ? `?${qs}` : ""}`);
  },
};

export const assetsApi = {
  list: () => request<Asset[]>("/api/assets"),
  get: (id: string) => request<Asset>(`/api/assets/${id}`),
  // 경량 단건 재스캔(대시보드 팝오버) — dispatch 파이프라인 없이 어댑터만 실행.
  scan: (id: string) => request<{ assetId: string; findings: number }>(`/api/assets/${id}/scan`, { method: "POST" }),
  // 기본 담당자 — 이 자산에서 새로 발견되는 취약점이 자동 배정된다(빈 값이면 해제).
  setDefaultAssignee: (id: string, assignee: string | null) =>
    request<{ assetId: string; defaultAssignee: string | null }>(`/api/assets/${encodeURIComponent(id)}/default-assignee`, {
      method: "POST", body: { assignee },
    }),
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
  // ④ 카테고리(그룹) 지정/해제 — null이면 미분류.
  setCategory: (id: string, category: string | null) =>
    request<Asset>(`/api/assets/${encodeURIComponent(id)}/category`, { method: "PATCH", body: { category } }),
  weightsHash: (id: string, filePath?: string) =>
    request<{ assetId: string; filePath: string; sizeBytes: number; weightsHash: string }>(`/api/assets/${id}/aibom/weights-hash`, { method: "POST", body: { filePath } }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // 자산 정보 결손 현황 — 화면 커버리지 탭과 챗봇이 같은 계산을 본다.
  coverage: () => request<AssetCoverage>("/api/assets/coverage"),
  // 담당부서·서비스 정정 — 결손을 메우는 경로.
  updateOwnership: (id: string, patch: { owner?: string; service?: string | null }) =>
    request<Asset>(`/api/assets/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
  importVulnScan: (content: string, format: "json" | "csv" | "html" | "nessus", source: string) =>
    request<{ hosts: number; findings: number; rows: number; assets: Asset[]; uncredentialedHosts: string[] }>("/api/vulnscan/import", {
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
