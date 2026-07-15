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

const DB_PATH = path.join("data", "memory.lancedb");
const TABLE_NAME = "documents";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export interface IngestResult {
  documentId: string;
  chunks: number;
  embeddingModel: string;
}

interface MemoryRow {
  documentId: string;
  chunkIndex: number;
  text: string;
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

export async function ingestDocument(filePath: string): Promise<IngestResult> {
  const raw = await fs.readFile(filePath, "utf-8");
  const chunks = chunkText(raw);
  if (chunks.length === 0) return { documentId: filePath, chunks: 0, embeddingModel: "none" };

  const vectors = await embed(chunks);
  const documentId = path.basename(filePath);
  const rows: MemoryRow[] = chunks.map((text, i) => ({ documentId, chunkIndex: i, text, vector: vectors[i] }));

  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  const records = rows as unknown as Record<string, unknown>[];
  if (names.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    await table.add(records);
  } else {
    await db.createTable(TABLE_NAME, records);
  }

  return { documentId, chunks: chunks.length, embeddingModel: "local-embedding-server" };
}

export async function queryMemory(question: string, topK = 5): Promise<string[]> {
  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  if (!names.includes(TABLE_NAME)) return [];

  const table = await db.openTable(TABLE_NAME);
  const [queryVector] = await embed([question]);
  const results = (await table.search(queryVector).limit(topK).toArray()) as MemoryRow[];
  return results.map((r) => r.text);
}

export function registerMemoryRoutes(app: Express): void {
  app.post(
    "/api/memory/ingest",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await ingestDocument(req.body.path));
    })
  );
  app.post(
    "/api/memory/query",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json(await queryMemory(req.body.question, req.body.topK));
    })
  );
}
