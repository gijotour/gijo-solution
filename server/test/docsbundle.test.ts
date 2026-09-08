import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB 경로는 모듈 로드 시점에 읽히므로 import 전에 임시 디렉터리로 고정한다
// (개발 머신의 실제 data/memory.lancedb를 건드리지 않기 위해).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-docsbundle-"));
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "lancedb");

// 매니페스트·문서 원본을 임시 디렉터리로 격리 — 리포지토리 루트의 실제 제품 문서를 읽지 않는다.
const MANIFEST = path.join(tmp, "docs-manifest.json");
const DOCS_DIR = path.join(tmp, "docs");
process.env.GIJO_DOCS_MANIFEST = MANIFEST;
process.env.GIJO_DOCS_DIR = DOCS_DIR;

// ⚠ 2026-08-28(화살 #12): embed가 잎 모듈 engine/embedding.ts로 내려갔다 — memory는 그쪽을
//   문다. llm만 목하면 **진짜 embed가 돌아** 임베딩 서버(8081)를 찾다 실패한다(실측).
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { bootstrapDocsBundle } = await import("../src/engine/docsbundle");
const { db } = await import("../src/db");
const { createHash } = await import("crypto");
const { listDocuments, queryMemory } = await import("../src/engine/memory");

function writeManifest(files: { file: string; why?: string }[]) {
  fs.writeFileSync(MANIFEST, JSON.stringify({ scope: "global", files }), "utf-8");
}

