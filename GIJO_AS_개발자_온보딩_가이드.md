# GIJO AS 개발자 온보딩 가이드

> 신규 합류 엔지니어가 첫 1~2일 안에 코드베이스를 파악하고 로컬에서 돌려보는 것을 목표로 한 문서.
> 마케팅 문서가 아니다 — **무엇이 실제로 동작하고 무엇이 스텁인지**를 그대로 적었다. 배경 히스토리와
> 배포 모드의 전체 맥락은 `로컬LLM_프로젝트_가이드.md`(특히 9.3절, 9.5절)를 참고.

---

## 1. 이 제품이 뭔가

**GIJO AS**는 AI 기반 보안 오케스트레이터다. 보안담당자가 자연어로 지시를 내리면
("web-api 자산 스캔해줘"), 로컬 LLM 에이전트 팀이 자산 스캔 → 취약점 분석 → 우선순위 판단 →
보고서 작성을 수행한다. 핵심 기능 영역:

- **자산 인벤토리** — AI 모델/코드 자산 등록, 스캔 이력, 실시간 상태 갱신
- **SBOM** — CycloneDX 형식의 소프트웨어 자재명세서 생성
- **취약점 스캔** — 스캔 어댑터(ModelScan 등)를 브릿지로 연결
- **CTI** — 딥웹/다크웹 위협 인텔리전스 벤더 피드 연동 (키 관리까지 구현, 벤더 호출은 미구현 — 6절 참고)
- **로컬 LLM 에이전트 팀** — 8개 고정 에이전트가 GPU 머신의 llama.cpp(llama-server)를 두뇌로 사용
- **RAG 메모리 / 파인튜닝** — LanceDB 기반 지식베이스, QLoRA 파인튜닝 파이프라인(트리거만 구현)
- **리포트 · 이메일** — DOCX 보고서 생성(LLM이 경영진 요약 작성), SMTP 발송

모든 연산은 온프레미스에서 이루어진다. 외부 SaaS LLM 호출 없음 — LLM은 서버 머신(RTX 3090)의
llama-server 프로세스다.

---

## 2. 아키텍처 한눈에 보기

클라이언트-서버 구조다. 상태를 가진 모든 것은 서버가 단독 소유한다.

```
[Electron 클라이언트 N대 (얇은 셸)]
   │  REST (JWT Bearer)          │  WebSocket /ws (채널 멀티플렉싱)
   ▼                             ▼
[gijo-as-server — Node.js + Express + TypeScript, GPU 머신에서 상시 실행]
   ├─ SQLite (better-sqlite3, data/gijo-as.sqlite) ← assets/scan_runs/tasks/cti_feeds/smtp_config
   ├─ LanceDB (data/memory.lancedb) ← RAG 문서 청크 + 임베딩
   ├─ llama-server 자식 프로세스 (localhost:8080, OpenAI 호환 API) ← localengine.ts가 스폰/스왑/종료
   └─ 임베딩용 llama-server 별도 프로세스 (localhost:8081, --embedding) ← memory.ts가 사용
```

- **서버**(`server/`)가 진짜 본체다. 자산 DB, LLM 프로세스, RAG, 에이전트 상태 전부 서버에 있다.
- **클라이언트**(`client/`)는 Electron 데스크톱 앱이지만 렌더러에서 아무 로직도 소유하지 않는다.
  `preload.ts`가 `window.gijo.*` API를 노출하고, 전부 `apiClient.ts`를 통해 서버 REST를 호출한다.
  실시간 이벤트는 `wsClient.ts`가 `/ws` 하나로 받아 채널별로 분배한다.
- **`server-java-reference/`는 현재 스택이 아니다.** Java/Spring Boot로 재작성을 검토했다가
  TypeScript로 번복한 뒤, 금융권 고객 온프레미스 보안성 검토가 문제될 경우의 폴백으로만 남겨둔
  참고용 구현체다. 신규 기능은 절대 여기에 넣지 말 것. (배경: 가이드 9.5~9.6절)

### 실시간 채널 (WebSocket)

단일 엔드포인트 `/ws`, 프레임은 `{ channel, payload }` JSON. 현재 채널 4개:

