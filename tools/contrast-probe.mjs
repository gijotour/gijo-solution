// tools/contrast-probe.mjs — 프로(흰 바탕)에서 **글자가 실제로 읽히는지** 실화면에서 잰다.
//
// ■ 왜 소스 감시(themecolors.test.ts)만으로 부족한가 (2026-08-30 실측이 증명)
//   소스 검사는 `color:#hex`라는 **글자 모양**을 본다. 그런데 색이 화면에 닿는 길은 그것만이
//   아니다 — JS가 `el.style.color = "#hex"`로 넣거나, 색 사전(`{high:"#f5928a"}`)을 style
//   문자열에 끼워 넣는다. 그날 소스 검사가 95곳을 0으로 만든 **뒤에도** 이 도구가 인벤토리·
//   AI 지식에서 6곳을 더 잡았다(map-view 등급표·memory 위생 배지·viz 팔레트 계열).
//   반대 방향 오차도 있다: pro-white가 선택자로 덮은 자리는 소스만 보면 위반처럼 보인다.
//   ⇒ 소스 감시=빠른 그물(CI에서 매번), 이 도구=정확한 자(사람이 볼 때·게시 전).
//
// ■ 무엇을 재나
//   보이는 텍스트 노드마다 computed color와 **실제로 뒤에 깔린 배경**(투명은 부모로 거슬러
//   올라가 찾는다)의 WCAG 대비. 4.5:1(AA 본문) 미만을 보고한다.
//
// 사용:
//   1) 앱을 CDP로 띄우고 로그인해 둔다(프로 셸).  npx electron . --remote-debugging-port=9223
//   2) node tools/contrast-probe.mjs [화면.html|탭이름] ...
//      예) node tools/contrast-probe.mjs "inventory.html?full=1|자산 관리 (전체)" "memory.html|AI 지식"
//      인자가 없으면 기본 6화면을 돈다.
// 종료 코드: 위반이 있으면 1 (게시 전 관문에 물릴 수 있게)
const PORT = process.env.GIJO_CDP_PORT || "9223";
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));

async function 붙기(조각, 초 = 20) {
  for (let i = 0; i < 초 * 2; i++) {
    try {
      const 목록 = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === "page");
      const t = 조각 ? 목록.find((x) => x.url.includes(조각)) : 목록[0];
      if (t) return t;
    } catch { /* 아직 안 떴을 수 있다 */ }
    await 잠깐(500);
  }
  return null;
}
async function 평가(대상, expr) {
  const ws = new WebSocket(대상.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const 답 = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) 답.set(m.id, m); };
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  for (let i = 0; i < 400; i++) { if (답.has(1)) break; await 잠깐(50); }
  ws.close();
  const m = 답.get(1);
  if (!m) throw new Error("CDP 응답 없음(시간 초과)");
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "평가 오류");
  return m.result.result.value;
}

// 화면 안에서 도는 계측기 — 문자열로 넣는다(iframe 안에서 eval).
const 재기 = `(() => {
  const 광도 = (rgb) => {
    const m = String(rgb).match(/\\d+(\\.\\d+)?/g) || [];
    const c = m.slice(0, 3).map((x) => {
      const v = Number(x) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  // 투명 배경은 뒤에 실제로 깔린 것을 찾아 올라간다 — 반투명 배지가 흰 바탕에 얹히는 자리가 요점이다.
  const 배경찾기 = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = String(bg).split(",");
      const a = p.length > 3 ? parseFloat(p[3]) : 1;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && a > 0.5) return bg;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const 대비 = (a, b) => { const [l1, l2] = [광도(a), 광도(b)].sort((x, y) => y - x); return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100; };
  const 나쁜것 = [];
  let 잰것 = 0;
  document.querySelectorAll("*").forEach((el) => {
    const t = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!t.length) return;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) < 0.3) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    잰것++;
    const bg = 배경찾기(el);
    const c = 대비(st.color, bg);
    if (c < 4.5) 나쁜것.push({ 글: t.map((n) => n.textContent.trim()).join(" ").slice(0, 30), 색: st.color, 배경: bg, 대비: c, 크기: st.fontSize, 클래스: String(el.className).slice(0, 40) });
  });
  return { 잰것, 나쁜수: 나쁜것.length, 나쁜것: 나쁜것.sort((a, b) => a.대비 - b.대비).slice(0, 15) };
})()`;

/** 잴 창 고르기 — 셸 안에서 도는 코드(평가 문자열에 끼워 넣는다).
 *  ⚠ 「속틀이 있으면 무조건 속틀」이 아니다(2026-08-30 실측): 내 문서는 담당자 관리용 **빈**
 *    iframe을 하나 품고 있어서, 그것을 고르면 글자가 없어 「못 쟀다」가 된다. 허브 화면은
 *    반대로 속틀에 진짜 내용이 있다. ⇒ **글자가 가장 많은 창**을 고른다 — 사람이 보는 것이 그것이다. */
const 잴창정의 = `
  function 잴창(f) {
    var 후보 = [];
    try { 후보.push(f.contentWindow); } catch (e) {}
    try {
      [...f.contentDocument.querySelectorAll('iframe')].forEach(function (x) { try { 후보.push(x.contentWindow); } catch (e) {} });
    } catch (e) {}
    var 최고 = null, 최다 = 30; // 30자 미만이면 아직 안 뜬 것으로 본다
    후보.forEach(function (w) {
      try {
        if (!w || w.document.readyState !== 'complete') return;
        var n = (w.document.body.innerText || '').trim().length;
        if (n > 최다) { 최다 = n; 최고 = w; }
      } catch (e) {}
    });
    return 최고;
  }
`;

