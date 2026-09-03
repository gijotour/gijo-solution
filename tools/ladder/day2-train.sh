#!/bin/bash
# tools/ladder/day2-train.sh — 사다리 2일차: **RAFT형 학습 → 변환 → A/B → 게이트**(계획서 §12).
#
# ⚠ 변수·함수 이름은 영문만(bash 제약). 주석은 한글로, 왜를 적는다.
# ⚠ **gb10에서 돌린다.** GPU·venv-train·모델 파일이 거기 있다. win에서 부르려면:
#      ssh gb10 'cd ~/gijo-as && bash tools/ladder/day2-train.sh --round r1-base'
#
# 사용:
#   export GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=…
#   bash tools/ladder/day2-train.sh --round r1-base
#        [--rounds tools/ladder/rounds.json] [--port 8093] [--skip-build] [--skip-train] [--only-gate]
#
# 나가는 코드: 0=합격 · 1=게이트 불합격 · 3=env 없음 · 6=쓰는 법/설정 틀림 · 7=환경 없음 · 8=단계 실패
#
# ■ 절대 안 하는 것
#   · **4000의 학습 라우트를 부르지 않는다.** 제품 화면의 학습 버튼과 이 사다리가 같은 GPU·같은
#     outputs/를 놓고 다투면 서로를 깨뜨린다(직렬 자원). 학습은 여기서 **직접** 파이썬을 부른다.
#   · 8080(운영 두뇌)을 재기동하지 않는다. A/B는 **8093**에 따로 띄웠다 내린다.
#   · 공유 파일 ~/bench/models.json 을 고치지 않는다 — 회전마다 **자기 폴더에** models.json을 만들어
#     run.mjs 사본을 거기서 돌린다(다른 갈래가 같은 파일을 쓰고 있을 수 있다).
#
# ■ 왜 setsid nohup 인가
#   학습은 몇 시간이다. ssh가 끊기면 SIGHUP이 파이썬을 죽여 **밤이 통째로 사라진다**(그러고도
#   아침에는 「왜 안 돌았지」만 남는다). 세션에서 떼어 놓고, 진행은 로그 파일로 본다.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/ladder/common.sh
. "$HERE/common.sh"
REPO="$(ladder_repo)"
SERVER_DIR="$REPO/server"

ROUNDS_FILE="$HERE/rounds.json"
ROUND=""
PORT=8093
SKIP_BUILD=0
SKIP_TRAIN=0
ONLY_GATE=0
SERVER="${GIJO_SERVER_URL:-http://localhost:4000}"
VENV="${LADDER_VENV:-$HOME/venv-train}"
CONVERT="${LADDER_CONVERT:-$SERVER_DIR/llama.cpp-next/convert_lora_to_gguf.py}"
HF_BASE_DIR="${LADDER_HF_BASE_DIR:-}"                   # 로컬 HF 스냅샷(config.json이 있는 폴더). 없으면 --base-model-id 로 간다.
BASE_MODEL_ID="${GIJO_FT_BASE_MODEL:-Qwen/Qwen3-14B}"

while [ $# -gt 0 ]; do
  case "$1" in
    --round) ROUND="$2"; shift 2 ;;
    --rounds) ROUNDS_FILE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-train) SKIP_TRAIN=1; shift ;;
    --only-gate) ONLY_GATE=1; SKIP_BUILD=1; SKIP_TRAIN=1; shift ;;
    --server) SERVER="$2"; shift 2 ;;
    *) echo "모르는 인자: $1" >&2; exit 6 ;;
  esac
done

[ -n "$ROUND" ] || { echo "✗ --round <id> 가 필요하다. 있는 회전: $(node -e 'const j=require(process.argv[1]);console.log((j.회전||[]).map(r=>r.id).join(", "))' "$ROUNDS_FILE" 2>/dev/null)" >&2; exit 6; }
[ -s "$ROUNDS_FILE" ] || { echo "✗ 회전 설정 없음: $ROUNDS_FILE" >&2; exit 6; }

