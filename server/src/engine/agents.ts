// engine/agents.ts — 에이전트 정의 및 상태 관리 (서버 측, 전 클라이언트 공유)

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";

export type AgentStatus = "idle" | "working" | "watching";

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  brainModelId: string;
  status: AgentStatus;
  defaultStatus: AgentStatus;
}

// 의도적으로 영속화하지 않는다(db.ts 도입 이후에도 그대로 인메모리) — status(idle/working/watching)는
// "지금 누가 뭘 하고 있는지"를 나타내는 휘발성 라이브 신호라, 재시작 후에도 남아있으면 죽은 작업을
// 살아있는 것처럼 보이게 한다. 서버 프로세스가 살아있는 동안만 유지되며 모든 클라이언트(보안담당자)가
// 이 하나의 상태를 공유해서 본다 (CS 전환의 핵심 이점).
const agents: AgentDefinition[] = [
  { id: "orchestrator", name: "오케스트레이터", role: "작업 분배 · 결과 취합", brainModelId: "qwen3-30b-a3b", status: "watching", defaultStatus: "watching" },
  { id: "scan", name: "스캔 에이전트", role: "정적분석 실행 (ModelScan)", brainModelId: "qwen3-30b-a3b", status: "idle", defaultStatus: "idle" },
  { id: "pentest", name: "침투테스트 에이전트", role: "익스플로잇 검증 (Penligent)", brainModelId: "deephat-v1-7b", status: "idle", defaultStatus: "idle" },
  { id: "analysis", name: "분석 에이전트", role: "우선순위 판단 · 설명", brainModelId: "foundation-sec-8b", status: "idle", defaultStatus: "idle" },
  { id: "sbom", name: "SBOM 에이전트", role: "SBOM 생성 · 정리", brainModelId: "qwen3-30b-a3b", status: "idle", defaultStatus: "idle" },
  { id: "cti", name: "CTI 에이전트", role: "딥웹 · 다크웹 감시", brainModelId: "qwen3-30b-a3b", status: "watching", defaultStatus: "watching" },
  { id: "report", name: "리포트 에이전트", role: "내부 보고서 작성", brainModelId: "qwen3-30b-a3b", status: "idle", defaultStatus: "idle" },
  { id: "model-evolution", name: "모델 진화 에이전트", role: "보안 특화 LLM 병합", brainModelId: "merge-experiment", status: "idle", defaultStatus: "idle" },
];

export function getAgentById(id: string): AgentDefinition | undefined {
  return agents.find((a) => a.id === id);
}

export function setAgentStatus(id: string, status: AgentStatus): AgentDefinition | undefined {
  const agent = getAgentById(id);
  if (agent) agent.status = status;
  return agent;
}

export function resetAgentToDefault(id: string): AgentDefinition | undefined {
  const agent = getAgentById(id);
  if (agent) agent.status = agent.defaultStatus;
  return agent;
}

export function listAgents(): AgentDefinition[] {
  return agents;
}

export function registerAgentsRoutes(app: Express): void {
  app.get("/api/agents", authMiddleware, (_req, res) => res.json(listAgents()));
}
