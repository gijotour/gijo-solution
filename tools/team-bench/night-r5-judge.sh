#!/bin/bash
# tools/team-bench/night-r5-judge.sh — 회전 5 r5a **아침 판정**(gb10 전용, 다음 밤 03:25 KST 예약).
#
# ■ 왜 다음 밤인가(계획서 §13 2026-09-11 11:05 갈림길 ④)
#   오늘 밤(2026-09-12 03:25)은 night-r5-bake.sh가 r5a를 **굽는다.** 굽기가 끝나야(체크포인트 2개)
#   재볼 것이 생긴다 — 그래서 판정은 그 다음 밤에 별도로 건다. 이 스크립트는 **굽지 않는다.**
#
# ■ 이 스크립트가 **절대 안 하는 것**
#   · 8080(교사)·8081(임베딩)을 내리거나 다시 묶지 않는다. 그 둘의 PID는 건드리지 않는다.
#   · --host 를 주지 않는다(루프백을 빼앗는다 — 감시가 되돌린다).
#   · **재학습하지 않는다** — day2-train.sh를 --skip-train 으로 부르고, 그 전에 어댑터가
#     실제로 있는지 먼저 본다(fail-closed). 어댑터 없이 --round r5a를 부르면 day2-train.sh의
#     `if [ -s "$DONE_MARK" ]` 검사가 거짓이 되어 4bit 기본값으로 **밤을 통째로 다시 굽는다**
#     (finetune_qlora14b.py 를 부르는 줄에 --precision 이 없다) — 판정하러 왔다가 딴 어댑터를
#     만드는 사고다. ⚠ 줄 번호로 가리키지 않는다: 그 파일은 자주 늘어나 번호가 밀린다
#     (2026-09-11 실측 — 이 주석이 가리키던 :372·:427은 하루 만에 :386·:441로 밀려 있었다).
#   · 운영 데이터를 쓰지 않는다.
#
# ■ 차례
#   ① 시작 상태(교사 health · 메모리 · 8093이 비었나 · 어젯밤 굽기 로그가 있었나)
#   ② 전제 fail-closed — 어댑터(adapter_model.safetensors)와 **체크포인트 개수**(에폭 수 이상)를
#      본다. 없으면 「굽기가 없었다/반쯤 구워졌다」로 적고 **여기서 끝낸다.**
#      ⚠ 체크포인트 **번호를 손으로 박지 않는다**(2026-09-11 검토관 적발) — 번호는 살아남은 행 수가
#        정하는 값이라, 길이 초과로 12행만 빠져도 26/52가 25/50이 되어 「반쯤 구워졌다」는
#        **사실이 아닌 진단**이 남는다(굽기는 완주했는데 판정 밤만 통째로 잃는다).
#   ③ 가용 메모리 하한(판정의 수로 새로 잰다 — 굽기의 32G와 다르다. 아래 JUDGE_MIN_AVAIL 참고)
#   ④ 교사 감시견 + 08:30 데드라인 감시견 — **day2-train.sh의 PID에 TERM을 예약하고, 그 셸이
#      지금 붙들고 있는 직계 자식에도 TERM**을 보낸다(stop_child). 셸에만 쏘면 bash가 전경 명령이
#      끝난 뒤에야 trap을 돌아 8093이 수 분~수십 분 더 산다 — 감시견이 막으려던 그 상황이 연장된다.
#      이름(프로세스명)으로 llama-server를 죽이는 방식(`pkill -f llama-server`)은 교사(8080)·
#      임베딩(8081)까지 함께 죽이므로 쓰지 않는다.
#   ⑤ 갈래 1 — 베이스 40문항(results-ladder/baseline-q40/, 옛 12문항 베이스는 덮지 않는다)
#      + 그 폴더에 README.md 한 장(문항 파일 sha256·문항 수·잰 때·옛 12문항 판과 비교 불가 사유)
#   ⑥ 갈래 2 — r5a(체크포인트 개수만큼 → ep1·ep2 … 를 day2-train.sh가 스스로 돈다).
#      ⚠ 데드라인이 이미 지났으면 **시작하지 않는다** — 낮에 모델을 한 번 더 올렸다 죽이는 짓이다.
#   ⑦ 끝 상태 + 요약 한 줄
#   ⑧ 어댑터 gguf를 커밋 대상 폴더 밖으로 치운다(results-ladder는 .gitignore:26이 커밋 대상이라
#      못박아 둔 자리이고, gguf 무시 규칙이 없다 — r4-v4 때는 사람이 손으로 치웠고 코드엔 안 남았다)
#
# ■ 왜 여기서 잣대를 새로 안 적나
#   표본 순서·harness-args·serve 조건·게이트 인자는 전부 day2-train.sh **하나**에서 온다.
#   굽기가 day2-train.sh를 안 쓴 이유(학습기 깃발 넷 — night-r5-bake.sh 머리주석)는 판정에는 없다.
#   그래서 이 스크립트는 안전장치 껍데기이고, 실제 재는 일은 day2-train.sh에 두 번(--baseline-probe ·
#   --round r5a) 맡긴다.
#
# ■ 되돌리기 — 순서가 중요하다
#   1) night-r5-judge.sh PID에 TERM → 아래 judge_abort trap이 day2-train.sh와 그 직계 자식까지
#      함께 내린다(8093 정리). ⚠ trap이 없던 판에서는 judge만 죽고 자식과 8093이 그대로 살아
#      **데드라인 보호까지 사라졌다**(2026-09-11 검토관 적발 — bake 머리글이 이미 값을 치른 함정).
#   2) systemctl --user stop gijo-r5-judge.timer gijo-r5-judge.service
#   3) 결과를 버리려면 results-ladder/baseline-q40/ 와
#      results-ladder/day2/r5a/{ep1,ep2,adapter-ep*.gguf,convert-ep*.log,harness/} 를 지운다.
#      ⚠ server/data/lora/r5a 는 **지우지 않는다**(다시 구울 수 없는 것이다).
#   교사(8080)·임베딩(8081)은 어느 단계에서도 건드리지 않는다.
#
# 나가는 코드: 0=판정 완주(베이스·r5a **둘 다** 0) · 2=전제 없음(굽기가 없었다/반쯤 구워졌다/
#   가용메모리 부족/데드라인 초과 — 판정을 안 했다) · 그 외=day2-train.sh가 낸 코드
#   ⚠ r5a가 0이어도 **베이스가 실패했으면 0이 아니다** — 베이스가 없으면 ①⑤⑬⑭이 견줄 상대를 잃는다.
#
# 쓰는 법(gb10):  bash ~/gijo-as/tools/team-bench/night-r5-judge.sh
set -u
# ⚠ 비대화형 셸은 .bashrc를 안 읽는다 — node·PATH가 여기서 온다(gb10 규약).
[ -f "$HOME/gijo-env.sh" ] && . "$HOME/gijo-env.sh"
# ⚠ **변수명은 영문만.** bash는 한글 변수명을 못 읽는다(2026-08-10에 밟았고 또 밟을 뻔했다).
R5=${R5:-$HOME/bench/ladder/r5}
LOG=${LOG:-$R5/night3.log}
REPO=${REPO:-$HOME/gijo-as}
SERVER=$REPO/server
PORT=${PORT:-8093}
ROUND=${ROUND:-r5a}
LORA_DIR=$SERVER/data/lora/$ROUND
BASEQ40=${BASEQ40:-$REPO/tools/team-bench/results-ladder/baseline-q40}
R5A_OUT=$REPO/tools/team-bench/results-ladder/day2/$ROUND
DAY2=$REPO/tools/ladder/day2-train.sh
# 판정의 가용 메모리 하한 — **굽기(32G)와 다른 수다**(2026-09-11 회전5 r5a 판정 배선 설계).
#   왜: 굽기는 bf16 가중치 28G를 통째로 얹지만, 판정은 서빙(Q4_K_M 9.0GB) + ctx 32768 KV라
#   요구량이 다르다. 같은 32G를 베끼면 판정 자리에 안 맞는 잣대를 그대로 붙이는 것이다.
JUDGE_MIN_AVAIL=${JUDGE_MIN_AVAIL:-16}
# 08:30 데드라인 — 낮에 gb10은 원격 팀원 셋의 두뇌다. 예상 종료는 05:30경(추정 — 재 보기 전까지는
# 추정이다, 40문항 실측 근거: r4-v4 12문항 8분22초~9분16초를 40문항으로 늘려 잡음)이라 여유 3시간.
DEADLINE=${DEADLINE:-08:30}

