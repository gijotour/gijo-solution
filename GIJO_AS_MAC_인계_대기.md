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

### 2026-09-01 — 클라 5.82.0 게시 · 새 도구 3종 · 화면 잣대 통일 · 검토 4라운드

> ⚠ **이 항목은 사장님이 「max 프로버전 올려 보게」 하셔서 인계 보류를 잠시 연 것**이다.
> 나머지 보류는 그대로 — 제품 완성 후 한 번에 전달한다(2026-08-22 지시).

**hub·gb10에 밀어 뒀다**(`356ebc18`). max는 `/GIJOAS동기화`로 당기면 된다.

#### ⚠ 공용 파일 변경 (mac에서 겹칠 자리 — 먼저 본다)
- **`client/src/renderer/pages/assetrules.js` — 새 파일이다.** SBOM 대상 판정을 화면들이
  **한 곳에서** 쓰게 만든 공용 부품. `<script src="assetrules.js">`를 **화면 10곳**에 실었고
  (`app.html`·`sbom.html`·`inventory.html`·`aihub.html`·`discover.html`·`fix.html`·
  `records.html`·`reporting.html`·`triage.html`·`verify.html`),
  ⚠ **grouppanels.js보다 먼저** 실려야 한다. 폴백을 일부러 없앴으므로 순서가 틀리면
  그 화면 카드가 **TypeError로 죽는다**(옛날엔 조용히 옛 값을 냈다 — 죽는 편이 낫다).
  `server/test/sbomapplies-pair.test.ts`가 순서까지 못 박는다.
- **`grouppanels.js`** — 📦 AI-BOM 판의 요약·목록이 둘 다 공용 잣대를 지난다.
- **`console.js`** — 규칙 번호 주석에서 번호를 뺐다(밀리면 뜻이 틀려져서).
- **`agentloop.ts`** — 강제 규칙 **79개**. `set_aibom_field`를 **23번 자리로 옮겼다**
  (뒤에 두면 조회 규칙이 먼저 삼켜 「기재해줘」가 영영 안 걸렸다). routes.ts 표도 함께 밀렸다.
- **`routes.ts`** — 표 79줄. ⚠ 규칙을 중간에 끼우면 표가 통째로 밀린다 —
  `node tools/routes-renumber.mjs`로 확인하고, **routes.ts 밖의 번호 참조**도 밀린다
  (새 감시 `server/test/rulerefs.test.ts`가 .ts·.js·.md를 전부 훑어 잡는다).
- **`screenguide.ts`** — 공급망 점검 안내가 「중첩은 겉만 셉니다」 → 「8겹까지 펴서 읽습니다」.
- **`CLAUDE.md`** — 작업 규칙에 **「모든 작업 보고에 gb10 이용 내역을 적는다」** 추가.

#### 새로 생긴 것
- **대화 도구 3종** — `vex_status`(VEX 현황·읽기) · `set_aibom_field`(AI-BOM 5영역 기입·쓰기)
  · `eol_check`(지원 종료 점검). 「SBOM 없는 자산」 전용 분기도(→ `sbom_coverage`).
- **도구**: `tools/dep-cluster.mjs`(의존 덩어리 재기) · `tools/digest-pack.mjs`(gb10 발췌 꾸러미)
- **시험**: `sbomapplies-pair`·`rulerefs`·`routing-order`·`clausecite`·`eolcheck`·`vextool`·
  `aibomfield`·`sbomnested` + helper `server/test/helpers/routing.ts`

#### ★ mac에서 특히 볼 것 (win에서 원리상 못 보는 것)
1. **화면 10곳이 실제로 뜨는지** — `assetrules.js` 로드 순서가 맞아야 한다.
   프로 셸 대화 홈의 **📦 AI-BOM·구성 카드**가 뜨면 통과, 안 뜨면 순서 문제다.
2. **같은 숫자를 말하는지** — 대화창 「SBOM 없는 자산 알려줘」의 건수와
   📦 화면 배지 「미생성」·현황 카드 「아직 없음」이 **셋 다 같아야** 한다.
   (전에는 대화창 12 vs 화면 4,812로 갈렸다.)
3. **📦 화면에서 [전체 재생성]** — SBOM 대상이 아닌 자산(스캐너 IP 호스트·방화벽)이
   목록에 안 나오고, 일괄 생성 대상에도 안 들어가는지.
