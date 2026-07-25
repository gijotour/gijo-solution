// engine/memory.ts — 장기 기억(RAG). 로컬LLM_프로젝트_가이드.md 6.2절 "1차: RAG" 구현체.
// 서버가 LanceDB를 단독 소유하므로 여러 클라이언트가 같은 지식 베이스를 공유해서 질의한다.
// (용어 정리 2026-07-16: RAG/LanceDB=장기 기억, 대화 이력=단기 기억(llm.ts), 파인튜닝=학습.
//  예전 문서에는 RAG가 "단기 기억"으로 적혀 있었다 — 업계 통념에 맞춰 뒤집었다.)

import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import * as lancedb from "@lancedb/lancedb";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { embed, chat } from "./llm";
import { db, migrate } from "../db";
import { emitCollaboration } from "./collaboration";
import { gateUserInput } from "./gateway";
import {
  extractLexicalTerms,
  buildFtsPlan,
  shouldRunLexical,
  fuseResults,
  isRelevant,
  applyCategoryBoost,
  categoryForScreen,
  CATEGORIES,
  type Category,
  type FusedChunk,
} from "./hybridsearch";

// 문서 단위 메타데이터(업로드 시각·원본 경로)는 SQLite에 둔다 — LanceDB 스키마는 건드리지 않는다.
migrate("memory_documents-uploadedBy", "ALTER TABLE memory_documents ADD COLUMN uploadedBy TEXT"); // 작업 귀속(누가 올렸나) 표시용(2026-07-25)
migrate("memory_documents-category", "ALTER TABLE memory_documents ADD COLUMN category TEXT"); // 업무영역 5종 — 화면 맥락 검색용(2026-07-25 RAG 전면 검토)
const upsertDocMetaStmt = db.prepare(
  `INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt, uploadedBy, category)
   VALUES (@documentId, @scope, @chunks, @embeddingModel, @sourcePath, @ingestedAt, @uploadedBy, @category)
   ON CONFLICT(documentId) DO UPDATE SET
     scope=excluded.scope, chunks=excluded.chunks, embeddingModel=excluded.embeddingModel,
     sourcePath=COALESCE(excluded.sourcePath, memory_documents.sourcePath), ingestedAt=excluded.ingestedAt,
     uploadedBy=COALESCE(excluded.uploadedBy, memory_documents.uploadedBy),
     category=COALESCE(excluded.category, memory_documents.category)`
);
const getDocMetaStmt = db.prepare("SELECT * FROM memory_documents WHERE documentId = ?");
const deleteDocMetaStmt = db.prepare("DELETE FROM memory_documents WHERE documentId = ?");
const setDocClassStmt = db.prepare("UPDATE memory_documents SET docClass = ? WHERE documentId = ?");

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

/** 파일명·내용 선두로 업무영역을 정한다. 확신이 없으면 null(호출자가 LLM 또는 기본값). */
export function categorizeByRules(documentId: string, text: string): Category | null {
  const name = documentId;
  const head = text.slice(0, 2000);
  // 순서 중요 — 더 구체적인 신호를 먼저 본다.
  if (/취약점|점검\s*결과|vuln|CVE-\d{4}|스캔|pentest|모의해킹/i.test(name)) return "취약점";
  if (/정책|지침|규정|표준|준수|컴플라이언스|policy|compliance|개인정보|isms/i.test(name)) return "사내규정";
  if (/랜섬웨어|침해|위협|공격|탐지|대응|ioc|siem|snort|cti|threat|incident/i.test(name)) return "위협대응";
  if (/매뉴얼|manual|장비|방화벽|스위치|유지보수|점검표|릴리즈|release|장애처리|트러블슈팅|troubleshoot/i.test(name)) return "장비운영";
  // 내용 신호(선두 2000자) — 파일명이 무정보일 때.
  const score: Record<Category, number> = { 취약점: 0, 장비운영: 0, 사내규정: 0, 위협대응: 0, 일반: 0 };
  score["취약점"] = (head.match(/취약점|CVE-\d{4}|CVSS|위험도|조치\s*(기한|방안)|스캔/g) ?? []).length;
  score["장비운영"] = (head.match(/설정\s*방법|명령어|콘솔|장비|펌웨어|유지보수|정기\s*점검|로그\s*필드/g) ?? []).length;
  score["사내규정"] = (head.match(/규정|지침|준수|의무|금지|승인\s*절차|보관\s*(기간|의무)|법령/g) ?? []).length;
  score["위협대응"] = (head.match(/공격|침해|탐지\s*룰|시그니처|차단|대응\s*절차|IOC|악성/g) ?? []).length;
  const best = (Object.entries(score) as [Category, number][]).sort((a, b) => b[1] - a[1])[0];
  // 최고점이 2점 이상이고 2위와 차이가 나야 확신으로 본다 — 억지 분류가 오분류보다 나쁘다.
  const second = (Object.entries(score) as [Category, number][]).sort((a, b) => b[1] - a[1])[1];
  if (best[1] >= 2 && best[1] > second[1]) return best[0];
  return null;
}

