// engine/memory.ts — 장기 기억(RAG). 로컬LLM_프로젝트_가이드.md 6.2절 "1차: RAG" 구현체.
// 서버가 LanceDB를 단독 소유하므로 여러 클라이언트가 같은 지식 베이스를 공유해서 질의한다.
// (용어 정리 2026-07-16: RAG/LanceDB=장기 기억, 대화 이력=단기 기억(llm.ts), 파인튜닝=학습.
//  예전 문서에는 RAG가 "단기 기억"으로 적혀 있었다 — 업계 통념에 맞춰 뒤집었다.)

import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import * as lancedb from "@lancedb/lancedb";
import { rewriteForSearch } from "./searchrewrite";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { embed, chat } from "./llm";
import { isBinaryLikeChunk } from "./ragsanitize";
import { db, migrate } from "../db";
import { clearanceOf, gradeOf, blockedGrades } from "./grades";
import { currentViewer } from "./viewerctx";
import { emitCollaboration } from "./collaboration";
import { gateUserInput } from "./gateway";
import {
  extractLexicalTerms,
  normalizeForSearch,
  buildFtsPlan,
  shouldRunLexical,
  fuseResults,
  isRelevant,
  applyCategoryBoost,
  applyOriginBoost,
  categoryForScreen,
  categoryForRole,
  fuseVariantVectors,
  CATEGORIES,
  REWRITE_RANK_PENALTY,
  type Category,
  type FusedChunk,
  type VariantHit,
} from "./hybridsearch";

// 문서 단위 메타데이터(업로드 시각·원본 경로)는 SQLite에 둔다 — LanceDB 스키마는 건드리지 않는다.
migrate("memory_documents-uploadedBy", "ALTER TABLE memory_documents ADD COLUMN uploadedBy TEXT"); // 작업 귀속(누가 올렸나) 표시용(2026-07-25)
migrate("memory_documents-category", "ALTER TABLE memory_documents ADD COLUMN category TEXT"); // 업무영역 5종 — 화면 맥락 검색용(2026-07-25 RAG 전면 검토)
// origin: 'builtin'(제품 내장 = docs-manifest 코퍼스) vs null(고객 업로드·데이터). 검색에서 우리
// 질문에 우리 지식을 먼저 세우는 신호(2026-08-10 ①ⓑ). ⚠ 검색 때마다 경로를 재판정하지 않고 이 칸만 읽는다
// — sourcePath는 인입한 기계의 절대경로라 기계마다 다르다(Mac 경고). origin은 한 번 유도해 칸에 굳힌다.
migrate("memory_documents-origin", "ALTER TABLE memory_documents ADD COLUMN origin TEXT");
const upsertDocMetaStmt = db.prepare(
  `INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt, uploadedBy, category, origin)
   VALUES (@documentId, @scope, @chunks, @embeddingModel, @sourcePath, @ingestedAt, @uploadedBy, @category, @origin)
   ON CONFLICT(documentId) DO UPDATE SET
     scope=excluded.scope, chunks=excluded.chunks, embeddingModel=excluded.embeddingModel,
     sourcePath=COALESCE(excluded.sourcePath, memory_documents.sourcePath), ingestedAt=excluded.ingestedAt,
     uploadedBy=COALESCE(excluded.uploadedBy, memory_documents.uploadedBy),
     category=COALESCE(excluded.category, memory_documents.category),
     origin=COALESCE(excluded.origin, memory_documents.origin)`
);
/** origin='builtin'인 문서 id 집합 — 검색 재정렬용. 한 번 조회해 부스트에 쓴다. */
const builtinDocIdsStmt = db.prepare("SELECT documentId FROM memory_documents WHERE origin = 'builtin'");
export function builtinDocumentIds(): Set<string> {
  try {
    return new Set((builtinDocIdsStmt.all() as { documentId: string }[]).map((r) => r.documentId));
  } catch {
    return new Set();
  }
}
/** 소급 표시 — 이미 인입된 문서(다음 기동에 해시가 같아 skip되는 것)의 origin을 'builtin'으로 굳힌다.
 *  docsbundle이 매 기동에 매니페스트 전체로 부른다(idempotent). ⚠ 189행은 skip되면 안 돌아
 *  「앞으로 것부터」가 번들엔 영영 안 온다(2026-08-10 실측) — 소급이 유일한 경로다. */
