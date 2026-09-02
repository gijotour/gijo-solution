# 설치·배포·머신 환경 — Windows/WSL/Mac/GB10

> **통합본** — 문서통합 워크플로(2026-09-02)가 루트 md 143개를 통독해 만든 「지금 사실」 정리본.
> 기준: 코드가 진실(클라 5.83.0 · hub/main 29919788). 문장마다 (출처 파일:줄).
> **원문 대조 완료** — 검증관이 출처를 실제로 열어 확인했고, 근거 없는 문장은 고치거나 뺐다 (대조 문장 61개).
>
> **대조에서 걸러 낸 것 15건**:
> - 게시 커밋 날짜가 다르다 — 통합본 머리말은 `29919788 클라 5.83.0 게시`를 「2026-09-01~02」로 적었으나, `git log`가 주는 커밋 날짜는 **2026-09-02**다(`29919788 2026-09-02 클라 5.83.0 게시 — 🌐 외부지원 명패 · 클라우드 학습 고지 · 분할 GGUF · EOL 유상연장`). 「~02」로 흐리지 않고 2026-09-02로 못박았다.
> - §3 게시 채널 에디션 분리의 출처 줄이 틀렸다 — `server/src/engine/clientrelease.ts:124`는 파일 이름을 만드는 줄(`const filename = 에디션 === "lite" ? …`)이다. 「안 붙이면 프로 채널로 올라간다」의 실제 근거는 :112(`const 에디션 = edition === "lite" ? "lite" : "pro"`)와 :217(`const edition = req.query.edition === "lite" ? "lite" : "pro"`)이다. 마이그레이션 :50은 맞다.
> - §4 라이트 화면 축소의 출처 줄이 틀렸다 — 「2026-08-22에 메뉴가 크게 줄었습니다 … 「AI에게 물어보기」·「내 문서」 둘 + ⚙ 설정 … 고장이 아닙니다」는 `GIJO_AS_Lite_설치안내서_2026-08-13.md:120~124`다. 통합본이 적은 :123~130은 그 인용문 뒷부분과 「챗 모델 등록」 절차가 섞인 범위다.
> - §4 CUDA 동봉 575MB의 출처 줄이 한 줄 밀렸다 — `tools/stage-llama-cuda.mjs`의 「실제 동봉은 약 575MB다」는 :8~10(:9가 그 문장)이고, :11은 `import fs`다. :9~11이 아니라 :8~10.
> - §4 라이트 챗 모델 미동봉의 출처 줄이 밀렸다 — `server/src/lite/env.ts`에서 「★ **챗 모델은 더 이상 동봉하지 않는다**(사장님 결정 2026-08-13). 고객이 등록한다」는 :18~20이다(:21은 빈 주석, :22는 모델 폴더 얘기). :19~22가 아니라 :18~20.
> - §1 라이트 서버 직접 기동 갈래의 출처 줄이 어긋난다 — 「그 길이 4000으로 뜨면 「제품이 가는 길이 아닌 것」을 재게 된다」는 `server/src/lite/env.ts:94`이고, :90~93은 그 앞의 「max가 일부러 안 켜 두었다」 설명이다. :89~94로 고쳤다.
> - §7 원격 GPU 토큰의 출처 줄 하나가 어긋난다 — `server/src/engine/llmserve.ts:53`은 **옛 라이트(1.1.1) 호환용** 쿼리 토큰 파서(`const q = req.query.token`)이지 「붙는 쪽이 제시해야 통과한다」의 근거가 아니다. 토큰 도입 근거는 :24~27(2026-08-16), 토큰 없는 켜짐을 막는 판정은 :128~131(`return c.enabled && Boolean(c.token)`)이다.
> - §8 v2.1.0 설치본 155MB의 줄 번호가 틀렸다 — `GIJO_AS_설치_가이드_v2.1.0.md:4`에는 기본 모델과 설치본 **이름**만 있고 「155MB」는 :15(용량 표)와 :44(폴더 그림)에 있다. 「WSL2 이관 예정」도 :4가 아니라 :121이다.
> - §8 PC세팅 체크리스트의 「Windows 네이티브로 상주(:190)」는 원문에 없는 말이다 — :188~190은 `cd C:\GIJO-AS\server` / `npm install` / `npm run start`(직접 기동)이고, 그 문서 전체에 「상주」·「서비스」·「nssm」·「스케줄러」가 **0건**이다. 「상주」를 빼고 「Windows 네이티브에서 직접 기동」으로 고쳤다.
> - §8 WSL2 서버이전 계획서를 「절차는 배포 가이드 §3.7이 현행본」이라고만 적으면 어긋난다 — `GIJO_AS_배포_가이드.md:145`가 지금도 「배경·전체 절차는 `GIJO_AS_WSL2_서버이전_계획서.md` 참조」라고 그 문서를 가리킨다. 폐기 문서가 아니라 **현행 가이드가 참조처로 걸어 둔 배경 문서**라고 고쳤다.
> - §8 폰 원격작업 가이드의 「미채택」은 출처가 없다 — 그 문서 :5는 「이 문서를 쓴 세션은 클라우드라 GB10에서 실행·검증하지 못했다」(미검증)까지만 적고, 채택·기각을 적은 자리는 그 문서에도 CLAUDE.md에도 못 찾았다. 「미검증」만 남기고 「실제로 쓰는 통로는 `ssh gb10`」은 사실 진술로 분리했다.
> - §5 Mac QA 3계층 요약의 출처 줄이 부분만 가리킨다 — `GIJO_AS_MAC_QA_계획.md:73~80`은 **L1만** 다루는 절이다. L0=:63, L1=:73, L2=:85이고 3계층 요약 한 줄은 :178(「L0 자동(`qa-mac.mjs`) → L1 CDP → L2 육안」)이다.
>
> **결정이 필요한 것 7건**:
> - `max`의 역할이 문서끼리 다르다 — GIJO_AS_2머신_개발환경_가이드.md:20·25~28은 「대기 — 제품 완성 후 macOS QA, 그전까지 제품 코드를 만들지 않는다」(2026-08-12 결정)인데, CLAUDE.md:41은 「max 개발·올인원 빌드·검증」, CLAUDE.md:52~54는 「작업은 전부 win 주도, max는 검증」(2026-08-20 개정)이다. 어느 문장을 남길지는 사용자 결정.
> - 운영 배포 트리거의 주체가 둘이다 — GIJO_AS_공동작업_가이드.md:21·106~107은 「우리 Mac(M1 Max)에서 ssh로 deploy-prod.ps1 트리거」인데, CLAUDE.md:52~53(작업 전부 win 주도)·CLAUDE.md:21(2026-08-22 Mac 인계 보류)과 어긋난다. 제임스 공동작업이 진행 중인지부터 확인이 필요하다.
> - `max`의 VPN 설정 파일 이름이 다르다 — GIJO_AS_2머신_개발환경_가이드.md:56은 `client-예비.conf` 재사용, GIJO_AS_개발환경_가이드라인.md:66과 CLAUDE.md:138은 `client-mac.conf`다. 기계에서 실제 프로파일 이름을 재서 하나로 맞출 것.
> - 라이트 Windows 설치본(1,616MB)을 게시 채널로 올릴 수 없다 — server/src/engine/clientrelease.ts:212의 500MB 한계와 3.2배 차(GIJO_AS_MAC_인계_대기.md:159~160). 스트리밍 업로드·짐 덜기·채널 밖 전달 중 무엇으로 갈지 결정이 필요하다.
> - `tools/stage-llama-cuda.mjs`가 어떤 빌드 스크립트에도 연결돼 있지 않다 — client/package.json의 `dist:lite`(13줄)는 stage-python만 부르는데 electron-builder.lite.json:39는 `build/llama-cuda`를 동봉 대상으로 요구한다. 손으로 먼저 돌리는 것이 전제라면 그 절차를 문서(또는 npm 스크립트)에 박아야 한다.
> - GB10 문서의 「현재 상태」가 낡았다 — GIJO_AS_GB10_VPN_자산점검_구성안.md:176~182는 GB10 피어의 allowed ips가 `10.8.0.1/32`라 「GB10↔Mac 직접 통신 불가」로 적었는데, GIJO_AS_원격GPU_사용안내.md:71은 2026-08-14에 대역을 넓히고 서버 포워딩을 켠 실사고 수리를 기록한다. 어느 쪽이 지금 값인지 기계에서 재서 그 절을 고칠지 결정이 필요하다.
> - `GIJO_AS_개발환경_테스트_매뉴얼.md:34`의 claude-deploy 평문 비밀번호 — 문서에서 지우는 것만으로는 git 이력에 남는다. 값 교체(사용자 조치)와 문서 폐기 여부를 정해야 한다.

