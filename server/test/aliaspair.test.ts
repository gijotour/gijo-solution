// 별칭 표 두 개의 짝 · 대화앞으로()의 생산자 — 2026-08-31 검토관 [중간]·[낮음]
//
// 왜: screenguide.ts에는 별칭 표가 **둘**이다 — 실제로 도는 `화면별칭`과, 여는 주소만 담는
// 곁표 `별명열기탭`. 곁표에만 적으면 아무도 안 읽어 **죽은 줄**이 된다. 📂(지켜보는폴더·
// 폴더감시)와 📨(조치요청서)가 실제로 그렇게 등록돼, 커밋은 「별칭 반영」이라 적었는데
// 사람이 그 이름으로 물으면 안 걸렸다. 사람이 셀 수 없으니 기계가 센다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "src", "engine", "screenguide.ts"), "utf8");

/** `const 이름: Record<string, string> = { … }` 한 덩어리에서 열쇠만 뽑는다. */
function 열쇠들(표이름: string): string[] {
  const i = SRC.indexOf("const " + 표이름);
  expect(i, 표이름 + " 표가 없다").toBeGreaterThan(-1);
  const s = SRC.indexOf("{", i), e = SRC.indexOf("};", s);
  return [...SRC.slice(s, e).matchAll(/^\s*([가-힣A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
}

describe("별칭은 도는 표에 있어야 산다", () => {
  it("별명열기탭의 모든 열쇠가 화면별칭에도 있다", () => {
    const 도는표 = new Set(열쇠들("화면별칭"));
    const 곁표 = 열쇠들("별명열기탭");
    expect(곁표.length, "곁표가 비었다 — 뽑기가 깨졌는지 먼저 볼 것").toBeGreaterThan(3);
    const 죽은줄 = 곁표.filter((k) => !도는표.has(k));
    expect(죽은줄, "곁표에만 있는 별칭은 아무도 안 읽는다: " + 죽은줄.join(", ")).toEqual([]);
  });
});

describe("대화앞으로()가 기대는 두 심볼이 셸에 다 있다", () => {
  // 소비자(console.js)만 지키면 생산자(app.html)가 이름을 바꿔도 조용히 죽는다.
  // toChat 하나만 지키던 옛 계약의 빈자리다(검토관 [낮음]).
  it("app.html이 toChat과 summonConsole을 둘 다 내놓는다", () => {
    const 셸 = readFileSync(
      join(__dirname, "..", "..", "client", "src", "renderer", "pages", "app.html"), "utf8");
    expect(셸, "gijoTabs.toChat 노출이 없다").toContain("toChat:");
    expect(셸, "gijoTabs.summonConsole 노출이 없다 — 화면을 덮지 않는 갈래가 죽는다")
      .toContain("summonConsole:");
  });
});