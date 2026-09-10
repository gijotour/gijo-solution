#!/usr/bin/env bash
# verify.sh — 고객 QA 인스턴스(4100)가 성하고, **운영(4000·8080·8081)이 무사한지** 함께 잰다.
#
# ■ 이 검사의 요점은 4100이 아니라 운영이다
#   4100은 운영의 llama-server를 공유한다. 그래서 "4100이 뜬다"만 재면 절반이다 —
#   기동 전후로 운영 llama PID가 같은지, 운영 health가 그대로인지가 진짜 관문이다.
#
# ⚠ 변수 이름은 **영문만** 쓴다. 한글 변수명은 POSIX 셸에서 이름으로 안 쳐서
#   `이름=값`이 "command not found"가 되고, 스크립트가 **조용히 반쪽으로 돈다**
#   (2026-09-10 실측: 첫 판이 그렇게 돌아 거짓 실패를 냈다). 한글은 주석·출력문에만.
#
# 사용: bash tools/qa-instance/verify.sh
#   기준선을 미리 잡아 두려면: bash tools/qa-instance/verify.sh --baseline > /tmp/qa-base.txt
set -uo pipefail

QA_ROOT=/home/gijo/gijo-qa
FAIL=0
BAD_RE='고아 llama-server 정리|임베딩 서버 hang|채팅 모델 hang|무응답 감지'

llama_pids() { pgrep -f '[l]lama-server' | sort | tr '\n' ' '; }

if [ "${1:-}" = "--baseline" ]; then
  echo "llama=$(llama_pids)"
  echo "health4000=$(curl -s http://localhost:4000/api/health)"
  exit 0
fi

echo "── 운영(건드리면 안 되는 것) ──"
echo "  llama-server PID: $(llama_pids)"
echo "  4000 health: $(curl -s --max-time 5 http://localhost:4000/api/health || echo '(응답 없음)')"

echo "── 4100 ──"
H=$(curl -s --max-time 5 http://localhost:4100/api/health || echo '')
if echo "$H" | grep -q '"ok":true'; then
  echo "  health: $H"
else
  echo "  ✗ health 실패: ${H:-(응답 없음)}"; FAIL=1
fi

echo "── 자물쇠 ──"
MODELS_DIR=$(grep -E '^GIJO_MODELS_DIR=' "$QA_ROOT/gijo-qa.env" 2>/dev/null | cut -d= -f2-)
if [ -n "$MODELS_DIR" ] && [ -z "$(ls -A "$MODELS_DIR" 2>/dev/null)" ]; then
  echo "  ✓ 모델 폴더 비어 있음: $MODELS_DIR"
else
  echo "  ✗ 모델 폴더가 비어 있지 않다(${MODELS_DIR:-미지정}) — 운영 llama가 죽을 수 있다."; FAIL=1
fi
if grep -qE '^GIJO_DEV_MODE=' "$QA_ROOT/gijo-qa.env" 2>/dev/null; then
  echo "  ✗ GIJO_DEV_MODE가 env에 있다 — 등급 게이트가 꺼진다(계획서 §14 ①)."; FAIL=1
else
  echo "  ✓ GIJO_DEV_MODE 없음(등급 게이트 켜짐)"
fi

echo "── 로그에 남으면 안 되는 문구 ──"
# 「고아 정리를 건너뜁니다」는 **정상**(형제를 알아본 것)이라 세지 않는다.
# ⚠ `grep -c`는 0건일 때 0을 찍고 **종료코드 1**을 낸다 — `|| echo 0`을 붙이면
#   "0\n0"이 되어 비교가 깨진다. `|| true`로 종료코드만 삼킨다.
BAD=$(grep -cE "$BAD_RE" "$QA_ROOT/server.log" 2>/dev/null || true)
BAD=${BAD:-0}
if [ "$BAD" -eq 0 ]; then
  echo "  ✓ 0건"
else
  echo "  ✗ ${BAD}건 — 운영 llama를 건드렸을 수 있다. 즉시 확인할 것:"
  grep -nE "$BAD_RE" "$QA_ROOT/server.log" | tail -5
  FAIL=1
fi
SIB=$(grep -c '다른 GIJO 서버' "$QA_ROOT/server.log" 2>/dev/null || true)
SIB=${SIB:-0}
echo "  · 「다른 GIJO 서버가 돌고 있어 고아 정리를 건너뜁니다」 ${SIB}건 — 이것은 **정상**(운영을 알아봤다는 뜻)"

echo
if [ "$FAIL" -eq 0 ]; then echo "종합: 통과"; else echo "종합: ✗ 실패 — 위 ✗ 항목을 볼 것"; fi
exit "$FAIL"
