// test/tableextract.test.ts — **워드·pptx의 표를 표로 뽑는다**(갈래 T, 2026-09-08).
//
// ■ 증상 (정찰 실측 2026-09-08)
//   지식 조각 4,703개 중 파이프 표(머리글+구분선)를 가진 것이 **0개**다. 운영 추출본 21편에도
//   표 구분자가 아예 없다 — 탭 0줄·2칸 이상 정렬 0줄. 그런데 원본 오피스 파일에는 표 구조가
//   **무손실로** 들어 있다(제품소개_발표자료.pptx 표10·셀183 · AI_보안제품_기획_v11.docx 표5·셀92).
//   즉 「표가 없는 문서」가 아니라 **추출기가 표를 버리고 있었다.**
//
// ■ 뿌리
//   dataset.ts 오피스추출()이 <w:t>/<a:t>만 긁고 <w:tbl>/<a:tbl>·행·칸을 안 본다. 그래서 표
//   183칸이 공백으로 이어붙은 한 덩어리가 되고, 「어느 칸이 무슨 열인가」가 통째로 사라진다.
//   (기획 docx는 표 안 글자가 본문의 26.4%, GSTS pptx는 47.5%다 — 절반이 뜻을 잃은 셈이다.)
//
// ■ 무엇을 재나
//   ① 파이프 표로 나온다(머리글 행 + |---| 구분선 + 본문 행) — 열 수·병합·중첩·셀 안 파이프까지.
//   ② 꼬리 정규화가 파이프 줄을 안 깨뜨린다.
//   ③ **표가 없는 문서는 종전과 글자 하나까지 같다**(골든 문자열 — 시험 안에서 전/후를 같이 못 잰다).
//   ④ memory.ts 청커에 넣으면 표 조각이 머리글을 데리고 간다(추출기↔청커 접점).
//   ⑤ **가드 하나하나가 실제로 갈래를 가른다** — 안 닫힌 표·빈 표·안쪽 표 gridSpan·열 폭주 상한.
//
// ⚠ 픽스처는 test/fixtures/make-table-fixtures.mjs가 굽는다 — 실물 3편에는 병합 셀이 **0개**라
//   잘라 만들 수가 없었다(그 갈래는 여기 픽스처로만 검증된다. 실물로는 못 쟀다).
//
// ★ 「담고만 있는 픽스처」를 조심한다 (2026-09-08 검토관 적발④⑤ 수리)
//   첫 판은 중첩·병합·빈 표·안 닫힌 표를 픽스처에 넣고 「못박았다」고 적었지만, 정작 제품에서
//   그 가드 줄을 지워도 **전부 초록**이었다. 원인은 픽스처가 갈래를 안 가른 것이다 — 예를 들어
//   table-broken.docx엔 닫힌 표가 하나도 없어 docx **빠른길**로 빠졌고, 그래서 「구간 나누기」의
//   가드에는 시험이 아예 닿지 않았다. 아래 시험을 고치거나 새 가드를 넣을 때는
//   **그 줄을 지우고 실제로 빨개지는지** 손으로 확인한다(그게 안 되면 그물이 아니다).
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-tableextract-"));
process.env.GIJO_MEMORY_DB_PATH = tmpDb;
vi.mock("../src/engine/embedding", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) }));
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  chat: vi.fn(), registerLlmRoutes: vi.fn(),
}));

const { extractDocumentText } = await import("../src/engine/dataset");
const b64 = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n)).toString("base64");

// ── 표 인지 — **제품 잣대(memory.ts)를 일부러 안 부른다.** 제품이 자기 잣대로 「표다」라고
//   답하면 잣대가 틀렸을 때 시험도 함께 틀린다. 마크다운 규격을 여기 다시 적어 잰다.
const 표줄 = (l: string) => l.trimStart().startsWith("|");
const 구분선 = (l: string) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
/** 한 줄의 칸 수 — 양끝 파이프를 뺀 조각 수. (셀 안 파이프는 추출기가 이스케이프하므로 안 센다.) */
const 칸수 = (l: string) => l.split(/(?<!\\)\|/).length - 2;

