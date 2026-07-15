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
  maxTokens?: number; // 지정 시 응답 길이 상한(데이터셋 변환처럼 긴 JSON 출력이 필요할 때)
  // true면 단기 기억(대화 이력)과 장기 기억(RAG) 자동 주입을 켠다 — 대화형 채팅 라우트 전용.
  // dispatcher/analysis 같은 프로그램적 단발 호출은 기본값(false)으로 이력에 끼어들지 않는다.
  remember?: boolean;
}

// ── 단기 기억: 에이전트별 최근 대화 이력 ─────────────────────────────────────
// 의도적으로 인메모리·휘발성이다(agents.ts의 status와 같은 원칙) — 서버 재시작이면 사라진다.
// 영속 대화방 개념이 생기기 전까지는 에이전트당 하나의 공유 이력이며, 최근 HISTORY_LIMIT개
// 메시지만 유지해 컨텍스트 창을 보호한다.
const HISTORY_LIMIT = 20; // 10턴 (user+assistant 쌍 기준)

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const histories = new Map<string, ChatTurn[]>();

export function resetChatHistoryForTests(): void {
  histories.clear();
}

// ── 장기 기억: LanceDB 지식 베이스 검색 결과를 참고 자료로 주입 ──────────────
// 임베딩 서버가 없거나 지식 베이스가 비어 있으면 조용히 생략한다 — RAG가 안 된다고
// 채팅 자체가 죽으면 안 된다. (memory.ts가 llm.ts의 embed를 쓰므로 순환 참조를 피해
// 호출 시점에 동적 import.)
async function ragContextFor(message: string, agentId: string): Promise<string | null> {
  try {
    const { queryMemory } = await import("./memory.js");
    // 에이전트 전용 지식 + 전역 지식만 검색 (다른 에이전트 전용 문서는 제외).
    const chunks = await queryMemory(message, 4, agentId);
    if (chunks.length === 0) return null;
    return (
      "참고 자료 — 사내 지식 베이스(장기 기억)에서 검색된 관련 내용입니다. 답변에 활용하되, 질문과 무관하면 무시하세요.\n" +
      chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n")
    );
  } catch {
    return null;
  }
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
  const history = args.remember ? (histories.get(args.agentId) ?? []) : [];
  const rag = args.remember ? await ragContextFor(args.message, args.agentId) : null;

  // RAG 참고자료는 별도 system 메시지가 아니라 시스템 프롬프트에 합친다 — Mistral 계열
  // (Lily 포함) 채팅 템플릿은 system 메시지 2개를 "roles must alternate" 에러로 거부한다.
  const systemContent = rag ? `${systemPromptFor(args.agentId)}\n\n${rag}` : systemPromptFor(args.agentId);
  const messages = [{ role: "system", content: systemContent }, ...history, { role: "user", content: args.message }];

  const res = await fetch(`${LOCAL_LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", messages, ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}) }),
  }).catch(() => null);

  if (!res || !res.ok) {
    return "[로컬 LLM 서버에 연결할 수 없습니다. /api/localengine/start 로 먼저 기동하세요.]";
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const reply = data.choices?.[0]?.message?.content ?? "";

  if (args.remember && reply) {
    const updated = [...history, { role: "user" as const, content: args.message }, { role: "assistant" as const, content: reply }];
    histories.set(args.agentId, updated.slice(-HISTORY_LIMIT));
  }
  return reply;
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
      // 에이전트에 전용 모델이 할당돼 있으면 채팅 전에 그 모델로 스왑한다(없으면 전역 모델 유지).
      const { ensureAgentModel } = await import("./localengine.js");
      await ensureAgentModel(String(req.body.agentId ?? ""));
      // 대화형 라우트는 단기 기억(이력) + 장기 기억(RAG) 주입을 켠다.
      res.json({ reply: await chat({ ...req.body, remember: true }) });
    })
  );
}
