# FortiGate(FortiOS) 로그 필드
- 형식: key=value 쌍(공백 구분), 값이 공백 포함이면 큰따옴표. syslog로 전송.
- 핵심 필드:
  - type: traffic(트래픽) / utm(위협·IPS·AV·웹필터) / event(시스템). subtype로 세분(forward, local, virus, ips 등).
  - action: 차단 여부 판단의 핵심. accept/allow(허용), deny/block(차단), close, timeout, dropped.
  - srcip, dstip: 출발지·목적지 IP. srcport, dstport: 포트. proto: 프로토콜 번호(6=TCP,17=UDP).
  - policyid: 매칭된 방화벽 정책 번호. service: 서비스명. app: 애플리케이션.
  - sentbyte, rcvdbyte: 송·수신 바이트. level: 심각도. logid: 로그 식별자.
- 예: `date=2026-07-25 time=10:00:00 type=traffic subtype=forward action=deny srcip=10.0.0.5 dstip=1.2.3.4 srcport=51000 dstport=445 policyid=12 service=SMB`
- 담당자 요약: "차단 여부=action(deny/block), 출발지/목적지=srcip/dstip, 위협 로그는 type=utm."
