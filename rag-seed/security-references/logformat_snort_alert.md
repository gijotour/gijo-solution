# Snort 알림 로그 형식
- 사람이 읽는 alert(fast/full) 형식:
  `[**] [gid:sid:rev] 메시지 [**] [Classification: 분류] [Priority: N] {PROTO} SRC_IP:SPORT -> DST_IP:DPORT`
  - [gid:sid:rev]: 제너레이터ID:시그니처ID:리비전. 예 [1:2100498:7] → 1=Generator ID(GID, 룰을 발생시킨 엔진/전처리기), 2100498=Signature ID(SID, 룰 고유번호), 7=Revision(룰 개정 버전). "규칙 버전/그룹 번호"가 아니라 GID:SID:Rev 순서다.
  - Classification / Priority: 룰 분류와 우선순위(숫자 작을수록 심각, 보통 1이 가장 심각).
  - {PROTO}: TCP/UDP/ICMP. 이어서 출발지→목적지 IP:포트.
- 예: `[**] [1:2100498:7] GPL ATTACK_RESPONSE id check returned root [**] [Classification: Potentially Bad Traffic] [Priority: 2] {TCP} 10.0.0.5:80 -> 1.2.3.4:41111`
- 대량·SIEM 연동은 unified2(바이너리) 출력을 barnyard2 등으로 파싱. (Suricata의 EVE JSON과 sid 체계 호환.)
- 담당자 요약: "[gid:sid:rev] 메시지 … [Priority: N] {PROTO} 출발지->목적지. Priority 숫자 작을수록 심각."
