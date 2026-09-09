// test/pdftableextract.test.ts — **PDF에 그려진 표를 표로 뽑는다**(갈래 T의 PDF 확장, 2026-09-09).
//   ⚠ 이름이 비슷한 tableextract.test.ts는 **오피스(docx·pptx)** 몫이다. 여기는 PDF만 잰다.
//
// ■ 증상 (정찰 실측 2026-09-08)
//   지식 조각의 **57%가 PDF에서 온다.** 그런데 PDF에는 「표」라는 구조가 없다 — 글자와 선이 좌표에
//   흩어져 있을 뿐이라, 4열 머리글이 8줄로 쪼개지고 쪽번호가 끼어들었다. 「어느 칸이 무슨 열인가」가
//   통째로 사라진 것이다.
//
// ■ 왜 「그려진 테두리」인가 — 좌표 군집을 **버린** 이유
//   같은 y를 한 행, x 간격을 열로 묶는 좌표 군집은 표 후보 15개 중 **6개가 오탐**이었다(이모지 칸·
//   세 낱말 표제·①②③ 카드·ASCII 도해). 글이 나란히 놓였다는 사실만으로는 표와 카드를 못 가른다.
//   테두리는 **만든 사람이 「이건 표다」라고 그은 선**이라 그 애매함이 없다.
//
// ■ 무엇을 재나
//   ① 테두리 격자가 파이프 표로 나온다(머리글 + |---| 구분선 + 본문 행).
//   ② **여러 줄 셀은 한 칸으로 합쳐진다** — 행은 「시각적 한 줄」이 아니다.
//   ③ 셀 안 파이프 이스케이프 · 모든 행의 열 수 일치(memory.ts 본문 행 예외의 계약).
//   ④ **오탐 0** — 테두리 없는 카드·클립 전용(안 보이는) 격자는 표가 아니다.
//   ⑤ **표 없는 PDF는 종전과 글자 하나까지 같다**(회귀 골든 — 시험 안에서 전/후를 같이 못 잰다).
//   ⑥ memory.ts 청커에 넣으면 표 조각이 머리글을 데리고 간다(추출기↔청커 접점).
//
// ★ 「담고만 있는 픽스처」를 조심한다 (2026-09-08 검토관 적발④⑤의 교훈)
//   아래 오탐 시험은 **실제로 갈래를 가른다** — 굽는 쪽(make-pdftable-fixture.mjs)에 왜를 적었고,
//   제품의 가드 둘을 각각 지워 **빨개지는 것을 손으로 확인했다**(2026-09-09):
//     · 가드①(칠하지 않는 endPath 경로를 세지 않는다)을 열면 → 「Ghost A~D」가 표로 잡힌다.
//     · 가드②(두꺼운 상자는 선이 아니다)를 「4변으로 쪼개기」로 바꾸면 → 「Card A~D」가 표로 잡힌다.
//   ⚠ 반대로 THIN·TOL·MINLEN 같은 **숫자는 흔들어도 우리 코퍼스에서 결과가 안 바뀐다**(실측).
//     그 값으로는 반증을 못 만든다 — 「느슨하게 했더니 초록」을 「튼튼하다」로 읽지 말 것.
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-pdftable-"));
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

