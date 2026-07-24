# MITRE ATT&CK를 SIEM/EDR 탐지에 매핑
- ATT&CK 구조: Tactics(공격 목적, 예: Initial Access·Execution·Persistence·Privilege Escalation·Lateral Movement·Exfiltration) × Techniques/Sub-techniques(구체 기법, 예: T1059 Command and Scripting Interpreter, T1110 Brute Force).
- 매핑 방법:
  1) 각 탐지 규칙(SIEM 상관규칙·EDR 룰)에 대응하는 Technique ID를 태깅한다(예: 브루트포스 규칙→T1110).
  2) ATT&CK Navigator로 커버리지 히트맵을 그려 탐지 공백(미커버 기법)을 식별한다.
  3) 공백을 우선순위(위협 프로파일·실제 악용)로 채우는 탐지 엔지니어링을 수행.
  4) 표준 룰 포맷(Sigma)으로 규칙을 작성해 여러 SIEM/EDR에 이식하고, ATT&CK 태그를 함께 유지.
- 효과: 탐지 자산을 공격자 기법 기준으로 정렬 → 커버리지·우선순위·레드팀 검증(purple team)을 일관되게 관리.
- 담당자 요약: "규칙마다 Technique ID 태깅→Navigator로 커버리지·공백 확인→Sigma로 규칙화. 예: 브루트포스=T1110."
