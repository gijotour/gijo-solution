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
# ★ 학습 직전에 **등급·인용·겹침 관문**(tools/team-bench/gradegate.mjs)이 돈다 — 빨강이면 안 굽는다.
#   창 집합은 round.json 의 cwinFile 또는 환경변수 LADDER_CWIN 으로 준다(없으면 반쪽 관문이라고 말한다).
#   잣대가 바뀌어 **같은 회전을 다시 재야** 할 때(학습·변환·13과제는 그대로 두고 표본·KEV만):
#   bash tools/ladder/day2-train.sh --round r1-base --only-probe --probe-out probe-v2
#        → results-ladder/day2/<회전>/probe-v2/{samples-*,kev,gate.md} — 옛 결과를 덮지 않는다.
#   베이스 대조(어댑터 없이 한 번만):
#   bash tools/ladder/day2-train.sh --baseline-probe [--port 8093]
#        → results-ladder/baseline/{samples-grounded,samples-distractor-only,samples-bare,samples-persona,kev}.json
#          관문 ①(KEV 하락 0)·⑤(잘림 증가 0)·⑧(근거 인용)은 **이 파일들이 있어야** 잰다(없으면 미측정=불합격).
#
# ■ 에폭마다 재기 (회전 설정에 `saveEpochs: true` 가 있을 때)
#   학습이 어댑터 폴더에 checkpoint-* 를 남기면, 이 사슬은 그 **하나하나를 판으로** 잰다:
#     checkpoint-<스텝> → adapter-epN.gguf → 결과 results-ladder/day2/<회전>/epN/{easy,hard,samples-*,kev,gate.md}
#   에폭 번호는 스텝 번호를 오름차순 정렬한 **자리**다(폴더 이름의 숫자는 총 스텝이지 에폭이 아니다).
#   체크포인트가 없으면 종전 그대로 — 마지막 어댑터 하나만 재고 파일 자리도 바뀌지 않는다.
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
BASELINE_PROBE=0
ONLY_PROBE=0
# ④-2(표본·KEV)를 **어디에** 쓸까. 비면 회전 폴더 그대로.
# ★ 왜 필요한가(2026-09-04): 잣대(관문 ⑧⑨⑩⑪)가 뒤늦게 생겨 **같은 회전을 다시 재야** 했는데,
#   그때 옛 파일을 덮으면 「잣대를 바꾸기 전에는 뭐였나」를 견줄 상대가 사라진다. 덮지 않고 옆에 쌓는다.
PROBE_OUT=""
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
    # ④-2(표본·KEV)만 다시 재고 게이트를 매긴다 — 학습·변환·13과제 A/B는 건드리지 않는다.
    --only-probe) ONLY_PROBE=1; SKIP_BUILD=1; SKIP_TRAIN=1; shift ;;
    --probe-out) PROBE_OUT="$2"; shift 2 ;;
    --baseline-probe) BASELINE_PROBE=1; shift ;;
    --server) SERVER="$2"; shift 2 ;;
    *) echo "모르는 인자: $1" >&2; exit 6 ;;
  esac
done

BENCH_SRC="$REPO/tools/team-bench"
BASELINE_DIR="$BENCH_SRC/results-ladder/baseline"
# ★ 프롬프트 규격 파일(2026-09-04 · R3) — 근거 꼴을 **저장소에서** 읽는 길.
#   왜: 이 사슬은 gb10에서 도는데, 거기서 관리자 4000(win 운영은 VPN 너머·계정당 1세션)에 닿는 길이
#   마땅치 않아 「학습과 같은 꼴로 재는가」가 남의 기계 사정에 매여 있었다.
#   있으면 쓰고, 없으면 종전대로 창구로 간다(win에서는 둘 다 된다).
#   규격 뽑기: win에서 `node tools/ladder/export-prompt-spec.mjs`
PROMPT_SPEC="${LADDER_PROMPT_SPEC:-$BENCH_SRC/prompt-spec.json}"

# 베이스 모델·llama-server는 **두 갈래가 같은 것**을 쓴다(베이스 대조 · 회전 표본). 한 곳에서 정한다.
BASE_GGUF="${LADDER_BASE_GGUF:-$SERVER_DIR/models/qwen3-14b/qwen3-14b.gguf}"
LLAMA_BIN="${LLAMA_SERVER:-$SERVER_DIR/llama.cpp-next/build/bin/llama-server}"

# ── 두뇌 띄우기/내리기 ────────────────────────────────────────────────
# ⚠ 왜 공용 함수인가(2026-09-04 검토관 적발): 표본·KEV 하네스는 $PORT의 두뇌에 직접 던지는데,
#   ④의 run.mjs·run-r2.mjs는 회차가 끝날 때마다 **자기가 띄운 서버를 죽인다**(run.mjs:106 finally).
#   그래서 ④-2 자리에는 두뇌가 하나도 없었다 — 사슬을 끝까지 돌리면 ECONNREFUSED로 exit 8이라,
#   관문 ⑧·⑩은 회전 갈래에서 영영 「미측정=불합격」이었다. 띄우는 일을 사슬 안으로 들여온다.
SERVE_PID=""
serve_stop() {
  [ -n "$SERVE_PID" ] || return 0
  kill "$SERVE_PID" 2>/dev/null
  # 포트가 실제로 놓일 때까지 기다린다 — 다음 단계가 「포트 이미 사용 중」으로 죽지 않게.
  local i
  for i in $(seq 1 40); do kill -0 "$SERVE_PID" 2>/dev/null || break; sleep 0.5; done
  # 아직 살아 있을 때만 -9 — 이미 죽은 PID에 쏘면 그 번호를 물려받은 **남의 프로세스**를 죽인다.
  kill -0 "$SERVE_PID" 2>/dev/null && kill -9 "$SERVE_PID" 2>/dev/null
  SERVE_PID=""
}
# ⚠ EXIT에도 건다 — 옆길로 나가는 exit(예: ladder_need_env의 exit 3)에서도 8093에 두뇌를 안 남긴다.
#   INT·TERM만 걸어 두었더니 env가 빈 실행에서 서버가 그대로 남았다(그 파일이 스스로 금지한 사고다).
trap 'serve_stop' EXIT
trap 'serve_stop; exit 130' INT
trap 'serve_stop; exit 143' TERM

