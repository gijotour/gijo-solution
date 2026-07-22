# 취약점 식별·분류 표준 체계 (CVE·CWE·CCE·CPE·CAPEC와 우선순위 지표)

(GIJO AS 지식베이스용 — 2026-07 인터넷 리서치 기반. 출처: MITRE cve.org/cwe.mitre.org/cce.mitre.org/capec.mitre.org, NIST CSRC·NVD, CISA KEV, FIRST EPSS, Picus·Defendermate 비교 해설)

## 1. 식별자 5형제 — 무엇에 번호를 붙이는가

보안 표준 식별자들은 각각 "다른 것"에 번호를 붙인다. 헷갈리기 쉬우니 한 줄씩:

- **CVE** (Common Vulnerabilities and Exposures): **공개된 소프트웨어 취약점 하나하나**에 붙는 고유 번호. MITRE가 관리하고 형식은 CVE-연도-일련번호(예: CVE-2021-44228 Log4Shell). 미국 NVD(국립취약점데이터베이스, NIST 운영)가 각 CVE에 CVSS 점수·CWE 분류·CPE(영향 제품) 정보를 붙여 상세 제공한다.
- **CWE** (Common Weakness Enumeration): 취약점의 **근본 원인이 되는 '약점 유형'** 분류. 코드·설계·아키텍처 수준의 실수 종류다(예: CWE-79 크로스사이트 스크립팅, CWE-89 SQL 인젝션). CVE가 "사건 하나"라면 CWE는 "사고 유형"이다. 하나의 CWE에서 수천 개의 CVE가 나온다.
- **CCE** (Common Configuration Enumeration): **시스템 보안 설정(구성) 이슈**의 식별자. 코드 결함(CVE)이 아니라 "비밀번호 최소 길이가 8자 이상이어야 한다" 같은 설정 실수를 다룬다. CIS 벤치마크·NIST 설정 가이드·DISA STIG 항목들을 서로 연결(매핑)하는 공통 번호 역할. 국내에서는 KISA 주요정보통신기반시설 기술적 취약점 분석·평가 가이드가 항목마다 CCE 코드를 부여하며(U-계열 등), GIJO AS의 하드닝 점검(kisa·kisa_pc·kisa_net 표준)이 바로 이 계열의 점검이다.
- **CPE** (Common Platform Enumeration): **제품·플랫폼**의 식별자. "이 취약점이 어떤 제품 어떤 버전에 해당하는가"를 기계가 읽을 수 있게 한다.
- **CAPEC** (Common Attack Pattern Enumeration and Classification): **공격 패턴**의 목록. 약점(CWE)을 공격자가 어떤 수법으로 악용하는지를 정리한 카탈로그다.

관계 체인으로 외우면 쉽다: **CVE(취약점 사례)는 CWE(약점 유형)에서 비롯되고, CWE는 CAPEC(공격 패턴)의 표적이 되며, CAPEC은 MITRE ATT&CK(실제 공격자 전술·기법)으로 이어진다. CPE는 CVE를 제품에, CCE는 설정 기준을 점검 도구에 연결한다.**

## 2. 우선순위 지표 4종 — 무엇부터 고칠 것인가

취약점이 수백 건일 때 "전부 Critical"로 보이면 아무것도 못 고친다. 지표별 역할:

- **CVSS** (Common Vulnerability Scoring System): 취약점의 **본질적 심각도**를 0~10으로 점수화. 최신 4.0(2024년 확정)은 공격 성숙도 지표와 영향 대상 구분이 추가됐다. 한계: 심각도이지 '실제로 뚫릴 가능성'이 아니다 — CVSS 9점이어도 악용 사례가 없을 수 있다.
- **EPSS** (Exploit Prediction Scoring System): FIRST가 운영하는 **악용 확률 예측**. 기계학습으로 "향후 30일 내 악용될 확률"을 0~100%로 낸다. v4가 2025년 3월 공개됐다. 한계: 우리 회사 방화벽·EDR 같은 보완 통제나 자산 도달 가능성은 모른다.
- **KEV** (Known Exploited Vulnerabilities): CISA(미국 사이버보안·인프라보안청)가 **실제 악용 증거를 확인한** 취약점만 올리는 목록. 미 연방기관은 통상 2~3주 내 조치가 의무다. "이미 뚫리고 있는 것"이므로 무조건 최우선.
- **SSVC** (Stakeholder-Specific Vulnerability Categorization): 점수 대신 **의사결정 나무**로 조치 등급(Act/Attend/Track)을 내는 방식. 악용 상태·기술 영향·업무 중요도를 조합한다. 정교하지만 수작업이라 대량 처리엔 부적합.

## 3. 실무 우선순위 권장 흐름 (GIJO AS 지침과 동일)

1. **KEV 등재 취약점** — 실제 악용 확인, 즉시 조치
2. **Critical 심각도 + EPSS 상위** — 뚫릴 확률 높은 치명 결함
3. **CVSS/VPR 점수순** — 나머지는 심각도 순으로 SLA 관리

GIJO AS의 취약점 메뉴·자산 허브 노출점수가 이 순서(KEV 가중 → Critical 가중 → 노출 여부)를 그대로 반영한다.

## 4. 자주 묻는 질문

- "CVE와 CWE 차이는?" → CVE는 특정 제품의 특정 결함 '사건'(예: Log4j의 CVE-2021-44228), CWE는 그 사건의 '원인 유형'(CWE-502 신뢰할 수 없는 데이터 역직렬화).
- "CCE는 왜 따로 있나?" → 뚫리는 원인의 절반은 코드 결함이 아니라 설정 실수다. 설정은 제품 결함이 아니라 운영자의 선택이므로 별도 체계(CCE)로 식별하고, 하드닝 점검으로 잡는다.
- "CVSS 높은 것부터 고치면 되나?" → 아니다. CVSS는 심각도일 뿐이라 KEV(실악용)·EPSS(악용 확률)를 먼저 봐야 한다.

출처: cve.org / cwe.mitre.org / cce.mitre.org (CCE: unique identifiers for system configuration issues) / csrc.nist.gov SCAP-CCE / capec.mitre.org / NIST SP 800-51r1 취약점 명명 체계 가이드 / Picus "Comparing CVSS, EPSS, KEV, SSVC" / Defendermate "CVSS vs EPSS vs SSVC vs KEV"
