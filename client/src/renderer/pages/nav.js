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
      { page: "kpi.html", label: "보안 KPI" },
    ]},
    threat: { ic: "🎯", label: "위협 인텔리전스", tabs: [
      { page: "threat.html", label: "위협 인텔" },
      { page: "mcp.html", label: "🔌 MCP 연동" },
    ]},
    report: { ic: "📄", label: "리포트", tabs: [
      { page: "report.html", label: "리포트" },
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
      { page: "ontology.html", label: "온톨로지" },
      { page: "docenrich.html", label: "문서 보강" },
      { page: "learnloop.html", label: "학습 루프" },
      { page: "merge.html", label: "LLM 합성" },
      { page: "llmguide.html", label: "LLM 가이드" },
    ]},
    settings: { ic: "⚙", label: "설정", tabs: [
      { page: "settings.html", label: "설정" },
      { page: "update.html", label: "업데이트" },
      { page: "logs.html", label: "로그" },
      { page: "audit.html", label: "작업 기록 (감사)" },
      { page: "billing.html", label: "사용량·요금" },
      { page: "reference.html", label: "기능 안내" },
    ]},
  };
  window.gijoHubs = HUBS; // hub.html이 같은 정의를 사용

  var GROUPS = [
    { id: "monitor", ic: "🖥", label: "관제", items: [
      { page: "dashboard.html", label: "대시보드" },
      { page: "hub.html?g=analysis", label: "보안 분석", bot: true },
      { page: "hub.html?g=threat", label: "위협 인텔리전스", bot: true },
      { page: "hub.html?g=report", label: "리포트", bot: true },
    ]},
    { id: "assets", ic: "🛡", label: "자산·조치", items: [
      { page: "hub.html?g=assets", label: "자산 허브", bot: true },
      { page: "approvals.html", label: "조치·승인", bot: true },
      { page: "hub.html?g=products", label: "보안제품", bot: true },
      { page: "hub.html?g=inspect", label: "점검 콘솔", bot: true },
    ]},
    { id: "ai", ic: "🤖", label: "AI", items: [
      { page: "hub.html?g=aiteam", label: "AI 팀" },
      { page: "hub.html?g=aiknowledge", label: "AI 지식·모델", bot: true },
      { page: "redteam.html", label: "레드팀·가드레일", bot: true },
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
      // 사이드바 열을 레일+서브패널 폭으로. #gijoNav(=.sidebar)의 기존 패딩·테두리·min-height 무력화.
      ".app{grid-template-columns:auto 1fr !important;}" +
      "#gijoNav{padding:0 !important;border-right:0 !important;min-height:0 !important;display:flex;position:sticky;top:0;height:100vh;align-self:start;z-index:20;}" +
      // 레일(54)+서브패널(166)=220px — 기존 사이드바 폭과 동일하게 맞춰 본문이 좁아지지 않게 한다.
      ".gn-rail{width:54px;background:#0a1120;border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:3px;height:100vh;}" +
      ".gn-ic{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:17px;color:var(--muted);cursor:pointer;flex:0 0 auto;}" +
      ".gn-ic:hover{background:rgba(255,255,255,.05);color:#fff;}" +
      ".gn-ic.active{background:rgba(59,130,246,.16);color:var(--blue-light);}" +
      ".gn-ic.hasactive::after{content:'';position:absolute;margin-top:26px;margin-left:26px;width:6px;height:6px;border-radius:50%;background:var(--blue);}" +
      ".gn-spacer{flex:1 1 auto;}" +
      ".gn-sub{width:166px;background:var(--panel-2);border-right:1px solid var(--border);height:100vh;overflow-y:auto;padding:6px 0;}" +
      ".gn-subtitle{font-size:11.5px;font-weight:800;color:#fff;padding:14px 13px 9px;letter-spacing:.2px;}" +
      ".gn-item{padding:8px 13px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".gn-item:hover{color:#fff;background:rgba(255,255,255,.03);}" +
      ".gn-item.active{color:var(--blue-light);box-shadow:inset 3px 0 0 var(--blue);background:rgba(59,130,246,.08);cursor:default;}" +
      // 레일(54px)에선 가로 워드마크가 잘리므로, 앞의 마크만 보이게 크롭한다(overflow hidden + 좌측 정렬).
      ".gn-logo{height:30px;width:30px;overflow:hidden;display:flex;align-items:center;justify-content:flex-start;margin:0 auto 8px;cursor:pointer;}" +
      ".gn-logo img{height:24px;width:auto;max-width:none;flex:0 0 auto;object-position:left center;}" +
      // 업데이트 가능 배지 — 레일 아이콘 모서리 점 + 서브패널 항목의 작은 뱃지.
      ".gn-ic .gn-updot{position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:var(--red);border:1.5px solid #0a1120;}" +
      ".gn-item .gn-upbadge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:20px;}" +
      // 챗봇에게 물어봐도 실데이터로 답하는 화면 표시 — 모든 메뉴에서 같은 자리(우측)에 일관되게.
      ".gn-item .gn-bot{margin-left:auto;font-size:11px;opacity:.85;flex:0 0 auto;}" +
      // ② 3단계(허브 탭) — 활성 2단계 항목 아래로 들여쓰기해 펼친다.
      ".gn-tab{display:flex;align-items:center;gap:7px;padding:6px 13px 6px 28px;font-size:11.5px;color:var(--muted-2);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".gn-tab:hover{color:#fff;background:rgba(255,255,255,.03);}" +
      ".gn-tab.active{color:#fff;font-weight:700;}" +
      ".gn-tab .gn-tdot{width:4px;height:4px;border-radius:50%;background:currentColor;flex:0 0 auto;}" +
      ".gn-tab.active .gn-tdot{background:var(--blue-light);}";
    document.head.appendChild(st);
  }

  var shownGroupId = null; // 현재 서브패널에 펼친 대분류(초기값=현재 페이지의 대분류)
  var updateAvailable = false; // 클라이언트 새 버전 존재 여부(checkUpdateBadge가 채움)

  function render() {
    var root = document.getElementById("gijoNav");
    if (!root) return;
    injectCss();
    var here = currentKey();
    var activeGroup = groupOf(here);
    if (!shownGroupId) shownGroupId = activeGroup.id;
    var shown = GROUPS.filter(function (g) { return g.id === shownGroupId; })[0] || activeGroup;

    // 레일
    var rail = document.createElement("div");
    rail.className = "gn-rail";
    var logo = document.createElement("div");
    logo.className = "gn-logo";
    logo.title = "대시보드로";
    logo.innerHTML = '<img src="https://gijo.ai/_nuxt/logo_gijo_only_white.ATZVOJtw.svg" alt="GIJO">';
    logo.addEventListener("click", function () { go("dashboard.html"); });
    rail.appendChild(logo);
    var spacerAdded = false;
    GROUPS.forEach(function (g) {
      if (g.bottom && !spacerAdded) { var sp = document.createElement("div"); sp.className = "gn-spacer"; rail.appendChild(sp); spacerAdded = true; }
      var ic = document.createElement("div");
      ic.className = "gn-ic" + (g.id === shown.id ? " active" : "") + (g.id === activeGroup.id && g.id !== shown.id ? " hasactive" : "");
      ic.style.position = "relative";
      ic.title = g.label + (g.id === "settings" && updateAvailable ? " — 업데이트 가능" : "");
      ic.textContent = g.ic;
      if (g.id === "settings" && updateAvailable) {
        var dot = document.createElement("span");
        dot.className = "gn-updot";
        ic.appendChild(dot);
      }
      ic.addEventListener("click", function () { shownGroupId = g.id; render(); });
      rail.appendChild(ic);
    });

    // 서브패널
    var sub = document.createElement("div");
    sub.className = "gn-sub";
    var title = document.createElement("div");
    title.className = "gn-subtitle";
    title.textContent = shown.ic + " " + shown.label;
    sub.appendChild(title);
    shown.items.forEach(function (it) {
      var el = document.createElement("div");
      el.className = "gn-item" + (it.page === here ? " active" : "");
      el.style.display = "flex";
      el.textContent = it.label;
      if (it.bot) {
        var botMark = document.createElement("span");
        botMark.className = "gn-bot";
        botMark.textContent = "🤖";
        botMark.title = "이 화면 데이터는 챗봇에게 물어봐도 그대로 답합니다";
        el.appendChild(botMark);
      }
      if (it.page === "hub.html?g=settings" && updateAvailable) {
        var upBadge = document.createElement("span");
        upBadge.className = "gn-upbadge";
        upBadge.textContent = "1";
        el.appendChild(upBadge);
      }
      if (it.office) {
        // 페이지 이동이 아니라 별도 창(우리 AI 팀 사무실)을 연다.
        el.addEventListener("click", function () { if (window.gijo && window.gijo.openTeamOffice) window.gijo.openTeamOffice(); });
      } else if (it.page !== here) {
        el.addEventListener("click", function () { go(it.page); });
      }
      sub.appendChild(el);

      // ② 활성 2단계 항목이 허브면 그 탭(3단계)을 하위에 펼친다 — 상단 탭과 별개로 좌측에서도 이동.
      var hubMatch = it.page && /^hub\.html\?g=([a-z]+)$/.exec(it.page);
      if (it.page === here && hubMatch && HUBS[hubMatch[1]] && HUBS[hubMatch[1]].tabs.length > 1) {
        var gid = hubMatch[1];
        var curTab = currentTabPage();
        HUBS[gid].tabs.forEach(function (t, idx) {
          var isActive = curTab ? t.page === curTab : idx === 0;
          var tabEl = document.createElement("div");
          tabEl.className = "gn-tab" + (isActive ? " active" : "");
          var dot = document.createElement("span"); dot.className = "gn-tdot"; tabEl.appendChild(dot);
          var lbl = document.createElement("span"); lbl.textContent = t.label; tabEl.appendChild(lbl);
          if (t.office) {
            tabEl.addEventListener("click", function () { if (window.gijo && window.gijo.openTeamOffice) window.gijo.openTeamOffice(); });
          } else if (t.page) {
            tabEl.addEventListener("click", function () { go("hub.html?g=" + gid + "&t=" + encodeURIComponent(t.page)); });
          }
          sub.appendChild(tabEl);
        });
      }
    });

    root.innerHTML = "";
    root.appendChild(rail);
    root.appendChild(sub);
  }

  function loadOnboarding() {
    if (document.getElementById("gijoObScript")) return;
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
  function applyEmbed() {
    loadDesignSystem();
    var st = document.createElement("style");
    st.textContent = ".header{display:none !important;}#gijoNav{display:none !important;}" +
      ".app{grid-template-columns:1fr !important;display:block !important;}" +
      ".main{padding-top:16px !important;}";
    document.head.appendChild(st);
  }

  function boot() {
    if (IS_EMBED) { applyEmbed(); return; }
    // 탭으로 흡수된 페이지에 직접 들어오면(대시보드 바로가기·챗봇 링크 등) 허브의 그 탭으로 보낸다.
    var target = TAB_REDIRECT[currentPage()];
    if (target && window.gijo && window.gijo.navigateTo) { window.gijo.navigateTo(target); return; }
    loadDesignSystem();
    render();
    loadOnboarding();
    loadCommandPanel();
    checkUpdateBadge();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
