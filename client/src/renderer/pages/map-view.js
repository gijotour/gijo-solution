// map-view.js — 보안 지형도: 자산을 「지도 한 장」으로 (2026-08-04, 시안 security-map-v1 승인)
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
(function () {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /** 서버 isRealVulnerability와 같은 잣대(agenttools.ts) — 이름으로는 거르지 않는다. */
  function 진짜취약(f) {
    return f.state !== "fixed" && f.finding_type !== "scan_error" && f.severity !== "info";
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

  function render(container, assets, ctx) {
    // 구획별로 묶고, 미조치 합이 큰 구획을 위로 — 급한 동네부터 보인다.
    const 구획 = new Map();
    for (const a of assets) {
      const k = 구획열쇠(a);
      if (!구획.has(k)) 구획.set(k, []);
      구획.get(k).push(a);
    }
    const 정렬 = [...구획.entries()].map(([k, list]) => {
      const 합 = list.reduce((s, a) => s + (ctx.activeFindings(a) || []).filter(진짜취약).length, 0);
      return { k, list, 합 };
    }).sort((x, y) => y.합 - x.합);

    container.innerHTML = "";
    for (const { k, list, 합 } of 정렬) {
      const z = document.createElement("div");
      z.className = "mv-zone";
      z.innerHTML = '<h4>' + esc(k) + ' — 자산 <b>' + list.length + '</b> · 미조치 <b>' + 합.toLocaleString() + "</b></h4>";
      const t = document.createElement("div");
      t.className = "mv-tiles";
      // 구획 안에서도 큰 것부터 — 시선이 가는 순서와 위험 순서를 맞춘다.
      const sorted = [...list].sort((x, y) =>
        (ctx.activeFindings(y) || []).filter(진짜취약).length - (ctx.activeFindings(x) || []).filter(진짜취약).length);
      for (const a of sorted) {
        const el = 타일(a, ctx);
        el.addEventListener("click", () => {
          container.querySelectorAll(".mv-tile.mv-sel").forEach((x) => x.classList.remove("mv-sel"));
          el.classList.add("mv-sel");
          ctx.onDetail(a);
        });
        t.appendChild(el);
      }
      z.appendChild(t);
      container.appendChild(z);
    }
    if (!정렬.length) {
      container.innerHTML = '<div style="color:var(--muted);padding:20px">조건에 맞는 자산이 없습니다</div>';
    }
  }

  /** 우측 상세 패널 HTML — 클릭 한 번에 데이터, 행동은 전부 대화창으로. */
  function detailHtml(a, ctx) {
    const real = (ctx.activeFindings(a) || []).filter(진짜취약);
    const rk = ctx.riskOf(a);
    const 등급 = rk.level === "high" ? ["고위험", "rgba(229,72,77,.3)", "#ffd7d8"]
      : rk.level === "mid" ? ["중위험", "rgba(240,160,32,.26)", "#ffe9c4"]
      : ["저위험", "rgba(70,167,88,.22)", "#d2f2da"];
    // 심각한 순 상위 3 — 전부 나열하면 목록 화면과 다를 게 없다.
    const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
    const top = [...real].sort((x, y) => (RANK[y.severity] || 0) - (RANK[x.severity] || 0)).slice(0, 3);
    const 이름 = a.displayName || a.name;
    return (
      "<h3>" + esc(이름) + "</h3>" +
      '<div><span class="mv-rk" style="background:' + 등급[1] + ";color:" + 등급[2] + '">' + 등급[0] + "</span>" +
      (rk.kev ? '<span class="mv-rk" style="background:rgba(229,72,77,.4);color:#ffd7d8">🔴 실제 악용 확인</span>' : "") + "</div>" +
      '<div class="mv-row"><div class="mv-lbl">미조치 취약점</div><b style="font-size:16px">' + real.length.toLocaleString() + "건</b></div>" +
      '<div class="mv-row"><div class="mv-lbl">담당</div>' +
      (a.owner ? esc(a.owner) : '<span style="color:var(--amber)">미지정 — 아래에서 바로 배정을 물을 수 있습니다</span>') + "</div>" +
      (top.length
        ? '<div class="mv-row"><div class="mv-lbl">먼저 볼 것</div>' + top.map((f) => "· " + esc(f.finding_type)).join("<br>") + "</div>"
        : "") +
      // ⚠ 안내하는 말은 **결정적으로 걸리는 말만** 적는다(2026-08-04 안내 문구 전수 점검 원칙).
      '<button class="mv-ask" data-ask="' + esc(이름) + ' 자산 취약점 알려줘">💬 "' + esc(이름) + ' 자산 취약점 알려줘"</button>' +
      (real.length && !a.owner
        ? '<button class="mv-ask" data-ask="' + esc(이름) + ' 취약점 담당자 배정해줘">💬 담당자 배정 묻기 — 승인 후 실행</button>'
        : "") +
      '<div class="mv-hint">지시는 전부 대화창을 거칩니다 — 지도는 보기 전용입니다.</div>'
    );
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
    const 이전 = container.querySelector(".mv-overlay");
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

  window.gijoMapView = { render, detailHtml, overlay, 진짜취약, 구획열쇠 };
})();
