import { describe, it, expect } from "vitest";
import {
  extractLexicalTerms,
  buildFtsQuery,
  buildFtsPlan,
  shouldRunLexical,
  hasExactCode,
  fuseResults,
  fuseVariantVectors,
  isRelevant,
  applyCategoryBoost,
  categoryForScreen,
  CATEGORY_BOOST,
  RRF_K,
  REWRITE_RANK_PENALTY,
  type FusedChunk,
  type VariantHit,
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

describe("화면 맥락 부스트(업무영역) — soft boost 원칙", () => {
  const chunk = (over: Partial<FusedChunk>): FusedChunk => ({
    text: "t", documentId: "d", distance: 0.7, lexicalHit: false, rrf: 0.01, ...over,
  });

  it("화면→업무영역 매핑: 대표 화면들이 올바른 영역으로 간다", () => {
    expect(categoryForScreen("maintenance.html")).toBe("장비운영");
    expect(categoryForScreen("compliance.html")).toBe("사내규정");
    expect(categoryForScreen("vulnscan.html")).toBe("취약점");
    expect(categoryForScreen("threat.html")).toBe("위협대응");
    expect(categoryForScreen("dashboard.html")).toBeUndefined(); // 전 영역 화면 — 부스트 없음
    expect(categoryForScreen(undefined)).toBeUndefined();
  });

  it("hub.html?g=X&t=vulnscan.html 형태(iframe 탭)도 파일명을 뽑아 매핑한다", () => {
    expect(categoryForScreen("hub.html?g=vuln&t=vulnscan.html")).toBe("취약점");
  });

  it("관련도가 비슷하면 화면 영역 문서가 위로 온다", () => {
    const a = chunk({ text: "규정 문서", category: "사내규정", rrf: 0.016 });
    const b = chunk({ text: "장비 문서", category: "장비운영", rrf: 0.0165 });
    const boosted = applyCategoryBoost([b, a], "사내규정");
    expect(boosted[0].text).toBe("규정 문서");
  });

  it("압도적으로 관련 높은 다른 영역 문서는 뒤집지 못한다(soft — 정답 보존)", () => {
    const winner = chunk({ text: "정답", category: "취약점", rrf: 0.03 }); // 양쪽 검색 상위
    const same = chunk({ text: "영역만 같음", category: "사내규정", rrf: 0.01 });
    const boosted = applyCategoryBoost([winner, same], "사내규정");
    expect(boosted[0].text).toBe("정답");
    expect(CATEGORY_BOOST).toBeLessThan(0.02); // 부스트가 RRF 1위 점수를 넘지 않는 설계 확인
  });

  it("preferred가 없으면(매핑 안 된 화면) 순서가 그대로다", () => {
    const list = [chunk({ text: "1", rrf: 0.02 }), chunk({ text: "2", rrf: 0.01 })];
    expect(applyCategoryBoost(list, undefined).map((c) => c.text)).toEqual(["1", "2"]);
  });

  it("부스트는 순위만 바꾸고 관련성 게이트(거리)에는 영향이 없다", () => {
    const far = chunk({ distance: 1.2, category: "사내규정", rrf: 0.01 });
    const boosted = applyCategoryBoost([far], "사내규정")[0];
    expect(isRelevant(boosted, MAX_DIST)).toBe(false); // 부스트돼도 무관 조각은 여전히 게이트 밖
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

describe("질의 변형 융합 — 재작성 랭킹 페널티(2026-08-17 실측 결함 재현)", () => {
  it("REWRITE_RANK_PENALTY는 근소한 오염만 거르는 보수적 값(큰 재작성 이득은 안 지운다)", () => {
    expect(REWRITE_RANK_PENALTY).toBeGreaterThan(0);
    expect(REWRITE_RANK_PENALTY).toBeLessThan(0.1); // 0.2대 재작성 이득(KEV 0.840→0.633 등)을 못 지운다
  });

  it("뜻 잃은 재작성 오염이 정답을 못 제친다 — 순위엔 벌점, 거리 칸엔 진짜값", () => {
    // 실측 재현: 원문/정규화는 정답(good)이 0.478로 가깝고, 재작성 "제품 사용 방법"은
    //   엉뚱한 문서(wrong)에 0.449로 가까웠다. 벌점이 없으면 오염이 1위가 된다.
    const 원문: VariantHit[] = [{ text: "g", documentId: "good", distance: 0.478 }];
    const 재작성: VariantHit[] = [{ text: "w", documentId: "wrong", distance: 0.449 }];

    const 벌점없이 = fuseVariantVectors([{ hits: 원문, penalty: 0 }, { hits: 재작성, penalty: 0 }]);
    expect(벌점없이[0].documentId).toBe("wrong"); // 이게 실측된 버그(0.449 < 0.478)

    const 벌점 = fuseVariantVectors([{ hits: 원문, penalty: 0 }, { hits: 재작성, penalty: 0.05 }]);
    expect(벌점[0].documentId).toBe("good"); // 정답 복귀(wrong 0.449+0.05=0.499 > 0.478)
    // ⚠ 오염 조각의 **거리 칸은 진짜값(0.449)** — 게이트가 벌점에 오염되지 않는다
    expect(벌점.find((h) => h.documentId === "wrong")!.distance).toBeCloseTo(0.449);
  });

  it("큰 재작성 이득은 벌점에도 살아남는다(0.05는 근소한 오염만 거른다)", () => {
    // "IPS 오탐"류: 원문 0.47 → 재작성 0.384(이득 0.086). 벌점 0.05로도 재작성이 이긴다.
    const 결과 = fuseVariantVectors([
      { hits: [{ text: "a", documentId: "docA", distance: 0.47 }], penalty: 0 },
      { hits: [{ text: "b", documentId: "docB", distance: 0.384 }], penalty: 0.05 },
    ]);
    expect(결과[0].documentId).toBe("docB"); // 0.384+0.05=0.434 < 0.47
  });

  it("같은 조각이 여러 변형에 걸리면 하나로 합치고 거리는 진짜 최소(벌점 무관)", () => {
    const r = fuseVariantVectors([
      { hits: [{ text: "shared", documentId: "d", distance: 0.6 }], penalty: 0 },
      { hits: [{ text: "shared", documentId: "d", distance: 0.4 }], penalty: 0.05 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].distance).toBeCloseTo(0.4); // 게이트용 진짜 최소거리(벌점 미반영)
  });

  it("변형이 하나뿐(원문만)이어도 정상 — 페널티 0", () => {
    const r = fuseVariantVectors([{ hits: [{ text: "x", documentId: "d", distance: 0.5 }], penalty: 0 }]);
    expect(r.map((h) => h.distance)).toEqual([0.5]);
  });

  it("빈 입력에도 죽지 않는다", () => {
    expect(fuseVariantVectors([])).toEqual([]);
    expect(fuseVariantVectors([{ hits: [], penalty: 0 }])).toEqual([]);
  });
});
