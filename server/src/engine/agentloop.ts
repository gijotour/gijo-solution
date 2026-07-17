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
    return null; // LLM 연결 실패 안내문(⚠…) 등 JSON이 아니면 폴백
  }
}

function decisionPrompt(instruction: string, calls: AgentToolCall[]): string {
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
    ...history,
    "",
    `사용자 지시: "${instruction}"`,
  ].join("\n");
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
async function composeFinalAnswer(instruction: string, calls: AgentToolCall[]): Promise<string> {
  const facts = calls.map((c, i) => `[${i + 1}] ${c.tool}: ${c.result}`).join("\n");
  return chat({
    agentId: "orchestrator",
    message: [
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
export async function runAgentLoop(instruction: string): Promise<AgentLoopResult | null> {
  if (listAgentTools().length === 0) return null;

  const calls: AgentToolCall[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const raw = await chat({
      agentId: "orchestrator",
      message: decisionPrompt(instruction, calls),
      responseSchema: DECISION_SCHEMA,
      maxTokens: 300,
    }).catch(() => "");
    const decision = parseDecision(raw);
    if (!decision) return null; // LLM 다운·형식 불가 → 기존 채팅 폴백

    if (decision.action === "final") {
      if (calls.length === 0) return null; // 도구가 필요 없는 일반 대화 → 기존 채팅(RAG·이력)이 더 낫다
      const output = await composeFinalAnswer(instruction, calls);
      return { output, toolCalls: calls };
    }

    // action=tool — 규칙 검증이 LLM 출력 뒤에 항상 위치한다(QA 원칙).
    const tool = decision.tool ? findAgentTool(decision.tool) : undefined;
    const args = decision.args ?? {};
    let result: string;
    if (!tool) {
      result = `존재하지 않는 도구: ${decision.tool ?? "(없음)"}. 사용 가능한 도구 중에서만 골라라.`;
    } else if (tool.write) {
      // 쓰기 도구는 여기서 실행하지 않는다 — 값을 결재판으로 만들어 돌려주고, 사람이 승인해야
      // /api/agent/approve에서 실행된다(오발동 방지). 루프는 여기서 끝난다.
      const approval = buildApproval(tool, args, instruction);
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
  const output = await composeFinalAnswer(instruction, calls);
  return { output, toolCalls: calls };
}
