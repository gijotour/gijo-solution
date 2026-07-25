// build/make-installer-bitmaps.mjs — NSIS 설치 마법사용 비트맵 생성.
//
// 왜 스크립트인가: NSIS는 24비트 BMP만 받는데(PNG 불가) 저장소에 바이너리를 손으로 넣어두면
// 로고가 바뀌었을 때 아무도 다시 만들지 않는다. 대시보드 중앙 로고(gijo-center.png)를 원본으로
// 삼아 여기서 합성한다 — 로고가 바뀌면 이 스크립트만 다시 돌리면 된다.
//
// 만드는 것:
//   welcome.bmp (164x314) — 환영·완료 페이지 왼쪽 세로 그림
//   header.bmp  (150x57)  — 그 외 페이지 오른쪽 위 작은 그림
//
// 사용: node build/make-installer-bitmaps.mjs   (client/ 에서)
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "..");
const LOGO = path.join(clientDir, "src", "renderer", "pages", "assets", "gijo-center.png");

// 브라우저 실행 파일 — 설치된 Chrome/Edge 중 있는 것을 쓴다(별도 설치 없이 돌게).
function findBrowser() {
  const cands = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return cands.find((p) => fs.existsSync(p));
}

// RGBA 픽셀 → 24비트 BMP(아래에서 위로 저장, 4바이트 정렬 패딩).
function rgbaToBmp(rgba, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buf = Buffer.alloc(54 + pixelBytes);
  buf.write("BM", 0);
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10); // 픽셀 시작 오프셋
  buf.writeUInt32LE(40, 14); // DIB 헤더 크기
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); // 평면 수
  buf.writeUInt16LE(24, 28); // 비트 수
  buf.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4; // BMP는 아래 줄부터
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      buf[dst++] = rgba[i + 2]; // B
      buf[dst++] = rgba[i + 1]; // G
      buf[dst++] = rgba[i]; // R
    }
  }
  return buf;
}

const WELCOME_HTML = (logoDataUrl) => `<!doctype html><meta charset="utf-8">
<body style="margin:0"><canvas id="c" width="164" height="314"></canvas>
<script>
window.__done = (async () => {
  const c = document.getElementById("c"), g = c.getContext("2d");
  // 바탕 — 제품 화면과 같은 짙은 남색 계열 세로 그라데이션
  const bg = g.createLinearGradient(0, 0, 60, 314);
  bg.addColorStop(0, "#0e1730"); bg.addColorStop(0.55, "#0a1020"); bg.addColorStop(1, "#070b16");
  g.fillStyle = bg; g.fillRect(0, 0, 164, 314);
  // 은은한 빛무리 — 로고 뒤에 깔아 평평해 보이지 않게
  const glow = g.createRadialGradient(82, 96, 6, 82, 96, 96);
  glow.addColorStop(0, "rgba(59,130,246,.34)"); glow.addColorStop(1, "rgba(59,130,246,0)");
  g.fillStyle = glow; g.fillRect(0, 0, 164, 200);
  // 로고
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "${logoDataUrl}"; });
  g.drawImage(img, 22, 36, 120, 120);
  // 제품명
  g.textAlign = "center";
  g.fillStyle = "#ffffff";
  g.font = "800 25px 'Malgun Gothic', sans-serif";
  g.fillText("GIJO AS", 82, 190);
  g.fillStyle = "#5fa1ff";
  g.font = "700 9.5px 'Malgun Gothic', sans-serif";
  g.fillText("AI SECURITY MANAGER", 82, 206);
  // 구분선
  g.strokeStyle = "rgba(255,255,255,.14)"; g.beginPath();
  g.moveTo(34, 222); g.lineTo(130, 222); g.stroke();
  // 핵심 3가지만 — 오른쪽 본문과 같은 말을 또 쓰지 않는다(정체성 문구는 본문이 맡는다).
  // 줄 간격을 넉넉히 둬서 좁은 폭에서도 답답해 보이지 않게 한다.
  g.textAlign = "left";
  g.font = "400 9.5px 'Malgun Gothic', sans-serif";
  ["취약점 · 로그 · 리포트 통합", "로컬 LLM — 외부 전송 없음", "AI 자산까지 보호"].forEach((t, i) => {
    const y = 252 + i * 20;
    g.fillStyle = "#3b82f6"; g.fillText("·", 26, y);
    g.fillStyle = "#7d879f"; g.fillText(t, 35, y);
  });
  return Array.from(g.getImageData(0, 0, 164, 314).data);
})();
</script>`;

const HEADER_HTML = (logoDataUrl) => `<!doctype html><meta charset="utf-8">
<body style="margin:0"><canvas id="c" width="150" height="57"></canvas>
<script>
window.__done = (async () => {
  const c = document.getElementById("c"), g = c.getContext("2d");
  g.fillStyle = "#0e1730"; g.fillRect(0, 0, 150, 57);
  const glow = g.createRadialGradient(28, 28, 2, 28, 28, 34);
  glow.addColorStop(0, "rgba(59,130,246,.3)"); glow.addColorStop(1, "rgba(59,130,246,0)");
  g.fillStyle = glow; g.fillRect(0, 0, 150, 57);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "${logoDataUrl}"; });
  g.drawImage(img, 8, 8, 41, 41);
  g.fillStyle = "#ffffff"; g.font = "800 15px 'Malgun Gothic', sans-serif";
  g.fillText("GIJO AS", 56, 30);
  g.fillStyle = "#5fa1ff"; g.font = "700 7.5px 'Malgun Gothic', sans-serif";
  g.fillText("AI SECURITY MANAGER", 57, 42);
  return Array.from(g.getImageData(0, 0, 150, 57).data);
})();
</script>`;

const exe = findBrowser();
if (!exe) {
  console.error("[bitmaps] Chrome/Edge를 찾지 못했습니다 — 비트맵 생성을 건너뜁니다.");
  process.exit(1);
}
const logoDataUrl = "data:image/png;base64," + fs.readFileSync(LOGO).toString("base64");
const browser = await chromium.launch({ executablePath: exe, headless: true });

for (const [name, html, w, h] of [
  ["welcome", WELCOME_HTML(logoDataUrl), 164, 314],
  ["header", HEADER_HTML(logoDataUrl), 150, 57],
]) {
  const page = await browser.newPage();
  await page.setContent(html);
  const rgba = await page.evaluate(() => window.__done);
  const out = path.join(here, `${name}.bmp`);
  fs.writeFileSync(out, rgbaToBmp(Uint8Array.from(rgba), w, h));
  console.log(`[bitmaps] ${name}.bmp (${w}x${h}) 생성`);
  await page.close();
}
await browser.close();
