// engine/agents.ts — 에이전트 정의 및 상태 관리 (서버 측, 전 클라이언트 공유)

import type { Express } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { db } from "../db";
import { isModelAvailable } from "./localengine";
import { getAdapter } from "./adapters";

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
  // 전문가 LoRA 어댑터(재설계 1단계, 2026-08-08). null이면 베이스 그대로 — 어댑터는 게이트
  // 통과 채택분만 배정할 수 있고, 배정돼 있어도 서빙 모델에 적재되지 않았으면 조용히 무시된다.
  assignedAdapterId: string | null;
  /** 팀원별 두뇌 위치 — null이면 전역 따름(기본). "local" | "remote" */
  assignedLocation: AgentLocation | null;
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

// ── 전문가 어댑터 배정 (재설계 1단계) ──────────────────────────────────
const adapterKey = (agentId: string) => `agentAdapter:${agentId}`;

export function getAgentAdapter(agentId: string): string | null {
  return (getModelStmt.get(adapterKey(agentId)) as { value: string } | undefined)?.value ?? null;
}

// adapterId=null 이면 해제(베이스 그대로). 오케스트레이터는 금지 — 라우팅은 결정성이 생명이라
// 어댑터로 답 분포가 흔들리면 안 된다(파인튜닝이 라우팅을 8/8→7/8로 떨어뜨린 실측, 2026-08-05).
// 채택(adopted)된 어댑터만 배정할 수 있다 — 등록만 된 어댑터는 게이트를 안 거친 것이다.
export function setAgentAdapter(agentId: string, adapterId: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  if (adapterId === null || adapterId === "") {
    delModelStmt.run(adapterKey(agentId));
    return;
  }
  if (agentId === "orchestrator") throw new Error("총괄(orchestrator)에는 어댑터를 배정할 수 없습니다 — 라우팅 결정성 보호");
  const adapter = getAdapter(adapterId);
  if (!adapter) throw new Error(`등록되지 않은 어댑터입니다: ${adapterId}`);
  if (!adapter.adopted) throw new Error(`채택되지 않은 어댑터입니다: ${adapterId} — 평가 게이트 통과 후 채택하면 배정할 수 있습니다`);
  setModelStmt.run(adapterKey(agentId), adapterId);
}

// ── 팀원별 두뇌 **위치** (2026-08-18 사장님 지시: "여러 개의 두뇌가 공동작업") ──────────
//
// ■ 무엇을 푸는가
//   로컬 모델은 이미 팀원별로 갈린다(`localengine.ts ensureAgentModel`). 어댑터도 요청별로 갈린다
//   (`agentRequestExtras`). 그런데 **원격은 전역 on/off 하나**였다(`llm.ts`가 부르는
//   `remoteLlmTarget()`이 agentId를 안 받는다) — 켜면 전원 원격, 끄면 전원 로컬.
//   그래서 「총괄은 로컬 빠른 두뇌로 판단하고, 분석가는 원격 큰 두뇌로 깊게」가 **불가능**했다.
//   여기 한 칸을 더해 그것을 연다.
//
// ■ 값의 뜻 — 셋뿐이다
//   · null(기본) — **전역을 따른다.** 지금까지와 똑같이 동작한다(무변경 보장).
//   · "local"    — 이 팀원은 **원격이 켜져 있어도** 이 PC에서 돈다.
//   · "remote"   — 이 팀원은 원격을 쓴다. ⚠ **전역 원격이 꺼져 있으면 소용없다** —
//                  주소·on/off는 여전히 전역 하나(`remotellm.ts` STATE_KEY="remote_llm")다.
//                  즉 관문이 두 겹이다: ① 전역이 켜졌나 ② 이 팀원이 쓰겠다 했나.
//
// ⚠ **"cloud"는 아직 받지 않는다.** `cloudllm.ts`의 `askCloud`/`cloudComplete`가 agentId를
//   아예 안 받고, 클라우드는 RAG를 구조적으로 안 싣는 별도 경로다(`cloudllm.ts:5`).
//   저장만 하고 라우팅이 안 되면 「설계는 됐는데 쓰인 적 없는 값」이 된다 — 이 저장소가 반복해
//   겪은 그 함정이라, **쓸 수 있게 되기 전에는 저장도 안 한다.**
const AGENT_LOCATIONS = ["local", "remote"] as const;
export type AgentLocation = (typeof AGENT_LOCATIONS)[number];
const locationKey = (agentId: string) => `agentLocation:${agentId}`;

