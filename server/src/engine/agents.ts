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
  desc: string; // 업무 연계 설명 — 파이프라인에서 누구와 어떻게 이어지는지(카드에 표시)
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
  desc: string;
  defaultStatus: AgentStatus;
}

// 에이전트 로스터 — "역할극 페르소나"를 줄이고 사내 데이터(RAG·온톨로지) 근거로 판단·검증하는
// 소수 정예로 재구성(2026-07-17). 워크플로우(dispatch: 스캔→분석→[GIJO 부연]→리포트) + 조율 + 엄격 그라운딩(GIJO Agent, id=normaltic).
// 제거된 페르소나(침투테스트·SBOM·CTI·모델진화)는 dispatch에 안 쓰이고 전용 화면·엔진(SBOM/CTI/합성)이
// 이미 담당하므로 일반 LLM 답변만 내던 중복이었다. LLM은 gijo + 보안LLM 2개만 사용.
// 이름은 기능명 영문으로 통일(2026-07-17 확정). id는 라우팅·모델키·온톨로지 스코프에 쓰이므로 유지.
const AGENT_DEFS: AgentBase[] = [
  {
    id: "orchestrator",
    name: "Security Orchestrator",
    role: "작업 분배 · 결과 취합",
    desc: "지시를 해석해 Scan → Analyze → Report 순으로 작업을 나눠 맡기고, 각 단계 결과를 취합해 최종 응답으로 정리합니다.",
    defaultStatus: "watching",
  },
  {
    id: "scan",
    name: "Scan Agent",
    role: "초기 데이터 해석 · 자산 반영",
    desc: "업로드·스캔(ModelScan) 결과로 나온 모델 취약점을 위협 관점에서 해석·요약하고 자산 finding으로 반영합니다. 결과는 Analyze Agent와 GIJO Agent로 이어집니다.",
    defaultStatus: "idle",
  },
  {
    id: "analysis",
    name: "Analyze Agent",
    role: "AI 지식·모델 관리 · 우선순위 판단",
    desc: "기억·학습(RAG)·온톨로지·학습 루프 등 AI 지식모델 관리를 담당하고, 스캔 finding의 우선순위를 판단합니다. 학습 데이터셋 Q&A 생성도 이 에이전트 담당입니다.",
    defaultStatus: "idle",
  },
  {
    id: "report",
    name: "Report Agent",
    role: "내부 보고서 작성 · 결과 레포팅",
    desc: "작업 결과를 내부 보고용 문서로 정리합니다. 파이프라인 마지막 단계에서 스캔·분석·부연 결과를 받아 보고서를 만듭니다.",
    defaultStatus: "idle",
  },
  // 딥웹·다크웹 CTI 피드 기반 위협 모니터링 + CTI ↔ 자산 자동 매칭(ctimatch 엔진) 담당. 항시 감시(watching).
  {
    id: "ti",
    name: "TI Agent",
    role: "위협 인텔리전스 · CTI 모니터링",
    desc: "딥웹·다크웹 CTI 피드 구독 기반으로 유출정보·위협을 모니터링합니다. 위협 인텔 텍스트를 자산 인벤토리(자산명·컴포넌트·CVE·AI-BOM)와 대조해 영향 자산을 자동 매칭해 알립니다.",
    defaultStatus: "watching",
  },
  // 사내 지식베이스(RAG)+온톨로지에 적재된 자료만 근거로 설명하고 실제 사례를 검색해 준다(엄격 그라운딩).
  {
    id: "normaltic",
    name: "GIJO Agent",
    role: "용어 해설 · 사례 부연(사내 지식)",
    desc: "Scan·Analyze 결과에 나온 용어를 사내 지식베이스 근거로 해설하고 실제 사례를 부연합니다. 복합 지시에서 스캔·분석이 끝나면 자동 투입됩니다.",
    defaultStatus: "watching",
  },
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
    desc: base.desc,
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
