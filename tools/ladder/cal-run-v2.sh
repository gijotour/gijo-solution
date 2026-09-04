#!/bin/bash
# tools/ladder/cal-run-v2.sh — 회전을 통째로 굽기 전에 **10스텝만** 돌려 재는 캘리브레이션.
#
# 재는 것: ① 초/스텝  ② 「길이 초과 제외 N」  ③ free -g 최소 가용(메모리가 버티나)
# 왜 10스텝인가: 160행 · epochs 1 · batch 1 × 누적 16 = 정확히 10스텝이다.
#   슬라이스는 `node tools/ladder/make-cal-slice.mjs <데이터셋.json> --n 160` 으로 뽑는다(식이 그 안에 있다).
#
# ★ 이 파일의 내력(2026-09-04 승격): 회전 1·2 때는 gb10의 `~/bench/ladder/cal-run-v2.sh` 에만 있었다.
#   기계 홈에만 있는 스크립트는 **기계가 바뀌면 사라지고, 시험도 검토도 안 붙는다.** 저장소로 올리면서
#   $HOME 에 박혀 있던 자리를 전부 env로 뺐다 — 값은 gb10 기본값 그대로라 gb10에서는 하던 대로 돈다.
#   원본에서 안 바꾼 것: 명령 꼴 · 인자 · 로그 이름 · setsid nohup 꼴(그때의 실측과 견줄 수 있어야 한다).
#
# 쓰는 법(gb10):
#   bash tools/ladder/cal-run-v2.sh [maxSeq] [데이터셋id]
#   bash tools/ladder/cal-run-v2.sh 4096 raft-vuln-v2-cal160
#
# 자리 바꾸기(전부 env — 안 주면 gb10 기본값):
#   LADDER_HOME        결과·pid·로그가 쌓이는 곳            기본 $HOME/bench/ladder
#   LADDER_WORK_DIR    학습이 도는 곳(data/datasets/ 를 여기 기준으로 읽는다)  기본 $HOME/bench/lora-vuln
#   LADDER_REPO_DIR    저장소(파이썬 학습기가 있는 곳)      기본 $HOME/gijo-as
#   LADDER_PYTHON      학습용 파이썬                        기본 $HOME/venv-train/bin/python
#   LADDER_HF_BASE_DIR 베이스 모델(HF 폴더)                 기본 $HOME/hf/Qwen3-14B
#   LADDER_CAL_TAG     결과 폴더 이름표                     기본 day2-cal-v2
set -u

MAXSEQ="${1:-4096}"
DS="${2:-raft-vuln-v2-cal160}"

LADDER_HOME="${LADDER_HOME:-$HOME/bench/ladder}"
WORK="${LADDER_WORK_DIR:-$HOME/bench/lora-vuln}"
REPO="${LADDER_REPO_DIR:-$HOME/gijo-as}"
PY="${LADDER_PYTHON:-$HOME/venv-train/bin/python}"
BASE="${LADDER_HF_BASE_DIR:-$HOME/hf/Qwen3-14B}"
TAG="${LADDER_CAL_TAG:-day2-cal-v2}"

OUT="$LADDER_HOME/$TAG"
LOG="$OUT/cal-$MAXSEQ.log"
MEM="$OUT/mem-$MAXSEQ.log"
TRAINER="$REPO/server/scripts/finetune_qlora14b.py"

# ── 시작 전에 없는 것을 말한다 ────────────────────────────────────────────
# ⚠ 여기서 안 보면 몇 분 뒤 로그 속에서 죽는다 — 캘리브레이션은 「빨리 알려고」 도는 자리라
#   그 몇 분이 이 스크립트의 존재 이유를 깎아먹는다.
[ -x "$PY" ]        || { echo "✖ 파이썬이 없습니다: $PY  (LADDER_PYTHON 으로 지정)"; exit 2; }
[ -f "$TRAINER" ]   || { echo "✖ 학습기가 없습니다: $TRAINER  (LADDER_REPO_DIR 로 지정)"; exit 2; }
[ -d "$BASE" ]      || { echo "✖ 베이스 모델 폴더가 없습니다: $BASE  (LADDER_HF_BASE_DIR 로 지정)"; exit 2; }
[ -d "$WORK" ]      || { echo "✖ 작업 폴더가 없습니다: $WORK  (LADDER_WORK_DIR 로 지정)"; exit 2; }
# 학습기는 **cwd 기준** data/datasets/<id>.json 을 읽는다(finetune_qlora14b.py:75) — 그 자리를 그대로 본다.
[ -f "$WORK/data/datasets/$DS.json" ] || {
  echo "✖ 데이터셋이 없습니다: $WORK/data/datasets/$DS.json"
  echo "   (슬라이스는 win에서 node tools/ladder/make-cal-slice.mjs <원본.json> --n 160 으로 뽑아 scp 합니다)"
  exit 2
}

mkdir -p "$OUT"
rm -rf "$OUT/out-$MAXSEQ" "$LOG" "$MEM"

# 메모리 표본기 — 5초마다 free -g 의 available 칸. 학습이 끝나도 안 죽으니 pid를 남긴다.
setsid nohup bash -c "while true; do echo \"\$(date +%H:%M:%S) \$(LC_ALL=C free -g | awk '/^Mem:/{print \$7}')\"; sleep 5; done" \
  > "$MEM" 2>&1 < /dev/null &
echo $! > "$OUT/mem-$MAXSEQ.pid"

cd "$WORK" || exit 1
setsid nohup bash -c "'$PY' '$TRAINER' \
  --dataset $DS --output '$OUT/out-$MAXSEQ' \
  --base-model '$BASE' --rank 16 --lr 1e-4 --epochs 1 --max-seq $MAXSEQ 2>&1 \
  | gawk '{ print strftime(\"%H:%M:%S\"), \$0; fflush() }'" \
  > "$LOG" 2>&1 < /dev/null &
echo $! > "$OUT/cal-$MAXSEQ.pid"

echo "시작 pid=$(cat "$OUT/cal-$MAXSEQ.pid") · 로그 $LOG · 메모리 $MEM · maxSeq $MAXSEQ · 데이터셋 $DS · base $BASE"
echo "끝나면 표본기를 내립니다:  kill \$(cat '$OUT/mem-$MAXSEQ.pid')"
echo "볼 것 ①  grep -a '길이 초과 제외' '$LOG'      ← 0이 아니면 뒤(=답)가 잘린 행이 생긴 것입니다"
echo "볼 것 ②  grep -a -o 'step [0-9]*/[0-9]*' '$LOG' | tail -3   ← 스텝 간격이 곧 초/스텝"
echo "볼 것 ③  sort -k2 -n '$MEM' | head -1                        ← 최소 가용 메모리"
