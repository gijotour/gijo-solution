#!/bin/bash
# tools/ladder/day1-distill.sh — 사다리 1일차: **재료 확장(증류)**. 회차 목록대로 교사를 돌려 후보를 쌓고,
#   회차마다 결과를 **번호가 붙은 파일**로 남긴 뒤 자동 승인까지 간다(계획서 §12).
#
# ⚠ 변수·함수 이름은 영문만(bash 제약). 주석은 한글로, 왜를 적는다.
#
# 사용:
#   export GIJO_ADMIN_USER=… GIJO_ADMIN_PASSWORD=… GIJO_SERVE_TOKEN=…
#   bash tools/ladder/day1-distill.sh [--config tools/ladder/day1-topics.json]
#        [--only 취약점,일반] [--skip-done] [--no-approve] [--dry-run]
#        [--endpoint http://10.8.0.12:4000/api/llm/serve/v1] [--server http://localhost:4000]
#
#   --skip-done : 그 주제의 회차 파일이 **이미 있으면 건너뛴다**. 밤새 돌다 끊겼을 때 이어서 돌리는 길이다
#                 (밤/낮 전환을 산출물 **존재**로 가른다 — 로그를 사람이 뒤지지 않게).
#   --dry-run   : 재료 셈·허용목록 검사까지만 하고 교사를 부르지 않는다.
#
# 나가는 코드: 0=끝 · 3=env 없음 · 4=교사 느림 · 5=회차 하한 미달(멈춤) · 6=쓰는 법/설정 틀림
#              130/143=사람이 끊음(Ctrl+C / 종료 신호) — 그때도 로그를 `.failed.log`로 옮기고 나간다
#
# ■ 왜 회차에 번호를 붙이나
#   증류 보고서 이름이 **시각 기반**(`.tmp-reports/distill-<주제>-<시각>.json`)이라 파일만 봐서는
#   「이 주제를 이미 했나·몇 번째인가」를 못 가린다. 게다가 .tmp-reports는 .gitignore라 사라진다.
#   그래서 회차마다 `results-ladder/day1/<주제>-<번호>.json`으로 **복사해 남긴다** — 번호는
#   디렉터리 상태만으로 결정되므로 다시 돌려도 앞 회차를 덮지 않는다(ladderlib.mjs 회차이름표).
#
# ■ 끝난 회차의 증거는 **보고서(.json) 하나뿐**이다 (2026-09-03 1일차 실기동에서 데인 자리)
#   로그(`<주제>-<번호>.log`)는 증류가 **시작될 때** 생기고 보고서는 **끝나야** 생긴다. 예전 회차
#   셈은 확장자를 안 가려서 `사내규정-01.log`를 회차 1로 셌고, 그래서 **죽은 회차를 --skip-done이
#   영영 건너뛰었다**(그날은 사람이 로그 이름을 손으로 바꿔 피했다). 이제 셈은 .json만 세고
#   (ladderlib.mjs 회차번호), 실패·중단한 회차의 로그는 여기서 `<주제>-<번호>.failed.log`로 옮긴다 —
#   점이 둘인 이름은 어떤 셈에도 안 걸리고, 사람이 폴더만 봐도 「이 회차는 죽었다」가 보인다.
#
# ■ 왜 중간에 멈추나
#   밤새 도는 일은 **잘못된 채로 계속 도는 것**이 가장 비싸다. 편입률이 바닥이면 재료나 프롬프트가
#   틀린 것이라, 그 상태로 다음 주제를 태우면 GPU 시간만 사라진다. 첫 회차에서 멈추고 아침에 본다.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/ladder/common.sh
. "$HERE/common.sh"
REPO="$(ladder_repo)"