# serve_start <로그파일> <gguf> [추가 인자...] — $PORT에 두뇌를 띄우고 /health가 뜰 때까지 기다린다.
serve_start() {
  local log="$1" gguf="$2"; shift 2
  [ -s "$gguf" ] || { echo "✗ 모델 파일 없음: $gguf (LADDER_BASE_GGUF로 바꿀 수 있다)" >&2; return 7; }
  [ -x "$LLAMA_BIN" ] || { echo "✗ llama-server 없음: $LLAMA_BIN" >&2; return 7; }
  if curl -s -o /dev/null -m 3 "http://127.0.0.1:$PORT/health" 2>/dev/null; then
    echo "✗ 포트 $PORT 가 이미 쓰이고 있다 — 남의 모델을 재게 된다. 다른 --port를 쓰거나 그 서버를 내려라." >&2
    return 8
  fi
  # ⚠ setsid를 쓰지 않는다 — `setsid cmd &` 의 `$!`는 setsid의 PID라 **정작 llama-server를 못 죽인다**
  #   (학습과 달리 이 서버는 몇 분짜리라 세션에서 떼어 놓을 이유도 없다). nohup으로 HUP만 막는다.
  nohup "$LLAMA_BIN" -m "$gguf" "$@" -ngl -1 --ctx-size 32768 --parallel 1 --port "$PORT" --jinja \
    --reasoning off --reasoning-budget 0 > "$log" 2>&1 < /dev/null &
  SERVE_PID=$!
  ladder_log "   두뇌 적재 중(pid $SERVE_PID) — 로그 $log"
  local i
  for i in $(seq 1 300); do
    # ★★ **200을 요구한다**(2026-09-04 실측 사고). llama.cpp는 모델을 읽는 동안 /health를
    #   **503**으로 답하는데 `curl -s`는 503에도 종료코드 0이다 — 그래서 옛 조건은
    #   「포트가 답하는가」만 물었다. 실측: 9GB를 읽기 시작한 지 **3초 만에** 준비됐다고 판정해
    #   표본 42개를 **전부 0자**로 받아 적고 사슬이 코드 0으로 끝났다(게이트는 미측정으로 막았지만,
    #   그 파일이 「베이스 대조」라는 이름으로 저장소에 남을 뻔했다).
    #   묻는 것은 「답하는가」가 아니라 **「다 읽었는가」**다.
    if [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$PORT/health" 2>/dev/null)" = "200" ]; then return 0; fi
    kill -0 "$SERVE_PID" 2>/dev/null || break
    sleep 2
  done
  echo "✗ 두뇌가 안 떴다 — $log" >&2
  serve_stop
  return 8
}

# ── 표본·KEV 시험(공용) ──────────────────────────────────────────────
# ⚠ ask-samples.mjs·kev-probe.mjs는 **저장소 자리에서** 부른다(harness/ 사본으로 복사하지 않는다) —
#   `../build-raft-dataset.mjs`(근거 조립 함수)를 불러 쓰므로 옮기면 그 import가 깨진다.
# ⚠ 학습 꼴과 같은 근거 블록을 서버에서 받아 오므로 GIJO_ADMIN_* 가 필요하다(bare는 서버 없이도 된다).
run_probes() {  # $1=출력 디렉터리 · $2=이 판의 이름(로그용)
  local dir="$1" who="$2"
  mkdir -p "$dir"
  # ★ 규격 파일이 있으면 그것을 쓰고 **회전 폴더에 사본을 남긴다**(2026-09-04 · R3).
  #   사본을 남기는 이유: 결과 파일만 들고 「어떤 근거 꼴로 쟀나」를 나중에 가릴 수 있어야 한다.
  #   저장소의 규격이 그 사이 바뀌어도, 이 회전이 실제로 쓴 것은 이 사본이 증언한다.
  local SPEC_ARGS=()
  if [ -f "$PROMPT_SPEC" ]; then
    cp "$PROMPT_SPEC" "$dir/prompt-spec.json"
    SPEC_ARGS=(--prompt-spec "$dir/prompt-spec.json")
    ladder_log "   근거 꼴: 규격 파일 $PROMPT_SPEC → $dir/prompt-spec.json (서버 불필요)"
  else
    # 규격이 없으면 종전대로 창구로 간다 — 그러려면 관리자 env가 있어야 한다.
    ladder_log "   근거 꼴: 창구(GET /api/learnloop/raft/prompt) — 규격 파일이 없다($PROMPT_SPEC)"
    ladder_need_env GIJO_ADMIN_USER GIJO_ADMIN_PASSWORD
  fi
  # ★ persona(2026-09-04 · R3) — 팀원 프롬프트만 주고 근거 블록은 안 준다. 관문 ⑨의 모집단이
  #   bare(프롬프트조차 없음)에서 이쪽으로 옮겨졌다: 제품은 프롬프트 없이 모델을 부르지 않는다.
  #   bare도 계속 잰다 — 관문 ⑤(잘림)가 그 자리를 베이스와 짝지어 보고, 표의 참고값으로도 쓰인다.
  for mode in grounded distractor-only bare persona; do
    if ladder_have "$dir/samples-$mode.json"; then
      ladder_log "   표본[$mode] 건너뜀 — 이미 있다"
      continue
    fi
    ladder_log "   표본[$mode] ($who) — 포트 $PORT"
    PORT="$PORT" node "$BENCH_SRC/ask-samples.mjs" "$dir/samples-$mode.json" --mode "$mode" --server "$SERVER" --agent "${AGENT:-normaltic}" \
      "${SPEC_ARGS[@]}" 2>&1 | tee "$dir/samples-$mode.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 표본[$mode] 실패 — $dir/samples-$mode.log" >&2; return 8; }
  done
  if ladder_have "$dir/kev.json"; then
    ladder_log "   KEV 건너뜀 — 이미 있다"
  else
    ladder_log "   KEV 3문항 ($who) — 포트 $PORT"
    PORT="$PORT" node "$BENCH_SRC/kev-probe.mjs" "$dir/kev.json" --server "$SERVER" --agent "${AGENT:-normaltic}" \
      "${SPEC_ARGS[@]}" 2>&1 | tee "$dir/kev.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ KEV 시험 실패 — $dir/kev.log" >&2; return 8; }
  fi
  # ★ 무슨 인자로 쟀는지를 파일로 남긴다 — 「--system을 줬는지조차 결과로 못 가렸다」의 수리.
  node -e '
    const fs = require("node:fs");
    const [out, port, server, agent, who, specPath] = process.argv.slice(1);
    const spec = specPath ? ` --prompt-spec ${specPath}` : "";
    fs.writeFileSync(out, JSON.stringify({
      누구: who, 잰때: new Date().toISOString(), port: Number(port), server, agent,
      표본: ["grounded", "distractor-only", "bare", "persona"].map((m) => `ask-samples.mjs samples-${m}.json --mode ${m} --server ${server} --agent ${agent}${spec}`),
      kev: `kev-probe.mjs kev.json --server ${server} --agent ${agent}${spec}`,
      // 근거 꼴을 어디서 받았나 — 규격 파일이면 그 사본이 이 폴더에 함께 있다(prompt-spec.json).
      근거꼴출처: spec ? "prompt-spec.json(이 폴더의 사본)" : "창구 GET /api/learnloop/raft/prompt",
      "왜 적나": "결과 파일만 보고 어떤 조건으로 던졌는지 가릴 수 있어야 한다(2026-09-04 수리).",
    }, null, 2));
  ' "$dir/harness-args.json" "$PORT" "$SERVER" "${AGENT:-normaltic}" "$who" "${SPEC_ARGS[1]:-}"
  ladder_log "   인자 기록 → $dir/harness-args.json"
}

