// engine/autoupload.ts — 스마트 통합 업로드: 파일만 올리면 유형을 판별해 알맞은 파이프라인으로
// 자동 라우팅한다(수동 입력칸 최소화 — 2026-07-17 요청). 판별은 결정적 규칙(확장자·헤더·파일명)
// 우선이고, LLM은 일반 문서의 종류 분류(memory.classify)에만 쓴다 — 무거운 판별에 LLM을 쓰지
// 않아 빠르고 재현 가능하다. 판별 근거(reason)를 응답에 담아 "왜 이렇게 처리됐는지" 투명하게 보여준다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";
import { asyncRoute } from "../util/asyncRoute";
import { emitCollaboration } from "./collaboration";
import { importVulnScan, parseNessusHtml } from "./vulnscan";
import { importManual, classifyManual, listProducts, guessProductName } from "./securityproducts";
import { ingestText, GLOBAL_SCOPE } from "./memory";

// 사용자가 결정창에서 고를 수 있는 5유형(파일명으로 애매할 때).
export type UploadType = "asset" | "log" | "document" | "guideline" | "vulnreport";

export interface AutoUploadResult {
  filename: string;
  routedTo: "vulnscan" | "product-manual" | "memory" | "decision"; // decision = 사용자 결정 필요
  reason: string; // 판별 근거(투명성)
  needsDecision?: boolean; // true면 프론트가 결정 카드(4유형)를 띄운다
  guess?: UploadType; // 결정 필요 시 추천 유형(미리 선택)
  guessProductName?: string; // 결정 필요 시 신규 제품명 추천값(사용자가 확인·수정 가능, 필요시 수동입력)
  vulnscan?: { hosts: number; findings: number };
  manual?: { productName: string; kind: string; createdProduct: boolean };
  memory?: { chunks: number; docClass?: string; linkedProduct?: string };
}

