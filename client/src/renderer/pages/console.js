// console.js — 대화 콘솔(4.0.0). **한 파일, 두 자리.**
//   · 도킹  — 앱 탭 셸(app.html)의 #consoleHost 안
//   · 창    — console.html(별도 OS 창). 모니터가 여럿일 때 화면을 100%로 쓰려고 빼낸다.
//
// 왜 셸/창에 두나: 여태 콘솔이 대시보드 안에 있어서, 화면을 옮기면 대화가 리로드로 날아갔다.
// 그래서 "이동하지 않는" 팝업이 필요했던 것이다. 콘솔을 화면 바깥(셸·별도 창)에 두면
// 탭을 아무리 옮겨도 대화가 안 끊긴다 — 팝업이 존재하던 이유 자체가 없어진다.
//
// 맥락(지시 대상): 보고 있는 탭 하나가 곧 맥락이다.
//   · 도킹이면 window.gijoTabs에서 직접 읽고
//   · 창이면 셸이 메인 프로세스를 거쳐 알려준다(gijo.onConsoleContext).
(function () {
  "use strict";
  var host = document.getElementById("consoleHost");
  if (!host) return;
  var IS_WINDOW = host.dataset.mode === "window"; // console.html이 세워 둔 표시

  var DRAFT_KEY = "gijo:console:draft";
  var SESS_KEY = "gijo:console:session";
  var CL_MAX = 40;           // 대화가 길어지면 오래된 줄부터 덜어낸다(메모리)
  var CLAMP_LEN = 140;       // 이보다 길면 접어 두고 '더보기'
  // 속성 자리(value="...")에도 들어가는 값이라 따옴표까지 걸러야 한다(2026-07-29 검토 #4 — 파일명 유래 값 주입 여지).
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };

  var ctx = { screen: null, label: null };
  var session = null;
  try { session = JSON.parse(localStorage.getItem(SESS_KEY) || "null"); } catch (e) {}

  // ── 겉모습 ────────────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById("gijoConsoleCss")) return;
    var st = document.createElement("style");
    st.id = "gijoConsoleCss";
    st.textContent = [
      "#consoleHost{display:flex;flex-direction:column;min-height:0;height:100%;background:var(--panel-2,#0e1526);}",
      ".cs-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:11px;color:var(--muted,#8b93ab);border-bottom:1px solid rgba(255,255,255,.05);}",
      ".cs-ctx{background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);color:var(--blue-light,#5fa1ff);border-radius:14px;padding:2px 10px;font-weight:800;white-space:nowrap;}",
      ".cs-hint{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}",
      ".cs-btn{flex:0 0 auto;font-size:11px;font-weight:700;color:var(--muted,#8b93ab);background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:3px 9px;cursor:pointer;white-space:nowrap;}",
      ".cs-btn:hover{color:#fff;border-color:var(--blue,#3b82f6);}",
      ".cs-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px;}",
      ".cs-empty{color:var(--muted-2,#5f6785);font-size:12px;padding:10px 0;}",
      ".cs-row{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.03);}",
      ".cs-row .ci{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:rgba(59,130,246,.16);display:flex;align-items:center;justify-content:center;font-size:11px;}",
      ".cs-row.instr .ci{background:rgba(30,185,128,.16);}",
      ".cs-row.error .ci{background:rgba(226,72,61,.18);}",
      ".cs-row .cb{flex:1;min-width:0;}",
      ".cs-row .cn{font-size:10.5px;font-weight:800;color:var(--muted,#8b93ab);margin-bottom:2px;}",
      ".cs-row .cn .ct{font-weight:500;color:var(--muted-2,#5f6785);margin-left:6px;}",
      ".cs-row .cm{font-size:12.5px;color:var(--text,#e7eaf3);white-space:pre-wrap;word-break:break-word;line-height:1.62;}",
      ".cs-row .cm.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;}",
      ".cs-row .cl-more{font-size:10.5px;font-weight:700;color:var(--blue-light,#5fa1ff);cursor:pointer;}",
      // 「이 답 이상해요」 지적(중-1) — 평소엔 숨고 마우스를 올리거나 키보드로 짚으면 드러난다.
      // 호버만으로 드러내면 키보드 사용자가 못 쓴다(탭 닫기 ✕와 같은 방식).
      ".cs-row .cs-flag{display:none;margin-top:4px;font-size:10px;font-weight:700;color:var(--muted-2,#5f6785);background:none;border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:2px 8px;cursor:pointer;min-height:24px;}",
      ".cs-row:hover .cs-flag,.cs-row .cs-flag:focus-visible{display:inline-block;}",
      ".cs-row .cs-flag:hover,.cs-row .cs-flag:focus-visible{color:var(--amber,#f59e0b);border-color:rgba(245,158,11,.45);}",
      ".cs-row .cs-flag.done{display:inline-block;color:var(--teal,#1eb980);border-color:rgba(30,185,128,.4);cursor:default;}",
      ".cs-row.error .cm{color:#f5928a;}",
      ".cs-typing span{display:inline-block;width:5px;height:5px;margin-right:3px;border-radius:50%;background:var(--muted,#8b93ab);animation:csb 1s infinite;}",
      ".cs-typing span:nth-child(2){animation-delay:.15s}.cs-typing span:nth-child(3){animation-delay:.3s}",
      "@keyframes csb{0%,60%,100%{opacity:.25}30%{opacity:1}}",
      ".cs-dock{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 14px 12px;}",
      ".cs-dock input{flex:1;background:var(--panel,#121a2e);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:11px;color:var(--text,#e7eaf3);font-size:13px;padding:11px 14px;outline:none;font-family:inherit;}",
      ".cs-dock input:focus{border-color:var(--blue,#3b82f6);}",
      // ＋ 파일 올리기 — 인입 창구는 여기 하나다(2026-07-27 결정: "파일은 ＋ 한 곳으로").
      ".cs-plus{flex:0 0 auto;width:38px;height:38px;border-radius:11px;background:var(--panel,#121a2e);color:var(--muted,#8b93ab);",
      "border:1px solid var(--border-strong,rgba(255,255,255,.16));font-size:17px;line-height:1;cursor:pointer;}",
      ".cs-plus:hover{color:#fff;border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.12);}",
      ".cs-updec{margin-top:6px;}",
      ".cs-updec .h{font-size:12px;font-weight:800;color:#fff;margin-bottom:3px;}",
      ".cs-updec .f{font-size:11px;color:var(--muted-2,#5f6785);margin-bottom:7px;}",
      ".cs-updec .btns{display:flex;gap:5px;flex-wrap:wrap;}",
      ".cs-updec button{background:var(--panel,#121a2e);border:1px solid var(--border-strong,rgba(255,255,255,.16));color:#dfe6ff;",
      "border-radius:8px;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer;}",
      ".cs-updec button:hover{border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.14);}",
      ".cs-updec button.reco{border-color:var(--teal,#1eb980);color:#bff3de;}",
      ".cs-updec input.pn{width:100%;margin-bottom:7px;background:var(--panel,#121a2e);border:1px solid var(--border-strong,rgba(255,255,255,.16));",
      "border-radius:8px;color:var(--text,#e7eaf3);font-size:12px;padding:7px 9px;outline:none;font-family:inherit;}",
      ".cs-send{background:var(--blue,#3b82f6);color:#fff;border:none;border-radius:11px;font-size:12.5px;font-weight:800;padding:11px 18px;cursor:pointer;}",
      ".cs-send:hover{background:#2f6fd0;}",
      ".cs-send[disabled]{opacity:.5;cursor:default;}",
    ].join("");
    document.head.appendChild(st);
  }

  function build() {
    injectCss();
    host.innerHTML =
      '<div class="cs-head">' +
        '<span class="cs-ctx" id="csCtx">대시보드</span>' +
        '<span class="cs-hint" id="csHint">보고 있는 화면 기준으로 지시합니다</span>' +
        '<button class="cs-btn" id="csToggleHost" title="' +
          (IS_WINDOW ? "이 창을 닫고 앱 아래에 다시 붙입니다" : "대화를 별도 창으로 빼냅니다 — 화면을 100%로 쓸 때") + '">' +
          (IS_WINDOW ? "⇤ 앱에 붙이기" : "⧉ 창으로") + "</button>" +
      "</div>" +
      '<div class="cs-body" id="csBody"><div class="cs-empty">지시하면 여기서 실시간으로 흐릅니다.</div></div>' +
      '<div class="cs-dock">' +
        '<button class="cs-plus" id="dockUpload" title="파일 올리기 — 자동 분류(취약점·매뉴얼·문서). 애매하면 유형을 물어봅니다">＋</button>' +
        '<input id="chatInput" placeholder="지시를 입력하세요…" aria-label="지시를 입력하세요">' +
        '<button class="cs-send" id="dockSend">전송</button>' +
      "</div>" +
      '<input type="file" id="csUploadInput" multiple style="display:none">';

    var input = document.getElementById("chatInput");
    document.getElementById("dockSend").addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
    // 초안은 저장한다 — 콘솔을 창으로 빼거나 붙일 때 쓰던 글이 날아가면 안 된다.
    try { var d = localStorage.getItem(DRAFT_KEY); if (d) input.value = d; } catch (e) {}
    input.addEventListener("input", function () { try { localStorage.setItem(DRAFT_KEY, input.value); } catch (e) {} });

    wireUpload();

    document.getElementById("csToggleHost").addEventListener("click", function () {
      if (!window.gijo) return;
      if (IS_WINDOW) window.gijo.dockConsoleWindow();
      else {
        try { localStorage.setItem("gijo:console:popped", "1"); } catch (e) {}
        window.gijo.openConsoleWindow();
        if (window.gijoConsoleHidden) window.gijoConsoleHidden(true); // 셸이 도킹 자리를 접는다
      }
    });
  }

  // ── 「이 답 이상해요」 지적 (계획서 중-1) ─────────────────────────────
  // 회귀 문항은 전부 우리가 상상한 질문이라, 실사용자가 겪는 오답은 거기 없다.
  // 담당자의 지적 한 줄이 문항 하나보다 값지다 — 그래서 답변 옆에서 바로 남길 수 있게 한다.
  //
  // ⚠ 카드는 **화면 기준으로 띄운다**(position:fixed, document.body에 붙임).
  //   대시보드에 붙은 콘솔은 대화 영역이 90px 남짓이라(콘솔 전체 190px 고정) 말풍선 안에
  //   넣으면 스크롤 컨테이너에 잘려 보이지 않는다. 아래가 좁으면 위로 뒤집는다.
  var FLAG_KINDS = [
    { k: "wrong", label: "❌ 틀린 답", hint: "사실이 틀림" },
    { k: "missing", label: "🔍 못 찾음", hint: "있는데 못 찾아 답함" },
    { k: "style", label: "💬 말투", hint: "말투·형식이 어색함" },
  ];
  var flagCard = null;
  function closeFlagCard() { if (flagCard) { flagCard.remove(); flagCard = null; } }

  function openFlagCard(btn, question, answer) {
    closeFlagCard();
    var c = document.createElement("div");
    c.style.cssText =
      "position:fixed;z-index:9999;width:300px;max-width:calc(100vw - 24px);background:var(--panel,#151922);" +
      "border:1px solid var(--border-strong,#2a3040);border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.55);padding:12px 13px;";
    c.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:9px">' +
      '<div style="flex:1;min-width:0;font-size:10.5px;color:var(--muted-2,#5f6785);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      esc(String(answer).slice(0, 40)) + "…</div>" +
      '<span id="fbX" role="button" tabindex="0" style="cursor:pointer;color:var(--muted,#8b93ab);font-size:13px;line-height:1">✕</span></div>' +
      '<div id="fbKinds" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"></div>' +
      '<div id="fbHint" style="font-size:10px;color:var(--muted-2,#5f6785);margin-bottom:9px;min-height:13px"></div>' +
      '<textarea id="fbNote" rows="2" placeholder="무엇이 틀렸나요? (선택)" style="width:100%;box-sizing:border-box;background:var(--panel-2,#11151d);border:1px solid var(--border,#222836);border-radius:7px;padding:7px 9px;color:var(--text,#e7eaf3);font-size:11.5px;resize:vertical;margin-bottom:7px"></textarea>' +
      '<textarea id="fbExp" rows="2" placeholder="혹시 정답을 아신다면 (선택)" style="width:100%;box-sizing:border-box;background:var(--panel-2,#11151d);border:1px solid var(--border,#222836);border-radius:7px;padding:7px 9px;color:var(--text,#e7eaf3);font-size:11.5px;resize:vertical"></textarea>' +
      '<div style="font-size:9.5px;color:var(--muted-2,#5f6785);margin:5px 0 10px">적어 주시면 앞으로 이 질문을 검사 문항으로 씁니다.</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:7px">' +
      '<button id="fbCancel" style="background:none;border:1px solid var(--border,#222836);border-radius:7px;padding:5px 12px;color:var(--muted,#8b93ab);font-size:11.5px;cursor:pointer">취소</button>' +
      '<button id="fbSend" style="background:var(--blue,#3b82f6);border:none;border-radius:7px;padding:5px 14px;color:#fff;font-size:11.5px;font-weight:700;cursor:pointer">전송</button></div>';
    document.body.appendChild(c);
    flagCard = c;

    var picked = "wrong";
    var kinds = c.querySelector("#fbKinds"), hint = c.querySelector("#fbHint");
    FLAG_KINDS.forEach(function (k) {
      var b = document.createElement("button");
      b.textContent = k.label;
      b.style.cssText = "background:none;border:1px solid var(--border,#222836);border-radius:999px;padding:4px 10px;color:var(--text,#e7eaf3);font-size:11px;cursor:pointer;min-height:24px;";
      b.onclick = function () {
        picked = k.k;
        hint.textContent = k.hint;
        [].forEach.call(kinds.children, function (x) { x.style.borderColor = "var(--border,#222836)"; x.style.color = "var(--text,#e7eaf3)"; });
        b.style.borderColor = "var(--amber,#f59e0b)"; b.style.color = "var(--amber,#f59e0b)";
      };
      kinds.appendChild(b);
      if (k.k === "wrong") b.onclick();
    });

    // 위치 — 버튼 아래에 붙이되 아래가 좁으면 위로 뒤집는다(도킹 콘솔은 아래 공간이 거의 없다).
    var r = btn.getBoundingClientRect();
    var h = c.offsetHeight || 300;
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    c.style.top = top + "px";
    c.style.left = Math.max(8, Math.min(r.left, window.innerWidth - c.offsetWidth - 8)) + "px";

    var esc2 = function (ev) { if (ev.key === "Escape") { closeFlagCard(); document.removeEventListener("keydown", esc2); } };
    document.addEventListener("keydown", esc2);
    var outside = function (ev) { if (flagCard && !flagCard.contains(ev.target) && ev.target !== btn) { closeFlagCard(); document.removeEventListener("mousedown", outside); } };
    setTimeout(function () { document.addEventListener("mousedown", outside); }, 0);

    c.querySelector("#fbX").onclick = closeFlagCard;
    c.querySelector("#fbCancel").onclick = closeFlagCard;
    c.querySelector("#fbSend").onclick = async function () {
      var note = c.querySelector("#fbNote").value.trim();
      var exp = c.querySelector("#fbExp").value.trim();
      try {
        await window.gijo.sendAnswerFeedback({
          kind: picked, question: question, answer: answer,
          note: note || undefined, expected: exp || undefined, screen: ctx.screen || undefined,
        });
        closeFlagCard();
        btn.textContent = "✓ 지적 접수됨";
        btn.className = "cs-flag done";
        btn.disabled = true;
        // 과한 기대를 만들지 않는다 — 자동 반영이 아니라 사람이 검토한다.
        append("event", { icon: "📝", name: "지적 접수", message: "접수했습니다. 사람이 검토 후 검사 문항으로 씁니다(자동 반영 아님)." });
      } catch (e) {
        hint.textContent = "보내지 못했습니다: " + ((e && e.message) || e);
        hint.style.color = "#f5928a";
      }
    };
  }

  // 답변 줄에 지적 버튼을 단다. 질문(직전 지시)과 답을 짝지어 보내야 문항이 될 수 있다.
  function attachFlag(el, question, answer) {
    if (!question) return; // 무엇에 대한 지적인지 모르면 남길 수 없다
    var b = document.createElement("button");
    b.className = "cs-flag";
    b.type = "button";
    b.textContent = "▶ 이 답 이상해요";
    b.onclick = function () { openFlagCard(b, question, answer); };
    var cb = el.querySelector(".cb");
    if (cb) cb.appendChild(b);
  }

  // ── 대화 줄 ───────────────────────────────────────────────────────────
  function rows() { return document.getElementById("csBody"); }
  function append(kind, o) {
    var body = rows();
    var empty = body.querySelector(".cs-empty");
    if (empty) empty.remove();
    var el = document.createElement("div");
    el.className = "cs-row " + kind;
    var time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    var msg = String(o.message == null ? "" : o.message);
    var long = (kind === "reply" || kind === "event") && msg.length > CLAMP_LEN;
    var bodyHtml = kind === "typing"
      ? '<span class="cm cs-typing"><span></span><span></span><span></span></span>'
      : '<div class="cm' + (long ? " clamp" : "") + '">' + esc(msg) + "</div>" + (long ? '<span class="cl-more">더보기 ▾</span>' : "");
    el.innerHTML = '<div class="ci">' + (o.icon || "◆") + "</div>" +
      '<div class="cb"><div class="cn">' + esc(o.name) + '<span class="ct">' + time + "</span></div>" + bodyHtml + "</div>";
    if (long) {
      var cm = el.querySelector(".cm"), more = el.querySelector(".cl-more");
      var toggle = function () { more.textContent = cm.classList.toggle("clamp") ? "더보기 ▾" : "접기 ▴"; };
      cm.addEventListener("click", toggle); more.addEventListener("click", toggle);
    }
    body.appendChild(el);
    while (body.childElementCount > CL_MAX) body.removeChild(body.firstChild);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function replaceTyping(el, kind, o) {
    if (!el || !el.parentNode) return append(kind, o);
    var next = append(kind, o);
    el.parentNode.insertBefore(next, el);
    el.remove();
    rows().scrollTop = rows().scrollHeight;
    return next;
  }

  // ── 맥락 ──────────────────────────────────────────────────────────────
  function applyCtx() {
    var chip = document.getElementById("csCtx");
    var input = document.getElementById("chatInput");
    if (!chip || !input) return;
    chip.textContent = ctx.label || "대시보드";
    input.placeholder = ctx.label ? "「" + ctx.label + "」 화면에 대해 지시…" : "지시를 입력하세요…";
  }
  function readCtxFromShell() {
    if (IS_WINDOW || !window.gijoTabs) return;
    ctx = { screen: window.gijoTabs.activeScreen(), label: window.gijoTabs.activeLabel() };
    applyCtx();
  }

  // ── 전송 ──────────────────────────────────────────────────────────────
  var sending = false;
  async function submit() {
    var input = document.getElementById("chatInput");
    var text = (input.value || "").trim();
    if (!text || sending) return;
    input.value = "";
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    sending = true;
    document.getElementById("dockSend").disabled = true;
    append("instr", { icon: "나", name: "나 → AI 팀", message: text });
    var typing = append("typing", { icon: "🧭", name: "오케스트레이터" });
    try {
      // 맥락(screen)을 함께 보낸다 — "정리해줘"가 취약점 화면 앞에서는 취약점 정리로 해석된다
      // (server/engine/screencontext.ts). 보고 있는 탭이 곧 그 맥락이다.
      var r = await window.gijo.sendInstruction(text, session ? session.id : undefined, ctx.screen || undefined);
      if (r && r.sessionId) {
        session = { id: r.sessionId };
        try { localStorage.setItem(SESS_KEY, JSON.stringify(session)); } catch (e) {}
      }
      var replyEl = replaceTyping(typing, "reply", { icon: "🧭", name: "AI 팀", message: (r && r.output) || "(응답 없음)" });
      // 지적 버튼 — 방금 보낸 질문과 이 답을 짝지어 둔다(중-1 피드백 루프).
      attachFlag(replyEl, text, (r && r.output) || "");
    } catch (e) {
      replaceTyping(typing, "error", { icon: "⚠", name: "오류", message: (e && e.message) || String(e) });
    } finally {
      sending = false;
      document.getElementById("dockSend").disabled = false;
    }
  }

  // ── 이어보기 — 이전 대화를 서버 세션에서 복원한다(콘솔을 옮겨도 이어진다) ──
  async function restore() {
    if (!session || !session.id || !window.gijo || !window.gijo.getWorkSession) return;
    try {
      var r = await window.gijo.getWorkSession(session.id);
      var turns = (r && r.turns) || [];
      if (!turns.length) return;
      turns.slice(-12).forEach(function (m) {
        append(m.role === "user" ? "instr" : "reply",
          { icon: m.role === "user" ? "나" : "🧭", name: m.role === "user" ? "나 → AI 팀" : "AI 팀", message: m.content });
      });
    } catch (e) { /* 못 불러와도 새 대화는 된다 — 세션이 지워졌을 수 있다 */ }
  }

  function boot() {
    if (!window.gijo || !window.gijo.isAuthenticated || !window.gijo.isAuthenticated()) return;
    build();
    if (IS_WINDOW) {
      // 창 모드 — 셸이 알려주는 활성 탭이 맥락이다.
      if (window.gijo.onConsoleContext) window.gijo.onConsoleContext(function (i) { ctx = { screen: i.screen, label: i.label }; applyCtx(); });
    } else {
      readCtxFromShell();
      window.gijoConsoleSyncCtx = readCtxFromShell; // 셸이 탭을 바꿀 때 부른다
    }
    applyCtx();
    restore();
  }

  // ── ＋ 파일 올리기 ────────────────────────────────────────────────────
  // 인입 창구는 콘솔 ＋ 하나다(2026-07-27 "파일은 ＋ 한 곳으로" 결정). 대시보드에 있던 것을
  // 콘솔이 셸로 나오면서 함께 옮겼다 — 안 옮기면 올릴 자리가 사라진다(2026-07-28 사용자 지적).
  var UPLOAD_TYPES = [
    { t: "vulnreport", label: "🩹 취약점 리포트/로그" },
    { t: "asset", label: "🛡 보안제품 자산" },
    { t: "log", label: "📊 로그 매뉴얼" },
    { t: "document", label: "📄 일반 문서" },
    { t: "guideline", label: "📘 가이드라인" },
  ];
  // 신규 제품으로 등록되는 유형에서만 제품명을 묻는다(추천값을 채워 두고 고칠 수 있게).
  var PRODUCT_NAME_TYPES = { asset: 1, log: 1 };

  function readB64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(",")[1]); };
      fr.onerror = function () { reject(new Error("파일을 읽지 못했습니다")); };
      fr.readAsDataURL(file);
    });
  }
  function uploadResultMsg(r) {
    if (r.routedTo === "vulnscan") {
      var un = ((r.vulnscan && r.vulnscan.uncredentialedHosts) || []).length;
      return "취약점 스캔으로 자동 반영 — 호스트 " + r.vulnscan.hosts + "·finding " + r.vulnscan.findings + "건 (" + r.reason + ")" +
        (un > 0 ? "\n⚠ " + un + "개 호스트가 비인증(원격) 스캔입니다 — 로컬 취약점을 놓칠 수 있고, 이 스캔에서 사라진 취약점은 \"미검증\"으로 표시됩니다." : "");
    }
    if (r.routedTo === "product-manual") {
      return "보안제품 '" + r.manual.productName + "'에 " + (r.manual.kind === "logManual" ? "로그" : "제품") + " 매뉴얼로 연결" +
        (r.manual.createdProduct ? " · 신규 제품 자동 등록" : "") + " (" + r.reason + ")";
    }
    return "장기기억 " + r.memory.chunks + "청크 수집" + (r.memory.docClass ? " · 분류 " + r.memory.docClass : "") +
      (r.memory.linkedProduct ? " · 제품 '" + r.memory.linkedProduct + "' 연결" : "") + " (" + r.reason + ")";
  }
  async function handleUpload(name, b64, row, forceType, productName) {
    var cm = row.querySelector(".cm");
    cm.textContent = name + " — " + (forceType ? "처리 중…" : "유형 판별·처리 중…");
    var r = await window.gijo.uploadAuto(name, b64, forceType, productName);
    // 확신이 낮으면 담당자에게 묻는다 — 잘못 분류해 조용히 넣는 것보다 한 번 묻는 편이 낫다.
    if (r.needsDecision && !forceType) {
      var wrap = document.createElement("div");
      wrap.className = "cs-updec";
      var pn = r.guessProductName
        ? '<input class="pn" type="text" value="' + esc(r.guessProductName) + '" placeholder="제품명(보안제품 자산·로그 매뉴얼일 때 씁니다)">' : "";
      wrap.innerHTML = '<div class="h">🤔 이 파일, 어떻게 처리할까요?</div>' +
        '<div class="f">📄 ' + esc(name) + " — 파일명만으론 유형을 확신하기 어렵습니다</div>" + pn +
        '<div class="btns">' + UPLOAD_TYPES.map(function (x) {
          return '<button data-t="' + x.t + '"' + (x.t === r.guess ? ' class="reco"' : "") + ">" + x.label + (x.t === r.guess ? " (추천)" : "") + "</button>";
        }).join("") + "</div>";
      cm.textContent = name;
      cm.appendChild(wrap);
      wrap.querySelectorAll(".btns button").forEach(function (b) {
        b.addEventListener("click", function () {
          var t = b.getAttribute("data-t");
          var pin = wrap.querySelector(".pn");
          var pname = PRODUCT_NAME_TYPES[t] && pin ? (pin.value.trim() || undefined) : undefined;
          handleUpload(name, b64, row, t, pname).catch(function (e) { cm.textContent = name + " — 실패: " + e.message; });
        });
      });
      return;
    }
    cm.textContent = name + " — " + uploadResultMsg(r);
  }
  function wireUpload() {
    var btn = document.getElementById("dockUpload");
    var input = document.getElementById("csUploadInput");
    if (!btn || !input) return;
    btn.addEventListener("click", function () { input.click(); });
    input.addEventListener("change", async function () {
      var files = [].slice.call(input.files);
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var row = append("event", { icon: "📥", name: "파일 올리기", message: file.name + " — 읽는 중…" });
        try {
          var b64 = await readB64(file);
          await handleUpload(file.name, b64, row);
        } catch (e) {
          row.querySelector(".cm").textContent = file.name + " — 실패: " + ((e && e.message) || e);
        }
      }
      input.value = "";
    });
  }

  // ask() — 화면이 ⓘ로 "설명해줘"를 부탁할 때처럼, 담당자가 타이핑하지 않아도 콘솔이 대신 묻는다.
  function ask(text) {
    var input = document.getElementById("chatInput");
    if (!input) return;
    input.value = text;
    submit();
  }
  window.gijoConsole = { append: append, syncCtx: readCtxFromShell, submit: submit, ask: ask };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
