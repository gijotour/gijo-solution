// 「올렸는데 왜 답을 못 하지」 — **조각이 사라진 문서**를 제품이 스스로 말한다. (계획서 전-4 · 2026-09-07)
//
// ■ 무엇이 문제였나 (운영 실측 2026-09-07)
//   반입 대장(`memory_documents`) 3,921줄 · 지식 저장소(LanceDB) 3,920건. 차이 한 편은
//   `2025년 사이버 위협 전망.pdf`(대장에 21조각이라 적혀 있는데 저장소에 0조각)였다.
//   그런데 `listDocuments()`가 **LanceDB 집계만** 순회해서 그 문서는 목록에 아예 안 떴다 —
//   담당자 눈에는 **올린 적 없는 문서**로 보인다. 「올렸는데 왜 답을 못 하지」의 정체가 이것이다.
//
// ■ 이 시험이 재는 것
//   ① listDocuments가 대장 잔여 줄을 담는가(이 시험은 수리 전에는 **빨갛다** — 그게 고치는 결함이다)
//   ② 유령이 0건이면 **아무것도 안 바뀌는가**(헛변경 0 · 반증)
//   ③ docsbundle 자가치유가 유령 때문에 멈추지 않는가(되치기 감시 · 최우선 연쇄)
//   ④ 「지식 N건」·인수인계가 못 읽는 문서를 세지 않고 **따로 말하는가**
//   ⑤ 되넣기가 추출본 없이 성공이라 적지 않는가 + 기동·스케줄이 몰래 되넣지 않는가
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB·문서 경로는 모듈 로드 시점에 읽힌다 — import 전에 임시 디렉터리로 고정한다
// (개발 머신의 실제 data/memory.lancedb·제품 문서를 건드리지 않는다. docsbundle.test와 같은 방식).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-docgaps-"));
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "lancedb");
const MANIFEST = path.join(tmp, "docs-manifest.json");
const DOCS_DIR = path.join(tmp, "docs");
process.env.GIJO_DOCS_MANIFEST = MANIFEST;
process.env.GIJO_DOCS_DIR = DOCS_DIR;
// ⚠ GIJO_INGEST_ROOT는 **여기서 안 바꾼다**(2026-09-07 실측으로 배운 함정).
//   memory.ts는 INGEST_ROOT를 **모듈 로드 시점에** 굳히는데, setupFiles(test/setup.ts → auth → db)가
//   이 파일보다 **먼저** 돌면서 memory를 끌어 올린다. 그 뒤에 env를 바꿔 봐야 제품은 옛 값을 보고,
//   시험만 새 값을 봐서 「파일은 분명히 있는데 제품은 없다고 한다」가 된다(실제로 겪었다).
//   그래서 vitest 설정이 정해 둔 격리 경로(data/test-tmp/ingest)를 **제품과 같이** 쓴다.
const 인입뿌리 = path.resolve(process.env.GIJO_INGEST_ROOT ?? "data");

// ⚠ embed는 잎 모듈이라 llm만 목하면 **진짜 embed가 돌아** 임베딩 서버를 찾다 실패한다(docsbundle.test 실측).
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { bootstrapDocsBundle } = await import("../src/engine/docsbundle");
const { listDocuments, ingestText, deleteDocument, reingestFromExtracted } = await import("../src/engine/memory");
const { db } = await import("../src/db");
const { runKnowledgeStatus, runHandoverStatus, runDocChunkGaps, runReingestDocument } = await import("../src/engine/agenttools/handlers");

/** 유령 만들기 — 대장에는 줄이 있는데 저장소에 조각이 0개. 운영에서 벌어진 그 상태 그대로다. */
function 대장에만넣기(documentId: string, chunks: number, scope = "global", origin: string | null = null) {
  db.prepare(
    `INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt, origin)
     VALUES (?, ?, ?, 'bge-m3', NULL, ?, ?)
     ON CONFLICT(documentId) DO UPDATE SET chunks=excluded.chunks, scope=excluded.scope, origin=excluded.origin`,
  ).run(documentId, scope, chunks, new Date().toISOString(), origin);
}
const 대장비우기 = () => db.prepare("DELETE FROM memory_documents").run();