describe("워드 표 — OOXML <w:tbl>을 파이프 표로 낸다", () => {
  it("표 세 개가 제자리에 파이프 표로 나오고, 표 밖 글은 순서 그대로다", async () => {
    const t = await extractDocumentText("table.docx", b64("table.docx"));
    expect(t).toBe([
      "표 앞 문단입니다",
      "",
      "| 구분 | 대상 | 조치 |",
      "| --- | --- | --- |",
      "| 취약점 | srv-web-01 | 패치 적용 |",
      "| 설정 | srv-db-02 | 접근제어 강화 |",
      "",
      "표 사이 문단",
      "",
      "| 항목 | 값 |",
      "| --- | --- |",
      "| 전 구간 공통 | |",       // gridSpan=2 → 뒤에 빈 칸을 채워 열 수를 맞춘다
      "| A\\|B | 줄바꿈 포함 |",  // 셀 안 파이프는 이스케이프(\\|) · 셀 안 두 문단은 공백으로
      "",
      "| 바깥 머리1 | 바깥 머리2 |",
      "| --- | --- |",
      "| 바깥칸 | 안쪽칸 |",      // 중첩 표 — 안쪽 글은 바깥 칸에 담긴다(구조는 안 무너진다)
      "",
      "표 뒤 문단",
    ].join("\n"));
  });

  it("중첩 표에서 바깥 표가 끊기지 않는다 — 비탐욕 정규식으로 자르면 여기서 어긋난다", async () => {
    const t = await extractDocumentText("table.docx", b64("table.docx"));
    const lines = t.split("\n");
    // 「바깥 머리1」 행 **바로 다음**이 구분선이어야 머리글로 인정된다(memory.ts 표머리글들과 같은 규격).
    const i = lines.findIndex((l) => l.includes("바깥 머리1"));
    expect(i, "바깥 표의 머리글 행이 없다").toBeGreaterThanOrEqual(0);
    expect(구분선(lines[i + 1]), "머리글 다음이 구분선이 아니다 — 표로 안 읽힌다").toBe(true);
    // 안쪽 표가 바깥 표를 끊었다면 `</w:tbl>` 뒤의 잔해가 별도 조각으로 새어 나온다.
    expect(t, "바깥 표가 끊겨 칸 하나가 표 밖으로 샜다").not.toMatch(/^바깥칸$/m);
  });

  // ★ 적발⑤ — 「안쪽 표의 gridSpan을 바깥 칸 것으로 읽지 않는다」 가드를 **실제로** 가른다.
  //   픽스처의 안쪽 칸에 gridSpan="3"이 달려 있다. 가드를 지우면 바깥 행이 4열로 부푼다.
  it("안쪽 표의 gridSpan이 바깥 칸의 열 수를 부풀리지 않는다", async () => {
    const t = await extractDocumentText("table.docx", b64("table.docx"));
    const 행 = t.split("\n").find((l) => l.includes("바깥칸"));
    expect(행, "바깥 표의 본문 행이 없다").toBeTruthy();
    expect(칸수(행!), `안쪽 gridSpan이 바깥 칸으로 읽혔다: ${행}`).toBe(2);
  });

  // ★ 적발⑤ — 「글자 없는 표는 안 낸다」 가드. 픽스처에 빈 칸만 든 표가 하나 더 들어 있는데,
  //   가드가 살아 있으면 아무것도 안 보태므로 위 골든이 그대로다. 지우면 구분선이 넷이 된다.
  it("글자가 하나도 없는 표는 구분선조차 안 낸다 — 표는 셋뿐이다", async () => {
    const t = await extractDocumentText("table.docx", b64("table.docx"));
    expect(t.split("\n").filter(구분선).length, "빈 표가 구분선을 냈다").toBe(3);
  });
});

