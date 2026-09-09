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
const { 쪽조립 } = await import("../src/engine/pdftable");
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

// ═══ ★ 픽스처 PDF가 **못 가르는 갈래**를 여기서 가른다 (2026-09-09 검토관 적발④ · 실행 재현) ═══
//   손으로 구운 픽스처는 pdf.js가 실제 PDF에서 만드는 **빈 글자 항목**(str="")을 안 낳는다.
//   그래서 픽스처만으로는 아래 두 줄이 **아무 시험에도 안 걸렸다** — 실측으로 확인했다:
//     · 제품에서 「빈 항목도 구간에 넣는다」를 빼면 → 픽스처 시험 7개가 **전부 초록인 채로**
//       실제 PDF의 표가 전멸했다(제품소개 18→0 · 제품소개서_상세 14→0 · Imperva 2→0 · SBOM 4→0).
//     · 회전 가드(transform[1]≠0)를 지워도 → 픽스처 시험 7개 전부 초록.
//   즉 **표 복원 전체를 지탱하는 줄이 그물 밖에 있었다.** 커밋이 경계한 「담고만 있는 픽스처」가
//   다른 자리에서 그대로 난 것이다. 여기서는 PDF 대신 **쪽조립()에 항목을 직접 먹여** 그 줄을 잰다.
describe("쪽조립 — 픽스처가 못 만드는 갈래", () => {
  /** 격자: 2열(x 0~50~100) × 2행(y 0~20~40). PDF 좌표라 ys는 아래에서 위로 간다. */
  const 격자 = { xs: [0, 50, 100], ys: [0, 20, 40] };
  const 항목 = (str: string, x: number, y: number, opts?: { eol?: boolean; w?: number; tr?: number[] }) => ({
    str,
    hasEOL: opts?.eol ?? false,
    width: opts?.w ?? 0,
    transform: opts?.tr ?? [1, 0, 0, 1, x, y],
  });
  /** 격자 밖 글 1개 → 격자 안 4칸 → 격자 밖 글 1개. 「구간이 연속인가」를 재는 최소 배치다. */
  const 배치 = (가운데: ReturnType<typeof 항목>[]) => [
    항목("앞글", 300, 300, { eol: true }),
    ...가운데,
    항목("뒷글", 300, 280),
  ];
  const 네칸 = [항목("A", 10, 30), 항목("B", 60, 30), 항목("C", 10, 10), 항목("D", 60, 10)];

  it("기본 — 격자 안 네 칸이 파이프 표가 되고 밖의 글은 그대로다", () => {
    const t = 쪽조립(배치(네칸), [격자]);
    expect(t).toContain("| A | B |");
    expect(t).toContain("| --- | --- |");
    expect(t).toContain("| C | D |");
    expect(t).toContain("앞글");
    expect(t).toContain("뒷글");
  });

  it("★ 빈 항목(str=\"\")이 칸 사이에 끼어도 표가 선다 — 이 줄이 없으면 실제 PDF 표가 전멸한다", () => {
    // pdf.js는 줄바꿈 자리에 폭 0짜리 빈 항목을 끼운다. 그것을 구간에서 빼면 색인이 띄엄띄엄해져
    // 「연속 구간」 판정이 실패하고, 격자가 통째로 포기된다(실측: 저장소 PDF에서 표 0개).
    const 가운데 = [항목("A", 10, 30), 항목("B", 60, 30), 항목("", 60, 30), 항목("C", 10, 10), 항목("D", 60, 10)];
    const t = 쪽조립(배치(가운데), [격자]);
    expect(t, "빈 항목을 구간에서 빼면 여기가 빨개진다").toContain("| A | B |");
    expect(t).toContain("| C | D |");
  });

  it("★ 회전한 글자(transform[1]≠0)가 섞이면 표를 포기한다 — 좌표를 못 믿는다", () => {
    const 가운데 = [...네칸.slice(0, 3), 항목("D", 60, 10, { tr: [0, 1, -1, 0, 60, 10] })];
    const t = 쪽조립(배치(가운데), [격자]);
    expect(t.split("\n").some((l) => l.trimStart().startsWith("|")), "회전 쪽에서 표를 냈다").toBe(false);
    for (const w of ["A", "B", "C", "D", "앞글", "뒷글"]) expect(t).toContain(w); // 안 잡는 것과 버리는 것은 다르다
  });

  it("★ 기울임꼴(transform[2]≠0)은 막지 않는다 — 함께 막았더니 참 표 하나가 죽었다", () => {
    // 실측 2026-09-09: 제품소개.pdf p4의 빈 기울임 항목 하나가 6행4열 참 표를 통째로 죽여 18→17이 됐다.
    // 기울임은 가로 기울이기(shear)라 글줄 진행 방향이 그대로 가로다 — 확인한 것(회전)만 막는다.
    const 가운데 = [...네칸.slice(0, 3), 항목("D", 60, 10, { tr: [1, 0, 0.21, 1, 60, 10] })];
    const t = 쪽조립(배치(가운데), [격자]);
    expect(t, "기울임까지 막으면 여기가 빨개진다").toContain("| C | D |");
  });

  it("격자 안에 글자가 하나도 없으면 표를 안 만든다 — 자리잡기용 테두리는 지식이 아니다", () => {
    const t = 쪽조립(배치([항목("", 10, 30), 항목("", 60, 10)]), [격자]);
    expect(t.split("\n").some((l) => l.trimStart().startsWith("|"))).toBe(false);
  });

  it("격자 안 항목이 연속 구간이 아니면 포기한다 — 글이 뒤섞이는 쪽이 더 나쁘다", () => {
    const 가운데 = [항목("A", 10, 30), 항목("B", 60, 30), 항목("바깥", 300, 290), 항목("C", 10, 10), 항목("D", 60, 10)];
    const t = 쪽조립(배치(가운데), [격자]);
    expect(t.split("\n").some((l) => l.trimStart().startsWith("|"))).toBe(false);
    expect(t).toContain("바깥");
  });
});

// ═══ ★ 추출기(쓰는 쪽) ↔ 웹취약점 파서(읽는 쪽)의 규격 일치 ═════════════════════════════
//   webreport.ts는 표를 **평평한 줄로 되돌려** 읽는다(표풀기). 그 되돌리기는 파이프표()가 내는
//   규격을 전제로 하는데, 두 파일이 서로를 모른 채 갈리면 조용히 어긋난다 — 그래서 여기서
//   **제품이 실제로 낸 표**를 제품의 되돌리기에 먹여 본다.
describe("추출기가 낸 표를 웹취약점 파서가 되푼다", () => {
  it("파이프표() 출력 → 표풀기() = 종전 평문 줄", async () => {
    const { 파이프표 } = await import("../src/engine/dataset");
    const { 표풀기 } = await import("../src/engine/webreport");
    const 표 = 파이프표([
      ["구분", "취약점", "위험도"],
      ["보안 설정 오류", "[IW-20] 디렉토리 인덱싱", "하"],
    ]);
    expect(표풀기(표)).toBe("구분 취약점 위험도\n보안 설정 오류 [IW-20] 디렉토리 인덱싱 위험도 하");
  });

  it("픽스처 PDF의 표도 되풀린다 — 칸 안 파이프 이스케이프까지", async () => {
    const { 표풀기 } = await import("../src/engine/webreport");
    const 푼글 = 표풀기(await extractDocumentText("table-grid.pdf", b64("table-grid.pdf")));
    expect(푼글).toContain("Patch|A two lines Sep 30");
    expect(푼글.split("\n").some((l) => l.trimStart().startsWith("|")), "표가 안 풀렸다").toBe(false);
  });
});
