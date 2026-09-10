// test/reingestoriginal.test.ts — **다시 넣기가 원본에서 다시 뽑는다**(갈래 D, 2026-09-10).
//
// ■ 무엇이 문제였나
//   2026-09-08~10에 추출기가 워드·pptx·PDF의 표를 파이프 표로, pptx의 슬라이드 경계·도해·노트를
//   살리게 됐다. 그런데 **이미 반입된 문서는 옛 추출본 그대로**다 — 「<문서> 다시 넣어줘」
//   (reingest_document → memory.reingestFromExtracted)가 추출본(.md)만 다시 넣었기 때문이다.
//   즉 추출기를 아무리 고쳐도 **어제 올린 문서에는 하나도 안 닿았다.** 사람이 그 파일을 손수
//   다시 올리는 길만 있었는데, 원본은 이미 서버 `data/docs/uploads/`에 **보관본**으로 있다.
//
// ■ 첫 판이 추출본만 읽은 이유와, 그것이 여기서 성립하지 않는 이유
//   주석에 적힌 걱정은 「그 사이 원본이 바뀌었으면 다른 문서가 들어간다」였다. 우리가 읽는 원본은
//   사용자의 원래 자리가 아니라 **우리가 넣어 둔 보관본**이라 제품 말고는 아무도 안 건드린다.
//   그래서 「그때 그 파일 · 오늘의 추출기」가 된다.
//
// ■ 이 시험이 재는 것
//   ① 원본 보관본 + 추출 필요 형식이면 **원본에서 다시 뽑는다**(추출본 .md도 새 글로 갱신 · source="original")
//   ② 반증 — 원본이 없으면 종전대로 추출본이고 표가 **안 생긴다**(source="extracted")
//   ③ INGEST_ROOT **밖** sourcePath는 안 읽는다(관문) — 추출본으로 폴백하고 사유를 남긴다
//   ④ 다시 뽑기가 실패하면(깨진 원본·스캔 문서) 추출본으로 폴백한다 — 조각을 날리지 않는다
//   ⑤ 등급·업무영역·검색 범위가 보존된다
//   ⑥ 도구 문장이 **어느 길이었는지** 정직하게 말한다(폴백에 「원본에서 뽑았다」를 붙이지 않는다)
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// LanceDB 경로는 모듈 로드 시점에 굳는다 — import 전에 임시 디렉터리로 고정한다.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-reingest-"));
process.env.GIJO_MEMORY_DB_PATH = path.join(tmp, "lancedb");

// ⚠ GIJO_INGEST_ROOT는 **여기서 안 바꾼다**(docchunkgaps.test가 실측으로 배운 함정).
//   memory.ts가 INGEST_ROOT를 모듈 로드 시점에 굳히는데 setupFiles가 이 파일보다 먼저 memory를
//   끌어 올린다. 그 뒤에 env를 바꾸면 **시험만 새 값을 보고 제품은 옛 값을 본다.**
//   vitest 설정이 정해 둔 격리 경로(data/test-tmp/ingest)를 제품과 **같이** 쓴다.
const 인입뿌리 = path.resolve(process.env.GIJO_INGEST_ROOT ?? "data");
const 업로드칸 = path.join(인입뿌리, "docs", "uploads");
const 추출칸 = path.join(인입뿌리, "docs", "extracted");

// ⚠ embed는 잎 모듈이라 llm만 목하면 진짜 embed가 돌아 임베딩 서버를 찾다 실패한다.
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(),
  registerLlmRoutes: vi.fn(),
}));

const { reingestFromExtracted, listDocuments, deleteDocument, getDocumentChunks } = await import("../src/engine/memory");
const { db } = await import("../src/db");
const { runReingestDocument } = await import("../src/engine/agenttools/handlers");

// ── 표 인지는 **제품 잣대를 안 부르고** 여기 다시 적어 잰다(tableextract.test와 같은 이유:
//    제품이 자기 잣대로 「표다」라고 답하면 잣대가 틀렸을 때 시험도 함께 틀린다).
const 구분선있음 = (s: string) => s.split("\n").some((l) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l));

