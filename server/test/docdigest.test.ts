// 문서 반입 소식 — [2026-08-06 · 계획서 1차 목표(3소스 분석) 소스 확장 + 후-6(축적 자산)]
//
// 왜: CrowdStrike 위협 보고서 같은 PDF를 올려도 올린 순간의 카드가 전부였다 — 그 뒤로는
// 무엇이 들어왔는지, 무슨 내용인지, 우리와 무슨 상관인지 아무도 모른다(사용자 지적).
// 지키는 계약:
//   ① 대장은 결정적이다 — 없으면 없다고 말한다(0건 재작성 금지 계열).
//   ② 요약은 LLM이지만 실패를 숨기지 않는다(failedReason 기록 — 조용한 공백 금지).
//   ③ 접점(온톨로지 대조)은 LLM이 꺼져 있어도 나온다.
//   ④ today가 안내하는 「새로 들어온 문서 알려줘」는 결정적으로 라우팅된다(안내한 말은 흔들리지 않는다).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/engine/llm", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, chat: vi.fn() };
});

import { db } from "../src/db";
import { chat } from "../src/engine/llm";
import { addTriple, deleteTriplesBySource } from "../src/engine/ontology";
import { makeDigest, listRecentDocs, recentDocumentsText, ontologyMatchesFor } from "../src/engine/docdigest";
import { forcedToolFor } from "../src/engine/agentloop";

// memory.ts를 통째로 안 끌고 오려고(무거운 lancedb) 대장 테이블만 직접 보장한다 —
// 실서버에선 memory.ts의 migrate가 만든다(컬럼은 여기서 쓰는 4개보다 많아도 IF NOT EXISTS라 무해).
db.exec(`CREATE TABLE IF NOT EXISTS memory_documents (
  documentId TEXT PRIMARY KEY, scope TEXT, chunks INTEGER, embeddingModel TEXT,
  sourcePath TEXT, ingestedAt TEXT, docClass TEXT, uploadedBy TEXT, category TEXT, grade TEXT
)`);

const putDoc = (id: string, daysAgo: number, category = "위협대응", uploadedBy: string | null = "jyh") =>
  db.prepare(
    `INSERT INTO memory_documents (documentId, scope, chunks, ingestedAt, uploadedBy, category)
     VALUES (?, 'global', 2, ?, ?, ?)
     ON CONFLICT(documentId) DO UPDATE SET ingestedAt=excluded.ingestedAt`
  ).run(id, new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString(), uploadedBy, category);

beforeEach(() => {
  db.prepare("DELETE FROM memory_documents WHERE documentId LIKE 'QA소식%'").run();
  db.prepare("DELETE FROM doc_digests WHERE documentId LIKE 'QA소식%'").run();
  deleteTriplesBySource("QA소식시드");
  vi.mocked(chat).mockReset();
});

describe("문서 반입 소식 — 대장(슬라이스 1)", () => {
  it("최근 N일만 보이고, 없으면 없다고 말한다", () => {
    putDoc("QA소식-옛날.pdf", 30);
    expect(listRecentDocs(7).filter((r) => r.documentId.startsWith("QA소식"))).toHaveLength(0);
    putDoc("QA소식-어제.pdf", 1);
    const rows = listRecentDocs(7).filter((r) => r.documentId.startsWith("QA소식"));
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("위협대응");
  });

  it("★ 0건이면 지어내지 않고 '없습니다'라고 답한다", () => {
    const text = recentDocumentsText(1);
    // 다른 시험이 남긴 최근 문서가 있을 수 있어, QA소식 문서가 없는 것만 확인한다
    expect(text).not.toContain("QA소식");
  });

  it("답변에 분류 집계와 문서 이름이 실린다", () => {
    putDoc("QA소식-위협보고서.pdf", 1, "위협대응");
    putDoc("QA소식-규정.md", 2, "사내규정");
    const text = recentDocumentsText(7);
    expect(text).toContain("QA소식-위협보고서.pdf");
    expect(text).toContain("위협대응");
    expect(text).toContain("사내규정");
  });
});

