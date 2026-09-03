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
# 사용:  bash tools/gb10-test.sh                      # 전체
#        bash tools/gb10-test.sh test/watchfolder.test.ts
#        GIJO_GB10_HOST=gb10 bash tools/gb10-test.sh  # ssh 별칭을 바꿔 부를 때
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
HOST="${GIJO_GB10_HOST:-gb10}"

WIN_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
WIN_LINE="$(git -C "$ROOT" log --oneline -1 2>/dev/null || echo '(git 조회 실패)')"

echo "=== gb10 이중 시험 ==="
echo "  win  : $WIN_LINE"

# vitest 인자를 원격 셸이 **다시 쪼개지 않게** 한 개씩 인용해 넘긴다.
RARGS=""
for a in "$@"; do RARGS="$RARGS $(printf '%q' "$a")"; done

ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" \
  "GIJO_WIN_HEAD=$WIN_HEAD bash -s --$RARGS" <<'REMOTE'
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

GB_HEAD="$(git -C "$SRC_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "  gb10 : $(git -C "$SRC_ROOT" log --oneline -1 2>/dev/null || echo '(git 조회 실패)')"
if [ "${GIJO_WIN_HEAD:-x}" != "$GB_HEAD" ]; then
  echo "  ⚠ win과 gb10의 커밋이 **다릅니다** — 아래 결과는 gb10에 있는 코드의 것입니다."
  echo "     맞추려면 win에서:  git push gb10 main   (그대로 진행합니다)"
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
  --include='package.json' --include='electron-builder*.json' \
  --exclude='*' "$SRC_ROOT/client/" "$DST_ROOT/client/" || { echo "✗ client 사본 실패"; exit 1; }
# 저장소 뿌리의 knowledge/·tools/·mockups/를 읽는 시험도 있다.
for d in knowledge tools mockups; do
  [ -d "$SRC_ROOT/$d" ] && rsync -a "$SRC_ROOT/$d/" "$DST_ROOT/$d/" 2>/dev/null
done
# 뿌리의 제품 문서(*.md) — docs-manifest 정합성·코퍼스 감시·용어사전 시험이
# 「매니페스트에 적힌 파일이 실제로 있는가」를 본다.
rsync -a --include='*.md' --exclude='*/' --exclude='*' "$SRC_ROOT/" "$DST_ROOT/" 2>/dev/null
# 실전 답 기록이 있으면 옮긴다(말투 규범·프롬프트 누출 감시가 이걸로 오탐 0을 증명한다). 없으면 건너뛴다.
mkdir -p "$DST_ROOT/.tmp-reports"
[ -f "$SRC_ROOT/.tmp-reports/ops-sim.json" ] && cp "$SRC_ROOT/.tmp-reports/ops-sim.json" "$DST_ROOT/.tmp-reports/" 2>/dev/null
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