---

# 설치·배포·머신 환경 — 지금 사실 (2026-09-02 기준)

> 코드가 진실이다. 아래 문장은 전부 `D:/Connect AI` 원문과 코드를 다시 읽어 남긴 것이고, 어긋난 자리는 그대로 적었다.
> 클라 공식 버전은 **5.83.0**(client/package.json:4), 마지막 게시 커밋 `29919788 클라 5.83.0 게시`(git 커밋 날짜 **2026-09-02**).

## 1. 어디서 도는가 — 모드와 포트

- 배포 모드는 둘이다: **분산 모드**(GPU 서버 1대 + 데스크톱 N대, 권장·표준)와 **단독 모드**(설치본에 서버 번들). `GIJO_SERVER_URL`을 지정하면 번들 서버를 안 띄우고 원격에 붙는다 (GIJO_AS_배포_가이드.md:10~16).
- **라이트 에디션은 항상 단독 모드**, 표준·프로는 선택이다 (GIJO_AS_배포_가이드.md:20).
- 포트의 단일 출처는 클라의 `서버포트()`다 — **라이트 7445 · 스탠다드/프로 7446**(client/src/main.ts:50~53, 사장님 지시 2026-08-13; 「포트는 서버포트() 한 곳에서 온다」 같은 파일 324줄). 프로는 별도 빌드가 아니라 스탠다드의 런타임 티어라 포트를 가르지 않는다(같은 파일 41~46줄).
- 서버 자체의 기본 포트는 여전히 **4000**이고(server/src/index.ts:45), **운영(WSL2) 서버가 그 4000**이다(CLAUDE.md:63). 즉 「4000 = 사내 운영 서버」, 「7445/7446 = 앱이 자기 PC에서 띄우는 번들 서버」로 갈렸다.
- 라이트 서버를 직접 띄우는 길도 7445로 뜬다(server/src/lite/env.ts:95) — 그 길이 4000으로 뜨면 「제품이 가는 길이 아닌 것」을 재게 된다(같은 파일 89~94줄).
- ⚠ 배포 문서 두 편의 머리말 버전은 낡았다: **v2.3.0(2026-07-20)**(GIJO_AS_배포_가이드.md:1·315), **v2.5.0(2026-07-21)**(GIJO_AS_클라이언트_배포_가이드.md:1·166). 본문 일부(§1-1 문서 추출)는 2026-08-22에 갱신됐다.

