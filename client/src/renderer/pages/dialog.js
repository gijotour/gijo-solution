// dialog.js — 화면 안에서 묻고 알린다. window.confirm/alert을 대신한다.
//
// 왜 필요한가
// ───────────
// Electron에서 window.confirm/alert은 **OS 네이티브 모달**이다. 뜨는 순간 그 렌더러가
// 통째로 멈춘다 — 탭도, 왼쪽 메뉴도, 아래 대화창도 전부 얼어붙는다(iframe들이 같은 렌더러를
// 쓰기 때문이다). 사람이 그 창을 직접 누르기 전에는 아무것도 못 한다.
//   · 2026-07-29 사용자 신고: "입력 콘솔 입력 막히는 거 또 생김" — 원인이 이것이다.
//   · 자동화는 그 창을 **볼 수는 있어도 닫지 못한다**(Playwright: "No dialog is showing").
//     그래서 로그인 중복 확인 하나 때문에 QA가 통째로 막혔고, 그 모달은 **다음 실행까지
//     살아남아** 계속 렌더러를 잡고 있었다.
//
// 그래서 화면 안 대화상자로 바꾼다. 앱과 어울리고, 멈추지 않고, 검사도 지나간다.
//
// 쓰는 법 (전부 Promise — await 하면 된다)
//   if (!(await gijoAsk("정말 지울까요?"))) return;
//   await gijoTell("저장했습니다.");
//   await gijoAsk("모두 지울까요?", { ok: "전부 삭제", danger: true });
//   var v = await gijoPrompt("반려 사유:", { placeholder: "예: 오탐" }); if (v == null) return; // 취소=null
//   var pw = await gijoPrompt("새 비밀번호", { password: true, value: "" });
// ⚠ window.prompt도 confirm/alert과 같은 네이티브 모달 부류다(2026-07-29 검토에서 4곳 발견) —
//   같은 이유로 gijoPrompt를 쓴다. 취소·ESC·바깥 클릭은 null을 돌려준다(빈 문자열과 구분).
(function () {
  "use strict";
  if (window.gijoAsk) return; // 이미 실렸다

  var CSS =
    "#gijoDlgBack{position:fixed;inset:0;z-index:99999;background:rgba(4,7,14,.62);" +
    "display:flex;align-items:center;justify-content:center;padding:24px;}" +
    "#gijoDlg{max-width:440px;width:100%;background:var(--panel,#121a2e);color:var(--text,#e7eaf3);" +
    "border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:14px;padding:20px 22px;" +
    "box-shadow:0 24px 64px rgba(0,0,0,.6);font-family:'Pretendard','Malgun Gothic','Segoe UI',sans-serif;}" +
    "#gijoDlg .m{font-size:13.5px;line-height:1.8;white-space:pre-wrap;word-break:break-word;}" +
    "#gijoDlg .a{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;}" +
    "#gijoDlg button{font-size:12.5px;font-weight:700;border-radius:9px;padding:8px 15px;cursor:pointer;" +
    "font-family:inherit;border:1px solid transparent;}" +
    "#gijoDlg .no{background:transparent;color:var(--muted,#8b93ab);border-color:rgba(255,255,255,.16);}" +
    "#gijoDlg .no:hover{color:#fff;}" +
    "#gijoDlg .ok{background:var(--blue,#3b82f6);color:#fff;}" +
    "#gijoDlg .ok:hover{filter:brightness(1.1);}" +
    "#gijoDlg .ok.danger{background:var(--red,#e2483d);}" +
    "#gijoDlg .in{width:100%;margin-top:12px;background:var(--panel-2,#0e1526);color:var(--text,#e7eaf3);" +
    "border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:9px;padding:9px 11px;" +
    "font-size:13px;font-family:inherit;outline:none;}" +
    "#gijoDlg .in:focus{border-color:var(--blue,#3b82f6);}";

  function ensureCss() {
    if (document.getElementById("gijoDlgCss")) return;
    var st = document.createElement("style");
    st.id = "gijoDlgCss";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // 한 번에 하나만 — 겹쳐 뜨면 무엇에 답하는지 알 수 없다. 앞의 것을 취소로 닫고 새로 띄운다.
  var 현재 = null;
  // 결과 없이 부르면 그 대화상자의 "취소값"으로 닫는다 — 예/아니오는 false, 입력형은 null.
  // (입력형을 false로 닫으면 호출부의 `v == null` 검사가 못 걸러 false가 값처럼 흘러간다.)
  function 닫기(결과) {
    if (!현재) return;
    var d = 현재;
    현재 = null;
    document.removeEventListener("keydown", d.key, true);
    if (d.back.parentNode) d.back.parentNode.removeChild(d.back);
    if (d.앞요소 && d.앞요소.focus) { try { d.앞요소.focus(); } catch (e) {} }
    d.resolve(arguments.length ? 결과 : d.취소값);
  }

  function 띄우기(메시지, opts, 물음, 입력) {
    닫기(); // 앞의 것이 남아 있으면 각자의 취소값으로 정리
    ensureCss();
    var o = opts || {};
    return new Promise(function (resolve) {
      var 앞요소 = document.activeElement;
      var back = document.createElement("div");
      back.id = "gijoDlgBack";
      var box = document.createElement("div");
      box.id = "gijoDlg";
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");

      var m = document.createElement("div");
      m.className = "m";
      m.textContent = String(메시지 == null ? "" : 메시지); // 텍스트로만 — HTML 주입 여지를 두지 않는다
      box.appendChild(m);

      var input = null;
      if (입력) {
        input = document.createElement("input");
        input.className = "in";
        input.type = o.password ? "password" : "text";
        input.value = o.value == null ? "" : String(o.value);
        if (o.placeholder) input.placeholder = o.placeholder;
        box.appendChild(input);
      }

      var a = document.createElement("div");
      a.className = "a";
      var 취소값 = 입력 ? null : false;
      var 확인값 = function () { return 입력 ? input.value : true; };
      var no = null;
      if (물음) {
        no = document.createElement("button");
        no.className = "no";
        no.textContent = o.cancel || "취소";
        no.addEventListener("click", function () { 닫기(취소값); });
        a.appendChild(no);
      }
      var ok = document.createElement("button");
      ok.className = "ok" + (o.danger ? " danger" : "");
      ok.textContent = o.ok || (물음 ? "확인" : "닫기");
      ok.addEventListener("click", function () { 닫기(확인값()); });
      a.appendChild(ok);
      box.appendChild(a);
      back.appendChild(box);

      // 바깥을 눌러도 닫힌다 — 다만 "확인"이 아니라 취소로 본다(위험한 일을 실수로 승인하지 않게).
      back.addEventListener("mousedown", function (e) { if (e.target === back) 닫기(취소값); });

      var key = function (e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); 닫기(취소값); }
        else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); 닫기(확인값()); }
      };
      document.addEventListener("keydown", key, true);

      현재 = { back: back, key: key, resolve: resolve, 앞요소: 앞요소, 취소값: 취소값 };
      (document.body || document.documentElement).appendChild(back);
      // 위험한 작업은 커서를 '취소'에 둔다 — Enter를 습관적으로 눌러 지우는 사고를 막는다.
      // 입력형은 당연히 입력칸부터.
      (입력 ? input : ((o.danger && no) ? no : ok)).focus();
      if (입력 && input.value) input.select();
    });
  }

  /** 예/아니오를 묻는다 → Promise<boolean> */
  window.gijoAsk = function (메시지, opts) { return 띄우기(메시지, opts, true); };
  /** 알리기만 한다 → Promise<true> */
  window.gijoTell = function (메시지, opts) { return 띄우기(메시지, opts, false); };
  /** 글자를 입력받는다 → Promise<string|null> — 취소·ESC·바깥 클릭은 null (빈 문자열과 구분) */
  window.gijoPrompt = function (메시지, opts) { return 띄우기(메시지, opts, true, true); };
})();
