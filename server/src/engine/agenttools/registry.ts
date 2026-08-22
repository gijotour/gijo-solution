// engine/agenttools/registry.ts — TOOLS 등록표 + 공개 API(find/validate/buildApproval…)
// (2026-08-06 agenttools.ts 분리) 핸들러 본문은 handlers.ts — 여기는 이름↔스키마 매핑과 관문만.
import { dateOnlyLocal, addDaysLocal, koDateTimeString } from "../../util/date";
// ⚠ 레드팀 공격 개수는 **세어서** 쓴다(2026-08-18). 손으로 「14종」이라 적어 뒀는데 실제는 30종이었다 —
//   그 문구 하나가 **살아 있는 모델에 공격을 발사하기 전 받는 동의 문구**였다.
import { PAYLOADS } from "../redteam";
import { listAssets, getAsset, registerAsset, updateAssetOwnership, updateAssetMeta, setAssetRobustness, isAiAsset, Asset, 자산표시이름 } from "../assets";
import { computeAssetCoverage, coverageSummaryText, type GapKind } from "../assetcoverage";
import { expandOntology } from "../ontology";
import { prioritizedReviews, updateFindingReview, findingKey, ReviewPatch, ApprovalStatus } from "../approvals";
import { 표식, 심각도한글, 심각도표식 } from "../tone";
import { buildHub, sourceFileOf } from "../assethub";
import { workflowStages } from "../workflow";
import { runInspectionReport } from "../inspectionreport";
import { 한줄풀이글, 섞임고지 } from "../findingplain";
import { eol찾기, eol한줄 } from "../eol-seed";
import { 패키지수집, 구성요소합치기, 덮는범위글 } from "../packagescan";
import { targetRunner, runnerFor } from "../hardeningscan";
import { listTargets } from "../hardeningtargets";
import { 잃은취약점찾기, 잃은취약점현황글, 되살리기 } from "../findingsrestore";
import { listProducts, createProduct, PRODUCT_CATEGORIES } from "../securityproducts";
import { listMaintenanceItems, createMaintenanceItem } from "../maintenance";
import { listCompliance, setComplianceStatus } from "../compliance";
import { generateSbom } from "../sbom";
import type { ComplianceStatus } from "../compliance";
import { countTriples } from "../ontology";
import { listVisibleDocuments, queryMemory, queryMemoryRelevant, queryMemoryScored } from "../memory";
import { listFindings as listCtiFindings } from "../cti";
import { matchCtiToAssets } from "../ctimatch";
import { dailyBriefingText } from "../briefing";
import { runRedTeam, makeServedCaller } from "../redteam";
import { runHardeningScan, scanSummaryText, isStandard } from "../hardeningscan";
import { listSchedules as listReportSchedules, scheduleSummaryText } from "../reportschedule";
import { reportActivity, listReportHistory } from "../report";
import { listSchedules as listHardeningSchedules } from "../hardeningtargets";
import { timeSavedText } from "../timesaved";
import { feedbackSummaryText } from "../answerfeedback";
import { adoptionSummaryText } from "../modeladoption";
import { systemHealthText } from "../observability";
import { alertScheduleText, createAlertSchedule, ALERT_KIND_LABEL } from "../alertschedule";
import type { AlertKind } from "../alertschedule";
import { getSmtpConfig } from "../email";
import { listAnalysisEvents, analysisSummary, computeCorrelations } from "../analysishub";
import { computeKpiSnapshot, 점수영향글 } from "../kpi";
import { listSessions as listWorkSessions } from "../worksessions";
import { canonicalize, suggestionsFor } from "../terms";
import { listAudit, recordAudit, type AuditEntry } from "../audit";
import { lawAnswer, getLawConfig, type LawTarget } from "../lawinfo";
// 담당자가 "미조치"라고 하면 저장값 open·pending을 뜻한다 — 글자 그대로 대조하면 늘 0건이다.
import { 필터에맞나 } from "../statuswords";
// 내 업무(할 일) — 화면을 없애고 대화창에서 한다(2026-08-01 사용자 결정).
import { listTasks, createTask, setTaskDone, setGuideStepDone, routineSuggestions, recordRoutineFeedback } from "../tasks";
import { buildMyWork } from "../mywork";
import { getGuide as 가이드가져오기 } from "../workguide";
import { getScreenGuide } from "../screenguide";
// 지식 번들(후-3 구독화) — 지금 실린 지식이 언제 기준인지 보기 + 대기 폴더 번들 반입.
import { getBundleStatus, listInboxBundles, importBundleFromInbox, KNOWLEDGE_BUNDLE_VERSION } from "../knowledgebundle";
import { airgapStatus, airgapCertificate } from "../airgap";
// BYOM 모델 자동 적응(2단계) — 적응 내용 조회·스모크 검증·판별 정정을 대화창으로.
import { getLocalEngineStatus } from "../localengine";
import { getAdaptation, setThinkingOverride } from "../modelquirks";
import { runSmoke } from "../modelsmoke";
import { currentViewer } from "../viewerctx";
import { findUserById } from "../../auth/users";

/** 화면 파일명 → 담당자가 메뉴에서 보는 한글 이름. 못 찾으면 파일명 대신 빈 값을 쓰지 않고
 *  그대로 두되, screenguide에 제목이 있으면 그것을 쓴다(안내 문구와 메뉴 이름이 같아야 한다). */
