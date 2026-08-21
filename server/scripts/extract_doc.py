# scripts/extract_doc.py — 문서(PDF/HWPX/DOCX/XLSX/PPTX/TXT 등)에서 학습용 텍스트를 추출한다.
#
# dataset.ts의 /api/dataset/extract가 업로드된 문서를 임시 저장한 뒤 이 스크립트를 호출한다.
# stdout으로 순수 텍스트를 내보낸다(PYTHONUTF8=1로 실행 — 한국어 깨짐 방지).
# 지원: .pdf(pypdf) · .hwpx/.docx/.xlsx/.pptx(전부 zip+xml — 의존성 0) · .txt/.md/.csv/.log.
# ⚠ 2026-08-21 사장님 「들어오는 문서·파일부터 잘 동작하는 게 핵심」 — 접수 목록(memory.ts
#   추출필요)은 docx·xlsx·pptx까지 받는데 여기가 「지원하지 않는 형식」으로 죽어 있었다.
#   OOXML 계열은 HWPX와 같은 zip+xml이라 pypdf 같은 부품 없이 그대로 푼다(폐쇄망 이득).
#   .doc/.hwp(구형 바이너리)는 정직하게 변환 안내를 낸다 — 어설픈 추출이 쓰레기 지식을 만든다.

import sys
import os
import re
import zipfile


def extract_pdf(path: str) -> str:
    from pypdf import PdfReader  # requirements.txt에 포함
    reader = PdfReader(path)
    return "\n".join((p.extract_text() or "") for p in reader.pages)


# ── OCR — 스캔 PDF·이미지 한국어 (옵션, 2026-08-21 사장님 「OCR 포함 끝까지」) ────────────
#   엔진: RapidOCR(onnxruntime) + PP-OCRv5 한국어. ⚠ PP-OCRv6는 한국어 미지원이라 **v5로 핀 고정**
#   (실측: 기본 v6는 한글 0줄). requirements-ocr.txt(옵션)로 설치 — 없으면 정직하게 거절/degrade.
#   ⚠ RapidOCR·PyMuPDF가 stdout에 로그를 찍는다 — 추출 텍스트(stdout)가 오염되지 않게 OCR 동안엔
#     stdout을 stderr로 돌린다(contextlib.redirect_stdout). dataset.ts는 stdout만 텍스트로 읽는다.
import contextlib

IMG_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif"}
OCR_MAX_PAGES = 30   # 스캔 PDF OCR 상한 — 수십 쪽이 요청을 오래 붙잡지 않게(execFile 타임아웃 없음)
OCR_MIN_TEXT = 20    # pypdf 추출이 이보다 짧으면 스캔으로 보고 OCR 폴백
_OCR = None


def _ocr_engine():
    global _OCR
    if _OCR is None:
        import logging
        logging.getLogger("RapidOCR").setLevel(logging.ERROR)  # stderr 로그 소음 줄이기
        from rapidocr import RapidOCR
        from rapidocr.utils.typings import OCRVersion, LangRec, ModelType
        _OCR = RapidOCR(params={
            "Det.ocr_version": OCRVersion.PPOCRV5, "Det.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.lang_type": LangRec.KOREAN, "Rec.model_type": ModelType.MOBILE,
        })
    return _OCR


def _ocr_lines(result) -> str:
    return "\n".join(result.txts) if result and getattr(result, "txts", None) else ""


def ocr_image(path: str) -> str:
    with contextlib.redirect_stdout(sys.stderr):  # 라이브러리 stdout 프린트를 텍스트에서 격리
        return _ocr_lines(_ocr_engine()(path))


def ocr_pdf(path: str) -> str:
    import fitz  # pymupdf — 페이지를 이미지로 렌더(poppler 불필요)
    import tempfile
    import shutil
    with contextlib.redirect_stdout(sys.stderr):
        eng = _ocr_engine()
        doc = fitz.open(path)
        total = len(doc)
        tmpdir = tempfile.mkdtemp(prefix="gijo-ocr-")
        parts = []
        try:
            for i in range(min(total, OCR_MAX_PAGES)):
                pix = doc[i].get_pixmap(dpi=300)
                img_path = os.path.join(tmpdir, f"p{i}.png")
                pix.save(img_path)
                parts.append(_ocr_lines(eng(img_path)))
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
    text = "\n".join(p for p in parts if p)
    if total > OCR_MAX_PAGES:
        text += f"\n\n(⚠ 스캔 문서 {total}쪽 중 앞 {OCR_MAX_PAGES}쪽만 읽었습니다.)"
    return text


OCR_MISSING_MSG = ("이 파일은 스캔·이미지 문서라 글자를 읽으려면 OCR 구성요소가 필요합니다 — "
                   "서버에 OCR을 설치해 주세요(server/requirements-ocr.txt). 관리자에게 문의하세요.")


def extract_hwpx(path: str) -> str:
    # HWPX는 OWPML 포맷의 zip. Contents/section*.xml 안의 <hp:t> 텍스트를 모은다.
    z = zipfile.ZipFile(path)
    parts = []
    for name in z.namelist():
        if "section" in name.lower() and name.endswith(".xml"):
            xml = z.read(name).decode("utf-8", "ignore")
            parts.append(" ".join(re.findall(r"<hp:t>(.*?)</hp:t>", xml, re.S)))
    text = re.sub(r"<[^>]+>", "", " ".join(parts))
    # HTML 엔티티 최소 복원
    for a, b in [("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&"), ("&quot;", '"')]:
        text = text.replace(a, b)
    return text


def _strip_tags(xml: str) -> str:
    text = re.sub(r"<[^>]+>", "", xml)
    for a, b in [("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&"), ("&quot;", '"'), ("&apos;", "'")]:
        text = text.replace(a, b)
    return text


