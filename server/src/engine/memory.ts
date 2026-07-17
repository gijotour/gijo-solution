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
import { embed } from "./llm";
import { db } from "../db";

// 문서 단위 메타데이터(업로드 시각·원본 경로)는 SQLite에 둔다 — LanceDB 스키마는 건드리지 않는다.
const upsertDocMetaStmt = db.prepare(
  `INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt)
   VALUES (@documentId, @scope, @chunks, @embeddingModel, @sourcePath, @ingestedAt)
   ON CONFLICT(documentId) DO UPDATE SET
     scope=excluded.scope, chunks=excluded.chunks, embeddingModel=excluded.embeddingModel,
     sourcePath=COALESCE(excluded.sourcePath, memory_documents.sourcePath), ingestedAt=excluded.ingestedAt`
);
const getDocMetaStmt = db.prepare("SELECT * FROM memory_documents WHERE documentId = ?");
const deleteDocMetaStmt = db.prepare("DELETE FROM memory_documents WHERE documentId = ?");

// LanceDB where/delete 절에 문자열 리터럴로 들어가는 documentId(파일명)의 작은따옴표를 이스케이프.
function escapeLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

const DB_PATH = process.env.GIJO_MEMORY_DB_PATH ?? path.join("data", "memory.lancedb");
const TABLE_NAME = "documents";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export interface IngestResult {
  documentId: string;
  chunks: number;
  embeddingModel: string;
  scope: string;
}

// scope: "global"이면 모든 에이전트가 검색, 그 외에는 해당 agentId 전용 문서.
export const GLOBAL_SCOPE = "global";

interface MemoryRow {
  documentId: string;
  chunkIndex: number;
  text: string;
  scope: string;
  vector: number[];
}

function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return chunks;
}

export async function ingestDocument(filePath: string, scope: string = GLOBAL_SCOPE): Promise<IngestResult> {
  const raw = await fs.readFile(filePath, "utf-8");
  return ingestText(path.basename(filePath), raw, scope, path.resolve(filePath));
}

// 이미 추출된 텍스트를 지식 베이스에 직접 넣는다 — 파일 업로드(PDF/HWPX 추출 후)나
// 서버 밖 클라이언트에서 올린 문서용. ingestDocument는 파일을 읽어 이 함수로 위임한다.
export async function ingestText(documentId: string, raw: string, scope: string = GLOBAL_SCOPE, sourcePath?: string): Promise<IngestResult> {
  const chunks = chunkText(raw);
  if (chunks.length === 0) return { documentId, chunks: 0, embeddingModel: "none", scope };

  const vectors = await embed(chunks);
  const rows: MemoryRow[] = chunks.map((text, i) => ({ documentId, chunkIndex: i, text, scope, vector: vectors[i] }));

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
        await table.add(records);
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
    });
  } catch (err) {
    console.warn(`[memory] 문서 메타데이터 기록 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { documentId, chunks: chunks.length, embeddingModel: "local-embedding-server", scope };
}

// SQL 문자열 injection 방지 — scope는 LanceDB where 절에 문자열로 들어간다. 에이전트 id와
// "global"만 허용되는 값이지만 방어적으로 이스케이프한다.
function safeScope(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

// agentId를 주면 "그 에이전트 전용 문서 + 전역 문서"만 검색한다. 없으면(대시보드/오케스트레이터)
// 전역 문서만. 특정 에이전트에 귀속된 지식이 다른 에이전트로 새지 않도록 하는 게 목적.
export async function queryMemory(question: string, topK = 5, agentId?: string): Promise<string[]> {
  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  if (!names.includes(TABLE_NAME)) return [];

  const table = await db.openTable(TABLE_NAME);
  const [queryVector] = await embed([question]);
  const scopes =
    agentId && agentId !== GLOBAL_SCOPE ? [GLOBAL_SCOPE, safeScope(agentId)] : [GLOBAL_SCOPE];
  const whereClause = `scope IN (${scopes.map((s) => `'${s}'`).join(", ")})`;
  try {
    const results = (await table.search(queryVector).where(whereClause).limit(topK).toArray()) as MemoryRow[];
    return results.map((r) => r.text);
  } catch (err) {
    // 차원 불일치(임베딩 모델 교체 후 재수집 전) 등 — 검색 실패가 채팅을 죽이면 안 된다.
    console.warn(`[memory] 지식 베이스 검색 실패 (문서 재수집 필요할 수 있음): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export interface MemoryDocument {
  documentId: string;
  scope: string;
  chunks: number;
  embeddingModel: string | null;
  ingestedAt: string | null; // 없으면 이 기능 이전에 수집된 문서
  hasSource: boolean; // 서버에 원본 파일 경로가 기록돼 있어 '원본까지 삭제'가 가능한지
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
    documentId: string; embeddingModel: string | null; sourcePath: string | null; ingestedAt: string;
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
      res.json(await ingestDocument(req.body.path, req.body.scope ?? GLOBAL_SCOPE));
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
        res.json(await ingestText(filename, text, scope ?? GLOBAL_SCOPE));
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
  app.post(
    "/api/memory/query",
    authMiddleware,
    asyncRoute(async (req, res) => {
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
