# -*- coding: utf-8 -*-
# v5 구현: office 3열(할일|오피스|LIVE채팅) + dashboard 자체 엣지/팝업 제거(commandpanel 통일)
import io

# ── office.html — 할일 왼쪽 · 오피스 중앙 · LIVE 채팅 오른쪽 ────────────────────
o = io.open('office.html', encoding='utf-8').read()
old_grid = '.body { display: grid; grid-template-columns: 1fr 236px; gap: 14px; padding: 0 18px; flex: 1 1 auto; min-height: 0; }'
new_grid = ('.body { display: grid; grid-template-columns: 236px 1fr 280px; gap: 14px; padding: 0 18px; flex: 1 1 auto; min-height: 0; }\n'
            '  /* v5(2026-07-26): 할일=왼쪽, 오피스=중앙, LIVE 채팅=오른쪽(세션 팝업에서 이관) */\n'
            '  .todo { order: 0; }\n'
            '  .office-col { order: 1; }\n'
            '  .olive { order: 2; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; display: flex; flex-direction: column; min-height: 0; }\n'
            '  .ol-h { padding: 10px 12px 6px; font-size: 12px; font-weight: 800; color: #fff; flex: 0 0 auto; }\n'
            '  .ol-h .lv { font-size: 8.5px; font-weight: 800; color: #fff; background: #e2483d; border-radius: 8px; padding: 1px 6px; margin-left: 6px; letter-spacing: 1px; }\n'
            '  .ol-feed { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 12px 10px; }\n'
            '  .ol-line { padding: 5px 0; border-bottom: 1px solid var(--border); }\n'
            '  .ol-who { font-size: 10px; font-weight: 800; color: var(--blue-light, #7ab0ff); }\n'
            '  .ol-msg { display: block; font-size: 11px; color: var(--muted); margin-top: 1px; line-height: 1.45; word-break: break-word; }')
assert old_grid in o, 'office grid'
o = o.replace(old_grid, new_grid)

anchor = '    <div class="todo">'
assert anchor in o
o = o.replace(anchor, '''    <!-- 사무실 LIVE 채팅 — 작업 세션 팝업에서 이관(2026-07-26 사용자 결정) -->
    <div class="olive"><div class="ol-h">사무실 LIVE 채팅<span class="lv">LIVE</span></div>
      <div class="ol-feed" id="oliveFeed"><div style="font-size:11px;color:var(--muted-2);padding:6px 0">팀이 움직이면 대화가 여기 실시간으로 흐릅니다.</div></div></div>
''' + anchor, 1)

# collabMove 이벤트에 LIVE 피드도 함께 — 기존 핸들러(office.collabMove 호출부)에 편승
old_hook = '    office.collabMove(from, evt.to, evt.message);'
new_hook = '''    office.collabMove(from, evt.to, evt.message);
    appendOlive(from, evt.to, evt.message); // LIVE 채팅 열(v5)'''
assert old_hook in o, 'collab hook'
o = o.replace(old_hook, new_hook)

# appendOlive 함수 + 히스토리 재생 연결 — listCollaborationHistory 사용부 주변에 추가
old_hist = '      const history = await window.gijo.listCollaborationHistory();'
new_hist = '''      const history = await window.gijo.listCollaborationHistory();
      (history || []).slice(-40).forEach((e) => appendOlive(e.from, e.to, e.message)); // LIVE 채팅 초기 채움(v5)'''
assert old_hist in o, 'hist'
o = o.replace(old_hist, new_hist)

fn = '''
  // 사무실 LIVE 채팅(v5) — 캐릭터 말풍선과 같은 협업 이벤트를 오른쪽 열에도 흘린다.
  const OLIVE_MAX = 60;
  function appendOlive(from, to, message) {
    const feed = document.getElementById("oliveFeed");
    if (!feed || !message) return;
    const first = feed.firstElementChild;
    if (first && !first.classList.contains("ol-line")) feed.removeChild(first); // 빈 안내 제거
    const line = document.createElement("div");
    line.className = "ol-line";
    const who = (from || "팀") + (to ? " → " + to : "");
    line.innerHTML = '<span class="ol-who"></span><span class="ol-msg"></span>';
    line.querySelector(".ol-who").textContent = who;
    line.querySelector(".ol-msg").textContent = message;
    feed.appendChild(line);
    while (feed.childElementCount > OLIVE_MAX) feed.removeChild(feed.firstChild);
    feed.scrollTop = feed.scrollHeight;
  }
'''
i = o.index('  const todoList = document.getElementById("todoList");')
o = o[:i] + fn + '\n' + o[i:]
io.open('office.html', 'w', encoding='utf-8').write(o)
print('office 3열 완료')

