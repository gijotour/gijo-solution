# Palo Alto PAN-OS 로그(TRAFFIC vs THREAT)
- 형식: 쉼표(CSV) 구분 필드. 앞부분 공통(수신시각, 일련번호, Type, …), Type 필드로 로그 종류 구분.
- TRAFFIC 로그: 세션 단위 기록(세션 시작/종료). action(allow/deny/drop), 애플리케이션(app), 출발지/목적지 IP·포트·존, 규칙명(rule), 바이트·패킷 수. → "누가 어디로 얼마나 통신했나".
- THREAT 로그: 보안 프로파일(IPS/안티바이러스/안티스파이웨어/URL 필터링/WildFire)이 탐지·차단한 이벤트. Threat/Content Name, Threat ID, severity(critical/high/medium/low/informational), action(alert/block/reset), URL·파일명. → "무슨 위협을 탐지·차단했나".
- 구분: CSV의 Type 필드가 TRAFFIC / THREAT / SYSTEM / CONFIG 등. THREAT는 severity와 Threat Name을 우선 확인.
- 담당자 요약: "TRAFFIC=세션·허용/차단, THREAT=위협 탐지(severity·Threat Name). Type 필드로 구분."
