// engine/agentloop.ts — 오케스트레이터 에이전트 루프 (지시 → 도구 선택 → 실행 → 최종 답변)
//
// 흐름(ReAct 단일 스텝 반복, 계획서 §4 Phase 1):
//   ① LLM에 도구 목록 + 지시 + 지금까지의 실행 결과를 주고 "다음 행동" JSON을 받는다
//      (llama.cpp json_schema 강제 — 형식 오류 클래스가 없다. 실측 벤치 10/10 근거).
//   ② action=tool 이면 규칙 검증(validateToolArgs) 후 실행하고 결과를 다음 결정에 재주입.
//   ③ action=final 이거나 반복 상한이면 종료. 도구를 1개 이상 썼으면 최종 답변은 일반 chat
//      경로로 재작성한다 — NO_HAN 문법·서두 제거·이력 기록(학습루프 수집)을 그대로 받기 위해.
//
// 폴백 계약: 이 루프는 실패하거나 할 일이 없으면 null을 돌려주고, 호출자(dispatcher)가 기존
// 채팅 경로로 폴백한다. 즉 루프 도입으로 기존 동작이 나빠지는 회귀가 없다.

import { chat } from "./llm";
import { listAgentTools, listToolsFor, findAgentTool, toolCatalogText, validateToolArgs, buildApproval, PendingApproval, NO_HIT_PREFIX } from "./agenttools";
import { emitCollaboration } from "./collaboration";
import { listProducts } from "./securityproducts";

const MAX_STEPS = 5;

// #8 대화 맥락 — 직전에 다룬 취약점을 기억해 "아까 그거 이영희로 바꿔" 같은 후속을 해석한다.
// 1인 운영 전제라 전역 1건으로 충분(TTL 10분 지나면 무시). 쓰기 대상이 잡힐 때 갱신한다.
interface LastTarget { assetId: string; finding: string; label: string; at: number }
let lastTarget: LastTarget | null = null;
const TARGET_TTL_MS = 10 * 60 * 1000;
const ANAPHORA_RE = /아까|방금|그거|그것|이거|이것|저거|그\s*취약점|위\s*취약점|같은\s*(거|취약점)|그\s*건|이\s*건/;

export function setLastTarget(assetId: string, finding: string, label: string): void {
  if (assetId && finding) lastTarget = { assetId, finding, label, at: Date.now() };
}
function recentTarget(): LastTarget | null {
  return lastTarget && Date.now() - lastTarget.at < TARGET_TTL_MS ? lastTarget : null;
}
export function resetContextForTests(): void {
  lastTarget = null;
}

// 벤치(tools/orchestrator-bench.mjs)와 동일한 결정 스키마 — 벤치 결과가 곧 이 루프의 실측 근거다.
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["tool", "final"] },
    tool: { type: "string" },
    args: { type: "object", additionalProperties: { type: "string" } },
    answer: { type: "string" },
  },
  required: ["action"],
} as const;

