// progresscard.js — 명령 처리 진행 카드(공용). "처리 중…" 침묵 자리를 실단계로 채운다.
// (2026-07-30 사용자 요청 "진행사항을 %나 진행 바로" — 시안 mockups/progress 승인본)
//
// 정직 원칙(시안 확정):
//  · 단계 칩(지시 확인→근거·도구→답변 작성→검수)은 서버가 실제로 지나는 단계다.
//  · 숫자 %는 셀 수 있는 것(일괄 n/m건·큰 단계 n/m)에만 붙는다.
//  · 답변 작성처럼 끝을 모르는 단계는 % 없이 물결로 그린다 — 가짜 99% 금지.
//
// 쓰는 법(chatwidget.js·console.js 공용):
//   var pc = window.gijoProgressCard.start(containerEl, progressId);
//   ... 응답이 오면 pc.stop();  (컨테이너 내용은 호출자가 답변으로 교체)
(function () {
  if (window.gijoProgressCard) return;

  var POLL_MS = 700;
  var STAGES = [
    { id: "understand", label: "지시 확인" },
    { id: "tools", label: "근거·도구" },
    { id: "write", label: "답변 작성" },
    { id: "review", label: "검수" },
  ];
  // 단계 위치 기반 바 폭 — 숫자 %를 붙이지 않는 "대략 어디쯤" 표시(시안 ①②의 8%·38% 자리).
  var STAGE_BAR = { understand: 8, tools: 40, review: 92 };

  function ensureStyle(doc) {
    if (doc.getElementById("gijoPcStyle")) return;
    var s = doc.createElement("style");
    s.id = "gijoPcStyle";
    s.textContent =
      ".gijo-pc{font-size:12px;}" +
      ".gijo-pc .pc-steps{display:flex;align-items:center;gap:3px;margin-bottom:7px;flex-wrap:wrap;}" +
      ".gijo-pc .pc-step{display:flex;align-items:center;gap:4px;font-size:10.5px;color:var(--muted-2,#5f6785);" +
      "padding:2px 7px;border-radius:20px;border:1px solid transparent;white-space:nowrap;}" +
      ".gijo-pc .pc-step.done{color:var(--muted,#8b93ab);}" +
      ".gijo-pc .pc-step.done .ic{color:var(--teal,#1eb980);}" +
      ".gijo-pc .pc-step.now{color:var(--text,#e7eaf3);background:var(--panel-2,#0e1526);" +
      "border-color:var(--border-strong,rgba(255,255,255,.16));font-weight:700;}" +
      ".gijo-pc .pc-step.now .ic{display:inline-block;animation:gijoPcSpin 1.1s linear infinite;}" +
      "@keyframes gijoPcSpin{to{transform:rotate(360deg)}}" +
      ".gijo-pc .pc-conn{width:8px;height:1px;background:var(--border-strong,rgba(255,255,255,.16));}" +
      ".gijo-pc .pc-big{font-size:11.5px;color:var(--muted,#8b93ab);margin-bottom:6px;}" +
      ".gijo-pc .pc-big b{color:var(--text,#e7eaf3);}" +
      ".gijo-pc .pc-bar{height:4px;border-radius:4px;background:var(--panel-2,#0e1526);overflow:hidden;margin-bottom:6px;}" +
      ".gijo-pc .pc-fill{height:100%;border-radius:4px;background:var(--teal,#1eb980);transition:width .5s ease;width:5%;}" +
      ".gijo-pc.wave .pc-fill{width:34%;transition:none;animation:gijoPcWave 1.6s ease-in-out infinite;}" +
      "@keyframes gijoPcWave{0%{margin-left:-34%}100%{margin-left:100%}}" +
      ".gijo-pc .pc-detail{display:flex;gap:8px;align-items:baseline;font-size:11.5px;color:var(--muted,#8b93ab);}" +
      ".gijo-pc .pc-pct{margin-left:auto;color:var(--teal,#1eb980);font-weight:800;font-variant-numeric:tabular-nums;}" +
      ".gijo-pc .pc-elapsed{color:var(--muted-2,#5f6785);font-size:10.5px;font-variant-numeric:tabular-nums;}";
    (doc.head || doc.documentElement).appendChild(s);
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(el, st, startedAt) {
    var stageIdx = 0;
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === st.stage) stageIdx = i;
    var chips = STAGES.map(function (s, i) {
      var cls = i < stageIdx ? "done" : i === stageIdx ? "now" : "";
      var ic = i < stageIdx ? "✓" : i === stageIdx ? "◌" : "·";
      return '<span class="pc-step ' + cls + '"><span class="ic">' + ic + "</span>" + s.label + "</span>";
    }).join('<span class="pc-conn"></span>');

    var big = st.bigStep
      ? '<div class="pc-big"><b>큰 단계 ' + st.bigStep.index + "/" + st.bigStep.total + "</b> — " + esc(st.bigStep.label) + "</div>"
      : "";

    // 바: 셀 수 있으면 진짜 % / 작성 단계는 물결 / 그 외는 단계 위치 기반(숫자 없음)
    var wave = st.stage === "write" && !st.count;
    var width, pct = "";
    if (st.count && st.count.total > 0) {
      var p = Math.min(100, Math.round((st.count.done / st.count.total) * 100));
      width = p;
      pct = '<span class="pc-pct">' + st.count.done + "/" + st.count.total + st.count.unit + " · " + p + "%</span>";
    } else {
      width = STAGE_BAR[st.stage] || 8;
    }

    var sec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    el.className = "gijo-pc" + (wave ? " wave" : "");
    el.innerHTML =
      big +
      '<div class="pc-steps">' + chips + '<span class="pc-elapsed" style="margin-left:auto;">' + sec + "초</span></div>" +
      '<div class="pc-bar"><div class="pc-fill"' + (wave ? "" : ' style="width:' + width + '%"') + "></div></div>" +
      '<div class="pc-detail">' + esc(st.detail || "") + pct + "</div>";
  }

  // 폴링 시작 — containerEl 안을 진행 카드로 그린다. stop()을 부르면 멈춘다(내용은 남는다 —
  // 호출자가 곧바로 답변으로 교체하므로 여기서 지우지 않는다).
  function start(containerEl, progressId) {
    var doc = containerEl.ownerDocument || document;
    ensureStyle(doc);
    var el = doc.createElement("div");
    el.className = "gijo-pc";
    containerEl.innerHTML = "";
    containerEl.appendChild(el);
    var startedAt = Date.now();
    var stopped = false;

    // 첫 화면은 서버 조회 전에도 그린다 — 폴링 첫 응답(0.7초)까지 빈칸이면 침묵이 그대로다.
    render(el, { stage: "understand", detail: "지시를 읽고 처리 경로를 정하고 있습니다" }, startedAt);

    var timer = setInterval(function () {
      if (stopped) return;
      var api = window.gijo;
      if (!api || typeof api.dispatchProgress !== "function") return; // 구버전 preload — 카드가 첫 화면에 머문다
      api.dispatchProgress(progressId).then(function (r) {
        if (stopped || !r) return;
        if (r.running) render(el, r, r.startedAt || startedAt);
        // running:false — 응답 직전이거나 서버가 정리했다. 마지막 상태를 유지한 채 응답을 기다린다.
      }).catch(function () { /* 네트워크 순단은 다음 주기에 다시 */ });
    }, POLL_MS);

    return {
      stop: function () {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  function newId() {
    try { return crypto.randomUUID(); }
    catch (e) { return "pc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }
  }

  window.gijoProgressCard = { start: start, newId: newId };
})();