/** 이 시험이 만드는 문서 이름 — 인입 뿌리는 워커끼리 **공유**하는 디스크라 이름을 겹치지 않게 짓는다. */
const 표문서 = "다시넣기시험_표.docx";
const 원본없음 = "다시넣기시험_원본없음.docx";
const 밖경로 = "다시넣기시험_밖경로.docx";
const 깨진원본 = "다시넣기시험_깨진원본.docx";
const 글자원본 = "다시넣기시험_글자원본.md";
const 이름들 = [표문서, 원본없음, 밖경로, 깨진원본, 글자원본];

/** 옛 추출본 — 표가 **평문으로 뭉개진** 그 모양(2026-09-08 전 추출기가 내던 글). */
const 옛추출본 = [
  "표 앞 문단입니다",
  "구분 대상 조치 취약점 srv-web-01 패치 적용 설정 srv-db-02 접근제어 강화",
  "표 사이 문단",
].join("\n\n");

/** 대장 한 줄 — 등급·업무영역까지 실어 둔다(보존되는지 재려면 값이 있어야 한다). */
function 대장에넣기(documentId: string, opts: { sourcePath?: string | null; chunks?: number } = {}) {
  db.prepare(
    `INSERT INTO memory_documents (documentId, scope, chunks, embeddingModel, sourcePath, ingestedAt, grade, category)
     VALUES (?, 'global', ?, 'bge-m3', ?, ?, 'C', '보안관제')
     ON CONFLICT(documentId) DO UPDATE SET chunks=excluded.chunks, sourcePath=excluded.sourcePath`,
  ).run(documentId, opts.chunks ?? 1, opts.sourcePath ?? null, new Date().toISOString());
}
const 대장읽기 = (id: string) =>
  db.prepare("SELECT chunks, grade, category, scope, sourcePath FROM memory_documents WHERE documentId = ?").get(id) as
    { chunks: number; grade: string | null; category: string | null; scope: string; sourcePath: string | null } | undefined;

const 추출본읽기 = (id: string) => fs.readFileSync(path.join(추출칸, id + ".md"), "utf8");

beforeAll(() => {
  fs.mkdirSync(업로드칸, { recursive: true });
  fs.mkdirSync(추출칸, { recursive: true });
  // 원본 보관본 — 표 3개가 들어 있는 실제 워드 픽스처(tableextract.test와 같은 파일).
  fs.copyFileSync(path.join(__dirname, "fixtures", "table.docx"), path.join(업로드칸, 표문서));
  fs.copyFileSync(path.join(__dirname, "fixtures", "table.docx"), path.join(업로드칸, 밖경로));
  fs.writeFileSync(path.join(업로드칸, 깨진원본), Buffer.from("PK깨진 파일입니다"), "binary");
  fs.writeFileSync(path.join(업로드칸, 글자원본), "# 글자 문서\n원본과 추출본이 같은 글자인 형식입니다.", "utf8");
});

afterAll(async () => {
  for (const d of await listDocuments()) if (이름들.includes(d.documentId)) await deleteDocument(d.documentId);
  for (const n of 이름들) {
    fs.rmSync(path.join(업로드칸, n), { force: true });
    fs.rmSync(path.join(추출칸, n + ".md"), { force: true });
  }
  db.prepare(`DELETE FROM memory_documents WHERE documentId IN (${이름들.map(() => "?").join(",")})`).run(...이름들);
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  // 옛 추출본을 매번 원래 모양으로 되돌린다 — 앞 시험이 새 글로 덮어 두면 뒤 시험이 헛초록이 된다.
  for (const n of 이름들) fs.writeFileSync(path.join(추출칸, n + ".md"), 옛추출본, "utf8");
});

