// introfieldsui.test.ts — 📦 보안제품 자료 화면이 비교 항목을 **정직하게** 보이는지(2026-08-29).
//
// ★ 지키는 것 넷
//   ① 서버가 준 schema를 쓴다 — 화면이 항목 이름을 베껴 적으면 서버가 항목을 늘렸을 때
//     조용히 어긋난다(「같은 것을 두 곳에 적으면 어긋난다」).
//   ② 빈 항목은 「―」 — 소개자료 원문에서 지어 채우지 않는다(서버 product_compare와 같은 규칙).
//   ③ 화면에 값 입력칸을 두지 않는다 — 「지시는 대화창」 원칙. 채우는 법을 글로 안내한다.
//   ④ 안내가 **실재하는 도구**를 가리킨다 — 이 화면의 「A와 B 비교해줘」는 한때 받는 도구가
//     없는 거짓 약속이었다(2026-08-23 적발). 그 재발을 여기서도 막는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const MYDOCS = readFileSync(
  join(__dirname, "..", "..", "client", "src", "renderer", "pages", "mydocs.html"), "utf-8");
const REGISTRY = readFileSync(
  join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf-8");
const INTRO = readFileSync(join(__dirname, "..", "src", "engine", "productintro.ts"), "utf-8");

describe("📦 보안제품 자료 — 비교 항목 표시", () => {
  it("★① 항목 이름은 서버 schema에서 온다 — 화면이 따로 적지 않는다", () => {
    expect(MYDOCS, "schema를 안 받는다").toMatch(/introSchema\s*=\s*_pi\.schema/);
    expect(MYDOCS, "표가 schema를 순회하지 않는다 — 화면이 항목을 베껴 적고 있다")
      .toMatch(/introSchema\.map\(/);
    // 서버가 실제로 schema를 준다(짝 확인 — 한쪽만 있으면 화면이 늘 빈다)
    expect(INTRO, "서버가 schema를 안 준다 — 화면이 항목을 못 그린다").toMatch(/schema: INTRO_FIELD_SCHEMA/);
    expect(INTRO, "서버가 fields를 안 준다").toMatch(/fields: listIntroFields\(it\.id\)/);
  });

  it("★② 빈 항목은 「―」 — 지어 채우지 않는다", () => {
    const 표 = MYDOCS.slice(MYDOCS.indexOf("function 비교항목표"), MYDOCS.indexOf("function 연락처그리기"));
    expect(표, "비교항목표를 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
    expect(표, "빈 값을 「―」로 안 보인다").toContain('"―"');
    expect(표, "스키마가 없을 때 뭔가를 지어낸다").toMatch(/if \(!introSchema\.length\) return ""/);
  });

  it("★③ 화면에 값 입력칸이 없다 — 지시는 대화창", () => {
    const 표 = MYDOCS.slice(MYDOCS.indexOf("function 비교항목표"), MYDOCS.indexOf("function 연락처그리기"));
    expect(표, "비교 항목 표에 입력칸이 생겼다 — 「메뉴는 보기용」 원칙 위반")
      .not.toMatch(/<input|<textarea|contenteditable/);
    // 대신 채우는 법을 글로 안내한다(막다른 화면 금지)
    expect(MYDOCS, "빈 칸을 채우는 법 안내가 없다 — 보기만 하고 못 채운다").toContain("기록해줘");
  });

  it("★④ 화면이 가리키는 도구가 실재한다 — 거짓 약속 재발 방지", () => {
    expect(MYDOCS, "비교 안내 문구가 사라졌다").toContain("비교해줘");
    expect(REGISTRY, "안내는 「비교해줘」라 하는데 product_compare 도구가 없다 — 거짓 약속")
      .toContain('name: "product_compare"');
    expect(REGISTRY, "안내는 「기록해줘」라 하는데 set_intro_field 도구가 없다 — 거짓 약속")
      .toContain('name: "set_intro_field"');
  });

  it("목록에 채움 정도(몇/전체)를 보인다 — 무엇을 더 채워야 하는지 한눈에", () => {
    expect(MYDOCS, "목록에 항목 채움 수가 없다").toMatch(/채움 \+ "\/" \+ 전체/);
  });
});
