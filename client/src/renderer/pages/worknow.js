// worknow.js — "지금 진행 중인 업무" 띠. 모든 화면 위에 떠서 돌아갈 길을 만든다.
//
// ■ 왜 필요한가 (2026-07-31 재설계에서 드러난 공백)
//   '내 업무'의 가이드 단계를 누르면 그 일을 하는 화면이 열린다. 그런데 거기 도착한 순간
//   **어느 업무의 몇 단계 중이었는지 잃어버린다.** 탭은 남아 있지만 돌아갈 실마리가 없다.
//   담당자는 "내가 뭐 하러 여기 왔더라"가 되고, 가이드는 거기서 끊긴다.
//   안내를 끝까지 따라가게 하는 것이 이 화면의 전부인데 중간에 길이 끊기면 안 된다.
//
// ■ 왜 localStorage인가
//   화면 이동은 **같은 앱 안**에서 일어난다. "지금 이 창에서 내가 하던 일"이지 다른 기기와
//   나눌 상태가 아니므로 서버에 둘 이유가 없다(서버에 두면 여러 창·여러 사람 사이에서
//   누구의 '진행 중'인지 따지는 문제가 새로 생긴다).
//   ⚠ 앱을 강제 종료하면 이 값이 남을 수 있다 — 그래서 **오래된 것은 스스로 지운다**.
//      가이드 진행 자체는 서버에 저장되므로 이 값이 사라져도 잃는 것은 없다.
(function () {
  "use strict";
  if (window.gijoWorkNow) return; // 두 번 실리면 띠가 둘 뜬다
  var KEY = "gijo:mywork:active";
  var STALE_MS = 8 * 3600 * 1000; // 8시간 — 하루 업무를 넘기면 "진행 중"이 아니다

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!v || !v.id || !v.text) return null;
      if (!v.at || Date.now() - v.at > STALE_MS) { localStorage.removeItem(KEY); return null; }
      return v;
    } catch (e) { return null; }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function css() {
    if (document.getElementById("gijoWorkNowCss")) return;
    var s = document.createElement("style");
    s.id = "gijoWorkNowCss";
    s.textContent =
      "#gijoWorkNow{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9998;" +
      "display:flex;align-items:center;gap:11px;flex-wrap:wrap;max-width:min(720px,94vw);" +
      "background:rgba(18,26,46,.97);border:1px solid rgba(59,130,246,.45);border-radius:11px;" +
      "padding:9px 13px;font:500 12px/1.5 'Pretendard','Malgun Gothic','Segoe UI',sans-serif;" +
      "color:#e7eaf3;box-shadow:0 6px 24px rgba(0,0,0,.45)}" +
      "#gijoWorkNow b{color:#fff;font-weight:800}" +
      "#gijoWorkNow .wn-s{color:#1eb980;font-weight:800;white-space:nowrap}" +
      "#gijoWorkNow button{background:transparent;border:1px solid rgba(255,255,255,.18);border-radius:7px;" +
      "color:#8b93ab;font:700 11px/1 inherit;padding:6px 11px;cursor:pointer;white-space:nowrap}" +
      "#gijoWorkNow button.go{border-color:#3b82f6;color:#5fa1ff}" +
      "#gijoWorkNow .wn-x{border:none;color:#5f6785;padding:6px 4px;font-size:13px}";
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /**
   * 지금 담당자가 **보고 있는** 화면이 내 업무인가.
   *
   * ⚠ 자기 주소(location)만 보면 틀린다(2026-07-31 실측):
   *   · 탭 셸(app.html)은 자기 주소가 app.html이라, 내 업무 탭을 보고 있어도 띠를 띄웠다
   *     — "내 업무로 돌아가기"가 내 업무 화면 위에 떠서 대화창을 가렸다.
   *   · 숨은 탭(display:none인 iframe)도 자기 주소만 보고 띠를 그렸다 — 안 보이는 곳에
   *     DOM만 쌓인다.
   *   그래서 **셸이면 활성 탭을, 프레임이면 자기가 보이는지를** 본다.
   */
  function showHere() {
    // 셸 안 — 지금 열려 있는 탭이 내 업무면 띄우지 않는다.
    if (window.gijoTabs) {
      var on = document.querySelector("#screens iframe.on");
      var src = on ? (on.getAttribute("src") || "") : "";
      return src.indexOf("mywork.html") < 0;
    }
    // 프레임/단독 화면 — 자기가 내 업무면 안 띄우고, 화면에 안 보이면(숨은 탭) 그리지 않는다.
    if ((location.pathname || "").indexOf("mywork.html") >= 0) return false;
    try {
      if (window.frameElement && !window.frameElement.classList.contains("on")) return false;
    } catch (e) { /* 다른 출처 프레임이면 못 읽는다 — 그때는 그냥 띄운다 */ }
    return true;
  }

  function render() {
    var v = read();
    var el = document.getElementById("gijoWorkNow");
    if (!v || !showHere()) { if (el) el.remove(); return; }
    css();
    if (!el) {
      el = document.createElement("div");
      el.id = "gijoWorkNow";
      document.body.appendChild(el);
    }
    var 진행 = v.total ? v.step + " / " + v.total + "단계" : "";
    el.innerHTML =
      '<span>☑ 진행 중 — <b>' + esc(v.text) + "</b></span>" +
      (진행 ? '<span class="wn-s">' + esc(진행) + "</span>" : "") +
      '<span style="margin-left:auto;display:flex;gap:7px">' +
      '<button class="go" id="wnBack">내 업무로 돌아가기</button>' +
      '<button class="wn-x" id="wnHide" title="이 띠 숨기기">✕</button></span>';
    document.getElementById("wnBack").addEventListener("click", function () {
      // 셸이 있으면 탭으로, 없으면(분리창) 그 자리 이동. nav.js가 다리를 놓는다.
      if (window.gijoOpenScreen) window.gijoOpenScreen("mywork.html");
      else if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo("mywork.html");
    });
    document.getElementById("wnHide").addEventListener("click", function () {
      // 숨기면 그 업무는 더 이상 "진행 중"이 아니다 — 다시 뜨면 성가시다.
      clear(); render();
    });
  }

  window.gijoWorkNow = { render: render, clear: clear, read: read };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
  // 다른 탭(iframe)에서 값이 바뀌면 따라 갱신한다.
  window.addEventListener("storage", function (e) { if (e.key === KEY) render(); });
  // ⚠ 탭을 바꾸면 "보고 있는 화면"이 달라진다 — 셸에서는 그때마다 다시 판단해야 한다.
  //   (내 업무 탭으로 돌아왔는데 띠가 남아 있으면 대화창을 가린다.)
  if (window.gijoTabs) {
    var 화면들 = document.getElementById("screens");
    if (화면들 && window.MutationObserver) {
      new MutationObserver(function () { render(); })
        .observe(화면들, { attributes: true, attributeFilter: ["class"], subtree: true });
    }
  } else if (window.frameElement && window.MutationObserver) {
    // 탭 프레임 — 자기 iframe의 .on 이 붙고 떨어지는 것을 본다. 안 그러면 숨겨진 뒤에도
    // 띠가 남아 DOM만 쌓인다(2026-07-31 실측: 숨은 report.html에 띠가 남았다).
    try {
      new MutationObserver(function () { render(); })
        .observe(window.frameElement, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
  }
})();
