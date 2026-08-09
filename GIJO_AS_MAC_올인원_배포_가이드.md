# GIJO AS — macOS 올인원 배포 가이드 (1인 사용자)

**대상 시나리오**: 담당자 1명이 Mac 한 대(예: **M4 24GB**)에서 GIJO AS를 **서버 + 로컬 LLM까지 전부** 독립 구동. 원격관리 불필요, 자가 사용.

## 0. 결론 · 사양 판단
- **M4 24GB로 구동 가능** — 단, **단일 LLM 티어**(채팅 1개 + bge 임베딩). 통합메모리라 GPU(Metal)가 RAM을 공유하며, macOS(~6~8GB) 제외 실질 ~16GB를 모델이 쓴다.
- 속도: 기본 M4에서 7~8B Q4 대략 **15~22 tok/s** 추정(대역폭 120GB/s 비례). 1인 관제·요약·챗봇엔 충분. 다중 사용자·2모델 동시는 부적합(→ M4 Pro 48GB↑).
- **애플 공증($99)은 여전히 선택 — 다만 「서명 없이」는 이제 안 된다**(2026-08-09 정정).
  macOS 26에서 `identity:null`로만 빌드하면 첫 실행 때 **경고가 아니라 앱이 삭제된다**:
  「악성 코드가 차단되고 휴지통으로 이동함」. 원인은 서명이 없어서가 아니라 **깨져서**다 —
  서명 단계를 건너뛰면 Electron 원본의 ad-hoc 링커 서명이 남고(식별자가 `ai.gijo.as`가
  아니라 `Electron`, 리소스 봉인 없음), macOS는 이를 「정품 앱을 뜯어고쳤다」로 읽는다.
  → **ad-hoc 재서명은 필수**다. `client/build/mac-adhoc-sign.cjs`(afterSign 훅)가
    빌드 산출물 자체를 재서명한다. 인증서 없이 되고, 삭제가 사라진다(Mac 실증).
    첫 실행 「우클릭 → 열기」는 공증을 안 했으니 그대로 남는다 — 그건 경고일 뿐이다.
  ⚠ 훅 없이 만든 dmg는 **고객이 고칠 수 없다**(고객은 재서명 못 한다). 빌드에서 끝내야 한다.

## 1. Phase 1 — 크로스플랫폼 코드 (완료, Windows에서 작업됨)
이미 반영된 변경(현재 커밋):
- `client/package.json` → `build.mac`(dmg/zip, arm64) + `identity:null`(서명 스킵) 추가.
- `client/scripts/build-server-dist.mjs` → onnxruntime 네이티브 prune을 **빌드 플랫폼 기준 분기**(mac은 darwin 유지·win/linux 삭제). ← 이걸 안 하면 mac 설치본에서 darwin 바이너리가 통째로 지워져 임베딩/onnx가 죽음.
- `server/src/engine/localengine.ts` → nvidia-smi 없는 mac에서 **통합메모리를 VRAM으로 간주**(`getFreeVramMb`/`getGpuUsage` darwin 분기). 티어 자동판정·모델 스왑이 mac에서도 실수치로 동작.
- `server/src/engine/preflight.ts` → mac에서 GPU 체크를 **Apple Metal**로 정상 보고(경고 아님).
- `server/src/util/llamabin.ts` → **수정 불필요**. darwin은 이미 Unix 경로(`llama.cpp/build/bin/llama-server`)로 해석됨. `-ngl -1`도 Metal에서 동작.

## 2. Phase 2 — Mac에서만 (실장비 필요)

### 2-1. llama.cpp Metal 빌드
```bash
git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp
cmake -B build -DGGML_METAL=ON          # Apple Silicon은 Metal 기본 ON
cmake --build build --config Release -j
# 산출물: build/bin/llama-server, build/bin/llama-quantize ...
```
서버 cwd 기준 `llama.cpp/build/bin/llama-server`에 두거나 `GIJO_LLAMA_SERVER_PATH`로 지정.

