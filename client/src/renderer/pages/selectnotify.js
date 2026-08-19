/**
 * selectnotify.js — 화면 → 대화창 「고른 항목」 알리기의 **공용 부품** (2026-08-19).
 *
 * 왜 만들었나(사장님 질문 「코드가 독립적으로 있어서 나오는 문제인지?」 — 반은 그렇다):
 *   화면 26개가 독립 HTML이라, 고른 것을 대화창에 알리는 postMessage를 **화면마다 손으로**
 *   조립해 왔다. 새 화면(자산 고르기)에서 그대로 빠졌고, 규격(허용 키·⌗기계 키·top 한 겹)도
 *   화면마다 조금씩 달랐다. 이 부품이 규격의 단일 출처다 — 화면은 데이터만 넘긴다.
 *
 * 쓰는 법(화면 쪽):
 *   <script src="selectnotify.js"></script>
 *   window.gijoSelectNotify({ label, text, fields })   // 고름
 *   window.gijoSelectNotify()                          // 해제(접기·화면 이동)
 *
 * 규격(받는 쪽과의 계약 — app.html 허용키·console.js 선택카드·서버 ⌗ 파싱):
 *   · fields 허용 키: asset·title·severity·status·owner·due·plain·kev·assetId·findingKey
 *   · assetId(+findingKey)가 있으면 콘솔이 지시 꼬리에 ⌗키를 실어 배정·범위가 정확해진다
 *   · window.top으로 보낸다 — parent면 허브가 한 겹 더 있을 때 죽는다(2026-08-18 실측)
 */
(function () {
  if (window.gijoSelectNotify) return; // 두 번 읽혀도 한 벌만

  var 허용키 = ["asset", "title", "severity", "status", "owner", "due", "plain", "kev", "assetId", "findingKey"];

  window.gijoSelectNotify = function (sel) {
    var msg;
    if (!sel || !sel.label || !sel.text) {
      msg = { type: "gijo:select" }; // 해제
    } else {
      var f = null;
      if (sel.fields && typeof sel.fields === "object") {
        f = {};
        허용키.forEach(function (k) {
          if (sel.fields[k] == null) return;
          var v = String(sel.fields[k]).replace(/\s+/g, " ").trim();
          if (v) f[k] = v.slice(0, 200);
        });
        if (!Object.keys(f).length) f = null;
      }
      msg = { type: "gijo:select", label: String(sel.label).slice(0, 60), text: String(sel.text), fields: f || undefined };
    }
    try { window.top.postMessage(msg, "*"); return true; } catch (e) { return false; }
  };
})();
