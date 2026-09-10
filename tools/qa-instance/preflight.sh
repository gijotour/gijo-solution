#!/usr/bin/env bash
# preflight.sh — 고객 QA 인스턴스(4100)를 **띄우기 전에** 운영을 지키는 자물쇠를 검사한다.
#
# ■ 왜 따로 떼어 냈나 (2026-09-10 검토관 [상])
#   자물쇠 검사가 start.sh 안에만 있었다. 그런데 고객이 실제로 붙는 상시 경로는
#   systemd 유닛(gijo-qa.service)이고, 유닛은 `node dist/index.js`로 **직행**해서
#   그 검사를 하나도 안 지났다 — 「기동 전에 검사한다」가 유닛에서는 거짓이었다.
#   그래서 검사를 이 파일 하나로 모으고 start.sh와 유닛(ExecStartPre)이 **같은 것**을 부른다.
#
# ■ 무엇을 막나
#   ① 운영 노드가 죽어 있는데 우리가 뜨는 것 — 부팅 첫 동작인 고아 정리(reapOrphanEngines)가
#      형제를 못 찾으면 살아 있는 llama-server를 **전부 SIGKILL**한다(localengine.ts:749-772).
#      필터가 빼 주는 것은 `--embedding`뿐이라 채팅 8080은 무방비다.
#   ② 모델 폴더에 파일이 생긴 것 — 임베딩 감시가 무장해 운영 8081을 죽인다(localengine.ts:939·967).
#   ③ GIJO_DEV_MODE 혼입 — 고객 인스턴스는 등급 게이트를 켠 채로 돈다(계획서 §14 ①).
#
# 사용: bash tools/qa-instance/preflight.sh [env파일]
#   종료코드 0=기동해도 된다 / 3=기동하면 안 된다(까닭은 표준출력에)
set -uo pipefail

QA_ROOT=${QA_ROOT:-/home/gijo/gijo-qa}
ENV_FILE=${1:-$QA_ROOT/gijo-qa.env}
PROD_SERVER_DIR=${PROD_SERVER_DIR:-/home/gijo/gijo-as/server}
PROD_HEALTH_URL=${PROD_HEALTH_URL:-http://localhost:4000/api/health}

fail() { echo "✗ $1"; exit 3; }

[ -f "$ENV_FILE" ] || fail "env 파일이 없다: $ENV_FILE"

# ── ① 운영 노드가 살아 있나 — 두 갈래로 잰다(프로세스 + health) ──────────────
# ⚠ 명령줄만으로는 운영과 QA를 못 가른다: 둘 다 `node dist/index.js`라 **cwd로 가른다**.
PROD_PID=""
for p in $(pgrep -f 'dist/index\.js' 2>/dev/null); do
  cwd=$(readlink -f "/proc/$p/cwd" 2>/dev/null || true)
  if [ "$cwd" = "$PROD_SERVER_DIR" ]; then PROD_PID="$p"; break; fi
done
[ -n "$PROD_PID" ] || fail "운영 노드(cwd=$PROD_SERVER_DIR)가 안 보인다 — 지금 뜨면 고아 정리가 운영 llama-server를 SIGKILL한다. 운영을 먼저 올릴 것."

PROD_H=$(curl -s --max-time 5 "$PROD_HEALTH_URL" || echo "")
echo "$PROD_H" | grep -q '"ok":true' || fail "운영 health가 200/ok가 아니다($PROD_HEALTH_URL) — 계획서 §13.5.1 「운영 health 200 확인 뒤 기동」."

# ── ② 모델 폴더 ─────────────────────────────────────────────────────────────
MODELS_DIR=$(grep -E '^GIJO_MODELS_DIR=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$MODELS_DIR" ] || fail "GIJO_MODELS_DIR가 env에 없다 — 빈 모델 폴더를 못 박지 않으면 임베딩 감시가 깨어나 운영 8081을 죽인다."
[ -d "$MODELS_DIR" ] || fail "GIJO_MODELS_DIR가 가리키는 폴더가 없다: $MODELS_DIR"
[ -z "$(ls -A "$MODELS_DIR" 2>/dev/null)" ] || fail "모델 폴더가 비어 있지 않다: $MODELS_DIR — 여기에 모델이 있으면 운영 llama-server(8080/8081)가 죽는다."
# 폴더가 **쓰기 가능**하면 서버가 도는 동안 누가 파일을 떨어뜨려 자물쇠가 풀릴 수 있다
# (감시는 30초마다 파일 존재를 **다시** 본다 — 기동 때 한 번이 아니다).
[ -w "$MODELS_DIR" ] && echo "⚠ 모델 폴더에 쓰기 권한이 있다($MODELS_DIR) — chmod 555 를 권한다(가동 중 파일이 생기면 자물쇠가 풀린다)."

# ── ③ 개발 모드 ─────────────────────────────────────────────────────────────
! grep -qE '^GIJO_DEV_MODE=' "$ENV_FILE" || fail "GIJO_DEV_MODE가 env에 있다 — 고객 인스턴스는 등급 게이트를 켠 채로 돈다(계획서 §14 ①)."

# ── ④ 자기 하드닝 점검 격리 (2026-09-10 고객 QA 예행 ㉔) ────────────────────
#   대화창·검증 버튼이 「이 서버 자신」을 점검해 우리 호스트 OS 설정(준수율·U-02 등)을
#   고객에게 그대로 낼 수 있다(형태 ⓑ 격리 전제 위반) — GIJO_NO_SELF_SCAN=1로 끈다.
grep -qE '^GIJO_NO_SELF_SCAN=1$' "$ENV_FILE" || fail "GIJO_NO_SELF_SCAN=1이 env에 없다 — 고객 인스턴스에서 「이 서버 자신」 하드닝 점검이 살아 있으면 우리 호스트 설정이 고객에게 그대로 나간다."

echo "✓ 자물쇠 통과 — 운영 노드 pid $PROD_PID · health ok · 모델 폴더 빔($MODELS_DIR) · DEV_MODE 없음 · 자기점검 꺼짐"
exit 0