def extract_docx(path: str) -> str:
    # DOCX = OOXML zip. 본문 word/document.xml + 머리말·꼬리말의 <w:t> 텍스트를 모은다.
    # <w:p>(문단) 경계는 줄바꿈으로 살린다 — 다 이어붙이면 조각(chunk) 경계가 망가진다.
    z = zipfile.ZipFile(path)
    parts = []
    for name in z.namelist():
        low = name.lower()
        if low == "word/document.xml" or re.match(r"word/(header|footer)\d*\.xml$", low):
            xml = z.read(name).decode("utf-8", "ignore")
            xml = re.sub(r"</w:p>", "\n", xml)
            parts.append(" ".join(re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", xml, re.S)))
    return _strip_tags("\n".join(parts))


def extract_pptx(path: str) -> str:
    # PPTX = zip. 슬라이드(ppt/slides/slideN.xml)와 노트의 <a:t> 텍스트를 슬라이드 순서대로.
    z = zipfile.ZipFile(path)
    names = sorted(
        (n for n in z.namelist() if re.match(r"ppt/(slides/slide|notesSlides/notesSlide)\d+\.xml$", n)),
        key=lambda n: (0 if "/slides/" in n else 1, int(re.search(r"(\d+)\.xml$", n).group(1))),
    )
    parts = []
    for name in names:
        xml = z.read(name).decode("utf-8", "ignore")
        texts = re.findall(r"<a:t>(.*?)</a:t>", xml, re.S)
        if texts:
            parts.append(" ".join(texts))
    return _strip_tags("\n\n".join(parts))


def extract_xlsx(path: str) -> str:
    # XLSX = zip. 글자 셀은 대부분 공유 문자열(xl/sharedStrings.xml)에 있다 — 그것을 주로 모으고,
    # 시트 안 인라인 문자열(<is><t>)도 함께 줍는다. 숫자 격자는 지식 문장이 아니라 버린다
    # (숫자만 뽑아 이어붙이면 검색을 오염시키는 무의미 조각이 된다 — PDF 바이트 사고와 같은 부류).
    z = zipfile.ZipFile(path)
    parts = []
    for name in z.namelist():
        low = name.lower()
        if low == "xl/sharedstrings.xml":
            xml = z.read(name).decode("utf-8", "ignore")
            parts.append("\n".join(re.findall(r"<t(?:\s[^>]*)?>(.*?)</t>", xml, re.S)))
        elif re.match(r"xl/worksheets/sheet\d+\.xml$", low):
            xml = z.read(name).decode("utf-8", "ignore")
            inline = re.findall(r"<is>\s*<t(?:\s[^>]*)?>(.*?)</t>\s*</is>", xml, re.S)
            if inline:
                parts.append("\n".join(inline))
    return _strip_tags("\n".join(parts))


def main() -> None:
    if len(sys.argv) < 2:
        print("ERROR: 파일 경로가 필요합니다", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".pdf":
            text = extract_pdf(path)
            # 스캔(이미지-only) PDF — pypdf가 글자를 거의 못 뽑으면 OCR로 폴백.
            # ⚠ OCR 미설치면 pypdf 결과(빈/짧음)로 degrade — PDF를 하드-실패시키지 않는다(설계관 지적:
            #   기존 텍스트 PDF 추출을 회귀시키면 안 된다). 이미지-only만 아래에서 정직 거절한다.
            if len(text.strip()) < OCR_MIN_TEXT:
                try:
                    ocr_text = ocr_pdf(path)
                    if ocr_text.strip():
                        text = ocr_text
                except ImportError:
                    pass  # OCR 미설치 — pypdf 결과 유지(빈 텍스트면 아래 ingestText가 「못 읽음」 처리)
                except Exception as e:  # noqa
                    print(f"WARN: OCR 폴백 실패({os.path.basename(path)}): {e}", file=sys.stderr)
        elif ext in IMG_EXTS:
            # 이미지 = 스캔 문서 — OCR이 유일한 길이라 미설치면 정직 거절(exit 2).
            try:
                text = ocr_image(path)
            except ImportError:
                print(f"ERROR: {OCR_MISSING_MSG}", file=sys.stderr)
                sys.exit(2)
            if not text.strip():
                print(f"ERROR: 이미지에서 글자를 찾지 못했습니다: {os.path.basename(path)} "
                      f"(글자가 없거나 너무 흐립니다)", file=sys.stderr)
                sys.exit(2)
        elif ext == ".hwpx":
            text = extract_hwpx(path)
        elif ext == ".docx":
            text = extract_docx(path)
        elif ext == ".pptx":
            text = extract_pptx(path)
        elif ext == ".xlsx":
            text = extract_xlsx(path)
        elif ext in (".doc", ".hwp"):
            # 구형 바이너리 — 어설프게 뽑으면 깨진 조각이 지식이 된다(정직 원칙). 변환을 안내한다.
            새이름 = "docx" if ext == ".doc" else "hwpx"
            print(f"ERROR: 구형 형식({ext})은 안전하게 읽을 수 없습니다 — {새이름}(으)로 저장해 다시 올려 주세요.", file=sys.stderr)
            sys.exit(2)
        elif ext in (".txt", ".md", ".csv", ".log", ".json"):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        else:
            print(f"ERROR: 지원하지 않는 형식입니다: {ext} (지원: pdf, hwpx, docx, pptx, xlsx, txt, md, csv, log, 이미지 png/jpg/tiff/bmp/webp)", file=sys.stderr)
            sys.exit(2)
    except Exception as e:  # noqa
        print(f"ERROR: 추출 실패: {e}", file=sys.stderr)
        sys.exit(3)
    # 과도한 공백 정리
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    sys.stdout.write(text.strip())


if __name__ == "__main__":
    main()