OUTDIR="$REPO/tools/team-bench/results-ladder/day2/$ROUND"
mkdir -p "$OUTDIR"

# ── 회전 설정 꺼내기 + 결과 옆에 복사 ────────────────────────────────
# ⚠ 여기서 값을 바꾸지 않는다. **그대로** 복사해 둬야 「이 결과가 어느 설정이었나」가 파일로 남는다.
node -e '
  const fs = require("node:fs");
  const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const r = (j.회전 ?? []).find((x) => x.id === process.argv[2]);
  if (!r) { console.error(`✗ 회전 ${process.argv[2]} 이(가) 설정에 없다`); process.exit(1); }
  fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 2));
' "$ROUNDS_FILE" "$ROUND" "$OUTDIR/round.json" || exit 6

read_round() { node -e 'const r=require(process.argv[1]);const v=r[process.argv[2]];console.log(v===undefined||v===null?"":String(v));' "$OUTDIR/round.json" "$1"; }
DATASET="$(read_round dataset)"
AGENT="$(read_round agent)"
TOPIC="$(read_round topic)"
RANK="$(read_round rank)"
LR="$(read_round lr)"
EPOCHS="$(read_round epochs)"
DISTRACTORS="$(read_round distractors)"
MAXSEQ="$(read_round maxSeq)"
BASE_OVERRIDE="$(read_round base)"
[ -n "$BASE_OVERRIDE" ] && BASE_MODEL_ID="$BASE_OVERRIDE"

ladder_log "2일차 회전 $ROUND — 데이터셋 $DATASET · rank $RANK · lr $LR · epochs $EPOCHS · 방해 $DISTRACTORS · maxSeq $MAXSEQ"
ladder_log "  설정 사본 → $OUTDIR/round.json"

LORA_DIR="$SERVER_DIR/data/lora/$ROUND"
ADAPTER_GGUF="$OUTDIR/adapter.gguf"
TRAIN_LOG="$OUTDIR/train.log"
DONE_MARK="$LORA_DIR/adapter_model.safetensors"

# ── ① RAFT 데이터셋 만들기 ────────────────────────────────────────────
if [ "$SKIP_BUILD" -eq 0 ]; then
  ladder_need_env GIJO_ADMIN_USER GIJO_ADMIN_PASSWORD
  if [ ! -s "$REPO/tools/build-raft-dataset.mjs" ]; then
    echo "✗ tools/build-raft-dataset.mjs 가 없다 — RAFT 빌더는 다른 갈래가 만든다. 그것이 들어온 뒤에 돌려라." >&2
    exit 7
  fi
  ladder_log "① RAFT 데이터셋 $DATASET (방해 $DISTRACTORS)"
  ( cd "$REPO" && node tools/build-raft-dataset.mjs --name "$DATASET" \
      ${TOPIC:+--topic "$TOPIC"} ${AGENT:+--agent "$AGENT"} \
      --distractors "$DISTRACTORS" --server "$SERVER" ) \
    2>&1 | tee "$OUTDIR/build.log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 데이터셋 만들기 실패 — $OUTDIR/build.log" >&2; exit 8; }
else
  ladder_log "① 데이터셋 만들기 건너뜀"
fi

DS_FILE="$SERVER_DIR/data/datasets/$DATASET.json"

