// chatwidget.js — 화면별 "이 화면 챗봇" 인라인 패널(시안 C 채택, 2026-07-21).
// commandpanel.js(오른쪽 드로어)와 별개로, 챗봇 조회 도구가 있는 화면에서 항상 보이는 전용
// 패널로 둔다. 각 페이지는 컨테이너 하나 + 예시 질문만 지정하면 된다:
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

  function injectCss() {
    if (document.getElementById("gijoChatWidgetCss")) return;
    var st = document.createElement("style");
    st.id = "gijoChatWidgetCss";
    st.textContent =
      ".gcw{background:var(--panel,#121a2e);border:1px solid rgba(139,124,240,.3);border-radius:12px;padding:16px;display:flex;flex-direction:column;height:420px;box-sizing:border-box;width:100%;}" +
      ".gcw-head{font-size:13.5px;font-weight:800;color:#fff;display:flex;align-items:center;gap:6px;margin-bottom:4px;}" +
      ".gcw-sub{font-size:10.5px;color:var(--muted-2,#5f6785);margin-bottom:10px;}" +
      ".gcw-guide{background:var(--panel-2,#0e1526);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:11px;color:var(--muted,#8b93ab);line-height:1.7;}" +
      ".gcw-chip{display:inline-block;background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,rgba(255,255,255,.16));color:var(--blue-light,#5fa1ff);font-size:10.5px;padding:4px 10px;border-radius:20px;margin:3px 4px 0 0;cursor:pointer;}" +
      ".gcw-chip:hover{background:var(--blue,#3b82f6);color:#fff;border-color:var(--blue,#3b82f6);}" +
      ".gcw-msgs{flex:1;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:9px;}" +
      ".gcw-empty{font-size:11px;color:var(--muted-2,#5f6785);}" +
      ".gcw-row{border-radius:9px;padding:9px 11px;font-size:11.5px;line-height:1.6;max-width:92%;word-break:break-word;}" +
      ".gcw-row.user{background:var(--blue,#3b82f6);color:#fff;margin-left:auto;}" +
      ".gcw-row.bot{background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,rgba(255,255,255,.16));}" +
      ".gcw-row.error{background:rgba(226,72,61,.12);border:1px solid rgba(226,72,61,.4);color:#f5928a;}" +
      ".gcw-dock{display:flex;gap:6px;margin-top:8px;}" +
      ".gcw-dock input{flex:1;background:var(--panel-2,#0e1526);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:8px;padding:9px 11px;color:var(--text,#e7eaf3);font-size:11.5px;outline:none;}" +
      ".gcw-dock button{background:var(--blue,#3b82f6);color:#fff;border:0;border-radius:8px;padding:0 14px;font-size:11.5px;font-weight:700;cursor:pointer;}";
    document.head.appendChild(st);
  }

  function build() {
    injectCss();
    host.className = "gcw";
    host.innerHTML =
      '<div class="gcw-head">🤖 이 화면 챗봇</div>' +
      '<div class="gcw-sub">이 화면 데이터에 실시간으로 접근 — 궁금한 걸 바로 물어보세요.</div>' +
      (prompts.length
        ? '<div class="gcw-guide">이 화면에서 할 수 있는 질문 예시<br>' + prompts.map(function (p) { return '<span class="gcw-chip">' + esc(p) + "</span>"; }).join("") + "</div>"
        : "") +
      '<div class="gcw-msgs" id="gcwMsgs"><div class="gcw-empty">물어보면 여기서 실시간으로 답합니다.</div></div>' +
      '<div class="gcw-dock"><input id="gcwIn" placeholder="이 화면에 대해 물어보세요…"><button id="gcwSend">전송</button></div>';

    var msgs = document.getElementById("gcwMsgs");
    var input = document.getElementById("gcwIn");

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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