export interface AgentToolCall {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface AgentLoopResult {
  output: string;
  toolCalls: AgentToolCall[];
  // 쓰기 도구가 선택되면 실행 대신 결재판을 돌려준다 — 승인은 /api/agent/approve로만(시안 B).
  approval?: PendingApproval;
}

interface Decision {
  action: "tool" | "final";
  tool?: string;
  args?: Record<string, string>;
  answer?: string;
}

function parseDecision(raw: string): Decision | null {
  try {
    const p = JSON.parse(raw) as Decision;
    if (p.action !== "tool" && p.action !== "final") return null;
    return p;
  } catch {
    // 잘린 JSON 회수(실측 2026-07-18): action=final일 때 모델이 도구 결과(자산 목록 등)를 answer에
    // 통째로 뱉으면 maxTokens에서 잘려 JSON이 깨진다. 그 answer는 어차피 composeFinalAnswer가
    // 재작성하므로 버려도 되고, tool 결정의 tool/args는 잘림 앞부분에 온다 → action만 회수하면 된다.
    // (LLM 연결 실패 안내문 "⚠…" 등 action이 없는 진짜 비JSON은 아래에서 null로 폴백된다.)
    const actionM = raw.match(/"action"\s*:\s*"(tool|final)"/);
    if (!actionM) return null;
    if (actionM[1] === "final") return { action: "final" };
    const toolM = raw.match(/"tool"\s*:\s*"([a-zA-Z_]+)"/);
    if (!toolM) return null;
    const argsM = raw.match(/"args"\s*:\s*(\{[^}]*\})/);
    let args: Record<string, string> = {};
    if (argsM) {
      try {
        args = JSON.parse(argsM[1]) as Record<string, string>;
      } catch {
        /* args가 잘렸으면 빈 인자로 — 규칙 검증(validateToolArgs)이 뒤에서 잡는다 */
      }
    }
    return { action: "tool", tool: toolM[1], args };
  }
}

function decisionPrompt(instruction: string, calls: AgentToolCall[], context = "", scope?: ToolScope, fewshot = ""): string {
  const ctx = context ? ["", context, '위는 같은 세션의 이전 대화다. 지시가 "이어서/그거/방금"처럼 앞을 가리키면 이 맥락을 근거로 해석하라.'] : [];
  const history = calls.length
    ? [
        "",
        "지금까지 실행한 도구와 결과:",
        ...calls.map((c, i) => `[${i + 1}] ${c.tool}(${JSON.stringify(c.args)}) →\n${c.result}`),
        "",
        "위 결과로 지시에 답할 수 있으면 action=final로 답하고, 추가 조회가 필요할 때만 다른 도구를 호출하라.",
      ]
    : [];
  return [
    "너는 GIJO AS 보안 플랫폼의 오케스트레이터다. 사용자 지시를 읽고 아래 도구 중 하나를 골라 호출하거나, 도구가 필요 없으면 직접 답한다.",
    "",
    "사용 가능한 도구:",
    toolCatalogText(scope?.domains, scope?.role),
    "",
    "규칙:",
    '- 반드시 JSON 객체 하나만 출력한다: {"action":"tool","tool":"도구이름","args":{...}} 또는 {"action":"final","answer":"직접 답변"}',
    "- 지시와 맞는 도구가 없으면 action=final로 답한다. 도구 이름을 지어내지 않는다.",
    "- args 값은 모두 문자열로 쓴다.",
    ...(fewshot ? [fewshot] : []),
    ...ctx,
    ...history,
    ...anaphoraHint(instruction),
    "",
    `사용자 지시: "${instruction}"`,
  ].join("\n");
}

// #8: 지시가 "아까 그거" 류이고 최근 다룬 대상이 있으면, 그 대상을 프롬프트에 실어 해석을 돕는다.
function anaphoraHint(instruction: string): string[] {
  const t = recentTarget();
  if (!t || !ANAPHORA_RE.test(instruction)) return [];
  return [
    "",
    `직전에 다룬 취약점: 자산 "${t.assetId}", 취약점 "${t.finding}" (${t.label}). 지시의 "아까/방금/그거/이거"는 이것을 가리킨다 — 필요하면 이 assetId·finding을 그대로 써라.`,
  ];
}

// 파인튜닝 데이터셋 생성용(Phase 4) — 이력 없는 단일 지시의 결정 프롬프트를 그대로 돌려준다.
// 학습 예시의 question이 추론 시 orchestrator가 보내는 프롬프트와 동일해야(train==inference)
// 도구 선택이 실제로 개선된다. 도구 카탈로그가 바뀌면 데이터셋을 재생성해야 한다.
export function buildDecisionPrompt(instruction: string): string {
  return decisionPrompt(instruction, []);
}

