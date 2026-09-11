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
  /** 질의에 대문자로 쓰인 3~6자 약어의 원형(VPR·KEV·EPSS 등). BM25 질의에는 안 들어간다
   *  (이미 words로 들어가 있다) — 관련성 게이트 전용 신호다(B1 — 홑 약어 정의 물음). */
  acronyms: string[];
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

// ── 약어 신호(B1 — 홑 약어 정의 물음, 2026-09-11 설계관 지시서) ─────────────────────────
// 왜: 「VPR이 뭐야?」·「KEV가 뭐야?」류는 벡터로 원리상 못 가른다(실측: 정답 조각 0.946~1.036,
//   무관 조각 1.03~1.2로 두 무리가 겹친다). 코드(CODE_RE)는 숫자를 요구해 VPR·KEV·EPSS·CVSS·
//   VEX·SBOM처럼 숫자 없는 약어를 못 잡는다 — 그래서 words로만 BM25 순위에 갈 뿐 관련성
//   게이트를 못 넘었다. 이 셋으로 약어를 게이트의 **세 번째 갈래**(hasExactAcronym·isRelevant)로 태운다.
export const ACRONYM_RE = /(?<![A-Za-z0-9_])[A-Z]{3,6}(?![A-Za-z0-9_])/g;
// 문서 **유형·형식**을 가리키는 약어 — 주제어가 아니라 매체라 근거 신호가 아니다.
// ⚠ STOP_WORDS에 넣지 않는다(그러면 BM25 words에서도 빠져 이 결함과 무관한 회귀가 열린다) —
//   여기는 약어 게이트 전용 제외 집합이다(DOCSCOPE_STOP과 같은 선례).
const 약어제외 = new Set([
  "pdf", "docx", "xlsx", "hwp", "hwpx", "csv", "txt", "ppt", "pptx", "zip", "json", "xml", "yaml", "html", "png", "jpg",
]);
// 약어 히트로 통과할 수 있는 거리 상한. 정답 조각 최대 1.036(VEX)에 여유를 둔 값이다.
// 진짜 역할은 무관을 가르는 것이 아니라, fuseResults가 distance=Infinity로 남기는 BM25 전용
// 조각을 원리상 배제하는 것이다(2026-07-19 잡음 주입 계약 유지 — 겹치는 1.03~1.10 구간은
// 낱말 일치가 가른다).
export const ACRONYM_MAX_DISTANCE = 1.10;

/**
 * **담당자 말투를 검색용으로 다듬는다**(2026-08-12 신설).
 *
 * ■ 왜 — 실측: 같은 문서를 두 말투로 물으면 **거리가 평균 0.19 벌어진다.**
 *     "KEV에 올라오면 며칠 안에 해야 하는 거였지?"  0.888  ← 「근거 약함」 문턱(0.85) 밖
 *     "CISA KEV 조치 기한"                        0.541  ← 넉넉히 안쪽
 *   8쌍 중 6쌍이 밀렸고 2쌍이 문턱을 넘었다. `aws_s3`는 0.849로 **0.001 차이**로 겨우 통과했다.
 *   담당자는 라벨이 아니라 말로 묻는데, 문서는 문어체로 쓰여 있다. 그 간극이 「자료가 있는데
 *   못 닿는다」의 큰 몫이었다(오늘 origin 누락과 함께 두 뿌리 중 하나다).
 *
 * ■ ⚠ **원문을 버리지 않는다.** 이 함수 결과는 원문과 **함께** 검색해 가까운 쪽을 취한다
 *   (hybridSearch 참고). 정규화가 뜻을 바꿔도 원문 결과가 남아 있어 안전하다 —
 *   좁히는 수리가 기능을 죽이던 오늘의 반복을 여기서 되풀이하지 않는다.
 *
 * ■ 무엇을 떼나 — **뜻을 지우지 않는 것만**. 종결 물음·요청 표현과 군말이다.
 *   주제어(취약점·기한·브루트포스…)는 건드리지 않는다.
 */
const 군말_RE =
  /(?:^|\s)(?:좀|그냥|혹시|일단|한번|한 번|이거|그거|저거|이건|그건|말이야|말인데|같은\s*게|같은\s*거)(?=\s|$)/g;
