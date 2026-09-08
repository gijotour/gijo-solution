// pptxextract.test.ts — **pptx 추출은 dataset.ts가 한다**(2026-09-08 재조준).
//
// ■ 이 시험이 무엇을 잘못 재고 있었나 (설계관 실측 2026-09-08)
//   2026-08-29에 이 시험은 `scripts/extract_doc.py`를 **소스로** 검사했다 — 「[슬라이드 N]」 표시·
//   SmartArt/차트 회수·「(노트)」 표시가 파이썬 코드 안에 글자로 있는지만 봤다. 그런데 그 갈래는
//   **한 번도 불리지 않는다**: dataset.ts:extractDocumentText가 오피스 4종을 파이썬보다 먼저
//   가로챈다(2026-08-22 이관). 즉 **제품이 안 지키는 약속을 시험이 지킨다고 말하고 있었다.**
//   (커밋 eeb118af의 「18,193→18,600자」도 제품 경로 밖에서 잰 값이다.)
//   → 파이썬의 오피스 갈래를 지우고, 이 시험을 **살아 있는 갈래**로 겨눈다.
//
// ■ 아직 못 옮긴 약속 3종 (백로그 — 이번 라운드에 함께 옮기지 않은 이유)
//   ① 「[슬라이드 N]」 경계 표시  ② SmartArt(ppt/diagrams)·차트(ppt/charts) 글자 회수
//   ③ 「(노트)」 표시로 발표 노트 가르기
//   셋 다 pptx 출력을 **통째로** 바꾼다. 이번 라운드는 「표가 없는 문서는 글자 하나까지 같다」를
//   계약으로 걸고 표만 되살리는 것이라(test/tableextract.test.ts), 함께 하면 그 계약과 정면충돌한다.
//   ⚠ 셋은 진짜 공백이다 — 특히 ②는 도해 많은 벤더 덱의 본문이 거의 비는 원인이다
//     (2026-08-23 SafeBreach 실측). 다음 라운드에서 **회귀 계약을 새로 잡고** 옮긴다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const { extractDocumentText } = await import("../src/engine/dataset");
const b64 = (n: string) => readFileSync(join(__dirname, "fixtures", n)).toString("base64");

describe("pptx 추출 — 살아 있는 갈래(dataset.ts)를 잰다", () => {
  it("슬라이드가 번호순으로 나오고 발표자 노트도 담긴다", async () => {
    const t = await extractDocumentText("tiny.pptx", b64("tiny.pptx"));
    expect(t).toContain("1장 개요");
    expect(t).toContain("2장 대응 절차");
    expect(t, "발표자 노트가 빠졌다").toContain("발표자 메모입니다");
    expect(t.indexOf("1장 개요"), "슬라이드 순서가 어긋났다").toBeLessThan(t.indexOf("2장 대응 절차"));
    // 노트는 **슬라이드 뒤**에 온다(원본 파이썬과 같은 순서 — 본문 사이에 끼면 주제가 흐트러진다).
    expect(t.indexOf("2장 대응 절차")).toBeLessThan(t.indexOf("발표자 메모입니다"));
  });

  it("표는 파이프 표로 나온다 — 칸이 공백으로 이어붙지 않는다", async () => {
    // 자세한 규격·병합·중첩은 test/tableextract.test.ts가 잰다. 여기서는 **pptx 갈래가
    // 실제로 표를 낸다**는 것만 확인한다(그게 이 파일의 주제다).
    const t = await extractDocumentText("table.pptx", b64("table.pptx"));
    expect(t.split("\n").some((l) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l)),
      "pptx 표가 파이프 표로 안 나온다").toBe(true);
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
