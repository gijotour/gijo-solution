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
import { listAgentTools, findAgentTool, toolCatalogText, validateToolArgs, buildApproval, PendingApproval } from "./agenttools";
import { emitCollaboration } from "./collaboration";

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

function decisionPrompt(instruction: string, calls: AgentToolCall[], context = ""): string {
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
    toolCatalogText(),
    "",
    "규칙:",
    '- 반드시 JSON 객체 하나만 출력한다: {"action":"tool","tool":"도구이름","args":{...}} 또는 {"action":"final","answer":"직접 답변"}',
    "- 지시와 맞는 도구가 없으면 action=final로 답한다. 도구 이름을 지어내지 않는다.",
    "- args 값은 모두 문자열로 쓴다.",
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
async function composeFinalAnswer(instruction: string, calls: AgentToolCall[], context = ""): Promise<string> {
  const facts = calls.map((c, i) => `[${i + 1}] ${c.tool}: ${c.result}`).join("\n");
  return chat({
    agentId: "orchestrator",
    message: [
      ...(context ? [context, ""] : []),
      `사용자 지시: "${instruction}"`,
      "",
      "방금 시스템에서 조회한 실제 데이터:",
      facts,
      "",
      "위 데이터만 근거로 지시에 대한 최종 답변을 작성하라. 데이터에 없는 내용은 지어내지 마라.",
    ].join("\n"),
    remember: true,
  });
}

// 지시를 에이전트 루프로 처리한다. 도구를 하나도 쓰지 않았거나 결정이 파싱 불가면 null
// (호출자가 기존 채팅으로 폴백). 도구를 썼으면 실행 내역과 최종 답변을 돌려준다.
export async function runAgentLoop(instruction: string, context = ""): Promise<AgentLoopResult | null> {
  if (listAgentTools().length === 0) return null;

  const calls: AgentToolCall[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const raw = await chat({
      agentId: "orchestrator",
      message: decisionPrompt(instruction, calls, context),
      responseSchema: DECISION_SCHEMA,
      maxTokens: 300,
    }).catch(() => "");
    const decision = parseDecision(raw);
    if (!decision) return null; // LLM 다운·형식 불가 → 기존 채팅 폴백

    if (decision.action === "final") {
      if (calls.length === 0) return null; // 도구가 필요 없는 일반 대화 → 기존 채팅(RAG·이력)이 더 낫다
      const output = await composeFinalAnswer(instruction, calls, context);
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
  const output = await composeFinalAnswer(instruction, calls, context);
  return { output, toolCalls: calls };
}