describe("① 원본이 보관돼 있으면 **오늘의 추출기로 다시 뽑는다**", () => {
  it("★ 표가 평문으로 뭉개져 있던 문서가 파이프 표로 다시 들어간다 (source: original)", async () => {
    대장에넣기(표문서, { sourcePath: path.join(업로드칸, 표문서) });
    expect(구분선있음(추출본읽기(표문서)), "준비가 틀렸다 — 옛 추출본에 이미 표가 있으면 이 시험은 아무것도 안 잰다").toBe(false);

    const r = await reingestFromExtracted(표문서);

    expect(r, "다시 넣기가 아무것도 못 했다").toBeTruthy();
    expect(r!.source, "원본이 보관돼 있는데 추출본에서 넣었다 — 추출기 수리가 기존 문서에 안 닿는다").toBe("original");
    expect(r!.fallbackReason, "원본 길로 갔는데 폴백 사유가 붙었다").toBeUndefined();
    // 추출본(.md)도 새 글로 맞춘다 — 「내 문서」의 추출본 보기가 조각과 다른 글을 보이면 못 믿는다.
    expect(구분선있음(추출본읽기(표문서)), "조각만 새 글이고 추출본은 옛 글이다 — 화면과 지식이 갈린다").toBe(true);
    // 조각에 실제로 표가 들어갔나 — 파일만 보고 「됐다」 하면 조각은 옛것일 수 있다.
    const 조각 = await getDocumentChunks(표문서, 50);
    expect(조각.length, "조각이 하나도 안 들어갔다").toBeGreaterThan(0);
    expect(구분선있음(조각.map((c) => c.text).join("\n")), "새 추출본은 표인데 조각에는 표가 없다").toBe(true);
    expect(조각.map((c) => c.text).join("\n"), "표 안 값이 사라졌다").toContain("srv-web-01");
  });

  it("★ 등급·검색 범위·원본 경로가 그대로 이어진다 — 다시 넣었더니 기밀이 공개가 되면 안 된다", async () => {
    대장에넣기(표문서, { sourcePath: path.join(업로드칸, 표문서) });
    await reingestFromExtracted(표문서);
    const 줄 = 대장읽기(표문서)!;
    expect(줄.grade, "등급이 비면 gradeOf가 기본값 공개(O)로 읽는다 — 기밀이 조용히 넓어진다").toBe("C");
    expect(줄.scope).toBe("global");
    expect(줄.sourcePath, "원본 경로가 끊기면 다음 다시 넣기가 또 추출본으로 떨어진다").toBe(path.join(업로드칸, 표문서));
    expect(줄.chunks, "대장 조각 수가 안 갱신됐다 — 화면이 옛 숫자를 말한다").toBeGreaterThan(0);
  });

  it("★ 업무영역은 **규칙이 다시 매긴다** — 지키는 것은 사람이 매긴 표찰(등급)뿐이라는 계약", async () => {
    // 첫 판 시험은 여기서 「보안관제 그대로」를 기대했다가 빨개졌다 — 제품이 틀린 게 아니라
    // **내 기대가 틀렸다.** memory.ts 문서표찰 주석의 계약이다: 「사람이 고쳐도 재인입이면 규칙이
    // 다시 덮으므로 규칙에 둔다」(용어사전이 위협대응으로 잡히던 2026-09-03 실측이 근거).
    // ⚠ 원본에서 다시 뽑으면 글이 달라지므로 이 값은 **실제로 바뀔 수 있다.** 그 사실을 여기 못 박아
    //   두지 않으면, 도구 문구가 「업무영역 그대로」라고 약속한 채 조용히 어긋난다(그래서 문구를 고쳤다).
    대장에넣기(표문서, { sourcePath: path.join(업로드칸, 표문서) });
    await reingestFromExtracted(표문서);
    const 줄 = 대장읽기(표문서)!;
    expect(줄.category, "업무영역이 통째로 비었다 — 화면 맥락 검색 축이 사라진다").toBeTruthy();
    expect(["취약점", "장비운영", "사내규정", "위협대응", "일반"], "업무영역 5종 밖의 값이 들어갔다").toContain(줄.category);
  });
});

