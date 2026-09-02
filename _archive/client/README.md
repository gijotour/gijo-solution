# GIJO AS 클라이언트 (Electron)

GIJO AS(AI SBOM · Security Manager Platform)의 데스크톱 클라이언트입니다.
[CS 구조] 이 앱은 상태를 갖지 않는 얇은 클라이언트로, 모든 실제 로직(로컬 LLM,
자산 DB, SBOM 생성, CTI 피드, 파인튜닝 등)은 `../server`에서 실행됩니다.

## 구조

```
src/
├── main.ts          메인 프로세스 (창 관리만 담당, engine 로직 없음)
├── preload.ts        window.gijo.* 노출 (내부적으로 apiClient.ts 사용)
├── apiClient.ts       서버 REST API fetch 래퍼 (인증 토큰 관리 포함)
├── wsClient.ts         서버 WebSocket 실시간 이벤트 구독
├── types/electron-shim.d.ts   sandbox 환경에서 npm install electron 없이 타입체크하기 위한 최소 셸
└── renderer/
    ├── core.ts        공통 렌더러 로직 (nav, 채팅바, 로그아웃, 협업 피드)
    └── pages/
        ├── login.html      보안담당자 로그인 화면(최초 진입점)
        ├── dashboard.html  대시보드(에이전트 네트워크 뷰)
        ├── inventory.html  자산 인벤토리
        ├── sbom.html       SBOM 관리
        ├── threat.html     위협 인텔리전스(CTI)
        ├── merge.html      모델 머지 랩
        ├── report.html     내부 리포트
        ├── billing.html    사용량/요금
        └── agent.html      에이전트 AI(협업/지시)
```

## 실행 모드

**단일 데스크톱 모드**: `../server`가 같은 배포 패키지에 동봉되어 있으면
main.ts가 앱 시작 시 서버를 자동으로 `localhost:4000`에 기동합니다.
보안담당자는 로그인 화면에서 서버 주소를 비워두면 됩니다(기본값 사용).

**분산 모드**: 사내망 GPU 서버(RTX 3090)에 `server`를 상시 실행해두고,
클라이언트 여러 대가 로그인 화면에서 그 서버 주소(예: `http://192.168.x.x:4000`)를
입력해 접속합니다. 이 경우 클라이언트는 서버를 자동 기동하지 않습니다
(`GIJO_SERVER_URL` 환경변수가 설정되어 있으면 번들 서버 기동 로직을 건너뜁니다).

## 개발

```
npm install          # electron, typescript 등 (sandbox 환경 외부에서 실행할 것)
npm run build         # tsc로 dist/ 컴파일
npm start              # 빌드 후 electron .
```

## 알려진 미결 항목 (스캐폴드 수준 한계)

- `assets:list`(자산 인벤토리 목록) 전용 서버 라우트 미구현 — inventory.html은 현재 목업 데이터로 동작
- 인증 토큰은 메모리에만 보관(앱 재시작 시 재로그인 필요) — OS 자격 증명 저장소 연동 검토 필요
- 서버 비밀번호 해시가 평문 TODO 상태(`server/src/auth/users.ts`) — 프로덕션 전 bcrypt 적용 필수
