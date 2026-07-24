# Cisco ASA syslog 메시지
- 형식: `%ASA-Level-MessageID: 텍스트`. Level은 syslog severity(0~7), MessageID는 6자리 이벤트 코드.
- 자주 보는 코드:
  - %ASA-6-302013 / 302015: TCP / UDP 연결 생성(Built inbound/outbound). 정상 트래픽.
  - %ASA-6-302014 / 302016: TCP / UDP 연결 종료(Teardown). 바이트·사유 포함.
  - %ASA-4-106023: 액세스 그룹(ACL)에 의해 패킷 거부(Deny protocol src → dst by access-group). 차단 이벤트.
  - %ASA-6-106100: 액세스 리스트가 트래픽을 permit/denied(로깅 활성 ACL).
  - %ASA-4-106021: 역경로 검사(anti-spoofing) 거부.
  - %ASA-6-605005 / 611101: 관리 로그인. %ASA-3-…: 오류급.
- 담당자 요약: "%ASA-6-302013=TCP 연결 생성(정상), %ASA-4-106023=ACL에 의한 차단(Deny by access-group). 가운데 숫자=심각도."
