// nav.js — GIJO AS 네비게이션 단일 소스 (사이드바 + 그룹 탭바).
// IA 통합설계(GIJO_AS_IA_통합설계.md) 1~4단계 구현:
//  · 사이드바: 20개 페이지를 통합 그룹(≈10개 최상위)으로 재배치. 한 곳에서만 관리.
//  · 탭바: 여러 페이지를 한 그룹으로 묶고, 그룹 내 이동은 .main 상단 탭으로 (페이지 병합 없이).
//    예) "취약점 관리" = 취약점(vulnscan) + 조치·승인(approvals) 두 탭.
// 각 페이지의 기존 스크립트·API 호출은 그대로 — 네비게이션만 묶는다(회귀 위험 최소).
// 스타일: 사이드바는 페이지 <style>의 .sidebar/.nav-*; 탭바는 이 파일이 :root 토큰으로 주입.

(function () {
  // 통합 구조. 각 group은 사이드바 1항목 = 탭 묶음. tabs[0].page가 대표(사이드바 클릭 시 이동).
  var SECTIONS = [
    { section: "모니터링", groups: [
      { ic: "◆", label: "대시보드", tabs: [
        { page: "dashboard.html", label: "대시보드" },
      ]},
      { ic: "📊", label: "보안 KPI", tabs: [
        { page: "kpi.html", label: "보안 KPI 대시보드" },
      ]},
      { ic: "🔬", label: "보안 분석", tabs: [
        { page: "analysis.html", label: "통합 관제" },
      ]},
      { ic: "💬", label: "작업 세션", tabs: [
        { page: "sessions.html", label: "작업 세션" },
      ]},
    ]},
    { section: "보안 업무", groups: [
      // 자산과 그 취약점은 한 흐름이라 하나로 통합(2026-07-19): 목록·AI-BOM·취약점·조치를 탭으로.
      // 탐색기(session-explorer)는 SBOM(인프라)/ML BOM(AI) 하위 그룹으로 자산을 나눈다.
      { ic: "🧠", label: "ML BOM", tabs: [
        { page: "inventory.html", label: "자산 목록" },
        { page: "sbom.html", label: "AI-BOM 구성" },
        { page: "vulnscan.html", label: "취약점" },
        { page: "approvals.html", label: "조치·승인" },
      ]},
      { ic: "△", label: "위협 인텔리전스", tabs: [{ page: "threat.html", label: "위협 인텔리전스" }] },
      { ic: "🧰", label: "보안 운영", tabs: [
        { page: "products.html", label: "보안제품" },
        { page: "opsguide.html", label: "유지보수" },
      ]},
      { ic: "▣", label: "리포트·컴플라이언스", tabs: [
        { page: "report.html", label: "내부 리포트" },
        { page: "compliance.html", label: "컴플라이언스" },
      ]},
    ]},
    { section: "AI", groups: [
      { ic: "◉", label: "AI 어시스턴트", tabs: [
        { page: "agent.html", label: "에이전트 AI" },
        { page: "merge.html", label: "LLM 합성" },
        { page: "llmguide.html", label: "LLM 가이드" },
      ]},
      { ic: "📚", label: "AI 지식·모델", tabs: [
        { page: "memory.html", label: "기억·학습" },
        { page: "docenrich.html", label: "문서 보강" },
        { page: "ontology.html", label: "온톨로지" },
        { page: "learnloop.html", label: "학습 루프" },
      ]},
      { ic: "🛡", label: "AI 견고성", tabs: [
        { page: "redteam.html", label: "레드팀·가드레일" },
      ]},
    ]},
    { section: "시스템", groups: [
      // 로그는 상시 확인 대상이라 설정 하위 탭이 아닌 최상위 항목으로 둔다.
      { ic: "🗒", label: "로그", tabs: [{ page: "logs.html", label: "로그" }] },
      // 작업 기록(감사 로그) — 모든 실행/승인/차단/변경의 단일 타임라인.
      { ic: "📜", label: "작업 기록", tabs: [{ page: "audit.html", label: "작업 기록" }] },
      // 담당자 PC CLI 터미널 — 수동 실행 + 챗봇 명령 제안(허용목록·승인).
      { ic: ">_", label: "터미널", tabs: [{ page: "terminal.html", label: "터미널 (CLI)" }] },
      { ic: "⚙", label: "설정", tabs: [
        { page: "settings.html", label: "설정" },
        { page: "billing.html", label: "사용량·요금" },
      ]},
    ]},
  ];

  function currentPage() {
    return decodeURIComponent((location.pathname || "").split("/").pop() || "");
  }
  function inGroup(g, page) { return g.tabs.some(function (t) { return t.page === page; }); }
  function go(page) { if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(page); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ── 사이드바: 그룹당 1항목 ────────────────────────────────
  function renderSidebar(here) {
    var root = document.getElementById("gijoNav");
    if (!root) return;
    root.innerHTML = "";
    SECTIONS.forEach(function (sec) {
      var head = document.createElement("div");
      head.className = "nav-section";
      head.textContent = sec.section;
      root.appendChild(head);
      sec.groups.forEach(function (g) {
        var active = inGroup(g, here);
        var el = document.createElement("div");
        el.className = "nav-item" + (active ? " active" : "");
        el.innerHTML = '<span class="ic"></span>' + esc(g.label);
        el.querySelector(".ic").textContent = g.ic;
        if (!active) el.addEventListener("click", function () { go(g.tabs[0].page); });
        root.appendChild(el);
      });
    });
  }

  // ── 그룹 탭바: 현재 페이지가 든 그룹의 형제 탭 (.main 상단) ──
  function findGroup(here) {
    for (var i = 0; i < SECTIONS.length; i++) {
      var gs = SECTIONS[i].groups;
      for (var j = 0; j < gs.length; j++) if (inGroup(gs[j], here)) return gs[j];
    }
    return null;
  }
  function injectTabCss() {
    if (document.getElementById("gijoTabCss")) return;
    var st = document.createElement("style");
    st.id = "gijoTabCss";
    st.textContent =
      ".gijo-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin:-4px 0 20px;flex-wrap:wrap}" +
      ".gijo-tab{padding:9px 16px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;" +
      "border-bottom:2px solid transparent;margin-bottom:-1px}" +
      ".gijo-tab:hover{color:var(--white)}" +
      ".gijo-tab.active{color:#fff;border-bottom-color:var(--blue);cursor:default}";
    document.head.appendChild(st);
  }
  function renderTabs(here) {
    var group = findGroup(here);
    if (!group || group.tabs.length < 2) return; // 단일 페이지 그룹은 탭 없음
    var main = document.querySelector(".main");
    if (!main || document.querySelector(".gijo-tabs")) return;
    injectTabCss();
    var bar = document.createElement("div");
    bar.className = "gijo-tabs";
    group.tabs.forEach(function (t) {
      var tab = document.createElement("div");
      var active = t.page === here;
      tab.className = "gijo-tab" + (active ? " active" : "");
      tab.textContent = t.label;
      if (!active) tab.addEventListener("click", function () { go(t.page); });
      bar.appendChild(tab);
    });
    main.insertBefore(bar, main.firstChild);
  }

  // 온보딩(시작 가이드)을 모든 페이지에 로드 — 런처로 어디서든 재열기·체크. 자동표시는 대시보드 1회.
  function loadOnboarding() {
    if (document.getElementById("gijoObScript")) return;
    var s = document.createElement("script");
    s.id = "gijoObScript";
    s.src = "onboarding.js";
    document.body.appendChild(s);
  }

  function boot() {
    var here = currentPage();
    renderSidebar(here);
    renderTabs(here);
    loadOnboarding();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
