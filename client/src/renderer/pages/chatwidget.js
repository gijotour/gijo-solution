// chatwidget.js — 화면별 "이 화면 챗봇" 플로팅 패널(시안 C 채택, 2026-07-21 배치 개편).
// 상단 인라인 박스(고정 420px 높이, 640px 폭)로 좁게 끼어 있던 것을 콘텐츠 위에 뜨는 확장형
// 패널로 변경 — 메뉴 진입 시 기본 펼쳐진 상태로 보이고, 응답이 길어도 스크롤 없이 넉넉하게
// 보이도록 높이를 키웠다. commandpanel.js(오른쪽 드로어, 수동 토글)와는 별개 위젯.
// 각 페이지는 컨테이너 하나 + 예시 질문만 지정하면 된다:
//   <div id="gijoChatWidget" data-prompts='["예시 질문1","예시 질문2"]'></div>
//   <script src="chatwidget.js"></script>
// 전송은 commandpanel.js와 동일하게 window.gijo.sendInstruction()으로 오케스트레이터에
// 보낸다 — 서버가 현재 화면(screen) 맥락을 자동으로 받아 해석한다.

(function () {
  var host = document.getElementById("gijoChatWidget");
  if (!host) return;
  if (!window.gijo || !window.gijo.isAuthenticated || !window.gijo.isAuthenticated()) return;

  var here = decodeURIComponent((location.pathname || "").split("/").pop() || "");
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var fmt = function (s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>"); };
  var sessionId = null;
  var prompts = [];
  try { prompts = JSON.parse(host.dataset.prompts || "[]"); } catch (e) {}
  // 모든 화면 공통: 화면별 사용 안내 질문을 맨 앞에 둔다(서버 screenguide가 그 화면 전용 답을 준다).
  prompts.unshift("이 화면에서 뭐 할 수 있어?");

  function injectCss() {
    if (document.getElementById("gijoChatWidgetCss")) return;
    var st = document.createElement("style");
    st.id = "gijoChatWidgetCss";
    st.textContent =
      ".gcw{position:fixed;right:24px;top:70px;bottom:auto;width:460px;max-width:92vw;height:620px;max-height:82vh;" +
      "background:var(--panel,#121a2e);border:1px solid rgba(139,124,240,.4);border-radius:14px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px;display:flex;flex-direction:column;box-sizing:border-box;z-index:700;transition:height .15s,width .15s;}" +
      ".gcw.collapsed{height:auto;width:auto;padding:0;}" +
      ".gcw-head{font-size:13.5px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;}" +
      ".gcw-head .gcw-title{display:flex;align-items:center;gap:6px;}" +
      ".gcw-toggle{cursor:pointer;font-size:11px;color:var(--muted,#8b93ab);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:20px;padding:3px 10px;flex-shrink:0;}" +
      ".gcw-toggle:hover{color:#fff;border-color:var(--blue,#3b82f6);}" +
      ".gcw.collapsed .gcw-head{background:var(--panel,#121a2e);border:1px solid rgba(139,124,240,.4);border-radius:24px;box-shadow:0 6px 18px rgba(0,0,0,.4);padding:2px;margin:0;}" +
      ".gcw.collapsed .gcw-title{display:none;}" +
      ".gcw.collapsed .gcw-toggle{border:0;padding:10px 18px;font-size:12px;font-weight:700;color:#fff;}" +
      ".gcw-body{display:flex;flex-direction:column;flex:1;min-height:0;}" +
      ".gcw.collapsed .gcw-body,.gcw.collapsed .gcw-sub{display:none;}" +
      ".gcw-sub{font-size:10.5px;color:var(--muted-2,#5f6785);margin-bottom:10px;}" +
      ".gcw-guide{background:var(--panel-2,#0e1526);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:11px;color:var(--muted,#8b93ab);line-height:1.7;flex-shrink:0;}" +
      ".gcw-chip{display:inline-block;background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,rgba(255,255,255,.16));color:var(--blue-light,#5fa1ff);font-size:10.5px;padding:4px 10px;border-radius:20px;margin:3px 4px 0 0;cursor:pointer;}" +
      ".gcw-chip:hover{background:var(--blue,#3b82f6);color:#fff;border-color:var(--blue,#3b82f6);}" +
      ".gcw-msgs{flex:1;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:9px;min-height:0;}" +
      ".gcw-empty{font-size:11px;color:var(--muted-2,#5f6785);}" +
      ".gcw-row{border-radius:9px;padding:9px 11px;font-size:11.5px;line-height:1.6;max-width:92%;word-break:break-word;}" +
      ".gcw-row.user{background:var(--blue,#3b82f6);color:#fff;margin-left:auto;}" +
      ".gcw-row.bot{background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,rgba(255,255,255,.16));}" +
      ".gcw-row.error{background:rgba(226,72,61,.12);border:1px solid rgba(226,72,61,.4);color:#f5928a;}" +
      ".gcw-dock{display:flex;gap:6px;margin-top:8px;flex-shrink:0;}" +
      ".gcw-dock input{flex:1;background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:8px;padding:9px 11px;color:var(--text,#e7eaf3);font-size:11.5px;outline:none;}" +
      ".gcw-dock button{background:var(--blue,#3b82f6);color:#fff;border:0;border-radius:8px;padding:0 14px;font-size:11.5px;font-weight:700;cursor:pointer;}" +
      // ⓘ 도움말 버튼(가독성 개편 2026-07-23) — 화면 상시 노출 설명을 걷어내고, 제목 옆 ⓘ를
      // 누르면 챗봇이 열리며 해당 구역 사용법을 즉답(서버 screenguide, LLM 비용 0)한다.
      ".gijo-info{width:17px;height:17px;border-radius:50%;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.45);" +
      "color:var(--blue-light,#5fa1ff);font-size:10.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;" +
      "cursor:pointer;vertical-align:middle;margin-left:6px;font-style:normal;flex:0 0 auto;}" +
      ".gijo-info:hover{background:var(--blue,#3b82f6);color:#fff;}";
    document.head.appendChild(st);
  }

  function build() {
    injectCss();
    host.removeAttribute("style");
    // 모든 화면에서 접힌 채 시작한다(사용자 방침 2026-07-22) — 우하단 "🤖 챗봇" 알약을 눌러 편다.
    // data-start="open"을 명시한 화면만 펼친 채 시작(현재는 없음).
    var startCollapsed = host.dataset.start !== "open";
    host.className = "gcw" + (startCollapsed ? " collapsed" : "");
    host.innerHTML =
      '<div class="gcw-head"><span class="gcw-title">🤖 이 화면 챗봇</span><span class="gcw-toggle" id="gcwToggle">' + (startCollapsed ? "🤖 챗봇" : "✕ 접기") + "</span></div>" +
      '<div class="gcw-body">' +
      '<div class="gcw-sub">이 화면 데이터에 실시간으로 접근 — 궁금한 걸 바로 물어보세요.</div>' +
      (prompts.length
        ? '<div class="gcw-guide">이 화면에서 할 수 있는 질문 예시<br>' + prompts.map(function (p) { return '<span class="gcw-chip">' + esc(p) + "</span>"; }).join("") + "</div>"
        : "") +
      '<div class="gcw-msgs" id="gcwMsgs"><div class="gcw-empty">물어보면 여기서 실시간으로 답합니다.</div></div>' +
      '<div class="gcw-dock"><input id="gcwIn" placeholder="이 화면에 대해 물어보세요…"><button id="gcwSend">전송</button></div>' +
      "</div>";

    var msgs = document.getElementById("gcwMsgs");
    var input = document.getElementById("gcwIn");
    var toggle = document.getElementById("gcwToggle");

    toggle.addEventListener("click", function () {
      var collapsed = host.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "🤖 챗봇" : "✕ 접기";
    });

    function appendRow(kind, html) {
      var em = msgs.querySelector(".gcw-empty"); if (em) em.remove();
      var row = document.createElement("div");
      row.className = "gcw-row " + (kind === "user" ? "user" : kind === "error" ? "error" : "bot");
      row.innerHTML = html;
      msgs.appendChild(row);
      msgs.scrollTop = msgs.scrollHeight;
      return row;
    }

    async function send(text) {
      text = (text || input.value).trim();
      if (!text) return;
      input.value = "";
      appendRow("user", esc(text));
      var typing = appendRow("bot", '처리 중… <span style="color:var(--muted-2,#5f6785);font-size:10.5px">첫 응답은 모델 준비로 다소 걸릴 수 있어요</span>');
      try {
        if (!sessionId) { try { var s = await window.gijo.createWorkSession(text.slice(0, 30), "screen:" + here); sessionId = s && s.id; } catch (e) {} }
        var r = await window.gijo.sendInstruction(text, sessionId || undefined);
        typing.innerHTML = fmt(r.output || "(응답 없음)");
      } catch (e) {
        typing.className = "gcw-row error";
        typing.innerHTML = "실패: " + esc((e && e.message) || e);
      }
    }

    document.getElementById("gcwSend").addEventListener("click", function () { send(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    host.querySelectorAll(".gcw-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { send(chip.textContent); });
    });

    // ⓘ → 챗봇 열고 해당 구역 사용법 질의. 페이지는 <i class="gijo-info" data-topic="SMTP">i</i>만 두면 된다.
    window.gijoExplain = function (topic) {
      host.classList.remove("collapsed");
      toggle.textContent = "✕ 접기";
      send(topic ? '"' + topic + '" 사용법 알려줘' : "이 화면 사용법 알려줘");
    };
    document.querySelectorAll(".gijo-info").forEach(function (el) {
      if (!el.textContent.trim()) el.textContent = "i";
      if (!el.title) el.title = (el.dataset.topic ? '"' + el.dataset.topic + '" ' : "이 화면 ") + "사용법을 챗봇이 설명합니다";
      el.addEventListener("click", function () { window.gijoExplain(el.dataset.topic); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
