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
# ■ night-r5-prep.sh와 다른 점 (2026-09-11 검토관 적발로 목록을 **실제 차이 전부**로 고침 —
#   그전 머리글은 「그 외는 문구까지 동일」이라 적었는데 사실이 아니었다)
#   ① 27B 되묻기 단계가 없다(결정으로 건너뜀) — 재료는 이미 확정된 raft-vuln-v6를 그대로 쓴다.
#   ② 등급 관문의 --cwin은 **cwin-v6.json**(6,388)이다. 어젯밤의 cwin.json(9,894)을 쓰면
#      「칸은 O인데 글은 C」를 옛 창 집합으로 재게 되어 새로 걸린 41개 창을 못 본다.
#      또 prep에 없던 --holdout·--samples(겹침 관문)를 함께 준다 — 시험지를 물고 굽지 않기 위해서다.
#   ③ 스모크(100스텝)가 아니라 **본 굽기**(--max-steps 안 줌 = 2에폭 52스텝 전부)다 — 몇 시간이 걸린다.
#   ④ **08:30 데드라인 감시견**을 새로 둔다 — 그 시각까지 살아 있으면 학습만 죽인다(교사는 그대로 —
#      낮에 gb10이 원격 팀원 셋을 섬겨야 한다. 예상 종료는 04:45~05:00경이라 여유가 크다).
#   ⑤ 등급 관문 도구의 **사본 폴백을 없앴다**(prep은 $R5/gradegate.mjs로 내려갔다) — 저장소 것이
#      없으면 굽지 않는다. fail-closed 쪽이라 방향은 의도한 것이다.
#   ⑥ GIJO_GATES·GIJO_RAFT_BUILDER·GIJO_MATERIAL_R5 export가 없다 — 관문이 $R5 사본이 아니라
#      저장소 잣대를 쓴다(2026-09-11 gb10 md5 대조: 두 사본 동일 03e6ddc85cf0dfe62f977af5cfd49a7c).
#   ⑦ 끝줄 발췌가 tail -5 / 400자다(prep은 tail -3 / 300자).
#
# ■ 되돌리기 — **순서가 중요하다**(2026-09-11 검토관 적발)
#   학습은 서비스가 아니라 `systemd-run --scope`가 만든 **딴 유닛**에서 돈다(어젯밤 저널에서 확인:
#   run-r2c4d2b898….scope). 그래서 서비스를 먼저 멈추면 **학습은 안 멈추고 감시견만 죽어**
#   08:30 데드라인 보호가 사라진다. 반드시 이 순서로 한다.
#     1) pkill -f finetune_qlora14b.py                     ← 학습을 먼저 내린다(필수)
#     2) systemctl --user stop gijo-r5-night2.timer gijo-r5-night2.service
#     3) rm -rf ~/gijo-as/server/data/lora/r5a             ← 반쯤 구워진 어댑터를 치운다
#   교사(8080)·임베딩(8081)은 어느 단계에서도 건드리지 않는다.
#
# ■ 아침 판정의 첫 항목 — `ls ~/bench/ladder/r5/night2.log`
#   타이머가 transient(Persistent=no)라 gb10이 재부팅되면 예약이 **소리 없이** 사라진다.
#   로그 파일이 없으면 결과가 나쁜 게 아니라 **아예 안 구워진 것**이다.
#   ⚠ 굽기 산출 로그는 **회전 이름이 앞에 붙는다**(2026-09-13): `$ROUND-bake.log`·`$ROUND-bake-mem.log`.
#     2026-09-12 r5a 밤이 남긴 옛 이름(bake.log·bake-mem.log)은 그 자리에 그대로 있다 — 덮이지 않는다.
#
# 쓰는 법(gb10):  bash ~/gijo-as/tools/team-bench/night-r5-bake.sh
#   r5b(LoRA 자리만 좁힌 판):  ROUND=r5b LORA_TARGETS=attn bash ~/gijo-as/tools/team-bench/night-r5-bake.sh
#   ⚠ ROUND를 주면 어댑터(data/lora/$ROUND)와 산출 로그가 **함께** 갈린다 — 하나만 갈리면 r5a 기록이 덮인다.
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
# [2026-09-13 · 검토관 적발] 굽기 산출 로그는 **회전에 묶는다.** 예전엔 bake.log·bake-mem.log가
#   회전과 무관한 한 이름이라, `ROUND=r5b …`로 한 번 더 구우면 `>`가 r5a의 시계열 증거를 통째로
#   잘라 덮었다(이번 대책의 뿌리를 확정한 773표본이 그 파일이다). night2.log는 그대로 둔다 —
#   night-r5-judge.sh가 그 이름을 읽고(judge:109), `tee -a`라 덮이지 않는다. 대신 아래 배너·요약에
#   $ROUND를 찍어 두 밤이 한 파일에 섞여도 **어느 회전인지** 읽히게 한다.
BAKELOG=${BAKELOG:-$R5/$ROUND-bake.log}
MEMLOG=${MEMLOG:-$R5/$ROUND-bake-mem.log}
# [2026-09-14 · r5b 첫 굽기] 스왑 감시견 상태 파일 — 감시견은 별도 서브셸에서 도므로 그 안
#   변수를 끝 요약(밖)이 못 읽는다. 여기 두 값(최대 스왑 증가·SwapFree 최저)을 갱신해 두고
#   요약이 이 파일을 읽는다. 매 실행 시작 때 지운다(아래) — 지우지 않으면 이번에 굽지 않은
#   밤이 지난 밤의 값을 자기 것인 양 보고하게 된다.
SWAPDOG_STATE=${SWAPDOG_STATE:-$R5/$ROUND-swapdog.txt}
CWIN=${CWIN:-$R5/cwin-v6.json}
HOLDOUT=${HOLDOUT:-$REPO/tools/team-bench/holdout-vuln-o.json}
SAMPLES=${SAMPLES:-$REPO/tools/team-bench/samples-questions.json}
GRADEGATE=${GRADEGATE:-$REPO/tools/team-bench/gradegate.mjs}
# [2026-09-13 · r5b 메모리 대책] r5a를 스크립트에 **박아 두지 않고** 매개변수화한다 — prep→bake
#   복사 때 「실제 차이 전부」를 다시 적어야 했던 값을 또 치르지 않으려는 것이다(머리글 참고).
#   ⚠ 기본값은 r5a와 **바이트 단위로 같은 명령**을 낸다(아래 실행줄 참고 · bash -x dry로 대조할 것).
LORA_TARGETS=${LORA_TARGETS:-all}
PRECISION=${PRECISION:-bf16}
MAXSEQ=${MAXSEQ:-4096}
# [2026-09-13 · r5b 메모리 대책] 토치 수준 상한 — 기본은 안 걺(빈 문자열). 걸면 명령줄에
#   --gpu-mem-fraction이 붙는다(finetune_qlora14b.py 신설 깃발). 값을 고르는 것은 계측 뒤다.
GPUMEMFRAC=${GPUMEMFRAC:-}
# [2026-09-13 · r5b 메모리 대책] PYTORCH_CUDA_ALLOC_CONF — 기본은 안 켠다(효과 미실측·계측 뒤 판단).
#   켜려면 예: `ALLOC_CONF=expandable_segments:True bash night-r5-bake.sh`.
ALLOC_CONF=${ALLOC_CONF:-}
# 밤새 굽는다 — 사전 가용 관문은 prep과 같은 수(bf16 14B 가중치만 28G).
# ⚠ 이 32G는 **실측 필요량보다 작다**(2026-09-11 검토관 적발). 어젯밤 실측: 시작 가용 44G →
#   최대 사용 120G/121G(교사 77G 위에 우리가 약 43G). 32~43G 사이에서 시작하면 관문은 초록인데
#   OOM으로 날아갈 여지가 있다. **잣대를 바꾸는 일은 메인/사장님 결정**이라 숫자는 그대로 두고,
#   아래에서 실측 필요량(BAKE_MEASURED_NEED)과 견줘 **경고를 로그에 남긴다**.
BAKE_MIN_AVAIL=${BAKE_MIN_AVAIL:-32}
BAKE_MEASURED_NEED=${BAKE_MEASURED_NEED:-43}
BAKE_MEM_MAX=${BAKE_MEM_MAX:-38G}
# [2026-09-14 · r5b 첫 굽기 실측으로 규칙 교체] 「시작 대비 증가 ≥2GiB 연속 3회 → 죽임」이던
#   옛 규칙은 **폐기한다**(2026-09-13 검토관이 「이 2GiB엔 실측 근거가 없다」고 적었던 그 문단은
#   여기서 정리한다). 첫 굽기(2026-09-14 03:25 회전 r5b)가 그 문턱으로 **정상 진행 중(베이스
#   가중치 로드, 시작 75초 경과)인 굽기를 죽였다** — night4.log: 스왑 4G→5G→8G 연속 3회
#   (03:25:54~03:26:24) · 굽기 종료코드 143. r5a(09-12)는 같은 메모리 조건에서 완주했으므로
#   「시작 대비 증가」 자체는 나쁜 신호가 아니다 — 진짜 위험은 **SwapFree가 바닥나 OOM 킬러가
#   교사를 고를 수 있게 되는 것**이다. 그래서 문턱을 절대량으로 바꾼다: SwapFree가
#   SWAP_FREE_MIN_GB(GiB) 밑으로 연속 SWAP_DOG_CONFIRM회면 학습만 내린다.
#   증가량(시작 대비)은 더 이상 죽이는 근거가 아니라 **곡선 기록용**으로만 남긴다(아래 감시견 —
#   정수 GiB 최대치가 갱신될 때만 로그 한 줄, 매 표본 찍지 않는다).
SWAP_FREE_MIN_GB=${SWAP_FREE_MIN_GB:-2}
SWAP_DOG_CONFIRM=${SWAP_DOG_CONFIRM:-3}
# 08:30 데드라인 — 예상 종료 04:45~05:00경이라 여유가 크지만, 낮 서빙을 지키는 마지막 방어선이다.
DEADLINE=${DEADLINE:-08:30}

