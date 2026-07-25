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
const p = ctx.pages()[0];
p.on("dialog", (d) => d.accept().catch(() => {}));

// nav.js의 허브 그룹 + 단독 화면에서 전체 페이지 목록을 뽑는다(코드가 곧 목록 — 드리프트 없음).
await p.waitForTimeout(500);
const pages = await p.evaluate(() => {
  const out = [{ page: "dashboard.html", label: "대시보드" }];
  const hubs = window.gijoHubs || {};
  for (const g of Object.values(hubs)) for (const t of g.tabs || []) if (!t.office) out.push(t);
  return out;
});
console.log(`대상 화면 ${pages.length}개`);

const results = [];
for (const t of pages) {
  const errors = [];
  const onErr = (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 140)); };
  const onPageErr = (e) => errors.push("PAGEERROR " + String(e).slice(0, 140));
  p.on("console", onErr);
  p.on("pageerror", onPageErr);
  try {
    // navigateTo는 톱레벨 내비게이션이라 evaluate 컨텍스트를 파괴한다 — setTimeout으로 분리 발사.
    await p.evaluate((pg) => { setTimeout(() => window.gijo.navigateTo(pg), 30); }, t.page);
    await p.waitForTimeout(4000); // 내비게이션 + 초기 API 로드 대기
    // 허브로 리다이렉트되면 실제 화면은 iframe — 해당 페이지 프레임을 찾아 검사한다.
    let f = p.mainFrame();
    for (const fr of p.frames()) { const u = fr.url().split("?")[0]; if (u.endsWith("/" + t.page)) { f = fr; break; } }
    const info = await f.evaluate(() => ({
      title: (document.querySelector(".page-title, .panel-title, h1") || {}).textContent?.trim().slice(0, 24) || document.title.slice(0, 24),
      bodyLen: document.body.innerText.length,
      loading: /불러오는 중|로딩 중/.test(document.body.innerText) ? "로딩잔류?" : "",
    }));
    // 리소스 404 등 네트워크성 콘솔 에러와 실제 JS 에러를 함께 본다(중복 제거).
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
