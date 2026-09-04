#!/bin/bash
# tools/ladder/gb10-sync-results.sh — gb10에서 돌린 **회전 결과를 win으로 가져오고**, 커밋한 뒤
#   gb10 쪽 사본을 지우고 push까지 한 벌로 끝낸다. **win에서** 실행한다.
#
# ■ 왜 있나 (2026-09-04 실사고 — 두 번 겪었다)
#   gb10은 `receive.denyCurrentBranch=updateInstead`라 win에서 push하면 **작업트리까지 갱신**된다.
#   그런데 갱신하려는 파일이 gb10 쪽에 **untracked로 그대로 있으면** git이 거부한다:
#     「Updating would lose untracked files … 」 → push 자체가 실패한다.
#   사슬이 결과를 gb10 폴더에 만들고, 그 결과를 우리가 win에서 커밋하니 **늘 이 꼴이 된다.**
#   그래서 순서를 고정한다: 가져오기 → (사람이) 커밋 → **gb10 쪽 그 파일 지우기** → push → 확인.
#
# ■ 이 스크립트가 하지 않는 것
#   · **커밋을 대신 하지 않는다.** 무엇을 저장소에 남길지는 사람이 본다(결과에 고객 자료가 섞이면
#     되돌릴 수 없다 — 「먼저 보고 커밋한다」가 이 저장소의 규칙이다).
#   · gb10에서 학습·측정을 돌리지 않는다. 이 자는 **옮기는 자**다.
#   · GitHub(origin)에 밀지 않는다(사용자 요청 시에만).
#
# 사용:
#   bash tools/ladder/gb10-sync-results.sh <회전>            # 가져오기만(커밋 전)
#   bash tools/ladder/gb10-sync-results.sh <회전> --after-commit   # 커밋한 뒤: gb10 청소 → push → 확인
#   예) bash tools/ladder/gb10-sync-results.sh r2-v2
#       git add tools/team-bench/results-ladder/day2/r2-v2 && git commit …
#       bash tools/ladder/gb10-sync-results.sh r2-v2 --after-commit
#
# 나가는 코드: 0=정상 · 2=쓰는 법 틀림 · 5=가져올 것이 없음 · 8=단계 실패
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/ladder/common.sh
. "$HERE/common.sh"
REPO="$(ladder_repo)"

ROUND="${1:-}"
STAGE="${2:-fetch}"
GB10="${LADDER_GB10_HOST:-gb10}"
GB10_REPO="${LADDER_GB10_REPO:-~/gijo-as}"
REL="tools/team-bench/results-ladder/day2"

case "$ROUND" in
  ""|--*) echo "쓰는 법: bash tools/ladder/gb10-sync-results.sh <회전> [--after-commit]" >&2; exit 2 ;;
esac
case "$STAGE" in
  fetch|--after-commit) ;;
  *) echo "✗ 모르는 인자: $STAGE (--after-commit 만 받는다)" >&2; exit 2 ;;
esac

LOCAL_DIR="$REPO/$REL/$ROUND"

if [ "$STAGE" = "fetch" ]; then
  ladder_log "① gb10에서 가져오기 — $GB10:$GB10_REPO/$REL/$ROUND → $LOCAL_DIR"
  # 있는지 먼저 본다 — 없는 것을 가져온 척하지 않는다.
  if ! ssh "$GB10" "[ -d $GB10_REPO/$REL/$ROUND ]"; then
    echo "✗ gb10에 그 회전 폴더가 없다: $GB10_REPO/$REL/$ROUND" >&2
    exit 5
  fi
  mkdir -p "$REPO/$REL"
  # ⚠ 로그·pid는 안 가져온다 — .gitignore가 막는 부스러기이고, 용량만 크다(train.log 40KB+).
  #   가져올 것은 **판정에 쓰이는 것**뿐이다: 결과 JSON·게이트 표·설정 사본.
  scp -q -r "$GB10:$GB10_REPO/$REL/$ROUND" "$REPO/$REL/" || { echo "✗ scp 실패" >&2; exit 8; }
  find "$LOCAL_DIR" \( -name '*.log' -o -name '*.pid' \) -delete
  ladder_log "   가져왔다. 파일 $(find "$LOCAL_DIR" -type f | wc -l)개"
  echo
  echo "→ 다음은 **사람이** 한다(무엇을 남길지는 눈으로 본다):"
  echo "   git add $REL/$ROUND && git commit"
  echo "   그 다음: bash tools/ladder/gb10-sync-results.sh $ROUND --after-commit"
  exit 0
fi

# ── --after-commit: gb10 청소 → push → 확인 ─────────────────────────
ladder_log "② 커밋에 든 파일 목록을 뽑는다(gb10에서 지울 것)"
FILES="$(cd "$REPO" && git ls-files "$REL/$ROUND")"
if [ -z "$FILES" ]; then
  echo "✗ 커밋된 파일이 없다: $REL/$ROUND — 먼저 커밋해라(이 자는 커밋을 대신 하지 않는다)" >&2
  exit 5
fi
ladder_log "   커밋에 든 파일 $(printf '%s\n' "$FILES" | wc -l)개"

ladder_log "③ gb10 쪽 **그 파일들만** 지운다 — 남아 있으면 push가 작업트리를 못 바꾼다"
# ⚠ 지우는 것은 **커밋에 든 파일 이름 그대로**다. 폴더를 통째로 지우지 않는다(어댑터·로그가 거기 있다).
printf '%s\n' "$FILES" | ssh "$GB10" "cd $GB10_REPO && xargs -d '\n' -r rm -f --" \
  || { echo "✗ gb10 청소 실패" >&2; exit 8; }

ladder_log "④ push"
(cd "$REPO" && git push gb10 main) || { echo "✗ push 실패 — 위 오류를 읽어라(untracked 충돌이면 그 파일 이름이 찍힌다)" >&2; exit 8; }

# ★ push 결과를 **세어서** 확인한다(2026-09-04 규칙): 「밀었다」는 말은 증거가 아니다.
ladder_log "⑤ 확인 — 0 0 이어야 한다(앞=밀 것 남음 · 뒤=받을 것 남음)"
(cd "$REPO" && git fetch -q gb10 && git rev-list --count --left-right main...gb10/main)
