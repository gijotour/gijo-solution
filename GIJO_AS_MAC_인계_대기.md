# Mac(`max`) 인계 대기 목록

**2026-08-22 개설** · 사장님 지시: 「MAC 전달은 한동안 하지 말자. **제품 완성 이후 한 번에** 전달」

## 이 문서가 왜 있나

인계를 **멈추는 것**이지 **잊는 것**이 아니다.
보고마다 인계 블록을 붙이지 않는 대신, 전달할 것을 **여기 그때그때 쌓는다.**
안 쌓으면 나중에 한 번에 전달할 때 **무엇이 바뀌었는지 아무도 모른다** —
이 저장소가 반복해 겪은 「기록 안 하면 사라진다」가 그대로 재발한다.

**재개 시점**: 사장님이 「제품 완성」이라 판단하실 때. 그때 이 문서로 한 번에 인계한다.
인계 형식은 `.claude/commands/GIJOAS인계.md`에 그대로 있다.

**쌓는 법**: 날짜 아래에 한 줄씩. **공용 파일**과 **max가 실기로 검증해야 할 것**은 반드시 적는다.

---

## ⚠ max가 실기로 검증해야 할 것 (mac에서만 되는 일)

| 무엇 | 왜 max인가 | 언제 |
|---|---|---|
| **라이트 dmg 빌드·실행** | dmg는 mac에서만 구워진다 | 내 문서 기능 완료 후 |
| **Metal LLM 동작** | Apple GPU는 mac에만 있다 | 위와 함께 |
| **올인원(서버+LLM 한 대) 검증** | mac 올인원 구성 | 위와 함께 |

---

## 2026-08-22

### 공용 파일 변경 (⚠ 반드시 전달)

| 파일 | 무엇이 바뀌었나 |
|---|---|
| `CLAUDE.md` | Mac 인계 보류 규칙 신설(이 문서 개설) |
| `server/src/engine/dispatcher.ts` | 행동 대조 분기가 **활성 사고면 비켜 준다**(`!침해사고질문인가 && !장애질문인가`) |
| `server/src/engine/incidentsteps.ts` | 사고 중 「~해도 되나」를 절차 물음으로 받음 · `침해말`에 `감염됐\|감염되었` 추가 |
| `server/src/engine/licenserisk.ts` | NC(상용금지)와 ND(변경금지) **분리** · `상용사용금지()`·`변경금지조건()` export · OFL·LicenseRef 인식 |
| `server/src/engine/sbomreview.ts` | 검수 상세·목록이 등급을 **다시 판정**하고 저장본을 되돌림(rowid 기준) |
| `server/src/engine/knowledgebundle.ts` | 온톨로지 시드 라이선스 판정 완료(「사실만 싣는다」) |
| `server/docs-manifest.json` | 지식 문서 7종 교체(라이선스 위반본 제거 → 우리가 쓴 것) |
| `client/src/renderer/pages/lite-screens.json` | **라이트 메뉴 11개 → 2개**(대화창·내 문서) + 설정. 나머지는 `_메뉴에서_내린것`에 보존 |
| `tools/wsl-test.sh` | client 동기화에 `smartmd/vendor/***` 추가 |
| `tools/gen-sbom-self.mjs` · `tools/lib/vendor-manifest.mjs`(신규) | 자기 SBOM 관문 — 동봉 원장 파서 분리, 못 읽으면 exit 1 |

### 새 파일

- `tools/lib/vendor-manifest.mjs` — 동봉 vendor 원장 파서(도구와 시험이 함께 쓴다)
- `server/test/vendornotice.test.ts` — 동봉물 고지 감시
- `knowledge/GIJO_지식_*.md` 7종 — 우리가 직접 쓴 보안 지식
- `GIJO_AS_MAC_인계_대기.md` — 이 문서

### max에서 주의할 것

- ⚠ **`vendornotice` 시험은 이제 늘 건너뛴다** — 정상이다. 판정 기준을 「폴더가 있나」에서
  **「빌드가 담나」**로 바꿨는데(2026-08-22 Smart MD 제거), 이제 아무 빌드도 안 담는다.
  다시 실으면 저절로 되살아난다. `max`에 `client/smartmd/`가 없어도 무방하다.
