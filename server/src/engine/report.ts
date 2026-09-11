// engine/report.ts — 내부 SBOM 기반 내부보고용 리포트 (6.4.1절)
// 데이터 소스는 6.4의 자산 레지스트리(assets.ts)를 그대로 재사용 — 별도 수집 로직 없음.

import type { Express, Request } from "express";
// 심각도 우리말은 원천 한 곳(tone.ts)에서만 만든다 — 자리마다 만들면 같은 것이 둘로 보인다.
import { 심각도한글, 준수율집계전단서 } from "./tone";
import * as fs from "fs/promises";
import * as path from "path";
import { createRequire } from "module";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { todayLocal } from "../util/date";
import { chat } from "./llm";
import { 예고서두인가 } from "./tone";
import { PLAIN_LANGUAGE_RULE } from "./promptstyle";
import { listAssets, getAsset, Asset } from "./assets";
// ⚠ 스캔 실패(scan_error)는 취약점이 아니다. 판정은 이 함수 **한 곳**만 쓴다 —
//   호출부마다 제 규칙을 두면 화면·리포트마다 숫자가 달라지고, 담당자는 그 숫자로 보고를 쓴다.
import { isRealVulnerability, isActiveVuln } from "./agenttools";
import { listMaintenanceItems, MaintenanceItem } from "./maintenance";
import { listTasks, TaskItem } from "./tasks";
import { prioritizedReviews, buildTriageDraft, type PrioritizedFinding } from "./approvals";
import { aibomThreatMatches, type AiBomThreatReport } from "./compliance";
import { recordAudit } from "./audit";
import { maskSecrets } from "./secretscan";
import { recordWork } from "./worklog";
import { timeSavedReport, fmtDuration } from "./timesaved";
import type { GijoUser } from "../auth/users";

type ExpressRequestWithUser = Request & { user?: GijoUser };

export interface ReportRequest {
  type: "weekly" | "quarterly" | "ondemand" | "daily" | "monthly"; // daily/monthly는 reportschedule.ts의 정기 스케줄에서만 옴 (work-progress는 별도 함수)
  assetIds?: string[];
  format?: "docx" | "pdf" | "both"; // 기본 docx. pdf/both면 PDF도 생성(개선 #3).
  // 대상 독자: internal=내부 검토용(격식 없이 액션 중심) / official=보고용(격식·거버넌스 강조). 기본 official.
  audience?: "internal" | "official";
  createdBy?: string; // 작업 귀속 — 누가 생성했는지(라우트=로그인 사용자, 스케줄러="정기 스케줄")
  // 평가 게이트/QA 실행 표시 — 작업 원장에 담지 않는다(시험이 절감 숫자를 만들면 안 된다).
  qa?: boolean;
}

export interface ReportResult {
  filePath: string; // DOCX 경로(항상 생성)
  pdfPath?: string; // PDF 경로(format이 pdf/both이고 렌더 성공 시)
  pdfError?: string; // PDF 요청했으나 실패한 경우 사유(브라우저 미가용 등)
  executiveSummary: string;
  audience: "internal" | "official";
}

type Finding = Asset["findings"][number];

const REPORT_DIR = process.env.GIJO_REPORT_DIR || path.join("data", "reports");

function collectAssets(req: ReportRequest): Asset[] {
  if (req.assetIds?.length) {
    return req.assetIds.map((id) => getAsset(id)).filter((a): a is Asset => !!a);
  }
  return listAssets();
}

/** 심각도 건수를 **우리말 한 줄**로. LLM 프롬프트에 영문 키를 넣으면 답변에 그대로 나온다. */
// ⚠ 여기 있던 `심각도이름` 사본 표를 지웠다(2026-08-31) — 심각도 우리말의 **세 번째 사본**이었다.
//   원천은 tone.ts 하나다(2026-08-03에 「한 곳에만 둔다」로 정한 그 표).
// ⚠ 이름을 바꿨다 — 이 함수는 **개수 요약**이지 심각도 한 개의 우리말이 아니다.
//   tone.ts의 심각도한글(severity)과 **같은 이름 다른 뜻**이라 임포트가 충돌했고, 그 충돌이
//   드러나기 전까지 두 뜻이 한 이름으로 살아 있었다(2026-08-31 발견).
function 심각도별건수요약(counts: Record<string, number>): string {
  return ["critical", "high", "medium", "low"]
    .map((k) => `${심각도한글(k)} ${counts[k] ?? 0}건`)
    .join(" · ");
}

function severityCounts(assets: Asset[]): Record<string, number> {
  const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const asset of assets) {
    // 고쳐진(fixed) finding은 현재 위험이 아니므로 제외.
    for (const finding of asset.findings) {
      if (!isActiveVuln(finding)) continue;   // 활성 진짜 취약점만 — 판정은 한 곳(handlers.ts)
      counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    }
  }
  return counts;
}

// 취약점 조치 현황(리포트용) — 인프라 호스트 자산 + 취약점 연결 조치 항목(task.ref=vuln:)에서 집계.
// kpi.ts와 같은 로직이지만 순환참조(kpi↔report)를 피해 여기서 직접 계산한다.
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export interface VulnReportData {
  hosts: number;
  active: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  kev: number;
  topKev: { name: string; host: string }[]; // 실제 악용(KEV) 상위
  remediation: { tasks: number; done: number; open: number; overdue: number; slaCompliance: number; topOpen: TaskItem[] };
}

export function collectVulnReportData(scopeAssets?: Asset[]): VulnReportData {
  const now = Date.now();
  // 리포트가 특정 자산으로 스코프되면 취약점 통계도 그 자산만 집계한다(요약과 사례의 범위 일치).
  const hosts = (scopeAssets ?? listAssets()).filter((a) => a.assetType === "infra-host");
  const d = { hosts: hosts.length, active: 0, critical: 0, high: 0, medium: 0, low: 0, kev: 0, topKev: [] as { name: string; host: string }[] };
  for (const a of hosts) {
    for (const f of a.findings) {
      if (!isActiveVuln(f)) continue;   // 활성 진짜 취약점만 — 판정은 한 곳(handlers.ts)
      d.active++;
      if (f.severity === "critical") d.critical++;
      else if (f.severity === "high") d.high++;
      else if (f.severity === "medium") d.medium++;
      else d.low++;
      if (f.kev) {
        d.kev++;
        if (d.topKev.length < 10) d.topKev.push({ name: f.finding_type, host: a.name });
      }
    }
  }
  const tasks = listTasks().filter((t) => (t.ref ?? "").startsWith("vuln:"));
  const done = tasks.filter((t) => t.done).length;
  const overdue = tasks.filter((t) => !t.done && t.dueAt != null && t.dueAt < now).length;
  const compliant = tasks.filter((t) => t.dueAt == null || t.done || t.dueAt >= now).length;
  // ⚠ 이 산식은 kpi.ts remediationMetrics()와 **같은 값이어야 한다**(둘을 합칠 수 없다 —
  //   kpi.ts가 이 파일을 import하므로 반대 방향은 순환이다). 어긋나면 같은 날 대화 KPI와
  //   보고서가 다른 준수율을 말한다 — 짝 감시: server/test/slaclue.test.ts가 같은 데이터로
  //   두 값을 실제로 계산해 대조한다(2026-09-11 검토관 [중]).
  const slaCompliance = tasks.length ? Math.round((compliant / tasks.length) * 100) : 100;
  const topOpen = tasks
    .filter((t) => !t.done)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    .slice(0, 10);
  return { ...d, remediation: { tasks: tasks.length, done, open: tasks.length - done, overdue, slaCompliance, topOpen } };
}

// 유지보수 점검 현황 요약(거버넌스 섹션용). scheduleDate가 오늘 이하인 scheduled는 "지연".
export interface MaintenanceSummary {
  total: number;
  scheduled: number;
  overdue: number;
  reported: number; // 승인 대기
  approved: number;
  rejected: number;
}

export function maintenanceSummary(items: MaintenanceItem[]): MaintenanceSummary {
  const today = todayLocal();
  const s: MaintenanceSummary = { total: items.length, scheduled: 0, overdue: 0, reported: 0, approved: 0, rejected: 0 };
  for (const m of items) {
    if (m.status === "scheduled") {
      s.scheduled++;
      if (m.scheduleDate <= today) s.overdue++;
    } else if (m.status === "reported") s.reported++;
    else if (m.status === "approved") s.approved++;
    else if (m.status === "rejected") s.rejected++;
  }
  return s;
}

const MAINT_STATUS_LABEL: Record<MaintenanceItem["status"], string> = {
  scheduled: "예정",
  reported: "승인 대기",
  approved: "승인됨",
  rejected: "반려",
};

function fmtDue(t: TaskItem): string {
  if (!t.dueAt) return "기한 없음";
  const days = Math.ceil((t.dueAt - Date.now()) / 86400000);
  return days < 0 ? `기한초과 D+${-days}` : days === 0 ? "오늘 마감" : `D-${days}`;
}

// ── 취약점 사례 · 거버넌스 매칭 ─────────────────────────────────────────────
// 인프라 취약점 finding을 보안 거버넌스 통제에 규칙 기반으로 매핑한다(설명 가능).
// 컴플라이언스 카탈로그(KISA AI 위협)는 AI 모델 위협용이라 인프라 패치 취약점과 안 맞으므로
// 여기서 패치·형상관리·취약점 생애주기·접근통제 등 인프라 거버넌스로 별도 매칭한다.
export interface GovernanceMatch {
  framework: string;
  control: string;
  rationale: string;
}
export interface VulnCase {
  assetName: string;
  finding: Finding;
  priority: { code: string; sla: string; basis: string };
  governance: GovernanceMatch[];
}

