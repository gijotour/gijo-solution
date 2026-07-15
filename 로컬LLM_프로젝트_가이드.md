# 로컬 LLM 프로젝트 가이드 — Qwythos-9B-Claude-Mythos-5-1M (Qwythos-9B) / CUDA / llama.cpp

**확정 서버 사양**: AMD Ryzen 7 5800X · NVIDIA RTX 3090 24GB · RAM 64GB · 저장공간 1.38TB · Windows 11 Pro 24H2

이 문서는 위 서버에서 로컬 LLM(Qwythos-9B)을 CUDA 백엔드로 구동하고, 이후 보안 제품(오케스트레이터 + 스캐너 어댑터)에 통합하기까지의 전체 과정을 단계별로 정리한 것입니다.

> **PC 실제 구매 확정(당근마켓, 5800X + RTX 3090 24GB + DDR4 64GB + 1.38TB, Windows 11 Pro 24H2)에 따라, 이 하드웨어 기준으로 바로 따라할 수 있는 실행용 체크리스트/명령어 모음은 `GIJO_AS_PC세팅_체크리스트.md`에 별도로 정리했습니다.** 이 문서(로컬LLM_프로젝트_가이드.md)는 설계 배경·기술 선택 근거 중심이고, PC 도착 후 실제로 손 움직이며 따라할 때는 그 체크리스트 문서를 여세요.

---

## 작업 분담 (Claude Code / 안티그래비티 / 로컬 LLM)

토큰 사용량 최적화를 위해 아래 3개 도구로 작업을 분담합니다.

| 단계 | 내용 | 담당 |
|---|---|---|
| 1단계 | 환경 세팅 (드라이버/CUDA/빌드도구/llama.cpp 빌드) | 안티그래비티 |
| 2단계 | 모델 다운로드 및 양자화 선택 | 안티그래비티 |
| 3단계 | 실행 및 서빙 | 로컬 LLM 구동 자체는 **Connect AI 앱**(모델 전환 방식), 연동 설계 검토는 Claude Code |
| 4단계 | 이후 개발 로드맵 (제품 통합) | Claude Code |
| 5단계 | 검증 체크리스트 | 실행/검증은 안티그래비티, 설계 적합성 확인은 Claude Code |
| 6단계 | 확정 4대 핵심 기능 실현 계획 | Claude Code |
| 7단계 | 애플리케이션 아키텍처 (CS 구조 설계) | Claude Code |
| 8단계 | 에이전트 지시 실행 파이프라인 | Claude Code |
| 9단계 | CS 구조 전환 (서버 언어: TypeScript/Node.js 최종 확정, 2026-07-13 번복) | Claude Code |

**로컬 LLM 실행 방식**: 로컬 LLM은 PC에 설치된 **Connect AI 데스크톱 앱**(`Connect AI.exe`, 커스텀 GGUF 경로 지정 가능 확인됨)에서 직접 구동합니다.

> **⚠️ 초기 개발 테스트 모델 선정 상태**: 현재 이 문서의 1~3단계는 **Qwythos-9B(Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf)를 메인 모델로 사용** 중인 상태를 기준으로 작성되어 있습니다. Qwythos-9B는 가벼운 9B급 추론 모델로, VRAM을 약 6~7GB만 소모하여 RTX 3090 24GB 서버에서 극도로 기민하고 가볍게 구동됩니다. 프로덕션 배포 시점에는 원래 검토했던 **Qwen3-30B-A3B**(MoE, 활성 3B — 속도 빠름) 등으로 전환을 재검토할 수 있으며, 이 두 모델을 함께 쓰거나 상황에 맞춰 스왑하는 로직을 `LocalEngineService`에 구현할 수 있습니다.

---

## 0. 왜 이 조합인가 (요약)

- **GPU**: RTX 3090 24GB — 목표 모델(4bit 기준 ~6.5GB)을 VRAM에 전량 로드하고도 여유가 매우 충분히 남음, 대역폭 936GB/s
- **백엔드**: CUDA — llama.cpp 백엔드 중 NVIDIA에서 가장 완전하고 빠름 (OpenCL/Vulkan 대비 MoE·양자화 지원이 온전함)
- **모델**: Qwythos-9B — 가벼운 9B급 추론 모델 (Q4_K_M 양자화 적용으로 초기 개발/테스트 시 하드웨어 부하 대폭 절감)
- **컴퓨트 능력**: RTX 3090(Ampere, GA102)의 CUDA Compute Capability는 **8.6** — 빌드 시 이 값을 지정합니다.

---

## 1단계 — 환경 세팅

### 1.1 NVIDIA 드라이버 설치

CUDA 13.1부터 Windows용 디스플레이 드라이버가 CUDA Toolkit에 번들되지 않으므로 **드라이버와 CUDA Toolkit을 따로** 설치해야 합니다.

1. https://www.nvidia.com/drivers 에서 RTX 3090용 최신 **Production/Game Ready 드라이버**를 받아 먼저 설치
2. 설치 후 재부팅
3. 확인: `nvidia-smi` 실행 → GPU 인식 및 드라이버 버전 확인

### 1.2 CUDA Toolkit 설치

1. https://developer.nvidia.com/cuda-downloads 에서 **CUDA Toolkit 13.3.x**(2026년 7월 기준 최신, 13.3.1) 다운로드
2. Windows용 installer 실행 (드라이버는 이미 설치했으므로 "드라이버 구성요소 제외" 옵션이 있다면 체크)
3. 확인: `nvcc --version`

### 1.3 빌드 도구 설치

- **Visual Studio 2022 Build Tools** (C++를 사용한 데스크톱 개발 워크로드 포함) — MSVC 컴파일러 필요
- **CMake 3.14 이상** — https://cmake.org/download (Windows installer, "Add to PATH" 체크)
- **Git for Windows**

### 1.4 llama.cpp 클론 및 CUDA 빌드

**Visual Studio 2022 Developer PowerShell**(일반 PowerShell 아님 — MSVC 환경변수가 로드된 셸)에서 진행합니다.

```powershell
git clone https://github.com/ggml-org/llama.cpp.git
cd llama.cpp

cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="86"
cmake --build build --config Release -j
```

- `-DCMAKE_CUDA_ARCHITECTURES="86"` → RTX 3090(Ampere) 전용으로 컴파일해 빌드 시간 단축 및 최적화
- 빌드가 끝나면 `build/bin/Release/` 아래에 `llama-cli.exe`, `llama-server.exe` 등이 생성됩니다

### 1.5 빌드 검증

컴파일된 바이너리가 CUDA 백엔드를 지원하고 실제 GPU 장치를 정상적으로 인식하는지 목록을 통해 확인합니다.

```powershell
# 지원 가능한 디바이스 목록 출력
.\build\bin\Release\llama-cli.exe --list-devices
```

정상적으로 CUDA 빌드가 완료되었다면, 아래와 같이 CUDA 장치명과 메모리 정보가 출력됩니다.
```
Available devices:
  CUDA0: NVIDIA GeForce RTX 3090 (24576 MiB, ... MiB free)
```

> **참고**: 직접 빌드 대신 llama.cpp GitHub Releases 페이지의 **Windows CUDA 프리빌드 바이너리**(본인이 설치한 CUDA Toolkit 버전에 대응하는 zip 다운로드, 예: CUDA 13.3.x 대응 바이너리)를 받아 바로 쓰는 방법도 있습니다. 커스텀 수정 없이 빠르게 시작하고 싶으면 이쪽이 더 간단합니다.

---

## 2단계 — 모델 다운로드 및 양자화 선택

### 2.1 GGUF 배포처

초기 테스트에 쓰일 Qwythos-9B-Claude-Mythos-5-1M의 GGUF 변환본은 HuggingFace의 배포처에서 가져올 수 있습니다.

- `empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF` — 표준 양자화 세트 (Q4_K_M 등)

### 2.2 24GB VRAM 기준 양자화 선택

| 양자화 | 특징 | 추천 상황 |
|---|---|---|
| **Q4_K_M** | 품질/용량 균형, 원활한 추론 기능 제공 | 기본 추천 (약 5.6GB 용량, 약 6~7GB VRAM 요구) |

RTX 3090 24GB VRAM 사양에서는 9B 모델의 Q4_K_M을 로드하고도 17GB 이상의 넉넉한 VRAM이 남으므로, 로드와 응답 속도가 비약적으로 빠르며 여러 작업 수행 시 시스템 리소스 점유 부담이 매우 적습니다.

### 2.3 다운로드 및 파일명 정규화

다운로드된 GGUF 파일명을 애플리케이션 백엔드 및 실행 스크립트가 인식하는 표준 파일명(`qwythos-9b.gguf`)으로 변경합니다.

```powershell
pip install -U huggingface_hub --break-system-packages
huggingface-cli download empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF `
  --include "*Q4_K_M*" `
  --local-dir .\models\qwythos-9b

# 백엔드 엔진에서 고정 파일명으로 인식할 수 있도록 변경
Rename-Item .\models\qwythos-9b\Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf qwythos-9b.gguf
```

