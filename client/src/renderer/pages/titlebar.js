// titlebar.js — C안(2026-07-25): OS 타이틀바 제거 후 각 페이지 상단 .header를 타이틀바로 승격.
// + 사용자 영역 통일(같은 날 사용자 결정 "모든 화면 동일하게 고정"): 아바타·풀네임·⚙·업데이트 알림을
//   **왼쪽 패널 하단**에 고정 배치 — Discord 좌하단 패턴(아바타+이름 왼쪽, 같은 줄 끝 ⚙).
//   · nav 화면(hub·approvals·redteam·sessions): .gn-sub(100vh 고정 사이드바) 하단
//   · dashboard: .explorer 컬럼 하단(sticky)
//   · login: 왼쪽 패널이 없어 우상단 투명 스트립의 ⚙만(예외)
// 타이틀바에서는 아바타·⚙·업데이트칩을 숨긴다(로고·시계·연결상태·세션·전체메뉴만 남음).
// 최상위 페이지(dashboard·hub·login·approvals·redteam·sessions)에만 로드. iframe(embed)에서는 no-op.
(function () {
  if (window.top !== window) return; // embed iframe — 타이틀바/사용자 영역은 상위 문서 몫
  if (new URLSearchParams(location.search).has("embed")) return;

  var BAR_H = 46; // main.ts titleBarOverlay.height와 반드시 일치

  // ── 스타일 ──────────────────────────────────────────────────────────────
  var css = [
    // 헤더 = 타이틀바(드래그). 높이는 페이지 자연값 유지(강제하면 밀도 높은 헤더가 줄바꿈 — 실측).
    // sticky: 스크롤해도 상단 고정(양 플랫폼 실증 버그 수정). overflow-x:clip 덕에 sticky 안 깨짐.
    ".header{position:sticky;top:0;z-index:850;background:var(--panel-2,#1f1e1d);-webkit-app-region:drag;",
    "padding-right:calc(100vw - env(titlebar-area-width,100vw) - env(titlebar-area-x,0px) + 12px);",
    "padding-left:calc(env(titlebar-area-x,0px) + 20px);}",
    ".header button,.header input,.header a,.header .icon-btn,.header .menu-btn,.header .avatar-btn,.header .status-pill,.header [data-page],.header select,#settingsBtn,.header .gijo-info{-webkit-app-region:no-drag;}",
    // 타이틀바에서 이동된 컨트롤 숨김(사용자 영역으로 이사)
    ".header #avatarBtn{display:none !important;}",
    ".header #updateChip{display:none !important;}",
    // 로그인 전용 스트립
    "#gijoTitlebarStrip{position:fixed;top:0;left:0;right:0;height:" + BAR_H + "px;-webkit-app-region:drag;z-index:800;display:flex;align-items:center;justify-content:flex-end;",
    "padding-right:calc(100vw - env(titlebar-area-width,100vw) - env(titlebar-area-x,0px) + 10px);}",
    // ⚙ 버튼 공통
    // 세션 칩(전 화면 공용, 2026-07-26 이관) — 남은 유휴 시간 표시 + 클릭 시 연장/관제 메뉴.
    ".gtb-sess{-webkit-app-region:no-drag;display:none;align-items:center;gap:5px;background:rgba(30,185,128,.14);border:1px solid rgba(30,185,128,.4);color:var(--teal,#1eb980);padding:3px 10px;border-radius:16px;font-size:12.25px;font-weight:800;cursor:pointer;position:relative;white-space:nowrap;}",
    ".gtb-sess-pop{position:absolute;top:26px;right:0;min-width:186px;background:#35342f;border:1px solid rgba(255,255,255,.16);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:6px;z-index:960;text-align:left;}",
    ".gtb-sess-mi{padding:8px 10px;border-radius:7px;font-size:12px;color:#e9e7e2;cursor:pointer;font-weight:700;}",
    ".gtb-sess-mi:hover{background:rgba(59,130,246,.12);}",
    ".gtb-sess-mi .sub{font-size:11.75px;color:#a49d95;font-weight:500;margin-top:2px;}",
    ".gtb-gear{-webkit-app-region:no-drag;width:28px;height:28px;border-radius:8px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);display:flex;align-items:center;justify-content:center;font-size:13px;color:#cfe0ff;cursor:pointer;position:relative;flex:0 0 auto;}",
    // ── 사용자 영역(왼쪽 패널 하단) ──
    ".gtb-userarea{border-top:1px solid rgba(255,255,255,.08);background:rgba(59,130,246,.05);padding:8px 10px;display:flex;flex-direction:column;gap:6px;z-index:60;}",
    // 세그먼트 [🏠 대시보드 | ☰ 전체메뉴] — Claude.ai 홈/Code 전환 패턴
    ".gtb-seg{display:flex;background:#1f1e1d;border:1px solid var(--border-strong,rgba(255,255,255,.16));border-radius:9px;padding:3px;gap:3px;}",
    ".gtb-seg span{flex:1;text-align:center;padding:6px 4px;border-radius:7px;font-size:12.25px;font-weight:800;color:var(--muted,#b3ada4);cursor:pointer;border:1px solid transparent;}",
    ".gtb-seg span.on{background:rgba(59,130,246,.22);color:#fff;border-color:rgba(59,130,246,.5);}",
    // 대시보드 '전체메뉴' 모드 패널
    ".gtb-menu-panel{padding:10px 8px;overflow-y:auto;}",
    ".gtb-menu-panel .mp-g{font-size:11.5px;font-weight:800;color:#a49d95;letter-spacing:1px;margin:10px 6px 4px;}",
    ".gtb-menu-panel .mp-i{padding:8px 12px;font-size:12.5px;font-weight:600;color:#b3ada4;border-radius:8px;cursor:pointer;margin-bottom:1px;}",
    ".gtb-menu-panel .mp-i:hover{background:rgba(59,130,246,.12);color:#fff;}",
    ".gtb-userarea .ua-upd{display:none;align-items:center;gap:5px;background:rgba(240,160,32,.15);border:1px solid rgba(240,160,32,.45);color:#f0a020;padding:3px 9px;border-radius:14px;font-size:12px;font-weight:800;cursor:pointer;align-self:flex-start;}",
    ".gtb-userarea .ua-row{display:flex;align-items:center;gap:8px;cursor:pointer;}",
    ".gtb-userarea .ua-avatar{width:26px;height:26px;border-radius:50%;background:var(--blue,#3b82f6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.25px;font-weight:800;flex:0 0 auto;}",
    ".gtb-userarea .ua-name{flex:1;font-size:12.5px;font-weight:700;color:#dfe6ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    // ⚙ 드롭다운(공통 — 위/아래 방향은 JS가 지정)
    ".gtb-menu{position:fixed;width:268px;background:#35342f;border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:8px;z-index:990;font-size:12.5px;-webkit-app-region:no-drag;}",
    ".gtb-menu .sec{font-size:11.75px;font-weight:800;color:#a49d95;letter-spacing:1px;padding:6px 10px 4px;}",
    ".gtb-menu .it{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:#e9e7e2;cursor:pointer;}",
    ".gtb-menu .it:hover{background:rgba(59,130,246,.12);}",
    ".gtb-menu .it .ic{width:16px;text-align:center;}",
    ".gtb-menu .it .kbd{margin-left:auto;font-size:11.75px;color:#a49d95;background:#1f1e1d;border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:1px 6px;}",
    ".gtb-menu .sep{height:1px;background:rgba(255,255,255,.08);margin:6px 4px;}",
    ".gtb-menu .zrow{display:flex;gap:5px;padding:4px 10px 8px;}",
    ".gtb-menu .z{flex:1;text-align:center;font-size:12px;font-weight:700;padding:6px 0;border-radius:7px;background:#1f1e1d;border:1px solid rgba(255,255,255,.08);color:#b3ada4;cursor:pointer;}",
    ".gtb-menu .z.on{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.6);color:#fff;}",
    ".gtb-menu .foot{padding:8px 10px 4px;font-size:12px;color:#a49d95;}",
  ].join("");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var authed = false;
  try { authed = window.gijo && window.gijo.isAuthenticated(); } catch (e) {}

  // ── 설정로 가는 주소는 여기 한 곳에서만 만든다 ────────────────────────────────
  // 4.0.0에서 허브를 걷어내 화면이 곧 주소가 됐다 — 딥링크(hub.html?g=…&t=…)가 필요 없다.
  // ⚠ 주소를 여기저기 흩어 두면 화면 구조가 바뀔 때 또 어긋난다(2026-07-28 실사고:
  //   업데이트를 눌러도 '내 설정'이 열렸다). 그래서 한 곳에 모아 둔다.
  var TAB_UPDATE = "settings.html?s=admin"; // 업데이트 패널은 관리자 구역에 있다
  var TAB_SETTINGS = "settings.html?s=ai";  // 쿼리 없는 옛 설정 링크의 흡수처(nav.js와 동일)

  // ── 업데이트 알림 상태 — 사용자 영역의 ⬆칩 + ⚙점 배지를 채운다 ──
  var updateInfo = null;
  var updateWatchers = []; // 영역 생성 후 반영할 콜백들
  if (authed) {
    (async function () {
      try {
        var r = await window.gijo.update.checkForUpdate();
        if (r && r.updateAvailable && r.latest) {
          updateInfo = { version: r.latest.version };
          updateWatchers.forEach(function (f) { f(); });
        }
      } catch (e) { /* 미응답 — 배지 없이 조용히 */ }
    })();
  }

  // ── ⚙ 드롭다운 (열림 방향: up | down) ──────────────────────────────────
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener("click", function (e) { if (menuEl && !menuEl.contains(e.target) && !(e.target.closest && e.target.closest(".gtb-gear,.ua-row"))) closeMenu(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenu();
    if (e.key === "F11") { e.preventDefault(); window.gijo.toggleFullscreen(); }
  });

  function item(ic, label, kbd, onClick) {
    var d = document.createElement("div");
    d.className = "it";
    d.innerHTML = '<span class="ic">' + ic + "</span>" + label + (kbd ? '<span class="kbd">' + kbd + "</span>" : "");
    if (onClick) d.addEventListener("click", function () { onClick(d); });
    return d;
  }
  function sec(t) { var d = document.createElement("div"); d.className = "sec"; d.textContent = t; return d; }
  function sep() { var d = document.createElement("div"); d.className = "sep"; return d; }

  async function openMenu(anchorEl, dir) {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "gtb-menu";
    var r = anchorEl.getBoundingClientRect();
    if (dir === "up") {
      menuEl.style.left = Math.max(8, r.left) + "px";
      menuEl.style.bottom = (window.innerHeight - r.top + 6) + "px";
    } else {
      menuEl.style.right = Math.max(8, window.innerWidth - r.right) + "px";
      menuEl.style.top = (r.bottom + 6) + "px";
    }

    menuEl.appendChild(sec("화면"));
    var zrow = document.createElement("div");
    zrow.className = "zrow";
    menuEl.appendChild(zrow);
    try {
      var z = await window.gijo.getUiZoom();
      z.steps.forEach(function (s) {
        var b = document.createElement("span");
        b.className = "z" + (Math.abs(s - z.zoom) < 0.001 ? " on" : "");
        b.textContent = Math.round(s * 100);
        b.addEventListener("click", async function () {
          await window.gijo.setUiZoom(s);
          zrow.querySelectorAll(".z").forEach(function (el) { el.classList.remove("on"); });
          b.classList.add("on");
        });
        zrow.appendChild(b);
      });
    } catch (e) { zrow.textContent = "배율 조회 실패"; }
    // 단축키 라벨 플랫폼 분기 — 동작은 공통, 표기만 관례에 맞춘다.
    var isMac = navigator.platform.indexOf("Mac") === 0;
    menuEl.appendChild(item("➕", "확대", isMac ? "⌘ +" : "Ctrl +", function () { window.gijo.stepUiZoom(1); }));
    menuEl.appendChild(item("➖", "축소", isMac ? "⌘ −" : "Ctrl −", function () { window.gijo.stepUiZoom(-1); }));
    menuEl.appendChild(item("🖥", "전체 화면 (관제 모드)", isMac ? "⌃⌘F" : "F11", function () { window.gijo.toggleFullscreen(); closeMenu(); }));
    // 창 배치 — 가로/세로 절반(2026-07-26 사용자 요청: 전체적으로). 어느 창(대시보드·사무실·분리창)에서
    // 열어도 자기 창이 움직인다. 세로는 세로(피벗) 모니터가 있으면 그 모니터로 간다.
    if (window.gijo.setPopoutOrientation) {
      menuEl.appendChild(item("↔", "이 창을 가로 절반으로", "", function () { window.gijo.setPopoutOrientation("landscape"); closeMenu(); }));
      menuEl.appendChild(item("↕", "이 창을 세로 절반으로", "세로 모니터", function () { window.gijo.setPopoutOrientation("portrait"); closeMenu(); }));
    }

    if (authed) {
      menuEl.appendChild(sep());
      menuEl.appendChild(sec("연결"));
      var server = "";
      try { server = String(await window.gijo.getServerUrl()).replace(/^https?:\/\//, ""); } catch (e) {}
      var sv = item("🔗", '<span style="color:#b3ada4">연동 서버</span>', server || "-", null);
      sv.style.cursor = "default";
      menuEl.appendChild(sv);
      menuEl.appendChild(item("🔁", "서버 변경…", "", async function () {
        try { await window.gijo.logout(); } catch (e) {}
        window.gijo.navigateTo("login.html");
      }));
      menuEl.appendChild(item("🚪", "로그아웃", "", async function () {
        try { await window.gijo.logout(); } catch (e) {}
        window.gijo.navigateTo("login.html");
      }));
    }

    menuEl.appendChild(sep());
    menuEl.appendChild(sec("클라이언트"));
    var ver = "";
    try { ver = await window.gijo.update.currentVersion(); } catch (e) {}
    if (authed) {
      if (updateInfo) {
        var up = item("⬆", "새 버전 설치 가능", "v" + updateInfo.version, function () {
          window.gijo.navigateTo(TAB_UPDATE);
        });
        up.style.background = "rgba(240,160,32,.12)";
        up.style.border = "1px solid rgba(240,160,32,.4)";
        menuEl.appendChild(up);
      } else {
        menuEl.appendChild(item("🔄", "업데이트 확인", ver ? "v" + ver : "", function () {
          window.gijo.navigateTo(TAB_UPDATE);
        }));
      }
      menuEl.appendChild(item("⚙", "제품 설정 열기", "", function () {
        window.gijo.navigateTo(TAB_SETTINGS);
      }));
    }
    menuEl.appendChild(item("📋", "진단 정보 복사", "", async function (el) {
      try {
        var info = await window.gijo.getAppInfo();
        var srv = "";
        try { srv = String(await window.gijo.getServerUrl()); } catch (e) {}
        var zz = 1;
        try { zz = (await window.gijo.getUiZoom()).zoom; } catch (e) {}
        var txt = [
          "GIJO AS 진단 정보 (" + new Date().toLocaleString("ko-KR") + ")",
          "클라이언트: v" + info.version + " · Electron " + info.electron,
          "OS: " + info.platform + " " + info.osRelease + " (" + info.arch + ")",
          "연동 서버: " + (srv || "(미연결)"),
          "화면 배율: " + Math.round(zz * 100) + "%",
        ].join("\n");
        await navigator.clipboard.writeText(txt);
        el.innerHTML = '<span class="ic">✅</span>복사됨';
        setTimeout(closeMenu, 700);
      } catch (e) { el.innerHTML = '<span class="ic">⚠</span>복사 실패'; }
    }));
    menuEl.appendChild(item("♻️", "앱 재시작", "", function () { window.gijo.restartApp(); }));
    menuEl.appendChild(sep());
    var foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "GIJO AS Desktop" + (ver ? " · v" + ver : "") + " · © 2026 GIJO Technology";
    menuEl.appendChild(foot);

    document.body.appendChild(menuEl);
  }

  // ── 대시보드 '전체메뉴' 패널 전환(①안: 화면 이동 없이 패널만 교체) ─────────
  // 메뉴는 nav.js의 공용 렌더러(window.gijoRenderMenu, 단일 소스)로 그린다 — 복사본 폐기(2026-07-25).
  var dashMenuMode = false;
  function toggleDashPanel(toMenu, segEls) {
    var exp = document.querySelector(".explorer");
    if (!exp) return;
    dashMenuMode = toMenu;
    // 탐색기 콘텐츠 숨김/복원 (세그먼트·사용자 영역·메뉴패널 제외)
    [].forEach.call(exp.children, function (ch) {
      if (ch.classList.contains("gtb-userarea") || ch.classList.contains("gtb-menu-panel") || ch.classList.contains("gtb-seg-wrap")) return;
      ch.style.display = toMenu ? "none" : "";
    });
    var mp = exp.querySelector(".gtb-menu-panel");
    if (toMenu) {
      if (!mp) {
        mp = document.createElement("div");
        mp.className = "gtb-menu-panel";
        exp.insertBefore(mp, exp.querySelector(".gtb-userarea"));
      }
      // 진짜 nav 메뉴를 렌더(현재 화면=대시보드가 자동 강조됨)
      if (window.gijoRenderMenu) window.gijoRenderMenu(mp);
      else mp.textContent = "메뉴 로딩 중…";
      mp.style.display = "";
    } else if (mp) { mp.style.display = "none"; }
    if (segEls) { segEls.home.classList.toggle("on", !toMenu); segEls.menu.classList.toggle("on", toMenu); }
  }

  // ── 대시보드 상단 세그먼트 [🧭 탐색기 | ☰ 전체메뉴] (nav 화면은 nav.js가 세그먼트 렌더) ──
  function buildDashSegment() {
    var wrap = document.createElement("div");
    wrap.className = "gtb-seg-wrap";
    var seg = document.createElement("div");
    seg.className = "gtb-seg";
    var sHome = document.createElement("span"); sHome.textContent = "🧭 탐색기"; sHome.classList.add("on");
    var sMenu = document.createElement("span"); sMenu.textContent = "☰ 전체메뉴";
    seg.appendChild(sHome); seg.appendChild(sMenu);
    wrap.appendChild(seg);
    // 접기/열기는 가장자리 세로 탭으로 통일(2026-07-25) — 헤더 버튼 없음. nav.js가 탭 관리.
    sHome.addEventListener("click", function () { if (dashMenuMode) toggleDashPanel(false, { home: sHome, menu: sMenu }); });
    sMenu.addEventListener("click", function () { if (!dashMenuMode) toggleDashPanel(true, { home: sHome, menu: sMenu }); });
    return wrap;
  }

  // ── 사용자 영역 생성 — [⬆업데이트] / [아바타][풀네임][⚙] (세그먼트는 별도) ──
  function buildUserArea() {
    var area = document.createElement("div");
    area.className = "gtb-userarea";
    var upd = document.createElement("div");
    upd.className = "ua-upd";
    upd.addEventListener("click", function () { window.gijo.navigateTo(TAB_UPDATE); });
    area.appendChild(upd);
    var row = document.createElement("div");
    row.className = "ua-row";
    var av = document.createElement("span"); av.className = "ua-avatar"; av.textContent = "-";
    var nm = document.createElement("span"); nm.className = "ua-name"; nm.textContent = "";
    var gear = document.createElement("span"); gear.className = "gtb-gear"; gear.textContent = "⚙";
    gear.title = "클라이언트 메뉴 — 배율·전체화면·서버·업데이트";
    row.appendChild(av); row.appendChild(nm); row.appendChild(gear);
    area.appendChild(row);
    row.addEventListener("click", function (e) { e.stopPropagation(); if (menuEl) closeMenu(); else openMenu(gear, "up"); });
    // 풀네임 — 로그인 사용자 표시 이름
    if (authed) {
      (async function () {
        try {
          var u = await window.gijo.me();
          var name = (u && (u.displayName || u.username)) || "-";
          nm.textContent = name;
          av.textContent = name.charAt(0);
          row.title = name;
        } catch (e) { nm.textContent = "-"; }
      })();
    } else { nm.textContent = "로그인 전"; }
    // 업데이트 반영(즉시 or 나중에 도착)
    var applyUpd = function () {
      if (!updateInfo) return;
      upd.textContent = "⬆ 업데이트 v" + updateInfo.version;
      upd.style.display = "inline-flex";
      if (!gear.querySelector(".gtb-dot")) {
        var dot = document.createElement("span");
        dot.className = "gtb-dot";
        dot.style.cssText = "position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#f0a020;border:2px solid #1f1e1d;";
        gear.appendChild(dot);
      }
    };
    applyUpd();
    updateWatchers.push(applyUpd);
    return area;
  }

  // ── 세션 칩 — 전 화면 공용(2026-07-26 이관: 예전엔 dashboard.html에만 있어 다른 화면엔 안 보였다) ──
  // 유휴 만료까지 남은 시간을 초 단위로 보여주고, 클릭하면 [세션 연장 30분 / 관제(계속)]을 고른다.
  // 관제 모드는 5분마다 자동 연장(대형 모니터 상시 표시용) — 보안상 앱 재시작 시 해제(영속 안 함).
  var sessMonitor = false, sessTimer = null, sessChip = null, sessTimeEl = null, sessPop = null;

  function renderSessChip() {
    if (!sessChip) return;
    if (!window.gijo || !window.gijo.sessionActivity || !window.gijo.isAuthenticated || !window.gijo.isAuthenticated()) {
      sessChip.style.display = "none"; return;
    }
    if (sessMonitor) {
      sessTimeEl.textContent = "관제(계속)";
      sessChip.style.background = "rgba(139,124,240,.16)";
      sessChip.style.borderColor = "rgba(139,124,240,.5)";
      sessChip.style.color = "#8b7cf0";
      sessChip.style.display = "inline-flex";
      return;
    }
    var info; try { info = window.gijo.sessionActivity(); } catch (e) { return; }
    var ms = Math.max(0, info.remainingMs);
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    sessTimeEl.textContent = m + ":" + String(s).padStart(2, "0");
    var rgb = ms > 300000 ? "30,185,128" : ms > 120000 ? "240,160,32" : "226,72,61";
    var col = ms > 300000 ? "#1eb980" : ms > 120000 ? "#f0a020" : "#e2483d";
    sessChip.style.background = "rgba(" + rgb + ",.14)";
    sessChip.style.borderColor = "rgba(" + rgb + ",.4)";
    sessChip.style.color = col;
    sessChip.style.display = "inline-flex";
  }

  function setSessMonitor(on) {
    sessMonitor = on;
    if (sessTimer) { clearInterval(sessTimer); sessTimer = null; }
    if (on) {
      window.gijo.extendSession().catch(function () {});
      sessTimer = setInterval(function () { window.gijo.extendSession().catch(function () {}); }, 300000);
    }
    renderSessChip();
  }

  function mountSessChip() {
    var hdr = document.querySelector(".header");
    if (!hdr || document.querySelector(".gtb-sess")) return;
    // 대시보드에 이미 자체 칩(#sessionChip)이 있으면 그걸 쓰고 공용은 만들지 않는다(중복 방지).
    if (document.getElementById("sessionChip")) return;
    // 순서 통일(2026-07-26): 대시보드와 동일하게 [서버 연결상태] → [세션] 순으로 놓는다.
    // 연결상태 칩 바로 뒤에 붙이고, 없으면 우측 영역 끝에.
    var right = hdr.querySelector(".header-right") || hdr.lastElementChild || hdr;
    var statusPill = hdr.querySelector("#statusPill, .status-pill");
    sessChip = document.createElement("div");
    sessChip.className = "gtb-sess";
    sessChip.title = "남은 세션 시간 — 마우스·키보드를 쓰면 자동 연장. 클릭하면 연장/관제 선택";
    sessChip.innerHTML = '⏳ 세션 <span class="t">--:--</span> <span style="opacity:.7">▾</span>';
    sessTimeEl = sessChip.querySelector(".t");
    if (statusPill && statusPill.parentNode) statusPill.parentNode.insertBefore(sessChip, statusPill.nextSibling);
    else right.appendChild(sessChip);

    var closePop = function () { if (sessPop) { sessPop.remove(); sessPop = null; } };
    document.addEventListener("click", function (e) {
      if (sessPop && !sessPop.contains(e.target) && !sessChip.contains(e.target)) closePop();
    });
    sessChip.addEventListener("click", function () {
      if (sessPop) { closePop(); return; }
      sessPop = document.createElement("div");
      sessPop.className = "gtb-sess-pop";
      var mk = function (label, sub, fn) {
        var d = document.createElement("div");
        d.className = "gtb-sess-mi";
        d.innerHTML = label + (sub ? '<div class="sub">' + sub + "</div>" : "");
        d.addEventListener("click", function (e) { e.stopPropagation(); fn(); closePop(); });
        return d;
      };
      sessPop.appendChild(mk("⏳ 세션 연장(30분)", "지금부터 30분으로 재설정", function () {
        window.gijo.extendSession()
          .then(function () { sessTimeEl.textContent = "연장됨 ✓"; setTimeout(renderSessChip, 1200); })
          .catch(function () { sessTimeEl.textContent = "연장 실패"; setTimeout(renderSessChip, 1500); });
      }));
      sessPop.appendChild(sessMonitor
        ? mk("⏹ 관제 종료", "일반 세션(30분 유휴 만료)으로 복귀", function () { setSessMonitor(false); })
        : mk("🖥 관제(계속)", "만료 없이 유지 — 관제 모니터용, 앱 종료까지", function () { setSessMonitor(true); }));
      sessChip.appendChild(sessPop);
    });
    renderSessChip();
    setInterval(renderSessChip, 1000);
  }

  // ── 마운트 — 화면 유형별 왼쪽 패널 ─────────────────────────────────────
  function mountUserArea() {
    if (document.querySelector(".gtb-userarea")) return true;
    // nav 화면: #gijoNav는 flex 컬럼(gn-top·gn-mid). 사용자 영역을 마지막 flex 자식으로.
    var navRoot = document.getElementById("gijoNav");
    if (navRoot && navRoot.querySelector(".gn-mid")) {
      var a = buildUserArea();
      a.style.cssText += "flex:0 0 auto;";
      navRoot.appendChild(a);
      return true;
    }
    // dashboard: .explorer를 100vh 고정 컬럼으로 — 세그먼트(sticky top)·탐색기/메뉴(scroll)·사용자(sticky bottom).
    var exp = document.querySelector(".explorer");
    if (exp) {
      exp.style.cssText += "position:sticky;top:0;height:100vh;overflow-y:auto;";
      var seg = buildDashSegment();
      seg.style.cssText = "position:sticky;top:0;z-index:6;background:var(--panel-2,#1f1e1d);margin:-18px -12px 10px;padding:8px 12px;border-bottom:1px solid var(--border);";
      exp.insertBefore(seg, exp.firstChild);
      var a2 = buildUserArea();
      a2.style.cssText += "position:sticky;bottom:0;margin:12px -12px -18px;background:#1f1e1d;";
      exp.appendChild(a2);
      return true;
    }
    return false;
  }

  function afterMount() {
    mountSessChip(); // 세션 칩(전 화면 공용)
    // 타이틀바의 기존 ⚙(진짜 기어만) 숨김 — 사용자 영역으로 이사 완료
    var oldGear = document.getElementById("settingsBtn");
    if (oldGear && oldGear.textContent.trim() === "⚙") oldGear.style.display = "none";
  }

  var navRoot = document.getElementById("gijoNav");
  if (navRoot || document.querySelector(".explorer")) {
    // nav.js는 titlebar.js보다 늦게(또는 재렌더로) .gn-mid를 만들 수 있다 — 관찰자를 먼저 걸고
    // 지금도 한 번 시도한다. 재렌더(root.innerHTML='')로 사라져도 자동 재마운트.
    if (mountUserArea()) afterMount();
    if (navRoot) {
      new MutationObserver(function () { if (mountUserArea()) afterMount(); }).observe(navRoot, { childList: true, subtree: false });
    }
  } else {
    // 왼쪽 패널이 없는 화면(login) — 우상단 스트립의 ⚙만(예외)
    var strip = document.createElement("div");
    strip.id = "gijoTitlebarStrip";
    var g = document.createElement("div");
    g.className = "gtb-gear";
    g.textContent = "⚙";
    g.addEventListener("click", function (e) { e.stopPropagation(); if (menuEl) closeMenu(); else openMenu(g, "down"); });
    strip.appendChild(g);
    document.body.appendChild(strip);
  }
})();