// EPSS·KEV·심각도로 조치 우선순위와 SLA 기한을 산정(취약점 관리 지침 기준).
function classifyVulnPriority(f: Finding): { code: string; sla: string; basis: string } {
  const epss = typeof f.epss === "number" ? f.epss : 0;
  if (f.kev || epss >= 0.9 || f.severity === "critical")
    return {
      code: "P0",
      sla: "즉시 조치(7일 이내)",
      basis: f.kev ? "KEV(실제 악용 확인)" : epss >= 0.9 ? `EPSS ${(epss * 100).toFixed(0)}%(악용 가능성 매우 높음)` : "Critical 심각도",
    };
  if (f.severity === "high" || epss >= 0.5)
    return { code: "P1", sla: "30일 이내", basis: f.severity === "high" ? "High 심각도" : `EPSS ${(epss * 100).toFixed(0)}%` };
  if (f.severity === "medium") return { code: "P2", sla: "90일 이내", basis: "Medium 심각도" };
  return { code: "P3", sla: "정기 점검 시 조치", basis: "Low 심각도" };
}

function matchGovernance(f: Finding): GovernanceMatch[] {
  const t = `${f.finding_type} ${f.evidence}`.toLowerCase();
  const g: GovernanceMatch[] = [
    { framework: "ISMS-P", control: "2.11.2 취약점 점검 및 조치", rationale: "발견 취약점의 점검·조치·재점검 이력 관리 대상" },
    { framework: "ISO/IEC 27001:2022", control: "A.8.8 기술적 취약점 관리", rationale: "기술적 취약점의 적시 식별·평가·대응" },
    { framework: "취약점 관리 생애주기", control: "식별 → 평가(VPR·EPSS) → 조치 → 검증", rationale: "생애주기 4단계 상태 추적 대상" },
    // ⚠ 조번호는 **원문 대조**로 적는다(2026-09-07 수리 — 두 개가 다 틀렸다). 옛 값은
    //   「제37조의4 취약점 분석·평가 · 제21조 정보처리시스템 보호」였는데,
    //   제37조의4는 2025-02-05 신설된 **「침해사고 통지의 방법」**이고 제21조는
    //   **「정보처리시스템 구축 및 전자금융거래 관련 계약」**이다 — 둘 다 이 표가 말하려던
    //   내용이 아니다. 고객 리포트에 실려 나가는 값이라 틀린 조번호는 그대로 오답변이 된다.
    //   확인 출처: 위키문헌 「전자금융감독규정 (제2025-4호)」 조문 제목 — 제37조의2
    //   「전자금융기반시설의 취약점 분석ㆍ평가 주기, 내용 등」 · 제14조 「정보처리시스템 보호대책」.
    //   (짝 시험: report.test.ts 「전자금융감독규정 조번호가 원문과 맞다」)
    { framework: "전자금융감독규정", control: "제37조의2 전자금융기반시설의 취약점 분석·평가 · 제14조 정보처리시스템 보호대책", rationale: "(금융권 적용 시) 정기 취약점 분석·평가 및 시스템 보호대책 대상" },
    { framework: "클라우드보안인증(CSAP)", control: "보호대책 — 취약점 점검·조치", rationale: "(클라우드·공공 적용 시) 취약점 점검·조치 통제 대상" },
  ];
  if (/패치|미적용|cpu|버전|version|update|outdated|eol|hotfix/.test(t))
    g.push(
      { framework: "ISMS-P", control: "2.10.8 패치관리 · 2.9 형상관리", rationale: "보안 패치(예: Oracle Critical Patch Update) 적용·형상 기준 관리 미흡" },
      { framework: "주요정보통신기반시설", control: "취약점 분석·평가 — 패치 적용 점검항목", rationale: "정기 분석·평가 및 조치 이행 대상" }
    );
  if (/oracle|db|database|sql|계정|권한|account|privilege|1521/.test(t))
    g.push({ framework: "ISMS-P", control: "2.5 인증·권한 관리 · 2.6 접근통제", rationale: "DB 계정·권한·접근통제 점검과 연계" });
  return g;
}

// 인프라 호스트 자산의 미조치 finding을 우선순위·거버넌스 매칭이 붙은 사례 목록으로.
export function vulnCases(assets: Asset[]): VulnCase[] {
  const rank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const cases: VulnCase[] = [];
  for (const a of assets) {
    if (a.assetType !== "infra-host") continue;
    for (const f of a.findings) {
      if (f.state === "fixed") continue;
      if (!isRealVulnerability(f)) continue;   // 사례 목록에도 넣지 않는다
      cases.push({ assetName: a.name, finding: f, priority: classifyVulnPriority(f), governance: matchGovernance(f) });
    }
  }
  return cases.sort((x, y) => (rank[x.priority.code] ?? 9) - (rank[y.priority.code] ?? 9));
}

const RV_STATUS_LABEL: Record<string, string> = { pending: "미검토", approved: "승인(확정)", rejected: "반려(오탐)", in_progress: "진행중", verifying: "검증 대기", accepted: "위험수용" }; // 영문 낱값이 고객 문서에 새지 않게 전 상태 열거(검토관 중5)

// 우선순위 조치 목록 표 — finding-level 조치 관리(담당자·기한·지연)를 보고서에 그대로 노출(개선 #2).
function prioritiesTable(items: PrioritizedFinding[]): Table {
  const cell = (t: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
  const header = new TableRow({ children: ["순위", "심각도", "취약점", "자산", "담당자", "기한", "상태"].map((h) => cell(h, true)) });
  const rows = items.map((r, i) =>
    new TableRow({
      children: [
        cell(String(i + 1)),
        cell(r.finding.severity + (r.finding.kev ? " · KEV" : "")),
        cell(r.finding.finding_type.slice(0, 42)),
        cell(r.assetName),
        cell(r.assignee || "미배정"),
        cell(r.dueDate ? r.dueDate + (r.overdue ? " ⚠지연" : "") : "-"),
        cell(RV_STATUS_LABEL[r.status] ?? r.status),
      ],
    })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows] });
}

// 리포트 범위 자산들의 AI-BOM 기반 위협 노출(매칭이 있는 자산만). 특수 기능(거버넌스 연계)의 보고서 노출.
function collectAiThreatReports(assets: Asset[]): AiBomThreatReport[] {
  const out: AiBomThreatReport[] = [];
  for (const a of assets) {
    try {
      const r = aibomThreatMatches(a.id);
      if (r.matches.length) out.push(r);
    } catch {
      /* 자산 조회 실패 등 — 리포트 생성을 죽이지 않는다 */
    }
  }
  return out;
}

