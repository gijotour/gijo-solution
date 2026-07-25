// engine/dispatcher.ts — 지시 → 할당 → 실행 → 로그까지 잇는 조율 로직 (서버 측)
// 8단계 문서에서 설명한 파이프라인과 동일하되, collaboration 로그는 이제
// WebSocket으로 모든 접속 클라이언트에 브로드캐스트된다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import { asyncRoute } from "../util/asyncRoute";
import { routeIntent, RoutedIntent } from "./intent";
import { createTask, completeTask, updateTaskPriority, TaskItem } from "./tasks";
import { setAgentStatus, resetAgentToDefault, getAgentById } from "./agents";
import { emitCollaboration } from "./collaboration";
import { runAdapter, StandardFinding } from "./bridge";
import { chat } from "./llm";
import { runAgentLoop, AgentToolCall } from "./agentloop";
import { executeApprovedTool, PendingApproval } from "./agenttools";
import { appendApprovedDecision } from "./orchestrator-dataset";
import { undoSnapshot, undoCommit } from "./undo";
import { gateUserInput } from "./gateway";
import { toolDomainsForScreen } from "./screencontext";
import { isHelpIntent, formatScreenGuide } from "./screenguide";
import { analyzeFindings } from "./analysis";
import { recordFindings, getAsset, listAssets } from "./assets";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { generateReport } from "./report";
import { appendTurn, recentTurnsText, getSession, createSession } from "./worksessions";

export interface DispatchResult {
  task: TaskItem;
  route: RoutedIntent;
  output: string;
  steps?: StepResult[]; // 복합(멀티스텝) 지시일 때 각 단계 결과
  toolCalls?: AgentToolCall[]; // 에이전트 루프가 실행한 도구 내역(화면 표시용)
  // 쓰기 도구 지시 시: 실행하지 않고 결재판을 돌려준다 — 화면에서 승인해야 실행된다(시안 B).
  approval?: PendingApproval;
  // 학습 루프 실행 요청 시: 바로 실행하지 않고 화면의 명시적 확인 버튼으로만 시작(오발동 방지).
  confirm?: { type: "learnloop"; datasets: { id: string; examples: number }[] };
  // 작업 세션에 속한 지시였으면 그 세션 id를 돌려준다(화면이 해당 세션 대화를 갱신하도록).
  sessionId?: string;
  // ── 화면 액션 알약 조건부 노출용 신호 (2026-07-25) ──
  // dataHits: 자산·취약점 등 특정 내부 데이터를 실제로 건드린 수 → 📄 리포트 알약을 그때만 띄운다.
  // internalMiss: 일반 질의인데 사내 RAG 근거가 0(내부자료 없음) → ☁ 외부(클라우드) 추가질의를 그때만 띄운다.
  dataHits?: number;
  internalMiss?: boolean;
  // 답변 그라운딩에 쓰인(검색된) 사내 문서 ID — 화면이 "근거: 문서명" 배지로 표시한다.
  // 인수인계 자동 검증도 이 필드로 "올린 문서가 실제로 인용되는가"를 판정한다.
  sources?: string[];
}

// ── 복합 지시(오케스트레이션) ─────────────────────────────────────────
// "이 CTI 영향 자산 스캔하고 리포트까지"처럼 여러 액션을 순서대로 잇는 지시를 계획→순차 실행한다.
// 대상(scope)은 지시문에서 해석한다: 특정 자산 / CTI 영향 자산(ctimatch) / 전체 자산.
type StepScope = { type: "asset"; assetId: string } | { type: "cti-affected" } | { type: "all-assets" };

export interface OrchestrationStep {
  action: "scan" | "analyze" | "report";
  scope?: StepScope;
  label: string;
}

export interface StepResult {
  // enrich = GIJO Agent(normaltic)의 용어 해설·사례 부연 — 계획(planInstruction)에는 없고
  // 스캔·분석이 끝난 지점에 자동 투입된다(아래 runGijoEnrichment).
  action: OrchestrationStep["action"] | "enrich";
  label: string;
  output: string;
  assetIds?: string[];
  findingCount?: number;
}

const ACTION_PATTERNS: { action: OrchestrationStep["action"]; re: RegExp }[] = [
  { action: "scan", re: /재스캔|스캔|scan/i },
  { action: "analyze", re: /우선순위|분석|analy/i },
  { action: "report", re: /리포트|보고서|report/i },
];