4. **하드닝** — 인증 방식을 「로컬(서버 자신)」로 등록해 점검한 뒤,
   리포트·감사 기록·통합관제·오늘 할 일·대화 카드가 **전부** 「이 서버 자신(이름표: …)」이라
   적는지. 장비 이름만 적히면 그 자리가 안 고쳐진 것이다(9곳을 고쳤다).
5. **라이트 점검 화면**(`lite-scan.html`) — 이름표 칸에 「회의실 3-1」을 넣어도 안 막히는지,
   보증 상자 문장이 깨지지 않았는지(`</b>` 짝).

#### max 기계별 주의 (기존 그대로)
- 관리자 계정 **`jyh`**(win은 `claude-deploy`) · 키체인 `-a gijo-qa` · `GIJO_QA_USER=max_claude-qa`
- ⚠ **QA는 admin 계정으로 돌린다**(2026-09-01 확인) — QA 전용 계정은 소속 팀이 없어
  검증 계층 9건이 통째로 막힌다. 권한을 올리지 말고 계정을 바꾼다(`tools/qa-account.mjs` 머리글).

#### 운영 서버는 win에 있다
서버는 이미 win의 WSL에 배포됐다(PID 784323). max는 **자기 개발 서버**로 띄워 보는 것이고,
운영 데이터는 win에만 있다 — 숫자가 다른 건 정상이다.

## 2026-09-01 — 분할 GGUF(조각으로 나뉜 대용량 모델) 지원

**공용 파일**: `server/src/engine/localengine.ts` · `server/src/engine/hfmodels.ts` · `tools/wsl-test.sh`

- `modelFilePath()`가 `<id>/<id>.gguf`가 없으면 **분할 GGUF의 1번 조각**을 돌려준다.
  `modelFileSizeMb()`는 **전 조각의 합**을 잰다.
  → 84GB짜리 Qwen3.8-Flash-Next(3조각) 같은 모델이 이제 모델 목록·에이전트 배정에 뜬다.
- ⚠ **이름을 바꾸거나 심링크를 만들면 안 된다.** llama.cpp가 경로 끝의 `-00001-of-00003.gguf`를
  파싱해 형제 조각을 찾는다(`llama_split_prefix`) — 이름이 다르면 `invalid split file name`으로 죽는다.
  `hfmodels.ts`의 받기 창구가 분할을 계속 막는 까닭이 이것이다(받은 파일을 `<dir>.gguf`로 이름을 바꾸기 때문).
  문구는 「이 모델은 못 쓴다」 → 「이 창구로는 못 받는다(직접 넣으면 목록에 뜬다)」로 고쳤다.
- 시험: `server/test/modelsplit.test.ts` 7개. 분할 지원을 끄면 **4개가 실패**하는 것까지 확인했다(거짓 초록 아님).
- `tools/wsl-test.sh`에 `GIJO_SRC_ROOT`/`GIJO_DST_ROOT` 덮어쓰기를 넣었다 —
  전엔 메인 저장소로 고정이라 **워크트리에서 편집하면 내 변경이 아니라 메인 옛 코드를 시험**했다.

- **max 실기 검증거리**: mac에서도 분할 GGUF 폴더가 모델 목록에 뜨는지(경로 구분자 차이).
  mac에는 아직 분할 모델이 없으니, 빈 파일 3개를 `-00001-of-00003.gguf` 이름으로 놓아 목록에만 뜨는지 보면 된다.

- **공용 파일 변경(2026-09-03, AI 팀 7명·서식 전용 보조 모델)**: `server/src/engine/llm.ts` ChatArgs에 `modelOverride`(호출별 모델 지정 → localengine.ensureModelServed) · `agents.ts`에 서식 전용 보조 모델(app_state formatHelperModel, /api/agents/format-helper) · 7번째 팀원 curator · `agentloop.ts` 별칭(사서·큐레이터) · `screenguide.ts` AI 팀 7명·취약점 화면 새 도구 안내. max 실기 검증거리: Metal에서 2.3B 보조 모델이 기준 두뇌 옆에 같이 상주하는지(makeRoomFor 여유 계산이 통합메모리에서 맞는지), 스캔 초안이 5초 안에 나오는지.

