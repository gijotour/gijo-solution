// pptxextract.test.ts — **pptx 추출은 dataset.ts가 한다**(2026-09-08 재조준 · 2026-09-10 갈래 P).
//
// ■ 이 시험이 무엇을 잘못 재고 있었나 (설계관 실측 2026-09-08)
//   2026-08-29에 이 시험은 `scripts/extract_doc.py`를 **소스로** 검사했다 — 「[슬라이드 N]」 표시·
//   SmartArt/차트 회수·「(노트)」 표시가 파이썬 코드 안에 글자로 있는지만 봤다. 그런데 그 갈래는
//   **한 번도 불리지 않는다**: dataset.ts:extractDocumentText가 오피스 4종을 파이썬보다 먼저
//   가로챈다(2026-08-22 이관). 즉 **제품이 안 지키는 약속을 시험이 지킨다고 말하고 있었다.**
//   → 파이썬의 오피스 갈래를 지우고, 이 시험을 **살아 있는 갈래**로 겨눴다.
//
// ■ ✅ 백로그 3종이 닫혔다 (2026-09-10, 갈래 P)
//   ① 「[슬라이드 N]」 경계  ② SmartArt(ppt/diagrams)·차트(ppt/charts) 글자 회수  ③ 「(노트)」 표시
//   2026-09-08에는 「표 없는 문서는 글자 하나까지 같다」를 계약으로 걸고 표만 되살렸기 때문에
//   함께 옮길 수 없었다(정면충돌). 이번에 **그 계약의 pptx 몫을 새 계약으로 갈아 끼우고** 옮겼다 —
//   무엇이 달라졌는지는 test/tableextract.test.ts의 「pptx 새 계약」 절이 **낱말 다중집합**으로 잰다.
//
// ■ ✅ 같은 날 검토관이 잡은 것 넷을 여기서 닫는다 (2026-09-10)
//   ⓐ **고아 노트 오귀속**(medium) — 번호 물러나기가 「관계 파일이 있어도」 발동해, 노트 관계가
//      없는 장이 파일 번호만 같은 **고아 노트**(지운 장의 잔해)를 끌어안았다. 종전 갈래는 고아를
//      문서 끝에 두어 오귀속이 없었으니 이번 변경이 **새로 연 구멍**이었다. → 관계 파일이 있으면
//      그 파일이 정본. 물러나기는 관계 파일 자체가 없는 pptx만을 위한 것으로 좁혔다.
//   ⓑ **차트 행 수 폭주**(high) — `<c:pt idx="N">`의 N을 그대로 행 수로 썼다. 열은 표_최대열로
//      막혀 있었지만 **행에는 상한이 없었다.** 실측: idx=2,000,000짜리 **1,741바이트** 입력이
//      12,000,038자·2,000,004줄을 만든다(2.7초). 그 빈 행들은 memory.ts의 반복줄 제거가 「표 본문
//      행」으로 보고 **지켜 주기까지** 한다. → 차트_최대점(1024)으로 막았다. 아래 「폭탄」 시험.
//   ⓒ **확장 차트(chartEx) 누락**(low) — 걸림쇠가 `chart\d+\.xml`뿐이라 파워포인트 2016+의
//      폭포·트리맵·깔때기·상자수염·히스토그램 부품(`chartEx1.xml`)을 조용히 버렸다.
//   ⓓ **헛도는 시험 셋**(medium) — 바깥 링크 거르기·예약된 노트·쓴 노트를 **제품에서 지워도
//      골든이 초록**이었다(다른 가드가 대신 막아 줘 겉보기 답이 같았다). 「담고만 있던 픽스처」의
//      재발이라, deck.pptx를 **가르는 최소 입력**으로 다시 구웠다.
//
// ■ ★ 이 파일의 그물이 진짜인지 확인하는 법 — **변이를 넣고 빨개지는지 본다.**
//   아래 하나를 dataset.ts에 넣고 이 파일 + test/tableextract.test.ts를 돌리면 **반드시 빨개진다**
//   (2026-09-10 실측으로 하나씩 확인했다 — 초록이면 그물이 다시 헐거워진 것이다):
//     ① 차례 읽기 제거(`차례`를 슬라이드파일 그대로)          → ① 시험
//     ② `if (블록.length)` 가드 제거                          → ② 시험
//     ③ 노트를 딸림이 아니라 번호로만 찾기                    → ③ 시험
//     ④ diagrams 걸림쇠 제거 / ⑤ `data\d+` → `\w+`           → ④⑤ 시험
//     ⑥ `값덩이`의 `includes("<c:pt")` 제거                   → ⑥ 시험
//     ⑦ `관계부품들`의 `!r.바깥` 제거                          → ⑦ 시험
//     ⑧ `예약된노트`를 빈 Set으로                             → ⑧ 시험
//     ⑨ `!쓴노트.has(노트)` 제거                              → ⑨ 시험
//     ⑩ 노트 물러나기의 `있음.has(관계경로(n)) ||` 제거        → ⑩ 시험
//     ⑪ chartEx 갈래 제거 / 차트_최대점을 Infinity로          → ⑪·폭탄 시험
//
// ■ ⚠ 도해·차트는 **실물로 못 쟀다**(정직하게 적는다). 저장소·운영의 pptx 3편에 SmartArt·차트가
//   0개다(2026-09-10 실측: 제품소개 32장·GSTS 16장·ASM 수지비 24장). 그래서 아래 deck.pptx가
//   그 갈래의 유일한 그물이고, 픽스처는 **가드를 실제로 가르게** 구웠다
//   (test/fixtures/make-pptx-deck-fixture.mjs 머리말에 갈래 열하나를 적어 두었다).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import JSZip from "jszip";

