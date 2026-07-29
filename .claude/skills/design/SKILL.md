---
name: design
description: GIJO AS 디자인 작업의 단일 진입점. "디자인해줘", "화면 만들어줘", "UI 개선", "이 화면 갈아엎어줘", "레이아웃", "스타일 통일", "애니메이션 넣어줘", "모션 다듬어줘", "제품 업그레이드" 같은 요청에 사용한다. 시안 3종 먼저 만드는 프로토콜을 강제하고, 알맞은 전문 디자인 스킬로 연결하며, 이 제품의 제약(Electron + 순수 HTML/CSS/JS, gijo-ui.css 디자인 시스템, 다크 팔레트 고정, 온프렘 오프라인)을 함께 적용한다. design, UI, layout, style, animation, motion 관련 요청의 첫 관문.
---

# 디자인 (design) — GIJO AS 디자인 작업 진입점

이 스킬은 **라우터**다. 디자인 규칙을 직접 담지 않는다. 하는 일은 셋이다.

1. **시안 3종 프로토콜을 강제한다** (아래 1장 — 가장 중요)
2. 요청에 맞는 전문 스킬을 고른다 (2장)
3. 이 제품의 제약을 그 위에 덮어씌운다 (3장)

## 1. 절대 규칙 — UI 변경은 시안 3종 먼저

`CLAUDE.md`의 확립 원칙이다. **곧바로 구현하지 않는다.**

```
요청 → 시안 3종(자체완결 HTML) → 사용자 결정 → 그 다음에 구현
```

- 시안은 `mockups/<화면명>/` 아래 별도 폴더에 만든다. 기존 65개 폴더가 선례다.
- 파일명은 그 폴더 안에서 일관되게. 선례: `ds-A.html` / `ds-B.html` / `ds-C.html`,
  또는 `v1-popover.html` / `v2-toolbar.html` / `v3-select.html`.
- **자체완결 단일 HTML**이다. `<style>`을 인라인으로 넣고 외부 파일을 링크하지 않는다.
- 3종은 **진짜로 달라야 한다.** 같은 안의 색만 바꾼 것은 3종이 아니다.
- 시안에도 아래 3장의 팔레트·토큰을 그대로 쓴다. 목업이라고 색을 새로 만들지 않는다.

세 안을 낸 뒤에는 **각 안이 무엇을 노렸고 무엇을 포기했는지** 한 줄씩 붙여 사용자가
고를 수 있게 한다. 결정을 받기 전에 `client/` 코드를 건드리지 않는다.

## 2. 라우팅 표

| 사용자가 원하는 것 | 호출할 스킬 |
|---|---|
| 화면 신규·개편 (레이아웃·구조) | 1장 프로토콜 + `emil-design-eng` |
| 버튼·모달·드로어 등 컴포넌트 하나의 완성도 | `emil-design-eng` |
| 제스처·드래그·시트·스프링 물리 모션 | `apple-design` |
| 기존 애니메이션 코드 검토 | `review-animations` (직접 호출 전용) |
| 제품 전체 모션 감사 + 개선 로드맵 | `improve-animations` (코드는 안 고침) |
| 어디에 애니메이션을 넣을지 탐색 | `find-animation-opportunities` |
| "그 튕기는 효과 뭐라 부르지?" | `animation-vocabulary` |
| 차트·그래프·KPI 타일 | `dataviz` (차트 코드 쓰기 **전에**) |
| 라이브러리 선택 | `pick-ui-library` — 단, 3장의 오프라인 제약 확인 필수 |

**`prototype` 스킬은 쓰지 않는다.** 1장의 시안 3종 프로토콜이 같은 일을 하고,
이쪽이 이 저장소의 확립 규칙이다.

**`design-taste-frontend`는 이 저장소에 없고, 넣지 않는다.** 랜딩페이지·포트폴리오용
스킬이고 본문에서 대시보드·데이터 테이블·관리자 화면을 명시적으로 대상 밖으로 뒀다.
GIJO AS는 정확히 그 제외 대상이다.

## 3. 제품 제약 — 어떤 스킬을 쓰든 항상 적용

전문 스킬이 다른 전제를 깔고 있으면 **이쪽이 이긴다.**