- **공용 파일 변경(2026-09-03, 8번째 팀원 부품표)**: `agents.ts` AGENT_DEFS에 bom + 팀원별 `menus`(맡은 메뉴, screenguide 제목을 늦게 묶음) · `teamview.ts`·`/api/agents`에 menus/menuTitles · `agentloop.ts` 별칭(부품·부품표, 영문 bom은 sbom과 겹쳐 제외) · `screenguide.ts` 팀원 8명·공급망 안내 2줄 · 새 모듈 `bomdrafts.ts`(bom_drafts 표). max 실기 검증거리: 사무실 8석(넓은 창 4줄×2열)·설정 AI팀 구성 카드의 📌 맡은 메뉴 칩 줄 높이(11px 하한 감시 통과 여부).

---
- **공용 파일 변경(2026-09-03 오후, 팀원별 증류 재료 — 커밋 474d063e)**: `server/src/engine/learnloop.ts`(TOPICS 5개 「일반」·topicSlug export·질문주제 일반 규칙) · `server/src/engine/memory.ts`(categorizeByRules 용어사전→일반 파일명 규칙) · `server/src/engine/agenttools/handlers.ts`(주제별칭 일반/용어/개념) · `server/src/engine/agenttools/registry.ts`(topic 설명 5개) · `server/src/engine/licenserisk.ts`(등급표문서() export) · `client/src/renderer/pages/learnloop.html`(.lt-일반 배지·주제색·이름순) · `client/src/renderer/pages/grouppanels.js`(🎓 학습 카드 5주제) · `tools/distill.mjs`(TOPICS·TOPIC_RE 일반) · 새 파일 `tools/gen-license-doc.mjs`·`server/test/licensedoc.test.ts`. max에서 볼 것: 학습 화면(learnloop.html) 주제 띠가 5칩으로 폭 안에 들어가는지 · 🎓 카드 5칸 · `node tools/gen-license-doc.mjs --check`가 0인지(dist 필요).

