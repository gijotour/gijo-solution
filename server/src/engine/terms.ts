// engine/terms.ts — 같은 것을 가리키는 다른 말(동의어) 사전.
//
// 왜 필요한가(2026-07-26 실사용): 담당자가 "보안장비 리스트"라고 물었는데 제품 등록부에는
// "보안제품"이라고 써 있어 0건이 나왔고, 챗봇은 "존재하지 않습니다"라고 단정했다. 실제로는 3건이
// 있었다. 제품 안에서조차 두 말을 섞어 쓰고 있었으니(하드닝 쪽은 "보안장비", 등록부는 "보안제품")
// 사용자가 맞출 이유가 없다.
//
// 왜 코드인가: 7B 로컬 모델에 "비슷한 말도 알아들어라"라는 프롬프트 규칙을 더하는 방식은 이
// 프로젝트에서 반복적으로 실패했다(라우팅이 흔들리면 엉뚱한 조치를 실행할 수 있어 더 위험하다).
// 그래서 결정적인 사전으로 둔다. 자동 학습은 하지 않는다 — 되물음에서 담당자가 고른 말을
// 별칭 후보로 쌓아 사람이 승인하는 방향(승인카드 패턴)이 다음 단계다.

export interface TermAlias {
  canonical: string; // 제품이 실제로 쓰는 표준 말
  aliases: string[]; // 담당자가 쓸 법한 다른 말
  hint: string; // 되물음에 보여줄 문장("혹시 이걸 찾으시나요?")
}