### 2-2. 앱 빌드 (Mac에서 `npm run dist`)
- `build-server-dist.mjs`가 server-dist 네이티브를 **darwin-arm64로 재빌드**(better-sqlite3는 electron/rebuild, lancedb·onnxruntime·sharp는 `npm ci`가 arm64 프리빌드 획득).
- electron-builder가 `GIJO AS-<ver>-arm64.dmg` 생성. afterSign 훅이 **ad-hoc 재서명**하고
  식별자·봉인을 확인한다(식별자가 `Electron`으로 남으면 빌드를 실패시킨다 — 그대로 내보내면
  고객 기계에서 앱이 지워진다). 공증은 안 했으므로 첫 실행만 우클릭→열기.
- ⚠ 반드시 **Mac에서** 실행(Windows에서 mac dmg 크로스빌드 불가).

### 2-3. 실행 · 환경변수(데스크톱 앱이 서버 스폰 시 전달)
- `GIJO_MODELS_DIR`, `GIJO_DATA_DIR`, `GIJO_LLAMA_SERVER_PATH`, `GIJO_EMBEDDING_MODEL_ID=bge-m3`.
- main.ts의 서버 스폰 경로가 mac에서도 OS-상대경로로 맞는지 1회 점검(Phase 2 확인 항목).

## 3. 데이터 이식 (RAG·온톨로지·bge·운영데이터)
**이식 단위 = `data/` + `models/` 두 디렉터리 복사면 끝.** 파일 포맷이 크로스플랫폼 호환.

| 항목 | 위치 | 이식 방식 |
|---|---|---|
| 운영 DB (자산·취약점·KPI·감사·**온톨로지**) | `data/gijo-as.sqlite` | 파일 복사(SQLite 포맷 호환) |
| **RAG 벡터 + bge 임베딩** | `data/memory.lancedb` | 디렉터리 복사(LanceDB 컬럼포맷 호환) — **재인입 불필요** |
| 백업·데이터셋 | `data/backups`, `data/datasets` | 복사(선택) |
| **LLM 모델** (채팅 GGUF + bge-m3) | `models/<id>/<id>.gguf` | 복사(GGUF는 Metal에서 그대로) |

> bge 임베딩은 이미 LanceDB에 벡터로 저장돼 있어, CUDA↔Metal 미세차와 무관하게 **저장된 벡터를 그대로 옮기면** RAG가 그대로 살아난다. 온톨로지 트리플도 DB에 실려 함께 이동.

**절차**
```bash
# 운영(WSL)에서 — 무엇을 옮길지 + 온전성 매니페스트
node scripts/migrate-data-to-mac.mjs export --out /tmp/gijo-migrate

# 전송(rsync 또는 USB — 수 GB GGUF는 물리매체가 빠를 수 있음)
rsync -aP data/   mac:~/gijo-as/server/data/
rsync -aP models/ mac:~/gijo-as/server/models/

# mac에서 — 온전성 검증(매니페스트 hash 대조)
node scripts/migrate-data-to-mac.mjs verify
```

## 4. 실측 체크리스트 (Mac에서)
1. `preflight` → GPU (Metal) pass, llama-server pass, 모델 존재 pass
2. 임베딩 서버(bge-m3) 기동 + `/embeddings` 응답
3. 채팅 모델 1개 로드 + 추론 (tok/s 측정)
4. RAG 검색 → 이식한 LanceDB에서 기존 문서 히트하는지
5. 티어 API → "Apple Metal · 통합메모리 24GB" + 권장 티어 표시
6. 대시보드/KPI/분석허브 실데이터 렌더

## 5. 비핵심(1인·원격관리 불필요라 후순위)
- 하드닝 원격 점검(PowerShell/wsl.exe), 원격 SSH 정기점검, VPN, 클라 릴리즈 배포(.exe) — mac 자가사용엔 불필요. 필요 시 플랫폼 가드/비활성(추후).
