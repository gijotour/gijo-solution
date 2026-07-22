# GIJO AS — VRAM 티어별 LLM 구동 가이드라인

작성: 2026-07-22 · 근거: 운영 실측(RTX 3090 24GB) + llama.cpp/GGUF 커뮤니티 자료(하단 출처)

---

## 1. 질문: "지금처럼 채팅 LLM 2개 동시 구동이 꼭 필요한가?"

**결론: 기능상 필수는 아니다. 품질·응답속도용 선택사항이다.**

현재 운영(24GB RTX 3090) 실태:

| 상주 프로세스 | 모델 | 크기(파일) | 역할 |
|---|---|---|---|
| 채팅 ① | gijo-main-orchestrator (Qwen2.5-7B계 합성, 7.6B Q5) | ~5.4GB | 오케스트레이터 전용 — 도구 라우팅(JSON 결정) |
| 채팅 ② | merged-lily(7B 합성, Q5) | ~4.6GB | 나머지 5개 에이전트(scan·analysis·report·ti·normaltic) 공용 |
| 임베딩 | bge-m3 | 1.1GB | RAG 검색 — 상시 필수(스왑 대상 아님) |

- 실측 점유: 채팅 2개 + 임베딩 = **약 16GB** (32K 컨텍스트 기준)
- **모든 에이전트는 모델 미배정 시 기본 모델로 자동 폴백**한다(agents.ts). 즉 채팅 1개만 있어도
  전 기능이 동작한다 — 2개 구동의 실익은 다음 둘뿐:
  1. **역할 분리 품질**: 라우팅(JSON 정확성) 특화 모델과 한국어 보안지식 특화 모델을 분리
  2. **스왑 대기 제거**: 모델 전환 시 15~30초 로드가 없음(둘 다 상주라 즉답)
- 반대로 비용은 VRAM ~9~10GB/모델(파일+KV캐시+런타임). **12GB급에서는 이 비용을 감당할 수 없다.**

## 2. VRAM 산정 공식 (실측 + 커뮤니티 자료 일치)

```
모델 1개 점유 ≈ GGUF 파일 크기 + KV캐시 + 런타임 오버헤드
  · 7~9B Q4_K_M~Q5_K_M 파일: 4.1 ~ 5.3GB
  · KV캐시: 32K 컨텍스트 ≈ 1~2GB, 8K ≈ 0.3~0.5GB (7~9B 기준)
  · 런타임(CUDA 컨텍스트·버퍼): 1~2GB
  → 32K 기준 모델당 약 9~10GB (엔진 기본 산정 = 파일 + 5GB 오버헤드와 일치)
임베딩(bge-m3, ctx 8192·ubatch 8192) ≈ 1.5~2GB
```

## 3. 티어별 권장 구성

### 🟦 12GB 티어 (미들급: RTX 3060 12G · 4070 · 4070 Ti) — **단일 LLM 모드**

| 항목 | 권장 |
|---|---|
| 채팅 모델 | **1개만 상주** (7B Q4_K_M 권장, 9B Q5는 컨텍스트 축소 필수) |
| 컨텍스트 | **8K~16K로 축소** (32K는 12GB에서 임베딩과 공존 불가) |
| 임베딩 | bge-m3 상주 유지(RAG 필수) |
| 에이전트 배정 | 전부 미배정(기본 모델 폴백) — 역할 분리 포기, 기능은 동일 |
| 모델 전환 | 스왑 방식(기존 내리고 새로 올림) — 엔진이 LRU 축출로 자동 처리 |

산정: 7B Q4(4.1GB) + KV 16K(~1GB) + 런타임(1.5GB) + bge-m3(2GB) ≈ **8.6GB** → 12GB에서 안정.
32K를 고집하면 ~11GB로 여유 1GB 미만 — OS/드라이버 점유까지 고려하면 **불안정 구간**이다.

환경변수 설정:
```
GIJO_MAX_LOADED_MODELS=1
GIJO_LOCAL_LLM_CTX_SIZE=16384      # 또는 8192 (여유 우선)
GIJO_MODEL_VRAM_OVERHEAD_MB=3500   # 16K 기준 오버헤드 하향
```

### 🟩 24GB 티어 (RTX 3090 · 4090) — **2개 상주 (현행 운영 구성)**

| 항목 | 권장 |
|---|---|
| 채팅 모델 | 2개 상주 (오케스트레이터 + 전문가 공용) |
| 컨텍스트 | 32K 유지 |
| 여유 | 실측 16GB 사용 → 8GB 여유(레드팀 점검·학습루프 등 순간 부하 흡수) |

현행 기본값 그대로: `GIJO_MAX_LOADED_MODELS=2`, `GIJO_LOCAL_LLM_CTX_SIZE=32768`.

### 🟪 30~32GB 티어 (RTX 5090 32G · A6000급) — **멀티 LLM 모드**

| 항목 | 권장 |
|---|---|
| 채팅 모델 | **3개 상주** — 오케스트레이터 + 한국어 보안 전문가 + 코더/리포트 특화 |
| 컨텍스트 | 32K 유지, 필요 시 일부 모델 64K |
| 확장 옵션 | 14B Q4(~9GB) 1개를 전문가로 승격 가능 (14B+7B+9B+임베딩 ≈ 28GB) |

