#!/bin/bash
# tools/wsl-test.sh — **서버 시험을 WSL 안에서 돌린다.**
#
# ⚠ 변수명은 영문만 — bash는 한글 변수명을 못 읽는다(2026-08-10에 밟음).
#
# ■ 왜 (2026-08-10 실측)
#   같은 시험 4파일·37개:  Windows 호스트 = 한 파일에 14분  ·  WSL = 2초
#   Windows에서 전체 시험(279파일)은 밤새 돌려도 안 끝나, 「시험 게이트」가 사실상
#   **없는 것과 같았다.** 실제로 어제 게이트를 통과 못 한 채 배포를 밀어야 했다.
#
#   그리고 더 중요한 이유: **제품은 WSL에서 돈다.** Windows 호스트에서 재는 것은
#   운영이 아닌 딴 환경을 검증하는 일이다(그 python3은 0바이트 껍데기다 — 2026-08-09).
#
# ■ 운영을 건드리지 않는다
#   /home/gijo/gijo-as(운영)가 아니라 **/home/gijo/gijo-as-test(DST)**에서 돈다.
#   ⚠ ext4에 두는 것이 핵심 — /mnt/d(Windows 디스크)에서 돌리면 파일 접근이 느려
#     Windows에서 돌리는 것과 다를 바 없어진다.
#   ⚠ DST은 **소스·시험·설정만** 가져간다. data/·models/는 안 가져간다
#     (운영 DB를 시험이 건드리면 안 된다 — 그게 이 분리의 목적이다).
#
# ■ 병렬 안전 — **부르는 사람마다 자기 사본** (2026-09-04 실측 사고)
#   그날 에이전트 둘이 이 스크립트를 거의 같은 때 돌렸다. DST이 한 곳뿐이라 한쪽의
#   `rsync --delete`가 다른 쪽이 읽는 중인 사본을 갈아엎었고, gracefulclose 시험이
#   **EADDRINUSE(:::45999)**로 붉었다 — 혼자 돌리면 초록인 시험이다.
#   **남의 실행이 내 초록/빨강을 바꾼다**는 것은 시험 게이트가 가질 수 있는 최악의 성질이다.
#   빨강이 내 결함인지 남의 실행인지 알 수 없으면, 초록도 못 믿는다.
#   → 기본 DST을 `/home/gijo/gijo-as-test/runs/<호출 식별자>`로 갈랐다(gb10-test.sh와 같은 방식).
#     식별자 = GIJO_TEST_ID 있으면 그것, 없으면 프로세스번호-시각. 끝나면 **자기 것만** 지운다
#     (남기려면 GIJO_KEEP_DST=1). 강제 종료로 남은 것은 다음 실행이 하루 지난 것만 쓸어 담는다.
#   ⚠ node_modules는 사본마다 복사하지 않는다(1.4GB) — 운영 것을 **하드링크**로 붙인다(아래 참조).
#     그래서 사본 하나가 84MB뿐이고, 호출자별로 갈라도 디스크가 안 늘어난다.
#   비용(2026-09-04 실측): 복사 단계만 보면 찬 사본 7.2초 · 더운 공용 사본 1.5초 → +5.7초.
#     ⚠ 그런데 **전체 시험에서는 그 차이가 실행별 흔들림에 묻힌다** — 같은 날 실측:
#       기본(찬 사본) 50초 vs `--serial`(더운 사본) 53초. 「--serial이 빠르다」고 말하면 거짓이다.
#     차이가 보이는 건 **한두 파일만 돌릴 때**다(실측: 기본 7.6초 · --serial 4.3초).
#     그래서 `--serial`은 「혼자서 한 파일씩 빨리 돌릴 때」 쓰는 것이다 —
#     잠금(flock)으로 한 번에 하나만 돌게 하고 더운 공용 사본을 재사용한다.
#
# ■ 포트를 여는 시험 — 사본을 갈라도 **포트는 기계에 하나뿐**이라 따로 봐야 한다
#   · test/gracefulclose.test.ts — 예전엔 45997~45999 **고정**이었고, 그게 위 사고의 직접 원인이다.
#     2026-09-04에 포트 0(커널이 빈 포트를 골라 준다)으로 고쳤다 → 몇 개가 동시에 돌아도 안 겹친다.
#   · test/siem.test.ts — 처음부터 포트 0으로 연다. 안전.
#   · 그 밖에 포트를 여는 시험은 없다. vitest.config가 LLM·임베딩 URL을 59999/59998
#     (아무도 안 듣는 포트)로 못박아 두어 시험이 실서버에 붙을 길 자체가 없다.
#   ⚠ 앞으로 **포트를 고정으로 여는 시험을 만들지 말 것.** 만들면 이 목록에 적고 `--serial`에서만
#     돌려야 한다 — 포트 0을 쓰면 그런 빚을 안 진다.
#
# 사용:  wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/wsl-test.sh" [--serial] [vitest 인자...]
#   전체:      (인자 없이)
#   일부:      test/lawfallback.test.ts test/modelcatalog.test.ts
#   직렬:      --serial  (잠금 + 더운 공용 사본 — 한두 파일만 반복해 돌릴 때 3초쯤 빠르다)
set -u

