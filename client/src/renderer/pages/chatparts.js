/**
 * chatparts.js — 대화창 답변에 붙는 **공용 부품**.
 *
 * 왜 만들었나(2026-08-01 사용자 지적: "대화창 하나의 구조로 되어 있는 게 맞지?"):
 *   담당자가 지시를 넣는 자리가 두 곳이다.
 *     · 셸의 지휘소(console.js)      — 평소에 쓰는 자리
 *     · 화면 위젯(chatwidget.js)     — **분리창(⧉ 창으로)** 에서는 여기가 유일한 창구다
 *   그런데 같은 답인데 자리마다 붙는 것이 달랐다(실측):
 *     체크칸·가서 하기가 지휘소에만 있어, 화면을 창으로 빼는 순간 목록에서 고를 수가 없었다.
 *     담당자는 "아까는 됐는데?"가 된다 — 기능이 아니라 **자리**가 다른 것을 사람은 모른다.
 *
 *   부품을 여기 한 곳에 두고 양쪽이 부른다. 한쪽에만 고쳐 놓고 고쳤다고 믿는 일을 없앤다.
 *
 * ⚠ 이 파일은 **화면(DOM)만** 만든다. 서버로 보내는 일은 부르는 쪽이 넘겨준다(submit·navigate).
 *   지휘소와 분리창은 보내는 방법이 달라서(창은 본창에 부탁해야 한다) 그 차이만 바깥에 남긴다.
 *
 * 쓰는 법:
 *   window.gijoChatParts.quotes(el, r.quotes, r.output, r.sources)
 *   window.gijoChatParts.picks(el, r.picklist, function (보낼글, 보일글) { ... })
 *   window.gijoChatParts.open(el, r.openScreen, { navigate: function (page, label) { ... } })
 */