/** 업무영역 확정 — 규칙 → (허용 시) LLM → "일반". LLM 실패해도 인입은 계속된다. */
async function categorizeDocument(documentId: string, text: string, allowLlm: boolean): Promise<Category> {
  const byRule = categorizeByRules(documentId, text);
  if (byRule) return byRule;
  if (!allowLlm) return "일반";
  try {
    const reply = await chat({
      agentId: "analysis",
      message: [
        "다음 문서가 어느 업무 자료인지 아래 5가지 중 정확히 한 단어로만 분류하라. 다른 텍스트 없이 그 한 단어만 출력한다.",
        "선택지: 취약점(점검 결과·CVE·조치), 장비운영(장비 매뉴얼·설정·유지보수), 사내규정(정책·지침·컴플라이언스), 위협대응(공격 탐지·침해 대응·룰), 일반(그 외)",
        `파일명: ${documentId}`,
        `내용 일부: ${text.slice(0, 800)}`,
      ].join("\n"),
    });
    return CATEGORIES.find((c) => reply.includes(c)) ?? "일반";
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
  const cleaned = cleanExtractedText(text);
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
  const filtered = chunks.filter((c) => c.length >= 20);
  if (filtered.length === 0 && cleaned.trim().length > 0) return [cleaned.trim().slice(0, size)];
  return filtered;
}

export async function ingestDocument(filePath: string, scope: string = GLOBAL_SCOPE, classify = false, uploadedBy?: string): Promise<IngestResult> {
  const resolved = assertWithinIngestRoot(filePath);
  const raw = await fs.readFile(resolved, "utf-8");
  return ingestText(path.basename(resolved), raw, scope, resolved, classify, uploadedBy);
}

// 이미 추출된 텍스트를 지식 베이스에 직접 넣는다 — 파일 업로드(PDF/HWPX 추출 후)나
// 서버 밖 클라이언트에서 올린 문서용. ingestDocument는 파일을 읽어 이 함수로 위임한다.
export async function ingestText(documentId: string, raw: string, scope: string = GLOBAL_SCOPE, sourcePath?: string, classify = false, uploadedBy?: string, category?: string): Promise<IngestResult> {
  const chunks = chunkText(raw);
  if (chunks.length === 0) return { documentId, chunks: 0, embeddingModel: "none", scope };

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
      try {
        // 재인입 멱등성: 같은 documentId의 옛 청크를 먼저 지운다. 안 그러면 add만 해서 옛/새 청크가
        // 중복 누적된다(2026-07-25 실측: 같은 파일 재업로드/재시드가 KB에 중복 조각을 남김).
        // ⚠ 순서 중요: category 컬럼 보장이 add보다 먼저다. 옛 스키마 테이블에 category 든 행을
        // add하면 스키마 에러 → 아래 최후 안전망(테이블 재생성)이 발동해 기존 지식 전체가 날아간다.
        await ensureCategoryColumn(table);
        await table.delete(`documentId = '${escapeLiteral(documentId)}'`);
        await table.add(records);
        // 새 조각을 전문 검색(BM25)에서도 찾을 수 있게 인덱스를 갱신한다. 인덱스는 생성 시점의
        // 데이터만 담으므로, 이걸 빠뜨리면 방금 올린 문서가 코드 검색에서만 조용히 빠진다.
        await refreshFtsIndex(table);
      } catch (err) {
        // 최후의 안전망: 위 검사로 못 잡은 스키마 불일치로 add가 실패해도 채팅/수집이
        // 죽지 않게 재생성한다(빈 테이블이 옛 스키마인 경우 등).
        console.warn(`[memory] add() 실패 — 지식 베이스를 재생성합니다: ${err instanceof Error ? err.message : String(err)}`);
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
const FTS_GENERATION = "2-with-position";
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
    console.warn(`[memory] 전문 검색 인덱스 갱신 실패(다음 검색에 일부 조각 누락 가능): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 하이브리드 검색 — 벡터(의미)와 BM25(글자 그대로)를 각각 돌려 RRF로 순위를 합친다.
 * LanceDB의 rerank API를 쓰지 않고 직접 융합하는 이유: 벡터 거리(_distance)를 보존해야
 * 관련성 게이트(0.95 임계값)를 그대로 유지할 수 있기 때문이다. 순위 점수만 남으면
 * "무관한 질문에 잡음 조각 주입" 사고가 다시 열린다.
 */
async function hybridSearch(question: string, topK: number, agentId?: string, screen?: string): Promise<FusedChunk[]> {
  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  if (!names.includes(TABLE_NAME)) return [];

  const table = await db.openTable(TABLE_NAME);
  const [queryVector] = await embed([question]);
  const scopes = agentId && agentId !== GLOBAL_SCOPE ? [GLOBAL_SCOPE, safeScope(agentId)] : [GLOBAL_SCOPE];
  const whereClause = `scope IN (${scopes.map((s) => `'${s}'`).join(", ")})`;
  // 융합 전에는 각 검색이 넉넉히 후보를 내야 한다 — 한쪽에서 밀린 정답을 다른 쪽이 살린다.
  const candidates = Math.max(topK * 2, 10);

  let vector: { text: string; documentId: string; distance: number; category?: string }[] = [];
  try {
    const rows = (await table.search(queryVector).where(whereClause).limit(candidates).toArray()) as (MemoryRow & {
      _distance?: number;
    })[];
    vector = rows.map((r) => ({
      text: r.text,
      documentId: r.documentId,
      distance: Number(r._distance ?? Number.POSITIVE_INFINITY),
      ...(r.category ? { category: r.category } : {}),
    }));
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
      lexical = rows.map((r) => ({ text: r.text, documentId: r.documentId, ...(r.category ? { category: r.category } : {}) }));
    } catch (err) {
      // 전문 검색만 실패하면 벡터 결과로 계속 간다 — 기존 품질은 보장된다.
      console.warn(`[memory] 전문 검색 실패 — 벡터 결과만 사용합니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 화면 맥락 부스트 — 유지보수 화면에선 장비 문서가, 컴플라이언스 화면에선 규정 문서가 먼저.
  // soft boost라 다른 영역 문서도 밀려날 뿐 사라지지 않는다(관련성 게이트는 부스트와 무관).
  const fused = fuseResults({ vector, lexical }, terms.codes);
  return applyCategoryBoost(fused, categoryForScreen(screen)).slice(0, topK);
}

/** 거리까지 함께 돌려주는 검색. 그라운딩 판단(관련 자료가 있는가)에 쓴다. screen을 주면 그 화면의 업무영역 문서를 우선한다. */
export async function queryMemoryScored(question: string, topK = 5, agentId?: string, screen?: string): Promise<ScoredChunk[]> {
  const fused = await hybridSearch(question, topK, agentId, screen);
  return fused.map((c) => ({
    text: c.text,
    distance: c.distance,
    documentId: c.documentId,
    lexicalHit: c.lexicalHit,
  }));
}

/** 관련 있는 청크만 남긴다(벡터 거리 임계값 또는 코드 정확 일치). 관련 자료가 없으면 빈 배열. */
export async function queryMemoryRelevant(question: string, topK = 5, agentId?: string, screen?: string): Promise<string[]> {
  const fused = await hybridSearch(question, topK, agentId, screen);
  return fused.filter((c) => isRelevant(c, RAG_RELEVANCE_MAX_DISTANCE)).map((c) => c.text);
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
export async function queryMemory(question: string, topK = 5, agentId?: string, screen?: string): Promise<string[]> {
  const fused = await hybridSearch(question, topK, agentId, screen);
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
    documentId: string; embeddingModel: string | null; sourcePath: string | null; ingestedAt: string; docClass: string | null; uploadedBy: string | null; category: string | null;
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
    });
  }
  out.sort((a, b) => (b.ingestedAt ?? "").localeCompare(a.ingestedAt ?? "") || b.chunks - a.chunks);
  return out;
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
      const { filename, content, scope } = req.body as { filename?: string; content?: string; scope?: string };
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
        res.json(await ingestText(filename, text, scope ?? GLOBAL_SCOPE, savedPath, true, (req as unknown as { user?: { displayName?: string } }).user?.displayName));
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
      res.json(await queryMemory(req.body.question, req.body.topK, req.body.agentId));
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
      res.json(await deleteDocument(documentId, !!withFile));
    })
  );
}