const 종결_RE =
  /(?:이?\s*(?:거였|것이었|건))?\s*(?:지|나|가)?\s*[?？!.]*$|(?:해야\s*(?:하|되)(?:는|나|지|나요)?|어떻게\s*(?:해야)?\s*(?:하지|되지|하나요|해)?|뭐(?:지|야|예요)?|어떡하지|어떤가요?|알려\s*줘|알려\s*주세요|해\s*줘|해\s*주세요|주세요|줘|봐야\s*하지|봐야\s*해)\s*[?？!.]*$/;

export function normalizeForSearch(question: string): string {
  let t = String(question ?? "").trim();
  t = t.replace(군말_RE, " ");
  // 종결 표현은 한 번만 떼면 "…어디부터 봐야 하지?" 같은 겹말이 남는다 — 두 번까지 훑는다.
  for (let i = 0; i < 2; i++) t = t.replace(종결_RE, "").trim();
  t = t.replace(/\s{2,}/g, " ").replace(/[,·]\s*$/, "").trim();
  // 너무 많이 깎였으면(원문의 40% 미만) 쓰지 않는다 — 뜻이 남았다고 볼 수 없다.
  if (!t || t.length < Math.max(4, Math.floor(question.trim().length * 0.4))) return "";
  return t === question.trim() ? "" : t;
}

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
  // 대문자로 쓰인 3~6자 약어(B1) — 사람이 약어를 쓸 때 대문자로 쓴다(4100 실측 물음 전부
  //   대문자). 소문자 "vpr"로 물으면 이 갈래는 안 걸린다(한계를 그대로 적는다 — 소문자까지
  //   열면 영어 본문의 아무 낱말이나 약어가 되어 표면이 통째로 넓어진다).
  const acronyms = [
    ...new Set(
      (question.match(ACRONYM_RE) ?? [])
        .filter((a) => !STOP_WORDS.has(a.toLowerCase()))
        .filter((a) => !약어제외.has(a.toLowerCase()))
        // 코드로 이미 잡힌 약어는 중복 신호라 뺀다(CVE-2021-44228의 "CVE" 등)
        .filter((a) => !codes.some((c) => c.toLowerCase().includes(a.toLowerCase())))
    ),
  ];
  return { codes, words, acronyms };
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

/**
 * 조각 안에 질의의 약어가 **낱말 그대로** 들어있는가(B1). hasExactCode처럼 구분자를 지우면
 * "convex"·"vexing"이 "VEX"로 읽히는 함정이 있다(agentloop.ts의 VEX 규칙이 이미 같은 무늬로
 * 막아 둔 자리 — `(?<![a-zA-Z])(?:VEX|vex)(?![a-zA-Z])`). 그래서 낱말 경계를 그대로 지킨다.
 * 밑줄까지 경계에서 빼는 이유는 VPR_SCORE 같은 식별자에 걸리지 않게 하기 위함이다.
 * 대소문자는 무시한다 — 문서 본문은 소문자로 쓰여 있을 수 있다.
 */
export function hasExactAcronym(text: string, acronyms: string[]): boolean {
  if (acronyms.length === 0) return false;
  return acronyms.some((a) => {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, "i").test(text);
  });
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
  "pick.html": "취약점", // 🎯 고르기(자산·취약점) — 취약점 계열 검색 부스트(검토관 중7)
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

/**
 * **역할별 검색 정책**(2026-08-07 사용자 지시 "전문 에이전트" 논의에서 나온 방식).
 *
 * 창고를 업무영역별로 쪼개자는 안을 실측으로 물렸다 — 운영 지식이 「일반」에 2,866조각
 * 몰려 있어(전체의 절반) 물리 분리를 하면 그 절반이 **어느 전문가도 안 보는 고아**가 되고,
 * 분류 오류가 곧 "영영 못 찾음"이 된다(같은 날 7B가 방화벽 메모를 취약점으로 오분류).
 *
 * 대신 **우선순위를 세게, 벽은 세우지 않는다**:
 *   · 그 역할의 영역이면 강한 가산점(전문가는 제 자료를 먼저 본다)
 *   · 다른 영역도 후보에는 남는다(폴백 — 분류가 틀려도 답을 잃지 않는다)
 *   · 「일반」은 벌하지 않는다 — 아직 분류가 안 된 것이지 무관한 것이 아니다
 */