| 채널 | 발신 모듈 | 용도 |
|---|---|---|
| `collaboration:event` | `collaboration.ts` | 에이전트 간 협업 로그 (오케스트레이터 ↔ 에이전트 메시지) |
| `finetune:progress` | `finetune.ts` | 파인튜닝 step/loss 진행률 |
| `asset:updated` | `assets.ts` | 자산 등록/스캔 완료/SBOM 생성 시 실시간 갱신 |
| `log:event` | `logs.ts` | 서버 console 캡처 로그 스트리밍 (설정 페이지 로그 뷰어) |

클라이언트는 로그인 성공 후에 `window.gijoRealtime.connect()`로 WS를 연다(인증 전 연결 방지).

---

## 3. 디렉터리 투어

```
D:\Connect AI\
├─ server/                       # 본체. Node.js + Express + TS
│  ├─ src/
│  │  ├─ index.ts                # 부트스트랩: HTTP 리스닝 + WS 부착 + 종료 시 llama-server 정리
│  │  ├─ app.ts                  # Express 앱 조립 — 모든 라우트 등록이 여기 한 곳에 모임
│  │  ├─ db.ts                   # SQLite 스키마 단독 소유 (assets, scan_runs, tasks, cti_feeds, smtp_config, users)
│  │  ├─ auth/
│  │  │  ├─ auth.ts              # JWT access + refresh 토큰, authMiddleware, adminMiddleware
│  │  │  └─ users.ts             # 계정 SQLite CRUD + admin 전용 라우트 (최초 기동 시 admin 자동 시드)
│  │  └─ engine/                 # 엔진 모듈 ~20개. 1모듈 = 1 register*Routes() 함수
│  ├─ test/                      # Vitest + supertest, 19개 파일 83개 테스트
│  └─ vitest.config.ts           # GIJO_DB_PATH=:memory: + 더미 암호화 키 주입
├─ client/                       # Electron 얇은 클라이언트
│  ├─ src/
│  │  ├─ main.ts                 # 창 관리 + 페이지 네비게이션 + 번들 서버 자동 기동(단일 데스크톱 모드)
│  │  ├─ preload.ts              # window.gijo.* API 표면 (contextIsolation, sandbox: true)
│  │  ├─ apiClient.ts            # REST 클라이언트 (401 시 refresh 후 1회 재시도)
│  │  ├─ wsClient.ts             # WS 연결 + onChannel/offChannel
│  │  └─ renderer/pages/*.html   # 13개 페이지, 바닐라 HTML/CSS/JS (프레임워크 없음)
│  └─ scripts/
│     ├─ rebuild-server-native.mjs   # dev용: ../server를 Electron ABI로 재빌드 (주의: 5.3절)
│     └─ build-server-dist.mjs       # 패키징용: client/server-dist/ 프로덕션 사본 생성
├─ server-java-reference/        # (참고용) 폐기된 Java/Spring 재작성 — 건드리지 말 것
├─ 로컬LLM_프로젝트_가이드.md      # 프로젝트 전체 히스토리 + 인프라/모델 가이드 (방대함, 필요한 절만)
└─ GIJO_AS_*.html                # 초기 UI 시안 (참고용 정적 목업)
```

---

## 4. 서버 엔진 모듈 지도

`server/src/engine/`의 각 파일은 자기 REST 라우트를 스스로 등록한다(`registerXxxRoutes(app)`).
`app.ts`를 열면 전체 라우트 그룹이 한눈에 보인다. 모듈 → 라우트 매핑:

| 모듈 | 라우트 | 역할 |
|---|---|---|
| `auth/auth.ts` | `POST /api/auth/login` `/refresh` `/logout`, `GET /api/auth/me` | JWT 발급/회전/검증 |
| `agents.ts` | `GET /api/agents` | 8개 고정 에이전트 정의 + 라이브 상태(인메모리, 의도적) |
| `assets.ts` | `GET/POST /api/assets`, `GET /api/assets/:id` | 자산 레지스트리 + 스캔 이력 + `asset:updated` 브로드캐스트 |
| `dispatcher.ts` | `POST /api/dispatch` | 자연어 지시 → 의도 라우팅 → 에이전트 실행 → 작업 완료까지의 파이프라인 |
| `intent.ts` | `POST /api/intent/route` | LLM few-shot 의도 분류, 파싱 실패/LLM 다운 시 정규식 폴백 |
| `tasks.ts` | `GET/POST /api/tasks`, `POST /api/tasks/:id/complete` | 작업 큐 (P0~P3 우선순위, SQLite 영속) |
| `bridge.ts` | `POST /api/bridge/run`, `GET /api/bridge/adapters` | 스캔 어댑터 레지스트리 (`StandardFinding` 공통 포맷) |
| `llm.ts` | `POST /api/llm/chat` | llama-server(OpenAI 호환, :8080) 프록시 + `embed()`(:8081) |
| `localengine.ts` | `GET /api/localengine/status`, `POST .../start` `.../stop` | llama-server 프로세스 생명주기, 모델 스왑 |
| `memory.ts` | `POST /api/memory/ingest` `/query` | RAG (LanceDB, 청크 800/오버랩 100) |
| `finetune.ts` | `POST /api/finetune/start` | QLoRA 파인튜닝 트리거 + `finetune:progress` 스트리밍 |
| `dataset.ts` | `POST /api/dataset/convert` `/amplify` | 파인튜닝용 데이터셋 변환/증폭 |
| `sbom.ts` | `POST /api/sbom/:assetId/generate` `/export` | CycloneDX SBOM 생성 (SPDX는 미구현 — throw) |
| `cti.ts` | `GET /api/cti/feeds` `/findings`, `POST /api/cti/feeds/:id/configure` `/disconnect` | CTI 벤더 키 암호화 저장 (findings는 스텁) |
| `report.ts` | `POST /api/report/generate` | DOCX 보고서 생성 (경영진 요약은 LLM이 작성) |
| `email.ts` | `GET/POST /api/email/config`, `POST /api/email/sendReport` | SMTP 설정(DB 저장, 비밀번호 암호화) + 발송 |
| `hfmodels.ts` | `GET /api/hfmodels/search`, `POST /api/hfmodels/load` | HF 공개 API 모델 검색 / 다운로드(스텁성 — 6절) |
| `gitsync.ts` | `POST /api/gitsync/sync` | simple-git 기반 내부 git 동기화 |
| `tools.ts` | `GET /api/tools`, `POST /api/tools/run` | 도구 레지스트리 |
| `collaboration.ts` | `GET /api/collaboration/history` | 협업 로그 이력 + WS 브로드캐스트 |
| `usage.ts` | `GET /api/usage/summary` | API 사용량 로깅 미들웨어 + 요약 (billing 페이지 데이터) |
| `logs.ts` | `GET /api/logs` | console 캡처 링버퍼 + `log:event` 스트리밍 |
| `cryptopack.ts` | (라우트 없음) | AES-256-GCM 암호화 유틸 — cti.ts/email.ts가 내부 사용 |
| `analysis.ts` | (라우트 없음) | `analyzeFindings()` — dispatcher가 스캔 결과 요약에 사용 |
| `mcp.ts` | (라우트 없음) | MCP 서버 스캐폴드(stdio) — `app.ts`에 연결되어 있지 않음, 실험 단계 |

`/api/health`는 `app.ts`가 직접 등록한다(인증 불필요). 나머지 거의 모든 라우트는 `authMiddleware`를 탄다.

### 에이전트 8개 (agents.ts)

`orchestrator`(watching) / `scan` / `pentest` / `analysis` / `sbom` / `cti`(watching) / `report` /
`model-evolution`. 각자 `brainModelId`(qwen3-30b-a3b, deephat-v1-7b, foundation-sec-8b 등)를 갖는다.
**에이전트 status(idle/working/watching)는 의도적으로 DB에 저장하지 않는다** — 재시작 후에도
"working"이 남아 있으면 죽은 작업이 살아있는 것처럼 보이기 때문. 재시작 시 초기화가 정상 동작이다.

### 디스패치 파이프라인 (dispatcher.ts)

`POST /api/dispatch` 한 번에 다음이 일어난다:

1. `routeIntent()` — 로컬 LLM few-shot 분류 (실패 시 정규식 폴백)로 `{agentId, action, targetAssetId}` 결정
2. 작업 생성 (액션 기반 초기 우선순위: scan/analyze=P1, 그 외 P2)
3. 에이전트 status → `working`, `collaboration:event` 브로드캐스트
4. 액션 실행 — scan이면 `runAdapter("modelscan", ...)` → `recordFindings()` → `analyzeFindings()`,
   그 외는 `chat()`으로 LLM 응답
5. 스캔 findings의 최고 severity로 우선순위 재산정 (critical=P0, high=P1, medium=P2, 그 외 P3)
6. 에이전트 status 원복, 작업 완료 처리

---

## 5. 로컬에서 돌리기 (dev 모드)

### 5.1 서버

```bash
cd server
npm install
npm test        # Vitest — 디스크/실키 파일 안 건드림 (:memory: DB + 더미 키)
npm start       # = npm run build && node dist/index.js → http://localhost:4000
```

- 기본 포트 4000 (`GIJO_SERVER_PORT`). WS는 같은 포트의 `/ws`.
- **기본 시드 계정: `jyh` / `changeme`** — `users` 테이블(SQLite)이 비어 있을 때 최초 기동 시
  자동 생성되는 admin 계정. 이후 admin이 settings.html의 "계정 관리" 패널 또는
  `POST /api/users`로 팀원 계정을 추가할 수 있다.
- 첫 기동 시 `data/gijo-as.sqlite`(WAL 모드)와 `data/encryption.key`(미지정 시 자동 생성)가 생긴다.
- `NODE_ENV=production`에서는 `GIJO_JWT_SECRET` 없이 **부팅 자체가 거부된다**(auth.ts 상단 throw).
  개발 모드에서는 기본 dev 시크릿으로 뜬다.

### 5.2 클라이언트

```bash
cd client
npm install
npm start       # = tsc + esbuild(preload 번들) + electron .
```

- `GIJO_SERVER_URL`이 설정돼 있으면 그 원격 서버로 붙는다(분산 모드).
- 미설정이면 `main.ts`의 `maybeStartBundledServer()`가 동봉 서버를 찾아 자동 기동한다(단일 데스크톱
  모드). 탐색 순서: ① 패키징 배포판의 `resources/server-dist/` ② dev의 `client/server-dist/`
  ③ sibling `../server/dist`. 셋 다 없으면 그냥 순수 클라이언트로 뜬다 — 이 경우 서버를 5.1처럼
  따로 띄우고 로그인 화면/설정에서 서버 주소를 지정하면 된다. **dev에서는 이 방식(서버 따로 +
  클라 따로)이 가장 덜 헷갈린다.**

### 5.3 네이티브 모듈 ABI — 반드시 읽을 것 (ERR_DLOPEN_FAILED의 정체)

서버의 `better-sqlite3`는 네이티브 애드온이다. 문제는 **같은 바이너리를 두 런타임이 못 쓴다**는 것:

- `server/`에서 `npm test`/`npm start` → **시스템 Node ABI** 필요 (npm install 기본값)
- Electron이 `ELECTRON_RUN_AS_NODE`로 서버를 스폰(단일 데스크톱 모드) → **Electron 내장 Node ABI** 필요

ABI가 안 맞으면 서버 프로세스가 `ERR_DLOPEN_FAILED`로 즉시 죽고, 클라이언트에서는 "서버 연결
끊김"으로만 보인다(진짜 원인이 가려짐). 해결책 2가지:

- **dev에서 단일 데스크톱 모드를 직접 검증할 때**: `cd client && npm run rebuild-server-native` →
  `../server`의 바이너리를 Electron ABI로 재빌드. 이후 `server/`의 `npm test`는 반대로 깨지므로,
  되돌리려면 `cd server && npm rebuild better-sqlite3`.
- **패키징할 때(권장 경로)**: `npm run build-server-dist`가 `client/server-dist/`에 프로덕션 전용
  사본(빌드 결과 + `npm ci --omit=dev` + Electron ABI 재빌드)을 새로 만든다. `server/` 원본은 전혀
  건드리지 않아 두 워크플로우가 서로 간섭하지 않는다. `npm run dist`가 이걸 자동 호출한다.

