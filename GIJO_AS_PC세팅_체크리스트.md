# GIJO AS 개발 서버 세팅 체크리스트 — PC 받으면 이 순서대로

**확정 하드웨어**: AMD Ryzen 7 5800X · NVIDIA RTX 3090 24GB(FE) · DDR4 64GB · 저장공간 1.38TB · Windows 11 Pro 24H2 (당근마켓 구매 확정분)

이 문서는 위 PC가 도착한 직후부터 GIJO AS 서버(server)·클라이언트(client)가 실제로 뜰 때까지, 복사해서 그대로 실행 가능한 명령어와 각 단계별 확인 방법만 정리한 실행용 체크리스트입니다. 각 기술 선택의 배경(왜 CUDA인지, 왜 이 양자화인지 등)은 `로컬LLM_프로젝트_가이드.md`를 참고하세요 — 이 문서는 "왜"가 아니라 "지금 뭘 치면 되는지"에 집중합니다.

**설치 기준 경로**: 이 체크리스트는 전부 `C:\GIJO-AS\`를 기준 폴더로 가정합니다. 다른 경로를 쓰려면 아래 명령어의 경로만 동일하게 바꿔주면 됩니다.

**중요**: 아래 명령어는 별도 표기가 없으면 **일반 PowerShell**에서, `[VS Dev PowerShell]` 표시가 있는 구간은 반드시 **Visual Studio 2022 Developer PowerShell**(시작 메뉴에서 검색)에서 실행하세요. MSVC 컴파일러 환경변수가 로드된 셸이어야 llama.cpp 빌드가 됩니다.

---

## STEP 0 — 소스 받기 (git clone)

> 예전 방식(`gijo-as-cs-scaffold.zip` 압축 해제)은 폐기 — zip은 낡은 Java 스캐폴드 시절
> 산출물입니다. 지금은 git 저장소가 유일한 소스입니다. (private 저장소이므로 GitHub 계정에
> SSH 키 등록 또는 HTTPS 토큰이 먼저 필요합니다. git은 STEP 4에서 설치하므로, 순서상
> STEP 4를 먼저 실행한 뒤 여기로 돌아와도 됩니다.)

```powershell
git clone git@github.com:gijotour/AS-Private.git C:\GIJO-AS
```

**확인**: `C:\GIJO-AS\server`와 `C:\GIJO-AS\client` 폴더가 나란히 존재해야 합니다. (서버 코드가 `server` 폴더를 기준으로 상대경로를 쓰므로, 이 둘의 위치 관계가 중요합니다.)

```powershell
dir C:\GIJO-AS
```

---

## STEP 1 — 하드웨어/OS 확인

```powershell
Get-CimInstance Win32_Processor | Select-Object Name
(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum / 1GB
Get-ComputerInfo | Select-Object WindowsProductName, OsVersion, OsBuildNumber
```

**확인**: CPU 이름에 `5800X`, RAM 합계가 약 64(GiB 환산 시 약 59~63 사이로 표시될 수 있음 — 정상), `Windows 11 Pro`, 빌드 `24H2`(26100 계열) 확인.

---

## STEP 2 — NVIDIA 드라이버 설치

1. https://www.nvidia.com/drivers 접속 → RTX 3090 검색 → 최신 Game Ready/Studio 드라이버 다운로드·설치
2. 재부팅

**확인**:
```powershell
nvidia-smi
```
GPU 이름에 `RTX 3090`, Driver Version, 우측 상단에 CUDA Version 필드가 표시되면 정상.

---

## STEP 3 — CUDA Toolkit 13.3.x 설치

1. https://developer.nvidia.com/cuda-downloads → Windows / x86_64 / 11 / exe(local) 선택 후 다운로드
2. 설치 시 "사용자 지정" 선택 → 드라이버 구성요소는 체크 해제(2단계에서 이미 최신 드라이버 설치함)

**확인**:
```powershell
nvcc --version
```
`release 13.3` 표시 확인. 안 뜨면 새 PowerShell 창을 열어(환경변수 갱신) 다시 확인.

---

## STEP 4 — 빌드 도구 및 런타임 설치 (관리자 권한 PowerShell)

```powershell
winget install --id Git.Git -e --source winget
winget install --id Kitware.CMake -e --source winget
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id OpenJS.NodeJS.LTS -e --source winget
winget install --id Python.Python.3.12 -e --source winget
```

> Java(JDK)는 더 이상 설치하지 않습니다 — 서버가 Node/TypeScript입니다(Java 재작성안은
> 폐기·삭제됨, 2026-07-15). Python 3.12는 모델 스캐너(modelscan)가 서버 런타임에 필요합니다.

**확인**:
```powershell
git --version
cmake --version
node --version
npm --version
python --version
```
Node는 v20.x 이상(서버·클라이언트 공통), Python은 3.12.x여야 합니다. 추가로 시작 메뉴에서 "Visual Studio 2022 Developer PowerShell"이 검색되는지 확인(다음 단계에서 이 셸을 씁니다).

**모델 스캐너 의존성 설치** (새 PowerShell 창에서 — python PATH 갱신 필요):
```powershell
cd C:\GIJO-AS\server
pip install -r requirements.txt
python -c "import modelscan; print('modelscan OK')"
```

---

## STEP 5 — llama.cpp 클론 + CUDA 빌드 `[VS Dev PowerShell]`

GIJO AS 서버(`server/src/engine/localengine.ts`)가 기본값으로 `server\llama.cpp\build\bin\Release\llama-server.exe`를 상대경로로 찾기 때문에(`GIJO_LLAMA_SERVER_PATH` 환경변수로 변경 가능), **반드시 `server` 폴더 안에** 클론해야 합니다.

```powershell
cd C:\GIJO-AS\server
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp
cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="86"
cmake --build build --config Release -j
```

**확인**:
```powershell
# 지원 가능한 디바이스 목록 출력
.\build\bin\Release\llama-cli.exe --list-devices
```
출력 로그에 `CUDA0: NVIDIA GeForce RTX 3090`이 정상적으로 표시되면 성공.

---

## STEP 6 — 모델 다운로드 및 배치

GIJO AS 서버가 찾는 경로는 `server\models\<modelId>\<modelId>.gguf` 고정 패턴입니다. 최종 모델은 **`segolilylabs/Lily-Cybersecurity-7B-v0.2`**로 확정됐고(다음단계 가이드 3.3, 2026-07-15), `modelId`는 **`lily-cybersecurity-7b-v0.2`**로 고정해서 씁니다(에이전트 AI 화면에서 모델을 켤 때도 이 이름을 그대로 사용).

```powershell
cd C:\GIJO-AS\server
pip install -U huggingface_hub --break-system-packages
New-Item -ItemType Directory -Path .\models\lily-cybersecurity-7b-v0.2 -Force
huggingface-cli download segolilylabs/Lily-Cybersecurity-7B-v0.2-GGUF Lily-7B-Instruct-v0.2.Q5_K_M.gguf --local-dir .\models\lily-cybersecurity-7b-v0.2
```

> **`huggingface-cli`는 이 단계의 수동 다운로드용이면서 동시에 GIJO AS 서버의 런타임 의존성입니다.**
> 서버의 HF 모델 다운로드 기능(`loadHfModel()`)이 `huggingface-cli`를 셸로 직접 호출하므로,
> **GIJO AS 서버를 실행하는 계정의 PATH**에서 아래 명령이 동작해야 합니다(없으면 앱 내
> 모델 검색은 되는데 다운로드만 실패합니다):
> ```powershell
> huggingface-cli --version
> ```
> 새 PowerShell 창에서도 인식되는지 확인하세요. pip가 Scripts 경로를 PATH에 안 넣어줬다면
> `python -m pip show huggingface_hub`로 위치를 찾아 해당 `Scripts` 폴더를 PATH에 추가합니다.

다운로드된 파일명을 GIJO AS가 찾는 이름으로 **정확히** 바꿔줍니다:

```powershell
Rename-Item .\models\lily-cybersecurity-7b-v0.2\Lily-7B-Instruct-v0.2.Q5_K_M.gguf lily-cybersecurity-7b-v0.2.gguf
```

**확인**:
```powershell
dir .\models\lily-cybersecurity-7b-v0.2\
```
`lily-cybersecurity-7b-v0.2.gguf` 파일이 존재하고 용량이 약 5GB인지 확인. (7B Q5_K_M — 24GB VRAM 대비 여유가 크므로 `--ctx-size` 상향 여지가 큽니다. 영어 중심 모델이라 **한국어 응답 품질은 STEP 10에서 반드시 확인**하세요.)

---

## STEP 7 — llama-server 단독 실행 검증 (선택, 문제 생기면 디버깅용) `[VS Dev PowerShell]`

```powershell
cd C:\GIJO-AS\server\llama.cpp
.\build\bin\Release\llama-server.exe -m ..\models\lily-cybersecurity-7b-v0.2\lily-cybersecurity-7b-v0.2.gguf -ngl -1 --ctx-size 32768 --host 0.0.0.0 --port 8080
```

새 터미널에서:
```powershell
curl http://localhost:8080/v1/models
```
JSON 응답이 오면 정상. 확인 끝나면 원래 터미널에서 `Ctrl+C`로 종료(이후로는 GIJO AS 서버가 이 프로세스를 대신 기동/관리합니다 — STEP 10에서 재검증).

---

## STEP 8 — GIJO AS 서버 빌드 및 최초 설정 (Node/TypeScript)

> 예전 문서의 Spring Boot/Gradle 절차는 폐기·삭제된 Java 재작성안 기준이었습니다.
> 실제 서버는 Node/TypeScript입니다.

```powershell
cd C:\GIJO-AS\server
npm install
npm run start     # tsc 빌드 후 node dist/index.js 실행
```

**최초 기동 시 자동으로 되는 것** (수동 설정 파일 없음):
- SQLite DB(`data\gijo-as.sqlite`)와 암호화 키(`data\encryption.key`) 자동 생성 — **`data\` 폴더가 백업 대상입니다** (DB + 키가 여기 있음)
- 기본 관리자 계정 `jyh` / `changeme` 자동 시드 → **로그인 직후 설정 화면에서 비밀번호부터 변경**

**운영 배포 시 환경변수** (개발 PC에서는 생략 가능):
- `GIJO_JWT_SECRET` — `NODE_ENV=production`이면 **필수** (미설정 시 기동 거부)
- `GIJO_ENCRYPTION_KEY` — 64자리 hex(32바이트). 미설정 시 `data\encryption.key` 파일 자동 생성으로 대체
- 그 외 조정용: `GIJO_SERVER_PORT`(기본 4000), `GIJO_DB_PATH`, `GIJO_MODELS_DIR`, `GIJO_LLAMA_SERVER_PATH`, `GIJO_LOCAL_LLM_CTX_SIZE`

**확인**: 콘솔에 서버 기동 로그와 포트 4000이 출력되는지 확인합니다.
새 터미널에서:
```powershell
curl http://localhost:4000/api/health
```
`{"ok":true,"service":"gijo-as-server"}` 응답 확인.

**로컬 LLM 자동 시작**: 서버 기동 시 `models\` 아래에 모델 파일이 있으면 채팅 LLM(마지막
사용 모델, 없으면 기본 `lily-cybersecurity-7b-v0.2`)이 **자동으로 올라갑니다** — 에이전트 AI
화면에서 수동 시작할 필요 없음. 임베딩 서버(8081, RAG용)도 `models\bge-m3\bge-m3.gguf`가
있으면 자동 기동됩니다(다른 모델을 쓰려면 `GIJO_EMBEDDING_MODEL_ID` 설정). 모델 파일이
없으면 건너뛰고 로그에 안내가 남습니다 — 그 경우 RAG 기능만 임베딩 에러가 나며, 임시로는
수동 기동도 가능합니다:
```powershell
cd C:\GIJO-AS\server\llama.cpp
.\build\bin\Release\llama-server.exe -m ..\models\<임베딩모델>\<임베딩모델>.gguf --embedding --host 0.0.0.0 --port 8081
```

---

## STEP 9 — GIJO AS 클라이언트 설치 및 실행

새 터미널:
```powershell
cd C:\GIJO-AS\client
npm install
npm run build
npm start
```

**확인**: Electron 창이 뜨고 로그인 화면이 표시됩니다. 서버 주소 입력란은 기본값(`http://localhost:4000`)을 그대로 두고, 최초 계정 `jyh` / `changeme`로 로그인 → 대시보드로 넘어가면 성공. **로그인 직후 설정 화면에서 비밀번호를 변경**하고, 필요하면 같은 화면의 계정 관리 패널에서 담당자 계정을 추가하세요.

---

## STEP 10 — 통합 스모크 테스트

- [ ] 로그인 성공, 대시보드 진입
- [ ] 대시보드에 에이전트 목록 표시 (`GET /api/agents` 정상 응답 확인용)
- [ ] 서버 기동 로그에 `[localengine] 부팅 자동 시작: lily-cybersecurity-7b-v0.2`가 찍히고, 새 터미널에서 `nvidia-smi` 실행 시 VRAM 사용량이 올라가는지 확인 (STEP 6 모델 배치가 됐다면 수동 시작 불필요 — 안 올라오면 에이전트 AI 화면에서 수동 시작으로 폴백)
- [ ] 채팅바에 **한국어** 지시문을 넣어 응답 품질 확인 (Lily는 영어 중심 모델 — 한국어 응답이 부적절하면 다음단계 가이드 3.3의 결정을 재검토할 근거가 된다)
- [ ] 채팅바에 아무 지시문 입력 → 화면에 협업 로그(할당/완료)가 실시간으로 찍히는지 확인 (WebSocket 정상 동작 검증)
- [ ] `nvidia-smi` 기준 VRAM 사용량이 24GB 이내인지 확인 (여유 있으면 `--ctx-size` 상향 여지 있음 — STEP 7 방식으로 재검증)

---

## 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| `nvcc`/`python`/`node` 명령을 찾을 수 없음 | 설치 후 환경변수 미갱신 | 새 PowerShell 창 열기, 안되면 재부팅 |
| llama.cpp 빌드 중 CUDA/MSVC 관련 오류 | VS Build Tools에 C++ 워크로드 누락, 또는 일반 PowerShell에서 빌드 시도 | STEP 4 명령 재실행 + 반드시 `[VS Dev PowerShell]`에서 빌드 |
| 서버 기동 시 `ERR_DLOPEN_FAILED` (better-sqlite3) | 네이티브 모듈이 다른 ABI(Electron용)로 빌드된 상태 | `cd server && npm rebuild better-sqlite3` (온보딩 가이드 5.3절 — Electron 클라이언트용 rebuild-server-native를 돌린 뒤 서버를 Node로 직접 띄우면 발생) |
| `npm install`(client) 중 electron 다운로드 실패 | 사내망/방화벽이 GitHub Releases 차단 | 방화벽 예외 등록 또는 `ELECTRON_MIRROR` 환경변수로 국내 미러 지정 |
| 로그인 401 unauthorized | 잘못된 ID/PW 입력 또는 만료된 JWT 토큰 | 계정 정보 재확인 및 다시 로그인 (최초 계정은 `jyh`/`changeme`) |
| RAG/문서 검색에서 임베딩 에러 | 8081 임베딩 llama-server 미기동 | STEP 8 하단의 `--embedding` 서버를 별도로 띄웠는지 확인 |
| 모델 스캔이 `scan_error`로 끝남 | Python 또는 modelscan 미설치 | STEP 4의 `pip install -r requirements.txt` 재확인 |
| 로컬 엔진 시작 요청이 실패/무응답 | 모델 파일 경로·이름 불일치 또는 llama-server 실행 파일 미존재 | STEP 6 경로(`server\models\lily-cybersecurity-7b-v0.2\lily-cybersecurity-7b-v0.2.gguf`)와 STEP 5 빌드 산출물(`llama-server.exe`) 존재 확인 |
| 앱에서 HF 모델 검색은 되는데 다운로드만 실패 | 서버 실행 계정 PATH에 `huggingface-cli` 없음 | STEP 6의 `huggingface-cli --version` 확인 절차 수행 (pip Scripts 경로를 PATH에 추가) |
| VRAM 부족 경고 | 컨텍스트 크기 과다 설정 | STEP 7/10에서 `--ctx-size`를 32768보다 낮춰 재시도 |

---

## 참고

- 기술 배경·설계 근거: `로컬LLM_프로젝트_가이드.md` (특히 1~3단계, 9단계 CS 구조)
- 서버/클라이언트 구조 상세·실제 코드 기준 안내: `GIJO_AS_개발자_온보딩_가이드.md` (아키텍처, 라우트 맵, 함정 목록 포함 — 이 체크리스트보다 상세)
