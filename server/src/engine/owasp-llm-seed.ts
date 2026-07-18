// engine/owasp-llm-seed.ts — OWASP Top 10 for LLM Applications (2025) 온톨로지 시드.
// LLM 보안의 사실상 표준 목록. 기존 KISA 위협이 이미 OWASP 코드("LLM01:2025 Prompt Injection")를
// 참조하므로, 같은 형식의 OWASP 노드를 두면 KISA 위협 ↔ OWASP 그래프가 코드로 자동 연결된다.
// 각 항목은 공개 표준(OWASP LLM Top 10 2025)에 근거한 요약이며, 지어낸 데이터가 아니다.

import type { TripleInput } from "./ontology";

export const OWASP_SOURCE = "OWASP Top 10 for LLM Applications (2025)";

// subject는 KISA compliance.ts의 owasp 필드와 글자 그대로 일치("LLMxx:2025 Name").
interface OwaspRisk {
  subject: string;
  desc: string;
  area: string[]; // 영향 AI-BOM 영역(모델/데이터셋/프롬프트/에이전트 도구/인프라)
  mitigations: string[];
}

export const OWASP_LLM_2025: OwaspRisk[] = [
  { subject: "LLM01:2025 Prompt Injection", desc: "사용자·외부 입력이 LLM 프롬프트를 조작해 의도치 않은 동작을 유발(직접·간접 인젝션).", area: ["프롬프트"], mitigations: ["입력·출력 검증 및 정제", "모델 권한 최소화(least privilege)", "신뢰 경계 분리·외부 콘텐츠 격리", "민감 작업은 사람 승인(human-in-the-loop)"] },
  { subject: "LLM02:2025 Sensitive Information Disclosure", desc: "개인정보·자격증명·독점 정보가 모델 출력으로 유출.", area: ["데이터셋", "프롬프트"], mitigations: ["학습·컨텍스트 데이터 정제·마스킹", "출력 필터링·DLP", "최소 데이터 원칙·접근통제"] },
  { subject: "LLM03:2025 Supply Chain", desc: "서드파티 모델·데이터·라이브러리·플러그인의 취약·변조로 인한 공급망 위험.", area: ["인프라", "모델"], mitigations: ["출처·서명 검증", "SBOM/AI-BOM 관리·취약점 스캔", "신뢰된 소스만 사용"] },
  { subject: "LLM04:2025 Data and Model Poisoning", desc: "학습·미세조정·임베딩 데이터 오염으로 백도어·편향 주입.", area: ["데이터셋", "모델"], mitigations: ["데이터 출처 추적·무결성 검증", "이상탐지·데이터 품질 검증", "적대적 테스트(레드팀)"] },
  { subject: "LLM05:2025 Improper Output Handling", desc: "LLM 출력을 검증 없이 후속 시스템에 전달해 XSS·SSRF·RCE·권한상승 유발.", area: ["에이전트 도구"], mitigations: ["출력 검증·인코딩", "컨텍스트별 이스케이프", "후속 시스템 제로트러스트 처리"] },
  { subject: "LLM06:2025 Excessive Agency", desc: "LLM·에이전트에 과도한 기능·권한·자율성을 부여해 오남용 위험.", area: ["에이전트 도구"], mitigations: ["기능·권한·자율성 최소화", "민감 행동은 사람 승인", "행동 감사 로그"] },
  { subject: "LLM07:2025 System Prompt Leakage", desc: "시스템 프롬프트의 비밀·규칙이 노출돼 우회·공격에 악용.", area: ["프롬프트"], mitigations: ["시스템 프롬프트에 비밀 미포함", "외부 가드레일로 규칙 강제", "권한·역할 분리"] },
  { subject: "LLM08:2025 Vector and Embedding Weaknesses", desc: "RAG 벡터·임베딩의 주입·유출·교차오염(다중 테넌트 등).", area: ["데이터셋", "인프라"], mitigations: ["벡터 접근통제·데이터 분할", "임베딩 출처 태깅·검증", "인덱싱 입력 검증"] },
  { subject: "LLM09:2025 Misinformation", desc: "환각·부정확 정보를 사실처럼 제시해 잘못된 의사결정 유발.", area: ["모델", "프롬프트"], mitigations: ["RAG 그라운딩·출처 표기", "사람 검토·신뢰도 표시", "중요 출력 교차검증"] },
  { subject: "LLM10:2025 Unbounded Consumption", desc: "무제한 자원 소비로 서비스 거부(DoS)·비용 폭증·모델 추출.", area: ["인프라"], mitigations: ["속도 제한·쿼터", "입력 크기·복잡도 제한", "사용량·이상 모니터링"] },
  { subject: "LLM10:2023 Model Theft", desc: "(레거시) 독점 모델의 무단 추출·복제.", area: ["모델"], mitigations: ["접근통제·속도 제한", "쿼리 모니터링", "모델 워터마킹"] },
];

export function owaspLlmTriples(): TripleInput[] {
  const out: TripleInput[] = [];
  const push = (subject: string, predicate: string, object: string) => out.push({ subject, predicate, object, source: OWASP_SOURCE });
  for (const r of OWASP_LLM_2025) {
    push(r.subject, "유형", "OWASP LLM Top 10 (2025)");
    push(r.subject, "설명", r.desc);
    for (const a of r.area) push(r.subject, "영향영역", a);
    for (const m of r.mitigations) push(r.subject, "완화통제", m);
  }
  return out;
}
