// test/fixtures/make-pdftable-fixture.mjs — **PDF 표 복원 픽스처를 코드로 굽는다** (2026-09-09).
//
// 다시 굽기:  node server/test/fixtures/make-pdftable-fixture.mjs
//   ⚠ 다시 구우면 table-grid.pdf가 덮어써진다 — 짝 시험(test/pdftableextract.test.ts)의 기대값이
//     이 파일의 내용과 한 몸이다. 여기를 고치면 그 시험도 함께 고친다.
//
// ★ 픽스처는 **가드를 실제로 가르는 것**만 넣는다(2026-09-08 검토관 적발④⑤의 교훈).
//   「담고만 있는」 픽스처는 그물이 아니라 그물 그림이다. 이 파일이 굽는 한 장에는 pdftable.ts의
//   가드 **둘**을 각각 빨갛게 만드는 재료가 들어 있고, 아래에 「그 줄을 어떻게 지우면 빨개지나」를
//   적어 둔다(실측으로 확인했다).
//
//   ⓐ **테두리 표**(3행 3열) — 세로선은 stroke(S), 가로선은 얇은 채움(re f)으로 그린다.
//      두 갈래를 한 장에서 다 태운다(실물 10편은 채움만 쓰는데, 워드·한글은 stroke도 쓴다).
//      · 여러 줄 셀: 한 칸 안에서 줄을 바꾼다 → **한 칸으로 합쳐져야** 한다(행=시각적 한 줄이 아니다).
//      · 셀 안 파이프: `Patch|A` → `Patch\|A`로 이스케이프돼야 열 수가 안 어긋난다.
//   ⓑ **맞붙은 두꺼운 카드 상자 2×2** — 표가 **아니다**. 가드②(두꺼운 상자는 선이 아니다)를 지우고
//      상자를 「테두리 선 4개」로 읽으면 이 자리가 2행2열 표로 잡힌다(실측으로 빨개지는 것 확인).
//      ⚠ 상자를 **맞붙여** 둔 게 핵심이다 — 띄워 두면 선들이 한 덩어리로 안 이어져 1행짜리가 되고
//        최소행(2) 문턱에 걸려 **가드를 지워도 초록**이 된다(그러면 그물이 아니다).
//   ⓒ **클립 전용(W n) 얇은 격자** — 눈에 안 보이는데 좌표는 표처럼 생겼다. 가드①(칠하지 않는
//      경로는 세지 않는다)을 지우면 이 자리가 표로 잡힌다. 안에 글을 넣어 **내용 있는 오탐**이 되게 했다.
//   ⓓ **표 밖 문단** — 표 앞뒤 글이 그대로 남는지, 순서가 보존되는지 본다.
//
// ⚠ 한글을 안 쓴다. 손으로 쓴 PDF에 한글을 넣으려면 폰트를 임베딩해야 하는데, 격자 로직은 글자
//   종류와 무관하다. **한국어 성립 근거는 저장소 PDF 10편 실측**이다(표 73개·낱말 손실 0).
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));

/** PDF 문자열 이스케이프 — `(`·`)`·`\`만. */
const S = (t) => `(${t.replace(/([\\()])/g, "\\$1")})`;
/** 한 줄짜리 글 — Td로 자리를 잡고 Tj. */
const 글 = (x, y, t) => `BT /F1 9 Tf ${x} ${y} Td ${S(t)} Tj ET`;
/** 두 줄짜리 글(한 칸 안에서 줄바꿈) — T*가 hasEOL을 낳는다. */
const 두줄 = (x, y, a, b) => `BT /F1 9 Tf 11 TL ${x} ${y} Td ${S(a)} Tj T* ${S(b)} Tj ET`;
/** 얇은 채움 사각형(가로 테두리). */
const 얇은가로 = (x0, x1, y) => `${x0} ${y - 0.25} ${x1 - x0} 0.5 re f`;
/** 그은 세로 테두리. */
const 그은세로 = (x, y0, y1) => `${x} ${y0} m ${x} ${y1} l S`;
/** 두꺼운 채움 상자(카드). */
const 카드 = (x, y, w, h) => `${x} ${y} ${w} ${h} re f`;

// ⓐ 테두리 표 — x 50/150/250/350, y 600/633/667/700 (아래에서 위로)
const 표 = [
  ...[50, 150, 250, 350].map((x) => 그은세로(x, 600, 700)),
  ...[600, 633.5, 667, 700].map((y) => 얇은가로(50, 350, y)),
  글(55, 676, "Item"), 글(155, 676, "Owner"), 글(255, 676, "Due"),
  글(55, 643, "Patch|A"), 두줄(155, 650, "two", "lines"), 글(255, 643, "Sep 30"),
  글(55, 610, "Scan"), 글(155, 610, "kim"), 글(255, 610, "Oct 1"),
].join("\n");

// ⓑ 맞붙은 두꺼운 카드 2×2 — x 50..200..350, y 400..475..550
const 카드묶음 = [
  카드(50, 475, 150, 75), 카드(200, 475, 150, 75), 카드(50, 400, 150, 75), 카드(200, 400, 150, 75),
  글(60, 510, "Card A"), 글(210, 510, "Card B"), 글(60, 435, "Card C"), 글(210, 435, "Card D"),
].join("\n");

// ⓒ 클립 전용(W n) 얇은 격자 — x 50/200/350, y 200/250/300. 글은 클립 밖(Q 뒤)에 그린다.
const 클립격자 = [
  ...[50, 200, 350].map((x) => `q ${x} 200 m ${x} 300 l W n Q`),
  ...[200, 250, 300].map((y) => `q 50 ${y} m 350 ${y} l W n Q`),
  글(60, 270, "Ghost A"), 글(210, 270, "Ghost B"), 글(60, 220, "Ghost C"), 글(210, 220, "Ghost D"),
].join("\n");

// ⓓ 표 밖 문단
const 문단 = [글(50, 780, "Intro paragraph before the table."), 글(50, 740, "Second line of intro.")].join("\n");
const 꼬리 = 글(50, 150, "Closing paragraph after everything.");

const 내용 = [문단, 표, 카드묶음, 클립격자, 꼬리].join("\n");

// ── 최소 PDF 조립 (xref 오프셋을 직접 센다) ────────────────────────────────────
const 객체들 = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${Buffer.byteLength(내용, "latin1")} >>\nstream\n${내용}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
];
let pdf = "%PDF-1.4\n";
const 오프셋 = [];
객체들.forEach((o, i) => {
  오프셋.push(Buffer.byteLength(pdf, "latin1"));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${객체들.length + 1}\n0000000000 65535 f \n`;
for (const o of 오프셋) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${객체들.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const 나갈곳 = path.join(여기, "table-grid.pdf");
fs.writeFileSync(나갈곳, Buffer.from(pdf, "latin1"));
console.log(`${나갈곳} — ${Buffer.byteLength(pdf, "latin1")}바이트`);