# ── 베이스 대조 한 번짜리 ────────────────────────────────────────────
# 어댑터 **없이** 베이스 모델을 띄워 같은 4조건 + KEV를 돌린다. 관문 ①·⑧이 견줄 상대를 만드는 단계다.
if [ "$BASELINE_PROBE" -eq 1 ]; then
  ladder_log "베이스 대조 — 어댑터 없이 4조건 + KEV (→ $BASELINE_DIR)"
  # ★ env는 **두뇌를 띄우기 전에** 본다(2026-09-04 검토관 적발). ladder_need_env는 return이 아니라
  #   `exit 3` 으로 셸을 끝내므로, 서버를 먼저 띄우면 그 exit에서 8093에 두뇌가 그대로 남았다 —
  #   이 파일이 스스로 「8093에 두뇌를 남기지 않는다」고 적어 둔 바로 그 사고다. EXIT trap과 이중으로 막는다.
  #   ⚠ 규격 파일이 있으면 하네스가 서버에 안 붙으므로 이 env는 **필요 없다**(2026-09-04 · R3).
  #   있지도 않은 요구로 막으면, 규격을 두고도 gb10에서 못 도는 옛 상태 그대로다.
  [ -f "$PROMPT_SPEC" ] || ladder_need_env GIJO_ADMIN_USER GIJO_ADMIN_PASSWORD
  mkdir -p "$BASELINE_DIR"
  serve_start "$BASELINE_DIR/serve-base.log" "$BASE_GGUF" || exit $?
  run_probes "$BASELINE_DIR" "베이스(어댑터 없음)"
  PROBE_RC=$?
  serve_stop
  ladder_log "베이스 대조 끝(코드 $PROBE_RC) — 이 파일들을 --kev-base·--baseline-samples 로 준다"
  exit "$PROBE_RC"
fi

[ -n "$ROUND" ] || { echo "✗ --round <id> 가 필요하다. 있는 회전: $(node -e 'const j=require(process.argv[1]);console.log((j.회전||[]).map(r=>r.id).join(", "))' "$ROUNDS_FILE" 2>/dev/null)" >&2; exit 6; }
[ -s "$ROUNDS_FILE" ] || { echo "✗ 회전 설정 없음: $ROUNDS_FILE" >&2; exit 6; }

