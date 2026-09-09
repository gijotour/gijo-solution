// test/fixtures/make-pptx-deck-fixture.mjs — pptx 백로그 3종(슬라이드 경계·도해/차트·노트)을
// 재는 최소 덱을 **코드로 굽는다**(2026-09-10, 갈래 P).
//
// 왜 실물을 안 쓰나 (2026-09-10 실측):
//   저장소·운영의 pptx 3편(제품소개 32장 · GSTS 16장 · ASM 수지비 24장)에 **SmartArt·차트가
//   0개**다(제품소개엔 ppt/charts/ 폴더가 있지만 **빈 폴더**다). 즉 도해·차트 갈래는 실물로는
//   원리상 못 잰다 — 병합 셀과 같은 부류다. 여기 픽스처가 그 갈래의 **유일한** 그물이다.
//
// 다시 굽기:  node server/test/fixtures/make-pptx-deck-fixture.mjs
//   ⚠ 다시 구우면 deck.pptx가 덮어써진다 — 짝 시험(test/pptxextract.test.ts)의 골든이 이 파일과
//     한 몸이다. 여기를 고치면 그 시험도 함께 고친다.
//
// ★ 픽스처는 **가드를 실제로 가르는 것**만 넣는다(2026-09-08 검토관 적발④⑤의 교훈).
//   이 덱이 가르는 갈래 여섯 — 하나씩 제품에서 그 줄을 지우면 골든이 빨개진다:
//   ① 화면 차례(sldIdLst) — 파일 번호는 1·2·3인데 **차례는 slide2 → slide3 → slide1**이다.
//      차례 읽기를 지우고 번호순으로 물러나면 「[슬라이드 1]」의 내용이 바뀐다.
//   ② 글자 없는 장 건너뛰기 — 차례 2번(slide3.xml)은 그림뿐이다. 골든에 「[슬라이드 2]」가
//      없고 1 다음이 **3**인 것이 「2장엔 글자가 없었다」는 말이다.
//   ③ 노트를 **관계로** 잇기 — notesSlide1.xml은 slide1.xml이 아니라 **slide2.xml**의 노트다.
//      번호로 짝지으면 엉뚱한 장에 붙어 골든이 빨개진다.
//   ④ SmartArt 회수 — ppt/diagrams/data1.xml. 끄면 「도해 …」 두 마디가 통째로 사라진다.
//   ⑤ 도해 부품 걸림쇠(dataN.xml만) — 같은 도해의 layout1.xml에 **잡음 글자**를 심어 두었다.
//      걸림쇠를 넓히면 「레이아웃_잡음」이 지식으로 새어 나온다.
//   ⑥ 차트 — 제목은 줄글로, 「범주 × 계열」은 파이프 표로. 그리고 오차막대의 값(0.5)은
//      **안 담긴다**(부속 수치는 지식이 아니다). 오차막대의 `<c:val val="1"></c:val>`을 일부러
//      **닫는 태그 꼴**로 적었다 — 「`<c:pt>`를 가진 c:val만 고른다」 가드를 지우면 이것이 먼저
//      잡혀 값 칸이 통째로 비고 골든이 빨개진다(그렇게 적는 도구가 실제로 있다).
import { createRequire } from "module";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const 여기 = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(여기, "..", "..", "package.json"));
const JSZip = require("jszip");

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const DGM = 'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"';
const 머리 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const at = (t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
const sp = (t) => `<p:sp><p:txBody>${at(t)}</p:txBody></p:sp>`;
const atc = (t) => `<a:tc><a:txBody>${t ? at(t) : "<a:p><a:endParaRPr/></a:p>"}</a:txBody><a:tcPr/></a:tc>`;
const atr = (칸들) => `<a:tr h="370840">${칸들.join("")}</a:tr>`;

// ── 차례 1번이 될 장 (파일 이름은 slide2.xml) — 도해·차트·노트가 딸린다 ──────────────
const slide2 =
  `${머리}<p:sld ${A} ${P}><p:cSld><p:spTree>` + sp("첫째 장 도해와 차트") +
  // SmartArt·차트는 슬라이드 XML에 **글자를 안 담는다** — 관계(rels)로 딴 부품을 가리킬 뿐이다.
  //   그래서 종전 추출기는 이 장을 「첫째 장 도해와 차트」 한 줄로만 읽었다.
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">` +
  `<dgm:relIds ${DGM} ${R} r:dm="rId2" r:lo="rId3"/></a:graphicData></a:graphic></p:graphicFrame>` +
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
  `<c:chart ${C} ${R} r:id="rId4"/></a:graphicData></a:graphic></p:graphicFrame>` +
  `</p:spTree></p:cSld></p:sld>`;
// ── 차례 2번 (slide3.xml) — **글자가 하나도 없다**(그림뿐) ─────────────────────────
const slide3 =
  `${머리}<p:sld ${A} ${P}><p:cSld><p:spTree>` +
  `<p:pic><p:blipFill><a:blip ${R} r:embed="rId1"/></p:blipFill></p:pic>` +
  `</p:spTree></p:cSld></p:sld>`;
// ── 차례 3번 (slide1.xml) — 표. 표 갈래는 **종전 그대로**여야 한다 ────────────────
const slide1 =
  `${머리}<p:sld ${A} ${P}><p:cSld><p:spTree>` + sp("셋째 장 표") +
  `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblPr/>` +
  `<a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>` +
  atr([atc("구분"), atc("값")]) + atr([atc("점검"), atc("2건")]) +
  `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
  `</p:spTree></p:cSld></p:sld>`;

const notes1 = `${머리}<p:notes ${A} ${P}><p:cSld><p:spTree>` + sp("이 장은 도해가 핵심입니다") + `</p:spTree></p:cSld></p:notes>`;

// SmartArt 데이터 — 사람이 쓴 글은 여기(dataN.xml)에 <a:t>로 있다.
const data1 =
  `${머리}<dgm:dataModel ${DGM} ${A}><dgm:ptLst>` +
  `<dgm:pt modelId="1"><dgm:t>${at("도해 첫 마디")}</dgm:t></dgm:pt>` +
  `<dgm:pt modelId="2"><dgm:t>${at("도해 둘째 마디")}</dgm:t></dgm:pt>` +
  `</dgm:ptLst></dgm:dataModel>`;
// 같은 도해의 레이아웃 — **사람이 쓴 글이 아니다.** 걸림쇠가 dataN.xml만 읽는지 가르는 잡음.
const layout1 = `${머리}<dgm:layoutDef ${DGM} ${A}><dgm:title val="x"/>${at("레이아웃_잡음")}</dgm:layoutDef>`;

// 차트 — 제목은 rich text(<a:t>), 계열 이름·범주·값은 <c:v>.
const 점 = (i, v) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`;
const 계열 = (이름, 값들) =>
  `<c:ser><c:idx val="0"/><c:order val="0"/>` +
  `<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache>${점(0, 이름)}</c:strCache></c:strRef></c:tx>` +
  // 오차막대 — 부속 수치(0.5)는 지식이 아니다. `<c:val val="1"></c:val>`을 **닫는 태그 꼴**로
  //   적어, 「<c:pt>를 가진 c:val만 고른다」 가드를 가른다(위 머리말 ⑥).
  `<c:errBars><c:errBarType val="both"/><c:plus><c:numRef><c:numCache>${점(0, "0.5")}</c:numCache></c:numRef></c:plus>` +
  `<c:val val="1"></c:val></c:errBars>` +
  `<c:cat><c:strRef><c:strCache>${점(0, "1분기")}${점(1, "2분기")}</c:strCache></c:strRef></c:cat>` +
  `<c:val><c:numRef><c:numCache>${값들.map((v, i) => 점(i, v)).join("")}</c:numCache></c:numRef></c:val></c:ser>`;
const chart1 =
  `${머리}<c:chartSpace ${C} ${A}><c:chart>` +
  `<c:title><c:tx><c:rich>${at("분기별 취약점")}</c:rich></c:tx></c:title>` +
  `<c:plotArea><c:barChart>` + 계열("높음", ["12", "7"]) + 계열("보통", ["5", "3"]) + `</c:barChart></c:plotArea>` +
  `</c:chart></c:chartSpace>`;

// 화면 차례 — **slide2 → slide3 → slide1**. 파일 번호와 일부러 어긋내 차례 읽기를 가른다.
const presentation =
  `${머리}<p:presentation ${P} ${R}><p:sldIdLst>` +
  `<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId1"/>` +
  `</p:sldIdLst></p:presentation>`;

const 관계 = (줄들) =>
  `${머리}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${줄들.join("")}</Relationships>`;
const 관계줄 = (id, type, target, 바깥 = false) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${바깥 ? ' TargetMode="External"' : ""}/>`;

const 파일들 = {
  "[Content_Types].xml":
    `${머리}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `</Types>`,
  "_rels/.rels": 관계([관계줄("rId1", "officeDocument", "ppt/presentation.xml")]),
  "ppt/presentation.xml": presentation,
  "ppt/_rels/presentation.xml.rels": 관계([
    관계줄("rId1", "slide", "slides/slide1.xml"),
    관계줄("rId2", "slide", "slides/slide2.xml"),
    관계줄("rId3", "slide", "slides/slide3.xml"),
  ]),
  "ppt/slides/slide1.xml": slide1,
  "ppt/slides/slide2.xml": slide2,
  "ppt/slides/slide3.xml": slide3,
  "ppt/slides/_rels/slide1.xml.rels": 관계([관계줄("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]),
  // ⚠ rId 번호순이 곧 딸림 차례다 — 도해(rId2)가 차트(rId4)보다 먼저 온다.
  //   바깥 링크(rId5)는 zip 안에 없다 — 걸러지는지 함께 가른다.
  "ppt/slides/_rels/slide2.xml.rels": 관계([
    관계줄("rId1", "notesSlide", "../notesSlides/notesSlide1.xml"),
    관계줄("rId2", "diagramData", "../diagrams/data1.xml"),
    관계줄("rId3", "diagramLayout", "../diagrams/layout1.xml"),
    관계줄("rId4", "chart", "/ppt/charts/chart1.xml"),   // 절대형 Target도 편다
    관계줄("rId5", "hyperlink", "https://example.invalid/보고서", true),
  ]),
  "ppt/slides/_rels/slide3.xml.rels": 관계([관계줄("rId1", "image", "../media/image1.png")]),
  "ppt/notesSlides/notesSlide1.xml": notes1,
  "ppt/diagrams/data1.xml": data1,
  "ppt/diagrams/layout1.xml": layout1,
  "ppt/charts/chart1.xml": chart1,
  "ppt/media/image1.png": Buffer.from("89504e470d0a1a0a", "hex"),
};

const zip = new JSZip();
for (const [n, v] of Object.entries(파일들)) zip.file(n, v);
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(path.join(여기, "deck.pptx"), buf);
console.log(`deck.pptx — ${buf.length.toLocaleString()}바이트`);