// 파일명으로 애매할 때의 추천 유형. 취약점 리포트·로그·가이드라인·매뉴얼 신호를 순서대로 본다.
function guessType(filename: string): UploadType {
  if (/취약점|vuln(?:erabilit)?y?|스캔\s*리포트|scan\s*report/i.test(filename)) return "vulnreport";
  if (/로그|(?:^|[^a-z])logs?(?:[^a-z]|$)/i.test(filename)) return "log";
  if (/가이드라인|guideline|지침/i.test(filename)) return "guideline";
  if (/매뉴얼|manual|guide/i.test(filename)) return "asset"; // 제품 매뉴얼(User Guide 등)
  return "document";
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

// RAG(임베딩) 수집은 임베딩 서버가 죽어 있어도 등록/처리를 막지 않도록 항상 비치명적으로 시도한다.
async function tryIngest(filename: string, base64: string, classify = false): Promise<{ chunks: number; docClass?: string; linkedProduct?: string; docName?: string } | null> {
  try {
    const { extractDocumentText } = await import("./dataset.js");
    const text = await extractDocumentText(filename, base64);
    if (!text.trim()) return null;
    const r = await ingestText(filename, text, GLOBAL_SCOPE, undefined, classify);
    return { chunks: r.chunks, docClass: r.docClass, linkedProduct: r.linkedProduct, docName: filename };
  } catch {
    return null; // 임베딩 미기동 등 — 검색 수집만 생략, 상위 처리는 계속
  }
}

// 사용자가 유형을 지정(결정창)했을 때 그 유형으로 바로 라우팅한다.
// productName: 결정 카드에서 사용자가 확인·수정한 제품명(신규 등록 시에만 반영, 없으면 자동 추천값).
async function routeByType(filename: string, base64: string, type: UploadType, productName?: string): Promise<AutoUploadResult> {
  if (type === "asset" || type === "log") {
    const ing = await tryIngest(filename, base64);
    const m = importManual(filename, ing?.docName, undefined, type === "log" ? "logManual" : "manual", productName);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안제품 '${m.productName}'에 ${type === "log" ? "로그" : "제품"} 매뉴얼로 등록${m.createdProduct ? " (신규 제품 자동 등록)" : ""}${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return { filename, routedTo: "product-manual", reason: `사용자 지정: ${type === "log" ? "로그 매뉴얼" : "보안제품 자산"}`, manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct } };
  }
  if (type === "vulnreport") {
    // Nessus 스타일 HTML(호스트/취약점 헤더) 구조로 우선 시도 — 다른 스캐너(Oracle 등) 자체 포맷은
    // 구조가 달라 인식 못 할 수 있다. 그럴 땐 데이터를 잃지 않도록 문서로라도 저장한다(투명하게 사유 표시).
    const textish = Buffer.from(base64, "base64").toString("utf-8");
    const r = importVulnScan(textish, "html", filename);
    if (r.hosts > 0) {
      emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 취약점 스캔으로 등록 — 호스트 ${r.hosts}·finding ${r.findings}건` });
      return { filename, routedTo: "vulnscan", reason: "사용자 지정: 취약점 리포트/로그 (Nessus 스타일 HTML 파싱)", vulnscan: { hosts: r.hosts, findings: r.findings } };
    }
    const ing = await tryIngest(filename, base64);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 알려진 스캐너 형식(Nessus 등)이 아니라 구조화 파싱 실패 — 문서로 저장${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return {
      filename,
      routedTo: "memory",
      reason: "사용자 지정: 취약점 리포트/로그 — 알려진 스캐너 HTML 구조가 아니라 findings로 반영하지 못함, 문서로 저장",
      memory: { chunks: ing?.chunks ?? 0, docClass: "취약점 리포트" },
    };
  }
  // document / guideline → 장기기억(RAG). guideline은 분류 생략(가이드로 태깅만).
  const ing = await tryIngest(filename, base64, type === "document");
  if (!ing) {
    return { filename, routedTo: "memory", reason: `사용자 지정: ${type === "guideline" ? "가이드라인" : "문서"} · 검색수집 보류(임베딩 미기동)`, memory: { chunks: 0, docClass: type === "guideline" ? "가이드라인" : undefined } };
  }
  return { filename, routedTo: "memory", reason: `사용자 지정: ${type === "guideline" ? "가이드라인" : "문서"}`, memory: { chunks: ing.chunks, docClass: type === "guideline" ? "가이드라인" : ing.docClass, linkedProduct: ing.linkedProduct } };
}

export async function autoRouteUpload(
  filename: string,
  base64: string,
  forceType?: UploadType,
  productName?: string
): Promise<AutoUploadResult> {
  // 사용자가 결정창에서 유형을 골랐으면 그대로 라우팅(판별 생략).
  if (forceType) return routeByType(filename, base64, forceType, productName);

  const textish = Buffer.from(base64, "base64").toString("utf-8");
  const ext = (filename.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  emitCollaboration({ from: "orchestrator", to: "scan", message: `파일 유형 판별: ${filename}` });

  // ① 취약점 스캔 결과 — Nessus XML / 스캔 CSV / 취약점 JSON / Nessus 스타일 HTML (구조가 명확 → 자동)
  let vulnFormat: "nessus" | "csv" | "json" | "html" | null = null;
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
  } else if ((ext === ".html" || ext === ".htm") && parseNessusHtml(textish).vulns.length > 0) {
    vulnFormat = "html";
    vulnReason = "Nessus 스타일 HTML 취약점 리포트(호스트/취약점 헤더) 감지";
  }
  if (vulnFormat) {
    const r = importVulnScan(textish, vulnFormat, filename);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 취약점 스캔으로 자동 반영 — 호스트 ${r.hosts}·finding ${r.findings}건` });
    return { filename, routedTo: "vulnscan", reason: vulnReason, vulnscan: { hosts: r.hosts, findings: r.findings } };
  }

  // ② 기존 제품과 확실히 매칭되면(모델/벤더/종류 일치) 자동으로 그 제품 매뉴얼로.
  const c = classifyManual(filename, listProducts());
  if (c.reason !== "new-product") {
    const ing = await tryIngest(filename, base64);
    const m = importManual(filename, ing?.docName);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안제품 '${m.productName}'에 ${m.kind === "logManual" ? "로그" : "제품"} 매뉴얼로 자동 연결` });
    return { filename, routedTo: "product-manual", reason: `기존 제품 매칭(${c.reason})`, manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct } };
  }

  // ③ 파일명만으로는 취약점 리포트/자산/로그/문서/가이드라인을 확신하기 어렵다 → 사용자 결정 요청(추천 유형 첨부).
  const guess = guessType(filename);
  emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 유형이 애매해 사용자 결정 요청` });
  return {
    filename,
    routedTo: "decision",
    needsDecision: true,
    guess,
    guessProductName: guess === "asset" || guess === "log" ? guessProductName(filename) : undefined,
    reason: "파일명으로 유형을 확신하기 어려움 — 사용자 결정 필요",
  };
}

export function registerAutoUploadRoutes(app: Express): void {
  app.post(
    "/api/upload/auto",
    authMiddleware,
    asyncRoute(async (req, res) => {
      const { filename, content, forceType, productName } = req.body as {
        filename?: string;
        content?: string;
        forceType?: UploadType;
        productName?: string;
      };
      if (!filename || !content) {
        res.status(400).json({ error: "filename과 content(base64)가 필요합니다" });
        return;
      }
      const valid =
        forceType && ["asset", "log", "document", "guideline", "vulnreport"].includes(forceType) ? forceType : undefined;
      const result = await autoRouteUpload(filename.trim(), content, valid, productName);
      // 유형이 확정돼 실제 반영된 업로드만 기록(needsDecision=재질문 단계는 행위가 아직 아님).
      if (!(result as { needsDecision?: boolean }).needsDecision) {
        const user = (req as Request & { user?: { displayName?: string } }).user;
        recordAudit({
          kind: "write", actor: user?.displayName ?? null, action: "파일 업로드 자동 분류",
          target: filename.trim(), detail: `유형: ${(result as { type?: string }).type ?? valid ?? "?"}`, result: "ok",
        });
      }
      res.json(result);
    })
  );
}