| 항목 | 실제 |
|---|---|
| 클라이언트 | Electron. **React 아님, Tailwind 아님, 빌드 프레임워크 없음** |
| 화면 | `client/src/renderer/pages/*.html` — 순수 HTML |
| 탭 컨테이너 | `hub.html?g=X` 가 iframe으로 각 페이지를 띄움 |
| 공용 사이드바 | `nav.js` — 모든 페이지 `<head>`에 `gijo-ui.css`를 주입 |
| 디자인 시스템 | `client/src/renderer/pages/gijo-ui.css` (222줄) |
| 폰트 | Pretendard 가변폰트 **오프라인 번들** (`pages/fonts/`) |
| 목업 | `mockups/<화면명>/` |

### 지켜야 할 것

**디자인 시스템을 쓴다.**
`gijo-ui.css`에 토큰 3계층(원시→시맨틱→컴포넌트), 4px 간격 스케일, 다크 4단계 표면
계층이 이미 정의돼 있다. `--g-bg` `--g-surface-1~3` `--g-border` `--g-blue` `--g-teal`
`--g-amber` `--g-red` `--g-purple` `--g-text` `--g-muted`, 간격 `--g-s1~s6`,
라운드 `--g-r-sm/-r/-r-lg/-r-pill`. 컴포넌트는 `.g-` 접두사다.

- **새 색을 만들지 않는다.** 팔레트는 현재 유지가 원칙이다.
- 하드코딩된 hex 대신 토큰을 쓴다.
- 새 컴포넌트는 `.g-` 접두사로 만들어 `gijo-ui.css`에 넣는다. 화면별 CSS에 흩뿌리지 않는다.
- 기존 화면을 건드리게 되면 그 참에 `.g-*`로 옮긴다 (점진적 통일이 이 파일의 목적이다).

**다크 전용이다.** 라이트 모드는 없다. `prefers-color-scheme` 분기를 만들지 않는다.

**온프렘 = 완전 오프라인.**
- **CDN 링크 금지.** 폰트·아이콘·스크립트·이미지 전부. 외부 URL이 들어간 순간 고객사
  환경에서 깨진다.
- 라이브러리가 필요하면 **번들해서 동봉**해야 한다. `pick-ui-library` 추천을 받았다면
  설치 전에 이 점을 확인하고 사용자에게 먼저 묻는다.

**모션은 CSS로 먼저 푼다.**
GSAP·Framer Motion·Motion 미설치다. `transition` / `@keyframes` / Web Animations API로
해결하고, `apple-design`의 스프링 예제는 그대로 못 쓴다. `prefers-reduced-motion`
폴백을 반드시 넣는다.

**화면에 설명을 쓰지 않는다.** (2026-07-25 지시)
사용법·주의사항·용어 풀이는 전부 챗봇으로 간다 — 서버 `screenguide` panels + `ⓘ`
`gijo-info`. 화면에는 **정체성 한 줄과 ⚠ 경고만** 둔다. 신규 작업은 무조건 이 방식이고,
기존 화면도 손대는 김에 이관한다. 디자인하면서 설명 문구를 화면에 넣고 싶어지면 멈추고
screenguide에 쓴다.

**검증할 때의 함정** (실사고 기반)
- 한글 HTTP 검증에 `curl` 쓰지 말 것 — 깨진다. Node `fetch`로.
- 한글 파일 조작은 `perl` 대신 Node. `PYTHONUTF8=1`.
- `client/server-dist/package.json`은 추적 산출물 — 빌드 후 `git checkout`으로 되돌린다.

## 4. 슬래시 명령과의 관계

`.claude/commands/`의 7개는 **워크플로**(동기화·인계·배포·게시·기동)를 담당한다.
이 스킬은 **화면을 어떻게 만들 것인가**만 담당한다. 겹치지 않는다.

디자인 작업을 마치고 커밋·푸시·배포로 넘어갈 때는 `/GIJOAS인계`, `/GIJOAS배포`,
`/GIJOAS게시`를 쓴다. 이 스킬이 그 일을 대신하지 않는다.

## 5. 스킬이 없을 때

`emil-design-eng` `apple-design` `review-animations` `improve-animations`
`find-animation-opportunities` `animation-vocabulary` `pick-ui-library` 는
**계정 단위 개인 스킬**이라 다른 사람 세션에는 없을 수 있다.

없으면 멈추지 말고 **1장 프로토콜 + 3장 제약만으로 진행**하고, 어떤 스킬이 없어서
대체했는지 한 줄로 알린다. 이 두 가지가 이 스킬의 핵심이고 나머지는 보조다.
