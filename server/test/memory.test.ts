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
// ⚠ 2026-08-28(화살 #12): embed가 잎 모듈 engine/embedding.ts로 내려갔다. memory는 이제
//   그쪽을 문다 — **목도 실제 import 경로를 따라가야 한다.** llm만 목하면 진짜 embed가
//   돌아 임베딩 서버(8081)를 찾다가 실패한다(이 시험 3개가 그것을 실증했다).
let embedDim = 3;
vi.mock("../src/engine/embedding", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: embedDim }, (_, i) => (i + 1) / embedDim))),
}));
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: embedDim }, (_, i) => (i + 1) / embedDim))),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { ingestDocument, ingestText, queryMemory, listDocuments, getDocumentChunks, getChunksForDocuments, getDocumentSample, deleteDocument, uploadedDocIds } = await import("../src/engine/memory");

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

  // ★ 조각 **판독기 3종**은 검색(hybridSearch)을 안 지나므로 따로 걷어야 한다
  //   (2026-09-06 검토관 [높음] — 네 번째 누출 경로). 소스 감시는 metaleak.test.ts에 있고,
  //   여기서는 **실제 LanceDB에 넣고 꺼내** 글자가 안 나오는지 본다(감시만으로는 헛초록이 난다).
  //   ⚠ 반입 본문에 이 꼴이 남아 있는 문서가 운영에 3,778건 있다(재반입 안 함) — 그 실물 그대로.
  it("★ 승인 문답 꼬리 메타가 조각 판독기 3종 어디로도 안 나온다(내부 경로·교사 모델 파일명)", async () => {
    embedDim = 3;
    const 꼬리있는본문 = [
      "[승인 문답 · 취약점 · 사내규정 · 2026-09-05]",
      "질문: 보안서약서 제출률 알려줘",
      "답변: 사내 자료에 기록이 없습니다.",
      "근거 조각: store:개인정보_안전성_확보조치_기준_안내서_2024.pdf#2d8025162648",
      "교사 모델: models/qwen38-flash-next/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf",
    ].join("\n");
    await ingestText("메타꼬리-문서.txt", 꼬리있는본문, "global");

    const 판독 = [
      (await getDocumentChunks("메타꼬리-문서.txt", 50)).map((c) => c.text).join("\n"),
      ((await getChunksForDocuments(["메타꼬리-문서.txt"])).get("메타꼬리-문서.txt") ?? []).map((c) => c.text).join("\n"),
      (await getDocumentSample("메타꼬리-문서.txt")) ?? "",
    ];
    for (const [i, 글] of 판독.entries()) {
      expect(글, `판독기 ${i}가 내부 저장소 경로를 그대로 돌려줬다`).not.toContain("store:");
      expect(글, `판독기 ${i}가 교사 모델 파일명을 그대로 돌려줬다`).not.toContain(".gguf");
      expect(글, `판독기 ${i}가 라벨 줄을 남겼다`).not.toContain("근거 조각");
      // 본문은 살아 있어야 한다 — 「메타를 막는다」가 「글을 갉아먹는다」가 되면 안 된다.
      expect(글, `판독기 ${i}가 본문까지 지웠다`).toContain("보안서약서 제출률");
    }
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

  // ★ 낱말 가로채기 수리(2026-08-21 라이브): 문서를 콕 집어 그 내용/존재를 물으면 문서 RAG로,
  //   낱말 트리거(침해사고)나 LLM 라우터의 법령 오선택으로 새면 안 된다. ⚠ 신호는 순수 언어패턴
  //   (문서유형어+조사)이라 업로드 문서 유무와 무관 — docScope 토큰매칭을 하드 게이트로 쓰던 것을
  //   검토관 [높음]이 잡아 언어 신호로 바꿨다(업로드 문서명 토큰이 법령·침해 질문을 가로채던 것).
  it("문서지목질문 — 문서유형어로 콕 집으면 문서로, 법령·절차·소재·미지목은 각자 몫", async () => {
    const { 문서지목질문 } = await import("../src/engine/memory");
    const { 침해사고질문인가 } = await import("../src/engine/incidentsteps");
    // 문서유형어 콕 집음 + 내용/존재 질문 → 문서(true)
    expect(문서지목질문("개인정보 안전성 확보조치 안내서에서 암호화 대상이 뭐야?"), "안내서에서+내용→문서").toBe(true);
    expect(문서지목질문("이 취약성 분석서 작성 가이드에 방화벽 설정 절차가 있어?"), "가이드에+존재→문서").toBe(true);
    // ★ 법령 질문 → law_lookup 몫(안 삼킨다) — 검토관 [높음] (a) 회귀 방어
    expect(문서지목질문("개인정보 보호법에서 유출 통지 기한이 며칠이야?"), "보호법→법령").toBe(false);
    expect(문서지목질문("개인정보처리시스템 접속기록 몇 년 보관해야 해?"), "문서유형어 없음→법령/일반").toBe(false);
    // 절차 의도(대응하려면) → 플레이북 몫
    expect(문서지목질문("이 안내서대로 랜섬웨어 대응하려면 뭐부터 해?"), "절차의도→플레이북").toBe(false);
    // 소재(어디) → 문서소재 search 몫
    expect(문서지목질문("이 안내서 어디 있어?"), "소재→search").toBe(false);
    // ★ 미지목 침해 질문 → 여전히 침해(2026-08-10 보호). 업로드 문서명에 안 의존.
    expect(문서지목질문("랜섬웨어 대응 절차 알려줘"), "미지목→아님").toBe(false);
    expect(침해사고질문인가("이 안내서에 랜섬웨어 대응 절차가 있어?"), "문서지목→침해 아님").toBe(false);
    expect(침해사고질문인가("랜섬웨어 대응 절차 알려줘"), "미지목→여전히 침해").toBe(true);
    // ★ v2(검토관 ①②): 지시어+문서유형어로 조사 생략·하위참조도 잡되, 과대매칭은 막는다.
    //   (B) 조사 생략 hijack — 「이 매뉴얼 랜섬웨어 대응 절차 있어?」는 문서로(침해로 새면 안 됨)
    expect(문서지목질문("이 매뉴얼 랜섬웨어 대응 절차 있어?"), "지시어+조사생략→문서").toBe(true);
    expect(침해사고질문인가("이 매뉴얼 랜섬웨어 대응 절차 있어?"), "지시어+문서→침해 아님").toBe(false);
    //   (B) 하위참조 — 조사가 「3페이지에」에 붙어도 지시어+보고서로 잡는다(①-1)
    expect(문서지목질문("이 보고서 3페이지에 뭐라고 나와 있어?"), "하위참조→문서").toBe(true);
    //   내용-about-절차 — 「초동 조치가 뭐라고 나와?」는 내용질문이라 문서(①-6, 블랭킷 초동 제거)
    expect(문서지목질문("이 매뉴얼에 초동 조치가 뭐라고 나와 있어?"), "내용-about-절차→문서").toBe(true);
    //   추천/소재 누출 방지 — 「어떤 문서를 봐야?」는 어느 문서인지(소재)라 문서 아님(①-4)
    expect(문서지목질문("이럴 때 어떤 문서를 봐야 해?"), "추천→소재/플레이북").toBe(false);
    //   지시어 있어도 문서유형어 없으면 안 잡음 — 「이 시스템 랜섬웨어…」는 침해 보존
    expect(문서지목질문("이 시스템에서 랜섬웨어 대응 절차 알려줘"), "문서유형어 없음→아님").toBe(false);
    //   합성어 가드 — 문서화/문서함은 문서 지목 아님
    expect(문서지목질문("이 로그에서 문서화 방법 알려줘"), "문서화 가드→아님").toBe(false);
    // ★ 2026-08-21 코퍼스 QA: 문서명에 「취약점」이 있어도 문서를 콕 집으면 문서로 — 자산 취약점 목록
    //   빠른 길(isFindingListAsk)이 채 가면 안 된다(dispatcher가 !문서지목질문으로 배제).
    expect(문서지목질문("이 취약점 분석평가 가이드에서 Unix 점검 항목은 어떤 게 있어?"), "문서지목(취약점명)→문서").toBe(true);
    //   반대로 문서를 안 집은 자산 목록 질문은 여전히 목록 빠른 길(HIJACK 유지)
    expect(문서지목질문("미조치 취약점 뭐 있어?"), "자산 목록→문서 아님").toBe(false);
    expect(문서지목질문("고위험 취약점 목록 보여줘"), "자산 목록→문서 아님").toBe(false);
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
