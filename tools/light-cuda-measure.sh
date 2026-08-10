#!/usr/bin/env bash
# 라이트 CUDA 실측 — 7.6B(gijo-main-orchestrator)@ctx8192 · bge-m3@ctx/batch2048
# 운영 14B(8080)+bge(8081)은 그대로 두고 별도 포트에 갓 띄워 "증분"으로 각 모델 점유를 잰다.
# 예열 2회(RSS/버퍼 확정 함정 회피) 뒤 측정. cwd=server(models 상대경로).
set -u
cd /home/gijo/gijo-as/server
BIN=/home/gijo/gijo-as/llama.cpp/build/bin/llama-server
smi() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits; }
wait_health() { for i in $(seq 1 60); do curl -sf "localhost:$1/health" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

BASE=$(smi)
echo "BASELINE_MIB=$BASE   (운영 14B+bge 상주)"

# ── 7.6B @ ctx 8192 (라이트 기반 두뇌 단독) ──────────────────────
"$BIN" -m models/gijo-main-orchestrator/gijo-main-orchestrator.gguf \
  -ngl -1 --ctx-size 8192 --port 8095 > /tmp/l76.log 2>&1 &
P76=$!
if wait_health 8095; then
  curl -s localhost:8095/completion -d '{"prompt":"hello world","n_predict":24}' >/dev/null 2>&1
  curl -s localhost:8095/completion -d '{"prompt":"second warmup pass","n_predict":24}' >/dev/null 2>&1
  sleep 2
  A76=$(smi)
  echo "AFTER_76B_8192_MIB=$A76   DELTA_76B=$((A76-BASE))"
else
  echo "AFTER_76B_8192_MIB=FAIL_HEALTH"; tail -5 /tmp/l76.log
fi
kill "$P76" 2>/dev/null; sleep 5

# ── bge-m3 @ ctx/batch/ubatch 2048 (라이트 임베딩) ──────────────
"$BIN" -m models/bge-m3/bge-m3.gguf --embedding \
  -ngl -1 --ctx-size 2048 --batch-size 2048 --ubatch-size 2048 --port 8096 > /tmp/lbge.log 2>&1 &
PB=$!
if wait_health 8096; then
  curl -s localhost:8096/embedding -d '{"content":"security posture check"}' >/dev/null 2>&1
  curl -s localhost:8096/embedding -d '{"content":"vulnerability scan report"}' >/dev/null 2>&1
  sleep 2
  AB=$(smi)
  echo "AFTER_BGE_2048_MIB=$AB   DELTA_BGE=$((AB-BASE))"
else
  echo "AFTER_BGE_2048_MIB=FAIL_HEALTH"; tail -5 /tmp/lbge.log
fi
kill "$PB" 2>/dev/null; sleep 4

FIN=$(smi)
echo "FINAL_MIB=$FIN   (BASELINE 근처면 kill 정상 · 잔여=$((FIN-BASE)))"
