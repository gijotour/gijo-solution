import { describe, it, expect, vi, beforeEach } from "vitest";

// LanceDB는 부르지 않는다 — 모집단·조회 횟수는 memory 창구를 모의해 잰다(demo 시험과 같은 방식).
const listDocuments = vi.fn();
const getChunksForDocuments = vi.fn();
const queryMemoryScored = vi.fn();
vi.mock("../src/engine/memory", () => ({
  listDocuments,
  getDocumentChunks: vi.fn(),
  getChunksForDocuments,
  queryMemoryScored,
  RAG_RELEVANCE_MAX_DISTANCE: 0.95,
}));

// ⚠ 정적 import면 안 된다 — vi.mock 공장이 파일 맨 위로 끌려 올라가 위 const보다 먼저 돌아
//   「Cannot access 'listDocuments' before initialization」으로 죽는다(demo 시험과 같은 이유로 동적 import).
const { normalizeBaseName, scanKbHygiene, formatKbHygiene, kbHygieneOverdue, lastKbHygieneReport, 점검시각문구 } =
  await import("../src/engine/kbhygiene");
const { db } = await import("../src/db");

describe("지식베이스 위생 — 이름 정규화(버전·중복 표지 제거)", () => {
  it("버전·날짜·사본·(n) 표지를 걷어 같은 계열로 묶는다", () => {
    const base = normalizeBaseName("MF2_차단로그_필드해설.txt");
    expect(normalizeBaseName("MF2_차단로그_필드해설_v2.txt")).toBe(base);
    expect(normalizeBaseName("MF2_차단로그_필드해설 (1).txt")).toBe(base);
    expect(normalizeBaseName("MF2_차단로그_필드해설_최종.txt")).toBe(base);
    expect(normalizeBaseName("MF2_차단로그_필드해설_20260723.txt")).toBe(base);
  });
  it("다른 문서는 다른 기준 이름", () => {
    expect(normalizeBaseName("방화벽_정책.txt")).not.toBe(normalizeBaseName("EDR_로그.txt"));
  });
});

// 실제 탐지(중복/버전충돌/신선도)의 최종 확인은 실환경 HTTP로 한다(운영에 MF2 v1/v2 실존).
// 아래는 2026-09-04 수리(모집단 제외 · 한 번 훑기 · 리포트 칸 · 기동 1회)의 계약이다.

const 어제 = new Date(Date.now() - 86400_000).toISOString();
const doc = (documentId: string, over: Record<string, unknown> = {}) => ({
  documentId, scope: "global", chunks: 2, embeddingModel: "bge", ingestedAt: 어제,
  hasSource: true, docClass: null, uploadedBy: null, category: null, origin: null, grade: "O", ...over,
});
const 조각맵 = (m: Record<string, string[]>) =>
  new Map(Object.entries(m).map(([id, texts]) => [id, texts.map((text, chunkIndex) => ({ chunkIndex, text }))]));

beforeEach(() => {
  listDocuments.mockReset();
  getChunksForDocuments.mockReset();
  queryMemoryScored.mockReset();
  getChunksForDocuments.mockResolvedValue(new Map());
  queryMemoryScored.mockResolvedValue([]);
});

describe("지식베이스 위생 — 모집단(누를 수 있는 문서만 점검한다)", () => {
  it("승인 문답·사례 문서는 점검하지 않고, 리포트가 전체·제외 수를 밝힌다", async () => {
    listDocuments.mockResolvedValue([
      doc("지침.md"),
      doc("내장.md", { origin: "builtin" }), // 내장은 목록에 뜨고 지울 수 있다 — 점검한다
      doc("승인문답:1", { origin: "approved-qa" }),
      doc("승인문답:2", { origin: "approved-qa" }),
      doc("incident-case:ic-1", { origin: "incident-case" }),
    ]);
    const r = await scanKbHygiene();
    expect(r.totalDocs).toBe(2);      // 점검한 문서
    expect(r.storeDocs).toBe(5);      // 저장소 전체
    expect(r.excludedDocs).toBe(3);
    // 제외한 문서는 **본문을 뜨지도 않는다** — 모집단 밖인데 조각을 읽으면 느려진 이유가 그대로 남는다.
    expect([...getChunksForDocuments.mock.calls[0][0]].sort()).toEqual(["내장.md", "지침.md"]);
  });

  // ★ 2026-09-04: 개인 문서(documentId "personal:<uuid>")도 **같은 부류**다 — AI 지식 화면·문서 허브는
  //   이미 빼는데(memory.html:783) 위생 모집단에만 남아 있었다. 게다가 이 점검은 주기 실행이라
  //   **보는 사람을 모른다** — 남기면 남의 개인 메모 이름이 리포트에 실려 아무에게나 간다.
  it("개인 문서(personal:)는 점검하지 않고 제외 수에 세어진다 — 본문도 뜨지 않는다", async () => {
    listDocuments.mockResolvedValue([
      doc("지침.md"),
      doc("personal:9f3c0001", { uploadedBy: "alice" }),
      doc("personal:9f3c0002", { uploadedBy: "bob" }),
    ]);
    const r = await scanKbHygiene();
    expect(r.totalDocs).toBe(1);
    expect(r.storeDocs).toBe(3);
    expect(r.excludedDocs).toBe(2);
    expect([...getChunksForDocuments.mock.calls[0][0]], "모집단 밖 문서의 조각을 뜨면 격리도 성능도 잃는다").toEqual(["지침.md"]);
    expect(formatKbHygiene(r), "제외 사유에 개인 문서를 안 적으면 숫자와 설명이 어긋난다").toContain("개인 문서");
  });

  it("개인 문서끼리는 내용이 같아도 지적하지 않는다 — 남의 메모 이름이 리포트에 실리지 않는다", async () => {
    const 본문 = "이번 주 회의 메모: 방화벽 교체 일정과 담당자를 정리하고 다음 점검일을 잡는다.";
    listDocuments.mockResolvedValue([doc("personal:aaa11111"), doc("personal:bbb22222")]);
    getChunksForDocuments.mockResolvedValue(조각맵({ "personal:aaa11111": [본문], "personal:bbb22222": [본문] }));
    const r = await scanKbHygiene();
    expect(r.findings).toEqual([]);
    expect(r.totalDocs).toBe(0);
    expect(JSON.stringify(r), "개인 문서 이름이 리포트에 실렸다").not.toContain("personal:");
  });

  it("제외된 문서끼리는 이름이 같아도 버전충돌로 잡지 않는다 — 못 누르는 지적을 만들지 않는다", async () => {
    listDocuments.mockResolvedValue([
      doc("incident-case:ic-1", { origin: "incident-case" }),
      doc("incident-case:ic-2", { origin: "incident-case" }),
      doc("incident-case:ic-3", { origin: "incident-case" }),
    ]);
    const r = await scanKbHygiene();
    expect(r.findings).toEqual([]);
    expect(r.clean).toBe(true);
    expect(r.totalDocs).toBe(0);
  });
});