### 5.4 로컬 LLM (선택 — 없어도 서버는 뜬다)

LLM 관련 기능(chat, 의도 분류의 LLM 경로, 리포트 요약, RAG 임베딩)을 쓰려면 GPU 머신에
llama.cpp가 있어야 한다:

- 채팅용: `localengine.ts`가 `GIJO_LLAMA_SERVER_PATH`(기본 `llama.cpp/build/bin/Release/llama-server.exe`)를
  스폰. 모델은 `GIJO_MODELS_DIR/<modelId>/<modelId>.gguf` 규약. 포트 8080. `POST /api/localengine/start`로
  기동하며, 다른 modelId를 요청하면 기존 프로세스를 graceful shutdown(10초 후 SIGKILL) 후 스왑한다 —
  RTX 3090 24GB에 대형 모델을 하나만 올릴 수 있어서다.
- 임베딩용(RAG): **별도** llama-server를 `--embedding` 플래그로 8081에 직접 띄워야 한다
  (`GIJO_EMBEDDING_URL`). 이건 API로 기동해주지 않는다.
- LLM이 꺼져 있으면 `chat()`은 에러 대신 "[로컬 LLM 서버에 연결할 수 없습니다...]" 문자열을
  반환하고, 의도 분류는 정규식 폴백으로 동작한다. 즉 **LLM 없이도 서버·클라이언트·테스트 전부
  돌아간다.** 현재 개발 테스트용 모델은 Qwythos-9B (가이드 9.5절 참고).

### 5.5 환경변수 정리

| 변수 | 기본값 | 소유 모듈 |
|---|---|---|
| `GIJO_SERVER_PORT` | 4000 | index.ts |
| `GIJO_DB_PATH` | `data/gijo-as.sqlite` | db.ts |
| `GIJO_JWT_SECRET` | dev 시크릿 (production에선 필수) | auth.ts |
| `GIJO_ACCESS_TOKEN_TTL` | `15m` | auth.ts |
| `GIJO_REFRESH_TOKEN_TTL_MS` | 7일 | auth.ts |
| `GIJO_ENCRYPTION_KEY` | 미지정 시 `data/encryption.key` 자동 생성 | cryptopack.ts |
| `GIJO_CORS_ORIGINS` | 미지정 = 전체 허용 (온프레미스에서 콤마 구분으로 제한) | app.ts |
| `GIJO_LLAMA_SERVER_PATH` / `GIJO_MODELS_DIR` | llama.cpp 경로 / `models/` | localengine.ts |
| `GIJO_LOCAL_LLM_PORT` / `GIJO_LOCAL_LLM_CTX_SIZE` | 8080 / 32768 | localengine.ts |
| `GIJO_EMBEDDING_URL` | `http://localhost:8081/v1` | llm.ts |
| `GIJO_SERVER_URL` | (클라이언트) 설정 시 원격 서버 사용, 번들 서버 기동 안 함 | client/main.ts |

---

## 6. 무엇이 진짜고 무엇이 스텁인가 — 정직한 현황표

**이 절이 이 문서에서 가장 중요하다.** UI와 API가 그럴듯하게 존재해도 뒤가 비어 있는 곳이 있다.
헛다리 짚지 말 것.

### 실제 동작 확인된 것 (테스트/실행으로 검증됨)

