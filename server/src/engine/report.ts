// engine/report.ts — 내부 SBOM 기반 내부보고용 리포트 (6.4.1절)
// 데이터 소스는 6.4의 자산 레지스트리(assets.ts)를 그대로 재사용 — 별도 수집 로직 없음.

import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { createRequire } from "module";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";
import { listAssets, getAsset, Asset } from "./assets";
import { listMaintenanceItems, MaintenanceItem } from "./maintenance";
import { listTasks, TaskItem } from "./tasks";
import { prioritizedReviews, buildTriageDraft, type PrioritizedFinding } from "./approvals";

export interface ReportRequest {
  type: "weekly" | "quarterly" | "ondemand";
  assetIds?: string[];
  format?: "docx" | "pdf" | "both"; // 기본 docx. pdf/both면 PDF도 생성(개선 #3).
}

export interface ReportResult {
  filePath: string; // DOCX 경로(항상 생성)
  pdfPath?: string; // PDF 경로(format이 pdf/both이고 렌더 성공 시)
  pdfError?: string; // PDF 요청했으나 실패한 경우 사유(브라우저 미가용 등)
  executiveSummary: string;
}

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

export function collectVulnReportData(): VulnReportData {
  const now = Date.now();
  const hosts = listAssets().filter((a) => a.assetType === "infra-host");
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
  const today = new Date().toISOString().slice(0, 10);
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

async function buildDocx(
  req: ReportRequest,
  assets: Asset[],
  executiveSummary: string,
  maintenance: MaintenanceItem[],
  vuln: VulnReportData,
  priorities: PrioritizedFinding[],
  triageDraft: string
): Promise<Buffer> {
  const counts = severityCounts(assets);
  const ms = maintenanceSummary(maintenance);
  // 감사 추적: 최근 승인/반려 처리 건(검토자·사유). 리포트에는 최근 10건만.
  const reviewed = maintenance
    .filter((m) => m.status === "approved" || m.status === "rejected")
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0))
    .slice(0, 10);
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: `GIJO AS 보안 현황 리포트 (${req.type})`, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: "경영진 요약", heading: HeadingLevel.HEADING_1 }),
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

export async function generateReport(req: ReportRequest): Promise<ReportResult> {
  const assets = collectAssets(req);
  const counts = severityCounts(assets);
  const maintenance = listMaintenanceItems();
  const ms = maintenanceSummary(maintenance);
  const vuln = collectVulnReportData();
  const executiveSummary = await chat({
    agentId: "report",
    message:
      `다음 보안 현황 데이터를 바탕으로 경영진용 1페이지 요약을 작성해줘. 자산 ${assets.length}건, ` +
      `심각도별 발견 건수: ${JSON.stringify(counts)}. ` +
      `취약점 조치: 스캔 호스트 ${vuln.hosts}대, 열린 취약점 ${vuln.active}건(Critical ${vuln.critical}·High ${vuln.high}), ` +
      `실제 악용 확인(KEV) ${vuln.kev}건은 최우선 조치 대상. 조치 SLA 준수율 ${vuln.remediation.slaCompliance}%, 기한 초과 ${vuln.remediation.overdue}건. ` +
      `유지보수 점검: 전체 ${ms.total}건 중 지연 ${ms.overdue}건, 승인 대기 ${ms.reported}건, 반려 ${ms.rejected}건. ` +
      `KEV와 기한 초과 조치를 우선순위로 강조해줘.`,
  });

  // 우선순위 조치 목록(개선 #2)과 AI 브리핑(개선 #4)을 보고서에 포함.
  const priorities = prioritizedReviews(8);
  let triageDraft = "";
  try {
    triageDraft = (await buildTriageDraft(5)).draft;
  } catch {
    /* LLM 미가동 등 — 브리핑 없이 진행 */
  }

  const buffer = await buildDocx(req, assets, executiveSummary, maintenance, vuln, priorities, triageDraft);
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = `${req.type}-${Date.now()}`;
  const filePath = path.join(REPORT_DIR, `${base}.docx`);
  await fs.writeFile(filePath, buffer);

  const result: ReportResult = { filePath, executiveSummary };

  // PDF 생성(개선 #3) — 요청 시. HTML로 만들어 headless 브라우저로 A4 렌더. 실패해도 DOCX는 그대로.
  if (req.format === "pdf" || req.format === "both") {
    const pdfPath = path.join(REPORT_DIR, `${base}.pdf`);
    const html = buildReportHtml(req, assets, executiveSummary, maintenance, vuln, priorities, triageDraft);
    const ok = await renderPdf(html, pdfPath);
    if (ok) result.pdfPath = pdfPath;
    else result.pdfError = "PDF 렌더 실패(headless 브라우저 미가용). DOCX만 제공됩니다.";
  }
  return result;
}