export const ROLE_BOOST = 0.02; // RRF 1위(≈0.0164)를 넘는 세기 — 동률이면 제 영역이 확실히 이긴다

/** 화면의 우선 업무영역과 같은 조각의 순위를 올린다. category가 없으면(부스트 불가) 그대로.
 *  @param 강하게 역할 검색(전문가 경로)이면 true — 화면 맥락보다 세게 건다. */
export function applyCategoryBoost(chunks: FusedChunk[], preferred?: Category, 강하게 = false): FusedChunk[] {
  if (!preferred) return chunks;
  const 가산 = 강하게 ? ROLE_BOOST : CATEGORY_BOOST;
  return chunks
    .map((c) => ({ ...c, rrf: c.rrf + (c.category === preferred ? 가산 : 0) }))
    .sort((a, b) => b.rrf - a.rrf);
}

// 우리 질문에 우리 지식(제품 내장 = docs-manifest 코퍼스)을 먼저 세운다(2026-08-10 ①ⓑ).
// ⚠ RAG 오염 실측: 타사 벤더 매뉴얼(Tenable·안전대부)이 우리 질문 근거의 절반 넘게 낀다.
//   「조치 이력」에서 GIJO 매뉴얼(0.8470)이 Tenable(0.8455)보다 멀어, 문턱으로도 접점으로도 못 갈렸다.
//   접점(C-1)은 GIJO 매뉴얼이 접점 0이라 역효과였다 — origin은 「내장 목록에 있나」만 보므로 확실히 올린다.
// ⚠ **벽이 아니다** — builtin을 올릴 뿐 external(고객 로그·리포트)을 내리지 않는다. 접점 없는 새
//   문서가 통째로 사라지면 안 된다(Mac 원칙: 거르지 말고 올리기만).
export const ORIGIN_BOOST = 0.012; // ROLE_BOOST(0.02)보단 약하게(역할이 우선), CATEGORY_BOOST(0.008)보단 강하게.
export function applyOriginBoost(chunks: FusedChunk[], builtinIds: Set<string>): FusedChunk[] {
  if (builtinIds.size === 0) return chunks;
  return chunks
    .map((c) => (builtinIds.has(c.documentId) ? { ...c, rrf: c.rrf + ORIGIN_BOOST } : c))
    .sort((a, b) => b.rrf - a.rrf);
}

// ── 문서 스코프 부스트 — 질문이 **특정 문서를 콕 집으면** 그 문서 조각을 앞세운다 ─────────
// 왜(2026-08-21 SolidStep 실측): "SolidStep 매뉴얼에서 X 알려줘"에 정답 조각이 늘 top16 안에
//   있는데(1~6위) 문서명을 대도 **딴 자기문서가 1위로 새치기**해 원문 인용을 흐렸다. 조각이
//   버려지는 게 아니라 밀리는 것이라 — candidates/topK가 아니라 **재랭킹**이 처방이다(설계관 확정).
// ★ 이름을 콕 집은 것은 강한 의도 신호라 **역할(ROLE)과 대등한 세기**로 올린다 — 그래도 **벽이
//   아니라 올리기**다. distance는 안 건드린다(근거 세기 게이트·rag-weak-evidence 보호 — rrf만).
//   ⚠ 세기가 셀수록 오탐의 재랭킹 파괴력이 크다(검토관 지적) — 그래서 세기는 ROLE 밑으로 안 올리고,
//     지목 대상 자체를 좁힌다(아래 ①②③). 지목 조각의 기저 rrf가 이미 높으면 더 가까운 조각도
//     넘어설 수 있지만, 그건 이미 경쟁력 있던 조각이라 정상 동작이다.
export const DOCSCOPE_BOOST = 0.02;
// 파일명에서 **문서 유형어**를 빼고 구별 토큰만 남긴다 — "매뉴얼.pdf"가 "매뉴얼"만 든 질문마다
//   걸리지 않게(오탐 방지).
// ★ 2026-09-08 추가된 넷: gijo·as·지식·kisa. 내장 문서를 목록에 넣으면서 생긴 자리다 —
//   내장 35편 가운데 24편이 `GIJO_지식_…`·`GIJO_AS_…`로 시작해, 이 넷을 안 빼면
//   「gijo」 한 낱말이 스치는 것만으로 24편이 한꺼번에 지목된다(그 반대편 실측: 안 빼면
//   5편은 남는 토큰이 「gijo」뿐이라 **이름으로 집는 것이 원리상 불가능**했다).
const DOCSCOPE_STOP = new Set(["매뉴얼", "manual", "가이드", "guide", "규정", "문서", "doc", "docs",
  "파일", "file", "보고서", "report", "설명서", "안내", "pdf", "docx", "xlsx", "hwp", "hwpx", "txt", "md", "png", "jpg",
  "gijo", "as", "지식", "kisa"]);

