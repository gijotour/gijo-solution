// viz.js — 공용 시각화 띠. "그림 먼저, 목록은 클릭하면". (계획서 전-7 ①, 2026-08-05)
//
// ■ 왜 공용인가
//   고객이 세 곳에서 같은 말을 했다 — "설명이 많다, 연결을 EDR 프로세스처럼 보고 싶다".
//   화면마다 따로 그리면 **같은 데이터인데 화면마다 숫자가 달라진다** — 지도(map-view.js)를
//   만들 때 이미 겪은 함정이라, 그때처럼 **그리는 일은 여기 한 곳**에 둔다.
//   화면은 자기 데이터와 판정을 넘겨주기만 한다(숫자의 출처는 언제나 화면 것).
//
// ■ 설계 근거(조사 2026-08-05): SOC 대시보드 표준은 **overview-first drill-down** —
//   요약에서 시작해 관심 조각을 눌러 세부로 내려간다. 표는 "정확한 값"을 볼 때 쓰고
//   첫인상은 그림이 맡는다. 목록을 **없애지 않는다** — 그림 아래 그대로 둔다.
//
// ■ 규칙
//   · 띠는 **접지 않는다**(첫인상이 목적). 대신 화면당 그림 3~4개까지 — 더 넣으면 그것도 목록이다.
//   · 클릭은 **되돌릴 수 있다** — 필터 띠에 항상 「✕ 해제 · 전체 N건」을 함께 그린다(막다른 길 금지).
//   · **가짜 숫자 금지** — 이 모듈은 받은 값만 그린다. 스스로 만들어 내는 수가 없다.
//   · 값이 0이거나 데이터가 없으면 **그 조각을 그리지 않는다**(빈 막대가 있으면 없는 걸 있다고 보게 된다).
(function () {
  "use strict";

  // 밀도(칸 낭비 최소화가 첫째 기준): 제목 20 + 그림 74 + 여백 22 = 세로 116px.
  var 그림높이 = 74;

  var 색 = {
    critical: "#da3633", high: "#f85149", medium: "#d29922", low: "#3fb950", info: "#484f58",
    covered: "#3fb950", partial: "#d29922", open: "#da3633", na: "#484f58",
    ok: "#3fb950", warn: "#d29922", bad: "#f85149", idle: "#484f58", blue: "#1f6feb",
  };
  function 색값(k) { return 색[k] || k || "#484f58"; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 띠 껍데기 — 화면들이 같은 모양을 갖게 한다.
  function 띠(제목, 힌트) {
    var d = document.createElement("div");
    d.className = "gviz";
    d.innerHTML =
      '<div class="gviz-head"><span class="gviz-t">' + esc(제목) + "</span>" +
      (힌트 ? '<span class="gviz-hint">' + esc(힌트) + "</span>" : "") +
      '</div><div class="gviz-row"></div>';
    return d;
  }
  function 줄(d) { return d.querySelector(".gviz-row"); }

  /**
   * 막대 — 심각도·상태 분포. 구간을 누르면 onPick(키)이 불린다(다시 누르면 해제 → onPick(null)).
   * 구간 = [{ key, label, value, color }]. value 0인 구간은 그리지 않는다.
   */
  function bars(구간들, opt) {
    opt = opt || {};
    var 산것 = (구간들 || []).filter(function (s) { return (s.value || 0) > 0; });
    var box = document.createElement("div");
    box.className = "gviz-bars";
    if (!산것.length) {
      box.innerHTML = '<div class="gviz-empty">표시할 값이 없습니다</div>';
      return box;
    }
    var 최대 = Math.max.apply(null, 산것.map(function (s) { return s.value; }));
    산것.forEach(function (s) {
      var h = Math.max(6, Math.round((s.value / 최대) * (그림높이 - 26)));
      var b = document.createElement("div");
      b.className = "gviz-bar";
      b.setAttribute("data-key", s.key);
      b.innerHTML =
        '<span class="v">' + esc(짧은수(s.value)) + "</span>" +
        '<div class="b" style="height:' + h + "px;background:" + 색값(s.color || s.key) + '"></div>' +
        '<span class="l">' + esc(s.label) + "</span>";
      b.title = s.label + " " + s.value.toLocaleString() + "건 — 누르면 이것만 봅니다";
      if (opt.onPick) {
        b.addEventListener("click", function () {
          var 이미 = b.classList.contains("on");
          box.querySelectorAll(".gviz-bar").forEach(function (x) { x.classList.remove("on"); });
          if (!이미) b.classList.add("on");
          opt.onPick(이미 ? null : s.key, 이미 ? null : s);
        });
      }
      box.appendChild(b);
    });
    return box;
  }

  /** 도넛 — 이행률·덮는 범위. 전체가 0이면 "아직 없음"을 정직하게 쓴다(0%로 그리지 않는다). */
  function donut(값, 전체, opt) {
    opt = opt || {};
    var w = document.createElement("div");
    w.className = "gviz-donut-w";
    if (!전체) {
      w.innerHTML = '<div class="gviz-donut gviz-donut-none"><div class="in">–</div></div>' +
        '<div class="cap">' + esc(opt.label || "") + "</div>" +
        '<div class="cap gviz-muted">아직 없음</div>';
      return w;
    }
    var pct = Math.round((값 / 전체) * 100);
    var c = 색값(opt.color || (pct >= 80 ? "ok" : pct >= 50 ? "warn" : "bad"));
    w.innerHTML =
      '<div class="gviz-donut" style="background:conic-gradient(' + c + " 0 " + pct + "%, #30363d " + pct + '% 100%)">' +
      '<div class="in">' + (opt.showRatio ? 값 + "/" + 전체 : pct + "%") + "</div></div>" +
      '<div class="cap">' + esc(opt.label || "") + "</div>";
    w.title = (opt.label || "") + " " + 값 + "/" + 전체 + " (" + pct + "%)";
    if (opt.onPick) { w.style.cursor = "pointer"; w.addEventListener("click", function () { opt.onPick(); }); }
    return w;
  }

  /** 스파크라인 — 추세. 값이 2개 미만이면 그리지 않는다(선 하나로는 추세가 아니다). */
  function spark(값들, opt) {
    opt = opt || {};
    var v = (값들 || []).filter(function (x) { return typeof x === "number"; });
    var w = document.createElement("div");
    w.className = "gviz-spark-w";
    if (v.length < 2) { w.innerHTML = '<div class="gviz-empty">추세를 그릴 만큼 쌓이지 않았습니다</div>'; return w; }
    var 최대 = Math.max.apply(null, v) || 1;
    var bars2 = v.map(function (x) {
      return '<i style="height:' + Math.max(2, Math.round((x / 최대) * (그림높이 - 16))) + 'px"></i>';
    }).join("");
    w.innerHTML = '<div class="gviz-spark">' + bars2 + "</div>" +
      '<div class="cap">' + esc(opt.label || "") + "</div>";
    w.title = (opt.label || "") + " — " + v.join(", ");
    return w;
  }

  /**
   * 구획 그리드 — 항목 하나가 칸 하나(제품·장비 배치도). 항목 = { key, label, color, title }.
   * 40개를 넘으면 그리지 않는다 — 그 정도면 그림이 아니라 또 하나의 목록이다.
   */
  function grid(항목들, opt) {
    opt = opt || {};
    var it = 항목들 || [];
    var w = document.createElement("div");
    w.className = "gviz-grid-w";
    if (!it.length) { w.innerHTML = '<div class="gviz-empty">표시할 항목이 없습니다</div>'; return w; }
    if (it.length > 40) {
      w.innerHTML = '<div class="gviz-empty">항목이 ' + it.length + "개라 배치도 대신 아래 목록으로 봅니다</div>";
      return w;
    }
    var g = document.createElement("div");
    g.className = "gviz-grid";
    it.forEach(function (x) {
      var c = document.createElement("div");
      c.className = "gviz-cell";
      c.style.background = 색값(x.color);
      c.title = x.title || x.label || "";
      if (opt.onPick) {
        c.style.cursor = "pointer";
        c.addEventListener("click", function () {
          var 이미 = c.classList.contains("on");
          g.querySelectorAll(".gviz-cell").forEach(function (y) { y.classList.remove("on"); });
          if (!이미) c.classList.add("on");
          opt.onPick(이미 ? null : x.key, 이미 ? null : x);
        });
      }
      g.appendChild(c);
    });
    w.appendChild(g);
    if (opt.legend && opt.legend.length) {
      var lg = document.createElement("div");
      lg.className = "cap gviz-legend";
      lg.innerHTML = opt.legend.map(function (l) {
        return '<span style="color:' + 색값(l.color) + '">■</span>' + esc(l.label) + " " + l.count;
      }).join(" &nbsp;");
      w.appendChild(lg);
    }
    return w;
  }

  /**
   * 필터 띠 — 클릭한 조각을 알리고 **되돌릴 길을 함께 준다**(막다른 길 금지).
   * el에 그린다. 고른 것이 없으면 지운다.
   */
  function filterBar(el, 고른것, 전체수, onClear) {
    if (!el) return;
    if (!고른것) { el.innerHTML = ""; el.style.display = "none"; return; }
    el.style.display = "";
    el.className = "gviz-filter";
    el.innerHTML =
      "<span>목록</span>" +
      '<span class="chip">' + esc(고른것.label) + " " + 짧은수(고른것.value) + "건</span>" +
      '<span class="x">✕ 해제 · 전체 ' + 짧은수(전체수) + "건 보기</span>";
    var x = el.querySelector(".x");
    if (x && onClear) x.addEventListener("click", onClear);
  }

  function 짧은수(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString();
  }

  // 스타일 — 화면마다 베끼지 않게 여기서 한 번만 넣는다(중복 주입 방지).
  function 스타일주입() {
    if (document.getElementById("gviz-style")) return;
    var s = document.createElement("style");
    s.id = "gviz-style";
    s.textContent = [
      ".gviz{background:var(--panel,#0f141a);border:1px solid var(--line,#30363d);border-radius:6px;padding:10px 12px 8px;margin-bottom:8px}",
      ".gviz-head{display:flex;align-items:center;gap:8px;height:20px;margin-bottom:8px}",
      ".gviz-t{color:var(--fg,#e6edf3);font-weight:bold;font-size:12px}",
      ".gviz-hint{color:var(--muted-2,#6e7681);font-size:11px;margin-left:auto}",
      ".gviz-row{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}",
      ".gviz-bars{display:flex;gap:6px;align-items:flex-end;height:" + 그림높이 + "px}",
      ".gviz-bar{width:44px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;cursor:pointer}",
      ".gviz-bar .v{font-size:11px;color:var(--fg,#c9d1d9);margin-bottom:2px}",
      ".gviz-bar .b{width:100%;border-radius:3px 3px 0 0;transition:.12s}",
      ".gviz-bar .l{font-size:11px;color:var(--muted,#8b949e);margin-top:3px;height:13px}",
      ".gviz-bar:hover .b{filter:brightness(1.35)}",
      ".gviz-bar.on .b{outline:2px solid #58a6ff;outline-offset:1px}",
      ".gviz-donut-w{text-align:center}",
      ".gviz-donut{width:" + 그림높이 + "px;height:" + 그림높이 + "px;border-radius:50%;display:grid;place-items:center}",
      ".gviz-donut .in{width:52px;height:52px;border-radius:50%;background:var(--panel,#0f141a);display:grid;place-items:center;font-size:13px;color:var(--fg,#e6edf3);font-weight:bold}",
      ".gviz-donut-none{background:#30363d}",
      ".gviz-donut-none .in{color:var(--muted,#8b949e)}",
      ".gviz .cap{font-size:11px;color:var(--muted,#8b949e);margin-top:3px}",
      ".gviz-muted{color:var(--muted-2,#6e7681)}",
      ".gviz-spark{display:flex;align-items:flex-end;gap:2px;height:" + (그림높이 - 14) + "px}",
      ".gviz-spark i{width:7px;background:#1f6feb;border-radius:1px 1px 0 0;display:block}",
      ".gviz-spark-w{text-align:center}",
      ".gviz-grid{display:flex;flex-wrap:wrap;gap:3px;max-width:240px}",
      ".gviz-cell{width:15px;height:15px;border-radius:2px}",
      ".gviz-cell:hover{outline:1px solid #58a6ff}",
      ".gviz-cell.on{outline:2px solid #58a6ff}",
      ".gviz-legend{max-width:240px}",
      ".gviz-empty{color:var(--muted-2,#6e7681);font-size:11px;height:" + 그림높이 + "px;display:flex;align-items:center}",
      ".gviz-filter{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;background:var(--panel-2,#161b22);border:1px solid #1f6feb;border-radius:6px 6px 0 0;font-size:12px;margin-bottom:0}",
      ".gviz-filter .chip{background:rgba(31,111,235,.14);border:1px solid #1f6feb;color:#79c0ff;border-radius:10px;padding:1px 8px;font-size:11px}",
      ".gviz-filter .x{margin-left:auto;color:var(--muted,#8b949e);cursor:pointer;font-size:11px}",
      ".gviz-filter .x:hover{color:#79c0ff}",
    ].join("");
    document.head.appendChild(s);
  }

  /**
   * 화면이 부르는 단 하나의 입구.
   * mount(자리, { title, hint, parts: [{kind:'bars'|'donut'|'spark'|'grid', ...}] })
   * 그린 띠를 돌려준다(화면이 다시 그릴 때 갈아 끼우기 쉽게).
   */
  function mount(자리, spec) {
    if (!자리) return null;
    스타일주입();
    var d = 띠(spec.title || "한눈에", spec.hint);
    var r = 줄(d);
    (spec.parts || []).forEach(function (p) {
      if (!p) return;
      if (p.kind === "bars") r.appendChild(bars(p.segments, p));
      else if (p.kind === "donut") r.appendChild(donut(p.value, p.total, p));
      else if (p.kind === "spark") r.appendChild(spark(p.values, p));
      else if (p.kind === "grid") r.appendChild(grid(p.items, p));
    });
    자리.innerHTML = "";
    자리.appendChild(d);
    return d;
  }

  window.gijoViz = { mount: mount, bars: bars, donut: donut, spark: spark, grid: grid, filterBar: filterBar, 색: 색, 짧은수: 짧은수 };
})();
