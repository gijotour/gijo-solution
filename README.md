# GIJO AS

한국형 **온프레미스 AI 보안관리 플랫폼**. 보안담당자가 취약점 스캐너 로그·보안로그·보안제품 리포트를
한자리에서 분석·관제합니다. 모든 처리는 사내에서 끝납니다 — 자료가 밖으로 나가지 않습니다.

**Electron 클라이언트 + Node/TypeScript 서버 + 로컬 LLM(llama.cpp)** 구조입니다.
서버 한 대(GPU)가 모델·DB를 쥐고, 담당자들은 각자 PC의 얇은 클라이언트로 붙습니다.

> ⚠ 이 문서는 **처음 온 사람이 이것만 읽고 돌릴 수 있게** 쓴 것입니다.
> 작업 규칙·설계 의도·실사고 기록은 [`CLAUDE.md`](CLAUDE.md)에 있습니다.

---

## 기술 스택

| 구분 | 버전 | 비고 |
| --- | --- | --- |
| Node.js | **20** (CI 기준) | 개발 실측 24.18 · `engines` 미지정 — CI가 사실상의 하한 |
| 언어 | TypeScript 5.5 | 서버·클라 공통 · `tsc --noEmit`이 CI 관문 |
| 서버 | Express ^4.19 | `server/` · 포트 4000 |
| DB | better-sqlite3 ^12.11 | `server/data/gijo-as.sqlite` · 마이그레이션 37개 |
| 벡터 저장소 | @lancedb/lancedb ^0.31 | `server/data/memory.lancedb` · 임베딩 bge-m3 |
| LLM | llama.cpp (외부 빌드) | GGUF 모델을 `server/models/<id>/<id>.gguf` |
| 클라이언트 | Electron ^31 | `client/` · 화면은 순수 HTML/CSS/JS |
| 패키징 | electron-builder ^24.13 | NSIS(Windows) · dmg(mac arm64) |
| 테스트 | vitest ^4.1 | 서버 **275파일 / 2880여 개** · 실 LLM 안 띄움 |
| Python | 3.12 | 문서 파싱·학습 보조(`server/requirements.txt`) |

### 포트

| 대상 | 포트 | 설정 |
| --- | --- | --- |
| 서버(REST + WebSocket) | **4000** | `GIJO_SERVER_PORT` — `server/src/index.ts` |
| 임베딩 llama-server | **8081** | `GIJO_EMBEDDING_PORT` — 상시 상주(채팅 모델과 별도) |
| 채팅 llama-server | 동적 | VRAM 예산에 따라 뜨고 내려감(`localengine.ts` LRU) |
| Electron 원격 디버깅 | 9223 / 9224 | 설치본 / 개발 실행 — e2e 검증용 |

---

## 시작하기

```bash
# 1) 서버
cd server
npm install
npm run build          # tsc + 정적 자산 복사
npm start              # http://localhost:4000

# 2) 클라이언트 (다른 터미널)
cd client
npm install
npm start              # 빌드 후 Electron 실행
```

첫 로그인 계정은 **어떻게 띄웠는지에 따라 다릅니다**(2026-08-09 보안 결정 — F7-12):

| 상황 | 계정 |
|---|---|
| **개발·테스트**(NODE_ENV이 production이 아니고 env 비번도 없을 때) | `jyh` / `changeme` |
| **운영**(NODE_ENV=production) | `admin` + **강력 랜덤 비밀번호를 콘솔에 1회만 출력** — 그때 받아 적고 바로 바꿉니다 |
| `GIJO_INITIAL_ADMIN_PASSWORD`를 준 경우 | `admin` + 그 비밀번호 |

> ⚠ **운영에서는 `changeme`가 절대 안 쓰입니다.** 예전에 그 값이 고객 기계까지 나간 적이 있어 막아 뒀습니다
> (`server/src/auth/users.ts`의 `computeInitialAdmin`).
> 패키징된 설치본은 또 다릅니다 — **고객이 첫 화면에서 직접 관리자 비밀번호를 정합니다**(콘솔을 볼 수 없어서입니다).

