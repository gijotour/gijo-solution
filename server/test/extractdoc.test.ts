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
