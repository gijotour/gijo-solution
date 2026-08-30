// tools/narrow-probe.mjs — 좁은 폭(대화창 최대 = 화면 판 420px) 글자 깨짐 실측기.
//
// ■ 왜 (2026-08-31 사장님 실화면 캡처): 대화창을 최대로 키우면 화면 판이 하한 420px까지
//   좁아지는데, 그때 「올린 문서 120」이 두 줄로 꺾이고 「장애노트 저장」 버튼 글자가 중간에서
//   깨지고 입력 안내문이 잘렸다. 지시: 「내용들이 대화창 최대일 때 글씨가 안 깨지게 —
//   그래서 엑셀처럼이고, 모든 메뉴도 동일하게 변경 희망」.
//   코드만 보고 「안 깨진다」고 말하지 않는다 — 이 실측기가 화면마다 깨짐을 **센다**
//   (밀도 라운드 교훈: 실측 없이 「줄었다」 금지 — 정적분석 2회 오판).
//
// ■ 무엇을 세나 (판정 3종 — 엑셀 방식(nowrap+ellipsis)은 깨짐이 아니다):
//   ① 넘침: 글자 요소의 scrollWidth > clientWidth+2 인데 말줄임 처리(ellipsis)가 아닌 것
//      — 글자가 상자 밖으로 삐져나가거나 잘려 보인다.
//   ② 버튼 꺾임: 버튼류의 실제 높이가 줄높이 1.9배 초과 — 「장애노트 저장」이 두 줄로 깨진 부류.
//      단 **문장 칩**(질문 제안 등 15자 초과 + white-space:normal)은 두 줄이 설계다 — 제외.
//   ③ 부모 밖: 요소 오른끝이 스크롤 부모의 오른끝을 3px 넘게 벗어남(가로 스크롤 상자 안은 제외).
//   ④ 겹침: 글자 요소끼리 서로 30% 이상 포개짐(조상-자손 관계 제외) — 지도·히트맵이 좁은 폭에서
//      뭉개질 때의 부류(2026-08-31 사장님 캡처: 지도 탭 글자가 서로 얹힘). 시각 판은 말줄임이
//      아니라 **반응형**이 정답이라, 이 판정이 그 수리를 강제한다.
//
// ■ --prep '<js>' : 화면 프레임 안에서 측정 **전에** 실행할 한 줄(내부 탭 전환용).
//   예: --only inventory --prep "[...document.querySelectorAll('.cov-tab')].find(t=>t.textContent.includes('지도'))?.click()"
//
// ■ 쓰기:  node tools/narrow-probe.mjs [--port 9226] [--width 420] [--only aihub.html]
//   앱을 CDP로 띄우고 로그인한 상태에서 돈다. 대화창 폭을 강제로 최대(화면 판=--width)로
//   만든 뒤 메뉴의 모든 화면을 차례로 도킹해 잰다. 끝에 화면별 표 + 최악 사례를 낸다.
//   종료코드: 못 잰 화면이 있으면 1 (거짓 초록 방지 — 실측기 자신이 fail-closed).

const 인자 = process.argv.slice(2);
function 옵션(이름, 기본) { const i = 인자.indexOf("--" + 이름); return i >= 0 ? 인자[i + 1] : 기본; }
const PORT = 옵션("port", process.env.GIJO_CDP_PORT || "9226");
const 판폭 = parseInt(옵션("width", "420"), 10);
const ONLY = 옵션("only", "");
const PREP = 옵션("prep", "");

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
async function 페이지들() {
  const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return l.filter((x) => x.type === "page");
}
async function 붙기(조각, 초 = 15) {
  for (let i = 0; i < 초 * 2; i++) {
    try { const t = (await 페이지들()).find((x) => x.url.includes(조각)); if (t) return t; } catch { /* 아직 */ }
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
  for (let i = 0; i < 600; i++) { if (답.has(1)) break; await 잠깐(50); }
  ws.close();
  const m = 답.get(1);
  if (!m) throw new Error("CDP 응답 없음");
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "평가 오류");
  return m.result.result.value;
}

const 셸 = await 붙기("app.html");
if (!셸) { console.error("✗ 셸(app.html)을 못 찾았습니다 — 앱을 CDP " + PORT + "로 띄우고 로그인하세요."); process.exit(1); }

// ── 1) 대화창을 최대로 — 화면 판을 하한(판폭)까지 좁힌다 ─────────────────────────
await 평가(셸, `(()=>{
  const work = document.querySelector(".work");
  if (!work) return "★ .work 없음";
  const w = Math.max(360, work.clientWidth - ${판폭});
  work.style.setProperty("--console-w", w + "px");
  return "대화폭 " + w + "px → 화면 판 약 ${판폭}px";
})()`).then((r) => console.log("· " + r));