const { extractDocumentText } = await import("../src/engine/dataset");
const b64 = (n: string) => readFileSync(join(__dirname, "fixtures", n)).toString("base64");
const 뽑기 = (n: string) => extractDocumentText(n, b64(n));

describe("pptx 추출 — 살아 있는 갈래(dataset.ts)를 잰다", () => {
  it("슬라이드가 번호순으로 나오고 발표자 노트도 담긴다", async () => {
    const t = await 뽑기("tiny.pptx");
    expect(t).toContain("1장 개요");
    expect(t).toContain("2장 대응 절차");
    expect(t, "발표자 노트가 빠졌다").toContain("발표자 메모입니다");
    expect(t.indexOf("1장 개요"), "슬라이드 순서가 어긋났다").toBeLessThan(t.indexOf("2장 대응 절차"));
    // ★ 2026-09-10에 **뒤집힌 계약**: 노트는 이제 문서 끝이 아니라 **제 슬라이드 뒤**에 온다.
    //   왜: 종전엔 32장짜리 덱의 노트 32개가 전부 꼬리에 몰려 「어느 장의 메모인가」를 알 길이
    //   없었다(제품소개 덱 실측). 조각으로 잘리면 그 메모는 주인을 영영 잃는다.
    //   tiny.pptx의 노트는 1장 것이므로 이제 「2장 대응 절차」보다 **앞**이다.
    expect(t.indexOf("발표자 메모입니다")).toBeLessThan(t.indexOf("2장 대응 절차"));
    expect(t).toContain("(노트) 발표자 메모입니다");
  });

  it("관계 파일이 **아예 없는** pptx는 번호로 물러나 노트를 찾는다 — 그 길을 막지 않았다", async () => {
    // ⓐ 수리(관계 파일이 있으면 물러나지 않는다)가 이 길까지 막으면 tiny.pptx의 노트가 통째로
    //   사라진다. tiny.pptx에는 ppt/slides/_rels/*가 하나도 없다 — 물러나기의 **정당한** 쓰임이다.
    expect(await 뽑기("tiny.pptx"), "관계 파일 없는 pptx의 노트까지 잃었다").toContain("(노트) 발표자 메모입니다");
  });

  it("표는 파이프 표로 나온다 — 칸이 공백으로 이어붙지 않는다", async () => {
    // 자세한 규격·병합·중첩은 test/tableextract.test.ts가 잰다. 여기서는 **pptx 갈래가
    // 실제로 표를 낸다**는 것만 확인한다(그게 이 파일의 주제다).
    const t = await 뽑기("table.pptx");
    expect(t.split("\n").some((l) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l)),
      "pptx 표가 파이프 표로 안 나온다").toBe(true);
  });
});

