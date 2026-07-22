// commandpanel.js — 전 페이지 공용 '오른쪽 작업 화면'(작업 세션 목록).
// 대시보드에는 자체 패널이 박혀 있으므로 그 외 페이지에만 nav.js가 주입한다. 페이지 레이아웃은
// 건드리지 않도록 고정(fixed) 슬라이드 드로어로 띄운다(기본 닫힘=가장자리 탭, 열면 오른쪽 오버레이).
//
// 2026-07-22: 지휘 콘솔(입력형 챗봇)을 제거했다. 화면마다 인라인 "🤖 이 화면 챗봇" 위젯이 생기면서
// 한 페이지에 챗봇이 둘이 되는 중복을 없앤다 — 오른쪽 드로어는 "작업 세션만" 보여준다(사용자 방침).
// AI에게 지시하려면 화면의 인라인 챗봇 위젯을 쓴다.

(function () {
  var here = decodeURIComponent((location.pathname || "").split("/").pop() || "");
  // 대시보드(자체 패널)·로그인·별도 창(사무실)에는 띄우지 않는다.
  if (here === "dashboard.html" || here === "login.html" || here === "office.html" || here === "") return;
  if (!window.gijo || !window.gijo.isAuthenticated || !window.gijo.isAuthenticated()) return;
  if (document.getElementById("gijoCmdPanel")) return;

  var OPEN_KEY = "gijo.cmdpanel.open";
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };

  function injectCss() {
    if (document.getElementById("gijoCmdCss")) return;
    var st = document.createElement("style");
    st.id = "gijoCmdCss";
    st.textContent =
      "#gijoCmdPanel{position:fixed;top:0;right:0;height:100vh;width:360px;max-width:92vw;background:var(--panel,#0f1626);border-left:1px solid var(--border,#1e2a44);z-index:900;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s ease;box-shadow:-8px 0 28px rgba(0,0,0,.45);}" +
      "#gijoCmdPanel.on{transform:translateX(0);}" +
      "#gijoCmdTab{position:fixed;right:0;top:50%;transform:translateY(-50%);background:var(--blue,#3b82f6);color:#fff;padding:14px 6px;border-radius:10px 0 0 10px;font-size:12px;font-weight:800;cursor:pointer;writing-mode:vertical-rl;letter-spacing:2px;z-index:899;box-shadow:-2px 0 14px rgba(0,0,0,.45);}" +
      "#gijoCmdTab.hide{display:none;}" +
      ".gcp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border,#1e2a44);background:var(--panel-3,#0c1322);flex:0 0 auto;}" +
      ".gcp-title{font-size:12px;font-weight:800;color:#fff;}" +
      ".gcp-close{margin-left:auto;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);color:var(--blue-light,#7ab0ff);font-size:11px;font-weight:700;border-radius:8px;padding:5px 10px;cursor:pointer;}" +
      ".gcp-close:hover{background:var(--blue,#3b82f6);color:#fff;}" +
      ".gcp-acc{display:flex;flex-direction:column;border-bottom:1px solid var(--border,#1e2a44);min-height:0;}" +
      ".gcp-ah{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;background:var(--panel-2,#121a2e);user-select:none;flex:0 0 auto;}" +
      ".gcp-ah:hover{background:#16213b;}" +
      ".gcp-car{color:var(--blue-light,#7ab0ff);font-size:11px;font-weight:900;width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.35);flex:0 0 auto;}" +
      ".gcp-at{font-size:12px;font-weight:800;color:#fff;}" +
      ".gcp-sessions{flex:0 0 auto;}.gcp-sessions .gcp-ab{max-height:180px;overflow-y:auto;}" +
      ".gcp-console{flex:1 1 auto;min-height:0;}" +
      ".gcp-ab{display:flex;flex-direction:column;min-height:0;overflow:hidden;}" +
      ".gcp-acc.collapsed .gcp-ab{display:none;}" +
      ".gcp-feed{flex:1 1 auto;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:7px;}" +
      ".gcp-empty{font-size:11px;color:var(--muted-2,#5f6b82);padding:6px;}" +
      ".gcp-row{font-size:12px;line-height:1.5;padding:7px 9px;border-radius:9px;background:var(--panel-2,#121a2e);border:1px solid var(--border,#1e2a44);word-break:break-word;}" +
      ".gcp-row.user{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.3);}" +
      ".gcp-row.error{background:rgba(226,72,61,.1);border-color:rgba(226,72,61,.4);color:#f5928a;}" +
      ".gcp-row.note{background:rgba(240,160,32,.1);border-color:rgba(240,160,32,.4);color:var(--amber,#f0a020);}" +
      ".gcp-row .gcp-who{font-size:10px;font-weight:800;color:var(--blue-light,#7ab0ff);margin-bottom:2px;}" +
      ".gcp-dock{display:flex;gap:7px;padding:10px 12px;border-top:1px solid var(--border,#1e2a44);background:var(--panel-2,#121a2e);flex:0 0 auto;}" +
      ".gcp-in{flex:1;background:var(--panel,#0f1626);border:1px solid var(--border-strong,#2a3a5e);border-radius:9px;padding:9px 11px;color:var(--text,#e6edf7);font-size:12px;outline:none;}" +
      ".gcp-in:focus{border-color:var(--blue,#3b82f6);}" +
      ".gcp-send{background:var(--blue,#3b82f6);color:#fff;border:none;border-radius:9px;padding:0 15px;font-weight:800;font-size:12px;cursor:pointer;}" +
      ".gcp-sitem{font-size:11.5px;color:var(--text,#e6edf7);padding:6px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid rgba(255,255,255,.03);}" +
      ".gcp-sitem:hover{background:rgba(255,255,255,.04);}";
    document.head.appendChild(st);
  }

  var panel, tab, sessBody;

  function build() {
    injectCss();
    panel = document.createElement("div");
    panel.id = "gijoCmdPanel";
    panel.innerHTML =
      '<div class="gcp-head"><span class="gcp-title">🗂 작업 세션</span>' +
      '<button class="gcp-close" id="gcpClose" title="작업 세션 닫기">◧ 접기</button></div>' +
      '<div class="gcp-acc gcp-sessions" id="gcpSessAcc" style="flex:1 1 auto">' +
      '<div class="gcp-ab" style="display:flex"><div class="gcp-sitem" id="gcpNewSess">＋ 새 작업 세션</div>' +
      '<div id="gcpSessList" style="overflow-y:auto;flex:1 1 auto"><div class="gcp-empty">불러오는 중…</div></div></div></div>';
    document.body.appendChild(panel);

    tab = document.createElement("div");
    tab.id = "gijoCmdTab";
    tab.title = "오른쪽 작업 세션 열기";
    tab.textContent = "◧ 작업 세션";
    document.body.appendChild(tab);

    sessBody = panel.querySelector("#gcpSessList");

    tab.addEventListener("click", function () { setOpen(true); });
    panel.querySelector("#gcpClose").addEventListener("click", function () { setOpen(false); });
    // ＋ 새 작업 세션 — 작업 세션 화면에서 새 세션을 시작하도록 이동(지시는 인라인 챗봇으로).
    panel.querySelector("#gcpNewSess").addEventListener("click", function () {
      try { localStorage.removeItem("gijo:sessions:open"); } catch (e) {}
      window.gijo.navigateTo("sessions.html");
    });

    // 초기 상태 복원(기본 닫힘).
    var open = false; try { open = localStorage.getItem(OPEN_KEY) === "1"; } catch (e) {}
    setOpen(open);
    loadSessions();
  }

  function setOpen(on) {
    panel.classList.toggle("on", on);
    tab.classList.toggle("hide", on);
    try { localStorage.setItem(OPEN_KEY, on ? "1" : "0"); } catch (e) {}
  }

  async function loadSessions() {
    if (!sessBody) return;
    try {
      var list = await window.gijo.listWorkSessions();
      if (!list || !list.length) { sessBody.innerHTML = '<div class="gcp-empty">작업 세션이 없습니다.</div>'; return; }
      sessBody.innerHTML = list.slice(0, 20).map(function (s) {
        return '<div class="gcp-sitem" data-sid="' + esc(s.id) + '" title="작업 세션 열기">🗂 ' + esc(s.title || s.id) + "</div>";
      }).join("");
      sessBody.querySelectorAll("[data-sid]").forEach(function (el) {
        el.addEventListener("click", function () {
          try { localStorage.setItem("gijo:sessions:open", el.getAttribute("data-sid")); } catch (e) {}
          window.gijo.navigateTo("sessions.html");
        });
      });
    } catch (e) { sessBody.innerHTML = '<div class="gcp-empty">세션을 불러오지 못했습니다.</div>'; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