- ⚠ 라이트 메뉴가 2개로 줄었다 — **고장이 아니라 사장님 결정**이다
  (「라이트에는 내 문서 기능만. 프로에서 필요한 기능은 하나씩 요청해서 맛보기로 넣는다」).
- 서버 시험은 늘었다(4,028+). `npm ci`는 불필요.

### ★ Smart MD Studio 제거 (2026-08-22 밤 — 위 「진행 중」이 전부 끝났다)

사장님 「내문서에서 문서작성을 할꺼니 팝업은 필요없어」. **별도 창을 통째로 없앴다.**
그 창이 하던 일(캡처 붙여넣기·템플릿·판 이력·내보내기)은 전부 `mydocs.html`의 ✏ 문서 편집 안이다.

| 파일 | 무엇이 바뀌었나 |
|---|---|
| `client/src/main.ts` | 창 생성·`smartmd:open`·`smartmd:exportPdf` **114줄 제거** → 무엇을 잃었고 어떻게 되살리는지 18줄 주석으로 남김 |
| `client/src/preload.ts` | `openSmartMd` 다리 제거(판단 기록은 남김 — 남의 코드 창엔 이 preload를 안 준다) |
| `client/src/smartmd-preload.ts` · `client/scripts/fetch-smartmd.mjs` | **파일 삭제** |
| `client/package.json` · `client/electron-builder.lite.json` | 번들 목록·스크립트에서 smartmd 제거 |
| ⚠ `client/src/renderer/pages/nav.js` | TOP 「문서 작성 (창) · 무료」 항목 제거(**공용 파일**) |
| `client/src/renderer/pages/login.html` · `lite-app.html` · `lite-memory.html` | 진입 단추·경로 제거 |
| ⚠ `server/src/engine/screenguide.ts` | `"smartmd"` 안내 삭제 · 별칭 「문서작성」·「스마트MD」를 **mydocs.html로 재지정**(**공용 파일**) |
| `server/test/extra-windows.test.ts` | 봉인 시험 4개 제거(창이 없다) → **「남의 렌더러를 창으로 싣지 않는다」로 대체** |
| `server/test/vendornotice.test.ts` · `tools/gen-sbom-self.mjs` | 판정 기준을 「폴더 유무」→**「빌드가 담나」** |
| `tools/qa-auto.mjs` | 맨 위 고정 5→**4**자리 · 기대 항목에서 「문서 작성 (창)·무료」·「제품 소개자료」 제거 · **그룹 10→11**(등록부→보안제품+공급망, 뒤처져 있던 것 갱신) |

- ⚠ **되살리려면**: 이 커밋 하나만 revert하면 된다(한 묶음으로 커밋했다).
- ⚠ **문서 정리가 남았다**: `GIJO_AS_Lite_설치안내서_2026-08-13.md`가 아직 Smart MD를
  「함께 드리는 무료 도구」로 안내한다. 라이트 재편(메뉴 2개)과 함께 다시 써야 한다 — 사장님 판단 대기.

### ★★ 게시 전 검토관 45건 수리 (2026-08-22 밤 · 커밋 11cce495)

5갈래 병렬 검토가 49건 적발 → 반증 4건 기각 → **45건 확정.** [높음] 4건이 **그날 라운드가
새로 만든 것**이었다. 게시는 이 수리 뒤로 미뤘다.

