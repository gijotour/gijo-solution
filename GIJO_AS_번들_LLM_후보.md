# GIJO AS — 상업 번들 가능 LLM 후보 (2026-07 조사)

작성: 2026-07-22 · 짝문서: `GIJO_AS_VRAM_티어_구동_가이드라인.md`(티어 사양) · 근거: 하단 출처

**선정 기준** ① 라이선스가 상업 재배포(번들) 허용 ② 우리 티어(12~32GB)에 GGUF로 탑재 가능한 크기
③ 한국어 품질 ④ 제품 라이선스 게이트(modellicense.ts)의 permissive 분류와 충돌 없음.

---

## 1. 결론 먼저 — 티어별 추천 구성

| 티어 | 지휘(라우팅) | 한국어 보안 전문가 | 3번째(특화) |
|---|---|---|---|
| 🟦 Lite 12GB | **Qwen3-8B** Q4 (단일) | (동일 모델 겸임) | — |
| 🟩 Standard 24GB | **Qwen3-8B** | **Kanana-1.5-8B** | — |
| 🟪 Pro 30GB+ | Qwen3-8B | Kanana-1.5-8B | **Phi-4 14B** 또는 **gpt-oss-20b** |

전부 Apache-2.0/MIT — 별도 계약·표기 조건 없이 설치본에 동봉 가능.

## 2. 번들 1군 (무조건 안전 — Apache-2.0/MIT)

| 모델 | 크기 | 라이선스 | 강점 | 비고 |
|---|---|---|---|---|
| **Qwen3-8B / 3.5** (Alibaba) | 8B | Apache-2.0 | 한국어 상위권·도구호출(JSON) 우수 — 지휘 모델 적임 | Qwen2.5-7B/14B도 동일 Apache. **2.5-3B만 비상업 — 금지** |
| **Kanana-1.5-8B** (카카오) | 8B/2.1B | Apache-2.0 | **국산·한국어 특화** — 전문가 슬롯 최적, 국내 영업 스토리 강함 | 나노 2.1B 일부 버전은 CC-BY-NC(비상업) — 1.5 계열만 |
| **Upstage SOLAR** | 10.7B~ | Apache-2.0 | 한국어 강함, 국산 | 구형화 추세 — Kanana 대안 |
| **Phi-4 / Phi-4-mini** (MS) | 14B/3.8B | **MIT** | 14B급 추론력 — Pro 전문가 승격 후보(Q4 ≈ 9GB) | 한국어는 Qwen보다 약간 아래 |
| **gpt-oss-20b** (OpenAI) | 20B MoE | Apache-2.0 | 추론·도구호출 강력, ~16GB로 Pro 탑재 가능 | 24GB 단독은 빠듯 — 32GB 권장 |
| **DeepSeek-R1-Distill-Qwen-7/8B** | 7-8B | MIT(+베이스 Apache) | 추론(사고과정) 특화 — 분석 에이전트 후보 | 출력이 장황할 수 있음(속도↓) |
| **Granite 3.x-8B** (IBM) | 8B | Apache-2.0 | 엔터프라이즈 지향·안전성 문서화 잘 됨 | 한국어 보통 |
| **Mistral-7B v0.3** | 7B | Apache-2.0 | 가볍고 검증 오래됨 | 한국어 약함 — 비추천. **Ministral-8B는 비상업 — 금지** |
| **Gemma 4** (Google) | 다양 | Apache-2.0(2026 전환) | 품질 균형 | Gemma 2/3는 자체 약관 — 버전 확인 필수 |

## 3. 조건부 (표기·규모 조건 붙음 — 검토 후 번들)

| 모델 | 조건 | 판단 |
|---|---|---|
| **Llama 3.1/3.2-8B** (Meta) | 커뮤니티 라이선스 — 월활성 7억 미만 OK + **"Built with Llama" 표기** | 우리 규모엔 사실상 무제한. 현재도 사용 중 — 표기만 문서·화면에 추가하면 번들 가능 |
| **Kimi K2 / K2.6** (Moonshot) | Modified MIT — 월매출 $20M/1억 MAU 초과 시 "Kimi K2" UI 표기 | 라이선스는 문제없으나 **1T MoE라 12~32GB 온프렘에 탑재 불가** — 클라우드 하이브리드(egress 게이트) 경유 옵션으로만 |
| **HyperCLOVA X SEED** (네이버) | 자체 라이선스(상업 허용하되 제약 조항 있음) | 법무 검토 후 결정 — 게이트 분류 review |

## 4. 번들 금지 (비상업 라이선스)

- **EXAONE 3.5/Deep** (LG) — 연구목적 한정. 한국어 최상급이지만 상업 번들 불가(고객 BYOM 안내만)
- **Qwen2.5-3B** — Qwen Research License(비상업). 이미 게이트가 restricted로 차단 중
- **Ministral-8B** — Mistral Research License(비상업)
- **Kanana 나노 2.1B(CC-BY-NC 버전)** — 연구용 표기 버전 확인 필수

## 5. 실행 제안

1. **차기 기본(지휘) 모델**: 현행 gijo-main-orchestrator(9B, 출처불명→BYOM 분류) 대체로 **Qwen3-8B** 검증 —
   라이선스 리스크 제로화 + 도구호출 정확도 기대. held-out 8문항 실측(기존 방법)으로 비교 후 전환.
2. **전문가 슬롯**: merged-lily(자사 합성, 원본 라이선스 확정 전 BYOM) 대신 판매본에는 **Kanana-1.5-8B**를
   기본 동봉하고, merged-lily는 원본(Lily·ZySec) 라이선스 확정 후 프리미엄 옵션으로.
3. modellicense.ts 규칙에 kanana·phi-4·gpt-oss·granite 패턴 추가(전부 permissive 분류) — 게이트 최신화.
4. Kimi 등 초대형은 "클라우드 하이브리드"(이미 구현된 egress 승인 게이트) 경유로만 제공 — 온프렘 번들 아님.

## 출처

- [Open-Weight License Landscape 2026 (Presenc AI)](https://presenc.ai/research/open-weight-license-landscape-2026) — Apache-2.0 38%·MIT 18%, Kimi Modified MIT 조건
- [Latest open source LLM releases 2026 (fazm.ai)](https://fazm.ai/t/latest-open-source-llm-releases-2026) — Qwen3.5 Apache·Gemma 4 Apache·DeepSeek V4 MIT·Kimi K2.6
- [Legal and Licensing Guide for Open-Source LLMs 2026](https://ehga.org/legal-and-licensing-guide-for-open-source-llms-in)
- [국내 주요 기업 오픈소스 LLM 공개 현황 (공개SW 포털)](https://www.oss.kr/oss_guide/show/9246eca5-f639-484c-be09-797d76fc9582) — Kanana 1.5 Apache-2.0·나노 CC-BY-NC·EXAONE 연구목적
- [국내 LLM 현황 비교 (MSAP)](https://www.msap.ai/blog-home/blog/korea-llm/) — SOLAR·Kanana 상업 친화 쌍두마차
- 제품 내부: modellicense.ts(라이선스 게이트)·GIJO_AS_VRAM_티어_구동_가이드라인.md(탑재 가능 크기)
