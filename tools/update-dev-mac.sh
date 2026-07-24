#!/bin/bash
# tools/update-dev-mac.sh — Mac 개발기 갱신 (역방향: Windows에서 개발한 것 Mac에 반영).
# Mac에서 직접 실행하거나, Windows에서 원격 실행(Mac '원격 로그인' 켠 경우):
#   ssh t@10.8.0.11 "cd ~/gijo-as && ./tools/update-dev-mac.sh"
#
# 절차: hub pull(ff-only) → 서버 빌드 → 재시작 → health 확인. 실패 시 즉시 중단(set -e).
# 데이터(data/)는 건드리지 않는다 — 코드만 갱신.
set -e
cd "$(dirname "$0")/.."

echo "━━ 1/4 hub에서 pull (fast-forward만) ━━"
git fetch hub
BEFORE=$(git rev-parse --short HEAD)
git merge --ff-only hub/main
AFTER=$(git rev-parse --short HEAD)
echo "HEAD: $BEFORE → $AFTER"

# 의존성 변경 감지 시 안내(자동 설치는 안 함)
if git diff --name-only "$BEFORE" "$AFTER" -- server/package.json | grep -q .; then
  echo "⚠ server 의존성 변경 감지 — 'cd server && npm ci' 먼저 실행할 것"
fi

echo "━━ 2/4 서버 빌드 ━━"
cd server
npm run build

echo "━━ 3/4 서버 재시작 ━━"
# pkill 자기매칭 방지: 이 스크립트는 bash라 'node dist/index.js' 패턴에 안 걸린다.
pkill -f "node dist/index.js" 2>/dev/null && echo "기존 프로세스 종료" || echo "실행 중인 프로세스 없음"
sleep 1
nohup node dist/index.js > "$HOME/gijo-as-server.log" 2>&1 &
echo "새 프로세스 PID: $!"

echo "━━ 4/4 health 확인 (최대 30초) ━━"
for i in $(seq 1 10); do
  sleep 3
  if curl -sf http://localhost:4000/api/health | grep -q '"ok":true'; then
    echo "✅ HEALTH OK — 갱신 완료: $AFTER"
    exit 0
  fi
done
echo "❌ health 실패 — ~/gijo-as-server.log 확인 필요"
exit 1