export const TERM_ALIASES: TermAlias[] = [
  // ── 2026-08-02 업무 절차 개편에서 **이름이 바뀐 메뉴들** ────────────────────────
  // ⚠ 옛 이름을 반드시 남긴다. 담당자는 어제까지 쓰던 말로 묻는다 —
  //   "원격 정기점검 결과 알려줘"가 0건이 되면 이름을 바꾼 것이 곧 기능을 없앤 것이 된다.
  {
    canonical: "정기 점검",
    aliases: ["유지보수 점검", "제품 유지보수", "유지보수", "점검 일정", "정기점검"],
    hint: "정기 점검 — 보안장비·AI 자산의 점검 일정과 점검서 승인",
  },
  {
    canonical: "보안설정 점검",
    aliases: ["원격 정기점검", "원격 점검", "하드닝", "하드닝 점검", "CCE 점검"],
    hint: "보안설정 점검 — 장비에 접속해 보안설정이 기준에 맞는지 확인",
  },
  {
    canonical: "AI 지식",
    aliases: ["기억·학습", "기억 학습", "RAG", "지식베이스", "장기 기억", "온톨로지", "지식 관계도", "문서 관리"],
    hint: "AI 지식 — AI가 답할 때 근거로 쓰는 사내 문서와 관계",
  },
  {
    canonical: "AI 공격 시험·차단",
    aliases: ["레드팀", "레드팀·가드레일", "가드레일", "프롬프트 인젝션 점검"],
    hint: "AI 공격 시험·차단 — AI가 공격 문구에 얼마나 버티는지 재고, 실시간으로 막는다",
  },
  // (「모델 합치기」 항목은 2026-09-07에 뺐다 — 화면·API·안내 문서를 통째로 내려서 이 별칭이
  //  가리킬 곳이 없어졌다. 남겨 두면 「LLM 합성 알려줘」에 제품이 **없는 기능**을 되물어 권한다.)
  {
    canonical: "명령창",
    aliases: ["터미널", "CLI", "콘솔", "쉘", "셸"],
    hint: "명령창 — 담당자 PC에서 명령을 실행(승인·허용목록 적용)",
  },
  {
    canonical: "업무 넘기기",
    aliases: ["인수인계", "인계", "핸드오버"],
    hint: "업무 넘기기 — 담당자가 바뀔 때 지식·진행 상황을 넘긴다",
  },
  // ── 침해사고 히스토리(2026-09-03) — 도구 incident_cases·incident_sources의 되물음 안내 ────────
  // ⚠ 「사례」 홑말은 report.ts의 「취약점 사례」와 겹쳐 별칭에 넣지 않는다(설계 계약). 「히스토리」·「사고 사례」·「사례의 샘」만.
  {
    canonical: "침해사고 히스토리",
    aliases: ["히스토리", "사고 사례", "침해 사례", "침해사고 사례", "사고 히스토리", "사례의 샘"],
    hint: "침해사고 히스토리 — 국내외 실제 보안 사고 사례(쉬운 설명·교훈·출처)와 사례의 샘(소식 보는 곳)",
  },
  {
    canonical: "보안제품",
    aliases: ["보안장비", "보안 장비", "보안솔루션", "보안 솔루션", "보안기기", "보안 기기", "보안 어플라이언스", "보안장비류"],
    hint: "보안제품 목록 — 도입한 보안 솔루션 등록부",
  },
  {
    canonical: "자산",
    // 「자산 통합 뷰(자산 허브)」는 2026-08-02에 자산 목록으로 합쳤다 — 옛 이름으로 물어도
    // 알아듣게 남긴다(사내 문서·인수인계 메모에 옛 이름이 남아 있다).
    aliases: ["서버 목록", "장비 목록", "인프라 목록", "시스템 목록", "호스트 목록", "자산 통합 뷰", "자산통합뷰", "자산 허브", "자산허브"],
    hint: "자산 목록 — 서버·웹서비스 등 지키는 대상",
  },
  {
    canonical: "취약점",
    aliases: ["취약성", "보안 결함", "구멍", "허점"],
    hint: "취약점 — 스캐너가 찾아낸 보안 결함",
  },
  {
    canonical: "하드닝 점검",
    aliases: ["보안설정 점검", "보안 설정 점검", "설정 점검", "CCE 점검", "기준 점검"],
    hint: "하드닝 점검 — 장비 보안설정이 기준에 맞는지 확인",
  },
  {
    canonical: "사내문서",
    aliases: ["내부문서", "내부 문서", "사내 규정", "규정집", "내부 규정", "지침서"],
    hint: "사내문서 — 규정·지침·매뉴얼 등 올려둔 문서",
  },
  {
    canonical: "AI-BOM",
    aliases: ["AI 자산", "AI 명세", "AI BOM", "에이아이봄"],
    hint: "AI-BOM — AI 모델·데이터 출처·벡터DB 구성 명세",
  },
];

const norm = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

// 문장에 들어 있는 별칭을 표준 말로 바꾼다. 바뀐 게 없으면 원문 그대로 돌려준다.
export function canonicalize(text: string): string {
  let out = text;
  for (const g of TERM_ALIASES) {
    for (const a of g.aliases) {
      // 공백 유무를 가리지 않도록 별칭의 글자 사이에 공백을 허용하는 패턴으로 찾는다.
      const re = new RegExp(a.split("").map(escapeRe).join("\\s*"), "gi");
      out = out.replace(re, g.canonical);
    }
  }
  return out;
}

function escapeRe(c: string): string {
  return /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
}

// 이 문장이 어떤 별칭을 쓰고 있는지 — 되물음 후보를 만들 때 쓴다.
export function aliasHitsIn(text: string): TermAlias[] {
  const q = norm(text);
  return TERM_ALIASES.filter((g) => g.aliases.some((a) => q.includes(norm(a))));
}

// 못 찾았을 때 보여줄 후보. 별칭이 걸리면 그걸 우선하고, 없으면 표준 말이 스친 것으로 넓힌다.
export function suggestionsFor(text: string): TermAlias[] {
  const hits = aliasHitsIn(text);
  if (hits.length) return hits.slice(0, 3);
  const q = norm(text);
  return TERM_ALIASES.filter((g) => q.includes(norm(g.canonical))).slice(0, 2);
}
