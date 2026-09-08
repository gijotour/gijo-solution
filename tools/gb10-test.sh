#!/bin/bash
# tools/gb10-test.sh — **서버 시험을 gb10에서, 매번 새로 뜬 깨끗한 사본으로 돌린다.**
#
# ⚠ 변수명은 영문만 — bash는 한글 변수명을 못 읽는다(wsl-test.sh가 2026-08-10에 밟은 자리).
#
# ■ 왜 (사장님 2026-09-03 「실행은 gb10도 같이 최대한」)
#   win은 시험을 못 돈다(Windows 호스트 = 한 파일에 14분). 그래서 지금까지 WSL 하나뿐이었는데,
#   gb10에는 이미 같은 저장소·같은 node_modules가 있다. **놀려 두느니 시험을 돌린다.**
#   실측(2026-09-03, Opus가 손으로 한 절차): 사본 만들기 포함 **17초**에 전체가 끝났다.
#
# ■ 왜 하필 「깨끗한 사본」인가 — WSL 사본이 원리상 못 잡는 부류가 있다
#   시험이 **운영 트리에 이미 있는 부산물**(server/data/ 같은)에 몰래 기대고 있어도,
#   그 부산물이 있는 곳에서 돌리면 늘 초록이다. 그건 「고객이 새로 깐 기계에서 죽는 시험」이다.
#   실제로 2026-09-03 이 도구의 첫 실행이 watchfolder 시험 하나를 그렇게 잡아냈다
#   (server/data/가 없으면 「순환 거부」가 아니라 「경로 없음」으로 떨어졌다).
#   → 그러므로 이 사본은 **일부러 비어 있는 곳**(/tmp)에서 시작한다. 재사용하지 않는다.
#
# ■ 불가침 — gb10이 상시 쓰는 것을 건드리지 않는다
#   · 포트 **8080**(llama-server 채팅) · **8081**(임베딩 상주) · **4000**(GIJO AS 서버).
#     이 스크립트는 서버를 띄우지도 죽이지도 않는다. vitest.config가 LLM URL을
#     59999/59998(아무도 안 듣는 포트)로 못박아 두어 시험이 실모델에 붙을 길 자체가 없다.
#   · 원본 `~/gijo-as/data/`(운영 DB·문서)는 **읽지도 쓰지도 않는다**. 사본은 소스·시험만 가져간다.
#   · node_modules만 원본 것을 심볼릭 링크로 **빌려 읽는다**(수 GB를 매번 복사하지 않으려고).
#
# ■ ★ **사내 문서 본문은 이 기계 밖으로 내보내지 않는다**(2026-09-08 신설)
#   여기는 win이 아니라 **원격 기계(gb10 · 10.8.0.12 · 별도 계정 gijohn_llm)**다. 그래서
#   이 도구가 옮기는 것은 **코드·시험·설정뿐**이고, 사람이 쓴 문서의 본문은 옮기지 않는다.
#   실전 답 기록(.tmp-reports/ops-sim.json)이 그 경계에 걸렸다 — **2026-09-08부터 그 파일에
#   「가드가 본 근거 조각 본문」이 실리기 때문**이다. 하네스 계정 claude-deploy는 admin이라
#   등급 C 문서(운영 1,598건)의 조각까지 담긴다. 시험 하나 초록 만들자고 사내 문서를 다른
#   기계에 복제할 수는 없어, 아래 사본 만들기에서 그 두 줄을 **뺐다**(자세한 왜는 그 자리에).
#   ★ 형제 도구 wsl-test.sh는 **그대로 옮긴다** — 거기는 같은 기계의 WSL이라 경계를 안 넘는다.
#     실전 답을 재료로 쓰는 시험을 진짜로 재려면 그쪽으로 간다.
#
# ■ ★ 커밋이 다르면 **멈춘다**(2026-09-06 실사고)
#   gb10은 win이 `git push gb10 main`으로 밀어 줘야 갱신된다(GB10에서 pull하지 않는다).
#   밀기를 잊으면 gb10에는 **옛 코드**가 있는데, 예전 이 스크립트는 「⚠ 다릅니다 … (그대로
#   진행합니다)」라고 한 줄 찍고 그냥 돌렸다. 그러면 방금 고친 것을 안 담은 판이 초록으로 나오고,
#   사람은 그 초록을 자기 수정의 증거로 읽는다 — **거짓 초록**이다. 실제로 그날 그렇게 났다.
#   → 이제 다르면 exit 2로 멈추고 「git push gb10 main 먼저」를 안내한다.
#   → 일부러 다른 판을 재려면(옛 판 재현·회귀 대조) `--allow-mismatch`를 붙인다. 그때는 무엇을
#     재는지 사람이 뜻을 밝힌 것이므로 경고만 하고 진행한다.
#   ⚠ git 조회 자체가 실패해도 멈춘다 — 「맞는지 모르겠다」는 「맞다」가 아니다. 예전엔 실패를
#     2>/dev/null로 삼켜 「(git 조회 실패)」 한 줄만 남고 **왜 실패했는지**가 사라졌다.
#
# ■ ★ **커밋 안 한 수정이 있어도 멈춘다**(2026-09-06 검토관 적발 — 위 관문의 빈자리였다)
#   커밋만 맞춰 보면, 커밋 전에 편집해 둔 것이 있을 때 해시는 같고 코드는 다르다. 이 저장소의
#   실제 순서가 「편집 → 시험 → 커밋」이라 **그게 흔한 쪽**이다. 그래서 사본이 가져가는 자리
#   (server/ client/ tools/ knowledge/ mockups/ · 뿌리 *.md)에 미커밋 수정이 있으면 멈춘다.
#   ★ 헷갈리기 쉬운 대비: **wsl-test.sh는 살아 있는 트리를 재고, 이 도구는 커밋된 판을 잰다.**
#     미커밋 수정을 지금 재고 싶으면 WSL로 간다. 여기서 재려면 먼저 커밋하고 gb10에 민다.
#
# 사용:  bash tools/gb10-test.sh                      # 전체
#        bash tools/gb10-test.sh test/watchfolder.test.ts
#        bash tools/gb10-test.sh --allow-mismatch     # 커밋·작업트리가 달라도 진행(뜻을 밝히는 것)
#        GIJO_GB10_HOST=gb10 bash tools/gb10-test.sh  # ssh 별칭을 바꿔 부를 때
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
HOST="${GIJO_GB10_HOST:-gb10}"

