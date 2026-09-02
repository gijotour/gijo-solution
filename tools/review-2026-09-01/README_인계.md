# 인계 — 클라이언트 설치→로그인→제품 UI 점검 · GB10 코드 병행 검토 · md 문서 통합

> **만든 곳**: 클라우드 세션 `as-private-41` (2026-09-01, origin/main `f1bfd98` 2026-08-09 기준)
> **넘기는 곳**: 로컬 세션(Windows 허브 또는 GB10) — 사용자 지시 "로컬세션으로 변경하자"
> **왜 넘기나**: 클라우드 컨테이너는 WireGuard 망 밖이라 `promaxgb10`에 붙을 수 없고, origin이 허브보다 뒤라(지형도 08-13판의 `unifiedmem.ts`·`tools/wsl-test.sh`·시험 2,979개가 origin에 없음) 현재 코드를 못 본다.

## 0. 사용자 지시 3건 (원문)

1. "사용자 관점에서 클라이언트 설치부터 제품 로그인 제품 UI 모두 점검해줘. GB10을 이용해서 코드는 병행으로보고. 변경안 보고서 알려줘"
2. "(지형도 html 업로드) 해당 파일도 업그레이드 해줘"
3. "md파일들 날짜별로 다읽고 통합도 해줬으면하는데"

**계획서 관계(작업 규칙)**: 설치·로그인·첫 화면·문구 = **전-7(보여 주기 — 첫인상)**, 시연 자료 = **전-1**, 실사용 불편 = **중-1**, 설치·운영 안정·문서 정합 = **후-1(GA 관문)**. **GB10 서버 이식은 계획서에 없는 큰 작업**이다 — 지형도 08-13판은 "하드웨어 갈래 — GB10 편입(전-7)"으로 적어 두었지만, 계획서 본문에는 아직 없다. 보고서에서 관계를 먼저 묻는다.

## 1. 해석·전제 (사용자 확인 필요)

- **GB10** = NVIDIA DGX Spark(`promaxgb10-1d0a`, aarch64, 통합메모리 128GB, CUDA 13.0, WG 10.8.0.12). 가장 현실적인 배치 = RTX 3090 WSL 대신 **서버**로 쓰는 분산 모드(담당자 PC는 그대로 Windows 설치본). 올인원(Linux arm64 Electron)은 부차.
- "코드는 병행으로 보고" = GB10 플랫폼을 전제로 **코드 검토를 여정 점검과 나란히** 진행. 로컬 세션에서는 여기에 **GB10 실측**(§4)을 더할 수 있다.
- 문서 통합 = **원본을 지우지 않는다**. 날짜순 연대기 + 주제별 「지금 사실」 통합본 + 81개 문서 지도(유지/병합/보관/폐기 후보). 실제 병합·`_archive/` 이동은 **승인 뒤**.
- 코드는 한 줄도 고치지 않았다. 화면 변경은 규칙대로 **추천 시안 1개 → 승인 → 구현**.

## 2. 클라우드에서 한 일

