# GIJO AS — 오픈소스 기반 전체 업그레이드 방안 (ver1)

작성일: 2026-07-28
성격: **검토용 초안(ver1)** — 착수 결정 전 근거·범위 정리. 구현 시작 시 개별 계획서로 분화.
전제: GIJO AS 전체(취약점 관리·보안로그 관제·LLM 보안 코파일럿·AI-BOM·가드레일/레드팀·온톨로지·온프렘 LLM)를 업그레이드 대상으로 둔다.

---

## 0. 큰 그림 — 왜 오픈소스를 참고하나

GIJO AS와 **전체가 겹치는 오픈소스는 없다.** "완전 온프렘 로컬 LLM + 보안 관제 + AI-BOM"을 한 제품에 담은 조합은 현재 GIJO AS가 사실상 유일하다. 대신 **각 축마다 성숙한 오픈소스 교과서**가 따로 존재한다. 이들을 코드 이식이 아니라 **설계·데이터모델·페이로드·스키마 차용** 관점에서 흡수하면, 바퀴를 다시 발명하지 않고 각 기능의 완성도를 표준 수준으로 끌어올릴 수 있다.

원칙(변하지 않음):
- **온프렘·자가호스팅 유지** — 외부 API 의존 도입 금지(기존 [클라우드 하이브리드]는 선택적 예외).
- **차용은 라이선스 확인 후** — Apache 2.0 / MIT 계열 위주, 카피레프트(GPL/AGPL)·NC(비상업) 조항 주의.
- **참고는 설계·패턴 우선, 코드 이식은 최후** — 우리 스택은 TypeScript/Node라 Python/Django 프로젝트는 대개 개념만 가져온다.

---

## 1. 축별 참고 대상 요약표

| 우리 기능 축 | 참고 오픈소스 | 국가/라이선스 | 우리가 가져올 핵심 | 우선순위 |
|---|---|---|---|---|
| 취약점 리포트 분석(1차 목표) | **DefectDojo** | 미국 / BSD-3 | 파서 등록 패턴·중복제거(dedup)·SLA 워크플로 | 높음 |
| AI SOC 분석가(챗봇·에이전트) | **AiSOC / SOCFortress Talon** | MIT | 조사과정 "재생(replay)" 기록·MCP 피벗 조사 | 중 |
| 레드팀·가드레일 | **garak / PyRIT / promptfoo** | Apache·MIT | 프로브(페이로드) 라이브러리 수혈·CI 회귀 | 높음(즉시) |
| AI-BOM | **cdxgen / CycloneDX ML-BOM** | Apache 2.0 | 1.6~1.7 스키마·프롬프트/MCP까지 BOM 커버리지 | 높음 |
| 온톨로지·위협인텔 | **OpenCTI** | 프랑스 / Apache 2.0 | STIX 데이터모델·알림↔인텔 매칭 | 중 |
| 온프렘 RAG UX | **AnythingLLM** | MIT | (동일 LanceDB) 문서 인입 파이프라인 UX | 낮음(벤치마킹) |
| 번들 LLM 후보 | **Ministral 3 (8B/14B)** | 프랑스 / Apache 2.0 | 상업 이용·머지 자유, 12GB VRAM 적합 | 중(실측 필요) |

> **탈락**: EXAONE(한국, 성능·한국어 최강급이나 라이선스 v1.2-NC = 비상업·"타 모델 개발 금지"로 우리 머지 파이프라인과 충돌) / 중국계 대형 모델(Kimi K3·GLM·MiniMax·DeepSeek — 데이터주권·공급망 정책상 국내 공공·기업 도입 저항 + 크기 초과).

---

## 2. 축별 상세 방안

### ① 취약점 리포트 분석 — DefectDojo에서 배운다
**현황**: 웹취약점 보고서 파서(PDF→자산·취약점 실등록)가 핵심 기능. 분석 허브가 3소스(스캐너·보안로그·제품리포트) 통합.
**참고 포인트**:
- **파서 등록 패턴** — DefectDojo는 200+ 도구 파서를 플러그인처럼 등록. 우리도 스캐너 종류를 늘릴 때 "파서 인터페이스 + 등록부" 구조로 가면 확장이 깔끔해진다.
- **중복 제거(deduplication)** — 같은 취약점이 여러 스캔·여러 날짜에 반복 등장할 때 `hash_code`(취약점 지문)로 묶는 알고리즘. 우리 자산·취약점이 누적될수록 필수.
- **SLA·리스크 수용(risk acceptance) 워크플로** — 발견→분류→조치→검증→마감의 생애주기와 SLA 타이머. 우리 취약점관리 지침과 이미 방향 일치, 상태머신 설계 시 대조.
**차용 형태**: 설계·알고리즘 참고(코드는 Python/Django, 이식 아님).
**액션**: 분석 허브 파서 확장 설계에 "파서 등록부 + dedup 지문" 반영.

