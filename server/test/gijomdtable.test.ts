// test/gijomdtable.test.ts — **화면이 표를 읽는 잣대도 tabletext 한 벌이다.**
//
// ■ 증상 (2026-09-10, 갈래 C)
//   서버는 「무엇이 표인가」를 engine/tabletext.ts 한 곳으로 모았는데(갈래 U),
//   **사람이 실제로 보는 화면**은 그 규격을 모른 채 제 나름대로 읽고 있었다 —
//   client/src/renderer/pages/gijomd.js의 「표 규격」 구간(공용 마크다운 렌더러, 문서함과
//   대화창이 함께 쓴다). ⚠ 줄 번호로 가리키지 않는다 — 손볼 때마다 어긋난다.
//     ㄱ 칸 안 이스케이프 `\|` 를 모른다 — `split("|")`로 갈라 **칸이 하나 더 생기고**
//        역슬래시가 화면에 그대로 남는다. 추출기 칸글()이 실제로 내는 꼴이라 잠복이 아니다.
//     ㄴ 구분선을 헐겁게 본다 — `/^\s*\|?[\s:|-]+\|[\s:|-]*$/`. 「해당 없음」을 적은 본문 행
//        `| - | - |`까지 구분선으로 삼켜, 서버가 본문 행으로 살려 낸 것을 화면이 도로 먹는다.
//     ㄷ 행마다 칸 수가 달라도 안 맞춘다 — 꼬리 파이프를 빠뜨린 줄이 1칸으로 찌그러진 채
//        표에 들어가, 내보내기(inspectionHtml/Docx)가 고친 바로 그 증상이 화면에만 남는다.
//
// ■ 2차 (같은 날, 검토관 4건 — 전부 **실행 재현**)
//   ① 조임이 GFM 표를 죽였다 — `| - | - |` · `| :- | -: |` · 앞 파이프 없는 `--- | ---`가
//      표로 안 그려졌다(수리 전에는 셋 다 표였다). 게다가 **조여서 얻는 것이 0**이다:
//      화면은 「구분선인가」를 머리글 바로 다음 줄 **한 자리에서만** 묻기 때문에, 위 ㄴ이 말한
//      「본문 행을 삼킨다」가 원리상 안 일어난다. → 화면 잣대를 GFM 초집합(표구분선)으로.
//   ② 표의 **범위**를 안 옮겼다 — 이어가기가 `/\|/`라, 표 바로 뒤(빈 줄 없이) 붙은 문장
//      하나가 표에 들어와 새 폭 맞추기와 겹쳐 표 **전체에 빈 열을 번식**시켰다. → 표줄로 조인다.
//   ③ 표행맞추기 사본이 `=== undefined`라 **null에서 원본과 갈렸다**(원본은 `?? ""`). 동치
//      모집단에 null이 없어 안 잡혔다. → `== null` + 모집단에 null·구멍 추가.
//   ④ 「★ 내보내기와 같은 답」 시험이 **내보내기를 한 번도 안 불렀다**(화면 자기 칸 수만 쟀다).
//      → inspectionHtml을 실제로 불러 행별 칸 수를 맞대고, 아직 갈리는 자리는 따로 적어 둔다.
//
// ■ 왜 사본을 허용하나
//   gijomd.js는 preload 없이 도는 순수 브라우저 스크립트라 서버 TS를 import할 길이 **원리상**
//   없다(빌드 파이프라인이 없다 — 화면은 소스를 그대로 싣는다). 그래서 사본이 불가피하다.
//   대신 **어긋나면 빨개지는 시험**을 둔다: 아래 「두 구현 동치」가 같은 입력을 양쪽에 먹여
//   같은 답이 나오는지 잰다. 고칠 때는 **언제나 tabletext.ts를 먼저** 고치고 옮겨 적는다.
//
// ■ 하네스
//   dimestimates-scope.test.ts가 쓰는 방식 그대로 — 제품 파일을 `new Function("window", src)`로
//   **실제로 실행**해서 잰다. 소스를 정규식으로 훑는 감시가 아니라 **돌려 보고** 재는 것이라,
//   「고쳤다고 적었는데 안 도는」 갈래가 안 생긴다.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { 구분선, 칸가르기, 표행맞추기, 표_최대열, 칸글, 파이프표 } from "../src/engine/tabletext";
import { inspectionHtml } from "../src/engine/inspectionreport";

const 페이지 = path.join(__dirname, "../../client/src/renderer/pages");
const mdSrc = fs.readFileSync(path.join(페이지, "gijomd.js"), "utf8");