// 결재판을 띄울 때 피드에 남길 안내문 — LLM을 한 번 더 부르지 않고 규칙으로 만든다(빠르고 결정적).
function approvalMessage(approval: PendingApproval): string {
  if (approval.missing.length) {
    const labels = approval.fields.filter((f) => approval.missing.includes(f.key)).map((f) => f.label);
    return `${approval.label}을(를) 준비했습니다. ${labels.join("·")} 값이 필요합니다 — 아래에서 채우고 승인해 주세요.`;
  }
  return `${approval.label}을(를) 준비했습니다. 아래 값을 확인하고 승인해 주세요.`;
}

// 최종 답변 재작성 — 도구 결과(사실)를 근거로 일반 chat 경로에서 한국어 답을 만든다.
// remember:true라 대화 이력·학습루프 수집·RAG 주입까지 기존 채팅과 동일하게 동작한다.
// 도구 선택 과정의 자체 실수(존재하지 않는 도구를 부름·인자 오류·실행 실패)는 결정 루프가 다음
// 스텝에서 스스로 고치라고 남겨두는 메모지, 사용자에게 보여줄 사실이 아니다. 실측(2026-07-19):
// 이 오류 메시지가 그대로 최종 답변 근거에 섞여 들어가 "자동화된 비교 도구가 없는 것을 확인했기
// 때문에" 같은 내부 과정 이야기가 사용자 답변에 새어나왔다 — 최종 답변을 만들 때는 걸러낸다.
const INTERNAL_TOOL_ERROR_RE = /^(존재하지 않는 도구|인자 오류|도구 실행 실패):/;

// 도구 결과가 이미 사람이 읽기 좋은 결정적 요약이면(directAnswer) LLM 재작성 없이 그대로 답한다.
// 단일 도구 호출일 때만 — 여러 도구를 조합한 답은 종합이 필요하므로 재작성 경로로 보낸다.
function directAnswerFor(calls: AgentToolCall[]): string | null {
  if (calls.length !== 1) return null;
  const only = calls[0];
  if (INTERNAL_TOOL_ERROR_RE.test(only.result)) return null; // 실패 결과는 재작성 경로에서 안내
  // "못 찾았다"는 답은 그대로 내보낸다 — 재작성을 거치면 "존재하지 않습니다"로 부풀려
  // 담당자가 "우리 회사엔 없구나"로 오해하는 사고가 있었다(2026-07-26 실사용).
  if (only.result.startsWith(NO_HIT_PREFIX)) return only.result;
  return findAgentTool(only.tool)?.directAnswer ? only.result : null;
}

// 최종 답 길이 상한 — 도구 결과를 프롬프트에 다시 실을 때 과도하게 커지지 않게 자른다(멈춤 방지).
const MAX_FACT_CHARS = 1800;

// LLM이 최종답에서 "없다"고 부정하는 문구. 도구가 실제 데이터를 돌려줬는데 이런 답이 나오면
// 사용자에게는 "제품이 자기 데이터를 못 찾는다"로 보인다 — 실사용 신뢰를 직접 깨는 회귀다.
const DENIAL_RE = /찾을 수 없|찾지 못|정보가 없|확인되지 않|해당하는 (자산|취약점|데이터).{0,10}없|존재하지 않습니다|없습니다\.?$/;
// 도구 결과가 "실제 데이터를 담고 있는가" — 도구들이 0건일 때 쓰는 문구를 부정형으로 판별한다.
const EMPTY_RESULT_RE = /찾지 못했습니다|없습니다|0건|해당 없음/;

/**
 * 도구가 데이터를 돌려줬는데 LLM 최종답이 그것을 부정하면, 조회 결과 원문으로 되돌린다.
 * 실측(2026-07-25): search가 자산 1건·취약점 3건을 반환했는데도 7B가 "취약점 정보를 찾을 수
 * 없습니다"로 답했다. 프롬프트 강화(위 지시문)로도 재발했다 — 7B 행동 교정은 프롬프트로 하지
 * 않는다는 원칙에 따라 코드로 막는다. 사람이 읽을 수 있는 원본을 그대로 주는 편이 정직하다.
 */
