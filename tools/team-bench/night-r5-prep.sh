#!/bin/bash
# tools/team-bench/night-r5-prep.sh — 회전 5 **밤 준비 작업**(gb10 전용, 03:15 KST 이후).
#
# ■ 왜 밤인가: 낮의 gb10은 원격 팀원 셋의 두뇌(교사 8080)다. 학습·27B는 그 GPU를 통째로 먹는다.
#   그리고 야간 회귀(03:00~03:05)와도 겹치면 안 된다 — 그래서 03:15다.
#
# ■ 이 스크립트가 **절대 안 하는 것**
#   · 8080(교사)·8081(임베딩)을 내리거나 다시 묶지 않는다. 그 둘의 PID는 건드리지 않는다.
#   · --host 를 주지 않는다(루프백을 빼앗는다 — 감시가 되돌린다).
#   · 운영 데이터를 쓰지 않는다.
#
# ■ 차례
#   ① 시작 상태 기록(교사 health · 메모리 · 포트)
#   ② 27B를 **격리 포트 8300**에 올려 재료의 사실 주장 행을 되묻고, 27B를 내린다
#   ③ 되묻기 결과로 v5를 확정한다(불일치 행만 버린다 · 모름은 남긴다)
#   ④ bf16 100스텝 스모크 — **가용 메모리에 드는가 · 교사가 밀리지 않는가**를 잰다
#   ⑤ 끝 상태 기록(교사 health를 **다시** 확인 — 우리가 남의 두뇌를 밀지 않았음을 숫자로 남긴다)
#
# 쓰는 법(gb10):  bash ~/bench/ladder/r5/night-r5-prep.sh
set -u
# ⚠ 비대화형 셸은 .bashrc를 안 읽는다 — node·PATH가 여기서 온다(gb10 규약).
[ -f "$HOME/gijo-env.sh" ] && . "$HOME/gijo-env.sh"
# ⚠ **변수명은 영문만.** bash는 한글 변수명을 못 읽는다(2026-08-10에 밟았고 또 밟을 뻔했다).
R5=${R5:-$HOME/bench/ladder/r5}
LOG=${LOG:-$R5/night1.log}
REPO=${REPO:-$HOME/gijo-as}
SERVER=$REPO/server
PORT27=${PORT27:-8300}
MODEL27=${MODEL27:-$SERVER/models/qwen38-27b/qwen38-27b.gguf}
LLAMA=${LLAMA:-$SERVER/llama.cpp-next/build/bin/llama-server}
VENV=${VENV:-$HOME/venv-train}
# 도구가 저장소의 잣대를 부르게 길을 알려 준다 — 사본에 잣대를 또 적지 않기 위해서다.
export GIJO_GATES=${GIJO_GATES:-$REPO/tools/team-bench/gates.mjs}
export GIJO_RAFT_BUILDER=${GIJO_RAFT_BUILDER:-$REPO/tools/build-raft-dataset.mjs}
export GIJO_MATERIAL_R5=${GIJO_MATERIAL_R5:-$R5/material-r5.mjs}
DATASET=${DATASET:-raft-vuln-v5-final}
SMOKE_OUT=${SMOKE_OUT:-$R5/smoke-bf16}

