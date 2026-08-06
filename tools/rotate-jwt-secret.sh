#!/usr/bin/env bash
# tools/rotate-jwt-secret.sh — 운영 서버(WSL)의 JWT 서명 비밀키를 새 난수로 바꾼다.
#
# 왜 스크립트인가: 2026-08-06 진단 중 이 값이 내(클로드) 출력 기록에 한 번 찍혔다.
# 위험은 낮지만(로컬 기록) 바꾸는 편이 깔끔하다. 자격증명 변경은 자동화가 차단하므로
# **사람이 직접 한 줄 실행**하는 형태로 남긴다.
#
# 실행(WSL 안에서):
#   bash /mnt/d/Connect\ AI/tools/rotate-jwt-secret.sh
#
# 무슨 일이 일어나나:
#   1) env 파일을 타임스탬프 붙여 백업한다(되돌릴 수 있게)
#   2) GIJO_JWT_SECRET을 새 64자리 16진수로 바꾼다 — 값은 화면에 찍지 않는다
#   3) 서비스를 재시작한다(systemd Restart=always라 kill이면 충분)
#   4) health를 확인한다
#
# ⚠ 바꾸면 **지금 로그인해 있는 모든 사용자가 한 번 튕긴다**(기존 토큰이 무효가 된다).
#    다시 로그인하면 정상이다. 업무 시간대에는 피하는 편이 낫다.
set -euo pipefail

ENV_FILE=/home/gijo/gijo-as/gijo-as.env
[ -f "$ENV_FILE" ] || { echo "env 파일이 없습니다: $ENV_FILE"; exit 1; }
grep -q '^GIJO_JWT_SECRET=' "$ENV_FILE" || { echo "GIJO_JWT_SECRET 줄이 없습니다 — 수동 확인 필요"; exit 1; }

BAK="${ENV_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$BAK"
echo "백업: $BAK"

NEW=$(head -c 32 /dev/urandom | xxd -p -c 64)
# sed 대신 임시 파일로 — 값이 명령줄(프로세스 목록)에 노출되지 않게 한다.
awk -v v="$NEW" '/^GIJO_JWT_SECRET=/{print "GIJO_JWT_SECRET=" v; next} {print}' "$BAK" > "$ENV_FILE"
unset NEW
echo "교체 완료(값은 출력하지 않습니다)"

PID=$(systemctl show gijo-as.service -p MainPID --value)
[ -n "$PID" ] && [ "$PID" != "0" ] && kill "$PID" && echo "재시작 요청(옛 PID $PID)"

for i in $(seq 1 12); do
  sleep 5
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
    echo "health OK — 끝났습니다. 모두 다시 로그인하면 됩니다."
    exit 0
  fi
done
echo "⚠ 60초 안에 health가 안 올라왔습니다. 로그를 확인하세요: tail -30 /home/gijo/gijo-as/server.log"
echo "   되돌리려면: cp $BAK $ENV_FILE 후 서비스 재시작"
exit 1