OUTDIR="$REPO/tools/team-bench/results-ladder/day2/$ROUND"
mkdir -p "$OUTDIR"
# 표본·KEV·게이트 결과가 앉을 자리. --probe-out 이 상대경로면 회전 폴더 **아래**로 읽는다.
# ⚠ easy/hard(13과제)는 여기로 안 옮긴다 — 어댑터가 같으면 그 숫자도 같다. 다시 잰 것만 옆에 둔다.
PROBE_DIR="$OUTDIR"
if [ -n "$PROBE_OUT" ]; then
  case "$PROBE_OUT" in /*) PROBE_DIR="$PROBE_OUT" ;; *) PROBE_DIR="$OUTDIR/$PROBE_OUT" ;; esac
fi
mkdir -p "$PROBE_DIR"

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
# ★ 2회전 칸(2026-09-04) — 재료 세 갈래와 학습 세 갈래. **없으면 안 넘긴다**(빈 값 = 도구 기본값 그대로).
#   왜 빈 값을 안 넘기나: r1-base를 다시 돌렸을 때 같은 명령이 나와야 「재현」이다.
PORACLE="$(read_round pOracle)"
QUOTE_RULE="$(read_round quoteRule)"
# ★ 3회전 칸(2026-09-04) — 인용 꼴·길이·비중과 베낀 비율 상한. 빈 값이면 빌더 기본값이 그대로 산다.
QUOTE_STYLE="$(read_round quoteStyle)"
MAX_QUOTE_CHARS="$(read_round maxQuoteChars)"
MAX_QUOTE_SHARE="$(read_round maxQuoteShare)"
MAX_COPY_RATIO="$(read_round maxCopyRatio)"
# ★ 거절 행의 답 꼴(2026-09-05). 빈 값이면 빌더 기본값(refuse-only = 회전 2 재현)이 그대로 산다.
REFUSAL_STYLE="$(read_round refusalStyle)"
# ★ 4회전 칸(2026-09-05) — Ⓝ 무블록 몫과 **고정 홀드아웃 파일**.
#   evalHoldoutFile 은 저장소 상대경로다. 주면 ① 빌더가 그 파일을 떨구고 데이터셋에서 빼고
#   ② 학습기가 그 파일을 평가지로 쓴다 — 회전이 바뀌어도 **같은 시험지**라 eval_loss를 견줄 수 있다.
NOBLOCK_RATIO="$(read_round noblockRatio)"
EVAL_HOLDOUT_FILE="$(read_round evalHoldoutFile)"
NOEV="$(read_round noevidenceFromUncited)"
CLOSEDBOOK="$(read_round closedbookRatio)"
LONGFORM="$(read_round longformDataset)"
SAVE_EPOCHS="$(read_round saveEpochs)"
EVAL_HOLDOUT="$(read_round evalHoldout)"
ALPHA_MULT="$(read_round loraAlphaMult)"
DISCARDED="$(read_round 폐기)"
# ★ 빌드금지 — 이 회전의 재료·시험지가 **이미 구워져 있고 다시 구우면 안 되는** 경우다(2026-09-10).
#   ① 단계의 빌더(build-raft-dataset.mjs)는 등급을 모른다. 승인 문답 전부(등급 C 포함)로 재료를 새로
#   굽고, --holdout-out 으로 **새 시험지까지 덮어쓴다**. 설정에 경고만 적어 두고 스크립트가 그것을
#   안 읽으면 그 경고는 아무 것도 막지 못한다 — 그래서 여기서 읽어 SKIP_BUILD 로 바꾼다.
BUILD_BAN="$(read_round 빌드금지)"
CWIN_ROUND="$(read_round cwinFile)"

# ★ 폐기 표시가 붙은 회전은 **돌리지 않는다**(2026-09-04). 표시만 해 두고 돌 수 있게 두면
#   표시가 장식이 되고, 밤 하나가 「안 고쳐질 것이 확실한 설정」에 쓰인다.
#   되살리려면 rounds.json에서 그 칸을 지운다 — 지우는 순간 왜 폐기했는지도 함께 사라지므로,
#   되살리는 사람이 그 문장을 읽고 결정하게 된다.
if [ -n "$DISCARDED" ]; then
  echo "✗ 회전 $ROUND 은(는) 폐기된 설정이다: $DISCARDED" >&2
  echo "  (정말 돌리려면 tools/ladder/rounds.json 에서 그 회전의 「폐기」 칸을 지워라)" >&2
  exit 6
fi

ladder_log "2일차 회전 $ROUND — 데이터셋 $DATASET · rank $RANK · lr $LR · epochs $EPOCHS · 방해 $DISTRACTORS · maxSeq $MAXSEQ"
ladder_log "  재료 옵션 — pOracle ${PORACLE:-(기본)} · quoteRule ${QUOTE_RULE:-(기본)} · 미인용거절 ${NOEV:-(기본)} · closedbook ${CLOSEDBOOK:-(기본)} · 긴형식 ${LONGFORM:-(없음)}"
ladder_log "  인용 옵션 — quoteStyle ${QUOTE_STYLE:-(기본 original)} · maxQuoteChars ${MAX_QUOTE_CHARS:-(기본)} · maxQuoteShare ${MAX_QUOTE_SHARE:-(기본)} · maxCopyRatio ${MAX_COPY_RATIO:-(기본 1=안 거름)} · refusalStyle ${REFUSAL_STYLE:-(기본 refuse-only)}"
ladder_log "  학습 옵션 — saveEpochs ${SAVE_EPOCHS:-(기본)} · evalHoldout ${EVAL_HOLDOUT:-(기본)} · evalHoldoutFile ${EVAL_HOLDOUT_FILE:-(없음)} · loraAlphaMult ${ALPHA_MULT:-(기본)} · noblockRatio ${NOBLOCK_RATIO:-(기본 0)}"

# ⚠ 시험지가 둘이면 어느 것으로 쟀는지 알 수 없다 — 학습기도 같은 이유로 막지만, 여기서 먼저 말한다
#   (밤을 굽고 나서 죽는 것보다 시작 전에 죽는 편이 싸다).
if [ -n "$EVAL_HOLDOUT_FILE" ] && [ -n "$EVAL_HOLDOUT" ]; then
  echo "✗ 회전 $ROUND 은 evalHoldoutFile 과 evalHoldout 을 함께 두고 있다 — 하나만 남겨라(시험지가 둘이 된다)" >&2
  exit 6
fi
ladder_log "  설정 사본 → $OUTDIR/round.json"

LORA_DIR="$SERVER_DIR/data/lora/$ROUND"
ADAPTER_GGUF="$OUTDIR/adapter.gguf"
TRAIN_LOG="$OUTDIR/train.log"
DONE_MARK="$LORA_DIR/adapter_model.safetensors"

# ── ① RAFT 데이터셋 만들기 ────────────────────────────────────────────
if [ -n "$BUILD_BAN" ] && [ "$SKIP_BUILD" -eq 0 ]; then
  SKIP_BUILD=1
  ladder_log "① 데이터셋 만들기 **자동 건너뜀** — 이 회전의 round.json 에 빌드금지가 있다"
  ladder_log "   $BUILD_BAN"
fi
if [ "$SKIP_BUILD" -eq 0 ]; then
  ladder_need_env GIJO_ADMIN_USER GIJO_ADMIN_PASSWORD
  if [ ! -s "$REPO/tools/build-raft-dataset.mjs" ]; then
    echo "✗ tools/build-raft-dataset.mjs 가 없다 — RAFT 빌더는 다른 갈래가 만든다. 그것이 들어온 뒤에 돌려라." >&2
    exit 7
  fi
  ladder_log "① RAFT 데이터셋 $DATASET (방해 $DISTRACTORS)"
  # ★ 재료 옵션은 **회전 설정에 있을 때만** 넘긴다 — 빈 칸이면 빌더 기본값이 그대로 산다.
  #   `--noevidence-from-uncited`는 값 없는 깃발이라 true일 때만 붙인다(문자열 "true" 비교).
  NOEV_FLAG=""
  [ "$NOEV" = "true" ] && NOEV_FLAG="--noevidence-from-uncited"
  ( cd "$REPO" && node tools/build-raft-dataset.mjs --name "$DATASET" \
      ${TOPIC:+--topic "$TOPIC"} ${AGENT:+--agent "$AGENT"} \
      --distractors "$DISTRACTORS" --server "$SERVER" \
      ${PORACLE:+--p-oracle "$PORACLE"} \
      ${CLOSEDBOOK:+--closedbook-ratio "$CLOSEDBOOK"} \
      ${QUOTE_RULE:+--quote-rule "$QUOTE_RULE"} \
      ${QUOTE_STYLE:+--quote-style "$QUOTE_STYLE"} \
      ${MAX_QUOTE_CHARS:+--max-quote-chars "$MAX_QUOTE_CHARS"} \
      ${MAX_QUOTE_SHARE:+--max-quote-share "$MAX_QUOTE_SHARE"} \
      ${MAX_COPY_RATIO:+--max-copy-ratio "$MAX_COPY_RATIO"} \
      ${REFUSAL_STYLE:+--refusal-style "$REFUSAL_STYLE"} \
      ${NOBLOCK_RATIO:+--noblock-ratio "$NOBLOCK_RATIO"} \
      ${EVAL_HOLDOUT_FILE:+--holdout-out "$REPO/$EVAL_HOLDOUT_FILE"} \
      ${LONGFORM:+--longform-dataset "$LONGFORM"} \
      $NOEV_FLAG ) \
    2>&1 | tee "$OUTDIR/build.log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 데이터셋 만들기 실패 — $OUTDIR/build.log" >&2; exit 8; }
else
  ladder_log "① 데이터셋 만들기 건너뜀"
fi

DS_FILE="$SERVER_DIR/data/datasets/$DATASET.json"

# ⚠ 빌드를 건너뛰었으면 홀드아웃 파일이 **이미 있어야** 한다 — 없으면 학습기가 그 자리에서 죽는데,
#   그때는 이미 베이스 모델을 올린 뒤라 몇 분이 사라진다. 여기서 먼저 말한다(fail-closed).
if [ -n "$EVAL_HOLDOUT_FILE" ] && [ ! -s "$REPO/$EVAL_HOLDOUT_FILE" ]; then
  echo "✗ 홀드아웃 파일이 없다: $REPO/$EVAL_HOLDOUT_FILE (빌드를 건너뛰었다면 그 파일을 먼저 받아 와라)" >&2
  exit 8
fi

# ── ② 학습(QLoRA) ────────────────────────────────────────────────────
if [ "$SKIP_TRAIN" -eq 0 ]; then
  [ -x "$VENV/bin/python" ] || { echo "✗ 학습 환경 없음: $VENV/bin/python — 이 단계는 gb10에서 돈다(LADDER_VENV로 바꿀 수 있다)." >&2; exit 7; }
  [ -s "$DS_FILE" ] || { echo "✗ 데이터셋 파일이 없다: $DS_FILE (빌더가 서버 창구로 저장한다 — 서버가 이 기계의 것인지 확인)" >&2; exit 8; }

  if [ -s "$DONE_MARK" ]; then
    # 밤/낮 전환은 **산출물 존재**로 가른다 — 이미 학습된 회전을 다시 태우지 않는다.
    ladder_log "② 학습 건너뜀 — 이미 어댑터가 있다($DONE_MARK). 다시 학습하려면 그 폴더를 치워라."
  else
    # ── ①-b 등급·인용·겹침 관문 — **먹이기 직전에 다시 잰다** ─────────────
    # ⚠ 왜 여기인가(2026-09-10 · 검토관 적발): 관문이 **빌더 안에만** 있었다. 이 스크립트는 빌더를
    #   건너뛸 수 있고(--skip-build·빌드금지), 그러면 「거기 놓여 있던 파일」을 그대로 굽는다.
    #   재료 파일은 저장소에 안 들어오므로(data/ 무시) 시험으로는 원리상 못 본다 — 재는 자리는
    #   그 파일이 실제로 있는 여기다. 어댑터가 이미 있으면 위에서 건너뛰므로, 이 관문은
    #   **정말로 먹이려는 순간에만** 돈다.
    GATE_TOOL="$REPO/tools/team-bench/gradegate.mjs"
    [ -s "$GATE_TOOL" ] || { echo "✗ 등급 관문 도구가 없다: $GATE_TOOL — **못 잰 것은 통과가 아니다**" >&2; exit 7; }
    # 창 집합(등급 C 본문 창) — 회전 설정의 cwinFile · 없으면 LADDER_CWIN. 둘 다 없으면 **반쪽 관문**이다.
    CWIN_FILE="${CWIN_ROUND:-}"
    #   길 꼴 셋을 받는다 — 「~/…」(학습 기계의 홈) · 「/…」(절대) · 그 밖(저장소 기준).
    if [ -n "$CWIN_FILE" ]; then
      case "$CWIN_FILE" in
        "~/"*) CWIN_FILE="$HOME/${CWIN_FILE#~/}" ;;
        /*) : ;;
        *) CWIN_FILE="$REPO/$CWIN_FILE" ;;
      esac
    fi
    [ -n "$CWIN_FILE" ] || CWIN_FILE="${LADDER_CWIN:-}"
    if [ -n "$CWIN_FILE" ] && [ ! -s "$CWIN_FILE" ]; then
      echo "✗ 창 집합 파일이 없다: $CWIN_FILE (round.json cwinFile · LADDER_CWIN) — 못 잰 것은 통과가 아니다" >&2; exit 8
    fi
    [ -n "$CWIN_FILE" ] || ladder_log "   ⚠ 창 집합이 없다(cwinFile·LADDER_CWIN 둘 다 비었다) — **반쪽 관문**이다: 칸만 보고 「글에 실린 C 본문」은 원리상 못 본다"
    SAMPLES_FILE="$REPO/tools/team-bench/samples-questions.json"
    gate_one() {
      # gate_one <재료파일> <이름> [추가 깃발...]
      # ⚠ **변수명은 영문만** — bash는 한글 변수명을 못 읽는다(이 저장소가 이미 밟은 자리다).
      local f="$1" name="$2"; shift 2
      [ -s "$f" ] || { echo "✗ $name 파일이 없다: $f" >&2; exit 8; }
      ladder_log "①-b 관문 — $name"
      node "$GATE_TOOL" --in "$f" ${CWIN_FILE:+--cwin "$CWIN_FILE"} "$@" 2>&1 | tee -a "$OUTDIR/gate.log"
      [ "${PIPESTATUS[0]}" -eq 0 ] || {
        echo "✗ 관문 빨강 — 이 재료로는 **굽지 않는다**($name). 자세한 사유는 $OUTDIR/gate.log" >&2
        exit 8
      }
    }
    gate_one "$DS_FILE" "학습 재료 $DATASET" \
      ${EVAL_HOLDOUT_FILE:+--holdout "$REPO/$EVAL_HOLDOUT_FILE"} \
      ${SAMPLES_FILE:+--samples "$SAMPLES_FILE"}
    # 긴 형식도 **가중치로 들어간다** — 재료와 같은 잣대로 잰다.
    [ -z "$LONGFORM" ] || gate_one "$REPO/$LONGFORM" "긴 형식 $LONGFORM" \
      ${EVAL_HOLDOUT_FILE:+--holdout "$REPO/$EVAL_HOLDOUT_FILE"}

    mkdir -p "$LORA_DIR"
    ladder_log "② 학습 시작(떼어 놓고 돈다) — 로그 $TRAIN_LOG"
    # ⚠ setsid nohup: ssh가 끊겨도 안 죽는다. 진행은 로그로만 본다.
    # ★ 학습 옵션도 회전 설정에 있을 때만 넘긴다(위 재료 옵션과 같은 규칙).
    #   --save-epochs 가 붙으면 어댑터 폴더에 checkpoint-* 가 쌓이고, 아래 「판 목록」이
    #   그것을 **에폭마다 한 판**으로 잰다 — 「몇 에폭이 제일 나았나」를 다시 굽지 않고 묻는 길이다.
    SAVE_EPOCHS_FLAG=""
    [ "$SAVE_EPOCHS" = "true" ] && SAVE_EPOCHS_FLAG="--save-epochs"
    ( cd "$SERVER_DIR" && setsid nohup "$VENV/bin/python" scripts/finetune_qlora14b.py \
        --dataset "$DATASET" --output "data/lora/$ROUND" \
        --base-model "$BASE_MODEL_ID" --rank "$RANK" --lr "$LR" --epochs "$EPOCHS" --max-seq "$MAXSEQ" \
        $SAVE_EPOCHS_FLAG ${EVAL_HOLDOUT:+--eval-holdout "$EVAL_HOLDOUT"} ${ALPHA_MULT:+--lora-alpha-mult "$ALPHA_MULT"} \
        ${EVAL_HOLDOUT_FILE:+--eval-file "$REPO/$EVAL_HOLDOUT_FILE"} \
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
# convert_adapter <어댑터 폴더> <출력 gguf> <로그 파일>
# ⚠ 함수로 뺀 이유(2026-09-04): 체크포인트 회전은 이 일을 **에폭 수만큼** 한다. 손으로 세 벌 적으면
#   폐쇄망 갈래(LADDER_HF_BASE_DIR)를 한 곳에서만 고치고 나머지가 조용히 허브를 부르게 된다.
convert_adapter() {
  local src="$1" out="$2" log="$3"
  if [ -s "$out" ]; then ladder_log "③ 변환 건너뜀 — 이미 있다($out)"; return 0; fi
  [ -s "$CONVERT" ] || { echo "✗ 변환 스크립트 없음: $CONVERT" >&2; return 7; }
  [ -d "$src" ] || { echo "✗ 어댑터 폴더 없음: $src" >&2; return 8; }
  ladder_log "③ GGUF 변환 $src → $out"
  if [ -n "$HF_BASE_DIR" ]; then
    # 로컬 스냅샷이 있으면 그것을 쓴다 — 폐쇄망에서 허브를 부르면 그 자리에서 죽는다.
    "$VENV/bin/python" "$CONVERT" --base "$HF_BASE_DIR" --outfile "$out" "$src" 2>&1 | tee "$log"
  else
    "$VENV/bin/python" "$CONVERT" --base-model-id "$BASE_MODEL_ID" --outfile "$out" "$src" 2>&1 | tee "$log"
  fi
  [ -s "$out" ] || { echo "✗ 변환 실패 — $log (폐쇄망이면 LADDER_HF_BASE_DIR로 로컬 config를 줘라)" >&2; return 8; }
  return 0
}

# ── ④ A/B 하네스 사본 ────────────────────────────────────────────────
# ⚠ 공유 ~/bench/models.json 을 안 고친다. run.mjs 는 **자기 옆의** models.json을 읽으므로,
#   회전 폴더에 사본을 만들어 거기서 돌린다(다른 갈래가 같은 파일을 쓰고 있을 수 있다).
RUNDIR="$OUTDIR/harness"
mkdir -p "$RUNDIR"
for f in run.mjs run-r2.mjs tasks.mjs tasks-r2.mjs; do
  [ -s "$BENCH_SRC/$f" ] || { echo "✗ 하네스 파일 없음: $BENCH_SRC/$f" >&2; exit 7; }
  cp "$BENCH_SRC/$f" "$RUNDIR/$f"
done

MODEL_ID="qwen3-14b+$ROUND"
# ★ 이름표에 어느 자리에서 잰 표본인지 적는다 — probe-v2의 표와 옛 표가 파일로 섞이면 못 가린다.
GATE_LABEL="$ROUND"
[ "$PROBE_DIR" != "$OUTDIR" ] && GATE_LABEL="$ROUND($PROBE_OUT)"

# ── 판 하나를 재는 한 벌 — ④ 13과제 A/B · ④-2 표본·KEV · ⑤ 게이트 ────
# run_variant <어댑터gguf> <모델id> <결과폴더> <표본·판정폴더> <이름표>
# ⚠ 판이 여럿이어도 **직렬**이다 — 8093(두뇌)·GPU가 직렬 자원이라 겹치면 서로를 깨뜨린다.
run_variant() {
  local lora="$1" model_id="$2" outdir="$3" probedir="$4" label="$5"
  mkdir -p "$outdir" "$probedir"

  # models.json은 **판마다** 다시 쓴다(어댑터 경로가 판의 정체다). 판은 직렬이라 한 파일을 돌려 쓴다.
  node -e '
    const fs = require("node:fs");
    const [out, id, gguf, base] = process.argv.slice(1);
    // ⚠ ctx는 회차별 하네스가 인자로 준다(run.mjs 32768 · run-r2.mjs 65536). 여기 박아 두면 두 회차가 어긋난다.
    // ★ 베이스 경로는 셸의 $BASE_GGUF 하나에서 온다 — ④(A/B)와 ④-2(표본)가 **같은 베이스**를 써야
    //   두 숫자를 견줄 수 있다(따로 적어 두면 LADDER_BASE_GGUF를 바꿨을 때 조용히 갈린다).
    fs.writeFileSync(out, JSON.stringify([{
      id, path: base,
      license: "Apache-2.0", thinking: true,
      note: "증류 사다리 회전 — 베이스 qwen3-14b + 이 회전의 어댑터",
      extra: ["--lora", gguf],
    }], null, 2));
  ' "$RUNDIR/models.json" "$model_id" "$lora" "$BASE_GGUF"

  # ── ④ A/B — 8093에 어댑터를 얹어 13과제를 돌린다 ───────────────────
  if [ "$ONLY_GATE" -eq 0 ] && [ "$ONLY_PROBE" -eq 0 ]; then
    local EASY_JSON="$outdir/easy/$model_id.json"
    local HARD_JSON="$outdir/hard/$model_id.json"
    if ladder_have "$EASY_JSON"; then
      ladder_log "④ [$label] 1회차 건너뜀 — 이미 있다($EASY_JSON)"
    else
      ladder_log "④ [$label] 1회차 7과제 — 포트 $PORT"
      node "$RUNDIR/run.mjs" --only "$model_id" --port "$PORT" --ctx 32768 --out "$outdir/easy" 2>&1 | tee "$outdir/easy.log"
      [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 1회차 실패 — $outdir/easy.log" >&2; return 8; }
    fi
    if ladder_have "$HARD_JSON"; then
      ladder_log "④ [$label] 2회차 건너뜀 — 이미 있다($HARD_JSON)"
    else
      # ⚠ --ctx 65536을 줘도 qwen3-14b는 n_ctx_train 40960에서 잘린다 — needle_64k는 원리상 0이다
      #   (results-ladder/baseline/README.md). 게이트가 기본으로 평균에서 빼는 이유가 그것이다.
      ladder_log "④ [$label] 2회차 6과제 — 포트 $PORT"
      node "$RUNDIR/run-r2.mjs" --only "$model_id" --port "$PORT" --ctx 65536 --out "$outdir/hard" 2>&1 | tee "$outdir/hard.log"
      [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "✗ 2회차 실패 — $outdir/hard.log" >&2; return 8; }
    fi
  fi

  # ── ④-2 표본 4조건 + KEV — **사슬이 직접 만든다** ──────────────────
  # ⚠ 2026-09-04 수리: 예전에는 「$OUTDIR/samples.json 이 있으면 게이트에 넘긴다」였다. 즉 남이 손으로
  #   만들어 둔 파일이 있을 때만 관문 ①(KEV)이 살아 있었고, 없으면 조용히 빠졌다. 관문이 「있을 때만」
  #   도는 것은 관문이 아니다 — 만드는 것까지 사슬 안으로 들여온다.
  if [ "$ONLY_GATE" -eq 0 ]; then
    ladder_log "④-2 [$label] 표본 4조건 + KEV → $probedir"
    # ★ ④의 run.mjs·run-r2.mjs는 **자기가 띄운 서버를 회차 끝에 죽인다**(run.mjs:106 finally).
    #   그래서 여기서 같은 어댑터를 얹어 **다시 띄운다** — 안 띄우면 하네스가 ECONNREFUSED로 죽고
    #   (exit 8), 관문 ⑧·⑩은 회전 갈래에서 영영 미측정이 된다(2026-09-04 검토관 적발).
    #   ④와 포트를 나눠 쓸 수는 없다: run.mjs:47이 「포트 이미 사용 중」이면 아예 거부한다(배타적이다).
    #   ⚠ 규격 파일이 있으면 하네스가 서버에 안 붙으니 이 env는 필요 없다(2026-09-04 · R3) —
    #     베이스 대조 갈래와 **같은 규칙**이라야 둘이 같은 조건으로 잰다.
    [ -f "$PROMPT_SPEC" ] || ladder_need_env GIJO_ADMIN_USER GIJO_ADMIN_PASSWORD
    serve_start "$probedir/serve-probe.log" "$BASE_GGUF" --lora "$lora" || return $?
    run_probes "$probedir" "$label"
    local PROBE_RC=$?
    serve_stop
    [ "$PROBE_RC" -eq 0 ] || return "$PROBE_RC"
  elif ! ladder_have "$probedir/samples-grounded.json"; then
    ladder_log "⚠ --only-gate인데 표본이 없다 — 관문 ⑧⑨⑩⑫가 미측정으로 막힌다. 표본까지 만들려면 --only-gate 없이 돌려라."
  fi

  # ── ⑤ 게이트 ───────────────────────────────────────────────────────
  ladder_log "⑤ [$label] 게이트"
  local GATE_ARGS=(--easy "$outdir/easy/$model_id.json" --hard "$outdir/hard/$model_id.json" --out "$probedir" --label "$label")
  local mode
  for mode in grounded distractor-only bare persona; do
    [ -s "$probedir/samples-$mode.json" ] && GATE_ARGS+=("--samples-$mode" "$probedir/samples-$mode.json")
  done
  # 옛 회전이 남긴 samples.json(맨 질문 한 벌)이 있으면 참고 표본으로 함께 넘긴다.
  # ⚠ 다시 재는 자리(--probe-out)에서는 **안 섞는다** — 옛 잣대의 파일이 새 표에 참고로 끼면
  #   「이 표가 어느 잣대의 것인가」가 흐려진다.
  [ "$probedir" = "$OUTDIR" ] && [ -s "$OUTDIR/samples.json" ] && GATE_ARGS+=(--samples "$OUTDIR/samples.json")
  [ -s "$probedir/kev.json" ] && GATE_ARGS+=(--kev "$probedir/kev.json")
  # 베이스 대조 — 없으면 관문 ①⑤⑧이 「미측정=불합격」이 된다(그게 맞다: 무엇과 견줄지 모르는 채로 통과시키지 않는다).
  # ★ 표본 셋을 **다 넘긴다**(2026-09-04): 관문 ⑤가 잘림을 **자리별로** 견주므로, 베이스에 없는
  #   자리가 있으면 그 관문은 미측정이다. grounded 하나만 넘기던 옛 호출은 ⑤를 통째로 막았다.
  [ -s "$BASELINE_DIR/kev.json" ] && GATE_ARGS+=(--kev-base "$BASELINE_DIR/kev.json")
  [ -s "$BASELINE_DIR/samples-grounded.json" ] && GATE_ARGS+=(--baseline-samples "$BASELINE_DIR/samples-grounded.json")
  [ -s "$BASELINE_DIR/samples-distractor-only.json" ] && GATE_ARGS+=(--baseline-samples-distractor-only "$BASELINE_DIR/samples-distractor-only.json")
  [ -s "$BASELINE_DIR/samples-bare.json" ] && GATE_ARGS+=(--baseline-samples-bare "$BASELINE_DIR/samples-bare.json")
  # ★ persona의 베이스는 관문이 **안 쓴다**(⑨는 절대 0건 기준이라 견줄 상대가 필요 없다).
  #   그래도 넘기는 이유: 표의 참고 줄에 「베이스도 같은 조건으로 쟀다」가 남아야 사람이 두 숫자를 나란히 읽는다.
  [ -s "$BASELINE_DIR/samples-persona.json" ] && GATE_ARGS+=(--baseline-samples-persona "$BASELINE_DIR/samples-persona.json")
  if [ ! -s "$BASELINE_DIR/kev.json" ] || [ ! -s "$BASELINE_DIR/samples-grounded.json" ]; then
    ladder_log "⚠ 베이스 대조 파일이 없다 — 먼저 bash tools/ladder/day2-train.sh --baseline-probe 를 한 번 돌려라(관문 ①⑤⑧이 미측정으로 막힌다)"
  fi
  node "$REPO/tools/team-bench/gates.mjs" "${GATE_ARGS[@]}"
  local RC=$?
  ladder_log "[$label] 판정 $probedir/gate.md (코드 $RC)"
  return "$RC"
}

# ── 판 목록 — 체크포인트가 있으면 **에폭마다** 한 판 ──────────────────
# ★ 왜(2026-09-04): 1회전은 3에폭을 통째로 굽고 마지막 것만 남겨서, 「3에폭이 과했나」를
#   **다시 굽지 않고는** 물을 수 없었다(5시간 20분). --save-epochs 로 남은 checkpoint-* 를
#   각각 재면 그 질문이 한 회전 안에서 닫힌다. 체크포인트가 없으면 종전과 **같은 자리**다.
VAR_SRC=(); VAR_GGUF=(); VAR_ID=(); VAR_OUT=(); VAR_PROBE=(); VAR_LABEL=(); VAR_CLOG=()
add_variant() { VAR_SRC+=("$1"); VAR_GGUF+=("$2"); VAR_ID+=("$3"); VAR_OUT+=("$4"); VAR_PROBE+=("$5"); VAR_LABEL+=("$6"); VAR_CLOG+=("$7"); }

CKPTS=()
if [ -d "$LORA_DIR" ]; then
  # 스텝 번호로 오름차순 — 폴더 이름은 checkpoint-<총스텝>이라 **에폭 번호가 아니다**(HF 규칙).
  # 정렬한 자리 번호가 곧 에폭 번호다(save_strategy=epoch이라 에폭마다 하나씩 쌓인다).
  while IFS= read -r step; do [ -n "$step" ] && CKPTS+=("$step"); done < <(ls -1d "$LORA_DIR"/checkpoint-* 2>/dev/null | sed 's#.*/checkpoint-##' | sort -n)
