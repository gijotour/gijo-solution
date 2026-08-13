---
license: apache-2.0
base_model:
  - Qwen/Qwen2.5-7B-Instruct
  - Qwen/Qwen2.5-7B-Instruct-1M
library_name: gguf
pipeline_tag: text-generation
language:
  - ko
  - en
tags:
  - gguf
  - qwen2
  - security
  - gijo-as
  - on-device
extra_gated_prompt: "이 모델은 GIJO AS 라이선스 고객 전용입니다. 접근 요청 시 라이선스 키를 함께 적어 주세요."
extra_gated_fields:
  회사명: text
  GIJO AS 라이선스 키: text
  용도: text
---

# GIJO Main Orchestrator (GGUF)

**GIJO AS 라이트의 온디바이스 채팅 모델.** 담당자 PC 한 대에서 혼자 도는 보안 비서용으로
튜닝된 7B 모델이며, 인터넷 없이(폐쇄망) 동작하도록 GGUF 양자화 배포판으로 제공합니다.

> ⚠ **비공개·게이트 배포입니다.** GIJO AS 라이선스 고객만 접근 토큰으로 내려받을 수 있습니다.
> 제품 안에서는 **설정 → 챗 모델 등록 → 받기**로 원클릭 설치됩니다(토큰 입력 후).

## 무엇인가

| | |
|---|---|
| 아키텍처 | Qwen2 (7B) |
| 양자화 | Q4_K_M (GGUF) · **약 5.1GB** |
| 문맥 | 네이티브 32K (라이트는 8K로 구동 — 10GB급 대상) |
| 언어 | 한국어·영어 |
| 실측 점유 | 라이트 등급(ctx 8192) Metal 기준 **약 5.5GB** + 임베딩(bge-m3) 1.1GB |

## 베이스 모델과 라이선스

이 모델은 아래 두 공개 모델의 병합에 GIJO 보안 도메인 튜닝을 더한 것입니다:

- [`Qwen/Qwen2.5-7B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct) — **Apache 2.0**
- [`Qwen/Qwen2.5-7B-Instruct-1M`](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-1M) — **Apache 2.0**

두 베이스가 모두 **Apache 2.0**이라 재배포가 허용됩니다. 이 배포판도 **Apache 2.0**으로 공개하되,
운영상 **비공개+게이트**로 두어 라이선스 고객에게만 노출합니다(라이선스가 공개를 막아서가 아니라,
제품 자산을 통제 배포하기 위함).

## 쓰는 곳

**GIJO AS Lite** — 로그 분석·매뉴얼 검색·법령 근거·나만의 기억(RAG)·AI 견고성 점검 등
9개 화면에서 대화·요약을 담당합니다. 스탠다드/프로에서는 더 큰 모델을 씁니다(기능 등급 가이드).

## 한계

- 7B라 견고성(프롬프트 인젝션 방어 등)이 대형 모델보다 낮습니다 — 제품이 스스로 「AI 견고성 점검」으로
  이를 측정해 보여 줍니다. 더 높은 견고성이 필요하면 스탠다드(24GB급, 14B)로 올립니다.
- 근거 없는 사실은 「근거 약함」으로 표시되지만, 중요한 결정은 반드시 사람이 검토하세요.

## 무결성

배포 gguf의 SHA256은 릴리스 노트에 함께 게시합니다. 받은 뒤 대조하세요.
