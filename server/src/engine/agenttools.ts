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
import { listAssets, getAsset, registerAsset, updateAssetOwnership, setAssetRobustness, isAiAsset, Asset } from "./assets";
import { computeAssetCoverage, coverageSummaryText, type GapKind } from "./assetcoverage";
import { expandOntology } from "./ontology";
import { prioritizedReviews, updateFindingReview, findingKey, ReviewPatch, ApprovalStatus } from "./approvals";
import { listProducts, createProduct, PRODUCT_CATEGORIES } from "./securityproducts";
import { listMaintenanceItems, createMaintenanceItem } from "./maintenance";
import { listCompliance, setComplianceStatus } from "./compliance";
import { generateSbom } from "./sbom";
import type { ComplianceStatus } from "./compliance";
import { countTriples } from "./ontology";
import { listVisibleDocuments, queryMemory, queryMemoryRelevant } from "./memory";
import { listFindings as listCtiFindings } from "./cti";
import { matchCtiToAssets } from "./ctimatch";
import { dailyBriefingText } from "./briefing";
import { runRedTeam, makeServedCaller } from "./redteam";
import { runHardeningScan, scanSummaryText, isStandard } from "./hardeningscan";
import { listSchedules as listReportSchedules, scheduleSummaryText } from "./reportschedule";
import { listSchedules as listHardeningSchedules } from "./hardeningtargets";
import { timeSavedText } from "./timesaved";
import { feedbackSummaryText } from "./answerfeedback";
import { adoptionSummaryText } from "./modeladoption";
import { systemHealthText } from "./observability";
import { alertScheduleText, createAlertSchedule, ALERT_KIND_LABEL } from "./alertschedule";
import type { AlertKind } from "./alertschedule";
import { getSmtpConfig } from "./email";
import { listAnalysisEvents, analysisSummary, computeCorrelations } from "./analysishub";
import { computeKpiSnapshot } from "./kpi";
import { listSessions as listWorkSessions } from "./worksessions";
import { canonicalize, suggestionsFor } from "./terms";
import { listAudit, type AuditEntry } from "./audit";
import { lawAnswer, getLawConfig, type LawTarget } from "./lawinfo";
// 담당자가 "미조치"라고 하면 저장값 open·pending을 뜻한다 — 글자 그대로 대조하면 늘 0건이다.
import { 필터에맞나 } from "./statuswords";
// 내 업무(할 일) — 화면을 없애고 대화창에서 한다(2026-08-01 사용자 결정).
import { listTasks, createTask, completeTask, setGuideStepDone } from "./tasks";
import { buildMyWork } from "./mywork";
import { getGuide as 가이드가져오기 } from "./workguide";
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

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

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
export function isRealVulnerability(f: { finding_type?: string }): boolean {
  return !SCAN_NOISE.has(String(f.finding_type ?? ""));
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
  const scanErrors = asset.findings.length - real.length;
  // 스캔 실패는 감추지 않는다 — 취약점이 아니라고 말할 뿐이다. 감추면 "왜 결과가 없지?"가 된다.
  const errNote = scanErrors ? ` · 스캔 실패 ${scanErrors}건(취약점 아님 — 재스캔 필요)` : "";
  if (real.length === 0) return `finding 없음${errNote}`;
  const counts = SEVERITY_ORDER.map((s) => [s, real.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`)
    .join(", ");
  return `finding ${real.length}건 (${counts})${errNote}`;
}

function runListAssets(): string {
  const assets = listAssets();
  if (assets.length === 0) return "등록된 AI 자산이 없습니다.";
  const lines = assets.map(
    (a) => `- ${a.id} | ${a.name} | 유형=${a.assetType} | 담당=${a.owner || "미지정"} | ${findingSummary(a)}`
  );
  return [`등록된 AI 자산 ${assets.length}개:`, ...lines].join("\n").slice(0, 2000);
}

// 자산 상세 — AI-BOM까지 한 번에 준다(예전엔 get_aibom을 따로 뒀는데, LLM이 "AI-BOM도 봐야 하나"를
// 매번 판단해야 해서 도구만 늘고 턴이 늘었다. 상세는 상세 하나로 충분하다).
function runGetAsset(args: Record<string, string>): string {
  const asset = getAsset(args.assetId);
  if (!asset) {
    const ids = listAssets().map((a) => a.id).join(", ") || "(없음)";
    return `자산 "${args.assetId}"을(를) 찾을 수 없습니다. 등록된 자산 id: ${ids}`;
  }
  const top = asset.findings
    .slice()
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 5)
    .map((f) => `  - [${f.severity}] ${f.finding_type}: ${f.evidence.slice(0, 80)}`);
  const b = asset.aibom;
  const v = (s: string) => (s.trim() === "" ? "미기재" : s);
  const aibomLines = [
    `AI-BOM: 파운데이션=${v(b.model.foundationModel)} | 아키텍처=${v(b.model.architecture)} | 용도=${v(b.model.intendedUse)}`,
    `        데이터출처=${v(b.dataset.sources)} | 가드레일=${v(b.prompt.guardrails).slice(0, 40)} | 인프라=${v(b.infrastructure.compute)}`,
  ];
  // 온톨로지 연계: 이 자산의 유형·구성에 걸리는 위협·완화통제를 함께 준다(AI-BOM → 위협 흐름).
  const threats = ontologyLinesFor(`${asset.name} ${asset.assetType} ${b.model.foundationModel} ${b.model.architecture}`, 6);
  return [
    `자산 ${asset.id} (${asset.name})`,
    `유형=${asset.assetType} | 담당=${asset.owner || "미지정"} | 서비스=${asset.service ?? "미지정"} | 경로=${asset.path}`,
    `마지막 스캔: ${asset.lastScannedAt ? koDateTimeString(asset.lastScannedAt) : "스캔 이력 없음"} | ${findingSummary(asset)}`,
    ...aibomLines,
    ...(top.length ? ["주요 finding(심각도순, 최대 5건):", ...top] : []),
    ...(threats.length ? ["사내 온톨로지가 아는 관련 위협·통제:", ...threats] : []),
  ].join("\n").slice(0, 2500);
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

async function searchOne(q: string): Promise<string[]> {
  const out: string[] = [];
  const tokens = queryTokens(q);

  const assets = listAssets().filter(
    (a) =>
      matchesLoose(a.id, q, tokens) ||
      matchesLoose(a.name, q, tokens) ||
      matchesLoose(a.assetType, q, tokens) ||
      a.components.some((c) => matchesLoose(c.name, q, tokens))
  );
  if (assets.length) {
    out.push(`AI 자산 ${assets.length}건:`, ...assets.slice(0, 6).map((a) => `  - ${a.id} | ${a.name} | ${a.assetType} | ${findingSummary(a)}`));
    // 대상이 좁혀졌으면 취약점 **이름**까지 준다(2026-07-28 실측).
    // 건수만 주면 LLM은 아는 만큼만 말해 "medium 1건, low 2건"으로 끝난다 — 담당자가 알고 싶은 건
    // "무엇이" 취약한가다. 아래 취약점 섹션은 우선순위 상위 100건만 보므로 낮은 위험은 거기서 샌다.
    for (const a of assets.slice(0, 3)) {
      // scan_error는 취약점 목록에 넣지 않는다(위 isRealVulnerability 주석 참고).
      const real = a.findings.filter(isRealVulnerability);
      if (!real.length) continue;
      out.push(
        `  · ${a.name} 취약점 ${real.length}건:`,
        ...real.slice(0, 8).map((f) => `      - [${f.severity}] ${f.finding_type}`)
      );
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
    // assetId를 함께 준다 — LLM이 이어서 get_asset(assetId)을 부를 수 있어야 한다.
    // (자산명만 주면 id를 몰라 다음 도구를 못 부르고 턴이 낭비된다.)
    out.push(
      `취약점 ${vulns.length}건(우선순위순):`,
      ...vulns.slice(0, 6).map((r) => `  - [${r.finding.severity}] ${r.finding.finding_type} @ ${r.assetName}(id=${r.assetId}) — 점수 ${r.score}${r.assignee ? `, 담당 ${r.assignee}` : ""}${r.overdue ? " ⚠지연" : ""}`)
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
    // assetId 포함 — LLM이 "1번 자산 자세히 봐줘" 후속 지시에 get_asset을 바로 부를 수 있게.
    return `${i + 1}. [${f.severity}] ${f.finding_type} @ ${r.assetName}(id=${r.assetId})${tags ? ` — ${tags}` : ""}${r.assignee ? ` | 담당 ${r.assignee}` : " | 담당 미지정"}${r.dueDate ? ` | 기한 ${r.dueDate}` : ""}${r.overdue ? " ⚠기한초과" : ""}`;
  });
  const overdue = top.filter((r) => r.overdue).length;
  return [
    `오늘 조치 우선순위 상위 ${top.length}건 (KEV→EPSS→VPR 순):`,
    ...lines,
    overdue ? `⚠ 기한 초과 ${overdue}건 포함` : "",
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
  // matchedAssets에 id=를 함께 준다 — LLM이 이어서 get_asset(assetId)으로 파고들 수 있게.
  const lines = top.map((m) => {
    const hit = m.matchedAssets.map((a) => `${a.assetName}(id=${a.assetId})`).join(", ");
    return `- [${m.finding.severity}] ${m.finding.type} — ${m.finding.target} (출처 ${m.finding.source}) → 우리 자산: ${hit}`;
  });
  return [
    `최신 위협 ${summary.totalFindings}건 중 우리 자산에 걸리는 것 ${summary.matchedFindings}건 (영향 자산 ${summary.affectedAssets}개, 심각·경고 ${summary.criticalMatches}건):`,
    ...lines,
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
      if (st === "fixed") fixedList.push(`${a.id} [${f.severity}] ${f.finding_type}`);
    }
  }
  const total = Object.values(counts).reduce((x, y) => x + y, 0);
  if (total === 0) return "스캔된 취약점이 없습니다. (취약점 관리에서 스캔 결과를 업로드하세요.)";
  const parts = [
    `재스캔 기준 상태 (총 ${total}건): 신규 ${counts.new} · 활성 ${counts.active} · 해결 ${counts.fixed} · 재발 ${counts.resurfaced}`,
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
    const ids = listAssets().map((a) => a.id).join(", ") || "(없음)";
    return `자산 "${args.assetId}"을(를) 찾을 수 없습니다. 등록된 자산 id: ${ids}`;
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
  const vulnList = report.results.filter((r) => r.vulnerable).slice(0, 5).map((r) => `  - [${r.severity}] ${r.desc} (${r.basis})`);
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
    const ids = listAssets().map((a) => a.id).slice(0, 12).join(", ") || "(없음)";
    return `대상 자산을 찾지 못했습니다: "${args.assetId}". 등록된 자산 id: ${ids}`;
  }
  const owner = (args.owner ?? "").trim();
  const service = args.service?.trim();
  for (const a of resolved) {
    updateAssetOwnership(a.id, { owner, ...(service ? { service } : {}) });
  }
  const names = resolved.map((a) => a.id).join(", ");
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
  const p = createProduct({ name, category, vendor: args.vendor?.trim() || undefined, model: args.model?.trim() || undefined });
  return `보안제품을 등록했습니다 — ${p.name} · 종류 ${p.category}${p.vendor ? ` · ${p.vendor}` : ""}${p.model ? ` ${p.model}` : ""}.`;
}

async function runGenerateSbom(args: Record<string, string>): Promise<string> {
  const asset = resolveAsset(args.assetId ?? "");
  if (!asset) {
    const ids = listAssets().map((a) => a.id).slice(0, 12).join(", ") || "(없음)";
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
  return `[${f.severity}] ${f.finding_type}`;
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
    const ids = listAssets().map((a) => a.id).join(", ") || "(없음)";
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
  return sel.map((r) => ({ assetId: r.assetId, key: r.findingKey, label: `[${r.finding.severity}] ${r.finding.finding_type} @ ${r.assetName}` }));
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
      label: `[${r.finding.severity}] ${r.finding.finding_type} @ ${r.assetName}`,
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
function runFindingStatusOverview(args: Record<string, string>): string {
  const filter = (args.filter ?? "").trim().toLowerCase();
  const rows = prioritizedReviews(200);
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

  const head =
    `취약점 ${matched.length}건 — 미검토 ${byStatus.pending ?? 0}, 조치완료 ${byStatus.approved ?? 0}, 오탐 ${byStatus.rejected ?? 0}` +
    ` / 담당자 미배정 ${unassigned}건, 기한 초과 ${overdue}건`;

  const lines = matched.slice(0, 10).map((r) => {
    const who = r.assignee ? `담당 ${r.assignee}` : "담당 미배정";
    const due = r.dueDate ? `기한 ${r.dueDate}` : "기한 없음";
    return `- [${r.finding.severity}] ${r.assetId} · ${r.finding.finding_type} (${r.status}, ${who}, ${due})`;
  });
  const more = matched.length > 10 ? `\n… 외 ${matched.length - 10}건` : "";
  // 담당자가 없는 건이 있으면 그게 **다음에 할 일**이다 — 배정 안 된 건은 아무도 안 한다.
  const 할말 = unassigned
    ? `담당자 미배정 ${unassigned}건이 병목입니다 — "1번 담당자 배정해줘"라고 하시거나 조치·승인 화면에서 배정하세요.`
    : '조치·승인 화면에서 상태를 옮기거나, 여기서 "○○ 조치완료로 바꿔줘"라고 말해도 됩니다.';
  return `${head}\n${lines.join("\n")}${more}${다음걸음(할말)}`;
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
  const shown = gap.assetIds.slice(0, 15).map((id) => `- ${id}`).join("\n");
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
    const head = `${a.id} — AI-BOM ${filled}/${total} 항목 기재, ${sbom}, ${rob}`;
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
    .map((r) => `- ${r.a.id}: ${r.filled}/${r.total} 기재${r.missing.length ? ` (미기재 ${r.missing.length}개)` : " ✓"}`);
  const more = rows.length > 10 ? `\n… 외 ${rows.length - 10}건` : "";
  return `${head}\n${lines.join("\n")}${more}`;
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
    const 표 = 끝난.has(i) ? "☑" : i === 다음번호 ? "▶" : "☐";
    const 곁 = s.desc ? ` — ${s.desc}` : "";
    return `${표} ${i + 1}. ${s.title}${곁}`;
  }).join("\n");
  const 기한지남 = typeof t.dueAt === "number" && t.dueAt < Date.now();
  const 머리 = `**${t.text}** · 절차 ${끝난.size}/${g.steps.length}` + (기한지남 ? " ⚠ 기한 지남" : "");
  if (다음번호 < 0) {
    return `${머리}\n${줄}\n\n▸ 절차를 다 밟으셨습니다 — 끝내려면 "${t.text} 완료"`;
  }
  const 다음 = g.steps[다음번호];
  const 힌트 = 다음.kind === "ask" && 다음.question ? `\n▸ 이렇게 물으시면 됩니다 — "${다음.question}"`
    : 다음.kind === "open" && 다음.page ? `\n▸ ${다음.page} 화면을 보시면 됩니다` : "";
  return `${머리}\n${줄}${힌트}\n\n▸ ${다음번호 + 1}번을 끝내셨으면 "${다음번호 + 1}번 했어"`;
}

async function runWorkSteps(args: Record<string, string>): Promise<string> {
  const 말 = (args.task ?? "").trim();
  if (!말) return "어떤 일의 절차인지 알려주세요 — 예: \"방화벽 점검 어떻게 해?\"";
  const { hit, 열린것 } = 열린할일찾기(말);
  if (hit) return 절차카드(hit);
  const 담은것 = await 제안담기(말); // 아직 안 담은 AI 제안이면 담고 연다
  if (담은것) return `AI가 제안한 일이라 **내 업무에 담고** 절차를 엽니다.\n\n` + 절차카드(담은것);
  return `전체 ${열린것.length}건 중 "${말}"에 맞는 할 일을 못 찾았습니다. "오늘 할 일"이라고 물어 목록부터 보세요.`;
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
  completeTask(hit.id);
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
  const t = createTask({ text: 글, ...(dueAt ? { dueAt } : {}) });
  return `"${t.text}"를 오늘 할 일에 담았습니다.${dueAt ? "" : " (기한은 안 정했습니다)"}\n▸ 끝내면 "${t.text} 완료"`;
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
    ],
    run: runAddTask,
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
    run: runKnowledgeStatus,
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
    run: runAuditSearch,
  },
  {
    name: "handover_status",
    label: "인수인계 현황",
    domain: "knowledge",
    write: false,
    description: '인수인계에 쓸 문서가 얼마나 쌓였는지 본다. "인수인계 어디까지 됐어?", "인수인계 준비됐어?"에 쓴다.',
    params: [],
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
    ],
    effect: (args) => `보안제품 "${(args.name ?? "").trim()}"을(를) 등록부에 추가${args.category?.trim() ? ` · 종류 ${args.category.trim()}` : ""} · 자산·취약점과는 별개`,
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
      'AI 자산 목록을 보여준다 — "자산 목록", "자산 다 보여줘", "우리 자산 뭐 있어", "등록된 자산 보여줘"에 쓴다 (개수·이름·유형·담당자·finding 요약 포함).',
    params: [],
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