# ── --serial을 먼저 걷어낸다. 나머지 인자는 손대지 않고 그대로 vitest로 간다. ──
SERIAL=0
if [ "${1:-}" = "--serial" ]; then SERIAL=1; shift; fi

# ⚠ 워크트리(.claude/worktrees/*)에서 편집할 때는 **여기가 메인을 가리키면 안 된다** —
#   내 변경이 아니라 메인의 옛 코드를 시험하게 되고, 그건 「초록인데 안 고쳐진」 상태다.
#   GIJO_SRC_ROOT로 덮어쓴다. (DST은 이제 알아서 갈라지므로 따로 안 줘도 안 섞인다.)
#   예)  GIJO_SRC_ROOT="/mnt/d/Connect AI/.claude/worktrees/foo" \
#          wsl -d Ubuntu-24.04 -- bash ".../tools/wsl-test.sh" test/modelsplit.test.ts
SRC_ROOT="${GIJO_SRC_ROOT:-/mnt/d/Connect AI}"
TEST_ROOT=/home/gijo/gijo-as-test

# 호출 식별자 — 부른 쪽이 이름을 주면 그것을 쓴다(로그에서 누구 사본인지 보인다).
TEST_ID="${GIJO_TEST_ID:-$$-$(date +%H%M%S)}"

# OWNED=1 → 내가 만든 사본이라 끝나고 지운다. 0 → 남의 자리이므로 손대지 않는다.
OWNED=1
if [ -n "${GIJO_DST_ROOT:-}" ]; then
  DST_ROOT="$GIJO_DST_ROOT"; OWNED=0        # 부른 사람이 콕 집은 자리는 지우지 않는다
elif [ "$SERIAL" = 1 ]; then
  DST_ROOT="$TEST_ROOT"; OWNED=0            # 공용 더운 사본 — 잠금이 지킨다
else
  DST_ROOT="$TEST_ROOT/runs/$TEST_ID"
fi
[ "${GIJO_KEEP_DST:-0}" = "1" ] && OWNED=0
SRC="$SRC_ROOT/server"
DST="$DST_ROOT/server"

# --serial은 **한 번에 하나만** 돌게 잠근다(앞 실행이 있으면 끝날 때까지 기다린다).
# ⚠ GIJO_TEST_LOCKED가 재귀를 막는다 — 잠금을 잡고 자기 자신을 한 번만 다시 부른다.
if [ "$SERIAL" = 1 ] && [ -z "${GIJO_TEST_LOCKED:-}" ]; then
  mkdir -p "$TEST_ROOT"
  echo "⏳ --serial — 공용 사본을 잠급니다($TEST_ROOT/.wsl-test.lock). 앞 실행이 있으면 기다립니다."
  exec env GIJO_TEST_LOCKED=1 flock "$TEST_ROOT/.wsl-test.lock" bash "$0" --serial "$@"