## 2. 서버 설치·운영 — WSL2가 정본

- 운영은 **Windows PC의 WSL2 systemd**(`gijo-as.service`, `/home/gijo/gijo-as/server`, 포트 4000)다(CLAUDE.md:63). 절차 전체는 GIJO_AS_배포_가이드.md:141~244(WSL 환경·CUDA toolkit·llama.cpp CUDA 빌드·systemd 유닛·네트워킹·롤백).
- **모델과 DB는 반드시 WSL ext4 내부에** 둔다 — `/mnt/d/...`는 9p 경계라 수 배 느리다(GIJO_AS_배포_가이드.md:176).
- DB 이관은 파일 복사가 아니라 **온라인 백업 API**로 한다(GIJO_AS_배포_가이드.md:187~191).
- systemd 유닛은 venv를 PATH 앞에 두어 `spawn("python")`이 venv를 잡게 하는 것이 핵심(GIJO_AS_배포_가이드.md:194~207).
- 분산 모드 네트워킹은 `.wslconfig`의 **mirrored** 권장, 구버전은 portproxy(GIJO_AS_배포_가이드.md:235~236).
- 코드 갱신 배포 두 길:
  - `server/scripts/deploy.sh` — 변경 `.ts`만, `diff --strip-trailing-cr`로 CRLF 흡수, `tsc` 실패 시 재시작 안 함, health 폴링(GIJO_AS_배포_가이드.md:213~233; 파일 실재).
  - `tools/deploy-prod.ps1` — **hub pull(ff-only) → 서버 테스트 전체(실패 시 중단) → WSL 동기화·빌드 → kill 재시작 → health**(tools/deploy-prod.ps1:1~8). 슬래시 명령 `/GIJOAS배포`가 이 길을 쓴다(CLAUDE.md:68).
