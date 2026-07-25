import { describe, it, expect } from "vitest";
import {
  extractLexicalTerms,
  buildFtsQuery,
  buildFtsPlan,
  shouldRunLexical,
  hasExactCode,
  fuseResults,
  isRelevant,
  RRF_K,
  type FusedChunk,
} from "../src/engine/hybridsearch";

const MAX_DIST = 0.95; // RAG_RELEVANCE_MAX_DISTANCE와 같은 값(실측으로 정해진 임계값)

describe("렉시컬 토큰 추출", () => {
  it("우리 제품이 다루는 보안 코드 체계를 인식한다", () => {
    const cases: [string, string][] = [
      ["CVE-2021-44228 알려줘", "CVE-2021-44228"],
      ["IW-32이 뭐야", "IW-32"],
      ["KISA U-07 설정 방법", "U-07"],
      ["CWE-79 취약점", "CWE-79"],
      ["AML.T0051 대응", "AML.T0051"],
      ["T1190 공격 기법", "T1190"],
      ["PC-03 점검 결과", "PC-03"],
    ];
    for (const [q, code] of cases) {
      expect(extractLexicalTerms(q).codes, q).toContain(code);
    }
  });

  it("한글만 있는 질문에서는 렉시컬 검색을 돌리지 않는다(형태소 분석기가 없어 이득이 없음)", () => {
    const terms = extractLexicalTerms("우리 회사 취약점 관리 절차 알려줘");
    expect(terms.codes).toEqual([]);
    expect(terms.words).toEqual([]);
    expect(shouldRunLexical(terms)).toBe(false);
  });

  it("흔한 영문 불용어는 신호로 쓰지 않는다", () => {
    const terms = extractLexicalTerms("what is the snort rule for this");
    expect(terms.words).toContain("snort");
    expect(terms.words).not.toContain("the");
    expect(terms.words).not.toContain("what");
  });

  it("코드에 이미 포함된 낱말은 중복 신호로 넣지 않는다", () => {
    const terms = extractLexicalTerms("CVE-2021-44228");
    expect(terms.codes).toEqual(["CVE-2021-44228"]);
    expect(terms.words).not.toContain("cve");
  });

  it("FTS 질의는 코드 구분자를 공백으로 풀어 준다(simple 토크나이저와 모양을 맞춤)", () => {
    const terms = extractLexicalTerms("CVE-2021-44228 log4j");
    expect(buildFtsQuery(terms)).toBe("CVE 2021 44228 log4j");
  });
});

describe("질의 계획 — 코드는 구문으로 묶는다", () => {
  it("여러 토큰으로 쪼개지는 코드는 구문 대상(U-07 단독 검색 실패 사례)", () => {
    const plan = buildFtsPlan(extractLexicalTerms("U-07"));
    expect(plan.phrases).toEqual(["U 07"]);
    expect(plan.words).toEqual([]);
  });

  it("구분자 없는 코드는 한 토큰이라 낱말로 둔다", () => {
    const plan = buildFtsPlan(extractLexicalTerms("T1190"));
    expect(plan.phrases).toEqual([]);
    expect(plan.words).toEqual(["t1190"]);
  });

  it("코드와 낱말이 섞이면 각각 제자리로 간다", () => {
    const plan = buildFtsPlan(extractLexicalTerms("CVE-2021-44228 log4j 취약점"));
    expect(plan.phrases).toEqual(["CVE 2021 44228"]);
    expect(plan.words).toContain("log4j");
  });

  it("한글만 있으면 계획이 비어 렉시컬 검색을 건너뛴다", () => {
    const terms = extractLexicalTerms("자산 목록 보여줘");
    const plan = buildFtsPlan(terms);
    expect(plan.phrases).toEqual([]);
    expect(plan.words).toEqual([]);
    expect(shouldRunLexical(terms)).toBe(false);
  });
});