/** 제품 렌더러를 그대로 불러온다 — 가짜 window 하나면 된다(DOM을 안 만진다). */
const gijoMd: any = (() => {
  const win: any = {};
  // eslint-disable-next-line no-new-func
  new Function("window", mdSrc)(win);
  return win.gijoMd;
})();

/** 그린 표의 **행별 칸 수**. `<th>`와 `<td>`를 함께 센다 — 머리글도 한 표의 행이다. */
const 칸수 = (html: string) =>
  [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => (m[1].match(/<t[hd]>/g) ?? []).length);

// ── ⓪ 하네스 자기 점검 — 여기가 무너지면 아래 초록이 전부 거짓이다 ────────────────────
describe("하네스", () => {
  it("제품 파일이 실제로 실행돼 렌더러가 잡힌다", () => {
    expect(typeof gijoMd?.render, "gijomd.js가 window.gijoMd를 안 걸었다").toBe("function");
    expect(gijoMd.render("# 제목")).toContain("<h1>제목</h1>");
  });

  it("표를 표로 그린다 — 아래 시험이 `<table>`이 아예 안 나오는 것으로 헛통과하지 않는다", () => {
    const html = gijoMd.render("| 항목 | 값 |\n|---|---|\n| 가 | 1 |");
    expect(html).toContain("<table>");
    expect(칸수(html), "머리글 1행 + 본문 1행").toEqual([2, 2]);
  });
});

