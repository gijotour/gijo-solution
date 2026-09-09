// pptxextract.test.ts — **pptx 추출은 dataset.ts가 한다**(2026-09-08 재조준 · 2026-09-10 갈래 P).
//
// ■ 이 시험이 무엇을 잘못 재고 있었나 (설계관 실측 2026-09-08)
//   2026-08-29에 이 시험은 `scripts/extract_doc.py`를 **소스로** 검사했다 — 「[슬라이드 N]」 표시·
//   SmartArt/차트 회수·「(노트)」 표시가 파이썬 코드 안에 글자로 있는지만 봤다. 그런데 그 갈래는
//   **한 번도 불리지 않는다**: dataset.ts:extractDocumentText가 오피스 4종을 파이썬보다 먼저
//   가로챈다(2026-08-22 이관). 즉 **제품이 안 지키는 약속을 시험이 지킨다고 말하고 있었다.**
//   → 파이썬의 오피스 갈래를 지우고, 이 시험을 **살아 있는 갈래**로 겨눴다.
//
// ■ ✅ 백로그 3종이 닫혔다 (2026-09-10, 갈래 P)
//   ① 「[슬라이드 N]」 경계  ② SmartArt(ppt/diagrams)·차트(ppt/charts) 글자 회수  ③ 「(노트)」 표시
//   2026-09-08에는 「표 없는 문서는 글자 하나까지 같다」를 계약으로 걸고 표만 되살렸기 때문에
//   함께 옮길 수 없었다(정면충돌). 이번에 **그 계약의 pptx 몫을 새 계약으로 갈아 끼우고** 옮겼다 —
//   무엇이 달라졌는지는 test/tableextract.test.ts의 「pptx 새 계약」 절이 **낱말 다중집합**으로 잰다.
//
// ■ ⚠ 도해·차트는 **실물로 못 쟀다**(정직하게 적는다). 저장소·운영의 pptx 3편에 SmartArt·차트가
//   0개다(2026-09-10 실측: 제품소개 32장·GSTS 16장·ASM 수지비 24장). 그래서 아래 deck.pptx가
//   그 갈래의 유일한 그물이고, 픽스처는 **가드를 실제로 가르게** 구웠다
//   (test/fixtures/make-pptx-deck-fixture.mjs 머리말에 갈래 여섯을 적어 두었다).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const { extractDocumentText } = await import("../src/engine/dataset");
const b64 = (n: string) => readFileSync(join(__dirname, "fixtures", n)).toString("base64");
const 뽑기 = (n: string) => extractDocumentText(n, b64(n));

describe("pptx 추출 — 살아 있는 갈래(dataset.ts)를 잰다", () => {
  it("슬라이드가 번호순으로 나오고 발표자 노트도 담긴다", async () => {
    const t = await 뽑기("tiny.pptx");
    expect(t).toContain("1장 개요");
    expect(t).toContain("2장 대응 절차");
    expect(t, "발표자 노트가 빠졌다").toContain("발표자 메모입니다");
    expect(t.indexOf("1장 개요"), "슬라이드 순서가 어긋났다").toBeLessThan(t.indexOf("2장 대응 절차"));
    // ★ 2026-09-10에 **뒤집힌 계약**: 노트는 이제 문서 끝이 아니라 **제 슬라이드 뒤**에 온다.
    //   왜: 종전엔 32장짜리 덱의 노트 32개가 전부 꼬리에 몰려 「어느 장의 메모인가」를 알 길이
    //   없었다(제품소개 덱 실측). 조각으로 잘리면 그 메모는 주인을 영영 잃는다.
    //   tiny.pptx의 노트는 1장 것이므로 이제 「2장 대응 절차」보다 **앞**이다.
    expect(t.indexOf("발표자 메모입니다")).toBeLessThan(t.indexOf("2장 대응 절차"));
    expect(t).toContain("(노트) 발표자 메모입니다");
  });

  it("표는 파이프 표로 나온다 — 칸이 공백으로 이어붙지 않는다", async () => {
    // 자세한 규격·병합·중첩은 test/tableextract.test.ts가 잰다. 여기서는 **pptx 갈래가
    // 실제로 표를 낸다**는 것만 확인한다(그게 이 파일의 주제다).
    const t = await 뽑기("table.pptx");
    expect(t.split("\n").some((l) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l)),
      "pptx 표가 파이프 표로 안 나온다").toBe(true);
  });
});