/**
 * 질문이 **제목으로 콕 집은** 문서의 documentId 집합 — 파일명의 구별 토큰이 질문에 들어 있으면 지목.
 *
 * ★★ 2026-09-08 개정(옛 이름 docScopeMatch) — **잣대를 한 곳으로 모은다.** 이 함수는 순수부다:
 *   문서 목록은 부르는 쪽이 넘기고(원천부는 memory.제목지목문서), 랭킹 부스트와 라우팅이
 *   **같은 이 함수만** 부른다. 두 층이 서로 다른 잣대로 「지목」을 재던 것이 이 라운드의 뿌리다 —
 *   라우팅은 언어패턴만 보고(memory.문서지목질문) 랭킹은 업로드 문서만 봐서, 지식 문서는
 *   **이름을 정확히 대도 두 층 모두에서 지목이 아니었다**(2026-09-08 라이브 재현 4문장).
 *
 * 토큰 규칙(왜 이렇게):
 *   ① 한글은 **2자↑**, 라틴은 **3자↑**(2026-09-11 4자↑→3자↑ — 아래 개정 참고). 옛 규칙은
 *      라틴 기준 4자 하나였고 한글에서 죽었다 — 금융(2)·보안(2)·취약점(3)·공급망(3)이 전부
 *      탈락해, 내장 35편 중 5편은 남는 토큰이 「gijo」뿐이었다(\b가 한글에서 죽던 것과 같은
 *      계열: 라틴 기준을 한글에 그대로 대면 못 센다).
 *      ★★ 2026-09-11 개정(설계관 지시서, ①③ 결함 뿌리) — 라틴 **4자↑→3자↑**. KEV·VPR·BOD 같은
 *      3자 약어가 4자 규칙에서 전부 죽어 「EPSS랑 VPR 뭐가 달라?」·「KEV BOD 22-01 조치 기한이
 *      뭐야?」가 지목 0이 됐다(후자는 라우팅이 explain을 못 박지 못해 취약점 조건 검색으로 샜다 —
 *      2026-09-11 라이브 4100 실측). 3자로 내리며 **토큰 중복 제거**(`[...new Set(tokens)]`)를
 *      같이 넣었다 — 없으면 `방화벽_any_any_규칙`의 `any`가 두 번 세어져 "2개 이상"을 혼자
 *      채운다(반례: 「IAM에서 any 설정은?」).
 *      ⚠ **이 값은 2026-08-21 검토관 [중] 수리로 올렸던 값이다**(fc0f5728 「docScope 과포착 좁힘
 *        … 4자 미만 토큰(log·api·web) 제외」). 그때는 **한 토큰 스침만으로 지목**이라 3자가
 *        위험했다. 지금은 성립 조건(6자↑ 하나 | 2개↑ + 3자↑ 하나)이 그 위험을 대신 막으므로
 *        되돌릴 수 있다 — 되돌리는 값은 **왜 올렸었는지**를 함께 적어야 다음 사람이 같은 자리를
 *        또 왕복하지 않는다.
 *      ⚠ 숫자는 **재현되는 것만** 적는다(검토관 [하] — 옛 판은 재현 장치 없는 「436문·17→25」를
 *        주석 세 곳에 박았다). 재현기: `node tools/titlescope-measure.mjs --vs 2b01e479^`.
 *        그 실측(문서 67편 × 물음 118개 = evalgate routing/korean/negative + doc-probe + regress):
 *        **지목 11→16(+5) · 잃은 지목 0 · 오지목 0** — 늘어난 5건은 전부 그 문서가 실제로 답인
 *        물음이다(ssh_root ×2 · ips_오탐 · kev_bod · epss_vs_vpr). ops-sim 152상황·고객 QA
 *        시험지는 코드가 아니라 하네스·운영 문서에 있어 이 셈에 안 들어간다 — 옛 판의 「436문」은
 *        재현 장치가 없어 버렸다.
 *      ⚠ 라틴 매칭은 여전히 **낱말 경계를 안 본다**(`q.includes(t)`). 경계를 넣는 안을 실측으로
 *        검토하고 **기각**했다: q는 공백을 지운 문자열이라 낱말 경계가 원리상 없다 — 경계 규칙을
 *        걸면 「SSH root 직접 로그인…」·「리눅스 SSH root 원격…」·「outbound 445 급증…」처럼
 *        **맞는 지목 3건이 죽는다**(재현기의 「경계 스침」 4건 중 3건이 그것이다). 실측 오지목은
 *        0이고 스침 위험은 성립 조건이 막는다. 다시 만지려면 q의 공백 보존부터다.
 *   ② 숫자만인 토큰(2024)·유형어(매뉴얼·pdf…)는 뺀다. URL 지식화 문서는 통째로 제외한다.
 *   ③ **성립 조건**: 6자 이상 토큰 하나를 맞혔거나, 2개 이상을 맞히면서 **그중 3자 이상이
 *      하나라도 있거나 제목의 구별 토큰을 전부 맞혔을 때**.
 *      한 토큰만으로 성립시키면 「보안」 두 글자가 아무 질문에나 스친다. 실측(운영 코퍼스 48편 ·
 *      물음 386개 = evalgate 186 + ops-sim 152 + doc-probe): 옛 규칙을 내장까지 켜면 32건(8.3%)이
 *      지목이고, 이 규칙은 7건(1.8%)이며 그 7건은 전부 **그 문서가 실제로 답인** 물음이다
 *      (제로트러스트 3 · 랜섬웨어 대응 · 침해사고 대응절차 · Tenable 제품 · 장비 콘솔 메뉴맵).
 *      ★★ 2026-09-08 조임(검토관 [중]) — 「2개 이상」만으로는 **흔한 2자 토큰 둘**이 스쳤다.
 *      실측: 「금융권 보안 사고 터졌어 어떡해?」·「금융 보안 담당자 누구야?」가 둘 다
 *      `금융_AI_보안_가이드라인`을 지목했다(금융·보안 두 낱말이 스친 것뿐이다). 48편 가운데
 *      27편은 6자↑ 토큰이 아예 없어 **오로지 이 규칙으로만** 성립하므로 파괴력이 컸다.
 *      그래서 「맞힌 것 중 3자↑ 하나」를 함께 요구한다 — 제목에서 **구별을 하는 쪽**을 맞혀야
 *      이름을 댄 것이다. ⚠ 다만 구별 토큰이 모두 2자인 제목(운영 48편 중 `모델_선택` 하나)은
 *      **전부 맞히면** 성립시킨다 — 이름을 통째로 댔는데 못 잡는 것이 더 이상하다.
 *      실측 대가: 코퍼스 418문 중 지목이 25 → 24로 줄고, 잃은 것은 「장비 콘솔에서 로그는
 *      어디서 봐?」 하나뿐이다(장비·콘솔 둘 다 2자). 그 물음은 소재RE라 라우팅은 어차피 안 걸리고,
 *      잃는 것은 랭킹 부스트 +0.02 하나다 — 오탐 둘을 지우는 값으로 싸다.
 *
 * ⚠ 이 판정은 **벽이 아니라 올리기**다(applyDocScopeBoost). 하드 필터는 사람이 ☑로 고른
 *   currentDocIds뿐이라는 문서 스코프 계약을 그대로 지킨다 — 오탐이 나도 자료를 잃지 않는다.
 */
