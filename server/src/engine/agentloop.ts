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
import { reportProgress } from "./progress";
import { listAgentTools, listToolsFor, findAgentTool, toolCatalogText, validateToolArgs, buildApproval, PendingApproval, NO_HIT_PREFIX } from "./agenttools";
import { emitCollaboration } from "./collaboration";
import { listProducts } from "./securityproducts";
import { recordWork, TOOL_WORK_KIND } from "./worklog";
import { listTasks } from "./tasks";

const MAX_STEPS = 5;

// 조회에 그치지 않고 **무언가 하라는** 지시. 이런 말투면 조회 결과가 다음 행동의 재료일 수 있어
// 루프를 한 걸음 더 진행한다(directAnswer 조기 종료를 건너뛴다). 넓게 잡아 두는 편이 안전하다 —
// 잘못 잡히면 응답이 몇 초 느려질 뿐이지만, 놓치면 "배정해줘"가 조회로 끝나 버린다.
const ACTION_INTENT_RE =
  /배정|지정|맡겨|넘겨|바꿔|변경|수정|등록|추가|삭제|지워|해제|승인|반려|실행|시작|돌려|생성|만들|작성|보내|올려|내려|설정/;

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
/**
 * 도구 결과에 박아 둔 **내부 식별자**를 사람에게 보이기 전에 지운다.
 *
 * 도구는 `자산이름(id=vuln:sample-web01)` 꼴로 id를 함께 낸다 — 일부러 그런 것이다.
 * LLM이 "1번 자산 자세히 봐줘" 같은 후속 지시에서 그 id로 다음 도구를 부르기 때문이다.
 * 문제는 **직답 경로**(도구 결과가 그대로 답이 되는 길)에서 그 id가 담당자 화면까지 간다는 것.
 * 실측(2026-08-01 하루 실전): "오늘 뭐부터 볼까?"의 답에 `(id=vuln:sample-web01)`이 그대로 떴다.
 *
 * ⚠ 지우는 자리는 **사람에게 나가는 마지막 지점 한 곳**이어야 한다.
 *   도구 결과(calls[].result) 자체를 지우면 LLM이 id를 잃어 후속 지시가 끊긴다.
 */
export function 사람용으로다듬기(text: string): string {
  return String(text ?? "").replace(/\s*\(id=[\w:.\-]+\)/g, "");
}

function directAnswerFor(calls: AgentToolCall[]): string | null {
  if (calls.length !== 1) return null;
  const only = calls[0];
  if (INTERNAL_TOOL_ERROR_RE.test(only.result)) return null; // 실패 결과는 재작성 경로에서 안내
  // "못 찾았다"는 답은 그대로 내보낸다 — 재작성을 거치면 "존재하지 않습니다"로 부풀려
  // 담당자가 "우리 회사엔 없구나"로 오해하는 사고가 있었다(2026-07-26 실사용).
  if (only.result.startsWith(NO_HIT_PREFIX)) return 사람용으로다듬기(only.result);
  return findAgentTool(only.tool)?.directAnswer ? 사람용으로다듬기(only.result) : null;
}

// 최종 답 길이 상한 — 도구 결과를 프롬프트에 다시 실을 때 과도하게 커지지 않게 자른다(멈춤 방지).
const MAX_FACT_CHARS = 1800;

