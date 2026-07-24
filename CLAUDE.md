# GIJO AS — Claude Code 프로젝트 컨텍스트

한국형 온프렘 AI 보안관리 플랫폼. **Electron 클라이언트(client/) + Node/TypeScript 서버(server/) + 로컬 LLM(llama.cpp)**. 보안담당자가 취약점 스캐너 로그·보안로그·보안제품 리포트를 통합 분석·관제하는 제품(1차 목표). AI-BOM·온톨로지·레드팀/가드레일이 차별점.

## 작업 규칙 (사용자 확립 원칙 — 반드시 준수)
- **모든 사용자 대상 텍스트는 한글로.** 어려운 용어·작업엔 쉬운 풀이를 곁들일 것.
- **모든 명령은 이해한 범위를 먼저 확인받고 착수** (단순 관례 명령 "빌드해줘" 등만 예외).
- **UI 변경은 시안 3종 먼저** (자체완결 HTML 목업) → 결정받고 구현. 곧바로 구현 금지. 화면별 시안은 mockups/ 아래 별도 폴더.
- **설계 전 인터넷에서 표준·모범사례 조사** 후 근거 제시.
- **정직한 구현** — 가짜 UI 금지, 실제 end-to-end 검증 + 테스트. 테스트가 env를 덮어써서 제품 아닌 테스트를 검증하는 함정 주의. 폴백 문구가 나오면 FAIL로 취급.
- **로컬 커밋 자유 · GitHub push는 사용자가 요청할 때만.** (2머신 git 허브 `hub` remote push는 동기화용이라 자유.)
- 문서(가이드·PDF·Notion 등) 갱신은 요청받을 때만.
- 화면 설명은 서버 screenguide panels + ⓘ(gijo-info) 컨벤션. 화면엔 정체성 한 줄만.

## 구조 요약
- `client/` — Electron. 화면=src/renderer/pages/*.html (hub.html?g=X가 iframe 탭 컨테이너, nav.js 공용 사이드바). 빌드 `npm run dist`, 게시 `npm run publish-release`(서버 자체가 배포처).
- `server/` — Express+TS. 엔진=src/engine/*.ts. DB=data/gijo-as.sqlite(better-sqlite3), RAG=data/memory.lancedb(LanceDB)+bge-m3 임베딩, 모델=models/<id>/<id>.gguf. 테스트 `npm test`(vitest, 900+개 — 실 LLM 스폰 안 함).
- `server/src/engine/localengine.ts` — llama-server 프로세스 풀(VRAM 예산·LRU 스왑). 임베딩은 8081 별도 상주.
- 운영: Windows PC의 WSL2 systemd(gijo-as.service, /home/gijo/gijo-as/server, 포트 4000).

## 공용 슬래시 명령 (.claude/commands/ — 양 머신 공통, 워크플로 표준)
- `/sync` — 작업 시작 전 hub 최신 받기(ff-only, 충돌 안내 포함)
- `/handoff` — 작업 마무리: 커밋→(서버 변경 시)테스트→hub push→**상대 머신 인계 블록 출력**
- `/deploy` — 운영(WSL) 배포. Windows=단계별 직접 수행, Mac=ssh 한 줄 안내/인계
- `/publish` — 클라 빌드·게시. **Windows 전용**(claude-deploy 계정, 실화면 검증 필수)
역할 고정: Mac은 hub push까지, 검토·배포·게시는 Windows. GitHub(origin)는 사용자 요청 시만.

## 2머신 개발환경 (Windows ↔ M1 Max) — GIJO_AS_2머신_개발환경_가이드.md
- Windows(desktop-4qplvnc)=주개발·윈도우 클라 테스트·운영 WSL·git 허브(D:\gijo-hub.git)·WireGuard 서버(10.8.0.1).
- Mac(M1 Max 32GB)=mac 올인원(서버+Metal LLM) 개발·검증. VPN=client-mac.conf(10.8.0.11). 코드는 GitHub 또는 `ssh://user@10.8.0.1/d:/gijo-hub.git`.
- 대용량(models/·data/)은 **시점 복사**(scp)만 — 실시간 동기화·양쪽 동시 사용 금지(DB 분기·깨짐). 원본은 WSL 운영.

## Mac에서의 주 임무 (Phase 2) — GIJO_AS_MAC_올인원_배포_가이드.md
1. llama.cpp Metal 빌드(`cmake -B build -DGGML_METAL=ON`) → `llama.cpp/build/bin/llama-server` (경로 util/llamabin.ts가 darwin 자동 해석, `-ngl -1` Metal 동작)
2. `client/`에서 `npm run dist` → arm64 dmg (서명 없음 — 자가사용, 첫 실행 우클릭→열기)
3. 데이터 이식: `server/scripts/migrate-data-to-mac.mjs` export/verify — data/+models/ 복사가 전부(bge 벡터는 LanceDB에 있어 재인입 불필요)
4. 실측: preflight(GPU=Apple Metal pass) → 임베딩·채팅 모델 로드 → tok/s → RAG 히트 → 티어 API("Apple Metal · 통합메모리 32GB", M1 Max=2모델 티어 예상)
- Phase 1(크로스플랫폼 분기: localengine·preflight·build-server-dist·package.json mac 타깃)은 완료 상태(2026-07-24).

## 주의·함정 (실사고 기반)
- `client/server-dist/package.json`은 추적 산출물 — 빌드 후 `git checkout`으로 되돌려 clean 유지.
- 한글 HTTP 검증에 curl 쓰지 말 것(깨짐) — Node fetch로. 한글 파일 조작은 perl 대신 Node. `PYTHONUTF8=1`.
- 7B 모델에 프롬프트 규칙을 더해 행동 교정하려 하지 말 것 — 코드로 해결(반복 실패 사례 있음).
- 에이전트 모델 미배정은 조용히 기본모델 폴백 — app_state 직접 확인.
- 임베딩 llama-server는 ctx/batch/ubatch 8192 명시 필수(512 초과 한글 입력 HTTP500 사고).
- 운영(WSL) 서버는 watcher 없음 — 코드 갱신 후 프로세스 kill로 재시작(Restart=always). 단 전 사용자 세션 끊김.
- Windows 게시·앱테스트용 계정: `claude-deploy`(admin). 비밀번호는 Windows 사용자 환경변수 GIJO_ADMIN_PASSWORD에 저장(repo에 기록 금지). 게시는 `--force`(자기 세션만 교체).