fi

# ── 「엉뚱한 데서 돌았는데 초록」을 막는 관문 (2026-09-05) ──────────────────────────
#
# ■ 실측한 함정 (Git Bash에서 이 도구를 부를 때)
#   `wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/wsl-test.sh"` 를 **Git Bash**에서 치면
#   MSYS 경로 변환이 인자를 갈아치워 `C:/Program Files/Git/mnt/d/...` 가 된다. 그러면
#   bash가 **스크립트를 아예 못 열고** 끝난다(실측 종료코드 127, 시험 0개 실행).
#   127 자체는 정직한 실패지만, 부르는 쪽이 `... | tail -1` 처럼 **파이프로 받으면 파이프의
#   종료코드(0)**를 보게 되어 「전부 통과」로 읽힌다 — 이 저장소가 push에서 이미 밟은 그 함정이다.
#   → 해결은 두 가지다: (1) `MSYS_NO_PATHCONV=1` 을 앞에 붙이거나 (2) PowerShell에서 부른다.
#
# ■ 그리고 **이 스크립트가 Git Bash 안에서 직접 도는 것**도 막는다.
#   그때는 /mnt/d가 없어 아래 exit 2에 걸리지만, 사람이 받는 안내가 「원본 없음」뿐이라
#   진짜 원인(딴 셸에서 돌렸다)을 못 찾는다. 무엇보다 **제품은 WSL에서 돈다** —
#   Windows 셸에서 재면 딴 환경을 검증하는 것이다(이 파일 머리말의 존재 이유).
if [ -n "${MSYSTEM:-}" ] || ! grep -qi microsoft /proc/version 2>/dev/null; then
  echo "✗ 여기는 WSL이 아닙니다(MSYSTEM=${MSYSTEM:-없음})." >&2
  echo "  이 도구는 **WSL 안에서만** 뜻이 있습니다 — 제품이 WSL에서 돌기 때문입니다." >&2
  echo "  PowerShell에서:  wsl -d Ubuntu-24.04 -- bash \"/mnt/d/Connect AI/tools/wsl-test.sh\"" >&2
  echo "  Git Bash에서:    MSYS_NO_PATHCONV=1 을 맨 앞에 붙이세요(안 붙이면 경로가 뭉개집니다)." >&2
  exit 2
fi

if [ ! -d "$SRC" ]; then
  echo "✗ 원본을 찾지 못했습니다: $SRC" >&2
  echo "  → GIJO_SRC_ROOT가 틀렸거나(지금 값: ${GIJO_SRC_ROOT:-미설정}), 경로가 뭉개졌습니다." >&2
  echo "  → Git Bash에서 불렀다면 MSYS_NO_PATHCONV=1 을 맨 앞에 붙이세요." >&2
  echo "  ⚠ 시험을 **한 개도 안 돌렸습니다** — 이 실행을 「통과」로 읽지 마세요(종료코드 2)." >&2
  exit 2
fi

if [ "$OWNED" = 1 ]; then
  # ⚠ 강제 종료(kill -9·창 닫기)되면 아래 trap이 안 돌아 84MB짜리가 남는다.
  #   **하루 넘은 것만** 쓸어 담는다 — 지금 도는 남의 사본을 지우면 이 도구가 사고의 원인이 된다.
  find "$TEST_ROOT/runs" -maxdepth 1 -mindepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null
  trap 'rm -rf "$DST_ROOT"' EXIT INT TERM
fi
echo "사본: $DST_ROOT$([ "$OWNED" = 1 ] && echo '  (이 실행 전용 — 끝나면 지웁니다)' || echo '  (공용/지정 — 그대로 둡니다)')"

echo "=== 사본 동기화 (소스·시험·설정만) ==="
mkdir -p "$DST"
rsync -a --delete \
  --include='src/***' --include='test/***' --include='scripts/***' \
  --include='package.json' --include='package-lock.json' --include='tsconfig.json' \
  --include='vitest.config.*' --include='requirements.txt' --include='requirements-ocr.txt' --include='modelscan_wrapper.py' \
  --include='docs-manifest.json' --include='docs/***' \
  --exclude='*' \
  "$SRC/" "$DST/" || { echo "✗ server 동기화 실패"; exit 1; }
