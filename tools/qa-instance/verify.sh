#!/usr/bin/env bash
# verify.sh — 고객 QA 인스턴스(4100)가 성하고, **운영(4000·8080·8081)이 무사한지** 함께 잰다.
#
# ■ 이 검사의 요점은 4100이 아니라 운영이다
#   4100은 운영의 llama-server를 공유한다. 그래서 "4100이 뜬다"만 재면 절반이다 —
#   기동 전후로 운영 llama PID가 같은지, 운영 health가 그대로인지가 진짜 관문이다.
#
# ⚠ 2026-09-10 검토관 [상]: 첫 판은 그 「진짜 관문」을 **찍기만 하고 비교하지 않았다.**
#   운영 llama가 죽어 PID가 바뀌어도 「종합: 통과」·종료코드 0이 났다 — 저장소가 가장
#   경계하는 거짓 통과다. 이제 두 갈래로 판정한다:
#     ① 기준선을 주면(위치 인자) llama PID 집합·4000 health를 **문자열로 비교**해 다르면 실패.
#     ② 기준선을 안 주면 「지금 운영이 성한가」를 절대 조건으로 판정(health ok + llama ≥ 1개).
#   기준선 없이도 운영이 죽으면 빨강이 나야 한다 — 안 주는 쪽이 더 헐거워지면 안 쓰게 된다.
#
# ⚠ 변수 이름은 **영문만** 쓴다. 한글 변수명은 POSIX 셸에서 이름으로 안 쳐서
#   `이름=값`이 "command not found"가 되고, 스크립트가 **조용히 반쪽으로 돈다**
#   (2026-09-10 실측: 첫 판이 그렇게 돌아 거짓 실패를 냈다). 한글은 주석·출력문에만.
#
# 사용:
#   기준선 잡기:  bash tools/qa-instance/verify.sh --baseline > /home/gijo/gijo-qa/tmp-review/baseline.txt
#   검사:         bash tools/qa-instance/verify.sh [기준선파일]
set -uo pipefail

QA_ROOT=${QA_ROOT:-/home/gijo/gijo-qa}
FAIL=0
# 「대화 수집 실패」도 넣는다 — 채팅은 200인데 chat_logs에 아무것도 안 쌓이던 것을
# 첫 판이 못 잡았다(2026-09-10 검토관 [중]). 고객 QA의 존재 이유가 그 수집이다.
BAD_RE='고아 llama-server 정리|임베딩 서버 hang|채팅 모델 hang|무응답 감지|대화 수집 실패'

llama_pids() { pgrep -f '[l]lama-server' | sort | tr '\n' ' '; }

if [ "${1:-}" = "--baseline" ]; then
  echo "llama=$(llama_pids)"
  echo "health4000=$(curl -s --max-time 5 http://localhost:4000/api/health)"
  exit 0
fi

BASELINE=${1:-}

