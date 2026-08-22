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
#     stdout을 stderr로 **OS fd 수준(os.dup2)** 으로 돌린다(_stdout_to_stderr — 네이티브 C 쓰기까지
#     막는다). dataset.ts는 stdout만 텍스트로 읽는다.
import contextlib


@contextlib.contextmanager
def _stdout_to_stderr():
    """OCR 동안 stdout을 stderr로 돌린다 — **OS fd 수준(os.dup2)** 으로 돌려, onnxruntime·MuPDF
    같은 네이티브(C) 라이브러리가 fd 1에 직접 찍어도 추출 텍스트(stdout 계약)를 오염시키지 못하게
    한다(검토관 지적: 파이썬 contextlib.redirect_stdout는 C 쓰기를 못 막는다). 파이썬 print도
    같은 fd를 타므로 한 번에 덮인다. 끝에서 원래 fd 1을 복구해 최종 텍스트는 진짜 stdout으로."""
    sys.stdout.flush()
    saved = os.dup(1)
    try:
        os.dup2(2, 1)   # fd 1(stdout) → fd 2(stderr)
        yield
    finally:
        sys.stdout.flush()
        os.dup2(saved, 1)
        os.close(saved)


IMG_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif"}
OCR_MAX_PAGES = 30   # 스캔 PDF OCR 상한 — 수십 쪽이 요청을 오래 붙잡지 않게(execFile 타임아웃 없음)
OCR_MIN_TEXT = 20    # pypdf 추출이 이보다 짧으면 스캔으로 보고 OCR 폴백
# ⚠ **server/src/engine/dataset.ts의 `스캔판정_최소글자`와 같은 값이어야 한다**(2026-08-22).
#   PDF 텍스트 추출이 JS(unpdf)로 옮겨가면서, 「글자가 거의 없으니 스캔본이다」를 JS가 먼저
#   판정해 이 스크립트로 넘긴다. 두 값이 갈리면 오늘은 OCR로 가던 문서가 내일은 안 가는
#   조용한 회귀가 난다. 상수를 나눠 가질 길이 없어 양쪽에 적고 서로를 가리킨다.
_OCR = None


def _ocr_engine():
    global _OCR
    if _OCR is None:
        import logging
        logging.getLogger("RapidOCR").setLevel(logging.ERROR)  # stderr 로그 소음 줄이기
        from rapidocr import RapidOCR
        from rapidocr.utils.typings import OCRVersion, LangRec, ModelType
        # ⚠ 모델 자리를 **문자열로 못박는다**(2026-08-22).
        #   안 주면 RapidOCR이 스스로 Path 객체를 넣는데, 설정 라이브러리(omegaconf)가
        #   「is not a supported primitive type」으로 거부해 **OCR이 아예 안 뜬다.**
        #   ⚠ **뿌리는 OS가 아니라 omegaconf 판본이다**(2026-08-22 검토관이 잡아 정정).
        #     처음엔 「WSL은 PosixPath라 통과한다 — Windows 전용 결함」이라고 적었는데 **틀렸다.**
        #     동봉본의 omegaconf 2.0.0으로 직접 재 보니 `is_primitive_type(Path)`도
        #     `is_primitive_type(PurePosixPath)`도 **둘 다 False**다 — OS와 무관하게 거부한다.
        #     WSL이 멀쩡했던 것은 거기 omegaconf가 더 높은 판이라서다. 틀린 뿌리를 적어 두면
        #     다음 사람이 「리눅스니까 괜찮겠지」로 판단한다. str()이면 어느 판에서도 안전하다.
        import os as _os
        import rapidocr as _r
        _모델방 = _os.path.join(_os.path.dirname(_r.__file__), "models")
        _OCR = RapidOCR(params={
            "Global.model_root_dir": str(_모델방),
            "Det.ocr_version": OCRVersion.PPOCRV5, "Det.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.lang_type": LangRec.KOREAN, "Rec.model_type": ModelType.MOBILE,
        })
    return _OCR


def _ocr_lines(result) -> str:
    return "\n".join(result.txts) if result and getattr(result, "txts", None) else ""