### 2-1. 손으로 확인한 것 (워크플로와 별개로 직접 본 것 — 로컬에서 재확인 대상)
| # | 관찰 | 어디 | 상태 |
|---|---|---|---|
| 1 | 로그인 화면이 gijo-ui.css를 안 쓰고 자체 팔레트(카드 `rgba(14,20,36,.85)`, 미사용 `--navy2`) — 앱 본체(#262624·#30302e)와 결이 다름 | `client/src/renderer/pages/login.html` `<style>` | 확인됨 |
| 2 | 서버 주소 입력 태그에 `/ aria-label=` 꼴의 어색한 속성 표기 | `login.html` 서버 주소 `<input>` | 확인됨(동작 영향은 검증 필요) |
| 3 | 로그인 실패 문구가 "서버 연결 실패"와 "아이디·비밀번호 오류"를 구분하지 않음(`code:"error"`의 "서버에 연결할 수 없습니다"를 버림) | `login.html` doLogin · `client/src/api/auth.ts` | 확인됨 |
| 4 | `enrollRequired`(관리자 2차 인증 필수 정책) 응답을 화면(html/js)이 처리하는 곳이 grep에 안 잡힘 — 서버는 그 밖의 경로를 403으로 막는다 | `client/src/renderer/pages/*.html·*.js` grep 0건 | **검증 필요** |
| 5 | `manual-update.ps1` 주석은 "oneClick 빌드"라 하나 `package.json`은 `oneClick:false` | `client/scripts/manual-update.ps1` 상단 · `client/package.json` nsis | 확인됨 |
| 6 | 서버 게시 저장소가 `.exe`만 받는다 — mac dmg·arm64 클라는 인앱 업데이트 경로가 없음 | `server/src/engine/clientrelease.ts` publishClientRelease | 확인됨 |
| 7 | 설치 가이드 v2.1.0·클라이언트 배포 가이드 v2.5.0 vs 클라 5.14.0 — 설치 경로(`gijo-as` vs `gijo-as-client`)·「● 운영중 LIVE」 배지(08-08 제거)·대시보드 구성 서술이 낡음 | `GIJO_AS_설치_가이드_v2.1.0.md` · `GIJO_AS_클라이언트_배포_가이드.md` | 확인됨(고객 문서 여부는 docs-manifest 대조) |
| 8 | git 첫 커밋 날짜가 문서 81개 전부 2026-08-09(일괄 반입) — "날짜별"은 본문 날짜로만 가능 | `git log --diff-filter=A` | 확인됨 |
| 9 | `오늘업무_2026-07-13`은 md가 아니라 폴더(안에 `디자인_가이드.md` 1개) | 저장소 루트 | 확인됨 |

### 2-2. 워크플로 3개 (`.claude/workflows/` 에 넣어 둠 — 로컬에서 이름으로 실행)
| 이름 | 무엇 | 단계 | 에이전트 수(대략) |
|---|---|---|---|
| `여정점검` | 설치·로그인·셸/첫화면·절차 허브·설정/기록/부가·업데이트/세션·문서↔코드·페르소나 8갈래 | 점검 → 갈래별 반박 검증(근거·의도된 설계·영향) → 누락 보충 → 변경안 종합 | 24 |
| `GB10검토` | DGX Spark 사실 조사(WebSearch, 출처) → GPU감지/엔진·빌드/배포/네이티브·성능/용량 3갈래 → 검증 → 종합 | 조사 → 점검 → 검증 → 종합 | 8 |
| `문서통합` | md 81개를 10묶음으로 전부 읽고 본문 날짜 추출 → 연대기·문서 지도/병합 계획·주제별 통합본 7편 → 원문 대조 | 통독 → 통합 → 대조 | 19 |

실행 예 (로컬 저장소 경로를 넘긴다 — 클라우드 기본값은 `/home/user/AS-Private`):
```
Workflow({ name: "여정점검", args: { root: "D:/Connect AI", canRun: true } })
Workflow({ name: "GB10검토", args: { root: "D:/Connect AI", canRun: true } })
Workflow({ name: "문서통합", args: { root: "D:/Connect AI", canRun: true } })
```
- 클라우드는 CPU 4개라 워크플로당 동시 에이전트 2개였다. 로컬은 CPU만큼 늘어 훨씬 빠르다.
- 결과(반환 JSON)는 `tools/review-2026-09-01/결과/` 아래 `여정점검.json`·`GB10검토.json`·`문서통합.json`으로 저장하고 커밋한다.
- 클라우드 세션이 살아 있으면 클라우드 결과도 같은 폴더에 `클라우드_*.json`으로 올라온다 — 로컬 결과와 **합쳐서** 쓴다(기각 사유가 다르면 둘 다 적는다).

### 2-3. 지형도 v2 초안 (아티팩트 갱신용)
- 원본 아티팩트: **GIJO AS — 개발 환경·제품 전체 지도** `https://claude.ai/code/artifact/c4f9c399-8464-4c77-83bf-a72743480040` (2026-08-13판이 라이브, 업로드본보다 새롭다 — 검증 표·운영 노트 포함). **같은 URL로 갱신**(favicon 🗺️ 유지).
- `지형도_base_2026-08-13.html` = 라이브 본문. `splice.js`가 여기에 토큰(`--client`·`--bad` 네 테마 블록)·범례·CSS·새 구간 4개(`map_sections.html`)·푸터를 끼워 `지형도_v2.html`을 만든다.
- 새 구간: **05 고객사 배치**(담당자 PC ↔ 서버 SVG) · **06 담당자 여정 점검** · **07 GB10 코드 검토** · **08 문서 통합**.
- 남은 자리(결과로 채운다): `{{GB10_ONE_LINE}} {{JOURNEY_KPI}} {{JOURNEY_STAGES}} {{JOURNEY_TOP}} {{JOURNEY_SUMMARY}} {{GB10_VERDICT}} {{GB10_FACTS}} {{GB10_ROWS}} {{GB10_CHECKLIST}} {{GB10_CAVEATS}} {{DOCS_KPI}} {{DOC_ERAS}} {{DOC_TARGETS}} {{DOCS_NOTE}}`
- 아티팩트 규칙: `<head>` 골격은 게시 때 붙으니 본문만(`<title>`+`<style>`+`<div class="wrap">…`) 올린다. 외부 스크립트·CDN 없음(그대로 유지).

### 2-4. 보고서 뼈대
`보고서_뼈대.md` — 최종 파일명 `GIJO_AS_클라이언트_여정_점검_변경안_2026-09-01.md`(저장소 루트). 마지막에 **📖 용어 풀이**를 붙이고, 새 용어(통합메모리·분산 모드/단일 데스크톱 모드·NSIS 설치본·GB10/DGX Spark·코드 서명과 EDR 차단)는 `GIJO_AS_용어사전.md`에 그때 추가한다(용어사전만 요청 없이 갱신하는 예외).

## 3. 로컬에서 이어서 할 일 (순서)

1. **받기** — 허브 머신이면 `/GIJOAS동기화`로 hub 최신을 받은 뒤, 이 브랜치를 origin에서 가져온다(이 인계가 곧 사용자 요청이다):
   ```
   git fetch origin claude/client-install-ui-review-vkpxk2
   git checkout claude/client-install-ui-review-vkpxk2
   git merge --ff-only origin/claude/client-install-ui-review-vkpxk2
   ```
   허브 main이 앞서 있으면 `git rebase main`(또는 `git merge main`)으로 현재 코드 위에 올린다 — 이 브랜치는 코드를 안 건드려 충돌이 없어야 한다.
2. **origin을 허브에 맞추기** — `git push origin main` 한 번(사용자 요청 하에). 그래야 다음 클라우드·외부 검토가 현재 코드(unifiedmem.ts 포함)를 본다.
3. **워크플로 3개 실행**(§2-2) → 결과 저장·커밋.
4. **GB10 실측**(§4) — 읽기 전용 탐침을 GB10에서 돌려 `결과/gb10-probe.txt`로. 특히 `nvidia-smi --query-gpu=memory.free`가 무엇을 내는지(N/A?)가 `localengine.ts`·`preflight.ts` 판정의 열쇠다. 허브의 `unifiedmem.ts`가 이미 푼 것과 대조.
5. **보고서 작성** → 용어사전 갱신 → 지형도 v2 자리 채우기 → 아티팩트 같은 URL로 갱신 → 커밋 → **PR**(공동작업 규칙: main 직접 push 금지).
6. 문서 통합의 실제 병합·`_archive/` 이동은 **사용자 승인 뒤** 별도 커밋.

## 4. GB10 실측 탐침
`gb10-probe.sh` — 읽기 전용(파일 안 만들고 서비스 안 건드림). 서버 코드가 기대하는 값을 그 자리에서 재 본다.
```
ssh gb10 'bash -s' < tools/review-2026-09-01/gb10-probe.sh | tee tools/review-2026-09-01/결과/gb10-probe.txt
```
재는 것: uname/OS · free/meminfo · **nvidia-smi 쿼리 3종(localengine·preflight와 같은 인자)** · nvcc · node/python · llama-server 버전 · 네이티브 모듈 4종 로드(server/node_modules 있을 때) · `/api/health`(서버가 떠 있을 때, Node fetch).

## 5. 주의사항
- 이 브랜치에는 **제품 코드 변경이 없다**(`.claude/workflows/` 3개 + `tools/review-2026-09-01/`만). 서버 변경이 없으니 인계 테스트는 「해당 없음」.
- `.claude/`는 양 머신 공통 설정이라, 워크플로 3개는 다음 세션부터 이름으로 보인다.
- 화면(UI)을 바꾸는 항목은 **시안 승인 전에는 구현하지 않는다**. 문서는 통합본을 새로 쓰되 원본은 보존한다.
