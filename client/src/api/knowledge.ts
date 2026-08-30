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
  // 이 **서버**가 문서를 어디까지 읽는지 물어본다(2026-08-22).
  //   ⚠ 클라이언트 OS로 판단하면 안 된다 — 분산 모드에서는 클라와 서버가 다른 기계라
  //     mac 클라가 win 서버에 붙는 조합이 실제로 가능하고, 그때 능력을 정반대로 표시한다.
  //     읽는 일을 하는 쪽이 답해야 화면의 약속이 참이 된다.
  extractCapability: () =>
    request<{ office: boolean; pdf: boolean; ocr: boolean; ocr사유: string }>("/api/extract/capability"),
  ingest: (path: string, scope?: string) =>
    request<IngestResult>("/api/memory/ingest", { method: "POST", body: { path, scope } }),
  ingestFile: (filename: string, content: string, scope?: string, keepOriginal?: boolean) =>
    request<IngestResult>("/api/memory/ingest-file", { method: "POST", body: { filename, content, scope, keepOriginal } }),
  query: (question: string, topK?: number, agentId?: string) =>
    request<string[]>("/api/memory/query", { method: "POST", body: { question, topK, agentId } }),
  // 올린 문서 관리(장기기억) — 목록·조각 미리보기·삭제.
  listDocuments: () =>
    request<MemoryDocument[]>("/api/memory/documents"),
  /** ★ **반입 영수증**(2026-08-22 사장님 「사용자가 넣는 파일 내문서에서 다 확인 가능해야 해」).
   *  ⚠ 위 `listDocuments`와 **다른 것**이다: 그쪽은 **지식 조각이 있는 문서**만 준다.
   *    취약점 스캔·SBOM은 일부러 지식에 안 넣으므로 거기 안 뜬다 —
   *    「내가 뭘 올렸더라?」에 답하려면 갈래와 무관한 이 목록이 필요하다.
   *  ⚠ **「내가 넣은 모든 파일」이 아니다**(2026-08-22 검토관 [높음]으로 정정) — 서버가
   *    **내가 올린 것 + 내가 볼 수 있는 것**만 준다. 관리자는 팀 반입도 본다.
   *    `총량.건수`는 **거른 뒤의** 총계라, 화면은 목록 길이가 아니라 이 값을 써야 한다. */
  uploadReceipts: (limit?: number) =>
    request<{ 목록: UploadReceipt[]; 총량: { 건수: number; 전체바이트: number; 원본보관바이트: number }; 갈래이름: Record<string, string> }>(
      "/api/upload/receipts" + (limit ? "?limit=" + limit : "")
    ),
  // 📂 지켜보는 폴더(2026-08-31) — 목록·최근 스캔 결과. 읽기 전용(등록·해제는 대화창 결재판).
  watchFolders: () =>
    request<{ folders: { id: number; path: string; label: string | null; active: boolean; createdByName: string | null; createdAt: string; lastScanAt: string | null; lastResult: { ranAt: string; 새로: number; 갱신: number; 건너뜀: number; 충돌: string[]; 등급막힘: string[]; 스캔후보: string[]; 오류: string[]; 잘림: string | null } | null; docCount: number }[]; tickSeconds: number }>(
      "/api/watch-folders"
    ),
  // 오늘 새로 들어온 문서 수 — 사이드바 "내 문서" 배지(값싼 COUNT). since=현지 자정 ISO.
  recentDocCount: (sinceIso: string) =>
    request<{ count: number }>("/api/memory/documents/recent-count?since=" + encodeURIComponent(sinceIso)),
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
  // 추출한 텍스트(.md) 보기/고치기 — 「내 문서」에서 AI가 실제로 뽑은 내용을 확인·수정(투명성·반입 신뢰도).
  documentMarkdown: (documentId: string) =>
    request<{ documentId: string; text: string; source: string }>("/api/memory/document/markdown", { method: "POST", body: { documentId } }),
  documentMarkdownSave: (documentId: string, text: string) =>
    request<{ documentId: string; chunks: number }>("/api/memory/document/markdown/save", { method: "POST", body: { documentId, text } }),
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
  /** ★ **비밀정보로 보이는 것**(2026-08-22). 회사 문서 반입 창구는 둘이고
   *  (`/api/upload/auto` · `/api/memory/ingest-file`) **둘 다** 이 검사를 지난다.
   *  ⚠ 값이 있으면 **화면이 반드시 사람에게 보여야 한다** — 서버만 알고 사람은 모르면
   *    「잣대 두 벌」이 표시 층에 그대로 남는다(2026-08-22 2라운드 검토관 [중]).
   *  ⚠ 원본 값은 안 담는다(masked) — 경고하려다 유출하면 안 된다. */
  비밀경고?: { kind: string; masked: string }[];
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
  // ⚠ 서버(memory.ts listMemoryDocuments)와 실화면(mydocs 영역 그룹·등급 글자)은 이 둘을 쓰는데
  //   여기 선언에만 빠져 있었다 — 세 곳 중 한 곳만 어긋난 자리다(설계관 2026-08-21 적발).
  //   window.gijo.*가 any라 tsc도 clientglobals.test도 못 잡는 부류라 손으로 맞춰 둔다.
  category?: string | null;   // 업무영역 — 회사 지식 목록의 🗂 그룹 머리
  grade?: string | null;      // 열람 등급 O/S/C
}

