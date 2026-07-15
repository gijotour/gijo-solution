# scripts/extract_doc.py — 문서(PDF/HWPX/TXT 등)에서 학습용 텍스트를 추출한다.
#
# dataset.ts의 /api/dataset/extract가 업로드된 문서를 임시 저장한 뒤 이 스크립트를 호출한다.
# stdout으로 순수 텍스트를 내보낸다(PYTHONUTF8=1로 실행 — 한국어 깨짐 방지).
# 지원: .pdf(pypdf), .hwpx(OWPML zip+xml), .txt/.md/.csv/.log(그대로). 그 외는 에러.

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
        elif ext in (".txt", ".md", ".csv", ".log", ".json"):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        else:
            print(f"ERROR: 지원하지 않는 형식입니다: {ext} (지원: pdf, hwpx, txt, md, csv, log)", file=sys.stderr)
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