CONFIG="$HERE/day1-topics.json"
ONLY=""
SKIP_DONE=0
NO_APPROVE=0
DRY=0
ENDPOINT="${LADDER_ENDPOINT}"
SERVER="${GIJO_SERVER_URL:-http://localhost:4000}"
# 하한 — 이 밑이면 멈춘다. 왜 60%인가: 첫 운영 증류 실측에서 프롬프트가 맞을 때 편입률이 60~80%였다.
# 그 밑은 「교사가 규칙을 못 지키고 있다」는 신호라, 더 태우기 전에 사람이 볼 자리다.
MIN_ACCEPT_PCT="${LADDER_MIN_ACCEPT_PCT:-60}"
# 오류 상한 — 조각 하나가 실패하는 것은 흔하지만, 무더기면 창구·토큰·문맥이 문제다.
MAX_ERRORS="${LADDER_MAX_ERRORS:-10}"
# 승인 상한(한 번 부를 때). 승인은 되돌리기 어렵다 — 👍 기록 **그리고** 그 주제 지식영역에 문서로 반입된다
# (approve-distill.mjs 머리 주석). 지금까지 이 자리에서 --max 를 안 줘서 기본값 100000, 곧 사실상 무제한이었다.
# ⚠ 이것은 **한 번 부를 때의 상한**이지 하루 총량 장부가 아니다 — 같은 주제가 두 회차면 최대 두 배까지 승인된다.
APPROVE_MAX="${LADDER_APPROVE_MAX:-900}"
# 교사 동시 요청 수 — **2를 유지한다**(distill.mjs 기본과 같다). 한 번 1로 내렸다가 실측으로 되돌렸다:
#   · 2: 5조각 6분22초 = 조각당 76초 (kev·attack 두 번 같은 값, 2026-09-03)
#   · 1: 같은 크기가 10분에도 안 끝났다 = 조각당 120초 초과 → **1이 더 느리다**
# ⚠ 잣대 「1.6 이상이면 2」는 **실작업 자**(교사시간합 ÷ 벽시계, 클수록 병렬 · 작업자 2면 상한 2.00) 기준이다.
#   2026-09-03 실측 = **1.99** → 2 유지. 값은 회차 보고서의 teacherMs와 그 회차 벽시계로 바로 나온다.
#   프로브 자(벽시계 ÷ 순차합, **작을수록** 병렬)로는 0.655·0.915(속도 1.27배)였다 — 96토큰짜리 짧은
#   요청이라 겹치는 구간이 짧고 표본이 둘뿐이라 흔들린다. **두 자는 방향이 반대다. 섞어 읽지 말 것.**
# 예전에 적혀 있던 「병렬 비율 1.00(=직렬)」은 **남의 부하가 섞인 오염된 측정**이었다(README 「교사 병렬」).
#   교사 8080은 공용이라, 남이 슬롯을 물고 있는 동안 재면 그 사람의 부하를 잰다.
CONCURRENCY="${LADDER_CONCURRENCY:-2}"

while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --skip-done) SKIP_DONE=1; shift ;;
    --no-approve) NO_APPROVE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    *) echo "모르는 인자: $1" >&2; exit 6 ;;
  esac
done

[ -s "$CONFIG" ] || { echo "✗ 설정 파일 없음: $CONFIG" >&2; exit 6; }

OUTDIR="$REPO/tools/team-bench/results-ladder/day1"
mkdir -p "$OUTDIR"

# ── 실패·중단한 회차의 로그 이름 바꾸기 ────────────────────────────────
# LABEL·LOG 은 회차마다 채워지고, 회차가 **성공으로 끝나면 다시 비운다**. 안 비우면 다음 회차 준비
#   중에 Ctrl+C가 들어왔을 때 트랩이 **앞 회차의 성공 로그**를 실패로 바꿔 버린다.
LABEL=""
LOG=""
# ladder_round_failed <사람이 읽을 사유> — 지금 회차 로그를 `<주제>-<번호>.failed.log`로 옮기고 사유를 찍는다.
# ⚠ 회차 셈은 보고서(.json)만 세므로(ladderlib.mjs 회차번호) 이름 바꾸기는 셈을 바꾸지 않는다.
#   이건 **사람을 위한 표식**이다 — 폴더를 열었을 때 어느 회차가 죽었는지 이름에서 바로 보이게.
ladder_round_failed() {
  local why="$1" dead=""
  if [ -n "$LOG" ] && [ -f "$LOG" ]; then
    dead="${LOG%.log}.failed.log"
    mv -f "$LOG" "$dead" 2>/dev/null || dead="$LOG"   # 못 옮겨도 사슬을 더 망가뜨리지 않는다 — 원래 이름을 말한다
    LOG=""
  fi
  echo "✗ $why" >&2
  [ -n "$dead" ] && echo "  로그: $dead (실패·중단 표식. 회차 셈은 보고서 .json 만 센다 — 이 회차는 다시 돌면 같은 번호를 다시 시도한다)" >&2
  return 0
}
# 사람이 끊거나(Ctrl+C) 밖에서 죽일 때도 표식을 남긴다 — 밤새 도는 일이라 끊긴 자리가 아침에 보여야 한다.
trap 'ladder_round_failed "${LABEL:-회차} — 사람이 끊었다(SIGINT)."; exit 130' INT
trap 'ladder_round_failed "${LABEL:-회차} — 종료 신호를 받았다(SIGTERM)."; exit 143' TERM

