#!/bin/bash
# tools/ladder/common.sh — 3일 증류 사다리(계획서 §12)의 공통 조각. **source 해서 쓴다**(직접 실행 아님).
#
# ⚠ 변수·함수 이름은 영문만 — bash는 한글 식별자를 못 읽는다(wsl-test.sh가 2026-08-10에 밟은 자리).
#   주석은 한글로, 왜를 적는다.
#
# 여기 있는 것:
#   ladder_need_env    — 비밀값이 env에 있는지만 본다(값은 절대 찍지 않는다). 없으면 exit 3.
#   ladder_teacher_tps — 교사에게 짧은 요청 하나를 보내 tok/s를 잰다. 너무 느리면 멈춘다(exit 4).
#   ladder_have        — 산출물이 이미 있나(밤/낮 전환 판정에 쓴다).
#   ladder_log         — 시각이 찍힌 한 줄.
#
# ■ 왜 「멈춤」이 함수로 있나
#   밤새 도는 사다리는 **잘못된 채로 계속 도는 것**이 가장 비싸다. 두뇌가 스왑에 밀려 3 tok/s로
#   기어도 8080 /health는 200을 준다(붕괴해도 200이다) — 그래서 살아 있는지를 **속도로** 본다.
#   재료가 엉망인데 밤새 30만 토큰을 태우느니, 첫 회차에서 멈추고 아침에 사람이 보는 편이 싸다.

# 비밀값은 env에서만 받는다. 파일·인자·로그 어디에도 적지 않는다.
LADDER_MIN_TPS="${LADDER_MIN_TPS:-8}"                       # 교사 최저 속도(tok/s). 평시 24.5의 3분의 1 — 이 밑은 「밀려 있다」로 본다.
LADDER_ENDPOINT="${LADDER_ENDPOINT:-http://10.8.0.12:4000/api/llm/serve/v1}"  # 정식 창구(gb10 4000). 8080에 직접 붙지 않는다 — 제품이 쓰는 길로 잰다.
LADDER_SLOTS_URL="${LADDER_SLOTS_URL:-}"                    # gb10 안에서 돌 때만 채운다(http://127.0.0.1:8080/slots). 남이 두뇌를 쓰는지 본다.

ladder_log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# ladder_need_env VAR [VAR...] — 하나라도 비어 있으면 exit 3.
# ⚠ 값을 찍지 않는다. 「있다/없다」만 말한다.
ladder_need_env() {
  local missing=0 v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      echo "✗ 환경변수 $v 가 비어 있다." >&2
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    cat >&2 <<'EOF'

  비밀값은 env로만 받는다 — 스크립트·설정 파일·로그에 적지 않는다.
    export GIJO_ADMIN_USER=...      (편입·승인은 admin 계정)
    export GIJO_ADMIN_PASSWORD=...  (win 사용자 환경변수 GIJO_ADMIN_PASSWORD와 같은 값)
    export GIJO_SERVE_TOKEN=...     (gb10 화면 「원격 GPU 내주기」가 만들어 준 접속 토큰)
EOF
    exit 3
  fi
}

# ladder_slots_busy — 교사 슬롯 중 지금 돌고 있는 수를 찍는다. 모르면 -1.
# ⚠ 왜 필요한가(2026-09-03 실측): 남이 같은 두뇌를 쓰는 중에 재면 **그 사람의 부하를 재게 된다.**
#   그날 첫 측정이 0.98 tok/s로 나와 「두뇌가 죽었다」로 읽힐 뻔했는데, /slots를 보니 다른 작업이
#   슬롯 하나를 물고 있었다. 그래서 속도 판정 앞에 이걸 먼저 본다.
ladder_slots_busy() {
  if [ -z "$LADDER_SLOTS_URL" ]; then echo "-1"; return; fi
  local body
  body="$(curl -s -m 5 "$LADDER_SLOTS_URL" 2>/dev/null)" || { echo "-1"; return; }
  if [ -z "$body" ]; then echo "-1"; return; fi
  printf '%s' "$body" | tr ',' '\n' | grep -c '"is_processing":true'
}

# ladder_teacher_tps — 짧은 요청 하나로 교사 속도를 잰다.
#   한가할 때 느리면 멈춘다(exit 4). 남이 쓰는 중이면 경고만 하고 지나간다(그 숫자는 남의 부하다).
ladder_teacher_tps() {
  local busy tps
  busy="$(ladder_slots_busy)"
  tps="$(GIJO_SERVE_TOKEN="${GIJO_SERVE_TOKEN:-}" node -e '
    const base = process.argv[1];
    const headers = { "content-type": "application/json" };
    if (process.env.GIJO_SERVE_TOKEN) headers["x-gijo-serve-token"] = process.env.GIJO_SERVE_TOKEN;
    const body = { model: "local", temperature: 0, max_tokens: 48, cache_prompt: false,
      messages: [{ role: "user", content: "취약점 관리 절차를 한 문장으로 말해라. 한국어로." }] };
    const t0 = Date.now();
    fetch(base + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(180000) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok) { console.error("교사 응답 실패: " + JSON.stringify(j).slice(0, 160)); console.log("0"); return; }
        const t = j.timings || {};
        // ⚠ timings가 없으면 벽시계로 대신 잰다 — 창구를 지나면 프록시가 timings를 지우는 판본이 있다.
        const gen = t.predicted_n ?? j.usage?.completion_tokens ?? 0;
        const tps = t.predicted_per_second ?? (gen ? gen / ((Date.now() - t0) / 1000) : 0);
        console.log(String(Math.round(tps * 100) / 100));
      })
      .catch((e) => { console.error("교사에 못 닿았다: " + e.message); console.log("0"); });
  ' "$LADDER_ENDPOINT" 2>&1 | tail -1)"

  ladder_log "교사 속도 ${tps} tok/s (슬롯 점유 ${busy}, 하한 ${LADDER_MIN_TPS})"

  # 소수 비교는 awk로 — bash는 정수만 견준다.
  if [ "$busy" -gt 0 ] 2>/dev/null; then
    ladder_log "⚠ 남이 교사를 쓰는 중이다(슬롯 ${busy}) — 이 숫자는 남의 부하가 섞였다. 하한 검사는 건너뛴다."
    return 0
  fi
  if awk -v a="$tps" -v b="$LADDER_MIN_TPS" 'BEGIN { exit !(a + 0 < b + 0) }'; then
    echo "✗ 교사가 ${tps} tok/s — 하한 ${LADDER_MIN_TPS} 미만이라 멈춘다." >&2
    echo "  8080 /health는 붕괴해도 200을 준다. 「살아 있나」가 아니라 「제 속도인가」로 본다." >&2
    echo "  볼 곳: free -h(스왑) · nvidia-smi · pgrep -af llama-server. ⚠ 8080 재기동은 제품 관리라 여기서 하지 않는다." >&2
    exit 4
  fi
  return 0
}

# ladder_have <경로> — 산출물이 이미 있나(0=있다). 밤/낮 전환은 **파일 존재**로 가른다.
# ⚠ 왜 파일인가: 「어제 밤에 돌았나」를 로그로 세면 사람이 눈으로 뒤져야 한다. 파일이면 스크립트가
#   스스로 답한다 — 재실행해도 앞 회차를 안 덮는 것과 같은 이유다.
ladder_have() { [ -s "$1" ]; }

# ladder_repo — 저장소 뿌리(이 파일 기준 두 칸 위).
ladder_repo() { cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd; }
