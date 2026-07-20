// glossary.ts — 챗봇/LLM 답변 쉬운 용어 풀이 후처리.
//
// 목적: 1인 보안담당자가 답변을 쉽게 이해하도록, 답변에 등장한 어려운 보안·AI 용어를 감지해
//       끝에 "🔎 쉬운 용어 풀이"를 자동으로 붙인다.
// 왜 코드 후처리인가: 시스템 프롬프트에 "쉽게 설명하라" 규칙만 더하는 방식은 7B 로컬 모델에서
//       잘 안 지켜진다(실측 다수 — persona 규칙 무시). 그래서 결정적(deterministic) 후처리로
//       확실히 붙인다. 프롬프트 유도(systemPromptFor)는 보조로만 둔다.
// 끄기: GIJO_GLOSSARY_EXPLAIN=0 (기본 on). 최대 개수: GIJO_GLOSSARY_MAX(기본 6).

// 자주 나오는 보안·AI 용어 → 한 줄 쉬운 풀이. 위에 있을수록 우선 노출(최대 개수 초과 시 뒤는 생략).
export const GLOSSARY: Record<string, string> = {
  "RCE": "Remote Code Execution(원격 코드 실행) — 공격자가 원격에서 시스템 명령을 실행할 수 있는 가장 위험한 취약점.",
  "CVE": "Common Vulnerabilities and Exposures — 공개적으로 등록된 보안 취약점의 고유 번호(예: CVE-2021-44228).",
  "CVSS": "Common Vulnerability Scoring System — 취약점 위험도를 0~10점으로 매긴 국제 표준 점수(높을수록 위험).",
  "KEV": "Known Exploited Vulnerabilities — 실제 공격에 악용된 것으로 확인된 취약점 목록(미국 CISA가 관리).",
  "EPSS": "Exploit Prediction Scoring System — 그 취약점이 앞으로 실제 악용될 확률을 예측한 점수.",
  "제로데이": "아직 패치(수정)가 없는, 막 알려진 취약점.",
  "프롬프트 인젝션": "AI에게 악의적 지시를 몰래 끼워 넣어 원래 규칙을 무시하게 만드는 공격.",
  "RAG": "검색 증강 생성 — AI가 사내 문서를 찾아 참고한 뒤 답하는 방식.",
  "LLM": "대규모 언어 모델 — ChatGPT 같은 생성형 AI 모델.",
  "SBOM": "Software Bill of Materials(소프트웨어 구성 명세서) — 제품에 들어간 부품(라이브러리) 목록.",
  "AI-BOM": "AI 구성 명세서 — AI 모델·학습데이터·구성요소 목록.",
  "SSRF": "Server-Side Request Forgery — 서버가 공격자의 지시대로 내부 시스템에 대신 요청을 보내게 만드는 취약점.",
  "XSS": "Cross-Site Scripting — 웹페이지에 악성 스크립트를 심어 다른 사용자 브라우저에서 실행시키는 공격.",
  "SQL 인젝션": "입력값으로 데이터베이스 질의를 조작해 정보를 빼내는 공격.",
  "IOC": "Indicator of Compromise(침해 지표) — 공격의 흔적(악성 IP·파일 해시·도메인 등).",
  "CTI": "사이버 위협 인텔리전스 — 위협 정보를 수집·분석하는 것.",
  "SIEM": "Security Information and Event Management — 여러 보안 로그를 한곳에 모아 상관분석하는 시스템.",
  "EDR": "Endpoint Detection and Response — PC·서버 단말의 이상행위를 탐지·대응하는 솔루션.",
  "SLA": "서비스 수준 협약 — 조치 기한 같은 지켜야 할 약속.",
  "MITRE ATT&CK": "공격 기법을 체계적으로 분류한 국제 표준 지식체계.",
  "OWASP": "웹·AI 보안 취약점 표준을 정리하는 국제 단체(예: OWASP Top 10).",
  "하드닝": "시스템 설정을 강화해 공격 표면(뚫릴 틈)을 줄이는 보안 작업.",
  "egress": "조직 내부에서 외부로 나가는 데이터·통신(외부 유출 경로).",
  "MCP": "AI를 외부 도구·데이터에 연결하는 표준 규약(Model Context Protocol).",
  "페이로드": "공격에 실제로 사용되는 데이터나 코드 조각.",
};

const MAX_TERMS = Number(process.env.GIJO_GLOSSARY_MAX ?? 6);
function enabled(): boolean {
  const v = (process.env.GIJO_GLOSSARY_EXPLAIN ?? "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

// ASCII 약어는 단어 경계로(다른 단어 속 매칭 방지), 한글/특수문자 포함 용어는 부분일치로 찾는다.
function mentions(term: string, text: string): boolean {
  if (/^[\x20-\x7e]+$/.test(term)) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, "i").test(text);
  }
  return text.includes(term);
}

// 질문에 나온 용어의 **확정 정의**를 시스템 프롬프트에 근거로 주입한다.
//
// 왜 필요한가(실측 2026-07-20): 7B 모델이 "KEV는 Common Vulnerabilities and Exposures의 약자"라고
// 답했다 — KEV(CISA 악용 확인 목록)와 CVE(취약점 식별자)를 뒤섞은 것으로, 3회 질의에 3회 모두
// 똑같이 틀렸다. 확률적 흔들림이 아니라 모델에 굳은 오개념이라 재생성으로는 고쳐지지 않는다.
//
// 답변 뒤에 붙는 풀이(explainHardTerms)는 이미 정확했지만 본문의 틀린 설명은 그대로 남았다.
// 같은 사전을 답변 '뒤'가 아니라 추론 '앞'에도 놓아, 모델이 지어내는 대신 베끼게 한다.
// 질문에 등장한 용어만 넣는다 — 프롬프트가 길어질수록 규칙 복창이 늘기 때문(실측 다수).
const GROUNDING_MAX = 4;

export function glossaryGroundingFor(question: string): string | null {
  if (!enabled() || !question) return null;
  const found = Object.keys(GLOSSARY)
    .filter((t) => mentions(t, question))
    .slice(0, GROUNDING_MAX);
  if (found.length === 0) return null;
  return [
    "확정 용어 정의 — 아래 정의가 정답입니다. 용어를 설명할 때 이와 다르게 말하지 마세요(약자 풀이를 지어내지 마세요).",
    ...found.map((t) => `- ${t}: ${GLOSSARY[t]}`),
  ].join("\n");
}

// 답변에 등장한 어려운 용어의 쉬운 풀이를 끝에 붙여 돌려준다(없으면 원문 그대로).
export function explainHardTerms(text: string): string {
  if (!enabled() || !text || text.includes("🔎 쉬운 용어 풀이")) return text;
  const found: string[] = [];
  for (const term of Object.keys(GLOSSARY)) {
    if (found.length >= MAX_TERMS) break;
    if (mentions(term, text)) found.push(term);
  }
  if (found.length === 0) return text;
  const lines = found.map((t) => `- **${t}**: ${GLOSSARY[t]}`).join("\n");
  return `${text}\n\n🔎 쉬운 용어 풀이\n${lines}`;
}