describe("PDF 표 — 그려진 테두리 격자를 파이프 표로 낸다", () => {
  it("표가 제자리에 나오고, 여러 줄 셀은 한 칸이 되고, 표 밖 글은 순서 그대로다", async () => {
    const t = await extractDocumentText("table-grid.pdf", b64("table-grid.pdf"));
    expect(t).toBe([
      "Intro paragraph before the table.",
      "Second line of intro.",
      "",
      "| Item | Owner | Due |",
      "| --- | --- | --- |",
      // 셀 안 파이프는 이스케이프(\\|) · 한 칸 안의 두 줄("two"/"lines")은 **한 칸으로** 합쳐진다
      "| Patch\\|A | two lines | Sep 30 |",
      "| Scan | kim | Oct 1 |",
      "",
      // 아래 여덟 낱말은 **표가 아니다** — 카드(두꺼운 상자)와 클립 전용(안 보이는) 격자다.
      "Card A Card B",
      "Card C Card D",
      "Ghost A Ghost B",
      "Ghost C Ghost D",
      "Closing paragraph after everything.",
    ].join("\n"));
  });

  it("★ 오탐 0 — 한 장에 표는 딱 하나다(카드·클립 격자는 표로 세지 않는다)", async () => {
    const t = await extractDocumentText("table-grid.pdf", b64("table-grid.pdf"));
    const 줄들 = t.split("\n");
    expect(줄들.filter(구분선).length, "구분선이 하나가 아니다 — 카드나 클립 격자가 표로 샜다").toBe(1);
    // 카드·유령 글은 **본문 글로** 살아 있어야 한다(안 잡는 것과 버리는 것은 다르다).
    for (const 낱말 of ["Card A", "Card D", "Ghost A", "Ghost D"]) {
      expect(t, `${낱말}이 사라졌다 — 안 잡는 것과 버리는 것은 다르다`).toContain(낱말);
      expect(줄들.filter(표줄).some((l) => l.includes(낱말)), `${낱말}이 표 줄에 들어갔다 — 오탐`).toBe(false);
    }
  });

  it("한 표의 모든 행이 같은 열 수다 — 열 수가 흔들리면 반복줄 제거가 본문 행을 지운다", async () => {
    // memory.ts:788-791의 「표 본문 행 예외」가 **구분선과 열 수가 같은 줄**까지다. 행마다 열 수가
    // 달라지면 그 행은 페이지 바닥글로 오인돼 지워진다(2026-09-08에 실제로 났던 회귀).
    const t = await extractDocumentText("table-grid.pdf", b64("table-grid.pdf"));
    const 표줄들 = t.split("\n").filter(표줄);
    const 기준 = 칸수(표줄들.find(구분선) as string);
    expect(기준).toBe(3);
    for (const l of 표줄들) expect(칸수(l), `열 수가 어긋난 줄: ${l}`).toBe(기준);
  });

  it("표 줄에 공백이 둘로 남지 않고 파이프로 끝난다 — 꼬리 정규화가 표를 안 깨뜨린다", async () => {
    const t = await extractDocumentText("table-grid.pdf", b64("table-grid.pdf"));
    for (const l of t.split("\n").filter(표줄)) {
      expect(l, `표 줄에 공백이 둘 이상 남았다(정규화 순서·패딩 의심) — ${l}`).not.toMatch(/ {2,}/);
      expect(l.trimEnd().endsWith("|"), `표 줄이 파이프로 안 끝난다 — ${l}`).toBe(true);
    }
  });
});

// ★ 「표 없는 PDF는 종전과 글자 하나까지 같다」 — 시험 안에서 전/후를 같이 못 재므로
//   **변경 전 실측값을 골든으로 박는다**(2026-09-09 실측). 여기가 빨개지면 표 코드가
//   격자 없는 문서까지 건드린 것이다. 둘 다 격자 0개라 종전 extractText 한 줄로 지나간다.
describe("회귀 — 격자가 없는 PDF는 종전 출력 그대로다", () => {
  it("has-text.pdf — 글자 단위로 같다", async () => {
    const t = await extractDocumentText("has-text.pdf", b64("has-text.pdf"));
    expect(t).toBe("취약점 점검 결과 보고\n대상 자산: srv-web-01 · 등급: 높음\n이 파일은 문서 추출 시험용 픽스처입니다. 한글이 정확히 뽑히는지 봅니다.");
  });
  it("ctrl-sep.pdf — 글자 수가 그대로다(5,631자)", async () => {
    // 본문이 길어 통째로 박지 않고 길이와 양끝으로 잰다(같은 파일을 extractdoc·ingestquality도 잰다).
    const t = await extractDocumentText("ctrl-sep.pdf", b64("ctrl-sep.pdf"));
    expect(t.length).toBe(5631);
    expect(t.split("\n").some(구분선), "격자가 없는데 표가 생겼다").toBe(false);
  });
});

// ★ 추출기 ↔ 청커 접점 — 파이프로 내기만 하면 memory.ts의 표 술어가 **저절로** 닿는다.
//   (표 인지 잣대는 memory.ts 한 곳뿐이다 — 여기서 사본을 만들지 않고 결과만 본다.)
describe("청커 접점 — PDF 표가 조각으로 갈려도 머리글을 데리고 간다", () => {
  it("표 행이 든 조각은 모두 구분선(머리글)을 함께 갖는다", async () => {
    const { chunkText } = await import("../src/engine/memory");
    const t = await extractDocumentText("table-grid.pdf", b64("table-grid.pdf"));
    const 조각들 = chunkText(t, 60, 10); // 일부러 작게 — 표가 반드시 갈리게 한다
    const 표든조각 = 조각들.filter((c) => c.split("\n").some(표줄));
    expect(표든조각.length, "표가 안 갈렸다 — 시험이 헛돈다").toBeGreaterThan(1);
    for (const c of 표든조각) {
      expect(c.split("\n").some(구분선), `머리글 없는 표 조각이 남았다:\n${c}`).toBe(true);
    }
  });
});
