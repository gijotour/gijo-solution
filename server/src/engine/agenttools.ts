// engine/agenttools.ts — 에이전트 루프가 호출할 수 있는 도구 레지스트리.
//
// ⚠ 설계 축: **화면 메뉴가 아니라 사용자 의도** (2026-07-17 확정).
// 처음엔 메뉴를 1:1로 미러링했는데(list_assets/get_asset/get_aibom = 자산 메뉴), 그러면 LLM이
// "이 질문은 어느 메뉴인가"를 먼저 풀어야 하고 메뉴를 가로지르는 질문("오늘 뭐부터?", "Log4Shell
// 관련된 거 다 찾아줘")에 도구를 3~4개 조합해야 해서 실패율이 올라간다. 그래서 도구를 의도 단위로
// 잡고, 메뉴 경계를 서버가 가로지른다:
//   찾기(search) · 설명(explain) · 상세(get_asset) · 목록(list_assets) · 오늘(today) · 등록(register_asset)
// 온톨로지(지식 그래프)가 그 접착제다 — 위협→완화통제→보안제품→자산 관계가 이미 메뉴를 가로지른다.
//
// 원칙(QA 보고서 2026-07-17): 판단·검증·실행은 여기(규칙 코드), LLM은 도구 선택·인자 추출만.
// 도구 결과는 LLM에 재주입되므로 장황한 JSON 대신 짧은 한국어 요약 텍스트를 돌려준다.
//
// 쓰기 도구(write:true)는 루프가 바로 실행하지 않는다 — 값을 결재판(PendingApproval)으로
// 만들어 돌려주고, 사람이 승인한 뒤 /api/agent/approve로만 실행된다(시안 B, 2026-07-17 확정).

