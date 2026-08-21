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

  // 색은 **제품 테마 그대로** 쓴다(2026-08-05 검토 지적). 다른 팔레트를 들고 오면
  // 같은 심각도가 표에서는 살구색, 그림에서는 빨강으로 보인다 — "같은 데이터는 같게 보인다"는
  // 이 모듈의 존재 이유와 정면으로 어긋난다. 아래 값은 화면들의 .sev-* / :root와 같은 색이다.
  var 색 = {
    critical: "#f5928a", high: "#f7a86a", medium: "#f0a020", low: "#b3ada4", info: "#a49d95",
    covered: "#1eb980", partial: "#f0a020", open: "#f5928a", na: "#a49d95",
    ok: "#1eb980", warn: "#f0a020", bad: "#f5928a", idle: "#a49d95", blue: "#5fa1ff",
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
      // ⚠ 하지 않는 일을 약속하지 않는다(2026-08-05 검토 지적). 누를 수 없으면 "누르면"을
      //   붙이지 않고, 누른 결과가 거르기가 아닌 화면은 그 화면이 문구를 준다(opt.누르면).
      b.title = s.label + " " + s.value.toLocaleString() + (s.단위 || "건") +
        (opt.onPick ? " — " + (opt.누르면 || "누르면 이것만 봅니다") : "");
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
      '<div class="gviz-donut" style="background:conic-gradient(' + c + " 0 " + pct + "%, var(--border-strong,rgba(255,255,255,.16)) " + pct + '% 100%)">' +
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
   * filterBar(el, { label, 보임, 전체, 단위 }, onClear) — 고른 것이 없으면(null) 지운다.
   *
   * ⚠ 숫자는 **목록의 단위 하나로만** 적는다(2026-08-05 검토 지적). 예전엔 칩에 막대 값
   *   (취약점 812건)을, 「전체」에 목록 값(호스트 46건)을 적어 한 줄에 단위가 둘이었다 —
   *   무엇이 812이고 무엇이 46인지 읽는 사람이 알 길이 없었다.
   *   막대 값은 막대 위에 이미 적혀 있으니, 이 띠는 "지금 목록에 몇이 남았나"만 말한다.
   */
  function filterBar(el, 고른것, onClear) {
    if (!el) return;
    if (!고른것) { el.innerHTML = ""; el.style.display = "none"; return; }
    var 단위 = 고른것.단위 || "건";
    el.style.display = "";
    el.className = "gviz-filter";
    el.innerHTML =
      '<span class="chip">' + esc(고른것.label) + "</span>" +
      "<span>만 보는 중 — " + 단위 + " " + 짧은수(고른것.보임) + " / 전체 " + 짧은수(고른것.전체) + "</span>" +
      '<span class="x">✕ 해제 · 전체 보기</span>';
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
      // ⚠ 제품에 있는 변수만 쓴다(--line·--fg는 이 제품 테마에 없다 — 폴백 색으로 그려져
      //   띠만 옆 판과 다른 색이 됐다, 2026-08-05 검토 지적).
      ".gviz{background:var(--panel,#30302e);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:6px;padding:10px 12px 8px;margin-bottom:8px}",
      ".gviz-head{display:flex;align-items:center;gap:8px;height:20px;margin-bottom:8px}",
      ".gviz-t{color:var(--text,#e9e7e2);font-weight:bold;font-size:12px}",
      ".gviz-hint{color:var(--muted-2,#a49d95);font-size:11px;margin-left:auto}",
      ".gviz-row{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}",
      ".gviz-bars{display:flex;gap:6px;align-items:flex-end;height:" + 그림높이 + "px}",
      // ⚠ 칸을 44px로 고정했더니 **한글 이름표가 전부 줄바꿈**돼 13px 칸을 37px까지 넘쳤다
      //   (2026-08-05 실측: 「인프라 호스트」·「완화통제」는 물론 두 글자 「서버」까지 접혔다).
      //   한글은 아무 데서나 접히므로 nowrap + 말줄임으로 막고, 칸은 이름표에 맞춰 늘리되
      //   상한을 둔다(무한정 늘리면 막대가 아니라 또 하나의 목록이 된다). 전체 이름은 툴팁에 있다.
      ".gviz-bar{min-width:44px;max-width:82px;padding:0 3px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;cursor:pointer}",
      ".gviz-bar .v{font-size:11px;color:var(--text,#e9e7e2);margin-bottom:2px}",
      ".gviz-bar .b{width:100%;border-radius:3px 3px 0 0;transition:.12s}",
      ".gviz-bar .l{font-size:11px;color:var(--muted,#b3ada4);margin-top:3px;line-height:14px;height:14px;" +
        "max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".gviz-bar:hover .b{filter:brightness(1.35)}",
      ".gviz-bar.on .b{outline:2px solid var(--blue-light,#5fa1ff);outline-offset:1px}",
      ".gviz-donut-w{text-align:center}",
      ".gviz-donut{width:" + 그림높이 + "px;height:" + 그림높이 + "px;border-radius:50%;display:grid;place-items:center}",
      ".gviz-donut .in{width:52px;height:52px;border-radius:50%;background:var(--panel,#30302e);display:grid;place-items:center;font-size:13px;color:var(--text,#e9e7e2);font-weight:bold}",
      ".gviz-donut-none{background:var(--border-strong,rgba(255,255,255,.16))}",
      ".gviz-donut-none .in{color:var(--muted,#b3ada4)}",
      ".gviz .cap{font-size:11px;color:var(--muted,#b3ada4);margin-top:3px}",
      ".gviz-muted{color:var(--muted-2,#a49d95)}",
      ".gviz-spark{display:flex;align-items:flex-end;gap:2px;height:" + (그림높이 - 14) + "px}",
      ".gviz-spark i{width:7px;background:var(--blue,#3b82f6);border-radius:1px 1px 0 0;display:block}",
      ".gviz-spark-w{text-align:center}",
      ".gviz-grid{display:flex;flex-wrap:wrap;gap:3px;max-width:240px}",
      ".gviz-cell{width:15px;height:15px;border-radius:2px}",
      ".gviz-cell:hover{outline:1px solid var(--blue-light,#5fa1ff)}",
      ".gviz-cell.on{outline:2px solid var(--blue-light,#5fa1ff)}",
      ".gviz-legend{max-width:240px}",
      ".gviz-empty{color:var(--muted-2,#a49d95);font-size:11px;height:" + 그림높이 + "px;display:flex;align-items:center}",
      ".gviz-filter{display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;background:var(--panel-2,#1f1e1d);border:1px solid var(--blue,#3b82f6);border-radius:6px 6px 0 0;font-size:12px;margin-bottom:0}",
      ".gviz-filter .chip{background:rgba(31,111,235,.14);border:1px solid var(--blue,#3b82f6);color:var(--blue-light,#5fa1ff);border-radius:10px;padding:1px 8px;font-size:11px}",
      ".gviz-filter .x{margin-left:auto;color:var(--muted,#b3ada4);cursor:pointer;font-size:11px}",
      ".gviz-filter .x:hover{color:var(--blue-light,#5fa1ff)}",
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
    // ⚠ **누를 게 없으면 "누르면"이라 적지 않는다**(2026-08-06 실측으로 발견).
    //   값이 전부 0이면 bars()가 「표시할 값이 없습니다」를 그리는데, 안내 문구는 화면이 준
    //   "누르면 목록이 좁혀집니다"가 그대로 남았다 — 누를 것이 없는데 누르라고 적혀 있었다.
    //   화면 4곳이 이 문구를 조건 없이 달고 있었다(조치·승인/규정 준수/위협 인텔/취약점).
    //   ⚠ 화면마다 조건을 달게 하면 **반드시 새 화면에서 또 샌다** — 그래서 여기 한 곳에서
    //     실제로 누를 수 있을 때만 약속이 남게 한다. 화면은 늘 하던 대로 문구를 주면 된다.
    var 누를것있음 = (spec.parts || []).some(function (p) {
      return p && p.kind === "bars" && typeof p.onPick === "function"
        && (p.segments || []).some(function (s) { return (s.value || 0) > 0; });
    });
    var 안내 = String(spec.hint == null ? "" : spec.hint);
    if (!누를것있음 && /누르면/.test(안내)) {
      // 약속 구절만 걷어내고 **나머지 사실(기준·근거)은 남긴다** — 기준을 같이 지우면
      // "무엇을 센 숫자인지"가 사라진다(SBOM 화면이 그렇다).
      안내 = 안내.replace(/누르면[^·]*/g, "").replace(/^\s*·\s*/, "").replace(/\s*·\s*$/, "").trim();
    }
    var d = 띠(spec.title || "한눈에", 안내);
    var r = 줄(d);
    (spec.parts || []).forEach(function (p) {
      if (!p) return;
      if (p.kind === "bars") r.appendChild(bars(p.segments, p));
      else if (p.kind === "donut") r.appendChild(donut(p.value, p.total, p));
      else if (p.kind === "spark") r.appendChild(spark(p.values, p));
      else if (p.kind === "grid") r.appendChild(grid(p.items, p));
    });
    // ⚠ 요약막대 부품과의 공존 계약(2026-08-21 검토관 B상2): 작업 내역은 #vizStrip을 상단
    //   버튼 병합 닻으로 쓰는데(nav.js 상단버튼줄합치기 — 원래 버튼 **노드를 옮겨** 담는다),
    //   여기서 통째로 지우면 그 버튼(일괄 삭제 등)이 영구 소실된다(제목줄은 이미 숨겨져
    //   되돌아올 길이 없다). 옮겨 들어온 .gsum-acts는 지우기 전에 빼 두었다가 되붙인다.
    var 보존 = 자리.querySelectorAll ? Array.prototype.slice.call(자리.querySelectorAll(":scope > .gsum-acts")) : [];
    자리.innerHTML = "";
    자리.appendChild(d);
    보존.forEach(function (k) { 자리.appendChild(k); });
    return d;
  }

  window.gijoViz = { mount: mount, bars: bars, donut: donut, spark: spark, grid: grid, filterBar: filterBar, 색: 색, 짧은수: 짧은수 };
})();
