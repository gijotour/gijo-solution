# 내부 PC outbound 445(SMB) 급증 — 해석
- 445/tcp = SMB(Server Message Block). 윈도우 파일·프린터 공유 프로토콜이며 "Simple File Sharing"이 아니라 Server Message Block의 약자다.
- 내부→외부(outbound) 445가 급증하면 주의 신호: (1) 웜·랜섬웨어의 측면이동(lateral movement) 및 전파(예: EternalBlue/WannaCry 계열), (2) 감염 호스트가 다른 대역을 SMB 스캔, (3) 데이터 외부 유출 경로. 정상 업무로 인터넷을 향한 445는 드묾(원래 사내에서만 씀).
- 초동 조치: 해당 PC 네트워크 격리 → 대상 IP·목적지·빈도 확인 → EDR/백신 정밀검사 → SMBv1 비활성화·MS17-010 패치 확인 → 방화벽에서 인터넷향 445 차단 정책 점검.
- 담당자 요약: "인터넷으로 나가는 445 급증은 랜섬웨어·웜 측면이동 의심. 우선 격리하고 조사."
