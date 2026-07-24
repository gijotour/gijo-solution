// titlebar.js — C안(2026-07-25): OS 타이틀바 제거 후 각 페이지 상단 .header를 타이틀바로 승격.
// 최상위 페이지(dashboard·hub·login·approvals·redteam·sessions)에만 로드한다.
// iframe(허브 탭 embed)에서는 아무것도 하지 않는다 — 타이틀바는 창에 하나면 된다.
//
// 하는 일 3가지:
//  ① .header를 드래그 영역화(-webkit-app-region) + OS 창 컨트롤(─ ▢ ✕) 자리 확보(env(titlebar-area-*))
//  ② 기존 ⚙(#settingsBtn)을 "클라이언트 메뉴" 드롭다운으로 교체 — 배율·전체화면·서버·업데이트·진단·재시작
//  ③ F11 전체화면 단축키. .header가 없는 페이지(login)는 46px 투명 스트립을 만들어 드래그만 제공.
(function () {
  if (window.top !== window) return; // embed iframe — 창의 타이틀바는 상위 문서 몫
  if (new URLSearchParams(location.search).has("embed")) return;

  var BAR_H = 46; // main.ts titleBarOverlay.height와 반드시 일치

  // ── ① 스타일: 드래그 영역 + 컨트롤 인셋 + 메뉴 ──────────────────────────
  var css = [
    // 헤더 = 타이틀바(드래그). 높이는 페이지 자연값 유지 — 강제하면 밀도 높은 헤더(dashboard)가
    // 줄바꿈으로 깨진다(실측). 우측은 OS 창 컨트롤(env(titlebar-area-*)) 자리만 비운다.
    // mac 신호등(좌측)은 titlebar-area-x가 왼쪽 인셋을 알려주므로 같은 식으로 커버된다.
    // sticky: 타이틀바는 스크롤해도 상단 고정이어야 한다(2026-07-25 양 플랫폼 실증 버그) —
    // 반응형 레이어가 overflow-x를 hidden 아닌 clip으로 쓴 덕에 sticky가 깨지지 않는다.
    ".header{position:sticky;top:0;z-index:850;background:var(--panel-2,#0e1526);-webkit-app-region:drag;",
    "padding-right:calc(100vw - env(titlebar-area-width,100vw) - env(titlebar-area-x,0px) + 12px);",
    "padding-left:calc(env(titlebar-area-x,0px) + 20px);}",
    // 인터랙티브 요소는 드래그 제외(클릭 가능해야 함)
    ".header button,.header input,.header a,.header .icon-btn,.header .menu-btn,.header .avatar-btn,.header .status-pill,.header [data-page],.header select,#settingsBtn,.header .gijo-info{-webkit-app-region:no-drag;}",
    // 헤더 없는 페이지용 최소 스트립
    "#gijoTitlebarStrip{position:fixed;top:0;left:0;right:0;height:" + BAR_H + "px;-webkit-app-region:drag;z-index:800;display:flex;align-items:center;justify-content:flex-end;",
    "padding-right:calc(100vw - env(titlebar-area-width,100vw) - env(titlebar-area-x,0px) + 10px);}",
    "#gijoTitlebarStrip .gtb-gear{-webkit-app-region:no-drag;}",
    // ⚙ 드롭다운
    ".gtb-gear{-webkit-app-region:no-drag;width:30px;height:30px;border-radius:8px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);display:flex;align-items:center;justify-content:center;font-size:14px;color:#cfe0ff;cursor:pointer;}",
    ".gtb-menu{position:fixed;top:" + (BAR_H + 4) + "px;width:268px;background:#151d33;border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:8px;z-index:990;font-size:12.5px;-webkit-app-region:no-drag;}",
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

  // ── ⚙ 진입점 ──────────────────────────────────────────────────────────
  // 기존 #settingsBtn이 "진짜 기어(⚙)"일 때만 재사용한다. dashboard의 #settingsBtn은
  // "☰ 전체메뉴" 버튼이라(id만 같음) 가로채면 안 된다 — 그 경우/없는 경우엔 전용 기어를 만든다.
  var existing = document.getElementById("settingsBtn");
  var gear;
  if (existing && existing.textContent.trim() === "⚙") {
    gear = existing;
    // 기존 동작(설정 화면 이동)은 메뉴 항목으로 이동 — 클릭을 캡처 단계에서 가로채 메뉴를 연다.
    gear.addEventListener("click", function (e) { e.stopImmediatePropagation(); toggleMenu(); }, true);
  } else {
    gear = document.createElement("div");
    gear.className = "gtb-gear";
    gear.textContent = "⚙";
    gear.title = "클라이언트 메뉴 — 배율·전체화면·서버·업데이트";
    gear.addEventListener("click", function () { toggleMenu(); });
    var right = document.querySelector(".header .header-right");
    if (right) {
      right.appendChild(gear); // 헤더 오른쪽 끝(창 컨트롤 안쪽)
    } else {
      var strip = document.createElement("div");
      strip.id = "gijoTitlebarStrip";
      strip.appendChild(gear);
      document.body.appendChild(strip);
    }
  }

  // ── 업데이트 알림 배지 — 새 버전이 게시돼 있으면 ⚙에 빨간 점 + 메뉴 항목 강조(전 화면 공통) ──
  var updateInfo = null; // { version } — 새 버전 있을 때만 채워짐
  if (authed) {
    (async function () {
      try {
        var r = await window.gijo.update.checkForUpdate();
        if (r && r.updateAvailable && r.latest) {
          updateInfo = { version: r.latest.version };
          gear.style.position = "relative";
          var dot = document.createElement("span");
          dot.id = "gtbUpdateDot";
          dot.style.cssText = "position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#f0a020;border:2px solid #0e1526;";
          gear.appendChild(dot);
          gear.title = "새 버전 v" + updateInfo.version + " 설치 가능";
        }
      } catch (e) { /* 미로그인/서버 미응답 — 배지 없이 조용히 */ }
    })();
  }

  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function toggleMenu() { if (menuEl) closeMenu(); else openMenu(); }
  document.addEventListener("click", function (e) { if (menuEl && !menuEl.contains(e.target) && e.target !== gear) closeMenu(); });
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

  async function openMenu() {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "gtb-menu";
    // 기어 위치 기준 우측 정렬
    var r = gear.getBoundingClientRect();
    menuEl.style.right = Math.max(8, window.innerWidth - r.right) + "px";

    // [화면]
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
    // 단축키 라벨 플랫폼 분기(mac 실측 회신 반영) — 동작은 공통, 표기만 관례에 맞춘다.
    var isMac = navigator.platform.indexOf("Mac") === 0;
    menuEl.appendChild(item("➕", "확대", isMac ? "⌘ +" : "Ctrl +", function () { window.gijo.stepUiZoom(1); }));
    menuEl.appendChild(item("➖", "축소", isMac ? "⌘ −" : "Ctrl −", function () { window.gijo.stepUiZoom(-1); }));
    menuEl.appendChild(item("🖥", "전체 화면 (관제 모드)", isMac ? "⌃⌘F" : "F11", function () { window.gijo.toggleFullscreen(); closeMenu(); }));

    // [연결] — 로그인 상태에서만
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

    // [클라이언트]
    menuEl.appendChild(sep());
    menuEl.appendChild(sec("클라이언트"));
    var ver = "";
    try { ver = await window.gijo.update.currentVersion(); } catch (e) {}
    if (authed) {
      if (updateInfo) {
        // 새 버전 있음 — 강조 표시로 바로 업데이트 화면 유도
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
})();
