#!/usr/bin/env node
// tools/ui-check.mjs — 화면 동작을 **기계가 판정한다**(사람 눈이 아니라).
//
// tools/gui-walkthrough.mjs 와 나누는 역할:
//   · gui-walkthrough — 전 화면 스크린샷. 판정은 **사람**이 한다(육안 검증)
//   · 이 도구        — 몇 가지를 **단정**한다. 통과/실패가 종료 코드로 나온다
// 스크린샷은 회차마다 사람이 봐야 하고, 「이상한지」를 사람이 알아채야 한다.
// 이 도구는 회귀가 나면 **사람이 안 봐도** 빨간불이 된다.
//
// 왜 만들었나 (2026-08-09): 그날 📌 선택 칩·대시보드·상단바를 손으로 확인했다. 같은 날
// 손으로 하는 검증이 어떻게 사라지는지도 봤다 — keyleak-check는 만든 날부터 아무도 안 불렀고,
// mac 재서명 훅의 감시는 stderr를 못 읽어 **항상 통과**하고 있었다.
//
// ⚠ 의존성을 늘리지 않는다. gui-walkthrough·gen-screenshots는 playwright-core를 쓰는데
//   그 패키지는 **client/package.json에 선언조차 되어 있지 않다**(2026-08-09 확인) — 그래서
//   이 Mac에서는 두 도구가 아예 못 돈다. 여기서는 Node에 내장된 WebSocket으로 CDP를 직접 쓴다.
//   (Node 18+ 전역 WebSocket. 설치할 것이 없다)
//
// 사용:
//   1) 앱을 CDP 포트로 띄운다:  cd client && npx electron . --remote-debugging-port=9223
//   2) 계정은 환경변수로 준다(비밀번호를 코드에 적지 않는다 — tools/qa-account.mjs):
//        PW="$(security find-generic-password -a gijo-qa -s gijo-qa-pass -w)"
//        GIJO_ADMIN_USER=<계정> GIJO_ADMIN_PASSWORD="$PW" node tools/ui-check.mjs
//
// 종료 코드: 실패 있으면 1
import { account } from "./qa-account.mjs";

const PORT = process.env.GIJO_CDP_PORT || "9223";
const 결과 = [];
const 기록 = (이름, 통과, 내용) => 결과.push({ 이름, 통과, 내용: String(내용 ?? "").slice(0, 200) });
const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));

const { user, pass } = account("화면 검사");

/**
 * 셸 페이지에 붙는다. 페이지가 바뀌면(로그인 후) 다시 붙는다.
 *
 * ⚠ CDP 대상이 **여럿**이다 — 셸(app.html) 말고도 대화창(console.html)이 따로 잡힌다.
 *   그냥 「첫 페이지」를 집으면 회차마다 다른 것이 걸려 조용히 엉뚱한 곳을 검사한다
 *   (2026-08-09에 실제로 그랬다 — 「로그인 실패」로 나왔지만 실은 console.html을 보고 있었다).
 *   그래서 **무엇을 원하는지 이름으로 고른다.**
 */
async function 붙기(조각) {
  const 우선 = 조각 ? [조각] : ["app.html", "login"];
  for (let i = 0; i < 40; i++) {
    try {
      const 목록 = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === "page");
      for (const 이름 of 우선) {
        const t = 목록.find((x) => x.url.includes(이름));
        if (t) return t;
      }
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
  for (let i = 0; i < 300; i++) { if (답.has(1)) break; await 잠깐(50); }
  ws.close();
  const m = 답.get(1);
  if (!m) throw new Error("CDP 응답 없음(시간 초과)");
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "평가 오류");
  return m.result.result.value;
}

