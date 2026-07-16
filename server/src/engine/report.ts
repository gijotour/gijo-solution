// engine/report.ts — 내부 SBOM 기반 내부보고용 리포트 (6.4.1절)
// 데이터 소스는 6.4의 자산 레지스트리(assets.ts)를 그대로 재사용 — 별도 수집 로직 없음.

import type { Express } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { chat } from "./llm";
import { listAssets, getAsset, Asset } from "./assets";
import { listMaintenanceItems, MaintenanceItem } from "./maintenance";

export interface ReportRequest {
  type: "weekly" | "quarterly" | "ondemand";
  assetIds?: string[];
}

export interface ReportResult {
  filePath: string;
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
    for (const finding of asset.findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
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

async function buildDocx(req: ReportRequest, assets: Asset[], executiveSummary: string, maintenance: MaintenanceItem[]): Promise<Buffer> {
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
  const executiveSummary = await chat({
    agentId: "report",
    message:
      `다음 보안 현황 데이터를 바탕으로 경영진용 1페이지 요약을 작성해줘. 자산 ${assets.length}건, ` +
      `심각도별 발견 건수: ${JSON.stringify(counts)}. ` +
      `유지보수 점검: 전체 ${ms.total}건 중 지연 ${ms.overdue}건, 승인 대기 ${ms.reported}건, 반려 ${ms.rejected}건.`,
  });

  const buffer = await buildDocx(req, assets, executiveSummary, maintenance);
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const filePath = path.join(REPORT_DIR, `${req.type}-${Date.now()}.docx`);
  await fs.writeFile(filePath, buffer);

  return { filePath, executiveSummary };
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
