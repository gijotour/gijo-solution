// engine/report.ts — 내부 SBOM 기반 내부보고용 리포트 (6.4.1절)
// 데이터 소스는 6.4의 자산 레지스트리(assets.ts)를 그대로 재사용 — 별도 수집 로직 없음.

import type { Express, Request } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { createRequire } from "module";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { todayLocal } from "../util/date";
import { chat } from "./llm";
import { PLAIN_LANGUAGE_RULE } from "./promptstyle";
import { listAssets, getAsset, Asset } from "./assets";
import { listMaintenanceItems, MaintenanceItem } from "./maintenance";
import { listTasks, TaskItem } from "./tasks";
import { prioritizedReviews, buildTriageDraft, type PrioritizedFinding } from "./approvals";
import { aibomThreatMatches, type AiBomThreatReport } from "./compliance";
import { recordAudit } from "./audit";
import type { GijoUser } from "../auth/users";

type ExpressRequestWithUser = Request & { user?: GijoUser };

export interface ReportRequest {
  type: "weekly" | "quarterly" | "ondemand";
  assetIds?: string[];
  format?: "docx" | "pdf" | "both"; // 기본 docx. pdf/both면 PDF도 생성(개선 #3).
  // 대상 독자: internal=내부 검토용(격식 없이 액션 중심) / official=보고용(격식·거버넌스 강조). 기본 official.
  audience?: "internal" | "official";
}

export interface ReportResult {
  filePath: string; // DOCX 경로(항상 생성)
  pdfPath?: string; // PDF 경로(format이 pdf/both이고 렌더 성공 시)
  pdfError?: string; // PDF 요청했으나 실패한 경우 사유(브라우저 미가용 등)
  executiveSummary: string;
  audience: "internal" | "official";
}

type Finding = Asset["findings"][number];

const REPORT_DIR = path.join("data", "reports");

function collectAssets(req: ReportRequest): Asset[] {
  if (req.assetIds?.length) {
    return req.assetIds.map((id) => getAsset(id)).filter((a): a is Asset => !!a);
  }
  return listAssets();
}

function severityCounts(assets: Asset[]): Record<string, number> {
  const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const asset of assets) {
    // 고쳐진(fixed) finding은 현재 위험이 아니므로 제외.
    for (const finding of asset.findings) if (finding.state !== "fixed") counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
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
      if (f.state === "fixed") continue;
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
    { framework: "전자금융감독규정", control: "제37조의4 취약점 분석·평가 · 제21조 정보처리시스템 보호", rationale: "(금융권 적용 시) 정기 취약점 분석·평가 및 시스템 보호대책 대상" },
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
      cases.push({ assetName: a.name, finding: f, priority: classifyVulnPriority(f), governance: matchGovernance(f) });
    }
  }
  return cases.sort((x, y) => (rank[x.priority.code] ?? 9) - (rank[y.priority.code] ?? 9));
}