export function guardAgainstDenial(answer: string, calls: AgentToolCall[]): string {
  const hasData = calls.some(
    (c) => !INTERNAL_TOOL_ERROR_RE.test(c.result) && c.result.trim().length > 40 && !EMPTY_RESULT_RE.test(c.result)
  );
  if (!hasData) return answer; // 도구가 실제로 0건이면 "없다"가 정답
  const short = answer.trim().length < 400; // 긴 답변은 데이터를 다뤘을 가능성이 높다
  if (!(DENIAL_RE.test(answer) && short)) return answer;
  const facts = calls
    .filter((c) => !INTERNAL_TOOL_ERROR_RE.test(c.result))
    .map((c) => c.result.trim())
    .join("\n\n");
  return `조회 결과입니다.\n\n${facts}`.slice(0, 3000);
}

async function composeFinalAnswer(instruction: string, calls: AgentToolCall[], context = ""): Promise<string> {
  const usefulCalls = calls.filter((c) => !INTERNAL_TOOL_ERROR_RE.test(c.result));
  const facts = (usefulCalls.length ? usefulCalls : calls)
    .map((c, i) => `[${i + 1}] ${c.tool}: ${c.result.slice(0, MAX_FACT_CHARS)}`)
    .join("\n");
  return chat({
    agentId: "orchestrator",
    // explain: 도구 실행 후 사용자에게 그대로 보여주는 최종 답변이다.
    explain: true,
    message: [
      ...(context ? [context, ""] : []),
      `사용자 지시: "${instruction}"`,
      "",
      "방금 시스템에서 조회한 실제 데이터:",
      facts,
      "",
      "위 데이터만 근거로 지시에 대한 최종 답변을 작성하라. 데이터에 없는 내용은 지어내지 마라.",
      // 실측(2026-07-25): search가 자산·취약점 3건을 정확히 돌려줬는데도 7B가 최종답에서
      // "취약점 정보를 찾을 수 없습니다"로 뒤집었다(도구 결과 무시). RAG 그라운딩과 같은 처방 —
      // "위 데이터가 곧 조회 결과"임을 명시하고, 결과가 있으면 없다고 말하지 못하게 못박는다.
      "위 데이터는 이미 시스템이 조회해 확보한 실제 결과다. 데이터에 항목이 하나라도 있으면 '찾을 수 없다·정보가 없다·확인되지 않는다'고 답하지 말고, 그 항목들을 그대로 정리해 답하라. 데이터가 비어 있을 때만 없다고 답한다.",
      "지시에 비교 대상이나 조건이 여러 개 있으면(예: 자산 2개 비교) 하나만 다루고 끝내지 말고 전부 빠짐없이 다뤄라.",
      "같은 판단·결론을 문장만 바꿔 반복하지 마라 — 한 번만 명확히 말하고 끝내라.",
      "도구·시스템 내부 동작(어떤 도구를 썼는지, 도구가 있는지 없는지 등)은 언급하지 말고, 데이터에서 얻은 결론만 말하라.",
    ].join("\n"),
    // remember:true는 이 합성 메시지로 임베딩(RAG) 호출까지 유발한다 — 단일 GPU에서 채팅 모델과
    // 경합해 데이터가 많을 때 최종답 생성이 멈추는 원인이었다(실측: today/explain 300초 무응답).
    // 최종답에는 이미 근거(facts)가 다 실려 있어 RAG·이력이 필요 없다. 끄고, 생성 길이도 상한을 둔다.
    maxTokens: 800,
  });
}

