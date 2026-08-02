// engine/hybridsearch.ts — 하이브리드 검색(벡터 + 키워드 BM25)의 순수 로직.
//
// 왜 필요한가(2026-07-25 운영 데이터 실측):
//   벡터 검색은 "의미가 비슷한 조각"을 찾는다. 그래서 IW-32·CVE-2021-44228·T1190처럼
//   글자 그대로 맞아야 하는 코드 질의에서, 숫자가 잔뜩 든 API 매뉴얼 목차나 점선(......)
//   같은 잡음 조각이 상위를 차지했다(7종 중 3종 실패: T1190은 아예 못 찾음).
//   BM25(키워드)는 그 조각에 해당 토큰이 없으면 0점을 주므로 정확히 이 약점을 메운다.
//
// 설계 원칙 — 관련성 게이트를 순위 점수에 맡기지 않는다:
//   기존 게이트는 벡터 거리 ≤ RAG_RELEVANCE_MAX_DISTANCE(0.95, 실측값)였다. RRF는 거리가 아니라
//   순위 기반 점수를 내므로 게이트를 RRF 점수로 갈아치우면 "무관한 질문에 잡음 조각이 근거로
//   주입되는" 사고(2026-07-19)가 재발한다. 그래서 융합은 순위 매기기에만 쓰고, 통과 판정은
//   결정적 조건 두 개로 유지한다:  벡터거리 ≤ 0.95  OR  질의의 렉시컬 토큰이 조각에 실제 포함.
//
// 이 파일은 LanceDB에 의존하지 않는다(순수 함수) — 검색 호출은 memory.ts가 한다.

/** 렉시컬(글자 그대로) 매칭이 필요한 토큰. 보안 코드 체계를 우선 인식한다. */
export interface LexicalTerms {
  /** 보안 표준·취약점 코드 — CVE-2021-44228, IW-32, U-01, CWE-79, T1190, AML.T0051 등 */
  codes: string[];
  /** 그 외 영숫자 낱말(제품명·명령어 등). 코드보다 약한 신호로 쓴다. */
  words: string[];
}

// 보안 코드 패턴. 우리 제품이 다루는 체계를 실제 사례로 열거했다:
//   CVE-2021-44228 / CWE-79 / IW-32 / U-01 / C-05 / PC-03 / N-33 / T1190 / TA0001 /
//   AML.T0051 / NISTAML.018 / KEV / OWASP LLM01
// 공통 골격은 "영문 대문자 접두 + 구분자(-|.|없음) + 숫자"다.
const CODE_RE = /\b(?:[A-Z]{1,10}(?:\.[A-Z]{1,10})?[-.]?\d{1,6}(?:[-.]\d{1,6})*)\b/g;

// 렉시컬 신호로 쓸 값이 없는 흔한 영문 낱말. BM25에서 문서 대부분에 걸려 순위를 흐린다.
const STOP_WORDS = new Set([
  "the", "and", "for", "you", "are", "with", "this", "that", "have", "from", "not", "but",
  "what", "how", "why", "when", "where", "which", "who", "can", "does", "did", "was", "were",
  "gijo", "api", "http", "https", "www", "com",
]);

/**
 * 질의에서 렉시컬 토큰을 뽑는다.
 * 한글은 뽑지 않는다 — 한국어 의미 검색은 bge-m3(벡터)가 이미 잘 하고, 조사가 붙는 한국어를
 * 형태소 분석 없이 BM25에 넣으면("취약점을" ≠ "취약점") 이득 없이 잡음만 늘기 때문이다.
 */
export function extractLexicalTerms(question: string): LexicalTerms {
  const upper = question.toUpperCase();
  const codes = [...new Set(upper.match(CODE_RE) ?? [])];
  const words = [
    ...new Set(
      (question.match(/[A-Za-z][A-Za-z0-9_]{2,}/g) ?? [])
        .map((w) => w.toLowerCase())
        .filter((w) => !STOP_WORDS.has(w))
        // 코드의 일부로 이미 잡힌 낱말은 중복 신호라 뺀다(CVE-2021-44228의 "cve" 등)
        .filter((w) => !codes.some((c) => c.toLowerCase().includes(w)))
    ),
  ];
  return { codes, words };
}

/**
 * LanceDB 전문 검색에 넣을 질의 문자열(단순형·폴백용). 코드는 구분자를 공백으로 풀어 준다 —
 * 인덱스가 "simple" 토크나이저라 CVE-2021-44228이 [cve, 2021, 44228]로 쪼개져 저장되기 때문에
 * 질의도 같은 모양이어야 맞는다.
 */
