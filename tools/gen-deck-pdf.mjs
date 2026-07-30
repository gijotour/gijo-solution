// tools/gen-deck-pdf.mjs — 자체완결 HTML 슬라이드 덱(16:9)을 발표용 PDF로 렌더한다.
// gen-pdf.mjs(A4 문서용)와 달리, 각 .slide(1280x720)를 한 페이지로 뽑는다(@page size + preferCSSPageSize).
// 상대경로 이미지(screenshots/…)는 HTML이 레포 루트에 있으므로 그대로 해석된다.
//
// 사용법: node tools/gen-deck-pdf.mjs GIJO_AS_제안서_deck.html [출력.pdf]

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
function resolveChromium() {
  for (const dir of ["server", "client"]) {
    try { return createRequire(pathToFileURL(path.join(ROOT, dir, "package.json")))("playwright-core").chromium; } catch { /* 다음 */ }
  }
  throw new Error("playwright-core를 찾지 못했습니다 — server/에서 npm ci 후 재시도.");
}
const chromium = resolveChromium();

const input = process.argv[2];
if (!input) { console.error("사용법: node tools/gen-deck-pdf.mjs <deck.html> [out.pdf]"); process.exit(1); }
const htmlPath = path.isAbsolute(input) ? input : path.join(ROOT, input);
const outPdf = process.argv[3] ? path.join(ROOT, process.argv[3]) : htmlPath.replace(/\.html$/i, ".pdf");

async function main() {
  if (!fs.existsSync(htmlPath)) throw new Error(`HTML 없음: ${htmlPath}`);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext();
  await ctx.route(/gijo\.ai/, (r) => r.abort()); // 오프라인 로고 요청 차단
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(800); // 이미지 로드 대기
  // CSS @page{size:1280px 720px}를 그대로 따르게 하고, 슬라이드별 page-break로 페이지를 나눈다.
  await page.pdf({ path: outPdf, printBackground: true, preferCSSPageSize: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  await browser.close();
  const mb = (fs.statSync(outPdf).size / 1024 / 1024).toFixed(1);
  console.log(`✓ ${path.basename(outPdf)} (${mb}MB)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
