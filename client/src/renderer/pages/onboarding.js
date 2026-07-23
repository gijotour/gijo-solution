// onboarding.js — 인앱 온보딩 화면(시작 가이드). 신규 보안담당자가 로그인 후 처음 대시보드에
// 도착하면 인터랙티브 체크리스트 오버레이가 뜬다. 항목 체크는 localStorage에 저장되고, 각 항목에서
// 해당 메뉴로 바로 이동할 수 있다. 문서 GIJO_AS_보안담당자_온보딩_체크리스트.md의 인앱 버전.
// dashboard.html에 <script src="onboarding.js"> 로 포함. 재열기용 플로팅 런처도 제공.

(function () {
  // 온보딩 재개(2026-07-23 ① C안: 빈상태 + 코치마크 하이브리드). 첫 실행 시 전체 체크리스트를
  // 강제로 띄우지 않고(마찰↓), 핵심 지점에 코치마크 1개만 보여준다. 체크리스트는 런처로 접근.
  var DISABLED = false;
  var CHECK_KEY = "gijo:onboarding:checked"; // 체크된 항목 id 배열
  var SEEN_KEY = "gijo:onboarding:seen";     // 최초 자동표시 1회 플래그
  var COACH_KEY = "gijo:onboarding:coach";   // 코치마크 노출 1회 플래그

  // 단계별 체크 항목. page = 클릭 시 이동할 메뉴(그룹 대표 페이지).
  var STEPS = [
    { title: "0. 접속·계정", items: [
      { id: "ob0a", label: "로그인·비밀번호 변경", page: "settings.html" },
      { id: "ob0b", label: "AI 동작 확인(어시스턴트에 인사)", page: "agent.html" },
    ]},
    { title: "1. 무엇을 지킬지 등록", items: [
      { id: "ob1a", label: "AI 자산 등록(스캔·업로드·수동)", page: "inventory.html" },
      { id: "ob1b", label: "AI-BOM 구성 기록", page: "sbom.html" },
      { id: "ob1c", label: "운영 보안제품 등록", page: "products.html" },
    ]},
    { title: "2. 첫 취약점 처리", items: [
      { id: "ob2a", label: "스캔 결과 업로드(Nessus CSV/JSON)", page: "vulnscan.html" },
      { id: "ob2b", label: "담당자·기한(SLA) 배정", page: "approvals.html" },
      { id: "ob2c", label: "AI에 취약점 해설 요청", page: "agent.html" },
    ]},
    { title: "3. AI에 회사 지식 주기", items: [
      { id: "ob3a", label: "사내 문서 올리기(RAG)", page: "memory.html" },
      { id: "ob3b", label: "온톨로지 샘플·규칙 등록", page: "ontology.html" },
    ]},
    { title: "4. 정기 루틴 자리잡기", items: [
      { id: "ob4a", label: "대시보드 매일 확인 습관", page: "dashboard.html" },
      { id: "ob4b", label: "컴플라이언스 대응현황 갱신", page: "compliance.html" },
    ]},
  ];

  function allItems() { return STEPS.reduce(function (a, s) { return a.concat(s.items); }, []); }
  function totalItems() { return allItems().length; }
  function getChecked() {
    try { var v = JSON.parse(localStorage.getItem(CHECK_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function setChecked(list) { try { localStorage.setItem(CHECK_KEY, JSON.stringify(list)); } catch (e) {} }
  function isChecked(id) { return getChecked().indexOf(id) >= 0; }
  function toggle(id, on) {
    var list = getChecked(); var i = list.indexOf(id);
    if (on && i < 0) list.push(id);
    if (!on && i >= 0) list.splice(i, 1);
    setChecked(list); return list;
  }
  function progress() { var c = getChecked(); var ids = allItems().map(function (x) { return x.id; }); var done = ids.filter(function (id) { return c.indexOf(id) >= 0; }).length; return { done: done, total: ids.length }; }

  // 테스트/디버그 핸들 (순수 로직 검증용).
  if (typeof window !== "undefined") window.__gijoOnboarding = { STEPS: STEPS, totalItems: totalItems, progress: progress, toggle: toggle };

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function go(page) { close(); if (window.gijo && window.gijo.navigateTo) window.gijo.navigateTo(page); }

  function injectCss() {
    if (document.getElementById("gijoObCss")) return;
    var st = document.createElement("style");
    st.id = "gijoObCss";
    st.textContent =
      "#gijoObBackdrop{position:fixed;inset:0;background:rgba(4,7,14,.72);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px}" +
      "#gijoObPanel{background:var(--panel,#121a2e);border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:14px;max-width:640px;width:100%;max-height:86vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}" +
      ".gijo-ob-head{padding:22px 24px 14px;border-bottom:1px solid var(--border,rgba(255,255,255,.08))}" +
      ".gijo-ob-title{font-size:18px;font-weight:800;color:#fff}" +
      ".gijo-ob-sub{font-size:12.5px;color:var(--muted,#8b93ab);margin-top:4px}" +
      ".gijo-ob-track{height:7px;border-radius:20px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:12px}" +
      ".gijo-ob-fill{height:100%;background:var(--teal,#1eb980);border-radius:20px;transition:width .2s}" +
      ".gijo-ob-body{padding:8px 24px 18px}" +
      ".gijo-ob-step{font-size:11px;font-weight:800;color:var(--muted-2,#5f6785);letter-spacing:.6px;margin:16px 0 6px;text-transform:uppercase}" +
      ".gijo-ob-item{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:9px}" +
      ".gijo-ob-item:hover{background:rgba(255,255,255,.04)}" +
      ".gijo-ob-cb{width:18px;height:18px;flex:0 0 auto;cursor:pointer;accent-color:var(--teal,#1eb980)}" +
      ".gijo-ob-label{font-size:13.5px;color:var(--text,#e7eaf3);flex:1}" +
      ".gijo-ob-label.done{color:var(--muted-2,#5f6785);text-decoration:line-through}" +
      ".gijo-ob-goto{font-size:12px;font-weight:700;color:var(--blue-light,#5fa1ff);cursor:pointer;white-space:nowrap}" +
      ".gijo-ob-foot{padding:14px 24px 20px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border,rgba(255,255,255,.08))}" +
      ".gijo-ob-note{font-size:11.5px;color:var(--muted-2,#5f6785)}" +
      ".gijo-ob-btn{background:var(--blue,#3b82f6);color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer}" +
      "#gijoObLauncher{position:fixed;right:20px;bottom:20px;z-index:9997;background:var(--panel,#121a2e);border:1px solid var(--border-strong,rgba(255,255,255,.16));color:var(--text,#e7eaf3);padding:10px 15px;border-radius:22px;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.35)}" +
      "#gijoObLauncher b{color:var(--teal,#1eb980)}";
    document.head.appendChild(st);
  }

  function close() {
    var b = document.getElementById("gijoObBackdrop");
    if (b && b.parentNode) b.parentNode.removeChild(b);
    renderLauncher();
  }

  function open() {
    injectCss();
    var existing = document.getElementById("gijoObBackdrop");
    if (existing) existing.parentNode.removeChild(existing);
    var p = progress();

    var backdrop = document.createElement("div");
    backdrop.id = "gijoObBackdrop";
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

    var panel = document.createElement("div");
    panel.id = "gijoObPanel";

    var stepsHtml = STEPS.map(function (s) {
      var items = s.items.map(function (it) {
        var done = isChecked(it.id);
        return '<div class="gijo-ob-item">' +
          '<input type="checkbox" class="gijo-ob-cb" data-id="' + it.id + '"' + (done ? " checked" : "") + ">" +
          '<span class="gijo-ob-label' + (done ? " done" : "") + '">' + esc(it.label) + "</span>" +
          '<span class="gijo-ob-goto" data-go="' + it.page + '">이동 →</span></div>';
      }).join("");
      return '<div class="gijo-ob-step">' + esc(s.title) + "</div>" + items;
    }).join("");

    panel.innerHTML =
      '<div class="gijo-ob-head"><div class="gijo-ob-title">🚀 시작 가이드 — GIJO AS 온보딩</div>' +
      '<div class="gijo-ob-sub">아래 순서대로 하나씩 해보세요. 체크는 저장됩니다. 항목의 "이동 →"으로 해당 화면으로 바로 갑니다.</div>' +
      '<div class="gijo-ob-track"><div class="gijo-ob-fill" id="gijoObFill" style="width:' + (p.total ? Math.round(p.done / p.total * 100) : 0) + '%"></div></div>' +
      '<div class="gijo-ob-sub" id="gijoObCount" style="margin-top:6px">' + p.done + " / " + p.total + " 완료</div></div>" +
      '<div class="gijo-ob-body">' + stepsHtml + "</div>" +
      '<div class="gijo-ob-foot"><span class="gijo-ob-note">필수는 0~2단계(약 2~3시간). 나머지는 필요할 때.</span>' +
      '<button class="gijo-ob-btn" id="gijoObDone">나중에</button></div>';

    // 이벤트 위임: 체크박스 토글 / 이동 링크.
    panel.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-go")) { go(t.getAttribute("data-go")); return; }
    });
    panel.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.className && String(t.className).indexOf("gijo-ob-cb") >= 0) {
        toggle(t.getAttribute("data-id"), t.checked);
        var lbl = t.nextSibling; if (lbl && lbl.classList) lbl.classList.toggle("done", t.checked);
        var pr = progress();
        var fill = document.getElementById("gijoObFill"); if (fill) fill.style.width = (pr.total ? Math.round(pr.done / pr.total * 100) : 0) + "%";
        var cnt = document.getElementById("gijoObCount"); if (cnt) cnt.textContent = pr.done + " / " + pr.total + " 완료";
      }
    });

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    var doneBtn = document.getElementById("gijoObDone");
    if (doneBtn) doneBtn.addEventListener("click", close);
  }

  function renderLauncher() {
    var old = document.getElementById("gijoObLauncher");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    injectCss();
    var p = progress();
    var el = document.createElement("div");
    // 페이지가 슬롯(#gijoObSlot — 대시보드 탐색기 카드)을 제공하면 거기 인라인으로만 노출한다.
    // 슬롯이 없는 화면(대시보드 외 메뉴)에서는 시작 가이드를 띄우지 않는다. 슬롯 스타일은 페이지 CSS(.ob-row).
    var slot = document.getElementById("gijoObSlot");
    if (slot) {
      el.id = "gijoObLauncher";
      el.className = "ob-row";
      el.style.position = "static"; // #gijoObLauncher의 fixed 스타일 무효화
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.boxShadow = "none";
      el.style.borderRadius = "8px";
      el.style.padding = "6px 9px";
      el.style.fontSize = "11px";
      el.innerHTML = (p.done >= p.total ? "✅ 가이드 완료" : "🚀 시작 가이드") + ' <span class="pr">' + p.done + " / " + p.total + "</span>";
      el.addEventListener("click", open);
      slot.innerHTML = "";
      slot.appendChild(el);
      return;
    }
    // 슬롯이 없는 화면(=대시보드가 아닌 메뉴)에서는 시작 가이드를 노출하지 않는다.
    // (요청: 시작 가이드는 대시보드에만 표시)
  }

  // ── 코치마크(C안): 첫 방문 시 핵심 지점에 말풍선 1개. 강요 없이, 닫으면 다시 안 뜬다. ──
  function injectCoachCss() {
    if (document.getElementById("gijoCoachCss")) return;
    var st = document.createElement("style"); st.id = "gijoCoachCss";
    st.textContent =
      "#gijoCoach{position:fixed;z-index:9996;max-width:250px;background:var(--purple,#8b7cf0);color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:12px;line-height:1.5;}" +
      "#gijoCoach .ct{font-weight:800;margin-bottom:4px;}" +
      "#gijoCoach .cx{position:absolute;top:6px;right:9px;cursor:pointer;opacity:.8;font-weight:800;}" +
      "#gijoCoach .cb{margin-top:9px;display:flex;gap:7px;}" +
      "#gijoCoach .cbtn{background:rgba(255,255,255,.2);border:0;color:#fff;font-size:11px;font-weight:700;padding:5px 11px;border-radius:7px;cursor:pointer;}" +
      "#gijoCoach .cbtn.p{background:#fff;color:var(--purple,#8b7cf0);}";
    document.head.appendChild(st);
  }
  function showCoach() {
    injectCoachCss();
    // 챗봇 알약(#gijoChatWidget)을 가리킨다 — "막히면 챗봇에게 물어보세요". 없으면 우하단 기본 위치.
    var target = document.getElementById("gijoChatWidget");
    var box = document.createElement("div");
    box.id = "gijoCoach";
    box.innerHTML =
      '<span class="cx" id="gijoCoachX">✕</span><div class="ct">💡 막히면 AI에게 물어보세요</div>' +
      "어느 화면이든 오른쪽 아래 챗봇, 또는 제목 옆 ⓘ를 누르면 그 화면 사용법을 바로 알려줘요." +
      '<div class="cb"><button class="cbtn p" id="gijoCoachGuide">시작 가이드 보기</button><button class="cbtn" id="gijoCoachOk">알겠어요</button></div>';
    document.body.appendChild(box);
    // 위치: 타깃 위쪽, 없으면 우하단.
    if (target) { var r = target.getBoundingClientRect(); box.style.bottom = (window.innerHeight - r.top + 10) + "px"; box.style.right = "20px"; }
    else { box.style.bottom = "78px"; box.style.right = "20px"; }
    function dismiss() { try { localStorage.setItem(COACH_KEY, "1"); } catch (e) {} if (box.parentNode) box.parentNode.removeChild(box); }
    document.getElementById("gijoCoachX").addEventListener("click", dismiss);
    document.getElementById("gijoCoachOk").addEventListener("click", dismiss);
    document.getElementById("gijoCoachGuide").addEventListener("click", function () { dismiss(); open(); });
    setTimeout(function () { if (box.parentNode) dismiss(); }, 15000); // 15초 후 자동 사라짐
  }

  function init() {
    if (DISABLED) return;
    renderLauncher();
    var onDash = (location.pathname || "").indexOf("dashboard.html") >= 0;
    // C안: 대시보드 첫 방문 시 전체 모달 대신 코치마크 1회(마찰 최소). 체크리스트는 런처로.
    var coached = localStorage.getItem(COACH_KEY) === "1";
    if (onDash && !coached) { try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) {} setTimeout(showCoach, 1200); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
