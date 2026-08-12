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
# launchd 에이전트(com.gijo.as.server)가 등록돼 있으면 그쪽으로 재기동한다.
# 이유: 에이전트는 KeepAlive라 pkill 하면 launchd가 곧바로 되살린다 — 여기서 nohup으로
# 또 띄우면 두 프로세스가 4000 포트를 다투게 된다(EADDRINUSE). kickstart -k는
# "죽이고 다시 띄우기"를 launchd가 원자적으로 처리하므로 충돌이 없다.
#
# ★ 2026-08-12 — **재기동 전 PID를 기록한다.** 아래 4/4에서 PID가 바뀌었는지 본다.
#   실사고: 손으로 띄운 프로세스가 4000을 쥐고 있으면 kickstart가 띄운 새 인스턴스는
#   EADDRINUSE로 죽고, **옛 프로세스가 health에 200을 답한다.** 이 스크립트는 그걸
#   「재기동 성공」으로 찍었고, 그 뒤 측정 18문항이 통째로 옛 코드에서 나왔다.
#   health는 「서버가 살아 있나」만 답한다 — 「새 코드인가」는 안 답한다.
PREV_PID=$(lsof -nP -iTCP:4000 -sTCP:LISTEN -t 2>/dev/null | head -1)
AGENT="com.gijo.as.server"
if launchctl print "gui/$(id -u)/$AGENT" >/dev/null 2>&1; then
  # 에이전트가 등록만 되고 **안 돌고 있는데** 포트는 남이 쥔 상태를 먼저 푼다.
  AGENT_PID=$(launchctl list 2>/dev/null | awk -v a="$AGENT" '$3==a {print $1}')
  if [ -n "$PREV_PID" ] && [ "$AGENT_PID" != "$PREV_PID" ]; then
    echo "⚠ 4000을 쥔 PID $PREV_PID 는 launchd 소유가 아니다(에이전트: ${AGENT_PID:--}) — 내리고 넘긴다"
    kill "$PREV_PID" 2>/dev/null || true
    sleep 3
  fi
  launchctl kickstart -k "gui/$(id -u)/$AGENT"
  echo "launchd 재기동: $AGENT"
else
  # 에이전트 미등록 환경(수동 실행) — 기존 방식 유지.
  # pkill 자기매칭 방지: 이 스크립트는 bash라 'node dist/index.js' 패턴에 안 걸린다.
  pkill -f "node dist/index.js" 2>/dev/null && echo "기존 프로세스 종료" || echo "실행 중인 프로세스 없음"
  sleep 1
  nohup node dist/index.js > "$HOME/gijo-as-server.log" 2>&1 &
  echo "새 프로세스 PID: $!"
fi

echo "━━ 4/4 health + **새 코드인지** 확인 (최대 30초) ━━"
for i in $(seq 1 10); do
  sleep 3
  curl -sf http://localhost:4000/api/health | grep -q '"ok":true' || continue

  # ★ health만으로는 부족하다 — 옛 프로세스도 200을 답한다. **PID가 바뀌었는지** 본다.
  NOW_PID=$(lsof -nP -iTCP:4000 -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$PREV_PID" ] && [ "$NOW_PID" = "$PREV_PID" ]; then
    echo "❌ **재기동이 안 됐다** — 4000을 쥔 PID가 그대로다($NOW_PID)."
    echo "   health는 200이지만 그건 **옛 프로세스**가 답한 것이다. 새 코드가 아니다."
    echo "   이 상태로 잰 값은 전부 무효다. 아래를 확인할 것:"
    echo "     launchctl list | grep gijo      # 에이전트가 실제로 도는가"
    echo "     lsof -nP -iTCP:4000 -sTCP:LISTEN"
    echo "     tail -40 \$HOME/gijo-as-server.log"
    exit 1
  fi

  # 빌드보다 프로세스가 나중에 떴는지까지 본다(PID 재사용·경합 대비).
  # ⚠ 23행에서 이미 `cd server` 했다 — 여기 cwd는 server/ 다. 경로에 server/를 또 붙이지 말 것.
  if [ -n "$NOW_PID" ] && [ -f dist/index.js ]; then
    PROC_START=$(ps -o lstart= -p "$NOW_PID" 2>/dev/null | xargs)
    echo "   프로세스 시작: ${PROC_START:-?}  ·  dist 빌드: $(stat -f '%Sm' dist/index.js 2>/dev/null)"
  fi
  echo "✅ HEALTH OK · PID ${PREV_PID:--} → $NOW_PID — 갱신 완료: $AFTER"
  exit 0
done
echo "❌ health 실패 — ~/gijo-as-server.log 확인 필요"
exit 1