# ⚠ client도 가져간다: 시험 일부가 **화면 파일을 소스로 읽는다**(office.html 등).
#   안 넣었다가 40개가 ENOENT로 실패했다 — 제품 결함이 아니라 사본 결함이었다.
mkdir -p "$DST_ROOT/client"
# ⚠ electron-builder*.json도 가져간다(2026-08-13) — 라이트 에디션 시험이 **빌드 설정과 코드가
#   짝을 이루는지**를 본다(lite-edition-shell: extraMetadata.gijoEdition ↔ main.ts). 빠뜨리면
#   시험 파일이 수집 단계에서 죽어 「1 failed · 테스트 0」이 된다 — 제품 결함처럼 보이는 사본 결함이다.
# ⚠ scripts/도 가져간다(2026-08-20) — 게시 관문 감시(wiringcontract)가 publish-release.mjs를 읽는다.
# ⚠ smartmd/vendor/도 가져간다(2026-08-22) — 동봉 고지 감시(vendornotice)가 VERSIONS.md를 읽는다.
#   그 파일이 **우리가 CDN 대신 직접 싣는 JS·글꼴 4종의 라이선스 원장**이다. 안 가져가면
#   감시가 ENOENT로 죽는데, 하필 이 감시가 막으려는 사고가 **「조용히 0개를 읽는 것」**이라
#   사본 결함이 그 사고와 똑같은 모양으로 나타난다.
#   ★ 같은 날 밤 Smart MD를 없애 지금은 **아무 빌드도 안 싣는다** — 그 감시는 전부 skip이고
#     이 복사는 당장은 헛일이다. **그래도 남긴다**: 언젠가 다시 동봉하는 날(extraResources
#     갈래 포함) 이 줄이 없으면 WSL에서 파일이 없어 **조용히 skip**되고, 그게 바로
#     「고지가 빠졌는데 초록」이다. 헛일 몇 KB가 그 위험보다 싸다.
rsync -a --delete --include='src/***' --include='scripts/***' --include='smartmd/' --include='smartmd/vendor/***' \
  --include='package.json' --include='electron-builder*.json' \
  --exclude='*' "$SRC_ROOT/client/" "$DST_ROOT/client/" || { echo "✗ client 동기화 실패"; exit 1; }
# 저장소 뿌리의 knowledge/·tools/·mockups/를 읽는 시험도 있다.
for d in knowledge tools mockups; do
  [ -d "$SRC_ROOT/$d" ] && rsync -a --delete "$SRC_ROOT/$d/" "$DST_ROOT/$d/" 2>/dev/null