### ② AI SOC 분석가 — AiSOC·Talon
**현황**: 에이전트 디스패치·결재판·감사로그·MCP 연동 화면(정의만, 실연결 대기).
**참고 포인트**:
- **조사과정 재생(replay)** — AiSOC는 에이전트의 프롬프트·도구호출·판단근거를 단계별 재생 가능한 기록으로 남긴다. 우리 감사로그는 "무엇을 했나"는 있지만 "왜·어떤 근거로"의 재생은 약함 → 감사로그 고도화 아이디어.
- **MCP 피벗 조사** — Talon은 MCP로 SIEM을 오가며 다단계 조사. 우리 MCP 화면의 "연동 대기"를 실연결로 구현할 때의 참조 사례.
**차용 형태**: 개념·UX 참고.
**액션**: 감사로그에 "판단근거 스냅샷" 필드 추가 검토, MCP 실연결 1종 PoC.

### ③ 레드팀·가드레일 — garak/PyRIT/promptfoo (**즉시 착수 후보**)
**현황**: 자동 레드팀 카나리 14페이로드 + 런타임 가드레일(dispatch 통합).
**참고 포인트**:
- **garak 프로브 120+개** — 프롬프트 인젝션·인코딩 우회·탈옥·데이터 유출 등 카테고리별 공개 페이로드. **우리 14개 → 수십 개로 수혈 확장** 가능. 온프렘에서 우리 모델에 그대로 돌려볼 수 있음.
- **promptfoo CI 회귀** — 가드레일을 CI에서 지속 회귀검사하는 패턴. 우리 tools/regress와 같은 발상 → 레드팀 회귀 자동화.
**차용 형태**: 페이로드(데이터) 차용 + 회귀 패턴 참고. 라이선스 부담 낮음.
**액션(가장 저비용·고효과)**: garak 프로브 카테고리를 우리 레드팀 페이로드 세트로 이식·한국어화, 배포마다 자동 실행.

### ④ AI-BOM — cdxgen / CycloneDX ML-BOM
**현황**: AI-BOM(CycloneDX ML-BOM) + 거버넌스 연계는 제품 차별점("신경 더 써야 할" 영역).
**참고 포인트**:
- **최신 스키마(1.6~1.7)** — cdxgen은 모델뿐 아니라 **프롬프트 파일·MCP 설정·AI 서비스 메타데이터까지 BOM에 담는다.** 우리 AI-BOM이 "모델 목록" 수준을 넘어 프롬프트·MCP 구성까지 커버리지를 넓힐 때 이 스키마를 따라가면 **표준 호환**이 보장된다.
- **완전성 채점** — G7·CISA·NTIA의 "SBOM-for-AI 최소 요소" 대비 완전성 점수화(GLaaS/roar 사례). 우리 AI-BOM에 "이 BOM이 표준 최소요소를 얼마나 충족하나" 점수를 붙일 수 있다.
**차용 형태**: 스키마·표준 준수(직접 호환 목표).
**액션**: AI-BOM 필드를 CycloneDX 1.6+ 기준으로 정렬, 프롬프트·MCP 항목 추가 로드맵.

### ⑤ 온톨로지·위협인텔 — OpenCTI
**현황**: 벡터 RAG + 온톨로지 하이브리드, 6대 표준(KISA·ATLAS·OWASP·NIST·CWE·ATT&CK) 임포트.
**참고 포인트**:
- **STIX 데이터모델** — OpenCTI는 STIX 기반으로 위협·자산·표준코드를 지식그래프로 엮는다. 우리 온톨로지 엔티티·관계 정의를 STIX와 정렬하면 외부 인텔 피드와 상호운용 가능.
- **알림↔인텔 매칭** — Wazuh 연동에서 GraphQL로 IOC를 조회해 알림을 풍부화. 우리 분석 허브 상관분석을 키울 때 "로그 이벤트 ← IOC 매칭 → 인텔 컨텍스트" 패턴 참조.
**차용 형태**: 데이터모델·매칭 로직 참고.
**액션**: 온톨로지 엔티티를 STIX 타입에 매핑하는 표 작성(상호운용 준비).

