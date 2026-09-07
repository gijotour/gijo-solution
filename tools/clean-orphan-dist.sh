#!/bin/bash
# tools/clean-orphan-dist.sh — **소스에서 지운 파일이 운영 dist에 남아 있는 것을 치운다.**
#
# 사용:  bash tools/clean-orphan-dist.sh <서버루트> [--dry-run]
#   예:  bash "/mnt/d/Connect AI/tools/clean-orphan-dist.sh" /home/gijo/gijo-as/server
#
# ■ 왜 있나
#   배포(tools/deploy-prod.ps1 3단계)는 `rsync -a --delete`로 src/를 저장소와 똑같이 맞추지만,
#   dist/는 tsc가 **만들 뿐 지우지 않는다.** 그래서 화면·엔진을 통째로 내려도 운영 디스크에는
#   옛 .js가 계속 살아 있다(2026-09-07 merge.ts 삭제가 그 예다).
#   나쁜 이유 셋 — 전부 이 저장소가 실제로 겪은 부류다:
#     ① 아무도 안 부르는 코드가 남아, 다음 사람이 「아직 있는 기능」으로 읽는다.
#     ② 옛 모듈이 남아 있으면 잘못 살아난 import 하나로 **지웠다고 믿은 창구가 다시 열린다.**
#     ③ 소스 감시(「흔적 0건」 시험)는 src만 본다 — 운영 dist의 잔재를 원리상 못 잡는다.
#
# ■ 어떻게 지우나 — **참조 0을 확인한 것만**
#   살아남은 dist의 .js가 아직 그 모듈을 부르면 지우지 않고 `REF|`로 알린다. 부르는데 지우면
#   다음 기동이 MODULE_NOT_FOUND로 죽고, 그것은 배포 사고다. 참조가 남아 있다는 것은
#   「반쪽 삭제」라는 뜻이므로 **사람이 볼 자리**다.
#   ⚠ 낱말 겹침을 조심한다 — `engine/foo`는 `engine/foobar`에도 들어 있다. 뒤에 이름 글자가
#     아닌 것이 와야 진짜 참조다(`[^A-Za-z0-9_-]`).
#
# ■ 범위는 dist/engine/*.js 뿐이다
#   · copy-assets.mjs가 넣는 자료는 .json이라 여기 안 걸린다(지워질 위험이 없다).
#   · dist 최상위·다른 폴더는 진입점·부수 파일이 섞여 있어 이 잣대(같은 이름의 .ts가 있나)로
#     재면 위험하다. 넓히려면 그 폴더의 생성 규칙을 먼저 확인할 것.
#
# ■ 출력 규약 — 부르는 쪽(PowerShell)이 파싱한다. 바꾸면 deploy-prod.ps1도 함께 볼 것.
#   DEL|<이름>        지웠다(소스 없음 + 참조 0)
#   REF|<이름>|<수>   소스는 없는데 아직 <수>개 파일이 부른다 — 안 지웠다
#   (--dry-run이면 지우지 않고 DRY|<이름>만 낸다)

srv="$1"
mode="$2"

if [ -z "$srv" ]; then
  echo "ERR|서버 루트를 안 줬다 — 사용: bash clean-orphan-dist.sh <서버루트> [--dry-run]" >&2
  exit 2
fi
# ⚠ 없는 경로에 조용히 성공하지 않는다 — 그러면 「고아 0건」이 거짓말이 된다.
if [ ! -d "$srv/dist/engine" ] || [ ! -d "$srv/src/engine" ]; then
  echo "ERR|$srv 에 dist/engine 또는 src/engine이 없다 — 경로를 확인할 것" >&2
  exit 3
fi

cd "$srv" || exit 3

for f in dist/engine/*.js; do
  [ -e "$f" ] || continue                      # 하나도 없으면 glob 그대로 들어온다
  b=$(basename "$f" .js)
  [ -f "src/engine/$b.ts" ] && continue        # 소스가 있으면 고아가 아니다
  n=$(grep -rlE "engine/$b[^A-Za-z0-9_-]" dist --include=*.js 2>/dev/null | grep -cv "^dist/engine/$b\.js$")
  if [ "${n:-0}" -gt 0 ]; then
    echo "REF|$b|$n"
  elif [ "$mode" = "--dry-run" ]; then
    echo "DRY|$b"
  else
    rm -f "dist/engine/$b.js" "dist/engine/$b.js.map" "dist/engine/$b.d.ts"
    echo "DEL|$b"
  fi
done