def ocr_image(path: str) -> str:
    with _stdout_to_stderr():  # 라이브러리 stdout 프린트를 텍스트에서 격리
        return _ocr_lines(_ocr_engine()(path))


def ocr_pdf(path: str) -> str:
    import tempfile
    import shutil
    # ⚠ **import를 격리막 안에서 한다**(2026-08-22 검토관 [높음] 수리). 밖에 두면 그 부품이
    #   import 순간에 stdout으로 찍는 글이 **추출문 맨 앞에 붙어 그대로 지식이 된다.**
    #   실제로 그랬다: `import fitz`가 stdout에 99자를 찍었고(실측), 그 탓에 OCR이 한 글자도
    #   못 읽어도 stdout이 안 비어 소비자들의 `if (!text.trim())` 정직 관문을 **전부 통과**했다
    #   — 「반입 성공(1조각)」으로 영문 경고문이 지식이 되던 자리다.
    #   부품을 바꿔서 우연히 조용해진 게 아니라, **자리를 옮겨서** 다음 부품에도 안 새게 했다.
    with _stdout_to_stderr():
        # pypdfium2 — 구글 PDFium 기반. **PyMuPDF(fitz)를 여기서 걷어냈다**(2026-08-22).
        #   왜: PyMuPDF는 AGPL-3.0(또는 Artifex 상용)이라 **우리가 배포하는 설치본에 실을 수 없다** —
        #   공공·금융 납품 심사·SBOM 점검에서 잡히면 제품 소스 공개 또는 상용 라이선스 구매를 요구받는다.
        #   pypdfium2는 BSD-3-Clause + Apache-2.0이라 재배포에 그 의무가 없다.
        #   ⚠ pdfium은 **dpi가 아니라 배율(scale)**을 받는다 — PDF 기본이 72dpi라 300dpi = 300/72.
        #     실측으로 fitz와 같은 크기가 나오는 것을 확인했다(1369×311 vs 1368×310, ±2px).
        import pypdfium2 as pdfium
        eng = _ocr_engine()
        parts = []
        tmpdir = tempfile.mkdtemp(prefix="gijo-ocr-")
        doc = pdfium.PdfDocument(path)
        try:
            total = len(doc)
            for i in range(min(total, OCR_MAX_PAGES)):
                # ⚠ PNG 파일을 거치는 것은 **일부러**다. RapidOCR은 넘긴 자료형에 따라 색을 다르게
                #   다룬다 — 경로·PIL은 RGB→BGR로 바꿔 주지만 **numpy 배열은 이미 BGR로 치고 그냥 쓴다.**
                #   배열로 바로 넘기면 적·청이 뒤바뀐 그림이 들어가는데, 흑백 스캔에서는 티가 안 나고
                #   컬러 문서에서만 인식률이 떨어져 **눈으로는 못 잡는다**(설계관 2026-08-22).
                img_path = os.path.join(tmpdir, f"p{i}.png")
                doc[i].render(scale=300 / 72).to_pil().save(img_path)
                parts.append(_ocr_lines(eng(img_path)))
        finally:
            try:
                doc.close()   # pdfium은 파일 핸들을 쥔다 — 임시 폴더를 지우기 전에 놓아 준다
            except Exception:
                pass
            shutil.rmtree(tmpdir, ignore_errors=True)
    text = "\n".join(p for p in parts if p)
    if total > OCR_MAX_PAGES:
        text += f"\n\n(⚠ 스캔 문서 {total}쪽 중 앞 {OCR_MAX_PAGES}쪽만 읽었습니다.)"
    return text


OCR_MISSING_MSG = ("이 파일은 스캔·이미지 문서라 글자를 읽으려면 OCR 구성요소가 필요합니다 — "
                   "서버에 OCR을 설치해 주세요(server/requirements-ocr.txt). 관리자에게 문의하세요.")

