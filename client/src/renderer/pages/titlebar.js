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
    ".gtb-gear{-webkit-app-region:no-drag;width:24px;height:24px;border-radius:8px;background:rgba(59,130,246,.14);border:1px solid rgba(59,130,246,.4);display:flex;align-items:center;justify-content:center;font-size:13px;color:#cfe0ff;cursor:pointer;position:relative;flex:0 0 auto;}",
    // ── 사용자 영역(왼쪽 패널 하단) ──
    // 높이는 셸 하단바(.shellfoot 34px)와 **같아야 한다**(2026-08-02 사용자 지시 "세로길이도 맞춰줘").
    //   왼쪽 사용자 줄과 오른쪽 하단바가 한 띠로 이어져 보이는 자리다 — 어긋나면 계단처럼 보인다.
    ".gtb-userarea{border-top:1px solid rgba(255,255,255,.08);background:rgba(59,130,246,.05);padding:0 10px;display:flex;flex-direction:column;justify-content:center;gap:4px;z-index:60;min-height:34px;}",
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
    ".gtb-userarea .ua-row{display:flex;align-items:center;gap:8px;cursor:pointer;min-width:0;}",
    ".gtb-userarea .ua-avatar{width:22px;height:22px;border-radius:50%;background:var(--blue,#3b82f6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.25px;font-weight:800;flex:0 0 auto;}",
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
    ".gtb-mhead{display:flex;align-items:center;gap:8px;padding:4px 4px 8px 10px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:6px;}",
    ".gtb-mhead .t{font-size:13.5px;font-weight:800;color:#e9e7e2;flex:1;}",
    ".gtb-mx{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#a49d95;font-size:12.5px;cursor:pointer;flex:0 0 auto;}",
    ".gtb-mx:hover{background:rgba(226,72,61,.16);color:#f5928a;}",

    // ── 상단 조작 줄 (2026-08-02) ────────────────────────────────────────
    // 흩어져 있던 조작 셋(설정=사이드바 맨 아래 / 접기=화면 한가운데 딱지 / 찾기=사이드바 맨 위)을
    // 한 줄로 모으고 뒤로·앞으로를 더한다. 상단은 **메뉴를 접어도 남는 유일한 자리**다.
    ".gtb-acts{display:flex;align-items:center;gap:2px;flex:0 0 auto;-webkit-app-region:no-drag;margin-right:4px;}",
    ".gtb-ib{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--muted,#b3ada4);cursor:pointer;flex:0 0 auto;border:1px solid transparent;background:none;padding:0;position:relative;}",
    ".gtb-ib:hover{background:rgba(255,255,255,.07);color:var(--text,#e9e7e2);}",
    ".gtb-ib svg{width:17px;height:17px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;}",
    // 갈 곳이 없으면 흐리게 + 클릭 무시 — '눌러도 아무 일 없는 자리'를 만들지 않는다.
    ".gtb-ib[disabled]{opacity:.32;cursor:default;pointer-events:none;}",
    ".gtb-vr{width:1px;height:20px;background:var(--border,rgba(255,255,255,.10));margin:0 6px;flex:0 0 auto;}",
    // 지금 보는 곳 — 메뉴를 접어도 여기가 어디인지 알 수 있어야 한다.
    ".gtb-where{display:flex;align-items:center;gap:8px;min-width:0;flex:0 1 auto;padding-right:10px;}",
    ".gtb-where .wg{font-size:12.5px;color:var(--muted-2,#a49d95);flex:0 0 auto;}",
    ".gtb-where .wn{font-size:13.5px;font-weight:800;color:var(--text,#e9e7e2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",

    // ── 화면 찾기 겹판 (Ctrl+K) ─────────────────────────────────────────
    ".gtb-fmask{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:995;display:flex;align-items:flex-start;justify-content:center;padding-top:11vh;-webkit-app-region:no-drag;}",
    ".gtb-fpal{width:min(520px,88vw);max-height:70vh;display:flex;flex-direction:column;background:var(--panel,#30302e);border:1px solid var(--border-strong,rgba(255,255,255,.18));border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;}",
    ".gtb-fpal input{width:100%;background:none;border:none;border-bottom:1px solid var(--border,rgba(255,255,255,.10));padding:13px 15px;color:var(--text,#e9e7e2);font-size:14.5px;outline:none;font-family:inherit;}",
    ".gtb-fpal .fl{overflow-y:auto;padding:5px;}",
    ".gtb-fr{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;font-size:13.5px;color:var(--muted,#b3ada4);cursor:pointer;}",
    ".gtb-fr.on{background:rgba(59,130,246,.18);color:#fff;}",
    ".gtb-fr .fg{margin-left:auto;font-size:12px;color:var(--muted-2,#a49d95);flex:0 0 auto;}",
    ".gtb-fnone{padding:16px;font-size:13px;color:var(--muted-2,#a49d95);text-align:center;}",
    ".gtb-fhint{padding:7px 12px;border-top:1px solid var(--border,rgba(255,255,255,.10));font-size:12px;color:var(--muted-2,#a49d95);display:flex;gap:14px;}",
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
    } else if (dir === "downright") {
      // 왼쪽 끝 단추용 — 단추 왼쪽 모서리에 맞춰 **오른쪽으로** 편다(2026-08-02 사용자 지시).
      // 오른쪽 정렬로 펴면 창 밖으로 나가 잘린다.
      menuEl.style.left = Math.max(8, r.left) + "px";
      menuEl.style.top = (r.bottom + 6) + "px";
    } else {
      menuEl.style.right = Math.max(8, window.innerWidth - r.right) + "px";
      menuEl.style.top = (r.bottom + 6) + "px";
    }

    // 머리줄 — 무엇의 메뉴인지 + 닫기. Esc·바깥 클릭도 그대로 되지만, **보이는 닫기**가 있어야
    // 처음 여는 사람도 빠져나올 길을 안다(2026-08-02 사용자 지시).
    var head = document.createElement("div");
    head.className = "gtb-mhead";
    head.innerHTML = '<span class="t">설정</span>';
    var x = document.createElement("span");
    x.className = "gtb-mx";
    x.textContent = "✕";
    x.title = "닫기 (Esc)";
    x.setAttribute("role", "button");
    x.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(); });
    head.appendChild(x);
    menuEl.appendChild(head);

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
    // ⚙는 **상단 ☰로 이사했다**(2026-08-02). 비는 줄 끝에는 문서함을 넣는다 —
    // 늘 쓰는 곳이라 메뉴 목록을 훑지 않고 바로 닿는다(사용자 지시).
    // 아이콘은 왼쪽 메뉴와 **같은 결**로 — 단선 SVG(2026-08-05, 시안 nav-refine-v1).
    // 여기만 컬러 이모지(📚)로 남겨 두면 정돈한 메뉴 아래에서 그 하나가 튄다.
    var gear = document.createElement("span"); gear.className = "gtb-gear";
    gear.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" style="width:14px;height:14px;stroke:currentColor;' +
      'fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round">' +
      '<path d="M3.4 3.2h4.2c.9 0 1.6.7 1.6 1.6v8c0-.7-.6-1.3-1.3-1.3H3.4z"/>' +
      '<path d="M12.6 3.2H9.2v10c0-.7.6-1.3 1.3-1.3h2.1z"/></svg>';
    gear.title = "문서함 열기 — 가이드·아키텍처를 읽는 별도 창";
    row.appendChild(av); row.appendChild(nm); row.appendChild(gear);
    area.appendChild(row);
    gear.addEventListener("click", function (e) {
      e.stopPropagation();
      if (window.gijo && typeof window.gijo.openDocbox === "function") window.gijo.openDocbox();
      else alert("문서함을 열 수 없습니다 — 앱을 다시 시작해 보시고, 계속되면 알려주세요.");
    });
    // 이름·아바타를 누르면 **설정 › 내 설정**으로. 예전엔 이 줄이 ⚙ 메뉴를 열었는데 그 메뉴는 상단으로 갔다.
    // ⚠ 두 번 데었다. ① 구역 키는 s=my다(s=me로 적으면 아무 구역도 안 걸려 빈 화면이 뜬다).
    //   ② navigateTo로 가면 **셸 문서가 통째로 바뀌어** 열어 둔 탭과 대화가 날아간다 —
    //   메뉴와 같은 길(gijoOpenScreen)로 열어 탭으로 뜨게 한다.
    row.addEventListener("click", function (e) {
      e.stopPropagation();
      var 갈곳 = { page: "settings.html?s=my", label: "내 설정" };
      if (typeof window.gijoOpenScreen === "function") window.gijoOpenScreen(갈곳);
      else window.gijo.navigateTo(갈곳.page);
    });
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
    // ⚠ 값이 없으면 **NaN을 그대로 보여 주지 않는다**(2026-08-04 발견: 「⏳ 세션 NaN:NaN」).
    //   숫자가 아니면 "--:--"로 둔다 — 담당자가 NaN을 보면 제품이 고장 난 줄 안다.
    var ms = info && typeof info.remainingMs === "number" && isFinite(info.remainingMs)
      ? Math.max(0, info.remainingMs) : null;
    if (ms === null) {
      sessTimeEl.textContent = "--:--";
      sessChip.style.display = "inline-flex";
      return;
    }
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

  // ══ 상단 조작 줄 (2026-08-02 사용자 지시: "상단 너처럼 변경") ══════════════
  //
  // 왜 옮겼나 — 자주 쓰는 조작 셋이 세 군데에 흩어져 있었다.
  //   설정 ⚙ = 사이드바 맨 아래 · 접기 = 화면 한가운데 ◀ 딱지 · 찾기 = 사이드바 맨 위 입력칸.
  //   셋 다 **사이드바를 접으면 같이 사라진다**. 상단은 접어도 남는 유일한 자리다.
  // 뒤로·앞으로는 새로 만든다 — 눌러 들어간 화면에서 되돌아올 길이 아예 없었다.

  // ── 화면 이력 ──────────────────────────────────────────────────────────
  // ⚠ 브라우저 이력을 쓸 수 없다. 화면마다 **문서가 통째로 바뀌므로**(file://…html) 창 안에서만
  //   사는 값으로 들고 다녀야 한다 — sessionStorage(창 단위, 앱 끄면 사라짐)를 쓴다.
  //   되돌아가며 navigate하면 새 문서가 또 "새 화면"으로 보고 밀어 넣는다 → 무한 왕복.
  //   그래서 이동 직전에 표식(MOVE_KEY)을 남겨, 새 문서는 밀지 않고 자리만 옮긴다.
  var HIST_KEY = "gijo:navhist", MOVE_KEY = "gijo:navmove";
  // 셸(app.html)에서는 화면이 **탭(iframe)**이라 문서가 안 바뀐다 — 주소로는 이력을 못 센다.
  // 셸이 gijoNoteScreen으로 "지금 이 화면을 본다"고 알려 주면 그것을 한 걸음으로 센다.
  var 셸인가 = !!document.getElementById("screens");
  var 셸화면 = null;
  function 지금화면() {
    if (셸인가) return 셸화면 || "";
    return (location.pathname.split("/").pop() || "") + (location.search || "");
  }
  function 이력읽기() {
    try {
      var h = JSON.parse(sessionStorage.getItem(HIST_KEY) || "null");
      if (h && Array.isArray(h.stack) && typeof h.idx === "number") return h;
    } catch (e) {}
    return { stack: [], idx: -1 };
  }
  function 이력쓰기(h) { try { sessionStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) {} }
  var hist = 이력읽기();
  if (셸인가) hist = { stack: [], idx: -1 }; // 셸은 새로 뜰 때마다 처음부터 — 탭도 함께 복원되기 때문
  (function 이력에지금화면반영() {
    if (셸인가) return; // 셸은 아래 gijoNoteScreen이 채운다(아직 화면이 안 떴다)
    var 이동 = null;
    try { 이동 = sessionStorage.getItem(MOVE_KEY); sessionStorage.removeItem(MOVE_KEY); } catch (e) {}
    var 여기 = 지금화면();
    if (이동 === "back" || 이동 === "fwd") {
      // 뒤로/앞으로로 온 것 — 자리만 옮긴다(밀어 넣지 않는다).
      hist.idx = Math.min(hist.stack.length - 1, Math.max(0, hist.idx + (이동 === "fwd" ? 1 : -1)));
      이력쓰기(hist);
      return;
    }
    if (hist.stack[hist.idx] === 여기) return;      // 같은 화면 새로고침 — 이력이 늘 이유가 없다
    hist.stack = hist.stack.slice(0, hist.idx + 1); // 되돌아간 뒤 새 길로 가면 앞쪽은 버린다
    hist.stack.push(여기);
    if (hist.stack.length > 60) hist.stack.shift();  // 무한정 쌓지 않는다
    hist.idx = hist.stack.length - 1;
    이력쓰기(hist);
  })();
  function 이력이동(d) {
    var 갈곳 = hist.stack[hist.idx + d];
    if (!갈곳) return;
    if (셸인가) {
      // 탭을 되짚는다. 이미 닫힌 탭이면 다시 열린다(open이 알아서 판단).
      hist.idx += d;
      이력쓰기(hist);
      되짚는중 = true;
      try { window.gijoTabs.open(갈곳.page || 갈곳, 갈곳.label); } finally { 되짚는중 = false; }
      window.gijoSyncTopbar();
      return;
    }
    try { sessionStorage.setItem(MOVE_KEY, d > 0 ? "fwd" : "back"); } catch (e) {}
    window.gijo.navigateTo(갈곳);
  }

  /**
   * 셸이 부른다 — "지금 이 화면을 본다". 되짚는 중(뒤로/앞으로)에는 밀어 넣지 않는다.
   * ⚠ 안 그러면 뒤로 갈 때마다 그 화면이 다시 이력 끝에 쌓여 영원히 앞으로만 간다.
   */
  var 되짚는중 = false;
  window.gijoNoteScreen = function (page, label) {
    셸화면 = { page: page, label: label || page };
    if (되짚는중) { window.gijoSyncTopbar(); return; }
    var 지금 = hist.stack[hist.idx];
    if (지금 && (지금.page || 지금) === page) { window.gijoSyncTopbar(); return; } // 같은 화면 다시 누름
    hist.stack = hist.stack.slice(0, hist.idx + 1);
    hist.stack.push(셸화면);
    if (hist.stack.length > 60) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    이력쓰기(hist);
    window.gijoSyncTopbar();
  };

  // ── 화면 찾기 겹판 ──────────────────────────────────────────────────────
  var finderEl = null;
  function closeFinder() { if (finderEl) { finderEl.remove(); finderEl = null; } }
  window.gijoOpenFinder = function () {
    if (finderEl) { closeFinder(); return; }
    var 목록 = (typeof window.gijoScreenList === "function") ? window.gijoScreenList() : [];
    if (!목록.length) return; // 메뉴 자료가 아직 없으면 조용히(빈 겹판을 띄우면 고장으로 보인다)
    finderEl = document.createElement("div");
    finderEl.className = "gtb-fmask";
    var pal = document.createElement("div");
    pal.className = "gtb-fpal";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "화면 이름을 적으세요 — 예: 취약점, 자산, 기록";
    inp.setAttribute("aria-label", "화면 찾기");
    inp.autocomplete = "off"; inp.spellcheck = false;
    var list = document.createElement("div"); list.className = "fl";
    var hint = document.createElement("div");
    hint.className = "gtb-fhint";
    hint.innerHTML = "<span>↑↓ 고르기</span><span>Enter 열기</span><span>Esc 닫기</span>";
    pal.appendChild(inp); pal.appendChild(list); pal.appendChild(hint);
    finderEl.appendChild(pal);
    document.body.appendChild(finderEl);

    var 걸린것 = [], 고른것 = 0;
    function 그리기() {
      var q = inp.value.trim().toLowerCase();
      걸린것 = q ? 목록.filter(function (i) { return (i.label || "").toLowerCase().indexOf(q) >= 0 || (i.group || "").toLowerCase().indexOf(q) >= 0; })
                 : 목록.slice(0, 12);
      고른것 = 0;
      list.innerHTML = "";
      if (!걸린것.length) {
        var none = document.createElement("div");
        none.className = "gtb-fnone";
        none.textContent = "'" + inp.value.trim() + "'에 맞는 화면이 없습니다.";
        list.appendChild(none);
        return;
      }
      걸린것.forEach(function (it, n) {
        var r = document.createElement("div");
        r.className = "gtb-fr" + (n === 0 ? " on" : "");
        r.innerHTML = "<span>" + (it.ic || "▪") + "</span><span>" + it.label + "</span>" +
                      (it.group ? '<span class="fg">' + it.group + "</span>" : "");
        r.addEventListener("click", function () { closeFinder(); window.gijoOpenScreen(it); });
        list.appendChild(r);
      });
    }
    function 고르기(d) {
      if (!걸린것.length) return;
      고른것 = Math.min(걸린것.length - 1, Math.max(0, 고른것 + d));
      [].forEach.call(list.children, function (el, n) { el.classList.toggle("on", n === 고른것); });
      var on = list.children[고른것];
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    }
    // ⚠ 한글은 ㅎ→하→한처럼 **조합 중**에도 input이 뜬다. 목록만 다시 그리고 입력칸은
    //   건드리지 않는다 — 입력칸을 새로 만들면 조합이 끊겨 한글을 못 친다(옛 사이드바 찾기 사고).
    inp.addEventListener("input", 그리기);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); 고르기(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); 고르기(-1); }
      else if (e.key === "Enter") {
        if (e.isComposing) return; // 한글 조합 확정용 Enter를 '열기'로 삼으면 엉뚱한 화면이 열린다
        e.preventDefault();
        var it = 걸린것[고른것];
        if (it) { closeFinder(); window.gijoOpenScreen(it); }
      } else if (e.key === "Escape") { e.preventDefault(); closeFinder(); }
    });
    finderEl.addEventListener("click", function (e) { if (e.target === finderEl) closeFinder(); });
    그리기();
    inp.focus();
  };

  // ── 조작 줄 만들기 ──────────────────────────────────────────────────────
  function 아이콘단추(title, svgPath, onClick) {
    var b = document.createElement("button");
    b.className = "gtb-ib";
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = '<svg viewBox="0 0 24 24">' + svgPath + "</svg>";
    b.addEventListener("click", function (e) { e.stopPropagation(); onClick(b); });
    return b;
  }
  var topSideBtn = null, topBackBtn = null, topFwdBtn = null, topWhereEl = null;

  /** 상단 바 모양을 현재 상태에 맞춘다 — 접힘 여부·이력 유무·지금 보는 곳. */
  window.gijoSyncTopbar = function () {
    if (topSideBtn) {
      var 접힘 = typeof window.gijoLeftCollapsed === "function" && window.gijoLeftCollapsed();
      topSideBtn.title = 접힘 ? "왼쪽 메뉴 펼치기 (Ctrl+B)" : "왼쪽 메뉴 접기 (Ctrl+B)";
      topSideBtn.style.color = 접힘 ? "var(--blue-light,#7ab0ff)" : "";
    }
    if (topBackBtn) topBackBtn.disabled = !(hist.stack[hist.idx - 1]);
    if (topFwdBtn) topFwdBtn.disabled = !(hist.stack[hist.idx + 1]);
    if (topWhereEl) 지금보는곳채우기();
  };

  function 지금보는곳채우기() {
    if (!topWhereEl) return;
    var 여기 = 셸인가 ? (셸화면 && 셸화면.page) || "" : 지금화면();
    var 이름 = "", 구역 = "";
    var 목록 = (typeof window.gijoScreenList === "function") ? window.gijoScreenList() : [];
    var 맞는것 = 목록.filter(function (i) { return i.page === 여기; })[0]
              || 목록.filter(function (i) { return i.page && i.page.split("?")[0] === 여기.split("?")[0]; })[0];
    if (맞는것) { 이름 = 맞는것.label; 구역 = 맞는것.group || ""; }
    else if (셸인가 && 셸화면) { 이름 = 셸화면.label; }
    else if (셸인가) { 이름 = "열린 화면 없음"; }
    else { 이름 = (document.title || "").replace(/^GIJO AS\s*[—·-]\s*/, "") || 여기.split("?")[0]; }
    topWhereEl.innerHTML = (구역 ? '<span class="wg">' + 구역 + " ›</span>" : "") +
                           '<span class="wn"></span>';
    topWhereEl.querySelector(".wn").textContent = 이름;
  }

  /**
   * .header 맨 앞에 조작 줄을 끼운다.
   * ⚠ 별도 창(팀 사무실·문서함·대화창)에는 사이드바가 없다 — 거기서는 ▣를 아예 만들지 않는다.
   *   만들어 두고 아무 일도 안 하게 두면 "눌러도 반응 없는 자리"가 된다(전수 점검에서 잡던 결함).
   */
  function mountTopbar() {
    // 화면은 .header, 별도 창(팀 사무실·문서함)은 .head를 쓴다 — 둘 다 받는다.
    var hdr = document.querySelector(".header");
    if (!hdr || hdr.querySelector(".gtb-acts")) return false;
    // ⚠ 분리창(popout=1)은 **왼쪽 메뉴를 강제로 숨긴다**(nav.js applyPopout). 요소는 남아 있으므로
    //   "있으니 만들자"로 판단하면 ▣가 붙고, 눌러도 아무 일이 없다 — 딱 우리가 없애려던 자리다.
    //   그래서 창 종류까지 본다(2026-08-02 사후 검토에서 발견).
    var 분리창 = /(^|[?&])popout=1(&|$)/.test(location.search);
    var 사이드있음 = !분리창 && !!(document.getElementById("gijoNav") || document.querySelector(".explorer"));

    var acts = document.createElement("div");
    acts.className = "gtb-acts";

    // 톱니 모양 그대로 쓴다 — 담당자가 이미 「설정은 톱니」로 익힌 자리다(줄 세 개는 목록처럼 읽힌다).
    var gear = 아이콘단추("설정 — 배율·전체화면·서버·업데이트",
      '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
      function (b) { if (menuEl) closeMenu(); else openMenu(b, "downright"); });
    acts.appendChild(gear);

    if (사이드있음) {
      topSideBtn = 아이콘단추("왼쪽 메뉴 접기 (Ctrl+B)", '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', function () {
        if (typeof window.gijoLeftCollapse === "function") {
          window.gijoLeftCollapse(!window.gijoLeftCollapsed());
        }
      });
      acts.appendChild(topSideBtn);
    }

    acts.appendChild(아이콘단추("화면 찾기 (Ctrl+K)", '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', function () {
      window.gijoOpenFinder();
    }));

    var vr = document.createElement("div"); vr.className = "gtb-vr"; acts.appendChild(vr);
    topBackBtn = 아이콘단추("뒤로 (Alt+←)", '<path d="M19 12H5M11 6l-6 6 6 6"/>', function () { 이력이동(-1); });
    topFwdBtn = 아이콘단추("앞으로 (Alt+→)", '<path d="M5 12h14M13 6l6 6-6 6"/>', function () { 이력이동(1); });
    acts.appendChild(topBackBtn); acts.appendChild(topFwdBtn);

    topWhereEl = document.createElement("div");
    topWhereEl.className = "gtb-where";
    acts.appendChild(topWhereEl);

    hdr.insertBefore(acts, hdr.firstChild);

    // 로고는 뺀다 — 왼쪽 메뉴 위에 이미 있고, 상단은 조작이 쓸 자리다(2026-08-02 결정).
    var logo = hdr.querySelector("#homeLink");
    if (logo) logo.style.display = "none";
    // 시계는 오른쪽 세션 칩 옆으로 — 「남은 시간」과 「지금 시각」은 같이 봐야 뜻이 산다.
    var clock = hdr.querySelector(".clock, #clockEl");
    var right = hdr.querySelector(".header-right");
    if (clock && right && clock.parentNode !== right) right.insertBefore(clock, right.firstChild);

    window.gijoSyncTopbar();
    return true;
  }

  // 단축키 — 안내한 것은 반드시 걸려 있어야 한다(안내만 하고 안 걸어 둔 전례가 있다).
  document.addEventListener("keydown", function (e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "ArrowLeft") { e.preventDefault(); 이력이동(-1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); 이력이동(1); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "b" || e.key === "B")) {
      if (typeof window.gijoLeftCollapse === "function") {
        e.preventDefault();
        window.gijoLeftCollapse(!window.gijoLeftCollapsed());
      }
    }
  });

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
    mountTopbar();   // 상단 조작 줄(☰ ▣ 🔍 ← →)
    // 화면 안에 남아 있던 ⚙ — 설정은 상단 ☰ 하나로 모았다(입구가 둘이면 하나만 고쳐진다).
    var oldGear = document.getElementById("settingsBtn");
    if (oldGear && oldGear.textContent.trim() === "⚙") oldGear.style.display = "none";
  }

  // 별도 창(팀 사무실·문서함·대화창)에는 왼쪽 패널이 없다 — 그래도 상단 조작 줄은 붙인다
  // (▣만 빠지고 ☰·🔍·←·→는 그대로 쓴다). 붙일 .header가 있으면 언제든 마운트.
  if (document.querySelector(".header")) mountTopbar();

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
