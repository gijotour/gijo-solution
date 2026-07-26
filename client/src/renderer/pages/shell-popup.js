// shell-popup.js — 대시보드 팝업 셸 (혼합 방식, 2026-07-26 결정 · 시안 mockups/shell-popup-v2)
//
// 왜: 메뉴를 옮길 때마다 페이지 전체를 다시 읽어(loadFile) 대시보드의 명령창·대화·진행 중
// 작업이 사라졌다. 세션 복원(3.1.1)은 "턴이 쌓인 세션"만 살릴 수 있어 입력 중 초안·진행 중
// 응답까지는 못 지킨다. 그래서 대시보드를 껍데기(셸)로 고정하고, 화면은 그 위 팝업(iframe)으로
// 연다 — 리로드 자체가 없으니 아무것도 사라지지 않는다.
//
// 규칙(시안 v2 승인):
// · 대상은 nav.js GROUPS에서 popup:true인 메뉴(1차 파일럿: 자산 허브·보안 분석·리포트)
// · 동시 최대 5개 — 넘치면 핀(📌) 없는 가장 오래 안 본 팝업이 자동으로 닫힌다(토스트 안내)
// · 슬롯 클릭 = 전환(iframe은 숨겨둘 뿐 살아있음 — 화면 상태 보존). 활성 슬롯 재클릭 = 대시보드로
// · 🗗 창으로 분리 = 별도 창(사무실 창 방식)으로 떼어냄 — 슬롯에서 빠져 상한을 차지하지 않는다
// · ⛶ 전체 화면 = 기존 방식 이동(탈출구) · ⟳ 새로고침 · Esc = 대시보드로
// · 활성 팝업 = 명령 맥락: 컴포저 위 칩으로 표시하고, 지시의 screen 파라미터로 서버에 전달된다
//   (허브 팝업은 활성 "탭"의 파일명 — hub.html이 gijo:hubTab 메시지로 알려준다)
//
// 이 파일은 dashboard.html만 로드한다. 다른 화면에는 gijoShell이 없으므로 nav.js가 기존대로 이동한다.
(function () {
  "use strict";
  if (window.gijoShell) return;

  var MAX = 5; // 동시 팝업 상한(2026-07-26 사용자 결정)
  var STORE_KEY = "gijo:shell:popups"; // 대시보드를 다시 열어도 팝업 구성이 살아나게 저장
  var slots = []; // { key(page), label, pinned, lastActive, curTab(허브 활성 탭 파일명), el(iframe), slotEl }
  var activeKey = null; // 지금 화면에 보이는 팝업(없으면 대시보드)
  var visible = false;

  // ── 스타일 ──────────────────────────────────────────────────────────
  var css = document.createElement("style");
  css.textContent =
    // 관리 바 — 헤더 바로 아래 전체 폭. 팝업이 하나도 없으면 숨김.
    "#shellBar{display:none;align-items:center;gap:6px;padding:6px 12px;background:var(--panel-2,#0e1526);border-bottom:1px solid var(--border,#1e2a44);flex:0 0 auto;}" +
    "#shellBar.has{display:flex;}" +
    "#shellBar .sb-t{font-size:10px;font-weight:800;color:var(--muted-2,#5c6580);letter-spacing:1px;margin-right:2px;}" +
    ".sb-slot{display:flex;align-items:center;gap:6px;background:var(--panel,#121a2e);border:1px solid var(--border,#1e2a44);border-radius:8px;padding:4px 9px;font-size:12px;font-weight:700;color:var(--muted,#8b93ab);cursor:pointer;max-width:220px;}" +
    ".sb-slot .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
    ".sb-slot .dot{width:6px;height:6px;border-radius:50%;background:var(--muted-2,#5c6580);flex:0 0 auto;}" +
    ".sb-slot.on{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.55);color:#fff;}" +
    ".sb-slot.on .dot{background:var(--teal,#2dd4bf);box-shadow:0 0 6px var(--teal,#2dd4bf);}" +
    ".sb-slot .pinm{font-size:10px;}" +
    ".sb-slot .x{font-size:11px;color:var(--muted-2,#5c6580);padding:0 2px;border-radius:4px;flex:0 0 auto;}" +
    ".sb-slot .x:hover{color:#fff;background:rgba(226,72,61,.4);}" +
    "#shellBar .sb-right{margin-left:auto;display:flex;gap:6px;}" +
    "#shellBar .sb-btn{background:var(--panel,#121a2e);border:1px solid var(--border-strong,#28365a);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:800;color:var(--muted,#8b93ab);cursor:pointer;}" +
    "#shellBar .sb-btn:hover{color:#fff;border-color:var(--blue,#3b82f6);}" +
    // 배경막 — 팝업·컴포저 틈으로 뒤 대시보드(히어로·AI팀)가 비쳐 지저분한 것을 가린다(실화면 검증에서 발견).
    // 사이드바는 덮지 않는다 — 메뉴를 눌러 다른 팝업을 바로 열 수 있어야 한다. 클릭하면 대시보드로.
    "#shellDim{display:none;position:fixed;z-index:690;background:rgba(6,10,20,.82);}" +
    "#shellDim.on{display:block;}" +
    // 팝업 레이어 — 중앙 무대 위에 고정. 위치·크기는 JS가 계산(사이드바·컴포저를 피해서).
    "#shellLayer{display:none;position:fixed;z-index:700;background:var(--panel,#121a2e);border:1px solid var(--border-strong,#28365a);border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.65);overflow:hidden;flex-direction:column;}" +
    "#shellLayer.on{display:flex;}" +
    "#shellHead{display:flex;align-items:center;gap:10px;padding:7px 12px;background:var(--panel-2,#0e1526);border-bottom:1px solid var(--border,#1e2a44);flex:0 0 auto;}" +
    "#shellHead .t{font-size:12.5px;font-weight:800;color:#fff;}" +
    "#shellHead .sp{flex:1;}" +
    "#shellHead .hb{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted,#8b93ab);cursor:pointer;border:1px solid transparent;}" +
    "#shellHead .hb:hover{color:#fff;border-color:var(--border-strong,#28365a);background:rgba(255,255,255,.05);}" +
    "#shellHead .hb.pin-on{color:var(--amber,#f0a020);border-color:rgba(240,160,32,.5);}" +
    "#shellBody{flex:1;min-height:0;position:relative;background:var(--bg,#0a0f1e);}" +
    "#shellBody iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:none;}" +
    "#shellBody iframe.on{display:block;}" +
    // 팝업이 떠 있는 동안 — 컴포저(지휘 콘솔 박스)를 하단에 고정해 늘 보이게, 활동 로그는 낮게.
    "body.shell-popped #accConsole{position:fixed;bottom:8px;z-index:720;background:var(--panel,#121a2e);box-shadow:0 -8px 30px rgba(0,0,0,.45);}" +
    "body.shell-popped #accConsole .cl-rows{max-height:110px;}" +
    // 명령 맥락 칩 — 컴포저 바로 위. 팝업이 떠 있을 때만 보인다.
    "#shellCtx{display:none;align-items:center;gap:8px;margin:0 0 6px;}" +
    "body.shell-popped #shellCtx{display:flex;}" +
    "#shellCtx .chip{display:inline-flex;align-items:center;gap:6px;background:rgba(45,212,191,.12);border:1px solid rgba(45,212,191,.4);color:var(--teal,#2dd4bf);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:800;cursor:default;}" +
    "#shellCtx .sw{color:var(--muted-2,#5c6580);font-size:10.5px;font-weight:700;cursor:pointer;}" +
    "#shellCtx .sw:hover{color:#fff;}" +
    // 토스트(자동 닫힘 안내 등)
    "#shellToast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1a2340;border:1px solid var(--border-strong,#28365a);color:var(--text,#e6eaf3);padding:8px 16px;border-radius:10px;font-size:12px;z-index:1200;display:none;box-shadow:0 8px 24px rgba(0,0,0,.5);}" +
    // ＋메뉴 팝오버
    "#shellPlus{position:fixed;z-index:1100;background:var(--panel,#121a2e);border:1px solid var(--border-strong,#28365a);border-radius:10px;padding:6px;display:none;box-shadow:0 10px 30px rgba(0,0,0,.55);}" +
    "#shellPlus .pi{padding:7px 12px;font-size:12px;font-weight:700;color:var(--muted,#8b93ab);border-radius:7px;cursor:pointer;white-space:nowrap;}" +
    "#shellPlus .pi:hover{color:#fff;background:rgba(59,130,246,.16);}";
  document.head.appendChild(css);

  // ── DOM 뼈대 ────────────────────────────────────────────────────────
  var bar = document.createElement("div");
  bar.id = "shellBar";
  bar.innerHTML = '<span class="sb-t">열린 화면</span><span id="sbSlots" style="display:flex;gap:6px;min-width:0;"></span>' +
    '<span class="sb-right"><span class="sb-btn" id="sbPlus">＋ 메뉴</span><span class="sb-btn" id="sbCloseAll">모두 닫기</span></span>';
  var header = document.querySelector(".app-shell .header");
  if (header) header.insertAdjacentElement("afterend", bar);
  else document.body.prepend(bar);

  var dim = document.createElement("div");
  dim.id = "shellDim";
  dim.title = "대시보드로 (팝업은 위 슬롯에 유지)";
  document.body.appendChild(dim);

  var layer = document.createElement("div");
  layer.id = "shellLayer";
  layer.innerHTML = '<div id="shellHead">' +
    '<span class="t" id="shTitle"></span><span class="sp"></span>' +
    '<span class="hb" id="shPin" title="핀 — 자동 닫힘에서 제외">📌</span>' +
    '<span class="hb" id="shReload" title="새로고침">⟳</span>' +
    '<span class="hb" id="shPopout" title="창으로 분리 — 별도 창으로 떼어냄(모니터 2대용)">🗗</span>' +
    '<span class="hb" id="shPopoutV" title="세로 창으로 분리 — 세로(피벗) 모니터 관제용. 세로 모니터가 있으면 거기에 꽉 차게 열립니다">⇳</span>' +
    '<span class="hb" id="shFull" title="전체 화면으로 이동(기존 방식)">⛶</span>' +
    '<span class="hb" id="shMin" title="대시보드로 (팝업은 위 슬롯에 유지)">▁</span>' +
    '<span class="hb" id="shClose" title="닫기">✕</span></div>' +
    '<div id="shellBody"></div>';
  document.body.appendChild(layer);

  var toast = document.createElement("div");
  toast.id = "shellToast";
  document.body.appendChild(toast);

  var plus = document.createElement("div");
  plus.id = "shellPlus";
  document.body.appendChild(plus);

  // 명령 맥락 칩 — 컴포저(agentDock) 바로 위에 끼운다.
  var ctx = document.createElement("div");
  ctx.id = "shellCtx";
  ctx.innerHTML = '<span class="chip">🎯 명령 맥락: <b id="shCtxLabel"></b></span>' +
    '<span class="sw" id="shCtxSwitch">| 대시보드 맥락으로</span>' +
    '<span style="font-size:10.5px;color:var(--muted-2,#5c6580)">보이는 화면을 향해 바로 지시 — 답은 이 대화에 쌓입니다</span>';
  var dock = document.getElementById("agentDock");
  if (dock) dock.insertAdjacentElement("beforebegin", ctx);

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { toast.style.display = "none"; }, 3000);
  }

  // ── 위치 계산 — 사이드바 오른쪽 ~ 엣지 거터(46px), 관리 바 아래 ~ 컴포저 위 ──
  function layout() {
    if (!visible) return;
    var nav = document.getElementById("gijoNav");
    var navRight = 8;
    if (nav && nav.offsetParent && !document.body.classList.contains("gn-left-collapsed")) {
      navRight = Math.round(nav.getBoundingClientRect().right) + 8;
    }
    var top = Math.round(bar.getBoundingClientRect().bottom) + 8;
    var acc = document.getElementById("accConsole");
    var accH = acc ? acc.offsetHeight : 120;
    var right = 54; // 엣지 탭 거터 46px + 여백
    layer.style.left = navRight + "px";
    layer.style.top = top + "px";
    layer.style.right = right + "px";
    layer.style.bottom = (accH + 20) + "px";
    // 배경막 — 관리 바 아래 전부(사이드바 제외). 오른쪽 엣지 탭(z900)은 위에 떠서 계속 눌린다.
    dim.style.left = navRight + "px";
    dim.style.top = Math.round(bar.getBoundingClientRect().bottom) + "px";
    dim.style.right = "0";
    dim.style.bottom = "0";
    if (acc) { // 컴포저 고정 폭도 팝업과 맞춘다
      acc.style.left = navRight + "px";
      acc.style.right = right + "px";
    }
  }
  window.addEventListener("resize", layout);
  new MutationObserver(layout).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (window.ResizeObserver) {
    var acc0 = document.getElementById("accConsole");
    if (acc0) new ResizeObserver(layout).observe(acc0);
  }

  // ── 저장/복원 ───────────────────────────────────────────────────────
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        slots: slots.map(function (s) { return { key: s.key, label: s.label, pinned: s.pinned }; }),
        active: activeKey, visible: visible,
      }));
    } catch (e) {}
  }

  // ── 렌더 ────────────────────────────────────────────────────────────
  function findSlot(key) { for (var i = 0; i < slots.length; i++) if (slots[i].key === key) return slots[i]; return null; }

  function renderBar() {
    var box = document.getElementById("sbSlots");
    box.innerHTML = "";
    slots.forEach(function (s) {
      var el = document.createElement("span");
      el.className = "sb-slot" + (visible && s.key === activeKey ? " on" : "");
      el.title = s.label + (visible && s.key === activeKey ? " — 클릭하면 대시보드로" : " — 클릭하면 이 화면으로");
      el.innerHTML = (s.pinned ? '<span class="pinm">📌</span>' : "") + '<span class="dot"></span><span class="nm"></span><span class="x" title="닫기">✕</span>';
      el.querySelector(".nm").textContent = s.label;
      el.addEventListener("click", function (ev) {
        if (ev.target.classList.contains("x")) { close(s.key); return; }
        if (visible && s.key === activeKey) minimize(); else focusSlot(s.key);
      });
      box.appendChild(el);
      s.slotEl = el;
    });
    bar.classList.toggle("has", slots.length > 0);
  }

  function renderHead() {
    var s = findSlot(activeKey);
    if (!s) return;
    document.getElementById("shTitle").textContent = s.curLabel || s.label;
    document.getElementById("shPin").classList.toggle("pin-on", Boolean(s.pinned));
    var lb = document.getElementById("shCtxLabel");
    if (lb) lb.textContent = s.curLabel || s.label;
  }

  // ── 동작 ────────────────────────────────────────────────────────────
  function embedSrc(page) { return page + (page.indexOf("?") >= 0 ? "&" : "?") + "embed=1"; }

  function open(page, label, opts) {
    opts = opts || {};
    var s = findSlot(page);
    if (!s) {
      // 상한 초과 — 핀 없는 가장 오래 안 본 팝업부터 자동으로 닫는다(전부 핀이면 거절).
      if (slots.length >= MAX) {
        var victims = slots.filter(function (x) { return !x.pinned; }).sort(function (a, b) { return a.lastActive - b.lastActive; });
        if (!victims.length) { showToast("팝업 5개가 모두 📌핀 고정이라 새로 열 수 없습니다 — 하나를 닫거나 핀을 풀어주세요"); return; }
        showToast('"' + victims[0].label + '" 팝업을 자동으로 닫았습니다 (동시 5개까지)');
        close(victims[0].key, true);
      }
      var f = document.createElement("iframe");
      f.src = embedSrc(page);
      document.getElementById("shellBody").appendChild(f);
      s = { key: page, label: label || page, pinned: false, lastActive: Date.now(), curTab: null, curLabel: null, el: f };
      slots.push(s);
    }
    focusSlot(page);
    if (opts.chat) { // 챗봇 열기 — 이미 떠 있던 팝업이면 메시지로, 새로 열리면 openChatOnLoad 플래그가 처리
      setTimeout(function () { try { s.el.contentWindow.postMessage({ type: "gijo:openChat" }, "*"); } catch (e) {} }, 600);
    }
  }

  function focusSlot(key) {
    var s = findSlot(key);
    if (!s) return;
    activeKey = key;
    s.lastActive = Date.now();
    visible = true;
    document.body.classList.add("shell-popped");
    layer.classList.add("on");
    dim.classList.add("on");
    Array.prototype.forEach.call(document.getElementById("shellBody").children, function (f) { f.classList.remove("on"); });
    s.el.classList.add("on");
    renderBar(); renderHead(); layout(); persist();
  }

  function minimize() { // 팝업은 슬롯에 살아있고 화면만 대시보드로
    visible = false;
    layer.classList.remove("on");
    dim.classList.remove("on");
    document.body.classList.remove("shell-popped");
    var acc = document.getElementById("accConsole");
    if (acc) { acc.style.left = ""; acc.style.right = ""; }
    renderBar(); persist();
  }

  function close(key, silent) {
    var s = findSlot(key);
    if (!s) return;
    if (s.el && s.el.parentNode) s.el.remove();
    slots = slots.filter(function (x) { return x.key !== key; });
    if (activeKey === key) {
      activeKey = null;
      if (visible) {
        var next = slots.slice().sort(function (a, b) { return b.lastActive - a.lastActive; })[0];
        if (next) { focusSlot(next.key); return; }
        minimize();
      }
    }
    renderBar(); persist();
    if (!silent && !slots.length) showToast("팝업을 모두 닫았습니다");
  }

  // ── 헤더 버튼 ───────────────────────────────────────────────────────
  document.getElementById("shPin").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    s.pinned = !s.pinned;
    renderBar(); renderHead(); persist();
  });
  document.getElementById("shReload").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    try { s.el.contentWindow.location.reload(); } catch (e) { s.el.src = embedSrc(s.key); }
  });
  function popout(orient) {
    var s = findSlot(activeKey); if (!s) return;
    if (window.gijo && window.gijo.openShellPopout) {
      window.gijo.openShellPopout(s.key, s.label, orient);
      close(s.key, true); // 분리한 창은 슬롯에서 빠진다(상한 미점유)
      showToast('"' + s.label + '"을(를) ' + (orient === "portrait" ? "세로 " : "") + "별도 창으로 분리했습니다");
    }
  }
  document.getElementById("shPopout").addEventListener("click", function () { popout(); });
  document.getElementById("shPopoutV").addEventListener("click", function () { popout("portrait"); });
  document.getElementById("shFull").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(s.key);
  });
  document.getElementById("shMin").addEventListener("click", minimize);
  document.getElementById("shClose").addEventListener("click", function () { close(activeKey); });
  document.getElementById("sbCloseAll").addEventListener("click", function () {
    slots.slice().forEach(function (s) { close(s.key, true); });
    showToast("팝업을 모두 닫았습니다");
  });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && visible) minimize(); });
  dim.addEventListener("click", minimize); // 배경막 클릭 = 대시보드로(모달 관례)

  // ＋ 메뉴 — 팝업으로 열 수 있는 화면 목록(nav.js GROUPS의 popup:true와 같은 목록 유지)
  var PLUS_ITEMS = [
    { page: "hub.html?g=assets", label: "🛡 자산 허브" },
    { page: "hub.html?g=analysis", label: "📈 보안 분석" },
    { page: "hub.html?g=report", label: "📄 리포트" },
  ];
  document.getElementById("sbPlus").addEventListener("click", function (ev) {
    ev.stopPropagation();
    plus.innerHTML = "";
    PLUS_ITEMS.forEach(function (it) {
      var d = document.createElement("div");
      d.className = "pi"; d.textContent = it.label;
      d.addEventListener("click", function () { plus.style.display = "none"; open(it.page, it.label.replace(/^\S+\s/, "")); });
      plus.appendChild(d);
    });
    var r = ev.target.getBoundingClientRect();
    plus.style.left = Math.max(8, r.right - 160) + "px";
    plus.style.top = (r.bottom + 6) + "px";
    plus.style.display = "block";
  });
  document.addEventListener("click", function () { plus.style.display = "none"; });

  // 대시보드 맥락 전환(칩) — 팝업은 그대로 두고 지시 맥락만 대시보드로 = 접기와 동일
  var sw = document.getElementById("shCtxSwitch");
  if (sw) sw.addEventListener("click", minimize);

  // ── 허브 활성 탭 통지 수신 — 명령 맥락(screen)이 탭 단위로 정확해진다 ──
  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.type !== "gijo:hubTab") return;
    var s = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].el && slots[i].el.contentWindow === ev.source) { s = slots[i]; break; }
    }
    if (!s) return;
    s.curTab = d.page;
    s.curLabel = d.label;
    if (s.key === activeKey) renderHead();
  });

  // ── 공개 API ────────────────────────────────────────────────────────
  window.gijoShell = {
    open: open,
    // 지시의 화면 맥락 — 팝업이 보이는 동안은 그 팝업(허브면 활성 탭 파일명), 아니면 대시보드 기본.
    activeScreen: function () {
      if (!visible) return undefined;
      var s = findSlot(activeKey);
      if (!s) return undefined;
      return s.curTab || (s.key.indexOf("hub.html") === 0 ? undefined : s.key);
    },
  };

  // ── 복원 — 대시보드를 다시 열어도 팝업 구성이 살아난다(화면 내부 상태는 새로 로드) ──
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && saved.slots && saved.slots.length) {
      saved.slots.slice(0, MAX).forEach(function (s0) {
        var f = document.createElement("iframe");
        f.src = embedSrc(s0.key);
        document.getElementById("shellBody").appendChild(f);
        slots.push({ key: s0.key, label: s0.label, pinned: Boolean(s0.pinned), lastActive: Date.now(), curTab: null, curLabel: null, el: f });
      });
      renderBar();
      if (saved.visible && saved.active && findSlot(saved.active)) focusSlot(saved.active);
    }
  } catch (e) {}
})();