import { 조사, 말조사 } from "../../util/josa";
import {
  화면이름,
  AgentToolParam,
  TOOL_DOMAINS,
  ToolDomain,
  AgentTool,
  SEVERITY_ORDER,
  isRealVulnerability,
  시연도구,
  시연데이터알림,
  SCAN_NOISE,
  findingSummary,
  보여줄자산,
  자산위험등급,
  runListAssets,
  runGetAsset,
  ontologyLinesFor,
  runExplain,
  orderForSmallModel,
  matches,
  MULTI_QUERY_SPLIT_RE,
  splitQueryTerms,
  QUERY_STOPWORD_RE,
  queryTokens,
  matchesLoose,
  자산이걸린이유,
  자산문서발췌,
  제품이름인가,
  자산점검문서인가,
  searchOne,
  NO_HIT_PREFIX,
  noHitMessage,
  runLawLookup,
  runSearch,
  runToday,
  다음걸음,
  CTI_SEV_ORDER,
  runThreats,
  runRemediation,
  runScanStatus,
  runRunRedteam,
  runHardeningScanTool,
  generateAssetId,
  inferAssetType,
  runRegisterAsset,
  resolveAssetList,
  runAssignOwner,
  normalizeComplianceStatus,
  resolveThreatCode,
  runSetComplianceStatus,
  runAlertScheduleAdd,
  runScheduleMaintenance,
  runRegisterProduct,
  runGenerateSbom,
  FindingHit,
  findingLabel,
  findingMatches,
  resolveAsset,
  resolveFinding,
  normalizeStatus,
  inferStatusWord,
  WEEKDAY_MON0,
  parseRelativeDueDate,
  DUE_RE,
  runAssignFinding,
  runUpdateFindingStatus,
  runVerifyFinding,
  runAddReportSchedule,
  runDeleteDocument,
  BulkMatch,
  matchFindingsByFilter,
  matchFindingsByIds,
  조건이좁히나,
  runBulkUpdate,
  runCreateRequestDoc,
  runRequestStatus,
  runIngestUrl,
  현황상한,
  runFindingStatusOverview,
  runReviewFinding,
  aibomFilledFields,
  runAssetCoverage,
  runAibomStatus,
  runProductStatus,
  runMaintenanceStatus,
  runComplianceStatus,
  runReportScheduleList,
  runReportList,
  인터넷노출로적혔나,
  runExposedAssets,
  단계별할일,
  질문속단계,
  단계안내글,
  절차현황글,
  대상찾기,
  runSbomCoverage,
  runCollectPackages,
  runReportActivity,
  runHardeningScheduleList,
  runAnalysisStatus,
  runRedteamStatus,
  runUrgentTodo,
  runKpiStatus,
  열린할일찾기,
  제안담기,
  절차카드,
  runRoutineTasks,
  runWorkSteps,
  말한제품찾기,
  runStepDone,
  runStepUndo,
  runCompleteTask,
  runAddTask,
  runReopenTask,
  runWorkSessionStatus,
  runAuditSearch,
  runHandoverStatus,
  runSystemLogStatus,
  runOntologyQuery,
  runKnowledgeStatus,
  runRecentDocuments,
  runActionCheckHistory,
  runFpPatterns,
  번들언제기준,
  runKnowledgeBundleStatus,
  runKnowledgeBundleImport,
  runAirgapStatus,
  runModelFitStatus,
  runSetModelThinking,
  runAdapterStatus,
  runAdapterAdopt,
  runAdapterAssign,
  runAdapterImport,
  runProductIntroAdd,
} from "./handlers";

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
      if (!t) return `"${말}"에 해당하는 점검 대상이 검색되지 않았습니다 — 먼저 하드닝 점검 대상으로 등록해 주세요.`;
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
      if (후보.length === 0) return "되살릴 것이 없습니다 — 잃은 취약점이 검색되지 않았습니다.";
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
        return `"${args.assetId}"에서 되살릴 취약점이 검색되지 않았습니다 — "잃은 취약점 있어?"로 먼저 확인해 주세요.`;
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
    // 점검 상품화 4단계 — 고객사에 건네는 산출물. 레드팀 실측 결과를 KISA 21위협에 대조해 낸다.
    // ⚠ 레드팀 결과가 없으면 만들지 않는다(runInspectionReport가 거절한다) — 재지 않고 낸 보고서는 거짓이다.
    name: "inspection_report",
    label: "AI 보안 점검 결과보고서 생성",
    domain: "report",
    write: true,
    description:
      '고객사에 건네는 **AI 보안 점검 결과보고서**를 만든다 — 마지막 레드팀 점검 결과를 KISA 21위협 기준에 대조해 판정표·발견사항·못 잰 항목까지 담는다. "○○사 점검 보고서 만들어줘", "AI 보안 점검 결과보고서 뽑아줘"에 쓴다. 우리 내부 주간·분기 보고서(report_list 쪽)와 다른 물건이다. 예: {"customer":"안전대부","target":"https://ai.example.com/v1"}',
    params: [
      { name: "customer", label: "고객사", description: "보고서를 받을 고객사 이름", required: true },
      { name: "target", label: "점검 대상", description: "점검한 AI 엔드포인트 주소나 모델 이름 (비우면 점검 기록의 모델명)", required: false },
      { name: "consent", label: "동의 범위", description: "서면 동의서에 적힌 범위(부하 시험 허용 여부 등)", required: false },
      { name: "period", label: "점검 기간", description: "예: 2026-08-10 ~ 08-12 (비우면 오늘)", required: false },
    ],
    effect: (a) => `${a.customer || "고객사"} 점검 결과보고서(Markdown·PDF)를 만들어 보고서함에 저장합니다.`,
    undo: "보고서 파일을 지우면 됩니다(보고서 목록에서 삭제).",
    directAnswer: true,
    run: runInspectionReport,
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
    name: "redteam_status",
    label: "AI 공격 시험(레드팀) 지난 결과",
    // ⚠ 축은 TOOL_DOMAINS에 정의된 것만 쓴다 — "ai"라고 적었다가 시험이 잡았다(2026-08-10).
    //   제품 자체의 상태라 어느 한 축에 안 들어간다 → cross.
    domain: "cross",
    write: false,
    description:
      'AI 공격 시험(레드팀)의 **지난 결과**를 조회한다 — 제품 경로 실효 견고성(입구 차단·모델 버팀·뚫림)과 맨몸 모델 견고성 점수. "레드팀 점검 결과 알려줘", "레드팀 어땠어", "AI 견고성 점수" 에 쓴다. ⚠ 점검을 **새로 돌리는 것은 run_redteam**이다 — 이 도구는 이미 잰 값을 보여 줄 뿐 아무것도 실행하지 않는다. 예: {}',
    directAnswer: true,
    params: [],
    run: runRedteamStatus,
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
    // 중복 문서 후보 — 제목 뿌리가 같은 문서를 묶어 **표시만** 한다(삭제는 결재판).
    name: "doc_duplicates",
    label: "중복 문서 확인",
    domain: "knowledge",
    write: false,
    description:
      '지식베이스에서 **제목이 겹치는 문서**(같은 자료를 이름만 바꿔 두 번 올린 후보)를 묶어 보여 준다. "중복된 문서 있어?", "겹치는 문서 정리해야 해?" 같은 물음에 쓴다. 표시만 하며 지우지 않는다 — 삭제는 결재판에서.',
    params: [],
    directAnswer: true,
    run: async () => (await import("../docdupe.js")).duplicateDocsText(),
  },
  {
    // 오탐 패턴(해자 슬라이스 3) — 반복 오탐 판정을 묶어 **표시만** 한다. 자동 제외 금지.
    // (검토관 2026-08-07: 지식 번들 주석 아래에 끼어 있어 딴 도구로 읽혔다 — 제 주석을 단다.)
    name: "fp_patterns",
    label: "오탐 자주 나는 패턴",
    domain: "vuln",
    write: false,
    description:
      '이 조직에서 **반복해서 오탐으로 판정된 취약점 유형**을 모아 본다 — 몇 번, 몇 개 자산에서, 누가 판정했는지. ' +
      '"오탐 자주 나는 패턴 알려줘", "자주 틀리는 탐지 뭐야?" 같은 물음에 쓴다. ' +
      "⚠ 표시만 하는 도구다 — 자동으로 오탐 처리하지 않는다(잘못 일반화하면 진짜 취약점을 숨긴다).",
    params: [{ name: "minCount", label: "최소 반복 횟수", description: "몇 회 이상을 패턴으로 볼지 — 기본 2", required: false }],
    directAnswer: true,
    run: runFpPatterns,
  },
  {
    name: "action_check_history",
    label: "규정 대조 이력",
    domain: "knowledge",
    write: false,
    description:
      '지금까지의 행동 대조(○/△/×) 판정 이력을 본다 — 무엇을 물었고 어떤 판정이 났는지, 판정이 바뀐 사안(⚠)은 어디인지. ' +
      '"규정 대조 이력 보여줘", "판정 기록 알려줘" 같은 물음에 쓴다. 새 판정을 하는 게 아니라 **기록을 읽는** 도구다.',
    params: [],
    directAnswer: true,
    run: runActionCheckHistory,
  },
  {
    name: "recent_documents",
    label: "새 문서 소식",
    domain: "knowledge",
    write: false,
    description:
      '최근 새로 들어온(반입된) 문서의 대장 — 무엇이, 언제, 누가, 어느 분류로 들어왔고 세 줄 요약과 ' +
      '우리 지식과의 접점까지. "새 문서 뭐 들어왔어?", "새로 들어온 문서 알려줘" 같은 물음에 쓴다. ' +
      "지식 재고 전체(knowledge_status)가 아니라 **최근 반입분**만 본다.",
    params: [{ name: "days", label: "기간(일)", description: "며칠 치를 볼지 — 기본 7, 최대 90", required: false }],
    directAnswer: true,
    run: runRecentDocuments,
  },
  {
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
    // 에어갭 봉인 현황(후-4) — 인터넷으로 나가는 길이 전부 막혔는지 대화창에서 확인.
    // 명령 제안(2026-08-19) — 터미널 화면의 자연어 칸을 미니 챗봇 정리로 떼면서(소비자 0이 된
    // cmdsuggest.ts를) 대화창 도구로 이었다. 제안만 한다 — 실행은 터미널 화면에서 사람이
    // 허용목록·승인 검사를 거쳐 직접 한다(최소권한 원칙, cmdsuggest.ts 머리 주석과 동일).
    name: "suggest_command",
    label: "CLI 명령 제안",
    domain: "cross",
    write: false,
    description:
      '보안 점검·조회용 CLI(PowerShell) 명령 한 줄을 만들어 준다. "포트 스캔 명령 알려줘", ' +
      '"디스크 사용량 보는 명령", "nmap으로 10.0.0.5 훑는 명령" 같은 물음에 쓴다. 실행은 하지 않는다.',
    params: [{ name: "request", label: "무엇을 하고 싶은가", description: "만들고 싶은 명령을 우리말로 (예: 10.0.0.5 열린 포트 확인)", required: true }],
    directAnswer: true,
    run: async (args) => {
      const { suggestCommand } = await import("../cmdsuggest.js");
      const r = await suggestCommand(String(args.request ?? ""));
      if (!r.command) return r.explanation;
      return [
        `제안 명령: \`${r.command}\``,
        r.explanation,
        "",
        "실행은 ③ 조치 › 터미널 화면에서 직접 하세요 — 붙여넣으면 허용목록·위험 검사를 거치고, 실행·차단이 작업 기록에 남습니다.",
      ].join("\n");
    },
  },
  {
    name: "airgap_status",
    label: "에어갭 봉인 현황",
    domain: "cross",
    write: false,
    description:
      '이 서버가 인터넷과 완전히 분리(에어갭) 봉인됐는지와, 외부로 나갈 수 있는 통로·에어갭에서의 대체를 본다. ' +
      '"에어갭 상태", "인터넷 막혀 있어?", "외부로 나가는 거 있어?", "봉인 상태" 같은 물음에 쓴다.',
    params: [],
    directAnswer: true,
    run: runAirgapStatus,
  },
  {
    // 봉인 증명서(후-4) — 감사관·조달 심사 제출용. 상태 조회와 달리 **제출물** 형식이다.
    name: "airgap_certificate",
    label: "에어갭 봉인 증명서",
    domain: "cross",
    write: false,
    description:
      '에어갭 봉인 증명서를 발행한다 — 봉인 상태·대상 통로·차단 실적·한계를 한 장으로 정리해 ' +
      '감사관이나 조달 심사에 그대로 낼 수 있는 형식이다. "봉인 증명서", "에어갭 증명해줘", ' +
      '"에어갭 감사 자료" 같은 요청에 쓴다. 지금 상태만 궁금하면 airgap_status가 맞다.',
    params: [],
    directAnswer: true,
    run: () => {
      // 차단 실적은 **작업 기록 실측**을 센다 — 우리가 세는 수가 아니라 남은 기록이 근거다.
      const blocks = listAudit({ kind: "block", limit: 500 })
        .filter((e) => e.action.includes("에어갭"))
        .map((e) => ({ at: e.at, target: e.target, detail: e.detail }));
      return airgapCertificate(blocks);
    },
  },
  {
    // BYOM 모델 적응 상태 + 스모크(자동 적응 2단계) — 올린 모델이 맞춰졌고 말이 되는지.
    name: "model_fit_status",
    label: "모델 적응 상태",
    domain: "cross",
    write: false,
    description:
      '로드된 모델의 자동 적응 내용(생각 모드·컨텍스트)과 스모크 검증(4문항: 빈칸·한국어·지시·거절)을 본다. ' +
      '"모델 적응 상태", "올린 모델 괜찮아?", "모델 검증해줘" 같은 물음에 쓴다. ' +
      "지금 무슨 모델을 쓰는지만 물으면 system_health가 맞다.",
    params: [],
    // ⚠ directAnswer는 "LLM 재작성을 생략한다"는 뜻이지 **빠르다는 뜻이 아니다**(2026-08-05 검토 지적).
    //   실제로 모델에 4문항을 물으므로 최대 100초(문항당 25초)가 걸릴 수 있고, 10초를 넘으면
    //   대화창이 리포트 전환으로 받는다(longanswer). 재작성 생략은 그대로 옳다 — 출력이 이미
    //   결정적 요약이라 LLM을 한 번 더 태울 이유가 없다.
    directAnswer: true,
    run: runModelFitStatus,
  },
  {
    // 판별 정정(쓰기·admin) — 자동 판별이 틀렸을 때. 다음 로드부터 적용.
    name: "set_model_thinking",
    label: "모델 생각 모드 지정",
    domain: "cross",
    write: true,
    requiredRole: "admin",
    description:
      '모델의 생각(추론) 모드 판별을 사람이 지정한다 — 자동 판별이 틀렸을 때만. ' +
      'mode는 끔(일반 모델 취급) 또는 켬(thinking 모델 취급·생각 끄는 플래그 적용). ' +
      '예: {"model":"qwen3-14b","mode":"켬"}',
    params: [
      { name: "model", label: "모델", description: "모델 이름(「모델 적응 상태」로 확인)", required: true },
      { name: "mode", label: "지정", description: "끔(일반 모델) 또는 켬(thinking 모델)", required: true },
    ],
    effect: (args) => `${말조사(String(args.model ?? "?"), "을")} 「${/켜|켬|on/i.test(args.mode ?? "") ? "thinking 모델(생각 끄는 플래그 적용)" : "일반 모델(플래그 없음)"}」로 지정 — 다음 로드부터 적용됩니다.`,
    undo: "「모델 적응 상태」로 확인 후 반대 모드로 다시 지정하면 되돌아갑니다.",
    run: runSetModelThinking,
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
      // 조문 번호가 오면 목록이 아니라 **본문**을 준다(2026-08-09, 후-3).
      { name: "article", label: "조문 번호", description: "숫자만 — 예: 29 (「제29조 알려줘」). 비우면 목록", required: false },
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
    effect: (args) => `보안제품 "${(args.name ?? "").trim()}"${조사((args.name ?? "").trim(), "을")} 등록부에 추가${args.category?.trim() ? ` · 종류 ${args.category.trim()}` : ""}${args.asset?.trim() ? ` · 연결 자산 ${args.asset.trim()}` : ""}`,
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
      const out: Record<string, string> = {};
      const raw = (args.scheduleDate ?? "").trim();
      if (!DUE_RE.test(raw)) {
        const parsed = parseRelativeDueDate(raw) ?? parseRelativeDueDate(instruction);
        if (parsed) out.scheduleDate = parsed;
      }
      // ⚠ 제품명은 **등록부 대조로** 채운다(2026-08-06 — 강제 라우팅을 붙이자 결재판은 즉시
      //   뜨는데 productName이 비어, 서랍이 넣어 준 「FOCS 메뉴얼 ver1 2 정기점검 잡아줘」에서
      //   사람이 제품명을 다시 쳐야 했다). LLM 추출이 아니라 등록된 이름과의 결정적 대조라
      //   지어낼 수 없고, 지시에 없는 제품이면 그대로 비워 사람에게 묻는다.
      //   가장 긴 일치를 고른다 — 「FOCS」와 「FOCS 메뉴얼 ver1 2」가 다 걸리면 긴 쪽이 맞다.
      if (!(args.productName ?? "").trim()) {
        const 소문 = instruction.toLowerCase();
        const hit = listProducts()
          .filter((p) => p.name && 소문.includes(p.name.trim().toLowerCase()))
          .sort((a, b) => b.name.length - a.name.length)[0];
        if (hit) out.productName = hit.name;
      }
      return out;
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
      // 🗂 지금 범위(2026-08-18) — 담당자가 ⓪ 자산에서 건 자산. **서버가 코드로 채운다.**
      // ⚠ **기계전용**이라 모델에게는 안 보인다. 도구 설명을 건드리면 라우팅이 흔들린 전례가
      //   있어(설명 한 줄 바꿔 11/11 → 9/11) 프롬프트에는 아무것도 더하지 않는다.
      // ⚠ 이 인자가 없으면 범위를 걸어 놓고 「미조치 몇 건이야?」를 물었을 때 **전체**가 온다 —
      //   화면은 「이 자산 기준으로 갑니다」라고 적혀 있는데(2026-08-18 실측 3,008건).
      { name: "assetId", label: "지금 범위", description: "🗂 지금 범위로 걸린 자산(자동으로 채워짐)", required: false, 기계전용: true },
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
    // ⚠ **쓰기다**(2026-08-18 수정). 예전엔 write:false였는데 handlers.ts의 이 도구 본문이
    //   `setAssetRobustness()`로 **자산 레코드에 견고성 점수를 쓴다.** write:false면
    //   agentloop.ts:1767이 결재판 없이 즉시 실행하므로, **쓰기가 사람 확인 없이 돌고 있었다.**
    //   게다가 실행 자체가 살아 있는 모델에 인젝션·탈옥 공격을 **실제로 발사**하는 일이라
    //   "무엇을 대상으로 도는지"를 사람이 한 번은 봐야 한다. 선언과 실제를 맞춘다.
    write: true,
    description:
      `자산이 서빙하는 로컬 LLM에 프롬프트 인젝션·탈옥 공격 ${PAYLOADS.length}종을 실제로 실행해 견고성을 측정한다. AI-BOM에 연결된 로컬 모델(modelRef)이 있는 AI/LLM 자산만 대상이다(인프라 호스트는 불가). "레드팀 점검해줘", "이 자산 견고성 점검", "프롬프트 인젝션 테스트해줘"에 쓴다. 예: {"assetId":"ai-secbot-01"}`,
    params: [{ name: "assetId", label: "자산 id", description: "점검할 AI/LLM 자산 id", required: true }],
    effect: (args) =>
      `자산 ${말조사(args.assetId || "(대상 미지정)", "이")} 쓰는 로컬 모델에 프롬프트 인젝션·탈옥 공격 ${PAYLOADS.length}종을 실제로 보내고, 그 결과로 나온 견고성 점수를 자산 기록에 남깁니다.`,
    undo: "보낸 공격은 되돌릴 수 없습니다(실제로 모델에 갑니다). 견고성 점수는 다음 점검 때 새 값으로 덮어씁니다.",
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
    autoFill: (args, instruction, toolResults) => {
      const filled: Record<string, string> = {};
      // ③ ⌗기계 키(2026-08-19 QA 실사고) — 화면에서 고른 항목이 실어 보낸 키가 지시문에 박혀
      //   있으면 자산·취약점을 그 키로 **강제**한다(LLM이 IP·표시명으로 추정한 값을 덮는다 —
      //   같은 IP 두 자산(sample-web01 vs vuln:10.0.0.100)에서 엉뚱한 쪽으로 배정이 간 사고).
      //   비탐욕 .+? — 자산 id에 공백이 있어도 잡는다(검토관 10: \S+는 조용히 무효화됐다).
      const 키 = /⌗(.+?)::([0-9a-f]{16})/.exec(instruction);
      if (키) {
        filled.assetId = 키[1].trim();
        // 결재판의 「대상 취약점」이 해시로만 뜨면 승인자가 무엇을 배정하는지 못 읽는다(검토관
        // 6① — 결재판의 존재 이유가 사람 확인이다). 사람 라벨과 key:를 함께 싣는다 —
        // resolveFinding이 문자열 어디에 있든 key:를 우선 파싱한다.
        const r = resolveFinding(filled.assetId, "key:" + 키[2]);
        filled.finding = r.ok ? `${r.hit.label} (key:${키[2]})` : "key:" + 키[2];
      }
      const resolved = resolveAsset(filled.assetId ?? args.assetId ?? "");
      if (resolved && resolved.id !== (filled.assetId ?? args.assetId)) filled.assetId = resolved.id;
      const due = args.dueDate?.trim();
      const 지시기한 = parseRelativeDueDate(instruction);
      if (due && !DUE_RE.test(due)) {
        filled.dueDate = parseRelativeDueDate(due) ?? 지시기한 ?? "";
      } else if (due && 지시기한 && 지시기한 !== due) {
        // ⑤(검토관 5③) — 사용자가 상대 기한을 말했으면 **그 값이 이긴다**. 전엔 「내일까지」라고
        //   말했는데 LLM이 엉뚱한 절대 날짜를 넣으면 그대로 통과했다.
        filled.dueDate = 지시기한;
      } else if (due && !지시기한 && !textHas(instruction, due) && !textHas(toolResults ?? "", due)) {
        // ⑤ 형식은 맞는데 **사용자도 도구 결과도 말한 적 없는** 날짜 — LLM이 지어낸 것(QA
        //   실사고: 배정 지시에 기한 말이 없는데 과거 날짜 2026-07-24가 채워짐). 비워서 사람이
        //   결재판에서 직접 채우게 한다. ⚠ 도구 결과에서 복사한 값은 근거 있음(검토관 5① —
        //   buildApproval의 found 판정과 어긋나지 않게 toolResults도 본다).
        filled.dueDate = "";
      }
      return filled;
    },
    effect: (args) => `취약점 검토대장에 담당자${args.dueDate?.trim() ? "·기한(SLA)" : ""}을 기록 · 스캔·자산 데이터는 바뀌지 않음`,
    undo: "승인 화면(취약점 관리)에서 담당자·기한을 다시 비우면 미배정으로 원복됩니다.",
    run: runAssignFinding,
  },
  {
    name: "update_finding_status",
    label: "취약점 판정(오탐·조치완료·위험수용)",
    domain: "vuln",
    write: true,
    description:
      '취약점의 조치 상태·판정을 기록한다(상태 변경). "고쳤어/패치했어/조치완료"(→조치완료) · "이건 오탐이야/무시해도 돼"(→오탐) · **"조치 시작할게/이거 착수한다"(→진행중) · "검증 요청해줘/재스캔 대기로"(→검증 대기) · "위험 수용 처리해줘"(→위험수용, acceptUntil 기한·note 사유 필수 — 기한이 지나면 재검토로 부상)** — 전부 단순 대화가 아니라 **반드시 이 도구로** 상태를 남긴다(5단계 ③→④ 전이 포함, 2026-08-19 기능 가이드 ①). assetId·finding은 today/search 결과에서 지목. 예: {"assetId":"ai-secbot-01","finding":"버전 노출","status":"조치완료"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목", required: true },
      { name: "status", label: "상태", description: "조치완료 / 오탐 / 위험수용 / 조치 시작(진행중) / 검증 요청 / 미검토(원복)", required: true },
      { name: "note", label: "사유", description: "판정 근거·메모 (위험수용은 필수)", required: false },
      { name: "acceptUntil", label: "수용 기한", description: "위험수용일 때만 — YYYY-MM-DD, 지나면 재검토로 부상 (위험수용은 필수)", required: false },
    ],
    // status를 canonical("조치완료"/"오탐")로 정규화한다 — 모델이 준 값이든(예 "패치 완료") 안 줬든
    // 지시문에서 규칙 추론한다. 실측(2026-07-18): 모델이 지시문에 없는 status("패치 완료")를 넣으면
    // guess로 blank 처리돼 승인이 막혔다. autoFill(source=auto)로 채우면 blank되지 않는다.
    autoFill: (args, instruction) => {
      const word = inferStatusWord(args.status ?? "") || inferStatusWord(instruction);
      const filled: Record<string, string> = {};
      if (word) filled.status = word;
      // ③ ⌗기계 키 — assign_finding과 같은 강제 정정(고른 항목의 키가 있으면 추정을 덮는다).
      //   라벨+키 동봉·비탐욕도 같은 이유(검토관 6①·10 — 그쪽 주석 참조).
      const 키 = /⌗(.+?)::([0-9a-f]{16})/.exec(instruction);
      if (키) {
        filled.assetId = 키[1].trim();
        const r = resolveFinding(filled.assetId, "key:" + 키[2]);
        filled.finding = r.ok ? `${r.hit.label} (key:${키[2]})` : "key:" + 키[2];
      }
      return filled;
    },
    effect: (args) => {
      const st = normalizeStatus(args.status ?? "");
      if (st === "rejected") return "이 취약점을 오탐 처리 · SBOM 취약점과 '오늘의 조치'에서 제외됨";
      if (st === "approved") return "이 취약점을 조치완료로 확정 · 검토대장에 기록";
      // ⚠ 실제 효과와 반대되는 문구가 결재판에 뜨면 사용자가 반대로 알고 승인한다(검토관 상2 —
      //   위험수용이 「미검토로 원복」으로 보였다). 상태마다 제 효과를 말한다.
      if (st === "accepted") {
        const 기한 = (args.acceptUntil || "").trim();
        const 사유 = (args.note || "").trim();
        return `위험수용 처리(기한 ${기한 || "⚠없음 — 승인 시 거부됩니다"} · 사유 ${사유 ? "기록됨" : "⚠없음 — 승인 시 거부됩니다"}) · 기한까지 일감에서 제외, 지나면 재검토로 부상`;
      }
      if (st === "in_progress") return "조치 진행중으로 기록(담당 작업 착수)";
      if (st === "verifying") return "검증 대기로 기록(재스캔·확인 차례)";
      return "판정을 미검토로 원복";
    },
    undo: "승인 화면에서 판정을 미검토로 되돌리면 원상복귀됩니다.",
    run: runUpdateFindingStatus,
  },
  {
    // 기능 가이드 ①(2026-08-19) — 5단계 ④검증을 대화로: 승인 화면 [🔍 조치 검증 실행]과 같은 엔진.
    // ⚠ 읽기 도구(run_hardening_scan 선례): 장비에 읽기 명령만 보내고 상태를 자동으로 안 올린다.
    name: "verify_finding",
    label: "조치 검증 실행",
    domain: "vuln",
    write: false,
    description:
      '조치가 실제로 닫혔는지 장비에 접속해 재확인한다(읽기 명령만). "이거 검증 실행해줘", "조치 검증 돌려줘", "정말 닫혔는지 확인해줘"에 쓴다. 검증만 하고 완료 확정은 하지 않는다 — 확정은 update_finding_status. 예: {"assetId":"web-01","finding":"critical Log4j"}',
    params: [
      { name: "assetId", label: "자산 id", description: "대상 자산 id", required: true },
      { name: "finding", label: "대상 취약점", description: "심각도·유형으로 지목 (비우면 그 자산의 미해결 전부)", required: false },
    ],
    autoFill: (args, instruction) => {
      const filled: Record<string, string> = {};
      const 키 = /⌗(.+?)::([0-9a-f]{16})/.exec(instruction);
      if (키) { filled.assetId = 키[1].trim(); filled.finding = "key:" + 키[2]; }
      const resolved = resolveAsset(filled.assetId ?? args.assetId ?? "");
      if (resolved && resolved.id !== (filled.assetId ?? args.assetId)) filled.assetId = resolved.id;
      return filled;
    },
    run: runVerifyFinding,
  },
  {
    // 삭제 일관화 ①(2026-08-19 사장님 「필요 없는 건 삭제 가능해야」) — 「이 문서 지워줘」.
    name: "delete_document",
    label: "지식 문서 삭제",
    domain: "knowledge",
    write: true,
    description:
      '지식베이스(장기기억)에 올린 문서를 지운다. "○○.pdf 지워줘", "그 문서 삭제해줘"에 쓴다. 이름으로 정확히 1건만 — 여러 건이 걸리면 목록을 주고 되묻는다. withFile에 "원본까지"라고 적으면 서버 원본 파일도 지운다(복구 불가). 예: {"document":"옛_보고서.pdf"}',
    params: [
      { name: "document", label: "문서 이름", description: "지울 문서의 파일 이름(일부만 적어도 됨 — 1건으로 좁혀져야 실행)", required: true },
      { name: "withFile", label: "원본까지", description: '"원본까지"라고 적으면 서버 원본 파일도 삭제(복구 불가) — 비우면 장기기억만', required: false },
    ],
    effect: (args) => `문서 「${args.document}」를 장기기억에서 제거${/원본|파일까지|완전/.test(args.withFile ?? "") ? " + 서버 원본 파일 삭제(복구 불가)" : " (원본이 있으면 재업로드로 복구 가능)"}`,
    undo: "장기기억만 지웠다면 원본 재업로드로 복구됩니다. 원본까지 지웠다면 복구되지 않습니다.",
    run: runDeleteDocument,
  },
  {
    // 기능 가이드 ⑤(2026-08-19) — ⑤보고의 쓰기 짝: "주간 리포트 매주 금요일 17시로 걸어줘".
    name: "report_schedule_add",
    label: "정기 리포트 스케줄 걸기",
    domain: "report",
    write: true,
    description:
      '정기 리포트 스케줄을 등록한다. "주간 리포트 매주 금요일 5시로 걸어줘", "매월 보고서 자동으로 만들어줘"에 쓴다(조회는 report_schedule_list). 예: {"type":"주간","dayOfWeek":"금","hour":"17"}',
    params: [
      { name: "type", label: "주기", description: "일일 / 주간 / 매월 / 분기", required: true },
      { name: "dayOfWeek", label: "요일", description: "주간일 때만 — 월~일 (기본 월)", required: false },
      { name: "hour", label: "시각(0~23)", description: "몇 시에 만들지 — 24시간제", required: true },
    ],
    // alert_schedule_add 선례 — "아침 9시"·"오후 5시"를 사람이 다시 안 적게 지시문에서 정정한다.
    autoFill: (args, instruction) => {
      const filled: Record<string, string> = {};
      if (!/^(일일|주간|매월|분기|daily|weekly|monthly|quarterly)$/.test(args.type ?? "")) {
        const m = /(일일|매일|주간|매주|월간|매월|분기)/.exec(instruction);
        if (m) filled.type = m[1].replace("매일", "일일").replace("매주", "주간").replace("월간", "매월");
      }
      const h = /(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*시/.exec(instruction);
      if (h) {
        let 시 = Number(h[2]);
        if ((h[1] === "오후" || h[1] === "저녁" || h[1] === "밤") && 시 < 12) 시 += 12;
        if (!Number.isInteger(Number(args.hour)) || String(시) !== args.hour) filled.hour = String(시);
      }
      const d = /(월|화|수|목|금|토|일)요일/.exec(instruction);
      if (d && !args.dayOfWeek) filled.dayOfWeek = d[1];
      return filled;
    },
    effect: (args) => `${args.type ?? "정기"} 리포트가 자동 생성되도록 스케줄 등록 (pdf · 내부용)`,
    undo: "보고 화면 › 정기 리포트에서 끄거나 지울 수 있습니다.",
    run: runAddReportSchedule,
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
      // ⚠ **반드시 여기 등록돼 있어야 한다.** 결재판은 이 params로만 칸을 만들고, 승인 버튼은
      //   **화면에 보이는 칸만** 모아 서버로 되돌린다(console.js collect). 등록 안 하면
      //   승인하는 순간 조용히 사라져 「설계는 됐는데 쓰인 적 없는 값」이 된다.
      // ⚠ 그러면서도 **모델에게는 안 보인다**(기계전용) — 서버가 규칙으로 채우는 값이라
      //   모델이 쓸 일이 없고, 보여 주면 라우팅 회귀 위험만 진다. 「모델 눈」과 「사람 눈」은 다른 자리다.
      { name: "viewIds", label: "보던 목록", description: "화면에서 보고 있던 목록(자동으로 채워짐). 조건이 뜻을 잃었을 때만 대상이 된다", required: false, 기계전용: true },
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
      // ⚠ 결재판 문구는 **run과 같은 갈래**를 타야 한다. 예전엔 여기서 filter만 보고
      //   "…에 맞는 취약점 없음"이라 적었는데, run은 보던 목록으로 실행할 수도 있다 —
      //   보여 준 것과 하는 일이 어긋나면 결재판이 관문 노릇을 못 한다.
      if (!조건이좁히나(args.filter ?? "")) {
        const 보던 = matchFindingsByIds(args.viewIds ?? "");
        if (보던.matched.length === 0) {
          return args.filter?.trim() ? `"${args.filter}"만으로는 대상이 안 좁혀짐 — 조건을 말하거나 목록에서 고르세요` : "무엇에 적용할지 정하지 않음";
        }
        const s = 보던.matched.slice(0, 5).map((x) => x.label).join(" · ");
        return `지금 보고 계신 목록 ${보던.matched.length}건에 적용 — ${s}${보던.matched.length > 5 ? ` 외 ${보던.matched.length - 5}건` : ""}`;
      }
      const m = matchFindingsByFilter(args.filter ?? "");
      if (m.length === 0) return `"${args.filter}"에 맞는 취약점 없음`;
      const sample = m.slice(0, 5).map((x) => x.label).join(" · ");
      return `${m.length}건에 일괄 적용 — ${sample}${m.length > 5 ? ` 외 ${m.length - 5}건` : ""}`;
    },
    undo: "승인 화면(취약점 관리)에서 개별로 되돌릴 수 있습니다. 범위가 크면 filter를 좁혀 다시 지시하세요.",
    run: runBulkUpdate,
  },
  {
    // 조치·수정 요청서(2026-08-21 시안 확정) — 승인하면 **내 문서에 md 초안**이 생기고 요청
    // 등록부(outbound_requests)에 적힌다. 발송은 사람이 한다(문서함에서 다듬어 내보내기).
    name: "create_request_doc",
    label: "조치 요청서 초안",
    domain: "cross",
    write: true,
    description:
      '취약점 조치·보안패치·보안정책 수정·버그 수정 요청서 초안을 만든다 — "이것들 조치 요청서 만들어줘", ' +
      '"방화벽 정책 수정 요청서 만들어줘". 초안은 내 문서에 md로 생겨 문서함에서 다듬은 뒤 PDF·Word로 내보낸다.',
    params: [
      { name: "kind", label: "요청 유형", description: "취약점 조치 / 보안패치 / 보안정책 수정 / 버그 수정 (비우면 취약점 조치)", required: false },
      { name: "ids", label: "고른 대상", description: "대화창 목록에서 체크한 취약점들(자동으로 채워짐)", required: false },
      { name: "recipient", label: "수신처", description: "비워 두면 문서함에서 적습니다(자동으로 채우지 않음 — 확정 ②)", required: false },
      { name: "dueDate", label: "조치 기한", description: "비우면 심각도 기준 자동(가장 급한 것, SLA 표)", required: false },
      { name: "recheck", label: "재점검 조건", description: "비우면 「조치 완료 통보 후 재스캔」", required: false },
    ],
    // 지시문의 유형 낱말을 kind로 채운다(2026-08-21 라이브 실측 — 「정책 수정 요청서」가 kind
    // 빈 채로 와서 「취약점 조치」로 떨어졌다). handlers의 kindRaw 정규화와 같은 잣대.
    autoFill: (_args, instruction): Record<string, string> => {
      const t = instruction ?? "";
      if (/패치/.test(t)) return { kind: "patch" };
      if (/정책/.test(t)) return { kind: "policy" };
      if (/버그/.test(t)) return { kind: "bug" };
      return {}; // 그 외는 취약점 조치(기본) — 굳이 채우지 않는다
    },
    effect: (args) => {
      const n = String(args.ids ?? "").split(/[\s,]+/).filter(Boolean).length;
      const k = String(args.kind ?? "").trim() || "취약점 조치";
      return `${k} 요청서 초안 1건을 내 문서에 만듦${n ? ` — 취약점 ${n}건 동봉` : ""}. 발송은 하지 않음(문서함에서 다듬어 내보냄)`;
    },
    // ⚠ 「되돌릴 수 있다」고 쓰지 않는다 — 이 쓰기는 undo 스냅샷 대상 밖이다(설계관 ②).
    undo: "초안 문서는 내 문서에서 지울 수 있고, 요청 기록은 보안제품 화면의 요청 이력에서 정리합니다.",
    run: runCreateRequestDoc,
  },
  {
    name: "request_status",
    label: "요청 현황",
    domain: "cross",
    write: false,
    description: '밖으로 보낸 조치·수정 요청서의 현황을 본다 — "요청 현황 알려줘", "회신 없는 요청 있어?"',
    params: [],
    directAnswer: true,
    run: runRequestStatus,
  },
  {
    // URL 지식화(2026-08-21) — 외부 접속이라 **쓰기·결재판**이다. 승인 화면에 도메인이 보인다.
    // 에어갭 봉인이 켜지면 fetch 관문이 자동 차단한다(EGRESS_POINTS "webingest").
    name: "ingest_url",
    label: "링크 지식화",
    domain: "cross",
    write: true,
    description:
      '웹 페이지나 유튜브 영상(자막)을 우리 지식으로 담는다 — "이 링크 지식으로 넣어줘 https://…". ' +
      '본문만 발라 반입하고, 유튜브는 자막이 있는 영상만 된다. 내부망·사설 주소는 거절한다.',
    params: [
      { name: "url", label: "주소", description: "http(s):// 로 시작하는 공개 웹 주소 또는 유튜브 링크", required: true },
    ],
    // 지시문에 URL이 뻔히 있는데 칸이 비면 승인 실행이 인자 누락으로 죽는다(2026-08-21 라이브
    // 실측이 잡음) — 첫 http(s) 주소를 규칙으로 뽑아 채운다(source=auto, 사람이 결재판에서 수정 가능).
    autoFill: (_args, instruction): Record<string, string> => {
      const m = /https?:\/\/[^\s"'<>　]+/.exec(instruction ?? "");
      return m ? { url: m[0].replace(/[.,)\]]+$/, "") } : {};
    },
    effect: (args) => {
      try { const u = new URL(String(args.url ?? "").trim()); return `외부 접속: ${u.hostname} — 본문을 받아 지식 저장소에 담음(사내 참고용)`; }
      catch { return "주소가 비어 있거나 형식이 아님 — 승인 전에 주소를 확인하세요"; }
    },
    undo: "담은 문서는 지식 문서 목록에서 그 주소를 지우면 답변에서 즉시 빠집니다.",
    run: runIngestUrl,
  },
  {
    // 전문가 어댑터 현황(재설계, 2026-08-08) — 등록부·팀원 배정·주제 재료를 한 번에.
    name: "adapter_status",
    label: "전문가 어댑터 현황",
    domain: "cross",
    write: false,
    description:
      'AI팀의 전문가 어댑터(LoRA) 등록·채택 현황과 팀원 배정, 주제별 학습 재료 진척을 본다. ' +
      '"어댑터 현황", "전문가 어댑터 뭐 있어?", "어댑터 채택됐어?" 같은 물음에 쓴다.',
    params: [],
    directAnswer: true,
    run: runAdapterStatus,
  },
  {
    // 어댑터 채택/해제(쓰기·admin) — 등록≠채택 관문. 채택엔 게이트 근거(note) 필수.
    // ⚠ admin만: 채택된 어댑터는 다음 재기동부터 실서비스 답변에 실린다.
    name: "adopt_adapter",
    label: "전문가 어댑터 채택",
    domain: "cross",
    write: true,
    requiredRole: "admin",
    description:
      '학습이 구운 어댑터를 실서비스에 실릴 수 있게 채택(또는 해제)한다. 채택에는 평가 게이트 근거가 필수다. ' +
      '"sec-expert-vuln-v2 어댑터 채택, 근거: 게이트 통과", "어댑터 채택 해제해줘"처럼 말할 때 쓴다. ' +
      '예: {"adapter":"sec-expert-vuln-v2","mode":"채택","note":"게이트 routing 66/66 · A/B 통과"}',
    params: [
      { name: "adapter", label: "어댑터", description: "등록부의 어댑터 이름 — 「어댑터 현황」으로 확인", required: true },
      { name: "mode", label: "채택/해제", description: "「채택」 또는 「해제」 — 비우면 채택", required: false },
      { name: "note", label: "근거", description: "채택 근거(게이트·A/B 결과) — 채택 시 필수", required: false },
    ],
    effect: (args) =>
      (args.mode ?? "").trim() === "해제"
        ? `어댑터 ${args.adapter}를 서빙 대상에서 내립니다 — 다음 모델 재기동부터 빠지고, 배정 팀원은 베이스로 답합니다.`
        : `어댑터 ${args.adapter}를 채택합니다 — 다음 모델 재기동부터 서빙에 실리고 팀원 배정이 가능해집니다. 근거: ${(args.note ?? "").trim() || "(없음 — 실행 시 거절됩니다)"}`,
    undo: "같은 어댑터를 「해제」로 다시 지시하면 서빙 대상에서 내려갑니다.",
    run: runAdapterAdopt,
  },
  {
    // 팀원 어댑터 배정(쓰기) — 채택분만·총괄 금지는 서버(agents)가 강제한다.
    name: "assign_adapter",
    label: "팀원 어댑터 배정",
    domain: "cross",
    write: true,
    description:
      'AI팀원에게 채택된 전문가 어댑터를 배정(또는 해제)한다 — 배정하면 그 팀원 답변에 전문 어댑터가 켜진다. ' +
      '"스캔 팀원에 sec-expert-vuln-v2 배정해줘", "리포트 팀원 어댑터 해제"처럼 말할 때 쓴다. ' +
      '예: {"agent":"스캔","adapter":"sec-expert-vuln-v2"}',
    params: [
      { name: "agent", label: "팀원", description: "팀원 이름·역할(스캔·분석·리포트·TI·GIJO)", required: true },
      { name: "adapter", label: "어댑터", description: "채택된 어댑터 이름 — 「없음」이면 배정 해제", required: false },
    ],
    effect: (args) =>
      !((args.adapter ?? "").trim()) || /^(없음|해제|베이스)$/.test((args.adapter ?? "").trim())
        ? `${args.agent} 팀원의 어댑터 배정을 해제합니다 — 베이스 그대로 답하게 됩니다.`
        : `${args.agent} 팀원에 어댑터 ${args.adapter}를 배정합니다 — 서빙에 실려 있으면 다음 답변부터 적용됩니다.`,
    undo: "같은 팀원에 「없음」으로 다시 지시하면 배정이 해제됩니다.",
    run: runAdapterAssign,
  },
  {
    // 어댑터 반입(쓰기·admin·결재판) — 밖에서 검증된 GGUF LoRA를 등록부로. 등록≠채택 그대로.
    // 지식 번들 반입과 같은 성격의 문이라 admin만 연다 — 밖에서 온 파일일수록 관문이 세야 한다.
    name: "import_adapter",
    label: "전문가 어댑터 반입",
    domain: "cross",
    write: true,
    requiredRole: "admin",
    description:
      '외부에서 학습·검증된 LoRA 어댑터(.gguf)를 등록부에 반입한다. 파일을 먼저 서버 data/lora 폴더에 넣고 부른다. ' +
      '"sec-expert-vuln-v2.gguf 어댑터 반입해줘", "취약점 어댑터로 반입"처럼 말할 때 쓴다. 반입해도 채택 전에는 실서비스에 실리지 않는다. ' +
      '예: {"file":"sec-expert-vuln-v2.gguf","topic":"취약점"}',
    params: [
      { name: "file", label: "파일", description: "반입할 GGUF 파일명(서버 data/lora 폴더 기준)", required: true },
      { name: "topic", label: "전문 분야", description: "취약점·장비운영·사내규정·위협대응 중 하나(선택)", required: false },
      { name: "note", label: "메모", description: "출처·검증 이력 메모(선택)", required: false },
    ],
    effect: (args) =>
      `어댑터 파일 ${args.file}을 등록부에 반입합니다 — GGUF 형식 검사·지문(sha256) 기록 후 **미채택**으로 등록됩니다. 실서비스 반영은 게이트 통과·채택 후입니다.`,
    undo: "반입만으로는 아무것도 실행되지 않습니다 — 등록부에서 삭제 지시로 되돌릴 수 있습니다.",
    run: runAdapterImport,
  },
  {
    // 제품 소개자료 등록(쓰기·결재판) — 보안제품 등록부와 별도 대장. 화면(intro.html)은 보기 전용.
    name: "register_product_intro",
    label: "제품 소개자료 등록",
    domain: "cross",
    write: true,
    description:
      '도입 검토용 제품 소개자료를 별도 대장에 등록한다(보안제품 등록부와 다름 — 검토 중 제품도 됨). ' +
      '"제품 소개자료 등록: SecuFW, 분류: 방화벽, 벤더: 시큐업"처럼 말할 때 쓴다. ' +
      '예: {"name":"SecuFW","category":"방화벽","vendor":"시큐업","summary":"차세대 방화벽"}',
    params: [
      { name: "name", label: "제품 이름", description: "소개자료의 제품 이름", required: true },
      { name: "category", label: "분류", description: "방화벽·EDR·SIEM·WAF 등(비우면 기타)", required: false },
      { name: "vendor", label: "벤더", description: "제조사(선택)", required: false },
      { name: "summary", label: "한 줄 소개", description: "자료에 적힌 한 줄 소개(선택)", required: false },
      { name: "doc", label: "소개서 문서명", description: "대화창 ＋로 올린 소개서 문서명(선택)", required: false },
    ],
    effect: (args) => "제품 소개자료 대장에 \"" + args.name + "\"" + 조사(String(args.name ?? ""), "을") + " 등록합니다 — 소개자료 화면 목록·비교에 나타납니다.",
    undo: "소개자료 화면에서 확인 후, 삭제 지시로 되돌릴 수 있습니다.",
    run: runProductIntroAdd,
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
/**
 * 도구 이름 → 사람 말 라벨. 해석 한 줄("이렇게 알아들었습니다: …")이 쓴다 —
 * 내부 식별자(finding_status)를 담당자에게 보여 주면 안 되기 때문이다(내부 식별자 노출 금지 원칙).
 */
export function toolLabel(name: string): string | null {
  const t = TOOLS.find((x) => x.name === name);
  return t ? t.label : null;
}

/**
 * 에디션별 도구 허용 목록 (2026-08-12 신설 — 라이트 에디션 요청 ①).
 *
 * ■ 왜 필요한가
 *   지금까지 **티어로 도구를 거르는 장치가 없었다.** 라이트는 도구 78개 중 13개만 쓰는데,
 *   그 결정을 코드에 반영할 자리가 제품에 아예 없었다(max 확인).
 *
 * ■ ⚠ VRAM을 줄이려고 두는 것이 **아니다** — 그렇게 적힌 문서가 있으면 그게 틀렸다.
 *   llama.cpp는 KV 캐시를 `--ctx-size`만큼 **미리** 잡는다. 프롬프트가 25,769자든 4,056자든
 *   잡히는 메모리는 같다. 이걸로 얻는 것은 **처리 속도**와 **같은 ctx 안의 여유**지 VRAM이 아니다.
 *   (2026-08-12: 「프롬프트 91% 감소가 8GB 등급의 근거」라는 서술이 있었는데 성립하지 않는다.)
 *
 * ■ 목록 자체는 여기 두지 않는다 — 에디션을 아는 쪽이 넣는다(`server/src/lite/lite-tools.json`).
 *   레지스트리는 「무엇을 거를지」만 알고 「무엇이 라이트인지」는 모른다.
 *
 * ⚠ 이 목록은 **카탈로그(LLM이 고를 후보)**만 거른다. `findAgentTool`은 안 거른다 —
 *   강제 의도(FORCED_INTENTS)가 이름으로 직접 부르는 경로가 있어서, 거기까지 막으면
 *   결정 분기가 조용히 죽는다. 실행까지 막아야 하면 `isToolAllowed`를 그 자리에서 쓸 것.
 */
let 허용목록: Set<string> | null = null;

export function setToolAllowlist(names: string[] | null): void {
  if (names === null) { 허용목록 = null; return; }
  // ⚠ 모르는 이름이 있으면 **조용히 넘기지 않는다.** 오타 하나로 도구가 사라지면
  //   「그 기능이 원래 없나 보다」로 읽힌다 — 오늘 라우팅 결함이 정확히 그렇게 오래 남았다.
  const 모르는것 = names.filter((n) => !TOOLS.some((t) => t.name === n));
  if (모르는것.length) throw new Error(`도구 허용목록에 없는 이름: ${모르는것.join(", ")}`);
  허용목록 = new Set(names);
}

export function isToolAllowed(name: string): boolean {
  return 허용목록 === null || 허용목록.has(name);
}

/**
 * 도구 허용목록이 걸려 있는가 = **제한 에디션(라이트)로 부팅됐는가**.
 * 서버가 가진 유일한 에디션 신호다(lite/index.ts가 부팅 전에 setToolAllowlist를 건다).
 * ⚠ 표준 화면 이름을 안내하는 갈래(screenguide 방법정규별칭 등)가 라이트에서 **없는 화면**을
 *   가리키지 않게 가를 때 쓴다 — 2026-08-14 검토관 지적(「장비 접속」이 라이트에 없는
 *   hardening.html을 안내). 라이트는 화면이 전부 lite-*라 이름이 다르다.
 */
export function 에디션제한중(): boolean {
  return 허용목록 !== null;
}

export function listToolsFor(domains?: string[], role?: string): AgentTool[] {
  // 꺼져 있는 선택 기능의 도구는 아예 목록에서 뺀다.
  // ⚠ 2026-07-26 회귀: 법령 조회(기본 꺼짐)를 켜지 않은 상태에서도 law_lookup이 목록에 남아,
  //   "금융권 망분리의 법적 근거는?" 같은 질문이 그리로 가서 "인증키를 넣으세요"로 막혔다.
  //   예전에는 사내 문서(RAG)로 답하던 질문이다 — 꺼진 기능이 멀쩡하던 답을 빼앗으면 안 된다.
  //   목록에서 빼면 에이전트가 explain·search로 돌아가 원래대로 답한다.
  let lawOn = false;
  try { lawOn = getLawConfig().enabled; } catch { lawOn = false; }

  return TOOLS.filter((t) => {
    if (!isToolAllowed(t.name)) return false; // 에디션 허용목록(설정 안 됐으면 통과)
    if (t.name === "law_lookup" && !lawOn) return false;
    if (t.requiredRole === "admin" && role !== "admin") return false;
    if (!domains || domains.length === 0) return true;
    return t.domain === "cross" || domains.includes(t.domain);
  });
}

export function toolCatalogText(domains?: string[], role?: string): string {
  return listToolsFor(domains, role)
    .map((t) => {
      // ⚠ 기계전용 인자는 **모델에게 안 보인다.** 서버가 규칙으로 채우는 값이라 모델이 쓸 일이 없고,
      //   보여 주면 라우팅 회귀 위험(도구 설명 한 줄에 11/11→9/11 떨어진 전례)만 지게 된다.
      //   결재판 칸에서는 빠지지 않는다 — 거기서 빼면 승인 때 값이 증발한다(다른 자리다).
      const 보일인자 = t.params.filter((p) => !p.기계전용);
      const params = 보일인자.length ? `(${보일인자.map((p) => p.name + (p.required ? "" : "?")).join(", ")})` : "()";
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
    if (v !== undefined && typeof v !== "string") return `인자 ${말조사(p.name, "은")} 문자열이어야 합니다`;
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
  args: Record<string, string>; // autoFill **정정 후** 값 — 세션 기억(setLastTarget)은 이걸 써야
  //   한다(검토관 6②: 정정 전 LLM 추정값으로 기억하면 「아까 그거」가 엉뚱한 자산을 가리킨다)
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
  const autoFilled = tool.autoFill ? tool.autoFill(rawArgs, instruction, toolResults) : {};
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
    // ⌗기계 키 꼬리는 저장본에서 뗀다 — 이 지시문은 파인튜닝 골드 예시로 누적되는데 sha1이
    // 섞이면 모델이 해시를 흉내 낸다(검토관 12). autoFill 파싱은 위에서 이미 끝났다.
    instruction: instruction.replace(/\s*⌗.+?::[0-9a-f]{16}/g, ""),
    args, // autoFill 정정 후 값 — 세션 기억은 이걸 쓴다(검토관 6②)
  };
}

// 승인된 쓰기 도구를 실행한다 — 화면에서 사람이 확인(값 수정 가능)한 뒤에만 여기로 온다.
// 규칙 검증은 여기서 한 번 더 한다(화면을 우회한 호출 방어).
//
// ⚠ **권한도 여기서 다시 본다**(2026-08-05 검토관이 잡은 결함). requiredRole은 그전까지
//   listToolsFor가 **목록에서 숨기는 것**뿐이었다 — 실행 문턱에는 검사가 하나도 없어서
//   담당자(security_officer)가 /api/agent/approve를 직접 부르면 admin 전용 도구가 그냥 돌았다.
//   결재판은 "LLM의 오발동"을 막는 장치지 "권한 없는 직접 호출"을 막는 장치가 아니다.
//   숨기기(목록)와 막기(실행)는 다른 일이고, 막는 쪽이 없으면 숨기기는 장식이다.
export async function executeApprovedTool(toolName: string, args: Record<string, string>, role?: string): Promise<string> {
  const tool = findAgentTool(toolName);
  if (!tool) throw new Error(`존재하지 않는 도구: ${toolName}`);
  if (!tool.write) throw new Error(`${말조사(toolName, "은")} 승인이 필요한 쓰기 도구가 아닙니다`);
  if (tool.requiredRole === "admin" && role !== "admin") {
    throw new Error(`${말조사(tool.label, "은")} 관리자만 실행할 수 있습니다.`);
  }
  const invalid = validateToolArgs(tool, args);
  if (invalid) throw new Error(invalid);
  return String(await tool.run(args));
}
