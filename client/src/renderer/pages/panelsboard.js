// panelsboard.js — 현황판(그룹 요약 판)을 **한 자리에 모아** 보여 주는 부품 [2026-08-20 · 1단계]
//
// ■ 왜 (사장님 지시 10건, 2026-08-20)
//   "해당 카드들을 한화면에서 보고 싶고" · "카드들의 움직임이 기준이되면 보기 편할것 같아" ·
//   "초기 대시보드에 현황판 보여줘 거기서 선택해서 바로 작업 하게" ·
//   "대화창 사용이 현황판을 기준으로 하면 좋을것 같아서 하는거야".
//   승인 시안: mockups/panels-overview/시안.html (§1 대화 홈 스트립 · §2 전체 지도 · §8 코드 통합).
//
// ■ 판 정의는 **여전히 grouppanels.js 한 곳**이다(계약 유지 — 이 파일은 정의를 갖지 않는다).
//   여기가 하는 일은 셋뿐: ① 전 그룹의 판을 모은다 ② 움직였는지 판정한다 ③ 그린다.
//
// ■ 「움직임」이란 — 판의 숫자가 **이전에 본 값과 달라진 것**이다. 서버를 새로 만들지 않고
//   앞서 본 값을 localStorage에 남겨 비교한다(관례 키 gijo:영역:이름:vN — app.html·grouphub이
//   쓰는 그 방식). 앱을 껐다 켜도 살아남아야 「어제 이후 무엇이 변했나」가 성립한다.
//   ⚠ **첫 관측은 움직임이 아니다.** 기준선만 세우고 조용히 넘어간다 — 안 그러면 처음 열 때
//     전 판이 「방금 움직임」으로 빨갛게 서고, 그건 거짓이다.
//   ⚠ **「움직임 없음」은 「문제 없음」이 아니다.** 스캔이 실패해 조용할 수도 있다
//     (project_scan_overwrite_dataloss 계열 사고). 그래서 타일마다 **마지막 확인 시각**을
//     함께 적는다 — 「조용하다」와 「확인을 못 했다」는 다른 말이고, 화면이 그 둘을 구분해야 한다.
//   ⚠ 판이 안 불러와지면 「불러오지 못했습니다」로 **명시**한다(0으로 채우지 않는다 — 0은
//     「없다」는 뜻이라 거짓이 된다. grouppanels.js 머리 규칙과 같은 잣대).
//
// ■ 숫자 잣대는 **판이 정한 그대로** 쓴다. 이 파일은 어떤 수도 새로 세지 않는다 —
//   세는 곳이 둘이 되는 순간 화면마다 값이 달라지고, 그 순간 담당자는 숫자를 못 믿는다.
//
// 쓰는 법:
//   window.gijoPanelsBoard.mount(host, { compact: true, limit: 6 })  — 대화 홈 압축 스트립
//   window.gijoPanelsBoard.mount(host, { compact: false })           — 전체 지도
(function () {
  if (window.gijoPanelsBoard) return;

  var KEY = "gijo:panels:seen:v1";   // { 판id: { fp, movedAt } } — 앞서 본 지문과 그때 시각
  var 최근 = null;                    // 이번 화면에서 잰 결과(정렬·재렌더용)

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── 모양 — 한 번만 주입한다(workflowrail.js 관례). 11px 미만 금지(uireadability 시험). ──
  function 모양() {
    if (document.getElementById("gijoPanelsCss")) return;
    var st = document.createElement("style");
    st.id = "gijoPanelsCss";
    st.textContent =
      ".pv-wrap{width:100%;}" +
      ".pv-head{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:12.25px;color:var(--muted,#b3ada4);}" +
      ".pv-head b{color:var(--text,#e9e7e2);font-weight:800;}" +
      ".pv-head .pv-more{margin-left:auto;background:transparent;border:1px solid var(--border-strong,rgba(255,255,255,.16));" +
      "color:var(--muted,#b3ada4);border-radius:7px;padding:4px 10px;font-size:11.75px;font-weight:700;cursor:pointer;font-family:inherit;}" +
      ".pv-head .pv-more:hover{color:var(--text-strong,#fff);border-color:var(--blue,#3b82f6);}" +
      ".pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;align-items:start;}" +
      // ⚠ 한 판 = 셀 하나다. 타일·조작·목록을 형제로 두면 **각각이 그리드 칸을 차지해** 판이
      //   세 조각으로 흩어진다(그리드 자식은 전부 셀이 된다). 셀로 묶어 둔다.
      ".pv-cell{min-width:0;}" +
      ".pv-tile{border:1px solid var(--border,rgba(255,255,255,.08));border-radius:9px;background:var(--panel,#30302e);" +
      "padding:9px 11px;cursor:pointer;text-align:left;font-family:inherit;color:inherit;display:block;width:100%;}" +
      ".pv-tile:hover{border-color:var(--blue,#3b82f6);}" +
      ".pv-tile.moved{border-color:var(--amber,#f0a020);}" +
      ".pv-t{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:800;color:var(--text-strong,#fff);}" +
      ".pv-t .pv-dot{width:6px;height:6px;border-radius:50%;background:var(--amber,#f0a020);flex:0 0 auto;}" +
      ".pv-t .pv-ag{margin-left:auto;font-size:11px;font-weight:700;color:var(--muted-2,#a49d95);}" +
      ".pv-v{display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;font-size:12.25px;color:var(--muted,#b3ada4);}" +
      ".pv-v b{color:var(--text,#e9e7e2);font-weight:800;}" +
      ".pv-f{margin-top:4px;font-size:11.25px;color:var(--muted-2,#a49d95);line-height:1.5;}" +
      ".pv-f .pv-when{color:var(--muted-2,#a49d95);}" +
      ".pv-f .pv-fail{color:#f5928a;font-weight:700;}" +
      ".pv-acts{display:flex;gap:6px;margin-top:7px;}" +
      ".pv-acts button{background:transparent;border:1px solid var(--border-strong,rgba(255,255,255,.16));color:var(--muted,#b3ada4);" +
      "border-radius:7px;padding:3px 9px;font-size:11.25px;font-weight:700;cursor:pointer;font-family:inherit;}" +
      ".pv-acts button:hover{color:var(--text-strong,#fff);border-color:var(--blue,#3b82f6);}" +
      // 하위 리스트 — .g-rows 공용 부품(gijo-ui.css)을 그대로 쓴다. 새 시각 언어를 만들지 않는다.
      ".pv-rows{margin-top:7px;}" +
      ".pv-rows .g-rows-scroll{--gr-maxh:220px;}" +
      // ⚠ 이 목록은 **훑어보기 전용**이다 — 고르기는 🎯(pick.html)로 통일했다(사장님 지시).
      //   공용 .g-rows는 행에 손가락 커서·hover를 주는데, 여기서 그대로 두면 「눌러도 아무 일
      //   없는 자리」가 된다(검토관 중6). 커서·hover를 낮춰 눌러도 되는 것처럼 보이지 않게 한다.
      ".pv-rows .g-rows-r{cursor:default;}" +
      ".pv-rows .g-rows-r:hover{background:inherit;}" +
      ".pv-empty{font-size:11.75px;color:var(--muted-2,#a49d95);padding:10px 2px;}";
    document.head.appendChild(st);
  }

  // ── 저장(앞서 본 값) ─────────────────────────────────────────────────────
  function 읽기() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function 쓰기(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 화면은 산다 */ } }

  // 지문 — 판이 준 **숫자만** 모은다(문구·색은 뺀다. 문구가 바뀌었다고 「움직였다」고 하면 거짓).
  function 지문(d) {
    if (!d) return null;
    var parts = [];
    (d.segments || []).forEach(function (s) { parts.push(String(s.key || s.label) + "=" + s.value); });
    (d.rows || []).forEach(function (r) { parts.push(String(r[0]) + "=" + String(r[1])); });
    return parts.join("|") || null;
  }

  function 언제(t) {
    if (!t) return "";
    var 초 = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (초 < 60) return "방금";
    if (초 < 3600) return Math.floor(초 / 60) + "분 전";
    if (초 < 86400) return Math.floor(초 / 3600) + "시간 전";
    return Math.floor(초 / 86400) + "일 전";
  }

  /**
   * 전 그룹의 판을 모은다. 정의는 grouppanels.js 한 곳 — 여기서 새로 만들지 않는다.
   * 그룹 이름을 함께 달아 둔다(도메인 묶기·이동에 쓴다).
   */
  function 판모으기() {
    var G = window.gijoGroupPanels || {};
    var out = [];
    Object.keys(G).forEach(function (g) {
      (G[g] || []).forEach(function (p) { out.push({ 그룹: g, 판: p }); });
    });
    return out;
  }

  /**
   * 판 하나를 재고 「움직였는가」를 판정한다.
   * 반환 { id, 그룹, 판, d, 실패, movedAt, checkedAt, 첫관측 }
   */
  function 재기(항목, 앞서) {
    var p = 항목.판;
    return Promise.resolve()
      .then(function () { return p.load(); })
      .then(function (d) {
        var fp = 지문(d);
        var 전 = 앞서[p.id];
        var movedAt = 전 ? 전.movedAt || null : null;
        var 첫관측 = !전;
        // ⚠ **판이 스스로 「일부를 못 봤다」고 알리면(확인못함) 성공으로 세지 않는다**
        //   (병렬 검토 중1). 어떤 판은 내부에서 실패를 삼켜 0·"-"로 정상 모양을 돌려주는데,
        //   그걸 성공으로 받으면 ① 0을 「값이 바뀌었다」로 오판해 거짓 「바뀜」을 띄우고
        //   ② 그 0으로 **기준선까지 덮어써** 서버가 돌아온 뒤 한 번 더 거짓을 낸다.
        //   서버 재시작은 우리 배포 절차의 일상이라 실제로 자주 밟히는 자리다.
        // ⚠ 지문이 아예 안 잡힌 판(fp=null)도 같은 이유로 기준선을 덮지 않는다.
        if ((d && d.확인못함 && d.확인못함.length) || !fp) {
          return { id: p.id, 그룹: 항목.그룹, 판: p, d: d,
            실패: d && d.확인못함 && d.확인못함.length ? "일부를 불러오지 못했습니다 — " + d.확인못함.join("·") : "값을 읽지 못했습니다",
            movedAt: movedAt, checkedAt: Date.now(), okAt: (전 || {}).okAt || null, 첫관측: false };
        }
        // 첫 관측은 기준선만 세운다 — 처음 열 때 전 판이 「방금 움직임」이면 거짓이다.
        if (전 && fp && 전.fp && fp !== 전.fp) movedAt = Date.now();
        // okAt = **마지막으로 실제 값을 본 시각**. 실패했을 때 「언제까지는 확실했나」를
        // 말하려면 이 값이 필요하다(검토관 상2).
        앞서[p.id] = { fp: fp, movedAt: movedAt, okAt: Date.now() };
        return { id: p.id, 그룹: 항목.그룹, 판: p, d: d, 실패: false, movedAt: movedAt, checkedAt: Date.now(), okAt: Date.now(), 첫관측: 첫관측 };
      })
      .catch(function (e) {
        // 실패는 실패로 — 0으로 채우면 「없다」가 되어 거짓이 된다.
        // ⚠ 앞서 저장한 지문(fp)은 **건드리지 않는다** — 실패를 「값이 바뀌었다」로 오인하거나
        //   기준선을 날리면 다음 관측이 통째로 거짓이 된다.
        return { id: p.id, 그룹: 항목.그룹, 판: p, d: null, 실패: (e && e.message) || "오류",
          movedAt: (앞서[p.id] || {}).movedAt || null, checkedAt: Date.now(),
          okAt: (앞서[p.id] || {}).okAt || null, 첫관측: false };
      });
  }

  // ── 타일 한 장 ───────────────────────────────────────────────────────────
  function 타일(r, opt) {
    var p = r.판, d = r.d;
    var 움직임 = !!r.movedAt && (Date.now() - r.movedAt) < 86400000; // 하루 안에 바뀐 것만 강조
    var 값 = "";
    if (r.실패) {
      // 서버 원문 오류(경로·상태코드)를 담당자 화면에 그대로 내보내지 않는다(검토관 하15) —
      // 사람이 할 수 있는 다음 걸음만 말한다. 자세한 원문은 title로 남겨 개발자가 볼 수 있게.
      값 = '<div class="pv-f"><span class="pv-fail">불러오지 못했습니다</span> ' +
        '<span title="' + esc(String(r.실패).slice(0, 200)) + '">— 서버 연결을 확인해 주세요</span></div>';
    } else if (d) {
      var 조각 = (d.segments || []).slice(0, 4).map(function (s) {
        return esc(s.label) + " <b" + (s.color ? ' style="color:' + s.color + '"' : "") + ">" + (s.value || 0).toLocaleString() + "</b>";
      });
      var 줄 = (d.rows || []).slice(0, 3).map(function (x) {
        return esc(x[0]) + " <b" + (x[2] ? ' style="color:' + x[2] + '"' : "") + ">" + esc(x[1]) + "</b>";
      });
      var 보임 = 조각.concat(줄);
      값 = 보임.length ? '<div class="pv-v">' + 보임.join("") + "</div>" : '<div class="pv-f">데이터 없음</div>';
      // 배지(KEV N·미배정 N·기한 초과 N·오늘 오류 N)는 그 판에서 **가장 급한 한 줄**이다.
      // 그룹 허브(grouphub.js:145)는 그리는데 여기서 버리면 「같은 판」 계약이 깨진다(검토관 하11).
      if (d.badge && d.badge.text) {
        값 = '<div class="pv-v"><b' + (d.badge.color ? ' style="color:' + d.badge.color + '"' : "") + ">⚠ " +
          esc(d.badge.text) + "</b></div>" + 값;
      }
      if (d.foot) 값 += '<div class="pv-f">' + esc(d.foot) + "</div>";
    }
    // 마지막 확인 시각을 **항상** 적는다 — 「조용하다」와 「확인을 못 했다」를 구분하기 위해서다.
    // ⚠ 실패한 판에 「확인 방금 · 그대로」라고 적으면 정반대 말이 된다(검토관 상2): 확인을
    //   못 했으므로 「그대로」는 할 수 없는 말이고, 실패한 시도를 확인으로 세면 안 된다.
    //   실패면 마지막으로 **값을 본** 시각(okAt)을 대신 말한다.
    var 꼬리 = r.실패
      ? '<div class="pv-f"><span class="pv-fail">확인 실패</span><span class="pv-when">' +
        (r.okAt ? " · 마지막으로 본 값 " + 언제(r.okAt) : " · 아직 한 번도 못 봤습니다") + "</span></div>"
      : '<div class="pv-f"><span class="pv-when">확인 ' + 언제(r.checkedAt) +
        (r.movedAt ? " · 바뀜 " + 언제(r.movedAt) : r.첫관측 ? " · 기준 잡음" : " · 그대로") + "</span></div>";
    // 담당 AI — 근거가 있는 판만(agents 필드). 없으면 배지를 아예 안 그린다(지어내지 않는다).
    var 에이전트 = p.agents && p.agents.length
      ? '<span class="pv-ag" title="이 영역을 맡는 AI 팀원">' + p.agents.map(function (a) { return esc(a); }).join("·") + "</span>"
      : "";
    // 조작 — 압축(대화 홈)에서는 **▾ 목록만** 낸다(2026-08-20 사장님 「메뉴 리스트들을 엑셀로
    // 보고 싶은데 안 도나봐?」). 압축에 아무 단추도 안 두었더니 대화 홈에서는 목록에 닿을
    // 길이 없었고, 「🗺 전체 보기」를 거쳐야만 나왔다 — 사장님이 첫 화면에서 찾으셨으면
    // 있을 수가 없었다.
    // ⚠ 압축에 셋을 다 넣지는 않는다: 화면 열기는 **타일 클릭**이 이미 하고(아래 위임),
    //   🎯는 고른 것을 무대로 올리는 조작이라 좁은 자리에 두면 잘못 눌린다. 밀도도 지킨다.
    var 조작 = "";
    if (opt.compact) {
      조작 = p.rows ? '<div class="pv-acts"><button data-act="rows" data-id="' + esc(p.id) + '">▾ 목록</button></div>' : "";
    } else {
      // 📖 시나리오 — 판 ↔ 업무 시나리오 대응(grouppanels scenario 필드, 2026-08-21 ⓐ안).
      // ⚠ 대화창(gijoConsole)이 없는 자리(iframe 등)에서는 칩을 **안 그린다** — 눌러도 아무
      //   일도 안 나는 단추는 없는 단추보다 나쁘다(없는 함수 버튼 전례).
      var 시나리오칩 = p.scenario && window.gijoConsole && window.gijoConsole.ask
        ? '<button data-act="scenario" data-id="' + esc(p.id) + '" title="이 업무의 단계를 대화창이 안내합니다">📖 시나리오</button>' : "";
      조작 = '<div class="pv-acts">' +
        '<button data-act="open" data-id="' + esc(p.id) + '">🗔 화면 열기</button>' +
        (p.rows ? '<button data-act="rows" data-id="' + esc(p.id) + '">▾ 목록 보기</button>' : "") +
        (p.pick ? '<button data-act="pick" data-id="' + esc(p.id) + '">🎯 고르기</button>' : "") +
        시나리오칩 +
        "</div>";
    }
    return '<div class="pv-cell">' +
      '<button class="pv-tile' + (움직임 ? " moved" : "") + '" data-id="' + esc(p.id) + '">' +
      '<div class="pv-t">' + (움직임 ? '<span class="pv-dot" title="최근에 값이 바뀌었습니다"></span>' : "") +
      esc(p.title) + 에이전트 + "</div>" + 값 + 꼬리 + "</button>" +
      조작 + '<div class="pv-rows" id="pvr-' + esc(p.id) + '"></div></div>';
  }

  // ── 하위 리스트(엑셀형) — 판이 rows()를 가진 경우에만. 없으면 단추 자체를 안 그린다. ──
  function 목록펴기(r, box) {
    if (!r.판.rows) return;
    var cell = box.closest ? box.closest(".pv-cell") : null;
    if (box.getAttribute("data-open") === "1") {
      box.innerHTML = ""; box.removeAttribute("data-open");
      if (cell) cell.style.gridColumn = "";        // 다시 한 칸으로
      return;
    }
    box.setAttribute("data-open", "1");
    // ⚠⚠ **펼친 동안은 줄 전체를 쓴다**(2026-08-20 병렬 검토 상2). 타일 한 칸은 214px인데
    //   테두리·여백을 빼면 안쪽이 188px뿐이라, 고정 폭 열들(심각도·KEV 등)이 그것을 다 먹고
    //   **1열(무엇)이 0~52px로 무너졌다** — 7판 중 6판이 55px 미만, 2판은 아예 0px였다.
    //   열 규약의 「1열 무엇 필수」가 화면에서 사라지는 것이라, 목록에 닿아도 무엇인지 못 읽는다.
    if (cell) cell.style.gridColumn = "1 / -1";
    box.innerHTML = '<div class="pv-empty">불러오는 중…</div>';
    Promise.resolve()
      .then(function () { return r.판.rows(); })
      .then(function (t) {
        if (!t || !t.rows || !t.rows.length) { box.innerHTML = '<div class="pv-empty">목록이 없습니다.</div>'; return; }
        var cols = t.cols || [];
        var gt = t.grid || "1fr 90px 70px";
        box.innerHTML = '<div class="g-rows"><div class="g-rows-scroll">' +
          (cols.length ? '<div class="g-rows-head" style="grid-template-columns:' + gt + ';gap:8px">' +
            cols.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</div>" : "") +
          '<div class="g-rows-flat">' + t.rows.slice(0, 200).map(function (row) {
            return '<div class="g-rows-r" style="grid-template-columns:' + gt + ';gap:8px">' +
              row.map(function (c, i) {
                return '<span class="' + (i === 0 ? "trunc" : "gm2") + '" title="' + esc(c) + '">' + esc(c) + "</span>";
              }).join("") + "</div>";
          }).join("") + "</div>" +
          (t.rows.length > 200 ? '<div class="pv-empty">앞 200건 표시 — 전체는 화면에서 보세요.</div>' : "") +
          "</div></div>";
      })
      .catch(function (e) {
        box.innerHTML = '<div class="pv-empty"><span class="pv-fail">목록을 불러오지 못했습니다</span> — ' + esc((e && e.message) || "오류") + "</div>";
      });
  }

  // ── 화면 열기 · 고르기 — 기존 통로 그대로(새 배선을 만들지 않는다) ─────────
  function 화면열기(page, label) {
    if (window.gijoTabs && window.gijoTabs.open) { window.gijoTabs.open(page, label, { dock: true }); return; }
    try { window.top.postMessage({ type: "gijo:openTab", page: page, label: label }, "*"); } catch (e) { }
  }
  function 고르기(kind) {
    // 🎯는 5.49.0의 pick.html을 그대로 쓴다(사장님 「통일」) — 새 고르기 UI를 만들지 않는다.
    // 탭 이름도 그 관례 그대로 「고르기」다(검토관 하12 — 판 제목을 쓰면 vulnscan 탭과 이름이
    // 같아져 열린 탭 목록에서 구분이 안 된다. chatparts.js:375도 「고르기」로 연다).
    화면열기("pick.html?kind=" + encodeURIComponent(kind), "고르기");
  }

  /**
   * 그린다.
   * @param host  붙일 자리
   * @param opt   { compact: boolean, limit: number, onMore: function }
   */
  function mount(host, opt) {
    opt = opt || {};
    모양();
    // ── 다시 재기(검토관 상3) ─────────────────────────────────────────────
    // ⚠ 갱신이 없으면 숫자가 **앱을 켠 순간에 얼어붙는데** 꼬리는 영원히 「확인 방금」이라
    //   적혀 거짓 안심을 준다(스캔을 돌리고 승인을 처리해도 화면은 그대로). 승인 시안 §1도
    //   「8초마다 자동 확인」을 그렸다 — 다만 8초는 판 17개 × API 호출이라 너무 잦다.
    //   창을 다시 볼 때(visibilitychange·focus)와 90초 주기로 다시 잰다: 사람이 화면을
    //   떠나 있는 동안은 안 재고, 돌아오면 최신으로 맞춘다.
    if (host._pvTimer) { clearInterval(host._pvTimer); host._pvTimer = null; }
    if (host._pvWake) { document.removeEventListener("visibilitychange", host._pvWake); host._pvWake = null; }
    var 항목들 = 판모으기();
    if (!항목들.length) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="pv-wrap"><div class="pv-head" id="pvHead">현황판을 확인하는 중…</div>' +
      '<div class="pv-grid" id="pvGrid"></div></div>';
    var grid = host.querySelector("#pvGrid");
    var head = host.querySelector("#pvHead");

    function 다시재기() {
    var 앞서 = 읽기();

    Promise.all(항목들.map(function (it) { return 재기(it, 앞서); })).then(function (결과) {
      쓰기(앞서);
      최근 = 결과;
      // 움직임 순 — 바뀐 것이 앞, 그다음은 원래 순서(안정 정렬). 실패한 판은 **맨 앞**에 둔다:
      // 「확인을 못 했다」는 조용한 것보다 먼저 알아야 하는 소식이다.
      // ⚠ 실패는 **문자열**(오류 메시지)이라 그대로 비교하면 비일관 비교자가 된다(검토관 중9):
      //   서로 다른 메시지의 두 판이 compare(a,b)=compare(b,a)=-1이 되어 정렬이 구현 정의로 샌다.
      var 정렬 = 결과.slice().sort(function (a, b) {
        if (!!a.실패 !== !!b.실패) return a.실패 ? -1 : 1;
        return (b.movedAt || 0) - (a.movedAt || 0);
      });
      var 보일것 = opt.compact && opt.limit ? 정렬.slice(0, opt.limit) : 정렬;
      // ⚠ 다시 그리기 전에 **펼쳐 둔 목록을 기억한다**(2026-08-20 병렬 검토). 90초 갱신이나
      //   창 복귀가 grid를 통째로 새로 그리면, 보던 목록이 말없이 접히고 줄 전체 폭 설정도
      //   함께 날아간다 — 읽는 도중에 화면이 스스로 닫히는 셈이다.
      var 펴둔것 = [];
      Array.prototype.forEach.call(grid.querySelectorAll('.pv-rows[data-open="1"]'), function (b) {
        var id = String(b.id || "").replace(/^pvr-/, "");
        if (id) 펴둔것.push(id);
      });
      grid.innerHTML = 보일것.map(function (r) { return 타일(r, opt); }).join("");
      펴둔것.forEach(function (id) {
        var rr = 결과.find(function (x) { return x.id === id; });
        var box = grid.querySelector("#pvr-" + id);
        if (rr && box) 목록펴기(rr, box);   // 같은 판을 다시 펴 준다(새 값으로)
      });

      var 움직인수 = 결과.filter(function (r) { return r.movedAt && (Date.now() - r.movedAt) < 86400000; }).length;
      var 실패수 = 결과.filter(function (r) { return r.실패; }).length;
      var 첫관측수 = 결과.filter(function (r) { return r.첫관측; }).length;
      // ⚠ 처음 보는 판이 대부분이면 「최근 바뀐 것 없음」은 **할 수 없는 말**이다(검토관 하14 —
      //   비교할 기준이 아직 없다). 타일은 「기준 잡음」이라 옳게 적는데 머리만 어긋나 있었다.
      var 가운데 = 움직인수 ? " · 최근 바뀐 것 <b>" + 움직인수 + "</b>"
        : 첫관측수 >= 결과.length ? " · 기준을 잡았습니다(다음부터 바뀐 것을 알려 드립니다)"
        : " · 최근 바뀐 것 없음";
      head.innerHTML = "<b>현황판</b> " + 결과.length + "개" + 가운데 +
        (실패수 ? ' · <span style="color:#f5928a;font-weight:700">확인 못 함 ' + 실패수 + "</span>" : "") +
        (opt.compact ? '<button class="pv-more" id="pvMore">🗺 전체 보기</button>' : "");
      var more = host.querySelector("#pvMore");
      if (more && opt.onMore) more.addEventListener("click", function (e) { e.stopPropagation(); opt.onMore(); });
    }).catch(function () {
      head.textContent = "현황판을 불러오지 못했습니다.";
    });
    }
    다시재기();

    // 주기·복귀 갱신 — 화면을 보고 있을 때만 잰다(안 보이면 건너뛴다).
    host._pvTimer = setInterval(function () {
      if (document.visibilityState === "visible" && host.isConnected) 다시재기();
    }, 90000);
    host._pvWake = function () { if (document.visibilityState === "visible" && host.isConnected) 다시재기(); };
    document.addEventListener("visibilitychange", host._pvWake);

    // 조작 — 타일(화면 열기)·목록·고르기. 위임 한 곳에서 받는다.
    // ⚠ **한 번만 건다**(검토관 중5). mount는 「전체 보기」로 다시 불리는데, 그때마다 걸면
    //   핸들러가 두 겹이 되어 한 클릭에 펴고-접기가 연달아 돌아 ▾ 목록이 영영 안 접힌다.
    if (!host._pvBound) {
      host._pvBound = true;
      host.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-act]");
        var tile = ev.target.closest(".pv-tile");
        var id = b ? b.getAttribute("data-id") : (tile ? tile.getAttribute("data-id") : null);
        if (!id || !최근) return;
        var r = 최근.find(function (x) { return x.id === id; });
        if (!r) return;
        var act = b ? b.getAttribute("data-act") : "open";
        if (act === "open") 화면열기(r.판.page, r.판.title.replace(/^[^\s]+\s/, ""));
        else if (act === "rows") 목록펴기(r, host.querySelector("#pvr-" + id));
        else if (act === "pick") 고르기(r.판.pick, r.판.title);
        // 📖 — 「지시는 대화창에서만」: 칩은 질문을 대화창에 넣을 뿐, 화면이 직접 실행하지 않는다.
        //   문구는 시나리오 분기(scenarios.ts isScenarioAsk)가 이름 검사로 **결정적으로** 받는다.
        else if (act === "scenario" && r.판.scenario && window.gijoConsole && window.gijoConsole.ask)
          window.gijoConsole.ask("시나리오: " + r.판.scenario);
      });
    }
  }

  window.gijoPanelsBoard = { mount: mount };
})();