- **공용 파일 변경(2026-09-03 오후, 📚 침해사고 히스토리 — 해설 팀원의 두 번째 부르는 문, 사장님 「결정 모두 승인 진행」)**: 갈래 D(사례의 샘·안내·문서)가 만진 것 — `server/src/engine/screenguide.ts`(GUIDES 열쇠 `incidentcases.html` 안내 · PANEL_ALIASES · 화면별칭 복합어 4개 · 흡수자리 한 줄 · agent.html 「모델 배정」 한 줄) · `server/src/engine/agents.ts`(normaltic role/desc, menus []는 유지 + 사유 주석) · `server/src/engine/llm.ts`(normaltic 프롬프트 — 사례는 히스토리에서 찾은 것만) · 새 파일 `server/src/engine/incidentsources.json`(사례의 샘 28곳 — 링크만). 같은 묶음의 다른 갈래(공통 계약)가 만지는 공용 파일 — ⚠ 마이그레이션 2건은 `db.ts`가 아니라 **표를 쓰는 엔진 옆**에 있다(`db.ts`는 이 묶음에서 변경 없음): `server/src/engine/incidentcases.ts` 머리의 `migrate("incident-cases-2026-09-03", …)`(표 incident_cases) · `server/src/engine/scandrafts.ts`의 `migrate("scan-drafts-cases-2026-09-03", …)`(scan_drafts에 caseIds·caseNote 열 추가) — mac에서 옛 DB로 올릴 때 이 두 이름이 마이그레이션 기록에 찍히는지로 확인한다 · `agenttools/registry.ts`·`handlers.ts`(도구 4종 incident_cases·register_incident_case·delete_incident_case·incident_sources · 별칭 히스토리/사고 사례/사례의 샘) · `scandrafts.ts`(초안 직후 훅 explainSimilarCases · env GIJO_CASE_EXPLAIN_MS/GIJO_CASE_EXPLAIN) · `vitest.config`(GIJO_CASE_EXPLAIN=0) · 새 화면 `client/src/renderer/pages/incidentcases.html`(메뉴 항목 아님 — 카드로 연다) · `grouppanels.js`·`aihub.html`(AI 허브 5번째 판 카드, 띠 auto-fit) · `agent.html`(「📚 히스토리」 단추) · `console.js`·`vulnscan.html`(「📚 비슷한 사례 N건」 칩) · 새 엔진 `incidentcases.ts`·씨앗 `incidentcases-seed.json`. 통합 수리(같은 날) 뒤 git 대조로 확정한 나머지 공용 파일 — `server/src/app.ts`(라우트 등록 2건 registerIncidentCaseRoutes·registerScanDraftRoutes) · `server/src/index.ts`(기동 시 사례→지식 문서 동기화 syncIncidentCaseDocsWithRetry, 임베딩이 뜬 뒤) · `server/src/engine/memory.ts`·`docdigest.ts`·`docdupe.ts`(origin `incident-case` 문서를 새 문서 배지·대장·중복 후보에서 제외 — 씨앗 수십 건이 「새 문서」로 쏟아지지 않게) · `datacleanup.ts`(incident_cases는 제품 지식이라 실사용 전환에서 안 지움) · `terms.ts`(별칭 6개 — 「사례」 홑말은 report.ts 취약점 사례와 겹쳐 제외)·`tone.ts`(머리표 사례=📚) · `server/scripts/copy-assets.mjs`(새 json 2개는 있으면 옮기고 없으면 경고만 — 씨앗 없이 게시되면 빌드 로그에 남는다) · `client/src/preload.ts`(incidentCases·incidentCasesSimilar·incidentSources 3창구, 위치 인자 관례 — 객체로 부르면 500) · `client/src/api/security-ops.ts`(IncidentCase 타입 — createdAt/updatedAt는 ms 숫자·techniques/cves/products는 배열, 읽기 전용 다리) · `tools/publish-gate-ui.mjs`(📚 판 fail-closed 관문) · `server/test/wiringcontract.test.ts`(incidentcases.html=부품 분류). ✎ **게시 커밋(05cbbfaa) 확정본으로 정정**(이 줄을 처음 적은 시점은 통합 수리 중이라 「agentloop.ts·routes.ts 변경 없음」이라 적었으나, 통합 갈래가 그 뒤에 만졌다) — `server/src/engine/agentloop.ts`: FORCED_INTENTS **4규칙 추가**(register_incident_case·delete_incident_case·incident_sources·incident_cases)와 표 항목 `argsByModel`(도구는 못 박고 인자만 모델이 뽑는 첫 사례 — 칸이 여덟이라 정규식으로 못 가른다) · `server/src/engine/routes.ts`: 그 4규칙의 길 4줄(FORCED_INTENTS[79]~[82]) — ⚠ **자리 번호로 가리키는 표**라 규칙을 중간에 끼우면 통째로 어긋난다, 손대면 `node tools/routes-renumber.mjs --write` · `server/src/engine/vulnscan.ts`: `importVulnScan` 끝의 **반입 훅**(state=new·CVE 있는 항목만 모아 `explainSimilarCasesForImport` 한 번, webreport format은 초안 훅이 맡으므로 건너뜀 — 이중 발화 금지). **max 실기 검증거리**: 📚 판 실화면(카드로만 열린다 — 팀원 카드 「📚 히스토리」·AI 허브 판 카드·취약점 카드 칩, 메뉴엔 없음) · 같은 연도 안에서 최근 등록이 위인지(createdAt 숫자 정렬) · 📚 판 행 30px·머리 26px가 mac 폰트에서 유지되는지 · 출처 링크가 기본 브라우저로 열리는지(에어갭이면 안 열리는 것이 정상) · 사례의 샘 띠의 한글 이름·주기 폭 · 스캔 초안 뒤 「📚 비슷한 사례 N건」 칩이 Metal에서 8초 예산 안에 붙는지(⚠ **늦어도 칩은 붙는다** — 예산을 넘기면 AI 부연만 빠지고 규칙이 찾은 사례 제목 줄이 저장된다. 칩이 아예 안 뜨면 그건 예산 탓이 아니라 후보 0 또는 창구 결함이니 그때 보고할 것) · 화면 ⓘ가 `incidentcases.html` 안내를 받는지(일반 개요가 뜨면 탭 주소가 안 넘어간 것) · AI 허브 띠가 5칸을 한 줄에 놓는지(좁으면 줄바꿈이 정상).

