# GIJO AS — 온톨로지 강화 가이드 (표준 프레임워크 임포트)

> 온톨로지(지식 그래프)에 국제 보안 표준을 트리플로 넣어 "왜 이 판단인지"를 표준 근거로
> 뒷받침한다. 향후 새 표준을 추가할 때 이 문서의 패턴을 따른다. 작성 2026-07-18.

## 1. 현재 커버리지 (9출처 · ~2000 트리플)

| 축 | 출처 태그 | 시드 파일 | 규모 | 대상 |
|---|---|---|---|---|
| 국내 위협 | `KISA AI 보안 위협 대응 매뉴얼(2026.7)` | `ontology-seed.ts` (compliance.ts 기반) | 20위협 | AI |
| 완화통제(접근제어) | `…별첨2 양호기준` | `ontology-seed.ts` | 9 | AI |
| 보안제품 | `GIJO AS 보안제품 카탈로그` | `ontology-seed.ts` | — | 내부 |
| 취약점 분류 | `GIJO AS 취약점관리 지침` | `ontology-seed.ts` | — | 내부 |
| AI 적대적 기법 | `MITRE ATLAS (STIX 스냅샷 2026)` | `atlas-seed.ts` + `atlas-ontology-data.ts` | 889 | AI |
| LLM 위험 | `OWASP Top 10 for LLM Applications (2025)` | `owasp-llm-seed.ts` | ~72 | AI |
| 거버넌스 | `NIST AI RMF 1.0 + GenAI Profile(AI 600-1)` | `nist-airmf-seed.ts` | ~70 | AI |
| 소프트웨어 약점 | `MITRE CWE (Top 25 2024 + AI 약점)` | `cwe-seed.ts` | ~66 | 공통 |
| 공격 기법(인프라) | `MITRE ATT&CK Enterprise (STIX 스냅샷 2026)` | `attack-seed.ts` + `attack-ontology-data.ts` | 704 | 인프라 |

모든 시드는 `ontology-seed.ts`의 `seedOntologyFromCatalog()`에서 **출처 태그별로 멱등**하게
적재된다(`deleteTriplesBySource(SRC)` 후 재삽입 → 수동 입력분은 출처가 달라 보존). 적재는 수동
트리거: `POST /api/ontology/seed` (또는 ontology.html의 버튼).

## 2. 핵심 규칙 (반드시 지킬 것)

### (a) 자동 연결 — 노드 subject를 기존 참조 코드와 일치시켜라
기존 KISA 위협은 `compliance.ts`에서 이미 OWASP·MITRE 코드를 참조한다
(예: `owasp: ["LLM04:2025 Data and Model Poisoning"]`, `mitre: ["AML.T0020 Poison Training Data"]`).
새 표준 노드의 **subject를 그 참조 문자열과 글자 그대로 일치**시키면, 그래프가 코드 노드를 통해
자동으로 이어진다(KISA 위협 → 표준 기법 → 전술·완화통제).
- ATLAS 기법: `"AML.T0020 Poison Training Data"` (code+name) ← KISA `mitre` 필드와 일치
- OWASP: `"LLM04:2025 Data and Model Poisoning"` ← KISA `owasp` 필드와 일치

### (b) 코드 참조가 없으면 — "관련" 교차링크로 붙여라
NIST·CWE는 KISA가 코드로 참조하지 않는다. 대신 매핑 가능한 항목을 OWASP 코드에 `관련`
술어로 연결한다(예: NIST GenAI "정보 보안" → `"LLM01:2025 Prompt Injection"`, CWE-1427 → 동일).
→ OWASP 노드를 경유해 전 표준 그래프에 붙는다.

### (c) expandOntology 시드 매칭 규칙 — subject 형식이 질의를 결정
`mentions(entity) = normalize(질의문).includes(normalize(entity))` — **엔티티가 질의문의
부분문자열**일 때만 시드된다. 따라서:
- 긴 코드 질의("CWE-79")로 걸리게 하려면 노드 subject를 **바 코드**("CWE-79")로 두고 이름은
  `명칭` 트리플로 붙인다(CWE 방식). "{code} {name}" 노드는 짧은 코드 질의에 안 걸린다.
- 기존 데이터가 "{code} {name}"을 참조하는 경우(ATLAS·OWASP)는 그 형식이 맞다(자동 연결 우선).

### (d) 에어갭 — 외부 데이터는 오프라인 번들로
STIX 등 외부 데이터는 변환 스크립트(`*-transform.cjs`)로 받아 **`.ts` 데이터 파일로 구워**
커밋한다(런타임 인터넷 불필요 = 온프레미스/에어갭 원칙). 손 큐레이션(OWASP·NIST·CWE)은 시드
파일에 직접 넣는다.

## 3. 새 표준 추가 절차 (체크리스트)

1. **데이터 확보**: 다운로드형이면 `xxx-transform.cjs`(STIX/JSON 자동 다운로드 → 트리플 →
   `xxx-ontology-data.ts` 굽기, ATT&CK/ATLAS 참고). 손 큐레이션이면 시드 파일에 직접(OWASP 참고).
2. **시드 함수**: `xxx-seed.ts` — `export const XXX_SOURCE`, `export function xxxTriples(): TripleInput[]`
   (각 트리플에 `source: XXX_SOURCE`).
3. **연결**: (a) subject를 기존 참조 코드와 일치 or (b) 매핑 항목에 `관련` 교차링크. (c) 질의 형식에
   맞는 subject(바 코드 vs code+name) 선택.
4. **멱등 적재**: `ontology-seed.ts` `seedOntologyFromCatalog()`에 `deleteTriplesBySource(XXX_SOURCE)`
   + `...xxxTriples()` + `sources[]`에 추가.
5. **테스트**: `test/ontology-atlas.test.ts`에 구조 + 연결(다른 표준까지 expandOntology로 도달) 테스트.
6. **검증**: 빌드 → 서버 재시작 → `POST /api/ontology/seed`로 트리플 수 확인 → 실 LLM으로 explain/
   remediation이 새 근거를 인용하는지.

## 4. 남은 후보 (필요 시 추가)

- **CAPEC** (공격 패턴) — CWE에 first-class로 연결(CWE→CAPEC). 약점→공격패턴 그래프 밀도↑.
- **표준 간 직접 매핑** — ATLAS↔OWASP 공식/커뮤니티 매핑을 `관련`으로(현재는 KISA 경유 연결).
- **ATT&CK 전체 전술** — 현재 취약점 악용 7전술만. 필요 시 정찰·방어우회 등 확장(크기 주의).
- **STRIDE / ISO 42001·23894 통제** — 위협모델링·거버넌스 통제 상세.
- **CVE↔CWE 매핑** — 스캔 finding에 CWE 태그를 붙이면 인프라 취약점이 CWE·ATT&CK에 자동 연결.

## 5. 파일 지도

- 엔진: `server/src/engine/ontology.ts`(트리플 스토어·expandOntology), `ontology-seed.ts`(오케스트레이터),
  `{atlas,owasp-llm,nist-airmf,cwe,attack}-seed.ts`, `{atlas,attack}-ontology-data.ts`(생성물).
- 변환기: `server/{atlas,attack}-transform.cjs` (STIX 자동 다운로드 → 번들 재생성).
- UI: `client/src/renderer/pages/ontology.html` (SVG 그래프·규칙 주입 미리보기·시드 버튼).
- 주입: `llm.ts ragContextFor`가 온톨로지 컨텍스트를 시스템 프롬프트에 벡터 RAG와 별도로 주입.
