# 보안 장비 릴리즈노트 읽는 법 + 대표 장애처리 노트

(GIJO AS 지식베이스용 — 벤더 공식 릴리즈노트·트러블슈팅 공개 문서 기반, 2026-07 리서치)

## 1. 릴리즈노트를 읽는 법 (버전 올리기 전 3가지 확인)

펌웨어·OS를 올리기 전 릴리즈노트에서 반드시 확인할 3가지:

1. **Upgrade Path(업그레이드 경로)**: 현재 버전에서 목표 버전으로 바로 갈 수 있는지, 중간 버전을 거쳐야 하는지. 경로를 무시한 업그레이드는 설정 유실·부팅 실패의 흔한 원인이다.
2. **Resolved Issues(해결된 문제)**: 지금 겪는 증상이 이번 버전에서 고쳐졌는지 버그 ID로 확인 — 겪는 문제가 목록에 있으면 업그레이드가 곧 해결책이다.
3. **Known Issues(알려진 문제)**: 새 버전에 아직 남아 있는 문제. 우리 환경(HA 구성·사용 기능)에 걸리는 항목이 있으면 업그레이드를 보류하거나 회피 설정을 준비한다.

공통 원칙: 업그레이드 전 설정 백업 → 유지보수 시간(서비스 영향 적은 시간대) 확보 → HA 구성이면 Standby부터 올리고 절체 후 나머지 진행.

## 2. FortiGate 대표 장애 — 컨서브 모드(conserve mode)

- 증상: 장비가 느려지고 GUI에 컨서브 모드 배너가 뜨며, System Events 로그에 "The system has entered conserve mode" 메시지가 남는다.
- 의미: **메모리가 위험 수준(red)까지 차서** FortiOS가 스스로 기능을 줄여 버티는 상태. 안티바이러스 등 프록시 검사 동작이 축소되고, 메모리가 극한(extreme)이면 트래픽이 드랍되기 시작한다.
- 대응: ① 원인 프로세스 확인(`diagnose sys top` — IPS 엔진·WAD 프로세스가 흔한 원인) ② 세션 급증·정책 과다 여부 점검 ③ IPS 엔진 재시작(`diagnose test application ipsmonitor 99`) 또는 장비 재시작 ④ 반복되면 메모리 증설 모델 검토·펌웨어 버그(Resolved Issues) 확인.
- 참고: 컨서브 모드 중 flow 검사 신규 세션 처리 방식은 `ips failopen` 설정을 따른다(기본값은 신규 세션 드랍).

## 3. Palo Alto 대표 장애 — 커밋(Commit) 실패

- 증상: 설정 변경 후 Commit이 실패하거나 무한 대기.
- 대응 절차: ① 우하단 **Tasks**에서 해당 커밋 작업의 Job ID·Validation Error 확인(원인 대부분이 여기 명시됨) ② 검증 오류(참조 깨진 객체·중복 이름)를 고치고 재커밋 ③ 릴리즈노트 Known Issues에서 커밋 관련 버그 확인 ④ Panorama 환경이면 Panorama 쪽 커밋인지 방화벽 쪽 커밋인지 구분해 진단.
- 시그니처 업데이트 실패: **Device > Troubleshooting**에서 Update Server 연결 테스트 → DNS·아웃바운드 443 차단 여부 확인.

## 4. 공통 장애 — HA 이중화 문제

- **절체(failover) 발생**: 이벤트 로그에서 절체 시각·원인(인터페이스 다운, 헬스체크 실패)을 확인하고, 원인 해소 전 임의로 되돌리지(failback) 않는다.
- **스플릿 브레인(양쪽 다 Active)**: HA 링크(하트비트) 단선이 흔한 원인 — HA 전용 케이블·스위치 포트부터 점검.
- **설정 비동기화**: FortiGate `diagnose sys ha checksum cluster`로 양쪽 설정 해시 비교, PAN-OS는 HA 위젯의 config sync 상태 확인.

## 5. 공통 장애 — 세션 고갈·성능 저하

- 증상: 신규 연결 실패·간헐 타임아웃, CPU는 낮은데 통신이 안 됨.
- 확인: 동시 세션 수를 스펙 한도와 비교(FortiGate `get system performance status`, ASA `show conn count`). 특정 출발지가 세션을 대량 점유하면 스캔·웜 감염 의심 — 차단 로그(ASA 106023 등)와 교차 확인.

## 6. GIJO AS 활용 팁

- 장비 로그를 분석 허브로 보내두면 위 증상들의 로그 패턴(컨서브 모드 메시지·절체 이벤트·106023 반복)을 상관분석에서 잡을 수 있다.
- 릴리즈노트·장애처리 노트 PDF를 기억·학습 화면에 올리면(원본 보관·열람 지원) 챗봇이 해당 장비 버전 기준으로 답한다.

출처: Fortinet Docs — Conserve mode(FortiOS Administration Guide)·Fortinet Community Troubleshooting Tip("The system has entered conserve mode"·IPS Engine/WAD 원인) / Palo Alto Networks Docs — Troubleshoot Commit Failures(Tasks·Job ID·Validation Errors)·Device > Troubleshooting(Update Server 테스트) / FortiOS Release Notes 구성(Upgrade Path·Resolved/Known Issues)
