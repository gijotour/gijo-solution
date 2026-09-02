# GIJO AS Lite — 작업 경계 (`max` ↔ `win`)

**2026-08-12 · 사장님 결정**: 제품 코드는 `win`, **라이트 구현은 `max`.**
이 문서는 그 둘이 **같은 저장소에서 안 부딪히게** 하는 규칙이다.

> 왜 필요한가: 2026-08-12 하루에 공용 파일에서 **세 번** 부딪혔다
> (`CLAUDE.md` · `2머신 가이드` · `negative.json`). 되감기와 수동 병합으로 매번 풀었지만,
> 그건 운이지 설계가 아니다. **선언만으로는 또 부딪힌다 — 파일로 갈라야 한다.**

---

## 0. 원칙 셋

1. **라이트는 「빼기」로 만든다.** 없는 기능을 새로 짜는 게 아니라 있는 것에서 고른다.
2. **빼는 방식은 「설정」이지 「분기 코드」가 아니다.** 공용 파일에 `if (tier === "lite")`를
   심기 시작하면 그 파일이 곧 충돌 지점이 된다. 라이트가 원하는 것은 **목록**이지 로직이 아니다.
3. **`max`는 새 파일만 만든다.** 기존 파일을 고쳐야 하면 그건 `win`에게 넘길 일이다(§5).

---

## 1. `max` 자유 구역 — 알릴 필요 없이 만진다

```
client/src/renderer/pages/lite-*.html      라이트 화면
client/src/renderer/pages/lite-*.js        라이트 화면 스크립트
server/src/lite/**                         라이트 전용 서버 코드·설정
tools/lite-*.mjs                           라이트 측정 도구
tools/evalgate/cases/lite-routing.json     라이트 전용 문항셋(이미 있음)
GIJO_AS_Lite_*.md · GIJO_AS_라이트_*.md     라이트 문서
```

---

## 2. `win` 전용 — `max`는 안 건드린다

```
server/src/engine/dispatcher.ts · playbook.ts · ragsanitize.ts
server/src/engine/memory.ts · hybridsearch.ts · agentloop.ts        ← 엔진
tools/evalgate/run.mjs · cases/{routing,safety,korean,negative}.json ← 게이트
.claude/commands/**                                                  ← 워크플로
CLAUDE.md · GIJO_AS_2머신_개발환경_가이드.md                          ← 조정 문서
tools/deploy-prod.ps1 · 운영·배포 일체
```

⚠ 라이트에서 엔진 결함을 발견하면 **고치지 말고 인계로 넘긴다.** 오늘 라우팅·살균이 그 방식으로
풀렸다 — `max`가 재현하고 `win`이 고쳤다. 그 분업이 셋 다 잡았다.

---

## 3. ⚠ 겹치는 여섯 곳 — 건드리지 않고 피하는 법

| 공용 파일 | 라이트가 필요한 것 | 안 건드리는 설계 |
|---|---|---|
| `server/src/engine/localengine.ts` | lite 등급 `8GB·8192` | **`win`이 한 번** 넣는다(이미 인계함). 이후 `max`는 실측값만 전달 |
| `server/src/engine/agenttools/registry.ts` | 77개 중 8~11개만 | 도구 **id 목록을 데이터로** — `server/src/lite/lite-tools.json`. registry는 안 건드림 ⚠ 고르는 훅이 없다(§5-①) |
| `server/src/engine/screenguide.ts` | 라이트 화면 설명 | 라이트 화면은 **새 id**다 — `server/src/lite/lite-screenguide.ts`에 담고 합류만 시킨다(§5-②) |
| `client/src/renderer/pages/nav.js` | 메뉴 9개 | `lite-nav.js` 별도. 공용 nav는 그대로 |
| `client/src/renderer/pages/app.html` | 라이트 탭 셸 | `lite-app.html` 별도 |
| `client/package.json` | 라이트 빌드 타깃 | **`win`이 한 번** 프로필 추가(§5-④). 이후 `max`는 안 건드림 |

---

## 4. 화면은 왜 새로 만드나 — 재사용이 더 비싸다

메뉴 9개 중 7개가 이미 있다(`dashboard`·`records`·`loganalysis`·`vulnscan`·`inventory`·`lawlookup`·`products`).
**그대로 쓰면 좋아 보이지만, 라이트에 맞추려면 그 파일들을 고쳐야 한다** — 회사 데이터 위젯을 빼고,
담당자 배정·결재를 감추고, 개인 데이터로 바꿔야 한다. 그건 전부 **공용 파일 수정**이다.

