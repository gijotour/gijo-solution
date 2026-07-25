; GIJO AS NSIS 커스텀 — 마법사형 소개 페이지 + VPN 안내 (2026-07-25)
;
; 왜 이 구성인가:
;  · 환영 페이지 = 제품 소개 3줄(설치 표준 UX — 첫 화면에서 무엇을 설치하는지 알린다)
;  · WireGuard는 동봉하지 않는다 — 상표 정책상 상용 동봉은 서면 허가가 필요해(정책 확인
;    2026-07-25) 완료 페이지에 공식 다운로드 링크만 안내(서술적 사용). VPN 설정(conf·비밀키)은
;    담당자별로 관리자에게 받는다 — 어떤 경우에도 설치본에 넣지 않는다(보안 원칙).
;  · 자동 업데이트는 /S(무인)로 돌므로 이 페이지들은 수동 설치에만 보인다.

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "GIJO AS 설치를 시작합니다"
  !define MUI_WELCOMEPAGE_TEXT "GIJO AS는 온프레미스 AI 보안관제 플랫폼입니다.$\r$\n$\r$\n  ·  취약점 스캐너·보안로그·보안제품 리포트를 한곳에서 통합 분석$\r$\n  ·  로컬 LLM 기반 — 사내 데이터가 외부로 나가지 않습니다$\r$\n  ·  AI-BOM·레드팀·가드레일로 AI 자산까지 보호$\r$\n$\r$\n설치 후 사내 GIJO 서버 주소로 접속해 로그인하면 바로 사용할 수 있습니다.$\r$\n원격(사외) 접속이 필요한 담당자는 설치 완료 화면의 VPN 안내를 참고하세요.$\r$\n$\r$\n계속하려면 [다음]을 누르세요."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; 완료 페이지 — 원격 접속(VPN) 안내 링크. WireGuard는 Jason A. Donenfeld의 등록상표이며
; 여기서는 공식 사이트 안내(서술적 사용)만 한다.
!define MUI_FINISHPAGE_LINK "원격 접속(VPN)이 필요하면: WireGuard 공식 다운로드 — 설정 파일은 관리자에게 받으세요"
!define MUI_FINISHPAGE_LINK_LOCATION "https://www.wireguard.com/install/"
