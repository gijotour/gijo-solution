// QA 계층 [shell] — 앱 탭 셸 실화면 검증 (Electron CDP 9223 필요)
//
// 무엇을 지키나: 담당자가 **쓰던 맥락을 잃지 않는 것**.
//   · 화면을 여러 개 열어 두고 오가도 보던 상태(스크롤·필터·입력)가 남는가
//   · 화면을 옮겨도 대화와 입력 중 초안이 끊기지 않는가
//   · 지시가 "보고 있는 화면"을 향하는가
// 이 성질이 깨지면 담당자는 매번 처음부터 다시 찾아야 한다 — 렌더만 보는 스윕으로는 안 잡힌다.
//
// 4.0.0에서 팝업 셸(대시보드 위 팝업)을 걷어내고 탭 셸로 바꿨다. 팝업 시절 검사(슬롯·핀·
// 배경막·높이 드래그)는 그 구조와 함께 사라졌고, 지켜야 할 성질만 탭 기준으로 다시 썼다.
// 계정은 claude-deploy(실사용 세션 보호).
import { createRequire } from "module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "client", "package.json"));
const { chromium } = require("playwright-core");

const PW = process.env.QA_PASS || process.env.GIJO_ADMIN_PASSWORD;
if (!PW) { console.error("QA_PASS/GIJO_ADMIN_PASSWORD 필요"); process.exit(2); }
const SHOT = path.join(ROOT, ".tmp-reports") + path.sep;
const R = { pass: [], fail: [] };
const ok = (n, cond, detail) => { (cond ? R.pass : R.fail).push(n + (detail ? " — " + detail : "")); console.log((cond ? "✅ " : "❌ ") + n + (detail ? " — " + detail : "")); };

// ⚠ position:fixed 요소는 offsetParent가 늘 null이다 — 그걸로 "보이는가"를 판단하면
//   무엇을 해도 안 보임이라 **실패할 수 없는 검사**가 된다(2026-07-28 실측). 계산된 값으로 본다.
const VIS = `(el) => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0; }`;

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("login.html"));
if (!page) {
  // ⚠ 세 이름만 찾으면 **직전 자동화가 어느 화면에 두고 갔는지**에 따라 즉사한다(2026-08-06 실측:
  //   사전 검증이 sbom.html에 두고 QA를 시작 → "페이지를 찾지 못함" 0초 실패. 제품이 아니라
  //   시작 조건이 깨진 것). 이 제품 창이면 어느 화면이든 붙잡는다 — 어차피 바로 아래에서
  //   login.html로 보내 처음부터 시작한다.
  const m = ctx.pages().find((p) => /app\.html|dashboard\.html|office\.html/.test(p.url()))
    || ctx.pages().find((p) => /\/pages\/[a-z-]+\.html/.test(p.url()) && !p.url().startsWith("devtools"));
  if (!m) { console.error("Electron 페이지를 찾지 못함"); process.exit(2); }
  await m.evaluate(() => { window.gijo.navigateTo("login.html"); }).catch(() => {});
  await m.waitForURL(/login\.html/, { timeout: 10000 });
  page = m;
}

const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 200)));

// 이전 실행 잔여 상태 초기화 — 탭·콘솔 자리가 남아 있으면 "첫 실행"을 못 본다.
await page.evaluate(() => {
  try { localStorage.removeItem("gijo:tabs:v1"); localStorage.setItem("gijo:console:popped", "0"); localStorage.removeItem("gijo:console:draft"); } catch (e) {}
});

// 1) 로그인 → 셸
await page.fill("#serverUrl", "http://localhost:4000");
await page.fill("#username", "claude-deploy");
await page.fill("#password", PW);
await page.evaluate(() => { const c = document.getElementById("savePw"); if (c && c.checked) c.click(); }).catch(() => {});
page.on("dialog", (d) => d.accept().catch(() => {}));
await page.click("#loginBtn");
await page.waitForTimeout(3000);
// 이미 다른 곳에서 로그인 중이면 화면 안에 확인이 뜬다 — 눌러서 강제 로그인한다.
// (4.1.0 전에는 window.confirm이었는데 Electron에서 네이티브 모달이라 자동화가 닫지 못해
//  여기서 영원히 막혔다 — shell 계층이 늘 "login.html"로 실패하던 원인.)
const dup = await page.$("#dupForce");
if (dup && await dup.isVisible()) { await dup.click(); await page.waitForTimeout(3000); }
await page.waitForTimeout(3000);
page = ctx.pages().find((p) => p.url().includes("app.html")) || page;
ok("로그인하면 탭 셸로 들어간다", page.url().includes("app.html"), page.url().split("/").pop());
await page.waitForTimeout(4000);