ladder_log "1일차 증류 — 설정 $CONFIG · 창구 $ENDPOINT · 결과 $OUTDIR"

# ── 준비: 비밀값과 교사 상태 ──────────────────────────────────────────
if [ "$DRY" -eq 0 ]; then
  # ⚠ 편입·승인은 admin 로그인이 필요하다. 값은 안 찍는다 — 있는지만 본다.
  ladder_need_env GIJO_ADMIN_USER GIJO_ADMIN_PASSWORD GIJO_SERVE_TOKEN
  LADDER_ENDPOINT="$ENDPOINT" ladder_teacher_tps
fi

# ── 회차 목록 읽기 ────────────────────────────────────────────────────
# 설정 → 「주제<탭>인자들」 한 줄씩. 인자 번역은 여기 한 곳에서만 한다.
ROUNDS="$(node -e '
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const only = (process.argv[2] || "").split(",").map(s => s.trim()).filter(Boolean);
// 같은 주제가 여러 회차일 수 있다(취약점 = 저장소 + 공개 원천). 주제 안에서 **몇 번째**인지를 함께 준다 —
//   --skip-done 이 「주제 파일이 하나라도 있으면 건너뛴다」였는데, 그러면 2번째 회차가 영영 안 돈다.
const 회차수 = new Map();
for (const r of cfg.회차 ?? []) {
  if (r.끔) continue;                                  // 설정에서 꺼 둔 회차는 조용히 건너뛴다(이유는 설정의 왜에 적혀 있다)
  if (only.length && !only.includes(r.topic)) continue;
  const a = ["--topic", r.topic];
  if (r.source) a.push("--source", r.source);
  if (r.files) a.push("--files", r.files);
  if (r.limit) a.push("--limit", String(r.limit));
  if (r.perChunk) a.push("--per-chunk", String(r.perChunk));
  if (r.srcLang) a.push("--src-lang", r.srcLang);
  if (r.noTopicFilter) a.push("--no-topic-filter");
  const 순번 = (회차수.get(r.topic) ?? 0) + 1;
  회차수.set(r.topic, 순번);
  // 값에 공백이 든 인자는 없다(주제·경로 패턴 모두 공백 없이 쓴다) — 탭으로만 가른다.
  // ⚠ 빈 칸을 빈 문자열로 두면 안 된다: 탭은 bash의 **IFS 공백**이라 `read`가 연속된 탭을 하나로 뭉치고
  //   빈 칸을 통째로 없앤다. 그러면 store 회차(files 없음)에서 뒤 칸이 앞으로 밀려 **순번 "1"이 재료 목록으로**
  //   읽히고, 허용목록 검사가 「1 — 재료가 아니다」로 사슬을 죽인다(2026-09-03 실기동에서 그렇게 죽었다).
  //   그래서 없음을 "-" 로 적어 칸을 채운다. 받는 쪽이 "-" 를 없음으로 되돌린다.
  console.log(r.topic + "\t" + a.join(" ") + "\t" + (r.files || "-") + "\t" + 순번);
}
' "$CONFIG" "$ONLY")" || { echo "✗ 설정을 못 읽었다: $CONFIG" >&2; exit 6; }

[ -n "$ROUNDS" ] || { echo "✗ 돌릴 회차가 없다(--only 가 너무 좁거나 전부 꺼져 있다)" >&2; exit 6; }

