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

  // ⚠ 화면→단계 표를 **여기 들지 않는다.** 처음엔 이 파일이 제 지도를 갖고 있었는데,
  //   그러면 사이드바(nav.js)와 어긋나는 순간 담당자가 "메뉴에선 ③인데 띠에선 ②"를 보게 되고
  //   그 뒤로는 어느 쪽도 못 믿는다. 자리도 숫자와 똑같이 **서버가 한 번만 정한다**
  //   (workflow.ts STAGE_SCREENS → 응답의 stage.screens).

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
      ".gjr-s .t{font-size:12.25px;font-weight:800;color:var(--text-strong,#fff);display:flex;align-items:center;gap:5px;}" +
      // ⚠ 11px 미만은 배율을 올려도 안 보인다(uireadability 시험이 막는다) — 번호도 예외 없다.
      ".gjr-s .t .no{width:16px;height:16px;border-radius:4px;background:rgba(59,130,246,.2);color:var(--blue-light,#5fa1ff);" +
      "font-size:11px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;}" +
      ".gjr-s .v{font-size:11.75px;color:var(--muted-2,#a49d95);margin-top:2px;}" +
      ".gjr-s .v b{font-size:15px;font-weight:900;color:var(--blue-light,#5fa1ff);}" +
      // 0인 경고는 죽여서 — 색이 흔하면 위험 신호가 안 보인다.
      ".gjr-s .v .al{color:var(--rail-alert,#f5928a);font-weight:800;}" +
      ".gjr-s .v .al0{color:var(--muted-2,#a49d95);font-weight:600;}" +
      ".gjr-s .v .none{color:var(--muted-2,#a49d95);opacity:.6;}" +
      // 단위 이름 — 숫자보다 작고 죽여서. 새 색을 만들지 않는다(이미 쓰는 --muted-2).
      ".gjr-s .v .cl{font-size:11px;color:var(--muted-2,#a49d95);font-weight:700;margin-left:2px;}";
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
      // ⚠ 2026-09-02(F4-03) 큰 숫자에 **이름**을 붙인다 — 지금까지는 숫자만 찍혀 무엇을 센 건지
      //   알 수 없었다(승인 시안 mockups/menu-workflow의 「57 자산」 표기를 되살린 것이다).
      //   이름은 서버가 준다(workflow.ts countLabel) — 화면이 제 지도를 들면 계산부를 고칠 때 어긋난다.
      //   ⚠ **없으면 안 그린다.** 옛 서버(필드 없음)에 붙어도 숫자는 그대로 나온다.
      //   세로 높이 증가 0px — 같은 `.v` 줄 안에 들어간다.
      var 이름 = s.countLabel ? ' <span class="cl">' + s.countLabel + "</span>" : "";
      var 값 =
        s.count == null
          ? '<span class="none">—</span>'   // 못 구한 값은 비운다(지어내지 않는다)
          : "<b>" + s.count + "</b>" + 이름;
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
          // ⚠ 폴백 순서(2026-08-19 사장님 실사고 「발견·수집 누르니 표준 모드」): 팝업 창에는
          //   gijoOpenScreen이 없어 navigateTo로 떨어졌고, 그게 본창을 화면 파일로 직접 로드해
          //   프로 셸을 부쉈다. 본창 탭 열기(openTabInShell)가 먼저다 — navigateTo는 최후이며
          //   main 쪽 승격 안전망이 한 번 더 받는다.
          else if (window.gijo && window.gijo.openTabInShell) window.gijo.openTabInShell(s.page, s.label);
          else if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(s.page);
        } catch (e) { /* 못 가도 화면은 그대로 */ }
      });
      띠.appendChild(el);
    });
    자리.insertBefore(띠, 자리.firstChild);
  }

  async function 붙이기() {
    if (!window.gijo || !window.gijo.workflowStages) return;
    // 그룹 허브의 무대 안(&hub=1)에서는 그리지 않는다 — 허브가 이미 같은 띠를 위에 두고 있어
    // 한 화면에 절차 띠가 둘이 된다(2026-08-09 발견·수집 통합 실측).
    if (/[?&]hub=1/.test(location.search)) return;
    try {
      var r = await window.gijo.workflowStages();
      if (!r || !Array.isArray(r.stages) || !r.stages.length) return;
      var 지금 = 지금화면();
      var 여기 = 0;
      r.stages.forEach(function (s) {
        if (Array.isArray(s.screens) && s.screens.indexOf(지금) >= 0) 여기 = s.no;
      });
      if (!여기) return;                     // 절차 화면이 아니면 띠를 안 그린다
      그리기(r.stages, 여기);
    } catch (e) {
      /* 서버가 안 되면 **아예 안 그린다** — 빈 띠가 자리만 먹는 것보다 없는 편이 낫다 */
    }
  }

  window.gijoRail = { 붙이기: 붙이기 };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 붙이기);
  else 붙이기();
})();
