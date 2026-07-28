// fold.js — 화면 안 구역을 기본으로 접어 두는 공용 도우미 (2026-07-27 사용자 지시).
//
// 왜 만들었나
//   설정 11구역·보안 KPI 10구역처럼 패널이 세로로 길게 늘어선 화면에서, 담당자는 원하는 구역을
//   찾으려고 계속 스크롤해야 했다. 기본을 접어 두면 제목 줄만 남아 한눈에 목차가 된다.
//
// ⚠ 접기는 "숨기기"가 아니라 "요약으로 줄이기"다.
//   그냥 접어 버리면 안에 뭐가 들었는지 몰라서 결국 전부 다시 펼치게 되고, 클릭만 늘어난다.
//   그래서 접힌 제목 줄에 **그 구역의 핵심 숫자 배지**를 남긴다. 접힌 채로도 "지금 열어야 하나"를
//   판단할 수 있어야 접기가 쓸모 있다.
//
// 안전 원칙
//   · DOM을 옮기지 않는다. 대상 앞에 제목 줄을 끼워 넣고 대상의 display만 토글한다.
//     감싸기(wrap) 방식은 표·그리드·고정 헤더를 깨뜨린 이력이 있어 쓰지 않는다.
//   · 화면·구역별 펼침 상태는 브라우저에만 저장한다(PC마다 취향이 다르다 — 서버에 넣으면
//     계정 하나로 두 대를 쓸 때 서로 덮어쓴다).
//   · 위험 신호(지연·대기·실패 등 hot 배지가 0이 아님)가 있으면 저장값과 무관하게 펼친다.
//     놓치면 안 되는 것을 접어서 가리는 일은 없어야 한다.
//
// 쓰는 법 — 화면 HTML에서 구역에 표식만 달면 된다.
//   <div class="panel" data-gijo-fold="점검 일정"
//        data-gijo-fold-badges="kpiOverdue:지연:hot, kpiPending:대기:warn">…</div>
//   배지는 "요소id:라벨:종류" 목록(종류 생략 시 보통). 값은 그 요소의 글자를 그대로 읽는다.
(function () {
  if (window.gijoFold) return;

  var KEY_PREFIX = "gijo:fold:";
  function screenKey() {
    return decodeURIComponent((location.pathname || "").split("/").pop() || "screen");
  }
  function readOpen(name) {
    try { return localStorage.getItem(KEY_PREFIX + screenKey() + ":" + name) === "1"; } catch (e) { return false; }
  }
  function writeOpen(name, on) {
    try { localStorage.setItem(KEY_PREFIX + screenKey() + ":" + name, on ? "1" : "0"); } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById("gijoFoldCss")) return;
    var st = document.createElement("style");
    st.id = "gijoFoldCss";
    st.textContent =
      ".gjf-h{display:flex;align-items:center;gap:9px;padding:10px 12px;margin-bottom:7px;cursor:pointer;" +
      "border:1px solid var(--border,#1e2a44);border-radius:10px;background:var(--panel-2,#0e1526);user-select:none;}" +
      ".gjf-h:hover{border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.05);}" +
      ".gjf-h .car{color:var(--muted-2,#5c6580);font-size:10px;width:11px;flex:0 0 auto;transition:transform .15s;}" +
      ".gjf-h.on .car{transform:rotate(90deg);}" +
      ".gjf-h .nm{font-size:12.5px;font-weight:700;color:#dfe6ff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".gjf-b{font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.06);" +
      "color:var(--muted,#8b93ab);flex:0 0 auto;}" +
      ".gjf-b.hot{background:rgba(226,72,61,.16);color:#f5928a;}" +
      ".gjf-b.warn{background:rgba(240,160,32,.16);color:var(--amber,#f0a020);}" +
      ".gjf-b.ok{background:rgba(45,212,191,.14);color:var(--teal,#2dd4bf);}";
    document.head.appendChild(st);
  }

  // "kpiOverdue:지연:hot, kpiPending:대기" → [{id,label,kind}]
  function parseBadges(spec) {
    return String(spec || "").split(",").map(function (part) {
      var bits = part.trim().split(":");
      if (!bits[0]) return null;
      return { id: bits[0].trim(), label: (bits[1] || "").trim(), kind: (bits[2] || "").trim() };
    }).filter(Boolean);
  }

  // 배지 값 읽기 — 숫자면 0일 때 배지를 감춘다("지연 0"은 알릴 일이 아니다).
  function badgeValue(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var t = (el.textContent || "").trim();
    if (!t || t === "-" || t === "—") return null;
    var n = Number(t.replace(/[^\d.-]/g, ""));
    if (!isNaN(n) && /^[\d,.\s-]+$/.test(t) && n === 0) return null;
    return t;
  }

  var entries = []; // { target, head, name, badges }

  function paintBadges(e) {
    // 제목 줄을 다시 그리지 않고 배지 부분만 교체한다(펼침 상태·포커스 유지).
    e.head.querySelectorAll(".gjf-b").forEach(function (b) { b.remove(); });
    var hot = false;
    e.badges.forEach(function (b) {
      var v = badgeValue(b.id);
      if (v == null) return;
      if (b.kind === "hot") hot = true;
      var s = document.createElement("span");
      s.className = "gjf-b" + (b.kind ? " " + b.kind : "");
      s.textContent = (b.label ? b.label + " " : "") + v;
      e.head.appendChild(s);
    });
    return hot;
  }

  function setOpen(e, on, remember) {
    e.target.style.display = on ? "" : "none";
    e.head.classList.toggle("on", on);
    if (remember) writeOpen(e.name, on);
  }

  function build(target) {
    var name = target.getAttribute("data-gijo-fold") || "구역";
    var head = document.createElement("div");
    head.className = "gjf-h";
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    var car = document.createElement("span"); car.className = "car"; car.textContent = "▶";
    var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = name;
    head.appendChild(car); head.appendChild(nm);
    // 구역(탭)으로 나뉜 화면에서는 제목 줄도 같은 구역에 속해야 한다(2026-07-28).
    // 안 물려주면 다른 탭 구역의 제목 줄만 남아 "여긴 왜 이게 있지"가 된다.
    if (target.dataset && target.dataset.sec) head.dataset.sec = target.dataset.sec;
    target.parentNode.insertBefore(head, target);

    var e = { target: target, head: head, name: name, badges: parseBadges(target.getAttribute("data-gijo-fold-badges")) };
    entries.push(e);

    var hot = paintBadges(e);
    // 저장된 선택이 우선. 저장이 없으면 위험 신호(hot)나 '기본 펼침' 표시가 있을 때 펼친다.
    // data-gijo-fold-open — 그 구역을 보러 들어오는 자리라 접혀 있으면 안 되는 것에 붙인다.
    // (2026-07-28 실사고: 업데이트 알림을 눌러 왔는데 업데이트 구역이 접혀 있어
    //  "업데이트 화면이 없다"가 됐다. 담당자가 직접 접으면 그 선택은 그대로 존중된다.)
    var openByDefault = target.hasAttribute("data-gijo-fold-open");
    var saved = null;
    try { saved = localStorage.getItem(KEY_PREFIX + screenKey() + ":" + name); } catch (err) {}
    setOpen(e, saved === "1" ? true : (saved === "0" ? false : (hot || openByDefault)), false);

    function toggle() { setOpen(e, e.target.style.display === "none", true); }
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });
    return e;
  }

  function scan() {
    injectCss();
    document.querySelectorAll("[data-gijo-fold]").forEach(function (t) {
      if (t.__gijoFolded) return;
      t.__gijoFolded = true;
      build(t);
    });
  }

  // 배지 값은 데이터가 늦게 들어온다(목록을 받아야 계산된다) — 잠시 주기적으로 다시 읽는다.
  // 값이 채워지면서 위험 신호가 드러나면, 담당자가 아직 손대지 않은 구역은 그때 펼친다.
  function watch() {
    var ticks = 0;
    var t = setInterval(function () {
      ticks++;
      entries.forEach(function (e) {
        var hot = paintBadges(e);
        var saved = null;
        try { saved = localStorage.getItem(KEY_PREFIX + screenKey() + ":" + e.name); } catch (err) {}
        if (saved === null && hot && e.target.style.display === "none") setOpen(e, true, false);
      });
      if (ticks > 12) clearInterval(t); // 약 12초면 첫 로딩은 끝난다
    }, 1000);
  }

  window.gijoFold = { scan: scan, refresh: function () { entries.forEach(paintBadges); } };

  function boot() { scan(); watch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
