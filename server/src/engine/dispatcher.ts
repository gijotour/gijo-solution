// engine/dispatcher.ts — 지시 → 할당 → 실행 → 로그까지 잇는 조율 로직 (서버 측)
// 8단계 문서에서 설명한 파이프라인과 동일하되, collaboration 로그는 이제
// WebSocket으로 모든 접속 클라이언트에 브로드캐스트된다.

import type { Express, Request } from "express";
import { 말투재기 } from "./tonewatch";
import { 거짓완료차단 } from "./falseclaim";
import { 원문누출차단 } from "./rawleak";
import { toolLabel } from "./agenttools";
import { authMiddleware } from "../auth/auth";
import { runWithViewer } from "./viewerctx";
import type { GijoUser } from "../auth/users";
import { recordAudit } from "./audit";
import { asyncRoute } from "../util/asyncRoute";
import { routeIntent, RoutedIntent } from "./intent";
import { GUARDRAIL_BLOCK_MARK } from "./redteam";
import { createTask, completeTask, updateTaskPriority, listTasks, TaskItem } from "./tasks";
import { buildMyWork } from "./mywork";
import { setAgentStatus, resetAgentToDefault, getAgentById } from "./agents";
import { emitCollaboration } from "./collaboration";
import { 모델스캔, StandardFinding } from "./bridge";
import { chat } from "./llm";
// ⚠ **llm이 아니라 noevidence에서 가져온다.** llm을 통째로 흉내 내는 시험이 76개라, llm에서
//   심볼을 하나만 더 가져와도 그 시험들의 dispatchInstruction이 죽는다(2026-09-05 실측 9파일 66건).
//   배너 문장의 주인은 그 파일 하나다 — 여기서 문구를 다시 적지 않는다.
import { 근거없음종류판정, type 근거없음종류 } from "./noevidence";
import { isNonLearningAccount } from "./learnpolicy";
import { recordChatLog } from "./learnloop";
import { faqAnswerFor } from "./productfaq";
import type { Viewer } from "./memory";
import { 문서지목질문 } from "./memory";
import { runAgentLoop, forcedToolFor, AgentToolCall, 가리킬것없는대명사, 가리킨자산이없나, 대명사뿐인가, 대명사확인, 되물음, 자산되물음, 선택을박는다, 직전대상자산 } from "./agentloop";
import { 스트림자리 } from "./streamsink";
import { 장애질문인가, 장애초동절차, 침해사고질문인가, 침해사고초동절차 } from "./incidentsteps";
import { executeApprovedTool, findAgentTool, buildApproval, PendingApproval, 에디션제한중, 조건이좁히나 } from "./agenttools";
import { appendApprovedDecision } from "./orchestrator-dataset";
import { undoSnapshot, undoCommit } from "./undo";
// ⚠ gateUserInputInner — 신호(llm_activity `guard`)를 안 쏘는 본문. **설명 도구가 쓰는 자리**다
//   (결정적도착지). 실동작 경로는 종전대로 gateUserInput을 쓴다(gateway.ts 머리글 참고).
import { gateUserInput, gateUserInputInner } from "./gateway";
import { toolDomainsForScreen } from "./screencontext";
import { isHelpIntent, formatScreenGuide, 이름으로화면찾기, 방법질문화면찾기, 화면위치안내 } from "./screenguide";
import { findHowTo, howToMarkdown } from "./howto";
import { buildFindingPicks, parsePickCommand, pickToolArgs, isFindingListAsk, findingListAnswer, isMyWorkAsk, myWorkAnswer, stripPickMarks, parseViewIds, stripViewMark, parseScopeMark, stripScopeMark, parseShellMark, stripShellMark, PickList } from "./picklist";
import { isOutOfScope, outOfScopeAnswer, isTooVague, vagueAnswer, 한낱말되묻기 } from "./scopeguard";
import { analyzeFindings } from "./analysis";
import { recordFindings, getAsset, listAssets, 자산표시이름 } from "./assets";
import { listFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { generateReport } from "./report";
import { listFindingReviews } from "./approvals";
import { listMaintenanceItems } from "./maintenance";
import { ACTION_CHECK_RE, runActionCheck } from "./actioncheck";
import { appendTurn, recentTurnsText, getSession, createSession, markSession, attachSessionText } from "./worksessions";
import { runWithRagScope, sanitizeDocIds, sanitizeAttachIds } from "./ragscope";
import type { SessionMarks, SessionFold } from "./worksessions";
import { LONG_ANSWER_MS, QA_LONG_ANSWER_MS, REPORT_HANDOFF_MS, 보고서꼴, startLongAnswer, finishLongAnswer, failLongAnswer } from "./longanswer";
import { runWithProgress, isValidProgressId, reportProgress, reportBigStep, registerProgressRoutes } from "./progress";
import { recordAnswerTiming } from "./observability";
import { 내부키치환 } from "./tone";

// 협업 로그는 "무슨 일이 있었나"를 남기는 활동 기록이다 — 답변 전문을 그대로 실으면 화면에
// 같은 글이 두 번 보인다(2026-07-26 사용자 지적: 같은 답이 연달아 두 번 나옴). 앞부분만 남긴다.
function collabNote(text: string): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? t.slice(0, 90) + "…" : t;
}

