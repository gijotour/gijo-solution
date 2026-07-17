# gijo LLM 강화 가이드 — merge로 제품에 맞는 기능 더하기

> 대상: gijo 기본 채팅 모델(`gijo-main-orchestrator`)을 제품 니즈에 맞게 강화하려는 개발자.
> 제품의 "보안 LLM 합성"(merge.ts / merge.html) 기능과 실 GPU 실증을 근거로 작성. 2026-07-17.

---

## 0. 현황 진단 (실측)

`gijo-main-orchestrator` = **Qwen2.5-7B 아키텍처** (실측 `:8080` 메타: n_vocab 152064, n_embd 3584,
7.6B params, 32K ctx, Q5_K_M).

| 강점 | 약점 |
|---|---|
| 오케스트레이션·작업분배, 한국어 준수, 32K 롱컨텍스트, 추론 빠름(triage 1.3~4s) | **중국어 드리프트**(구조화 출력 시 汉字 흘림 — 프롬프트로 억제 중), 보안 도메인 깊이가 범용 수준 |

## 1. 핵심 제약 — merge는 "같은 아키텍처+크기"만 (반드시 이해)

제품의 합성은 **SLERP**다(`merge.ts` `preflightMerge`: `a.arch !== b.arch || a.size !== b.size`면 거부).
즉 **gijo(qwen2·7B)와 합성하려면 상대도 Qwen2.5-7B여야** 한다.

> ⚠️ **현재 보안 도감(`SECURITY_LLM_DEX`)은 gijo와 합성 불가.** Lily·ZySec=Mistral, Foundation-Sec=Llama,
> SecGPT=Qwen2지만 1.5B. 전부 arch/size가 gijo와 다르다 — 이 도감은 기본 모델이 Lily(Mistral)였던 시절 유물이다.
> **gijo를 merge로 강화하려면 Qwen2.5-7B 계열 모델을 도감에 추가하는 것이 첫 단계다.**

또 하나의 실무 제약: **mergekit은 HF safetensors를 입력으로 받는다(GGUF 아님).** gijo는 GGUF로 서빙되므로,
merge의 실제 의미는 "**Qwen2.5-7B HF 모델 둘을 SLERP해 새 gijo(GGUF)를 만든다**"이다. 한쪽을 Qwen2.5-7B-Instruct(=gijo 계열 베이스),
다른 쪽을 특화 모델로 두면 된다.

## 2. 두 갈래 전략 — merge vs finetune

| | **Merge (SLERP)** | **Finetune (QLoRA)** |
|---|---|---|
| 무엇 | 같은 arch 모델 둘의 가중치를 섞음 | gijo에 도메인 데이터를 학습시켜 각인 |
| 제약 | **같은 arch+size 필수**(Qwen2.5-7B) | 아키텍처 무관, gijo 그대로 베이스 |
| 강한 것 | 서로 다른 **지식·문체를 융합** (보안지식+한국어) | **문체·판단·형식(JSON/상태 파싱)** 교정, 사내 사례 체화 |
| 비용 | 학습 없음, GPU 추론만(빠름) | GPU 학습 시간 필요 |
| 제품 기능 | 보안 LLM 합성 화면(merge.html) | AI 지식·모델 → 학습 / 헤르메스 학습 루프 |
| 실증 | Lily+ZySec→Q5_K_M 로드·추론 ✓ | Hermes 학습 루프 실 GPU ✓ |

**요지**: 지식·언어 특성을 **섞으려면 merge**, 문체·형식·사내 판단을 **각인하려면 finetune**. 둘은 배타적이지 않다(merge 후 finetune 가능).

## 3. 제품 니즈 → 권장 방법

| 강화하려는 것 | 권장 | 이유 |
|---|---|---|
| **중국어 드리프트 제거 / 한국어 품질** | Merge(gijo + 한국어 Qwen2.5-7B) 또는 한국어 보안 Q&A finetune | 한국어 특화 가중치를 섞으면 근본 개선. 프롬프트 규칙은 보조 |
| **보안 도메인 깊이**(취약점·컴플라이언스 추론) | 보안 Qwen2.5-7B와 merge가 이상적이나 실물이 드묾 → **사내 문서·사례 finetune이 현실적** | 같은 arch 보안모델이 희소. 온톨로지·RAG로 보강도 병행 |
| **triage/컴플라이언스 초안의 구조화 출력**(상태 파싱 안정) | **Finetune**(형식 각인) | "상태: partial\n근거…" 형식을 예제로 각인하면 파싱 실패↓ |
| **오케스트레이션·에이전트 협업** | 현행 유지 | 이미 강점 |

