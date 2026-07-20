import { describe, it, expect } from "vitest";
import { explainHardTerms, GLOSSARY } from "../src/engine/glossary";

describe("glossary — 어려운 용어 쉬운 풀이 후처리", () => {
  it("등장한 용어의 풀이를 끝에 붙인다", () => {
    const out = explainHardTerms("이 자산에 RCE 취약점(CVE-2021-44228)이 있습니다.");
    expect(out).toContain("🔎 쉬운 용어 풀이");
    expect(out).toContain("**RCE**");
    expect(out).toContain("**CVE**");
    // 원문은 앞에 그대로 보존.
    expect(out.startsWith("이 자산에 RCE 취약점")).toBe(true);
  });

  it("어려운 용어가 없으면 원문 그대로 둔다", () => {
    const t = "오늘은 특별한 이슈가 없습니다.";
    expect(explainHardTerms(t)).toBe(t);
  });

  it("ASCII 약어는 단어 경계로 매칭한다(다른 단어 속 오탐 방지)", () => {
    // RAGE 안의 RAG는 매칭되면 안 된다.
    expect(explainHardTerms("그는 RAGE 상태였다.")).not.toContain("🔎");
    // 단독 RAG는 매칭된다.
    expect(explainHardTerms("RAG로 사내 문서를 참고합니다.")).toContain("**RAG**");
  });

  it("한글 용어도 매칭한다", () => {
    expect(explainHardTerms("이건 프롬프트 인젝션 위험이 있습니다.")).toContain("**프롬프트 인젝션**");
  });

  it("최대 개수(GIJO_GLOSSARY_MAX 기본 6)를 넘지 않는다", () => {
    const many = Object.keys(GLOSSARY).slice(0, 12).join(" ");
    const out = explainHardTerms(many);
    const count = (out.match(/^- \*\*/gm) ?? []).length;
    expect(count).toBeLessThanOrEqual(6);
  });

  it("이미 풀이가 붙은 텍스트에는 중복으로 붙이지 않는다", () => {
    const once = explainHardTerms("RCE 취약점입니다.");
    const twice = explainHardTerms(once);
    expect(twice).toBe(once);
  });

  it("GIJO_GLOSSARY_EXPLAIN=0이면 끈다", () => {
    const prev = process.env.GIJO_GLOSSARY_EXPLAIN;
    process.env.GIJO_GLOSSARY_EXPLAIN = "0";
    expect(explainHardTerms("RCE 취약점")).toBe("RCE 취약점");
    process.env.GIJO_GLOSSARY_EXPLAIN = prev;
  });
});
