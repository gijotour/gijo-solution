# tools/merge-intro-deck.py — 원본 제품소개 덱(14장)에 실제 화면 설명 페이지(21장)를 끼워 넣는다.
#
# 원본은 전부 통이미지라 페이지 자체를 손대지 않고 순서만 재배열한다.
# gen-intro-deck.mjs가 남긴 intro-inserts.json의 after(1-based 원본 슬라이드 번호) 뒤에 삽입.
#
# 사용법: python tools/merge-intro-deck.py <원본.pdf> [출력.pdf]

import json
import os
import sys

import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "release-docs")

src_path = sys.argv[1] if len(sys.argv) > 1 else None
if not src_path or not os.path.exists(src_path):
    raise SystemExit("원본 PDF 경로를 넘겨주세요: python tools/merge-intro-deck.py <원본.pdf>")
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    DOCS, "GIJO_AS_제품소개_실제화면판.pdf"
)

src = fitz.open(src_path)
ins = fitz.open(os.path.join(DOCS, "intro-inserts.pdf"))
meta = json.load(open(os.path.join(DOCS, "intro-inserts.json"), encoding="utf-8"))

# after 값별로 삽입 페이지 index를 모은다(정의 순서 유지).
by_after = {}
for m in meta:
    by_after.setdefault(m["after"], []).append(m["index"])

# 삽입 PDF는 CSS px→pt 환산 때문에 원본보다 작다(비율은 동일). 뷰어에서 장마다 크기가
# 튀지 않도록 원본 페이지 규격에 맞춰 그려 넣는다.
box = src[0].rect

out = fitz.open()
order = []
for p in range(len(src)):
    out.insert_pdf(src, from_page=p, to_page=p)
    order.append(("원본", p + 1))
    for i in by_after.get(p + 1, []):
        page = out.new_page(width=box.width, height=box.height)
        page.show_pdf_page(page.rect, ins, i)
        order.append(("삽입", meta[i]["title"]))

out.save(out_path)
print("원본 %d장 + 삽입 %d장 → 총 %d장" % (len(src), len(ins), len(out)))
print("저장:", out_path)
print()
for n, (kind, label) in enumerate(order, 1):
    print("%3d  %s  %s" % (n, kind, label))
