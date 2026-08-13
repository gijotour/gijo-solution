#!/bin/sh
# tools/stage-llama-metal.sh — 라이트 dmg에 동봉할 Metal llama-server를 「고객 기계에서 도는 모양」으로 꾸린다.
#
# ■ 왜 그냥 복사하면 안 되나 (2026-08-13 실측)
#   개발 빌드의 rpath가 **절대경로**다:
#     LC_RPATH = /Users/t/gijo-as/server/llama.cpp/build/bin
#   그대로 동봉하면 고객 기계에서는 dylib을 못 찾아 죽는다. 더 나쁜 건 **개발 기계에서는
#   그 경로가 실제로 있어서 시험이 거짓 통과한다** — 겨눈 대상이 틀린 측정의 전형.
#   → rpath를 @executable_path로 바꾸고, dylib을 실행파일 옆에 놓는다.
#
# ■ dylib 이름 함정
#   바이너리는 @rpath/libllama.0.dylib 처럼 **.0 이름**을 찾는데, 실제 파일은
#   libllama.0.17.0.dylib이고 .0은 심볼릭 링크다. 링크를 따라가 **.0 이름으로 실체를** 복사한다
#   (심볼릭 링크를 그대로 담으면 dmg·서명 단계에서 모양이 흐트러진다).
#
# ■ 서명
#   arm64는 install_name_tool로 만지는 순간 서명이 깨진다 — ad-hoc으로 다시 서명한다.
#   (제품 dmg 전체는 client/build/mac-adhoc-sign.cjs가 한 번 더 서명한다.)
#
# 결과: client/build/llama-metal/  (실측 약 16MB — CUDA 87MB보다 작다, 출하 결정서 ⓑ의 빈칸)
set -eu

SRC="$HOME/gijo-as/server/llama.cpp/build/bin"
OUT="$HOME/gijo-as/client/build/llama-metal"

rm -rf "$OUT"
mkdir -p "$OUT"

cp "$SRC/llama-server" "$OUT/"

# 바이너리가 참조하는 @rpath/lib*.dylib 이름을 그대로 읽어, 그 이름으로 실체를 복사한다.
otool -L "$SRC/llama-server" | awk '/@rpath\//{print $1}' | sed 's|@rpath/||' | while read -r NAME; do
  cp -L "$SRC/$NAME" "$OUT/$NAME"
done
# dylib끼리도 서로를 @rpath로 부른다(libggml → libggml-base 등). 한 겹 더 훑는다.
for f in "$OUT"/lib*.dylib; do
  otool -L "$f" | awk '/@rpath\//{print $1}' | sed 's|@rpath/||' | while read -r NAME; do
    [ -f "$OUT/$NAME" ] || cp -L "$SRC/$NAME" "$OUT/$NAME"
  done
done
# Metal 백엔드는 실행 시 동적으로 찾는 경우가 있어 목록에 안 잡혀도 반드시 담는다.
[ -f "$OUT/libggml-metal.0.dylib" ] || cp -L "$SRC/libggml-metal.0.dylib" "$OUT/" 2>/dev/null || true

# rpath: 절대경로 지우고 실행파일 옆을 보게.
OLD=$(otool -l "$OUT/llama-server" | awk '/LC_RPATH/{getline; getline; print $2}')
for r in $OLD; do install_name_tool -delete_rpath "$r" "$OUT/llama-server" 2>/dev/null || true; done
install_name_tool -add_rpath "@executable_path" "$OUT/llama-server"

# 만진 것 전부 ad-hoc 재서명 (안 하면 arm64에서 즉사).
codesign --force -s - "$OUT/llama-server"
for f in "$OUT"/lib*.dylib; do codesign --force -s - "$f"; done

echo "── 검증: 원본 경로가 없는 것처럼 다른 cwd에서 실행 ──"
SZ=$(du -sh "$OUT" | awk '{print $1}')
( cd /tmp && "$OUT/llama-server" --version 2>&1 | head -2 )
echo "── 완료: $OUT ($SZ) ──"
