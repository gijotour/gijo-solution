// test/fixtures/make-pptx-deck-fixture.mjs — pptx 백로그 3종(슬라이드 경계·도해/차트·노트)을
// 재는 최소 덱을 **코드로 굽는다**(2026-09-10, 갈래 P · 같은 날 검토관 적발로 그물을 넓혔다).
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
//   ⚠ 그런데 2026-09-10 검토관이 **이 원칙이 안 지켜진 걸림쇠 셋**을 잡았다: 바깥 링크 거르기·
//     예약된 노트·쓴 노트를 **제품에서 지워도 골든이 초록이었다**(다른 가드가 대신 막아 줘서
//     겉으로는 같은 답이 나왔다). 「담고만 있던 픽스처」가 또 나온 것이라, 아래 ⑦⑧⑨⑩을
//     **가르는 최소 입력**으로 다시 구웠다. 지우면 실제로 빨개지는지는 짝 시험 머리말의
//     변이 목록으로 확인한다.
//
//   이 덱이 가르는 갈래 열 — 하나씩 제품에서 그 줄을 지우면 골든이 빨개진다:
//   ① 화면 차례(sldIdLst) — 파일 번호는 1~5인데 **차례는 slide4 → slide2 → slide1 → slide3 → slide5**.
//      차례 읽기를 지우고 번호순으로 물러나면 「[슬라이드 1]」의 내용이 바뀐다.
//   ② 글자 없는 장 건너뛰기 — 차례 4번(slide3.xml)은 그림뿐이다. 골든에 「[슬라이드 4]」가
//      없고 3 다음이 **5**인 것이 「4장엔 글자가 없었다」는 말이다.
//   ③ 노트를 **관계로** 잇기 — notesSlide4.xml은 slide4.xml이 아니라 **slide2.xml**의 노트다.
//      번호로 짝지으면 엉뚱한 장에 붙어 골든이 빨개진다.
//   ④ SmartArt 회수 — ppt/diagrams/data1.xml. 끄면 「도해 …」 두 마디가 통째로 사라진다.
//   ⑤ 도해 부품 걸림쇠(dataN.xml만) — 같은 도해의 layout1.xml에 **잡음 글자**를 심어 두었다.
//      걸림쇠를 넓히면 「레이아웃_잡음」이 지식으로 새어 나온다.
//   ⑥ 차트 — 제목은 줄글로, 「범주 × 계열」은 파이프 표로. 그리고 오차막대의 값(0.5)은
//      **안 담긴다**(부속 수치는 지식이 아니다). 오차막대의 `<c:val val="1"></c:val>`을 일부러
//      **닫는 태그 꼴**로 적었다 — 「`<c:pt>`를 가진 c:val만 고른다」 가드를 지우면 이것이 먼저
//      잡혀 값 칸이 통째로 비고 골든이 빨개진다(그렇게 적는 도구가 실제로 있다).
//   ⑦ **바깥 링크 거르기**(2026-09-10 신설) — slide1의 rels에 `TargetMode="External"`인데 Target이
//      **상대 경로**라 풀면 실재 부품과 겹치는 링크(`../diagrams/data1.xml`)를 넣었다. 바깥 링크는
//      zip 안에 없으니 보통은 `있음.has()`가 알아서 거른다 — 그래서 **겹치는 이 한 갈래만이**
//      거르기 가드를 가른다. 지우면 도해 글이 **표만 있는 장**에 붙는다.
//      (곁들여 흔한 꼴인 http 바깥 링크도 함께 둔다 — 그건 종전대로 경로에서 걸린다.)
//   ⑧ **예약된 노트**(2026-09-10 신설) — slide4.xml은 **관계 파일이 아예 없고**(변환기 산출물의
//      모양) 파일 번호가 4다. 그런데 notesSlide**4**.xml은 slide2가 관계로 가리키는 노트다.
//      차례상 slide4가 **먼저** 오므로, 예약 검사를 지우면 slide4가 남의 노트를 가로챈다.
//   ⑨ **쓴 노트 중복 방지**(2026-09-10 신설) — slide5.xml의 rels가 notesSlide4.xml을 **또** 가리킨다
//      (한 노트를 두 장이 가리키는 망가진 관계 — 변환기 산출물에서 나온다). 지우면 같은 노트가
//      두 장에 두 번 실린다.
//   ⑩ **고아 노트는 꼬리로**(2026-09-10 신설) — notesSlide1.xml은 **어느 장도 안 가리킨다**(지운
//      장의 잔해). slide1.xml은 관계 파일이 있고 그 안에 노트 관계가 없다. 번호 물러나기가
//      「관계 파일이 있어도」 발동하면 이 고아가 slide1(차례 3번) 자리에 **오귀속**된다.
//      ⚠ 그래서 slide1을 **차례 끝에 두면 안 된다** — 끝에 두면 오귀속된 자리와 꼬리가 같은
//        글자로 찍혀 골든이 둘을 못 가른다(2026-09-10에 실제로 그렇게 구웠다가 탐침으로 잡았다).
//        지금은 차례 3번이라, 오귀속되면 뒤따르는 「[슬라이드 5]」보다 **앞**에 나와 갈린다.
//   ⑪ **확장 차트(chartEx)**(2026-09-10 신설) — 파워포인트 2016+의 폭포·깔때기·트리맵·상자수염·
//      히스토그램은 `ppt/charts/chartEx1.xml`이라는 **딴 부품**에 들어간다. 걸림쇠가 chartN.xml뿐이면
//      통째로 버려진다.
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
const CX = 'xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"';
const DGM = 'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"';
const 머리 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const at = (t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`;
const sp = (t) => `<p:sp><p:txBody>${at(t)}</p:txBody></p:sp>`;
const atc = (t) => `<a:tc><a:txBody>${t ? at(t) : "<a:p><a:endParaRPr/></a:p>"}</a:txBody><a:tcPr/></a:tc>`;
const atr = (칸들) => `<a:tr h="370840">${칸들.join("")}</a:tr>`;
const 장 = (안) => `${머리}<p:sld ${A} ${P}><p:cSld><p:spTree>${안}</p:spTree></p:cSld></p:sld>`;

// ── 차례 2번이 될 장 (파일 이름은 slide2.xml) — 도해·차트·확장차트·노트가 딸린다 ──────────
const slide2 = 장(
  sp("첫째 장 도해와 차트") +
  // SmartArt·차트는 슬라이드 XML에 **글자를 안 담는다** — 관계(rels)로 딴 부품을 가리킬 뿐이다.
  //   그래서 종전 추출기는 이 장을 「첫째 장 도해와 차트」 한 줄로만 읽었다.
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">` +
  `<dgm:relIds ${DGM} ${R} r:dm="rId2" r:lo="rId3"/></a:graphicData></a:graphic></p:graphicFrame>` +
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
  `<c:chart ${C} ${R} r:id="rId4"/></a:graphicData></a:graphic></p:graphicFrame>` +
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex">` +
  `<cx:chart ${CX} ${R} r:id="rId5"/></a:graphicData></a:graphic></p:graphicFrame>`);