# ⚠ --allow-mismatch는 **우리 것**이다 — vitest에 넘기면 파일 이름으로 알아듣고 0개를 돌린다.
ALLOW_MISMATCH=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--allow-mismatch" ]; then ALLOW_MISMATCH=1; else ARGS+=("$a"); fi
done
set -- ${ARGS[@]+"${ARGS[@]}"}

# ⚠ 실패를 삼키지 않되 **값과 말은 가른다**(2026-09-06 검토관 적발 · 실측 재현).
#   한동안 `2>&1`로 합쳐 받았는데, git은 종료코드 0으로도 stderr에 말을 얹는다(GIT_TRACE·설정 경고 등).
#   그러면 그 줄들이 WIN_HEAD에 섞이고, 아래 ssh 명령 문자열에 **따옴표 없이** 실려
#   원격 셸이 그것을 명령으로 읽는다 — 실측: `GIT_TRACE=1`이면 rc=0·3줄·221자가 잡히고,
#   원격은 `command not found` 세 줄을 뱉으며 `bash -s`가 **아예 안 돈다**(시끄러운 파손).
#   → stderr는 따로 받아 사람에게 보여 주고, 값은 **40자리 sha인지 검사한 것만** 쓴다.
#   「맞는지 모르겠다」는 「맞다」가 아니므로, 못 읽으면 멈춘다.
GIT_ERRFILE="$(mktemp 2>/dev/null || echo "/tmp/gijo-gb10-giterr.$$")"
WIN_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>"$GIT_ERRFILE")"
GIT_RC=$?
GIT_ERR="$(cat "$GIT_ERRFILE" 2>/dev/null)"
rm -f "$GIT_ERRFILE"
if [ "$GIT_RC" -ne 0 ] || ! printf '%s' "$WIN_HEAD" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "=== gb10 이중 시험 ==="
  echo "✗ win의 커밋을 못 읽었습니다 — gb10과 같은 코드인지 확인할 길이 없습니다."
  echo "   git 종료코드: $GIT_RC"
  echo "   git 말      : ${GIT_ERR:-(없음)}"
  echo "   받은 값     : ${WIN_HEAD:-(빈 값)}   ← 40자리 sha가 아니면 원격에 실을 수 없습니다"
  echo "   ROOT        : $ROOT"
  echo "   확인할 것: 여기가 git 저장소인가 · git이 PATH에 있는가 · safe.directory 경고인가 · GIT_TRACE가 켜져 있나."
  echo "   그래도 돌리려면(무엇을 재는지 알고 있을 때):  bash tools/gb10-test.sh --allow-mismatch"
  [ "$ALLOW_MISMATCH" = "1" ] || exit 2
  WIN_HEAD="unknown"
