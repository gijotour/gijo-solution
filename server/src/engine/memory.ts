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
  const chunks = chunkText(raw);
  if (chunks.length === 0) return { documentId: filePath, chunks: 0, embeddingModel: "none", scope };

  const vectors = await embed(chunks);
  const documentId = path.basename(filePath);
  const rows: MemoryRow[] = chunks.map((text, i) => ({ documentId, chunkIndex: i, text, scope, vector: vectors[i] }));

  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  const records = rows as unknown as Record<string, unknown>[];
  if (names.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    // 임베딩 모델이 바뀌면 벡터 차원이 달라진다. LanceDB의 add()는 이때 에러를 내는 게
    // 아니라 벡터를 기존 차원으로 잘라 저장해버리므로(조용한 데이터 오염), 차원을 직접
    // 비교해서 다르면 테이블을 재생성한다. 다른 모델의 벡터끼리는 검색이 성립하지 않으므로
    // 기존 지식 베이스는 폐기가 맞다 — 문서만 다시 수집하면 된다.
    const existing = (await table.query().limit(1).toArray()) as MemoryRow[];
    const existingDim = existing[0]?.vector?.length;
    if (existingDim !== undefined && existingDim !== vectors[0].length) {
      console.warn(
        `[memory] 벡터 차원 불일치(기존 ${existingDim} ↔ 새 ${vectors[0].length} — 임베딩 모델 교체?) — 지식 베이스를 재생성합니다. 기존 문서는 재수집하세요.`
      );
      await db.dropTable(TABLE_NAME);
      await db.createTable(TABLE_NAME, records);
    } else {
      await table.add(records);
    }
  } else {
    await db.createTable(TABLE_NAME, records);
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

export function registerMemoryRoutes(app: Express): void {
  app.post(
    "/api/memory/ingest",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await ingestDocument(req.body.path, req.body.scope ?? GLOBAL_SCOPE));
    })
  );
  app.post(
    "/api/memory/query",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await queryMemory(req.body.question, req.body.topK, req.body.agentId));
    })
  );
}