- 인증 전체 (로그인, 토큰 회전, 401 시 클라이언트 자동 재발급)
- 자산 인벤토리 + 스캔 이력 + `asset:updated` 실시간 갱신 (재시작 후 영속성도 수동 검증됨)
- 디스패처 파이프라인, LLM 의도 분류 + 정규식 폴백, 작업 큐/우선순위
- llama-server 프로세스 생명주기 + 모델 스왑 + 서버 종료 시 자식 정리
- RAG (LanceDB ingest/query — 임베딩 서버가 떠 있을 때)
- CycloneDX SBOM 생성, DOCX 리포트 생성(LLM 요약 포함), SMTP 설정 저장/발송
- CTI **키 관리**(AES-256-GCM 암호화 저장/해제), HF 모델 **검색**(실제 공개 API 호출)
- git 동기화, 사용량 로깅, 서버 로그 캡처/스트리밍, 협업 이벤트 브로드캐스트
- 페이지 간 네비게이션(사이드바/⚙ 아이콘) — 최근 수정 완료, 정상 동작
- **ModelScan 실제 스캔** (2026-07-15 완료) — `server/modelscan_wrapper.py`가 pip 패키지 `modelscan`을
  파이썬 API로 직접 호출해(CLI 아님 — rich 콘솔 렌더러가 stdout에 줄바꿈을 끼워넣어 JSON이 깨진다)
  `StandardFinding[]`으로 변환한다. 실제 안전하지 않은 pickle 페이로드로 critical finding 탐지,
  디스패처의 severity 기반 우선순위 재산정(P0 승격)까지 실API로 검증됨. **주의**: modelscan은
  pickle/PyTorch/Keras/H5/SavedModel/NumPy만 스캔한다 — 이 프로젝트의 실제 자산 포맷인 `.gguf`는
  지원 목록에 없어서, gguf 자산을 스캔하면 "안전함"이 아니라 `scan_not_supported`(low) finding이
  뜬다(빈 배열을 반환하면 "스캔해서 깨끗함"과 구분이 안 돼 오해를 부르므로 의도적으로 이렇게 함).
  `server/test/modelscan-wrapper.test.ts`가 실제 Python으로 검증(로컬에 Python 없으면 자동 skip),
  CI는 `actions/setup-python` + `server/requirements.txt`로 이 테스트를 계속 돈다.

### 스텁 / 알려진 공백

| 항목 | 현재 상태 | 막힌 이유 |
|---|---|---|
| CTI 탐지 내역 | `cti.ts`의 `listFindings()`가 **항상 `[]` 반환**. 키 저장·암호화·복호화(`getDecryptedApiKey`)까지는 완성 | 벤더(Criminal IP, Flashpoint, SpyCloud, Recorded Future) 계약 후 벤더별 HTTP 클라이언트 구현 예정 |
| 파인튜닝 | `finetune.ts`가 `scripts/finetune_unsloth.py`를 스폰하는데 **역시 저장소에 없다.** 트리거 API와 `finetune:progress` WS 파싱/브로드캐스트 배관은 실제 코드 | Unsloth 학습 스크립트 미작성 |
| HF 모델 다운로드 | `loadHfModel()`이 `huggingface-cli`를 셸로 호출하는데 dev 환경에 **미설치** (검색은 정상) | CLI 설치 필요 |
| SPDX 내보내기 | `exportSbom(format:"spdx")`는 **명시적으로 throw** ("아직 미구현") — CycloneDX만 지원 | 별도 라이브러리 연동 필요 |
| 모델 머지 (merge.html) | 서버 측 로직 **전무**. 클라이언트에 "미구현" 명시된 플레이스홀더 페이지 | Evolutionary Model Merge는 로드맵 단계 |
| 컴플라이언스 (compliance.html) | 서버 측 로직 전무, 플레이스홀더 | — |
| 승인 워크플로우 (approvals.html) | 서버 측 로직 전무, 플레이스홀더 | — |
| threat.html "최근 탐지 내역" 표 | ~~하드코딩 목업~~ → **`/api/cti/findings`에 실연결됨** (2026-07-15). 다만 서버의 `listFindings()`가 벤더 계약 전까지 항상 `[]`를 반환하므로 화면에는 빈 표 + 안내 문구가 뜬다 | 벤더별 HTTP 클라이언트는 계약 후 구현 |
| `engine/mcp.ts` | MCP 서버 스캐폴드가 있으나 `app.ts`/`index.ts` 어디에도 연결 안 됨 | 실험 단계 |
| Penligent 어댑터 | `bridge.ts`에 TODO 주석만 존재 | 로드맵 Phase 5 |

---

## 7. 클라이언트 페이지 (13개, `client/src/renderer/pages/`)