const snap = () => page.evaluate(() => ({
  탭: [...document.querySelectorAll("#tabBar .tab .nm")].map((t) => t.textContent),
  활성: document.querySelector("#tabBar .tab.on .nm")?.textContent || null,
  프레임: document.querySelectorAll("#screens iframe").length,
  보이는프레임: document.querySelectorAll("#screens iframe.on").length,
  // ⚠ 맥락은 이제 **문장 한 줄**이다(2026-08-20 맥락 문장 개편 — 「지금 「조치」 화면을 보는 중」).
  //   「…」 안 화면 이름만 떼어 본다. 선택·범위가 걸리면 화면 이름이 문장에서 빠지므로(자연어
  //   압축) 그때는 문장 전체를 돌려준다 — 5)번 검사는 깨끗한 탭 전환 직후라 화면꼴이다.
  맥락: ((document.getElementById("csCtx")?.textContent || "").match(/「(.+?)」/) || [])[1]
    || (document.getElementById("csCtx")?.textContent || "").trim() || null,
  activeScreen: window.gijoTabs?.activeScreen() || null,
}));
const clickMenu = async (label) => {
  await page.evaluate((l) => {
    const it = [...document.querySelectorAll("#gijoNav .gn-item")].find((e) => e.querySelector(".gn-label")?.textContent === l);
    it?.querySelector(".gn-label").click();
  }, label);
  await page.waitForTimeout(3200);
};
// 대표 그룹(그룹 줄=메뉴, 2026-08-09 그룹 통합) — 절차 허브는 .gn-item이 아니라 .gn-g를 누른다.
const clickHub = async (name) => {
  await page.evaluate((n) => {
    const gh = [...document.querySelectorAll("#gijoNav .gn-g")].find((e) => e.querySelector(".gn-gname")?.textContent === n);
    gh?.click();
  }, name);
  await page.waitForTimeout(3200);
};

// 2) 첫 실행 — 대시보드 탭 하나
const s0 = await snap();
ok("첫 실행에 대시보드 탭이 열려 있다", s0.탭.includes("대시보드"), s0.탭.join(" | "));

// 3) 메뉴를 눌러도 셸을 떠나지 않고 탭이 늘어난다
//    '취약점'·'조치·승인'은 허브로 흡수됐다(2026-08-09) — 대표 그룹을 눌러 허브 탭을 연다.
const urlBefore = page.url();
await clickHub("우선순위");
await clickHub("조치");
const s1 = await snap();
ok("메뉴 클릭이 탭으로 열린다(화면 이동 아님)", page.url() === urlBefore && s1.탭.length === 3, s1.탭.join(" | "));
ok("보이는 프레임은 하나, 나머지는 살아서 숨는다", s1.프레임 === 3 && s1.보이는프레임 === 1, `프레임 ${s1.프레임} / 보임 ${s1.보이는프레임}`);

// 4) 탭 안이 실제 화면인가(겹 2겹) + 내용이 있는가
const inner = await page.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  try { return { src: decodeURIComponent(f.src.split("/").pop()), 글자: (f.contentDocument.body.innerText || "").trim().length, heal: f.dataset.healTries || "0" }; }
  catch (e) { return { err: String(e).slice(0, 60) }; }
});
ok("탭 안은 화면을 직접 품는다(중간에 허브 없음)", !!inner.src && !/^hub\.html/.test(inner.src), inner.src || inner.err);
ok("활성 탭에 실제 내용이 있다(빈 화면 아님)", inner.글자 > 200, JSON.stringify(inner));

// 5) 맥락 = 보고 있는 탭
ok("명령 맥락이 활성 탭을 따라간다", s1.맥락 === s1.활성, `맥락=${s1.맥락} 활성=${s1.활성}`);
const ph = await page.evaluate(() => document.getElementById("chatInput")?.placeholder || "");
ok("입력칸이 지시 대상을 말해 준다", ph.includes(s1.활성), ph);