# ── ② 학습(QLoRA) ────────────────────────────────────────────────────
if [ "$SKIP_TRAIN" -eq 0 ]; then
  [ -x "$VENV/bin/python" ] || { echo "✗ 학습 환경 없음: $VENV/bin/python — 이 단계는 gb10에서 돈다(LADDER_VENV로 바꿀 수 있다)." >&2; exit 7; }
  [ -s "$DS_FILE" ] || { echo "✗ 데이터셋 파일이 없다: $DS_FILE (빌더가 서버 창구로 저장한다 — 서버가 이 기계의 것인지 확인)" >&2; exit 8; }

  if [ -s "$DONE_MARK" ]; then
    # 밤/낮 전환은 **산출물 존재**로 가른다 — 이미 학습된 회전을 다시 태우지 않는다.
    ladder_log "② 학습 건너뜀 — 이미 어댑터가 있다($DONE_MARK). 다시 학습하려면 그 폴더를 치워라."
  else
    mkdir -p "$LORA_DIR"
    ladder_log "② 학습 시작(떼어 놓고 돈다) — 로그 $TRAIN_LOG"
    # ⚠ setsid nohup: ssh가 끊겨도 안 죽는다. 진행은 로그로만 본다.
    ( cd "$SERVER_DIR" && setsid nohup "$VENV/bin/python" scripts/finetune_qlora14b.py \
        --dataset "$DATASET" --output "data/lora/$ROUND" \
        --base-model "$BASE_MODEL_ID" --rank "$RANK" --lr "$LR" --epochs "$EPOCHS" --max-seq "$MAXSEQ" \
        > "$TRAIN_LOG" 2>&1 < /dev/null & echo $! > "$OUTDIR/train.pid" )
    TRAIN_PID="$(cat "$OUTDIR/train.pid")"
    ladder_log "   pid $TRAIN_PID — 끝날 때까지 기다린다(로그를 따로 보려면 tail -f $TRAIN_LOG)"
    while kill -0 "$TRAIN_PID" 2>/dev/null; do sleep 60; done
    if [ ! -s "$DONE_MARK" ]; then
      echo "✗ 학습이 끝났는데 어댑터가 없다 — 로그 마지막 40줄:" >&2
      tail -40 "$TRAIN_LOG" >&2
      exit 8
    fi
    ladder_log "   학습 끝 — $LORA_DIR"
  fi
else
  ladder_log "② 학습 건너뜀"
fi

# ── ③ GGUF 변환 ──────────────────────────────────────────────────────
if [ "$ONLY_GATE" -eq 0 ]; then
  if [ -s "$ADAPTER_GGUF" ]; then
    ladder_log "③ 변환 건너뜀 — 이미 있다($ADAPTER_GGUF)"
  else
    [ -s "$CONVERT" ] || { echo "✗ 변환 스크립트 없음: $CONVERT" >&2; exit 7; }
    [ -d "$LORA_DIR" ] || { echo "✗ 어댑터 폴더 없음: $LORA_DIR" >&2; exit 8; }
    ladder_log "③ GGUF 변환 → $ADAPTER_GGUF"
    if [ -n "$HF_BASE_DIR" ]; then
      # 로컬 스냅샷이 있으면 그것을 쓴다 — 폐쇄망에서 허브를 부르면 그 자리에서 죽는다.
      "$VENV/bin/python" "$CONVERT" --base "$HF_BASE_DIR" --outfile "$ADAPTER_GGUF" "$LORA_DIR" 2>&1 | tee "$OUTDIR/convert.log"
    else
      "$VENV/bin/python" "$CONVERT" --base-model-id "$BASE_MODEL_ID" --outfile "$ADAPTER_GGUF" "$LORA_DIR" 2>&1 | tee "$OUTDIR/convert.log"
    fi
    [ -s "$ADAPTER_GGUF" ] || { echo "✗ 변환 실패 — $OUTDIR/convert.log (폐쇄망이면 LADDER_HF_BASE_DIR로 로컬 config를 줘라)" >&2; exit 8; }
  fi
fi

# ── ④ A/B — 8093에 어댑터를 얹어 13과제를 돌린다 ─────────────────────
# ⚠ 공유 ~/bench/models.json 을 안 고친다. run.mjs 는 **자기 옆의** models.json을 읽으므로,
#   회전 폴더에 사본을 만들어 거기서 돌린다(다른 갈래가 같은 파일을 쓰고 있을 수 있다).
BENCH_SRC="$REPO/tools/team-bench"
RUNDIR="$OUTDIR/harness"
mkdir -p "$RUNDIR"
for f in run.mjs run-r2.mjs tasks.mjs tasks-r2.mjs; do
  [ -s "$BENCH_SRC/$f" ] || { echo "✗ 하네스 파일 없음: $BENCH_SRC/$f" >&2; exit 7; }
  cp "$BENCH_SRC/$f" "$RUNDIR/$f"
