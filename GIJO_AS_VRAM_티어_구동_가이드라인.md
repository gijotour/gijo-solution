# GIJO AS — VRAM 티어별 LLM 구동 가이드라인

> **2026-08-07 개정 — 기준 모델이 14B 단일로 바뀌었습니다.**
> 근거(운영 실측 RTX 3090 24GB): qwen3-14b Q4 단독 구동 시 **VRAM 16.1GB 사용 · 여유 8.2GB**
> (7B급 2개를 띄우던 이전 구성은 18.7GB를 썼습니다 — **큰 모델 하나가 작은 둘보다 덜 씁니다**).
> 평가 게이트 판정: **통과** — routing 66/66 · safety 9/9 · korean 24/24 ·
> **맨몸 견고성 29점 → 71점**(주입 공격에 모델 자체가 훨씬 잘 버팁니다) · 제품 경로 뚫림 0.
> 응답: 즉답 0.6초 · 설명(CVE) 4.8초(7B 3.4초 대비 +1.4초).
>
> **티어는 이제 「모델 개수」가 아니라 「컨텍스트·동시성」으로 나눕니다.** 모델을 섞으면 같은
> 질문에 날마다 다른 성격의 답이 나오고(보안 제품에서 특히 나쁨), 장애 시 원인이 둘이 됩니다.
>
> | 티어 | GPU | 구성 | 무엇이 좋아지나 |
> |---|---|---|---|
> | Lite | **16GB급** | 14B · 16K 컨텍스트 | 최소 사양 — 1인 담당자 |
> | Standard | 24GB급 | 14B · **32K** | 긴 문서·긴 대화가 안 잘림(기본값) |
> | Pro | 32GB급+ | 14B **2인스턴스** · 32K | 여러 담당자가 동시에 물어도 안 밀림 |
>
> ⚠ **16GB 미만(12GB급)**: 14B가 안 올라갑니다. 7B급으로 자동 하향되며 **품질이 낮아집니다**
> (견고성 71 → 29점대). 파일럿 문턱을 낮추려면 허용하되, 그 사실을 고객에게 밝혀야 합니다.
>
> 아래 본문은 7B 2개 구성 시절(2026-07-22)의 산정입니다 — 계산 방법은 그대로 유효하니
> 참고로 남깁니다.

---


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

## 7. 지원 환경 요건 — "Mac이나 CUDA 없는 서버는?"

**현재 제품은 NVIDIA CUDA GPU(12GB+) 전용이다. Mac·AMD·CPU-only는 미지원.**

| 환경 | 지원 | 사유 |
|---|---|---|
| **NVIDIA GPU (CUDA) 12GB+** | ✅ 유일한 지원 환경 | 동봉 llama-server가 CUDA 빌드, VRAM 예산·LRU 축출이 nvidia-smi 실측에 의존, 전 티어 실측 검증이 이 환경 기준 |
| Mac (Apple Silicon) | ❌ 미지원 | 기반 엔진(llama.cpp)은 Metal을 지원하므로 **기술적으로 불가능하진 않으나**, 서버 배포 스크립트(WSL/systemd)·클라이언트 설치본(NSIS, Windows 전용)·nvidia-smi 의존 로직 전부 포팅+재검증 필요 — 로드맵 후보일 뿐 현재 제품 범위 밖 |
| AMD GPU (ROCm/Vulkan) | ❌ 미지원 | llama.cpp가 지원은 하나 당사 빌드·검증 전무. VRAM 관리 로직도 nvidia-smi 전제 |
| CPU-only | ❌ 실사용 불가 | 7B Q5가 CPU에서 ~2-5 tok/s 수준 — 챗봇·triage 응답이 분 단위가 되어 제품 경험 성립 안 함 |

영업 화법: "NVIDIA GPU 12GB 이상이 설치 요건입니다. 보유 장비에 NVIDIA GPU가 없으면 GPU 1장
추가(Lite 기준 미들급)가 선행돼야 합니다." — Mac 지원 문의는 로드맵 수요로 기록만.

## 8. 실측 스크립트 사용법 — tools/model-benchmark.mjs

설치 현장·데모에서 그 장비의 티어 판정 + 모델 실측을 한 번에 뽑는다. **출력 자체가 제품 가이드라인**
(티어 판정·권장 환경변수·실측 표)이라 그대로 고객 제출용으로 쓸 수 있다.

