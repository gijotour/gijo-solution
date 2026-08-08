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
      "#consoleHost{display:flex;flex-direction:column;min-height:0;height:100%;background:var(--panel-2,#1f1e1d);}",
      ".cs-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:12.25px;color:var(--muted,#b3ada4);border-bottom:1px solid rgba(255,255,255,.05);}",
      ".cs-ctx{background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);color:var(--blue-light,#5fa1ff);border-radius:14px;padding:2px 10px;font-weight:800;white-space:nowrap;}",
      ".cs-hint{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}",
      ".cs-btn{flex:0 0 auto;font-size:12.25px;font-weight:700;color:var(--muted,#b3ada4);background:transparent;border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:3px 9px;cursor:pointer;white-space:nowrap;}",
      ".cs-btn:hover{color:#fff;border-color:var(--blue,#3b82f6);}",
      // 대화는 **아래에 붙인다**(2026-08-02 사용자 지적 "대화창 아래 빈칸?").
      // 대화가 짧으면 아래가 238px 비어 있었고, 새 답변이 입력칸에서 멀리 떨어져 나왔다.
      // ⚠ justify-content:flex-end로 밀면 대화가 길어졌을 때 **위가 잘려 못 올라간다**(크롬 알려진 문제).
      //   첫 자식에 margin-top:auto를 주면 짧을 땐 아래로 붙고, 길어지면 자동으로 0이 돼 정상 스크롤된다.
      ".cs-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px;display:flex;flex-direction:column;}",
      ".cs-body > *:first-child{margin-top:auto;}",
      ".cs-empty{color:var(--muted-2,#a49d95);font-size:12px;padding:10px 0;}",
      ".cs-row{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.03);}",
      ".cs-row .ci{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:rgba(59,130,246,.16);display:flex;align-items:center;justify-content:center;font-size:12.25px;}",
      ".cs-row.instr .ci{background:rgba(30,185,128,.16);}",
      ".cs-row.error .ci{background:rgba(226,72,61,.18);}",
      ".cs-row .cb{flex:1;min-width:0;}",
      ".cs-row .cn{font-size:12px;font-weight:800;color:var(--muted,#b3ada4);margin-bottom:2px;}",
      ".cs-row .cn .ct{font-weight:500;color:var(--muted-2,#a49d95);margin-left:6px;}",
      ".cs-row .cm{font-size:12.5px;color:var(--text,#e9e7e2);word-break:break-word;line-height:1.62;}",
      // 마크다운으로 그린 답 — **표·목록·굵은 글씨**가 좁은 창에서도 읽히게(2026-07-31).
      // ⚠ 표는 폭이 좁으면 글자가 겹친다 → 표만 가로 스크롤을 준다(창은 안 밀린다).
      // ── 메뉴 연동 재설계(2026-08-09 시안 승인) ──────────────────────────
      // 절차 띠 — 업무 5단계에서 지금 어디인지. 앞·다음을 누르면 그 탭이 열린다.
      ".cs-flow{display:flex;align-items:center;gap:5px;padding:0 12px 7px;font-size:11px;color:var(--muted-2,#a49d95);flex-wrap:wrap;}",
      ".cs-flow .st{border:1px solid var(--border,rgba(255,255,255,.12));border-radius:5px;padding:1px 7px;cursor:pointer;white-space:nowrap;}",
      ".cs-flow .st:hover{color:var(--blue-light,#7ab0ff);border-color:var(--blue,#3b82f6);}",
      ".cs-flow .st.now{background:rgba(30,185,128,.12);border-color:rgba(30,185,128,.5);color:#5fe0aa;font-weight:800;cursor:default;}",
      // 살아 있는 숫자 — 그 화면의 요약 1줄(절차 띠 데이터 재사용, 새 계산 없음)
      ".cs-live{margin-left:auto;font-size:11.5px;color:var(--muted,#b3ada4);white-space:nowrap;}",
      ".cs-live b{color:#f5928a;font-weight:800;}",
      // 📌 선택 칩 — 화면에서 고른 항목이 「이거」가 된다(2026-08-09 2단계)
      ".cs-sel{font-size:11.5px;font-weight:700;color:#ffd9a8;border:1px solid rgba(240,160,32,.45);border-radius:12px;padding:1px 9px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;}",
      ".cs-sel .x{margin-left:5px;color:var(--muted-2,#a49d95);cursor:pointer;font-weight:400;}",
      ".cs-sel .x:hover{color:#f5928a;}",
      // 맥락 떼기 ✕ — VS Code implicit context의 결론(보이게+뗄 수 있게)을 처음부터
      ".cs-ctx .x{margin-left:5px;color:var(--muted-2,#a49d95);cursor:pointer;font-weight:400;}",
      ".cs-ctx .x:hover{color:#f5928a;}",
      ".cs-ctx.off{opacity:.55;text-decoration:line-through;}",
      // 화면별 칩 — 그 화면에서 실제로 하는 물음 3~5개(첫 칩은 항상 ⓘ)
      ".cs-chips{display:flex;flex-wrap:wrap;gap:5px;padding:8px 11px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));}",
      ".cs-chip{font-size:11.75px;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:13px;padding:2px 10px;",
      "cursor:pointer;color:var(--text,#e9e7e2);background:transparent;white-space:nowrap;}",
      ".cs-chip:hover{border-color:var(--teal,#1eb980);color:var(--teal,#1eb980);}",
      ".cs-chip.ok{border-style:dashed;}", // 점선 = 승인 후 실행
      // 화면 안내 카드 — ⓘ 답이 말풍선으로 쌓이지 않고 이 카드 한 장을 갈아끼운다(중복 구조적 차단)
      ".cs-guide{margin:0 0 4px;border:1px solid var(--border,rgba(255,255,255,.1));border-left:3px solid var(--blue,#3b82f6);",
      "border-radius:8px;background:var(--panel-2,#1f1e1d);padding:8px 10px;font-size:12px;color:var(--muted,#b3ada4);}",
      ".cs-guide .gh{display:flex;align-items:center;gap:6px;color:#fff;font-weight:700;font-size:12px;cursor:pointer;user-select:none;}",
      ".cs-guide .gh .car{margin-left:auto;color:var(--muted-2,#a49d95);font-size:11px;}",
      ".cs-guide .gb{margin-top:6px;display:none;line-height:1.6;}",
      ".cs-guide.open .gb{display:block;}",
      // 화면 전환 구분선 — 답의 소속을 가른다
      ".cs-div{display:flex;align-items:center;gap:8px;color:var(--muted-2,#a49d95);font-size:11px;margin:2px 0;}",
      ".cs-div::before,.cs-div::after{content:'';flex:1;border-top:1px solid var(--border,rgba(255,255,255,.08));}",
      // 해석 한 줄 — 질문을 무엇으로 알아들었는지(어긋나면 그 자리에서 보인다)
      ".cs-parse{font-size:11px;color:var(--muted-2,#a49d95);margin-bottom:3px;}",
      // 서랍 — 무엇을 할 수 있나. 접혀 있는 게 기본(대화가 주인공이다).
      ".cs-drawer{flex:0 0 auto;border-bottom:1px solid var(--border,rgba(255,255,255,.08));background:var(--panel-2,#1f1e1d);}",
      ".cs-dh{display:flex;align-items:center;gap:7px;padding:7px 11px;cursor:pointer;font-size:12.5px;user-select:none;}",
      ".cs-dh .car{color:var(--muted-2,#a49d95);font-size:11.25px;}",
      ".cs-dh b{color:#fff;font-weight:800;}",
      ".cs-dh .n{margin-left:auto;color:var(--muted-2,#a49d95);font-size:11.75px;}",
      // ＋ 등록 — 개수 오른쪽(2026-08-02 사용자 지시)
      ".cs-add{font-size:11.75px;font-weight:800;color:var(--blue-light,#7ab0ff);border:1px solid rgba(59,130,246,.4);",
      "border-radius:7px;padding:3px 9px;cursor:pointer;flex:0 0 auto;}",
      ".cs-add:hover{background:rgba(59,130,246,.14);}",
      ".cs-addbox{padding:9px 11px;border-top:1px solid var(--border,rgba(255,255,255,.08));display:flex;flex-wrap:wrap;gap:6px;align-items:center;}",
      ".cs-addbox input{flex:1 1 200px;min-width:0;background:var(--bg,#262624);border:1px solid var(--border-strong,rgba(255,255,255,.18));",
      "border-radius:8px;padding:7px 10px;color:var(--text,#e9e7e2);font-size:12.5px;outline:none;font-family:inherit;}",
      ".cs-addbox button{font-size:12px;font-weight:800;border-radius:8px;padding:7px 12px;cursor:pointer;border:1px solid rgba(59,130,246,.5);",
      "background:rgba(59,130,246,.18);color:#fff;font-family:inherit;flex:0 0 auto;}",
      ".cs-addbox button.ghost{background:transparent;border-color:var(--border-strong,rgba(255,255,255,.18));color:var(--muted,#b3ada4);}",
      ".cs-addbox .hint{flex:1 1 100%;font-size:11.75px;color:var(--muted-2,#a49d95);}",
      ".cs-del{margin-left:auto;font-size:12px;opacity:.55;flex:0 0 auto;}",
      ".cs-del:hover{opacity:1;}",
      ".b-mine{background:rgba(240,160,32,.16);color:var(--amber,#f0a020);}",
      // 「지금 화면」 — 보고 있는 탭에서 할 수 있는 갈래(2026-08-06)
      ".b-now{background:rgba(59,130,246,.18);color:var(--blue-light,#7ab0ff);}",
      // 펼쳤을 때 대화를 다 밀어내면 안 된다 — 최대 높이를 주고 그 안에서 스크롤한다.
      ".cs-db{max-height:240px;overflow-y:auto;padding:2px 0 7px;}",
      // 갈래 한 줄 — 누르면 그 갈래 질문이 대화에 뜬다.
      ".cs-catrow{display:flex;align-items:center;gap:7px;margin:3px 8px;padding:9px 11px;border-radius:8px;cursor:pointer;",
      "border:1px solid var(--border,rgba(255,255,255,.10));background:var(--panel-2,#1f1e1d);}",
      ".cs-catrow:hover{border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.08);}",
      ".cs-catrow .nm{font-size:13px;font-weight:800;color:var(--text,#e9e7e2);}",
      ".cs-catrow .cs-n{margin-left:auto;font-size:11.75px;font-weight:800;color:var(--muted-2,#a49d95);}",
      // 대화 안에 뜬 질문 묶음
      ".cs-picks{margin-top:4px;}",
      ".cs-picks .cs-q{margin:4px 0;}",
      ".cs-cat{display:flex;align-items:center;gap:6px;padding:7px 11px 3px;font-size:11.75px;font-weight:800;color:var(--muted-2,#a49d95);}",
      ".cs-bd{font-size:11px;font-weight:800;border-radius:4px;padding:1px 5px;}",
      ".b-here{color:var(--teal,#1eb980);background:rgba(30,185,128,.16);}",
      ".b-ok{color:#f0a020;background:rgba(240,160,32,.16);}",
      ".b-go{color:var(--muted,#b3ada4);background:rgba(255,255,255,.07);}",
      ".cs-q{display:flex;align-items:center;gap:7px;margin:3px 11px;padding:6px 10px;border-radius:7px;",
      "  background:var(--bg,#262624);border:1px solid var(--border-strong,rgba(255,255,255,.16));",
      "  font-size:12.5px;color:var(--text,#e9e7e2);cursor:pointer;}",
      ".cs-q:hover{border-color:var(--blue,#3b82f6);color:var(--blue-light,#5fa1ff);}",
      ".cs-q .ic{flex:0 0 auto;opacity:.85;}",
      ".cs-row.instr .cm{white-space:pre-wrap;}",
      ".cs-row .cm p{margin:0 0 6px;}",
      ".cs-row .cm p:last-child{margin-bottom:0;}",
      ".cs-row .cm strong{color:#fff;font-weight:800;}",
      ".cs-row .cm h1,.cs-row .cm h2,.cs-row .cm h3{font-size:12.5px;font-weight:800;color:#fff;margin:9px 0 5px;}",
      ".cs-row .cm ul,.cs-row .cm ol{margin:4px 0 7px 17px;}",
      ".cs-row .cm li{margin:2px 0;}",
      ".cs-row .cm code{background:var(--panel-2,#1f1e1d);border:1px solid var(--border,rgba(255,255,255,.08));" +
        "border-radius:4px;padding:0 4px;font-size:12.5px;color:var(--blue-light,#5fa1ff);}",
      ".cs-row .cm pre{background:var(--panel-2,#1f1e1d);border:1px solid var(--border,rgba(255,255,255,.08));" +
        "border-radius:7px;padding:8px 10px;overflow-x:auto;margin:6px 0;}",
      ".cs-row .cm pre code{background:none;border:none;padding:0;color:var(--text,#e9e7e2);}",
      ".cs-row .cm table{border-collapse:collapse;width:100%;margin:6px 0;font-size:12.5px;display:block;overflow-x:auto;}",
      ".cs-row .cm th{background:var(--panel-2,#1f1e1d);color:var(--muted,#b3ada4);text-align:left;font-weight:700;}",
      ".cs-row .cm th,.cs-row .cm td{border:1px solid var(--border,rgba(255,255,255,.08));padding:5px 8px;white-space:nowrap;}",
      ".cs-row .cm blockquote{border-left:3px solid var(--border-strong,rgba(255,255,255,.16));margin:6px 0;padding:2px 0 2px 10px;color:var(--muted,#b3ada4);}",
      ".cs-row .cm hr{border:none;border-top:1px solid var(--border,rgba(255,255,255,.08));margin:9px 0;}",
      ".cs-row .cm.clamp{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer;}",
      ".cs-row .cl-more{font-size:12px;font-weight:700;color:var(--blue-light,#5fa1ff);cursor:pointer;}",
      // 「이 답 이상해요」 지적(중-1) — 평소엔 숨고 마우스를 올리거나 키보드로 짚으면 드러난다.
      // 호버만으로 드러내면 키보드 사용자가 못 쓴다(탭 닫기 ✕와 같은 방식).
      ".cs-row .cs-flag{display:none;margin-top:4px;font-size:11.75px;font-weight:700;color:var(--muted-2,#a49d95);background:none;border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:2px 8px;cursor:pointer;min-height:24px;}",
      ".cs-row:hover .cs-flag,.cs-row .cs-flag:focus-visible{display:inline-block;}",
      ".cs-row .cs-flag:hover,.cs-row .cs-flag:focus-visible{color:var(--amber,#f59e0b);border-color:rgba(245,158,11,.45);}",
      ".cs-row .cs-flag.done{display:inline-block;color:var(--teal,#1eb980);border-color:rgba(30,185,128,.4);cursor:default;}",
      // "가서 하기" 화면 열기 — 지적(cs-flag)과 달리 **늘 보인다**. 순서를 읽은 다음 바로 누를
      // 것이라 hover로 숨기면 있는 줄도 모른다.
      ".cs-row .cs-open{display:block;margin-top:8px;font-size:12.5px;font-weight:700;color:var(--blue-l,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.35);border-radius:8px;padding:6px 12px;cursor:pointer;min-height:28px;font-family:inherit;}",
      ".cs-row .cs-open:hover{background:rgba(59,130,246,.18);}",
      ".cs-row .cs-open:disabled{color:var(--teal,#1eb980);background:rgba(30,185,128,.10);border-color:rgba(30,185,128,.35);cursor:default;}",
      // 목록 골라 조치 — 글자 위주로. 그래픽보다 데이터가 보이는 게 핵심(2026-07-31 사용자 지시).
      ".cs-row .cs-pick{margin-top:8px;border:1px solid rgba(255,255,255,.10);border-radius:9px;padding:8px 10px;}",
      ".cs-row .cs-pick.done{opacity:.55;}",
      ".cs-row .cs-ph{font-size:12.25px;color:var(--muted-2,#a49d95);margin-bottom:6px;}",
      ".cs-row .cs-pi{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;cursor:pointer;}",
      ".cs-row .cs-pi:hover{background:rgba(255,255,255,.03);}",
      ".cs-row .cs-pi input{width:auto;margin:0;flex:0 0 auto;}",
      ".cs-row .cs-pl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".cs-row .cs-ps{flex:0 0 auto;font-size:12px;color:var(--muted-2,#a49d95);}",
      ".cs-row .cs-pb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);}",
      ".cs-row .cs-pc{font-size:12.25px;color:var(--muted,#b3ada4);margin-right:auto;}",
      ".cs-row .cs-pact{font-size:12.25px;font-weight:700;color:var(--blue-l,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.30);border-radius:7px;padding:4px 9px;cursor:pointer;font-family:inherit;min-height:26px;}",
      ".cs-row .cs-pact:hover:not(:disabled){background:rgba(59,130,246,.20);}",
      ".cs-row .cs-pact:disabled{color:var(--muted-2,#a49d95);background:none;border-color:rgba(255,255,255,.08);cursor:default;}",
      ".cs-row .cs-pv{display:flex;gap:6px;margin-top:7px;}",
      ".cs-row .cs-pvi{flex:1;background:var(--panel-2,#1f1e1d);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:5px 9px;color:var(--text,#e9e7e2);font-size:12px;font-family:inherit;outline:none;}",
      // 실행 승인(결재판) — 대화 안에서 값을 보고 고치고 승인한다.
      ".cs-row .cs-ap{margin-top:8px;border:1px solid rgba(240,160,32,.35);background:rgba(240,160,32,.06);border-radius:9px;padding:9px 11px;}",
      ".cs-row .cs-aph{font-size:12px;font-weight:800;color:var(--amber,#f0a020);margin-bottom:3px;}",
      ".cs-row .cs-apsub{font-size:12.25px;color:var(--muted,#b3ada4);margin-bottom:8px;}",
      ".cs-row .cs-apf{display:flex;align-items:center;gap:8px;margin-bottom:5px;}",
      ".cs-row .cs-apk{flex:0 0 72px;font-size:12.25px;color:var(--muted-2,#a49d95);}",
      ".cs-row .cs-apin{flex:1;min-width:0;background:var(--panel-2,#1f1e1d);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:5px 9px;color:var(--text,#e9e7e2);font-size:12px;font-family:inherit;outline:none;}",
      ".cs-row .cs-apin.need{border-color:rgba(226,72,61,.55);}",
      ".cs-row .cs-ape{font-size:12.25px;color:var(--muted,#b3ada4);margin-top:7px;line-height:1.6;}",
      ".cs-row .cs-apb{display:flex;gap:6px;margin-top:9px;}",
      ".cs-row .cs-apgo{font-size:12.5px;font-weight:800;color:#fff;background:var(--teal,#1eb980);border:none;border-radius:7px;padding:6px 12px;cursor:pointer;font-family:inherit;}",
      ".cs-row .cs-apgo:disabled{background:rgba(255,255,255,.10);color:var(--muted-2,#a49d95);cursor:default;}",
      ".cs-row .cs-apno{font-size:12.5px;font-weight:700;color:var(--muted,#b3ada4);background:none;border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:6px 12px;cursor:pointer;font-family:inherit;}",
      ".cs-row .cs-apd{font-size:12px;color:var(--muted,#b3ada4);}",
      ".cs-row.error .cm{color:#f5928a;}",
      ".cs-typing span{display:inline-block;width:5px;height:5px;margin-right:3px;border-radius:50%;background:var(--muted,#b3ada4);animation:csb 1s infinite;}",
      ".cs-typing span:nth-child(2){animation-delay:.15s}.cs-typing span:nth-child(3){animation-delay:.3s}",
      "@keyframes csb{0%,60%,100%{opacity:.25}30%{opacity:1}}",
      ".cs-dock{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 14px 12px;}",
      ".cs-dock input{flex:1;background:var(--panel,#30302e);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:11px;color:var(--text,#e9e7e2);font-size:13px;padding:11px 14px;outline:none;font-family:inherit;}",
      ".cs-dock input:focus{border-color:var(--blue,#3b82f6);}",
      // ＋ 파일 올리기 — 인입 창구는 여기 하나다(2026-07-27 결정: "파일은 ＋ 한 곳으로").
      ".cs-plus{flex:0 0 auto;width:38px;height:38px;border-radius:11px;background:var(--panel,#30302e);color:var(--muted,#b3ada4);",
      "border:1px solid var(--border-strong,rgba(255,255,255,.16));font-size:17px;line-height:1;cursor:pointer;}",
      ".cs-plus:hover{color:#fff;border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.12);}",
      ".cs-updec{margin-top:6px;}",
      ".cs-updec .h{font-size:12px;font-weight:800;color:#fff;margin-bottom:3px;}",
      ".cs-updec .f{font-size:12.25px;color:var(--muted-2,#a49d95);margin-bottom:7px;}",
      ".cs-updec .btns{display:flex;gap:5px;flex-wrap:wrap;}",
      ".cs-updec button{background:var(--panel,#30302e);border:1px solid var(--border-strong,rgba(255,255,255,.16));color:#dfe6ff;",
      "border-radius:8px;padding:6px 10px;font-size:12.5px;font-weight:700;cursor:pointer;}",
      ".cs-updec button:hover{border-color:var(--blue,#3b82f6);background:rgba(59,130,246,.14);}",
      ".cs-updec button.reco{border-color:var(--teal,#1eb980);color:#bff3de;}",
      ".cs-updec input.pn{width:100%;margin-bottom:7px;background:var(--panel,#30302e);border:1px solid var(--border-strong,rgba(255,255,255,.16));",
      "border-radius:8px;color:var(--text,#e9e7e2);font-size:12px;padding:7px 9px;outline:none;font-family:inherit;}",
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
        '<span class="cs-ctx" id="csCtx" title="지금 지시의 대상 화면 — ✕로 떼면 화면과 무관하게 묻습니다">대시보드</span>' +
        '<span class="cs-sel" id="csSel" style="display:none" title="화면에서 고른 항목 — 「이거」가 이걸 가리킵니다"></span>' +
        '<span class="cs-hint" id="csHint">보고 있는 화면 기준으로 지시합니다</span>' +
        '<button class="cs-btn" id="csToggleHost" title="' +
          (IS_WINDOW ? "이 창을 닫고 앱 아래에 다시 붙입니다" : "대화를 별도 창으로 빼냅니다 — 화면을 100%로 쓸 때") + '">' +
          (IS_WINDOW ? "⇤ 앱에 붙이기" : "⧉ 창으로") + "</button>" +
      "</div>" +
      // 절차 띠 + 살아 있는 숫자(2026-08-09 시안) — 절차 화면이 아니면 통째로 숨는다
      '<div class="cs-flow" id="csFlow" style="display:none"></div>' +
      // 화면별 칩 — 지금 화면에서 실제로 하는 물음. 전체 갈래는 아래 서랍(무엇을 할 수 있나)에 보존
      '<div class="cs-chips" id="csChips"></div>' +
      '<div class="cs-drawer" id="csDrawer"></div>' +
      '<div class="cs-body" id="csBody"><div class="cs-empty">지시하면 여기서 실시간으로 흐릅니다. 위 <b>무엇을 할 수 있나</b>에서 골라도 됩니다.</div></div>' +
      '<div class="cs-dock">' +
        '<button class="cs-plus" id="dockUpload" title="파일 올리기 — 자동 분류(취약점·매뉴얼·문서). 애매하면 유형을 물어봅니다">＋</button>' +
        '<input id="chatInput" placeholder="지시를 입력하세요…" aria-label="지시를 입력하세요">' +
        '<button class="cs-send" id="dockSend">전송</button>' +
      "</div>" +
      '<input type="file" id="csUploadInput" multiple style="display:none">';

    var input = document.getElementById("chatInput");
    // ⚠ submit을 그대로 붙이면 클릭 이벤트가 첫 인자로 들어가 "[object MouseEvent]"를 보낸다.
    document.getElementById("dockSend").addEventListener("click", function () { submit(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
    // 초안은 저장한다 — 콘솔을 창으로 빼거나 붙일 때 쓰던 글이 날아가면 안 된다.
    try { var d = localStorage.getItem(DRAFT_KEY); if (d) input.value = d; } catch (e) {}
    input.addEventListener("input", function () { try { localStorage.setItem(DRAFT_KEY, input.value); } catch (e) {} });

    wireUpload();
    renderDrawer();

    // C. 맥락 떼기 — ✕를 누르면 화면 무관, 다시 칩을 누르면 붙는다.
    //   칩 내용은 applyCtx가 매번 다시 그리므로, 리스너는 부모(고정 요소)에 한 번만 단다.
    document.getElementById("csSel").addEventListener("click", function (e) {
      if (e.target && e.target.classList.contains("x")) setSelection(null);
    });
    document.getElementById("csCtx").addEventListener("click", function (e) {
      if (e.target && e.target.classList.contains("x")) { ctxOff = true; applyCtx(); return; }
      if (ctxOff) { ctxOff = false; applyCtx(); }
    });

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
      '<div style="flex:1;min-width:0;font-size:12px;color:var(--muted-2,#a49d95);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      esc(String(answer).slice(0, 40)) + "…</div>" +
      '<span id="fbX" role="button" tabindex="0" style="cursor:pointer;color:var(--muted,#b3ada4);font-size:13px;line-height:1">✕</span></div>' +
      '<div id="fbKinds" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"></div>' +
      '<div id="fbHint" style="font-size:11.75px;color:var(--muted-2,#a49d95);margin-bottom:9px;min-height:13px"></div>' +
      '<textarea id="fbNote" rows="2" placeholder="무엇이 틀렸나요? (선택)" style="width:100%;box-sizing:border-box;background:var(--panel-2,#242322);border:1px solid var(--border,#3a3936);border-radius:7px;padding:7px 9px;color:var(--text,#e9e7e2);font-size:12.5px;resize:vertical;margin-bottom:7px"></textarea>' +
      '<textarea id="fbExp" rows="2" placeholder="혹시 정답을 아신다면 (선택)" style="width:100%;box-sizing:border-box;background:var(--panel-2,#242322);border:1px solid var(--border,#3a3936);border-radius:7px;padding:7px 9px;color:var(--text,#e9e7e2);font-size:12.5px;resize:vertical"></textarea>' +
      '<div style="font-size:11.5px;color:var(--muted-2,#a49d95);margin:5px 0 10px">적어 주시면 앞으로 이 질문을 검사 문항으로 씁니다.</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:7px">' +
      '<button id="fbCancel" style="background:none;border:1px solid var(--border,#3a3936);border-radius:7px;padding:5px 12px;color:var(--muted,#b3ada4);font-size:12.5px;cursor:pointer">취소</button>' +
      '<button id="fbSend" style="background:var(--blue,#3b82f6);border:none;border-radius:7px;padding:5px 14px;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">전송</button></div>';
    document.body.appendChild(c);
    flagCard = c;

    var picked = "wrong";
    var kinds = c.querySelector("#fbKinds"), hint = c.querySelector("#fbHint");
    FLAG_KINDS.forEach(function (k) {
      var b = document.createElement("button");
      b.textContent = k.label;
      b.style.cssText = "background:none;border:1px solid var(--border,#3a3936);border-radius:999px;padding:4px 10px;color:var(--text,#e9e7e2);font-size:12.25px;cursor:pointer;min-height:24px;";
      b.onclick = function () {
        picked = k.k;
        hint.textContent = k.hint;
        [].forEach.call(kinds.children, function (x) { x.style.borderColor = "var(--border,#3a3936)"; x.style.color = "var(--text,#e9e7e2)"; });
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
  // ── "가서 하기" 답에 붙는 화면 열기 ─────────────────────────────────────
  // 서버가 순서를 안내하면서 openScreen(화면·자리)을 같이 준다(server/engine/howto.ts).
  // ⚠ 갈 화면이 없는 안내(백업 복원처럼)에는 openScreen이 아예 안 온다 — 버튼도 안 생긴다.
  //   있는 척 아무 화면이나 열면 담당자는 없는 버튼을 찾아 헤맨다.
  /**
   * 근거 원문 — 답 아래에 접힌 채로 붙인다. 펴면 답을 만든 문서의 그 대목이 나온다.
   *
   * ★ 왜(2026-08-01 실측): 문서엔 "미사용 룰 37개"라고 적혀 있는데 AI가 "27"이라고 답했다.
   *   근거 배지에는 그 문서가 **맞게** 떴다 — 자료 찾기는 정상이고 모델이 표를 잘못 읽은 것이다.
   *   담당자는 그 숫자로 보고를 쓴다. 원문을 함께 보여 주면 그 자리에서 눈으로 잡는다.
   *   (모델에게 "숫자를 정확히 읽어라"라고 타이르지 않는다 — 반복 실패한 방식이다.)
   *
   * ⚠ 이 파일이 **실제 대화창**이다. 화면 안 위젯(chatwidget.js)에도 같은 것을 붙였다가
   *   그쪽은 탭 안에서 비어 있다는 걸 뒤늦게 알았다 — 기능을 안 쓰는 곳에 넣을 뻔했다.
   */
  function attachQuotes(el, quotes, answer, sources) {
    // 근거 배지(문서 이름) — 화면 안 위젯에는 있었는데 **주 대화창인 여기엔 없었다**(2026-08-01).
    //   담당자가 가장 많이 쓰는 자리에서 "무엇을 보고 답했는지"가 안 보이고 있었다.
    if (el && Array.isArray(sources) && sources.length) {
      var badge = document.createElement("div");
      badge.style.cssText = "margin-top:6px;font-size:11.5px;font-weight:700;color:#6fdcb5";
      badge.textContent = "📄 근거: " + sources.slice(0, 4).join(" · ");
      el.appendChild(badge);
    }
    if (!el || !Array.isArray(quotes) || !quotes.length) return;
    var wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px";
    var head = document.createElement("div");
    head.style.cssText = "font-size:12px;color:var(--muted,#b3ada4);cursor:pointer;user-select:none";
    var open = false;
    var draw = function () { head.textContent = (open ? "▾" : "▸") + " 📄 근거 원문 " + quotes.length + "대목 — 답이 맞는지 확인"; };
    draw();
    var body = document.createElement("div");
    body.style.cssText = "display:none;margin-top:6px";

    // 답에 나온 숫자·영문코드를 원문에서 강조한다 — 눈이 바로 그리로 간다.
    var marks = (String(answer || "").match(/\d[\d,.\-]{0,12}|[A-Z][A-Za-z0-9\-]{3,}/g) || [])
      .filter(function (t) { return t.length >= 2; }).slice(0, 12);
    quotes.slice(0, 3).forEach(function (q) {
      var box = document.createElement("div");
      box.style.cssText =
        "border-left:3px solid rgba(59,130,246,.45);background:rgba(59,130,246,.05);" +
        "padding:7px 10px;border-radius:0 6px 6px 0;margin-bottom:6px";
      var txt = esc(q.text || "");
      marks.forEach(function (t) {
        var safe = esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
          txt = txt.replace(new RegExp(safe, "g"),
            '<mark style="background:rgba(240,160,32,.28);color:#ffd88a;padding:0 2px;border-radius:3px">$&</mark>');
        } catch (e) {}
      });
      box.innerHTML =
        '<div style="font-size:11.5px;color:var(--muted-2,#a49d95);margin-bottom:3px">' + esc(q.documentId || "") + "</div>" +
        '<div style="font-size:12.25px;line-height:1.75;color:#cdd4e6">' + txt + "</div>";
      body.appendChild(box);
    });

    head.addEventListener("click", function () { open = !open; body.style.display = open ? "block" : "none"; draw(); });
    wrap.appendChild(head);
    wrap.appendChild(body);
    el.appendChild(wrap);
  }

  function attachOpen(el, open) {
    if (!el || !open || !open.page) return;
    var leaf = String(open.label || "").split(">").pop().trim() || "화면";
    var b = document.createElement("button");
    b.className = "cs-open";
    b.textContent = "🗔 " + leaf + " 열기";
    b.addEventListener("click", function () {
      b.disabled = true;
      // 창 모드면 본창에 탭으로 열어 달라고 부탁한다(별도 창은 탭을 직접 못 연다).
      // 셸 안에 붙어 있으면 바로 연다. 어느 쪽이든 **대화는 그대로 남는다**.
      var done = function (ok, why) {
        b.textContent = ok ? "🗔 " + leaf + " 열었습니다" : "⚠ " + (why || "열지 못했습니다");
        if (!ok) b.disabled = false;
      };
      try {
        if (IS_WINDOW && window.gijo && window.gijo.openTabInShell) {
          window.gijo.openTabInShell(open.page, leaf).then(function (r) {
            done(!!(r && r.ok), r && r.why);
          }, function (e) { done(false, (e && e.message) || String(e)); });
        } else if (window.gijoTabs) {
          window.gijoTabs.open(open.page, leaf);
          done(true);
        } else {
          done(false, "이 창에서는 화면을 열 수 없습니다 — 사이드바에서 " + leaf + "으로 가세요");
        }
      } catch (e) { done(false, (e && e.message) || String(e)); }
    });
    var cb = el.querySelector(".cb");
    if (cb) cb.appendChild(b);
  }

  // ── 실행 승인(결재판) ──────────────────────────────────────────────────
  // ⚠ 이게 없어서 **대화창에서는 쓰기 지시가 막다른 길이었다**(2026-07-31 발견).
  //   "정기점검 잡아줘" 같은 지시에 서버는 결재판을 돌려주는데 대화창이 그리질 않아,
  //   "확인해 주세요"라고 해 놓고 확인할 자리가 없었다. 챗봇 위젯(chatwidget.js)에만 있었다.
  //   값을 고칠 수 있게 두는 이유: 모델이 채운 값이 틀렸을 때 다시 말하는 것보다 고치는 게 빠르다.
  function attachApproval(el, ap) {
    if (!el || !ap || !ap.tool) return;
    var fields = ap.fields || [];
    var box = document.createElement("div");
    box.className = "cs-ap";
    box.innerHTML =
      '<div class="cs-aph">🗂 실행 승인 — ' + esc(ap.label || ap.tool) + "</div>" +
      '<div class="cs-apsub">아래 내용대로 실행합니다. 값을 확인·수정한 뒤 승인하세요.</div>' +
      fields.map(function (f) {
        return '<div class="cs-apf"><span class="cs-apk">' + esc(f.label || f.key) + (f.required ? "*" : "") + "</span>" +
          '<input class="cs-apin' + (f.source === "empty" && f.required ? " need" : "") + '" data-k="' + esc(f.key) +
          '" value="' + esc(f.value || "") + '" placeholder="' + esc(f.hint || "") + '"></div>';
      }).join("") +
      (ap.effect ? '<div class="cs-ape"><b>실행되면:</b> ' + esc(ap.effect) + "</div>" : "") +
      (ap.undo ? '<div class="cs-ape"><b>되돌리기:</b> ' + esc(ap.undo) + "</div>" : "") +
      '<div class="cs-apb"><button class="cs-apgo">✓ 승인하고 실행</button><button class="cs-apno">취소</button></div>';

    var go = box.querySelector(".cs-apgo");
    var inputs = Array.prototype.slice.call(box.querySelectorAll(".cs-apin"));
    var collect = function () {
      var o = {};
      inputs.forEach(function (i) { o[i.dataset.k] = (i.value || "").trim(); });
      return o;
    };
    var required = fields.filter(function (f) { return f.required; }).map(function (f) { return f.key; });
    var sync = function () {
      var args = collect();
      var miss = required.filter(function (k) { return !args[k]; });
      go.disabled = miss.length > 0;
      go.textContent = miss.length ? "✓ 승인 (" + miss.length + "개 입력 필요)" : "✓ 승인하고 실행";
    };
    inputs.forEach(function (i) { i.addEventListener("input", sync); });
    sync();

    box.querySelector(".cs-apno").addEventListener("click", function () {
      box.innerHTML = '<div class="cs-apd">✕ 실행하지 않았습니다 — ' + esc(ap.label || ap.tool) + "</div>";
    });
    go.addEventListener("click", async function () {
      go.disabled = true;
      go.textContent = "실행 중…";
      try {
        var r = await window.gijo.approveAgentTool(ap.tool, collect(), ap.instruction || "");
        box.innerHTML = '<div class="cs-apd">✅ 실행 완료 — ' + esc(ap.label || ap.tool) + "</div>";
        append("reply", { icon: "🧭", name: "AI 팀", message: (r && r.output) || "완료했습니다." });
        if (r && r.undoId && window.gijo.undoAgentTool) {
          var ub = document.createElement("button");
          ub.className = "cs-pact";
          ub.textContent = "↩ 방금 실행 취소";
          ub.addEventListener("click", async function () {
            ub.disabled = true;
            try {
              var u = await window.gijo.undoAgentTool(r.undoId);
              ub.remove();
              append("event", { icon: "↩", name: "되돌림", message: (u && u.message) || "되돌렸습니다." });
            } catch (e) {
              ub.disabled = false;
              append("error", { icon: "⚠", name: "오류", message: "되돌리기 실패: " + ((e && e.message) || e) });
            }
          });
          box.appendChild(ub);
        }
      } catch (e) {
        go.disabled = false;
        go.textContent = "✓ 승인하고 실행";
        append("error", { icon: "⚠", name: "오류", message: "실행 실패: " + ((e && e.message) || e) });
      }
    });
    var cb = el.querySelector(".cb");
    if (cb) cb.appendChild(box);
  }

  // ── 목록에서 골라 조치하기 ─────────────────────────────────────────────
  // 서버가 답에 나온 취약점 목록을 picklist로 같이 준다(server/engine/picklist.ts).
  // 조건("critical 전부")은 말로 옮긴 범위라 어긋날 수 있지만, 눈으로 고른 것은 어긋나지 않는다.
  // ⚠ 값 입력에 window.prompt를 쓰지 않는다 — Electron에서는 OS 창이라 렌더러가 통째로 멈춘다.
  function attachPicks(el, pl) {
    if (!el || !pl || !pl.items || !pl.items.length) return;
    var chosen = [];
    var wrap = document.createElement("div");
    wrap.className = "cs-pick";

    var head = document.createElement("div");
    head.className = "cs-ph";
    head.textContent = pl.kind === "task"
      ? "끝낸 일을 골라 바로 체크할 수 있습니다"
      : "고쳐야 할 것을 골라 바로 처리할 수 있습니다";
    wrap.appendChild(head);

    pl.items.forEach(function (it) {
      var row = document.createElement("label");
      row.className = "cs-pi";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", function () {
        var at = chosen.indexOf(it.id);
        if (cb.checked) { if (at < 0) chosen.push(it.id); }
        else if (at >= 0) chosen.splice(at, 1);
        sync();
      });
      var name = document.createElement("span");
      name.className = "cs-pl";
      name.textContent = it.label;
      var sub = document.createElement("span");
      sub.className = "cs-ps";
      sub.textContent = (it.assignee ? "담당 " + it.assignee : "담당 미배정") + " · " + (it.dueDate ? "기한 " + it.dueDate : "기한 없음");
      row.appendChild(cb); row.appendChild(name); row.appendChild(sub);
      wrap.appendChild(row);
    });

    var bar = document.createElement("div");
    bar.className = "cs-pb";
    var cnt = document.createElement("span");
    cnt.className = "cs-pc";
    bar.appendChild(cnt);
    var acts = [];
    (pl.actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.className = "cs-pact";
      b.textContent = a.label;
      b.addEventListener("click", function () { onAct(a); });
      acts.push(b);
      bar.appendChild(b);
    });
    wrap.appendChild(bar);

    // 담당자·기한처럼 값이 필요한 조치는 이 줄이 열린다(창을 띄우지 않는다).
    var ask = document.createElement("div");
    ask.className = "cs-pv";
    ask.style.display = "none";
    wrap.appendChild(ask);

    function sync() {
      cnt.textContent = chosen.length ? chosen.length + "건 선택" : "고르면 아래 조치를 쓸 수 있습니다";
      acts.forEach(function (b) { b.disabled = chosen.length === 0; });
    }
    function send(a, value) {
      // 사람에겐 뜻만, 서버에는 고른 건의 신원(sha1)까지 — 번호를 모델이 다시 읽는 일이 없다.
      var 뜻 = "고른 " + chosen.length + "건을 " + a.label + (value ? " (" + value + ")" : "");
      // 무엇을 고른 것인지도 실어 보낸다 — 취약점의 "조치완료"와 할 일의 "끝냄"은 뜻이 다르다.
      var lines = [뜻, "#고른건 " + chosen.join(","), "#조치 " + a.key, "#종류 " + (pl.kind || "finding")];
      if (value) lines.push("#값 " + value);
      wrap.classList.add("done");
      acts.forEach(function (b) { b.disabled = true; });
      ask.style.display = "none";
      submit(lines.join("\n"), 뜻);
    }
    function onAct(a) {
      if (!chosen.length) return;
      if (!a.needs) return send(a, "");
      ask.innerHTML = "";
      ask.style.display = "flex";
      var inp = document.createElement("input");
      inp.className = "cs-pvi";
      if (a.needs === "dueDate") { inp.type = "date"; }
      else { inp.type = "text"; inp.placeholder = "담당자 이름"; }
      var ok = document.createElement("button");
      ok.className = "cs-pact";
      ok.textContent = "적용";
      var go = function () {
        var v = (inp.value || "").trim();
        if (!v) { inp.focus(); return; } // 빈 값으로 보내면 "담당 (없음)"이라는 뜻 모를 승인이 뜬다
        send(a, v);
      };
      ok.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
      ask.appendChild(inp); ask.appendChild(ok);
      inp.focus();
    }
    sync();
    var cb2 = el.querySelector(".cb");
    if (cb2) cb2.appendChild(wrap);
  }

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
  // 답은 **마크다운으로 그린다**(2026-07-31 사용자 지시 "지금 너하고 하는 대화처럼").
  // 예전엔 글자 그대로만 그려서 모델이 보낸 **굵게**·표·목록이 별표와 파이프로 보였다.
  // 표·굵은 글씨가 그려져야 숫자와 이름이 눈에 들어온다 — 그래픽이 아니라 데이터다.
  // ⚠ 내가 친 말(instr)은 그리지 않는다 — 담당자가 적은 그대로 보여야 한다.
  function fmt(kind, msg) {
    if (kind === "instr" || !window.gijoMd) return esc(msg);
    return window.gijoMd.render(msg);
  }


  // ── 서랍: 무엇을 할 수 있나 ────────────────────────────────────────────
  // ⚠ **화면 이름이 아니라 하는 일**로 묶는다(2026-07-31 사용자 결정).
  //   담당자가 원하는 건 '취약점 화면'이 아니라 '미조치가 뭔지 아는 것'이다.
  //   누르면 그 말이 그대로 대화로 들어간다 — 뭘 물어야 할지 몰라도 되게.
  //
  // 세 갈래로 나눈다(시안 승인):
  //   here — 대화창 안에서 답이 끝난다(도구가 조회해 온다)
  //   ok   — 상태를 바꾸므로 결재판을 거쳐 실행된다
  //   go   — 대화로 하면 안 되는 것(설정·계정·열쇠). 순서를 알려 주고 화면을 열어 준다.
  //
  // screens — **지금 보는 탭에서 할 수 있는 것**을 위로 올리는 데 쓴다(2026-08-06 사용자 지시
  //   "무엇을 할 수 있나를 해당 메뉴에서 할 수 있는 것으로"). 갈래를 지우지는 않는다:
  //   대화창의 강점이 화면 경계를 가로지르는 것이라, 해당 화면 것을 **먼저** 보이고
  //   나머지는 아래에 남긴다(2026-07-31 "하는 일로 묶는다" 결정과 충돌하지 않게).
  var CAN = [
    { cat: "지금 급한 것", kind: "here", screens: ["dashboard.html", "approvals.html", "vulnscan.html", "kpi.html", "triage.html", "fix.html"], qs: [
      // 보안 KPI 화면에 있던 「지금 손댈 일」 줄을 여기로 옮겼다(2026-08-02 사용자 지시).
      //   서버 도구 urgent_todo가 화면과 **같은 규칙 한 벌**로 만든다.
      { ic: "🎯", q: "지금 손댈 일 뭐야?" },
      { ic: "🔥", q: "오늘 뭐부터 해야 해?" },
      { ic: "⏰", q: "기한 지난 일 보여줘" },
      { ic: "✅", q: "승인 기다리는 것 있어?" },
    ]},
    { cat: "살펴보기", kind: "here", screens: ["analysis.html","threat.html","inventory.html","vulnscan.html","sbom.html","syslog.html","discover.html","triage.html"], qs: [
      { ic: "🛡", q: "미조치 취약점 뭐 있어?" },
      { ic: "📦", q: "우리 자산 현황 알려줘" },
      { ic: "🌐", q: "새로 올라온 위협 중에 우리 자산에 해당하는 게 있어?" },
      { ic: "📋", q: "오늘 로그에서 이상 징후가 있어?" },
      { ic: "🧩", q: "AI-BOM에서 빠뜨린 항목이 뭐야?" },
    ]},
    // ⚠ 자산·제품 이름을 **박아 두지 않는다**(2026-07-31 실측: 예시로 쓰던 "경계 방화벽(FW-01)"이
    //   운영에 없어서 첫 클릭이 "그런 자산이 없습니다"로 끝났다. 서랍은 "이건 된다"고 약속하는
    //   자리라 첫 클릭이 실패하면 없느니만 못하다).
    //   {제품} 자리는 서랍을 펼칠 때 **실제 등록된 제품 이름**으로 채운다. 하나도 없으면 그 줄을 뺀다.
    { cat: "처리하기", kind: "ok", screens: ["approvals.html","maintenance.html","inventory.html","products.html","fix.html","verify.html"], qs: [
      { ic: "🔧", q: "{제품} 정기점검 잡아줘", needs: "product" },
      { ic: "📝", q: "새 자산 등록할게" },
      { ic: "🚦", q: "가장 급한 취약점에 담당자 배정해줘" },
    ]},
    { cat: "정리하기", kind: "here", screens: ["report.html","kpi.html","compliance.html","audit.html","reporting.html"], qs: [
      { ic: "📄", q: "이번 주 보안 현황을 요약해줘" },
      { ic: "📊", q: "이번 달 보안 지표를 지난달과 비교해줘" },
      { ic: "🧾", q: "최근 작업 기록에서 이상한 게 있어?" },
    ]},
    { cat: "설정·관리", kind: "go", screens: ["settings.html","handover.html"], qs: [
      { ic: "🔐", q: "2차 인증 켜려면 어떻게 해?" },
      { ic: "🔑", q: "복구 열쇠 재발급하려면 어떻게 해?" },
      { ic: "👤", q: "담당자 계정 추가하려면 어떻게 해?" },
    ]},
  ];
  var KIND_BADGE = { here: ["여기서 끝", "b-here"], ok: ["승인 후 실행", "b-ok"], go: ["가서 하기", "b-go"], mine: ["내가 등록", "b-mine"] };

  // ── 내가 등록한 지시(2026-08-02 사용자 지시 "무엇을 할 수 있나를 등록할 수 있는 메뉴") ──
  // 서랍의 기본 목록은 우리가 정한 것이라 담당자의 현장 말버릇과는 다르다. 자주 쓰는 말을
  // 그대로 등록해 두면 다음부터 한 번에 부른다.
  // ⚠ 이 PC에만 저장한다 — 사람마다 자주 쓰는 말이 다르고, 서버에 넣으면 계정 하나로
  //   두 대를 쓸 때 서로 덮어쓴다(왼쪽 메뉴 즐겨찾기와 같은 규칙).
  var MY_KEY = "gijo:console:myasks";
  function 내지시목록() {
    try {
      var v = JSON.parse(localStorage.getItem(MY_KEY) || "[]");
      return Array.isArray(v) ? v.filter(function (x) { return x && typeof x.q === "string"; }) : [];
    } catch (e) { return []; }
  }
  function 내지시저장(list) { try { localStorage.setItem(MY_KEY, JSON.stringify(list)); } catch (e) {} }
  function 내지시추가(q) {
    q = String(q || "").trim();
    if (!q) return false;
    var l = 내지시목록();
    if (l.some(function (x) { return x.q === q; })) return false;   // 같은 말 두 번 넣지 않는다
    l.push({ ic: "⭐", q: q });
    내지시저장(l.slice(0, 30));                                      // 너무 많으면 고르기 어렵다
    return true;
  }
  function 내지시삭제(q) {
    내지시저장(내지시목록().filter(function (x) { return x.q !== q; }));
  }
  var 등록열림 = false;
  var drawerOpen = false;

  // 실제 등록된 제품 이름 하나. 서랍을 처음 펼칠 때 한 번만 물어 기억한다(없으면 null).
  var realProduct;
  async function loadRealNames() {
    if (realProduct !== undefined) return;
    realProduct = null;
    try {
      var r = await window.gijo.listSecurityProducts();
      var rows2 = Array.isArray(r) ? r : (r && (r.items || r.products)) || [];
      var hit = rows2.find(function (p) { return p && p.name; });
      if (hit) realProduct = hit.name;
    } catch (e) { /* 못 불러와도 서랍은 뜬다 — 그 줄만 빠진다 */ }
  }

  /** 실데이터가 필요한 줄을 채우거나(있으면) 뺀다(없으면). */
  function fillQs(qs) {
    var out = [];
    qs.forEach(function (x) {
      if (x.needs === "product") {
        if (!realProduct) return; // 등록된 제품이 없으면 이 줄은 보여주지 않는다
        out.push({ ic: x.ic, q: x.q.replace("{제품}", realProduct) });
        return;
      }
      out.push(x);
    });
    return out;
  }

  function renderDrawer() {
    var el = document.getElementById("csDrawer");
    if (!el) return;
    var 지금화면 = (ctx && ctx.screen) || "";
    var cats = CAN.map(function (c) {
      return { cat: c.cat, kind: c.kind, qs: fillQs(c.qs), 지금: !!(지금화면 && c.screens && c.screens.indexOf(지금화면) >= 0) };
    }).filter(function (c) { return c.qs.length > 0; });
    // 내가 등록한 지시 — 항상 맨 위(내 말이 우리 목록보다 먼저다).
    var 내것 = 내지시목록();
    if (내것.length) cats.unshift({ cat: "내가 등록한 지시", kind: "mine", qs: 내것, 지금: false, mine: true });
    // 지금 보는 탭에서 할 수 있는 갈래를 위로(내 지시 바로 다음). 나머지는 순서를 지킨다.
    cats.sort(function (a, b) { return (b.mine ? 2 : b.지금 ? 1 : 0) - (a.mine ? 2 : a.지금 ? 1 : 0); });
    var n = cats.reduce(function (a, c) { return a + c.qs.length; }, 0);
    var head =
      '<div class="cs-dh" id="csDrawerH"><span class="car">' + (drawerOpen ? "▼" : "▶") + "</span>" +
      "<b>무엇을 할 수 있나</b>" +
      '<span class="n">' + n + "가지</span>" +
      '<span class="cs-add" id="csAdd" title="자주 쓰는 지시를 등록해 둡니다">＋ 등록</span></div>';
    // ⚠ 예전엔 서랍이 **질문 18줄을 통째로** 폈다. 서랍만으로 대화창 절반을 먹고,
    //   정작 오간 말이 밀려 올라갔다(2026-08-02 사용자 지시: 갈래만 보이고 누르면 대화에 뜨게).
    //   갈래 다섯 줄이면 "무엇을 할 수 있나"가 한눈에 들어오고, 고른 뒤에야 질문이 나온다.
    // ＋ 등록 상자 — 예전엔 스타일(.cs-addbox)만 있고 **그리는 코드가 없어서** ＋ 등록을 눌러도
    //   아무 일도 안 일어났다(2026-08-06 사용자 신고 "등록하려는데 안 되네"). 만들어만 두고
    //   안 부르면 아무 일도 안 일어난다 — 그 계열의 사고다.
    var addbox = !등록열림 ? "" :
      '<div class="cs-addbox">' +
      '<input id="csAddInput" placeholder="자주 쓰는 지시를 그대로 적으세요 — 예: 이번 주 미조치 취약점 알려줘" maxlength="120">' +
      '<button id="csAddSave">등록</button>' +
      '<button id="csAddCancel" class="ghost">취소</button>' +
      '<span class="hint">이 PC에만 저장됩니다(최대 30개). 등록하면 서랍 맨 위 「내가 등록한 지시」에 생깁니다.</span>' +
      "</div>";
    var body = !drawerOpen ? "" :
      '<div class="cs-db">' + cats.map(function (c) {
        var bd = KIND_BADGE[c.kind];
        return '<div class="cs-catrow" data-cat="' + esc(c.cat) + '">' +
          '<span class="nm">' + esc(c.cat) + "</span>" +
          (c.지금 ? '<span class="cs-bd b-now">지금 화면</span>' : "") +
          '<span class="cs-bd ' + bd[1] + '">' + bd[0] + "</span>" +
          '<span class="cs-n">' + c.qs.length + "</span></div>";
      }).join("") + "</div>";
    el.className = "cs-drawer" + (drawerOpen ? " open" : "");
    el.innerHTML = head + addbox + body;
    document.getElementById("csDrawerH").addEventListener("click", function () {
      drawerOpen = !drawerOpen;
      // 펼칠 때 실제 이름을 불러온다(닫힌 채로는 부르지 않는다 — 안 쓸 수도 있는 호출을 아낀다).
      if (drawerOpen && realProduct === undefined) {
        loadRealNames().then(renderDrawer);
      }
      renderDrawer();
    });
    var add = document.getElementById("csAdd");
    if (add) add.addEventListener("click", function (e) {
      e.stopPropagation();                 // 머리줄 클릭(접기)과 겹치지 않게
      등록열림 = !등록열림;
      if (등록열림) drawerOpen = true;      // 등록하려면 서랍이 열려 있어야 목록이 보인다
      renderDrawer();
      var i = document.getElementById("csAddInput");
      if (i) i.focus();
    });
    var 저장 = document.getElementById("csAddSave");
    var 입력 = document.getElementById("csAddInput");
    var 넣기 = function () {
      if (!입력) return;
      // ⚠ 한글은 조합 중에도 Enter가 온다 — 조합 확정용 Enter를 등록으로 삼으면 반 글자가 들어간다.
      if (!내지시추가(입력.value)) { 입력.select(); return; }
      등록열림 = false; renderDrawer();
    };
    if (저장) 저장.addEventListener("click", 넣기);
    if (입력) 입력.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); 넣기(); }
      if (e.key === "Escape") { 등록열림 = false; renderDrawer(); }
    });
    var 취소 = document.getElementById("csAddCancel");
    if (취소) 취소.addEventListener("click", function () { 등록열림 = false; renderDrawer(); });

    el.querySelectorAll(".cs-catrow").forEach(function (row) {
      row.addEventListener("click", function () {
        var 이름 = row.getAttribute("data-cat");
        var c = cats.filter(function (x) { return x.cat === 이름; })[0];
        if (!c) return;
        drawerOpen = false; renderDrawer();
        갈래카드(c);
      });
    });
  }

  /**
   * 고른 갈래의 질문들을 **대화 안에** 카드로 띄운다.
   * ⚠ append()는 글만 받는다 — 여기서는 누를 수 있는 줄이 필요하므로 직접 만든다.
   *   누르면 그 말이 그대로 지시로 들어간다(서랍에서 누르던 것과 같은 길).
   */
  function 갈래카드(c) {
    var body = rows();
    var empty = body.querySelector(".cs-empty");
    if (empty) empty.remove();
    var el = document.createElement("div");
    el.className = "cs-row event cs-pick";
    var bd = KIND_BADGE[c.kind];
    el.innerHTML =
      '<div class="ci">💡</div>' +
      '<div class="cb"><div class="cn">' + esc(c.cat) +
      '<span class="cs-bd ' + bd[1] + '" style="margin-left:6px">' + bd[0] + "</span></div>" +
      '<div class="cs-picks">' + c.qs.map(function (x) {
        // 내가 등록한 것만 지울 수 있다 — 우리 기본 목록은 담당자가 못 지운다(다시 만들 길이 없다).
        return '<div class="cs-q" data-q="' + esc(x.q) + '"><span class="ic">' + x.ic + "</span>" + esc(x.q) +
          (c.mine ? '<span class="cs-del" data-del="' + esc(x.q) + '" title="이 지시 지우기">✕</span>' : "") + "</div>";
      }).join("") + "</div></div>";
    el.querySelectorAll(".cs-q").forEach(function (q) {
      q.addEventListener("click", function (ev) {
        var del = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-del");
        if (del) { ev.stopPropagation(); 내지시삭제(del); q.remove(); renderDrawer(); return; }
        var input = document.getElementById("chatInput");
        input.value = q.getAttribute("data-q");
        submit();
      });
    });
    body.appendChild(el);
    while (body.childElementCount > CL_MAX) body.removeChild(body.firstChild);
    body.scrollTop = body.scrollHeight;
  }

  function append(kind, o) {
    var body = rows();
    var empty = body.querySelector(".cs-empty");
    if (empty) empty.remove();
    var el = document.createElement("div");
    el.className = "cs-row " + kind;
    var time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    var msg = String(o.message == null ? "" : o.message);
    // o.full — 접으면 안 되는 답. 순서 안내는 2번째 단계부터 가려지면 안내가 아니다
    // (2026-07-31 실화면: "가서 하기" 답이 1단계만 보이고 접혀 있었다).
    var long = !o.full && (kind === "reply" || kind === "event") && msg.length > CLAMP_LEN;
    var bodyHtml = kind === "typing"
      ? '<span class="cm cs-typing"><span></span><span></span><span></span></span>'
      : '<div class="cm' + (long ? " clamp" : "") + '">' + fmt(kind, msg) + "</div>" + (long ? '<span class="cl-more">더보기 ▾</span>' : "");
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
    // 화면이 실제로 바뀌었으면 대화에 구분선을 남긴다 — 답의 소속이 갈리도록(2026-08-09 시안 ④).
    // 첫 로드(prevScreen==null)나 같은 화면 재통지에는 안 남긴다.
    if (prevScreen != null && ctx.screen && ctx.screen !== prevScreen) {
      var bodyEl = document.getElementById("csBody");
      if (bodyEl && bodyEl.querySelector(".cs-row")) {
        var dv = document.createElement("div");
        dv.className = "cs-div";
        dv.textContent = (ctx.label || ctx.screen) + "(으)로 이동";
        bodyEl.appendChild(dv);
        bodyEl.scrollTop = bodyEl.scrollHeight;
      }
      ctxOff = false; // 새 화면에 왔으면 맥락은 다시 붙는다(뗀 것은 그 화면에서의 선택이었다)
      setSelection(null); // 선택도 푼다 — 옆 화면 항목을 계속 가리키면 「이거」가 거짓말이 된다
    }
    prevScreen = ctx.screen || prevScreen;
    // 맥락 칩 — 이름 + ✕(떼기). VS Code implicit context의 결론(보이게+뗄 수 있게)을 그대로.
    chip.classList.toggle("off", ctxOff);
    chip.innerHTML = esc(ctx.label || "대시보드") + (ctxOff ? "" : ' <span class="x" title="이번 질문들을 화면과 무관하게 묻습니다">✕</span>');
    var hint = document.getElementById("csHint");
    if (hint) hint.textContent = ctxOff ? "화면 무관 — 칩을 누르면 다시 붙습니다" : "보고 있는 화면 기준으로 지시합니다";
    input.placeholder = ctxOff ? "지시를 입력하세요… (화면 무관)"
      : ctx.label ? "「" + ctx.label + "」 화면에 대해 지시…" : "지시를 입력하세요…";
    renderChips();
    renderFlow();
    // 탭이 바뀌면 서랍의 「지금 화면」 순서도 따라 바뀌어야 한다(2026-08-06) —
    // 안 그리면 옆 화면 것이 위에 남아 "해당 메뉴에서 할 수 있는 것"이라는 약속이 깨진다.
    renderDrawer();
  }

  // ── 메뉴 연동 재설계(2026-08-09 시안 승인 + 외부사례 B·C) ────────────────
  var prevScreen = null;
  var ctxOff = false; // C. 맥락 떼기 — 켜지면 지시에 화면을 안 싣는다

  // ── 2단계: 선택 항목 맥락 — 화면에서 고른 것이 「이거」가 된다 ──────────
  var sel = null; // { label, text } | null — 화면(iframe)이 gijo:select로 알려 준다
  function setSelection(s) {
    sel = s && s.label && s.text ? s : null;
    var el = document.getElementById("csSel");
    if (!el) return;
    if (!sel) { el.style.display = "none"; el.innerHTML = ""; return; }
    el.style.display = "";
    el.innerHTML = "📌 " + esc(sel.label) + ' <span class="x" title="선택을 풉니다">✕</span>';
  }

  /** ② 화면별 칩 — 그 화면 갈래(CAN.screens)에서 3~4개 + 첫 칩은 항상 ⓘ. */
  function renderChips() {
    var el = document.getElementById("csChips");
    if (!el) return;
    var 지금 = (ctx && ctx.screen) || "";
    var qs = [];
    CAN.forEach(function (c) {
      if (c.screens && c.screens.indexOf(지금) >= 0) qs = qs.concat(fillQs(c.qs).map(function (x) { return { q: x.q, ok: c.kind === "ok" }; }));
    });
    var html = '<span class="cs-chip" data-guide="1" title="이 화면이 뭐 하는 곳인지 카드로 안내합니다">ⓘ 이 화면 안내</span>';
    qs.slice(0, 4).forEach(function (x) {
      html += '<span class="cs-chip' + (x.ok ? " ok" : "") + '" data-q="' + esc(x.q) + '"' + (x.ok ? ' title="승인 후 실행됩니다"' : "") + ">" + esc(x.q) + "</span>";
    });
    el.innerHTML = html;
    el.querySelectorAll(".cs-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.guide) return guideAsk();
        ask(b.dataset.q);
      });
    });
  }

  /** ① 절차 띠 + 살아 있는 숫자 — /api/workflow/stages 재사용(새 계산 없음). 60초 캐시. */
  var stagesCache = { at: 0, stages: null };
  function renderFlow() {
    var el = document.getElementById("csFlow");
    if (!el) return;
    var screenFile = ((ctx && ctx.screen) || "").split("/").pop().split("?")[0];
    var draw = function (stages) {
      var idx = -1;
      stages.forEach(function (s, i) { if ((s.screens || []).indexOf(screenFile) >= 0) idx = i; });
      if (idx < 0) { el.style.display = "none"; return; } // 절차 밖 화면 — 띠를 안 그린다(빈 띠는 고장으로 읽힌다)
      var html = "";
      stages.forEach(function (s, i) {
        if (Math.abs(i - idx) > 1) return; // 앞·지금·다음만 — 다섯 칸을 다 그리면 띠가 줄바꿈된다
        html += '<span class="st' + (i === idx ? " now" : "") + '" data-page="' + esc(s.page) + '" data-label="' + esc(s.label) + '" title="' +
          (i === idx ? "지금 여기" : "누르면 이 단계 화면으로") + '">' + s.no + " " + esc(s.label) + "</span>";
        if (i === idx || (i === idx - 1)) html += '<span class="ar">→</span>';
      });
      // 살아 있는 숫자 — 지금 단계의 count·alert(서버가 이미 계산해 주는 값 그대로)
      var me = stages[idx];
      var live = "";
      if (me.count != null) live += "대상 " + me.count;
      if (me.alert != null && me.alertLabel) live += (live ? " · " : "") + me.alertLabel + " <b>" + me.alert + "</b>";
      html += '<span class="cs-live">' + live + "</span>";
      el.innerHTML = html;
      el.style.display = "flex";
      el.querySelectorAll(".st:not(.now)").forEach(function (b) {
        b.addEventListener("click", function () {
          if (window.gijoTabs) window.gijoTabs.open(b.dataset.page, b.dataset.label);
          else if (window.gijo && window.gijo.openTabInShell) window.gijo.openTabInShell(b.dataset.page, b.dataset.label);
        });
      });
    };
    if (stagesCache.stages && Date.now() - stagesCache.at < 60000) return draw(stagesCache.stages);
    if (!window.gijo || !window.gijo.workflowStages) { el.style.display = "none"; return; }
    window.gijo.workflowStages().then(function (r) {
      stagesCache = { at: Date.now(), stages: (r && r.stages) || [] };
      draw(stagesCache.stages);
    }).catch(function () { el.style.display = "none"; }); // 못 읽으면 숨긴다 — 빈 띠로 채우지 않는다
  }

  /** ③ 화면 안내 카드 — ⓘ 답이 말풍선으로 쌓이지 않고 카드 한 장을 갈아끼운다(중복 구조 차단). */
  var guideBusy = false;
  function guideAsk() {
    var body = document.getElementById("csBody");
    if (!body || guideBusy || !window.gijo || !window.gijo.sendInstruction) return;
    var card = document.getElementById("csGuide");
    if (!card) {
      card = document.createElement("div");
      card.className = "cs-guide open";
      card.id = "csGuide";
      var empty = body.querySelector(".cs-empty");
      if (empty) empty.remove();
      body.insertBefore(card, body.firstChild); // 항상 대화 맨 위 — 안내는 배경이지 대화가 아니다
    }
    var label = (ctx && ctx.label) || "이 화면";
    card.innerHTML = '<div class="gh"><span>ⓘ ' + esc(label) + ' — 화면 안내</span><span class="car">불러오는 중…</span></div><div class="gb"></div>';
    guideBusy = true;
    window.gijo.sendInstruction("이 화면에서 뭐 할 수 있어?", session ? session.id : undefined, ctx.screen || undefined)
      .then(function (r) {
        card.innerHTML = '<div class="gh"><span>ⓘ ' + esc(label) + ' — 화면 안내</span><span class="car">▾ 접기/펴기</span></div>' +
          '<div class="gb">' + fmt("reply", (r && r.output) || "(안내를 받지 못했습니다)") + "</div>";
        card.classList.add("open");
        card.querySelector(".gh").addEventListener("click", function () { card.classList.toggle("open"); });
      })
      .catch(function (e) {
        card.innerHTML = '<div class="gh"><span>ⓘ ' + esc(label) + ' — 화면 안내</span><span class="car">불러오기 실패 — ' + esc((e && e.message) || "오류") + "</span></div>";
      })
      .finally(function () { guideBusy = false; });
  }
  function readCtxFromShell() {
    if (IS_WINDOW || !window.gijoTabs) return;
    ctx = { screen: window.gijoTabs.activeScreen(), label: window.gijoTabs.activeLabel() };
    applyCtx();
  }

  // ── 전송 ──────────────────────────────────────────────────────────────
  var sending = false;
  /**
   * @param sendText 입력칸 대신 보낼 지시(목록에서 고르고 누른 조치 등). 없으면 입력칸을 읽는다.
   * @param showText 대화에 보여 줄 문장. 고른 건 조치는 뒤에 기계용 표식이 붙는데,
   *                 그걸 그대로 보여 주면 대화가 지저분해진다 — 사람에겐 뜻만 보인다.
   */
  async function submit(sendText, showText) {
    var input = document.getElementById("chatInput");
    // 문자열이 아닌 것(이벤트 객체 등)은 지시가 아니다 — 실수로 붙어도 입력칸을 읽게 둔다.
    var typed = typeof sendText !== "string";
    var text = typed ? (input.value || "").trim() : sendText.trim();
    if (!text || sending) return;
    if (typed) {
      input.value = "";
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    }
    sending = true;
    document.getElementById("dockSend").disabled = true;
    append("instr", { icon: "나", name: "나 → AI 팀", message: showText == null ? text : showText });
    var typing = append("typing", { icon: "🧭", name: "오케스트레이터" });
    // 진행 카드 — 점 세 개 대신 서버가 실제로 지나는 단계를 보여준다(2026-07-30 시안 승인).
    // 카드는 typing 행의 .cm 자리에 그린다. progresscard.js가 없으면 기존 점 애니메이션 그대로.
    var pc = null, pid;
    var cmEl = typing.querySelector(".cm");
    if (window.gijoProgressCard && cmEl) {
      pid = window.gijoProgressCard.newId();
      cmEl.classList.remove("cs-typing");
      pc = window.gijoProgressCard.start(cmEl, pid);
    }
    try {
      // 맥락(screen)을 함께 보낸다 — "정리해줘"가 취약점 화면 앞에서는 취약점 정리로 해석된다
      // (server/engine/screencontext.ts). 보고 있는 탭이 곧 그 맥락이다.
      // C. 맥락을 뗐으면(ctxOff) 화면을 싣지 않는다 — "NIST CSF가 뭐야?" 같은 일반 질문에
      //    화면 맥락이 오히려 해석을 비트는 경우가 있다(외부사례: VS Code implicit context 논쟁).
      var r = await window.gijo.sendInstruction(text, session ? session.id : undefined, (ctxOff ? undefined : ctx.screen) || undefined, pid, sel ? sel.text : undefined);
      if (pc) pc.stop();
      if (r && r.sessionId) {
        session = { id: r.sessionId };
        try { localStorage.setItem(SESS_KEY, JSON.stringify(session)); } catch (e) {}
      }
      var replyEl = replaceTyping(typing, "reply", {
        icon: "🧭", name: "AI 팀", message: (r && r.output) || "(응답 없음)",
        full: !!(r && r.openScreen), // 순서 안내는 접지 않는다 — 접으면 순서를 못 읽는다
      });
      // B. 해석 한 줄 — 질문을 어느 도구로 알아들었는지(서버가 사람 말로 만들어 준다).
      //    라우팅이 어긋난 날 담당자가 이 줄에서 바로 알아차린다(Purple AI 쿼리 투명성 채택).
      if (r && r.해석) {
        var parseEl = document.createElement("div");
        parseEl.className = "cs-parse";
        parseEl.textContent = "🧭 " + r.해석;
        var cmHost = replyEl.querySelector(".cm");
        if (cmHost && cmHost.parentNode) cmHost.parentNode.insertBefore(parseEl, cmHost);
      }
      // 지적 버튼 — 방금 보낸 질문과 이 답을 짝지어 둔다(중-1 피드백 루프).
      attachFlag(replyEl, text, (r && r.output) || "");
      // 근거 원문 — 답의 숫자를 담당자가 눈으로 검증할 수 있게(2026-08-01).
      // ★ 아래 셋은 **분리창 위젯과 같은 부품**을 쓴다(chatparts.js) — 2026-08-01 사용자 지적
      //   "대화창 하나의 구조로 되어 있는 게 맞지?"에 대한 답이다.
      //   자리마다 다른 것은 **여는 방법**과 **붙일 자리**뿐이라 그것만 여기서 넘긴다.
      //   ⚠ 자체 구현(attachQuotes·attachOpen·attachPicks)은 아래에 남아 있지만 이제 안 부른다.
      //     지우다가 옆 함수를 잘라 먹은 적이 있어(같은 날) **호출만 끊고 코드는 둔다** —
      //     다음 정리 때 시험이 통과하는 것을 보고 지운다.
      var P = window.gijoChatParts;
      P.quotes(replyEl, r && r.quotes, (r && r.output) || "", r && r.sources);
      // "가서 하기" — 계정·인증·열쇠처럼 AI가 대신 하면 안 되는 일은 순서만 안내하고,
      // 그 화면을 찾아 들어가는 수고는 없앤다(2026-07-31 사용자 지시).
      P.open(replyEl, r && r.openScreen, {
        navigate: function (page, leaf) {
          // 창 모드면 본창에 부탁한다(별도 창은 탭을 직접 못 연다). 셸 안이면 바로 연다.
          if (IS_WINDOW && window.gijo && window.gijo.openTabInShell) {
            return window.gijo.openTabInShell(page, leaf).then(function (x) { return !!(x && x.ok); });
          }
          if (window.gijoTabs) { window.gijoTabs.open(page, leaf); return true; }
          if (window.gijo && window.gijo.navigateTo) { window.gijo.navigateTo(page); return true; }
          return false;
        },
      });
      // 목록이 나왔으면 체크해서 바로 조치할 수 있게 한다(2026-07-31 "리스트를 보고 선택도 가능한거지?").
      // 붙일 자리(.cb)는 지휘소 고유라 여기서 정한다 — 부품은 만들어만 주고 자리는 안 정한다.
      var pickEl = P.picks(replyEl, r && r.picklist, function (보낼글, 보일글) { submit(보낼글, 보일글); });
      if (pickEl) (replyEl.querySelector(".cb") || replyEl).appendChild(pickEl);
      // 쓰기 지시는 결재판으로 돌아온다 — 대화창에서 바로 확인·승인한다(없으면 막다른 길이다).
      attachApproval(replyEl, r && r.approval);
    } catch (e) {
      if (pc) pc.stop();
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
  // ★ 위 세 줄이 제품 1차 목표의 **3소스**다 — 취약점 스캐너 · 보안로그 · 운영리포트.
  //   보안로그·운영리포트는 2026-08-01에 되살렸다(드롭존을 없애면서 인입 경로가 통째로
  //   끊겨 있었다 — 엔진은 멀쩡한데 담당자가 넣을 길이 없었다).
  //   ⚠ 「보안 로그 원본」과 「로그 매뉴얼」은 다른 것이다. 앞은 장비가 뱉은 기록이라
  //   통합 분석 이벤트가 되고, 뒤는 그 로그를 읽는 법을 적은 설명서라 제품 등록부로 간다.
  var UPLOAD_TYPES = [
    { t: "vulnreport", label: "🩹 취약점 리포트" },
    { t: "securitylog", label: "🚨 보안 로그 원본" },
    { t: "opsreport", label: "📈 운영 리포트" },
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
    // 통합 분석 인입(보안로그·운영리포트) — 제품 1차 목표의 소스 ②③.
    // ⚠ 0건일 때 **왜 0건인지**를 말한다. 아무 말 없이 끝나면 "올렸는데 아무 일도 없다"가 된다.
    if (r.routedTo === "analysis") {
      var a = r.analysis || { kind: "log", created: 0 };
      var 종류 = a.kind === "log" ? "보안 로그" : "운영 리포트";
      if (a.created > 0) {
        return 종류 + "로 인입 — 통합 분석에 " + a.created + "건 등록. \"지금 제일 급한 위험 뭐야?\"라고 물어보세요.";
      }
      return 종류 + "로 읽었지만 **탐지 규칙에 걸린 항목이 없어** 분석 이벤트는 만들지 않았습니다 — 원문은 저장했으니 내용은 물어보실 수 있습니다.";
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
  // prefill() — **보내지 않고** 문장 앞부분만 얹어 두고 커서를 뒤에 놓는다(2026-08-01).
  // "할 일 적어 넣기"처럼 뒷말을 담당자가 채워야 하는 자리에 쓴다. 빈 칸만 보여 주면
  // 무슨 말을 해야 할지 몰라 그 자리에서 멈춘다 — 첫 몇 글자가 그걸 막는다.
  function prefill(text) {
    var input = document.getElementById("chatInput");
    if (!input) return;
    input.value = text;
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
  }
  window.gijoConsole = { append: append, syncCtx: readCtxFromShell, submit: submit, ask: ask, prefill: prefill, guide: guideAsk, select: setSelection };

  // 다른 화면·다른 창에서 "이 지시를 대화창에서 이어서" 하고 넘겨 준 것을 받는다.
  // ⚠ 빈 글이면 **보내지 않는다** — 「이어서 지시하기」만 누른 사람은 아직 할 말을 안 정했다.
  //   커서만 놓아 주는 것이 맞고, 빈 지시를 던지면 AI가 엉뚱한 답을 만든다.
  if (window.gijo && window.gijo.onConsoleAsk) {
    window.gijo.onConsoleAsk(function (text, sessionId) {
      // 세션을 함께 받으면 **그 작업으로 갈아탄다** — 「작업 내역에서 이어서 지시」가 그 작업에
      // 붙어야 한다. 안 갈아타면 대화창이 기억하던 다른 세션에 기록돼 버튼 이름이 거짓이 된다
      // (2026-08-01 검토 지적).
      if (sessionId) {
        session = { id: String(sessionId) };
        try { localStorage.setItem(SESS_KEY, JSON.stringify(session)); } catch (e) {}
      }
      var 글 = String(text || "").trim();
      if (글) { ask(글); return; }
      var input = document.getElementById("chatInput");
      if (input) input.focus();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