| 파일 | 무엇이 바뀌었나 |
|---|---|
| ⚠ `server/src/db.ts` | 마이그레이션 `upload-receipts-uploader-id-2026-08-22`(ALTER — 운영 schema 46→47) |
| `server/src/engine/uploadreceipt.ts` | 영수증목록 반환이 **배열→객체**(`{목록,건수,전체바이트,원본보관바이트}`) · 거르개 인자 · `되묻기영수증지우기()` 신설 · `uploadedById` · 갈래 이름 2개 정정(asset=보안제품 매뉴얼·log=로그 매뉴얼) |
| ⚠ `server/src/engine/autoupload.ts` | 영수증 창구에 **등급·소유자 게이트**(열람불가공용) · `replacesReceiptId` 수신 · 응답에 `receiptId` |
| ⚠ `server/src/engine/memory.ts` | `ingest-file`에 **비밀 검사 추가**(창구 두 벌이던 잣대를 하나로) — 응답에 `비밀경고` 필드가 붙을 수 있다 |
| `server/src/engine/datacleanup.ts` | `TARGETS` **export** · 개인 문서 정리에 판 이력·첨부 대장 추가 · `upload_receipts` 갈래 신설 · 첨부 폴더 리셋 목록 추가 |
| ⚠ `server/src/engine/screenguide.ts` | `이름으로화면찾기`가 **`open`(여는 주소)을 함께 반환** · 「제품 안내」→**「GIJO AS 안내」** 이름 변경 · `/` 명령·내보내기 안내 정정 (**공용 파일**) |
| ⚠ `server/src/engine/dispatcher.ts` | `openScreen.page = 찾는화면.open ?? 찾는화면.screen` (**공용 파일**) |
| `server/src/engine/agenttools/handlers.ts` | 제품 소개자료 등록 완료 문구를 「내 문서 > 📦 보안제품 자료」로 |
| ⚠ `client/src/renderer/pages/nav.js` | TAB_REDIRECT에 intro.html · 즐겨찾기 배지를 **그린 것만** 세도록 (**공용 파일**) |
| `client/src/renderer/pages/app.html` | 「옛탭」 표에 intro.html(파일이 없으면 nav.js는 못 막는다) |
| `client/src/renderer/pages/mydocs.html` | 담당자 관리 스테이지(lite-contacts를 iframe으로 품음) · 연락처 클릭에서 전화·이메일 제거 · 반입 data-id·총계·열 이름 · vendor 상세 · 편집원본(미저장 경고) |
| `client/src/api/assets.ts` · `preload.ts` · `console.js` | `replacesReceiptId` 왕복 |
| `client/src/renderer/pages/lite-memo.html` | **삭제**(고아 화면 — 어느 메뉴에도 없었고 내용이 없어진 Smart MD 전제) |
| `client/src/renderer/pages/lite-memory.html` · `lite-screens.json` | 죽은 단추·거짓 안내 제거 · 되살리면 깨지는 배선 해제 |
| `tools/gen-sbom-self.mjs` · `publish-gate-ui.mjs` · `qa-auto.mjs` · `wsl-test.sh` | 동봉 판정을 extraResources까지 · 제외 표 실재 검사 · QA 제목 숫자 · rsync 이유 갱신 |

**새 감시 5개**(max도 이 시험을 돌리게 된다): 영수증 등급·소유자 게이트 · 거르고 자르는 순서 ·
회사문서 창구 **둘 다** 비밀 검사 · 정리 대장이 새 표를 빠뜨리지 않음 · 흡수 별칭 5개.

⚠ **max에서 주의**: `영수증목록()`의 반환 모양이 바뀌었다 — 그 함수를 부르는 코드가 있으면
`.목록`을 붙여야 한다. 시험 4,047개로 늘었다.

### ★★ 검토 2·3라운드 (2026-08-23 새벽 · 커밋 9eb68364 · 415a7438)

**수리를 검토하니 수리가 결함을 만들고 있었다.** 세 라운드 흐름: 45건 → 28건 → 12건,
[높음] 4 → 1 → 0. 게시는 이 셋을 다 돌고 나서.

| 라운드 | 무엇을 잡았나 |
|---|---|
| 1차(45건) | 반입 영수증 무필터(기밀 유출) · 연락처 빈 표 + 개인정보 서버 전송 · intro.html 삭제 연쇄 |
| 2차(28건) | ★ **1차 수리가 fail-open** — 문서 행이 없는 갈래(되묻는 중·SBOM·취약점)는 그대로 샜다 · 내가 넣은 감시 3개가 헛돌았다 |
| 3차(12건) | ★ **2차 수리가 화면을 깨뜨렸다** — 6칸으로 늘려 파일명 칸이 0px · 팔레트를 끄고 이을 것을 안 줌 |

**max가 알아야 할 API·계약 변화**