라이트 화면을 따로 두면 그 수정이 `lite-*.html` 안에서 끝난다.
**중복이 생기지만, 그 중복은 「덜어낸 화면」이라 원본을 따라갈 필요가 없다** —
본 제품에 위젯이 늘어도 라이트는 조용히 그대로다. 그게 우리가 원하는 동작이다.

⚠ **논리는 중복하지 않는다.** 화면(HTML/JS)만 따로 두고, 서버 쪽 계산·검색·살균은 공용을 그대로 부른다.

---

## 5. `win`이 한 번 뚫어 줄 「구멍」 넷 — 착수 전제

이 넷이 없으면 `max`가 공용 파일을 건드릴 수밖에 없다. **한 번만 하면 그 뒤로는 안 겹친다.**

**① 도구 고르기 훅** (`registry.ts`)
　지금 티어로 도구를 거르는 장치가 **없다**(2026-08-12 확인). 라이트는 8~11개만 써야 한다.
　▶ 필요한 것: 「이 티어에서 켜진 도구 id 목록」을 읽어 카탈로그를 거르는 자리 하나.
　　목록 자체는 `server/src/lite/lite-tools.json`에 `max`가 둔다.
　⚠ 이건 라이트만의 요구가 아니다 — 프롬프트 91% 감소가 8GB의 근거였다(라이트 사양 §3).

**② 화면 설명 합류점** (`screenguide.ts`)
　지금은 정적 구조라 라이트 화면을 붙일 자리가 없다.
　▶ 필요한 것: 외부 모듈이 화면 설명을 **추가**할 수 있는 자리 하나.
　⚠ C안(문맥 절약)이 이걸 쓴다 — 화면 설명을 프롬프트에서 빼고 문서로 미는 설계다.

**③ 라이트 티어 값** (`localengine.ts`)
　`12GB·16K → 8GB·8192`. 인계문으로 이미 넘겼다.
　⚠ `TIER_COST.lite`는 아직 옛 값이다(ctx 16384 기준). **실측 전까지 그대로 두는 게 맞다.**

**④ 라이트 빌드 타깃** (`client/package.json`)
　`npm run dist:lite` 같은 별도 산출물. 지금은 `dist` 하나뿐이다.

---

## 6. 그래도 공용을 건드려야 할 때

1. **인계문에 먼저 적는다** — 「무슨 파일을 왜」. 손대기 전에.
2. `win`이 같은 파일을 잡고 있지 않은지 답을 받고 시작한다.
3. 커밋은 **그 파일 하나만**. 다른 변경과 섞지 않는다(되감기가 쉬워진다).
4. ⚠ `git add -A` 뒤 파일 수를 센다(2026-08-12 운영 DB 397MB 사고의 처방).

---

## 7. 첫 스프린트 — 만들 파일 (구멍 넷이 뚫린 뒤)

```
server/src/lite/lite-tools.json          도구 id 목록 (8~11개)
server/src/lite/lite-screens.ts          화면 9개 정의
server/src/lite/lite-screenguide.ts      라이트 화면 설명
client/src/renderer/pages/lite-app.html  탭 셸
client/src/renderer/pages/lite-nav.js    사이드바 9개
client/src/renderer/pages/lite-dashboard.html   개인용 대시보드(새로 짜는 유일한 화면)
```

품 작은 것부터: **작업 내역(2) → 제품 소개(7) → 장비 매뉴얼(5)** — 셋 다 기존 기능을 거의 그대로 쓴다.
그다음이 개인 대시보드(1), 그다음이 로그 분석·공격경로(3)와 나만의 기억(8)이다.

---

## 8. 이 경계가 바꾸지 않는 것

> **없앨 것은 병렬 편집이지 독립 검증이 아니다**(`win`, 2026-08-12).

`max`는 계속 **재고 반박한다.** 오늘 결함 셋을 가른 것이 전부 그 역할이었다 —
「직원이 퇴사하는데」 문항, 자기 측정이 무효였다는 고백, 살균 문항이 기계마다 갈린다는 반박.
경계는 **누가 파일을 고치나**를 가르는 것이지, 누가 의심하나를 가르는 것이 아니다.
