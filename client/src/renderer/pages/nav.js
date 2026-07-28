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
  var GROUPS = [
    { id: "monitor", ic: "🖥", label: "관제", items: [
      { page: "dashboard.html", label: "대시보드" },
      // '내 업무 바로가기'는 즐겨찾기로 대신한다(2026-07-28 사용자 결정) — 원래 대시보드 위
      // 팝업으로 열리던 기능인데 팝업을 없앴고, "자주 가는 화면을 빨리"는 별표가 더 곧다.
      // 작업 세션은 탐색기·목록·대화 3열이라 좁은 자리에 넣으면 셋 다 못 쓴다(2026-07-27) — 넓게 본다.
      { page: "sessions.html", label: "작업 세션" },
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
      { page: "products.html", label: "보안제품 등록부" },
      { page: "opsguide.html", label: "제품 유지보수" },
      { page: "hardening.html", label: "원격 정기점검" },
      { page: "terminal.html", label: "터미널 (CLI)" },
    ]},
    { id: "ai", ic: "🤖", label: "AI", items: [
      { page: "agent.html", label: "에이전트 AI" },
      { office: true, label: "🏢 팀 사무실 (창)" },
      { page: "memory.html", label: "기억·학습 (RAG)" },
      { page: "handover.html", label: "인수인계" },
      { page: "ontology.html", label: "온톨로지" },
      { page: "learnloop.html", label: "학습 루프" },
      { page: "merge.html", label: "LLM 합성" },
      { page: "redteam.html", label: "레드팀·가드레일" },
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
    "reference.html": "settings.html?s=my",     // 기능 안내 → 챗봇이 대신(2026-07-25)
    "billing.html": "audit.html",               // 사용량·요금 → 기록 보기
    "mcp.html": "settings.html?s=link",         // 2026-07-28 설정 5구역으로 흡수
    "update.html": "settings.html?s=admin",
    "logs.html": "audit.html",
    "llmguide.html": "settings.html?s=ai",      // 추천 모델 목록 → 설정 서버·AI
    "docenrich.html": "memory.html",            // 문서 보강 → 기억·학습에 병합
    // 허브는 4.0.0에서 없앴다 — 옛 허브 주소로 들어오면 셸로 보낸다.
    "hub.html": "app.html",
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
      ".gn-g{display:flex;align-items:center;gap:6px;font-size:9.5px;font-weight:800;color:var(--muted-2);" +
      "letter-spacing:1.2px;margin:12px 6px 5px;padding:4px 4px;border-radius:6px;cursor:pointer;user-select:none;}" +
      ".gn-g:hover{color:var(--blue-light,#7ab0ff);background:rgba(255,255,255,.03);}" +
      ".gn-g .car{font-size:8px;width:9px;flex:0 0 auto;transition:transform .13s;}" +
      ".gn-g.open .car{transform:rotate(90deg);}" +
      ".gn-g .cnt{margin-left:auto;font-size:9px;font-weight:700;color:var(--muted-2);opacity:.75;}" +
      ".gn-g.open .cnt{opacity:0;}" + // 펼치면 개수는 군더더기 — 눈으로 보인다
      ".gn-g:first-child{margin-top:2px;}" +
      ".gn-kids{display:block;}" +
      ".gn-kids.closed{display:none;}" +
      ".gn-kids .gn-item{padding-left:20px;}" + // 한 칸 들여써서 가지에 달린 것임을 보인다
      ".gn-fav-g{color:var(--amber,#f0a020);}" +
      // ☆ 별표 — 평소엔 숨어 있다가 그 줄에 마우스를 올리면 나온다(30줄에 별이 다 떠 있으면
      // 시끄럽다). 이미 넣은 것(★)은 항상 보인다 — 무엇이 즐겨찾기인지 알아야 하니까.
      ".gn-item .gn-star{flex:0 0 auto;font-size:11px;color:var(--muted-2,#5f6785);opacity:0;cursor:pointer;padding:0 3px;border-radius:5px;}" +
      ".gn-item:hover .gn-star{opacity:.65;}" +
      ".gn-item .gn-star:hover{opacity:1;color:var(--amber,#f0a020);background:rgba(240,160,32,.14);}" +
      ".gn-item .gn-star.on{opacity:1;color:var(--amber,#f0a020);}"
      ".gn-item{display:flex;align-items:center;gap:7px;padding:8px 11px;border-radius:8px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;margin-bottom:1px;white-space:nowrap;overflow:hidden;}" +
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
      ".gn-item.gn-home .gn-label::before{content:'🏠 ';}";
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

  // 그룹 접힘 상태 — 담당자가 고른 대로 기억한다. 저장이 없으면 전부 펼침(처음엔 다 보여야 찾는다).
  var FOLD_KEY = "gijo:menu:folded";
  function foldedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  function saveFolded(set) {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch (e) {}
  }

  // 메뉴 한 줄을 만든다 — 즐겨찾기 가지와 본 가지가 **같은 함수**를 쓴다(이름·배지·동작을
  // 두 곳에 적으면 반드시 한쪽만 고치게 된다).
  function makeItem(it, here, favs, container) {
    var el = document.createElement("div");
    el.className = "gn-item" + (it.page === here ? " active" : "") + (it.page === "dashboard.html" ? " gn-home" : "");
    var lab = document.createElement("span"); lab.className = "gn-label"; lab.textContent = it.label; el.appendChild(lab);

    // ☆ 별표 — 별도 창으로 여는 항목(팀 사무실)은 주소가 없어 즐겨찾기에 넣을 수 없다.
    if (it.page) {
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
      sBadge.title = "진행중인 작업 세션";
      el.appendChild(sBadge);
    }

    if (it.office) {
      el.addEventListener("click", function () { if (window.gijo && window.gijo.openTeamOffice) window.gijo.openTeamOffice(); });
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
    var folded = foldedSet();
    var favs = favList();

    // ⭐ 즐겨찾기 가지 — 별표한 화면이 있을 때만 맨 위에 나온다(없으면 자리를 차지하지 않는다).
    if (favs.length) {
      var fh = document.createElement("div");
      fh.className = "gn-g open gn-fav-g";
      fh.setAttribute("role", "button");
      fh.title = "즐겨찾기 접기/펼치기 — 항목 위 ☆를 눌러 넣고 뺍니다";
      var fcar = document.createElement("span"); fcar.className = "car"; fcar.textContent = "▶";
      var fnm = document.createElement("span"); fnm.textContent = "⭐ 즐겨찾기";
      var fcnt = document.createElement("span"); fcnt.className = "cnt"; fcnt.textContent = favs.length;
      fh.appendChild(fcar); fh.appendChild(fnm); fh.appendChild(fcnt);
      container.appendChild(fh);
      var fkids = document.createElement("div");
      fkids.className = "gn-kids" + (folded.has("__fav") ? " closed" : "");
      if (folded.has("__fav")) fh.classList.remove("open");
      container.appendChild(fkids);
      fh.addEventListener("click", function () {
        var nowOpen = fkids.classList.toggle("closed") === false;
        fh.classList.toggle("open", nowOpen);
        var s = foldedSet();
        if (nowOpen) s.delete("__fav"); else s.add("__fav");
        saveFolded(s);
      });
      // 메뉴 정의에서 그 화면을 찾아 같은 모양으로 그린다(이름·배지를 두 곳에 적지 않는다).
      favs.forEach(function (page) {
        var found = null;
        GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (it.page === page) found = it; }); });
        if (found) fkids.appendChild(makeItem(found, here, favs, container));
      });
    }

    GROUPS.forEach(function (g) {
      // 지금 보고 있는 화면이 든 가지는 접혀 있어도 펼쳐 준다 — 어디에 있는지 보여야 한다.
      var hasHere = g.items.some(function (it) { return it.page === here; });
      var open = hasHere || !folded.has(g.id);

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
        var s = foldedSet();
        if (nowOpen) s.delete(g.id); else s.add(g.id);
        saveFolded(s);
      });

      g.items.forEach(function (it) { kids.appendChild(makeItem(it, here, favs, container)); });
    });
  }
  // 대시보드가 '전체메뉴' 모드에서 같은 메뉴를 렌더하도록 공개(단일 소스).
  window.gijoRenderMenu = buildMenu;
  // 화면 주소 → 메뉴에 적힌 이름. 셸이 탭 이름을 붙일 때 쓴다(이름을 두 곳에 적지 않으려고).
  window.gijoMenuLabel = function (page) {
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

  function loadOnboarding() {
    if (document.getElementById("gijoObScript")) return;
    if (document.querySelector('script[src*="onboarding.js"]')) return; // 대시보드는 자체 로드 — 중복 방지
    var s = document.createElement("script");
    s.id = "gijoObScript";
    s.src = "onboarding.js";
    document.body.appendChild(s);
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

  function loadCommandPanel() {
    if (document.getElementById("gijoCmdScript")) return;
    var s = document.createElement("script");
    s.id = "gijoCmdScript";
    s.src = "commandpanel.js";
    document.body.appendChild(s);
  }

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
        b.setAttribute("aria-label", "진행중인 작업 세션 " + n + "건");
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
      if (!(e.metaKey || e.ctrlKey) || e.altKey || !window.gijo) return;
      var k = e.key;
      if (k === "+" || k === "=" || k === "Add") { e.preventDefault(); window.gijo.stepUiZoom(1); }
      else if (k === "-" || k === "_" || k === "Subtract") { e.preventDefault(); window.gijo.stepUiZoom(-1); }
      else if (k === "0") { e.preventDefault(); window.gijo.setUiZoom(1); }
    });
  }

  function boot() {
    bindZoomKeys();
    loadFold(); // embed에서도 실어야 한다 — 팝업 안이 접기가 가장 필요한 곳이다
    if (IS_EMBED) { applyEmbed(); return; }
    // 탭으로 흡수된 페이지에 직접 들어오면(대시보드 바로가기·챗봇 링크 등) 허브의 그 탭으로 보낸다.
    // ⚠ 설정처럼 한 파일이 여러 탭인 화면은 **쿼리까지 봐야** 한다(2026-07-28 실측):
    //    쿼리를 무시하면 ?s=link로 들어와도 서버·AI 탭으로 끌려가 늘 같은 화면만 보인다.
    var target = TAB_REDIRECT[currentPage() + (location.search || "")] || TAB_REDIRECT[currentPage()];
    if (target && window.gijo && window.gijo.navigateTo) { window.gijo.navigateTo(target); return; }
    loadDesignSystem();
    if (IS_POPOUT) { applyPopout(); loadLongNotice(); return; } // 분리창은 메뉴 없이 내용만
    setupLeftCollapse(); // 왼쪽 접기 인프라(대시보드 포함) — 저장 상태 복원 + 가장자리 탭
    render();
    loadOnboarding();
    loadCommandPanel();
    refreshSessionBadge();

    loadLongNotice();
    checkUpdateBadge();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