describe("② 반증 — 원본 길을 못 쓰면 **종전대로** 추출본이고, 그렇게 말한다", () => {
  it("★★ 원본이 없으면 source=\"extracted\"이고 표가 **안 생긴다**(원본 길을 끄면 이 파일 ①이 빨개진다)", async () => {
    대장에넣기(원본없음, { sourcePath: null });
    const r = await reingestFromExtracted(원본없음);
    expect(r!.source).toBe("extracted");
    expect(r!.fallbackReason, "원본이 아예 없는 것은 폴백이 아니다 — 사유를 붙이면 없던 실패를 지어내는 셈이다").toBeUndefined();
    expect(구분선있음(추출본읽기(원본없음)), "원본이 없는데 표가 생겼다 — 어디선가 글을 지어냈다").toBe(false);
    const 조각 = await getDocumentChunks(원본없음, 50);
    expect(조각.map((c) => c.text).join("\n")).toContain("표 앞 문단입니다");
  });

  it("★ INGEST_ROOT **밖** sourcePath는 안 읽는다 — 추출본으로 폴백하고 사유를 남긴다", async () => {
    // 대장의 sourcePath는 built-in 코퍼스처럼 다른 자리를 가리킬 수 있다. 임의 경로를 읽어 주면
    // 「서버가 읽을 수 있는 아무 파일이나 지식이 된다」가 되살아난다(2026-07-19에 막은 그 구멍).
    const 밖 = path.join(tmp, "밖에있는원본.docx");
    fs.copyFileSync(path.join(__dirname, "fixtures", "table.docx"), 밖);
    대장에넣기(밖경로, { sourcePath: 밖 });

    const r = await reingestFromExtracted(밖경로);

    expect(r!.source, "인입 뿌리 밖 파일을 읽어 지식으로 넣었다").toBe("extracted");
    expect(r!.fallbackReason, "왜 원본을 안 썼는지 말하지 않으면 사용자는 새 추출기가 돈 줄 안다").toMatch(/허용 범위 밖/);
    expect(r!.fallbackReason, "서버 디렉터리 구조를 문장에 실었다").not.toContain(인입뿌리);
    expect(구분선있음(추출본읽기(밖경로)), "밖에 있는 원본을 실제로 읽었다").toBe(false);
  });

  it("★ 원본을 다시 뽑다 실패하면 추출본으로 되돌아간다 — 조각을 날리지 않는다(스캔 문서·깨진 파일 갈래)", async () => {
    대장에넣기(깨진원본, { sourcePath: path.join(업로드칸, 깨진원본) });
    const r = await reingestFromExtracted(깨진원본);
    expect(r, "다시 뽑기가 실패했다고 아무것도 안 넣으면, 멀쩡하던 조각이 사라진 채 남는다").toBeTruthy();
    expect(r!.source).toBe("extracted");
    expect(r!.fallbackReason, "실패를 삼키면 「새 추출기로 읽었다」가 거짓이 된다").toBeTruthy();
    const 조각 = await getDocumentChunks(깨진원본, 50);
    expect(조각.map((c) => c.text).join("\n")).toContain("표 앞 문단입니다");
  });

  it("추출이 필요 없는 형식(.md)은 원본을 다시 뽑지 않는다 — 같은 글자를 두 번 읽을 값어치가 없다", async () => {
    대장에넣기(글자원본, { sourcePath: path.join(업로드칸, 글자원본) });
    const r = await reingestFromExtracted(글자원본);
    expect(r!.source).toBe("extracted");
    expect(r!.fallbackReason, "형식이 애초에 대상이 아닌 것을 「실패」로 적으면 사용자가 고장으로 읽는다").toBeUndefined();
    expect(추출본읽기(글자원본), "대상이 아닌데 추출본을 덮었다").toBe(옛추출본);
  });
});