async function buildDocx(
  req: ReportRequest,
  assets: Asset[],
  executiveSummary: string,
  maintenance: MaintenanceItem[],
  vuln: VulnReportData,
  priorities: PrioritizedFinding[],
  triageDraft: string,
  aiThreats: AiBomThreatReport[]
): Promise<Buffer> {
  const counts = severityCounts(assets);
  const ms = maintenanceSummary(maintenance);
  const cases = vulnCases(assets);
  const audienceLabel = (req.audience ?? "official") === "internal" ? "내부 검토용" : "보고용";
  // 감사 추적: 최근 승인/반려 처리 건(검토자·사유). 리포트에는 최근 10건만.
  const reviewed = maintenance
    .filter((m) => m.status === "approved" || m.status === "rejected")
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))
    .slice(0, 10);
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: `GIJO AS 보안 현황 리포트 (${req.type} · ${audienceLabel})`, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: (req.audience ?? "official") === "internal" ? "요약 (내부 검토용)" : "경영진 요약", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun(executiveSummary)] }),
          new Paragraph({ text: "심각도별 분포", heading: HeadingLevel.HEADING_1 }),
          ...Object.entries(counts).map(
            ([severity, count]) => new Paragraph({ children: [new TextRun(`${severity}: ${count}건`)] })
          ),
          // AI 자동화 처리량 — 계획서 중-2. 절감 시간은 추정이므로 가정·한계를 같은 자리에 적는다.
          // 처리 기록이 없으면 이 절 자체를 넣지 않는다(빈 표로 자리만 채우지 않는다).
          ...timeSavedSection(),
          new Paragraph({ text: "취약점 조치 현황", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun(
                `스캔 호스트 ${vuln.hosts}대 · 열린 취약점 ${vuln.active}건` +
                  ` (Critical ${vuln.critical} / High ${vuln.high} / Medium ${vuln.medium} / Low ${vuln.low})` +
                  ` · 실제 악용 확인(KEV) ${vuln.kev}건`
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                `조치 항목 ${vuln.remediation.tasks}건 · 완료 ${vuln.remediation.done} · 진행 ${vuln.remediation.open}` +
                  ` · 기한 초과 ${vuln.remediation.overdue} · SLA 준수율 ${vuln.remediation.slaCompliance}%` +
                  // ★ 2026-09-11 검토관 [중] — B6-②가 대화 도구 둘(runKpiStatus·runExecBrief)에만
                  //   단서를 붙여, **같은 스냅샷을 대화는 「집계 전」, 보고서는 「100%」**로 말했다.
                  //   문구는 tone.ts 한 곳(준수율집계전단서) — 여기서 새로 짓지 않는다.
                  준수율집계전단서(vuln.remediation.tasks)
              ),
            ],
          }),
          // SLA 산정 근거 명시(개선 #5) — 무엇을 분모/분자로 계산했는지 드러낸다.
          new Paragraph({
            children: [
              new TextRun({
                // ⚠ 표본 0에서 「÷ 0건 × 100」이라는 **말이 안 되는 산식**이 나가던 자리다
                //   (2026-09-11 검토관 [중]). 조치대상이 0건이면 산식 대신 미집계라고 밝힌다.
                text:
                  vuln.remediation.tasks === 0
                    ? "※ 조치대상(취약점 연결 조치 티켓)이 0건이라 SLA 준수율은 아직 집계 전입니다 — 100%는 만점이 아니라 «잴 것이 없음»입니다."
                    : `※ SLA 준수율 = (기한 내 조치 완료 건) ÷ (전체 조치대상 ${vuln.remediation.tasks}건) × 100. ` +
                      `기한 초과 ${vuln.remediation.overdue}건은 미준수. 조치대상은 취약점 연결 조치 티켓(task.ref=vuln:) 기준.`,
                italics: true,
                size: 18,
              }),
            ],
          }),
          // 우선순위 조치 목록(개선 #2) — 전 자산 finding을 KEV·EPSS·VPR로 정렬 + 담당자·기한·상태.
          ...(priorities.length
            ? [
                new Paragraph({ text: "우선순위 조치 목록 (오늘의 조치 Top)", heading: HeadingLevel.HEADING_2 }),
                prioritiesTable(priorities),
              ]
            : []),
          // AI 조치 브리핑(개선 #4) — 상위 취약점의 근거·권장 조치·기한 초안(로컬 LLM, 온톨로지 근거).
          ...(triageDraft && !triageDraft.startsWith("⚠")
            ? [
                new Paragraph({ text: "AI 조치 브리핑 (참고)", heading: HeadingLevel.HEADING_2 }),
                ...triageDraft.split("\n").filter((l) => l.trim()).map((l) => new Paragraph({ children: [new TextRun(l)] })),
              ]
            : []),
          // 취약점 사례 · 거버넌스 매칭 — 각 취약점을 우선순위+거버넌스 통제에 매핑(신규).
          ...(cases.length
            ? [
                new Paragraph({ text: "취약점 사례 · 거버넌스 매칭", heading: HeadingLevel.HEADING_1 }),
                new Paragraph({ children: [new TextRun({ text: "각 취약점을 조치 우선순위(EPSS·KEV·심각도)와 보안 거버넌스 통제에 매핑했습니다.", italics: true, size: 18 })] }),
                new Paragraph({ children: [new TextRun({ text: "※ 거버넌스 매핑은 지침 기반 참고 매핑입니다. 조직의 통제 기준선(ISMS-P 인증 범위 등)에 맞춰 최종 확인하세요.", italics: true, size: 18 })] }),
                ...cases.flatMap((c) => {
                  const f = c.finding;
                  const meta =
                    `자산 ${c.assetName} · 심각도 ${f.severity}` +
                    (typeof f.epss === "number" ? ` · EPSS ${(f.epss * 100).toFixed(1)}%` : "") +
                    (f.vpr != null ? ` · VPR ${f.vpr}` : "") +
                    (f.kev ? " · KEV" : "") +
                    ` · 출처 ${f.source_tool}`;
                  return [
                    new Paragraph({ text: `[${c.priority.code}] ${f.finding_type}`, heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ children: [new TextRun(meta)] }),
                    new Paragraph({ children: [new TextRun(`근거: ${f.evidence.replace(/\n/g, " ")}`)] }),
                    new Paragraph({ children: [new TextRun({ text: `조치 우선순위 ${c.priority.code} — 기한 ${c.priority.sla} (기준: ${c.priority.basis})`, bold: true })] }),
                    new Paragraph({ children: [new TextRun({ text: "거버넌스 매칭:", bold: true })] }),
                    ...c.governance.map((g) => new Paragraph({ children: [new TextRun(`· ${g.framework} ${g.control} — ${g.rationale}`)] })),
                  ];
                }),
              ]
            : []),
          // AI 자산 위협 노출(AI-BOM 거버넌스) — 구성명세 기반 KISA 위협 매칭·대응 현황(특수 기능).
          ...(aiThreats.length
            ? [
                new Paragraph({ text: "AI 자산 위협 노출 (AI-BOM 거버넌스)", heading: HeadingLevel.HEADING_1 }),
                new Paragraph({
                  children: [new TextRun({ text: "각 AI 자산의 구성명세(AI-BOM)에서 채워진 영역을 기준으로 KISA AI 보안 위협을 자동 매칭하고 조직 대응 현황을 결합했습니다.", italics: true, size: 18 })],
                }),
                ...aiThreats.flatMap((r) => {
                  const s = r.summary;
                  const openTop = r.matches.filter((m) => m.status === "open").slice(0, 6);
                  return [
                    new Paragraph({ text: `${r.assetName} — 노출 ${s.relevant} · 대응완료 ${s.covered} · 부분 ${s.partial} · 미대응 ${s.open}`, heading: HeadingLevel.HEADING_2 }),
                    ...openTop.map(
                      (m) =>
                        new Paragraph({
                          children: [new TextRun(`[${m.code}] ${m.name} — 영역 ${m.matchedAreas.join("·")}${m.owasp[0] ? ` · ${m.owasp[0]}` : ""}`)],
                        })
                    ),
                    ...(s.open > openTop.length
                      ? [new Paragraph({ children: [new TextRun({ text: `… 외 미대응 ${s.open - openTop.length}건 (리포트·컴플라이언스 화면에서 전체 확인)`, size: 18, italics: true })] })]
                      : []),
                    ...(s.open === 0
                      ? [new Paragraph({ children: [new TextRun("미대응 위협 없음 — 노출 위협이 모두 대응(또는 해당없음) 처리됨")] })]
                      : []),
                  ];
                }),
              ]
            : []),
          ...(vuln.topKev.length
            ? [
                new Paragraph({ text: "실제 악용(KEV) — 최우선", heading: HeadingLevel.HEADING_2 }),
                ...vuln.topKev.map((k) => new Paragraph({ children: [new TextRun(`[KEV] ${k.name} — ${k.host}`)] })),
              ]
            : []),
          ...(vuln.remediation.topOpen.length
            ? [
                new Paragraph({ text: "진행 중 조치 항목(우선순위·기한)", heading: HeadingLevel.HEADING_2 }),
                ...vuln.remediation.topOpen.map(
                  (t) => new Paragraph({ children: [new TextRun(`[${t.priority}] ${t.text} — ${fmtDue(t)}${t.assignee ? ` · 담당 ${t.assignee}` : ""}`)] })
                ),
              ]
            : []),
          new Paragraph({ text: "유지보수 점검 거버넌스", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [
              new TextRun(
                `전체 ${ms.total}건 · 예정 ${ms.scheduled}건(지연 ${ms.overdue}) · 승인 대기 ${ms.reported}건 · 승인됨 ${ms.approved}건 · 반려 ${ms.rejected}건`
              ),
            ],
          }),
          new Paragraph({ text: "최근 승인·반려 이력(감사 추적)", heading: HeadingLevel.HEADING_2 }),
          ...(reviewed.length
            ? reviewed.map(
                (m) =>
                  new Paragraph({
                    children: [
                      new TextRun(
                        `[${MAINT_STATUS_LABEL[m.status]}] ${m.title} · ${m.productName}` +
                          (m.assetName ? ` (자산: ${m.assetName})` : "") +
                          ` — 검토자 ${m.reviewedBy ?? "-"}` +
                          (m.status === "rejected" && m.reviewNote ? ` · 사유: ${m.reviewNote}` : "")
                      ),
                    ],
                  })
              )
            : [new Paragraph({ children: [new TextRun("승인·반려 처리된 점검 없음")] })]),
          new Paragraph({ text: "자산별 상세", heading: HeadingLevel.HEADING_1 }),
          ...assets.flatMap((asset) => [
            new Paragraph({ text: asset.name, heading: HeadingLevel.HEADING_2 }),
            ...(asset.findings.length
              ? asset.findings.map(
                  (f) =>
                    new Paragraph({
                      // ⚠ 스캔 실패는 감추지 않되 **취약점처럼 보이게 두지 않는다** —
                      //   심각도 대괄호를 달면 읽는 사람이 취약점으로 센다.
                      children: [new TextRun(
                        isRealVulnerability(f)
                          ? `[${심각도한글(f.severity)}] ${f.finding_type} — ${f.evidence} (${f.source_tool})`
                          : `[점검 실패 · 취약점 아님] ${f.evidence} (${f.source_tool}) — 재스캔 필요`
                      )],
                    })
                )
              : [new Paragraph({ children: [new TextRun("발견된 finding 없음")] })]),
          ]),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// 합성모델(학습루프 대화로그가 섞인 merged 모델)이 요약을 "[주인이]/[나]" 대화록 형식으로