// 지시문에서 스캔 대상 범위를 해석한다.
function resolveScopeFromText(text: string): StepScope {
  if (/cti/i.test(text) && /영향|관련|매칭|affected/i.test(text)) return { type: "cti-affected" };
  const mentioned = listAssets().find((a) => text.includes(a.id) || text.includes(a.name));
  if (mentioned) return { type: "asset", assetId: mentioned.id };
  return { type: "all-assets" };
}

// 규칙 기반 계획: 지시문에 나타난 액션 키워드를 등장 순서대로 단계로 만든다(결정적 — 테스트 용이).
export function planInstruction(text: string): OrchestrationStep[] {
  const hits = ACTION_PATTERNS.map(({ action, re }) => ({ action, pos: text.search(re) })).filter((h) => h.pos >= 0);
  hits.sort((a, b) => a.pos - b.pos);
  const scope = resolveScopeFromText(text);
  const LABELS: Record<OrchestrationStep["action"], string> = { scan: "스캔", analyze: "우선순위 분석", report: "리포트 작성" };
  return hits.map((h) => ({
    action: h.action,
    scope: h.action === "scan" ? scope : undefined,
    label: LABELS[h.action],
  }));
}

function resolveScopeAssetIds(scope: StepScope | undefined, ctiAffected: () => Promise<string[]>): Promise<string[]> {
  if (!scope || scope.type === "all-assets") return Promise.resolve(listAssets().map((a) => a.id));
  if (scope.type === "asset") return Promise.resolve([scope.assetId]);
  return ctiAffected();
}

function priorityForAction(action: RoutedIntent["action"]): TaskItem["priority"] {
  if (action === "scan") return "P1";
  if (action === "analyze") return "P1";
  return "P2";
}

// 실시간 CVSS/EPSS/KEV 스코어링은 CTI 벤더 API 연동(cti.ts의 TODO) 전까지는 데이터 소스가 없어 보류.
// 지금 확보 가능한 신호는 스캔 어댑터가 돌려주는 finding.severity뿐이므로, 스캔이 끝나면
// 발견된 findings 중 가장 심각한 등급을 근거로 액션 기반 초기 우선순위를 덮어쓴다.
function priorityForFindings(findings: StandardFinding[]): TaskItem["priority"] {
  if (findings.some((f) => f.severity === "critical")) return "P0";
  if (findings.some((f) => f.severity === "high")) return "P1";
  if (findings.some((f) => f.severity === "medium")) return "P2";
  return "P3";
}

interface ActionResult {
  output: string;
  findings?: StandardFinding[];
  toolCalls?: AgentToolCall[];
  approval?: PendingApproval;
}

async function executeRoutedAction(route: RoutedIntent, instructionText: string, contextText = ""): Promise<ActionResult> {
  switch (route.action) {
    case "scan": {
      const assetId = route.targetAssetId ?? "unknown-asset";
      const scanPath = getAsset(assetId)?.path ?? assetId;
      const findings = await runAdapter("modelscan", scanPath).catch((err) => [
        { finding_type: "scan_error", severity: "low" as const, evidence: String(err), source_tool: "modelscan" },
      ]);
      recordFindings(assetId, findings);
      const analysis = await analyzeFindings(findings);
      return { output: analysis.summary, findings };
    }
    case "analyze":
    case "report":
    case "chat":
    default: {
      // 모델 로드·선택은 chat() 내부(ensureAgentModel)에서 처리된다.
      // 세션 맥락이 있으면 앞에 붙여 "이어서/그거" 같은 대화형 후속을 이해하게 한다.
      const message = contextText ? `${contextText}\n\n[현재 지시] ${instructionText}` : instructionText;
      // trusted: 지시문은 dispatchInstructionCore에서 이미 관문을 지났다(이중 집계 방지).
      // explain: 지휘 콘솔에 그대로 표시되는 답변이다.
      return { output: await chat({ agentId: route.agentId, message, remember: true, trusted: true, explain: true }) };
    }
  }
}

const AGENT_FOR_ACTION: Record<OrchestrationStep["action"], string> = { scan: "scan", analyze: "analysis", report: "report" };