// ★ 자체 검토(2026-09-08)에서 잡은 결함 — 표가 **끝내 안 닫히는** 문서에서 마지막 조각의
//   시작 자리를 잘못 잡으면 표 앞 본문이 **두 번** 나온다. 같은 글이 조각으로 두 벌 들어가면
//   검색 상위를 자기 사본이 차지한다(RAG 오염의 전형).
//   ⚠ 픽스처에는 **닫힌 표가 먼저 하나** 들어 있다(2026-09-08 적발④). 안 닫힌 표만 있으면
//     「표가 하나도 없다」로 읽혀 docx 빠른길로 빠지고, 그러면 이 시험이 가드를 **안 지난다** —
//     첫 판이 실제로 그랬다(가드 한 줄을 지워도 전부 초록).
describe("망가진 XML — 표가 안 닫혀도 같은 글을 두 번 내지 않는다", () => {
  it("표 앞 본문·표 사이 본문이 저마다 한 번만 나온다", async () => {
    const t = await extractDocumentText("table-broken.docx", b64("table-broken.docx"));
    expect((t.match(/앞 문단 한 번만/g) ?? []).length, `본문이 겹쳐 나왔다:\n${t}`).toBe(1);
    // ★ 이 한 줄이 가드(`끝난자리 = m.index`)를 가른다 — 없으면 여기가 2가 된다.
    expect((t.match(/표 사이 본문 한 번만/g) ?? []).length, `표 사이 본문이 두 벌 나왔다:\n${t}`).toBe(1);
    expect(t, "안 닫힌 표의 글자가 통째로 사라졌다").toContain("안 닫힌 칸");
    // 안 닫힌 표는 표로 인정하지 않는다 — 열 수를 못 믿기 때문이다. 구분선은 **닫힌 표 몫 하나**뿐.
    expect(t.split("\n").filter(구분선).length, "안 닫힌 표를 표로 냈다").toBe(1);
    expect(t, "안 닫힌 칸이 표 행으로 나왔다").not.toMatch(/^\|.*안 닫힌 칸/m);
  });
});

// ★ 적발⑤ — 열 폭주 상한(표_최대열). 픽스처는 칸 10개 × gridSpan 64 = **640열**을 요구한다.
//   상한이 살아 있으면 512에서 멈춘다. 지우면 640이 되어 여기가 빨개진다.
describe("열 폭주 — 병합 칸이 빈 칸을 곱해도 상한에서 멈춘다", () => {
  it("640열을 요구해도 512열까지만 낸다", async () => {
    const t = await extractDocumentText("table-wide.docx", b64("table-wide.docx"));
    const 표 = t.split("\n").filter(표줄);
    expect(표.length, "표가 안 나왔다").toBeGreaterThan(0);
    for (const l of 표) expect(칸수(l), "열 수가 상한을 넘었다(빈 칸 폭주)").toBe(512);
    expect(t, "첫 칸의 글이 사라졌다").toContain("칸0");
  });
});

describe("pptx 표 — DrawingML <a:tbl>을 파이프 표로 낸다", () => {
  it("표가 슬라이드 자리에 파이프 표로 나오고, 표 없는 슬라이드는 종전 그대로다", async () => {
    const t = await extractDocumentText("table.pptx", b64("table.pptx"));
    expect(t).toBe([
      "보안 점검 요약",
      "",
      "| 구분 | 건수 | 비고 |",
      "| --- | --- | --- |",
      "| 높음 | 3 | 즉시 조치 |",
      "| 합계 3건 | | - |",   // gridSpan=2 + 뒤칸 hMerge="1" — 칸을 늘리지 않고 뒤칸을 비운다
      "",
      "표 뒤 설명 문장",
      "",
      "표가 없는 슬라이드",
      "",
      // 슬라이드 3 — 병합 뒤칸에 **글이 남아 있는** 표(적발③). 그 글을 버리면 여기가 빨개진다.
      "| 가로 앞 | 가로뒤_남은글 |",
      "| --- | --- |",
      "| 세로 위 | 세로아래_남은글 |",
    ].join("\n"));
  });

  it("가로 병합에서 열 수가 안 늘어난다 — DrawingML은 병합된 뒤칸에도 <a:tc>를 둔다", async () => {
    const t = await extractDocumentText("table.pptx", b64("table.pptx"));
    const 표 = t.split("\n").filter(표줄);
    expect(표.length, "표 줄 수가 달라졌다").toBe(7);
    for (const l of 표.slice(0, 4)) expect(칸수(l), `슬라이드1 열 수가 어긋났다: ${l}`).toBe(3);
    for (const l of 표.slice(4)) expect(칸수(l), `슬라이드3 열 수가 어긋났다: ${l}`).toBe(2);
  });

  // ★ 적발③ — 병합 표시가 붙은 뒤칸에 글이 남아 있으면 **그 글도 낸다**. 파워포인트가 만든
  //   파일은 뒤칸이 비어 있어 결과가 같고, 다른 도구가 만든 파일에서만 차이가 난다.
  //   버리면 이 라운드의 「낱말 손실 0」 계약이 이 갈래에서만 깨진다.
  it("병합된 뒤칸에 남은 글을 버리지 않는다", async () => {
    const t = await extractDocumentText("table.pptx", b64("table.pptx"));
    expect(t, "hMerge 뒤칸의 글이 사라졌다").toContain("가로뒤_남은글");
    expect(t, "vMerge 뒤칸의 글이 사라졌다").toContain("세로아래_남은글");
  });
});