// 돌려주는 드리프트 실측(2026-07-17) — 화자 표시·영어 역할극 줄·프롬프트 잔재를 제거하고
// 보고서 본문만 남긴다. 정상 출력엔 아무 영향 없다(매칭 줄이 없으면 원문 그대로).
function stripDialogueArtifacts(text: string): string {
  const lines = String(text ?? "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^\[참고 자료/.test(t)) break; // 프롬프트 잔재부터는 전부 폐기
    const speaker = t.match(/^\[(주인이|나|user|assistant|system)\]\s*(.*)$/i);
    if (speaker) {
      const body = speaker[2];
      if (/^[A-Za-z]/.test(body)) continue; // 영어 역할극 줄은 폐기
      if (body) out.push(body); // 화자 표기만 떼고 한국어 본문은 보존
      continue;
    }
    out.push(line);
  }
  return stripMetaPreamble(out.join("\n").trim());
}

// 요약 서두의 메타-담화(자기지시) 문장·구절을 걷어낸다(2026-07-20 사용자 지적). 모델이 요약 대신
// "…요약을 제공하겠습니다", "제가 보고하는 목적은…" 같은 프롬프트 복창을 앞에 붙이는 것을 제거한다.
// 보수적으로: 실제 수치·CVE 등 데이터가 담긴 문장이 나오면 거기서부터 원문 그대로 보존한다.
export function stripMetaPreamble(text: string): string {
  // 순수 메타(자기지시) 문장 신호 — 서두에서 통째로 버린다.
  // 2026-08-07 147상황 6차 실측 추가: "최근 내부 보고서 작성에 필요한 정보를 요청합니다.
  // 당신은 보안 AI 입니다." — 시스템 프롬프트 복창 두 문장이 목록 밖이라 담당자에게 그대로 나갔다.
  // 「당신은 …입니다」는 보고서 본문에 나올 수 없는 꼴이다(자기소개는 프롬프트의 말).
  const META = /요약(을|음)?\s*(제공|작성|말씀|드리)|보고서\s*요약입니다|요약입니다|제가\s*(보고|답변|작성|말씀)|제\s*(답변|보고)(은|는)|유용하게|이해할\s*수\s*있는\s*정보를\s*제공|다음과\s*같(습니다|이\s*(요약|보고))|살펴볼\s*수\s*있는|하겠습니다|당신은\s*[^.!?\n]{0,24}입니다|정보를\s*요청합니다/;
  // 확실한 데이터 신호(숫자·CVE 등) — 있으면 실제 내용 문장이므로 보존을 시작한다.
  // "취약점·자산" 같은 키워드는 메타 문장("…취약점 상황 요약입니다")에도 흔해 여기에 넣지 않는다.
  const STRONG_DATA = /\d{2,}|CVE-|KEV|SLA|Critical|High/;
  // 데이터 문장 앞에 붙은 리드 구절(…요약하면, / …바탕으로, 등)만 잘라내는 패턴.
  const LEAD = /^.*?(요약하면|바탕으로\s*(요약|정리)하면|다음과\s*같이\s*요약합니다|정리하면)\s*[,:]?\s*/;

  const lines = text.split("\n");
  const out: string[] = [];
  let started = false; // 실제 데이터 문장이 시작됐는지
  for (const line of lines) {
    if (started || !line.trim()) { out.push(line); continue; }
    const sentences = line.split(/(?<=[.!?。])\s+/);
    const kept: string[] = [];
    for (let s of sentences) {
      if (!started) {
        if (STRONG_DATA.test(s)) {
          s = s.replace(LEAD, ""); // 데이터 문장 앞 리드 구절 제거
          started = true;
          kept.push(s);
        } else if (META.test(s) || 예고서두인가(s)) {
          // ⚠ **예고 판정은 llm.ts와 한 벌을 쓴다.** 여기 따로 목록을 두었더니 어긋났다 —
          //   채팅 쪽은 잡는 `우선, 1페이지 요약에 대해 알려드리겠습니다.`를 여기서는 놓쳐
          //   담당자에게 그대로 나갔다(2026-08-03 실전 147상황).
          continue; // 순수 메타 서두 문장 폐기(숫자 없는 "…요약입니다/살펴볼 수 있는" 포함)
        } else {
          kept.push(s); // 메타도 데이터도 아닌 일반 문장(짧은 제목 등)은 보존
        }
      } else {
        kept.push(s);
      }
    }
    if (kept.join(" ").trim()) out.push(kept.join(" "));
  }
  return out.join("\n").trim();
}

// AI 자동화 처리량 절(계획서 중-2). 임원 보고에 자동으로 실린다.
// 정직 규칙(전-6): ① "추정"이라고 먼저 말한다 ② 무엇에 몇 분을 곱했는지 전부 적는다
// ③ 보수 조정한 하한~산정값을 범위로 낸다 ④ 처리 기록이 없으면 절을 아예 넣지 않는다.
function timeSavedSection(): Paragraph[] {
  const t = timeSavedReport(30);
  if (t.rows.length === 0) return [];
  const cases = t.rows.reduce((s, r) => s + r.count, 0);
  return [
    new Paragraph({ text: "AI 자동화 처리량 (최근 30일)", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun(
          `AI가 대신 처리한 일 ${cases}건 — 담당자가 손으로 했다면 약 ` +
            `${fmtDuration(t.totalMinutes * (1 - t.riskAdjustment))}~${fmtDuration(t.totalMinutes)}`
        ),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: "산출 근거(처리 건수 × 조직이 정한 기준시간):", bold: true, size: 20 })] }),
    ...t.assumptions.map((a) => new Paragraph({ children: [new TextRun({ text: `· ${a}`, size: 18 })] })),
    new Paragraph({ children: [new TextRun({ text: t.note, italics: true, size: 18 })] }),
  ];
}