- ⚠ **재시작하면 접속 세션이 전부 끊긴다**(refresh 토큰이 인메모리) — 근무 시간대엔 접속자 확인 후(GIJO_AS_배포_가이드.md:231, CLAUDE.md:172).
- 운영 필수 환경변수: `NODE_ENV=production` + `GIJO_JWT_SECRET`(미설정이면 기동 거부), 초기 관리자 `GIJO_INITIAL_ADMIN_PASSWORD`, TLS 둘 다 지정 시 HTTPS, 로그인 실패 10회 초과 시 15분 잠금(GIJO_AS_배포_가이드.md:96~112).
- 초기 관리자 규칙은 코드와 일치한다 — production이거나 env 비번이 있으면 `admin` + env 비번(없으면 랜덤 1회 출력), 아니면 개발용 `jyh`/`changeme`(server/src/auth/users.ts:170~176; GIJO_AS_배포_가이드.md:127~132).
- 설치 후 자가 진단 `GET /api/admin/preflight`는 **9항목**이다 — Node.js·GPU·llama-server·로컬 모델·JWT 시크릿·기본 관리자 비밀번호·저장 암호화·개발 모드·데이터 저장소(server/src/engine/preflight.ts:47~139). 문서가 **7종**만 적은 자리(GIJO_AS_배포_가이드.md:136 — 저장 암호화·개발 모드가 빠졌다)는 낡았다.
- llama.cpp 경로는 플랫폼 분기 헬퍼 한 곳에서 만든다 — Windows `build/bin/Release/*.exe`, 그 외 `build/bin/*`(server/src/util/llamabin.ts:9~12).
- 기본 채팅 모델은 **qwen3-14b**다(server/src/engine/localengine.ts:41). 예전엔 Lily-Cybersecurity-7B(GIJO_AS_PC세팅_체크리스트.md:125), 그 뒤 gijo-main-orchestrator 7.6B(GIJO_AS_설치_가이드_v2.1.0.md:4)였다.
- 구동 등급(코드 정본): Lite 10GB급·1개·ctx 8192 / Standard 24GB급·1개·32K / Pro 48GB급·2개·32K(**지금은 스탠다드와 엔진 동작이 같다**) / Max는 예정(server/src/engine/localengine.ts:127~144).

## 3. 클라이언트 설치·게시

- 설치는 **사용자 단위·관리자 권한 불필요**(GIJO_AS_클라이언트_배포_가이드.md:39; client/package.json:90 `perMachine:false`). 경로는 프로그램 `%LOCALAPPDATA%\Programs\gijo-as-client`, 설정 `%APPDATA%\GIJO AS`(GIJO_AS_클라이언트_배포_가이드.md:123~124; package.json:2 `gijo-as-client`).
- 업그레이드는 덮어쓰기, 앱이 켜져 있어도 설치 프로그램이 감지·종료하며 `/S` 사일런트 지원(GIJO_AS_클라이언트_배포_가이드.md:74~91).
- **인앱 자동 업데이트의 배포처는 외부 서비스가 아니라 접속 중인 GIJO AS 서버 자신**이다(GIJO_AS_클라이언트_배포_가이드.md:95). 원격 일괄은 `client/scripts/manual-update.ps1`(sha256 대조 후에만 실행, `-CheckOnly`·`-ForceLogin`)(같은 문서 105~117; 파일 실재).
- 빌드 파이프라인: `dist` = build → **stage-python** → build-server-dist → license-gate → electron-builder (client/package.json:12), 라이트는 `dist:lite`(같은 파일 13)가 `electron-builder.lite.json`을 쓴다.
- **첫 실행은 로그인이 아니라 「관리자 계정 만들기」(setup.html)** 다(client/src/main.ts:393; GIJO_AS_MAC_올인원_배포_가이드.md:59~65). 기본 비밀번호는 없다.
- 고객 데이터는 앱 번들 안이 아니라 **userData**(`~/Library/Application Support/GIJO AS/`)에 쌓인다 — 번들 안에 두면 업데이트에 사라지고 서명 봉인이 깨진다(GIJO_AS_MAC_올인원_배포_가이드.md:50~56).
- mac은 `identity:null`(client/package.json:83)에 **afterSign ad-hoc 재서명이 필수**다(package.json:95 `build/mac-adhoc-sign.cjs`) — 재서명을 건너뛰면 macOS 26이 첫 실행에 앱을 삭제한다(GIJO_AS_MAC_올인원_배포_가이드.md:8~16). 공증은 선택이라 첫 실행 「우클릭 → 열기」는 남는다.
- mac dmg는 **Mac에서만** 만든다(크로스빌드 불가)(GIJO_AS_MAC_올인원_배포_가이드.md:42).
- 게시(클라 빌드)는 **`win` 전용**이다(CLAUDE.md:69·72).
- 게시 채널이 **에디션별로 갈렸다**(마이그레이션 `client-releases-edition-2026-08-23`, server/src/engine/clientrelease.ts:50) — 라이트 게시는 `--edition lite`를 붙여야 하고, **안 붙이면 `"pro"`로 본다**(같은 파일 112·217; GIJO_AS_MAC_인계_대기.md:148·155).
- ⚠ **라이트 Windows 설치본은 지금 이 채널로 못 올린다** — 파일 1,616MB인데 서버 수신 한계가 500MB다(server/src/engine/clientrelease.ts:212 `express.raw … limit: "500mb"`; GIJO_AS_MAC_인계_대기.md:159~160).