describe("지식베이스 위생 — 조각은 한 번만 훑는다(15분 정체의 원인)", () => {
  it("문서가 30건이어도 조각 조회는 딱 1회", async () => {
    listDocuments.mockResolvedValue(Array.from({ length: 30 }, (_, i) => doc(`문서${i}.md`)));
    await scanKbHygiene();
    expect(getChunksForDocuments).toHaveBeenCalledTimes(1);
    expect(getChunksForDocuments.mock.calls[0][0]).toHaveLength(30);
  });

  it("데모 문서 판정도 그 한 번에 떠 온 조각을 쓴다(문서별 재조회 없음)", async () => {
    listDocuments.mockResolvedValue([doc("샘플_방화벽.txt"), doc("실제_절차.md")]);
    getChunksForDocuments.mockResolvedValue(조각맵({
      "샘플_방화벽.txt": ["방화벽 정책 정기 점검 절차: 정책 백업, 무적중 룰 식별, 최소권한 위반 표시, 담당자 승인"],
      "실제_절차.md": ["보안장비 유지보수 절차: 자원·HA·시그니처·백업·로그를 월 1회 점검한다."],
    }));
    queryMemoryScored.mockResolvedValue([{ text: "…", distance: 0.3, documentId: "실제_절차.md" }]);
    const r = await scanKbHygiene();
    expect(getChunksForDocuments).toHaveBeenCalledTimes(1);
    expect(r.findings.some((f) => f.type === "demo_overlap")).toBe(true);
  });

  it("같은 내용 두 건은 여전히 완전중복으로 잡힌다 — 빨라졌다고 못 잡으면 안 된다", async () => {
    const 본문 = "방화벽 정책 정기 점검 절차: 정책 백업, 무적중 룰 식별, 최소권한 위반 표시, 담당자 승인까지 확인한다.";
    listDocuments.mockResolvedValue([doc("정책점검.txt"), doc("정책점검_사본.txt")]);
    getChunksForDocuments.mockResolvedValue(조각맵({ "정책점검.txt": [본문], "정책점검_사본.txt": [본문] }));
    const r = await scanKbHygiene();
    const f = r.findings.find((x) => x.type === "duplicate");
    expect(f?.documents.sort()).toEqual(["정책점검.txt", "정책점검_사본.txt"]);
  });
});

describe("지식베이스 위생 — 언제 잰 값인지 말한다", () => {
  it("요약에 점검 시각과 모집단이 들어간다", async () => {
    listDocuments.mockResolvedValue([doc("지침.md"), doc("승인문답:1", { origin: "approved-qa" })]);
    const r = await scanKbHygiene();
    const 글 = formatKbHygiene(r);
    expect(글).toContain("마지막 점검 방금 전(");
    expect(글).toContain("문서 1건 점검");
    expect(글).toContain("제외 1건");
  });

  it("시각이 깨졌으면 지어내지 않는다", () => {
    expect(점검시각문구("")).toBe("마지막 점검 시각 미상");
    expect(점검시각문구(new Date(Date.now() - 3 * 86400_000).toISOString())).toContain("3일 전");
  });
});

describe("지식베이스 위생 — 기동 직후 1회(주기만 걸면 첫 점검이 7일 뒤다)", () => {
  it("리포트가 없으면 밀린 것으로 보고, 방금 점검했으면 안 돈다", async () => {
    db.prepare("DELETE FROM app_state WHERE key='kbHygieneReport'").run();
    expect(lastKbHygieneReport()).toBeNull();
    expect(kbHygieneOverdue()).toBe(true);

    listDocuments.mockResolvedValue([doc("지침.md")]);
    await scanKbHygiene(); // 점검이 리포트를 남긴다
    expect(kbHygieneOverdue()).toBe(false);
  });

  it("마지막 점검이 7일을 넘겼으면 밀린 것으로 본다", () => {
    const 옛것 = { scannedAt: new Date(Date.now() - 8 * 86400_000).toISOString(), totalDocs: 1, storeDocs: 1, excludedDocs: 0, findings: [], clean: true };
    db.prepare("INSERT INTO app_state (key, value) VALUES ('kbHygieneReport', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(옛것));
    expect(kbHygieneOverdue()).toBe(true);
  });
});
