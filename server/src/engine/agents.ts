// engine/agents.ts — 에이전트 정의 및 상태 관리 (서버 측, 전 클라이언트 공유)

import type { Express } from "express";
import { authMiddleware, adminMiddleware } from "../auth/auth";
import { db } from "../db";
import { isModelAvailable } from "./localengine";
import { getAdapter } from "./adapters";
import { recordAudit } from "./audit";
import { screenTips } from "./screenguide"; // 맡은 메뉴 제목(단일 출처) — screenguide는 agents를 물지 않는다

export type AgentStatus = "idle" | "working" | "watching";

export interface AgentDefinition {
  id: string;
  name: string; // 표시 이름(커스텀 이름이 있으면 그것, 없으면 기본)
  defaultName: string; // 원래 기본 이름
  role: string;
  abbr: string; // 실제 하는 일의 두 글자 약자(2026-08-20 사장님 — 레일·팀사무실 표기 단일 출처)
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
  /** 맡은 메뉴(화면 파일명)와 그 제목 — 팀 카드 칩. 등록부 menus가 단일 출처. */
  menus: string[];
  menuTitles: string[];
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
  abbr: string;
  desc: string;
  defaultStatus: AgentStatus;
  /** 맡은 메뉴 — screenguide가 아는 화면 파일명(basename). 단일 출처는 여기 하나(표시 제목은 screenguide에서 꺼낸다, 2026-09-03 사장님 「팀원별 메뉴」). */
  menus: string[];
}

