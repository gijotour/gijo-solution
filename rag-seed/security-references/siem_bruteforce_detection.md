# SIEM 무차별 대입(Brute Force) 탐지 규칙
- 기본 규칙: 동일 출발지 IP 또는 동일 계정에서 인증 실패가 시간창 안에 임계값 이상이면 경보. 예) 소스IP 기준 5분 내 로그인 실패 ≥ 10회 → Medium, ≥ 30회 → High.
- 강화 규칙:
  - 실패 다수 후 성공(fail…fail→success) → 계정 탈취 의심(High, 즉시 조사).
  - 여러 계정을 대상으로 한 소수 시도(password spraying): 한 출발지가 다수 계정에 각각 소수 실패 → 스프레이 탐지.
  - 분산 소스(다수 IP→한 계정): 자격증명 스터핑.
- 데이터 소스: OS 인증 로그(Windows 4625 실패/4624 성공, Linux auth.log), VPN·SSO·웹 로그인 로그.
- 대응·매핑: 계정 잠금·MFA 강제·소스 차단. MITRE ATT&CK T1110(Brute Force), 하위 T1110.001(추측), .003(Password Spraying), .004(Credential Stuffing).
- 담당자 요약: "시간창 내 실패 임계값 초과=브루트포스. 실패→성공은 탈취 의심. Windows 4625로 탐지, ATT&CK T1110."