export function getAgentLocation(agentId: string): AgentLocation | null {
  const v = (getModelStmt.get(locationKey(agentId)) as { value: string } | undefined)?.value ?? null;
  return v && (AGENT_LOCATIONS as readonly string[]).includes(v) ? (v as AgentLocation) : null;
}

/**
 * location=null 이면 해제(전역 따름).
 *
 * ⚠ **총괄(orchestrator)은 이 PC 고정**이다 — 어댑터 금지(:138)와 같은 이유이고, 오늘 실측이 근거다:
 *   같은 질문에 gb10 원격이 14B 17.4초 / 32B 36.6초 / **72B 89~90초**였다(2026-08-18).
 *   총괄이 하는 일은 **어느 도구를 쓸지 고르는 판단**이고 그 앞에서 담당자가 기다린다.
 *   거기에 90초짜리 두뇌를 붙이면 제품이 못 쓰게 된다. 답 품질 차이도 눈에 띄지 않았다.
 */
export function setAgentLocation(agentId: string, location: AgentLocation | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  if (location === null) {
    delModelStmt.run(locationKey(agentId));
    return;
  }
  if (!(AGENT_LOCATIONS as readonly string[]).includes(location)) {
    throw new Error(`위치는 ${AGENT_LOCATIONS.join("·")} 중 하나여야 합니다 (받은 값: ${location})`);
  }
  if (agentId === "orchestrator" && location !== "local") {
    throw new Error(
      "총괄(orchestrator)은 이 PC에서만 돕니다 — 도구를 고르는 판단 앞에서 담당자가 기다리는데, 원격 큰 두뇌는 답까지 90초가 걸립니다(2026-08-18 실측)."
    );
  }
  setModelStmt.run(locationKey(agentId), location);
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
    assignedAdapterId: getAgentAdapter(base.id),
    // ⚠ 화면이 이 값을 못 받으면 늘 「전역 따름」으로 보인다 — 고른 것이 화면에 안 남는다.
    assignedLocation: getAgentLocation(base.id),
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

  // 전문가 어댑터 배정 — admin만. body.adapterId=null 이면 해제(베이스 그대로).
  // 채택된 어댑터만 배정 가능·오케스트레이터 금지(setAgentAdapter가 강제).
  app.post("/api/agents/:id/adapter", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentAdapter(String(req.params.id), req.body.adapterId ?? null);
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 팀원별 두뇌 **위치** — admin만. body.location=null 이면 해제(전역 따름).
  // ⚠ 「채팅이 어디로 가는지」를 정하는 설정이라 원격 전역 스위치와 같은 급으로 admin에 둔다
  //   (`remotellm.ts` 경계 ③과 같은 이유).
  // ⚠ 총괄은 이 PC 고정 — setAgentLocation이 강제한다(근거는 그 함수 주석).
  app.post("/api/agents/:id/location", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentLocation(String(req.params.id), req.body.location ?? null);
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 에이전트 표시 이름 변경("우리 팀" 로스터) — admin만. body.name=null/빈값이면 기본 이름으로 되돌림.
  // 담당자(security_officer)는 정의된 팀을 그대로 쓴다(클라이언트도 로스터 UI를 숨김 — 이건 그 서버측 강제).
  app.post("/api/agents/:id/name", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentName(String(req.params.id), req.body.name ?? null);
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
