// GIJO AS 클라이언트 API — 지식(RAG·온톨로지·문서 보강·개인 문서함)
// 2026-08-06 apiClient.ts(2,141줄)에서 분리 — 구역 본문은 원문 그대로, 공통은 core.ts.
import { request } from "./core";

// ── 문서 보강 인입 (영문 매뉴얼·장애노트 → 한글 RAG + 온톨로지) ──────────────
export interface EnrichIngestArgs {
  productName: string;
  section: string;
  sourceDoc?: string;
  mode?: "auto" | "cloud" | "local" | "manual";
  text?: string; // AI 모드: 원본(영문/원문)
  korean?: string; // manual 모드: 사람이 작성한 한글 본문
  triples?: { subject: string; predicate: string; object: string }[];
}
export interface EnrichIngestResult {
  documentId: string;
  chunks: number;
  triples: number;
  translated: boolean;
  via: "cloud" | "local" | "manual" | "none";
}
export const docsApi = {
  enrichIngest: (a: EnrichIngestArgs) => request<EnrichIngestResult>("/api/docs/enrich-ingest", { method: "POST", body: a }),
};

// ── 장기 기억(RAG) ────────────────────────────────────────────────────
// 인수인계(Knowledge Transfer) — 올린 문서가 실제 답변 근거로 인용되는지 자동 검증 + 완료 증적.
export interface HandoverCheck {
  documentId: string;
  question: string;
  cited: boolean;
  sources: string[];
  answerPreview: string;
  error?: string;
}
export interface HandoverReport {
  batchId: string;
  total: number;
  cited: number;
  passRate: number;
  results: HandoverCheck[];
}
export const handoverApi = {
  verify: (documentIds: string[]) =>
    request<HandoverReport>("/api/handover/verify", { method: "POST", body: { documentIds } }),
  complete: (p: { documentIds: string[]; cited: number; total: number; passRate: number; batchId?: string }) =>
    request<{ ok: boolean }>("/api/handover/complete", { method: "POST", body: p }),
};

export const memoryApi = {
  ingest: (path: string, scope?: string) =>
    request<IngestResult>("/api/memory/ingest", { method: "POST", body: { path, scope } }),
  ingestFile: (filename: string, content: string, scope?: string) =>
    request<IngestResult>("/api/memory/ingest-file", { method: "POST", body: { filename, content, scope } }),
  query: (question: string, topK?: number, agentId?: string) =>
    request<string[]>("/api/memory/query", { method: "POST", body: { question, topK, agentId } }),
  // 올린 문서 관리(장기기억) — 목록·조각 미리보기·삭제.
  listDocuments: () =>
    request<MemoryDocument[]>("/api/memory/documents"),
  documentChunks: (documentId: string, limit?: number) =>
    request<{ chunkIndex: number; text: string }[]>("/api/memory/document/chunks", { method: "POST", body: { documentId, limit } }),
  // 업무영역(취약점·장비운영·사내규정·위협대응·일반) 수정 — 승인카드의 [영역 수정]용.
  setDocumentCategory: (documentId: string, category: string) =>
    request<{ ok: boolean; documentId: string; category: string }>("/api/memory/document/category", { method: "POST", body: { documentId, category } }),
  // 열람 등급(기밀 C·민감 S·공개 O) — N2SF. 서버가 감사에 남긴다.
  setDocumentGrade: (documentId: string, grade: string) =>
    request<{ documentId: string; grade: string }>("/api/memory/document/grade", { method: "POST", body: { documentId, grade } }),
  deleteDocument: (documentId: string, withFile?: boolean) =>
    request<{ documentId: string; deletedChunks: number; deletedFile: boolean }>("/api/memory/document/delete", { method: "POST", body: { documentId, withFile } }),
  // 서버에 보관된 업로드 원본(base64) — "원본 열기"용.
  documentFile: (documentId: string) =>
    request<{ filename: string; content: string }>("/api/memory/document/file", { method: "POST", body: { documentId } }),
  // 지식베이스 위생 점검(상충·중복·신선도) — 삭제는 하지 않고 리포트만.
  hygiene: () => request<KbHygieneReport>("/api/kb-hygiene"),
  hygieneScan: () => request<KbHygieneReport>("/api/kb-hygiene/scan", { method: "POST" }),
  // 기본 지식 번들(전-4) — 설치 시 실려 나가는 표준 지식의 버전·적용 상태.
  knowledgeBundleStatus: () => request<KnowledgeBundleStatus>("/api/knowledge-bundle/status"),
};


// 답변 지적(중-1) — "이 답 이상해요"를 회귀 문항 후보로 보낸다.
export const answerFeedbackApi = {
  send: (b: { kind: string; question: string; answer: string; note?: string; expected?: string; screen?: string }) =>
    request<{ id: number }>("/api/answer-feedback", { method: "POST", body: b }),
  list: (days = 7) => request<{ entries: unknown[]; summary: string }>(`/api/answer-feedback?days=${days}`),
};
// "AI가 아낀 시간"(중-2) — 자동화 처리량을 시간으로 환산한 추정치.
export const timeSavedApi = {
  status: (days = 30) => request<TimeSavedStatus>(`/api/time-saved?days=${days}`),
  setBaseline: (kind: string, minutes: number) =>
    request<TimeSavedStatus>("/api/time-saved/baseline", { method: "POST", body: { kind, minutes } }),
};