// GIJO Agent(normaltic) 부연 — 스캔·분석 결과에 나온 용어·탐지 항목을 사내 지식베이스(RAG) 근거로
// 해설하고 실제 사례를 부연한다. 단계마다 부르면 LLM 호출이 배로 늘어 파이프라인이 느려지므로
// 스캔·분석이 모두 끝난 지점에 1회만 투입한다(2026-07-17 확정). 실패해도 파이프라인은 계속(보조 단계).
async function runGijoEnrichment(results: StepResult[], fromAgentId: string): Promise<StepResult> {
  const source = results
    .filter((r) => r.action === "scan" || r.action === "analyze")
    .map((r) => `[${r.label}] ${r.output}`)
    .join("\n")
    .slice(0, 1500); // 프롬프트 폭주 방지 — 용어 추출에는 앞부분 요약이면 충분
  setAgentStatus("normaltic", "working");
  emitCollaboration({ from: fromAgentId, to: "normaltic", message: "스캔·분석 결과 용어 해설·사례 부연 요청" });
  let output: string;
  try {
    output = await chat({
      agentId: "normaltic",
      message: `다음 스캔·분석 결과에 나온 보안 용어·탐지 항목을 짧게 해설하고, 사내 지식베이스에 관련 사례가 있으면 부연해줘.\n\n${source}`,
      trusted: true, // 사용자 입력이 아니라 앞 단계 산출물로 조립한 내부 프롬프트
    });
  } catch (err) {
    output = `부연 생략: ${err instanceof Error ? err.message : String(err)}`;
  }
  emitCollaboration({ from: "normaltic", to: "orchestrator", message: `부연 완료: ${output.slice(0, 600)}` });
  resetAgentToDefault("normaltic");
  return { action: "enrich", label: "용어 해설·사례 부연", output };
}

// 복합 지시를 순차 실행한다. 각 단계는 협업 로그로 실시간 브로드캐스트되고, 스캔 결과(findings)는
// 다음 단계(분석·리포트)로 누적 전달된다.
async function runOrchestration(instructionText: string, steps: OrchestrationStep[], task: TaskItem): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const accumulated: StandardFinding[] = [];
  const scannedAssetIds = new Set<string>();
  // CTI 영향 자산은 한 번만 계산(여러 단계가 참조할 수 있으므로).
  // CTI ↔ 자산 자동 매칭은 TI Agent 담당 — 위협 인텔 텍스트를 자산 인벤토리(자산명·컴포넌트·CVE·AI-BOM)와
  // 대조해 영향 자산을 찾고, 결과를 협업 피드로 알린다(매칭 자체는 규칙 엔진 ctimatch가 수행).
  const ctiAffected = async (): Promise<string[]> => {
    setAgentStatus("ti", "working");
    emitCollaboration({ from: "orchestrator", to: "ti", message: "CTI ↔ 자산 자동 매칭 요청 — 위협 인텔을 자산 인벤토리와 대조" });
    const findings = await listFindings();
    const ids = [...new Set(matchCtiToAssets(findings, listAssets()).matches.flatMap((m) => m.matchedAssets.map((a) => a.assetId)))];
    emitCollaboration({ from: "ti", to: "orchestrator", message: ids.length ? `영향 자산 ${ids.length}개 매칭: ${ids.join(", ").slice(0, 100)}` : "영향 자산 없음 — 현재 CTI 위협과 매칭되는 자산이 없습니다" });
    resetAgentToDefault("ti");
    return ids;
  };
  // GIJO 부연을 끼워 넣을 지점: 마지막 스캔/분석 단계 직후(리포트보다 앞 — 해설→보고 순서).
  const lastInterpretIdx = steps.reduce((last, s, idx) => (s.action === "scan" || s.action === "analyze" ? idx : last), -1);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentId = AGENT_FOR_ACTION[step.action];
    setAgentStatus(agentId, "working");
    emitCollaboration({ from: "orchestrator", to: agentId, message: `단계 ${i + 1}/${steps.length} — ${step.label}` });

    let output = "";
    let assetIds: string[] | undefined;
    let findingCount: number | undefined;
    try {
      if (step.action === "scan") {
        assetIds = await resolveScopeAssetIds(step.scope, ctiAffected);
        let count = 0;
        for (const assetId of assetIds) {
          const scanPath = getAsset(assetId)?.path ?? assetId;
          const findings = await runAdapter("modelscan", scanPath).catch((err) => [
            { finding_type: "scan_error", severity: "low" as const, evidence: String(err), source_tool: "modelscan" },
          ]);
          recordFindings(assetId, findings);
          accumulated.push(...findings);
          scannedAssetIds.add(assetId);
          count += findings.length;
        }
        findingCount = count;
        output = assetIds.length
          ? `${assetIds.length}개 자산 스캔 완료 — finding ${count}건 (${assetIds.join(", ")})`
          : "스캔 대상 자산이 없습니다.";
      } else if (step.action === "analyze") {
        output = accumulated.length
          ? (await analyzeFindings(accumulated)).summary
          : await chat({ agentId: "analysis", message: instructionText, remember: true, trusted: true });
      } else {
        // report — 앞 단계에서 스캔한 자산이 있으면 그 범위로, 없으면 전체로 보고서를 만든다.
        const scoped = scannedAssetIds.size ? [...scannedAssetIds] : undefined;
        const r = await generateReport({ type: "ondemand", assetIds: scoped });
        assetIds = scoped;
        output = `${r.executiveSummary}\n(리포트 파일: ${r.filePath})`;
      }
    } catch (err) {
      output = `단계 실패: ${err instanceof Error ? err.message : String(err)}`;
    }

    emitCollaboration({ from: agentId, to: "orchestrator", message: `단계 ${i + 1} 완료: ${output.slice(0, 600)}` });
    resetAgentToDefault(agentId);
    results.push({ action: step.action, label: step.label, output, assetIds, findingCount });

    // 마지막 스캔/분석 단계가 끝나면 GIJO Agent가 결과 용어·사례를 부연한다.
    // 부연할 거리가 없으면(스캔 finding 0건 + 분석 단계도 없음) 건너뛴다.
    if (i === lastInterpretIdx && (accumulated.length > 0 || step.action === "analyze")) {
      results.push(await runGijoEnrichment(results, agentId));
    }
  }

  // 스캔 결과가 있으면 태스크 우선순위를 최고 심각도로 갱신.
  if (accumulated.length) updateTaskPriority(task.id, priorityForFindings(accumulated));
  return results;
}