- **공용 파일 변경(2026-09-03 밤, 📚 히스토리 후속 수리 — 커밋 73f17e53 · 클라 5.88.1)**: `server/src/engine/incidentsteps.ts`(장애아님에 **등록·삭제 명령 꼴** 추가 — 「사례 등록: …」이 장애말(중단·멈춤·죽었·접속이 안 되던·다운)에 채여 장비 장애 초동 절차가 나가고 등록이 안 되던 것, gb10 격리 실측 6문장 중 5) · `server/src/engine/screenguide.ts`(📚 판 안내의 상한을 코드와 맞춤 — 「최대 200건」은 거짓, 서버 clamp는 **500**이고 칩 좁힘은 **50**) · `client/src/preload.ts`(`incidentCasesSimilar(cves, limit?)` — 다리가 limit을 실제로 넘긴다) · `client/src/api/security-ops.ts`(「다리가 아직 안 넘긴다」 낡은 주석 정정) · `client/src/renderer/pages/vulnscan.html`(칩의 N을 **서버 total**로 — cases 줄 수로 세면 6건 이상이 늘 「5건」) · `client/src/renderer/pages/incidentcases.html`(?cve= 좁힘이 limit 50) · `tools/publish-gate-ui.mjs`(지식창고 KPI 검사의 **경합** 수리 — 비동기 렌더를 기다렸다 잰다, 커밋 f095d421). **max 실기 검증거리**: mac에서 대화창 「사례 등록: 2017년 … 서버 150여 대가 랜섬웨어로 멈춘 사건 … 출처 https://…」가 **결재판**으로 뜨는지(장애 초동 절차가 나오면 이 수리가 안 실린 것) · 반례 「방화벽이 멈췄어 어떻게 해」는 여전히 초동 절차인지 · 취약점 카드 「📚 비슷한 사례 N건」 칩의 N과 판을 열었을 때 머리글 수가 같은지(다르면 다리가 limit을 안 넘긴 것) · 판 ⓘ 안내에 「최대 500건」이 적혀 있는지.

## 2026-09-07 자율 운용 루프(답 지적 두 번째 원장·유령 문서 표시)·마감 라운드
- 공용 파일 변경: `server/src/engine/screenguide.ts`(구역 7 신설: approvals 답 지적·수정 초안, supervision 고칠 것, mydocs 조각이 없는 문서, 공통 「이 답 이상해요」·「대화창에 얹지 못했습니다」, memory 조각 없음 표시 + 별칭 표 3·근거 지정 문장 분리) · `server/src/engine/agentloop.ts`(FORCED_INTENTS 끝: 기한 지난 일→urgent_todo·점검 일정→maintenance_status·조각 없는 문서→doc_chunk_gaps) · `server/src/engine/routes.ts`(renumber 87) · `.claude/commands/GIJOAS게시.md`(1단계 lock 두 자리·빌드 완료 판정·prefill·관문 검사 4) · `.claude/commands/GIJOAS배포.md`(6″ 확인용 로그인도 로그아웃·sqlite3 CLI 부재·한글 wsl 명령·잣대 둘) · `CLAUDE.md`(시안 px는 제품에서 잰다 · 공유 트리 --amend 금지).
- 새 표·칸: answer_feedback에 fixkind/noev/quotes/draft/draftModel + status resolved(마이그레이션) · memory_documents 스키마 불변(listDocuments가 ledgerChunks·docState 두 칸을 응답에 실음).
- 새 도구: doc_chunk_gaps(라이트 허용목록 포함)·reingest_document(라이트 보류). 기존 도구 answer_feedback_status는 admin 전용.
- max가 실기 검증할 것: 결재판 「💬 답 지적」 세그먼트·대화창 꼬리 「이 답 이상해요」(위젯 포함)·문서함 「조각 없음」 칩·「↩ 다시 넣기」 — 전부 프로 셸. 라이트: 꼬리는 뜨고 결재판·재인입은 없음(안내가 그렇게 말함).
- 클라 판: 5.91.0·5.91.1 게시됨, 5.92.0 예정(이 라운드).

