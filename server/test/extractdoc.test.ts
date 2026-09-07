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

  // ★ 서버가 읽을 수 있는 형식을 **화면이 막고 있지 않은가**(2026-08-22 신설).
  //   실제로 그런 상태였다: 2026-08-13에 「PDF는 파이썬이 필요한데 라이트엔 없다」며 막아 두었는데,
  //   그 전제가 오늘 사라졌는데도 화면은 그대로여서 **고객에게 거짓을 말하고 있었다**.
  //   서버 능력과 화면 안내가 갈리는 것은 이 저장소가 반복해 겪은 결함이라 여기서 못박는다.
  it("라이트 업로드 화면이 서버가 읽는 형식을 막고 있지 않다", () => {
    const 화면들 = ["lite-memory.html", "lite-manuals.html"];
    const 열려야할것 = [".pdf", ".hwpx", ".docx", ".xlsx", ".pptx"];
    for (const 화면 of 화면들) {
      const p = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", 화면);
      const src = fs.readFileSync(p, "utf8");
      const m = src.match(/type="file"\s+accept="([^"]+)"/);
      expect(m, `${화면}에서 업로드 input을 못 찾았다 — 시험이 헛돈다`).toBeTruthy();
      const accept = (m as RegExpMatchArray)[1];
      for (const 형식 of 열려야할것) {
        expect(
          accept.includes(형식),
          `${화면}이 ${형식}을 막고 있다 — 서버는 파이썬 없이 읽을 수 있는데 화면이 거짓 안내를 한다`,
        ).toBe(true);
      }
      // 거짓이 된 옛 문구가 **화면에 보이는 자리**에 남아 있지 않은지 본다.
      //   ⚠ 주석은 뺀다 — 「왜 그 문구를 없앴는지」를 적으면서 그 문구를 인용하게 되는데,
      //     그것까지 잡으면 기록을 못 남긴다(실제로 이 시험이 내 주석을 잡았다).
      const 주석없는 = src.replace(/<!--[\s\S]*?-->/g, "");
      expect(주석없는, `${화면}에 「추출기가 따로 필요해」라는 옛 안내가 화면에 남아 있다`).not.toContain("추출기가 따로 필요해");
    }
  });

  // ★ 이 자리는 **두 번 조용히 깨졌다**(꼬리 정규화 누락 · destroy가 없는 메서드 호출) —
  //   둘 다 시험 3,895개를 통과했다. 「세 번째면 소스 감시」 규칙에 따라 못박는다.
  it("고친 것이 실제로 코드에 있다 — 꼬리 정규화·문서 닫기·짧은 글 살리기 금지", () => {
    // ⚠ 주석을 걷어내고 본다 — 「왜 그렇게 고쳤는지」를 적으면서 옛 코드를 인용하게 되는데,
    //   그것까지 잡으면 기록을 못 남긴다(이 시험이 실제로 내 주석을 잡았다 — 오늘 두 번째다).
    const 원문 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dataset.ts"), "utf8");
    const src = 원문.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
    // ① 꼬리 정규화가 **PDF까지** 걸린다(오피스만 걸고 PDF를 빠뜨렸던 자리)
    expect(src, "PDF 갈래에 파이썬꼬리정규화가 안 걸렸다 — 같은 문서가 경로에 따라 다른 글이 된다")
      .toMatch(/const 정리 = 파이썬꼬리정규화\(글\)/);
    // ② 문서 닫기는 loadingTask를 거친다(doc.destroy는 **존재하지 않는다** — 조용히 통과했다)
    expect(src, "doc.destroy를 부른다 — 그 객체엔 destroy가 없어 아무 일도 안 한다")
      .not.toMatch(/\bdoc\s*(?:as[^)]*\))?\s*\.\s*destroy\?\.\(\)/);
    expect(src, "loadingTask.destroy로 닫지 않는다 — 오래 도는 프로세스에서 파서가 쌓인다")
      .toContain("doc.loadingTask?.destroy()");
    // ③ 20자 미만을 「성공」으로 돌려주지 않는다(정직 게이트가 원리상 못 잡는 구간)
    expect(src, "짧은 글 살리기가 되살아났다 — 쓰레기가 「반입 성공」으로 들어간다")
      .not.toMatch(/파이썬도 못 씀 · JS가 뽑은/);
  });

  it("암호 걸린 PDF는 한글로 거절한다", async () => {
    // 재검토 [중] — 감싸기를 지웠다가 영어(pypdf의 File has not been decrypted)가 화면에 나갔다.
    const 암호PDF = fs.existsSync(path.join(__dirname, "fixtures", "encrypted.pdf"));
    if (!암호PDF) return; // 픽스처가 없으면 건너뛴다(있으면 반드시 한글이어야 한다)
    await expect(extractDocumentText("encrypted.pdf", b64("encrypted.pdf"))).rejects.toThrow(/암호/);
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

// ★ 낱말 구분자가 제어문자로 뽑히는 PDF (2026-09-07 — 반입 400 실사고)
//
// 관공서 PDF 한 장이 「문서를 읽지 못했습니다 — 내용이 글자가 아닌 것 같습니다」로 거절됐다.
// 그런데 추출은 성공했다 — 낱말 사이가 공백이 아니라 **BEL(U+0007)**이었을 뿐이다. 폰트의
// ToUnicode CMap이 공백 글리프를 제어문자로 매핑하면 pdf.js가 그대로 뽑는다.
// fixtures/ctrl-sep.pdf가 **진짜 PDF로** 그 꼴을 재현한다(1.3KB · 추출 306자 중 제어 45개·14.7%).
// ⚠ 원본 관공서 PDF는 저장소에 넣지 않는다(외부 문서) — 같은 원리를 최소 PDF로 만든 것이다.
describe("제어문자가 낱말을 가르는 PDF도 사람이 읽는 글로 만든다 (2026-09-07)", () => {
  it("추출본에 제어문자가 남지 않고, 낱말이 서로 붙지도 않는다", async () => {
    const t = await extractDocumentText("ctrl-sep.pdf", b64("ctrl-sep.pdf"));
    expect(t.length, "픽스처가 안 읽혔다 — 시험이 헛돈다").toBeGreaterThan(100);
    expect(
      (t.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ?? []).length,
      "제어문자가 그대로 남았다 — 조각·검색·추출본(.md)이 전부 오염된다",
    ).toBe(0);
    // ★ 지우면 낱말이 붙는다("Cyberfraud"). 공백으로 바꿔야 한다.
    expect(t, "낱말이 붙었다 — 제어문자를 지우지 말고 공백으로 바꿔야 한다").toContain("Cyber fraud");
    expect(t).toContain("The operator shall record every detection case within 6 hours");
    // 공백이 둘로 벌어지지 않았다 = 정규화 순서가 맞다(제어문자 → 공백이 [ \t]+ 압축보다 **먼저**).
    expect(t, "공백이 둘로 남았다 — 정규화 순서가 뒤집혔다").not.toMatch(/[^\n] {2,}/);
  });

  // ★ 「양쪽에 적고 서로 가리키는」 쌍 계약 — JS(dataset.ts)와 파이썬(extract_doc.py)의 꼬리
  //   정규화는 **글자 하나까지 같은 동작**이어야 한다(검토관 2026-08-22 확정). 한쪽에만 넣으면
  //   같은 문서가 「JS로 읽혔을 때」와 「OCR로 넘어갔을 때」 다른 글이 되어 조각이 갈린다.
  it("제어문자 걷기가 JS·파이썬 **양쪽에** 있다 — 한쪽만 고치면 같은 문서가 갈린다", () => {
    const js = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dataset.ts"), "utf8");
    const py = fs.readFileSync(path.join(__dirname, "..", "scripts", "extract_doc.py"), "utf8");
    // ⚠ 파이썬 소스에 **글자 그대로** 적힌 문자열을 찾는다(제어문자 자체가 아니라).
    const 파이썬걷기 = String.raw`re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)`;
    const 파이썬공백 = String.raw`re.sub(r"[ \t]+", " ", text)`;
    expect(js, "dataset.ts 꼬리 정규화에 제어문자 걷기가 없다").toMatch(/stripLayoutControls\(t\)/);
    expect(py, "extract_doc.py 꼬리에 제어문자 걷기가 없다 — OCR·스캔 갈래가 갈린다").toContain(파이썬걷기);
    // 순서 계약 — 제어문자→공백이 [ \t]+ 압축보다 **앞**이어야 공백 둘이 하나로 접힌다.
    expect(py.indexOf(파이썬걷기), "파이썬에서 순서가 뒤집혔다 — 공백이 둘로 남는다")
      .toBeLessThan(py.indexOf(파이썬공백));
  });
});
