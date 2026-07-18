// engine/nist-airmf-seed.ts — NIST AI RMF 1.0 + Generative AI Profile(NIST AI 600-1) 온톨로지 시드.
// 거버넌스 축: 위협 목록(ATLAS·OWASP)이 "무엇이 위험한가"라면, NIST AI RMF는 "조직이 리스크를
// 어떻게 관리하는가"(GOVERN/MAP/MEASURE/MANAGE)와 "무엇을 신뢰라 하는가"(신뢰 AI 특성)를 준다.
// GenAI 위험(AI 600-1)은 OWASP 코드에 교차 연결해 기존 그래프(OWASP↔KISA↔ATLAS)에 붙인다.
// 공개 표준(NIST AI RMF 1.0, AI 600-1)에 근거한 요약이며 지어낸 데이터가 아니다.

import type { TripleInput } from "./ontology";

export const NIST_SOURCE = "NIST AI RMF 1.0 + GenAI Profile(AI 600-1)";

const ROOT = "NIST AI RMF";

// 핵심 4기능
const FUNCTIONS: { name: string; purpose: string }[] = [
  { name: "GOVERN (거버넌스)", purpose: "AI 리스크 관리 문화·정책·역할·책임을 조직 전반에 수립·유지한다(다른 3기능을 관통)." },
  { name: "MAP (맥락 파악)", purpose: "AI 시스템의 맥락·용도·이해관계자·영향을 식별하고 리스크를 프레이밍한다." },
  { name: "MEASURE (측정)", purpose: "식별된 리스크를 정량·정성 지표로 분석·평가·추적한다." },
  { name: "MANAGE (관리)", purpose: "리스크에 우선순위를 매겨 대응·모니터링·개선하고 자원을 배분한다." },
];

// 신뢰할 수 있는 AI 7대 특성
const CHARACTERISTICS = [
  "유효성·신뢰성(Valid & Reliable)",
  "안전성(Safe)",
  "보안성·복원력(Secure & Resilient)",
  "책임성·투명성(Accountable & Transparent)",
  "설명가능성·해석가능성(Explainable & Interpretable)",
  "프라이버시 강화(Privacy-Enhanced)",
  "공정성·유해편향 관리(Fair with Harmful Bias Managed)",
];

// GenAI Profile(AI 600-1) 12대 위험 — 가능한 것은 OWASP LLM Top 10 코드에 교차 연결(그래프 접착).
const GENAI_RISKS: { name: string; desc: string; owasp?: string; area?: string[] }[] = [
  { name: "CBRN 정보·능력", desc: "화학·생물·방사능·핵 관련 위험 정보·능력 접근을 낮춤." },
  { name: "환각(Confabulation)", desc: "사실이 아닌 내용을 자신 있게 생성.", owasp: "LLM09:2025 Misinformation", area: ["모델"] },
  { name: "위험·폭력·혐오 콘텐츠", desc: "위험하거나 폭력적·혐오적인 콘텐츠 생성." },
  { name: "데이터 프라이버시", desc: "개인정보·민감정보의 학습·추론 중 유출.", owasp: "LLM02:2025 Sensitive Information Disclosure", area: ["데이터셋"] },
  { name: "환경 영향", desc: "대규모 학습·추론의 에너지·탄소 비용." },
  { name: "유해 편향·동질화", desc: "차별적 편향 또는 획일화된 출력.", area: ["데이터셋", "모델"] },
  { name: "인간-AI 상호작용 오구성", desc: "과신·자동화 편향·부적절한 권한 위임.", owasp: "LLM06:2025 Excessive Agency", area: ["에이전트 도구"] },
  { name: "정보 무결성", desc: "허위·조작 정보의 대량 생성·확산.", owasp: "LLM09:2025 Misinformation" },
  { name: "정보 보안", desc: "프롬프트 인젝션·유출 등 AI 시스템 보안 위협.", owasp: "LLM01:2025 Prompt Injection", area: ["프롬프트"] },
  { name: "지식재산", desc: "저작물·독점 모델의 무단 사용·추출.", owasp: "LLM10:2023 Model Theft", area: ["모델"] },
  { name: "음란·비하·학대 콘텐츠", desc: "음란하거나 인간을 비하·학대하는 콘텐츠." },
  { name: "가치사슬·컴포넌트 통합", desc: "서드파티 데이터·모델·도구 통합의 공급망 위험.", owasp: "LLM03:2025 Supply Chain", area: ["인프라", "모델"] },
];

export function nistAiRmfTriples(): TripleInput[] {
  const out: TripleInput[] = [];
  const push = (subject: string, predicate: string, object: string) => out.push({ subject, predicate, object, source: NIST_SOURCE });

  for (const f of FUNCTIONS) {
    push(ROOT, "기능", f.name);
    push(f.name, "목적", f.purpose);
    push(f.name, "유형", "NIST AI RMF 핵심 기능");
  }
  for (const c of CHARACTERISTICS) push(ROOT, "신뢰속성", c);

  for (const r of GENAI_RISKS) {
    push(r.name, "유형", "NIST GenAI 위험(AI 600-1)");
    push(r.name, "설명", r.desc);
    if (r.owasp) push(r.name, "관련", r.owasp); // OWASP 노드로 연결 → OWASP↔KISA↔ATLAS 그래프에 붙음
    for (const a of r.area ?? []) push(r.name, "영향영역", a);
  }
  return out;
}
