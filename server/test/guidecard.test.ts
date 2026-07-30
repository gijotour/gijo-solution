// 대시보드 시작 가이드 카드 — **약속과 코드가 어긋나지 않는지**를 소스에서 확인한다.
//
// 이 카드의 가치는 "적힌 지시가 실제로 통한다"에 있다. 그래서 지키는 것 세 가지를 고정한다:
//   ① 카드가 가르치는 지시문은 **시연 패키지 문서의 실측된 문장**과 같아야 한다.
//      문서만 고치고 카드를 안 고치면(또는 반대면) 담당자가 안 통하는 말을 배운다.
//   ② [열기]가 가리키는 화면은 **실제로 존재**해야 한다. 없는 화면을 열면 빈 탭이 뜬다.
//   ③ 셸에 부탁하는 메시지 타입이 셸 쪽 핸들러와 맞아야 한다 — 한쪽만 바뀌면 버튼이
//      아무 일도 안 하는데 **아무 오류도 안 난다**(가장 늦게 발견되는 종류의 고장).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const pagesDir = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages");
const repoRoot = path.join(__dirname, "..", "..");
const dashboard = fs.readFileSync(path.join(pagesDir, "dashboard.html"), "utf8");

/** 카드가 쓰는 SCENARIOS 배열에서 지시문(q)과 화면(page)을 뽑는다. */
function guideBlock(): string {
  const start = dashboard.indexOf("var SCENARIOS = [");
  expect(start, "대시보드에서 SCENARIOS를 찾지 못했다(시험이 낡았다)").toBeGreaterThan(0);
  return dashboard.slice(start, dashboard.indexOf("\n  ];", start));
}
const block = guideBlock();
const asks = [...block.matchAll(/q:\s*"([^"]+)"/g)].map((m) => m[1]);
const pages = [...block.matchAll(/page:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("시작 가이드 카드", () => {
  it("4개 상황 · 13단계로 이뤄진다", () => {
    expect([...block.matchAll(/id:\s*"s\d"/g)].length).toBe(4);
    expect(asks.length + pages.length).toBe(13);
  });

  it("가르치는 지시문이 시연 패키지 문서의 실측 문장과 같다", () => {
    // 문서가 단일 출처다 — 카드는 그것을 옮긴 것이어야 한다.
    const demo = fs.readFileSync(path.join(repoRoot, "GIJO_AS_시연_패키지.md"), "utf8");
    const 없는것 = asks.filter((q) => !demo.includes(q));
    expect(
      없는것,
      "카드가 문서에 없는 지시문을 가르치고 있다 — 실측되지 않은 말을 담당자에게 외우게 하면 안 된다"
    ).toEqual([]);
  });

  it("[열기]가 가리키는 화면이 실제로 있다", () => {
    const 없는화면 = pages.filter((p) => !fs.existsSync(path.join(pagesDir, p)));
    expect(없는화면, "없는 화면을 열면 빈 탭이 뜬다").toEqual([]);
  });

  it("셸에 부탁하는 메시지 타입이 셸 핸들러와 맞는다", () => {
    // 한쪽만 바뀌면 버튼이 아무 일도 안 하는데 오류도 안 난다 — 가장 늦게 발견되는 고장이다.
    const app = fs.readFileSync(path.join(pagesDir, "app.html"), "utf8");
    for (const type of ["gijo:ask", "gijo:openTab"]) {
      expect(dashboard, `대시보드가 ${type}을 보내지 않는다`).toContain(`"${type}"`);
      expect(app, `셸이 ${type}을 처리하지 않는다`).toContain(`d.type === "${type}"`);
    }
    // gijo:ask는 문구를 감싸지 않고 그대로 보내야 한다 — 카드가 가르치는 말이 곧 쓰는 말이다.
    const handler = app.slice(app.indexOf('d.type === "gijo:ask"'));
    expect(handler.slice(0, 200)).toMatch(/gijoConsole\.ask\(String\(d\.text\)\)/);
  });

  it("온보딩 오버레이는 완전히 사라졌다 — 같은 일을 하는 자리가 둘이면 안 된다", () => {
    expect(fs.existsSync(path.join(pagesDir, "onboarding.js"))).toBe(false);
    expect(dashboard).not.toContain("gijoObSlot");
    expect(dashboard).not.toContain('src="onboarding.js"');
    const nav = fs.readFileSync(path.join(pagesDir, "nav.js"), "utf8");
    expect(nav).not.toMatch(/loadOnboarding\(\)\s*;/); // 호출도 정의도 없어야 한다
  });

  it("다 하면 접히고, 접힌 채로도 진행률이 보인다", () => {
    // 접기만 하고 배지를 안 두면 "내가 했던가?"가 된다(3.5.0 직관성 개편의 확립된 함정).
    expect(block.length).toBeGreaterThan(0);
    expect(dashboard).toContain("4가지 모두 해봤습니다");
    expect(dashboard).toMatch(/g-cnt[^]{0,80}doneN/); // 접힘 여부와 무관하게 헤더에 진행률
  });
});
