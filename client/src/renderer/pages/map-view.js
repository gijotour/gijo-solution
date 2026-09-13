// map-view.js — 보안 지형도: 자산을 「지도 한 장」으로 (2026-08-04, 시안 security-map-v1 승인)
// 2단계(2026-09) — 자산을 누르면 보안 서비스: 방패 타일(보안제품·하드닝 대상) + 등록 간선
//   (시안 mockups/asset-graph-v2/시안.html, 사장님 2026-09-13 「추천으로 시안 승인 및 계속진행」)
//
// 왜 있나(전-7 · 파트너 「AI 아닌 듯한 화면」 + 사용자 「맵·도표·그래프로, 클릭 한 번에 데이터」):
//   목록은 위에서부터 읽어야 하지만 지도는 **위험이 몰린 곳이 한눈에** 보인다.
//   정보 시각화 표준(Shneiderman: 훑어보기→좁히기→눌러서 상세)을 그대로 따른다 —
//   지금까지 화면은 이 순서가 거꾸로였다(상세부터 쏟아냄).
//
// 원칙:
//   · **지도는 보기 전용** — 모든 행동 단추는 대화창(askConsole)으로 끝난다(제품 핵심 원칙)
//   · 위험 등급·건수는 **inventory의 riskOf/activeFindings를 그대로 받아** 쓴다 —
//     지도와 표가 다른 잣대로 세면 두 숫자가 어긋나고, 어긋난 두 숫자는 둘 다 못 믿게 된다
//   · 구획은 **네트워크 대역** — 서비스 구획은 지금 못 그린다(자산 53/57이 서비스 미지정).
//     서비스 지정이 채워지면 서비스별 보기를 열 수 있다(시안에 적은 대로)
//   · 타일 크기는 **진짜 취약점만** 센다 — 조사 정보(info)·스캔 실패를 섞으면 지도가 거짓말한다
//     (서버 isRealVulnerability와 같은 잣대 — agenttools.ts)
//   · 폐쇄망 안전 — 외부 라이브러리·지도타일 없음, 순수 DOM
//
// 쓰는 법(inventory.html):
//   gijoMapView.render(container, assets, { riskOf, activeFindings, onDetail })
//   — 화면 데이터·판정 함수를 **주입받는다.** 이 파일은 제 나름대로 세지 않는다.
//
// 2단계 주입 계약(추가 — 전부 선택 항목, **없으면 옛 동작 그대로**):
//   · ctx.products(SecurityProduct[]) · ctx.hardening(HardeningTargetPublic[]) — 방패 타일 재료.
//     둘 다 없으면(undefined) 방패는 하나도 안 뜬다 — vulnscan.html의 히트맵 보기가 이 경로다.
//   · ctx.registered(boolean) — 이 화면이 **등록된 Asset**을 다루는가. true일 때만 ⑥⑦(쓰기 칩)이
//     뜬다. inventory.html=true, vulnscan.html=false(미등록/이름불일치 호스트에서 승인 없는
//     전사 리포트가 생기는 구멍을 화면째로 막는 스위치 — 시안 §11 검토관 [상] 적발).
//   · ctx.mode(string) — 좁히기 칩 상태("all"|"kev"|"high"|"nobody"). "all"이 아니면 방패를
//     숨긴다(방패엔 위험등급이 없어 그 칩들과 결이 다르다). 생략하면 "all"로 본다.
//   · ctx.onShieldDetail(kind, item) · ctx.onClusterDetail(list) — 방패/군집 타일 클릭 콜백.
//     방패·군집이 뜨려면(products/hardening 주입) 이 둘도 함께 있어야 한다.
(function () {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // findingplain의 `말`에 든 리터럴 **강조**를 <b>로(esc 다음에 적용). vulnscan·approvals과 같은 헬퍼.
  const boldify = (s) => String(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // 서버 isRealVulnerability(agenttools.ts SCAN_NOISE)와 **같은 목록**이어야 한다 —
  // 하나라도 빠지면 지도 타일 크기가 표와 어긋난다(2026-08-04: scan_not_supported가 빠져 있었다).
  var SCAN_NOISE = ["scan_error", "scan_not_supported"];
  /** 서버 isRealVulnerability와 같은 잣대 — 이름으로는 거르지 않는다(심각도만 본다). */
  function 진짜취약(f) {
    if (f.state === "fixed") return false;
    if (SCAN_NOISE.indexOf(f.finding_type) >= 0) return false;
    if (String(f.severity || "").toLowerCase() === "info") return false;
    return true;
  }

  /**
   * 구획 열쇠 — 네트워크 대역(/24). IP가 없으면 성격으로 묶는다.
   * ⚠ 대역을 /16으로 묶으면 172.168.x가 한 덩어리가 되어 구획이 의미를 잃고,
   *   /32(자산별)면 구획이 없는 것과 같다. /24가 사무망·서버망 구분과 맞는다(실데이터 기준).
   */
  function 구획열쇠(a) {
    if (a.assetType && /llm|ai|모델|agent/i.test(a.assetType)) return "AI 자산 — 우리 모델";
    const ip = String(a.ip || "").trim();
    const m = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
    if (m) return m[1] + ".x 대역";
    const host = String(a.hostname || a.name || "");
    if (/\.(kr|com|net|org|io)\b/i.test(host)) return "외부 노출 — 도메인";
    return "기타 — 대역 미상";
  }

  /**
   * 호스트 구획열쇠 — 하드닝 대상(host=IP만 있고 assetId가 없다)을 자산과 **같은 셈법**으로
   * 대역에 놓는다(시안 §3). ⚠ 이건 "이 하드닝 대상=이 자산이다"라는 **관계 판정이 아니다** —
   * 그 대상 자신이 등록할 때 이미 확정한 host 값의 앞 3옥텟으로 **구획 이름표만** 만든다.
   * 자산 존재 여부와 무관하게 자기 대역으로 — 없으면 새 구획이 생긴다(정직한 공백 표시,
   * ATT&CK Navigator 원칙 "모르는 것은 칠하지 않는다"와 반대로 "아는 것은 숨기지 않는다").
   * 반드시 구획열쇠()의 IP 분기와 **같은 문자열**을 내야 한다 — 갈리면 같은 대역인데 두 구획이
   * 생긴다(map-view.test.ts가 이 등가성을 직접 잰다).
   */
  function 호스트구획열쇠(host) {
    const m = String(host || "").trim().match(/^(\d+\.\d+\.\d+)\.\d+$/);
    if (!m) return "기타 — 대역 미상";
    return m[1] + ".x 대역";
  }

  /**
   * 군집 규칙 — 자산+방패를 합친 총노드가 200을 넘고, 한 구획 안 타일이 40개를 넘으면
   * 그 구획은 위험 큰 순 40개만 개별 타일, 나머지는 "+N개 더" 군집 타일 1개로 묶는다.
   * ⚠ 렌더 배치 규칙이지 위험 판정이 아니다 — 무엇이 위험한지는 안 바꾼다, 몇 개를
   *   개별 타일로 그릴지만 정한다(시안 §5).
   */
  function 군집규칙(총노드, 구획타일수) {
    return 총노드 > 200 && 구획타일수 > 40;
  }

  /**
   * 선택 알림 — **단 하나의 호출 지점**(selectioncontext.test.ts가 지킨다: 부품 호출이
   * 여러 곳이면 그중 하나가 자동 열림을 잡을 위험이 있다 — "자동 열림은 선택이 아니다").
   * 자산 타일 클릭과 방패(보안제품·하드닝) 타일 클릭이 전부 이 함수 하나를 거쳐서만 나간다.
   */
  function 선택알림(sel) {
    if (window.gijoSelectNotify) window.gijoSelectNotify({ label: sel.label, text: sel.text, fields: sel.fields });
  }

  /** 타일 하나. 크기=√(진짜 취약점 수) — 제곱근으로 눌러 큰 값이 지도를 독점하지 않게. */
  function 타일(a, ctx) {
    const real = (ctx.activeFindings(a) || []).filter(진짜취약);
    const rk = ctx.riskOf(a); // high | mid | low | none — 표와 같은 함수
    const level = rk.level === "none" ? "low" : rk.level;
    const d = document.createElement("div");
    d.className = "mv-tile mv-" + level + (/AI 자산/.test(구획열쇠(a)) ? " mv-ai" : "");
    d.style.flexBasis = 70 + Math.sqrt(real.length) * 7 + "px";
    d.style.minHeight = 30 + Math.sqrt(real.length) * 1.5 + "px";
    d.dataset.assetId = a.id;
    d.innerHTML =
      '<div class="mv-nm">' + esc(a.displayName || a.name) + "</div>" +
      '<div class="mv-ct">' + (real.length ? "미조치 " + real.length.toLocaleString() : rk.label) +
      (a.owner ? " · " + esc(a.owner) : "") + "</div>" +
      (rk.kev ? '<span class="mv-kev">KEV</span>' : "");
    return d;
  }

  /** 방패 타일(보안제품·하드닝 대상) — 자산 타일과 다른 오각형 모양, 위험 등급 색 대신
   *  등록 여부만 나타낸다(시안 §0[6][7] "모르는 것은 칠하지 않는다" — 방패는 위험 개념이 없다). */
  function 방패타일(kind, item) {
    const d = document.createElement("div");
    d.className = "mv-tile mv-shield" + (kind === "hardening" ? " mv-hard" : "");
    d.dataset.shieldKind = kind;
    d.dataset.shieldId = String(item.id);
    if (kind === "product") {
      d.innerHTML =
        '<div class="mv-snm">🛡 ' + esc(item.name) + "</div>" +
        '<div class="mv-sct">' + esc(item.category || "") + "</div>" +
        '<div class="mv-sreg">' + (item.assetId ? "등록됨 · 🔗 " + esc(item.assetName || "") : "등록됨 · 미연결") + "</div>";
    } else {
      d.innerHTML =
        '<div class="mv-snm">🛡 ' + esc(item.label) + "</div>" +
        '<div class="mv-sct">' + esc(String(item.standard || "").toUpperCase()) + "</div>" +
        '<div class="mv-sreg">점검 대상 등록됨</div>';
    }
    return d;
  }

  /** 군집 타일 — "+N개 더"(넘친 자산을 고/중/저로만 요약). 클릭하면 상세판에 전체 목록. */
  function 군집타일(list, ctx) {
    const byLevel = { high: 0, mid: 0, low: 0 };
    list.forEach((a) => { const lv = ctx.riskOf(a).level; byLevel[lv === "none" ? "low" : lv]++; });
    const d = document.createElement("div");
    d.className = "mv-cluster";
    d.innerHTML = "<b>+" + list.length + "개 더</b><span>고 " + byLevel.high + " · 중 " + byLevel.mid + " · 저 " + byLevel.low + "</span>";
    return d;
  }

  // 구획 접기 상태(2026-09, 시안 §5) — null=자동규칙(구획 3개 초과면 미조치 1위만 편다),
  // Set이면 사람이 한 번이라도 머리글을 눌러 **그 뒤로는 사람 뜻대로**. 페이지가 살아있는 동안만
  // 유지된다(모듈 상태 — inventory.html·vulnscan.html은 각자 자기 iframe에서 이 스크립트를
  // 새로 불러오므로 화면끼리 서로 섞이지 않는다).
  let 폴드상태 = null;

  /** DOM을 실제로 그린다. render()의 안쪽 절반 — 나머지 절반(등록 간선)은 render()가 잇는다. */
  function renderZones(container, assets, ctx) {
    const 구획 = new Map(); // key -> { assets:[], shields:[] }
    const 구획가져오기 = (k) => {
      if (!구획.has(k)) 구획.set(k, { assets: [], shields: [] });
      return 구획.get(k);
    };

    // ★ flat 모드(2026-08-04, 취약점 화면 ㉯): 구획 없이 **심각도 순 한 판**.
    //   취약점 화면은 「오늘 뭐부터」가 목적이라 동네보다 급한 순이 맞다.
    //   자산 화면은 동네(대역)로 묶는다 — 같은 지도지만 화면 목적에 맞춘다.
    if (ctx && ctx.flat) {
      const 진짜 = (a) => (ctx.activeFindings(a) || []).filter(진짜취약).length;
      const 정렬됨 = [...assets].sort((x, y) => (ctx.riskOf(y).level === "high") - (ctx.riskOf(x).level === "high") || 진짜(y) - 진짜(x));
      구획가져오기("취약점 있는 자산 — 심각도 순").assets.push(...정렬됨);
    } else {
      // 구획별로 묶고, 미조치 합이 큰 구획을 위로 — 급한 동네부터 보인다.
      for (const a of assets) 구획가져오기(구획열쇠(a)).assets.push(a);
    }

    // 방패 배치(2단계, 시안 §3·§4) — ctx.mode가 "all"이 아니면 숨긴다(좁히기 칩은 위험등급
    // 기준이라 방패와 결이 다르다). products/hardening이 없으면(구 호출자) 자동으로 빈 배열.
    const products = (ctx && ctx.products) || [];
    const hardening = (ctx && ctx.hardening) || [];
    const mode = ctx && ctx.mode;
    const showShields = !!((products.length || hardening.length) && (!mode || mode === "all"));
    if (showShields) {
      for (const p of products) {
        const owner = p.assetId ? assets.find((a) => a.id === p.assetId) : null;
        const k = owner ? 구획열쇠(owner) : "기타 — 대역 미상";
        구획가져오기(k).shields.push({ kind: "product", item: p });
      }
      for (const t of hardening) {
        구획가져오기(호스트구획열쇠(t.host)).shields.push({ kind: "hardening", item: t });
      }
    }
    // 총노드 — 군집 규칙의 전역 조건(시안 §5). 자산은 **보이는 것만**, 방패는 전체(구획을 안
    // 가리므로 필터 대상이 아니다).
    const 총노드 = assets.length + (showShields ? products.length + hardening.length : 0);

    const 정렬 = [...구획.entries()].map(([k, v]) => {
      const 합 = v.assets.reduce((s, a) => s + (ctx.activeFindings(a) || []).filter(진짜취약).length, 0);
      return { k, v, 합 };
    }).sort((x, y) => y.합 - x.합);

    // 구획 3개 초과면 미조치 1위 구획만 편다(신규 규칙) — 폴드상태가 null(자동)일 때만.
    let 자동확장 = null;
    if (폴드상태 === null && 정렬.length > 3) 자동확장 = 정렬[0] ? 정렬[0].k : null;

    container.innerHTML = "";
    for (const { k, v, 합 } of 정렬) {
      const 접힘 = 폴드상태 ? !폴드상태.has(k) : (자동확장 !== null && k !== 자동확장);
      const z = document.createElement("div");
      z.className = "mv-zone" + (접힘 ? " folded" : "");
      const h4 = document.createElement("h4");
      h4.innerHTML =
        '<span class="fold-ic">' + (접힘 ? "▸" : "▾") + "</span> " + esc(k) + " — 자산 <b>" + v.assets.length + "</b> · 미조치 <b>" + 합.toLocaleString() + "</b>" +
        (v.shields.length ? " · 🛡 <b>" + v.shields.length + "</b>" : "") +
        '<span class="fold-cnt">' + (접힘 ? "펼치려면 클릭" : "") + "</span>";
      h4.addEventListener("click", () => {
        if (폴드상태 === null) 폴드상태 = new Set(자동확장 !== null ? [자동확장] : 정렬.map((e) => e.k));
        if (폴드상태.has(k)) 폴드상태.delete(k); else 폴드상태.add(k);
        render(container, assets, ctx);
      });
      z.appendChild(h4);

      const t = document.createElement("div");
      t.className = "mv-tiles";
      if (!접힘) {
        // 구획 안에서도 큰 것부터 — 시선이 가는 순서와 위험 순서를 맞춘다.
        const sorted = [...v.assets].sort((x, y) =>
          (ctx.activeFindings(y) || []).filter(진짜취약).length - (ctx.activeFindings(x) || []).filter(진짜취약).length);
        let 보임 = sorted, 넘침 = [];
        if (군집규칙(총노드, sorted.length)) { 보임 = sorted.slice(0, 40); 넘침 = sorted.slice(40); }
        for (const a of 보임) {
          const el = 타일(a, ctx);
          el.addEventListener("click", () => {
            container.querySelectorAll(".mv-tile.mv-sel").forEach((x) => x.classList.remove("mv-sel"));
            el.classList.add("mv-sel");
            ctx.onDetail(a);
            // 선택을 셸에 알린다(2026-08-09 2단계) — 대화창 머리에 📌칩이 붙고,
            // "이거 취약점 몇 개야?"의 「이거」가 이 자산을 가리키게 된다.
            // ⚠ 여기(클릭)에서만 알린다 — 화면이 로드되며 자동으로 여는 상세(onDetail 직접 호출)는
            //   담당자가 고른 게 아니라서 선택으로 잡으면 안 붙어야 할 칩이 붙는다.
            // 전송 규격(top·길이 컷·해제 규칙)은 공용 부품 selectnotify.js 한 곳이 진다(2026-08-30
            // 이관 — 이 부품을 싣는 호스트는 analysis·inventory·vulnscan 셋 다 확인됨).
            // ⚠ 종전의 「top이 자기 자신이면 안 보낸다」 단독-팝업 예외 가드는 부품 계약이 금지한
            //   패턴이라 함께 걷었다(프로 팝업에서 선택이 죽는 부류 — selectioncontext.test가
            //   그 문자열 자체를 금지하므로 주석에도 원문을 안 적는다).
            const 이름 = a.displayName || a.name || "";
            if (이름) 선택알림({ label: 이름, text: "자산 " + 이름 });
          });
          t.appendChild(el);
        }
        if (넘침.length) {
          const cl = 군집타일(넘침, ctx);
          cl.addEventListener("click", () => { if (ctx.onClusterDetail) ctx.onClusterDetail(넘침); });
          t.appendChild(cl);
        }
        // 방패는 클러스터링하지 않는다 — 자산 화면이 대역별로 흩어지는 것과 달리 개수가 적다.
        for (const s of v.shields) {
          const el = 방패타일(s.kind, s.item);
          el.addEventListener("click", () => {
            container.querySelectorAll(".mv-tile.mv-sel").forEach((x) => x.classList.remove("mv-sel"));
            el.classList.add("mv-sel");
            if (ctx.onShieldDetail) ctx.onShieldDetail(s.kind, s.item);
            // 방패 선택도 같은 규격(selectnotify) — 기존 두 화면(products.html:769-777,
            // hardening.html:308)과 **같은 문법**, 새로 만들지 않는다. 호출은 위 선택알림() 하나로.
            if (s.kind === "product") {
              const meta = [s.item.vendor, s.item.model].filter(Boolean).join(" · ");
              선택알림({
                label: s.item.name, text: "보안제품 " + s.item.name,
                fields: { title: s.item.name + (meta ? " · " + meta : ""), asset: s.item.assetName || "", status: "" },
              });
            } else {
              선택알림({ label: s.item.label, text: "점검 대상 " + s.item.label, fields: { asset: s.item.label } });
            }
          });
          t.appendChild(el);
        }
      }
      z.appendChild(t);
      container.appendChild(z);
    }
    if (!정렬.length) {
      container.innerHTML = '<div style="color:var(--muted);padding:20px">조건에 맞는 자산이 없습니다</div>';
    }
  }

  /**
   * 등록 간선(2단계, 시안 §3·§9) — 보안제품↔자산(assetId 연결)을 잇는 실선.
   * ⚠ **🎯 공격경로 토글과 무관하게 항상** 그린다(방패가 보이는 조건이면) — drawPaths() 안에
   *   넣지 않는다(시안 §3 검토관 [중] 적발 재발 방지: 예전엔 pathsOn일 때만 불려 토글을 끄면
   *   등록 간선까지 함께 사라졌다). 하드닝 대상은 assetId가 없어 선을 안 긋는다(§3 — "이
   *   하드닝 대상=이 자산이다"를 화면이 추측하면 [6] "모르는 것은 칠하지 않는다"에 어긋난다).
   */
  function drawRegisteredEdges(container, ctx) {
    ctx = ctx || {};
    const products = ctx.products || [];
    const mode = ctx.mode;
    const showShields = !!((products.length || (ctx.hardening || []).length) && (!mode || mode === "all"));
    if (!showShields || !products.length) return;
    requestAnimationFrame(() => {
      const 이전 = container.querySelector(".mv-overlay-reg");
      if (이전) 이전.remove();
      const box = container.getBoundingClientRect();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "mv-overlay mv-overlay-reg");
      svg.setAttribute("width", box.width);
      svg.setAttribute("height", box.height);
      const 점 = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }; };
      let 그림 = 0;
      for (const p of products) {
        if (!p.assetId) continue;
        const 자산타일 = container.querySelector('.mv-tile[data-asset-id="' + CSS.escape(p.assetId) + '"]');
        const 방패엘 = container.querySelector('.mv-shield[data-shield-kind="product"][data-shield-id="' + CSS.escape(String(p.id)) + '"]');
        if (!자산타일 || !방패엘) continue; // 필터로 가려졌으면(구획 접힘 포함) 못 긋는다
        const a1 = 점(자산타일), a2 = 점(방패엘);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M " + a1.x + " " + a1.y + " L " + a2.x + " " + a2.y);
        path.setAttribute("class", "mv-edge mv-edge-reg");
        svg.appendChild(path);
        그림++;
      }
      if (그림) container.appendChild(svg);
    });
  }

  /** 공개 진입점 — 항상 이것을 부른다(renderZones를 직접 부르지 않는다).
   *  render = 구획·타일 그리기(renderZones) + 등록 간선 겹치기(drawRegisteredEdges). 후자를
   *  분리한 이유는 등록 간선이 **공격경로 오버레이(overlay(), pathsOn 토글 소관)와 다른 층**이라
   *  섞으면 토글을 끌 때 등록 간선까지 함께 지워지는 사고가 재발하기 때문(시안 §3). */
  function render(container, assets, ctx) {
    ctx = ctx || {};
    renderZones(container, assets, ctx);
    drawRegisteredEdges(container, ctx);
  }

  // 결재판 배지 — route-explain 실측 근거를 그대로 옮긴다(시안 §2). "yes"만 write:true 실측
  // 근거가 있고, 나머지는 결재판이 없거나(읽기) 데이터에 따라 뜰 수 있다("maybe").
  var BADGE = {
    none: { cls: "noappr", label: "결재판 없음" },
    yes: { cls: "appr", label: "결재판 있음" },
    maybe: { cls: "maybe", label: "승인 창이 뜰 수 있습니다" },
  };

  /**
   * 자산 상세판 칩 6종 — route-explain --no-build 실측 확정(시안 §2). ②는 예외표 재사용(새
   * 줄 아님, 문구 불변). ⑥⑦은 ctx.registered일 때만 — 등록된 Asset을 다루는 화면인지 스위치.
   * ⚠ **①③④⑤⑥⑦의 칩 문장은 표시 이름(displayName)이 아니라 등록 이름(a.name)으로 만든다.**
   *   dispatcher.ts:2024 listAssets().find(x => instructionText.includes(x.name) ||
   *   instructionText.includes(x.id))는 a.name/a.id만 보고 displayName은 아예 안 본다 —
   *   표시 이름은 담당자가 나중에 바꾸는 별칭이라(assets.ts:239 updateAssetDisplayName),
   *   칩 문장을 displayName으로 만들면 이름을 한 번이라도 바꾼 자산은 칩을 눌러도
   *   mentioned=undefined → assetIds:undefined(dispatcher.ts:2027)가 되어 범위 없는 전사
   *   리포트가 결재판 없이 생성된다(시안 §11 검토관 [상] 3차 적발). h3 제목·타일 이름표는
   *   여전히 사람이 읽을 displayName을 쓴다(detailHtml) — 칩 문장만 다르다.
   *   ② 만은 **예전 그대로 표시 이름**을 쓴다(guidance-destination.test.ts 예외표 문구가
   *   그 글자이고, ⑨-모델선택 경로라 dispatcher 이름 대조 위험이 없다 — 바꿀 이유가 없다).
   */
  function chipsForAsset(a, ctx) {
    ctx = ctx || {};
    const af = ctx.activeFindings ? (ctx.activeFindings(a) || []) : (a.findings || []);
    const real = af.filter(진짜취약);
    const 등록이름 = a.name;
    const 표시이름 = a.displayName || a.name;
    const rows = [];
    // ①④⑤⑥⑦ — 2026-09-13 route-explain --no-build 실측(시안 §2). 아래 이음매 꼴
    // (변수 + "…해줘")은 guidance-check.mjs:141-147이 ○○로 되살려 수확한다 — 이 꼴을
    // 그대로 유지해야 게시 관문이 이 칩들을 잰다.
    rows.push({ text: 등록이름 + " 취약점만 보여줘", badge: "none" });
    if (real.length > 0 && !a.owner) {
      rows.push({ text: 표시이름 + " 취약점 담당자 배정해줘", badge: "maybe" });
    }
    rows.push({ text: 등록이름 + " 재스캔 상태 알려줘", badge: "none" });
    rows.push({ text: 등록이름 + " 공격 경로 보여줘", badge: "none" });
    if (ctx.registered) {
      rows.push({ text: 등록이름 + " 조치 요청서 만들어줘", badge: "yes" });
      rows.push({ text: 등록이름 + " 취약점 리포트 만들어줘", badge: "none" });
    }
    return rows;
  }

  /** 우측 상세 패널 HTML — 클릭 한 번에 데이터, 행동은 전부 대화창으로. */
  function detailHtml(a, ctx) {
    ctx = ctx || {};
    const real = (ctx.activeFindings(a) || []).filter(진짜취약);
    const rk = ctx.riskOf(a);
    const 등급 = rk.level === "high" ? ["고위험", "rgba(229,72,77,.3)", "var(--red-ink, #ffd7d8)"]
      : rk.level === "mid" ? ["중위험", "rgba(240,160,32,.26)", "var(--amber-ink, #ffe9c4)"]
      : ["저위험", "rgba(70,167,88,.22)", "var(--teal-ink, #d2f2da)"];
    // 심각한 순 상위 3 — 전부 나열하면 목록 화면과 다를 게 없다.
    const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
    const top = [...real].sort((x, y) => (RANK[y.severity] || 0) - (RANK[x.severity] || 0)).slice(0, 3);
    const 이름 = a.displayName || a.name;
    let html =
      "<h3>" + esc(이름) + "</h3>" +
      '<div><span class="mv-rk" style="background:' + 등급[1] + ";color:" + 등급[2] + '">' + 등급[0] + "</span>" +
      (rk.kev ? '<span class="mv-rk" style="background:rgba(229,72,77,.4);color:var(--red-ink, #ffd7d8)">🔴 실제 악용 확인</span>' : "") + "</div>" +
      '<div class="mv-row"><div class="mv-lbl">미조치 취약점</div><b style="font-size:16px">' + real.length.toLocaleString() + "건</b></div>" +
      '<div class="mv-row"><div class="mv-lbl">담당</div>' +
      (a.owner ? esc(a.owner) : '<span style="color:var(--amber)">미지정 — 아래에서 바로 배정을 물을 수 있습니다</span>') + "</div>" +
      (top.length
        ? '<div class="mv-row"><div class="mv-lbl">먼저 볼 것</div>' + top.map((f) => '<div class="mv-item">· ' + esc(f.finding_type) + (f.plain ? '<div class="mv-plain">→ ' + boldify(esc(f.plain)) + "</div>" : "") + "</div>").join("") + "</div>"
        : "");
    // 🔗 연결된 보안장비(2단계, 시안 §3) — ctx.products가 주입됐을 때만(없으면 옛 동작
    // 그대로). "등록" 간선의 글로 된 짝 — SVG 선만으로는 배지("등록")를 못 보여준다.
    if (ctx.products) {
      const linked = ctx.products.filter((p) => p.assetId === a.id);
      html += '<div class="mv-row"><div class="mv-lbl">🔗 연결된 보안장비</div>' +
        (linked.length
          ? linked.map((p) => '<div class="mv-sub">🛡 ' + esc(p.name) + ' <span class="chiptag noappr">등록</span></div>').join("")
          : '<span class="mv-noedge">등록하면 나타납니다</span>') + "</div>";
    }
    html += '<div class="chiprow">' + chipsForAsset(a, ctx).map((c) => {
      const b = BADGE[c.badge] || BADGE.none;
      return '<div><button class="mv-ask" data-ask="' + esc(c.text) + '">💬 "' + esc(c.text) + '"</button>' +
        '<span class="chiptag ' + b.cls + '">' + b.label + "</span></div>";
    }).join("") + "</div>";
    html += '<div class="mv-hint">지시는 전부 대화창을 거칩니다 — 지도는 보기 전용입니다.</div>';
    return html;
  }

  /** 방패(보안제품·하드닝 대상) 상세판 — ③(하드닝)·⑧(보안제품) 칩 1개씩(시안 §2·§8).
   *  보호 관계는 선을 긋지 않고 .mv-noedge 빈 자리 문구로 정직하게 밝힌다(시안 §3). */
  function shieldDetailHtml(kind, item) {
    if (kind === "hardening") {
      // ⚠ 칩 문장은 item.label(한글 라벨)이 아니라 item.host(IP)로 만든다 — 하드닝 대상 찾기
      // 후보 정규식(agentloop.ts:3191-3197)은 IPv4/하이픈꼴만 후보로 뽑는다. 공백 섞인 한글
      // 라벨("코어 스위치" 등)은 후보가 안 돼 늘 자기 점검으로 확정된다(시안 §2 재적발).
      const 문장 = item.host + " 하드닝 점검 돌려줘";
      return (
        "<h3>🛡 " + esc(item.label) + "</h3>" +
        '<div class="mv-row"><div class="mv-lbl">기준</div>' + esc(String(item.standard || "").toUpperCase()) + "</div>" +
        '<div class="mv-row"><div class="mv-lbl">등록 상태</div>등록됨 <span class="chiptag noappr">등록</span></div>' +
        '<div class="mv-row"><div class="mv-lbl">연결된 자산</div><span class="mv-noedge">특정 자산과 연결하지 않습니다 — 대역(네트워크)에만 놓입니다</span></div>' +
        '<div class="chiprow"><div><button class="mv-ask" data-ask="' + esc(문장) + '">💬 "' + esc(문장) + '"</button>' +
        '<span class="chiptag maybe">승인 창이 뜰 수 있습니다</span></div></div>' +
        '<div class="mv-hint">지시는 전부 대화창을 거칩니다 — 지도는 보기 전용입니다.</div>'
      );
    }
    const 문장 = item.name + " 점검 일정 알려줘";
    return (
      "<h3>🛡 " + esc(item.name) + "</h3>" +
      '<div class="mv-row"><div class="mv-lbl">종류</div>' + esc(item.category || "") +
      (item.vendor ? (" · " + esc(item.vendor) + (item.model ? " " + esc(item.model) : "")) : "") + "</div>" +
      '<div class="mv-row"><div class="mv-lbl">연결 자산</div>' +
      (item.assetName ? ("🔗 " + esc(item.assetName) + ' <span class="chiptag noappr">등록</span>') : '<span class="mv-noedge">등록하면 나타납니다</span>') + "</div>" +
      '<div class="mv-row"><div class="mv-lbl">매뉴얼 문서</div>' + ((item.docs && item.docs.length) ? item.docs.length + "건" : "없음") + "</div>" +
      '<div class="chiprow"><div><button class="mv-ask" data-ask="' + esc(문장) + '">💬 "' + esc(문장) + '"</button>' +
      '<span class="chiptag noappr">결재판 없음</span></div></div>' +
      '<div class="mv-hint">지시는 전부 대화창을 거칩니다 — 지도는 보기 전용입니다.</div>'
    );
  }

  /** 군집 타일 상세판 — 넘친 자산 전체를 스크롤 목록으로. */
  function clusterDetailHtml(list, ctx) {
    ctx = ctx || {};
    const rows = [...list]
      .sort((x, y) => {
        if (!ctx.activeFindings) return 0;
        return (ctx.activeFindings(y) || []).filter(진짜취약).length - (ctx.activeFindings(x) || []).filter(진짜취약).length;
      })
      .map((a) => {
        const rk = ctx.riskOf ? ctx.riskOf(a) : { label: "" };
        return '<div class="mv-row" style="padding:4px 0"><b>' + esc(a.displayName || a.name) + "</b> · " + esc(rk.label || "") + (a.owner ? " · " + esc(a.owner) : " · 담당없음") + "</div>";
      }).join("");
    return "<h3>+" + list.length + "개 — 군집 펼침</h3>" + '<div style="overflow:auto;max-height:800px">' + rows + "</div>";
  }

  // ── 공격경로 겹층(2026-08-04, 시안 2단계) ──────────────────────────────────
  // 관제 허브의 공격경로(진입→거점→인접)를 지도 위에 화살표로 겹친다.
  // ⚠ **관측된 신호만 잇는다** — 경로 엔진(analysishub)이 3소스 상관으로 만든 것 그대로.
  //   지도가 새로 추정하는 것은 없다(추정을 얹으면 지도가 거짓말을 시작한다).
  function 자산타일찾기(container, assets, 이름) {
    const t = String(이름 || "").toLowerCase();
    if (!t) return null;
    const hit = assets.find((a) =>
      [a.name, a.displayName, a.hostname, a.ip].filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(t) || t.includes(String(s).toLowerCase())));
    if (!hit) return null;
    return container.querySelector('.mv-tile[data-asset-id="' + CSS.escape(hit.id) + '"]');
  }

  /**
   * 오버레이를 그린다. 호출 시점은 **타일 배치가 끝난 뒤**(requestAnimationFrame) —
   * flex 배치 전에 재면 좌표가 전부 0이 되어 화살표가 왼쪽 위에 뭉친다.
   */
  // ⚠ 인접 이동(lateral)을 **전부** 그리면 거미줄이 된다(2026-08-04 실화면: 40개 자산에
  //   화살표 125개 → 못 읽음). Shneiderman: 훑어보기는 깔끔해야 한다.
  //   그래서 진입(entry)만 항상 그리고, **인접은 고른 거점의 것만** 그린다(details-on-demand).
  //   focusEntity = 지금 상세 패널에 연 자산(있으면 그 자산의 인접 경로를 펼친다).
  function overlay(container, assets, paths, focusEntity) {
    const 이전 = container.querySelector(".mv-overlay:not(.mv-overlay-reg)");
    if (이전) 이전.remove();
    if (!paths || !paths.length) return 0;

    const box = container.getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mv-overlay");
    svg.setAttribute("width", box.width);
    svg.setAttribute("height", box.height);
    svg.innerHTML =
      '<defs><marker id="mvArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">' +
      '<path d="M0,0 L7,3.5 L0,7 Z" fill="#f5928a"/></marker>' +
      '<marker id="mvArrowB" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">' +
      '<path d="M0,0 L7,3.5 L0,7 Z" fill="#8fb8ff"/></marker></defs>';

    const 점 = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    };
    const 초점 = String(focusEntity || "").toLowerCase();
    let 그림 = 0;
    for (const p of paths) {
      const 거점 = 자산타일찾기(container, assets, p.entity);
      if (!거점) continue;   // 필터로 가려졌으면 그 경로는 그리지 않는다(없는 타일에 못 긋는다)
      거점.classList.add("mv-foothold");
      const 이거점을골랐나 = 초점 && String(p.entity).toLowerCase().includes(초점);
      const c = 점(거점);
      for (const s of p.steps || []) {
        if (s.kind === "entry") {
          // 진입 — 지도 밖(위)에서 거점으로 내리꽂는 붉은 화살표. **항상** 그린다(거점이 어디 뚫리나).
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", `M ${c.x - 34} ${Math.max(4, c.y - 46)} Q ${c.x - 10} ${c.y - 28} ${c.x} ${c.y - 12}`);
          path.setAttribute("class", "mv-edge mv-edge-entry");
          path.setAttribute("marker-end", "url(#mvArrow)");
          svg.appendChild(path); 그림++;
        } else if (s.kind === "lateral" && 이거점을골랐나) {
          // 인접 이동 — **고른 거점의 것만** 그린다(전부 그리면 거미줄이 된다).
          const 이웃 = 자산타일찾기(container, assets, s.entity);
          if (!이웃 || 이웃 === 거점) continue;
          const d = 점(이웃);
          const mx = (c.x + d.x) / 2, my = (c.y + d.y) / 2 - 26;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", `M ${c.x} ${c.y} Q ${mx} ${my} ${d.x} ${d.y}`);
          path.setAttribute("class", "mv-edge mv-edge-lateral");
          path.setAttribute("marker-end", "url(#mvArrowB)");
          svg.appendChild(path); 그림++;
        }
      }
    }
    if (그림) container.appendChild(svg);
    return 그림;
  }

  // ── 관제 4소스 히트맵(2026-08-04, 지형도 3단계 ㉮) ─────────────────────────
  // 관제 이벤트를 자산 × 소스(취약점·보안로그·운영리포트·하드닝) 격자로 집계한다.
  // ⚠ 상관(같은 자산이 두 소스 이상)은 **서버 correlations를 그대로 믿는다** —
  //   화면이 새로 계산하면 목록의 상관 판정과 어긋난다(로그 entity=공격자 IP 함정 때문에
  //   서버는 peers까지 봐서 묶는다. 화면이 entity만 보면 로그가 절대 안 묶인다).
  var HM_SOURCES = [["vuln", "🔍 취약점"], ["log", "📊 보안로그"], ["product", "🧰 운영리포트"], ["hardening", "🛡 하드닝"]];
  var HM_MAXROWS = 24; // 자산이 많으면 위험 큰 것부터 이만큼만(스크롤 없이 훑기)

  /**
   * @param events  data.events (source·entity·severity·peers·title)
   * @param correlations  data.correlations (서버 판정 — 이름 목록)
   * @param 표시이름  (entity)=>보기 좋은 이름. 없으면 entity 그대로.
   * 돌려주는 것: { rows: [{name, cells:[{count,max,corr}], total}], sources }
   */
  function heatmapData(events, correlations, 표시이름) {
    표시이름 = 표시이름 || ((s) => s);
    // 상관으로 묶인 이름(소문자)을 집합으로 — 서버가 이미 "2소스 이상"만 담아 준다.
    var 상관이름 = new Set();
    for (var c of correlations || []) 상관이름.add(String(c.entity || c.name || "").toLowerCase());
    // 자산(entity)별로 소스 건수·최고 심각도 집계. entity가 곧 우리 쪽 개체다(목록과 같은 키).
    var RANK = { critical: 4, high: 3, medium: 2, low: 1 };
    var by = new Map();
    for (var e of events || []) {
      // ⚠ **우리 쪽 개체**로 집계한다 — 로그 이벤트의 entity는 공격자 IP다(서버가 peers에
      //   대상 호스트를 실어 둔다). peers가 있으면 그것을, 없으면 entity를 쓴다.
      //   담당자가 찾는 것은 "누가 때렸나"가 아니라 "우리 어느 장비가 걸렸나"다.
      var key = String((e.peers && e.peers.length ? e.peers[0] : e.entity) || "").trim();
      if (!key) continue;
      var cur = by.get(key.toLowerCase()) || { name: 표시이름(key) || key, cnt: {}, max: {} };
      cur.cnt[e.source] = (cur.cnt[e.source] || 0) + 1;
      var r = RANK[String(e.severity || "").toLowerCase()] || 0;
      if (r > (cur.max[e.source] || 0)) cur.max[e.source] = r;
      by.set(key.toLowerCase(), cur);
    }
    var rows = [];
    for (var [k, v] of by) {
      var total = HM_SOURCES.reduce((s, [src]) => s + (v.cnt[src] || 0), 0);
      var corr = 상관이름.has(k);
      rows.push({
        name: v.name, total, corr,
        cells: HM_SOURCES.map(([src]) => ({ count: v.cnt[src] || 0, max: v.max[src] || 0, corr: corr })),
      });
    }
    // 상관 먼저, 그다음 건수 큰 순 — 가장 위험한 동네가 위로.
    rows.sort((a, b) => (b.corr - a.corr) || (b.total - a.total));
    return { rows: rows.slice(0, HM_MAXROWS), 전체행수: rows.length, sources: HM_SOURCES };
  }

  window.gijoMapView = {
    render, detailHtml, overlay, heatmapData, 진짜취약, 구획열쇠,
    호스트구획열쇠, 군집규칙, chipsForAsset, shieldDetailHtml, clusterDetailHtml,
    HM_SOURCES: HM_SOURCES,
  };
})();
