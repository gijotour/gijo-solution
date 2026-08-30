// nav.js — GIJO AS 네비게이션 (시안 B: 아이콘 레일 + 서브패널).
// 모든 페이지의 <div id="gijoNav"> 안에 [얇은 아이콘 레일 | 서브패널]을 그린다. 레일에서 대분류를
// 고르면 그 분류의 기능이 서브패널에 나오고, 항목을 클릭하면 그 페이지로 이동한다(기존 멀티페이지
// 구조 유지 — 페이지별 대량 수정 없이 좌측 IA만 시안 B로 교체하는 저위험 방식).
// 스타일은 페이지 :root 토큰(--panel-2·--border·--blue…)을 그대로 쓰므로 다크 테마와 일관된다.

(function () {
  // 🚀 프로 셸 여부 — **동기로** 읽는다(2026-08-18).
  // ⚠ 이 파일은 app.html이 동기로 싣고 `render()`가 그 자리에서 끝난다. 비동기 값
  //   (shellModeGet)은 이미 늦어 표준 사이드바가 한 번 그려진 뒤에 도착한다.
  //   그래서 `embed=1`·`popout=1`과 **같은 관례**로 주소에서 읽는다.
  var PRO = /(^|[?&])shell=pro(&|$)/.test(location.search);
  // 4.0.0에서 허브(2단 탭)를 걷어냈다 — 화면이 곧 메뉴 항목이고, 여러 화면은 셸 탭으로 열어 둔다.
  // ── 전체메뉴(4.0.0) — 허브(2단 탭)를 없애고 화면을 그대로 늘어놓는다 ──────────
  //
  // 왜 풀었나: 화면을 탭으로 열어 두는 구조가 되면서 "탭 안의 탭"이 생겼다. 셸 탭 → 허브 →
  // 실화면이면 겹이 3중이 되는데, 그 3중이 바로 빈 화면 사고의 자리였다(2026-07-28).
  // 겹을 셸→실화면 2겹으로 고정하려면 중간의 허브를 걷어내야 한다.
  //
  // 메뉴가 11개에서 30개로 다시 길어진다(2026-07-23 통합을 되돌리는 셈). 그래도 괜찮은 이유는
  // 메뉴의 역할이 달라졌기 때문이다 — 자주 쓰는 화면은 탭으로 열어 두고 오가므로, 메뉴는
  // "처음 한 번 찾으러 가는 곳"이 된다. 그룹 4개는 그대로 둬서 훑기 쉽게 한다.
  //
  // 이름은 홀로 서게 지었다: 허브 안에서 '통합 뷰'·'등록부'로 충분하던 것이 밖으로 나오면
  // 무엇의 통합 뷰인지 알 수 없다 → '자산 통합 뷰'·'보안제품 등록부'.
  // 항상 맨 위에 고정되는 세 자리(2026-07-28 사용자 지시) — 즐겨찾기보다도 위다.
  // 하루에 몇 번씩 돌아오는 곳이라 가지에 넣어 두면 접었다 폈다 해야 한다.
  //  · 대시보드   — 어디로 갈지 정하는 집
  //  · 팀 사무실  — AI 근무 현황·오늘 브리핑(별도 창이라 주소가 없다 → 별표 대상 아님)
  //  · 작업 내역  — 지금까지 AI와 한 일. '작업 세션'에서 이름을 바꿨다(2026-07-28 사용자 지시)
  //    — '세션'은 로그인 세션과도 헷갈리는 개발자 말이고, 이 화면은 결국 한 일의 기록이다.
  // fixed:true — 이 셋은 늘 맨 위에 있으므로 즐겨찾기 별표를 달지 않는다.
  // ── 단선 아이콘 한 벌 (2026-08-05, 시안 nav-refine-v1 승인) ─────────────────
  // 왜 이모지를 걷어내나: **컬러 이모지는 색을 우리가 못 정한다**(운영체제 폰트가 정함).
  //   그래서 옆 글자가 흐릴 때도 이모지만 쨍하게 남아 톤이 겉돌고, 업무 도구보다 장난감처럼
  //   보인다. 단선 SVG는 stroke:currentColor라 **글자와 같은 색으로 밝아지고 어두워진다**.
  // ⚠ 아이콘은 여기 한 곳에서만 만든다 — 화면마다 베끼면 굵기·크기가 갈라져 한 벌이 아니게 된다.
  // ⚠ label에는 넣지 않는다. label은 탭 이름·검색 결과·즐겨찾기에 그대로 따라다닌다.
  var ICON = {
    home:   '<path d="M2 6.5 8 2l6 4.5"/><path d="M3.5 7.4V13.5h9V7.4"/>',
    office: '<rect x="2.5" y="2.5" width="7" height="11"/><path d="M9.5 6.5h4v7h-4"/><path d="M4.5 5h3M4.5 7.5h3M4.5 10h3"/>',
    chat:   '<path d="M13.5 9.5a1.5 1.5 0 0 1-1.5 1.5H6l-3 2.5V4a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13.5 4z"/>',
    book:   '<path d="M3.4 3.2h4.2c.9 0 1.6.7 1.6 1.6v8c0-.7-.6-1.3-1.3-1.3H3.4z"/><path d="M12.6 3.2H9.2v10c0-.7.6-1.3 1.3-1.3h2.1z"/>',
    star:   '<path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
    target: '<circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.4"/>',
    check:  '<path d="M2.5 8.4 6 11.9l7.5-7.8"/>',
    shield: '<path d="M8 1.8 13.6 4v4c0 3.4-2.4 5.4-5.6 6.2C4.8 13.4 2.4 11.4 2.4 8V4z"/><path d="M5.8 7.9 7.4 9.5l3-3.2"/>',
    chart:  '<path d="M2.4 13.4h11.2"/><path d="M4.6 13.4V8M8 13.4V3.8M11.4 13.4V6.4"/>',
    drawer: '<rect x="2.2" y="3.4" width="11.6" height="2.8"/><path d="M3.4 6.2v6.4h9.2V6.2M6.4 8.9h3.2"/>',
    chip:   '<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1"/><path d="M6.6 2.2v2.4M9.4 2.2v2.4M6.6 11.4v2.4M9.4 11.4v2.4M2.2 6.6h2.4M2.2 9.4h2.4M11.4 6.6h2.4M11.4 9.4h2.4"/>',
    slider: '<path d="M2.4 4.6h11.2M2.4 8h11.2M2.4 11.4h11.2"/><circle cx="5.6" cy="4.6" r="1.5"/><circle cx="10" cy="8" r="1.5"/><circle cx="6.8" cy="11.4" r="1.5"/>',
  };
  function iconSvg(name) {
    var d = ICON[name];
    if (!d) return null;
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    s.setAttribute("class", "gn-ic");
    s.setAttribute("aria-hidden", "true");   // 뜻은 옆 글자가 말한다 — 읽어 주면 두 번 읽힌다
    s.innerHTML = d;
    return s;
  }

  var TOP = [
    { page: "dashboard.html", label: "대시보드", icon: "home", fixed: true },
    // ⚠ 별도 창으로 여는 항목은 **win에 여는 함수 이름을 적는다**(preload의 window.gijo.*).
    //   예전엔 `office: true` 같은 항목별 표시를 두고 클릭 처리에서 이름을 하나씩 봤는데,
    //   문서함을 더할 때 그 분기를 안 더해서 **메뉴를 눌러도 아무 일도 안 났다**(4.9.0 실사고).
    //   page가 없는 항목이 탭 열기로 떨어져 undefined 탭을 여니 조용히 실패한다.
    //   win을 보고 처리하면 새 창 항목을 더해도 클릭 처리를 고칠 일이 없다.
    { win: "openTeamOffice", label: "팀 사무실 (창)", icon: "office", fixed: true },
    // ⚠ 「내 업무」 메뉴는 없앴다(2026-08-01 사용자 지시 — "내업무 메뉴는 삭제하고 그 안에
    //   있는 모든 내용은 대화창에서"). 목록·담기·완료·절차 밟기는 전부 대화창 도구로 옮겼다:
    //   picklist 결정적 목록 + add_task·complete_task·work_steps·step_done·step_undo·routine_tasks.
    //   화면을 되살릴 일이 있으면 그 도구들과 겹치지 않게 먼저 정리할 것.
    // 문서함(별도 창)은 내 문서 허브에 흡수됐다(2026-08-20 승인 시안 docs-hub-v3 — 「모든 문서는
    // 여기서」). hidden 항목을 남기는 이유는 상단 🔍 화면 찾기 — 「문서함」 옛 이름으로 찾아도
    // 새 자리(내 문서 → 📘 제품 안내 탭)에 닿아야 한다.
    // (「GIJO AS 안내」·「보안제품 비교·소개」는 TOP 숨김에서 **🧠 내 지식 그룹으로 이사**했다 —
    //  2026-08-28 사장님 「우리 제품은 내 지식이 강조되어야 해」. 숨김은 검색으로만 닿았는데,
    //  제품의 차별점(축적되는 지식)이 메뉴에서 안 보이는 게 문제였다. 입구는 하나다 — 복제 아님.)
    // 흡수된 화면의 옛 이름 — 🔍 화면찾기와 옛 링크가 죽지 않게(문서함 흡수 때와 같은 방식).
    { page: "mydocs.html?tab=contacts", label: "나만의 연락처", icon: "book", fixed: true, hidden: true },
    // 내 문서(2026-08-20 사장님 — LLM 위키·나만의 문서 관리). 개인 메모·공유 관리 화면.
    // ⚠ fixed:true — TOP 항목 규약. 없으면 ☆가 그려지는데 즐겨찾기 렌더는 GROUPS만 뒤져
    //   눌러도 아무 일도 안 일어난다(2026-07-28 결함 재발 — 검토관 중8).
    { page: "mydocs.html", label: "내 문서", icon: "book", fixed: true },
    // GIJO Smart MD Studio — 로그인한 고객에게 주는 **무료** 문서 작성 도구(2026-08-14 사장님 결정).
    // 별도 창이라 page가 아니라 win이다(위 ⚠ 규약). 설치본에 안 담겼으면 여는 쪽이 안내를 낸다.
    // ⚠ 이름 끝의 「(창)」은 규약이다 — menu-sweep이 그 표기로 창 항목을 건너뛴다(navwiring 시험).
    //   무료 표시는 그 **뒤에** 붙인다: (창) 앞에 끼우면 스윕이 못 알아본다.
    // ⚠ **「문서 작성 (창)」(Smart MD Studio)은 2026-08-22에 없앴다** — 사장님 「내 문서에서
    //   문서작성을 할 거니 팝업은 필요없어」. 캡처 붙여넣기·템플릿·버전 이력·4형식 내보내기가
    //   전부 「내 문서」 안으로 들어왔다(약속했던 목록을 그대로 옮겼다).
    { page: "sessions.html", label: "작업 내역", icon: "chat", fixed: true },
  ];

  var GROUPS = [
    // ══ 업무 절차 5단계 (2026-08-02 사용자 승인 — 시안 mockups/menu-workflow) ══════════
    //
    // 왜 바꿨나: 예전 그룹은 **데이터 종류**로 묶여 있었다(관제/자산·조치/보안제품/AI/플라이휠).
    //   담당자가 하는 일은 **절차**인데 메뉴는 창고라, 취약점 한 바퀴(발견→우선순위→조치→검증→보고)를
    //   도는 데 그룹 3개를 오가고 방향이 위→아래→위로 꺾였다(실측).
    //   근거는 우리 문서에 이미 있었다 — GIJO_AS_취약점관리_지침.md 1절:
    //   "GIJO AS의 메뉴도 이 4단계에 맵핑되어야 한다. 정적 목록만 보여주면 실패다."
    //   바깥 표준(생애주기 6단계·Tenable Exposure Response·워크플로형 내비게이션)도 같은 방향이다.
    //
    // ⚠ 표준의 6단계 중 "지속 감시"는 **메뉴로 만들지 않는다** — 그건 화면이 아니라 스케줄러가
    //   늘 하는 일이고, 결과는 ① 발견으로 들어온다. 메뉴를 늘리는 대신 루프가 ①로 돌아오게 둔다.
    // ⚠ 네 업무(취약점·보안제품 운영·AI 보안·보안로그)가 **같은 5단계**를 돈다. 그래서 업무별로
    //   메뉴를 따로 만들지 않는다 — 그러면 메뉴가 4배가 되어 원점이다.
    // ── ⓪ 자산 — **단계가 아니라 범위 축**이다(승인 시안 mockups/자산_0단계, 2026-08-18).
    //   「무엇을 지키는지」를 먼저 고르면 ①~⑤가 그 자산으로 좁혀진다.
    // ⚠ id를 `s0-…`로 짓지 않는다. `workflow.test.ts`가 `id: "s${no}-`로 1~5만 훑으므로
    //   s로 시작해도 안 걸리긴 하지만, 다음 사람이 「왜 시험이 이걸 안 잡지」로 헤맨다.
    //   이건 절차가 아니라는 것을 **이름에서** 드러낸다.
    // ══ 🧠 내 지식 — 첫 그룹 (2026-08-28 사장님 「우리 제품은 내 지식이 강조되어야 해」) ══════
    //
    // 왜 맨 앞인가: 이 제품의 차별점은 절차 도구가 아니라 **쓸수록 쌓이는 지식**인데,
    //   재편 전 메뉴에서 지식은 숨김 2(비교·안내)·허브 속 1(지식창고)·잡동사니 속 1(법령)로
    //   흩어져 있었다 — 정체성이 안 보였다. 홈(내 문서) 바로 아래 첫 그룹이 곧 제품 서사다.
    // ⚠ 전부 **있는 화면의 자리 이동**이다(새 화면 0) — 승인 시안 GIJOAS_v2/04.
    //   TOP 숨김에 있던 비교·안내는 여기로 이사(복제 아님), 법령은 「추가 기능」에서 이사.
    { id: "knowledge", icon: "book", label: "🧠 내 지식", items: [
      // 지식 창고 — 올린 문서·AI가 아는 것(memory 흡수 자리와 같은 주소, TAB_REDIRECT·로스터 관례 재사용).
      { page: "aihub.html?panel=knowledge", label: "지식 창고" },
      { page: "mydocs.html?tab=vendor", label: "보안제품 비교·소개 (옛 제품 소개자료)" },
      // 법령·판례 — 조항마다 법을 자동으로 붙이는 대신 **물어볼 때 찾는다**(법은 자주 개정돼
      // 붙여 둔 것이 금세 낡는다). 연동이 꺼져 있어도 메뉴는 보인다(감추면 「왜 안 보이지」가 새 질문).
      { page: "lawlookup.html", label: "법령·판례" },
      { page: "mydocs.html?tab=guide", label: "GIJO AS 안내 (옛 문서함·제품 안내)" },
    ]},
    { id: "assets0", icon: "drawer", label: "⓪ 자산", items: [
      { page: "assets.html", label: "자산 고르기" },
    ]},
    { id: "s1-find", icon: "search", label: "① 발견·수집", items: [
      // 그룹 통합 1호(2026-08-09 사용자 승인) — 세 메뉴는 discover 허브의 한눈에 띠+무대로.
      // 개별 화면(analysis·threat·inventory)은 파일 그대로 살아 허브 안 끼움 창으로 열린다.
      { page: "discover.html", label: "발견·수집" },
    ]},
    // 그룹 통합(2026-08-09 사용자 지시) — 다섯 절차 그룹은 각각 허브 한 화면이다.
    // 개별 화면은 파일 그대로 살아 허브 무대(끼움 창)에서 열린다.
    { id: "s2-triage", icon: "target", label: "② 우선순위", items: [
      { page: "triage.html", label: "우선순위" },
    ]},
    { id: "s3-fix", icon: "check", label: "③ 조치", items: [
      { page: "fix.html", label: "조치" },
    ]},
    { id: "s4-verify", icon: "shield", label: "④ 검증", items: [
      { page: "verify.html", label: "검증" },
    ]},
    { id: "s5-report", icon: "chart", label: "⑤ 보고", items: [
      { page: "reporting.html", label: "보고" },
    ]},

    // ── 기반 — 절차가 아니라 **참조하는 대장**이다. 절차 아래에 둔다. ────────────────
    // 보안제품(옛 「등록부」, 2026-08-21 승인 시안 menu-reorg) — 「제품」이 사이드바 3곳에서
    //   다른 뜻이던 것을 이름으로 가른다: products=우리가 운영 중인 것, intro=비교용 외부 카탈로그.
    //   둘을 같은 그룹에 모아 「우리 것 ↔ 비교용」 대비가 이름만으로 드러난다(항목 2개 → 일반 그룹).
    // ⚠ id(registry)는 **그대로 둔다** — workflow.test.ts가 ⑤ 보고 구간의 **끝 경계**로 그 id
    //   문자열을 찾는다. 바꾸면 5단계 감시가 깨진다. 바꾸는 건 label과 항목뿐이다.
    // ⚠ intro.html 항목은 이 경계 **뒤**(그룹 안)라 ⑤ 슬라이스에 안 들어간다 — 5단계 표 무영향.
    // ⚠ **「보안제품 비교·소개」(intro.html)는 2026-08-22에 내 문서로 흡수됐다**
    //   (사장님 「보안제품 비교·소개 → 내 문서함에 통합」). 이제 「내 문서 > 📦 보안제품 자료」다.
    //   옛 링크·🔍 화면찾기는 아래 TOP의 숨은 항목이 받는다 — 문서함을 흡수할 때와 같은 방식이다.
    //   ⚠ `id: "registry"` 문자열은 **그대로 둔다** — workflow.test.ts가 ⑤ 보고 구간의 끝 경계로
    //     이 문자열을 찾는다. 항목이 하나만 남아도 그룹을 **풀면 안 된다**: 문자열이 사라지면
    //     그 시험이 폴백으로 떨어져 **조용히 틀린 슬라이스를 잰다**(설계관 2026-08-22 경고).
    { id: "registry", icon: "drawer", label: "보안제품", items: [
      { page: "products.html", label: "우리 보안제품" },
    ]},
    // 공급망 점검(2026-08-22 사장님 「메인 메뉴로 하나 빼줘도 될 것 같아」) — 납품받을 제품의
    //   부품표(SBOM)를 읽어 **어떤 라이선스 의무를 지게 되는지** 본다.
    //   계기: 우리가 PyMuPDF(AGPL)를 설치본에 동봉했다가 게시 직전에 걸렸다. 고객사도 같은 문제를 겪는다.
    // ⚠ 자리는 **registry 그룹 뒤**여야 한다 — workflow.test.ts가 ⑤ 보고 구간의 끝 경계로
    //   `id: "registry"` 문자열을 찾으므로, s5-report와 registry **사이**에 끼우면 이 그룹의
    //   page가 5단계 화면으로 세어져 시험이 깨진다(설계관 2026-08-22 적발).
    // ⚠ 파일명은 **소문자 영문만** — 같은 시험의 정규식이 `[a-z]+\.html`이라 하이픈·숫자를 쓰면
    //   자리를 잘못 놓아도 시험이 조용하다(감시를 살리려면 이 관례를 지킨다).
    { id: "supplychain", icon: "drawer", label: "공급망", items: [
      { page: "supplychain.html", label: "공급망 점검" },
    ]},
    // AI 운영 — 예전 「AI」와 「데이터 플라이휠」 두 그룹을 합쳤다. 6개면 한 그룹으로 충분하고,
    // 담당자에게 둘의 차이(기능 vs 되먹임 고리)는 우리 사정이지 업무 구분이 아니었다.
    // AI 운영도 허브 한 화면으로 통합(2026-08-09 사용자 지시 — "고객한테 가이드하는 화면으로").
    // 에이전트·지식·학습·안전장치는 aihub 무대에서 열린다. 합성(merge)은 문서함 가이드로.
    { id: "aiops", icon: "chip", label: "AI", items: [
      { page: "aihub.html", label: "AI" },
      // (「AI 팀 감독」 독립 메뉴는 2026-08-20 사장님 「AI팀 메뉴에 안전장치 통합」으로
      //  AI 허브 4번째 탭(팀 감독·안전)에 흡수 — 승인 시안 aiteam-guard-merge. 옛 링크는
      //  TAB_REDIRECT가 받는다.)
    ]},
    // 설정 5구역(2026-07-28) — 기준은 기능이 아니라 **결정권자**다.
    // 내 것 / 모두의 것(서버·AI) / 바깥과 잇는 것 / 관리자만 / 보기만.
    // 같은 settings.html을 ?s= 로 걸러 보여준다(파일을 쪼개면 공통 스크립트가 어긋난다).
    // ⚠ 인수인계를 여기로 옮겼다 — 「업무 관리」 그룹에 항목이 하나뿐이었다. 하나짜리는 그룹이 아니다.
    // 추가 기능(2026-08-09 사용자 지시) — 절차 5단계에 안 얹히는 부가 기능들의 자리.
    //   alwaysGroup: 항목이 1개여도 대표 메뉴로 접지 않는다.
    // ⚠ 「제품 소개자료」는 여기 있다가 2026-08-21 승인 시안(menu-reorg)으로 **보안제품 그룹**에
    //   「보안제품 비교·소개」란 이름으로 옮겼다 — 두 곳에 두지 않는다.
    { id: "extras", icon: "drawer", label: "추가 기능", bottom: true, alwaysGroup: true, items: [
      { page: "loganalysis.html", label: "보안 로그 파일 분석" },
      // (법령·판례는 🧠 내 지식 그룹으로 이사 — 2026-08-28. 원 설계 주석도 그쪽에 있다.)
      { page: "handover.html", label: "업무 넘기기" },
    ]},
    // 설정 그룹 정리(2026-08-09 사용자 지시) — 7줄에서 3줄로.
    //   · 내 설정·서버·AI·연동·관리자는 **같은 settings.html의 탭**이라 사이드바 나열이 중복
    //     이었다 → 「설정」 한 줄. 화면 안 탭·기존 바로가기("설정 > 서버·AI")는 그대로 동작.
    //   · 기록 보기+시스템 로그 → 「기록」 허브(records.html) — 누가 무엇을 했나(감사)와
    //     서버가 무엇을 했나(진단)를 한 자리에서, 판으로 갈라 본다.
    //   · 업무 넘기기는 설정이 아니라 업무 행위 — 통합하지 않고 별도로 둔다(사용자 지시).
    { id: "settings", icon: "slider", label: "설정", bottom: true, items: [
      { page: "settings.html?s=my", label: "설정" },
      // 업무 넘기기는 「추가 기능」 그룹에 있다(2026-08-09 사용자 재확인 — 두 곳에 두지 않는다).
      { page: "records.html", label: "기록" },
    ]},
  ];

  // ⚠ **셸이 탭 이름을 찾을 수 있게 내준다**(2026-08-18 사장님 QA 발견: 탭에 `discover.html?p…`).
  //   셸(app.html)은 `open(page, label)`에서 이름이 없으면 **파일명을 그대로** 쓴다. 그런데
  //   아래 TAB_REDIRECT가 옛 화면 23개를 허브(`?panel=…`)로 넘기면서 이름은 안 바꿔 주고,
  //   셸의 「옛탭」 표에는 그중 4개만 손으로 적혀 있어 **19개가 파일명을 드러냈다.**
  //   ⇒ 표를 더 채우지 않는다(그게 4/23이 된 방식이다). **이름의 주인은 여기(GROUPS)**이므로
  //     셸이 여기서 찾아 쓰게 한다 — 메뉴 이름이 바뀌면 탭 이름도 저절로 따라온다.
  //   ⚠ 읽기 전용으로만 쓴다. 셸이 이 배열을 고치면 사이드바가 조용히 어긋난다.
  try { window.gijoNavGroups = GROUPS; } catch (e) {}

  // 없어진 화면의 옛 주소 → 흡수처. 허브를 걷어낸 뒤로는 화면이 곧 주소라 딥링크가 필요 없고,
  // **사라진 화면만** 여기서 돌려보낸다(기존 바로가기·챗봇 링크가 죽지 않게).
  var TAB_REDIRECT = {
    "reference.html": "settings.html?s=my",     // 기능 안내 → AI가 대신(2026-07-25)
    "billing.html": "audit.html",               // 사용량·요금 → 기록 보기
    "mcp.html": "settings.html?s=link",         // 2026-07-28 설정 5구역으로 흡수
    "update.html": "settings.html?s=admin",
    "logs.html": "syslog.html",   // 2026-08-02 시스템 로그를 다시 떼어냈다
    "llmguide.html": "settings.html?s=ai",      // 추천 모델 목록 → 설정 서버·AI
    "docenrich.html": "memory.html",            // 문서 보강 → 기억·학습에 병합
    // 2026-08-02 업무 절차 개편에서 합친 두 화면.
    // ⚠ 흡수처를 안 적으면 **열어 둔 탭이 영구 빈 화면**이 된다(셸이 localStorage의 탭을
    //   그대로 복원해 iframe에 물린다 — mywork 때 겪은 것과 같은 사고).
    "opsguide.html": "maintenance.html",       // 제품 유지보수 → 정기 점검에 흡수
    // 「자산 통합 뷰」는 자산 목록으로 합쳤다(2026-08-02) — 같은 자산을 두 화면에서
    // 보던 것을 하나로. 옛 링크·북마크·열어 둔 탭이 막다른 길이 되지 않게 돌려보낸다.
    "assethub.html": "inventory.html",
    // 「보안제품 비교·소개」를 내 문서 📦 탭으로 흡수(2026-08-22) — **파일을 지웠다.**
    // ⚠ 이 표는 **셸을 거쳐 여는 길**만 받는다(메뉴·🔍 화면찾기·navigateTo).
    //   localStorage에 저장된 탭 복원은 app.html의 `옛탭` 표가 받는다 — 파일이 없으면
    //   nav.js가 실리기 전에 로드가 실패해서, 여기 적는 것만으로는 안 막힌다.
    //   **두 곳 다** 적어야 한다(2026-08-22 검토관 [높음]: 여기도 저기도 없었다).
    "intro.html": "mydocs.html?tab=vendor",
    "intro.html?embed=1": "mydocs.html?embed=1&tab=vendor",
    // 발견·수집 그룹 통합(2026-08-09) — 세 메뉴는 discover 허브가 받는다. 열어 둔 탭(?embed=1)과
    // 쿼리 없는 직접 링크 둘 다 흡수. ⚠ 허브 무대(?embed=1&hub=1)는 키가 달라 여길 안 탄다 —
    // 태우면 허브 안에서 허브를 또 여는 무한 중첩이 된다.
    // ②③④⑤ 그룹 통합(2026-08-09) — 개별 화면 링크·열어 둔 탭을 해당 허브로(판 켠 채).
    // AI 운영 그룹 통합(2026-08-09) — 옛 링크·열어 둔 탭을 AI 허브로(판 켠 채).
    // 설정 그룹 정리(2026-08-09) — 기록 화면 2종을 허브로(판 켠 채).
    "audit.html": "records.html?panel=audit",
    "audit.html?embed=1": "records.html?embed=1&panel=audit",
    "syslog.html": "records.html?panel=syslog",
    "syslog.html?embed=1": "records.html?embed=1&panel=syslog",
    "agent.html": "aihub.html?panel=team",
    "agent.html?embed=1": "aihub.html?embed=1&panel=team",
    "memory.html": "aihub.html?panel=knowledge",
    "memory.html?embed=1": "aihub.html?embed=1&panel=knowledge",
    "learnloop.html": "aihub.html?panel=learning",
    "learnloop.html?embed=1": "aihub.html?embed=1&panel=learning",
    "redteam.html": "aihub.html?panel=safety",
    "redteam.html?embed=1": "aihub.html?embed=1&panel=safety",
    // AI 팀 감독 독립 메뉴 흡수(2026-08-20 aiteam-guard-merge) — 옛 링크·즐겨찾기 보호
    "supervision.html": "aihub.html?panel=safety",
    "supervision.html?embed=1": "aihub.html?embed=1&panel=safety",
    "vulnscan.html": "triage.html?panel=vuln",
    "vulnscan.html?embed=1": "triage.html?embed=1&panel=vuln",
    "sbom.html": "triage.html?panel=sbom",
    "sbom.html?embed=1": "triage.html?embed=1&panel=sbom",
    "approvals.html": "fix.html?panel=approvals",
    "approvals.html?embed=1": "fix.html?embed=1&panel=approvals",
    "maintenance.html": "fix.html?panel=maintenance",
    "maintenance.html?embed=1": "fix.html?embed=1&panel=maintenance",
    "terminal.html": "fix.html?panel=terminal",
    "terminal.html?embed=1": "fix.html?embed=1&panel=terminal",
    "hardening.html": "verify.html?panel=hardening",
    "hardening.html?embed=1": "verify.html?embed=1&panel=hardening",
    "report.html": "reporting.html?panel=report",
    "report.html?embed=1": "reporting.html?embed=1&panel=report",
    "kpi.html": "reporting.html?panel=kpi",
    "kpi.html?embed=1": "reporting.html?embed=1&panel=kpi",
    "compliance.html": "reporting.html?panel=compliance",
    "compliance.html?embed=1": "reporting.html?embed=1&panel=compliance",
    "analysis.html": "discover.html?panel=analysis",
    "analysis.html?embed=1": "discover.html?embed=1&panel=analysis",
    "threat.html": "discover.html?panel=threat",
    "threat.html?embed=1": "discover.html?embed=1&panel=threat",
    // ⓪ 자산이 생기면서 자산의 **첫 자리**가 바뀌었다(2026-08-18 승인 시안).
    // ⚠ **`hub=1`이 붙은 주소는 여기 안 걸린다**(아래 갈아타기 적용부의 예외). 그게 자산
    //   관리(inventory)로 가는 **유일한 탈출구**다 — assets.html의 「전체 관리 열기」가
    //   `inventory.html?hub=1`로 여는 이유다. 그 한 글자가 없으면 관리 화면을 열려고 눌러도
    //   이 표가 ⓪로 되돌려 **영영 못 간다**(오류도 안 난다 — 그냥 같은 화면이 다시 뜬다).
    "inventory.html": "assets.html",
    "inventory.html?embed=1": "assets.html?embed=1",
    "ontology.html": "memory.html",             // 온톨로지 → AI 지식(관계 탭)에 흡수
    // 내 업무 → 대시보드(2026-08-01 화면 폐지, 그 일은 대화창이 받는다). ⚠ 이걸 빼면
    // **업데이트 전에 「내 업무」 탭을 열어 둔 담당자**의 그 탭이 영구 빈 화면이 된다
    // (셸이 localStorage의 탭을 그대로 복원해 iframe에 물린다). 검토 지적 2026-08-01.
    "mywork.html": "dashboard.html",
    // 쿼리 없는 옛 설정 링크(각 화면 헤더 ⚙ 등 20곳) — 5구역 어느 것도 아니면 서버·AI로.
    // 빠뜨리면 분리창에서 설정 20구역이 한 화면에 전부 쌓인다(2026-07-29 검토 #3).
    // ⚠ ?s=가 붙은 정상 링크는 아래 boot의 "빈 쿼리일 때만 흡수" 규칙 덕에 여길 안 탄다.
    "settings.html": "settings.html?s=ai",
    // hub.html 리다이렉트는 여기 둘 수 없다(2026-07-29 검토 #8) — 파일이 삭제돼 nav.js가
    // 실리기 전에 로드가 실패한다. 없는 화면의 안전망은 main.ts navigate:to가 맡는다.
  };
  window.gijoRedirects = TAB_REDIRECT; // QA가 "죽은 링크인지 흡수처인지" 가릴 때 쓴다

  function currentPage() {
    return decodeURIComponent((location.pathname || "").split("/").pop() || "");
  }
  // 지금 보고 있는 화면 = 메뉴 항목의 주소. 설정처럼 한 파일이 여러 구역인 화면은 쿼리까지 봐야
  // 어느 항목이 활성인지 가려진다(settings.html?s=admin ≠ settings.html?s=ai).
  function currentKey() {
    var file = currentPage();
    var q = location.search || "";
    var m = /[?&]s=([a-z]+)/.exec(q);
    return m ? file + "?s=" + m[1] : file;
  }
  function go(page) { if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(page); }
  // (openChatHere 삭제, 2026-08-20 정찰 확인) — hub.html 삭제 뒤 호출부 0곳의 죽은 배관이었다.
  // 챗봇 열기는 같은 문서의 window.gijoOpenChat 직접 호출만 남긴다(gijo:openChat 메시지 폐지).
  // 허브에서 현재 열려 있는 탭(3단계) — t 파라미터. 없으면 null(첫 탭이 활성).
  function currentTabPage() {
    var m = /[?&]t=([^&]+)/.exec(location.search || "");
    return m ? decodeURIComponent(m[1]) : null;
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function groupOf(key) {
    for (var i = 0; i < GROUPS.length; i++) {
      for (var j = 0; j < GROUPS[i].items.length; j++) if (GROUPS[i].items[j].page === key) return GROUPS[i];
    }
    return GROUPS[0];
  }

  // ══ GIJO 공용 목록 양식 (2026-08-02, 시안 mockups/list-unified) ══════════════════
  // ⚠ **양쪽 경로에서 다 불러야 한다.** 탭(임베드) 안에서는 injectCss가 돌지 않아,
  //   여기에만 넣으면 화면을 탭으로 열었을 때 양식이 통째로 빠진다(2026-08-02 실측 —
  //   요약막대 때 똑같이 겪고도 또 밟았다). 그래서 문자열을 함수로 빼 두 곳에서 부른다.
  function 목록양식CSS() {
    // ⚠ 괄호 필수. `return ""` 다음 줄에서 자바스크립트가 문장을 **자동으로 끝내(ASI)**
    //   아래 + "…" 줄들이 통째로 죽은 코드가 된다. 빈 문자열만 돌아와 양식이 사라졌었다
    //   (2026-08-02 실측 — 화면에서 td 여백이 그대로여서 알았다. 빌드·문법 검사로는 안 잡힌다).
    return (""
      // 기준 화면은 **시스템 로그**다 — 사용자가 "내가 좋아하는 스타일"로 지목했고,
      // 첫째 기준은 **칸 낭비 최소화**다("시안은 낭비 최소화가 메인이야 앞으로도 그렇게").
      // 화면마다 카드·표가 제각각이던 것을 [상자 하나 + 줄]로 통일한다.
      //
      // 왜 공용 파일 한 곳인가: 화면 30개를 각자 고치면 통일은 반년이면 다시 흐트러진다.
      //   여기만 고치면 표식(.gj-list 등)을 단 화면이 전부 같이 바뀐다.
      //
      // 쓰는 법 — 화면에서는 표식만 단다.
      //   <div class="gj-chips">…<span class="gj-chip on">전체</span>…</div>
      //   <div class="gj-list" data-gijo-fit>
      //     <div class="gj-row"><span class="k">08-01</span><span class="gj-tag t-blue">방화벽</span>
      //       <span class="bd"><b class="t">이름</b><span class="s">· 부제</span></span>
      //       <span class="rt">만료 <b>2026-11-30</b></span></div>
      //   </div>
      //
      // ⚠ 부제(.s)는 **아랫줄로 내리지 않는다** — 내리는 순간 줄 높이가 두 배가 된다.
      //   이름 옆에 잇고 칸을 넘으면 …으로 줄이되 title 속성으로 전문을 남긴다.
      // ⚠ 색(t-*)은 **상태에만** 쓴다. 장식으로 흔해지면 위험 신호가 안 보인다.
      + ".gj-list{background:var(--panel,#30302e);border:1px solid var(--border,rgba(255,255,255,.08));" +
        "border-radius:10px;padding:2px 0;overflow-y:auto;min-height:120px;}"
      // 「네모칸 안에서만 움직인다」(2026-08-02 사용자 지시) — 화면 전체가 구르면 제목·칩이
      // 위로 밀려 사라져, 지금 무엇을 보고 무엇으로 걸렀는지를 잊는다. 높이는 gijoFitList가 잰다.
      + ".gj-row{display:flex;gap:10px;align-items:baseline;padding:6px 14px;" +
        "border-bottom:1px solid rgba(255,255,255,.045);font-size:12.5px;line-height:1.35;}"
      + ".gj-row:last-child{border-bottom:none;}"
      + ".gj-row:hover{background:rgba(59,130,246,.05);}"
      + ".gj-row.on{background:rgba(59,130,246,.12);}"
      + ".gj-row>.k{color:var(--muted-2,#a49d95);font-size:12px;white-space:nowrap;width:96px;flex:0 0 auto;}"
      + ".gj-row>.bd{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
      + ".gj-row>.bd .t{color:var(--text,#e9e7e2);font-weight:600;}"
      + ".gj-row>.bd .s{color:var(--muted-2,#a49d95);font-size:12px;margin-left:7px;}"
      + ".gj-row>.rt{color:var(--muted-2,#a49d95);font-size:12px;white-space:nowrap;flex:0 0 auto;}"
      + ".gj-row>.rt b{color:var(--text-strong, #fff);font-weight:800;font-size:12.5px;}"
      + ".gj-tag{font-size:11.25px;font-weight:800;padding:1px 6px;border-radius:4px;white-space:nowrap;flex:0 0 auto;}"
      + ".gj-tag.t-red{background:rgba(226,72,61,.16);color:var(--red-ink,#f5928a);}"
      + ".gj-tag.t-amber{background:rgba(240,160,32,.16);color:var(--amber,#f0a020);}"
      + ".gj-tag.t-teal{background:rgba(30,185,128,.16);color:var(--teal,#1eb980);}"
      + ".gj-tag.t-blue{background:rgba(59,130,246,.16);color:var(--blue-light,#5fa1ff);}"
      + ".gj-tag.t-purple{background:rgba(139,124,240,.16);color:var(--purple,#8b7cf0);}"
      + ".gj-tag.t-gray{background:rgba(255,255,255,.08);color:var(--muted,#b3ada4);}"
      + ".gj-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:7px;}"
      + ".gj-chip{background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));" +
        "color:var(--muted,#b3ada4);padding:3px 10px;border-radius:20px;font-size:11.75px;font-weight:700;cursor:pointer;}"
      + ".gj-chip.on{background:rgba(59,130,246,.15);border-color:var(--blue,#3b82f6);color:var(--blue-light,#5fa1ff);}"
      + ".gj-search{margin-left:auto;background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));" +
        "border-radius:8px;padding:4px 10px;font-size:11.75px;color:var(--text,#e9e7e2);outline:none;width:200px;}"
      + ".gj-id{font-size:12.25px;color:var(--muted,#b3ada4);margin:0 0 7px;}"
      + ".gj-empty{padding:22px;text-align:center;color:var(--muted-2,#a49d95);font-size:12.5px;}"
      // 두 칸을 한 칸으로 — 목록이 가로를 다 쓰면 이름이 안 잘린다.
      + ".gj-onecol{display:block !important;}"
      // 화면이 목록에 준 고정 폭(예: 330px)을 푼다 — 한 칸으로 폈으면 가로를 다 써야 이름이 안 잘린다.
      + ".gj-onecol > *{max-width:none;width:100% !important;min-width:0;flex:none;}"
      // 누른 줄 바로 아래 자세히 — 왼쪽 파란 선으로 "위 줄에 딸린 것"임을 보인다.
      + ".gj-underrow{box-shadow:inset 3px 0 0 var(--blue,#3b82f6);border-radius:0 8px 8px 0;" +
        "margin:0 0 6px 0;min-height:0 !important;position:relative;}"
      + ".gj-picked{background:rgba(59,130,246,.12);}"
      // 요약 줄 + 상단 버튼을 한 줄로 — 버튼은 오른쪽 끝에 붙는다.
      + ".gsum-host{display:flex !important;align-items:center;gap:10px;flex-wrap:wrap;}"
      + ".gsum-host > .gsum-acts{margin-left:auto;}"
      // 목록 줄을 **한 줄**로(2026-08-02 사용자 지시 "가능하면 한 줄로 나오게 하고").
      // 제목·부제가 위아래로 쌓이면 한 줄이 두세 줄이 된다 — 옆으로 잇고 넘치면 …으로 줄인다.
      // ⚠ 자세히 칸(.gj-underrow)은 여러 줄이 정상이라 건드리지 않는다.
      // ⚠ 엑셀형 부품(.g-rows-*)은 제외한다(검토관 2026-08-20 상1) — 이 flex 강제가
      //   그룹 묶음(.g-rows-body)에 걸리면 그룹 안 행 전체가 한 줄로 눕고, grid 행에 걸리면
      //   열 정렬이 죽는다. 그 목록은 스스로 30px 행을 보장하므로 여기 도움이 필요 없다.
      + ".gj-rows1 > *:not(.gj-underrow):not(.g-rows-body):not(.g-rows-gh):not(.g-rows-head){display:flex !important;align-items:baseline;gap:8px;" +
        "white-space:nowrap;overflow:hidden;padding-top:5px;padding-bottom:5px;min-height:0;}"
      + ".gj-rows1 > *:not(.gj-underrow):not(.g-rows-body):not(.g-rows-gh):not(.g-rows-head) > *{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;margin:0;}"
      + ".gj-rows1 > *:not(.gj-underrow):not(.g-rows-body):not(.g-rows-gh):not(.g-rows-head) > *:nth-child(2){flex:1;}"
      // ⚠ 「2번째가 제목」은 **체크박스가 없을 때만** 맞다(2026-08-08 실사고, 사용자 신고
      //   "색깔표시가 너무 길어"). 조치·승인 줄은 [체크박스][점][본문][배지]라 2번째가 점이었고,
      //   8px 점이 **307px 색 막대**로 늘어나 줄의 절반을 먹었다.
      //   크기가 고정된 표식(체크박스·점)은 늘리지 않고, 그 뒤 칸을 대신 늘린다.
      + ".gj-rows1 > *:not(.gj-underrow) > input,"
      + ".gj-rows1 > *:not(.gj-underrow) > [class*=dot]{flex:0 0 auto;}"
      + ".gj-rows1 > *:not(.gj-underrow) > input:nth-child(1) ~ [class*=dot]:nth-child(2) ~ *:nth-child(3),"
      + ".gj-rows1 > *:not(.gj-underrow) > [class*=dot]:nth-child(2) ~ *:nth-child(3),"
      + ".gj-rows1 > *:not(.gj-underrow) > input:nth-child(2) ~ *:nth-child(3){flex:1;}"
      // ⚠ 같은 함정을 **딱지(배지)**가 또 밟았다(2026-08-09 사용자 신고 "앞에 취약점이 긴
      //   이유가 있어?"): 통합 관제 줄은 [순번][소스 딱지][본문][우선순위]라 2번째가 딱지였고,
      //   글자 3자짜리 딱지가 **540px 빨간 막대**로 늘어나 줄의 3분의 1을 먹었다.
      //   점·체크박스만 예외로 두면 다음 화면에서 또 터진다 — **크기가 내용에 맞아야 하는 표식
      //   전부**(딱지·칩·태그·배지·순번·우선순위)를 고정하고, 본문 칸을 대신 늘린다.
      + ".gj-rows1 > *:not(.gj-underrow) > .src,"
      + ".gj-rows1 > *:not(.gj-underrow) > .pri,"
      + ".gj-rows1 > *:not(.gj-underrow) > .rank,"
      + ".gj-rows1 > *:not(.gj-underrow) > [class*=badge],"
      + ".gj-rows1 > *:not(.gj-underrow) > [class*=chip],"
      + ".gj-rows1 > *:not(.gj-underrow) > [class*=tag]{flex:0 0 auto;}"
      // 본문 칸이 이름을 달고 있으면(.rr-main·.bd·…-main) 그 칸을 늘린다 — 자리 순서가 아니라
      // **뜻**으로 고른다. 이름이 없는 줄은 위의 2번째 규칙이 그대로 맡는다.
      + ".gj-rows1 > *:not(.gj-underrow) > [class*=main],"
      + ".gj-rows1 > *:not(.gj-underrow) > .bd{flex:1 1 auto;min-width:0;}"
      // 줄 안에서 제목·부제를 **세로로 쌓아 둔 판**도 눕힌다(통합 관제·작업 내역이 그렇다).
      + ".gj-rows1 > *:not(.gj-underrow) > div{display:flex;align-items:baseline;gap:7px;min-width:0;}"
      + ".gj-rows1 > *:not(.gj-underrow) > div > *{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}"
      // 줄 바로 아래 자세히(gijoRowDetail) — 오른쪽 별도 패널을 대신한다.
      // 왼쪽 파란 선으로 "위 줄에 딸린 것"임을 보인다. 상자 밖으로 튀어나가지 않는다.
      + ".gj-detail{padding:9px 14px 11px 18px;font-size:12.25px;line-height:1.6;color:var(--muted,#b3ada4);" +
        "background:rgba(59,130,246,.05);border-bottom:1px solid rgba(255,255,255,.045);" +
        "box-shadow:inset 3px 0 0 var(--blue,#3b82f6);}"
      + ".gj-detail b{color:var(--text,#e9e7e2);}"
      // 자세히를 닫는 ✕ — 오른쪽 위 모서리에 얹는다(내용을 가리지 않게 자리를 따로 안 준다).
      + ".gj-detail{position:relative;}"
      + ".gj-detail-x{position:absolute;top:6px;right:8px;z-index:2;width:22px;height:22px;padding:0;"
      + "display:flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;"
      + "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);"
      + "color:var(--muted-2,#a49d95);font-size:12px;line-height:1;}"
      + ".gj-detail-x:hover{background:rgba(226,72,61,.3);color:var(--text-strong, #fff);border-color:rgba(226,72,61,.6);}"
      + ".gj-detail .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;}"
      + ".gj-detail .acts button,.gj-detail .acts a{background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));" +
        "color:var(--blue-light,#5fa1ff);border-radius:7px;padding:4px 11px;font-size:11.75px;font-weight:700;" +
        "cursor:pointer;text-decoration:none;font-family:inherit;}"
      + ".gj-detail .acts button:hover,.gj-detail .acts a:hover{border-color:var(--blue,#3b82f6);}"
      + ".gj-list::-webkit-scrollbar{width:5px;} .gj-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px;}"

      // 표도 같은 밀도로 — 화면 14곳이 <table>을 쓰는데 여백이 제각각(줄 34~48px)이었다.
      // 여기 한 곳을 고치면 그 화면들이 전부 같이 줄어든다(줄 약 28px).
      // ⚠ !important를 쓰지 않는다. 이 CSS는 화면 <style> **뒤에** 붙고 `.main table td`가
      //   화면의 `.tbl td`보다 선택자가 세서 그대로 이긴다 — 억지로 덮으면 나중에 못 되돌린다.
      + ".main table{border-collapse:collapse;width:100%;font-size:12.5px;}"
      + ".main table th{padding:5px 10px;font-size:11.75px;line-height:1.35;}"
      + ".main table td{padding:5px 10px;line-height:1.35;vertical-align:middle;}");
  }

  function injectCss() {
    if (document.getElementById("gijoNavCss")) return;
    var st = document.createElement("style");
    st.id = "gijoNavCss";
    // 탭 셸(app.html) 안에서는 셸이 이미 자기 격자를 갖는다 — 여기서 .app을 다시 잡으면
    // 탭줄·화면·콘솔 4단 배치가 무너진다(4.0.0). 사이드바 모양만 주고 레이아웃은 셸에 맡긴다.
    var IN_SHELL = !!window.gijoTabs;
    st.textContent =
      // 통일 사이드바(2026-07-25): 아이콘 레일 폐기 → 단일 232px 3단 컬럼(상단 세그먼트 고정 · 중앙
      // 메뉴 스크롤 · 하단 사용자 영역 titlebar.js). 전 화면 100vh 고정으로 통일.
      (IN_SHELL ? "" :
      ".app{grid-template-columns:232px minmax(0,1fr) 46px !important;height:100vh;}"
      // 창 고정(2026-07-26 사용자 결정): 페이지 스크롤 없음 — 본문 열만 내부 스크롤, 오른쪽 46px는
      // 엣지 탭 거터(스크롤바와 절대 안 겹침). 임베드 프레임은 아래 applyEmbed에서 원복.
      + "html,body{height:100%;overflow:hidden;}"
      + ".app > *:nth-child(2){overflow-y:auto;height:100vh;min-height:0;}")
      + "*::-webkit-scrollbar{width:8px;height:8px;}*::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px;}*::-webkit-scrollbar-track{background:transparent;}"
      // 긴 목록 패널 내부 스크롤(2026-07-26 사용자 결정) — 창 고정 원칙과 세트.
      + ".scroll-list{min-height:260px;overflow-y:auto;}"   // 높이는 gijoFitList가 재서 준다

      + ".scroll-list thead th{position:sticky;top:0;background:var(--panel,#30302e);z-index:1;}"

      + 목록양식CSS()

      // 하단 로고·저작권 푸터 제거(2026-07-26 사용자 결정) — 정보 가치가 없고 화면마다
      // 잘려 보였다. 개별 HTML은 건드리지 않고 공용 CSS로 한 번에 숨긴다.
      + ".footer{display:none !important;}.main{padding-bottom:20px;}" +
      "#gijoNav{padding:0 !important;border-right:1px solid var(--border) !important;min-height:0 !important;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;align-self:start;z-index:20;background:var(--panel-2);}" +
      ".gn-top{padding:8px;border-bottom:1px solid var(--border);flex:0 0 auto;display:flex;align-items:center;gap:6px;}" +
      ".gn-top .gn-seg{flex:1;}" +
      // 패널 접기 버튼(좌우 공통 디자인, 2026-07-25 대칭 통일)
      // 왼쪽 가장자리 토글 — 접힘=화면 왼쪽 끝, 열림=사이드바 경계에 반쯤 걸침.
      // ⚠ 예전엔 '◀ 접기'를 세로로 눕혀 썼다. 세로 글씨는 읽는 데만 시간이 걸려서
      //    화살표 하나로 줄였다(2026-07-27). 뜻은 툴팁이 말한다.
      // ⚠ 🚀 프로 셸에서는 이 다섯 줄을 **빼야 한다**(2026-08-18). `!important`라
      //   프로 56px 격자를 통째로 덮어쓴다 — 레일이 사라지는 데 그치지 않고 오른쪽에
      //   46px 빈 거터가 생긴다. 게다가 setupLeftCollapse가 저장값을 복원하므로
      //   **표준에서 메뉴를 접어 둔 채 프로로 바꾼 사람은 첫 화면부터 깨진 격자를 본다**
      //   (사용자가 아무것도 안 눌러도 발동한다).
      (PRO ? "" :
        "body.gn-left-collapsed #gijoNav{display:none !important;}" +
        "body.gn-left-collapsed .app{grid-template-columns:minmax(0,1fr) 46px !important;}" +
        "body.gn-left-collapsed .explorer{display:none !important;}" +
        "body.gn-left-collapsed .body-grid{grid-template-columns:1fr 360px !important;}" +
        "body.gn-left-collapsed .body-grid.no-right{grid-template-columns:1fr !important;}") +
      ".gn-seg{display:flex;background:#1f1e1d;border:1px solid var(--border-strong);border-radius:9px;padding:3px;gap:3px;}" +
      ".gn-seg span{flex:1;text-align:center;padding:6px 4px;border-radius:7px;font-size:12.25px;font-weight:800;color:var(--muted);cursor:pointer;border:1px solid transparent;}" +
      ".gn-seg span.on{background:rgba(59,130,246,.22);color:#fff;border-color:rgba(59,130,246,.5);}" +
      ".gn-pin{flex:0 0 auto;padding:8px 6px 0;}" +
      ".gn-mid{flex:1 1 auto;min-height:0;overflow-y:auto;padding:4px 6px 8px;}"
      + "#gijoNav .gtb-userarea{flex:0 0 auto;position:sticky;bottom:0;background:var(--panel-2,#1f1e1d);}" +
      ".gn-mid::-webkit-scrollbar{width:5px;} .gn-mid::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px;}" +
      // 그룹 헤더 = 트리의 가지. 눌러서 접었다 편다(4.0.0: 허브를 풀어 항목이 30개가 되면서
      // 한 번에 다 보이면 훑기 어렵다 — 안 쓰는 그룹은 접어 둘 수 있게).
      // 가지 이름은 메뉴를 훑는 기준점이라 본문 항목과 비슷한 크기로 둔다. 예전 9.5px·자간 1.2px는
      // 영문 대문자 소제목용 값이라 한글에서는 작고 성글어 읽히지 않았다(2026-07-28 사용자 지적).
      // 2026-08-05(시안 nav-refine-v1): 조용한 소제목 + 가는 선. 이름을 키우지 않고 **선**으로
      // 구역을 나눈다 — 굵은 글씨 9개가 세로로 서면 그것도 목록처럼 읽힌다.
      ".gn-g{display:flex;align-items:center;gap:6px;height:24px;font-size:11px;font-weight:700;color:var(--muted-2);" +
      "letter-spacing:.6px;margin:9px 6px 1px;padding:0 5px;border-radius:5px;cursor:pointer;user-select:none;}" +
      ".gn-g .gn-gname{flex:0 0 auto;white-space:nowrap;}" +
      ".gn-g .gn-line{flex:1;height:1px;background:var(--border,rgba(255,255,255,.08));min-width:8px;}" +
      // 단계 숫자칩 — 원문자 이모지(①) 대신 테두리 숫자. 뜻은 남기고 톤만 낮춘다.
      ".gn-g .gn-num{flex:0 0 auto;width:14px;height:14px;display:flex;align-items:center;justify-content:center;" +
      "font-size:11px;font-weight:800;border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:3px;opacity:.8;}" +
      ".gn-g:hover{color:var(--blue-light,#7ab0ff);background:rgba(255,255,255,.03);}" +
      ".gn-g .car{font-size:11px;width:9px;flex:0 0 auto;opacity:.5;transition:transform .13s;}" +
      ".gn-g.open .car{transform:rotate(90deg);}" +
      ".gn-g .cnt{flex:0 0 auto;font-size:11px;font-weight:700;color:var(--muted-2);opacity:.7;}" +
      ".gn-g.open .cnt{opacity:0;}" + // 펼치면 개수는 군더더기 — 눈으로 보인다
      ".gn-g:first-child{margin-top:2px;}" +
      ".gn-kids{display:block;}" +
      ".gn-kids.closed{display:none;}" +
      ".gn-kids .gn-item{padding-left:16px;}" + // 한 칸 들여써서 가지에 달린 것임을 보인다
      // 맨 위 고정 세 자리 — 가지에 안 달렸으니 들여쓰지 않고, 아래에 얇은 금으로 구분한다.
      ".gn-top-fixed{padding-bottom:7px;margin-bottom:3px;border-bottom:1px solid rgba(255,255,255,.07);}" +
      ".gn-top-fixed .gn-item{padding-left:11px;}" +
      // ★ 여기 있던 **셀렉터 없는 CSS 조각**을 지웠다(2026-08-05 검토 지적). 찾기 입력칸이
      //   상단 바로 이사할 때 셀렉터만 지워지고 선언부가 남았는데, CSS 파서는 그 조각을
      //   다음 규칙의 앞머리로 먹어 **.gn-none까지 통째로 버렸다** — 찾기 「결과 없음」
      //   문구의 모양이 안 먹고 있었다. 규칙 수만 세는 QA로는 이 형태가 안 잡힌다.
      ".gn-none{font-size:12.5px;color:var(--muted-2,#a49d95);padding:10px 12px;}" +
      ".gn-fav-g{color:var(--amber,#f0a020);}" +
      // ☆ 별표 — 평소엔 숨어 있다가 그 줄에 마우스를 올리면 나온다(30줄에 별이 다 떠 있으면
      // 시끄럽다). 이미 넣은 것(★)은 항상 보인다 — 무엇이 즐겨찾기인지 알아야 하니까.
      // ☆는 **늘 흐리게 보인다**(2026-07-28). opacity:0으로 숨겨 뒀더니 마우스를 올려야만
      // 보여서, 처음 쓰는 사람은 즐겨찾기라는 기능이 있는 줄도 몰랐다("즐겨찾기 안 보임" 신고).
      // 있다는 건 알리되 시끄럽지 않게 — 흐리게 두고 올리면 진해진다.
      ".gn-item .gn-star{flex:0 0 auto;font-size:12.25px;color:var(--muted-2,#a49d95);opacity:.28;cursor:pointer;padding:0 3px;border-radius:5px;}" +
      ".gn-item:hover .gn-star{opacity:.7;}" +
      ".gn-item .gn-star:hover{opacity:1;color:var(--amber,#f0a020);background:rgba(240,160,32,.14);}" +
      ".gn-item .gn-star.on{opacity:1;color:var(--amber,#f0a020);}" +
      // 메뉴 한 줄 — 가지 이름(12px)보다 살짝 크게 둬서 "무엇을 고르는가"가 주인공이 되게 한다.
      // 2026-08-05: 38px → 30px. 화면이 30개라 세로가 늘 모자란다(가운데 칸 724px에 내용 1,402px).
      // 평소 굵기는 500으로 낮추고 **지금 있는 곳만** 굵게 — 굵은 글씨 28줄은 강조가 아니라 소음이다.
      ".gn-item{display:flex;align-items:center;gap:9px;height:30px;padding:0 10px;border-radius:6px;font-size:12.5px;font-weight:500;color:var(--muted);cursor:pointer;white-space:nowrap;overflow:hidden;position:relative;}" +
      // 단선 아이콘 — 글자색을 따라간다(currentColor). 이게 "화면 톤과 조화"의 실체다.
      ".gn-item .gn-ic{flex:0 0 auto;width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.5;" +
      "stroke-linecap:round;stroke-linejoin:round;opacity:.62;}" +
      ".gn-item:hover .gn-ic{opacity:.95;}" +
      ".gn-item.active .gn-ic{opacity:1;color:var(--blue-light,#5fa1ff);}" +
      ".gn-g .gn-ic{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.5;opacity:.6;flex:0 0 auto;}" +
      ".gn-item:hover{color:var(--text-strong, #fff);background:rgba(255,255,255,.04);}" +
      // 지금 있는 곳 — 배경을 옅게 두고 **왼쪽 얇은 막대 하나**로 말한다(파란 판을 깔면 그 줄만 튄다).
      ".gn-item.active{color:var(--text-strong, #fff);background:rgba(255,255,255,.055);font-weight:600;cursor:default;}" +
      ".gn-item.active::before{content:'';position:absolute;left:0;top:6px;bottom:6px;width:2px;border-radius:2px;background:var(--blue-light,#5fa1ff);}" +
      ".gn-item .gn-label{flex:1;overflow:hidden;text-overflow:ellipsis;}" +
      // 그 화면의 챗봇을 여는 버튼 — 모든 항목에서 같은 자리(우측).
      ".gn-item .gn-bot{flex:0 0 auto;font-size:12px;opacity:.7;cursor:pointer;border-radius:6px;padding:1px 5px;line-height:1.4;}" +
      ".gn-item .gn-bot:hover{opacity:1;background:rgba(59,130,246,.22);}" +
      // 업데이트 가능 배지(설정 항목).
      ".gn-item .gn-upbadge{flex:0 0 auto;background:var(--amber,#f0a020);color:#3a2a00;font-size:11.25px;font-weight:900;border-radius:20px;padding:1px 6px;}" +
      // 대시보드 — 다른 화면에서 돌아오는 '집' 자리다. 가장 자주 누르므로 한눈에 찾히게
      // 테두리를 준다(2026-07-27 사용자 요청). 지금 대시보드에 있으면 이미 .active가 있어
      // 테두리를 빼서, "돌아갈 곳"일 때만 눈에 띄게 한다.
      // 2026-08-05: 혼자 파란 테두리 상자였다 — 맨 위 자리 자체가 이미 "집"을 말하므로
      // 상자를 걷고 글자색만 살짝 밝게 둔다(다른 줄과 같은 모양이어야 눈이 쉰다).
      ".gn-item.gn-home{color:var(--text,#e9e7e2);}" +
      ".gn-item.gn-home:hover{background:rgba(255,255,255,.05);color:var(--text-strong, #fff);}" +
      // 팝업이 떠 있으면 대시보드는 "돌아갈 곳"이라 누를 수 있어야 한다(아래 클릭 처리).
      ".gn-item.gn-home.active{cursor:pointer;}" +

      // 고정 세 자리에 아이콘을 맞춘다(2026-07-28 사용자 요청) — 팀 사무실만 🏢가 있고 작업 세션은
      // 맨몸이라 줄이 어긋나 보였다. 아이콘은 CSS ::before로 붙인다 — label 자체에 넣으면
      // 그 label이 탭 이름으로도 쓰여 탭줄에까지 이모지가 따라간다.

      // (예전엔 여기서 ::before로 이모지를 붙였다 — 2026-08-05에 단선 SVG로 옮겼다)
      "";
    document.head.appendChild(st);
  }

  var updateAvailable = false; // 클라이언트 새 버전 존재 여부(checkUpdateBadge가 채움)

  // ── 즐겨찾기 ───────────────────────────────────────────────────────────
  // 화면이 30개라 자주 가는 곳까지 매번 훑어 내려가야 한다. 별표한 화면을 맨 위 가지에 모은다.
  // **직접 고르게** 한다(2026-07-28 사용자 결정) — 사용 빈도로 자동 정렬하면 "왜 이게 여기
  // 있지 / 어제 있던 게 왜 없지"가 생겨 오히려 못 찾는다. 내가 꽂은 것만 있어야 예측이 된다.
  var FAV_KEY = "gijo:menu:favorites";
  function favList() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch (e) { return []; }
  }
  function favSave(arr) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function favToggle(page) {
    var arr = favList();
    var i = arr.indexOf(page);
    if (i >= 0) arr.splice(i, 1); else arr.push(page); // 꽂은 순서를 지킨다(마지막이 아래로)
    favSave(arr);
  }

  // 그룹 펼침 상태 — **기본은 펼침**(2026-08-02 사용자 지시로 되돌림. "접기가 아니라 펼치기로
  // 하자 — 못 보는 부분이 있는 것 같다"). 접어 두면 어느 가지에 무엇이 있는지 열어 봐야 알고,
  // 새로 생긴 메뉴가 있어도 눈에 띄지 않는다. **접은 것만** 기억한다.
  // (2026-07-28에는 반대였다 — 기본이 뒤집힐 때마다 키도 바꿔 옛 값이 반대로 읽히지 않게 한다.)
  var CLOSED_KEY = "gijo:menu:closed";
  function closedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function saveClosed(set) {
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify([...set])); } catch (e) {}
  }

  // 메뉴 한 줄을 만든다 — 즐겨찾기 가지와 본 가지가 **같은 함수**를 쓴다(이름·배지·동작을
  // 두 곳에 적으면 반드시 한쪽만 고치게 된다).
  function makeItem(it, here, favs, container) {
    var el = document.createElement("div");
    el.className = "gn-item" + (it.page === here ? " active" : "") +
      (it.page === "dashboard.html" ? " gn-home" : "") + (it.page === "sessions.html" ? " gn-sess" : "");
    // 아이콘 — 단선 SVG를 **글자 앞에** 넣는다(2026-08-05). 예전엔 CSS ::before로 이모지를
    // 붙였는데, 이모지는 색을 우리가 못 정해 옆 글자와 톤이 어긋났다. SVG는 currentColor라
    // 글자와 같이 밝아지고 어두워진다. label 자체는 그대로 둔다 — 탭 이름으로도 쓰이기 때문이다.
    var svg = it.icon ? iconSvg(it.icon) : null;
    if (svg) el.appendChild(svg);
    var lab = document.createElement("span"); lab.className = "gn-label"; lab.textContent = it.label; el.appendChild(lab);

    // ☆ 별표 — 별도 창으로 여는 항목(팀 사무실)은 주소가 없어 즐겨찾기에 넣을 수 없다.
    // 맨 위 고정 세 자리도 뺀다: **이미 늘 보이는 것을 또 꽂는 건 뜻이 없고**, 실제로 눌러도
    // 즐겨찾기 목록은 그룹만 뒤져 그리므로 아무 일도 안 일어났다(2026-07-28 검증에서 잡음).
    if (it.page && !it.fixed) {
      var on = favs.indexOf(it.page) >= 0;
      var star = document.createElement("span");
      star.className = "gn-star" + (on ? " on" : "");
      star.textContent = on ? "★" : "☆";
      star.title = on ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기 — 맨 위에서 바로 갑니다";
      star.addEventListener("click", function (ev) {
        ev.stopPropagation();          // 별을 누른 것이지 화면을 연 것이 아니다
        favToggle(it.page);
        buildMenu(container);          // 즐겨찾기 가지까지 한 번에 다시 그린다
      });
      el.appendChild(star);
    }

    // ⚠ 붙는 항목은 **메뉴에 실존하는 주소**여야 한다(2026-08-30 검토관) — 종전 조건이
    //   settings.html?s=admin이었는데 2026-08-09 설정 그룹 정리로 그 항목이 사라져,
    //   이 배지는 어디에도 그려질 수 없는 죽은 코드였다(생산자 checkUpdateBadge는 살아 있었다).
    if (it.page === "settings.html?s=my" && updateAvailable) {
      // 툴팁에 「관리자 탭」을 안내하지 않는다(검토관 2차) — 배지는 역할 무관하게 뜨는데
      // 그 탭은 담당자에겐 없어 거짓 안내가 된다.
      var upBadge = document.createElement("span"); upBadge.className = "gn-upbadge"; upBadge.textContent = "1"; upBadge.title = "새 버전 있음"; el.appendChild(upBadge);
    }
    // 진행중인 작업 세션 개수 — "몇 건 돌고 있나"는 눌러 보지 않아도 알아야 하는 값이다.
    if (it.page === "sessions.html") {
      var sBadge = document.createElement("span");
      sBadge.className = "gn-upbadge gn-sessbadge";
      sBadge.style.display = "none";
      sBadge.title = "진행중인 작업";
      el.appendChild(sBadge);
    }
    // **기한이 지난 건수**를 띄운다. "몇 건 남았나"보다 "몇 건이 늦었나"가 담당자를
    // 움직이는 숫자다(남은 건수는 늘 많아서 보고도 안 움직인다).
    // 내 업무 메뉴를 없애면서 **대시보드**로 옮겼다(2026-08-01) — 할 일을 실제로 처리하는
    // 곳이 대화창이고, 대화창이 대시보드에 있기 때문이다. 붙일 자리가 사라지면 늦은 건수를
    // 알릴 곳이 없어져 조용히 묻힌다.
    if (it.page === "dashboard.html") {
      var wBadge = document.createElement("span");
      wBadge.className = "gn-upbadge gn-workbadge";
      wBadge.style.display = "none";
      wBadge.style.background = "var(--red,#e2483d)";
      wBadge.style.color = "#fff";
      wBadge.title = "기한이 지난 업무";
      el.appendChild(wBadge);
    }
    // 오늘 새로 들어온 문서 수 — "내가 올린 게 어디 쌓이나"를 눌러 보지 않아도 알린다
    //   (2026-08-21 승인 시안 menu-reorg). 0이면 감춘다(새 게 없으면 알릴 일이 아니다).
    // ⚠ `mydocs.html` **정확히**만 — TOP엔 숨김 항목 `mydocs.html?tab=contacts`(옛 연락처)가,
    //   🧠 내 지식 그룹엔 `mydocs.html?tab=guide`·`?tab=vendor`가 있어 문자열이 다르다.
    //   그쪽엔 안 붙는다(붙으면 배지가 여러 곳에 뜬다). (2026-08-30 — 옛 주석이 guide를
    //   TOP 숨김이라 적었는데 guide는 2026-08-28 내 지식 그룹으로 이사했다. 사실대로 고침.)
    if (it.page === "mydocs.html") {
      var dBadge = document.createElement("span");
      dBadge.className = "gn-upbadge gn-docbadge";
      dBadge.style.display = "none";
      dBadge.title = "오늘 새로 들어온 문서";
      el.appendChild(dBadge);
    }

    if (it.win) {
      // 별도 창 항목 — preload가 노출한 window.gijo.<win>()을 부른다.
      // 없으면 조용히 넘기지 않고 알린다: 예전엔 아무 일도 안 나서 "눌러도 안 열린다"는
      // 증상만 남고 원인을 찾을 단서가 하나도 없었다(4.9.0 문서함).
      el.addEventListener("click", function () {
        // 🎨 흰 바탕 신호(중3) — 문서함만 소비, 나머지 창은 인자 무시(무해).
        if (window.gijo && typeof window.gijo[it.win] === "function") window.gijoOpenWindowResult(window.gijo[it.win](document.documentElement.classList.contains("theme-light") ? "light" : undefined), it.label);
        else gijoTell(it.label + "을(를) 열 수 없습니다 — 앱을 다시 시작해 보시고, 계속되면 알려주세요.");
      });
    } else if (window.gijoTabs) {
      // 탭 셸(app.html) 안 — 화면을 옮기지 않고 탭으로 연다. 셸이 리로드되지 않으므로
      // 대화·입력 중 초안·진행 중 작업이 그대로 유지된다(4.0.0 탭 구조).
      el.addEventListener("click", function () { window.gijoTabs.open(it.page, it.label); });
    } else if (it.page !== here) {
      // 셸 밖(분리창 등)에서는 화면을 옮긴다 — 그 창은 한 화면만 보는 자리다.
      el.addEventListener("click", function () { go(it.page); });
    }
    return el;
  }

  // 트리 메뉴를 container에 렌더한다 — nav 사이드바와 대시보드 '전체메뉴' 모드가 공유하는 단일 소스.
  // 4.0.0에서 허브를 풀어 항목이 30개가 되면서, 그룹을 가지처럼 접었다 펼 수 있게 했다
  // (안 쓰는 그룹은 접어 두면 30개여도 훑기 쉽다 — 2026-07-28 사용자 요청).
  function buildMenu(container) {
    injectCss(); // 대시보드('전체메뉴' 모드)에서 render()를 안 거쳐도 gn-* 스타일이 있게.
    container.innerHTML = "";
    var here = currentKey();
    var closed = closedSet();
    var favs = favList();

    // ── 찾기 칸은 **상단 바 🔍로 이사했다**(2026-08-02 사용자 지시).
    //   여기 입력칸이 있으면 메뉴를 접을 때 같이 사라져 못 쓴다 — 상단은 늘 남는다.
    //   ⚠ 한글 조합 보호를 위해 입력 중 메뉴를 다시 그리지 않던 규칙은 겹판이 이어받았다.
    renderBody(container);
  }

  // 찾기 칸 **아래쪽만** 다시 그린다 — 입력칸을 건드리지 않는 것이 핵심이다(한글 조합 보호).
  function renderBody(container) {
    container.innerHTML = "";
    var here = currentKey();
    var closed = closedSet();
    var favs = favList();

    // ── 맨 위 고정 세 자리 — 가지에 넣지 않는다(접혀 있으면 매번 펴야 한다).
    //   스크롤 **밖**에 둔다(2026-08-02 사용자 신고: "하단 메뉴가 나오면 상단 메뉴가 안 나옴").
    //   메뉴를 다 펼치면 목록이 창보다 길어져, 아래를 보려고 내리는 순간 이 세 자리가 밀려났다.
    //   창이 좁을수록 먼저 필요한 자리라 위·아래 양 끝은 붙여 두고 가운데만 구른다.
    var 고정자리 = container.__gnPin;
    if (고정자리) 고정자리.innerHTML = "";
    var top = document.createElement("div");
    top.className = "gn-kids gn-top-fixed";
    TOP.forEach(function (it) { if (!it.hidden) top.appendChild(makeItem(it, here, favs, container)); });
    (고정자리 || container).appendChild(top);

    // ⭐ 즐겨찾기 가지 — **비어 있어도 보여준다**(2026-07-28 사용자 신고: "즐겨찾기 안 보임").
    //   전에는 별표한 게 하나도 없으면 가지를 통째로 안 그렸다. 그런데 별표는 마우스를 올려야
    //   보이는 흐린 ☆라, 처음 쓰는 사람은 **기능이 있다는 것도, 넣는 방법도 알 수 없었다.**
    //   빈 자리에 "☆를 눌러 꽂으세요" 한 줄을 두는 편이 낫다 — 한 줄 자리값보다 발견이 중요하다.
    {
      var fh = document.createElement("div");
      fh.className = "gn-g open gn-fav-g";
      fh.setAttribute("role", "button");
      fh.title = "즐겨찾기 접기/펼치기 — 항목 위 ☆를 눌러 넣고 뺍니다";
      var fcar = document.createElement("span"); fcar.className = "car"; fcar.textContent = "▸";
      var fst = iconSvg("star");   // ⭐ 이모지 대신 단선 별 — 다른 구역과 같은 굵기·색
      var fnm = document.createElement("span"); fnm.className = "gn-gname"; fnm.textContent = "즐겨찾기";
      var fln = document.createElement("span"); fln.className = "gn-line";
      var fcnt = document.createElement("span"); fcnt.className = "cnt"; fcnt.textContent = favs.length;
      fh.appendChild(fcar); if (fst) fh.appendChild(fst); fh.appendChild(fnm); fh.appendChild(fln); fh.appendChild(fcnt);
      container.appendChild(fh);
      // 즐겨찾기도 **기본 펼침** — 내가 직접 꽂아 둔 것들이라 접어 두면 꽂은 뜻이 없어진다.
      var favClosed = closed.has("__favClosed");
      var fkids = document.createElement("div");
      fkids.className = "gn-kids" + (favClosed ? " closed" : "");
      if (favClosed) fh.classList.remove("open");
      container.appendChild(fkids);
      fh.addEventListener("click", function () {
        var nowOpen = fkids.classList.toggle("closed") === false;
        fh.classList.toggle("open", nowOpen);
        var s = closedSet();
        if (nowOpen) s.delete("__favClosed"); else s.add("__favClosed");
        saveClosed(s);
      });
      // 메뉴 정의에서 그 화면을 찾아 같은 모양으로 그린다(이름·배지를 두 곳에 적지 않는다).
      // ★ 2026-08-22 검토관 [낮음] 수리 — **배지와 줄 수가 어긋났다.** 배지는 `favs.length`를
      //   그대로 썼는데, 없어진 화면(흡수·삭제)은 GROUPS에서 못 찾아 `if (found)`에서 조용히
      //   건너뛴다. 그래서 「즐겨찾기 1」인데 줄이 0개인, 오류도 안 나는 거짓 숫자가 났다.
      //   (5.65.0에서 「보안제품 비교·소개」에 ☆를 눌러 둔 사람이 이번 삭제로 정확히 그 자리에 온다.)
      //   → **그린 것만 센다.** 「보이는 것과 숫자가 같다」는 이 저장소의 거짓숫자 원칙 그대로.
      var 그린수 = 0;
      favs.forEach(function (page) {
        var found = null;
        GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (it.page === page) found = it; }); });
        if (found) { fkids.appendChild(makeItem(found, here, favs, container)); 그린수++; }
      });
      fcnt.textContent = 그린수;
      // 비었을 때 안내 문구는 두지 않는다(2026-07-29 사용자 결정).
      // ☆를 늘 보이게 바꾼 뒤로는 문구 없이도 알 수 있고, 좁은 메뉴 폭에서 두 줄로 접혀
      // 어설퍼 보였다. 가지 이름(⭐ 즐겨찾기)과 늘 보이는 ☆만으로 충분하다.
    }

    GROUPS.forEach(function (g) {
      // 기본은 펼침 — 담당자가 직접 접은 가지만 접힌 채로 기억한다.
      var open = !closed.has(g.id);

      var gh = document.createElement("div");
      gh.className = "gn-g" + (open ? " open" : "");
      gh.setAttribute("role", "button");
      gh.title = (open ? "접기" : "펼치기") + " — " + g.label;
      // 구역 제목 = ▸ + (단계 숫자칩) + 이름 + 가는 선 + 개수 (2026-08-05, 시안 승인).
      // ⚠ 단계 숫자(1~5)는 **뜻이 있어 남긴다** — 업무 절차 5단계이고 서버 workflow.ts가
      //   같은 표를 본다. 다만 원문자 이모지(①)가 아니라 테두리 숫자칩으로 그려 톤을 낮춘다.
      var car = document.createElement("span"); car.className = "car"; car.textContent = "▸";
      gh.appendChild(car);
      var gic = g.icon ? iconSvg(g.icon) : null;
      if (gic) gh.appendChild(gic);
      // ⚠ 이름(g.label)은 **정본 그대로 둔다** — "② 우선순위"는 서버의 「다음 단계」 안내와
      //   시험이 보는 이름이다(2026-08-05 실측: 화면에서 ②를 떼었더니 챗봇이 "사이드바에 없는
      //   단계"로 안내하게 됐고 시험이 잡았다). **화면에서만** 원문자를 숫자칩으로 바꿔 그린다.
      var 원문자 = "①②③④⑤⑥⑦⑧⑨";
      var 첫 = (g.label || "").charAt(0);
      var 번호 = 원문자.indexOf(첫);
      var 보일이름 = g.label;
      if (번호 >= 0) {
        var num = document.createElement("span"); num.className = "gn-num"; num.textContent = String(번호 + 1);
        gh.appendChild(num);
        보일이름 = g.label.slice(1).trim();
      }
      var nm = document.createElement("span"); nm.className = "gn-gname"; nm.textContent = 보일이름;
      gh.appendChild(nm);
      var ln = document.createElement("span"); ln.className = "gn-line"; gh.appendChild(ln);
      // 통합 그룹(항목 1개) = **그룹 줄 자체가 그 메뉴**다(2026-08-09 사용자 지시 "통합 메뉴가
      // 대표 메뉴로, 하위 메뉴로 만들지 말 것"). 개수 배지·접기 삼각형·하위 줄을 두지 않는다 —
      // 하나뿐인 아이를 접었다 폈다 하는 조작은 뜻이 없고 세로만 먹는다.
      var 대표 = g.items.length === 1 && g.items[0].page && !g.alwaysGroup;
      if (!대표) {
        var cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = g.items.length;
        gh.appendChild(cnt);
      } else {
        car.style.visibility = "hidden"; // 접을 것이 없다
        if (here === g.items[0].page) gh.classList.add("on");
      }
      container.appendChild(gh);

      var kids = document.createElement("div");
      kids.className = "gn-kids" + (open ? "" : " closed");
      container.appendChild(kids);

      if (대표) {
        gh.title = g.label + " 열기";
        // ⚠ 여는 방식은 **항목(makeItem)과 똑같아야 한다**(2026-08-09 실측 사고):
        //   셸에서 go()를 부르면 탭이 아니라 **셸 창 자체가 그 화면으로 이동**해 탭·대화가 통째로
        //   사라진다. 셸 안이면 gijoTabs.open, 셸 밖(분리창)에서만 화면 이동.
        gh.addEventListener("click", function () {
          if (window.gijoTabs) window.gijoTabs.open(g.items[0].page, g.items[0].label || g.label);
          else go(g.items[0].page);
        });
        return; // 하위 줄을 그리지 않는다
      }

      gh.addEventListener("click", function () {
        var nowOpen = kids.classList.toggle("closed") === false;
        gh.classList.toggle("open", nowOpen);
        gh.title = (nowOpen ? "접기" : "펼치기") + " — " + g.label;
        var s = closedSet();
        if (nowOpen) s.delete(g.id); else s.add(g.id);
        saveClosed(s);
      });

      g.items.forEach(function (it) { kids.appendChild(makeItem(it, here, favs, container)); });
    });
  }
  // 대시보드가 '전체메뉴' 모드에서 같은 메뉴를 렌더하도록 공개(단일 소스).
  window.gijoRenderMenu = buildMenu;

  /**
   * 아이콘 마크업을 **여기서만** 만들어 내준다(2026-08-05 검토 지적).
   * 상단 🔍 화면 찾기가 예전엔 이모지(it.ic)를 받아 그렸는데, 이모지를 걷어 내면서
   * 그 값이 undefined가 되어 **30줄이 전부 「▪」로 죽었다.** 아이콘을 저쪽에 베껴 적으면
   * 또 갈라지므로, 같은 ICON 표에서 만든 마크업을 넘긴다.
   */
  window.gijoIconMarkup = function (name) {
    var el = iconSvg(name);
    return el ? el.outerHTML : "";
  };

  /**
   * 별도 창 열기의 **결과**를 사람에게 전한다.
   *
   * 왜 필요한가: 창을 여는 다리 중에는 열지 못한 이유를 돌려주는 것이 있다
   * (Smart MD는 설치본에 안 담겼을 수 있다 — 포함이 아니라 연동이라 그게 정상이다).
   * 그 값을 안 보면 「눌러도 아무 일 없다」가 되어, 4.9.0 문서함 때와 같은 자리에 다시 선다.
   * ⚠ 옛 다리들은 아무것도 안 돌려준다 — 그때는 조용히 지나간다(성공으로 본다).
   */
  window.gijoOpenWindowResult = function (p, label) {
    if (!p || typeof p.then !== "function") return;
    p.then(function (r) {
      if (r && r.ok === false) gijoTell((r.error || ((label || "이 창") + "을(를) 열지 못했습니다.")));
    }).catch(function () { /* 다리 자체가 없는 옛 판 — 위 typeof 검사에서 이미 걸렀다 */ });
  };

  /** 찾기용 납작한 목록 — {page|win, label, group}. 자료는 위 TOP/GROUPS 하나에서만 온다. */
  window.gijoScreenList = function () {
    var out = [];
    TOP.forEach(function (t) { out.push({ page: t.page, win: t.win, label: t.label, icon: t.icon, group: "" }); });
    GROUPS.forEach(function (g) {
      g.items.forEach(function (i) { out.push({ page: i.page, win: i.win, label: i.label, icon: g.icon, group: g.label }); });
    });
    return out;
  };
  // 화면 주소 → 메뉴에 적힌 이름. 셸이 탭 이름을 붙일 때 쓴다(이름을 두 곳에 적지 않으려고).
  window.gijoMenuLabel = function (page) {
    for (var k = 0; k < TOP.length; k++) if (TOP[k].page === page) return TOP[k].label;
    for (var i = 0; i < GROUPS.length; i++) {
      for (var j = 0; j < GROUPS[i].items.length; j++) {
        if (GROUPS[i].items[j].page === page) return GROUPS[i].items[j].label;
      }
    }
    return null;
  };

  // ── 왼쪽 패널 접기/열기(전 화면 공통, 오른쪽 rightReopen과 대칭) ────────────
  // 접힘=body 클래스(레이아웃은 위 CSS가 처리) + 가장자리 '메뉴 열기' 탭. 상태는 기억.
  var LEFT_KEY = "gijo:leftPanel:collapsed";
  // ⚠ 예전엔 화면 가장자리에 ◀ 딱지를 띄워 접었다. 본문 위에 떠서 글자를 가렸고,
  //   접으면 사이드바와 함께 설정·계정까지 사라져 되돌릴 자리가 마땅치 않았다.
  //   2026-08-02부터 접기는 **상단 바 ▣** 하나로 한다(늘 남아 있는 자리).
  window.gijoLeftCollapse = function (on) {
    injectCss();
    document.body.classList.toggle("gn-left-collapsed", !!on);
    try { localStorage.setItem(LEFT_KEY, on ? "1" : "0"); } catch (e) {}
    if (typeof window.gijoSyncTopbar === "function") window.gijoSyncTopbar(); // 상단 ▣ 모양 맞추기
  };
  /** 지금 접혀 있나 — 상단 바가 버튼 모양을 정할 때 묻는다. */
  window.gijoLeftCollapsed = function () { return document.body.classList.contains("gn-left-collapsed"); };
  function setupLeftCollapse() {
    // 왼쪽 패널이 있는 화면에서만(login 제외). 저장 상태 복원 + 탭 초기 배치.
    // 🚀 프로에서는 접을 사이드바가 없다 — 저장값을 복원하면 깨진 격자만 켜진다.
    // ⚠ 저장값을 **지우지는 않는다** — 표준으로 되돌아갈 때 접힘 상태가 남아 있어야 한다.
    if (PRO) return;
    if (!document.getElementById("gijoNav") && !document.querySelector(".explorer")) return;
    injectCss();
    var saved = null; try { saved = localStorage.getItem(LEFT_KEY); } catch (e) {}
    if (saved === "1") document.body.classList.add("gn-left-collapsed");
    if (typeof window.gijoSyncTopbar === "function") window.gijoSyncTopbar();
  }

  function render() {
    // 🚀 프로 셸은 사이드바를 **안 그린다**(56px 레일이 대신한다).
    // ⚠ 가드를 여기(함수 안 첫 줄)에 둔다 — 호출부(boot)만 막으면 `checkUpdateBadge`가
    //   `render()`를 다시 불러 사이드바가 되살아난다.
    // ⚠ **nav.js를 안 싣는 것이 아니다.** `window.gijoNavGroups`·`gijoScreenList`·
    //   `gijoMenuLabel`·`gijoOpenScreen`은 모듈 최상위라 렌더와 무관하게 살아 있어야 한다 —
    //   죽으면 탭 이름이 파일명으로 새고(app.html 화면이름찾기) 화면찾기가 빈손이 된다.
    if (PRO) return;
    var root = document.getElementById("gijoNav");
    if (!root) return;
    injectCss();
    root.innerHTML = "";
    // 상단 세그먼트 [🏠 대시보드 | ☰ 전체메뉴]는 없앴다(2026-07-27).
    // 두 칸짜리 토글처럼 보였지만 실제로는 토글이 아니었다: '전체메뉴'는 언제나 켜진 채
    // 아무 동작도 하지 않았고(지금 보고 있는 게 이미 전체메뉴다), '대시보드'는 바로 아래
    // 메뉴 첫 항목과 같은 곳으로 갔다. 누르면 뭐가 달라지는지 알 수 없는 버튼은 조작만 늘린다.
    // 위 고정 자리(대시보드·팀 사무실·작업 내역) — 스크롤과 함께 밀려나지 않게 목록 밖에 둔다.
    var pin = document.createElement("div"); pin.className = "gn-pin"; root.appendChild(pin);
    // 중앙 메뉴(스크롤)
    var mid = document.createElement("div"); mid.className = "gn-mid";
    mid.__gnPin = pin;
    buildMenu(mid); root.appendChild(mid);
    // 하단 사용자 영역은 titlebar.js가 #gijoNav 마지막 자식으로 마운트(관찰자).
    // 접기/열기는 **상단 바 ▣** 하나로(2026-08-02 이관) — 여기서는 모양만 맞춘다.
    if (typeof window.gijoSyncTopbar === "function") window.gijoSyncTopbar();
  }

  /**
   * 긴 목록 높이 맞추기 — **위 카드·필터가 늘 보이게** 목록에만 남는 높이를 준다.
   *
   * 왜 공용인가(2026-08-02 사용자 질문 "다른 메뉴들도 그렇게 반영되는 거지?"):
   *   화면마다 제각각이었다. 어떤 곳은 고정 560px, 어떤 곳은 calc(100vh - 300px),
   *   어떤 곳은 아무것도 없었다. 둘 다 못 맞춘다 —
   *     · 고정 px: 창·배율이 바뀌면 넘치거나 남는다.
   *     · calc(100vh - 상수): 목록 **위에 무엇이 있는지**가 화면마다 다르고(요약 막대·상관 줄·
   *       필터 칩이 있다 없다 한다) 검색줄이 줄바꿈되면 그 상수가 또 틀어진다.
   *   그래서 **재서** 정한다. 규칙은 여기 하나뿐이다.
   *
   * 대상: .scroll-list, .gj-list, [data-gijo-fit]  (화면에서 표시만 달면 된다)
   * @param el 특정 요소만 다시 재고 싶을 때(목록을 다시 그린 뒤). 없으면 이 문서 전체.
   */
  /**
   * 줄 바로 아래에 자세히 펼치기 — 오른쪽 별도 패널 대신(2026-08-02 사용자 지시
   * "세부 항목 클릭 시 하단이나 링크가 바로 아래에 나오게, 오른쪽에 별도로 뜨는 것보다").
   *
   * 왜 아래인가: 오른쪽 패널은 **누른 줄과 내용이 멀다.** 목록 20번째 줄을 눌러도 설명은
   *   화면 오른쪽 위에 뜨니 눈이 대각선으로 건너뛰고, "내가 뭘 눌렀더라"를 다시 확인하게 된다.
   *   바로 아래에 펴면 누른 줄과 붙어 있어 그 일이 없다. 폭도 목록 폭을 그대로 쓴다.
   *
   * 규칙
   *   · 한 번에 하나만 펴 둔다 — 여러 개가 펴져 있으면 목록이 아니라 문서가 된다.
   *   · 다시 누르면 접는다. 접으면 자리도 사라진다(빈 칸을 남기지 않는다).
   *   · 내용은 화면이 만든다. 여기서는 **자리와 여닫기만** 맡는다.
   *
   * @param row  누른 줄 요소(.gj-row 등)
   * @param html 펼쳐 보일 내용(문자열) 또는 요소. 함수를 주면 펼 때 불러서 받는다(늦게 불러오기).
   */
  window.gijoRowDetail = function (row, html) {
    if (!row) return null;
    var 목록 = row.parentNode;
    var 이미 = row.nextElementSibling;
    var 열려있음 = 이미 && 이미.classList && 이미.classList.contains("gj-detail");
    // 같은 목록에 펴 둔 다른 것은 접는다.
    목록.querySelectorAll(":scope > .gj-detail").forEach(function (d) { d.remove(); });
    목록.querySelectorAll(":scope > .on").forEach(function (r) { r.classList.remove("on"); });
    if (열려있음) return null;   // 같은 줄을 다시 눌렀으면 접는 것으로 끝

    var box = document.createElement("div");
    box.className = "gj-detail";
    var 내용 = typeof html === "function" ? html() : html;
    if (내용 == null) 내용 = "";
    if (내용 && 내용.nodeType) box.appendChild(내용);
    else box.innerHTML = String(내용);
    // 닫는 단추 — 편 것은 **닫을 수 있어야 한다**(2026-08-08 사용자 지시 "선택시 X 넣어서 닫게").
    // 예전엔 같은 줄을 다시 누르는 것이 유일한 길이었는데, 편 내용이 길면 그 줄이 위로 밀려
    // 화면 밖에 있다 — 눈앞에서 닫을 자리가 필요하다.
    var 닫기 = document.createElement("button");
    닫기.className = "gj-detail-x";
    닫기.type = "button";
    닫기.title = "닫기";
    닫기.setAttribute("aria-label", "자세히 닫기");
    닫기.textContent = "✕";
    닫기.addEventListener("click", function (e) {
      e.stopPropagation();
      box.remove();
      row.classList.remove("on");
    });
    box.appendChild(닫기);
    row.classList.add("on");
    목록.insertBefore(box, row.nextSibling);
    // 펴 놓고 화면 밖으로 나가 버리면 편 뜻이 없다 — 상자 안에서만 살짝 굴린다.
    try {
      var 상자 = 목록.closest(".gj-list") || 목록;
      var b = box.getBoundingClientRect(), c = 상자.getBoundingClientRect();
      if (b.bottom > c.bottom) 상자.scrollTop += b.bottom - c.bottom + 8;
    } catch (e) { /* 못 굴려도 펼치기 자체는 됐다 */ }
    return box;
  };

  /**
   * 두 칸(목록 | 오른쪽 자세히)을 **한 칸으로 펴고, 자세히를 누른 줄 바로 아래**로 옮긴다.
   * (2026-08-02 사용자 지시 — 작업 내역·통합 관제·자산 통합 뷰·조치 승인·기억 학습 5화면.
   *  본은 컴플라이언스 화면: "1번 작업에 샘플이 컴플라이언스 화면에 있네")
   *
   * 왜: 오른쪽 패널은 **누른 줄과 내용이 멀다.** 20번째 줄을 눌러도 설명은 오른쪽 위에 떠서
   *   눈이 대각선으로 건너뛰고 "내가 뭘 눌렀더라"를 다시 확인하게 된다. 게다가 목록이 좁아져
   *   이름이 잘린다(문서명·자산명이 …으로 끊기던 자리).
   *
   * 방식: 화면이 이미 그리고 있는 자세히 요소를 **그대로 옮긴다**. 다시 그리지 않으므로
   *   그 안의 버튼·입력에 걸린 동작이 살아 있다. 화면 코드는 한 줄만 부르면 된다.
   *
   * @param opt.칸    두 칸을 만드는 바깥 요소(선택자) — 한 칸으로 편다
   * @param opt.목록  줄들이 들어 있는 요소(선택자)
   * @param opt.자세히 오른쪽에 있던 자세히 요소(선택자)
   * @param opt.줄    줄 하나를 고르는 선택자(생략하면 목록의 바로 아래 자식)
   */
  /** 목록의 "줄"만 고른다 — 우리가 끼워 넣은 자세히 칸은 줄이 아니다. */
  function 줄들만(목록) {
    return [].filter.call(목록.children, function (c) {
      return c.nodeType === 1 && !c.classList.contains("gj-underrow");
    });
  }

  window.gijo자세히아래로 = function (opt) {
    try {
      var 칸 = document.querySelector(opt.칸);
      var 목록 = document.querySelector(opt.목록);
      var 자세히 = document.querySelector(opt.자세히);
      if (!칸 || !목록 || !자세히) return false;
      if (칸.dataset.gijoUnrow === "1") return true;
      칸.dataset.gijoUnrow = "1";
      칸.classList.add("gj-onecol");
      자세히.classList.add("gj-underrow");
      목록.classList.add("gj-rows1");   // 줄을 한 줄로 (아래 CSS)
      자세히.style.display = "none";   // 고르기 전에는 자리도 차지하지 않는다

      // 닫는 단추 — 편 것은 **닫을 수 있어야 한다**(2026-08-08 사용자 지시 "선택시 X 넣어서 닫게").
      // 예전엔 닫을 길이 없어, 편 내용이 길면 목록이 그만큼 밀린 채로 남았다.
      // ⚠ 화면이 자세히 칸을 **innerHTML로 다시 그린다**(조치·승인이 그렇다) — 한 번만 만들면
      //   다음 선택에서 조용히 사라진다. 그래서 옮길 때마다 있는지 보고 없으면 다시 만든다.
      function 닫기보장() {
        if (자세히.querySelector(":scope > .gj-detail-x")) return;
        var 닫기 = document.createElement("button");
        닫기.className = "gj-detail-x";
        닫기.type = "button";
        닫기.title = "닫기";
        닫기.setAttribute("aria-label", "자세히 닫기");
        닫기.textContent = "✕";
        닫기.addEventListener("click", function (e) {
          e.stopPropagation();
          자세히.style.display = "none";
          목록.querySelectorAll(".gj-picked").forEach(function (r) { r.classList.remove("gj-picked"); });
        });
        자세히.appendChild(닫기);
      }

      // ⚠ **잡는 단계(capture)**로 받는다. 줄이 자기 처리에서 위로 못 올라가게 막으면
      //   보통 방식(bubble)으로는 아예 안 들어온다(2026-08-02 실측 — 통합 관제·작업 내역).
      목록.addEventListener("click", function (e) {
        var 줄 = opt.줄 ? e.target.closest(opt.줄) : null;
        if (!줄) {
          // 줄 선택자를 안 준 화면 — 목록의 **바로 아래 자식**까지 거슬러 올라간다.
          줄 = e.target;
          while (줄 && 줄.parentNode !== 목록) 줄 = 줄.parentNode;
        }
        if (!줄 || 줄 === 자세히 || !목록.contains(줄)) return;
        var 색인 = 줄들만(줄.parentNode || 목록).indexOf(줄);

        // 화면이 자세히를 다시 그린 **뒤에** 옮긴다(먼저 옮기면 그리면서 제자리로 돌아간다).
        // ⚠ 여러 화면이 줄을 누르면 **목록을 통째로 다시 그린다**(고른 표시를 칠하려고).
        //   그러면 방금 누른 줄 요소는 사라진다 — 그때는 고른 표시가 붙은 줄이나 같은 자리를 쓴다.
        //   (2026-08-02 실측: 통합 관제·작업 내역이 이 경우라 자세히가 아예 안 나타났다.)
        function 옮기기() {
          var 대상 = 줄;
          var 판 = 줄.parentNode;                          // 줄이 들어 있는 판(묶음일 수도 있다)
          if (!판 || !목록.contains(판)) 판 = 목록;
          if (대상.parentNode !== 판) {
            // 화면이 다시 그려 그 줄 요소가 사라졌다 — 고른 표시가 붙은 줄이나 같은 자리를 쓴다.
            var 줄들 = 줄들만(판);
            대상 = 판.querySelector(":scope > .on, :scope > .active, :scope > .sel, :scope > .selected") ||
                   줄들[색인] || null;
          }
          if (!대상) return false;
          자세히.style.display = "";
          if (대상.nextSibling !== 자세히) 판.insertBefore(자세히, 대상.nextSibling);
          목록.querySelectorAll(".gj-picked").forEach(function (r) { r.classList.remove("gj-picked"); });
          대상.classList.add("gj-picked");
          닫기보장();
          return true;
        }
        setTimeout(function () { if (!옮기기()) setTimeout(옮기기, 450); }, 0);
      }, true);
      return true;
    } catch (e) { return false; }
  };

  window.gijoFitList = function (el) {
    var 목록 = el ? [el] : [].slice.call(document.querySelectorAll(".scroll-list, .gj-list, [data-gijo-fit]"));
    목록.forEach(function (x) {
      if (!x || !x.getBoundingClientRect || !x.offsetParent) return;   // 안 보이는 건 재지 않는다
      var 위 = x.getBoundingClientRect().top;
      var 남은 = window.innerHeight - 위 - 24;                          // 24 = 아래 여백
      x.style.maxHeight = Math.max(240, Math.round(남은)) + "px";       // 너무 납작해지지 않게 바닥
      x.style.overflowY = "auto";
    });
  };
  window.addEventListener("resize", function () { window.gijoFitList(); });

  /**
   * 요약 카드 줄 → **한 줄 막대**로 바꾼다 (2026-08-02 사용자 지시
   * "이 양식을 쓰는 화면들 이렇게 변경 다 해달라고 했는데").
   *
   * 왜 화면마다 고치지 않고 여기서 하나로 하나:
   *   같은 양식이 20개 화면에 있다. 하나씩 손대면 오늘만 세 번 겪은 "지우다 옆을 건드림"이
   *   스무 번 반복된다. 그리고 다음에 화면이 하나 늘면 또 빠뜨린다.
   *
   * ⚠ 값 요소를 **새로 만들지 않고 옮긴다**(appendChild는 이동이다).
   *   숫자를 채우는 코드는 document.getElementById("kpiTotal")처럼 id로 찾는다 —
   *   새로 그리면 그 id가 사라져 화면이 "-"에서 멈춘다. 껍데기만 바꾸고 알맹이는 그대로 옮긴다.
   *
   * ⚠ 모양이 조금이라도 다르면 **손대지 않는다.** 요약 줄이 아닌 것을 억지로 바꾸면
   *   버튼·막대그래프가 있는 판까지 망가진다. 확신이 없으면 그냥 두는 쪽이 낫다.
   */
  /**
   * 막대 모양은 **변환기가 직접** 넣는다.
   * ⚠ 처음엔 메뉴 스타일(injectCss)에 얹었는데 그건 **탭 안(embed)에서는 안 돈다** —
   *   변환만 되고 모양이 안 먹어 카드가 세로로 297px 그대로 남았다(2026-08-02 실측).
   *   바꾸는 코드와 그 모양은 **같이 다녀야** 한다.
   */
  function 요약막대모양() {
    if (document.getElementById("gijoSumCss")) return;
    var st = document.createElement("style");
    st.id = "gijoSumCss";
    st.textContent =
      ".gsum-box{display:block !important;grid-template-columns:none !important;gap:0 !important;" +
      "background:linear-gradient(90deg,rgba(59,130,246,.10),transparent);border:1px solid rgba(59,130,246,.28);" +
      "border-radius:12px;padding:11px 16px;margin-bottom:16px;}" +
      ".gsum{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 9px;font-size:13px;}" +
      // 상단 버튼 묶음을 요약 막대 오른쪽 끝에 붙인다 — 같은 줄에서 끝난다.
      ".gsum .gsum-acts{margin-left:auto;display:flex;gap:6px;flex:0 0 auto;}" +
      ".gsum .gsum-acts button{padding:4px 11px !important;font-size:11.75px !important;}" +
      ".gsum-pair{display:inline-flex;align-items:baseline;gap:6px;min-width:0;}" +
      ".gsum .gsum-l{color:var(--muted,#b3ada4) !important;font-size:12.5px !important;font-weight:600 !important;" +
      "white-space:nowrap;margin:0 !important;padding:0 !important;display:inline !important;line-height:1.4 !important;}" +
      // 값 요소는 화면이 쓰던 클래스를 그대로 달고 온다(카드용 큰 글씨·여백) — 여기서 눌러 준다.
      ".gsum .gsum-v{font-size:15px !important;font-weight:800;line-height:1.4 !important;margin:0 !important;" +
      "padding:0 !important;display:inline !important;}" +
      // 첫 짝은 **이름처럼 굵게** 읽혀야 한다 — 컴플라이언스 막대(「KISA 위협 21건 | …」)와
      // 같은 맛(2026-08-02 사용자가 그 화면을 가리키며 "이렇게").
      ".gsum-pair.first .gsum-l{font-size:14.5px;color:var(--text-strong, #fff);font-weight:800;}" +
      ".gsum-pair.first .gsum-v{font-size:17px !important;color:var(--text-strong, #fff);}" +
      // 이름 뒤에 얇은 칸막이 — 제목과 곁가지가 눈으로 갈린다.
      ".gsum-pair.first{padding-right:11px;margin-right:2px;border-right:1px solid var(--border,rgba(255,255,255,.14));}" +
      ".gsum-dot{color:var(--muted-2,#a49d95);}";
    document.head.appendChild(st);
  }

  function 요약막대로() {
    요약막대모양();
    var 상자들 = document.querySelectorAll("[data-gijo-summary]");
    [].forEach.call(상자들, function (box) {
      if (box.dataset.gijoSum === "1") return;              // 이미 바꿨다
      var 카드 = [].filter.call(box.children, function (e) { return e.nodeType === 1; });
      // ⚠ 상한 8은 계약이다(검토관 B하3) — 작업 기록 요약이 정확히 8칸(전체+종류6+보관)이라
      //   턱밑이다. 칸을 늘릴 일이 생기면 이 문턱과 함께 움직일 것(말없이 넘기면 변환이
      //   조용히 멈춰 화면이 날것 카드로 돌아간다).
      if (카드.length < 2 || 카드.length > 8) return;        // 카드 줄이 아니다
      var 조각 = [];
      for (var i = 0; i < 카드.length; i++) {
        var c = 카드[i];
        // 누를 것·그림이 든 판은 요약 줄이 아니다.
        if (c.querySelector("button, input, select, a, svg, canvas, table, progress")) return;
        var 안 = [].filter.call(c.children, function (e) { return e.nodeType === 1; });
        if (안.length !== 2) return;                         // 두 칸이 아니면 포기
        // ⚠ **순서가 화면마다 다르다.** 대부분 [라벨][값]인데 온톨로지는 [값][라벨]이다.
        //   순서를 단정했다가 값 요소(#statCount)를 버려 화면이 통째로 터졌다(2026-08-02 실사고).
        //   숫자를 채우는 코드는 **id로** 찾으므로, id가 붙은 쪽이 값이다. id가 없으면 글자로 가린다.
        var a = 안[0], b = 안[1];
        var 값el = a.id ? a : (b.id ? b : null);
        if (!값el) {
          var 짧은쪽 = (a.textContent || "").trim().length <= (b.textContent || "").trim().length ? a : b;
          값el = 짧은쪽;
        }
        var 라벨el = 값el === a ? b : a;
        var 라벨 = (라벨el.textContent || "").trim();
        if (!라벨 || 라벨.length > 14) return;                // 라벨이 길면 문장형 판이다
        조각.push({ 라벨el: 라벨el, el: 값el });
      }
      if (!조각.length) return;

      var 막대 = document.createElement("div");
      막대.className = "gsum";
      조각.forEach(function (x, i) {
        if (i > 1) { var 점 = document.createElement("span"); 점.className = "gsum-dot"; 점.textContent = "·"; 막대.appendChild(점); }  // 첫 칸막이 뒤엔 점을 안 찍는다
        var 짝 = document.createElement("span");
        짝.className = "gsum-pair" + (i === 0 ? " first" : "");
        // ★ 라벨도 값도 **원래 요소를 옮긴다**(만들지 않는다). 어느 쪽에 id가 붙어 있을지
        //   모르고, 새로 만들면 그 id를 찾는 코드가 null을 만나 화면이 통째로 멈춘다.
        x.라벨el.classList.add("gsum-l");
        x.el.classList.add("gsum-v");                        // 색은 화면이 준 것을 그대로 둔다
        짝.appendChild(x.라벨el);
        짝.appendChild(x.el);
        막대.appendChild(짝);
      });
      // 이 시점에 남은 것은 빈 카드 껍데기뿐이다(라벨·값은 위에서 다 옮겼다).
      box.innerHTML = "";
      box.appendChild(막대);
      box.dataset.gijoSum = "1";
      box.classList.add("gsum-box");
      상단버튼줄합치기(막대);
    });
    // ⚠ 칸이 하나뿐인 요약 줄(작업 내역의 "작업 내역 100건 …")은 위에서 건너뛴다.
    //   그래도 **버튼 합치기는 해야 한다** — 안 그러면 그 화면만 버튼이 한 줄을 더 먹는다.
    var 남은 = document.querySelector("[data-gijo-summary]");
    if (남은) 상단버튼줄합치기(남은);
  }

  /**
   * 상단 버튼 줄을 요약 막대 **같은 줄**로 옮긴다
   * (2026-08-02 사용자 지시 "위협 인텔 상단 메뉴 한 줄로 통합" → "리포트도").
   *
   * 화면 제목은 이미 감춰서, 버튼 줄에는 버튼 두어 개만 남아 한 줄을 통째로 먹고 있었다.
   * 요약 막대와 버튼은 둘 다 "이 화면 맨 위에서 한 번 보는 것"이라 같은 줄에 있어도 된다.
   *
   * ⚠ 버튼을 **옮긴다**(다시 만들지 않는다). 새로 만들면 화면이 걸어 둔 클릭이 사라진다.
   * ⚠ 화면마다 따로 고치지 않는다 — 여기 하나로 같은 구조를 쓰는 화면이 전부 정리된다.
   */
  function 상단버튼줄합치기(막대) {
    try {
      var 줄 = document.querySelector(".topbar-row");
      if (!줄 || 줄.dataset.gijoMerged === "1") return;
      // 버튼이 든 묶음만 가져온다(제목 쪽은 이미 안 보인다).
      var 묶음 = null;
      [].forEach.call(줄.children, function (c) {
        if (!묶음 && c.querySelector && c.querySelector("button, a, select")) 묶음 = c;
      });
      if (!묶음) return;
      묶음.classList.add("gsum-acts");
      막대.classList.add("gsum-host");   // 한 줄로 눕힌다(요약 줄이 .gsum이 아닐 수도 있다)
      막대.appendChild(묶음);
      줄.dataset.gijoMerged = "1";
      줄.style.display = "none";   // 남은 껍데기가 자리를 먹지 않게
    } catch (e) { /* 못 합쳐도 화면은 그대로 돈다 */ }
  }
  window.gijo요약막대 = 요약막대로;

  /**
   * 요약 줄이 **늦게 그려지는 화면**을 위해 지켜본다.
   *
   * ⚠ 처음엔 "0.7초마다 10번 보기"로 했는데, 기록 보기(27,154건)처럼 자료가 많은 화면은
   *   그보다 늦게 카드를 그린다 — 그러면 영영 안 바뀐 채로 남는다(2026-08-02 사용자 신고:
   *   "기록 보기 메뉴에 한 줄로 변경"). **시간에 기대지 않는다** — 바뀌는 순간을 지켜본다.
   */
  function 요약감시걸기() {
    if (typeof MutationObserver !== "function") return;
    [].forEach.call(document.querySelectorAll("[data-gijo-summary]"), function (box) {
      if (box.__gijoSumWatch) return;
      box.__gijoSumWatch = true;
      new MutationObserver(function () {
        // 화면이 주기 갱신 등으로 요약 칸을 통째로 다시 그리면(innerHTML) 변환된 막대는 사라지고
        // 표식(gijoSum=1)만 남아 재변환을 스스로 막는다 — 15초 뒤 카드가 날것 세로로 풀리던 결함
        // (2026-08-21 사장님 QA, 작업 기록). 막대(.gsum)의 실존을 본다 — 없으면 표식을 지우고 다시 바꾼다.
        if (box.dataset.gijoSum === "1" && !box.querySelector(".gsum")) {
          delete box.dataset.gijoSum;
          box.classList.remove("gsum-box");
        }
        if (box.dataset.gijoSum === "1") return;   // 막대가 살아 있다 — 우리가 만든 변화다
        요약막대로();
      }).observe(box, { childList: true });
    });
  }

  // 공용 디자인 시스템(gijo-ui.css)을 모든 페이지에 주입한다 — .g-* 컴포넌트 사용 가능 + body.g-ui로
  // 안전한 전역 베이스라인(스크롤바·포커스링·폰트 스무딩)만 통일(레이아웃은 안 건드림).
  function loadDesignSystem() {
    // 🎨 프로 흰 바탕(2026-08-20) — 셸이 embedSrc에 실어 준 theme=light를 화면이 받아 단다.
    //   pro-white.css는 html.theme-light 스코프라 표준(신호 없음)에는 한 줄도 안 먹는다.
    if (/(^|[?&])theme=light(&|$)/.test(location.search)) {
      document.documentElement.classList.add("theme-light");
      if (!document.getElementById("proWhiteCss")) {
        var w = document.createElement("link");
        w.id = "proWhiteCss"; w.rel = "stylesheet"; w.href = "pro-white.css";
        document.head.appendChild(w);
      }
    }
    if (!document.getElementById("gijoUiCss")) {
      var l = document.createElement("link");
      l.id = "gijoUiCss"; l.rel = "stylesheet"; l.href = "gijo-ui.css";
      document.head.appendChild(l);
    }
    if (document.body) document.body.classList.add("g-ui");
    // ⚠ 지금 바로 재면 안 된다(검토관 2026-08-21 상3) — 제목을 숨기는 CSS(gijo-ui.css)를
    //   **방금 <link>로 주입**했으므로 이 시점엔 아직 안 붙어 「보임」으로 오판해 영영 안
    //   숨긴다. CSS가 실제로 붙은 뒤(onload)와 지연 재시도로 잰다 — 함수는 멱등이라 안전.
    var uiCss = document.getElementById("gijoUiCss");
    if (uiCss) uiCss.addEventListener("load", 빈제목줄걷기);
    [300, 1200].forEach(function (ms) { setTimeout(빈제목줄걷기, ms); });
  }

  /**
   * 내용이 0인 제목줄(.topbar-row)을 숨긴다 (2026-08-21 밀도 라운드).
   *
   * 왜: 공용 CSS가 화면 큰 제목을 전 화면에서 숨기는데(.g-ui .page-title — gijo-ui.css 230),
   *   버튼이 없는 화면은 제목줄 <div>가 **빈 채로 margin-bottom 18~20px만 먹고** 남는다.
   *   상단버튼줄합치기()는 버튼이 있어야만 줄을 숨기므로(if (!묶음) return) 버튼 없는
   *   화면 9곳이 그 길에 영영 못 탄다 — 조치 승인·통합 관제에서 손으로 걷어낸 것과 같은
   *   자리가 compliance·kpi·learnloop·memory·merge·products·redteam·settings·syslog에
   *   그대로 있었다(실측 18~20px = 목록 반 줄).
   * ⚠ 판정은 **실제 보임**으로 한다(offsetParent) — 마크업만 보면 부제(.page-sub)나
   *   화면 자체 요소가 살아 있는 화면(진짜 내용이 있는 줄)까지 숨겨 버린다.
   */
  function 빈제목줄걷기() {
    try {
      var 줄 = document.querySelector(".topbar-row");
      if (!줄 || 줄.dataset.gijoMerged === "1") return;
      if (줄.querySelector("button, a, select, input")) return; // 조작이 있으면 산 줄이다
      var 보임 = [].some.call(줄.querySelectorAll("*"), function (el) {
        return el.offsetParent !== null && (el.textContent || "").trim() !== "" && !el.children.length;
      });
      if (!보임) 줄.style.display = "none";
    } catch (e) { /* 못 걷어도 화면은 그대로 돈다 */ }
  }

  // 공용 '오른쪽 작업 화면'(작업 세션 + 지휘 콘솔)을 모든 페이지에 주입한다 — 어느 화면에서든
  // AI에게 지시할 수 있게. 대시보드는 자체 패널이 있어 commandpanel.js가 스스로 건너뛴다.
  // 오래 걸려 리포트로 돌린 요청의 완료 알림 — 전 화면 공통(맨 바깥 창에서만 뜬다).
  function loadLongNotice() {
    if (document.getElementById("gijoLnScript")) return;
    var s = document.createElement("script");
    s.id = "gijoLnScript";
    s.src = "longnotice.js";
    document.body.appendChild(s);
  }

  // 구역 접기 도우미 — 전 화면 공용. embed(팝업 안)에서도 실어야 한다: 접기가 가장 필요한 곳이
  // 바로 팝업 안이다(높이가 고정이라 세로로 긴 화면은 스크롤이 길어진다).
  function loadFold() {
    if (document.getElementById("gijoFoldScript")) return;
    var s = document.createElement("script");
    s.id = "gijoFoldScript";
    s.src = "fold.js";
    document.body.appendChild(s);
  }

  // 화면 안 대화상자(gijoAsk/gijoTell) — **모든 화면·모든 겹에 실어야 한다.**
  // window.confirm/alert은 Electron에서 OS 네이티브 모달이라 뜨는 순간 렌더러가 통째로 멈춘다
  // (탭 안이든 셸이든 같은 렌더러를 쓴다). 그래서 embed·분리창에서도 빠뜨리지 않는다.
  /** 하단 고정바 — 조각이 스스로 판단해 붙는다(셸·탭 안에서는 스스로 빠진다). */
  function loadFootbar() {
    if (document.getElementById("gijoFootbarScript")) return;
    var s = document.createElement("script");
    s.id = "gijoFootbarScript";
    s.src = "footbar.js";
    document.head.appendChild(s);
  }

  function loadDialog() {
    if (window.gijoAsk || document.getElementById("gijoDlgScript")) return;
    var s = document.createElement("script");
    s.id = "gijoDlgScript";
    s.src = "dialog.js";
    (document.body || document.documentElement).appendChild(s);
  }

  // (commandpanel.js는 4.0.0에서 없앴다 — 아래 boot() 주석 참고)

  // 클라이언트 자동 업데이트 확인 — 앱 시작 시 1회(+페이지 이동마다 10분 캐시로 재확인).
  // 로그인 전(login.html은 gijoNav가 없어 render() 자체를 안 함)에는 자연히 건너뛴다.
  function checkUpdateBadge() {
    if (!window.gijo || !window.gijo.update || !window.gijo.isAuthenticated || !window.gijo.isAuthenticated()) return;
    var THROTTLE_MS = 10 * 60 * 1000;
    var last = Number(sessionStorage.getItem("gijoUpdateCheckAt") || 0);
    var cached = sessionStorage.getItem("gijoUpdateAvailable");
    if (cached !== null && Date.now() - last < THROTTLE_MS) {
      updateAvailable = cached === "1";
      render();
      return;
    }
    window.gijo.update
      .checkForUpdate()
      .then(function (r) {
        updateAvailable = Boolean(r && r.updateAvailable);
        sessionStorage.setItem("gijoUpdateCheckAt", String(Date.now()));
        sessionStorage.setItem("gijoUpdateAvailable", updateAvailable ? "1" : "0");
        render();
      })
      .catch(function () {});
  }

  // embed 모드 — 셸 탭(app.html)의 iframe으로 품길 때(?embed=1). 사이드바·헤더를 숨기고 본문만
  // 보인다(셸이 바깥에서 메뉴·탭줄·콘솔을 제공).
  var IS_EMBED = /(^|[?&])embed=1(&|$)/.test(location.search);

  // ⚠ "탭 안에서의 navigateTo를 탭 열기로 바꾸는 일"을 여기서 하려다 실패했다(2026-07-31).
  //   window.gijo는 contextBridge로 노출된 객체라 **렌더러에서 덮어쓸 수 없다** — 조용히
  //   무시되어 아무 일도 안 일어났다. 그래서 그 판단은 다리인 preload.ts의 navigateTo가 한다.
  //   여기 다시 만들지 말 것.
  // 탭 안 화면이 다른 화면을 열 때 쓰는 다리 — 자기 자리를 갈아치우지 않고 **셸에 새 탭을 부탁**한다.
  // (대시보드 바로가기 타일처럼 "여기서 저기로" 보내는 자리들이 이걸 쓴다.)
  /**
   * 화면 하나를 연다 — 메뉴·상단 바 찾기·대시보드가 **같은 길**을 쓴다.
   * ⚠ 2026-08-02에 같은 이름의 함수를 하나 더 만들었다가 뒤엣것만 살아남아, 앞엣것을 믿고 짠
   *   쪽(대시보드 이동·상단 찾기)이 조용히 깨졌다. 정의는 여기 **하나뿐**이어야 한다.
   * @param page 화면 주소 문자열, 또는 항목 객체 {page|win, label}
   */
  window.gijoOpenScreen = function (page, label) {
    if (page && typeof page === "object") { label = page.label || label; page = page.win ? { win: page.win } : page.page; }
    if (page && page.win) {                                                    // 별도 창(팀 사무실·문서함·문서 작성)
      if (window.gijo && typeof window.gijo[page.win] === "function") { window.gijoOpenWindowResult(window.gijo[page.win](), label); return true; }
      gijoTell((label || "이 화면") + "을(를) 열 수 없습니다 — 앱을 다시 시작해 보시고, 계속되면 알려주세요.");
      return false;
    }
    if (!page) return false;
    if (window.gijoTabs) { window.gijoTabs.open(page, label); return true; }   // 셸 자신
    if (window.parent !== window) {                                            // 탭 안
      try { window.parent.postMessage({ type: "gijo:openTab", page: page, label: label || null }, "*"); return true; } catch (e) {}
    }
    go(page);                                                                  // 그 외(분리창 등)는 이동
    return true;
  };
  // 분리창(별도 창) — 이 창은 "한 화면을 크게 보려고" 떼어낸 것이다. 왼쪽 메뉴로 다른 데를
  // 가려는 창이 아니고(그건 대시보드가 한다), 좁은 폭에서 메뉴가 자리만 먹는다.
  // 그래서 메뉴를 숨기고 폭을 다 준다(2026-07-27 사용자 지적).
  var IS_POPOUT = /(^|[?&])popout=1(&|$)/.test(location.search);
  function applyEmbed() {
    loadDesignSystem();
    var st = document.createElement("style");
    st.textContent = "html,body{overflow:auto !important;height:auto !important;}" +
      // 긴 목록 내부 스크롤은 임베드에서도 동일(허브 탭 안의 threat·audit 등)
      ".scroll-list{min-height:260px;overflow-y:auto;}" +   // 높이는 gijoFitList가 재서 준다
      ".scroll-list thead th{position:sticky;top:0;background:var(--panel,#30302e);z-index:1;}" +
      ".footer{display:none !important;}" +
      "*::-webkit-scrollbar{width:8px;height:8px;}*::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px;}*::-webkit-scrollbar-track{background:transparent;}" +
      ".header{display:none !important;}#gijoNav{display:none !important;}" +
      ".app{grid-template-columns:1fr !important;display:block !important;}" +
      // 화면 안 챗봇 위젯은 팝업에서 숨긴다(2026-07-27). 지시와 설명은 대시보드 대화 한 곳에서만
      // 하기로 했는데, 이 위젯이 화면 맨 위를 차지해 정작 봐야 할 요약 카드를 아래로 밀어냈다.
      // ⚠ 분리창(별도 창)에서는 대시보드가 없으므로 지우지 않는다 — embed(팝업 안)에서만.
      "#gijoChatWidget{display:none !important;}" +
      ".main{padding-top:16px !important;}" +
      // 그룹 허브 무대 안(&hub=1)에서는 화면 제 「한눈에」 그림띠를 숨긴다 — 허브가 바로 위에
      // 같은 그림을 이미 두고 있어 한 화면에 같은 숫자가 두 번 나온다(2026-08-09 사용자 지적).
      // ⚠ 요약 줄(전체 자산 57·고위험 27…)과 필터 표시(#vizFilter)는 **남긴다** — 그림띠와
      //   다른 정보이고, 지우면 무대에서 무엇이 걸러졌는지 알 수 없다.
      (/[?&]hub=1/.test(location.search) ? "#vizStrip{display:none !important;}" : "") +
      목록양식CSS();
    document.head.appendChild(st);
  }

  // 작업 세션 배지 — 진행중 건수를 메뉴에 띄운다. 0이면 배지를 감춘다("진행중 0"은 알릴 일이 아니다).
  // 실패해도 조용히 넘어간다 — 배지가 없다고 메뉴가 망가지진 않는다.
  function refreshSessionBadge() {
    if (!window.gijo || !window.gijo.listWorkSessions) return;
    window.gijo.listWorkSessions().then(function (list) {
      var n = (list || []).filter(function (s) { return s.status === "active"; }).length;
      document.querySelectorAll(".gn-sessbadge").forEach(function (b) {
        // 99를 넘으면 99+로 — 세 자리가 되면 배지가 늘어나 옆 글자를 밀어내고, 그쯤 되면
        // 정확한 숫자는 의미가 없다(배지 설계 통례). QA·회귀가 세션을 만들어 실제로 60건을
        // 넘긴 적이 있어 남의 일이 아니다.
        b.textContent = n > 99 ? "99+" : String(n);
        // 색·숫자만으로는 읽어주는 도구가 뜻을 모른다 — 말로도 남긴다.
        b.setAttribute("aria-label", "진행중인 작업 " + n + "건");
        b.style.display = n > 0 ? "" : "none";
      });
    }).catch(function () {});
  }

  // 내 업무 배지 — 기한 초과 건수. 0이면 감춘다(늦은 게 없으면 알릴 일이 아니다).
  function refreshWorkBadge() {
    if (!window.gijo || !window.gijo.myWork) return;
    window.gijo.myWork().then(function (w) {
      var n = (w && w.counts && w.counts.overdue) || 0;
      document.querySelectorAll(".gn-workbadge").forEach(function (b) {
        b.textContent = n > 99 ? "99+" : String(n);
        b.setAttribute("aria-label", "기한이 지난 업무 " + n + "건");
        b.style.display = n > 0 ? "" : "none";
      });
    }).catch(function () {});
  }

  // 오늘 새로 들어온 문서 배지 — "내 문서"에 오늘 반입된 문서 수를 띄운다(2026-08-21 승인 시안
  //   menu-reorg). 0이면 감춘다(새 게 없으면 알릴 일이 아니다). 실패해도 조용히 넘어간다.
  //   preload가 이 기기의 자정(현지시각)을 ISO로 계산해 넘긴다 — 서버 ingestedAt(UTC ISO)과
  //   문자열 비교로 맞고, "오늘"의 경계는 사람이 있는 시간대가 정한다(자정 경계 함정 회피).
  function refreshDocBadge() {
    if (!window.gijo || !window.gijo.recentDocCount) return;
    window.gijo.recentDocCount().then(function (r) {
      var n = (r && typeof r.count === "number") ? r.count : 0;
      document.querySelectorAll(".gn-docbadge").forEach(function (b) {
        b.textContent = n > 99 ? "99+" : String(n);
        b.setAttribute("aria-label", "오늘 새로 들어온 문서 " + n + "건");
        b.style.display = n > 0 ? "" : "none";
      });
    }).catch(function () {});
  }

  // 분리창 — 왼쪽 메뉴를 지우고 내용이 창 폭을 다 쓰게 한다. 가장자리 토글도 두지 않는다:
  // 이 창에서 메뉴를 열 일이 없고(이동은 대시보드에서), 토글만 남으면 그게 또 하나의 조작이 된다.
  function applyPopout() {
    // 🚀 팝업 배관(2026-08-19): 별도 창에서는 window.top === window라, 화면 스크립트가
    // 부모에게 보낸 gijo:*가 **자기 자신에게 돌아온다.** 여기서 잡아 IPC로 셸에 전한다.
    // ⚠ gijo:view는 안 보낸다 — 「보는 목록」은 활성 탭 기준의 개념이라 팝업에선 뜻이 없고,
    //   셸의 활성탭 검사에 걸러질 뿐이다. select(고른 것)·scope(범위)·openTab(화면 열기)만.
    // 발신자 검증(2026-08-20 외부 조사 2순위) — 자기 자신(selectnotify가 top===window로
    // 되돌아오는 경로) 또는 이 창 프레임 트리의 자손(허브형 화면 안 iframe)만 받는다.
    // ⚠ P4(2026-08-19)가 깨졌던 원인은 「self만」 검사였지 검사 자체가 아니다 —
    //   self+자손 둘 다 받으면 두 실경로가 살고, 남의 top-level 창發만 배제된다.
    function 팝업발신자인가(src) {
      if (src === window) return true;
      try {
        var w = src, n = 0;
        while (w && n < 6) {
          if (w.parent === window) return true;
          if (w.parent === w) return false;
          w = w.parent;
          n++;
        }
      } catch (e) { /* 못 닿으면 아닌 것으로 */ }
      return false;
    }
    window.addEventListener("message", function (ev) {
      var d = ev.data;
      if (!d) return;
      // ☑ 근거 지정·📎 첨부(노트북형 2026-08-30)도 중계한다 — 내 문서를 (창)으로 빼 쓰는
      // 사람의 체크·첨부가 셸 대화창(근거띠)에 닿아야 한다. 안 넣으면 팝업에서만 조용히 죽는다
      // (bridgerelay.test가 이 목록과 셸 수신부의 일치를 못박는다).
      // gijo:prefill(2026-08-30 검토관 2차) — 화면을 창으로 빼 쓰는 사람의 「적어 넣기」가
      // 셸 대화창에 닿아야 한다. 종전 제외 사유(「팝업엔 자기 chatwidget이 있다」)는 prefill엔
      // 거짓이었다 — chatwidget에 prefill 수신이 0건이라 팝업 대시보드에서 조용히 죽고 있었다.
      if (d.type !== "gijo:select" && d.type !== "gijo:scope" && d.type !== "gijo:openTab"
        && d.type !== "gijo:docscope" && d.type !== "gijo:attach" && d.type !== "gijo:opendoc"
        && d.type !== "gijo:prefill") return;
      if (!ev.source || !팝업발신자인가(ev.source)) return;
      if (window.gijo && window.gijo.bridgeToShell) window.gijo.bridgeToShell(d);
    });
    // 셸이 퍼뜨린 범위를 이 창의 화면에도 먹인다(scopefilter가 받는 그 메시지로 재주입).
    if (window.gijo && window.gijo.onShellBridge) {
      window.gijo.onShellBridge(function (d) {
        if (d && d.type === "gijo:scope:set") window.postMessage(d, "*");
        // ☑ 전체 해제(노트북형 역방향) — 셸 근거띠의 ×가 팝업 내 문서의 체크도 되돌린다.
        // 정방향(gijo:docscope 중계)만 넣고 이걸 빠뜨리면 「화면-칩 딴말」이 팝업에만 남는다.
        if (d && d.type === "gijo:docscope:clear") window.postMessage(d, "*");
      });
    }

    var st = document.createElement("style");
    st.textContent =
      "#gijoNav{display:none !important;}" +
      // ⚠ 분리창에는 푸터 숨김이 **빠져 있었다**(2026-08-02 발견). 탭 안에서는 감춰지는데
      //   창으로 빼면 화면마다 다른 푸터(긴 문구/짧은 문구 두 가지)가 그대로 나왔다.
      //   하단 표시는 셸의 고정바 하나뿐이다.
      ".footer{display:none !important;}" +
      ".app{grid-template-columns:minmax(0,1fr) !important;display:block !important;}" +
      ".explorer{display:none !important;}" +
      ".main{padding-left:18px !important;padding-right:18px !important;}" +
      // 가로/세로 전환 — 예전엔 허브가 그렸는데 허브를 없애서(4.0.0) 여기로 옮겼다.
      // 세로(피벗) 모니터를 쓰는 관제실이 있어 남겨 둔다.
      ".gijo-orient{position:fixed;top:10px;right:14px;z-index:950;background:var(--panel-2,#1f1e1d);color:var(--muted,#b3ada4);" +
      "border:1px solid var(--border,#3d3c38);border-radius:8px;font-size:12.25px;font-weight:800;padding:5px 10px;cursor:pointer;}" +
      ".gijo-orient:hover{color:var(--text-strong, #fff);border-color:var(--blue,#3b82f6);}";
    document.head.appendChild(st);
    if (!window.gijo || !window.gijo.setPopoutOrientation) return;
    var orient = /[?&]orient=portrait(&|$)/.test(location.search) ? "portrait" : "landscape";
    var b = document.createElement("div");
    b.className = "gijo-orient";
    var paint = function () {
      b.textContent = orient === "portrait" ? "↔ 가로" : "↕ 세로";
      b.title = orient === "portrait" ? "가로 창으로 — 모니터 오른쪽 절반" : "세로 창으로 — 세로(피벗) 모니터 관제용";
    };
    paint();
    b.addEventListener("click", function () {
      orient = orient === "portrait" ? "landscape" : "portrait";
      try { window.gijo.setPopoutOrientation(orient); } catch (e) {}
      paint();
    });
    document.body.appendChild(b);

    // ⇤ 붙이기(승인 시안 프로_도킹패널 §10-3) — 이 창을 본창 도킹 패널로 되돌린다.
    // 판단(폭 하한·슬롯)은 전부 본창이 한다 — 여기는 부탁만 보낸다(성공 시 본창이 이 창을 닫는다).
    // 기존 어휘 「⇤ 대화 여기로 다시 붙이기」(app.html csBackBtn)와 같은 결.
    if (window.gijo && window.gijo.bridgeToShell) {
      var dk = document.createElement("div");
      dk.className = "gijo-orient";
      dk.style.right = "92px";
      dk.textContent = "⇤ 붙이기";
      dk.title = "이 화면을 본창(대화창 자리 무대)으로 되돌립니다 — 창은 닫힙니다";
      dk.addEventListener("click", function () {
        // 라벨 동봉 — 없으면 본창 화면이름찾기가 빈손일 때 도킹 머리가 「화면」으로 떨어진다(실측).
        var 라벨 = (document.title || "").replace(/^GIJO AS( — )?/, "").trim();
        try { window.gijo.bridgeToShell({ type: "gijo:dockback", page: currentPage(), label: 라벨 }); } catch (e) {}
      });
      document.body.appendChild(dk);
    }
  }

  // 화면 크기 단축키 — 데스크톱 앱 관례대로 Cmd/Ctrl + '＋·－·0'. 배율 계산·저장은 메인 프로세스가
  // 하므로 여기서는 방향만 넘긴다. 입력 중(input/textarea)에도 동작해야 해서 대상은 가리지 않는다.
  function bindZoomKeys() {
    if (window.__gijoZoomKeys) return;
    window.__gijoZoomKeys = true;
    window.addEventListener("keydown", function (e) {
      // Ctrl/Cmd+K — 상단 바의 화면 찾기 겹판을 연다(2026-08-02 이관).
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        if (typeof window.gijoOpenFinder === "function") { e.preventDefault(); window.gijoOpenFinder(); return; }
      }
      // ⚠ 확대·축소(Ctrl + · − · 0)는 **여기서 처리하지 않는다**(2026-08-02).
      //   메인 프로세스가 모든 창에 직접 걸었다(main.ts bindZoom → before-input-event).
      //   같은 일을 두 군데서 하면 반드시 어긋난다 — 실제로 여기 있던 `setUiZoom(0)`은
      //   0을 배율로 넘겨 **최소값 80%로 떨어뜨렸다**(기본으로 되돌릴 셈이었는데 정반대).
    });
  }

  function boot() {
    bindZoomKeys();
    loadDialog(); // 어느 겹에서든 먼저 — 네이티브 모달이 뜨면 그 순간 모두 멈춘다
    loadFold(); // embed에서도 실어야 한다 — 팝업 안이 접기가 가장 필요한 곳이다
    loadFootbar(); // 하단 고정바 — 어느 창에서 열든 같은 자리에 같은 모양으로(2026-08-02)
    // 요약 카드 줄 → 한 줄 막대. 숫자는 나중에 채워지므로 **모양만** 미리 바꿔 두면 된다.
    // ⚠ 화면이 요약 줄을 나중에 그리는 경우가 있어(목록을 받아야 카드가 생긴다) 잠깐 더 지켜본다.
    //   embed(탭 안)에서도 돌아야 한다 — 담당자가 실제로 보는 자리가 거기다.
    요약막대로();
    // ⚠ 감시자(요약감시걸기)는 2026-08-02 도입 때부터 **아무도 안 부르는 죽은 코드**였다
    //   (2026-08-21 검토관 B상1 — 전수 검색 호출부 0). 그래서 화면이 요약 칸을 통째로 다시
    //   그리면 막대가 풀린 채 되살아나지 않았다(작업 기록 15초 갱신 실사고). 여기서 건다.
    요약감시걸기();
    var 요약틱 = 0;
    var 요약감시 = setInterval(function () { 요약막대로(); 요약감시걸기(); if (++요약틱 > 10) clearInterval(요약감시); }, 700);
    // 목록 높이도 같은 이유로 첫 그림 뒤에 한 번 더 잰다.
    [300, 900, 2000, 4000].forEach(function (ms) { setTimeout(function () { window.gijoFitList && window.gijoFitList(); }, ms); });
    // 탭 안(embed)에서도 흡수는 태운다 — 열어 둔 탭이 옛 화면에 그대로 머물면 담당자는
    // "메뉴는 없어졌는데 탭에는 있는" 두 세계를 보게 된다(2026-08-09 발견·수집 통합에서 실측).
    // ⚠ 허브 무대(&hub=1)는 흡수 대상이 아니다 — 태우면 허브 안에서 허브를 여는 무한 중첩.
    //    이 자리에서는 navigateTo(새 탭 열기)가 아니라 **그 자리 교체**(replace)여야 한다.
    if (IS_EMBED) {
      if (!/[?&]hub=1/.test(location.search)) {
        // 흡수 키는 주소 정확 일치인데, 프로가 표시용 theme=light를 붙이면 키가 안 맞아
        // 폐지 화면 23종이 허브로 못 넘어간다(검토관 배색 중5 — 프로에서만 재발하는 부류).
        // 표시용 파라미터는 키에서 떼고, 흡수 주소에는 도로 붙인다.
        var 검색 = (location.search || "").replace(/([?&])theme=light(&|$)/, function (_, a, b) { return b === "&" ? a : ""; });
        var 테마붙임 = /(^|[?&])theme=light(&|$)/.test(location.search) ? "&theme=light" : "";
        var 흡수 = TAB_REDIRECT[currentPage() + 검색];
        if (흡수) { location.replace(흡수 + 테마붙임); return; }
      }
      applyEmbed();
      return;
    }
    // 탭으로 흡수된 페이지에 직접 들어오면(대시보드 바로가기·챗봇 링크 등) 허브의 그 탭으로 보낸다.
    // ⚠ 설정처럼 한 파일이 여러 탭인 화면은 **쿼리까지 봐야** 한다(2026-07-28 실측):
    //    쿼리를 무시하면 ?s=link로 들어와도 서버·AI 탭으로 끌려가 늘 같은 화면만 보인다.
    //    단, 파일명 흡수처는 **쿼리가 없을 때만** 탄다 — settings.html?s=my처럼 쿼리로 구역을
    //    고른 주소가 파일명 항목(settings.html→?s=ai)에 끌려가면 어느 구역을 눌러도 서버·AI만 열린다.
    var target = TAB_REDIRECT[currentPage() + (location.search || "")] || (location.search ? null : TAB_REDIRECT[currentPage()]);
    if (target && window.gijo && window.gijo.navigateTo) { window.gijo.navigateTo(target); return; }
    loadDesignSystem();
    if (IS_POPOUT) { applyPopout(); loadLongNotice(); return; } // 분리창은 메뉴 없이 내용만
    setupLeftCollapse(); // 왼쪽 접기 인프라(대시보드 포함) — 저장 상태 복원 + 가장자리 탭
    render();
    // 온보딩 오버레이(onboarding.js) 로드는 2026-07-30에 지웠다 — 대시보드의 "시작 가이드 카드"가
    // 대신한다. 오버레이는 평소에 안 보여 "있는 줄 모르는 기능"이 됐고, 같은 일을 하는 자리가
    // 둘이면 조작 개념만 늘어난다(3.5.0 직관성 개편 원칙).
    // commandpanel.js(오른쪽 숨은 팝업 — 작업 세션·AI 오피스)는 4.0.0에서 삭제했다.
    // 2026-07-27에 입구인 가장자리 세로 탭을 이미 없앤 상태였고, 두 기능 모두 정식 화면이
    // 됐다(관제 > 작업 세션 / 🏢 팀 사무실 창). 남은 건 아무도 못 여는 숨은 DOM과 iframe이
    // 전 화면에 실리는 것뿐이라, "메뉴에 있는 내부팝업 전체 삭제" 지시에 따라 걷어냈다.
    // ⚠ 배지는 **한 번만 부르면 안 된다**(2026-08-01 실앱 실측). 부팅 순간에는 아직 로그인
    //   전이라 조회가 401로 떨어지는데, 실패를 조용히 삼키는 구조라 그대로 빈칸으로 굳었다
    //   — 기한 지난 업무가 6건인데 화면엔 아무 표시가 없었다. 두 배지가 같은 결함을 공유한다.
    //   그래서 ① 곧바로 ② 로그인이 끝날 즈음 한 번 더 ③ 그 뒤로는 주기적으로 새로 읽는다.
    function 배지새로고침() { refreshSessionBadge(); refreshWorkBadge(); refreshDocBadge(); }
    배지새로고침();
    setTimeout(배지새로고침, 3000);
    setInterval(배지새로고침, 60000);

    loadLongNotice();
    checkUpdateBadge();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
