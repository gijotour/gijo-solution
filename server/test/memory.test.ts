import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB 경로는 모듈 로드 시점에 읽히므로 import 전에 임시 디렉터리로 고정한다
// (개발 머신의 실제 data/memory.lancedb를 건드리지 않기 위해).
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-lancedb-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;
// ingestDocument는 경로 순회 방지를 위해 허용 루트(기본 data/) 밖의 파일을 거부한다(2026-07-19 보안수정).
// 이 테스트는 임시 디렉터리에 픽스처 파일을 두므로, 그 디렉터리를 허용 루트로 지정한다.
process.env.GIJO_INGEST_ROOT = tmpDb;

// 임베딩 차원을 테스트마다 바꿀 수 있는 mock — 임베딩 모델 교체 시나리오 재현용
let embedDim = 3;
vi.mock("../src/engine/llm", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: embedDim }, (_, i) => (i + 1) / embedDim))),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { ingestDocument, ingestText, queryMemory, listDocuments, getDocumentChunks, deleteDocument, uploadedDocIds } = await import("../src/engine/memory");

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
    expect(result.chunks).toBe(0); // 공백뿐인 문서는 저장 안 함 (2026-07-23 청킹 개선 — 예전엔 공백도 임베딩됐다)
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

  it("uploadedDocIds — 내장(builtin)은 빼고 업로드만 준다 (docScope 오발화 방지, 검토관 [중])", async () => {
    // 내장은 주제명 그대로라(취약점관리_지침) 일반 질문 "취약점 관리는 어떻게"에 docScope가
    // 최강 부스트로 오발화했다. 내장을 목록에서 빼야 그 문서명이 지목 대상이 안 된다.
    embedDim = 3;
    await ingestText("seed-topic.md", "내장 지침 내용입니다.", "global", undefined, false, undefined, undefined, "builtin");
    await ingestText("uploaded-vendor.pdf", "업로드 매뉴얼 내용입니다.", "global");
    const ids = uploadedDocIds();
    expect(ids).toContain("uploaded-vendor.pdf");
    expect(ids, "내장 문서가 docScope 대상에 들면 일반 질문에 오발화한다").not.toContain("seed-topic.md");
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

const { chunkText, cleanExtractedText, classifyByContentHint } = await import("../src/engine/memory");

describe("chunkText — 구조 인지 청킹 (2026-07-23 개선)", () => {
  it("페이지 번호·반복 머리글을 제거한다", () => {
    const raw = ["GIJO 보안 매뉴얼", "본문 첫 문단입니다.", " - 134 - ", "GIJO 보안 매뉴얼", "둘째 문단입니다.", "GIJO 보안 매뉴얼", "셋째 문단입니다."].join("\n");
    const cleaned = cleanExtractedText(raw);
    expect(cleaned).not.toContain("- 134 -");
    expect(cleaned.match(/GIJO 보안 매뉴얼/g) ?? []).toHaveLength(0); // 3회 반복 머리글 제거
    expect(cleaned).toContain("둘째 문단입니다.");
  });

  it("HTML 주석(<!-- … -->)은 색인에서 뺀다 — 유지보수 메모 누출 방지 (max 발견#3)", () => {
    const doc = [
      "## 개인정보 유출 신고", "", "유출을 알게 된 때부터 72시간 이내가 법정 기한이다.", "",
      "<!-- 유지보수 메모: 이 문서를 늘릴 때 같은 형식으로 이어 적는다. 한 항목은 네 조각(질문 예·답·오해·확인 경로) -->",
      "", "## 다음 항목", "", "제21조 파기는 목적 달성 시 지체 없이.",
    ].join("\n");
    const joined = chunkText(doc, 800, 100).join("\n");
    expect(joined).toContain("72시간");            // 실제 내용은 남는다
    expect(joined).toContain("제21조 파기");        // 주석 뒤 내용도 남는다
    expect(joined).not.toContain("이 문서를 늘릴 때"); // 주석 안 메타는 색인 안 됨
    expect(joined).not.toContain("네 조각");
  });

  it("제목 줄이 다음 문단과 같은 청크에 붙는다 (제목 직후 절단 방지)", () => {
    const doc = ["## 1. 개요", "", "가".repeat(700), "", "## 2. 장애 대응 표준 절차", "", "1단계 증상 기록. 2단계 로그 확보. 3단계 HA 확인."].join("\n");
    const chunks = chunkText(doc, 800, 100);
    const withHeading = chunks.find((c) => c.includes("장애 대응 표준 절차"));
    expect(withHeading).toBeDefined();
    expect(withHeading).toContain("1단계 증상 기록"); // 제목만 남고 본문이 다음 청크로 밀리지 않는다
  });

  it("긴 문단은 문장 경계로 나뉘고 20자 미만 잡음 청크는 버린다", () => {
    const long = Array.from({ length: 40 }, (_, i) => `문장 ${i}번은 유지보수 절차를 설명한다.`).join(" ");
    const chunks = chunkText(long, 300, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(420); // size+overlap 여유 내
      expect(c.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("classifyByContentHint — 매뉴얼 표지가 뚜렷하면 LLM 없이 확정, 경합이면 null", () => {
    const manual = "이 문서는 사용법을 설명한다. 설정 방법은 메뉴 경로 시스템>업데이트에서 버튼 클릭. 명령어 예시와 로그 필드 정의 포함.";
    expect(classifyByContentHint(manual)).toBe("매뉴얼");
    const ambiguous = "동향 분석과 지침 준수를 함께 다루는 문서.";
    expect(classifyByContentHint(ambiguous)).toBeNull();
  });
});

const { categorizeByRules } = await import("../src/engine/memory");

describe("categorizeByRules — 업무영역 5종 (2026-07-25 RAG 전면 검토)", () => {
  it("파일명 신호로 4대 업무영역을 정확히 가른다", () => {
    expect(categorizeByRules("(주)안전대부 웹취약점 점검 결과 보고서.pdf", "")).toBe("취약점");
    expect(categorizeByRules("FW-2000_운영_매뉴얼.pdf", "")).toBe("장비운영");
    expect(categorizeByRules("개인정보_내부관리계획_지침.docx", "")).toBe("사내규정");
    expect(categorizeByRules("랜섬웨어_초동_대응.md", "")).toBe("위협대응");
  });

  it("운영 실측 오분류 사례가 바로잡힌다 — 방화벽 룰·SIEM 룰이 '보고서'로 뭉개지던 문제", () => {
    expect(categorizeByRules("방화벽_any_any_규칙.md", "")).toBe("장비운영");
    expect(categorizeByRules("siem_correlation_rule.md", "")).toBe("위협대응");
  });

  it("파일명이 무정보면 내용 신호로 정한다", () => {
    const vulnText = "이번 점검에서 발견된 취약점은 CVE-2024-1234이며 CVSS 9.8, 조치 기한은 30일이다. 취약점 세부 내역은 아래와 같다.";
    expect(categorizeByRules("문서1.pdf", vulnText)).toBe("취약점");
  });

  it("확신이 없으면 null — 억지 분류는 오분류보다 나쁘다", () => {
    expect(categorizeByRules("메모.txt", "오늘 회의는 3시입니다.")).toBeNull();
  });
});

describe("categorizeDocument의 LLM 게이트 — 신호 0이면 묻지 않는다(코드로 해결 원칙)", () => {
  it("도메인 신호가 전무한 문서는 규칙이 null을 내고, 신호 점수도 전부 0이다", () => {
    // categorizeDocument 내부 게이트의 전제 조건을 순수 함수 수준에서 고정한다 —
    // 회의 메모가 LLM에 넘어가 아무 영역이나 배정받던 회귀(2026-07-25 E2E 실측) 방지.
    expect(categorizeByRules("회의메모.txt", "다음 회의는 8월 첫 주로 예정. 참석자 명단은 추후 공지.")).toBeNull();
  });
});