fi
WIN_LINE="$(git -C "$ROOT" log --oneline -1 2>/dev/null || echo '(git 조회 실패)')"

# ★ 커밋이 같아도 **작업트리가 다르면 같은 코드가 아니다**(2026-09-06 검토관 적발).
#   gb10 사본은 gb10의 작업트리 = win이 `git push gb10 main`으로 밀어 넣은 **커밋**에서 뜬다.
#   그런데 이 저장소의 실제 흐름은 「편집 → 시험 → 커밋」이라, 커밋 전에 이 도구를 부르면
#   커밋 해시는 같은데 **방금 고친 것은 gb10에 없다.** 예전 판은 그 상태에서 win/gb10 두 줄에
#   같은 커밋을 찍었고, 사람은 그것을 「같은 코드 확인됨」으로 읽었다 — 남아 있던 거짓 초록이다.
#   ⚠ 형제 도구 wsl-test.sh는 반대다 — **살아 있는 트리를 그대로 rsync**하므로 미커밋 수정을 잰다.
#     두 도구의 초록이 서로 **다른 것**을 뜻하는데 출력 꼴이 같아 더 헷갈린다. 여기서 못 박는다.
#   판정 범위는 **사본이 실제로 가져가는 것**만: server/ client/ tools/ knowledge/ mockups/ · 뿌리 *.md.
#   ⚠ 추적 안 되는 파일은 뺀다(-uno) — 이 저장소엔 늘 수십 개가 떠 있어 넣으면 도구를 못 쓴다.
#   ⚠ 이 트리는 여러 사람이 동시에 쓴다 — 그래서 남의 문서·시안 편집까지 멈추지는 않는다.
WIN_DIRTY=""
if [ "$WIN_HEAD" != "unknown" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    f="${line:3}"; f="${f#\"}"; f="${f%\"}"
    case "$f" in
      server/*|client/*|tools/*|knowledge/*|mockups/*) WIN_DIRTY="$WIN_DIRTY$line"$'\n' ;;
      */*) ;;
      *.md) WIN_DIRTY="$WIN_DIRTY$line"$'\n' ;;
    esac
  done <<EOF
$(git -C "$ROOT" status --porcelain -uno 2>/dev/null)
EOF
fi

echo "=== gb10 이중 시험 ==="
echo "  win  : $WIN_LINE"
if [ -n "$WIN_DIRTY" ]; then
  N="$(printf '%s' "$WIN_DIRTY" | grep -c .)"
  echo
  echo "✗ win에 **커밋 안 한 수정 ${N}건**이 있습니다 — 그것은 gb10에 없습니다."
  printf '%s' "$WIN_DIRTY" | sed -n '1,10p' | sed 's/^/     /'
  [ "$N" -gt 10 ] && echo "     … 외 $((N-10))건"
  echo "   gb10이 재는 것은 **커밋된 판**뿐입니다. 그대로 돌리면 방금 고친 것을 안 담은 초록이 나옵니다."
  echo "   맞추려면:  커밋 → git push hub main → git push gb10 main → 다시"
  echo "   미커밋 수정을 지금 재려면 WSL로:  bash tools/wsl-test.sh   (살아 있는 트리를 그대로 복사합니다)"
  if [ "$ALLOW_MISMATCH" = "1" ]; then
    echo "   → --allow-mismatch 를 받았습니다. 진행합니다 — 아래 결과는 **커밋된 판**의 것입니다."
  else
    exit 2
  fi
