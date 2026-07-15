// engine/llm.ts — LLM 호출 레이어. llama-server(OpenAI 호환 API)에 요청을 보내는 얇은 클라이언트.
// 서버 프로세스 안에서 localengine.ts가 띄운 llama-server를 호출한다 (같은 머신, localhost).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { getAgentById } from "./agents";

const LOCAL_LLM_BASE_URL = process.env.GIJO_LOCAL_LLM_URL ?? "http://localhost:8080/v1";
// 6.2절: 임베딩 모델(BGE-M3 등)은 채팅용 LLM과 별도 llama-server 프로세스로 동시 서빙한다 (RTX 3090 VRAM 여유 활용).
const EMBEDDING_SERVER_URL = process.env.GIJO_EMBEDDING_URL ?? "http://localhost:8081/v1";

export interface ChatArgs {
  agentId: string;
  message: string;
}

// 시스템 프롬프트가 아예 없으면 모델이 역할·언어 지시를 전혀 못 받아 주제 이탈·영어 혼용·환각이
// 심해진다(특히 영어 중심 모델). 모든 에이전트 호출에 한국어 기본 처리 + 역할 + 환각 억제를 깐다.
export function systemPromptFor(agentId: string): string {
  const agent = getAgentById(agentId);
  const identity = agent
    ? `당신은 GIJO AS(AI 자산 보안 관리 플랫폼)의 "${agent.name}"입니다. 담당 역할: ${agent.role}.`
    : `당신은 GIJO AS(AI 자산 보안 관리 플랫폼)의 보안 어시스턴트입니다.`;
  return [
    identity,
    "응답 규칙:",
    "- 반드시 한국어로 답합니다. 어색한 직역 없이 문맥이 자연스럽고 매끄러운 한글 문장을 사용해야 합니다. 코드, 명령어, CVE 번호, 제품명 등 고유 표기는 원문을 유지합니다.",
    "- 상대는 기업 보안담당자입니다. 불필요한 미사여구나 서론/결론 없이 간결하고 정확하게 핵심만 답합니다.",
    "- 확인되지 않은 사실을 지어내지 않습니다. 모르면 모른다고 답합니다.",
    "- 질문과 직접적인 관계가 없는 내용은 절대 언급하지 말고 완전히 배제하십시오.",
    "- 답변은 군더더기 없이 단도직입적으로 본론만 제시해야 합니다.",
  ].join("\n");
}

export async function chat(args: ChatArgs): Promise<string> {
  const res = await fetch(`${LOCAL_LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local",
      messages: [
        { role: "system", content: systemPromptFor(args.agentId) },
        { role: "user", content: args.message },
      ],
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    return "[로컬 LLM 서버에 연결할 수 없습니다. /api/localengine/start 로 먼저 기동하세요.]";
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${EMBEDDING_SERVER_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: texts }),
  }).catch(() => null);

  if (!res || !res.ok) {
    throw new Error(
      "임베딩 서버에 연결할 수 없습니다. 별도 llama-server를 --embedding 플래그로 " + EMBEDDING_SERVER_URL + " 에 기동하세요."
    );
  }
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  if (!data.data) throw new Error("임베딩 서버 응답 형식이 올바르지 않습니다.");
  return data.data.map((d) => d.embedding);
}

export function registerLlmRoutes(app: Express): void {
  app.post(
    "/api/llm/chat",
    authMiddleware,
    asyncRoute(async (req, res) => {
      res.json({ reply: await chat(req.body) });
    })
  );
}