(function () {
  if (window.gijoChatParts) return; // 두 번 읽혀도 한 벌만

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };

  // CSS는 여기서 스스로 넣는다 — 부르는 쪽 스타일에 기대면 한쪽에서만 깨진다.
  // 클래스는 gcp-(gijo chat parts) 접두로 두어 기존 cs-·gcw- 와 섞이지 않게 한다.
  function ensureCss() {
    if (document.getElementById("gijoChatPartsCss")) return;
    var st = document.createElement("style");
    st.id = "gijoChatPartsCss";
    st.textContent = [
      ".gcp-pick{margin-top:8px;border:1px solid rgba(255,255,255,.10);border-radius:9px;padding:8px 10px;}",
      ".gcp-pick.done{opacity:.55;}",
      ".gcp-ph{font-size:12.25px;color:var(--muted-2,#a49d95);margin-bottom:6px;}",
      ".gcp-pi{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;cursor:pointer;}",
      ".gcp-pi:hover{background:rgba(255,255,255,.03);}",
      ".gcp-pi input{width:auto;margin:0;flex:0 0 auto;}",
      ".gcp-pl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".gcp-ps{flex:0 0 auto;font-size:12px;color:var(--muted-2,#a49d95);}",
      ".gcp-pb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);}",
      ".gcp-pc{font-size:12.25px;color:var(--muted,#b3ada4);margin-right:auto;}",
      ".gcp-pact{font-size:12.25px;font-weight:700;color:var(--blue-light,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.30);border-radius:7px;padding:4px 9px;cursor:pointer;font-family:inherit;min-height:26px;}",
      ".gcp-pact:hover:not(:disabled){background:rgba(59,130,246,.20);}",
      ".gcp-pact:disabled{color:var(--muted-2,#a49d95);background:none;border-color:rgba(255,255,255,.08);cursor:default;}",
      ".gcp-pv{display:flex;gap:6px;margin-top:7px;}",
      ".gcp-pvi{flex:1;background:var(--panel-2,#1f1e1d);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:5px 9px;color:var(--text,#e9e7e2);font-size:12px;font-family:inherit;outline:none;}",
      ".gcp-open{display:block;margin-top:8px;font-size:12.5px;font-weight:700;color:var(--blue-light,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.35);border-radius:8px;padding:6px 12px;cursor:pointer;min-height:28px;font-family:inherit;}",
      ".gcp-open:hover{background:rgba(59,130,246,.18);}",
      ".gcp-open:disabled{color:var(--teal,#1eb980);background:rgba(30,185,128,.10);border-color:rgba(30,185,128,.35);cursor:default;}",
      ".gcp-src{margin-top:6px;font-size:11.5px;font-weight:700;color:var(--teal,#6fdcb5);}",
      // ② 찾아보긴 했으나 근거는 아님 — 초록(근거 있음)과 **눈에 띄게 달라야** 한다.
      //   호박색은 이 제품에서 「주의·확인 필요」 자리다(근거 약함 배너의 ⚠와 같은 결).
      ".gcp-src2{margin-top:6px;font-size:11.5px;font-weight:700;color:var(--amber,#ffd88a);}.gcp-doclink{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;}.gcp-doclink:hover{opacity:.8;}",
      // ★ 근거 없음 답의 숫자 — 옅게 + 주황 점선(2026-09-05 승인 시안 no-evidence-numbers).
      //   ⚠ **색과 밑줄만** 바꾼다. 글자 크기·굵기·자간·padding·border를 안 건드리므로 글자 폭이
      //     안 변하고 → 줄바꿈이 안 변하고 → **세로 총합 증감이 0px**다(시안이 실측한 값).
      //   ⚠ 취소선을 안 쓴다 — 「값이 틀렸다」로 오독된다. 지어낸 값이지 틀린 값이 아니다.
      //   ⚠ 색만으로 뜻을 나르지 않는다(색각 이상·고대비) — 그래서 점선을 함께 깐다.
      ".dim-est{color:var(--muted-2,#a49d95);text-decoration:underline dotted rgba(240,160,32,.6);text-underline-offset:2px;text-decoration-thickness:1px;cursor:help;}",
      // 굵은 글씨·표 안에서도 옅게(그 자리들은 색을 따로 정해 둬서 상속만으로는 안 먹는다). 굵기는 그대로 둔다.
      "strong .dim-est,b .dim-est,th .dim-est,td .dim-est{color:var(--muted-2,#a49d95);}",
      ".gcp-ev{margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;min-width:0;}",
      // 데이터 카드(승인 시안 대화_데이터카드, 2026-08-19) — KPI+표. 밀도는 전역 규격(25px)과 같게.
      ".dc-card{margin-top:8px;border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden;background:var(--panel-2,#1f1e1d);}",
      ".dc-head{display:flex;align-items:center;gap:8px;padding:7px 11px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12.75px;font-weight:800;color:var(--text,#e9e7e2);}",
      ".dc-open{margin-left:auto;font-size:12px;font-weight:700;color:var(--blue-light,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.35);border-radius:7px;padding:3px 9px;cursor:pointer;font-family:inherit;}",
      // 단추가 둘(🎯 고르기+🗔 열기)일 때 auto가 둘로 갈려 허공에 뜨지 않게 — 첫 단추만 민다(검토관 하2)
      ".dc-open + .dc-open{margin-left:8px;}",
      ".dc-open:hover{background:rgba(59,130,246,.18);}",
      ".dc-kpis{display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,.08);}",
      ".dc-kpi{flex:1;padding:7px 11px;border-right:1px solid rgba(255,255,255,.06);}",
      ".dc-kpi:last-child{border-right:0;}",
      ".dc-kl{font-size:11.5px;color:var(--muted-2,#a49d95);}",
      ".dc-kv{font-size:15px;font-weight:800;color:var(--text,#e9e7e2);}",
      ".dc-kv.ok{color:var(--teal,#1eb980);} .dc-kv.warn{color:var(--amber,#f0a020);} .dc-kv.bad{color:var(--red-ink, #f5928a);} .dc-kv.muted{color:var(--muted-2,#a49d95);}",
      ".dc-card table{width:100%;border-collapse:collapse;font-size:12.25px;}",
      ".dc-card th{text-align:left;padding:3px 10px;color:var(--muted-2,#a49d95);font-size:11.5px;border-bottom:1px solid rgba(255,255,255,.08);}",
      ".dc-card td{padding:3px 10px;line-height:1.35;border-bottom:1px solid rgba(255,255,255,.05);}",
      ".dc-card tbody tr{cursor:pointer;} .dc-card tbody tr:hover td{background:rgba(59,130,246,.08);}",
      ".dc-card tbody tr:nth-child(even){background:rgba(255,255,255,.025);}",
      ".dc-card .num{text-align:right;font-variant-numeric:tabular-nums;}",
      ".dc-more{padding:5px 11px;font-size:11.75px;color:var(--muted-2,#a49d95);}",
      // 보기 전환(승인 시안 카드_보기전환) — 세그먼트는 titlebar.js .gtb-seg 언어의 압축판
      ".dc-seg{display:inline-flex;margin-left:auto;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:2px;gap:2px;}",
      ".dc-seg span{padding:2px 8px;border-radius:5px;font-size:11px;font-weight:800;color:var(--muted-2,#a49d95);cursor:pointer;line-height:1.3;white-space:nowrap;}",
      ".dc-seg span.on{background:rgba(59,130,246,.22);color:#fff;}",
      ".dc-seg span:not(.on):hover{color:var(--text-strong, #fff);}",
      ".dc-head.hasseg .dc-open{margin-left:0;}",
      ".dc-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px;padding:8px 10px;}",
      ".dc-tile{border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:6px 8px;cursor:pointer;background:rgba(255,255,255,.03);}",
      ".dc-tile:hover{filter:brightness(1.18);}",
      ".dc-tile.bad{background:rgba(245,146,138,.14);border-color:rgba(245,146,138,.45);}",
      ".dc-tile.warn{background:rgba(240,160,32,.14);border-color:rgba(240,160,32,.45);}",
      ".dc-tile.ok{background:rgba(30,185,128,.14);border-color:rgba(30,185,128,.45);}",
      // ⚠ 시안은 10px였으나 가독성 계약(11px 미만 금지)에 맞춰 11px로 올렸다
      ".dc-tv{font-size:11px;font-weight:800;letter-spacing:.2px;}",
      ".dc-tv.bad{color:var(--red-ink, #f5928a);} .dc-tv.warn{color:var(--amber,#f0a020);} .dc-tv.ok{color:var(--teal,#1eb980);} .dc-tv.muted{color:var(--muted-2,#a49d95);}",
      ".dc-tl{font-size:11.5px;font-weight:700;color:var(--text,#e9e7e2);line-height:1.3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dc-ts{font-size:11px;color:var(--muted-2,#a49d95);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      // ➡ 다음 작업 칩(QA ④) — 답 꼬리의 낮은 존재감 한 줄(제안이지 재촉이 아니다)
      ".gcp-next{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:7px;border-top:1px dashed rgba(255,255,255,.10);}",
      ".gcp-nh{font-size:11.5px;color:var(--muted-2,#a49d95);flex:0 0 auto;}",
      ".gcp-nc{font-size:12px;color:var(--text,#e9e7e2);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:3px 10px;cursor:pointer;font-family:inherit;}",
      ".gcp-nc:hover{background:rgba(59,130,246,.14);border-color:rgba(59,130,246,.4);}",
      // 안전망 — 어쩌다 줄(.cs-row)에 직접 붙어도 **아래로** 가지 옆으로 가지 않게 한다.
      ".cs-row{flex-wrap:wrap;}",
      ".cs-row > .gcp-ev, .cs-row > .gcp-src, .cs-row > .gcp-src2, .cs-row > .gcp-open, .cs-row > .gcp-picks{flex:1 1 100%;}",
      ".gcp-evh{font-size:12px;color:var(--muted,#b3ada4);cursor:pointer;user-select:none;}",
      ".gcp-q{border-left:3px solid rgba(59,130,246,.45);background:rgba(59,130,246,.05);padding:7px 10px;border-radius:0 6px 6px 0;margin-bottom:6px;}",
      ".gcp-qd{font-size:11.5px;color:var(--muted-2,#a49d95);margin-bottom:3px;}",
      ".gcp-qt{font-size:12.25px;line-height:1.75;color:#cdd4e6;}",
      ".gcp-qt mark{background:rgba(240,160,32,.28);color:var(--amber, #ffd88a);padding:0 2px;border-radius:3px;}",
      /* ── 「이 답 이상해요」 꼬리(2026-09-07 · 승인 시안 mockups/wrong-flag) ──────────
         ⚠ 새 색을 만들지 않는다 — 값은 전부 이미 쓰던 var(…)와 rgba다.
         ⚠ [hidden]을 **직접 적는다.** .wf-line{display:flex}는 작성자 스타일이라
            브라우저 기본 [hidden]{display:none}을 이긴다 — 안 적으면 접힌 줄이 그냥 보인다. */
      ".wf-flag{display:inline-block;margin-top:4px;font-size:11.75px;font-weight:700;color:var(--muted-2,#a49d95);background:none;border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:2px 8px;cursor:pointer;min-height:24px;font-family:inherit;}",
      ".wf-flag:hover{color:var(--amber,#f0a020);border-color:rgba(245,158,11,.45);}",
      ".wf-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}",
      ".wf-line[hidden],.wf-flag[hidden]{display:none;}",
      ".wf-k{font-size:12px;color:var(--text,#e9e7e2);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:3px 10px;cursor:pointer;font-family:inherit;min-height:24px;}",
      ".wf-k:hover{background:rgba(59,130,246,.14);border-color:rgba(59,130,246,.4);}",
      ".wf-k.on{background:rgba(240,160,32,.16);border-color:rgba(240,160,32,.5);color:var(--amber,#f0a020);font-weight:700;}",
      ".wf-cand{font-size:11.5px;color:var(--muted-2,#a49d95);border:1px dashed rgba(255,255,255,.16);border-radius:14px;padding:2px 8px;cursor:help;}",
      ".wf-memo{flex:1;min-width:120px;background:var(--panel-2,#1f1e1d);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:3px 9px;color:var(--text,#e9e7e2);font-size:12px;font-family:inherit;outline:none;height:24px;}",
      ".wf-memo:focus{border-color:var(--blue,#3b82f6);}",
      ".wf-go{font-size:12px;font-weight:700;color:var(--blue-light,#5fa1ff);background:rgba(59,130,246,.10);border:1px solid rgba(59,130,246,.30);border-radius:7px;padding:2px 9px;cursor:pointer;font-family:inherit;min-height:24px;}",
      ".wf-go:hover:not(:disabled){background:rgba(59,130,246,.20);}",
      ".wf-go:disabled{color:var(--muted-2,#a49d95);background:none;border-color:rgba(255,255,255,.08);cursor:default;}",
      ".wf-undo,.wf-x{font-size:11.75px;font-weight:700;color:var(--muted,#b3ada4);background:none;border:none;text-decoration:underline;text-underline-offset:2px;cursor:pointer;font-family:inherit;padding:0 2px;}",
      ".wf-ok{font-size:11.75px;font-weight:700;color:var(--teal,#1eb980);}",
      ".wf-hint{font-size:11.5px;color:var(--muted-2,#a49d95);}",
      ".wf-err{font-size:11.5px;color:var(--red-ink, #f5928a);}",
    ].join("\n");
    document.head.appendChild(st);
  }

  /**
   * 근거 배지 + 근거 원문(접힘).
   *
   * ★ 왜 원문까지 보여 주나(2026-08-01 실측): 문서엔 "미사용 룰 37개"라고 적혀 있는데
   *   AI가 "27"이라고 답했다. 근거 배지에는 그 문서가 **맞게** 떴다 — 자료 찾기는 정상이고
   *   모델이 표를 잘못 읽은 것이다. 담당자는 그 숫자로 보고를 쓴다.
   *   원문을 함께 보여 주면 그 자리에서 눈으로 잡는다.
   *   (모델에게 "숫자를 정확히 읽어라"라고 타이르지 않는다 — 반복 실패한 방식이다.)
   */
  /**
   * 붙일 자리를 고른다 — **말풍선 안**이지 줄(row) 옆이 아니다.
   *
   * ⚠ 2026-08-02 실사고: 대화 한 줄(.cs-row)은 [아이콘][본문] 가로 배치다. 여기에 근거 블록을
   *   그대로 붙이면 **세 번째 칸**이 되어 본문을 옆으로 밀어낸다. 넓은 별도 창에서는 자리가
   *   남아 멀쩡해 보이고, 앱에 붙인 좁은 대화창(380px)에서만 본문이 한 글자 폭으로 찌부러져
   *   "2/시/18/분"처럼 세로로 쪼개졌다 — 그래서 한쪽에서만 깨져 보였다.
   *   줄을 받으면 그 안의 본문 칸(.cb)으로 바꿔 준다.
   */
  function 붙일자리(el) {
    if (el && el.classList && el.classList.contains("cs-row")) {
      var cb = el.querySelector(".cb");
      if (cb) return cb;
    }
    return el;
  }

  /**
   * 근거 배지 — **3상태** (2026-08-13 · 계획서 전-4 4-ⓑ, 시안 승인).
   *
   * ★ 무엇이 문제였나(운영 실측 8문항 8회 재현): 배지가 거짓말을 했다.
   *     "ISMS 인증 취득일은 사내 지식 베이스에 **포함되어 있지 않습니다**"
   *       + 📄 근거: GIJO_지식_보안거버넌스_표준.md · ismsp_접근권한_검토.md
   *   답은 없다는데 출처는 있다 — 담당자가 그 문서를 보고서에 출처로 적을 수 있다.
   *   뿌리: 이 sources는 **답이 인용한 자료가 아니라 서버가 따로 재검색한 후보**인데,
   *         문구는 「📄 **근거**」라고 단언한다.
   *
   * ① 근거로 답함        sources 있고 근거세기="강함"  → 📄 근거: …           (초록, 그대로)
   * ② 찾아보긴 함        sources 있고 근거세기="약함"  → 📄 찾아본 자료 — 근거 아님: … (호박색, 신설)
   * ③ 사내 자료를 안 봄  sources 없음/빈 배열          → **배지 없음**
   *
   * ⚠ 문서 이름은 ②에서도 **보여 준다** — 담당자가 「그럼 그 문서를 올려야겠다」로 이어갈
   *   단서라서다. 떼면 이 배지를 단 이유(2026-08-01 "안 보여주면 못 잡는다")와 반대가 된다.
   * ⚠ 아이콘은 📄 그대로다. tone.ts 표식 사전에 🔎="검색 0건"이 이미 예약돼 있어, 비슷한 🔍를
   *   다른 뜻으로 쓰면 그 파일이 경고하는 문제("표식은 자리마다 뜻이 하나여야")를 반복한다.
   * ⚠ 문구에 「찾지 못했습니다」를 쓰지 않는다 — drawer-audit의 실패 문구 목록에 있어
   *   좋은 답에 실패 딱지가 붙는다(2026-08-13 actioncheck에서 겪은 그 함정).
   */
  // 📄 인용→문서 발신 — 실린 곳에 따라 길이 다르다(③라운드 검토관 [높음]: 분리 대화창은
  //   최상위 창이라 window.top이 자기 자신 — postMessage가 제자리에 떨어져 죽은 조작이 됐다).
  //   도킹(app.html 안): top으로 postMessage → 셸 수신부. 분리창(console.html): bridgeToShell(IPC).
  function 문서열기신호(id) {
    var msg = { type: "gijo:opendoc", documentId: String(id || "") };
    if (!msg.documentId) return;
    try {
      if (/console\.html/i.test(location.pathname) && window.gijo && window.gijo.bridgeToShell) {
        window.gijo.bridgeToShell(msg);
        return;
      }
      window.top.postMessage(msg, "*");
    } catch (e) { }
  }
  // ★ 이름은 sourceTitles, 여는 것은 sources (2026-09-06 라이브 수리)
  //   서버의 sources는 **기계용 키**다 — 그대로 찍었더니 내부 ID 「승인문답:dtmtl5b1fzj215l3」이
  //   배지에 그대로 실렸다(담당자에게 아무것도 안 가리키고 저장 구조만 드러낸다).
  //   서버가 같은 순서로 사람 제목(sourceTitles)을 함께 준다. 제목이 **빈 문자열이면 생략**이니
  //   그 자리는 이름 대신 건수로 말한다 — ID를 대신 찍지 않는다.
  //   ⚠ 여기서 ID 꼴을 다시 판정하지 않는다(제품 판정은 서버 memory.사람이읽는문서제목 한 곳).
  //   ⚠ sourceTitles가 아예 없으면(옛 서버) 예전대로 sources를 그린다 — 새 클라 + 옛 서버에서
  //     배지가 통째로 사라지는 것이 더 나쁘다.
  function quotes(el, list, answer, sources, 근거세기, sourceTitles) {
    el = 붙일자리(el);
    if (!el) return;
    ensureCss();
    if (Array.isArray(sources) && sources.length) {
      var 약함 = 근거세기 === "약함";
      var badge = document.createElement("div");
      badge.className = 약함 ? "gcp-src2" : "gcp-src";
      // 문서명 클릭 → 내 문서에서 원문 열기(「123진행」 ③-C — 시안 「인용→소스 점프」의 1차분).
      // 발신은 문서열기신호 한 곳 — 도킹은 postMessage, 분리 대화창은 IPC 다리(위 함수 주석).
      badge.appendChild(document.createTextNode(약함 ? "📄 찾아본 자료 — 근거 아님: " : "📄 근거: "));
      var 제목있음 = Array.isArray(sourceTitles);
      var 보일것 = [];
      sources.forEach(function (id, i) {
        var nm = 제목있음 ? String(sourceTitles[i] == null ? "" : sourceTitles[i]).trim() : String(id == null ? "" : id);
        if (nm) 보일것.push({ nm: nm, id: id });
      });
      if (!보일것.length) {
        // 이름을 댈 수 있는 문서가 하나도 없다 — 건수만 정직하게 말한다.
        badge.appendChild(document.createTextNode("사내 문서 " + sources.length + "건"));
      } else {
        보일것.slice(0, 4).forEach(function (s, i) {
          if (i) badge.appendChild(document.createTextNode(" · "));
          var a = document.createElement("span");
          a.className = "gcp-doclink";
          a.textContent = s.nm;
          a.title = "내 문서에서 이 문서 열기";
          a.addEventListener("click", function () { 문서열기신호(s.id); });
          badge.appendChild(a);
        });
        var 숨김 = sources.length - Math.min(보일것.length, 4);
        if (숨김 > 0) badge.appendChild(document.createTextNode(" 외 " + 숨김 + "건"));
      }
      el.appendChild(badge);
    }
    if (!Array.isArray(list) || !list.length) return;

    var wrap = document.createElement("div");
    wrap.className = "gcp-ev";
    var head = document.createElement("div");
    head.className = "gcp-evh";
    var open = false;
    // ⚠ 약함이면 머리도 정직하게(검토관) — 배지는 「근거 아님」인데 바로 밑이 「근거 원문」이면
    //   한 화면에서 같은 문서가 근거이며 근거 아님이 된다.
    var 약함2 = 근거세기 === "약함";
    var draw = function () { head.textContent = (open ? "▾" : "▸") + (약함2 ? " 📄 찾아본 자료 원문 " + list.length + "대목 — 근거로 쓰인 것은 아님" : " 📄 근거 원문 " + list.length + "대목 — 답이 맞는지 확인"); };
    draw();
    var body = document.createElement("div");
    body.style.cssText = "display:none;margin-top:6px";

    // 답에 나온 숫자·영문코드를 원문에서 강조 — 눈이 바로 그리로 간다.
    var marks = (String(answer || "").match(/\d[\d,.\-]{0,12}|[A-Z][A-Za-z0-9\-]{3,}/g) || [])
      .filter(function (t) { return t.length >= 2; }).slice(0, 12);
    list.slice(0, 3).forEach(function (q) {
      var box = document.createElement("div");
      box.className = "gcp-q";
      var txt = esc(q.text || "");
      marks.forEach(function (t) {
        var safe = esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try { txt = txt.replace(new RegExp(safe, "g"), "<mark>$&</mark>"); } catch (e) {}
      });
      // 머리에 찍는 것은 **제목**(q.title) — documentId를 그대로 찍던 자리라 배지와 같은 누출이었다.
      // 제목이 없으면(옛 서버) documentId, 제목이 빈 문자열이면(내부 ID) 「사내 문서」로 말한다.
      var 이름 = q.title == null ? String(q.documentId || "") : String(q.title).trim();
      box.innerHTML = '<div class="gcp-qd gcp-doclink" title="내 문서에서 이 문서 열기">' + esc(이름 || "사내 문서") + '</div><div class="gcp-qt">' + txt + "</div>";
      box.querySelector(".gcp-qd").addEventListener("click", function () { 문서열기신호(q.documentId); });
      body.appendChild(box);
    });

    head.addEventListener("click", function () { open = !open; body.style.display = open ? "block" : "none"; draw(); });
    wrap.appendChild(head); wrap.appendChild(body);
    el.appendChild(wrap);
  }

  /**
   * 체크칸 — 목록에서 골라 바로 조치한다.
   *
   * submit(보낼글, 보일글): 고른 것을 서버로 보내는 일은 부르는 쪽이 한다.
   *   보낼글에는 기계 표식(#고른건 sha1…)이 들어가고, 보일글은 사람이 읽는 한 줄이다.
   *   ⚠ 표식이 대화 기록에 남으면 안 되므로 서버가 걸러낸다(stripPickMarks) — 여기선 그냥 보낸다.
   */
  function picks(el, pl, submit) {
    el = 붙일자리(el);
    if (!el || !pl || !pl.items || !pl.items.length || typeof submit !== "function") return;
    ensureCss();
    var chosen = [];
    var wrap = document.createElement("div");
    wrap.className = "gcp-pick";

    var head = document.createElement("div");
    head.className = "gcp-ph";
    head.textContent = pl.kind === "task"
      ? "끝낸 일을 골라 바로 체크할 수 있습니다"
      : "고쳐야 할 것을 골라 바로 처리할 수 있습니다";
    wrap.appendChild(head);

    pl.items.forEach(function (it) {
      var row = document.createElement("label");
      row.className = "gcp-pi";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", function () {
        var at = chosen.indexOf(it.id);
        if (cb.checked) { if (at < 0) chosen.push(it.id); }
        else if (at >= 0) chosen.splice(at, 1);
        sync();
      });
      var name = document.createElement("span");
      name.className = "gcp-pl";
      name.textContent = it.label;
      var sub = document.createElement("span");
      sub.className = "gcp-ps";
      sub.textContent = (it.assignee ? "담당 " + it.assignee : "담당 미배정") + " · " + (it.dueDate ? "기한 " + it.dueDate : "기한 없음");
      row.appendChild(cb); row.appendChild(name); row.appendChild(sub);
      wrap.appendChild(row);
    });

    var bar = document.createElement("div");
    bar.className = "gcp-pb";
    var cnt = document.createElement("span");
    cnt.className = "gcp-pc";
    bar.appendChild(cnt);
    var acts = [];
    (pl.actions || []).forEach(function (a) {
      var b = document.createElement("button");
      b.className = "gcp-pact";
      b.textContent = a.label;
      b.addEventListener("click", function () { onAct(a); });
      acts.push(b);
      bar.appendChild(b);
    });
    wrap.appendChild(bar);

    // 담당자·기한처럼 값이 필요한 조치는 이 줄이 열린다(창을 띄우지 않는다).
    var ask = document.createElement("div");
    ask.className = "gcp-pv";
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
      inp.className = "gcp-pvi";
      if (a.needs === "dueDate") { inp.type = "date"; }
      else { inp.type = "text"; inp.placeholder = "담당자 이름"; }
      var ok = document.createElement("button");
      ok.className = "gcp-pact";
      ok.textContent = "적용";
      var go = function () {
        var v = (inp.value || "").trim();
        if (!v) { inp.focus(); return; } // 빈 값이면 "담당 (없음)"이라는 뜻 모를 승인이 뜬다
        send(a, v);
      };
      ok.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go(); } });
      ask.appendChild(inp); ask.appendChild(ok);
      inp.focus();
    }
    sync();
    return wrap;
  }

  /**
   * 「가서 하기」 — AI가 대신 하면 안 되는 일(계정·인증·열쇠)은 순서만 안내하고
   * 그 화면을 찾아 들어가는 수고를 없앤다.
   *
   * navigate(page, label) → Promise|void : 화면을 여는 방법은 자리마다 다르다.
   *   셸이면 탭으로 열고, 분리창이면 본창에 부탁해야 한다 — 그 차이를 부르는 쪽이 넘긴다.
   */
  function open(el, screen, opts) {
    el = 붙일자리(el);
    if (!el || !screen || !screen.page) return;
    var nav = opts && opts.navigate;
    if (typeof nav !== "function") return; // 여는 법을 모르면 **버튼을 만들지 않는다**(눌러도 안 되는 버튼 금지)
    ensureCss();
    var leaf = String(screen.label || "").split(">").pop().trim() || "화면";
    var b = document.createElement("button");
    b.className = "gcp-open";
    b.textContent = "🗔 " + leaf + " 열기";
    b.addEventListener("click", function () {
      b.disabled = true;
      var done = function (ok, why) {
        b.textContent = ok ? "🗔 " + leaf + " 열었습니다" : "⚠ " + (why || "열지 못했습니다");
        if (!ok) b.disabled = false;
      };
      try {
        var r = nav(screen.page, leaf);
        if (r && typeof r.then === "function") r.then(function (ok) { done(ok !== false); }).catch(function (e) { done(false, e && e.message); });
        else done(r !== false);
      } catch (e) {
        done(false, e && e.message);
      }
    });
    el.appendChild(b);
  }

  /** 데이터 카드(승인 시안 대화_데이터카드) — 서버가 결정적으로 계산한 KPI+표를 그린다.
   *  표는 서버가 이미 자른 것(shown)만 — 클라는 자르지 않는다(totalCount가 진짜 총계).
   *  행 클릭은 opts.select(row)로 넘긴다(지휘소=setSelection, 위젯=없으면 생략). */
  function dataCard(el, dc, opts) {
    el = 붙일자리(el);
    // 표는 선택이다(2026-08-19 2차) — 우선순위 카드는 KPI만 싣는다(목록은 본문·체크칸이 이미 두 벌).
    if (!el || !dc || !Array.isArray(dc.kpis) || !dc.kpis.length) return null;
    if (dc.table && !Array.isArray(dc.table.shown)) return null;
    ensureCss();
    var card = document.createElement("div");
    card.className = "dc-card";
    var head = document.createElement("div");
    head.className = "dc-head";
    head.textContent = dc.title || "";
    if (dc.screen && opts && typeof opts.navigate === "function") {
      // 🎯 고르기(승인 시안 stage-picker, 2026-08-20) — 고르러 갈 때는 허브 전체(첫 행까지
      // 458px·클릭 2회)가 아니라 검색+목록+상세만(110px·클릭 1회). 🗔(전체 화면)은 그대로 둔다.
      // ⚠ 키는 **카드가 싣는 screen.page**다(검토관 상3 — 자산 카드는 inventory.html을 싣는다.
      //   assets.html은 리다이렉트 짝이라 함께 둔다). vulnscan은 어떤 카드도 안 실어 뺐다(하4).
      var 고르기kind = { "inventory.html": "asset", "assets.html": "asset", "triage.html": "vuln" }[dc.screen.page];
      // 분리창(대화창 ⧉)에는 안 그린다(검토관 중6) — 고르기는 셸 무대에 뜨는데 선택은 숨은
      // 셸 콘솔로 가서, 분리창 사용자 눈엔 아무 일도 안 일어난 것처럼 보인다.
      if (고르기kind && !window.gijoTabs) 고르기kind = null;
      if (고르기kind) {
        var g = document.createElement("button");
        g.className = "dc-open";
        g.textContent = "🎯 고르기";
        g.title = "검색+목록만 있는 얇은 화면에서 하나를 고릅니다 — 고르면 바로 대화로 돌아옵니다";
        g.addEventListener("click", function () { opts.navigate("pick.html?kind=" + 고르기kind, "고르기"); });
        head.appendChild(g);
      }
      var b = document.createElement("button");
      b.className = "dc-open";
      b.textContent = "🗔 " + (dc.screen.label || "") + " 열기"; // 🗔 — ⧉(창으로 빼기)와 뜻이 다르다
      b.addEventListener("click", function () { opts.navigate(dc.screen.page, dc.screen.label); });
      head.appendChild(b);
    }
    card.appendChild(head);
    if (dc.kpis && dc.kpis.length) {
      var kw = document.createElement("div");
      kw.className = "dc-kpis";
      dc.kpis.slice(0, 5).forEach(function (k) {
        var d = document.createElement("div");
        d.className = "dc-kpi";
        d.innerHTML = '<div class="dc-kl">' + esc(k.label) + '</div><div class="dc-kv ' + esc(k.color || "") + '">' + esc(k.value) + "</div>";
        kw.appendChild(d);
      });
      card.appendChild(kw);
    }
    if (dc.table) {
      var cols = dc.table.cols || [];
      var 선택키 = dc.pickKey || (cols[0] && cols[0].key);
      function buildTable() {
        var tbl = document.createElement("table");
        tbl.innerHTML = "<thead><tr>" + cols.map(function (c) {
          return '<th class="' + (c.align === "num" ? "num" : "") + '">' + esc(c.label) + "</th>";
        }).join("") + "</tr></thead>";
        var tb = document.createElement("tbody");
        dc.table.shown.forEach(function (row) {
          var tr = document.createElement("tr");
          tr.innerHTML = cols.map(function (c) {
            return '<td class="' + (c.align === "num" ? "num" : "") + '">' + esc(row[c.key] == null ? "" : row[c.key]) + "</td>";
          }).join("");
          if (opts && typeof opts.select === "function") {
            tr.addEventListener("click", function () { opts.select(row, 선택키); });
          }
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        return tbl;
      }
      function buildTiles() {
        // 히트맵 보기(승인 시안 카드_보기전환) — 행 하나=타일 하나라 📌 선택 계약이 그대로다.
        // 색은 서버가 안 보낸다 — 판정열(심각/우선/상태) 값을 고정 사전과 대조해 클라가 정한다.
        var wrap = document.createElement("div");
        wrap.className = "dc-tiles";
        var 라벨열 = cols.filter(function (c) { return c.key === 선택키; })[0] || cols[0];
        var 보조열 = cols.filter(function (c) { return c !== 판정열 && c !== 라벨열; })[0];
        dc.table.shown.forEach(function (row) {
          var cls = 타일색(row);
          var t = document.createElement("div");
          t.className = "dc-tile " + cls;
          t.innerHTML =
            (판정열 ? '<div class="dc-tv ' + cls + '">' + esc(row[판정열.key] == null ? "" : row[판정열.key]) + "</div>" : "") +
            '<div class="dc-tl">' + esc(라벨열 && row[라벨열.key] != null ? row[라벨열.key] : "") + "</div>" +
            (보조열 ? '<div class="dc-ts">' + esc(row[보조열.key] == null ? "" : row[보조열.key]) + "</div>" : "");
          if (opts && typeof opts.select === "function") {
            t.addEventListener("click", function () { opts.select(row, 선택키); });
          }
          wrap.appendChild(t);
        });
        return wrap;
      }
      var 색사전 = [
        { re: /치명|매우\s*심각|critical|P0/i, cls: "bad" },
        { re: /높음|high|경고|P1/i, cls: "warn" },
        { re: /정상|양호|통과|compliant/i, cls: "ok" },
      ];
      var 판정열 = cols.filter(function (c) { return /심각|우선|상태/.test(c.label || ""); })[0] || null;
      function 타일색(row) {
        if (!판정열) return "muted";
        var v = String(row[판정열.key] == null ? "" : row[판정열.key]);
        for (var i = 0; i < 색사전.length; i++) if (색사전[i].re.test(v)) return 색사전[i].cls;
        return "muted";
      }
      var 몸통 = document.createElement("div");
      function 몸통그리기(view) {
        몸통.innerHTML = "";
        몸통.appendChild(view === "heat" ? buildTiles() : buildTable());
      }
      // 토글은 2줄 이상일 때만(1줄이면 바꿀 이유가 없다) · 기본은 목록 · 카드마다 독립(저장 안 함)
      if (dc.table.shown.length > 1) {
        var seg = document.createElement("span");
        seg.className = "dc-seg";
        var lb = document.createElement("span");
        lb.textContent = "목록";
        lb.className = "on";
        var hb = document.createElement("span");
        hb.textContent = "히트맵";
        seg.appendChild(lb);
        seg.appendChild(hb);
        lb.addEventListener("click", function () { lb.className = "on"; hb.className = ""; 몸통그리기("list"); });
        hb.addEventListener("click", function () { hb.className = "on"; lb.className = ""; 몸통그리기("heat"); });
        head.classList.add("hasseg"); // 🗔의 margin-left:auto를 세그먼트가 넘겨받는다
        // 첫 단추(🎯 고르기가 있으면 그것) **앞**에 세그를 끼운다 — hasseg가 auto를 넘겨받는
        // 계약 그대로다. 이름을 실제와 맞춘다(검토관 하3 — 「열기버튼」이라던 것이 이제 🎯다).
        var 첫단추 = head.querySelector(".dc-open");
        if (첫단추) head.insertBefore(seg, 첫단추);
        else head.appendChild(seg);
      }
      몸통그리기("list");
      card.appendChild(몸통);
      var 남음 = (dc.table.totalCount || 0) - dc.table.shown.length;
      if (남음 > 0) {
        var m = document.createElement("div");
        m.className = "dc-more";
        m.textContent = "외 " + 남음 + "건 — 🗔 화면에서 전체를 봅니다";
        card.appendChild(m);
      }
    }
    el.appendChild(card);
    return card;
  }

  /** ➡ 다음 작업 칩(QA ④) — 답 끝에 자동으로 붙는 후속 지시 제안. 서버 표(nextguide.ts)의
   *  실측 검증 문장만 온다 — 누르면 그 지시가 그대로 나간다(새 입력칸 아님). */
  function nextChips(el, chips, submit) {
    el = 붙일자리(el);
    if (!el || !Array.isArray(chips) || !chips.length || typeof submit !== "function") return null;
    ensureCss();
    var wrap = document.createElement("div");
    wrap.className = "gcp-next";
    var head = document.createElement("span");
    head.className = "gcp-nh";
    head.textContent = "➡ 다음 작업"; // ➡ 다음 작업
    wrap.appendChild(head);
    chips.slice(0, 3).forEach(function (q) {
      var b = document.createElement("button");
      b.className = "gcp-nc";
      b.textContent = q;
      b.title = "누르면 이 지시가 그대로 나갑니다";
      b.addEventListener("click", function () { submit(q); });
      wrap.appendChild(b);
    });
    el.appendChild(wrap);
    return wrap;
  }

  /* ═══ 근거 없음 답의 숫자 옅게 (2026-09-05 · 승인 시안 mockups/no-evidence-numbers) ═════
   *
   * ■ 무엇이 문제였나: 답 맨 위에 ⚠ 배너("사내 자료에는 없습니다")가 붙어도 담당자의 눈은
   *   **표의 숫자로 먼저 간다.** 배너를 키우는 길은 이미 실패했다 — 시선이 가는 자리가
   *   배너가 아니라 숫자 그 자체라서다. 그래서 경고를 **숫자가 있는 픽셀로** 옮긴다.
   *
   * ■ 무엇을 하나: 서버가 실어 보낸 표식(r.근거없음)이 있을 때만, 답 본문의 숫자를
   *   `<span class="dim-est">`로 감싼다. **감싸기만 한다** — textContent가 그대로라
   *   드래그·Ctrl+C 텍스트가 안 변하고, 색·점선만 바뀌어 세로 총합 증감이 0px다.
   *
   * ■ 안 한 것(정직하게)
   *   · 숫자를 지우지 않는다 — 문장이 깨져 답 자체를 못 읽는다(citeguard가 겪은 실패).
   *   · 답 전체를 회색으로 하지 않는다 — 대비를 잃어 오히려 대충 훑고, .cs-stream(쓰는 중)이
   *     이미 그 톤을 **다른 뜻**으로 쓰고 있다.
   *   · 흐르는 동안(.cs-stream)에는 안 걸린다 — 완성본으로 갈아끼는 순간 걸린다(판정 한 벌).
   *   · 인쇄·복사하면 색은 안 따라간다 — 내보내기 쪽에서 따로 다룰 일이다. 여기서 해결한 척 안 한다.
   */
  var 추정치풀이 = "사내 근거 없음 — 모델 추정치";
  // ① 후보 — 단위가 붙은 수, 또는 (단위가 없으면) 두 자리 이상 맨수.
  //   ⚠ 자리수 쉼표를 한 덩어리로 본다 — 안 하면 3,200이 3과 200으로 갈려 쉼표만 진하게 남는다.
  //   ⚠ **단위 목록은 긴 것을 앞에** 둔다(2026-09-05 검토관). 「개」가 「개월」보다 앞에 있어
  //     "6개월"이 **"6개"까지만** 옅어졌다 — 점선 밑줄이 낱말 한가운데서 끊겼다.
  //     정규식 대안은 앞에서부터 성립하는 것을 쓰므로, 접두가 겹치는 단위는 긴 쪽이 앞이어야 한다.
  //     (「만원·억원」은 「원」보다 뒤에 있어도 앞 글자가 달라 안 가려진다 — 그래도 함께 앞으로 옮겨 둔다.)
  //   ⚠ 공백은 **단위가 있을 때만** 먹는다(2026-09-05 검토관). 예전엔 `\s*`가 밖에 있어
  //     "총 3500 이었다"의 span이 "3500 "이 되어 **점선이 숫자보다 한 칸 넓게** 그어졌다.
  //   ⚠ 「분」은 **「분기」를 안 먹는다**(2026-09-06). "2분기 이수율"이 「2분」까지만 옅어져
  //     낱말 한가운데서 점선이 끊겼다 — 「개」가 「개월」을 자르던 것과 같은 부류인데, 이쪽은
  //     긴 것을 앞에 두는 것으로 못 고친다(「분기」는 시간 단위가 아니라 **분기**라서 아예 셈이 아니다).
  //     뒤에 「기」가 오면 분 단위가 아니므로 단위로 안 본다 — 「2분기」는 단위 없는 한 자리라 통째로 빠진다.
  var 추정치후보_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(%|퍼센트|점|건|개월|개|명|만원|억원|원|달러|배|위|회|시간|분(?!기)|초|일|주|년|GB|MB|TB))?/g;
  // ② 제외 — **지어낸 값이 아닌 것**. 식별자가 옅어지면 진짜 근거가 근거 아닌 것처럼 보인다.
  //   시각(14:22)과 TLS 1.3류 두 자리 판번호는 시안 표에 없던 것을 더했다(상위 지시 「날짜·시각」).
  //   ⚠ 일반 두 자리 소수(\d+\.\d+)는 **제외하지 않는다** — 그러면 「평균 72.5점」까지 살아남아
  //     이 기능이 막으려던 그 숫자를 못 잡는다.
  //   ⚠ 맨 글자 인라인 코드(`…`)도 뺀다 — 화면 위젯은 마크다운을 안 그려서(fmt = esc+굵게+<br>)
  //     백틱이 **글자 그대로** 남는다. 지휘소에서는 gijomd가 이미 <code>로 바꿔 놓아 이 규칙이
  //     할 일이 없다. 두 입구가 같은 답에 다르게 굴면 「자리마다 딴말」이 된다(이 부품의 존재 이유).
  //   ★ 2026-09-05 검토관이 잡은 **약속-코드 어긋남 4종**을 여기서 닫는다(전부 실측으로 확인):
  //     ⓐ 한국식 날짜·시각 — "12월 25일"→["12","25일"] · "오후 2시 30분"→["30분"]으로 옅어졌다.
  //        ISO꼴(2026-09-05)과 "2026년 9월"만 덮여 있었다. 「N월 N일」·「N시 N분」을 더한다.
  //     ⓑ 두 마디 판번호 — "Apache 2.4"·"Log4j 2.17"이 옅어졌다(세 마디 5.83.0만 덮여 있었다).
  //        ⚠ 그냥 `\d+\.\d+`를 빼면 「평균 72.5점」이 살아난다. **영문 이름이 바로 앞에 붙은**
  //          점 있는 수만 판번호로 본다 — 한글 앞말("평균 72.5")은 안 걸린다.
  //        ⚠ 점이 없는 판번호("Windows 11")는 여기서 못 가른다 — 「영문+숫자」를 통째로 빼면
  //          "GPU 3개" 같은 진짜 셈까지 빠진다. 그래서 **안내 문구 쪽을 좁혔다**(screenguide·용어사전).
  //     ⓒ 마크다운 링크·URL — 화면 위젯은 마크다운을 안 그려 "[문서](…/1234)"의 1234가 옅어졌다.
  //        (지휘소는 gijomd가 <a>로 그려 추정치제외선택자가 이미 막는다 — 두 입구를 같게 만든다.)
  //     ⓓ 목록 번호 — 같은 이유로 위젯에선 "10. 열째"의 10이 옅어졌다(<ol> 마커가 안 생긴다).
  var 추정치제외_RE = /`[^`\n]{0,200}`|\[[^\]\n]{0,200}\]\([^)\s\n]{0,500}\)|https?:\/\/[^\s)\]]{1,500}|CVE-\d{4}-\d{3,7}|CWE-\d+|CVSS\s*[\d.]+|\bKEV[-\s]?\d{4}-\d{1,5}\b|\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2}|\d{4}\s*년(?:\s*\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?)?|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*시\s*\d{1,2}\s*분(?:\s*\d{1,2}\s*초)?|\d{1,2}:\d{2}(?::\d{2})?|\b(?:TLS|SSL|HTTP)\s*v?\d+(?:\.\d+)+|[A-Za-z][A-Za-z0-9_+\-]*\s*v?\d+\.\d+(?:\.\d+)*|\bv?\d+\.\d+\.\d+\b|(?:^|\n)[ \t]*\d{1,3}\.(?=[ \t])|\[\d+\]|\bISO\s?\d+\b/gi;

  /**
   * 글 한 덩어리에서 **옅게 할 자리**를 찾는다 — 화면(DOM) 없이 도는 순수 함수.
   * 시험(server/test/dimestimates-scope.test.ts)이 **이 함수 그대로**를 잰다 —
   * 시험이 정규식을 베껴 적으면 제품과 시험이 따로 늙는다.
   *
   * @param 허용 서버가 배너 꼬리에 적은 표면형(납작본). 있으면 **그 글자에 한해** 한 자리 수도 잡는다.
   */
  function 추정치조각(text, 허용) {
    var s = String(text == null ? "" : text), m, i;
    var 제외 = [];
    추정치제외_RE.lastIndex = 0;
    while ((m = 추정치제외_RE.exec(s))) {
      제외.push([m.index, m.index + m[0].length]);
      if (m.index === 추정치제외_RE.lastIndex) 추정치제외_RE.lastIndex++;
    }
    var out = [];
    추정치후보_RE.lastIndex = 0;
    while ((m = 추정치후보_RE.exec(s))) {
      var a = m.index, b = a + m[0].length, 겹침 = false;
      if (m.index === 추정치후보_RE.lastIndex) 추정치후보_RE.lastIndex++;
      for (i = 0; i < 제외.length; i++) if (a < 제외[i][1] && b > 제외[i][0]) { 겹침 = true; break; }
      if (겹침) continue;
      // 단위가 없으면 두 자리 이상만 — 「3가지 방법」의 3까지 옅게 하면 글이 누더기가 된다.
      // ⚠ 단, 서버가 배너 꼬리에 **그 글자를 콕 집어** 「없는 수치」라 적었으면 잡는다(2026-09-06
      //   검토관). 서버 비율맨수_RE는 「조치율은 5」의 한 자리도 싣는데 여기서 버리면, 배너는
      //   「(사내 자료에 없는 수치: 5)」라 적어 놓고 화면은 0개를 옅게 하는 — **배너와 회색이
      //   딴말을 하는** 자리가 된다. citeguard 머리말이 금한 「두 잣대가 갈리면」이 그것이다.
      if (!m[2] && m[1].replace(/[^0-9]/g, "").length < 2
          && !(허용 && 허용.indexOf(납작(m[0])) >= 0)) continue;
      out.push({ start: a, end: b, text: m[0] });
    }
    return out;
  }

  // 옅게 하면 안 되는 자리 — 코드·링크는 담당자가 **일부러 요청한 원문**이고, 나머지는
  // 우리가 그린 장식(배지·칩·카드)이라 답의 값이 아니다.
  var 추정치제외선택자 = "pre, code, a, .dim-est, .dim-skip, .gcw-read, .cs-parse, .cs-chip, .gcp-src, .gcp-src2, .gcp-ev, .gcp-pick, .gcp-next, .gcp-open, .dc-card, .gcw-ap";

  /* ── 범위(2026-09-06 · 승인 시안 mockups/dim-range) ────────────────────────
   * 표식이 「이 답에 근거 없는 숫자가 있다」만 말하던 것을 **어디를**까지 말하게 넓힌다.
   * 서버가 실어 보내는 것은 두 가지뿐이고 둘 다 **답에 이미 실려 나간 맨 글자**다:
   *   · 단계 = 【N. …】 절 번호(복합 지시 답) · 수치 = 배너 꼬리의 표면형(["12.5%"])
   * 글자 오프셋·문단 번호를 안 쓰는 이유는 시안 §5에 있다 — 이 부품은 렌더가 **두 벌**이라
   * (지휘소=gijomd 문단 / 위젯=<br> 한 덩어리) 한 오프셋으로 둘 다 가리킬 수 없다.
   */
  var 단계머리_RE = /^\s*【(\d{1,3})\.[^】\n]{0,60}】/;
  /** 대조용 납작 — 공백·자리수 쉼표를 지운다(서버 표면형 "3,200 퍼센트" ↔ 화면 조각이 붙는다). */
  function 납작(s) { return String(s == null ? "" : s).replace(/\s+/g, "").replace(/,/g, ""); }

  // 두 렌더의 **문단 경계**를 한 규칙으로 담는다. 지휘소는 gijomd가 <p>·<table>·<ul>·<pre>로
  // 그려 자식이 곧 문단이고, 위젯은 fmt(esc + <b> + <br>)라 <br>이 경계다.
  var 블록태그 = { P: 1, DIV: 1, TABLE: 1, UL: 1, OL: 1, PRE: 1, BLOCKQUOTE: 1, HR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
  function 블록나누기(root) {
    var 덩어리 = [], 현재 = null, i, c;
    function 새로() { 현재 = { nodes: [] }; 덩어리.push(현재); }
    새로();
    for (i = 0; i < root.childNodes.length; i++) {
      c = root.childNodes[i];
      if (c.nodeType === 1 && c.tagName === "BR") { 새로(); continue; }
      if (c.nodeType === 1 && 블록태그[c.tagName]) {
        if (현재.nodes.length) 새로();
        현재.nodes.push(c);
        새로(); continue;
      }
      현재.nodes.push(c);
    }
    var out = [];
    for (i = 0; i < 덩어리.length; i++) if (덩어리[i].nodes.length) out.push(덩어리[i]);
    return out;
  }
  /**
   * 덩어리의 **답 글자만** 잇는다 — 우리가 그린 장식(배지·칩·카드)은 뺀다.
   * ⚠ 이 뺌이 없으면 위젯에서 배너를 놓친다: 말풍선은 `readBadge(r) + fmt(답)` 꼴이라
   *   앞에 「이렇게 이해했어요 — 3단계」 배지가 붙는다. 배지가 인라인이면 배너와 한 덩어리가 되어
   *   「⚠로 시작하는가」가 거짓이 되고, **경고문이 스스로 옅어진다.** 옛 코드가 첫 덩어리를
   *   고를 때 같은 선택자로 장식을 건너뛰던 그 규율을 덩어리 단위로 옮긴 것이다.
   */
  function 덩어리글(nodes) {
    var t = "", i, c;
    for (i = 0; i < nodes.length; i++) {
      c = nodes[i];
      if (c.nodeType === 1 && c.matches && c.matches(추정치제외선택자)) continue;
      t += (c.nodeType === 3 ? (c.nodeValue || "") : (c.textContent || ""));
    }
    return t;
  }
  /** 덩어리에 든 글자 노드를 **문서 순서 그대로** 모은다(울타리 상태를 이 순서로 센다). */
  function 글자노드들(nodes) {
    var out = [], i, w, n;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3) { out.push(nodes[i]); continue; }
      w = document.createTreeWalker(nodes[i], NodeFilter.SHOW_TEXT, null);
      while ((n = w.nextNode())) out.push(n);
    }
    return out;
  }

  /**
   * @param el      답 줄(지휘소 .cs-row) 또는 답 말풍선(위젯 .gcw-row)
   * @param 근거없음 서버 표식(r.근거없음) — **없으면 아무것도 안 한다**
   * @param 범위    옅힐 자리(r.근거범위) — `{단계:[2]}`(그 단계 전부)·`{수치:["12.5%"]}`(그 글자)
   *                이고 둘 다면 **OR**다(2026-09-06 수리 · 규약의 주인은 서버 noevidence.근거범위값).
   *                AND였을 때는 「꼬리 있는 단계 + 꼬리 없는 단계」가 섞인 답에서 **전부 지어낸
   *                단계가 하나도 안 옅어졌다.**
   *                **없으면 오늘 동작**(그 답 전체). 범위를 못 읽으면 새 기능이 꺼지는 쪽이지
   *                엉뚱한 숫자가 옅어지는 쪽이 아니다.
   * @returns 옅게 한 개수(시험·관문이 이 숫자를 잰다)
   *
   * ⚠ 부르는 자리: quotes()와 **같은 자리**에 두되 **그 앞**이다. 위젯은 배지·칩을 같은
   *   말풍선에 덧붙이는데, 뒤에 부르면 그 장식의 숫자(「3대목」)까지 옅어진다.
   */
  function dimEstimates(el, 근거없음, 범위) {
    if (!근거없음) return 0;
    var host = 붙일자리(el);
    if (!host || !host.querySelectorAll) return 0;
    ensureCss();
    // 지휘소는 말풍선 본문이 .cm이다. 위젯은 그런 칸이 없어 말풍선 자체가 본문이다.
    var root = host.querySelector(".cm") || host;

    var 범위단계 = (범위 && 범위.단계 && 범위.단계.length) ? 범위.단계 : null;
    var 범위수치 = null, k;
    if (범위 && 범위.수치 && 범위.수치.length) {
      범위수치 = [];
      for (k = 0; k < 범위.수치.length; k++) 범위수치.push(납작(범위.수치[k]));
    }

    var 후보 = [], n, i, j;
    var 덩어리들 = 블록나누기(root);
    // ⚠ 코드블록 울타리(```)를 **글자로** 따라간다 — 화면 위젯은 마크다운을 안 그려서
    //   ```…``` 가 <pre>가 아니라 맨 글자로 남는다(실측 2026-09-05: 그래서 위젯에서만
    //   설정값 max_items = 75·timeout_sec = 30이 옅어졌다 — 지휘소는 <pre>라 안 걸렸다).
    //   울타리 줄에는 숫자가 없어 후보에서 이미 빠지므로, 상태는 **모든 글자 노드**를 보며 센다.
    //   ⚠⚠ 건너뛰는 덩어리(배너·범위 밖)에서도 계속 센다 — 건너뛴다고 열린 울타리가 닫히지 않는다.
    var 코드안 = false, 현재단계 = 0;
    for (i = 0; i < 덩어리들.length; i++) {
      var d = 덩어리들[i];
      var 본글 = 덩어리글(d.nodes);   // 장식을 뺀 **답 글자**로만 판단한다
      var mh = 단계머리_RE.exec(본글);
      if (mh) 현재단계 = Number(mh[1]);
      // 배너 덩어리 제외 — 배너에 숫자가 들어가면 **경고문이 스스로 옅어진다**.
      //   ⚠ 배너 문구를 클라가 다시 적지 않는다(단일 출처는 noevidence.ts다). 「⚠로 시작하는
      //     덩어리」라는 **자리**로만 가른다.
      //   ⚠ 「맨 앞 덩어리만」이 아니라 **어디에 있든** 본다(2026-09-06). 복합 답에서는 배너가
      //     본문 중간 단계에 실리고, 부분 접지 배너에는 꼬리로 숫자("12.5%")가 들어간다 —
      //     첫 덩어리만 보던 옛 규칙으로는 그 꼬리가 스스로 옅어졌다.
      //   ⚠ 단계 머리표를 **뗀 뒤** 본다 — 「【2. 분석】 ⚠배너…」가 한 덩어리로 온다.
      var 몸 = 본글.replace(/^\s*【\d{1,3}\.[^】\n]{0,60}】\s*/, "");
      // 범위는 **OR**다 — 「그 단계 전부」이거나 「그 표면형」이거나. 그래서 단계 범위 밖이어도
      // 수치 범위가 있으면 덩어리를 버리지 않는다(그 글자가 이 덩어리에 있을 수 있다).
      // 화면에 머리표가 하나도 없으면 현재단계가 0으로 남아 단계 범위엔 안 걸린다 — 수치 범위까지
      // 없으면 **아무것도 안 옅어진다**(서버·화면이 어긋났을 때의 안전한 실패 방향).
      var 단계안 = 범위단계 ? (범위단계.indexOf(현재단계) >= 0) : false;
      var 건너뜀 = /^\s*⚠/.test(몸) || (범위단계 && !단계안 && !범위수치);
      var 글자들 = 글자노드들(d.nodes);
      for (j = 0; j < 글자들.length; j++) {
        n = 글자들[j];
        var 글 = n.nodeValue || "";
        var 울타리 = (글.match(/```/g) || []).length;
        var 들어올때 = 코드안;
        if (울타리 % 2 === 1) 코드안 = !코드안;
        if (들어올때 || 울타리) continue;      // 블록 안 · 울타리가 걸친 줄은 건드리지 않는다
        if (건너뜀) continue;
        var p = n.parentElement;
        if (!p || (p.closest && p.closest(추정치제외선택자))) continue;
        if (!/\d/.test(글)) continue;
        후보.push({ n: n, 단계안: 단계안 });   // 덩어리를 벗어나면 단계를 다시 알 길이 없다
      }
    }
    if (!후보.length) return 0;

    var 센다 = 0;
    for (i = 0; i < 후보.length; i++) {
      var node = 후보[i].n, 이단계안 = 후보[i].단계안;
      var text = node.nodeValue || "", 조각 = 추정치조각(text, 범위수치);
      if (!조각.length || !node.parentNode) continue;
      // 단계 머리표의 번호는 답의 값이 아니다 — 「【10. 리포트】」의 10이 옅어지면 안 된다.
      var 머리 = /^\s*【\d{1,3}\.[^】\n]{0,60}】/.exec(text);
      var 머리끝 = 머리 ? 머리[0].length : 0;
      var frag = document.createDocumentFragment(), last = 0, 걸린것 = 0;
      for (j = 0; j < 조각.length; j++) {
        var g = 조각[j];
        if (g.start < 머리끝) continue;
        // 범위가 있으면 **OR**로 건다: 표면형이 꼬리에 있거나(납작 비교 — "12.5 %"와 "12.5%"를
        // 잇는다), 이 덩어리가 꼬리 없는 배너 단계 안이거나.
        if (범위수치 || 범위단계) {
          var 걸림 = (범위수치 && 범위수치.indexOf(납작(g.text)) >= 0) || (범위단계 && 이단계안);
          if (!걸림) continue;
        }
        if (g.start > last) frag.appendChild(document.createTextNode(text.slice(last, g.start)));
        var span = document.createElement("span");
        span.className = "dim-est";
        // hover 한 줄. ★ ::after 류로 글자를 만들지 않는다 — 브라우저에 따라 **복사 텍스트에 섞인다.**
        span.title = 추정치풀이;
        span.setAttribute("aria-label", 추정치풀이);
        span.textContent = g.text;  // 글자는 그대로 — 복사하면 원문이 나온다
        frag.appendChild(span);
        last = g.end; 센다++; 걸린것++;
      }
      if (!걸린것) continue;   // 하나도 안 걸리면 DOM을 건드리지 않는다(헛 교체 방지)
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
    return 센다;
  }

  /* ═══ 「이 답 이상해요」 꼬리 (2026-09-07 · 승인 시안 mockups/wrong-flag) ═══════════
   *
   * ■ 무엇이 문제였나: 지적을 받는 자리가 **지휘소에만** 있었고(화면 위젯·분리창엔 없었다),
   *   보내고 나면 「✓ 지적 접수됨」에서 끝나 **어디로 갔는지 출구가 안 보였다.** 그리고 접수
   *   카드가 화면 위에 300px로 떠서 대화를 덮었다.
   *
   * ■ 무엇을 하나: 답 꼬리 **한 줄**로 받는다. 접힘 상태에서는 지휘소의 기존 규칙(.cs-row .cs-flag —
   *   호버·포커스에서만 드러남)이 그대로 걸려 세로가 안 는다. 펼치면 그 자리에 한 줄이 선다.
   *   올린 뒤에는 「✓ 결재판에 올림 · 결재판 열기 · 취소」로 바뀌어 **출구를 보여 준다.**
   *
   * ■ 그리는 곳은 **여기 한 곳**이다(짝 시험 answerflagui.test ①). 지휘소·위젯이 같은 부품을
   *   부르고, 다른 것은 **보내는 방법**(ops)뿐이다 — 창은 본창에 부탁해야 해서다.
   *
   * ■ 안 하는 것(정직하게)
   *   · 갈래(fixkind)를 화면이 정하지 않는다 — **서버 fixboard가 정한다.** 여기서는 서버가
   *     실제로 저장할 값 하나만 「표시」한다(noev가 있으면 자료 부족, 없으면 미분류).
   *     kind로 후보를 찍어 주지 않는다 — 서버가 저장하지 않는 값을 보여 주면 화면이 거짓말한다.
   *   · 「정답」 칸을 여기 두지 않는다 — 고친 최종문은 **닫을 때** 결재판에서 적는다(expected).
   *   · 「똑똑해집니다」라고 적지 않는다 — 자동 반영이 아니라 사람이 검토한다.
   *
   * @param el   답 줄(.cs-row) 또는 말풍선
   * @param ctx  {question, answer, quotes, sources, noev, screen} — 그 답이 쥐고 있던 값 그대로
   * @param ops  {send(payload), remove(id), openBoard(id)} — 함수 하나만 주면 send로 본다
   * @returns 꼬리 단추(없으면 null)
   */
  var FLAG_KINDS = [
    { k: "wrong", label: "❌ 틀린 답", hint: "사실이 틀림" },
    { k: "missing", label: "🔍 못 찾음", hint: "있는데 못 찾아 답함" },
    { k: "style", label: "💬 말투", hint: "말투·형식이 어색함" },
  ];
  // 서버 answerfeedback.무르기시간_MS와 **같은 값**이다. 여기서 더 길게 두면 눌러도 403이 오고,
  // 더 짧게 두면 무를 수 있는데 못 무른다. 어긋나면 짝 시험(⑥)이 빨개진다.
  var 무르기_MS = 60000;
  // 갈래 한글 이름 — 서버 fixboard.고칠것갈래라벨과 **글자가 같아야** 한다(결재판과 같은 말).
  var 갈래라벨 = { doc: "자료 부족", rule: "사내 규정", prod: "제품", unclassified: "미분류" };

  function flag(el, ctx, ops) {
    var host = 붙일자리(el);
    if (!host || !ctx || !ctx.question) return null;  // 무엇에 대한 지적인지 모르면 문항이 못 된다
    var 부름 = typeof ops === "function" ? { send: ops } : (ops || {});
    if (typeof 부름.send !== "function") return null;
    ensureCss();

    var 만들기 = function (tag, cls, 글) {
      var e = document.createElement(tag);
      e.className = cls;
      if (글 != null) e.textContent = 글;
      if (tag === "button") e.type = "button";
      return e;
    };

    // ⚠ 감싸는 div를 두지 않는다 — 블록 하나가 더 생기면 접힘 상태의 세로가 는다.
    //   접힘일 때 실제로 자리를 차지하는 것은 단추 하나뿐이고, 나머지 둘은 hidden이다.
    var btn = 만들기("button", "cs-flag wf-flag", "▶ 이 답 이상해요");
    var line = 만들기("div", "wf-line");
    var done = 만들기("div", "wf-line wf-done");
    line.hidden = true;
    done.hidden = true;

    var picked = "wrong";
    var 칩들 = [];
    FLAG_KINDS.forEach(function (k) {
      var b = 만들기("button", "wf-k" + (k.k === "wrong" ? " on" : ""), k.label);
      b.title = k.hint;
      b.addEventListener("click", function () {
        picked = k.k;
        칩들.forEach(function (x) { x.el.className = "wf-k" + (x.k === picked ? " on" : ""); });
      });
      칩들.push({ k: k.k, el: b });
      line.appendChild(b);
    });

    // 갈래 — **표시만** 한다. 서버가 접수 순간에 정하고, 사람이 결재판에서 바꾼다.
    var 자동갈래 = ctx.noev ? "doc" : "unclassified";
    var cand = 만들기("span", "wf-cand", "갈래 " + 갈래라벨[자동갈래]);
    cand.title = ctx.noev
      ? "이 답에 「사내 근거 없음」 표시가 있어 자료 부족으로 접수됩니다 — 최종 갈래는 결재판에서 사람이 정합니다."
      : "지금은 미분류로 접수됩니다 — 자료 부족·사내 규정·제품 중 무엇인지는 결재판에서 사람이 정합니다.";
    line.appendChild(cand);

    var memo = document.createElement("input");
    memo.className = "wf-memo";
    memo.type = "text";
    memo.placeholder = "한 줄 메모(선택) — 무엇이 틀렸나요";
    line.appendChild(memo);

    var go = 만들기("button", "wf-go", "올리기");
    var close = 만들기("button", "wf-x", "닫기");   // ⚠ 클래스를 무르기(.wf-undo)와 가른다 — 같으면 「취소」를 눌렀는지 「닫기」를 눌렀는지 코드도 시험도 못 가린다
    line.appendChild(go);
    line.appendChild(close);

    // 오류 한 줄 — 참조를 들고 있다가 갈아 낀다(같은 실패를 두 번 눌러도 줄이 쌓이지 않게).
    var 오류줄 = null;
    var 알림 = function (자리, 글) {
      if (오류줄 && 오류줄.parentNode) 오류줄.parentNode.removeChild(오류줄);
      오류줄 = 만들기("span", "wf-err", 글);
      자리.appendChild(오류줄);
    };

    btn.addEventListener("click", function () { btn.hidden = true; line.hidden = false; if (memo.focus) memo.focus(); });
    close.addEventListener("click", function () { line.hidden = true; btn.hidden = false; });

    go.addEventListener("click", function () {
      go.disabled = true;
      var 옛글 = go.textContent;
      go.textContent = "올리는 중…";
      Promise.resolve(부름.send({
        kind: picked,
        question: String(ctx.question || ""),
        answer: String(ctx.answer || ""),
        note: (memo.value || "").trim() || undefined,
        screen: ctx.screen || undefined,
        // 접수 순간의 사실을 그대로 넘긴다 — 서버가 답 글자와 대조해 갈래를 정한다.
        noev: ctx.noev || undefined,
        // 인용 조각은 **본문 그대로** 얼려 보낸다(조각 id 포인터는 재인입에 끊긴다).
        quotes: (Array.isArray(ctx.quotes) && ctx.quotes.length) ? ctx.quotes : undefined,
      })).then(function (r) {
        line.hidden = true;
        올림그리기(r && r.id);
      }, function (e) {
        // ⚠ 실패했는데 「접수됨」이라 말하지 않는다 — 가짜 성공은 QA가 못 잡는다.
        go.disabled = false;
        go.textContent = 옛글;
        알림(line, "보내지 못했습니다: " + ((e && e.message) || e));
      });
    });

    function 올림그리기(id) {
      done.hidden = false;
      done.appendChild(만들기("span", "wf-ok", "✓ 결재판에 올림"));
      if (typeof 부름.openBoard === "function") {
        var 열기 = 만들기("button", "wf-go", "결재판 열기");
        열기.addEventListener("click", function () { 부름.openBoard(id); });
        done.appendChild(열기);
      }
      if (id && typeof 부름.remove === "function") {
        var 무르기 = 만들기("button", "wf-undo", "취소");
        무르기.title = "잘못 눌렀다면 1분 안에 무를 수 있습니다";
        var 시계 = null;
        무르기.addEventListener("click", function () {
          무르기.disabled = true;
          Promise.resolve(부름.remove(id)).then(function () {
            if (시계) clearTimeout(시계);
            while (done.childNodes && done.childNodes.length) done.removeChild(done.childNodes[0]);
            done.appendChild(만들기("span", "wf-hint", "무른 지적입니다 — 기록에 남지 않았습니다."));
            btn.hidden = false;   // 다시 지적할 수 있다
          }, function (e) {
            무르기.disabled = false;
            알림(done, "무르지 못했습니다: " + ((e && e.message) || e));
          });
        });
        done.appendChild(무르기);
        // ⚠ 60초가 지나면 **조작을 없애되 자리는 남긴다** — 서버가 그 뒤로 403이라 단추만 두면
        //   「됐다고 했는데 안 된다」가 되고, 소리 없이 지우면 왜 없어졌는지 아무도 모른다.
        시계 = setTimeout(function () {
          if (무르기.parentNode) 무르기.parentNode.removeChild(무르기);
          done.appendChild(만들기("span", "wf-hint", "무르기(1분)는 지났습니다 — 결재판에서 「부적합」으로 닫습니다."));
        }, 무르기_MS);
      }
      // 과한 약속을 하지 않는다 — 자동 반영이 아니라 사람이 검토한다.
      done.appendChild(만들기("span", "wf-hint", "고쳐진 기록은 회귀 검사 문항 후보로 쌓입니다."));
    }

    host.appendChild(btn);
    host.appendChild(line);
    host.appendChild(done);
    return btn;
  }

  window.gijoChatParts = { quotes: quotes, picks: picks, open: open, dataCard: dataCard, nextChips: nextChips, dimEstimates: dimEstimates, 추정치조각: 추정치조각, flag: flag };
})();