fi

if [ "${#CKPTS[@]}" -gt 0 ]; then
  case "$PROBE_OUT" in
    /*) echo "✗ 체크포인트 회전에서는 --probe-out 에 절대경로를 못 쓴다 — 판 여럿이 한 폴더에서 서로를 덮는다(상대경로를 줘라)" >&2; exit 6 ;;
  esac
  ladder_log "판 ${#CKPTS[@]}개 — 에폭마다 잰다(체크포인트: $(printf '%s ' "${CKPTS[@]}"))"
  EPN=0
  for step in "${CKPTS[@]}"; do
    EPN=$((EPN + 1))
    EPDIR="$OUTDIR/ep$EPN"
    add_variant "$LORA_DIR/checkpoint-$step" "$OUTDIR/adapter-ep$EPN.gguf" "$MODEL_ID-ep$EPN" \
      "$EPDIR" "$EPDIR${PROBE_OUT:+/$PROBE_OUT}" "$ROUND-ep$EPN${PROBE_OUT:+($PROBE_OUT)}" "$OUTDIR/convert-ep$EPN.log"
  done
else
  # 체크포인트가 없는 회전(r1-base 재현)은 **파일 이름까지 종전 그대로**다 — convert.log 포함.
  add_variant "$LORA_DIR" "$ADAPTER_GGUF" "$MODEL_ID" "$OUTDIR" "$PROBE_DIR" "$GATE_LABEL" "$OUTDIR/convert.log"
fi

# ── 판마다 ③④④-2⑤ ─────────────────────────────────────────────────
WORST_RC=0
IDX=0
while [ "$IDX" -lt "${#VAR_ID[@]}" ]; do
  if [ "$ONLY_GATE" -eq 0 ]; then
    convert_adapter "${VAR_SRC[$IDX]}" "${VAR_GGUF[$IDX]}" "${VAR_CLOG[$IDX]}" || exit $?
  fi
  run_variant "${VAR_GGUF[$IDX]}" "${VAR_ID[$IDX]}" "${VAR_OUT[$IDX]}" "${VAR_PROBE[$IDX]}" "${VAR_LABEL[$IDX]}"
  RC=$?
  # 게이트 불합격(1)은 다음 판을 계속 재고, 단계 실패(8 등)는 거기서 멈춘다 —
  # 「못 넘었다」와 「못 쟀다」는 다르고, 못 쟀으면 다음 판도 같은 이유로 못 잰다.
  if [ "$RC" -ne 0 ] && [ "$RC" -ne 1 ]; then
    ladder_log "✗ [${VAR_LABEL[$IDX]}] 단계 실패(코드 $RC) — 남은 판은 돌리지 않는다"
    exit "$RC"
  fi
  [ "$RC" -gt "$WORST_RC" ] && WORST_RC="$RC"
  IDX=$((IDX + 1))
done

ladder_log "회전 $ROUND 끝 — 판 ${#VAR_ID[@]}개 (코드 $WORST_RC)"
if [ "$WORST_RC" -ne 0 ]; then
  ladder_log "⚠ 게이트를 못 넘은 판이 있다 — **채택하지 않는다.** 어댑터는 남겨 두고(다음 회전의 비교 대상) 설정을 바꿔 새 id로 돌려라."
fi
exit "$WORST_RC"