| 무엇 | 어떻게 바뀌었나 |
|---|---|
| `영수증목록()` | 배열 → **객체** `{목록, 건수, 전체바이트, 원본보관바이트}` · 둘째 인자로 거르개 |
| `되묻기영수증지우기(id, filename, uploadedById)` | 인자 3개(2차엔 2개였다) — filename 대조가 안전장치 |
| `/api/upload/receipts` | 응답 줄에 **`내것: boolean`** 추가 · 총량은 **거른 뒤** 건수 |
| `/api/memory/ingest-file` | 응답에 **`비밀경고`** 붙을 수 있음(IngestResult에 필드 추가) |
| ⚠ `등급판정가능(documentId)` (memory.ts 신설) | 「등급을 매길 행이 있나」 — **목록 자리에서는 `열람불가공용`만 쓰면 fail-open**이다 |
| ⚠ `이름으로화면찾기()` | 반환에 **`open`**(여는 주소) 추가 — dispatcher가 `open ?? screen` |
| `TARGETS` (datacleanup) | **export** 됨 · 정리 대장 전수 감시가 이 값을 본다 |
| `lite-contacts.html` | `?theme=host`/`?theme=light`를 받으면 라이트 팔레트를 끄고 셸 토큰을 따른다 |

⚠ **max에서 주의**: 시험이 4,060개로 늘었다. `datacleanup.test.ts`의 「⏳ 판단 대기」 목록은
**새 표를 만들면 빨개진다** — 그때 「지운다/안 지운다」를 판단해 적어야 한다(밀어 넣지 말 것).

### ★★ 클라 5.70.0 게시 + 배포 채널 에디션 분리 (2026-08-23 새벽)

**프로 5.70.0 게시 완료** — sha256 `327892004a54…` · 247.1MB · UI 실화면 관문 전부 통과.

| 무엇 | 내용 |
|---|---|
| ⚠ `server/src/engine/clientrelease.ts` | **에디션 칸 신설**(마이그레이션 `client-releases-edition-2026-08-23`, 운영 schema 48) · `latestClientRelease(edition)` · 창구가 `?edition=` 수신(미지정=pro) · 판 번호 충돌 시 게시 거부 |
| ⚠ `client/src/main.ts` | 업데이트 확인에 **자기 에디션을 실어 보낸다**(기존 `에디션()` 재사용) |
| `client/scripts/publish-release.mjs` | `--edition lite` — 라이트는 판 번호가 `electron-builder.lite.json`에 있다 |
| `tools/publish-gate-ui.mjs` | 반입 탭 칸 검사 · 담당자 관리 창 높이·배색 신호 검사 신설 |

**왜 갈랐나**: 라이트를 그냥 올렸으면 라이트 사용자가 업데이트를 물을 때 **프로 설치본이
내려와 라이트 설치를 갈아치웠다.** 판 번호가 안 겹친다고 안심할 수 없다 —
`release-lite/`에 `Lite Setup 5.17.0`·`5.18.1~3`이 실재한다.

⚠ **max가 dmg를 게시할 때 반드시 `--edition lite`를 붙여야 한다.** 안 붙이면 프로 채널로 올라간다.

### ⛔ 라이트 게시는 막혀 있다 — 사장님 판단 필요

빌드는 끝났다(`release-lite/GIJO AS Lite Setup 1.3.0.exe`). 그런데 **1,616MB**이고
서버 수신 한계가 **500MB**다(`clientrelease.ts` express.raw) — **3.2배**.

| 길 | 내용 | 비고 |
|---|---|---|
| **① 스트리밍 업로드**(추천) | `express.raw` → 요청을 디스크로 흘려 쓰기 | 정답이지만 배포 경로 수술 |
| ② 라이트 짐 덜기 | 1.6GB의 대부분이 llama-cuda + python + bge-m3 — LLM 런타임을 따로 받게 | 라이트 설치 경험이 바뀐다 |
| ③ 채널 밖 전달 | USB·파일로 — 라이트는 폐쇄망용이라 어울리기도 한다 | 자동 업데이트를 포기 |

⚠ 한계만 올리면 **1.6GB를 클라·서버 양쪽 메모리에 통째로** 올린다(Node Buffer 상한 부근) — 권하지 않는다.

### 2026-08-30 — 내 문서 노트북형(☑ 근거 지정·📎 지난 작업 첨부)

- **공용 파일 변경**: `preload.ts`(sendInstruction/Stream에 docIds·attachSessions 위치 인자 추가) ·
  `console.js`(근거띠 #csGround·gijoConsole.docScope/attachWork) · `app.html`(gijo:docscope/attach 수신 분기·
  gijoDocScopeCleared 훅) · `nav.js`(팝업 릴레이 목록 2종 추가) · `mydocs.html`(☑ 열·📎 지난 작업 탭) ·
  `dispatcher.ts`(본문 필드 2개·ALS 랩) · `llm.ts`(지정범위배너·첨부 블록) · `memory.ts`(where AND 필터) ·
  `worksessions.ts`(attachSessionText) · `screenguide.ts` · 신규 `ragscope.ts`·`ragscope.test.ts`
