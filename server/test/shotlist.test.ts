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
// 파일 존재 검사는 파일명으로, 중복 검사는 **탭까지 포함한 주소**로 본다 —
// settings.html과 settings.html?s=ai는 담당자에게 다른 화면이다(2026-08-06 소개덱 갱신).
const 찍는주소 = [...도구.matchAll(/page:\s*"([a-z0-9-]+\.html(?:\?[^"]*)?)"/g)].map((m) => m[1]);
const 찍는화면 = 찍는주소.map((p) => p.split("?")[0]);

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
    const 중복 = 찍는주소.filter((p) => (본것.has(p) ? true : (본것.add(p), false)));
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

  it("★★ 소개덱 생성기도 은퇴한 화면 사진을 쓰지 않는다", () => {
    // 실사고(2026-08-06 소스 정리): 문서만 검사하고 **도구는 안 봤다** — gen-intro-deck.mjs가
    // 04·07·16·19 옛 사진을 계속 슬라이드에 넣고 있었다(그래서 그 사진들을 못 지웠다).
    // 고객이 받는 PDF를 만드는 코드도 같은 잣대로 본다.
    const deck = readFileSync(join(ROOT, "tools", "gen-intro-deck.mjs"), "utf8");
    const 은퇴사진 = ["04-운영가이드-점검거버넌스", "07-추천LLM가이드", "16-지식모델-온톨로지", "19-사용량-요금"];
    const 걸린것 = 은퇴사진.filter((s) => deck.includes(s));
    expect(걸린것, `소개덱이 없어진 화면의 옛 사진을 쓴다: ${걸린것.join(", ")}`).toEqual([]);
    // 감시가 헛돌지 않는가 — 덱이 실제로 사진을 지정하고 있어야 한다
    expect((deck.match(/shot:\s*"/g) ?? []).length).toBeGreaterThan(10);
  });

  it("★★ 고객에게 주는 자료가 **없는 화면**을 가리키지 않는다", () => {
    // 실사고(2026-08-04): 사용자 매뉴얼과 제품소개가 은퇴한 화면 4개의 옛 사진을 가리키고
    // 있었다 — 고객이 "이 메뉴 어디 있어요?"라고 물으면 답이 없다.
    // 파일은 남아 있어 링크는 안 깨진다. **그래서 아무도 모른다.**
    // 26-MCP연동: 2026-08-06 소스 정리에서 추가 — 사용자 매뉴얼이 검사 밖이라 빠져나가
    //   있었다(MCP 연동이 독립 화면인 양 옛 사진을 인용). 검사 문서에 매뉴얼도 넣는다.
    const 은퇴 = ["04-운영가이드", "07-추천LLM가이드", "16-지식모델-온톨로지", "19-사용량-요금", "26-MCP연동"];
    const 고객자료 = ["GIJO_AS_제품소개서.md", "GIJO_AS_시연_패키지.md", "GIJO_AS_사용자_매뉴얼.md"];
    const 걸린것: string[] = [];
    for (const f of 고객자료) {
      const p = join(ROOT, f);
      let t = "";
      try { t = readFileSync(p, "utf8"); } catch { continue; }
      for (const s of 은퇴) if (t.includes(s)) 걸린것.push(`${f} → ${s}`);
    }
    expect(걸린것, `없어진 화면의 옛 사진을 가리킨다:\n  ${걸린것.join("\n  ")}`).toEqual([]);
  });

  it("★ 고객 자료의 그림 링크가 실제 파일을 가리킨다", () => {
    const 끊긴것: string[] = [];
    for (const f of ["GIJO_AS_제품소개서.md", "GIJO_AS_시연_패키지.md"]) {
      let t = "";
      try { t = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
      for (const m of t.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        try { readFileSync(join(ROOT, m[1])); } catch { 끊긴것.push(`${f} → ${m[1]}`); }
      }
    }
    expect(끊긴것, `그림 파일이 없다:\n  ${끊긴것.join("\n  ")}`).toEqual([]);
  });

  it("⚠ 감시가 헛돌지 않는가 — 메뉴 화면을 실제로 세고 있다", () => {
    // 메뉴 목록이 0개로 읽히면 위 시험은 **항상 통과한다**(빈 배열끼리 비교).
    // 그건 지키는 게 아니라 안 보는 것이다.
    expect(메뉴화면.length, "nav.js에서 메뉴 화면을 못 읽었다").toBeGreaterThan(15);
    expect(찍는화면.length, "도구에서 찍는 화면을 못 읽었다").toBeGreaterThan(15);
  });
});
