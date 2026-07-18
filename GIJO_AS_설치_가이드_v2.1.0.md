# GIJO AS 설치 가이드 — v2.1.0 (GIJO 7B)

> 다른 PC에 GIJO AS를 설치하는 실전 절차. 자세한 폐쇄망·보안 하드닝은 [`GIJO_AS_배포_가이드.md`](GIJO_AS_배포_가이드.md) 참고.
> **버전:** v2.1.0 · **기본 모델:** gijo-main-orchestrator (7.6B) · **설치본:** `GIJO AS Setup 2.1.0.exe` (NSIS)

---

## 0. 두 가지 설치 방식 — 먼저 선택하세요

| | **방식 A — 담당자 PC에 클라이언트만 (권장)** | **방식 B — 다른 머신에 통째로 (단독)** |
|---|---|---|
| 쓰임 | 여러 담당자 데스크톱이 **한 대의 GPU 서버**에 접속 | GIJO AS를 **다른 PC 한 대에서 전부** 구동 |
| 필요 | 설치본 + 네트워크(서버 IP) | 설치본 + **모델 + llama.cpp 바이너리 + NVIDIA GPU** |
| 모델 | 필요 없음(서버에 있음) | 대상 PC에 배치 필요(약 6.5GB) |
| 용량 | 155MB | 약 6.7GB |

**대부분은 방식 A로 충분합니다.** GPU가 없는 담당자 PC엔 방식 A, 완전히 독립된 두 번째 시스템을 만들 땐 방식 B입니다.

---

## 1. 방식 A — 클라이언트 설치 후 서버 연결 (간단)

대상 PC(담당자 데스크톱)에서:

1. `GIJO AS Setup 2.1.0.exe` 를 복사해 실행 → 설치.
2. 앱 실행 → 로그인 화면의 **서버 주소**에 GPU 서버 주소 입력: `http://<서버IP>:4000`
   - 또는 실행 전 환경변수 `GIJO_SERVER_URL=http://<서버IP>:4000` 지정.
3. 관리자에게 받은 **아이디/비밀번호**로 로그인.

> 서버 쪽(이 머신)에서 방화벽에 `4000/tcp` 인바운드를 사내망 한정으로 허용해야 담당자 PC가 붙습니다. 인터넷 노출은 금지.

끝. 모델·GPU는 서버 한 대에만 있으면 됩니다.

---

## 2. 방식 B — 다른 머신에 단독 설치 (모델 포함)

대상 PC 요건: **Windows 10/11 · NVIDIA GPU(VRAM 12GB↑ 권장) · CUDA 런타임 · 디스크 20GB↑**

### 2.1 배포 패키지 복사
아래 파일들을 대상 PC로 옮깁니다(USB/사내 공유). 배포 패키지 폴더 `GIJO-AS-Deploy-v2.1.0/`에 모두 담겨 있습니다:
```
GIJO-AS-Deploy-v2.1.0/
├─ GIJO AS Setup 2.1.0.exe        (설치본 155MB)
├─ models/
│  ├─ gijo-main-orchestrator/gijo-main-orchestrator.gguf   (채팅 7B, 5.07GB)
│  └─ bge-m3/bge-m3.gguf                                    (RAG 임베딩, 1.1GB)
├─ llama-server/                  (llama-server.exe + ggml/cuda dll 등 런타임, 자체완결)
├─ model.sha256                   (모델 무결성)
└─ 설치_가이드_v2.1.0.md          (이 문서)
```

### 2.2 설치본 실행
1. `GIJO AS Setup 2.1.0.exe` 실행 → 설치. 설치 경로 확인(기본: `%LOCALAPPDATA%\Programs\gijo-as`).

### 2.3 모델·바이너리 배치 (단독 모드 핵심)
설치본은 **서버 코드만** 담고 있어, 로컬 LLM을 돌리려면 모델과 llama.cpp 바이너리를 배치해야 합니다. 설치된 앱이 번들 서버를 띄우는 작업 폴더 기준으로:
- `models/gijo-main-orchestrator/gijo-main-orchestrator.gguf`
- `models/bge-m3/bge-m3.gguf`
- `llama.cpp/build/bin/Release/llama-server.exe` (와 같은 폴더의 dll들)

