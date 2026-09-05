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

// ── 도메인 뜻 — **같은 낱말, 다른 뜻** (2026-09-06 신설) ──────────────────────
//
// ■ 무엇을 막나 (2026-09-06 운영 실측)
//   「클릭률 낮추는 법」에 제품이 웹 마케팅 조언을 냈다("목적을 명확히 설정해야 합니다 …").
//   「응답률 올리는 법」도 마찬가지였다("질문이 명확하고 간결하면 응답률이 높아집니다").
//   이 제품에서 클릭률·열람률·전환율·참여율·이수율·응답률은 전부 **피싱 모의훈련·보안 교육**의
//   지표인데, 모델이 학습한 세상에서 그 낱말의 주인은 웹 마케팅이다. 낱말이 같아서 조용히 샌다 —
//   틀린 답이 아니라 **딴 제품의 답**이 나가므로 담당자는 「이 챗봇은 보안을 모른다」고 읽는다.
//
// ■ 왜 위 GLOSSARY에 안 넣고 표를 따로 두나 (설계관 결정 · 셋 다 실측 근거가 있다)
//   ① GLOSSARY는 explainHardTerms가 **답변 뒤 풀이**로도 쓴다. 「교육」·「클릭률」처럼 흔한
//      낱말을 그 표에 넣으면 보안 답마다 풀이가 붙어 잡음이 된다(어려운 용어 풀이가 목적인 표다).
//   ② 그라운딩은 GROUNDING_MAX=4로 자른다. 같은 표에 섞으면 CVE·KEV 같은 **약자 오개념 교정**
//      (이 표의 존재 이유)이 도메인 뜻에 밀려 사라진다 — 있던 방어가 새 방어에 눌리는 꼴이다.
//   ③ 매칭 규칙이 다르다. GLOSSARY의 ASCII 약어는 단어 경계로 보지만, 여기는 전부 한글이라
//      부분일치가 맞다. 한 표에 두면 mentions()가 두 규칙을 겸해야 해서 둘 다 흐려진다.
//   → 표를 갈라 두고, 그라운딩에서 기존 4줄 **뒤에** 최대 2줄만 덧붙인다(아래 DOMAIN_SENSE_MAX).
//
// ⚠ 적는 법: **뜻만** 적는다. 「몇 %인가」는 여기 적지 않는다 — 값은 kpi_status가 세고,
//   안 세는 지표는 「아직 집계하지 않습니다」가 정답이다(2026-09-06 「82.3%」 사고의 교훈).
// ⚠ 늘릴 때는 **낱말이 겹치는지** 먼저 본다. 이 표의 열쇠는 부분일치라 짧은 낱말을 넣으면
//   남의 말 속에서 걸린다(agentloop scopeguard가 「전**환율**」을 「환율」로 읽은 것과 같은 함정).
export const DOMAIN_SENSE: Record<string, string> = {
  "클릭률": "피싱 모의훈련에서 훈련 메일의 링크를 누른 대상자 비율(낮을수록 좋다). 웹 광고·마케팅의 클릭률(CTR)이 아닙니다.",
  "열람률": "피싱 모의훈련 메일을 열어 본 대상자 비율, 또는 보안 공지·정책 문서를 읽은 대상자 비율. 마케팅 메일 오픈율이 아닙니다.",
  "전환율": "피싱 모의훈련에서 링크 클릭을 넘어 계정·비밀번호까지 입력한 대상자 비율. 웹 마케팅의 구매·가입 전환율이 아닙니다.",
  "참여율": "보안 교육·모의훈련 대상자 중 실제로 참여한 비율. 캠페인·이벤트 참여율이 아닙니다.",
  "이수율": "보안 교육 대상자 중 과정을 끝까지 마친 비율(참여는 시작, 이수는 완료 — 두 수는 다르다).",
  "응답률": "보안 점검·설문·확인 요청에 담당자가 회신한 비율(예: 자산 담당자 확인 요청, 교육 사전 설문).",
};

// 도메인 뜻은 **최대 2줄**만 덧붙인다. 위 4줄(약자 교정)과 합쳐 6줄 — 그 이상은 프롬프트가
// 길어져 규칙 복창이 늘어난다(이 파일 머리글의 실측 계보와 같은 이유).
const DOMAIN_SENSE_MAX = 2;

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
  // ★ 도메인 뜻은 **기존 4줄 뒤에** 따로 붙인다(2026-09-06) — 위 DOMAIN_SENSE 머리글 참고.
  //   열쇠가 전부 한글이라 부분일치로 찾는다(mentions의 ASCII 단어경계 갈래는 여기 필요 없다).
  const 도메인 = Object.keys(DOMAIN_SENSE)
    .filter((t) => question.includes(t))
    .slice(0, DOMAIN_SENSE_MAX);
  if (found.length === 0 && 도메인.length === 0) return null;
  const 줄: string[] = [];
  if (found.length) {
    줄.push(
      "확정 용어 정의 — 아래 정의가 정답입니다. 용어를 설명할 때 이와 다르게 말하지 마세요(약자 풀이를 지어내지 마세요).",
      ...found.map((t) => `- ${t}: ${GLOSSARY[t]}`),
    );
  }
  if (도메인.length) {
    if (줄.length) 줄.push("");
    줄.push(
      "이 제품에서의 뜻 — 아래 낱말은 **사내 보안 업무**의 지표입니다. 다른 분야의 같은 이름 지표로 바꿔 읽지 말고, 이 뜻으로 답하세요.",
      ...도메인.map((t) => `- ${t}: ${DOMAIN_SENSE[t]}`),
    );
  }
  return 줄.join("\n");
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