---

## 3단계 — 실행 및 서빙

### 3.1 CLI로 빠른 동작 테스트

```powershell
.\build\bin\Release\llama-cli.exe `
  -m .\models\qwythos-9b\qwythos-9b.gguf `
  -ngl -1 `
  -p "너는 보안 분석을 돕는 AI야. 자기소개 한 문장만 해줘." `
  -n 100
```

- `-ngl -1` : 모든 레이어를 GPU에 올림 (9B-Instruct는 가볍게 100% 오프로딩 가능)

### 3.2 llama-server로 OpenAI 호환 API 서빙

실제 제품(오케스트레이터)과 연동하려면 CLI 대신 **상시 구동되는 서버**로 띄웁니다.

```powershell
.\build\bin\Release\llama-server.exe `
  -m .\models\qwythos-9b\qwythos-9b.gguf `
  -ngl -1 `
  --ctx-size 8192 `
  --host 0.0.0.0 `
  --port 8080
```

30초 안에 `http://localhost:8080/v1/chat/completions` 등 OpenAI 호환 엔드포인트가 열립니다. 노출 엔드포인트: `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models`.

**VRAM이 부족해질 경우** (다른 프로세스와 동시 사용 등):
1. `--ctx-size`를 먼저 낮춘다 (KV 캐시가 가장 큰 가변 비용, 필요시 4096 등으로 조정)
2. 그래도 부족하면 `-ngl` 값을 999에서 조금씩 낮춰 일부 레이어를 CPU/RAM으로 오프로딩

### 3.3 API 호출 테스트

```powershell
curl http://localhost:8080/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{"model":"qwythos-9b","messages":[{"role":"user","content":"안녕"}]}'
```

Python/Java/Node에서는 OpenAI SDK 또는 HTTP 클라이언트의 `base_url`을 `http://localhost:8080/v1`로, `api_key`는 아무 문자열(빈 값이 아니면 됨)로 설정하면 코드 변경 없이 그대로 씁니다.

---

## 4단계 — 이후 개발 로드맵 (제품 통합)

지금까지 세운 오케스트레이터 아키텍처(중앙 LLM + 플러그인 어댑터 + 로컬 자산 DB)에 이 로컬 LLM 서버를 연결하는 단계입니다.

### 4.1 Java/Spring Boot 오케스트레이터와의 연결

Spring Boot 백엔드 서버에서는 `llama-server`를 `ProcessBuilder`를 이용해 자식 프로세스로 띄우고 REST API로 호출하는 방식을 권장합니다 (라이브러리를 직접 네이티브 바인딩하는 대신, 서버 프로세스 분리 시 크래시 격리·재시작 및 리소스 관리가 쉬움).

```java
ProcessBuilder pb = new ProcessBuilder(
    ".\\build\\bin\\Release\\llama-server.exe",
    "-m", ".\\models\\qwen2.5-coder-32b-instruct\\qwen2.5-coder-32b-instruct.gguf",
    "-ngl", "-1",
    "--ctx-size", "32768",
    "--port", "8080"
);
// 작업 디렉토리 설정 및 실행
pb.directory(new File("C:\\GIJO-AS\\server"));
Process process = pb.start();
// 이후 Spring 6 RestClient/WebClient 또는 RestTemplate으로 http://localhost:8080/v1/chat/completions 호출
```

### 4.2 콘텐츠 분석 기능 (스캔 결과 해석)

Python 스캐너(ModelScan 등)가 표준 finding 배열(`finding_type`, `severity`, `evidence`, `source_tool`)을 생성하면, 이를 LLM 프롬프트에 구조화해서 넣어 다음을 생성합니다.

- 요약: "이 자산에서 발견된 N개 취약점 중 즉시 조치가 필요한 것은…"
- 우선순위 판단: CVSS/KEV/EPSS 수치 + finding 메타데이터를 근거로 순위 재정렬
- 설명: 비전문가 개발자가 이해할 수 있는 쉬운 말로 재작성 ("쉬운 사용성" 컨셉과 직결)

프롬프트 템플릿을 별도 파일로 관리하고, few-shot 예시를 넣어 출력 포맷(JSON 등)을 강제하는 것을 추천합니다.

### 4.3 개인화 기능 (장단기 기억)

앞서 정한 LanceDB 기반 로컬 벡터 DB에 다음을 저장/조회합니다.

- **단기 기억**: 현재 세션의 대화·스캔 맥락
- **장기 기억**: 사용자가 반복적으로 관심 갖는 자산/취약점 유형, 과거 조치 이력

질의 시 사용자 질문을 임베딩 → LanceDB에서 유사 컨텍스트 검색 → 검색된 내용을 프롬프트에 주입(RAG 패턴)하는 흐름입니다. 상세 파이프라인은 6.2절 참고.

### 4.4 Python 스캐너 연동 (서브프로세스)

```java
ProcessBuilder pb = new ProcessBuilder("python", "modelscan_wrapper.py", assetPath);
Process process = pb.start();
String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
// Jackson ObjectMapper를 사용하여 표준 finding 배열로 파싱
List<FindingDto> findings = objectMapper.readValue(stdout, new TypeReference<List<FindingDto>>() {});
// → LLM 프롬프트에 전달
```

---

## 5단계 — 검증 체크리스트

- [ ] `nvidia-smi`에서 RTX 3090 정상 인식
- [ ] `nvcc --version`으로 CUDA 13.3.x 확인
- [ ] llama.cpp 빌드 로그에 CUDA 디바이스 인식 메시지 출력
- [ ] `llama-cli`로 짧은 프롬프트 응답 확인 (품질/속도 체감)
- [ ] `llama-server` 구동 후 `/v1/models` 응답 확인
- [ ] `nvidia-smi`로 추론 중 VRAM 사용량이 24GB 내에 있는지 확인 (여유 있으면 `--ctx-size` 상향 가능)
- [ ] Java/Spring Boot에서 자식 프로세스로 서버 기동 → REST 호출 왕복 테스트
- [ ] 샘플 finding JSON을 프롬프트에 넣어 요약/우선순위 출력 포맷 검증

---

## 6단계 — 확정 4대 핵심 기능 실현 계획

제품 메인 기능을 아래 4가지로 확정함에 따라, 각 기능을 이 서버(RTX 3090 24GB / RAM 64GB) 기준으로 실현 가능성·기술 스택·난이도·우선순위를 정리합니다.

### 6.0 요약 표

| # | 기능 | 이 서버로 실현 가능성 | 난이도 | 우선순위 |
|---|---|---|---|---|
| 1 | 클라우드 구독형 연동 화면 | 100% 가능 (GPU 자원 거의 불필요) | 낮음 | 중 |
| 1.1 | 딥웹/다크웹 CTI 피드 연동 (구독형) | 100% 가능 (API 클라이언트 + LLM 해석) | 낮음~중 | 중 |
| 1.2 | API 이용료 · 토큰 사용량 관리 대시보드 | 100% 가능 (로깅+집계+시각화) | 낮음 | 중 |
| 2 | 단기/장기 기억 — RAG | 100% 가능, 여유 충분 | 낮음 | **높음 (1순위)** |
| 2 | 단기/장기 기억 — 파인튜닝 | 가능 (QLoRA, 17.5GB로 검증된 사례 있음) | 중~높음 | 중 (2차 고도화) |
| 3 | Evolutionary Model Merge | 축소 스케일로 가능, 원본 방식 그대로는 무리 | 높음 | 낮음 (R&D, 후반) |
| 4 | 결과 확인 → SBOM 정리 | 100% 가능 (기존 자산DB 확장) | 낮음~중 | **높음 (1순위)** |
| 4.1 | 내부 SBOM 기반 내부보고용 리포트 | 100% 가능 (문서생성+LLM요약) | 낮음~중 | **높음 (1순위)** |

---

### 6.1 클라우드 구독형 보안제품 연동 화면

**실현 가능성**: 이 기능은 로컬 LLM 추론과 무관한 UI + API 클라이언트 레이어입니다. RTX 3090의 VRAM을 거의 쓰지 않으므로 서버 스펙은 문제가 되지 않습니다.

**기술 스택**
- Electron 프론트엔드(React 권장) — 앞서 설계한 "하이브리드 브로커" 구조에서 클라우드 쪽(AVID/ATLAS/CVE 구독) 연동 화면을 확장
- REST/GraphQL 클라이언트, OAuth2 또는 API 키 인증 모듈
- 외부 보안 솔루션 API 스펙별 어댑터 (SAFESQUARE Bridge의 DMZ 게이트웨이 패턴 재사용)

**난이도**: 낮음 — 표준 CRUD + 외부 API 연동 패턴이라 기술 리스크는 작습니다. 다만 연동 대상 업체 수만큼 어댑터를 늘려야 하므로 "체감 작업량"은 늘어날 수 있습니다.

**우선순위**: 중간. 사용자가 가장 먼저 보는 화면이라 UX 완성도는 중요하지만, 핵심 기술 검증(로컬 LLM, 병합)이 끝난 뒤에 붙여도 늦지 않습니다.

