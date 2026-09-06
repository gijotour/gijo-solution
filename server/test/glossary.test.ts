import { describe, it, expect } from "vitest";
import { explainHardTerms, glossaryGroundingFor, GLOSSARY, DOMAIN_SENSE } from "../src/engine/glossary";

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

  // 실측(2026-07-20): 7B가 "KEV는 Common Vulnerabilities and Exposures의 약자"라고 3/3 오답.
  // 같은 사전을 답변 뒤가 아니라 추론 앞에도 깔아 지어내지 말고 베끼게 한다.
  describe("확정 용어 정의 주입(그라운딩)", () => {
    it("질문에 나온 용어의 정의를 돌려준다", () => {
      const g = glossaryGroundingFor("CVSS와 KEV가 무엇인지 설명해줘") ?? "";
      expect(g).toContain("확정 용어 정의");
      expect(g).toContain("실제 공격에 악용된 것으로 확인된 취약점 목록");
      expect(g).toContain("CVSS:");
      // 약자의 영어 원형까지 실어야 모델이 지어내지 않는다
      // (실측: 원형이 없으니 "Knowledge Exchange Vulnerabilities"라고 창작했다).
      expect(g).toContain("Known Exploited Vulnerabilities");
    });

    it("질문에 용어가 없으면 아무것도 넣지 않는다 — 프롬프트를 불필요하게 늘리지 않는다", () => {
      expect(glossaryGroundingFor("오늘 날씨 어때?")).toBeNull();
      expect(glossaryGroundingFor("")).toBeNull();
    });

    it("답변이 아니라 질문 기준이다", () => {
      // 답변에 나올 용어까지 미리 넣으면 프롬프트가 커지고 복창이 늘어난다.
      expect(glossaryGroundingFor("우리 회사 보안 정책 알려줘")).toBeNull();
    });

    it("개수 상한을 지킨다", () => {
      const g = glossaryGroundingFor("CVE CVSS KEV EPSS RCE SBOM SIEM EDR 설명해줘") ?? "";
      expect((g.match(/^- /gm) ?? []).length).toBeLessThanOrEqual(4);
    });
  });

  it("GIJO_GLOSSARY_EXPLAIN=0이면 끈다", () => {
    const prev = process.env.GIJO_GLOSSARY_EXPLAIN;
    process.env.GIJO_GLOSSARY_EXPLAIN = "0";
    expect(explainHardTerms("RCE 취약점")).toBe("RCE 취약점");
    process.env.GIJO_GLOSSARY_EXPLAIN = prev;
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// ★ 도메인 뜻 — **같은 낱말, 다른 뜻** (2026-09-06)
//
// 무엇을 지키나: 「클릭률 낮추는 법」에 웹 마케팅 조언이 나갔다(운영 실측). 이 제품에서
// 클릭률·열람률·전환율·신고율·참여율·이수율·응답률은 피싱 모의훈련·보안 교육의 지표다.
// 이 시험은 **그 뜻이 추론 앞에 깔리는가**만 본다 — 모델이 그 뜻대로 답하는지는
// tools/ops-sim.mjs ⑯ 마당(라이브)이 잰다. 여기서 모델을 흉내 내면 둘 다 눈이 먼다.
describe("도메인 뜻 주입(DOMAIN_SENSE)", () => {
  it("★ 「클릭률 낮추는 법」에 피싱·모의훈련이 실린다 — 마케팅 CTR로 읽지 않게", () => {
    const g = glossaryGroundingFor("클릭률 낮추는 법") ?? "";
    expect(g).toContain("이 제품에서의 뜻");
    expect(g).toContain("피싱 모의훈련");
    expect(g).toContain("클릭률:");
  });

  it("표의 낱말 **모두** 뜻이 깔린다 — 하나라도 비면 그 낱말만 마케팅으로 샌다", () => {
    for (const 낱말 of Object.keys(DOMAIN_SENSE)) {
      const g = glossaryGroundingFor(`${낱말} 알려줘`) ?? "";
      expect(g, `${낱말}의 뜻이 안 깔렸다`).toContain(`${낱말}:`);
    }
    // 표가 비면 위 반복이 0번 돌아 **헛통과**한다 — 모집단을 못 박는다.
    // ⚠ 시험 이름에 개수를 적지 않는다(2026-09-07) — 「여섯 낱말」이라 적어 두었더니 일곱째를
    //   더할 때 이름만 낡았다. 개수는 아래 바닥값 한 곳에서만 말한다.
    expect(Object.keys(DOMAIN_SENSE).length).toBeGreaterThanOrEqual(7);
  });

  it("★ 해당 낱말이 없으면 종전대로 null — 프롬프트를 괜히 늘리지 않는다", () => {
    // 이 문장은 GLOSSARY에도 DOMAIN_SENSE에도 안 걸린다(표를 더해도 그대로여야 한다).
    expect(glossaryGroundingFor("우리 회사 보안 정책 알려줘")).toBeNull();
    expect(glossaryGroundingFor("오늘 날씨 어때?")).toBeNull();
  });

  it("★★ 보안 약어 4칸이 도메인 뜻에 **안 밀린다** — 있던 방어가 새 방어에 눌리면 안 된다", () => {
    // 약자 오개념 교정(KEV를 CVE로 3/3 오인)이 이 표의 원래 존재 이유다.
    const g = glossaryGroundingFor("CVE CVSS KEV EPSS RCE SBOM 클릭률 참여율 설명해줘") ?? "";
    const 줄 = g.split("\n").filter((l) => l.startsWith("- "));
    const 약어줄 = 줄.filter((l) => /^- (CVE|CVSS|KEV|EPSS|RCE|SBOM):/.test(l));
    expect(약어줄.length, "보안 약어가 4칸을 다 못 썼다 — 도메인 뜻이 자리를 뺏었다").toBe(4);
    // 도메인 뜻은 **뒤에** 최대 2줄.
    expect(줄.length).toBe(6);
    expect(g.indexOf("확정 용어 정의")).toBeLessThan(g.indexOf("이 제품에서의 뜻"));
    expect(줄.slice(0, 4)).toEqual(약어줄);
  });

  it("도메인 뜻도 GIJO_GLOSSARY_EXPLAIN=0이면 함께 꺼진다", () => {
    const prev = process.env.GIJO_GLOSSARY_EXPLAIN;
    process.env.GIJO_GLOSSARY_EXPLAIN = "0";
    expect(glossaryGroundingFor("클릭률 낮추는 법")).toBeNull();
    process.env.GIJO_GLOSSARY_EXPLAIN = prev;
  });
});
