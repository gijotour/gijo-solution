// test/fixtures/make-table-fixtures.mjs — 표가 든 최소 OOXML 픽스처를 **코드로 굽는다**.
//
// 왜 실물을 자르지 않았나 (2026-09-08 실측):
//   ① 저장소 뿌리의 실물 3편(제품소개 pptx·기획 docx·GSTS pptx)에는 **병합 셀이 0개**다
//      (gridSpan·vMerge·hMerge 전부 0). 잘라 만들어도 병합 갈래를 못 잰다.
//   ② 실물은 고객·사내 내용이라 시험 픽스처로 박아 두기에 맞지 않다.
//   ③ 오피스추출()은 zip 안의 word/document.xml·ppt/slides/slideN.xml만 읽고 JSZip은 OOXML을
//      검증하지 않는다 — 그래서 1~2KB짜리 **사람이 읽을 수 있는** 픽스처가 가능하다.
//      (그래도 [Content_Types].xml·_rels/.rels를 넣어 진짜 오피스가 열 수 있는 꼴로 둔다.)
//
// 다시 굽기:  node server/test/fixtures/make-table-fixtures.mjs
//   ⚠ 다시 구우면 table.docx·table-broken.docx·table-wide.docx·table.pptx가 **덮어써진다** —
//     짝 시험(test/tableextract.test.ts)의 기대값이 이 파일의 내용과 한 몸이다. 여기를 고치면
//     그 시험도 함께 고친다.
//
// ★ 픽스처는 **가드를 실제로 가르는 것**만 넣는다(2026-09-08 검토관 적발④⑤). 첫 판은 병합·
//   중첩·빈 표·안 닫힌 표를 「담고는」 있었지만, 정작 가드를 지워도 전부 초록이었다 — 갈래를
//   가르지 않는 픽스처는 **그물이 아니라 그물 그림**이다. 새 가드를 넣을 때마다
//   「이 픽스처로 그 줄을 지우면 빨개지나」를 손으로 확인하고 여기에 왜를 적는다.
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(여기, "..", "..", "package.json"));
const JSZip = require("jszip");

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

// ── docx ────────────────────────────────────────────────────────────────────
const wp = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
/** 표 칸 — 여러 문단을 담을 수 있다(줄바꿈이 공백으로 접히는지 보는 갈래). */
const wtc = (문단들, 속성 = "") =>
  `<w:tc>${속성 ? `<w:tcPr>${속성}</w:tcPr>` : ""}${문단들.map(wp).join("")}</w:tc>`;
const wtr = (칸들) => `<w:tr>${칸들.join("")}</w:tr>`;
const wtbl = (행들) => `<w:tbl><w:tblPr><w:tblStyle w:val="a"/></w:tblPr>${행들.join("")}</w:tbl>`;

const 표1 = wtbl([
  wtr([wtc(["구분"]), wtc(["대상"]), wtc(["조치"])]),
  wtr([wtc(["취약점"]), wtc(["srv-web-01"]), wtc(["패치 적용"])]),
  wtr([wtc(["설정"]), wtc(["srv-db-02"]), wtc(["접근제어 강화"])]),
]);
// 병합(gridSpan=2) · 셀 안 파이프 · 셀 안 두 문단
const 표2 = wtbl([
  wtr([wtc(["항목"]), wtc(["값"])]),
  wtr([wtc(["전 구간 공통"], '<w:gridSpan w:val="2"/>')]),
  wtr([wtc(["A|B"]), wtc(["줄바꿈", "포함"])]),
]);
// 중첩 표 — 비탐욕 정규식으로 자르면 여기서 어긋난다(바깥 표의 뒷부분이 본문으로 샌다).
// ⚠ 안쪽 칸에 **gridSpan을 일부러 단다**(2026-09-08 검토관 적발⑤). 워드가로병합()에는 「안쪽 표
//   뒤에 있는 gridSpan은 내 것이 아니다」라는 가드가 있는데, 안쪽에 gridSpan이 없으면 그 가드를
//   통째로 지워도 시험이 초록이었다 — **가드를 안 재는 픽스처**였다. 이제 지우면 바깥 표가
//   2열에서 4열로 부풀어 아래 골든이 빨개진다.
const 안쪽표 = wtbl([wtr([wtc(["안쪽칸"], '<w:gridSpan w:val="3"/>')])]);
const 표3 = wtbl([
  wtr([wtc(["바깥 머리1"]), wtc(["바깥 머리2"])]),
  wtr([wtc(["바깥칸"]), `<w:tc>${안쪽표}</w:tc>`]),
]);
// 글자가 하나도 없는 표(빈 격자·자리잡기용) — 파이프표()의 「빈 표는 안 낸다」 가드를 재는 자리.
// ⚠ 가드가 살아 있으면 **출력에 아무것도 안 보태므로 골든이 그대로다.** 지우면 구분선이 하나
//   더 늘어 「구분선은 셋뿐이다」가 빨개진다(2026-09-08 검토관 적발⑤ — 종전엔 아무도 안 쟀다).
const 표빈칸 = wtbl([wtr([wtc([""]), wtc([""])])]);

const document_xml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document ${W}><w:body>` +
  wp("표 앞 문단입니다") + 표1 + wp("표 사이 문단") + 표2 + 표3 + 표빈칸 + wp("표 뒤 문단") +
  `</w:body></w:document>`;

// 열 폭주 픽스처 — 칸 10개에 저마다 gridSpan=64를 달아 **640열**을 요구한다. 상한(표_최대열 512)이
//   살아 있으면 512열에서 멈춘다. 상한을 지우면 640열이 되어 짝 시험이 빨개진다.
//   왜 필요한가(2026-09-08 검토관 적발⑤): 상한은 「병합 칸이 빈 칸을 곱해 원본의 수백 배짜리 글을
//   만드는」 것을 막으려고 넣었는데, 그 넘침 갈래를 **아무 시험도 안 지나고 있었다.**
const document_wide_xml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document ${W}><w:body>` +
  wtbl([wtr(Array.from({ length: 10 }, (_, i) => wtc([`칸${i}`], '<w:gridSpan w:val="64"/>')))]) +
  `</w:body></w:document>`;