const RV_STATUS_LABEL: Record<string, string> = { pending: "미검토", approved: "승인(확정)", rejected: "반려(오탐)" };

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
                  ` · 기한 초과 ${vuln.remediation.overdue} · SLA 준수율 ${vuln.remediation.slaCompliance}%`
              ),
            ],
          }),
          // SLA 산정 근거 명시(개선 #5) — 무엇을 분모/분자로 계산했는지 드러낸다.
          new Paragraph({
            children: [
              new TextRun({
                text:
                  `※ SLA 준수율 = (기한 내 조치 완료 건) ÷ (전체 조치대상 ${vuln.remediation.tasks}건) × 100. ` +
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
                      children: [new TextRun(`[${f.severity}] ${f.finding_type} — ${f.evidence} (${f.source_tool})`)],
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
  const META = /요약(을|음)?\s*(제공|작성|말씀|드리)|보고서\s*요약입니다|요약입니다|제가\s*(보고|답변|작성|말씀)|제\s*(답변|보고)(은|는)|유용하게|이해할\s*수\s*있는\s*정보를\s*제공|다음과\s*같(습니다|이\s*(요약|보고))|살펴볼\s*수\s*있는|하겠습니다/;
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
        } else if (META.test(s)) {
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
  const executiveSummary = stripDialogueArtifacts(await chat({
    agentId: "report",
    message:
      `다음 보안 현황 데이터를 바탕으로 1페이지 요약을 작성해줘. 출력은 보고서 본문 문단만 — 대화록·화자 표시([나]·[주인이] 등)·질문/답변 형식·영어 문장을 절대 쓰지 마세요. ${PLAIN_LANGUAGE_RULE} ${audienceGuide} 자산 ${assets.length}건, ` +
      `심각도별 발견 건수: ${JSON.stringify(counts)}. ` +
      `취약점 조치: 스캔 호스트 ${vuln.hosts}대, 열린 취약점 ${vuln.active}건(Critical ${vuln.critical}·High ${vuln.high}), ` +
      `실제 악용 확인(KEV) ${vuln.kev}건은 최우선 조치 대상. 조치 SLA 준수율 ${vuln.remediation.slaCompliance}%, 기한 초과 ${vuln.remediation.overdue}건. ` +
      `유지보수 점검: 전체 ${ms.total}건 중 지연 ${ms.overdue}건, 승인 대기 ${ms.reported}건, 반려 ${ms.rejected}건.${caseHint} ` +
      `KEV와 기한 초과, 그리고 EPSS가 높은 취약점을 우선순위로 강조해줘. ` +
      `중요: 위에 제시된 수치만 사용하고, 제시되지 않은 숫자(호스트 대수 등)를 새로 지어내지 마세요. 스캔 호스트는 정확히 ${vuln.hosts}대입니다.`,
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
    };
    await fs.writeFile(path.join(REPORT_DIR, `${base}.json`), JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    /* 메타 저장 실패해도 리포트 자체는 유효 — 이력에선 파일명 기반으로 폴백 표시 */
  }
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
}

export async function listReportHistory(limit = 100): Promise<ReportHistoryEntry[]> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const files = await fs.readdir(REPORT_DIR);
  const byBase = new Map<string, { docx?: string; pdf?: string; meta?: string }>();
  for (const f of files) {
    const m = /^(.+)\.(docx|pdf|json)$/i.exec(f);
    if (!m) continue;
    const base = m[1];
    const e = byBase.get(base) ?? {};
    if (/docx/i.test(m[2])) e.docx = f;
    else if (/pdf/i.test(m[2])) e.pdf = f;
    else e.meta = f;
    byBase.set(base, e);
  }
  // 1) 파일명(`type-timestamp`)으로 값싸게 정렬용 시각을 뽑아 최신순 정렬 후 상한만 남긴다.
  //    (리포트가 수백~수천 개 쌓여도 사이드카 JSON을 그 상한만큼만 읽어 비용을 억제한다.)
  const bases = [...byBase.entries()]
    .filter(([, e]) => e.docx || e.pdf) // 메타만 있고 문서 없는 건 제외
    .map(([base, e]) => {
      // session-*: 작업 세션 종료 리포트(worksessions.ts) — 같은 이력에 함께 나열된다.
      const fm = /^(?:weekly|quarterly|ondemand|session)-(\d+)$/.exec(base);
      return { base, e, ts: fm ? Number(fm[1]) : 0 };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, Math.max(1, limit));
  // 2) 상한 안의 항목만 사이드카(대상 자산·독자·요약)로 보강한다.
  const out: ReportHistoryEntry[] = [];
  for (const { base, e, ts } of bases) {
    const fm = /^(weekly|quarterly|ondemand|session)-\d+$/.exec(base);
    const entry: ReportHistoryEntry = {
      base,
      type: fm ? fm[1] : "ondemand",
      createdAt: ts,
      assetIds: [],
      assetNames: [],
      docx: e.docx,
      pdf: e.pdf,
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
      } catch {
        /* 메타 깨졌으면 파일명 기반 폴백 유지 */
      }
    }
    if (!entry.createdAt) {
      try {
        entry.createdAt = Math.floor((await fs.stat(path.join(REPORT_DIR, (e.docx || e.pdf) as string))).mtimeMs);
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
  for (const ext of ["docx", "pdf", "json"]) {
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
    const m = /^(.+)\.(docx|pdf|json)$/i.exec(f);
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
    const m = /^(.+)\.(docx|pdf|json)$/i.exec(f);
    if (!m) continue;
    if (/docx|pdf/i.test(m[2])) bases.add(m[1]);
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
    body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;color:#111;font-size:12px;line-height:1.6;padding:8px}
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
    <p>조치 항목 ${vuln.remediation.tasks}건 · 완료 ${vuln.remediation.done} · 진행 ${vuln.remediation.open} · 기한 초과 ${vuln.remediation.overdue} · SLA 준수율 ${vuln.remediation.slaCompliance}%</p>
    <p class="muted">※ SLA 준수율 = (기한 내 조치 완료) ÷ (전체 조치대상 ${vuln.remediation.tasks}건) × 100. 기한 초과 ${vuln.remediation.overdue}건은 미준수.</p>
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
async function renderPdf(html: string, outPath: string): Promise<boolean> {
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
      const result = await generateReport(req.body);
      // 작업 기록(감사)에 남긴다 → onAudit 훅으로 작업 세션 목록에도 자동 반영("모든 행위" 요청).
      const actor = (req as ExpressRequestWithUser).user?.displayName ?? null;
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
  app.post(
    "/api/report/prune",
    authMiddleware,
    asyncRoute(async (req, res) => {
      try {
        res.json(await pruneReports(Number(req.body?.olderThanDays)));
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    })
  );
  // 전체 삭제 — /:base보다 먼저 등록해 'delete-all'이 base로 안 잡히게 한다.
  app.post(
    "/api/report/delete-all",
    authMiddleware,
    asyncRoute(async (_req, res) => {
      res.json(await deleteAllReports());
    })
  );
  app.delete(
    "/api/report/:base",
    authMiddleware,
    asyncRoute(async (req, res) => {
      try {
        res.json(await deleteReport(String(req.params.base)));
      } catch (e) {
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
      if (!/\.(docx|pdf)$/i.test(name)) {
        res.status(400).json({ error: "docx/pdf 파일만 받을 수 있습니다" });
        return;
      }
      try {
        const buf = await fs.readFile(path.join(REPORT_DIR, name));
        const mime = name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        res.json({ name, mime, base64: buf.toString("base64") });
      } catch {
        res.status(404).json({ error: "리포트 파일을 찾을 수 없습니다" });
      }
    })
  );
}
