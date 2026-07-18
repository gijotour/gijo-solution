// session-explorer.js — 대시보드·작업 세션이 공유하는 통합 자산 탐색기(세션형).
//
// 5구획: ⦿오늘 확인할 항목(+운영 시작) · 🎯오늘의 조치 우선순위 · ◆AI 자산·AI-BOM ·
//         🧰보안제품 관리 · 📁문서·분석(📥파일 올리기 / 📚올린 문서 관리).
// 항목(리프)을 누르면 opts.onSelect(type, id)를 부른다 — 호출 페이지가 세션을 열거나 딥링크한다.
// buildContext(type,id)는 그 대상의 상태 카드 텍스트·추천 다음 단계를 결정적으로(LLM 없이) 만든다.
//
// 대시보드·sessions.html이 같은 모듈을 써서 탐색기가 항상 동일하게 유지된다(진짜 통합).

(function () {
  var caches = { assets: [], pri: [], products: [], tasks: [] };
  // 구획 접기 상태 — 처음엔 모두 접힘(헤더를 눌러야 하위 항목이 펼쳐진다).
  var collapsed = { today: true, vuln: true, asset: true, product: true, files: true };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function priKey(p) { return p.assetId + "|" + p.findingKey; }
  function sevToPri(sev) { return sev === "critical" ? "P0" : sev === "high" ? "P1" : sev === "medium" ? "P2" : "P3"; }
  function sevSummary(findings) {
    var c = { critical: 0, high: 0, medium: 0, low: 0 };
    (findings || []).forEach(function (f) { if (c[f.severity] != null) c[f.severity]++; });
    var parts = [];
    ["critical", "high", "medium", "low"].forEach(function (k) { if (c[k]) parts.push(k + " " + c[k]); });
    return parts.length ? parts.join(" · ") : "없음";
  }

  async function load() {
    var r = await Promise.all([
      window.gijo.listAssets().catch(function () { return []; }),
      window.gijo.listActionPriorities(6).then(function (x) { return (x && x.items) || []; }).catch(function () { return []; }),
      window.gijo.listSecurityProducts().catch(function () { return []; }),
      window.gijo.listTasks().catch(function () { return []; }),
    ]);
    caches.assets = r[0] || [];
    caches.pri = r[1] || [];
    caches.products = r[2] || [];
    caches.tasks = (r[3] || []).filter(function (t) { return !t.done; });
  }

  // ── 대상 → 상태 카드 텍스트 + 추천 다음 단계 ──────────────────────────
  function buildContext(type, id) {
    if (type === "asset") {
      var a = caches.assets.find(function (x) { return x.id === id; });
      if (!a) return { title: id, statusText: id + " — 자산 정보를 찾을 수 없습니다.", suggestions: [] };
      var bom = a.aibom || {};
      var model = (bom.model && (bom.model.name || bom.model.modelRef)) || (a.components && a.components[0] && a.components[0].name) || "-";
      var rob = bom.robustness && bom.robustness.score != null ? bom.robustness.score + "점" : "미점검";
      var scan = a.lastScannedAt ? new Date(a.lastScannedAt).toLocaleDateString("ko-KR") : "없음";
      return {
        title: (a.name || a.id) + " · 상태",
        statusText: "◆ " + (a.name || a.id) + " (" + a.id + ")\n취약점 " + sevSummary(a.findings) + " · 최근 스캔 " + scan + "\nAI-BOM " + model + " · 견고성 " + rob + " · 서비스 " + (a.service || "미지정"),
        suggestions: [
          { label: "이 자산 재스캔", hint: "스캔→비교", instruction: (a.name || a.id) + " 재스캔해줘" },
          { label: "가장 급한 취약점 담당자·기한 배정", hint: "결재판", instruction: (a.name || a.id) + "의 가장 급한 취약점 담당자와 기한을 배정해줘" },
          { label: "취약점 조치 절차 안내", hint: "매뉴얼·온톨로지", instruction: (a.name || a.id) + " 취약점 조치 절차 알려줘" },
          { label: "AI 견고성(레드팀) 점검", hint: "14 페이로드", instruction: (a.name || a.id) + " 레드팀 점검해줘" },
        ],
      };
    }
    if (type === "vuln") {
      var p = caches.pri.find(function (x) { return priKey(x) === id; }) || {};
      var f = p.finding || {};
      var pr = p.priority || sevToPri(f.severity);
      var name = f.finding_type || "취약점";
      return {
        title: (pr + " " + name + " · " + (p.assetId || "")).trim(),
        statusText: "[" + pr + "] " + name + " (" + (f.severity || "-") + ") — " + (p.assetId || "-") + "\n담당자 " + (p.assignee || "미배정") + " · 기한 " + (p.dueDate || "없음") + " · 상태 " + (p.status || "미검토"),
        suggestions: [
          { label: "담당자·기한 배정", hint: "결재판", instruction: p.assetId + " " + name + " 담당자와 기한 배정해줘" },
          { label: "조치 절차 안내", hint: "매뉴얼·온톨로지", instruction: p.assetId + " " + name + " 조치 절차 알려줘" },
          { label: "재스캔해서 해결됐는지 확인", hint: "스캔→비교", instruction: p.assetId + " 재스캔해서 " + name + " 해결됐는지 확인해줘" },
          { label: "오탐(무시)으로 처리", hint: "상태 변경", instruction: p.assetId + " " + name + " 오탐으로 무시 처리해줘" },
        ],
      };
    }
    if (type === "product") {
      var pd = caches.products.find(function (x) { return x.id === id; });
      if (!pd) return { title: id, statusText: id + " — 제품 정보를 찾을 수 없습니다.", suggestions: [] };
      return {
        title: pd.name + " · 보안제품",
        statusText: "🧰 " + pd.name + " (" + pd.category + ")\n제조사 " + (pd.vendor || "-") + " · 모델 " + (pd.model || "-") + " · 연결자산 " + (pd.assetName || pd.assetId || "없음") + "\n문서 " + ((pd.docs && pd.docs.length) || 0) + "건",
        suggestions: [
          { label: "점검 일정 확인", hint: "유지보수", instruction: pd.name + " 점검 일정 알려줘" },
          { label: "매뉴얼 검색", hint: "RAG", instruction: pd.name + " 매뉴얼에서 로그 설정 방법 찾아줘" },
          { label: "최근 운영 이슈 요약", hint: "리포트", instruction: pd.name + " 최근 운영 이슈 요약해줘" },
        ],
      };
    }
    if (type === "today" && id !== "all") {
      var t = caches.tasks.find(function (x) { return String(x.id) === String(id); });
      var text = t ? t.text : "오늘 항목";
      return {
        title: text.slice(0, 30),
        statusText: "⦿ 오늘 확인할 항목 — " + text,
        suggestions: [
          { label: "이 항목 처리 방법 물어보기", hint: "판단", instruction: '"' + text + '" 어떻게 처리하면 될지 알려줘' },
          { label: "관련 취약점 정리", hint: "search", instruction: '"' + text + '" 관련 취약점 정리해줘' },
        ],
      };
    }
    var cnt = caches.tasks.length;
    return {
      title: "운영 시작 · 오늘 판단",
      statusText: "⦿ 오늘 확인할 항목 " + cnt + "건\n" + caches.tasks.slice(0, 5).map(function (x) { return "· " + x.text; }).join("\n"),
      suggestions: [
        { label: "오늘 제일 급한 취약점 상위 3건", hint: "today", instruction: "오늘 제일 급한 취약점 상위 3건 정리해줘" },
        { label: "SLA 기한 임박·초과 알림", hint: "SLA", instruction: "SLA 기한이 임박하거나 초과한 조치 알려줘" },
        { label: "오늘 일일 브리핑 만들기", hint: "브리핑", instruction: "오늘 일일 브리핑 만들어줘" },
      ],
    };
  }

  // ── 렌더 ──────────────────────────────────────────────────────────────
  function sectionHtml(key, ic, label, count, leavesHtml, extra) {
    var open = !collapsed[key];
    return '<div class="se-sec">' +
      '<div class="se-sechead" data-sec="' + key + '"><span class="se-car">' + (open ? "▾" : "▸") + '</span>' + ic + " " + label + '<span class="se-c">' + count + "</span></div>" +
      (open ? ((extra || "") + leavesHtml) : "") +
      "</div>";
  }

  function render(container, opts) {
    opts = opts || {};
    var todayLeaves = caches.tasks.length
      ? caches.tasks.slice(0, 6).map(function (t) { return '<div class="se-leaf" data-type="today" data-id="' + t.id + '" title="' + esc(t.text) + '">' + esc(t.text) + "</div>"; }).join("")
      : '<div class="se-empty">오늘 확인할 항목 없음</div>';
    var priLeaves = caches.pri.length
      ? caches.pri.map(function (p) {
          var pr = p.priority || sevToPri(p.finding && p.finding.severity);
          var name = (p.finding && p.finding.finding_type) || "취약점";
          return '<div class="se-leaf" data-type="vuln" data-id="' + esc(priKey(p)) + '" title="' + esc(name) + " · " + esc(p.assetId) + '"><span class="se-pri ' + pr + '">' + pr + "</span>" + esc(name) + " · " + esc(p.assetId) + "</div>";
        }).join("")
      : '<div class="se-empty">우선 조치 항목 없음</div>';
    var assetLeaves = caches.assets.length
      ? caches.assets.map(function (a) { return '<div class="se-leaf" data-type="asset" data-id="' + esc(a.id) + '" title="' + esc(a.name || a.id) + '">◆ ' + esc(a.name || a.id) + "</div>"; }).join("")
      : '<div class="se-empty">등록된 AI 자산 없음</div>';
    var prodLeaves = caches.products.length
      ? caches.products.map(function (p) { return '<div class="se-leaf" data-type="product" data-id="' + esc(p.id) + '" title="' + esc(p.name) + '">' + esc(p.name) + "</div>"; }).join("")
      : '<div class="se-empty">등록된 보안제품 없음</div>';
    // 문서·분석: 세션 대상이 아니라 동작(파일 올리기 / 올린 문서 관리) 하위 메뉴.
    var docLeaves =
      '<div class="se-leaf se-act" data-action="upload">📥 파일 올리기 — 자동 분류</div>' +
      '<div class="se-leaf se-act" data-action="manage">📚 올린 문서 관리</div>';

    container.innerHTML =
      sectionHtml("today", "⦿", "오늘 확인할 항목", caches.tasks.length, todayLeaves, '<button class="se-run" data-run="1">▶ 운영 시작 — 세션에서 판단</button>') +
      sectionHtml("vuln", "🎯", "오늘의 조치 · 우선순위", caches.pri.length, priLeaves) +
      sectionHtml("asset", "◆", "AI 자산 · AI-BOM", caches.assets.length, assetLeaves) +
      sectionHtml("product", "🧰", "보안제품 관리", caches.products.length, prodLeaves) +
      sectionHtml("files", "📁", "문서 · 분석", "", docLeaves);

    container.querySelectorAll(".se-sechead").forEach(function (el) {
      el.addEventListener("click", function () { var k = el.dataset.sec; collapsed[k] = !collapsed[k]; render(container, opts); });
    });
    container.querySelectorAll(".se-leaf[data-type]").forEach(function (el) {
      el.addEventListener("click", function () { if (opts.onSelect) opts.onSelect(el.dataset.type, el.dataset.id); });
    });
    var runBtn = container.querySelector(".se-run");
    if (runBtn) runBtn.addEventListener("click", function (e) { e.stopPropagation(); if (opts.onSelect) opts.onSelect("today", "all"); });
    container.querySelectorAll(".se-act[data-action]").forEach(function (el) {
      el.addEventListener("click", function () {
        if (el.dataset.action === "upload" && opts.onUpload) opts.onUpload();
        else if (el.dataset.action === "manage" && opts.onManageDocs) opts.onManageDocs();
      });
    });
  }

  // 공유 스타일 1회 주입(두 페이지가 동일하게 보이도록). 페이지 토큰(var(--*))을 그대로 사용.
  function injectCss() {
    if (document.getElementById("gijoSeCss")) return;
    var st = document.createElement("style");
    st.id = "gijoSeCss";
    st.textContent =
      ".se-sec{margin-top:3px}" +
      ".se-sechead{display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:7px;font-weight:800;font-size:12px;color:var(--text);cursor:pointer}" +
      ".se-sechead:hover{background:var(--panel-2,#0e1526)}.se-car{font-size:10px;color:var(--muted-2,#5f6785);width:9px}" +
      ".se-c{margin-left:auto;font-size:10px;color:var(--muted-2,#5f6785);font-weight:700}" +
      ".se-run{margin:5px 8px 3px;display:block;width:calc(100% - 16px);background:rgba(30,185,128,.14);color:var(--teal,#1eb980);border:1px solid rgba(30,185,128,.3);border-radius:7px;padding:7px;font-size:11.5px;font-weight:800;cursor:pointer}" +
      ".se-run:hover{background:rgba(30,185,128,.22)}" +
      ".se-leaf{display:flex;align-items:center;gap:6px;padding:6px 9px 6px 24px;color:var(--muted,#8b93ab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border-radius:6px;font-size:12px}" +
      ".se-leaf:hover{color:#fff;background:var(--panel-2,#0e1526)}" +
      ".se-act{color:var(--blue-light,#5fa1ff);font-weight:600}" +
      ".se-empty{padding:4px 9px 4px 24px;color:var(--muted-2,#5f6785);font-size:11px}" +
      ".se-pri{font-size:8.5px;font-weight:900;padding:1px 5px;border-radius:4px;flex-shrink:0}" +
      ".se-pri.P0{color:#f5928a;background:rgba(226,72,61,.16)}.se-pri.P1{color:var(--amber,#f0a020);background:rgba(240,160,32,.14)}" +
      ".se-pri.P2,.se-pri.P3{color:var(--muted-2,#5f6785);background:rgba(255,255,255,.06)}";
    document.head.appendChild(st);
  }
  injectCss();

  window.gijoSessionExplorer = { load: load, render: render, buildContext: buildContext, caches: caches };
})();