- **max 실기 검증거리**: 라이트 dmg에서 mydocs 「📎 지난 작업」 탭이 뜨는지(라이트에 work-sessions
  라우트가 있는지 — 없으면 「불러오기 실패」가 뜬다. edition-lite에서 탭을 숨길지 win이 후속 판단)

### 2026-08-30 — 🎯 선택이 ⧉ 분리 대화창까지 닿는다(④)

- **공용 파일 변경**: `app.html`(⑤′ `gijo:select` 분기가 **선택정돈을 지난 값만** `broadcastToWindows`로
  중계 · `ground:req`가 `sel`까지 물려줌 · ⚠ **`ground:req` 분기 자리를 ⑤′ 뒤로 옮겼다** — 그 앞에 두면
  `wiringcontract`의 상1 감시(「선택 자동 복귀 금지」)가 2000자 창으로 ⑤″의 `무대숨김`과 붙여 읽어 오탐) ·
  `console.js`(`onShellBridge`에 select 수신 · 「🎯 선택 풀기」가 `bridgeToShell`로 되보냄 · 화면 전환 해제
  중계 · `getGroundState`에 `sel` 추가)
- **감시**: `selectioncontext.test.ts`에 네 방향 계약 추가. 기존 「select 갈래가 선택정돈을 부른다」 검사를
  새 모양(`var 고른값 = 선택정돈(d)`)에 맞춰 갱신 — 계약의 뜻은 그대로.
- **max 실기 검증거리**: mac에서 ⧉ 분리창 상태의 🎯(창 파괴·재생성 타이밍이 OS마다 다르다 —
  `broadcastToWindows`는 본창 뺀 BrowserWindow 전수 발송이고, ⇤ 붙이기 → ⧉ 다시 빼기에서
  `ground:req` 물려받기가 mac에서도 같은 순서로 도는지)

### 2026-08-30 — 메뉴 호출·배선 통일(전 화면 통일감 검토 라운드)

- **공용 파일 변경**: `nav.js`(팝업 릴레이 목록에 gijo:prefill 추가·새버전 배지 부착점 s=my·주석 교정) ·
  `app.html`(openTab 라벨 폴백 page 제거·옛탭 표 3건 최종 도착지·⭐ railFav 제거·prefill broadcast) ·
  `console.js`(onShellBridge prefill 수신) · `railroster.js`(E/R 라벨 「지식 창고」) ·
  `map-view.js`(선택을 selectnotify 부품으로) · 시험 5파일(대장·전수 스캔·top 고정·배지 실존)
- **라벨 정본 사슬 확정**: ① 메뉴 라벨(GROUPS) ② 여는 곳 관례(railroster·assets) ③ 판 제목.
  라이트가 화면·탭 라벨을 만질 때 같은 사슬을 따를 것.
- **max 실기 검증거리**: mac에서 화면 팝업(창) 상태의 대시보드 「적어 넣기」(prefill 릴레이 신설 경로) ·
  hardening 카드 클릭 🎯(win 운영에 점검 대상 0건이라 실측 못 함 — mac 개발 서버에 대상 있으면 확인)

### 2026-08-30 — 라이트(프로 흰 바탕) 대비 수리 121곳 + 배색 감시 교체

- **공용 파일 변경**: `pro-white.css`(**잉크 토큰 5종 신설** `--teal-ink`·`--amber-ink`·`--blue-ink`·
  `--purple-ink`·`--muted-ink` + 배지 반전 3종) · `nav.js`·`titlebar.js`·`console.js`·`chatparts.js`·
  `chatwidget.js`·`dialog.js`·`scopefilter.js`·`session-explorer.js`·`longnotice.js`·`map-view.js`
  (밝은 글자 → 토큰 장치) · `tools/theme-sweep-pastel.mjs` MAP 45색 확장 · `server/test/themecolors.test.ts`
  **명단 → 대비 계산**으로 교체 · 신설 `tools/contrast-probe.mjs`(실화면 대비 측정기)