// ── ① 규격 4꼴 — 서버가 내는 표를 화면이 그대로 읽는다 ───────────────────────────────
describe("★★ 화면이 tabletext 규격대로 표를 읽는다", () => {
  it("ㄱ 칸 안 이스케이프(`\\|`)가 칸을 늘리지 않는다 — 추출기 칸글()이 실제로 내는 꼴이다", () => {
    // 서버가 내는 그 글자를 그대로 먹인다(지어낸 입력이 아니다).
    const md = 파이프표([["항목", "값"], ["Patch|A", "1"]].map((r) => r.map(칸글)));
    const html = gijoMd.render(md);
    expect(new Set(칸수(html)).size, `행별 칸 수가 갈렸다: ${칸수(html).join(",")}`).toBe(1);
    expect(칸수(html)[0]).toBe(2);
    expect(html, "이스케이프 역슬래시가 화면에 그대로 남았다").not.toContain("Patch\\|A");
    expect(html, "칸 안 파이프가 사라졌다").toContain("Patch|A");
  });

  it("ㄴ 정렬 구분선(`|:---|---:|`)을 구분선으로 알아본다 — LLM 초안에 가장 흔한 꼴이다", () => {
    const html = gijoMd.render("| 항목 | 값 |\n|:---|---:|\n| 가 | 1 |");
    expect(html, "구분선을 못 알아봐 `:---`가 화면에 찍힌다").not.toContain(":---");
    expect(칸수(html), "머리글+본문 두 행이어야 한다").toEqual([2, 2]);
  });

  it("ㄷ GFM 정규 구분선(`|-|-|`)도 표에 안 찍힌다", () => {
    const html = gijoMd.render("| 항목 | 값 |\n|-|-|\n| 가 | 1 |");
    expect(칸수(html), "구분선이 본문 행으로 찍혔다").toEqual([2, 2]);
    expect(html, "`-`만 든 행이 화면에 그대로 나간다").not.toMatch(/<td>-<\/td>/);
  });

  it("ㄹ 「해당 없음」을 적은 본문 행(`| - | - |`)은 안 버린다 — 서버가 살린 것을 화면이 도로 먹지 않는다", () => {
    // ⚠ ㄷ과 짝이다 — 둘을 가르는 잣대가 **칸 안 공백**이라 언제나 함께 본다(tabletext:구분선).
    const html = gijoMd.render("| 항목 | 값 |\n|---|---|\n| - | - |\n| 가 | 1 |");
    expect(칸수(html), "「해당 없음」 행이 사라졌다").toEqual([2, 2, 2]);
    expect(html).toMatch(/<td>-<\/td>/);
  });

  it("ㅁ 한 표의 모든 행이 같은 칸 수로 그려진다 — 꼬리 파이프를 빠뜨린 줄이 표를 찌그러뜨리지 않는다", () => {
    const md = "| 항목 | 값 | 판정 |\n|---|---|---|\n| A | x | 취약 |\n| 이 줄은 파이프로만 시작한 문장\n| B | y | 양호 |";
    const html = gijoMd.render(md);
    expect(new Set(칸수(html)).size, `행별 칸 수가 갈렸다: ${칸수(html).join(",")}`).toBe(1);
    expect(칸수(html)[0]).toBe(3);
    expect(html, "삼킨 문장이 사라지면 안 된다").toContain("파이프로만 시작한 문장");
  });

  it("ㅂ 칸이 넘치는 행은 표를 넓힌다 — 잘라 버리면 데이터 손실이다", () => {
    const html = gijoMd.render("| 항목 | 값 |\n|---|---|\n| A | x | 덤 |");
    expect(new Set(칸수(html)).size, `행별 칸 수가 갈렸다: ${칸수(html).join(",")}`).toBe(1);
    expect(칸수(html)[0], "넘친 칸을 버렸다").toBe(3);
    expect(html).toContain("덤");
  });

  it("ㅅ GFM 정규 구분선 3꼴도 표로 그려진다 — 조임이 표를 죽이지 않는다 (2차 ①)", () => {
    // 셋 다 수리 **전에는** 표였다. 서버 잣대로 조이면서 죽은 것을 되돌린 자리다.
    const 꼴: [string, string][] = [
      ["대시 하나 + 공백", "| 항목 | 값 |\n| - | - |\n| 가 | 1 |"],
      ["정렬 + 대시 하나", "| 항목 | 값 |\n| :- | -: |\n| 가 | 1 |"],
      ["앞뒤 파이프 없음", "항목 | 값\n--- | ---\n가 | 1"],
    ];
    for (const [이름, md] of 꼴) {
      const html = gijoMd.render(md);
      expect(html, `${이름} — 표가 아니라 날 파이프 문단으로 떨어졌다`).toContain("<table>");
      expect(칸수(html), `${이름} — 머리글+본문 두 행이어야 한다`).toEqual([2, 2]);
    }
  });

  it("ㅇ 표 뒤에 빈 줄 없이 붙은 문장이 표를 넓히지 않는다 — 글도 산다 (2차 ②)", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |\n참고: a | b | c | d 입니다";
    const html = gijoMd.render(md);
    expect(칸수(html), "문장의 파이프 수만큼 표 전체에 빈 열이 번졌다").toEqual([2, 2]);
    expect(html, "표 밖으로 낸 문장이 사라지면 안 된다").toContain("참고: a | b | c | d 입니다");
    expect(html, "문장이 표 안으로 들어갔다").not.toMatch(/<td>참고: a<\/td>/);
  });

  it("ㅈ 다른 블록으로 정해진 줄은 표 머리글이 아니다 — 넓힌 구분선이 목록·제목을 안 먹는다", () => {
    // ⚠ ㅅ의 짝이다. 구분선을 넓히면 「구분선처럼 보이는 목록 줄」에 걸릴 여지도 함께 넓어진다.
    const 목록 = gijoMd.render("- 가 | 나\n- | -\n- 다 | 라");
    expect(목록, "목록이 표로 둔갑했다").not.toContain("<table>");
    expect(목록).toContain("<li>가 | 나</li>");

    const 제목 = gijoMd.render("## 표 | 아님\n--- | ---");
    expect(제목, "제목이 표 머리글로 먹혔다").not.toContain("<table>");
    expect(제목).toContain("<h2>표 | 아님</h2>");

    const 인용 = gijoMd.render("> 인용 | 조각\n> - | -");
    expect(인용, "인용이 표로 둔갑했다").not.toContain("<table>");
  });

  it("★ 내보내기(inspectionHtml)와 **같은 답**이다 — 「Word는 되는데 화면만 이상하다」를 안 만든다", () => {
    // ⚠ 2026-09-10 2차 ④: 종전 이 시험은 **내보내기를 한 번도 안 불렀다**(화면 자기 칸 수만
    //   쟀다). 이름이 약속한 검증이 안 이뤄지고 있었으므로 실제로 맞댄다.
    const 꼴 = [
      파이프표([["항목", "값"], ["Patch|A", "1"]].map((r) => r.map(칸글))),
      "| 항목 | 값 |\n|:---|---:|\n| 가 | 1 |",
      "| 항목 | 값 |\n|-|-|\n| 가 | 1 |",
      "| 항목 | 값 |\n|---|---|\n| - | - |\n| 가 | 1 |",
      "| 항목 | 값 |\n|---|---|\n| A | x | 덤 |",
      "| 항목 | 값 | 판정 |\n|---|---|---|\n| A | x | 취약 |\n| 이 줄은 파이프로만 시작한 문장\n| B | y | 양호 |",
    ];
    for (const md of 꼴) {
      const 화면 = 칸수(gijoMd.render(md));
      const 내보내기 = 칸수(inspectionHtml(md));
      expect(new Set(화면).size, `${md.split("\n")[0]} — 화면 표의 행별 칸 수가 갈렸다: ${화면.join(",")}`).toBe(1);
      expect(화면, `${md.split("\n")[0]} — 화면과 Word/PDF가 갈렸다`).toEqual(내보내기);
    }
  });

  it("★ **아직 갈리는 자리** — 표를 무엇으로 보는지가 두 길에서 다르다(알고 넘긴다)", () => {
    // 화면은 「머리글+구분선」 모델, 내보내기는 「파이프로 시작하는 줄은 모두 표」 모델이다.
    // 그래서 아래 두 꼴은 답이 갈린다. 여기 적어 두는 이유는 **모르고 갈리는 것과 알고 갈리는
    // 것이 다르기** 때문이다 — 고치는 자리는 engine/inspectionreport.ts이고 이 갈래(C) 밖이다.
    const A = "| 항목 | 값 |\n| - | - |\n| 가 | 1 |";
    expect(칸수(gijoMd.render(A)), "화면: GFM대로 `| - | - |`이 구분선").toEqual([2, 2]);
    expect(칸수(inspectionHtml(A)), "내보내기: 구분선이 아니라 본문 행이라 세 줄 다 찍힌다").toEqual([2, 2, 2]);

    const B = "| 항목 | 값 |\n| --- | --- |\n| --- | --- |";
    expect(칸수(gijoMd.render(B)), "화면: 대시만 든 **본문** 행도 표에 남긴다").toEqual([2, 2]);
    expect(칸수(inspectionHtml(B)), "내보내기: 자리를 안 보고 버린다(데이터 손실 쪽)").toEqual([2]);

    // ⓘ 이 시험이 빨개졌다면 내보내기가 「머리글+구분선」 모델로 옮겨 간 것이다. 그때는 이 꼴을
    //   위 ★ 대조 corpus로 **옮기고** 여기서 지운다 — 갈린 자리가 줄어든 것이므로 좋은 빨강이다.
  });
});