```
GIJO_MAX_LOADED_MODELS=3
GIJO_LOCAL_LLM_CTX_SIZE=32768
```

산정 예: 9B Q5(10GB) + 7B Q5(9GB) + 7B Q4(8.5GB) + bge-m3(2GB) ≈ 29.5GB → 32GB에서 동작하나
여유가 2.5GB뿐이므로 **3번째 모델은 Q4·16K로 낮추는 것을 권장**(≈27GB, 여유 5GB).

## 4. 판단 원칙 (요약)

1. **기능 최소선은 "채팅 1 + 임베딩 1"** — 멀티 모델은 품질·속도 옵션이지 요구사항이 아니다.
2. **VRAM의 70~80%까지만 계획 점유** — 나머지는 KV캐시 변동·드라이버·순간 부하 버퍼.
3. **컨텍스트가 최대 조절 손잡이** — 32K→16K로 낮추면 모델당 1~1.5GB 회수. 12GB에서는 필수.
4. 엔진은 이미 nvidia-smi 실측 기반 LRU 축출을 갖췄으므로, 티어 설정은 위 환경변수 3개로 끝난다.
5. 판매/설치 시 체크: `nvidia-smi` 총 VRAM 확인 → 위 표에서 티어 선택 → 환경변수 적용 → 재시작.

## 5. 새 LLM 도입 절차 — "디스패치만 하면 되나?"

**아니다 — 파일 배치 1단계가 먼저다. 그 뒤로는 전부 자동이다.** 코드 수정은 없다.

```
① 모델 파일 배치 (필수·수동)
   server/models/<모델id>/<모델id>.gguf   ← 이 폴더·파일명 패턴만 지키면 자동 인식
   예: server/models/my-sec-llm/my-sec-llm.gguf

② (선택) 에이전트에 배정
   에이전트 AI 화면 → 에이전트 선택 → 모델 드롭다운에서 새 모델 지정
   · 배정 안 하면: 아무 일도 안 일어남(기본 모델이 계속 답함 — 새 모델은 대기)
   · 기본 모델로 쓰려면: GIJO_DEFAULT_MODEL_ID=<모델id> 설정 후 재시작

③ 이후 디스패치는 자동
   지시가 그 에이전트로 라우팅되면 엔진(ensureAgentModel)이 알아서:
   · 모델이 풀에 없으면 → VRAM 실측(nvidia-smi) → 부족하면 LRU 모델 자동 축출 → 로드
   · 파일이 없거나 로드 실패 → 경고 로그 남기고 기본 모델로 폴백(서비스 중단 없음)
```

주의사항:
- **라이선스 게이트**: 제품이 모델명 규칙으로 라이선스를 분류한다(modellicense.ts).
  Qwen2.5-**3B**(비상업) 같은 restricted 모델은 상업 설치본에 번들 금지 — BYOM(고객 반입)으로만.
- **VRAM 티어 준수**: 12GB(Lite)에서 새 모델을 에이전트에 배정하면 기존 모델이 축출(스왑)된다 —
  동시 상주가 아니라 교대 사용이 된다는 점을 안내할 것. 동시 상주는 24GB+에서.
- **첫 로드 시간**: 새 모델 첫 호출은 로드 15~30초가 걸린다(이후 상주 중엔 즉시).
- 임베딩(bge-m3)은 이 풀과 무관한 별도 상주라 새 채팅 모델 도입이 RAG에 영향 주지 않는다.

## 6. 향후 로드맵 제안

- **자동 티어 감지(제안)**: 부팅 시 nvidia-smi 총 VRAM을 읽어 12GB 미만이면 MAX_LOADED_MODELS=1·ctx 16K를
  자동 적용(환경변수 미설정 시 기본값만 교체). 설치 현장의 수동 설정 실수를 없앤다.
- 16GB 티어(4080·4070 Ti Super)는 "채팅 1 + 32K" 또는 "채팅 2 + 8K" 중 택일 — 기본은 전자 권장.
- 48GB+(A6000 Ada·듀얼 GPU)는 14B×2 + 7B + 임베딩 구성으로 역할별 전문화 확대 가능.

## 출처

- 운영 실측: RTX 3090 24GB, lily-7B+qwythos-9B+bge-m3 동시 상주 = 16GB (localengine.ts 주석·llmactivity 로그)
- [llama.cpp VRAM Requirements Guide (LocalLLM.in)](https://localllm.in/blog/llamacpp-vram-requirements-for-local-llms)
- [Hardware specs for GGUF 7B/13B/30B models (llama.cpp Discussion #3847)](https://github.com/ggml-org/llama.cpp/discussions/3847)
- [Ollama VRAM Requirements 2026 (LocalLLM.in)](https://localllm.in/blog/ollama-vram-requirements-for-local-llms)
- [Optimizing Local LLMs for Low-End Hardware (SitePoint)](https://www.sitepoint.com/optimizing-local-llms-low-end-hardware-8gb/)
- [VRAM Requirements 2026 (Local AI Master)](https://localaimaster.com/blog/vram-requirements-2026)
