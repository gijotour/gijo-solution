/**
 * chatparts.js — 대화창 답변에 붙는 **공용 부품**.
 *
 * 왜 만들었나(2026-08-01 사용자 지적: "대화창 하나의 구조로 되어 있는 게 맞지?"):
 *   담당자가 지시를 넣는 자리가 두 곳이다.
 *     · 셸의 지휘소(console.js)      — 평소에 쓰는 자리
 *     · 화면 위젯(chatwidget.js)     — **분리창(⧉ 창으로)** 에서는 여기가 유일한 창구다
 *   그런데 같은 답인데 자리마다 붙는 것이 달랐다(실측):
 *     체크칸·가서 하기가 지휘소에만 있어, 화면을 창으로 빼는 순간 목록에서 고를 수가 없었다.
 *     담당자는 "아까는 됐는데?"가 된다 — 기능이 아니라 **자리**가 다른 것을 사람은 모른다.
 *
 *   부품을 여기 한 곳에 두고 양쪽이 부른다. 한쪽에만 고쳐 놓고 고쳤다고 믿는 일을 없앤다.
 *
 * ⚠ 이 파일은 **화면(DOM)만** 만든다. 서버로 보내는 일은 부르는 쪽이 넘겨준다(submit·navigate).
 *   지휘소와 분리창은 보내는 방법이 달라서(창은 본창에 부탁해야 한다) 그 차이만 바깥에 남긴다.
 *
 * 쓰는 법:
 *   window.gijoChatParts.quotes(el, r.quotes, r.output, r.sources)
 *   window.gijoChatParts.picks(el, r.picklist, function (보낼글, 보일글) { ... })
 *   window.gijoChatParts.open(el, r.openScreen, { navigate: function (page, label) { ... } })
 */