// LLM이 최종답에서 "없다"고 부정하는 문구. 도구가 실제 데이터를 돌려줬는데 이런 답이 나오면
// 사용자에게는 "제품이 자기 데이터를 못 찾는다"로 보인다 — 실사용 신뢰를 직접 깨는 회귀다.
const DENIAL_RE = /찾을 수 없|찾지 못|정보가 없|확인되지 않|해당하는 (자산|취약점|데이터).{0,10}없|존재하지 않습니다|없습니다\.?$/;
// 도구 결과가 "실제 데이터를 담고 있는가" — 도구들이 0건일 때 쓰는 문구를 부정형으로 판별한다.
// ⚠ 2026-08-01 사고: 도구 0건 문구를 "없습니다"→"전체 N건 중 … **못 찾았습니다**"로 바꾸면서
//   여기를 안 고쳤다. 「못 찾았습니다」는 「찾지 못했습니다」와 어순이 달라 안 걸리고, 문장이
//   51자라 길이 40자 조건도 넘는다 → **0건인데 hasData=true**가 된다.
//   그러면 LLM이 정직하게 "못 찾았습니다"라고 답해도 DENIAL_RE에 걸려 도구 원문으로 덮어쓰고,
//   directAnswer의 "못 찾았다는 답은 그대로 내보낸다" 보호도 안 걸린다.
//   **0건 문구를 바꿀 때는 이 줄을 같이 본다.**
const EMPTY_RESULT_RE = /찾지 못했습니다|못 찾았습니다|없습니다|0건|해당 없음/;

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
  // ★ 이 함수가 루프의 **마지막 관문**이다 — 두 출구(538·645) 모두 여기를 지난다.
  //   LLM이 도구 결과에서 id를 그대로 베껴 오는 일이 잦아, 되돌리지 않는 길에서도 지운다.
  if (!hasData) return 사람용으로다듬기(answer); // 도구가 실제로 0건이면 "없다"가 정답
  const short = answer.trim().length < 400; // 긴 답변은 데이터를 다뤘을 가능성이 높다
  if (!(DENIAL_RE.test(answer) && short)) return 사람용으로다듬기(answer);
  const facts = calls
    .filter((c) => !INTERNAL_TOOL_ERROR_RE.test(c.result))
    .map((c) => c.result.trim())
    .join("\n\n");
  // 원자료를 통째로 쏟는 것은 마지막 수단이다 — **사람이 읽을 근거가 있으면 그것만** 추린다.
  // 실측(2026-07-30): 이 함수가 발동해 "조회 결과입니다 + 자산 원문(id=vuln:… 내부 식별자
  // 포함)"을 그대로 내보냈다. 담당자에게 내부 id 덤프는 답이 아니고, 없다는 답보다 조금 나을
  // 뿐이다. 도구가 이미 사람이 읽는 문장(문서 발췌)을 담고 있으면 그쪽을 쓴다.
  const 발췌 = extractQuotedEvidence(facts);
  // 여기도 도구 원문이 그대로 사람에게 간다 — 내부 식별자를 지운다(위 사람용으로다듬기 참고).
  if (발췌) return 사람용으로다듬기(`찾은 근거입니다.\n\n${발췌}`).slice(0, 3000);
  return 사람용으로다듬기(`조회 결과입니다.\n\n${facts}`).slice(0, 3000);
}

/** 도구 결과에서 사람이 읽는 근거(사내 문서 발췌)만 골라낸다. 없으면 null. */
function extractQuotedEvidence(facts: string): string | null {
  const lines = facts.split("\n");
  const start = lines.findIndex((l) => l.includes("사내 문서 근거(발췌)"));
  if (start < 0) return null;
  const kept: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  · ") && !line.startsWith("      ")) break; // 발췌 블록이 끝났다
    kept.push(line.replace(/^\s*·\s*/, "  · "));
  }
  if (!kept.length) return null;
  return kept.join("\n");
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
    // ⚠ trusted — 이 message는 사용자 입력이 아니라 **우리가 조립한 내부 프롬프트**다
    //   (지시문 사본 + 도구 결과 + 작성 규칙). 사용자 지시 자체는 dispatcher가 이미
    //   gateUserInput으로 검사했다. 이걸 안 켜면 우리 프롬프트가 사용자 입력으로 다시 검사되어
    //   가드레일 로그가 내부 문구로 가득 차고, 차단 모드에서는 **제품이 자기 자신을 막는다**
    //   (2026-07-30 실사고: 도구 결정 0/4, A/B/A로 확인). gateway.ts 주석이 지키라던 규칙이다.
    trusted: true,
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
 * - qa: 평가 게이트/QA 호출 표시(중-3). 루프의 결정 호출은 remember를 안 써 수집이 없고
 *   쓰기 도구는 결재판(approval)으로만 나가므로 지금 동작 차이는 없다 — 향후 기록성
 *   부작용을 갖는 도구가 생기면 이 플래그를 참조해 건너뛴다.
 */