fi

# vitest 인자를 원격 셸이 **다시 쪼개지 않게** 한 개씩 인용해 넘긴다.
RARGS=""
for a in "$@"; do RARGS="$RARGS $(printf '%q' "$a")"; done

# ⚠ 값도 인용해서 싣는다 — 위에서 sha만 통과시키지만, 인용은 공짜이고 injection을 원천 차단한다.
ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" \
  "GIJO_WIN_HEAD=$(printf '%q' "$WIN_HEAD") GIJO_ALLOW_MISMATCH=$(printf '%q' "$ALLOW_MISMATCH") bash -s --$RARGS" <<'REMOTE'
set -u

# ⚠ 비대화형 ssh는 .bashrc를 안 읽는다 — node·npx가 PATH에 붙는 곳이 여기뿐이다.
. "$HOME/gijo-env.sh"
# ⚠ 그런데 그 파일은 **제품 서버 기동용** 값도 함께 싣는다(모델 경로·VRAM 여유·준비 대기).
#   시험에 물려 두면 시험이 「이 기계의 서버 설정」을 검증하게 된다 — 딴 환경을 재는 일이다.
#   벗겨 내고 vitest.config가 정한 값만 쓰게 한다.
unset GIJO_LLAMA_SERVER_PATH GIJO_MODEL_VRAM_OVERHEAD_MB GIJO_MODEL_READY_TIMEOUT_MS
# ⚠ gb10에는 `python`이 없고 `python3`만 있다 — 안 걸어 주면 파이썬을 쓰는 시험 3개가
#   「파이썬 없음」으로 조용히 건너뛴다(초록인데 아무것도 증명 안 한 상태).
export GIJO_TEST_PYTHON=python3
# ⚠ 그런데 **시험이 켜지는 것과 제품이 돌아가는 것은 다른 스위치다**(2026-09-03 첫 실행에서 밟음).
#   GIJO_TEST_PYTHON만 걸면 finetune 시험은 「파이썬 있다」고 켜지는데, 정작 제품
#   (trainenv.ts trainPython)은 venv-train이 없으면 `python`으로 떨어져 spawn ENOENT로 죽는다.
#   → 제품이 읽는 스위치에도 **이 기계의 진짜 파이썬**을 알려 준다(가짜를 심는 게 아니라
#     기계 사정을 그대로 말해 주는 것이다. 절대경로만 받는다 — existsSync로 검사한다).
PY3="$(command -v python3 2>/dev/null || true)"
[ -n "$PY3" ] && export GIJO_TRAIN_PYTHON="$PY3"

SRC_ROOT="$HOME/gijo-as"
SRC="$SRC_ROOT/server"
if [ ! -d "$SRC" ]; then echo "✗ gb10에 원본이 없습니다: $SRC"; exit 2; fi

# ⚠ 여기도 값과 말을 가른다(win 쪽과 같은 이유) — git이 rc=0으로 stderr에 얹은 말이 값에 섞이면
#   아래 비교가 「커밋이 다르다」로 떨어져 **원인이 엉뚱하게 보인다.**
GB_ERRFILE="$(mktemp 2>/dev/null || echo "/tmp/gijo-gb10-giterr-remote.$$")"
GB_HEAD="$(git -C "$SRC_ROOT" rev-parse HEAD 2>"$GB_ERRFILE")"
GB_RC=$?
GB_ERR="$(cat "$GB_ERRFILE" 2>/dev/null)"; rm -f "$GB_ERRFILE"
if [ "$GB_RC" -ne 0 ] || ! printf '%s' "$GB_HEAD" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "  gb10 : ✗ 커밋 조회 실패(rc=$GB_RC) — ${GB_ERR:-받은 값이 sha가 아님: ${GB_HEAD:-(빈 값)}}"
  GB_HEAD="unknown"