// 학습 루프 실행 지시 감지 — "학습 루프 돌려줘", "파인튜닝 시작해줘" 등.
// 실 GPU 파인튜닝이 돌고 학습 중 로컬 LLM 엔진이 일시 중단되는 무거운 작업이라, 지시만으로
// 바로 실행하지 않는다(2026-07-17 확정 — 오발동 방지). Analyze Agent가 실행 계획·영향을
// 안내하고 화면의 명시적 확인 버튼(대시보드 confirm 카드 / 학습 루프 화면)으로만 시작한다.
const LEARN_TOPIC_RE = /학습\s*루프|파인\s*튜닝|learn\s*loop|fine[-\s]?tun/i;
// "이 취약점 어떻게 조치해?/조치 방법/조치 절차/대응 방법" — 방법 문의(실행 지시 아님).
const REMEDIATION_INTENT_RE = /(조치|대응|remediat|패치|수정)\s*(방법|절차|어떻게|가이드|플레이북|playbook)|어떻게\s*(조치|대응|패치|고쳐|해결)|대응\s*방안/i;
// "Shadow AI/미등록 AI/비인가 모델 점검·확인"
const SHADOW_AI_INTENT_RE = /shadow\s*ai|미등록\s*(ai|모델|엘엘엠|llm)|비인가\s*(ai|모델)|섀도우|(등록\s*안\s*된|등록되지\s*않은)\s*(ai|모델)/i;
// "공격 경로 / 도달성 / 측면 이동" 분석
const ATTACK_PATH_INTENT_RE = /공격\s*경로|attack\s*path|도달\s*(성|가능)|측면\s*이동|lateral|reachab|이동\s*경로/i;
// "지식베이스 정리·중복·상충 점검"
const KB_HYGIENE_INTENT_RE = /(지식\s*베이스|지식|문서|rag|자료).{0,6}(정리|중복|상충|위생|점검|청소|정돈)|(중복|상충)\s*(문서|자료)/i;
const LEARN_RUN_RE = /실행|시작|돌려|가동|run|start/i;

async function learnloopConfirmResult(instructionText: string): Promise<DispatchResult> {
  setAgentStatus("analysis", "working");
  emitCollaboration({ from: "orchestrator", to: "analysis", message: "학습 루프 실행 요청 — 확인 절차 안내" });
  const { listDatasets } = await import("./dataset.js");
  const datasets = listDatasets();
  const output = [
    "학습 루프(파인튜닝)는 실 GPU 학습이 실행되고, 학습하는 동안 로컬 LLM 엔진이 일시 중단됩니다.",
    "오발동 방지를 위해 지시만으로는 시작하지 않습니다 — 아래에서 데이터셋을 고르고 '학습 시작'을 직접 확인해 주세요.",
    datasets.length
      ? `사용 가능한 데이터셋 ${datasets.length}개: ${datasets.map((d) => `${d.id}(${d.examples}건)`).join(", ")}`
      : "사용 가능한 데이터셋이 없습니다 — 학습 루프 화면에서 대화 로그로 데이터셋을 먼저 만들어 주세요.",
  ].join("\n");
  emitCollaboration({ from: "analysis", to: "orchestrator", message: "학습 루프 실행 대기 — 화면에서 확인 필요" });
  resetAgentToDefault("analysis");
  const task = createTask({ text: instructionText, agentId: "analysis", priority: "P2" });
  const updated = completeTask(task.id);
  const completedTask = updated.find((t) => t.id === task.id) ?? task;
  return { task: completedTask, route: { agentId: "analysis", action: "chat" }, output, confirm: { type: "learnloop", datasets } };
}