export async function generateReport(req: ReportRequest): Promise<ReportResult> {
  const assets = collectAssets(req);
  const counts = severityCounts(assets);
  const maintenance = listMaintenanceItems();
  const ms = maintenanceSummary(maintenance);
  const vuln = collectVulnReportData(req.assetIds?.length ? assets : undefined);
  const audience = req.audience ?? "official";
  const cases = vulnCases(assets);
  const audienceGuide =
    audience === "internal"
      ? "이 요약은 보안담당자 본인 검토용입니다. 격식·미사여구 없이, 지금 급한 것과 바로 할 일(다음 액션) 중심으로 간결하게 쓰세요."
      : "이 요약은 경영진·감사 보고용입니다. 정중하되 쉬운 말로 쓰고(전문용어는 괄호로 풀어서), 지금 무엇이 위험하고 무엇을 결정·조치해야 하는지를 분명히 강조하세요.";
  const caseHint = cases.length
    ? ` 취약점 사례(우선순위): ${cases.slice(0, 3).map((c) => `[${c.priority.code}] ${c.finding.finding_type}`).join(", ")}. 각 사례는 ISMS-P·ISO27001 등 거버넌스 통제에 매핑됨.`
    : "";
  let executiveSummary = stripDialogueArtifacts(await chat({
    agentId: "report",
    message:
      `다음 보안 현황 데이터를 바탕으로 1페이지 요약을 작성해줘. 출력은 보고서 본문 문단만 — 대화록·화자 표시([나]·[주인이] 등)·질문/답변 형식·영어 문장을 절대 쓰지 마세요. ${PLAIN_LANGUAGE_RULE} ${audienceGuide} 자산 ${assets.length}건, ` +
      // ⚠ 영문 키를 그대로 넣으면 모델이 그대로 복창한다 — 실측(2026-08-03 실전 147상황):
      //   보고서 요약에 `"low" 2개, "medium" 3개, "high" 5개, "critical" 4개`가 그대로 나갔다.
      //   한글 제품에서 영문 상태값은 담당자가 못 읽는다(말투 규범 금지 항목). **넣을 때부터 우리말로.**
      `심각도별 발견 건수: ${심각도별건수요약(counts)}. ` +
      `취약점 조치: 스캔 호스트 ${vuln.hosts}대, 열린 취약점 ${vuln.active}건(Critical ${vuln.critical}·High ${vuln.high}), ` +
      // ⚠ 임원 요약을 쓰는 **모델에게 주는 재료**다 — 여기에 단서가 없으면 모델이 「SLA 준수율
      //   100%로 양호」라고 쓴다(2026-09-11 검토관 [중]). 문구는 tone.ts 한 곳에서 온다.
      `실제 악용 확인(KEV) ${vuln.kev}건은 최우선 조치 대상. 조치 SLA 준수율 ${vuln.remediation.slaCompliance}%${준수율집계전단서(vuln.remediation.tasks)}, 기한 초과 ${vuln.remediation.overdue}건. ` +
      `유지보수 점검: 전체 ${ms.total}건 중 지연 ${ms.overdue}건, 승인 대기 ${ms.reported}건, 반려 ${ms.rejected}건.${caseHint} ` +
      `KEV와 기한 초과, 그리고 EPSS가 높은 취약점을 우선순위로 강조해줘. ` +
      `중요: 위에 제시된 수치만 사용하고, 제시되지 않은 숫자(호스트 대수 등)를 새로 지어내지 마세요. 스캔 호스트는 정확히 ${vuln.hosts}대입니다.`,
    // trusted — 이 message는 사용자 입력이 아니라 우리가 조립한 내부 프롬프트다(gateway.ts 규칙).
    trusted: true,
  }));

  // 우선순위 조치 목록(개선 #2)과 AI 브리핑(개선 #4)을 보고서에 포함.
  // 자산 스코프 리포트면 그 자산들의 취약점만(전체 리포트면 assetIds가 없어 전 자산 — 종전과 동일).
  const priorities = prioritizedReviews(8, req.assetIds);
  // AI 조치 브리핑(LLM 서술)은 내부 검토용에만 — 보고용은 '취약점 사례·거버넌스 매칭'으로 갈음(중복 제거).
  let triageDraft = "";
  if (audience === "internal") {
    try {
      triageDraft = stripDialogueArtifacts((await buildTriageDraft(5, req.assetIds)).draft);
    } catch {
      /* LLM 미가동 등 — 브리핑 없이 진행 */
    }
  }

  // ⚠ 자격증명 마스킹 — 리포트는 **이 시스템 밖으로 나가는 산출물**이다(경영진·감사·협력사).
  //   요약은 LLM이 사내 문서를 근거로 쓰는데, 그 문서에는 벤더 매뉴얼의 초기 비밀번호나
  //   설정 파일의 API 키가 실제로 들어 있다(2026-07-30 실측: 질문 한 번에 그대로 답변에 나왔다).
  //   화면에서 담당자가 보는 것은 막지 않지만, 파일로 나가는 것은 가린다 — 되돌릴 수 없으니까.
  const masked = maskSecrets(executiveSummary);
  if (masked.hits.length > 0) {
    executiveSummary = masked.text;
    recordAudit({
      kind: "block", actor: req.createdBy ?? "system",
      action: `리포트에서 자격증명 ${masked.hits.length}건 가림(외부 반출 방지)`,
      target: `${req.type}/${audience}`,
      detail: masked.hits.map((h) => `${h.kind}: ${h.masked}`).join(", "), // 원본 값은 담기지 않는다
      result: "blocked",
    });
  }

  const aiThreats = collectAiThreatReports(assets);
  const buffer = await buildDocx(req, assets, executiveSummary, maintenance, vuln, priorities, triageDraft, aiThreats);
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = `${req.type}-${Date.now()}`;
  const filePath = path.join(REPORT_DIR, `${base}.docx`);
  await fs.writeFile(filePath, buffer);

  const result: ReportResult = { filePath, executiveSummary, audience };

  // PDF 생성(개선 #3) — 요청 시. HTML로 만들어 headless 브라우저로 A4 렌더. 실패해도 DOCX는 그대로.
  if (req.format === "pdf" || req.format === "both") {
    const pdfPath = path.join(REPORT_DIR, `${base}.pdf`);
    const html = buildReportHtml(req, assets, executiveSummary, maintenance, vuln, priorities, triageDraft, aiThreats);
    const ok = await renderPdf(html, pdfPath);
    if (ok) result.pdfPath = pdfPath;
    else result.pdfError = "PDF 렌더 실패(headless 브라우저 미가용). DOCX만 제공됩니다.";
  }

  // 이력 메타데이터를 사이드카(.json)로 남긴다 — 파일명만으론 대상 자산·독자를 복원할 수 없으므로.
  // (리포트 이력 화면이 재기동·다른 세션에서도 과거 리포트를 그대로 보여줄 수 있게 한다.)
  try {
    const meta = {
      base,
      type: req.type,
      audience,
      assetIds: req.assetIds ?? [],
      assetNames: assets.map((a) => a.name),
      createdAt: Date.now(),
      docx: path.basename(filePath),
      pdf: result.pdfPath ? path.basename(result.pdfPath) : undefined,
      summary: executiveSummary.slice(0, 400),
      createdBy: req.createdBy, // 작업 귀속
      // ⚠ QA·시험이 만든 리포트 표식. 시간 KPI가 시험 흔적을 빼는 것과 같은 규칙 —
      //   안 빼면 절차 띠 ⑤ 보고가 "이번 주 119건"이 되고 담당자는 그 칸을 안 믿는다.
      qa: req.qa === true ? true : undefined,
    };
    await fs.writeFile(path.join(REPORT_DIR, `${base}.json`), JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    /* 메타 저장 실패해도 리포트 자체는 유효 — 이력에선 파일명 기반으로 폴백 표시 */
  }
  // 자동화 작업 원장(계획서 중-2) — 보고서 작성은 담당자가 손으로 하면 가장 오래 걸리는 일이다.
  recordWork({ kind: "report_generated", detail: `${req.type}/${audience}`, actor: req.createdBy ?? null, source: req.createdBy ? "chat" : "schedule", qa: req.qa });
  return result;
}

// ── 업무 진행 리포트 (3연결 시나리오, 2026-08-09) ─────────────────────────
// 대시보드(계획)→팀 사무실(진행)→작업 내역(선택 리포트)의 세 번째 고리. 취약점 현황
// 리포트와 달리 **내가 오늘 계획하고 한 일**이 내용이다. 전부 결정적(LLM 없음) — 보고
// 숫자는 흔들리면 안 되고, 선택한 내역이 그대로 실려야 한다.
export interface WorkProgressRequest {
  sessionIds?: string[]; // 작업 내역 화면에서 고른 항목들 — 비우면 기간 내 전부
  days?: number; // 기간(일) — 기본 1(오늘)
  format?: "docx" | "pdf" | "both";
  createdBy?: string;
  qa?: boolean;
}

export async function generateWorkProgressReport(req: WorkProgressRequest): Promise<ReportResult> {
  const { listSessions, getSession } = await import("./worksessions.js");
  const days = Math.min(31, Math.max(1, Number(req.days) || 1));
  const since = Date.now() - days * 86400000;

  const 계획 = listTasks(); // listTasks 기본이 화면용 목록(에이전트 실행 기록 제외)이다

  const 완료 = 계획.filter((t) => t.done);
  const 미완료 = 계획.filter((t) => !t.done);

  const sessions = req.sessionIds?.length
    ? req.sessionIds.map((id) => getSession(id)).filter((s): s is NonNullable<ReturnType<typeof getSession>> => !!s)
    : listSessions(200).filter((s) => s.updatedAt >= since);

  const 기간말 = days === 1 ? "오늘" : `최근 ${days}일`;
  const executiveSummary =
    `${기간말} 계획 ${계획.length}건 중 ${완료.length}건 완료` +
    (계획.length ? `(${Math.round((완료.length / 계획.length) * 100)}%)` : "") +
    ` · 작업 내역 ${sessions.length}건${req.sessionIds?.length ? " (담당자 선택)" : ""}` +
    (미완료.length ? ` · 남은 일 ${미완료.length}건` : " · 남은 일 없음");

  const when = (ts: number) => new Date(ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const row = (cells: string[], bold = false) =>
    new TableRow({ children: cells.map((t) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] })) });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `GIJO AS 업무 진행 리포트 (${기간말})`, heading: HeadingLevel.TITLE }),
        new Paragraph({ text: "요약", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun(executiveSummary)] }),
        new Paragraph({ text: "오늘 계획", heading: HeadingLevel.HEADING_1 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row(["항목", "상태", "우선순위"], true),
            ...계획.map((t) => row([t.text, t.done ? "완료" : "진행 중", t.priority ?? "-"])),
            ...(계획.length ? [] : [row(["(계획한 일이 없습니다)", "-", "-"])]),
          ],
        }),
        new Paragraph({ text: req.sessionIds?.length ? "수행 내역 (담당자 선택)" : "수행 내역", heading: HeadingLevel.HEADING_1 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            row(["시각", "내용", "상태"], true),
            ...sessions.map((s) => row([when(s.updatedAt), s.title, s.status === "done" ? "완료" : s.status === "active" ? "진행 중" : "보류"])),
            ...(sessions.length ? [] : [row(["-", "(기간 내 작업 내역이 없습니다)", "-"])]),
          ],
        }),
        new Paragraph({ text: "다음 걸음", heading: HeadingLevel.HEADING_1 }),
        ...(미완료.length
          ? 미완료.map((t) => new Paragraph({ children: [new TextRun(`· ${t.text}${t.priority ? ` (${t.priority})` : ""}`)] }))
          : [new Paragraph({ children: [new TextRun("남은 계획이 없습니다 — 수고하셨습니다.")] })]),
      ],
    }],
  });

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = `work-progress-${Date.now()}`;
  const filePath = path.join(REPORT_DIR, `${base}.docx`);
  await fs.writeFile(filePath, await Packer.toBuffer(doc));
  const result: ReportResult = { filePath, executiveSummary, audience: "internal" };

  if (req.format === "pdf" || req.format === "both") {
    const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }) as Record<string, string>)[c]);
    const html =
      `<h1>GIJO AS 업무 진행 리포트 (${esc(기간말)})</h1><p>${esc(executiveSummary)}</p>` +
      `<h2>오늘 계획</h2><table border="1" cellspacing="0" cellpadding="4"><tr><th>항목</th><th>상태</th></tr>` +
      계획.map((t) => `<tr><td>${esc(t.text)}</td><td>${t.done ? "완료" : "진행 중"}</td></tr>`).join("") + `</table>` +
      `<h2>수행 내역</h2><table border="1" cellspacing="0" cellpadding="4"><tr><th>시각</th><th>내용</th></tr>` +
      sessions.map((s) => `<tr><td>${esc(when(s.updatedAt))}</td><td>${esc(s.title)}</td></tr>`).join("") + `</table>`;
    const pdfPath = path.join(REPORT_DIR, `${base}.pdf`);
    if (await renderPdf(html, pdfPath)) result.pdfPath = pdfPath;
    else result.pdfError = "PDF 렌더 실패(headless 브라우저 미가용). DOCX만 제공됩니다.";
  }

  try {
    const meta = {
      base, type: "work-progress", audience: "internal",
      assetIds: [], assetNames: [],
      createdAt: Date.now(),
      docx: path.basename(filePath),
      pdf: result.pdfPath ? path.basename(result.pdfPath) : undefined,
      summary: executiveSummary.slice(0, 400),
      createdBy: req.createdBy,
      qa: req.qa === true ? true : undefined,
    };
    await fs.writeFile(path.join(REPORT_DIR, `${base}.json`), JSON.stringify(meta, null, 2), "utf-8");
  } catch { /* 메타 실패해도 리포트는 유효 */ }
  recordWork({ kind: "report_generated", detail: "work-progress/internal", actor: req.createdBy ?? null, source: "chat", qa: req.qa });
  return result;
}

