// 데모·샘플 문서가 실제 문서와 주제가 겹치는지 잡는 규칙(demo_overlap) 검증.
//
// 왜 이 규칙이 생겼나(2026-07-26 실측): "샘플_방화벽_정책_점검_절차.txt"(데모)가 검색 1위를
// 차지해 실제 지식 문서(유지보수 7항목)를 밀어냈다. 답변은 데모 내용만으로 만들어졌는데,
// 기존 규칙 3종(중복·버전충돌·신선도)은 이름도 내용도 달라 하나도 잡지 못했다.
import { describe, it, expect, beforeEach, vi } from "vitest";

const listDocuments = vi.fn();
const getDocumentChunks = vi.fn();
const queryMemoryScored = vi.fn();

vi.mock("../src/engine/memory", () => ({
  listDocuments,
  getDocumentChunks,
  queryMemoryScored,
  RAG_RELEVANCE_MAX_DISTANCE: 0.95,
}));

const { scanKbHygiene } = await import("../src/engine/kbhygiene");

const doc = (documentId: string) => ({ documentId, scope: "default", chunks: 2, embeddingModel: "bge", ingestedAt: new Date().toISOString(), hasSource: true, docClass: null });

beforeEach(() => {
  listDocuments.mockReset();
  getDocumentChunks.mockReset();
  queryMemoryScored.mockReset();
  getDocumentChunks.mockResolvedValue([{ text: "방화벽 정책 정기 점검 절차: 정책 백업, 무적중 룰 식별, 최소권한 위반 표시, 담당자 승인" }]);
});

describe("demo_overlap — 데모 문서가 실제 문서와 같은 주제를 다루는가", () => {
  it("데모 문서의 본문으로 검색해 실제 문서가 함께 걸리면 경합으로 본다", async () => {
    listDocuments.mockResolvedValue([doc("샘플_방화벽_정책_점검_절차.txt"), doc("GIJO_지식_보안장비_유지보수절차.md")]);
    queryMemoryScored.mockResolvedValue([
      { text: "…", distance: 0.2, documentId: "샘플_방화벽_정책_점검_절차.txt" },
      { text: "…", distance: 0.4, documentId: "GIJO_지식_보안장비_유지보수절차.md" },
    ]);
    const r = await scanKbHygiene();
    const f = r.findings.find((x) => x.type === "demo_overlap");
    expect(f).toBeTruthy();
    expect(f!.documents).toContain("샘플_방화벽_정책_점검_절차.txt");
    expect(f!.documents).toContain("GIJO_지식_보안장비_유지보수절차.md");
    // 삭제를 자동으로 하지 않는다는 태도가 권고에 남아야 한다
    expect(f!.suggestion).toContain("자동 삭제 금지");
  });

  it("데모 문서만 걸리면(실제 문서 경합 없음) 지적하지 않는다 — 소음 방지", async () => {
    listDocuments.mockResolvedValue([doc("샘플_방화벽_정책_점검_절차.txt")]);
    queryMemoryScored.mockResolvedValue([
      { text: "…", distance: 0.2, documentId: "샘플_방화벽_정책_점검_절차.txt" },
    ]);
    const r = await scanKbHygiene();
    expect(r.findings.some((x) => x.type === "demo_overlap")).toBe(false);
  });

  it("관련 범위 밖(거리 초과)인 문서는 경합으로 치지 않는다", async () => {
    listDocuments.mockResolvedValue([doc("데모_로그분석.txt"), doc("무관한_문서.md")]);
    queryMemoryScored.mockResolvedValue([
      { text: "…", distance: 0.2, documentId: "데모_로그분석.txt" },
      { text: "…", distance: 2.5, documentId: "무관한_문서.md" }, // 임계값 밖
    ]);
    const r = await scanKbHygiene();
    expect(r.findings.some((x) => x.type === "demo_overlap")).toBe(false);
  });

  it("데모가 아닌 문서끼리는 이 규칙을 적용하지 않는다", async () => {
    listDocuments.mockResolvedValue([doc("실제_절차_A.md"), doc("실제_절차_B.md")]);
    queryMemoryScored.mockResolvedValue([
      { text: "…", distance: 0.2, documentId: "실제_절차_A.md" },
      { text: "…", distance: 0.3, documentId: "실제_절차_B.md" },
    ]);
    const r = await scanKbHygiene();
    expect(r.findings.some((x) => x.type === "demo_overlap")).toBe(false);
    expect(queryMemoryScored).not.toHaveBeenCalled(); // 데모가 없으면 검색 자체를 안 한다
  });

  it("샘플·데모·sample·demo·test 접두를 모두 데모로 본다", async () => {
    for (const name of ["샘플_x.txt", "데모_x.txt", "sample_x.txt", "demo-x.txt", "test x.txt"]) {
      listDocuments.mockResolvedValue([doc(name), doc("실제문서.md")]);
      queryMemoryScored.mockResolvedValue([
        { text: "…", distance: 0.3, documentId: "실제문서.md" },
      ]);
      const r = await scanKbHygiene();
      expect(r.findings.some((x) => x.type === "demo_overlap"), name).toBe(true);
    }
  });

  it("임베딩이 죽어도 점검 전체가 무너지지 않는다", async () => {
    listDocuments.mockResolvedValue([doc("샘플_x.txt"), doc("실제문서.md")]);
    queryMemoryScored.mockImplementation(() => { throw new Error("embed down"); });
    const r = await scanKbHygiene();
    expect(r.findings.some((x) => x.type === "demo_overlap")).toBe(false);
    expect(typeof r.totalDocs).toBe("number"); // 리포트 자체는 나온다
  });
});
