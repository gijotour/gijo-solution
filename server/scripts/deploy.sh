#!/bin/bash
# GIJO AS — 워킹 카피의 서버 소스를 운영 서버(WSL2 systemd, :4000)에 반영한다.
#
# 왜 이 스크립트가 있나: 운영 배포가 그동안 매번 수동으로 재구성됐다(파일 복사 → tsc → kill).
# 절차가 기억에만 있으면 단계가 빠지거나 CRLF 같은 함정을 매번 다시 밟는다.
#
# 실행 (Windows에서):
#   wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/server/scripts/deploy.sh"
# 실행 (WSL 안에서):
#   bash server/scripts/deploy.sh
#
# 옵션:
#   --dry-run   실제로 바꾸지 않고 반영될 파일만 보여준다
#   DST=...     배포 대상 경로 지정(기본 /home/gijo/gijo-as/server)
#
# ⚠ 마지막 재시작 단계에서 접속 중인 담당자 세션이 전부 끊긴다(재로그인 필요).
#   systemd가 Restart=always라 sudo 없이 pkill만으로 자동 재기동된다.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${DST:-/home/gijo/gijo-as/server}"
HEALTH="${HEALTH:-http://localhost:4000/api/health}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

[ -d "$SRC/src" ] || { echo "✗ 소스 경로가 아님: $SRC"; exit 1; }
[ -d "$DST/src" ] || { echo "✗ 배포 대상이 없음: $DST"; exit 1; }

echo "  소스: $SRC"
echo "  대상: $DST"
[ $DRY_RUN = 1 ] && echo "  (dry-run — 아무것도 바꾸지 않음)"
echo

# ── 1) 변경된 .ts만 골라 복사 ───────────────────────────────────────────────
# Windows 체크아웃은 CRLF, WSL 쪽은 LF다. tr로 걷어내지 않으면 파일 전체가 바뀐 것처럼
# 보여 무엇이 실제로 달라졌는지 분간할 수 없다(줄바꿈만 다른 것을 변경으로 착각).
echo "▶ 1/4 변경 파일 탐지 (src/ 만 — 테스트는 배포 대상 아님)"
changed=()
while IFS= read -r rel; do
  s="$SRC/$rel"
  d="$DST/$rel"
  if [ ! -f "$d" ] || ! diff -q --strip-trailing-cr "$s" "$d" >/dev/null 2>&1; then
    changed+=("$rel")
  fi
# src/만 배포한다 — 운영 서버에는 test/가 없다(런타임에 필요 없으므로 의도적).
# 여기에 test를 끼우면 배포마다 테스트 86개가 운영에 새로 깔린다(첫 dry-run에서 실제로 잡힌 함정).
done < <(cd "$SRC" && find src -name '*.ts' -type f 2>/dev/null | sort)

if [ ${#changed[@]} -eq 0 ]; then
  echo "   변경 없음 — 배포할 것이 없습니다."
  exit 0
fi
printf '   %s\n' "${changed[@]}"
echo "   총 ${#changed[@]}개"

if [ $DRY_RUN = 1 ]; then
  echo
  echo "dry-run 종료 — 실제 배포하려면 --dry-run 없이 다시 실행하세요."
  exit 0
fi

echo "▶ 2/4 복사 (CRLF 제거)"
for rel in "${changed[@]}"; do
  mkdir -p "$(dirname "$DST/$rel")"
  tr -d '\r' < "$SRC/$rel" > "$DST/$rel"
done
echo "   ${#changed[@]}개 복사 완료"

# ── 2) 빌드 ────────────────────────────────────────────────────────────────
# 여기서 실패하면 재시작하지 않는다 — 깨진 dist로 서비스를 내리는 것이 최악이다.
echo "▶ 3/4 빌드 (tsc)"
cd "$DST"
npx tsc -p tsconfig.json
echo "   빌드 성공"

# ── 3) 재시작 ──────────────────────────────────────────────────────────────
echo "▶ 4/4 재시작 — ⚠ 접속 중인 세션이 끊깁니다"
pkill -f 'node dist/index.js' || true
for i in $(seq 1 30); do
  sleep 1
  if curl -s -f -o /dev/null "$HEALTH" 2>/dev/null; then
    echo "   재기동 확인 (${i}s) — $HEALTH"
    exit 0
  fi
done
echo "   ⚠ 30초 내 health 응답 없음 — 'systemctl status gijo-as.service' 확인 필요"
exit 1
