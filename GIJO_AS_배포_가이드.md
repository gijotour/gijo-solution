# GIJO AS 배포 가이드 (온프레미스·폐쇄망) — v1.0.0

> **대상:** GIJO AS를 사내 폐쇄망에 설치·운영하는 담당자(인프라/보안).
> **원칙:** 데이터·AI가 조직 경계 밖으로 나가지 않습니다. 외부 연결은 **선택적 CTI 벤더 API**와 **최초 모델 다운로드(망 분리 전)** 뿐입니다.

---

## 1. 배포 모드 두 가지

| 모드 | 구성 | 언제 |
|---|---|---|
| **분산 모드 (권장·표준)** | **서버 1대**(RTX 3090 GPU 머신)가 상주 + **데스크톱 N대**가 접속 | 실제 운영. 여러 보안담당자가 한 서버를 공유 |
| **단독 모드 (standalone)** | 데스크톱 1대에 서버까지 번들(설치본에 포함) | 소규모·데모·오프라인 시연 |

- 분산 모드: 데스크톱 앱에 **`GIJO_SERVER_URL`** 을 지정하면 번들 서버를 띄우지 않고 원격 서버에 붙습니다.
- 단독 모드: `GIJO_SERVER_URL` 미지정 시, 설치본에 포함된 **server-dist**를 앱이 자동 기동합니다(Electron 내장 Node ABI로 재빌드된 상태).

---

## 2. 사전 준비 — GPU 서버 (망 분리 *전*에)

폐쇄망은 인터넷이 없으므로 **망 분리 이전에** 아래를 GPU 머신에 준비합니다.

### 2.1 하드웨어·OS
- GPU: **RTX 3090 (24GB)** 급 이상 권장. Windows 11 / Windows Server.
- 디스크: 모델·데이터 여유 있게(수십~수백 GB).

### 2.2 런타임·툴체인
- **Node.js LTS** (서버 실행).
- **Python 3.12** + 학습 스택(자가학습 사용 시): `unsloth`, `torch(CUDA)`, `peft`, `gguf`, `transformers`.
- **llama.cpp** 빌드(로컬 LLM 서빙·GGUF 변환·양자화):
  `convert_hf_to_gguf.py` + `build/bin/Release/llama-server.exe` + `llama-quantize.exe`.
- 문서 추출용: `pypdf` 등.

### 2.3 모델 사전 다운로드 (⚠️ 망 분리 전 필수)
폐쇄망 이전 후에는 받을 수 없으니 **미리** 내려받아 `server/models/`(또는 `GIJO_MODELS_DIR`)에 배치:

| 용도 | 예시 모델 | 비고 |
|---|---|---|
| 보안 채팅 | Lily-Cybersecurity-7B 등 GGUF | 에이전트 기본 |
| RAG 임베딩 | **BGE-M3** GGUF (`bge-m3/bge-m3.gguf`) | 장기 기억 필수 |
| 경량/코딩 | Qwen2.5 계열 GGUF | 용도별 |
| **자가학습 베이스** | **`NousResearch/Hermes-3-Llama-3.1-8B` (fp16, ~16GB)** | 헤르메스 학습 루프용. `hf download`로 HF 캐시에 선다운로드 |

> **추천 LLM 가이드** 화면에서 용도별 모델을 다운로드할 수 있습니다(온라인 상태일 때).

#### ⚖️ 모델 라이선스 · BYOM (상업 배포 시 필수 확인)
번들 모델을 그대로 재배포·판매하려면 각 모델의 원본 라이선스를 지켜야 합니다. **`GET /api/localengine/model-licenses`**(관리자)로 현재 모델들의 분류를 확인하세요:
- **permissive** (예: Qwen2.5-7B/Coder·Qwen3·BGE-M3, Apache-2.0 추정) — 상업 번들 가능(추정, 원본 확인 권장)
- **restricted** (Llama·Hermes = Llama 커뮤니티 라이선스, Qwen2.5-3B = 비상업) — 조건 준수/제외 필요
- **byom** (합성·개조·출처불명: gijo 오케스트레이터·merged·abliterated 등) — **번들 금지, 고객이 직접(BYOM)**
- **상용 배포 권장**: 기본 탑재는 permissive만, 나머지는 고객이 사내에서 직접 받아 `GIJO_MODELS_DIR`에 배치.
> ⚠️ 이 분류는 법무 검토의 출발점이며 법적 확정이 아닙니다. 판매 전 각 모델 원본 라이선스를 법무가 확인하세요.

---

## 3. 서버 설치·기동 (GPU 머신)

### 3.1 배치
1. `server/` 디렉터리를 GPU 머신에 복사.
2. 의존성 설치: `npm ci --omit=dev` (server/).
3. `server/models/`에 사전 다운로드한 GGUF 모델 배치.
4. `server/llama.cpp/`에 빌드된 바이너리 배치.