// 6) 보던 상태가 남는가 — 탭을 옮겼다 돌아와도 다시 안 읽힌다
await page.evaluate(() => { document.querySelector("#screens iframe.on").contentWindow.__gijoAlive = "표시"; });
await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("우선순위"))?.click());
await page.waitForTimeout(700);
await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("조치"))?.click());
await page.waitForTimeout(900);
const alive = await page.evaluate(() => document.querySelector("#screens iframe.on").contentWindow.__gijoAlive || null);
ok("돌아온 탭이 다시 읽히지 않는다(보던 상태 유지)", alive === "표시", String(alive));

// 7) 대화가 화면을 옮겨도 안 끊긴다 — 팝업을 없앨 수 있었던 근거
await page.fill("#chatInput", "탭을 옮겨도 남아 있어야 한다");
await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("대시보드"))?.click());
await page.waitForTimeout(1200);
const draft = await page.evaluate(() => document.getElementById("chatInput").value);
ok("탭을 옮겨도 입력 중 초안이 남는다", draft.includes("남아 있어야"), draft);

// 8) 지시를 실제로 보내고 답이 콘솔에 실린다
await page.fill("#chatInput", "이 화면에서 뭐 할 수 있어?");
await page.click("#dockSend");
await page.waitForTimeout(1500);
const sent = await page.evaluate(() => ({
  내지시: document.querySelectorAll("#csBody .cs-row.instr").length,
  입력비움: document.getElementById("chatInput").value === "",
}));
ok("지시가 콘솔에 실리고 전송된다", sent.내지시 > 0 && sent.입력비움, JSON.stringify(sent));
let reply = null;
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  reply = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#csBody .cs-row")];
    const last = rows[rows.length - 1];
    return last ? { kind: last.className.replace("cs-row ", ""), 글: (last.querySelector(".cm")?.textContent || "").slice(0, 50) } : null;
  });
  if (reply && reply.kind !== "typing") break;
}
ok("서버 응답이 콘솔에 표시된다", reply && (reply.kind === "reply" || reply.kind === "error"), JSON.stringify(reply));

// 8-b) 답 스트리밍(2026-08-09 전-7) — **흐른 글자가 최종 답으로 갈아 끼워졌는가.**
//   ⚠ 이 검사가 없으면 서버가 SSE를 안 내보내도 클라가 조용히 통짜 경로로 폴백해 아무도 모른다
//     (스트리밍이 죽어도 답은 나오니 QA가 초록이다). 흔적을 남기게 만든 이유가 이것이다.
const 스트림흔적 = await page.evaluate(() => ({
  통로: typeof window.gijo?.sendInstructionStream === "function",
  남은조각: !!document.querySelector(".cs-stream"), // 최종 교체 뒤엔 없어야 한다
}));
ok(
  "답 스트리밍 통로가 있고, 흐른 글자가 최종 답으로 갈아 끼워졌다",
  스트림흔적.통로 && !스트림흔적.남은조각,
  JSON.stringify(스트림흔적)
);

// 8-c) 📌 선택 항목 맥락(2026-08-09 2단계) — 셸 API 계약. 화면 클릭 배선은 selectioncontext 시험이
//   소스로 지키고, 여기서는 **셸에서 실제로 칩이 붙고 ✕로 풀리는지**를 화면으로 본다.
const 칩 = await page.evaluate(async () => {
  const g = window.gijoConsole;
  if (!g || typeof g.select !== "function") return { 통로: false };
  g.select({ label: "QA선택시험", text: "자산 QA선택시험" });
  await new Promise((r) => setTimeout(r, 300));
  // 2026-08-20 맥락 문장 개편 — 📌 칩 대신 문장에 「…QA선택시험… 다루는 중」이 실린다.
  const line = document.getElementById("csCtx");
  const 붙음 = !!line && line.textContent.includes("QA선택시험") && line.textContent.includes("다루는 중");
  // 풀기는 ⋯ 메뉴 → 「선택 풀기」
  document.getElementById("csCtxMore")?.click();
  await new Promise((r) => setTimeout(r, 200));
  [...document.querySelectorAll("#cxPop button")].find((b) => b.textContent.includes("선택 풀기"))?.click();
  await new Promise((r) => setTimeout(r, 300));
  const 풀림 = !!line && !line.textContent.includes("QA선택시험");
  return { 통로: true, 붙음, 풀림 };
});
ok("고른 항목이 맥락 문장(다루는 중)에 실리고 ⋯ 메뉴로 풀린다", 칩.통로 && 칩.붙음 && 칩.풀림, JSON.stringify(칩));

