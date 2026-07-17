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

const { ingestDocument, ingestText, queryMemory, listDocuments, getDocumentChunks, deleteDocument } = await import("../src/engine/memory");

const DOC_A = path.join(tmpDb, "doc-a.txt");
const DOC_B = path.join(tmpDb, "doc-b.txt");

describe("memory (장기 기억 / LanceDB) — 임베딩 모델 교체 자가 복구", () => {
  beforeAll(() => {
    fs.writeFileSync(DOC_A, "모델 반입 승인 담당자는 김민수 책임이다.", "utf-8");
    fs.writeFileSync(DOC_B, "승인된 모델은 VAULT-9에 보관한다.", "utf-8");
  });

  it("ingest and query round-trip with a consistent embedding dimension", async () => {
    embedDim = 3;
    const result = await ingestDocument(DOC_A);
    expect(result.chunks).toBe(1);
    const hits = await queryMemory("승인 담당자?");
    expect(hits.some((t) => t.includes("김민수"))).toBe(true);
  });

  it("ingestText stores already-extracted text directly (파일 업로드 경로)", async () => {
    embedDim = 3;
    const result = await ingestText("uploaded.pdf", "업로드 문서: 사고 대응 책임자는 이영희 팀장이다.", "global");
    expect(result.documentId).toBe("uploaded.pdf");
    expect(result.chunks).toBe(1);
    const hits = await queryMemory("사고 대응 책임자?");
    expect(hits.some((t) => t.includes("이영희"))).toBe(true);
  });

  it("ingestText with empty text stores nothing", async () => {
    embedDim = 3;
    const result = await ingestText("empty.txt", "   ", "global");
    expect(result.chunks).toBe(1); // 공백도 청크 1개(원자적) — 빈 문자열만 0
    const zero = await ingestText("truly-empty.txt", "", "global");
    expect(zero.chunks).toBe(0);
    expect(zero.embeddingModel).toBe("none");
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

describe("memory documents (올린 문서 목록·조각 미리보기·삭제)", () => {
  it("lists ingested documents with chunk counts and records ingestedAt", async () => {
    embedDim = 3;
    await ingestText("guide-x.txt", "첫 번째 관리 대상 문서입니다.", "global");
    await ingestText("guide-y.md", "두 번째 문서 — 마크다운.", "global");
    const docs = await listDocuments();
    const x = docs.find((d) => d.documentId === "guide-x.txt");
    const y = docs.find((d) => d.documentId === "guide-y.md");
    expect(x).toBeTruthy();
    expect(y).toBeTruthy();
    expect(x!.chunks).toBeGreaterThanOrEqual(1);
    expect(y!.scope).toBe("global");
    expect(y!.ingestedAt).toBeTruthy(); // 방금 수집 → 시각 기록됨
    expect(y!.hasSource).toBe(false); // ingestText(base64 경로)는 서버 원본 없음
  });

  it("previews a document's chunk text (어떻게 학습됐는지 확인)", async () => {
    embedDim = 3;
    await ingestText("preview-doc.txt", "조각 미리보기 확인용 문서 내용입니다.", "global");
    const chunks = await getDocumentChunks("preview-doc.txt", 5);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text).toContain("조각 미리보기");
  });

  it("ingestDocument records a sourcePath so 원본까지 삭제 is possible", async () => {
    embedDim = 3;
    const p = path.join(tmpDb, "with-source.txt");
    fs.writeFileSync(p, "원본 경로가 있는 문서.", "utf-8");
    await ingestDocument(p, "global");
    const docs = await listDocuments();
    const d = docs.find((x) => x.documentId === "with-source.txt");
    expect(d).toBeTruthy();
    expect(d!.hasSource).toBe(true);
  });

  it("deletes a document's embeddings and drops it from the list + search", async () => {
    embedDim = 3;
    await ingestText("delete-me.txt", "삭제 대상 문서 고유내용 ZZTOP.", "global");
    expect((await listDocuments()).some((d) => d.documentId === "delete-me.txt")).toBe(true);
    const res = await deleteDocument("delete-me.txt", false);
    expect(res.deletedChunks).toBeGreaterThanOrEqual(1);
    expect(res.deletedFile).toBe(false);
    expect((await listDocuments()).some((d) => d.documentId === "delete-me.txt")).toBe(false);
    const hits = await queryMemory("ZZTOP", 10);
    expect(hits.join(" ")).not.toContain("ZZTOP");
  });
});

describe("memory scope (B — 에이전트별 지식 격리)", () => {
  const GLOBAL_DOC = path.join(tmpDb, "global-policy.txt");
  const PENTEST_DOC = path.join(tmpDb, "pentest-playbook.txt");

  afterAll(() => {
    fs.rmSync(tmpDb, { recursive: true, force: true });
  });

  beforeAll(async () => {
    embedDim = 3;
    // 앞 describe와 같은 tmpDb를 쓰되(GIJO_MEMORY_DB_PATH 고정), 앞 테스트가 5차원으로
    // 재생성해 둔 테이블은 첫 ingest(3차원)에서 다시 재생성되므로 깨끗이 시작한다.
    fs.mkdirSync(tmpDb, { recursive: true });
    fs.writeFileSync(GLOBAL_DOC, "전 직원 공통: 사고 발생 시 보안팀에 즉시 신고한다.", "utf-8");
    fs.writeFileSync(PENTEST_DOC, "침투테스트 전용: Metasploit 모듈 사용 시 사전 승인 필수.", "utf-8");
    await ingestDocument(GLOBAL_DOC, "global");
    await ingestDocument(PENTEST_DOC, "pentest");
  });

  it("an agent sees its own scope plus global", async () => {
    const hits = await queryMemory("Metasploit 사용 규정", 10, "pentest");
    const joined = hits.join(" ");
    expect(joined).toContain("Metasploit"); // pentest 전용 문서
    expect(joined).toContain("보안팀에 즉시 신고"); // 전역 문서도 포함
  });

  it("a different agent does NOT see another agent's private docs", async () => {
    const hits = await queryMemory("Metasploit 사용 규정", 10, "analysis");
    const joined = hits.join(" ");
    expect(joined).not.toContain("Metasploit"); // pentest 전용은 analysis에 안 보임
    expect(joined).toContain("보안팀에 즉시 신고"); // 전역은 보임
  });

  it("no agentId (dashboard/orchestrator) sees only global", async () => {
    const hits = await queryMemory("Metasploit 사용 규정", 10);
    const joined = hits.join(" ");
    expect(joined).not.toContain("Metasploit");
    expect(joined).toContain("보안팀에 즉시 신고");
  });
});