// 에이전트 로스터 — "역할극 페르소나"를 줄이고 사내 데이터(RAG·온톨로지) 근거로 판단·검증하는
// 소수 정예로 재구성(2026-07-17). 워크플로우(dispatch: 스캔→분석→[GIJO 부연]→리포트) + 조율 + 엄격 그라운딩(GIJO Agent, id=normaltic).
// 제거된 페르소나(침투테스트·SBOM·CTI·모델진화)는 dispatch에 안 쓰이고 전용 화면·엔진(SBOM/CTI/합성)이
// 이미 담당하므로 일반 LLM 답변만 내던 중복이었다. LLM은 gijo + 보안LLM 2개만 사용.
// ⚠ 2026-09-03 부품표(bom) 팀원을 8번째로 되살렸다 — 그때와 다른 점: 일반 LLM 답변이 아니라 **규칙 판정(sbomreview·licenserisk) 뒤의 해석·설명**만 한다(bomdrafts.ts).
// 이름은 기능명 영문으로 통일(2026-07-17 확정). id는 라우팅·모델키·온톨로지 스코프에 쓰이므로 유지.
const AGENT_DEFS: AgentBase[] = [
  {
    id: "orchestrator",
    name: "Security Orchestrator",
    role: "작업 분배 · 결과 취합",
    abbr: "분배",
    menus: ["dashboard.html","approvals.html","compliance.html"],
    desc: "지시를 해석해 Scan → Analyze → Report 순으로 작업을 나눠 맡기고, 각 단계 결과를 취합해 최종 응답으로 정리합니다.",
    defaultStatus: "watching",
  },
  {
    id: "scan",
    name: "Scan Agent",
    role: "초기 데이터 해석 · 자산 반영",
    abbr: "해석",
    menus: ["vulnscan.html","hardening.html","assets.html","mydocs.html"],
    desc: "업로드·스캔(ModelScan) 결과로 나온 모델 취약점을 위협 관점에서 해석·요약하고 자산 finding으로 반영합니다. 결과는 Analyze Agent와 GIJO Agent로 이어집니다.",
    defaultStatus: "idle",
  },
  {
    id: "analysis",
    name: "Analyze Agent",
    role: "우선순위 판단 · AI 모델 관리",
    abbr: "우선",
    menus: ["vulnscan.html","analysis.html","handover.html"], // 허브(triage)와 그 안의 판(vulnscan)을 둘 다 적으면 같은 곳이 칩 두 개로 보인다(검토관 2026-09-03)
    desc: "스캔 finding의 우선순위를 판단하고(KEV·EPSS·CVSS 대조), 학습 루프·어댑터 등 AI 모델 관리를 맡습니다. 문서 분류·요약·보강은 Curator(사서)에게 넘어갔습니다(2026-09-03).",
    defaultStatus: "idle",
  },
  {
    id: "report",
    name: "Report Agent",
    role: "내부 보고서 작성 · 결과 레포팅",
    abbr: "보고",
    menus: ["report.html"], // 보고 허브(reporting)는 리포트 판의 껍데기 — 판 하나만
    desc: "작업 결과를 내부 보고용 문서로 정리합니다. 파이프라인 마지막 단계에서 스캔·분석·부연 결과를 받아 보고서를 만듭니다.",
    defaultStatus: "idle",
  },
  // 딥웹·다크웹 CTI 피드 기반 위협 모니터링 + CTI ↔ 자산 자동 매칭(ctimatch 엔진) 담당. 항시 감시(watching).
  {
    id: "ti",
    name: "TI Agent",
    role: "위협 인텔리전스 · CTI 피드-자산 매칭 해석", // 2026-08-20 정직화 — 상시 감시 루프가 없는데 「모니터링」은 과장(외부 대조 검증)
    abbr: "위협",
    menus: ["threat.html"], // 발견·수집 허브(discover)는 위협 인텔 판의 껍데기 — 판 하나만
    desc: "딥웹·다크웹 CTI 피드에서 받은 유출정보·위협을 요청 시 해석합니다. 위협 인텔 텍스트를 자산 인벤토리(자산명·컴포넌트·CVE·AI-BOM)와 대조해 영향 자산을 자동 매칭해 알립니다.",
    defaultStatus: "idle", // watching(감시 중)은 상시 루프가 있을 때의 말 — 요청응답형이라 idle이 사실
  },
  // 사내 지식베이스(RAG)+온톨로지에 적재된 자료만 근거로 설명하고 실제 사례를 검색해 준다(엄격 그라운딩).
  // 2026-09-03 침해사고 히스토리(사장님 「노멀틱처럼 해킹 사례를 모아 쉽게」) — 두 번째 부르는 문:
  //   스캔 해석 초안 직후 CVE 규칙 대조 → 후보가 있을 때만 쉬운 부연(scandrafts.ts 훅, incidentcases.ts).
  //   「사례」는 히스토리 표에 등록된 것만 — 그라운딩 원칙은 그대로다(지어내지 않는다).
  {
    id: "normaltic",
    name: "GIJO Agent",
    role: "용어·개념 해설 · 침해사고 히스토리(사례 부연)",
    abbr: "해설",
    // 맡은 메뉴 칩은 비워 둔다 — 📚 침해사고 히스토리(incidentcases.html)는 메뉴 항목이 아니라 **카드로 여는 화면**이다
    // (팀원 카드의 「📚 히스토리」 단추·취약점 카드의 「비슷한 사례」 칩·AI 허브 판 카드). 그 단추가 곧 이 팀원의 맡은 곳이라
    // 칩까지 달면 같은 곳이 두 번 보인다. 빈 배열이 「맡은 곳이 없다」는 뜻은 아니다(bomdrafts.test 예외 사유와 짝).
    menus: [],
    desc: "Scan·Analyze 결과에 나온 용어를 사내 지식베이스 근거로 해설하고, 취약점의 CVE가 침해사고 히스토리에 있으면 비슷한 사례를 쉬운 말로 부연합니다(등록된 사례만 — 지어내지 않습니다). 복합 지시에서 스캔·분석이 끝나면 자동 투입됩니다.",
    defaultStatus: "watching",
  },
  // 사서(2026-09-03, 7번째 팀원) — 문서가 들어오는 문에서 부른다: 업무영역 분류·문서 종류 분류·세 줄 요약·
  // 번역/온톨로지 보강·매뉴얼 정형 초안·검색어 재작성. 전엔 analysis/report가 이름만 빌려주던 일이라
  // 「부르는 문」이 없어 팀원이 아니었다. 검색 우선영역은 없다(hybridsearch ROLE_CATEGORY curator: [] — 전 영역을 고르게 본다).
  {
    id: "curator",
    name: "Curator Agent",
    role: "문서 반입 분류 · 요약 · 지식 보강",
    abbr: "사서",
    menus: ["mydocs.html","memory.html","products.html"],
    desc: "올라온 문서를 업무영역·종류로 분류하고 세 줄 요약·온톨로지 보강·매뉴얼 정형 초안을 만듭니다. 검색 때 질문을 검색용 구절로 고쳐 씁니다. Scan·Analyze가 근거로 쓰는 지식 저장소의 입구를 지킵니다.",
    defaultStatus: "idle",
  },
  // 부품표(2026-09-03, 8번째 팀원 — 사장님 「부품표 전용 팀원 만들자」) — 타사 SBOM 검수(규칙)·라이선스 판정(규칙) 뒤에서 부른다:
  // 검수 직후 해석 초안(무엇부터 볼지·왜 위험한지)과 대화창의 라이선스 의무 설명. 판정 자체는 절대 모델이 하지 않는다(bomdrafts.ts).
  {
    id: "bom",
    name: "BOM Agent",
    role: "타사 부품표(SBOM) 검수 해석 · 라이선스 의무 설명", // AI-BOM 결손 쪽 부르는 문은 아직 없다 — 생기면 그때 넓힌다(검토관 2026-09-03)
    abbr: "부품",
    menus: ["supplychain.html", "sbom.html"],
    desc: "타사 부품표(SBOM) 검수가 규칙으로 끝난 뒤 그 결과를 담당자 말로 해석하고(먼저 볼 부품·왜 위험한지), 라이선스 의무를 설명합니다. 등급 판정·요구는 규칙 엔진(licenserisk)이 정본이고 팀원은 그 뒤에서 풀어 씁니다.",
    defaultStatus: "idle",
  },
];