#### 6.1.1 딥웹/다크웹 CTI(위협 인텔리전스) 피드 메뉴

**개념 정리**: 딥웹은 검색엔진 미색인 콘텐츠 전반(대부분 합법)이고, 보안 제품이 실제로 다루는 건 주로 **다크웹(Tor 은닉 서비스)** 쪽의 유출 데이터(탈취 계정정보, 해킹포럼, 랜섬웨어 유출 사이트)입니다. **LLM이 직접 다크웹을 크롤링하는 구조가 아니라**, 이미 합법적으로 수집·정제된 CTI 피드를 구독해 API로 받아오고, LLM은 그 데이터를 해석·요약·우선순위 판단하는 역할을 맡습니다. Tor 크롤러를 자체 구축하는 것은 컴플라이언스·운영 리스크가 커서 권장하지 않습니다.

**연동 후보 (구독형 CTI 제공사)**
- **AI스페라 (Criminal IP)** — 국내 업체, 이번 경쟁사 조사에서도 다룬 곳. 위협 인텔리전스 + SBOM 연계 API 제공
- Recorded Future, Flashpoint, SpyCloud, KELA — 해외 CTI 벤더, 유출 계정정보·다크웹 포럼 모니터링 특화

**기능 정의**: 고객사 도메인/이메일/자산명을 등록 → CTI 피드에서 해당 자산 관련 유출·언급 탐지 → LLM이 "긴급도·조치 필요 여부"로 요약해 대시보드에 표시. 기존에 설계한 AVID/ATLAS/CVE 구독 브로커와 동일한 구조에 CTI 피드 하나를 추가하는 형태입니다.

**실현 가능성**: 100% 가능. GPU 자원과 무관한 API 클라이언트 + LLM 해석 레이어라 이 서버 스펙 문제 없음.

**난이도**: 낮음~중간 (벤더별 API 스펙 대응, 데이터 정규화 작업).

**우선순위**: 낮음~중간 — 6.1의 다른 클라우드 연동과 함께, 핵심 로컬 LLM 파이프라인 검증 이후 붙이는 것을 권장. CTI 벤더 계약·비용 문제도 별도로 검토 필요.

#### 6.1.2 API 이용료 · 토큰 사용량 관리 대시보드

**개념**: 로컬 LLM(현재 초기 개발 테스트용 Qwythos-9B 사용)은 자체 호스팅이라 토큰당 과금이 없지만, 오케스트레이터가 연동하는 외부 유료 서비스들(AVID/ATLAS/CVE 구독, 6.1.1의 CTI 피드, 향후 추가될 수 있는 클라우드 LLM 폴백 등)은 구독료 또는 종량제 비용이 발생합니다. 이 화면은 "지금 얼마나 쓰고 있고 이번 달 예상 비용이 얼마인지"를 한눈에 보여줍니다.

**추적 대상**
- 클라우드 구독형 서비스: AVID/ATLAS/CVE 브로커, CTI 피드(Criminal IP 등) — 호출 수, 구독 한도 대비 사용률, 정액/종량 여부
- (향후 확장 시) 클라우드 LLM API를 보조로 쓸 경우 — 토큰 수, 요청당 비용
- 로컬 LLM 자체 처리량 — 과금은 없지만 같은 화면에서 GPU 사용률·토큰 처리 속도를 모니터링하면 용량 계획(언제 하드웨어를 늘려야 하는지)에 유용

**기술 스택**
- 오케스트레이터(Spring Boot)에 API 호출 단위로 로깅하는 WebFilter 또는 HandlerInterceptor 추가 (요청 시각·서비스명·호출량/토큰 수·예상 비용 기록)
- 집계 저장: 로컬 DB(H2 Database 또는 SQLite, Spring Data JPA/JDBC 연동)
- 대시보드 UI: Electron 프론트엔드에 서비스별 사용량 게이지, 월별 누적 비용 그래프, 한도 임계치 알림 (REST API 연계)

**실현 가능성**: 100% 가능, GPU 자원과 무관. 기존 오케스트레이터의 API 클라이언트 레이어에 로깅만 추가하면 되는 수준입니다.

**난이도**: 낮음 (로깅 + 집계 + 시각화, 표준 대시보드 패턴).

**우선순위**: 중간 — 6.1의 클라우드 연동 기능들이 실제로 붙은 뒤에 의미가 생기므로 함께 진행하는 게 자연스럽습니다. 다만 고객사가 "이 제품이 우리 비용을 얼마나 쓰는지" 투명하게 확인하고 싶어할 가능성이 높아, B2B 신뢰 확보 관점에서는 우선순위를 높일 수도 있습니다.

---

### 6.2 단기/장기 기억장치 — 고객사 데이터 학습 구조 (RAG → 파인튜닝 파이프라인)

사람의 지식 습득·기억 방식과 동일하게 **단기 기억(RAG)**과 **장기 기억(파인튜닝)** 두 단계로 나눠 접근합니다. CONNECT AI LAB의 "AI 직원 두뇌 학습" 방식(EP.3 절대 배신하지 않는 AI 직원 만들기)도 동일한 원리를 사용하며, GIJO AS의 에이전트 AI 화면(6.3절과 연계)에 그대로 적용할 수 있습니다.

#### 개념 비교

| 구분 | 단기 기억 (RAG) | 장기 기억 (파인튜닝) |
|---|---|---|
| 비유 | 벼락치기 — 시험 전날 자료를 펴놓고 참고 | 내재화 — 지식을 완전히 습득해 각인 |
| 원리 | 외부 문서·지식 팩을 모델에 임시로 연결해 답변 유도 | 모델 가중치(Weight) 자체를 데이터로 업데이트 |
| 장점 | 학습 과정 없이 즉시 반영, 재학습 불필요 | 매번 문서를 탐색할 필요가 없어 응답속도가 크게 빨라짐 |
| 단점 | 문서 연결이 끊기면 망각, 데이터가 많아질수록 탐색·필터링 시간 증가로 속도 저하 | 학습용 데이터셋 구축과 GPU 연산 비용 필요 |
| 저장소 | 로컬 벡터DB(LanceDB) | HuggingFace(비공개 저장소) — 데이터셋과 학습 완료 모델 관리 |

> **참고**: 참고한 CONNECT AI LAB 방식에서는 단기 기억 백업을 GitHub 프라이빗 레포로 동기화해 여러 PC 간 이식성을 확보합니다. 다만 GIJO AS는 보안 제품 특성상 고객사의 민감한 보안 데이터를 외부 퍼블릭 클라우드 저장소에 두는 것을 권장하지 않습니다. 동일한 "포터블 동기화" 개념은 로컬 LanceDB 백업이나 고객사 내부 Git 서버(온프레미스)로 대체 구현합니다.

#### 1차: RAG (지금 바로 시작)
- 고객사가 넣은 문서·자산 데이터를 임베딩해 LanceDB에 저장 → 질의 시 유사 컨텍스트 검색 → 프롬프트에 주입
- 원본 모델 가중치를 건드리지 않아 안전하고, 반영 속도가 즉시적(재학습 불필요)
- 임베딩 모델은 BGE-M3, multilingual-e5 등 경량 모델을 RTX 3090에서 LLM과 나눠 동시 서빙 가능 (VRAM 여유 충분)

#### 2차: 파인튜닝(QLoRA) — 실전 프로세스 4단계

① **기본 모델 로드 및 지식 주입(RAG)** — 고객사 보안정책·사고대응 매뉴얼 등 문서를 임베딩해 연결하고, 관련 질의에 정확히 답하는지 먼저 확인합니다.

② **학습 데이터셋 변환 및 증폭** — RAG로 축적된 문서를 AI가 학습할 수 있는 "질문–답변" 대화형(Conversation Format) 데이터셋으로 변환합니다. 데이터 양이 적으면 학습이 잘 되지 않으므로 표현을 확장·증폭해 다각도로 이해할 수 있는 데이터를 만든 뒤, HuggingFace 비공개 저장소에 업로드합니다.

③ **GPU 파인튜닝** — Unsloth 프레임워크로 RTX 3090(VRAM 17.5GB 확인됨, 24GB로 여유 있게 가능) 또는 보조로 무료 클라우드 GPU(Google Colab T4)를 활용해 학습합니다. 학습이 진행되며 **Loss(기존 모델 응답과 정답 데이터 간 오차)** 값이 점점 줄어드는 것을 모니터링합니다(예: 3.5 → 0.5 수준).

④ **커스텀 모델 장착** — 학습 완료된 모델을 HuggingFace에 업로드하고, GIJO AS의 에이전트 AI 화면에서 검색·다운로드한 뒤 특정 에이전트(예: 분석 에이전트)의 전용 두뇌로 지정합니다. 이후 해당 에이전트는 매번 외부 문서를 탐색하지 않고도 내재화된 지식으로 즉시 응답합니다.

**핵심 학습 메커니즘 — 과적합(Overfitting) 방지**

