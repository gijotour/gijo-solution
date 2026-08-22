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

### 진행 중이라 아직 인계 대상이 아닌 것

- 규정 판정 요청함 — 시안·설계 검토 완료, 착수 전

---