mkdir -p "$R5"
rm -f "$SWAPDOG_STATE" 2>/dev/null   # 이번 실행 몫만 남긴다(위 SWAPDOG_STATE 주석 참고)
say() { echo "[$(date '+%F %T %Z')] $*" | tee -a "$LOG"; }
# [2026-09-13 · r5b 메모리 대책] 스왑 사용량을 **함께 찍는다**(잣대 단일화) — 32G/43G(위)는 스왑을
#   안 깎은 수라서, 스왑이 나가 있으면 「가용 32G」가 실제로는 그만큼 못한 값일 수 있다. 숫자
#   자체(32→43 등)를 바꾸는 것은 메인/사장님 결정이라 여기서는 **로그에 병기만** 한다.
#   ⚠ 스왑 칸에 "사용"을 다시 쓰지 않는다 — 아래 "굽기 중 최대 사용 메모리" 집계가 낱말 "사용"
#     뒤 필드를 전부 최댓값 후보로 줍는데, 그러면 스왑 값과 뒤섞여 틀린 최댓값을 낼 수 있다.
# [2026-09-14 · r5b 첫 굽기 실측 적발] gb10의 free는 **한국어 로케일**이라 행 이름이
#   「메모리:」·「스  왑:」(스와 왑 사이에 공백 둘 — procps가 CJK 표시폭을 잘못 재 안쪽에 패딩을
#   넣는다)로 나온다. /^스왑|^Swap/ 이 그 행에 안 걸려 swapused가 시종 0으로 찍혔다(2026-09-14
#   03:25 r5b: night4.log는 스왑 증가를 봤는데 같은 시간 r5b-bake-mem.log의 스왑 칸은 매 표본
#   0G, 끝 요약도 값이 비었다). **행 이름을 로케일에 안 매이게 고정**한다 — `LC_ALL=C free -g`는
#   항상 "Mem:"·"Swap:"으로 나온다(아래 awk 패턴은 그대로 둔다 — Swap 쪽 alternation이 걸린다).
#   출력 형식("총 %sG 사용 %sG 가용 %sG · 스왑 %sG")도 바꾸지 않는다 — 끝 요약의 "굽기 중 최대
#   스왑" awk(낱말 "스왑" 뒤 필드)가 이 형식 그대로에 걸린다.
mem() {
  LC_ALL=C free -g | awk '
    /^메모리|^Mem/ { total=$2; used=$3; avail=$7 }
    /^스왑|^Swap/ { swapused=$3 }
    END { printf "총 %sG 사용 %sG 가용 %sG · 스왑 %sG", total, used, avail, swapused+0 }
  '
}
teacher() { curl -s -m 5 http://127.0.0.1:8080/health || echo "(응답 없음)"; }

say "════ 회전 5 $ROUND 본 굽기 시작 ════"
say "산출 로그: $BAKELOG · 메모리 로그: $MEMLOG · 어댑터: $BAKE_OUT"
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
# ⚠ 판정은 **이번에 쓰는 깃발 전부**를 본다(2026-09-11 검토관 적발). --precision 하나만 보면
#   나머지 셋이 없는 학습기를 골라 03:25에 argparse 오류로 즉사하고 아침까지 아무도 모른다.
FT=$SERVER/scripts/finetune_qlora14b.py
# ⚠ [2026-09-13 · 검토관 적발] 목록은 **이번에 실제로 넘기는 깃발만** 담는다. --gpu-mem-fraction을
#   무조건 넣어 두면, 그 깃발을 안 쓰는 밤(기본값)에도 검사가 걸려 사본으로 내려간다 — 그 사본에는
#   이번 대책의 GPU 계측이 없어서 「대책을 넣고 구웠다」로 읽히는데 계측은 0줄인 밤이 된다.
FTFLAGS="--precision --lora-alpha-mult --save-epochs --eval-file --lora-targets --max-seq"
[ -z "$GPUMEMFRAC" ] || FTFLAGS="$FTFLAGS --gpu-mem-fraction"
FTMISS=""
FTMISS2=""   # ⚠ set -u — 사본 검사를 안 탄 밤에도 이름이 있어야 한다
for f in $FTFLAGS; do
  grep -q -- "\"$f\"" "$FT" 2>/dev/null || FTMISS="$FTMISS $f"
done
if [ -n "$FTMISS" ]; then
  say "저장소 학습기에 깃발이 없다($FTMISS · 아직 push 전) — 사본을 쓴다: $R5/finetune_qlora14b.py"
  FT=$R5/finetune_qlora14b.py
  # ⚠ 사본에도 없으면 argparse가 **그 자리에서** 죽는다 — 새벽에 죽고 아침까지 아무도 모르는
  #   그 실패다. 못 넘길 깃발을 들고 굽지 않는다(fail-closed).
  FTMISS2=""
  for f in $FTFLAGS; do
    grep -q -- "\"$f\"" "$FT" 2>/dev/null || FTMISS2="$FTMISS2 $f"
  done
fi
# 계측이 실제로 남는 학습기인지 **먼저 말한다**(폴백을 정상 출력처럼 다루지 않기 위해).
if grep -q "def gpu_메모리_로그(" "$FT" 2>/dev/null; then
  FTMEAS="있음"
else
  FTMEAS="**없음**(이 학습기는 아직 계측 전이다 — GPU 메모리 기록이 필요하면 push 뒤에 굽는다)"
fi
AVAIL=$(free -g | awk '/^메모리|^Mem/ {print $7}')
BAKE=skip
if [ "$GATE" != "ok" ]; then
  say "굽기 건너뜀 — 등급 관문이 $GATE 다(빨강 재료를 굽지 않는다)"
elif [ -n "$FTMISS2" ]; then
  say "굽기 건너뜀 — 저장소에도 사본에도 깃발이 없다($FTMISS2). 그대로 부르면 argparse가 그 자리에서 죽는다"
elif [ "${AVAIL:-0}" -lt "$BAKE_MIN_AVAIL" ]; then
  # ⚠ 가용 관문 — 없으면 「교사를 안 내린다」가 커널 OOM으로 깨질 수 있다.
  say "굽기 건너뜀 — 가용 메모리 ${AVAIL}G < ${BAKE_MIN_AVAIL}G (bf16 14B는 가중치만 28G다). 교사를 밀 위험이 있다"
else
  say "학습기: $FT · GPU 계측: $FTMEAS"
  # ── 실제로 걸리는 보호를 **먼저 계산하고 그 값을 적는다** ──────────────
  # ⚠ 2026-09-11 검토관 적발: 예전엔 「상한 38G · oom_score_adj=1000」을 **단언**해 놓고
  #   RUNNER 계산은 그 아래에서 했다. 상한이 실제로 걸렸는지가 로그에 한 글자도 안 남아,
  #   아침 판정자가 「보호가 걸린 채 구워졌다」로 읽게 된다(폴백을 정상 출력처럼 다루는 부류).
  # choom = oom_score_adj 를 올려 **커널이 우리를 먼저 고르게** 한다(교사는 780이다).
  # systemd-run --scope MemoryMax = cgroup 상한.
  # ★ [2026-09-13 · r5b 메모리 대책] 「실효는 미검증」은 더 이상 맞는 말이 아니다 — **실측으로
  #   확정됐다**(2026-09-12 gb10): 전체 프로세스 RSS 합 18.8GiB인데 `free`의 used는 77.2GiB —
  #   약 58GiB가 어느 프로세스 RSS에도 안 잡히는 CUDA 드라이버(통합메모리) 할당이었다. 이 상한이
  #   실제로 cgroup에 청구한 최대치는 user@1000.service memory.peak 26.3GiB로 38G 근처에도 못 갔다
  #   (교사 llama-server VmRSS도 84GB 모델을 얹고 16.5GiB뿐이었다 — 같은 이유). 즉 **cgroup
  #   MemoryMax는 통합메모리 GPU 할당을 원리상 못 본다(memcg 밖)** — 상한은 남겨 두되(해될 것은
  #   없다) 효과가 있다고 적지 않는다. 최후 방어는 choom과 아래 감시견들이다.
  RUNNER=""
  if command -v systemd-run > /dev/null 2>&1; then
    RUNNER="systemd-run --user --scope -q -p MemoryMax=$BAKE_MEM_MAX --"
    GUARD="cgroup 상한 $BAKE_MEM_MAX 지정(실효 없음 — 통합메모리 GPU 할당은 memcg 밖이다. 2026-09-12 실측: 전체 RSS 18.8GiB vs used 77.2GiB · user@1000.service memory.peak 26.3GiB<38G — 최후 방어는 choom과 감시견이다)"
  else
    GUARD="cgroup 상한 **미적용**(systemd-run 없음) — 최후 방어는 choom과 감시견이다"
  fi
  if command -v choom > /dev/null 2>&1; then
    RUNNER="$RUNNER choom -n 1000 --"
    GUARD="$GUARD · oom_score_adj=1000(커널이 우리를 먼저 고른다)"
  else
    GUARD="$GUARD · oom_score_adj **미적용**(choom 없음)"
  fi
  [ -n "$RUNNER" ] || GUARD="상한·우선순위 **둘 다 미적용** — 가용 관문과 감시견만 걸린 상태"
  # ⚠ [2026-09-13 · 검토관 적발] 이번에 생긴 보호 둘도 **같은 줄에 적는다.** 기본은 꺼짐이라
  #   오늘은 안 붙지만, 계측 뒤 상한을 켜고 굽는 밤이 오면 「무엇이 걸린 채 구워졌나」가 다시
  #   이 한 줄에서 빠진다 — 그 한 줄을 정직하게 만들려고 고친 자리다(2026-09-11).
  [ -z "$GPUMEMFRAC" ] || GUARD="$GUARD · 토치 상한 $GPUMEMFRAC(--gpu-mem-fraction · 이 프로세스 몫)"
  [ -z "$ALLOC_CONF" ] || GUARD="$GUARD · PYTORCH_CUDA_ALLOC_CONF=$ALLOC_CONF"
  say "굽기 시작 — precision=$PRECISION · lora_targets=$LORA_TARGETS · rank16 · lr1e-4 · 2에폭 · max_seq=$MAXSEQ · lora-alpha-mult 1 · 가용 ${AVAIL}G"
  say "걸린 보호: $GUARD"
  if [ "${AVAIL:-0}" -lt "$BAKE_MEASURED_NEED" ]; then
    say "⚠ 가용 ${AVAIL}G < 실측 필요량 ${BAKE_MEASURED_NEED}G — 관문(${BAKE_MIN_AVAIL}G)은 지났지만 OOM 여지가 있다"
  fi
  say "예상 스텝 52(26/에폭) · 예상 65~95분(어젯밤 0.362 샘플/초 × 824샘플 + 에폭마다 평가 98행) · 데드라인 $DEADLINE(그때까지 살아 있으면 학습만 죽인다)"
  # 메모리 로거 주기는 prep과 같은 5초로 되돌린다(30초로 두면 짧은 최대치를 놓친다 — 검토관 적발).
  ( while true; do echo "[$(date '+%T')] $(mem)"; sleep 5; done ) > "$MEMLOG" 2>&1 &
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
  # [2026-09-14 · r5b 첫 굽기 실측으로 규칙 교체] 스왑 감시견 — cgroup이 못 보는 것을 **유일하게
  #   보는 자리**다. 옛 규칙(시작 대비 증가 ≥2GiB 연속 3회 → 죽임)은 **가중치 로드 중이던 정상
  #   굽기를 시작 75초 만에 죽였다**(2026-09-14 03:25 회전 r5b: night4.log 「스왑 4G→5G→8G
  #   연속 3회」·굽기 종료코드 143 — 같은 시간 r5b-bake-mem.log는 스왑 0G만 찍어 원인을 못
  #   남겼다, 그 원인이 위 mem() 로케일 수리다). r5a는 같은 메모리 조건에서 완주했으니 증가량
  #   자체는 위험 신호가 아니다. 새 문턱은 **SwapFree 절대 수준**이다 — SwapFree가
  #   SWAP_FREE_MIN_GB(GiB) 밑으로 연속 SWAP_DOG_CONFIRM회면(OOM 킬러가 교사를 고를 수 있는
  #   진짜 위험) **학습만** 내린다.
  #   ⚠ 이름으로 죽이지 않는다 — `pkill -f llama-server`는 교사(8080)·임베딩(8081)까지 함께 죽인다.
  #   ⚠ 한 표본으로 죽이지 않는다 — 연속 $SWAP_DOG_CONFIRM회(15초 간격)를 봐야 내린다.
  #   증가량(시작 대비 DROP)은 더 이상 죽이는 근거가 아니라 **곡선 기록용**으로만 남긴다 —
  #   정수 GiB 최대치가 갱신될 때만 로그 한 줄(매 표본 안 찍는다). 두 값(최대 증가·SwapFree
  #   최저)은 $SWAPDOG_STATE에 갱신해 둔다 — 이 감시견은 서브셸이라 그 안 변수를 끝 요약(밖)이
  #   못 읽기 때문이다.
  SWAP_BASE_KB=$(awk '/^SwapFree:/{print $2}' /proc/meminfo 2>/dev/null)
  SWAP_BASE_KB=${SWAP_BASE_KB:-0}
  ( SWAP_HITS=0
    DROP_MAX_GB=0
    FREE_MIN_GB=
    while true; do
      sleep 15
      SWAP_NOW_KB=$(awk '/^SwapFree:/{print $2}' /proc/meminfo 2>/dev/null)
      SWAP_NOW_KB=${SWAP_NOW_KB:-$SWAP_BASE_KB}
      FREE_NOW_GB=$(( SWAP_NOW_KB / 1024 / 1024 ))
      DROP_GB=$(( (SWAP_BASE_KB - SWAP_NOW_KB) / 1024 / 1024 ))
      [ "$DROP_GB" -lt 0 ] && DROP_GB=0
      if [ "$DROP_GB" -gt "$DROP_MAX_GB" ]; then
        DROP_MAX_GB=$DROP_GB
        echo "[$(date '+%F %T %Z')] 스왑 증가 최대 ${DROP_MAX_GB}G(시작 대비, SwapFree 기준) — 기록만" >> "$LOG"
      fi
      if [ -z "$FREE_MIN_GB" ] || [ "$FREE_NOW_GB" -lt "$FREE_MIN_GB" ]; then
        FREE_MIN_GB=$FREE_NOW_GB
      fi
      { echo "swap_drop_max_gb=$DROP_MAX_GB"; echo "swap_free_min_gb=$FREE_MIN_GB"; } > "$SWAPDOG_STATE"
      if [ "$FREE_NOW_GB" -lt "$SWAP_FREE_MIN_GB" ]; then
        SWAP_HITS=$((SWAP_HITS + 1))
        if [ "$SWAP_HITS" -lt "$SWAP_DOG_CONFIRM" ]; then
          echo "[$(date '+%F %T %Z')] ⚠ SwapFree ${FREE_NOW_GB}G < ${SWAP_FREE_MIN_GB}G — ${SWAP_HITS}/${SWAP_DOG_CONFIRM}회째, 아직 안 내린다(연속이라야 내린다)" >> "$LOG"
        else
          echo "[$(date '+%F %T %Z')] ⚠ SwapFree ${FREE_NOW_GB}G < ${SWAP_FREE_MIN_GB}G가 연속 ${SWAP_DOG_CONFIRM}회 — 스왑 고갈 임박(OOM 위험)으로 보고 학습만 내린다" >> "$LOG"
          pkill -f "finetune_qlora14b.py" 2>/dev/null
          break
        fi
      else
        SWAP_HITS=0
      fi
      pgrep -f "finetune_qlora14b.py" > /dev/null 2>&1 || break
    done ) > /dev/null 2>&1 &
  SWAPDOGPID=$!
  cd "$SERVER" || exit 1
  # ⚠ 아래 $RUNNER 는 위에서 이미 계산됐다(로그에 적힌 「걸린 보호」가 여기서 실제로 걸리는 것이다).
  #   학습은 이 --scope 때문에 **서비스와 다른 유닛**에서 돈다 — 되돌릴 땐 머리글의 순서를 지킬 것.
  # ⚠ [2026-09-13 · r5b 메모리 대책] GPUMEMFRAC·ALLOC_CONF는 **기본이 비어 있다** — 그때는 아래
  #   ${..:+..} 확장이 통째로 사라져 이 명령은 r5a가 낸 것과 **바이트 단위로 같다**(bash -x dry로
  #   대조할 것). 값을 주면 그 한 줄만 늘어난다.
  #   ⚠ `VAR="$X"`가 아니라 `env VAR="$X"`를 쓴다 — `${ALLOC_CONF:+VAR="$ALLOC_CONF"}`처럼 파라미터
  #     확장으로 **만들어진** "NAME=value" 낱말은 쉘이 환경변수 대입으로 안 읽는다(그 인식은
  #     문법상 리터럴 대입에서만 걸린다) — 대신 명령으로 취급해 "command not found"로 죽는다
  #     (2026-09-13 실측: 더미 값으로 dry 대조하다 걸렸다). `env`는 그 낱말을 **제 인자로** 받아
  #     스스로 자식 환경에 심으므로 쉘의 그 제약을 안 탄다.
  GIJO_FT_BASE_MODEL=${GIJO_FT_BASE_MODEL:-Qwen/Qwen3-14B} \
    ${ALLOC_CONF:+env PYTORCH_CUDA_ALLOC_CONF="$ALLOC_CONF"} \
    $RUNNER "$VENV/bin/python" "$FT" --dataset "$DATASET" --output "$BAKE_OUT" \
    --base-model "${GIJO_FT_BASE_MODEL:-Qwen/Qwen3-14B}" \
    --precision "$PRECISION" --lora-targets "$LORA_TARGETS" --rank 16 --lr 0.0001 --epochs 2 --max-seq "$MAXSEQ" \
    --lora-alpha-mult 1 --save-epochs --eval-file "$HOLDOUT" \
    ${GPUMEMFRAC:+--gpu-mem-fraction "$GPUMEMFRAC"} \
    > "$BAKELOG" 2>&1
  BAKE=$?
  kill "$MEMPID" "$DOGPID" "$DEADLINEPID" "$SWAPDOGPID" 2>/dev/null
  say "굽기 종료코드 $BAKE · 마지막 줄: $(tail -5 "$BAKELOG" | tr '\n' ' ' | cut -c1-400)"
  say "굽기 중 최대 사용 메모리: $(awk '{for(i=1;i<=NF;i++) if($i=="사용") {gsub("G","",$(i+1)); if($(i+1)+0>m) m=$(i+1)+0}} END{print m"G"}' "$MEMLOG")"
  # 스왑 최대치도 나란히 적는다 — 「가용 32G/43G」가 스왑을 안 깎은 수라는 사실이 로그에 남는다.
  say "굽기 중 최대 스왑: $(awk '{for(i=1;i<=NF;i++) if($i=="스왑") {gsub("G","",$(i+1)); if($(i+1)+0>m) m=$(i+1)+0}} END{print m"G"}' "$MEMLOG")"
  say "교사 health(굽기 직후): $(teacher)"
fi

# ── 끝 상태 ───────────────────────────────────────────────────────────────
say "교사(8080) health: $(teacher)  ·  임베딩(8081): $(curl -s -m 5 http://127.0.0.1:8081/health || echo '(응답 없음)')"
say "메모리: $(mem)"
# [2026-09-14 · r5b 첫 굽기] 스왑 감시견의 두 값을 상태 파일에서 읽는다(감시견은 서브셸이라
#   그 안 변수를 여기서 직접 못 읽는다 — 위 SWAPDOG_STATE 주석 참고). 파일이 없으면(굽지 않은
#   밤, 또는 감시견이 한 번도 못 돈 밤) 「?」로 적는다 — 못 잰 것을 0으로 적으면 거짓이다.
if [ -f "$SWAPDOG_STATE" ]; then
  SWAPDROP=$(awk -F= '/^swap_drop_max_gb=/{print $2}' "$SWAPDOG_STATE")
  SWAPFREEMIN=$(awk -F= '/^swap_free_min_gb=/{print $2}' "$SWAPDOG_STATE")
fi
SWAPDROP=${SWAPDROP:-?}
SWAPFREEMIN=${SWAPFREEMIN:-?}
say "요약 — 회전=$ROUND · 등급관문=${GATE:-미실행} · 굽기종료코드=$BAKE · 재료=$DATASET · 어댑터=$BAKE_OUT · 걸린보호=${GUARD:-굽지 않음} · 최대 스왑 증가 ${SWAPDROP}G · SwapFree 최저 ${SWAPFREEMIN}G"
say "════ 회전 5 $ROUND 본 굽기 끝 ════"
