// 스크린샷 도구의 화면 목록 ↔ 실제 화면 대조 — [2026-08-04 · 계획서 전-1]
//
// 왜 필요한가(파트너 지적에서 드러남):
//   파트너 회사는 EDR이 설치를 막아 제품을 **못 띄웠다.** 그래서 제안·기능 자료만 보고
//   "그림이 없다"고 했다. 자료에 실제 화면을 넣기로 했는데, 찍는 도구의 화면 목록이
//   **낡아 있었다** — 없어진 logs.html·mcp.html을 찍으려 하고, 업무 절차 재편(2026-08-02)
//   뒤 생긴 sessions·report 화면은 빠져 있었다.
//   낡은 자료는 없는 자료보다 나쁘다 — 고객이 "이 화면 어디 있어요?"라고 물으면 답이 없다.
//
// ⚠ 이 시험은 **손으로 관리하는 표**를 지킨다. 표는 실행되지 않아 낡아도 아무도 모른다.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const PAGES = join(ROOT, "client", "src", "renderer", "pages");

const 실제화면 = new Set(readdirSync(PAGES).filter((f) => f.endsWith(".html")));
const 도구 = readFileSync(join(ROOT, "tools", "gen-screenshots.mjs"), "utf8");
const 찍는화면 = [...도구.matchAll(/page:\s*"([a-z0-9-]+\.html)"/g)].map((m) => m[1]);

// nav.js가 거는 것 중 **파일이 실재하는 것**만 메뉴 화면이다.
// (없는 것들은 옛 주소를 새 화면으로 보내는 별칭표다 — 죽은 링크가 아니다.)
const nav = readFileSync(join(PAGES, "nav.js"), "utf8");
const nav참조 = [...new Set([...nav.matchAll(/["']([a-z0-9-]+\.html)["']/g)].map((m) => m[1]))];
const 메뉴화면 = nav참조.filter((p) => 실제화면.has(p));

describe("★ 스크린샷 도구가 없는 화면을 찍으려 하지 않는다", () => {
  it("찍겠다고 적힌 화면이 전부 실재한다", () => {
    const 없는것 = 찍는화면.filter((p) => !실제화면.has(p));
    expect(없는것, `없어진 화면을 찍으려 한다(목록이 낡았다): ${없는것.join(", ")}`).toEqual([]);
  });

  it("같은 화면을 두 번 찍지 않는다", () => {
    const 본것 = new Set<string>();
    const 중복 = 찍는화면.filter((p) => (본것.has(p) ? true : (본것.add(p), false)));
    expect(중복, `두 번 적힌 화면: ${중복.join(", ")}`).toEqual([]);
  });
});

describe("★★ 자료에 들어갈 화면이 빠지지 않는다", () => {
  it("메뉴에 있는 화면은 전부 찍는다 — 빠지면 자료가 지금 제품과 달라진다", () => {
    const 빠진것 = 메뉴화면.filter((p) => !찍는화면.includes(p));
    expect(
      빠진것,
      `메뉴에 있는데 안 찍는 화면(자료에 그 화면이 없게 된다): ${빠진것.join(", ")}`,
    ).toEqual([]);
  });

  it("⚠ 감시가 헛돌지 않는가 — 메뉴 화면을 실제로 세고 있다", () => {
    // 메뉴 목록이 0개로 읽히면 위 시험은 **항상 통과한다**(빈 배열끼리 비교).
    // 그건 지키는 게 아니라 안 보는 것이다.
    expect(메뉴화면.length, "nav.js에서 메뉴 화면을 못 읽었다").toBeGreaterThan(15);
    expect(찍는화면.length, "도구에서 찍는 화면을 못 읽었다").toBeGreaterThan(15);
  });
});