## 4. Merge로 gijo 강화하기 — 절차 (제품 기능 사용)

1. **도감에 Qwen2.5-7B 후보 추가** — `server/src/engine/modeldex.ts`의 `SECURITY_LLM_DEX`에
   `arch:"qwen2", size:"7B"` 항목을 넣는다. 안전한 앵커는 공식 **`Qwen/Qwen2.5-7B-Instruct`**(다국어·한국어 준수).
   한국어/보안 특화 Qwen2.5-7B는 HF에서 실재 여부·라이선스를 확인해 큐레이션(존재하지 않는 repo id를 넣지 말 것).
2. **합성 실행** — `보안 LLM 합성`(merge.html)에서 두 Qwen2.5-7B 선택 → `preflightMerge`가 arch/size·mergekit·
   llama.cpp·모델 캐시를 점검 → SLERP YAML 생성 → mergekit 실행 → `convert_hf_to_gguf.py`로 f16 →
   `llama-quantize Q5_K_M` → `models/<새id>/<새id>.gguf`.
3. **로드·검증** — `에이전트 AI` 화면에서 새 modelId로 엔진 시작 → 추론 확인.
4. **승격** — 만족하면 `GIJO_DEFAULT_MODEL_ID=<새id>`(또는 `localengine.ts` 기본값)로 gijo 자리를 교체.
   기존 gijo는 옵션으로 남긴다.

## 5. 함정 (실 GPU에서 겪은 것 — 반드시 반영)

- **mergekit ↔ transformers5 호환**: 버전 충돌 시 `cu.torch` 주입 우회가 필요했다(과거 Lily+ZySec 합성 실증에서).
- **변환→양자화 파일명**: convert는 `<id>.f16.gguf`(중간) → quantize가 그걸 읽어 `<id>.gguf` 생성. 이 분리는
  이미 `merge.ts`에 반영됨(예전엔 파일명 어긋나 실패).
- **한국어 규칙은 프롬프트에도**: merge/finetune으로 개선해도, triage·컴플라이언스처럼 구조화 출력엔
  "처음부터 끝까지 한국어로만, 중국어·일본어 금지" 규칙을 프롬프트에 함께 유지(모델만으론 재발 가능).
- **양자화는 Q5_K_M**: RTX 3090 24GB에서 7B Q5_K_M는 VRAM 여유가 커 32K ctx까지 안정(gijo와 동일).
- **HF safetensors 필요**: merge 입력은 HF 포맷. gijo GGUF만으론 소스로 못 씀 → Qwen2.5-7B HF 둘로 합성.

## 6. 검증 루프 (실 GPU, 승격 전 필수)

1. 새 모델 로드(`localengine` 엔진 시작) → 로드 성공 확인.
2. **한국어 검사**: triage/컴플라이언스 초안 생성 후 응답의 한자(汉字) 잔존 0인지(`/[一-鿿]/` 카운트).
3. **보안 정확도**: 대표 취약점·위협에 대한 답이 기준(criteria)·근거에 맞는지 표본 검토.
4. **회귀**: 오케스트레이션(작업 분배) 응답이 나빠지지 않았는지.
5. 합격 시에만 `GIJO_DEFAULT_MODEL_ID` 승격. 불합격이면 ratio/layers 조정(SLERP `ratio` 기본 0.5) 후 재합성.

## 7. 추천 로드맵 (제품 관점)

1. **1순위 — 한국어 강화**: 중국어 드리프트가 실사용 체감 결함. gijo(Qwen2.5-7B) + 한국어 Qwen2.5-7B SLERP로
   근본 개선 시도 → 검증 루프 → 승격. (merge가 학습보다 빠르니 먼저)
2. **2순위 — 형식·판단 각인**: triage/컴플라이언스 초안의 구조화 출력 안정화를 위해, 실제 사내 승인·조치·컴플라이언스
   기록을 데이터셋화(기억·학습 → 학습 루프)해 finetune.
3. **3순위 — 보안 깊이**: 같은 arch 보안 Qwen2.5-7B가 나오면 merge, 아니면 온톨로지·RAG + 사내 사례 finetune으로 보강.

> 원칙: **merge는 "지식·언어를 섞는 빠른 카드", finetune은 "사내 판단을 각인하는 깊은 카드".**
> 제품엔 둘 다 있으니, 니즈별로 골라 쓰고 항상 실 GPU 검증 루프로 승격 여부를 판단한다.
