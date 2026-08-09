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
  --include='vitest.config.*' --include='requirements.txt' --include='modelscan_wrapper.py' \
  --include='docs-manifest.json' --include='docs/***' \
  --exclude='*' \
  "$SRC/" "$DST/" || { echo "✗ server 동기화 실패"; exit 1; }
# ⚠ client도 가져간다: 시험 일부가 **화면 파일을 소스로 읽는다**(office.html 등).
#   안 넣었다가 40개가 ENOENT로 실패했다 — 제품 결함이 아니라 사본 결함이었다.
mkdir -p "$DST_ROOT/client"
rsync -a --delete --include='src/***' --include='package.json' --exclude='*' \
  "$SRC_ROOT/client/" "$DST_ROOT/client/" || { echo "✗ client 동기화 실패"; exit 1; }
# 저장소 뿌리의 knowledge/·tools/·mockups/를 읽는 시험도 있다.
for d in knowledge tools mockups; do
  [ -d "$SRC_ROOT/$d" ] && rsync -a --delete "$SRC_ROOT/$d/" "$DST_ROOT/$d/" 2>/dev/null
done
# ⚠ 뿌리의 제품 문서(*.md)도 필요하다 — docs-manifest 정합성·코퍼스 감시·용어사전 시험이
#   「매니페스트에 적힌 파일이 실제로 있는가」를 본다. 없으면 **감시가 헛돌지 않는지 보는
#   시험**까지 빨간불이 난다(그게 이 사본에서 처음 6건이 실패한 이유였다).
rsync -a --include='*.md' --exclude='*/' --exclude='*' "$SRC_ROOT/" "$DST_ROOT/" 2>/dev/null
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
echo "⚠ 이 사본에서 **구조적으로 못 도는 시험 2개**: $SKIP_NOTE"
echo "   → Windows 호스트에서 따로 돌릴 것. 「WSL에서 전부 통과」는 이 둘을 뺀 말이다."
exit $CODE
