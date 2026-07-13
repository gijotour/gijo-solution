# GIJO AS — 서버/클라이언트(CS) 구조

`로컬LLM_프로젝트_가이드.md` 7~9단계에서 설계한 단일 Electron 앱을
클라이언트-서버(CS) 구조로 전환한 버전입니다.

## 왜 CS 구조인가

- GIJO AS의 원래 기획서에도 오케스트레이터가 "보안 AI 중계서버"로 명명되어 있었습니다 —
  CS 구조가 원래 의도된 방향이었음을 확인했습니다.
- 로컬 LLM(RTX 3090), 자산 DB, SBOM/CTI 데이터는 상태를 가지며 GPU 리소스가 필요합니다 —
  여러 보안담당자가 각자 PC에서 접속하되 실제 연산/데이터는 서버 한 대(또는 사내 서버실)에
  집중하는 편이 기업 고객(특히 금융권 온프레미스 요구)에 적합합니다.
- 클라이언트를 얇게 유지하면 배포/업데이트가 클라이언트 재설치만으로 끝나고,
  민감한 로직·자격증명은 서버에만 존재합니다.

## 구조

```
cs/
├── server/     Java/Spring Boot 3.x + Spring WebSocket. 15개 상태/GPU/DB 서비스 모듈 전부 여기서 실행.
│               (com.gijo.as.engine.* 패키지 하위) + 인증/보안(Spring Security + JWT)
└── client/     Electron. 창 관리 + REST/WebSocket 호출만 담당하는 얇은 클라이언트.
                intent/llm/tools 라우팅도 서버 API 호출로 대체됨(로직은 서버에 있음).
```

## 실행 방법(스캐폴드 기준)

### 단일 데스크톱 모드(1인 기업/소규모, 서버+클라이언트를 한 PC에)

```powershell
# 서버 (Java/Spring Boot) 빌드 및 실행
cd server
.\gradlew.bat build -x test
java -jar build/libs/server-0.0.1-SNAPSHOT.jar

# 클라이언트 (Electron) 빌드 및 실행
cd ../client
npm install
npm run build
npm start   # client가 자동으로 로컬 서버가 기동되었는지 확인 후 localhost:4000에 접속
```

### 분산 모드(기업 고객, GPU 서버 1대 + 보안담당자 여러 PC)

```powershell
# RTX 3090 서버 머신에서 (Java/Spring Boot 실행)
cd server
.\gradlew.bat build -x test
java -jar build/libs/server-0.0.1-SNAPSHOT.jar   # 0.0.0.0:4000 상시 실행

# 각 보안담당자 PC에서 (클라이언트 Electron 실행)
cd client
npm install
npm run build
$env:GIJO_SERVER_URL="http://<서버-IP>:4000"
npm start
# 또는 로그인 화면에서 서버 주소를 직접 입력
```

## 인증 및 보안

Spring Security 및 JWT(Bearer Token) 기반으로 인증이 제어됩니다. 사용자 계정 및 암호는 DB 또는 `server/src/main/resources/application.yml`에 등록하며, 비밀번호는 `BCryptPasswordEncoder`에 의해 안전하게 해시 암호화되어 비교됩니다.

## 알려진 미결 항목

- JWT 토큰 만료 및 갱신(Access/Refresh Token) 정책 추가 설계
- CORS 허용 범위 튜닝 — 온프레미스 배포 시 사내망 도메인/오리진으로 제한
- 자산 인벤토리(Assets) 전용 API 데이터 파이프라인 실시간 매핑 보완
- 자연어 라우팅(`IntentService`)의 정규식 구성을 로컬 LLM 추론으로 교체