/** 반입 영수증 — **넣은 사실**의 기록. 파일 내용이 아니다.
 *  ⚠ 서버(`uploadreceipt.ts`)의 `영수증` 인터페이스와 **짝**이다. 한쪽만 고치면 어긋난다 —
 *    바로 위 MemoryDocument가 세 곳 중 한 곳만 어긋났던 전례가 있어 여기 적어 둔다. */
export interface UploadReceipt {
  id: string;
  filename: string;
  uploadedBy?: string;
  uploadedAt: string;
  kind: string;      // document|guideline|vulnreport|securitylog|opsreport|sbom|asset|log|unknown
  routedTo: string;  // memory|vulnscan|analysis|sbom|product-manual|decision
  decidedBy?: "auto" | "user";  // 갈래를 누가 정했나
  category?: string;
  originalSaved: boolean;
  mdSaved: boolean;
  ingested: boolean;
  bytes?: number;
  detail?: string;
  note?: string;
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
  // 내보내기(2026-08-21) — 서버가 base64로 문서를 만들어 준다(렌더러가 blob 저장). 문서핵심④.
  // ⚠ **html이 2026-08-22에 추가됐다** — 우리가 세 곳에 「.md/HTML/PDF/워드」로 약속해 두고
  //   HTML만 빠져 있었다. md는 본문 그대로라 서버가 필요 없다(클라가 만든다).
  export: (id: string, fmt: "docx" | "pdf" | "html") =>
    request<{ fileName: string; mime: string; base64: string }>(`/api/personaldocs/${encodeURIComponent(id)}/export?fmt=${fmt}`),

  // ── 첨부(캡처) — 우리가 약속한 「화면 캡처 Ctrl+V 삽입」 ──────────────────────
  // ⚠ 본문에 그림을 박지 않는다: 캡처 1장이 본문 상한의 약 71%라 2장이 원리상 불가하고,
  //   지식 인입기가 「글자가 아니다」로 거절해 저장이 실패한다. 파일은 디스크, 본문엔 표기만.
  files: (id: string) =>
    request<{ files: DocFile[]; 장수상한: number }>(`/api/personaldocs/${encodeURIComponent(id)}/files`),
  addFile: (id: string, b: { name: string; mime: string; content: string }) =>
    request<{ ok: boolean; file: DocFile; 표기: string }>(`/api/personaldocs/${encodeURIComponent(id)}/files`, { method: "POST", body: b }),
  /** 그림 바이트 — 렌더러의 `<img src>`에는 토큰을 못 붙이므로 받아서 data URL로 만든다. */
  readFile: (fileId: string) =>
    request<{ mime: string; name: string; content: string }>(`/api/personaldocs/file/${encodeURIComponent(fileId)}`),
  removeFile: (fileId: string) =>
    request<{ ok: boolean }>(`/api/personaldocs/file/${encodeURIComponent(fileId)}`, { method: "DELETE" }),

  // ── 버전 이력 — 약속 목록의 「문서 이력」. 고치다 날린 글을 되찾는 자리 ────────
  versions: (id: string) =>
    request<{ versions: DocVersion[]; 보존판수: number }>(`/api/personaldocs/${encodeURIComponent(id)}/versions`),
  versionBody: (versionId: number) =>
    request<{ title: string; body: string; savedAt: string }>(`/api/personaldocs/version/${versionId}`),
};

/** 문서 첨부(캡처) — 서버 `docattach.ts`의 `첨부`와 짝이다. 한쪽만 고치면 어긋난다. */
export interface DocFile {
  id: string; docId: string; name: string; mime: string; bytes: number; createdAt: string;
}
/** 문서의 한 판 — 목록에는 본문을 안 싣는다(20만 자를 목록에 실을 이유가 없다). */
export interface DocVersion {
  id: number; docId: string; title: string; savedAt: string; savedBy?: string; 글자수: number;
}

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