지도학습 기반 파인튜닝(SFT)은 정답이 있는 데이터를 반복 주입해 Loss를 최소화하는 방식으로 진행됩니다. 다만 Loss를 무리하게 0에 가깝게 줄이면 새로 학습한 지식에만 특화되고, 모델이 원래 갖고 있던 일반적인 보안 추론·상식 능력을 잃어버리는 과적합이 발생합니다. 따라서 기본 지식을 유지하면서 신규 지식을 흡수하는 적정 지점(학습 스텝 수의 밸런스, Sweet Spot)을 찾는 것이 핵심이며, 고객사별 파인튜닝 파이프라인에는 파인튜닝 전후 성능을 비교 평가하는 검증 단계를 반드시 포함해야 합니다.

**환경 연동**
- HuggingFace 토큰(쓰기 권한) 연동 — 학습용 데이터셋과 완료된 모델의 업로드/다운로드
- (선택) 내부 Git 서버 연동 — 단기 기억 문서를 온프레미스로 백업·동기화

**검색 결과 보강**: Unsloth 프레임워크로 9B급 모델을 QLoRA 파인튜닝할 때 VRAM 소모가 더욱 크게 절감되어 RTX 3090 24GB로 매우 안정적이고 빠르게 완료할 수 있습니다. 순정 PyTorch 대비 Unsloth는 12배 가량 빠르게 처리를 도와주므로 단일 GPU 환경에서도 자체 파인튜닝 주기 단축과 피드백 반영 속도가 우수합니다.

**난이도**: RAG는 낮음(임베딩+벡터DB 조합은 이미 검증된 패턴). 파인튜닝은 중~높음 — 고객사별 데이터셋 정제, 대화형 데이터셋 변환·증폭 자동화, 파인튜닝 전후 성능 비교 평가 체계가 추가로 필요합니다.

**우선순위**: RAG를 1순위로 먼저 구축(제품의 기본 기억 기능), 파인튜닝은 고객사가 자체 데이터를 충분히 축적한 뒤 제공하는 "고도화 옵션"으로 2차 배치.

---

### 6.3 Evolutionary Model Merge (Sakana AI 방식)

> **중요 전제**: 이 기능은 **Qwythos-9B에 의존하지 않습니다.** Qwythos-9B는 오케스트레이터의 범용 추론 엔진(요약·우선순위 판단·대화·도구 호출)이고, Evolutionary Model Merge는 그와 별개로 **"보안에 특화된 전용 LLM"을 오픈소스 모델들의 합성으로 새로 만들어내는 R&D 트랙**입니다. 두 파이프라인은 독립적으로 개발·검증하고, 병합 결과물이 검증되면 그때 오케스트레이터에 추가 어댑터(전문 분석용 서브모델)로 연결하는 구조를 권장합니다.

**Sakana AI의 정확한 방법론** (논문 "Evolutionary Optimization of Model Merging Recipes", 2024년 발표, 2025년 Nature Machine Intelligence 게재)

- 기존 모델 병합은 사람이 직접 어떤 레이어를 어떻게 섞을지 정하는 "직관·경험 기반" 작업이었습니다. Sakana AI는 이를 **진화 알고리즘(CMA-ES 등)으로 자동 탐색**하는 방식으로 바꿨습니다.
- 두 가지 공간에서 동시에 최적화합니다.
  1. **파라미터 공간(Parameter Space)**: 여러 모델의 가중치를 선형결합/SLERP 등으로 섞는 비율 자체를 진화적으로 탐색
  2. **데이터 흐름 공간(Data Flow Space)**: 가중치를 섞지 않고, 추론 시 토큰마다 "어느 모델의 어느 레이어를 통과시킬지" 경로 자체를 탐색 (레이어 단위 라우팅 — MoE의 라우팅 개념과 유사하지만 서로 다른 모델들 사이에서 이루어짐)
- 이 방식으로 일본어 수학 추론 모델(EvoLLM-JP, 70B급 모델을 능가)과 일본어 비전-언어 모델(EvoVLM-JP)을 추가 학습 데이터나 대규모 연산 없이 만들어냈습니다. 즉 **그래디언트 기반 재학습이 필요 없고, 기존 오픈소스 모델들을 "합성"만으로 새 능력을 만드는 것**이 핵심입니다.

**오픈소스 도구**
- **mergekit** (Arcee AI) — 병합 자체를 수행하는 핵심 엔진. linear, SLERP, TIES, DARE, task arithmetic 등 병합 기법과 MoE 구성 기능 제공. 사실상 업계 표준.
- **Mergenetic** (ACL 2025 데모) — mergekit 위에서 진화적 탐색(유전 알고리즘)을 자동화하는 라이브러리. GSM8K, HumanEval 같은 벤치마크를 적합도 함수로 써서 세대를 거듭하며 최적 병합 레시피를 찾음.
- **MERGE³** (2025) — 진화 탐색의 가장 큰 비용인 "후보 모델마다 벤치마크 전체를 돌려 평가하는 것"을 경량 적합도 추정기로 대체해 **연산 비용을 약 50배 절감**. 컴퓨팅 자원이 제한적인 단일 GPU 환경에 특히 적합합니다.

**합성 재료 후보 (보안 특화 오픈소스 모델)**

Qwen2.5-Coder-32B-Instruct와 무관하게, 아래처럼 이미 보안 도메인에 특화된 오픈소스 모델들을 "재료"로 병합하는 것이 방향에 맞습니다. 2026년 보안 AI 업계 자체가 "하나의 거대 모델" 대신 **"로컬에서 도는 여러 특화 소형 모델의 팀"**으로 가는 추세이고, 공격형(에이전트)·분석형(애널리스트) 모델을 함께 쓰는 구조가 표준적인 2026년 보안 아키텍처로 언급되고 있어 이 방향성과도 맞아떨어집니다.

| 후보 모델 | 특성 | 역할 |
|---|---|---|
| **DeepHat-V1-7B** (구 WhiteRabbitNeo) | Qwen2.5-Coder-7B 기반, 침투테스트/오펜시브 보안에 특화 | "공격자 관점" 취약점 탐색·익스플로잇 추론 |
| **Foundation-Sec-8B(-Instruct)** | Llama-3.1-8B를 보안 코퍼스로 지속사전학습, GPT-4o-mini급 성능 | "분석가 관점" 취약점 설명·리포트 작성 |
| Foundation-Sec-Reasoning-8B | Foundation-Sec의 추론 강화 버전 | 우선순위 판단·근거 기반 추론 |

DeepHat(공격 관점)과 Foundation-Sec(분석/방어 관점)을 병합하면, Penligent식 침투검증과 ModelScan식 정적분석 설명을 동시에 잘 소화하는 단일 보안 특화 모델을 만드는 실험이 가능합니다.

**기존 완성형 후보 (베이스라인 비교용)** — HuggingFace 검색 결과

직접 병합을 실험하기 전에, 이미 "합성/파인튜닝 완료" 상태인 보안 특화 모델을 먼저 돌려보고 기준점(baseline)으로 삼는 것도 좋은 전략입니다. HuggingFace에 `cybersecurity` 태그로 313개 모델이 있으며, 이 중 눈에 띄는 것들:

| 모델 | 특징 | 이 프로젝트와의 관련성 |
|---|---|---|
| **AlicanKiraz0/Titus-CybersecurityLLM-v1.0** | `Qwen/Qwen3.6-35B-A3B` 기반, 50만+ 건 보안 지시문 데이터셋으로 LoRA 학습 후 병합·GGUF 변환 완료 | 목표 모델(Qwen2.5-Coder-32B-Instruct)과 다른 계열 MoE 구조이나 우리 llama.cpp/CUDA 환경에 그대로 로드 가능. SOC/DFIR/IAM/K8s/AppSec/**SBOM·CVE 레코드**까지 학습 태스크에 포함되어 6.4(SBOM 정리) 기능과도 맞닿음. GGUF Q4_K_M 기준 21.2GB — RTX 3090 24GB에 들어가나 여유가 크지 않아 컨텍스트는 보수적으로 설정 필요. **주의**: "터키어 우선(Turkish-first)" 모델이라 한국어 설명 품질은 별도 검증 필요 |
| `hotdogs/qwen3.6-27b-cybersecurity-lora` | Qwen3.6-27B용 보안 특화 LoRA 어댑터 | 어댑터만 얹는 방식이라 실험 비용이 가장 낮음 |
| `segolilylabs/Lily-Cybersecurity-7B-v0.2` (+ GGUF) | 검증된 7B급 보안 특화 모델, 커뮤니티 다운로드·좋아요 수 높음 | DeepHat/Foundation-Sec과 같은 체급의 병합 재료 후보 |

**이 서버로 실현 가능성**
- 후보 모델들이 모두 7B~8B급이라 30B급을 병합하는 것보다 훨씬 가볍습니다. 파라미터 공간 병합(linear/SLERP/TIES) 자체는 훈련이 아니라 가중치 산술 연산이라 GPU 없이도 가능하고, RTX 3090 + RAM 64GB로 충분합니다.
- 다만 "진화적 탐색"은 한 세대에 후보 병합 모델을 여러 개 만들고 각각 벤치마크로 평가해야 해서, Sakana AI가 원래 썼던 규모(다수 GPU 클러스터)를 단일 RTX 3090으로 그대로 재현하기엔 무리입니다.
- **현실적 접근**: (1) 위 두 모델(DeepHat-V1-7B + Foundation-Sec-8B)처럼 이미 검증된 7B~8B급 보안 특화 모델 2개로 시작 (2) MERGE³ 같은 경량 적합도 추정 도구를 써서 탐색 비용을 낮춤 (3) 벤치마크는 보안 도메인에 맞게 자체 제작(예: CVE 설명 정확도, 취약점 우선순위 판단 정합성, PoC 재현 성공률)

**난이도**: 높음 — R&D 성격이 강하고, 적합도 함수(벤치마크) 설계 자체가 별도 과제입니다.

**우선순위**: 낮음(로드맵 후반). 먼저 단일 모델(Qwen2.5-Coder-32B-Instruct) 파이프라인과 RAG/SBOM 기능을 안정화한 뒤, "차별화 요소"로 시도하는 것을 권장합니다.

---

### 6.4 보안담당자 결과 확인 → SBOM 형태 정리 (자산관리 활용)

**실현 가능성**: 이미 설계된 오케스트레이터의 표준 finding 스키마(`finding_type`, `severity`, `evidence`, `source_tool`)와 자산 레지스트리(LanceDB)를 그대로 확장하면 되므로, 이 서버 스펙과 무관하게 100% 가능합니다.

**기술 스택**
- SBOM 표준 포맷: **CycloneDX** 또는 **SPDX** (업계 양대 표준, SAFESQUARE도 이 계열 패턴을 따름)
- Java 생태계의 CycloneDX 라이브러리(`org.cyclonedx:cyclonedx-core-java` 등)로 자산 DB → SBOM JSON/XML 변환
- 보안담당자용 대시보드에서 "확인 완료" 처리한 finding만 선별해 SBOM에 반영하는 승인 워크플로우 추가

**난이도**: 낮음~중간. 표준 포맷에 필드를 매핑하는 작업이 대부분이며, 기존 자산 DB 스키마가 이미 SAFESQUARE 패턴을 참고해 설계되어 있어 큰 재설계 없이 붙일 수 있습니다.

**우선순위**: 높음. 기업 고객(특히 SAFESQUARE 기존 금융권 레퍼런스)에게 가장 직접적으로 어필되는 기능이며, 오케스트레이터의 핵심 데이터 자산을 표준 산출물로 내보내는 것이라 제품의 "완결성"을 보여주는 데 중요합니다.

#### 6.4.1 내부 SBOM 기반 내부보고용 리포트 기능

**개념**: 6.4의 SBOM은 CycloneDX/SPDX 같은 "시스템 간 교환용" 표준 포맷인 반면, 이 기능은 같은 데이터를 **사람이 읽는 내부 보고서**(경영진 보고, 감사 대응, 정기 보안 현황 공유)로 재가공하는 레이어입니다. 데이터 소스는 6.4와 동일한 자산 DB/SBOM이라 별도 수집 로직 없이 "표현 계층"만 추가하면 됩니다.

**기능 정의**
- **정기 리포트**(주간/월간/분기): 자산 현황, 신규 발견 취약점 수, 심각도별 분포, 조치 현황(완료/진행중/미조치), 전월 대비 증감 추이
- **온디맨드 리포트**: 특정 자산·기간·심각도로 필터링해 즉시 생성
- **2단계 구성**: 경영진용 1페이지 요약(Executive Summary) + 실무자용 상세 리포트(전체 finding 목록)
- **LLM 역할**: SBOM/finding 데이터를 프롬프트에 넣어 비전문가도 이해할 수 있는 경영진 요약문을 자동 생성 — 4.2(콘텐츠 분석 기능)에서 만든 요약 로직을 그대로 재사용

**기술 스택**
- 문서 생성: Java 생태계 라이브러리(Apache POI for Word/Excel, OpenPDF 또는 iText for PDF)로 출력
- 회사 로고·포맷 커스터마이징 가능한 템플릿 엔진
- 스케줄링: Spring `@Scheduled` 애노테이션 기반 정기 리포트 자동 생성 및 JavaMailSender 활용 이메일 발송
- 데이터 소스: 6.4의 SBOM/자산 레지스트리 그대로 재사용 (신규 수집 로직 불필요)

**실현 가능성**: 100% 가능. 문서 렌더링은 CPU 작업이고, LLM은 요약 생성 시에만 짧게 호출되므로 RTX 3090 자원 부담이 거의 없습니다.

**난이도**: 낮음~중간. 문서 생성 라이브러리 자체는 표준 작업이지만, 경영진이 보기 좋은 템플릿 디자인과 LLM 요약 품질 튜닝에 시간이 필요합니다.

**우선순위**: 높음. 6.4(SBOM 정리)와 사실상 한 세트로 묶이는 기능이며, 기업 고객이 "결과적으로 무엇을 받는가"에 대한 가장 직접적인 답이 되는 산출물이라 6.4와 함께 1순위로 배치하는 것을 권장합니다.

---


---

## 7단계 — 애플리케이션 아키텍처 (CS 구조 설계)

사용자가 실제 사용 중인 **Connect AI Desktop**(CONNECT AI LAB, MIT 라이선스 오픈소스)의 엔진 모듈화 개념을 참고하되, GIJO AS의 사내망 보안성 및 GPU 자원 관리 극대화를 위해 **서버-클라이언트(CS) 아키텍처**로 전면 전환하여 설계합니다.

### 7.1 최상위 프로젝트 구조

프로젝트는 크게 얇은 프론트엔드인 `client`와 핵심 로직 및 GPU 연산을 담당하는 `server`로 양분됩니다.

```
GIJO-AS/
├── client/                     # Electron 기반 얇은 클라이언트
│   ├── src/
│   │   ├── main.ts            # Electron 메인 프로세스 (창 관리, 로컬 구동 시 서버 프로세스 생명주기 제어)
│   │   ├── preload.ts         # contextBridge를 통한 REST/WS 연계 API 노출 (window.gijo.*)
│   │   └── renderer/          # UI 소스코드 (React/HTML5 및 SVG 기반 에이전트 시각화 레이어)
│   └── package.json
│
└── server/                     # Java/Spring Boot 3.x 기반 백엔드 오케스트레이터 서버
    ├── build.gradle            # Gradle 빌드 구성
    ├── src/main/java/com/gijo/as/
    │   ├── GijoAsApplication.java # Spring Boot 메인 클래스
    │   ├── config/             # Spring Security, WebSocket 설정
    │   ├── controller/         # REST API 컨트롤러
    │   └── engine/             # 15종 엔진 서비스 패키지 (com.gijo.as.engine.*)
    └── src/main/resources/
        └── application.yml     # 서버 환경설정 (포트, JWT, DB 정보)
```

### 7.2 엔진 모듈 대응표 — Connect AI → GIJO AS (Spring Boot 패키지 구조)

Connect AI의 단일 앱용 `.ts` 엔진 모듈들을 Spring Boot 백엔드 서버의 Java 서비스 빈(Bean)으로 이식하여 설계합니다.

| Connect AI 엔진 모듈 | 역할 | GIJO AS Java 클래스 / 서비스 | 비고 |
|---|---|---|---|
| `agents.ts` | 에이전트 정의·페르소나 | `com.gijo.as.engine.service.AgentService` | 8종 보안 에이전트(오케스트레이터/스캔/침투테스트/분석/SBOM/CTI/리포트/모델진화) 정의 — 6단계 요약표와 매핑 |
| `brain.ts` | 지식·기억 관리 | `com.gijo.as.engine.service.MemoryService` | RAG + 파인튜닝 메모리 매니저 (로컬 벡터 탐색 및 저장) — 6.2절 파이프라인 구현체 |
| `bridge.ts` | IPC/외부 연동 브릿지 | `com.gijo.as.engine.service.BridgeService` | 오케스트레이터 ↔ 스캐너 어댑터 브릿지 (Python 스크립트 실행 제어) |
| `company.ts` | 팀 협업 시뮬레이션 | `com.gijo.as.engine.service.CollaborationService` | 에이전트 간 작업 위임·협업 로그 브로드캐스트 (WebSocket 전송 담당) |
| `dataset.ts` | 학습 데이터셋 관리 | `com.gijo.as.engine.service.DatasetService` | RAG 문서를 대화형(Q&A) 포맷으로 변환·증폭 — 6.2절 ②단계 |
| `github.ts` | GitHub 동기화 | `com.gijo.as.engine.service.GitSyncService` | 온프레미스 Git 서버로 대체 (공개 GitHub 대신, 6.2절 참고 박스 참조) |
| `hf.ts` / `hfmodels.ts` | HuggingFace 연동·모델 검색 | `com.gijo.as.engine.service.HfModelService` | 에이전트 AI 화면의 "HuggingFace 모델 검색·불러오기" 구현체 |
| `intent.ts` | 자연어 명령 의도 파악 | `com.gijo.as.engine.service.IntentService` | 대시보드 하단 채팅바 입력을 적절한 에이전트로 라우팅하는 의도 분석 엔진 |
| `llm.ts` | LLM 호출 레이어 | `com.gijo.as.engine.service.LlmService` | llama-server REST 클라이언트 (Spring RestClient/WebClient) — 4.1절과 동일 |
| `localengine.ts` | 로컬 LLM 엔진 프로세스 관리 | `com.gijo.as.engine.service.LocalEngineService` | ProcessBuilder를 통한 llama-server 자식 프로세스 기동·재시작 — 4.1절과 동일 |
| `localtrain.ts` / `train.ts` | 로컬 파인튜닝 실행 | `com.gijo.as.engine.service.FineTuneService` | Unsloth 기반 QLoRA 파인튜닝 실행 제어 및 상태 추적 — 6.2절 ③단계 |
| `methods.ts` / `tools.ts` | 에이전트 실행 가능 액션·툴 정의 | `com.gijo.as.engine.service.ToolService` | ModelScan/Penligent 등 스캐너 어댑터를 "툴"로 등록하고 실행하는 인터페이스 |
| `tasks.ts` | 할일·작업 큐 관리 | `com.gijo.as.engine.service.TaskService` | 대시보드 "오늘 확인할 항목"(P0~P1) 큐 및 데이터베이스(JPA) 영속화 |
| `email.ts` | 이메일 발송 | `com.gijo.as.engine.service.EmailService` | JavaMailSender를 이용한 내부 리포트 이메일 발송 — 6.4.1절과 연결 |
| `cryptopack.ts` | 암호화·패키징 유틸 | `com.gijo.as.engine.util.CryptoPack` | 고객사 민감 보안데이터 암호화 저장 유틸리티 |
| `mcp.ts` | MCP(Model Context Protocol) 연동 | (향후 확장) | 외부 툴 연동 확장 포인트로 고려 가능 (Java SDK 활용) |
| `paypal.ts` / `toss.ts` | 결제 연동 | — | GIJO AS는 결제보다 라이선스/구독 관리로 대체, 우선순위 낮음 |
| `tts.ts` / `edgetts.ts` / `youtube.ts` | 음성합성·유튜브 연동 | — | 콘텐츠 크리에이터용 기능이라 GIJO AS엔 해당 없음, 제외 |

### 7.3 렌더러 및 통신 구조

- `renderer/brainviz.ts` — 지식 네트워크를 시각화하는 모듈로, GIJO AS 대시보드 v3에 구현된 **에이전트 네트워크 SVG 시각화**와 대응합니다. 실제 개발 시 D3.js 등을 활용하여 WebSocket 실시간 이벤트 기반 시각화로 구동합니다.
- `renderer/core.ts` — 렌더러 공통 로직 (상태 관리, HTTP API fetch 및 WebSocket 구독 제어)

### 7.4 적용 방침

1. **클라이언트-서버(CS) 분리 아키텍처**: 클라이언트 Electron은 UI 및 IPC 껍데기만 남겨 얇게 유지하고, 모든 핵심 비즈니스 로직 및 GPU/DB 통제는 **Spring Boot 백엔드 서버**로 이관합니다.
2. **Spring Boot 모듈화 패턴**: 서버 측 `com.gijo.as.engine.service` 패키지 하위에 각 도메인별 서비스 클래스를 빈(Bean)으로 등록해 결합도를 낮추고 모듈화합니다.
3. **핵심 기능 1:1 매핑**: GIJO AS 고유 도메인 서비스 클래스들(`MemoryService`, `FineTuneService`, `CollaborationService`, `ToolService` 등)은 6단계에서 확정한 4대 핵심 기능과 1:1로 매핑되도록 설계합니다.
4. **엔터프라이즈 거버넌스**: 결제·TTS·유튜브 등 콘텐츠 크리에이터 기능은 배제하고, Spring Security, JPA 영속화 등 엔터프라이즈 환경에 적합한 인프라 코드로 대체합니다.


---

## 8단계 — 에이전트 지시 실행 파이프라인 (DispatcherService.java)

7단계에서 정리한 엔진 모듈 중 `intent`, `tasks`, `agents`, `collaboration`, `bridge`, `llm` 등은 서로 독립된 서비스 빈(Bean)으로 동작하나, 실제로 "보안담당자가 에이전트에게 업무를 지시(할당)"할 때 이들을 조율하는 통합 파이프라인이 필요합니다. 이를 `com.gijo.as.engine.service.DispatcherService` 클래스에서 처리합니다.

**Java 기반 파이프라인 개념 구현**

```java
@Service
public class DispatcherService {
    @Autowired private IntentService intentService;
    @Autowired private TaskService taskService;
    @Autowired private AgentService agentService;
    @Autowired private CollaborationService collaborationService;
    @Autowired private BridgeService bridgeService;
    @Autowired private LlmService llmService;

    public void dispatch(String instruction) {
        // 1. 의도 분석 및 에이전트/액션 결정
        RouteResult route = intentService.routeIntent(instruction);
        
        // 2. 작업 큐에 등록 (JPA 영속화)
        Task task = taskService.createTask(route);
        
        // 3. 에이전트 상태 변경 (WORKING)
        agentService.setAgentStatus(route.getAgentId(), AgentStatus.WORKING);
        
        // 4. 협업 시작 로그 브로드캐스트 (Spring WebSocket)
        collaborationService.emitCollaboration(route.getAgentId(), "start");
        
        // 5. 실제 추론 또는 스캐너 실행
        if (route.isScanAction()) {
            bridgeService.runAdapter(route); // ProcessBuilder를 통한 서브프로세스 구동
        } else {
            llmService.chat(route); // llama-server REST API 호출 및 응답 스트리밍
        }
        
        // 6. 협업 완료 로그 브로드캐스트
        collaborationService.emitCollaboration(route.getAgentId(), "complete");
        
        // 7. 마무리 및 에이전트/태스크 상태 복원
        agentService.resetAgentToDefault(route.getAgentId());
        taskService.completeTask(task.getId());
    }
}
```

클라이언트(Electron) UI의 채팅바에서 `POST /api/dispatch` API를 호출하면 Spring Boot 백엔드 서버의 `DispatcherController`가 이 파이프라인을 비동기로 호출하고, 진행 로그 및 완료 상태는 WebSocket(`/ws`)을 통해 각 접속 클라이언트로 전파됩니다.

**완료 (2026-07-14)**
- `intent.ts`의 `routeIntent()`를 로컬 LLM few-shot 분류(JSON 출력, 등록된 자산 목록을 프롬프트에 포함해 개체명 인식까지 겸함)로 교체. LLM 응답이 파싱 불가하거나 로컬 LLM이 꺼져 있으면 기존 정규식 라우팅으로 자동 폴백 (`server/test/intent.test.ts`).
- `dispatcher.ts`의 scan 실행 경로가 `targetAssetId`를 `assets.ts` 레지스트리에서 조회해 실제 자산 파일 경로(`asset.path`)로 스캔 어댑터를 호출하도록 수정 (이전에는 자산 ID 문자열을 경로로 그대로 사용).
- 우선순위 산정을 스캔 완료 후 finding 심각도 기반으로 보강: `critical→P0, high→P1, medium→P2, low→P3`로 작업 생성 시점의 액션 기반 초기값을 덮어씀 (`priorityForFindings()`). CVSS/EPSS/KEV 등 외부 스코어링 연동은 6.1.1절 CTI 벤더 계약 체결 전까지는 데이터 소스가 없어 보류 (`cti.ts`의 TODO와 동일 사유).

---

## 9단계 — CS(클라이언트-서버) 구조 전환

> **⚠️ 번복 (2026-07-13): 서버 언어는 최종적으로 TypeScript/Node.js로 확정되었습니다.** 아래 9단계 본문은 한때 "Java/Spring Boot 최종 확정"으로 작성됐으나, 실제로는 `gijo-as-cs-scaffold.zip`(Express + `ws` 기반, 엔진 모듈 15종을 그대로 이식)을 그대로 채택해 `server/`에 풀어 넣었고 npm install + `tsc --noEmit` 타입체크까지 통과 확인했습니다. Java/Spring Boot로 새로 작성했던 버전은 폐기하지 않고 `server-java-reference/`에 참고용으로만 남겨뒀습니다(재검토 시 대비). 아래 9.1~9.6절의 "Java" 언급은 **역사적 기록**이며, 실제 구현 기준으로는 `com.gijo.as.engine.service.*` 패키지 → `server/src/engine/*.ts`, Spring Bean → Express 라우트 핸들러, Spring WebSocket → `ws.WebSocketServer`로 각각 대응한다고 읽으면 됩니다.

> ~~상태: Java/Spring Boot(2안) 최종 확정 및 반영.~~ (위 번복 공지로 대체됨) 8단계까지의 단일 Electron 앱 구조를 서버와 얇은 클라이언트로 분리하고, 서버 백엔드를 엔터프라이즈 적합성 및 사내 컴플라이언스 준수를 위해 Java/Spring Boot 3.x 스택으로 검토했던 기록입니다. 오케스트레이터가 "보안 AI 중계서버"로 기능한다는 설계 의도 자체는 TS 버전에서도 그대로 유지됩니다.

### 9.1 무엇이 바뀌었나

| 항목 | 8단계(단일 앱) | 9단계 (Java CS 구조) |
|---|---|---|
| 실행 프로세스 | Electron 1개 | 서버 (Java/Spring Boot, 포트 4000) + 클라이언트 (Electron) |
| 엔진 모듈 위치 | 클라이언트 내부 (`src/engine/`) | 서버 패키지 (`com.gijo.as.engine.*`) — 15종 엔진 서비스 구현 |
| intent/llm/tools | 클라이언트 내부 모듈 | 서버의 Spring Bean으로 구현되어 REST API 및 WebSocket으로 통신 |
| 통신 방식 | IPC (`ipcMain`/`ipcRenderer`) | HTTP REST API — 클라이언트에서 `fetch("http://<서버IP>:4000/api/...")` 호출 |
| 실시간 이벤트 | `webContents.send()` | Spring WebSocket/STOMP 프로토콜 — `/ws`를 통해 실시간 브로드캐스트 |
| 인증 | 없음 | Spring Security + JWT (Bearer Token) 기반 사용자 인증 |
| dispatcher 파이프라인 | 클라이언트 내부 실행 | `DispatcherService` 클래스를 통해 서버 내 비동기 멀티스레드 파이프라인으로 구동 |

### 9.2 서버 REST API 엔드포인트 (요약)

인증 API(`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`)를 제외한 모든 엔드포인트는 HTTP 헤더에 `Authorization: Bearer <JWT_Token>`을 필수로 요구하며, Spring Security Filter에 의해 가로채기(Intercept) 검증됩니다.

| 모듈 | REST 컨트롤러 엔드포인트 | HTTP Method |
|---|---|---|
| AuthController | `/api/auth/login`, `/api/auth/logout`, `/api/auth/me` | POST, GET |
| AgentController | `/api/agents` | GET |
| DispatchController | `/api/dispatch` | POST |
| TaskController | `/api/tasks`, `/api/tasks/{id}/complete` | GET, POST |
| CollaborationController | `/api/collaboration/history` (WebSocket 실시간 병행) | GET |
| MemoryController | `/api/memory/ingest`, `/api/memory/query` | POST |
| BridgeController | `/api/bridge/run`, `/api/bridge/adapters` | POST, GET |
| LlmController | `/api/llm/chat` (SSE 스트리밍 응답 지원) | POST |
| LocalEngineController | `/api/localengine/status`, `/api/localengine/start`, `/api/localengine/stop` | GET, POST |
| FineTuneController | `/api/finetune/start` (WebSocket으로 진척률 전파) | POST |
| DatasetController | `/api/dataset/convert`, `/api/dataset/amplify` | POST |
| HfModelController | `/api/hfmodels/search`, `/api/hfmodels/load` | GET, POST |
| GitSyncController | `/api/gitsync/sync` | POST |
| IntentController | `/api/intent/route` | POST |
| ToolController | `/api/tools`, `/api/tools/run` | GET, POST |
| EmailController | `/api/email/sendReport` | POST |
| SbomController | `/api/sbom/{assetId}/generate`, `/api/sbom/{assetId}/export` | POST |
| CtiController | `/api/cti/feeds`, `/api/cti/findings` | GET |
| ReportController | `/api/report/generate` | POST |
| HealthController | `/api/health` | GET |

`CryptoPack`은 API로 노출되지 않고, 서버 내부 암호화가 필요한 서비스(`MemoryService`, `GitSyncService` 등)에서 참조하는 유틸리티 컴포넌트로 존재합니다.

### 9.3 배포 모드 2가지

**단일 데스크톱 모드 (1인 기업/소규모)**
클라이언트 Electron 실행 시, 로컬 환경에 구성된 Spring Boot JAR 파일을 `ProcessBuilder`로 자동 구동합니다. 기본 주소 `http://localhost:4000`을 타겟으로 하며, 로그인 화면에서 즉시 로그인하여 사용 가능합니다.

**분산 온프레미스 모드 (기업/금융권 고객)**
NVIDIA RTX 3090 GPU가 장착된 고사양 사내 서버에 Spring Boot 백엔드 애플리케이션(`gijo-as-server.jar`)을 상시 서비스(`systemd` 또는 Windows Service)로 구동합니다. 각 보안담당자는 자신의 PC에 설치된 얇은 Electron 클라이언트를 실행하고, 로그인 화면에서 서버의 사내 IP와 포트(`http://192.168.x.x:4000`)를 지정하여 중앙 서버에 동시 접속합니다. 이 경우 모든 GPU 연산과 취약점 자산 데이터가 GPU 서버 내부에서 통제 및 보존됩니다.

> ~~**알려진 문제(2026-07-14 발견) — 단일 데스크톱 모드의 네이티브 모듈 ABI 불일치**~~ → 패키징 파이프라인까지 완료 (2026-07-15). `client/scripts/build-server-dist.mjs`(`npm run build-server-dist`, `npm run dist`가 자동 호출)가 `server/`를 빌드하고 프로덕션 전용 의존성만 `client/server-dist/`에 새로 설치한 뒤 `@electron/rebuild`로 `better-sqlite3`를 Electron ABI로 재빌드한다 — `server/` 자체(시스템 Node ABI, `npm test`용)는 전혀 건드리지 않아 dev 워크플로우와 배포용 사본이 서로 간섭하지 않는다. `client/package.json`의 `build.extraResources`가 `server-dist/`를 패키지의 `resources/server-dist/`로 그대로 복사하고(asar 안에 네이티브 모듈을 넣으면 로드가 안 돼서 `files`/`asarUnpack` 대신 `extraResources` 사용), `main.ts`의 `maybeStartBundledServer()`가 `process.resourcesPath` 기준으로 그 경로를 최우선으로 찾는다(dev 환경의 `server-dist`나 sibling `../server/dist`로 순서대로 폴백). 서버 프로세스의 `cwd`도 이제 서버 자신의 위치로 고정해 `data/`가 예측 가능한 곳(`resources/server-dist/data/`)에 생기도록 함. **실제로 `npm run dist`로 만든 패키징 결과물(`dist/win-unpacked/GIJO AS.exe`)을 직접 실행해 로그인까지 검증 완료.** 남은 흠: 이 Windows 개발 환경에서 NSIS 설치 파일(.exe) 최종 생성 단계가 electron-builder의 macOS 코드사이닝 툴 다운로드(winCodeSign) 중 심볼릭 링크 생성 권한 문제로 실패한다(Windows 개발자 모드 비활성/비관리자 실행 시 흔한 문제) — `win-unpacked` 폴더까지는 정상 생성되며 실제 코드 서명은 이 프로젝트에서 아직 필요 없으므로, 개발자 모드를 켜거나 `CSC_IDENTITY_AUTO_DISCOVERY=false`로 우회하면 해결될 것으로 보이나 별도 검증은 안 함.

### 9.4 보안 및 인증 (Spring Security)

- **인증 구조**: Spring Security 구성에서 `SessionCreationPolicy.STATELESS`를 정의하여 무상태(Stateless) 아키텍처로 세션을 관리하며, 대신 JWT(Json Web Token)를 발급하여 인증 상태를 유지합니다.
- **비밀번호 보호**: 시드 데이터(`server/src/main/resources/application.yml` 또는 DB)에 위치한 사용자 비밀번호는 Spring Security의 `BCryptPasswordEncoder`를 적용하여 안전하게 해시 암호화되어 비교 검증됩니다.
- **인증 토큰**: 클라이언트는 로그인 요청 후 발급된 JWT Bearer 토큰을 세션 내 메모리에 보관하며, 이후 모든 REST API 및 WebSocket 핸드셰이크 요청의 HTTP 헤더로 전송합니다.

### 9.5 알려진 미결 항목

- ~~**JWT 만료/갱신 정책**: Access Token 및 Refresh Token 이중화 설계 필요~~ → 완료 (2026-07-14). `server/src/auth/auth.ts`: 서명된 JWT access token(기본 15분, `GIJO_ACCESS_TOKEN_TTL`)과 서버 측에 남는 opaque refresh token(기본 7일, `GIJO_REFRESH_TOKEN_TTL_MS`, 사용 시마다 회전)으로 분리. `POST /api/auth/refresh` 신설, 로그아웃은 refresh token만 즉시 폐기(발급된 access token은 JWT 설계상 무상태라 자연 만료까지는 유효 — 9.4절의 stateless 설계 의도 그대로). 클라이언트(`apiClient.ts`)는 401 응답 시 refresh token으로 한 번 조용히 재발급받아 원 요청을 재시도하도록 연동.
- ~~**DB 영속화 세부 튜닝**: SQLite를 JPA에 임베디드로 사용할 때 발생하는 Write-Ahead Logging(WAL) 동시성 이슈 보완~~ → 완료 (2026-07-14), 단 전제 자체가 없어서 "튜닝"이 아니라 "도입"이었음. `server/src/db.ts` 신설(`better-sqlite3`, `data/gijo-as.sqlite`) — 그 전까지 `assets.ts`/`tasks.ts`가 순수 인메모리라 서버 재시작 한 번에 등록된 자산·스캔 이력·작업 큐가 전부 사라졌다. 프로세스당 동기 연결 1개(커넥션 풀 없음)라 원래 항목이 걱정하던 "JPA 커넥션 풀의 WAL 동시성 이슈"는 이 스택 구조상 애초에 발생하지 않는다. `agents.ts`(휘발성 라이브 상태라 재시작 시 초기화가 오히려 맞음)와 `cti.ts`(API 키 평문 저장 문제를 먼저 풀어야 함 — 별도 미결)는 의도적으로 이번 범위에서 제외. 테스트는 `GIJO_DB_PATH=:memory:`(`vitest.config.ts`)로 격리, `server/test/db.test.ts`가 실제 파일 기반 영속성(연결 재개 후에도 데이터 유지)을 별도로 검증. 실서버 기동 → 자산 등록 → 프로세스 강제 종료 → 재기동 → 자산 유지 확인까지 수동으로도 실증함.
- ~~**자산 인벤토리(Assets) 고도화**: inventory 화면의 자산 이력을 실시간 스캔 정보와 매핑하는 데이터 파이프라인 정밀화~~ → 완료 (2026-07-14). `server/src/engine/assets.ts`: 예전엔 재스캔마다 findings를 무한 append해서 해결된 취약점도 위험도에 영구히 남는 버그가 있었음 — 이제 스캔 1회 = `scanHistory`에 남는 `ScanRun` 1개이고, `asset.findings`는 항상 최신 스캔 결과만 반영(현재 위험 상태). 자산 등록/스캔 완료/SBOM 생성마다 `asset:updated`를 WebSocket으로 브로드캐스트(collaboration.ts/finetune.ts와 동일 패턴)해 `inventory.html`이 수동 새로고침 없이 실시간으로 갱신되도록 연동.
- ~~**자연어 라우팅 고도화**: `IntentService` 내의 Regex 의도 분석기를 로컬 LLM Few-shot 의도 판별 및 JSON 파싱 모듈로 마이그레이션~~ → 완료 (2026-07-14), `server/src/engine/intent.ts` 참고
- **메인 로컬 LLM 모델 최종 확정**: 현재 초기 개발 테스트용으로 **Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf (Qwythos-9B)**를 메인 모델로 사용하도록 가이드를 1차 반영했습니다. 프로덕션 배포 전, 제품 핵심 작업(취약점 요약·SBOM·CTI 해석 등 일반 추론) 성능을 극대화하기 위해 Qwen3-30B-A3B 등의 MoE 모델 또는 보안 도메인 특화 모델로의 전환을 검토할 것. (모델 스왑 제어 로직 자체는 `server/src/engine/localengine.ts`에 이미 구현되어 있음 — 남은 건 "어떤 모델을 최종 채택할지"의 제품 판단만.)
- **서버 언어 재검토 여지**: 아래 9.6절의 Java 채택 근거(금융권 규제 준수, LDAP/SSO 연동, 타입 안전성)는 TypeScript로 번복한 지금도 완전히 사라진 게 아닙니다. 실제 기업(특히 금융권) 고객사 온보딩 단계에서 온프레미스 보안성 검토가 문제가 되면, `server-java-reference/`에 남겨둔 Java 구현체(9.2절 API 전부 이식 완료 상태)로 다시 전환하는 것을 고려할 것.

### 9.6 (참고용 — 현재는 TypeScript로 번복됨) 서버 언어로 Java/Spring Boot(2안)를 검토했던 배경

> 위 9단계 상단 번복 공지 참고 — 지금은 TypeScript/Node.js가 실제 채택된 스택입니다. 이 절은 Java를 검토했던 이유를 기록으로만 남겨둔 것이고, 재검토가 필요해지면 다시 참고하세요.

이전 단계까지 보류 중이었던 서버 스택을 Java/Spring Boot로 검토했을 당시의 핵심적인 배경과 이점은 다음과 같습니다.

1. **사내 보안 및 인프라 표준 준수**
   국내 금융권 및 주요 기업 고객사의 온프레미스 인프라 환경은 대부분 Java/Spring 기반의 프레임워크를 요구합니다. Node.js 생태계의 패키지 취약점 및 라이선스 복잡성 대비, Java 환경은 기업이 자체 검증하거나 정적분석 도구(SonarQube, Fortify 등)를 돌릴 때 보안성 검토 및 거버넌스 통과가 압도적으로 수월합니다.
2. **엔터프라이즈 에코시스템 연동 용이성**
   고객사 내부 시스템에 필수 연동되어야 하는 LDAP/SSO 계정 연동, LDAP/ESB 메시징 큐 연동, 온프레미스 메일 및 결제 승인 시스템 연동 등은 Spring Boot 환경에 풍부하고 안정적인 라이브러리(Spring Security, Spring Integration 등)가 이미 존재하여 개발 공수를 극적으로 줄입니다.
3. **엄격한 타입 안전성과 대규모 협업 아키텍처**
   보안 취약점 진단 및 SBOM 생성, CTI 연계 등 복잡한 데이터 모델을 처리하는 백엔드 도메인에서 Java의 강력한 타입 시스템과 OOP 패턴은 장기적인 리팩토링 및 다수 에이전트 간 분산 트랜잭션 관리(WebSocket 통신 상태 및 큐 관리)에 더 적합합니다.

## 참고 출처

- [llama.cpp 공식 빌드 문서](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md)
- [llama.cpp Windows 프리빌드 바이너리 (CUDA 13.1 지원)](https://knightli.com/en/2026/05/18/llama-cpp-windows-cuda-vulkan-gguf/)
- [llama.cpp 서버 README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [Qwythos-9B-Claude-Mythos-5-1M-GGUF (empero-ai)](https://huggingface.co/empero-ai/Qwythos-9B-Claude-Mythos-5-1M-GGUF)
- [NVIDIA CUDA Toolkit 다운로드](https://developer.nvidia.com/cuda-downloads)
- [NVIDIA 드라이버 다운로드](https://www.nvidia.com/drivers)
- [Sakana AI - Evolutionary Optimization of Model Merging Recipes (원문)](https://sakana.ai/evolutionary-model-merge/)
- [Evolutionary Optimization of Model Merging Recipes - Nature Machine Intelligence](https://www.nature.com/articles/s42256-024-00975-8)
- [Evolutionary Optimization of Model Merging Recipes - arXiv](https://arxiv.org/html/2403.13187v1)
- [Sakana AI 공식 GitHub - evolutionary-model-merge](https://github.com/sakanaai/evolutionary-model-merge)
- [Arcee mergekit](https://arxiv.org/pdf/2403.13257)
- [Mergenetic - 진화적 병합 자동화 라이브러리](https://github.com/tommasomncttn/mergenetic)
- [MERGE³ - 경량 적합도 추정 기반 진화 병합](https://arxiv.org/pdf/2502.10436)
- [Unsloth - Qwen2.5-Coder-32B-Instruct 파인튜닝 가이드](https://unsloth.ai/docs/basics/lora)
- [Unsloth 커뮤니티 - RTX 3090 단일 GPU로 Qwen2.5-Coder-32B-Instruct 파인튜닝 논의](https://github.com/unslothai/unsloth/discussions)
- [DeepHat(구 WhiteRabbitNeo) 및 로컬 배포형 보안 LLM 동향](https://evoailabs.medium.com/cybersecurity-llms-new-locally-deployable-models-for-agentic-ai-54908c3f621b)
- [Foundation-Sec-8B / Reasoning-8B 기술 리포트](https://arxiv.org/pdf/2601.21051)
- [2026 오픈소스 보안 특화 LLM 총정리](https://www.siliconflow.com/articles/en/best-open-source-LLM-for-Cybersecurity-Threat-Analysis)
- [HuggingFace - cybersecurity 태그 모델 전체 검색](https://huggingface.co/models?search=cybersecurity)
- [AlicanKiraz0/Titus-CybersecurityLLM-v1.0 (GGUF)](https://huggingface.co/AlicanKiraz0/Titus-CybersecurityLLM-v1.0-Q4_K_M-No-MTP-GGUF)
- [segolilylabs/Lily-Cybersecurity-7B-v0.2](https://huggingface.co/segolilylabs/Lily-Cybersecurity-7B-v0.2)
- [CONNECT AI LAB — 0원으로 시작하는 AI 1인 기업 EP.3 (RAG/파인튜닝 두뇌 학습 방식 참고)](https://www.youtube.com/watch?v=aIxgpOTxwwQ)
- [Connect AI Desktop 소스 저장소 (MIT 라이선스, 아키텍처 참고)](https://github.com/wonseokjung/connect-ai.git)