// 9) 화면 안 챗봇 위젯은 뜨지 않는다(지시는 콘솔 한 곳)
const widget = await page.evaluate((visSrc) => {
  const isVis = eval(visSrc);
  const f = document.querySelector("#screens iframe.on");
  try {
    const w = f.contentDocument.getElementById("gijoChatWidget");
    return { 있음: !!w, 보임: isVis(w), display: w ? f.contentWindow.getComputedStyle(w).display : null };
  } catch (e) { return { err: String(e).slice(0, 60) }; }
}, VIS);
ok("탭 안에 화면별 챗봇이 뜨지 않는다(지시는 한 곳)", widget.보임 === false, JSON.stringify(widget));

// 10) ⓘ 화면 설명이 콘솔에서 물어진다
//     ⚠ 대시보드에는 화면 챗봇(gijoChatWidget)이 없어 gijoExplain도 없다 — 위젯이 있는 화면에서 본다.
await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("조치"))?.click());
await page.waitForTimeout(1200);
const explainable = await page.evaluate(() => typeof document.querySelector("#screens iframe.on")?.contentWindow.gijoExplain);
const beforeRows = await page.evaluate(() => document.querySelectorAll("#csBody .cs-row").length);
await page.evaluate(() => document.querySelector("#screens iframe.on").contentWindow.gijoExplain?.());
await page.waitForTimeout(2000);
const afterRows = await page.evaluate(() => document.querySelectorAll("#csBody .cs-row").length);
ok("화면 ⓘ 설명을 콘솔이 대신 묻는다", explainable === "function" && afterRows > beforeRows, `통로=${explainable}, ${beforeRows} → ${afterRows}`);

// 11) 탭 닫기·고정
await page.evaluate(() => [...document.querySelectorAll("#tabBar .tab")].find((t) => t.textContent.includes("우선순위"))?.querySelector(".x").click());
await page.waitForTimeout(800);
const s2 = await snap();
ok("탭을 닫으면 프레임도 함께 사라진다", s2.탭.length === 2 && s2.프레임 === 2, s2.탭.join(" | "));

// 12) 콘솔을 창으로 빼기 → 화면이 넓어짐 → 되붙이기
// ⚠ **어느 축이 넓어지는지는 배치에 달렸다**(2026-08-01 시안 3 가로 배치 도입).
//   예전엔 콘솔이 항상 화면 **아래**에 있어서 빼면 높이가 늘었다. 지금은 창이 넓으면
//   콘솔이 **옆**에 서므로 빼면 **너비**가 는다. 높이만 재던 옛 검사는 정상 동작을
//   실패로 보고했다(실측 1082→1036: 셸 창이 콘솔 창 자리를 내주며 줄어든 것).
//   ⚠ 그리고 **절대 픽셀로도 재면 안 된다**(같은 날 두 번째로 데임). 콘솔을 빼내면 셸 창
//   자체가 콘솔 창 자리를 내주려 작아진다 — 안쪽에서는 넓어졌는데 절대값은 줄어든다
//   (실측: 한 실행 1188→1196 늘고, 다른 실행 1788→1506 줄었다. 둘 다 정상 동작이다).
//   그래서 창 크기와 무관한 것을 본다: **화면 영역이 작업 영역을 다 차지하는가.**
const 차지비율 = () => page.evaluate(() => {
  const s = document.getElementById("screens").getBoundingClientRect();
  const w = document.querySelector(".work").getBoundingClientRect();
  const 가로 = document.querySelector(".work")?.classList.contains("console-side") ?? false;
  return { 비율: 가로 ? +(s.width / w.width).toFixed(3) : +(s.height / w.height).toFixed(3), 가로 };
});
const 전 = await 차지비율();
await page.evaluate(() => document.getElementById("csToggleHost").click());
await page.waitForTimeout(4500);
const cw = ctx.pages().find((p) => p.url().includes("console.html"));
ok("콘솔을 별도 창으로 빼낼 수 있다", !!cw, cw ? "console.html" : "창 없음");
const 후 = await 차지비율();
const 접힘 = await page.evaluate(() => document.body.classList.contains("console-popped"));
ok(
  "콘솔을 빼면 화면이 그 자리를 가져간다",
  접힘 && 후.비율 > 전.비율 && 후.비율 > 0.95,
  `작업영역 차지 ${전.비율} → ${후.비율} (${전.가로 ? "가로" : "세로"} 배치 기준)`
);
if (cw) {
  await cw.waitForTimeout(2500);
  // 위 snap()과 같은 이유 — 문장에서 「…」 안 화면 이름만 뗀다(2026-08-20 맥락 문장).
  const wctx = await cw.evaluate(() => ((document.getElementById("csCtx")?.textContent || "").match(/「(.+?)」/) || [])[1] || null);
  const cur = (await snap()).활성;
  ok("빼낸 창에도 맥락이 전달된다", wctx === cur, `창=${wctx} 활성=${cur}`);
  await cw.evaluate(() => document.getElementById("csToggleHost").click());
  await page.waitForTimeout(3000);
  const back = await page.evaluate(() => ({ 접힘: document.body.classList.contains("console-popped"), 입력창: !!document.getElementById("chatInput") }));
  ok("창을 닫으면 콘솔이 다시 아래에 붙는다", !back.접힘 && back.입력창, JSON.stringify(back));
}