done
# ⚠ 뿌리의 제품 문서(*.md)도 필요하다 — docs-manifest 정합성·코퍼스 감시·용어사전 시험이
#   「매니페스트에 적힌 파일이 실제로 있는가」를 본다. 없으면 **감시가 헛돌지 않는지 보는
#   시험**까지 빨간불이 난다(그게 이 사본에서 처음 6건이 실패한 이유였다).
rsync -a --include='*.md' --exclude='*/' --exclude='*' "$SRC_ROOT/" "$DST_ROOT/" 2>/dev/null
# ⚠ **실전 답 기록(.tmp-reports/ops-sim.json)도 옮긴다**(2026-08-31).
#   말투 규범 감시(tone-realanswers)와 프롬프트 복창 누출 감시(promptleak-retry)는 「내가 고른
#   표본이 아니라 **실전 답 전체**로 오탐 0을 증명한다」가 존재 이유인데, 이 사본에 기록이 안
#   가서 **둘 다 늘 건너뛰고 있었다.** 시험이 조용히 건너뛰면 초록이 뜨지만 아무것도 증명하지
#   않는다 — 이 저장소가 반복해 겪은 「헛도는 시험」이다. 없으면 종전대로 건너뛴다(선택).
mkdir -p "$DST_ROOT/.tmp-reports"
[ -f "$SRC_ROOT/.tmp-reports/ops-sim.json" ] && cp "$SRC_ROOT/.tmp-reports/ops-sim.json" "$DST_ROOT/.tmp-reports/" 2>/dev/null
# ⚠ 짝인 **메타(ops-sim.meta.json)도 함께** 옮긴다(2026-09-06). 「완주본인가」를 읽는 쪽이
#   손으로 적은 숫자(158)로 재다가 그 숫자가 낡아 버렸다 — 이제 하네스가 메타에 적고 시험이
#   그것을 읽는다. 메타만 빠지면 시험이 하한선(100건)으로 물러나 잣대가 헐거워진다.
[ -f "$SRC_ROOT/.tmp-reports/ops-sim.meta.json" ] && cp "$SRC_ROOT/.tmp-reports/ops-sim.meta.json" "$DST_ROOT/.tmp-reports/" 2>/dev/null
[ -f "$SRC_ROOT/.gitignore" ] && cp "$SRC_ROOT/.gitignore" "$DST_ROOT/" 2>/dev/null
# ⚠ **사본에도 빈 server/data/는 만들어 준다**(gb10-test.sh가 2026-09-03에 밟은 자리).
#   지켜보는 폴더의 「제품 자신의 data/를 지정하면 순환이라 거부」 판정은 그 폴더가 실재해야
#   판정까지 간다(없으면 그 앞의 「경로를 못 찾음」에서 끝난다). 예전엔 옛 사본에 운영 부산물이
#   남아 있어 우연히 통과했다 — 사본을 매번 새로 만드는 지금은 우연이 없다.
#   ⚠ 원본 data/가 아니라 **빈 폴더**다. 운영 DB는 이 스크립트가 읽지도 쓰지도 않는다.
mkdir -p "$DST/data"
echo "  서버 소스 $(find "$DST/src" -name '*.ts' 2>/dev/null | wc -l)개 · 시험 $(find "$DST/test" -name '*.test.ts' 2>/dev/null | wc -l)개 · 클라 화면 $(find "$DST_ROOT/client/src" -name '*.html' 2>/dev/null | wc -l)개"

# node_modules는 사본마다 진짜로 복사하지 않는다(1.4GB). 운영 것을 **하드링크**로 붙인다.
# ⚠ 심볼릭 링크는 안 된다 — 2026-09-04에 실제로 밟았다. 링크로 붙이면 vitest가 자기 모듈을
#   사본 밖(운영 경로)에서 읽게 되고, 그 순간 내장 모듈까지 사본 안 경로로 찾으려 들어
#   `Cannot find module '<사본>/server/tls'`로 **232개 파일이 통째로** 죽는다. 예전 사본에는
#   진짜 node_modules가 남아 있어 이 갈래가 한 번도 안 돌아 몰랐던 자리다.
# ⚠ 하드링크는 **디스크를 안 쓴다**(같은 데이터를 가리킬 뿐) — 실측 524ms · 파일 10,730개.
#   시험은 node_modules를 읽기만 하고, 새로 만드는 캐시(.vite 등)는 새 파일이라 원본과 무관하다.
#   (제자리에서 고쳐 쓰는 것만 원본에 번지는데, 그런 시험은 없다.)
# ⚠ **매번 다시 건다**(있으면 지우고 다시 하드링크). 예전처럼 「없을 때만」 만들면 공용 사본에
#   옛 설치가 눌러앉아, 같은 스크립트인데 --serial과 기본 갈래가 **서로 다른 의존성**으로 돈다
#   (실측 2026-09-04: 공용 사본 312개 vs 운영 315개). 「같은 것을 여러 곳에 두면 어긋난다」가
#   의존성 층에서 재발하는 자리다. 지우고 다시 거는 값은 0.6초뿐이다.
NODE_MODULES=/home/gijo/gijo-as/server/node_modules
if [ ! -d "$NODE_MODULES" ]; then
  echo "✗ node_modules를 못 찾았습니다: $NODE_MODULES"
  echo "  → 운영에 의존성이 깔려 있어야 이 도구가 돕니다(cd /home/gijo/gijo-as/server && npm ci)."
  exit 1