(function () {
  if (window.gijoChatParts) return; // 두 번 읽혀도 한 벌만

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  // CSS는 여기서 스스로 넣는다 — 부르는 쪽 스타일에 기대면 한쪽에서만 깨진다.
  // 클래스는 gcp-(gijo chat parts) 접두로 두어 기존 cs-·gcw- 와 섞이지 않게 한다.
  function ensureCss() {
    if (document.getElementById("gijoChatPartsCss")) return;
    var st = document.createElement("style");
    st.id = "gijoChatPartsCss";
    st.textContent = [
      ".gcp-pick{margin-top:8px;border:1px solid rgba(255,255,255,.10);border-radius:9px;padding:8px 10px;}",
      ".gcp-pick.done{opacity:.55;}",
      ".gcp-ph{font-size:12.25px;color:var(--muted-2,#a49d95);margin-bottom:6px;}",
      ".gcp-pi{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;cursor:pointer;}",
      ".gcp-pi:hover{background:rgba(255,255,255,.03);}",
      ".gcp-pi input{width:auto;margin:0;flex:0 0 auto;}",
      ".gcp-pl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".gcp-ps{flex:0 0 auto;font-size:12px;color:var(--muted-2,#a49d95);}",
      ".gcp-pb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);}",
      ".gcp-pc{font-size:12.25px;color:var(--muted,#b3ada4);margin-right:auto;}",
      ".gcp-pact{font-size:12.25px;font-weight:700;color:var(--blue-light,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.30);border-radius:7px;padding:4px 9px;cursor:pointer;font-family:inherit;min-height:26px;}",
      ".gcp-pact:hover:not(:disabled){background:rgba(59,130,246,.20);}",
      ".gcp-pact:disabled{color:var(--muted-2,#a49d95);background:none;border-color:rgba(255,255,255,.08);cursor:default;}",
      ".gcp-pv{display:flex;gap:6px;margin-top:7px;}",
      ".gcp-pvi{flex:1;background:var(--panel-2,#1f1e1d);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:5px 9px;color:var(--text,#e9e7e2);font-size:12px;font-family:inherit;outline:none;}",
      ".gcp-open{display:block;margin-top:8px;font-size:12.5px;font-weight:700;color:var(--blue-light,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.35);border-radius:8px;padding:6px 12px;cursor:pointer;min-height:28px;font-family:inherit;}",
      ".gcp-open:hover{background:rgba(59,130,246,.18);}",
      ".gcp-open:disabled{color:var(--teal,#1eb980);background:rgba(30,185,128,.10);border-color:rgba(30,185,128,.35);cursor:default;}",
      ".gcp-src{margin-top:6px;font-size:11.5px;font-weight:700;color:#6fdcb5;}",
      // ② 찾아보긴 했으나 근거는 아님 — 초록(근거 있음)과 **눈에 띄게 달라야** 한다.
      //   호박색은 이 제품에서 「주의·확인 필요」 자리다(근거 약함 배너의 ⚠와 같은 결).
      ".gcp-src2{margin-top:6px;font-size:11.5px;font-weight:700;color:#ffd88a;}",
      ".gcp-ev{margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;min-width:0;}",
      // 안전망 — 어쩌다 줄(.cs-row)에 직접 붙어도 **아래로** 가지 옆으로 가지 않게 한다.
      ".cs-row{flex-wrap:wrap;}",
      ".cs-row > .gcp-ev, .cs-row > .gcp-src, .cs-row > .gcp-open, .cs-row > .gcp-picks{flex:1 1 100%;}",
      ".gcp-evh{font-size:12px;color:var(--muted,#b3ada4);cursor:pointer;user-select:none;}",
      ".gcp-q{border-left:3px solid rgba(59,130,246,.45);background:rgba(59,130,246,.05);padding:7px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;}",
      ".gcp-qd{font-size:11.5px;color:var(--muted-2,#a49d95);margin-bottom:3px;}",
      ".gcp-qt{font-size:12.25px;line-height:1.75;color:#cdd4e6;}",
      ".gcp-qt mark{background:rgba(240,160,32,.28);color:#ffd88a;padding:0 2px;border-radius:3px;}",
    ].join("\n");
    document.head.appendChild(st);
  }

  /**
   * 근거 배지 + 근거 원문(접힘).
   *
   * ★ 왜 원문까지 보여 주나(2026-08-01 실측): 문서엔 "미사용 룰 37개"라고 적혀 있는데
   *   AI가 "27"이라고 답했다. 근거 배지에는 그 문서가 **맞게** 떴다 — 자료 찾기는 정상이고
   *   모델이 표를 잘못 읽은 것이다. 담당자는 그 숫자로 보고를 쓴다.
   *   원문을 함께 보여 주면 그 자리에서 눈으로 잡는다.
   *   (모델에게 "숫자를 정확히 읽어라"라고 타이르지 않는다 — 반복 실패한 방식이다.)
   */
  /**
   * 붙일 자리를 고른다 — **말풍선 안**이지 줄(row) 옆이 아니다.
   *
   * ⚠ 2026-08-02 실사고: 대화 한 줄(.cs-row)은 [아이콘][본문] 가로 배치다. 여기에 근거 블록을
   *   그대로 붙이면 **세 번째 칸**이 되어 본문을 옆으로 밀어낸다. 넓은 별도 창에서는 자리가
   *   남아 멀쩡해 보이고, 앱에 붙인 좁은 대화창(380px)에서만 본문이 한 글자 폭으로 찌부러져
   *   "2/시/18/분"처럼 세로로 쪼개졌다 — 그래서 한쪽에서만 깨져 보였다.
   *   줄을 받으면 그 안의 본문 칸(.cb)으로 바꿔 준다.
   */
  function 붙일자리(el) {
    if (el && el.classList && el.classList.contains("cs-row")) {
      var cb = el.querySelector(".cb");
      if (cb) return cb;
    }
    return el;
  }

  /**
   * 근거 배지 — **3상태** (2026-08-13 · 계획서 전-4 4-ⓑ, 시안 승인).
   *
   * ★ 무엇이 문제였나(운영 실측 8문항 8회 재현): 배지가 거짓말을 했다.
   *     "ISMS 인증 취득일은 사내 지식 베이스에 **포함되어 있지 않습니다**"
   *       + 📄 근거: GIJO_지식_보안거버넌스_표준.md · ismsp_접근권한_검토.md
   *   답은 없다는데 출처는 있다 — 담당자가 그 문서를 보고서에 출처로 적을 수 있다.
   *   뿌리: 이 sources는 **답이 인용한 자료가 아니라 서버가 따로 재검색한 후보**인데,
   *         문구는 「📄 **근거**」라고 단언한다.
   *
   * ① 근거로 답함        sources 있고 근거세기="강함"  → 📄 근거: …           (초록, 그대로)
   * ② 찾아보긴 함        sources 있고 근거세기="약함"  → 📄 찾아본 자료 — 근거 아님: … (호박색, 신설)
   * ③ 사내 자료를 안 봄  sources 없음/빈 배열          → **배지 없음**
   *
   * ⚠ 문서 이름은 ②에서도 **보여 준다** — 담당자가 「그럼 그 문서를 올려야겠다」로 이어갈
   *   단서라서다. 떼면 이 배지를 단 이유(2026-08-01 "안 보여주면 못 잡는다")와 반대가 된다.
   * ⚠ 아이콘은 📄 그대로다. tone.ts 표식 사전에 🔎="검색 0건"이 이미 예약돼 있어, 비슷한 🔍를
   *   다른 뜻으로 쓰면 그 파일이 경고하는 문제("표식은 자리마다 뜻이 하나여야")를 반복한다.
   * ⚠ 문구에 「찾지 못했습니다」를 쓰지 않는다 — drawer-audit의 실패 문구 목록에 있어
   *   좋은 답에 실패 딱지가 붙는다(2026-08-13 actioncheck에서 겪은 그 함정).
   */
  function quotes(el, list, answer, sources, 근거세기) {
    el = 붙일자리(el);
    if (!el) return;
    ensureCss();
    if (Array.isArray(sources) && sources.length) {
      var 약함 = 근거세기 === "약함";
      var badge = document.createElement("div");
      badge.className = 약함 ? "gcp-src2" : "gcp-src";
      badge.textContent = (약함 ? "📄 찾아본 자료 — 근거 아님: " : "📄 근거: ") + sources.slice(0, 4).join(" · ");
      el.appendChild(badge);
    }
    if (!Array.isArray(list) || !list.length) return;

    var wrap = document.createElement("div");
    wrap.className = "gcp-ev";
    var head = document.createElement("div");
    head.className = "gcp-evh";
    var open = false;
    var draw = function () { head.textContent = (open ? "▾" : "▸") + " 📄 근거 원문 " + list.length + "대목 — 답이 맞는지 확인"; };
    draw();
    var body = document.createElement("div");
    body.style.cssText = "display:none;margin-top:6px";

    // 답에 나온 숫자·영문코드를 원문에서 강조 — 눈이 바로 그리로 간다.
    var marks = (String(answer || "").match(/\d[\d,.\-]{0,12}|[A-Z][A-Za-z0-9\-]{3,}/g) || [])
      .filter(function (t) { return t.length >= 2; }).slice(0, 12);
    list.slice(0, 3).forEach(function (q) {
      var box = document.createElement("div");
      box.className = "gcp-q";
      var txt = esc(q.text || "");
      marks.forEach(function (t) {
        var safe = esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try { txt = txt.replace(new RegExp(safe, "g"), "<mark>$&</mark>"); } catch (e) {}
      });
      box.innerHTML = '<div class="gcp-qd">' + esc(q.documentId || "") + '</div><div class="gcp-qt">' + txt + "</div>";
      body.appendChild(box);
    });

    head.addEventListener("click", function () { open = !open; body.style.display = open ? "block" : "none"; draw(); });
    wrap.appendChild(head); wrap.appendChild(body);
    el.appendChild(wrap);
  }

  /**
   * 체크칸 — 목록에서 골라 바로 조치한다.
   *
   * submit(보낼글, 보일글): 고른 것을 서버로 보내는 일은 부르는 쪽이 한다.
   *   보낼글에는 기계 표식(#고른건 sha1…)이 들어가고, 보일글은 사람이 읽는 한 줄이다.
   *   ⚠ 표식이 대화 기록에 남으면 안 되므로 서버가 걸러낸다(stripPickMarks) — 여기선 그냥 보낸다.
   */
  function picks(el, pl, submit) {
    el = 붙일자리(el);
    if (!el || !pl || !pl.items || !pl.items.length || typeof submit !== "function") return;
    ensureCss();
    var chosen = [];
    var wrap = document.createElement("div");
    wrap.className = "gcp-pick";

    var head = document.createElement("div");
    head.className = "gcp-ph";
    head.textContent = pl.kind === "task"
      ? "끝낸 일을 골라 바로 체크할 수 있습니다"
      : "고쳐야 할 것을 골라 바로 처리할 수 있습니다";
    wrap.appendChild(head);

    pl.items.forEach(function (it) {
      var row = document.createElement("label");
      row.className = "gcp-pi";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", function () {
        var at = chosen.indexOf(it.id);
        if (cb.checked) { if (at < 0) chosen.push(it.id); }
        else if (at >= 0) chosen.splice(at, 1);
        sync();
      });
      var name = document.createElement("span");
      name.className = "gcp-pl";
      name.textContent = it.label;
      var sub = document.createElement("span");
      sub.className = "gcp-ps";
      sub.textContent = (it.assignee ? "담당 " + it.assignee : "담당 미배정") + " · " + (it.dueDate ? "기한 " + it.dueDate : "기한 없음");
      row.appendChild(cb); row.appendChild(name); row.appendChild(sub);
      wrap.appendChild(row);
    });

    var bar = document.createElement("div");
    bar.className = "gcp-pb";
    var cnt = document.createElement("span");
    cnt.className = "gcp-pc";
    bar.appendChild(cnt);
    var acts = [];
    (pl.actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.className = "gcp-pact";
      b.textContent = a.label;
      b.addEventListener("click", function () { onAct(a); });
      acts.push(b);
      bar.appendChild(b);
    });
    wrap.appendChild(bar);

    // 담당자·기한처럼 값이 필요한 조치는 이 줄이 열린다(창을 띄우지 않는다).
    var ask = document.createElement("div");
    ask.className = "gcp-pv";
    ask.style.display = "none";
    wrap.appendChild(ask);

    function sync() {
      cnt.textContent = chosen.length ? chosen.length + "건 선택" : "고르면 아래 조치를 쓸 수 있습니다";
      acts.forEach(function (b) { b.disabled = chosen.length === 0; });
    }
    function send(a, value) {
      // 사람에겐 뜻만, 서버에는 고른 건의 신원(sha1)까지 — 번호를 모델이 다시 읽는 일이 없다.
      var 뜻 = "고른 " + chosen.length + "건을 " + a.label + (value ? " (" + value + ")" : "");
      // 무엇을 고른 것인지도 실어 보낸다 — 취약점의 "조치완료"와 할 일의 "끝냄"은 뜻이 다르다.
      var lines = [뜻, "#고른건 " + chosen.join(","), "#조치 " + a.key, "#종류 " + (pl.kind || "finding")];
      if (value) lines.push("#값 " + value);
      wrap.classList.add("done");
      acts.forEach(function (b) { b.disabled = true; });
      ask.style.display = "none";
      submit(lines.join("\n"), 뜻);
    }
    function onAct(a) {
      if (!chosen.length) return;
      if (!a.needs) return send(a, "");
      ask.innerHTML = "";
      ask.style.display = "flex";
      var inp = document.createElement("input");
      inp.className = "gcp-pvi";
      if (a.needs === "dueDate") { inp.type = "date"; }
      else { inp.type = "text"; inp.placeholder = "담당자 이름"; }
      var ok = document.createElement("button");
      ok.className = "gcp-pact";
      ok.textContent = "적용";
      var go = function () {
        var v = (inp.value || "").trim();
        if (!v) { inp.focus(); return; } // 빈 값이면 "담당 (없음)"이라는 뜻 모를 승인이 뜬다
        send(a, v);
      };
      ok.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
      ask.appendChild(inp); ask.appendChild(ok);
      inp.focus();
    }
    sync();
    return wrap;
  }

  /**
   * 「가서 하기」 — AI가 대신 하면 안 되는 일(계정·인증·열쇠)은 순서만 안내하고
   * 그 화면을 찾아 들어가는 수고를 없앤다.
   *
   * navigate(page, label) → Promise|void : 화면을 여는 방법은 자리마다 다르다.
   *   셸이면 탭으로 열고, 분리창이면 본창에 부탁해야 한다 — 그 차이를 부르는 쪽이 넘긴다.
   */
  function open(el, screen, opts) {
    el = 붙일자리(el);
    if (!el || !screen || !screen.page) return;
    var nav = opts && opts.navigate;
    if (typeof nav !== "function") return; // 여는 법을 모르면 **버튼을 만들지 않는다**(눌러도 안 되는 버튼 금지)
    ensureCss();
    var leaf = String(screen.label || "").split(">").pop().trim() || "화면";
    var b = document.createElement("button");
    b.className = "gcp-open";
    b.textContent = "🗔 " + leaf + " 열기";
    b.addEventListener("click", function () {
      b.disabled = true;
      var done = function (ok, why) {
        b.textContent = ok ? "🗔 " + leaf + " 열었습니다" : "⚠ " + (why || "열지 못했습니다");
        if (!ok) b.disabled = false;
      };
      try {
        var r = nav(screen.page, leaf);
        if (r && typeof r.then === "function") r.then(function (ok) { done(ok !== false); }).catch(function (e) { done(false, e && e.message); });
        else done(r !== false);
      } catch (e) {
        done(false, e && e.message);
      }
    });
    el.appendChild(b);
  }

  window.gijoChatParts = { quotes: quotes, picks: picks, open: open };
})();