export function 제목지목매치(question: string, docIds: string[]): Set<string> {
  const q = String(question || "").toLowerCase().replace(/\s+/g, "");
  const out = new Set<string>();
  if (q.length < 3) return out;
  for (const id of docIds) {
    if (/^https?:/i.test(id)) continue;
    const base = id.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "").toLowerCase();
    const tokensRaw = base.split(/[ _\-.]+/).filter((t) => {
      if (!t || /^\d+$/.test(t) || DOCSCOPE_STOP.has(t)) return false;
      return t.length >= (/[가-힣]/.test(t) ? 2 : 3);
    });
    // ★ 2026-09-11 중복 제거 — 아니면 "any_any" 같은 반복 토큰이 한 낱말 스침만으로
    //   "2개 이상"을 혼자 채운다(아래 실측 IAM/any 반례).
    const tokens = [...new Set(tokensRaw)];
    const 맞힌것 = tokens.filter((t) => q.includes(t));
    if (맞힌것.some((t) => t.length >= 6)) { out.add(id); continue; }
    // 2개 이상 + (3자↑ 하나 | 제목의 구별 토큰을 전부) — 머리글 ③
    if (맞힌것.length >= 2 && (맞힌것.some((t) => t.length >= 3) || 맞힌것.length === tokens.length)) out.add(id);
  }
  return out;
}

