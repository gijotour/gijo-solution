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
# 사용:  wsl -d Ubuntu-24.04 -- bash "/mnt/d/Connect AI/tools/wsl-test.sh" [vitest 인자...]
#   전체:      (인자 없이)
#   일부:      test/lawfallback.test.ts test/modelcatalog.test.ts
set -u
SRC_ROOT="/mnt/d/Connect AI"
DST_ROOT="/home/gijo/gijo-as-test"
SRC="$SRC_ROOT/server"
DST="$DST_ROOT/server"

if [ ! -d "$SRC" ]; then echo "✗ 원본을 찾지 못했습니다: $SRC"; exit 2; fi

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
[ -f "$SRC_ROOT/.gitignore" ] && cp "$SRC_ROOT/.gitignore" "$DST_ROOT/" 2>/dev/null
echo "  서버 소스 $(find "$DST/src" -name '*.ts' 2>/dev/null | wc -l)개 · 시험 $(find "$DST/test" -name '*.test.ts' 2>/dev/null | wc -l)개 · 클라 화면 $(find "$DST_ROOT/client/src" -name '*.html' 2>/dev/null | wc -l)개"

# node_modules는 매번 복사하지 않는다(수 GB). 운영 것을 심볼릭 링크로 빌려 쓴다 —
# ⚠ 읽기만 한다. 시험이 의존성을 고치는 일은 없다.
if [ ! -e "$DST/node_modules" ]; then
  ln -s /home/gijo/gijo-as/server/node_modules "$DST/node_modules"
  echo "  node_modules: 운영 것을 링크(읽기 전용 사용)"
fi

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
echo
if [ "$SKIPPED" -gt 0 ]; then
  echo "⚠ 위 결과에서 **$SKIPPED개를 빼고** 잰 것입니다: $SKIP_NOTE"
  echo "   → 이 둘은 Windows에서 **각 0.5초**로 끝난다(무거운 import가 없어서다 — 2026-08-10 실측)."
  echo "     PowerShell:  cd 'D:\\Connect AI\\server'; npx vitest run test/no-hardcoded-credentials.test.ts test/shotlist.test.ts"
  echo "   두 쪽을 다 돌려야 「서버 시험 전부 통과」라고 말할 수 있다."
fi
exit $CODE