export interface TimeSavedRow {
  kind: string;
  label: string;
  count: number;
  minutesEach: number;
  minutes: number;
  source: string;
  custom: boolean;
}
export interface TimeSavedStatus {
  days: number;
  rows: TimeSavedRow[];
  totalMinutes: number;
  totalHours: number;
  adjustedHours: number;
  riskAdjustment: number;
  coversWholePeriod: boolean;
  ledgerStart: number | null;
  assumptions: string[];
  note: string;
  baselines?: Record<string, { minutes: number; source: string }>;
  custom?: Record<string, number>;
}

export interface KnowledgeBundleStatus {
  bundleVersion: string;
  applied: { version: string; at: number; triples: number; docsIngested: number; docsSkipped: number } | null;
  upToDate: boolean;
  ontology: { sources: string[]; triples: number };
  docs: { total: number; withFile: number };
  attributions: string[];
}

export interface KbHygieneFinding { type: "duplicate" | "version_conflict" | "stale"; severity: "high" | "medium" | "low"; documents: string[]; reason: string; suggestion: string }
export interface KbHygieneReport { scannedAt: string; totalDocs: number; findings: KbHygieneFinding[]; clean: boolean }

export interface IngestResult {
  documentId: string;
  chunks: number;
  embeddingModel: string;
  scope: string;
  docClass?: string; // Scan·Analyze Agent 분류(매뉴얼/보고서/정책/기타)
  linkedProduct?: string; // '매뉴얼' 분류 시 자동 연결된 기존 보안제품명
  category?: string; // 업무영역 5종 — 화면 맥락 검색·승인카드 표시용
}

export interface MemoryDocument {
  documentId: string;
  scope: string;
  chunks: number;
  embeddingModel: string | null;
  ingestedAt: string | null;
  hasSource: boolean;
  docClass: string | null;
  uploadedBy?: string | null; // 작업 귀속 — 누가 올렸는지
}

// ── 온톨로지 (지식 그래프 / 하이브리드 지식모델의 의미 계층) ──────────────
export interface OntologyTriple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  scope: string;
  source: string | null;
  createdAt: number;
}
export const ontologyApi = {
  list: (filter?: { scope?: string; subject?: string; source?: string }) => {
    const q = new URLSearchParams();
    if (filter?.scope) q.set("scope", filter.scope);
    if (filter?.subject) q.set("subject", filter.subject);
    if (filter?.source) q.set("source", filter.source); // 문서 파일별 관리 — "이 파일이 만든 연결" 조회
    const qs = q.toString();
    return request<OntologyTriple[]>(`/api/ontology/triples${qs ? `?${qs}` : ""}`);
  },
  add: (t: { subject: string; predicate: string; object: string; scope?: string; source?: string }) =>
    request<OntologyTriple>("/api/ontology/triple", { method: "POST", body: t }),
  remove: (id: string) => request<{ deleted: boolean }>(`/api/ontology/triple/${encodeURIComponent(id)}`, { method: "DELETE" }),
  expand: (text: string, agentId?: string) =>
    request<OntologyTriple[]>("/api/ontology/expand", { method: "POST", body: { text, agentId } }),
  stats: () => request<{ count: number }>("/api/ontology/stats"),
  seed: () => request<{ inserted: number; sources: string[] }>("/api/ontology/seed", { method: "POST" }),
};

// ── 개인 문서함(2026-07-31) — 담당자가 자기 메모를 넣는 자리. 서버가 userId로 격리한다.
export interface PersonalDocMeta { id: string; title: string; ragOptIn: boolean; shared: boolean; createdAt: number; updatedAt: number }
export interface PersonalDoc extends PersonalDocMeta { body: string; warnings?: { kind: string; masked: string; hint: string }[] }
export const personalDocsApi = {
  list: () => request<{ documents: PersonalDocMeta[] }>("/api/personaldocs"),
  read: (id: string) => request<PersonalDoc>(`/api/personaldocs/${encodeURIComponent(id)}`),
  create: (b: { title: string; body: string }) => request<PersonalDoc>("/api/personaldocs", { method: "POST", body: b }),
  update: (id: string, b: { title: string; body: string }) =>
    request<PersonalDoc>(`/api/personaldocs/${encodeURIComponent(id)}`, { method: "PUT", body: b }),
  setRag: (id: string, on: boolean) =>
    request<PersonalDoc>(`/api/personaldocs/${encodeURIComponent(id)}/rag`, { method: "POST", body: { on } }),
  // 회사에 공유(2026-08-20 LLM 위키) — 켜면 전 담당자 근거 가능(비밀 마스킹 인입), 끄면 회수.
  setShared: (id: string, on: boolean) =>
    request<PersonalDoc>(`/api/personaldocs/${encodeURIComponent(id)}/share`, { method: "POST", body: { on } }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/personaldocs/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export type GuardMode = "off" | "flag" | "block";
export interface GuardEvent {
  at: number;
  source: string;
  excerpt: string;
  categories: string[];
  blocked: boolean;
}
export const guardrailApi = {
  status: () => request<{ mode: GuardMode; flaggedCount: number; blockedCount: number }>("/api/guardrail/status"),
  log: (limit = 50) => request<GuardEvent[]>(`/api/guardrail/log?limit=${limit}`),
  setMode: (mode: GuardMode) =>
    request<{ mode: GuardMode; flaggedCount: number; blockedCount: number }>("/api/guardrail/mode", { method: "POST", body: { mode } }),
};