describe("docsbundle — 제품 문서 기본 코퍼스 부트스트랩", () => {
  beforeAll(() => {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOCS_DIR, "매뉴얼.md"), "# 사용자 매뉴얼\n대시보드는 오늘 할 일을 먼저 보여줍니다.", "utf-8");
    fs.writeFileSync(path.join(DOCS_DIR, "지침.md"), "# 취약점 관리 지침\n조치 기한은 심각도에 따라 정합니다.", "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("매니페스트에 열거된 문서를 인입하고 검색으로 찾을 수 있다", async () => {
    writeManifest([{ file: "매뉴얼.md" }, { file: "지침.md" }]);
    const r = await bootstrapDocsBundle();

    expect(r.ingested.sort()).toEqual(["매뉴얼.md", "지침.md"]);
    expect(r.failed).toEqual([]);
    expect(r.missing).toEqual([]);

    const hits = await queryMemory("대시보드가 뭘 보여주나요?");
    expect(hits.join("\n")).toContain("오늘 할 일");
  });

  it("재기동해도 이미 인입된 문서는 건너뛴다 — 중복 청크가 쌓이지 않는다", async () => {
    const before = await listDocuments();
    const beforeChunks = before.reduce((n, d) => n + d.chunks, 0);

    const r = await bootstrapDocsBundle();

    expect(r.ingested).toEqual([]);
    expect(r.skipped.sort()).toEqual(["매뉴얼.md", "지침.md"]);
    const after = await listDocuments();
    expect(after.reduce((n, d) => n + d.chunks, 0)).toBe(beforeChunks);
  });

  it("매니페스트에 있지만 파일이 없으면 missing으로 보고하고 나머지는 계속 인입한다", async () => {
    fs.writeFileSync(path.join(DOCS_DIR, "신규.md"), "# 신규 문서\n보안제품 등록은 등록부 화면에서 합니다.", "utf-8");
    writeManifest([{ file: "매뉴얼.md" }, { file: "없는문서.md" }, { file: "신규.md" }]);

    const r = await bootstrapDocsBundle();

    expect(r.missing).toEqual(["없는문서.md"]);
    expect(r.ingested).toEqual(["신규.md"]);
    expect(r.skipped).toEqual(["매뉴얼.md"]);
  });

  // [전중후 계획서 정렬: 전-4] 지식 번들이 knowledge/ 하위 경로 항목을 편입하면서 생긴 함정 —
  // 운영에는 같은 문서가 이미 **파일명 id**로 수동 인입돼 있다. 경로째 id를 쓰면 같은 내용이
  // 두 id로 이중 인입되어 검색 경합(QA-M04류)이 된다. id는 언제나 basename이어야 한다.
  it("하위 폴더 항목도 파일명이 id — 경로가 달라도 문서는 하나뿐이다(중복 없음)", async () => {
    // 원래 의도(중복 문서 금지)는 그대로다. 다만 내용이 다르면 **바꿔 넣는다** —
    // 건너뛰기만 하면 문서를 고쳐 올려도 AI는 영원히 옛 내용을 안다(2026-07-31 실사고:
    // 용어사전을 고쳤는데 운영 AI가 새 용어를 "물리적인 도구"라고 지어냈다).
    const sub = path.join(DOCS_DIR, "knowledge");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "지침.md"), "# 취약점 관리 지침\n(번들 사본)", "utf-8");
    writeManifest([{ file: "knowledge/지침.md" }]);

    const before = (await listDocuments()).length;
    const r = await bootstrapDocsBundle();

    expect(r.updated).toEqual(["knowledge/지침.md"]); // 내용이 다르니 갱신
    expect(r.ingested).toEqual([]);
    expect((await listDocuments()).length).toBe(before); // 문서 수 불변 — 중복 없음
    expect((await listDocuments()).filter((d) => d.documentId === "지침.md")).toHaveLength(1);
  });

  it("★ 내용이 그대로면 다시 넣지 않는다 — 재기동마다 통째로 갈아엎지 않게", async () => {
    const sub = path.join(DOCS_DIR, "knowledge");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "고정.md"), "# 안 바뀌는 문서\n내용 그대로", "utf-8");
    writeManifest([{ file: "knowledge/고정.md" }]);

    const 첫번째 = await bootstrapDocsBundle();
    expect(첫번째.ingested).toEqual(["knowledge/고정.md"]);

    const 두번째 = await bootstrapDocsBundle();
    expect(두번째.skipped, "안 바뀐 문서를 매번 지웠다 넣으면 기동이 느려지고 검색이 흔들린다")
      .toEqual(["knowledge/고정.md"]);
    expect(두번째.updated).toEqual([]);
  });

  it("★ 내용을 고치면 다시 들어간다 — 옛 조각은 남지 않는다", async () => {
    const sub = path.join(DOCS_DIR, "knowledge");
    fs.mkdirSync(sub, { recursive: true });
    const 파일 = path.join(sub, "바뀌는.md");
    fs.writeFileSync(파일, "# 용어\n서랍이란 아직 없는 말이다", "utf-8");
    writeManifest([{ file: "knowledge/바뀌는.md" }]);
    await bootstrapDocsBundle();

    fs.writeFileSync(파일, "# 용어\n서랍은 대화창 위에 접힌 질문 보기다", "utf-8");
    const r = await bootstrapDocsBundle();

    expect(r.updated).toEqual(["knowledge/바뀌는.md"]);
    const 문서 = (await listDocuments()).filter((d) => d.documentId === "바뀌는.md");
    expect(문서, "옛 문서와 새 문서가 함께 남으면 서로 다른 답이 번갈아 나온다").toHaveLength(1);
  });

  it("하위 폴더의 새 문서는 파일명 id로 인입된다 (경로 접두가 id에 남지 않는다)", async () => {
    const sub = path.join(DOCS_DIR, "knowledge");
    fs.writeFileSync(path.join(sub, "번들전용.md"), "# 번들 전용 지식\n제로트러스트는 신뢰하지 않고 검증합니다.", "utf-8");
    writeManifest([{ file: "knowledge/번들전용.md" }]);

    const r = await bootstrapDocsBundle();

    expect(r.ingested).toEqual(["knowledge/번들전용.md"]);
    const ids = (await listDocuments()).map((d) => d.documentId);
    expect(ids).toContain("번들전용.md"); // basename id
    expect(ids).not.toContain("knowledge/번들전용.md"); // 경로 id 금지
  });

  it("매니페스트가 없으면 조용히 아무것도 하지 않는다 (서버 기동을 막지 않는다)", async () => {
    process.env.GIJO_DOCS_MANIFEST = path.join(tmp, "없는매니페스트.json");
    try {
      const r = await bootstrapDocsBundle();
      // removed = 제외 목록에 있어 저장소에서 지운 문서(2026-08-03 신설).
      //   매니페스트가 없으면 지울 것도 없으므로 빈 배열이어야 한다.
      expect(r).toEqual({ ingested: [], skipped: [], updated: [], missing: [], removed: [], failed: [] });
    } finally {
      process.env.GIJO_DOCS_MANIFEST = MANIFEST;
    }
  });
});

