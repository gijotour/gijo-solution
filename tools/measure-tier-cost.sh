#!/bin/bash
# tools/measure-tier-cost.sh — **등급별 실제 메모리 점유**를 재는 도구.
#
# ■ 왜 이 기계에서 재나 (2026-08-12)
#   `TIER_COST`는 「이 등급이 이 플랫폼에서 얼마 먹나」를 적어 둔 표이고, `tierFits`가
#   그것으로 권장 등급을 고른다. 숫자가 틀리면 **안 들어가는 기계에 권하거나**
#   **들어가는데 안 권한다.**
#   ⚠ **32GB 기계에서 10GB 등급을 흉내 내지 말 것**(max 실측 2026-08-12 — 세 번 재서 세 번 다
#     다른 변수에 걸렸다: 티어가 standard라 ctx가 16384였고, 티어 변경은 defaultModelId만 바꿨고,
#     에이전트 배정이 14B로 남아 예열이 14B를 같이 띄웠다).
#     **재려는 구성 그대로 뜨는 기계에서 잰다.**
#
# ■ 재는 법 — 적재 **전후 여유 메모리 차이**. 통합메모리(GB10·Apple)는 nvidia-smi가
#   [N/A]를 주므로 CUDA 런타임이 보고하는 값(llama-server --list-devices)을 쓴다.
#
# 사용: bash tools/measure-tier-cost.sh <모델경로> <ctx> [포트]
set -u
MODEL="${1:?모델 경로가 필요하다}"
CTX="${2:?ctx 크기가 필요하다}"
PORT="${3:-8098}"
BIN="$HOME/gijo-as/server/llama.cpp/build/bin/llama-server"

free_mb() { "$BIN" --list-devices 2>/dev/null | grep -oE '[0-9]+ MiB free' | grep -oE '^[0-9]+'; }

echo "모델: $MODEL"
echo "ctx : $CTX"
BEFORE=$(free_mb)
echo "적재 전 여유: ${BEFORE} MiB"

"$BIN" -m "$MODEL" --host 127.0.0.1 --port "$PORT" -ngl 99 -c "$CTX" > /tmp/tiercost.log 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  grep -q "server is listening\|llama_server: listening" /tmp/tiercost.log 2>/dev/null && break
  sleep 2
done
if ! grep -q "listening" /tmp/tiercost.log 2>/dev/null; then
  echo "★ 60초 안에 안 떴다 — 로그:"; tail -5 /tmp/tiercost.log; exit 1
fi

sleep 3
AFTER=$(free_mb)
echo "적재 후 여유: ${AFTER} MiB"
USED=$((BEFORE - AFTER))
echo
echo "★ 점유: ${USED} MiB = $(awk "BEGIN{printf \"%.2f\", $USED/1024}") GB"
echo
echo "모델 정보:"
grep -iE "n_params|model type|model size|n_ctx " /tmp/tiercost.log | head -5
echo
echo "⚠ 이 값은 **적재 직후**다. 실사용 예열(프리필·동시 요청) 뒤에는 더 는다 —"
echo "   표에 넣기 전에 실제 질문을 몇 번 돌려 다시 잴 것."
