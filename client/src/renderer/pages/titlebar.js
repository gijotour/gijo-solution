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
    ".header{position:sticky;top:0;z-index:850;background:var(--panel-2,#0e1526);-webkit-app-region:drag;",
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
    ".gtb-gear{-webkit-app-region:no-drag;width:28px;height:28px;border-radius:8px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);display:flex;align-items:center;justify-content:center;font-size:13px;color:#cfe0ff;cursor:pointer;position:relative;flex:0 0 auto;}",
    // ── 사용자 영역(왼쪽 패널 하단) ──
    ".gtb-userarea{border-top:1px solid rgba(255,255,255,.08);background:rgba(59,130,246,.05);padding:8px 10px;display:flex;flex-direction:column;gap:6px;z-index:60;}",
    ".gtb-userarea .ua-upd{display:none;align-items:center;gap:5px;background:rgba(240,160,32,.15);border:1px solid rgba(240,160,32,.45);color:#f0a020;padding:3px 9px;border-radius:14px;font-size:10.5px;font-weight:800;cursor:pointer;align-self:flex-start;}",
    ".gtb-userarea .ua-row{display:flex;align-items:center;gap:8px;cursor:pointer;}",
    ".gtb-userarea .ua-avatar{width:26px;height:26px;border-radius:50%;background:var(--blue,#3b82f6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:0 0 auto;}",
    ".gtb-userarea .ua-name{flex:1;font-size:11.5px;font-weight:700;color:#dfe6ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    // ⚙ 드롭다운(공통 — 위/아래 방향은 JS가 지정)
    ".gtb-menu{position:fixed;width:268px;background:#151d33;border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:8px;z-index:990;font-size:12.5px;-webkit-app-region:no-drag;}",
    ".gtb-menu .sec{font-size:10px;font-weight:800;color:#5f6785;letter-spacing:1px;padding:6px 10px 4px;}",
    ".gtb-menu .it{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;color:#e7eaf3;cursor:pointer;}",
    ".gtb-menu .it:hover{background:rgba(59,130,246,.12);}",
    ".gtb-menu .it .ic{width:16px;text-align:center;}",
    ".gtb-menu .it .kbd{margin-left:auto;font-size:10px;color:#5f6785;background:#0e1526;border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:1px 6px;}",
    ".gtb-menu .sep{height:1px;background:rgba(255,255,255,.08);margin:6px 4px;}",
    ".gtb-menu .zrow{display:flex;gap:5px;padding:4px 10px 8px;}",
    ".gtb-menu .z{flex:1;text-align:center;font-size:10.5px;font-weight:700;padding:6px 0;border-radius:7px;background:#0e1526;border:1px solid rgba(255,255,255,.08);color:#8b93ab;cursor:pointer;}",
    ".gtb-menu .z.on{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.6);color:#fff;}",
    ".gtb-menu .foot{padding:8px 10px 4px;font-size:10.5px;color:#5f6785;}",
  ].join("");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  var authed = false;
  try { authed = window.gijo && window.gijo.isAuthenticated(); } catch (e) {}

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

    if (authed) {
      menuEl.appendChild(sep());
      menuEl.appendChild(sec("연결"));
      var server = "";
      try { server = String(await window.gijo.getServerUrl()).replace(/^https?:\/\//, ""); } catch (e) {}
      var sv = item("🔗", '<span style="color:#8b93ab">연동 서버</span>', server || "-", null);
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
          window.gijo.navigateTo("hub.html?g=settings&t=update.html");
        });
        up.style.background = "rgba(240,160,32,.12)";
        up.style.border = "1px solid rgba(240,160,32,.4)";
        menuEl.appendChild(up);
      } else {
        menuEl.appendChild(item("🔄", "업데이트 확인", ver ? "v" + ver : "", function () {
          window.gijo.navigateTo("hub.html?g=settings&t=update.html");
        }));
      }
      menuEl.appendChild(item("⚙", "제품 설정 열기", "", function () {
        window.gijo.navigateTo("hub.html?g=settings&t=settings.html");
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

  // ── 사용자 영역 생성 — [⬆업데이트] / [아바타][풀네임][⚙] (Discord 좌하단 패턴) ──
  function buildUserArea() {
    var area = document.createElement("div");
    area.className = "gtb-userarea";
    var upd = document.createElement("div");
    upd.className = "ua-upd";
    upd.addEventListener("click", function () { window.gijo.navigateTo("hub.html?g=settings&t=update.html"); });
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
        dot.style.cssText = "position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#f0a020;border:2px solid #0e1526;";
        gear.appendChild(dot);
      }
    };
    applyUpd();
    updateWatchers.push(applyUpd);
    return area;
  }

  // ── 마운트 — 화면 유형별 왼쪽 패널 하단 ─────────────────────────────────
  function mountUserArea() {
    if (document.querySelector(".gtb-userarea")) return true;
    var sub = document.querySelector("#gijoNav .gn-sub");
    if (sub) {
      // nav 사이드바(100vh 고정): absolute로 하단 고정
      sub.style.position = "relative";
      var a = buildUserArea();
      a.style.cssText += "position:absolute;bottom:0;left:0;right:0;";
      sub.appendChild(a);
      return true;
    }
    var exp = document.querySelector(".explorer");
    if (exp) {
      // dashboard 왼쪽 컬럼: sticky bottom — 스크롤과 무관하게 하단에 붙는다
      var a2 = buildUserArea();
      a2.style.cssText += "position:sticky;bottom:0;margin:12px -12px 0;background:#0e1526;";
      exp.appendChild(a2);
      return true;
    }
    return false;
  }

  function afterMount() {
    // 타이틀바의 기존 ⚙(진짜 기어만) 숨김 — 사용자 영역으로 이사 완료
    var oldGear = document.getElementById("settingsBtn");
    if (oldGear && oldGear.textContent.trim() === "⚙") oldGear.style.display = "none";
  }

  var navRoot = document.getElementById("gijoNav");
  if (navRoot || document.querySelector(".explorer")) {
    // nav.js는 titlebar.js보다 늦게(또는 재렌더로) .gn-sub를 만들 수 있다 — 관찰자를 먼저 걸고
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