// ── pptx ────────────────────────────────────────────────────────────────────
const at = (t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
const sp = (t) => `<p:sp><p:txBody>${at(t)}</p:txBody></p:sp>`;
/** DrawingML 표는 **격자의 모든 칸에 <a:tc>가 있다** — 가로 병합은 뒤칸에 hMerge="1" 표시만
 *  단다(빈 칸). 그래서 pptx는 gridSpan으로 칸을 늘리면 두 배가 된다. */
const atc = (t, 속성 = "") => `<a:tc${속성}><a:txBody>${t ? at(t) : "<a:p><a:endParaRPr/></a:p>"}</a:txBody><a:tcPr/></a:tc>`;
const atr = (칸들) => `<a:tr h="370840">${칸들.join("")}</a:tr>`;
const slide1 =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<p:sld ${A} ${P}><p:cSld><p:spTree>` +
  sp("보안 점검 요약") +
  `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblPr/>` +
  `<a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>` +
  atr([atc("구분"), atc("건수"), atc("비고")]) +
  atr([atc("높음"), atc("3"), atc("즉시 조치")]) +
  atr([atc("합계 3건", ' gridSpan="2"'), atc("", ' hMerge="1"'), atc("-")]) +
  `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
  sp("표 뒤 설명 문장") +
  `</p:spTree></p:cSld></p:sld>`;
const slide2 =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<p:sld ${A} ${P}><p:cSld><p:spTree>` + sp("표가 없는 슬라이드") + `</p:spTree></p:cSld></p:sld>`;
// 병합 뒤칸에 **글이 남아 있는** 표 — 파워포인트가 아닌 도구(내보내기·변환기)가 만든 pptx에서
//   실제로 나온다. 종전 추출기는 그 글을 살렸는데 표 갈래 첫 판이 조용히 버리고 있었다
//   (2026-09-08 검토관 적발③). 「낱말 손실 0」 계약이 이 갈래에서만 깨지던 자리다.
const slide3 =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<p:sld ${A} ${P}><p:cSld><p:spTree>` +
  `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblPr/>` +
  `<a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>` +
  atr([atc("가로 앞", ' gridSpan="2"'), atc("가로뒤_남은글", ' hMerge="1"')]) +
  atr([atc("세로 위"), atc("세로아래_남은글", ' vMerge="1"')]) +
  `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
  `</p:spTree></p:cSld></p:sld>`;

const CT = (parts) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${parts}</Types>`;
const RELS = (target, type) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;

async function 굽기(이름, 파일들) {
  const zip = new JSZip();
  for (const [n, v] of Object.entries(파일들)) zip.file(n, v);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(path.join(여기, 이름), buf);
  console.log(`${이름} — ${buf.length.toLocaleString()}바이트`);
}

await 굽기("table.docx", {
  "[Content_Types].xml": CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
  "_rels/.rels": RELS("word/document.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
  "word/document.xml": document_xml,
});
// ── 망가진 docx — `</w:tbl>`가 없다 ─────────────────────────────────────────
//   왜 필요한가: 깊이를 세는 스캐너가 표를 **끝내 못 닫으면** 마지막 조각을 어디서부터 낼지가
//   갈린다. 자리를 잘못 잡으면 표 앞 본문이 **두 번** 나온다(같은 글이 조각으로 두 벌 들어간다).
//   자체 검토(2026-09-08)에서 실제로 그 꼴이었고, 그걸 두 번 다시 못 밟게 픽스처로 박는다.
// ★ **닫힌 표를 앞에 하나 둔다**(2026-09-08 검토관 적발④). 안 닫힌 표만 있으면 「표가 하나도
//   없다」로 읽혀 docx 빠른길(본문글 한 줄)로 빠지고, 그 순간 이 픽스처는 **가드가 있든 없든
//   같은 답**을 낸다 — 실제로 가드 한 줄(`끝난자리 = m.index`)을 지워도 시험이 전부 초록이었다.
//   닫힌 표가 하나라도 있어야 구간 나누기 갈래로 들어가고, 그때 「표 사이 본문」이 두 번 나온다.
const 망가진 =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document ${W}><w:body>` + wp("앞 문단 한 번만") +
  wtbl([
    wtr([wtc(["닫힌 머리"]), wtc(["닫힌 머리2"])]),
    wtr([wtc(["닫힌 값"]), wtc(["닫힌 값2"])]),
  ]) +
  wp("표 사이 본문 한 번만") +
  `<w:tbl><w:tr>${wtc(["안 닫힌 칸"])}</w:tr>` +   // </w:tbl> 없음 — 일부러
  `</w:body></w:document>`;
await 굽기("table-broken.docx", {
  "[Content_Types].xml": CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
  "_rels/.rels": RELS("word/document.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
  "word/document.xml": 망가진,
});
await 굽기("table-wide.docx", {
  "[Content_Types].xml": CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
  "_rels/.rels": RELS("word/document.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
  "word/document.xml": document_wide_xml,
});
await 굽기("table.pptx", {
  "[Content_Types].xml": CT('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'),
  "_rels/.rels": RELS("ppt/presentation.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
  "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ${P}/>`,
  "ppt/slides/slide1.xml": slide1,
  "ppt/slides/slide2.xml": slide2,
  "ppt/slides/slide3.xml": slide3,
});
