# EPSS와 VPR 차이 — 우선순위 반영
- EPSS(Exploit Prediction Scoring System, FIRST.org): 해당 취약점이 앞으로 30일 이내에 실제로 악용될 확률(0~1). 매일 갱신되는 데이터 기반 예측치. 예 0.94 = 향후 30일 내 악용 가능성 매우 높음.
- VPR(Vulnerability Priority Rating, Tenable): 0.0~10.0의 동적 우선순위 점수. CVSS 기본점수에 위협 인텔리전스(최근 악용 여부, 익스플로잇 공개, 다크웹·SNS 언급, 악용 성숙도)를 더해 매일 재계산. 정적인 CVSS와 달리 "지금의 위협 상황"을 반영.
- 차이: EPSS=확률(미래 악용 가능성), VPR=우선순위 점수(위협 반영 심각도). 둘은 상호보완적.
- 우선순위 반영 순서(권장): 1) CISA KEV 등재 여부(실제 악용=최우선) → 2) VPR High/Critical 또는 EPSS 높음(예 ≥0.5) → 3) CVSS 심각도 → 4) 자산 중요도·노출도(인터넷 노출 우선).