- 2026-09-08 **공용 파일 memory.ts·docsbundle.ts** — 표 청킹 수리(ⓐ3): cleanExtractedText 첫 줄에서 CRLF→LF 정규화 · 표 구분선·진짜 머리글은 반복 줄 제거 예외 · chunkText가 표를 갈라도 그 표의 머리글+구분선을 다음 조각 앞에 재부착(한 블록 두 표는 각자 머리글) · 겹침 꼬리 줄머리 맞춤·앞머리 고아 표행 버림 · 상한 계약 = size+overlap+머리글값. `CHUNKER_VERSION`(2026-09-08-table-2)을 docsbundle의 문서 해시 한 곳에 섞어 **판이 오르면 매니페스트 35편만 자동 재인입**(사용자 업로드 무관) · 재인입 전 임베딩 생존 확인(죽어 있으면 안 지움) · 등급·올린이 표찰 되돌림 · 청커 구간 소스 지문↔판 짝 감시. max에서는 Metal 올인원 첫 기동 때 35편 재인입(약 1,500조각)이 한 번 돈다 — 기동이 길어지는 것이 정상.
- 2026-09-08 tools/gb10-test.sh — 하네스 기록(.tmp-reports)은 사본에 안 담는다(등급 C 조각 본문). 실행줄 무변경, 소스 감시는 폴더 이름으로.
- 2026-09-08 **공용 파일 screenguide.ts** — 화면 안내 판정(isHelpIntent)이 제품 도구를 비켜 준다: 구역 이름이 강제 도구의 주제어와 같을 때 「값을 달라는 꼬리」(알려줘·보여줘·있어?·현황·목록…)는 도구로, 「뜻을 묻는 꼬리」(뭐야?·무엇)와 안내 낱말(사용법·설명·방법·어떻게)은 안내로. 판정은 요청자 역할(currentViewer)을 함께 본다(admin 전용 도구). 새 export 구역이름들() + 감시 시험 panelname.test.ts(구역 이름 165개 × 꼬리 10종 전수, 사유 있는 명부만 허용). agents.ts 주석 갱신. max에서 할 일 없음(서버 동작만).
- 2026-09-08 tools/ops-sim.mjs·opssim-evidence.mjs — 야간 하네스 `--no-evidence`(또는 GIJO_OPSSIM_EVIDENCE=0) 스위치: 근거 조각 본문을 안 적고 가드횟수·근거기록끔만 남긴다. 파일럿·출하 기계는 이 스위치로(계획서 §14 「출하 전 되돌리기」).
- 2026-09-08 **dataset.ts·scripts/extract_doc.py** — 워드·pptx OOXML 표를 파이프 표로 추출(깊이 세는 스캐너 · 병합 셀 빈 칸 · 셀 안 | 이스케이프 · 표 밖 글은 글자 단위 동일). 파이썬 오피스 4갈래(docx·pptx·xlsx·hwpx)는 제품 경로에서 도달 불가라 삭제 — 파이썬은 PDF-OCR·이미지·txt 계열만. 추적되던 .pyc 2개는 새 .py에 맞춤(gitignore 정리는 백로그). max 실기 확인 사항: 없음(서버 동작). PDF 표 복원은 미포함(오탐).
- 2026-09-08 **공용 파일 memory.ts** — 반복 줄 제거 예외에 「머리글+구분선이 앞선 표 안의, 열 수 같은 본문 행」 추가(표본문행 자리) · CHUNKER_VERSION 2026-09-08-table-4(내장 35편 재인입 1회 · 조각 결과는 동일).
- 2026-09-08 **agentloop.ts FORCED_INTENTS[28]**(`workflow_status`) — 업무 흐름 규칙의 「(단계|절차)+뭐냐」 갈래를 우리 5단계 이름·지시어(지금·현재·이번·이·그·우리·전체)로 좁힘. 자리 불변.
- 2026-09-09 **공용 파일 dataset.ts + 새 파일 engine/pdftable.ts** — **PDF에 그려진 표(테두리 격자)를 파이프 표로 복원**. pdf.js 연산자 목록에서 CTM을 추적해 얇은 축정렬 선분을 모으고, 교차선을 연결성분으로 묶어 격자를 만든 뒤 칸별로 글자를 담아 낸다(여러 줄 셀은 한 칸으로 합쳐진다). 파이프 렌더링은 dataset.ts의 `파이프표()`·`칸글()`을 **그대로 재사용**(export만 추가) — 두 벌이 되면 규격이 갈린다. 격자가 하나도 없으면 종전 `extractText` 갈래로 지나가 **글자 단위 동일**. 저장소 PDF 10편 실측: 표 73개·오탐 0·낱말 손실 0. 테두리 없는 표(배경색만·탭 정렬만)·회전 쪽·쪽 넘김 이어붙이기·스캔 PDF(OCR)는 **안 한다**(정직).
  - ★★ **max에서 반드시 확인할 것 — Node 판본.** pdf.js가 글꼴 정보를 담을 때 `ArrayBuffer.prototype.transferToFixedLength`(ES2024)를 쓰는데 **Node 20에는 없고, pdf.js가 그 오류를 삼켜** 표가 조용히 하나도 안 나온다(win Node 24는 초록 · 운영 WSL Node 20은 전멸이었다 — 실측 2026-09-09). `pdftable.ts`에 **없을 때만 채우는 폴리필**을 넣어 해결했다. mac 올인원·라이트 이미지에서도 `node -v`와 함께 **표가 실제로 나오는지**(추출본에 `| --- |`가 있는지) 눈으로 확인할 것.
  - 재인입 주의: **이미 들어간 PDF의 표는 안 살아난다** — 「다시 넣기」는 추출본을 다시 넣는 도구지 재추출이 아니다. 표를 살리려면 그 PDF를 **다시 올려야** 한다.