// 지시를 에이전트 루프로 처리한다. 도구를 하나도 쓰지 않았거나 결정이 파싱 불가면 null
// (호출자가 기존 채팅으로 폴백). 도구를 썼으면 실행 내역과 최종 답변을 돌려준다.
/**
 * 이번 지시에서 쓸 수 있는 도구의 범위.
 * - domains: 화면에서 온 업무 영역(screencontext). 없으면 좁히지 않는다.
 * - role: 호출자 권한. admin이 아니면 requiredRole="admin" 도구는 후보에서 빠진다.
 */
export interface ToolScope {
  domains?: string[];
  role?: string;
}

// 제품 핵심 문구인데 LLM이 "일반 질문"으로 오인해 도구를 건너뛰고 잡담으로 답하던 의도를
// 결정적으로 해당 도구에 못박는다(A단계 교훈: 라우팅 흔들림은 프롬프트 힌트가 아니라 결정적
// 후처리로 고친다). 실측(2026-07-19): "오늘 뭐부터 조치해야 해?"가 3/3 chat 폴백 → today 미호출.
// 문구가 명백할 때만 발동하도록 좁게 잡는다(과발동 시 최악이라도 우선순위 목록을 보여주는 것뿐).
const FORCED_INTENTS: { re: RegExp; tool: string; args: Record<string, string> }[] = [
  {
    re: /오늘.{0,6}(뭐|무엇|어디|먼저).{0,4}(부터|먼저).{0,6}(조치|해|처리|봐|볼|하지)|뭐부터\s*(조치|해|하지)|(제일|가장|지금)\s*급한\s*(취약점|건|것)|우선순위.{0,4}(취약점|조치)/,
    tool: "today",
    args: {},
  },
  // 보안장비 하드닝(보안설정) 점검 — 명백한 문구는 곧장 스캔 도구로. CIS를 명시하면 cis, 아니면 국내 CCE(kisa).
  {
    re: /(하드닝|보안\s*설정)\s*(점검|진단|스캔|체크)|CCE\s*(점검|진단|기준)|(장비|서버|시스템)\s*(보안\s*)?(점검|진단)해|기준.{0,3}(점검|진단)|취약점\s*진단해/,
    tool: "run_hardening_scan",
    args: {},
  },
  // 정기 리포트 스케줄 조회 — "다음 리포트 언제", "이번 주 스케줄" 등은 today/briefing으로 새기 쉬워 못박는다.
  {
    re: /(정기|자동)?\s*리포트\s*(스케줄|일정|예약).{0,6}(확인|알려|보여|뭐)|다음\s*(정기\s*)?리포트.{0,4}(언제|일정)|리포트\s*(자동\s*)?생성.{0,4}(언제|스케줄|일정)/,
    tool: "report_schedule_list",
    args: {},
  },
  // 통합 보안 분석(관제) 허브 현황 — "보안 분석" 키워드가 today/briefing으로 새기 쉬워 못박는다.
  {
    re: /통합\s*(보안\s*)?(분석|관제)|보안\s*분석\s*(현황|어때|보여)|관제\s*현황/,
    tool: "analysis_status",
    args: {},
  },
  // 보유 보안제품 목록 — 담당자는 "보안장비"라고도 부른다(2026-07-26 실사용: "보안장비 리스트"가
  // 통합 검색으로 가서 0건 → "존재하지 않습니다"로 답했다. 실제로는 3건 등록돼 있었다).
  // 하드닝 점검("보안장비 점검해줘")과 겹치지 않게 목록·현황을 묻는 말투일 때만 잡는다.
  {
    re: /(보안\s*(장비|제품|솔루션|기기))\s*(목록|리스트|현황|뭐|어떤|들)|(보유|도입)한?\s*보안\s*(장비|제품|솔루션)/,
    tool: "product_status",
    args: {},
  },
  // 보안 KPI 현황 — "KPI"는 영문이라 대소문자 무관하게 잡는다.
  {
    re: /보안\s*kpi|kpi\s*(현황|어때|보여)|보안\s*지표\s*(현황|보여)/i,
    tool: "kpi_status",
    args: {},
  },
  // 작업 세션(대화 세션형) 현황.
  {
    re: /작업\s*세션.{0,6}(뭐|확인|알려|보여)|(지난|최근)\s*(대화\s*)?세션/,
    tool: "work_session_status",
    args: {},
  },
  // 오늘의 브리핑 — 대시보드(전체 도구 노출)에서 문구가 명백한데도 LLM이 도구를 건너뛰고 잡담으로
  // 떨어지던 것(실측 0/3 → chat)을 못박는다. "문서 리포트 작성"은 여기 안 걸리게 좁게 잡는다.
  {
    re: /브리핑|아침.{0,5}(뭐|무엇).{0,4}챙|오늘.{0,6}(챙겨야|챙길|상황\s*(요약|정리))|지금.{0,4}상황\s*(요약|정리)/,
    tool: "briefing",
    args: {},
  },
];
// 등록된 보안제품 이름을 콕 집어 "설명해줘"라고 물으면 그 제품의 사내 근거(매뉴얼·온톨로지)를
// 모아 답한다. [2026-07-26 실사용] "Tenable Web App Scanning 주요기능 설명해줘"에 도구를 하나도
// 안 쓰고 "이 자산 취약점 1건" 같은 엉뚱한 답이 나왔다 — 매뉴얼이 들어 있는데도 찾아보지 않았다.
// 어느 도구로 갈지 정해두지 않으면 LLM이 그냥 지어낸다.
const EXPLAIN_VERB_RE = /설명|주요\s*기능|무슨\s*(제품|기능)|뭐(야|하는)|어떤\s*(제품|기능|역할)|알려줘|소개/;
function namedProductIn(instruction: string): string | null {
  const q = instruction.replace(/\s+/g, "").toLowerCase();
  // 긴 이름부터 본다 — "Tenable Security Center"가 "Tenable"보다 먼저 걸리게.
  const names = listProducts()
    .map((p) => p.name)
    .filter((n) => n && n.replace(/\s+/g, "").length >= 4)
    .sort((a, b) => b.length - a.length);
  for (const n of names) if (q.includes(n.replace(/\s+/g, "").toLowerCase())) return n;
  return null;
}

