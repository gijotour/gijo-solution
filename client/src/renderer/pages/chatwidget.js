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

  // 4.0.0 — 셸 탭 안(?embed=1)에서는 이 위젯을 만들지 않는다. 지시와 설명은 **셸 콘솔 한 곳**에서만
  // 한다(2026-07-27 결정의 연장). 화면마다 챗봇이 또 있으면 담당자가 매번 "어디에 물어야 하나"를
  // 판단해야 하고, 같은 질문에 두 자리가 각각 답해 대화가 갈라진다.
  // ⚠ 화면 파일 26개를 각각 고치는 대신 여기 한 곳에서 끊는다 — 파일을 26번 손대면 그중
  //   하나를 빠뜨리기 마련이고, 빠뜨린 화면만 위젯이 남아 더 헷갈린다.
  // 분리창(popout)에는 콘솔이 없으므로 위젯을 남긴다 — 거기선 이게 유일한 답변 창구다.
  if (/(^|[?&])embed=1(&|$)/.test(location.search || "")) {
    host.style.display = "none";
    // 화면 안에서 프로그램적으로 설명을 부르는 호출부(gijoExplain)는 대화창으로 넘긴다.
    //
    // ⚠ 옛 길(`gijo:explain` postMessage)은 **셸에게** 보냈다. 그런데 대화창을 「⧉ 창으로」
    //   빼 두면 셸의 대화창은 접혀 있어서, 담당자 눈엔 **ⓘ를 눌러도 아무 일이 없고** 답은
    //   안 보이는 자리에 쌓인다(2026-08-01 검토에서 잡힘 — ⓘ는 26개 화면 전부의 표준 경로다).
    //   askConsole은 도킹이든 분리창이든 **지금 보이는 쪽**으로 간다.
    //   문구를 여기서 만드는 이유: 셸이 만들던 것을 그대로 옮겨 왔다(app.html 옛 337~339행).
    window.gijoExplain = function (topic) {
      var 물음 = topic ? '"' + topic + '" 사용법 알려줘' : "이 화면에서 뭐 할 수 있어?";
      if (window.gijo && window.gijo.askConsole) { window.gijo.askConsole(물음); return; }
      try { window.parent.postMessage({ type: "gijo:ask", text: 물음 }, "*"); } catch (e) {} // 구버전 대비
    };
    return;
  }

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
      "background:var(--panel,#30302e);border:1px solid rgba(139,124,240,.4);border-radius:14px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px;display:flex;flex-direction:column;box-sizing:border-box;z-index:700;transition:height .15s,width .15s;}" +
      // 닫힌 상태는 완전히 숨긴다 — 예전엔 우하단 "🤖 챗봇" 알약이 떠 있었으나,
      // 여는 입구를 좌측 메뉴의 🤖 아이콘 하나로 일원화했다(2026-07-24).
      ".gcw.collapsed{display:none;}" +
      ".gcw-head{font-size:13.5px;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px;}" +
      ".gcw-head .gcw-title{display:flex;align-items:center;gap:6px;}" +
      ".gcw-toggle{cursor:pointer;font-size:12.25px;color:var(--muted,#b3ada4);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:20px;padding:3px 10px;flex-shrink:0;}" +
      ".gcw-toggle:hover{color:#fff;border-color:var(--blue,#3b82f6);}" +
      ".gcw-body{display:flex;flex-direction:column;flex:1;min-height:0;}" +
      ".gcw-sub{font-size:12px;color:var(--muted-2,#a49d95);margin-bottom:10px;}" +
      ".gcw-guide{background:var(--panel-2,#1f1e1d);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12.25px;color:var(--muted,#b3ada4);line-height:1.7;flex-shrink:0;}" +
      ".gcw-chip{display:inline-block;background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));color:var(--blue-light,#5fa1ff);font-size:12px;padding:4px 10px;border-radius:20px;margin:3px 4px 0 0;cursor:pointer;}" +
      ".gcw-chip:hover{background:var(--blue,#3b82f6);color:#fff;border-color:var(--blue,#3b82f6);}" +
      ".gcw-msgs{flex:1;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:9px;min-height:0;}" +
      ".gcw-empty{font-size:12.25px;color:var(--muted-2,#a49d95);}" +
      ".gcw-row{border-radius:9px;padding:9px 11px;font-size:12.5px;line-height:1.6;max-width:92%;word-break:break-word;}" +
      ".gcw-row.user{background:var(--blue,#3b82f6);color:#fff;margin-left:auto;}" +
      ".gcw-row.bot{background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));}" +
      ".gcw-row.error{background:rgba(226,72,61,.12);border:1px solid rgba(226,72,61,.4);color:#f5928a;}" +
      ".gcw-dock{display:flex;gap:6px;margin-top:8px;flex-shrink:0;}" +
      ".gcw-dock input{flex:1;background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:8px;padding:9px 11px;color:var(--text,#e9e7e2);font-size:12.5px;outline:none;}" +
      ".gcw-dock button{background:var(--blue,#3b82f6);color:#fff;border:0;border-radius:8px;padding:0 14px;font-size:12.5px;font-weight:700;cursor:pointer;}" +
      // 확인 후 실행 — 쓰기 작업은 답만 하고 끝내지 않고, 무엇을 어떤 값으로 실행할지 카드로
      // 보여 준 뒤 승인해야 실행한다(대시보드 지휘 콘솔의 결재판과 같은 규약).
      ".gcw-ap{background:rgba(240,160,32,.07);border:1px solid rgba(240,160,32,.42);border-radius:10px;padding:10px 12px;font-size:12.5px;}" +
      ".gcw-ap-head{font-weight:800;color:#f3c06a;margin-bottom:3px;}" +
      ".gcw-ap-intro{color:var(--muted,#b3ada4);font-size:12px;margin-bottom:8px;line-height:1.6;}" +
      ".gcw-ap-f{display:flex;align-items:center;gap:6px;margin-bottom:5px;}" +
      ".gcw-ap-k{font-size:12px;color:var(--muted,#b3ada4);width:78px;flex:0 0 auto;}" +
      ".gcw-ap-k .req{color:var(--red,#e2483d);margin-left:2px;}" +
      ".gcw-ap-in{flex:1;min-width:0;background:var(--panel-2,#1f1e1d);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:6px;padding:5px 8px;color:var(--text,#e9e7e2);font-size:12.25px;outline:none;}" +
      ".gcw-ap-in.need{border-color:rgba(226,72,61,.55);}" +
      ".gcw-ap-effect{background:var(--panel-2,#1f1e1d);border-radius:7px;padding:7px 9px;margin-top:7px;font-size:12px;color:var(--muted,#b3ada4);line-height:1.6;}" +
      ".gcw-ap-actions{display:flex;gap:6px;margin-top:9px;}" +
      ".gcw-ap-actions button{border:0;border-radius:7px;padding:6px 12px;font-size:12.25px;font-weight:700;cursor:pointer;}" +
      ".gcw-ap-go{background:var(--teal,#1eb980);color:#04150f;}" +
      ".gcw-ap-go:disabled{opacity:.5;cursor:not-allowed;}" +
      ".gcw-ap-no{background:transparent;color:var(--muted,#b3ada4);border:1px solid var(--border-strong,rgba(255,255,255,.16)) !important;}" +
      ".gcw-undo{margin-top:7px;background:transparent;border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:7px;color:var(--muted,#b3ada4);font-size:12px;padding:4px 10px;cursor:pointer;}" +
      // 해석 배지 — "무엇으로 이해했는지"를 답 위에 한 줄로 보여 준다.
      ".gcw-read{font-size:11.75px;color:var(--muted-2,#a49d95);margin-bottom:4px;}" +
      ".gcw-read b{color:var(--blue-light,#5fa1ff);font-weight:700;}";
    document.head.appendChild(st);
  }

  function build() {
    injectCss();
    host.removeAttribute("style");
    // 모든 화면에서 닫힌 채 시작한다(사용자 방침 2026-07-22) — 좌측 메뉴의 🤖 아이콘으로 연다.
    // data-start="open"을 명시한 화면만 펼친 채 시작(현재는 없음).
    var startCollapsed = host.dataset.start !== "open";
    // 메뉴의 🤖를 눌러 다른 화면으로 이동해 온 경우엔 도착하자마자 열어 준다.
    // 위젯 없는 화면을 거쳐 깃발이 남는 걸 막으려고 10초 안에 찍힌 것만 인정한다.
    try {
      var flag = localStorage.getItem("gijo:openChatOnLoad");
      localStorage.removeItem("gijo:openChatOnLoad");
      if (flag && Date.now() - Number(flag) < 10000) startCollapsed = false;
    } catch (e) {}
    host.className = "gcw" + (startCollapsed ? " collapsed" : "");
    host.innerHTML =
      '<div class="gcw-head"><span class="gcw-title">🤖 화면 안내</span><span class="gcw-toggle" id="gcwToggle">✕ 닫기</span></div>' +
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

    // 닫기 전용 — 다시 여는 입구는 좌측 메뉴의 🤖 아이콘이다.
    toggle.addEventListener("click", function () { host.classList.add("collapsed"); });

    function openChat() {
      host.classList.remove("collapsed");
      try { input.focus(); } catch (e) {}
    }
    // 같은 문서에 네비가 있는 일반 화면용.
    window.gijoOpenChat = openChat;
    // 허브(hub.html)는 화면을 iframe으로 품으므로 네비가 부모, 챗봇은 자식에 있다 → postMessage로 받는다.
    window.addEventListener("message", function (ev) {
      if (ev && ev.data && ev.data.type === "gijo:openChat") openChat();
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

    // "무엇으로 이해했는지" 한 줄. 서버가 정한 경로(route)·실행한 도구를 그대로 보여 준다.
    var ACTION_LABEL = { scan: "점검·스캔", analyze: "분석", report: "리포트", chat: "질의응답" };
    function readBadge(r) {
      var bits = [];
      if (r.route && r.route.action) bits.push(ACTION_LABEL[r.route.action] || r.route.action);
      if (r.route && r.route.targetAssetId) bits.push("대상 " + r.route.targetAssetId);
      if (r.steps && r.steps.length) bits.push(r.steps.length + "단계");
      if (r.toolCalls && r.toolCalls.length) bits.push("도구 " + r.toolCalls.map(function (t) { return t.tool; }).join(", "));
      if (!bits.length) return "";
      return '<div class="gcw-read">이렇게 이해했어요 — <b>' + esc(bits.join(" · ")) + "</b></div>";
    }

    // 쓰기 작업 결재판 — 실행 전에 도구·인자를 보여 주고, 승인해야 실제로 실행한다.
    // (서버가 지시만으로는 쓰기 도구를 실행하지 않고 approval을 돌려준다. 승인은 approveAgentTool 경유.)
    function appendApproval(ap) {
      var row = appendRow("bot", "");
      row.className = "gcw-row gcw-ap";
      row.style.maxWidth = "100%";
      var fields = ap.fields || [];
      row.innerHTML =
        '<div class="gcw-ap-head">🗂️ 실행 승인 — ' + esc(ap.label || ap.tool) + "</div>" +
        '<div class="gcw-ap-intro">지시를 아래와 같이 정리했습니다. 값을 확인·수정한 뒤 승인하면 실행합니다.</div>' +
        fields.map(function (f) {
          return '<div class="gcw-ap-f"><span class="gcw-ap-k">' + esc(f.label || f.key) + (f.required ? '<span class="req">*</span>' : "") + "</span>" +
            '<input class="gcw-ap-in' + (f.source === "empty" ? " need" : "") + '" data-k="' + esc(f.key) + '" value="' + esc(f.value || "") + '" placeholder="' + esc(f.hint || "") + '"></div>';
        }).join("") +
        (ap.effect || ap.undo
          ? '<div class="gcw-ap-effect">' + (ap.effect ? "<b>실행되면:</b> " + esc(ap.effect) + "<br>" : "") + (ap.undo ? "<b>되돌리기:</b> " + esc(ap.undo) : "") + "</div>"
          : "") +
        '<div class="gcw-ap-actions"><button class="gcw-ap-go">✓ 승인하고 실행</button><button class="gcw-ap-no">취소</button></div>';

      var go = row.querySelector(".gcw-ap-go");
      var inputs = Array.prototype.slice.call(row.querySelectorAll(".gcw-ap-in"));
      var collect = function () {
        var o = {};
        inputs.forEach(function (i) { o[i.dataset.k] = i.value.trim(); });
        return o;
      };
      // 필수값이 비면 승인을 잠근다(서버도 재검증하지만 화면에서 먼저 막는다).
      var required = fields.filter(function (f) { return f.required; }).map(function (f) { return f.key; });
      var sync = function () {
        var args = collect();
        var missing = required.filter(function (k) { return !args[k]; });
        go.disabled = missing.length > 0;
        go.textContent = missing.length ? "✓ 승인 (" + missing.length + "개 입력 필요)" : "✓ 승인하고 실행";
      };
      inputs.forEach(function (i) { i.addEventListener("input", sync); });
      sync();

      row.querySelector(".gcw-ap-no").addEventListener("click", function () {
        row.className = "gcw-row bot";
        row.innerHTML = "✕ 실행하지 않았습니다 — " + esc(ap.label || ap.tool);
      });
      go.addEventListener("click", async function () {
        go.disabled = true;
        go.textContent = "실행 중…";
        try {
          var r = await window.gijo.approveAgentTool(ap.tool, collect(), ap.instruction || "");
          row.className = "gcw-row bot";
          row.innerHTML = "✅ <b>실행 완료</b> — " + esc(ap.tool) + "<br>" + fmt((r && r.output) || "");
          if (r && r.undoId) {
            var ub = document.createElement("button");
            ub.className = "gcw-undo";
            ub.textContent = "↩ 방금 실행 취소";
            ub.addEventListener("click", async function () {
              ub.disabled = true;
              try { var u = await window.gijo.undoAgentTool(r.undoId); ub.remove(); appendRow("bot", "↩ " + esc((u && u.message) || "되돌렸습니다.")); }
              catch (e) { ub.disabled = false; appendRow("error", "되돌리기 실패: " + esc((e && e.message) || e)); }
            });
            row.appendChild(ub);
          }
        } catch (e) {
          go.disabled = false;
          go.textContent = "✓ 승인하고 실행";
          appendRow("error", "실행 실패: " + esc((e && e.message) || e));
        }
        msgs.scrollTop = msgs.scrollHeight;
      });
    }

    async function send(text) {
      text = (text || input.value).trim();
      if (!text) return;
      input.value = "";
      appendRow("user", esc(text));
      // 진행 카드 — "처리 중…" 한 줄 대신 서버가 실제로 지나는 단계를 보여준다(2026-07-30 시안 승인).
      // progresscard.js가 없으면(로드 순서·구버전) 기존 문구로 그대로 동작한다.
      var typing = appendRow("bot", '처리 중… <span style="color:var(--muted-2,#a49d95);font-size:12px">첫 응답은 모델 준비로 다소 걸릴 수 있어요</span>');
      var pc = null, pid;
      if (window.gijoProgressCard) {
        pid = window.gijoProgressCard.newId();
        pc = window.gijoProgressCard.start(typing, pid);
      }
      try {
        if (!sessionId) { try { var s = await window.gijo.createWorkSession(text.slice(0, 30), "screen:" + here); sessionId = s && s.id; } catch (e) {} }
        var r = await window.gijo.sendInstruction(text, sessionId || undefined, undefined, pid);
        if (pc) pc.stop();
        typing.innerHTML = readBadge(r) + fmt(r.output || "(응답 없음)");
        // ★ 아래 셋은 **지휘소와 같은 부품**을 쓴다(chatparts.js).
        //   분리창(⧉ 창으로)에서는 여기가 유일한 창구인데, 전엔 체크칸·가서 하기가 없어
        //   같은 답인데 창으로 빼면 목록에서 고를 수가 없었다(2026-08-01 실측).
        //   한쪽에만 고쳐 놓고 고쳤다고 믿는 일을 없애려고 부품을 한 곳에 두었다.
        // ⚠ 근거 배지도 부품에 맡긴다(2026-08-13). 전엔 여기서 innerHTML로 **직접 그리고**
        //   부품에는 null을 넘겨 껐다 — 부품을 둔 이유(한 벌로 두기)와 정면으로 어긋난 자리였다.
        //   감시 시험(clientglobals)은 "옛 **함수**를 다시 부르나"만 봐서 인라인 사본을 못 잡았다.
        //   ⚠ 모양은 그대로다 — .gcp-src가 같은 값이다(margin-top:6px·11.5px·700·#6fdcb5).
        //   ⚠ 배지 문구를 고칠 일이 생기면 이제 **chatparts.js 한 곳만** 고치면 된다.
        var P = window.gijoChatParts;
        if (P) {
          P.quotes(typing, r.quotes, r.output || "", r.sources, r.근거세기);
          P.picks(typing, r.picklist, function (보낼글) { send(보낼글); });
          // 분리창은 탭을 직접 못 연다 — 본창에 부탁한다(지휘소와 다른 유일한 대목).
          P.open(typing, r.openScreen, {
            navigate: function (page, label) {
              if (window.gijo && window.gijo.openTabInShell) return window.gijo.openTabInShell(page, label);
              if (window.gijo && window.gijo.navigateTo) return window.gijo.navigateTo(page);
              return false;
            },
          });
          // 데이터 카드 — 지휘소와 같은 부품(chatparts.js). 분리창엔 📌 선택칩이 없어
          // select는 안 넘긴다(행 클릭 무동작) — 🗔 열기는 본창에 부탁하는 기존 통로 그대로.
          if (P.dataCard) P.dataCard(typing, r.dataCard, {
            navigate: function (page, label) {
              if (window.gijo && window.gijo.openTabInShell) return window.gijo.openTabInShell(page, label);
              if (window.gijo && window.gijo.navigateTo) return window.gijo.navigateTo(page);
              return false;
            },
          });
        }
        // 실행이 필요한 지시면 여기서 끝내지 않고 확인 카드를 띄운다.
        if (r.approval) appendApproval(r.approval);
        else if (r.confirm && r.confirm.type === "learnloop") {
          var cRow = appendRow("bot", "");
          cRow.className = "gcw-row gcw-ap";
          cRow.style.maxWidth = "100%";
          var ds = (r.confirm.datasets || []).map(function (d) { return d.id + "(" + d.examples + "건)"; }).join(", ");
          cRow.innerHTML = '<div class="gcw-ap-head">🔁 학습 루프 실행 확인</div>' +
            '<div class="gcw-ap-intro">대상 데이터셋: ' + esc(ds || "(없음)") + '<br>오발동을 막기 위해 확인을 눌러야 시작합니다.</div>' +
            '<div class="gcw-ap-actions"><button class="gcw-ap-go">✓ 학습 시작</button><button class="gcw-ap-no">취소</button></div>';
          cRow.querySelector(".gcw-ap-no").addEventListener("click", function () {
            cRow.className = "gcw-row bot"; cRow.innerHTML = "✕ 학습을 시작하지 않았습니다.";
          });
          cRow.querySelector(".gcw-ap-go").addEventListener("click", async function () {
            var b = cRow.querySelector(".gcw-ap-go"); b.disabled = true; b.textContent = "시작 중…";
            try {
              var d0 = (r.confirm.datasets || [])[0];
              await window.gijo.startLearnloopRun(d0 && d0.id);
              cRow.className = "gcw-row bot"; cRow.innerHTML = "✅ 학습 루프를 시작했습니다.";
            } catch (e) { b.disabled = false; b.textContent = "✓ 학습 시작"; appendRow("error", "학습 시작 실패: " + esc((e && e.message) || e)); }
          });
        }
        msgs.scrollTop = msgs.scrollHeight;
      } catch (e) {
        if (pc) pc.stop();
        typing.className = "gcw-row error";
        typing.innerHTML = "실패: " + esc((e && e.message) || e);
      }
    }

    document.getElementById("gcwSend").addEventListener("click", function () { send(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    host.querySelectorAll(".gcw-chip").forEach(function (chip) {
      chip.addEventListener("click", function () { send(chip.textContent); });
    });

    // 화면 설명은 대시보드 대화 한 곳에서만 한다(2026-07-27 사용자 지시) — 화면마다 있던 ⓘ와
    // 그 배선을 걷어냈다. 설명은 화면을 여는 순간 대시보드가 띄우고(shell-popup → gijoScreenGuide),
    // 다시 보고 싶으면 "이 화면 사용법 알려줘"라고 물으면 된다.
    // gijoExplain은 남겨 둔다 — 화면 안에서 프로그램적으로 사용법을 물어 오는 기존 호출부가
    // 있고, 대시보드가 없는 분리창에서는 이 위젯이 유일한 답변 창구다.
    window.gijoExplain = function (topic) {
      var q = topic ? '"' + topic + '" 사용법 알려줘' : "이 화면 사용법 알려줘";
      // (2026-07-29 검토 #8) 부모 창의 gijoScreenGuide로 넘기던 분기를 지웠다 — 그 함수는
      // 삭제된 shell-popup.js의 것이라 이제 어떤 부모에도 없다. 죽은 경로를 남겨 두면
      // "대시보드로 보내는 기능이 있다"고 다음 사람이 착각한다. 지금은 이 위젯이 직접 답한다.
      openChat();
      send(q);
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
