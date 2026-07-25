// engine/ingestreport.ts — 파일 업로드 진행내역 리포트 (선택 저장)
//
// 사용자 요청(2026-07-25): "사용자가 파일을 올리면 진행내역 리포트로 저장할지" 물어보고 저장.
// 목적: "이 파일이 언제·무엇을 등록했는지"를 나중에 증빙한다(감사 대응·인수인계). 저장은 선택이며,
// 저장하지 않아도 자산·취약점 등록 결과는 그대로 유지된다.
//
// 저장 위치는 기존 리포트 디렉터리(report.ts REPORT_DIR)를 그대로 쓴다 — 리포트 이력 화면·다운로드
// ·삭제 경로를 재사용하기 위해. 형식은 마크다운(.md) + 사이드카(.json): DOCX 렌더는 이 용도에
// 과하고(진행내역은 표 몇 줄), 마크다운이 인수인계 문서에 붙이기도 쉽다.

import type { Express, Request } from "express";
import * as fs from "fs/promises";
import * as path from "path";
import { authMiddleware } from "../auth/auth";
import type { GijoUser } from "../auth/users";
import { asyncRoute } from "../util/asyncRoute";
import { recordAudit } from "./audit";
import { getAsset } from "./assets";

const REPORT_DIR = process.env.GIJO_REPORT_DIR ?? path.join("data", "reports");

export interface IngestReportInput {
  filename: string; // 올린 파일명
  routedTo: string; // vulnscan | product-manual | memory | decision
  reason: string; // 판별·파싱 근거(파서가 만든 노트)
  steps?: string[]; // 처리 단계(화면이 보여준 그대로)
  assetIds?: string[]; // 등록·갱신된 자산
  hosts?: number;
  findings?: number;
  chunks?: number; // 지식베이스에 수집된 조각 수
}

export interface IngestReportResult {
  base: string; // 파일명 접두(리포트 이력 키)
  path: string;
  savedAt: number;
}

const ROUTE_LABEL: Record<string, string> = {
  vulnscan: "취약점 스캔 결과로 반영(자산·취약점 등록)",
  "product-manual": "보안제품 매뉴얼로 등록",
  memory: "지식베이스(RAG) 문서로 수집",
  decision: "유형 확인 대기",
};

/** 진행내역을 마크다운 리포트로 저장한다. 리포트 이력 화면에 'ingest' 타입으로 나타난다. */
export async function saveIngestReport(input: IngestReportInput, actor: string | null): Promise<IngestReportResult> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const ts = Date.now();
  const base = `ingest-${ts}`;
  const assetLines = (input.assetIds ?? []).map((id) => {
    const a = getAsset(id);
    if (!a) return `- ${id} (조회 실패)`;
    const shown = a.displayName ? `${a.displayName} (원래: ${a.name})` : a.name;
    const open = a.findings.filter((f) => f.state !== "fixed").length;
    return `- **${shown}** — \`${id}\` · 취약점 ${open}건`;
  });
  const md = [
    `# 파일 처리 진행내역 리포트`,
    ``,
    `- 파일: **${input.filename}**`,
    `- 처리 결과: ${ROUTE_LABEL[input.routedTo] ?? input.routedTo}`,
    `- 처리자: ${actor ?? "-"}`,
    `- 처리 시각: ${new Date(ts).toLocaleString("ko-KR")}`,
    ...(input.hosts !== undefined ? [`- 등록 자산: ${input.hosts}개`] : []),
    ...(input.findings !== undefined ? [`- 반영 취약점: ${input.findings}건`] : []),
    ...(input.chunks !== undefined ? [`- 지식베이스 수집: ${input.chunks}조각`] : []),
    ``,
    `## 판별·파싱 근거`,
    input.reason || "(없음)",
    ...(input.steps?.length ? [``, `## 처리 단계`, ...input.steps.map((s) => `1. ${s}`)] : []),
    ...(assetLines.length ? [``, `## 등록·갱신된 자산`, ...assetLines] : []),
    ``,
    `---`,
    `이 리포트는 파일 인입 시점의 처리 내역을 그대로 기록한 것입니다(감사 대응·인수인계 증빙용).`,
  ].join("\n");

  const mdPath = path.join(REPORT_DIR, `${base}.md`);
  await fs.writeFile(mdPath, md, "utf-8");
  // 사이드카 — 리포트 이력 화면이 종류·요약·생성자를 읽는다(report.ts listReportHistory와 같은 형식).
  await fs.writeFile(
    path.join(REPORT_DIR, `${base}.json`),
    JSON.stringify(
      {
        base,
        type: "ingest",
        createdAt: ts,
        assetIds: input.assetIds ?? [],
        assetNames: (input.assetIds ?? []).map((id) => getAsset(id)?.displayName ?? getAsset(id)?.name ?? id),
        summary: `${input.filename} — ${ROUTE_LABEL[input.routedTo] ?? input.routedTo}${
          input.findings !== undefined ? ` · 취약점 ${input.findings}건` : ""
        }`,
        md: `${base}.md`,
        createdBy: actor ?? undefined,
      },
      null,
      2
    ),
    "utf-8"
  );
  return { base, path: mdPath, savedAt: ts };
}

export function registerIngestReportRoutes(app: Express): void {
  app.post(
    "/api/upload/ingest-report",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const b = req.body as Partial<IngestReportInput>;
      if (!b?.filename) {
        res.status(400).json({ error: "filename이 필요합니다" });
        return;
      }
      const actor = (req as Request & { user?: GijoUser }).user?.displayName ?? null;
      const saved = await saveIngestReport(
        {
          filename: String(b.filename),
          routedTo: String(b.routedTo ?? "memory"),
          reason: String(b.reason ?? ""),
          steps: Array.isArray(b.steps) ? b.steps.filter((s): s is string => typeof s === "string") : undefined,
          assetIds: Array.isArray(b.assetIds) ? b.assetIds.filter((s): s is string => typeof s === "string") : undefined,
          hosts: typeof b.hosts === "number" ? b.hosts : undefined,
          findings: typeof b.findings === "number" ? b.findings : undefined,
          chunks: typeof b.chunks === "number" ? b.chunks : undefined,
        },
        actor
      );
      recordAudit({
        kind: "write",
        actor,
        action: "파일 진행내역 리포트 저장",
        target: String(b.filename),
        detail: `${saved.base} · ${b.routedTo ?? "-"}${b.findings !== undefined ? ` · 취약점 ${b.findings}건` : ""}`,
        result: "ok",
      });
      res.json(saved);
    })
  );
}