// ★ 백로그 3종 + 검토관 수리 — deck.pptx 한 편이 갈래 열하나를 가른다. 골든 하나로 먼저 못박고,
//   아래에서 **걸림쇠마다 이름을 붙여** 다시 잰다(빨개졌을 때 어느 줄인지 바로 보이게).
describe("슬라이드 경계·도해·차트·노트 — deck.pptx", () => {
  it("한 장이 「[슬라이드 N] · 본문 · 도해 · 차트 · (노트)」 한 묶음으로 나온다", async () => {
    expect(await 뽑기("deck.pptx")).toBe([
      "[슬라이드 1]",              // 파일은 slide4.xml — **화면 차례**(sldIdLst)를 따른다
      "넷째 장 관계 파일 없음",      // 관계 파일이 없는 장. 번호가 같은 남의 노트를 **안 가져간다**
      "",
      "[슬라이드 2]",              // 파일은 slide2.xml
      "첫째 장 도해와 차트",
      "",
      "도해 첫 마디 도해 둘째 마디",   // SmartArt(ppt/diagrams/data1.xml) — 슬라이드엔 글자가 없다
      "",
      "분기별 취약점",              // 차트 제목(rich text)
      "",
      "| | 높음 | 보통 |",          // 「범주 × 계열」은 표로 — 머리글 첫 칸은 **비운다**(낱말을 안 지어낸다)
      "| --- | --- | --- |",
      "| 1분기 | 12 | 5 |",
      "| 2분기 | 7 | 3 |",
      "",
      "깔때기 전환",                // 확장 차트(chartEx1.xml) 제목 — 종전엔 통째로 버려졌다
      "",
      "| | 전환 |",                // 확장 차트의 「범주 × 계열」. 계열 이름은 머리글로 한 번만
      "| --- | --- |",
      "| 단계1 | 40 |",
      "| 단계2 | 25 |",
      "",
      "(노트) 이 장은 도해가 핵심입니다",  // 노트는 **관계 파일**로 이 장에 붙는다(번호가 아니다)
      "",
      "[슬라이드 3]",              // 파일은 slide1.xml — 표만 있는 장
      "셋째 장 표",
      "",
      "| 구분 | 값 |",
      "| --- | --- |",
      "| 점검 | 2건 |",
      "",
      "[슬라이드 5]",              // 4번은 그림뿐이라 통째로 없다 — **번호가 건너뛴 것이 곧 그 말**이다
      "다섯째 장 노트 중복 참조",     // 남의 노트를 또 가리키지만 **두 번 싣지 않는다**
      "",
      "(노트) 지운 장의 잔해입니다",   // 고아 노트 — 어느 장에도 안 붙이고 **문서 끝**에 둔다(손실 0)
    ].join("\n"));
  });

  it("① 화면 차례(sldIdLst)를 따른다 — 파일 번호순으로 물러나면 첫 장이 바뀐다", async () => {
    const 줄 = (await 뽑기("deck.pptx")).split("\n");
    expect(줄[0]).toBe("[슬라이드 1]");
    // 파일 번호순이면 여기가 slide1.xml의 「셋째 장 표」가 된다.
    expect(줄[1], "화면 차례가 아니라 파일 번호순으로 읽었다").toBe("넷째 장 관계 파일 없음");
  });

  it("② 글자 없는 장은 표시도 안 낸다 — 건너뛴 번호가 「거기엔 글자가 없었다」는 말이다", async () => {
    const t = await 뽑기("deck.pptx");
    expect(t, "그림뿐인 장이 빈 표시를 냈다").not.toContain("[슬라이드 4]");
    expect(t, "번호를 다시 매겼다 — 그러면 화면의 5장을 가리킬 수 없다").toContain("[슬라이드 5]");
  });

  it("③ 노트는 **관계 파일**로 제 장에 붙는다 — 번호로 짝지으면 엉뚱한 장에 간다", async () => {
    const t = await 뽑기("deck.pptx");
    // notesSlide4.xml은 slide4.xml이 아니라 **slide2.xml**(화면 2장)의 노트다.
    const 노트 = t.indexOf("(노트) 이 장은 도해가 핵심입니다");
    expect(노트, "노트가 없다").toBeGreaterThan(0);
    expect(노트, "노트가 파일 번호가 같은 장(화면 1장)에 붙었다").toBeGreaterThan(t.indexOf("[슬라이드 2]"));
    expect(노트, "노트가 제 장을 넘어갔다").toBeLessThan(t.indexOf("[슬라이드 3]"));
  });

  it("④⑤ SmartArt 글자는 가져오고, 같은 도해의 레이아웃 잡음은 안 가져온다", async () => {
    const t = await 뽑기("deck.pptx");
    expect(t, "SmartArt(diagrams/data1.xml) 글자를 못 가져왔다").toContain("도해 첫 마디 도해 둘째 마디");
    expect(t, "도해 부품 걸림쇠가 헐거워졌다 — 서식 이름이 지식으로 샜다").not.toContain("레이아웃_잡음");
  });

  it("⑥ 차트는 제목 줄 + 「범주 × 계열」 표로 나오고, 오차막대 값은 안 담긴다", async () => {
    const t = await 뽑기("deck.pptx");
    const 줄 = t.split("\n");
    const i = 줄.findIndex((l) => l.startsWith("| 1분기"));
    expect(i, "차트 값이 표로 안 나왔다").toBeGreaterThan(0);
    expect(줄[i - 1], "차트 표에 구분선이 없다").toMatch(/^\s*\|(?:\s*-{2,}\s*\|)+\s*$/);
    expect(줄[i - 2], "계열 이름이 머리글로 안 갔다").toBe("| | 높음 | 보통 |");
    // 부속 수치(오차막대 0.5)는 지식이 아니다 — 담기 시작하면 숫자 잡음이 조각을 오염시킨다.
    expect(t, "오차막대 값이 새어 들어왔다").not.toContain("0.5");
  });

  it("⑦ 바깥 링크(TargetMode=External)는 **경로가 실재 부품과 겹쳐도** 안 따라간다", async () => {
    const t = await 뽑기("deck.pptx");
    // slide1(화면 3장)의 rels에는 `../diagrams/data1.xml`을 가리키는 **바깥** 하이퍼링크가 있다.
    //   바깥 링크는 zip 안에 없으니 보통은 `있음.has()`가 알아서 거르지만, 경로가 우연히 겹치는
    //   이 한 갈래만은 **거르기 가드가 있어야** 막힌다(그 전엔 이 시험이 헛돌았다 — 검토관 적발ⓓ).
    const 표장 = t.slice(t.indexOf("[슬라이드 3]"), t.indexOf("[슬라이드 5]"));
    expect(표장, "바깥 링크를 따라가 남의 도해 글이 표만 있는 장에 붙었다").not.toContain("도해 첫 마디");
    expect(t, "웹 주소가 지식으로 새어 들어왔다").not.toContain("example.invalid");
  });

  it("⑧ 관계 파일 없는 장은 **남이 예약한** 노트를 번호로 가로채지 않는다", async () => {
    const t = await 뽑기("deck.pptx");
    // slide4(화면 1장)는 rels가 없고 파일 번호가 4다. notesSlide**4**는 slide2의 노트인데,
    //   차례상 slide4가 먼저 온다 — 예약 검사가 없으면 여기서 가로채 간다.
    const 일장 = t.slice(t.indexOf("[슬라이드 1]"), t.indexOf("[슬라이드 2]"));
    expect(일장, "번호가 같다는 이유로 남의 노트를 가로챘다").not.toContain("(노트)");
  });

  it("⑨ 한 노트를 두 장이 가리켜도 **한 번만** 싣는다", async () => {
    const t = await 뽑기("deck.pptx");
    const 횟수 = t.split("이 장은 도해가 핵심입니다").length - 1;
    expect(횟수, "같은 노트가 두 번 실렸다 — 조각에 같은 글이 두 벌 들어간다").toBe(1);
  });

  it("⑩ 고아 노트는 **어느 장에도 안 붙이고** 문서 끝에 둔다 — 손실 0, 오귀속 0", async () => {
    const t = await 뽑기("deck.pptx");
    // notesSlide1.xml은 어느 장도 안 가리킨다(지운 장의 잔해). slide1(화면 3장)은 관계 파일이
    //   있고 그 안에 노트 관계가 없다 — 그래도 번호가 같다는 이유로 끌어안으면 **오귀속**이다.
    expect(t, "고아 노트를 잃었다 — 종전 갈래는 이것을 문서 끝에 냈다").toContain("지운 장의 잔해입니다");
    expect(t.indexOf("지운 장의 잔해입니다"), "고아 노트가 파일 번호가 같은 장에 오귀속됐다")
      .toBeGreaterThan(t.indexOf("[슬라이드 5]"));
  });

  it("⑪ 확장 차트(chartEx)도 회수한다 — 제목은 줄글, 「범주 × 계열」은 표", async () => {
    const t = await 뽑기("deck.pptx");
    expect(t, "chartEx 부품을 통째로 버렸다(파워포인트 2016+ 폭포·깔때기·트리맵이 여기 산다)")
      .toContain("깔때기 전환");
    expect(t, "확장 차트 값이 표로 안 나왔다").toContain("| 단계1 | 40 |");
    // 계열 이름은 **표 머리글로 한 번만** — 줄글에 또 담으면 같은 낱말이 두 벌 들어간다.
    expect(t.split("전환").length - 1, "계열 이름이 줄글과 머리글에 두 번 들어갔다").toBe(2);
  });
});