// [2026-07-29 시연 실측, 계획서 전-1] "SonicWall VPN 인증서 점검은 어떻게 해?"가 안내 대신
// **실제 하드닝 점검을 실행**했다. 방법을 묻는 말과 실행 지시는 다르다 — 방법 질문이면
// 점검 도구를 쓰지 않고 지식(RAG·채팅)으로 답한다. 실행은 명령형(점검해줘·실행·돌려)일 때만.
export function isHowtoNotCommand(instruction: string): boolean {
  const howto = /어떻게|어떤\s*방법|방법(을|이|은)?\s*(알려|뭐|있)|절차(가|를|는)?\s*(알려|뭐|어떻)|뭘\s*봐야/.test(instruction);
  const imperative = /(점검|진단|스캔)\s*(해\s*줘|해줘|해라|하자|실행|시작|돌려)|돌려\s*줘|실행해/.test(instruction);
  return howto && !imperative;
}

function forcedToolFor(instruction: string, scope?: ToolScope): { tool: string; args: Record<string, string> } | null {
  const available = new Set(listToolsFor(scope?.domains, scope?.role).map((t) => t.name));

  if (available.has("explain") && EXPLAIN_VERB_RE.test(instruction)) {
    const product = namedProductIn(instruction);
    if (product) return { tool: "explain", args: { topic: product } };
  }

  // "가장 급한 취약점 담당자·기한 배정해줘"처럼 배정/지정 지시면 우선순위 조회(today)로 못박지 않는다
  // — LLM이 assign_finding(쓰기)을 고르도록 둔다(실측: today 강제가 배정 명령까지 흡수했었음).
  const isAssign = /배정|담당자\s*(를|을|.{0,2})?(지정|정해|배치|맡|줘|넣)|기한\s*(을|를)?\s*(지정|정해|설정|잡)|맡겨|배치해줘/.test(instruction);
  for (const f of FORCED_INTENTS) {
    if (f.re.test(instruction) && available.has(f.tool)) {
      if (f.tool === "today" && isAssign) continue; // 배정 지시는 today로 강제하지 않음
      if (f.tool === "briefing" && /리포트|보고서|report/i.test(instruction)) continue; // 문서 리포트는 briefing 아님
      // 하드닝 점검 기준 선택: CIS 명시→cis, PC/윈도우→kisa_pc, 네트워크 장비→kisa_net, 그 외→국내 CCE(kisa).
      if (f.tool === "run_hardening_scan") {
        if (isHowtoNotCommand(instruction)) continue; // 방법 질문은 실행하지 않는다(2026-07-29)
        const standard = /\bcis\b|국제/i.test(instruction) ? "cis"
          : /\bpc\b|피시|윈도우|windows/i.test(instruction) ? "kisa_pc"
          : /네트워크\s*장비|스위치|라우터|cisco/i.test(instruction) ? "kisa_net"
          : "kisa";
        return { tool: f.tool, args: { standard } };
      }
      return { tool: f.tool, args: f.args };
    }
  }
  return null;
}