beforeAll(() => {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, "매뉴얼.md"), "# 사용자 매뉴얼\n대시보드는 오늘 할 일을 먼저 보여줍니다.", "utf-8");
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("① listDocuments — 대장에만 남은 줄도 돌려준다 (수리 전에는 빨갛다)", () => {
  beforeEach(async () => {
    대장비우기();
    for (const d of await listDocuments()) await deleteDocument(d.documentId);
    대장비우기();
  });

  it("★ 대장 1줄 + 저장소 0조각이면 **목록에 뜬다** — 지금까지는 통째로 사라졌다", async () => {
    대장에만넣기("2025년 사이버 위협 전망.pdf", 21);
    const 목록 = await listDocuments();
    const 유령 = 목록.find((d) => d.documentId === "2025년 사이버 위협 전망.pdf");
    expect(유령, "대장에만 있는 문서가 목록에서 통째로 빠졌다 — 담당자 눈에 「올린 적 없는 문서」가 된다").toBeTruthy();
    expect(유령!.chunks, "지금 저장소에 있는 조각 수는 0이다(대장의 21을 여기 쓰면 거짓이 된다)").toBe(0);
    expect(유령!.ledgerChunks, "대장이 적어 둔 값은 따로 실린다").toBe(21);
    expect(유령!.docState).toBe("missing");
  });

  it("scope는 **메타에서** 온다 — 빠뜨리면 증류 코퍼스의 global 필터에서 조용히 샌다", async () => {
    대장에만넣기("사내규정_유령.md", 3, "team-보안");
    const 줄 = (await listDocuments()).find((d) => d.documentId === "사내규정_유령.md");
    expect(줄!.scope, "scope가 undefined면 learncandidates의 scope==='global' 비교가 조용히 false가 된다").toBe("team-보안");
  });

  it("★★ 반증 — 유령이 0건이면 **한 글자도 안 바뀐다**(헛변경 0)", async () => {
    await ingestText("정상문서.md", "가나다라마바사 아자차카타파하. 정상적으로 반입된 문서입니다.", "global");
    const 목록 = await listDocuments();
    expect(목록.length, "유령이 없는데 줄이 늘었다 — 이 라운드가 없던 줄을 만들어 냈다").toBe(1);
    const d = 목록[0];
    expect(d.docState, "정상 문서에 상태 딱지가 붙었다").toBe("ok");
    expect(d.chunks).toBe(d.ledgerChunks);
    // 옛 칸은 **그대로**여야 한다 — 새 칸 둘을 뺀 나머지가 수리 전 모양과 같다.
    const { ledgerChunks, docState, ...옛모양 } = d;
    expect(Object.keys(옛모양).sort()).toEqual(
      ["category", "chunks", "docClass", "documentId", "embeddingModel", "grade", "hasSource", "ingestedAt", "origin", "scope", "uploadedBy"],
    );
  });
});

