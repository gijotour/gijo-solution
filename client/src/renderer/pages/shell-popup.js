// shell-popup.js — 대시보드 팝업 셸 (혼합 방식, 2026-07-26 결정 · 시안 mockups/shell-popup-v2)
//
// 왜: 메뉴를 옮길 때마다 페이지 전체를 다시 읽어(loadFile) 대시보드의 명령창·대화·진행 중
// 작업이 사라졌다. 세션 복원(3.1.1)은 "턴이 쌓인 세션"만 살릴 수 있어 입력 중 초안·진행 중
// 응답까지는 못 지킨다. 그래서 대시보드를 껍데기(셸)로 고정하고, 화면은 그 위 팝업(iframe)으로
// 연다 — 리로드 자체가 없으니 아무것도 사라지지 않는다.
//
// 규칙(시안 v2 승인):
// · 대상은 nav.js GROUPS에서 popup:true인 메뉴(1차 파일럿: 자산 허브·보안 분석·리포트)
// · 동시 최대 5개 — 넘치면 핀(📌) 없는 가장 오래 안 본 팝업이 자동으로 닫힌다(토스트 안내)
// · 슬롯 클릭 = 전환(iframe은 숨겨둘 뿐 살아있음 — 화면 상태 보존). 활성 슬롯 재클릭 = 대시보드로
// · 🗗 창으로 분리 = 별도 창(사무실 창 방식)으로 떼어냄 — 슬롯에서 빠져 상한을 차지하지 않는다
// · ⛶ 전체 화면 = 기존 방식 이동(탈출구) · ⟳ 새로고침 · Esc = 대시보드로
// · 활성 팝업 = 명령 맥락: 컴포저 위 칩으로 표시하고, 지시의 screen 파라미터로 서버에 전달된다
//   (허브 팝업은 활성 "탭"의 파일명 — hub.html이 gijo:hubTab 메시지로 알려준다)
//
// 이 파일은 dashboard.html만 로드한다. 다른 화면에는 gijoShell이 없으므로 nav.js가 기존대로 이동한다.
(function () {
  "use strict";
  if (window.gijoShell) return;

  var MAX = 5; // 동시 팝업 상한(2026-07-26 사용자 결정)
  var STORE_KEY = "gijo:shell:popups"; // 대시보드를 다시 열어도 팝업 구성이 살아나게 저장
  var slots = []; // { key(page), label, pinned, lastActive, curTab(허브 활성 탭 파일명), el(iframe), slotEl }
  var activeKey = null; // 지금 화면에 보이는 팝업(없으면 대시보드)
  var visible = false;

  // ── 스타일 ──────────────────────────────────────────────────────────
  var css = document.createElement("style");
  css.textContent =
    // 관리 바 — 헤더 바로 아래 전체 폭. 팝업이 하나도 없으면 숨김.
    "#shellBar{display:none;align-items:center;gap:6px;padding:6px 12px;background:var(--panel-2,#0e1526);border-bottom:1px solid var(--border,#1e2a44);flex:0 0 auto;}" +
    "#shellBar.has{display:flex;}" +
    "#shellBar .sb-t{font-size:10px;font-weight:800;color:var(--muted-2,#5c6580);letter-spacing:1px;margin-right:2px;}" +
    ".sb-slot{display:flex;align-items:center;gap:6px;background:var(--panel,#121a2e);border:1px solid var(--border,#1e2a44);border-radius:8px;padding:4px 9px;font-size:12px;font-weight:700;color:var(--muted,#8b93ab);cursor:pointer;max-width:220px;}" +
    ".sb-slot .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
    ".sb-slot .dot{width:6px;height:6px;border-radius:50%;background:var(--muted-2,#5c6580);flex:0 0 auto;}" +
    ".sb-slot.on{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.55);color:#fff;}" +
    ".sb-slot.on .dot{background:var(--teal,#2dd4bf);box-shadow:0 0 6px var(--teal,#2dd4bf);}" +
    ".sb-slot .pinm{font-size:10px;}" +
    ".sb-slot .x{font-size:11px;color:var(--muted-2,#5c6580);padding:0 2px;border-radius:4px;flex:0 0 auto;}" +
    ".sb-slot .x:hover{color:#fff;background:rgba(226,72,61,.4);}" +
    "#shellBar .sb-right{margin-left:auto;display:flex;gap:6px;}" +
    "#shellBar .sb-btn{background:var(--panel,#121a2e);border:1px solid var(--border-strong,#28365a);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:800;color:var(--muted,#8b93ab);cursor:pointer;}" +
    "#shellBar .sb-btn:hover{color:#fff;border-color:var(--blue,#3b82f6);}" +
    // 배경막 — 팝업·컴포저 틈으로 뒤 대시보드(히어로·AI팀)가 비쳐 지저분한 것을 가린다(실화면 검증에서 발견).
    // 사이드바는 덮지 않는다 — 메뉴를 눌러 다른 팝업을 바로 열 수 있어야 한다. 클릭하면 대시보드로.
    // 어둡기 .93 — 히어로 구체·인사말처럼 밝은 요소는 .82로는 비쳐 보인다(팝업을 줄였을 때 실측).
    // 배경막 — 뒤가 **연하게 비쳐** 보여야 "대시보드 위에 얹힌 창"이라는 게 느껴진다.
    // ⚠ 예전에 .82 → .93으로 진하게 올린 적이 있다(2b4f76c). 이유는 히어로 구체·인사말 같은
    //   밝은 요소가 팝업 뒤로 비쳐 어수선했기 때문인데, 그러면서 뒤가 아예 안 보이게 됐다.
    //   지금은 팝업이 뜨면 그 밝은 요소들을 숨기므로(dashboard.html body.shell-popped)
    //   원인이 사라졌다 — 다시 연하게 되돌린다(2026-07-27 사용자 지적).
    // ⚠ 이 팝업은 **모달이 아니다** — 뒤에 있는 명령창에 그대로 타이핑할 수 있다.
    //   모달이 아닌데 배경막을 짙게 깔면 "뒤는 못 쓴다"는 잘못된 신호를 준다.
    //   표준(Material scrim)도 상황에 맞춰 옅게 쓰라고 한다. .93 → .55로 낮춘다.
    //   층은 배경막이 아니라 그림자·테두리가 만든다(#shellLayer의 box-shadow).
    "#shellDim{display:none;position:fixed;z-index:690;background:rgba(6,10,20,.55);}" +
    "#shellDim.on{display:block;}" +
    // 팝업 레이어 — 중앙 무대 위에 고정. 위치·크기는 JS가 계산(사이드바·컴포저를 피해서).
    "#shellLayer{display:none;position:fixed;z-index:700;background:var(--panel,#121a2e);border:1px solid var(--border-strong,#28365a);border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.65);overflow:hidden;flex-direction:column;}" +
    "#shellLayer.on{display:flex;}" +
    "#shellHead{display:flex;align-items:center;gap:10px;padding:7px 12px;background:var(--panel-2,#0e1526);border-bottom:1px solid var(--border,#1e2a44);flex:0 0 auto;}" +
    "#shellHead .t{font-size:12.5px;font-weight:800;color:#fff;}" +
    "#shellHead .sp{flex:1;}" +
    "#shellHead .hb{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted,#8b93ab);cursor:pointer;border:1px solid transparent;}" +
    "#shellHead .hb:hover{color:#fff;border-color:var(--border-strong,#28365a);background:rgba(255,255,255,.05);}" +
    "#shellHead .hb.pin-on{color:var(--amber,#f0a020);border-color:rgba(240,160,32,.5);}" +
    "#shellBody{flex:1;min-height:0;position:relative;background:var(--bg,#0a0f1e);}" +
    // 아래 모서리 크기조절 손잡이(2026-07-26 사용자 요청 — 위아래 자유) — 끌면 높이 조절, 더블클릭=자동.
    "#shellGrip{position:absolute;left:0;right:0;bottom:0;height:8px;cursor:ns-resize;z-index:6;}" +
    "#shellGrip:hover,#shellGrip.drag{background:linear-gradient(to top,rgba(59,130,246,.45),transparent);}" +
    "#shellBody iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:none;}" +
    "#shellBody iframe.on{display:block;}" +
    // 팝업이 떠 있는 동안 — 컴포저(지휘 콘솔 박스)를 하단에 고정해 늘 보이게, 활동 로그는 낮게.
    // ⚠ background에 !important가 필요하다: 대시보드의 .ai-team 규칙이 background:none !important를
    //   걸어 두어, 그냥 쓰면 컴포저가 **배경 없이** 그려진다(실측: rgba(0,0,0,0)).
    //   배경막을 연하게 바꾼 뒤로는 그 탓에 대화 카드가 허공에 뜬 것처럼 보였다(2026-07-27 지적).
    //   대화 영역은 하나의 판으로 보여야 읽힌다.
    // 대화 판은 **반투명 + 흐림**으로 둔다(2026-07-27, 표준 참고).
    //  · 불투명하게 채웠더니 뒤가 하나도 안 보여, "팝업이 대시보드 위에 얹혀 있다"는 느낌이
    //    다시 사라졌다(사용자가 계속 지적한 부분).
    //  · 그렇다고 그냥 투명하게 두면 뒤 글자와 겹쳐 대화가 안 읽힌다(이전 상태).
    //  → 반투명(약 78%)으로 깔고 뒤를 흐리게(blur 16px) 만든다. 뒤의 색·형태는 비치지만
    //    글자는 뭉개져 대화를 방해하지 않는다. 통설도 "채움 20~40% + blur 10~30px"을 권한다.
    //    우리 배경은 어두워 대비를 지키려면 채움을 더 진하게 잡아야 한다(글자 대비 우선).
    "body.shell-popped #accConsole{position:fixed;bottom:8px;z-index:720;" +
    "background:rgba(14,21,38,.78) !important;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);" +
    "border:1px solid var(--border,#1e2a44) !important;" +
    "border-radius:12px !important;padding:4px 8px 8px !important;box-shadow:0 -8px 30px rgba(0,0,0,.45);}" +
    // 이력은 컴포저가 차지한 높이를 그대로 쓴다(layout이 top을 잡아 준다) — 고정 110px이면
    // 팝업과 대화 사이가 텅 비어 보인다.
    "body.shell-popped #accConsole .cl-rows{max-height:none;flex:1 1 auto;min-height:0;}" +
    // 명령 맥락 칩 — 컴포저 바로 위. 팝업이 떠 있을 때만 보인다.
    "#shellCtx{display:none;align-items:center;gap:8px;margin:0 0 6px;}" +
    "body.shell-popped #shellCtx{display:flex;}" +
    "#shellCtx .chip{display:inline-flex;align-items:center;gap:6px;background:rgba(45,212,191,.12);border:1px solid rgba(45,212,191,.4);color:var(--teal,#2dd4bf);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:800;cursor:default;}" +
    "#shellCtx .sw{color:var(--muted-2,#5c6580);font-size:10.5px;font-weight:700;cursor:pointer;}" +
    "#shellCtx .sw:hover{color:#fff;}" +
    // 토스트(자동 닫힘 안내 등)
    "#shellToast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#1a2340;border:1px solid var(--border-strong,#28365a);color:var(--text,#e6eaf3);padding:8px 16px;border-radius:10px;font-size:12px;z-index:1200;display:none;box-shadow:0 8px 24px rgba(0,0,0,.5);}" +
    // ＋메뉴 팝오버
    "#shellPlus{position:fixed;z-index:1100;background:var(--panel,#121a2e);border:1px solid var(--border-strong,#28365a);border-radius:10px;padding:6px;display:none;box-shadow:0 10px 30px rgba(0,0,0,.55);}" +
    "#shellPlus .pi{padding:7px 12px;font-size:12px;font-weight:700;color:var(--muted,#8b93ab);border-radius:7px;cursor:pointer;white-space:nowrap;}" +
    "#shellPlus .pi:hover{color:#fff;background:rgba(59,130,246,.16);}";
  document.head.appendChild(css);

  // ── DOM 뼈대 ────────────────────────────────────────────────────────
  var bar = document.createElement("div");
  bar.id = "shellBar";
  bar.innerHTML = '<span class="sb-t">열린 화면</span><span id="sbSlots" style="display:flex;gap:6px;min-width:0;"></span>' +
    '<span class="sb-right"><span class="sb-btn" id="sbPlus">＋ 메뉴</span><span class="sb-btn" id="sbCloseAll">모두 닫기</span></span>';
  var header = document.querySelector(".app-shell .header");
  if (header) header.insertAdjacentElement("afterend", bar);
  else document.body.prepend(bar);

  var dim = document.createElement("div");
  dim.id = "shellDim";
  dim.title = "대시보드로 (팝업은 위 슬롯에 유지)";
  document.body.appendChild(dim);

  var layer = document.createElement("div");
  layer.id = "shellLayer";
  // 머리 버튼은 3개만 내놓는다(2026-07-27). 예전엔 📌⟳🗗⛶▁✕ 여섯 개가 늘 보여서
  // "이게 뭐 하는 건지" 배울 게 여섯 가지였다. 자주 쓰는 셋만 남기고,
  // 나머지(핀·새로고침·접기)는 **머리를 우클릭**하면 나오는 메뉴로 옮겼다 — 기능은 그대로다.
  layer.innerHTML = '<div id="shellHead" title="우클릭하면 핀·새로고침·접기">' +
    '<span class="t" id="shTitle"></span><span class="sp"></span>' +
    '<span class="hb" id="shPopout" title="창으로 분리 — 별도 창으로 떼어냄. 가로/세로는 그 창 안에서">🗗</span>' +
    '<span class="hb" id="shFull" title="전체 화면으로 보기">⛶</span>' +
    '<span class="hb" id="shClose" title="닫기">✕</span>' +
    // 숨은 버튼 — 우클릭 메뉴가 이 요소들을 그대로 눌러 쓴다(배선을 한 벌만 유지).
    '<span class="hb" id="shPin" title="핀" style="display:none">📌</span>' +
    '<span class="hb" id="shReload" title="새로고침" style="display:none">⟳</span>' +
    '<span class="hb" id="shMin" title="접기" style="display:none">▁</span></div>' +
    '<div id="shellBody"></div>' +
    '<div id="shellGrip" title="끌어서 높이 조절 · 더블클릭 = 지금 화면에 맞춰 다시"></div>';
  document.body.appendChild(layer);

  var toast = document.createElement("div");
  toast.id = "shellToast";
  document.body.appendChild(toast);

  var plus = document.createElement("div");
  plus.id = "shellPlus";
  document.body.appendChild(plus);

  // 명령 맥락 칩 — 컴포저(agentDock) 바로 위에 끼운다.
  // "| 대시보드 맥락으로"는 팝업을 접지 않는다 — 팝업은 그대로 두고 지시 맥락만 토글한다
  // (2026-07-26 사용자 결정: 별도 화면 전환이 아니라 기존 화면 통합. 접기는 ▁·Esc·배경막이 담당).
  var ctxDash = false; // 팝업이 떠 있는 동안 사용자가 "대시보드 맥락"을 고른 상태

  // 분리창(별도 창) 맥락 — 2026-07-26 사용자 요청.
  // 규칙은 단순하게 **보고 있는 것이 맥락**: 분리창을 클릭해 포커스하면 그 창이 맥락이 되고,
  // 창을 닫으면 해제된다. 담당자가 따로 지정할 필요 없이 화면을 보며 바로 지시할 수 있다.
  // (앱 안 팝업은 postMessage로 알리지만 별도 창은 부모가 없어 메인 프로세스를 거쳐 온다.)
  var popouts = {};      // key → { label, tab, tabLabel }
  var activePopout = null; // 지금 맥락인 분리창 key(대시보드를 보고 있으면 null)
  var ctx = document.createElement("div");
  ctx.id = "shellCtx";
  ctx.innerHTML = '<span class="chip">🎯 명령 맥락: <b id="shCtxLabel"></b></span>' +
    '<span class="sw" id="shCtxSwitch">| 대시보드 맥락으로</span>' +
    '<span id="shCtxHint" style="font-size:10.5px;color:var(--muted-2,#5c6580)"></span>';
  var dock = document.getElementById("agentDock");
  if (dock) dock.insertAdjacentElement("beforebegin", ctx);

  // 지시창(입력) 안내문도 맥락을 따라간다 — 어디에 대고 말하는지 입력창만 봐도 알게.
  var chatInputEl = document.getElementById("chatInput");
  var basePlaceholder = chatInputEl ? chatInputEl.placeholder : "";
  function renderCtx() {
    var lb = document.getElementById("shCtxLabel");
    var sw = document.getElementById("shCtxSwitch");
    var hint = document.getElementById("shCtxHint");
    if (!lb || !sw) return;

    // 분리창을 보고 있으면 그것이 맥락이다(팝업보다 우선 — 사용자가 방금 그 창을 봤다는 뜻).
    if (activePopout && popouts[activePopout] && !ctxDash) {
      var p = popouts[activePopout];
      lb.textContent = "🗗 " + (p.tabLabel || p.label);
      sw.textContent = "| 대시보드 맥락으로";
      if (hint) hint.textContent = "별도 창에서 보고 계신 화면입니다 — 그대로 지시하세요";
      if (chatInputEl) chatInputEl.placeholder = "「" + (p.tabLabel || p.label) + "」 화면에 대해 지시…";
      document.body.classList.add("shell-popped"); // 맥락 칩이 보이게(팝업이 없어도)
      return;
    }

    var s = findSlot(activeKey);
    if (ctxDash || !s) {
      lb.textContent = "대시보드";
      sw.textContent = "| 보이는 화면 맥락으로";
      if (hint) hint.textContent = "전체 현황 기준으로 답합니다 — 팝업은 그대로 열려 있습니다";
      if (chatInputEl) chatInputEl.placeholder = "대시보드 맥락으로 지시… (전체 현황 기준)";
    } else {
      lb.textContent = s.curLabel || s.label;
      sw.textContent = "| 대시보드 맥락으로";
      if (hint) hint.textContent = "보이는 화면을 향해 바로 지시 — 답은 이 대화에 쌓입니다";
      if (chatInputEl) chatInputEl.placeholder = "「" + (s.curLabel || s.label) + "」 화면에 대해 지시…";
    }
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { toast.style.display = "none"; }, 3000);
  }

  // 사용자가 고른 팝업 높이(px) — 없으면 자동(내용에 맞추되 컴포저 위까지가 최대). 기억한다.
  // 대화·입력줄의 최대 폭. 넘는 만큼은 양옆 여백이 되고 가운데 정렬된다.
  var CHAT_MAX_W = 900;

  // 팝업 셸의 고정 높이. 화면·탭을 바꿔도, 구역을 펼쳐도 이 값 그대로다.
  var HKEY = "gijo:shell:height";
  var shellH = null;
  try { shellH = Number(localStorage.getItem(HKEY)) || null; } catch (e) {}

  // 화면 내용의 실제 높이 — 내용이 짧은 화면에서 팝업이 빈 공간으로 길게 남지 않게(2026-07-26
  // 사용자 지적 "메뉴별 빈 화면 다 없애줘"). 허브면 탭바 + 활성 탭 문서 높이, 단독 페이지면 문서 높이.
  // 같은 출처(file://)라 중첩 프레임까지 읽을 수 있다. 아직 로딩 중이면 null(=꽉 차게).
  function contentHeight(s) {
    try {
      var doc = s.el.contentDocument;
      if (!doc || !doc.body) return null;
      var inner = doc.querySelector(".hub-frame.on");
      if (inner) {
        var barH = 46;
        var hb = doc.querySelector(".hub-bar");
        if (hb) barH = hb.offsetHeight;
        var d2 = inner.contentDocument;
        if (!d2 || !d2.body) return null;
        return barH + Math.max(d2.documentElement.scrollHeight, d2.body.scrollHeight);
      }
      return Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    } catch (e) { return null; }
  }

  // 요약 카드까지의 높이 — 팝업을 열면 그 메뉴 전체를 요약한 카드가 먼저 보이고,
  // 더 볼 게 있으면 아래로 스크롤한다(2026-07-27 사용자 지시).
  // 화면이 [data-gijo-summary]로 "여기까지가 요약"이라고 표시해 둔 경우에만 쓴다 —
  // 표식이 없으면 null을 돌려 기존 '내용 전체 맞춤' 방식으로 떨어진다.
  function summaryHeight(s) {
    try {
      var doc = s.el.contentDocument;
      if (!doc || !doc.body) return null;
      var offset = 0;
      var inner = doc.querySelector(".hub-frame.on");
      if (inner) {
        // ⚠ 허브 탭 줄(.hub-bar) 높이만 더하면 5~20px씩 모자라 카드 아랫줄이 잘렸다(실측).
        //    탭 줄 말고도 감싸는 여백이 있기 때문이다. 안쪽 프레임이 실제로 어디서 시작하는지를
        //    직접 재면 그 여백이 무엇이든 정확히 반영된다.
        offset = Math.round(inner.getBoundingClientRect().top + (doc.documentElement.scrollTop || doc.body.scrollTop || 0));
        doc = inner.contentDocument;
        if (!doc || !doc.body) return null;
      }
      var el = doc.querySelector("[data-gijo-summary]");
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (r.height === 0) return null; // 아직 데이터가 안 채워진 빈 카드 — 다음 주기에 다시 잰다
      var scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
      return offset + Math.round(r.bottom + scrollTop) + 14; // 카드 아래 숨 쉴 여백
    } catch (e) { return null; }
  }

  // 지금 보이는 화면 기준으로 "이 정도면 알맞다"는 높이를 계산한다.
  // 높이를 처음 정할 때와, 손잡이를 더블클릭해 다시 맞출 때만 쓴다 — 평소에는 안 부른다.
  // 아직 화면을 못 읽었으면(로딩 중) null을 돌려, 잘못된 값으로 고정되는 걸 막는다.
  function autoHeight(maxFit) {
    var s0 = findSlot(activeKey);
    if (!s0) return null;
    var headH = document.getElementById("shellHead").offsetHeight || 38;
    var sh = summaryHeight(s0);
    if (sh) {
      // 요약 카드가 있는 화면 — 딱 그 카드까지만. 여기서는 55% 하한을 쓰지 않는다:
      // 그 하한은 '내용 전체'를 잴 때 측정이 빗나가는 걸 막으려던 안전장치인데,
      // 요약 카드는 특정 요소를 직접 재므로 값이 정확하고, 하한을 두면 카드보다
      // 한참 큰 팝업이 열려 "요약만 보이게" 하려는 목적 자체가 사라진다.
      return Math.min(maxFit, Math.max(200, sh + headH));
    }
    var ch = contentHeight(s0);
    if (!ch) return null;
    // 요약 표식이 없는 화면 — 내용 전체를 재는데 값이 실제보다 작게 나오는 경우가 있어
    // (요소 높이가 뷰포트에 묶인 화면) 덜 줄이는 쪽으로 하한을 둔다.
    var minFit = Math.max(360, Math.round(maxFit * 0.55));
    return Math.min(maxFit, Math.max(minFit, ch + headH + 12));
  }

  // ── 위치 계산 — 사이드바 오른쪽 ~ 엣지 거터(46px), 관리 바 아래 ~ 컴포저 위 ──
  function layout() {
    if (!visible) return;
    var nav = document.getElementById("gijoNav");
    var navRight = 8;
    if (nav && nav.offsetParent && !document.body.classList.contains("gn-left-collapsed")) {
      navRight = Math.round(nav.getBoundingClientRect().right) + 8;
    }
    var top = Math.round(bar.getBoundingClientRect().bottom) + 8;
    var acc = document.getElementById("accConsole");
    var accH = acc ? acc.offsetHeight : 120;
    var right = 54; // 엣지 탭 거터 46px + 여백
    // 높이: 자동=내용 높이에 맞춤(최대는 컴포저 위까지 — 내용이 짧으면 팝업도 짧게, 빈 공간 없음).
    // 손잡이로 직접 줄였으면 그 높이 우선(최소 240px, 컴포저 침범 금지).
    // 팝업 아래 남는 공간은 대화 이력(cl-rows)이 받아 늘어난다(2026-07-26 사용자 요청).
    var rows = acc ? acc.querySelector(".cl-rows") : null;
    var rowsH = rows ? rows.offsetHeight : 0;
    var nonRows = accH - rowsH; // 이력을 뺀 컴포저 몸통(입력줄·팁 등) 높이
    var baseMinGap = (nonRows + 110) + 20; // 이력이 기본(110px)일 때 필요한 최소 바닥 여백
    // ── 높이는 고정이다(2026-07-27 결정) ──────────────────────────────────
    // 예전에는 보이는 화면 내용에 맞춰 매번 다시 쟀다. 그러면 탭을 옮길 때마다 팝업이
    // 커졌다 작아지고, 그만큼 아래 명령창·대화가 위아래로 밀린다(실측: 리포트 259 →
    // 보안KPI 387 → 컴플라이언스 221, 한 번에 166px). 구역 접기가 들어오면 펼칠 때마다
    // 또 출렁여서 접기 자체가 불쾌해진다. 그래서 높이는 한 번 정하면 그대로 둔다.
    //   · 저장값이 있으면 그 값(손잡이로 조절했거나, 예전에 자동으로 정해 둔 값)
    //   · 없으면 지금 보이는 화면의 요약 카드 기준으로 정하고 **바로 저장**한다
    //   · 손잡이 더블클릭 = 지금 화면 기준으로 다시 맞춰 저장(아래 dblclick 참고)
    var maxFit = window.innerHeight - top - baseMinGap;
    var wantH = null; // 팝업이 갖고 싶은 높이
    if (shellH) {
      wantH = Math.min(maxFit, Math.max(240, shellH));
    } else {
      var auto = autoHeight(maxFit);
      if (auto) {
        wantH = auto;
        shellH = auto;
        try { localStorage.setItem(HKEY, String(Math.round(auto))); } catch (e) {}
      }
    }
    var gap;
    if (wantH) {
      gap = Math.max(baseMinGap, window.innerHeight - top - wantH);
    } else {
      gap = (acc ? acc.offsetHeight : accH) + 20;
    }
    // 이력 높이는 더 이상 계산하지 않는다 — 컴포저가 팝업 아래 공간을 통째로 차지하고(top 지정),
    // 이력이 그 안에서 flex로 늘어난다. 픽셀로 맞추던 방식은 빈 공간을 남겼다.
    if (rows) rows.style.maxHeight = "";
    layer.style.left = navRight + "px";
    layer.style.top = top + "px";
    layer.style.right = right + "px";
    layer.style.bottom = gap + "px";
    // 배경막 — 관리 바 아래 전부(사이드바 제외). 오른쪽 엣지 탭(z900)은 위에 떠서 계속 눌린다.
    dim.style.left = navRight + "px";
    dim.style.top = Math.round(bar.getBoundingClientRect().bottom) + "px";
    dim.style.right = "0";
    dim.style.bottom = "0";
    if (acc) {
      // 팝업 아래부터 화면 바닥까지를 대화 영역이 채운다(2026-07-27).
      // 예전에는 컴포저가 내용 높이만큼만 차지해, 팝업과 대화 사이에 넓은 빈 공간이 남았다.
      // 팝업 높이가 고정으로 바뀌면서 그 공백이 더 눈에 띄었다("뒷배경이 더 안 좋아졌다").
      acc.style.top = (top + (wantH || 0) + 8) + "px";
      // 대화·입력줄은 **읽기 좋은 폭으로 가운데** 둔다(2026-07-27).
      // 팝업은 표·목록이라 넓을수록 좋지만, 대화는 글이라 줄이 길면 다음 줄을 눈으로 찾다가
      // 이해가 떨어진다(권장 한 줄 45~75자 ≈ 660~780px). 실측 1056px은 한글 약 90자로 너무 길었다.
      // 우리 대화에는 승인 카드·근거 배지·KPI 줄이 섞여 들어와 순수 글보다 조금 넓은 900px로 잡는다.
      var bandW = window.innerWidth - navRight - right;
      var pad = Math.max(0, Math.round((bandW - Math.min(CHAT_MAX_W, bandW)) / 2));
      acc.style.left = (navRight + pad) + "px";
      acc.style.right = (right + pad) + "px";
    }
  }
  window.addEventListener("resize", layout);
  new MutationObserver(layout).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if (window.ResizeObserver) {
    var acc0 = document.getElementById("accConsole");
    if (acc0) new ResizeObserver(layout).observe(acc0);
  }

  // ── 저장/복원 ───────────────────────────────────────────────────────
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        slots: slots.map(function (s) { return { key: s.key, label: s.label, pinned: s.pinned }; }),
        active: activeKey, visible: visible,
      }));
    } catch (e) {}
  }

  // ── 렌더 ────────────────────────────────────────────────────────────
  function findSlot(key) { for (var i = 0; i < slots.length; i++) if (slots[i].key === key) return slots[i]; return null; }

  function renderBar() {
    var box = document.getElementById("sbSlots");
    box.innerHTML = "";
    slots.forEach(function (s) {
      var el = document.createElement("span");
      el.className = "sb-slot" + (visible && s.key === activeKey ? " on" : "");
      el.title = s.label + (visible && s.key === activeKey ? " — 클릭하면 대시보드로" : " — 클릭하면 이 화면으로");
      el.innerHTML = (s.pinned ? '<span class="pinm">📌</span>' : "") + '<span class="dot"></span><span class="nm"></span><span class="x" title="닫기">✕</span>';
      el.querySelector(".nm").textContent = s.label;
      el.addEventListener("click", function (ev) {
        if (ev.target.classList.contains("x")) { close(s.key); return; }
        if (visible && s.key === activeKey) minimize(); else focusSlot(s.key);
      });
      box.appendChild(el);
      s.slotEl = el;
    });
    bar.classList.toggle("has", slots.length > 0);
  }

  function renderHead() {
    var s = findSlot(activeKey);
    if (!s) return;
    document.getElementById("shTitle").textContent = s.curLabel || s.label;
    document.getElementById("shPin").classList.toggle("pin-on", Boolean(s.pinned));
    renderCtx();
  }

  // ── 동작 ────────────────────────────────────────────────────────────
  function embedSrc(page) { return page + (page.indexOf("?") >= 0 ? "&" : "?") + "embed=1"; }

  // 팝업 iframe 생성 공통 — 서브프레임 preload 주입 경합을 피한다(실측 플레이크):
  // ① src는 붙인 뒤 다음 프레임에 설정 ② load 직후 gijo 없으면 즉시 1회 재로드(치유).
  function makeFrame(page, s) {
    var f = document.createElement("iframe");
    document.getElementById("shellBody").appendChild(f);
    f.addEventListener("load", function () {
      try {
        if (f.contentDocument && !f.contentWindow.gijo && !s.healed) { s.healed = true; f.src = embedSrc(page); return; }
      } catch (e) {}
      setTimeout(layout, 300); // 내용 높이 반영
    });
    requestAnimationFrame(function () { f.src = embedSrc(page); });
    return f;
  }

  // 화면 파일명(예: vulnscan.html) → 팝업 대상 해석 — 허브에 품긴 화면이면 그 허브+탭으로.
  // "내 업무 바로가기" 타일이 쓴다(옛날처럼 전체 이동하지 않게, 2026-07-26 사용자 요청).
  function resolvePage(page) {
    if (/^hub\.html/.test(page)) return { key: page.split("&t=")[0].split("?t=")[0], label: page, tab: null };
    if (page === "approvals.html") return { key: page, label: "조치·승인", tab: null };
    if (page === "redteam.html") return { key: page, label: "레드팀·가드레일", tab: null };
    var hubs = window.gijoHubs || {};
    for (var g in hubs) {
      var tabs = hubs[g].tabs || [];
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].page === page) return { key: "hub.html?g=" + g, label: hubs[g].ic + " " + hubs[g].label, tab: page };
      }
    }
    return null;
  }

  function open(page, label, opts) {
    opts = opts || {};
    var s = findSlot(page);
    if (!s) {
      // 상한 초과 — 핀 없는 가장 오래 안 본 팝업부터 자동으로 닫는다(전부 핀이면 거절).
      if (slots.length >= MAX) {
        var victims = slots.filter(function (x) { return !x.pinned; }).sort(function (a, b) { return a.lastActive - b.lastActive; });
        if (!victims.length) { showToast("팝업 5개가 모두 📌핀 고정이라 새로 열 수 없습니다 — 하나를 닫거나 핀을 풀어주세요"); return; }
        showToast('"' + victims[0].label + '" 팝업을 자동으로 닫았습니다 (동시 5개까지)');
        close(victims[0].key, true);
      }
      s = { key: page, label: label || page, pinned: false, lastActive: Date.now(), curTab: null, curLabel: null, el: null };
      // 시작 탭 지정(opts.tab) — 허브 첫 로드부터 그 탭이 뜨게 t 파라미터로
      s.el = makeFrame(opts.tab ? page + (page.indexOf("?") >= 0 ? "&" : "?") + "t=" + opts.tab : page, s);
      slots.push(s);
    } else if (opts.tab) {
      // 이미 떠 있는 허브 팝업이면 메시지로 탭만 전환
      setTimeout(function () { try { s.el.contentWindow.postMessage({ type: "gijo:showTab", page: opts.tab }, "*"); } catch (e) {} }, 100);
    }
    focusSlot(page);
    if (opts.chat) { // 챗봇 열기 — 이미 떠 있던 팝업이면 메시지로, 새로 열리면 openChatOnLoad 플래그가 처리
      setTimeout(function () { try { s.el.contentWindow.postMessage({ type: "gijo:openChat" }, "*"); } catch (e) {} }, 600);
    }
    // 이 화면이 뭘 하는 곳인지 대시보드 대화에 띄운다(화면당 한 번).
    // 허브 팝업은 여기서 탭을 아직 모를 수 있다 — 그때는 아래 gijo:hubTab 통지가 받아서 부른다.
    announceGuide(opts.tab || (page.indexOf("hub.html") === 0 ? null : page), label);
  }

  // 화면 안내 — 팝업 머리 아래 **얇은 한 줄**로 보여 준다(2026-07-27 개편).
  //
  // ⚠ 처음에는 이 안내를 대시보드 대화에 띄웠다. 실화면을 보니 대화가 안내 게시판이 됐다 —
  //   화면을 셋 열면 안내 카드도 셋이 쌓여 정작 사용자 대화가 밀려났다(대화는 10줄만 남는다).
  //   안내는 "그 화면에 대한 것"이므로 그 화면 위에 있는 게 맞다. 대화는 대화에만 쓴다.
  // 한 줄에는 화면이 하는 일만 적고, 누르면 자세한 안내를 대화로 보낸다(그때는 사용자가 원한 것).
  var guideBar = null;
  var guideFor = null;   // 지금 줄이 설명하고 있는 화면
  function ensureGuideBar() {
    if (guideBar) return guideBar;
    guideBar = document.createElement("div");
    guideBar.id = "shellGuide";
    guideBar.style.cssText = "display:none;align-items:center;gap:7px;padding:5px 12px;" +
      "background:rgba(59,130,246,.08);border-bottom:1px solid var(--border,#1e2a44);" +
      "font-size:11px;color:var(--muted,#8b93ab);line-height:1.5;cursor:pointer;flex:0 0 auto;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    guideBar.title = "눌러서 이 화면 사용법을 자세히 보기";
    guideBar.addEventListener("click", function () {
      if (!guideFor) return;
      try { if (window.gijoScreenGuide) window.gijoScreenGuide(guideFor.screen, guideFor.label, { force: true }); } catch (e) {}
    });
    var head = document.getElementById("shellHead");
    head.parentNode.insertBefore(guideBar, head.nextSibling);
    return guideBar;
  }
  function announceGuide(screen, label) {
    var bar = ensureGuideBar();
    if (!screen) { bar.style.display = "none"; guideFor = null; return; }
    guideFor = { screen: screen, label: label };
    bar.style.display = "none";
    if (!window.gijo || !window.gijo.screenGuide) return;
    window.gijo.screenGuide(screen).then(function (g) {
      if (!g || !g.what || !guideFor || guideFor.screen !== screen) return;
      bar.textContent = "🤖 " + g.what;
      bar.style.display = "flex";
      layout(); // 줄이 생기면 안쪽 높이가 줄어든다 — 요약 카드가 잘리지 않게 다시 잰다
    }).catch(function () { /* 안내를 못 받아도 화면 사용에는 지장 없다 */ });
  }

  // 내용은 데이터가 도착하며 자라거나 준다 — 보이는 동안 1.2초마다 가볍게 재계산(DOM 읽기뿐).
  // 같은 주기에 preload 주입 누락도 치유한다: 서브프레임 preload(window.gijo)가 간헐적으로
  // 안 실리는 Electron 플레이크가 실측됨(허브 탭 0개·isAuthenticated undefined) — 1회 재로드로 회복.
  function healMissingPreload() {
    slots.forEach(function (s) {
      try {
        if (!s.healed && s.el.contentDocument && s.el.contentDocument.readyState === "complete" && !s.el.contentWindow.gijo) {
          s.healed = true; // 무한 재로드 방지 — 한 번만
          s.el.src = s.el.src;
          return;
        }
        // 허브 팝업은 프레임이 두 겹이다(hub.html 안에 실제 화면). 바깥이 멀쩡해도
        // 안쪽만 preload를 놓치는 경우가 있다 — 그러면 화면은 그려지는데 데이터가 영영
        // 안 들어온다(실측 2026-07-27: 유지보수 KPI가 계속 "-"). 바깥만 보던 치유를
        // 안쪽까지 넓힌다. 표시는 프레임 엘리먼트에 달아 탭마다 한 번씩만 고친다.
        var doc = s.el.contentDocument;
        if (!doc || !s.el.contentWindow.gijo) return;
        var inner = doc.querySelector(".hub-frame.on");
        if (!inner || inner.__gijoHealed) return;
        if (inner.contentDocument && inner.contentDocument.readyState === "complete" && !inner.contentWindow.gijo) {
          inner.__gijoHealed = true;
          inner.src = inner.src;
        }
      } catch (e) {}
    });
  }
  var layoutTimer = null;
  function startWatch() { if (!layoutTimer) layoutTimer = setInterval(function () { if (visible) { healMissingPreload(); layout(); } }, 1200); }
  function stopWatch() { if (layoutTimer) { clearInterval(layoutTimer); layoutTimer = null; } }

  function focusSlot(key) {
    var s = findSlot(key);
    if (!s) return;
    activeKey = key;
    s.lastActive = Date.now();
    ctxDash = false; // 팝업을 열거나 전환하면 그 화면이 곧 지시 맥락
    visible = true;
    startWatch();
    document.body.classList.add("shell-popped");
    layer.classList.add("on");
    dim.classList.add("on");
    Array.prototype.forEach.call(document.getElementById("shellBody").children, function (f) { f.classList.remove("on"); });
    s.el.classList.add("on");
    renderBar(); renderHead(); layout(); persist();
  }

  function minimize() { // 팝업은 슬롯에 살아있고 화면만 대시보드로
    visible = false;
    stopWatch();
    layer.classList.remove("on");
    dim.classList.remove("on");
    document.body.classList.remove("shell-popped");
    var acc = document.getElementById("accConsole");
    if (acc) {
      // top도 반드시 지운다 — 안 지우면 팝업을 닫은 뒤에도 컴포저가 화면 중간에 붙어 있다.
      acc.style.left = ""; acc.style.right = ""; acc.style.top = "";
      var rows = acc.querySelector(".cl-rows");
      if (rows) rows.style.maxHeight = ""; // 확장했던 이력 높이 원복
    }
    if (chatInputEl && basePlaceholder) chatInputEl.placeholder = basePlaceholder; // 안내문 원복
    renderBar(); persist();
  }

  function close(key, silent) {
    var s = findSlot(key);
    if (!s) return;
    if (s.el && s.el.parentNode) s.el.remove();
    slots = slots.filter(function (x) { return x.key !== key; });
    if (activeKey === key) {
      activeKey = null;
      if (visible) {
        var next = slots.slice().sort(function (a, b) { return b.lastActive - a.lastActive; })[0];
        if (next) { focusSlot(next.key); return; }
        minimize();
      }
    }
    renderBar(); persist();
    if (!silent && !slots.length) showToast("팝업을 모두 닫았습니다");
  }

  // ── 헤더 버튼 ───────────────────────────────────────────────────────
  document.getElementById("shPin").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    s.pinned = !s.pinned;
    renderBar(); renderHead(); persist();
  });
  document.getElementById("shReload").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    try { s.el.contentWindow.location.reload(); } catch (e) { s.el.src = embedSrc(s.key); }
  });
  document.getElementById("shPopout").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    if (window.gijo && window.gijo.openShellPopout) {
      window.gijo.openShellPopout(s.key, s.label);
      close(s.key, true); // 분리한 창은 슬롯에서 빠진다(상한 미점유)
      showToast('"' + s.label + '"을(를) 별도 창으로 분리했습니다 — 가로/세로는 그 창에서 바꿉니다');
    }
  });
  document.getElementById("shFull").addEventListener("click", function () {
    var s = findSlot(activeKey); if (!s) return;
    if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(s.key);
  });
  document.getElementById("shMin").addEventListener("click", minimize);
  document.getElementById("shClose").addEventListener("click", function () { close(activeKey); });

  // 머리 우클릭 메뉴 — 자주 안 쓰는 셋(핀·새로고침·접기)이 여기로 들어왔다.
  // 숨겨 둔 버튼을 그대로 눌러 실행하므로 동작 코드는 위 한 벌만 유지된다.
  var headMenu = document.createElement("div");
  headMenu.id = "shellHeadMenu";
  headMenu.style.cssText = "position:fixed;display:none;z-index:1300;background:var(--panel-2,#0e1526);" +
    "border:1px solid var(--border-strong,#28365a);border-radius:9px;padding:5px;min-width:150px;" +
    "box-shadow:0 10px 30px rgba(0,0,0,.55);font-size:12px;";
  document.body.appendChild(headMenu);
  function hideHeadMenu() { headMenu.style.display = "none"; }
  document.addEventListener("click", hideHeadMenu);
  window.addEventListener("blur", hideHeadMenu);
  document.getElementById("shellHead").addEventListener("contextmenu", function (e) {
    e.preventDefault();
    var s = findSlot(activeKey);
    headMenu.innerHTML = "";
    [
      { label: (s && s.pinned ? "📌 핀 풀기" : "📌 핀 고정 — 자동 닫힘에서 제외"), id: "shPin" },
      { label: "⟳ 새로고침", id: "shReload" },
      { label: "▁ 접기 — 대시보드로 (팝업은 유지)", id: "shMin" },
    ].forEach(function (it) {
      var b = document.createElement("div");
      b.textContent = it.label;
      b.style.cssText = "padding:7px 10px;border-radius:6px;cursor:pointer;color:var(--text,#e6eaf3);white-space:nowrap;";
      b.addEventListener("mouseenter", function () { b.style.background = "rgba(255,255,255,.06)"; });
      b.addEventListener("mouseleave", function () { b.style.background = ""; });
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        hideHeadMenu();
        document.getElementById(it.id).click();
      });
      headMenu.appendChild(b);
    });
    headMenu.style.display = "block";
    // 화면 밖으로 나가지 않게 오른쪽·아래를 넘으면 안쪽으로 당긴다.
    headMenu.style.left = Math.min(e.clientX, window.innerWidth - headMenu.offsetWidth - 8) + "px";
    headMenu.style.top = Math.min(e.clientY, window.innerHeight - headMenu.offsetHeight - 8) + "px";
  });
  document.getElementById("sbCloseAll").addEventListener("click", function () {
    slots.slice().forEach(function (s) { close(s.key, true); });
    showToast("팝업을 모두 닫았습니다");
  });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && visible) minimize(); });
  dim.addEventListener("click", minimize); // 배경막 클릭 = 대시보드로(모달 관례)

  // 아래 모서리 끌어서 높이 조절 — 드래그 중엔 iframe이 마우스를 삼키지 않게 잠시 꺼둔다.
  var grip = document.getElementById("shellGrip");
  grip.addEventListener("mousedown", function (e) {
    e.preventDefault();
    var startY = e.clientY, startH = layer.offsetHeight;
    grip.classList.add("drag");
    document.body.style.userSelect = "none";
    var frames = document.querySelectorAll("#shellBody iframe");
    Array.prototype.forEach.call(frames, function (f) { f.style.pointerEvents = "none"; });
    function mv(ev) { shellH = Math.max(240, startH + (ev.clientY - startY)); layout(); }
    function up() {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
      grip.classList.remove("drag");
      document.body.style.userSelect = "";
      Array.prototype.forEach.call(frames, function (f) { f.style.pointerEvents = ""; });
      try { localStorage.setItem(HKEY, String(Math.round(shellH))); } catch (e2) {}
    }
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  });
  // 더블클릭 = "지금 보이는 화면에 맞춰 다시" — 예전엔 자동 모드로 되돌리는 뜻이었는데,
  // 높이가 고정으로 바뀐 뒤로는 되돌릴 자동 모드가 없다. 대신 이 화면 기준으로 한 번
  // 다시 재서 그 값으로 고정한다(요약 카드까지). 화면마다 알맞은 크기를 되찾는 길이다.
  grip.addEventListener("dblclick", function () {
    var top = Math.round(bar.getBoundingClientRect().bottom) + 8;
    var acc = document.getElementById("accConsole");
    var accH = acc ? acc.offsetHeight : 120;
    var rows = acc ? acc.querySelector(".cl-rows") : null;
    var nonRows = accH - (rows ? rows.offsetHeight : 0);
    var h = autoHeight(window.innerHeight - top - (nonRows + 110 + 20));
    if (!h) { showToast("화면을 아직 읽는 중입니다 — 잠시 후 다시 눌러 주세요"); return; }
    shellH = h;
    try { localStorage.setItem(HKEY, String(Math.round(h))); } catch (e) {}
    layout();
    showToast("이 화면에 맞춰 팝업 높이를 " + Math.round(h) + "px로 맞췄습니다");
  });

  // ＋ 메뉴 — 팝업으로 열 수 있는 화면 목록(nav.js GROUPS의 popup:true와 같은 목록 유지)
  var PLUS_ITEMS = [
    { page: "hub.html?g=analysis", label: "📈 보안 분석" },
    { page: "hub.html?g=threat", label: "🌐 위협 인텔리전스" },
    { page: "hub.html?g=report", label: "📄 리포트" },
    { page: "hub.html?g=assets", label: "🛡 자산 허브" },
    { page: "approvals.html", label: "✅ 조치·승인" },
    { page: "hub.html?g=products", label: "🧰 보안제품" },
    { page: "hub.html?g=inspect", label: "🛰 점검 콘솔" },
    { page: "hub.html?g=aiknowledge", label: "🧠 AI 지식·모델" },
    { page: "redteam.html", label: "🛡 레드팀·가드레일" },
  ];
  document.getElementById("sbPlus").addEventListener("click", function (ev) {
    ev.stopPropagation();
    plus.innerHTML = "";
    PLUS_ITEMS.forEach(function (it) {
      var d = document.createElement("div");
      d.className = "pi"; d.textContent = it.label;
      d.addEventListener("click", function () { plus.style.display = "none"; open(it.page, it.label.replace(/^\S+\s/, "")); });
      plus.appendChild(d);
    });
    var r = ev.target.getBoundingClientRect();
    plus.style.left = Math.max(8, r.right - 160) + "px";
    plus.style.top = (r.bottom + 6) + "px";
    plus.style.display = "block";
  });
  document.addEventListener("click", function () { plus.style.display = "none"; });

  // 맥락 전환(칩) — 팝업·분리창은 그대로 두고 지시 맥락만 토글(대시보드 ↔ 보고 있는 화면)
  var sw = document.getElementById("shCtxSwitch");
  if (sw) sw.addEventListener("click", function () { ctxDash = !ctxDash; renderCtx(); });

  // ── 분리창 맥락 수신 ────────────────────────────────────────────────
  if (window.gijo && window.gijo.onPopoutContext) {
    window.gijo.onPopoutContext(function (kind, info) {
      var key = info && info.key;
      if (!key) return;
      if (kind === "closed") {
        delete popouts[key];
        if (activePopout === key) activePopout = null;
      } else if (kind === "focus") {
        popouts[key] = popouts[key] || { label: info.label || key };
        popouts[key].key = key;
        activePopout = key;   // 그 창을 봤다 = 그 화면이 맥락
        ctxDash = false;      // 새 창을 보면 대시보드 고정은 푼다
      } else if (kind === "tab") {
        popouts[key] = popouts[key] || { label: info.label || key };
        popouts[key].key = key;
        popouts[key].tab = info.page;
        popouts[key].tabLabel = info.label;
        if (info.focused) { activePopout = key; ctxDash = false; }
        // 분리창에서 화면을 옮겨도 안내는 대시보드 대화에 뜬다 — 설명 창구는 한 곳뿐이다.
        announceGuide(info.page, info.label);
      }
      renderCtx();
    });
  }

  // ⚠ 대시보드에 포커스가 왔다고 분리창 맥락을 풀지 않는다.
  //    처음엔 "보고 있는 창이 맥락"으로 만들었다가 실화면 검증에서 설계 결함이 드러났다:
  //    **명령을 치려면 대시보드에 포커스해야 하는데**, 그 순간 맥락이 사라져 기능이 무용지물이 된다.
  //    모니터 2대에서 분리창을 보며 대시보드에 지시하는 것이 바로 이 기능의 목적이다.
  //    그래서 분리창은 **마지막으로 본 창**으로 유지하고, 해제는 칩(대시보드 맥락으로)이나
  //    창을 닫을 때만 한다.

  // ── 허브 활성 탭 통지 수신 — 명령 맥락(screen)이 탭 단위로 정확해진다 ──
  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || d.type !== "gijo:hubTab") return;
    var s = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].el && slots[i].el.contentWindow === ev.source) { s = slots[i]; break; }
    }
    if (!s) return;
    s.curTab = d.page;
    s.curLabel = d.label;
    if (s.key === activeKey) { renderHead(); layout(); } // 탭이 바뀌면 내용 높이도 다시 잰다
    // 탭도 하나의 화면이다 — 탭을 옮기면 그 탭의 안내를 띄운다(탭당 한 번).
    announceGuide(d.page, d.label);
  });

  // ── 공개 API ────────────────────────────────────────────────────────
  window.gijoShell = {
    open: open,
    hide: minimize, // "내 업무 바로가기" 등 대시보드 위 다른 팝업이 먼저 접으라고 부른다
    // 화면 파일명으로 열기 — 허브 소속이면 그 허브+탭 팝업. 못 풀면 false(호출자가 기존 이동).
    openPage: function (page) {
      var r = resolvePage(page);
      if (!r) return false;
      open(r.key, r.label, { tab: r.tab });
      return true;
    },
    // 지시의 화면 맥락 — 팝업이 보이는 동안은 그 팝업(허브면 활성 탭 파일명).
    // 사용자가 칩으로 "대시보드 맥락"을 골랐으면 팝업이 떠 있어도 대시보드 기본.
    activeScreen: function () {
      // 분리창을 보고 있으면 그 화면이 맥락(팝업보다 우선).
      if (activePopout && popouts[activePopout] && !ctxDash) {
        var p = popouts[activePopout];
        return p.tab || (p.key && p.key.indexOf("hub.html") === 0 ? undefined : p.key);
      }
      if (!visible || ctxDash) return undefined;
      var s = findSlot(activeKey);
      if (!s) return undefined;
      return s.curTab || (s.key.indexOf("hub.html") === 0 ? undefined : s.key);
    },
  };

  // ── 복원 — 대시보드를 다시 열어도 팝업 구성이 살아난다(화면 내부 상태는 새로 로드) ──
  // 문서 파싱 중에 iframe을 만들면 서브프레임 preload 주입이 간헐적으로 빠진다(실측) —
  // 페이지 load 후로 미룬다(위 heal이 이중 안전망).
  function restoreSaved() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.slots && saved.slots.length) {
        saved.slots.slice(0, MAX).forEach(function (s0) {
          var s = { key: s0.key, label: s0.label, pinned: Boolean(s0.pinned), lastActive: Date.now(), curTab: null, curLabel: null, el: null };
          s.el = makeFrame(s0.key, s);
          slots.push(s);
        });
        renderBar();
        if (saved.visible && saved.active && findSlot(saved.active)) focusSlot(saved.active);
      }
    } catch (e) {}
  }
  if (document.readyState === "complete") setTimeout(restoreSaved, 200);
  else window.addEventListener("load", function () { setTimeout(restoreSaved, 200); });
})();
