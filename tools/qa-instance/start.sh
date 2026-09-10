#!/usr/bin/env bash
# start.sh — 고객 QA 인스턴스(4100)를 sudo 없이 띄운다.
#
# ■ 언제 쓰나
#   gijo-qa.service(시스템 유닛)를 아직 등록하지 못했을 때의 임시 기동 수단이다.
#   상시 서비스는 유닛으로 옮기는 것이 옳다 — 이 스크립트로 띄운 프로세스는
#   WSL 인스턴스가 내려가면 함께 사라진다.
#
# ■ 왜 setsid nohup인가
#   sudo가 없어 시스템 유닛을 못 걸고, `systemctl --user`는 Linger=no라 세션이
#   끊기면 같이 죽는다(2026-09-10 실측). 그래서 세션에서 떼어 낸다.
#
# ⚠ ExecStart 꼴을 바꾸지 말 것 — 반드시 `node dist/index.js`다.
#   운영 서버가 재시작할 때 고아 정리(reapOrphanEngines)가 **형제를 찾는 정규식이
#   `dist/index.js`**다(localengine.ts:751). 꼴이 어긋나면 운영이 우리를 형제로 못 보고
#   자기 llama-server를 고아로 오인해 죽인다.
#
# ⚠ 자물쇠 검사는 preflight.sh **한 곳**에 있다(2026-09-10 검토관 [상] 수리).
#   유닛(gijo-qa.service)도 ExecStartPre로 같은 파일을 부른다 — 두 벌로 갈라 적지 않는다.
#
# 사용: bash tools/qa-instance/start.sh
set -euo pipefail

QA_ROOT=${QA_ROOT:-/home/gijo/gijo-qa}
ENV_FILE="$QA_ROOT/gijo-qa.env"
LOG="$QA_ROOT/server.log"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ── 자물쇠 확인 — 어기면 운영 llama가 죽는다. 기동보다 이 검사가 먼저다. ──
bash "$HERE/preflight.sh" "$ENV_FILE"

# ── 이미 떠 있으면 두 번 띄우지 않는다 ──
if curl -sf http://localhost:4100/api/health >/dev/null 2>&1; then
  echo "· 4100이 이미 응답한다 — 기동하지 않는다."
  exit 0
fi

cd "$QA_ROOT/server"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

setsid nohup node dist/index.js >> "$LOG" 2>&1 < /dev/null &
echo "· 기동 요청함 — 로그: $LOG"

for _ in $(seq 1 20); do
  sleep 2
  if curl -sf http://localhost:4100/api/health >/dev/null 2>&1; then
    echo "· 4100 응답 확인"
    exit 0
  fi
done
echo "✗ 40초 안에 4100이 응답하지 않았다 — 로그를 볼 것: tail -40 $LOG"
exit 1
