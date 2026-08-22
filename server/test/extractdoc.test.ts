// [전-7·문서 핵심 — 2026-08-21 사장님 「들어오는 문서·파일부터 우리 제품 취지에 맞게
//  동작을 잘하는 게 핵심」]
// 접수 목록(memory.ts 추출필요)은 .docx·.xlsx·.pptx까지 받는데 추출기(extract_doc.py)가
// 「지원하지 않는 형식」으로 죽어 있었다 — 접수는 넓고 소화는 좁은 틈. OOXML은 HWPX와 같은
// zip+xml이라 의존성 없이 푼다. 여기서는 **실물 픽스처를 실제 파이썬 경로로** 태워 검증한다
// (모의 금지 — 「제품이 도는 환경에서 잰다」).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const { extractDocumentText } = await import("../src/engine/dataset");
const b64 = (n: string) => fs.readFileSync(path.join(__dirname, "fixtures", n)).toString("base64");

// ★ 2026-08-22 — 오피스 4종은 **파이썬을 안 거친다**(zip+xml을 서버가 직접 읽는다).
//   그전에는 파이썬이 없는 기계에서 이것들이 함께 죽었다(특히 mac 설치본은 동봉 전이라 한글
//   문서가 통째로 안 읽혔다). 옮기면서 **파이썬과 글자 하나까지 같은 결과**를 목표로 삼았고,
//   실측으로 확인했다: 픽스처 4종 + 실제 대형 문서 3종(6,266·18,215·10,919자) 전부 완전 일치.
//   아래 시험들은 그 이후로 「파이썬 없이 나오는 결과」를 재는 것이 된다.
describe("문서 추출 — 오피스 4종은 파이썬 없이 (2026-08-22 이관)", () => {
  it("파이썬을 못 쓰는 상태에서도 오피스 4종이 읽힌다", async () => {
    // 파이썬 경로를 **일부러 막고** 돌린다 — 없는 실행파일을 가리키면 파이썬을 타는 형식은 죽는다.
    // 오피스가 여기서 살아남으면 「파이썬 없이 된다」가 참이다(고객 기계의 실제 조건).
    const 원래 = process.env.GIJO_PYTHON;
    process.env.GIJO_PYTHON = path.join(__dirname, "fixtures", "__없는파이썬__");
    try {
      const { resetPythonBinCache } = await import("../src/util/pythonbin");
      resetPythonBinCache();
      for (const [이름, 있어야할말] of [
        ["tiny.docx", "취약점 점검 결과 보고"],
        ["tiny.pptx", "보안 교육 자료"],
        ["tiny.xlsx", "자산명"],
        ["tiny.hwpx", ""], // hwpx는 픽스처 내용이 짧아 존재만 본다
      ] as const) {
        const t = await extractDocumentText(이름, b64(이름));
        expect(t.length, `${이름}이 파이썬 없이 안 읽혔다`).toBeGreaterThan(0);
        if (있어야할말) expect(t, `${이름} 내용이 다르다`).toContain(있어야할말);
      }
    } finally {
      if (원래 === undefined) delete process.env.GIJO_PYTHON; else process.env.GIJO_PYTHON = 원래;
      const { resetPythonBinCache } = await import("../src/util/pythonbin");
      resetPythonBinCache();
    }
  });

  it("PDF도 파이썬 없이 읽힌다 — 글자가 없는 PDF만 파이썬(OCR)으로 넘긴다", async () => {
    // 2026-08-22 — PDF 추출을 pypdf에서 unpdf(JS)로 옮겼다. 실측: 제안서 pypdf 4,507자 /
    // unpdf 4,635자, 한글 비율 동일. 이걸로 **mac에도 파이썬을 동봉할 이유가 사라졌다.**
    // ⚠ 스캔본(글자 없는 PDF)은 여전히 파이썬 몫이다 — OCR이 거기 있다. 그 갈림을 여기서 못박는다.
    const 원래 = process.env.GIJO_PYTHON;
    process.env.GIJO_PYTHON = path.join(__dirname, "fixtures", "__없는파이썬__");
    try {
      const { resetPythonBinCache } = await import("../src/util/pythonbin");
      resetPythonBinCache();
      // ① 글자가 있는 PDF — 파이썬이 막혀 있어도 읽혀야 한다.
      const 글있는 = await extractDocumentText("has-text.pdf", b64("has-text.pdf"));
      expect(글있는.length, "파이썬 없이 PDF가 안 읽혔다 — 이 이관의 주장 자체가 무너진다").toBeGreaterThan(20);
      expect(글있는, "한글이 안 나온다(CJK 폰트 매핑 실패)").toMatch(/[가-힣]/);
      // ② 글자가 없는 PDF — 스캔본으로 보고 파이썬으로 넘어가야 한다.
      //    파이썬이 막혀 있으므로 **파이썬 쪽 오류**로 실패하는 것이 곧 「넘어갔다」는 증거다.
      await expect(extractDocumentText("no-text.pdf", b64("no-text.pdf"))).rejects.toThrow();
    } finally {
      if (원래 === undefined) delete process.env.GIJO_PYTHON; else process.env.GIJO_PYTHON = 원래;
      const { resetPythonBinCache } = await import("../src/util/pythonbin");
      resetPythonBinCache();
    }
  });

  it("손상된 zip은 사람이 읽을 말로 거절한다", async () => {
    // fixtures/broken.docx는 zip이 아닌 28바이트 쓰레기다(그동안 어떤 시험도 안 쓰던 고아 픽스처).
    await expect(extractDocumentText("broken.docx", b64("broken.docx")))
      .rejects.toThrow(/손상|암호/);
  });
});

