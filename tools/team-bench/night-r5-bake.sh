#!/bin/bash
# tools/team-bench/night-r5-bake.sh — 회전 5 **r5a 본 굽기**(gb10 전용, 2026-09-12 03:25 KST 예약).
#
# ■ 결정(2026-09-11 사장님 「2 1 3으로」 · 메인이 갈림길 정리)
#   재료 raft-vuln-v6(412행, 등급 O만) · bf16 · LoRA all · rank16 · lr 1e-4 · 2에폭 · max_seq 4096 ·
#   lora-alpha-mult 1 · eval-file holdout-vuln-o · 출력 data/lora/r5a · 회전 id r5a.
#   긴 형식 111행은 넣지 않는다(변수 최소) · 27B 되묻기는 건너뜀 · 아침 판정은 다음 밤(별도 배선).
#
# ■ 왜 새 스크립트인가 — day2-train.sh를 안 쓰는 이유(설계관 실측, 2026-09-11)
#   day2-train.sh는 r5a를 못 돌린다 — rounds.json에 항목이 없고, precision·loraTargets를 안 읽으며,
#   안전장치가 0이다. 그래서 학습기(finetune_qlora14b.py)를 **직접** 부른다.
#   안전장치는 night-r5-prep.sh(2026-09-11 새벽 실행 · 종료코드 0 · 교사 생존 확인됨)의 것을
#   **그대로 옮긴다** — 잣대를 여기서 새로 적지 않는다.
#
# ■ 이 스크립트가 **절대 안 하는 것**
#   · 8080(교사)·8081(임베딩)을 내리거나 다시 묶지 않는다. 그 둘의 PID는 건드리지 않는다.
#   · --host 를 주지 않는다(루프백을 빼앗는다 — 감시가 되돌린다).
#   · 27B를 올리지 않는다(이번 회전은 되묻기를 건너뛴다 — 위 결정 참조).
#   · 운영 데이터를 쓰지 않는다.
#
# ■ night-r5-prep.sh와 다른 점 (그 외 안전장치는 문구까지 동일)
#   ① 27B 되묻기 단계가 없다(결정으로 건너뜀) — 재료는 이미 확정된 raft-vuln-v6를 그대로 쓴다.
#   ② 등급 관문의 --cwin은 **cwin-v6.json**(6,388)이다. 어젯밤의 cwin.json(9,894)을 쓰면
#      「칸은 O인데 글은 C」를 옛 창 집합으로 재게 되어 새로 걸린 41개 창을 못 본다.
#   ③ 스모크(100스텝)가 아니라 **본 굽기**(--max-steps 안 줌 = 2에폭 52스텝 전부)다 — 몇 시간이 걸린다.
#   ④ **08:30 데드라인 감시견**을 새로 둔다 — 그 시각까지 살아 있으면 학습만 죽인다(교사는 그대로 —
#      낮에 gb10이 원격 팀원 셋을 섬겨야 한다. 예상 종료는 04:30경이라 여유가 크다).
#
# 쓰는 법(gb10):  bash ~/gijo-as/tools/team-bench/night-r5-bake.sh
set -u
# ⚠ 비대화형 셸은 .bashrc를 안 읽는다 — node·PATH가 여기서 온다(gb10 규약).
[ -f "$HOME/gijo-env.sh" ] && . "$HOME/gijo-env.sh"
# ⚠ **변수명은 영문만.** bash는 한글 변수명을 못 읽는다(2026-08-10에 밟았고 또 밟을 뻔했다).
R5=${R5:-$HOME/bench/ladder/r5}
LOG=${LOG:-$R5/night2.log}
REPO=${REPO:-$HOME/gijo-as}
SERVER=$REPO/server
VENV=${VENV:-$HOME/venv-train}
DATASET=${DATASET:-raft-vuln-v6}
ROUND=${ROUND:-r5a}
BAKE_OUT=${BAKE_OUT:-data/lora/$ROUND}
CWIN=${CWIN:-$R5/cwin-v6.json}
HOLDOUT=${HOLDOUT:-$REPO/tools/team-bench/holdout-vuln-o.json}
SAMPLES=${SAMPLES:-$REPO/tools/team-bench/samples-questions.json}
GRADEGATE=${GRADEGATE:-$REPO/tools/team-bench/gradegate.mjs}
# 밤새 굽는다 — 사전 가용 관문은 prep과 같은 수(bf16 14B 가중치만 28G).
BAKE_MIN_AVAIL=${BAKE_MIN_AVAIL:-32}
BAKE_MEM_MAX=${BAKE_MEM_MAX:-38G}
# 08:30 데드라인 — 예상 종료 04:30경이라 여유가 크지만, 낮 서빙을 지키는 마지막 방어선이다.
DEADLINE=${DEADLINE:-08:30}