// ★ 백로그 3종 — deck.pptx 한 편이 갈래 여섯을 가른다. 골든 하나로 먼저 못박고,
//   아래에서 **걸림쇠마다 이름을 붙여** 다시 잰다(빨개졌을 때 어느 줄인지 바로 보이게).
describe("슬라이드 경계·도해·차트·노트 — deck.pptx", () => {
  it("한 장이 「[슬라이드 N] · 본문 · 도해 · 차트 · (노트)」 한 묶음으로 나온다", async () => {
    expect(await 뽑기("deck.pptx")).toBe([
      "[슬라이드 1]",              // 파일은 slide2.xml — **화면 차례**(sldIdLst)를 따른다
      "첫째 장 도해와 차트",
      "",
      "도해 첫 마디 도해 둘째 마디",   // SmartArt(ppt/diagrams/data1.xml) — 슬라이드엔 글자가 없다
      "",
      "분기별 취약점",              // 차트 제목(rich text)
      "",
      "| | 높음 | 보통 |",          // 「범주 × 계열」은 표로 — 머리글 첫 칸은 **비운다**(낱말을 안 지어낸다)
      "| --- | --- | --- |",
      "| 1분기 | 12 | 5 |",
      "| 2분기 | 7 | 3 |",
      "",
      "(노트) 이 장은 도해가 핵심입니다",  // 노트는 **관계 파일**로 이 장에 붙는다(번호가 아니다)
      "",
      "[슬라이드 3]",              // 2번은 그림뿐이라 통째로 없다 — **번호가 건너뛴 것이 곧 그 말**이다
      "셋째 장 표",
      "",
      "| 구분 | 값 |",
      "| --- | --- |",
      "| 점검 | 2건 |",
    ].join("\n"));
  });

  it("① 화면 차례(sldIdLst)를 따른다 — 파일 번호순으로 물러나면 첫 장이 바뀐다", async () => {
    const 줄 = (await 뽑기("deck.pptx")).split("\n");
    expect(줄[0]).toBe("[슬라이드 1]");
    // 파일 번호순이면 여기가 slide1.xml의 「셋째 장 표」가 된다.
    expect(줄[1], "화면 차례가 아니라 파일 번호순으로 읽었다").toBe("첫째 장 도해와 차트");
  });

  it("② 글자 없는 장은 표시도 안 낸다 — 건너뛴 번호가 「거기엔 글자가 없었다」는 말이다", async () => {
    const t = await 뽑기("deck.pptx");
    expect(t, "그림뿐인 장이 빈 표시를 냈다").not.toContain("[슬라이드 2]");
    expect(t, "번호를 다시 매겼다 — 그러면 화면의 3장을 가리킬 수 없다").toContain("[슬라이드 3]");
  });

  it("③ 노트는 **관계 파일**로 제 장에 붙는다 — 번호로 짝지으면 엉뚱한 장에 간다", async () => {
    const t = await 뽑기("deck.pptx");
    // notesSlide1.xml은 slide1.xml이 아니라 **slide2.xml**(화면 1장)의 노트다.
    expect(t.indexOf("(노트)"), "노트가 3장(파일 번호가 같은 장)에 붙었다").toBeLessThan(t.indexOf("[슬라이드 3]"));
  });

  it("④⑤ SmartArt 글자는 가져오고, 같은 도해의 레이아웃 잡음은 안 가져온다", async () => {
    const t = await 뽑기("deck.pptx");
    expect(t, "SmartArt(diagrams/data1.xml) 글자를 못 가져왔다").toContain("도해 첫 마디 도해 둘째 마디");
    expect(t, "도해 부품 걸림쇠가 헐거워졌다 — 서식 이름이 지식으로 샜다").not.toContain("레이아웃_잡음");
  });

  it("⑥ 차트는 제목 줄 + 「범주 × 계열」 표로 나오고, 오차막대 값은 안 담긴다", async () => {
    const t = await 뽑기("deck.pptx");
    const 줄 = t.split("\n");
    const i = 줄.findIndex((l) => l.startsWith("| 1분기"));
    expect(i, "차트 값이 표로 안 나왔다").toBeGreaterThan(0);
    expect(줄[i - 1], "차트 표에 구분선이 없다").toMatch(/^\s*\|(?:\s*-{2,}\s*\|)+\s*$/);
    expect(줄[i - 2], "계열 이름이 머리글로 안 갔다").toBe("| | 높음 | 보통 |");
    // 부속 수치(오차막대 0.5)는 지식이 아니다 — 담기 시작하면 숫자 잡음이 조각을 오염시킨다.
    expect(t, "오차막대 값이 새어 들어왔다").not.toContain("0.5");
  });

  it("바깥 링크(TargetMode=External)가 섞여도 경로 해석이 안 흔들린다", async () => {
    const t = await 뽑기("deck.pptx");
    expect(t, "웹 주소가 지식으로 새어 들어왔다").not.toContain("example.invalid");
  });
});

