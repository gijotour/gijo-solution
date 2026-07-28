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

// nav.js 메뉴에서 전체 화면 목록을 뽑는다(코드가 곧 목록 — 드리프트 없음).
// 4.0.0에서 허브를 없앴으므로 메뉴 항목이 곧 화면이다. 별도 창으로 여는 항목(팀 사무실)은 뺀다.
await p.waitForTimeout(500);
const pages = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll("#gijoNav .gn-item").forEach((el) => {
    var lab = el.querySelector(".gn-label");
    if (!lab) return;
    var label = lab.textContent.trim();
    if (label.indexOf("사무실") >= 0) return; // 별도 창 — 탭으로 안 연다
    out.push({ label: label });
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
    await p.evaluate((label) => {
      const it = Array.from(document.querySelectorAll("#gijoNav .gn-item"))
        .find((e) => e.querySelector(".gn-label") && e.querySelector(".gn-label").textContent.trim() === label);
      if (it) it.querySelector(".gn-label").click();
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
        title: ((d.querySelector(".page-title, .panel-title, h1") || {}).textContent || d.title || "").trim().slice(0, 24),
        bodyLen: txt.length,
        loading: /불러오는 중|로딩 중/.test(txt) ? "로딩잔류?" : "",
      };
    });
    t.page = info.page || t.label;
    if (info.err) errors.push(info.err);
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