바닐라 HTML/CSS/JS — React 등 프레임워크 없음. 페이지 전환은 `window.gijo.navigateTo(page)` →
메인 프로세스 `loadFile()`. 전체 네비게이션이라 preload가 재실행되므로, 인증 토큰/서버 주소는
메인 프로세스(`main.ts`의 `authState`)에 보관하고 동기 IPC로 읽는다.

| 페이지 | 상태 | 비고 |
|---|---|---|
| `login.html` | 실동작 | 최초 화면. 성공 시 대시보드로 |
| `dashboard.html` | 실동작 | 허브 — 채팅형 지시 입력바(`/api/dispatch`) + 자산 탐색 + 작업 목록 |
| `inventory.html` | 실동작 | `asset:updated`로 실시간 갱신 |
| `sbom.html` | 실동작 | CycloneDX만 (SPDX 버튼은 서버에서 에러) |
| `threat.html` | 실동작 | 피드 키 설정 + 탐지 내역 표 모두 실 API 연결. 표는 `listFindings()`가 벤더 연동 전이라 빈 상태 (6절) |
| `agent.html` | 실동작 | 8개 에이전트 상태 |
| `merge.html` | 플레이스홀더 | "미구현" 명시 |
| `report.html` | 실동작 | DOCX 생성 + 이메일 발송 |
| `billing.html` | 실동작 | `/api/usage/summary` |
| `settings.html` | 실동작 (최신 페이지) | 서버 주소, 계정, 로컬 LLM 엔진 제어, SMTP, 실시간 서버 로그 뷰어 |
| `compliance.html` | 플레이스홀더 | 서버 로직 없음 |
| `approvals.html` | 플레이스홀더 | 서버 로직 없음 |
| `memory.html` | **부분** | RAG ingest/query UI 진짜 / 파인튜닝 트리거 UI는 진짜지만 스크립트가 스텁 (6절) |

렌더러가 쓸 수 있는 전체 API 표면은 `client/src/preload.ts`의 `gijoApi` 객체 하나만 보면 된다
(타입: `GijoApi`). 새 서버 기능을 렌더러에 노출하려면 `apiClient.ts` → `preload.ts` 순으로 추가.

---

## 8. 보안 설계 요점

- **인증**: 서명 JWT access token(기본 15분, 무상태 검증) + opaque refresh token(기본 7일,
  서버 인메모리 Map 보관, **사용할 때마다 회전** — 재사용 즉시 무효). 로그아웃은 refresh만 폐기 —
  이미 발급된 access token은 자연 만료까지 유효하다(설계 의도, auth.ts 상단 주석 참고).
- **비밀번호**: `bcryptjs` (순수 JS 구현). 네이티브 `bcrypt`가 아닌 건 **의도적** — better-sqlite3
  하나로도 충분히 겪는 네이티브 모듈 ABI 문제(5.3절)를 더 늘리지 않기 위해서다.
- **민감 데이터 암호화**: CTI 벤더 API 키, SMTP 비밀번호는 `cryptopack.ts`(AES-256-GCM,
  12바이트 IV + authTag)로 암호화된 뒤에만 SQLite에 저장된다. 원본 키는 어떤 API 응답에도 싣지
  않는다(`CtiFeedPublic.hasApiKey` boolean만 노출). 암호화 키는 `GIJO_ENCRYPTION_KEY`(64자리 hex)
  또는 최초 1회 자동 생성되는 `data/encryption.key`.
- **프로덕션 가드**: `NODE_ENV=production` + `GIJO_JWT_SECRET` 미설정 → 부팅 거부. "설정을
  깜빡했다"가 "취약한 채 조용히 운영 중"보다 안전한 실패 모드라는 원칙.
- **CORS**: 기본 전체 허용(개발/단일 데스크톱), 온프레미스에서는 `GIJO_CORS_ORIGINS`로 제한.

---

## 9. 테스트 컨벤션

```bash
cd server && npm test    # Vitest, test/**/*.test.ts — 19개 파일 83개 테스트
```

- **HTTP 레벨 테스트**: `supertest`로 `createApp()`이 반환한 Express 앱을 포트 바인딩 없이 직접
  두드린다. `app.ts`/`index.ts` 분리가 이걸 위한 구조다.