try {
  let 대상 = await 붙기(null);
  if (!대상) {
    console.error(`CDP(${PORT}) 연결 실패 — 앱이 --remote-debugging-port=${PORT} 로 떠 있어야 합니다.`);
    process.exit(2);
  }

  // ── 로그인 ────────────────────────────────────────────────────────────────
  if (대상.url.includes("login")) {
    // ⚠ el.value = "..." 만으로는 프레임워크가 못 알아챈다 — 네이티브 setter + input 이벤트를 쓴다.
    await 평가(대상, `(()=>{
      const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
      const u=document.querySelector('#username'), p=document.querySelector('#password');
      if(!u||!p) return '입력칸 없음';
      set(u, ${JSON.stringify(user)}); set(p, ${JSON.stringify(pass)});
      const b=document.querySelector('#loginBtn'); if(b) b.click();
      return 'ok';
    })()`);
    await 잠깐(6000);

    // ⚠ 중복 로그인(409)을 「비밀번호가 틀렸다」로 오진하지 않는다.
    //   담당자가 이미 앱을 켜 두었거나, 검사 전에 API로 로그인해 둔 세션이 있으면
    //   서버가 「이미 다른 곳에서 로그인 중입니다」로 막고 화면에 «강제 로그인» 단추를 띄운다.
    //   그걸 안 눌러 주면 검사가 실패하는데, **원인을 계정 탓으로 적으면 사람이 엉뚱한 데를 판다**
    //   (2026-08-10 실측 — 실제로 그렇게 한 번 헤맸다).
    const 중복 = await 평가(대상, `(()=>{
      const b=document.getElementById('dupForce');
      if(b && getComputedStyle(b).display!=='none'){ b.click(); return true; }
      return false;
    })()`).catch(() => false);
    if (중복) await 잠깐(6000);

    대상 = (await 붙기("app.html")) ?? (await 붙기(null));
  }
  기록("로그인", 대상.url.includes("app.html"), 대상.url.split("/").pop() + (대상.url.includes("app.html") ? "" : " — 아래 사유 참고"));
  if (!대상.url.includes("app.html")) {
    // 화면이 남긴 말을 그대로 옮긴다 — 지어내지 않는다.
    const 사유 = await 평가(대상, `(()=>{
      const t=(document.body.innerText||'').replace(/\\s+/g,' ');
      const m=t.match(/[^.|]*(이미 다른 곳|잘못|실패|오류|만료)[^.|]*/);
      return m? m[0].trim().slice(0,120) : '';
    })()`).catch(() => "");
    throw new Error(사유 ? `로그인 실패 — 화면 메시지: ${사유}` : "로그인 실패 — 화면에 사유가 없습니다(서버 연결·계정 확인)");
  }

  // ── ① 상단바가 창 버튼을 덮지 않는가 ──────────────────────────────────────
  // mac은 신호등이 **왼쪽**이라 왼쪽 여백을 안 비우면 첫 단추가 그 위에 올라간다(사용자 신고).
  // ⚠ 숫자를 박지 않는다 — 신호등 폭은 배율에 따라 변한다(배율 0.8에서 85px, 1.5에서 약 45px).
  //   Windows는 env가 0이라 이 검사가 그대로 통과한다(같은 코드로 두 OS를 본다).
  const 상단바 = await 평가(대상, `(()=>{
    const tb=document.querySelector('.topbar'); if(!tb) return null;
    const p=document.createElement('div');
    p.style.cssText='position:fixed;left:0;top:0;width:calc(env(titlebar-area-x,0px));height:1px;';
    document.body.appendChild(p); const 신호등=parseFloat(getComputedStyle(p).width)||0; p.remove();
    const b=tb.querySelector('button');
    return {신호등, 첫단추: b? Math.round(b.getBoundingClientRect().left) : null};
  })()`);
  기록("상단바가 창 버튼을 안 덮는다",
    !!상단바 && 상단바.첫단추 !== null && 상단바.첫단추 >= 상단바.신호등,
    상단바 ? `신호등 ${상단바.신호등}px · 첫 단추 x=${상단바.첫단추}` : ".topbar 없음");

  // ── ② 대시보드가 실제로 그려지는가 ────────────────────────────────────────
  await 평가(대상, `(()=>{const t=[...document.querySelectorAll('.tab')].find(x=>/대시보드/.test(x.textContent)); if(t) t.click(); return !!t;})()`);
  await 잠깐(2500);
  const 대시 = await 평가(대상, `(()=>{
    const f=[...document.querySelectorAll('iframe')].find(x=>(x.src||'').includes('dashboard'));
    if(!f||!f.contentDocument) return null;
    const d=f.contentDocument, r=f.getBoundingClientRect();
    return {보임: r.width>0&&r.height>0,
            가로스크롤: d.documentElement.scrollWidth > d.documentElement.clientWidth+1,
            글자수: (d.body.innerText||'').length};
  })()`);
  기록("대시보드가 그려진다", !!대시 && 대시.보임 && 대시.글자수 > 200, 대시 ? `본문 ${대시.글자수}자` : "iframe 접근 실패");
  // 가로 스크롤이 생기면 반응형이 깨진 것이다(2026-08-08 반응형 작업의 회귀 감시).
  기록("가로 스크롤이 없다", !!대시 && !대시.가로스크롤, 대시 && 대시.가로스크롤 ? "가로 스크롤 발생 — 반응형이 깨졌습니다" : "없음");

  // ── ③ 📌 선택 칩 ─────────────────────────────────────────────────────────
  // ⚠ **붙기 전에 숨어 있는 것부터 확인한다.** 늘 떠 있는 칩은 「붙었다」로 오판된다.
  const 전 = await 평가(대상, `(()=>{const e=document.getElementById('csSel'); return e? getComputedStyle(e).display!=='none' : null;})()`);
  기록("칩이 처음엔 숨어 있다", 전 === false, 전 === null ? "#csSel 없음" : 전 ? "이미 떠 있음" : "숨김");

  const 고른것 = await 평가(대상, `(()=>{
    const f=[...document.querySelectorAll('iframe')].find(x=>(x.src||'').includes('dashboard'));
    const el=f&&f.contentDocument&&f.contentDocument.querySelector('.ptx');
    if(!el) return null; const 글=el.textContent.trim(); el.click(); return 글;
  })()`);
  await 잠깐(2000);
  const 후 = await 평가(대상, `(()=>{const e=document.getElementById('csSel'); return e&&getComputedStyle(e).display!=='none'? e.textContent.trim() : null;})()`);
  기록("📌 칩이 선택을 싣는다", !!후 && 후.includes("📌"),
    고른것 === null ? "고를 항목이 없습니다(대시보드 할 일 0건 — 데이터를 넣고 다시 도세요)" : (후 ?? "칩이 안 떴습니다"));

  // 붙기만 하고 안 풀리면 다음 지시가 엉뚱한 것을 가리킨다 — 푸는 것까지 본다.
  await 평가(대상, `(()=>{const x=document.querySelector('#csSel .x'); if(x) x.click(); return !!x;})()`);
  await 잠깐(1200);
  const 해제 = await 평가(대상, `(()=>{const e=document.getElementById('csSel'); return e? getComputedStyle(e).display==='none' : null;})()`);
  기록("✕로 선택이 풀린다", 해제 === true, 해제 === true ? "숨김으로 복귀" : "안 풀립니다");
} catch (e) {
  기록("검사", false, e.message);
}

const 실패 = 결과.filter((r) => !r.통과).length;
console.log("\n━━ 화면 검사 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
for (const r of 결과) console.log(`  ${r.통과 ? "✅" : "❌"} ${r.이름.padEnd(24)} ${r.내용}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  통과 ${결과.length - 실패} · 실패 ${실패}\n`);
process.exit(실패 > 0 ? 1 : 0);