export function buildFtsQuery(terms: LexicalTerms): string {
  const parts = [...terms.codes.map((c) => c.replace(/[-.]/g, " ")), ...terms.words];
  return parts.join(" ").trim();
}

/**
 * 전문 검색 질의 계획. LanceDB 객체 조립은 memory.ts가 하고(이 파일은 순수 유지),
 * 여기서는 "무엇을 구문으로 묶고 무엇을 낱말로 볼지"만 결정한다.
 *
 * 코드를 구문(phrase)으로 묶는 이유(2026-07-25 실측): "U-07"은 [u, 07]로 쪼개지는데
 * 낱말 검색으로 두면 흔한 숫자 "07"이 무관한 조각을 상위로 끌어올려 정답이 topK 밖으로
 * 밀렸다("KISA U-07 설정"은 맞고 "U-07" 단독은 실패). 토큰 인접을 요구하면 해결된다.
 */
export interface FtsPlan {
  /** 토큰이 여러 개로 쪼개지는 코드 — 인접 순서를 요구할 대상. */
  phrases: string[];
  /** 단일 토큰(코드든 낱말이든) — 일반 낱말 검색 대상. */
  words: string[];
}

export function buildFtsPlan(terms: LexicalTerms): FtsPlan {
  const phrases: string[] = [];
  const words: string[] = [...terms.words];
  for (const code of terms.codes) {
    const spaced = code.replace(/[-.]/g, " ").replace(/\s+/g, " ").trim();
    // 구분자가 없는 코드(T1190·TA0001)는 한 토큰이라 구문으로 묶을 게 없다.
    if (spaced.includes(" ")) phrases.push(spaced);
    else words.push(spaced.toLowerCase());
  }
  return { phrases, words };
}

/** 렉시컬 검색을 돌릴 가치가 있는 질의인가. 코드가 있으면 무조건, 없으면 영문 낱말 1개 이상. */
export function shouldRunLexical(terms: LexicalTerms): boolean {
  return terms.codes.length > 0 || terms.words.length > 0;
}

/**
 * 조각 안에 질의의 코드가 글자 그대로 들어있는가. 게이트 통과의 결정적 근거로 쓴다.
 * 구분자(-·.·공백)는 문서 표기가 흔들리므로 무시하고 비교한다(IW-32 = IW 32 = IW.32).
 */
export function hasExactCode(text: string, codes: string[]): boolean {
  if (codes.length === 0) return false;
  const flat = text.toUpperCase().replace(/[-._\s]/g, "");
  return codes.some((c) => flat.includes(c.replace(/[-._\s]/g, "")));
}

// ── 업무영역(category) — 문서 분류와 화면 맥락 검색의 공통 축 (2026-07-25 RAG 전면 검토) ──
//
// 기존 4분류(매뉴얼/보고서/정책/기타)는 "문서의 형태"라서 제품의 4대 업무와 어긋났다.
// 운영 실측: 67건 중 19건 미분류, 대응 지침·SIEM 룰까지 전부 "보고서" 한 통에 뭉개짐.
// 새 축은 "무슨 업무에 쓰는 자료인가"로 잡는다 — 화면과 1:1로 이어져 맥락 검색이 된다.
export const CATEGORIES = ["취약점", "장비운영", "사내규정", "위협대응", "일반"] as const;
export type Category = (typeof CATEGORIES)[number];

// 화면 → 우선 업무영역. 이 화면에서 질문하면 해당 영역 문서의 순위를 올린다(soft boost).
// 대시보드·기억 화면은 전 영역이 대상이라 매핑하지 않는다(부스트 없음 = 기존과 동일).
export const SCREEN_CATEGORY: Record<string, Category> = {
  "vulnscan.html": "취약점",
  "analysis.html": "취약점",
  "assethub.html": "취약점",
  "inventory.html": "취약점",
  "sbom.html": "취약점",
  "kpi.html": "취약점",
  "products.html": "장비운영",
  "maintenance.html": "장비운영",
  "hardening.html": "장비운영",
  "terminal.html": "장비운영",
  "compliance.html": "사내규정",
  "audit.html": "사내규정",
  "handover.html": "사내규정",
  "threat.html": "위협대응",
  "cti.html": "위협대응",
  "redteam.html": "위협대응",
  "mcp.html": "위협대응",
};

export function categoryForScreen(screen?: string): Category | undefined {
  if (!screen) return undefined;
  // hub.html?g=X&t=vulnscan.html 형태로 올 수도 있어 파일명만 뽑는다.
  const t = /t=([a-z-]+\.html)/.exec(screen)?.[1] ?? screen.split("/").pop() ?? screen;
  return SCREEN_CATEGORY[t];
}