// ⚠ full=1이다(F4-09, 2026-09-02) — hub=1로 재면 「한눈에」 그림띠가 숨은 화면을 재게 되어
//   실제 담당자가 보는 화면과 다른 것을 측정한다.
const 기본 = ["inventory.html?full=1|자산 관리 (전체)", "memory.html|AI 지식", "settings.html|설정",
  "supplychain.html|공급망", "products.html|보안제품", "dashboard.html|대시보드"];
const 화면들 = process.argv.slice(2).length ? process.argv.slice(2) : 기본;

const t = await 붙기("app.html");
if (!t) { console.error(`✗ CDP(${PORT})에서 app.html을 못 찾았습니다 — 앱을 띄우고 로그인해 주세요.`); process.exit(2); }
// ⚠ **창을 앞으로 꺼낸다** — 셸이 탭 화면 주소를 requestAnimationFrame에 붙이는데, 창이 화면에
//   없으면 그 프레임이 안 돌아 화면이 영영 안 뜬다(2026-08-30 실측). 재기 전에 보이게 만든다.
try { await fetch(`http://127.0.0.1:${PORT}/json/activate/${t.id}`); } catch { /* 못 해도 계속 — 아래 도착 확인이 막는다 */ }
let 총위반 = 0;
let 못잰것 = 0;
for (const 항목 of 화면들) {
  const [page, label] = 항목.split("|");
  const 파일 = page.split("?")[0];
  await 평가(t, `window.gijoTabs.open(${JSON.stringify(page)}, ${JSON.stringify(label || page)}, {dock:true})`);
  // ★ **도착을 확인하고 잰다**(2026-08-30 게시 관문 [중]) — 종전엔 4.5초 자고 바로 쟀는데,
  //   셸이 탭 틀을 만들어 두고 화면을 아직 안 물린 상태(src="" → about:blank)면 그 틀의
  //   contentWindow가 **셸 자신**을 가리킨다. 그러면 6화면을 「쟀다」면서 셸을 6번 재고
  //   전부 초록으로 끝난다 — 실제로 그랬다. 주소가 그 화면이 될 때까지 기다린다.
  let 도착 = false;
  for (let i = 0; i < 40 && !도착; i++) { // 20초 — 큰 화면(내 지식 2,000요소)은 느리다
    await 잠깐(500);
    도착 = await 평가(t, `(() => {${잴창정의}
      const f = [...document.querySelectorAll('iframe')].find(x => x.classList.contains('on'));
      if (!f) return false;
      try {
        // ⚠ **바깥 틀의 주소**로 도착을 판정한다 — 허브 화면(triage?panel=vuln 등)은 속에 다른
        //   화면(vulnscan)을 물기 때문에, 속 주소로 대조하면 제대로 떠 있어도 「못 쟀다」가 된다.
        //   잴 때는 그 속(가장 안쪽)을 재는 것이 맞다 — 사람이 보는 것이 그것이라서.
        // ⚠ **갈아타기를 인정한다**(2026-08-30) — 흡수된 화면(memory→aihub?panel=knowledge)은
        //   요청한 주소로 안 남는다. 그건 제품이 옳게 도는 것이지 「못 잰 것」이 아니다.
        //   그래서 바깥이든 속이든 **어느 창이든** 그 파일이 있으면 도착으로 본다.
        const 창들 = [f.contentWindow].concat(
          [...f.contentDocument.querySelectorAll('iframe')].map(function (x) { try { return x.contentWindow; } catch (e) { return null; } }).filter(Boolean));
        const 맞음 = 창들.some(function (w) { try { return w.location.href.includes(${JSON.stringify(파일)}); } catch (e) { return false; } });
        // 갈아탄 경우(요청 파일이 어디에도 없음)도 속틀에 진짜 내용이 있으면 도착으로 본다.
        const 잴것 = 잴창(f);
        if (!잴것) return false;
        if (!맞음 && 잴것 === f.contentWindow) return false; // 셸이 그 자리에 있는 경우를 막는 최소 방어
        return true;
      } catch (e) { return false; }
    })()`).catch(() => false);
  }
  if (!도착) {
    못잰것++;
    console.log(`■ ${page} — ★ 못 쟀다(화면이 안 떴거나 셸이 그 자리에 있다). **초록으로 치지 않는다.**`);
    continue;
  }
  const 결과 = await 평가(t, `(() => {${잴창정의}
    const f = [...document.querySelectorAll('iframe')].find(x => x.classList.contains('on'));
    const w = 잴창(f);
    if (!w) return { 오류: '잴 창을 못 찾았다' };
    if (!w.document.documentElement.classList.contains('theme-light')) return { 오류: '이 틀이 라이트 테마가 아니다(프로 셸에서 재야 한다)' };
    return Object.assign({ url: w.location.href.split('/').pop().slice(0, 40) }, w.eval(${JSON.stringify(재기)}));
  })()`).catch((e) => ({ 오류: String(e).slice(0, 100) }));
  if (결과.오류) { 못잰것++; console.log(`■ ${page} — ★ ${결과.오류}`); continue; }
  총위반 += 결과.나쁜수;
  console.log(`■ ${page} [${결과.url}] — 잰 요소 ${결과.잰것}개 · 4.5:1 미만 ${결과.나쁜수}개`);
  (결과.나쁜것 || []).forEach((x) => console.log(`   ${String(x.대비).padStart(5)}:1  ${x.크기.padStart(7)}  "${x.글}"  ${x.색} / ${x.배경}  [${x.클래스}]`));
}
console.log(`\n합계 위반 ${총위반}곳 · 못 잰 화면 ${못잰것}개`);
// ★ fail-closed — 못 잰 것이 있으면 초록이 아니다(「0건」과 「안 쟀다」는 다른 말이다).
process.exit(총위반 || 못잰것 ? 1 : 0);
