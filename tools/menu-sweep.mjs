// tools/menu-sweep.mjs — 전체 메뉴 기능 스윕 테스트.
// 실행 중인 Electron(CDP 9223, 로그인 상태)에 붙어 nav.js의 모든 화면을 순서대로 열고
// 콘솔 에러·페이지 로드·본문 렌더를 검사한다. 데이터 정리 전/후(빈 상태) 회귀 비교용.
// 사용: client/에서 electron 기동·로그인 후  node tools/menu-sweep.mjs
import { createRequire } from "node:module";
// playwright-core는 client/node_modules에 있다 — tools/에서 실행해도 찾도록 명시 해석.
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const ctx = b.contexts()[0];
// ⚠ 첫 페이지가 셸이라는 보장이 없다 — 분리창·콘솔 창이 떠 있거나, 앞선 검사가 앱을 다른
//   화면에 두고 끝났을 수 있다(실측: sweep이 0/29, "현재: threat.html"). 셸로 돌려놓고 시작한다.
let p = ctx.pages().find((x) => x.url().includes("app.html"));
if (!p) {
  const any = ctx.pages().find((x) => !/login\.html|console\.html|popout=1/.test(x.url())) || ctx.pages()[0];
  if (!any) { console.error("Electron 페이지를 찾지 못했습니다"); process.exit(2); }
  await any.evaluate(() => window.gijo && window.gijo.navigateTo("app.html")).catch(() => {});
  await any.waitForTimeout(4000);
  p = ctx.pages().find((x) => x.url().includes("app.html"));
}
if (!p) {
  console.error("탭 셸(app.html)로 들어가지 못했습니다 — 로그인 상태인지 확인하세요. 현재:",
    ctx.pages().map((x) => x.url().split("/").pop()).join(", "));
  process.exit(2);
}
p.on("dialog", (d) => d.accept().catch(() => {}));
await p.waitForTimeout(1500);

// nav.js 메뉴에서 전체 화면 목록을 뽑는다(코드가 곧 목록 — 드리프트 없음).
// 4.0.0에서 허브를 없앴으므로 메뉴 항목이 곧 화면이다. 별도 창으로 여는 항목(팀 사무실)은 뺀다.
await p.waitForTimeout(500);
// ★ 「대표 그룹」도 화면이다(2026-08-13 실측: IA 통합으로 항목 1개 그룹은 하위 줄 없이
//   **그룹 줄 자체가 메뉴**가 됐다 — nav.js `대표` 분기. .gn-item만 읽던 이 스윕이
//   8개만 훑고 「통과」를 찍었다. 대표 그룹 7개(발견·수집/우선순위/조치/검증/보고/등록부/AI)가
//   통째로 사각이었다). .gn-item + 대표 그룹 헤더(.gn-g에 개수 배지 .cnt 없음)를 함께 모은다.
const pages = await p.evaluate(() => {
  const out = [];
  const seen = new Set(); // 즐겨찾기 가지에 같은 화면이 또 있다 — 두 번 훑을 필요는 없다
  document.querySelectorAll("#gijoNav .gn-item").forEach((el) => {
    var lab = el.querySelector(".gn-label");
    if (!lab) return;
    var label = lab.textContent.trim();
    if (seen.has(label)) return;
    seen.add(label);
    // 별도 창으로 여는 항목은 탭으로 안 열린다 — 훑으면 빈 화면(body=0)이 나와 거짓 실패가 된다.
    // ⚠ 이름을 하나씩 빼지 않는다("사무실"만 빼 뒀다가 문서함을 더하니 바로 깨졌다, 2026-07-31).
    //   창으로 여는 항목은 이름 끝에 "(창)"을 붙이는 것이 nav의 규약이므로 그걸로 판별한다.
    if (/\(창\)/.test(label)) return;
    out.push({ label: label });
  });
  document.querySelectorAll("#gijoNav .gn-g").forEach((gh) => {
    if (gh.querySelector(".cnt")) return;               // 개수 배지가 있으면 접이식 그룹(대표 아님)
    var nm = gh.querySelector(".gn-gname");
    if (!nm) return;
    var label = nm.textContent.trim();
    if (!label || seen.has(label) || /즐겨찾기/.test(label)) return;
    seen.add(label);
    out.push({ label: label, 대표그룹: true });
  });
  return out;
});
if (!pages.length) { console.error("메뉴에서 화면을 못 찾았습니다 — 셸(app.html)에 로그인된 상태인지 확인하세요."); process.exit(2); }
console.log(`대상 화면 ${pages.length}개`);

