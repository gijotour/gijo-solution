// tools/gen-pdf.mjs — 제품 자료 Markdown(.md)을 배포/발표용 PDF로 변환한다.
// 마크다운 라이브러리/pandoc 없이 자체 변환기로 HTML을 만들고, 시스템 Edge(Playwright, headless)로
// A4 PDF를 렌더링한다. 상대경로 이미지(screenshots/*.png)는 임시 HTML을 레포 루트에 써서 해석한다.
//
// 사용법: node tools/gen-pdf.mjs            (기본: 제품소개 + 사용자 매뉴얼)
//         node tools/gen-pdf.mjs <a.md> ... (지정 파일만)

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(pathToFileURL(path.join(ROOT, "client", "package.json")));
const { chromium } = require("playwright-core");

const DEFAULT_DOCS = ["GIJO_AS_제품소개.md", "GIJO_AS_사용자_매뉴얼.md"];
const inputs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DOCS;

// ── 최소 마크다운 → HTML 변환기 (이 저장소 문서가 쓰는 구문만 지원) ──
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  let t = esc(s);
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img alt="${alt}" src="${src}">`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => `<a href="${url}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isTableSep = (s) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(s) && s.includes("-");
  while (i < lines.length) {
    const line = lines[i];
    // 코드펜스
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // 닫는 ```
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    // 테이블 (| ... | 다음 줄이 구분선)
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const splitRow = (s) => s.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") rows.push(splitRow(lines[i++]));
      const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }
    // 인용구
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    // 제목
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    // 수평선
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // 목록 (- 또는 N.)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${t}</li>`).join("")}</${tag}>`);
      continue;
    }
    // 빈 줄
    if (line.trim() === "") { i++; continue; }
    // 문단 (연속 비어있지 않은 줄)
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|>|```|---+\s*$|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

const CSS = `
@page { size: A4; margin: 15mm 13mm 16mm; }
* { box-sizing: border-box; }
body { font-family:"Malgun Gothic","Pretendard","Segoe UI",sans-serif; color:#1b2130; font-size:10.5pt; line-height:1.62; }
h1 { font-size:22pt; color:#0f1b3d; margin:0 0 6px; padding-bottom:8px; border-bottom:3px solid #3b82f6; }
h2 { font-size:15pt; color:#12306b; margin:20px 0 8px; padding-top:6px; border-top:1px solid #e2e6ef; }
h3 { font-size:12.5pt; color:#1b2f5e; margin:14px 0 5px; }
h4 { font-size:11pt; color:#26324d; margin:10px 0 4px; }
p { margin:6px 0; }
strong { color:#0f1b3d; }
a { color:#2456c9; text-decoration:none; }
hr { border:none; border-top:1px solid #e2e6ef; margin:14px 0; }
ul,ol { margin:6px 0 6px 22px; } li { margin:2px 0; }
code { background:#eef1f8; color:#243; padding:1px 5px; border-radius:4px; font-family:"Consolas","D2Coding",monospace; font-size:9pt; }
pre { background:#0e1526; color:#d7deee; border:1px solid #22304e; border-radius:8px; padding:12px 14px; margin:10px 0; overflow:hidden; page-break-inside:avoid; }
pre code { background:none; color:#cfe0ff; padding:0; font-size:8.7pt; line-height:1.5; white-space:pre-wrap; }
blockquote { border-left:4px solid #3b82f6; background:#f3f7ff; margin:10px 0; padding:9px 14px; color:#33405c; border-radius:0 6px 6px 0; }
table { border-collapse:collapse; width:100%; margin:10px 0; font-size:9.3pt; page-break-inside:avoid; }
th { background:#eaf1ff; color:#12306b; text-align:left; }
th,td { border:1px solid #d4dbe8; padding:6px 9px; vertical-align:top; }
tr:nth-child(even) td { background:#f7f9fd; }
img { max-width:100%; height:auto; display:block; margin:12px auto; border:1px solid #d4dbe8; border-radius:8px; page-break-inside:avoid; }
h1,h2,h3,h4 { page-break-after:avoid; }
`;

function wrap(html) {
  // 문서 URL이 레포 루트(임시 파일)라 screenshots/*.png 상대경로가 그대로 해석된다.
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>${CSS}</style></head><body>${html}</body></html>`;
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext();
  await ctx.route(/gijo\.ai/, (r) => r.abort()); // 오프라인 로고 요청 차단
  for (const rel of inputs) {
    const mdPath = path.join(ROOT, rel);
    if (!fs.existsSync(mdPath)) { console.log("✗ 없음:", rel); continue; }
    const html = wrap(mdToHtml(fs.readFileSync(mdPath, "utf-8")));
    const tmp = path.join(ROOT, `.tmp-pdf-${path.basename(rel, ".md")}.html`);
    fs.writeFileSync(tmp, html, "utf-8");
    const page = await ctx.newPage();
    try {
      await page.goto(pathToFileURL(tmp).href, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(600);
      const outPdf = path.join(ROOT, rel.replace(/\.md$/, ".pdf"));
      await page.pdf({ path: outPdf, format: "A4", printBackground: true, margin: { top: "15mm", bottom: "16mm", left: "13mm", right: "13mm" } });
      const kb = (fs.statSync(outPdf).size / 1024).toFixed(0);
      console.log(`✓ ${path.basename(outPdf)} (${kb}KB)`);
    } catch (e) {
      console.log("✗", rel, String(e.message).split("\n")[0]);
    } finally {
      await page.close();
      if (!process.env.GIJO_PDF_KEEP) fs.rmSync(tmp, { force: true });
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