describe("코드 정확 일치 판정", () => {
  it("문서 표기가 흔들려도(IW-32 / IW 32 / IW.32) 같게 본다", () => {
    for (const t of ["항목 IW-32 설명", "항목 IW 32 설명", "항목 IW.32 설명"]) {
      expect(hasExactCode(t, ["IW-32"]), t).toBe(true);
    }
  });

  it("코드가 없는 잡음 조각은 걸리지 않는다", () => {
    const noise = "meters 1055 ExampleResponse 1056 /scanner/{id}/health 1056";
    expect(hasExactCode(noise, ["T1190"])).toBe(false);
    expect(hasExactCode("......................................", ["IW-32"])).toBe(false);
  });

  it("질의에 코드가 없으면 항상 false(렉시컬 근거 없음)", () => {
    expect(hasExactCode("아무 텍스트", [])).toBe(false);
  });
});

describe("RRF 순위 융합", () => {
  const vec = (i: number) => ({ text: `v${i}`, documentId: "docA", distance: 0.5 + i * 0.1 });

  it("두 검색에 모두 걸린 조각이 위로 올라온다", () => {
    const both = { text: "shared", documentId: "docA", distance: 0.9 };
    const fused = fuseResults(
      { vector: [vec(0), vec(1), both], lexical: [{ text: "shared", documentId: "docA" }] },
      []
    );
    expect(fused[0].text).toBe("shared");
    expect(fused[0].rrf).toBeCloseTo(1 / (RRF_K + 3) + 1 / (RRF_K + 1));
  });

  it("벡터가 놓친 조각을 렉시컬이 살려낸다(T1190 실패 사례)", () => {
    const fused = fuseResults(
      { vector: [vec(0)], lexical: [{ text: "T1190 Exploit Public-Facing Application", documentId: "attack" }] },
      ["T1190"]
    );
    const revived = fused.find((c) => c.documentId === "attack");
    expect(revived).toBeDefined();
    expect(revived!.lexicalHit).toBe(true);
    expect(revived!.distance).toBe(Number.POSITIVE_INFINITY); // 벡터 결과에 없어 거리를 모른다
  });

  it("같은 조각이 중복으로 남지 않는다", () => {
    const fused = fuseResults(
      { vector: [vec(0), vec(0)], lexical: [{ text: "v0", documentId: "docA" }] },
      []
    );
    expect(fused).toHaveLength(1);
  });

  it("빈 입력에도 죽지 않는다", () => {
    expect(fuseResults({ vector: [], lexical: [] }, [])).toEqual([]);
  });
});

describe("관련성 게이트 — 잡음 주입 방지(2026-07-19 사고 재발 차단)", () => {
  const chunk = (over: Partial<FusedChunk>): FusedChunk => ({
    text: "t",
    documentId: "d",
    distance: 2,
    lexicalHit: false,
    rrf: 0.5,
    ...over,
  });

  it("벡터 거리가 임계값 안이면 통과", () => {
    expect(isRelevant(chunk({ distance: 0.7 }), MAX_DIST)).toBe(true);
  });

  it("거리가 멀어도 질의 코드가 실제로 들어있으면 통과(하이브리드가 얻는 이득)", () => {
    expect(isRelevant(chunk({ distance: Number.POSITIVE_INFINITY, lexicalHit: true }), MAX_DIST)).toBe(true);
  });

  it("거리가 멀고 코드도 없으면 통과시키지 않는다 — RRF 점수가 높아도 안 된다", () => {
    expect(isRelevant(chunk({ distance: 1.28, lexicalHit: false, rrf: 999 }), MAX_DIST)).toBe(false);
  });

  it("무관한 질문(쌀국수)에 딸려온 보안 조각은 걸러진다", () => {
    // 실측된 무관 질문 거리 범위 1.086~1.285
    const irrelevant = [1.086, 1.2, 1.285].map((d) => chunk({ distance: d }));
    expect(irrelevant.filter((c) => isRelevant(c, MAX_DIST))).toHaveLength(0);
  });
});