경로가 복잡하면 **환경변수로 절대경로 지정**이 가장 확실합니다(앱 실행 전에 설정). 배포 패키지를
예컨대 `D:\GIJO`에 통째로 풀었다면:
```
set GIJO_MODELS_DIR=D:\GIJO\models
set GIJO_LLAMA_SERVER_PATH=D:\GIJO\llama-server\llama-server.exe
set PYTHONUTF8=1
```

### 2.4 최초 관리자 계정 (보안 필수)
운영이면 **기본 비밀번호를 쓰지 마세요**. 앱 실행 전에:
```
set NODE_ENV=production
set GIJO_JWT_SECRET=<64자 이상 랜덤 문자열>
set GIJO_INITIAL_ADMIN_PASSWORD=<초기 관리자 비번>
```
- `GIJO_JWT_SECRET` 미설정이면 production에서 서버가 뜨지 않습니다(토큰 위조 방지).
- 초기 비번 미지정 + production이면 **랜덤 비번을 콘솔에 1회 출력**합니다 — 기록 후 로그인, 즉시 변경.
- (데모 한정) 위를 안 하면 `jyh` / `changeme`로 시드됩니다 — 운영 금지.

### 2.5 첫 실행·검증
1. 앱 실행 → 자동으로 번들 서버 기동 → 로컬 LLM(모델) 로드.
2. 로그인 → 대시보드가 뜨고 우상단 상태가 **운영중(초록)** 이면 정상.
3. 관리자로 `GET /api/admin/preflight` 호출 시 Node·GPU·llama-server·모델·JWT·기본비번·저장소를 항목별 자가진단(`ready:true` 확인).

---

## 3. (선택) 데이터·지식베이스 이관

새 설치는 빈 상태로 시작합니다. 기존 자산·취약점·지식베이스를 옮기려면 백업을 복원합니다:
1. 대상 서버 **정지**.
2. `gijo-as-<날짜>.sqlite` → 대상의 `data/gijo-as.sqlite`로 복사.
3. `gijo-as-<날짜>.lancedb/` 폴더 → 대상의 `data/memory.lancedb/`로 교체.
4. 서버 재기동.
> 제품 문서 기본 코퍼스(7건)는 첫 기동 시 자동 인입되므로, 사내 자료를 추가로 넣은 게 아니면 복원 없이도 "이 화면 뭐예요"에 답합니다.

---

## 4. (선택) 클라우드 LLM 하이브리드

로컬 7B로 부족한 일반 질문은 클라우드(Gemini/Claude/OpenAI)로 보조받을 수 있습니다. **기본 OFF**이며, 켜도 내부 정보(자산·IP·담당자)가 섞인 질문은 유출 방지 게이트가 자동 차단합니다.
- 설정 → **☁ 클라우드 LLM (선택)** (admin 전용)에서 제공자·API 키 입력 후 활성화.
- Gemini는 무료 등급으로 시작 가능(aistudio.google.com에서 키 발급).
- 사용량·요금은 **사용량·요금** 화면에서 제공자별 호출·토큰·예상비용으로 확인.

---

## 5. 문제 해결

| 증상 | 조치 |
|---|---|
| 로그인 화면에서 "연결 실패" | 서버 주소·포트(4000)·방화벽 확인. 방식 A는 서버가 켜져 있는지. |
| "AI 모델이 아직 준비되지 않았습니다" | 모델 파일 배치·경로(`GIJO_MODELS_DIR`)·llama-server 경로 확인. GPU/CUDA 런타임 확인. |
| RAG 검색·문서보강이 안 됨 | 임베딩 서버(bge-m3) 기동 확인. v2.1.0은 임베딩 hang을 30초마다 감지해 자동 재기동함. |
| 한글 로그가 깨짐/스크립트 사망 | `PYTHONUTF8=1` 설정(Windows). |
| 클라우드 "크레딧 부족"/"모델 없음" | 제공자 콘솔에서 크레딧 충전, 또는 설정에서 사용 가능한 모델로 교체(설정에 모델 조회 있음). |

---

## 다음 단계 (개발 로드맵)
현재는 GIJO 7B 기준. 다음은 **WSL2 환경으로 서버 이관 + 상위 모델**로 개발 지속 예정 — 계획서: [`GIJO_AS_WSL2_서버이전_계획서.md`](GIJO_AS_WSL2_서버이전_계획서.md)