// 저장된 리포트 이력 — data/reports/의 파일을 base(파일명 접두)로 묶어 최신순으로 나열한다.
// 사이드카(.json)가 있으면 대상 자산·독자·요약까지, 없으면(구버전) 파일명·mtime으로 폴백.
export interface ReportHistoryEntry {
  base: string; // 파일명 접두(확장자 제외) — 삭제·식별 키
  type: string;
  createdAt: number;
  audience?: string;
  assetIds: string[];
  assetNames: string[];
  summary?: string;
  docx?: string;
  pdf?: string;
  md?: string; // 진행내역 리포트(파일 인입 기록)는 마크다운으로 저장된다 — ingestreport.ts
  createdBy?: string; // 작업 귀속 — 누가 생성했는지
}

/**
 * 보고 현황을 **동기로** 센다 — 절차 띠(workflow.ts)가 동기 경로라 async를 못 쓴다.
 *
 * 돌려주는 것: 이번 주(월요일부터) 만든 보고서 수 · 마지막 보고 후 지난 날수.
 * ⚠ 폴더를 못 읽으면 **null**이다. 0으로 채우면 "이번 주 하나도 안 썼다"가 되어 거짓이 된다 —
 *   못 구한 것과 없는 것은 다르다.
 * ⚠ 같은 보고서가 docx·pdf·json으로 여러 벌 저장되므로 **파일명 접두(base)로 묶어** 센다.
 *   안 묶으면 한 번 쓴 보고서가 세 건으로 잡힌다.
 */
/** 이 리포트가 QA·시험이 만든 것인가. 메타를 못 읽으면 **아니라고 본다**(지어내지 않는다). */
function qa표식(nodeFs: typeof import("node:fs"), base: string): boolean {
  try {
    const f = require("node:path").join(REPORT_DIR, `${base}.json`);
    if (!nodeFs.existsSync(f)) return false;
    return JSON.parse(nodeFs.readFileSync(f, "utf-8")).qa === true;
  } catch { return false; }
}

export function reportActivity(): { thisWeek: number; daysSinceLast: number | null } | null {
  try {
    const nodeFs = require("node:fs") as typeof import("node:fs");
    if (!nodeFs.existsSync(REPORT_DIR)) return { thisWeek: 0, daysSinceLast: null };
    const 주시작 = new Date();
    주시작.setHours(0, 0, 0, 0);
    주시작.setDate(주시작.getDate() - ((주시작.getDay() + 6) % 7)); // 월요일
    const 묶음 = new Map<string, number>();   // base → 가장 이른 생성시각
    for (const f of nodeFs.readdirSync(REPORT_DIR)) {
      const m = /^(.+)\.(docx|pdf|md)$/i.exec(f);
      if (!m) continue;
      // ⚠ 이 폴더에는 **보고서가 아닌 것도** 쌓인다. 안 거르면 「이번 주 보고 369건」이 뜨고
      //   (실측 2026-08-02), 담당자는 그 칸을 영영 안 믿는다.
      //   · answer-  = 긴 답변이 리포트로 자동 전환된 것(longanswer.ts) — 사람이 쓴 보고가 아니다
      //   · ingest-  = 파일 반입 진행내역(ingestreport.ts) — 반입 기록이지 보고가 아니다
      //   · session- = 작업 내역을 완료로 바꾸는 순간 서버가 만드는 대화 전문(worksessions.ts:750)
      //     — 보고서 작성 행위가 아니다. 안 거르면 세션 5개를 닫은 날 「이번 주 보고 5건」이
      //     된다(2026-08-21 검토관 ②중 — 판 쪽 자동종류와 같은 잣대로 맞춤).
      //   진짜 보고서는 `${req.type}-<시각>` 꼴이다(주간/월간/온디맨드 등).
      if (/^(answer|ingest|session)-/.test(m[1])) continue;
      // QA·시험이 만든 것은 세지 않는다(메타의 qa 표식). 메타가 없으면 사람이 만든 것으로 본다 —
      // **모르는 것을 시험으로 몰아 숫자를 낮추면** 반대 방향의 거짓이 된다.
      if (qa표식(nodeFs, m[1])) continue;
      const t = nodeFs.statSync(require("node:path").join(REPORT_DIR, f)).mtimeMs;
      const 이전 = 묶음.get(m[1]);
      if (이전 == null || t < 이전) 묶음.set(m[1], t);
    }
    if (묶음.size === 0) return { thisWeek: 0, daysSinceLast: null };
    const 시각들 = [...묶음.values()];
    const thisWeek = 시각들.filter((t) => t >= 주시작.getTime()).length;
    const 최근 = Math.max(...시각들);
    const daysSinceLast = Math.floor((Date.now() - 최근) / 86400000);
    return { thisWeek, daysSinceLast };
  } catch {
    return null;   // 못 읽으면 비운다 — 지어내지 않는다
  }
}

export async function listReportHistory(limit = 100): Promise<ReportHistoryEntry[]> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const files = await fs.readdir(REPORT_DIR);
  const byBase = new Map<string, { docx?: string; pdf?: string; md?: string; meta?: string }>();
  for (const f of files) {
    // md = 파일 인입 진행내역 리포트(ingestreport.ts). 같은 이력 목록에 함께 나열한다.
    const m = /^(.+)\.(docx|pdf|md|json)$/i.exec(f);
    if (!m) continue;
    const base = m[1];
    const e = byBase.get(base) ?? {};
    if (/docx/i.test(m[2])) e.docx = f;
    else if (/pdf/i.test(m[2])) e.pdf = f;
    else if (/md/i.test(m[2])) e.md = f;
    else e.meta = f;
    byBase.set(base, e);
  }
  // 1) 파일명(`type-timestamp`)으로 값싸게 정렬용 시각을 뽑아 최신순 정렬 후 상한만 남긴다.
  //    (리포트가 수백~수천 개 쌓여도 사이드카 JSON을 그 상한만큼만 읽어 비용을 억제한다.)
  const bases = [...byBase.entries()]
    .filter(([, e]) => e.docx || e.pdf || e.md) // 메타만 있고 문서 없는 건 제외
    .map(([base, e]) => {
      // session-*: 작업 내역 종료 리포트(worksessions.ts) — 같은 이력에 함께 나열된다.
      // answer-*: 긴 답변 자동 전환(longanswer.ts) — 여기 빠지면 ts=0으로 잡혀 **정렬 상한에서
      //   먼저 잘리고**, 사이드카가 깨진 파일은 type이 ondemand로 위장된다(2026-08-21 설계관 덤).
      // daily·monthly(reportschedule.ts ScheduleType)·work-progress(:1140 라우트)도 실제 생산자가
      //   있다 — answer만 채우고 이 셋을 빠뜨렸었다(2026-08-21 검토관 ②상1, 같은 결함 세 사본).
      const fm = /^(?:weekly|quarterly|ondemand|daily|monthly|work-progress|session|ingest|answer)-(\d+)$/.exec(base);
      return { base, e, ts: fm ? Number(fm[1]) : 0 };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.max(1, limit));
  // 2) 상한 안의 항목만 사이드카(대상 자산·독자·요약)로 보강한다.
  const out: ReportHistoryEntry[] = [];
  for (const { base, e, ts } of bases) {
    const fm = /^(weekly|quarterly|ondemand|daily|monthly|work-progress|session|ingest|answer)-\d+$/.exec(base);
    const entry: ReportHistoryEntry = {
      base,
      type: fm ? fm[1] : "ondemand",
      createdAt: ts,
      assetIds: [],
      assetNames: [],
      docx: e.docx,
      pdf: e.pdf,
      md: e.md,
    };
    if (e.meta) {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(REPORT_DIR, e.meta), "utf-8"));
        entry.type = meta.type ?? entry.type;
        entry.createdAt = meta.createdAt ?? entry.createdAt;
        entry.audience = meta.audience;
        entry.assetIds = meta.assetIds ?? [];
        entry.assetNames = meta.assetNames ?? [];
        entry.summary = meta.summary;
        entry.createdBy = meta.createdBy; // 작업 귀속 — 화면에 "생성자" 표시
      } catch {
        /* 메타 깨졌으면 파일명 기반 폴백 유지 */
      }
    }
    if (!entry.createdAt) {
      try {
        entry.createdAt = Math.floor((await fs.stat(path.join(REPORT_DIR, (e.docx || e.pdf || e.md) as string))).mtimeMs);
      } catch {
        /* stat 실패 시 0 유지 */
      }
    }
    out.push(entry);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