# ── 회차별 실행 ───────────────────────────────────────────────────────
while IFS=$'\t' read -r TOPIC ARGS FILESPEC ORD; do
  [ -n "$TOPIC" ] || continue
  ORD="${ORD:-1}"   # 설정 읽기가 순번을 못 준 경우(옛 설정) 1로 본다
  [ "$FILESPEC" = "-" ] && FILESPEC=""   # "-"는 「재료 파일 없음」(store 회차) — 위 emitter의 짝

  # ── 재료 허용 검사 ───────────────────────────────────────────────────
  # 무엇을 학습 재료로 써도 되는지는 allowed-sources.json 한 곳이 정한다. 여기서 미리 걸러,
  # 허용목록 밖 문서를 밤새 태우고 아침에 되돌리는 일을 막는다.
  # ⚠ source=store 는 조각이 **운영 저장소**에서 오므로 여기서 못 가린다 — distill.mjs의
  #   업무영역 선별과 서버 편입 위생이 그 자리를 맡는다(이 스크립트가 그 척을 하지 않는다).
  if [ -n "$FILESPEC" ]; then
    # ⚠ 따옴표를 일부러 뺀다 — `knowledge/*.md` 같은 패턴을 셸이 **실제 파일로 펼쳐** 준다.
    #   그러면 패턴이 아니라 진짜 파일 하나하나를 검사하게 된다(더 촘촘하다). 맞는 파일이 없으면
    #   bash가 패턴을 그대로 넘기는데, 그때도 매칭 규칙이 패턴을 그대로 받아 판정한다.
    # shellcheck disable=SC2086
    if ! node "$HERE/ladderlib.mjs" allow $(printf '%s' "$FILESPEC" | tr ',' ' '); then
      echo "✗ $TOPIC — 허용목록 밖 재료가 섞였다. tools/ladder/allowed-sources.json 을 보라." >&2
      exit 6
    fi
  fi

  # 회차 이름표 — 디렉터리 상태만으로 결정된다(ladderlib.mjs가 정본. 여기서 따로 세지 않는다).
  LABEL="$(node "$HERE/ladderlib.mjs" label "$TOPIC" "$OUTDIR")"
  [ -n "$LABEL" ] || { echo "✗ 회차 이름표를 못 만들었다($TOPIC)" >&2; exit 6; }

  DEST="$OUTDIR/$LABEL.json"

  # ── 이어 돌리기 ─────────────────────────────────────────────────────
  # ⚠ 예전에는 「그 주제 파일이 하나라도 있으면 건너뛴다」였는데, 한 주제에 회차가 둘이 되면서
  #   (취약점 = 저장소 + 공개 원천) **2번째 회차가 영영 안 도는** 구멍이 됐다. 그래서 개수로 센다:
  #   이미 끝난 회차 수가 이 회차의 순번 이상일 때만 건너뛴다.
  #   센 값은 이름표에서 온다 — 이름표는 회차번호()가 `.approve.json` 같은 곁다리를 이미 걸러 준다
  #   (ls 로 세면 곁다리까지 세어 한 회차를 두 번으로 읽는다).
  DONE_N=$(( 10#${LABEL##*-} - 1 ))
  if [ "$SKIP_DONE" -eq 1 ] && [ "$DONE_N" -ge "$ORD" ]; then
    ladder_log "⏭ $TOPIC 회차 $ORD — 끝난 회차가 이미 ${DONE_N}개라 건너뛴다(--skip-done). 다시 돌리려면 이 옵션을 빼라."
    continue
  fi

  ladder_log "▶ $LABEL — node tools/distill.mjs $ARGS --concurrency $CONCURRENCY --force-login"

  if [ "$DRY" -eq 1 ]; then
    # shellcheck disable=SC2086
    ( cd "$REPO" && node tools/distill.mjs $ARGS --endpoint "$ENDPOINT" --server "$SERVER" --dry-run ) || {
      echo "✗ $LABEL — dry-run 실패" >&2; exit 5; }
    continue
  fi

  LOG="$OUTDIR/$LABEL.log"
  # shellcheck disable=SC2086
  # ⚠ --force-login: 계정당 1세션이라, 앞 회차 승인 단계가 남긴 admin 세션이 살아 있으면 이 로그인이
  #   409(already_logged_in)로 죽는다 — win 4000 실측(2026-09-03: 같은 계정 2차 로그인 = 409).
  #   사슬은 한 줄로 도니 그 앞 세션은 **제 일을 이미 끝낸** 세션이다. 끊고 들어간다.
  ( cd "$REPO" && node tools/distill.mjs $ARGS --endpoint "$ENDPOINT" --server "$SERVER" --concurrency "$CONCURRENCY" --force-login ) 2>&1 | tee "$LOG"
  RC="${PIPESTATUS[0]}"
  if [ "$RC" -ne 0 ]; then
    ladder_round_failed "$LABEL — 증류가 코드 $RC 로 끝났다."
    exit 5
  fi

  # 보고서 자리는 **증류기가 스스로 말한 그 경로**를 쓴다 — mtime으로 짐작하면 동시에 돈 다른 회차를 집는다.
  REPORT="$(sed -n 's/.*보고서 \(.*\)$/\1/p' "$LOG" | tail -1)"
  if [ -z "$REPORT" ] || [ ! -s "$REPORT" ]; then
    ladder_round_failed "$LABEL — 보고서 경로를 로그에서 못 찾았다(증류기 마지막 줄 확인)."
    exit 5
  fi
  cp "$REPORT" "$DEST"
  ladder_log "  보고서 → $DEST (원본 $REPORT — .tmp-reports는 .gitignore라 사라진다)"

  # ── 하한 검사 ───────────────────────────────────────────────────────
  node -e '
    const fs = require("node:fs");
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const minPct = Number(process.argv[2]), maxErr = Number(process.argv[3]);
    const gen = r.generated || 0;
    // 편입을 시도했으면 accepted, --no-intake였으면 사전검사 통과(preChecked)가 그 회차의 수율이다.
    const 편입시도 = r.accepted > 0 || Object.keys(r.rejected || {}).length > 0;
    const 통과 = 편입시도 ? (r.accepted || 0) : (r.preChecked || 0);
    const 이름 = 편입시도 ? "편입" : "사전검사 통과";
    const pct = gen ? (통과 / gen) * 100 : 0;
    const errs = (r.errors || []).length;
    console.log(`  생성 ${gen} · ${이름} ${통과}(${pct.toFixed(0)}%) · 오류 ${errs} · 교사 ${r.teacher ?? "?"} · 교사시간 ${((r.teacherMs||0)/60000).toFixed(1)}분`);
    let 멈춤 = null;
    if (!gen) 멈춤 = "생성 0건 — 재료(조각)가 없거나 교사가 답을 못 만들었다";
    else if (pct < minPct) 멈춤 = `${이름}률 ${pct.toFixed(0)}% < 하한 ${minPct}% — 재료나 프롬프트가 틀렸다`;
    else if (errs > maxErr) 멈춤 = `오류 ${errs}건 > 상한 ${maxErr}건 — 창구·토큰·문맥을 먼저 본다`;
    if (멈춤) { console.error(`✗ ${멈춤}`); console.error("  더 태우기 전에 멈춘다 — 잘못된 채로 밤새 도는 것이 가장 비싸다."); process.exit(1); }
  ' "$DEST" "$MIN_ACCEPT_PCT" "$MAX_ERRORS" || { ladder_round_failed "$LABEL — 하한 검사에 걸려 멈춘다(사유는 바로 위 줄)."; exit 5; }

  # ── 자동 승인(증류분만) ─────────────────────────────────────────────
  if [ "$NO_APPROVE" -eq 1 ]; then
    ladder_log "  (승인 생략 — --no-approve)"
  elif [ -s "$REPO/tools/approve-distill.mjs" ]; then
    ladder_log "  승인 — node tools/approve-distill.mjs --topic $TOPIC --max $APPROVE_MAX --force-login"
    # ⚠ --force-login: 방금 끝난 증류의 admin 세션이 아직 살아 있어 그냥 로그인하면 409다(위와 같은 자리).
    #   끊는 대상은 **방금 제 일을 끝낸 그 세션**이다.
    ( cd "$REPO" && node tools/approve-distill.mjs --topic "$TOPIC" --max "$APPROVE_MAX" --force-login --out ) \
      > "$OUTDIR/$LABEL.approve.json" || { ladder_round_failed "$LABEL — 승인 실패(결과: $OUTDIR/$LABEL.approve.json)"; exit 5; }
    ladder_log "  승인 결과 → $OUTDIR/$LABEL.approve.json"
  else
    # ⚠ 이 도구는 다른 갈래가 만든다. 없으면 **조용히 지나가지 않는다** — 승인이 안 된 후보는
    #   RAFT 빌더의 재료가 못 되므로, 2일차가 「행 0건」으로 죽는다. 그 자리를 여기서 말해 둔다.
    ladder_log "  ⚠ tools/approve-distill.mjs 가 아직 없다 — 승인 자리를 건너뛴다."
    ladder_log "    승인 없이는 2일차 RAFT 빌더가 재료를 못 찾는다(승인 👍 문답만 학습 행이 된다)."
  fi

  # 이 회차는 끝까지 갔다 — 표식을 비운다. 안 비우면 **다음 회차 준비 중**에 Ctrl+C가 들어왔을 때
  #   트랩이 방금 성공한 이 회차의 로그를 `.failed.log`로 바꿔 거짓 표식을 남긴다.
  LOG=""
  LABEL=""
done <<< "$ROUNDS"

ladder_log "1일차 끝 — 회차 파일: $OUTDIR"
ladder_log "다음: bash tools/ladder/day2-train.sh --round <rounds.json의 id>"
