# 리눅스 SSH root 원격 로그인 차단 — KISA U-시리즈
- 점검 항목: KISA 주요정보통신기반시설 기술적 취약점 분석·평가(U-시리즈)의 "U-01 root 계정 원격 접속 제한"(계정관리, 상 등급).
- 판단 기준(양호): root 계정으로 원격(telnet/SSH) 직접 접속이 차단되어 있고, 일반 계정으로 로그인 후 su/sudo로 권한 상승하도록 구성.
- 조치 방법(SSH): /etc/ssh/sshd_config 에서 PermitRootLogin no 설정 후 sshd 재시작(systemctl restart sshd). 필요 시 AllowUsers로 접속 허용 계정 제한. telnet은 서비스 비활성화.
- 근거: root 원격 직접 접속은 무차별 대입(brute-force)의 표적이 되고 감사 추적이 어려움. 일반계정→권한상승 경로로 책임추적성 확보.
- 관련: U-02(패스워드 복잡성), U-44(root 홈·PATH), SSH 프로토콜 2 사용.