describe("꼬리 정규화가 파이프 표를 안 깨뜨린다", () => {
  it("표 줄에 공백이 둘로 남지 않고, 구분선이 살아 있다", async () => {
    for (const n of ["table.docx", "table.pptx"]) {
      const t = await extractDocumentText(n, b64(n));
      const lines = t.split("\n");
      expect(lines.some(구분선), `${n}에 구분선이 없다 — 표로 안 읽힌다`).toBe(true);
      for (const l of lines.filter(표줄)) {
        expect(l, `${n}: 표 줄에 공백이 둘 이상 남았다(정규화 순서·패딩 의심) — ${l}`).not.toMatch(/ {2,}/);
        expect(l.trimEnd().endsWith("|"), `${n}: 표 줄이 파이프로 안 끝난다 — ${l}`).toBe(true);
      }
    }
  });
});

// ★ 「표 없는 문서는 종전과 글자 하나까지 같다」 — 시험 안에서 전/후를 같이 못 재므로
//   **변경 전 실측값을 골든 문자열로 박는다**(2026-09-08 WSL 실측). 여기가 빨개지면
//   표 코드가 표 없는 문서까지 건드린 것이다.
describe("회귀 — 표가 없는 오피스 문서는 종전 출력 그대로다", () => {
  const 골든: Record<string, string> = {
    "tiny.docx": "취약점 점검 결과 보고 대상 서버는 srv-web-01 이며 조치 기한은 9월 30일이다.\n사내 대외비",
    "tiny.pptx": "보안 교육 자료 1장 개요\n\n2장 대응 절차\n\n발표자 메모입니다",
    "tiny.xlsx": "자산명\n웹서버 운영 지침\n인라인 비고 문장",
    "tiny.hwpx": "등산 동호회 가을 정기 산행 안내 집결지는 북한산 우이분소, 오전 8시입니다.",
  };
  for (const [이름, 값] of Object.entries(골든)) {
    it(`${이름} — 글자 단위로 같다`, async () => {
      expect(await extractDocumentText(이름, b64(이름))).toBe(값);
    });
  }
});

// ★ 추출기 ↔ 청커 접점 — 파이프로 내기만 하면 memory.ts의 표 술어가 **저절로** 닿는다.
//   (표 인지 잣대는 memory.ts 한 곳뿐이다 — 여기서 사본을 만들지 않고 결과만 본다.)
describe("청커 접점 — 표가 조각으로 갈려도 머리글을 데리고 간다", () => {
  it("표 행이 든 조각은 모두 구분선(머리글)을 함께 갖는다", async () => {
    const { chunkText } = await import("../src/engine/memory");
    const t = await extractDocumentText("table.docx", b64("table.docx"));
    const 조각들 = chunkText(t, 60, 10); // 일부러 작게 — 표가 반드시 갈리게 한다
    const 표든조각 = 조각들.filter((c) => c.split("\n").some(표줄));
    expect(표든조각.length, "표가 안 갈렸다 — 시험이 헛돈다").toBeGreaterThan(1);
    for (const c of 표든조각) {
      expect(c.split("\n").some(구분선), `머리글 없는 표 조각이 남았다:\n${c}`).toBe(true);
    }
  });
});