// ── ② 두 구현 동치 — 사본이 원본과 어긋나면 여기서 빨개진다 ────────────────────────────
describe("★★ gijomd.js의 표 술어는 tabletext.ts와 **같은 답**을 낸다", () => {
  const 사본 = gijoMd?.표규격;

  it("사본을 시험이 꺼내 볼 수 있다 — 못 꺼내면 아래 동치 시험이 통째로 헛돈다", () => {
    expect(사본, "gijomd.js가 표규격을 안 내놨다").toBeTruthy();
    for (const 이름 of ["표줄", "구분선", "GFM구분선", "표구분선", "칸가르기", "표행맞추기"]) {
      expect(typeof 사본[이름], `표규격.${이름}이 없다`).toBe("function");
    }
  });

  const 줄들 = [
    "|---|---|", "| --- | --- |", "|:---|---:|", "| :--: | :--: |",
    "|-|-|", "|:-|-:|", "|-|", "| - | - |", "| - |", "| :- | -: |",
    "| 가 | 1 |", "  | 가 | 1 |", "| a\\|b | 1 |", "| 가 | 1", "가 | 1",
    "--- | ---", "---", "", "그냥 문장", "| 항목 | 값 | 판정 |",
  ];

  it("구분선 — 20꼴 전부 같은 답", () => {
    for (const l of 줄들) {
      expect(사본.구분선(l), `구분선이 갈렸다: ${JSON.stringify(l)}`).toBe(구분선(l));
    }
  });

  it("★ 화면 잣대는 서버의 **초집합**이다 — 서버가 구분선이라 부르는 것은 하나도 안 빠진다", () => {
    // 화면(표구분선)이 더 넓은 것은 의도다(2차 ①). 다만 **넓히는 방향만** 허용한다 —
    // 좁아지는 순간 서버가 낸 표가 화면에서 사라지므로 여기서 빨개져야 한다.
    for (const l of 줄들) {
      if (구분선(l)) expect(사본.표구분선(l), `서버 구분선을 화면이 뱉었다: ${JSON.stringify(l)}`).toBe(true);
    }
    // 넓어진 만큼 새로 받는 것 — GFM 정규 꼴 3종
    for (const l of ["| - | - |", "| :- | -: |", "--- | ---"]) {
      expect(사본.표구분선(l), `GFM 구분선을 화면이 못 알아봤다: ${JSON.stringify(l)}`).toBe(true);
    }
    // ⚠ 넓히다 말고 **가로줄까지** 먹으면 안 된다 — `---`는 hr이지 구분선이 아니다.
    for (const l of ["---", "***", "___", "-", "그냥 문장", ""]) {
      expect(사본.표구분선(l), `구분선이 아닌 것을 구분선이라 했다: ${JSON.stringify(l)}`).toBe(false);
    }
    expect(gijoMd.render("어떤 문장 | 조각\n---\n다음 문단"), "hr이 표로 둔갑했다").not.toContain("<table>");
  });

  it("표줄 — 앞 파이프 판정이 같은 답", () => {
    for (const l of 줄들) {
      expect(사본.표줄(l), `표줄이 갈렸다: ${JSON.stringify(l)}`).toBe(l.trimStart().startsWith("|"));
    }
  });

  it("칸가르기 — 이스케이프 되돌리기까지 같은 답", () => {
    for (const l of 줄들) {
      expect(사본.칸가르기(l), `칸가르기가 갈렸다: ${JSON.stringify(l)}`).toEqual(칸가르기(l));
    }
  });

  it("표행맞추기 — 부족·넘침·빈 표·상한·**빈 값**까지 같은 답", () => {
    const 표들: any[][][] = [
      [["가", "나"], ["1", "2"]],
      [["가", "나"], ["1"]],
      [["가"], ["1", "2", "3"]],
      [],
      [[]],
      [Array.from({ length: 640 }, () => "x")],
      // ⚠ 2차 ③ — 원본은 `?? ""`라 null도 빈 칸이다. 사본이 `=== undefined`였을 때 여기서 갈렸다.
      [["가", null], ["1"]],
      [["가", undefined], [null, null]],
      // 구멍 난 배열(sparse) — 값이 아예 없는 자리도 같은 답이어야 한다.
      [Object.assign([], { 1: "나", length: 2 }), ["1", "2"]],
      [["", "0"], [0 as any, false as any]],
    ];
    for (const 표 of 표들) {
      expect(사본.표행맞추기(표), `표행맞추기가 갈렸다: 행 ${표.length}개`).toEqual(표행맞추기(표));
    }
    expect(사본.표_최대열, "상한이 갈렸다 — 두 번째 상한을 만들지 않는다").toBe(표_최대열);
  });

  it("★ 사본에 **어디의 사본인지** 적혀 있다 — 다음 사람이 원본을 찾을 수 있어야 한다", () => {
    expect(mdSrc, "tabletext.ts를 원본으로 가리키는 주석이 없다").toContain("engine/tabletext.ts");
    expect(mdSrc).toContain("gijomdtable.test");
  });
});