## 4. 설치본에 무엇이 들어 있나 (동봉물)

- 문서 추출은 **에디션이 아니라 「서버가 어디서 도는가」로 갈린다**(GIJO_AS_배포_가이드.md:20). 오피스 4종(zip+xml)·PDF(unpdf)는 **서버가 직접** 읽어 파이썬이 필요 없고, **파이썬이 필요한 것은 스캔 문서·이미지(OCR)뿐**이다(같은 문서 22~39, 2026-08-22 전환).
- **Windows 설치본에는 파이썬 런타임이 동봉된다**(client/package.json:58~62 `build/python-dist` → `server-dist/python`; tools/stage-python.mjs:1~11, 2026-08-22 사장님 「b」 결정). mac 설치본에는 아직 없고 화면이 서버에 물어 정직하게 표시한다(GIJO_AS_배포_가이드.md:41~42).
- **PyMuPDF(AGPL-3.0)는 쓰지 않는다** — `pypdfium2`(BSD-3+Apache-2.0)로 대체(GIJO_AS_배포_가이드.md:45).
- 라이트 설치본은 **llama-server를 동봉**한다 — Windows는 `build/llama-cuda`, mac은 `build/llama-metal`, 그리고 **임베딩 bge-m3만** 함께 싣는다(client/electron-builder.lite.json:26~46·67~72). **챗 모델은 동봉하지 않고 고객이 등록**한다(server/src/lite/env.ts:18~20).
- 라이트 서버는 첫 실행 바닥값을 **ctx 8192 · 동시 모델 1개**로 박는다 — 등급 미지정 시 32K·2개로 떠 10GB 기계가 첫날부터 예산을 넘기던 실측 때문(server/src/lite/env.ts:73~85).
- 실측 용량: Windows `GIJO AS Lite Setup 1.4.0.exe` **1,616MB**(SHA256 대조 안내 포함)(GIJO_AS_Lite_설치안내서_2026-08-13.md:110~114), mac dmg 약 **1.3GB**(같은 문서 11). CUDA 동봉은 llama 자체가 아니라 cublas까지 물어 **약 575MB**다(tools/stage-llama-cuda.mjs:8~10).
- 라이트 화면은 2026-08-22에 **「AI에게 물어보기」·「내 문서」 + ⚙ 설정**으로 줄었다 — 고장이 아니라 결정이다(GIJO_AS_Lite_설치안내서_2026-08-13.md:120~124).

## 5. 개발 머신 셋 — `win` · `max` · `gb10`