done

MODEL_ID="qwen3-14b+$ROUND"
node -e '
  const fs = require("node:fs");
  const [out, id, gguf] = process.argv.slice(1);
  // ⚠ ctx는 회차별 하네스가 인자로 준다(run.mjs 32768 · run-r2.mjs 65536). 여기 박아 두면 두 회차가 어긋난다.
  fs.writeFileSync(out, JSON.stringify([{
    id, path: "~/gijo-as/server/models/qwen3-14b/qwen3-14b.gguf",
    license: "Apache-2.0", thinking: true,
    note: "증류 사다리 회전 — 베이스 qwen3-14b + 이 회전의 어댑터",
    extra: ["--lora", gguf],
  }], null, 2));
' "$RUNDIR/models.json" "$MODEL_ID" "$ADAPTER_GGUF"

if [ "$ONLY_GATE" -eq 0 ]; then
  EASY_JSON="$OUTDIR/easy/$MODEL_ID.json"
  HARD_JSON="$OUTDIR/hard/$MODEL_ID.json"
  if ladder_have "$EASY_JSON"; then
    ladder_log "④ 1회차 건너뜀 — 이미 있다($EASY_JSON)"
  else
    ladder_log "④ 1회차 7과제 — 포트 $PORT"
    node "$RUNDIR/run.mjs" --only "$MODEL_ID" --port "$PORT" --ctx 32768 --out "$OUTDIR/easy" 2>&1 | tee "$OUTDIR/easy.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 1회차 실패 — $OUTDIR/easy.log" >&2; exit 8; }
  fi
  if ladder_have "$HARD_JSON"; then
    ladder_log "④ 2회차 건너뜀 — 이미 있다($HARD_JSON)"
  else
    # ⚠ --ctx 65536을 줘도 qwen3-14b는 n_ctx_train 40960에서 잘린다 — needle_64k는 원리상 0이다
    #   (results-ladder/baseline/README.md). 게이트가 기본으로 평균에서 빼는 이유가 그것이다.
    ladder_log "④ 2회차 6과제 — 포트 $PORT"
    node "$RUNDIR/run-r2.mjs" --only "$MODEL_ID" --port "$PORT" --ctx 65536 --out "$OUTDIR/hard" 2>&1 | tee "$OUTDIR/hard.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 2회차 실패 — $OUTDIR/hard.log" >&2; exit 8; }
  fi
fi

# ── ⑤ 게이트 ─────────────────────────────────────────────────────────
ladder_log "⑤ 게이트"
GATE_ARGS=(--easy "$OUTDIR/easy/$MODEL_ID.json" --hard "$OUTDIR/hard/$MODEL_ID.json" --out "$OUTDIR" --label "$ROUND")
[ -s "$OUTDIR/samples.json" ] && GATE_ARGS+=(--samples "$OUTDIR/samples.json")
[ -s "$OUTDIR/kev.json" ] && GATE_ARGS+=(--kev "$OUTDIR/kev.json")
node "$REPO/tools/team-bench/gates.mjs" "${GATE_ARGS[@]}"
GATE_RC=$?

ladder_log "회전 $ROUND 끝 — 판정 $OUTDIR/gate.md (코드 $GATE_RC)"
if [ "$GATE_RC" -ne 0 ]; then
  ladder_log "⚠ 게이트를 못 넘었다 — **채택하지 않는다.** 어댑터는 남겨 두고(다음 회전의 비교 대상) 설정을 바꿔 새 id로 돌려라."
fi
exit "$GATE_RC"