// 13) 탭을 창으로 빼내기 — 화면 하나를 직접 띄운다
await page.evaluate(() => document.getElementById("tbPopout").click());
await page.waitForTimeout(5000);
const po = ctx.pages().find((p) => p.url().includes("popout=1"));
ok("탭을 별도 창으로 빼낼 수 있다", !!po, po ? decodeURIComponent(po.url().split("/").pop()) : "창 없음");
if (po) {
  await po.waitForTimeout(2500);
  const pst = await po.evaluate(() => {
    const nav = document.getElementById("gijoNav");
    return {
      글자: (document.body.innerText || "").trim().length,
      메뉴숨김: !nav || getComputedStyle(nav).display === "none",
      방향버튼: !!document.querySelector(".gijo-orient"),
    };
  });
  ok("분리창이 화면을 직접 띄운다(내용 있음)", pst.글자 > 200 && !/^hub\.html/.test(decodeURIComponent(po.url().split("/").pop())), JSON.stringify(pst));
  ok("분리창은 메뉴를 숨기고 가로/세로 버튼을 준다", pst.메뉴숨김 && pst.방향버튼, JSON.stringify(pst));
  await po.close().catch(() => {});
  await page.waitForTimeout(1000);
}

// 14) 재시작해도 탭이 복원된다
await page.reload();
await page.waitForTimeout(6000);
const s3 = await snap();
ok("셸을 다시 열어도 탭이 복원된다", s3.탭.length >= 2, s3.탭.join(" | "));

