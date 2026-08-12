#!/bin/bash
# tools/find-orphan-dist.sh — **소스가 사라졌는데 dist에 남은 컴파일 산물**을 찾는다.
#
# ■ 왜 (2026-08-12 발견)
#   배포는 `src/`만 rsync --delete 한다. 그런데 `tsc`는 **없어진 소스의 .js를 지우지 않는다.**
#   그래서 소스에서 지운 기능이 운영 dist에는 **그대로 남아 돈다.**
#   실제로 `dist/engine/mcp.js`가 남아 있었다 — 소스 정리 때 `mcp.ts`를 지웠는데도.
#   남은 파일이 import되면 지운 줄 알았던 코드가 **여전히 실행된다.**
#
# 사용: bash tools/find-orphan-dist.sh [서버경로]   (기본 /home/gijo/gijo-as/server)
set -u
ROOT="${1:-/home/gijo/gijo-as/server}"
cd "$ROOT" || { echo "✗ 없는 경로: $ROOT"; exit 2; }

echo "검사: $ROOT"
n=0
while IFS= read -r js; do
  rel="${js#dist/}"
  rel="${rel%.js}"
  # 자료 파일 복사본(copy-assets)은 소스 .ts가 없어도 정상이다 — .ts 짝이 있어야 하는 것만 본다.
  if [ ! -f "src/$rel.ts" ] && [ ! -f "src/$rel.tsx" ]; then
    echo "  고아: dist/$rel.js"
    n=$((n + 1))
  fi
done < <(find dist -name '*.js' 2>/dev/null)

echo
if [ "$n" -eq 0 ]; then
  echo "✓ 고아 없음"
else
  echo "★ 고아 $n개 — 소스에서 지운 코드가 운영 dist에 남아 있다."
  echo "  고치려면: rm -rf dist && npx tsc -p tsconfig.json && node scripts/copy-assets.mjs"
  echo "  ⚠ 지우기 전에 목록을 사람이 볼 것 — 자료 파일까지 지우면 시험 문항이 사라진다(2026-08 실사고 계보)."
fi