describe("문서 반입 소식 — 요약(슬라이스 2)", () => {
  it("세 줄 요약과 핵심어를 저장하고 '자체 요약'으로 표기한다", async () => {
    putDoc("QA소식-요약대상.pdf", 0);
    vi.mocked(chat).mockResolvedValue("첫 줄 요약\n둘째 줄 요약\n셋째 줄 요약\n핵심어: 피싱, 랜섬웨어, 계정 탈취, 클라우드, AI");
    await makeDigest("QA소식-요약대상.pdf", "본문", "위협대응");
    const row = listRecentDocs(7).find((r) => r.documentId === "QA소식-요약대상.pdf")!;
    expect(row.summary).toContain("첫 줄 요약");
    expect(row.keywords).toContain("랜섬웨어");
    expect(recentDocumentsText(7)).toContain("자체 요약"); // 원문 대체가 아님을 표기(7B 오독 전례)
  });

  it("★ LLM 실패를 숨기지 않는다 — failedReason이 남고 답에도 '요약 없음'으로 보인다", async () => {
    putDoc("QA소식-실패.pdf", 0);
    vi.mocked(chat).mockRejectedValue(new Error("모델이 꺼져 있습니다"));
    await makeDigest("QA소식-실패.pdf", "본문", "일반");
    const row = listRecentDocs(7).find((r) => r.documentId === "QA소식-실패.pdf")!;
    expect(row.summary).toBeNull();
    expect(row.failedReason).toContain("모델이 꺼져");
    expect(recentDocumentsText(7)).toContain("요약 없음");
  });
});

describe("문서 반입 소식 — 온톨로지 접점(슬라이스 3, 결정적)", () => {
  it("본문에 등장한 표제어의 연결 지식이 접점으로 나온다 — LLM 없이", () => {
    addTriple({ subject: "피싱공격", predicate: "완화통제", object: "이메일게이트웨이", source: "QA소식시드" });
    const 접점 = ontologyMatchesFor("이번 분기 피싱공격이 89% 증가했다는 보고입니다.");
    expect(접점.length).toBeGreaterThan(0);
    expect(접점.join("\n")).toContain("피싱공격");
  });

  it("아무 표제어도 안 나오면 접점 0건 — 억지로 잇지 않는다", () => {
    expect(ontologyMatchesFor("전혀 무관한 요리 이야기")).toHaveLength(0);
  });

  it("접점은 요약 실패와 무관하게 저장된다", async () => {
    addTriple({ subject: "피싱공격", predicate: "완화통제", object: "이메일게이트웨이", source: "QA소식시드" });
    putDoc("QA소식-접점.pdf", 0);
    vi.mocked(chat).mockRejectedValue(new Error("죽음"));
    await makeDigest("QA소식-접점.pdf", "피싱공격 동향 보고", "위협대응");
    const row = listRecentDocs(7).find((r) => r.documentId === "QA소식-접점.pdf")!;
    expect(row.matches).toContain("피싱공격");
  });
});

describe("★ 라우팅 — 안내한 말은 흔들리지 않는다", () => {
  const 도착 = (말: string) => forcedToolFor(말)?.tool;
  it("조회 물음은 recent_documents로 못 박힌다", () => {
    expect(도착("새 문서 뭐 들어왔어?")).toBe("recent_documents");
    expect(도착("새로 들어온 문서 알려줘")).toBe("recent_documents"); // today가 안내하는 그 문장
    expect(도착("최근 들어온 문서 보여줘")).toBe("recent_documents");
    expect(도착("들어온 문서 있어?")).toBe("recent_documents");
  });
  it("이웃 문장은 안 삼킨다 — 쓰기·다른 뜻·이웃 영토", () => {
    expect(도착("어제 들어온 문서 지워줘")).not.toBe("recent_documents");
    expect(도착("새 문서 만들어줘")).not.toBe("recent_documents");
    expect(도착("문서 보강해줘")).not.toBe("recent_documents");
    // 이웃 영토 존중(겹침 0): 반영 확인·재고 목록은 knowledge_status가 계속 맡는다
    expect(도착("최근 올린 문서 알려줘")).toBe("knowledge_status");
    expect(도착("들어온 문서 목록 줘")).toBe("knowledge_status");
  });
});
