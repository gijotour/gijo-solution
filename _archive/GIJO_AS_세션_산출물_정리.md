# GIJO AS 세션 산출물 정리

> 이 세션(커밋 `de06424..ca155a9`, 47커밋)에서 만든 결과 파일과 내용을 한곳에 정리한 참고 문서.
> 상태: 전부 origin/main 푸시 완료 · CI(Server+Client) success · 로컬 481 테스트 green.

---

## 1. 제품 문서 (repo `.md`)

| 파일 | 내용 |
|---|---|
| `GIJO_AS_제품_확인_v1.md` | 요청 검증 표 + 추가 제안기능 + 제품 목적 + 아키텍처/기술 + 보안담당자 전체 기능 + 시장성·마케팅 |
| `GIJO_AS_보안담당자_실무매뉴얼.md` | 관제 화면 샘플 6종을 교재로 일/주/월 루틴·AI보안 사용법. 전체 화면지도·우선순위(P0~P3)·신호·결재판·용어·FAQ (실제품 대조 검증본) |
| `GIJO_AS_배포_가이드.md` (보강) | 온프렘 self-install: 보안 env(JWT·초기계정·TLS)·프리플라이트·모델 라이선스/BYOM·백업·업그레이드 |
| `GIJO_AS_온톨로지_강화_가이드.md` | 6대 표준 임포트 패턴·현황·향후 확장 절차 |
| `GIJO_AS_에이전트_자동화_계획서.md` | 에이전트 오케스트레이터 자동화 설계 |
| `GIJO_AS_AI에이전트_대시보드_계획서.md` | 지휘 콘솔(대시보드) 설계 |
| `GIJO_AS_WSL2_서버이전_계획서.md` | 서버 WSL2 이전 계획(보류) |

### 노션 (🛠️ GIJO AS 프로젝트 관리 DB)
- **gijo as 제품 확인 v1** — 제품 확인 문서
- **보안담당자 루틴 시나리오 테스트 (일/주/월 + AI보안)** — 인터넷 실데이터 7시나리오 결과
- **GIJO AS 보안담당자 실무 매뉴얼 (샘플 사례 기반)** — 사용 매뉴얼

---

## 2. 신규 화면 (client/src/renderer/pages)

| 파일 | 내용 |
|---|---|
| `analysis.html` | **통합 보안 분석·관제** — 3소스(취약점·로그·운영리포트) 정규화·우선순위·상관분석·드롭존·AI분석·조치 생성·**이벤트 생애주기(확인/처리중/완료/무시)** |
| `redteam.html` | **AI 견고성** — 레드팀 대상선택·견고성 점수·뚫린 항목 상세·가드레일 모드/로그 |
| `sbom.html` (수정) | AI-BOM 상세에 **AI 견고성 카드**(연결 모델 점검·점수 기록) |
| `nav.js` (수정) | "보안 분석"·"AI 견고성" 메뉴 항목 |

---

## 3. 신규 서버 모듈 (server/src/engine, auth, db)

**통합 분석**
- `analysishub.ts` — 3소스 정규화 파서(브루트포스·방화벽스캔·웹공격·키워드), 우선순위·상관분석, 이벤트 LLM 분석, 이벤트 생애주기(상태 테이블)

**AI 견고성**
- `redteam.ts` — 카나리 기반 14 인젝션/탈옥 페이로드 실측, 대상 다변화(모델/AI-BOM 자산)
- `guardrail.ts` — 실시간 입력 인젝션 탐지·차단(off/flag/block)

**제품화(P0 하드닝)**
- `modellicense.ts` — 번들 LLM 라이선스 분류(permissive/restricted/review/byom)
- `preflight.ts` — 설치 후 자가진단(Node·GPU·모델·JWT·기본계정·저장소)
- `backup.ts` — DB 온라인 백업
- (수정) `auth/auth.ts`(로그인 브루트포스 잠금), `auth/users.ts`(비번정책·안전 초기계정), `db.ts`(스키마 마이그레이션 추적·TLS는 `index.ts`)

**에이전트/온톨로지**
- `briefing.ts`(일일 브리핑·SLA), `undo.ts`(원클릭 되돌리기), `orchestrator-dataset.ts`(도구선택 골드)
- `atlas-seed/data`·`attack-seed/data`·`cwe-seed`·`nist-airmf-seed`·`owasp-llm-seed` — 6대 표준 온톨로지 임포트

---

## 4. 테스트 (server/test) — 총 481 green

신규: `analysishub`·`guardrail`·`redteam`·`modellicense`·`selfinstall`·`hardening`·`backup`·`briefing`·`undo`·`agentapproval`·`agentfinding`·`agentloop`·`agenttools-cross`·`ontology-atlas`·`orchestrator-dataset`
수정: `modelscan-wrapper`(크로스플랫폼 경로 버그 → Linux CI 그린)

---

## 5. 검증 산출물 (mockups/)

| 디렉토리 | 내용 |
|---|---|
| `redteam/` | 레드팀 UI 시안 3종 + 실 페이지 렌더·E2E 스크린샷 |
| `redteam-targets/` | 대상선택 시안 3종 + E2E |
| `analysis-workspace/` | 관제 화면 시안 3종 + 실 Electron E2E(인입·AI분석·생애주기) |
| `product-doc/` | 실제 실행 화면 캡처 8종(대시보드·관제·취약점·AI-BOM·온톨로지·레드팀·위협·에이전트) |

---

## 6. 상태

- **푸시**: origin/main = `ca155a9` (47커밋)
- **CI**: GitHub Actions success (Server tsc+테스트, Client tsc+번들) — 기존 modelscan 실패까지 해결
- **테스트**: 로컬 481 green, 서버·클라이언트 tsc 클린

---

## 7. 남은 것 (다음 세션)

**코드**: 서버 서비스화·설치 마법사 · 실시간 SIEM/syslog 커넥터 · 모델 BYOM 프로비저닝 UI · 알림 스케줄 · 관측성 메트릭 · i18n
**코드 밖(전문가/사용자)**: 모델 라이선스 법무 검토 · 제품 pentest · CC/조달 인증 · 파일럿 영업 · 가격/SLA · SQLite at-rest 암호화(SQLCipher 빌드 교체 필요)
