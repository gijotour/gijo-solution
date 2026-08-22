// 법령·판례 화면 — **고르는 자리**라는 계약을 지킨다.
//
// 제품 원칙(용어사전 839줄): "지시는 대화창에서 합니다." 화면에 자유 입력칸을 두면 그 화면이
// 스스로 dispatch를 부르게 되고, 그러면 쓰기 지시에 결재판을 못 그려 막다른 길이 된다.
// 「추가 기능」 그룹 3화면이 지금까지 이 원칙을 지켜 왔다(자유 입력 0) — 새 화면이 첫 예외가
// 되지 않도록 여기서 잠근다(2026-08-09 신설).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { getScreenGuide, PRODUCT_RULES } from "../src/engine/screenguide";

const pagesDir = new URL("../../client/src/renderer/pages/", import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, pagesDir), "utf8");

// 자유 입력 = 사람이 글자를 치는 칸. 체크박스·라디오·버튼은 '고르기'라 원칙에 어긋나지 않는다.
const 자유입력 = (src: string): string[] => {
  const hits = src.match(/<textarea|<input(?![^>]*type\s*=\s*"(?:checkbox|radio|button|submit|file|range|color)")[^>]*>/gi);
  return hits ?? [];
};

describe("법령·판례 화면 — 고르는 자리, 치는 곳은 대화창", () => {
  it("자유 입력칸이 하나도 없다", () => {
    const 발견 = 자유입력(read("lawlookup.html"));
    expect(발견, "화면에 입력칸이 생겼다 — 질문은 대화창으로 넘겨야 한다: " + 발견.join(" | ")).toHaveLength(0);
  });

  it("고른 것은 askConsole로 대화창에 넘긴다(화면이 직접 dispatch하지 않는다)", () => {
    const src = read("lawlookup.html");
    expect(src).toContain("askConsole");
    expect(src, "화면이 스스로 dispatch를 부르면 결재판을 못 그린다").not.toMatch(/\/api\/dispatch/);
  });

  it("메뉴(추가 기능)에 실려 있다 — 만들고 안 걸면 아무도 못 찾는다", () => {
    expect(read("nav.js")).toContain('page: "lawlookup.html"');
  });

  it("ⓘ가 열 안내가 서버에 있다 — 화면엔 정체성 한 줄과 경고만 둔다", () => {
    const g = getScreenGuide("lawlookup.html");
    expect(g.title).toBe("법령·판례");
    expect(g.what).toContain("법령");
    expect((g.can ?? []).join(" ")).toContain("대화창");
    // 인터넷 필요·법률자문 아님은 반드시 알린다(폐쇄망 고객·법적 오해 방지).
    const 주의 = (g.panels ?? {})["주의"] ?? "";
    expect(주의).toContain("인터넷");
    expect(주의).toContain("법률 자문이 아닙니다");
  });

  it("공통 안내에 법령 조회가 실려 있다 — 조건(연동·인터넷)도 함께 밝힌다", () => {
    const 줄 = PRODUCT_RULES.find((r) => r.includes("법령"));
    expect(줄, "만들어 두고 안내에 없으면 있는 줄도 모른다").toBeTruthy();
    expect(줄).toContain("인터넷");
  });
});

// 화면이 꽂는 말은 **결정적으로** 법령 도구로 가야 한다. 모델 판단으로 새면 회차마다 답이 흔들린다.
describe("화면이 꽂는 말이 법령 도구로 곧장 간다", () => {
  // ⚠ 정규식을 여기 베껴 두면 제품이 바뀌어도 시험만 통과한다(헛통과). **소스에서 읽는다** —
  //   guidance-check·route-explain과 같은 방식.
  const 규칙 = (() => {
    const src = fs.readFileSync(new URL("../src/engine/agentloop.ts", import.meta.url), "utf8");
    const 블록 = src.slice(src.indexOf("const FORCED_INTENTS"));
    const m = /re:\s*(\/(?:[^/\\\n]|\\.)+\/[gimsuy]*)\s*,\s*\n\s*tool:\s*"law_lookup"/.exec(블록);
    if (!m) throw new Error("law_lookup 강제 규칙을 못 찾았다 — 규칙이 사라졌거나 형식이 바뀌었다");
    return eval(m[1]) as RegExp;
  })();

  for (const q of [
    "개인정보 보호법 찾아줘",
    "정보통신망 이용촉진 및 정보보호 등에 관한 법률 찾아줘",
    "지능정보화 기본법 찾아줘",
    "전자금융거래법 찾아줘",
    "개인정보의 안전성 확보조치 기준 고시 찾아줘",
    "개인정보 유출 관련 판례 찾아줘",
  ]) {
    it(`잡는다 — ${q}`, () => expect(규칙.test(q)).toBe(true));
  }

  // 남의 영토를 삼키면 멀쩡하던 답이 망가진다 — 여기가 더 중요하다.
  for (const q of [
    "이 방법 알려줘",              // '방법'의 법
    "이 화면 사용법 알려줘",        // '사용법'의 법
    "클라우드에 백업 올려도 되나?",  // 사내 규정 대조(actioncheck)
    "방화벽에 any 허용 룰 넣어도 돼?",
    "SSH 취약점 정리해줘",
    "미조치 취약점 알려줘",
  ]) {
    it(`안 삼킨다 — ${q}`, () => expect(규칙.test(q)).toBe(false));
  }

  it("규칙표(routes.ts)에도 실려 있다 — 표가 거짓이면 설명이 거짓이 된다", () => {
    const src = fs.readFileSync(new URL("../src/engine/routes.ts", import.meta.url), "utf8");
    expect(src).toContain('도착: "law_lookup"');
  });
});

describe("「추가 기능」 그룹 — 전부 고르는 자리다", () => {
  for (const 화면 of ["loganalysis.html", "handover.html", "lawlookup.html"]) {
    it(`${화면} — 자유 입력칸 0개`, () => {
      expect(자유입력(read(화면))).toHaveLength(0);
    });
  }
});