- ⚠ **라이트 에디션 작업 시 반드시 알 것**: 새 색을 넣을 때 `--teal`·`--amber`·`--purple`·`--blue-light`에
  폴백을 달면 **다크가 조용히 바뀐다**(화면 :root가 그 토큰들을 정의한다). 반드시 `-ink` 토큰을 쓸 것.
  잉크 토큰은 `pro-white.css` 한 곳에서만 정의한다 — 화면이 정의하면 장치가 깨지고 시험이 막는다.
- **max 실기 검증거리**: mac에서 프로 흰 바탕 화면들의 글자 대비 — `node tools/contrast-probe.mjs`
  (앱을 CDP 9223으로 띄우고 로그인 후 실행, 위반 0이어야 한다). mac 폰트 렌더링이 달라 눈으로도 한 번.

### 2026-08-30 — 안내(screenguide) 거짓 제거 + 구조 통일

- **서버 공용 파일**: `screenguide.ts`(화면 열쇠에서 **쿼리 떼기** 3곳 · 흡수자리 표 1→20줄 ·
  허브 별칭 · 폐지 기호 📌→🎯 · 이관 패널 3종) · `verifyroutes.ts`·`playbook.ts`·`howto.ts`(옛 메뉴 이름)
- **클라 공용 파일**: `fold.js`(**entries 누수 수리** — 재렌더 화면에서 죽은 entry가 쌓이던 공용 결함) ·
  `gijo-ui.css`(밀도 단일 출처 주석) · `mydocs.html`(chatwidget 탑재)
- ⚠ **라이트 작업 시 알 것 2가지**:
  ① 화면 별칭에 **홑낱말을 넣지 말 것** — 「조치」·「보고」 같은 업무 낱말은 침해사고 초동절차·법령
     조회보다 앞에서 문장을 삼킨다(2026-08-30에 [높음] 3건으로 잡혔다). 복합어만.
  ② 접기는 `fold.js` 한 부품만 쓴다(자체 구현 금지 — 「hot이면 접힌 것도 펼친다」 원칙이 빠진다).
- **보류(백로그)**: `.g-empty` 공용 빈 상태 부품 — `.empty` 113곳이 **네 상태의 혼합**이고 라이트 47곳이
  배색 감시 밖(`themecolors`가 `^lite-` 제외)이라 역할 분리 설계가 먼저다.
- **max 실기 검증거리**: mac에서 ⓘ 안내가 쿼리 붙은 탭(설정·지식 창고·내 문서)에서 제 안내를 내는지 ·
  compliance 접기의 hot 펼침 · mydocs를 ⧉로 뺐을 때 ⓘ 위젯

### 2026-08-31 — 라이트 메뉴 「내 지식·내 문서」 둘로 (사장님 지시)

- **라이트 파일 변경**: `lite-screens.json`(lite-chat 이름 「AI에게 물어보기」→「내 지식」·아이콘 🧠📓) ·
  `lite-app.html`(⚙ 설정을 사이드바 밑 → 상단바, liteNavFoot 걷음) · `lite-chat.html`(title)
- win 실측 완료(win-unpacked·격리 userdata): 사이드바 2항목·상단 ⚙ 동작·연초록 유지.
- **max 실기 검증거리**: **dmg 재빌드**(mac 전용) 후 같은 셋 확인 — 사이드바에 내 지식·내 문서만,
  ⚙는 상단바, mac 신호등과 상단바 ⚙·📝 겹침 없는지(titlebar env 패딩).

### 2026-08-31 — 프로 5대 메뉴 재편 + 계약 개정 「메뉴 클릭=화면+카드 나란히」 (사장님 지시)

- **클라 공용 파일 대개편**: `nav.js`(**GROUPS 12→5그룹**: 🧠 내 지식·📓 내 문서·🩹 취약점 업무·
  🧰 보안제품 관리·⚙ 설정. 절차 id는 항목 한 줄로 이식 — page→label→id 순서 계약 ·
  `gijoNavTop` 신설) · `app.html`(카드-only 갈래 삭제 — 메뉴 클릭이 화면을 왼쪽에 도킹하고
  카드도 옴 · 화면이름찾기 2패스) · `console.js`(홈 히어로 절차 칩을 항목 id 기준으로)
