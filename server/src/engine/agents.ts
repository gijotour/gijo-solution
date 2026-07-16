// engine/agents.ts — 에이전트 정의 및 상태 관리 (서버 측, 전 클라이언트 공유)

import type { Express } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { db } from "../db";
import { isModelAvailable } from "./localengine";

export type AgentStatus = "idle" | "working" | "watching";

export interface AgentDefinition {
  id: string;
  name: string; // 표시 이름(커스텀 이름이 있으면 그것, 없으면 기본)
  defaultName: string; // 원래 기본 이름
  role: string;
  status: AgentStatus;
  defaultStatus: AgentStatus;
  // 이 에이전트 전용으로 할당된 모델. null이면 "전역 모델 따름"(현재 로컬 엔진에 떠 있는 모델).
  // app_state에 영속화되며, 채팅 시 localengine.ensureAgentModel이 필요하면 스왑한다.
  assignedModelId: string | null;
}

// status는 의도적으로 영속화하지 않는다 — "지금 누가 뭘 하고 있는지"를 나타내는 휘발성 라이브
// 신호라, 재시작 후에도 남아있으면 죽은 작업을 살아있는 것처럼 보이게 한다. 반면 모델 할당은
// 설정이므로 app_state에 영속화한다(아래 getAgentModel/setAgentModel).
// 예전에는 여기 brainModelId가 하드코딩돼 있었는데(qwen3-30b-a3b 등 배치도 안 된 모델), 실제
// 채팅은 전역 모델 하나를 공유하므로 "동작하는 척"이었다 — 제거하고 실제 할당으로 대체했다.
interface AgentBase {
  id: string;
  name: string;
  role: string;
  defaultStatus: AgentStatus;
}

const AGENT_DEFS: AgentBase[] = [
  { id: "orchestrator", name: "오케스트레이터", role: "작업 분배 · 결과 취합", defaultStatus: "watching" },
  { id: "scan", name: "스캔 에이전트", role: "정적분석 실행 (ModelScan)", defaultStatus: "idle" },
  { id: "pentest", name: "침투테스트 에이전트", role: "익스플로잇 검증 (Penligent)", defaultStatus: "idle" },
  { id: "analysis", name: "분석 에이전트", role: "우선순위 판단 · 설명", defaultStatus: "idle" },
  { id: "sbom", name: "SBOM 에이전트", role: "SBOM 생성 · 정리", defaultStatus: "idle" },
  { id: "cti", name: "CTI 에이전트", role: "딥웹 · 다크웹 감시", defaultStatus: "watching" },
  { id: "report", name: "리포트 에이전트", role: "내부 보고서 작성", defaultStatus: "idle" },
  { id: "model-evolution", name: "모델 진화 에이전트", role: "보안 특화 LLM 병합", defaultStatus: "idle" },
  // 사내 지식베이스(RAG)에 적재된 자료만 근거로 취약점·코드를 설명하고 실제 사례를 검색해 준다.
  // 표시 이름은 기본 "노말틱"이며 다른 에이전트처럼 UI에서 바꿀 수 있다.
  { id: "normaltic", name: "노말틱", role: "취약점·코드 사내 지식 해설·사례 검색", defaultStatus: "watching" },
];

const liveStatus = new Map<string, AgentStatus>(AGENT_DEFS.map((a) => [a.id, a.defaultStatus]));

const getModelStmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
const setModelStmt = db.prepare(
  "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
const delModelStmt = db.prepare("DELETE FROM app_state WHERE key = ?");
const modelKey = (agentId: string) => `agentModel:${agentId}`;
const nameKey = (agentId: string) => `agentName:${agentId}`;

export function getAgentModel(agentId: string): string | null {
  return (getModelStmt.get(modelKey(agentId)) as { value: string } | undefined)?.value ?? null;
}

// 팀 커스터마이징: 에이전트 표시 이름을 조직이 원하는 대로 바꾼다("우리 팀" 로스터). 비우면 기본 이름.
export function getAgentName(agentId: string): string | null {
  return (getModelStmt.get(nameKey(agentId)) as { value: string } | undefined)?.value ?? null;
}

export function setAgentName(agentId: string, name: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  const trimmed = (name ?? "").trim();
  if (trimmed === "") {
    delModelStmt.run(nameKey(agentId));
    return;
  }
  if (trimmed.length > 30) throw new Error("이름은 30자 이내여야 합니다");
  setModelStmt.run(nameKey(agentId), trimmed);
}

// modelId=null 이면 할당 해제(전역 모델 따름). 존재하지 않는 모델은 거부한다.
export function setAgentModel(agentId: string, modelId: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  if (modelId === null || modelId === "") {
    delModelStmt.run(modelKey(agentId));
    return;
  }
  if (!isModelAvailable(modelId)) throw new Error(`배치되지 않은 모델입니다: ${modelId}`);
  setModelStmt.run(modelKey(agentId), modelId);
}

function toAgent(base: AgentBase): AgentDefinition {
  return {
    id: base.id,
    name: getAgentName(base.id) ?? base.name, // 커스텀 이름이 있으면 우선
    defaultName: base.name, // 원래 기본 이름(되돌리기·비교용)
    role: base.role,
    defaultStatus: base.defaultStatus,
    status: liveStatus.get(base.id) ?? base.defaultStatus,
    assignedModelId: getAgentModel(base.id),
  };
}

export function getAgentById(id: string): AgentDefinition | undefined {
  const base = AGENT_DEFS.find((a) => a.id === id);
  return base ? toAgent(base) : undefined;
}

export function setAgentStatus(id: string, status: AgentStatus): AgentDefinition | undefined {
  if (!liveStatus.has(id)) return undefined;
  liveStatus.set(id, status);
  return getAgentById(id);
}

export function resetAgentToDefault(id: string): AgentDefinition | undefined {
  const base = AGENT_DEFS.find((a) => a.id === id);
  if (!base) return undefined;
  liveStatus.set(id, base.defaultStatus);
  return getAgentById(id);
}

export function listAgents(): AgentDefinition[] {
  return AGENT_DEFS.map(toAgent);
}

export function registerAgentsRoutes(app: Express): void {
  app.get("/api/agents", authMiddleware, (_req, res) => res.json(listAgents()));

  // 에이전트 전용 모델 할당 — admin만. body.modelId=null 이면 할당 해제(전역 모델 따름).
  app.post("/api/agents/:id/model", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentModel(String(req.params.id), req.body.modelId ?? null);
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 에이전트 표시 이름 변경("우리 팀" 로스터). body.name=null/빈값이면 기본 이름으로 되돌림.
  app.post("/api/agents/:id/name", authMiddleware, (req, res) => {
    try {
      setAgentName(String(req.params.id), req.body.name ?? null);
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