export interface ToolScope {
  domains?: string[];
  role?: string;
  qa?: boolean;
  actor?: string; // 지시한 사람 — 작업 원장(중-2)에 누가 시킨 일인지 남긴다
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
    re: /(하드닝|보안\s*설정)\s*(점검|진단|스캔|체크)|CCE\s*(점검|진단|기준)|(장비|서버|시스템)\s*(보안\s*)?(점검|진단)해|기준.{0,3}(점검|진단)|취약점\s*진단해|정기\s*점검\s*(돌려|실행|해)/,
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
    // ★ "우리 보안 점수 어때?"를 넣었다(2026-08-01 하루 실전).
    //   그전엔 모델 재량으로 가서 32초를 헤매다 엉뚱한 CVE 설명을 내놨다 —
    //   종합 보안태세 점수는 KPI가 결정적으로 계산해 두는 값이라 물어볼 것이 아니다.
    re: /보안\s*kpi|kpi\s*(현황|어때|보여)|보안\s*지표\s*(현황|보여)|보안\s*(점수|태세)\s*(어때|어떻|얼마|보여|알려|몇)/i,
    tool: "kpi_status",
    args: {},
  },
  // 작업 세션(대화 세션형) 현황.
  //
  // ★ "최근에 내가 한 작업 보여줘"를 반드시 여기로 보낸다(2026-08-01 챗봇 전수에서 발견).
  //   그전엔 모델 재량으로 갔다가 **"GIJO AS는 작업 로그를 기록하지 않습니다"**라고 답했다 —
  //   있는 기능을 없다고 잘라 말한 것이라, 담당자는 화면(작업 내역)이 있는 줄도 모르고 돌아선다.
  //   모르는 것을 지어내는 것보다 **있는 것을 없다고 하는 쪽**이 더 나쁘다.
  //   프롬프트로 타이르지 않고(확립 원칙) 경로로 못 박는다.
  {
    re: /작업\s*세션.{0,6}(뭐|확인|알려|보여)|(지난|최근)\s*(대화\s*)?세션|(최근|지난|요즘|그동안).{0,10}(내가\s*)?한\s*(작업|일)|작업\s*(내역|이력|기록).{0,8}(보여|알려|확인|뭐)/,
    tool: "work_session_status",
    args: {},
  },
  // 온톨로지(지식 그래프)를 콕 집어 물으면 그리로 간다 — [2026-07-29 평가 게이트가 잡음]
  // 도구를 2개 늘리자 "Log4Shell 완화 방법을 온톨로지에서 찾아줘"가 explain으로만 갔다.
  // 도구 목록이 길어질수록 LLM의 선택이 흔들린다는 건 이 프로젝트의 반복 실측이다 —
  // 사용자가 이름을 대고 지목한 경우까지 모델 재량에 맡길 이유가 없다.
  {
    re: /온톨로지|지식\s*그래프|트리플/,
    tool: "ontology_query",
    args: {},
  },
  // 원격 정기점검(하드닝) 스케줄 조회 — 위의 "하드닝 점검 실행"과 갈라야 한다("점검"이 겹친다).
  // 스케줄·주기를 묻는 말투일 때만 잡고, 실행 명령형은 위 run_hardening_scan으로 그대로 간다.
  // [2026-07-29 평가 게이트가 잡음] "원격 정기점검 스케줄 어떻게 되어 있어?"에 자산 취약점 답이 나왔다.
  {
    // ⚠ 좁게 잡는다(검토 지적 2026-07-29). 앞의 '원격/정기'를 선택으로 두면 맨 "점검 일정"만으로
    // 걸려 **유지보수 점검**(maintenance_items — 다른 기능이다) 질문까지 삼켰다. 또 "정기점검
    // 돌려줘"는 실행 명령인데 조회로 갔다 — 명령형 어미는 여기서 제외하고 run_hardening_scan에 맡긴다.
    // ⚠ 또 넓었다(2026-07-31 QA-M04 재발). `정기점검.{0,6}알려`가 **"정기점검 절차를 알려줘"**까지
    //   삼켰다 — 그건 스케줄 조회가 아니라 **점검을 어떻게 하는지** 묻는 지식 질문이다.
    //   담당자는 점검일 아침에 그렇게 묻는데, 돌아온 답이 "등록된 스케줄이 없습니다"였다.
    //   `절차·방법·항목·순서·단계·체크리스트`가 함께 있으면 이 도구가 아니다.
    re: /^(?!.*(절차|방법|항목|순서|단계|체크\s*리스트|어떻게\s*하))(?:.*(?:(원격|하드닝|정기)\s*점검\s*(스케줄|일정|주기)|정기점검.{0,6}(언제|어떻게|확인|알려|보여)|(원격|하드닝)\s*점검.{0,4}자동.{0,6}(돌|실행|되)))/,
    tool: "hardening_schedule_list",
    args: {},
  },
  // 컴플라이언스 이행 현황 — [2026-07-29 평가 게이트(중-3) 첫 실행] "컴플라이언스 현황 요약해줘"에
  // 24초를 쓰고도 도구를 하나도 안 골랐다(LLM 판단). 화면·메뉴 이름 그대로 물은 건 결정적으로 잇는다.
  {
    re: /컴플라이언스\s*(현황|이행|상태|어때|보여|요약)|(규제|통제)\s*항목\s*(현황|이행)|이행\s*현황\s*(확인|알려|보여|요약)/,
    tool: "compliance_status",
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

// 점검 절차·방법·항목을 묻는 말 — 스케줄 조회(hardening_schedule_list)와 갈라야 한다.
// 저쪽은 "언제/일정"을 묻고 이쪽은 "어떻게/무엇을"을 묻는다. 답이 나오는 곳도 다르다
// (저쪽=등록된 스케줄, 이쪽=지식베이스의 유지보수 절차 문서).
// ⚠ 넓게 잡았다가 바로 다른 것을 깨뜨렸다(2026-07-31, 회귀 하네스가 잡음):
//   "리눅스 SSH root 로그인 차단은 KISA 어떤 **점검항목**이야?"가 걸려 U-01 답이 사라졌다.
//   그건 하드닝 **기준 코드**를 묻는 질문이지 유지보수 절차가 아니다. 그래서:
//     · "점검항목"처럼 붙여 쓴 말은 제외한다(사이에 공백·수식어가 있어야 절차 질문이다)
//     · 정기·월간·주간처럼 **주기어**가 함께 있거나 "유지보수"가 명시될 때만 잡는다
//   좁히다 놓치면 답이 조금 헤맬 뿐이지만, 넓혀서 남의 답을 삼키면 그 기능이 죽는다.
const MAINT_PROCEDURE_RE =
  /((정기|월간|주간|분기|연간)\s*점검|유지보수(\s*점검)?)\s*.{0,8}(절차|방법|순서|단계|항목|체크\s*리스트)|(점검|유지보수)\s+(절차|방법|순서|단계|체크\s*리스트)/;

// explain에 넘길 주제 — 장비 종류가 적혀 있으면 살려야 문서가 정확히 걸린다.
const MAINT_DEVICE_RE = /(방화벽|IPS|IDS|WAF|VPN|백신|안티바이러스|스위치|라우터|웹서버|서버)/i;
function maintenanceTopicOf(instruction: string): string {
  const dev = instruction.match(MAINT_DEVICE_RE);
  return (dev ? `${dev[1]} ` : "") + "정기점검 절차";
}
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
  // ⚠ 강제 분기는 **화면 도메인 좁히기를 따르지 않는다**(검토 지적 2026-07-29).
  //   도메인 좁히기의 목적은 "LLM에게 보여 줄 도구 목록을 짧게 유지해 선택이 흔들리지 않게" 하는
  //   것인데, 강제 분기는 LLM을 아예 거치지 않는다 — 좁힐 이유가 없다. 그런데 좁힌 목록으로
  //   확인하는 바람에, 유지보수 화면에서만 보이는 도구를 취약점 화면에서 부르면 분기가 조용히
  //   비켜났다. 게이트가 잡아 고친 바로 그 오답이 다른 화면에서 그대로 재현되던 것이다.
  //   권한(role)은 그대로 지킨다 — admin 전용 도구가 강제 분기로 새면 안 된다.
  const available = new Set(listToolsFor(undefined, scope?.role).map((t) => t.name));

  if (available.has("explain") && EXPLAIN_VERB_RE.test(instruction)) {
    const product = namedProductIn(instruction);
    if (product) return { tool: "explain", args: { topic: product } };
  }

  // 점검 "절차·방법·항목"을 묻는 말은 **사내 문서 근거**로 결정적으로 잇는다.
  // [2026-07-31 QA-M04 재발] "방화벽 월간 정기점검 절차를 알려줘"에 처음엔 스케줄 조회가
  // (빈 스케줄), 그걸 고치자 이번엔 LLM이 분석 허브를 골라 취약점 목록이 돌아왔다.
  // 담당자가 점검일 아침에 던지는 질문인데 두 번 다 엉뚱한 답이었다.
  // 7B에 프롬프트로 타이르지 않고(확립 원칙) 경로를 코드로 못박는다 —
  // 유지보수 절차는 지식베이스에 있고, explain이 그 문서를 근거로 모은다.
  if (available.has("explain") && MAINT_PROCEDURE_RE.test(instruction)) {
    return { tool: "explain", args: { topic: maintenanceTopicOf(instruction) } };
  }

  // "가장 급한 취약점 담당자·기한 배정해줘"처럼 배정/지정 지시면 우선순위 조회(today)로 못박지 않는다
  // — LLM이 assign_finding(쓰기)을 고르도록 둔다(실측: today 강제가 배정 명령까지 흡수했었음).
  const isAssign = /배정|담당자\s*(를|을|.{0,2})?(지정|정해|배치|맡|줘|넣)|기한\s*(을|를)?\s*(지정|정해|설정|잡)|맡겨|배치해줘/.test(instruction);
  // ★ "○○ 완료" — 할 일을 끝냈다는 말은 **코드로 못 박는다**(2026-08-01, 콘솔 이관).
  //   실측: 7B가 이 말을 도구로 안 잇고 RAG로 새어 "완료했습니다" + 엉뚱한 절차를 지어냈다.
  //   담당자가 끝냈다고 말했는데 아무것도 안 닫히고 거짓 확인만 받는 것이라 그냥 두면 안 된다.
  //   도구 설명을 늘리는 방식은 이 저장소에서 반복해 실패했다(CLAUDE.md — 7B는 코드로 잡는다).
  //   ⚠ 취약점·점검 상태를 바꾸는 말과 섞이면 안 된다 — 그건 update_finding_status의 몫이다.
  const 할일완료 = instruction.match(/^(.{2,60}?)\s*(?:완료(?:했|됐|야|입니다)?|끝냈(?:어|다|습니다)|다\s*했(?:어|다|습니다))\s*$/);
  if (할일완료 && available.has("complete_task") && !/취약점|점검|자산|CVE|배정/i.test(instruction)) {
    return { tool: "complete_task", args: { task: 할일완료[1].trim() } };
  }

  // ★ "n번 했어" / "n번 취소" — 절차 카드를 보고 답하는 말. 짧아서 7B가 늘 흘린다.
  //   여기서 잡지 않으면 담당자가 단계를 밟아도 진행이 하나도 안 남는다.
  const 단계말 = instruction.match(/^\s*(\d{1,2})\s*(?:번|단계)\s*(했|완료|끝|취소|되돌|다시)/);
  if (단계말) {
    const 되돌림 = /취소|되돌|다시/.test(단계말[2]);
    const tool = 되돌림 ? "step_undo" : "step_done";
    if (available.has(tool)) return { tool, args: { step: 단계말[1] } };
  }

  // ★ "○○ 어떻게 해?" — 목록 답변이 이렇게 물으라고 **약속한** 말이라 반드시 이어져야 한다.
  //   ⚠ 화면 사용법·개념 질문("이 화면 어떻게 써", "CVSS가 뭐야")과 섞이면 안 된다 —
  //   그건 screenguide·explain의 몫이므로, 열려 있는 내 할 일과 이름이 겹칠 때만 잡는다.
  const 절차말 = instruction.match(/^(.{2,60}?)\s*(?:어떻게\s*(?:해|하지|하나요|합니까)|절차\s*(?:알려|보여)|뭐부터\s*(?:해|하지))\s*[?？]?\s*$/);
  if (절차말 && available.has("work_steps") && !/화면|메뉴|이거|이걸|여기/.test(절차말[1])) {
    const 납작 = (s: string) => s.replace(/\s/g, "");
    const 겹침 = listTasks().some((t) => !t.done &&
      (납작(t.text).includes(납작(절차말[1])) || 납작(절차말[1]).includes(납작(t.text))));
    if (겹침) return { tool: "work_steps", args: { task: 절차말[1].trim() } };
  }

  for (const f of FORCED_INTENTS) {
    if (f.re.test(instruction) && available.has(f.tool)) {
      if (f.tool === "today" && isAssign) continue; // 배정 지시는 today로 강제하지 않음
      if (f.tool === "briefing" && /리포트|보고서|report/i.test(instruction)) continue; // 문서 리포트는 briefing 아님
      // 하드닝 점검 기준 선택: CIS 명시→cis, PC/윈도우→kisa_pc, 네트워크 장비→kisa_net, 그 외→국내 CCE(kisa).
      if (f.tool === "run_hardening_scan") {
        if (isHowtoNotCommand(instruction)) continue; // 방법 질문은 실행하지 않는다(2026-07-29)
        // 스케줄·주기를 묻는 말은 조회다 — 배열 순서상 실행이 먼저 걸리므로 여기서 비켜 준다
        // ("하드닝 점검 스케줄 알려줘"가 실제 점검을 돌리던 것, 검토 지적 2026-07-29).
        if (/스케줄|일정|주기/.test(instruction) && !/돌려|실행해|지금\s*해/.test(instruction)) continue;
        const standard = /\bcis\b|국제/i.test(instruction) ? "cis"
          : /\bpc\b|피시|윈도우|windows/i.test(instruction) ? "kisa_pc"
          : /네트워크\s*장비|스위치|라우터|cisco/i.test(instruction) ? "kisa_net"
          : "kisa";
        return { tool: f.tool, args: { standard } };
      }
      // 온톨로지 조회는 **검색어가 필수**다(agenttools: query required). 빈 인자로 부르면 도구가
      // "무엇의 연결 관계를 찾을지 알려주세요"를 돌려주고, 강제 경로는 예외가 아니면 폴백하지
      // 않으므로 그 되물음이 유일한 근거가 되어 답이 만들어진다 — 도구는 불렀는데 답은 빈
      // '거짓 통과'다(검토 지적 2026-07-29). 질문에서 검색어를 뽑고, 못 뽑으면 강제하지 않는다.
      if (f.tool === "ontology_query") {
        const query = ontologyQueryOf(instruction);
        if (!query) continue; // LLM이 고르게 둔다 — 빈 조회로 되묻느니 낫다
        return { tool: f.tool, args: { query } };
      }
      return { tool: f.tool, args: f.args };
    }
  }
  return null;
}