// 리포트 삭제 — base(파일명 접두)에 해당하는 docx·pdf·메타(.json)를 함께 지운다.
// 경로 순회 방지: base는 파일명 한 조각이어야 하고(슬래시·..·확장자 불가) 안전 문자만 허용.
export async function deleteReport(base: string): Promise<{ deleted: string[] }> {
  const safe = path.basename(String(base || ""));
  if (safe !== base || !/^[A-Za-z0-9._-]+$/.test(safe) || safe.includes("..")) {
    throw new Error("잘못된 리포트 식별자입니다");
  }
  const deleted: string[] = [];
  // ⚠ md를 빼먹으면 **지워지지 않는 리포트**가 생긴다(2026-08-06 사용자 신고 "리포트 삭제했는데
  //   데이터가 보임"). 이력 목록(listReportHistory)은 md도 리포트로 나열하는데 — 긴 작업 답변
  //   (longanswer)·파일 인입 진행내역(ingestreport)이 md로 저장된다, 운영 실측 278개 — 삭제
  //   3종(개별·일괄·전체)은 docx/pdf/json만 지워서, 담당자가 지워도 md 리포트는 그대로 보였다.
  //   목록에 보이는 것과 지우는 것의 확장자 집합은 **같아야 한다.**
  for (const ext of ["docx", "pdf", "md", "json"]) {
    const p = path.join(REPORT_DIR, `${safe}.${ext}`);
    try {
      await fs.unlink(p);
      deleted.push(`${safe}.${ext}`);
    } catch {
      /* 없는 파일은 무시(pdf 미생성·메타 없음 등) */
    }
  }
  return { deleted };
}

// N일 이전에 생성된 리포트를 일괄 삭제한다(누적된 과거 리포트 정리용).
// 생성 시각은 파일명 타임스탬프 우선, 없으면 mtime. 시각을 못 구하면(0) 안전하게 건드리지 않는다.
export async function pruneReports(olderThanDays: number): Promise<{ deletedReports: number; deletedFiles: number }> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
    throw new Error("olderThanDays는 1 이상이어야 합니다");
  }
  const cutoff = Date.now() - olderThanDays * 86400000;
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const files = await fs.readdir(REPORT_DIR);
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    // md 포함 — 이력 목록과 같은 확장자 집합(2026-08-06, deleteReport의 주석 참고).
    const m = /^(.+)\.(docx|pdf|md|json)$/i.exec(f);
    if (!m) continue;
    const arr = byBase.get(m[1]) ?? [];
    arr.push(f);
    byBase.set(m[1], arr);
  }
  let deletedReports = 0;
  let deletedFiles = 0;
  for (const [base, group] of byBase) {
    const fm = /-(\d+)$/.exec(base);
    let createdAt = fm ? Number(fm[1]) : 0;
    if (!createdAt) {
      try {
        createdAt = Math.floor((await fs.stat(path.join(REPORT_DIR, group[0]))).mtimeMs);
      } catch {
        createdAt = 0;
      }
    }
    if (!createdAt || createdAt >= cutoff) continue; // 시각 불명 또는 기준 이내면 보존
    for (const f of group) {
      try {
        await fs.unlink(path.join(REPORT_DIR, f));
        deletedFiles++;
      } catch {
        /* 이미 없으면 무시 */
      }
    }
    deletedReports++;
  }
  return { deletedReports, deletedFiles };
}

// 전체 리포트 삭제 — data/reports의 docx·pdf·메타(.json)를 모두 지운다.
export async function deleteAllReports(): Promise<{ deletedReports: number; deletedFiles: number }> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const files = await fs.readdir(REPORT_DIR);
  const bases = new Set<string>();
  let deletedFiles = 0;
  for (const f of files) {
    // md 포함 — 이력 목록과 같은 확장자 집합. md만 있는 리포트(긴 작업 답변)도 리포트로 센다.
    const m = /^(.+)\.(docx|pdf|md|json)$/i.exec(f);
    if (!m) continue;
    if (/docx|pdf|md/i.test(m[2])) bases.add(m[1]);
    try {
      await fs.unlink(path.join(REPORT_DIR, f));
      deletedFiles++;
    } catch {
      /* 이미 없으면 무시 */
    }
  }
  return { deletedReports: bases.size, deletedFiles };
}

