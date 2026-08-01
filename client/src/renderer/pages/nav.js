// nav.js — GIJO AS 네비게이션 (시안 B: 아이콘 레일 + 서브패널).
// 모든 페이지의 <div id="gijoNav"> 안에 [얇은 아이콘 레일 | 서브패널]을 그린다. 레일에서 대분류를
// 고르면 그 분류의 기능이 서브패널에 나오고, 항목을 클릭하면 그 페이지로 이동한다(기존 멀티페이지
// 구조 유지 — 페이지별 대량 수정 없이 좌측 IA만 시안 B로 교체하는 저위험 방식).
// 스타일은 페이지 :root 토큰(--panel-2·--border·--blue…)을 그대로 쓰므로 다크 테마와 일관된다.

(function () {
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
  var TOP = [
    { page: "dashboard.html", label: "대시보드", fixed: true },
    // ⚠ 별도 창으로 여는 항목은 **win에 여는 함수 이름을 적는다**(preload의 window.gijo.*).
    //   예전엔 `office: true` 같은 항목별 표시를 두고 클릭 처리에서 이름을 하나씩 봤는데,
    //   문서함을 더할 때 그 분기를 안 더해서 **메뉴를 눌러도 아무 일도 안 났다**(4.9.0 실사고).
    //   page가 없는 항목이 탭 열기로 떨어져 undefined 탭을 여니 조용히 실패한다.
    //   win을 보고 처리하면 새 창 항목을 더해도 클릭 처리를 고칠 일이 없다.
    { win: "openTeamOffice", label: "팀 사무실 (창)", ic: "🏢", fixed: true },
    // ⚠ 「내 업무」 메뉴는 없앴다(2026-08-01 사용자 지시 — "내업무 메뉴는 삭제하고 그 안에
    //   있는 모든 내용은 대화창에서"). 목록·담기·완료·절차 밟기는 전부 대화창 도구로 옮겼다:
    //   picklist 결정적 목록 + add_task·complete_task·work_steps·step_done·step_undo·routine_tasks.
    //   화면을 되살릴 일이 있으면 그 도구들과 겹치지 않게 먼저 정리할 것.
    // 문서함 — 가이드·아키텍처를 읽는 별도 창(주소가 없어 별표 대상 아님, 팀 사무실과 같음)
    { win: "openDocbox", label: "문서함 (창)", ic: "📚", fixed: true },
    { page: "sessions.html", label: "작업 내역", fixed: true },
  ];

  var GROUPS = [
    { id: "monitor", ic: "🖥", label: "관제", items: [
      // '내 업무 바로가기'는 즐겨찾기로 대신한다(2026-07-28 사용자 결정) — 원래 대시보드 위
      // 팝업으로 열리던 기능인데 팝업을 없앴고, "자주 가는 화면을 빨리"는 별표가 더 곧다.
      { page: "analysis.html", label: "통합 관제" },
      { page: "threat.html", label: "위협 인텔" },
      { page: "report.html", label: "리포트" },
      { page: "kpi.html", label: "보안 KPI" },
      { page: "compliance.html", label: "컴플라이언스" },
    ]},
    { id: "assets", ic: "🛡", label: "자산·조치", items: [
      { page: "assethub.html", label: "자산 통합 뷰" },
      { page: "inventory.html", label: "자산 목록" },
      { page: "sbom.html", label: "AI-BOM" },
      { page: "vulnscan.html", label: "취약점" },
      { page: "approvals.html", label: "조치·승인" },
      { page: "terminal.html", label: "터미널 (CLI)" },
    ]},
    // 보안제품(2026-08-01 사용자 지시로 신설) — 자산·조치에 10개가 몰려 훑기 어려웠다.
    // 「우리가 산 장비를 등록하고·정비하고·점검하는」 한 갈래라 따로 세운다.
    // ⚠ 「유지보수 점검」은 기한이 있는 **일감**(늦었나·검토 대기인가), 「제품 유지보수」는 읽는
    //   **가이드**다. 이름이 비슷해 붙여 둔다 — 떨어뜨려 놓으면 둘 다 못 찾는다.
    { id: "products", ic: "🧰", label: "보안제품", items: [
      { page: "products.html", label: "보안제품 등록부" },
      { page: "opsguide.html", label: "제품 유지보수" },
      { page: "maintenance.html", label: "유지보수 점검" },
      { page: "hardening.html", label: "원격 정기점검" },
    ]},
    // 업무 관리(2026-08-01 사용자 지시로 신설) — 지금은 인수인계 하나다.
    // 항목이 하나여도 그룹을 세운 것은 「사람·업무를 넘기는 일」이 AI 기능과 성격이 다르기 때문이다.
    { id: "work", ic: "📋", label: "업무 관리", items: [
      { page: "handover.html", label: "인수인계" },
    ]},
    { id: "ai", ic: "🤖", label: "AI", items: [
      { page: "agent.html", label: "에이전트 AI" },
      { page: "merge.html", label: "LLM 합성" },
      { page: "redteam.html", label: "레드팀·가드레일" },
    ]},
    // 데이터 플라이휠(2026-08-01 사용자 지시로 신설, 원 지시는 "Data Flywheel").
    // **쓸수록 똑똑해지는 고리** — 자료를 넣고(기억·학습) 뜻을 잇고(온톨로지) 되먹임으로
    // 다듬는(학습 루프) 세 화면이 한 고리다. AI 기능(에이전트·합성·레드팀)과 성격이 다르다.
    // ⚠ 이름을 한글로 적는다 — 사용자 대상 텍스트는 한글이 이 제품의 원칙이다(CLAUDE.md).
    { id: "flywheel", ic: "🔄", label: "데이터 플라이휠", items: [
      { page: "memory.html", label: "기억·학습 (RAG)" },
      { page: "ontology.html", label: "온톨로지" },
      { page: "learnloop.html", label: "학습 루프" },
    ]},
    // 설정 5구역(2026-07-28) — 기준은 기능이 아니라 **결정권자**다.
    // 내 것 / 모두의 것(서버·AI) / 바깥과 잇는 것 / 관리자만 / 보기만.
    // 같은 settings.html을 ?s= 로 걸러 보여준다(파일을 쪼개면 공통 스크립트가 어긋난다).
    { id: "settings", ic: "⚙", label: "설정", bottom: true, items: [
      { page: "settings.html?s=my", label: "내 설정" },
      { page: "settings.html?s=ai", label: "서버·AI" },
      { page: "settings.html?s=link", label: "연동" },
      { page: "settings.html?s=admin", label: "관리자" },
      { page: "audit.html", label: "기록 보기" },
    ]},
  ];

  // 없어진 화면의 옛 주소 → 흡수처. 허브를 걷어낸 뒤로는 화면이 곧 주소라 딥링크가 필요 없고,
  // **사라진 화면만** 여기서 돌려보낸다(기존 바로가기·챗봇 링크가 죽지 않게).
  var TAB_REDIRECT = {
    "reference.html": "settings.html?s=my",     // 기능 안내 → AI가 대신(2026-07-25)
    "billing.html": "audit.html",               // 사용량·요금 → 기록 보기
    "mcp.html": "settings.html?s=link",         // 2026-07-28 설정 5구역으로 흡수
    "update.html": "settings.html?s=admin",
    "logs.html": "audit.html",
    "llmguide.html": "settings.html?s=ai",      // 추천 모델 목록 → 설정 서버·AI
    "docenrich.html": "memory.html",            // 문서 보강 → 기억·학습에 병합
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
  // 지금 보고 있는 화면의 챗봇을 연다. 일반 화면은 같은 문서에 위젯이 있고(gijoOpenChat),
  // 허브는 화면을 iframe으로 품으므로 보이는 프레임에 postMessage로 넘긴다. 열 대상이 없으면 false.
  function openChatHere() {
    if (window.gijoOpenChat) { window.gijoOpenChat(); return true; }
    var sent = false;
    Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
      if (!f.offsetParent) return; // 숨어 있는 탭 프레임은 건너뛴다
      try { f.contentWindow.postMessage({ type: "gijo:openChat" }, "*"); sent = true; } catch (e) {}
    });
    return sent;
  }
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
      + ".scroll-list{max-height:calc(100vh - 300px);min-height:260px;overflow-y:auto;}"
      + ".scroll-list thead th{position:sticky;top:0;background:var(--panel,#121a2e);z-index:1;}"
      // 하단 로고·저작권 푸터 제거(2026-07-26 사용자 결정) — 정보 가치가 없고 화면마다
      // 잘려 보였다. 개별 HTML은 건드리지 않고 공용 CSS로 한 번에 숨긴다.
      + ".footer{display:none !important;}.main{padding-bottom:20px;}" +
      "#gijoNav{padding:0 !important;border-right:1px solid var(--border) !important;min-height:0 !important;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;align-self:start;z-index:20;background:var(--panel-2);}" +
      ".gn-top{padding:8px;border-bottom:1px solid var(--border);flex:0 0 auto;display:flex;align-items:center;gap:6px;}" +
      ".gn-top .gn-seg{flex:1;}" +
      // 패널 접기 버튼(좌우 공통 디자인, 2026-07-25 대칭 통일)
      ".gn-pcol{flex:0 0 auto;width:26px;height:26px;border-radius:7px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);color:var(--blue-light);display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;}" +
      ".gn-pcol:hover{background:var(--blue);color:#fff;}" +
      // 왼쪽 가장자리 토글 — 접힘=화면 왼쪽 끝, 열림=사이드바 경계에 반쯤 걸침.
      // ⚠ 예전엔 '◀ 접기'를 세로로 눕혀 썼다. 세로 글씨는 읽는 데만 시간이 걸려서
      //    화살표 하나로 줄였다(2026-07-27). 뜻은 툴팁이 말한다.
      ".gn-edge{position:fixed;top:50%;transform:translateY(-50%);width:18px;height:44px;background:var(--panel-2,#0e1526);color:var(--muted,#8b93ab);border:1px solid var(--border,#1e2a44);border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:900;box-shadow:2px 0 10px rgba(0,0,0,.35);}" +
      ".gn-edge:hover{color:var(--blue-light,#7ab0ff);border-color:var(--blue,#3b82f6);}" +
      "body.gn-left-collapsed #gijoNav{display:none !important;}" +
      "body.gn-left-collapsed .app{grid-template-columns:minmax(0,1fr) 46px !important;}" +
      "body.gn-left-collapsed .explorer{display:none !important;}" +
      "body.gn-left-collapsed .body-grid{grid-template-columns:1fr 360px !important;}" +
      "body.gn-left-collapsed .body-grid.no-right{grid-template-columns:1fr !important;}" +
      ".gn-seg{display:flex;background:#0a1120;border:1px solid var(--border-strong);border-radius:9px;padding:3px;gap:3px;}" +
      ".gn-seg span{flex:1;text-align:center;padding:6px 4px;border-radius:7px;font-size:11px;font-weight:800;color:var(--muted);cursor:pointer;border:1px solid transparent;}" +
      ".gn-seg span.on{background:rgba(59,130,246,.22);color:#fff;border-color:rgba(59,130,246,.5);}" +
      ".gn-mid{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 6px;}"
      + "#gijoNav .gtb-userarea{flex:0 0 auto;position:sticky;bottom:0;background:var(--panel-2,#0e1526);}" +
      ".gn-mid::-webkit-scrollbar{width:5px;} .gn-mid::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px;}" +
      // 그룹 헤더 = 트리의 가지. 눌러서 접었다 편다(4.0.0: 허브를 풀어 항목이 30개가 되면서
      // 한 번에 다 보이면 훑기 어렵다 — 안 쓰는 그룹은 접어 둘 수 있게).
      // 가지 이름은 메뉴를 훑는 기준점이라 본문 항목과 비슷한 크기로 둔다. 예전 9.5px·자간 1.2px는
      // 영문 대문자 소제목용 값이라 한글에서는 작고 성글어 읽히지 않았다(2026-07-28 사용자 지적).
      ".gn-g{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:var(--muted);" +
      "letter-spacing:.2px;margin:13px 6px 5px;padding:5px 5px;border-radius:6px;cursor:pointer;user-select:none;}" +
      ".gn-g:hover{color:var(--blue-light,#7ab0ff);background:rgba(255,255,255,.03);}" +
      ".gn-g .car{font-size:9px;width:10px;flex:0 0 auto;transition:transform .13s;}" +
      ".gn-g.open .car{transform:rotate(90deg);}" +
      ".gn-g .cnt{margin-left:auto;font-size:10px;font-weight:700;color:var(--muted-2);opacity:.75;}" +
      ".gn-g.open .cnt{opacity:0;}" + // 펼치면 개수는 군더더기 — 눈으로 보인다
      ".gn-g:first-child{margin-top:2px;}" +
      ".gn-kids{display:block;}" +
      ".gn-kids.closed{display:none;}" +
      ".gn-kids .gn-item{padding-left:20px;}" + // 한 칸 들여써서 가지에 달린 것임을 보인다
      // 맨 위 고정 세 자리 — 가지에 안 달렸으니 들여쓰지 않고, 아래에 얇은 금으로 구분한다.
      ".gn-top-fixed{padding-bottom:7px;margin-bottom:3px;border-bottom:1px solid rgba(255,255,255,.07);}" +
      ".gn-top-fixed .gn-item{padding-left:11px;}" +
      // 찾기 — 가지를 기본으로 접어 두니(4.0.0) "어느 가지에 있더라"를 모르면 하나씩 열어봐야 한다.
      // 이름만 알면 바로 닿는 길을 둔다. 상시 보이게 두는 게 중요하다 — 단축키만 있으면 모르는
      // 사람은 영영 못 쓴다(담당자가 다 개발자는 아니다).
      ".gn-find{position:relative;margin:2px 6px 6px;}" +
      ".gn-find input{width:100%;background:#0a1120;border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:9px;" +
      "color:var(--text,#e7eaf3);font-size:12px;padding:7px 26px 7px 28px;outline:none;font-family:inherit;}" +
      ".gn-find input:focus{border-color:var(--blue,#3b82f6);}" +
      ".gn-find input::placeholder{color:var(--muted-2,#5f6785);}" +
      ".gn-find .ic{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted-2,#5f6785);pointer-events:none;}" +
      ".gn-find .clr{position:absolute;right:7px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted-2,#5f6785);cursor:pointer;display:none;padding:2px 4px;border-radius:5px;}" +
      ".gn-find .clr:hover{color:#fff;background:rgba(255,255,255,.08);}" +
      ".gn-find.has .clr{display:block;}" +
      ".gn-hitwrap{padding-top:2px;}" +
      ".gn-hit-g{font-size:10px;color:var(--muted-2,#5f6785);margin-left:auto;font-weight:700;}" +
      ".gn-none{font-size:11.5px;color:var(--muted-2,#5f6785);padding:10px 12px;}" +
      ".gn-fav-g{color:var(--amber,#f0a020);}" +
      // ☆ 별표 — 평소엔 숨어 있다가 그 줄에 마우스를 올리면 나온다(30줄에 별이 다 떠 있으면
      // 시끄럽다). 이미 넣은 것(★)은 항상 보인다 — 무엇이 즐겨찾기인지 알아야 하니까.
      // ☆는 **늘 흐리게 보인다**(2026-07-28). opacity:0으로 숨겨 뒀더니 마우스를 올려야만
      // 보여서, 처음 쓰는 사람은 즐겨찾기라는 기능이 있는 줄도 몰랐다("즐겨찾기 안 보임" 신고).
      // 있다는 건 알리되 시끄럽지 않게 — 흐리게 두고 올리면 진해진다.
      ".gn-item .gn-star{flex:0 0 auto;font-size:11px;color:var(--muted-2,#5f6785);opacity:.28;cursor:pointer;padding:0 3px;border-radius:5px;}" +
      ".gn-item:hover .gn-star{opacity:.7;}" +
      ".gn-item .gn-star:hover{opacity:1;color:var(--amber,#f0a020);background:rgba(240,160,32,.14);}" +
      ".gn-item .gn-star.on{opacity:1;color:var(--amber,#f0a020);}" +
      // 메뉴 한 줄 — 가지 이름(12px)보다 살짝 크게 둬서 "무엇을 고르는가"가 주인공이 되게 한다.
      ".gn-item{display:flex;align-items:center;gap:7px;padding:8px 11px;border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;margin-bottom:1px;white-space:nowrap;overflow:hidden;}" +
      ".gn-item:hover{color:#fff;background:rgba(255,255,255,.04);}" +
      ".gn-item.active{color:#fff;background:rgba(59,130,246,.14);box-shadow:inset 3px 0 0 var(--blue);cursor:default;}" +
      ".gn-item .gn-label{flex:1;overflow:hidden;text-overflow:ellipsis;}" +
      // 그 화면의 챗봇을 여는 버튼 — 모든 항목에서 같은 자리(우측).
      ".gn-item .gn-bot{flex:0 0 auto;font-size:12px;opacity:.7;cursor:pointer;border-radius:6px;padding:1px 5px;line-height:1.4;}" +
      ".gn-item .gn-bot:hover{opacity:1;background:rgba(59,130,246,.22);}" +
      // 업데이트 가능 배지(설정 항목).
      ".gn-item .gn-upbadge{flex:0 0 auto;background:var(--amber,#f0a020);color:#3a2a00;font-size:9px;font-weight:900;border-radius:20px;padding:1px 6px;}" +
      // 대시보드 — 다른 화면에서 돌아오는 '집' 자리다. 가장 자주 누르므로 한눈에 찾히게
      // 테두리를 준다(2026-07-27 사용자 요청). 지금 대시보드에 있으면 이미 .active가 있어
      // 테두리를 빼서, "돌아갈 곳"일 때만 눈에 띄게 한다.
      ".gn-item.gn-home{color:#cfe0ff;border:1px solid rgba(59,130,246,.42);background:rgba(59,130,246,.07);margin-bottom:5px;}" +
      ".gn-item.gn-home:hover{background:rgba(59,130,246,.16);border-color:var(--blue,#3b82f6);color:#fff;}" +
      // 팝업이 떠 있으면 대시보드는 "돌아갈 곳"이라 누를 수 있어야 한다(아래 클릭 처리).
      ".gn-item.gn-home.active{cursor:pointer;}" +
      ".gn-item.gn-home .gn-label::before{content:'🏠 ';}" +
      // 고정 세 자리에 아이콘을 맞춘다(2026-07-28 사용자 요청) — 팀 사무실만 🏢가 있고 작업 세션은
      // 맨몸이라 줄이 어긋나 보였다. 아이콘은 CSS ::before로 붙인다 — label 자체에 넣으면
      // 그 label이 탭 이름으로도 쓰여 탭줄에까지 이모지가 따라간다.
      ".gn-item.gn-sess .gn-label::before{content:'💬 ';}" +
      // ic를 준 항목(팀 사무실 등)은 인라인 변수로 아이콘을 받는다
      ".gn-label[style*='--gn-ic']::before{content:var(--gn-ic);}";
    document.head.appendChild(st);
  }

  var updateAvailable = false; // 클라이언트 새 버전 존재 여부(checkUpdateBadge가 채움)
  var findQuery = "";          // 메뉴 찾기 입력값(메뉴를 다시 그려도 유지된다)

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

  // 그룹 펼침 상태 — **기본은 접힘**(2026-07-28 사용자 지시). 자주 가는 곳은 위 고정 세 자리와
  // 즐겨찾기로 닿으므로, 나머지 30줄을 늘 펼쳐 둘 이유가 없다. 편 것만 기억한다.
  // (예전엔 "접은 것"을 기억했다 — 기본이 뒤집혔으므로 키도 바꿔 옛 값이 섞이지 않게 한다.)
  var OPEN_KEY = "gijo:menu:opened";
  function openedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function saveOpened(set) {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...set])); } catch (e) {}
  }

  // 메뉴 한 줄을 만든다 — 즐겨찾기 가지와 본 가지가 **같은 함수**를 쓴다(이름·배지·동작을
  // 두 곳에 적으면 반드시 한쪽만 고치게 된다).
  function makeItem(it, here, favs, container) {
    var el = document.createElement("div");
    el.className = "gn-item" + (it.page === here ? " active" : "") +
      (it.page === "dashboard.html" ? " gn-home" : "") + (it.page === "sessions.html" ? " gn-sess" : "");
    var lab = document.createElement("span"); lab.className = "gn-label"; lab.textContent = it.label; el.appendChild(lab);
    // 아이콘은 CSS ::before로만 붙인다 — label에 이모지를 넣으면 그 label이 탭 이름·즐겨찾기·
    // 검색 결과에 그대로 따라다닌다. 고정 세 자리가 각기 다른 방식이라 줄이 어긋나 보였다.
    if (it.ic) lab.style.setProperty("--gn-ic", "'" + it.ic + " '");

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

    if (it.page === "settings.html?s=admin" && updateAvailable) {
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

    if (it.win) {
      // 별도 창 항목 — preload가 노출한 window.gijo.<win>()을 부른다.
      // 없으면 조용히 넘기지 않고 알린다: 예전엔 아무 일도 안 나서 "눌러도 안 열린다"는
      // 증상만 남고 원인을 찾을 단서가 하나도 없었다(4.9.0 문서함).
      el.addEventListener("click", function () {
        if (window.gijo && typeof window.gijo[it.win] === "function") window.gijo[it.win]();
        else alert(it.label + "을(를) 열 수 없습니다 — 앱을 다시 시작해 보시고, 계속되면 알려주세요.");
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
    var opened = openedSet();
    var favs = favList();

    // ── 찾기 칸 — 이름만 알면 가지를 안 펴고 바로 닿는다(Ctrl/Cmd+K로 여기 포커스).
    var find = document.createElement("div");
    find.className = "gn-find";
    find.innerHTML = '<span class="ic">🔍</span><input id="gnFind" type="text" placeholder="화면 찾기  (Ctrl+K)" ' +
      'aria-label="화면 찾기" autocomplete="off" spellcheck="false"><span class="clr" title="지우기">✕</span>';
    container.appendChild(find);
    var findInput = find.querySelector("input");
    findInput.value = findQuery;
    if (findQuery) find.classList.add("has");
    // ⚠ 여기서 buildMenu(전체 재생성)를 부르면 **한글을 못 친다**(2026-07-28 사용자 신고).
    //   한글은 ㅎ→하→한처럼 조합 중인 상태로 입력칸에 머무는데, 글자마다 입력칸을 새로 만들면
    //   그 조합이 매번 끊긴다. 영문은 한 글자가 곧 완성이라 증상이 안 보였다.
    //   그래서 **입력칸은 그대로 두고 아래 결과만** 다시 그린다.
    findInput.addEventListener("input", function () {
      findQuery = findInput.value;
      find.classList.toggle("has", !!findQuery);
      renderBody(container, find);
    });
    findInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); findQuery = ""; findInput.value = ""; find.classList.remove("has"); renderBody(container, find); return; }
      if (e.key === "Enter") {   // 첫 결과를 연다 — 타이핑하다 바로 Enter가 가장 빠른 길이다
        var first = container.querySelector(".gn-hitwrap .gn-item .gn-label");
        if (first) first.click();
      }
    });
    find.querySelector(".clr").addEventListener("click", function () {
      findQuery = ""; findInput.value = ""; find.classList.remove("has");
      renderBody(container, find); findInput.focus();
    });

    renderBody(container, find);
  }

  // 찾기 칸 **아래쪽만** 다시 그린다 — 입력칸을 건드리지 않는 것이 핵심이다(한글 조합 보호).
  function renderBody(container, find) {
    while (find.nextSibling) container.removeChild(find.nextSibling);
    var here = currentKey();
    var opened = openedSet();
    var favs = favList();

    // 찾는 중에는 트리를 접고 **걸린 것만** 보여준다 — 접힌 가지 안까지 뒤진다.
    if (findQuery.trim()) {
      var q = findQuery.trim().toLowerCase();
      var wrap = document.createElement("div");
      wrap.className = "gn-kids gn-hitwrap";
      container.appendChild(wrap);
      var hits = 0;
      var add = function (it, gLabel) {
        if ((it.label || "").toLowerCase().indexOf(q) < 0) return;
        var row = makeItem(it, here, favs, container);
        if (gLabel) { var g = document.createElement("span"); g.className = "gn-hit-g"; g.textContent = gLabel; row.insertBefore(g, row.querySelector(".gn-star") || null); }
        wrap.appendChild(row);
        hits++;
      };
      TOP.forEach(function (it) { add(it, null); });
      GROUPS.forEach(function (g) { g.items.forEach(function (it) { add(it, g.label); }); });
      if (!hits) {
        var none = document.createElement("div");
        none.className = "gn-none";
        none.textContent = "'" + findQuery.trim() + "'에 맞는 화면이 없습니다.";
        wrap.appendChild(none);
      }
      return; // 찾는 동안에는 고정·즐겨찾기·가지를 그리지 않는다(결과에만 집중)
    }

    // ── 맨 위 고정 세 자리 — 가지에 넣지 않는다(접혀 있으면 매번 펴야 한다).
    var top = document.createElement("div");
    top.className = "gn-kids gn-top-fixed";
    TOP.forEach(function (it) { top.appendChild(makeItem(it, here, favs, container)); });
    container.appendChild(top);

    // ⭐ 즐겨찾기 가지 — **비어 있어도 보여준다**(2026-07-28 사용자 신고: "즐겨찾기 안 보임").
    //   전에는 별표한 게 하나도 없으면 가지를 통째로 안 그렸다. 그런데 별표는 마우스를 올려야
    //   보이는 흐린 ☆라, 처음 쓰는 사람은 **기능이 있다는 것도, 넣는 방법도 알 수 없었다.**
    //   빈 자리에 "☆를 눌러 꽂으세요" 한 줄을 두는 편이 낫다 — 한 줄 자리값보다 발견이 중요하다.
    {
      var fh = document.createElement("div");
      fh.className = "gn-g open gn-fav-g";
      fh.setAttribute("role", "button");
      fh.title = "즐겨찾기 접기/펼치기 — 항목 위 ☆를 눌러 넣고 뺍니다";
      var fcar = document.createElement("span"); fcar.className = "car"; fcar.textContent = "▶";
      var fnm = document.createElement("span"); fnm.textContent = "⭐ 즐겨찾기";
      var fcnt = document.createElement("span"); fcnt.className = "cnt"; fcnt.textContent = favs.length;
      fh.appendChild(fcar); fh.appendChild(fnm); fh.appendChild(fcnt);
      container.appendChild(fh);
      // 즐겨찾기는 **기본 펼침** — 내가 직접 꽂아 둔 것들이라 접어 두면 꽂은 뜻이 없어진다.
      // (다른 가지와 반대로, 여기만 "접은 것"을 기억한다.)
      var favClosed = opened.has("__favClosed");
      var fkids = document.createElement("div");
      fkids.className = "gn-kids" + (favClosed ? " closed" : "");
      if (favClosed) fh.classList.remove("open");
      container.appendChild(fkids);
      fh.addEventListener("click", function () {
        var nowOpen = fkids.classList.toggle("closed") === false;
        fh.classList.toggle("open", nowOpen);
        var s = openedSet();
        if (nowOpen) s.delete("__favClosed"); else s.add("__favClosed");
        saveOpened(s);
      });
      // 메뉴 정의에서 그 화면을 찾아 같은 모양으로 그린다(이름·배지를 두 곳에 적지 않는다).
      favs.forEach(function (page) {
        var found = null;
        GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (it.page === page) found = it; }); });
        if (found) fkids.appendChild(makeItem(found, here, favs, container));
      });
      // 비었을 때 안내 문구는 두지 않는다(2026-07-29 사용자 결정).
      // ☆를 늘 보이게 바꾼 뒤로는 문구 없이도 알 수 있고, 좁은 메뉴 폭에서 두 줄로 접혀
      // 어설퍼 보였다. 가지 이름(⭐ 즐겨찾기)과 늘 보이는 ☆만으로 충분하다.
    }

    GROUPS.forEach(function (g) {
      // 기본은 접힘 — 편 가지만 기억한다. (보고 있는 화면을 따라 자동으로 펴지 않는다:
      // 그러면 화면을 열 때마다 가지가 벌어져 "기본 접힘"이 무의미해진다. 지금 무엇을 보는지는
      // 위쪽 탭줄이 말해 준다.)
      var open = opened.has(g.id);

      var gh = document.createElement("div");
      gh.className = "gn-g" + (open ? " open" : "");
      gh.setAttribute("role", "button");
      gh.title = (open ? "접기" : "펼치기") + " — " + g.label;
      var car = document.createElement("span"); car.className = "car"; car.textContent = "▶";
      var nm = document.createElement("span"); nm.textContent = g.label;
      var cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = g.items.length;
      gh.appendChild(car); gh.appendChild(nm); gh.appendChild(cnt);
      container.appendChild(gh);

      var kids = document.createElement("div");
      kids.className = "gn-kids" + (open ? "" : " closed");
      container.appendChild(kids);

      gh.addEventListener("click", function () {
        var nowOpen = kids.classList.toggle("closed") === false;
        gh.classList.toggle("open", nowOpen);
        gh.title = (nowOpen ? "접기" : "펼치기") + " — " + g.label;
        var s = openedSet();
        if (nowOpen) s.add(g.id); else s.delete(g.id);
        saveOpened(s);
      });

      g.items.forEach(function (it) { kids.appendChild(makeItem(it, here, favs, container)); });
    });
  }
  // 대시보드가 '전체메뉴' 모드에서 같은 메뉴를 렌더하도록 공개(단일 소스).
  window.gijoRenderMenu = buildMenu;
  // 메뉴 **자료**를 그대로 내준다 — 지휘소(대화창)가 자기 방식으로 그릴 수 있게.
  // ⚠ 목록을 저쪽에 베껴 적으면 반드시 어긋난다(오늘만 "같은 것이 여러 군데"를 세 번 겪었다).
  //   그리는 방법은 각자 달라도 **자료는 여기 하나**다.
  window.gijoMenuData = function () {
    return {
      top: TOP.map(function (t) { return { page: t.page, win: t.win, label: t.label, ic: t.ic }; }),
      groups: GROUPS.map(function (g) {
        return { id: g.id, ic: g.ic, label: g.label,
                 items: g.items.map(function (i) { return { page: i.page, label: i.label }; }) };
      }),
    };
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
  function ensureLeftEdge() {
    var edge = document.getElementById("gnLeftEdge");
    if (edge) return edge;
    edge = document.createElement("div");
    edge.id = "gnLeftEdge";
    edge.className = "gn-edge";
    edge.addEventListener("click", function () {
      window.gijoLeftCollapse(!document.body.classList.contains("gn-left-collapsed"));
    });
    document.body.appendChild(edge);
    return edge;
  }
  // 탭 위치·라벨 갱신 — 열림: 사이드바 오른쪽 경계에 반쯤(12px) 걸침 / 접힘: 화면 왼쪽 끝.
  function updateLeftEdge() {
    var edge = ensureLeftEdge();
    var collapsed = document.body.classList.contains("gn-left-collapsed");
    if (collapsed) {
      edge.style.left = "0px";
      edge.textContent = "▶";
      edge.title = "왼쪽 메뉴 열기";
    } else {
      var panel = document.getElementById("gijoNav") || document.querySelector(".explorer");
      if (!panel) { edge.style.display = "none"; return; }
      edge.style.display = "";
      edge.style.left = Math.max(0, Math.round(panel.getBoundingClientRect().right) - 9) + "px";
      edge.textContent = "◀";
      edge.title = "왼쪽 메뉴 접기";
    }
  }
  window.gijoLeftCollapse = function (on) {
    injectCss();
    document.body.classList.toggle("gn-left-collapsed", !!on);
    try { localStorage.setItem(LEFT_KEY, on ? "1" : "0"); } catch (e) {}
    updateLeftEdge();
  };
  function setupLeftCollapse() {
    // 왼쪽 패널이 있는 화면에서만(login 제외). 저장 상태 복원 + 탭 초기 배치.
    if (!document.getElementById("gijoNav") && !document.querySelector(".explorer")) return;
    injectCss();
    var saved = null; try { saved = localStorage.getItem(LEFT_KEY); } catch (e) {}
    if (saved === "1") document.body.classList.add("gn-left-collapsed");
    updateLeftEdge();
    window.addEventListener("resize", updateLeftEdge); // 창 크기·배율 변경 시 경계 재계산
  }

  function render() {
    var root = document.getElementById("gijoNav");
    if (!root) return;
    injectCss();
    root.innerHTML = "";
    // 상단 세그먼트 [🏠 대시보드 | ☰ 전체메뉴]는 없앴다(2026-07-27).
    // 두 칸짜리 토글처럼 보였지만 실제로는 토글이 아니었다: '전체메뉴'는 언제나 켜진 채
    // 아무 동작도 하지 않았고(지금 보고 있는 게 이미 전체메뉴다), '대시보드'는 바로 아래
    // 메뉴 첫 항목과 같은 곳으로 갔다. 누르면 뭐가 달라지는지 알 수 없는 버튼은 조작만 늘린다.
    // 중앙 메뉴(스크롤)
    var mid = document.createElement("div"); mid.className = "gn-mid";
    buildMenu(mid); root.appendChild(mid);
    // 하단 사용자 영역은 titlebar.js가 #gijoNav 마지막 자식으로 마운트(관찰자).
    // 접기/열기는 가장자리 세로 탭 하나로(헤더 버튼 없음 — 2026-07-25 통일). 위치 재계산.
    updateLeftEdge();
  }

  // 공용 디자인 시스템(gijo-ui.css)을 모든 페이지에 주입한다 — .g-* 컴포넌트 사용 가능 + body.g-ui로
  // 안전한 전역 베이스라인(스크롤바·포커스링·폰트 스무딩)만 통일(레이아웃은 안 건드림).
  function loadDesignSystem() {
    if (!document.getElementById("gijoUiCss")) {
      var l = document.createElement("link");
      l.id = "gijoUiCss"; l.rel = "stylesheet"; l.href = "gijo-ui.css";
      document.head.appendChild(l);
    }
    if (document.body) document.body.classList.add("g-ui");
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
  window.gijoOpenScreen = function (page, label) {
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
      ".scroll-list{max-height:calc(100vh - 260px);min-height:260px;overflow-y:auto;}" +
      ".scroll-list thead th{position:sticky;top:0;background:var(--panel,#121a2e);z-index:1;}" +
      ".footer{display:none !important;}" +
      "*::-webkit-scrollbar{width:8px;height:8px;}*::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px;}*::-webkit-scrollbar-track{background:transparent;}" +
      ".header{display:none !important;}#gijoNav{display:none !important;}" +
      ".app{grid-template-columns:1fr !important;display:block !important;}" +
      // 화면 안 챗봇 위젯은 팝업에서 숨긴다(2026-07-27). 지시와 설명은 대시보드 대화 한 곳에서만
      // 하기로 했는데, 이 위젯이 화면 맨 위를 차지해 정작 봐야 할 요약 카드를 아래로 밀어냈다.
      // ⚠ 분리창(별도 창)에서는 대시보드가 없으므로 지우지 않는다 — embed(팝업 안)에서만.
      "#gijoChatWidget{display:none !important;}" +
      ".main{padding-top:16px !important;}";
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

  // 분리창 — 왼쪽 메뉴를 지우고 내용이 창 폭을 다 쓰게 한다. 가장자리 토글도 두지 않는다:
  // 이 창에서 메뉴를 열 일이 없고(이동은 대시보드에서), 토글만 남으면 그게 또 하나의 조작이 된다.
  function applyPopout() {
    var st = document.createElement("style");
    st.textContent =
      "#gijoNav{display:none !important;}" +
      ".app{grid-template-columns:minmax(0,1fr) !important;display:block !important;}" +
      ".explorer{display:none !important;}" +
      ".main{padding-left:18px !important;padding-right:18px !important;}" +
      // 가로/세로 전환 — 예전엔 허브가 그렸는데 허브를 없애서(4.0.0) 여기로 옮겼다.
      // 세로(피벗) 모니터를 쓰는 관제실이 있어 남겨 둔다.
      ".gijo-orient{position:fixed;top:10px;right:14px;z-index:950;background:var(--panel-2,#0e1526);color:var(--muted,#8b93ab);" +
      "border:1px solid var(--border,#1e2a44);border-radius:8px;font-size:11px;font-weight:800;padding:5px 10px;cursor:pointer;}" +
      ".gijo-orient:hover{color:#fff;border-color:var(--blue,#3b82f6);}";
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
  }

  // 화면 크기 단축키 — 데스크톱 앱 관례대로 Cmd/Ctrl + '＋·－·0'. 배율 계산·저장은 메인 프로세스가
  // 하므로 여기서는 방향만 넘긴다. 입력 중(input/textarea)에도 동작해야 해서 대상은 가리지 않는다.
  function bindZoomKeys() {
    if (window.__gijoZoomKeys) return;
    window.__gijoZoomKeys = true;
    window.addEventListener("keydown", function (e) {
      // Ctrl/Cmd+K — 화면 찾기로 바로 커서를 옮긴다(익숙한 관례). 칸은 늘 보이므로
      // 단축키를 몰라도 쓸 수 있고, 아는 사람은 손을 마우스로 안 옮겨도 된다.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        var box = document.getElementById("gnFind");
        if (box) { e.preventDefault(); box.focus(); box.select(); return; }
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || !window.gijo) return;
      var k = e.key;
      if (k === "+" || k === "=" || k === "Add") { e.preventDefault(); window.gijo.stepUiZoom(1); }
      else if (k === "-" || k === "_" || k === "Subtract") { e.preventDefault(); window.gijo.stepUiZoom(-1); }
      else if (k === "0") { e.preventDefault(); window.gijo.setUiZoom(1); }
    });
  }

  function boot() {
    bindZoomKeys();
    loadDialog(); // 어느 겹에서든 먼저 — 네이티브 모달이 뜨면 그 순간 모두 멈춘다
    loadFold(); // embed에서도 실어야 한다 — 팝업 안이 접기가 가장 필요한 곳이다
    if (IS_EMBED) { applyEmbed(); return; }
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
    function 배지새로고침() { refreshSessionBadge(); refreshWorkBadge(); }
    배지새로고침();
    setTimeout(배지새로고침, 3000);
    setInterval(배지새로고침, 60000);

    loadLongNotice();
    checkUpdateBadge();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
