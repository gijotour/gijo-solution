// fold.js — 화면 안 구역을 접었다 폈다 하는 공용 도우미 (2026-07-27 신설).
//
// 기본은 **펼침**이다 (2026-08-02 사용자 지시로 뒤집음: "접기가 아니라 펼치기로 하자 —
//   못 보는 부분이 있는 것 같다"). 접힌 화면은 있는 것을 없는 것처럼 보이게 만든다 —
//   담당자도, 화면을 확인하는 자동 점검도 구역 안을 못 본다. 접기는 담당자가 길다고 느낀
//   구역을 **직접** 접을 때만 쓰고, 그 선택은 그 PC에 기억한다.
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
//   · 위험 신호(지연·대기·실패 등 hot 배지가 0이 아님)가 있으면 접힌 구역도 다시 펼친다.
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
  function writeOpen(name, on) {
    try { localStorage.setItem(KEY_PREFIX + screenKey() + ":" + name, on ? "1" : "0"); } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById("gijoFoldCss")) return;
    var st = document.createElement("style");
    st.id = "gijoFoldCss";
    st.textContent =
      ".gjf-h{display:flex;align-items:center;gap:9px;padding:10px 12px;margin-bottom:7px;cursor:pointer;" +
      "border:1px solid var(--border,#3d3c38);border-radius:10px;background:var(--panel-2,#1f1e1d);user-select:none;}" +
      ".gjf-h:hover{border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.05);}" +
      ".gjf-h .car{color:var(--muted-2,#a49d95);font-size:11.75px;width:11px;flex:0 0 auto;transition:transform .15s;}" +
      ".gjf-h.on .car{transform:rotate(90deg);}" +
      ".gjf-h .nm{font-size:12.5px;font-weight:700;color:#dfe6ff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".gjf-b{font-size:11.75px;font-weight:800;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.06);" +
      "color:var(--muted,#b3ada4);flex:0 0 auto;}" +
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
    var 바뀜 = (e.target.style.display === "none") === !!on;   // 접힘→펼침(또는 그 반대)인가
    e.target.style.display = on ? "" : "none";
    e.head.classList.toggle("on", on);
    if (remember) writeOpen(e.name, on);
    // 펼쳐질 때 알린다 — 무거운 자료는 **열 때** 불러오면 된다.
    // (예전엔 <details>의 toggle 이벤트를 쓰던 화면이 있었다. 그것을 우리 접기로 바꾸면서 대체한다.)
    if (바뀜) {
      try {
        e.target.dispatchEvent(new CustomEvent("gijo:fold", { bubbles: true, detail: { open: !!on, name: e.name } }));
      } catch (err) { /* 알림을 못 보내도 접기 자체는 동작한다 */ }
    }
  }

  // 접기 제목 줄과 판 제목이 **같은 말을 두 번** 쓰던 자리를 지운다(2026-08-02 사용자 지시
  // "가능한 데는 같이 칸 좁혀 줘"). 접기를 걸면 이름이 적힌 줄이 이미 생기므로 판 제목은
  // 같은 글자를 한 줄 더 차지할 뿐이다 — 24곳 × 약 34px.
  // ⚠ 누르는 것(버튼·입력·링크)이 들어 있는 제목은 건드리지 않는다. 안 보이면 못 누른다.
  //   배지(span)만 든 제목은 지워도 된다 — 접힌 줄의 배지가 그 값을 그대로 읽어 보여준다.
  function 겹친제목지우기(target, name) {
    var t = target.querySelector(".panel-title, .card-title, .sec-title, .cat-title, h2, h3");
    if (!t || t.closest("[data-gijo-fold]") !== target) return;
    // 누르는 것이 들어 있으면 건드리지 않는다 — 안 보이면 못 누른다.
    // 버튼 태그가 아니어도 **누르게 만든 span**이 있다(id가 …Btn, class에 btn, onclick).
    if (t.querySelector("button, input, select, textarea, a, [id$='Btn'], [class*='btn'], [onclick]")) return;
    var 제목글 = "";
    t.childNodes.forEach(function (n) { if (n.nodeType === 3) 제목글 += n.textContent; });
    if (제목글.trim() !== String(name).trim()) return;
    t.style.display = "none";
    t.setAttribute("data-gijo-dup-title", "1"); // 왜 안 보이는지 나중에 알아볼 수 있게
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
    겹친제목지우기(target, name);

    var e = { target: target, head: head, name: name, badges: parseBadges(target.getAttribute("data-gijo-fold-badges")) };
    entries.push(e);

    var hot = paintBadges(e);
    // 기본은 펼침. 담당자가 직접 접은 구역("0")만 접힌 채로 연다.
    // 단 위험 신호(hot)가 있으면 접어 둔 구역도 펼친다 — 가려서 놓치는 일은 없어야 한다.
    // (data-gijo-fold-open 표식은 이제 기본과 같은 뜻이라 남아 있어도 동작이 달라지지 않는다.)
    var saved = null;
    try { saved = localStorage.getItem(KEY_PREFIX + screenKey() + ":" + name); } catch (err) {}
    setOpen(e, saved === "0" ? hot : true, false);

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
  // 값이 채워지면서 위험 신호가 드러나면 접혀 있던 구역도 그때 펼친다.
  function watch() {
    var ticks = 0;
    var t = setInterval(function () {
      ticks++;
      entries.forEach(function (e) {
        var hot = paintBadges(e);
        if (hot && e.target.style.display === "none") setOpen(e, true, false);
      });
      if (ticks > 12) clearInterval(t); // 약 12초면 첫 로딩은 끝난다
    }, 1000);
  }

  window.gijoFold = { scan: scan, refresh: function () { entries.forEach(paintBadges); } };

  function boot() { scan(); watch(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
