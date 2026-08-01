// footbar.js — 창 맨 아래 고정바 (2026-08-02 사용자 지시 "하단바 모든 앱 화면에 다 들어가야 돼").
//
// 왜 공용 조각인가
//   화면마다 푸터를 따로 두던 시절엔 문구가 두 가지로 갈렸고(19곳 대 1곳), 창으로 빼면
//   숨김 규칙이 빠져 제각각 나왔다. 하단 표시는 **한 곳에서 한 모양으로** 만든다.
//
// 어디에 붙나
//   · 셸(app.html)     — 이미 자기 자리(.shellfoot)가 있다. 왼쪽 사용자 줄 옆이라 여기서는 안 만든다.
//   · 그 밖의 모든 창  — 분리창·팀 사무실·문서함·대화창·로그인. 창 맨 아래에 고정으로 붙인다.
//   · 탭 안(embed)     — 만들지 않는다. 셸 것이 이미 보이는데 또 만들면 두 줄이 된다.
(function () {
  if (window.top !== window) return;                       // 탭 안(iframe) — 상위 창 몫
  if (new URLSearchParams(location.search).has("embed")) return;
  if (document.querySelector(".shellfoot, .gijo-footbar")) return;  // 셸엔 이미 있다

  function 붙이기() {
    if (document.querySelector(".shellfoot, .gijo-footbar")) return;
    var st = document.createElement("style");
    st.textContent =
      ".gijo-footbar{position:fixed;left:0;right:0;bottom:0;height:34px;z-index:700;" +
      "display:flex;align-items:center;gap:9px;padding:0 16px;" +
      "border-top:1px solid var(--border,rgba(255,255,255,.10));background:var(--panel-2,#1f1e1d);" +
      "color:var(--muted-2,#a49d95);font-size:12px;-webkit-app-region:drag;}" +
      ".gijo-footbar img{height:14px;opacity:.55;}" +
      ".gijo-footbar span{margin-left:auto;}" +
      // ⚠ 바가 본문 마지막 줄을 가리지 않게 그만큼 아래를 비운다 — 안 그러면 마지막 항목이
      //   영원히 안 읽힌다(고정 요소를 붙일 때 가장 흔한 실수다).
      "body{padding-bottom:34px;}";
    document.head.appendChild(st);

    var bar = document.createElement("div");
    bar.className = "gijo-footbar";
    var img = document.createElement("img");
    img.src = "gijo-symbol.svg";
    img.alt = "GIJO";
    var nm = document.createElement("span");
    nm.textContent = "GIJO Technology";
    bar.appendChild(img);
    bar.appendChild(nm);
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", 붙이기);
  else 붙이기();
})();