// ── 2) 잴 화면 목록 — 메뉴가 정본(gijoScreenList) ────────────────────────────────
let 화면들 = await 평가(셸, `(window.gijoScreenList ? window.gijoScreenList() : []).filter(x => x.page).map(x => ({ page: x.page, label: x.label }))`);
// 같은 파일은 한 번만(딥링크 변형은 파일 대표 1개로) — 단, 쿼리로 다른 판이 뜨는 것은 각각.
const 본파일 = new Set();
화면들 = 화면들.filter((x) => { const k = x.page; if (본파일.has(k)) return false; 본파일.add(k); return true; });
if (ONLY) 화면들 = 화면들.filter((x) => x.page.includes(ONLY));
console.log("· 잴 화면 " + 화면들.length + "개 (판폭 " + 판폭 + "px)\n");

const 결과 = [];
const 못잼 = [];
for (const 화 of 화면들) {
  await 평가(셸, `window.gijoTabs && window.gijoTabs.open(${JSON.stringify(화.page)}, ${JSON.stringify(화.label)}, { dock: true })`);
  await 잠깐(3200);
  if (PREP) {
    await 평가(셸, `(()=>{ const f = document.querySelector("#screens iframe.on") || document.querySelector("#screens iframe");
      try { return f.contentWindow.eval(${JSON.stringify(PREP)}); } catch (e) { return "prep 오류: " + e; } })()`)
      .then((r) => console.log("  · prep: " + (r === undefined ? "실행" : String(r).slice(0, 60))));
    await 잠깐(1500);
  }
  try {
    const r = await 평가(셸, `(()=>{
      const f = document.querySelector("#screens iframe.on") || document.querySelector("#screens iframe");
      if (!f) return { err: "프레임 없음" };
      let doc; try { doc = f.contentDocument; } catch (e) { return { err: "접근 불가" }; }
      if (!doc || !doc.body) return { err: "문서 없음" };
      const 안주소 = (() => { try { return f.contentWindow.location.href.split("/").pop().split("?")[0]; } catch (e) { return ""; } })();
      const 글자수 = (doc.body.innerText || "").length;
      if (글자수 < 30) return { err: "내용 없음(" + 글자수 + "자)", 안주소 };
      const 깨짐 = []; let 잰요소 = 0;
      const 말줄임인가 = (cs) => cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap";
      const 스크롤부모 = (el) => { let p = el.parentElement; while (p && p !== doc.body) { const c = getComputedStyle(p); if (/(auto|scroll)/.test(c.overflowX)) return p; p = p.parentElement; } return null; };
      for (const el of doc.body.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const 글 = (el.childElementCount === 0 ? (el.textContent || "").trim() : "");
        const 태그 = el.tagName;
        // ① 넘침(글자 요소 한정)
        if (글.length > 1) {
          잰요소++;
          if (el.scrollWidth > el.clientWidth + 2 && !말줄임인가(cs) && cs.overflowX !== "hidden") {
            깨짐.push({ 종류: "넘침", 글: 글.slice(0, 24), 자리: 태그 + "." + String(el.className).split(" ")[0] });
          }
        }
        // ② 버튼 꺾임 — 문장 칩(15자 초과 + wrap 허용 설계)은 두 줄이 정상이라 제외
        if ((태그 === "BUTTON" || /\\bbtn\\b|g-btn/.test(String(el.className))) && 글.length > 1) {
          const 문장칩 = 글.length > 15 && cs.whiteSpace !== "nowrap" && cs.textAlign === "left";
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
          // 패딩을 뺀 **내용 높이**로 잰다 — 패딩 9px 단추가 한 줄인데도 걸리던 오차(실측).
          const 내용높이 = rect.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
          if (!문장칩 && 내용높이 > lh * 1.9) 깨짐.push({ 종류: "버튼꺾임", 글: 글.slice(0, 24), 자리: 태그 + "." + String(el.className).split(" ")[0] });
        }
        // ⑤ 세로뭉개짐 — 좁은 기둥(<110px)에 글자가 3줄 이상으로 접혀 세로로 흘러내림
        //    (지도 영역이 28px로 눌려 IP가 한 글자씩 세로로 서던 부류 — leaf가 아니어도 잡게
        //     인라인 자식(b·span·i)만 가진 요소까지 본다).
        {
          const 인라인만 = el.childElementCount > 0 && [...el.children].every((c) => /^(B|I|SPAN|EM|STRONG|SMALL|CODE)$/.test(c.tagName));
          const 본문 = (el.childElementCount === 0 || 인라인만) ? (el.textContent || "").trim() : "";
          if (본문.length > 5 && rect.width > 0 && rect.width < 110) {
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
            const 알맹이 = rect.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
            if (알맹이 > lh * 2.7) 깨짐.push({ 종류: "세로뭉개짐", 글: 본문.slice(0, 20), 자리: 태그 + "." + String(el.className).split(" ")[0] });
          }
        }
        // ③ 부모 밖(가로 스크롤 상자 안은 정상 — 엑셀 방식 도망)
        //    ⚠ 통째로 화면 밖에 주차된 것(닫힌 서랍 — transform으로 우측 대기)은 깨짐이 아니다.
        if (글.length > 1 && !스크롤부모(el)) {
          const bw = doc.documentElement.clientWidth;
          if (rect.left < bw - 2 && rect.right > bw + 3) 깨짐.push({ 종류: "화면밖", 글: 글.slice(0, 24), 자리: 태그 + "." + String(el.className).split(" ")[0] });
        }
        if (깨짐.length > 400) break; // 폭주 방지 — 400이면 이미 「전면 개편 필요」다
      }
      // ④ 겹침 — 글자 리프끼리 30% 이상 포개짐(지도·히트맵 뭉개짐 부류). 조상-자손 제외.
      // ⚠ **보이는 사각형**으로 잰다 — getBoundingClientRect는 조상 overflow:hidden이
      //   잘라낸 부분까지 포함해, 말줄임(엑셀 방식) 행을 겹침으로 오탐한다(sessions 55건 실측).
      {
        const 보이는사각 = (el, r0) => {
          let r = { left: r0.left, top: r0.top, right: r0.right, bottom: r0.bottom };
          let p = el.parentElement;
          while (p && p !== doc.documentElement) {
            const pc = getComputedStyle(p);
            if (pc.overflowX !== "visible" || pc.overflowY !== "visible") {
              const pr = p.getBoundingClientRect();
              r.left = Math.max(r.left, pr.left); r.right = Math.min(r.right, pr.right);
              r.top = Math.max(r.top, pr.top); r.bottom = Math.min(r.bottom, pr.bottom);
            }
            p = p.parentElement;
          }
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: Math.max(0, r.right - r.left), height: Math.max(0, r.bottom - r.top) };
        };
        const 리프 = [];
        for (const el of doc.body.querySelectorAll("*")) {
          if (리프.length >= 350) break;
          if (el.childElementCount !== 0) continue;
          const 글 = (el.textContent || "").trim();
          if (글.length < 2) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.2) continue;
          // 여러 줄로 감긴 인라인은 제외 — boundingRect가 줄상자들의 합이라 이웃과 원리상 포개진다(공급망 오탐 실측).
          if (cs.display === "inline" && el.getClientRects().length > 1) continue;
          const r = 보이는사각(el, el.getBoundingClientRect());
          if (r.width < 8 || r.height < 8) continue;
          리프.push({ el, r, 글 });
        }
        let 겹침수 = 0;
        for (let i = 0; i < 리프.length && 겹침수 < 60; i++) for (let k = i + 1; k < 리프.length; k++) {
          const a = 리프[i], b = 리프[k];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (x <= 0 || y <= 0) continue;
          const 작은 = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
          if (x * y > 작은 * 0.3) {
            겹침수++;
            if (겹침수 <= 5) 깨짐.push({ 종류: "겹침", 글: (a.글.slice(0, 12) + "⊕" + b.글.slice(0, 12)), 자리: a.el.tagName + "." + String(a.el.className).split(" ")[0] });
          }
        }
        for (let n = 5; n < 겹침수; n++) 깨짐.push({ 종류: "겹침", 글: "(집계)", 자리: "(여러 곳)" });
      }
      // 같은 (종류,자리) 반복은 묶는다 — 행 100개가 같은 셀이면 1무늬다
      const 묶음 = {};
      for (const b of 깨짐) { const k = b.종류 + "|" + b.자리; (묶음[k] = 묶음[k] || { ...b, 수: 0 }).수++; }
      return { 안주소, 잰요소, 총깨짐: 깨짐.length, 무늬: Object.values(묶음).sort((a, b) => b.수 - a.수).slice(0, 5) };
    })()`);
    if (r.err) { 못잼.push(화.page + " — " + r.err); console.log("✗ " + 화.label + " (" + 화.page + ") — " + r.err); continue; }
    결과.push({ ...화, ...r });
    console.log((r.총깨짐 ? "△" : "✔") + " " + 화.label.padEnd(14) + " 깨짐 " + String(r.총깨짐).padStart(3) + " (잰 글자요소 " + r.잰요소 + ", 안=" + r.안주소 + ")"
      + (r.무늬.length ? "  ← " + r.무늬.map((m) => m.종류 + "×" + m.수 + " " + m.자리).join(" · ") : ""));
  } catch (e) { 못잼.push(화.page + " — " + String(e).slice(0, 60)); console.log("✗ " + 화.label + " — " + String(e).slice(0, 60)); }
}

console.log("\n══ 요약 (판폭 " + 판폭 + "px) ══");
결과.sort((a, b) => b.총깨짐 - a.총깨짐);
for (const r of 결과) console.log(String(r.총깨짐).padStart(4) + "  " + r.label + " (" + r.page + ")");
const 총 = 결과.reduce((n, r) => n + r.총깨짐, 0);
console.log("합계 " + 총 + "건 / " + 결과.length + "화면" + (못잼.length ? "  ⚠ 못 잰 화면 " + 못잼.length + "개: " + 못잼.join(" | ") : ""));
process.exit(못잼.length ? 1 : 0);
