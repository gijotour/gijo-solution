// nav.js — GIJO AS 사이드바 네비게이션의 단일 소스(single source of truth).
// 이전에는 18개 페이지가 사이드바 마크업을 복붙해 유지보수가 어려웠다. 이제 이 파일 하나가
// 구조를 정의하고 각 페이지의 <div class="sidebar" id="gijoNav"></div> 에 주입한다.
// IA 통합설계(GIJO_AS_IA_통합설계.md) 1단계: 20개 메뉴를 4그룹으로 재배치 + 저빈도/고급 기본 접기.
//
// 스타일은 각 페이지 <style>의 .sidebar/.nav-section/.nav-item(.active)/.ic 규칙을 그대로 쓴다.
// 클릭은 data-page 대신 자체 핸들러로 처리해 페이지 init()의 querySelectorAll("[data-page]")와
// 이중 배선되지 않게 한다.

(function () {
  // 사용 빈도 계층: 모니터링(홈) → 보안 업무(주 업무) → AI(어시스턴트=매일, 지식·모델=세팅) → 시스템.
  var NAV = [
    { section: "모니터링", items: [
      { page: "dashboard.html", ic: "◆", label: "대시보드" },
      { page: "kpi.html", ic: "📊", label: "보안 KPI" },
    ]},
    { section: "보안 업무", items: [
      { page: "inventory.html", ic: "◇", label: "AI 자산" },
      { page: "sbom.html", ic: "▢", label: "AI-BOM" },
      { page: "vulnscan.html", ic: "⊘", label: "취약점 관리" },
      { page: "approvals.html", ic: "◈", label: "승인 워크플로우" },
      { page: "threat.html", ic: "△", label: "위협 인텔리전스" },
      { page: "products.html", ic: "🧰", label: "보안제품 관리" },
      { page: "opsguide.html", ic: "🛠", label: "유지보수" },
      { page: "report.html", ic: "▣", label: "내부 리포트" },
      { page: "compliance.html", ic: "✓", label: "컴플라이언스" },
    ]},
    { section: "AI 어시스턴트", items: [
      { page: "agent.html", ic: "◉", label: "에이전트 AI" },
    ]},
    // 저빈도·고급: 기본 접힘. 담당자는 평소 안 열고, 지식/모델 세팅이 필요할 때만 편다.
    { section: "AI 지식·모델", collapsedByDefault: true, items: [
      { page: "memory.html", ic: "⛁", label: "AI 기억·학습" },
      { page: "ontology.html", ic: "🕸", label: "온톨로지" },
      { page: "learnloop.html", ic: "🔄", label: "헤르메스 학습 루프" },
      { page: "merge.html", ic: "⬡", label: "보안 LLM 합성" },
      { page: "llmguide.html", ic: "📚", label: "추천 LLM 가이드" },
    ]},
    { section: "시스템", collapsedByDefault: true, items: [
      { page: "settings.html", ic: "⚙", label: "설정" },
      { page: "billing.html", ic: "$", label: "사용량·요금" },
      { page: "logs.html", ic: "▤", label: "로그" },
    ]},
  ];

  var COLLAPSE_KEY = "gijo:navCollapsed";

  function currentPage() {
    var p = (location.pathname || "").split("/").pop() || "";
    return decodeURIComponent(p);
  }

  function loadCollapsed() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "null"); } catch (e) {}
    if (Array.isArray(stored)) return new Set(stored); // 사용자가 이전에 조정한 상태 존중
    // 첫 방문: collapsedByDefault 섹션만 접어둔다.
    var def = [];
    NAV.forEach(function (s) { if (s.collapsedByDefault) def.push(s.section); });
    return new Set(def);
  }

  function saveCollapsed(set) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([].slice.call(set))); } catch (e) {}
  }

  function render() {
    var root = document.getElementById("gijoNav");
    if (!root) return;
    var here = currentPage();
    var collapsed = loadCollapsed();

    // 현재 페이지가 든 섹션은 접혀 있어도 펼쳐 위치를 잃지 않게 한다.
    NAV.forEach(function (s) {
      if (s.items.some(function (i) { return i.page === here; })) collapsed.delete(s.section);
    });

    root.innerHTML = "";
    NAV.forEach(function (s) {
      var head = document.createElement("div");
      head.className = "nav-section";
      head.textContent = s.section;
      head.style.cursor = "pointer";
      var caret = document.createElement("span");
      caret.style.cssText = "float:right;font-size:9px;opacity:.8";
      head.appendChild(caret);
      root.appendChild(head);

      var itemEls = s.items.map(function (i) {
        var el = document.createElement("div");
        el.className = "nav-item" + (i.page === here ? " active" : "");
        el.innerHTML = '<span class="ic"></span>' + escapeHtml(i.label);
        el.querySelector(".ic").textContent = i.ic;
        if (i.page !== here) {
          el.addEventListener("click", function () {
            if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(i.page);
          });
        }
        root.appendChild(el);
        return el;
      });

      function apply() {
        var c = collapsed.has(s.section);
        itemEls.forEach(function (el) { el.style.display = c ? "none" : ""; });
        caret.textContent = c ? "▸" : "▾";
      }
      apply();
      head.addEventListener("click", function () {
        if (collapsed.has(s.section)) collapsed.delete(s.section); else collapsed.add(s.section);
        saveCollapsed(collapsed);
        apply();
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