// ★ 「지워진 갈래가 되살아나면 두 곳이 같은 문서를 다르게 낸다」 — 소스 감시.
//   되살리고 싶으면 **dataset.ts 쪽을 고치고 이 감시를 함께 지운다**(둘 중 하나만 하면 안 된다).
describe("파이썬 추출기에 오피스 갈래가 되살아나지 않았다", () => {
  const PY = readFileSync(join(__dirname, "..", "scripts", "extract_doc.py"), "utf-8");
  it("extract_doc.py에 오피스 4종 함수가 없다", () => {
    for (const 이름 of ["def extract_hwpx", "def extract_docx", "def extract_pptx", "def extract_xlsx"]) {
      expect(PY, `${이름}가 되살아났다 — 오피스는 dataset.ts 한 곳에서만 읽는다(같은 문서가 갈린다)`)
        .not.toContain(이름);
    }
  });

  // ★ 함수 **이름**만 보면 이름을 바꾸거나 main() 안에 인라인으로 되살릴 때 그냥 통과한다
  //   (2026-09-08 검토관 적발⑥). 되살아남의 진짜 신호 셋을 함께 본다 — 오피스는 전부 zip 안의
  //   XML이라 ①zip을 여는 도구 ②OOXML 태그 ③오피스 확장자로 갈라지는 분기가 반드시 나타난다.
  it("zip·OOXML·오피스 분기 자체가 없다 — 이름만 바꿔 되살려도 걸린다", () => {
    for (const 신호 of ["zipfile", "ZipFile"]) {
      expect(PY, `${신호}가 되살아났다 — 이 스크립트는 zip(오피스)을 열지 않는다`).not.toContain(신호);
    }
    for (const 태그 of ["<w:t", "<a:t", "<hp:t", "sharedStrings"]) {
      expect(PY, `OOXML 태그(${태그})를 읽고 있다 — 오피스 추출이 인라인으로 되살아났다`).not.toContain(태그);
    }
    // `ext == ".docx"` · `ext in (".docx", …)` 꼴의 분기. (구형 `(".doc", ".hwp")`는 파이썬 몫이라 안 걸린다.)
    const 분기 = /\bext\b\s*(?:==|in)\s*\(?[^\n]*?"\.(?:docx|pptx|xlsx|hwpx)"/.exec(PY);
    expect(분기?.[0], `오피스 확장자 분기가 되살아났다: ${분기?.[0]}`).toBeUndefined();
  });
  it("PDF·OCR·구형 거절은 그대로 파이썬 몫이다 — 지우면서 함께 날리지 않았다", () => {
    expect(PY, "PDF 추출이 사라졌다").toContain("def extract_pdf");
    expect(PY, "이미지 OCR이 사라졌다").toContain("def ocr_image");
    expect(PY, "구형(.doc/.hwp) 변환 안내가 사라졌다").toContain('(".doc", ".hwp")');
  });
});