/** 맡은 메뉴의 제목 — screenguide 한 곳에서 꺼낸다(등록부에 제목을 두 번 적지 않는다). screenguide는 auth·workflow만 물어 순환이 없다.
 *  screenTips는 모르는 화면에도 개요 제목을 준다 — 폴백 제목과 같으면 파일명을 그대로 보여 오타·폐지 화면이 드러나게 한다(검토관 2026-09-03). */
function menuTitlesOf(menus: string[]): string[] {
  const 폴백 = screenTips("__없는화면__.html").title;
  return menus.map((m) => { const t = screenTips(m).title; return t && t !== 폴백 ? t : m; });
}

// 팀 구성 변경은 감사 기록에 남긴다(2026-09-03 설계관 — 누가 어느 팀원의 두뇌·어댑터·위치·이름을 바꿨는지 보여야 한다).
function 감사(agentId: string, action: string, detail: string, actor?: string | null): void {
  recordAudit({ kind: "config", actor: actor ?? null, action: `${action}: ${agentId}`, target: agentId, detail, result: "ok" });
}

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

// ── 서식 전용 보조 모델(2026-09-03, 사장님 「전부 승인」 3항 + 설계관 갈래 A) ─────────────────────
// 팀원 배정이 아니라 **호출별** 모델이다: 스키마 강제 서식·추출 호출(scandrafts 스캔 초안·securityproducts 정형 초안)만
// 이 모델로 간다(llm.ts ChatArgs.modelOverride). 왜 팀원째 배정하지 않나 — 보고 팀원의 실제 호출은 판단 과업(경영진 요약·
// RAG 자유답변)이고, 3회차 실측에서 소형 모델은 판단·절제·인용(priority_6 0.40·ti_trap 0·glossary_cite 0.70)이 약했다.
// 되돌리기 = null(서식 호출도 팀원·전역 모델로). 파일이 사라졌으면 읽을 때 무시한다(조용한 폴백 대신 경고 한 줄).
const FORMAT_HELPER_KEY = "formatHelperModel";
export function getFormatHelperModel(): string | null {
  const id = (getModelStmt.get(FORMAT_HELPER_KEY) as { value: string } | undefined)?.value ?? null;
  if (id && !isModelAvailable(id)) { console.warn(`[agents] 서식 전용 보조 모델 파일이 없어 무시한다: ${id}`); return null; }
  return id;
}
export function setFormatHelperModel(modelId: string | null, actor?: string | null): void {
  if (modelId === null || modelId === "") {
    delModelStmt.run(FORMAT_HELPER_KEY);
    recordAudit({ kind: "config", actor: actor ?? null, action: "서식 전용 보조 모델 해제", target: "format-helper", detail: "(서식 호출도 팀원·전역 모델로)", result: "ok" });
    return;
  }
  if (!isModelAvailable(modelId)) throw new Error(`배치되지 않은 모델입니다: ${modelId}`);
  setModelStmt.run(FORMAT_HELPER_KEY, modelId);
  recordAudit({ kind: "config", actor: actor ?? null, action: "서식 전용 보조 모델 배정", target: "format-helper", detail: modelId, result: "ok" });
}