describe("문서 추출 — OOXML(docx·pptx·xlsx, 의존성 0)", () => {
  it("DOCX — 본문 문단과 머리말이 나오고 문단 경계가 살아 있다", async () => {
    const t = await extractDocumentText("tiny.docx", b64("tiny.docx"));
    expect(t).toContain("취약점 점검 결과 보고");
    expect(t).toContain("srv-web-01");
    expect(t).toContain("사내 대외비"); // 머리말도 지식이다
  });

  it("PPTX — 슬라이드가 순서대로 나오고 발표자 노트도 담긴다", async () => {
    const t = await extractDocumentText("tiny.pptx", b64("tiny.pptx"));
    expect(t).toContain("보안 교육 자료");
    expect(t).toContain("2장 대응 절차");
    expect(t).toContain("발표자 메모입니다");
    expect(t.indexOf("1장 개요")).toBeLessThan(t.indexOf("2장 대응 절차")); // 순서 보장
  });

  it("XLSX — 글자 셀(공유·인라인)만 나오고 숫자 격자는 지식으로 만들지 않는다", async () => {
    const t = await extractDocumentText("tiny.xlsx", b64("tiny.xlsx"));
    expect(t).toContain("자산명");
    expect(t).toContain("웹서버 운영 지침");
    expect(t).toContain("인라인 비고 문장");
    // 숫자만 뽑아 이어붙이면 검색을 오염시키는 무의미 조각이 된다(PDF 바이트 사고와 같은 부류)
    expect(t).not.toContain("12345");
  });

  it("구형(.doc·.hwp)은 조용히 실패하지 않고 변환 안내로 거절한다", async () => {
    await expect(extractDocumentText("옛문서.doc", b64("tiny.docx"))).rejects.toThrow(/docx/);
    await expect(extractDocumentText("옛문서.hwp", b64("tiny.docx"))).rejects.toThrow(/hwpx/);
  });

  // 이미지(스캔 문서)는 OCR로 간다(2026-08-21 사장님 「OCR 포함」). ⚠ 실제 한국어 OCR은 라이브로
  //  검증했다(SolidStep 스캔 페이지→한국어 55줄, 1.6초) — 무거운 옵션 의존이라 표준 시험 환경엔
  //  안 깔린다. 여기서는 **조용히 삼키지 않는가**만 본다: OCR 미설치면 「OCR 필요」로, 설치돼도
  //  빈 이미지면 「글자 못 찾음」으로 **거절**한다(둘 다 이미지 바이트를 지식으로 만들지 않는다).
  it("이미지(스캔)는 OCR 경로로 가고, 못 읽으면 정직하게 거절한다(바이트를 지식으로 안 만든다)", async () => {
    const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await expect(extractDocumentText("스캔.png", png1x1)).rejects.toThrow(/OCR|글자를 찾지 못/);
  });
});