> **⚠ 모델이 없으면 채팅이 안 됩니다.**
> `server/models/`는 git에 없습니다(수 GB). GGUF를 직접 받아
> `server/models/<모델id>/<모델id>.gguf` 로 두고, llama.cpp를 빌드해
> `llama-server` 실행 파일 경로를 잡아야 합니다(`GIJO_LLAMA_SERVER_PATH` 또는
> `GIJO_LLAMA_CPP_DIR`). 화면·DB·리포트는 모델 없이도 동작합니다.

> **⚠ 임베딩 서버는 `ctx/batch/ubatch`를 8192로 명시해야 합니다.**
> 안 그러면 512자 넘는 한글 입력에서 HTTP 500이 납니다(실사고).

---

## 스크립트

### 서버 (`server/`)

| 명령 | 설명 |
| --- | --- |
| `npm run build` | `tsc` + 정적 자산 복사 |
| `npm start` | 빌드 후 `dist/index.js` 실행 |
| `npm run watch` | `tsc --watch` (⚠ 서버 자동 재시작 아님) |
| `npm test` | **vitest 2880여 개** — 실 LLM을 띄우지 않습니다 |
| `npm run install-browser` | 리포트 PDF용 chromium 설치 |

### 클라이언트 (`client/`)

| 명령 | 설명 |
| --- | --- |
| `npm run build` | 인라인 스크립트 검사 → `tsc` → preload 번들(esbuild) |
| `npm start` | 빌드 후 Electron 실행 |
| `npm run dist` | 설치 파일 생성(electron-builder) |
| `npm run build-server-dist` | 서버를 클라에 동봉할 형태로 빌드 |
| `npm run publish-release` | **게시** — 서버가 곧 배포처(자동 업데이트) |
| `npm run rebuild-server-native` | better-sqlite3 등 네이티브 모듈 재빌드 |

> **⚠ `npm run dist` 뒤에는 `client/server-dist/package.json`이 바뀝니다.**
> 추적되는 산출물이라 빌드 후 `git checkout`으로 되돌려 clean을 유지하세요.

---

## 디렉토리 구조

```
.
├── server/                  Express + TypeScript
│   ├── src/
│   │   ├── index.ts         진입점(포트 4000)
│   │   ├── app.ts           라우트 조립
│   │   ├── db.ts            SQLite + 마이그레이션(migrate)
│   │   ├── auth/            로그인·세션·2차 인증(TOTP)
│   │   ├── engine/          ★ 기능 본체 154파일 — 아래 참조
│   │   └── util/            공통 유틸
│   ├── test/                vitest 275파일 (GIJO_AS_시험지도.md 참조)
│   ├── tools/               운영·측정 스크립트
│   ├── data/                DB·벡터저장소 (git 제외)
│   └── models/              GGUF 모델 (git 제외)
│
├── client/                  Electron
│   └── src/
│       ├── main.ts          창 관리 · 탭 셸
│       ├── preload.ts       window.gijo.* 노출 (⚠ 인자는 위치 인자)
│       ├── apiClient.ts     REST 호출
│       ├── wsClient.ts      실시간 이벤트
│       └── renderer/pages/  화면 39개 + nav.js(공용 사이드바)
│
├── tools/                   측정·QA·회귀 하네스
├── mockups/                 UI 시안(화면별 폴더) — 구현 전 승인용
├── rag-seed/                지식 시드 문서
└── CLAUDE.md                작업 규칙 · 함정 · 구조 요약
```

### `server/src/engine/` — 기능이 사는 곳

파일 하나가 대체로 기능 하나입니다. 자주 손대는 것들:

| 파일 | 하는 일 |
| --- | --- |
| `localengine.ts` | llama-server 프로세스 풀(VRAM 예산 · LRU 스왑) |
| `agentloop.ts` | 도구 선택 · **`FORCED_INTENTS`(결정적 라우팅)** |
| `dispatcher.ts` | 대화창 요청의 입구 |
| `agenttools/` | 도구 등록부와 핸들러 |
| `screenguide.ts` | 화면 설명·ⓘ 안내의 **단일 출처** |
| `routes.ts` | 어떤 말이 어디로 가는지 규칙표(route-explain이 읽음) |
| `airgap.ts` | 폐쇄망 봉인(`GIJO_AIRGAP=1` → 기본 차단) |

### 화면(`client/src/renderer/pages/`)

`login.html`로 시작해 **`app.html`이 탭 셸**이 되고, 각 화면은 `?embed=1` iframe으로 그 안에 들어갑니다
(`#tabBar` · `#screens`). 그래서 화면 코드는 대체로 "탭 안에서 도는 것"을 전제합니다.

> **★ 제품 원칙 — 지시는 대화창에서 합니다.**
> 새 화면에 자유 입력칸을 두지 않습니다. 화면은 **보고 고르는 자리**이고,
> 고른 것은 `window.gijo.askConsole(질문)`으로 대화창에 넘깁니다.
> 화면이 직접 `/api/dispatch`를 부르면 쓰기 지시에 결재판(승인 창)을 못 그립니다.
>
> 화면에는 **정체성 한 줄과 ⚠경고만** 둡니다. 사용법·용어 풀이는 `screenguide.ts`에
> 쓰고 ⓘ로 엽니다.

---

## 환경변수

전부 선택입니다 — 없으면 기본값으로 돕니다. 자주 쓰는 것만 추립니다.

| 변수 | 기본 | 용도 |
| --- | --- | --- |
| `GIJO_SERVER_PORT` | 4000 | 서버 포트 |
| `GIJO_DB_PATH` | `data/gijo-as.sqlite` | **`:memory:`면 디스크에 안 남김**(테스트·실검증용) |
| `GIJO_MODELS_DIR` | `models/` | GGUF 위치 |
| `GIJO_LLAMA_SERVER_PATH` | 자동 탐색 | llama-server 실행 파일 |
| `GIJO_MAX_LOADED_MODELS` | VRAM 티어 | 동시 상주 모델 수 |
| `GIJO_DOCS_DIR` | — | 지식 문서 폴더(운영은 여기 한 곳만 읽음) |
| `GIJO_SERVER_ROOT` | cwd | 파이썬 스크립트(문서 추출·장비 접속·모델 스캔)를 찾을 뿌리. **패키징 앱이 넣어 준다** — 설치본은 서버 cwd(userData)와 스크립트 자리가 다르다 |
| `GIJO_INGEST_ROOT` | `data/` | 업로드 원본(`docs/uploads`)·추출본(`docs/extracted`)을 담는 뿌리 |
| `GIJO_PYTHON` | 자동 탐색 | 서버 도구용 파이썬(단독 모드에서 PDF·한글을 읽으려면 지정) |
| `GIJO_AIRGAP` | 없음 | `1`이면 **폐쇄망 봉인**(기본 차단, 런타임 해제 불가) |
| `GIJO_JWT_SECRET` | 자동 생성 | 토큰 서명 키 |
| `GIJO_ADMIN_USER` / `GIJO_ADMIN_PASSWORD` | — | 점검 도구가 쓸 계정(**코드에 비밀번호 금지**) |

---

## 테스트

```bash
cd server
npm test                       # 전체 (약 30초)
npx vitest run test/lawinfo.test.ts   # 하나만
npx tsc --noEmit               # 타입 검사 — CI의 첫 관문
```

- 러너 **vitest 4** · 대상 `server/test/**/*.test.ts` (275파일)
- **실 LLM을 스폰하지 않습니다** — 모델 없이도 전부 돕니다
- 테스트는 `GIJO_DB_PATH=:memory:`로 돌아 디스크에 아무것도 안 남깁니다
- 시험 목록과 분류는 [`GIJO_AS_시험지도.md`](GIJO_AS_시험지도.md) (`node tools/test-map.mjs`로 재생성)

### 이 저장소에만 있는 시험 종류