### 3.2 주요 환경변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `GIJO_SERVER_PORT` | `4000` | 서버 포트 |
| `GIJO_DB_PATH` | `data/gijo-as.sqlite` | SQLite 파일 경로 |
| `GIJO_MODELS_DIR` | `models` | 모델 디렉터리 |
| `GIJO_LLAMA_CPP_DIR` | `llama.cpp` | llama.cpp 경로 |
| `GIJO_EMBEDDING_MODEL_ID` | `bge-m3` | RAG 임베딩 모델 |
| `PYTHONUTF8` | — | **`1` 고정 권장** (Windows cp949로 한글 로그 깨짐·스크립트 사망 방지) |
| **보안 (self-install 필수)** | | |
| `NODE_ENV` | — | 운영 설치는 **`production`** 권장(안전 기본값·시크릿 강제) |
| `GIJO_JWT_SECRET` | (개발 기본값) | **운영 필수** — 미설정 시 `production`에서 서버가 뜨지 않음(토큰 위조 방지). 긴 랜덤 문자열 |
| `GIJO_INITIAL_ADMIN_PASSWORD` | — | 최초 관리자 비번. 미지정+`production`이면 **랜덤 생성 후 콘솔 1회 출력** |
| `GIJO_INITIAL_ADMIN_USERNAME` | `admin`/`jyh` | 최초 관리자 아이디 |
| `GIJO_TLS_CERT_PATH` / `GIJO_TLS_KEY_PATH` | — | **둘 다 지정 시 HTTPS**로 서빙(사내망 스니핑 방지 권장) |
| `GIJO_MIN_PASSWORD_LEN` | `8` | 비밀번호 최소 길이 |
| `GIJO_LOGIN_MAX_FAILS` | `10` | 로그인 실패 임계(초과 시 15분 잠금) |

### 3.3 기동
```
# server/ 에서
set PYTHONUTF8=1
node dist/index.js
```
- 기동 로그: `GIJO AS 서버 기동 — http://localhost:4000 (WebSocket: /ws)`
- 로컬 엔진(llama-server)이 모델을 로드합니다(모델이 배치돼 있어야 함).

### 3.4 상시 상주
- 서버는 항상 켜져 있어야 합니다. **Windows 서비스**(nssm 등) 또는 작업 스케줄러로 부팅 시 자동 기동 등록을 권장합니다.
- **방화벽:** 사내망에서 데스크톱들이 붙도록 `4000/tcp`(및 WebSocket) 허용. 외부(인터넷) 노출은 금지.

### 3.5 최초 관리자 계정 (⚠️ self-install 보안 핵심)
운영 설치는 **알려진 기본 비밀번호를 절대 쓰지 않도록** 아래 중 하나로 초기 계정을 만드세요.
- **권장**: `GIJO_INITIAL_ADMIN_PASSWORD`(+선택 `GIJO_INITIAL_ADMIN_USERNAME`)를 지정하고 기동 → 그 값으로 관리자 생성.
- 또는 `NODE_ENV=production`만 설정하고 초기 비번 미지정 → **강력 랜덤 비번을 생성해 콘솔에 1회만 출력**합니다(설치자가 기록·로그인·즉시 변경).
- (개발/데모 한정) 위 둘 다 없으면 `jyh` / `changeme`가 시드됩니다 — **운영에서는 금지**.
- 최초 로그인 후 담당자별 계정을 발급하세요(설정 → 계정 관리). 로그인은 실패 `GIJO_LOGIN_MAX_FAILS`회 초과 시 15분 잠깁니다(무차별 대입 방어).

### 3.6 설치 후 자가 진단 (프리플라이트)
관리자로 로그인 후 **`GET /api/admin/preflight`** 를 호출하면 이 머신의 준비 상태를 항목별로 점검합니다:
Node·GPU(nvidia-smi)·llama-server·모델(상업번들 안전/BYOM 개수)·JWT 시크릿·**기본 비밀번호 사용 여부**·데이터 저장소. `ready:false`면 `fail` 항목을 조치하세요.
- `/api/health`는 스키마 버전을 함께 반환합니다(업그레이드 후 반영 확인용).

---

## 4. 클라이언트(데스크톱) 배포

### 4.1 설치본
- 빌드 산출물: **`client/release/GIJO AS Setup 1.0.0.exe`** (NSIS 설치본).
- 빌드 방법(개발 PC): `client/`에서 `npm run dist`
  → 내부적으로 `build`(TS+preload) → `build-server-dist`(server 사본 + better-sqlite3를 Electron ABI로 재빌드) → `electron-builder`(nsis) 순으로 실행됩니다.

