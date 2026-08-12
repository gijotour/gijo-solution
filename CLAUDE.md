# GIJO AS — Claude Code 프로젝트 컨텍스트

한국형 온프렘 AI 보안관리 플랫폼. **Electron 클라이언트(client/) + Node/TypeScript 서버(server/) + 로컬 LLM(llama.cpp)**. 보안담당자가 취약점 스캐너 로그·보안로그·보안제품 리포트를 통합 분석·관제하는 제품(1차 목표). AI-BOM·온톨로지·레드팀/가드레일이 차별점.

## 작업 규칙 (사용자 확립 원칙 — 반드시 준수)
- **모든 개발·테스트는 `GIJO_AS_시장경쟁력_전중후_계획서.md` 기준으로 진행**(2026-07-29 사용자 지시). 새 작업을 받으면 전·중·후 어느 항목인지 확인하고 보고에 표기, 계획서에 없는 큰 작업은 계획서와의 관계를 먼저 물을 것. **테스트도 계획서 항목을 검증하는 방향으로**: 새 시험엔 해당 항목(전-N/중-N)을 주석으로 달고, 단계 통과 기준(전=4시나리오 시연, 중=평가 게이트 100~200문항·3축)이 QA·회귀 하네스의 확장 목표다. **단, 계획서가 틀렸거나 낡았다고 판단되면 맹종하지 말고 의견을 먼저 낼 것**(사용자 지시 — 근거와 함께, 결정은 사용자). 예약 루틴도 동일.
- **모든 사용자 대상 텍스트는 한글로.** 어려운 용어·작업엔 쉬운 풀이를 곁들일 것.
- **모든 명령은 이해한 범위를 먼저 확인받고 착수** (단순 관례 명령 "빌드해줘" 등만 예외).
- **UI 변경은 「추천 시안 1개」 먼저** (자체완결 HTML 목업) → 승인받고 구현. 곧바로 구현 금지. 화면별 시안은 mockups/ 아래 별도 폴더(파일명 `시안.html`).
  - 2026-08-09 사용자 결정으로 **3종 → 추천 1개**로 통일(그전 규칙·design 스킬·에이전트 정의가 서로 어긋나 있었다). 판단은 우리가 해서 하나를 내놓고 사용자는 승인/반려만 한다.
  - 시안에 반드시 붙일 것: **왜 이 안인지**(다른 길을 왜 안 골랐는지) · 무엇을 포기했는지 · **밀도 숫자**(줄 높이·세로 총합·기존 대비 증감) · 제품 원칙 자가점검. 사용자가 다른 방향을 원하면 **그때** 대안을 만든다.
- **설계 전 인터넷에서 표준·모범사례 조사** 후 근거 제시.
- **정직한 구현** — 가짜 UI 금지, 실제 end-to-end 검증 + 테스트. 테스트가 env를 덮어써서 제품 아닌 테스트를 검증하는 함정 주의. 폴백 문구가 나오면 FAIL로 취급.
- **로컬 커밋 자유 · GitHub push는 사용자가 요청할 때만.** (2머신 git 허브 `hub` remote push는 동기화용이라 자유.)
- **버전은 클라 X.Y.Z가 공식**(GIJO_AS_버전관리_기준.md, 2026-07-26 제정) — major=구조 개편(사용자 결정), minor=새 기능, patch=수정. 게시 순간에 확정, 서버는 번호 없이 커밋+마이그레이션으로 추적, 의존 시 서버 먼저 배포.
  - **게시·major 올림은 사용자 허락 근거를 게시 커밋 메시지에 남긴다**(2026-07-29 사후 검토에서 근거 없는 major·게시 발견 — 예약 루틴 포함 전 세션 공통). "기준에 따라"는 근거가 아니다 — 언제 어떤 지시였는지 적는다.
