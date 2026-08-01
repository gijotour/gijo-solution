// 읽기 편함 실측 — 실제 앱에서 배경색·글자색·글자 크기·배율을 직접 잰다.
// (2026-08-02 "글씨가 너무 작고 안내 글씨는 거의 안 보임" 지적 확인용)
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const PORT = process.argv[2] || "9223";
const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = b.contexts()[0];
const pages = ctx.pages();
const page = pages.find((p) => p.url().includes("app.html")) || pages[0];
console.log("창:", page.url().split("/").pop(), "| 설치본?", page.url().includes("app.asar"));

// 로그인 여부
const 로그인함 = await page.evaluate(() => !!(window.gijo && window.gijo.isAuthenticated && window.gijo.isAuthenticated()));
console.log("로그인:", 로그인함);
if (!로그인함) {
  const u = process.env.QA_USER, p = process.env.QA_PASS;
  await page.evaluate(async ([u, p]) => {
    const el = (id) => document.getElementById(id);
    if (el("serverUrl")) el("serverUrl").value = "http://localhost:4000";
    if (el("username")) el("username").value = u;
    if (el("password")) el("password").value = p;
    el("loginBtn") && el("loginBtn").click();
  }, [u, p]);
  await page.waitForTimeout(3500);
  // 「이미 다른 곳에서 로그인 중입니다」 → 강제 로그인(계정당 세션 1개)
  const 버튼들 = await page.$$("button");
  for (const btn of 버튼들) {
    const t = (await btn.innerText().catch(() => "")).trim();
    if (t.includes("강제 로그인")) { await btn.click(); await page.waitForTimeout(4000); break; }
  }
  console.log("로그인 후:", await page.evaluate(() => !!(window.gijo && window.gijo.isAuthenticated())));
}

const 배율 = await page.evaluate(async () => (window.gijo && window.gijo.getUiZoom ? await window.gijo.getUiZoom() : null));
console.log("배율:", JSON.stringify(배율));

function 밝기(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const 대비 = (a, b) => { const x = 밝기(a) + 0.05, y = 밝기(b) + 0.05; return +(Math.max(x, y) / Math.min(x, y)).toFixed(1); };

for (const 화면 of ["audit.html", "settings.html", "analysis.html", "inventory.html"]) {
  await page.evaluate((h) => { location.hash = ""; }, 화면);
  await page.evaluate((h) => {
    const f = document.querySelector("#hubFrame, iframe");
    if (f) f.src = h;
  }, 화면);
  await page.waitForTimeout(2600);
  const fr = page.frames().find((f) => f.url().includes(화면));
  if (!fr) { console.log(`\n[${화면}] 프레임 못 찾음`); continue; }
  const r = await fr.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const 작은글씨 = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (!el.textContent || !el.textContent.trim()) return;
      if (el.children.length) return;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return;
      const px = parseFloat(s.fontSize);
      작은글씨.push({ px, color: s.color, t: el.textContent.trim().slice(0, 22) });
    });
    작은글씨.sort((a, b) => a.px - b.px);
    return {
      bg: cs.backgroundColor, text: cs.color, base: cs.fontSize, lh: cs.lineHeight,
      글꼴: cs.fontFamily.split(",")[0].replace(/"/g, ""),
      최소: 작은글씨.slice(0, 4), 개수: 작은글씨.length,
      작은것: 작은글씨.filter((x) => x.px < 12).length,
    };
  });
  console.log(`\n[${화면}] 바탕 ${r.bg} · 글자 ${r.text} · 본문 ${r.base}/${r.lh} · 글꼴 ${r.글꼴}`);
  console.log(`  본문 대비 ${대비(r.bg, r.text)}:1 · 보이는 글자 ${r.개수}개 중 12px 미만 ${r.작은것}개`);
  r.최소.forEach((s) => console.log(`  최소 ${s.px}px 대비 ${대비(r.bg, s.color)}:1 「${s.t}」`));
}
await page.screenshot({ path: ".tmp-reports/readable-after.png" });
console.log("\n스크린샷 .tmp-reports/readable-after.png");
await b.close();