/** 지목된 문서의 조각을 위로 올린다(rrf만·재정렬). applyOriginBoost와 같은 꼴 — 벽이 아니라 올리기. */
export function applyDocScopeBoost(chunks: FusedChunk[], scoped: Set<string>): FusedChunk[] {
  if (scoped.size === 0) return chunks;
  return chunks
    .map((c) => (scoped.has(c.documentId) ? { ...c, rrf: c.rrf + DOCSCOPE_BOOST } : c))
    .sort((a, b) => b.rrf - a.rrf);
}

// 에이전트(역할) → 그 전문가가 먼저 보는 업무영역. 화면 매핑과 별개다 —
// 화면은 "지금 보고 있는 곳", 역할은 "누가 답하는가"다.
// 2026-08-20 사장님 승인 ③: 「장비운영」의 주인을 지정 — 그동안 주인 없는 영역이라
// 장비 설정·점검 질문이 전문가 부스트를 못 받았다. 하드닝·장비 점검 해석은 스캔 해석과
// 같은 전문성이라 해석(scan)이 맡는다(값이 배열이 된 이유 — 단일값 Record라 두 번째
// 영역을 못 얹던 구조를 정찰이 지적).
export const ROLE_CATEGORY: Record<string, Category[]> = {
  scan: ["취약점", "장비운영"], // 스캔 해석 — 취약점·장비 점검 자료가 먼저
  analysis: ["취약점"],  // 우선순위 판단 — 같은 축
  ti: ["위협대응"],      // CTI·위협 모니터링
  report: ["사내규정"],  // 보고서 서식·보고 규정
  normaltic: ["일반"],   // 사내지식 해설 — 전 영역을 봐야 하므로 치우치지 않는다
  curator: [],           // 사서 — 문서 분류·요약·검색어 재작성은 전 영역을 고르게 봐야 한다(부스트 없음, 2026-09-03)
  bom: ["사내규정"],     // 부품표 — 라이선스 의무는 사내 규정(오픈소스·공급망 정책) 근거가 먼저(2026-09-03)
};

/** 그 역할이 먼저 볼 업무영역들. 없으면 빈 배열(부스트 없음 = 전 영역 평등). */
export function categoriesForRole(agentId?: string): Category[] {
  if (!agentId) return [];
  // 「일반」은 우선영역으로 쓰지 않는다 — 미분류를 밀어 올리면 진짜 자료가 밀린다.
  return (ROLE_CATEGORY[agentId] || []).filter((c) => c !== "일반");
}

