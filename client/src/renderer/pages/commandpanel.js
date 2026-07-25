// commandpanel.js — 전 화면 공용 오른쪽 가장자리 메뉴(작업 세션·AI 라이브 오피스).
//
// v2(2026-07-26, 챗 중심 개편 후속·사용자 승인 시안 v5):
//  · 대시보드 포함 모든 화면에서 동일하게 — 가장자리 세로 탭 2개 + 크기 차등 팝업.
//    (대시보드 자체 구현을 없애고 이 파일 하나로 통일 — "대시보드에서 안 열림" 결함의 재발 방지)
//  · 작업 세션 = 소형 팝업(340px). 사무실 LIVE 채팅은 여기서 제거(사용자 결정) —
//    오피스 팝업(office.html)의 오른쪽 열로 이관.
//  · AI 라이브 오피스 = 중앙을 거의 덮는 대형 팝업(office.html?embed=1 iframe, 첫 열림에만 로드).
//  · 서로 배타적으로 열리고 ESC·✕·탭 재클릭으로 닫힌다. 기본은 항상 닫힘(상태 저장 안 함).

(function () {
  var here = decodeURIComponent((location.pathname || "").split("/").pop() || "");
  // 로그인·사무실 창 자체·임베드 프레임(허브 iframe 내부)에는 띄우지 않는다.
  if (here === "login.html" || here === "office.html" || here === "") return;
  if (/[?&]embed=1/.test(location.search || "")) return;
  if (!window.gijo || !window.gijo.isAuthenticated || !window.gijo.isAuthenticated()) return;
  if (document.getElementById("gijoEdgeRail")) return;

  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };

  function injectCss() {
    if (document.getElementById("gijoCmdCss")) return;
    var st = document.createElement("style");
    st.id = "gijoCmdCss";
    st.textContent =
      // 가장자리 세로 메뉴 — 화면 오른쪽 상단부터, 아이콘 없이 텍스트만(깔끔 원칙)
      "#gijoEdgeRail{position:fixed;right:18px;top:70px;display:flex;flex-direction:column;gap:10px;z-index:901;}" +
      ".gijo-etab{writing-mode:vertical-rl;letter-spacing:2px;font-size:11px;font-weight:800;color:var(--muted,#8b93ab);padding:13px 7px;border:1px solid var(--border,#1e2a44);border-radius:10px;cursor:pointer;background:var(--panel-2,#0e1526);user-select:none;box-shadow:-2px 0 10px rgba(0,0,0,.35);}" +
      ".gijo-etab:hover{color:var(--blue-light,#7ab0ff);border-color:var(--blue,#3b82f6);}" +
      ".gijo-etab.on{color:#fff;background:rgba(59,130,246,.22);border-color:rgba(59,130,246,.55);}" +
      ".gijo-etab b{writing-mode:horizontal-tb;font-size:9px;background:var(--blue,#3b82f6);color:#fff;border-radius:8px;padding:0 5px;margin-bottom:6px;}" +
      // 작업 세션 — 소형 팝업(중앙 위 오버레이)
      "#gijoCmdPanel{display:none;position:fixed;top:64px;right:62px;bottom:14px;width:340px;max-width:88vw;background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,#2a3a5e);border-radius:14px;z-index:900;flex-direction:column;box-shadow:-14px 0 44px rgba(0,0,0,.55);overflow:hidden;animation:gijoedgein .18s ease-out;}" +
      "#gijoCmdPanel.on{display:flex;}" +
      "@keyframes gijoedgein{from{transform:translateX(22px);opacity:0}to{transform:none;opacity:1}}" +
      // AI 라이브 오피스 — 대형 팝업(중앙을 거의 덮음, 크기 차등)
      "#gijoOfficePop{display:none;position:fixed;top:56px;left:246px;right:62px;bottom:14px;background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,#2a3a5e);border-radius:14px;z-index:900;flex-direction:column;box-shadow:0 18px 60px rgba(0,0,0,.6);overflow:hidden;animation:gijoedgein .18s ease-out;}" +
      "#gijoOfficePop.on{display:flex;}" +
      "body.gn-left-collapsed #gijoOfficePop{left:14px;}" + // 왼쪽 메뉴 접힘이면 전체 폭 사용
      ".gcp-oph{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--border,#1e2a44);font-weight:800;font-size:12.5px;color:#fff;flex:0 0 auto;}" +
      ".gcp-olive{font-size:9px;font-weight:800;color:#fff;background:#e2483d;border-radius:8px;padding:1px 7px;letter-spacing:1px;}" +
      ".gcp-opx{margin-left:auto;color:var(--muted-2,#5f6b82);cursor:pointer;font-size:14px;padding:2px 6px;}" +
      ".gcp-opx:hover{color:#fff;}" +
      "#gijoOfficeFrame{flex:1;border:none;width:100%;background:var(--bg,#0a0e1a);}" +
      // 세션 팝업 내부(기존 카드 형식 유지)
      ".gcp-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border,#1e2a44);background:var(--panel-3,#0c1322);flex:0 0 auto;}" +
      ".gcp-title{font-size:12px;font-weight:800;color:#fff;}" +
      ".gcp-abadge{background:rgba(30,185,128,.15);color:var(--teal,#1eb980);border:1px solid rgba(30,185,128,.35);border-radius:20px;font-size:10.5px;font-weight:800;padding:3px 10px;white-space:nowrap;}" +
      ".gcp-abadge.zero{background:rgba(139,147,171,.12);color:var(--muted-2,#5f6b82);border-color:transparent;}" +
      ".gcp-x{margin-left:auto;color:var(--muted-2,#5f6b82);cursor:pointer;font-size:13px;padding:2px 6px;}" +
      ".gcp-x:hover{color:#fff;}" +
      ".gcp-sitem{font-size:11.5px;color:var(--text,#e6edf7);padding:7px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid rgba(255,255,255,.03);flex:0 0 auto;}" +
      ".gcp-sitem:hover{background:rgba(255,255,255,.04);}" +
      "#gcpSessList{overflow-y:auto;flex:1 1 auto;min-height:0;}" +
      ".gcp-empty{font-size:11px;color:var(--muted-2,#5f6b82);padding:8px 12px;}" +
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

  var panel, officePop, tabSess, tabOffice, sessBody;

  function setPop(name) {
    panel.classList.toggle("on", name === "sess");
    officePop.classList.toggle("on", name === "office");
    tabSess.classList.toggle("on", name === "sess");
    tabOffice.classList.toggle("on", name === "office");
    if (name === "office") {
      var f = document.getElementById("gijoOfficeFrame");
      if (!f.src) f.src = "office.html?embed=1"; // 첫 열림에만 로드
    }
  }

  function build() {
    injectCss();
    // 세션 소형 팝업 — LIVE 채팅 없음(오피스로 이관, 2026-07-26 사용자 결정)
    panel = document.createElement("div");
    panel.id = "gijoCmdPanel";
    panel.innerHTML =
      '<div class="gcp-head"><span class="gcp-title">작업 세션</span>' +
      '<span class="gcp-abadge zero" id="gcpActive">진행중 -</span>' +
      '<span class="gcp-x" id="gcpClose" title="닫기">✕</span></div>' +
      '<div class="gcp-sitem" id="gcpNewSess">＋ 새 작업 세션</div>' +
      '<div id="gcpSessList"><div class="gcp-empty">불러오는 중…</div></div>' +
      '<div class="gcp-sfull" id="gcpSessFull">전체 작업 세션 열기 ↗</div>';
    document.body.appendChild(panel);

    // 오피스 대형 팝업 — 실내용은 office.html(할일 왼쪽·오피스 중앙·LIVE 채팅 오른쪽) 임베드
    officePop = document.createElement("div");
    officePop.id = "gijoOfficePop";
    officePop.innerHTML =
      '<div class="gcp-oph">AI 전용 라이브 오피스 <span class="gcp-olive">LIVE</span>' +
      '<span class="gcp-opx" id="gcpOfficeClose" title="닫기">✕</span></div>' +
      '<iframe id="gijoOfficeFrame" title="AI 전용 라이브 오피스"></iframe>';
    document.body.appendChild(officePop);

    // 가장자리 세로 메뉴(탭 2개)
    var rail = document.createElement("div");
    rail.id = "gijoEdgeRail";
    rail.innerHTML =
      '<div class="gijo-etab" id="gijoEdgeSess" title="작업 세션">작업 세션 <b id="gijoEdgeSessCnt">-</b></div>' +
      '<div class="gijo-etab" id="gijoEdgeOffice" title="AI 전용 라이브 오피스">AI 라이브 오피스</div>';
    document.body.appendChild(rail);

    tabSess = document.getElementById("gijoEdgeSess");
    tabOffice = document.getElementById("gijoEdgeOffice");
    sessBody = panel.querySelector("#gcpSessList");

    tabSess.addEventListener("click", function () { setPop(panel.classList.contains("on") ? null : "sess"); });
    tabOffice.addEventListener("click", function () { setPop(officePop.classList.contains("on") ? null : "office"); });
    document.getElementById("gcpClose").addEventListener("click", function () { setPop(null); });
    document.getElementById("gcpOfficeClose").addEventListener("click", function () { setPop(null); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setPop(null); });

    panel.querySelector("#gcpNewSess").addEventListener("click", function () {
      try { localStorage.removeItem("gijo:sessions:open"); } catch (e) {}
      window.gijo.navigateTo("sessions.html");
    });
    panel.querySelector("#gcpSessFull").addEventListener("click", function () { window.gijo.navigateTo("sessions.html"); });

    loadSessions();
    if (window.gijoRealtime && window.gijoRealtime.connect) window.gijoRealtime.connect(); // 오피스 iframe이 협업 이벤트를 받도록 WS 보장
  }

  // 세션 카드 — 대시보드 시절 패널과 동일한 형식·동작(상태 점·제목·✓완료·🗑삭제 / 메타).
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
      var active = list.filter(function (s) { return s.status === "active"; }).length;
      var badge = panel.querySelector("#gcpActive");
      if (badge) { badge.textContent = "진행중 " + active; badge.classList.toggle("zero", active === 0); }
      var cnt = document.getElementById("gijoEdgeSessCnt");
      if (cnt) cnt.textContent = String(active);
      if (!list || !list.length) { sessBody.innerHTML = '<div class="gcp-empty">작업 세션이 없습니다.</div>'; return; }
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
