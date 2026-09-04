#!/bin/bash
# tools/ladder/watch-r2.sh — 밤새 도는 회전을 5분마다 한 줄씩 적는 감시기.
#
# 적는 것: 메모리 used/available · swap · 열린 포트 수 · 마지막 loss 스텝 · 마지막 eval_loss · 체크포인트 수
# 왜 필요한가: 학습 로그는 캐리지리턴(\r)으로 한 줄을 덮어쓰며 흐른다 — 사람이 tail로 봐도
#   「몇 시에 어디였나」가 안 남는다. 이 감시기가 **시각과 함께** 한 줄씩 남겨 나중에 되짚게 한다.
#
# ★ 이 파일의 내력(2026-09-04 승격): 회전 2 때 gb10의 `~/bench/ladder/watch-r2.sh` 에만 있었다.
#   저장소로 올리면서 회전 이름·경로·간격을 인자/env로 뺐다 — 기본값은 그때 그대로다.
#   원본 그대로 둔 것: 5분 간격 · 적는 칸의 순서와 이름(그때 로그와 눈으로 견줄 수 있어야 한다).
#   바뀐 것 하나: 로그 이름이 `watch-r2.log` → `watch-<회전>.log` 다. 원본은 회전 이름이 박혀 있어
#   회전 셋을 동시에 보면 **한 파일에 뒤섞였다**(누가 어느 줄인지 못 가린다).
#   ⚠ 본문은 ASCII로 쓴다(ssh 너머에서 편집될 수 있어 한글이 깨진 적이 있다) — 설명만 여기 한글이다.
#
# 쓰는 법(gb10, 배경으로):
#   setsid nohup bash tools/ladder/watch-r2.sh r2-v2 > /dev/null 2>&1 &
#   tail -f ~/bench/ladder/watch-r2-v2.log
#   내릴 때:  pkill -f 'watch-r2.sh r2-v2'
#   ⚠ pkill 자기매칭 주의 — 이 스크립트를 부른 쉘 자신이 걸려 같이 죽을 수 있다(회전 이름을 꼭 붙일 것).
#
# 자리 바꾸기(전부 env — 안 주면 gb10 기본값):
#   LADDER_HOME      로그가 쌓이는 곳        기본 $HOME/bench/ladder
#   LADDER_REPO_DIR  저장소                  기본 $HOME/gijo-as
#   LADDER_INTERVAL  표본 간격(초)           기본 300
#   LADDER_PORTS     세는 포트(정규식 대안)  기본 8080|8081|4000
set -u

ROUND="${1:-r2-v2}"
LADDER_HOME="${LADDER_HOME:-$HOME/bench/ladder}"
REPO="${LADDER_REPO_DIR:-$HOME/gijo-as}"
INTERVAL="${LADDER_INTERVAL:-300}"
PORTS="${LADDER_PORTS:-8080|8081|4000}"

LOG="$LADDER_HOME/watch-$ROUND.log"
TRAIN="$REPO/tools/team-bench/results-ladder/day2/$ROUND/train.log"
CKDIR="$REPO/server/data/lora/$ROUND"

mkdir -p "$LADDER_HOME"
echo "$(date +%H:%M:%S) watch start round=$ROUND pid=$$ train=$TRAIN interval=${INTERVAL}s" >> "$LOG"

while true; do
  TS="$(date +%H:%M:%S)"
  MEM="$(LC_ALL=C free -g | awk "/^Mem:/{print \$3\"/\"\$7}")"
  SWP="$(LC_ALL=C free -g | awk "/^Swap:/{print \$3}")"
  # \r 로 덮어쓰며 흐르는 로그라 tr 로 줄을 갈라야 마지막 스텝이 보인다.
  STEP="$(tr "\r" "\n" < "$TRAIN" 2>/dev/null | grep -a -o "step [0-9]*/[0-9]* loss=[0-9.]*" | tail -1)"
  EV="$(tr "\r" "\n" < "$TRAIN" 2>/dev/null | grep -a -o "eval [0-9]*/[0-9]* eval_loss=[0-9.]*" | tail -1)"
  CK="$(ls -d "$CKDIR"/checkpoint-* 2>/dev/null | wc -l)"
  P="$(ss -lnt 2>/dev/null | grep -c -E ":($PORTS)\b")"
  echo "$TS used/avail=${MEM}G swap=${SWP}G ports=$P ckpt=$CK ${STEP:-step -} ${EV:-eval -}" >> "$LOG"
  sleep "$INTERVAL"
done