/** 첫 우선영역 하나 — 지금 소비처는 시험뿐이다(제품 코드는 categoriesForRole 사용, 검토관 하4). */
export function categoryForRole(agentId?: string): Category | undefined {
  return categoriesForRole(agentId)[0];
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
  /** 질의의 약어가 이 조각에 낱말 그대로 있었나(B1) — 코드 히트(lexicalHit)보다 약한 신호다.
   *  없으면(undefined) 아니다로 본다. */
  acronymHit?: boolean;
}

// RRF(Reciprocal Rank Fusion) 상수. k=60은 원 논문(Cormack 2009)과 LanceDB·Elastic 기본값이다.
// 순위가 밀린 결과의 영향을 완만하게 줄여, 한쪽 검색이 크게 틀려도 다른 쪽이 회복시킨다.
export const RRF_K = 60;

/**
 * **재작성 질의의 랭킹 페널티**(2026-08-17). rewriteForSearch가 만든 변형은 recall을 넓히지만,
 * 뜻을 잃은 재작성이 엉뚱한 문서를 min-거리 융합으로 1위에 올리는 사고가 있었다.
 *
 * ■ 실측(doc-probe 유일 실패 1건): "이 제품으로 하루를 어떻게 시작해?"
 *     원문/정규화는 정답(실무매뉴얼·이렇게_쓰면·활용가이드)이 이긴다(거리 0.48~0.51).
 *     그런데 재작성이 "제품 사용 방법"으로 **의도어(하루·시작)를 버리고 '제품'만 남겨**,
 *     제품(46회) 문서인 보안제품관리_지침에 0.449로 가장 가까워졌다. min-거리 융합이 그 0.449를
 *     그 문서 점수로 삼아 정답 위로 올렸다 — 라이브 랭킹 1위가 보안제품관리였다.
 *
 * ■ 왜 페널티인가 — min-합집합은 recall만 늘리고 **정밀도 방어가 없다**(원문의 좋은 거리는
 *   지켜지지만, 나쁜 재작성의 낮은 거리가 엉뚱한 문서에 그대로 붙는다). 재작성을 원문/정규화보다
 *   조금 불리하게 둬 **재작성이 확실히 더 나을 때만(≥이 값) 순위를 바꾸게** 한다.
 *
 * ■ 왜 0.05인가(실측 스윕) — 목표 질문은 0.03부터 정답이 1위로 돌아오고, 큰 재작성 이득은
 *   그대로 산다: "IPS 오탐 튜닝"(미검색→0.508)·"KEV 조치 기한"(0.840→0.633)처럼 0.2대 개선은
 *   0.05로 못 지운다. 0.05는 **근소한 오염만** 걸러내는 보수적 문턱이다(정상 6종 질문 회귀 없음).
 *
 * ■ ⚠ **랭킹에만 쓴다.** 관련성 게이트(거리 임계값)·근거 세기 배지에는 진짜 최소거리를 쓴다 —
 *   약한 근거를 인위로 강등하면 "직접 자료 못 찾음" 판정이 어긋난다(queryMemoryGraded 참고).
 */
export const REWRITE_RANK_PENALTY = ((): number => {
  // ⚠ Number(env ?? 0.05)로 두면 오타("abc")가 NaN이 되고, rankDistance=거리+NaN → 정렬이
  //   조용히 뒤엉킨다(재작성으로 잡힌 조각들의 순서 오염). 조용한 실패를 막는다:
  //   미설정·빈값·비수치·음수는 기본 0.05로, 명시적 0(끄기)만 허용한다.
  const raw = process.env.GIJO_SEARCH_REWRITE_PENALTY?.trim();
  if (!raw) return 0.05;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 0.05;
})();

/** 한 질의 변형의 벡터 후보 하나. */
export interface VariantHit {
  text: string;
  documentId: string;
  distance: number;
  category?: string;
}