```bash
# 기본: 이 장비 티어 판정 + models/ 아래 전 모델 실측(여유 VRAM에 안 들어가는 모델은 자동 스킵)
node tools/model-benchmark.mjs

# 특정 모델만, 컨텍스트 지정
node tools/model-benchmark.mjs --models gijo-main-orchestrator,merged-lily-gijo-loop-ai-securityllm --ctx 16384

# 이미 떠 있는(상주) 서버는 로드 없이 추론 속도만 측정 — 운영 중 안전
node tools/model-benchmark.mjs --probe "8080=지휘모델"

# 옵션: --ctx 8192|16384|32768 · --tokens 160(생성량) · --prompt "..."(측정 프롬프트)
```

출력 구성: ① GPU 실측(총/사용/여유 VRAM) ② **GIJO AS 티어 판정**(Lite/Standard/Pro + 설치 환경변수,
NVIDIA 미감지 시 "미지원 환경" 안내) ③ 모델별 실측 표(로드시간·VRAM 점유·첫 토큰·tok/s, markdown).
안전장치: 로드 전 여유 VRAM을 확인해 부족하면 스킵 — 운영 GPU를 밀어내지 않는다.

## 부록 — 실측 결과 (2026-07-22, RTX 3090 · tools/model-benchmark.mjs)

판매 구성 그대로의 실제 모델을 단독 로드해 측정(160토큰 생성, 프롬프트=한국어 보안 질문):

| 모델 | ctx | 로드 | VRAM 점유 | 첫 토큰 | 생성 속도 |
|---|---|---|---|---|---|
| gijo-main-orchestrator (7.6B Q5) | 16K | 3.1s | **6.0GB** | 49ms | 118.5 tok/s |
| gijo-main-orchestrator | 32K | 3.1s | **6.9GB** | 47ms | 115.8 tok/s |
| merged-lily (7.2B Q5) | 16K | 2.6s | **7.1GB** | 44ms | 120.3 tok/s |
| Qwen2.5-3B (Q4) | 8K | 3.6s | 2.4GB | 50ms | 207.1 tok/s |

검증 포인트:
- **16K→32K 컨텍스트 = +0.9GB** (본문 산정 "KV캐시 1~2GB" 범위와 일치)
- **12GB Lite 검증**: 7B Q5 @16K(6~7.1GB) + bge-m3(~2GB) ≈ **8~9GB** → 12GB에서 안정 (본문 8.6GB 산정 일치)
- **24GB Standard 검증**: 7B급 2개 @32K(~7GB×2) + 임베딩 ≈ **16GB** → 운영 실측치와 일치
- 응답 체감: 두 운영 모델 모두 첫 토큰 50ms 미만·115~120 tok/s — 스왑 없이 즉답 품질
- 재실행: `node tools/model-benchmark.mjs --ctx 16384` (여유 VRAM 부족 모델은 자동 스킵,
  상주 서버는 `--probe 포트=이름`으로 로드 없이 속도만 측정)

실행 시 티어 판정이 함께 출력된다(이 장비 예시):

```
## GIJO AS 티어 판정 (이 장비 기준)
- 판정: 🟩 AS Standard (24GB급) — 총 VRAM 24.0GB
- 권장 구성: 보안 LLM 2개(지휘+전문가) + RAG 임베딩 · 컨텍스트 32K
- 설치 설정(환경변수):
  GIJO_MAX_LOADED_MODELS=2
  GIJO_LOCAL_LLM_CTX_SIZE=32768 (기본값 그대로)
- 실측 근거: 7B급 2개 @32K ≈ 14GB + 임베딩 ≈ 2GB → 총 16GB(여유 8GB). 운영 검증 구성.
```

## 출처

- 운영 실측: RTX 3090 24GB, lily-7B+qwythos-9B+bge-m3 동시 상주 = 16GB (localengine.ts 주석·llmactivity 로그)
- [llama.cpp VRAM Requirements Guide (LocalLLM.in)](https://localllm.in/blog/llamacpp-vram-requirements-for-local-llms)
- [Hardware specs for GGUF 7B/13B/30B models (llama.cpp Discussion #3847)](https://github.com/ggml-org/llama.cpp/discussions/3847)
- [Ollama VRAM Requirements 2026 (LocalLLM.in)](https://localllm.in/blog/ollama-vram-requirements-for-local-llms)
- [Optimizing Local LLMs for Low-End Hardware (SitePoint)](https://www.sitepoint.com/optimizing-local-llms-low-end-hardware-8gb/)
- [VRAM Requirements 2026 (Local AI Master)](https://localaimaster.com/blog/vram-requirements-2026)
