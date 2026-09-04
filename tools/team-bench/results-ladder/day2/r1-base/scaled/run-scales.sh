#!/bin/bash
# 무학습 진단 — r1-base 어댑터 세기 0.75/0.5/0.25 재측정. 학습 없음. 8093만 쓴다.
set -u
REPO=$HOME/gijo-as
BIN=$REPO/server/llama.cpp-next/build/bin/llama-server
MODEL=$REPO/server/models/qwen3-14b/qwen3-14b.gguf
GG=$REPO/tools/team-bench/results-ladder/day2/r1-base/adapter.gguf
SC=$HOME/bench/ladder/scaled
BASEOUT=$REPO/tools/team-bench/results-ladder/day2/r1-base/scaled

for s in 0.75 0.5 0.25; do
  D=$SC/$s
  OUT=$BASEOUT/$s
  ID="qwen3-14b+r1-base@$s"
  mkdir -p "$OUT"
  echo "===== scale $s : easy $(date -Is) ====="
  node "$D/run.mjs" --only "$ID" --port 8093 --ctx 32768 --out "$OUT/easy" 2>&1 | tee "$OUT/easy.log"
  echo "===== scale $s : hard $(date -Is) ====="
  node "$D/run-r2.mjs" --only "$ID" --port 8093 --ctx 65536 --out "$OUT/hard" 2>&1 | tee "$OUT/hard.log"
  echo "===== scale $s : kev $(date -Is) ====="
  nohup "$BIN" -m "$MODEL" -ngl -1 --ctx-size 32768 --parallel 1 --port 8093 --jinja \
    --reasoning off --reasoning-budget 0 --lora-scaled "$GG:$s" > "$OUT/kev.server.log" 2>&1 &
  SPID=$!
  echo "$SPID" > "$OUT/kev.server.pid"
  ok=0
  for i in $(seq 1 150); do
    if [ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:8093/health 2>/dev/null)" = "200" ]; then ok=1; break; fi
    kill -0 "$SPID" 2>/dev/null || break
    sleep 2
  done
  if [ "$ok" = "1" ]; then
    curl -s http://127.0.0.1:8093/lora-adapters > "$OUT/lora-adapters.json"
    echo "적용된 scale: $(cat "$OUT/lora-adapters.json")"
    PORT=8093 node "$HOME/bench/ladder/kev3.mjs" "$OUT/kev.json" 2>&1 | tee "$OUT/kev.log"
  else
    echo "✗ KEV 서버 기동 실패 (scale $s)" | tee "$OUT/kev.log"
  fi
  kill -TERM "$SPID" 2>/dev/null
  for i in $(seq 1 25); do kill -0 "$SPID" 2>/dev/null || break; sleep 1; done
  kill -0 "$SPID" 2>/dev/null && { kill -9 "$SPID"; sleep 2; }
  sleep 3
done
echo "ALL DONE $(date -Is)"
