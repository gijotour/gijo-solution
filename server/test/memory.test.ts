import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB 경로는 모듈 로드 시점에 읽히므로 import 전에 임시 디렉터리로 고정한다
// (개발 머신의 실제 data/memory.lancedb를 건드리지 않기 위해).
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-lancedb-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;

// 임베딩 차원을 테스트마다 바꿀 수 있는 mock — 임베딩 모델 교체 시나리오 재현용
let embedDim = 3;
vi.mock("../src/engine/llm", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: embedDim }, (_, i) => (i + 1) / embedDim))),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { ingestDocument, queryMemory } = await import("../src/engine/memory");

const DOC_A = path.join(tmpDb, "doc-a.txt");
const DOC_B = path.join(tmpDb, "doc-b.txt");

describe("memory (장기 기억 / LanceDB) — 임베딩 모델 교체 자가 복구", () => {
  beforeAll(() => {
    fs.writeFileSync(DOC_A, "모델 반입 승인 담당자는 김민수 책임이다.", "utf-8");
    fs.writeFileSync(DOC_B, "승인된 모델은 VAULT-9에 보관한다.", "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmpDb, { recursive: true, force: true });
  });

  it("ingest and query round-trip with a consistent embedding dimension", async () => {
    embedDim = 3;
    const result = await ingestDocument(DOC_A);
    expect(result.chunks).toBe(1);
    const hits = await queryMemory("승인 담당자?");
    expect(hits.some((t) => t.includes("김민수"))).toBe(true);
  });

  it("query with a mismatched dimension degrades to [] instead of throwing (채팅 생존)", async () => {
    embedDim = 5; // 임베딩 모델이 바뀐 상황 — 테이블은 3차원, 질의는 5차원
    const hits = await queryMemory("승인 담당자?");
    expect(hits).toEqual([]);
  });

  it("ingest with a mismatched dimension recreates the table (기존 지식은 폐기, 재수집 시작점)", async () => {
    embedDim = 5;
    const result = await ingestDocument(DOC_B);
    expect(result.chunks).toBe(1);
    // 재생성된 5차원 테이블에서 새 문서는 검색되고, 옛 3차원 문서는 사라졌다
    const hits = await queryMemory("모델 보관 위치?");
    expect(hits.some((t) => t.includes("VAULT-9"))).toBe(true);
    expect(hits.some((t) => t.includes("김민수"))).toBe(false);
  });
});
