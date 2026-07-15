// engine/llm.ts — LLM 호출 레이어. llama-server(OpenAI 호환 API)에 요청을 보내는 얇은 클라이언트.
// 서버 프로세스 안에서 localengine.ts가 띄운 llama-server를 호출한다 (같은 머신, localhost).

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { getAgentById } from "./agents";
import { emitLlmActivity, modelBasename } from "./llmactivity";

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

  // 실시간 스트림용: 어느 에이전트가 지금 로컬 LLM으로 추론하는지 눈에 보이게 한다.
  const agentName = getAgentById(args.agentId)?.name ?? args.agentId ?? "에이전트";
  const started = Date.now();

  // 멀티모델 풀: 에이전트에 할당된 모델을 (필요하면 로드하고) 그 모델이 서빙되는 URL을 받는다.
  // 이렇게 해야 서로 다른 모델을 쓰는 에이전트들이 스왑 없이 각자 포트에서 병렬로 답한다.
  // (순환참조 회피 위해 동적 import. localengine을 못 불러오면 기본 URL로 폴백.)
  const baseUrl = await import("./localengine.js")
    .then((m) => m.ensureAgentModel(args.agentId))
    .catch(() => LOCAL_LLM_BASE_URL);

  emitLlmActivity({ kind: "chat", phase: "start", agent: agentName, detail: "추론 요청" });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", messages, ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}) }),
  }).catch(() => null);

  if (!res || !res.ok) {
    emitLlmActivity({ kind: "chat", phase: "error", agent: agentName, detail: "로컬 LLM 연결 실패" });
    return "[로컬 LLM 서버에 연결할 수 없습니다. /api/localengine/start 로 먼저 기동하세요.]";
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    timings?: { predicted_per_second?: number };
  };
  const reply = data.choices?.[0]?.message?.content ?? "";

  // llama.cpp 실측치(usage·timings)를 그대로 실어 보낸다 — 값이 나오면 실제 추론이 일어난 것.
  emitLlmActivity({
    kind: "chat",
    phase: "done",
    agent: agentName,
    model: modelBasename(data.model),
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    tokensPerSec: data.timings?.predicted_per_second ? Math.round(data.timings.predicted_per_second) : undefined,
    latencyMs: Date.now() - started,
    detail: "응답 완료",
  });

  if (args.remember && reply) {
    const updated = [...history, { role: "user" as const, content: args.message }, { role: "assistant" as const, content: reply }];
    histories.set(args.agentId, updated.slice(-HISTORY_LIMIT));
  }
  return reply;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const started = Date.now();
  const res = await fetch(`${EMBEDDING_SERVER_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", input: texts }),
  }).catch(() => null);

  if (!res || !res.ok) {
    emitLlmActivity({ kind: "embed", phase: "error", model: "임베딩", detail: "임베딩 서버 연결 실패" });
    throw new Error(
      "임베딩 서버에 연결할 수 없습니다. 별도 llama-server를 --embedding 플래그로 " + EMBEDDING_SERVER_URL + " 에 기동하세요."
    );
  }
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  if (!data.data) throw new Error("임베딩 서버 응답 형식이 올바르지 않습니다.");
  // 장기 기억 검색·수집 때 임베딩이 실제로 도는 것도 보이게 한다(추론 파이프라인의 일부).
  emitLlmActivity({
    kind: "embed",
    phase: "done",
    model: "임베딩 서버",
    detail: `${texts.length}개 임베딩`,
    latencyMs: Date.now() - started,
  });
  return data.data.map((d) => d.embedding);
}

export function registerLlmRoutes(app: Express): void {
  app.post(
    "/api/llm/chat",
    authMiddleware,
    asyncRoute(async (req, res) => {
      // 모델 라우팅(에이전트 할당 모델 로드·URL 선택)은 chat() 안에서 처리한다.
      // 대화형 라우트는 단기 기억(이력) + 장기 기억(RAG) 주입을 켠다.
      res.json({ reply: await chat({ ...req.body, remember: true }) });
    })
  );
}
