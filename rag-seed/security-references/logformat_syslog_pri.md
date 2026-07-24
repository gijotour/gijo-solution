# Syslog 포맷과 PRI(facility·severity)
- PRI 계산: PRI = facility × 8 + severity. 예: local0(16)·Error(3) → 16×8+3 = 131 → 로그 앞에 <131>.
- Severity(0~7, 낮을수록 심각): 0 Emergency, 1 Alert, 2 Critical, 3 Error, 4 Warning, 5 Notice, 6 Informational, 7 Debug.
- Facility(예): 0 kern, 1 user, 3 daemon, 4 auth, 10 authpriv(보안), 16~23 local0~local7(장비 커스텀).
- RFC 3164(BSD, 구형): `<PRI>Mmm dd hh:mm:ss HOSTNAME TAG: MESSAGE` (예: `<134>Oct 11 22:14:15 fw01 %ASA-6-302013: ...`).
- RFC 5424(신형): `<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [STRUCTURED-DATA] MSG`. 타임스탬프는 ISO 8601.
- 담당자 요약: "앞의 <숫자>가 PRI. facility=PRI/8, severity=PRI%8. severity는 0이 가장 심각(Emergency), 7이 Debug."