else
  echo "  gb10 : $(git -C "$SRC_ROOT" log --oneline -1 2>/dev/null)"
fi
# ★ 다르면 **멈춘다**(2026-09-06). 옛 코드로 난 초록을 내 수정의 증거로 읽는 사고가 실제로 났다.
if [ "${GIJO_WIN_HEAD:-x}" != "$GB_HEAD" ]; then
  echo
  echo "✗ win과 gb10의 커밋이 **다릅니다** — 여기서 멈춥니다."
  echo "   win  : ${GIJO_WIN_HEAD:-?}"
  echo "   gb10 : $GB_HEAD"
  echo "   그대로 돌리면 **gb10에 있는 옛 코드**가 초록을 내고, 그 초록은 방금 고친 것을 증명하지 않습니다."
  echo "   맞추려면 win에서:  git push gb10 main"
  if [ "${GIJO_ALLOW_MISMATCH:-0}" = "1" ]; then
    echo "   → --allow-mismatch 를 받았습니다. 일부러 다른 판을 재는 것으로 보고 진행합니다."
    echo "     ⚠ 아래 결과는 **gb10에 있는 코드**의 것입니다. 보고할 때 그렇게 적으세요."
  else
    exit 2
  fi
fi
echo

# 매번 새 자리. 재사용하면 이 도구의 존재 이유(깨끗한 바닥)가 사라진다.
DST_ROOT="/tmp/gijo-test-$(date +%Y%m%d-%H%M%S)-$$"
DST="$DST_ROOT/server"
mkdir -p "$DST" || exit 1
trap 'rm -rf "$DST_ROOT"' EXIT INT TERM

echo "=== 사본 만들기 (소스·시험·설정만 · $DST_ROOT) ==="
# 옮기는 목록은 tools/wsl-test.sh와 **같다** — 두 벌로 갈라지면 한쪽에서만 나는 실패가 생긴다.
rsync -a \
  --include='src/***' --include='test/***' --include='scripts/***' \
  --include='package.json' --include='package-lock.json' --include='tsconfig.json' \
  --include='vitest.config.*' --include='requirements.txt' --include='requirements-ocr.txt' --include='modelscan_wrapper.py' \
  --include='docs-manifest.json' --include='docs/***' \
  --exclude='*' \
  "$SRC/" "$DST/" || { echo "✗ server 사본 실패"; exit 1; }
# 클라도 가져간다 — 시험 일부가 **화면 파일을 소스로 읽는다**(office.html 등).
# electron-builder*.json은 라이트 에디션 시험이 「빌드 설정과 코드가 짝인가」를 본다.
# scripts/는 게시 관문 감시(wiringcontract)가 publish-release.mjs를 읽는다.
mkdir -p "$DST_ROOT/client"
rsync -a --include='src/***' --include='scripts/***' --include='smartmd/' --include='smartmd/vendor/***' \
  --include='package.json' --include='package-lock.json' --include='electron-builder*.json' \
  --exclude='*' "$SRC_ROOT/client/" "$DST_ROOT/client/" || { echo "✗ client 사본 실패"; exit 1; }
# 저장소 뿌리의 knowledge/·tools/·mockups/를 읽는 시험도 있다.
for d in knowledge tools mockups; do
  [ -d "$SRC_ROOT/$d" ] && rsync -a "$SRC_ROOT/$d/" "$DST_ROOT/$d/" 2>/dev/null