// ── 차례 4번 (slide3.xml) — **글자가 하나도 없다**(그림뿐) ─────────────────────────
const slide3 = 장(`<p:pic><p:blipFill><a:blip ${R} r:embed="rId1"/></p:blipFill></p:pic>`);
// ── 차례 3번 (slide1.xml) — 표. 표 갈래는 **종전 그대로**여야 한다 ────────────────
const slide1 = 장(
  sp("셋째 장 표") +
  `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblPr/>` +
  `<a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>` +
  atr([atc("구분"), atc("값")]) + atr([atc("점검"), atc("2건")]) +
  `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`);
// ── 차례 1번 (slide4.xml) — **관계 파일이 아예 없다.** 파일 번호 4가 notesSlide4와 겹친다(⑧) ──
const slide4 = 장(sp("넷째 장 관계 파일 없음"));
// ── 차례 5번 (slide5.xml) — rels가 남의 노트(notesSlide4)를 **또** 가리킨다(⑨) ──────────
const slide5 = 장(sp("다섯째 장 노트 중복 참조"));

const 노트장 = (t) => `${머리}<p:notes ${A} ${P}><p:cSld><p:spTree>${sp(t)}</p:spTree></p:cSld></p:notes>`;
const notes4 = 노트장("이 장은 도해가 핵심입니다");      // slide2의 노트 (관계로 이어진다)
const notes1 = 노트장("지운 장의 잔해입니다");           // 고아 — 어느 장도 안 가리킨다 (⑩)

// SmartArt 데이터 — 사람이 쓴 글은 여기(dataN.xml)에 <a:t>로 있다.
const data1 =
  `${머리}<dgm:dataModel ${DGM} ${A}><dgm:ptLst>` +
  `<dgm:pt modelId="1"><dgm:t>${at("도해 첫 마디")}</dgm:t></dgm:pt>` +
  `<dgm:pt modelId="2"><dgm:t>${at("도해 둘째 마디")}</dgm:t></dgm:pt>` +
  `</dgm:ptLst></dgm:dataModel>`;
// 같은 도해의 레이아웃 — **사람이 쓴 글이 아니다.** 걸림쇠가 dataN.xml만 읽는지 가르는 잡음.
const layout1 = `${머리}<dgm:layoutDef ${DGM} ${A}><dgm:title val="x"/>${at("레이아웃_잡음")}</dgm:layoutDef>`;

// 차트(c:) — 제목은 rich text(<a:t>), 계열 이름·범주·값은 <c:v>.
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