### 4.2 배포·설치
1. 설치본을 각 보안담당자 PC에 배포 → 실행해 설치.
2. 최초 실행 시 **서버 주소**를 입력(분산 모드): `http://<서버IP>:4000`.
   - 또는 실행 환경변수 **`GIJO_SERVER_URL=http://<서버IP>:4000`** 로 지정하면 번들 서버를 띄우지 않고 원격 서버에 붙습니다.
3. 관리자에게 받은 **아이디/비밀번호**로 로그인.

> **단독 모드로 쓰려면:** `GIJO_SERVER_URL`을 지정하지 않고 실행하면 설치본에 포함된 서버가 자동 기동됩니다(모델은 별도 배치 필요).

---

## 5. 폐쇄망 반입 체크리스트

- [ ] Node.js / Python 3.12 / (학습 시) unsloth·torch(CUDA)·peft·gguf·transformers
- [ ] llama.cpp 빌드 산출물(server·quantize·convert 스크립트)
- [ ] GGUF 모델: 보안 채팅 · **BGE-M3(임베딩)** · 경량
- [ ] (자가학습 시) **Hermes-3-8B fp16 ~16GB** HF 캐시
- [ ] `server/` 코드 + `npm ci --omit=dev` 완료된 node_modules
- [ ] `client/release/GIJO AS Setup 1.0.0.exe`
- [ ] 서버 상시 상주 등록(서비스) · 방화벽 `4000/tcp`
- [ ] **보안**: `GIJO_JWT_SECRET` 설정 · 초기 관리자 비번(env 또는 랜덤) · (권장) TLS 인증서
- [ ] **설치 후**: `GET /api/admin/preflight` 로 `ready:true` 확인 · 기본 비밀번호 변경
- [ ] **모델**: 라이선스 확인(`/api/localengine/model-licenses`) — 번들 가능/BYOM 구분

---

## 6. 업그레이드·재배포

1. 서버: 새 `server/dist` 반영 후 **서버 프로세스 재시작**(무중단이 아니므로 점검 시간에).
2. 클라이언트: 새 버전 설치본 재배포(버전 번호로 구분).
3. DB(`data/gijo-as.sqlite`)는 유지됩니다 — 스키마 변경은 기동 시 자동 마이그레이션(ALTER 안전 처리 + `schema_migrations` 기록). 업그레이드 후 `GET /api/health`의 `schema` 버전으로 반영을 확인하세요.
4. **업그레이드 전 백업**: 서버 정지 후 `data/gijo-as.sqlite` 파일을 복사(권장). 문제 시 파일을 되돌리면 복구됩니다.

> **주의:** 서버 코드만 갱신하고 재시작하지 않으면 **구버전 프로세스가 계속 떠 있어** 새 기능/라우트가 반영되지 않습니다(구버전은 새 API를 404로 응답). 갱신 후 반드시 재시작하세요.

---

## 7. 문제 해결

- **데스크톱이 서버에 못 붙음:** 서버 주소/포트 확인 → 방화벽 `4000/tcp` → 서버 상주 여부.
- **한글 로그 깨짐 / python 스크립트 사망:** `PYTHONUTF8=1` 설정 확인.
- **채팅/RAG가 일시 불가:** 학습 루프·파인튜닝 중에는 GPU 확보를 위해 추론 엔진이 잠시 정지됩니다(완료 후 자동 재기동).
- **임베딩(RAG) 미동작:** `GIJO_MODELS_DIR`에 `bge-m3/bge-m3.gguf` 배치 여부 확인.
- **자가학습 실행 안 됨:** 학습 루프 화면의 **사전 점검(preflight)** 에서 python·학습 스택·베이스 모델 캐시 상태 확인.
- **단독 모드에서 SQLite 오류:** 번들 서버의 better-sqlite3가 Electron ABI로 재빌드됐는지(설치본 빌드 시 `build-server-dist`가 수행) 확인.
- **설치했는데 뭐가 안 되는지 모를 때:** `GET /api/admin/preflight`로 항목별 진단(GPU·모델·JWT·기본계정·저장소). `fail` 먼저 해결.
- **운영인데 서버가 안 뜸:** `NODE_ENV=production`인데 `GIJO_JWT_SECRET` 미설정이면 의도적으로 기동을 막습니다(취약 상태 방지). 시크릿을 설정하세요.
- **초기 관리자 비번을 못 봤음:** 랜덤 생성 비번은 콘솔에 1회만 출력됩니다. 놓쳤으면 서버 로그(`data/restart-out.log` 등)를 확인하거나, DB의 users를 비우고(백업 후) 재기동해 재생성.

---

*본 가이드는 GIJO AS v1.0.0 기준(2026-07-18 self-install 보안 보강: 안전 초기계정·JWT·TLS·프리플라이트·모델 라이선스/BYOM)입니다. 사용법은 `GIJO_AS_보안담당자_실무매뉴얼.md`를 참고하세요.*