일반적인 단위 시험 외에 **약속을 지키는지 감시하는 시험**들이 있습니다. 새 기능이 여기 걸리면
대개 시험이 아니라 기능 쪽을 고치는 게 맞습니다.

| 시험 | 무엇을 막나 |
| --- | --- |
| `guidance-routing` | 제품이 "이렇게 물어보세요"라고 적어 준 말이 **모델 판단으로 새는 것** |
| `no-hardcoded-credentials` | 비밀번호가 코드에 적히는 것 |
| `silentbuttons` | 눌러도 아무 말 없는 버튼 |
| `falseclaim` | **하지 않은 일을 했다고 말하는 답** |
| `shotlist` | 메뉴에 있는 화면이 자료에서 빠지는 것 |
| `routes` | 라우팅 규칙표와 실제 코드가 어긋나는 것 |

> **⚠ 헛통과 주의.** 위 감시 시험들은 대상을 하나도 못 읽으면 「0건 발견」으로 **항상 통과**합니다.
> 그래서 각 시험은 "대상을 실제로 읽었는가"를 함께 확인합니다. 이 확인을 지우지 마세요.

---

## 배포

| 대상 | 방법 |
| --- | --- |
| 운영 서버 | Windows PC의 **WSL2 systemd**(`gijo-as.service`, `/home/gijo/gijo-as/server`) |
| 갱신 | 소스 rsync → `tsc` → 프로세스 kill(`Restart=always`) — ⚠ **접속 세션 전부 끊김** |
| 클라이언트 | `npm run publish-release` — 서버 자체가 배포처(자동 업데이트) |

> 화면·메뉴는 앱 안에 들어 있습니다. **서버만 배포하면 새 화면이 안 보입니다** — 게시가 필요합니다.

---

## 함정 (실사고 기반)

여기 적힌 것은 전부 실제로 한 번씩 당한 것들입니다.

1. **한글 검증에 `curl`을 쓰지 마세요** — 깨집니다. Node `fetch`로 하세요.
   한글 파일 조작도 `perl` 대신 Node. Python은 `PYTHONUTF8=1`.
2. **7B 모델에 프롬프트 규칙을 더해 행동을 고치려 하지 마세요** — 반복 실패했습니다. 코드로 푸세요.
3. **에이전트에 모델을 배정 안 하면 조용히 기본 모델로 떨어집니다** — `app_state`를 직접 확인하세요.
4. **WSL에 배포판 nvidia 드라이버를 설치하지 마세요** — 호스트 것과 충돌합니다.
5. **실패한 스캔이 기존 취약점을 지울 수 있습니다** — 비어 보인다고 "없다"로 결론 내지 마세요.
6. **테스트가 env를 덮어써서 제품이 아니라 테스트를 검증하는** 함정을 조심하세요.
   폴백 문구가 나오면 통과가 아니라 **실패**로 칩니다.
7. **`client/server-dist/package.json`은 추적 산출물** — 빌드 후 되돌리세요.
8. **git 이력에 남은 비밀번호는 파일에서 지워도 안 죽습니다** — 값을 바꿔야 합니다.

---

## 더 읽을 것

| 문서 | 언제 |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | 작업 규칙 · 구조 요약 · 함정 — **먼저 읽으세요** |
| `GIJO_AS_용어사전.md` | 이 제품의 말이 낯설 때(계속 갱신되는 문서) |
| `GIJO_AS_시장경쟁력_전중후_계획서.md` | 지금 무엇을 왜 만들고 있는지 |
| `GIJO_AS_RAG_아키텍처_LLM연동.md` | 지식 검색·임베딩 구조 |
| `GIJO_AS_3머신_개발환경_가이드.md` | Windows ↔ Mac 두 대로 개발할 때 |
| `GIJO_AS_MAC_올인원_배포_가이드.md` | Mac(Metal)에서 서버+LLM 돌릴 때 |
| `GIJO_AS_시험지도.md` | 어떤 시험이 무엇을 지키는지 |
