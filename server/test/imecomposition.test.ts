// 한글 **조합 중 Enter**를 막았는지 전수 대조한다. (계획서 전-4 · 사용성 결함)
//
// ⚠ 무엇이 문제인가 — 쉽게:
//   한글은 「ㅎ → 하 → 한」처럼 **글자 하나를 여러 번에 나눠 만든다**(이것을 '조합'이라 한다).
//   조합이 끝나기 전에 Enter를 누르면, 브라우저는 그 Enter를 **'글자를 확정하라'**는 뜻으로 쓴다.
//   그런데 화면이 그 Enter를 **'보내라'**로 받아 버리면, **반 글자가 그대로 전송된다.**
//   「김도희」를 치다가 Enter를 누르면 담당자가 **「김도ㅎ」**로 배정되는 식이다.
//   영문은 글자마다 조합이 없어 이 일이 안 난다 — **한글 제품에만 나는 결함**이다.
//
// ⚠ 왜 시험으로 묶나 (2026-08-18, 네 번째 재발):
//   이 제품은 이 결함을 **이미 알고 있었다.** `titlebar.js:724`가 조합 사고를 주석으로 적어 뒀고
//   `titlebar.js:731`·`console.js:887`은 가드까지 갖고 있었다. 그런데 **정작 주 대화창 입력칸
//   (console.js·chatwidget.js·lite-chat.html)에는 없었다.** 아는 결함이 안 고쳐진 채 25곳에
//   흩어져 있었다 — 이 저장소가 반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」.
//   그래서 **사람의 기억이 아니라 시험이** 지키게 한다.
//
// ⚠ 통과시키는 법 — 둘 중 하나:
//   ⓐ 같은 줄(또는 바로 다음 두 줄)에 `isComposing`을 쓴다  ← 텍스트를 받는 칸이면 이쪽
//   ⓑ 같은 줄 끝에 `// 조합무관: <이유>`를 적는다             ← 숫자만 받는 칸·토글 등
//   ⓑ에 **이유를 강제하는 까닭**: 이유 없는 예외는 다음 사람이 「빠뜨린 것」인지
//   「일부러 뺀 것」인지 가릴 수 없다. 가릴 수 없으면 아무도 안 고친다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);
const pageFiles = fs.readdirSync(pagesDir).filter((f) => /\.(html|js)$/.test(f));

/** Enter 키를 판정하는 줄만 골라 낸다. `e.key === "Enter"` · `ev.key==='Enter'` 등 표기 차이를 흡수. */
const ENTER_판정 = /\.\s*key\s*===?\s*["']Enter["']/;

// ⚠ `이유`는 **자르기 전 원본 줄**에서 뽑는다(2026-08-18에 밟음).
//   본문을 120자로 잘라 보관했더니 줄 끝의 `// 조합무관: …`이 잘려 나가,
//   이유가 멀쩡히 붙어 있는데도 「이유 없음」으로 빨간불이 났다.
type 자리 = { 파일: string; 줄: number; 본문: string; 이유: string };

function 걷기(): { 전체: 자리[]; 무방비: 자리[]; 면제: 자리[] } {
  const 전체: 자리[] = [];
  const 무방비: 자리[] = [];
  const 면제: 자리[] = [];
  for (const f of pageFiles) {
    const 줄들 = fs.readFileSync(new URL(f, pagesDir), "utf8").split(/\r?\n/);
    줄들.forEach((l, i) => {
      if (!ENTER_판정.test(l)) return;
      const 면제표시 = /조합무관\s*:\s*(.*)$/.exec(l);
      const 자리 = { 파일: f, 줄: i + 1, 본문: l.trim().slice(0, 120), 이유: (면제표시?.[1] ?? "").trim() };
      전체.push(자리);
      if (면제표시) {
        면제.push(자리);
        return;
      }
      // 가드가 다음 줄에 오는 형태도 인정한다 — titlebar.js가 그렇게 썼다:
      //   else if (e.key === "Enter") {
      //     if (e.isComposing) return;
      const 창 = 줄들.slice(i, i + 3).join("\n");
      if (!/isComposing/.test(창)) 무방비.push(자리);
    });
  }
  return { 전체, 무방비, 면제 };
}

describe("한글 조합 중 Enter — 반 글자가 전송되지 않게", () => {
  const { 전체, 무방비, 면제 } = 걷기();

  it("Enter 판정 줄을 실제로 찾아 온다 — 못 찾으면 이 시험이 헛돈다", () => {
    // 헛돎 방지. 정규식이 표기 변화(따옴표·공백)를 놓치면 무방비 0건으로 **거짓 통과**한다.
    expect(
      전체.length,
      "Enter 판정 줄을 하나도 못 찾았다 — ENTER_판정 정규식이 실제 코드와 어긋난 것이다",
    ).toBeGreaterThan(15);
    expect(pageFiles.length).toBeGreaterThan(30);
  });

  it("Enter로 무언가를 실행하는 곳은 조합 가드를 갖거나 이유를 적어야 한다", () => {
    const 목록 = 무방비.map((x) => `  ${x.파일}:${x.줄}  ${x.본문}`).join("\n");
    expect(
      무방비.length,
      `한글 조합 중 Enter를 막지 않은 곳 ${무방비.length}건 — 반 글자가 그대로 전송된다.\n` +
        `가드를 넣거나(같은 줄에 \`&& !e.isComposing\`), 텍스트 칸이 아니면 줄 끝에\n` +
        `\`// 조합무관: <이유>\`를 적을 것.\n${목록}`,
    ).toBe(0);
  });

  it("면제(조합무관)에는 반드시 이유가 붙어 있다", () => {
    // `// 조합무관:` 뒤가 비어 있으면 면제가 아니라 **회피**다.
    expect(면제.length, "면제가 하나도 없다 — 이 검사가 아무것도 안 보고 있다").toBeGreaterThan(0);
    const 빈이유 = 면제.filter((x) => x.이유.length < 4);
    expect(빈이유.map((x) => `${x.파일}:${x.줄}`).join(", ")).toBe("");
  });

  it("주 대화창 입력칸은 반드시 가드를 갖는다", () => {
    // ⚠ 이 자리들이 2026-08-18에 실제로 뚫려 있던 곳이다. 위 전수 검사와 겹치지만,
    //   전수 검사가 「이유를 적으면 통과」라서 **여기만은 이유로도 못 빠져나가게** 못 박는다.
    // ⚠ **lite-chat.html은 2026-08-22에 빠졌다** — 라이트가 프로 대화창을 그대로 쓰게 되면서
    //   그 파일이 화면이 아니라 **이름표**가 됐다(사장님 「대화창을 그대로 이관」).
    //   즉 라이트의 입력칸도 이제 console.js다 — **위 첫 줄이 라이트까지 함께 지킨다.**
    //   가드가 줄어든 것이 아니라 **지킬 파일이 한 곳으로 합쳐진 것**이다.
    const 필수: [string, RegExp][] = [
      ["console.js", /input\.addEventListener\("keydown"[\s\S]{0,120}?isComposing/],
      ["chatwidget.js", /input\.addEventListener\("keydown"[\s\S]{0,120}?isComposing/],
    ];
    for (const [f, re] of 필수) {
      const src = fs.readFileSync(new URL(f, pagesDir), "utf8");
      expect(re.test(src), `${f}의 주 입력칸에 조합 가드가 없다 — 한글 반 글자가 전송된다`).toBe(true);
    }
  });
});