describe("② docsbundle 자가치유 — 유령을 보이게 하려다 **고정시키면** 안 된다", () => {
  beforeEach(async () => {
    대장비우기();
    for (const d of await listDocuments()) await deleteDocument(d.documentId);
    대장비우기();
  });

  it("★ 조각을 잃은 내장 문서는 기동에서 **다시 인입된다**", async () => {
    fs.writeFileSync(MANIFEST, JSON.stringify({ scope: "global", files: [{ file: "매뉴얼.md" }] }), "utf-8");
    const 첫판 = await bootstrapDocsBundle();
    expect(첫판.ingested).toEqual(["매뉴얼.md"]);

    // 조각만 사라진 상태를 만든다 — 대장 줄은 남기고(운영에서 벌어진 그 모양) 해시도 그대로 둔다.
    await deleteDocument("매뉴얼.md");
    대장에만넣기("매뉴얼.md", 1, "global", "builtin");
    expect((await listDocuments()).find((d) => d.documentId === "매뉴얼.md")!.docState).toBe("missing");

    const 둘째판 = await bootstrapDocsBundle();
    expect(둘째판.skipped, "유령이 skipped로 빠졌다 — 자가치유가 **영영 멈춘다**(이 라운드가 손해가 된다)").toEqual([]);
    expect(둘째판.ingested).toEqual(["매뉴얼.md"]);
    const 나은뒤 = (await listDocuments()).find((d) => d.documentId === "매뉴얼.md")!;
    expect(나은뒤.docState, "다시 넣었는데도 상태가 안 나았다 — 다음 기동마다 무한 재인입이 된다").toBe("ok");
    expect(나은뒤.chunks).toBeGreaterThan(0);
  });

  it("★ 판이 어긋난 문서(반쪽 유령)도 다시 맞춘다 — 이름만 같으면 건너뛰던 자리", async () => {
    fs.writeFileSync(MANIFEST, JSON.stringify({ scope: "global", files: [{ file: "매뉴얼.md" }] }), "utf-8");
    await bootstrapDocsBundle();
    db.prepare("UPDATE memory_documents SET chunks = 99 WHERE documentId = ?").run("매뉴얼.md");
    expect((await listDocuments()).find((d) => d.documentId === "매뉴얼.md")!.docState).toBe("short");

    const r = await bootstrapDocsBundle();
    expect(r.skipped, "조각 수가 어긋나 있는데 해시가 같다고 건너뛰었다").toEqual([]);
    expect((await listDocuments()).find((d) => d.documentId === "매뉴얼.md")!.docState).toBe("ok");
  });

  it("정상 문서는 **그대로 건너뛴다** — 기동마다 다시 넣지 않는다(헛변경 0)", async () => {
    fs.writeFileSync(MANIFEST, JSON.stringify({ scope: "global", files: [{ file: "매뉴얼.md" }] }), "utf-8");
    await bootstrapDocsBundle();
    const r = await bootstrapDocsBundle();
    expect(r.ingested, "멀쩡한 문서를 기동마다 다시 넣는다 — 임베딩을 헛돌린다").toEqual([]);
    expect(r.skipped).toEqual(["매뉴얼.md"]);
  });
});