- **서버 공용 파일**: `datacard.ts`(inventory=asset 카드) · `screenguide.ts`(inventory 흡수자리
  문구 — 이제 🧰의 독립 메뉴) · 시험 4종(workflow 파서·wiringcontract 계약 개정·themecolors
  예외 줄·qa-auto/qa-shell 셀렉터)
- ⚠ **라이트 후속(사장님 「프로 이번 제품 작업 이후 내지식·내문서 라이트에도 반영」)**:
  프로의 🧠 내 지식·📓 내 문서 구성을 라이트에 동기화하는 작업이 이 재편 **다음 차례**다.
  라이트는 `lite-nav.js` 별도라 이번 재편의 직접 영향은 없다(설계관 확인).
- **max 실기 검증거리**: dmg 재빌드 후 — ① 사이드바가 5그룹으로 뜨는지 ② 메뉴 클릭 시
  화면이 왼쪽에 바로 열리고 대화창이 오른쪽에 남는지(옛 「카드만」이 아니라) ③ 자산 관리
  (전체)가 ⓪ 자산 고르기로 갈아타지 않는지 ④ 새 대화 홈의 절차 칩 6개.

### 2026-08-31 (2) — 좁은 폭 계약 · 대화창 온디맨드 · 📂 지켜보는 폴더 (사장님 지시 4건)

- **클라 공용 파일**: `gijo-ui.css`(**좁은 폭 계약** — 한글 keep-all·단추 nowrap·.wrap-ok 예외.
  전 화면에 주입되므로 mac에서도 그대로 적용) · `app.html`(💬 **대화창 온디맨드** — 접힘 축·
  40px 손잡이·배지·toChat 강제 해제) · `console.js`(⊮ 접기 단추·도착 훅) · `mydocs.html`
  (📂 지켜보는 폴더 판·탭별오류) · `nav.js`(📓에 항목) · 화면 4곳 반응형(inventory 🗺 지도
  적층·aihub/records 요약 띠 접힘·handover 점검표).
- **서버 공용 파일**: `watchfolder.ts`(신규 — 주기 폴링·경로 검증·등급/충돌 보호) ·
  `memory.ts`(추출필요 export 일원화·열람불가핵심 분리) · `docsbundle.ts`(사본 제거) ·
  `autoupload` 계약 소비 · `registry/agentloop/routes/falseclaim/screenguide` · `app.ts` 라우트 ·
  `index.ts` 스케줄러 start/stop.
- **새 도구/기계**: `tools/narrow-probe.mjs`(좁은 폭 실측기 — 앱 CDP 필요) ·
  themecolors에 좁은 폭 소스 감시 · publish-gate에 온디맨드 3검사·📂 판 검사.
- **max 실기 검증거리**: ① 좁은 폭(대화창 최대)에서 mac 폰트로도 글자 안 깨지는지 —
  `node tools/narrow-probe.mjs --port <CDP>`로 26화면 0건 재확인 ② 💬 손잡이·배지가 mac
  신호등/트래픽 라이트와 겹치지 않는지 ③ 📂 지켜보는 폴더: **mac 경로**(`/Users/...`)로
  등록·스캔·해제가 되는지(WSL 변환은 리눅스 전용이라 mac은 그대로 통과해야 한다) ·
  data/ 조상 폴더 거부가 mac 경로에서도 서는지.

### 2026-08-31 (3) — 카드 언어 전환 17화면 (사장님 「2번째 이미지로·모든 메뉴도 동일하게」)

- **클라 공용 파일**: `gijo-ui.css`(지표 줄 .g-scard-k* · 보기 전환 칩 .g-seg · 히트맵 타일
  .g-tiles/.g-tile — **--g-* 토큰만** 써서 3테마 자동) · `pro-white.css`·`lite-green.css` 덮개.
- **화면 17곳**: memory(지표·히트맵·카드 밀도) · aihub/records/discover/fix/reporting/triage/
  verify(요약 띠 카드 꼴·고정 높이 제거·라벨 위/값 아래 스택) · settings/agent/approvals/
  compliance/report/sbom/threat/redteam/merge(판 카드 밀도).
  ⚠ grouphub.js(마크업)는 **안 건드렸다** — 7화면 공용이라 화면별 CSS 사본만 고쳤다.
