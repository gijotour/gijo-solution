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

## 5. BYOM(고객 직접 반입)이면 라이선스 이슈가 없어지나?

**"재배포 이슈"는 없어지지만, "사용 이슈"는 고객에게 이전될 뿐이다.** 영업·설치 화법 주의.

| 구분 | 고객 직접 반입(BYOM) 시 |
|---|---|
| 재배포(번들) 의무 | ✅ **우리에게 안 붙음** — 재배포 주체가 아니므로 표기·조건 의무 없음 |
| 사용(use) 제한 | ❌ **고객에게 그대로 적용** — EXAONE(연구목적)·Qwen2.5-3B(비상업)를 상업 환경에서 쓰면 위반 주체가 고객이 될 뿐, 위반 자체는 사라지지 않음 |
| 유도(inducement) 리스크 | ⚠ 제품 화면이 비상업 모델을 추천·다운로드 안내하면 우리도 유도 책임 여지 — 비상업 모델은 "쓸 수는 있게, 권하지는 않게" |
| 파생물(파인튜닝) | ❌ 학습 루프로 파인튜닝한 결과물 라이선스는 원본을 따라감(비상업 원본→비상업 파생물) |

**안전한 화법**: "모델 반입은 자유이며, 반입 모델의 라이선스 준수 책임은 고객에게 있습니다"까지.
"EXAONE도 고객이 올리면 쓸 수 있어요"라고 말하지 말 것.

**실무 장치**: ① 계약서/EULA에 BYOM 책임 조항 1줄 ② 제품 라이선스 게이트(modellicense.ts)가
restricted 모델에 경고 표시 유지 ③ 번들은 permissive만(본 문서 1군).

## 6. 실행 제안

1. **기본(지휘) 모델 — 원본 확정 완료(2026-07-22)**: gijo-main-orchestrator =
   **Qwen2.5-7B-Instruct + Qwen2.5-7B-Instruct-1M SLERP 합성** (증거: HF 캐시 02:01 두 모델 다운로드 →
   02:07 GGUF 생성 타임라인 + GGUF 메타 qwen2·7.6B·name="Merged" + 1M 변형의 롱컨텍스트 특성 부합).
   **두 원본 모두 Apache-2.0 → 합성본 상업 번들 가능.** 라이선스 게이트 permissive 승격 완료 —
   현행 모델 그대로 번들하면 되고 교체 불필요(운영 검증까지 끝난 모델). Qwen3-8B 비교는 성능 개선 목적으로만 선택.
   ※ gijo-orchestrator-ko는 Gukbap-Qwen2.5-7B(한국어 튜닝) 합성 추정 — Gukbap 라이선스 확인 전까지 BYOM 유지.
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