// ★ 폭탄 — 문서가 주는 `idx`를 그대로 믿으면 **작은 입력이 거대한 출력**을 만든다(검토관 적발ⓑ).
//   픽스처로 굽지 않고 여기서 짓는다: 파일로 두면 「무엇이 위험한지」가 안 보이고, 애초에
//   커밋할 만한 문서가 아니다(지식이 아니라 공격 모양이다).
describe("차트 폭탄 — 작은 부품 하나가 수백만 줄을 만들지 못한다", () => {
  const 짓기 = async (idx: number) => {
    const 머리 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
    const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `${머리}<p:sld ${A} ${P}><p:cSld><p:spTree></p:spTree></p:cSld></p:sld>`);
    zip.file("ppt/slides/_rels/slide1.xml.rels",
      `${머리}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="chart" Target="../charts/chart1.xml"/></Relationships>`);
    zip.file("ppt/charts/chart1.xml",
      `${머리}<c:chartSpace ${C} ${A}><c:chart><c:plotArea><c:barChart><c:ser>` +
      `<c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>가</c:v></c:pt></c:strCache></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:numCache><c:pt idx="${idx}"><c:v>9</c:v></c:pt></c:numCache></c:numRef></c:val>` +
      `</c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`);
    return (await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
  };

  it("idx가 200만이어도 출력이 폭주하지 않는다", async () => {
    // 수리 전 실측(2026-09-10): 입력 1,741바이트 → **12,000,038자 · 2,000,004줄 · 2.7초**.
    //   입력 크기와 무관하게 idx에 선형이라, int32 상한이면 12GB를 만들려다 죽는다.
    //   더 나쁜 것: 그 빈 행들은 memory.ts의 반복줄 제거가 「표 본문 행」으로 보고 **지켜 준다.**
    const t = await extractDocumentText("bomb.pptx", await 짓기(2_000_000));
    expect(t.split("\n").length, "차트 행 수에 상한이 없다 — 부품 하나가 인입을 삼킨다")
      .toBeLessThan(1100);   // 차트_최대점(1024) + 머리글·구분선 몇 줄
    expect(t.length, "글자 수가 폭주했다").toBeLessThan(100_000);
  }, 60_000);

  it("상한 아래의 평범한 차트는 그대로 다 나온다 — 상한이 본문을 자르지 않는다", async () => {
    const t = await extractDocumentText("small.pptx", await 짓기(3));
    expect(t, "멀쩡한 차트 값을 잃었다").toContain("9");
    expect(t.split("\n").length, "작은 차트가 부풀었다").toBeLessThan(12);
  });
});