- 2026-09-09 **공용 파일 webreport.ts + pdftable.ts**(위 PDF 표 복원의 사후 검토 수리 3건) — 검토관 5건 중 3건을 고쳤다.
  - ★ **[상] 웹취약점 보고서 파서가 표에 걸려 넘어졌다.** `autoupload.tryWebReport`가 같은 `extractDocumentText`를 쓰는데, 그 파일의 정규식은 「표가 평평하게 풀린 글」을 전제로 쓰였다. 테두리를 그린 보고서가 오면 **진단항목 사전 5종 → 0종**(문서가 「하」라고 적은 위험도를 잃고 전부 medium이 된다) · **자산 이름 "SafeKey 발급 웹 서버" → "| SafeKey 발급 웹 서버"**(그 이름이 vulnscan의 `dnsName`으로 자산 등록에 그대로 실린다). WSL Node 20에서 제품 코드로 재현했다. 고침: `webreport.ts`에 **표풀기()** — 「머리글+구분선」으로 제대로 선 표만 평평한 줄로 되돌린다(표 없는 글은 한 글자도 안 바뀐다). 위험도 칸은 **코드가 든 칸 바로 뒤에** 「위험도 하」로 붙여 사전 규칙이 걸리게 한다. 짝 시험 11개(테두리 판과 평평한 판의 파싱 결과가 같아야 한다).
  - ★ **[중] 메모리 — 큰 PDF 한 편이 서버 메모리를 삼켰다.** 표가 있든 없든 전 쪽의 연산자 목록을 만드는데, 거기 딸린 **디코딩 이미지**를 쪽마다 놓아 주지 않았다. 고침: `쪽비우기()`(page.cleanup()). 실측(WSL Node 20): 운영 uploads의 10.1MB·29쪽 상품소개서 **742MB → 282MB**. 작은 문서에서는 차이가 흔들림에 묻힌다 — 값어치는 「평소가 빨라진다」가 아니라 **큰 문서가 메모리를 안 삼킨다**이다.
  - ★ **[중] 픽스처가 못 가르던 갈래를 시험으로 덮었다.** 손으로 구운 픽스처 PDF는 pdf.js의 **빈 글자 항목**을 안 낳아서, 표 복원 전체를 지탱하는 줄(빈 항목도 구간에 넣는다)과 회전 가드가 **아무 시험에도 안 걸렸다**(그 줄을 빼면 실제 PDF 표가 18→0으로 전멸하는데 짝 시험 7개는 전부 초록이었다). 이제 `쪽조립()`에 항목을 직접 먹이는 단위 시험 6개가 그 갈래를 가른다(변이 3종으로 빨강 확인).
  - 낮음 2건은 **기록만 고쳤다**: 쪽 넘김 표가 「유일한 1건」이 아니라 **후보 5건**(주석 수정) · 앞 보고의 「10편 합계 106,414자」는 틀렸고 **106,812자**가 맞다(게시본으로 재측정 — 표 73개·오탐 0·문서별 표 수는 전부 일치).
  - max 실기 확인 사항: **없음**(서버 동작). 다만 위 Node 판본 확인 항목은 그대로 유효하다.

