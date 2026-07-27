// nav.js — GIJO AS 네비게이션 (시안 B: 아이콘 레일 + 서브패널).
// 모든 페이지의 <div id="gijoNav"> 안에 [얇은 아이콘 레일 | 서브패널]을 그린다. 레일에서 대분류를
// 고르면 그 분류의 기능이 서브패널에 나오고, 항목을 클릭하면 그 페이지로 이동한다(기존 멀티페이지
// 구조 유지 — 페이지별 대량 수정 없이 좌측 IA만 시안 B로 교체하는 저위험 방식).
// 스타일은 페이지 :root 토큰(--panel-2·--border·--blue…)을 그대로 쓰므로 다크 테마와 일관된다.

(function () {
  // ── 메뉴 C안 통합 (2026-07-23): 32항목 → 11항목·3그룹 + 설정. 겹치는 화면은 허브 탭(hub.html)으로
  // 병합 — 기존 페이지는 그대로 두고 iframe(embed=1)으로 품는다. 직접 URL 접근은 허브로 리다이렉트.
  // 허브 정의는 hub.html과 공유(window.gijoHubs).
  var HUBS = {
    analysis: { ic: "📊", label: "보안 분석", tabs: [
      { page: "analysis.html", label: "통합 관제" },
    ]},
    threat: { ic: "🎯", label: "위협 인텔리전스", tabs: [
      { page: "threat.html", label: "위협 인텔" },
    ]},
    report: { ic: "📄", label: "리포트", tabs: [
      { page: "report.html", label: "리포트" },
      { page: "kpi.html", label: "보안 KPI" }, // 보고용 스냅샷·추세 — 리포트 곁이 자연스러움(2026-07-25 이동)
      { page: "compliance.html", label: "컴플라이언스" },
    ]},
    assets: { ic: "🛡", label: "자산 허브", tabs: [
      { page: "assethub.html", label: "통합 뷰" },
      { page: "inventory.html", label: "자산 목록" },
      { page: "sbom.html", label: "AI-BOM" },
      { page: "vulnscan.html", label: "취약점" },
    ]},
    products: { ic: "🧰", label: "보안제품", tabs: [
      { page: "products.html", label: "등록부" },
      { page: "opsguide.html", label: "유지보수" },
    ]},
    inspect: { ic: "🛰", label: "점검 콘솔", tabs: [
      { page: "hardening.html", label: "원격 정기점검" },
      { page: "terminal.html", label: "터미널 (CLI)" },
    ]},
    aiteam: { ic: "🤖", label: "AI 팀", tabs: [
      { page: "agent.html", label: "에이전트 AI" },
      { office: true, label: "🏢 팀 사무실 (창)" },
    ]},
    aiknowledge: { ic: "🧠", label: "AI 지식·모델", tabs: [
      { page: "memory.html", label: "기억·학습 (RAG)" },
      { page: "handover.html", label: "인수인계" },
      { page: "ontology.html", label: "온톨로지" },
      { page: "learnloop.html", label: "학습 루프" },
      { page: "merge.html", label: "LLM 합성" },
      { page: "llmguide.html", label: "LLM 가이드" },
    ]},
    settings: { ic: "⚙", label: "설정", tabs: [
      { page: "settings.html", label: "설정" },
      { page: "mcp.html", label: "🔌 MCP 연동" }, // 연동·정책 관리 — 위협 그룹에서 이동(2026-07-25)
      { page: "update.html", label: "업데이트" },
      { page: "logs.html", label: "로그" },
      { page: "audit.html", label: "작업 기록 (감사)" },
    ]},
  };
  window.gijoHubs = HUBS; // hub.html이 같은 정의를 사용

  var GROUPS = [
    { id: "monitor", ic: "🖥", label: "관제", items: [
      { page: "dashboard.html", label: "대시보드" },
      { page: "dashboard.html?quick=1", label: "내 업무 바로가기" }, // 대시보드 위 팝업으로 열림(챗 중심 개편 2026-07-26)
      // 작업 세션 — 오른쪽 가장자리의 세로 글씨 탭에서 옮겨 왔다(2026-07-27).
      // 세로로 쓴 글씨는 읽는 데만 시간이 걸리고, 어차피 sessions.html이라는 화면이 이미 있었다.
      { page: "sessions.html", label: "작업 세션", bot: true, popup: true },
      // popup: 대시보드 팝업 셸(혼합 방식, 2026-07-26 결정)에서 팝업으로 열리는 화면.
      // 1차 파일럿 3종 검증 후 챗봇 메뉴 9종 전체 확장(같은 날 사용자 지시 "나머지도 다").
      // 대시보드가 아닌 화면(gijoShell 없음)에서는 지금처럼 전체 화면으로 이동한다.
      { page: "hub.html?g=analysis", label: "보안 분석", bot: true, popup: true },
      { page: "hub.html?g=threat", label: "위협 인텔리전스", bot: true, popup: true },
      { page: "hub.html?g=report", label: "리포트", bot: true, popup: true },
    ]},
    { id: "assets", ic: "🛡", label: "자산·조치", items: [
      { page: "hub.html?g=assets", label: "자산 허브", bot: true, popup: true },
      { page: "approvals.html", label: "조치·승인", bot: true, popup: true },
      { page: "hub.html?g=products", label: "보안제품", bot: true, popup: true },
      { page: "hub.html?g=inspect", label: "점검 콘솔", bot: true, popup: true },
    ]},
    { id: "ai", ic: "🤖", label: "AI", items: [
      { page: "hub.html?g=aiteam", label: "AI 팀" },
      // 팀 사무실 — 예전엔 오른쪽 가장자리 세로 탭이었고, 그걸 없앤 뒤로는 'AI 팀' 허브의
      // 두 번째 탭에만 있어 두 번 눌러야 나왔다("안 보인다" 지적, 2026-07-27).
      // 별도 창으로 바로 여는 항목이라 여기 직접 둔다 — 한 번 클릭.
      { office: true, label: "🏢 팀 사무실 (창)" },
      { page: "hub.html?g=aiknowledge", label: "AI 지식·모델", bot: true, popup: true },
      { page: "redteam.html", label: "레드팀·가드레일", bot: true, popup: true },
    ]},
    { id: "settings", ic: "⚙", label: "설정", bottom: true, items: [
      { page: "hub.html?g=settings", label: "설정" },
    ]},
  ];

  // 탭으로 흡수된 페이지 → 허브 딥링크. 대시보드 바로가기·챗봇 navigateTo 등 기존 링크가
  // 그대로 허브 탭으로 이어진다(embed 프레임 안에서는 리다이렉트하지 않는다).
  var TAB_REDIRECT = {};
  Object.keys(HUBS).forEach(function (g) {
    HUBS[g].tabs.forEach(function (t) { if (t.page) TAB_REDIRECT[t.page] = "hub.html?g=" + g + "&t=" + t.page; });
  });
  // 메뉴 정리(2026-07-25, 29→26)로 없어진 화면의 옛 주소 — 기존 링크·바로가기가 깨지지 않게
  // 흡수처로 보낸다. 기능 안내→챗봇이 대신(설정으로), 사용량·요금→설정 클라우드 구역,
  // 문서 보강→기억·학습에 병합.
  TAB_REDIRECT["reference.html"] = "hub.html?g=settings&t=settings.html";
  TAB_REDIRECT["billing.html"] = "hub.html?g=settings&t=settings.html";
  TAB_REDIRECT["docenrich.html"] = "hub.html?g=aiknowledge&t=memory.html";

  function currentPage() {
    return decodeURIComponent((location.pathname || "").split("/").pop() || "");
  }
  // 허브 페이지는 파일명이 전부 hub.html이라 g 파라미터까지 붙여 항목과 매칭한다.
  function currentKey() {
    var file = currentPage();
    if (file !== "hub.html") return file;
    var m = /[?&]g=([a-z]+)/.exec(location.search || "");
    return m ? "hub.html?g=" + m[1] : file;
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
    st.textContent =
      // 통일 사이드바(2026-07-25): 아이콘 레일 폐기 → 단일 232px 3단 컬럼(상단 세그먼트 고정 · 중앙
      // 메뉴 스크롤 · 하단 사용자 영역 titlebar.js). 전 화면 100vh 고정으로 통일.
      ".app{grid-template-columns:232px minmax(0,1fr) 46px !important;height:100vh;}"
      // 창 고정(2026-07-26 사용자 결정): 페이지 스크롤 없음 — 본문 열만 내부 스크롤, 오른쪽 46px는
      // 엣지 탭 거터(스크롤바와 절대 안 겹침). 임베드 프레임은 아래 applyEmbed에서 원복.
      + "html,body{height:100%;overflow:hidden;}"
      + ".app > *:nth-child(2){overflow-y:auto;height:100vh;min-height:0;}"
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
      // 그룹 헤더(대문자 스타일 소제목) + 항목(텍스트 중심, 아이콘 최소).
      ".gn-g{font-size:9.5px;font-weight:800;color:var(--muted-2);letter-spacing:1.2px;margin:12px 10px 5px;}" +
      ".gn-g:first-child{margin-top:2px;}" +
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

  // 2단(그룹+항목) 메뉴를 container에 렌더한다 — nav 사이드바와 대시보드 '전체메뉴' 모드가 공유하는
  // 단일 소스(복사본 폐기, 2026-07-25). 3단계 탭은 제거(허브 화면 상단 탭이 그 역할).
  function buildMenu(container) {
    injectCss(); // 대시보드('전체메뉴' 모드)에서 render()를 안 거쳐도 gn-* 스타일이 있게.
    container.innerHTML = "";
    var here = currentKey();
    GROUPS.forEach(function (g) {
      var gh = document.createElement("div"); gh.className = "gn-g"; gh.textContent = g.label; container.appendChild(gh);
      g.items.forEach(function (it) {
        var el = document.createElement("div");
        el.className = "gn-item" + (it.page === here ? " active" : "") + (it.page === "dashboard.html" ? " gn-home" : "");
        var lab = document.createElement("span"); lab.className = "gn-label"; lab.textContent = it.label; el.appendChild(lab);
        if (it.bot) {
          var botMark = document.createElement("span");
          botMark.className = "gn-bot";
          // 팝업으로 열리는 메뉴는 팝업 그림(⧉)으로 — 챗봇(🤖)이 아니라 "대시보드 위 팝업"임을 표시
          // (2026-07-26 사용자 결정. 팝업 미지원 메뉴는 기존 챗봇 열기 그대로.)
          botMark.textContent = it.popup ? "⧉" : "🤖";
          botMark.title = it.popup
            ? it.label + " — 별도 창으로 열기. 가로/세로 배치는 그 창 안에서 바꿉니다"
            : it.label + " 화면의 챗봇 열기 — 그 화면 데이터로 바로 답합니다";
          botMark.addEventListener("click", function (ev) {
            ev.stopPropagation();
            // ⧉ = 별도 창으로 열기(2026-07-26 사용자 결정) — 어느 화면에서든 동작.
            // 메뉴 이름 클릭은 대시보드에선 팝업, 다른 화면에선 이동(기존 그대로).
            if (it.popup && window.gijo && window.gijo.openShellPopout) {
              window.gijo.openShellPopout(it.page, it.label);
              return;
            }
            if (it.page === here && openChatHere()) return;
            try { localStorage.setItem("gijo:openChatOnLoad", String(Date.now())); } catch (e) {}
            if (it.page !== here) go(it.page);
          });
          el.appendChild(botMark);
        }
        if (it.page === "hub.html?g=settings" && updateAvailable) {
          var upBadge = document.createElement("span"); upBadge.className = "gn-upbadge"; upBadge.textContent = "1"; upBadge.title = "새 버전 있음"; el.appendChild(upBadge);
        }
        // 진행중인 작업 세션 개수 — 예전 세로 탭에 붙어 있던 정보다. 탭을 없애면서 같이
        // 사라졌는데, "몇 건 돌고 있나"는 눌러 보지 않아도 알아야 하는 값이라 되살린다.
        if (it.page === "sessions.html") {
          var sBadge = document.createElement("span");
          sBadge.className = "gn-upbadge gn-sessbadge";
          sBadge.style.display = "none";
          sBadge.title = "진행중인 작업 세션";
          el.appendChild(sBadge);
        }
        if (it.office) {
          el.addEventListener("click", function () { if (window.gijo && window.gijo.openTeamOffice) window.gijo.openTeamOffice(); });
        } else if (it.page === "dashboard.html" && it.page === here) {
          // 팝업 셸에서는 화면을 열어도 주소가 dashboard.html 그대로다. 그래서 '대시보드'가
          // 늘 현재 페이지로 잡혀 눌러도 아무 일이 없었다 — 정작 팝업을 덮어쓴 상태에서
          // 돌아가려고 누르는 자리인데(2026-07-27 사용자 지적). 팝업을 접어 준다.
          el.addEventListener("click", function () {
            if (window.gijoShell && window.gijoShell.hide) window.gijoShell.hide();
          });
        } else if (it.page !== here) {
          el.addEventListener("click", function () {
            // 팝업 셸(대시보드)에서는 팝업으로 — 이동하지 않으니 명령창·대화·진행 작업이 유지된다.
            if (it.popup && window.gijoShell) { window.gijoShell.open(it.page, it.label); return; }
            // "내 업무 바로가기" — 대시보드에 있으면 리로드 없이 그 자리에서 연다(대화 보호).
            // 셸 팝업이 떠 있으면 먼저 접는다(z가 낮아 바로가기가 뒤에 가려진다).
            if (it.page.indexOf("dashboard.html?quick") === 0 && window.gijoOpenQuick) {
              if (window.gijoShell && window.gijoShell.hide) window.gijoShell.hide();
              window.gijoOpenQuick();
              return;
            }
            go(it.page);
          });
        }
        container.appendChild(el);
      });
    });
  }
  // 대시보드가 '전체메뉴' 모드에서 같은 메뉴를 렌더하도록 공개(단일 소스).
  window.gijoRenderMenu = buildMenu;

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

  // embed 모드 — 허브 탭(hub.html)의 iframe으로 품길 때(?embed=1). 사이드바·헤더·드로어를 숨기고
  // 본문만 보인다(허브가 바깥에서 네비·헤더를 제공). 챗봇 위젯은 탭별 화면 맥락이 정확하도록 유지.
  var IS_EMBED = /(^|[?&])embed=1(&|$)/.test(location.search);
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
      ".main{padding-left:18px !important;padding-right:18px !important;}";
    document.head.appendChild(st);
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
    var target = TAB_REDIRECT[currentPage()];
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
