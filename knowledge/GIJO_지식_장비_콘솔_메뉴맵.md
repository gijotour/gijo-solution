# 보안 장비 관리 콘솔 메뉴맵 (어디서 무엇을 보나)

(GIJO AS 지식베이스용 — 벤더 공식 관리자 가이드(공개판) 기반, 2026-07 리서치. "이 기능 어느 메뉴에 있어?" 질문 대응용)

## 1. FortiGate (포티게이트, FortiOS GUI) 메뉴 경로

- 트래픽(허용/차단) 로그 보기: **Log & Report > Forward Traffic**. 특정 정책·주소로 필터해 어떤 정책(policyid)에 걸렸는지 확인한다.
- 시스템 이벤트(재부팅·HA 절체·컨서브 모드 진입 등): **Log & Report > System Events**.
- 보안 탐지(IPS·안티바이러스·웹필터) 로그: **Log & Report** 아래 각 Security 로그 항목.
- 펌웨어 업그레이드: **System > Firmware & Registration**. 업그레이드 전 설정 백업이 원칙.
- 설정 백업: 우상단 관리자 메뉴 > **Configuration > Backup** (또는 CLI `execute backup config`).
- 시그니처(FortiGuard) 상태·라이선스: **System > FortiGuard**. 정의 버전·만료일 확인.
- 정책 관리: **Policy & Objects > Firewall Policy**. 정책별 적중(hit) 카운트로 무적중 룰을 찾는다.
- HA(이중화) 상태: **System > HA** (CLI `get system ha status`).
- syslog 전송 설정(GIJO AS 분석 허브로 로그 보낼 때): **Log & Report > Log Settings**에서 syslog 서버 지정.

## 2. Palo Alto (팔로알토, PAN-OS 웹 UI) 메뉴 경로

팔로알토 방화벽(PA 시리즈)의 웹 관리 화면 기준 메뉴 위치다.

- 트래픽 로그: **Monitor > Logs > Traffic**. 위협 로그: **Monitor > Logs > Threat**. 장비 이벤트: **Monitor > Logs > System**.
- 시그니처(콘텐츠) 업데이트: **Device > Dynamic Updates** — Applications and Threats·Antivirus·WildFire를 여기서 다운로드·설치·스케줄 설정.
- PAN-OS 업그레이드: **Device > Software**.
- 설정 백업/복원: **Device > Setup > Operations** — Export named configuration snapshot(백업), Load(복원).
- 커밋(설정 반영): 우상단 **Commit**. 실패 시 작업 내역은 **Tasks**(우하단)에서 Job ID·Validation Error를 확인한다.
- 업데이트 서버 연결 진단: **Device > Troubleshooting**에서 Update Server 연결 테스트.
- HA 상태: **Dashboard의 HA 위젯** 또는 CLI `show high-availability all`.
- 대시보드 통계(애플리케이션·위협 요약): **ACC**(Application Command Center) 탭.

## 3. Cisco ASA (시스코, ASDM/CLI)

- 실시간 로그 보기: **ASDM > Monitoring > Logging > Real-Time Log Viewer** (CLI `show logging`).
- syslog 서버 설정: **Configuration > Device Management > Logging > Syslog Servers**.
- 이중화(failover) 상태: **Monitoring > Properties > Failover** (CLI `show failover`).
- 설정 저장/백업: CLI `write memory`, `copy running-config tftp:` 등.

## 4. 국산 장비 (SECUI MF2 · TrusGuard · SNIPER)

국산 3종은 웹 관리콘솔 구성이 대체로 [모니터링/로그 조회]·[정책 관리]·[시스템(업데이트·이중화·백업)] 3계열로 나뉜다. 세부 메뉴 명칭은 장비 버전별 관리자 매뉴얼을 따르며, 매뉴얼 PDF를 GIJO AS 지식베이스에 올리면(기억·학습 화면) 메뉴 위치 질문에 그 매뉴얼 기준으로 답한다.

## 5. 자주 묻는 메뉴 질문 (Q&A 예시)

- "FortiGate에서 차단 로그 어디서 봐?" → Log & Report > Forward Traffic에서 Action=deny 필터.
- "팔로알토 시그니처 업데이트 어디서 해?" → Device > Dynamic Updates.
- "포티 설정 백업 어떻게 해?" → 관리자 메뉴 > Configuration > Backup 또는 execute backup config.
- "PAN-OS 커밋했는데 실패했어" → 우하단 Tasks에서 해당 커밋 Job의 Validation Error부터 확인.

출처: Fortinet Document Library(FortiOS Administration Guide — Log & Report·System·Conserve mode) / Palo Alto Networks Docs(PAN-OS Web Interface Help — Device > Dynamic Updates·Troubleshooting, Panorama Troubleshoot Commit Failures) / Cisco ASA 구성 가이드(ASDM Monitoring·Syslog 설정)