done
# 뿌리의 제품 문서(*.md) — docs-manifest 정합성·코퍼스 감시·용어사전 시험이
# 「매니페스트에 적힌 파일이 실제로 있는가」를 본다.
rsync -a --include='*.md' --exclude='*/' --exclude='*' "$SRC_ROOT/" "$DST_ROOT/" 2>/dev/null
# ★★ **실전 답 기록(.tmp-reports/ops-sim.json)은 여기로 옮기지 않는다**(2026-09-08 · 일부러 뺐다).
#   ■ 왜 — **2026-09-08부터 그 파일에 「가드가 본 근거 조각 본문」이 실린다.**
#     하네스가 도는 계정은 claude-deploy(admin)라 **등급 C 사내 문서**(운영 1,598건)의 조각도
#     그대로 담긴다. 즉 이 파일은 그날부터 **시험 재료가 아니라 사내 문서 묶음**이 됐다.
#   ■ 그래서 무엇이 문제였나 — 이 자리는 **원격 기계(gb10)로 나가는 길**이다.
#     형제 도구 wsl-test.sh가 옮기는 곳은 같은 기계의 WSL이라 경계를 안 넘지만, 여기서 만드는
#     사본은 gb10(10.8.0.12 · 별도 계정 gijohn_llm)에 있다. 시험 하나를 초록으로 만들자고
#     사내 문서 본문을 다른 기계에 복제하는 것은 값이 안 맞는다.
#   ■ 오늘 실제로 새고 있었나 — **아니다(2026-09-08 실측).** `.tmp-reports/`는 .gitignore에
#     있어 `git push gb10 main`이 안 실어 나르고, gb10의 `~/gijo-as/.tmp-reports/`에는
#     input-inventory.json·qa-auto-regress.json 둘뿐이라 위 cp는 **늘 빈손**이었다.
#     그러니 이건 「샌 것을 막는」 수리가 아니라 **「열려 있던 문을 닫는」 수리**다 —
#     누군가 「gb10에서도 이 시험을 돌리자」며 파일 하나만 갖다 놓으면 그날로 새기 시작한다.
#   ■ ★ 때를 정확히 적는다 — **아직 조각이 실린 기록은 존재하지 않는다**(2026-09-08 실측).
#     조각 본문을 적는 칸(`근거조각`)은 오늘 커밋 b2c71247로 들어갔는데, 지금 디스크에 있는
#     기록은 **그 전에 돈 03:04 회차**라 그 칸이 아예 없다(177건 · 조각 0건 확인).
#     즉 **처음으로 조각이 실리는 것은 오늘 밤 03:00 회차**다. 문은 그 전에 닫는다.
#   ■ 대신 무엇을 잃나 — 실전 답을 재료로 쓰는 시험 9개가 gb10 사본에서 **건너뛴다.**
#     원래도 재료가 없어 건너뛰고 있었으므로 **잃는 것은 없다.** 그리고 건너뜀은 조용하지 않다:
#     citeguard.test.ts가 「gb10 사본은 일부러 재료를 안 옮긴다(등급 C 조각)」를 사유로 찍는다.
#     그 시험들을 진짜로 재려면 **win의 WSL**로 간다(bash tools/wsl-test.sh — 경계를 안 넘는다).
#   ⚠ 이 자리에 ops-sim 복사를 다시 넣으면 **server/test/shipscripts.test.ts가 빨강**이 된다.
#     되살리려면 위 「왜」부터 다시 판단할 것 — 시험을 고쳐 통과시키는 길이 아니다.
[ -f "$SRC_ROOT/.gitignore" ] && cp "$SRC_ROOT/.gitignore" "$DST_ROOT/" 2>/dev/null

# ⚠ **사본에도 server/data/ 는 만들어 준다**(2026-09-03).
#   지켜보는 폴더의 「제품 자신의 data/를 지정하면 순환이라 거부」 판정은 그 폴더가 실재해야
#   판정까지 간다(없으면 그 앞의 「경로를 못 찾음」에서 끝난다). 시험 쪽에도 같은 보장을
#   넣었지만(watchfolder.test.ts), 도구도 함께 보장한다 — 여기가 그 사전조건이 처음 깨진 자리다.
#   ⚠ 원본 data/가 아니라 **사본의 빈 data/**다. 운영 DB는 이 스크립트가 손대지 않는다.
mkdir -p "$DST/data"

echo "  서버 소스 $(find "$DST/src" -name '*.ts' 2>/dev/null | wc -l)개 · 시험 $(find "$DST/test" -name '*.test.ts' 2>/dev/null | wc -l)개 · 클라 화면 $(find "$DST_ROOT/client/src" -name '*.html' 2>/dev/null | wc -l)개"

