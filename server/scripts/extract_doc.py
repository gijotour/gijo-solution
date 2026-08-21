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
            print(f"ERROR: 지원하지 않는 형식입니다: {ext} (지원: pdf, hwpx, docx, pptx, xlsx, txt, md, csv, log)", file=sys.stderr)
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