// 평가 게이트/QA 실행은 담당자의 작업 목록·활동 이력에 남기지 않는다(검토 지적 2026-07-29).
// 게이트 1회는 99문항이라 협업 피드 링버퍼(500)를 밀어내고 작업 내역을 99건 부풀린다.
// 판단 경로는 그대로 두고 "기록"만 비켜 간다 — 반환 형태는 같아야 하므로 임시 작업 객체를 만든다.
function mkTask(qa: boolean | undefined, args: Parameters<typeof createTask>[0]): TaskItem {
  if (!qa) return createTask(args);
  return {
    id: `qa-${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    priority: args.priority ?? "P2",
    text: args.text,
    agentId: args.agentId,
    done: true,
    createdAt: Date.now(),
  } as TaskItem;
}
function collab(qa: boolean | undefined, e: Parameters<typeof emitCollaboration>[0]): void {
  if (!qa) emitCollaboration(e);
}
/**
 * 근거 원문 한 대목 — 답을 만든 문서에서 실제로 쓰인 글.
 *
 * 왜 이름만으로는 부족한가(2026-08-01 실측): 문서에 "미사용 룰 37개"라고 적혀 있는데
 * 7B가 "27"이라고 답했다. 근거 배지에는 그 문서가 **맞게** 떴다 — RAG는 정상이고 모델이
 * 표를 잘못 읽은 것이다. 담당자는 그 숫자로 보고를 쓴다. 원문을 함께 보여 주면 눈으로 잡는다.
 */
export interface SourceQuote {
  documentId: string;
  text: string;
}
export interface DispatchResult {
  task: TaskItem;
  route: RoutedIntent;
  output: string;
  steps?: StepResult[]; // 복합(멀티스텝) 지시일 때 각 단계 결과
  toolCalls?: AgentToolCall[]; // 에이전트 루프가 실행한 도구 내역(화면 표시용)
  // 해석 한 줄 — 질문을 어느 도구로 알아들었는지 사람 말로(2026-08-09, Purple AI의 쿼리 투명성 채택).
  // 라우팅이 어긋났을 때 담당자가 **그 자리에서** 알아차리게 한다. 도구가 돈 답에만 붙는다.
  해석?: string;
  // 화면 선택이 없어 **직전에 다룬 자산으로 이어 붙였을 때** 그 이름(2026-08-09 ③).
  // 해석 한 줄이 이것을 밝힌다 — 우리가 한 추측이라 틀렸을 때 담당자가 그 자리에서 알아야 한다.
  이어붙인대상?: string;
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
  // 대화 안 데이터 카드(승인 시안 대화_데이터카드, 2026-08-19) — KPI+표를 서버가 결정적으로
  // 계산해 내려준다. 클라 chatparts.dataCard가 그린다(모델이 채우는 자유 필드 없음).
  dataCard?: import("./datacard").DataCard;
  nextChips?: string[]; // ➡ 다음 작업 제안(QA ④) — nextguide.ts 표에서, 실측 검증 문장만
  scopeSet?: import("./scopecmd").ScopeSet; // 🗂 범위 걸기/풀기 신호(기능 가이드 ②) — 실행은 클라 콘솔
  internalMiss?: boolean;
  // 답변 그라운딩에 쓰인(검색된) 사내 문서 ID — 화면이 "근거: 문서명" 배지로 표시한다.
  // 인수인계 자동 검증도 이 필드로 "올린 문서가 실제로 인용되는가"를 판정한다.
  sources?: string[];
  /**
   * 그 sources가 **답의 근거인가, 찾아보기만 한 자료인가** (2026-08-13 · 계획서 전-4 4-ⓑ).
   *
   * ⚠ 왜 필요한가 — 배지가 거짓말을 하고 있었다(운영 실측 8문항 8회 재현):
   *     "ISMS 인증 취득일은 사내 지식 베이스에 **포함되어 있지 않습니다**"
   *       + 📄 근거: GIJO_지식_보안거버넌스_표준.md · ismsp_접근권한_검토.md
   *   답은 없다는데 출처는 있다. 담당자가 그 문서를 보고서에 출처로 적을 수 있다.
   *   뿌리: 이 sources는 **답이 실제로 인용한 자료가 아니라 따로 재검색해서 나온 후보**다.
   *   그런데 화면 문구는 「📄 **근거**」라고 단언한다.
   *
   * ⚠ 새 판정기를 만들지 않는다 — 이미 코드가 계산해 둔 `queryMemoryGraded().약한근거만`을 쓴다
   *   (llm.ts의 「⚠ 근거 약함」 배너가 이미 그 값으로 돈다). 낱말 판정으로 반복해 덴 자리라
   *   겹침·유사도 판정기를 새로 두지 않는 것이 이 설계의 핵심이다.
   */
  근거세기?: "강함" | "약함";
  /**
   * 「가리킬 사내 근거가 없다」 — 답에 **이미 붙은 배너**(4종)를 출구에서 읽어 실은 값
   * (2026-09-05 · 시안 mockups/no-evidence-numbers 승인). 화면이 이 값이 있을 때만
   * 답 속 숫자를 옅게 그린다(chatparts.dimEstimates).
   *
   * ⚠ **근거세기와 다른 칸에 둔다.** 두 값은 서로 다른 것을 재고, 실제로 어긋난다:
   *   · 근거세기 = 배지용 **재검색**(아래 :954, 살균 전 graded.scored)의 세기 — 재검색이
   *     안 도는 답(도구로 집계한 답 등)에서는 아예 안 생긴다.
   *   · 근거없음 = 담당자가 답에서 **실제로 읽는 배너 문장**(llm.ts 판정, 살균 후 0건).
   *   실측(실전 답 152건, 2026-09-05): 근거세기가 원리상 undefined인 답이 121건(79.6%)인데
   *   그중 배너가 붙은 것은 1건뿐이다 — 「근거세기 없음 = 근거 없음」으로 읽으면 120건이
   *   오탐으로 회색이 된다. 그래서 **「없음」을 명시적으로 실어 보낸다.**
   */
  근거없음?: 근거없음종류;
  /** 근거 원문 대목 — 담당자가 답의 숫자를 눈으로 검증할 수 있게(2026-08-01). */
  quotes?: SourceQuote[];
  // "가서 하기" — AI가 대신 하면 안 되는 일(계정·인증·열쇠)에 순서를 안내하면서 그 화면을
  // 같이 돌려준다. 대화창이 [그 화면 열어주기] 버튼으로 그린다(2026-07-31).
  // 갈 화면이 없는 안내(백업처럼)에서는 아예 넣지 않는다 — 있는 척하면 없는 버튼을 찾게 된다.
  openScreen?: { page: string; label: string };
  // 답에 취약점 목록이 나왔으면 **그 목록을 체크해서 바로 조치**할 수 있게 같이 준다(2026-07-31).
  // 조건("critical 전부")은 말로 옮긴 범위라 어긋날 수 있지만, 눈으로 고른 것은 어긋나지 않는다.
  picklist?: PickList;
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
  // ⚠ **내부 표식을 뗀 꼴도 받는다.** 실측(2026-08-03 게이트): "sample-web01 스캔하고 리포트까지"가
  //   대상을 못 찾아 **전체 자산(57개)**으로 번졌다 — 실제 id가 `vuln:sample-web01`이라
  //   글자 그대로는 안 걸렸기 때문이다. 그래서 43초면 될 일이 **190초**가 됐고,
  //   게이트는 이 문항을 **5판 연속 「측정 못 함」**으로 버렸다(30초 넘어 리포트로 전환).
  //   담당자가 화면에서 보는 글자는 이름이고, 내부 키를 그대로 칠 이유가 없다.
  const 벗김 = (s: string) => s.replace(/^(vuln|asset|finding|task):/, "");
  const mentioned = listAssets().find(
    (a) => text.includes(a.id) || text.includes(a.name) || (벗김(a.id).length >= 4 && text.includes(벗김(a.id)))
  );
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
// ⚠ 오탐 쪽 사이 글자 여유를 8 → 14로 넓혔다(2026-08-03 실전 147상황):
//   "오탐으로 표시된 거 몇 건이야?"가 **아홉 글자 차이로** 빗나가 LLM에게 갔고,
//   모델은 "9건입니다" 뒤에 오탐 튜닝 일반론을 붙였다. 세는 일은 코드가 센다.
export const REJECT_HISTORY_RE = /반려[^\n]{0,10}(사유|이유|왜|뭐|얼마나|몇|이력|내역)|(오탐|보상통제)[^\n]{0,14}(이력|내역|얼마나|몇\s*(건|개))/;

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
    // ⚠ **사람이 읽는 글자만** 낸다. 예전에는 `2aa6def8dcc181ae @ vuln:sample-web01`처럼
    //   내부 열쇠와 내부 id를 그대로 냈다(2026-08-03 말투 감시가 잡음). 담당자에게 그 글자는
    //   아무 뜻이 없고, 되짚으려 해도 그 값으로는 화면에서 찾을 수 없다.
    const 이름 = 자산표시이름(r.assetId);
    const 무엇 = r.finding?.finding_type ?? "(취약점 이름 없음)";
    lines.push(`  - [취약점] ${무엇} @ ${이름} — ${REJECT_REASON_LABEL[r.rejectReason ?? ""] ?? "사유 미기재"}${r.note ? ` · ${String(r.note).slice(0, 60)}` : ""} (${r.reviewedBy ?? "-"}, ${fmt(r.reviewedAt)})`);
  }
  const recentM = [...maint].sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0)).slice(0, 5);
  for (const m of recentM) {
    lines.push(`  - [점검] ${m.title} — ${m.reviewNote ? String(m.reviewNote).slice(0, 60) : "사유 미기재"} (${m.reviewedBy ?? "-"}, ${fmt(m.reviewedAt)})`);
  }
  // ⚠ 숫자만 주고 끝내면 "그래서 뭘 하지"가 남는다(2026-08-03 실전 147상황이 이 답을 지적).
  //   오탐으로 넘긴 것은 **다시 볼 값어치가 있는 기록**이다 — 어디서 되짚는지 알려 준다.
  lines.push(
    "",
    vuln.length || maint.length
      ? `▸ 이어서 — 판정을 되돌리시려면 "○○ 미검토로 되돌려줘", 전체를 보시려면 ③ 조치 › 「조치·승인」 화면`
      : `▸ 이어서 — 아직 오탐으로 넘긴 것이 없습니다. 검토할 것은 "미조치 취약점 뭐 있어?"`
  );
  return lines.join("\n");
}

async function executeRoutedAction(route: RoutedIntent, instructionText: string, contextText = "", screen?: string, qa?: boolean, noLearn?: boolean, viewer?: Viewer): Promise<ActionResult> {
  switch (route.action) {
    case "scan": {
      const assetId = route.targetAssetId ?? "unknown-asset";
      const scanPath = getAsset(assetId)?.path ?? assetId;
      const findings = await 모델스캔(scanPath);
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
      const message = buildRagQuery(instructionText, contextText);
      // noLearn:true — 수집은 dispatchInstructionScoped 출구 한 곳에서 한다(이중 기록 방지).
      return { output: await chat({ agentId: route.agentId, message, remember: true, trusted: true, explain: true, screen, qa, noLearn: true, viewer, logQuestion: instructionText }) };
    }
    case "analyze":
    case "chat":
    default: {
      // 모델 로드·선택은 chat() 내부(ensureAgentModel)에서 처리된다.
      // 세션 맥락이 있으면 앞에 붙여 "이어서/그거" 같은 대화형 후속을 이해하게 한다.
      const message = buildRagQuery(instructionText, contextText);
      // trusted: 지시문은 dispatchInstructionCore에서 이미 관문을 지났다(이중 집계 방지).
      // explain: 지휘 콘솔에 그대로 표시되는 답변이다.
      reportProgress("write", "사내 근거를 찾아 답을 쓰고 있습니다"); // chat 내부에서 RAG 검색+작성이 함께 돈다
      // noLearn:true — 수집은 dispatchInstructionScoped 출구 한 곳에서 한다(이중 기록 방지).
      // 거짓 완료(하지 않은 일을 했다는 답)는 여기서 막지 않는다 — **출구 한 곳**
      // (dispatchInstruction의 거짓완료를걸러낸다)에서 모든 갈래를 한꺼번에 본다.
      return { output: await chat({ agentId: route.agentId, message, remember: true, trusted: true, explain: true, screen, qa, noLearn: true, viewer, logQuestion: instructionText }) };
    }
  }
}

const AGENT_FOR_ACTION: Record<OrchestrationStep["action"], string> = { scan: "scan", analyze: "analysis", report: "report" };

// GIJO Agent(normaltic) 부연 — 스캔·분석 결과에 나온 용어·탐지 항목을 사내 지식베이스(RAG) 근거로
// 해설하고 실제 사례를 부연한다. 단계마다 부르면 LLM 호출이 배로 늘어 파이프라인이 느려지므로
// 스캔·분석이 모두 끝난 지점에 1회만 투입한다(2026-07-17 확정). 실패해도 파이프라인은 계속(보조 단계).
async function runGijoEnrichment(results: StepResult[], fromAgentId: string, qa?: boolean): Promise<StepResult> {
  const source = results
    .filter((r) => r.action === "scan" || r.action === "analyze")
    .map((r) => `[${r.label}] ${r.output}`)
    .join("\n")
    .slice(0, 1500); // 프롬프트 폭주 방지 — 용어 추출에는 앞부분 요약이면 충분
  setAgentStatus("normaltic", "working");
  collab(qa, { from: fromAgentId, to: "normaltic", message: "스캔·분석 결과 용어 해설·사례 부연 요청" });
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
  collab(qa, { from: "normaltic", to: "orchestrator", message: `부연 완료: ${collabNote(output)}` });
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
    collab(qa, { from: "orchestrator", to: "ti", message: "CTI ↔ 자산 자동 매칭 요청 — 위협 인텔을 자산 인벤토리와 대조" });
    const findings = await listFindings();
    const ids = [...new Set(matchCtiToAssets(findings, listAssets()).matches.flatMap((m) => m.matchedAssets.map((a) => a.assetId)))];
    collab(qa, { from: "ti", to: "orchestrator", message: ids.length ? `영향 자산 ${ids.length}개 매칭: ${ids.join(", ").slice(0, 100)}` : "영향 자산 없음 — 현재 CTI 위협과 매칭되는 자산이 없습니다" });
    resetAgentToDefault("ti");
    return ids;
  };
  // GIJO 부연을 끼워 넣을 지점: 마지막 스캔/분석 단계 직후(리포트보다 앞 — 해설→보고 순서).
  const lastInterpretIdx = steps.reduce((last, s, idx) => (s.action === "scan" || s.action === "analyze" ? idx : last), -1);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const agentId = AGENT_FOR_ACTION[step.action];
    setAgentStatus(agentId, "working");
    reportBigStep(i + 1, steps.length, step.label); // 진행 카드의 "큰 단계 n/m" — 실제 단계 수 그대로
    collab(qa, { from: "orchestrator", to: agentId, message: `단계 ${i + 1}/${steps.length} — ${step.label}` });

    let output = "";
    let assetIds: string[] | undefined;
    let findingCount: number | undefined;
    try {
      if (step.action === "scan") {
        assetIds = await resolveScopeAssetIds(step.scope, ctiAffected);
        let count = 0;
        for (const assetId of assetIds) {
          const scanPath = getAsset(assetId)?.path ?? assetId;
          const findings = await 모델스캔(scanPath);
          recordFindings(assetId, findings);
          accumulated.push(...findings);
          scannedAssetIds.add(assetId);
          count += findings.length;
        }
        findingCount = count;
        output = assetIds.length
          // ⚠ 내부 id를 그대로 내지 않는다 — 사람이 읽는 글자가 아니다(말투 규범).
          ? `${assetIds.length}개 자산 스캔 완료 — 발견 ${count}건 (${assetIds.map(자산표시이름).join(", ")})`
          : "스캔 대상 자산이 없습니다.";
      } else if (step.action === "analyze") {
        output = accumulated.length
          ? (await analyzeFindings(accumulated)).summary
          // noLearn:true — 수집은 dispatchInstructionScoped 출구 한 곳에서 한다(이중 기록 방지).
          : await chat({ agentId: "analysis", message: instructionText, remember: true, trusted: true, qa, noLearn: true });
      } else {
        // report — 앞 단계에서 스캔한 자산이 있으면 그 범위로, 없으면 전체로 보고서를 만든다.
        const scoped = scannedAssetIds.size ? [...scannedAssetIds] : undefined;
        const r = await generateReport({ type: "ondemand", assetIds: scoped, createdBy: "AI 팀(오케스트레이터)", qa });
        assetIds = scoped;
        output = `${r.executiveSummary}\n(리포트 파일: ${r.filePath})`;
      }
    } catch (err) {
      output = `단계 실패: ${err instanceof Error ? err.message : String(err)}`;
    }

    collab(qa, { from: agentId, to: "orchestrator", message: `단계 ${i + 1} 완료: ${collabNote(output)}` });
    resetAgentToDefault(agentId);
    results.push({ action: step.action, label: step.label, output, assetIds, findingCount });

    // 마지막 스캔/분석 단계가 끝나면 GIJO Agent가 결과 용어·사례를 부연한다.
    // 부연할 거리가 없으면(스캔 finding 0건 + 분석 단계도 없음) 건너뛴다.
    if (i === lastInterpretIdx && (accumulated.length > 0 || step.action === "analyze")) {
      results.push(await runGijoEnrichment(results, agentId, qa));
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
/**
 * "○○ 어떻게 해?"에서 ○○가 **열려 있는 내 할 일**이면 그 이름을 돌려준다(아니면 null).
 *
 * ⚠ 끝을 `$`로 묶지 않는다 — 자산·화면 맥락이 뒤에 붙는 경우가 있어 앵커가 조용히 깨졌다
 *   (2026-08-01 실측: "10.10.20.41 — 취약점 점검 어떻게 해?"가 안 잡혔다). 대신 **할 일
 *   이름과 겹칠 때만** 통과시켜 좁힌다 — 그게 오검출을 막는 진짜 자물쇠다.
 */
/**
 * 말이 **열려 있는 내 할 일 하나를 가리키는가**. 절차 질문·완료 판정이 같은 자물쇠를 쓴다.
 *
 * ⚠ 두 번 데었다.
 *   ① 끝을 `$`로 묶었더니 자산 맥락이 뒤에 붙는 경우에 조용히 깨졌다.
 *   ② 부분일치에 길이 하한이 없어 **"점검"** 두 글자가 "웹서버-01 — 취약점 점검"에 걸렸다
 *      (검토 지적). 업무 이름이 죄다 유형명(취약점 점검·하드닝 점검)이라 상시로 걸린다 —
 *      그러면 일반 지식 질문에 특정 호스트 체크리스트가 답으로 나간다.
 *   그래서 **이름 길이의 절반 이상**을 대야 통과시킨다. 딱 맞는 이름은 길이와 무관하게 통과.
 */
async function 내할일이름인가(말: string): Promise<boolean> {
  const 납작 = (s: string) => s.replace(/\s/g, "");
  const b = 납작(말);
  if (!b) return false;
  const 겹치나 = (이름: string) => {
    const a = 납작(이름);
    if (a === b) return true;
    if (b.length < 4) return false; // 두세 글자 유형명이 걸리면 안 된다
    if (a.includes(b)) return b.length >= Math.max(4, Math.ceil(a.length * 0.5));
    // ⚠ 반대 방향에도 **같은 절반 규칙**을 건다(2026-08-03). 없으면 흔한 업무명
    //   "정책 점검"(4자)이 "AhnLab V3 정책 점검"(13자) 질문에 걸려, 제품 점검 절차를
    //   물었는데 내 할 일을 뒤진다. 질문에만 있는 고유한 말(제품명 등)이 붙으면 같은 일이 아니다.
    return b.includes(a) && a.length >= Math.max(4, Math.ceil(b.length * 0.5));
  };
  if (listTasks().some((t) => !t.done && 겹치나(t.text))) return true;
  // ⚠ tasks만 보면 **아직 안 담은 AI 제안**을 놓친다(2026-08-01 실측). 목록에 버젓이 보이고
  //   「지금 이거」로 지목까지 한 것을 "못 찾았다"고 답하던 원인이다. 제안 이름까지 함께 본다.
  try {
    const p = await buildMyWork();
    if ([...p.today, ...p.week, ...p.later].some((i) => !i.saved && 겹치나(i.text))) return true;
  } catch { /* 목록을 못 만들면 그냥 다음 분기로 넘긴다 */ }
  return false;
}

export async function 내할일절차질문(text: string): Promise<string | null> {
  const m = String(text ?? "").match(/(.{2,60}?)\s*(?:어떻게\s*(?:해|하지|하나요|합니까)|절차\s*(?:알려|보여)|뭐부터\s*(?:해|하지))/);
  if (!m) return null;
  const 말 = m[1].trim();
  if (!말 || /화면|메뉴|이거|이걸|여기|이곳/.test(말)) return null; // 화면 사용법은 screenguide의 몫
  return (await 내할일이름인가(말)) ? 말 : null;
}

/**
 * "○○ 완료" — 내 할 일을 끝냈다는 말인가(아니면 null).
 *
 * ★ 여기가 **낱말 제외어를 쓰면 안 되는 자리**다(검토 지적 2026-08-01). 처음엔
 *   `취약점|점검|자산|CVE` 가 들어가면 비켜서게 했는데, 정작 **업무 이름 자체가 그 낱말로
 *   만들어진다**("10.10.20.41 — 취약점 점검", "○○ 하드닝 점검"). 목록이 시킨 그대로
 *   "취약점 점검 완료"라고 쳤을 때 도구가 안 불리는, 막으려던 바로 그 사고가 재현됐다.
 *   제외는 **어형**으로만 한다 — 취약점 상태를 바꾸는 말(update_finding_status의 몫)은
 *   "조치 완료 처리해줘"처럼 대상·동사를 따로 달고 온다.
 */
export async function 내할일완료말(text: string): Promise<string | null> {
  const t = String(text ?? "");
  if (/처리해|바꿔|변경|표시해|등록해|배정|담당자/.test(t)) return null; // 상태 변경 지시는 저쪽 몫
  const m = t.match(/^(.{2,60}?)\s*(?:완료(?:했|됐|야|입니다|요)?|끝냈(?:어|다|습니다)|다\s*했(?:어|다|습니다))\s*[.!]?\s*$/);
  if (!m) return null;
  const 말 = m[1].trim().replace(/^(그|이|저)\s+/, "");
  return (await 내할일이름인가(말)) ? 말 : null;
}

// ★ 2026-08-04: **제품이 「조치 검증 결과 알려줘」라고 안내해 놓고** 그 말이 여기 안 걸렸다
//   (안내 문구 전수 점검에서 발견). 「검증」 갈래를 더한다 — 우리가 시킨 대로 친 말은
//   회차마다 답이 달라지면 안 된다.
// ⚠ 기한(SLA) 물음이 빠져 있었다(2026-08-12 실측). "medium 취약점은 며칠 안에 조치해야 해?"가
//   8.5초 LLM으로 샜다 — 플레이북은 그 숫자를 **규칙으로 정확히 아는데도** 안 불렸다.
//   기한은 지어내면 안 되는 값이라 결정적 답이 있어야 하는 자리다.
//   ⚠ 넓혀도 안전하다 — 아래 `플레이북영토인가`가 「취약점 얘기일 때만」으로 이미 가둔다.
const REMEDIATION_INTENT_RE =/(조치|대응|remediat|패치|수정)\s*(방법|절차|어떻게|가이드|플레이북|playbook)|어떻게\s*(조치|대응|패치|고쳐|해결)|대응\s*방안|조치\s*검증|(고친|조치한)\s*(거|것)\s*(확인|검증)|검증\s*결과|(해결|처리)\s*됐는지\s*(확인|검증)|(며칠|기한|언제까지|얼마\s*만에|sla)[^.\n]{0,20}(조치|패치|고쳐|해결)|(조치|패치)\s*기한/i;
// "Shadow AI/미등록 AI/비인가 모델 점검·확인"
const SHADOW_AI_INTENT_RE = /shadow\s*ai|미등록\s*(ai|모델|엘엘엠|llm)|비인가\s*(ai|모델)|섀도우|(등록\s*안\s*된|등록되지\s*않은)\s*(ai|모델)/i;
// "공격 경로 / 도달성 / 측면 이동" 분석
const ATTACK_PATH_INTENT_RE = /공격\s*경로|attack\s*path|도달\s*(성|가능)|측면\s*이동|lateral|reachab|이동\s*경로/i;
// "지식베이스 정리·중복·상충 점검"
// ⚠ 2026-08-13 — 둘째 갈래가 **붙어 있는 말만** 받고 있었다: `(중복|상충)\s*(문서|자료)`.
//   그래서 「문서함에 중복된 거」(첫 갈래)는 여기로 오는데 「중복**된** 문서」는 사이의 「된 」에
//   막혀 비켜 갔고, 뒤의 doc_duplicates 강제분기로 떨어졌다. **같은 뜻인데 어순·어미로 답이 갈렸다.**
//   그리고 갈라진 두 답은 품질이 다르다 — 여기(kbhygiene)는 제목 정규화 + **본문 지문(근접중복)**
//   + 버전상충 + 오래됨까지 보고, doc_duplicates는 **제목 뿌리만** 본다. 여기가 상위집합이다.
//   (실측 2026-08-13: 같은 문서함에서 여기는 「정리 필요 2건」, 저쪽은 「없습니다」)
//   → 사이를 {0,4}로 열고 「겹치」도 같은 뜻이라 함께 받는다. 중복을 묻는 말은 **한 곳으로** 간다.
//   ⚠ {0,4}로 좁게 둔다 — 「중복 로그인 관련 문서」처럼 먼 동거를 삼키면 안 된다.
const KB_HYGIENE_INTENT_RE = /(지식\s*베이스|지식|문서|rag|자료).{0,6}(정리|중복|상충|위생|점검|청소|정돈)|(중복|상충|겹치)[^.\n]{0,4}(문서|자료)/i;

// ── 「결재 승인 처리해줘」 — 결재판(pending approval) 승인 요청 (2026-08-14, 평가 게이트가 잡은 결함) ──
//
// 뿌리: 이 말이 강제 규칙 없이 LLM 선택으로 샜고, **결재를 대화창에서 승인하는 도구가 없어**
//   모델이 자유작문으로 「✅ 승인 완료」를 지어냈다(도구·결재판 0건, 실제 실행 없음 — falseclaim).
//   게이트 refuse-approve-own이 실측으로 잡았다(2026-08-14).
// 두 가지를 코드로 못박는다: ① 결재는 결재판(화면 버튼)에서 처리한다 — 대화창이 지어내지 않는다.
//   ② **자기가 올린 결재는 본인이 승인할 수 없다**(공동작업 원칙 「자기 PR 자기 병합 금지」와 같은 정신).
// ⚠ 「취약점 승인·반려」(review_finding)와 안 겹치게 **「결재」 낱말**을 핵심으로 좁게 잡는다.
//   「이 취약점 승인해줘」엔 「결재」가 없어 안 걸린다.
export const 결재승인요청_RE = /결재[^.\n]{0,20}(승인|반려|처리|올려|처리해)|(승인|반려)\s*(대기|요청|올린|낸)[^.\n]{0,10}(승인|반려|처리)해/;
export const 자기결재_RE = /(내가|본인이|제가|방금)[^.\n]{0,15}(올린|낸|신청한|요청한)|내\s*(가\s*)?(올린|낸|신청한|요청한)?\s*결재/;
const LEARN_RUN_RE = /실행|시작|돌려|가동|run|start/i;

// ── 체인 안에 **글자로 박혀 있던** 판별들을 이름 붙여 꺼낸 자리(2026-09-04) ──────────
// ⚠ 왜 꺼냈나: `결정적도착지`(아래)가 「이 말이 어디로 갑니까」를 답하려면 같은 판별을 써야
//   하는데, 인라인 정규식은 **베껴 적는 수밖에 없다.** 베낀 순간 두 벌이 되고, 이 저장소가
//   반복해 겪은 「같은 것을 여러 곳에 적으면 어긋난다」가 그대로 재현된다.
//   동작은 한 글자도 안 바뀐다 — 자리만 옮겨 이름을 붙였다.

/** 「내 문서」를 겨냥한 **찾기 질문**인가 — 열기·삭제·공유·저장·사용법은 이 가드의 일이 아니다.
 *  ⚠ (?<![사안]) — 「사내 문서」·「안내 문서」의 꼬리에 「내 문서」가 들어 있다(screenguide가 먼저 밟은 함정). */
function 내문서찾기질문(t: string): boolean {
  return /(?<![사안])내\s?문서/.test(t) && !/문서함/.test(t)
    && /(있|찾|알려|검색|내용|요약|정리|뭐|무엇|무슨)/.test(t)
    && !/(저장|기록해|추가해|만들|올려|넣어|써\s?줘|열어|열기|삭제|지워|공유|바꿔|어떻게|사용법|화면)/.test(t);
}
/** 없앤 「내 업무」 화면을 찾는 말 — 화면·메뉴·탭을 **반드시 대야** 잡는다(안 그러면 흔한 물음까지 샌다). */
const 내업무화면폐지_RE = /(내\s*업무|할\s*일)\s*(화면|메뉴|탭)\s*(어디|없어|사라|안\s*보|어떻게\s*가|못\s*찾)/;
/** 「○○ 다시 열어줘」 — 완료 답변이 약속하는 말이라 반드시 이어져야 한다. */
const 되열기_RE = /^(.{2,60}?)\s*(?:다시\s*열|완료\s*취소|되돌려|안\s*했)/;
/** 「조치해 줘」류 **명령형** 실행 지시 — 플레이북(방법 안내)이 비켜 주는 자리.
 *  ⚠ `/조치해/`로 넓히면 「조치**해야 해?**」라는 **질문**까지 밀려난다(2026-08-12 실측). */
const 조치실행지시_RE = /(조치|처리|수정|패치)\s*해\s*(줘|주세요|주라|다오|라|$)/;
/** 「이거 쉽게 설명해줘」 칩 — 기능어를 빼면 4자라 대명사 관문을 비켜 갔다(검토관 B중2). */
const 설명칩_RE = /^이거\s*쉽게\s*설명해\s*줘?\s*$/;

async function learnloopConfirmResult(instructionText: string, qa?: boolean): Promise<DispatchResult> {
  setAgentStatus("analysis", "working");
  collab(qa, { from: "orchestrator", to: "analysis", message: "학습 루프 실행 요청 — 확인 절차 안내" });
  const { listDatasets } = await import("./dataset.js");
  const datasets = listDatasets();
  // 주제별 전문가 진척(재설계 3단계) — "어느 전문가부터 학습 가능한가"를 확인 안내에 함께.
  const { topicTrainGate, TOPICS } = await import("./learnloop.js");
  const 진척 = TOPICS.map((t) => {
    const g = topicTrainGate(t);
    return `${t} ${g.approved}/${g.target}${g.ok ? " ✓학습 가능" : ""}`;
  }).join(" · ");
  const output = [
    "학습 루프(전문가 어댑터 학습)는 실 GPU 학습이 실행되고, 학습하는 동안 로컬 LLM 엔진이 일시 중단됩니다.",
    "오발동 방지를 위해 지시만으로는 시작하지 않습니다 — 아래에서 데이터셋을 고르고 '학습 시작'을 직접 확인해 주세요.",
    `주제별 재료(승인 문답): ${진척} — 목표에 찬 주제부터 전문가 학습을 시작할 수 있습니다.`,
    datasets.length
      ? `사용 가능한 데이터셋 ${datasets.length}개: ${datasets.map((d) => `${d.id}(${d.examples}건)`).join(", ")}`
      : "사용 가능한 데이터셋이 없습니다 — 학습 루프 화면에서 대화 로그로 데이터셋을 먼저 만들어 주세요.",
  ].join("\n");
  collab(qa, { from: "analysis", to: "orchestrator", message: "학습 루프 실행 대기 — 화면에서 확인 필요" });
  resetAgentToDefault("analysis");
  const task = mkTask(qa, { text: instructionText, agentId: "analysis", priority: "P2" });
  const updated = completeTask(task.id);
  const completedTask = updated.find((t) => t.id === task.id) ?? task;
  return { task: completedTask, route: { agentId: "analysis", action: "chat" }, output, confirm: { type: "learnloop", datasets } };
}

// 작업 세션 래퍼 — sessionId가 있으면 지시를 user 턴, 응답을 assistant 턴으로 기록하고
// 직전 턴들을 맥락으로 실어 "이어서" 지시가 되게 한다.
// sessionId가 없으면 자동으로 새 세션을 만들어 기록한다(사용자 요청 2026-07-20 — "모든 행위를
// 작업 세션에": 팀 사무실 CTA·에이전트 페이지 등 세션 없이 오던 지시도 이력에 남게).
// 응답의 sessionId를 클라이언트가 저장하면 그 세션으로 "이어서" 지시가 된다.
/** 선택 문자열 정리 — 한 줄로 눌러 200자에서 자르되 **⌗기계 키 꼬리는 보존**한다
 *  (검토관 11: 키가 맨 뒤라 긴 선택에서 잘리면 배정 키 배관이 조용히 무효화된다). */
function 선택정리(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const 한줄 = raw.replace(/\s+/g, " ").trim();
  const 키 = /⌗.+?::[0-9a-f]{16}\s*$/.exec(한줄)?.[0]?.trim();
  const 본문 = 키 ? 한줄.slice(0, 한줄.length - 키.length).trim() : 한줄;
  return (본문.slice(0, 200) + (키 ? " " + 키 : "")).trim();
}

export async function dispatchInstruction(instructionText: string, sessionId?: string, screen?: string, actor?: string, qa?: boolean, noLearn?: boolean, viewer?: Viewer, 선택?: string): Promise<DispatchResult> {
  // ★ 이 요청이 끝날 때까지 "누가 묻는지"를 달아 둔다. 아래에서 도는 AI 도구(search·explain)는
  //   run(args) 한 모양이라 사람을 넘길 자리가 없다 — 꼬리표가 없으면 대화는 등급을 지키는데
  //   도구로 물으면 기밀 문서가 그대로 나온다(2026-08-01 실검증에서 잡은 뚫린 문. viewerctx.ts).
  const result = await runWithViewer(viewer, () =>
    dispatchInstructionScoped(instructionText, sessionId, screen, actor, qa, noLearn, viewer, 선택)
  );
  // 출구 관문은 여기 한 줄에 모은다 — 갈래마다 심으면 새 갈래가 생길 때 또 샌다.
  //   ① 거짓 완료(하지 않은 일을 했다는 답)  ② 기계 데이터 누출(저장소 원문 조각)
  const 거른것 = 해석을단다(기계데이터를걸러낸다(instructionText, 거짓완료를걸러낸다(instructionText, result)));
  // ★ 「근거 없음」 표식(2026-09-05 · 시안 no-evidence-numbers 승인) — 답에 **이미 붙은**
  //   배너 4종을 여기서 한 번 읽어 값으로 싣는다. 화면은 이 값이 있을 때만 숫자를 옅게 그린다.
  //   ⚠ **거르개 뒤**여야 한다: 거짓완료 대체답처럼 본문이 통째로 갈리면 배너도 사라지는데,
  //     앞에서 판정하면 없는 배너를 가리키는 표식이 남는다.
  //   ⚠ 판정기는 llm.ts(배너 상수를 소유한 곳)에 있다 — 여기서 문구를 다시 적지 않는다.
  const 근거없음 = 근거없음종류판정(거른것.output);
  const 걸러진 = 근거없음 ? { ...거른것, 근거없음 } : 거른것;
  // ➡ 다음 작업 칩(QA ④, 2026-08-19) — 답의 경로(도구/분기)별로 실측 검증된 후속 지시를
  //   자동 동봉한다. LLM이 만들지 않는다(nextguide.ts 표 — 시나리오 실측 ✓ 문장만).
  //   결재판이 떠 있으면 안 붙인다 — 다음 행동은 그 승인이지 딴 길이 아니다.
  if (!걸러진.approval && !걸러진.nextChips) {
    const { nextChipsFor, routeFromParts } = await import("./nextguide.js");
    const 경로 = routeFromParts(걸러진);
    const 칩 = 경로 ? nextChipsFor(경로) : [];
    if (칩.length) return { ...걸러진, nextChips: 칩 };
  }
  return 걸러진;
}

/**
 * 해석 한 줄 — 도구가 돈 답에 "질문을 무엇으로 알아들었는지"를 사람 말로 단다
 * (2026-08-09, Purple AI·Charlotte의 쿼리 투명성 채택). 라우팅이 어긋난 날,
 * 담당자가 20분짜리 게이트를 기다리지 않고 **그 자리에서** 알아차리는 장치다.
 *
 * ⚠ 결재판에는 안 단다 — 결재판 자체가 이미 "무엇을 하려는지"를 보여 준다.
 * ⚠ 라벨을 못 찾으면(내부 도구 등) 그 도구는 건너뛴다 — 내부 식별자를 내보내지 않는다.
 */
function 해석을단다(r: DispatchResult): DispatchResult {
  if (r.해석 || r.approval || r.confirm) return r;
  // ★ 직전 대상으로 이어 붙였으면 **반드시 밝힌다**(2026-08-09 ③). 화면 클릭은 담당자가 고른
  //   것이지만 직전 대상은 **우리가 이어 붙인 추측**이라, 틀렸을 때 그 자리에서 보여야 한다.
  //   도구가 안 돌아 라벨이 없어도 이 줄만은 단다 — 알릴 것이 있는데 형식 때문에 삼키면 안 된다.
  const 이어붙임 = r.이어붙인대상 ? `직전에 다룬 「${r.이어붙인대상}」 기준으로 봤습니다` : "";
  const 라벨 = [...new Set((r.toolCalls ?? []).map((t) => toolLabel(t.tool)).filter((x): x is string => !!x))];
  const 알아들음 = 라벨.length ? `${라벨.join(" → ")}(으)로 알아들었습니다` : "";
  const 줄 = [알아들음, 이어붙임].filter(Boolean).join(" · ");
  return 줄 ? { ...r, 해석: 줄 } : r;
}

/**
 * 대화창 출구 한 곳에서 「하지 않은 일을 했다」는 답을 걸러낸다.
 *
 * 갈래(잡담·리포트·분석·오케스트레이션)마다 심으면 **새 갈래가 생길 때마다 또 샌다** —
 * 수집(recordChatLog)을 출구 하나로 모은 것과 같은 이유다. 여기 하나면 어떤 갈래든 걸린다.
 *
 * 「도구가 돌았나」의 판단 근거는 `toolCalls`다. 도구가 실제로 돌았으면 "등록했습니다"는 사실이고,
 * 결재판·확인 대기는 아직 실행 전이라 완료를 주장할 수도 없다(둘 다 그대로 통과).
 */
/**
 * 저장소 내부 표현이 답에 그대로 섞여 나가는 것을 막는다(2026-08-09).
 *
 * 자산 조회 답에 `"payload_id":"was_asset-…"` 같은 검색 원문 조각이 나온 사례가 있었다.
 * **QA는 이걸 통과시켰다** — 도구도 맞고 숫자도 맞아서 형식 판정으로는 정상이었다.
 * 결재판·확인 대기는 건드리지 않는다(그건 아직 보여줄 내용이 아니라 물음이다).
 */
function 기계데이터를걸러낸다(지시: string, r: DispatchResult): DispatchResult {
  if (r.approval || r.confirm) return r;
  const 검사 = 원문누출차단(지시, r.output ?? "");
  if (!검사.막았나) return r;
  console.warn(`[원문누출차단] 기계 데이터 ${검사.걸린수}줄을 걷어냄 — "${지시.slice(0, 40)}"`);
  return { ...r, output: 검사.답 };
}

function 거짓완료를걸러낸다(지시: string, r: DispatchResult): DispatchResult {
  if (r.approval || r.confirm) return r;
  const 도구가돌았나 = !!r.toolCalls?.length;
  const 검사 = 거짓완료차단(지시, r.output ?? "", 도구가돌았나);
  if (!검사.막았나) return r;
  console.warn(`[거짓완료차단] 도구가 안 돌았는데 완료를 주장해 대체함 — "${지시.slice(0, 40)}"`);
  return { ...r, output: 검사.답 };
}

async function dispatchInstructionScoped(instructionText: string, sessionId?: string, screen?: string, actor?: string, qa?: boolean, noLearn?: boolean, viewer?: Viewer, 선택?: string): Promise<DispatchResult> {
  // 평가 게이트/QA 실행(중-3): 작업 세션·협업 피드에 기록하지 않는다 — 게이트 문답 수백 건이
  // 작업내역에 쌓이면 학습 후보함(출처 B)과 담당자의 작업 이력을 오염시킨다. 맥락도 싣지 않아
  // 문항 간 독립(재현성)을 보장한다. 라우팅·RAG·가드레일 등 제품 판단 경로는 전부 동일하다.
  // 화면에서 골라 둔 항목(2026-08-09 2단계) — 「이거」의 대상. 대화 이력과 달리 이건 **질문의
  // 일부**라 qa에도 싣는다(라우트에서 이미 한 줄 눌러쓰기·200자 상한을 지났다).
  const 선택맥락 = 선택 ? `[지금 화면에서 선택한 항목] ${선택}` : "";
  if (qa) {
    const core = await dispatchInstructionCore(instructionText, 선택맥락, screen, actor, true, noLearn, viewer, 선택);
    // ⚠ 신호(dataHits·internalMiss·sources)는 **답의 일부**다 — 기록이 아니라 계산이라서
    //   qa에서도 그대로 내야 한다. 여기서 건너뛰었더니 회귀 하네스가 internalMiss=undefined로
    //   깨졌다(2026-07-30 실측). 게이트 문항은 이 신호를 안 써서 게이트 결과는 무사했지만,
    //   "시험 경로가 실사용과 같은 답을 본다"는 전제가 조용히 깨져 있었다.
    return { ...core, ...(await computeOfferSignals(core, instructionText, screen, viewer, 선택맥락)) };
  }
  // 세션을 새로 만들 땐 지시한 사람을 실행자로 남긴다 — 여러 담당자가 쓰는데 목록만 보고는
  // 누가 한 일인지 알 수 없었다(2026-07-26 사용자 지적).
  const session = (sessionId ? getSession(sessionId) : null) ?? createSession(undefined, undefined, actor);
  // 맥락은 이번 지시를 기록하기 "전" 시점의 대화로 계산한다(방금 넣은 user 턴이 맥락에 중복되지 않게).
  const 대화맥락 = session ? recentTurnsText(session.id) : "";
  // 선택이 먼저다 — 「이거」는 대화 이력보다 방금 화면에서 고른 것을 가리킨다.
  const contextText = [선택맥락, 대화맥락].filter(Boolean).join("\n\n");
  let title = session?.title;
  // 기록에는 사람 말만 남긴다 — 목록에서 고를 때 붙는 기계용 표식(sha1 해시)이 그대로 저장되면
  // 작업 내역과 이어보기가 해시 범벅이 되어 담당자가 자기 대화를 못 알아본다(2026-07-31 실화면).
  const 기록문 = stripPickMarks(instructionText);
  if (session) {
    appendTurn(session.id, "user", 기록문);
    // 첫 지시면 방금 자동 지정된 제목을 로그에 쓰기 위해 다시 읽는다("새 세션" 대신 실제 제목).
    title = getSession(session.id)?.title ?? title;
    // 작업 세션의 지시를 실시간 에이전트 협업 로그에도 흘린다 — 세션 제목으로 꼬리표를 달아
    // "어느 세션에서 온 작업인지"가 로그에 드러나게 한다(대시보드 📡 실시간 협업 피드에 표시).
    collab(qa, { from: "세션", to: "orchestrator", message: `💬 [${title}] ${기록문}` });
  }
  const core = await dispatchInstructionCore(instructionText, contextText, screen, actor, undefined, noLearn, viewer, 선택);
  const result: DispatchResult = { ...core, ...(await computeOfferSignals(core, instructionText, screen, viewer, contextText)) };
  // 팀 사무실 「움직임」 신호(2026-08-09 AI팀 구성 재편) — 답이 사내 문서를 근거로 썼으면
  // 협업 피드에 그 사실을 흘린다. 연출이 아니라 **실측(sources)이 있을 때만** — 없는 근거를
  // 꾸며 보이면 사무실 창의 머리말 약속("전부 실데이터, 가짜 연출 없음")이 깨진다.
  if (result.sources?.length) {
    const 몇 = result.sources.length;
    const 이름들 = result.sources.slice(0, 2).join(" · ");
    collab(qa, {
      from: result.route?.agentId ?? "orchestrator",
      to: "orchestrator",
      message: `📚 근거 — 사내 문서 ${몇}건 (${이름들}${몇 > 2 ? " 외" : ""})`,
    });
  }
  // 헤르메스 학습 루프 ① 수집 — **대화창 출구 한 곳**에서 남긴다(2026-08-07).
  // 예전에는 chat() 내부(remember:true)에서만 수집해, 코드가 만든 즉답·도구 답·에이전트 루프 답이
  // 전부 빠졌다 — 즉답 전환을 늘릴수록 수집이 말라 가는 구조였다(실측: 반나절 유입 1건).
  // 갈래마다 수집을 심으면 새 갈래가 생길 때마다 또 샌다 — 출구 하나면 어떤 갈래든 걸린다.
  // ⚠ 결재판·확인 대기는 남기지 않는다 — 끝난 대화가 아니다(승인 뒤 실행 결과가 진짜 답).
  // ⚠ executeRoutedAction의 chat() 호출은 noLearn:true로 내부 수집을 껐다 — 이중 기록 방지.
  if (!noLearn && result.output && !result.approval && !result.confirm) {
    recordChatLog(result.route?.agentId ?? "orchestrator", 기록문, result.output);
  }
  if (session) {
    appendTurn(session.id, "assistant", result.output, turnToolTag(result));
    collab(qa, { from: "orchestrator", to: "세션", message: `💬 [${title}] ${result.output.slice(0, 600)}` });
    // 작업 내역 구분 축을 채운다(승인 시안 2026-08-18). 세션은 대화 **전에** 만들어지므로
    // 「실행이냐 조회냐」는 여기서야 알 수 있다 — 답이 나온 뒤에 표시한다.
    try { markSession(session.id, 세션축(result, 기록문, actor, qa)); } catch { /* 표시 실패가 대화를 막지 않게 */ }
  }
  return session ? { ...result, sessionId: session.id } : result;
}

/**
 * 이 지시가 「🔧 실행」인지 「🔍 조회」인지 **제품이 이미 아는 신호로** 가른다.
 *
 * ⚠ 말로 가르지 않는다. "바꿔줘"·"해줘" 같은 낱말로 판정하면 새 표현이 생길 때마다 샌다 —
 *   그게 이 시안이 걷어내려는 「예외 목록 두더지 잡기」다. 대신 **쓰기 선언**을 본다:
 *     · 결재판이 떴다 = 쓰기 도구를 부르려 했다(`agentloop.ts:101` — 쓰기면 실행 대신 결재판).
 *     · 실행된 도구 중 `write: true`가 있다(registry의 선언이 단일 출처).
 *     · 스캔·리포트는 상태를 만든다(취약점 등록·파일 생성).
 *   나머지는 조회다.
 * ⚠ 이 판정이 틀리면 **화면에서 축 칩을 눌러 전체를 보면 된다** — 감춘 것은 지운 것이 아니다.
 */
function 세션축(result: DispatchResult, 지시문: string, actor?: string, qa?: boolean): SessionMarks {
  const 쓰기도구 = (result.toolCalls ?? []).some((c) => findAgentTool(c.tool)?.write === true);
  const 실행인가 = Boolean(result.approval) || 쓰기도구 ||
    result.route?.action === "scan" || result.route?.action === "report";
  const fold: SessionFold = 실행인가
    ? {
        // ⚠ 값 그대로다. 모델이 새로 쓰는 문장이 아니다(worksessions.ts SessionFold 주석 참고).
        asset: result.route?.targetAssetId || result.이어붙인대상 || undefined,
        target: (result.toolCalls ?? []).map((c) => c.tool).slice(0, 2).join(" · ") || result.route?.action,
        act: result.approval ? "승인 대기" : "실행",
        result: result.approval ? "" : result.output.replace(/\s+/g, " ").trim().slice(0, 60),
      }
    : { q: 지시문.replace(/\s+/g, " ").trim().slice(0, 60), a: result.output.replace(/\s+/g, " ").trim().slice(0, 80) };
  return {
    // 대화창에서 온 지시는 사람이 시킨 것이다 — 이 함수는 그 경로에서만 불린다.
    origin: "user",
    opKind: 실행인가 ? "action" : "query",
    qa: qa === true,
    fold,
  };
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

/** 근거(sources) 재검색을 할 자리인가 — 답이 내부 데이터 집계나 코드 안내가 아니라
 *  LLM이 사내 문서(RAG)로 자유 답했을 자리인가. dataHits(📄 리포트 알약용)와 **다른 잣대**다.
 *  실측 사고(2026-08-10): 근거 배지가 "답의 실제 근거"와 어긋나 있었다.
 *   ① analyze는 무조건 dataHits=1이라, RAG 문서로 답하는 analyze는 근거가 있는데도
 *      재검색이 스킵돼 sources=null이었다(「안전대부 취약점 분석」→ 근거 **누락**).
 *   ② urgent_todo·_status 같은 데이터 집계 즉답은 dataHits=0이 되고, 되묻기도 dataHits=0이라
 *      무관한 문서가 근거로 **둔갑**했다(고객이 남의 웹취약점 보고서를 자기 것처럼 읽는 사고).
 *  → analyze 같은 액션 이름이 아니라 "실제로 데이터 도구를 썼나 / 안내형 답인가"로 가른다. */
export function 근거재검색대상인가(
  result: Pick<DispatchResult, "steps" | "toolCalls" | "output" | "sources" | "approval" | "confirm">,
  instructionText: string,
): boolean {
  // ⚠ sources:[](코드 템플릿의 「사내 자료 안 봄」 선언)이면 internalMiss도 함께 false로 남는다 —
  //   **의도다**(2026-08-13 검토관 질의에 확정): 코드가 낸 절차·안내 답에 ☁외부(클라우드) 추가질의
  //   제안이 뜨는 것은 되묻기·결재 대기에 뜨는 것과 같은 헛제안이다. RAG로 자유답한 자리에서만
  //   「사내에 없으니 밖에 물을까」가 성립한다.
  if (result.sources !== undefined) return false; // 답을 만든 쪽이 근거를 이미 확정(빈 배열 포함)
  if (result.approval || result.confirm) return false; // 결재·확인 대기
  if (isSmallTalkInstruction(instructionText)) return false; // 인사·잡담은 물어볼 자료가 아니다
  // ⚠ 새 조회 도구를 만들면 이 정규식에 넣어야 근거 둔갑이 안 생긴다 — sourcebadge.test가 못박는다.
  // ⚠ 도구 **이름 조각**으로 매칭하므로 짧은 조각은 딴 이름에 부분일치한다. `cti`는 실제 도구가
  //   없는데 action_check_history·report_activity의 a"cti"on/a"cti"vity에 우연히 걸려 있었다
  //   (2026-08-10 Mac 발견). transaction·reaction 같은 이름이 생기면 조용히 걸린다 →
  //   `cti`를 실제 도구 `action_check`로 바꿔 부분일치 함정을 없앤다(CTI 조회 도구가 생기면 그때 추가).
  const 집계조회도구_RE =
    /asset|finding|action_check|vuln|sbom|analys|scan|hardening|today|urgent|kpi|brief|posture|coverage|_status|report_|audit|packages|aibom|ontology|knowledge|recent|doc_|time_saved|compliance|maintenance|adapter|model_|threat|exposed|search|law_lookup|explain|article|reopen_task|complete_task|work_steps|routine_tasks|step_done|step_undo|add_task/i;
  const 데이터집계로답함 =
    (result.steps ?? []).some((s) => (s.assetIds?.length ?? 0) + (s.findingCount ?? 0) > 0) ||
    (result.toolCalls ?? []).some((c) => 집계조회도구_RE.test(c.tool));
  if (데이터집계로답함) return false;
  // 되묻기·모호·대상 못 찾음 같은 코드가 낸 안내형 답은 문서 근거가 원리상 없다.
  const 안내형답 =
    /무엇을 알고 싶으신가요|무엇을 도와드릴까요|되묻습니다|자산 이름으로 다시|어느 자산|어떤 자산·어떤 항목/.test(
      String(result.output ?? ""),
    );
  if (안내형답) return false;
  return true;
}

/**
 * 답 머리가 「그 정보는 없다」고 말하는가 — 배지 강등용 (2026-08-13 · 4-ⓑ 마무리 ⓑ).
 *
 * ■ 무엇을 잡나(운영 실측 3건): 검색 조각이 **가깝게** 잡혀 근거세기="강함"인데 답은
 *   "ISMS 인증 취득일은 사내 지식 베이스에 포함되어 있지 않습니다" — 그런 답에 초록
 *   「📄 근거」가 붙으면 담당자가 그 문서를 보고서 출처로 적는다.
 *   답이 스스로 「없다」고 말했으면 그 문서들은 근거가 아니라 **찾아본 자료**다 → 약함으로 강등.
 *
 * ⚠ 낱말 판정의 한계를 알고 좁게 쓴다:
 *   · **머리(첫 140자)만** 본다 — 뒤에 딸린 단서("…는 확인되지 않습니다")는 결론이 아니다.
 *   · 정보 부재 꼴만 잡는다(정보/자료/내용/결과/기록 + 없습니다 계열). 「취약점이 없습니다」 같은
 *     데이터 0건 답은 애초에 데이터집계 경로라 여기(재검색 대상)에 안 온다.
 *   · 강등만 한다 — 없다-답을 막거나 바꾸지 않는다(정직한 답이다. 배지만 정직해지면 된다).
 */
export function 없다는답인가(output: string): boolean {
  const 머리 = String(output ?? "").replace(/\s+/g, " ").slice(0, 140);
  return /(정보|자료|내용|결과|기록|명단|목록|연락처|취득일)(는|가|은|이)?\s*(사내|지식\s*베이스|시스템)?[^.]{0,30}(없습니다|포함되어 있지 않|담겨 있지 않|존재하지 않|확인되지 않)/.test(머리)
    // ⚠ 동사를 낱낱이 쫓지 않는다 — 실측마다 어미가 바뀌었다(포함→기록→명시…). 다만
    //   **「~에」 조사를 요구**한다(검토관 오탐 지적): 「이 지침에 클라우드 환경은 포함되지
    //   않습니다」·「로그는 90일 이상 저장되지 않습니다」처럼 **범위·상태를 정확히 말한 좋은 답**이
    //   조사 없이 오면 걸리면 안 된다. 「지식 베이스에 등록되지 않았습니다」류(부재 선언)만 잡는다.
    || /(에|엔|에는)\s*(포함|등록|저장|기록|명시)되(어 있)?지 않/.test(머리);
}

/** 답이 RAG 검색·작성에 쓰는 질문 = 맥락(선택·대화) + 현재 지시. **배지도 이 질문으로** 근거를
 *  내야 답과 일치한다(2026-08-10 ③ 잔여 20%: 배지가 instructionText만 써서 이어보기 턴에서
 *  다른 문서를 가리켰다 — Mac 실측 완전다름 103/150·평균겹침 8%). 답 경로(chat)와 배지가 이 한
 *  함수를 공유해 어긋남을 없앤다 — 조립 규칙을 두 벌로 두면 한쪽만 고쳐진다. */
function buildRagQuery(instructionText: string, contextText: string): string {
  // ⌗기계 키(선택 꼬리)는 검색 질의에서 뗀다 — sha1 16자가 임베딩 질의에 섞이면 랭킹을
  // 흔들 수 있다(검토관 12 — 영향 크기는 미실측이지만 검색에 넣을 이유가 없는 글자다).
  const 지움 = (s: string) => s.replace(/\s*⌗.+?::[0-9a-f]{16}/g, "");
  const 지시 = 지움(instructionText);
  const 맥락 = 지움(contextText);
  return 맥락 ? `${맥락}\n\n[현재 지시] ${지시}` : 지시;
}

// 화면 액션 알약(리포트·클라우드) 조건부 노출용 신호를 계산한다.
// - dataHits: 자산·취약점 등 특정 내부 데이터를 실제로 건드렸는가(리포트로 정리할 거리가 있는가).
// - internalMiss: 데이터 답이 아닌 일반 질의인데 사내 RAG 근거가 0인가(외부 자료가 필요한가).
async function computeOfferSignals(
  result: DispatchResult,
  instructionText: string,
  screen?: string,
  viewer?: Viewer,
  contextText = "",
): Promise<{ dataHits: number; internalMiss: boolean; sources?: string[]; quotes?: SourceQuote[]; 근거세기?: "강함" | "약함" }> {
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
  let quotes: SourceQuote[] | undefined;
  let 근거세기: "강함" | "약함" | undefined;
  // ⚠ 재검색 여부는 dataHits(리포트 알약)가 아니라 근거재검색대상인가()로 가른다 —
  //   analyze RAG 답의 근거 누락 / 데이터 집계·되묻기의 근거 둔갑을 함께 막는다(2026-08-10 사고).
  if (근거재검색대상인가(result, instructionText)) {
    try {
      const { queryMemoryGraded } = await import("./memory.js");
      // ③ 배지 정확도(2026-08-10): 답 경로(chat→ragContextFor)와 **같은 함수·agentId·viewer**로
      //   근거를 낸다 — 옛 배지는 agentId 없이 queryMemoryScored로 재검색해 답과 **다른 문서**를
      //   근거로 실었다(dispatcher.ts:315 chat이 route.agentId·viewer로 답한다). graded.scored는
      //   이미 관련도 필터(RAG_RELEVANCE_MAX_DISTANCE)를 거쳤다 — 여기서 다시 거르지 않는다.
      // ③ 잔여 20%(2026-08-10 Mac 실측): 답은 buildRagQuery(맥락+지시)로 검색하는데 배지가
      //   instructionText만 쓰면 이어보기 턴에서 다른 문서를 가리켰다. **같은 질문**으로 맞춘다.
      const graded = await queryMemoryGraded(buildRagQuery(instructionText, contextText), 4, result.route?.agentId, screen, viewer).catch(() => null);
      if (graded) {
        const relevant = graded.scored;
        internalMiss = relevant.length === 0; // 검색 실패(null)면 미판정(false 유지)
        if (relevant.length > 0) {
          // ★ 4-ⓑ(2026-08-13) — 이 문서들이 **답의 근거인지 찾아보기만 한 자료인지** 가른다.
          //   `약한근거만`은 queryMemoryGraded가 이미 계산해 돌려주는 값이다(거리 0.85 안에
          //   가까운 조각이 하나도 없으면 true). llm.ts의 「⚠ 근거 약함」 배너가 쓰는 그 값이라
          //   **새 판정기가 0개**다 — 겹침·유사도를 새로 재지 않는다.
          //   ⚠ 답이 「사내에 없다」고 말하는데 강한 근거로 잡히는 경우는 이것만으로 안 갈린다
          //     (실측 8건 중 3건). 그건 답 문장을 봐야 하는데 낱말 판정이라 여기 두지 않는다 —
          //     화면이 답과 배지를 나란히 보여 주므로, 우선 **약한 것부터 정직해진다.**
          근거세기 = graded.약한근거만 ? "약함" : "강함";
          // ⓑ 답이 스스로 「없다」고 말했으면 강함이어도 **약함으로 강등**한다(위 없다는답인가 머리말).
          //   실측 3건(ISMS·지사 연락처·임원 명단)이 이 자리다 — 조각은 가까운데 답은 없다고 말한다.
          if (근거세기 === "강함" && 없다는답인가(String(result.output ?? ""))) 근거세기 = "약함";
          sources = [...new Set(relevant.map((c) => c.documentId).filter(Boolean))];
          // ★ 문서 **이름**만으로는 담당자가 답을 검증할 수 없다(2026-08-01 실측).
          //   실제 사고: 문서에 "미사용 룰 37개"라고 적혀 있는데 7B가 "27"이라고 답했다.
          //   근거 배지에는 그 문서가 맞게 떴다 — RAG는 정상이고 모델이 표를 잘못 읽은 것이다.
          //   담당자는 그 숫자로 보고를 쓴다. 원문 대목을 함께 보여 주면 눈으로 바로 잡아낸다.
          //   (7B에 프롬프트로 "숫자를 정확히 읽어라"라고 타이르지 않는다 — 확립된 원칙이다.)
          quotes = relevant.slice(0, 3).map((c) => ({
            documentId: String(c.documentId ?? ""),
            text: String(c.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
          })).filter((q) => q.text);
        }
      }
    } catch {
      /* 메모리 모듈 로드 실패 시 미판정 */
    }
  }
  return {
    dataHits,
    internalMiss,
    ...(sources ? { sources } : {}),
    ...(quotes && quotes.length ? { quotes } : {}),
    ...(근거세기 ? { 근거세기 } : {}),
  };
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

async function dispatchInstructionCore(instructionText: string, contextText = "", screen?: string, actor?: string, qa?: boolean, noLearn?: boolean, viewer?: Viewer, 선택?: string): Promise<DispatchResult> {
  // ⚠⚠ 「보고 있던 목록」 표식은 **여기서, 무엇을 판단하기 전에** 떼어 낸다(2026-08-18 검토 지적).
  //   `#고른건`과 달리 이 표식은 그 화면에서 보내는 **모든 말**에 붙고, 결재판으로 빠져나가는
  //   자리도 없다. 그대로 두면 글자를 보고 판단하는 관문들이 전부 오염된다:
  //     · isTooVague — "?" 뒤에 표식 1,300자가 붙어 「두 글자 이하」가 거짓 → **되묻기가 안 뜬다**
  //     · 한낱말되묻기 — `^취약점$`가 "취약점\n#보는목록 …"에 안 맞음 → **34초 헤매던 길로 되돌아간다**
  //   값은 아래 지역 변수로 들고 가 결재판을 채울 때 쓴다(글자에서 다시 찾지 않는다).
  const 보던목록 = parseViewIds(instructionText);
  if (보던목록) instructionText = stripViewMark(instructionText);
  // 🗂 지금 범위 — 담당자가 명시적으로 건 것이라 **늘** 대상을 좁힌다(보던목록과 다르다).
  // ⚠ 보던목록과 같은 이유로 **글자에서 먼저 뗀다** — 안 떼면 isTooVague·한낱말되묻기가
  //   표식까지 세어 되묻기가 안 뜬다(2026-08-18에 그 사고를 이미 한 번 겪었다).
  const 지금범위 = parseScopeMark(instructionText);
  if (지금범위) instructionText = stripScopeMark(instructionText);
  // 🚀 어떤 셸에서 물었나 — 길찾기 안내의 낱말 하나가 달라진다(프로엔 사이드바가 없다).
  // ⚠ 위 표식들과 같은 이유로 **관문보다 먼저** 뗀다 — 안 떼면 글자 수를 세는 판정이 오염된다.
  const 지금셸 = parseShellMark(instructionText);
  if (지금셸) instructionText = stripShellMark(instructionText);
  // 대화 열쇠 — "아까 그거"가 **이 사람의** 직전 대상만 가리키게 한다.
  //   예전에는 전역 1건이라 담당자 A가 방금 다룬 취약점을 담당자 B의 "아까 그거"가 가리켰다.
  //   ⚠ 사람을 못 알아내면 기본 대화를 쓴다 — 예전 동작 그대로다(더 나빠지지 않는다).
  const 대화열쇠 = viewer?.userId != null ? `u:${viewer.userId}` : actor ? `a:${actor}` : undefined;
  // 런타임 가드레일 — 입력의 프롬프트 인젝션 시도를 실시간 검사. block 모드면 거절, flag면 기록·경고 후 진행.
  // guardInput을 직접 부르지 않고 게이트웨이를 거친다 — 검사 지점을 한 곳으로 모아, 앞으로
  // 검사가 늘어도(PII·출력 필터 등) 모든 입구에 자동으로 적용되게 하기 위함이다.
  const guard = gateUserInput(instructionText, "dispatch");
  // 개인정보 가림 반영본으로 갈아탄다 — 이후의 라우팅·도구 인자 추출·작업 기록 전부가
  // 가린 본을 쓴다(주민·카드번호는 도구 인자일 수 없어 추출이 깨질 일이 없다).
  instructionText = guard.text;
  if (guard.flagged) {
    collab(qa, { from: "orchestrator", to: "orchestrator", message: `🛡 가드레일: 프롬프트 인젝션 시도 감지(${guard.categories.join(", ")})${guard.allowed ? " — 기록 후 진행" : " — 차단"}` });
  }
  if (!guard.allowed) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P1" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      // 문구 앞머리는 GUARDRAIL_BLOCK_MARK에서 가져온다 — 실효 견고성 측정이 이 표지로
      // "입구에서 막혔다"를 센다. 따로 적어 두면 안내문을 다듬는 순간 측정이 조용히 어긋난다.
      //
      // ⚠ 관문이 **자기 문구를 준 경우엔 그것을 쓴다**(2026-08-02). 관문에 인젝션 말고
      //   다른 판정(해로운 요청 차단)이 생겼는데 여기서 늘 "프롬프트 인젝션 시도로 판단()"을
      //   찍는 바람에, 막힌 이유가 틀리게 표시되고 괄호까지 비어 나왔다(실측).
      //   막는 것보다 **왜 막혔는지**가 담당자에게 중요하다.
      output: guard.message
        ? guard.message
        : `🛡 ${GUARDRAIL_BLOCK_MARK}했습니다 — 프롬프트 인젝션 시도로 판단(${guard.categories.join(", ")}). 정상 요청이면 표현을 바꿔 다시 시도하거나, 설정에서 가드레일 모드를 조정하세요.`,
    };
  }

  // 🃏 화면 이름 → 그 화면의 현황 카드(2026-08-19 사장님 실측 — 「자산고르기」를 쳤더니 LLM이
  //   일반 지식 개념 설명을 늘어놨다). 화면 이름을 친 사람이 원하는 것은 개념이 아니라 **그
  //   화면의 데이터**다. 되묻기(아래 한낱말·모호)보다 카드가 먼저다 — 카드가 곧 가장 좋은 답이다.
  // ⚠ 이 분기는 모호(isTooVague)보다 **앞**이어야 한다(2026-08-20 사장님 실측 — 「자산」을
  //   쳤는데 카드가 아니라 「무엇을 도와드릴까요」가 나왔다). isTooVague의 「두 글자 이하」
  //   규칙이 자산·관제·검증(전부 2글자)을 삼켰다 — 좁은 판정(정확 일치)이 넓은 판정보다 먼저다.
  {
    const { screenNameCard, 카드답변, 카드없는글로 } = await import("./datacard.js");
    const 어느카드 = screenNameCard(instructionText);
    if (어느카드 === "finding") {
      const { output, picklist, dataCard } = findingListAnswer(
        instructionText, 지금범위 && 지금범위.kind === "asset" ? 지금범위.id : null);
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
      completeTask(task.id);
      return { task, route: { agentId: "orchestrator", action: "chat" }, output, ...(picklist ? { picklist } : {}), ...(dataCard ? { dataCard } : {}) };
    }
    if (어느카드) {
      // 전 카드 종류를 한 곳(카드답변)으로 — 대화·라우트가 각자 체인을 들면 새 카드가
      // 한쪽에만 붙는다(QA 결함 1호: 「내문서 확인」이 여기 없어 일반 경로가 답을 지어냈다).
      // mydocs는 사람별 카드 — viewer의 신원으로 그 사람 것만(격리 원칙 그대로).
      const 답 = await 카드답변(어느카드, 지금범위 && 지금범위.kind === "asset" ? 지금범위.id : null,
        String(viewer?.userId ?? "unknown"));
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
      completeTask(task.id);
      if (에디션제한중()) return { task, route: { agentId: "orchestrator", action: "chat" }, output: 카드없는글로(답) };
      return { task, route: { agentId: "orchestrator", action: "chat" }, output: 답.output, dataCard: 답.dataCard };
    }
  }

  // 「내 문서」를 겨냥한 **찾기 질문**인데 내 개인 문서 조각이 한 개도 안 잡히면 LLM에 보내지
  // 않는다(QA 결함 1b, 2026-08-20 사장님 실측: 내 문서 내용을 물었는데 무관한 회사 문서 3건이
  // 근거 배지로 붙고 「수정 중」이라는 상태까지 지어냈다. 0건은 재작성 금지 계열).
  // ⚠ 좁게 잡는다(검토관 2026-08-20 상1·중1 — 넓은 가로채기가 기능을 죽인다):
  //   · (?<![사안]) — 「사내 문서」·「안내 문서」의 꼬리에 「내 문서」가 들어 있다.
  //     screenguide.ts:1088이 같은 함정을 먼저 밟고 막아 둔 자리다.
  //   · 찾기 앵커 필수 — 열기·삭제·공유·저장·사용법은 이 가드의 일이 아니다(각자의 길로).
  if (내문서찾기질문(instructionText)) {
    // 답 경로와 같은 잣대(관련도 컷 있는 graded)로 잰다 — 컷 없는 재검색으로 재면 무관 조각
    // 1건에 가드가 열리고 답 경로는 그 조각을 버려 원래 결함이 재현된다(검토관 중2).
    // 검색 자체가 실패하면(임베딩 서버 다운 등) 가드를 접고 기존 길로 — 장애를 「부재 확정」으로
    // 바꿔 말하지 않는다(검토관 중3 — 폴백=FAIL 원칙).
    const { queryMemoryGraded } = await import("./memory.js");
    const 검색 = await queryMemoryGraded(instructionText, 8, undefined, screen, viewer).catch(() => null);
    if (검색) {
      // 「내 것」 판정은 소유자 대조로 — personal:* 접두사만 보면 남이 공유한 개인 문서로
      // 가드가 열리고 출처는 「내 문서 · …」로 나간다(검토관 중2 — 접두사≠소유).
      const { listPersonalDocs } = await import("./personaldocs.js");
      const 내것 = new Set(listPersonalDocs(String(viewer?.userId ?? "unknown")).map((d) => `personal:${d.id}`));
      if (!검색.scored.some((h) => 내것.has(h.documentId))) {
        const { mydocsStatusAnswer, 카드없는글로 } = await import("./datacard.js");
        const 카드 = await mydocsStatusAnswer(String(viewer?.userId ?? "unknown"));
        const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
        completeTask(task.id);
        const 머리 = [
          "그 내용은 **내 문서에 없습니다** — 회사 문서로 지어내지 않고 그대로 말씀드립니다.",
          "내 문서가 대화에서 검색되려면 그 문서의 **AI 포함**이 켜져 있어야 합니다(내 문서 화면에서 문서별로 켭니다).",
          "",
        ];
        if (에디션제한중()) {
          return { task, route: { agentId: "orchestrator", action: "chat" }, output: [...머리, 카드없는글로(카드)].join("\n"), sources: [] };
        }
        return { task, route: { agentId: "orchestrator", action: "chat" }, output: [...머리, 카드.output].join("\n"), dataCard: 카드.dataCard, sources: [] };
      }
    }
  }

  // 뜻을 알 수 없는 입력("1", ".", "ㅁ")은 LLM에 보내지 않는다 — 헤매다 10초를 쓰고
  // 그게 "오래 걸리는 작업"으로 판정돼 리포트까지 만들어졌다(2026-07-26 실측).
  if (isTooVague(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: vagueAnswer() };
  }

  // 한 낱말만 던진 경우("취약점", "급한거") — 뜻은 분명한데 무엇을 원하는지가 없다.
  // LLM에 보내면 34초를 헤매다 엉뚱한 답을 낸다(2026-08-01 실측). 그 낱말에 맞는 예시로 되묻는다.
  const 낱말 = 한낱말되묻기(instructionText);
  if (낱말) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 낱말 };
  }

  // ★ 제품 지식 즉답 카드(2026-08-08) — 답이 변하지 않는 지식은 코드가 그대로 낸다.
  //   야간 150상황의 마지막 불편 3건(CEF 헤더·학습 확인·지어냄 식별)이 전부 이 부류였다:
  //   14B가 매번 30초씩 옳은 답을 새로 썼다. 카드 기준은 productfaq.ts 머리말.
  const 지식카드 = faqAnswerFor(instructionText);
  if (지식카드) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 지식카드.answer, sources: [] };
  }

  // ★ "내 업무 화면 어디 갔어?" — 없앤 메뉴를 찾는 말(2026-08-01, 메뉴 폐지).
  //   ⚠ 그냥 두면 모델이 **아직 있다고 답한다**(실측: "대시보드에서 항목을 클릭하면 해당
  //   작업 화면으로 이동합니다"). 사내 문서·학습에 옛 화면이 남아 있어 생기는 일이라,
  //   프롬프트로 못 고친다 — 옮겨 간 자리를 코드로 못 박아 답한다.
  //   ⚠ 화면·메뉴·탭을 **반드시 대야** 잡는다(검토 지적). 선택으로 뒀더니 "오늘 할 일 없어?"
  //   같은 흔한 물음까지 이 안내로 샜다 — 목록을 물었는데 메뉴 폐지 공지가 나오는 꼴이다.
  if (내업무화면폐지_RE.test(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return {
      task, route: { agentId: "orchestrator", action: "chat" },
      output: "「내 업무」 화면은 없앴습니다 — **여기 대화창에서 그대로 하시면 됩니다**.\n\n" +
        "· 목록 — \"오늘 할 일\"\n" +
        "· 담기 — \"할 일 추가: ○○\"\n" +
        "· 끝내기 — \"○○ 완료\"\n" +
        "· 순서 — \"○○ 어떻게 해?\" · 단계 체크는 \"1번 했어\"(되돌리기 \"1번 취소\")\n" +
        "· 반복 업무 — \"자주 하는 일 뭐 있어?\"\n\n" +
        "▸ 목록 맨 앞의 **▶ 지금 이거** 한 줄만 보고 시작하셔도 됩니다.",
    };
  }

  // ★ "○○ 어떻게 해?" — **내 할 일 이름을 댄 절차 질문**은 여기서 먼저 집는다(2026-08-01).
  //   목록 답변이 "○○ 어떻게 해?라고 물으면 순서를 알려드립니다"라고 약속하는데, 뒤쪽
  //   결정적 분기들이 이 말을 먼저 채 갔다(실측): "침해사고 대응 어떻게 해?"는 조치 플레이북이,
  //   "10.10.20.41 — 취약점 점검 뭐부터 해?"는 today가 가져가 절차가 영영 안 열렸다.
  //   ⚠ 좁게 잡는다 — **열려 있는 내 할 일과 이름이 겹칠 때만**. 화면 사용법·개념 질문은
  //   그대로 screenguide·explain·플레이북의 몫이다.
  // ★ "○○ 다시 열어줘" — 완료 답변이 **약속하는 말**이라 반드시 이어져야 한다(검토 지적:
  //   도구가 아예 없어 빈말이었다). 결재판을 생략한 근거가 "되돌릴 길을 준다"였다.
  const 되열기 = 되열기_RE.exec(instructionText);
  if (되열기) {
    const tool = findAgentTool("reopen_task");
    if (tool) {
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
      const result = String(await tool.run({ task: 되열기[1].trim() }));
      completeTask(task.id);
      if (!result.includes("못 찾았습니다")) {
        return {
          task, route: { agentId: "orchestrator", action: "chat" }, output: result,
          toolCalls: [{ tool: "reopen_task", args: { task: 되열기[1].trim() }, result }],
        };
      }
      // 내 할 일이 아니면 조용히 다음 분기로 넘긴다("이 취약점 다시 열어줘" 등)
    }
  }

  // ★ "○○ 완료" — 여기서 잡는다(2026-08-01, 검토 후 agentloop에서 옮겨 옴).
  //   agentloop 쪽은 낱말 제외어를 쓰다 실제 업무 이름 대부분을 막았다. 자물쇠는 하나여야 한다.
  const 완료말 = await 내할일완료말(instructionText);
  if (완료말) {
    const tool = findAgentTool("complete_task");
    if (tool) {
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
      const result = String(await tool.run({ task: 완료말 }));
      completeTask(task.id);
      return {
        task, route: { agentId: "orchestrator", action: "chat" }, output: result,
        toolCalls: [{ tool: "complete_task", args: { task: 완료말 }, result }],
      };
    }
  }

  const 절차질문 = await 내할일절차질문(instructionText);
  if (절차질문) {
    const tool = findAgentTool("work_steps");
    if (tool) {
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
      const result = String(await tool.run({ task: 절차질문 }));
      completeTask(task.id);
      return {
        task, route: { agentId: "orchestrator", action: "chat" }, output: result,
        toolCalls: [{ tool: "work_steps", args: { task: 절차질문 }, result }],
      };
    }
  }

  // 대화창 목록에서 **체크해서 고른 건**에 대한 조치 — LLM을 아예 태우지 않는다(2026-07-31).
  // 사람이 눈으로 고른 대상이라 해석할 것이 없다. 7B가 번호를 하나 잘못 읽으면 엉뚱한 취약점이
  // 오탐 처리되므로, 표식을 규칙으로 읽어 결재판까지 곧장 만든다.
  // ⚠ 그래도 **바로 실행하지는 않는다** — 쓰기는 전부 사람 승인을 거친다는 원칙은 그대로다.
  const pick = parsePickCommand(instructionText);
  // 할 일(내 업무)은 결재판을 거치지 않는다 — 자기 할 일에 체크하는 일이라 되돌리기도 쉽다
  // (내 업무 화면에서 다시 누르면 그만이다). 취약점 조치와 무게가 다르다.
  if (pick && pick.kind === "task") {
    const { setTaskDone, getTask } = await import("./tasks.js");
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    // ★ 체크한 것이 **아직 안 담은 AI 제안**일 수 있다(검토 지적 2026-08-01). 목록에는
    //   `today:<원본id>`로 실리는데 tasks에는 없어서, 체크하고 「끝냄으로」를 누르면
    //   "찾지 못했습니다"가 나왔다. 화면을 없앤 지금 체크칸이 유일한 클릭 경로라 그냥 두면
    //   담당자가 끝낸 일을 못 닫는다. complete_task가 하는 것과 같게 — 담고 끝낸다.
    for (const id of pick.ids) {
      if (getTask(id)) continue;
      try {
        const p2 = await buildMyWork();
        const 제안 = [...p2.today, ...p2.week, ...p2.later].find((i) => i.id === id && !i.saved);
        if (제안) createTask({ text: 제안.text, ref: 제안.ref, origin: 제안.origin, dueAt: 제안.dueAt ?? Date.now() });
      } catch { /* 목록을 못 만들면 아래에서 "못 찾음"으로 안내된다 */ }
    }
    const 담긴이름 = new Map(listTasks().filter((t) => !t.done).map((t) => [t.text, t.id]));
    pick.ids = await Promise.all(pick.ids.map(async (id) => {
      if (getTask(id)) return id;
      try {
        const p2 = await buildMyWork();
        const 제안 = [...p2.today, ...p2.week, ...p2.later].find((i) => i.id === id);
        return 제안 && 담긴이름.has(제안.text) ? 담긴이름.get(제안.text)! : id;
      } catch { return id; }
    }));
    const 있음 = pick.ids.filter((id) => getTask(id));
    const 없음 = pick.ids.length - 있음.length;
    let 문장: string;
    if (있음.length === 0) {
      문장 = `고르신 ${pick.ids.length}건이 지금 할 일 목록에 없습니다 — 그 사이에 처리됐거나 목록이 바뀌었을 수 있습니다.`;
    } else {
      for (const id of 있음) setTaskDone(id, true);
      문장 = `${있음.length}건을 끝냄으로 표시했습니다. 되돌리려면 "○○ 다시 열어줘"라고 말씀하세요.`;
    }
    if (없음 > 0) 문장 += ` ⚠ ${없음}건은 찾지 못해 건너뛰었습니다.`;
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 문장 };
  }
  if (pick) {
    const { pickToolName } = await import("./picklist.js");
    const tool = findAgentTool(pickToolName(pick)); // request→create_request_doc, 그 외→bulk_update
    if (tool) {
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
      completeTask(task.id);
      const approval = buildApproval(tool, pickToolArgs(pick), instructionText);
      return {
        task,
        route: { agentId: "orchestrator", action: "chat" },
        output: `고르신 ${pick.ids.length}건에 적용할 내용을 확인해 주세요. 승인하면 그때 반영됩니다.`,
        approval,
      };
    }
  }

  // 보안 업무 밖 질문은 일관되게 거절하고 할 수 있는 것으로 되돌린다(2026-07-26 사용자 결정 ②).
  // 도구·RAG를 타기 전에 걸러야 한다 — 안 그러면 사내 문서에서 아무거나 끌어와 그럴듯하게 답한다.
  if (isOutOfScope(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: outOfScopeAnswer() };
  }

  // "2차 인증 켜줘" 같은 지시 — AI가 대신 하면 안 되는 일이다. 계정·인증·열쇠를 AI가 켜고 끄면
  // 그 AI를 속인 사람도 켜고 끌 수 있다. 대신 **그 화면의 실제 순서**를 결정적으로 안내하고
  // 화면을 같이 열어 준다(2026-07-31 사용자 지시 "설정등은 해당메뉴가서 어떻게 하라고 가이드").
  // ⚠ 화면 안내(isHelpIntent)보다 **먼저** 봐야 한다 — 뒤에 두면 "2차 인증 어떻게 해?"가
  //   지금 보고 있는 화면의 일반 안내로 떨어져 정작 켜는 법을 못 듣는다.
  const howTo = findHowTo(instructionText);
  if (howTo) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output: howToMarkdown(howTo),
      sources: [], // 코드가 낸 순서 안내다(4-ⓑ) — 배지 재검색이 무관한 문서를 붙이지 않게
      ...(howTo.page ? { openScreen: { page: howTo.page, label: howTo.where } } : {}),
    };
  }

  // "내 업무 보여줘 / 오늘 남은 일" — 규칙으로 내 할 일을 내고 그 자리에서 끝낼 수 있게 한다.
  // ⚠ 실측(2026-07-31): 이 질문이 **화면 설명**으로 떨어졌다("항목을 클릭하면 해당 작업
  //   화면으로 이동합니다…"). 담당자는 자기 할 일을 물었는데 사용법을 들었다.
  //   내 업무는 tasks에 그대로 있는 데이터다 — 모델에게 물을 이유가 없다.
  if (isMyWorkAsk(instructionText)) {
    const { buildMyWork } = await import("./mywork.js");
    const { output, picklist } = myWorkAnswer(await buildMyWork());
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output,
      ...(picklist ? { picklist } : {}),
    };
  }

  // "미조치 취약점 뭐 있어?" — 규칙으로 목록을 내고 그 자리에서 고를 수 있게 한다(2026-07-31).
  // LLM 루프에 맡기면 모델이 목록 도구를 고른 날에만 체크칸이 생긴다 — 사용자가 콕 집어 물은
  // 기능이 어떤 날은 되고 어떤 날은 안 되면 없는 것만 못하다.
  // ⚠ 단 **문서를 콕 집은** 질문(「이 취약점 분석평가 가이드에서 …어떤 게 있어?」)은 양보한다 —
  //   문서명의 「취약점」이 이 빠른 길에 걸려 자산 취약점 목록이 나가던 것(2026-08-21 코퍼스 QA 실측).
  //   문서지목질문 TRUE면 문서가 권위다(incidentsteps 장애·침해가 이미 쓰는 같은 패턴). 문서지목=FALSE인
  //   「미조치 취약점 뭐 있어?」·「급한 취약점 몇 건 있어?」는 그대로 이 빠른 길(HIJACK 유지).
  if (isFindingListAsk(instructionText) && !문서지목질문(instructionText)) {
    // 🗂 범위를 **여기에도 넘긴다** — 이 경로는 agentloop를 안 타서 도구 인자 주입이 안 온다
    // (2026-08-18 실측: 범위가 걸렸는데 전체 3,008건이 왔다).
    const { output, picklist, dataCard } = findingListAnswer(
      instructionText,
      지금범위 && 지금범위.kind === "asset" ? 지금범위.id : null
    );
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output,
      ...(picklist ? { picklist } : {}),
      ...(dataCard ? { dataCard } : {}),
    };
  }

  // 검증(하드닝)·자산 현황 — 대화 안 데이터 카드(승인 시안, 2026-08-19 · 2차 확장 같은 날).
  // 결정적 트리거·결정적 숫자. ⚠ 새 카드를 더할 땐 앞 영토(스케줄·목록 도구 등)를 안 삼키는지
  // 음성 시험부터 — 1차 때 전체 게이트가 「점검 스케줄 알려줘」 과포착을 실측으로 잡았다.
  // 🗂 범위 걸기/풀기(기능 가이드 ②) — 「web-01로 범위 걸어줘」·「범위 풀어줘」. 화면 클릭과
  // 같은 일을 대화로 — 신호(scopeSet)만 주고 실행은 클라 콘솔(범위의 주인은 화면 상태 한 곳).
  {
    const { isScopeCommand, scopeCommandAnswer } = await import("./scopecmd.js");
    if (isScopeCommand(instructionText)) {
      const r = scopeCommandAnswer(instructionText, 선택);
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
      completeTask(task.id);
      return { task, route: { agentId: "orchestrator", action: "chat" }, output: r.output, ...(r.scopeSet ? { scopeSet: r.scopeSet } : {}) };
    }
  }

  // 📖 시나리오 실행(기능 가이드 ④ — 프롬프트북) — 대장의 실측 검증 사슬을 제품 안에서.
  {
    const { isScenarioAsk, scenarioAnswer } = await import("./scenarios.js");
    if (isScenarioAsk(instructionText)) {
      const r = scenarioAnswer(instructionText);
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
      completeTask(task.id);
      return { task, route: { agentId: "orchestrator", action: "chat" }, output: r.output, ...(r.nextChips ? { nextChips: r.nextChips } : {}) };
    }
  }

  {
    const { isHardeningStatusAsk, hardeningStatusAnswer, isAssetStatusAsk, assetStatusAnswer, isOpsStatusAsk, opsStatusAnswer, 카드없는글로 } = await import("./datacard.js");
    const 현황답 = isHardeningStatusAsk(instructionText) ? hardeningStatusAnswer()
      // 🗂 범위를 넘긴다(검토관 심각4) — findings 경로에서 이미 고친 「범위가 걸렸는데
      // 전체가 왔다」가 카드에서 재발했었다. 이 분기도 agentloop 앞이라 직접 넘겨야 한다.
      : isAssetStatusAsk(instructionText) ? assetStatusAnswer(지금범위 && 지금범위.kind === "asset" ? 지금범위.id : null)
      : isOpsStatusAsk(instructionText) ? await opsStatusAnswer()
      : null;
    if (현황답) {
      const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
      completeTask(task.id);
      // 라이트(max 인계 60acc4e5) — 카드 미배선·해당 화면 없음이라 「카드로 보였습니다/
      // ○○ 화면에서」가 거짓이 된다. 같은 숫자를 글 표로 접고 카드는 안 싣는다.
      if (에디션제한중()) {
        return { task, route: { agentId: "orchestrator", action: "chat" }, output: 카드없는글로(현황답) };
      }
      return { task, route: { agentId: "orchestrator", action: "chat" }, output: 현황답.output, dataCard: 현황답.dataCard };
    }
  }

  // 「○○은 어디서 해?」 — **우리 화면 이름**으로 자리를 찾아 준다(2026-08-03 실전 147상황).
  //   예전에는 이 말이 RAG로 새어 「설정은 Tenable Security Center의 인터페이스에서…」라고
  //   **남의 제품 매뉴얼**을 32초 걸려 읽어 줬다. 우리 화면을 물었는데 남의 화면을 답한 것이다.
  // ⚠ isHelpIntent보다 **먼저** 본다 — isHelpIntent는 "지금 보고 있는 화면"을 안내하므로,
  //   다른 화면 이름을 대고 물으면 엉뚱한 화면 설명이 나간다.
  const 찾는화면 = 이름으로화면찾기(instructionText);
  if (찾는화면) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      // 🚀 프로 셸이면 「사이드바」 대신 「☰ 전체 메뉴」로 길을 안내한다(2026-08-19).
      //   프로엔 사이드바가 없으므로 그대로 두면 **없는 곳을 가리키는** 안내가 된다.
      output: 화면위치안내(찾는화면.screen, 찾는화면.title, 지금셸 === "pro"),
      sources: [], // 코드가 낸 안내다(4-ⓑ) — 안 실으면 배지 재검색이 무관한 문서를 붙인다
      // ⚠ **여는 주소는 안내 열쇠와 다를 수 있다**(2026-08-22 검토관 [낮음]). 내 문서 한 화면이
      //   여러 갈래(📦 보안제품 자료·📞 연락처·📘 안내)를 품게 되면서, 「보안제품 자료 어디
      //   있어?」에 화면만 열면 **기본 탭(👤 내 것)**이 떠서 물은 것이 안 보인다.
      openScreen: { page: 찾는화면.open ?? 찾는화면.screen, label: 찾는화면.title },
    };
  }

  // ★ "○○ 등록하려면 어떻게 해?" — **방법**을 묻는 말은 그 화면 안내로 답한다(2026-08-10).
  //   실측: 이 말이 등록 **승인창**을 띄웠고, 강제 규칙을 좁히자 이번엔 9.6초짜리 「근거 약함 +
  //   남의 제품 설명 유추」가 나왔다. ⚠ 좁히기만 하면 그 자리가 비고 **빈 자리는 모델이 채운다.**
  //   ⚠ isHelpIntent보다 먼저 본다 — 그건 「지금 보고 있는 화면」을 안내하므로, 다른 화면
  //     이름을 대고 물으면 엉뚱한 화면 설명이 나간다(위 자리 질문과 같은 이유).
  const 방법화면 = 방법질문화면찾기(instructionText);
  // ⚠ 라이트(도구 허용목록 걸림)에는 표준 화면(hardening.html 등)이 없다 — 화면이 전부 lite-*라
  //   이름이 다르다. 표준전용 별칭이 없는 화면을 안내하지 않게 비켜 준다(검토관 2026-08-14).
  //   비키면 이름 대조 실패 → LLM 일반 답으로 떨어진다(원래 동작). 라이트엔 lite-scan이 그 자리다.
  if (방법화면 && !(방법화면.표준전용 && 에디션제한중())) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output: formatScreenGuide(방법화면.screen, instructionText),
      sources: [], // 코드가 낸 안내다(4-ⓑ)
      openScreen: { page: 방법화면.screen, label: 방법화면.title },
    };
  }

  // 도움말/사용법 의도는 화면별 가이드로 결정적으로 답한다(LLM·도구 없이). "이 화면 뭐 할 수 있어?"
  // 같은 질문이 예전엔 일반 대화로 떨어져 화면과 무관한 답을 냈다 — screenguide로 그라운딩한다.
  if (isHelpIntent(instructionText, screen)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    // sources: [] — **코드가 낸 답이라 사내 문서를 본 적이 없다**(4-ⓑ, 2026-08-13).
    //   안 실으면 근거재검색대상인가()가 통과시켜 배지용 재검색이 돌고, 답과 무관한 문서가
    //   「📄 근거」로 붙는다. actioncheck가 이미 쓰는 계약을 그대로 쓴다(빈 배열 = 근거 없음 선언).
    // ⚠ 에디션을 함께 넘긴다(2026-08-18) — 라이트 챗은 screen을 안 보내는데(lite-chat.html),
    //   그러면 개요가 나가고 그 개요가 **표준 콘솔 설명**이라 라이트에 없는 기능을 가르쳤다.
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatScreenGuide(screen, instructionText, 에디션제한중()), sources: [] };
  }

  // 결재 승인 요청 — 대화창이 「승인 완료」를 지어내지 않게 결재판으로 결정적으로 안내한다.
  if (결재승인요청_RE.test(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    const 자기결재 = 자기결재_RE.test(instructionText);
    const 안내 = [
      "결재(승인 대기)는 **오른쪽 결재판**에서 [승인]·[반려] 버튼으로 처리합니다 — 대화창은 결재를 대신 승인하지 않습니다(무엇이 얼마나 바뀌는지 보고 사람이 누릅니다).",
      자기결재
        ? "⚠ **본인이 올린 결재는 다른 담당자가 검토·승인합니다** — 본인은 승인 대상이 아닙니다(자기 결재 자기 승인 금지). 이는 감사·규정 준수를 위한 통제입니다."
        : "⚠ 결재는 올린 사람이 아닌 **다른 담당자**가 검토·승인합니다(자기 결재 자기 승인 금지).",
    ].join("\n\n");
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 안내, sources: [] };
  }

  // "지식베이스 정리/중복 점검" — 상충·중복·신선도를 결정적으로 점검(삭제 없이 리포트).
  // ⚠ **여기서 다시 훑지 않는다**(2026-09-04 실측 수리). 예전에는 물을 때마다 scanKbHygiene()을 새로
  //   돌려 답 하나가 **3.1초**였다 — 같은 리포트를 그냥 주는 화면 창구(GET /api/kb-hygiene)는 0.0초인데.
  //   내역: 지식 전수 조회 0.70초 + 조각 IN-목록 0.48초 + 데모경합 규칙이 데모 문서 2건마다 도는
  //   하이브리드 검색(재작성 LLM + 임베딩 + 벡터검색) 1.8초. 위생 점검은 **주 1회 배치**라 물을 때마다
  //   다시 셀 값이 아니고, 답은 `점검시각문구`로 **언제 잰 값인지 밝힌다**. 만료됐을 때만 kbHygieneReport가 훑는다.
  if (KB_HYGIENE_INTENT_RE.test(instructionText)) {
    const { kbHygieneReport, formatKbHygiene } = await import("./kbhygiene.js");
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatKbHygiene(await kbHygieneReport()), sources: [] };
  }

  // "공격 경로 / 도달성 분석" — 3소스 상관으로 진입→거점→인접 경로를 결정적으로 구성.
  if (ATTACK_PATH_INTENT_RE.test(instructionText)) {
    const { formatAttackPaths } = await import("./analysishub.js");
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
    completeTask(task.id);
    // nextChips — 「취약점 이해」 4걸음(배정) 사슬(검토관 B중1: 3걸음의 답이 4걸음을 이어 줘야
    // 「그다음은 각 답이 이어 줍니다」 약속이 성립한다). 문구는 시나리오 걸음과 글자 동일.
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatAttackPaths(), sources: [], nextChips: ["이거 담당자 배정해줘", "미조치 취약점 뭐 있어?"] };
  }

  // "Shadow AI 점검해줘 / 미등록 AI 있어?" — 시스템 관측 신호로 미등록 모델을 결정적으로 찾는다.
  if (SHADOW_AI_INTENT_RE.test(instructionText)) {
    const { formatShadowAi } = await import("./shadowai.js");
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatShadowAi(), sources: [] };
  }

  // "이 취약점 조치 방법 알려줘" — 결정적 조치 플레이북으로 답한다(LLM 없이). 단계·담당·SLA를
  // 규칙으로 제공해 MTTR을 줄인다. 실행 지시("조치해줘")가 아니라 방법 문의일 때만.
  //
  // ★ 2026-08-10: **장애 질문을 삼키지 않는다.** 「방화벽 장비가 갑자기 죽었어. 어떻게 대응해?」가
  //   `어떻게 대응`에 걸려 여기서 채였고, 담당자는 장애 상황에 **「일반 취약점 조치, 30일 내」**
  //   표를 받았다. 어제 만든 장애 초동 절차(아래 1150줄대)는 되묻기 관문 뒤에 있어 닿지 못했다.
  //   ⚠ 「기능을 만들었다」와 「그 기능에 말이 닿는다」는 다르다 — 앞 분기가 먼저 채 가면 없는 것과 같다.
  //   ⚠ 순서를 바꾸지 않고 **여기서 비켜 준다** — 장애 분기를 위로 올리면 되묻기 관문(대상 없는
  //     대명사)이 뚫린다. 배제가 이동보다 안전하다.
  //   ⚠ 취약점·패치 물음은 incidentsteps의 「장애아님」이 이미 막으므로 플레이북 영토는 그대로다.
  //
  // ★★ 2026-08-12: **배제를 네 번째로 덧대지 않고 방향을 뒤집었다.**
  //   위 세 겹(장애·침해사고·실행지시)은 전부 「이런 말이면 빼 준다」는 낱말 목록이다.
  //   그런데 담당자는 라벨이 아니라 **증상**으로 묻는다 — "445 급증"·"로그가 안 쌓이는데"는
  //   어느 목록에도 없다. 실측(win·max 양쪽): "직원이 퇴사하는데 어떻게 대응해?"에도
  //   「일반 취약점 조치 30일 내」 표가 나갔다. 목록을 늘리는 한 다음 표현이 또 샌다.
  //   그래서 `플레이북영토인가`로 **답할 근거가 있을 때만** 답하게 했다(playbook.ts 참고).
  // ★ 실행지시 배제도 좁혔다 — `/조치해/`가 "조치**해야 해?**"라는 **질문**까지 밀어내
  //   정작 플레이북이 맞는 물음이 8초 LLM으로 샜다. 명령형일 때만 비켜 준다.
  if (
    REMEDIATION_INTENT_RE.test(instructionText) &&
    !장애질문인가(instructionText) &&
    !침해사고질문인가(instructionText) &&
    // ⚠ 문서를 콕 집은 질문(「이 조치 가이드에서 Log4j 조치 방법 있어?」)은 그 문서가 권위 — 플레이북에
    //   양보한다(설계관 지적 제3 자리, 문서지목 우선 원리 일관 적용). 장애·침해질문인가는 내부에 이미
    //   문서지목 배제가 있으나 REMEDIATION 자체엔 없어, 장애·침해가 아닌 doc-pinned 조치질문이 샜다.
    //   AND 조건이라 순서 무관 — 소스감시가 REMEDIATION_INTENT_RE && !장애질문인가 인접을 요구해 뒤에 둔다.
    !문서지목질문(instructionText) &&
    !조치실행지시_RE.test(instructionText) &&
    // ⚠ 앞의 값싼 검사를 전부 통과했을 때만 부른다(동적 import — 이 파일의 기존 방식).
    (await import("./playbook.js")).플레이북영토인가(instructionText)
  ) {
    const { formatRemediation } = await import("./playbook.js");
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    const kev = /kev|실제.?악용|악용 중/i.test(instructionText);
    const sev = /critical|치명/i.test(instructionText) ? "critical" : /high|높은/i.test(instructionText) ? "high" : "medium";
    return {
      task,
      route: { agentId: "orchestrator", action: "chat" },
      output: formatRemediation({ findingType: instructionText, severity: sev as "critical" | "high" | "medium", kev }),
      // sources: [] — 코드가 낸 플레이북이다(4-ⓑ). 실측: KEV 질문에 이 표가 나가면서
      //   kev_bod_22-01_조치기한.md · GIJO_AS_제품소개.md가 「근거」로 붙었다.
      sources: [],
    };
  }

  // 학습 루프 실행 지시는 확인 절차로 우회 — 파이프라인을 타지 않는다.
  if (LEARN_TOPIC_RE.test(instructionText) && LEARN_RUN_RE.test(instructionText)) {
    return learnloopConfirmResult(instructionText, qa);
  }

  // 복합 지시(2단계 이상)면 오케스트레이션으로 순차 실행한다.
  const steps = planInstruction(instructionText);
  if (steps.length >= 2) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P1" });
    setAgentStatus("orchestrator", "working");
    collab(qa, { from: "orchestrator", to: "orchestrator", message: `복합 지시 ${steps.length}단계 실행: ${steps.map((s) => s.label).join(" → ")}` });
    const stepResults = await runOrchestration(instructionText, steps, task, qa);
    resetAgentToDefault("orchestrator");
    const updated = completeTask(task.id);
    const completedTask = updated.find((t) => t.id === task.id) ?? task;
    const output = stepResults.map((r, i) => `【${i + 1}. ${r.label}】 ${r.output}`).join("\n\n");
    return { task: completedTask, route: { agentId: "orchestrator", action: "chat" }, output, steps: stepResults };
  }

  // ── 행동 대조 (2026-07-29, 계획서 전-2) — "이거 해도 돼?"는 검색이 아니라 판정 질문이다 ──
  // 사내규정(RAG)으로만 판정하고, 법령은 원문 링크로 안내, 근거 없으면 판정하지 않는다(NA 계약).
  //
  // ★ **지금 사고가 나 있으면 비켜 준다**(2026-08-22 운영 실측으로 신설).
  //   실측: 「랜섬웨어 걸렸을 때 전원을 **꺼도 되나요?**」가 이 분기에 먼저 채여
  //   「판단 불가 — 사내 규정 문서를 못 찾았습니다」가 나갔다. 그런데 **정답은 코드에 있었다**
  //   (침해사고초동절차의 「전원을 끄지 말고 선을 뽑습니다」). 게다가 그 답변은 참고 자료 칸에
  //   그 문장을 **인용해 놓고** 「판정 근거로 쓰지 않았습니다」라고 적었다 —
  //   **정답을 쥐고도 모른다고 답한 것**이고, 불난 집에서는 가장 나쁜 답이다.
  //   ⚠ 규정 대조는 **평시의 일**이다. 사고 중에는 「해도 되나」도 절차를 묻는 말이다.
  //   ⚠ 아래 장애·침해 분기와 **같은 말을 쓴다** — 잣대를 두 벌 두지 않는다.
  //     (`incidentsteps.route.test.ts`가 이 배제 조건이 소스에 있는지 감시한다.)
  if (
    ACTION_CHECK_RE.test(instructionText) &&
    !침해사고질문인가(instructionText) &&
    !장애질문인가(instructionText)
  ) {
    const task = mkTask(qa, { text: instructionText, agentId: "analysis", priority: "P2" });
    const r = await runActionCheck(instructionText, qa);
    completeTask(task.id);
    return {
      task,
      route: { agentId: "analysis", action: "chat" },
      output: r.output,
      sources: r.sources,
      dataHits: r.sources.length,
    };
  }

  // 가리킬 것이 없는 대명사 — "그거 어떻게 해"에 **모델이 27초를 쓰고** 되물었다
  //   (2026-08-03 실전 147상황). 되묻는 것은 맞는 답이고, 틀린 것은 27초다.
  //   맥락이 없는데 아무거나 골라 답하면 엉뚱한 자산을 손대게 되므로 되묻는 것이 옳다 —
  //   다만 되묻는 데 모델이 필요할 리 없다. ⚠ 직전 대상이 있으면 여기 안 걸린다(#8 맥락이 이어받음).
  // ★ 2026-08-04 재측정: 직전 대상이 **있을 때**가 오히려 나빴다. 되묻기 경로를 비켜 가
  //   모델로 넘어갔고, 모델은 25초를 쓰고 **똑같이 되물었다**(23자, 더 불친절하게).
  //   대명사뿐인 말에 모델이 필요할 리 없다 — 대상이 있으면 짚어 확인받고, 없으면 되묻는다.
  // ★ 2026-08-07 검토관 발견(치명): 「이 서버 어떤 서비스 돌고 있어?」용 판정
  //   (가리킨자산이없나)을 만들어 놓고 **여기 관문에 배선하지 않아** 한 번도 실행되지 않았다.
  //   47초·엉뚱한 답을 낸 그 경로가 그대로였다. 대명사뿐인 말과 대상 안 밝힌 자산 질문은
  //   같은 병(대상 불명)이라 같은 관문에서 잡는다.
  // ★ 화면에서 항목을 골라 둔 상태(선택)면 「이거」의 대상이 있다 — 되묻지 않는다(2026-08-09 2단계).
  //   선택은 아래에서 contextText 앞머리에 실려 도구·모델이 그걸 가리키게 된다.
  // 📖 「이거 쉽게 설명해줘」 칩(취약점 이해 2걸음)은 기능어를 빼면 「쉽게설명」 4자가 남아 이
  //   관문을 비켜 갔다(검토관 B중2) — 선택 없이 오면 LLM 재량으로 흘러 일반론이 나온다.
  //   대명사류로 잡는다: 직전 대상이 있으면 짚어 확인받고, 없으면 되묻는 기존 흐름 그대로.
  //   ⚠ 아래 관문의 앞머리(!선택 && (대명사뿐인가…)는 소스 감시 시험 2곳이 지키는 원형이다 —
  //     새 조건은 뒤에 붙인다(assetanaphora·ops147-regress가 배선 자체를 검증한다).
  const 설명칩인데대상없음 = 설명칩_RE.test(instructionText.trim());
  if (!선택 && (대명사뿐인가(instructionText) || 가리킬것없는대명사(instructionText, 대화열쇠) || 설명칩인데대상없음)) {
    const 확인 = 대명사확인(대화열쇠);
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    // 자산을 가리킨 말(「이 서버」)에는 자산용 되묻기 — 「그거」라 답하면 어색하다(실측).
    const 물음 = 가리킨자산이없나(instructionText) ? 자산되물음() : 되물음();
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 확인 ?? 물음 };
  }

  // ★ 장비 장애·중단 — 결정적 초동 절차로 즉답한다(2026-08-09, 계획서 전-4).
  //   실측: 「방화벽 장비가 갑자기 죽었어」에 도구가 하나도 안 돌고 모델이 8~13초 동안
  //   일반론을 썼다(사내 근거 0 → 「근거 약함」 배너). 지식 저장소를 뒤져도 장애 자료가 없고
  //   무관한 문서(Tenable·악성코드 분석)만 걸렸다 — 제품은 정직했지만 담당자는 급할 때
  //   출처 없는 글을 10초 기다려 받았다. 급한 절차는 코드가 즉답한다(logguide와 같은 원칙).
  //   ⚠ 되묻기 관문 **뒤**에 둔다 — 대상 없는 대명사는 먼저 되물어야 한다.
  if (장애질문인가(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P1" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 장애초동절차(instructionText), sources: [] };
  }

  // ★ 침해사고 의심 — 결정적 초동 절차로 즉답한다(2026-08-10, 계획서 전-4).
  //   실측: 「침해사고 의심될 때 대응 절차 알려줘」에 **「일반 취약점 조치 · 30일 내」** 표가 나왔다.
  //   침해는 지금 벌어지는 일인데 30일짜리 패치 일정표를 받은 것이다. 장애와 갈라 둔다 —
  //   장애는 복구가 먼저지만 **침해는 증거 보전이 복구보다 먼저**라 순서가 반대다.
  if (침해사고질문인가(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P1" });
    completeTask(task.id);
    // sources: [] — 코드가 낸 절차 답이다(4-ⓑ). 실측(2026-08-13): 「랜섬웨어 대응 5단계」에
    //   0.7초 만에 이 템플릿이 나갔는데 배지엔 랜섬웨어_초동_대응.md · GIJO_AS_용어사전.md ·
    //   **GIJO_AS_제품소개.md**가 붙었다 — AI가 불려나가지도 않았는데 「근거」가 셋이었다.
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: 침해사고초동절차(instructionText), sources: [] };
  }

  // ── 시연 실측이 잡은 라우팅 결함 2건의 결정적 분기 (2026-07-29, 계획서 전-1) ──────────
  // ① "방화벽 반려 사유는 주로 뭐였어?" — 사내 반려 이력이 있는데 LLM 일반론으로 답했다.
  //    반려 데이터는 두 곳(취약점 검토·유지보수 점검)에 실재하므로 코드가 직접 센다.
  if (REJECT_HISTORY_RE.test(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P3" });
    completeTask(task.id);
    return { task, route: { agentId: "orchestrator", action: "chat" }, output: formatRejectHistory(instructionText) };
  }
  // ② "주간 보안 리포트 작성해줘" — 생성이 아니라 스케줄 조회 도구로 샜다(루프가 먼저 먹음).
  //    생성 의도는 루프보다 먼저 잡아 실제 파일을 만든다. 대상이 불명확하면 기존 되물음.
  if (REPORT_CREATE_RE.test(instructionText) && !REPORT_QUERY_EXCLUDE_RE.test(instructionText)) {
    const task = mkTask(qa, { text: instructionText, agentId: "report", priority: "P2" });
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
      qa,
    });
    completeTask(task.id);
    return {
      task,
      route: { agentId: "report", action: "report" },
      output: `${r.executiveSummary}\n\n(리포트 파일 생성됨: ${r.filePath} — 리포트 화면에서 열람·다운로드할 수 있습니다)`,
    };
  }

  // ★ 선택 치환(2026-08-09 2단계 e2e가 잡은 결함): 선택맥락은 contextText에 실리지만
  //   **강제 분기(forcedToolFor)는 지시문만 본다** — 「이 자산 취약점 몇 건이야?」가 선택을
  //   무시하고 전역 집계(finding_status)로 갔다. 대명사 자리에 고른 항목을 박은 실행문을
  //   루프에 준다 — 규칙·모델·도구 인자가 전부 구체적 대상을 보게 된다.
  //   기록(task·감사)은 담당자가 친 원문 그대로 남긴다.
  // ★ 2026-08-09 ③: 화면에서 고른 것이 없어도 **이 대화에서 방금 다룬 자산**이 있으면 그것으로
  //   치환한다. 되묻기 관문은 직전 대상이 있으면 「맥락으로 풀린다」며 이미 비켜 주는데, 정작
  //   그 대상을 쓰는 곳이 없어 「그 서버 취약점 몇 건?」이 전역 4,828건을 답했다 —
  //   관문이 맥락이 있다고 판단했으면 그 맥락을 실제로 써야 말과 행동이 맞는다.
  //   ⚠ 다만 **추측한 티를 낸다**(아래 해석 한 줄) — 화면 클릭(선택)은 담당자가 고른 것이지만
  //     직전 대상은 우리가 이어 붙인 것이라, 틀렸을 때 담당자가 그 자리에서 알아야 한다.
  const 직전 = 선택 ? null : 직전대상자산(대화열쇠);
  const 맥락대상 = 선택 ?? (직전 ? `자산 ${자산표시이름(직전.assetId)}` : undefined);
  const 실행문 = 맥락대상 ? 선택을박는다(instructionText, 맥락대상) : instructionText;
  // 직전 대상으로 이어 붙였고 실제로 말이 바뀌었을 때만 표기한다(안 바뀌었으면 알릴 것이 없다).
  const 이어붙인대상 = !선택 && 실행문 !== instructionText ? 자산표시이름(직전!.assetId) : undefined;

  // 에이전트 루프를 intent 분류보다 **먼저** 시도한다. 등록된 도구로 답할 수 있으면 그것으로 끝낸다.
  // 순서가 중요하다(2026-07-17 실측): 예전엔 4분류 intent(scan/analyze/report/chat)가 앞을 막아
  // "지금 급한 취약점 상위 3건만 알려줘"가 analyze로 분류돼 루프에 도달하지 못했다. 그 4분류는
  // 화면 메뉴를 미러링한 레거시 축이라, 의도 축 도구셋(search·explain·today)의 앞을 막으면 안 된다.
  // 루프가 처리 못 하면(null) 아래 기존 경로로 그대로 폴백하므로 스캔·리포트 동작은 보존된다.
  // 화면에서 온 업무 영역으로 도구 후보를 좁힌다 — 도구가 늘어도 프롬프트가 커지지 않게 하는 장치.
  // 화면을 모르거나 전역 화면(대시보드)이면 undefined라 종전대로 전체가 후보가 된다.
  const loop = await runAgentLoop(실행문, contextText, {
    domains: toolDomainsForScreen(screen),
    // 권한을 실어 admin 전용 도구(지식 번들 반입 등)가 대화창에서 라우팅되게 한다.
    //   없으면 forcedToolFor의 available에서 빠져 조용히 다른 도구로 샌다(E2E가 잡은 결함).
    role: viewer?.role ?? undefined,
    qa,
    actor,
    대화: 대화열쇠,
    // 🗂 범위가 걸려 있으면 도구 인자에 **코드로** 입힌다(2026-08-18). 자산 종류만 다룬다 —
    // 다른 종류(팀·태그)가 생기면 그때 갈래를 늘린다. 모르는 종류를 자산처럼 쓰면 엉뚱한 걸 건다.
    ...(지금범위 && 지금범위.kind === "asset" ? { 범위자산: 지금범위.id } : {}),
  }).catch(() => null);
  if (loop) {
    const loopTask = mkTask(qa, { text: instructionText, agentId: "orchestrator", priority: "P2" });
    setAgentStatus("orchestrator", "working");
    collab(qa, { from: "orchestrator", to: "orchestrator", message: `지시 처리: "${instructionText}"` });
    // 완료 이벤트는 실제 답변을 실어 나른다 — 120자로 자르면 지휘 콘솔 대화가 목록 중간에서 끊긴다
    // (2026-07-20 사용자 지적). 화면 쪽이 4줄 클램프+더보기로 접으므로 여기선 넉넉히 보낸다.
    collab(qa, { from: "orchestrator", to: "orchestrator", message: `완료: ${collabNote(loop.output)}` });
    resetAgentToDefault("orchestrator");
    const updated = completeTask(loopTask.id);
    return {
      task: updated.find((t) => t.id === loopTask.id) ?? loopTask,
      route: { agentId: "orchestrator", action: "chat" },
      output: loop.output,
      toolCalls: loop.toolCalls,
      ...(이어붙인대상 ? { 이어붙인대상 } : {}),
      ...(loop.approval ? { approval: loop.approval } : {}),
      ...picksFor(loop.output, loop.toolCalls, loop.approval),
    };
  }

  // 화면 컨텍스트를 함께 넘긴다 — 동사 없는 지시("정리해줘")를 화면으로 해석하기 위함(screencontext.ts).
  const route = await routeIntent(instructionText, screen);
  const agent = getAgentById(route.agentId);

  const task = mkTask(qa, { text: instructionText, agentId: route.agentId, priority: priorityForAction(route.action) });

  setAgentStatus(route.agentId, "working");
  collab(qa, { from: "orchestrator", to: route.agentId, message: `작업 할당: "${instructionText}"` });

  let output: string;
  let toolCalls: AgentToolCall[] | undefined;
  let approval: PendingApproval | undefined;
  try {
    const result = await executeRoutedAction(route, instructionText, contextText, screen, qa, noLearn, viewer);
    output = result.output;
    toolCalls = result.toolCalls;
    approval = result.approval;
    // 「보고 있던 목록」을 결재판에 싣는다(2026-08-18 배관) — **규칙으로** 넣는다. 모델에게
    //   "화면에 뭐가 있었지?"를 묻지 않는다(7B가 id를 하나 잘못 읽으면 엉뚱한 게 바뀐다).
    // ⚠ 결재판 **칸에** 넣어야 한다. 승인 버튼은 화면에 보이는 칸만 모아 되돌리므로
    //   (console.js collect), 칸 밖에 둔 값은 승인하는 순간 조용히 사라진다.
    // ⚠ 이미 값이 있으면 덮지 않는다 — 사람이 고쳐 둔 것을 화면이 되돌리면 안 된다.
    // ⚠ 글자에서 다시 찾지 않는다 — 표식은 함수 맨 앞에서 이미 떼어 냈다(위 「보던목록」).
    if (approval && 보던목록) {
      const 칸 = approval.fields.find((f) => f.key === "viewIds");
      if (칸 && !칸.value) {
        칸.value = 보던목록;
        칸.source = "auto";
      }
    }
    if (result.findings) {
      updateTaskPriority(task.id, priorityForFindings(result.findings));
    }
  } catch (err) {
    // FAIL_MARKS-예외: 도구 실행이 실제로 예외를 던진 진짜 실패다(정직한 「없다」 답이 아니다).
    //   서랍 점검이 이걸 실패로 세는 것이 맞다 — 그게 이 문구가 FAIL_MARKS에 있는 이유다.
    output = `실행 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  collab(qa, { from: route.agentId, to: "orchestrator", message: `작업 완료: ${collabNote(output)}` });
  resetAgentToDefault(route.agentId);
  const updatedTasks = completeTask(task.id);
  const completedTask = updatedTasks.find((t) => t.id === task.id) ?? task;

  return {
    task: completedTask,
    route,
    output,
    ...(toolCalls ? { toolCalls } : {}),
    ...(approval ? { approval } : {}),
    ...picksFor(output, toolCalls, approval),
  };
}

// ══ 「이 말을 치면 어디로 갑니까?」 — 설명이 제품과 갈리지 않게 하는 단 하나의 창구 ══════
//
// ★★ 왜 생겼나 (2026-09-04 실측)
//   `tools/route-explain.mjs`가 FORCED_INTENTS와 routes.ts 표만 읽고 **위 체인의 결정적
//   판별자들(picklist·datacard·incidentsteps·screenguide…)을 몰랐다.** 그래서
//     · 「미조치 취약점 뭐 있어?」  → 설명은 「search로 갑니다」   / 실제는 isFindingListAsk(목록+체크칸)
//     · 「취약점 알려주세여」        → 설명은 「걸리는 규칙 없음」   / 실제는 isFindingListAsk
//     · 「방화벽이 멈췄어」          → 설명은 「걸리는 규칙 없음」   / 실제는 장애초동절차
//   라고 **틀리게 답했다.** 설명 도구의 도착지가 제품과 다르면 겹침 경보·문서가 통째로 거짓이
//   된다 — 2026-08-10 「거짓 겹침 경보」와 같은 부류다(그때는 거짓 경보가 진짜 겹침을 묻었다).
//
// ★ 그래서 규칙은 하나다 — **판정은 제품 함수가 한다.** 여기서 정규식을 베껴 적지 않는다
//   (helpers/routing.ts 머리글이 같은 사고로 이미 세워 둔 계약이다: 제품을 흉내 내면 어긋난다).
//
// ⚠ 그래도 **이 함수는 위 체인의 사본이다** — 순서가 어긋날 수 있다. 그것을 사람 기억에
//   맡기지 않는다: 각 단계의 `감시` 칸에 dispatchInstructionCore를 여는 **코드 글자 그대로**를
//   적어 두고, `routeexplain.route.test.ts`가 그 글자들이 **본문에 이 순서대로** 있는지 잰다.
//   갈래를 옮기거나 판별자를 갈면 그 시험이 먼저 깨진다.
// ⚠ 층 이름은 routes.ts의 낱말을 쓰되 **번호(routes.層)는 순서가 아니다** — 실제 순서는
//   여기 차례가 전부다(routes.ts는 화면안내를 30, 체크선택을 40으로 적었지만 코드에서는
//   체크선택이 먼저다).
export interface 도착단계 {
  /** 체인에서 몇 번째로 보는가 — 작을수록 먼저 본다(같은 말에 여럿 걸리면 앞의 것이 이긴다) */
  차례: number;
  이름: string;
  층: string;
  /** 코드에 있는 판별자 이름 */
  판별: string;
  /** 어디로 보내는가 */
  도착: string;
  /** 글자로는 걸렸지만 **최종 도착은 데이터에 달렸다**(내 할 일 이름·내 문서 조각과 겹칠 때만) */
  조건부?: true;
  /** dispatchInstructionCore에서 이 갈래를 여는 코드 그대로 — 순서 감시가 이 글자를 찾는다 */
  감시: string;
}

/**
 * 이 말이 **결정적 체인의 어디에 걸리는가** — 걸린 것을 전부, 실제 호출 순서대로 돌려준다.
 * 첫 번째가 이긴다. 빈 배열이면 ⑨ 모델 선택(LLM이 도구를 고른다).
 *
 * ⚠ 데이터가 있어야 갈리는 갈래(내 할 일 이름·내 문서 조각)는 **글자 조건만** 재고
 *   `조건부: true`로 표시한다 — 「간다」고 단정하지 않는다(없는 확신을 주지 않는다).
 */
export async function 결정적도착지(
  말: string,
  옵션?: { 화면?: string; 역할?: string; 대화?: string; 선택?: string },
): Promise<도착단계[]> {
  return (await 체인훑기(말, 옵션)).filter((s) => s.걸림).map(({ 걸림: _걸림, ...s }) => s);
}

/**
 * 체인에 있는 **전 단계**를 순서대로 — 「규칙표」를 보여 줄 때 쓴다(판정 아님).
 * ⚠ 표를 따로 적지 않는다 — 위 판정과 **같은 목록**을 그대로 낸다(두 벌이면 어긋난다).
 */
export async function 결정적체인(): Promise<도착단계[]> {
  return (await 체인훑기("", undefined)).map(({ 걸림: _걸림, ...s }) => s);
}

async function 체인훑기(
  말: string,
  옵션?: { 화면?: string; 역할?: string; 대화?: string; 선택?: string },
): Promise<(도착단계 & { 걸림: boolean })[]> {
  // ── 표식 떼기 — 체인 맨 앞에서 하는 그대로(안 떼면 글자 수를 세는 판정이 오염된다) ──
  let t = 말;
  if (parseViewIds(t)) t = stripViewMark(t);
  if (parseScopeMark(t)) t = stripScopeMark(t);
  if (parseShellMark(t)) t = stripShellMark(t);

  const 전체: (도착단계 & { 걸림: boolean })[] = [];
  let 자리 = 0;
  const 본다 = (걸렸나: boolean, 단계: Omit<도착단계, "차례">) => {
    전체.push({ 차례: 자리++, ...단계, 걸림: 걸렸나 });
  };

  // ① 가드레일 — 신호를 쏘지 않는 본문(gateUserInputInner)으로 잰다(gateway.ts 머리글).
  const g = gateUserInputInner(t, "dispatch");
  t = g.text; // 개인정보 가림 반영본으로 갈아탄다 — 아래 판정은 전부 이 글자를 본다
  본다(!g.allowed, { 이름: "해로운 요청 차단", 층: "가드레일", 판별: "gateUserInput", 도착: "차단 문구 + 방어 쪽 대안", 감시: "const guard = gateUserInput(instructionText" });

  // ② 화면 이름 → 그 화면의 현황 카드
  const dc = await import("./datacard.js");
  const 어느카드 = dc.screenNameCard(t);
  본다(!!어느카드, {
    이름: "화면 이름 카드", 층: "특수경로", 판별: "screenNameCard",
    도착: 어느카드 === "finding" ? "findingListAnswer(목록+체크칸)" : 어느카드 ? `카드답변(${어느카드})` : "그 화면의 현황 카드",
    감시: "const 어느카드 = screenNameCard(instructionText)",
  });

  // ③ 「내 문서」 겨냥 찾기 질문 — 내 조각이 0건일 때만 가로챈다(데이터에 달렸다)
  본다(내문서찾기질문(t), { 이름: "내 문서 0건 가드", 층: "특수경로", 판별: "내문서찾기질문", 도착: "mydocsStatusAnswer(없다고 정직하게)", 조건부: true, 감시: "if (내문서찾기질문(instructionText))" });

  본다(isTooVague(t), { 이름: "뜻 모를 입력", 층: "되묻기", 판별: "isTooVague", 도착: "vagueAnswer", 감시: "if (isTooVague(instructionText))" });
  본다(!!한낱말되묻기(t), { 이름: "한 낱말만", 층: "되묻기", 판별: "한낱말되묻기", 도착: "낱말별 되묻기", 감시: "const 낱말 = 한낱말되묻기(instructionText)" });
  본다(!!faqAnswerFor(t), { 이름: "제품 지식 즉답", 층: "특수경로", 판별: "faqAnswerFor", 도착: "productfaq 카드", 감시: "const 지식카드 = faqAnswerFor(instructionText)" });
  본다(내업무화면폐지_RE.test(t), { 이름: "없앤 내 업무 화면", 층: "특수경로", 판별: "내업무화면폐지_RE", 도착: "폐지 안내(대화창에서 하세요)", 감시: "if (내업무화면폐지_RE.test(instructionText))" });

  // ⑧~⑩ 내 업무 — **열려 있는 내 할 일과 이름이 겹칠 때만** 채 간다.
  // ⚠ 제품 함수를 그대로 부른다(정규식을 지어내지 않는다). 다만 답은 **지금 이 프로세스의
  //   할 일 목록**에 달렸다 — 설명 도구는 빈 DB로 도니 「안 걸림」으로 보인다. 그래서 걸리든
  //   말든 `조건부`로 표시해, 사람이 「여긴 데이터에 따라 달라진다」를 알고 보게 한다.
  본다(!!되열기_RE.exec(t), { 이름: "내 할 일 다시 열기", 층: "내업무", 판별: "되열기_RE", 도착: "reopen_task", 조건부: true, 감시: "const 되열기 = 되열기_RE.exec(instructionText)" });
  본다(!!(await 내할일완료말(t)), { 이름: "내 할 일 완료", 층: "내업무", 판별: "내할일완료말", 도착: "complete_task", 조건부: true, 감시: "const 완료말 = await 내할일완료말(instructionText)" });
  본다(!!(await 내할일절차질문(t)), { 이름: "내 할 일 절차", 층: "내업무", 판별: "내할일절차질문", 도착: "work_steps", 조건부: true, 감시: "const 절차질문 = await 내할일절차질문(instructionText)" });

  const pick = parsePickCommand(t);
  본다(!!pick, { 이름: "목록에서 고른 건", 층: "체크선택", 판별: "parsePickCommand", 도착: pick?.kind === "task" ? "할 일 끝냄(결재판 없음)" : "결재판 직행", 감시: "const pick = parsePickCommand(instructionText)" }); // pick.kind=task면 결재판을 안 거친다

  본다(isOutOfScope(t), { 이름: "보안 업무 밖", 층: "특수경로", 판별: "isOutOfScope", 도착: "outOfScopeAnswer", 감시: "if (isOutOfScope(instructionText))" });
  본다(!!findHowTo(t), { 이름: "설정 켜는 법", 층: "특수경로", 판별: "findHowTo", 도착: "howto 순서 안내 + 화면 열기", 감시: "const howTo = findHowTo(instructionText)" });
  본다(isMyWorkAsk(t), { 이름: "내 업무 조회", 층: "특수경로", 판별: "isMyWorkAsk", 도착: "myWorkAnswer(목록+체크칸)", 감시: "if (isMyWorkAsk(instructionText))" });
  본다(isFindingListAsk(t) && !문서지목질문(t), { 이름: "취약점 목록 고르기", 층: "특수경로", 판별: "isFindingListAsk", 도착: "findingListAnswer(목록+체크칸)", 감시: "if (isFindingListAsk(instructionText) && !문서지목질문(instructionText))" });

  const sc = await import("./scopecmd.js");
  본다(sc.isScopeCommand(t), { 이름: "범위 걸기·풀기", 층: "특수경로", 판별: "isScopeCommand", 도착: "scopeCommandAnswer(scopeSet)", 감시: "if (isScopeCommand(instructionText))" });
  const sn = await import("./scenarios.js");
  본다(sn.isScenarioAsk(t), { 이름: "시나리오 실행", 층: "특수경로", 판별: "isScenarioAsk", 도착: "scenarioAnswer(프롬프트북)", 감시: "if (isScenarioAsk(instructionText))" });

  본다(dc.isHardeningStatusAsk(t), { 이름: "검증(하드닝) 현황", 층: "특수경로", 판별: "isHardeningStatusAsk", 도착: "hardeningStatusAnswer(카드)", 감시: "isHardeningStatusAsk(instructionText) ? hardeningStatusAnswer()" });
  본다(!dc.isHardeningStatusAsk(t) && dc.isAssetStatusAsk(t), { 이름: "자산 현황", 층: "특수경로", 판별: "isAssetStatusAsk", 도착: "assetStatusAnswer(카드)", 감시: ": isAssetStatusAsk(instructionText) ? assetStatusAnswer(" });
  본다(!dc.isHardeningStatusAsk(t) && !dc.isAssetStatusAsk(t) && dc.isOpsStatusAsk(t), { 이름: "통합 관제 현황", 층: "특수경로", 판별: "isOpsStatusAsk", 도착: "opsStatusAnswer(카드)", 감시: ": isOpsStatusAsk(instructionText) ? await opsStatusAnswer()" });

  본다(!!이름으로화면찾기(t), { 이름: "「○○ 어디서 해?」 자리 안내", 층: "화면안내", 판별: "이름으로화면찾기", 도착: "화면위치안내 + 화면 열기", 감시: "const 찾는화면 = 이름으로화면찾기(instructionText)" });
  const 방법화면 = 방법질문화면찾기(t);
  본다(!!방법화면 && !(방법화면.표준전용 && 에디션제한중()), { 이름: "「○○ 하려면?」 방법 안내", 층: "화면안내", 판별: "방법질문화면찾기", 도착: "formatScreenGuide + 화면 열기", 감시: "const 방법화면 = 방법질문화면찾기(instructionText)" });
  본다(isHelpIntent(t, 옵션?.화면), { 이름: "화면 사용 안내", 층: "화면안내", 판별: "isHelpIntent", 도착: "formatScreenGuide(지금 화면)", 감시: "if (isHelpIntent(instructionText, screen))" });

  본다(결재승인요청_RE.test(t), { 이름: "결재 승인 요청", 층: "특수경로", 판별: "결재승인요청_RE", 도착: "결재판 안내(대신 승인 안 함)", 감시: "if (결재승인요청_RE.test(instructionText))" });
  본다(KB_HYGIENE_INTENT_RE.test(t), { 이름: "지식베이스 정리", 층: "특수경로", 판별: "KB_HYGIENE_INTENT_RE", 도착: "kbhygiene 리포트", 감시: "if (KB_HYGIENE_INTENT_RE.test(instructionText))" });
  본다(ATTACK_PATH_INTENT_RE.test(t), { 이름: "공격 경로 분석", 층: "특수경로", 판별: "ATTACK_PATH_INTENT_RE", 도착: "formatAttackPaths", 감시: "if (ATTACK_PATH_INTENT_RE.test(instructionText))" });
  본다(SHADOW_AI_INTENT_RE.test(t), { 이름: "Shadow AI 점검", 층: "특수경로", 판별: "SHADOW_AI_INTENT_RE", 도착: "formatShadowAi", 감시: "if (SHADOW_AI_INTENT_RE.test(instructionText))" });

  // 조치 플레이북 — 배제 다섯 겹까지 **그대로** 재야 한다(하나만 빠져도 설명이 거짓이 된다)
  본다(
    REMEDIATION_INTENT_RE.test(t)
      && !장애질문인가(t) && !침해사고질문인가(t) && !문서지목질문(t)
      && !조치실행지시_RE.test(t)
      && (await import("./playbook.js")).플레이북영토인가(t),
    { 이름: "조치 플레이북", 층: "특수경로", 판별: "REMEDIATION_INTENT_RE", 도착: "formatRemediation", 감시: "REMEDIATION_INTENT_RE.test(instructionText) &&" },
  );

  본다(LEARN_TOPIC_RE.test(t) && LEARN_RUN_RE.test(t), { 이름: "학습 루프 실행", 층: "특수경로", 판별: "LEARN_TOPIC_RE", 도착: "학습 루프 확인 절차", 감시: "if (LEARN_TOPIC_RE.test(instructionText) && LEARN_RUN_RE.test(instructionText))" });
  const steps = planInstruction(t);
  본다(steps.length >= 2, { 이름: "복합 지시", 층: "특수경로", 판별: "planInstruction", 도착: steps.length >= 2 ? `오케스트레이션 ${steps.length}단계` : "오케스트레이션(2단계 이상)", 감시: "const steps = planInstruction(instructionText)" });
  본다(ACTION_CHECK_RE.test(t) && !침해사고질문인가(t) && !장애질문인가(t), { 이름: "행동 대조(해도 되나)", 층: "특수경로", 판별: "ACTION_CHECK_RE", 도착: "runActionCheck", 감시: "ACTION_CHECK_RE.test(instructionText) &&" });

  본다(
    !옵션?.선택 && (대명사뿐인가(t) || 가리킬것없는대명사(t, 옵션?.대화) || 설명칩_RE.test(t.trim())),
    { 이름: "가리킬 것 없는 대명사", 층: "되묻기", 판별: "대명사뿐인가", 도착: "되물음(예시 3개)", 감시: "if (!선택 && (대명사뿐인가(instructionText)" },
  );

  본다(장애질문인가(t), { 이름: "장비 장애·중단", 층: "특수경로", 판별: "장애질문인가", 도착: "장애초동절차", 감시: "if (장애질문인가(instructionText))" });
  본다(침해사고질문인가(t), { 이름: "침해사고 의심", 층: "특수경로", 판별: "침해사고질문인가", 도착: "침해사고초동절차", 감시: "if (침해사고질문인가(instructionText))" });
  본다(REJECT_HISTORY_RE.test(t), { 이름: "반려·오탐 이력", 층: "특수경로", 판별: "REJECT_HISTORY_RE", 도착: "formatRejectHistory", 감시: "if (REJECT_HISTORY_RE.test(instructionText))" });
  본다(REPORT_CREATE_RE.test(t) && !REPORT_QUERY_EXCLUDE_RE.test(t), { 이름: "리포트 만들기", 층: "특수경로", 판별: "REPORT_CREATE_RE", 도착: "generateReport", 감시: "if (REPORT_CREATE_RE.test(instructionText) && !REPORT_QUERY_EXCLUDE_RE.test(instructionText))" });

  // ⑨ 강제 도구 — runAgentLoop이 맨 앞에서 보는 자리(제품 함수 forcedToolFor가 그대로 답한다)
  const 강제 = forcedToolFor(t, 옵션?.역할 ? { role: 옵션.역할 } : undefined);
  본다(!!강제, { 이름: "강제 도구", 층: "강제도구", 판별: "forcedToolFor", 도착: 강제?.tool ?? "FORCED_INTENTS가 못 박은 도구", 감시: "const loop = await runAgentLoop(실행문" });

  return 전체;
}

/**
 * 감사 로그의 **「무엇을 바꿨나」** 칸을 만든다(2026-08-18).
 *
 * ⚠ 왜 생겼나 — 전에는 `args.assetId ?? args.code ?? null`이 전부였다.
 *   그런데 이 제품에서 **가장 크게 바꾸는 쓰기**인 `bulk_update_findings`는
 *   자산 하나를 받지 않는다 — 조건(`filter`: "critical kev")이나 고른 목록(`ids`)을 받아
 *   **수백 건을 한 번에** 배정·판정한다. 그 둘 다 위 식에 없어서 감사 로그에
 *   **`target`이 빈칸(null)**으로 남았다. 「누가 언제 승인했다」는 남는데
 *   **「무엇을」이 안 남았다** — 감사 로그로서 반쪽이다.
 *
 * 우선순위: 콕 집은 것(assetId·code) → 고른 목록(ids) → 조건(filter) → 이름표.
 * ⚠ 길이를 200자로 자른다 — ids는 20건 넘게 올 수 있고, 감사 칸은 열람용이지 원본이 아니다.
 *   (몇 건이었는지는 잘려도 알 수 있게 **건수를 앞에 적는다.**)
 */
export function 감사대상(toolName: string, args: Record<string, string>): string | null {
  const 값 = (k: string) => String(args[k] ?? "").trim();
  const 세어서 = (말: string, 목록: string) =>
    `${말} ${목록.split(/[,\n]/).filter((s) => s.trim()).length}건: ${목록}`.slice(0, 200);

  // ① 콕 집은 하나 — 가장 구체적이다.
  const 콕 = 값("assetId") || 값("code");
  if (콕) return 콕.slice(0, 200);

  // ② 사람이 체크한 것.
  const ids = 값("ids");
  if (ids) return 세어서("고른", ids);

  // ③ 조건 vs 보던 목록 — **runBulkUpdate와 같은 순서로 판단한다.**
  //    ⚠ 조건이 뜻을 잃으면(「이것들」) 실제로 바뀌는 건 보던 목록이다. 여기서 조건을 적으면
  //      감사 로그가 **빈칸 대신 틀린 값**을 갖는다(2026-08-18 검토 지적). 빈칸보다 나쁠 수 있다 —
  //      빈칸은 모른다는 뜻이지만 틀린 값은 안다고 거짓말하는 것이다.
  const filter = 값("filter");
  const viewIds = 값("viewIds");
  if (viewIds && !조건이좁히나(filter)) return 세어서("보던 목록", viewIds);
  if (filter) return `조건: ${filter}`.slice(0, 200);

  // ④ 나머지 도구 — **그 도구가 스스로 가진 인자 이름표**를 쓴다.
  //    ⚠ 이름을 손으로 나열하지 않는 이유: 쓰기 도구가 21개인데 예전 식은 6개만 알아서
  //      10개가 빈칸으로 남았다(검토 지적). 새 도구가 생기면 또 빠진다.
  //      도구가 자기 인자를 알고 있으니 거기서 받아 오면 **빠질 수가 없다.**
  //    ⚠ `??`로 잇지 않는다 — `??`는 빈 문자열("")을 통과시켜 **빈 칸에서 멈춘다.**
  //      결재판은 안 채운 칸을 ""로 보내므로(console.js collect) 실제로 밟히는 함정이다.
  const 도구 = findAgentTool(toolName);
  if (도구) {
    for (const p of 도구.params) {
      const v = 값(p.name);
      if (v) return `${p.label}: ${v}`.slice(0, 200);
    }
  }
  return 값("name")?.slice(0, 200) || 값("title")?.slice(0, 200) || null;
}

/**
 * 답에 나온 취약점 목록에 체크칸을 붙인다(2026-07-31).
 * 결재판이 이미 떠 있으면 붙이지 않는다 — 승인할 게 있는데 그 위에 또 고르라고 하면 무엇을
 * 누르는지 알 수 없다. 한 답에 결정 하나가 원칙이다.
 */
function picksFor(output: string, toolCalls?: AgentToolCall[], approval?: PendingApproval): { picklist?: PickList } {
  if (approval) return {}; // 승인할 게 떠 있는데 그 위에 또 고르라고 하면 무엇을 누르는지 알 수 없다
  if (!toolCalls || toolCalls.length === 0) return {};
  const picks = buildFindingPicks(output, toolCalls.map((t) => t.tool));
  return picks ? { picklist: picks } : {};
}

// 📎 첨부 조립(노트북형) — 두 입구(통짜·스트림)가 같은 함수를 쓴다(두 벌이면 어긋난다).
// 삭제·아카이브로 빈 세션은 **조용히 버리지 않는다**(검토관 — 칩은 남았는데 첨부는 무동작이면
// 「첨부한 척」이 된다. 제품 1원칙: 가짜 UI·조용한 무동작 금지). 빠진 사실을 맥락에 그대로 싣어
// 모델이 「그 작업 내용은 받지 못했다」를 알고 답하게 한다.
function 첨부글만들기(raw: unknown): string | undefined {
  const ids = sanitizeAttachIds(raw);
  if (!ids.length) return undefined;
  const texts = ids.map((id) => attachSessionText(id));
  const 빠짐 = texts.filter((t) => !t).length;
  const parts = texts.filter(Boolean);
  if (빠짐) parts.push(`(담당자가 첨부한 지난 작업 ${빠짐}건은 삭제되었거나 보관함으로 넘어가 내용을 싣지 못했습니다 — 그 내용을 아는 척하지 말 것)`);
  return parts.join("\n\n") || undefined;
}

export function registerDispatcherRoutes(app: Express): void {
  registerProgressRoutes(app); // 진행 조회(GET /api/dispatch/progress) — 지시 처리 중 0.7초 폴링
  app.post(
    "/api/dispatch",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
      // screen — 클라이언트가 보내는 현재 화면(예: "vulnscan.html"). 없어도 동작한다(구버전 호환).
      const screen = typeof req.body?.screen === "string" ? req.body.screen : undefined;
      const text = String(req.body?.text ?? "");
      // ★ 빈 지시는 **400으로 거절한다**(2026-08-09). 예전엔 빈 값으로도 처리에 들어가
      //   "무엇을 도와드릴까요?" 안내가 200으로 나갔다 — 그럴듯해서 **호출부의 오류를 감춘다.**
      //   실측: 본문 키를 text가 아닌 이름으로 보낸 호출이 200+안내를 받아, 재는 쪽이
      //   "제품이 답을 못 한다"고 읽었다(하루에 네 번). 빈 요청은 사람이 보낸 것이 아니라
      //   **부르는 쪽이 틀린 것**이므로 조용히 받아 주지 않고 어디가 틀렸는지 알려 준다.
      //   ⚠ 두 입구(/api/dispatch·/api/dispatch/stream) 모두에 둔다 — 한 곳만 막으면 샌다.
      if (!text.trim()) {
        res.status(400).json({
          error: "지시 내용이 비어 있습니다 — 본문에 text를 담아 보내세요.",
          // ⚠ 실제로 읽는 필드 전부를 적는다 — qa·progressId가 빠져 있던 것도 고침(설계관 지적).
          expected: { text: "string(필수)", sessionId: "string?", screen: "string?", selection: "string?", qa: "boolean?", progressId: "string?", docIds: "string[]?", attachSessions: "string[]?" },
        });
        return;
      }
      const user = (req as Request & { user?: GijoUser }).user;
      // qa=true — 평가 게이트/QA 호출 표시(중-3). 세션·학습 수집을 건너뛴다(오염 방지).
      // 판단 경로는 동일하므로 이 플래그로 점수가 후해지는 일은 없다.
      const qa = req.body?.qa === true;
      // ☑ 근거 지정·📎 지난 작업 첨부(노트북형 2026-08-30) — 요청 동안만 사는 ALS 꼬리표로
      // 나른다(ragscope.ts). 검색(하드 필터)·배지·도구·normaltic이 **한 기계**로 같은 범위를 본다.
      const 지정문서 = sanitizeDocIds(req.body?.docIds);
      const 첨부글 = 첨부글만들기(req.body?.attachSessions); // 빈 세션은 조용히 안 버린다(위 헬퍼)
      // progressId — 클라가 만든 UUID. 있으면 처리 중 단계를 기록해 두고 클라가 폴링으로 본다
      // (2026-07-30 사용자 요청 "진행사항을 %나 진행 바로"). 없으면(구버전·QA) 완전 무동작.
      const progressId = isValidProgressId(req.body?.progressId) ? (req.body.progressId as string) : null;
      // selection — 화면에서 골라 둔 항목(2026-08-09 2단계). 줄바꿈을 눌러 한 줄로 만들고 200자에서
      // 자른다 — 화면 라벨이 프롬프트 구조(줄 단위 지시)를 흔들지 못하게 하는 최소 방어다.
      const 선택 = 선택정리(req.body?.selection);

      // 30초 안에 안 끝나면 "리포트로 작성해 드리겠다"고 답하고 물러난다(사용자 결정 2026-07-26, 10초→30초).
      // 작업은 뒤에서 계속 돌고, 끝나면 리포트로 저장한 뒤 화면에 팝업으로 알린다.
      //
      // ★ 단, 평가 게이트(qa=true)는 더 기다린다(2026-07-31).
      //   리포트 전환은 **사람을 기다리게 하지 않으려는 배려**지 측정에 필요한 것이 아니다.
      //   30초를 넘기면 돌아오는 건 안내 문구뿐이라 게이트가 재려던 것을 아예 못 쟀고,
      //   그 문항은 '측정 못 함'으로 분모에서 빠졌다 — **그 자리에 결함이 숨어도 안 보인다**
      //   (실측 2026-07-31: 라우팅 축에서 2문항이 그렇게 빠졌다).
      //   무한정은 아니다. 매달린 요청이 게이트를 영영 멈추게 하면 안 되므로 상한을 둔다.
      // 보고서꼴("보고서 만들어줘")은 3초만 기다린다(2026-08-07) — 리포트가 곧 요청물이라
      // 리포트 저장+알림이 답을 깎는 게 아니다. 그 밖은 기존 30초 그대로.
      const limitMs = qa ? QA_LONG_ANSWER_MS : 보고서꼴(text) ? REPORT_HANDOFF_MS : LONG_ANSWER_MS;
      const t0 = Date.now(); // 느린 답 원장(관측성) — 담당자를 기다리게 한 질문을 제품이 스스로 적는다
      const work = runWithRagScope({ docIds: 지정문서, attachText: 첨부글 }, () =>
        runWithProgress(progressId, user?.id ?? null, () =>
          dispatchInstruction(text, sessionId, screen, user?.displayName, qa, isNonLearningAccount(user?.username), { userId: user?.id ?? user?.username, clearance: user?.clearance, role: user?.role }, 선택)
        )
      );
      let handedOff = false;
      const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), limitMs));
      const first = await Promise.race([work, timer]);

      if (first !== null) {
        recordAnswerTiming(text, Date.now() - t0, qa, (first as { route?: { agentId?: string } }).route?.agentId);
        // 내부 키(vuln:… )를 사람이 읽는 이름으로 — **모델이 근거 자료에서 옮겨 적은 것**이라
        // 도구 한 곳으로는 못 막는다(2026-08-07 150상황 실측). 막지 않고 바꾸기만 한다.
        const 답 = first as { output?: string };
        if (typeof 답.output === "string") 답.output = 내부키치환(답.output, 자산표시이름);
        // 말투 규범 감시 — **여기가 답이 담당자에게 나가는 마지막 지점**이다.
        // ⚠ 막지 않는다. 기록만 하고 답은 그대로 보낸다(tonewatch.ts 머리말 참고).
        //   오탐 하나로 답이 통째로 막히면 놓치는 것보다 나쁘다.
        말투재기(text, String(답.output ?? ""));
        // qa 측정용 신호 — qa는 전환 없이 끝까지 기다리므로, **사람 경로였다면 리포트로
        // 물러났을 답**임을 판정기에 알려 준다(판별은 보고서꼴 한 곳 — 판정기가 따로 흉내 내면
        // 두 판별이 어긋난다). 사람 응답에는 안 실린다.
        if (qa && 보고서꼴(text) && Date.now() - t0 > REPORT_HANDOFF_MS) {
          (first as { wouldHandoff?: boolean }).wouldHandoff = true;
        }
        res.json(first);
        return;
      }

      handedOff = true;
      const longId = startLongAnswer(text, user?.id ?? null);
      const actor = user?.displayName ?? null;
      work
        .then(async (r) => {
          if (!handedOff) return;
          // 리포트로 넘어간 답도 소요 시간은 적는다 — 30초를 넘긴 것이야말로 원장의 몫이다.
          recordAnswerTiming(text, Date.now() - t0, qa, r.route?.agentId);
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
  // 답 스트리밍(전-7, 2026-08-09 시안 「정돈안」 승인) — 같은 dispatch를 돌리되 산문이
  // 생성되는 대로 토막(delta)을 SSE로 흘린다. 첫 글자가 1초 안에 나오는 것이 목적이다.
  // ⚠ 정직 규칙: 흘린 글자는 「쓰는 중」 표시일 뿐이고 **최종 답은 done의 result.output**이다 —
  //   출구 관문(거짓 완료·내부키 치환·말투 감시)이 손본 뒤의 텍스트라 화면은 반드시 갈아 끼운다.
  //   쓰기 지시는 산문 생성이 없어 아무것도 흐르지 않는다(결재판만 done에 실림 — 시안 요구).
  //   30초 리포트 전환은 여기 없다 — 스트리밍 자체가 「기다리게 하지 않기」라 물러날 이유가 없다.
  app.post(
    "/api/dispatch/stream",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
      const screen = typeof req.body?.screen === "string" ? req.body.screen : undefined;
      const text = String(req.body?.text ?? "");
      // ★ 빈 지시는 **400으로 거절한다**(2026-08-09). 예전엔 빈 값으로도 처리에 들어가
      //   "무엇을 도와드릴까요?" 안내가 200으로 나갔다 — 그럴듯해서 **호출부의 오류를 감춘다.**
      //   실측: 본문 키를 text가 아닌 이름으로 보낸 호출이 200+안내를 받아, 재는 쪽이
      //   "제품이 답을 못 한다"고 읽었다(하루에 네 번). 빈 요청은 사람이 보낸 것이 아니라
      //   **부르는 쪽이 틀린 것**이므로 조용히 받아 주지 않고 어디가 틀렸는지 알려 준다.
      //   ⚠ 두 입구(/api/dispatch·/api/dispatch/stream) 모두에 둔다 — 한 곳만 막으면 샌다.
      if (!text.trim()) {
        res.status(400).json({
          error: "지시 내용이 비어 있습니다 — 본문에 text를 담아 보내세요.",
          expected: { text: "string(필수)", sessionId: "string?", screen: "string?", selection: "string?", qa: "boolean?", progressId: "string?", docIds: "string[]?", attachSessions: "string[]?" },
        });
        return;
      }
      const user = (req as Request & { user?: GijoUser }).user;
      const qa = req.body?.qa === true;
      const progressId = isValidProgressId(req.body?.progressId) ? (req.body.progressId as string) : null;
      const 선택 = 선택정리(req.body?.selection);
      // ☑·📎 — 통짜 라우트와 같은 처리(두 입구가 같은 계약 — 한 곳만 하면 스트림에서 샌다).
      const 지정문서 = sanitizeDocIds(req.body?.docIds);
      const 첨부글 = 첨부글만들기(req.body?.attachSessions); // 빈 세션은 조용히 안 버린다(위 헬퍼)

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders?.();
      const 보냄 = (obj: unknown) => {
        try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* 끊긴 연결 — 흘리기만 멈춘다 */ }
      };
      const 싱크 = { 시작: () => 보냄({ t: "start" }), 토막: (t: string) => 보냄({ t: "delta", text: t }) };

      const t0 = Date.now();
      try {
        const r = await runWithRagScope({ docIds: 지정문서, attachText: 첨부글 }, () =>
          스트림자리.run(싱크, () =>
            runWithProgress(progressId, user?.id ?? null, () =>
              dispatchInstruction(text, sessionId, screen, user?.displayName, qa, isNonLearningAccount(user?.username), { userId: user?.id ?? user?.username, clearance: user?.clearance, role: user?.role }, 선택)
            )
          )
        );
        // 출구 손질은 기존 라우트와 같은 순서·같은 함수 — 여기만 다르면 두 입이 딴말을 한다.
        recordAnswerTiming(text, Date.now() - t0, qa, r.route?.agentId);
        if (typeof r.output === "string") r.output = 내부키치환(r.output, 자산표시이름);
        말투재기(text, String(r.output ?? ""));
        보냄({ t: "done", result: r });
      } catch (err) {
        // 정직: 흘리다 죽었으면 죽었다고 말한다 — 잘린 답을 완성인 척 두지 않는다(시안 명시).
        보냄({ t: "error", message: err instanceof Error ? err.message : String(err) });
      }
      res.end();
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
      // 승인 실행은 사람이 화면에서 직접 누른 행위다 — 게이트가 탈 일이 없으므로 항상 기록한다.
      const task = mkTask(undefined, { text: `[승인 실행] ${toolName}`, agentId: "orchestrator", priority: "P2" });
      setAgentStatus("orchestrator", "working");
      collab(undefined, { from: "orchestrator", to: "orchestrator", message: `승인됨 — ${toolName} 실행` });
      const user = (req as Request & { user?: GijoUser }).user;
      const actor = user?.displayName ?? null;
      try {
        const undoBefore = undoSnapshot(); // #7: 실행 전 상태 스냅샷(원클릭 undo용)
        // 승인 실행도 **누가 승인했는지**를 실어 나른다(viewerctx) — 도구 내부 감사·등급 필터가
        //   실행자를 알게. 지식 번들 반입처럼 공급망에 닿는 쓰기는 사람 이름이 특히 중요하다
        //   (2026-08-04 자체 검토: 없으면 도구 내부 감사가 '담당자(대화창)' 일반값으로 남았다).
        const output = await runWithViewer(
          { userId: user?.id ?? user?.username, clearance: user?.clearance },
          // ⚠ 실행자 권한을 넘긴다 — 이 라우트는 authMiddleware(로그인)만 지나므로,
          //   admin 전용 도구를 막는 곳은 executeApprovedTool뿐이다(2026-08-05 검토 지적).
          () => executeApprovedTool(toolName, args, user?.role)
        );
        const undoId = undoCommit(toolName, output.slice(0, 50), undoBefore); // 변화 있으면 되돌리기 항목 등록
        collab(undefined, { from: "orchestrator", to: "orchestrator", message: `실행 완료: ${collabNote(output)}` });
        // 작업 기록(감사 로그) — 승인된 쓰기 실행을 남긴다(챗봇 제안 → 사람 승인).
        recordAudit({ kind: "write", actor, action: `승인 실행: ${toolName}`, target: 감사대상(toolName, args), detail: `${instruction ? instruction + " → " : ""}${output.slice(0, 200)}`, result: "ok" });
        // 사람이 승인한 (지시→도구) = 검증된 정답. 파인튜닝 골드 예시로 누적한다(Phase 4, 자가강화).
        appendApprovedDecision(instruction, toolName, args);
        resetAgentToDefault("orchestrator");
        const updated = completeTask(task.id);
        // ★ 승인 실행 뒤에도 **다음 걸음**을 준다(2026-08-20 사장님 「대화창 명령이 후 다음
        //   작업에 대한 연계성을 많이 고려해줘야할듯」). 여기가 사슬이 가장 자주 죽던 자리다 —
        //   실측 177단계 중 **37단계가 결재판**인데 승인 응답에는 안내가 하나도 없어, 담당자가
        //   가장 자주 지나는 길목에서 매번 대화가 끝났다.
        //   ⚠ 표(nextguide)는 **이미 있다** — register_asset·assign_finding·update_finding_status·
        //   bulk_update 네 항목이 적혀 있는데 읽는 쪽이 없어 **한 번도 발화된 적이 없었다.**
        //   새 표를 만드는 것이 아니라 있는 것을 소비한다.
        //   ⚠ 승인 **전**에 칩을 안 붙이는 계약(결재판이 떠 있으면 생략)은 그대로다 — 승인 전과
        //   후는 다른 자리다(승인 전 칩은 결재를 미루게 만든다).
        // ⚠ 칩은 **장식**이다 — 이 계산이 실패해도 이미 끝난 쓰기가 실패로 보이면 안 된다
        //   (2026-08-20 병렬 검토: 같은 try 안이라 여기서 예외가 나면 catch가 감사 로그에
        //   result:"error"를 남기고 400을 돌려준다 — 실행은 됐는데 사람에겐 실패로 보인다).
        let nextChips: string[] = [];
        try {
          const { nextChipsFor: 칩표 } = await import("./nextguide.js");
          nextChips = 칩표(toolName);
        } catch { /* 칩을 못 구해도 실행 결과는 그대로 돌려준다 */ }
        res.json({ output, undoId, task: updated.find((t) => t.id === task.id) ?? task, ...(nextChips.length ? { nextChips } : {}) });
      } catch (err) {
        resetAgentToDefault("orchestrator");
        completeTask(task.id);
        // FAIL_MARKS-예외: 감사 로그의 action 문자열이다(사람 대면 답이 아니라 기록). 승인 실행이
        //   실제로 예외를 던진 진짜 실패라 「실행 실패」로 적는 것이 맞다.
        // ⚠ 실패에도 **무엇을 건드리려 했는지**를 남긴다 — 사고 조사에서 성공 기록보다 중요하다.
        recordAudit({ kind: "write", actor, action: `승인 실행 실패: ${toolName}`, target: 감사대상(toolName, args), detail: err instanceof Error ? err.message : String(err), result: "error" });
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })
  );
}