# node_modules는 복사하지 않는다(수 GB). 원본 것을 링크로 **읽기만** 한다.
ln -s "$SRC/node_modules" "$DST/node_modules"

# ⚠ 이 사본에서 구조적으로 못 도는 시험 2개 — 감추지 않고 **원본에서 따로** 돌려 합친다.
#   · no-hardcoded-credentials — `git ls-files`를 쓴다. 사본은 git 저장소가 아니다.
#   · shotlist — 고객 자료의 그림(PNG)이 실재하는지 본다. 사본은 이미지를 안 가져간다.
#   빼지 않고 그냥 돌리면 종료코드가 **늘 1**이라 진짜 실패가 그 둘에 묻힌다(2026-08-10 실사고).
#   ⚠ 파일을 콕 집어 부른 경우(인자 있음)에는 빼지 않는다 — 부른 사람 뜻이 우선이다.
EXTRA="test/no-hardcoded-credentials.test.ts test/shotlist.test.ts"
SKIPPED=0
if [ $# -eq 0 ]; then
  for f in no-hardcoded-credentials shotlist; do
    [ -f "$DST/test/$f.test.ts" ] && rm -f "$DST/test/$f.test.ts" && SKIPPED=$((SKIPPED+1))
  done
  echo "  사본에서 제외 $SKIPPED개(git·이미지가 필요한 것) — 아래 ②에서 원본으로 따로 돕니다."
fi

echo
echo "=== ① 사본에서 실행 ==="
OUT1="$DST_ROOT/vitest-copy.out"
START=$(date +%s)
cd "$DST" || exit 1
npx vitest run "$@" 2>&1 | tee "$OUT1"
CODE1=${PIPESTATUS[0]}

CODE2=0
OUT2=""
if [ $# -eq 0 ] && [ "$SKIPPED" -gt 0 ]; then
  echo
  echo "=== ② 원본에서 실행 (git·이미지가 필요한 $SKIPPED개) ==="
  echo "    ⚠ 읽기만 하는 시험이다(git ls-files · 파일 존재 확인). 원본 data/는 건드리지 않는다."
  OUT2="$DST_ROOT/vitest-origin.out"
  cd "$SRC" || exit 1
  # shellcheck disable=SC2086
  npx vitest run $EXTRA 2>&1 | tee "$OUT2"
  CODE2=${PIPESTATUS[0]}
fi
END=$(date +%s)

echo
echo "=== 요약 ==="
# ⚠ vitest 출력에는 색 제어문자가 섞인다 — 그대로 grep하면 줄머리가 안 맞아 **한 줄도 못 잡고**
#   요약이 텅 빈 채 「종료코드」만 남는다(2026-09-03 첫 실행에서 실제로 그랬다). 색부터 벗긴다.
summary_lines() { sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$1" | grep -E '^[[:space:]]*(Test Files|Tests|Duration)[[:space:]]' | tail -3; }
echo "① 사본($DST_ROOT)"
summary_lines "$OUT1"
echo "   종료코드 $CODE1"
if [ -n "$OUT2" ]; then
  echo "② 원본($SRC · git·이미지 필요분)"
  summary_lines "$OUT2"
  echo "   종료코드 $CODE2"
fi
echo "⏱ 합계 $((END-START))초"
# ⚠ **무엇을 돌렸는지 그대로 말한다.** 인자를 주면 ②는 안 돈다 — 그때도 「①② 둘 다 통과」라고
#   찍으면 그게 이 저장소가 제일 싫어하는 「안 한 일을 했다고 말하기」다(2026-09-03에 한 번 찍었다).
if [ "$CODE1" -eq 0 ] && [ "$CODE2" -eq 0 ]; then
  if [ -n "$OUT2" ]; then
    echo "✅ gb10 전부 통과 — ①사본 + ②원본(git·이미지 필요분)을 **둘 다** 돌린 결과"
  else
    echo "✅ 통과 — **①사본에서 지정한 것만** 돌렸다(②는 안 돌렸다. 전체는 인자 없이 부른다)."
  fi
  exit 0
fi
echo "✗ 실패 있음 — ①=$CODE1${OUT2:+ ②=$CODE2}"
exit 1
REMOTE
