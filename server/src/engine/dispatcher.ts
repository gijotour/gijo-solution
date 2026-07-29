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
import { isOutOfScope, outOfScopeAnswer, isTooVague, vagueAnswer } from "./scopeguard";
import { analyzeFindings } from "./analysis";
import { recordFindings, getAsset, listAssets } from "./assets";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { generateReport } from "./report";
import { listFindingReviews } from "./approvals";
import { listMaintenanceItems } from "./maintenance";
import { ACTION_CHECK_RE, runActionCheck } from "./actioncheck";
import { appendTurn, recentTurnsText, getSession, createSession } from "./worksessions";
import { LONG_ANSWER_MS, startLongAnswer, finishLongAnswer, failLongAnswer } from "./longanswer";

// 협업 로그는 "무슨 일이 있었나"를 남기는 활동 기록이다 — 답변 전문을 그대로 실으면 화면에
// 같은 글이 두 번 보인다(2026-07-26 사용자 지적: 같은 답이 연달아 두 번 나옴). 앞부분만 남긴다.
function collabNote(text: string): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? t.slice(0, 90) + "…" : t;
}

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

// 보고서 지시에 "무엇을·누구에게"가 빠졌는지. 이 중 하나라도 있으면 되묻지 않는다.
const REPORT_DETAIL_RE = /취약점|자산|점검|하드닝|주간|월간|분기|경영진|임원|감사|내부|대외|제출|이번\s*주|지난\s*달|이번\s*달|kev|컴플라이언스|규정|인수인계/i;
function needsReportDetail(text: string): boolean {
  const t = text.trim();
  // 아주 짧은 지시("보고서 만들어줘", "리포트 뽑아줘")만 되묻는다 — 길게 설명했으면 그대로 진행.
  return t.length <= 30 && !REPORT_DETAIL_RE.test(t);
}

// 되물음 문구 — 담당자가 그대로 골라 말할 수 있게 실제 만들 수 있는 것만 제시한다.
function reportClarification(): string {
  return [
    "어떤 보고서를 만들까요? 아래처럼 말씀해 주세요.",
    "",
    "  · \"미조치 취약점 보고서 만들어줘\"  — 남은 취약점과 우선순위",
    "  · \"이번 주 점검 결과 보고서\"       — 하드닝·정기점검 결과",
    "  · \"경영진 보고용으로 만들어줘\"     — 격식 있는 요약본(대외·감사 제출용)",
    "  · \"○○ 자산 보고서 만들어줘\"       — 특정 자산만",
    "",
    "리포트 화면의 [＋ 리포트 생성]에서 종류·대상·형식(DOCX·PDF)을 직접 고를 수도 있습니다.",
  ].join("\n");
}

// ── 시연 실측(2026-07-29, 계획서 전-1)이 잡은 라우팅 결함용 결정적 분기 재료 ──────────
// "보고서를 만들어 달라"는 의도 — 조회(스케줄·이력)와 갈라야 한다.
export const REPORT_CREATE_RE = /(리포트|보고서)[^\n]{0,12}(만들|생성|작성|뽑|출력)|(만들|생성|작성)[^\n]{0,8}(리포트|보고서)/;
export const REPORT_QUERY_EXCLUDE_RE = /스케줄|일정|예약|언제|이력|목록/;

// "반려 사유가 주로 뭐였어?" — 사내 이력 질문. 데이터는 취약점 검토·유지보수 점검 두 곳에 실재한다.
export const REJECT_HISTORY_RE = /반려[^\n]{0,10}(사유|이유|왜|뭐|얼마나|몇|이력|내역)|(오탐|보상통제)[^\n]{0,8}(이력|내역|얼마나|몇\s*건)/;

const REJECT_REASON_LABEL: Record<string, string> = { false_positive: "오탐", compensating_control: "보상통제" };