const results = [];
for (const t of pages) {
  const errors = [];
  const onErr = (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 140)); };
  const onPageErr = (e) => errors.push("PAGEERROR " + String(e).slice(0, 140));
  p.on("console", onErr);
  p.on("pageerror", onPageErr);
  try {
    // 4.0.0 — 메뉴를 누르면 셸이 그 화면을 탭으로 연다(이동 아님). 셸은 그대로 있으므로
    // 컨텍스트가 깨지지 않는다.
    // ⚠ 탭은 8개까지만 열린다(4.0.0). 훑는 동안 탭이 차면 9번째부터는 **안 열리고 경고만**
    //   뜨는데, 이 스크립트는 dialog를 자동 수락하므로 조용히 넘어간다. 그러면 활성 탭은
    //   직전 화면 그대로고, 아래 검사는 그 남의 화면을 보고 "내용 있음"이라 통과시킨다.
    //   실제로 28개 중 20개가 report.html을 보고 ✓를 받았다(2026-07-28 실측).
    //   그래서 매번 탭을 비우고 한 개만 연다.
    await p.evaluate(() => { if (window.gijoTabs) window.gijoTabs.closeAll(); });
    await p.waitForTimeout(400);
    await p.evaluate((label) => {
      const it = Array.from(document.querySelectorAll("#gijoNav .gn-item"))
        .find((e) => e.querySelector(".gn-label") && e.querySelector(".gn-label").textContent.trim() === label);
      if (it) { it.querySelector(".gn-label").click(); return; }
      // 대표 그룹 — 그룹 줄 자체가 메뉴다(여는 방식도 nav와 같게 헤더 클릭).
      const gh = Array.from(document.querySelectorAll("#gijoNav .gn-g"))
        .find((e) => !e.querySelector(".cnt") && e.querySelector(".gn-gname") && e.querySelector(".gn-gname").textContent.trim() === label);
      if (gh) gh.click();
    }, t.label);
    await p.waitForTimeout(4000); // 탭 생성 + 초기 API 로드 대기
    // 실제 화면은 활성 탭 iframe 안에 있다.
    const info = await p.evaluate(() => {
      const f = document.querySelector("#screens iframe.on");
      if (!f) return { err: "활성 탭 없음", bodyLen: 0, title: "", loading: "" };
      const d = f.contentDocument;
      if (!d) return { err: "탭 문서 없음", bodyLen: 0, title: "", loading: "" };
      const txt = d.body.innerText || "";
      return {
        page: decodeURIComponent(f.src.split("/").pop() || "").split("?")[0],
        activeLabel: window.gijoTabs ? window.gijoTabs.activeLabel() : null,
        title: ((d.querySelector(".page-title, .panel-title, h1") || {}).textContent || d.title || "").trim().slice(0, 24),
        bodyLen: txt.length,
        loading: /불러오는 중|로딩 중/.test(txt) ? "로딩잔류?" : "",
        // ⚠ 화면이 **글자를 채운 채로 고장 나는** 경우가 있다(2026-08-02 실사고:
        //   보안 KPI가 "불러오지 못했습니다: panel is not defined"만 남겼는데 body는 길어서
        //   스윕이 통과시켰다). 길이만 보지 말고 **실패 문구**를 직접 찾는다.
        실패문구: (txt.split(String.fromCharCode(10)).find(function (l) {
          return /불러오지 못했습니다|불러오지 못함|is not defined|is not a function|Cannot read propert|undefined is not/.test(l);
        }) || "").trim().slice(0, 120),
      };
    });
    t.page = info.page || t.label;
    if (info.err) errors.push(info.err);
    // 내용이 있다는 것만으론 부족하다 — **누른 그 화면**이 열렸는지 봐야 한다.
    // (탭 상한·리다이렉트로 엉뚱한 화면이 활성인 채 통과하던 구멍을 막는다.)
    // ⚠ 대표 그룹은 탭 라벨이 그룹명이 아니라 **항목 라벨**로 열린다(nav.js: items[0].label) —
    //   같음 검사 대신 「탭이 하나 열렸는가」만 본다(닫고 시작했으므로 열렸으면 그 화면이다).
    if (!info.err && !t.대표그룹 && info.activeLabel !== t.label) {
      errors.push(`다른 화면이 열렸다: 누름="${t.label}" 활성="${info.activeLabel}"`);
    }
    if (!info.err && t.대표그룹 && !info.activeLabel) {
      errors.push(`대표 그룹이 탭을 못 열었다: "${t.label}"`);
    }
    // 리소스 404 등 네트워크성 콘솔 에러와 실제 JS 에러를 함께 본다(중복 제거).
    if (info.실패문구) errors.push("화면에 실패 문구: " + info.실패문구);
    const uniq = [...new Set(errors)].filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
    const ok = uniq.length === 0 && info.bodyLen > 80;
    results.push({ page: t.page, label: t.label, ok, err: uniq.slice(0, 2), body: info.bodyLen, note: info.loading });
    console.log(`${ok ? "✓" : "✗"} ${t.label} (${t.page}) body=${info.bodyLen}${info.loading ? " " + info.loading : ""}${uniq.length ? "\n    ERR: " + uniq.join(" | ") : ""}`);
  } catch (e) {
    results.push({ page: t.page, label: t.label, ok: false, err: [String(e.message).slice(0, 100)] });
    console.log(`✗ ${t.label} — ${e.message}`);
  }
  p.off("console", onErr);
  p.off("pageerror", onPageErr);
}
const fail = results.filter((r) => !r.ok).length;
console.log(`\n결과: ${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