/**
 * **여러 질의 변형(원문·정규화·재작성)의 벡터 후보를 조각 단위로 합친다.**
 *
 * 조각마다 두 거리를 낸다:
 *   · distance     — 변형 전체의 **진짜 최소거리**. 관련성 게이트·근거 세기 배지가 쓴다(페널티 없음).
 *   · 랭킹거리(속) — 변형별 (거리 + 페널티)의 최소. **순위**에만 쓰고 결과엔 안 남긴다.
 *
 * 반환은 **랭킹거리 오름차순**이되 각 항목의 distance 칸은 진짜 최소거리다 — 그래서 뒤의
 * fuseResults(RRF)는 이 순서를 순위 신호로 쓰고, isRelevant는 오염되지 않은 거리로 판정한다.
 *
 * 왜 페널티인가 — 재작성 변형은 recall을 넓히지만 뜻을 잃으면 엉뚱한 문서를 min-거리로 1위에
 * 올린다(REWRITE_RANK_PENALTY 주석의 실측). 원문/정규화는 penalty=0, 재작성만 > 0을 줘
 * **재작성이 확실히 더 나을 때만** 순위를 바꾸게 한다.
 */
export function fuseVariantVectors(variants: { hits: VariantHit[]; penalty: number }[]): VariantHit[] {
  const byKey = new Map<string, { hit: VariantHit; rank: number }>();
  for (const { hits, penalty } of variants) {
    for (const h of hits) {
      const key = JSON.stringify([h.documentId, h.text]); // (문서, 조각) 쌍 — 충돌 없는 키
      const rank = h.distance + penalty; // 순위용 거리
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, { hit: { ...h }, rank });
      else {
        if (h.distance < prev.hit.distance) prev.hit.distance = h.distance; // 게이트가 볼 진짜 최소거리
        if (rank < prev.rank) prev.rank = rank; // 순위는 페널티 반영
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.rank - b.rank).map((v) => v.hit);
}

/** 같은 조각을 (documentId, text) 기준으로 합치고 RRF로 순위를 낸다. */
export function fuseResults(input: FusionInput, codes: string[], acronyms: string[] = []): FusedChunk[] {
  const byKey = new Map<string, FusedChunk>();
  const keyOf = (documentId: string, text: string) => `${documentId}\u0000${text}`;

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
        acronymHit: hasExactAcronym(r.text, acronyms),
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
        acronymHit: hasExactAcronym(r.text, acronyms),
        rrf,
        ...(r.category ? { category: r.category } : {}),
      });
  });

  return [...byKey.values()].sort((a, b) => b.rrf - a.rrf);
}

/**
 * 관련성 게이트. 잣대는 이 함수 한 곳 — 세 갈래(2026-09-11 B1 홑 약어 정의 물음 확장):
 *   ① 벡터 거리 임계값을 통과했거나
 *   ② 질의의 코드가 조각에 실제로 있거나(lexicalHit)
 *   ③ 질의의 약어가 조각에 실제로 있고(acronymHit) 거리가 ACRONYM_MAX_DISTANCE 안일 때.
 * ③이 거리 상한을 요구하는 이유 — fuseResults가 distance=Infinity로 남기는 BM25 전용 조각을
 *   원리상 배제한다(2026-07-19 잡음 주입 계약 유지 — 벡터 후보에 없던 조각은 약어만으로 못 산다).
 * 코드도 약어도 없이 렉시컬로만 걸린 조각(영문 낱말만 스친 경우)은 근거로 쓰지 않는다 —
 *   벡터가 무관하다고 판정한 것을 BM25 순위만으로 되살리면 잡음 주입이 다시 열린다.
 *
 * ⚠ 인자 타입은 FusedChunk 전체가 아니라 **부분집합**이다 — actioncheck.ts·verifyrag.ts의
 *   ScoredChunk(memory.ts)도 캐스트 없이 이 게이트를 그대로 써야, 잣대가 세 벌로 안 갈린다.
 *   상한 상수를 인자로 받지 않는 이유도 같다 — 호출부마다 다른 값을 넣으면 잣대가 다시 갈라진다.
 */
export function isRelevant(
  chunk: { distance: number; lexicalHit?: boolean; acronymHit?: boolean },
  maxDistance: number,
): boolean {
  return (
    chunk.distance <= maxDistance ||
    chunk.lexicalHit === true ||
    (chunk.acronymHit === true && chunk.distance <= ACRONYM_MAX_DISTANCE)
  );
}
