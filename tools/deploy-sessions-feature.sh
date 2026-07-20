#!/bin/bash
# 운영(WSL) 배포 — "모든 행위 → 작업 세션" 변경분 7파일 동기화 + 빌드. (kill 재시작은 별도 단계)
set -e
SRC="/mnt/d/Connect AI/server/src"
DST="/home/gijo/gijo-as/server/src"
for f in engine/audit.ts engine/worksessions.ts engine/dispatcher.ts engine/report.ts engine/redteam.ts engine/assets.ts engine/autoupload.ts; do
  cp "$SRC/$f" "$DST/$f"
  echo "sync: $f"
done
cd /home/gijo/gijo-as/server
npx tsc -p tsconfig.json 2>&1 | tail -2
echo BUILD_OK
grep -c onAudit dist/engine/audit.js dist/engine/worksessions.js