- **작업을 마치면 상대 머신(Mac)에 전달할 것이 있는지 보고, 있으면 인계 블록을 붙인다**(2026-08-09 사용자 지시). `/GIJOAS인계`를 부르지 않아도 **알아서** 판단해 붙일 것 — 형식은 `.claude/commands/GIJOAS인계.md`. 전달할 게 없으면 **"Mac 전달사항 없음"이라고 한 줄로 분명히** 적는다(빈칸은 「모른다」로 읽혀 아무도 안 하는 자리가 생긴다). 공용 파일(nav.js·screenguide.ts·agentloop.ts·routes.ts·CLAUDE.md)을 건드렸으면 반드시 주의사항에 적는다.
- 문서(가이드·PDF·Notion 등) 갱신은 요청받을 때만.
- **업무 마무리 보고에는 📖 용어 풀이를 따로 붙인다**(2026-07-27 사용자 지시). 새 용어가 생기면 `GIJO_AS_용어사전.md`에 그때 바로 추가 — 이 파일은 계속 갱신하는 문서다(요청 없이도 갱신 대상인 유일한 예외).
- **화면 설명·기능 안내는 전부 챗봇(서버 screenguide panels + ⓘ gijo-info)으로.** 화면엔 정체성 한 줄과 ⚠경고만 둔다 — 사용법·주의사항·용어 풀이는 screenguide에 쓰고 ⓘ로 연다. **신규 작업은 무조건 이 방식, 기존 화면도 발견하는 대로 이관**(2026-07-25 사용자 지시 강화).

## 기계 이름 — `win` · `max` · `gb10` (2026-08-12 사용자 결정)
기계는 **이 세 이름으로만** 부른다. "윈도우"·"맥"은 **고객 OS**를 가리킬 때만 쓴다(라이트 에디션 「윈도우/맥 설치 가이드」가 그 예).

| 이름 | 기계 | VPN | 맡은 일 |
|---|---|---|---|
| `win` | Windows PC (desktop-4qplvnc) | `10.8.0.1` | 주 개발 · **운영 서버(WSL 4000)** · **git 허브**(`D:\gijo-hub.git`) · WireGuard 서버 · 클라 게시 |
| `max` | M1 Max 32GB (GIJOHNMAC, arm64) | `10.8.0.11` | `max` 개발 · 올인원(서버+Metal LLM) 빌드·검증 |
| `gb10` | NVIDIA GB10 / DGX Spark (`gijohn_llm`) | `10.8.0.12` | ARM CUDA 실측 — **준비 중**(2026-08-12: 4000·22 닫힘) |

⚠ 왜 나눴나: "윈도우 클라이언트에서 계정을 만드세요"가 *어느 기계냐*로 안 읽혀 실제로 헷갈렸다(2026-08-12 QA 계정 건).
⚠ 사람에게 안내할 때 **기계 이름을 먼저** 적는다 — "`win`에서 …", "`max`에서 …". 자세한 건 `GIJO_AS_2머신_개발환경_가이드.md` §0.

### 제품 분담 — **라이트는 `max`, 메인 제품은 `win`** (2026-08-13 사용자 결정)
- **`max` = 라이트 에디션 전담**: 라이트 화면 9개 · `lite-*` 파일 · `lite-screens.json`/`lite-tools.json` · 라이트 게이트(`tools/lite-gate.mjs`·`lite-routing.json`) · 라이트 빌드(dmg·`electron-builder.lite.json`).
- **`win` = 메인 제품 전담**: 계획서 전·중·후 항목 · 공용 엔진 · 운영 배포 · 게시 · QA.
- ⚠ **경계는 공용 파일에서 겹친다** — 라이트 결함의 뿌리가 공용 파일(`main.ts`·`agentloop.ts`·`dispatcher.ts`·`lawinfo.ts`·`registry.ts`)인 경우가 실제로 반복됐다(2026-08-13: 라이트 진입점·법령 77%·중복문서 어순 셋 다). **뿌리가 공용이면 `win`이 고친다** — 라이트에서 발견해도 그렇다. `max`는 발견·재현·패치안까지 내고 인계한다(그 방식이 실제로 잘 돌았다).
- ⚠ 라이트에서 나온 결함을 **「라이트 문제」로 닫지 말 것.** 위 셋 다 메인 제품에도 있던 결함이었다.

