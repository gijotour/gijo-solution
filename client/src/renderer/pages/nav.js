// nav.js — GIJO AS 네비게이션 (시안 B: 아이콘 레일 + 서브패널).
// 모든 페이지의 <div id="gijoNav"> 안에 [얇은 아이콘 레일 | 서브패널]을 그린다. 레일에서 대분류를
// 고르면 그 분류의 기능이 서브패널에 나오고, 항목을 클릭하면 그 페이지로 이동한다(기존 멀티페이지
// 구조 유지 — 페이지별 대량 수정 없이 좌측 IA만 시안 B로 교체하는 저위험 방식).
// 스타일은 페이지 :root 토큰(--panel-2·--border·--blue…)을 그대로 쓰므로 다크 테마와 일관된다.

(function () {
  // 대분류(레일 아이콘) → 기능(서브패널 항목). 24기능을 4대분류 + 안내 + 설정으로 간소화.
  var GROUPS = [
    { id: "monitor", ic: "🖥", label: "관제·모니터링", items: [
      { page: "dashboard.html", label: "대시보드" },
      { page: "kpi.html", label: "보안 KPI" },
      { page: "analysis.html", label: "보안 분석 (통합 관제)" },
      { page: "sessions.html", label: "작업 세션" },
      { page: "threat.html", label: "위협 인텔리전스" },
    ]},
    { id: "assets", ic: "🛡", label: "자산·취약점·대응", items: [
      { page: "inventory.html", label: "자산 목록" },
      { page: "sbom.html", label: "AI-BOM 구성" },
      { page: "vulnscan.html", label: "취약점" },
      { page: "approvals.html", label: "조치·승인" },
      { page: "products.html", label: "보안제품" },
      { page: "opsguide.html", label: "유지보수" },
      { page: "report.html", label: "리포트" },
      { page: "compliance.html", label: "컴플라이언스" },
    ]},
    { id: "ai", ic: "🤖", label: "AI", items: [
      { page: "agent.html", label: "에이전트 AI" },
      { page: "merge.html", label: "LLM 합성" },
      { page: "llmguide.html", label: "LLM 가이드" },
      { page: "memory.html", label: "기억·학습 (RAG)" },
      { page: "docenrich.html", label: "문서 보강" },
      { page: "ontology.html", label: "온톨로지" },
      { page: "learnloop.html", label: "학습 루프" },
      { page: "redteam.html", label: "레드팀·가드레일" },
    ]},
    { id: "system", ic: "🛠", label: "시스템", items: [
      { page: "logs.html", label: "로그" },
      { page: "audit.html", label: "작업 기록 (감사)" },
      { page: "terminal.html", label: "터미널 (CLI)" },
      { page: "hardening.html", label: "원격 정기점검" },
    ]},
    { id: "help", ic: "❓", label: "기능 안내", bottom: true, items: [
      { page: "reference.html", label: "기능 안내 — 전체 기능·입력칸" },
    ]},
    { id: "settings", ic: "⚙", label: "설정", bottom: true, items: [
      { page: "settings.html", label: "설정" },
      { page: "billing.html", label: "사용량·요금" },
    ]},
  ];

  function currentPage() {
    return decodeURIComponent((location.pathname || "").split("/").pop() || "");
  }
  function go(page) { if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(page); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function groupOf(page) {
    for (var i = 0; i < GROUPS.length; i++) {
      for (var j = 0; j < GROUPS[i].items.length; j++) if (GROUPS[i].items[j].page === page) return GROUPS[i];
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
      ".gn-logo{height:26px;width:42px;display:flex;align-items:center;justify-content:center;margin-bottom:6px;cursor:pointer;}" +
      ".gn-logo img{height:20px;}";
    document.head.appendChild(st);
  }

  var shownGroupId = null; // 현재 서브패널에 펼친 대분류(초기값=현재 페이지의 대분류)

  function render() {
    var root = document.getElementById("gijoNav");
    if (!root) return;
    injectCss();
    var here = currentPage();
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
      ic.title = g.label;
      ic.textContent = g.ic;
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
      el.textContent = it.label;
      if (it.page !== here) el.addEventListener("click", function () { go(it.page); });
      sub.appendChild(el);
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

  function boot() {
    loadDesignSystem();
    render();
    loadOnboarding();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
