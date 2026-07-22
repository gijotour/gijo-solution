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
      // 호스트(장비/서버) 자산이면 접속 주소를 뽑아 "🖥 터미널 연결"을 최상단 추천으로 노출한다(ssh 프리필).
      var pth = String(a.path || "").trim();
      var host = "";
      if ((a.assetType || "").toLowerCase() === "infra-host" && pth && !/[\\/]/.test(pth)) host = pth.split(":")[0];
      else if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(pth)) host = pth.split(":")[0];
      var sugg = [
        { label: "이 자산 재스캔", hint: "스캔→비교", instruction: (a.name || a.id) + " 재스캔해줘" },
        { label: "가장 급한 취약점 담당자·기한 배정", hint: "결재판", instruction: (a.name || a.id) + "의 가장 급한 취약점 담당자와 기한을 배정해줘" },
        { label: "취약점 조치 절차 안내", hint: "매뉴얼·온톨로지", instruction: (a.name || a.id) + " 취약점 조치 절차 알려줘" },
        { label: "AI 견고성(레드팀) 점검", hint: "14 페이로드", instruction: (a.name || a.id) + " 레드팀 점검해줘" },
      ];
      if (host) sugg.unshift({ label: "🖥 터미널 연결 (" + host + ")", hint: "SSH", terminalHost: host });
      return {
        title: (a.name || a.id) + " · 상태",
        statusText: "◆ " + (a.name || a.id) + " (" + a.id + ")\n취약점 " + sevSummary(a.findings) + " · 최근 스캔 " + scan + "\nAI-BOM " + model + " · 견고성 " + rob + " · 서비스 " + (a.service || "미지정"),
        suggestions: sugg,
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
    // 시스템 BOM 그룹핑 — 기존 인프라(SBOM) vs AI/ML(ML-BOM). AI/ML 자산은 인프라 위에서 구동된다.
    function isInfraAsset(a) {
      var t = (a.assetType || "").toLowerCase();
      return t === "infra-host" || /infra|host|서버|server|(^|[^a-z])os([^a-z]|$)|runtime|런타임|네트워크|network|db|데이터베이스/.test(t);
    }
    // lvl2=하위폴더(인프라·SBOM/AI·ML) 아래 자산 — 더 깊은 들여쓰기·가이드선으로 계층을 뚜렷이.
    function assetLeaf(a, icon, lvl2) {
      return '<div class="se-leaf' + (lvl2 ? " se-l2" : "") + '" data-type="asset" data-id="' + esc(a.id) + '" title="' + esc((a.name || a.id) + " · " + (a.assetType || "")) + '">' + icon + " " + esc(a.name || a.id) + "</div>";
    }
    var infraAssets = caches.assets.filter(isInfraAsset);
    var mlAssets = caches.assets.filter(function (a) { return !isInfraAsset(a); });
    var infraLeaves = infraAssets.length
      ? infraAssets.map(function (a) { return assetLeaf(a, "🖥", true); }).join("")
      : '<div class="se-empty se-l2">등록된 인프라 자산 없음</div>';
    var mlLeaves = mlAssets.length
      ? mlAssets.map(function (a) { return assetLeaf(a, "◆", true); }).join("")
      : '<div class="se-empty se-l2">등록된 AI/ML 자산 없음</div>';
    var prodLeaves = caches.products.length
      ? caches.products.map(function (p) { return '<div class="se-leaf" data-type="product" data-id="' + esc(p.id) + '" title="' + esc(p.name) + '">' + esc(p.name) + "</div>"; }).join("")
      : '<div class="se-empty">등록된 보안제품 없음</div>';
    // 문서·분석: 세션 대상이 아니라 동작(파일 올리기 / 올린 문서 관리) 하위 메뉴.
    var docLeaves =
      '<div class="se-leaf se-act" data-action="upload">📥 파일 올리기 — 자동 분류</div>' +
      '<div class="se-leaf se-act" data-action="manage">📚 올린 문서 관리</div>';

    // ML BOM 한 섹션 안에 인프라(SBOM)/AI·ML(ML-BOM)을 하위 그룹으로 나눈다(2026-07-19 통합).
    // 하위 그룹핑은 기존과 동일 — AI/ML 자산은 인프라 위에서 구동되므로 함께 본다.
    var mlbomInner =
      '<div class="se-subhead">🖥 인프라 · SBOM<span class="se-c">' + infraAssets.length + "</span></div>" + infraLeaves +
      '<div class="se-subhead">🧠 AI/ML · ML-BOM<span class="se-c">' + mlAssets.length + "</span></div>" + mlLeaves;

    container.innerHTML =
      sectionHtml("today", "⦿", "오늘 확인할 항목", caches.tasks.length, todayLeaves, '<button class="se-run" data-run="1">▶ 운영 시작 — 세션에서 판단</button>') +
      sectionHtml("mlbom", "🧠", "ML BOM · 시스템 자산", infraAssets.length + mlAssets.length, mlbomInner) +
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
      ".se-sec{margin-top:4px}" +
      // 최상위 섹션 헤더 — 크게·또렷하게.
      ".se-sechead{display:flex;align-items:center;gap:7px;padding:8px 8px;border-radius:7px;font-weight:800;font-size:13.5px;color:#fff;cursor:pointer}" +
      ".se-sechead:hover{background:var(--panel-2,#0e1526)}.se-car{font-size:11px;color:var(--muted-2,#5f6785);width:10px;flex:0 0 auto}" +
      ".se-c{margin-left:auto;font-size:10.5px;color:var(--muted-2,#5f6785);font-weight:700;background:rgba(255,255,255,.06);padding:1px 7px;border-radius:20px}" +
      // 하위폴더(2단계) — 폴더답게: 들여쓰기 + 왼쪽 가이드선 + 옅은 배경 + 또렷한 글씨.
      ".se-subhead{display:flex;align-items:center;gap:6px;margin:4px 0 2px 14px;padding:5px 8px 5px 10px;font-weight:800;font-size:12px;color:#c3cad9;border-left:2px solid var(--border-strong,rgba(255,255,255,.16));background:rgba(255,255,255,.02);border-radius:0 6px 6px 0}" +
      ".se-run{margin:6px 8px 4px;display:block;width:calc(100% - 16px);background:rgba(30,185,128,.14);color:var(--teal,#1eb980);border:1px solid rgba(30,185,128,.3);border-radius:7px;padding:8px;font-size:12px;font-weight:800;cursor:pointer}" +
      ".se-run:hover{background:rgba(30,185,128,.22)}" +
      // 리프 — 글씨 키우고 대비 상향(muted→밝게), 왼쪽 들여쓰기 가이드선으로 소속을 표시.
      ".se-leaf{display:flex;align-items:center;gap:7px;padding:6px 9px 6px 12px;margin-left:14px;border-left:1px solid var(--border,rgba(255,255,255,.08));color:#aab2c6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-size:12.5px}" +
      ".se-leaf:hover{color:#fff;background:var(--panel-2,#0e1526);border-left-color:var(--blue,#3b82f6)}" +
      // 하위폴더 아래 자산(3단계) — 한 단계 더 들여쓰기.
      ".se-l2{margin-left:26px}" +
      ".se-act{color:var(--blue-light,#5fa1ff);font-weight:600}" +
      ".se-empty{padding:5px 9px 5px 12px;margin-left:14px;border-left:1px solid var(--border,rgba(255,255,255,.08));color:var(--muted-2,#5f6785);font-size:11.5px}" +
      ".se-empty.se-l2{margin-left:26px}" +
      ".se-pri{font-size:8.5px;font-weight:900;padding:1px 5px;border-radius:4px;flex-shrink:0}" +
      ".se-pri.P0{color:#f5928a;background:rgba(226,72,61,.16)}.se-pri.P1{color:var(--amber,#f0a020);background:rgba(240,160,32,.14)}" +
      ".se-pri.P2,.se-pri.P3{color:var(--muted-2,#5f6785);background:rgba(255,255,255,.06)}";
    document.head.appendChild(st);
  }
  injectCss();

  window.gijoSessionExplorer = { load: load, render: render, buildContext: buildContext, caches: caches };
})();