/**
 * 화면 맥락 부스트의 세기. RRF 1위 점수가 1/(60+1)≈0.0164이므로, 그 절반쯤(0.008)을 더하면
 * "관련도가 비슷할 때 해당 영역이 이긴다" 수준이 된다 — 3~4순위쯤 위로 올라오지만,
 * 다른 영역의 압도적 정답(양쪽 검색 상위)을 뒤집지는 못한다. 강한 필터로 두지 않는 이유:
 * 화면과 다른 영역의 질문("컴플라이언스 화면에서 CVE 질문")이 아예 안 잡히면 안 되기 때문.
 */
export const CATEGORY_BOOST = 0.008;

/** 화면의 우선 업무영역과 같은 조각의 순위를 올린다. category가 없으면(부스트 불가) 그대로. */
export function applyCategoryBoost(chunks: FusedChunk[], preferred?: Category): FusedChunk[] {
  if (!preferred) return chunks;
  return chunks
    .map((c) => ({ ...c, rrf: c.rrf + (c.category === preferred ? CATEGORY_BOOST : 0) }))
    .sort((a, b) => b.rrf - a.rrf);
}

export interface FusionInput {
  /** 벡터 검색 결과(가까운 순). distance는 LanceDB _distance. */
  vector: { text: string; documentId: string; distance: number; category?: string }[];
  /** 전문 검색(BM25) 결과(점수 높은 순). */
  lexical: { text: string; documentId: string; category?: string }[];
}

export interface FusedChunk {
  text: string;
  documentId: string;
  /** 벡터 거리. 렉시컬로만 걸린 조각은 거리를 모르므로 +Infinity. */
  distance: number;
  /** 질의의 코드가 이 조각에 실제로 포함됐는가 — 게이트의 두 번째 근거. */
  lexicalHit: boolean;
  /** 순위 융합 점수(RRF). 순서 결정에만 쓰고 관련성 판정에는 쓰지 않는다. */
  rrf: number;
  /** 문서의 업무영역(취약점·장비운영·사내규정·위협대응·일반). 옛 조각은 없을 수 있다. */
  category?: string;
}

// RRF(Reciprocal Rank Fusion) 상수. k=60은 원 논문(Cormack 2009)과 LanceDB·Elastic 기본값이다.
// 순위가 밀린 결과의 영향을 완만하게 줄여, 한쪽 검색이 크게 틀려도 다른 쪽이 회복시킨다.
export const RRF_K = 60;

/** 같은 조각을 (documentId, text) 기준으로 합치고 RRF로 순위를 낸다. */
export function fuseResults(input: FusionInput, codes: string[]): FusedChunk[] {
  const byKey = new Map<string, FusedChunk>();
  const keyOf = (documentId: string, text: string) => `${documentId} ${text}`;

  input.vector.forEach((r, i) => {
    const key = keyOf(r.documentId, r.text);
    const prev = byKey.get(key);
    const rrf = 1 / (RRF_K + i + 1);
    if (prev) {
      prev.rrf += rrf;
      prev.distance = Math.min(prev.distance, r.distance);
    } else {
      byKey.set(key, {
        text: r.text,
        documentId: r.documentId,
        distance: r.distance,
        lexicalHit: hasExactCode(r.text, codes),
        rrf,
        ...(r.category ? { category: r.category } : {}),
      });
    }
  });

  input.lexical.forEach((r, i) => {
    const key = keyOf(r.documentId, r.text);
    const rrf = 1 / (RRF_K + i + 1);
    const prev = byKey.get(key);
    if (prev) prev.rrf += rrf;
    else
      byKey.set(key, {
        text: r.text,
        documentId: r.documentId,
        distance: Number.POSITIVE_INFINITY, // 벡터 결과에 없던 조각 — 거리를 모른다
        lexicalHit: hasExactCode(r.text, codes),
        rrf,
        ...(r.category ? { category: r.category } : {}),
      });
  });

  return [...byKey.values()].sort((a, b) => b.rrf - a.rrf);
}

/**
 * 관련성 게이트. 벡터 거리 임계값을 통과했거나, 질의의 코드가 조각에 실제로 있으면 통과.
 * 렉시컬로만 걸렸는데 코드도 없는 조각(영문 낱말만 스친 경우)은 근거로 쓰지 않는다 —
 * 벡터가 무관하다고 판정한 것을 BM25 순위만으로 되살리면 잡음 주입이 다시 열린다.
 */
export function isRelevant(chunk: FusedChunk, maxDistance: number): boolean {
  return chunk.distance <= maxDistance || chunk.lexicalHit;
}