describe("③ 되넣기 — 못 넣었으면 **못 넣었다고** 한다", () => {
  beforeEach(async () => {
    대장비우기();
    for (const d of await listDocuments()) await deleteDocument(d.documentId);
    대장비우기();
  });

  it("★ 추출본이 없으면 null이고 대장 chunks는 **한 칸도 안 바뀐다**", async () => {
    대장에만넣기("추출본없는유령.pdf", 21);
    const r = await reingestFromExtracted("추출본없는유령.pdf");
    expect(r, "넣을 글자가 없는데 성공을 돌려줬다 — 「고쳤다」가 거짓이 된다").toBeNull();
    const 그대로 = db.prepare("SELECT chunks FROM memory_documents WHERE documentId = ?").get("추출본없는유령.pdf") as { chunks: number };
    expect(그대로.chunks, "실패했는데 대장 값을 건드렸다").toBe(21);
    expect((await listDocuments()).find((d) => d.documentId === "추출본없는유령.pdf")!.docState).toBe("missing");
  });

  it("대장에 줄이 없으면 던진다 — 없는 문서를 조용히 만들지 않는다", async () => {
    await expect(reingestFromExtracted("있지도않은문서.md")).rejects.toThrow(/대장/);
  });

  it("이름에 경로가 섞이면 던진다 — 남의 추출본을 가리키는 길을 막는다", async () => {
    await expect(reingestFromExtracted("../../etc/passwd")).rejects.toThrow(/이름/);
  });

  it("★ 추출본이 있으면 **되살아난다** — 조각이 0에서 늘고 상태가 ok가 된다", async () => {
    const 추출본 = path.join(인입뿌리, "docs", "extracted");
    fs.mkdirSync(추출본, { recursive: true });
    // ⚠ 추출본 파일 이름은 **문서 id 뒤에 .md를 붙인 것**이다(saveDocArtifacts) — 「보고서.pdf」의
    //   추출본은 「보고서.pdf.md」다. 시험이 「보고서.md」로 적으면 제품은 못 찾고 **거짓 빨강**이 난다
    //   (2026-09-07에 실제로 겪었다 — 제품이 아니라 시험이 규약을 몰랐다).
    fs.writeFileSync(path.join(추출본, "되살릴문서.pdf.md"), "# 되살릴 문서\n방화벽 정책 점검 절차는 분기마다 수행합니다. 담당자는 결과를 기록합니다.", "utf-8");
    대장에만넣기("되살릴문서.pdf", 5);
    const r = await reingestFromExtracted("되살릴문서.pdf", "시험담당자");
    expect(r).not.toBeNull();
    expect(r!.chunks).toBeGreaterThan(0);
    expect((await listDocuments()).find((d) => d.documentId === "되살릴문서.pdf")!.docState).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 소스 감시 — 자율이 사람을 건너뛰지 않는다 · 판정이 두 벌이 되지 않는다
describe("④ 계약(소스 감시)", () => {
  const 뿌리 = path.join(__dirname, "..", "src");
  const 읽기 = (p: string) => fs.readFileSync(path.join(뿌리, p), "utf8");

  it("★ 기동·스케줄 어디에서도 되넣기를 **부르지 않는다** — 사람이 승인할 때만 돈다", () => {
    // 「내가 안 시킨 문서가 다시 들어왔다」를 막는다. 부르는 곳은 도구 하나(runReingestDocument)뿐이다.
    // ⚠⚠ 이 목록에 **없는 파일 이름을 적으면 감시가 0줄을 잰다**(2026-09-07 검토관 적발).
    //   처음 판은 `engine/scheduler.ts`를 적어 뒀는데 이 저장소에 없는 파일이었고, 아래 루프가
    //   `existsSync`로 조용히 건너뛰어 **실제 스케줄 파일 셋(alertschedule·reportschedule·tonewatch)은
    //   한 줄도 감시되지 않았다.** 돌연변이로 실증했다 — reportschedule.ts에 호출을 심어도 초록이었다.
    //   그래서 이제 **없으면 건너뛰지 않고 빨개진다**(이름이 바뀌었으면 목록을 고치라는 뜻이다).
    const 후보 = [
      "index.ts", "engine/docsbundle.ts", "engine/kbhygiene.ts", "engine/watchfolder.ts",
      "engine/alertschedule.ts", "engine/reportschedule.ts", "engine/tonewatch.ts",
    ];
    for (const f of 후보) {
      const p = path.join(뿌리, f);
      expect(fs.existsSync(p), `감시 대상 ${f}가 없다 — 이름이 바뀌었으면 이 목록을 고쳐야 한다(조용히 건너뛰면 감시가 없는 것과 같다)`).toBe(true);
      expect(fs.readFileSync(p, "utf8"), `${f}가 되넣기를 스스로 부른다 — 사람 승인을 건너뛴다`).not.toContain("reingestFromExtracted");
    }
  });

  it("★ 되넣기 도구는 **쓰기**이고, 조회 도구는 아무것도 안 바꾼다", () => {
    const reg = 읽기("engine/agenttools/registry.ts");
    const 되넣기 = reg.slice(reg.indexOf('name: "reingest_document"'), reg.indexOf('name: "reingest_document"') + 900);
    expect(되넣기, "쓰기 도구가 아니면 결재판을 안 지난다").toContain("write: true");
    const 조회 = reg.slice(reg.indexOf('name: "doc_chunk_gaps"'), reg.indexOf('name: "doc_chunk_gaps"') + 900);
    expect(조회, "조회 도구가 쓰기로 등록돼 있다").toContain("write: false");
  });

  it("판정을 손으로 다시 적지 않는다 — 소비자들이 docledger를 통해 묻는다", () => {
    for (const f of ["engine/memory.ts", "engine/docsbundle.ts", "engine/kbhygiene.ts", "engine/agenttools/handlers.ts"]) {
      // ⚠ 상대경로는 자리마다 다르다 — agenttools/ 아래는 "../docledger"다. 글자 하나로 못 박으면
      //   멀쩡한 소비자를 「안 쓴다」고 하는 거짓 빨강이 난다.
      const src = 읽기(f);
      expect(src.includes(`from "./docledger"`) || src.includes(`from "../docledger"`),
        `${f}가 docledger를 안 쓴다 — 잣대가 두 벌이 된다`).toBe(true);
    }
  });

  it("★ 「판이 어긋남」도 **술어로** 묻는다 — 소비자에서 상태 문자열을 손으로 견주지 않는다", () => {
    // 2026-09-07 적발: docledger가 술어를 둘(조각없음·대장과같음)만 내보내서 셋째 갈래(short/extra)가
    // 소비자로 샜다 — handlers에 `d.docState === "short" || d.docState === "extra"`가 손으로 적혀 있었다.
    // 상태를 하나 더 만들면(예: stale) 그 줄만 조용히 빠진다. 판정은 docledger 한 곳이다.
    for (const f of ["engine/agenttools/handlers.ts", "engine/docsbundle.ts", "engine/kbhygiene.ts"]) {
      const src = 읽기(f);
      const 손비교 = src.split("\n").filter((l) => /docState\s*[=!]==\s*"/.test(l));
      expect(손비교, `${f}가 docState를 손으로 견준다:\n  ${손비교.join("\n  ")}`).toEqual([]);
    }
  });

  it("라이트 도구 목록에 조회는 넣고 되넣기는 **사유와 함께** 뺐다", () => {
    const lite = JSON.parse(읽기("lite/lite-tools.json")) as { tools: { id: string }[]; _뺀것_중_설명이_필요한_것: { id: string; 왜: string }[] };
    expect(lite.tools.map((t) => t.id)).toContain("doc_chunk_gaps");
    expect(lite.tools.map((t) => t.id), "라이트엔 결재판 화면이 없다 — 쓰기 도구를 넣으면 승인 없이 도는 길이 생긴다").not.toContain("reingest_document");
    const 뺀것 = lite._뺀것_중_설명이_필요한_것.find((x) => x.id === "reingest_document");
    expect(뺀것, "뺐는데 이유를 안 적었다 — 「조용히 없는 기능」이 된다").toBeTruthy();
    expect(뺀것!.왜.length).toBeGreaterThan(20);
  });
});

describe("⑤ 말하는 자리 — 못 읽는 문서를 「지식 N건」에 넣지 않는다", () => {
  beforeEach(async () => {
    대장비우기();
    for (const d of await listDocuments()) await deleteDocument(d.documentId);
    대장비우기();
  });

  it("★ 지식 현황 — 유령은 세지 않고 **따로** 말한다(감추지도 않는다)", async () => {
    await ingestText("정상문서.md", "가나다라마바사 아자차카타파하. 정상적으로 반입된 문서입니다.", "global");
    대장에만넣기("사라진문서.pdf", 21);
    const 답 = await runKnowledgeStatus();
    expect(답, "AI가 못 읽는 문서를 「지식 N건」에 넣어 말했다").toContain("장기기억 문서 1건");
    expect(답, "유령을 조용히 빼기만 하면 담당자는 왜 사라졌는지 영영 모른다").toContain("조각 없음 1건");
  });

  it("유령이 없으면 경고 줄도 없다 — 헛경보를 만들지 않는다", async () => {
    await ingestText("정상문서.md", "가나다라마바사 아자차카타파하. 정상적으로 반입된 문서입니다.", "global");
    const 답 = await runKnowledgeStatus();
    expect(답).not.toContain("조각 없음");
  });

  it("★ 인수인계 — 못 읽는 문서는 「인계할 자료」에서 빼되 몇 건인지 말한다", async () => {
    await ingestText("인계문서.md", "가나다라마바사 아자차카타파하. 인수인계에 담을 자료입니다.", "global");
    대장에만넣기("사라진자료.pdf", 7);
    const 답 = await runHandoverStatus();
    expect(답, "조각 없는 문서를 인계 자료 수에 넣었다 — 받는 사람이 없는 자료를 믿는다").toContain("문서 1건");
    expect(답).toContain("조각 없음 1건");
  });

  // ── 검토관 적발 (2026-09-07) — 「전부 유령」 갈래가 형제 함수마다 다르게 새고 있었다 ──────
  it("★ 인수인계 — **전부 유령**이면 「올린 문서가 없습니다」라고 하지 않는다", async () => {
    // 방아쇠: LanceDB 소실·재생성(이 저장소가 겪은 「lance optimize 깨짐→재생성」). 그때 대장은 그대로 남는다.
    // 형제 함수 runKnowledgeStatus는 이 갈래를 막았는데 인계 쪽 조기 반환에는 같은 가드가 없었다 — 반쪽 수리.
    대장에만넣기("사라진자료A.pdf", 7);
    대장에만넣기("사라진자료B.pdf", 3);
    const 답 = await runHandoverStatus();
    expect(답, "대장에 줄이 남아 있는데 「올린 적 없다」고 말한다 — 이 라운드가 없애려던 바로 그 거짓말이다")
      .not.toContain("아직 지식베이스에 올린 문서가 없습니다");
    expect(답, "몇 건이 왜 빠졌는지 말하지 않는다").toContain("조각 없음 2건");
  });

  it("★ 지식 현황 — **전부 유령**이면 빈 「범위별」·「최근 인입」을 꼬리로 달지 않는다", async () => {
    대장에만넣기("사라진문서.pdf", 21);
    const 답 = await runKnowledgeStatus();
    expect(답).toContain("조각 없음 1건");
    expect(답, "값 없는 「범위별: 」이 붙는다 — 답은 맞는데 망가진 답으로 읽힌다").not.toMatch(/범위별:\s*$/m);
    expect(답, "줄 없는 「최근 인입:」이 붙는다").not.toMatch(/최근 인입:\s*$/m);
  });

  it("★ 유령을 세는 **모집단이 세 자리에서 같다** — 배지와 목록이 다른 건수를 말하지 않는다", async () => {
    // 지식 현황의 ⚠ 문구가 「조각 없는 문서 알려줘」로 보낸다 — 따라갔더니 건수가 다르면 둘 다 못 믿는다.
    await ingestText("정상문서.md", "가나다라마바사 아자차카타파하. 정상적으로 반입된 문서입니다.", "global");
    대장에만넣기("사라진문서.pdf", 21);
    대장에만넣기("문답-2026-09-01.md", 1, "global", "approved-qa"); // 승인 문답도 유령이 될 수 있다
    const k = await runKnowledgeStatus();
    const h = await runHandoverStatus();
    const g = await runDocChunkGaps();
    expect(k).toContain("조각 없음 1건");
    expect(h).toContain("조각 없음 1건");
    expect(g, "지식 현황이 여기로 보내는데 건수가 다르다").toContain("조각이 없는 문서 1건");
    expect(g, "승인 문답 유령을 감추지는 않는다 — 빼되 몇 건인지 말한다").toContain("승인 문답");
  });
});

describe("⑥ 조각 없는 문서 도구 — 이름을 대고, 지우지 않는다", () => {
  beforeEach(async () => {
    대장비우기();
    for (const d of await listDocuments()) await deleteDocument(d.documentId);
    대장비우기();
  });

  it("★ 유령을 이름으로 짚고 대장에 적힌 조각 수를 함께 말한다", async () => {
    대장에만넣기("2025년 사이버 위협 전망.pdf", 21);
    const 답 = await runDocChunkGaps();
    expect(답).toContain("2025년 사이버 위협 전망.pdf");
    expect(답, "대장에 적힌 조각 수를 안 밝히면 얼마나 잃었는지 모른다").toContain("21");
    expect(답, "되돌리는 길을 안 알려 주면 목록만 보고 끝난다").toMatch(/다시 넣|다시 올려/);
  });

  it("0건이면 **실패 문구 없이** 정직하게 말한다 — 「찾지 못했습니다」는 서랍 점검이 실패로 읽는다", async () => {
    await ingestText("정상문서.md", "가나다라마바사 아자차카타파하. 정상적으로 반입된 문서입니다.", "global");
    const 답 = await runDocChunkGaps();
    expect(답).toContain("조각이 사라진 문서는 없습니다");
    expect(답, "정직한 0건에 실패 딱지가 붙는다").not.toContain("찾지 못했습니다");
  });

  it("★ 되넣기 도구는 추출본이 없으면 **던진다** — 「✅ 완료」로 보이면 복구된 줄 오해한다", async () => {
    대장에만넣기("추출본없음.pdf", 21);
    await expect(runReingestDocument({ document: "추출본없음.pdf" })).rejects.toThrow(/다시 올려/);
    const 그대로 = db.prepare("SELECT chunks FROM memory_documents WHERE documentId = ?").get("추출본없음.pdf") as { chunks: number };
    expect(그대로.chunks).toBe(21);
  });

  // ── 검토관 적발 (2026-09-07) ────────────────────────────────────────────────
  it("★ 0건 문구가 **견준 모집단**을 정직하게 이름 붙인다 — 대장에 줄이 없는 문서를 「대장의 N건」이라 하지 않는다", async () => {
    await ingestText("정상문서.md", "가나다라마바사 아자차카타파하. 정상적으로 반입된 문서입니다.", "global");
    db.prepare("DELETE FROM memory_documents WHERE documentId = ?").run("정상문서.md"); // 대장 줄만 지운다
    const 상태 = (await listDocuments()).find((d) => d.documentId === "정상문서.md")!;
    expect(상태.docState, "대장에 줄이 없으면 견줄 수가 없다").toBe("unknown");
    const 답 = await runDocChunkGaps();
    expect(답, "대장에 줄이 없는 문서까지 「반입 대장의 문서 N건」으로 셌다 — 견준 적 없는 모집단이다")
      .not.toMatch(/반입 대장의 문서 \d+건/);
    expect(답).toContain("조각이 사라진 문서는 없습니다");
  });

  it("★ 라이트에서는 「결재판을 거쳐 다시 넣습니다」라고 **안내하지 않는다** — 그 도구가 없다", async () => {
    // lite-tools.json이 reingest_document를 **사유와 함께** 뺐다("라이트에선 ＋로 다시 올리기까지만 안내").
    // 코드가 그 약속을 지키는지 잰다 — 안 지키면 라이트 사용자는 아무 데도 안 닿는 말을 안내받는다.
    대장에만넣기("2025년 사이버 위협 전망.pdf", 21);
    const { setToolAllowlist } = await import("../src/engine/agenttools/registry");
    const lite = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/lite/lite-tools.json"), "utf8")) as { tools: { id: string }[] };
    setToolAllowlist(lite.tools.map((t) => t.id));
    try {
      const 답 = await runDocChunkGaps();
      expect(답, "라이트엔 reingest_document가 없다 — 시킨 대로 쳐도 도착지가 없다").not.toContain("결재판");
      expect(답, "되돌리는 길 자체를 지우면 안 된다 — ＋로 다시 올리는 길은 라이트에도 있다").toContain("＋");
    } finally {
      setToolAllowlist(null); // ⚠ 되돌리지 않으면 뒤 시험들이 라이트 에디션으로 돈다
    }
  });

  it("표준에서는 되넣기 길을 그대로 안내한다 — 라이트 분기가 표준까지 지우지 않았다(반증)", async () => {
    대장에만넣기("2025년 사이버 위협 전망.pdf", 21);
    const 답 = await runDocChunkGaps();
    expect(답).toContain("결재판");
  });
});