- **max 실기 검증거리**: ① mac 폰트로도 요약 카드 라벨이 안 잘리는지(넓은 폭·좁은 폭 둘 다,
  `node tools/narrow-probe.mjs`) ② 지식 창고 「목록|히트맵」 전환·타일 클릭 선택이 mac에서도
  대화창에 실리는지 ③ 라이트(연초록)에서 새 부품 색이 프로 색으로 새지 않는지 — 라이트는
  아직 이 부품을 쓰는 화면이 없어 **내지식·내문서 라이트 반영 라운드에서 함께** 봐야 한다.

### 2026-08-31 (4) — 라이트 반영 확인 (사장님 「프로 이번 제품 작업 이후 내지식·내문서 라이트에도 반영」)

- **결론: 구조상 이미 반영된다 — win 실물 빌드(Lite 1.4.0)로 확인했다.** 라이트의 두 화면은
  프로 화면을 그대로 재사용하는 **이름표**다: 내 지식→(대화창) · 내 문서→
  . 그래서 프로에 들어간 것이 자동으로 온다(포크 0).
- 실측(격리 프로필): 메뉴 2항목(🧠 내 지식·📓 내 문서)+상단 ⚙ · 내 지식에 입력칸·＋·근거띠
  전부 살아 있음 · 내 문서 탭 접힘 정상(보안제품 자료·학습·📂 지켜보는 폴더·산출물 숨김).
- ⚠ **자동으로 안 오는 것 둘**(라이트 셸이 따로라서): ①💬 대화창 온디맨드(접기/손잡이)는
  프로 셸(app.html) 전용 ②📂 지켜보는 폴더는 지정 도구가 라이트 화이트리스트 밖이라 판을
  접어 뒀다. 둘 다 켤지는 사장님 결정 사항(켜려면 라이트 셸·도구 목록을 함께 손봐야 한다).
- **max 실기 검증거리**: mac dmg로 같은 셋 확인(메뉴 2·내 지식 입력칸/＋/근거띠·내 문서 탭 접힘)
  + 연초록에서 새 카드 부품 색이 프로 색으로 새지 않는지(라이트에 소비자가 생기는 날).

### 2026-08-31 (5) — 📨 조치 요청서 판 · 길찾기 문구(0-5) · 대화 규칙 단일화

- **공용 파일 5개가 바뀌었다** — mac에서 겹칠 자리라 먼저 적는다:
  · `console.js` — ask/prefill/guideAsk가 각자 부르던 toChat을 **대화앞으로() 한 규칙**으로 모음.
    무대가 켜져 있으면 접힘만 풀어 화면을 **안 지운다**(온디맨드가 되살린 2026-08-01 결함 수리).
  · `titlebar.js` — 🔍 찾기 오버레이에 묶음 칩 5개·대화창 넘김 줄·문구 교체(0-5).
  · `gijo-ui.css` — `--g-blue-fill`/`--g-blue-fill-hover` 신설(흰 글씨 대비 3.68→5.17:1).
    **테두리·글자색용 `--g-blue`는 그대로** — 채움 자리만 갈랐다.
  · `nav.js` — ② 📓 내 문서에 「조치 요청서」 항목 추가.
  · `screenguide.ts` — 왼쪽 칸 9→10갈래·📨 판 안내·별칭.
- 서버: `remrequest.ts`에 `mine=1`(createdBy 소유 잣대, 주인 모르는 옛 줄은 안 줌) — **운영 배포 필요**.
- 관문(`publish-gate-ui.mjs`): ⓘ 검사를 사람 길(prefill)로 바꾸고 길찾기 2건 추가.
- **max 실기 검증거리**: mac dmg에서 ① 대화창을 접고 화면 ⓘ를 눌렀을 때 **화면이 안 사라지는지**
  ② 🔍 찾기의 묶음 칩·「대화창에 물어보기」 줄이 뜨는지 ③ 라이트(연초록)에서 새 채움 파랑이
  프로 색으로 새지 않는지. (라이트 셸은 titlebar.js·찾기를 안 쓰므로 ②는 프로만 해당.)

### 진행 중이라 아직 인계 대상이 아닌 것

- 규정 판정 요청함 — 시안·설계 검토 완료, 착수 전
- 💬 라이트 온디맨드 대화창 · 📂 라이트 지켜보는 폴더 — **사장님 결정 대기**(라이트 셸·도구
  화이트리스트를 함께 손봐야 한다. 위 (4) 참고)

---
