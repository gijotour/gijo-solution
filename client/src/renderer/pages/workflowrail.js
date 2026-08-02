// workflowrail.js — 업무 절차 5단계 띠 (2026-08-02 신설).
//
// 왜 필요한가(사용자 지시): "취약점 기준 업무절차에 맞는 메뉴 구성 및 대화창 가이드라인으로
//   쉽게 업무 보고 리포트까지 전과정을 볼수있어야해".
//   메뉴를 절차로 바꾼 것은 절반이다. **지금 어디까지 왔는지**가 화면에 보여야 나머지 절반이 된다.
//
// 규칙
//   · 숫자는 **서버가 한 곳에서 센다**(/api/workflow/stages). 화면마다 세면 같은 단계인데
//     화면마다 값이 달라지고, 그 순간 담당자는 숫자를 못 믿는다.
//   · **못 구한 값은 비운다.** 0으로 채우면 "없다"는 뜻이 되어 거짓이 된다.
//   · 0인 경고는 **죽여서** 그린다 — "미배정 0"을 빨갛게 두면 위험 신호가 흔해져 안 보인다.
//   · 서버가 안 되면 띠를 **아예 안 그린다**. 빈 띠가 자리만 먹는 것보다 없는 편이 낫다.
//
// 쓰는 법: 화면은 아무것도 안 해도 된다. 이 파일을 불러오면 스스로 자리를 찾아 붙는다.
//   (붙는 자리: .main의 맨 위. 어느 단계인지는 화면 주소로 판단한다.)
(function () {
  if (window.gijoRail) return;

  // 화면 → 단계. 메뉴(nav.js GROUPS)와 **같은 자리**여야 한다 — 어긋나면 담당자가
  // "메뉴에선 ③인데 띠에선 ②"를 보게 된다.
  var 화면단계 = {
    "analysis.html": 1, "threat.html": 1, "inventory.html": 1,
    "vulnscan.html": 2, "sbom.html": 2,
    "approvals.html": 3, "maintenance.html": 3, "terminal.html": 3,
    "hardening.html": 4,
    "report.html": 5, "kpi.html": 5, "compliance.html": 5,
  };

  function 지금화면() {
    try { return decodeURIComponent((location.pathname || "").split("/").pop() || ""); } catch (e) { return ""; }
  }

  function 모양() {
    if (document.getElementById("gijoRailCss")) return;
    var st = document.createElement("style");
    st.id = "gijoRailCss";
    st.textContent =
      ".gjr{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;}" +
      ".gjr-s{flex:1;min-width:132px;background:var(--panel-2,#1f1e1d);border:1px solid var(--border,rgba(255,255,255,.08));" +
      "border-radius:9px;padding:7px 10px;cursor:pointer;transition:border-color .12s;}" +
      ".gjr-s:hover{border-color:var(--blue,#3b82f6);}" +
      ".gjr-s.on{border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.1);}" +
      ".gjr-s .t{font-size:12.25px;font-weight:800;color:#fff;display:flex;align-items:center;gap:5px;}" +
      // ⚠ 11px 미만은 배율을 올려도 안 보인다(uireadability 시험이 막는다) — 번호도 예외 없다.
      ".gjr-s .t .no{width:16px;height:16px;border-radius:4px;background:rgba(59,130,246,.2);color:var(--blue-light,#5fa1ff);" +
      "font-size:11px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;}" +
      ".gjr-s .v{font-size:11.75px;color:var(--muted-2,#a49d95);margin-top:2px;}" +
      ".gjr-s .v b{font-size:15px;font-weight:900;color:var(--blue-light,#5fa1ff);}" +
      // 0인 경고는 죽여서 — 색이 흔하면 위험 신호가 안 보인다.
      ".gjr-s .v .al{color:#f5928a;font-weight:800;}" +
      ".gjr-s .v .al0{color:var(--muted-2,#a49d95);font-weight:600;}" +
      ".gjr-s .v .none{color:var(--muted-2,#a49d95);opacity:.6;}";
    document.head.appendChild(st);
  }

  function 그리기(stages, 여기) {
    var 자리 = document.querySelector(".main");
    if (!자리 || document.querySelector(".gjr")) return;
    모양();
    var 띠 = document.createElement("div");
    띠.className = "gjr";
    stages.forEach(function (s) {
      var el = document.createElement("div");
      el.className = "gjr-s" + (s.no === 여기 ? " on" : "");
      el.title = s.label + " 단계로 이동";
      var 값 =
        s.count == null
          ? '<span class="none">—</span>'   // 못 구한 값은 비운다(지어내지 않는다)
          : "<b>" + s.count + "</b>";
      var 경고 =
        s.alert == null || !s.alertLabel
          ? ""
          : ' · <span class="' + (s.alert ? "al" : "al0") + '">' + s.alertLabel + " " + s.alert + "</span>";
      el.innerHTML =
        '<div class="t"><span class="no">' + s.no + "</span>" + s.label + (s.no === 여기 ? " ◀" : "") + "</div>" +
        '<div class="v">' + 값 + 경고 + "</div>";
      el.addEventListener("click", function () {
        try {
          if (typeof window.gijoOpenScreen === "function") window.gijoOpenScreen(s.page, s.label);
          else if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(s.page);
        } catch (e) { /* 못 가도 화면은 그대로 */ }
      });
      띠.appendChild(el);
    });
    자리.insertBefore(띠, 자리.firstChild);
  }

  async function 붙이기() {
    var 여기 = 화면단계[지금화면()];
    if (!여기) return;                       // 절차 화면이 아니면 띠를 안 그린다
    if (!window.gijo || !window.gijo.workflowStages) return;
    try {
      var r = await window.gijo.workflowStages();
      if (r && Array.isArray(r.stages) && r.stages.length) 그리기(r.stages, 여기);
    } catch (e) {
      /* 서버가 안 되면 **아예 안 그린다** — 빈 띠가 자리만 먹는 것보다 없는 편이 낫다 */
    }
  }

  window.gijoRail = { 붙이기: 붙이기 };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 붙이기);
  else 붙이기();
})();