// 보고서 HTML(개선 #3 PDF용) — DOCX와 같은 데이터를 A4 인쇄용 HTML로. 한국어는 시스템 폰트로 렌더.
function buildReportHtml(
  req: ReportRequest,
  assets: Asset[],
  executiveSummary: string,
  maintenance: MaintenanceItem[],
  vuln: VulnReportData,
  priorities: PrioritizedFinding[],
  triageDraft: string,
  aiThreats: AiBomThreatReport[]
): string {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const counts = severityCounts(assets);
  const ms = maintenanceSummary(maintenance);
  const cases = vulnCases(assets);
  const audienceLabel = (req.audience ?? "official") === "internal" ? "내부 검토용" : "보고용";
  const casesHtml = cases.length
    ? `<h2>취약점 사례 · 거버넌스 매칭</h2><p class="muted">각 취약점을 조치 우선순위(EPSS·KEV·심각도)와 보안 거버넌스 통제에 매핑했습니다. ※ 거버넌스 매핑은 지침 기반 참고 매핑이며, 조직의 통제 기준선에 맞춰 최종 확인하세요.</p>` +
      cases
        .map((c) => {
          const f = c.finding;
          const meta =
            `자산 ${esc(c.assetName)} · 심각도 ${esc(f.severity)}` +
            (typeof f.epss === "number" ? ` · EPSS ${(f.epss * 100).toFixed(1)}%` : "") +
            (f.vpr != null ? ` · VPR ${f.vpr}` : "") +
            (f.kev ? " · KEV" : "") +
            ` · 출처 ${esc(f.source_tool)}`;
          const gov = c.governance
            .map((g) => `<tr><td>${esc(g.framework)}</td><td>${esc(g.control)}</td><td>${esc(g.rationale)}</td></tr>`)
            .join("");
          return (
            `<h3 style="margin:14px 0 4px;font-size:12.5px">[${c.priority.code}] ${esc(f.finding_type)}</h3>` +
            `<p style="margin:2px 0">${meta}</p>` +
            `<p style="margin:2px 0">근거: ${esc(f.evidence).replace(/\n/g, " ")}</p>` +
            `<p style="margin:2px 0"><b>조치 우선순위 ${c.priority.code} — 기한 ${esc(c.priority.sla)}</b> (기준: ${esc(c.priority.basis)})</p>` +
            `<table><tr><th>프레임워크</th><th>통제</th><th>매칭 근거</th></tr>${gov}</table>`
          );
        })
        .join("")
    : "";
  const rows = priorities
    .map((r, i) =>
      `<tr><td>${i + 1}</td><td>${esc(r.finding.severity)}${r.finding.kev ? " · KEV" : ""}</td>` +
      `<td>${esc(r.finding.finding_type.slice(0, 42))}</td><td>${esc(r.assetName)}</td>` +
      `<td>${esc(r.assignee || "미배정")}</td><td>${r.dueDate ? esc(r.dueDate) + (r.overdue ? " ⚠지연" : "") : "-"}</td>` +
      `<td>${esc(RV_STATUS_LABEL[r.status] ?? r.status)}</td></tr>`
    )
    .join("");
  const triageHtml = triageDraft && !triageDraft.startsWith("⚠") ? `<h2>AI 조치 브리핑 (참고)</h2><pre>${esc(triageDraft)}</pre>` : "";
  const aiThreatsHtml = aiThreats.length
    ? `<h2>AI 자산 위협 노출 (AI-BOM 거버넌스)</h2><p class="muted">각 AI 자산의 구성명세(AI-BOM)에서 채워진 영역을 기준으로 KISA AI 보안 위협을 자동 매칭하고 조직 대응 현황을 결합했습니다.</p>` +
      aiThreats
        .map((r) => {
          const s = r.summary;
          const openTop = r.matches.filter((m) => m.status === "open").slice(0, 6);
          const rows = openTop
            .map((m) => `<tr><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.matchedAreas.join("·"))}</td><td>${esc(m.owasp[0] ?? "-")}</td></tr>`)
            .join("");
          const more = s.open > openTop.length ? `<p class="muted">… 외 미대응 ${s.open - openTop.length}건</p>` : "";
          const none = s.open === 0 ? `<p>미대응 위협 없음 — 노출 위협이 모두 대응(또는 해당없음) 처리됨</p>` : "";
          return (
            `<h3 style="margin:12px 0 4px;font-size:12.5px">${esc(r.assetName)} — 노출 ${s.relevant} · 대응완료 ${s.covered} · 부분 ${s.partial} · 미대응 ${s.open}</h3>` +
            (openTop.length ? `<table><tr><th>코드</th><th>위협</th><th>매칭 영역</th><th>OWASP</th></tr>${rows}</table>` : "") +
            more +
            none
          );
        })
        .join("")
    : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    /* Windows(dev, msedge)는 Malgun Gothic, 리눅스(운영 WSL, chromium)는 Noto Sans CJK/나눔 —
       리눅스에 없는 폰트를 앞에 두면 한글이 tofu(□)로 깨지므로 양쪽 한글 폰트를 모두 지정한다. */
    body{font-family:"Malgun Gothic","맑은 고딕","Noto Sans CJK KR","Noto Sans KR","NanumGothic","나눔고딕",sans-serif;color:#111;font-size:12px;line-height:1.6;padding:8px}
    h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:6px} h2{font-size:14px;margin-top:18px;color:#1a3a6b}
    table{border-collapse:collapse;width:100%;margin-top:8px;font-size:11px} th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}
    th{background:#f0f3f8} pre{white-space:pre-wrap;background:#f7f8fa;border:1px solid #ddd;padding:10px;border-radius:6px;font-family:inherit}
    .muted{color:#666;font-size:10.5px;font-style:italic}
  </style></head><body>
    <h1>GIJO AS 보안 현황 리포트 (${esc(req.type)} · ${audienceLabel})</h1>
    <h2>${(req.audience ?? "official") === "internal" ? "요약 (내부 검토용)" : "경영진 요약"}</h2><p>${esc(executiveSummary).replace(/\n/g, "<br>")}</p>
    <h2>심각도별 분포</h2><p>${Object.entries(counts).map(([s, c]) => `${esc(s)}: ${c}건`).join(" · ")}</p>
    <h2>취약점 조치 현황</h2>
    <p>스캔 호스트 ${vuln.hosts}대 · 열린 취약점 ${vuln.active}건 (Critical ${vuln.critical}/High ${vuln.high}/Medium ${vuln.medium}/Low ${vuln.low}) · 실제 악용(KEV) ${vuln.kev}건</p>
    <p>조치 항목 ${vuln.remediation.tasks}건 · 완료 ${vuln.remediation.done} · 진행 ${vuln.remediation.open} · 기한 초과 ${vuln.remediation.overdue} · SLA 준수율 ${vuln.remediation.slaCompliance}%${준수율집계전단서(vuln.remediation.tasks)}</p>
    <p class="muted">${
      vuln.remediation.tasks === 0
        ? "※ 조치대상(취약점 연결 조치 티켓)이 0건이라 SLA 준수율은 아직 집계 전입니다 — 100%는 만점이 아니라 «잴 것이 없음»입니다."
        : `※ SLA 준수율 = (기한 내 조치 완료) ÷ (전체 조치대상 ${vuln.remediation.tasks}건) × 100. 기한 초과 ${vuln.remediation.overdue}건은 미준수.`
    }</p>
    ${priorities.length ? `<h2>우선순위 조치 목록 (오늘의 조치 Top)</h2><table><tr><th>순위</th><th>심각도</th><th>취약점</th><th>자산</th><th>담당자</th><th>기한</th><th>상태</th></tr>${rows}</table>` : ""}
    ${triageHtml}
    ${casesHtml}
    ${aiThreatsHtml}
    <h2>유지보수 점검 거버넌스</h2>
    <p>전체 ${ms.total}건 · 예정 ${ms.scheduled}건(지연 ${ms.overdue}) · 승인 대기 ${ms.reported}건 · 승인됨 ${ms.approved}건 · 반려 ${ms.rejected}건</p>
  </body></html>`;
}

// HTML → A4 PDF (headless 브라우저). playwright-core는 client/node_modules에 있으므로 그쪽에서 resolve.
// 브라우저(Edge/Chromium) 미가용 시 false 반환 → 호출부가 DOCX만 제공.
// playwright-core를 여러 위치에서 순서대로 resolve한다:
//  ① server 자체(node_modules에 설치된 운영 배포 — client 폴더가 없는 WSL 서버) → ② dev 환경의 ../client.
// 어느 쪽도 없으면 PDF 없이 DOCX만 제공(비치명적).
function loadPlaywright(): { chromium: { launch: (o: unknown) => Promise<any> } } | null {
  const candidates = [
    path.resolve(process.cwd(), "package.json"), // server 자체
    path.resolve(process.cwd(), "..", "client", "package.json"), // dev: sibling client
  ];
  for (const base of candidates) {
    try {
      return createRequire(base)("playwright-core") as { chromium: { launch: (o: unknown) => Promise<any> } };
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}
/** HTML → PDF. 점검 보고서(inspectionreport.ts)도 같은 렌더러를 쓴다 — 두 벌 두지 않는다. */
export async function renderPdf(html: string, outPath: string): Promise<boolean> {
  try {
    const pw = loadPlaywright();
    if (!pw) throw new Error("playwright-core 미설치(server·client 어디에도 없음)");
    const chromium = pw.chromium;
    // Windows dev는 msedge, 리눅스(운영 WSL)는 설치된 chromium으로 폴백.
    const browser: any = await chromium.launch({ channel: "msedge", headless: true }).catch(() => chromium.launch({ headless: true }));
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({ path: outPath, format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" } });
      return true;
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.warn(`[report] PDF 생성 실패 — DOCX만 제공: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export function registerReportRoutes(app: Express): void {
  app.post(
    "/api/report/generate",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const actor = (req as ExpressRequestWithUser).user?.displayName ?? null;
      // 모르는 type이 취약점 리포트로 조용히 폴백되던 것을 정직하게 거절한다(2026-08-09 실측 —
      // work-progress를 요청했는데 취약점 요약이 나왔다. 틀린 리포트는 없느니만 못하다).
      const 알려진 = ["weekly", "quarterly", "ondemand", "daily", "monthly", "work-progress"];
      const type = req.body?.type ?? "ondemand";
      if (!알려진.includes(type)) {
        res.status(400).json({ error: `알 수 없는 리포트 종류: ${type} — 가능한 종류: ${알려진.join(", ")}` });
        return;
      }
      const result =
        type === "work-progress"
          ? await generateWorkProgressReport({ ...req.body, createdBy: actor ?? undefined })
          : await generateReport({ ...req.body, createdBy: actor ?? undefined }); // 작업 귀속 — 생성자 기록
      // 작업 기록(감사)에 남긴다 → onAudit 훅으로 작업 세션 목록에도 자동 반영("모든 행위" 요청).
      recordAudit({
        kind: "write", actor, action: `리포트 생성 (${req.body?.type ?? "ondemand"})`,
        target: path.basename(result.filePath), detail: result.executiveSummary.slice(0, 200), result: "ok",
      });
      res.json(result);
    })
  );
  // 저장된 리포트 이력 — 이번 세션뿐 아니라 과거에 생성한 리포트까지(재기동·다른 세션 포함).
  app.get(
    "/api/report/history",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      res.json(await listReportHistory(limit));
    })
  );
  // N일 이전 리포트 일괄 삭제 — 라우트 순서상 /:base보다 먼저 두어 'prune'이 base로 안 잡히게 한다.
  // 파괴적 작업이라 반드시 감사에 남긴다 — 예전엔 여기 누락돼 있어 리포트가 사라져도 누가·언제 지웠는지
  // 알 방법이 없었다(2026-07-21 실측: 운영 data/reports가 통째로 비었는데 흔적이 전혀 없었음).
  app.post(
    "/api/report/prune",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const actor = (req as ExpressRequestWithUser).user?.displayName ?? null;
      try {
        const days = Number(req.body?.olderThanDays);
        const result = await pruneReports(days);
        recordAudit({ kind: "write", actor, action: `리포트 일괄 삭제(${days}일 이전)`, detail: `리포트 ${result.deletedReports}건 · 파일 ${result.deletedFiles}개`, result: "ok" });
        res.json(result);
      } catch (e) {
        recordAudit({ kind: "write", actor, action: "리포트 일괄 삭제 실패", detail: (e as Error).message, result: "error" });
        res.status(400).json({ error: (e as Error).message });
      }
    })
  );
  // 전체 삭제 — /:base보다 먼저 등록해 'delete-all'이 base로 안 잡히게 한다.
  app.post(
    "/api/report/delete-all",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const actor = (req as ExpressRequestWithUser).user?.displayName ?? null;
      const result = await deleteAllReports();
      recordAudit({ kind: "write", actor, action: "리포트 전체 삭제", detail: `리포트 ${result.deletedReports}건 · 파일 ${result.deletedFiles}개`, result: "ok" });
      res.json(result);
    })
  );
  app.delete(
    "/api/report/:base",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const actor = (req as ExpressRequestWithUser).user?.displayName ?? null;
      try {
        const result = await deleteReport(String(req.params.base));
        recordAudit({ kind: "write", actor, action: "리포트 삭제", target: String(req.params.base), detail: result.deleted.join(", "), result: "ok" });
        res.json(result);
      } catch (e) {
        recordAudit({ kind: "write", actor, action: "리포트 삭제 실패", target: String(req.params.base), detail: (e as Error).message, result: "error" });
        res.status(400).json({ error: (e as Error).message });
      }
    })
  );
  // 생성된 리포트 파일을 base64 JSON으로 반환 — 클라이언트가 열기/저장(서버가 다른 머신이어도 동작).
  app.get(
    "/api/report/file/:name",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const name = path.basename(String(req.params.name)); // 경로 순회(../) 방지
      // md도 받는다 — AI 작성 자료·파일 처리 내역은 마크다운으로 저장되고 화면이 본문을 그대로
      // 보여준다(2026-07-26 실사고: 뷰어가 md를 요청했는데 400으로 막혀 본문이 안 나왔다).
      if (!/\.(docx|pdf|md)$/i.test(name)) {
        res.status(400).json({ error: "docx·pdf·md 파일만 받을 수 있습니다" });
        return;
      }
      try {
        const buf = await fs.readFile(path.join(REPORT_DIR, name));
        const lower = name.toLowerCase();
        const mime = lower.endsWith(".pdf")
          ? "application/pdf"
          : lower.endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        res.json({ name, mime, base64: buf.toString("base64") });
      } catch {
        res.status(404).json({ error: "리포트 파일을 찾을 수 없습니다" });
      }
    })
  );
}
