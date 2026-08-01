// 공용 목록 양식이 **실제로 나오는지** 지키는 시험 (2026-08-02 신설).
//
// 왜 필요한가 — 오늘 두 번, 코드는 멀쩡한데 화면에는 양식이 하나도 안 실렸다.
//   ① `return ""` 다음 줄부터가 죽은 코드였다(자바스크립트 ASI). 빈 문자열만 돌아왔다.
//   ② 탭(임베드)은 injectCss를 안 거쳐, 한쪽에만 넣으면 탭에서 통째로 빠진다.
//   둘 다 **빌드도 문법 검사도 통과한다.** 화면을 열어 재기 전에는 아무도 모른다.
//   그래서 "함수를 실제로 불러서 규칙이 들어 있나"를 시험으로 굳힌다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const NAV = path.resolve(__dirname, "../../client/src/renderer/pages/nav.js");
const 소스 = fs.readFileSync(NAV, "utf-8");

/** nav.js에서 목록양식CSS만 떼어 진짜로 실행해 본다(모양 검사가 아니라 결과 검사다). */
function 양식문자열(): string {
  const a = 소스.indexOf("  function 목록양식CSS() {");
  expect(a, "목록양식CSS 함수가 없다").toBeGreaterThan(0);
  const b = 소스.indexOf("\n  }", a);
  expect(b, "목록양식CSS 함수의 끝을 못 찾았다").toBeGreaterThan(a);
  const 조각 = 소스.slice(a, b + 4).replace("function 목록양식CSS()", "function()");
  return new Function("return " + 조각)()();
}

describe("공용 목록 양식", () => {
  it("빈 문자열이 아니다 — ASI로 죽은 코드가 되면 여기서 걸린다", () => {
    const css = 양식문자열();
    expect(css.length).toBeGreaterThan(1000);
  });

  it("다섯 조각이 다 들어 있다", () => {
    const css = 양식문자열();
    for (const 규칙 of [".gj-list{", ".gj-row{", ".gj-tag{", ".gj-chips{", ".gj-detail{"]) {
      expect(css, `${규칙} 규칙이 빠졌다`).toContain(규칙);
    }
  });

  it("목록 상자는 **제 안에서만** 스크롤한다 — 화면 전체가 구르면 제목·칩이 사라진다", () => {
    const css = 양식문자열();
    const 상자 = css.slice(css.indexOf(".gj-list{"), css.indexOf("}", css.indexOf(".gj-list{")));
    expect(상자).toContain("overflow-y:auto");
  });

  it("한 줄은 **얇다** — 부제를 아랫줄로 내리면 곧바로 두 배가 된다", () => {
    const css = 양식문자열();
    const 줄 = css.slice(css.indexOf(".gj-row{"), css.indexOf("}", css.indexOf(".gj-row{")));
    const m = 줄.match(/padding:(\d+(?:\.\d+)?)px/);
    expect(m, ".gj-row에 padding이 없다").toBeTruthy();
    expect(Number(m![1]), "위아래 여백이 8px을 넘으면 줄이 두꺼워진다").toBeLessThanOrEqual(8);
    // 부제(.s)는 한 줄 안에 있어야 한다 — display:block이면 아랫줄로 내려간다.
    const 부제 = css.slice(css.indexOf(".gj-row>.bd .s{"), css.indexOf("}", css.indexOf(".gj-row>.bd .s{")));
    expect(부제).not.toContain("display:block");
  });

  it("표도 같은 밀도다 — 표 쓰는 화면이 함께 줄어든다", () => {
    const css = 양식문자열();
    const 칸 = css.slice(css.indexOf(".main table td{"), css.indexOf("}", css.indexOf(".main table td{")));
    const m = 칸.match(/padding:(\d+(?:\.\d+)?)px/);
    expect(m, ".main table td에 padding이 없다").toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(6);
  });

  it("**양쪽 경로에서 다 부른다** — 탭에서 빠지면 화면 절반이 옛 모양이 된다", () => {
    // injectCss(별도 창·대시보드)와 applyEmbed(탭 안) 두 곳 모두에서 불러야 한다.
    const 부른곳 = (소스.match(/목록양식CSS\(\)/g) || []).length;
    expect(부른곳, "선언 1 + 호출 2 = 3번은 나와야 한다").toBeGreaterThanOrEqual(3);
    const 임베드 = 소스.slice(소스.indexOf("function applyEmbed()"), 소스.indexOf("function applyEmbed()") + 2500);
    expect(임베드, "탭(임베드) 경로에서 양식을 안 부른다").toContain("목록양식CSS()");
  });

  it("줄 아래 펼치기(gijoRowDetail)가 있고, 한 번에 하나만 편다", () => {
    expect(소스).toContain("window.gijoRowDetail");
    const a = 소스.indexOf("window.gijoRowDetail");
    const 본문 = 소스.slice(a, a + 2200);
    // 다른 것을 접는 처리가 없으면 목록이 아니라 문서가 된다.
    expect(본문).toContain("gj-detail");
    expect(본문).toMatch(/remove\(\)/);
  });

  it("목록 상자도 높이를 재서 받는다 — 고정 px은 창·배율이 바뀌면 어긋난다", () => {
    expect(소스).toContain(".scroll-list, .gj-list, [data-gijo-fit]");
  });
});
