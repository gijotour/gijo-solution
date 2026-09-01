#!/usr/bin/env bash
# GB10(DGX Spark) 실측 탐침 — 읽기 전용. 파일을 만들지 않고 서비스도 건드리지 않는다.
# 서버 코드(localengine.ts·preflight.ts·pythonbin.ts·llamabin.ts)가 기대하는 값을 그 자리에서 그대로 재 본다.
# 사용: ssh gb10 'bash -s' < tools/review-2026-09-01/gb10-probe.sh | tee tools/review-2026-09-01/결과/gb10-probe.txt
set -u
say() { printf '\n=== %s ===\n' "$*"; }

say "머신"; uname -a; head -4 /etc/os-release 2>/dev/null; echo "CPU: $(nproc) cores"
say "메모리(free -g)"; free -g
say "/proc/meminfo"; grep -E 'MemTotal|MemAvailable|MemFree' /proc/meminfo

say "nvidia-smi 기본"; nvidia-smi 2>&1 | head -25 || echo "nvidia-smi 없음"
say "nvidia-smi 쿼리 — preflight.ts gpuAvailable()과 같은 인자"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1
say "nvidia-smi 쿼리 — localengine.ts getFreeVramMb()와 같은 인자"
nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>&1
say "nvidia-smi 쿼리 — localengine.ts getGpuUsage()와 같은 인자"
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>&1
say "nvidia-smi -q 메모리 절"; nvidia-smi -q 2>/dev/null | grep -A4 -i 'FB Memory Usage' | head -12

say "CUDA"; (nvcc --version 2>/dev/null | tail -2) || echo "nvcc 없음(PATH 밖일 수 있음)"; ls -d /usr/local/cuda* 2>/dev/null
say "Node"; node --version 2>/dev/null || echo "node 없음"; npm --version 2>/dev/null
say "Python"; python3 --version 2>/dev/null; python --version 2>/dev/null || echo "python(2자 명령) 없음 — pythonbin.ts가 python3로 폴백한다"

say "llama.cpp 바이너리"
for p in llama.cpp/build/bin/llama-server "${GIJO_LLAMA_SERVER_PATH:-}"; do
  if [ -n "$p" ] && [ -x "$p" ]; then echo "$p"; "$p" --version 2>&1 | head -2; fi
done
if command -v llama-server >/dev/null 2>&1; then command -v llama-server; llama-server --version 2>&1 | head -2; else echo "PATH에 llama-server 없음"; fi

say "네이티브 모듈 로드 — server/node_modules가 있을 때"
if [ -d server/node_modules ]; then
  ( cd server && for m in better-sqlite3 better-sqlite3-multiple-ciphers @lancedb/lancedb onnxruntime-node; do
      node -e "try{require('$m');console.log('OK   $m')}catch(e){console.log('FAIL $m: '+String(e.message).split('\n')[0])}"
    done )
else
  echo "server/node_modules 없음 — 저장소 server/ 에서 npm ci 뒤 다시 돌린다"
fi

say "/api/health — 서버가 떠 있을 때(한글 깨짐 방지로 curl 대신 Node fetch)"
if command -v node >/dev/null 2>&1; then
  node -e "fetch('http://localhost:4000/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.text()).then(t=>console.log(t.slice(0,400))).catch(e=>console.log('서버 응답 없음: '+e.message))"
fi
say "끝"
