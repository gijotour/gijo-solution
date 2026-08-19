// scopefilter.js — 🗂 지금 범위로 **화면 목록을 좁히는** 공용 부품 (승인 시안 mockups/자산_0단계)
//
// ■ 왜 부품인가
//   범위를 받아 목록을 거르는 일이 화면 여섯 곳에 필요하다. 화면마다 따로 적으면
//   「같은 것을 여러 곳에 적으면 어긋난다」가 그대로 재발한다 — 이 저장소가 반복해 겪은 것이다.
//   받는 통로·띠 모양·전체 복귀는 여기 한 곳에, **무엇을 거를지만** 화면이 정한다.
//
// ■ 범위가 화면까지 오는 길 (2단 중계)
//   ⓪ 자산 화면 → 셸(app.html) → localStorage + 대화창 알약
//                              → 열린 모든 탭 iframe에 `gijo:scope:set`
//                              → **허브 화면**이 그것을 받아 자기 무대 iframe에 다시 전한다
//   ⚠ 마지막 한 칸이 핵심이다. 판(무대)은 **허브 화면 안의 또 다른 iframe**이라
//     셸이 직접 못 닿는다(셸은 자기 탭만 안다). 허브가 중계하지 않으면 판은 영영 범위를 모른다.
//
// ■ 못 거르는 화면은 **못 거른다고 말한다**
//   점검 대상 표엔 자산 칸이 없고(hardeningtargets.ts), KPI는 전사 합계 하나뿐이며(kpi.ts),
//   컴플라이언스는 조직 단위 이행 상태다. 그런 화면에서 범위를 조용히 무시하면
//   담당자는 「걸렸겠지」 하고 그 숫자를 믿는다 — 그게 제일 나쁘다. `없음()`으로 밝힌다.
(function () {
  "use strict";
  if (window.gijoScope) return; // 두 번 실려도 한 벌만

  var KEY = "gijo:scope:asset";
  var 듣는이 = [];
  var 범위 = null;

  function 읽기() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var v = raw ? JSON.parse(raw) : null;
      return v && v.id && v.label ? v : null;
    } catch (e) { return null; }
  }
  범위 = 읽기();

  // 셸(또는 허브)이 보내는 범위 변경을 받는다.
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.type !== "gijo:scope:set") return;
    // 발신자 검증(2026-08-20) — 부모(셸 또는 허브)와 자기 자신(⧉ 팝업의 nav.js 재주입)만.
    if (ev.source !== window && ev.source !== window.parent) return;
    var sc = d.scope && d.scope.id && d.scope.label ? d.scope : null;
    var 바뀜 = (범위 && 범위.id) !== (sc && sc.id);
    범위 = sc;
    // ⚠ **iframe끼리는 localStorage를 공유한다**(같은 출처) — 여기서 또 쓰면 셸이 쓴 값과
    //   경합한다. 읽기만 한다. 쓰는 곳은 대화창(console.js) 한 곳이다.
    if (!바뀜) return;
    for (var i = 0; i < 듣는이.length; i++) {
      try { 듣는이[i](범위); } catch (e) { /* 한 화면이 죽어도 나머지는 돈다 */ }
    }
  });

  function 띠만들기(자리) {
    var el = document.getElementById("gijoScopeBar");
    if (el) return el;
    el = document.createElement("div");
    el.id = "gijoScopeBar";
    el.style.cssText =
      "display:none;align-items:center;gap:9px;background:rgba(59,130,246,.10);" +
      "border:1px solid rgba(59,130,246,.45);border-radius:9px;padding:7px 11px;margin:0 0 10px;" +
      "font-size:12.25px;color:var(--text,#e9e7e2);line-height:1.5;";
    var 붙일곳 = 자리 || document.querySelector(".main") || document.body;
    붙일곳.insertBefore(el, 붙일곳.firstChild);
    return el;
  }

  window.gijoScope = {
    /** 지금 걸린 범위 — { kind, id, label } 또는 null. */
    get: function () { return 범위; },
    /** 걸린 자산 id(없으면 빈 문자열) — 필터 한 줄에 그대로 쓰라고 둔 편의. */
    assetId: function () { return 범위 && 범위.kind === "asset" ? 범위.id : ""; },

    /**
     * 범위가 바뀌면 다시 그리도록 등록한다. **등록 즉시 한 번 부른다** —
     * 화면이 뜰 때 이미 걸려 있던 범위를 놓치지 않게(그러면 첫 화면만 전체가 보인다).
     */
    onChange: function (fn) {
      듣는이.push(fn);
      try { fn(범위); } catch (e) { }
    },

    /**
     * 「🗂 …만 보는 중」 띠를 그린다. 범위가 없으면 감춘다.
     *
     * ⚠ **좁혔으면 반드시 보여야 한다.** 안 보이면 담당자는 목록이 빈 줄 알거나
     *   그 수를 전체로 읽는다 — 좁힌 사실을 감추는 것이 좁히지 않는 것보다 나쁘다.
     * @param 보임  지금 보이는 건수
     * @param 전체  범위를 안 걸었을 때의 건수
     */
    chip: function (보임, 전체, 자리) {
      var el = 띠만들기(자리);
      if (!범위) { el.style.display = "none"; el.innerHTML = ""; return; }
      var 감춘 = Math.max(0, (전체 || 0) - (보임 || 0));
      el.style.display = "flex";
      el.innerHTML =
        '<span>🗂 <b style="color:#bcd7ff">' + esc(범위.label) + "</b>만 보는 중</span>" +
        '<span style="color:var(--muted-2,#a49d95)">' + 보임 + "건 표시" +
        (감춘 ? " · 다른 자산 " + 감춘 + "건 숨김" : "") + "</span>" +
        '<button type="button" id="gijoScopeAll" style="margin-left:auto;background:var(--panel-2,#1f1e1d);' +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:3px 9px;color:var(--text,#e9e7e2);" +
        'font-size:11.5px;cursor:pointer;font-family:inherit">전체 보기 ✕</button>';
      var b = el.querySelector("#gijoScopeAll");
      if (b) b.addEventListener("click", function () {
        // 푸는 것은 **대화창이 주인**이다 — 여기서 localStorage를 직접 지우면 알약이 남는다.
        try { window.top.postMessage({ type: "gijo:scope", scope: null }, "*"); } catch (e) { }
      });
    },

    /**
     * 이 화면은 **자산으로 나눌 수 없다**고 밝힌다.
     * 조용히 무시하면 담당자는 걸린 줄 알고 그 숫자를 믿는다.
     * @param 이유 왜 못 나누는지 한 줄(예: "점검 대상에 자산 칸이 없습니다")
     */
    없음: function (이유, 자리) {
      var el = 띠만들기(자리);
      if (!범위) { el.style.display = "none"; el.innerHTML = ""; return; }
      el.style.display = "flex";
      el.style.background = "rgba(240,160,32,.08)";
      el.style.borderColor = "rgba(240,160,32,.4)";
      el.innerHTML =
        '<span>🗂 <b style="color:#f0c060">' + esc(범위.label) + "</b> 범위가 걸려 있지만 " +
        '<b>이 화면은 전체를 보여 줍니다</b></span>' +
        '<span style="color:var(--muted-2,#a49d95)">' + esc(이유 || "자산별로 나눌 수 없는 자료입니다") + "</span>";
    },
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
})();