/** 반려 이력을 실데이터로 요약한다 — LLM 없이. 지시문에 대상 낱말이 있으면 그걸로 거른다. */
export function formatRejectHistory(instructionText: string): string {
  const STOP = /^(반려|사유|이유|주로|뭐였어|뭐야|왜|이력|내역|알려줘|보여줘|얼마나|몇|건|의|은|는)$/;
  const keywords = instructionText.split(/\s+/).map((w) => w.replace(/[?.,!]/g, "")).filter((w) => w.length >= 2 && !STOP.test(w));

  const vulnAll = listFindingReviews().filter((r) => r.status === "rejected");
  const maintAll = listMaintenanceItems().filter((m) => m.status === "rejected");
  const hits = (text: string) => keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()));
  let vuln = keywords.length ? vulnAll.filter((r) => hits(`${r.assetId} ${r.findingKey} ${r.note ?? ""}`)) : vulnAll;
  let maint = keywords.length ? maintAll.filter((m) => hits(`${m.title} ${m.reviewNote ?? ""}`)) : maintAll;
  let scopeNote = "";
  if (keywords.length && vuln.length + maint.length === 0) {
    // 대상 낱말로는 0건 — 억지로 좁히지 말고 전체를 보여주되 그 사실을 말한다(정직).
    vuln = vulnAll; maint = maintAll;
    scopeNote = `\n(※ "${keywords.join(" ")}"에 해당하는 반려는 없어 전체 이력을 보여드립니다)`;
  }
  if (vuln.length + maint.length === 0) {
    return "반려 이력이 아직 없습니다 — 취약점 검토(조치·승인 화면)나 유지보수 점검에서 반려가 생기면 여기 사유별로 집계됩니다.";
  }
  const byReason = new Map<string, number>();
  for (const r of vuln) byReason.set(REJECT_REASON_LABEL[r.rejectReason ?? ""] ?? "사유 미기재", (byReason.get(REJECT_REASON_LABEL[r.rejectReason ?? ""] ?? "사유 미기재") ?? 0) + 1);
  const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "-");
  const lines: string[] = [
    `반려 이력 요약 — 취약점 검토 ${vuln.length}건 · 유지보수 점검 ${maint.length}건${scopeNote}`,
  ];
  if (byReason.size) lines.push(`사유 분포(취약점): ${[...byReason.entries()].map(([k, v]) => `${k} ${v}건`).join(" · ")}`);
  const recentV = [...vuln].sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0)).slice(0, 5);
  for (const r of recentV) {
    lines.push(`  - [취약점] ${r.findingKey} @ ${r.assetId} — ${REJECT_REASON_LABEL[r.rejectReason ?? ""] ?? "사유 미기재"}${r.note ? ` · ${String(r.note).slice(0, 60)}` : ""} (${r.reviewedBy ?? "-"}, ${fmt(r.reviewedAt)})`);
  }
  const recentM = [...maint].sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0)).slice(0, 5);
  for (const m of recentM) {
    lines.push(`  - [점검] ${m.title} — ${m.reviewNote ? String(m.reviewNote).slice(0, 60) : "사유 미기재"} (${m.reviewedBy ?? "-"}, ${fmt(m.reviewedAt)})`);
  }
  return lines.join("\n");
}