- 기계는 **이 세 이름으로만** 부른다. 「윈도우/맥」은 고객 OS를 가리킬 때만 쓴다(CLAUDE.md:35~36; GIJO_AS_2머신_개발환경_가이드.md:11~15).
- `win`=주개발·운영 WSL 4000·git 허브(`D:\gijo-hub.git`)·WireGuard 서버(10.8.0.1)·클라 게시 / `max`=M1 Max 32GB(10.8.0.11) / `gb10`=DGX Spark(10.8.0.12)(CLAUDE.md:38~42).
- 3계층 동기화: 코드=git 허브, 대용량(models·data)=**scp 시점 복사만**(실시간 동기화·양쪽 동시 사용 금지), 문서=구글드라이브(GIJO_AS_2머신_개발환경_가이드.md:48~53).
- git 방향이 머신마다 다르다 — **Mac은 hub에서 당겨가고, GB10은 Windows가 밀어넣는다**(CLAUDE.md:141; `receive.denyCurrentBranch=updateInstead`라 push하면 작업트리까지 갱신, CLAUDE.md:150~151).
- 비밀은 저장소에 안 적는다 — `win`=사용자 환경변수, `max`=macOS 키체인(`-a gijo-qa`, `-w`는 값 없이, `-U` 금지), `gb10`=`~/.gijo-secrets`(chmod 600)(GIJO_AS_2머신_개발환경_가이드.md:133~166).
- SSH 방화벽 22번은 **10.8.0.0/24 + Profile=Any** — wg 인터페이스가 Public으로 분류돼 Private 전용 규칙은 조용히 무시된다(GIJO_AS_개발환경_가이드라인.md:73).
- 교차 확인의 함정: `max`는 **자기 VPN 주소로 자기에게 못 붙고**(utun), `win`은 **ICMP를 막아** ping 실패가 연결 실패를 뜻하지 않는다(GIJO_AS_2머신_개발환경_가이드.md:109~111).
- `max`에서 `npm ci` 하면 **Electron 서명이 깨진다** — `qa-mac.mjs`가 잡는다(GIJO_AS_2머신_개발환경_가이드.md:117~119). Mac QA는 L0 자동 → L1 CDP 9223 → L2 육안 3계층이고(GIJO_AS_MAC_QA_계획.md:63·73·85, 요약 178), 서버 자동 기동은 launchd(`com.gijo.as.server`), 재시작은 `update-dev-mac.sh`로 해야 한다(같은 문서 128~147).
- ⏸ **Mac 인계는 멈춰 있다**(2026-08-22 사장님 지시) — 전달할 것은 `GIJO_AS_MAC_인계_대기.md`에 그때그때 쌓는다(CLAUDE.md:21~24).

## 6. GB10 (ARM CUDA) — 무엇을 어디서 재나

- GB10은 **속도가 아니라 용량**이 값어치다 — 대역폭 273GB/s vs 3090의 936GB/s(3.1배 차)(CLAUDE.md:147; GIJO_AS_하이브리드LLM_비용최적화_설계서.md:21).
- llama.cpp는 `-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121`로 빌드하고 **Windows와 같은 판본**으로 맞춰야 실측을 비교할 수 있다(CLAUDE.md:153).
- ⚠ **nvidia-smi가 GPU 메모리를 `[N/A]`로 준다**(통합메모리·드라이버 차원). 판정은 `server/src/util/unifiedmem.ts` 한 곳에서 받고, 새로 nvidia-smi로 메모리를 읽으면 `server/test/unifiedmem.test.ts`의 소스 감시 시험이 실패한다(CLAUDE.md:154).
- ⚠ **라이트(전용 VRAM 8~10GB) 측정은 gb10에서 하지 않는다** — 통합메모리라 RSS·nvidia-smi 둘 다 틀린 자다(CLAUDE.md:148). 그 측정은 3090(win)이 맡는다.
- **도커로 배포하지 않는다** — 재현 검증·다른 CUDA 판본 시험 용도로만(CLAUDE.md:156).
- 개발 비용 절감용으로 gb10을 쓴다: 800줄 넘는 파일은 Read 전에 `node tools/local-digest.mjs file …`(원문 발췌, 요약 아님), 검토관 전 1차 선별(CLAUDE.md:95~96).
- 자산 주기 점검을 GB10에 태울 때의 설계 원칙은 **(가) 관리 접속만 WireGuard, (나) 점검 트래픽은 LAN 직결**이고(GIJO_AS_GB10_VPN_자산점검_구성안.md:19~24·38), 자산 쪽엔 읽기 전용 `gijo-audit` 계정 + `from=`으로 출처를 못박는다(같은 문서 115~153).