// 작업 세션 래퍼 — sessionId가 있으면 지시를 user 턴, 응답을 assistant 턴으로 기록하고
// 직전 턴들을 맥락으로 실어 "이어서" 지시가 되게 한다.
// sessionId가 없으면 자동으로 새 세션을 만들어 기록한다(사용자 요청 2026-07-20 — "모든 행위를
// 작업 세션에": 팀 사무실 CTA·에이전트 페이지 등 세션 없이 오던 지시도 이력에 남게).
// 응답의 sessionId를 클라이언트가 저장하면 그 세션으로 "이어서" 지시가 된다.
export async function dispatchInstruction(instructionText: string, sessionId?: string, screen?: string): Promise<DispatchResult> {
  const session = (sessionId ? getSession(sessionId) : null) ?? createSession();
  // 맥락은 이번 지시를 기록하기 "전" 시점의 대화로 계산한다(방금 넣은 user 턴이 맥락에 중복되지 않게).
  const contextText = session ? recentTurnsText(session.id) : "";
  let title = session?.title;
  if (session) {
    appendTurn(session.id, "user", instructionText);
    // 첫 지시면 방금 자동 지정된 제목을 로그에 쓰기 위해 다시 읽는다("새 세션" 대신 실제 제목).
    title = getSession(session.id)?.title ?? title;
    // 작업 세션의 지시를 실시간 에이전트 협업 로그에도 흘린다 — 세션 제목으로 꼬리표를 달아
    // "어느 세션에서 온 작업인지"가 로그에 드러나게 한다(대시보드 📡 실시간 협업 피드에 표시).
    emitCollaboration({ from: "세션", to: "orchestrator", message: `💬 [${title}] ${instructionText}` });
  }
  const core = await dispatchInstructionCore(instructionText, contextText, screen);
  const result: DispatchResult = { ...core, ...(await computeOfferSignals(core, instructionText)) };
  if (session) {
    appendTurn(session.id, "assistant", result.output, turnToolTag(result));
    emitCollaboration({ from: "orchestrator", to: "세션", message: `💬 [${title}] ${result.output.slice(0, 600)}` });
  }
  return session ? { ...result, sessionId: session.id } : result;
}

// 인사·감사 같은 잡담 판별(외부 클라우드 제안 제외용). llm.smallTalkReply와 같은 취지지만
// 여기 자체 내장한다 — dispatcher 테스트가 ./llm을 목킹하면 smallTalkReply export 접근만으로도 던진다.
// (?:단어)+ — "고마워 수고했어"처럼 잡담 어절이 이어져도 잡는다(회귀 하네스 실측 2026-07-25).
const SMALLTALK_WORD = "안녕(하세요|하십니까)?|하이|헬로|반가워요?|반갑습니다|ㅎㅇ|hi|hello|hey|고마워요?|감사(합니다|해요)?|수고(했어|하셨어요|하세요|해)?|잘했어|굿|good|thanks|thank you";
const SMALLTALK_RE = new RegExp(`^\\s*(?:(?:${SMALLTALK_WORD})[\\s!?.~,ㅎㅋ]*)+$`, "i");
function isSmallTalkInstruction(text: string): boolean {
  const t = (text ?? "").trim();
  return t.length > 0 && t.length <= 20 && SMALLTALK_RE.test(t);
}

