// longnotice.js — "오래 걸려 리포트로 돌린 요청"이 끝나면 알려주는 팝업. 전 화면 공통.
//
// 사용자 요청(2026-07-26): 시간이 걸리는 작업은 "리포트로 작성해 드리겠습니다"라고 답하고,
// 끝나면 팝업으로 "요청하신 자료가 완성되어 리포트에 저장했습니다"라고 알려준다.
//
// 화면을 꺼두면(앱 종료) 알림을 놓치므로, 완료 여부는 서버가 들고 있다가 다음 접속 때 한 번 준다.
// 그래서 여기서는 주기적으로 물어보기만 하고, 띄운 뒤에는 서버에 "받았다"고 알려 중복을 막는다.
(function () {
  if (window.__gijoLongNotice) return;
  window.__gijoLongNotice = true;
  // 허브는 화면을 iframe으로 띄운다 — 맨 바깥 창에서만 알린다(같은 알림이 두 번 뜨지 않게).
  if (window.top !== window) return;

  var POLL_MS = 15000;
  // 화면에 동시에 띄우는 최대 개수. 넘으면 오래된 것부터 접는다 — 알림이 화면을 덮어
  // 그 아래를 못 누르게 되는 일을 막는다(놓쳐도 리포트 화면에 그대로 남는다).
  var MAX_NOTICES = 3;
  var seen = {}; // 이미 띄운 알림 id — ack가 실패해도 같은 것을 다시 띄우지 않는다
  var api = window.gijo;
  if (!api || typeof api.longAnswersPending !== "function") return; // 구버전 클라 호환

  function ensureStyle() {
    if (document.getElementById("gijoLnStyle")) return;
    var s = document.createElement("style");
    s.id = "gijoLnStyle";
    s.textContent =
      "#gijoLnWrap{position:fixed;right:18px;bottom:18px;z-index:4000;display:flex;flex-direction:column;gap:10px;}" +
      ".gijo-ln{width:330px;background:var(--panel,#30302e);border:1px solid var(--border-strong,rgba(255,255,255,.16));" +
      "border-left:3px solid var(--teal,#1eb980);border-radius:11px;padding:13px 14px;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.45);font-size:12.5px;color:var(--text,#e9e7e2);animation:gijoLnIn .22s ease-out;}" +
      ".gijo-ln.fail{border-left-color:var(--red,#e2483d);}" +
      "@keyframes gijoLnIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}" +
      ".gijo-ln .h{display:flex;align-items:center;gap:7px;font-weight:800;margin-bottom:5px;}" +
      ".gijo-ln .x{margin-left:auto;cursor:pointer;color:var(--muted,#b3ada4);font-weight:400;}" +
      ".gijo-ln .q{color:var(--muted,#b3ada4);font-size:12.5px;line-height:1.55;margin-bottom:9px;" +
      "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}" +
      ".gijo-ln .a{display:flex;gap:6px;}" +
      ".gijo-ln button{border-radius:7px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer;" +
      "border:1px solid var(--border-strong,rgba(255,255,255,.16));background:var(--panel-2,#1f1e1d);color:var(--text,#e9e7e2);}" +
      ".gijo-ln button.go{background:rgba(30,185,128,.16);border-color:#1eb980;color:#6ee7a0;}";
    document.head.appendChild(s);
  }

  function wrap() {
    var w = document.getElementById("gijoLnWrap");
    if (!w) {
      w = document.createElement("div");
      w.id = "gijoLnWrap";
      document.body.appendChild(w);
    }
    return w;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function show(n) {
    ensureStyle();
    var ok = n.status === "done";
    var el = document.createElement("div");
    el.className = "gijo-ln" + (ok ? "" : " fail");
    el.innerHTML =
      '<div class="h">' + (ok ? "📄 리포트에 저장했습니다" : "⚠ 작성하지 못했습니다") +
      '<span class="x" title="닫기">✕</span></div>' +
      '<div class="q">' + (ok ? "요청하신 자료가 완성되었습니다 — " : "") + esc(n.instruction) +
      (ok ? "" : "<br>" + esc(n.error || "알 수 없는 오류")) + "</div>" +
      '<div class="a">' + (ok ? '<button class="go">리포트 열어보기</button>' : "") +
      "<button>나중에</button></div>";

    el.querySelector(".x").addEventListener("click", function () { el.remove(); });
    el.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.classList.contains("go")) {
          try { localStorage.setItem("gijo:report:focus", n.reportBase || ""); } catch (e) {}
          if (api.navigateTo) api.navigateTo("report.html");
        }
        el.remove();
      });
    });
    var w = wrap();
    w.appendChild(el);
    // ⚠ 개수 상한 — 알림이 쌓이면 화면 오른쪽을 덮어 **그 아래 버튼을 못 누른다**.
    //   실측(2026-07-30): QA가 탭 셸 검사를 하다 클릭이 막혔다("gijoLnWrap subtree intercepts
    //   pointer events") — 담당자도 긴 작업을 몇 개 돌리면 똑같이 겪는다.
    //   놓친 알림은 리포트 화면에 그대로 남아 있으니, 화면을 가리면서까지 붙들 이유가 없다.
    while (w.children.length > MAX_NOTICES) w.removeChild(w.firstChild);
    // 성공은 한참 뒤 자동으로 접는다. 실패도 영영 두지 않는다 — 리포트 이력에 남아 있다.
    setTimeout(function () { el.remove(); }, ok ? 60000 : 600000);
  }

  async function poll() {
    try {
      var r = await api.longAnswersPending();
      var list = (r && r.notices) || [];
      for (var i = 0; i < list.length; i++) {
        // ⚠ **이미 보여준 것은 다시 띄우지 않는다.** ack(서버에 "봤다" 표시)가 실패하면 서버가
        //   같은 알림을 계속 내려주는데, 예전 코드는 그때마다 새 알림을 만들었다 — 폴링 주기마다
        //   하나씩 쌓여 화면이 알림으로 덮인다(2026-07-30 QA에서 클릭이 막혀 드러났다).
        //   ack는 "서버 정리"용이고, 화면에 띄울지는 이쪽이 판단한다.
        if (seen[list[i].id]) continue;
        seen[list[i].id] = true;
        show(list[i]);
        try { await api.longAnswerAck(list[i].id); } catch (e) { /* 다음 주기에 서버가 다시 준다 */ }
      }
    } catch (e) {
      /* 로그인 전·네트워크 오류는 조용히 넘긴다 — 다음 주기에 다시 본다 */
    }
  }

  setTimeout(poll, 2500); // 접속 직후 한 번(꺼져 있는 동안 끝난 게 있으면 여기서 받는다)
  setInterval(poll, POLL_MS);
})();
