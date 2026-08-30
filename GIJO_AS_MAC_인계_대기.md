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

### 진행 중이라 아직 인계 대상이 아닌 것

- 규정 판정 요청함 — 시안·설계 검토 완료, 착수 전

---