/**
 * "Log4Shell 완화 방법을 온톨로지에서 찾아줘" → "Log4Shell 완화 방법"
 * 온톨로지·지식그래프라는 말 자체와 지시 어미를 걷어 낸 나머지가 검색어다.
 */
export function ontologyQueryOf(instruction: string): string {
  const q = instruction
    .replace(/온톨로지|지식\s*그래프|트리플/g, " ")
    // "뭐 들어있어?" 같은 되묻기 말은 검색어가 아니라 **현황 질문**이다 — 걷어 내면 빈 문자열이
    // 되어 강제 분기가 물러나고, 그런 질문은 LLM이 knowledge_status로 보낸다.
    .replace(/뭐|무엇|어떤\s*것|들어\s*있|들어|있어|있나|있는지|내용/g, " ")
    .replace(/에서|에|을|를|좀|한번|찾아|검색|조회|보여|알려|해|줘|주세요|봐|봐줘|줄래|해줘|하기|\?|!|\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return q.length >= 2 ? q.slice(0, 60) : "";
}

// 자동화 작업 원장 기록(계획서 중-2). 매핑에 없는 도구는 세지 않고, 평가 게이트·QA 실행은
// scope.qa로 걸러 아예 담지 않는다 — 시험이 고객의 절감 숫자를 만들면 안 된다.
function recordToolWork(toolName: string, scope?: ToolScope): void {
  const kind = TOOL_WORK_KIND[toolName];
  if (!kind) return;
  recordWork({ kind, detail: toolName, actor: scope?.actor ?? null, source: "chat", qa: scope?.qa });
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
        reportProgress("tools", `${tool.label} 실행 중`);
        const result = String(await tool.run(forced.args));
        recordToolWork(forced.tool, scope);
        const calls: AgentToolCall[] = [{ tool: forced.tool, args: forced.args, result }];
        const direct = directAnswerFor(calls);
        if (!direct) reportProgress("write", "조회 결과로 답을 쓰고 있습니다");
        const composed = direct ?? (await composeFinalAnswer(instruction, calls, context));
        reportProgress("review", "답변을 검수하고 있습니다");
        return { output: guardAgainstDenial(composed, calls), toolCalls: calls };
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
    // 결정 프롬프트도 느리다(실측 5.8초) — 침묵 구간이 되지 않게 지금 뭘 하는지 알린다.
    reportProgress("understand", calls.length === 0 ? "무엇을 할지 정하고 있습니다" : "다음 단계를 정하고 있습니다");
    const raw = await chat({
      agentId: "orchestrator",
      message: decisionPrompt(instruction, calls, context, scope, calls.length === 0 ? fewshot : ""),
      responseSchema: DECISION_SCHEMA,
      maxTokens: 300,
      // ⚠ trusted — 이 message는 **도구 카탈로그가 실린 우리 결정 프롬프트**다. 사용자 지시는
      //   dispatcher가 이미 검사했다. 안 켜면 우리 프롬프트가 검사 대상이 되는데, 도구 설명에
      //   "탈옥·프롬프트 주입" 같은 보안 낱말이 들어 있어 **우리 규칙에 우리가 걸린다**.
      //   flag 모드에서는 로그만 쌓여 보이지 않았고, 차단 모드에서 제품이 죽었다(2026-07-30).
      trusted: true,
    }).catch(() => "");
    const decision = parseDecision(raw);
    if (!decision) return null; // LLM 다운·형식 불가 → 기존 채팅 폴백

    if (decision.action === "final") {
      if (calls.length === 0) return null; // 도구가 필요 없는 일반 대화 → 기존 채팅(RAG·이력)이 더 낫다
      const direct = directAnswerFor(calls);
      if (!direct) reportProgress("write", `조회 결과 ${calls.length}건으로 답을 쓰고 있습니다`);
      const composed = direct ?? (await composeFinalAnswer(instruction, calls, context));
      reportProgress("review", "답변을 검수하고 있습니다");
      const output = guardAgainstDenial(composed, calls);
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
        // 진행 카드: 도구를 **실명으로** 알린다. 전체 개수는 미리 모르므로 %는 붙이지 않는다(정직 원칙).
        reportProgress("tools", `${tool.label} 실행 중${calls.length > 0 ? ` — ${calls.length + 1}번째 도구` : ""}`);
        try {
          result = String(await tool.run(args));
          recordToolWork(tool.name, scope);
        } catch (err) {
          result = `도구 실행 실패: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
    calls.push({ tool: decision.tool ?? "(없음)", args, result });

    // directAnswer 도구가 성공했고 **조회만 요구한 지시**면 다시 물어보지 않는다 — 그 결과가 곧 답이다.
    // 예전엔 여기서 루프를 한 바퀴 더 돌며 "더 할 일 있나?"를 LLM에 물었는데, 그 한 번이 프롬프트
    // 2,800~4,700토큰을 다시 읽느라 5초 넘게 걸렸다(2026-07-30 실측: 12토큰 생성에 5.8초).
    // 질문 하나가 LLM 호출 3번·14초였고 그중 한 번은 결과를 바꾸지 않는 순수 낭비였다.
    //
    // ⚠ 단, 조회 결과가 **쓰기의 재료**인 흐름은 끊으면 안 된다("오늘 제일 급한 거 김보안한테
    //   배정해줘" → today로 찾고 assign_finding으로 이어간다 — 시험이 이걸 잡았다).
    //   그래서 행동을 요구하는 말투면 종전대로 루프를 계속한다. 못 알아보면 느려질 뿐 틀리지는
    //   않는다 — 안전한 실패 방향으로 기울여 둔다.
    const early = directAnswerFor(calls);
    if (early && !ACTION_INTENT_RE.test(instruction)) {
      return { output: guardAgainstDenial(early, calls), toolCalls: calls };
    }
  }

  // 반복 상한 도달 — 지금까지 모은 결과로라도 답을 만든다(도구를 썼을 때만).
  if (calls.length === 0) return null;
  const direct = directAnswerFor(calls);
  const output = guardAgainstDenial(direct ?? (await composeFinalAnswer(instruction, calls, context)), calls);
  return { output, toolCalls: calls };
}