- 2026-09-10 **공용 파일 memory.ts·dataset.ts + 새 파일 engine/tabletext.ts** — 「무엇이 표인가」를 한 곳으로 모았다(갈래 U).
  네 벌이던 잣대(memory 술어 · webreport 사본 · inspectionreport 인라인 사본 · dataset 렌더러)를 **잎 모듈**(import 0) 하나로 옮겼다.
  술어는 한 글자도 안 고쳤고 코퍼스 지문이 그대로다(지식 24편 · 조각 1,226 · 고아 0). **CHUNKER_VERSION은 안 올렸다**(자를 결과 불변) — 재인입 없음.
  ★ 곁따라 고쳐진 **살아 있는 결함 4종**(점검 결과보고서 Word/PDF 내보내기 — 사용자가 쓴 md가 personaldocs로 그대로 온다):
    칸 안 파이프가 칸을 늘리던 것 · 정렬 구분선(`|:---|---:|`)이 표에 찍히던 것 · 대시만 든 본문 행을 버리던 것(데이터 손실) · 들여쓴 표가 문단으로 떨어지던 것.
  ⚠ **client/src/renderer/pages/gijomd.js:57-59는 안 고쳤다**(이번 0줄) — 클라 렌더러가 아직 5번째 잣대다(구분선을 훨씬 헐겁게 본다). 게시 영역이라 다음 게시 라운드로 미룬다.
  ⚠ tools/lib/vendor-manifest.mjs:30-33도 6번째 사본으로 남아 있다(.mjs라 .ts를 못 문다 — dist 경유가 필요).
  max 실기 확인 사항: **없음**(서버 동작).
  ★ 같은 날 **뒷수리**(검토관 적발 3건) — 위 수리가 새로 연 자리 둘을 닫았다:
    ㅁ GFM 정규 구분선 `|-|-|`(칸마다 대시 하나)이 본문 행으로 떨어져 `-` 행이 Word/PDF에 찍히던 것 —
       `| - | - |`(ㄷ)과는 **칸 안 공백**으로 가른다. 두 갈래는 언제나 함께 고친다.
    ㅂ 파이프로 **시작만** 한 줄이 표에 1칸 행으로 들어가 칸 수가 3,3,1,3으로 찌그러지던 것 —
       tabletext:표행맞추기() 하나로 HTML·DOCX가 함께 폭을 맞춘다(넘치는 칸은 안 버린다).
    CHUNKER_VERSION은 이번에도 **안 올렸다** — 홑대시 구분선이 매니페스트 35편·지식 24편에 0줄이라
    자를 결과가 안 바뀐다(코퍼스 1,226조각 동일로 재확인). 지문만 1613802d6cc0으로 갱신.
- 2026-09-10 **dataset.ts pptx 갈래** — 「[슬라이드 N]」 경계(sldIdLst 차례)·SmartArt(ppt/diagrams data)·차트(chart·chartEx, 범주×계열 파이프 표, 차트_최대점 1024)·「(노트)」 제 장 뒤. pptx 골든이 새 계약으로 바뀜(tableextract 「pptx 새 계약」 절).
- 2026-09-10 **새 잎 모듈 tabletext.ts** — 표 읽기·쓰기 잣대 단일 출처(import 0). memory.ts·dataset.ts·webreport.ts·inspectionreport.ts가 import. 사본 감시(server/src). 청커 판 불변(-table-4). ⚠ client gijomd.js는 아직 자기 잣대(게시 라운드 후보).
- 2026-09-10 **llm.ts resolveRemoteTarget()** — 원격 두뇌 판정 한 곳: ⓪ 총괄은 항상 로컬 → ① 팀원 위치 local이면 로컬 → ② 전역 원격. searchrewrite.ts는 항상 로컬(remotellm 미참조). 운영에서 전역 원격 ON(gb10 4000 내주기 창구·토큰은 app_state) + report·normaltic 원격 배정 상태로 둠 — max 올인원에서는 전역 원격을 켜지 않는 한 무영향.
- 2026-09-10 **observability.ts** — 자가 진단 느린 답은 시각·소요·경로만(질문 본문 없음) · GET /api/slow-answers admin 전용 · 팀원 표시 이름은 말투 규범 통과 때만 답에 실림.
