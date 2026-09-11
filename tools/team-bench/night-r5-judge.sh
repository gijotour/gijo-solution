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
#     실제로 있는지 먼저 본다(fail-closed). 어댑터 없이 --round r5a를 부르면 day2-train.sh:372의
#     DONE_MARK 검사가 거짓이 되어 4bit 기본값으로 **밤을 통째로 다시 굽는다**(:427에 --precision이
#     없다) — 판정하러 왔다가 딴 어댑터를 만드는 사고다.
#   · 운영 데이터를 쓰지 않는다.
#
# ■ 차례
#   ① 시작 상태(교사 health · 메모리 · 8093이 비었나 · 어젯밤 굽기 로그가 있었나)
#   ② 전제 fail-closed — 어댑터(adapter_model.safetensors · checkpoint-26 · checkpoint-52)가
#      없으면 「굽기가 없었다/반쯤 구워졌다」로 적고 **여기서 끝낸다.**
#   ③ 가용 메모리 하한(판정의 수로 새로 잰다 — 굽기의 32G와 다르다. 아래 JUDGE_MIN_AVAIL 참고)
#   ④ 교사 감시견 + 08:30 데드라인 감시견 — **day2-train.sh의 PID에 TERM**을 보낸다
#      (그 파일 :115-117 trap이 8093을 정리한다). 이름(프로세스명)으로 llama-server를 죽이는 방식은
#      교사(8080)·임베딩(8081)까지 함께 죽이므로 쓰지 않는다.
#   ⑤ 갈래 1 — 베이스 40문항(results-ladder/baseline-q40/, 옛 12문항 베이스는 덮지 않는다)
#   ⑥ 갈래 2 — r5a(체크포인트 2개 → ep1·ep2 두 판을 day2-train.sh가 스스로 돈다)
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
#   1) night-r5-judge.sh PID(또는 이 스크립트가 띄운 day2-train.sh PID)에 TERM → 8093이 정리된다
#   2) systemctl --user stop gijo-r5-judge.timer gijo-r5-judge.service
#   3) 결과를 버리려면 results-ladder/baseline-q40/ 와
#      results-ladder/day2/r5a/{ep1,ep2,adapter-ep*.gguf,convert-ep*.log,harness/} 를 지운다.
#      ⚠ server/data/lora/r5a 는 **지우지 않는다**(다시 구울 수 없는 것이다).
#   교사(8080)·임베딩(8081)은 어느 단계에서도 건드리지 않는다.
#
# 나가는 코드: 0=판정 완주 · 2=전제 없음(굽기가 없었다/반쯤 구워졌다 — 판정을 안 했다) · 그 외=day2-train.sh가 낸 코드
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
mem() { free -g | awk '/^메모리|^Mem/ {print "총 "$2"G 사용 "$3"G 가용 "$7"G"}'; }
teacher() { curl -s -m 5 http://127.0.0.1:8080/health || echo "(응답 없음)"; }

say "════ 회전 5 r5a 아침 판정 시작 ════"

# ── ① 시작 상태 ────────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  메모리: $(mem)"
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
# ⚠ 이 검사가 없으면 day2-train.sh:372의 `-s $DONE_MARK`가 거짓이 되어 ⑥단계가 **4bit
#   기본값으로 다시 굽는다**(:427에 --precision이 없다) — 밤을 통째로 잃고 어댑터까지 딴것이 된다.
DONE_MARK="$LORA_DIR/adapter_model.safetensors"
if [ ! -s "$DONE_MARK" ]; then
  say "✗ 어댑터가 없다 — 굽기가 없었다: $DONE_MARK"
  say "요약 — 전제=굽기없음 · 판정 안 함"
  say "════ 회전 5 r5a 아침 판정 끝(코드 2) ════"
  exit 2
fi
CKPT_MISSING=""
for step in 26 52; do
  [ -d "$LORA_DIR/checkpoint-$step" ] || CKPT_MISSING="$CKPT_MISSING checkpoint-$step"
done
if [ -n "$CKPT_MISSING" ]; then
  say "✗ 반쯤 구워졌다 — 없는 체크포인트:$CKPT_MISSING ($LORA_DIR)"
  say "요약 — 전제=반쯤구워짐 · 판정 안 함"
  say "════ 회전 5 r5a 아침 판정 끝(코드 2) ════"
  exit 2
fi
say "전제 통과 — 어댑터 있음($DONE_MARK) · checkpoint-26 · checkpoint-52 있음"

# ── ③ 가용 메모리 하한 ──────────────────────────────────────────────────────
AVAIL=$(free -g | awk '/^메모리|^Mem/ {print $7}')
if [ "${AVAIL:-0}" -lt "$JUDGE_MIN_AVAIL" ]; then
  say "✗ 가용 메모리 ${AVAIL}G < ${JUDGE_MIN_AVAIL}G — 교사를 밀 위험이 있어 **판정을 건너뛴다**"
  say "요약 — 전제=가용메모리부족(${AVAIL}G) · 판정 안 함"
  say "════ 회전 5 r5a 아침 판정 끝(코드 2) ════"
  exit 2
fi
say "가용 메모리 ${AVAIL}G ≥ ${JUDGE_MIN_AVAIL}G — 진행"

# 40문항 베이스를 **새 폴더에** 재는 이유(옛 12문항 베이스를 안 덮는 이유) — day2-train.sh의
# LADDER_BASELINE_DIR로 넘긴다(ⓐ 배선, 2026-09-11).
export LADDER_BASELINE_DIR="$BASEQ40"

# ── ④ 감시견 — 교사가 죽거나 데드라인이 되면 **day2-train.sh의 PID에 TERM**을 보낸다 ─────────
# ⚠ 이름(프로세스명)으로 llama-server를 죽이면 교사(8080)·임베딩(8081)까지 함께 죽는다.
#   day2-train.sh:115-117의 EXIT/INT/TERM trap이 자기 SERVE_PID(8093)만 정리하므로,
#   **그 스크립트 자신의 PID**에 신호를 보내 이 trap을 통해서만 8093을 정리한다.
run_guarded() {  # run_guarded <이름표> -- <명령...>
  local label="$1"; shift
  [ "${1:-}" = "--" ] && shift
  say "▶ $label 시작"
  "$@" > "$R5/judge-$label.out" 2>&1 &
  local pid=$!
  ( while kill -0 "$pid" 2>/dev/null; do
      sleep 15
      kill -0 "$pid" 2>/dev/null || break
      if ! curl -s -m 5 http://127.0.0.1:8080/health > /dev/null 2>&1; then
        echo "[$(date '+%F %T %Z')] ⚠ 교사(8080) 무응답 — $label 을(를) 내린다(day2-train.sh PID $pid 에 TERM)" >> "$LOG"
        kill -TERM "$pid" 2>/dev/null
        break
      fi
    done ) > /dev/null 2>&1 &
  local dogpid=$!
  ( while kill -0 "$pid" 2>/dev/null; do
      sleep 60
      kill -0 "$pid" 2>/dev/null || break
      NOW=$(date '+%H:%M')
      if [[ "$NOW" > "$DEADLINE" ]]; then
        echo "[$(date '+%F %T %Z')] ⚠ 데드라인($DEADLINE) 도달 — $label 을(를) 내린다(교사는 그대로 · day2-train.sh PID $pid 에 TERM)" >> "$LOG"
        kill -TERM "$pid" 2>/dev/null
        break
      fi
    done ) > /dev/null 2>&1 &
  local deadlinepid=$!
  wait "$pid"
  local rc=$?
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

# ── ⑥ 갈래 2 — r5a(재학습 금지) ─────────────────────────────────────────────
# ⚠ --skip-train 은 명시적 안전장치다 — ②의 어댑터 존재 선검사와 **둘 다** 건다(하나는 실수로
#   빠질 수 있다). --skip-build 는 round.json의 빌드금지 칸이 이미 자동으로 걸지만 명시해 둔다.
run_guarded "r5a" -- bash "$DAY2" --round "$ROUND" --skip-build --skip-train --port "$PORT"
RC_ROUND=$?

kill "$MEMLOGPID" 2>/dev/null

# ── ⑦ 끝 상태 + 요약 ─────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"
say "메모리: $(mem)"
MAXMEM=$(awk '{for(i=1;i<=NF;i++) if($i=="사용") {gsub("G","",$(i+1)); if($(i+1)+0>m) m=$(i+1)+0}} END{print m"G"}' "$R5/judge-mem.log" 2>/dev/null)
say "요약 — 베이스40코드=$RC_BASE · r5a판정코드=$RC_ROUND · gate.md=$R5A_OUT/ep1/gate.md,$R5A_OUT/ep2/gate.md · 교사health=$(teacher) · 판정중최대사용메모리=${MAXMEM:-미측정}"
say "════ 회전 5 r5a 아침 판정 끝(코드 $RC_ROUND) ════"

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

exit "$RC_ROUND"
