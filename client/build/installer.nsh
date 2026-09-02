; GIJO AS NSIS 커스텀 — 마법사형 소개 페이지 + VPN 안내 (2026-07-25)
;
; 왜 이 구성인가:
;  · 환영 페이지 = 제품 소개(설치 표준 UX — 첫 화면에서 무엇을 설치하는지 알린다)
;  · WireGuard는 동봉하지 않는다 — 상표 정책상 상용 동봉은 서면 허가가 필요해(정책 확인
;    2026-07-25) 완료 페이지에 공식 다운로드 링크만 안내(서술적 사용). VPN 설정(conf·비밀키)은
;    담당자별로 관리자에게 받는다 — 어떤 경우에도 설치본에 넣지 않는다(보안 원칙).
;    ⚠ 폐쇄망 PC에서는 그 링크가 열리지 않는다(2026-09-02 F1-04) — 「링크를 뺄지」는 사장님
;      결정 대기 중이다. 결정 전까지 링크는 그대로 둔다. 결정이 나면 이 두 줄도 함께 고칠 것.
;  · 이 페이지들은 **수동 설치와 인앱 업데이트 양쪽에서 다 보인다**(2026-09-02 F6-04 정정).
;    인앱 업데이트도 /S 없이 띄우기 때문이다 — 2026-07-29 사용자 신고로 /S를 뺐다(main.ts 참고).
;
; 그림(2026-07-26): 기본 파란 그림 대신 제품 로고를 쓴다. welcome.bmp·header.bmp는
; build/make-installer-bitmaps.mjs가 대시보드 중앙 로고(gijo-center.png)로 합성한다 —
; 로고가 바뀌면 그 스크립트만 다시 돌리면 되고, 손으로 만든 바이너리가 낡을 일이 없다.
; NSIS는 24비트 BMP만 받는다(PNG 불가).

; electron-builder가 기본 그림(nsis3-metro.bmp)을 먼저 !define 해 둔다 — 그냥 !define 하면
; "already defined!"로 빌드가 죽는다(2026-07-26 실측). 지우고 다시 정의해야 한다.
!undef MUI_WELCOMEFINISHPAGE_BITMAP
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\welcome.bmp"
!undef MUI_UNWELCOMEFINISHPAGE_BITMAP
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${BUILD_RESOURCES_DIR}\header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${BUILD_RESOURCES_DIR}\header.bmp"

!macro customWelcomePage
  ; ⚠ 이 마법사는 **새 설치와 인앱 업데이트 양쪽**에서 뜬다(F8-11) — 제목이 「설치를 시작합니다」
  ;   하나뿐이라 업데이트로 온 담당자는 재설치인지 설정이 지워지는지 헷갈렸다.
  ;   ⚠ ${isUpdated}로 가르지 않는다: 그건 **런타임** LogicLib 조건이고 !define은 **컴파일 타임**이라
  ;     섞어 쓸 수 없다(빌드가 깨지거나 조용히 무시된다). 양쪽 다 참인 한 벌 문구로 둔다.
  !define MUI_WELCOMEPAGE_TITLE "GIJO AS 설치 · 업데이트"
  ; 본문은 짧게 — 왼쪽 그림이 핵심 3가지를 이미 말한다. 길면 페이지 높이를 넘어 잘린다(실측).
  ; 줄이 길면 NSIS가 임의로 접어 글이 깨져 보인다(실측 2026-07-26) — 짧게 끊고 사이를 띄운다.
  ; ★ 이 줄의 **원본은 build/fix-welcome-text.mjs의 LINES 배열**이다(단일 출처).
  ;   여기만 고치면 그 스크립트를 다음에 돌리는 순간 되돌아간다 — 반드시 LINES를 고치고
  ;   `node build/fix-welcome-text.mjs`로 이 줄을 다시 쓴다. 줄 수(12개)는 늘리지 않는다.
  !define MUI_WELCOMEPAGE_TEXT "사내에서만 도는 AI 보안관제 플랫폼입니다.$\r$\n$\r$\n   ·  취약점 · 로그 · 리포트를 한곳에서 분석$\r$\n$\r$\n   ·  로컬 LLM — 자료가 외부로 나가지 않습니다$\r$\n$\r$\n   ·  AI-BOM · 레드팀으로 AI 자산까지 보호$\r$\n$\r$\n이 PC 사용자 폴더에 설치됩니다 · 설치 위치 변경 없음$\r$\n업데이트여도 설정·로그인 정보는 그대로 남습니다.$\r$\n설치 뒤 관리자에게 받은 서버 주소로 로그인합니다.$\r$\n계속하려면 [다음]을 누르세요."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; 완료 페이지 — 원격 접속(VPN) 안내 링크. WireGuard는 Jason A. Donenfeld의 등록상표이며
; 여기서는 공식 사이트 안내(서술적 사용)만 한다.
!define MUI_FINISHPAGE_LINK "원격 접속(VPN)이 필요하면: WireGuard 공식 다운로드 — 설정 파일은 관리자에게 받으세요"
!define MUI_FINISHPAGE_LINK_LOCATION "https://www.wireguard.com/install/"