// 확장 차트(cx:) — 이름표는 `<a:t>`·`<cx:v>`, 데이터는 `<cx:pt>`에 **바로** 들어 있어
//   `<c:v>` 껍질이 없다. c: 갈래의 정규식으로는 원리상 못 읽는다(⑪).
const cx점 = (i, v) => `<cx:pt idx="${i}">${v}</cx:pt>`;
const chartEx1 =
  `${머리}<cx:chartSpace ${CX} ${A}><cx:chartData>` +
  `<cx:data id="0">` +
  `<cx:strDim type="cat"><cx:f>Sheet1!$A$2:$A$3</cx:f>` +
  `<cx:lvl ptCount="2">${cx점(0, "단계1")}${cx점(1, "단계2")}</cx:lvl></cx:strDim>` +
  `<cx:numDim type="val"><cx:f>Sheet1!$B$2:$B$3</cx:f>` +
  `<cx:lvl ptCount="2">${cx점(0, "40")}${cx점(1, "25")}</cx:lvl></cx:numDim>` +
  `</cx:data></cx:chartData><cx:chart>` +
  `<cx:title><cx:tx><cx:rich>${at("깔때기 전환")}</cx:rich></cx:tx></cx:title>` +
  `<cx:plotArea><cx:plotAreaRegion><cx:series layoutId="funnel" uniqueId="{00000000-0000-0000-0000-000000000001}">` +
  `<cx:tx><cx:txData><cx:f>Sheet1!$B$1</cx:f><cx:v>전환</cx:v></cx:txData></cx:tx>` +
  `<cx:dataId val="0"/></cx:series></cx:plotAreaRegion></cx:plotArea>` +
  `</cx:chart></cx:chartSpace>`;

// 화면 차례 — **slide4 → slide2 → slide1 → slide3 → slide5**. 파일 번호와 일부러 어긋내
//   차례 읽기를 가른다(①). 차례 4번(slide3)은 글자가 없어 골든에서 통째로 빠진다(②).
const presentation =
  `${머리}<p:presentation ${P} ${R}><p:sldIdLst>` +
  `<p:sldId id="256" r:id="rId4"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId1"/>` +
  `<p:sldId id="259" r:id="rId3"/><p:sldId id="260" r:id="rId5"/>` +
  `</p:sldIdLst></p:presentation>`;

const 관계 = (줄들) =>
  `${머리}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${줄들.join("")}</Relationships>`;
// type이 http로 시작하면 그대로 쓴다 — chartEx는 openxmlformats가 아니라 **마이크로소프트** 이름이다.
const 관계줄 = (id, type, target, 바깥 = false) =>
  `<Relationship Id="${id}" Type="${type.startsWith("http") ? type : `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}`}" Target="${target}"${바깥 ? ' TargetMode="External"' : ""}/>`;

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
    관계줄("rId4", "slide", "slides/slide4.xml"),
    관계줄("rId5", "slide", "slides/slide5.xml"),
  ]),
  "ppt/slides/slide1.xml": slide1,
  "ppt/slides/slide2.xml": slide2,
  "ppt/slides/slide3.xml": slide3,
  "ppt/slides/slide4.xml": slide4,
  "ppt/slides/slide5.xml": slide5,
  // ⑦ 바깥 링크 거르기를 가르는 자리 — rId2는 **상대 경로**라 풀면 실재 부품과 겹친다.
  //    거르기를 지우면 도해 글이 표만 있는 장에 붙는다. rId3은 흔한 http 꼴(경로에서 걸린다).
  "ppt/slides/_rels/slide1.xml.rels": 관계([
    관계줄("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
    관계줄("rId2", "hyperlink", "../diagrams/data1.xml", true),
    관계줄("rId3", "hyperlink", "https://example.invalid/보고서", true),
  ]),
  // ⚠ rId 번호순이 곧 딸림 차례다 — 도해(rId2) → 차트(rId4) → 확장차트(rId5).
  "ppt/slides/_rels/slide2.xml.rels": 관계([
    관계줄("rId1", "notesSlide", "../notesSlides/notesSlide4.xml"),
    관계줄("rId2", "diagramData", "../diagrams/data1.xml"),
    관계줄("rId3", "diagramLayout", "../diagrams/layout1.xml"),
    관계줄("rId4", "chart", "/ppt/charts/chart1.xml"),   // 절대형 Target도 편다
    관계줄("rId5", "http://schemas.microsoft.com/office/2014/relationships/chartEx", "../charts/chartEx1.xml"),
  ]),
  "ppt/slides/_rels/slide3.xml.rels": 관계([관계줄("rId1", "image", "../media/image1.png")]),
  // ⑧ slide4.xml.rels는 **일부러 없다** — 관계 파일 없는 pptx의 번호 물러나기를 가르는 자리.
  // ⑨ 한 노트를 두 장이 가리킨다.
  "ppt/slides/_rels/slide5.xml.rels": 관계([관계줄("rId1", "notesSlide", "../notesSlides/notesSlide4.xml")]),
  "ppt/notesSlides/notesSlide4.xml": notes4,
  "ppt/notesSlides/notesSlide1.xml": notes1,   // ⑩ 고아
  "ppt/diagrams/data1.xml": data1,
  "ppt/diagrams/layout1.xml": layout1,
  "ppt/charts/chart1.xml": chart1,
  "ppt/charts/chartEx1.xml": chartEx1,
  "ppt/media/image1.png": Buffer.from("89504e470d0a1a0a", "hex"),
};

const zip = new JSZip();
for (const [n, v] of Object.entries(파일들)) zip.file(n, v);
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(path.join(여기, "deck.pptx"), buf);
console.log(`deck.pptx — ${buf.length.toLocaleString()}바이트`);