// 팀 커스터마이징: 에이전트 표시 이름을 조직이 원하는 대로 바꾼다("우리 팀" 로스터). 비우면 기본 이름.
export function getAgentName(agentId: string): string | null {
  return (getModelStmt.get(nameKey(agentId)) as { value: string } | undefined)?.value ?? null;
}

export function setAgentName(agentId: string, name: string | null, actor?: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  const trimmed = (name ?? "").trim();
  if (trimmed === "") {
    delModelStmt.run(nameKey(agentId));
    감사(agentId, "팀원 이름 되돌림", "(기본 이름)", actor);
    return;
  }
  if (trimmed.length > 30) throw new Error("이름은 30자 이내여야 합니다");
  setModelStmt.run(nameKey(agentId), trimmed);
  감사(agentId, "팀원 이름 변경", trimmed, actor);
}

// ── 전문가 어댑터 배정 (재설계 1단계) ──────────────────────────────────
const adapterKey = (agentId: string) => `agentAdapter:${agentId}`;

export function getAgentAdapter(agentId: string): string | null {
  return (getModelStmt.get(adapterKey(agentId)) as { value: string } | undefined)?.value ?? null;
}

// adapterId=null 이면 해제(베이스 그대로). 오케스트레이터는 금지 — 라우팅은 결정성이 생명이라
// 어댑터로 답 분포가 흔들리면 안 된다(파인튜닝이 라우팅을 8/8→7/8로 떨어뜨린 실측, 2026-08-05).
// 채택(adopted)된 어댑터만 배정할 수 있다 — 등록만 된 어댑터는 게이트를 안 거친 것이다.
export function setAgentAdapter(agentId: string, adapterId: string | null, actor?: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  if (adapterId === null || adapterId === "") {
    delModelStmt.run(adapterKey(agentId));
    감사(agentId, "어댑터 해제", "(베이스 그대로)", actor);
    return;
  }
  if (agentId === "orchestrator") throw new Error("총괄(orchestrator)에는 어댑터를 배정할 수 없습니다 — 라우팅 결정성 보호");
  const adapter = getAdapter(adapterId);
  if (!adapter) throw new Error(`등록되지 않은 어댑터입니다: ${adapterId}`);
  if (!adapter.adopted) throw new Error(`채택되지 않은 어댑터입니다: ${adapterId} — 평가 게이트 통과 후 채택하면 배정할 수 있습니다`);
  setModelStmt.run(adapterKey(agentId), adapterId);
  감사(agentId, "어댑터 배정", adapterId, actor);
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
export function setAgentLocation(agentId: string, location: AgentLocation | null, actor?: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  if (location === null) {
    delModelStmt.run(locationKey(agentId));
    감사(agentId, "두뇌 위치 해제", "(전역 따름)", actor);
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
  감사(agentId, "두뇌 위치 변경", location, actor);
}

// modelId=null 이면 할당 해제(전역 모델 따름). 존재하지 않는 모델은 거부한다.
export function setAgentModel(agentId: string, modelId: string | null, actor?: string | null): void {
  if (!AGENT_DEFS.some((a) => a.id === agentId)) throw new Error(`존재하지 않는 에이전트: ${agentId}`);
  if (modelId === null || modelId === "") {
    delModelStmt.run(modelKey(agentId));
    감사(agentId, "전용 모델 해제", "(전역 모델 따름)", actor);
    return;
  }
  if (!isModelAvailable(modelId)) throw new Error(`배치되지 않은 모델입니다: ${modelId}`);
  setModelStmt.run(modelKey(agentId), modelId);
  감사(agentId, "전용 모델 배정", modelId, actor);
}

function toAgent(base: AgentBase): AgentDefinition {
  return {
    id: base.id,
    name: getAgentName(base.id) ?? base.name, // 커스텀 이름이 있으면 우선
    defaultName: base.name, // 원래 기본 이름(되돌리기·비교용)
    role: base.role,
    abbr: base.abbr,
    desc: base.desc,
    menus: base.menus,
    menuTitles: menuTitlesOf(base.menus),
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

/** 감사 기록의 행위자 — authMiddleware가 req.user에 넣어 둔 사용자의 **표시 이름**(저장소 관례: actor는 displayName —
 *  username을 쓰면 같은 사람이 감사 타임라인에서 두 이름으로 갈린다, 2026-08-09 실사고·auditactor 감시). */
const 행위자 = (req: unknown): string | null => (req as { user?: { displayName?: string } }).user?.displayName ?? null;

export function registerAgentsRoutes(app: Express): void {
  app.get("/api/agents", authMiddleware, (_req, res) => res.json(listAgents()));

  // 서식 전용 보조 모델 — 조회는 로그인, 배정·해제는 admin. body.modelId=null 이면 해제.
  app.get("/api/agents/format-helper", authMiddleware, (_req, res) => res.json({ modelId: getFormatHelperModel() }));
  app.post("/api/agents/format-helper", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setFormatHelperModel(req.body?.modelId ?? null, 행위자(req));
      res.json({ modelId: getFormatHelperModel() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 에이전트 전용 모델 할당 — admin만. body.modelId=null 이면 할당 해제(전역 모델 따름).
  app.post("/api/agents/:id/model", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentModel(String(req.params.id), req.body.modelId ?? null, 행위자(req));
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 전문가 어댑터 배정 — admin만. body.adapterId=null 이면 해제(베이스 그대로).
  // 채택된 어댑터만 배정 가능·오케스트레이터 금지(setAgentAdapter가 강제).
  app.post("/api/agents/:id/adapter", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentAdapter(String(req.params.id), req.body.adapterId ?? null, 행위자(req));
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
      setAgentLocation(String(req.params.id), req.body.location ?? null, 행위자(req));
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 에이전트 표시 이름 변경("우리 팀" 로스터) — admin만. body.name=null/빈값이면 기본 이름으로 되돌림.
  // 담당자(security_officer)는 정의된 팀을 그대로 쓴다(클라이언트도 로스터 UI를 숨김 — 이건 그 서버측 강제).
  app.post("/api/agents/:id/name", authMiddleware, adminMiddleware, (req, res) => {
    try {
      setAgentName(String(req.params.id), req.body.name ?? null, 행위자(req));
      res.json(getAgentById(String(req.params.id)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