### ⑥ 온프렘 RAG UX — AnythingLLM
**현황**: 기억·학습(RAG) = LanceDB + bge-m3.
**참고 포인트**: AnythingLLM은 **우리와 같은 LanceDB를 번들**로 쓴다. 문서 워크스페이스·인입 파이프라인의 UX(진행률·청킹 피드백·에이전트 툴셋)가 성숙 → 우리 문서 인입 화면 UX 벤치마킹.
**차용 형태**: UX 벤치마킹만.

### ⑦ 번들 LLM 후보 — Ministral 3 (8B/14B)
**현황**: 채팅·임베딩 로컬 모델 풀(VRAM 티어 12~32GB).
**참고 포인트**: Apache 2.0(상업·파생·머지 자유), 공식 GGUF 배포 존재(`mistralai/Ministral-3-8B-Instruct-2512-GGUF`), 한국어 포함 40+ 다국어, 8B가 FP8 기준 12GB VRAM에 적합. 우리 SLERP 머지 파이프라인에 얹을 수 있음.
**차용 형태**: 실제 후보 모델(실측 필요).
**액션**: 8B Instruct/Reasoning GGUF를 localengine에 로드 → 한국어 보안 도메인 응답·tok/s 실측 후 채택 판단.

---

## 3. 실행 우선순위 (제안)

1. **garak 프로브 → 레드팀 페이로드 확장** — 비용 대비 효과 최고, 즉시 착수 가능(데이터 차용).
2. **cdxgen의 AI-BOM 스키마(1.6+, 프롬프트·MCP 포함) → AI-BOM 커버리지 확대** — 차별점 강화, 표준 호환.
3. **DefectDojo 파서 등록·dedup 지문 → 분석 허브 파서 확장 설계** — 1차 목표 완성도.
4. **Ministral 3 8B 실측** — 번들 LLM 후보 검증(다운로드 용량 확인 후).
5. AiSOC "조사 재생" → 감사로그 고도화 / OpenCTI STIX 매핑 → 온톨로지 상호운용 (중기).
6. AnythingLLM UX 벤치마킹 (상시 참고).

---

## 4. 리스크·주의

- **라이선스 재확인 필수** — 문서의 라이선스 표기는 조사 시점 기준. 실제 차용 전 원문 대조(특히 페이로드·스키마의 재배포 조건).
- **중국계 모델 배제 유지** — 성능이 좋아도 국내 공공·기업 데이터주권 정책상 도입 저항. 번들 후보에서 제외.
- **EXAONE 재검토 트리거** — LG가 상업 라이선스를 합리적 조건으로 개방하면 한국어 최강 후보로 재진입 가능(현재는 NC로 배제).
- **"참고"와 "이식"의 선 긋기** — 대부분 설계·데이터 차용. 코드 통째 이식은 스택 불일치(TS↔Python)로 비효율.

---

## 5. 근거 출처 (조사 2026-07-28)

- DefectDojo — https://defectdojo.com/ · https://defectdojo.com/blog/top-11-open-source-vulnerability-management-tools-for-2026
- AiSOC(MIT) — https://github.com/beenuar/AiSOC · SOCFortress Talon — https://socfortress.medium.com/how-to-add-a-local-llm-to-your-ai-soc-analyst-without-buying-a-gpu-9459e251bfd8
- 레드팀 도구 비교 — https://beyondscale.tech/blog/ai-red-teaming-tools-comparison-2026 · https://www.turingpost.com/p/aisecuritytools
- cdxgen — https://github.com/cdxgen/cdxgen · CycloneDX ML-BOM — https://cyclonedx.org/capabilities/mlbom/ · OWASP AI/ML-BOM 가이드 — https://cyclonedx.org/guides/OWASP_CycloneDX-Authoritative-Guide-to-AI-ML-BOM-en.pdf
- OpenCTI — https://filigran.io/platform/opencti/ · Wazuh–OpenCTI 상관 — https://wazuh.com/blog/real-time-threat-correlation-with-wazuh-and-opencti/
- AnythingLLM vs Open WebUI — https://aicoolies.com/comparisons/anythingllm-vs-open-webui
- Ministral 3 GGUF — https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512-GGUF · Mistral 3 소개 — https://simonwillison.net/2025/Dec/2/introducing-mistral-3/
- EXAONE 4.5(라이선스 NC) — https://github.com/LG-AI-EXAONE/EXAONE-4.5 · https://arxiv.org/abs/2604.08644
