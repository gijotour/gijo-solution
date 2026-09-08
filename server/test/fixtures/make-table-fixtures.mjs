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
//   ⚠ 다시 구우면 table.docx·table.pptx가 **덮어써진다** — 짝 시험(test/tableextract.test.ts)의
//     기대값이 이 파일의 내용과 한 몸이다. 여기를 고치면 그 시험도 함께 고친다.
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
const 안쪽표 = wtbl([wtr([wtc(["안쪽칸"])])]);
const 표3 = wtbl([
  wtr([wtc(["바깥 머리1"]), wtc(["바깥 머리2"])]),
  wtr([wtc(["바깥칸"]), `<w:tc>${안쪽표}</w:tc>`]),
]);

const document_xml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document ${W}><w:body>` +
  wp("표 앞 문단입니다") + 표1 + wp("표 사이 문단") + 표2 + 표3 + wp("표 뒤 문단") +
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
const 망가진 =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document ${W}><w:body>` + wp("앞 문단 한 번만") +
  `<w:tbl><w:tr>${wtc(["안 닫힌 칸"])}</w:tr>` +   // </w:tbl> 없음 — 일부러
  `</w:body></w:document>`;
await 굽기("table-broken.docx", {
  "[Content_Types].xml": CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
  "_rels/.rels": RELS("word/document.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
  "word/document.xml": 망가진,
});
await 굽기("table.pptx", {
  "[Content_Types].xml": CT('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'),
  "_rels/.rels": RELS("ppt/presentation.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
  "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ${P}/>`,
  "ppt/slides/slide1.xml": slide1,
  "ppt/slides/slide2.xml": slide2,
});
