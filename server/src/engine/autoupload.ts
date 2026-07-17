// engine/autoupload.ts — 스마트 통합 업로드: 파일만 올리면 유형을 판별해 알맞은 파이프라인으로
// 자동 라우팅한다(수동 입력칸 최소화 — 2026-07-17 요청). 판별은 결정적 규칙(확장자·헤더·파일명)
// 우선이고, LLM은 일반 문서의 종류 분류(memory.classify)에만 쓴다 — 무거운 판별에 LLM을 쓰지
// 않아 빠르고 재현 가능하다. 판별 근거(reason)를 응답에 담아 "왜 이렇게 처리됐는지" 투명하게 보여준다.

import type { Express } from "express";
import { authMiddleware } from "../auth/auth";
import { asyncRoute } from "../util/asyncRoute";
import { emitCollaboration } from "./collaboration";
import { importVulnScan } from "./vulnscan";
import { importManual } from "./securityproducts";
import { ingestText, GLOBAL_SCOPE } from "./memory";

export interface AutoUploadResult {
  filename: string;
  routedTo: "vulnscan" | "product-manual" | "memory";
  reason: string; // 판별 근거(투명성)
  vulnscan?: { hosts: number; findings: number };
  manual?: { productName: string; kind: string; createdProduct: boolean };
  memory?: { chunks: number; docClass?: string; linkedProduct?: string };
}

// Nessus CSV 헤더 감지 — host 열과 plugin/risk/cvss 계열 열이 함께 있으면 스캔 결과로 본다.
function looksLikeVulnCsv(text: string): boolean {
  const header = (text.slice(0, 2000).split(/\r?\n/)[0] ?? "").toLowerCase();
  return header.includes("host") && (header.includes("plugin") || header.includes("risk") || header.includes("cvss"));
}

// 취약점 JSON 감지 — host·name 키를 가진 배열(또는 vulnerabilities/findings/results 래핑).
function looksLikeVulnJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : ((parsed as Record<string, unknown>)?.vulnerabilities ??
        (parsed as Record<string, unknown>)?.findings ??
        (parsed as Record<string, unknown>)?.results);
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const first = arr[0] as Record<string, unknown>;
    const keys = Object.keys(first).map((k) => k.toLowerCase());
    return keys.includes("host") && keys.includes("name");
  } catch {
    return false;
  }
}

export async function autoRouteUpload(filename: string, base64: string): Promise<AutoUploadResult> {
  const textish = Buffer.from(base64, "base64").toString("utf-8");
  const ext = (filename.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  emitCollaboration({ from: "orchestrator", to: "scan", message: `파일 유형 판별: ${filename}` });

  // ① 취약점 스캔 결과 — Nessus XML / 스캔 CSV / 취약점 JSON
  let vulnFormat: "nessus" | "csv" | "json" | null = null;
  let vulnReason = "";
  if (ext === ".nessus" || textish.includes("<NessusClientData")) {
    vulnFormat = "nessus";
    vulnReason = "Nessus XML(.nessus) 형식 감지";
  } else if (ext === ".csv" && looksLikeVulnCsv(textish)) {
    vulnFormat = "csv";
    vulnReason = "스캔 CSV 헤더(host + plugin/risk/cvss) 감지";
  } else if (ext === ".json" && looksLikeVulnJson(textish)) {
    vulnFormat = "json";
    vulnReason = "취약점 JSON(host·name 배열) 감지";
  }
  if (vulnFormat) {
    const r = importVulnScan(textish, vulnFormat, filename);
    emitCollaboration({
      from: "scan",
      to: "orchestrator",
      message: `${filename} → 취약점 스캔으로 자동 반영 — 호스트 ${r.hosts}·finding ${r.findings}건`,
    });
    return { filename, routedTo: "vulnscan", reason: vulnReason, vulnscan: { hosts: r.hosts, findings: r.findings } };
  }

  // ② 제품·로그 매뉴얼 — 파일명 표기(사내 관례상 가장 신뢰). RAG 수집 실패해도 등록부 연결은 진행.
  if (/매뉴얼|manual|가이드|guide/i.test(filename)) {
    let docName: string | undefined;
    try {
      const { extractDocumentText } = await import("./dataset.js");
      const text = await extractDocumentText(filename, base64);
      if (text.trim()) {
        await ingestText(filename, text, GLOBAL_SCOPE);
        docName = filename;
      }
    } catch {
      /* RAG 수집 불가(임베딩 미기동 등) — 등록부 연결만이라도 진행 */
    }
    const m = importManual(filename, docName);
    emitCollaboration({
      from: "scan",
      to: "orchestrator",
      message: `${filename} → 보안제품 '${m.productName}'에 ${m.kind === "logManual" ? "로그" : "제품"} 매뉴얼로 자동 연결${m.createdProduct ? " (신규 제품 자동 등록)" : ""}`,
    });
    return {
      filename,
      routedTo: "product-manual",
      reason: "파일명의 매뉴얼/가이드 표기 감지",
      manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct },
    };
  }

  // ③ 일반 문서 — 장기기억 수집 + Scan·Analyze Agent 분류(매뉴얼 판정 시 제품 연결까지)
  const { extractDocumentText } = await import("./dataset.js");
  const text = await extractDocumentText(filename, base64);
  if (!text.trim()) throw new Error("문서에서 텍스트를 추출하지 못했습니다 (빈 문서이거나 지원하지 않는 형식)");
  const r = await ingestText(filename, text, GLOBAL_SCOPE, undefined, true);
  return {
    filename,
    routedTo: "memory",
    reason: "일반 문서 — 장기기억 수집 + 에이전트 분류",
    memory: { chunks: r.chunks, docClass: r.docClass, linkedProduct: r.linkedProduct },
  };
}

export function registerAutoUploadRoutes(app: Express): void {
  app.post(
    "/api/upload/auto",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { filename, content } = req.body as { filename?: string; content?: string };
      if (!filename || !content) {
        res.status(400).json({ error: "filename과 content(base64)가 필요합니다" });
        return;
      }
      res.json(await autoRouteUpload(filename.trim(), content));
    })
  );
}