import { dateOnlyLocal, addDaysLocal, koDateTimeString } from "../util/date";
import { listAssets, getAsset, registerAsset, updateAssetOwnership, updateAssetMeta, setAssetRobustness, isAiAsset, Asset, 자산표시이름 } from "./assets";
import { computeAssetCoverage, coverageSummaryText, type GapKind } from "./assetcoverage";
import { expandOntology } from "./ontology";
import { prioritizedReviews, updateFindingReview, findingKey, ReviewPatch, ApprovalStatus } from "./approvals";
import { 표식, 심각도한글, 심각도표식 } from "./tone";
import { buildHub, sourceFileOf } from "./assethub";
import { workflowStages } from "./workflow";
import { 한줄풀이글, 섞임고지 } from "./findingplain";
import { eol찾기, eol한줄 } from "./eol-seed";
import { 패키지수집, 구성요소합치기, 덮는범위글 } from "./packagescan";
import { targetRunner } from "./hardeningscan";
import { listTargets } from "./hardeningtargets";
import { 잃은취약점찾기, 잃은취약점현황글, 되살리기 } from "./findingsrestore";
import { listProducts, createProduct, PRODUCT_CATEGORIES } from "./securityproducts";
import { listMaintenanceItems, createMaintenanceItem } from "./maintenance";
import { listCompliance, setComplianceStatus } from "./compliance";
import { generateSbom } from "./sbom";
import type { ComplianceStatus } from "./compliance";
import { countTriples } from "./ontology";
import { listVisibleDocuments, queryMemory, queryMemoryRelevant, queryMemoryScored } from "./memory";
import { listFindings as listCtiFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { dailyBriefingText } from "./briefing";
import { runRedTeam, makeServedCaller } from "./redteam";
import { runHardeningScan, scanSummaryText, isStandard } from "./hardeningscan";
import { listSchedules as listReportSchedules, scheduleSummaryText } from "./reportschedule";
import { reportActivity, listReportHistory } from "./report";
import { listSchedules as listHardeningSchedules } from "./hardeningtargets";
import { timeSavedText } from "./timesaved";
import { feedbackSummaryText } from "./answerfeedback";
import { adoptionSummaryText } from "./modeladoption";
import { systemHealthText } from "./observability";
import { alertScheduleText, createAlertSchedule, ALERT_KIND_LABEL } from "./alertschedule";
import type { AlertKind } from "./alertschedule";
import { getSmtpConfig } from "./email";
import { listAnalysisEvents, analysisSummary, computeCorrelations } from "./analysishub";
import { computeKpiSnapshot, 점수영향글 } from "./kpi";
import { listSessions as listWorkSessions } from "./worksessions";
import { canonicalize, suggestionsFor } from "./terms";
import { listAudit, recordAudit, type AuditEntry } from "./audit";
import { lawAnswer, getLawConfig, type LawTarget } from "./lawinfo";
// 담당자가 "미조치"라고 하면 저장값 open·pending을 뜻한다 — 글자 그대로 대조하면 늘 0건이다.
import { 필터에맞나 } from "./statuswords";
// 내 업무(할 일) — 화면을 없애고 대화창에서 한다(2026-08-01 사용자 결정).
import { listTasks, createTask, setTaskDone, setGuideStepDone, routineSuggestions, recordRoutineFeedback } from "./tasks";
import { buildMyWork } from "./mywork";
import { getGuide as 가이드가져오기 } from "./workguide";
import { getScreenGuide } from "./screenguide";
// 지식 번들(후-3 구독화) — 지금 실린 지식이 언제 기준인지 보기 + 대기 폴더 번들 반입.
import { getBundleStatus, listInboxBundles, importBundleFromInbox, KNOWLEDGE_BUNDLE_VERSION } from "./knowledgebundle";
import { currentViewer } from "./viewerctx";
import { findUserById } from "../auth/users";

/** 화면 파일명 → 담당자가 메뉴에서 보는 한글 이름. 못 찾으면 파일명 대신 빈 값을 쓰지 않고
 *  그대로 두되, screenguide에 제목이 있으면 그것을 쓴다(안내 문구와 메뉴 이름이 같아야 한다). */
function 화면이름(page: string): string {
  const g = getScreenGuide(page);
  return g && g.title ? g.title : String(page).replace(/\.html.*$/, "");
}
import type { MyWorkItem } from "./mywork";

export interface AgentToolParam {
  name: string;
  label: string; // 결재판에 보일 한국어 이름
  description: string;
  required: boolean;
}

// ── 도메인 축 ───────────────────────────────────────────────────────────────
// 메뉴 전수 조사(tools/menu-audit.mjs)에서 나온 업무 영역. 화면 24개와 1:1이 아니다 —
// 지시를 받을 수 있는 영역만 추린 것이다(설정·로그·사용량은 오케스트레이션 대상이 아니다).
//
// 이 축으로 도구를 걸러 프롬프트에 넣는다. 전체를 평평하게 뿌리면 도구가 늘수록 선택 정확도가
// 떨어진다 — 업계에서 말하는 "도구 발견 문제"이고, 해법은 상황에 맞는 것만 노출하는 것이다.
export const TOOL_DOMAINS = [
  "assets", // 자산 인벤토리
  "vuln", // 취약점·조치
  "sbom", // AI-BOM/SBOM 구성
  "products", // 보안제품 등록부
  "maintenance", // 정기 점검
  "report", // 보고서
  "knowledge", // 장기기억·온톨로지
  "threat", // 위협 인텔
] as const;
export type ToolDomain = (typeof TOOL_DOMAINS)[number] | "cross";

export interface AgentTool {
  name: string;
  label: string; // 결재판 제목용("자산 등록")
  // 이 도구가 속한 업무 영역. "cross"는 어느 화면에서든 쓰이는 횡단 도구(검색·설명·브리핑 등)라
  // 도메인 필터와 무관하게 항상 노출된다.
  domain: ToolDomain;
  write: boolean; // true면 상태를 바꾸는 도구 — 결재판을 거쳐야 실행된다
  // 이 도구를 쓸 수 있는 최소 권한. 지정하면 그 권한이 없는 사용자에게는 목록에서 아예 숨긴다.
  // GPU를 통째로 점유하거나(파인튜닝·모델 병합) 전체에 영향을 주는(엔진 로드·설정) 작업용.
  // 한 명이 실행하면 추론 엔진이 내려가 담당자 전원이 채팅을 못 쓰게 되므로 담당자 권한에서 뺀다.
  requiredRole?: "admin";
  // true면 이 도구의 결과를 그대로 최종 답으로 쓴다(LLM 재작성 생략). 출력이 이미 사람이 읽기 좋은
  // 결정적 요약(예: today의 우선순위 목록)일 때 쓴다 — 두 번째 LLM 호출을 없애 빠르고,
  // 대용량 결과를 LLM에 다시 밀어넣다 멈추는 일(실측: today 300초 무응답)을 원천 차단한다.
  directAnswer?: boolean;
  description: string; // LLM에게 보여줄 한 줄 설명(한국어)
  params: AgentToolParam[];
  // 쓰기 도구용: LLM이 안 준 값을 서버 규칙으로 채운다(예: id를 이름에서 생성). 결재판에서 "자동생성"으로 표시된다.
  autoFill?: (args: Record<string, string>, instruction: string) => Record<string, string>;
  effect?: (args: Record<string, string>) => string; // "실행되면:" 고지
  undo?: string; // "되돌리기:" 고지
  run: (args: Record<string, string>) => Promise<string> | string;
}

// ── 「AI 자산」 도구 구현 ────────────────────────────────────────────────

// ⚠ info는 **맨 뒤**다. 취약점이 아니라 조사 결과이므로 정렬에서도 마지막에 온다.
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

/**
 * scan_error는 **스캔이 실패했다는 운영 기록이지 취약점이 아니다.**
 * AI-BOM(sbom.ts)은 진작 제외하고 있었는데 이 도구들은 취약점으로 세고 있었다.
 *
 * 실사고(2026-07-28 회귀, 2026-07-30 규명): "안전대부 웹서버 취약점 알려줘"에
 * **"취약점 1건 — scan_error"**라고 답했다. 같은 답변에 이름이 실린 진단 보고서에는
 * 5건이 적혀 있었고(평문 전송·디렉토리 인덱싱 등) 발췌까지 도구 결과에 실려 있었는데도,
 * 앞줄에 "취약점 1건"이 박혀 있으니 모델이 그것을 답으로 삼았다.
 * 스캔 실패를 취약점으로 세지 않으면 그 자산의 DB 취약점은 0건이 되고, 모델은 근거로
 * 문서 발췌를 쓸 수밖에 없다 — **틀린 숫자를 먼저 보여주지 않는 것이 처방이다.**
 * (숫자가 틀린 답은 없느니만 못하다. 담당자가 그 숫자로 보고를 쓴다.)
 */
export function isRealVulnerability(f: { finding_type?: string; severity?: string }): boolean {
  if (SCAN_NOISE.has(String(f.finding_type ?? ""))) return false;
  // ★ **조사 결과(info)는 취약점이 아니다**(2026-08-04). 스캐너가 severity 0(None)으로 준 것 —
  //   "이 서버에 SSH가 깔려 있다" 같은 사실이다. 세는 자리를 나눌 뿐 **감추지 않는다**
  //   (조사 정보 건수는 따로 낸다 — scan_error를 다루는 방식과 같다).
  //
  // ⚠ **이름으로는 거르지 않는다.** 이름 규칙(findingplain)은 45%만 덮고, 그것으로 집계를
  //   깎으면 내 정규식이 넓어질 때 **진짜 취약점이 조용히 사라진다.** 스캐너가 준 심각도만 본다.
  if (String(f.severity ?? "").toLowerCase() === "info") return false;
  return true;
}

/**
 * **시연용 데이터가 섞여 있으면 밝힌다.**
 *
 * 왜 필요한가(2026-08-03 실측): 운영 서버의 취약점 14건이 **전부 `demo-scan.csv`**에서 왔는데
 *   자산 출처는 `scanner`로 찍혀 있어 화면에서 실제 스캔 결과와 구분되지 않았다.
 *   담당자가 "우리 망에 Log4Shell이 있다"고 읽으면 **없는 사고를 쫓게 된다.**
 *
 * ⚠ **지우지도, 숨기지도 않는다.** 지우면 시연·시험 기준선이 무너지고,
 *   숨기면(origin=sample) 화면 기본 목록에서 사라져 지운 것과 같아진다.
 *   남겨 두되 **숫자를 말할 때 함께 밝힌다** — 그게 정직한 쪽이다.
 * ⚠ 섞여 있지 않으면 **아무 말도 안 붙인다** — 늘 붙는 단서는 아무도 안 읽는다.
 */
const 시연도구 = /^demo[-_]|샘플|sample[-_]scan/i;
export function 시연데이터알림(findings: { source_tool?: string; finding_type?: string }[]): string {
  const 진짜 = (findings ?? []).filter((f) => isRealVulnerability(f));
  const 시연 = 진짜.filter((f) => 시연도구.test(String(f.source_tool ?? "")));
  if (시연.length === 0) return "";
  const 전부 = 시연.length === 진짜.length;
  return (
    `\n⚠ ${전부 ? "위 취약점은 전부" : `위 ${진짜.length}건 중 ${시연.length}건은`}` +
    ` 시연용으로 넣은 자료입니다 — 실제 스캔 결과가 아닙니다.`
  );
}

/**
 * 스캐너가 낸 것이지만 **취약점이 아닌 것**.
 *
 * ★ 실측(2026-08-01 하루 실전 115상황): 전체 finding 605건 중 **602건이 이것**이었다.
 *   그래서 "오늘 뭐부터 볼까?"의 상위 5건 중 4건이 스캔 오류였고, 화면에는
 *   "검토 대기 602건"이 떴다. 담당자는 밀린 일이 602건인 줄 알고 절망하는데
 *   **실제 일감은 3건**이다. 제품에서 가장 중요한 답이 8할 잡음이었다.
 *
 * 감추는 것이 아니다 — 스캔이 안 된 자산은 그 자체로 조치할 일이다(스캐너 설정·권한 문제).
 * 다만 **취약점 일감과 섞지 않는다.** 세는 자리를 나눈다.
 */
const SCAN_NOISE = new Set(["scan_error", "scan_not_supported"]);

function findingSummary(asset: Asset): string {
  const real = asset.findings.filter(isRealVulnerability);
  // ⚠ 뺀 것을 **어디로 갔는지** 갈라 적는다. 뭉뚱그리면 담당자가 "왜 숫자가 줄었지?" 한다.
  const scanErrors = asset.findings.filter((f) => SCAN_NOISE.has(String(f.finding_type ?? ""))).length;
  const 조사 = asset.findings.filter(
    (f) => !SCAN_NOISE.has(String(f.finding_type ?? "")) && String(f.severity ?? "").toLowerCase() === "info"
  ).length;
  // 스캔 실패는 감추지 않는다 — 취약점이 아니라고 말할 뿐이다. 감추면 "왜 결과가 없지?"가 된다.
  const errNote =
    (scanErrors ? ` · 스캔 실패 ${scanErrors}건(취약점 아님 — 재스캔 필요)` : "") +
    (조사 ? ` · 조사 정보 ${조사}건(취약점 아님 — 스캐너가 알아낸 사실)` : "");
  if (real.length === 0) return `finding 없음${errNote}`;
  const counts = SEVERITY_ORDER.map((s) => [s, real.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`)
    .join(", ");
  return `finding ${real.length}건 (${counts})${errNote}`;
}

/** 한 번에 보여 주는 자산 수. 넘으면 **잘랐다고 밝힌다.** */
const 보여줄자산 = 15;

/**
 * 자산 위험 등급 — **자산 화면·KPI와 같은 규칙**이다(kpi.ts riskCounts).
 * critical/high가 하나라도 있으면 고위험 · medium만 있으면 중위험 · 그 밖은 저위험.
 * ⚠ 여기서 제 나름대로 세면 화면은 「고위험 27」인데 대화창은 다른 수를 말하게 된다 —
 *   어긋난 두 숫자는 **둘 다** 못 믿게 만든다.
 */
function 자산위험등급(a: { findings: { severity: string }[] }): "high" | "medium" | "low" {
  const sev = new Set((a.findings ?? []).map((f) => f.severity));
  if (sev.has("critical") || sev.has("high")) return "high";
  if (sev.has("medium")) return "medium";
  return "low";
}

function runListAssets(args: Record<string, string> = {}): string {
  const all = listAssets();
  if (all.length === 0) return "등록된 AI 자산이 없습니다.";

  // ★ 2026-08-04 147상황: 「위험도 높은 자산 알려줘」가 **자산 한 건**을 답했다
  //   ("이 자산에서 발견된 1개 취약점은 낮은 심각도입니다" — 29자). 목록을 물었는데
  //   단건 도구로 갔다. 등급으로 좁히는 길을 아예 만들어 둔다.
  const 등급 = String(args.risk ?? "").trim().toLowerCase();
  if (등급 === "high" || 등급 === "medium" || 등급 === "low") {
    const 이름 = { high: "고위험", medium: "중위험", low: "저위험" }[등급]!;
    const 걸린것 = all.filter((a) => 자산위험등급(a) === 등급);
    if (!걸린것.length) {
      return `${이름} 자산이 없습니다 (전체 ${all.length}개). ` +
        `${표식.다음} 전체를 보시려면 "자산 목록 보여줘"라고 하세요.`;
    }
    // 심각한 것이 많은 순으로 — 같은 등급 안에서도 먼저 볼 것이 있다.
    const 센다 = (a: (typeof 걸린것)[number], s: string) => a.findings.filter((f) => f.severity === s).length;
    const 줄세움 = [...걸린것].sort((a, b) =>
      센다(b, "critical") - 센다(a, "critical") || 센다(b, "high") - 센다(a, "high"));
    const 보일것 = 줄세움.slice(0, 보여줄자산);
    return [
      `${이름} 자산 **${걸린것.length}개**` + (걸린것.length > 보일것.length ? ` — 아래는 ${보일것.length}개입니다` : ""),
      ...보일것.map((a) => {
        const c = 센다(a, "critical"), h = 센다(a, "high"), m = 센다(a, "medium");
        const 내역 = [c ? `매우 심각 ${c}` : "", h ? `높음 ${h}` : "", m ? `보통 ${m}` : ""].filter(Boolean).join(" · ");
        return `  - ${자산표시이름(a.id)}${a.owner ? ` (담당 ${a.owner})` : " (담당 미지정)"}${내역 ? ` — ${내역}` : ""}`;
      }),
      "",
      `${표식.다음} 하나를 깊이 보시려면 "○○ 자산 취약점 알려줘", 바로 손대시려면 "미배정 취약점 담당자 배정해줘"라고 하세요.`,
    ].join("\n");
  }

  // ⚠ 조건을 받고도 안 거르면 **방화벽을 물었는데 전체 57건**이 나온다(2026-08-02 실측).
  const q = String(args.query ?? "").trim();
  const tokens = q ? queryTokens(q) : [];
  // 걸리는 조건은 자산이걸린이유() 하나가 정한다 — 통합 검색과 갈리면 같은 말에 다른 답이 나온다.
  const 이유 = new Map<string, string>();
  const assets = q
    ? all.filter((a) => {
        const r = 자산이걸린이유(a, q, tokens);
        if (r === null) return false;
        if (r) 이유.set(a.id, r);
        return true;
      })
    : all;

  // ⚠ 못 찾았다고 **전체를 쏟지 않는다.** 조건을 흘려버리고 전부 주면 담당자는 그게 답인 줄 안다.
  if (assets.length === 0) {
    return `등록된 자산 ${all.length}개 중 "${q}"에 해당하는 것을 찾지 못했습니다. ` +
      `이름·유형·카테고리·서비스·구성요소와 **올린 점검 파일 이름**으로 찾습니다 — ` +
      `다른 말로 물어보시거나 "자산 목록"으로 전체를 보세요.`;
  }

  const 자름 = assets.length > 보여줄자산;
  // ⚠ 내부 id(`vuln:sample-web01`)를 앞세우지 않는다 — 사람이 읽는 글자가 아니다(2026-08-03 실측:
  //   자산 목록 답이 `- vuln:sample-web01` 로 시작했다). 이름으로 보여 주고, **이름으로도 찾히게**
  //   getAsset을 넓혔다 — 그러지 않으면 화면에서 본 이름으로 이어서 물을 수 없다.
  // 이름이 아닌 자리(호스트명·출처 파일)로 걸린 줄은 **왜 걸렸는지 적는다.**
  //   적지 않으면 담당자는 이름에 없는 말로 나온 줄을 오답으로 본다(brian 지적의 절반이 이것이다).
  const lines = assets.slice(0, 보여줄자산).map((a) => {
    const 왜 = 이유.get(a.id);
    return `- ${자산표시이름(a.id)} | 유형=${a.assetType} | 담당=${a.owner || "미지정"} | ${findingSummary(a)}` +
      (왜 ? ` | 걸린 이유=${왜}` : "");
  });
  const 머리 = q
    ? `"${q}" 자산 ${assets.length}개` + (자름 ? ` · 아래는 ${보여줄자산}개입니다` : "") + ":"
    : `등록된 AI 자산 ${assets.length}개` + (자름 ? ` · 아래는 ${보여줄자산}개입니다` : "") + ":";
  return [머리, ...lines].join("\n").slice(0, 2000);
}

// 자산 상세 — AI-BOM까지 한 번에 준다(예전엔 get_aibom을 따로 뒀는데, LLM이 "AI-BOM도 봐야 하나"를
// 매번 판단해야 해서 도구만 늘고 턴이 늘었다. 상세는 상세 하나로 충분하다).
async function runGetAsset(args: Record<string, string>): Promise<string> {
  const asset = getAsset(args.assetId);
  if (!asset) {
    // ⚠ 전부 늘어놓지 않는다(57개면 화면이 내부 id로 덮인다) — 몇 개만 보기로 주고 잘랐다고 밝힌다.
    //   그리고 **이름으로** 보여 준다. 담당자가 화면에서 본 글자가 이름이기 때문이다.
    const 전체 = listAssets();
    const 보기 = 전체.slice(0, 8).map((a) => 자산표시이름(a.id)).join(", ") || "(없음)";
    const 더 = 전체.length > 8 ? ` … 외 ${전체.length - 8}개` : "";
    return (
      `자산 "${args.assetId}"을(를) 찾지 못했습니다.
` +
      `등록된 자산 ${전체.length}개 중 몇 개: ${보기}${더}
` +
      `${표식.다음} 전체를 보시려면 "자산 목록 보여줘"`
    );
  }
  const top = asset.findings
    .slice()
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 5)
    .map((f) => `  ${심각도표식(f.severity)} [${심각도한글(f.severity)}] ${f.finding_type}: ${f.evidence.slice(0, 80)}`);
  const b = asset.aibom;
  const v = (s: string) => (s.trim() === "" ? "미기재" : s);
  const aibomLines = [
    `AI-BOM: 파운데이션=${v(b.model.foundationModel)} | 아키텍처=${v(b.model.architecture)} | 용도=${v(b.model.intendedUse)}`,
    `        데이터출처=${v(b.dataset.sources)} | 가드레일=${v(b.prompt.guardrails).slice(0, 40)} | 인프라=${v(b.infrastructure.compute)}`,
  ];
  // 온톨로지 연계: 이 자산의 유형·구성에 걸리는 위협·완화통제를 함께 준다(AI-BOM → 위협 흐름).
  const threats = ontologyLinesFor(`${asset.name} ${asset.assetType} ${b.model.foundationModel} ${b.model.architecture}`, 6);
  const 줄 = [
    `자산 ${asset.id} (${asset.name})`,
    `유형=${asset.assetType} | 담당=${asset.owner || "미지정"} | 서비스=${asset.service ?? "미지정"} | 경로=${asset.path}`,
    `마지막 스캔: ${asset.lastScannedAt ? koDateTimeString(asset.lastScannedAt) : "스캔 이력 없음"} | ${findingSummary(asset)}`,
    ...aibomLines,
    ...(top.length ? ["주요 finding(심각도순, 최대 5건):", ...top] : []),
    ...(threats.length ? ["사내 온톨로지가 아는 관련 위협·통제:", ...threats] : []),
  ];

  // ★ 자산 등록부에 **실제 취약점이 0건**이면 올려 둔 진단 보고서를 대신 읽는다.
  //
  // 실사고(2026-07-28~30 규명, 2026-08-02 재발 확인): "안전대부 웹서버 취약점 알려줘"에
  //   보고서에는 5건(평문 전송·디렉토리 인덱싱·임시/백업 파일 노출 등)이 적혀 있는데
  //   자산 DB는 스캔 실패 1건뿐이라 **"취약점 정보는 없습니다"**로 답했다. 근거가 사내에 있는데
  //   안 본 것이다. 2026-07-30 처방(발췌를 앞으로)은 **search 도구에만** 들어가 있었고,
  //   담당자가 자산을 지목해 물으면 이 경로로 새어 나갔다 — 같은 병을 두 곳에서 고쳐야 했다.
  //
  // ⚠ 프롬프트로 "문서도 봐라"라고 시키지 않는다. 이 크기 모델에 규칙을 더해 행동을 고치려는
  //   시도는 이 프로젝트에서 반복해 실패했다. **읽을 것을 앞에 둔다**(배치는 결정적이다).
  // ⚠ 스캔 실패(scan_error)는 취약점이 아니다 — isRealVulnerability로 거른 뒤 센다.
  const 진짜취약 = (asset.findings ?? []).filter(isRealVulnerability);
  if (진짜취약.length === 0) {
    try {
      // ★ 먼저 **이 자산에 이어 둔 보고서**를 찾는다(2026-08-02 신설).
      //   자산 이름으로 검색하면 문서 제목이 안 맞아 발췌가 안 붙는다 — 인입 때 적어 둔
      //   연결로 그 보고서만 정확히 꺼낸다. 느슨한 검색이 아니라서 무관한 문서가 안 섞인다.
      const { documentsForAsset } = await import("./memory.js");
      const 이어둔문서 = documentsForAsset(asset.id);
      const q = 이어둔문서.length
        ? `${이어둔문서[0].documentId} ${asset.name} 취약점`
        : `${asset.name} 취약점`;
      const rawChunks = await queryMemory(q, 5);
      const { sanitizeRagChunks } = await import("./ragsanitize.js");
      const chunks = sanitizeRagChunks(rawChunks.map(String), { source: "tool:get_asset", question: asset.name }).chunks;
      if (chunks.length) {
        return [
          "※ 자산 등록부에는 이 대상의 취약점이 아직 등록돼 있지 않습니다 — 아래 **사내 문서 근거**가 답입니다.",
          `사내 문서 근거(발췌) ${chunks.length}건:`,
          ...chunks.slice(0, 4).map((c) => `  · ${String(c).replace(/\s+/g, " ").slice(0, 600)}`),
          "",
          "(참고) 자산 등록부 정보:",
          ...줄,
        ].join("\n").slice(0, 3000);
      }
    } catch {
      /* 임베딩 미기동 — 등록부 정보만이라도 돌려준다 */
    }
  }
  return 줄.join("\n").slice(0, 2500);
}

// ── 온톨로지(지식 그래프)를 도구의 접착제로 ─────────────────────────────
// 위협→완화통제→보안제품→자산 관계는 이미 메뉴를 가로지른다. 이걸 도구 결과에 얹어
// LLM이 "메뉴를 더 뒤지지 않아도" 근거 있는 답을 하게 한다.
function ontologyLinesFor(text: string, limit: number): string[] {
  try {
    return expandOntology(text, undefined, { hops: 2, limit }).map(
      (t) => `  - ${t.subject} —[${t.predicate}]→ ${t.object}`
    );
  } catch {
    return []; // 온톨로지가 비어 있어도 도구는 계속 동작한다
  }
}

// explain — "이게 뭐야 / 어떤 위협이 걸려 / 우리 통제는?" 한 방에.
// 온톨로지 관계 + 사내 문서(업로드·자동분류된 장기기억) + 보유 보안제품을 가로질러 근거를 모은다.
async function runExplain(args: Record<string, string>): Promise<string> {
  const topic = args.topic.trim();
  const out: string[] = [];

  const triples = ontologyLinesFor(topic, 12);
  if (triples.length) out.push(`사내 온톨로지 관계 — "${topic}" 관련:`, ...triples);

  // 사내 문서 **본문**을 근거로 싣는다.
  // ⚠ 2026-07-26 QA에서 잡힌 결함: 예전에는 문서 "제목과 조각 수"만 돌려줬다.
  //   LLM이 받는 건 파일명뿐이라, 지식베이스에 답이 있어도(예: 유지보수 7항목 — 자원·HA·
  //   시그니처·백업·로그) 일반론으로 답했다. 근거 배지에는 그 문서가 떠서 더 헷갈렸다.
  //   제목만으로는 근거가 아니다 — 본문을 줘야 근거다.
  try {
    const raw = await queryMemoryRelevant(topic, 4);
    // 도구 결과도 그대로 프롬프트에 재주입된다 — 여기서도 문서에 숨은 지시문을 잘라낸다
    // (llm.ts ragContextFor와 같은 이유. 한 곳만 막으면 다른 경로로 그대로 들어온다).
    const { sanitizeRagChunks } = await import("./ragsanitize.js");
    const chunks = sanitizeRagChunks(raw, { source: "tool:explain", question: topic }).chunks;
    if (chunks.length) {
      out.push(
        `사내 문서 근거(발췌) ${chunks.length}건:`,
        ...chunks.slice(0, 3).map((c) => `  · ${String(c).replace(/\s+/g, " ").slice(0, 600)}`)
      );
    }
  } catch {
    /* 임베딩 미기동 등 — 본문 근거 없이 계속 */
  }

  // 어느 문서에서 왔는지도 함께(담당자가 원문을 찾아갈 수 있게).
  try {
    const docs = (await listVisibleDocuments()).filter((d) => matches(d.documentId, topic));
    if (docs.length) {
      out.push(
        `관련 사내 문서 ${docs.length}건:`,
        ...docs.slice(0, 5).map((d) => `  - ${d.documentId}${d.docClass ? ` [${d.docClass}]` : ""} (조각 ${d.chunks})`)
      );
    }
  } catch {
    /* 목록 조회 실패는 무시 */
  }

  // 보유 보안제품 중 관련된 것(대응 수단 제시).
  const products = listProducts().filter((p) => matches(`${p.name} ${p.category} ${p.vendor ?? ""}`, topic));
  if (products.length) {
    out.push(
      `보유 보안제품 ${products.length}건:`,
      ...products.slice(0, 5).map((p) => `  - ${p.name} (${p.category}${p.vendor ? `, ${p.vendor}` : ""})`)
    );
  }

  if (out.length === 0) {
    return `"${topic}"에 대해 사내 온톨로지·문서·보안제품 등록부에서 찾은 근거가 없습니다. 일반 지식으로만 답하거나, 관련 문서를 업로드하면 근거가 쌓입니다.`;
  }
  return out.join("\n").slice(0, 3500); // 본문 발췌가 들어가 상한을 늘렸다(2500이면 근거가 잘렸다)
}

/**
 * 7B는 도구 결과의 **앞부분을 답으로 삼는다**(실측 반복 확인).
 * 자산 DB가 비었는데 문서 발췌에 답이 있으면, 발췌를 앞으로 올린다.
 *
 * 실사고(2026-07-28~30): "안전대부 웹서버 취약점 알려줘"에 자산 DB는 0건인데 진단 보고서
 * 발췌에는 5건이 적혀 있었다. 발췌가 뒤에 있으니 모델이 앞의 "finding 없음"만 보고
 * **"취약점이 없는 것으로 판단됩니다"**라고 답했다. 근거를 찾아 놓고 안 읽은 셈이다.
 *
 * 프롬프트로 "뒤도 읽어라"라고 시키지 않는다 — 이 크기 모델에 규칙을 더해 행동을 교정하려는
 * 시도는 이 프로젝트에서 반복적으로 실패했다. 대신 **읽을 것을 앞에 둔다**(배치는 결정적이다).
 */
function orderForSmallModel(lines: string[]): string[] {
  const 발췌시작 = lines.findIndex((l) => l.startsWith("사내 문서 근거(발췌)"));
  if (발췌시작 < 0) return lines;
  // 자산 쪽이 "찾은 것이 없다"고 말하고 있는가 — 그때만 순서를 바꾼다.
  const 앞부분 = lines.slice(0, 발췌시작).join("\n");
  const 자산비었음 = /finding 없음/.test(앞부분) && !/취약점 \d+건\(우선순위순\)/.test(앞부분);
  if (!자산비었음) return lines;
  const 발췌 = lines.slice(발췌시작);
  const 나머지 = lines.slice(0, 발췌시작);
  return [
    "※ 자산 등록부에는 이 대상의 취약점이 아직 등록돼 있지 않습니다 — 아래 **사내 문서 근거**가 답입니다.",
    ...발췌,
    "",
    "(참고) 자산 등록부 정보:",
    ...나머지,
  ];
}

// 느슨한 부분일치 — 한국어는 형태소 분석 없이 공백 토큰화가 불안정해 정규화 후 부분문자열로 본다
// (온톨로지 expandOntology와 같은 전략).
function matches(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const n = norm(needle);
  return n.length >= 2 && norm(haystack).includes(n);
}

// LLM이 "A OR B"·"A와 B"처럼 여러 대상을 한 검색어로 합쳐 보내는 경우가 실측(2026-07-19)으로
// 관측됐다 — matches()는 단순 부분일치라 그 합쳐진 문자열 그대로는 아무것도 안 걸린다("oracle.local
// 10.10.20.15" 같은 자산은 없으므로). 도구 설명으로 나눠 부르라고 안내해도 작은 모델은 잘 안 지켜서,
// 결정적 규칙으로 분리한다(이 파일의 원칙: 판단은 규칙, LLM은 선택만).
const MULTI_QUERY_SPLIT_RE = /\s+(?:or|and)\s+|,|、|와\s+|과\s+|\|/gi;
function splitQueryTerms(q: string): string[] {
  const parts = q
    .split(MULTI_QUERY_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return parts.length > 1 ? parts : [q];
}

// [2026-07-28 회귀 하네스가 잡음] "안전대부 웹서버 취약점 알려줘"가 0건이었다.
// matches()는 공백만 지운 통 문자열 비교라 "안전대부웹서버취약점"을 통째로 찾는데,
// 자산 이름은 "안전대부 본인인증 웹 서버 (certify.aj-safe.co.kr)"라 안 걸린다.
// 호스트명을 정확히 친 사람만 답을 받고, 조직 이름으로 물은 담당자는 문서 요약만 받았다.
// → 통 문자열이 0건이면 **낱말 단위 AND**로 한 번 더 본다. 이때 "취약점·알려줘" 같은
//   조회 의도어는 대상이 아니므로 뺀다(안 빼면 AND가 절대 안 맞는다).
const QUERY_STOPWORD_RE =
  /^(취약점|취약|점검|목록|리스트|현황|상태|전부|모두|알려줘|알려|보여줘|보여|확인|조회|정보|내역|결과|있어|있나|뭐|뭐야|해줘|주세요)$/;
function queryTokens(q: string): string[] {
  return q
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && !QUERY_STOPWORD_RE.test(s));
}
/** 통 문자열이 안 걸리면 낱말 전부가 들어 있는지로 한 번 더 본다(둘 다 아니면 미매칭). */
function matchesLoose(haystack: string, q: string, tokens: string[]): boolean {
  if (matches(haystack, q)) return true;
  return tokens.length > 0 && tokens.every((t) => matches(haystack, t));
}

/**
 * 자산 하나가 검색어에 걸리는가 — **한 곳에서만 정한다.**
 *
 * ★ 왜(실사용자 brian의 지적, 2026-07-31 → 2026-08-03 처리): "자산 목록에서 서버이름이
 *   oracle 찾아줘"에 엉뚱한 자산 2건을 답했다. 오라클 서버는 **등록부에 있었다** —
 *   `192.168.219.98`, 출처 `Oracle Server Scan.nessus`, Oracle Database 취약점이 가득하다.
 *   못 찾은 이유는 그 자산의 **이름이 IP뿐이고 hostname이 비어 있어서**다. 스캐너가 이름을
 *   안 준 자산은 담당자가 부르는 말("오라클 서버")과 등록부에 적힌 말(IP)이 영영 어긋난다.
 *   그래서 **출처 파일명까지 본다** — 담당자가 그 파일을 올렸으니 그 말은 담당자의 말이다.
 *
 * ⚠ 취약점 본문(finding_type)은 **일부러 안 본다.** 넣으면 "Log4j 찾아줘"에 자산 수십 대가
 *   쏟아져 목록이 뜻을 잃는다. 소프트웨어로 찾는 것은 취약점 검색이 할 일이다.
 *
 * 돌려주는 값: null=안 걸림 · ""=이름·유형처럼 **보면 아는 자리**에서 걸림 · 그 밖=걸린 이유.
 *   이유가 있으면 **답에 적는다.** 왜 나왔는지 모르는 줄은 담당자가 못 믿는다.
 */
export function 자산이걸린이유(a: Asset, q: string, tokens: string[]): string | null {
  if (
    matchesLoose(a.name, q, tokens) ||
    matchesLoose(a.assetType, q, tokens) ||
    matchesLoose(a.id, q, tokens) ||
    matchesLoose(a.category ?? "", q, tokens) ||
    matchesLoose(a.service ?? "", q, tokens) ||
    a.components.some((c) => matchesLoose(c.name, q, tokens))
  ) {
    return "";
  }
  // ⚠ hostname은 **따로 보지 않는다.** 저장하는 곳이 없고 `name`에서 유도만 하므로
  //   (assets.ts deriveHostIp), hostname으로 걸리는 것은 이미 name으로 걸린다.
  //   가지를 두면 "호스트명으로도 찾습니다"라고 말해 놓고 실제로는 안 타는 죽은 코드가 된다.
  const 출처 = sourceFileOf(a);
  if (출처 && matchesLoose(출처, q, tokens)) return `출처 ${출처}`;
  return null;
}

/**
 * 이 **자산을 다룬** 사내 문서에서 취약점 대목을 발췌한다.
 *
 * 왜(실사고 2026-07-28 → 원인 규명 2026-08-02):
 *   "안전대부 웹서버 취약점 알려줘"에 "finding 없음 · 스캔 실패 1건"이라고 답했다. 그런데
 *   같은 서버의 **웹 취약점 진단 보고서**가 지식에 31조각으로 들어 있었고 거기엔 평문 전송·
 *   디렉토리 인덱싱 등 5건이 적혀 있었다. 담당자가 이 답으로 "취약점 없음"이라고 보고하면
 *   그것이 사고다.
 *   원인은 **같은 질문에 잣대가 둘**이었던 것 — 자산은 낱말 하나만 걸려도 찾는데(이름에
 *   "웹 서버"가 있다) 문서는 질문 문자열이 제목에 들어 있어야 찾았다(제목은 "웹취약점"이라
 *   낱말이 어긋난다). 그래서 질문이 아니라 **찾은 자산으로** 문서를 다시 찾는다.
 *
 * ⚠ 아무 발췌나 싣지 않는다. 가져온 조각이 **그 자산을 실제로 가리키는지**(호스트명이나 자산
 *   이름의 고유 낱말이 그 안에 있는지) 확인한 것만 남긴다 — 확인 못 한 문장을 자산 취약점으로
 *   보여 주는 것은 없느니만 못하다.
 */
async function 자산문서발췌(a: { id: string; name: string }): Promise<{ 문서: string; 줄: string[] } | null> {
  try {
    // ★ 먼저 **인입 때 이어 둔 문서**를 본다(2026-08-04). get_asset은 이미 이 길을 쓰는데
    //   여기만 낱말 검색이었다 — 같은 일을 두 잣대로 하면 한쪽이 반드시 샌다.
    const { documentsForAsset } = await import("./memory.js");
    const 이어둔 = documentsForAsset(a.id).map((d) => d.documentId);

    // 이 자산을 가리키는 표식 — 호스트명(가장 확실)과 이름 속 고유 낱말.
    const host = a.id.replace(/^[a-z]+:/, "").trim();
    const 일반어 = /^(웹|서버|웹서버|시스템|서비스|운영|테스트|개발|본인|인증|사이트|호스트)$/;
    const 고유낱말 = a.name
      .replace(/\([^)]*\)/g, " ")
      .split(/[\s·,()]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && !일반어.test(s) && !제품이름인가(s));
    const 표식 = [host, ...고유낱말].filter((s) => s.length >= 3);
    if (!표식.length && !이어둔.length) return null;

    const raw = await queryMemoryScored(`${a.name} ${host} 취약점 점검 결과`, 6);
    const { sanitizeRagChunks } = await import("./ragsanitize.js");
    const 후보 = raw.filter((c) => 자산점검문서인가(c.documentId, 이어둔));
    if (!후보.length) return null;

    // ⚠ sanitizeRagChunks는 조각을 **버릴 수 있다**(지시문뿐인 조각). 한꺼번에 넣고 인덱스로
    //   문서 이름을 되찾으면 어긋난다 — 한 조각씩 살균해 문서 이름을 붙여 다니게 한다.
    const 확인된: { 문서: string; 글: string }[] = [];
    for (const c of 후보) {
      const 살균 = sanitizeRagChunks([c.text], { source: "tool:search-asset-doc", question: a.name }).chunks;
      if (!살균.length) continue;
      const 글 = String(살균[0]).replace(/\s+/g, " ").trim();
      // 이어 둔 문서는 인입 때 확인된 연결이라 그대로 믿는다. 그 밖에는 자산이 실제로 나와야 한다.
      const 믿을만 = 이어둔.includes(c.documentId ?? "") || 표식.some((m) => 글.toLowerCase().includes(m.toLowerCase()));
      if (믿을만) 확인된.push({ 문서: c.documentId || "사내 문서", 글 });
    }
    if (!확인된.length) return null;
    const 문서 = 확인된[0].문서;
    // ⚠ 600자×3=1,800자를 그대로 실어 답이 2,561자가 된 적이 있다(2026-08-04 147상황).
    //   담당자는 2,000자를 안 읽는다 — 발췌는 **어느 문서에 있다**를 알리는 몫까지만 한다.
    return { 문서, 줄: 확인된.slice(0, 2).map(({ 글 }) => `      · ${글.slice(0, 300)}${글.length > 300 ? "…" : ""}`) };
  } catch {
    return null;   // 임베딩 미기동 등 — 없는 대로 둔다(지어내지 않는다)
  }
}

/**
 * 우리 제품 이름은 **자산을 가리키는 표식이 될 수 없다**.
 *
 * 실사고(2026-08-04 147상황): 자산 "GIJO AS 서버(로컬)"의 이름에서 고유 낱말을 뽑으면
 * "GIJO" 하나가 남는다. 그런데 우리 사내 문서는 전부 `GIJO_AS_…`라 **설계 문서·아키텍처
 * 문서·취약점관리 지침이 전부 이 자산의 「점검 보고서」로 걸렸다.** 「SSH 취약점 찾아줘」
 * 답이 2,561자가 되고 그중 1,800자가 우리 제품 소개였다.
 */
function 제품이름인가(낱말: string): boolean {
  return /^(gijo|gijoas|기조|커넥트|connect)$/i.test(낱말.replace(/[_\-\s]/g, ""));
}

/**
 * 이 문서가 **자산의 점검 결과**일 수 있는가.
 *
 * 우리가 쓴 제품 문서(GIJO_AS_*.md — 지침·가이드·아키텍처)는 어느 자산의 점검 보고서도
 * 아니다. 낱말이 우연히 걸렸다고 "이 자산이 사내 점검 보고서에 적혀 있습니다"라고 말하면
 * **없는 취약점을 있다고 보고하게 만든다.** 이어 둔 문서는 인입 때 확인된 연결이라 통과.
 */
function 자산점검문서인가(documentId: string | undefined, 이어둔: string[]): boolean {
  const id = String(documentId ?? "");
  if (!id) return false;
  if (이어둔.includes(id)) return true;
  return !/^GIJO[_\s-]?AS[_\s-]/i.test(id);
}

async function searchOne(q: string): Promise<string[]> {
  const out: string[] = [];
  const tokens = queryTokens(q);

  // 걸리는 조건은 목록 조회와 **같은 함수**를 쓴다(자산이걸린이유). 갈리면 "자산 목록에서 찾아줘"와
  // "oracle 찾아줘"가 서로 다른 답을 낸다 — 담당자는 둘 다 안 믿게 된다.
  const 이유 = new Map<string, string>();
  const assets = listAssets().filter((a) => {
    const r = 자산이걸린이유(a, q, tokens);
    if (r === null) return false;
    if (r) 이유.set(a.id, r);
    return true;
  });
  if (assets.length) {
    // ⚠ 내부 id를 앞세우지 않는다 — 사람이 읽는 글자가 아니다(2026-08-03 말투 규범).
    out.push(`AI 자산 ${assets.length}건:`, ...assets.slice(0, 6).map(
      (a) => `  - ${자산표시이름(a.id)} | ${a.assetType} | ${findingSummary(a)}` +
        (이유.get(a.id) ? ` | 걸린 이유=${이유.get(a.id)}` : "")
    ));
    // 대상이 좁혀졌으면 취약점 **이름**까지 준다(2026-07-28 실측).
    // 건수만 주면 LLM은 아는 만큼만 말해 "medium 1건, low 2건"으로 끝난다 — 담당자가 알고 싶은 건
    // "무엇이" 취약한가다. 아래 취약점 섹션은 우선순위 상위 100건만 보므로 낮은 위험은 거기서 샌다.
    for (const a of assets.slice(0, 3)) {
      // scan_error는 취약점 목록에 넣지 않는다(위 isRealVulnerability 주석 참고).
      const real = a.findings.filter(isRealVulnerability);
      if (!real.length) continue;
      out.push(
        `  · ${a.name} 취약점 ${real.length}건:`,
        ...real.slice(0, 8).map((f) => `      ${심각도표식(f.severity)} [${심각도한글(f.severity)}] ${f.finding_type}`)
      );
    }
    // 자산은 찾았는데 **그 자산의 취약점이 하나도 없을 때**, 그 자산을 다룬 사내 문서를 찾아 붙인다.
    // ⚠ **대상이 좁혀졌을 때만** 한다. "자산 목록 보여줘"처럼 다 걸리는 질문에서 앞의 두 자산만
    //   골라 보고서를 붙이면, 하필 그 둘만 자세한 이상한 답이 된다. 지금 운영 데이터는 자산의
    //   대부분이 스캔 실패뿐이라(609건 중 608건) 이 가지를 안 막으면 거의 항상 탄다.
    for (const a of (assets.length <= 3 ? assets : [])) {
      if (a.findings.some(isRealVulnerability)) continue;   // DB에 있으면 문서를 뒤질 이유가 없다
      const 발췌 = await 자산문서발췌(a);
      if (발췌) {
        // ⚠ "사내 점검 보고서"라고 **단정하지 않는다** — 어느 문서인지 밝힌다(2026-08-04).
        //   문서 이름을 안 밝히면 담당자가 근거를 확인할 방법이 없고, 우리 제품 문서가
        //   남의 점검 보고서로 둔갑해도 알아채지 못한다.
        out.push(`  · ${a.name} — 자산 등록부엔 취약점이 없지만 「${발췌.문서}」에 이런 대목이 있습니다:`, ...발췌.줄);
      }
    }
  }

  // 취약점 — 전 자산을 가로질러 우선순위 상위에서 찾는다(자산별로 뒤지지 않아도 되게).
  const vulns = prioritizedReviews(100).filter(
    (r) =>
      isRealVulnerability(r.finding) && // 스캔 실패는 취약점 목록에 넣지 않는다
      (matchesLoose(r.finding.finding_type, q, tokens) ||
        matchesLoose(r.finding.evidence, q, tokens) ||
        matchesLoose(r.assetName, q, tokens))
  );
  if (vulns.length) {
    // ⚠ 예전에는 `@ 웹 서비스(id=web-01)`처럼 id를 함께 실었다 — "LLM이 이어서 get_asset을
    //   부를 수 있게"가 이유였는데, 그 글자가 **담당자 화면에 그대로 나갔다**(2026-08-03 실측).
    //   이제 getAsset이 **이름으로도 찾으므로**(assets.ts) id를 실을 이유가 없다.
    //   영문 심각도도 우리말로 바꾼다 — 한글 제품에서 못 읽는다.
    out.push(
      `취약점 ${vulns.length}건(우선순위순):`,
      ...vulns.slice(0, 6).map((r) =>
        `  ${심각도표식(r.finding.severity)} [${심각도한글(r.finding.severity)}] ${r.finding.finding_type} @ ${r.assetName || 자산표시이름(r.assetId)}` +
        한줄풀이글(r.finding.finding_type) +
        ` — 점수 ${r.score}${r.assignee ? `, 담당 ${r.assignee}` : ""}${r.overdue ? " ⚠지연" : ""}`)
    );
  }

  const products = listProducts().filter((p) => matchesLoose(`${p.name} ${p.category} ${p.vendor ?? ""}`, q, tokens));
  if (products.length) {
    out.push(`보안제품 ${products.length}건:`, ...products.slice(0, 5).map((p) => `  - ${p.name} (${p.category})`));
  }

  // 사내 문서는 **본문 발췌까지** 싣는다.
  // ⚠ 2026-07-26에 runExplain에서 똑같은 결함을 잡아 고쳤는데(제목만 주면 LLM이 근거를 못 읽어
  //   일반론으로 답한다) 이 도구에는 적용되지 않아 남아 있었다. 실사고(2026-07-28 회귀):
  //   "안전대부 웹서버 취약점 알려줘" → 자산 DB의 finding은 scan_error 1건뿐이라
  //   **"취약점 1건"**이라고 답했다. 정작 같은 답변에 이름이 실린 진단 보고서에는 5건이
  //   적혀 있었다(평문 전송·디렉토리 인덱싱 등). 근거 문서를 찾아 놓고 제목만 읽은 셈이다.
  //   숫자가 틀린 답은 없느니만 못하다 — 담당자가 그 숫자로 보고를 쓴다.
  try {
    const docs = (await listVisibleDocuments()).filter((d) => matches(d.documentId, q));
    if (docs.length) {
      out.push(`사내 문서 ${docs.length}건:`, ...docs.slice(0, 5).map((d) => `  - ${d.documentId}${d.docClass ? ` [${d.docClass}]` : ""}`));
      try {
        // ⚠ queryMemoryRelevant(거리 임계값)가 아니라 queryMemory를 쓴다.
        //   임계값 버전은 같은 질문에 4건 중 1건만 남겼고, 하필 남은 하나가 표지·목차
        //   조각이었다(실측 2026-07-28) — 정작 필요한 "평문 전송·디렉토리 인덱싱" 대목이
        //   잘려 나가 답이 그대로 틀렸다.
        //   여기는 **문서 제목이 질문과 맞는 것을 이미 확인한 뒤**(위 docs.length) 그 안을
        //   발췌하는 자리다. 문을 한 번 통과했는데 절대 거리로 또 거를 이유가 없다.
        //   memory.ts도 이 함수를 "문서 검색 화면·도구용"이라고 못박아 두었다.
        const rawChunks = await queryMemory(q, 5);
        const { sanitizeRagChunks } = await import("./ragsanitize.js");
        const chunks = sanitizeRagChunks(rawChunks.map(String), { source: "tool:search", question: q }).chunks;
        if (chunks.length) {
          out.push(
            `사내 문서 근거(발췌) ${chunks.length}건:`,
            ...chunks.slice(0, 4).map((c) => `  · ${String(c).replace(/\s+/g, " ").slice(0, 600)}`)
          );
        }
      } catch {
        /* 임베딩 미기동 — 발췌 없이 제목만이라도 남긴다 */
      }
    }
  } catch {
    /* 임베딩 미기동 — 문서 검색 생략 */
  }

  const triples = ontologyLinesFor(q, 6);
  if (triples.length) out.push("온톨로지 관계:", ...triples);

  // 자산 DB가 비었는데 문서 발췌에 답이 있으면 발췌를 앞으로 — 7B는 앞부분을 답으로 삼는다.
  return orderForSmallModel(out);
}

// search — 메뉴를 가로지르는 단일 검색. LLM이 "어느 메뉴를 봐야 하나"를 풀지 않아도 되게 한다.
// 0건일 때 붙이는 머리말. 이걸로 시작하는 결과는 LLM 재작성 없이 그대로 나간다(agentloop) —
// "못 찾았다"를 "존재하지 않는다"로 부풀려 답하던 사고(2026-07-26)를 구조적으로 막는다.
export const NO_HIT_PREFIX = "🔎 찾지 못했습니다 —";

function noHitMessage(q: string): string {
  const lines = [`${NO_HIT_PREFIX} "${q}"로는 결과가 없습니다.`, `(등록된 게 없다는 뜻이 아니라, 이 말로는 못 찾았다는 뜻입니다.)`];
  const cands = suggestionsFor(q);
  if (cands.length) {
    lines.push("", "혹시 이걸 찾으시나요?");
    for (const c of cands) lines.push(`  · ${c.hint}  →  "${c.canonical} 목록" 이라고 말해보세요`);
  } else {
    lines.push("", "찾는 대상의 이름·분류를 조금 더 알려주시면 다시 찾아보겠습니다.");
  }
  return lines.join("\n");
}

// 법령·판례 조회 — 원문 링크와 면책을 반드시 함께 준다(lawinfo.ts가 형식을 만든다).
async function runLawLookup(args: Record<string, string>): Promise<string> {
  const t = (args.target || "law").trim() as LawTarget;
  const target = (["law", "admrul", "prec"] as const).includes(t as never) ? t : "law";
  try {
    return await lawAnswer(args.query.trim(), target);
  } catch (e) {
    // 꺼져 있거나 외부가 막힌 상황은 담당자가 조치할 수 있게 그대로 알린다(조용히 실패 금지).
    return `법령 조회를 하지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function runSearch(args: Record<string, string>): Promise<string> {
  const q = args.query.trim();
  const terms = splitQueryTerms(q);

  if (terms.length === 1) {
    const out = await searchOne(terms[0]);
    if (out.length === 0) {
      // 같은 것을 가리키는 다른 말일 수 있다 — 표준 말로 바꿔 한 번 더 찾아본다.
      const canon = canonicalize(terms[0]);
      if (canon !== terms[0]) {
        const retry = await searchOne(canon);
        if (retry.length) {
          return [`"${terms[0]}"는 이 제품에서 "${canon}"이라고 부릅니다 — 그걸로 찾은 결과입니다.`, ...retry]
            .join("\n").slice(0, 2500);
        }
      }
      return noHitMessage(q);
    }
    return out.join("\n").slice(0, 2500);
  }

  // 여러 대상 — 대상별로 각각 찾아 이름표를 붙여 묶는다(비교 질문에서 한쪽이 누락되지 않도록).
  const blocks: string[] = [];
  for (const term of terms) {
    const out = await searchOne(term);
    blocks.push(`■ "${term}"`, ...(out.length ? out : [`  해당하는 자산·취약점·보안제품·문서·온톨로지 관계를 찾지 못했습니다.`]));
  }
  return blocks.join("\n").slice(0, 3500);
}

// today — "오늘 뭐부터?" 한 방에. KEV/EPSS/VPR 점수로 전 자산을 가로질러 정렬한 조치 우선순위.
function runToday(args: Record<string, string>): string {
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
  const top = prioritizedReviews(limit);
  if (top.length === 0) return "지금 조치할 취약점이 없습니다. (오탐 판정·조치완료 제외)";
  const lines = top.map((r, i) => {
    const f = r.finding;
    const tags = [
      f.kev ? "KEV(실제악용)" : null,
      f.epss != null ? `EPSS ${f.epss}` : null,
      f.vpr != null ? `VPR ${f.vpr}` : null,
    ].filter(Boolean).join(" · ");
    // ⚠ **제품에서 가장 많이 쓰는 답**이다 — 여기 글자가 곧 담당자가 매일 보는 글자다.
    //   예전에는 `[critical] … @ 이름(id=vuln:10.10.20.41)`이었다: 영문 상태값과 내부 키 둘 다
    //   말투 규범이 금지한 것이고, 실제로 담당자 화면에 그대로 나갔다(2026-08-03 실측).
    //   id는 "LLM이 이어서 get_asset을 부를 수 있게" 실었는데, 이제 **이름으로도 찾으므로**
    //   실을 이유가 없다(assets.ts getAsset).
    return `${i + 1}. ${심각도표식(f.severity)} [${심각도한글(f.severity)}] ${f.finding_type} @ ${r.assetName || 자산표시이름(r.assetId)}${tags ? ` — ${tags}` : ""}${r.assignee ? ` | 담당 ${r.assignee}` : " | 담당 미지정"}${r.dueDate ? ` | 기한 ${r.dueDate}` : ""}${r.overdue ? ` ${표식.주의}기한초과` : ""}`;
  });
  const overdue = top.filter((r) => r.overdue).length;
  return [
    `오늘 조치 우선순위 상위 ${top.length}건 (KEV→EPSS→VPR 순):`,
    ...lines,
    overdue ? `⚠ 기한 초과 ${overdue}건 포함` : "",
    시연데이터알림(top.map((r) => r.finding)),
    다음걸음("조치·승인 화면에서 담당자·기한을 배정하거나, 여기서 \"1번 담당자 배정해줘\"라고 말해도 됩니다."),
  ].filter(Boolean).join("\n").slice(0, 2500);
}

/**
 * 목록 끝에 붙이는 **다음 걸음** 한 줄.
 *
 * 왜 필요한가(2026-08-01 하루 실전 115상황): 숫자와 목록은 잘 나오는데 담당자에게
 * "그래서 뭘 하지"가 남았다. 특히 "오늘 뭐부터 볼까?"는 제품에서 가장 많이 쓰는 답인데,
 * 우선순위만 보여 주고 조치하러 갈 길을 안 알려 준다.
 *
 * ⚠ 한 줄이다. 답마다 안내를 세 줄씩 붙이면 그게 새 잡음이 된다 —
 *   **다음 행동이 분명한 목록에만** 붙인다.
 */
function 다음걸음(말: string): string {
  return `\n▸ 다음: ${말}`;
}

// threats — "요즘 위협 있어? / 새로 뜬 거 우리랑 관련?" 한 방에. 위협 인텔리전스(CTI) 피드의
// 최신 탐지와 사내 자산 신호(이름·컴포넌트·AI-BOM·CVE)의 교집합을 준다. 위협×자산은 이미 메뉴를
// 가로지르므로(domain=cross) 의도 축 도구로 딱 맞는다 — 매칭 계산은 기존 순수함수를 그대로 쓴다.
const CTI_SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

async function runThreats(args: Record<string, string>): Promise<string> {
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
  let findings;
  try {
    findings = await listCtiFindings();
  } catch {
    return "위협 인텔리전스(CTI) 피드를 조회하지 못했습니다.";
  }
  if (findings.length === 0) {
    return "CTI 피드에 새로 탐지된 위협이 없습니다. (피드 미연동 시 위협 인텔리전스 화면에서 API 키를 설정하세요.)";
  }
  const { matches, summary } = matchCtiToAssets(findings, listAssets());
  if (matches.length === 0) {
    return `최신 위협 ${summary.totalFindings}건을 확인했지만, 우리 자산 신호와 겹치는 것은 없습니다.`;
  }
  const top = matches
    .slice()
    .sort((a, b) => (CTI_SEV_ORDER[a.finding.severity] ?? 3) - (CTI_SEV_ORDER[b.finding.severity] ?? 3))
    .slice(0, limit);
  // ⚠ 예전에는 여기에 `이름(id=…)`과 `[critical]`을 그대로 실어 LLM이 파고들게 했다.
  //   그 답이 **담당자 화면에 그대로 나갔다**(2026-08-03 실전 147상황 실측: 30.5초 + 영문 상태값).
  //   내부 식별자와 영문 상태값은 사람이 읽는 글자가 아니다 — 말투 규범이 금지하는 둘이다.
  //   **사람이 읽을 답으로 만들고 즉답으로 돌린다**(재작성 20~30초를 안 쓴다).
  const 심각도말 = (s: string) => (s === "critical" ? "심각" : s === "warning" ? "경고" : "참고");
  const 표 = (s: string) => (s === "critical" ? 표식.위험 : s === "warning" ? 표식.주의 : "·");
  const lines = top.map((m) => {
    const hit = m.matchedAssets.map((a) => a.assetName).join(", ");
    return `${표(m.finding.severity)} [${심각도말(m.finding.severity)}] ${m.finding.type} — ${m.finding.target} → 우리 자산: ${hit} (출처 ${m.finding.source})`;
  });
  const 잘림 =
    matches.length > top.length ? ` · 아래는 심각한 순 ${top.length}건입니다` : "";
  return [
    `최신 위협 ${summary.totalFindings}건 중 우리 자산에 걸리는 것 ${summary.matchedFindings}건` +
      ` (영향 자산 ${summary.affectedAssets}개 · 심각·경고 ${summary.criticalMatches}건)${잘림}`,
    ...lines,
    `\n${표식.다음} 이어서 — 자산 하나를 파고들려면 "○○ 자산 취약점 알려줘"`,
  ].join("\n").slice(0, 2500);
}

// #5 조치 절차 — "이거 어떻게 조치해?"에 완화통제·보안제품·매뉴얼 근거로 답한다.
// explain(개념 설명)과 구분: 여기는 "무엇을 해야 하나"(대응 수단·절차 근거)에 초점.
async function runRemediation(args: Record<string, string>): Promise<string> {
  const topic = (args.topic ?? "").trim();
  const out: string[] = [];
  const controls = ontologyLinesFor(topic, 10);
  if (controls.length) out.push(`사내 온톨로지 — "${topic}" 관련 완화통제·관계:`, ...controls);
  const products = listProducts().filter((p) => matches(`${p.name} ${p.category} ${p.vendor ?? ""}`, topic));
  if (products.length) {
    out.push("대응에 쓸 수 있는 보유 보안제품:", ...products.slice(0, 5).map((p) => `  - ${p.name} (${p.category}${p.vendor ? `, ${p.vendor}` : ""})`));
  }
  try {
    const docs = (await listVisibleDocuments()).filter((d) => matches(d.documentId, topic));
    if (docs.length) out.push("참고할 사내 매뉴얼·문서(조치 절차 근거):", ...docs.slice(0, 5).map((d) => `  - ${d.documentId}${d.docClass ? ` [${d.docClass}]` : ""}`));
  } catch {
    /* 임베딩 미기동 — 문서 근거 없이 계속 */
  }
  if (out.length === 0) {
    return `"${topic}"에 대한 사내 완화통제·보안제품·매뉴얼 근거를 찾지 못했습니다. 일반적 조치는 최신 패치 적용·설정 강화·접근통제이며, 관련 매뉴얼을 올리면 구체 절차가 쌓입니다.`;
  }
  return out.join("\n").slice(0, 2500);
}

// #6 재스캔 서사 — "지난 스캔 대비 뭐가 바뀌었어?"에 상태(신규·활성·해결·재발) 분포로 답한다.
// 취약점 스캐너 자산의 finding.state(재스캔 자동 판정)를 그대로 집계한다.
function runScanStatus(args: Record<string, string>): string {
  const assets = args.assetId?.trim() ? [resolveAsset(args.assetId)].filter((a): a is Asset => !!a) : listAssets();
  const counts: Record<string, number> = { new: 0, active: 0, fixed: 0, resurfaced: 0, unknown: 0 };
  const fixedList: string[] = [];
  for (const a of assets) {
    for (const f of a.findings) {
      const st = f.state ?? "unknown";
      counts[st] = (counts[st] ?? 0) + 1;
      if (st === "fixed") fixedList.push(`${자산표시이름(a.id)} [${심각도한글(f.severity)}] ${f.finding_type}`);
    }
  }
  const total = Object.values(counts).reduce((x, y) => x + y, 0);
  if (total === 0) return "스캔된 취약점이 없습니다. (취약점 관리에서 스캔 결과를 업로드하세요.)";
  // **언제 들어온 것인가** — 실측(2026-08-03 실전 147상황): "스캔 결과 언제 들어온 거야?"에
  //   30초를 쓰고 "이 자산에서 발견된 1개 취약점 중…"이라고 답했다. **언제를 물었는데 무엇을 답했다.**
  //   숫자가 언제 것인지 모르면 그 숫자로 보고를 쓸 수 없다.
  // ⚠ 못 구하면 비운다 — 0이나 오늘로 채우면 "방금 본 것"이라는 거짓이 된다.
  const 시각들 = assets.map((a) => a.lastScannedAt).filter((t): t is number => typeof t === "number" && t > 0);
  const 신선도 = (() => {
    if (시각들.length === 0) return "· 반입 시각을 기록한 자산이 없습니다 — 언제 것인지 알 수 없습니다.";
    const 최근 = Math.max(...시각들);
    const 가장오래 = Math.min(...시각들);
    const 며칠 = (t: number) => Math.floor((Date.now() - t) / 86400000);
    const 날 = (t: number) => new Date(t).toLocaleDateString("ko-KR");
    const 안본자산 = assets.length - 시각들.length;
    return (
      `· 가장 최근 반입 ${날(최근)} (${며칠(최근) === 0 ? "오늘" : `${며칠(최근)}일 전`})` +
      ` · 가장 오래된 것 ${날(가장오래)} (${며칠(가장오래)}일 전)` +
      (안본자산 > 0 ? ` · 반입 기록이 없는 자산 ${안본자산}건` : "")
    );
  })();

  const parts = [
    `재스캔 기준 상태 (총 ${total}건): 신규 ${counts.new} · 활성 ${counts.active} · 해결 ${counts.fixed} · 재발 ${counts.resurfaced}`,
    신선도,
  ];
  if (fixedList.length) parts.push(`해결(fixed)로 판정된 ${fixedList.length}건 — 조치완료 확정 후보:`, ...fixedList.slice(0, 8).map((x) => `  - ${x}`));
  if (counts.resurfaced) parts.push(`⚠ 재발 ${counts.resurfaced}건 — 조치 후 다시 나타남, 재확인 필요`);
  return parts.join("\n").slice(0, 2500);
}

// 레드팀(프롬프트 인젝션·탈옥) 점검을 자산이 연결한 로컬 모델에 실제로 실행한다 — 14개 표준 공격
// 페이로드 × LLM 호출이라 시간이 걸리지만, 판단을 바꾸는 게 아니라 측정값을 기록할 뿐이라
// redteam.html의 "점검 실행" 버튼과 같은 신뢰 수준으로 승인 없이(write:false) 실행한다.
// 읽기 도구라 실패는 throw가 아니라 문자열로 돌려준다(LLM이 사유를 그대로 사람에게 설명).
async function runRunRedteam(args: Record<string, string>): Promise<string> {
  const asset = resolveAsset(args.assetId ?? "");
  if (!asset) {
    // ⚠ 전부 늘어놓지 않는다(57개면 화면이 내부 id로 덮인다) — 몇 개만 보기로 주고 잘랐다고 밝힌다.
    //   그리고 **이름으로** 보여 준다. 담당자가 화면에서 본 글자가 이름이기 때문이다.
    const 전체 = listAssets();
    const 보기 = 전체.slice(0, 8).map((a) => 자산표시이름(a.id)).join(", ") || "(없음)";
    const 더 = 전체.length > 8 ? ` … 외 ${전체.length - 8}개` : "";
    return (
      `자산 "${args.assetId}"을(를) 찾지 못했습니다.
` +
      `등록된 자산 ${전체.length}개 중 몇 개: ${보기}${더}
` +
      `${표식.다음} 전체를 보시려면 "자산 목록 보여줘"`
    );
  }
  const modelId = asset.aibom?.model?.modelRef;
  if (!modelId) {
    return `${asset.name}(${asset.id})에는 연결된 로컬 모델(AI-BOM modelRef)이 없어 레드팀 점검을 할 수 없습니다 — AI/LLM 자산만 점검 대상입니다.`;
  }
  const report = await runRedTeam(makeServedCaller(modelId), asset.name);
  setAssetRobustness(asset.id, { score: report.robustnessScore, vulnerable: report.vulnerable, total: report.total, ranAt: report.ranAt, modelId });
  const worst = Object.entries(report.byCategory)
    .filter(([, c]) => c.vulnerable > 0)
    .sort((a, b) => b[1].vulnerable - a[1].vulnerable)[0];
  const vulnList = report.results.filter((r) => r.vulnerable).slice(0, 5).map((r) => `  ${심각도표식(r.severity)} [${심각도한글(r.severity)}] ${r.desc} (${r.basis})`);
  return [
    `${asset.name} 레드팀 점검 완료 — 견고성 ${report.robustnessScore}점 (${report.total - report.vulnerable}/${report.total} 방어 성공)`,
    worst ? `가장 취약한 유형: ${worst[0]} (${worst[1].vulnerable}/${worst[1].total}건 뚫림)` : "14개 공격 유형 전부 방어 성공",
    ...(vulnList.length ? ["뚫린 공격:", ...vulnList] : []),
  ].join("\n");
}

// 보안장비 하드닝(보안설정) 점검 — 대상 장비 CLI에서 표준 기준 점검 명령을 실제 실행해 리포트한다.
// 결과가 이미 사람이 읽기 좋은 요약이라 directAnswer로 LLM 재작성을 생략한다.
async function runHardeningScanTool(args: Record<string, string>): Promise<string> {
  const raw = (args.standard ?? "").toLowerCase();
  const standard = isStandard(raw) ? raw
    : /cis|international|국제/.test(raw) ? "cis"
    : /pc|피시|윈도우|windows/.test(raw) ? "kisa_pc"
    : /net|네트워크|스위치|라우터|cisco/.test(raw) ? "kisa_net"
    : "kisa";
  const target = (args.target ?? "").trim() || undefined;
  // skipWorkLog: 이 경로는 agentloop이 원장에 남긴다(qa 판정까지 거기서 한다) — 중복 기록 방지.
  const report = await runHardeningScan({ standard, target, skipWorkLog: true });
  return scanSummaryText(report);
}

// ── 「AI 자산」 쓰기 도구 (Phase 2 — 결재판 경유) ────────────────────────

// 이름에서 자산 id를 만든다 — UX 피드백 러프엣지("id를 사람이 지정해야 함") 해소.
// 기존 시드 자산의 관례(ai-secbot-01, ai-doccls-02)를 따라 번호 접미사를 붙이고, 충돌하면 증가시킨다.
export function generateAssetId(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^가-힣a-z0-9-]/g, "") // 경로·특수문자 제거(id는 URL·파일명에 쓰인다)
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "asset";
  for (let n = 1; n < 100; n++) {
    const candidate = `${base}-${String(n).padStart(2, "0")}`;
    if (!getAsset(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// 경로 확장자로 자산 유형을 추정한다(규칙 — LLM 추정이 아니라 결정적).
function inferAssetType(path: string): string {
  if (/\.(gguf|safetensors|bin|pt|pth)$/i.test(path)) return "LLM 서비스";
  if (/\.(onnx|pb|h5|tflite)$/i.test(path)) return "분류 모델";
  return "기타";
}

function runRegisterAsset(args: Record<string, string>): string {
  const id = args.assetId?.trim() || generateAssetId(args.name);
  if (getAsset(id)) return `이미 존재하는 자산 id입니다: ${id}`;
  const before = listAssets().length;
  const asset = registerAsset({
    id,
    name: args.name.trim(),
    path: args.path.trim(),
    assetType: args.assetType?.trim() || inferAssetType(args.path),
    owner: args.owner?.trim() || undefined,
  });
  return `자산 ${asset.id}(${asset.name})을 등록했습니다. 등록 자산 ${before}개 → ${before + 1}개. 스캔은 아직 실행하지 않았습니다.`;
}

// assetId 인자에 여러 자산이 들어올 수 있다(asset_coverage가 결손 자산 여럿을 나열하고 사용자가
// "이 자산들 전부"라고 하면 LLM이 목록을 복사해온다). 쉼표·공백으로 쪼개 각각 resolveAsset한다.
function resolveAssetList(raw: string): { resolved: Asset[]; unresolved: string[] } {
  const tokens = (raw ?? "").split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
  const resolved: Asset[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const a = resolveAsset(t);
    if (a && !seen.has(a.id)) { seen.add(a.id); resolved.push(a); }
    else if (!a) unresolved.push(t);
  }
  return { resolved, unresolved };
}

function runAssignOwner(args: Record<string, string>): string {
  const { resolved, unresolved } = resolveAssetList(args.assetId ?? "");
  if (resolved.length === 0) {
    const ids = listAssets().map((a) => 자산표시이름(a.id)).slice(0, 12).join(", ") || "(없음)";
    return `대상 자산을 찾지 못했습니다: "${args.assetId}". 등록된 자산 id: ${ids}`;
  }
  const owner = (args.owner ?? "").trim();
  const service = args.service?.trim();
  for (const a of resolved) {
    updateAssetOwnership(a.id, { owner, ...(service ? { service } : {}) });
  }
  const names = resolved.map((a) => 자산표시이름(a.id)).join(", ");
  const tail = unresolved.length ? ` (찾지 못해 건너뜀: ${unresolved.join(", ")})` : "";
  return `자산 ${resolved.length}건에 담당부서를 "${owner}"로 지정했습니다${service ? ` · 서비스 "${service}"` : ""}: ${names}${tail}`;
}

// ── 도메인별 쓰기 도구 (조회↔쓰기 짝 맞추기, 전부 결재판 경유) ────────────────

// 위협 코드(M06 등) 또는 위협명(탈옥 등)으로 대응 상태를 지정한다. 상태 한국어→enum은 결정적 규칙.
function normalizeComplianceStatus(raw: string): ComplianceStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (/대응\s*완료|완료|충족|이행|covered|적용/.test(s)) return "covered";
  if (/부분|일부|진행|partial/.test(s)) return "partial";
  if (/해당\s*없|해당\s*안|무관|비해당|not\s*applicable|(?:^|[^a-z])na(?:[^a-z]|$)/.test(s)) return "na";
  if (/미대응|미조치|미이행|해당\s*있|open|미흡/.test(s)) return "open";
  return null;
}
function resolveThreatCode(needle: string): { code: string; name: string } | undefined {
  const n = (needle ?? "").trim();
  if (!n) return undefined;
  const all = listCompliance();
  const byCode = all.find((t) => t.code.toLowerCase() === n.toLowerCase());
  if (byCode) return { code: byCode.code, name: byCode.name };
  const byName = all.filter((t) => t.name.replace(/\s+/g, "").includes(n.replace(/\s+/g, "")));
  return byName.length === 1 ? { code: byName[0].code, name: byName[0].name } : undefined;
}
function runSetComplianceStatus(args: Record<string, string>): string {
  const threat = resolveThreatCode(args.code ?? "");
  if (!threat) return `위협을 특정하지 못했습니다: "${args.code}". 위협 현황(compliance_status)에서 코드(예: M06)나 위협명(예: 탈옥)을 확인하세요.`;
  const status = normalizeComplianceStatus(args.status ?? "");
  if (!status) return `대응 상태를 알 수 없습니다: "${args.status}". covered(대응완료)·partial(부분)·na(해당없음)·open(미대응) 중 하나여야 합니다.`;
  setComplianceStatus(threat.code, status, (args.note ?? "").trim());
  const label: Record<ComplianceStatus, string> = { covered: "대응완료", partial: "부분대응", na: "해당없음", open: "미대응" };
  return `위협 ${threat.code}(${threat.name})의 대응 상태를 "${label[status]}"로 기록했습니다.`;
}

// 상대 기한("다음주 월요일")·절대일자를 YYYY-MM-DD로. 파싱 실패면 그대로 둬 검증에서 되묻게 한다.
/**
 * 정기 알림 걸기. 결재판을 통과한 뒤에만 여기 온다.
 *
 * ⚠ 메일이 안 켜져 있으면 **등록은 하되 그 사실을 말한다.** 막지 않는 이유는,
 *   담당자가 알림부터 걸어 두고 메일을 나중에 켜는 순서도 흔하기 때문이다.
 *   다만 "걸었습니다"로 끝내면 안 오는 이유를 영영 모른다 — 그게 이 기능이 죽어 있던 방식이다.
 */
function runAlertScheduleAdd(args: Record<string, string>): string {
  const kind = String(args.kind ?? "").trim();
  const hour = Number(String(args.hour ?? "").trim());
  const to = String(args.to ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!["daily_brief", "sla_due", "system_health"].includes(kind)) {
    return "알림 종류를 골라 주세요 — 오늘 할 일 브리핑 / 조치 기한 임박 / 시스템 이상 중 하나입니다.";
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "보낼 시각을 0~23 사이 숫자로 알려 주세요(예: 아침 9시 → 9).";
  if (!to.length) return "알림을 받을 메일 주소가 필요합니다.";
  try {
    const s = createAlertSchedule(kind as AlertKind, hour, to);
    const 메일 = getSmtpConfig();
    return [
      `정기 알림을 걸었습니다 — ${ALERT_KIND_LABEL[s.kind]} · 매일 ${s.hourLocal}시 · ${s.recipients}`,
      메일 ? "" : "⚠ 다만 **메일 발송(SMTP)이 아직 꺼져 있어** 지금은 나가지 않습니다 — 설정 > 서버·AI에서 켜 주세요.",
      "보낼 것이 없는 날에는 보내지 않습니다.",
    ].filter(Boolean).join("\n");
  } catch (e) {
    return `알림을 걸지 못했습니다 — ${e instanceof Error ? e.message : String(e)}`;
  }
}

function runScheduleMaintenance(args: Record<string, string>): string {
  const productName = (args.productName ?? "").trim();
  const scheduleDate = parseRelativeDueDate(args.scheduleDate ?? "") ?? (args.scheduleDate ?? "").trim();
  if (!productName) return "어느 제품의 점검인지(productName) 필요합니다.";
  if (!DUE_RE.test(scheduleDate)) return `점검일(scheduleDate)을 YYYY-MM-DD로 지정하세요: "${args.scheduleDate}".`;
  const title = (args.title ?? "").trim() || `${productName} 정기 점검`;
  const item = createMaintenanceItem({ title, productName, scheduleDate });
  return `점검 일정을 등록했습니다 — ${item.productName} · ${item.title} · ${item.scheduleDate}${item.assetName ? ` (자산 ${item.assetName} 연결)` : ""}.`;
}

function runRegisterProduct(args: Record<string, string>): string {
  const name = (args.name ?? "").trim();
  if (!name) return "제품명(name)이 필요합니다.";
  const category = (args.category ?? "").trim(); // createProduct가 미지의 종류를 "기타"로 흡수한다
  // 연결 자산 — 화면의 등록 폼을 걷어내면서 도구로 옮겼다(2026-08-02 사용자 지시
  // "제품 등록 메뉴는 필요 없을 것 같아, 대화창에서 등록할 거니").
  // ⚠ 화면에만 있던 항목을 빠뜨리면 **없앤 것이 된다** — 지우기 전에 도구가 대신할 수 있게 한다.
  //   못 찾으면 조용히 넘기지 않고 무엇을 못 찾았는지 말한다(빈 연결로 등록되면 나중에 못 알아챈다).
  const 자산요청 = (args.asset ?? args.assetId ?? "").trim();
  let assetId: string | undefined;
  if (자산요청) {
    const hit = resolveAsset(자산요청);
    if (!hit) {
      const ids = listAssets().map((a) => a.name).slice(0, 8).join(", ") || "(없음)";
      return `연결할 자산을 찾지 못했습니다: "${자산요청}". 등록된 자산 예: ${ids}`;
    }
    assetId = hit.id;
  }
  const p = createProduct({
    name, category,
    vendor: args.vendor?.trim() || undefined,
    model: args.model?.trim() || undefined,
    assetId,
  });
  return `보안제품을 등록했습니다 — ${p.name} · 종류 ${p.category}` +
    `${p.vendor ? ` · ${p.vendor}` : ""}${p.model ? ` ${p.model}` : ""}` +
    `${assetId ? ` · 연결 자산 ${assetId}` : ""}.`;
}

async function runGenerateSbom(args: Record<string, string>): Promise<string> {
  const asset = resolveAsset(args.assetId ?? "");
  if (!asset) {
    const ids = listAssets().map((a) => 자산표시이름(a.id)).slice(0, 12).join(", ") || "(없음)";
    return `대상 자산을 찾지 못했습니다: "${args.assetId}". 등록된 자산 id: ${ids}`;
  }
  const doc = await generateSbom(asset.id);
  const n = doc.components?.length ?? 0;
  return `자산 ${asset.id}(${asset.name})의 SBOM을 생성했습니다 — 구성요소 ${n}개. AI-BOM 구성 현황에서 확인하세요.`;
}

// ── 취약점 조치 쓰기 도구 (Phase 2 — 결재판 경유) ────────────────────────
//
// finding 지목의 원칙: findingKey는 (assetId+내용) sha1 해시라 LLM이 만들 수 없다. 그래서 LLM은
// today/search/get_asset 결과에 이미 노출된 assetId와 finding 설명(심각도·유형)을 "복사"만 하고,
// 어떤 finding인지 특정하는 판단은 서버 규칙(resolveFinding)이 한다. 해석 실패·모호는 규칙이
// 거부하고 사람에게 되묻는다(오발동 방지). 매칭이 유일할 때만 실제 findingKey로 변환해 실행한다.

interface FindingHit {
  key: string; // 실제 findingKey (sha1 16자)
  label: string; // 사람이 읽을 요약 "[critical] 프롬프트 인젝션"
  assetId: string; // 해석된 실제 자산 id — 검토대장 저장 키(원 인자의 접두어 누락을 흡수)
}

function findingLabel(f: Asset["findings"][number]): string {
  return `[${심각도한글(f.severity)}] ${f.finding_type}`;
}

// finding 지목 매칭 — needle의 모든 토큰이 haystack에 있으면 매칭(연속 부분문자열 아님).
// 실측(2026-07-18): "OpenSSH 사용자 열거"가 실제 "OpenSSH < 9.6 사용자 열거"와 연속이 아니라
// (중간에 "< 9.6") 매칭 실패했다. 토큰별 포함으로 흡수한다. 과매칭은 resolveFinding의 2건+ 거부가 잡는다.
function findingMatches(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const h = norm(haystack);
  const tokens = (needle ?? "").trim().split(/\s+/).map(norm).filter((t) => t.length >= 2);
  return tokens.length > 0 && tokens.every((t) => h.includes(t));
}

// assetId를 관용적으로 찾는다 — 실측(2026-07-18): 7B가 "vuln:sample-web01"에서 "vuln:" 접두어를
// 떨어뜨려 매칭 실패. 정확 일치 → 접두어 붙여보기/떼보기 → 정규화 일치 → 자산 이름(호스트명) 순으로 시도한다.
// 실측(2026-07-19): "oracle.local Log4j RCE 담당자 배정해줘"처럼 사람이 화면에 표시된 이름
// (예: "oracle.local (192.168.219.98)")으로 부르면 id(vuln:192.168.219.98)와 안 맞아 승인이 실패했다 —
// 이름으로 유일하게 특정되는 경우만 그 자산으로 매칭한다(모호하면 실패해 되묻게 둔다).
function resolveAsset(assetId: string): Asset | undefined {
  const raw = (assetId ?? "").trim();
  if (!raw) return undefined;
  let asset = getAsset(raw);
  if (!asset) asset = getAsset(raw.startsWith("vuln:") ? raw.slice(5) : `vuln:${raw}`);
  if (!asset) {
    const norm = (s: string) => s.toLowerCase().replace(/^vuln:/, "");
    asset = listAssets().find((a) => norm(a.id) === norm(raw));
  }
  if (!asset) {
    const needle = raw.toLowerCase();
    const hits = listAssets().filter((a) => (a.name ?? "").toLowerCase().includes(needle));
    if (hits.length === 1) asset = hits[0];
  }
  return asset;
}

// assetId 안에서 needle(심각도·유형·근거 부분일치)로 finding 1건을 특정한다.
// 0건/2건+는 실패로 돌려주고(사람에게 되묻기), 정확히 1건일 때만 hit을 준다.
function resolveFinding(assetId: string, needle: string): { ok: true; hit: FindingHit } | { ok: false; error: string } {
  const asset = resolveAsset(assetId);
  if (!asset) {
    const ids = listAssets().map((a) => 자산표시이름(a.id)).join(", ") || "(없음)";
    return { ok: false, error: `자산 "${assetId}"을(를) 찾을 수 없습니다. 등록된 자산 id: ${ids}` };
  }
  if (asset.findings.length === 0) return { ok: false, error: `자산 ${asset.id}에는 조치할 취약점(finding)이 없습니다.` };
  const n = (needle ?? "").trim();
  if (n.length < 2) {
    const sample = asset.findings.slice(0, 6).map(findingLabel).join(" / ");
    return { ok: false, error: `어느 취약점인지 지목이 필요합니다. ${asset.id}의 취약점: ${sample}` };
  }
  const hits = asset.findings.filter((f) => findingMatches(`${f.finding_type} ${f.severity} ${f.evidence}`, n));
  if (hits.length === 0) {
    const sample = asset.findings.slice(0, 6).map(findingLabel).join(" / ");
    return { ok: false, error: `${asset.id}에서 "${needle}"에 맞는 취약점을 찾지 못했습니다. 이 자산의 취약점: ${sample}` };
  }
  if (hits.length > 1) {
    const sample = hits.slice(0, 6).map(findingLabel).join(" / ");
    return { ok: false, error: `"${needle}"에 ${hits.length}건이 걸립니다 — 심각도·유형으로 더 구체적으로 지목하세요: ${sample}` };
  }
  const f = hits[0];
  return { ok: true, hit: { key: findingKey(asset.id, f), label: findingLabel(f), assetId: asset.id } };
}

// 상태 한국어 → enum (결정적 규칙, LLM 추정이 아니다).
// 완료 표현을 폭넓게 잡는다 — 실측(2026-07-18): "패치 다 했어"가 status로 안 잡혀 승인이 막혔다.
function normalizeStatus(raw: string): ApprovalStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (/오탐|false positive|false-positive|무시|반려|제외|아님|reject/.test(s)) return "rejected";
  if (/조치|완료|해결|해결했|확정|승인|고쳤|고침|고쳐|패치|끝났|끝냈|막았|적용했|처리했|처리 완료|됐어|됐다|approv|fix|done|patch|resolv|remediat/.test(s)) return "approved";
  if (/미검토|보류|대기|원복|되돌|pending/.test(s)) return "pending";
  return null;
}

// status가 비면 지시문에서 규칙 추론한 canonical 한국어("조치완료"/"오탐")를 돌려준다(autoFill용).
function inferStatusWord(instruction: string): string | undefined {
  const st = normalizeStatus(instruction);
  return st === "approved" ? "조치완료" : st === "rejected" ? "오탐" : undefined;
}

const WEEKDAY_MON0: Record<string, number> = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 };

// "이번주 금요일"·"내일"처럼 사람이 흔히 쓰는 상대 기한을 YYYY-MM-DD로 바꾼다(결정적 규칙).
// 실측(2026-07-19): LLM이 지시문의 "이번주 금요일"을 그대로 dueDate에 넣어 승인 시 형식 검증
// (YYYY-MM-DD)에서 매번 실패했다. 못 알아들으면 undefined를 돌려줘 필드를 비운 채 두고
// (dueDate는 선택값) 사람이 승인 화면에서 직접 채우게 한다 — 틀린 날짜를 우기지 않는다.
function parseRelativeDueDate(text: string, now: Date = new Date()): string | undefined {
  const s = (text ?? "").trim();
  if (DUE_RE.test(s)) return s;
  // 달력 날짜만 다루므로 로컬 연/월/일로 계산한다 — toISOString(UTC)로 하면 자정 근처(예: 새벽
  // 0~9시 KST)에 하루 밀리는 버그가 생긴다(실측: "이번주 금요일"이 목요일로 계산됨).
  const iso = dateOnlyLocal;
  const addDays = addDaysLocal;
  if (/오늘/.test(s)) return iso(now);
  if (/모레/.test(s)) return iso(addDays(now, 2));
  if (/내일/.test(s)) return iso(addDays(now, 1));
  const daysAfter = s.match(/(\d+)\s*일\s*(?:후|뒤)/);
  if (daysAfter) return iso(addDays(now, Number(daysAfter[1])));
  const wd = s.match(/(다음\s*주|이번\s*주)?\s*(월|화|수|목|금|토|일)\s*요일/);
  if (wd) {
    const target = WEEKDAY_MON0[wd[2]];
    const mondayThisWeek = addDays(now, -((now.getDay() + 6) % 7)); // 이번 주 월요일
    const base = /다음/.test(wd[1] ?? "") ? addDays(mondayThisWeek, 7) : mondayThisWeek;
    return iso(addDays(base, target));
  }
  return undefined;
}

const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 쓰기 도구는 실패 시 문자열이 아니라 throw 한다 — 결재판 승인 경로(/api/agent/approve)가 이를
// 400으로 돌려 화면이 "실행 실패"로 표시한다. 읽기 도구가 오류 문자열을 LLM에 재주입하는 것과 달리,
// 쓰기 실패를 "✅ 완료" 메시지로 보여주면 사람이 배정이 된 줄 오해할 수 있어서다(오발동 방지).
function runAssignFinding(args: Record<string, string>): string {
  const r = resolveFinding(args.assetId, args.finding);
  if (!r.ok) throw new Error(r.error);
  const assignee = args.assignee.trim(); // required — validateToolArgs가 보장
  const patch: ReviewPatch = { assignee };
  const due = args.dueDate?.trim();
  if (due) {
    if (!DUE_RE.test(due)) throw new Error(`기한은 YYYY-MM-DD 형식이어야 합니다 (받은 값: "${due}").`);
    patch.dueDate = due;
  }
  updateFindingReview(r.hit.assetId, r.hit.key, patch, "orchestrator");
  return `${args.assetId} ${r.hit.label} → 담당자 ${assignee}${patch.dueDate ? `, 기한 ${patch.dueDate}` : ""} 배정했습니다.`;
}

function runUpdateFindingStatus(args: Record<string, string>): string {
  const r = resolveFinding(args.assetId, args.finding);
  if (!r.ok) throw new Error(r.error);
  const status = normalizeStatus(args.status);
  if (!status) throw new Error(`상태 "${args.status}"를 해석하지 못했습니다. "조치완료" 또는 "오탐"으로 지정하세요.`);
  const patch: ReviewPatch = { status };
  const note = args.note?.trim();
  if (note) patch.note = note;
  updateFindingReview(r.hit.assetId, r.hit.key, patch, "orchestrator");
  const label = status === "rejected" ? "오탐(SBOM·조치 대상에서 제외)" : status === "approved" ? "조치완료(확정)" : "미검토(원복)";
  return `${args.assetId} ${r.hit.label} → ${label} 처리했습니다.${note ? ` 사유: ${note}` : ""}`;
}

// ── #2 자연어 일괄 조치 ──────────────────────────────────────────────────
// "Critical KEV 전부 정요한 배정" 한 문장으로 다건 처리. 289건을 1건씩 다루는 건 비현실적.
// filter는 규칙 파싱(심각도·KEV·상태·키워드), 매칭은 전 자산을 가로지른다(prioritizedReviews).

interface BulkMatch { assetId: string; key: string; label: string; }

function matchFindingsByFilter(filter: string): BulkMatch[] {
  const f = (filter ?? "").toLowerCase();
  let sel = prioritizedReviews(2000); // 전 자산 finding(오탐 제외), 우선순위순
  if (/critical|크리티컬|심각/.test(f)) sel = sel.filter((r) => r.finding.severity === "critical");
  else if (/high|높/.test(f)) sel = sel.filter((r) => r.finding.severity === "high");
  else if (/medium|중간/.test(f)) sel = sel.filter((r) => r.finding.severity === "medium");
  else if (/\blow\b|낮/.test(f)) sel = sel.filter((r) => r.finding.severity === "low");
  if (/kev|실제\s*악용|악용/.test(f)) sel = sel.filter((r) => r.finding.kev);
  if (/미배정|담당\s*없|미지정/.test(f)) sel = sel.filter((r) => !r.assignee);
  if (/기한\s*초과|지연|overdue/.test(f)) sel = sel.filter((r) => r.overdue);
  // 남은 키워드(심각도·KEV·집합어 제거 후)로 유형·근거 매칭
  const kw = f.replace(/critical|high|medium|low|크리티컬|심각|높은?|중간|낮은?|kev|실제\s*악용|악용|미배정|담당\s*없음?|미지정|기한\s*초과|지연|overdue|전부|모두|다|취약점|것들?|전체/g, "").trim();
  if (kw.length >= 2) sel = sel.filter((r) => matches(`${r.finding.finding_type} ${r.finding.evidence}`, kw));
  return sel.map((r) => ({ assetId: r.assetId, key: r.findingKey, label: `[${심각도한글(r.finding.severity)}] ${r.finding.finding_type} @ ${r.assetName}` }));
}

// 화면(대화창)에서 **체크박스로 직접 고른** 건들을 받는다 — "assetId::findingKey" 목록.
// (2026-07-31 사용자 질문 "미조치 취약점에 리스트를 보고 선택도 가능한거지?")
//
// 왜 조건(filter)만으로는 부족한가: 조건은 담당자가 머릿속으로 세운 범위를 **말로 옮긴 것**이라
// 실제 대상과 어긋날 수 있다("Oracle 취약점 다"에 무엇이 걸리는지는 눌러 보기 전엔 모른다).
// 눈으로 보고 고른 것은 어긋날 수가 없다.
//
// findingKey는 (assetId+내용) sha1 16자라 LLM이 지어낼 수 없다 — 실제로 있는 건만 통과시키고,
// 없는 id는 **조용히 버리지 않고 세어서 알린다**(골랐는데 안 된 걸 모르면 그게 제일 나쁘다).
export function matchFindingsByIds(ids: string): { matched: BulkMatch[]; unknown: string[] } {
  const want = String(ids ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (want.length === 0) return { matched: [], unknown: [] };
  const all = prioritizedReviews(2000);
  const byId = new Map<string, BulkMatch>();
  for (const r of all) {
    byId.set(`${r.assetId}::${r.findingKey}`, {
      assetId: r.assetId,
      key: r.findingKey,
      label: `[${심각도한글(r.finding.severity)}] ${r.finding.finding_type} @ ${r.assetName}`,
    });
  }
  const matched: BulkMatch[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const id of want) {
    if (seen.has(id)) continue; // 같은 것을 두 번 고쳐 쓰지 않는다
    seen.add(id);
    const hit = byId.get(id);
    if (hit) matched.push(hit);
    else unknown.push(id);
  }
  return { matched, unknown };
}

function runBulkUpdate(args: Record<string, string>): string {
  // ids(직접 고른 것)가 있으면 그것이 우선이다 — 조건보다 사람이 눈으로 고른 것이 정확하다.
  let matched: BulkMatch[];
  let 대상설명: string;
  let 못찾음: string[] = [];
  if (args.ids?.trim()) {
    const r = matchFindingsByIds(args.ids);
    matched = r.matched;
    못찾음 = r.unknown;
    대상설명 = "선택한 건";
    if (matched.length === 0) {
      throw new Error(
        `고르신 ${못찾음.length}건을 지금 목록에서 찾지 못했습니다 — 그 사이에 처리됐거나 목록이 바뀌었을 수 있습니다. 목록을 다시 불러 주세요.`
      );
    }
  } else {
    // ★ 둘 다 비면 **전건**이 걸린다(matchFindingsByFilter("")는 필터를 하나도 안 건다).
    //   filter를 선택값으로 바꾸면서 생긴 구멍이라 여기서 막는다 — 조건 없는 일괄 쓰기는 금지다.
    if (!args.filter?.trim()) {
      throw new Error("무엇에 적용할지 정하지 않았습니다 — 조건을 말씀하시거나 목록에서 직접 고르세요.");
    }
    matched = matchFindingsByFilter(args.filter);
    대상설명 = `"${args.filter}"`;
    if (matched.length === 0) throw new Error(`"${args.filter}"에 맞는 취약점이 없습니다.`);
  }
  const patch: ReviewPatch = {};
  if (args.assignee?.trim()) patch.assignee = args.assignee.trim();
  if (args.dueDate?.trim()) {
    if (!DUE_RE.test(args.dueDate.trim())) throw new Error(`기한은 YYYY-MM-DD 형식이어야 합니다 (받은 값: "${args.dueDate}").`);
    patch.dueDate = args.dueDate.trim();
  }
  if (args.status?.trim()) {
    const st = normalizeStatus(args.status);
    if (!st) throw new Error(`상태 "${args.status}"를 해석하지 못했습니다.`);
    patch.status = st;
  }
  if (!patch.assignee && !patch.dueDate && !patch.status) throw new Error("담당자·기한·판정 중 하나는 지정해야 합니다.");
  for (const m of matched) updateFindingReview(m.assetId, m.key, patch, "orchestrator");
  const acts = [patch.assignee && `담당 ${patch.assignee}`, patch.dueDate && `기한 ${patch.dueDate}`, patch.status && `판정 ${args.status.trim()}`].filter(Boolean).join(", ");
  // 못 찾은 건은 반드시 말한다 — 5건 골랐는데 3건만 됐다는 걸 모르면 안 한 일을 했다고 믿는다.
  const 빠짐 = 못찾음.length ? ` ⚠ ${못찾음.length}건은 목록에서 찾지 못해 건너뛰었습니다(이미 처리됐거나 목록이 바뀐 건).` : "";
  return `${대상설명} ${matched.length}건에 일괄 적용했습니다: ${acts}.${빠짐}`;
}

// ── 「취약점」 도메인 도구 ───────────────────────────────────────────────
// 메뉴 전수 조사에서 vuln 영역에 오케스트레이션 경로가 없던 역량을 채운다.

// 취약점 현황을 조건으로 훑는다. today(cross)가 "오늘 볼 상위 N건"이라면 이건 "조건에 맞는
// 것들이 지금 어떤 상태인가"를 본다 — 배정·기한·판정 현황 파악이 목적이다.
/** 현황을 셀 때 훑는 최대 건수. 여기에 닿으면 **닿았다고 말한다**(총계인 척하지 않는다). */
const 현황상한 = 50000;

function runFindingStatusOverview(args: Record<string, string>): string {
  const filter = (args.filter ?? "").trim().toLowerCase();
  // ⚠ **세는 것은 전부 세고, 보여 주는 것만 자른다.**
  //   예전에는 prioritizedReviews(200)으로 200건만 가져와 그 수를 "취약점 200건"이라고
  //   총계처럼 말했다. 2026-08-03에 잃었던 취약점 4,833건을 되살리자 **총계가 200에 멈춰**
  //   그 거짓말이 드러났다. 담당자는 이 숫자로 임원 보고를 쓴다.
  const rows = prioritizedReviews(현황상한);
  const matched = filter
    ? rows.filter((r) =>
        필터에맞나(
          `${r.assetId} ${r.finding.finding_type} ${r.finding.severity} ${r.finding.evidence ?? ""} ${r.assignee ?? ""}`,
          filter,
          r.status,
        ))
    : rows;

  if (matched.length === 0)
    return filter
      ? `전체 ${rows.length}건 중 조건("${args.filter}")에 맞는 취약점을 못 찾았습니다. 조건 없이 다시 물어보세요.`
      : "등록된 취약점이 없습니다.";

  const byStatus = { pending: 0, approved: 0, rejected: 0 } as Record<string, number>;
  let unassigned = 0;
  let overdue = 0;
  const today = dateOnlyLocal(new Date());
  for (const r of matched) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (!r.assignee) unassigned++;
    if (r.dueDate && r.dueDate < today && r.status === "pending") overdue++;
  }

  // 2026-08-04 이전에 반입한 것은 조사 정보가 취약점으로 저장돼 있다 — **섞였다고 밝힌다.**
  const 섞임 = 섞임고지(matched.map((r) => r.finding.finding_type));
  // 훑는 상한에 닿았으면 그 수는 총계가 아니다 — "이상"이라고 적는다.
  const 상한닿음 = rows.length >= 현황상한;
  const head =
    `취약점 ${matched.length}${상한닿음 ? "건 이상(너무 많아 일부만 셌습니다)" : "건"} — 미검토 ${byStatus.pending ?? 0}, 조치완료 ${byStatus.approved ?? 0}, 오탐 ${byStatus.rejected ?? 0}` +
    ` / 담당자 미배정 ${unassigned}건, 기한 초과 ${overdue}건`;

  // ⚠ 예전에는 `[critical] vuln:10.10.20.41 … (pending, …)`을 그대로 냈다.
  //   담당자가 읽는 글자에 **영문 상태값**과 **내부 식별자**가 섞여 있었다(2026-08-03 실측) —
  //   말투 규범이 금지한 둘이다. 저장은 영문이어도 **사람에게는 우리말로** 말한다.
  const 상태말: Record<string, string> = { pending: "미검토", approved: "조치완료", rejected: "오탐" };
  const 자산이름 = (id: string) => 자산표시이름(id);
  const lines = matched.slice(0, 10).map((r) => {
    const who = r.assignee ? `담당 ${r.assignee}` : "담당 미배정";
    const due = r.dueDate ? `기한 ${r.dueDate}` : "기한 없음";
    const sev = r.finding.severity;
    // ⚠ 이름은 **원문 그대로** 둔다(검색·벤더 대조의 열쇠다). 우리말 한 줄을 **옆에** 붙인다.
    //   못 알아보는 이름에는 아무것도 안 붙는다 — 지어내지 않는다(2026-08-04 파트너 지적).
    return `${심각도표식(sev)} [${심각도한글(sev)}] ${자산이름(r.assetId)} · ${r.finding.finding_type}` +
      한줄풀이글(r.finding.finding_type) +
      ` (${상태말[r.status] ?? r.status}, ${who}, ${due})`;
  });
  // ⚠ 잘랐으면 잘랐다고 말한다 — 안 그러면 열 건이 전부인 줄 안다.
  const more = matched.length > 10 ? `\n… 외 ${matched.length - 10}건 (전체 ${matched.length}건 중 위험한 순 10건)` : "";
  // 담당자가 없는 건이 있으면 그게 **다음에 할 일**이다 — 배정 안 된 건은 아무도 안 한다.
  const 할말 = unassigned
    ? `담당자 미배정 ${unassigned}건이 병목입니다 — "1번 담당자 배정해줘"라고 하시거나 조치·승인 화면에서 배정하세요.`
    : '조치·승인 화면에서 상태를 옮기거나, 여기서 "○○ 조치완료로 바꿔줘"라고 말해도 됩니다.';
  return (
    `${head}${섞임 ? `\n${섞임}` : ""}\n${lines.join("\n")}${more}` +
    `${시연데이터알림(matched.map((r) => r.finding))}${다음걸음(할말)}`
  );
}

// 승인/반려 — 조치·승인 화면(approvals.html)의 setFindingReview에 해당하는 역량.
function runReviewFinding(args: Record<string, string>): string {
  const assetId = (args.assetId ?? "").trim();
  const target = (args.finding ?? "").trim().toLowerCase();
  const decision = (args.decision ?? "").trim();

  const asset = getAsset(assetId);
  if (!asset) return `자산을 찾을 수 없습니다: ${assetId}`;

  const hit = asset.findings.find((f) =>
    `${f.severity} ${f.finding_type} ${f.evidence ?? ""}`.toLowerCase().includes(target)
  );
  if (!hit) return `"${args.finding}"에 해당하는 취약점을 ${assetId}에서 찾지 못했습니다.`;

  const status: ApprovalStatus =
    /승인|approve|조치완료|처리/.test(decision) ? "approved" : /반려|오탐|reject|false/.test(decision) ? "rejected" : "pending";

  const patch: ReviewPatch = { status, ...(args.note ? { note: args.note } : {}) };
  updateFindingReview(assetId, findingKey(assetId, hit), patch, "agent");
  const label = status === "approved" ? "승인(조치완료)" : status === "rejected" ? "반려(오탐)" : "미검토로 원복";
  return `${assetId}의 "${hit.finding_type}"(${hit.severity})을 ${label} 처리했습니다.`;
}

// ── 「AI-BOM」 도메인 도구 ───────────────────────────────────────────────
// AI-BOM은 제품의 차별 기능이다. 5영역(model·dataset·prompt·agentTool·infrastructure)이
// 얼마나 채워졌는지가 곧 거버넌스 준비도이므로, "무엇이 비었는가"를 짚어주는 게 핵심이다.

// 5영역 중 실제로 값이 들어간 항목 수를 센다. 빈 문자열은 미기재로 본다.
function aibomFilledFields(a: Asset): { filled: number; total: number; missing: string[] } {
  const b = a.aibom;
  const groups: [string, Record<string, string>][] = [
    ["모델", { 기반모델: b.model.foundationModel, 아키텍처: b.model.architecture, 가중치해시: b.model.weightsHash, 용도: b.model.intendedUse, 한계: b.model.limitations }],
    ["데이터셋", { 출처: b.dataset.sources, 벡터DB: b.dataset.vectorDbLocation }],
    ["프롬프트", { 시스템프롬프트: b.prompt.systemPrompt, 가드레일: b.prompt.guardrails }],
    ["도구", { API: b.agentTool.apis, MCP: b.agentTool.mcpServers }],
    ["인프라", { 컴퓨트: b.infrastructure.compute, 호스팅: b.infrastructure.hostingProvider }],
  ];
  let filled = 0;
  let total = 0;
  const missing: string[] = [];
  for (const [group, fields] of groups) {
    for (const [label, v] of Object.entries(fields)) {
      total++;
      if (v && v.trim()) filled++;
      else missing.push(`${group}·${label}`);
    }
  }
  return { filled, total, missing };
}

// AI-BOM 구성 현황 — 어느 자산이 비어 있고 무엇이 빠졌는지. 거버넌스 보고의 출발점이다.
// 자산 커버리지 — 화면(inventory.html 커버리지 탭)과 같은 계산을 쓴다.
// "무엇을 모르는가"는 한 곳에서만 세야 답이 갈리지 않는다.
function runAssetCoverage(args: Record<string, string>): string {
  const cov = computeAssetCoverage(listAssets());
  const only = (args.gap ?? "").trim().toLowerCase();
  if (!only) return coverageSummaryText(cov);

  const KEY: Record<string, GapKind> = {
    owner: "owner", 담당: "owner", 담당부서: "owner",
    service: "service", 서비스: "service",
    sbom: "sbom",
    unscanned: "unscanned", 미스캔: "unscanned", 미점검: "unscanned",
  };
  const kind = KEY[only];
  if (!kind) return `알 수 없는 결손 종류입니다: ${args.gap}\n가능한 값: owner(담당부서), service(서비스), sbom, unscanned(미점검)`;

  const gap = cov.gaps.find((g) => g.kind === kind);
  if (!gap) return `${only} 결손은 없습니다. 해당 항목은 전체 ${cov.total}건이 모두 채워져 있습니다.`;
  // ⚠ **내부 id를 그대로 내지 않는다**(2026-08-04 말투 감시가 잡음: `- vuln:cert.aj-safe.co.kr`).
  //   담당자에게 `vuln:` 접두는 아무 뜻이 없고, 그 값으로는 화면에서 찾을 수도 없다.
  //   오늘 오탐 이력에서 고친 것과 같은 종류다 — 사람이 읽는 글자로 낸다.
  const shown = gap.assetIds.slice(0, 15).map((id) => `- ${자산표시이름(id)}`).join("\n");
  const more = gap.assetIds.length > 15 ? `\n… 외 ${gap.assetIds.length - 15}건` : "";
  return `${gap.title}\n${gap.why}\n\n${shown}${more}\n\n조치: ${gap.fixLabel} (자산 화면 > 커버리지 탭)`;
}

function runAibomStatus(args: Record<string, string>): string {
  const only = (args.assetId ?? "").trim();

  if (only) {
    const a = listAssets().find((x) => x.id === only);
    if (!a) return `자산을 찾을 수 없습니다: ${only}`;
    const { filled, total, missing } = aibomFilledFields(a);
    const r = a.aibom.robustness;
    const rob = r.ranAt ? `견고성 ${r.score ?? "-"}점 (취약 ${r.vulnerable}/${r.total})` : "견고성 미점검";
    const sbom = a.sbomGeneratedAt ? `SBOM 생성됨` : "SBOM 미생성";
    // ⚠ 내부 id를 사람에게 보이지 않는다(2026-08-04) — `vuln:192.168.219.98`은 읽는 글자가 아니다.
    const head = `${자산표시이름(a.id)} — AI-BOM ${filled}/${total} 항목 기재, ${sbom}, ${rob}`;
    return missing.length ? `${head}\n미기재: ${missing.join(", ")}` : `${head}\n5영역 모두 기재 완료.`;
  }

  // 전체 현황은 AI/모델 자산만 센다 — 방화벽·DB 같은 IT 자산은 AI-BOM 대상이 아니라 제외한다
  // (안 그러면 IT 자산이 전부 "AI-BOM 미완성"으로 잡혀 거버넌스 현황이 노이즈로 덮인다).
  const aiAssets = listAssets().filter(isAiAsset);
  if (aiAssets.length === 0) return "등록된 AI/모델 자산이 없습니다. (방화벽·서버 등 IT 자산은 AI-BOM 대상이 아닙니다)";

  const rows = aiAssets.map((a) => ({ a, ...aibomFilledFields(a) }));
  const incomplete = rows.filter((r) => r.missing.length > 0);
  const noSbom = rows.filter((r) => !r.a.sbomGeneratedAt);
  const noRobustness = rows.filter((r) => !r.a.aibom.robustness.ranAt);

  const head =
    `자산 ${rows.length}건 — AI-BOM 미완성 ${incomplete.length}건, SBOM 미생성 ${noSbom.length}건, 견고성 미점검 ${noRobustness.length}건`;
  const lines = rows
    .slice(0, 10)
    .map((r) => `- ${자산표시이름(r.a.id)}: ${r.filled}/${r.total} 기재${r.missing.length ? ` (미기재 ${r.missing.length}개)` : " ✓"}`);
  const more = rows.length > 10 ? `\n… 외 ${rows.length - 10}건` : "";
  // ⚠ 숫자만 주고 끝내면 "그래서 뭘 하지"가 남는다(2026-08-03 18건 실측 규범).
  // ⚠⚠ **있는 명령만 적는다.** AI-BOM 항목을 채우는 대화창 도구는 아직 없다 —
  //    없는 것을 안내하면 담당자가 그 말을 따라가다 막다른 길에 선다(2026-08-04 확인).
  const 다음 = noSbom.length
    ? `\n\n${표식.다음} SBOM이 없는 자산은 "○○ SBOM 만들어줘"라고 하면 만듭니다.`
    : incomplete.length
      ? `\n\n${표식.다음} 어느 항목이 비었는지 보려면 "○○ AI-BOM 보여줘"라고 하세요.`
      : "";
  return `${head}\n${lines.join("\n")}${more}${다음}`;
}

// ── 「보안제품」 도메인 도구 ─────────────────────────────────────────────
// 보안제품 등록부는 "무엇을 쓰고 있고, 운영 문서(매뉴얼)가 갖춰졌는가"가 핵심이다.
// 문서가 없는 제품은 장애 시 대응이 늦어지므로 그 공백을 짚어주는 데 초점을 맞춘다.
function runProductStatus(args: Record<string, string>): string {
  const q = (args.query ?? "").trim().toLowerCase();
  const all = listProducts();
  if (all.length === 0) return "등록된 보안제품이 없습니다.";

  const matched = q
    ? all.filter((p) => 필터에맞나(`${p.name} ${p.category} ${p.vendor ?? ""} ${p.model ?? ""} ${p.note ?? ""}`, q))
    : all;
  if (matched.length === 0) return `전체 ${all.length}건 중 "${args.query}"에 맞는 보안제품을 못 찾았습니다. 조건 없이 다시 물어보세요.`;

  const noDocs = matched.filter((p) => p.docs.length === 0);
  const byCat = new Map<string, number>();
  for (const p of matched) byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);

  const head =
    `보안제품 ${matched.length}건 (${[...byCat].map(([c, n]) => `${c} ${n}`).join(", ")})` +
    ` — 운영문서 없는 제품 ${noDocs.length}건`;
  const lines = matched.slice(0, 10).map((p) => {
    const vendor = p.vendor ? `${p.vendor} ` : "";
    const linked = p.assetName ? `, 자산 ${p.assetName}` : "";
    return `- ${vendor}${p.name} (${p.category}, 문서 ${p.docs.length}건${linked})`;
  });
  const more = matched.length > 10 ? `\n… 외 ${matched.length - 10}건` : "";
  const warn = noDocs.length ? `\n문서 미등록: ${noDocs.slice(0, 5).map((p) => p.name).join(", ")}` : "";
  return `${head}\n${lines.join("\n")}${more}${warn}`;
}

// ── 「유지보수」 도메인 도구 ─────────────────────────────────────────────
// 정기 점검은 "기한이 지났는가"가 전부다. 지연된 것부터 보여준다.
function runMaintenanceStatus(args: Record<string, string>): string {
  const items = listMaintenanceItems();
  if (items.length === 0) return "등록된 점검 일정이 없습니다.";

  const today = dateOnlyLocal(new Date());
  const q = (args.filter ?? "").trim().toLowerCase();
  const matched = q
    ? items.filter((m) => 필터에맞나(`${m.title} ${m.productName} ${m.assetName ?? ""}`, q, m.status))
    : items;
  if (matched.length === 0) return `전체 ${items.length}건 중 "${args.filter}"에 맞는 점검 일정을 못 찾았습니다. 조건 없이 다시 물어보세요.`;

  // approved(승인 완료)를 뺀 나머지가 아직 손이 필요한 것들이다.
  const open = matched.filter((m) => m.status !== "approved");
  const overdue = open.filter((m) => m.scheduleDate < today);
  const upcoming = open.filter((m) => m.scheduleDate >= today);

  const head = `점검 일정 ${matched.length}건 — 기한 초과 ${overdue.length}건, 예정 ${upcoming.length}건, 완료 ${matched.length - open.length}건`;
  const list = [...overdue, ...upcoming].slice(0, 10).map((m) => {
    const late = m.scheduleDate < today ? " ⚠기한초과" : "";
    return `- ${m.title} · ${m.productName} (${m.scheduleDate}, ${m.status})${late}`;
  });
  return list.length ? `${head}\n${list.join("\n")}` : `${head}\n미완료 항목이 없습니다.`;
}

// ── 「리포트·컴플라이언스」 도메인 도구 ──────────────────────────────────
// 보고서 생성 자체는 결재·범위 선택이 필요해 화면에서 하는 게 맞다. 여기서 채우는 공백은
// "지금 보고할 거리가 무엇인가" — 컴플라이언스 이행 현황이다.
function runComplianceStatus(args: Record<string, string>): string {
  const rows = listCompliance();
  if (rows.length === 0) return "등록된 컴플라이언스 항목이 없습니다.";

  const q = (args.filter ?? "").trim().toLowerCase();
  const matched = q
    ? rows.filter((r) => 필터에맞나(`${r.code} ${r.name} ${r.note ?? ""}`, q, r.status))
    : rows;
  if (matched.length === 0) return `전체 ${rows.length}건 중 "${args.filter}"에 맞는 항목을 못 찾았습니다. 조건 없이 다시 물어보세요.`;

  const counts = matched.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  // 상태는 covered(대응됨)·partial(부분)·open(미대응)·na(해당없음).
  // 손이 필요한 건 open과 partial이다.
  const LABEL: Record<string, string> = { covered: "대응됨", partial: "부분대응", open: "미대응", na: "해당없음" };
  const pending = matched.filter((r) => r.status === "open" || r.status === "partial");

  const head =
    `컴플라이언스 ${matched.length}건 — ` +
    Object.entries(counts).map(([s, n]) => `${LABEL[s] ?? s} ${n}`).join(", ");
  const lines = pending
    .slice(0, 10)
    .map((r) => `- [${LABEL[r.status] ?? r.status}] ${r.code} ${r.name}${r.note ? ` (${r.note.slice(0, 30)})` : ""}`);
  return pending.length ? `${head}\n조치 필요:\n${lines.join("\n")}` : `${head}\n미대응 항목이 없습니다.`;
}

// 정기 리포트(주간/분기) 자동 생성 스케줄 조회 — 화면(예약 설정)에서 등록한 스케줄을 챗봇이
// 그대로 알 수 있게 한다("다음 정기 리포트 언제야?", "이번 주 스케줄 뭐있어?" 등).
function runReportScheduleList(): string {
  return scheduleSummaryText(listReportSchedules());
}

// "지난달 리포트 어디 있어?" — **어디 있는지** 묻는 말에 목록으로 답한다.
//   실측(2026-08-03 실전 147상황): LLM에게 가서 사내 문서(스캐너 매니페스트)를 읽고
//   `FindingsManifestFile (Type: MANIFEST_FINDING, MD5: ed32e90f…)` 를 늘어놓았다.
//   담당자는 리포트를 찾고 있었는데 남의 파일 해시를 받았다.
async function runReportList(args: Record<string, string>): Promise<string> {
  let 목록: Awaited<ReturnType<typeof listReportHistory>>;
  try { 목록 = await listReportHistory(50); } catch { return "리포트 보관함을 읽지 못했습니다 — 저장 위치를 확인해 주세요."; }
  // ⚠ 보고서가 아닌 것을 세지 않는다(긴 답변 자동 전환·파일 반입 기록) — 세는 곳과 같은 규칙이다.
  const 진짜 = 목록.filter((r) => !/^(answer|ingest)-/.test(r.base));
  if (!진짜.length) {
    return `아직 만든 보고서가 없습니다.\n${표식.다음} 지금 만들려면 "이번 주 취약점 보고서 만들어줘"`;
  }
  const 기간 = (args.filter ?? "").trim();
  const 보여줄 = 8;
  const 줄 = 진짜.slice(0, 보여줄).map((r) => {
    const d = new Date(r.createdAt);
    const 날 = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const 형식 = [r.docx && "DOCX", r.pdf && "PDF", r.md && "MD"].filter(Boolean).join("·") || "—";
    return `· ${날} ${r.type}${r.audience === "internal" ? "(내부 검토용)" : ""} — ${형식}`;
  });
  const 자름 = 진짜.length > 보여줄 ? ` · 아래는 최근 ${보여줄}건입니다` : "";
  return (
    `보관된 보고서 ${진짜.length}건${자름}${기간 ? ` (물으신 조건: "${기간}")` : ""}\n` +
    `${줄.join("\n")}\n` +
    `${표식.다음} 열어 보시려면 사이드바 ⑤ 보고 › 「리포트」 화면에서 내려받으세요.`
  );
}

// 인터넷에 노출된 자산 — 실측(2026-08-03 실전 147상황): "인터넷에 노출된 자산 있어?"에
//   **"이 자산에서 발견된 1개 취약점 중 즉시 조치 없음입니다."**라고 답했다.
//   노출 여부를 물었는데 특정 자산 취약점을 말한 것이다. 노출 점수는 assethub가 이미 계산한다.
//
// ⚠ **어떻게 판정했는지 밝힌다.** 이 판정은 스캔이 아니라 **우리가 적어 둔 정보**에서 나온다
//   (AI-BOM 인프라 칸의 호스팅 정보 + 자산의 서비스명). 적어 두지 않은 자산은 "모른다"이지
//   "노출 안 됨"이 아니다 — 그 차이를 안 밝히면 담당자가 안전하다고 착각한다.
// ⚠ **판별식을 밖으로 꺼내 둔다.** 함수 안에 두면 시험할 방법이 없고, 그러면 정규식이
//   고장 나도 답은 언제나 그럴듯한 「0건」이라 아무도 모른다(2026-08-03 운영 실측이 0건이었다 —
//   등록부 57건 중 4건만 채워져 있고 그 4건이 전부 온프레미스라 0건이 **맞는** 답이었지만,
//   맞는지 틀린지 가릴 수단이 없다는 것이 문제였다).
export function 인터넷노출로적혔나(호스팅: string, 서비스: string): boolean {
  return /인터넷|external|public|외부|공인\s*ip|dmz/i.test(`${호스팅 || ""} ${서비스 || ""}`);
}

function runExposedAssets(): string {
  let hub: ReturnType<typeof buildHub>;
  try { hub = buildHub(); } catch { return "자산 노출도를 계산하지 못했습니다 — 자산 등록부를 확인해 주세요."; }
  const 적힌것 = hub.rows.filter((r) => {
    const a = getAsset(r.id);
    return a ? 인터넷노출로적혔나(a.aibom.infrastructure.hostingProvider || "", a.service || "") : false;
  });
  const 모름 = hub.rows.filter((r) => {
    const a = getAsset(r.id);
    return !a || !`${a.aibom.infrastructure.hostingProvider || ""}${a.service || ""}`.trim();
  }).length;

  const 머리 = 적힌것.length
    ? `인터넷 노출로 **적혀 있는** 자산 ${적힌것.length}건 (전체 ${hub.rows.length}건)`
    : `인터넷 노출로 적혀 있는 자산이 없습니다 (전체 ${hub.rows.length}건)`;
  const 줄 = 적힌것
    .slice()
    .sort((x, y) => y.exposureScore - x.exposureScore)
    .slice(0, 8)
    .map((r) => `${심각도표식(r.riskBand === "ok" ? "low" : r.riskBand)} ${자산표시이름(r.id)} — 노출점수 ${r.exposureScore}`);

  return [
    머리,
    ...줄,
    "",
    // ⚠ 여기에 「다음 걸음」을 붙이지 않는다. 이건 **현황 조회**라 다음 행동이 사람마다 다르다
    //   (일감 목록인 today·briefing·finding_status에만 붙인다 — agenttools-cross.test.ts가 지킨다).
    //   등록부가 비었다는 사실은 아래 정직 문구에 함께 적어 「그래서 뭘 하지」를 남기지 않는다.
    `${표식.주의} 이 판정은 스캔이 아니라 **등록부에 적힌 정보**(AI-BOM 인프라·서비스명)로 한 것입니다.` +
      (모름
        ? ` 적어 두지 않은 자산 ${모름}건은 **모릅니다** — 노출 안 됐다는 뜻이 아닙니다. 자산 화면에서 그 ${모름}건의 인프라·서비스 칸을 채우면 판정이 정확해집니다.`
        : ""),
  ].filter(Boolean).join("\n");
}

/**
 * 업무 절차 5단계 현황 — **절차 띠와 같은 함수(workflowStages)를 쓴다.**
 * 따로 세면 띠의 숫자와 대화창의 숫자가 어긋나고, 어긋난 두 숫자는 둘 다 안 믿게 만든다.
 *
 * ⚠ 「제일 밀렸다」의 뜻을 정해 둔다 — **경고 칸(alert)이 가장 큰 단계**다.
 *   건수(count)가 큰 것은 그 단계를 지나간 양일 뿐 밀린 것이 아니다(①은 늘 자산 전체다).
 * ⚠ 못 구한 칸(null)은 **0으로 치지 않는다** — 비운 채 "모름"이라고 적는다.
 */
/**
 * 단계마다 **거기서 실제로 하는 일**. 우리 제품 기준이다.
 *
 * ★ 왜 표로 박아 두는가(2026-08-04 147상황): 「발견 단계에서 뭘 해야 해?」에 **35초**를 쓰고
 *   Tenable 사용자 가이드를 읽어 "기업의 네트워크·시스템을 파악하여 자산 목록을 작성합니다"
 *   라고 답했다. 남의 제품 방법론 강의다 — 담당자는 **우리 화면에서 뭘 누르는지**를 물었다.
 *   절차 5단계는 우리가 정한 것이라 지어낼 이유가 없다. 규칙으로 답한다.
 */
const 단계별할일: Record<number, { 일: string; 말: string }> = {
  1: { 일: "장비·서비스를 찾아 등록하고, 스캐너 결과와 점검 보고서를 받아들입니다.", 말: '"자산 목록 보여줘" 또는 점검 보고서를 대화창에 올려 주세요.' },
  2: { 일: "받아들인 취약점 중 **먼저 볼 것**을 고릅니다 — 실제 악용(KEV)·노출도·자산 중요도로 셉니다.", 말: '"오늘 뭐부터 해야 해?"라고 물어보세요.' },
  3: { 일: "고른 건에 담당자와 기한을 붙이고, 실제로 고칩니다.", 말: '"미배정 취약점 담당자 배정해줘"라고 하시면 승인 창이 뜹니다.' },
  4: { 일: "고쳤는지 **다시 재서 확인**합니다 — 재스캔·하드닝 점검으로 닫혔는지 봅니다.", 말: '"조치한 거 확인해줘"라고 물어보세요.' },
  5: { 일: "결과를 위에 올릴 수 있는 형태로 정리합니다 — 리포트·KPI·규정 대응.", 말: '"이번 주 보고서 만들어줘"라고 하세요.' },
};

/**
 * 질문에 단계 이름이 들어 있으면 그 번호. 없으면 null(전체 현황).
 *
 * ★ 2026-08-04 2차: 「단계·절차」라는 **말을 안 쓴** 절차 질문 3건이 남아 있었다.
 *   「우선순위 정하려면 뭘 봐야 해?」(36초) · 「조치까지 갔는데 그다음은?」(33초) ·
 *   「보고까지 끝내려면 뭐가 남았어?」(34초) — 전부 LLM+RAG로 새어 CVSS 강의를 들려줬다.
 *   1차 수정이 「단계|절차」를 요구해서 한 가족의 일부만 덮은 것이다.
 */
function 질문속단계(q: string): number | null {
  const t = String(q ?? "");
  // ① 「뭐가 남았어 · 끝내려면」은 **특정 단계가 아니라 남은 것 전부**를 묻는 말이다.
  //    전체 현황이 「제일 밀린 곳」까지 짚어 주므로 그게 답이다.
  if (/남았|끝내려면|마치려면|마무리하려면/.test(t)) return null;

  let 단계: number | null = null;
  if (/발견|수집|자산\s*등록/.test(t)) 단계 = 1;
  else if (/우선\s*순위|우선순위|분류|골라|고르/.test(t)) 단계 = 2;
  else if (/조치|패치|고치/.test(t)) 단계 = 3;
  else if (/검증|재스캔|확인/.test(t)) 단계 = 4;
  else if (/보고|리포트/.test(t)) 단계 = 5;
  else {
    const m = t.match(/([1-5①-⑤])\s*단계/);
    if (m) 단계 = "①②③④⑤".indexOf(m[1]) >= 0 ? "①②③④⑤".indexOf(m[1]) + 1 : Number(m[1]);
  }
  if (단계 == null) return null;

  // ② 「조치까지 갔는데 **그다음은**?」 — 그 단계가 아니라 **그다음** 단계를 묻는 말이다.
  //    여기서 3(조치)을 답하면 이미 한 일을 다시 설명하게 된다.
  if (/그\s*다음|다음은|이후|끝나면|갔는데|마쳤/.test(t)) return Math.min(단계 + 1, 5);
  return 단계;
}

/** 「○○ 단계에서 뭘 해야 해?」 — 그 단계 하나만 짚어 준다(즉답). */
function 단계안내글(단계: number): string {
  const s = workflowStages().find((x) => x.no === 단계);
  const 할일 = 단계별할일[단계];
  if (!s || !할일) return 절차현황글();
  const 건 = s.count == null ? "값을 못 구했습니다(0이 아니라 **모름**입니다)" : `지금 ${s.count}건`;
  const 경고 = s.alert != null && s.alertLabel && s.alert > 0 ? ` · ${s.alertLabel} ${s.alert}건` : "";
  return [
    `${s.no} ${s.label} 단계 — ${건}${경고}`,
    "",
    `여기서 하는 일: ${할일.일}`,
    `보는 화면: ${s.screens.join(", ")}`,
    "",
    `${표식.다음} 지금 할 일 — ${할일.말}`,
  ].join("\n");
}

function 절차현황글(질문?: string): string {
  const 지목 = 질문 ? 질문속단계(질문) : null;
  if (지목) return 단계안내글(지목);
  const 단계들 = workflowStages();
  const 줄 = 단계들.map((s) => {
    const 건 = s.count == null ? "—" : `${s.count}건`;
    const 경고 = s.alert == null || !s.alertLabel ? "" : ` · ${s.alertLabel} ${s.alert}`;
    return `${s.no} ${s.label} — ${건}${경고}`;
  });
  const 밀린것 = 단계들
    .filter((s) => typeof s.alert === "number" && s.alert > 0 && s.alertLabel)
    .sort((a, b) => (b.alert as number) - (a.alert as number))[0];
  const 모름 = 단계들.filter((s) => s.count == null).map((s) => `${s.no} ${s.label}`);
  return [
    "업무 절차 5단계 현황",
    ...줄,
    "",
    밀린것
      ? `${표식.주의} 제일 밀린 곳은 **${밀린것.no} ${밀린것.label}** — ${밀린것.alertLabel} ${밀린것.alert}건입니다.`
      : `${표식.좋음} 지금 밀린 단계가 없습니다.`,
    모름.length ? `${표식.주의} ${모름.join(", ")}는 값을 못 구했습니다 — 0이 아니라 **모름**입니다.` : "",
    // ⚠ **숫자만 주고 끝내지 않는다**(2026-08-04 실전 147상황이 "숫자만 주고 갈 곳 없음"으로 잡음).
    //   어느 단계가 밀렸는지 알려 줬으면 **거기서 뭘 하는지**까지 이어야 대화창에서 일이 끝난다.
    밀린것
      ? `${표식.다음} 지금 할 일 — ${밀린것.no} ${밀린것.label}부터 손대세요. ` +
        (밀린것.no === 3
          ? '"미배정 취약점 담당자 배정해줘"라고 하시면 승인 창이 뜹니다.'
          : 밀린것.no === 2
            ? '"오늘 뭐부터 해야 해?"로 우선순위를 받으세요.'
            : `${밀린것.label} 화면으로 가시거나 "${밀린것.label} 어디서 해?"라고 물어보세요.`)
      : `${표식.다음} 다음 걸음 — "오늘 뭐부터 해야 해?"로 오늘 할 일을 받으세요.`,
  ].filter(Boolean).join("\n");
}

// ── SBOM 부품 수집 (2026-08-04 파트너 지적 · 계획서 중-7) ─────────────────────

/** 점검 대상을 이름이나 id로 찾는다 — 담당자는 id를 외우지 않는다. */
function 대상찾기(말: string) {
  const t = String(말 ?? "").trim().toLowerCase();
  if (!t) return undefined;
  const 목록 = listTargets();
  return (
    목록.find((x) => x.id.toLowerCase() === t) ??
    목록.find((x) => x.label.toLowerCase() === t) ??
    목록.find((x) => x.label.toLowerCase().includes(t) || x.host.toLowerCase().includes(t))
  );
}

/**
 * SBOM이 얼마나 채워졌나 — **고치기 전에 얼마나 부족한지 보여 준다.**
 *
 * ⚠ 부품 수만 말하면 "많으니 괜찮다"로 읽힌다. **직접 읽은 것과 스캐너 추정치를 갈라** 센다.
 */
function runSbomCoverage(assetId?: string): string {
  const 자산들 = assetId ? [getAsset(assetId)].filter(Boolean) : listAssets();
  if (자산들.length === 0) return assetId ? `"${assetId}" 자산을 찾지 못했습니다.` : "등록된 자산이 없습니다.";
  if (assetId) {
    const a = 자산들[0]!;
    // ★ 지원 종료(EOL)를 함께 본다(2026-08-04 파트너 지적 3번) — 지원이 끝난 부품은
    //   취약점이 나와도 **고칠 패치가 없다.** 부품 목록만 주고 끝내면 그 사실을 놓친다.
    const 끝난것: string[] = [];
    for (const c of a.components ?? []) {
      const row = eol찾기(c.name, c.version);
      if (row) 끝난것.push(`  · ${c.name} ${c.version !== "-" ? c.version : ""} — ${eol한줄(row)}`);
    }
    return [
      자산표시이름(a.id),
      덮는범위글(a.components ?? []),
      ...(끝난것.length ? ["", `${표식.주의} 지원 종료 확인이 필요한 부품 ${끝난것.length}건:`, ...끝난것.slice(0, 5)] : []),
    ].join("\n");
  }
  let 총 = 0, 실제 = 0;
  const 비어있음: string[] = [];
  for (const a of 자산들 as NonNullable<ReturnType<typeof getAsset>>[]) {
    const c = a.components ?? [];
    총 += c.length;
    const 직접 = c.filter((x) => x.from === "package").length;
    실제 += 직접;
    if (직접 === 0) 비어있음.push(자산표시이름(a.id));
  }
  return [
    `자산 ${자산들.length}개 · 구성요소 **${총}개** — 장비에서 직접 읽은 것 **${실제}개**`,
    실제 === 0
      ? `${표식.주의} 아직 **직접 읽은 부품이 하나도 없습니다.** 지금 SBOM은 스캐너가 준 제품 이름(CPE) 수준이라 패키지·라이브러리가 비어 있습니다.`
      : `${표식.주의} 직접 읽지 않은 자산 ${비어있음.length}개는 아직 제품(CPE) 수준입니다.`,
    비어있음.length ? `  · ${비어있음.slice(0, 8).join(", ")}${비어있음.length > 8 ? ` 외 ${비어있음.length - 8}개` : ""}` : "",
    "",
    `${표식.다음} 채우려면 "○○ 패키지 목록 읽어줘"라고 하세요 — 장비에 읽기 전용 명령만 보냅니다(승인 창이 뜹니다).`,
  ].filter(Boolean).join("\n");
}

/** 실제 수집 — 승인 뒤에만 돈다. */
async function runCollectPackages(말: string): Promise<string> {
  const t = 대상찾기(말);
  if (!t) return `"${말}"에 해당하는 점검 대상을 찾지 못했습니다 — 먼저 하드닝 점검 대상으로 등록해 주세요.`;
  const 윈도우 = t.standard === "kisa_pc";
  const r = await 패키지수집(targetRunner(t), 윈도우);
  if (!r.ok) return `${표식.나쁨} ${t.label} — ${r.말}`;

  // 이 대상에 맞는 자산을 찾는다. 못 찾으면 **읽은 것을 버리지 않고 그렇게 말한다.**
  //
  // ⚠ host만 보면 **local 대상은 영영 못 붙는다**(2026-08-04 실측: 789개를 읽어 놓고
  //   "local에 해당하는 자산을 못 찾았다"로 끝났다). 담당자가 붙인 **이름으로도 찾는다** —
  //   자산 검색에서 배운 것과 같다: 등록된 값 하나만 보면 사람이 쓰는 말을 못 찾는다.
  const 라벨 = t.label.trim().toLowerCase();
  const 자산 =
    listAssets().find((a) => t.host !== "local" && (a.ip === t.host || a.name.includes(t.host) || a.id.includes(t.host))) ??
    listAssets().find((a) => (a.displayName || a.name).trim().toLowerCase() === 라벨) ??
    listAssets().find((a) => (a.displayName || a.name).toLowerCase().includes(라벨) || 라벨.includes((a.displayName || a.name).toLowerCase()));
  if (!자산) {
    return (
      `${t.label}에서 ${r.말}\n` +
      `${표식.주의} 그런데 **${t.host}에 해당하는 자산을 등록부에서 못 찾아** 붙이지 못했습니다. ` +
      `자산을 먼저 등록한 뒤 다시 실행해 주세요.`
    );
  }
  const 합친것 = 구성요소합치기(자산.components ?? [], r.부품);
  updateAssetMeta(자산.id, 자산.name, 자산.owner ?? "", 합친것);
  recordAudit({
    kind: "write", actor: null, action: "패키지 목록 수집",
    target: 자산표시이름(자산.id), detail: `${r.종류} · 부품 ${r.부품.length}개`, result: "ok",
  });
  return [
    `${자산표시이름(자산.id)} — ${r.말}`,
    덮는범위글(합친것),
    `${표식.주의} 읽기만 했습니다 — 장비는 바뀌지 않았습니다.`,
  ].join("\n");
}

// 보고서 작성 현황 — **세는 것은 코드가 센다.** 절차 띠 ⑤ 보고 칸과 **같은 함수**를 쓴다.
// 따로 세면 반드시 어긋나고, 어긋난 두 숫자는 담당자가 둘 다 안 믿게 만든다.
function runReportActivity(): string {
  const a = reportActivity();
  if (!a) return "보고서 보관함을 읽지 못했습니다 — 저장 위치를 확인해 주세요.";
  const 지남 =
    a.daysSinceLast == null
      ? "아직 만든 보고서가 없습니다"
      : a.daysSinceLast === 0
        ? "마지막으로 만든 것이 오늘입니다"
        : `마지막으로 만든 지 ${a.daysSinceLast}일 됐습니다`;
  if (a.thisWeek > 0) return `이번 주에 보고서 ${a.thisWeek}건을 만들었습니다 — ${지남}.`;
  // ⚠ 0건일 때 "없습니다"로 끝내면 "그래서 뭘 하지"가 남는다.
  return `이번 주에 만든 보고서가 없습니다 — ${지남}.\n▸ 다음 단계 ⑤ 보고 — 바로 만들려면 "이번 주 취약점 보고서 만들어줘"`;
}

// 원격 정기점검(하드닝) 스케줄 조회 — [2026-07-29 평가 게이트(중-3) 첫 실행이 잡은 공백]
// "원격 정기점검 스케줄 어떻게 되어 있어?"에 자산 취약점 이야기가 나왔다. 화면(hardening.html)과
// 데이터(hardening_schedules)는 있는데 챗봇이 들여다볼 도구가 없었다 — 화면에만 있고 챗봇엔 없는
// 기능은 "화면 설명·기능 안내는 전부 챗봇으로" 원칙에 어긋난다.
function runHardeningScheduleList(): string {
  const rows = listHardeningSchedules();
  if (rows.length === 0) {
    return [
      "등록된 원격 정기점검 스케줄이 없습니다.",
      "원격 정기점검 화면에서 점검 대상(장비)을 등록하고 주기를 정하면 자동으로 돌아갑니다 — 기준은 국내 CCE(KISA U-시리즈) 또는 CIS 중에 고릅니다.",
    ].join("\n");
  }
  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString("ko-KR") : "-");
  const lines = rows.map((r) => {
    const state = r.enabled ? "가동" : "중지";
    const last = r.lastRunAt ? `최근 ${fmt(r.lastRunAt)} · 준수율 ${r.lastRate ?? "-"}%${r.lastFail ? ` · 취약 ${r.lastFail}건` : ""}` : "아직 실행 전";
    return `- ${r.targetLabel} — ${r.standard.toUpperCase()} 기준 · ${r.intervalHours}시간마다 · ${state} · 다음 ${fmt(r.nextRunAt)} (${last})`;
  });
  const on = rows.filter((r) => r.enabled).length;
  return [`원격 정기점검 스케줄 ${rows.length}건(가동 ${on} · 중지 ${rows.length - on})`, ...lines].join("\n");
}

// 통합 보안 분석(관제) 현황 — 제품 1차 목표 화면(analysis.html). 취약점·보안로그·운영리포트·
// 하드닝 4소스를 정규화한 이벤트를 그대로 요약하고, 소스 간 상관관계(같은 자산이 여러 소스에
// 동시 출현)도 함께 짚어준다.
function runAnalysisStatus(): string {
  const events = listAnalysisEvents();
  const s = analysisSummary(events);
  if (s.total === 0) return "현재 미해결 통합 분석 이벤트가 없습니다(취약점·보안로그·운영리포트·하드닝 4소스 기준).";
  const head = `통합 분석 이벤트 ${s.total}건(종합위험 ${s.overall}) — 취약점 ${s.bySource.vuln} · 보안로그 ${s.bySource.log} · 운영리포트 ${s.bySource.product} · 하드닝 ${s.bySource.hardening}`;
  const pri = `우선순위: P0 ${s.byPriority.P0} · P1 ${s.byPriority.P1} · P2 ${s.byPriority.P2} · P3 ${s.byPriority.P3}`;
  const top = events
    .filter((e) => e.status !== "done" && e.status !== "ignored")
    .slice(0, 8)
    .map((e) => `- [${e.priority}] ${e.title} (${e.entity})`);
  const corr = computeCorrelations(events)
    .slice(0, 3)
    .map((c) => `- ${c.note}`);
  return [head, pri, top.length ? `최우선 항목:\n${top.join("\n")}` : "", corr.length ? `상관관계:\n${corr.join("\n")}` : ""].filter(Boolean).join("\n");
}


/**
 * 지금 손댈 일 — 보안 KPI의 나쁜 값만 골라 **할 일 줄**로 낸다.
 *
 * 왜 서버로 옮겼나(2026-08-02 사용자 지시 "화면에서는 숨기거나 삭제, 대화창에서 가이드"):
 *   같은 목록을 보안 KPI 화면이 자기 자바스크립트로 따로 만들고 있었다. 규칙이 두 벌이면
 *   한쪽만 고쳐진다 — 실제로 화면 쪽에는 "0이면 줄을 만들지 않는다"는 규칙이 있는데
 *   대화창에는 그런 개념 자체가 없었다. 규칙은 여기 하나로 둔다.
 *
 * 원칙 — **숫자가 0이면 줄을 만들지 않는다.** 할 일이 없는데 있는 척하면 목록을 안 믿게 된다.
 * ⚠ 스캔 실패는 취약점 줄과 **섞지 않는다**. 스캐너를 고칠 일이지 취약점이 아니다.
 */
async function runUrgentTodo(): Promise<string> {
  const s = await computeKpiSnapshot();
  const a = s.aiSecurity;
  const 후보 = [
    { n: s.vulnerabilities.kev, p: "P0", 무엇: `실제 악용(KEV) ${s.vulnerabilities.kev}건`,
      왜: "공격이 실제로 쓰이는 취약점 — 이번 주 안에 막아야 합니다", 어디: "취약점" },
    { n: s.remediation.overdue, p: "P0", 무엇: `기한 지난 조치 ${s.remediation.overdue}건`,
      왜: "약속한 날짜를 넘긴 일 — SLA 준수율을 깎고 있습니다", 어디: "조치·승인" },
    { n: s.findings.pending, p: "P1", 무엇: `검토 대기 항목 ${s.findings.pending}건`,
      왜: "맞는지 오탐인지 아직 아무도 안 본 것(스캐너가 올린 낱개 기준)", 어디: "조치·승인" },
    { n: s.assets.highRisk, p: "P1", 무엇: `고위험 자산 ${s.assets.highRisk}대`,
      왜: "위험이 몰린 장비 — 여기부터 손대면 점수가 가장 많이 오릅니다", 어디: "자산 통합 뷰" },
    { n: s.findings.scanFailed, p: "P2", 무엇: `스캔이 안 된 자산 ${s.findings.scanFailed}건`,
      왜: "스캐너가 결과를 못 받았습니다 — 접속 정보·권한 문제이지 취약점이 아닙니다", 어디: "자산 통합 뷰" },
    { n: s.inspections.overdue, p: "P2", 무엇: `지연된 정기점검 ${s.inspections.overdue}건`,
      왜: "기한이 지난 유지보수 점검 — 점검서를 올리면 관리자 승인으로 닫힙니다", 어디: "유지보수 점검" },
    { n: s.inspections.pendingApproval, p: "P2", 무엇: `점검 보고서 검토 대기 ${s.inspections.pendingApproval}건`,
      왜: "담당자가 점검서를 올렸는데 아직 승인·반려가 안 됐습니다", 어디: "유지보수 점검" },
    { n: a && a.aiAssets && a.avgRobustness == null ? a.aiAssets : 0, p: "P2", 무엇: "AI 자산 견고성 미점검",
      왜: "AI 자산은 있는데 공격 저항력을 한 번도 안 재봤습니다", 어디: "레드팀·가드레일" },
  ].filter((x) => x.n > 0);

  if (!후보.length) {
    return "지금 손댈 일: 급한 건이 없습니다 — 보안 KPI에 나쁜 값이 잡히면 여기에 줄이 생깁니다.";
  }
  const 줄 = 후보.map((x, i) => `${i + 1}. [${x.p}] ${x.무엇}
   ${x.왜} · 화면: ${x.어디}`);
  return [
    `지금 손댈 일 ${후보.length}건 (보안 KPI에서 나쁜 값만 골랐습니다):`,
    ...줄,
    "",
    "할 일로 담으려면 그대로 말씀하세요 — 예: \"기한 지난 조치 마무리를 할 일로 담아줘\"",
  ].join("\n");
}

// 통합 보안 KPI 현황(kpi.html) — 자산 위험도·취약점·조치 SLA·점검·컴플라이언스를 한 스냅샷으로.
async function runKpiStatus(): Promise<string> {
  const s = await computeKpiSnapshot();
  const lines = [
    `자산 ${s.assets.total}건(고위험 ${s.assets.highRisk} · 중위험 ${s.assets.midRisk} · 저위험 ${s.assets.lowRisk})`,
    `취약점 활성 ${s.vulnerabilities.active}건(Critical ${s.vulnerabilities.critical} · High ${s.vulnerabilities.high} · KEV ${s.vulnerabilities.kev}) · 조치율 ${s.vulnerabilities.remediationRate}%` +
      // 점검 실패는 취약점이 아니지만 **감추면 안 된다** — 스캔이 안 돌고 있다는 뜻이라
      // "취약점 0건"이 안전하다는 뜻이 아니게 된다(2026-08-01: 602건이 전부 스캔 오류였다).
      (s.vulnerabilities.scanFailed
        ? ` ⚠ 점검 실패 ${s.vulnerabilities.scanFailed}건 — 스캐너가 결과를 못 받았습니다. 이만큼은 아직 안 본 것입니다`
        : ""),
    `조치 SLA 준수율 ${s.remediation.slaCompliance}%(기한초과 ${s.remediation.overdue}건 · 마감임박 ${s.remediation.dueSoon}건)`,
    `점검 ${s.inspections.total}건(지연 ${s.inspections.overdue} · 승인대기 ${s.inspections.pendingApproval})`,
    `컴플라이언스 이행률 ${s.compliance.coverageRate}%(${s.compliance.covered}/${s.compliance.total})`,
  ];
  return `보안 KPI 현황(${s.date}):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

// 작업 세션(대화 세션형, sessions.html) 현황 — 최근 대화 이력을 챗봇이 그대로 알 수 있게 한다.
// ── 내 업무(할 일) — 화면을 없애고 대화창에서 한다 ─────────────────────────
//
// 사용자 지시(2026-08-01): "내업무 메뉴는 삭제하고 그안에 있는 모든 내용은 대화창에서
// 처음부터 나오고 선택하고 해당 대화창에서 모든 업무를 했으면 좋겠어" +
// "메뉴는 보기용도, 대화창에서 입력 및 설정 다 한다가 핵심 기능".
//
// ⚠ 순서는 **서버가 정한다**(mywork.buildMyWork). AI가 우선순위를 지어내면 담당자가
//   그 근거를 되짚을 수 없다 — 오늘 할 일은 규칙으로 계산하고 모델은 문장만 다듬는다.

/**
 * 열린 할 일 중에서 담당자가 말한 것을 찾는다 — 완료·절차·단계가 같은 규칙을 쓴다.
 *
 * ⚠ 셋이 각자 찾으면 "완료는 되는데 절차는 못 찾는" 어긋남이 생긴다(이 저장소 반복 사례).
 */
function 열린할일찾기(말: string): { hit: ReturnType<typeof listTasks>[number] | undefined; 열린것: ReturnType<typeof listTasks> } {
  const 열린것 = listTasks().filter((t) => !t.done);
  const 납작 = (s: string) => s.replace(/\s/g, "");
  const hit = 열린것.find((t) => t.text === 말) ??
    열린것.find((t) => 납작(t.text).includes(납작(말))) ??
    열린것.find((t) => 납작(말).includes(납작(t.text)));
  return { hit, 열린것 };
}

/**
 * 목록에는 보이는데 tasks에는 없는 것 — **아직 안 담은 AI 제안**을 찾아 담는다.
 *
 * ★ 2026-08-01 실측으로 드러난 구멍: 목록 맨 앞 「지금 이거」가 AI 제안일 때가 있는데,
 *   목록은 "○○ 어떻게 해?"라고 물으라 안내한다. 그런데 tasks에만 있는 걸 찾으니 늘 못 찾았다
 *   — 담당자 눈엔 "방금 보여준 걸 모른다"로 보인다. 화면에서는 「내 업무에 담기」 버튼이
 *   이 일을 했다. 대화창에는 버튼이 없으니 **묻는 순간 담고, 담았다고 말한다**(조용히 하지 않는다).
 */
async function 제안담기(말: string): Promise<ReturnType<typeof listTasks>[number] | null> {
  const 납작 = (s: string) => s.replace(/\s/g, "");
  let p: Awaited<ReturnType<typeof buildMyWork>>;
  try { p = await buildMyWork(); } catch { return null; }
  const 후보 = [...p.today, ...p.week, ...p.later].filter((i) => !i.saved);
  const 제안 = 후보.find((i) => i.text === 말) ??
    후보.find((i) => 납작(i.text).includes(납작(말))) ??
    후보.find((i) => 납작(말).length >= 4 && 납작(말).includes(납작(i.text)));
  if (!제안) return null;
  // 화면이 지키던 규칙 그대로 — AI 제안은 기한을 오늘로 잡는다(안 그러면 '나중에'로 밀려
  // 담자마자 오늘 목록에서 사라진다).
  createTask({ text: 제안.text, ref: 제안.ref, origin: 제안.origin, dueAt: 제안.dueAt ?? Date.now() });
  return listTasks().find((t) => !t.done && t.text === 제안.text) ?? null;
}

/** 절차 카드 한 장 — 끝낸 단계·지금 할 단계·남은 단계를 한눈에. */
function 절차카드(t: ReturnType<typeof listTasks>[number]): string {
  const g = 가이드가져오기(t.guideKey);
  // ★ 순서를 **지어내지 않는다**. 가이드가 없으면 없다고 말하고 물어볼 말을 준다
  //   (mywork.html이 지키던 원칙 — 화면을 없애면서 같이 잃으면 안 된다).
  if (!g) {
    return `"${t.text}"에는 정해진 절차가 없습니다.\n` +
      `▸ 이 일이 무엇인지 물어보시면 아는 만큼 답합니다 — 예: "${t.text} 뭐부터 봐야 해?"\n` +
      `▸ 끝내셨으면 "${t.text} 완료"`;
  }
  const 끝난 = new Set(t.guideDone ?? []);
  const 다음번호 = g.steps.findIndex((_, i) => !끝난.has(i));
  const 줄 = g.steps.map((s, i) => {
    const 표 = 끝난.has(i) ? "✓" : i === 다음번호 ? "▸" : "☐";
    const 곁 = s.desc ? ` — ${s.desc}` : "";
    return `${표} ${i + 1}. ${s.title}${곁}`;
  }).join("\n");
  const 기한지남 = typeof t.dueAt === "number" && t.dueAt < Date.now();
  const 머리 = `**${t.text}** · 절차 ${끝난.size}/${g.steps.length}` + (기한지남 ? " ⚠ 기한 지남" : "");
  if (다음번호 < 0) {
    return `${머리}\n${줄}\n\n▸ 절차를 다 밟으셨습니다 — 끝내려면 "${t.text} 완료"`;
  }
  const 다음 = g.steps[다음번호];
  // ⚠ {업무}는 **치환해서 내보낸다**. 화면이 하던 일인데, 안 하면 담당자가 "{업무} — 이
  //   취약점을 …"을 그대로 복사해 물어 엉뚱한 답을 받는다(화면 시험이 이걸 지키고 있었다).
  const 물음 = 다음.question ? 다음.question.replace(/\{업무\}/g, t.text) : "";
  const 힌트 = 다음.kind === "ask" && 물음 ? `\n▸ 이렇게 물으시면 됩니다 — "${물음}"`
    // ⚠ 화면 **파일명을 담당자에게 내보내지 않는다**(검토 지적: "vulnscan.html 화면을 보시면
    //   됩니다"가 그대로 나갔다). 한글 메뉴 이름으로 바꿔 말한다 — 모든 사용자 대상 텍스트는
    //   한글이라는 원칙이자, 파일명으로는 어느 메뉴인지 알 수 없다.
    : 다음.kind === "open" && 다음.page ? `\n▸ 「${화면이름(다음.page)}」 메뉴를 보시면 됩니다` : "";
  return `${머리}\n${줄}${힌트}\n\n▸ ${다음번호 + 1}번을 끝내셨으면 "${다음번호 + 1}번 했어"`;
}

async function runRoutineTasks(): Promise<string> {
  let 목록: Awaited<ReturnType<typeof routineSuggestions>>;
  try { 목록 = await routineSuggestions(); } catch { 목록 = []; }
  if (!목록.length) {
    return "아직 자주 하는 업무로 잡힌 것이 없습니다.\n" +
      "▸ 몇 번 직접 담으시면 그 일이 여기 올라옵니다 — 예: \"할 일 추가: 방화벽 정책 점검\"";
  }
  const 줄 = 목록.map((r) => `· [${r.cadence === "daily" ? "매일" : "매주"}] ${r.text}` +
    (r.source ? ` — ${r.source}` : "")).join("\n");
  return `자주 하는 업무 **${목록.length}건**\n${줄}\n\n` +
    `▸ 담으려면 "할 일 추가: ${목록[0].text}"`;
}

async function runWorkSteps(args: Record<string, string>): Promise<string> {
  const 말 = (args.task ?? "").trim();
  if (!말) return "어떤 일의 절차인지 알려주세요 — 예: \"방화벽 점검 어떻게 해?\"";
  const { hit, 열린것 } = 열린할일찾기(말);
  if (hit) return 절차카드(hit);
  const 담은것 = await 제안담기(말); // 아직 안 담은 AI 제안이면 담고 연다
  if (담은것) return `AI가 제안한 일이라 **내 업무에 담고** 절차를 엽니다.\n\n` + 절차카드(담은것);
  // 실측(2026-08-03 실전 147상황): "AhnLab V3 정책 점검 어떻게 해?"가 여기까지 와서
  //   "할 일 22건 중 못 찾았습니다"로 끝났다. 담당자가 물은 것은 **보안제품 운영 절차**인데
  //   내 할 일 목록을 뒤진 답을 받은 것이다 — 숫자만 주고 갈 곳이 없다.
  // ⚠ 라우팅을 바꾸지 않는다(지금 잘 도는 것을 건드리는 위험을 안 진다).
  //   **막다른 길을 이정표로** 바꾼다: 등록된 제품 이름이 섞여 있으면 그쪽 길을 알려 준다.
  const 제품 = 말한제품찾기(말);
  if (제품) {
    return (
      `"${말}"은 제 할 일 목록에 없습니다 — **${제품.name}**은 등록된 보안제품이라 운영 절차는 그 제품의 사내 자료에 있습니다.\n` +
      `▸ "${제품.name} 점검 절차 알려줘"라고 물으시면 매뉴얼에서 찾아 드립니다.\n` +
      `▸ 이 일을 계속 관리하시려면 "할 일 추가: ${말}"`
    );
  }
  return (
    `전체 ${열린것.length}건 중 "${말}"에 맞는 할 일을 못 찾았습니다.\n` +
    `▸ 목록부터 보시려면 "오늘 할 일"\n` +
    `▸ 새로 담으시려면 "할 일 추가: ${말}"`
  );
}

/** 말 속에 등록된 보안제품 이름이 들어 있는가. 짧은 이름이 아무 데나 걸리지 않게 3글자 이상만 본다. */
function 말한제품찾기(말: string): { name: string } | null {
  const 눌러 = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const t = 눌러(말);
  let 최선: { name: string } | null = null;
  try {
    for (const p of listProducts()) {
      const n = 눌러(p.name ?? "");
      if (n.length < 3 || !t.includes(n)) continue;
      if (!최선 || n.length > 눌러(최선.name).length) 최선 = { name: p.name };   // 긴 이름이 더 확실하다
    }
  } catch { return null; }
  return 최선;
}

async function runStepDone(args: Record<string, string>): Promise<string> {
  const 번호 = Number((args.step ?? "").replace(/[^0-9]/g, ""));
  const 말 = (args.task ?? "").trim();
  // 일감을 안 적었으면 **진행 중인 것**을 집는다 — 대화창에서는 "1번 했어"만 말하는 게 자연스럽다.
  const 열린것 = listTasks().filter((t) => !t.done);
  const hit = (말 ? 열린할일찾기(말).hit : undefined)
    ?? (말 ? await 제안담기(말) ?? undefined : undefined)
    ?? 열린것.find((t) => (t.guideDone?.length ?? 0) > 0 && 가이드가져오기(t.guideKey))
    ?? 열린것.find((t) => 가이드가져오기(t.guideKey));
  if (!hit) {
    return 말 ? `전체 ${열린것.length}건 중 "${말}"에 맞는 할 일을 못 찾았습니다.`
      : "어떤 일의 단계인지 모르겠습니다 — \"○○ 어떻게 해?\"로 절차를 먼저 여세요.";
  }
  const g = 가이드가져오기(hit.guideKey);
  if (!g) return 절차카드(hit); // 절차가 없으면 없다고 말한다(카드가 그 말을 한다)
  if (!Number.isInteger(번호) || 번호 < 1 || 번호 > g.steps.length) {
    return `"${hit.text}"의 절차는 1~${g.steps.length}번입니다. 몇 번을 끝내셨는지 알려주세요.`;
  }
  const 뒤 = setGuideStepDone(hit.id, 번호 - 1, true);
  if (!뒤) return `"${hit.text}" 단계를 기록하지 못했습니다.`;
  return `${번호}번 「${g.steps[번호 - 1].title}」 끝낸 것으로 적었습니다.\n\n` + 절차카드(뒤) +
    `\n▸ 잘못 눌렀으면 "${번호}번 취소"`;
}

async function runStepUndo(args: Record<string, string>): Promise<string> {
  const 번호 = Number((args.step ?? "").replace(/[^0-9]/g, ""));
  const 말 = (args.task ?? "").trim();
  const 열린것 = listTasks().filter((t) => !t.done);
  const hit = 말 ? 열린할일찾기(말).hit : 열린것.find((t) => (t.guideDone?.length ?? 0) > 0);
  if (!hit) return "되돌릴 단계를 못 찾았습니다 — \"○○ 어떻게 해?\"로 절차를 먼저 여세요.";
  const g = 가이드가져오기(hit.guideKey);
  if (!g || !Number.isInteger(번호) || 번호 < 1 || 번호 > g.steps.length) {
    return `"${hit.text}"의 절차 번호가 올바르지 않습니다.`;
  }
  const 뒤 = setGuideStepDone(hit.id, 번호 - 1, false);
  if (!뒤) return `"${hit.text}" 단계를 되돌리지 못했습니다.`;
  return `${번호}번을 다시 열었습니다.\n\n` + 절차카드(뒤);
}

async function runCompleteTask(args: Record<string, string>): Promise<string> {
  const 말 = (args.task ?? "").trim();
  if (!말) return "어떤 일을 끝내셨는지 알려주세요 — 예: \"방화벽 점검 완료\"";
  const { hit: 찾음, 열린것 } = 열린할일찾기(말);
  // 안 담은 AI 제안을 "끝냈다"고 하는 경우도 있다 — 담아 두고 곧장 완료로 넘긴다.
  // (담지 않고 넘기면 끝낸 기록이 어디에도 안 남아 "했는데 또 올라온다"가 된다.)
  const hit = 찾음 ?? (await 제안담기(말));
  if (!hit) {
    return `전체 ${열린것.length}건 중 "${말}"에 맞는 할 일을 못 찾았습니다. "오늘 할 일"이라고 물어 목록부터 보세요.`;
  }
  // ★ completeTask가 아니라 **setTaskDone**이다(검토 지적 2026-08-01). completeTask는
  //   nextRecurrence를 안 불러 **반복 업무의 다음 차례가 안 생긴다** — 주간 점검을 끝냈다고
  //   말했는데 다음 주 것이 안 올라오면 점검 이력이 조용히 끊긴다. 옛 화면은 체크박스가
  //   setTaskDone을 타서 멀쩡했다.
  setTaskDone(hit.id, true);
  const 반복 = hit.recur ? `
▸ ${hit.recur === "weekly" ? "매주" : "매월"} 반복이라 다음 차례를 새로 만들었습니다.` : "";
  // 되돌릴 길을 함께 준다 — 결재판 없이 즉시 처리하는 대신 **되돌리기가 있어야** 안심된다.
  return `"${hit.text}" 완료로 옮겼습니다.\n▸ 되돌리려면 "${hit.text} 다시 열어줘"`;
}

function runAddTask(args: Record<string, string>): string {
  const 글 = (args.text ?? "").trim();
  if (!글) return "무엇을 담을지 알려주세요 — 예: \"할 일 추가: 방화벽 정책 점검\"";
  const 기한말 = (args.due ?? "").trim();
  const DAY = 86400000;
  const dueAt =
    /오늘|today/.test(기한말) ? Date.now() :
    /이번\s*주|주간|week/.test(기한말) ? Date.now() + 6 * DAY :
    undefined;
  // ★ 반복 — 옛 화면에는 매주·매월로 담는 길이 있었는데 대화창에 없었다(검토 지적).
  //   화면을 없애면서 **매주 담기 자체가 불가능**해졌다. 안내 패널은 여전히 반복을 말한다.
  const 반복말 = (args.recur ?? "") + " " + 기한말 + " " + 글;
  const recur = /매주|주간|weekly/.test(반복말) ? "weekly" as const
    : /매월|월간|monthly|달마다/.test(반복말) ? "monthly" as const : undefined;
  const t = createTask({ text: 글, ...(dueAt ? { dueAt } : {}), ...(recur ? { recur } : {}) });
  // ★ 화면이 남기던 기록을 그대로 남긴다(검토 지적) — 누가 언제 무엇을 담았는지.
  //   덤으로 '자주 하는 업무' 추천이 학습 신호를 받는다(안 남기면 추천이 갈수록 무뎌진다).
  recordRoutineFeedback(글);
  recordAudit({
    kind: "config", actor: "담당자", action: "내 업무에 담기", target: t.id,
    detail: `${글}${t.guideKey ? ` · 가이드 ${t.guideKey}` : " · 가이드 없음"}${recur ? ` · ${recur}` : ""} · 대화창`,
    result: "ok",
  });
  const 반복표 = recur ? ` · ${recur === "weekly" ? "매주" : "매월"} 반복` : "";
  return `"${t.text}"를 오늘 할 일에 담았습니다.${dueAt ? "" : " (기한은 안 정했습니다)"}${반복표}\n▸ 끝내면 "${t.text} 완료"`;
}

/** 잘못 끝낸 일을 다시 연다. 완료 답변이 "다시 열어줘"라고 **약속**하므로 반드시 있어야 한다. */
function runReopenTask(args: Record<string, string>): string {
  const 말 = (args.task ?? "").trim();
  if (!말) return "어떤 일을 다시 열지 알려주세요 — 예: \"방화벽 점검 다시 열어줘\"";
  const 납작 = (s: string) => s.replace(/\s/g, "");
  const 끝난것 = listTasks().filter((t) => t.done);
  const hit = 끝난것.find((t) => t.text === 말) ??
    끝난것.find((t) => 납작(t.text).includes(납작(말))) ??
    끝난것.find((t) => 납작(말).length >= 4 && 납작(말).includes(납작(t.text)));
  if (!hit) return `끝낸 일 ${끝난것.length}건 중 "${말}"에 맞는 것을 못 찾았습니다.`;
  setTaskDone(hit.id, false);
  return `"${hit.text}"를 다시 열었습니다. 오늘 할 일에 돌아와 있습니다.`;
}

function runWorkSessionStatus(args: Record<string, string>): string {
  const sessions = listWorkSessions();
  if (!sessions.length) return "작업 내역이 없습니다.";
  const status = (args.status ?? "").trim();
  const filtered = status === "active" || status === "done" ? sessions.filter((s) => s.status === status) : sessions;
  const STATUS_LABEL: Record<string, string> = { active: "진행중", done: "완료", ignored: "무시" };
  // ⚠ 내부 영문 상태값을 그대로 내보내면 담당자는 못 읽는다 — 바로 아래 한글 이름표가
  //   이미 있는데 여기서만 안 썼다(2026-08-01 챗봇 전수에서 발견).
  if (!filtered.length) return `${STATUS_LABEL[status] ?? status} 상태의 작업 내역이 없습니다.`;
  const active = sessions.filter((s) => s.status === "active").length;
  const done = sessions.filter((s) => s.status === "done").length;
  const top = filtered.slice(0, 8).map(
    (s) => `- [${STATUS_LABEL[s.status] ?? s.status}] ${s.title}${s.turnCount ? ` (턴 ${s.turnCount}건)` : ""}${s.lastPreview ? ` · 최근 "${s.lastPreview.slice(0, 30)}"` : ""}`
  );
  return `작업 내역 ${sessions.length}건 — 진행중 ${active} · 완료 ${done}\n최근 작업:\n${top.join("\n")}`;
}

// ── 「지식·모델」 도메인 도구 ────────────────────────────────────────────
// 답변 품질은 지식베이스가 좌우한다. "무엇이 들어 있고 얼마나 연결됐는가"를 본다.
// ── 작업 기록(감사) 조회 ────────────────────────────────────────────────
// "지난주에 누가 뭘 지웠어?"는 사고 조사에서 가장 먼저 나오는 질문인데, 지금까지는 감사 화면을
// 눈으로 훑어야 답할 수 있었다(2026-07-27 도구 공백 점검). 기록은 이미 다 쌓여 있었다.
async function runAuditSearch(args: Record<string, string>): Promise<string> {
  const q = (args.query ?? "").trim();
  const days = Math.min(Math.max(Number(args.days ?? 7) || 7, 1), 90);
  const since = Date.now() - days * 86400000;
  // 넉넉히 받아 기간·검색어로 거른다(감사 테이블은 최신순 정렬이라 앞쪽만 봐도 충분하다).
  const rows = listAudit({ limit: 1000 }).filter((e: AuditEntry) => e.at >= since);
  const hit = q
    ? rows.filter((e) =>
        [e.action, e.target, e.actor, e.detail].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())))
    : rows;
  if (hit.length === 0) {
    return `최근 ${days}일 작업 기록에서 ${q ? `"${q}"에 해당하는 ` : ""}내역을 찾지 못했습니다.`;
  }
  const failed = hit.filter((e) => e.result !== "ok").length;
  const byActor = hit.reduce<Record<string, number>>((a, e) => {
    const who = e.actor ?? "(알 수 없음)";
    a[who] = (a[who] ?? 0) + 1;
    return a;
  }, {});
  const lines = hit.slice(0, 12).map((e) =>
    `- ${koDateTimeString(e.at)} · ${e.actor ?? "?"} · ${e.action}${e.target ? ` → ${e.target}` : ""}` +
    `${e.result !== "ok" ? ` [${e.result}]` : ""}`);
  return [
    `최근 ${days}일 ${q ? `"${q}" ` : ""}작업 기록 ${hit.length}건${failed ? ` (실패·차단 ${failed}건)` : ""}`,
    `사람별: ${Object.entries(byActor).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    "",
    ...lines,
    hit.length > 12 ? `… 외 ${hit.length - 12}건 (작업 기록 화면에서 전체 확인)` : "",
  ].filter(Boolean).join("\n");
}

// ── 인수인계 진행 상황 ──────────────────────────────────────────────────
// 인수인계는 4단계 마법사인데 "어디까지 됐나"를 물어볼 길이 없었다.
// 담은 문서는 담당자 브라우저에만 있어 서버가 모른다 — 지식베이스 쪽 사실만 정직하게 답한다.
async function runHandoverStatus(): Promise<string> {
  const docs = await listVisibleDocuments();
  if (docs.length === 0) {
    return "아직 지식베이스에 올린 문서가 없습니다. 인수인계는 아래 대화 콘솔의 ＋로 문서를 올리는 것부터 시작합니다.";
  }
  const chunks = docs.reduce((n, d) => n + (d.chunks ?? 0), 0);
  const recent = docs.slice(-5).reverse().map((d) => `- ${d.documentId}`);
  return [
    `지식베이스에 문서 ${docs.length}건(조각 ${chunks}개)이 쌓여 있습니다 — 인수인계에 담을 수 있는 자료입니다.`,
    "",
    "최근 올린 문서:",
    ...recent,
    "",
    "⚠ 어떤 문서를 이번 인수인계에 담았는지와 검증 통과율은 담당자 PC에 저장되어 서버가 알지 못합니다.",
    "   인수인계 화면에서 [검증 시작]을 눌러야 통과율이 나오고, 그 결과만 감사 기록에 남습니다.",
  ].join("\n");
}

// ── 서버 로그 상태 ──────────────────────────────────────────────────────
// "서버에 오류 났어?"에 답한다. 실제 로그 파일이 아니라 감사 기록의 실패·차단을 본다 —
// 담당자가 알아야 하는 건 "무엇이 실패했나"이고, 그건 감사 기록에 남는다.
async function runSystemLogStatus(args: Record<string, string>): Promise<string> {
  const days = Math.min(Math.max(Number(args.days ?? 1) || 1, 1), 30);
  const since = Date.now() - days * 86400000;
  const rows = listAudit({ limit: 1000 }).filter((e: AuditEntry) => e.at >= since);
  const bad = rows.filter((e) => e.result !== "ok");
  if (rows.length === 0) return `최근 ${days}일간 기록된 작업이 없습니다.`;
  if (bad.length === 0) return `최근 ${days}일간 작업 ${rows.length}건 모두 정상 처리됐습니다. 실패·차단 없음.`;
  const byResult = bad.reduce<Record<string, number>>((a, e) => {
    a[e.result] = (a[e.result] ?? 0) + 1;
    return a;
  }, {});
  return [
    `최근 ${days}일간 작업 ${rows.length}건 중 ${bad.length}건이 정상 처리되지 않았습니다.`,
    `구분: ${Object.entries(byResult).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    "",
    ...bad.slice(0, 10).map((e) =>
      `- ${koDateTimeString(e.at)} · ${e.actor ?? "?"} · ${e.action}${e.target ? ` → ${e.target}` : ""} [${e.result}]` +
      `${e.detail ? `\n    ${e.detail.slice(0, 120)}` : ""}`),
  ].join("\n");
}

// ── 온톨로지(표준 코드 교차연결) 조회 ───────────────────────────────────
// KISA·OWASP·NIST·CWE·ATT&CK·ATLAS 코드가 서로 어떻게 연결돼 있는지 묻는 길이 없었다.
// 이 교차연결은 제품 차별점인데 챗봇으로 확인이 안 됐다(2026-07-27).
async function runOntologyQuery(args: Record<string, string>): Promise<string> {
  const q = (args.query ?? "").trim();
  if (!q) return "무엇의 연결 관계를 찾을지 알려주세요. 예: \"CWE-79 뭐랑 연결돼 있어?\"";
  const total = countTriples();
  if (total === 0) return "온톨로지에 등록된 관계가 없습니다. 표준 번들을 먼저 임포트하세요.";
  const rel = expandOntology(q, undefined, { hops: 2, limit: 15 });
  if (rel.length === 0) {
    return `"${q}"와 연결된 관계를 찾지 못했습니다 (전체 ${total}개 관계 중). 표준 코드(CWE-79·A03:2021 등)나 정확한 이름으로 물어보세요.`;
  }
  return [
    `"${q}" 관련 연결 ${rel.length}건 (전체 ${total}개 관계에서):`,
    "",
    ...rel.map((t) => `- ${t.subject} —[${t.predicate}]→ ${t.object}${t.source ? ` (출처: ${t.source})` : ""}`),
  ].join("\n");
}

async function runKnowledgeStatus(): Promise<string> {
  const docs = await listVisibleDocuments(); // lancedb 조회라 비동기다
  const triples = countTriples();
  if (docs.length === 0 && triples === 0) return "등록된 지식 자료가 없습니다. 문서를 먼저 인입하세요.";

  const chunks = docs.reduce((n, d) => n + (d.chunks ?? 0), 0);
  const byScope = docs.reduce<Record<string, number>>((acc, d) => {
    const s = d.scope ?? "global";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const head = `장기기억 문서 ${docs.length}건 (조각 ${chunks}개), 온톨로지 트리플 ${triples}개`;
  const scopes = `범위별: ${Object.entries(byScope).map(([s, n]) => `${s} ${n}`).join(", ")}`;
  const recent = docs.slice(-5).map((d) => `- ${d.documentId}`).reverse();
  return `${head}\n${scopes}\n최근 인입:\n${recent.join("\n")}`;
}

// ── 지식 번들 현황·반입 (후-3 구독화 코드 슬라이스) ────────────────────────
//
// knowledge_status(장기기억 문서/트리플 재고)와 **다른 도구**다. 이쪽은 "제품에 실려 나가는
// 표준·위협·법령 지식이 **언제 기준인가**"를 본다 — 구독의 본질은 "얼마나 최신인가"라서다.

/** CalVer "2026.07-1" → "2026년 7월 기준". 지식은 기능이 아니라 "언제의 세상인가"가 본질이다. */
function 번들언제기준(version: string): string {
  const m = /^(\d{4})\.(\d{1,2})/.exec(version);
  return m ? `${m[1]}년 ${Number(m[2])}월 기준` : `${version} 기준`;
}

async function runKnowledgeBundleStatus(): Promise<string> {
  const s = getBundleStatus();
  const lines: string[] = [];
  lines.push(`지금 실린 지식: ${번들언제기준(s.bundleVersion)} (번들 ${s.bundleVersion})`);
  lines.push(`· 표준 지식 ${s.ontology.sources.length}종 · 관계 ${s.ontology.triples.toLocaleString()}개(온톨로지 트리플)`);
  lines.push(`· 지식 문서 ${s.docs.total}건${s.docs.withFile < s.docs.total ? ` (파일 확인 ${s.docs.withFile}건)` : ""}`);
  if (s.applied) {
    const when = koDateTimeString(s.applied.at);
    lines.push(`· 마지막 적용: ${when}${s.upToDate ? " · 최신" : " · ⚠ 코드가 실은 버전과 다름(재적용 필요)"}`);
  } else {
    lines.push("· 아직 한 번도 적용되지 않았습니다 — 「지식 번들 넣어줘」 또는 서버 재기동으로 적용됩니다.");
  }
  lines.push("· 출처 표시: MITRE(ATT&CK·ATLAS·CWE)·OWASP·NIST·KISA — 재배포 고지 포함");

  // 반입 대기 폴더 — 담당자가 파일로 받아 둔 번들이 있으면 여기서 골라 넣는다.
  const inbox = listInboxBundles();
  if (inbox.length) {
    lines.push("");
    lines.push("반입 대기 중인 번들:");
    for (const b of inbox) {
      if (b.ok) {
        const 발행 = (b.issuedAt ?? "").slice(0, 10);
        lines.push(`· ${b.file} — 버전 ${b.version} (${번들언제기준(b.version ?? "")}${발행 ? `, 발행 ${발행}` : ""})`);
      } else {
        lines.push(`· ${b.file} — ⚠ 반입 불가: ${b.reason}`);
      }
    }
    if (inbox.some((b) => b.ok)) lines.push('넣으려면 「지식 번들 넣어줘」라고 하시면 확인창(결재판)이 뜹니다.');
  } else {
    lines.push("");
    lines.push("반입 대기 중인 번들 없음 — 새 번들 파일을 받으면 반입 대기 폴더에 두고 「지식 번들 넣어줘」라고 하세요.");
  }
  return lines.join("\n");
}

/** 대화창 반입 실행 — 결재판을 통과한 뒤에만 여기 온다. 사람 이름은 요청 꼬리표에서 찾는다. */
async function runKnowledgeBundleImport(args: Record<string, string>): Promise<string> {
  const v = currentViewer();
  const actor = (v?.userId ? findUserById(v.userId)?.displayName : null) ?? "담당자(대화창)";
  const r = await importBundleFromInbox(args.file ?? "", actor);
  if (!r.ok) return `번들을 반입하지 못했습니다 — ${r.reason}`;
  return [
    `지식 번들 ${r.version}을 반입했습니다 (${번들언제기준(r.version)}).`,
    `· 표준 지식 ${r.triplesAdded.toLocaleString()}건 적재${r.triplesReplaced ? ` (이전 ${r.triplesReplaced.toLocaleString()}건 정리 — 손으로 넣은 지식은 보존)` : ""}`,
    r.docsWritten ? `· 지식 문서 ${r.docsWritten}건 기록` : "",
    "이제부터 AI 답변은 이 버전의 지식을 근거로 씁니다.",
  ].filter(Boolean).join("\n");
}

// ── 레지스트리 ──────────────────────────────────────────────────────────

const TOOLS: AgentTool[] = [
  {
    name: "compliance_status",
    label: "컴플라이언스 이행 현황",
    domain: "report",
    write: false,
    description:
      '규제·통제 항목의 이행 현황을 본다. 미이행·진행중 항목을 먼저 보여준다 — 보고서에 담을 거리를 찾는 용도. 예: {} 또는 {"filter":"미이행"}',
    params: [{ name: "filter", label: "조건", description: "코드·항목명·상태 (선택, 비우면 전체)", required: false }],
    run: runComplianceStatus,
  },
  {
    // compliance_status(이행 현황 조회)의 짝 — 위협별 대응 상태를 기록(쓰기).
    name: "set_compliance_status",
    label: "위협 대응 상태 기록",
    domain: "report",
    write: true,
    description:
      '위협(KISA 카탈로그)의 대응 상태를 기록한다. compliance_status에서 코드(예: M06)나 위협명(예: 탈옥)을 확인해 지목. status는 covered(대응완료)·partial(부분)·na(해당없음)·open(미대응). 예: {"code":"M06","status":"covered","note":"가드레일 적용"}',
    params: [
      { name: "code", label: "위협", description: "위협 코드(M06 등) 또는 위협명(탈옥 등)", required: true },
      { name: "status", label: "대응 상태", description: "covered(대응완료)·partial(부분)·na(해당없음)·open(미대응)", required: true },
      { name: "note", label: "근거", description: "대응 근거·메모 (선택)", required: false },
    ],
    effect: (args) => {
      const t = resolveThreatCode(args.code ?? "");
      const st = normalizeComplianceStatus(args.status ?? "");
      const label: Record<string, string> = { covered: "대응완료", partial: "부분대응", na: "해당없음", open: "미대응" };
      return `위협 ${t ? `${t.code}(${t.name})` : args.code}의 대응 상태를 "${st ? label[st] : args.status}"로 기록 · 위협 카탈로그 현황에만 반영`;
    },
    undo: "컴플라이언스 화면에서 상태를 되돌릴 수 있습니다.",
    run: runSetComplianceStatus,
  },
  {
    // ★ 2026-08-04 파트너 지적(계획서 중-7): "Tenable은 CPE만 기준이라 SBOM 정보가 제한된다."
    //   맞는 지적이라 확인만 하는 창구를 먼저 낸다 — 고치기 전에 **얼마나 부족한지 보여 준다.**
    name: "sbom_coverage",
    label: "SBOM 덮는 범위",
    domain: "assets",
    write: false,
    description:
      '자산의 구성요소(SBOM 부품)가 얼마나 채워져 있는지, 그중 장비에서 직접 읽은 것과 스캐너가 준 것이 각각 몇 개인지 보여준다. "SBOM 얼마나 채워졌어?", "구성요소 현황", "부품 목록 정확해?"에 쓴다. 자산 하나만 보려면 assetId를 준다. 예: {} 또는 {"assetId":"vuln:192.168.219.98"}',
    directAnswer: true,
    params: [{ name: "assetId", label: "자산", description: "특정 자산만 볼 때 (비우면 전체)", required: false }],
    run: async (args: Record<string, string>) => runSbomCoverage(args.assetId),
  },
  {
    // ⚠ **쓰기다.** 고객 장비에 원격 접속해 명령을 돌린다 — 결재판을 반드시 거친다.
    //   명령은 읽기 전용 고정 상수이고(packagescan.ts), 시험이 그것을 지킨다.
    name: "collect_packages",
    label: "장비에서 패키지 목록 읽기",
    domain: "assets",
    write: true,
    description:
      '점검 대상 장비에 접속해 설치된 패키지 목록을 읽어 SBOM을 채운다. "패키지 목록 읽어줘", "SBOM 채워줘", "구성요소 수집해줘"에 쓴다. 대상은 하드닝 점검 대상 이름이나 id. 예: {"target":"웹서버-01"}',
    params: [{ name: "target", label: "대상 장비", description: "하드닝 점검에 등록된 대상 이름 또는 id", required: true }],
    effect: (args) => {
      // ⚠ 대상이 안 넘어왔을 때 `"undefined"`를 담당자에게 보이지 않는다 — 사람이 읽는 글자가 아니다.
      const 말 = (args.target ?? "").trim();
      if (!말) {
        const 있는것 = listTargets().slice(0, 5).map((x) => x.label).join(", ");
        return `어느 장비에서 읽을지 정해 주세요. 등록된 점검 대상: ${있는것 || "(아직 없습니다 — 하드닝 점검 대상으로 먼저 등록해 주세요)"}`;
      }
      const t = 대상찾기(말);
      if (!t) return `"${말}"에 해당하는 점검 대상을 찾지 못했습니다 — 먼저 하드닝 점검 대상으로 등록해 주세요.`;
      return (
        `${t.label}(${t.host})에 접속해 **설치된 패키지 목록을 읽습니다.** ` +
        `읽기 전용 명령만 보냅니다(rpm -qa · dpkg-query · Windows 설치 목록 조회) — 장비를 바꾸지 않습니다. ` +
        `읽은 부품은 자산 구성요소에 더해지고, 스캐너가 준 기존 값은 지우지 않습니다.`
      );
    },
    undo: "되돌리려면 자산 화면에서 구성요소를 지우면 됩니다(읽기만 했으므로 장비에는 아무 변화가 없습니다).",
    run: async (args: Record<string, string>) => runCollectPackages(args.target ?? ""),
  },
  {
    // ★ 2026-08-03 실전 147상황: 「이 취약점 조치하면 점수 얼마나 올라?」에 33.5초를 쓰고
    //   벤더 문서의 **진단 방법론**을 읽어 줬다. 점수는 computePosture가 규칙으로 내는
    //   값이라 지어낼 이유가 없다 — 감점 요인을 그대로 펼쳐 보여 준다.
    name: "posture_impact",
    label: "점수에 무엇이 영향을 주나",
    domain: "report",
    write: false,
    description:
      '종합 보안태세 점수를 무엇이 얼마나 깎고 있는지, 취약점을 조치하면 점수가 실제로 오르는지 보여준다. "이거 조치하면 점수 얼마나 올라?", "점수 어떻게 올려?", "뭐가 점수를 깎아?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: async () => 점수영향글(await computeKpiSnapshot()),
  },
  {
    // ★ 2026-08-03 실전 147상황: 「지금 우리 어느 단계가 제일 밀렸어?」에 28초를 쓰고
    //   "필요한 정보가 부족합니다. 어떤 프로젝트나 작업을 진행 중인지…"라고 **되물었다.**
    //   절차 5단계 숫자는 workflow.ts가 이미 다 세고 있는데 챗봇이 부를 창구가 없었다.
    //   되물음을 받으면 담당자는 그냥 화면으로 간다 — 대화창에서 끝낸다는 원칙이 깨진다.
    name: "workflow_status",
    label: "업무 절차 단계별 현황",
    domain: "report",
    write: false,
    description:
      '업무 절차 5단계(①발견·수집 ②우선순위 ③조치 ④검증 ⑤보고)의 건수와 **어느 단계가 제일 밀렸는지**를 보여준다. 특정 단계를 물으면(“발견 단계에서 뭘 해야 해?”) 그 단계에서 하는 일과 다음 걸음만 짚어 준다. "어느 단계가 제일 밀렸어?", "지금 절차 어디쯤이야?", "단계별 현황 알려줘"에 쓴다. 예: {} 또는 {"stage":"발견"}',
    directAnswer: true,
    params: [{ name: "stage", label: "단계", description: "특정 단계만 볼 때 (발견·우선순위·조치·검증·보고, 비우면 전체)", required: false }],
    run: async (args: Record<string, string>) => 절차현황글(args.stage ?? args.질문 ?? ""),
  },
  {
    // ★ 2026-08-03 — 담당자 지적을 따라가다 발견한 데이터 소실의 복구 창구.
    //   실패한 modelscan이 자산 46개에서 취약점 4,817건을 덮어썼고, 원본은 스캔 이력에 남아 있다.
    //   덮어쓰기는 가드로 막혔지만 **이미 잃은 것을 되돌리는 길**이 없어 이 두 도구를 만들었다.
    name: "lost_findings_status",
    label: "잃은 취약점 현황",
    domain: "assets",
    write: false,
    description:
      '실패한 스캔에 덮여 사라진 취약점이 얼마나 되는지, 어느 자산에서 몇 건을 되찾을 수 있는지 보여준다. "취약점이 왜 0건이야?", "잃은 취약점 있어?", "스캔 결과가 사라졌어"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: async () => 잃은취약점현황글(),
  },
  {
    name: "restore_lost_findings",
    label: "잃은 취약점 되살리기",
    domain: "assets",
    write: true,
    description:
      '실패한 스캔에 덮여 사라진 취약점을 스캔 이력에서 되살린다. "잃은 취약점 되살려줘", "사라진 스캔 결과 복구해줘"에 쓴다. 자산 하나만 하려면 assetId를 준다. 예: {} 또는 {"assetId":"vuln:192.168.219.98"}',
    params: [{ name: "assetId", label: "자산", description: "특정 자산만 되살릴 때 (비우면 전체)", required: false }],
    // 결재판에 뜨는 글 — **무엇이 얼마나 바뀌는지 숫자로** 보여 준다. "복구합니다"만으론 승인할 수 없다.
    effect: (args) => {
      const 후보 = 잃은취약점찾기().filter((c) => !args.assetId || c.assetId === args.assetId || c.이름 === args.assetId);
      if (후보.length === 0) return "되살릴 것이 없습니다 — 잃은 취약점을 찾지 못했습니다.";
      const 총건 = 후보.reduce((n, c) => n + c.되찾을건수, 0);
      const 가장오래된 = new Date(Math.min(...후보.map((c) => c.스캔시각))).toISOString().slice(0, 10);
      return `자산 ${후보.length}개에 취약점 ${총건}건을 되살립니다 — ${가장오래된} 이후 스캔 이력에 남아 있던 그대로입니다(지금 다시 스캔한 것이 아닙니다). 기존 스캔 실패 기록은 지우지 않고 함께 남깁니다.`;
    },
    undo: "되살리기 전 상태는 스캔 이력에 그대로 남아 있어 되짚을 수 있습니다.",
    run: async (args: Record<string, string>) => {
      const ids = args.assetId
        ? 잃은취약점찾기().filter((c) => c.assetId === args.assetId || c.이름 === args.assetId).map((c) => c.assetId)
        : undefined;
      if (args.assetId && ids && ids.length === 0) {
        return `"${args.assetId}"에서 되살릴 취약점을 찾지 못했습니다 — "잃은 취약점 있어?"로 먼저 확인해 주세요.`;
      }
      const r = 되살리기(ids);
      if (r.되살린자산 === 0) return "되살릴 것이 없었습니다.";
      return (
        `취약점 ${r.되살린건수}건을 자산 ${r.되살린자산}개에 되살렸습니다.` +
        (r.건너뛴자산 ? ` (${r.건너뛴자산}개는 이력을 읽지 못해 건너뛰었습니다)` : "") +
        `\n${표식.주의} 되살린 것은 **그때 스캔한 결과**입니다 — 그 사이 조치했다면 재스캔으로 확인해 주세요.`
      );
    },
  },
  {
    name: "report_schedule_list",
    label: "정기 리포트 스케줄 조회",
    domain: "report",
    write: false,
    description:
      '등록된 정기 리포트(주간/분기) 자동 생성 스케줄을 조회한다. 대상 자산·주기·다음 실행 시각·최근 실행 성공/실패를 그대로 보여준다. "다음 정기 리포트 언제야?", "이번 주 리포트 스케줄 확인해줘", "리포트 자동 생성 스케줄 뭐있어?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runReportScheduleList,
  },
  {
    // 실측(2026-08-03 실전 147상황): "이번 주 보고서 썼어?"에 **"지난주 보고서는 7월 5일에
    //   작성되었습니다"**라고 답했다. 이번 주를 물었는데 지난주를 답한 것이다 —
    //   담당자는 이 답을 보고 "썼구나" 하고 넘어간다. 세는 일을 모델에 맡겨서 생긴 일이고,
    //   같은 숫자를 절차 띠 ⑤ 보고 칸은 이미 결정적으로 세고 있었다(reportActivity).
    //   **세는 것은 코드가 센다.**
    name: "report_list",
    label: "보고서 목록",
    domain: "report",
    write: false,
    description:
      '만들어 둔 보고서가 어디 있는지, 무엇이 있는지 보여준다. "지난달 리포트 어디 있어?", "보고서 목록 보여줘", "지난번에 만든 보고서 찾아줘"에 쓴다. 예: {}',
    directAnswer: true,
    params: [{ name: "filter", label: "조건", description: "기간 등 물어본 조건(그대로 되짚어 준다)", required: false }],
    run: runReportList,
  },
  {
    name: "exposed_assets",
    label: "인터넷 노출 자산",
    domain: "assets",
    write: false,
    description:
      '인터넷·외부에 노출된 것으로 등록부에 적혀 있는 자산을 노출점수 순으로 보여준다. "인터넷에 노출된 자산 있어?", "외부에서 접근되는 자산", "공개된 자산 뭐 있어?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runExposedAssets,
  },
  {
    name: "report_activity",
    label: "보고서 작성 현황",
    domain: "report",
    write: false,
    description:
      '이번 주에 보고서를 만들었는지, 마지막으로 만든 지 며칠 됐는지 센다. "이번 주 보고서 썼어?", "보고서 언제 마지막으로 냈지?", "이번 달 보고 했나?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runReportActivity,
  },
  {
    name: "hardening_schedule_list",
    label: "원격 정기점검 스케줄 조회",
    domain: "maintenance", // 정기 점검 축 — 실행(run_hardening_scan)은 cross지만 스케줄 조회는 점검 업무다
    write: false,
    description:
      '등록된 원격 정기점검(하드닝) 스케줄을 조회한다. 점검 대상 장비·기준(CCE/CIS)·주기·다음 실행 시각·최근 준수율을 보여준다. "원격 정기점검 스케줄 어떻게 되어 있어?", "정기점검 언제 돌아?", "점검 자동으로 돌고 있어?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runHardeningScheduleList,
  },
  {
    name: "time_saved",
    label: "AI가 아낀 시간",
    domain: "report",
    write: false,
    description:
      'AI 자동화가 대신 처리한 일을 시간으로 환산해 보여준다. 무엇을 몇 건 했고 어떤 기준시간을 곱했는지도 함께 낸다. "AI가 시간을 얼마나 아꼈어?", "자동화 효과 정리해줘", "이번 달 절감 시간"에 쓴다. 예: {} 또는 {"days":"90"}',
    directAnswer: true,
    params: [{ name: "days", label: "기간(일)", description: "며칠치인지 — 기본 30일", required: false }],
    run: (a) => timeSavedText(Math.min(Math.max(Number(a.days) || 30, 1), 365)),
  },
  {
    name: "answer_feedback_status",
    label: "답변 지적 현황",
    domain: "knowledge",
    write: false,
    description:
      '담당자가 남긴 답변 지적(틀린 답·못 찾음·말투)을 모아 보여준다. "이번 주 지적 뭐 있었어?", "답변 피드백 현황 알려줘", "틀렸다고 한 거 뭐야"에 쓴다. 예: {} 또는 {"days":"30"}',
    directAnswer: true,
    params: [{ name: "days", label: "기간(일)", description: "며칠치인지 — 기본 7일", required: false }],
    run: (a) => feedbackSummaryText(Math.min(Math.max(Number(a.days) || 7, 1), 365)),
  },
  {
    name: "model_adoption_status",
    label: "모델 채택 이력",
    domain: "knowledge",
    write: false,
    description:
      '지금 쓰는 AI 모델을 언제 어떤 근거로 채택했는지 보여준다(평가 게이트 점수 포함). 게이트 없이 바뀐 변경도 숨기지 않고 표시한다. "모델 언제 바꿨어?", "지금 모델 무슨 근거로 쓰는 거야?", "모델 채택 이력"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: () => adoptionSummaryText(10),
  },
  {
    name: "system_health",
    label: "시스템 자가 진단",
    domain: "cross",
    write: false,
    description:
      '이 시스템이 지금 정상인지 스스로 점검해 보여준다 — 백업 최신성·지식베이스·데이터베이스·최근 오류·디스크 여유. 문제가 있으면 무엇을 하면 되는지까지 알려준다. "시스템 괜찮아?", "서버 상태 점검해줘", "이상 없어?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: () => systemHealthText(),
  },
  {
    name: "alert_schedule_status",
    label: "정기 알림 현황",
    domain: "report",
    write: false,
    description:
      '등록된 정기 알림(오늘 할 일·조치 기한 임박·시스템 이상)을 보여준다. 언제 누구에게 가는지, 최근 발송이 됐는지 실패했는지까지. "정기 알림 뭐 걸려 있어?", "알림 설정 확인해줘"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: () => alertScheduleText(),
  },
  {
    // ★ 등록하는 길이 아예 없었다(2026-08-01 실측). 서버·챗봇 조회·발송은 다 만들어 뒀는데
    //   **거는 자리**가 화면에도 챗봇에도 없어서, 운영 서버의 등록 알림이 0건이었다.
    //   담당자는 앱을 열지 않으면 SLA 초과를 영영 모른다 — 있는 기능이 꺼져 있는 것과 같다.
    //   새 화면을 만드는 대신 결재판(쓰기 도구)을 쓴다. 이 제품에서 쓰기는 원래 그 길이다.
    name: "alert_schedule_add",
    label: "정기 알림 걸기",
    domain: "report",
    write: true,
    description:
      '메일로 오는 정기 알림을 새로 건다. kind는 daily_brief(오늘 할 일)·sla_due(조치 기한 임박)·system_health(시스템 이상) 중 하나, hour는 보낼 시각(0~23), to는 받는 메일 주소(쉼표로 여러 명). "매일 9시에 기한 임박 알림 보내줘" 같은 지시에 쓴다. 예: {"kind":"sla_due","hour":"9","to":"hong@example.com"}',
    params: [
      { name: "kind", label: "알림 종류", description: "daily_brief(오늘 할 일) · sla_due(조치 기한 임박) · system_health(시스템 이상)", required: true },
      { name: "hour", label: "보낼 시각", description: "0~23 (서버 기준 시각). \"아침 9시\"는 9", required: true },
      { name: "to", label: "받는 사람", description: "메일 주소. 여러 명이면 쉼표로 구분", required: true },
    ],
    // "아침 9시"·"오전 9시" 같은 말을 숫자로 고치고, 종류를 코드로 바꾼다.
    //
    // ★ **값이 이미 맞아도 그대로 다시 돌려준다**(2026-08-01 실측에서 배움).
    //   결재판은 "지시문에 없는 필수값 = LLM이 지어낸 것"으로 보고 비워 되묻는다(환각 방어).
    //   그런데 kind는 **코드값**이라 정답(`sla_due`)이 사람 말("기한 임박")에 있을 리가 없다.
    //   그래서 LLM이 정확히 맞혔는데도 빈 칸이 돼 승인이 막혔다 — 잘한 것을 벌준 셈이다.
    //   autoFill이 돌려준 값은 source=auto가 되어 비워지지 않는다. 이 두 칸의 권위는 여기다.
    autoFill: (args, instruction): Record<string, string> => {
      const 고침: Record<string, string> = {};
      const raw = String(args.hour ?? "").trim();
      if (/^\d{1,2}$/.test(raw) && Number(raw) <= 23) {
        고침.hour = String(Number(raw)); // "09" → "9" 로 다듬어 다시 낸다(auto 표시를 위해)
      } else {
        const m = (raw || instruction).match(/(오전|아침|오후|저녁|밤)?\s*(\d{1,2})\s*시/);
        if (m) {
          let h = Number(m[2]);
          if (/오후|저녁|밤/.test(m[1] ?? "") && h < 12) h += 12;
          if (/오전|아침/.test(m[1] ?? "") && h === 12) h = 0;
          고침.hour = String(h);
        }
      }
      const k = String(args.kind ?? "").trim();
      if (["daily_brief", "sla_due", "system_health"].includes(k)) {
        고침.kind = k; // 이미 코드값 — 그대로 다시 낸다(비워지지 않게)
      } else {
        const 말 = k + " " + instruction;
        if (/기한|SLA|마감|임박/i.test(말)) 고침.kind = "sla_due";
        else if (/시스템|이상|백업|진단|장애/.test(말)) 고침.kind = "system_health";
        else if (/오늘|할\s*일|브리핑|아침/.test(말)) 고침.kind = "daily_brief";
      }
      return 고침;
    },
    effect: (args) => {
      const 이름: Record<string, string> = { daily_brief: "오늘 할 일 브리핑", sla_due: "조치 기한 임박", system_health: "시스템 이상" };
      const k = String(args.kind ?? "");
      return `정기 알림 등록 — ${이름[k] ?? k} · 매일 ${String(args.hour ?? "?")}시 · ${String(args.to ?? "")} 앞으로`;
    },
    undo: '대화창에서 "정기 알림 뭐 걸려 있어?"로 확인한 뒤 삭제할 수 있습니다.',
    run: runAlertScheduleAdd,
  },
  {
    name: "analysis_status",
    label: "통합 보안 분석(관제) 현황",
    domain: "cross", // 취약점·보안로그·운영리포트·하드닝 4소스를 가로지르는 관제 허브
    write: false,
    description:
      '통합 보안 분석(관제) 허브 현황을 조회한다 — 취약점·보안로그·보안제품 운영리포트·하드닝 점검 4소스를 정규화한 이벤트의 종합위험·소스별 건수·최우선 항목·소스 간 상관관계(같은 자산이 여러 소스에 동시 출현). "통합 분석 현황", "보안 분석 어때", "관제 현황 알려줘"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runAnalysisStatus,
  },
  {
    name: "kpi_status",
    label: "보안 KPI 현황",
    domain: "cross", // 자산·취약점·조치·점검·컴플라이언스를 가로지르는 통합 지표
    write: false,
    description:
      '통합 보안 KPI 스냅샷을 조회한다 — 자산 위험도, 취약점 활성/조치율, 조치 SLA 준수율, 점검(유지보수) 지연/승인대기, 컴플라이언스 이행률. "보안 KPI 현황", "KPI 어때", "보안 지표 보여줘"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runKpiStatus,
  },
  // ── 내 업무(할 일) 3종 ────────────────────────────────────────────────
  // 결재판 경계(2026-08-01 사용자 승인): **나에게만 영향**을 주는 것(완료·담기)은 결재판 없이
  // 즉시 처리하고 되돌릴 길을 준다. 체크칸 하나에도 승인 팝업이 뜨면 아무도 안 쓴다.
  // **남에게 영향**을 주는 것(담당자 재배정)만 결재판을 거친다 — 그건 assign_finding이 이미 한다.
  // ⚠ my_tasks 도구는 넣었다가 **뺐다**(2026-08-01 실측). 조회는 picklist.ts의 결정적 경로가
  //   이미 맡고 있어서(isMyWorkAsk) 도구가 영영 안 불렸다 — 두 길이 같은 일을 하면 반드시
  //   어긋난다. 「지금 이거」는 그쪽 목록 맨 앞에 얹었다.
  //   여기 남은 둘은 **시키는 말**(담기·완료)이라 도구가 맞다.
  {
    name: "complete_task",
    label: "할 일 완료",
    domain: "cross",
    write: false, // ★ 나에게만 영향 — 결재판 없이 즉시, 대신 되돌리는 말을 함께 준다
    description:
      '내 할 일 하나를 완료로 옮긴다. "○○ 완료", "○○ 끝냈어", "○○ 다 했어"에 쓴다. 예: {"task":"방화벽 정책 점검"}',
    directAnswer: true,
    params: [{ name: "task", label: "할 일", description: "끝낸 할 일의 이름(일부만 적어도 된다)", required: true }],
    run: runCompleteTask,
  },
  {
    name: "add_task",
    label: "할 일 담기",
    domain: "cross",
    write: false, // ★ 나에게만 영향 — 즉시 담고, 잘못 담았으면 완료로 지우면 된다
    description:
      '내 할 일에 하나 담는다. "할 일 추가: ○○", "○○ 담아줘", "○○ 잊지 않게 적어줘"에 쓴다. 예: {"text":"방화벽 정책 점검","due":"오늘"}',
    directAnswer: true,
    params: [
      { name: "text", label: "할 일", description: "담을 일의 내용", required: true },
      { name: "due", label: "기한", description: "오늘 · 이번 주 (선택, 비우면 기한 없음)", required: false },
      { name: "recur", label: "반복", description: "매주 · 매월 (선택, 비우면 한 번만)", required: false },
    ],
    run: runAddTask,
  },
  {
    name: "reopen_task",
    label: "할 일 다시 열기",
    domain: "cross",
    write: false, // ★ 나에게만 영향 — 되돌리는 동작 자체라 결재판이 붙으면 뜻이 없다
    description:
      '잘못 끝낸 할 일을 다시 연다. "○○ 다시 열어줘", "○○ 완료 취소"에 쓴다. 예: {"task":"방화벽 정책 점검"}',
    directAnswer: true,
    params: [{ name: "task", label: "할 일", description: "다시 열 할 일의 이름", required: true }],
    run: runReopenTask,
  },
  // 「자주 하는 업무」 — 내 업무 화면의 접힌 구역에 있던 것. 화면을 없애면 이것도 같이
  // 사라지므로 대화창으로 옮긴다. ⚠ RAG+LLM이라 몇 초 걸린다(화면에서도 따로 늦게 채웠다).
  {
    name: "routine_tasks",
    label: "자주 하는 업무",
    domain: "cross",
    write: false,
    description:
      '주기적으로 반복되는 업무를 추천한다. "자주 하는 일 뭐 있어?", "정기 업무 추천해줘", "매일 뭐 해야 해?"에 쓴다. 예: {}',
    directAnswer: true,
    params: [],
    run: runRoutineTasks,
  },
  // ★ 절차 카드 — 「내 업무」 화면에서 하던 단계 밟기를 대화창으로 옮긴 것(2026-08-01).
  //   목록 답변이 "○○ 어떻게 해?라고 물으면 순서를 알려드립니다"라고 **약속**하므로,
  //   이 도구가 없으면 그 약속이 빈말이 된다(실측: 엉뚱한 CVSS 설명이 나왔다).
  {
    name: "work_steps",
    label: "업무 절차",
    domain: "cross",
    write: false,
    description:
      '내 할 일 하나의 진행 절차를 단계별로 보여준다. "○○ 어떻게 해?", "○○ 절차 알려줘", "○○ 뭐부터 해?"에 쓴다. 예: {"task":"방화벽 정책 점검"}',
    directAnswer: true,
    params: [{ name: "task", label: "할 일", description: "절차를 볼 할 일의 이름(일부만 적어도 된다)", required: true }],
    run: runWorkSteps,
  },
  {
    name: "step_done",
    label: "단계 완료",
    domain: "cross",
    write: false, // ★ 나에게만 영향 — 체크칸 하나에 결재판이 뜨면 아무도 안 쓴다
    description:
      '진행 중인 업무의 절차 한 단계를 끝낸 것으로 적는다. "1번 했어", "2단계 완료"에 쓴다. 일감 이름을 안 적으면 진행 중인 것을 집는다. 예: {"step":"1"}',
    directAnswer: true,
    params: [
      { name: "step", label: "단계 번호", description: "끝낸 단계 번호", required: true },
      { name: "task", label: "할 일", description: "어느 일감인지(선택)", required: false },
    ],
    run: runStepDone,
  },
  {
    name: "step_undo",
    label: "단계 되돌리기",
    domain: "cross",
    write: false,
    description:
      '잘못 적은 절차 단계를 다시 연다. "1번 취소", "2단계 되돌려"에 쓴다. 예: {"step":"1"}',
    directAnswer: true,
    params: [
      { name: "step", label: "단계 번호", description: "되돌릴 단계 번호", required: true },
      { name: "task", label: "할 일", description: "어느 일감인지(선택)", required: false },
    ],
    run: runStepUndo,
  },
  {
    name: "work_session_status",
    label: "작업 내역 현황",
    domain: "cross", // 어느 화면에서 시작했든(자산·취약점·오늘 등) 가로지르는 대화 이력
    write: false,
    description:
      '작업 내역 현황을 조회한다 — 진행중/완료 건수와 최근 작업 제목·턴 수·마지막 대화 미리보기. "작업 내역 뭐있어?", "지난 작업 확인해줘", "최근 대화"에 쓴다. (예전 이름인 "작업 세션", "지난 세션"으로 물어도 같은 것이다.) status로 active/done만 좁힐 수 있다. 예: {} 또는 {"status":"active"}',
    directAnswer: true,
    params: [{ name: "status", label: "상태", description: "active(진행중) 또는 done(완료) — 비우면 전체", required: false }],
    run: runWorkSessionStatus,
  },
  {
    name: "knowledge_status",
    label: "지식 자산 현황",
    domain: "knowledge",
    write: false,
    description: "장기기억(RAG) 문서와 온톨로지 트리플이 얼마나 쌓였는지 본다. 답변 품질의 근거가 되는 자료 현황이다.",
    params: [],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runKnowledgeStatus,
  },
  {
    // 지식 번들 현황 — knowledge_status(재고)와 달리 "실린 표준·위협 지식이 언제 기준인가"를 본다.
    // 구독화(후-3)의 첫 대화창 창구: 담당자가 "지금 최신인가/무엇이 실렸나"를 스스로 확인한다.
    name: "knowledge_bundle_status",
    label: "지식 번들 현황",
    domain: "knowledge",
    write: false,
    description:
      '제품에 실려 나가는 표준·위협 지식이 **언제 기준인지**(번들 버전)와 반입 대기 중인 번들을 본다. ' +
      '"지식 번들 상태", "지금 실린 지식 언제 기준이야?", "무슨 표준이 들어 있어?" 같은 물음에 쓴다. ' +
      "장기기억 문서 재고(knowledge_status)와는 다르다.",
    params: [],
    directAnswer: true,
    run: runKnowledgeBundleStatus,
  },
  {
    // 지식 번들 반입 — 폐쇄망 담당자가 파일로 받은 번들을 대화창에서 넣는다(쓰기·결재판).
    // ⚠ admin만: 온톨로지를 통째로 갈아끼우는 운영 행위라 한 사람이 전체 지식을 바꾼다.
    //   서명이 맞아야만 반입되고(bundleverify), 맞지 않으면 감사기록에 남기고 거부한다.
    name: "knowledge_bundle_import",
    label: "지식 번들 반입",
    domain: "knowledge",
    write: true,
    requiredRole: "admin",
    description:
      '반입 대기 폴더에 있는 지식 번들(.gijobundle) 파일을 서명 검증 후 반입한다. ' +
      '"지식 번들 넣어줘", "새 번들 반입해줘"처럼 말할 때 쓴다. 파일 이름은 「지식 번들 상태」로 확인한다. ' +
      '예: {"file":"gijo-knowledge-2026.10-1.gijobundle"}',
    params: [
      { name: "file", label: "번들 파일", description: "반입 대기 폴더의 .gijobundle 파일 이름. 「지식 번들 상태」로 목록을 볼 수 있습니다.", required: true },
    ],
    // 대기 폴더에 서명 통과 번들이 **딱 하나면** 그것으로 채운다(결재판에 "자동"으로 표시).
    autoFill: (args): Record<string, string> => {
      if ((args.file ?? "").trim()) return {};
      const ok = listInboxBundles().filter((b) => b.ok);
      return ok.length === 1 && ok[0].file ? { file: ok[0].file } : {};
    },
    effect: (args) => {
      const f = (args.file ?? "").trim();
      const b = listInboxBundles().find((x) => x.file === f);
      if (b?.ok) {
        return `번들 ${b.version}(발행 ${(b.issuedAt ?? "").slice(0, 10)})을 반입 — 표준 지식 ${b.counts?.triples ?? "?"}건·문서 ${b.counts?.docs ?? "?"}건을 이 버전으로 교체합니다. 손으로 넣은 지식은 보존됩니다.`;
      }
      return `반입 대기 폴더의 번들 「${f || "(미지정)"}」을 서명 검증한 뒤 반입합니다. 서명이 맞지 않으면 거부하고 기록에 남깁니다.`;
    },
    undo: "이전 버전 번들을 다시 반입하면 되돌아갑니다(번들은 출처별 교체라 멱등합니다).",
    run: runKnowledgeBundleImport,
  },
  {
    // 도구가 하나도 없던 화면들을 메운다(2026-07-27 공백 점검) — 기록은 이미 쌓여 있는데
    // 물어볼 길이 없어 챗봇이 일반 지식으로 얼버무리던 자리들이다.
    name: "audit_search",
    label: "작업 기록 조회",
    domain: "cross",
    write: false,
    // 설명을 넓게 쓰면 일반 검색 질문까지 끌려온다(ontology_query에서 겪은 문제) — 대상을 못 박는다.
    description:
      '**우리 시스템에서 사람이 한 조작 이력**(작업 기록·감사 로그)만 조회한다. "지난주에 누가 뭘 지웠어?", ' +
      '"삭제 기록 보여줘", "○○이 한 작업 알려줘"처럼 행위자·시점을 물을 때만 쓴다. ' +
      '보안 지식·취약점 내용을 묻는 질문에는 쓰지 않는다. 예: {"query":"삭제","days":"7"}',
    params: [
      { name: "query", label: "검색어", description: "작업·대상·사람 이름 일부(비우면 전체)", required: false },
      { name: "days", label: "기간(일)", description: "최근 며칠 — 기본 7, 최대 90", required: false },
    ],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runAuditSearch,
  },
  {
    name: "handover_status",
    label: "인수인계 현황",
    domain: "knowledge",
    write: false,
    description: '인수인계에 쓸 문서가 얼마나 쌓였는지 본다. "인수인계 어디까지 됐어?", "인수인계 준비됐어?"에 쓴다.',
    params: [],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runHandoverStatus,
  },
  {
    name: "system_log_status",
    label: "처리 실패 내역",
    domain: "cross",
    write: false,
    description:
      '최근 작업 중 실패·차단된 것이 있는지 본다. "서버에 오류 났어?", "실패한 작업 있어?", "뭐가 막혔어?"에 쓴다. 예: {"days":"1"}',
    params: [{ name: "days", label: "기간(일)", description: "최근 며칠 — 기본 1, 최대 30", required: false }],
    run: runSystemLogStatus,
  },
  {
    name: "ontology_query",
    label: "표준 코드 연결 조회",
    domain: "knowledge",
    write: false,
    // ⚠ 설명에 표준 이름(KISA·OWASP…)을 나열했더니 "KISA 어떤 점검항목이야?" 같은
    //   **단순 지식 질문까지 이 도구로 끌려왔다**(2026-07-27 회귀 하네스에서 발견 — 도구를
    //   늘리면 라우팅이 흔들린다는 걸 실제로 확인). 이 도구는 "A와 B가 어떻게 이어지나"만 답한다.
    //   항목이 무엇인지 묻는 질문은 지식(RAG)이 답해야 하므로 설명에서 표준 이름을 뺐다.
    description:
      '두 표준 코드가 서로 **어떻게 이어져 있는지**(연결 관계)만 찾는다. "CWE-79는 뭐랑 연결돼 있어?", ' +
      '"이 코드에 매핑된 다른 표준 알려줘"처럼 연결·매핑을 물을 때만 쓴다. ' +
      '어떤 점검항목이 무엇인지·조치 방법 같은 일반 질문에는 쓰지 않는다(그건 지식 검색이 답한다). 예: {"query":"CWE-79"}',
    params: [{ name: "query", label: "검색어", description: "연결을 볼 표준 코드", required: true }],
    run: runOntologyQuery,
  },
  {
    // 법령 조회 — 인터넷이 필요해 기본은 꺼져 있다(설정에서 법제처 인증키를 넣으면 켜진다).
    // 조문 원문과 링크를 찾아주는 데까지만 한다 — 법률 자문이 아니다(면책 문구 자동 첨부).
    name: "law_lookup",
    label: "법령·판례 조회",
    domain: "cross",
    write: false,
    description:
      '개인정보보호법·정보통신망법 같은 IT보안 관련 법령·시행령·고시(행정규칙)·판례를 국가법령정보센터에서 찾는다. "개인정보보호법 뭐라고 돼 있어?", "안전성 확보조치 기준 찾아줘", "유출 신고 관련 판례 있어?"에 쓴다. target: law(법령·기본)·admrul(고시·훈령)·prec(판례). 예: {"query":"개인정보 보호법"}',
    params: [
      { name: "query", label: "검색어", description: "법령명·고시명·판례 키워드", required: true },
      { name: "target", label: "종류", description: "law(법령)·admrul(고시)·prec(판례) — 비우면 법령", required: false },
    ],
    // 결과가 이미 사람이 읽기 좋고 원문 링크가 붙어 있다 — LLM이 재작성하면 조문을 바꿔 쓸 위험이
    // 있어(법률은 지어내면 가장 위험한 영역) 그대로 내보낸다.
    directAnswer: true,
    run: runLawLookup,
  },
  {
    name: "product_status",
    label: "보안제품 현황",
    domain: "products",
    write: false,
    description:
      '등록된 보안제품과 운영문서(매뉴얼) 보유 현황을 본다. 문서 없는 제품은 장애 시 대응이 늦어지므로 따로 짚어준다. 예: {} 또는 {"query":"방화벽"}',
    params: [{ name: "query", label: "검색어", description: "제품명·분류·벤더 (선택, 비우면 전체)", required: false }],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runProductStatus,
  },
  {
    // product_status(보유 현황 조회)의 짝 — 보안제품 등록(쓰기).
    name: "register_product",
    label: "보안제품 등록",
    domain: "products",
    write: true,
    description:
      '운영 중인 보안제품을 등록부에 추가한다. category는 방화벽·EDR·DLP·WAF·VPN·IPS·SIEM·백신·NAC·기타 중 하나(모르면 비워두면 기타). 예: {"name":"경계 방화벽 FW-01","category":"방화벽","vendor":"SECUI","model":"MF2"}',
    params: [
      { name: "name", label: "제품명", description: "보안제품 이름", required: true },
      { name: "category", label: "종류", description: "방화벽·EDR·DLP·WAF·VPN·IPS·SIEM·백신·NAC·기타 (선택)", required: false },
      { name: "vendor", label: "제조사", description: "제조사·벤더 (선택)", required: false },
      { name: "model", label: "모델", description: "모델·버전 (선택)", required: false },
      { name: "asset", label: "연결 자산", description: "이 제품이 지키는 자산 이름·IP (선택)", required: false },
    ],
    effect: (args) => `보안제품 "${(args.name ?? "").trim()}"을(를) 등록부에 추가${args.category?.trim() ? ` · 종류 ${args.category.trim()}` : ""}${args.asset?.trim() ? ` · 연결 자산 ${args.asset.trim()}` : ""}`,
    undo: "보안제품 화면에서 제품을 삭제하면 원복됩니다.",
    run: runRegisterProduct,
  },
  {
    name: "maintenance_status",
    label: "점검 일정 현황",
    domain: "maintenance",
    write: false,
    description:
      '정기 점검 일정의 기한 초과·예정 현황을 본다. 기한이 지난 것부터 보여준다. 예: {} 또는 {"filter":"방화벽"}',
    params: [{ name: "filter", label: "조건", description: "점검명·제품명·상태 (선택, 비우면 전체)", required: false }],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runMaintenanceStatus,
  },
  {
    // maintenance_status(점검 현황 조회)의 짝 — 점검 일정 등록(쓰기).
    name: "schedule_maintenance",
    label: "점검 일정 등록",
    domain: "maintenance",
    write: true,
    description:
      '정기 점검 일정을 새로 잡는다. productName(어느 제품)과 scheduleDate(YYYY-MM-DD, "다음주 월요일" 같은 상대 표현도 가능)가 필요하다. 예: {"productName":"경계 방화벽","scheduleDate":"2026-08-01"}',
    params: [
      { name: "productName", label: "대상 제품", description: "점검할 보안제품명", required: true },
      { name: "scheduleDate", label: "점검일", description: "YYYY-MM-DD (상대 표현도 자동 변환)", required: true },
      { name: "title", label: "점검명", description: "점검 제목 (선택, 비우면 '○○ 정기 점검')", required: false },
    ],
    // 상대 기한("다음주 월요일")을 YYYY-MM-DD로 정정한다(assign_finding의 dueDate와 같은 규칙).
    autoFill: (args, instruction): Record<string, string> => {
      const raw = (args.scheduleDate ?? "").trim();
      if (DUE_RE.test(raw)) return {};
      const parsed = parseRelativeDueDate(raw) ?? parseRelativeDueDate(instruction);
      return parsed ? { scheduleDate: parsed } : {};
    },
    effect: (args) => `점검 일정 등록 — ${(args.productName ?? "").trim()} · ${(args.scheduleDate ?? "").trim()} · 알림/승인 흐름과 연동`,
    undo: "운영 가이드(점검) 화면에서 일정을 삭제하면 원복됩니다.",
    run: runScheduleMaintenance,
  },
  {
    name: "asset_coverage",
    label: "자산 정보 결손 현황",
    domain: "assets",
    write: false,
    description:
      '자산 목록에서 "우리가 모르는 것"을 센다 — 담당부서·서비스·SBOM·점검이력이 빠진 자산. asset_status가 "무엇이 있는가"라면 이건 "무엇을 모르는가"다. gap을 주면 그 결손만 자산 id까지 나열한다. 예: {} 또는 {"gap":"담당부서"}',
    params: [
      { name: "gap", label: "결손 종류", description: "owner(담당부서)·service(서비스)·sbom·unscanned(미점검) 중 하나 (선택, 비우면 전체)", required: false },
    ],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runAssetCoverage,
  },
  {
    // asset_coverage가 "담당부서 없는 자산"을 짚어주면(조회) 이 도구로 채운다(쓰기). 결손→조치의 짝.
    name: "assign_owner",
    label: "자산 담당부서·서비스 지정",
    domain: "assets",
    write: true,
    description:
      '자산에 담당부서(owner)를 지정한다(서비스도 선택). asset_coverage로 담당부서 결손을 확인한 뒤 그 자산들을 채울 때 쓴다. assetId는 하나 또는 여러 개(쉼표·공백 구분, coverage 결과의 id를 복사). 예: {"assetId":"vuln:10.20.0.5, vuln:10.20.0.9","owner":"인프라팀"} 또는 {"assetId":"ai-secbot-01","owner":"보안팀","service":"챗봇"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id — 하나 또는 여러 개(쉼표·공백 구분, coverage 결과의 id=)", required: true },
      { name: "owner", label: "담당부서", description: "지정할 담당부서·담당자", required: true },
      { name: "service", label: "서비스", description: "연결 서비스명 (선택)", required: false },
    ],
    // 사람이 화면 표시 이름으로 자산을 부르거나 접두어(vuln:)를 흘리면 실제 id와 안 맞는다 —
    // resolveAssetList로 canonical id 목록으로 정정한다. 단, 정정이 실제로 필요할 때만 채운다
    // (안 그러면 항상 auto로 표시돼 "coverage 결과에서 왔다(found)"는 근거 배지를 덮어버린다 —
    // assign_finding과 같은 원칙).
    autoFill: (args): Record<string, string> => {
      const raw = (args.assetId ?? "").trim();
      const { resolved } = resolveAssetList(raw);
      if (!resolved.length) return {};
      const canonical = resolved.map((a) => a.id).join(", ");
      return canonical !== raw ? { assetId: canonical } : {};
    },
    effect: (args) => {
      const { resolved } = resolveAssetList(args.assetId ?? "");
      const n = resolved.length || 1;
      return `자산 ${n}건의 담당부서를 "${(args.owner ?? "").trim()}"로 지정${args.service?.trim() ? ` · 서비스 "${args.service.trim()}"` : ""} · 스캔·취약점 데이터는 바뀌지 않음`;
    },
    undo: "자산 화면(커버리지 탭)에서 담당부서를 다시 비우면 미배정으로 원복됩니다.",
    run: runAssignOwner,
  },
  {
    // sbom 결손(asset_coverage의 sbom gap·aibom_status)을 짚었을 때 이 도구로 생성한다.
    name: "generate_sbom",
    label: "SBOM 생성",
    domain: "sbom",
    write: true,
    description:
      '자산의 SBOM 파일을 **새로 생성**한다("SBOM 만들어줘/생성해줘"). **구성요소 현황·정리 조회는 aibom_status를 쓴다(이건 생성 전용).** asset_coverage/aibom_status가 "SBOM 없음"을 짚은 자산에 쓴다. 예: {"assetId":"fraud-detect-llm"}',
    params: [{ name: "assetId", label: "자산 id", description: "대상 자산 id (coverage/aibom 결과의 id=)", required: true }],
    autoFill: (args): Record<string, string> => {
      const raw = (args.assetId ?? "").trim();
      const a = resolveAsset(raw);
      return a && a.id !== raw ? { assetId: a.id } : {};
    },
    effect: (args) => `자산 "${(args.assetId ?? "").trim()}"의 SBOM(구성요소 목록)을 생성·저장 · 스캔 결과는 바뀌지 않음`,
    undo: "SBOM은 재생성으로 갱신됩니다(별도 되돌리기 없음).",
    run: runGenerateSbom,
  },
  {
    name: "aibom_status",
    label: "AI-BOM 구성 현황",
    domain: "sbom",
    write: false,
    description:
      'AI-BOM **구성요소 현황을 조회**한다 — 5영역(모델·데이터셋·프롬프트·도구·인프라)이 얼마나 채워졌는지, SBOM 생성·견고성 점검 여부를 본다. "AI-BOM 보여줘/현황", "자산별 구성요소 정리해줘"에 쓴다(새로 생성이 아니라 **조회**). assetId를 주면 그 자산의 미기재 항목까지 짚어준다. 예: {} 또는 {"assetId":"fraud-detect-llm"}',
    params: [
      { name: "assetId", label: "자산 id", description: "특정 자산만 (선택, 비우면 전체 현황)", required: false },
    ],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runAibomStatus,
  },
  {
    name: "finding_status",
    label: "취약점 현황 조회",
    domain: "vuln",
    write: false,
    description:
      '취약점들이 지금 어떤 상태인지 본다 — 배정·기한·판정 현황. today가 "오늘 볼 상위 건"이라면 이건 "조건에 맞는 것들의 처리 현황"이다. 예: {"filter":"critical"}, {"filter":"미배정"}, 비우면 전체',
    params: [
      { name: "filter", label: "조건", description: "심각도·자산·담당자·상태 키워드 (선택, 비우면 전체)", required: false },
    ],
    // 출력이 이미 한국어 요약이라 LLM 재작성을 생략한다(2026-08-02: 재작성이 20~30초를 더 썼다).
    directAnswer: true,
    run: runFindingStatusOverview,
  },
  {
    name: "review_finding",
    label: "취약점 승인·반려",
    domain: "vuln",
    write: true,
    description:
      '취약점을 승인(조치완료) 또는 반려(오탐)로 판정한다. 예: {"assetId":"fraud-detect-llm","finding":"critical pickle","decision":"반려"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목 (예: critical pickle)", required: true },
      { name: "decision", label: "판정", description: "승인(조치완료) / 반려(오탐)", required: true },
      { name: "note", label: "메모", description: "판정 사유 (선택)", required: false },
    ],
    effect: () => "해당 취약점의 검토 상태가 바뀌고 조치·승인 화면에 반영됩니다.",
    undo: "조치·승인 화면에서 판정을 미검토로 되돌리면 원상복귀됩니다.",
    run: runReviewFinding,
  },
  {
    name: "list_assets",
    label: "자산 목록 조회",
    domain: "assets",
    write: false,
    description:
      'AI·IT 자산 목록을 보여준다 (개수·이름·유형·담당자·finding 요약). 이름·유형·서비스·구성요소, 그리고 그 자산이 들어온 점검 파일 이름으로 좁힐 수 있다 — 예: {"query":"방화벽"}, {"query":"LLM 서비스"}, {"query":"oracle"}. 비우면 전체.',
    // ⚠ 즉답이다(2026-08-03). 예전에는 LLM이 다시 썼는데, "우리 자산 몇 대야?"에
    //   머리줄(`등록된 AI 자산 57개 · 아래는 15개입니다`)과 「다음 걸음」을 날리고
    //   `등록된 AI 자산 총 57개입니다.` 한 줄만 남겼다 — **개수를 물었는데 잘림 고지가 사라졌다.**
    //   출력이 이미 우리말 요약이라 다시 쓸 이유가 없고, 재작성 시간(20~30초)도 아낀다.
    directAnswer: true,
    params: [
      { name: "query", label: "찾을 말", description: "유형·이름·카테고리·서비스 (선택, 비우면 전체)", required: false },
      { name: "risk", label: "위험 등급", description: "high(고위험)·medium·low 로 좁힐 때 (선택)", required: false },
    ],
    run: runListAssets,
  },
  {
    name: "get_asset",
    label: "자산 상세 조회",
    domain: "assets",
    write: false,
    description:
      '자산 1개의 상세를 조회한다 — 취약점(finding)·AI-BOM·관련 위협까지 함께 나온다. 예: {"assetId":"ai-secbot-01"}',
    params: [{ name: "assetId", label: "자산 id", description: "조회할 자산 id", required: true }],
    run: runGetAsset,
  },
  {
    name: "search",
    label: "통합 검색",
    domain: "cross", // 메뉴를 가로지른다 — 자산·취약점·보안제품·문서·온톨로지를 한 번에
    write: false,
    description:
      '무엇이든 찾는다 — 자산·취약점·보안제품·사내문서·온톨로지 관계를 한 번에 검색한다. 어디 있는지 모를 때 이것부터 쓴다. query는 검색어 하나만 넣는다 — "A OR B"·"A와 B"처럼 여러 대상을 한 문자열로 합치지 마라(그 문자열 그대로 찾아 0건이 된다). 대상이 여러 개면 이 도구를 대상마다 한 번씩(여러 스텝) 호출한다. 예: {"query":"Log4Shell"}',
    params: [{ name: "query", label: "검색어", description: "찾을 키워드 하나(자산명·취약점·제품·문서·위협) — 여러 개를 합치지 말 것", required: true }],
    run: runSearch,
  },
  {
    name: "explain",
    label: "근거 조회(온톨로지)",
    domain: "cross",
    write: false,
    description:
      '보안 주제·위협·용어의 사내 근거를 모은다 — 온톨로지 관계(위협→완화통제→제품)·사내 문서·보유 보안제품. "이게 뭐야", "무슨 위협이 걸려", "우리 통제는?"에 쓴다. 예: {"topic":"프롬프트 인젝션"}',
    params: [{ name: "topic", label: "주제", description: "설명이 필요한 위협·용어·주제", required: true }],
    run: runExplain,
  },
  {
    name: "urgent_todo",
    label: "지금 손댈 일",
    domain: "cross",
    write: false,
    description:
      '보안 KPI의 **나쁜 값만** 골라 지금 손댈 일을 우선순위(P0~P2)로 낸다. "지금 손댈 일", "뭐가 급해", "손댈 일 뭐야", "급한 일 알려줘"에 쓴다. **취약점만의 우선순위는 today, 지표 숫자 나열은 kpi_status로 간다.**',
    params: [],
    // 규칙으로 만든 목록이라 LLM이 다시 쓸 이유가 없다 — 숫자가 바뀌면 안 된다.
    directAnswer: true,
    run: runUrgentTodo,
  },
  {
    name: "today",
    label: "오늘의 조치 우선순위",
    domain: "cross",
    write: false,
    description:
      '지금 조치할 취약점 **우선순위**를 전 자산을 가로질러 알려준다(KEV→EPSS→VPR 순, 담당자·기한·지연 포함). "오늘 뭐부터?", "제일 급한 취약점", "우선순위 높은 거", "뭐부터 조치해"에 쓴다. **단 담당자·기한을 배정/지정하라는 지시("배정해줘","담당자 지정")는 assign_finding, 특정 상태(열린/미조치 등) 취약점 목록은 finding_status로 간다.** 예: {"limit":"5"}',
    params: [{ name: "limit", label: "개수", description: "상위 몇 건 (기본 5)", required: false }],
    // 결과가 이미 사람이 읽기 좋은 우선순위 목록이라 LLM 재작성을 생략한다 — 제품 핵심 명령이라
    // 항상 빠르고 확실하게 답해야 한다(재작성 경로에서 데이터 많을 때 멈추던 문제 원천 차단).
    directAnswer: true,
    run: runToday,
  },
  {
    name: "threats",
    label: "우리 관련 위협(CTI)",
    domain: "cross", // 위협 인텔리전스 × 자산을 가로지른다
    write: false,
    description:
      '우리 자산에 걸리는 최신 위협을 보여준다 — "요즘 위협 있어?", "새로 뜬 거 우리랑 관련?", "우리 자산에 걸리는 위협", "위협 인텔"에 쓴다. CTI 피드 탐지 × 사내 자산 교집합. 예: {"limit":"5"}',
    directAnswer: true,   // 이미 우리말 요약 — 재작성하면 20~30초만 더 들고 숫자가 흔들린다
    params: [{ name: "limit", label: "개수", description: "상위 몇 건 (기본 5)", required: false }],
    run: runThreats,
  },
  {
    name: "remediation",
    label: "조치 절차 가이드",
    domain: "cross",
    write: false,
    description:
      '취약점·위협을 "어떻게 조치/대응/막을지" 구체 절차를 사내 근거로 안내한다 — 완화통제(온톨로지)·보유 보안제품·매뉴얼(RAG). "어떻게 조치해?", "이거 어떻게 막아?", "대응 방법 알려줘"에 쓴다(개념 설명은 explain). 예: {"topic":"Log4Shell"}',
    params: [{ name: "topic", label: "주제", description: "조치가 필요한 취약점·위협·주제", required: true }],
    run: runRemediation,
  },
  {
    name: "scan_status",
    label: "재스캔 상태 요약",
    domain: "cross",
    write: false,
    description:
      '재스캔 기준 취약점 상태 변화를 요약한다 — 신규·활성·해결·재발 건수 + 해결(fixed) 후보. "지난 스캔 대비 뭐가 바뀌었어?", "새로 뜬 거 있어?", "해결된 거"에 쓴다. 예: {} 또는 {"assetId":"vuln:sample-web01"}',
    // ⚠ 즉답이다 — LLM 재작성이 말을 망가뜨렸다(2026-08-03 실측:
    //   "신규 14건"이 **"가장 최근의 신규 스피드는 14건입니다"**로 나갔다).
    //   이미 우리말 요약이라 다시 쓸 이유가 없다.
    directAnswer: true,
    params: [{ name: "assetId", label: "자산 id", description: "특정 자산만 (선택, 비우면 전체)", required: false }],
    run: runScanStatus,
  },
  {
    name: "briefing",
    label: "오늘의 브리핑",
    domain: "cross",
    write: false,
    description:
      '오늘의 보안 브리핑을 한 번에 화면에 **즉석 요약**해 준다 — 오늘의 조치 상위·지난 이후 신규 취약점·기한 초과/임박(SLA)·우리 관련 위협·추천 3. "오늘 브리핑(해줘)", "아침에 뭐 챙겨야 돼?", "지금/오늘 상황 요약해줘"에 쓴다. **단 "리포트/보고서 작성·뽑아줘"처럼 문서를 만드는 지시는 브리핑이 아니라 리포트(report)로 간다.** 예: {}',
    params: [],
    // 아침에 가장 먼저 보는 답이다 — 읽고 나서 어디로 갈지가 없으면 화면을 헤맨다.
    run: async () => (await dailyBriefingText({ save: true })) + 다음걸음('급한 것부터 하시려면 "1번 담당자 배정해줘" 또는 조치·승인 화면으로 가세요.'),
  },
  {
    name: "run_redteam",
    label: "AI 견고성(레드팀) 점검",
    domain: "assets",
    write: false,
    description:
      '자산이 서빙하는 로컬 LLM에 프롬프트 인젝션·탈옥 공격 14종을 실제로 실행해 견고성을 측정한다. AI-BOM에 연결된 로컬 모델(modelRef)이 있는 AI/LLM 자산만 대상이다(인프라 호스트는 불가). "레드팀 점검해줘", "이 자산 견고성 점검", "프롬프트 인젝션 테스트해줘"에 쓴다. 예: {"assetId":"ai-secbot-01"}',
    params: [{ name: "assetId", label: "자산 id", description: "점검할 AI/LLM 자산 id", required: true }],
    run: runRunRedteam,
  },
  {
    name: "run_hardening_scan",
    label: "보안장비 하드닝 점검",
    domain: "cross", // 자산·보안제품·컴플라이언스를 가로지르는 진단
    write: false,
    description:
      '보안장비·PC에 CLI로 접속해 표준 기준의 보안설정(하드닝) 점검을 실제로 실행하고 양호/취약을 리포트한다. 기준: kisa(국내 CCE 리눅스 U-시리즈, 기본)·cis(CIS Benchmark)·kisa_pc(임직원 Windows PC PC-시리즈)·kisa_net(네트워크 장비 N-시리즈). "하드닝 점검해줘", "PC 점검", "CCE 점검", "취약점 진단해줘"에 쓴다. 예: {"standard":"kisa_pc"}',
    directAnswer: true,
    params: [
      { name: "standard", label: "점검 기준", description: "kisa(국내 CCE, 기본) 또는 cis", required: false },
      { name: "target", label: "대상 장비", description: "점검 대상 표시용 라벨 (선택)", required: false },
    ],
    run: runHardeningScanTool,
  },
  {
    name: "register_asset",
    label: "자산 등록",
    domain: "assets",
    write: true,
    description:
      '새 AI 자산을 등록한다(id는 자동 생성되므로 넣지 마라). 예: {"name":"사내 챗봇","path":"models/chatbot.gguf"}',
    params: [
      { name: "assetId", label: "자산 id", description: "비워두면 이름에서 자동 생성", required: false },
      { name: "name", label: "이름", description: "자산 이름", required: true },
      { name: "path", label: "모델 경로", description: "모델 파일 경로 (예: models/chatbot.gguf)", required: true },
      { name: "assetType", label: "유형", description: "LLM 서비스 / 분류 모델 / 이상탐지 모델 / 기타", required: false },
      { name: "owner", label: "담당자", description: "담당 조직·담당자 (선택)", required: false },
    ],
    // 결재판을 띄우기 전에 서버 규칙으로 채운다 — 사람이 타이핑할 값을 최대한 줄인다(시안 B).
    autoFill: (args) => {
      const filled: Record<string, string> = {};
      if (!args.assetId?.trim() && args.name?.trim()) filled.assetId = generateAssetId(args.name);
      if (!args.assetType?.trim() && args.path?.trim()) filled.assetType = inferAssetType(args.path);
      return filled;
    },
    effect: (args) =>
      `자산 인벤토리에 1건 추가(${listAssets().length}→${listAssets().length + 1}개) · 스캔은 실행되지 않음 · AI-BOM은 빈 상태로 생성` +
      (args.owner?.trim() ? "" : " · 담당자 미지정"),
    undo: "자산 화면에서 삭제하거나, 아래 '방금 등록 취소'로 되돌릴 수 있습니다.",
    run: runRegisterAsset,
  },
  {
    name: "assign_finding",
    label: "취약점 담당자·기한 배정",
    // 자산이 아니라 취약점을 다루는 도구다. 원래 assets로 분류돼 있었으나 vuln이 맞다
    // (취약점 화면은 vuln+assets를 함께 노출하므로 그 화면에서는 종전대로 보인다).
    domain: "vuln",
    write: true,
    description:
      '취약점에 조치 **담당자와 기한(마감일)을 배정/지정**한다("담당자 배정해줘","기한 정해줘","가장 급한/우선순위 높은 취약점 담당자·기한 배정" 포함 — 우선순위 조회가 아니라 실제 배정). assetId와 finding(심각도·유형으로 지목)은 today/search 결과에서 가져온다. 예: {"assetId":"ai-secbot-01","finding":"프롬프트 인젝션","assignee":"김보안","dueDate":"2026-07-31"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id (today/search 결과의 id=)", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목 (예: critical 프롬프트 인젝션)", required: true },
      { name: "assignee", label: "담당자", description: "조치 담당자·조직", required: true },
      { name: "dueDate", label: "기한", description: "조치 기한 YYYY-MM-DD (선택)", required: false },
    ],
    // 결재판을 띄우기 전에 서버 규칙으로 정정한다 — 실측(2026-07-19):
    // ① 사람이 화면에 표시된 이름(예: "oracle.local")으로 자산을 지목하면 LLM이 그 문자열을 그대로
    //    assetId에 넣어 실제 id(vuln:192.168.219.98)와 안 맞아 승인이 실패했다 — resolveAsset로 정정.
    // ② "이번주 금요일" 같은 상대 기한이 그대로 dueDate에 들어가 형식 검증에서 매번 실패했다 —
    //    파싱되면 YYYY-MM-DD로, 안 되면 비워서(선택값이므로) 사람이 직접 채우게 한다.
    autoFill: (args, instruction) => {
      const filled: Record<string, string> = {};
      const resolved = resolveAsset(args.assetId ?? "");
      if (resolved && resolved.id !== args.assetId) filled.assetId = resolved.id;
      const due = args.dueDate?.trim();
      if (due && !DUE_RE.test(due)) {
        const parsed = parseRelativeDueDate(due) ?? parseRelativeDueDate(instruction);
        filled.dueDate = parsed ?? "";
      }
      return filled;
    },
    effect: (args) => `취약점 검토대장에 담당자${args.dueDate?.trim() ? "·기한(SLA)" : ""}을 기록 · 스캔·자산 데이터는 바뀌지 않음`,
    undo: "승인 화면(취약점 관리)에서 담당자·기한을 다시 비우면 미배정으로 원복됩니다.",
    run: runAssignFinding,
  },
  {
    name: "update_finding_status",
    label: "취약점 판정(오탐·조치완료)",
    domain: "vuln",
    write: true,
    description:
      '취약점의 조치 결과·판정을 기록한다(상태 변경). 사용자가 "고쳤어", "패치했어", "조치했어", "조치완료", "다 해결했어", "이제 됐어"(→조치완료) 또는 "이건 오탐이야", "오탐 처리해", "무시해도 돼"(→오탐)라고 하면 단순 대화가 아니라 **반드시 이 도구로** 상태를 남긴다. status는 "조치완료" 또는 "오탐". assetId·finding은 today/search 결과에서 지목. 예: {"assetId":"ai-secbot-01","finding":"버전 노출","status":"조치완료"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목", required: true },
      { name: "status", label: "판정", description: "조치완료 / 오탐 (미검토로 원복도 가능)", required: true },
      { name: "note", label: "사유", description: "판정 근거·메모 (선택)", required: false },
    ],
    // status를 canonical("조치완료"/"오탐")로 정규화한다 — 모델이 준 값이든(예 "패치 완료") 안 줬든
    // 지시문에서 규칙 추론한다. 실측(2026-07-18): 모델이 지시문에 없는 status("패치 완료")를 넣으면
    // guess로 blank 처리돼 승인이 막혔다. autoFill(source=auto)로 채우면 blank되지 않는다.
    autoFill: (args, instruction) => {
      const word = inferStatusWord(args.status ?? "") || inferStatusWord(instruction);
      const filled: Record<string, string> = {};
      if (word) filled.status = word;
      return filled;
    },
    effect: (args) => {
      const st = normalizeStatus(args.status ?? "");
      if (st === "rejected") return "이 취약점을 오탐 처리 · SBOM 취약점과 '오늘의 조치'에서 제외됨";
      if (st === "approved") return "이 취약점을 조치완료로 확정 · 검토대장에 기록";
      return "판정을 미검토로 원복";
    },
    undo: "승인 화면에서 판정을 미검토로 되돌리면 원상복귀됩니다.",
    run: runUpdateFindingStatus,
  },
  {
    name: "bulk_update",
    label: "취약점 일괄 조치",
    domain: "cross", // 전 자산을 가로질러 조건으로 다건 처리
    write: true,
    description:
      '여러 취약점을 조건으로 한 번에 처리한다 — "Critical KEV 전부 정요한한테 배정", "Oracle 취약점 다 오탐 처리", "높은 취약점 기한 2026-07-24로". filter(조건: 심각도·KEV·상태·키워드) + 담당자/기한/판정 중 하나 이상. 예: {"filter":"critical kev","assignee":"정요한","dueDate":"2026-07-24"}',
    params: [
      // ⚠ filter를 필수로 두지 않는다 — 대화창에서 체크박스로 고른 경우 조건이 없다.
      //   대신 run에서 "ids든 filter든 하나는 있어야 한다"를 강제한다(둘 다 비면 전건이 걸릴 뻔했다).
      { name: "filter", label: "대상 조건", description: "심각도(critical/high…)·KEV·상태·키워드 (예: critical kev, Oracle) — 목록에서 직접 고른 경우 비움", required: false },
      { name: "ids", label: "고른 대상", description: "대화창 목록에서 체크한 건들(자동으로 채워짐). 사람이 손으로 적는 값이 아니다", required: false },
      { name: "assignee", label: "담당자", description: "일괄 배정할 담당자 (선택)", required: false },
      { name: "dueDate", label: "기한", description: "일괄 기한 YYYY-MM-DD (선택)", required: false },
      { name: "status", label: "판정", description: "조치완료 / 오탐 (선택)", required: false },
    ],
    // 결재판에 영향받는 건수·목록을 보여준다 — 사람이 범위를 확인하고 승인한다(대량 쓰기 안전).
    effect: (args) => {
      if (args.ids?.trim()) {
        const { matched, unknown } = matchFindingsByIds(args.ids);
        if (matched.length === 0) return `고른 ${unknown.length}건을 목록에서 찾지 못함 — 목록을 다시 불러 주세요`;
        const sample = matched.slice(0, 5).map((x) => x.label).join(" · ");
        const 빠짐 = unknown.length ? ` (⚠ ${unknown.length}건은 못 찾아 건너뜀)` : "";
        return `고른 ${matched.length}건에 적용 — ${sample}${matched.length > 5 ? ` 외 ${matched.length - 5}건` : ""}${빠짐}`;
      }
      const m = matchFindingsByFilter(args.filter ?? "");
      if (m.length === 0) return `"${args.filter}"에 맞는 취약점 없음`;
      const sample = m.slice(0, 5).map((x) => x.label).join(" · ");
      return `${m.length}건에 일괄 적용 — ${sample}${m.length > 5 ? ` 외 ${m.length - 5}건` : ""}`;
    },
    undo: "승인 화면(취약점 관리)에서 개별로 되돌릴 수 있습니다. 범위가 크면 filter를 좁혀 다시 지시하세요.",
    run: runBulkUpdate,
  },
];

export function listAgentTools(): AgentTool[] {
  return TOOLS;
}

export function findAgentTool(name: string): AgentTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

// LLM 프롬프트에 넣을 도구 목록 텍스트.
/**
 * 지금 상황에서 쓸 수 있는 도구만 고른다.
 *
 * @param domains 노출할 업무 영역. 비우면 전체(종전 동작). "cross" 도구는 항상 포함된다.
 * @param role    호출자 권한. "admin"이 아니면 requiredRole="admin"인 도구를 숨긴다 —
 *                오케스트레이터가 애초에 후보로 삼지 못하게 해, 권한 없는 실행 시도 자체를 없앤다.
 */
export function listToolsFor(domains?: string[], role?: string): AgentTool[] {
  // 꺼져 있는 선택 기능의 도구는 아예 목록에서 뺀다.
  // ⚠ 2026-07-26 회귀: 법령 조회(기본 꺼짐)를 켜지 않은 상태에서도 law_lookup이 목록에 남아,
  //   "금융권 망분리의 법적 근거는?" 같은 질문이 그리로 가서 "인증키를 넣으세요"로 막혔다.
  //   예전에는 사내 문서(RAG)로 답하던 질문이다 — 꺼진 기능이 멀쩡하던 답을 빼앗으면 안 된다.
  //   목록에서 빼면 에이전트가 explain·search로 돌아가 원래대로 답한다.
  let lawOn = false;
  try { lawOn = getLawConfig().enabled; } catch { lawOn = false; }

  return TOOLS.filter((t) => {
    if (t.name === "law_lookup" && !lawOn) return false;
    if (t.requiredRole === "admin" && role !== "admin") return false;
    if (!domains || domains.length === 0) return true;
    return t.domain === "cross" || domains.includes(t.domain);
  });
}

export function toolCatalogText(domains?: string[], role?: string): string {
  return listToolsFor(domains, role)
    .map((t) => {
      const params = t.params.length ? `(${t.params.map((p) => p.name + (p.required ? "" : "?")).join(", ")})` : "()";
      return `- ${t.name}${params}: ${t.description}`;
    })
    .join("\n");
}

// 규칙 검증: 필수 인자가 전부 있고 문자열인지. 문제가 없으면 null, 있으면 한국어 사유를 돌려준다.
export function validateToolArgs(tool: AgentTool, args: Record<string, unknown>): string | null {
  for (const p of tool.params) {
    const v = args[p.name];
    if (p.required && (typeof v !== "string" || v.trim() === "")) {
      return `필수 인자 누락: ${p.name} (${p.description})`;
    }
    if (v !== undefined && typeof v !== "string") return `인자 ${p.name}은(는) 문자열이어야 합니다`;
  }
  return null;
}

// ── 결재판(시안 B, 2026-07-17 확정) ─────────────────────────────────────
// 쓰기 도구는 실행 전에 이 구조를 화면에 띄워 사람이 검토·승인한다. 각 값이 어디서 왔는지
// (지시에서/자동생성/AI 추정) 표시해, 7B 모델의 추정을 사람이 빠르게 검증하게 한다.
// 되물어보기(ask_user)는 별도 도구가 필요 없다 — 빠진 필수값이 빈 칸으로 표시되는 게 곧 되물음이다.

// said=지시문에 나온 값 · found=앞선 조회 결과(today/search 등)에서 온 값 · auto=서버 규칙 생성 ·
// guess=근거 없는 AI 추정(필수면 되묻음) · empty=빈 칸. said·found는 근거가 있어 그대로 유지한다.
export type FieldSource = "said" | "found" | "auto" | "guess" | "empty";

export interface ApprovalField {
  key: string;
  label: string;
  value: string;
  source: FieldSource;
  required: boolean;
  hint: string;
}

export interface PendingApproval {
  tool: string;
  label: string;
  fields: ApprovalField[];
  effect: string;
  undo: string;
  missing: string[]; // 필수인데 비어 있는 필드 — 화면이 빨갛게 강조하고 승인을 막는다
  instruction: string; // 이 결재판을 만든 원 지시 — 승인 시 파인튜닝 골드 예시로 누적(Phase 4)
}

// 값이 특정 텍스트(지시문·조회 결과)에 실제로 나왔는지 규칙으로 본다(LLM에게 출처를 묻지 않는다 — 부담·환각 회피).
// 공백을 무시하고 비교해 "사내 챗봇" ↔ "사내챗봇" 같은 표기 차이를 흡수한다.
function textHas(haystack: string, value: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const v = norm(value);
  return v.length >= 2 && norm(haystack).includes(v);
}

// toolResults: 이 결재판이 뜨기까지 에이전트 루프가 실행한 읽기 도구들의 결과(합친 텍스트).
// assign_finding의 assetId·finding처럼 "앞선 조회 결과에서 복사한" 값은 환각이 아니므로 유지한다.
/**
 * 앞선 조회 결과에 **이 자산이 보였는가** — id가 아니라 대상으로 판단한다.
 *
 * 화면에 나가는 글자는 이름이고 도구 인자는 id다. 둘이 다르다고 "근거 없음"으로 몰면
 * 근거 배지가 거짓말을 한다(2026-08-03 실측: today에서 id를 뺀 순간 found → guess로 떨어졌다).
 * ⚠ 이름이 없거나 너무 짧으면(2자 이하) 판단하지 않는다 — 흔한 글자가 아무 데나 걸린다.
 */
function 같은자산이보였나(toolResults: string, assetId: string): boolean {
  const 결과 = String(toolResults ?? "");
  if (!결과.trim() || !assetId) return false;
  const 이름 = 자산표시이름(assetId);
  if (!이름 || 이름.length <= 2) return false;
  return textHas(결과, 이름);
}

export function buildApproval(
  tool: AgentTool,
  rawArgs: Record<string, string>,
  instruction: string,
  toolResults = ""
): PendingApproval {
  const autoFilled = tool.autoFill ? tool.autoFill(rawArgs, instruction) : {};
  const args = { ...rawArgs, ...autoFilled };
  const fields: ApprovalField[] = tool.params.map((p) => {
    const value = (args[p.name] ?? "").trim();
    let source: FieldSource;
    if (!value) source = "empty";
    else if (p.name in autoFilled) source = "auto";
    else if (textHas(instruction, value)) source = "said";
    else if (textHas(toolResults, value)) source = "found"; // 앞선 조회 결과에서 온 값 — 근거 있음
    // ⚠ **글자가 아니라 대상이 같은지**를 본다. 2026-08-03에 도구 답에서 내부 id를 빼고
    //   이름으로 보여주게 바꿨더니(말투 규범), 앞선 조회에서 분명히 본 자산인데도
    //   `vuln:sample-web01`이라는 **글자**가 없다는 이유로 근거 배지가 「지어냄」으로 떨어졌다.
    //   근거 배지는 "AI가 봤는가"를 알리는 장치라, 봤는데 못 봤다고 하면 그 배지를 못 믿게 된다.
    else if (p.name === "assetId" && 같은자산이보였나(toolResults, value)) source = "found";
    else source = "guess";
    // 필수값은 LLM이 지어낸 값(guess)을 받지 않는다 — 빈 칸으로 되묻는다.
    // 실측(2026-07-17): 경로를 안 알려주고 "테스트봇 등록해줘"라고 하면 7B 모델이 그럴듯한
    // 파일 경로를 지어낸다. 근거 없는 필수값이 채워져 있으면 사람이 무심코 승인할 수 있으므로,
    // 필수값은 "지시·조회 결과에 있거나 서버 규칙이 만든 것"만 인정한다. 선택값의 추정은 배지로 표시만 한다.
    if (source === "guess" && p.required) return { key: p.name, label: p.label, value: "", source: "empty" as const, required: true, hint: p.description };
    return { key: p.name, label: p.label, value, source, required: p.required, hint: p.description };
  });
  return {
    tool: tool.name,
    label: tool.label,
    fields,
    effect: tool.effect ? tool.effect(args) : "",
    undo: tool.undo ?? "",
    missing: fields.filter((f) => f.required && !f.value).map((f) => f.key),
    instruction,
  };
}

// 승인된 쓰기 도구를 실행한다 — 화면에서 사람이 확인(값 수정 가능)한 뒤에만 여기로 온다.
// 규칙 검증은 여기서 한 번 더 한다(화면을 우회한 호출 방어).
export async function executeApprovedTool(toolName: string, args: Record<string, string>): Promise<string> {
  const tool = findAgentTool(toolName);
  if (!tool) throw new Error(`존재하지 않는 도구: ${toolName}`);
  if (!tool.write) throw new Error(`${toolName}은(는) 승인이 필요한 쓰기 도구가 아닙니다`);
  const invalid = validateToolArgs(tool, args);
  if (invalid) throw new Error(invalid);
  return String(await tool.run(args));
}
