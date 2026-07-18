// engine/cwe-seed.ts — CWE(공통 약점 목록) 온톨로지 시드.
// 소프트웨어 '약점 클래스' 축 — 인프라 취약점(Log4Shell·OpenSSH 등)이 어떤 약점 유형인지,
// 그리고 신설된 AI/LLM 약점(CWE-1427 프롬프트 인젝션·CWE-1426 GenAI 출력검증)이 OWASP와 어떻게
// 맞물리는지를 준다. 공개 표준(CWE Top 25 2024, CWE 4.15+)에 근거한 요약이며 지어낸 데이터가 아니다.

import type { TripleInput } from "./ontology";

export const CWE_SOURCE = "MITRE CWE (Top 25 2024 + AI 약점)";

// CWE Top 25 Most Dangerous Software Weaknesses (2024). subject="CWE-NNN Name".
const TOP25: { id: string; name: string; rank?: number }[] = [
  { id: "CWE-79", name: "크로스사이트 스크립팅(XSS)", rank: 1 },
  { id: "CWE-787", name: "경계 밖 쓰기(Out-of-bounds Write)", rank: 2 },
  { id: "CWE-89", name: "SQL 인젝션", rank: 3 },
  { id: "CWE-352", name: "크로스사이트 요청 위조(CSRF)" },
  { id: "CWE-22", name: "경로 조작(Path Traversal)" },
  { id: "CWE-125", name: "경계 밖 읽기(Out-of-bounds Read)" },
  { id: "CWE-78", name: "OS 명령 인젝션" },
  { id: "CWE-416", name: "Use After Free(해제 후 사용)" },
  { id: "CWE-862", name: "권한 검사 누락(Missing Authorization)" },
  { id: "CWE-434", name: "위험 파일 업로드 무제한 허용" },
  { id: "CWE-94", name: "코드 인젝션(Code Injection)" },
  { id: "CWE-20", name: "부적절한 입력 검증" },
  { id: "CWE-77", name: "명령 인젝션(Command Injection)" },
  { id: "CWE-287", name: "부적절한 인증" },
  { id: "CWE-269", name: "부적절한 권한 관리" },
  { id: "CWE-502", name: "신뢰할 수 없는 데이터 역직렬화(Deserialization)" },
  { id: "CWE-200", name: "민감정보 노출" },
  { id: "CWE-863", name: "부정확한 인가(Incorrect Authorization)" },
  { id: "CWE-918", name: "서버측 요청 위조(SSRF)" },
  { id: "CWE-119", name: "메모리 버퍼 경계 부적절 제한" },
  { id: "CWE-476", name: "NULL 포인터 역참조" },
  { id: "CWE-798", name: "하드코딩된 자격증명 사용" },
  { id: "CWE-190", name: "정수 오버플로우" },
  { id: "CWE-400", name: "무제한 자원 소비(Uncontrolled Resource Consumption)" },
  { id: "CWE-306", name: "핵심 기능 인증 누락" },
];

// 신설 AI/LLM 약점(CWE 4.15+). OWASP LLM Top 10 코드에 직접 연결한다.
const AI_CWE: { id: string; name: string; desc: string; owasp?: string; leadsTo?: string[] }[] = [
  {
    id: "CWE-1427",
    name: "LLM 프롬프트 입력의 부적절한 중화(Prompt Injection)",
    desc: "외부 입력으로 프롬프트를 구성할 때 사용자 입력과 시스템 지시를 LLM이 구분하지 못해 악성 지시가 실행됨.",
    owasp: "LLM01:2025 Prompt Injection",
  },
  {
    id: "CWE-1426",
    name: "생성형 AI 출력의 부적절한 검증(Improper Validation of GenAI Output)",
    desc: "생성형 AI 컴포넌트의 출력을 검증하지 않아 오류·편향·악성 요소가 그대로 후속 처리됨.",
    owasp: "LLM05:2025 Improper Output Handling",
    leadsTo: ["CWE-89", "CWE-94", "CWE-22"], // 검증 실패 → 전통 인젝션 약점(바 코드로 CWE 노드에 연결)
  },
];

// Top 25 중 OWASP LLM 위험과 직접 대응되는 것(그래프 접착).
const CWE_TO_OWASP: Record<string, string> = {
  "CWE-400": "LLM10:2025 Unbounded Consumption",
  "CWE-200": "LLM02:2025 Sensitive Information Disclosure",
  "CWE-502": "LLM03:2025 Supply Chain",
};

// subject를 바 코드("CWE-79")로 둔다 — 기존 데이터가 CWE를 참조하지 않으므로 "{code} {name}"이 아니라
// 코드 자체를 노드로 해야 "CWE-79 뭐야?" 질의가 시드 매칭된다(expandOntology는 엔티티가 질의문의
// 부분문자열일 때 걸림). 이름은 명칭 트리플로 붙인다.
export function cweTriples(): TripleInput[] {
  const out: TripleInput[] = [];
  const push = (subject: string, predicate: string, object: string) => out.push({ subject, predicate, object, source: CWE_SOURCE });

  for (const w of TOP25) {
    push(w.id, "명칭", w.name);
    push(w.id, "유형", "CWE Top 25 위험 약점(2024)");
    if (w.rank) push(w.id, "순위", `2024 CWE Top 25 #${w.rank}`);
    const owasp = CWE_TO_OWASP[w.id];
    if (owasp) push(w.id, "관련", owasp);
  }
  for (const w of AI_CWE) {
    push(w.id, "명칭", w.name);
    push(w.id, "유형", "AI/LLM 약점(CWE)");
    push(w.id, "설명", w.desc);
    if (w.owasp) push(w.id, "관련", w.owasp); // OWASP 노드로 연결 → 전 표준 그래프에 붙음
    for (const lt of w.leadsTo ?? []) push(w.id, "유발가능", lt);
  }
  return out;
}
