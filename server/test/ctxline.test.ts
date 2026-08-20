// 맥락 문장 한 줄(.cs-line) — 시안 pro-context-strip(2026-08-20 사장님 승인 「추천안으로 진행」).
// 칩 3종(.cs-ctx/.cs-sel/.cs-scope)+상세 박스(.cs-state)를 문장 하나로 흡수했다.
//
// ■ 왜 소스 감시인가(시안공 권고): 이 저장소의 반복 함정이 「반쪽 수정」이다 — 클래스는
//   없앴는데 참조가 남으면 그 버튼·검사가 조용히 죽는다(없는 함수 버튼 계열). 폐지한
//   식별자가 **기능 코드로** 되살아나면 여기서 소리가 난다(주석은 대상 아님).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pages = join(__dirname, "../../client/src/renderer/pages");
const consoleJs = readFileSync(join(pages, "console.js"), "utf8");

describe("맥락 문장 한 줄 — 폐지 칩의 잔재가 기능 코드로 남지 않는다", () => {
  it("문장 줄과 ⋯ 메뉴가 있다", () => {
    expect(consoleJs).toContain("renderCtxLine");
    expect(consoleJs).toContain('class="cs-line"');
    expect(consoleJs).toContain("csCtxMore");
  });

  it("폐지 식별자(csSel·csScope·csSelState·renderSelState)가 console.js와 QA 도구에 없다", () => {
    // getElementById·마크업·CSS 선언 — 주석 속 언급은 걸리지 않는 구체 문자열만 본다.
    // ⚠ 검사 대상은 console.js + QA 하네스 2개(검토관 중1·중2 — tools에 잔재가 실재했고,
    //   「기능 코드 전체」라 말하려면 실제로 그만큼 봐야 한다).
    const 대상들: Array<[string, string]> = [
      ["console.js", consoleJs],
      ["tools/qa-shell.mjs", readFileSync(join(__dirname, "../../tools/qa-shell.mjs"), "utf8")],
      ["tools/ui-check.mjs", readFileSync(join(__dirname, "../../tools/ui-check.mjs"), "utf8")],
    ];
    for (const [이름, src] of 대상들) for (const 잔재 of [
      'getElementById("csSel")', 'getElementById("csScope")', 'getElementById("csSelState")',
      "getElementById('csSel')", "getElementById('csScope')",
      'class="cs-sel"', 'class="cs-scope"', 'class="cs-state"',
      '".cs-sel{', '".cs-scope{', '".cs-state{',
      "#csSel ", "'#csSel", "function renderSelState",
    ]) expect(src, `${이름} 잔재: ${잔재}`).not.toContain(잔재);
  });

  it("게시 관문은 문장 줄을 검사한다(.cs-sel 검사로 되돌아가지 않는다)", () => {
    const gate = readFileSync(join(__dirname, "../../tools/publish-gate-ui.mjs"), "utf8");
    expect(gate).toContain('".cs-line"');
    expect(gate).not.toContain('querySelector(".cs-sel")');
  });

  it("개별 풀기 세 동작(선택·범위·화면 무관)이 ⋯ 메뉴에 살아 있다 — 계약: 보이게+뗄 수 있게", () => {
    expect(consoleJs).toContain("선택 풀기");
    expect(consoleJs).toContain("범위 풀기");
    expect(consoleJs).toContain("화면 무관하게 묻기");
  });
});