export async function runAgentLoop(instruction: string, context = "", scope?: ToolScope): Promise<AgentLoopResult | null> {
  // 범위를 적용한 뒤 쓸 도구가 하나도 없으면 루프를 돌 이유가 없다(호출자가 채팅으로 폴백).
  if (listToolsFor(scope?.domains, scope?.role).length === 0) return null;

  // 대표 문구는 LLM 결정을 건너뛰고 곧장 그 도구를 실행한다 — 흔들림 없이 항상 답한다.
  const forced = forcedToolFor(instruction, scope);
  if (forced) {
    const tool = findAgentTool(forced.tool);
    if (tool && !tool.write) {
      try {
        const result = String(await tool.run(forced.args));
        const calls: AgentToolCall[] = [{ tool: forced.tool, args: forced.args, result }];
        const direct = directAnswerFor(calls);
        return { output: guardAgainstDenial(direct ?? (await composeFinalAnswer(instruction, calls, context)), calls), toolCalls: calls };
      } catch {
        /* 강제 실행 실패 시 아래 일반 루프로 폴백 */
      }
    }
  }

  // 골드 few-shot(파인튜닝 대체) — 시드+승인 골드에서 유사 예시 2~3건을 첫 결정에만 주입한다.
  // (2번째 스텝부터는 도구 결과 history가 이미 근거라 안 붙인다 — 프롬프트 길이 절약.)
  // 좁힌 카탈로그에 없는 도구 예시는 제외(없는 도구 호출 유도 방지). 동적 import는 순환 회피
  // (orchestrator-dataset이 buildDecisionPrompt를 import한다).
  const allowedTools = new Set(listToolsFor(scope?.domains, scope?.role).map((t) => t.name));
  const fewshot = await import("./orchestrator-dataset.js")
    .then((m) => m.fewshotBlockFor(instruction, allowedTools))
    .catch(() => "");

  const calls: AgentToolCall[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const raw = await chat({
      agentId: "orchestrator",
      message: decisionPrompt(instruction, calls, context, scope, calls.length === 0 ? fewshot : ""),
      responseSchema: DECISION_SCHEMA,
      maxTokens: 300,
    }).catch(() => "");
    const decision = parseDecision(raw);
    if (!decision) return null; // LLM 다운·형식 불가 → 기존 채팅 폴백

    if (decision.action === "final") {
      if (calls.length === 0) return null; // 도구가 필요 없는 일반 대화 → 기존 채팅(RAG·이력)이 더 낫다
      const direct = directAnswerFor(calls);
      const output = guardAgainstDenial(direct ?? (await composeFinalAnswer(instruction, calls, context)), calls);
      return { output, toolCalls: calls };
    }

    // action=tool — 규칙 검증이 LLM 출력 뒤에 항상 위치한다(QA 원칙).
    const tool = decision.tool ? findAgentTool(decision.tool) : undefined;
    const args = decision.args ?? {};

    // 같은 조회 도구를 같은 인자로 되풀이하면(실측: today를 5회 반복) 재실행은 같은 결과라 낭비다.
    // 이미 실행한 (도구+인자)면 재실행 없이 루프를 끝내 지금까지의 결과로 최종 답을 만든다.
    // 쓰기 도구는 해당 없음(결재판을 돌려주고 즉시 종료하므로 calls에 쌓이지 않는다).
    if (tool && !tool.write) {
      const sig = `${decision.tool}:${JSON.stringify(args)}`;
      if (calls.some((c) => `${c.tool}:${JSON.stringify(c.args)}` === sig)) break;
    }

    let result: string;
    if (!tool) {
      result = `존재하지 않는 도구: ${decision.tool ?? "(없음)"}. 사용 가능한 도구 중에서만 골라라.`;
    } else if (tool.name === "run_hardening_scan" && isHowtoNotCommand(instruction)) {
      // LLM이 스스로 점검 도구를 골라도 방법 질문이면 실행을 막는다(2026-07-29 시연 실측).
      // 첫 수라면 루프를 접고 지식(RAG·채팅)으로 넘긴다 — 그쪽이 방법 설명을 잘한다.
      if (calls.length === 0) return null;
      result = "이 지시는 점검 '방법'을 묻는 질문이라 점검을 실행하지 않았다. 아는 지식으로 절차를 설명하라.";
    } else if (tool.write) {
      // 쓰기 도구는 여기서 실행하지 않는다 — 값을 결재판으로 만들어 돌려주고, 사람이 승인해야
      // /api/agent/approve에서 실행된다(오발동 방지). 루프는 여기서 끝난다.
      // 지금까지의 조회 결과를 함께 넘긴다 — assetId·finding처럼 앞선 도구 결과에서 복사한 값을
      // 환각(guess)으로 오판해 되묻지 않게 하기 위해서다(근거=지시문 ∪ 조회 결과).
      // #8: 직전 대상(lastTarget)도 그라운딩에 포함한다 — "아까 그거"에서 모델이 채운 assetId·finding이
      // 지시문에 없어도 blank되지 않게(맥락에서 온 근거 있는 값이므로).
      const ctx = recentTarget();
      const toolResults = [calls.map((c) => c.result).join("\n"), ctx ? `직전 대상 자산 ${ctx.assetId} 취약점 ${ctx.finding}` : ""].filter(Boolean).join("\n");
      const approval = buildApproval(tool, args, instruction, toolResults);
      // 방금 다룬 취약점을 기억(후속 "아까 그거"용) — assetId·finding 인자가 있는 도구만.
      if (args.assetId && args.finding) setLastTarget(args.assetId, args.finding, tool.label);
      emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `승인 대기: ${tool.label} — 값 검토 요청` });
      return { output: approvalMessage(approval), toolCalls: calls, approval };
    } else {
      const invalid = validateToolArgs(tool, args);
      if (invalid) {
        result = `인자 오류: ${invalid}`;
      } else {
        emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `도구 실행: ${tool.name}(${JSON.stringify(args)})` });
        try {
          result = String(await tool.run(args));
        } catch (err) {
          result = `도구 실행 실패: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
    calls.push({ tool: decision.tool ?? "(없음)", args, result });
  }

  // 반복 상한 도달 — 지금까지 모은 결과로라도 답을 만든다(도구를 썼을 때만).
  if (calls.length === 0) return null;
  const direct = directAnswerFor(calls);
  const output = guardAgainstDenial(direct ?? (await composeFinalAnswer(instruction, calls, context)), calls);
  return { output, toolCalls: calls };
}