// 화면 액션 알약(리포트·클라우드) 조건부 노출용 신호를 계산한다.
// - dataHits: 자산·취약점 등 특정 내부 데이터를 실제로 건드렸는가(리포트로 정리할 거리가 있는가).
// - internalMiss: 데이터 답이 아닌 일반 질의인데 사내 RAG 근거가 0인가(외부 자료가 필요한가).
async function computeOfferSignals(
  result: DispatchResult,
  instructionText: string,
): Promise<{ dataHits: number; internalMiss: boolean; sources?: string[] }> {
  let dataHits = 0;
  for (const s of result.steps ?? []) {
    dataHits += (s.assetIds?.length ?? 0) + (s.findingCount ?? 0);
  }
  // 4분류 액션(스캔·분석·리포트)은 특정 데이터를 다룬 것으로 본다.
  if (result.route && (result.route.action === "scan" || result.route.action === "analyze" || result.route.action === "report")) {
    dataHits = Math.max(dataHits, 1);
  }
  // 에이전트 루프가 자산·취약점·분석·하드닝 등 데이터 조회 도구를 썼으면 특정 데이터를 조회한 것.
  const DATA_TOOL_RE = /asset|finding|cti|vuln|sbom|analys|scan|search|hardening/i;
  if (result.toolCalls?.some((c) => DATA_TOOL_RE.test(c.tool))) dataHits = Math.max(dataHits, 1);

  // internalMiss는 데이터 답이 아니고(=일반 대화) 결재·확인 대기도 아닐 때만 판정한다.
  // 인사·감사 같은 잡담은 애초에 물어볼 자료가 아니므로 외부(클라우드) 제안을 띄우지 않는다.
  // (llm.smallTalkReply를 쓰지 않고 자체 판별 — 테스트가 ./llm을 목킹하면 그 export 접근만으로도 던진다.)
  // 같은 검색(임베딩 1회)에서 근거 문서 ID(sources)도 뽑는다 — 화면 "근거" 배지·인수인계 검증용.
  let internalMiss = false;
  let sources: string[] | undefined;
  if (dataHits === 0 && !result.approval && !result.confirm && !isSmallTalkInstruction(instructionText)) {
    try {
      const { queryMemoryScored, RAG_RELEVANCE_MAX_DISTANCE } = await import("./memory.js");
      const scored = await queryMemoryScored(instructionText, 4).catch(() => null);
      if (Array.isArray(scored)) {
        const relevant = scored.filter((c) => c.distance <= RAG_RELEVANCE_MAX_DISTANCE);
        internalMiss = relevant.length === 0; // 검색 실패(null)면 미판정(false 유지)
        if (relevant.length > 0) sources = [...new Set(relevant.map((c) => c.documentId).filter(Boolean))];
      }
    } catch {
      /* 메모리 모듈 로드 실패 시 미판정 */
    }
  }
  return { dataHits, internalMiss, ...(sources ? { sources } : {}) };
}

// 응답 턴에 붙일 짧은 도구/경로 배지 — 화면에서 "무엇으로 처리됐는지"를 한눈에 보여준다.
function turnToolTag(r: DispatchResult): string | undefined {
  if (r.approval) return "결재판";
  if (r.confirm) return "확인대기";
  if (r.steps && r.steps.length) return `${r.steps.length}단계`;
  if (r.toolCalls && r.toolCalls.length) return r.toolCalls[0].tool;
  if (r.route && r.route.action !== "chat") return r.route.action;
  return undefined;
}