async function executeRoutedAction(route: RoutedIntent, instructionText: string, contextText = "", screen?: string, qa?: boolean): Promise<ActionResult> {
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
    case "report": {
      // [2026-07-26 사용자 지적] "보고서 만들어줘"에 벤더 매뉴얼을 인용한 엉뚱한 설명이 나왔다.
      // report 액션이 그냥 chat으로 흘러 RAG가 "report"라는 낱말에 걸린 문서를 끌어온 것.
      // 무엇을 담을 보고서인지 모르는 채 만들면 쓸모없는 문서가 나온다 — 먼저 되묻는다.
      // 대상·종류가 이미 지시에 있으면 되묻지 않고 그대로 진행한다.
      if (needsReportDetail(instructionText)) return { output: reportClarification() };
      const message = contextText ? `${contextText}

[현재 지시] ${instructionText}` : instructionText;
      return { output: await chat({ agentId: route.agentId, message, remember: true, trusted: true, explain: true, screen, qa }) };
    }
    case "analyze":
    case "chat":
    default: {
      // 모델 로드·선택은 chat() 내부(ensureAgentModel)에서 처리된다.
      // 세션 맥락이 있으면 앞에 붙여 "이어서/그거" 같은 대화형 후속을 이해하게 한다.
      const message = contextText ? `${contextText}\n\n[현재 지시] ${instructionText}` : instructionText;
      // trusted: 지시문은 dispatchInstructionCore에서 이미 관문을 지났다(이중 집계 방지).
      // explain: 지휘 콘솔에 그대로 표시되는 답변이다.
      return { output: await chat({ agentId: route.agentId, message, remember: true, trusted: true, explain: true, screen, qa }) };
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
  emitCollaboration({ from: "normaltic", to: "orchestrator", message: `부연 완료: ${collabNote(output)}` });
  resetAgentToDefault("normaltic");
  return { action: "enrich", label: "용어 해설·사례 부연", output };
}

// 복합 지시를 순차 실행한다. 각 단계는 협업 로그로 실시간 브로드캐스트되고, 스캔 결과(findings)는
// 다음 단계(분석·리포트)로 누적 전달된다.
async function runOrchestration(instructionText: string, steps: OrchestrationStep[], task: TaskItem, qa?: boolean): Promise<StepResult[]> {
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
          : await chat({ agentId: "analysis", message: instructionText, remember: true, trusted: true, qa });
      } else {
        // report — 앞 단계에서 스캔한 자산이 있으면 그 범위로, 없으면 전체로 보고서를 만든다.
        const scoped = scannedAssetIds.size ? [...scannedAssetIds] : undefined;
        const r = await generateReport({ type: "ondemand", assetIds: scoped, createdBy: "AI 팀(오케스트레이터)" });
        assetIds = scoped;
        output = `${r.executiveSummary}\n(리포트 파일: ${r.filePath})`;
      }
    } catch (err) {
      output = `단계 실패: ${err instanceof Error ? err.message : String(err)}`;
    }

    emitCollaboration({ from: agentId, to: "orchestrator", message: `단계 ${i + 1} 완료: ${collabNote(output)}` });
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
export async function dispatchInstruction(instructionText: string, sessionId?: string, screen?: string, actor?: string, qa?: boolean): Promise<DispatchResult> {
  // 평가 게이트/QA 실행(중-3): 작업 세션·협업 피드에 기록하지 않는다 — 게이트 문답 수백 건이
  // 작업내역에 쌓이면 학습 후보함(출처 B)과 담당자의 작업 이력을 오염시킨다. 맥락도 싣지 않아
  // 문항 간 독립(재현성)을 보장한다. 라우팅·RAG·가드레일 등 제품 판단 경로는 전부 동일하다.
  if (qa) return dispatchInstructionCore(instructionText, "", screen, actor, true);
  // 세션을 새로 만들 땐 지시한 사람을 실행자로 남긴다 — 여러 담당자가 쓰는데 목록만 보고는
  // 누가 한 일인지 알 수 없었다(2026-07-26 사용자 지적).
  const session = (sessionId ? getSession(sessionId) : null) ?? createSession(undefined, undefined, actor);
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
  const core = await dispatchInstructionCore(instructionText, contextText, screen, actor);
  const result: DispatchResult = { ...core, ...(await computeOfferSignals(core, instructionText, screen)) };
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
  screen?: string,
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
  // 답을 만든 쪽이 근거를 이미 확정했으면(빈 배열 포함) 여기서 다시 채우지 않는다 —
  // 행동 대조가 "판정 근거 없음(NA)"으로 답했는데 이 재검색이 참고 문서를 근거 배지로
  // 둔갑시키는 실측 사고가 있었다(2026-07-29, Tenable 가이드가 NA 답의 근거로 표시됨).
  const sourcesAlreadyDecided = result.sources !== undefined;
  if (!sourcesAlreadyDecided && dataHits === 0 && !result.approval && !result.confirm && !isSmallTalkInstruction(instructionText)) {
    try {
      const { queryMemoryScored, RAG_RELEVANCE_MAX_DISTANCE } = await import("./memory.js");
      const scored = await queryMemoryScored(instructionText, 4, undefined, screen).catch(() => null);
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

async function dispatchInstructionCore(instructionText: string, contextText = "", screen?: string, actor?: string, qa?: boolean): Promise<DispatchResult> {
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

  // 뜻을 알 수 없는 입력("1", ".", "ㅁ")은 LLM에 보내지 않는다 — 헤매다 10초를 쓰고
  // 그게 "오래 걸리는 작업"으로 판정돼 리포트까지 만들어졌다(2026-07-26 실측).
  if (isTooVague(instructionText)) {
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: vagueAnswer() };
  }

  // 보안 업무 밖 질문은 일관되게 거절하고 할 수 있는 것으로 되돌린다(2026-07-26 사용자 결정 ②).
  // 도구·RAG를 타기 전에 걸러야 한다 — 안 그러면 사내 문서에서 아무거나 끌어와 그럴듯하게 답한다.
  if (isOutOfScope(instructionText)) {
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: outOfScopeAnswer() };
  }

  // 도움말/사용법 의도는 화면별 가이드로 결정적으로 답한다(LLM·도구 없이). "이 화면 뭐 할 수 있어?"
  // 같은 질문이 예전엔 일반 대화로 떨어져 화면과 무관한 답을 냈다 — screenguide로 그라운딩한다.
  if (isHelpIntent(instructionText, screen)) {
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
    const stepResults = await runOrchestration(instructionText, steps, task, qa);
    resetAgentToDefault("orchestrator");
    const updated = completeTask(task.id);
    const completedTask = updated.find((t) => t.id === task.id) ?? task;
    const output = stepResults.map((r, i) => `【${i + 1}. ${r.label}】 ${r.output}`).join("\n\n");
    return { task: completedTask, route: { agentId: "orchestrator", action: "chat" }, output, steps: stepResults };
  }

  // ── 행동 대조 (2026-07-29, 계획서 전-2) — "이거 해도 돼?"는 검색이 아니라 판정 질문이다 ──
  // 사내규정(RAG)으로만 판정하고, 법령은 원문 링크로 안내, 근거 없으면 판정하지 않는다(NA 계약).
  if (ACTION_CHECK_RE.test(instructionText)) {
    const task = createTask({ text: instructionText, agentId: "analysis", priority: "P2" });
    const r = await runActionCheck(instructionText);
    completeTask(task.id);
    return {
      task,
      route: { agentId: "analysis", action: "chat" },
      output: r.output,
      sources: r.sources,
      dataHits: r.sources.length,
    };
  }

  // ── 시연 실측이 잡은 라우팅 결함 2건의 결정적 분기 (2026-07-29, 계획서 전-1) ──────────
  // ① "방화벽 반려 사유는 주로 뭐였어?" — 사내 반려 이력이 있는데 LLM 일반론으로 답했다.
  //    반려 데이터는 두 곳(취약점 검토·유지보수 점검)에 실재하므로 코드가 직접 센다.
  if (REJECT_HISTORY_RE.test(instructionText)) {
    const task = createTask({ text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatRejectHistory(instructionText) };
  }
  // ② "주간 보안 리포트 작성해줘" — 생성이 아니라 스케줄 조회 도구로 샜다(루프가 먼저 먹음).
  //    생성 의도는 루프보다 먼저 잡아 실제 파일을 만든다. 대상이 불명확하면 기존 되물음.
  if (REPORT_CREATE_RE.test(instructionText) && !REPORT_QUERY_EXCLUDE_RE.test(instructionText)) {
    const task = createTask({ text: instructionText, agentId: "report", priority: "P2" });
    if (needsReportDetail(instructionText)) {
      completeTask(task.id);
      return { task, route: { agentId: "report", action: "report" }, output: reportClarification() };
    }
    const audience = /경영진|임원|대외|제출|감사|공식/.test(instructionText) ? "official" : "internal";
    const mentioned = listAssets().find((a) => instructionText.includes(a.name) || instructionText.includes(a.id));
    const r = await generateReport({
      type: "ondemand",
      assetIds: mentioned ? [mentioned.id] : undefined,
      audience,
      createdBy: actor ?? "챗봇 지시",
    });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "report", action: "report" },
      output: `${r.executiveSummary}\n\n(리포트 파일 생성됨: ${r.filePath} — 리포트 화면에서 열람·다운로드할 수 있습니다)`,
    };
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
    qa,
    actor,
  }).catch(() => null);
  if (loop) {
    const loopTask = createTask({ text: instructionText, agentId: "orchestrator", priority: "P2" });
    setAgentStatus("orchestrator", "working");
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `지시 처리: "${instructionText}"` });
    // 완료 이벤트는 실제 답변을 실어 나른다 — 120자로 자르면 지휘 콘솔 대화가 목록 중간에서 끊긴다
    // (2026-07-20 사용자 지적). 화면 쪽이 4줄 클램프+더보기로 접으므로 여기선 넉넉히 보낸다.
    emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `완료: ${collabNote(loop.output)}` });
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
    const result = await executeRoutedAction(route, instructionText, contextText, screen, qa);
    output = result.output;
    toolCalls = result.toolCalls;
    approval = result.approval;
    if (result.findings) {
      updateTaskPriority(task.id, priorityForFindings(result.findings));
    }
  } catch (err) {
    output = `실행 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  emitCollaboration({ from: route.agentId, to: "orchestrator", message: `작업 완료: ${collabNote(output)}` });
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
      const text = String(req.body?.text ?? "");
      const user = (req as Request & { user?: GijoUser }).user;
      // qa=true — 평가 게이트/QA 호출 표시(중-3). 세션·학습 수집을 건너뛴다(오염 방지).
      // 판단 경로는 동일하므로 이 플래그로 점수가 후해지는 일은 없다.
      const qa = req.body?.qa === true;

      // 30초 안에 안 끝나면 "리포트로 작성해 드리겠다"고 답하고 물러난다(사용자 결정 2026-07-26, 10초→30초).
      // 작업은 뒤에서 계속 돌고, 끝나면 리포트로 저장한 뒤 화면에 팝업으로 알린다.
      const work = dispatchInstruction(text, sessionId, screen, user?.displayName, qa);
      let handedOff = false;
      const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), LONG_ANSWER_MS));
      const first = await Promise.race([work, timer]);

      if (first !== null) {
        res.json(first);
        return;
      }

      handedOff = true;
      const longId = startLongAnswer(text, user?.id ?? null);
      const actor = user?.displayName ?? null;
      work
        .then(async (r) => {
          if (!handedOff) return;
          await finishLongAnswer(longId, r.output || "(내용 없음)", actor);
        })
        .catch((e: unknown) => {
          failLongAnswer(longId, e instanceof Error ? e.message : String(e));
        });

      res.json({
        task: { id: longId, text, agentId: "orchestrator", priority: "P2", status: "working", createdAt: Date.now() },
        route: { agentId: "orchestrator", agentName: "보안 총괄", reason: "오래 걸리는 작업" },
        output:
          "시간이 걸리는 작업이라 리포트로 작성해 드리겠습니다. 다 되면 알려드릴게요 — 다른 일 보셔도 됩니다.",
        longAnswerId: longId,
      });
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
        emitCollaboration({ from: "orchestrator", to: "orchestrator", message: `실행 완료: ${collabNote(output)}` });
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