mkdir -p "$R5"
say() { echo "[$(date '+%F %T %Z')] $*" | tee -a "$LOG"; }
# [2026-09-14 검토관 적발·하] bake.sh의 mem()은 LC_ALL=C로 고쳤는데(2026-09-14 실측:
#   gb10의 free는 한국어 로케일이라 행 이름이 "메모리:"·"스  왑:"로 나와 옛 awk 패턴이 안 걸렸다)
#   같은 파일·같은 부류인 이 호출은 로케일 의존인 채 남아 있었다. 통일한다.
mem() { LC_ALL=C free -g | awk '/^Mem:/ {print "총 "$2"G 사용 "$3"G 가용 "$7"G"}'; }
teacher() { curl -s -m 5 http://127.0.0.1:8080/health || echo "(응답 없음)"; }

say "════ 회전 5 $ROUND 아침 판정 시작 ════"

# ── ① 시작 상태 ────────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  메모리: $(mem)"
# ★ 잰 값을 판단에 쓴다 — 재 놓고 안 쓰면 「적어 두고 안 보는 값」이다(2026-09-11 검토관 적발).
#   교사가 이미 무응답이면 교사 감시견을 끈다: 이 갈래는 교사를 **쓰지 않는다**(근거 꼴은 저장소
#   규격 파일에서 오고, 답은 8093에 우리가 띄운 14B가 낸다). 안 끄면 03:25에 교사가 내려가 있다는
#   이유만으로 15초 만에 판정이 죽어 어제 구운 어댑터를 못 재고 또 하루가 간다.
TEACHER_WATCH=1
if curl -s -o /dev/null -m 5 http://127.0.0.1:8080/health 2>/dev/null; then
  say "교사 감시견 켬 — 교사가 연속 3회(45초) 무응답이면 판정을 내린다"
else
  TEACHER_WATCH=0
  say "⚠ 교사(8080)가 시작부터 무응답이다 — 교사 감시견을 **끄고** 판정은 진행한다(이 갈래는 교사를 안 쓴다). 데드라인 감시견은 그대로 돈다"
fi
say "임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"
if curl -s -o /dev/null -m 3 "http://127.0.0.1:$PORT/health" 2>/dev/null; then
  say "⚠ 포트 $PORT 가 이미 쓰이고 있다 — day2-train.sh의 serve_start가 이 자리에서 거부할 것이다(남의 모델을 재는 사고를 막는 그 관문이다)"
else
  say "포트 $PORT 비어 있음 — 준비됨"
fi
if [ -s "$R5/night2.log" ]; then
  say "어젯밤 굽기 로그 있음 — $(tail -1 "$R5/night2.log")"
else
  # ⚠ night-r5-bake.sh 타이머는 transient(Persistent=no)다 — gb10이 재부팅되면 예약이 소리 없이
  #   사라진다. 로그가 없으면 결과가 나쁜 게 아니라 **아예 안 구워진 것**이다.
  say "⚠ 어젯밤 굽기 로그가 없다($R5/night2.log) — 타이머가 안 살아 있었을 수 있다"
fi

# ── ② 전제 fail-closed — 어댑터가 실제로 있어야 판정을 시작한다 ────────────
# ⚠ 이 검사가 없으면 day2-train.sh의 `-s $DONE_MARK`가 거짓이 되어 ⑥단계가 **4bit 기본값으로
#   다시 굽는다**(학습 호출에 --precision이 없다) — 밤을 통째로 잃고 어댑터까지 딴것이 된다.
DONE_MARK="$LORA_DIR/adapter_model.safetensors"
if [ ! -s "$DONE_MARK" ]; then
  say "✗ 어댑터가 없다 — 굽기가 없었다: $DONE_MARK"
  say "요약 — 전제=굽기없음 · 판정 안 함"
  say "════ 회전 5 $ROUND 아침 판정 끝(코드 2) ════"
  exit 2
fi
# ★ 체크포인트는 **번호가 아니라 개수**로 본다(2026-09-11 검토관 적발).
#   왜: checkpoint-<N>의 N은 총 스텝이고, 총 스텝 = ceil(**살아남은** 행 수 / 누적 16) × 에폭이다
#   (server/scripts/finetune_qlora14b.py — max_seq를 넘는 행은 **조용히** 빠지고, 10% 미만이면
#   경고 한 줄도 안 난다). 412행이면 26/52지만 12행(2.9%)만 빠져도 25/50이 되어 두 폴더가 다 없다.
#   그때 굽기는 완주했는데 이 자리가 exit 2로 끊고 「반쯤 구워졌다」는 **틀린 원인**을 로그에 남긴다
#   (사람이 어댑터를 지우고 다시 굽는 데까지 갈 수 있다). 사슬 본체(day2-train.sh)도 번호를 안 쓰고
#   `ls -1d "$LORA_DIR"/checkpoint-* | sort -n` 의 **자리**로 에폭을 세므로, 여기도 같은 자로 본다.
# ★ 에폭 수는 **회전 설정 하나**에서 읽는다 — 여기 숫자를 또 적으면 rounds.json과 어긋난다
#   (이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」). 못 읽으면 2로 떨어진다.
ROUNDS_FILE=${ROUNDS_FILE:-$REPO/tools/ladder/rounds.json}
EPOCHS_EXPECTED=${EPOCHS_EXPECTED:-$(node -e 'const j=require(process.argv[1]);const r=(j.회전??[]).find((x)=>x.id===process.argv[2]);console.log(Number(r&&r.epochs)||2);' "$ROUNDS_FILE" "$ROUND" 2>/dev/null || echo 2)}
[ -n "$EPOCHS_EXPECTED" ] || EPOCHS_EXPECTED=2
CKPT_NAMES=$(ls -1d "$LORA_DIR"/checkpoint-* 2>/dev/null | sed 's#.*/##' | sort -t- -k2 -n | tr '\n' ' ')
CKPT_FOUND=$(ls -1d "$LORA_DIR"/checkpoint-* 2>/dev/null | wc -l)
if [ "$CKPT_FOUND" -lt "$EPOCHS_EXPECTED" ]; then
  # ⚠ 없는 번호를 지어내지 않는다 — **실제로 찾은 폴더 이름**을 그대로 적는다.
  say "✗ 반쯤 구워졌다 — 체크포인트 ${CKPT_FOUND}개(에폭 ${EPOCHS_EXPECTED}개 필요) · 찾은 것: ${CKPT_NAMES:-없음} ($LORA_DIR)"
  say "요약 — 전제=반쯤구워짐(체크포인트 ${CKPT_FOUND}/${EPOCHS_EXPECTED}) · 판정 안 함"
  say "════ 회전 5 $ROUND 아침 판정 끝(코드 2) ════"
  exit 2
fi
say "전제 통과 — 어댑터 있음($DONE_MARK) · 체크포인트 ${CKPT_FOUND}개(에폭 ${EPOCHS_EXPECTED}개 필요): $CKPT_NAMES"

# ── ③ 가용 메모리 하한 ──────────────────────────────────────────────────────
# [2026-09-14 검토관 적발·하] 같은 부류(로케일 의존) — 통일한다.
AVAIL=$(LC_ALL=C free -g | awk '/^Mem:/ {print $7}')
if [ "${AVAIL:-0}" -lt "$JUDGE_MIN_AVAIL" ]; then
  say "✗ 가용 메모리 ${AVAIL}G < ${JUDGE_MIN_AVAIL}G — 교사를 밀 위험이 있어 **판정을 건너뛴다**"
  say "요약 — 전제=가용메모리부족(${AVAIL}G) · 판정 안 함"
  say "════ 회전 5 $ROUND 아침 판정 끝(코드 2) ════"
  exit 2
fi
say "가용 메모리 ${AVAIL}G ≥ ${JUDGE_MIN_AVAIL}G — 진행"

# 40문항 베이스를 **새 폴더에** 재는 이유(옛 12문항 베이스를 안 덮는 이유) — day2-train.sh의
# LADDER_BASELINE_DIR로 넘긴다(ⓐ 배선, 2026-09-11).
export LADDER_BASELINE_DIR="$BASEQ40"

# ── ④ 감시견 — 교사가 죽거나 데드라인이 되면 day2-train.sh를 내린다 ─────────
# ⚠ 이름(프로세스명)으로 llama-server를 죽이면 교사(8080)·임베딩(8081)까지 함께 죽는다.
#   day2-train.sh의 EXIT/INT/TERM trap(`trap 'serve_stop' EXIT` 세 줄)이 자기 SERVE_PID(8093)만
#   정리하므로, **그 스크립트 자신의 PID**에 신호를 보내 이 trap을 통해서만 8093을 정리한다.
#
# ★ 그런데 셸에만 쏘면 **즉시 듣지 않는다**(2026-09-11 검토관 적발). bash는 전경 자식을 기다리는
#   동안 받은 신호의 trap을 **그 명령이 끝난 뒤에** 돌린다. day2-train.sh는 표본 한 벌
#   (40문항 · 실측 호출당 11.6초 → 8분 남짓, bare는 23~44초/답이라 15~30분)이나 64k ctx 6과제를
#   전경으로 붙들고 있어, TERM을 줘도 8093의 14B(9GB + ctx 32768 KV)가 그만큼 더 산다 —
#   감시견이 막으려던 **바로 그 상황(낮 서빙 침범)이 30분 연장**되는 꼴이다.
#   그래서 셸에 TERM을 예약하고, 그 셸의 **직계 자식**(node·tee·자기가 띄운 8093)에도 TERM을 준다:
#   자식이 죽으면 전경 명령이 곧 끝나고 셸은 그 자리에서 trap을 돈다.
#   ⚠ -P(부모)로만 고른다 — 교사(8080)·임베딩(8081)은 이 PID의 자식이 아니라 **원리상 안 걸린다.**
stop_child() {  # stop_child <day2-train.sh PID>
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM "$pid" 2>/dev/null
  pkill -TERM -P "$pid" 2>/dev/null
  return 0
}

# 지금 돌고 있는 day2-train.sh — 아래 trap이 이것을 내린다(되돌리기 ①의 근거).
CHILD_PID=""
judge_abort() {
  say "⚠ 판정이 밖에서 중단됐다 — day2-train.sh(PID ${CHILD_PID:-없음})와 그 자식을 내린다"
  stop_child "$CHILD_PID"
  kill "${MEMLOGPID:-}" 2>/dev/null
  exit 143
}
# ⚠ judge에 trap이 없던 판에서는 judge만 죽고 day2-train.sh·8093이 그대로 살았다 — 감시견 둘도
#   함께 사라져 **08:30 보호가 없어진 채** 낮으로 넘어갔다(bake 머리글이 이미 값을 치른 함정).
trap 'judge_abort' INT TERM

run_guarded() {  # run_guarded <이름표> -- <명령...>
  local label="$1"; shift
  [ "${1:-}" = "--" ] && shift
  say "▶ $label 시작"
  "$@" > "$R5/judge-$label.out" 2>&1 &
  local pid=$!
  CHILD_PID="$pid"
  ( fails=0
    while kill -0 "$pid" 2>/dev/null; do
      sleep 15
      kill -0 "$pid" 2>/dev/null || break
      [ "$TEACHER_WATCH" -eq 1 ] || continue
      if curl -s -m 5 http://127.0.0.1:8080/health > /dev/null 2>&1; then fails=0; continue; fi
      # ⚠ 한 번 놓쳤다고 내리지 않는다 — 제품이 8080을 다시 묶는 몇 초에 걸리면 판정 밤을 통째로
      #   잃는다. 연속 3회(45초)면 교사가 정말 밀린 것으로 본다.
      fails=$((fails + 1))
      [ "$fails" -lt 3 ] && continue
      echo "[$(date '+%F %T %Z')] ⚠ 교사(8080) 연속 ${fails}회 무응답 — $label 을(를) 내린다(day2-train.sh PID $pid 와 그 직계 자식에 TERM)" >> "$LOG"
      stop_child "$pid"
      break
    done ) > /dev/null 2>&1 &
  local dogpid=$!
  ( while kill -0 "$pid" 2>/dev/null; do
      sleep 60
      kill -0 "$pid" 2>/dev/null || break
      NOW=$(date '+%H:%M')
      if [[ "$NOW" > "$DEADLINE" ]]; then
        echo "[$(date '+%F %T %Z')] ⚠ 데드라인($DEADLINE) 도달 — $label 을(를) 내린다(교사는 그대로 · day2-train.sh PID $pid 와 그 직계 자식에 TERM)" >> "$LOG"
        stop_child "$pid"
        break
      fi
    done ) > /dev/null 2>&1 &
  local deadlinepid=$!
  wait "$pid"
  local rc=$?
  CHILD_PID=""
  kill "$dogpid" "$deadlinepid" 2>/dev/null
  say "◀ $label 끝(코드 $rc) — 로그 $R5/judge-$label.out"
  return "$rc"
}

( while true; do echo "[$(date '+%T')] $(mem)"; sleep 10; done ) > "$R5/judge-mem.log" 2>&1 &
MEMLOGPID=$!

# ── ⑤ 갈래 1 — 베이스 40문항 ────────────────────────────────────────────────
# ⚠ 옛 베이스(results-ladder/baseline/)는 12문항 판이다 — 40문항으로 다시 재면서 그 12문항
#   베이스와 견주면 ⑤(자리별 잘림 건수)·⑬(근거거절 건수)이 **거짓 빨강**이 된다. 새 폴더에 둔다.
run_guarded "baseline40" -- bash "$DAY2" --baseline-probe --port "$PORT"
RC_BASE=$?

# ★ 이 베이스가 **무엇인지**를 폴더 안에 적는다(2026-09-11 검토관 적발).
#   왜: gates.mjs의 기준선 주석이 「어디서 왔는지는 results-ladder/baseline/README.md에 적혀 있다」로
#   가리키는데, 새 40문항 베이스는 그 증언 없이 태어났다. 옛 12문항 베이스를 **안 덮기로 한** 결정의
#   근거가 바로 그 증언이라, 증언 없는 베이스는 그 결정을 반쪽으로 만든다.
if [ -s "$BASEQ40/samples-grounded.json" ]; then
  QFILE="$REPO/tools/team-bench/samples-questions.json"
  QSHA=$(sha256sum "$QFILE" 2>/dev/null | awk '{print $1}')
  QCNT=$(node -e 'const j=require(process.argv[1]);const a=Array.isArray(j)?j:(j.문항??j.questions??[]);console.log(a.length)' "$QFILE" 2>/dev/null)
  {
    echo "# results-ladder/baseline-q40 — 40문항 베이스(어댑터 없음)"
    echo
    echo "- 잰 때: $(date '+%F %T %Z')"
    echo "- 문항 파일: tools/team-bench/samples-questions.json · 문항 ${QCNT:-미측정}건 · sha256 ${QSHA:-미측정}"
    echo "- 만든 명령: LADDER_BASELINE_DIR=$BASEQ40 bash tools/ladder/day2-train.sh --baseline-probe --port $PORT"
    echo "- 무슨 인자로 쟀나: 같은 폴더의 harness-args.json(포트·서버·에이전트·명령줄·근거꼴 출처)"
    echo
    echo "⚠ 옛 \`results-ladder/baseline/\` 은 **12문항 판**이다 — 이 폴더의 숫자와 견주지 않는다."
    echo "관문 ⑤(자리별 잘림)·⑬(근거거절)·⑭(로컬 단독 지식)은 모집단이 다르면 **거짓 빨강**을 낸다."
    echo "그래서 옛 폴더를 덮지 않고 여기에 따로 쌓는다(2026-09-11 메인 결정 ②)."
  } > "$BASEQ40/README.md"
  say "베이스40 출처 기록 → $BASEQ40/README.md (문항 ${QCNT:-미측정}건)"
else
  say "⚠ 베이스40 표본이 없어 출처 기록(README.md)을 안 남겼다 — 베이스 갈래 코드 $RC_BASE"
fi

# ── ⑥ 갈래 2 — r5a(재학습 금지) ─────────────────────────────────────────────
# ⚠ --skip-train 은 명시적 안전장치다 — ②의 어댑터 존재 선검사와 **둘 다** 건다(하나는 실수로
#   빠질 수 있다). --skip-build 는 round.json의 빌드금지 칸이 이미 자동으로 걸지만 명시해 둔다.
# ★ 데드라인이 이미 지났으면 **시작하지 않는다**(2026-09-11 검토관 적발). 옛 판은 ⑤가 데드라인에
#   내려가도 그대로 ⑥으로 내려갔고, 그 판의 감시견은 첫 sleep 60 뒤에야 깨므로 **낮에 14B를 한 번
#   더 올렸다 죽였다** — 감시견의 존재 이유(낮 서빙을 지킨다)와 정반대다.
NOW=$(date '+%H:%M')
if [[ "$NOW" > "$DEADLINE" ]]; then
  say "⚠ 데드라인($DEADLINE)이 이미 지났다(지금 $NOW) — ⑥ $ROUND 갈래를 시작하지 않는다(낮에 gb10은 원격 팀원 셋의 두뇌다)"
  RC_ROUND=2
else
  run_guarded "$ROUND" -- bash "$DAY2" --round "$ROUND" --skip-build --skip-train --port "$PORT"
  RC_ROUND=$?
fi

kill "$MEMLOGPID" 2>/dev/null

# ── ⑦ 끝 상태 + 요약 ─────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"
say "메모리: $(mem)"
MAXMEM=$(awk '{for(i=1;i<=NF;i++) if($i=="사용") {gsub("G","",$(i+1)); if($(i+1)+0>m) m=$(i+1)+0}} END{print m"G"}' "$R5/judge-mem.log" 2>/dev/null)
# ⚠ **있는 파일만** 적는다(2026-09-11 검토관 적발) — r5a가 단계 실패(코드 8)로 죽어 gate.md가 하나도
#   없어도 옛 판은 같은 경로 두 개를 적었다. 없는 파일을 있는 것처럼 적는 것은 아침 판독의 첫 입력을
#   거짓으로 만드는 일이다(폴백 문구를 정상 출력처럼 내보내는 그 부류의 약한 꼴).
GATEMD=""
for f in "$R5A_OUT"/ep*/gate.md "$R5A_OUT/gate.md"; do
  [ -s "$f" ] && GATEMD="${GATEMD:+$GATEMD,}$f"
done
say "요약 — 베이스40코드=$RC_BASE · ${ROUND}판정코드=$RC_ROUND · gate.md=${GATEMD:-없음} · 교사health=$(teacher) · 판정중최대사용메모리=${MAXMEM:-미측정}"
# ★ 나가는 코드에 **베이스도 싣는다** — 베이스가 실패하면 ①⑤⑬⑭이 견줄 상대를 잃는다.
#   (r5a가 0인데 베이스가 8이면 「판정 완주」가 아니다.)
RC_OUT="$RC_ROUND"
[ "$RC_OUT" -eq 0 ] && RC_OUT="$RC_BASE"
say "════ 회전 5 $ROUND 아침 판정 끝(코드 $RC_OUT · 베이스 $RC_BASE · $ROUND $RC_ROUND) ════"

# ── ⑧ 어댑터 gguf 치우기 ────────────────────────────────────────────────────
# ⚠ results-ladder/ 는 **커밋 대상**이다(.gitignore:26). adapter-epN.gguf에는 gguf 무시 규칙이
#   없다(`git check-ignore` 0건) — 누가 git add -A 를 치면 바이너리가 이력에 들어간다.
#   r4-v4 때는 사람이 손으로 치웠고 코드엔 안 남았다 — 같은 일을 또 손에 맡기지 않는다.
MOVED=0
for f in "$R5A_OUT"/adapter-ep*.gguf; do
  [ -s "$f" ] || continue
  mv "$f" "$R5/"
  MOVED=$((MOVED + 1))
done
if [ "$MOVED" -gt 0 ]; then
  say "어댑터 gguf ${MOVED}개를 $R5A_OUT 밖 $R5/ 로 옮김(커밋 대상 폴더에 안 남긴다)"
else
  say "어댑터 gguf 없음(이동할 것 없음)"
fi

exit "$RC_OUT"