- **격리**: `vitest.config.ts`가 `GIJO_DB_PATH=:memory:`와 고정 더미 `GIJO_ENCRYPTION_KEY`를 주입 —
  테스트는 디스크의 DB 파일도, 실제 암호화 키 파일도 절대 건드리지 않는다.
- **싱글턴 주의**: `db`, auth의 `refreshTokens`, cti의 피드 테이블은 모듈 싱글턴이라
  `createApp()`을 다시 불러도 초기화되지 않는다. 그래서 `resetAuthForTests()`,
  `resetFeedsForTests()` 같은 테스트 전용 리셋 함수가 존재한다 — 새 모듈에 상태를 추가하면 같은
  패턴을 따를 것.
- `db.test.ts`는 예외적으로 실제 파일 기반 영속성(재연결 후 데이터 유지)을 검증한다.

클라이언트는 자동화 테스트가 없다 (수동 검증).

---

## 10. 패키징 · 배포 모드

(전체 맥락: `로컬LLM_프로젝트_가이드.md` 9.3절)

### 단일 데스크톱 모드 (1인/소규모)

`cd client && npm run dist` → ① `build-server-dist.mjs`가 `client/server-dist/`에 Electron ABI
프로덕션 서버 사본 생성 ② electron-builder가 NSIS 패키지 빌드. 서버 사본은 electron-builder의
**`extraResources`로 `resources/server-dist/`에 그대로 복사**된다 — asar 아카이브 안에 넣지 않는
이유는 네이티브 `.node` 파일이 asar 내부에서 로드되지 않기 때문이다. 실행 시 `main.ts`가
`ELECTRON_RUN_AS_NODE`로 이 서버를 스폰하고(사용자 PC에 Node 설치 불필요), `cwd`를 서버 위치로
고정해 `data/`가 `resources/server-dist/data/`에 예측 가능하게 생기도록 한다.
`dist/win-unpacked/GIJO AS.exe` 직접 실행 → 로그인까지 검증 완료. 알려진 흠: NSIS 최종 설치
파일 생성이 winCodeSign 심볼릭 링크 권한 문제로 실패할 수 있음(개발자 모드 활성화 또는
`CSC_IDENTITY_AUTO_DISCOVERY=false`로 우회 가능할 것으로 보이나 미검증).

### 분산 온프레미스 모드 (기업)

RTX 3090 GPU 사내 서버에 서버를 상시 구동하고, 각 담당자 PC의 얇은 클라이언트가
`GIJO_SERVER_URL`(또는 로그인 화면의 서버 주소 입력)로 접속. 이 경우 번들 서버 기동 로직은
통째로 건너뛴다. GPU 연산과 자산 데이터 전부 서버 내부에 보존.

---

## 11. 신규 개발자가 자주 밟는 지뢰 요약

1. **`ERR_DLOPEN_FAILED` → 5.3절.** Electron이 스폰한 서버가 조용히 죽고 "서버 연결 끊김"만 보인다.
2. **threat 페이지의 탐지 내역 표가 항상 비어 있다** → 버그 아님. 표 자체는 `/api/cti/findings`에 실연결돼 있지만, 서버 `listFindings()`가 CTI 벤더 계약 전까지 `[]`를 반환한다(6절).
3. **`.gguf` 자산을 스캔했는데 finding이 `scan_not_supported`뿐이다** → 버그 아님, modelscan이 gguf를 지원하지 않아서다(6절). pickle/PyTorch/Keras 등은 실제로 스캔된다.
4. **에이전트 상태가 재시작마다 리셋된다** → 버그 아님, 의도된 설계 (4절).
5. **RAG가 임베딩 에러를 낸다** → 8081에 `--embedding` llama-server를 따로 띄웠는지 확인 (5.4절).
6. **`server-java-reference/`를 참고 구현이라고 수정하지 말 것** — 폐기된 폴백이다.
7. **rebuild-server-native를 돌린 뒤 `npm test`가 깨진다** → `cd server && npm rebuild better-sqlite3`로 복구.
8. 페이지 전환마다 preload가 재실행된다 — 렌더러 전역 상태에 의존하지 말고, 유지해야 하는 값은 메인 프로세스 `authState` 패턴을 따를 것.