// 15) 설정 관리자 구역에 업데이트가 펼쳐져 보인다
//     두 번 깨졌던 자리다(2026-07-28): 링크가 옛 주소라 엉뚱한 곳이 열렸고, 닿아도 접혀 있었다.
//     설정 그룹 정리(2026-08-09) — '관리자'는 사이드바 항목이 아니라 settings.html 안
//     구역 탭줄(#secNav)의 탭이다(admin 게이트가 되살린다). 「설정」을 열고 탭을 누른다.
await clickMenu("설정");
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  const t = [...(f?.contentDocument?.querySelectorAll("#secNav .sec-tab") ?? [])].find((x) => x.textContent.includes("관리자"));
  t?.click(); // location.replace(s=admin)로 프레임이 다시 뜬다
});
await page.waitForTimeout(3500);
const upd = await page.evaluate((visSrc) => {
  const isVis = eval(visSrc);
  const f = document.querySelector("#screens iframe.on");
  try {
    const d = f.contentDocument;
    const p = [...d.querySelectorAll(".panel")].find((x) => (x.querySelector(".panel-title")?.textContent || "").trim().startsWith("업데이트"));
    return { 활성: document.querySelector("#tabBar .tab.on .nm")?.textContent, 보임: isVis(p), 버전: p?.querySelector("#currentVersion")?.textContent?.trim() || null };
  } catch (e) { return { err: String(e).slice(0, 60) }; }
}, VIS);
// ⚠ 이 구역은 **접기 도우미**(fold.js)가 관리한다 — 접으면 패널 전체에 인라인 display:none이
//   붙고 그 상태가 localStorage에 남는다. 한 번 접어 두면 다음 실행에서도 접힌 채다.
//   "항상 펼쳐져 있어야 한다"는 옛 기대는 **정상 상태를 실패로** 보고했다
//   (2026-08-01 실측: 인라인 display:none, 원인은 접힘 저장값 — 제품 결함이 아니다).
//   지켜야 할 것은 **접혀 있어도 눌러서 펼치면 보이고 버전이 나온다**는 것이다.
let upd2 = upd;
if (!upd2.보임) {
  await page.evaluate(() => {
    const f = document.querySelector("#screens iframe.on");
    const d = f?.contentDocument;
    const p = [...(d?.querySelectorAll(".panel") ?? [])].find((x) => (x.querySelector(".panel-title")?.textContent || "").trim().startsWith("업데이트"));
    p?.previousElementSibling?.click?.(); // 접기 머리줄은 대상 **앞**에 끼워 넣는다(fold.js)
  });
  await page.waitForTimeout(800);
  upd2 = await page.evaluate((visSrc) => {
    const isVis = eval(visSrc);
    const f = document.querySelector("#screens iframe.on");
    try {
      const d = f.contentDocument;
      const p = [...d.querySelectorAll(".panel")].find((x) => (x.querySelector(".panel-title")?.textContent || "").trim().startsWith("업데이트"));
      return { 활성: document.querySelector("#tabBar .tab.on .nm")?.textContent, 보임: isVis(p), 버전: p?.querySelector("#currentVersion")?.textContent?.trim() || null };
    } catch (e) { return { err: String(e).slice(0, 60) }; }
  }, VIS);
}
ok("설정 관리자에서 업데이트를 펼치면 버전이 보인다", upd2.활성 === "설정" && upd2.보임 && !!upd2.버전, JSON.stringify(upd2));

// 13-b) AI팀 구성(2026-08-09 전-7) — 기반 두뇌·팀원 카드·☁ 외부 상담역이 **그려지는가.**
//   서버 집계(/api/team/composition)가 죽으면 카드가 통째로 비는데, 그건 화면을 열어야만 보인다.
const 팀 = await page.evaluate(() => {
  const f = document.querySelector("#screens iframe.on");
  try {
    const d = f.contentDocument;
    const base = d.getElementById("teamBase");
    const cards = d.getElementById("teamCards");
    return {
      기반: (base?.innerText || "").includes("기반 두뇌"),
      카드수: cards ? cards.children.length : 0,
      외부상담역: (cards?.innerText || "").includes("외부 상담역"),
      공용: /지식\s*\d+건/.test(d.getElementById("teamShared")?.textContent || ""),
    };
  } catch (e) { return { err: String(e).slice(0, 60) }; }
});
// 팀원 6 + ☁ 1 = 7장. 숫자를 박아 두면 팀원이 늘 때 이 검사가 먼저 말해 준다.
ok("AI팀 구성 — 기반 두뇌·팀원 카드·☁ 외부 상담역이 그려진다", 팀.기반 && 팀.카드수 === 7 && 팀.외부상담역 && 팀.공용, JSON.stringify(팀));

// 16) JS 오류 — preload 주입 플레이크의 1회성 오류(치유 전 프레임 소음)는 구분 집계
const transient = jsErrors.filter((e) => e.includes("reading 'isAuthenticated'"));
const real = jsErrors.filter((e) => !e.includes("reading 'isAuthenticated'"));
ok("JS 오류 0건(주입 플레이크 소음 제외)", real.length === 0, (real.join(" | ") || "없음") + (transient.length ? ` / 주입플레이크 소음 ${transient.length}건(치유됨)` : ""));

await page.evaluate(() => { const i = document.getElementById("chatInput"); if (i) i.value = ""; try { localStorage.removeItem("gijo:console:draft"); } catch (e) {} });
await page.screenshot({ path: SHOT + "shell-tabs-final.png" });

console.log("\n== 결과: PASS " + R.pass.length + " / FAIL " + R.fail.length + " ==");
if (R.fail.length) { console.log("실패:"); R.fail.forEach((f) => console.log("  - " + f)); }
await browser.close();
process.exit(R.fail.length ? 1 : 0);
