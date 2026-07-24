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
      "#gijoCmdTab{position:fixed;right:0;top:50%;transform:translateY(-50%);background:var(--blue,#3b82f6);color:#fff;padding:14px 6px;border-radius:10px 0 0 10px;font-size:12px;font-weight:800;cursor:pointer;writing-mode:vertical-rl;letter-spacing:2px;z-index:901;box-shadow:-2px 0 14px rgba(0,0,0,.45);}" +
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
      // 세션 영역이 패널 높이를 전부 쓴다 — 예전 지휘콘솔+세션 아코디언 시절의 max-height:180px가
      // 세션 전용 드로어에 남아 목록 하단이 잘렸다(2026-07-23 실측: 패널 900px에 목록 163px).
      // 세션 목록은 내용만큼(최대 55vh), 남는 세로 공간은 아래 🏢 사무실 LIVE가 채운다(대시보드 패널과 동일).
      ".gcp-sessions{flex:0 1 auto;min-height:0;max-height:55vh;}.gcp-sessions .gcp-ab{flex:0 1 auto;min-height:0;overflow-y:auto;max-height:55vh;}" +
      ".gcp-office{flex:1 1 auto;min-height:110px;border-top:1px solid var(--border,#1e2a44);display:flex;flex-direction:column;}" +
      ".gcp-oh{display:flex;align-items:center;gap:6px;padding:9px 12px 6px;font-size:11.5px;font-weight:800;color:#fff;cursor:pointer;}" +
      ".gcp-olive{font-size:8.5px;font-weight:800;color:var(--teal,#1eb980);border:1px solid rgba(30,185,128,.5);border-radius:8px;padding:1px 6px;}" +
      ".gcp-ofeed{flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 12px 10px;}" +
      ".gcp-oline{padding:4px 0;border-bottom:1px solid var(--border,#1e2a44);}" +
      ".gcp-owho{font-size:10px;font-weight:800;color:var(--blue-light,#7ab0ff);}" +
      ".gcp-omsg{display:block;font-size:11px;color:var(--muted,#8b93ab);margin-top:1px;line-height:1.45;word-break:break-word;}" +
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
      ".gcp-sitem:hover{background:rgba(255,255,255,.04);}" +
      // 대시보드 작업 세션 패널과 동일한 카드(상태 점·제목·✓완료·🗑삭제 / 날짜·주체·상태·턴수·미리보기).
      ".gcp-abadge{background:rgba(30,185,128,.15);color:var(--teal,#1eb980);border:1px solid rgba(30,185,128,.35);border-radius:20px;font-size:10.5px;font-weight:800;padding:3px 10px;white-space:nowrap;}" +
      ".gcp-abadge.zero{background:rgba(139,147,171,.12);color:var(--muted-2,#5f6b82);border-color:transparent;}" +
      ".gcp-scard{padding:7px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04);}" +
      ".gcp-scard:hover{background:rgba(255,255,255,.04);}" +
      ".gcp-sr1{display:flex;align-items:center;gap:6px;}" +
      ".gcp-sdot{width:6px;height:6px;border-radius:50%;background:var(--muted-2,#5f6b82);flex:0 0 auto;}" +
      ".gcp-scard.st-active .gcp-sdot{background:var(--teal,#1eb980);}" +
      ".gcp-scard.st-done .gcp-sdot{background:var(--muted-2,#5f6b82);}" +
      ".gcp-st{font-size:12px;font-weight:700;color:#fff;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".gcp-scard.st-done .gcp-st{color:var(--muted,#8b93ab);}" +
      ".gcp-sdone{flex:none;font-size:9.5px;font-weight:700;color:var(--teal,#1eb980);border:1px solid rgba(30,185,128,.4);border-radius:5px;padding:1px 5px;opacity:0;cursor:pointer;white-space:nowrap;}" +
      ".gcp-scard:hover .gcp-sdone{opacity:.9;}.gcp-sdone:hover{background:rgba(30,185,128,.15);}" +
      ".gcp-sdel{flex:none;font-size:11px;color:var(--muted-2,#5f6b82);opacity:0;cursor:pointer;padding:1px 4px;border-radius:5px;}" +
      ".gcp-scard:hover .gcp-sdel{opacity:.8;}.gcp-sdel:hover{opacity:1;color:#f5928a;background:rgba(226,72,61,.12);}" +
      ".gcp-sr2{font-size:10px;color:var(--muted-2,#5f6b82);margin:2px 0 0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".gcp-sfull{padding:9px 12px;border-top:1px solid var(--border,#1e2a44);font-size:11px;color:var(--blue-light,#7ab0ff);font-weight:700;cursor:pointer;text-align:center;flex:0 0 auto;}" +
      ".gcp-sfull:hover{background:var(--panel-2,#0e1526);}";
    document.head.appendChild(st);
  }

  var panel, tab, sessBody;

  function build() {
    injectCss();
    panel = document.createElement("div");
    panel.id = "gijoCmdPanel";
    panel.innerHTML =
      '<div class="gcp-head"><span class="gcp-title">💬 작업 세션</span>' +
      '<span class="gcp-abadge zero" id="gcpActive">진행중 -</span>' +
      '</div>' +
      '<div class="gcp-acc gcp-sessions" id="gcpSessAcc" style="flex:1 1 auto">' +
      '<div class="gcp-ab" style="display:flex"><div class="gcp-sitem" id="gcpNewSess">＋ 새 작업 세션</div>' +
      '<div id="gcpSessList" style="overflow-y:auto;flex:1 1 auto"><div class="gcp-empty">불러오는 중…</div></div></div></div>' +
      '<div class="gcp-sfull" id="gcpSessFull">전체 작업 세션 열기 ↗</div>' +
      // 남는 공간에 🏢 보안팀 사무실 LIVE 대화(협업 이벤트) — 대시보드 패널과 동일.
      '<div class="gcp-office" id="gcpOffice"><div class="gcp-oh" id="gcpOfficeHead" title="AI 팀 사무실 창 열기">🏢 보안팀 사무실 <span class="gcp-olive">LIVE</span></div>' +
      '<div class="gcp-ofeed" id="gcpOfficeFeed"><div class="gcp-empty">팀이 움직이면 대화가 여기 실시간으로 흐릅니다.</div></div></div>';
    document.body.appendChild(panel);

    tab = document.createElement("div");
    tab.id = "gijoCmdTab";
    tab.title = "오른쪽 작업 세션 열기";
    tab.textContent = "◀ 작업 세션 열기"; // 라벨·위치는 setOpen이 상태에 맞게 갱신
    document.body.appendChild(tab);

    sessBody = panel.querySelector("#gcpSessList");

    tab.addEventListener("click", function () { setOpen(!panel.classList.contains("on")); });
    // 헤더 접기 버튼 제거(2026-07-25) — 가장자리 탭이 토글 담당
    // ＋ 새 작업 세션 — 작업 세션 화면에서 새 세션을 시작하도록 이동(지시는 인라인 챗봇으로).
    panel.querySelector("#gcpNewSess").addEventListener("click", function () {
      try { localStorage.removeItem("gijo:sessions:open"); } catch (e) {}
      window.gijo.navigateTo("sessions.html");
    });
    // 전체 작업 세션 열기 — 세션 화면으로(대시보드 패널과 동일한 푸터).
    panel.querySelector("#gcpSessFull").addEventListener("click", function () { window.gijo.navigateTo("sessions.html"); });

    // 초기 상태 복원(기본 닫힘).
    var open = false; try { open = localStorage.getItem(OPEN_KEY) === "1"; } catch (e) {}
    setOpen(open);
    loadSessions();
    // 🏢 사무실 LIVE — 대시보드 패널과 동일하게 협업 대화를 실시간으로 흘린다.
    if (window.gijoRealtime && window.gijoRealtime.connect) window.gijoRealtime.connect(); // WS 보장(중복 연결은 가드됨)
    initOfficeLive();
  }

  // 🏢 보안팀 사무실 LIVE — 사무실 창의 캐릭터 말풍선과 같은 협업 이벤트를 이 피드에도 흘린다.
  var OFFICE_MAX = 40;
  function appendOfficeLive(evt) {
    var feed = document.getElementById("gcpOfficeFeed");
    if (!feed || !evt || !evt.message) return;
    var empty = feed.querySelector(".gcp-empty");
    if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
    var who = (evt.from || "팀") + (evt.to ? " → " + evt.to : "");
    var line = document.createElement("div");
    line.className = "gcp-oline";
    line.innerHTML = '<span class="gcp-owho">' + esc(who) + '</span><span class="gcp-omsg">' + esc(evt.message) + "</span>";
    feed.appendChild(line);
    while (feed.childElementCount > OFFICE_MAX) feed.removeChild(feed.firstChild);
    feed.scrollTop = feed.scrollHeight;
  }
  function initOfficeLive() {
    var head = document.getElementById("gcpOfficeHead");
    if (head && window.gijo.openTeamOffice) head.addEventListener("click", function () { window.gijo.openTeamOffice(); });
    if (window.gijo.onCollaborationEvent) window.gijo.onCollaborationEvent(appendOfficeLive);
    if (window.gijo.listCollaborationHistory) {
      window.gijo.listCollaborationHistory().then(function (hist) {
        (hist || []).slice(-OFFICE_MAX).forEach(appendOfficeLive);
      }).catch(function () {});
    }
  }

  function setOpen(on) {
    panel.classList.toggle("on", on);
    try { localStorage.setItem(OPEN_KEY, on ? "1" : "0"); } catch (e) {}
    // 가장자리 세로 탭 — 항상 표시(2026-07-25 통일): 열림=드로어 왼쪽 경계에 반쯤(12px) 걸친 '접기'.
    if (on) {
      var w = panel.getBoundingClientRect().width || 360;
      tab.style.right = Math.round(w - 12) + "px";
      tab.style.borderRadius = "10px"; tab.style.padding = "10px 5px"; tab.style.letterSpacing = "1px";
      tab.textContent = "▶ 접기"; tab.title = "작업 세션 패널 접기";
    } else {
      tab.style.right = "0px";
      tab.style.borderRadius = "10px 0 0 10px"; tab.style.padding = "14px 6px"; tab.style.letterSpacing = "2px";
      tab.textContent = "◀ 작업 세션 열기"; tab.title = "오른쪽 작업 세션 열기";
    }
  }
  window.addEventListener("resize", function () { setOpen(panel.classList.contains("on")); });

  // 대시보드 작업 세션 패널과 완전히 동일한 형식·동작(상태 점·제목·✓완료·🗑삭제 / 메타 + 진행중 배지).
  var STATUS_LABEL = { active: "진행중", done: "완료", ignored: "무시" };
  function openSessionPage(id) {
    try { localStorage.setItem("gijo:sessions:open", id); } catch (e) {}
    window.gijo.navigateTo("sessions.html");
  }
  async function completeSession(id) {
    try { await window.gijo.updateWorkSession(id, { status: "done" }); await loadSessions(); }
    catch (e) { /* 완료 실패는 조용히 — 다음 로드에서 상태 반영 */ }
  }
  async function deleteSession(id) {
    if (!window.confirm("이 세션과 대화를 삭제할까요? 되돌릴 수 없습니다.")) return;
    try { await window.gijo.deleteWorkSession(id); await loadSessions(); } catch (e) {}
  }
  async function loadSessions() {
    if (!sessBody) return;
    try {
      var list = await window.gijo.listWorkSessions();
      var badge = panel.querySelector("#gcpActive");
      if (badge) {
        var active = list.filter(function (s) { return s.status === "active"; }).length;
        badge.textContent = "진행중 " + active;
        badge.classList.toggle("zero", active === 0);
      }
      if (!list || !list.length) { sessBody.innerHTML = '<div class="gcp-empty">작업 세션이 없습니다.</div>'; return; }
      // 대시보드와 동일: 상태 점·제목·✓완료·🗑삭제 / 날짜·주체·상태·턴수·미리보기. 전체를 보여준다.
      sessBody.innerHTML = list.map(function (s) {
        var who = s.lastRole === "user" ? "나" : s.lastRole === "assistant" ? "AI 팀" : "—";
        var d = new Date(s.updatedAt);
        var when = (d.getMonth() + 1) + "." + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        var stL = s.status === "done" ? (s.doneBy === "auto" ? "자동완료" : "완료") : (STATUS_LABEL[s.status] || s.status);
        var prev = s.lastPreview ? " — " + esc(s.lastPreview) : "";
        var doneBtn = s.status !== "done" ? '<span class="gcp-sdone" data-done="' + esc(s.id) + '" title="세션 완료 — 리포트 자동 생성">✓ 완료</span>' : "";
        return '<div class="gcp-scard st-' + esc(s.status) + '" data-sid="' + esc(s.id) + '" title="작업 세션 열기">' +
          '<div class="gcp-sr1"><span class="gcp-sdot"></span><span class="gcp-st">' + esc(s.title || s.id) + "</span>" + doneBtn +
          '<span class="gcp-sdel" data-del="' + esc(s.id) + '" title="세션 삭제">🗑</span></div>' +
          '<div class="gcp-sr2">' + when + " · " + who + " · " + stL + " · " + (s.turnCount || 0) + "턴" + prev + "</div></div>";
      }).join("");
      sessBody.querySelectorAll("[data-sid]").forEach(function (el) {
        el.addEventListener("click", function (e) {
          if (e.target.closest(".gcp-sdel")) { e.stopPropagation(); deleteSession(el.getAttribute("data-sid")); return; }
          if (e.target.closest(".gcp-sdone")) { e.stopPropagation(); completeSession(el.getAttribute("data-sid")); return; }
          openSessionPage(el.getAttribute("data-sid"));
        });
      });
    } catch (e) { sessBody.innerHTML = '<div class="gcp-empty">세션을 불러오지 못했습니다.</div>'; }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