mkdir -p "$R5"
say() { echo "[$(date '+%F %T %Z')] $*" | tee -a "$LOG"; }
mem() { free -g | awk '/^메모리|^Mem/ {print "총 "$2"G 사용 "$3"G 가용 "$7"G"}'; }
teacher() { curl -s -m 5 http://127.0.0.1:8080/health || echo "(응답 없음)"; }

say "════ 회전 5 밤 준비 시작 ════"
say "교사(8080) health: $(teacher)  ·  메모리: $(mem)"
say "임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"

# ── ② 27B 되묻기 ────────────────────────────────────────────────────────
AVAIL=$(free -g | awk '/^메모리|^Mem/ {print $7}')
if [ "${AVAIL:-0}" -lt 22 ]; then
  say "⚠ 가용 메모리 ${AVAIL}G — 27B(16.5G+KV)를 올리면 교사를 밀 수 있다. **되묻기를 건너뛴다.**"
  CROSS=skip
elif [ ! -f "$MODEL27" ]; then
  say "⚠ 27B GGUF가 없다: $MODEL27 — 되묻기를 건너뛴다"
  CROSS=skip
else
  say "27B를 격리 포트 $PORT27 에 올린다(--host 없음 = 루프백만)"
  nohup "$LLAMA" -m "$MODEL27" -ngl -1 --ctx-size 8192 --parallel 1 --port "$PORT27" \
    > "$R5/serve-27b.log" 2>&1 &
  PID27=$!
  say "27B PID=$PID27 — 예열을 기다린다(최대 20분)"
  for i in $(seq 1 240); do
    sleep 5
    if curl -s -m 3 "http://127.0.0.1:$PORT27/health" | grep -q '"ok"'; then break; fi
    if ! kill -0 "$PID27" 2>/dev/null; then say "✗ 27B가 죽었다 — serve-27b.log를 보라"; break; fi
  done
  if curl -s -m 3 "http://127.0.0.1:$PORT27/health" | grep -q '"ok"'; then
    say "27B 준비됨 · 메모리: $(mem) · 교사 health: $(teacher)"
    node "$R5/crosscheck27b.mjs" --in "$SERVER/data/datasets/raft-vuln-v5.json" \
      --out "$R5/crosscheck-27b.json" --final "$SERVER/data/datasets/$DATASET.json" \
      --port "$PORT27" --prompt-spec "$R5/prompt-spec.json" 2>&1 | tee -a "$LOG"
    CROSS=done
  else
    say "✗ 27B가 안 떴다 — 되묻기를 못 했다(재료는 그대로 둔다)"
    CROSS=fail
  fi
  # ⚠ **우리가 띄운 PID만** 내린다. pkill llama-server 같은 건 교사까지 죽인다.
  if [ -n "${PID27:-}" ] && kill -0 "$PID27" 2>/dev/null; then
    kill "$PID27"; sleep 10
    kill -0 "$PID27" 2>/dev/null && { say "27B가 안 내려가 KILL"; kill -9 "$PID27"; sleep 5; }
  fi
  say "27B 내림 · 메모리: $(mem) · 교사 health: $(teacher)"
fi

# 되묻기를 못 했으면 v5를 그대로 확정본 자리에 둔다 — **없는 파일로 학습이 죽는 것**보다
# 「되묻기 안 함」이 로그에 남는 편이 낫다(그 사실은 아래 요약에 적힌다).
if [ ! -f "$SERVER/data/datasets/$DATASET.json" ]; then
  cp "$SERVER/data/datasets/raft-vuln-v5.json" "$SERVER/data/datasets/$DATASET.json"
  say "⚠ 되묻기 결과가 없어 v5를 그대로 확정본으로 뒀다(cross=$CROSS)"
fi
say "확정 재료 행 수: $(node -e "console.log(JSON.parse(require('fs').readFileSync('$SERVER/data/datasets/$DATASET.json','utf8')).length)")"

# ── ④ bf16 100스텝 스모크 ───────────────────────────────────────────────
# 학습기는 **저장소 것**을 먼저 쓴다 — 사본은 저장소가 아직 새 깃발을 못 받았을 때만 쓴다.
FT=$SERVER/scripts/finetune_qlora14b.py
if ! grep -q -- "--precision" "$FT" 2>/dev/null; then
  say "저장소 학습기에 --precision 이 없다(아직 push 전) — 사본을 쓴다: $R5/finetune_qlora14b.py"
  FT=$R5/finetune_qlora14b.py
fi
say "학습기: $FT"
say "스모크 시작 — bf16 · LoRA all · 100스텝 · max_seq 4096 · 메모리를 5초마다 적는다"
( while true; do echo "[$(date '+%T')] $(mem)"; sleep 5; done ) > "$R5/smoke-mem.log" 2>&1 &
MEMPID=$!
cd "$SERVER" || exit 1
GIJO_FT_BASE_MODEL=${GIJO_FT_BASE_MODEL:-Qwen/Qwen3-14B} \
  "$VENV/bin/python" "$FT" --dataset "$DATASET" --output "$SMOKE_OUT" \
  --precision bf16 --lora-targets all --max-steps 100 --max-seq 4096 --epochs 1 \
  > "$R5/smoke-bf16.log" 2>&1
SMOKE=$?
kill "$MEMPID" 2>/dev/null
say "스모크 종료코드 $SMOKE · 마지막 줄: $(tail -3 "$R5/smoke-bf16.log" | tr '\n' ' ' | cut -c1-300)"
say "스모크 중 최대 사용 메모리: $(awk '{for(i=1;i<=NF;i++) if($i=="사용") {gsub("G","",$(i+1)); if($(i+1)+0>m) m=$(i+1)+0}} END{print m"G"}' "$R5/smoke-mem.log")"

# ── ⑤ 끝 상태 ───────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"
say "메모리: $(mem)"
say "요약 — 되묻기=$CROSS · 스모크종료코드=$SMOKE · 재료=$DATASET"
say "════ 회전 5 밤 준비 끝 ════"