# Windows 설치본에는 OCR이 **동봉돼 있다**. 그런데도 못 뜨는 경우가 있고, 그때 위 문구는
# 「깔려 있는데 깔라고」 말하는 셈이 된다 — 고객이 따를 수 없는 안내다(2026-08-22 검토관 지적).
# 파이썬은 DLL 적재 실패도 ImportError로 올려 주므로 **둘을 갈라서** 안내한다.
# ⚠ 「깔렸는데 못 뜬다」에는 **관리자가 실제로 할 수 있는 일**을 적는다(2026-08-22 보강).
#   그전 문구는 원인을 「…환경일 수 있습니다」로만 말하고 끝나 관리자가 따라갈 곳이 없었다.
#   실측 원인 1위는 **윈도우 N/KN 에디션**이다 — OCR이 쓰는 영상 라이브러리(cv2)가
#   미디어 파운데이션(mfplat.dll)을 정적으로 부르는데, N 에디션에는 그것이 아예 빠져 있다.
#   (EU 규제로 미디어 기능을 뺀 판본이라 관공서·기업 이미지에 드물지 않게 있다.)
#   서버 코어(GUI 없는 서버판)도 같은 이유로 못 뜬다 — 그쪽은 기능 추가로 풀리지 않는다.
OCR_BROKEN_MSG = ("이 파일은 스캔·이미지 문서인데, 함께 설치된 OCR 구성요소가 **뜨지 못했습니다.** "
                  "관리자 확인 사항: ① 윈도우가 **N 또는 KN 에디션**이면 "
                  "「미디어 기능 팩(Media Feature Pack)」을 설치하면 풀립니다 "
                  "— OCR이 쓰는 영상 라이브러리가 윈도우 미디어 기능을 요구합니다. "
                  "② **서버 코어**(화면 없는 서버판)에서는 같은 이유로 OCR을 쓸 수 없습니다. "
                  "③ 그 밖이면 Visual C++ 재배포 패키지가 빠진 경우입니다. "
                  "OCR 없이도 글자가 들어 있는 문서는 정상으로 읽힙니다.")


def _ocr_실패문구(e: BaseException) -> str:
    """OCR을 못 쓰는 이유를 갈라 안내한다 — 「안 깔림」과 「깔렸는데 못 뜸」은 할 일이 다르다."""
    본문 = str(e)
    낮춤 = 본문.lower()
    깨짐 = ("dll load failed" in 낮춤 or "specified module could not be found" in 낮춤
            or "specified procedure could not be found" in 낮춤
            # 한국어 윈도우는 이 대목을 **한글로** 돌려준다 — 영문만 보면 못 알아채고
            # 「안 깔렸다」로 잘못 안내한다(관리자가 이미 깔린 것을 또 깐다).
            or "지정된 모듈을 찾을 수 없습니다" in 본문
            or "지정된 프로시저를 찾을 수 없습니다" in 본문)
    return OCR_BROKEN_MSG if 깨짐 else OCR_MISSING_MSG


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
                    pass  # OCR 미설치 — pypdf 결과 유지(아래에서 짧으면 버린다)
                except Exception as e:  # noqa
                    print(f"WARN: OCR 폴백 실패({os.path.basename(path)}): {e}", file=sys.stderr)
            # ⚠ **20자도 안 되는 부스러기는 성공이 아니다**(2026-08-22 검토관 [중] 수리).
            #   JS 쪽(dataset.ts:248-253)은 「파이썬도 못 쓰면 1~19자라도 살린다」를 재검토 [높음]으로
            #   **되돌렸다** — 정직 게이트가 원리상 못 잡기 때문이다. 그런데 파이썬 쪽은 정반대로
            #   그 부스러기를 그대로 내보내고 있었다. 같은 제품에 잣대가 두 개였던 것이다.
            #   여태 안 드러난 이유는 `import fitz`가 찍던 99자 경고문이 늘 붙어 20자를 넘겼기 때문이다
            #   — 그 오염을 걷어내자 이 구멍이 드러났다.
            #   빈 값으로 내보내면 소비자 6곳의 `if (!text.trim())`가 「못 읽음」으로 정직하게 처리한다.
            if len(text.strip()) < OCR_MIN_TEXT:
                text = ""
        elif ext in IMG_EXTS:
            # 이미지 = 스캔 문서 — OCR이 유일한 길이라 미설치면 정직 거절(exit 2).
            try:
                text = ocr_image(path)
            except ImportError as e:
                print(f"ERROR: {_ocr_실패문구(e)}", file=sys.stderr)
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