echo "── 운영(건드리면 안 되는 것) ──"
NOW_LLAMA=$(llama_pids)
NOW_H4000=$(curl -s --max-time 5 http://localhost:4000/api/health || echo '')
echo "  llama-server PID: ${NOW_LLAMA:-(없음)}"
echo "  4000 health: ${NOW_H4000:-(응답 없음)}"

# ① 절대 조건 — 기준선이 없어도 운영이 죽었으면 빨강이다.
if echo "$NOW_H4000" | grep -q '"ok":true'; then
  echo "  ✓ 운영 health ok"
else
  echo "  ✗ 운영 4000이 ok가 아니다 — 우리가 죽였는지부터 확인할 것."; FAIL=1
fi
if [ -n "$NOW_LLAMA" ]; then
  echo "  ✓ llama-server 살아 있음($(echo "$NOW_LLAMA" | wc -w)개)"
else
  echo "  ✗ llama-server가 하나도 없다 — 운영 채팅·RAG가 죽은 상태다."; FAIL=1
fi

# ② 기준선 비교 — 기동 전에 잡아 둔 값과 **문자열로** 맞춰 본다.
if [ -n "$BASELINE" ]; then
  if [ ! -f "$BASELINE" ]; then
    echo "  ✗ 기준선 파일이 없다: $BASELINE"; FAIL=1
  else
    BASE_LLAMA=$(grep -m1 '^llama=' "$BASELINE" | cut -d= -f2-)
    BASE_H4000=$(sed -n 's/^health4000=//p' "$BASELINE" | head -1)
    if [ "$NOW_LLAMA" = "$BASE_LLAMA" ]; then
      echo "  ✓ 기준선과 llama PID 동일: ${BASE_LLAMA:-(없음)}"
    else
      echo "  ✗ llama PID가 바뀌었다 — 기준선 [${BASE_LLAMA:-(없음)}] → 지금 [${NOW_LLAMA:-(없음)}]"
      echo "    (운영 llama가 죽거나 다시 떴다는 뜻이다. 4100이 죽였는지 로그를 볼 것.)"; FAIL=1
    fi
    # health는 serverTime이 매번 달라 통째로 비교하면 늘 다르다 — 뜻이 있는 칸만 본다.
    base_field() { echo "$1" | sed -n "s/.*\"$2\":\([^,}]*\).*/\1/p"; }
    for f in ok service; do
      if [ "$(base_field "$NOW_H4000" "$f")" != "$(base_field "$BASE_H4000" "$f")" ]; then
        echo "  ✗ 운영 health의 $f 칸이 기준선과 다르다"; FAIL=1
      fi
    done
    if [ "$(echo "$NOW_H4000" | sed -n 's/.*"schema":{"count":\([0-9]*\).*/\1/p')" != "$(echo "$BASE_H4000" | sed -n 's/.*"schema":{"count":\([0-9]*\).*/\1/p')" ]; then
      echo "  ✗ 운영 schema.count가 기준선과 다르다 — 운영이 재시작·마이그레이션됐다."; FAIL=1
    fi
    [ "$FAIL" -eq 0 ] && echo "  ✓ 운영 health 기준선과 동일(ok·service·schema.count)"
  fi
else
  echo "  · 기준선 파일을 안 줬다 — PID 비교는 **못 했다**(절대 조건만 봤다)."
  echo "    기동 전에 잡아 두는 것이 옳다: bash $0 --baseline > $QA_ROOT/tmp-review/baseline.txt"
fi

echo "── 4100 ──"
H=$(curl -s --max-time 5 http://localhost:4100/api/health || echo '')
if echo "$H" | grep -q '"ok":true'; then
  echo "  health: $H"
else
  echo "  ✗ health 실패: ${H:-(응답 없음)}"; FAIL=1
fi

echo "── 자물쇠 ──"
MODELS_DIR=$(grep -E '^GIJO_MODELS_DIR=' "$QA_ROOT/gijo-qa.env" 2>/dev/null | cut -d= -f2-)
if [ -n "$MODELS_DIR" ] && [ -z "$(ls -A "$MODELS_DIR" 2>/dev/null)" ]; then
  echo "  ✓ 모델 폴더 비어 있음: $MODELS_DIR"
else
  echo "  ✗ 모델 폴더가 비어 있지 않다(${MODELS_DIR:-미지정}) — 운영 llama가 죽을 수 있다."; FAIL=1
fi
if [ -n "$MODELS_DIR" ] && [ -w "$MODELS_DIR" ]; then
  echo "  ✗ 모델 폴더에 쓰기 권한이 있다 — 가동 중에 파일이 생기면 감시가 무장한다(chmod 555)."; FAIL=1
elif [ -n "$MODELS_DIR" ]; then
  echo "  ✓ 모델 폴더 쓰기 금지(chmod 555)"
fi
# 두 번째 자물쇠 — 임베딩 감시가 **죽이는** 포트가 운영 8081이면 안 된다.
EMB_PORT=$(grep -E '^GIJO_EMBEDDING_PORT=' "$QA_ROOT/gijo-qa.env" 2>/dev/null | cut -d= -f2-)
if [ -n "$EMB_PORT" ] && [ "$EMB_PORT" != "8081" ]; then
  echo "  ✓ 임베딩 감시가 겨냥하는 포트 분리됨: $EMB_PORT (읽기는 GIJO_EMBEDDING_URL=8081)"
else
  echo "  ✗ GIJO_EMBEDDING_PORT가 없거나 8081이다 — 감시가 무장하면 운영 임베딩을 죽인다."; FAIL=1
fi
if grep -qE '^GIJO_DEV_MODE=' "$QA_ROOT/gijo-qa.env" 2>/dev/null; then
  echo "  ✗ GIJO_DEV_MODE가 env에 있다 — 등급 게이트가 꺼진다(계획서 §14 ①)."; FAIL=1
else
  echo "  ✓ GIJO_DEV_MODE 없음(등급 게이트 켜짐)"
fi
# 자기 하드닝 점검 격리 — 없으면 우리 호스트 OS 설정이 고객에게 나간다(2026-09-10 예행 ㉔).
#   preflight가 기동을 막는 자물쇠와 **같은 줄**을 본다(gijo-qa.service 머리글 표가 단일 출처).
if grep -qE '^GIJO_NO_SELF_SCAN=1$' "$QA_ROOT/gijo-qa.env" 2>/dev/null; then
  echo "  ✓ 자기 하드닝 점검 꺼짐(GIJO_NO_SELF_SCAN=1)"
else
  echo "  ✗ GIJO_NO_SELF_SCAN=1이 env에 없다 — 「이 서버 자신」 점검 결과가 고객에게 나갈 수 있다."; FAIL=1
fi
if grep -qE '^GIJO_INITIAL_ADMIN_PASSWORD=' "$QA_ROOT/gijo-qa.env" 2>/dev/null; then
  echo "  ✗ GIJO_INITIAL_ADMIN_PASSWORD가 env에 남아 있다 — 시딩이 끝나면 지운다(노출면만 넓어진다)."; FAIL=1
else
  echo "  ✓ 초기 관리자 비밀번호 줄 없음"
fi

echo "── 평문 사본(§14 ② DB 암호화) ──"
PLAIN=$(find "$QA_ROOT/data" -maxdepth 2 -name '*.sqlite*' -type f -exec sh -c 'head -c 15 "$1" | grep -q "SQLite format 3" && echo "$1"' _ {} \; 2>/dev/null)
if [ -z "$PLAIN" ]; then
  echo "  ✓ 평문 sqlite 0건"
else
  echo "  ✗ 평문 sqlite가 있다 — 암호화가 무력해진다:"; echo "$PLAIN" | sed 's/^/     /'; FAIL=1
fi

echo "── 로그에 남으면 안 되는 문구 ──"
# 「고아 정리를 건너뜁니다」는 **정상**(형제를 알아본 것)이라 세지 않는다.
# ⚠ `grep -c`는 0건일 때 0을 찍고 **종료코드 1**을 낸다 — `|| echo 0`을 붙이면
#   "0\n0"이 되어 비교가 깨진다. `|| true`로 종료코드만 삼킨다.
# ⚠ 파일이 **없을 때도** 빈 값이 온다 — 그것을 0으로 읽으면 "검사한 적 없는데 ✓ 0건"이
#   된다(2026-09-10 검토관 [하]). 그래서 존재부터 본다.
if [ ! -f "$QA_ROOT/server.log" ]; then
  echo "  ✗ 로그 파일이 없다($QA_ROOT/server.log) — 검사를 못 했다. 유닛으로 옮겼다면 로그 경로를 맞출 것."; FAIL=1
else
  BAD=$(grep -cE "$BAD_RE" "$QA_ROOT/server.log" 2>/dev/null || true)
  BAD=${BAD:-0}
  if [ "$BAD" -eq 0 ]; then
    echo "  ✓ 0건"
  else
    echo "  ✗ ${BAD}건 — 운영 llama를 건드렸거나 대화 수집이 깨졌다. 즉시 확인할 것:"
    grep -nE "$BAD_RE" "$QA_ROOT/server.log" | tail -5
    FAIL=1
  fi
  SIB=$(grep -c '다른 GIJO 서버' "$QA_ROOT/server.log" 2>/dev/null || true)
  SIB=${SIB:-0}
  echo "  · 「다른 GIJO 서버가 돌고 있어 고아 정리를 건너뜁니다」 ${SIB}건 — 이것은 **정상**(운영을 알아봤다는 뜻)"
fi

echo
echo "· 고객이 실제로 쓰는 대화창 경로(POST /api/dispatch)와 대화 수집은 이 스크립트가 못 잰다 —"
echo "  자격이 필요하다: QA_USER=… QA_PASS=… node tools/qa-instance/chat-probe.mjs"
if [ "$FAIL" -eq 0 ]; then echo "종합: 통과"; else echo "종합: ✗ 실패 — 위 ✗ 항목을 볼 것"; fi
exit "$FAIL"