describe("③ 도구 문장·감사 — 어느 길이었는지 **정직하게** 말한다", () => {
  it("★ 원본 길이면 「원본에서 다시 뽑아 넣었습니다」라고 말한다", async () => {
    대장에넣기(표문서, { sourcePath: path.join(업로드칸, 표문서), chunks: 1 });
    const 답 = await runReingestDocument({ document: 표문서 });
    expect(답).toContain("원본에서 다시 뽑아 넣었습니다");
    expect(답, "옛 문장이 남아 있다 — 새 추출기로 읽었는데 「추출본에서 넣었다」고 말한다").not.toContain("추출본에서 다시 넣었습니다");
  });

  it("★ 폴백이면 「추출본에서」라고 말하고 **사유까지** 밝힌다 — 원본을 못 읽었는데 읽었다고 하지 않는다", async () => {
    대장에넣기(깨진원본, { sourcePath: path.join(업로드칸, 깨진원본), chunks: 1 });
    const 답 = await runReingestDocument({ document: 깨진원본 });
    expect(답).toContain("추출본에서 다시 넣었습니다");
    expect(답, "폴백인데 「원본에서 다시 뽑았다」고 말한다 — 이 라운드가 막으려는 바로 그 거짓말이다").not.toContain("원본에서 다시 뽑아 넣었습니다");
    expect(답, "왜 예전 글로 넣었는지 안 밝히면 사용자는 표가 왜 그대로인지 모른다").toMatch(/원본에서 다시 뽑으려 했으나/);
  });

  it("★ 감사 기록에 **길**이 남는다 — 나중에 「그때 새 추출기로 읽었나」를 셀 수 있다", async () => {
    대장에넣기(표문서, { sourcePath: path.join(업로드칸, 표문서), chunks: 1 });
    await runReingestDocument({ document: 표문서 });
    const 줄 = db.prepare(
      "SELECT detail FROM audit_log WHERE target = ? AND action LIKE '%재인입%' ORDER BY rowid DESC LIMIT 1",
    ).get(표문서) as { detail: string } | undefined;
    expect(줄, "쓰기 도구가 돌았는데 감사 기록이 없다").toBeTruthy();
    expect(줄!.detail).toContain("보관 원본에서 다시 추출");
  });
});

describe("④ 소스 감시 — 원본 길이 관문을 우회하지 않는다", () => {
  it("★ 원본 경로는 assertWithinIngestRoot를 **반드시** 지난다", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/memory.ts"), "utf8");
    const 시작 = src.indexOf("export async function reingestFromExtracted");
    expect(시작, "함수 이름이 바뀌었다 — 이 감시가 조용히 아무것도 안 보게 된다").toBeGreaterThan(0);
    const 본문 = src.slice(시작, 시작 + 4000);
    expect(본문, "보관 원본을 관문 없이 읽는다 — 임의 경로가 지식이 되는 길이 열린다").toContain("assertWithinIngestRoot(원본)");
    expect(본문, "추출본 쓰기를 손으로 다시 적었다 — 잣대는 saveDocArtifacts 한 곳이다").toContain("saveDocArtifacts(");
  });

  it("★ 약속과 코드가 맞는가 — 결재판 문구가 **지켜지지 않는 보존**을 약속하지 않는다", () => {
    // 2026-09-10 적발: effect가 「업무영역·등급·검색 범위는 그대로 유지」라고 적혀 있었는데,
    // 업무영역은 재인입이면 규칙이 다시 매긴다(위 시험). 결재판은 사람이 **승인 직전에 읽는 글**이라
    // 여기 거짓이 실리면 승인 자체가 잘못된 정보 위에서 이뤄진다.
    const reg = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools/registry.ts"), "utf8");
    const 시작 = reg.indexOf('name: "reingest_document"');
    expect(시작, "도구 이름이 바뀌었다 — 이 감시가 조용히 아무것도 안 보게 된다").toBeGreaterThan(0);
    const 되넣기 = reg.slice(시작, 시작 + 1600);
    expect(되넣기, "지켜지지 않는 보존을 약속한다").not.toContain("업무영역·등급·검색 범위는 그대로 유지");
    expect(되넣기, "원본에서 다시 뽑는다는 새 동작을 결재판이 말하지 않는다").toMatch(/원본이 보관돼 있으면/);
  });

  it("★ 죽은 import를 남기지 않는다 — handlers.ts가 안 쓰는 observability를 끌고 있었다", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools/handlers.ts"), "utf8");
    const 쓰는가 = /systemHealthText\s*\(/.test(src);
    const 들이는가 = /import\s*\{[^}]*systemHealthText[^}]*\}\s*from/.test(src);
    expect(들이는가 && !쓰는가, "안 쓰는 이름을 import한다 — 모듈이 통째로 딸려 들어와 로드 사슬만 길어진다").toBe(false);
  });
});