// 보고서 HTML(개선 #3 PDF용) — DOCX와 같은 데이터를 A4 인쇄용 HTML로. 한국어는 시스템 폰트로 렌더.
function buildReportHtml(
  req: ReportRequest,
  assets: Asset[],
  executiveSummary: string,
  maintenance: MaintenanceItem[],
  vuln: VulnReportData,
  priorities: PrioritizedFinding[],
  triageDraft: string
): string {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const counts = severityCounts(assets);
  const ms = maintenanceSummary(maintenance);
  const rows = priorities
    .map((r, i) =>
      `<tr><td>${i + 1}</td><td>${esc(r.finding.severity)}${r.finding.kev ? " · KEV" : ""}</td>` +
      `<td>${esc(r.finding.finding_type.slice(0, 42))}</td><td>${esc(r.assetName)}</td>` +
      `<td>${esc(r.assignee || "미배정")}</td><td>${r.dueDate ? esc(r.dueDate) + (r.overdue ? " ⚠지연" : "") : "-"}</td>` +
      `<td>${esc(RV_STATUS_LABEL[r.status] ?? r.status)}</td></tr>`
    )
    .join("");
  const triageHtml = triageDraft && !triageDraft.startsWith("⚠") ? `<h2>AI 조치 브리핑 (참고)</h2><pre>${esc(triageDraft)}</pre>` : "";
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;color:#111;font-size:12px;line-height:1.6;padding:8px}
    h1{font-size:20px;border-bottom:2px solid #333;padding-bottom:6px} h2{font-size:14px;margin-top:18px;color:#1a3a6b}
    table{border-collapse:collapse;width:100%;margin-top:8px;font-size:11px} th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}
    th{background:#f0f3f8} pre{white-space:pre-wrap;background:#f7f8fa;border:1px solid #ddd;padding:10px;border-radius:6px;font-family:inherit}
    .muted{color:#666;font-size:10.5px;font-style:italic}
  </style></head><body>
    <h1>GIJO AS 보안 현황 리포트 (${esc(req.type)})</h1>
    <h2>경영진 요약</h2><p>${esc(executiveSummary).replace(/\n/g, "<br>")}</p>
    <h2>심각도별 분포</h2><p>${Object.entries(counts).map(([s, c]) => `${esc(s)}: ${c}건`).join(" · ")}</p>
    <h2>취약점 조치 현황</h2>
    <p>스캔 호스트 ${vuln.hosts}대 · 열린 취약점 ${vuln.active}건 (Critical ${vuln.critical}/High ${vuln.high}/Medium ${vuln.medium}/Low ${vuln.low}) · 실제 악용(KEV) ${vuln.kev}건</p>
    <p>조치 항목 ${vuln.remediation.tasks}건 · 완료 ${vuln.remediation.done} · 진행 ${vuln.remediation.open} · 기한 초과 ${vuln.remediation.overdue} · SLA 준수율 ${vuln.remediation.slaCompliance}%</p>
    <p class="muted">※ SLA 준수율 = (기한 내 조치 완료) ÷ (전체 조치대상 ${vuln.remediation.tasks}건) × 100. 기한 초과 ${vuln.remediation.overdue}건은 미준수.</p>
    ${priorities.length ? `<h2>우선순위 조치 목록 (오늘의 조치 Top)</h2><table><tr><th>순위</th><th>심각도</th><th>취약점</th><th>자산</th><th>담당자</th><th>기한</th><th>상태</th></tr>${rows}</table>` : ""}
    ${triageHtml}
    <h2>유지보수 점검 거버넌스</h2>
    <p>전체 ${ms.total}건 · 예정 ${ms.scheduled}건(지연 ${ms.overdue}) · 승인 대기 ${ms.reported}건 · 승인됨 ${ms.approved}건 · 반려 ${ms.rejected}건</p>
  </body></html>`;
}

// HTML → A4 PDF (headless 브라우저). playwright-core는 client/node_modules에 있으므로 그쪽에서 resolve.
// 브라우저(Edge/Chromium) 미가용 시 false 반환 → 호출부가 DOCX만 제공.
async function renderPdf(html: string, outPath: string): Promise<boolean> {
  try {
    const req = createRequire(path.resolve(process.cwd(), "..", "client", "package.json"));
    // playwright-core는 server 의존성이 아니라 client/node_modules에서 resolve(타입 없이 런타임 로드).
    const pw = req("playwright-core") as { chromium: { launch: (o: unknown) => Promise<any> } };
    const chromium = pw.chromium;
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
      res.json(await generateReport(req.body));
    })
  );
}
