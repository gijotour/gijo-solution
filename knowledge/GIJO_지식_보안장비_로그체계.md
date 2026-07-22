# 주요 보안 장비 6종과 로그 체계 (국내외 실사용 상위 장비)

(GIJO AS 지식베이스용 — 2026-07 인터넷 리서치 기반. 출처: Fortinet Document Library, Palo Alto Networks 공식 문서, Cisco ASA Syslog 레퍼런스, 보안뉴스·시큐아이 보도자료)

## 1. 외산 장비 3종 (전세계·국내 공통 다수 도입)

### FortiGate (Fortinet, 미국) — 방화벽/UTM 도입 1순위급
- 운영체제는 FortiOS. 방화벽·VPN·IPS·웹필터·안티바이러스를 한 장비에서 처리하는 NGFW/UTM.
- 로그 형식: `키=값` 나열 형식(syslog). 핵심 필드 — devname(장비명)·devid(시리얼)·logid(10자리 로그 고유번호)·type·subtype·level·srcip/srcport·dstip/dstport·action·policyid(걸린 정책 번호)·sessionid.
- 로그 종류(type): **traffic**(허용/차단 트래픽, logid가 00으로 시작), **event**(시스템 이벤트, 01로 시작), **UTM 계열**(virus·webfilter·ips·app-ctrl 등 보안 탐지).
- 시그니처(패턴) 업데이트 채널: **FortiGuard**. 정기점검 때 FortiGuard 라이선스 만료일과 IPS·AV 정의 버전을 확인한다.
- 상태 확인 명령: `get system status`(버전·라이선스), `get system performance status`(CPU·메모리·세션), `get system ha status`(이중화 상태), `execute backup config`(설정 백업).

### PA 시리즈 (Palo Alto Networks, 미국) — 차세대 방화벽(NGFW) 대표
- 운영체제는 PAN-OS. 애플리케이션 식별(App-ID)·사용자 식별(User-ID) 기반 정책이 특징.
- 로그 종류: **Traffic**(세션), **Threat**(위협 탐지), **System**(장비 이벤트), Config(설정 변경), URL, WildFire(샌드박스), Authentication 등.
- 로그 형식: CSV 필드 나열. Traffic 로그 핵심 필드 — Receive Time·Serial Number·Type·Source/Destination Address·NAT 주소·Rule Name(걸린 정책명)·Application·Session ID·Action·Bytes·Packets.
- 시그니처 업데이트: **Dynamic Updates**(Applications and Threats·Antivirus·WildFire). `request content upgrade`로 갱신.
- 상태 확인 명령: `show system info`(버전), `show system resources`(자원), `show high-availability all`(이중화), 설정 백업은 Export named configuration snapshot.

### ASA / Firepower (Cisco, 미국) — 전통 방화벽의 표준
- 로그 형식: `%ASA-심각도-메시지ID` 구조의 syslog. 심각도는 0(emergency)~7(debug).
- 실무에서 가장 자주 보는 메시지 3종:
  - **%ASA-6-302013**: TCP 연결 생성(Built). 정상 세션 시작.
  - **%ASA-6-302014**: TCP 연결 종료(Teardown). duration(지속시간)·bytes(전송량)·종료 사유가 붙는다.
  - **%ASA-4-106023**: ACL(접근통제목록)에 걸려 패킷 **차단(Deny)**. 출발지/목적지 IP·포트와 걸린 ACL 이름이 나온다. 이 메시지가 특정 출발지에서 반복되면 스캔·공격 시도 의심.
- 상태 확인 명령: `show version`, `show cpu usage`, `show conn count`(세션 수), `show failover`(이중화).

## 2. 국산 장비 3종 (국내 공공·기업 도입 상위)

### SECUI MF2 (시큐아이, 한국) — 국내 네트워크 방화벽 시장 1위
- 시큐아이는 국내 네트워크 방화벽 시장 9년 연속 1위(2011~) 업체. MF2는 차세대 방화벽/UTM 제품군으로 애플리케이션 제어·40G급 성능 모델까지 라인업.
- 공공기관 도입이 많아 CC(Common Criteria) 인증 유지가 특징. 로그는 자체 포맷 syslog 연동 — SIEM/관제 시스템에 파서를 등록해 수집하는 것이 국내 관행.

### TrusGuard (안랩, 한국) — UTM/NGFW
- 안랩의 네트워크 보안 제품군. 대용량 트래픽용 10000P(50G급) 등 데이터센터급 모델 보유. V3 백신·위협 인텔리전스(ASD)와 연계되는 것이 강점.

### SNIPER (윈스, 한국) — 국내 IPS 대표
- 윈스의 침입방지시스템(IPS) 제품군(SNIPER ONE-i 등). 국내 IPS 시장을 주도하며 공공·통신사 도입이 많다. 탐지 로그는 공격명·시그니처ID·출발/목적지·대응(차단/탐지) 필드 중심.

## 3. GIJO AS와의 연계

- 위 장비들의 syslog·운영 리포트는 GIJO AS **분석 허브**(보안로그·운영리포트 소스)로 수집·정규화하는 대상이다.
- 장비 자체의 설정 점검은 **하드닝 점검**(kisa_net 표준 — 네트워크 장비 CLI 점검)과 연결된다.
- 장비 대장(모델·시리얼·EoS·유지보수 계약)은 **보안제품 등록부** 메뉴에서 관리한다.

출처: Fortinet Docs(FortiOS Log Message Reference — logid·type·필드 정의) / Palo Alto Networks Docs(Syslog Field Descriptions — Traffic·Threat·System Log Fields) / Cisco ASA Series Syslog Messages(302013·302014·106023) / 보안뉴스·시큐아이 공지(국내 방화벽 시장 1위·MF2/TrusGuard 10000P 출시)