## 구조 요약
- `client/` — Electron. 화면=src/renderer/pages/*.html (**app.html이 탭 셸** — 각 화면을 `?embed=1` iframe으로 품는다(#tabBar·#screens). ⚠ hub.html은 삭제된 화면이다, nav.js 공용 사이드바). 빌드 `npm run dist`, 게시 `npm run publish-release`(서버 자체가 배포처).
- `server/` — Express+TS. 엔진=src/engine/*.ts. DB=data/gijo-as.sqlite(better-sqlite3), RAG=data/memory.lancedb(LanceDB)+bge-m3 임베딩, 모델=models/<id>/<id>.gguf. 테스트 `npm test`(vitest, 900+개 — 실 LLM 스폰 안 함).
- `server/src/engine/localengine.ts` — llama-server 프로세스 풀(VRAM 예산·LRU 스왑). 임베딩은 8081 별도 상주.
- 운영: Windows PC의 WSL2 systemd(gijo-as.service, /home/gijo/gijo-as/server, 포트 4000).

## 공용 슬래시 명령 (.claude/commands/ — 세 머신 공통, 워크플로 표준)
- `/GIJOAS동기화` — 작업 시작 전 hub 최신 받기(ff-only, 충돌 안내 포함)
- `/GIJOAS인계` — 작업 마무리: 커밋→(서버 변경 시)테스트→hub push→**(서버/도구 변경 시 `win`은 `git push gb10 main`)**→**상대 머신 인계 블록 출력**
- `/GIJOAS배포` — 운영(WSL) 배포. `win`=단계별 직접 수행, `max`=ssh 한 줄 안내 또는 인계
- `/GIJOAS게시` — 클라 빌드·게시. **`win` 전용**(claude-deploy 계정, 실화면 검증 필수)
- `/GIJOAS서버시작` — `max`=개발 서버 빌드·기동·health / `win`=운영(WSL) 상태확인·재시작(사용자 확인 후)
- `/GIJOAS클라시작` — 클라 빌드 후 Electron 개발 실행(CDP 9223 기본, electron.exe 직접 실행)
역할 고정: 게시(클라 빌드)는 **`win` 전용**(electron-builder·claude-deploy·실화면 검증이 묶임). GitHub(origin)는 사용자 요청 시만 — **단, `hub`가 없는 머신(외부 협업자)은 origin이 유일한 통로라 이 제한이 적용되지 않는다.**

## 공동작업 (사장님 ↔ 제임스, 2026-08-09 결정) — `GIJO_AS_공동작업_가이드.md`
- **main 직접 push 금지 · 브랜치 + PR 필수**(양쪽 다). 자기 PR을 자기가 병합하지 않는다.
  이유: 같은 날 커밋이 두 번 끼어들고 편집 중이던 screenguide.ts가 남의 커밋에 실렸다.
- **제임스는 운영 서버(WSL 4000)·운영 데이터에 접근하지 않는다** — Mac mini M4 24GB에 독립 구축
  (`GIJO_AS_MAC_M4_24GB_구성안.md`). 계정당 1세션·직렬 자원이라 공유하면 서로 깨뜨린다.
- **제임스 작업은 우리 M1 Max Mac에서 확인 후 병합**하고, **운영 배포도 우리 Mac에서 트리거**한다
  (ssh → deploy-prod.ps1). 게시만 Windows.
- 공용 파일(nav.js·screenguide.ts·agentloop.ts·routes.ts·CLAUDE.md)은 손대기 전 알리고, 작게 올려 바로 병합.

## 서브에이전트 역할 분담 (.claude/agents/ — 세 머신 공통, 2026-07-29 확정 · 2026-08-11 재검토 유지)
| 역할 | 권한 | 맡기는 일 |
|---|---|---|
| **메인(총괄)** | 전부 | 코드 구현 · 커밋/hub push · 실앱 검증 · 서버 배포 · 게시 · QA — **직렬 자원 전부 + 최종 판단** |
| `gijo-scout`(정찰) | 읽기 전용 | 영향범위 전수 수색 · 설계 전 표준 조사 · 문서↔코드 대조 |
| `gijo-reviewer`(검토) | 읽기 + git 조회 | 커밋·변경 묶음 결함 검토 — 특히 **예약 루틴 커밋 사후 검토**, 게시 전 검토 |
| `gijo-mockup`(시안) | mockups/ 전용 쓰기 | UI 시안(자체완결 HTML) 제작 — 추천 1개 원칙, 제품 코드 수정 금지 |
- **검증·배포·게시·QA는 어떤 에이전트에도 위임 금지** — 운영 서버(4000)·CDP(9223)·로그인 세션(계정당 1개)이 직렬 자원이라 병렬 실행이 서로를 깨뜨린다(2026-07-28 실측). 이 일들은 메인이 순서대로 수행.
- 서브 산출물은 **보고까지만** — 반영(수정·커밋)은 메인이 검토 후 수행. 에이전트 정의는 세션 시작 때 읽힘(추가·수정 후 다음 세션부터 인식).
- ⚠ **외부 다중에이전트 프레임워크(bkit 등)를 얹지 않는다**(2026-08-11 검토·기각). 그쪽 핵심이 프론트·백엔드·QA **병렬 실행**인데 우리 직렬 자원(4000·9229·CDP·계정 1세션)과 정면충돌하고, PDCA·품질게이트는 우리에게 이미 **전중후 계획서 + 시안 1개 + 평가게이트 + QA전수조사 + guidance-check/falseclaim**으로 있다. 둘을 함께 두면 「같은 것을 여러 곳에 적으면 어긋난다」가 방법론 층에서 재발한다. 써볼 땐 **빈 연습 저장소에서 격리 시험**.

## 자율성 단계 — 어디까지 스스로 하고 어디서 멈추나 (2026-08-11 명문화)
> 지금까지 글로 흩어져 있던 것을 표로 모은 것이다. 새 규칙이 아니라 **같은 규칙의 단일 출처**다.
> 예약 루틴·서브에이전트에도 그대로 적용된다.

| 단계 | 무엇 | 예 |
|---|---|---|
| **바로 한다** | 읽기·조사·측정(운영 데이터 안 바꾸는)·시험 실행·로컬 커밋·hub/gb10 push | grep·시험·`wsl-test.sh`·상태 확인 |
| **하고 보고한다** | 되돌리기 쉽고 내 작업 범위 안인 상태 변경 | 홈 디렉터리 설치(Node·chromium)·ssh config·scratchpad |
| **이해한 범위를 먼저 확인받는다** | 코드 구현 전반(관례 명령 "빌드해줘" 등은 예외) | 기능 추가·리팩터·공용 파일 수정 |
| **승인 없이는 안 한다** | UI 변경(시안 1개 먼저) · 게시(dist·publish-release) · 운영 배포·서버 재시작 · GitHub(origin) push · major 올림 · 계획서에 없는 큰 작업 | — |
| **절대 안 한다** | 미커밋 변경을 `git checkout`으로 날리기 · 남의 대역 스캔 · 측정 중 같은 계정 중복 로그인 · 예약 루틴이 코드 수정·배포 | — |

## 환경별 역할 — **무엇을 어디서 재는가** (2026-08-10 확립, 실사고 기반)
> **제품이 도는 환경에서 잰다.** 편집하는 곳에서 재면 딴 환경을 검증하게 된다.

| 무엇 | 어디서 | 왜 |
|---|---|---|
| **서버 시험**(`server/test`) | **WSL** — `bash tools/wsl-test.sh` | 제품이 WSL에서 돈다. 실측: Windows 14분/파일(전체는 못 끝냄) vs **WSL 27초/2,979개** |
| 서버 배포·의존성 확인 | WSL | `scripts/check-python-deps.mjs`를 **돌아갈 환경에서** |
| 클라 빌드·게시·실화면 | **Windows**(exe) / Mac(dmg) | electron-builder·CDP가 거기 묶여 있다 |
| `git ls-files`·이미지가 필요한 시험 | Windows 호스트 | WSL 사본은 git 저장소가 아니고 이미지를 안 가져간다 |
| **ARM CUDA 빌드·실측**(llama.cpp `sm_121a`·네이티브 부품·통합메모리 티어) | **GB10** — `ssh gb10` | Pro/올인원이 실제로 돌 곳이 그 맨바닥이다. x86 CUDA·Metal에서는 원리상 못 잰다 |

- ⚠ **서버 시험을 Windows에서 돌리지 말 것.** 느린 게 문제가 아니라 **딴 환경을 재는 것**이 문제다.
  실사고(2026-08-09~10): Windows의 `python3`은 **0바이트 껍데기**라 「제품 결함」으로 오판했고,
  운영에 `pypdf`·`netmiko`가 없어 PDF 추출·장비 접속이 죽어 있던 것을 Windows 시험은 **원리상 못 잡았다.**
  게이트가 너무 느려 **통과 못 한 채 배포를 밀어야 했던** 날도 있었다 — 없는 게이트와 같았다.
- ⚠ **저장소를 환경별로 나누지 않는다**(2026-08-10 검토·기각). 환경 분기가 있는 파일은
  188개 중 **8개(4%)**뿐이고 96%는 세 환경이 같은 코드다. 나누면 같은 수리를 세 벌 해야 하고,
  하나 빠뜨리면 **한 환경에서만 나는 결함**이 생긴다 — 이 저장소가 반복해 겪은
  「같은 것을 여러 곳에 적으면 어긋난다」가 구조가 된다. 대신 **차이를 드러내는 기계**를 둔다
  (check-python-deps · pythondeps.test · wsl-test).
  단, Mac/Windows 에디션이 **다른 제품**이 되거나 릴리스가 갈리면 그때 다시 판단한다.

## 3머신 개발환경 (Windows ↔ M1 Max ↔ GB10) — GIJO_AS_2머신_개발환경_가이드.md
- Windows(desktop-4qplvnc)=주개발·윈도우 클라 테스트·운영 WSL·git 허브(D:\gijo-hub.git)·WireGuard 서버(10.8.0.1).
- Mac(M1 Max 32GB)=mac 올인원(서버+Metal LLM) 개발·검증. VPN=client-mac.conf(10.8.0.11). 코드는 GitHub 또는 `ssh://user@10.8.0.1/d:/gijo-hub.git`.
- **GB10(NVIDIA DGX Spark · ARM CUDA)=Pro/올인원 타깃 실측**(2026-08-11 편입). `ssh gb10`(10.8.0.12·계정 gijohn_llm). 상세는 아래 「GB10」 절.
- 대용량(models/·data/)은 **시점 복사**(scp)만 — 실시간 동기화·양쪽 동시 사용 금지(DB 분기·깨짐). 원본은 WSL 운영.
- **git 방향이 머신마다 다르다**: Mac은 hub에서 **당겨간다**(pull). GB10은 **Windows가 밀어넣는다**(push) — Windows sshd가 관리자 계정이라 GB10의 키를 `administrators_authorized_keys`에 넣으려면 권한 승격이 필요해서, 방향을 뒤집었다.

## GB10 (ARM CUDA) — 무엇을 어떻게 (2026-08-11 편입)
- **다음 차례 (2026-08-13 사용자 지시로 명시)** — 그 전까지는 push 수신만 하고 놀려 둔다(풀스택 상주 불필요):
  1. **라이트 출하 결정(ⓐⓑⓒ) 후** — 라이트 이미지의 **ARM 검증**(설치→기동→예열→답, 전-7 하드웨어 갈래).
  2. **티어표 재검토 때** — **72B·통합메모리 121GB 티어 실측**(모델은 이미 가 있다: qwen2.5-72b 포함 56GB).
  3. 상시 역할(계획서 전-7): 「운영을 멈추지 않고 A/B·레드팀을 돌리는 검증 기계」 — 속도가 아니라 **용량**이 값어치다(3090 대비 3.1배 느림, 대역폭 273 vs 936GB/s).
  ⚠ **라이트(전용 VRAM 8~10GB) 측정은 gb10에서 하지 않는다** — 통합메모리라 RSS·nvidia-smi 둘 다 틀린 자다(2026-08-13 실측: 5.4GB 모델이 RSS 0.73GiB). 그 측정은 3090(win)이 맡는다.
- **붙기**: `ssh gb10`(별칭 등록됨). ⚠ 내부망 192.168.219.66은 GB10 자기 공유기 안쪽이라 **이 PC에서 안 닿는다** — 통로는 WireGuard뿐. RTT 70~106ms라 **대용량 복사는 느리다**.
- **코드 전달**: Windows에서 `git push gb10 main`. GB10 쪽 `receive.denyCurrentBranch=updateInstead`라 push하면 **작업트리까지 갱신**된다(GB10에서 pull 불필요).
  ⚠ **Mac에서 GB10에 직접 밀지 말 것** — 두 곳에서 밀면 작업트리가 엉킨다. GB10 반영은 Windows 담당.
- **환경**: 저장소 `~/gijo-as` · Node는 홈 tarball(`~/.local/opt/node`) · CUDA 13.0. **비대화형 ssh는 `.bashrc`를 안 읽으니 원격 명령마다 `. ~/gijo-env.sh` 먼저** 붙일 것.
- **llama.cpp**: `-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121`(cmake가 `121a`로 올려 잡음). Windows와 **같은 판본**으로 맞춰야 실측을 비교할 수 있다.
- ⚠ **nvidia-smi가 GPU 메모리를 `[N/A]`로 준다**(통합메모리·드라이버 차원 — 컨테이너 안에서도 같다). 판정은 `server/src/util/unifiedmem.ts` **한 곳**에서 받는다. 새로 nvidia-smi로 메모리를 읽는 코드를 쓰면 `server/test/unifiedmem.test.ts`의 소스 감시가 실패한다. **CUDA 런타임 API(llama.cpp `--list-devices`)는 정확히 보고한다** — 더 정밀한 값이 필요하면 그 경로.
- ⚠ **npm 11.17+ allow-scripts 함정**: `npm ci`가 몇 초에 끝나고 「install scripts not yet covered by allowScripts」를 경고한다. **시간도 파일 존재도 증거가 아니다** — 네이티브 부품은 **불러서 기능까지** 확인할 것(모듈 확인 스크립트는 반드시 `server/` **안에서** 실행 — node가 스크립트 위치 기준으로 node_modules를 찾는다). 라이트 이미지 굽기·운영 배포에서 이 관문을 다시 만난다.
- ⚠ **도커로 배포하지 않는다**(2026-08-11 판단). Docker 29.2.1 + NVIDIA Container Toolkit이 깔려 있고 GPU는 CDI(`--device nvidia.com/gpu=all`)로 붙지만, 라이트 배포는 WSL 이미지로 정해져 있고(고객 PC에 Docker Desktop을 얹는 건 「클라만 받아도 혼자」와 반대), 「제품이 도는 환경에서 잰다」에도 어긋난다. 도커는 **재현 검증·다른 CUDA 판본 시험** 용도로만.

## Mac에서의 주 임무 (Phase 2) — GIJO_AS_MAC_올인원_배포_가이드.md
1. llama.cpp Metal 빌드(`cmake -B build -DGGML_METAL=ON`) → `llama.cpp/build/bin/llama-server` (경로 util/llamabin.ts가 darwin 자동 해석, `-ngl -1` Metal 동작)
2. `client/`에서 `npm run dist` → arm64 dmg (서명 없음 — 자가사용, 첫 실행 우클릭→열기)
3. 데이터 이식: `server/scripts/migrate-data-to-mac.mjs` export/verify — data/+models/ 복사가 전부(bge 벡터는 LanceDB에 있어 재인입 불필요)
4. 실측: preflight(GPU=Apple Metal pass) → 임베딩·채팅 모델 로드 → tok/s → RAG 히트 → 티어 API("Apple Metal · 통합메모리 32GB", M1 Max=2모델 티어 예상)
- Phase 1(크로스플랫폼 분기: localengine·preflight·build-server-dist·package.json mac 타깃)은 완료 상태(2026-07-24).

## 주의·함정 (실사고 기반)
- ~~`client/server-dist/package.json`은 추적 산출물 — 빌드 후 `git checkout`으로 되돌려 clean 유지.~~ **2026-08-13 폐지** — 추적을 끊었다(`client/.gitignore`). `build-server-dist.mjs:39-40`이 `server/`의 같은 파일을 그대로 복사하는 **사본**이라 담는 정보가 0인데 실제로 어긋나 있었다(커밋 0.1.0 vs server 2.1.0). 이제 빌드해도 트리가 안 더러워지므로 **되돌릴 일이 없다.**
- 한글 HTTP 검증에 curl 쓰지 말 것(깨짐) — Node fetch로. 한글 파일 조작은 perl 대신 Node. `PYTHONUTF8=1`.
- 7B 모델에 프롬프트 규칙을 더해 행동 교정하려 하지 말 것 — 코드로 해결(반복 실패 사례 있음).
- **강제 규칙(FORCED_INTENTS)을 배열 중간에 넣으면 routes.ts 표가 통째로 어긋난다**(자리 번호로 가리키기 때문). 넣은 뒤 `node tools/routes-renumber.mjs --write` — 손으로 세지 말 것(2026-08-10 실사고: 18줄이 밀렸고, route-explain이 엉뚱한 정규식을 읽어 **거짓 겹침 경보**까지 냈다).
- 에이전트 모델 미배정은 조용히 기본모델 폴백 — app_state 직접 확인.
- 임베딩 llama-server는 ctx/batch/ubatch 8192 명시 필수(512 초과 한글 입력 HTTP500 사고).
- 운영(WSL) 서버는 watcher 없음 — 코드 갱신 후 프로세스 kill로 재시작(Restart=always). 단 전 사용자 세션 끊김.
- Windows 게시·앱테스트용 계정: `claude-deploy`(admin). 비밀번호는 Windows 사용자 환경변수 GIJO_ADMIN_PASSWORD에 저장(repo에 기록 금지). 게시는 `--force`(자기 세션만 교체).