mkdir -p "$R5"
say() { echo "[$(date '+%F %T %Z')] $*" | tee -a "$LOG"; }
mem() { free -g | awk '/^메모리|^Mem/ {print "총 "$2"G 사용 "$3"G 가용 "$7"G"}'; }
teacher() { curl -s -m 5 http://127.0.0.1:8080/health || echo "(응답 없음)"; }

say "════ 회전 5 r5a 본 굽기 시작 ════"
say "교사(8080) health: $(teacher)  ·  메모리: $(mem)"
say "임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"

DSPATH=$SERVER/data/datasets/$DATASET.json
if [ ! -f "$DSPATH" ]; then
  say "✗ 재료가 없다: $DSPATH — **굽지 않는다**"
  say "요약 — 등급관문=재료없음 · 굽기종료코드=- · 재료=$DATASET · 어댑터=$BAKE_OUT"
  exit 1
fi
say "재료 행 수: $(node -e "console.log(JSON.parse(require('fs').readFileSync('$DSPATH','utf8')).length)")"

# ── 등급 관문 — **굽기 직전에 다시 잰다** ────────────────────────────────
# ⚠ 여기가 없으면 이 스크립트는 「관문을 지난 재료」가 아니라 「거기 놓여 있던 파일」을 굽는다.
if [ ! -f "$GRADEGATE" ]; then
  say "✗ 등급 관문 도구가 없다($GRADEGATE) — **못 잰 것은 통과가 아니다.** 굽지 않는다"
  GATE=notool
elif node "$GRADEGATE" --in "$DSPATH" --cwin "$CWIN" --holdout "$HOLDOUT" --samples "$SAMPLES" 2>&1 | tee -a "$LOG" | grep -q "통과 — 먹여도 된다"; then
  GATE=ok
else
  say "✗ 등급 관문 빨강 — 이 재료로는 **굽지 않는다**(C가 가중치로 들어가는 것이 이 회전이 막으려는 그것이다)"
  GATE=red
fi

# ── 본 굽기 ───────────────────────────────────────────────────────────────
# 학습기는 **저장소 것**을 먼저 쓴다 — 사본은 저장소가 아직 새 깃발을 못 받았을 때만 쓴다.
FT=$SERVER/scripts/finetune_qlora14b.py
if ! grep -q -- "--precision" "$FT" 2>/dev/null; then
  say "저장소 학습기에 --precision 이 없다(아직 push 전) — 사본을 쓴다: $R5/finetune_qlora14b.py"
  FT=$R5/finetune_qlora14b.py
fi
AVAIL=$(free -g | awk '/^메모리|^Mem/ {print $7}')
BAKE=skip
if [ "$GATE" != "ok" ]; then
  say "굽기 건너뜀 — 등급 관문이 $GATE 다(빨강 재료를 굽지 않는다)"
elif [ "${AVAIL:-0}" -lt "$BAKE_MIN_AVAIL" ]; then
  # ⚠ 가용 관문 — 없으면 「교사를 안 내린다」가 커널 OOM으로 깨질 수 있다.
  say "굽기 건너뜀 — 가용 메모리 ${AVAIL}G < ${BAKE_MIN_AVAIL}G (bf16 14B는 가중치만 28G다). 교사를 밀 위험이 있다"
else
  say "학습기: $FT"
  say "굽기 시작 — bf16 · LoRA all · rank16 · lr1e-4 · 2에폭 · max_seq 4096 · lora-alpha-mult 1 · 가용 ${AVAIL}G · 상한 $BAKE_MEM_MAX · 우리가 먼저 죽게 oom_score_adj=1000"
  say "예상 스텝 52(26/에폭) · 예상 55~80분 · 데드라인 $DEADLINE(그때까지 살아 있으면 학습만 죽인다)"
  ( while true; do echo "[$(date '+%T')] $(mem)"; sleep 30; done ) > "$R5/bake-mem.log" 2>&1 &
  MEMPID=$!
  # 교사 감시견 — 교사가 말을 멈추면 **굽기를 내린다.** cgroup 회계와 무관하게 도는 마지막 방어선이다.
  ( while true; do
      sleep 15
      if ! curl -s -m 5 http://127.0.0.1:8080/health > /dev/null 2>&1; then
        echo "[$(date '+%F %T %Z')] ⚠ 교사(8080) 무응답 — 굽기를 내린다" >> "$LOG"
        pkill -f "finetune_qlora14b.py" 2>/dev/null
        break
      fi
    done ) > /dev/null 2>&1 &
  DOGPID=$!
  # 08:30 데드라인 감시견 — **학습만** 죽인다. 교사·임베딩은 절대 건드리지 않는다(낮 서빙 보호).
  ( while true; do
      sleep 60
      NOW=$(date '+%H:%M')
      if [[ "$NOW" > "$DEADLINE" ]]; then
        echo "[$(date '+%F %T %Z')] ⚠ 데드라인($DEADLINE) 도달 — 굽기가 아직 살아 있어 학습만 내린다(교사는 그대로)" >> "$LOG"
        pkill -f "finetune_qlora14b.py" 2>/dev/null
        break
      fi
      pgrep -f "finetune_qlora14b.py" > /dev/null 2>&1 || break
    done ) > /dev/null 2>&1 &
  DEADLINEPID=$!
  cd "$SERVER" || exit 1
  # choom = oom_score_adj 를 올려 **커널이 우리를 먼저 고르게** 한다(교사는 780이다).
  # systemd-run --scope MemoryMax = cgroup 상한. ⚠ 최선의 노력이다(어젯밤 실측: 상한 넘김에도 종료 0 —
  #   증거 부족으로 계속 건다. choom·감시견이 최후 방어선).
  RUNNER=""
  command -v systemd-run > /dev/null 2>&1 && RUNNER="systemd-run --user --scope -q -p MemoryMax=$BAKE_MEM_MAX --"
  command -v choom > /dev/null 2>&1 && RUNNER="$RUNNER choom -n 1000 --"
  [ -n "$RUNNER" ] || say "⚠ systemd-run·choom 이 없다 — 상한 없이 돈다(가용 관문·감시견만 걸린 상태)"
  GIJO_FT_BASE_MODEL=${GIJO_FT_BASE_MODEL:-Qwen/Qwen3-14B} \
    $RUNNER "$VENV/bin/python" "$FT" --dataset "$DATASET" --output "$BAKE_OUT" \
    --base-model "${GIJO_FT_BASE_MODEL:-Qwen/Qwen3-14B}" \
    --precision bf16 --lora-targets all --rank 16 --lr 0.0001 --epochs 2 --max-seq 4096 \
    --lora-alpha-mult 1 --save-epochs --eval-file "$HOLDOUT" \
    > "$R5/bake.log" 2>&1
  BAKE=$?
  kill "$MEMPID" "$DOGPID" "$DEADLINEPID" 2>/dev/null
  say "굽기 종료코드 $BAKE · 마지막 줄: $(tail -5 "$R5/bake.log" | tr '\n' ' ' | cut -c1-400)"
  say "굽기 중 최대 사용 메모리: $(awk '{for(i=1;i<=NF;i++) if($i=="사용") {gsub("G","",$(i+1)); if($(i+1)+0>m) m=$(i+1)+0}} END{print m"G"}' "$R5/bake-mem.log")"
  say "교사 health(굽기 직후): $(teacher)"
fi

# ── 끝 상태 ───────────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"
say "메모리: $(mem)"
say "요약 — 등급관문=${GATE:-미실행} · 굽기종료코드=$BAKE · 재료=$DATASET · 어댑터=$BAKE_OUT"
say "════ 회전 5 r5a 본 굽기 끝 ════"