// 실제 리포지토리의 매니페스트가 가리키는 문서가 전부 존재하는지 — 여기가 깨지면 설치본의
// 지식베이스가 그만큼 비어 나간다(빌드 스크립트도 같은 이유로 누락 시 빌드를 세운다).
describe("docs-manifest.json — 실제 매니페스트 정합성", () => {
  it("열거된 제품 문서가 모두 리포지토리에 존재한다", () => {
    const repoManifest = path.resolve("docs-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(repoManifest, "utf-8")) as { files: { file: string }[] };
    expect(manifest.files.length).toBeGreaterThan(0);

    const repoRoot = path.resolve("..");
    const missing = manifest.files.map((f) => f.file).filter((f) => !fs.existsSync(path.join(repoRoot, f)));
    expect(missing).toEqual([]);
  });

  it("내부 개발 문서는 코퍼스에 넣지 않는다 — 고객사 노출 방지", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve("docs-manifest.json"), "utf-8")) as { files: { file: string }[] };
    const names = manifest.files.map((f) => f.file).join("|");
    // 실측(2026-07-19): 개발용 가이드를 근거로 주자 답변이 server/src/engine/assets.ts 경로를
    // 최종 사용자에게 그대로 노출했다. 개발·배포·계획 문서는 이름 단위로 막는다.
    expect(names).not.toMatch(/개발자|로컬LLM_프로젝트|배포_가이드|PC세팅|IA_통합설계|WSL2|계획서|다음단계|세션_산출물|제품_확인|UX피드백/);
  });
});
// ── 청커 판 재인입 (2026-09-08, ⓐ3) ─────────────────────────────────────────────
// 왜 여기가 필요한가: 청킹 규칙을 고쳐도 **문서 원문은 그대로**라 해시가 같고, 운영은
// 「그대로다」로 건너뛴다. 그러면 고친 청커가 영영 안 돈다 — 코드는 새것인데 지식은 옛 조각.
// (2026-07-31 「문서는 새것인데 지식은 헌것」의 청커판 재발이라, 그때처럼 사람이 기억해서
//  지웠다 넣는 절차로 두지 않는다.)
describe("docsbundle — 청커 판이 오르면 내장 문서가 다시 들어간다", () => {
  it("★★ 옛 판(청커 판이 안 섞인) 해시로 남아 있으면 skipped가 아니라 updated다", async () => {
    const sub = path.join(DOCS_DIR, "knowledge");
    fs.mkdirSync(sub, { recursive: true });
    const 파일 = path.join(sub, "청커판.md");
    const 원문 = "# 표가 있는 문서\n\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |";
    fs.writeFileSync(파일, 원문, "utf-8");
    writeManifest([{ file: "knowledge/청커판.md" }]);

    expect((await bootstrapDocsBundle()).ingested).toEqual(["knowledge/청커판.md"]);
    // 판이 그대로면 종전처럼 건너뛴다 — 매 기동 갈아엎지 않는다는 계약(위 시험)과 같은 뜻.
    expect((await bootstrapDocsBundle()).skipped).toEqual(["knowledge/청커판.md"]);

    // 청커 판이 오르기 **전에** 기록된 해시 = 원문만 해싱한 값. 그 상태를 그대로 만들어 둔다.
    const 옛해시 = createHash("sha256").update(원문, "utf8").digest("hex").slice(0, 16);
    db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("docsbundle:hash:청커판.md", 옛해시);

    const r = await bootstrapDocsBundle();
    expect(r.updated, "청커를 고쳐도 지식이 옛 조각 그대로면 이 라운드가 배포돼도 아무 일도 안 일어난다")
      .toEqual(["knowledge/청커판.md"]);
    expect((await listDocuments()).filter((d) => d.documentId === "청커판.md"), "재인입이 옛 조각을 안 지웠다")
      .toHaveLength(1);
  });

  it("★ 판을 섞는 자리는 **해시 한 곳**이다 — 소스 감시", () => {
    // 잣대가 둘이 되면(키 이름·매니페스트에도 판을 넣으면) 한쪽만 고쳐 어긋난다.
    const src = fs.readFileSync(path.resolve("src/engine/docsbundle.ts"), "utf-8");
    const 해시줄 = src.split("\n").filter((l) => l.startsWith("const hashOf = "));
    expect(해시줄, "hashOf가 한 줄이 아니다 — 잣대가 갈렸다").toHaveLength(1);
    expect(해시줄[0], "청커 판이 해시에서 빠졌다 — 청커를 고쳐도 내장 문서가 다시 안 들어간다")
      .toContain("CHUNKER_VERSION");
    expect(src.split("\n").filter((l) => l.startsWith("const HASH_KEY = "))[0],
      "키 이름에도 판을 넣으면 옛 키가 쓰레기로 남는다 — 판은 해시에만").not.toContain("CHUNKER_VERSION");
  });
});