async function dispatchInstructionCore(instructionText: string, contextText = "", screen?: string): Promise<DispatchResult> {
  // 런타임 가드레일 — 입력의 프롬프트 인젝션 시도를 실시간 검사. block 모드면 거절, flag면 기록·경고 후 진행.
  // guardInput을 직접 부르지 않고 게이트웨이를 거친다 — 검사 지점을 한 곳으로 모아, 앞으로
  // 검사가 늘어도(PII·출력 필터 등) 모든 입구에 자동으로 적용되게 하기 위함이다.
  const guard = gateUserInput(instructionText, "dispatch");
  if (guard.flagged) {
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `🛡 가드레일: 프롬프트 인젝션 시도 감지(${guard.categories.join(", ")})${guard.allowed ? " — 기록 후 진행" : " — 차단"}` });
  }
  if (!guard.allowed) {
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P1" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output: `🛡 가드레일이 이 요청을 차단했습니다 — 프롬프트 인젝션 시도로 판단(${guard.categories.join(", ")}). 정상 요청이면 표현을 바꿔 다시 시도하거나, 설정에서 가드레일 모드를 조정하세요.`,
    };
  }

  // 도움말/사용법 의도는 화면별 가이드로 결정적으로 답한다(LLM·도구 없이). "이 화면 뭐 할 수 있어?"
  // 같은 질문이 예전엔 일반 대화로 떨어져 화면과 무관한 답을 냈다 — screenguide로 그라운딩한다.
  if (isHelpIntent(instructionText)) {
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatScreenGuide(screen, instructionText) };
  }

  // "지식베이스 정리/중복 점검" — 상충·중복·신선도를 결정적으로 점검(삭제 없이 리포트).
  if (KB_HYGIENE_INTENT_RE.test(instructionText)) {
    const { scanKbHygiene, formatKbHygiene } = await import("./kbhygiene.js");
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatKbHygiene(await scanKbHygiene()) };
  }

  // "공격 경로 / 도달성 분석" — 3소스 상관으로 진입→거점→인접 경로를 결정적으로 구성.
  if (ATTACK_PATH_INTENT_RE.test(instructionText)) {
    const { formatAttackPaths } = await import("./analysishub.js");
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P2" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatAttackPaths() };
  }

  // "Shadow AI 점검해줘 / 미등록 AI 있어?" — 시스템 관측 신호로 미등록 모델을 결정적으로 찾는다.
  if (SHADOW_AI_INTENT_RE.test(instructionText)) {
    const { formatShadowAi } = await import("./shadowai.js");
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P2" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatShadowAi() };
  }

  // "이 취약점 조치 방법 알려줘" — 결정적 조치 플레이북으로 답한다(LLM 없이). 단계·담당·SLA를
  // 규칙으로 제공해 MTTR을 줄인다. 실행 지시("조치해줘")가 아니라 방법 문의일 때만.
  if (REMEDIATION_INTENT_RE.test(instructionText) && !/조치해|처리해|수정해|패치해/.test(instructionText)) {
    const { formatRemediation } = await import("./playbook.js");
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    const kev = /kev|실제.?악용|악용 중/i.test(instructionText);
    const sev = /critical|치명/i.test(instructionText) ? "critical" : /high|높은/i.test(instructionText) ? "high" : "medium";
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output: formatRemediation({ findingType: instructionText, severity: sev as "critical" | "high" | "medium", kev }),
    };
  }

  // 학습 루프 실행 지시는 확인 절차로 우회 — 파이프라인을 타지 않는다.
  if (LEARN_TOPIC_RE.test(instructionText) && LEARN_RUN_RE.test(instructionText)) {
    return learnloopConfirmResult(instructionText);
  }

  // 복합 지시(2단계 이상)면 오케스트레이션으로 순차 실행한다.
  const steps = planInstruction(instructionText);
  if (steps.length >= 2) {
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P1" });
    setAgentStatus("orchestrator", "working");
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `복합 지시 ${steps.length}단계 실행: ${steps.map((s) => s.label).join(" → ")}` });
    const stepResults = await runOrchestration(instructionText, steps, task);
    resetAgentToDefault("orchestrator");
    const updated = completeTask(task.id);
    const completedTask = updated.find((t) => t.id === task.id) ?? task;
    const output = stepResults.map((r, i) => `【${i + 1}. ${r.label}】 ${r.output}`).join("\n\n");
    return { task: completedTask, route: { agentId: "orchestrator", action: "chat" }, output, steps: stepResults };
  }

  // 에이전트 루프를 intent 분류보다 **먼저** 시도한다. 등록된 도구로 답할 수 있으면 그것으로 끝낸다.
  // 순서가 중요하다(2026-07-17 실측): 예전엔 4분류 intent(scan/analyze/report/chat)가 앞을 막아
  // "지금 급한 취약점 상위 3건만 알려줘"가 analyze로 분류돼 루프에 도달하지 못했다. 그 4분류는
  // 화면 메뉴를 미러링한 레거시 축이라, 의도 축 도구셋(search·explain·today)의 앞을 막으면 안 된다.
  // 루프가 처리 못 하면(null) 아래 기존 경로로 그대로 폴백하므로 스캔·리포트 동작은 보존된다.
  // 화면에서 온 업무 영역으로 도구 후보를 좁힌다 — 도구가 늘어도 프롬프트가 커지지 않게 하는 장치.
  // 화면을 모르거나 전역 화면(대시보드)이면 undefined라 종전대로 전체가 후보가 된다.
  const loop = await runAgentLoop(instructionText, contextText, {
    domains: toolDomainsForScreen(screen),
  }).catch(() => null);
  if (loop) {
    const loopTask = createTask({ text: instructionText, agentId: "orchestrator", priority: "P2" });
    setAgentStatus("orchestrator", "working");
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `지시 처리: "${instructionText}"` });
    // 완료 이벤트는 실제 답변을 실어 나른다 — 120자로 자르면 지휘 콘솔 대화가 목록 중간에서 끊긴다
    // (2026-07-20 사용자 지적). 화면 쪽이 4줄 클램프+더보기로 접으므로 여기선 넉넉히 보낸다.
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `완료: ${loop.output.slice(0, 1500)}` });
    resetAgentToDefault("orchestrator");
    const updated = completeTask(loopTask.id);
    return {
      task: updated.find((t) => t.id === loopTask.id) ?? loopTask,
      route: { agentId: "orchestrator", action: "chat" },
      output: loop.output,
      toolCalls: loop.toolCalls,
      ...(loop.approval ? { approval: loop.approval } : {}),
    };
  }

  // 화면 컨텍스트를 함께 넘긴다 — 동사 없는 지시("정리해줘")를 화면으로 해석하기 위함(screencontext.ts).
  const route = await routeIntent(instructionText, screen);
  const agent = getAgentById(route.agentId);

  const task = createTask({ text: instructionText, agentId: route.agentId, priority: priorityForAction(route.action) });

  setAgentStatus(route.agentId, "working");
  emitCollaboration({ from: "orchestrator", to: route.agentId, message: `작업 할당: "${instructionText}"` });

  let output: string;
  let toolCalls: AgentToolCall[] | undefined;
  let approval: PendingApproval | undefined;
  try {
    const result = await executeRoutedAction(route, instructionText, contextText);
    output = result.output;
    toolCalls = result.toolCalls;
    approval = result.approval;
    if (result.findings) {
      updateTaskPriority(task.id, priorityForFindings(result.findings));
    }
  } catch (err) {
    output = `실행 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  emitCollaboration({ from: route.agentId, to: "orchestrator", message: `작업 완료: ${output}` });
  resetAgentToDefault(route.agentId);
  const updatedTasks = completeTask(task.id);
  const completedTask = updatedTasks.find((t) => t.id === task.id) ?? task;

  return { task: completedTask, route, output, ...(toolCalls ? { toolCalls } : {}), ...(approval ? { approval } : {}) };
}

export function registerDispatcherRoutes(app: Express): void {
  app.post(
    "/api/dispatch",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
      // screen — 클라이언트가 보내는 현재 화면(예: "vulnscan.html"). 없어도 동작한다(구버전 호환).
      const screen = typeof req.body?.screen === "string" ? req.body.screen : undefined;
      res.json(await dispatchInstruction(String(req.body?.text ?? ""), sessionId, screen));
    })
  );
  // 실행 없이 지시가 몇 단계로 계획되는지 미리 보여준다(복합 지시 여부 확인용).
  app.post("/api/dispatch/plan", authMiddleware, (req, res) => {
    const steps = planInstruction(String(req.body?.text ?? ""));
    res.json({ steps, multi: steps.length >= 2 });
  });

  // 결재판 승인 — 화면에서 사람이 값을 확인(수정 가능)하고 승인한 쓰기 도구를 실제로 실행한다.
  // 지시만으로는 절대 여기 도달하지 않는다(오발동 방지 원칙 — 학습루프 확인 절차와 같은 계약).
  app.post(
    "/api/agent/approve",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const toolName = String(req.body?.tool ?? "");
      const instruction = String(req.body?.instruction ?? "");
      const rawArgs = (req.body?.args ?? {}) as Record<string, unknown>;
      // 화면에서 온 값만 문자열로 받는다(타입 오염 방어).
      const args: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawArgs)) if (typeof v === "string") args[k] = v;
      const task = createTask({ text: `[승인 실행] ${toolName}`, agentId: "orchestrator", priority: "P2" });
      setAgentStatus("orchestrator", "working");
      emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `승인됨 — ${toolName} 실행` });
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      try {
        const undoBefore = undoSnapshot(); // #7: 실행 전 상태 스냅샷(원클릭 undo용)
        const output = await executeApprovedTool(toolName, args);
        const undoId = undoCommit(toolName, output.slice(0, 50), undoBefore); // 변화 있으면 되돌리기 항목 등록
        emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `실행 완료: ${output.slice(0, 600)}` });
        // 작업 기록(감사 로그) — 승인된 쓰기 실행을 남긴다(챗봇 제안 → 사람 승인).
        recordAudit({ kind: "write", actor, action: `승인 실행: ${toolName}`, target: args.assetId ?? args.code ?? null, detail: `${instruction ? instruction + " → " : ""}${output.slice(0, 200)}`, result: "ok" });
        // 사람이 승인한 (지시→도구) = 검증된 정답. 파인튜닝 골드 예시로 누적한다(Phase 4, 자가강화).
        appendApprovedDecision(instruction, toolName, args);
        resetAgentToDefault("orchestrator");
        const updated = completeTask(task.id);
        res.json({ output, undoId, task: updated.find((t) => t.id === task.id) ?? task });
      } catch (err) {
        resetAgentToDefault("orchestrator");
        completeTask(task.id);
        recordAudit({ kind: "write", actor, action: `승인 실행 실패: ${toolName}`, detail: err instanceof Error ? err.message : String(err), result: "error" });
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
}