# ── dashboard.html — 자체 엣지/오피스/세션 팝업 제거 → commandpanel 통일 ─────────
d = io.open('dashboard.html', encoding='utf-8').read()

# 마크업: 엣지 레일 + 오피스 팝업 제거
a = d.index('    <!-- 오른쪽 가장자리 세로 메뉴(작업 세션·AI 라이브 오피스) + 대형 오피스 팝업 -->')
b = d.index('</iframe>', a)
b = d.index('</div>', b) + len('</div>')
d = d[:a] + '    <!-- 엣지 탭·팝업(작업 세션·AI 라이브 오피스)은 전 화면 공용 commandpanel.js가 담당(v5 통일 2026-07-26) -->' + d[b:]

# 그리드: 42px 엣지 열 제거(commandpanel은 fixed)
d = d.replace('.body-grid{grid-template-columns:232px 1fr 42px !important;position:relative;}',
              '.body-grid{grid-template-columns:232px 1fr !important;position:relative;}')
d = d.replace('st.textContent = "body.gn-left-collapsed .body-grid{grid-template-columns:1fr 42px !important;}" +\n      ".body-grid{grid-template-columns:232px 1fr 42px !important;}";',
              'st.textContent = "body.gn-left-collapsed .body-grid{grid-template-columns:1fr !important;}" +\n      ".body-grid{grid-template-columns:232px 1fr !important;}";')
# 대시보드 자체 세션 팝업은 완전 숨김(commandpanel 팝업이 대체 — 데이터 로더는 무해하게 유지)
d = d.replace('body.pop-sess .dash-sessions{display:flex;flex-direction:column;}',
              '/* v5: 자체 세션 팝업 폐기 — commandpanel 공용 팝업이 대체 */')

# JS: 엣지 탭·오피스·세션 팝업 로직 제거(quick 팝업만 유지)
old_js = '''    // 가장자리 탭 — 세션(소형)/오피스(대형) 팝업, 서로 배타 + ✕/ESC 닫기
    const B = document.body;
    const setPop = (name) => {
      ["pop-sess", "pop-office", "pop-quick"].forEach((c) => B.classList.remove(c));
      document.querySelectorAll(".etab").forEach((e) => e.classList.remove("on"));
      if (name === "sess") { B.classList.add("pop-sess"); document.getElementById("etabSess").classList.add("on"); }
      if (name === "office") {
        const f = document.getElementById("officeFrame");
        if (!f.src) f.src = "office.html?embed=1"; // 첫 열림에만 로드(리소스 절약)
        B.classList.add("pop-office"); document.getElementById("etabOffice").classList.add("on");
      }
      if (name === "quick") B.classList.add("pop-quick");
    };
    document.getElementById("etabSess").addEventListener("click", () => setPop(B.classList.contains("pop-sess") ? null : "sess"));
    document.getElementById("etabOffice").addEventListener("click", () => setPop(B.classList.contains("pop-office") ? null : "office"));
    document.getElementById("officeClose").addEventListener("click", () => setPop(null));
    document.getElementById("quickClose").addEventListener("click", () => setPop(null));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setPop(null); });
    // 세션 진행중 수를 가장자리 탭 배지에 미러링(기존 dashActiveBadge가 진실 원천)
    const badge = document.getElementById("dashActiveBadge");
    const mirror = () => {
      const m = /([0-9]+)/.exec(badge?.textContent || "");
      document.getElementById("edgeSessCnt").textContent = m ? m[1] : "-";
    };
    if (badge) { new MutationObserver(mirror).observe(badge, { childList: true, characterData: true, subtree: true }); mirror(); }
    // 왼쪽 메뉴 "내 업무 바로가기"(?quick=1) → 중앙 팝업으로
    if (/[?&]quick=1/.test(location.search)) setPop("quick");'''
new_js = '''    // 엣지 탭·세션·오피스 팝업은 공용 commandpanel.js가 담당(v5 통일) — 여기선 quick 팝업만.
    const B = document.body;
    const setPop = (name) => { B.classList.toggle("pop-quick", name === "quick"); };
    document.getElementById("quickClose").addEventListener("click", () => setPop(null));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setPop(null); });
    if (/[?&]quick=1/.test(location.search)) setPop("quick");'''
assert old_js in d, 'dash js'
d = d.replace(old_js, new_js)

# commandpanel.js 로드(공용 엣지) — titlebar 다음
d = d.replace('<script src="titlebar.js"></script>',
              '<script src="titlebar.js"></script>\n<script src="commandpanel.js"></script>')
io.open('dashboard.html', 'w', encoding='utf-8').write(d)
print('dashboard 통일 완료')