const markBuiltinStmt = db.prepare("UPDATE memory_documents SET origin='builtin' WHERE documentId = ? AND (origin IS NULL OR origin <> 'builtin')");
export function markDocumentsBuiltin(documentIds: string[]): number {
  let n = 0;
  try {
    db.transaction((ids: string[]) => {
      for (const id of ids) n += markBuiltinStmt.run(id).changes;
    })(documentIds);
  } catch (err) {
    console.warn(`[memory] 내장 표시 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  return n;
}
const getDocMetaStmt = db.prepare("SELECT * FROM memory_documents WHERE documentId = ?");
const deleteDocMetaStmt = db.prepare("DELETE FROM memory_documents WHERE documentId = ?");
const setDocClassStmt = db.prepare("UPDATE memory_documents SET docClass = ? WHERE documentId = ?");

// ── 문서 ↔ 자산 연결 ──────────────────────────────────────────────────────
// "이 보고서는 어느 자산 것인가". 리포트를 올려 자산을 등록하는 **그 순간**에 적어 둔다 —
// 그때는 문서와 자산을 둘 다 확실히 알고 있다(ingestreport가 assetIds를 들고 있다).
// 나중에 자산 이름으로 물으면 이 연결로 그 보고서만 정확히 꺼낸다(느슨한 검색이 아니다).
const setDocAssetsStmt = db.prepare("UPDATE memory_documents SET assetIds = ? WHERE documentId = ?");
const docsByAssetStmt = db.prepare(
  "SELECT documentId, sourcePath, assetIds FROM memory_documents WHERE assetIds IS NOT NULL AND assetIds <> ''"
);

/** 문서에 이 자산들이 담겼다고 적는다. 빈 목록이면 아무것도 하지 않는다(빈 값으로 덮지 않는다). */
export function linkDocumentToAssets(documentId: string, assetIds: string[]): void {
  const ids = (assetIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!documentId || ids.length === 0) return;
  try {
    // 이미 이어 둔 것이 있으면 합친다 — 같은 문서를 두 번 올려도 앞의 연결을 잃지 않는다.
    const 기존 = getDocumentAssetIds(documentId);
    const 합 = Array.from(new Set([...기존, ...ids]));
    setDocAssetsStmt.run(JSON.stringify(합), documentId);
  } catch {
    /* 연결을 못 적어도 문서 인입 자체는 성공으로 둔다 */
  }
}

/** 그 문서에 담긴 자산 id들. */
export function getDocumentAssetIds(documentId: string): string[] {
  try {
    const row = getDocMetaStmt.get(documentId) as { assetIds?: string | null } | undefined;
    const raw = row?.assetIds;
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** 이 자산이 담긴 문서들. 자산 이름으로 물었을 때 그 보고서만 정확히 꺼내는 용도. */
export function documentsForAsset(assetId: string): { documentId: string; sourcePath: string | null }[] {
  if (!assetId) return [];
  try {
    const rows = docsByAssetStmt.all() as { documentId: string; sourcePath: string | null; assetIds: string }[];
    return rows
      .filter((r) => {
        try {
          const ids = JSON.parse(r.assetIds);
          return Array.isArray(ids) && ids.includes(assetId);
        } catch { return false; }
      })
      .map((r) => ({ documentId: r.documentId, sourcePath: r.sourcePath }));
  } catch {
    return [];
  }
}

// ── 등급 차단 (N2SF) ──────────────────────────────────────────────────────
// 누가 묻는지에 따라 **검색에서 아예 빠지는** 문서를 정한다. engine/grades.ts 참고.
//
// ⚠ viewer를 안 넘긴 호출은 어떻게 되나: **아무것도 안 가린다**(지금까지와 동일).
//   여기서 "모르면 전부 막기"로 하면, viewer를 아직 안 흘리는 내부 호출(도구·브리핑 등)이
//   한꺼번에 답을 못 하게 된다 — 기능이 통째로 죽는 것을 '보안'이라 부를 수는 없다.
//   대신 **사람이 묻는 입구(대화·디스패치)에서는 viewer를 반드시 넘긴다**. 그게 사람에게
//   자료가 닿는 길이고, 시험이 그 배관을 지킨다(gradeblock.test.ts).
export interface Viewer {
  userId?: string | null;
  clearance?: string | null;
  // 권한 — 요청 파이프라인이 admin 전용 도구(requiredRole)를 대화창에서 라우팅할 수 있게 실어 나른다.
  //   없으면 admin 도구는 목록에서 숨는다(안전 기본값). 2026-08-04: 첫 admin 전용 도구
  //   (지식 번들 반입)가 대화창에서 안 불리던 것을 E2E가 잡아 추가.
  role?: string | null;
}

const gradedDocsStmt = db.prepare("SELECT documentId, grade FROM memory_documents");

/** 이 사람이 못 보는 문서 id들. viewer가 없으면 빈 배열(가리지 않음). */
export function hiddenDocIds(viewer?: Viewer): string[] {
  if (!viewer) return [];
  const 열람 = clearanceOf(viewer.clearance);
  const 막힌등급 = new Set(blockedGrades(열람));
  if (막힌등급.size === 0) return [];
  const rows = gradedDocsStmt.all() as { documentId: string; grade: string | null }[];
  return rows.filter((r) => 막힌등급.has(gradeOf(r.grade))).map((r) => r.documentId);
}

// LanceDB where/delete 절에 문자열 리터럴로 들어가는 documentId(파일명)의 작은따옴표를 이스케이프.
function escapeLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

const DB_PATH = process.env.GIJO_MEMORY_DB_PATH ?? path.join("data", "memory.lancedb");
const TABLE_NAME = "documents";
const CHUNK_SIZE = 800;

// 경로 기반 인입(/api/memory/ingest)은 memory.html의 "서버에 이미 있는 파일 경로로 직접 수집" 기능용
// — 예시가 "data/docs/incident-policy.txt"이듯 서버 data 디렉터리 안의 문서를 가리키는 용도다.
// 로그인만 하면(관리자 권한 불필요) 호출되는데 과거엔 경로 제한이 없어, 서버가 읽을 수 있는 임의
// 절대경로를 인입한 뒤 "원본까지 삭제"로 지우면 임의 파일 삭제까지 가능했다(2026-07-19 발견·차단).
const INGEST_ROOT = path.resolve(process.env.GIJO_INGEST_ROOT ?? "data");
function assertWithinIngestRoot(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (resolved !== INGEST_ROOT && !resolved.startsWith(INGEST_ROOT + path.sep)) {
    throw new Error(`허용된 경로(${INGEST_ROOT}) 밖의 파일은 인입할 수 없습니다`);
  }
  return resolved;
}
const CHUNK_OVERLAP = 100;

export interface IngestResult {
  documentId: string;
  chunks: number;
  embeddingModel: string;
  scope: string;
  docClass?: string; // classify=true로 수집 시 Scan·Analyze Agent가 판별한 분류(매뉴얼/보고서/정책/기타)
  linkedProduct?: string; // '매뉴얼'로 분류돼 기존 보안제품에 자동 연결됐으면 그 제품명
  category?: string; // 업무영역 5종(취약점·장비운영·사내규정·위협대응·일반) — 화면 맥락 검색·승인카드 표시용
}

// ── 문서 자동 분류 — 올린 문서를 Scan·Analyze Agent가 분석해 종류를 판별한다 ─────────
// Scan Agent(수집·초기 해석) → Analyze Agent(분류) 순으로 협업 피드에 흐름이 보인다.
// 파일명에 문서 종류가 명시돼 있으면(~매뉴얼, ~보고서, ~정책) 그것을 최우선으로 신뢰한다 —
// 사내 관례상 파일명 표기가 내용 단어 빈도보다 정확하다(실측: '정책 백업' 내용 때문에
// 운영매뉴얼이 '정책'으로 오분류). 파일명에 없을 때만 LLM으로 내용을 판단하고,
// LLM이 꺼져 있거나 파싱 실패면 완화된 파일명 휴리스틱으로 폴백한다(결정적·정직한 차선).
const DOC_CLASSES = ["매뉴얼", "보고서", "정책", "기타"] as const;

// 명시적 문서 종류 표기만 잡는 엄격판 — 매뉴얼 표기가 가장 강한 신호라 먼저 검사한다.
function classifyByFilenameStrict(documentId: string): string | null {
  // 릴리즈노트·장애처리(트러블슈팅) 문서는 제품 운영 문서라 매뉴얼 부류로 묶는다 — 보안제품 자동 연결 대상.
  if (/매뉴얼|manual|가이드|guide|릴리즈|release\s?note|장애처리|트러블슈팅|troubleshoot|절차/i.test(documentId)) return "매뉴얼";
  if (/보고서|report|동향|현황/i.test(documentId)) return "보고서";
  if (/정책|지침|규정|policy|표준/i.test(documentId)) return "정책";
  return null;
}

// 내용 기반 결정적 힌트 — 파일명에 신호가 없을 때 LLM보다 먼저 시도한다. 문서 첫 부분(2000자)에서
// 부류별 강한 표지를 세어, 한 부류만 뚜렷하면 그 부류로 확정한다(둘 이상 경합/전무면 null → LLM).
// 근거: LLM 단독 분류가 흔들려 같은 문서가 회차마다 기타/정책/보고서로 갈렸다(2026-07-23 실측).
export function classifyByContentHint(text: string): string | null {
  const head = text.slice(0, 2000);
  const score = {
    매뉴얼: (head.match(/사용법|설정 방법|메뉴 경로|버튼|클릭|화면에서|명령어|로그 필드|릴리즈|장애처리|트러블슈팅/g) ?? []).length,
    보고서: (head.match(/동향|현황|분석 결과|통계|추이|전망|사례 분석/g) ?? []).length,
    정책: (head.match(/지침|규정|준수|표준|의무|금지|승인 절차|인증기준/g) ?? []).length,
  };
  const sorted = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] >= 3 && sorted[0][1] >= sorted[1][1] * 2) return sorted[0][0];
  return null;
}

function classifyByFilename(documentId: string): string {
  return (
    classifyByFilenameStrict(documentId) ??
    (/동향|현황|분석/i.test(documentId) ? "보고서" : /표준/i.test(documentId) ? "정책" : "기타")
  );
}

// ── 업무영역(category) 분류 — 화면 맥락 검색의 축 (2026-07-25 RAG 전면 검토) ─────────
// docClass(문서 형태: 매뉴얼/보고서/…)와 별개 축이다. docClass는 제품 자동 연결 등 기존
// 동작에 계속 쓰고, category는 "무슨 업무 자료인가"로 검색 순위에 쓴다.
// 결정적 규칙을 먼저 — 같은 파일은 언제나 같은 결과가 나와야 하고, 인입 경로(업로드 라우팅)가
// 이미 답을 아는 경우가 많다. LLM은 규칙이 못 정할 때만 부른다.

// 내용 신호 점수 — 4개 영역별 도메인 어휘 등장 횟수(선두 2000자). 규칙 분류와
// "LLM에게 물을 가치가 있는가" 판단(신호 전무면 묻지 않음)에 함께 쓴다.
function categorySignalScores(text: string): Record<Exclude<Category, "일반">, number> {
  const head = text.slice(0, 2000);
  return {
    // 2026-08-07 보강: 대량 반입 실측에서 「방화벽 정책 변경 절차 + 피싱 대응」 메모가
    //   신호 1점씩만 나와 규칙이 확신을 못 하고 LLM으로 넘어갔고, 7B가 「취약점」이라 답했다.
    //   ⚠ 프롬프트를 고치지 않는다(이 크기 모델에 규칙을 더해 행동을 고치려는 시도는 반복 실패).
    //   **흔한 보안 낱말을 신호에 넣어 규칙이 더 자주 스스로 답하게** 한다.
    취약점: (head.match(/취약점|CVE-\d{4}|CVSS|위험도|조치\s*(기한|방안)|스캔|패치|익스플로잇|EPSS|KEV/g) ?? []).length,
    장비운영: (head.match(/설정\s*방법|명령어|콘솔|장비|펌웨어|유지보수|정기\s*점검|로그\s*필드|방화벽|스위치|라우터|IPS|IDS|WAF|EDR|백업\s*절차/g) ?? []).length,
    // ⚠ 「정책」 단독은 안 센다(검토관 2026-08-07) — 방화벽·WAF 매뉴얼에 "정책"이 반복돼
    //   장비 문서가 사내규정으로 확신 확정되는 길이었다. 수식어가 붙은 꼴만 규정 신호다.
    사내규정: (head.match(/규정|지침|준수|의무|금지|승인\s*절차|보관\s*(기간|의무)|법령|정책\s*(수립|문서|위반)|내부\s*통제/g) ?? []).length,
    위협대응: (head.match(/공격|침해|탐지\s*룰|시그니처|차단|대응\s*절차|IOC|악성|피싱|랜섬웨어|멀웨어|스미싱|디도스|DDoS/g) ?? []).length,
  };
}

/** 파일명·내용 선두로 업무영역을 정한다. 확신이 없으면 null(호출자가 LLM 또는 기본값). */
export function categorizeByRules(documentId: string, text: string): Category | null {
  const name = documentId;
  // 순서 중요 — 더 구체적인 신호를 먼저 본다.
  if (/취약점|점검\s*결과|vuln|CVE-\d{4}|스캔|pentest|모의해킹/i.test(name)) return "취약점";
  if (/정책|지침|규정|표준|준수|컴플라이언스|policy|compliance|개인정보|isms/i.test(name)) return "사내규정";
  if (/랜섬웨어|침해|위협|공격|탐지|대응|ioc|siem|snort|cti|threat|incident/i.test(name)) return "위협대응";
  if (/매뉴얼|manual|장비|방화벽|스위치|유지보수|점검표|릴리즈|release|장애처리|트러블슈팅|troubleshoot/i.test(name)) return "장비운영";
  // 내용 신호 — 파일명이 무정보일 때.
  const score = categorySignalScores(text);
  const sorted = (Object.entries(score) as [Category, number][]).sort((a, b) => b[1] - a[1]);
  // 최고점이 2점 이상이고 2위와 차이가 나야 확신으로 본다 — 억지 분류가 오분류보다 나쁘다.
  if (sorted[0][1] >= 2 && sorted[0][1] > sorted[1][1]) return sorted[0][0];
  return null;
}

/** 업무영역 확정 — 규칙 → (허용 시) LLM → "일반". LLM 실패해도 인입은 계속된다. */
// export는 시험용이다(2026-08-07 검토관: 분류 거부 계약이 소스 문자열 검사로만 증명돼 있었다)
export async function categorizeDocument(documentId: string, text: string, allowLlm: boolean): Promise<Category> {
  const byRule = categorizeByRules(documentId, text);
  if (byRule) return byRule;
  if (!allowLlm) return "일반";
  // 보안 도메인 신호가 전무한 문서(회의 메모 등)는 LLM에게 묻지 않는다 — 근거 없는 질문에
  // 7B가 아무 영역이나 지어낸다(2026-07-25 E2E 실측: 회의 메모→"장비운영"). 코드로 차단.
  const scores = Object.values(categorySignalScores(text));
  if (scores.every((s) => s === 0)) return "일반";
  try {
    const reply = await chat({
      agentId: "analysis",
      message: [
        "다음 문서가 어느 업무 자료인지 아래 5가지 중 정확히 한 단어로만 분류하라. 다른 텍스트 없이 그 한 단어만 출력한다.",
        "선택지: 취약점(점검 결과·CVE·조치), 장비운영(장비 매뉴얼·설정·유지보수), 사내규정(정책·지침·컴플라이언스), 위협대응(공격 탐지·침해 대응·룰), 일반(그 외)",
        `파일명: ${documentId}`,
        `내용 일부: ${text.slice(0, 800)}`,
      ].join("\n"),
      // trusted — 문서 내용이 들어가지만 '사용자 지시'가 아니라 자료다. 보안 문서에는 '탈옥·인젝션' 같은 낱말이 당연히 들어 있어, 입력 차단으로 막으면 정상 문서 인입이 통째로 실패한다. 자료 안의 지시를 따르지 않게 하는 것은 프롬프트 구조(자료/지시 분리)의 몫이다.
      trusted: true,
    });
    const 고른것 = CATEGORIES.find((c) => reply.includes(c));
    if (!고른것 || 고른것 === "일반") return "일반";
    // ★ **근거 없는 분류는 받지 않는다**(2026-08-07 실측): 방화벽 정책·피싱 대응 메모를
    //   7B가 「취약점」이라고 답했는데, 그 문서에 취약점 신호는 **0점**이었다.
    //   분류가 틀리면 나중에 그 문서를 못 찾고 화면별 검색 우선순위도 어긋난다.
    //   모델이 고른 영역의 신호가 하나도 없으면 **일반**으로 둔다 — 모르는 것은 모른다고 두는 편이
    //   틀린 이름표보다 낫다(억지 분류가 오분류보다 나쁘다는 위 규칙과 같은 계열).
    if ((categorySignalScores(text) as Record<string, number>)[고른것] === 0) {
      console.warn(`[memory] 분류 거부 — 모델이 「${고른것}」이라 했지만 그 신호가 0점: ${documentId}`);
      return "일반";
    }
    return 고른것;
  } catch {
    return "일반";
  }
}

async function classifyDocument(documentId: string, text: string): Promise<string> {
  emitCollaboration({ from: "scan", to: "analysis", message: `문서 분석·분류 요청: ${documentId}` });
  let docClass: string;
  const byName = classifyByFilenameStrict(documentId) ?? classifyByContentHint(text);
  if (byName) {
    docClass = byName;
  } else {
    try {
      const reply = await chat({
        agentId: "analysis",
        message: [
          "다음 문서를 아래 4가지 중 정확히 한 단어로만 분류하라. 다른 텍스트 없이 그 한 단어만 출력한다.",
          "선택지: 매뉴얼(제품·시스템 사용법/운영/로그 설명), 보고서(동향·현황·분석 결과), 정책(사내 규정·지침·표준), 기타",
          `파일명: ${documentId}`,
          `내용 일부: ${text.slice(0, 800)}`,
        ].join("\n"),
        // trusted — 문서 내용이 들어가지만 '사용자 지시'가 아니라 자료다. 보안 문서에는 '탈옥·인젝션' 같은 낱말이 당연히 들어 있어, 입력 차단으로 막으면 정상 문서 인입이 통째로 실패한다. 자료 안의 지시를 따르지 않게 하는 것은 프롬프트 구조(자료/지시 분리)의 몫이다.
        trusted: true,
      });
      docClass = DOC_CLASSES.find((c) => reply.includes(c)) ?? classifyByFilename(documentId);
    } catch {
      docClass = classifyByFilename(documentId);
    }
  }
  emitCollaboration({
    from: "analysis",
    to: "orchestrator",
    message: `문서 분류 완료: ${documentId} → ${docClass}${byName ? " (파일명 표기 근거)" : ""}`,
  });
  return docClass;
}

// '매뉴얼'로 분류된 문서를 기존 보안제품에 자동 연결한다(새 제품 생성 없음 — 등록부 오염 방지).
// 연결되면 제품 화면·탐색기의 매뉴얼 배지에 바로 반영되고, 협업 피드로 알린다.
async function linkManualToProduct(documentId: string): Promise<string | undefined> {
  try {
    const { attachManualToExistingProduct } = await import("./securityproducts.js");
    const linked = attachManualToExistingProduct(documentId, documentId, "문서·분석 자동 연결");
    if (linked) {
      emitCollaboration({
        from: "analysis",
        to: "orchestrator",
        message: `매뉴얼 자동 연결: ${documentId} → 보안제품 '${linked.productName}' (${linked.kind === "logManual" ? "로그 매뉴얼" : "제품 매뉴얼"})`,
      });
      return linked.productName;
    }
  } catch (err) {
    console.warn(`[memory] 매뉴얼-보안제품 연결 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  return undefined;
}

// scope: "global"이면 모든 에이전트가 검색, 그 외에는 해당 agentId 전용 문서.
export const GLOBAL_SCOPE = "global";

interface MemoryRow {
  documentId: string;
  chunkIndex: number;
  text: string;
  scope: string;
  vector: number[];
  category?: string; // 업무영역 5종. 컬럼 추가(2026-07-25) 이전에 만들어진 조각은 없을 수 있다.
}

// PDF 추출물의 레이아웃 잡음을 지운다 — 페이지 번호 줄("- 134 -", "134"), 페이지마다 반복되는
// 머리글/바닥글은 임베딩에 잡음이고 청크 앞머리를 차지해 검색 품질을 떨어뜨린다(FOCS 매뉴얼 실측).
export function cleanExtractedText(text: string): string {
  const lines = text.split("\n");
  // 3회 이상 반복되는 짧은 줄(머리글/바닥글 후보) 수집 — 문서 제목이 매 페이지 반복되는 패턴.
  const freq = new Map<string, number>();
  for (const l of lines) {
    const t = l.trim();
    if (t.length > 0 && t.length <= 60) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const repeated = new Set([...freq.entries()].filter(([t, n]) => n >= 3 && !/[.다요]$/.test(t)).map(([t]) => t));
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (/^-?\s*\d{1,4}\s*-?$/.test(t)) return false; // 페이지 번호 줄
    if (/^(page|페이지)\s*\d+/i.test(t)) return false;
    if (repeated.has(t)) return false;
    return true;
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

// 구조 인지 청킹 — 고정 길이로 자르면 제목·문장 한가운데가 잘려 검색 1위 청크에 정작 본문이
// 없는 문제가 실측됐다(2026-07-23: "장애 대응 표준 절차" 제목 직후 절단). 문단(빈 줄)과
// 제목 줄(마크다운 #, "1." 번호, "제N장")을 경계로 블록을 만들고, 블록을 순서대로 담아
// size를 넘기 전에 끊는다. 블록 하나가 size보다 크면 문장 경계로 나눈다.
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  // HTML 주석(<!-- … -->)은 내용이 아니라 유지보수 메모다 — 색인에서 뺀다(2026-08-17, max 발견#3:
  // 문서의 '이 문서를 늘릴 때' 작성지침이 「유출 신고 며칠?」 답 상단으로 새어 나왔다). 주석으로
  // 감싸면 원문엔 남지만 검색·답변엔 안 든다. 문서에 진짜 필요한 표식(HTML 주석)만 지우므로 안전하다.
  const cleaned = cleanExtractedText(text.replace(/<!--[\s\S]*?-->/g, ""));
  if (!cleaned.trim()) return [];

  // 1) 블록 분해: 빈 줄 기준 문단 + 제목 줄은 다음 문단과 붙인다(제목만 남는 청크 방지).
  const rawBlocks = cleaned.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (const b of rawBlocks) {
    const isHeading = /^(#{1,6}\s|\d+(\.\d+)*[.)]\s|제\s?\d+\s?[장절조]|[■□◆▶●○]\s)/.test(b) && b.length <= 80;
    if (isHeading && blocks.length >= 0) {
      // 제목은 버퍼에 두었다가 다음 블록 앞에 붙인다.
      blocks.push(b + "\n");
    } else if (blocks.length > 0 && blocks[blocks.length - 1].endsWith("\n")) {
      blocks[blocks.length - 1] += b;
    } else {
      blocks.push(b);
    }
  }

  // 2) 큰 블록은 문장 경계로 쪼갠다.
  const units: string[] = [];
  for (const b of blocks) {
    if (b.length <= size) {
      units.push(b);
      continue;
    }
    let buf = "";
    for (const sent of b.split(/(?<=[.!?다요]\s)|(?<=\n)/)) {
      if (buf.length + sent.length > size && buf.trim()) {
        units.push(buf.trim());
        buf = "";
      }
      buf += sent;
    }
    if (buf.trim()) units.push(buf.trim());
  }

  // 3) 블록을 담아 청크 구성 — 넘치기 전에 끊고, 직전 꼬리(overlap)를 이어붙여 맥락을 잇는다.
  const chunks: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + u.length + 2 > size) {
      chunks.push(cur.trim());
      cur = cur.slice(-overlap) + "\n" + u;
    } else {
      cur = cur ? cur + "\n\n" + u : u;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  // 잡음만 남은 초단문 청크 제거 — 단, 문서 자체가 짧으면(전부 걸러지면) 원문을 보존한다.
  // 바이너리꼴 조각(PDF 압축 스트림 등)도 여기서 거른다(2026-08-09) — 인입돼 봤자 검색
  // 상위를 차지해 진짜 근거를 밀어낸다(실사고: WizCLM 비교 1순위가 base64 덩어리).
  const filtered = chunks.filter((c) => c.length >= 20 && !isBinaryLikeChunk(c));
  if (filtered.length === 0 && cleaned.trim().length > 0 && !isBinaryLikeChunk(cleaned)) return [cleaned.trim().slice(0, size)];
  return filtered;
}

/** 글자로 그냥 읽으면 안 되는(추출이 필요한) 형식 — 그대로 읽으면 압축 바이트가 지식이 된다. */
const 추출필요 = new Set([".pdf", ".hwp", ".hwpx", ".docx", ".doc", ".pptx", ".xlsx"]);

/**
 * 위생 필터를 거치기 **전** 원문이 몇 조각짜리인지 — 인입 품질 판정의 분모.
 * 걸러진 뒤(chunks)와 비교해 "거의 다 버려졌다"면 그 문서는 읽지 못한 것이다.
 */
function 대략조각수(raw: string): number {
  return Math.max(1, Math.ceil((raw ?? "").trim().length / CHUNK_SIZE));
}

export async function ingestDocument(filePath: string, scope: string = GLOBAL_SCOPE, classify = false, uploadedBy?: string): Promise<IngestResult> {
  const resolved = assertWithinIngestRoot(filePath);
  const ext = path.extname(resolved).toLowerCase();
  // ⚠ 실사고(2026-08-08): 여기서 PDF를 **UTF-8 글자로 그대로 읽고 있었다.** 그 결과 압축
  //   스트림 바이트가 "지식"으로 들어가 저장소 조각의 73%(Tenable 매뉴얼 4종 등)가 사람이
  //   읽을 수 없는 쓰레기였다. 검색은 그 쓰레기를 상위로 올려 진짜 근거를 밀어냈다.
  //   업로드 경로(/api/memory/ingest-file)는 추출기를 거치는데 경로 인입만 빠져 있었다.
  if (추출필요.has(ext)) {
    const buf = await fs.readFile(resolved);
    const { extractDocumentText } = await import("./dataset.js");
    const text = await extractDocumentText(path.basename(resolved), buf.toString("base64"));
    if (!text.trim()) throw new Error(`문서에서 텍스트를 추출하지 못했습니다: ${path.basename(resolved)}`);
    return ingestText(path.basename(resolved), text, scope, resolved, classify, uploadedBy);
  }
  const raw = await fs.readFile(resolved, "utf-8");
  return ingestText(path.basename(resolved), raw, scope, resolved, classify, uploadedBy);
}

// 이미 추출된 텍스트를 지식 베이스에 직접 넣는다 — 파일 업로드(PDF/HWPX 추출 후)나
// 서버 밖 클라이언트에서 올린 문서용. ingestDocument는 파일을 읽어 이 함수로 위임한다.
export async function ingestText(documentId: string, raw: string, scope: string = GLOBAL_SCOPE, sourcePath?: string, classify = false, uploadedBy?: string, category?: string, origin?: string): Promise<IngestResult> {
  const chunks = chunkText(raw);
  // ⚠ 읽을 수 없는 문서를 **조용히 받아들이지 않는다**(2026-08-08 실사고).
  //   저장소 조각의 73%가 PDF 압축 바이트였는데, 숫자로는 "지식 5,631조각"이라 건강해
  //   보였다. 아무도 내용을 안 봤기 때문에 몇 달을 몰랐다. chunkText가 쓰레기를 걸러
  //   내므로 **걸러낸 뒤 남은 게 거의 없다면 그 문서는 못 읽은 것**이다 — 성공한 척하지 않는다.
  const 원문조각 = 대략조각수(raw);
  if (원문조각 >= 3 && chunks.length < 원문조각 * 0.2) {
    throw new Error(
      `문서를 읽지 못했습니다(${documentId}) — 내용이 글자가 아닌 것 같습니다. ` +
      `PDF·한글 문서는 텍스트 추출을 거쳐야 합니다. 추출 도구가 준비돼 있는지 확인하세요.`
    );
  }
  if (chunks.length === 0) return { documentId, chunks: 0, embeddingModel: "none", scope };

  // 인입 점검 — 문서에 AI를 조종하려는 지시문이 숨어 있는지 미리 본다.
  // **막지는 않는다**: 보안 회사 문서에는 공격 예시가 정당하게 실린다(레드팀 보고서·사례집).
  // 대신 담당자가 알 수 있게 기록한다. 실제 무력화는 검색 결과를 프롬프트에 실을 때
  // ragsanitize가 문장 단위로 처리한다(밖에서 받은 문서가 우리 AI를 바꾸는 것을 막는다).
  try {
    const { scanDocumentForInjection } = await import("./ragsanitize.js");
    const scan = scanDocumentForInjection(raw);
    if (scan.found > 0) {
      const { recordAudit } = await import("./audit.js");
      recordAudit({
        kind: "block", actor: uploadedBy ?? "system",
        action: `올린 문서에 숨은 지시문 ${scan.found}문장 발견(인입은 허용, 답변에는 반영 안 됨)`,
        target: documentId,
        detail: `유형: ${scan.labels.join(", ")}\n예: ${scan.samples.join(" / ")}`,
        result: "blocked",
      });
      console.warn(`[memory] ${documentId}: 숨은 지시문 ${scan.found}건 — ${scan.labels.join(", ")}`);
    }
  } catch {
    /* 점검 실패가 인입을 막지 않는다 */
  }

  // 업무영역 확정 — 인입 경로가 이미 아는 경우(취약점 리포트 라우팅 등) 그 값을 쓰고,
  // 모르면 규칙 → (사용자 업로드 경로에서만) LLM 순으로 정한다. 검색 순위(화면 맥락)에 쓰인다.
  const resolvedCategory: Category = CATEGORIES.includes(category as Category)
    ? (category as Category)
    : await categorizeDocument(documentId, raw, classify);

  // 대용량 문서(수백~수천 청크)를 한 번에 임베딩하면 임베딩 서버 요청이 제한시간(120s)을 넘겨
  // 통째로 실패(embed가 연결오류로 표기)한다. 배치로 나눠 각 요청이 시간 안에 끝나게 한다.
  // 또한 임베딩 서버가 불안정하거나(배치 토큰이 n_batch 초과 등) 큰 배치를 거부하면 배치 전체가
  // 실패해 문서가 조용히 인입 안 되는 문제가 있다(2026-07-20 실측: 다중 청크 배치는 빠르게 실패,
  // 단건은 성공). 그래서 배치 실패 시 청크 단위로 쪼개 재시도한다 — 건강할 땐 빠르게, 불안정할 땐
  // 견고하게(느리지만 반드시 들어가게).
  // 배치 8: 청크당 ~500토큰 × 8 ≈ 4천 토큰으로 임베딩 서버 batch 한도(8192토큰) 안에 들어간다.
  // 64로 보내면 요청당 ~3만 토큰이 되어 대용량 PDF(수천 청크)에서 임베딩 서버가 무응답으로
  // 빠지고 워치독 재기동까지 이어졌다(2026-07-23 실측: Tenable 가이드 1.9M자 인입 실패).
  const EMBED_BATCH = 8;
  // 임베딩 서버가 워치독으로 재기동되는 동안(~15초)의 일시 오류는 기다렸다 재시도한다 —
  // 수천 청크 인입 도중 한 번의 재기동으로 문서 전체가 실패하면 안 된다.
  // 테스트(vitest)는 임베딩 서버 부재를 의도적으로 시험하므로 재시도 없이 즉시 실패해야 한다
  // (재시도 대기 50초가 테스트 타임아웃(15s)을 넘겨 autoupload 테스트가 죽는 회귀 실측).
  const EMBED_RETRIES = process.env.VITEST ? 1 : Number(process.env.GIJO_EMBED_RETRIES ?? 5);
  const EMBED_RETRY_DELAY_MS = process.env.VITEST ? 0 : Number(process.env.GIJO_EMBED_RETRY_DELAY_MS ?? 10_000);
  const embedWithRetry = async (texts: string[]): Promise<number[][]> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < EMBED_RETRIES; attempt++) {
      try {
        return await embed(texts);
      } catch (err) {
        lastErr = err;
        if (attempt + 1 >= EMBED_RETRIES) break;
        console.warn(`[memory] 임베딩 일시 실패(시도 ${attempt + 1}/${EMBED_RETRIES}, ${texts.length}건) — ${EMBED_RETRY_DELAY_MS / 1000}초 후 재시도: ${err instanceof Error ? err.message : String(err)}`);
        await new Promise((resolve) => setTimeout(resolve, EMBED_RETRY_DELAY_MS));
      }
    }
    throw lastErr;
  };
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const slice = chunks.slice(i, i + EMBED_BATCH);
    try {
      const vecs = await embedWithRetry(slice);
      for (const v of vecs) vectors.push(v);
    } catch (batchErr) {
      if (slice.length === 1) throw batchErr; // 재시도까지 소진 — 임베딩 서버 자체 문제, 위로 던진다
      console.warn(`[memory] 배치 임베딩 실패(${slice.length}건) — 청크 단위로 재시도: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`);
      // 청크 사이 짧게 쉬어 동시에 도는 채팅 모델도 GPU 틈을 얻게 한다(2026-07-21 hang 연쇄 실측).
      for (const c of slice) {
        const v = await embedWithRetry([c]);
        vectors.push(v[0]);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    // 대용량 문서(수백 배치)에서도 다른 요청이 끼어들 틈을 준다.
    if (i > 0 && i % (EMBED_BATCH * 25) === 0) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const rows: MemoryRow[] = chunks.map((text, i) => ({ documentId, chunkIndex: i, text, scope, vector: vectors[i], category: resolvedCategory }));

  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  const records = rows as unknown as Record<string, unknown>[];
  if (names.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    // 기존 테이블이 현재 스키마와 호환되는지 확인하고, 두 가지 드리프트를 자가 복구한다:
    //  (1) 벡터 차원 불일치 — 임베딩 모델 교체. add()가 에러 대신 벡터를 기존 차원으로 잘라
    //      저장해버리므로(조용한 데이터 오염) 반드시 재생성한다.
    //  (2) 컬럼 드리프트 — scope 등 필드가 추가되기 전에 만들어진 옛 테이블. add()가
    //      "Found field not in schema" 스키마 에러로 거부한다.
    // 둘 다 기존 벡터를 그대로 쓸 수 없어 테이블을 재생성한다(문서만 다시 수집하면 됨).
    const existing = (await table.query().limit(1).toArray()) as MemoryRow[];
    const existingDim = existing[0]?.vector?.length;
    const dimDrift = existingDim !== undefined && existingDim !== vectors[0].length;
    const schemaDrift = existing[0] !== undefined && !("scope" in existing[0]);
    if (dimDrift || schemaDrift) {
      console.warn(
        `[memory] 지식 베이스 불일치로 재생성합니다 (기존 문서는 재수집 필요) — 차원드리프트=${dimDrift} 스키마드리프트=${schemaDrift}`
      );
      await db.dropTable(TABLE_NAME);
      await db.createTable(TABLE_NAME, records);
    } else {
      // ⚠ 스키마 보정은 **안전망 밖**에서 한다(2026-08-19 D6). Merge 트랜잭션이라 경쟁에 가장
      //   약한데, 예전엔 이게 실패하면 아래 catch가 「테이블을 버려라」로 이어졌다.
      //   컬럼 보정이 실패하면 이번 인입 한 건만 실패시키는 게 맞다 — 문서 한 건 < 지식 전체.
      await ensureCategoryColumn(table);
      // ⚠ lance는 커밋 경합 때 오류 문구에 대놓고 "retry"라고 적는다 — 3회 지수 백오프
      //   (embedWithRetry와 같은 모양). 이것만으로 재현된 commit-conflict 방아쇠가 닫힌다.
      let 마지막오류: unknown;
      for (let 시도 = 0; 시도 < 3; 시도++) {
        try {
          // 재인입 멱등성: 같은 documentId의 옛 청크를 먼저 지운다. 안 그러면 add만 해서 옛/새 청크가
          // 중복 누적된다(2026-07-25 실측: 같은 파일 재업로드/재시드가 KB에 중복 조각을 남김).
          await table.delete(`documentId = '${escapeLiteral(documentId)}'`);
          await table.add(records);
          // 새 조각을 전문 검색(BM25)에서도 찾을 수 있게 인덱스를 갱신한다.
          await refreshFtsIndex(table);
          마지막오류 = undefined;
          break;
        } catch (err) {
          마지막오류 = err;
          await new Promise((s) => setTimeout(s, 300 * 2 ** 시도));
        }
      }
      if (마지막오류 !== undefined) {
        // ★ 드롭 전에 **무엇을 버리는지 센다**(2026-08-19 D6). 예전엔 어떤 실패든 여기서
        //   테이블을 통째로 재생성해 — 방금 올린 문서 1건을 뺀 **모든 지식(실측 5,631조각)**이
        //   조용히 사라질 수 있었다. 자가복구는 「버릴 게 없을 때」만 한다.
        //   버릴 게 있으면 이번 인입만 실패시킨다(라우트가 400으로 정직하게 보고) —
        //   채팅·검색은 기존 지식으로 계속 돈다. 진짜 스키마 드리프트는 위 명시 검사가 이미 잡는다.
        const 남은 = new Set(
          ((await table.query().select(["documentId"]).limit(1_000_000).toArray()) as { documentId: string }[])
            .map((r) => r.documentId)
        );
        남은.delete(documentId);
        if (남은.size > 0) {
          console.error(`[memory] add() 3회 실패 — 기존 문서 ${남은.size}건이 있어 재생성하지 않고 이번 인입만 실패시킵니다`);
          throw 마지막오류;
        }
        console.warn(`[memory] add() 실패·기존 지식 0건 — 지식 베이스를 재생성합니다: ${마지막오류 instanceof Error ? 마지막오류.message : String(마지막오류)}`);
        await db.dropTable(TABLE_NAME);
        await db.createTable(TABLE_NAME, records);
      }
    }
  } else {
    await db.createTable(TABLE_NAME, records);
  }

  // 문서 메타데이터 기록(업로드 시각·원본 경로) — 목록/삭제 화면용. 실패해도 수집은 성공 처리.
  try {
    upsertDocMetaStmt.run({
      documentId,
      scope,
      chunks: chunks.length,
      embeddingModel: "local-embedding-server",
      sourcePath: sourcePath ?? null,
      ingestedAt: new Date().toISOString(),
      uploadedBy: uploadedBy ?? null, // 작업 귀속 — 누가 올렸는지(화면 표시용)
      category: resolvedCategory,
      origin: origin ?? null, // 'builtin'(제품 내장) vs null(고객 업로드) — ①ⓑ 검색 재정렬용
    });
  } catch (err) {
    console.warn(`[memory] 문서 메타데이터 기록 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 사용자 업로드 경로(classify=true)에서만 Scan·Analyze Agent 분류 실행 — 보안제품 매뉴얼 수집처럼
  // 종류가 이미 정해진 프로그램적 수집은 건너뛴다. 분류 실패해도 수집은 성공 처리.
  let docClass: string | undefined;
  let linkedProduct: string | undefined;
  if (classify) {
    try {
      docClass = await classifyDocument(documentId, raw);
      setDocClassStmt.run(docClass, documentId);
      if (docClass === "매뉴얼") linkedProduct = await linkManualToProduct(documentId);
    } catch (err) {
      console.warn(`[memory] 문서 분류 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 문서 반입 소식(2026-08-06) — 사람이 올린 문서(uploadedBy 있음)만 백그라운드로 세 줄 요약과
  // 온톨로지 접점을 만든다. docsbundle 같은 프로그램 수집은 uploadedBy가 없어 자연히 건너뛴다.
  // 실패해도 인입은 이미 성공 — 소식은 소식일 뿐, 여기서 죽지 않는다(동적 임포트 = 순환 차단).
  if (uploadedBy) {
    void import("./docdigest.js")
      .then((d) => d.makeDigest(documentId, raw, resolvedCategory))
      .catch((err) => console.warn(`[docdigest] 소식 생성 실패(${documentId}): ${err instanceof Error ? err.message : String(err)}`));
  }

  return { documentId, chunks: chunks.length, embeddingModel: "local-embedding-server", scope, docClass, linkedProduct, category: resolvedCategory };
}

// SQL 문자열 injection 방지 — scope는 LanceDB where 절에 문자열로 들어간다. 에이전트 id와
// "global"만 허용되는 값이지만 방어적으로 이스케이프한다.
function safeScope(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

// agentId를 주면 "그 에이전트 전용 문서 + 전역 문서"만 검색한다. 없으면(대시보드/오케스트레이터)
// 전역 문서만. 특정 에이전트에 귀속된 지식이 다른 에이전트로 새지 않도록 하는 게 목적.
// 벡터 검색은 관련이 없어도 "가장 가까운" 청크를 돌려준다. 그래서 "베트남 쌀국수 육수 내는 법"에도
// 보안 문서 조각이 딸려 나오고, 모델은 그걸 근거인 양 붙잡고 답한다(2026-07-19 실측: 그라운딩
// 전용 에이전트가 없는 사실을 지어냈다).
//
// 임계값은 실측으로 정했다. 사내 자료에 있는 질문 4개와 없는 질문 4개의 최근접 거리를 재보니
//   관련 있음: 0.503 ~ 0.775
//   관련 없음: 1.086 ~ 1.285
// 두 무리가 0.311만큼 떨어져 깨끗이 갈린다. 중간값 0.93보다 살짝 느슨한 0.95를 쓴다 —
// 애매하게 관련된 실제 질문을 막는 쪽보다, 무관한 잡음을 거르는 쪽이 목적이기 때문이다.
export const RAG_RELEVANCE_MAX_DISTANCE = 0.95;

export interface ScoredChunk {
  text: string;
  distance: number;
  documentId: string; // 근거(출처) 표시용 — 어느 문서의 조각인지
  lexicalHit?: boolean; // 질의의 코드(CVE·IW·U-01 등)가 이 조각에 글자 그대로 있었나
}

// LanceDB 테이블에 category 컬럼을 보장한다(2026-07-25 업무영역 축 추가). 기존 조각의
// 기본값은 '일반' — 운영 마이그레이션(tools/migrate-category)이 문서별로 재분류해 채운다.
// 프로세스당 한 번만 실제 확인한다(schema() 호출 절약).
let categoryColumnEnsured = false;
async function ensureCategoryColumn(table: lancedb.Table): Promise<void> {
  if (categoryColumnEnsured) return;
  const schema = await table.schema();
  if (!schema.fields.some((f) => f.name === "category")) {
    await table.addColumns([{ name: "category", valueSql: "'일반'" }]);
    console.log("[memory] 지식 베이스에 업무영역(category) 컬럼을 추가했습니다 — 기존 조각은 '일반'");
  }
  categoryColumnEnsured = true;
}

// 전문 검색(BM25) 인덱스는 한 번만 만들면 되지만, 프로세스가 뜬 뒤 첫 검색에서 확인한다.
// 실패해도 검색이 죽지 않게 플래그로 기억하고 벡터 단독으로 넘어간다.
let ftsIndexChecked = false;
let ftsIndexReady = false;
// 인덱스 옵션을 바꿀 때 이 문자열을 올리면 다음 기동의 첫 검색에서 한 번 재색인된다.
// 3세대(2026-08-09): 운영 인덱스가 lance 내부 오류(offset 초과)로 **깨져** optimize가 계속
// 실패했다 — 그 뒤 인입된 문서 전부가 글자 검색(BM25)에 빠져, WizCLM 비교가 근거 없이
// 지어지는 실사고의 뿌리였다. 세대를 올리면 다음 기동에서 깨진 인덱스를 버리고 다시 만든다.
const FTS_GENERATION = "3-rebuild-after-corruption";
const FTS_GEN_KEY = "memory:ftsIndexGeneration";
const getFtsGenStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setFtsGenStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

/**
 * text 컬럼에 전문 검색 인덱스를 보장한다. 토크나이저는 기본 "simple"을 쓴다 —
 * 한국어 형태소 분석기(lindera ko-dic)는 별도 모델 파일이 필요해 오프라인 번들에 부담이고,
 * 한국어 의미 검색은 벡터(bge-m3)가 이미 담당한다. BM25가 맡을 몫은 CVE·IW-32 같은
 * 영숫자 코드의 정확 매칭이라 simple 토크나이저로 충분하다.
 */
async function ensureFtsIndex(table: lancedb.Table): Promise<boolean> {
  if (ftsIndexChecked) return ftsIndexReady;
  ftsIndexChecked = true;
  try {
    const indices = await table.listIndices();
    const existing = indices.find((i) => i.columns.includes("text"));
    // withPosition(토큰 위치 저장)은 구문 검색의 전제다. 이 옵션 없이 만든 1세대 인덱스가 남아
    // 있으면 구문 검색이 조용히 빈 결과를 내므로, 세대를 app_state에 기록해 한 번만 교체한다
    // (프로세스 메모리에만 두면 재기동마다 대용량 재색인이 돌아 기동이 느려진다).
    const generation = getFtsGenStmt.get(FTS_GEN_KEY) as { value?: string } | undefined;
    if (!existing || generation?.value !== FTS_GENERATION) {
      if (existing) await table.dropIndex(existing.name);
      await table.createIndex("text", {
        config: lancedb.Index.fts({ lowercase: true, asciiFolding: true, withPosition: true }),
      });
      setFtsGenStmt.run(FTS_GEN_KEY, FTS_GENERATION);
      console.log("[memory] 전문 검색(BM25) 인덱스를 생성했습니다 — 코드·고유명사 정확 매칭 활성");
    }
    ftsIndexReady = true;
  } catch (err) {
    // 인덱스가 없어도 제품이 멈추면 안 된다 — 벡터 단독으로 계속 동작한다(기존 동작).
    console.warn(`[memory] 전문 검색 인덱스 준비 실패 — 벡터 검색만 사용합니다: ${err instanceof Error ? err.message : String(err)}`);
    ftsIndexReady = false;
  }
  return ftsIndexReady;
}

/**
 * 질의 계획을 LanceDB 전문 검색 객체로 조립한다.
 * 코드는 PhraseQuery로 토큰 인접을 요구하고(U-07이 [u, 07]로 쪼개져도 정확히 맞는다),
 * 낱말은 MatchQuery로 둔다. 여러 개면 Should로 묶어 하나만 맞아도 후보에 들어오게 한다 —
 * 최종 통과 여부는 뒤의 관련성 게이트가 결정하므로 여기서 좁힐 필요가 없다.
 */
function buildFtsLanceQuery(terms: ReturnType<typeof extractLexicalTerms>): lancedb.FullTextQuery | string {
  const plan = buildFtsPlan(terms);
  const clauses: [lancedb.Occur, lancedb.FullTextQuery][] = [
    ...plan.phrases.map((p) => [lancedb.Occur.Should, new lancedb.PhraseQuery(p, "text")] as [lancedb.Occur, lancedb.FullTextQuery]),
    ...plan.words.map((w) => [lancedb.Occur.Should, new lancedb.MatchQuery(w, "text")] as [lancedb.Occur, lancedb.FullTextQuery]),
  ];
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0][1];
  return new lancedb.BooleanQuery(clauses);
}

/** 문서를 새로 넣은 뒤 전문 검색 인덱스가 새 조각을 포함하도록 갱신. 실패해도 인입은 성공 처리. */
async function refreshFtsIndex(table: lancedb.Table): Promise<void> {
  if (!ftsIndexReady) return;
  try {
    await table.optimize();
  } catch (err) {
    // ⚠ optimize()는 이 저장소에서 **늘 깨진다** — lance 8.0.0의 내부 디코드 버그다(2026-08-08).
    //   깨끗하게 새로 지은 저장소에서도 같은 오류가 나 데이터 문제가 아님을 확인했다.
    //   다행히 새로 넣은 조각은 색인 전에도 검색에 잡히므로(미색인 구간은 훑어서 찾는다)
    //   답이 틀리지는 않는다. 다만 쌓이면 느려지므로 **인덱스를 통째로 다시 만든다** —
    //   그 경로는 실측으로 통과한다. 이것마저 실패하면 벡터 검색만으로 계속 간다.
    console.warn(`[memory] 증분 색인 실패(알려진 lance 버그) — 인덱스를 다시 만듭니다: ${err instanceof Error ? err.message : String(err)}`);
    try {
      const existing = (await table.listIndices()).find((i) => i.columns.includes("text"));
      if (existing) await table.dropIndex(existing.name);
      await table.createIndex("text", {
        config: lancedb.Index.fts({ lowercase: true, asciiFolding: true, withPosition: true }),
      });
    } catch (err2) {
      console.warn(`[memory] 인덱스 재생성도 실패 — 벡터 검색만 사용합니다: ${err2 instanceof Error ? err2.message : String(err2)}`);
    }
  }
}

/**
 * 하이브리드 검색 — 벡터(의미)와 BM25(글자 그대로)를 각각 돌려 RRF로 순위를 합친다.
 * LanceDB의 rerank API를 쓰지 않고 직접 융합하는 이유: 벡터 거리(_distance)를 보존해야
 * 관련성 게이트(0.95 임계값)를 그대로 유지할 수 있기 때문이다. 순위 점수만 남으면
 * "무관한 질문에 잡음 조각 주입" 사고가 다시 열린다.
 */
async function hybridSearch(question: string, topK: number, agentId?: string, screen?: string, viewer?: Viewer): Promise<FusedChunk[]> {
  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  if (!names.includes(TABLE_NAME)) return [];

  const table = await db.openTable(TABLE_NAME);
  // ★ **원문 + 말투를 다듬은 질의**를 함께 태운다(2026-08-12). 같은 문서를 두 말투로 물으면
  //   거리가 평균 0.19 벌어지고, 그 차이가 「근거 약함」 문턱(0.85)을 넘기게 만들었다.
  //   ⚠ 원문 결과를 **버리지 않는다** — 두 결과를 합쳐 조각마다 **가까운 쪽 거리**를 쓴다.
  //   정규화가 뜻을 바꿔도 원문이 남아 있어 안전하다(오늘 「좁히다 기능을 죽인」 반복을 피한다).
  //   ★ 2026-08-12 추가: 규칙 정규화는 **2/8**밖에 못 고쳤다. 모델에게 「주제 + 문제 유형」으로
  //     다시 쓰게 하면 **4/6**이 좋아진다("IPS가 자꾸 같은 걸 잡는데" → "IPS 오탐 튜닝",
  //     못 찾던 문서가 0.508로 온다). 평균 327ms — 답 전체가 7~15초라 2~5%다.
  //     ⚠ 재작성이 **낱말을 바꿔 나빠지는 경우도 있다**(smb_445 +0.125). 그래서 셋을 다 태우고
  //       조각마다 **가장 가까운 거리**를 쓴다. 실패·느림이면 조용히 빠진다(searchrewrite 참고).
  const 다듬은 = normalizeForSearch(question);
  const 다시쓴 = await rewriteForSearch(question);
  // 변형마다 **랭킹 페널티**를 붙인다 — 원문·정규화는 뜻을 바꾸지 않아 0, 재작성만
  //   REWRITE_RANK_PENALTY(뜻을 잃은 재작성이 엉뚱한 문서를 min-거리 융합으로 1위에 올리던 사고 방지).
  //   ⚠ 페널티는 **순위**에만 쓰고, 관련성 게이트가 볼 거리(distance)는 진짜 최소값으로 남긴다(아래).
  const 질의들: { text: string; penalty: number }[] = [
    { text: question, penalty: 0 },
    ...(다듬은 ? [{ text: 다듬은, penalty: 0 }] : []),
    ...(다시쓴 && 다시쓴 !== 다듬은 ? [{ text: 다시쓴, penalty: REWRITE_RANK_PENALTY }] : []),
  ];
  const queryVectors = await embed(질의들.map((q) => q.text));
  const scopes = agentId && agentId !== GLOBAL_SCOPE ? [GLOBAL_SCOPE, safeScope(agentId)] : [GLOBAL_SCOPE];
  // ★ 등급 차단은 **검색 조건에 넣는다**(가져온 뒤 거르지 않는다).
  //   표준(OWASP RAG 등)이 한목소리로 권하는 방식이다 — 가져온 뒤 지우면 AI가 이미 본
  //   상태라 흔적이 답에 남을 수 있다. 애초에 문맥에 안 들어가야 한다.
  //   구현은 documentId 제외 목록으로 한다: 등급은 SQLite(memory_documents)에 있고,
  //   LanceDB 스키마는 건드리지 않는다(컬럼 추가는 지식 소실 위험이 있다).
  //   viewer를 명시로 안 받았으면 **요청에 달린 꼬리표**를 집는다. AI 도구(search·explain)는
  //   run(args) 한 모양으로 등록돼 사람을 넘길 자리가 없어, 이 덧문이 없으면 도구로 우회된다.
  const 가림 = hiddenDocIds(viewer ?? currentViewer());
  const whereClause =
    `scope IN (${scopes.map((s) => `'${s}'`).join(", ")})` +
    (가림.length ? ` AND documentId NOT IN (${가림.map((d) => `'${escapeLiteral(d)}'`).join(", ")})` : "");
  // 융합 전에는 각 검색이 넉넉히 후보를 내야 한다 — 한쪽에서 밀린 정답을 다른 쪽이 살린다.
  // ⚠ 2026-08-10 실측(Mac): topK=4면 후보 10칸을 **청크 많은 타사 PDF 하나**가 채워, 정작
  //   우리 문서(청크 30개)가 후보에 못 들어왔다 — origin 부스트(①ⓑ)를 걸 대상 자체가 없던 것이다.
  //   후보를 넓히면 우리 문서가 들어와 부스트를 받는다. .slice(0, topK)는 융합·부스트 **뒤**라
  //   프롬프트·지연은 그대로다(실측: 외부 1위 20→12, 지연 22→19ms). 부스트를 키우는 게 아니라
  //   부스트가 일할 후보를 넣는 것이 순서다.
  const candidates = Math.max(topK * 4, 16);

  let vector: { text: string; documentId: string; distance: number; category?: string }[] = [];
  try {
    // 질의(변형)마다 후보를 떠 오고, 조각 단위 융합은 fuseVariantVectors에 맡긴다 —
    //   진짜 최소거리(게이트·배지용)와 페널티 반영 랭킹거리(순위용)를 나눠, **순위만** 재작성 변형에 벌점을 준다.
    const 변형결과: { hits: VariantHit[]; penalty: number }[] = [];
    for (let vi = 0; vi < queryVectors.length; vi += 1) {
      const rows = (await table.search(queryVectors[vi]).where(whereClause).limit(candidates).toArray()) as (MemoryRow & {
        _distance?: number;
      })[];
      // 이미 저장돼 있는 바이너리꼴 조각(과거 인입분)은 후보에서 뺀다 — 인입 필터(chunkText)가 새 오염을,
      // 이 줄이 **기존 오염**을 막는다. 후보를 topK의 4배로 떠 오므로 topK는 찬다.
      const hits: VariantHit[] = rows
        .filter((r) => !isBinaryLikeChunk(r.text))
        .map((r) => ({
          text: r.text,
          documentId: r.documentId,
          distance: Number(r._distance ?? Number.POSITIVE_INFINITY),
          ...(r.category ? { category: r.category } : {}),
        }));
      변형결과.push({ hits, penalty: 질의들[vi].penalty });
    }
    // 순위는 **페널티 반영 거리**로, 넘기는 distance 칸은 **진짜 최소거리** — 뒤의 관련성 게이트·근거 세기
    // 배지는 페널티에 영향받지 않는다(fuseVariantVectors 참고).
    vector = fuseVariantVectors(변형결과).slice(0, candidates);
  } catch (err) {
    console.warn(`[memory] 지식 베이스 검색 실패: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  const terms = extractLexicalTerms(question);
  let lexical: { text: string; documentId: string; category?: string }[] = [];
  if (shouldRunLexical(terms) && (await ensureFtsIndex(table))) {
    try {
      const rows = (await table
        .query()
        .fullTextSearch(buildFtsLanceQuery(terms))
        .where(whereClause)
        .limit(candidates)
        .toArray()) as MemoryRow[];
      lexical = rows.filter((r) => !isBinaryLikeChunk(r.text)).map((r) => ({ text: r.text, documentId: r.documentId, ...(r.category ? { category: r.category } : {}) }));
    } catch (err) {
      // 전문 검색만 실패하면 벡터 결과로 계속 간다 — 기존 품질은 보장된다.
      console.warn(`[memory] 전문 검색 실패 — 벡터 결과만 사용합니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 부스트 두 겹 — **역할이 화면보다 앞선다**(2026-08-07 「전문 에이전트」 설계).
  //  ① 역할(누가 답하나): 취약점 전문가는 취약점 자료를 먼저 본다. 화면 부스트보다 세다(0.02).
  //  ② 화면(어디서 물었나): 역할이 안 정해진 호출에만 기존 세기(0.008)로 건다.
  // ⚠ 어느 쪽도 **벽이 아니다** — 다른 영역 자료는 밀릴 뿐 사라지지 않는다. 창고를 쪼개지
  //   않은 이유와 같다(지식의 절반이 「일반」이라, 벽을 세우면 그 절반이 고아가 된다).
  // ③ 출처(내장인가): 우리 질문에 우리 지식(제품 내장)을 먼저 세운다(2026-08-10 ①ⓑ, RAG 오염 수리).
  //    역할·화면보다 먼저 걸어, 그 위에 역할/화면 부스트가 더해진다. 벽이 아니라 올리기만 한다.
  const fused = applyOriginBoost(fuseResults({ vector, lexical }, terms.codes), builtinDocumentIds());
  const 역할영역 = categoryForRole(agentId);
  if (역할영역) return applyCategoryBoost(fused, 역할영역, true).slice(0, topK);
  return applyCategoryBoost(fused, categoryForScreen(screen)).slice(0, topK);
}

/** 거리까지 함께 돌려주는 검색. 그라운딩 판단(관련 자료가 있는가)에 쓴다. screen을 주면 그 화면의 업무영역 문서를 우선한다. */
export async function queryMemoryScored(question: string, topK = 5, agentId?: string, screen?: string, viewer?: Viewer): Promise<ScoredChunk[]> {
  const fused = await hybridSearch(question, topK, agentId, screen, viewer);
  return fused.map((c) => ({
    text: c.text,
    distance: c.distance,
    documentId: c.documentId,
    lexicalHit: c.lexicalHit,
  }));
}

/** 관련 있는 청크만 남긴다(벡터 거리 임계값 또는 코드 정확 일치). 관련 자료가 없으면 빈 배열. */
export async function queryMemoryRelevant(question: string, topK = 5, agentId?: string, screen?: string, viewer?: Viewer): Promise<string[]> {
  const fused = await hybridSearch(question, topK, agentId, screen, viewer);
  return fused.filter((c) => isRelevant(c, RAG_RELEVANCE_MAX_DISTANCE)).map((c) => c.text);
}

/**
 * **근거가 얼마나 가까운가**까지 함께 돌려준다 — 답이 근거의 세기를 밝힐 수 있게.
 *
 * 왜 필요한가(2026-08-03 거리 실측): 거리 하나로는 못 가린다.
 *   · 있는 자료: 방화벽 절차 0.56 · 레드팀 0.77 · AI-BOM 0.80 · KISA 0.85
 *   · 없는 자료: ISMS 지적사항 0.77 · 개인정보 유출 0.80 · **2019 감사 0.91**
 *   **두 무리가 겹친다.** 문턱을 0.85로 내리면 KISA(0.849)가 아슬아슬해지고,
 *   0.95로 두면 "2019년 감사 결과"에 2024년 위협 동향 보고서가 근거로 실린다(실사고).
 *
 * 그래서 자르는 대신 **세기를 나눈다**:
 *   · 가까움(≤ 0.85) — 지금처럼 근거로 쓴다
 *   · 멂(0.85~0.95) — 쓰되 **"직접적인 자료는 못 찾았다"고 먼저 밝힌다**
 *   · 무관(> 0.95) — 안 쓴다
 * ⚠ 밝히는 일은 **코드가 문장을 붙여서** 한다. 모델에게 "약하면 밝혀라"라고 시키지 않는다 —
 *   프롬프트로 행동을 교정하는 방식은 이 프로젝트에서 반복해 실패했다.
 */
export const RAG_STRONG_MAX_DISTANCE = 0.85;
export async function queryMemoryGraded(
  question: string, topK = 5, agentId?: string, screen?: string, viewer?: Viewer
): Promise<{ chunks: string[]; scored: ScoredChunk[]; 약한근거만: boolean }> {
  const fused = await hybridSearch(question, topK, agentId, screen, viewer);
  const 쓸것 = fused.filter((c) => isRelevant(c, RAG_RELEVANCE_MAX_DISTANCE));
  // 코드가 글자 그대로 걸린 것(CVE·U-01 등)은 거리와 무관하게 **가까운 근거**로 본다.
  const 가까움 = 쓸것.some((c) => c.lexicalHit || c.distance <= RAG_STRONG_MAX_DISTANCE);
  // ③ 배지 정확도(2026-08-10): scored(documentId 포함)도 돌려준다 — 답이 **실제 읽은** 문서를
  // 배지가 그대로 쓰게 한다. dispatcher가 배지용으로 이 함수를 **같은 agentId**로 부르면
  // 답 경로(ragContextFor)와 동일 검색이라 근거가 어긋나지 않는다(옛 배지는 queryMemoryScored를
  // agentId 없이 재검색해 답과 다른 문서를 근거로 실었다). 기존 chunks 소비자는 구조분해라 무영향.
  return {
    chunks: 쓸것.map((c) => c.text),
    scored: 쓸것.map((c) => ({ text: c.text, distance: c.distance, documentId: c.documentId, lexicalHit: c.lexicalHit })),
    약한근거만: 쓸것.length > 0 && !가까움,
  };
}

/** 문서의 첫 조각 텍스트 — 인수인계 자동 검증의 질문 생성용. 없으면 null. */
export async function getDocumentSample(documentId: string): Promise<string | null> {
  const db = await lancedb.connect(DB_PATH);
  if (!(await db.tableNames()).includes(TABLE_NAME)) return null;
  const table = await db.openTable(TABLE_NAME);
  const rows = (await table.query().where(`documentId = '${escapeLiteral(documentId)}'`).limit(1).toArray()) as MemoryRow[];
  return rows[0]?.text ?? null;
}

/** 임계값 없이 상위 topK를 그대로 돌려주는 검색(문서 검색 화면·도구용). 순위는 하이브리드로 낸다. */
export async function queryMemory(question: string, topK = 5, agentId?: string, screen?: string, viewer?: Viewer): Promise<string[]> {
  const fused = await hybridSearch(question, topK, agentId, screen, viewer);
  return fused.map((c) => c.text);
}

export interface MemoryDocument {
  documentId: string;
  scope: string;
  chunks: number;
  embeddingModel: string | null;
  ingestedAt: string | null; // 없으면 이 기능 이전에 수집된 문서
  hasSource: boolean; // 서버에 원본 파일 경로가 기록돼 있어 '원본까지 삭제'가 가능한지
  docClass: string | null; // Scan·Analyze Agent 분류(매뉴얼/보고서/정책/기타) — 분류 전 문서는 null
  uploadedBy: string | null; // 작업 귀속 — 누가 올렸는지(2026-07-25)
  category: string | null; // 업무영역 5종(취약점·장비운영·사내규정·위협대응·일반) — 마이그레이션 전 문서는 null
  grade: string | null;    // 기밀 C·민감 S·공개 O (engine/grades.ts). 마이그레이션에서 기존 문서는 O로 넣었다.
}

// 장기기억에 저장된 문서 목록. 조각 수·scope의 진실 원천은 LanceDB(실제 임베딩),
// 업로드 시각·원본 경로는 SQLite 메타데이터에서 채운다. 메타데이터 없는 과거 문서도 나온다.
export async function listDocuments(): Promise<MemoryDocument[]> {
  const ldb = await lancedb.connect(DB_PATH);
  const names = await ldb.tableNames();
  const agg = new Map<string, { scope: string; chunks: number }>();
  if (names.includes(TABLE_NAME)) {
    const table = await ldb.openTable(TABLE_NAME);
    let rows: { documentId: string; scope: string }[];
    try {
      rows = (await table.query().select(["documentId", "scope"]).limit(1_000_000).toArray()) as { documentId: string; scope: string }[];
    } catch {
      rows = (await table.query().limit(1_000_000).toArray()) as unknown as { documentId: string; scope: string }[];
    }
    for (const r of rows) {
      const cur = agg.get(r.documentId) ?? { scope: r.scope, chunks: 0 };
      cur.chunks += 1;
      agg.set(r.documentId, cur);
    }
  }
  const metaRows = db.prepare("SELECT * FROM memory_documents").all() as {
    documentId: string; embeddingModel: string | null; sourcePath: string | null; ingestedAt: string; docClass: string | null; uploadedBy: string | null; category: string | null; grade: string | null;
  }[];
  const metaById = new Map(metaRows.map((m) => [m.documentId, m]));
  const out: MemoryDocument[] = [];
  for (const [documentId, { scope, chunks }] of agg) {
    const meta = metaById.get(documentId);
    out.push({
      documentId,
      scope,
      chunks,
      embeddingModel: meta?.embeddingModel ?? null,
      ingestedAt: meta?.ingestedAt ?? null,
      hasSource: !!meta?.sourcePath,
      docClass: meta?.docClass ?? null,
      uploadedBy: meta?.uploadedBy ?? null,
      category: meta?.category ?? null,
      grade: meta?.grade ?? null,
    });
  }
  out.sort((a, b) => (b.ingestedAt ?? "").localeCompare(a.ingestedAt ?? "") || b.chunks - a.chunks);
  return out;
}

/**
 * 지금 묻는 사람이 **볼 수 있는** 문서만.
 *
 * 제목도 정보다 — "2026_인수인계_퇴사자명단_최종.xlsx"는 열어 보지 않아도 새는 것이 있다.
 * 본문(hybridSearch)만 막고 목록을 열어 두면 반쪽이라 여기서도 같은 기준으로 가린다.
 * 관리·정비용(listDocuments)은 전부 봐야 하므로 그대로 둔다 — 쓰는 자리로 나눈다.
 */
export async function listVisibleDocuments(): Promise<MemoryDocument[]> {
  const all = await listDocuments();
  const 가림 = new Set(hiddenDocIds(currentViewer()));
  return 가림.size ? all.filter((d) => !가림.has(d.documentId)) : all;
}

// 특정 문서의 조각(청크) 텍스트 미리보기 — "어떻게 학습됐는지" 확인용.
export async function getDocumentChunks(documentId: string, limit = 10): Promise<{ chunkIndex: number; text: string }[]> {
  const ldb = await lancedb.connect(DB_PATH);
  const names = await ldb.tableNames();
  if (!names.includes(TABLE_NAME)) return [];
  const table = await ldb.openTable(TABLE_NAME);
  const rows = (await table.query().where(`documentId = '${escapeLiteral(documentId)}'`).limit(1_000_000).toArray()) as MemoryRow[];
  return rows
    .map((r) => ({ chunkIndex: r.chunkIndex, text: r.text }))
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .slice(0, limit);
}

export interface DeleteDocumentResult {
  documentId: string;
  deletedChunks: number;
  deletedFile: boolean;
}

// 장기기억에서 문서 삭제. 기본은 임베딩(조각)만 제거 → 답변에서 즉시 빠짐(재업로드로 복구 가능).
// withFile=true면 서버에 경로가 기록된 원본 파일도 함께 삭제(복구 불가). base64 업로드 문서는
// 서버에 원본이 없어 임베딩 제거가 곧 완전 삭제이며 파일 삭제는 no-op이다.
export async function deleteDocument(documentId: string, withFile = false): Promise<DeleteDocumentResult> {
  // 이 문서가 온톨로지에 심은 관계(문서↔자산↔제품↔취약점)도 함께 지운다 — 고아 트리플 방지.
  try {
    const { removeDocTriples } = await import("./docgraph.js");
    removeDocTriples(documentId);
  } catch {
    /* 그래프는 보조 계층 — 정리 실패가 삭제를 막지 않는다 */
  }
  const ldb = await lancedb.connect(DB_PATH);
  const names = await ldb.tableNames();
  let deletedChunks = 0;
  if (names.includes(TABLE_NAME)) {
    const table = await ldb.openTable(TABLE_NAME);
    const predicate = `documentId = '${escapeLiteral(documentId)}'`;
    deletedChunks = (await table.query().where(predicate).limit(1_000_000).toArray()).length;
    if (deletedChunks > 0) await table.delete(predicate);
  }
  let deletedFile = false;
  const meta = getDocMetaStmt.get(documentId) as { sourcePath: string | null } | undefined;
  if (withFile && meta?.sourcePath) {
    try {
      await fs.unlink(meta.sourcePath);
      deletedFile = true;
    } catch (err) {
      console.warn(`[memory] 원본 파일 삭제 실패(${meta.sourcePath}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  deleteDocMetaStmt.run(documentId);
  return { documentId, deletedChunks, deletedFile };
}

export function registerMemoryRoutes(app: Express): void {
  // 문서 등급 바꾸기(기밀 C·민감 S·공개 O) — N2SF. engine/grades.ts 참고.
  //
  // ⚠ 등급을 **낮추는 것**(기밀→공개)은 자료를 더 많은 사람에게 여는 일이다.
  //   그래서 올리든 낮추든 감사에 남긴다 — 어느 쪽이든 나중에 "왜 이렇게 됐나"를 묻는다.
  // ⚠ 주소가 아니라 **본문**으로 받는다 — documentId는 파일 이름이라 한글·공백·＃이 섞인다.
  //   주소에 넣으면 인코딩에서 깨진다(옆의 category 라우트도 같은 이유로 본문을 쓴다).
  app.post(
    "/api/memory/document/grade",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const id = String((req.body as { documentId?: string })?.documentId ?? "");
      const 값 = String((req.body as { grade?: string })?.grade ?? "").toUpperCase();
      if (!["O", "S", "C"].includes(값)) {
        res.status(400).json({ error: "등급은 O(공개)·S(민감)·C(기밀) 중 하나여야 합니다." });
        return;
      }
      const before = (getDocMetaStmt.get(id) as { grade?: string } | undefined)?.grade ?? null;
      const r = db.prepare("UPDATE memory_documents SET grade = ? WHERE documentId = ?").run(값, id);
      if (r.changes === 0) { res.status(404).json({ error: "그런 문서가 없습니다." }); return; }
      const { recordAudit } = await import("./audit.js");
      recordAudit({
        kind: "config",
        actor: (req as unknown as { user?: { displayName?: string } }).user?.displayName ?? null,
        action: `문서 등급 변경 → ${값}`,
        target: id,
        detail: `이전 ${before ?? "미지정"} → ${값}`,
      });
      res.json({ documentId: id, grade: 값 });
    })
  );

  app.post(
    "/api/memory/ingest",
    authMiddleware,
    asyncRoute(async (req, res) => {
      // 사용자 업로드 경로 — Scan·Analyze Agent 분류 포함(classify:false로 끌 수 있음).
      res.json(await ingestDocument(req.body.path, req.body.scope ?? GLOBAL_SCOPE, req.body.classify !== false, (req as unknown as { user?: { displayName?: string } }).user?.displayName));
    })
  );
  // 파일 업로드 → 텍스트 추출(PDF/HWPX/TXT) → 지식 베이스 수집. 담당자가 경로를 타이핑하지 않고
  // 파일 탐색기로 골라 바로 장기 기억에 넣을 수 있게 한다. { filename, content(base64), scope } → IngestResult
  app.post(
    "/api/memory/ingest-file",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { filename, content, scope, origin } = req.body as { filename?: string; content?: string; scope?: string; origin?: string };
      if (!filename || !content) {
        res.status(400).json({ error: "filename과 content(base64)가 필요합니다" });
        return;
      }
      try {
        const { extractDocumentText } = await import("./dataset.js");
        const text = await extractDocumentText(filename, content);
        if (!text.trim()) {
          res.status(400).json({ error: "문서에서 텍스트를 추출하지 못했습니다 (빈 문서이거나 지원하지 않는 형식)" });
          return;
        }
        // 원본 파일을 보관한다 — 담당자가 목록에서 "원본 열기"로 PDF 등을 그대로 볼 수 있게.
        // (예전엔 텍스트만 남기고 원본을 버려 열람이 불가능했다.) 보관 실패는 인입을 막지 않는다.
        let savedPath: string | undefined;
        try {
          const uploadsDir = path.join(INGEST_ROOT, "docs", "uploads");
          await fs.mkdir(uploadsDir, { recursive: true });
          savedPath = path.join(uploadsDir, path.basename(filename));
          await fs.writeFile(savedPath, Buffer.from(content, "base64"));
        } catch (saveErr) {
          console.warn(`[memory] 원본 보관 실패(${filename}): ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
          savedPath = undefined;
        }
        // 사용자 업로드 경로 — Scan·Analyze Agent 분류 포함.
        const actor = (req as unknown as { user?: { displayName?: string } }).user?.displayName;
        // ★ origin='builtin'은 **관리자만** 지정할 수 있다(2026-08-12 신설).
        //   왜 필요한가: 제품이 기본 제공하는 보안 지식(rag-seed 33건)이 이 경로로 들어오는데
        //   origin이 안 붙어 **검색에서 타사 벤더 매뉴얼과 같은 취급**을 받았다. 그 결과
        //   「EPSS와 VPR 차이」 질문에서 정답 문서(거리 0.664)가 **12위로 밀려 LLM에 안 갔고**
        //   더 먼 문서(0.915)가 1위였다 — 오전에 넣은 ORIGIN_BOOST(+0.012)가 RRF 1위 점수
        //   (0.0164)에 비해 커서 순위를 뒤집기 때문이다.
        //   ⚠ **아무나 지정하게 하면 안 된다** — 고객 업로드가 builtin을 사칭해 가산을 받으면
        //   그 부스트가 「우리 지식을 올린다」는 뜻을 잃는다. 그래서 관리자로 제한한다.
        const role = (req as unknown as { user?: { role?: string } }).user?.role;
        const 요청origin = origin === "builtin" && role === "admin" ? "builtin" : undefined;
        if (origin === "builtin" && role !== "admin") {
          console.warn(`[memory] origin=builtin 요청을 무시함(관리자 아님): ${filename}`);
        }
        const ingested = await ingestText(filename, text, scope ?? GLOBAL_SCOPE, savedPath, true, actor, undefined, 요청origin);
        // 자동화 작업 원장(중-2) — 사람이 하면 읽고 요약하고 분류해 넣어야 하는 일이다.
        // 부팅 시 기본 코퍼스 인입(docsbundle)은 이 경로를 타지 않으므로 제품 자랑에 섞이지 않는다.
        const { recordWork } = await import("./worklog.js");
        recordWork({ kind: "document_ingested", detail: filename, actor: actor ?? null, source: "api" });
        res.json(ingested);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
  app.post(
    "/api/memory/query",
    authMiddleware,
    asyncRoute(async (req, res) => {
      // 입력 검증(2026-07-23): 빈 질문이 200에 무관한 최근접 청크를 돌려주던 것을 400+안내로.
      if (!String(req.body?.question ?? "").trim()) {
        res.status(400).json({ error: "검색할 질문을 입력하세요" });
        return;
      }
      // 지식 검색도 사용자 입력이 LLM(임베딩)에 닿는 경로라 관문을 지난다.
      // 여기가 비어 있어 인젝션 페이로드가 그대로 통과하던 것을 막는다(2026-07-19 실측).
      const gate = gateUserInput(String(req.body?.question ?? ""), "memory-query");
      if (!gate.allowed) {
        res.status(400).json({ error: gate.message });
        return;
      }
      req.body.question = gate.text; // 개인정보 가림 반영본으로 검색(임베딩에 원문이 닿지 않게)
      // ★ 열람 등급을 싣는다. 안 실으면 이 경로로 기밀 문서가 그대로 나온다 —
      //   대화창은 막아 놓고 검색창은 열어 두는, 뚫린 문(2026-08-01 실검증에서 발견).
      //   등급은 요청이 아니라 **로그인 사용자**에서 읽는다.
      const who = (req as unknown as { user?: { id?: string; clearance?: string } }).user;
      res.json(
        await queryMemory(req.body.question, req.body.topK, req.body.agentId, undefined, {
          userId: who?.id,
          clearance: who?.clearance,
        })
      );
    })
  );
  // 장기기억 문서 목록(올린 문서 확인) — documentId별 조각수·scope·업로드시각.
  app.get(
    "/api/memory/documents",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json(await listDocuments());
    })
  );
  // 특정 문서 조각 미리보기(어떻게 학습됐는지 확인). Korean/특수문자 파일명 대비 body로 받는다.
  app.post(
    "/api/memory/document/chunks",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { documentId, limit } = req.body as { documentId?: string; limit?: number };
      if (!documentId) {
        res.status(400).json({ error: "documentId가 필요합니다" });
        return;
      }
      res.json(await getDocumentChunks(documentId, Math.min(Math.max(1, limit ?? 10), 50)));
    })
  );
  // 업무영역(category) 수정 — 승인카드의 [수정]용. AI 분류가 틀렸을 때 담당자가 바로잡는다
  // (Human-in-the-Loop). 재임베딩 없이 SQLite·LanceDB 메타만 바꾸므로 즉시 끝난다.
  app.post(
    "/api/memory/document/category",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { documentId, category } = req.body as { documentId?: string; category?: string };
      if (!documentId || !category) {
        res.status(400).json({ error: "documentId와 category가 필요합니다" });
        return;
      }
      if (!CATEGORIES.includes(category as Category)) {
        res.status(400).json({ error: `category는 ${CATEGORIES.join("·")} 중 하나여야 합니다` });
        return;
      }
      if (!getDocMetaStmt.get(documentId)) {
        res.status(404).json({ error: "해당 문서를 찾을 수 없습니다" });
        return;
      }
      db.prepare("UPDATE memory_documents SET category = ? WHERE documentId = ?").run(category, documentId);
      try {
        const ldb = await lancedb.connect(DB_PATH);
        if ((await ldb.tableNames()).includes(TABLE_NAME)) {
          const table = await ldb.openTable(TABLE_NAME);
          await table.update({ where: `documentId = '${escapeLiteral(documentId)}'`, values: { category } });
          // update는 테이블 조각을 재작성한다 — 갱신 없이는 BM25 구문 검색이 조용히 0건이 된다
          // (2026-07-25 마이그레이션에서 실측한 함정). 실패해도 분류 변경 자체는 성공 처리.
          await table.optimize().catch(() => undefined);
        }
      } catch (err) {
        console.warn(`[memory] LanceDB category 갱신 실패(${documentId}): ${err instanceof Error ? err.message : String(err)}`);
      }
      const user = (req as unknown as { user?: { displayName?: string } }).user;
      const { recordAudit } = await import("./audit.js");
      recordAudit({
        kind: "write", actor: user?.displayName ?? null, action: "문서 업무영역 수정",
        target: documentId, detail: `→ ${category}`, result: "ok",
      });
      res.json({ ok: true, documentId, category });
    })
  );
  // 원본 파일 내려받기 — 목록의 "원본 열기"용. 보관 경로가 INGEST_ROOT 안일 때만 내준다.
  app.post(
    "/api/memory/document/file",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { documentId } = req.body as { documentId?: string };
      if (!documentId) {
        res.status(400).json({ error: "documentId가 필요합니다" });
        return;
      }
      const meta = getDocMetaStmt.get(documentId) as { sourcePath?: string | null } | undefined;
      if (!meta?.sourcePath) {
        res.status(404).json({ error: "원본 파일이 보관되어 있지 않습니다 (원본 보관 기능 이전에 올린 문서)" });
        return;
      }
      try {
        const resolved = assertWithinIngestRoot(meta.sourcePath);
        const buf = await fs.readFile(resolved);
        res.json({ filename: path.basename(resolved), content: buf.toString("base64") });
      } catch (err) {
        res.status(404).json({ error: `원본 파일을 읽을 수 없습니다: ${err instanceof Error ? err.message : String(err)}` });
      }
    })
  );

  // 문서 삭제. withFile=true면 원본 파일까지(경로가 기록된 경우).
  app.post(
    "/api/memory/document/delete",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { documentId, withFile } = req.body as { documentId?: string; withFile?: boolean };
      if (!documentId) {
        res.status(400).json({ error: "documentId가 필요합니다" });
        return;
      }
      const result = await deleteDocument(documentId, !!withFile);
      // 지식 삭제는 되돌리기 어렵다 — 무엇을 얼마나 지웠는지 반드시 남긴다.
      const { recordAudit } = await import("./audit.js");
      recordAudit({
        kind: "write",
        action: "지식베이스 문서 삭제",
        target: documentId,
        detail: `조각 ${result.deletedChunks}건 제거${result.deletedFile ? " · 원본 파일까지 삭제(복구 불가)" : ""}`,
        actor: (req as unknown as { user?: { displayName?: string } }).user?.displayName ?? null,
      });
      res.json(result);
    })
  );
}
