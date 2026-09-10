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
# 사용: bash tools/qa-instance/start.sh
set -euo pipefail

QA_ROOT=/home/gijo/gijo-qa
ENV_FILE="$QA_ROOT/gijo-qa.env"
LOG="$QA_ROOT/server.log"

[ -f "$ENV_FILE" ] || { echo "✗ env 파일이 없다: $ENV_FILE"; exit 2; }

# ── 자물쇠 확인 — 어기면 운영 llama가 죽는다. 기동보다 이 검사가 먼저다. ──
MODELS_DIR=$(grep -E '^GIJO_MODELS_DIR=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$MODELS_DIR" ]; then
  echo "✗ GIJO_MODELS_DIR가 env에 없다 — 빈 모델 폴더를 못 박지 않으면 임베딩 감시가 깨어나 운영 8081을 죽인다."
  exit 3
fi
if [ -n "$(ls -A "$MODELS_DIR" 2>/dev/null)" ]; then
  echo "✗ 모델 폴더가 비어 있지 않다: $MODELS_DIR"
  echo "  여기에 모델이 있으면 이 인스턴스가 운영 llama-server(8080/8081)를 죽인다. 기동을 멈춘다."
  exit 3
fi
if grep -qE '^GIJO_DEV_MODE=' "$ENV_FILE"; then
  echo "✗ GIJO_DEV_MODE가 env에 있다 — 고객 인스턴스는 등급 게이트를 켠 채로 돈다(계획서 §14 ①). 기동을 멈춘다."
  exit 3
fi

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