// ── ③ pptx 표시 2종 — 새 추출기가 내는 줄이 화면에서 어떻게 보이나 ─────────────────────
//   dataset.ts가 슬라이드마다 「[슬라이드 N]」을, 노트에 「(노트)」를 붙여 낸다(갈래 P).
//   **특별 서식은 안 준다** — 화면을 바꾸는 일은 시안 영역이다. 여기서 재는 것은
//   「글자가 사라지거나 딴것으로 둔갑하지 않는다」뿐이다.
describe("pptx 표시 2종은 일반 문단으로 그대로 나온다", () => {
  it("「[슬라이드 N]」이 링크·목록·구분선으로 둔갑하지 않는다", () => {
    const html = gijoMd.render("[슬라이드 3]\n제품 개요를 설명한다.");
    expect(html, "표시가 사라졌다").toContain("[슬라이드 3]");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<li>");
    expect(html).toContain("<p>");
  });

  it("「(노트)」 줄도 문단이다", () => {
    const html = gijoMd.render("(노트) 발표 때 3분 안에 마친다.");
    expect(html).toContain("(노트) 발표 때 3분 안에 마친다.");
    expect(html).toContain("<p>");
  });

  it("★ 표를 안은 슬라이드 — 표시는 문단, 표는 표로 갈린다", () => {
    // dataset.ts:노트표시가 「표면 위에 한 줄로 둔다」고 약속한 자리다. 표시가 표 첫 줄에
    // 붙으면 그 줄이 표에서 떨어져 나가므로, 화면에서도 갈려 보여야 약속이 지켜진 것이다.
    const md = "[슬라이드 3]\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |";
    const html = gijoMd.render(md);
    expect(html).toContain("<p>[슬라이드 3]</p>");
    expect(칸수(html)).toEqual([2, 2]);
  });
});