## 7. 원격 GPU — 큰 GPU를 VPN으로 나눠 쓰기

- **원격 GPU(붙는 쪽)** 과 **원격 GPU 내주기(받는 쪽)** 가 짝이고, 둘 다 기본 꺼짐·admin만 켠다(GIJO_AS_원격GPU_사용안내.md:27~32).
- 실측 왕복 **538ms**(win → VPN → gb10 GIJO → gb10 모델 → win)(GIJO_AS_원격GPU_사용안내.md:18·107).
- 코드가 지키는 것: 사설 대역에서 온 요청만(`X-Forwarded-For` 불신), 브라우저 차단, 에어갭이면 막힘, 동시 2건, 자기 모델만 내줌(GIJO_AS_원격GPU_사용안내.md:80~87).
- 타임아웃이면 허브형 VPN의 `AllowedIPs`가 서버 하나(`10.8.0.1/32`)뿐인지와 서버 포워딩 여부를 본다 — 2026-08-14 실사고가 정확히 이 둘이었다(GIJO_AS_원격GPU_사용안내.md:71).
- 예전엔 「인증을 묻지 않는다」였다(GIJO_AS_원격GPU_사용안내.md:90~98) — **지금은 켤 때 접속 토큰을 만들어 주소에 실어 주고, 붙는 쪽이 헤더로 제시해야 통과한다**(2026-08-16, server/src/engine/llmserve.ts:24~27; 토큰 없는 옛 켜짐은 `llmServeOn()`이 「꺼짐」으로 막는다 — 같은 파일 128~131). 문서 5절이 코드보다 낡았다.

## 8. 낡아서 그대로 따르면 안 되는 문서

- `GIJO_AS_설치_가이드_v2.1.0.md` — 기본 모델 gijo-main-orchestrator 7.6B(:4)·설치본 155MB(:15·:44), 「WSL2 환경으로 서버 이관 예정」(:121). 지금 기본 모델은 qwen3-14b이고 WSL2는 운영 정본이다.
- `GIJO_AS_PC세팅_체크리스트.md` — 최종 모델 Lily-Cybersecurity-7B(:125), 서버를 Windows 네이티브(`C:\GIJO-AS\server`)에서 직접 기동(:188~190). 둘 다 대체됐다.
- `GIJO_AS_WSL2_서버이전_계획서.md` — 계획은 이행됐고 **실행 절차의 현행본은 GIJO_AS_배포_가이드.md §3.7**이다. 다만 폐기 문서가 아니다 — 그 가이드가 :145에서 「배경·전체 절차」 참조처로 아직 이 문서를 가리킨다.
- `GIJO_AS_고객기계_실행환경_결정안_2026-08-10.md` — 상태가 아직 「결정 대기」(:3)이고 추천이 **파이썬을 JS로 교체**(:71·103·131)·**GPU 팩 547MB는 별도 내려받기**(:99·130)인데, 2026-08-22 결정으로 뒤집혔다(파이썬 동봉 = tools/stage-python.mjs, CUDA 동봉 약 575MB).
- `GIJO_AS_폰으로_원격작업_가이드.md` — **미검증**이다(:5 「이 문서를 쓴 세션은 클라우드라 GB10에서 실행·검증하지 못했다」). 실제로 쓰는 통로는 `ssh gb10`이다(CLAUDE.md:123·149). 채택·기각을 적은 자리는 찾지 못했다.
- `GIJO_AS_개발환경_가이드라인.md` — 2머신 전제(:3)·테스트 게이트 914개(:48)·server-dist 원복(:103, 2026-08-13 폐지·CLAUDE.md:166).
- ⚠ `GIJO_AS_개발환경_테스트_매뉴얼.md:34` 에 **claude-deploy 비밀번호가 평문으로 적혀 있다** — CLAUDE.md:173 「repo에 기록 금지」와 정면으로 어긋난다. 지우는 것만으로는 무효화되지 않으니 **값 교체가 먼저**다.
