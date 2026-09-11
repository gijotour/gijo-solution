#!/usr/bin/env bash
# tools/qa-instance/nightly-4100.sh — 야간 회귀 하네스(ops-sim.mjs)를 고객 QA 인스턴스(4100)에도 돌린다.
#
# ■ 왜 (사장님 결정 2026-09-11 22:55 「권고순서대로」 ①)
#   지금까지 야간 회귀는 운영(4000)에만 돌았다. 고객이 실제로 쓰는 길(4100)은 09-10 예행
#   한 바퀴(30문항·수작업)로만 확인됐다 — 매일 자동으로 지켜보는 눈이 없었다. 4000의 밤 회귀가
#   이미 「결석하면 다음 회차가 로그 머리에 적는다」(nightly-gap.mjs) 체계를 갖췄으므로, 그 체계를
#   4100에도 그대로 얹는다(잣대는 하나 — ops-sim.mjs 자체를 두 벌로 만들지 않는다).
#   §13.5.1의 「되돌리기」 목록에 있던 "nightly 대상에 4100 넣지 않음"이 이 결정으로 바뀌었다
#   (GIJO_AS_AI팀_증류학습_계획서.md §13.5.1 되돌리기 줄에 변경 이력을 남겼다).
#
# ■ 비밀 규칙 — 파일에서 env로만, 어디에도 평문을 찍지 않는다
#   qa-observer 비밀번호는 /home/gijo/gijo-qa/secrets/계정-비밀번호.txt(700, gijo 소유)에**만** 있다.
#   Windows 쪽(nightly-ops-sim.ps1·.tmp-reports 로그)에 새로 저장하지 않는다 — 이 스크립트가
#   그 파일을 읽어 **이 프로세스의 env로만** 넘기고, ops-sim.mjs의 표준출력은 마지막에
#   `grep -v "$QA_PASS"`를 한 번 더 지나 로그에 절대 안 찍히게 한다.
#   ⚠ 파일 형식(라벨 뒤 몇 번째 낱말이 진짜 비밀번호인지)을 여기서 못박지 않는다 — 위치를 가정하면
#     형식이 바뀔 때 조용히 딴 낱말을 QA_PASS로 쓰게 된다. 대신 라벨 뒤 낱말을 **전부 후보**로 삼아
#     실제로 로그인 프로토콜(/api/auth/login)에 던져 200이 나는 것만 쓴다 — 판정은 서버가 한다.
#
# ■ 되돌리기
#   tools/nightly-ops-sim.ps1의 "2차 패스 — 고객 QA 인스턴스(4100)" 블록을 지우면 이 파일은
#   더 이상 밤마다 불리지 않는다(이 파일 자체는 안 지워도 된다 — 독립 실행 가능한 도구로 남긴다).
#
# ■ 운영과의 경계
#   여기서 건드리는 것은 4100뿐이다 — 운영 서버·운영이 공유하는 채팅/임베딩 엔진 포트는 이
#   스크립트가 직접 부르지 않는다(ops-sim.mjs는 GIJO_SERVER_URL 하나만 두드리고, 그 값이 4100이다).
#
# 사용: bash tools/qa-instance/nightly-4100.sh [출력이름=ops-sim-4100]
#   GIJO_SERVER_URL(선택) — 기본 http://localhost:4100. 4000을 가리키면 즉시 거부한다.
#   QA_SECRETS_FILE(선택) — 기본 /home/gijo/gijo-qa/secrets/계정-비밀번호.txt(시험에서 바꿔치기용).
#   GIJO_REPO_DIR(선택)   — 기본 /mnt/d/Connect AI.
# 종료코드: 0=완주 · 2=로그인/사전조건 실패(비번 파일 없음·후보 전부 실패·주소 오발사) · 그 밖=ops-sim.mjs 자체 코드
set -uo pipefail

OUT_NAME="${1:-ops-sim-4100}"
SECRETS_FILE="${QA_SECRETS_FILE:-/home/gijo/gijo-qa/secrets/계정-비밀번호.txt}"
QA_BASE="${GIJO_SERVER_URL:-http://localhost:4100}"
QA_ACCOUNT="qa-observer"
REPO_DIR="${GIJO_REPO_DIR:-/mnt/d/Connect AI}"

fail() { echo "✗ $1"; exit 2; }

# ⚠ 주소 오발사 방지 — 여기가 운영(4000)을 가리키면 밤마다 운영에 하네스를 두 번 쏘게 된다
#   (4000 몫은 이미 nightly-ops-sim.ps1의 1차 패스가 맡고 있다).
case "$QA_BASE" in
  *:4000|*:4000/*) fail "GIJO_SERVER_URL이 운영(4000)을 가리킨다: $QA_BASE — 이 스크립트는 4100 전용이다." ;;
esac

[ -f "$SECRETS_FILE" ] || fail "비밀 파일이 없다: $SECRETS_FILE — win 쪽에 새로 저장하지 않는다는 원칙이라 이 파일이 없으면 여기서 멈춘다(대체 경로를 만들지 않는다)."
[ -r "$SECRETS_FILE" ] || fail "비밀 파일을 읽을 권한이 없다: $SECRETS_FILE"

# qa-observer 줄에서 라벨(첫 필드)을 뺀 나머지 낱말을 후보로 삼는다. 흔한 구두점(: , ( ))은
# 사람이 적을 때 라벨과 값 사이에 섞이기 쉬워 앞뒤에서만 벗겨 낸다 — 값 내부 문자는 손대지 않는다.
CANDIDATES=$(awk -v acct="$QA_ACCOUNT" '$1==acct { for (i=2;i<=NF;i++) print $i }' "$SECRETS_FILE" \
  | sed -E 's/^[:,()]+//; s/[:,()]+$//' | grep -v '^$')
[ -n "$CANDIDATES" ] || fail "비밀 파일에 ${QA_ACCOUNT} 줄이 없거나 후보 낱말이 없다."

QA_PASS=""
while IFS= read -r CAND; do
  [ -n "$CAND" ] || continue
  # JSON 조립은 node에 맡긴다 — 셸에서 따옴표를 손으로 이어붙이면 후보 낱말에 특수문자가
  # 섞였을 때 깨진다(이스케이프 버그가 "비번이 틀렸다"로 오판될 수 있다).
  BODY=$(node -e 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2],force:true}))' "$QA_ACCOUNT" "$CAND")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$QA_BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d "$BODY")
  if [ "$CODE" = "200" ]; then QA_PASS="$CAND"; break; fi
done <<< "$CANDIDATES"
unset CANDIDATES CAND BODY

if [ -z "$QA_PASS" ]; then
  fail "${QA_ACCOUNT} 비밀번호 후보 전부 로그인 실패 — 4100이 내려가 있거나(먼저 GIJO_SERVER_URL/api/health를 볼 것) 비밀번호가 바뀌었을 수 있다."
fi

cd "$REPO_DIR" || fail "저장소 경로를 못 찾음: $REPO_DIR"

echo "▶ 4100 야간 회귀 시작 — ${QA_ACCOUNT}@${QA_BASE} · --out ${OUT_NAME}"
GIJO_SERVER_URL="$QA_BASE" QA_USER="$QA_ACCOUNT" QA_PASS="$QA_PASS" \
  node tools/ops-sim.mjs --out "$OUT_NAME" 2>&1 | grep -v "$QA_PASS"
CODE=${PIPESTATUS[0]}
unset QA_PASS
echo "◀ 4100 야간 회귀 종료 — 코드 $CODE"
exit "$CODE"