fi
rm -rf "$DST/node_modules"
if ! cp -al "$NODE_MODULES" "$DST/node_modules" 2>/dev/null; then
  echo "✗ node_modules 하드링크 실패 — 사본이 운영과 **다른 파일시스템**에 있으면 안 됩니다."
  echo "  → GIJO_DST_ROOT을 /home 아래(운영과 같은 ext4)로 잡아 주세요."
  exit 1
fi
echo "  node_modules: 운영 것을 하드링크(디스크 안 늘고 0.6초 · 진짜 디렉터리라 vitest가 정상 해석)"

echo
# ⚠ **이 사본에서 구조적으로 못 도는 시험 2개**(2026-08-10 실측). 감추지 않고 밝힌다:
#   · no-hardcoded-credentials — `git ls-files`를 쓴다. 사본은 git 저장소가 아니다.
#   · shotlist — 고객 자료의 그림(PNG)이 실제로 있는지 본다. 사본은 이미지를 안 가져간다
#     (수백 MB라 시험 속도의 이점이 사라진다).
#   → 이 둘은 **Windows 호스트에서 따로** 돌려야 한다. 「WSL에서 전부 통과」라고 말하면
#     거짓이 되므로 실행 끝에 다시 알린다.
SKIP_NOTE="no-hardcoded-credentials(git 필요) · shotlist(이미지 필요)"

# ⚠ 2026-08-10 2차 수정 — **안내만 하고 그냥 돌렸더니 종료코드가 늘 1이었다.**
#   그래서 진짜 실패(그날 corpusleak이 실제로 깨져 있었다)가 「원래 실패하는 둘」에 묻혀
#   하마터면 통과로 읽을 뻔했다. 못 도는 것은 **실제로 빼야** 종료코드가 뜻을 갖는다.
#   ⚠ 파일을 콕 집어 부른 경우(인자 있음)에는 빼지 않는다 — 부른 사람 뜻이 우선이다.
SKIPPED=0
if [ $# -eq 0 ]; then
  for f in no-hardcoded-credentials shotlist; do
    [ -f "$DST/test/$f.test.ts" ] && rm -f "$DST/test/$f.test.ts" && SKIPPED=$((SKIPPED+1))
  done
  echo "제외 $SKIPPED개(이 사본에서 구조적으로 못 도는 것) — 남은 시험만 돌립니다."
  echo "  → 이제 종료코드 0 = **진짜 전부 통과**, 1 = **진짜 실패가 있다**."
fi

echo "=== 실행 ==="
cd "$DST" || exit 1
START=$(date +%s)
npx vitest run "$@"
CODE=$?
END=$(date +%s)
echo
echo "⏱ $((END-START))초  ·  종료코드 $CODE"
echo "   (참고: 같은 시험이 Windows 호스트에서는 파일당 수 분~14분 — 전체는 못 끝낸다)"
if [ "$OWNED" = 1 ]; then
  echo "   사본 $DST_ROOT 을 지웁니다 — 이 결과는 **다른 실행과 섞이지 않은** 것입니다."
else
  echo "   사본 $DST_ROOT 은 그대로 둡니다(공용/지정 자리)."
fi
echo
if [ "$SKIPPED" -gt 0 ]; then
  echo "⚠ 위 결과에서 **$SKIPPED개를 빼고** 잰 것입니다: $SKIP_NOTE"
  echo "   → 이 둘은 Windows에서 **각 0.5초**로 끝난다(무거운 import가 없어서다 — 2026-08-10 실측)."
  echo "     PowerShell:  cd 'D:\\Connect AI\\server'; npx vitest run test/no-hardcoded-credentials.test.ts test/shotlist.test.ts"
  echo "   두 쪽을 다 돌려야 「서버 시험 전부 통과」라고 말할 수 있다."
fi
exit $CODE
