// grouphub.js — 그룹 허브 공용 모듈 (2026-08-09, 발견·수집이 1호)
//
// 사이드바 그룹 하나를 "한눈에 띠 + 하단 무대" 한 화면으로 통합하는 틀.
// 다른 그룹(우선순위·조치·검증…)도 같은 방식으로 확장할 예정이라 설정 주도로 짰다:
//   window.gijoGroupHub.mount(host, {
//     panels: [{ id, title, page, load() → {rows?, segments?, donut?, foot?} }],
//     initial: "panel-id",
//   })
// · 띠(각 판 132px)는 늘 보이고, 판을 누르면 하단 무대 iframe만 바뀐다.
// · 요약 숫자는 각 판의 load()가 **그 메뉴가 쓰는 것과 같은 원천 API**로 계산한다 —
//   요약 계산이 두 곳(허브·화면)이라 어긋날 수 있는 지점은 가벼운 셈(집계)뿐이므로,
//   기준(심각도 등급 등)은 반드시 화면 쪽과 같은 규칙을 쓸 것.
// · 무대는 기존 화면을 embed=1 끼움 창으로 그대로 연다 — 화면을 다시 만들지 않는다.
(function () {
  "use strict";

  // ── 🗂 범위 중계 (2026-08-18) ────────────────────────────────────────────
  //
  // ⚠ **이 중계가 없으면 판은 영영 범위를 모른다.**
  //   셸(app.html)은 자기 **탭** iframe에만 범위를 보낸다. 그런데 판(무대)은
  //   허브 화면 안의 **또 다른 iframe**이라 셸이 못 닿는다 — 2단 중첩이다.
  //   허브가 받아서 무대로 다시 전해야 사슬이 이어진다.
  // ⚠ 무대가 **나중에 뜨는** 경우도 있다(판을 눌러 처음 열 때). 그래서 지금 값을
  //   들고 있다가 load 때 한 번 더 먹인다 — 안 그러면 그 판만 전체를 보여 준다.
  var 지금범위 = null;
  try {
    var raw = window.localStorage.getItem("gijo:scope:asset");
    지금범위 = raw ? JSON.parse(raw) : null;
    if (지금범위 && (!지금범위.id || !지금범위.label)) 지금범위 = null;
  } catch (e) { 지금범위 = null; }

  function 무대에전하기(stage, sc) {
    if (!stage || !stage.contentWindow) return;
    try { stage.contentWindow.postMessage({ type: "gijo:scope:set", scope: sc }, "*"); } catch (e) { }
  }

  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.type !== "gijo:scope:set") return;
    지금범위 = d.scope && d.scope.id && d.scope.label ? d.scope : null;
    무대에전하기(document.getElementById("ghStage"), 지금범위);
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function panelHtml(p, on) {
    return (
      '<div class="gh-card' + (on ? " on" : "") + '" data-panel="' + esc(p.id) + '">' +
      '<div class="gh-head">' + esc(p.title) + '<span class="gh-badge" id="ghb-' + esc(p.id) + '"></span></div>' +
      '<div class="gh-body" id="ghc-' + esc(p.id) + '"><span class="gh-empty">불러오는 중…</span></div>' +
      "</div>"
    );
  }

  // 요약 렌더 — rows(이름:값 줄) / segments(막대) / donut(비율) 혼합 지원.
  function summaryHtml(d) {
    if (!d) return '<span class="gh-empty">불러오지 못했습니다</span>';
    var h = "";
    if (d.segments && d.segments.length) {
      var max = Math.max.apply(null, d.segments.map(function (s) { return s.value; }).concat([1]));
      h += '<div class="gh-bars">' + d.segments.map(function (s) {
        var hpx = Math.max(4, Math.round((s.value / max) * 26)); // 카드 132px 안에 숫자+막대+이름이 다 들어와야 한다(넘치면 제목과 겹친다 — 2026-08-09 실측)
        return '<div class="gh-bcol"><div class="gh-bv">' + s.value.toLocaleString() + '</div>' +
          '<div class="gh-bar" style="height:' + hpx + 'px;background:' + (s.color || "var(--blue,#3b82f6)") + '"></div>' +
          '<div class="gh-bl">' + esc(s.label) + "</div></div>";
      }).join("") + "</div>";
    }
    if (d.rows && d.rows.length) {
      h += d.rows.map(function (r) {
        return '<div class="gh-row"><span>' + esc(r[0]) + "</span><b" + (r[2] ? ' style="color:' + r[2] + '"' : "") + ">" + esc(r[1]) + "</b></div>";
      }).join("");
    }
    if (d.foot) h += '<div class="gh-foot">' + esc(d.foot) + "</div>";
    return h || '<span class="gh-empty">데이터 없음</span>';
  }

  function mount(host, cfg) {
    var current = cfg.initial || (cfg.panels[0] && cfg.panels[0].id);
    host.innerHTML =
      '<div class="gh-strip">' + cfg.panels.map(function (p) { return panelHtml(p, p.id === current); }).join("") + "</div>" +
      '<iframe class="gh-stage" id="ghStage"></iframe>';
    var stage = host.querySelector("#ghStage");

    function show(id) {
      current = id;
      var p = cfg.panels.find(function (x) { return x.id === id; });
      if (!p) return;
      host.querySelectorAll(".gh-card").forEach(function (el) { el.classList.toggle("on", el.dataset.panel === id); });
      // 같은 화면 재클릭이면 다시 로드하지 않는다(끼움 창 초기화 비용).
      // hub=1: 허브 무대 표식 — nav.js의 탭 흡수(TAB_REDIRECT)가 이 창을 다시 허브로
      // 돌려보내면 무한 중첩이 된다. 쿼리가 달라 리다이렉트 키에 안 걸리게 한다.
      var want = p.page + (p.page.indexOf("?") >= 0 ? "&" : "?") + "embed=1&hub=1";
      if (!stage.getAttribute("src") || stage.getAttribute("src") !== want) {
        // ⚠ **판을 갈아 끼우기 전에 대화창의 「보던 목록」을 비운다**(2026-08-18 검토 지적).
        //   셸이 보는 탭 이름(ctx.screen)은 허브 하나로 고정이라(예: "fix.html") 판을 바꿔도
        //   안 바뀐다. 그래서 대화창은 화면이 바뀐 줄 모른다 — 승인 판을 보다 정기점검 판으로
        //   옮긴 뒤 「이것들 전부 오탐」이라 하면 **사라진 승인 목록**에 걸린다.
        //   여기서 비우면 새 판이 뜨면서 자기 목록을 다시 알린다(안 알리는 판이면 비운 채로 둔다).
        try { window.top.postMessage({ type: "gijo:view" }, "*"); } catch (e) { /* 셸 밖이면 없던 일로 */ }
        // 🗂 범위를 **새로 뜨는 판에도** 먹인다(2026-08-18). 판은 지금 만들어지므로
        // 뜬 뒤에 전해야 한다 — 지금 보내면 아직 받을 창이 없다.
        stage.addEventListener("load", function 한번() {
          stage.removeEventListener("load", 한번);
          무대에전하기(stage, 지금범위);
        });
        stage.setAttribute("src", want);
      }
    }

    host.querySelector(".gh-strip").addEventListener("click", function (e) {
      var card = e.target.closest(".gh-card");
      if (card) show(card.dataset.panel);
    });

    // 요약은 판마다 독립 로드 — 하나가 실패해도 나머지는 그려진다(부분 실패 격리).
    cfg.panels.forEach(function (p) {
      Promise.resolve()
        .then(function () { return p.load(); })
        .then(function (d) {
          var el = host.querySelector("#ghc-" + p.id);
          if (el) el.innerHTML = summaryHtml(d);
          var b = host.querySelector("#ghb-" + p.id);
          if (b && d && d.badge) { b.textContent = d.badge.text; b.style.color = d.badge.color || ""; }
        })
        .catch(function () {
          var el = host.querySelector("#ghc-" + p.id);
          if (el) el.innerHTML = '<span class="gh-empty">불러오지 못했습니다</span>';
        });
    });

    show(current);
    return { show: show };
  }

  window.gijoGroupHub = { mount: mount };
})();
