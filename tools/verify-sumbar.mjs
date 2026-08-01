// tools/verify-sumbar.mjs — 요약 카드 → 한 줄 막대 변환을 전 화면에서 확인 (2026-08-02)
//
// 무엇을 보는가
//   ① 막대로 바뀌었나(또는 모양이 달라 **안전하게 건너뛰었나**)
//   ② 바뀐 뒤에도 **숫자가 채워지나** — 값 요소를 새로 만들면 id가 사라져 "-"에서 멈춘다
//   ③ 화면에 실패 문구가 뜨지 않나
import * as path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = b.contexts()[0].pages().find((p) => p.url().includes("app.html"));
if (!page) { console.error("셸을 못 찾았습니다 — 로그인 상태인지 확인하세요"); process.exit(2); }

const 화면 = await page.evaluate(() =>
  (window.gijoScreenList() || []).filter((i) => i.page).map((i) => ({ page: i.page, label: i.label })));
let 실패 = 0, 바뀜 = 0, 건너뜀 = 0;
for (const t of 화면) {
  await page.evaluate(() => { try { window.gijoTabs.closeAll(); } catch (e) {} });
  await page.waitForTimeout(300);
  await page.evaluate(([p, l]) => window.gijoTabs.open(p, l), [t.page, t.label]);
  await page.waitForTimeout(3400);
  const fr = page.frames().find((f) => f.url().includes(t.page.split("?")[0]) && f.url().includes("embed"));
  if (!fr) { console.log(`? ${t.label} — 프레임 못 찾음`); continue; }
  const r = await fr.evaluate(() => {
    const box = document.querySelector("[data-gijo-summary]");
    const txt = document.body.innerText || "";
    const 실패문구 = (txt.match(/[^\n]*(?:불러오지 못했습니다|is not defined|is not a function|Cannot read propert)[^\n]*/) || [""])[0].trim().slice(0, 90);
    if (!box) return { 없음: true, 실패문구 };
    const 막대 = box.querySelector(".gsum");
    const 값들 = [...box.querySelectorAll(".gsum-v, [id]")].map((e) => (e.textContent || "").trim()).filter(Boolean);
    return {
      바뀜: !!막대,
      높이: Math.round(box.getBoundingClientRect().height),
      값: 값들.slice(0, 6),
      빈값: 값들.filter((v) => v === "-" || v === "").length,
      실패문구,
    };
  });
  if (r.실패문구) { console.log(`✗ ${t.label} — 화면에 실패 문구: ${r.실패문구}`); 실패++; continue; }
  if (r.없음) { console.log(`· ${t.label} — 요약 줄 없음(해당 없음)`); continue; }
  if (r.바뀜) {
    바뀜++;
    const 나쁨 = r.빈값 > 0 && r.값.length > 0 && r.빈값 === r.값.length;
    if (나쁨) { console.log(`✗ ${t.label} — 막대는 됐는데 **값이 전부 비었다**: ${JSON.stringify(r.값)}`); 실패++; }
    else console.log(`✓ ${t.label} — 막대 ${r.높이}px · ${r.값.join(" / ")}`);
  } else {
    건너뜀++;
    console.log(`▫ ${t.label} — 모양이 달라 건너뜀(${r.높이}px)`);
  }
}
console.log(`\n막대 ${바뀜} · 건너뜀 ${건너뜀} · 실패 ${실패}`);
await b.close();
process.exit(실패 ? 1 : 0);
