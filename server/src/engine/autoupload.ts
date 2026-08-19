// engine/autoupload.ts — 스마트 통합 업로드: 파일만 올리면 유형을 판별해 알맞은 파이프라인으로
// 자동 라우팅한다(수동 입력칸 최소화 — 2026-07-17 요청). 판별은 결정적 규칙(확장자·헤더·파일명)
// 우선이고, LLM은 일반 문서의 종류 분류(memory.classify)에만 쓴다 — 무거운 판별에 LLM을 쓰지
// 않아 빠르고 재현 가능하다. 판별 근거(reason)를 응답에 담아 "왜 이렇게 처리됐는지" 투명하게 보여준다.

import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";
import { asyncRoute } from "../util/asyncRoute";
import { emitCollaboration } from "./collaboration";
import { ingestAnalysisFile, detectIngestKind } from "./analysishub";
import { importVulnScan, parseNessusHtml } from "./vulnscan";
import { importManual, classifyManual, listProducts, guessProductName } from "./securityproducts";
import { ingestText, GLOBAL_SCOPE } from "./memory";

// 사용자가 결정창에서 고를 수 있는 유형(파일명으로 애매할 때).
//
// ⚠ **"log"와 "securitylog"는 다른 것이다.** 헷갈리기 쉬워 여기 적어 둔다.
//   · log         = 제품의 **로그 매뉴얼**("이 장비의 로그는 이렇게 읽는다" 설명서) → 보안제품 등록부
//   · securitylog = 장비가 실제로 뱉은 **보안 로그 원본**(sshd 실패·차단 기록 등)   → 통합 분석 이벤트
//   · opsreport   = 보안제품 **운영 리포트**(주간 차단 통계 등)                      → 통합 분석 이벤트
//
// ★ securitylog·opsreport는 2026-08-01에 **되살린** 것이다. 제품 1차 목표가
//   "취약점·보안로그·운영리포트 3소스 통합 분석"인데, 드롭존을 없애면서 뒤 두 소스의
//   인입 경로가 통째로 끊겨 있었다(엔진은 멀쩡한데 넣을 길이 없었다).
export type UploadType = "asset" | "log" | "document" | "guideline" | "vulnreport" | "securitylog" | "opsreport";

export interface AutoUploadResult {
  filename: string;
  routedTo: "vulnscan" | "product-manual" | "memory" | "analysis" | "decision"; // decision = 사용자 결정 필요
  reason: string; // 판별 근거(투명성)
  needsDecision?: boolean; // true면 프론트가 결정 카드(4유형)를 띄운다
  guess?: UploadType; // 결정 필요 시 추천 유형(미리 선택)
  guessProductName?: string; // 결정 필요 시 신규 제품명 추천값(사용자가 확인·수정 가능, 필요시 수동입력)
  /** uncredentialedHosts: 비인증(원격) 스캔으로 잡힌 호스트 — 로컬 취약점을 놓칠 수 있어
   *  조치 검증 신뢰도가 떨어진다. 취약점 화면 업로더에만 있던 경고인데, 파일 인입을 대시보드
   *  ＋로 모으면서(2026-07-27) 이 경고까지 사라지면 안 되므로 결과에 함께 싣는다. */
  vulnscan?: { hosts: number; findings: number; uncredentialedHosts?: string[] };
  manual?: { productName: string; kind: string; createdProduct: boolean };
  /** 통합 분석 인입 결과 — 로그/리포트 판별과 만들어진 이벤트 수(0건도 정직하게 싣는다). */
  analysis?: { kind: "log" | "report"; created: number };
  memory?: { chunks: number; docClass?: string; linkedProduct?: string; category?: string };
  /** 확정된 업무영역(취약점·장비운영·사내규정·위협대응·일반) — 승인카드에 "이렇게 분류했습니다" 표시용. */
  category?: string;
}

// 파일명으로 애매할 때의 추천 유형. 취약점 리포트·로그·가이드라인·매뉴얼 신호를 순서대로 본다.
function guessType(filename: string): UploadType {
  if (/취약점|vuln(?:erabilit)?y?|스캔\s*리포트|scan\s*report/i.test(filename)) return "vulnreport";
  // 운영 리포트(주간 차단 통계 등) — 「매뉴얼」이 아니라 **운영 실적**이다. 통합 분석의 소스 ③.
  if (/(주간|월간|일일|운영|차단|탐지)\s*(리포트|report|보고)/i.test(filename)) return "opsreport";
  // 로그 원본 vs 로그 매뉴얼 — 매뉴얼 신호(매뉴얼·가이드·설명서)가 함께 있으면 매뉴얼 쪽이다.
  if (/로그|(?:^|[^a-z])logs?(?:[^a-z]|$)/i.test(filename)) {
    return /매뉴얼|manual|가이드|guide|설명서|규격|포맷|format/i.test(filename) ? "log" : "securitylog";
  }
  if (/가이드라인|guideline|지침/i.test(filename)) return "guideline";
  if (/매뉴얼|manual|guide/i.test(filename)) return "asset"; // 제품 매뉴얼(User Guide 등)
  return "document";
}

/**
 * 보안 로그 **원본**인가 — 「로그 매뉴얼」과 가르는 자물쇠.
 *
 * ⚠ 보수적으로 잡는다. 로그 서명이 한두 줄 우연히 들어간 문서(장애처리 노트·매뉴얼 예시)를
 *   끌고 오면, 담당자가 올린 매뉴얼이 분석 이벤트로 둔갑한다. 그래서
 *   ① 확장자가 .log/.syslog이거나 ② 서명 줄이 **5줄 이상** 반복될 때만 원본으로 본다.
 */
function looksLikeRawSecurityLog(text: string, ext: string): boolean {
  if (ext === ".log" || ext === ".syslog") return true;
  const 서명 = /sshd\[|Failed password|authentication failure|Invalid user|kernel:|iptables|UFW |denied by|DENY|DROP\b/i;
  let n = 0;
  for (const line of text.slice(0, 200_000).split(/\r?\n/)) {
    if (서명.test(line) && ++n >= 5) return true;
  }
  return false;
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
// category: 라우팅 경로가 이미 아는 업무영역(취약점 리포트→취약점 등) — 인입 시 그대로 기록된다.
// uploadedBy: 작업 귀속(누가 올렸나) — 전 경로에서 기록한다(2026-07-25 RAG 전면 검토).
async function tryIngest(
  filename: string,
  base64: string,
  classify = false,
  category?: string,
  uploadedBy?: string
): Promise<{ chunks: number; docClass?: string; linkedProduct?: string; docName?: string; category?: string } | null> {
  try {
    const { extractDocumentText } = await import("./dataset.js");
    const text = await extractDocumentText(filename, base64);
    if (!text.trim()) return null;
    const r = await ingestText(filename, text, GLOBAL_SCOPE, undefined, classify, uploadedBy, category);
    return { chunks: r.chunks, docClass: r.docClass, linkedProduct: r.linkedProduct, docName: filename, category: r.category };
  } catch {
    return null; // 임베딩 미기동 등 — 검색 수집만 생략, 상위 처리는 계속
  }
}

// 국내 웹취약점 점검 결과보고서(PDF·DOCX 등 서술형)를 규칙 파서로 시도한다.
// 성공(자산·취약점 1건 이상)하면 취약점으로 반영하고, 원문도 RAG에 남겨 근거 조회가 가능하게 한다.
// 실패하면 null을 돌려 호출자가 다음 경로(Nessus HTML → 문서 저장)로 넘어간다.
async function tryWebReport(filename: string, base64: string, uploadedBy?: string): Promise<AutoUploadResult | null> {
  try {
    const { extractDocumentText } = await import("./dataset.js");
    const text = await extractDocumentText(filename, base64);
    if (!text.trim()) return null;
    const { looksLikeWebVulnReport, parseWebVulnReport } = await import("./webreport.js");
    if (!looksLikeWebVulnReport(text)) return null;
    const parsed = parseWebVulnReport(text);
    if (parsed.vulns.length === 0) return null; // 규칙으로 못 잡음 → 호출자가 다음 경로(문서 저장/LLM 폴백)
    const r = importVulnScan(text, "webreport", filename);
    // 원문은 지식베이스에도 남긴다 — 취약점 등록과 별개로 "보고서 내용"을 챗봇이 근거로 인용할 수 있게.
    const ing = await tryIngest(filename, base64, false, "취약점", uploadedBy);
    // ★ 이 보고서가 **어느 자산 것인지** 지금 적어 둔다(2026-08-02).
    //   실사고(2026-07-28~08-02 세 번 재발): "안전대부 웹서버 취약점 알려줘"에 보고서에는 5건이
    //   적혀 있는데 "취약점 없습니다"라고 답했다. 보고서는 지식베이스에 잘 있었지만,
    //   **자산 이름으로는 그 보고서를 찾을 길이 없었다**(검색은 문서 제목이 맞을 때만 발췌를 붙인다).
    //   제목이 안 맞아도 붙이는 느슨한 검색은 무관한 문서를 섞는다 — 보안 답변에선 그게 더 나쁘다.
    //   이 순간에는 문서와 자산을 **둘 다 확실히** 알고 있으니, 여기서 이어 둔다.
    if (ing) {
      try {
        const { linkDocumentToAssets } = await import("./memory.js");
        linkDocumentToAssets(filename, (r.assets ?? []).map((a) => a.id));
      } catch { /* 연결을 못 적어도 등록·인입은 그대로 성공이다 */ }
    }
    emitCollaboration({
      from: "scan",
      to: "orchestrator",
      message: `${filename} → 웹취약점 보고서로 인식 — 자산 ${r.hosts}·취약점 ${r.findings}건 등록${
        parsed.declaredTotal !== undefined && parsed.declaredTotal !== parsed.vulns.length
          ? ` ⚠ 문서 명시 총계 ${parsed.declaredTotal}건과 불일치 — 확인 필요`
          : ""
      }${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}`,
    });
    return {
      filename,
      routedTo: "vulnscan",
      reason: `국내 웹취약점 점검 보고서 파싱 — ${parsed.notes.join(" · ")}`,
      category: "취약점",
      vulnscan: { hosts: r.hosts, findings: r.findings, uncredentialedHosts: r.uncredentialedHosts },
      memory: ing ? { chunks: ing.chunks, docClass: ing.docClass, category: ing.category } : undefined,
    };
  } catch {
    return null; // 텍스트 추출 실패 등 — 다음 경로로
  }
}

// 사용자가 유형을 지정(결정창)했을 때 그 유형으로 바로 라우팅한다.
// productName: 결정 카드에서 사용자가 확인·수정한 제품명(신규 등록 시에만 반영, 없으면 자동 추천값).
// 라우팅 경로가 업무영역(category)을 이미 아는 경우 그 값을 인입에 그대로 전달한다 —
// 제품 매뉴얼=장비운영, 취약점 리포트=취약점. LLM 분류보다 정확하고 결정적이다.
async function routeByType(filename: string, base64: string, type: UploadType, productName?: string, uploadedBy?: string): Promise<AutoUploadResult> {
  // 보안로그 원본·운영 리포트 → **통합 분석 이벤트**. 제품 1차 목표의 소스 ②③이다.
  // ⚠ 파싱만 하고 끝내지 않는다 — 이벤트로 저장돼야 관제 목록·상관분석에 올라온다.
  if (type === "securitylog" || type === "opsreport") {
    const text = Buffer.from(base64, "base64").toString("utf-8");
    const r = ingestAnalysisFile(filename, text);
    // 원문도 지식베이스에 남긴다 — 취약점 리포트와 같은 대우(챗봇이 근거로 인용할 수 있게).
    const ing = await tryIngest(filename, base64, false, "위협대응", uploadedBy);
    const 종류 = r.kind === "log" ? "보안 로그" : "운영 리포트";
    emitCollaboration({
      from: "scan", to: "orchestrator",
      message: `${filename} → ${종류}로 인입 — 분석 이벤트 ${r.created}건 생성${r.created === 0 ? " (탐지 규칙에 걸린 항목 없음)" : ""}${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}`,
    });
    return {
      filename,
      routedTo: "analysis",
      // 0건도 정직하게 말한다 — "올렸는데 아무 일도 없다"로 보이지 않게 이유를 붙인다.
      reason: r.created > 0
        ? `사용자 지정: ${종류} — 통합 분석에 ${r.created}건 등록`
        : `사용자 지정: ${종류} — 읽었지만 탐지 규칙에 걸린 항목이 없어 이벤트는 만들지 않았습니다(원문은 저장)`,
      category: "위협대응",
      analysis: { kind: r.kind, created: r.created },
      memory: ing ? { chunks: ing.chunks, docClass: 종류, category: ing.category } : undefined,
    };
  }
  if (type === "asset" || type === "log") {
    const ing = await tryIngest(filename, base64, false, "장비운영", uploadedBy);
    const m = importManual(filename, ing?.docName, undefined, type === "log" ? "logManual" : "manual", productName);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안제품 '${m.productName}'에 ${type === "log" ? "로그" : "제품"} 매뉴얼로 등록${m.createdProduct ? " (신규 제품 자동 등록)" : ""}${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return { filename, routedTo: "product-manual", reason: `사용자 지정: ${type === "log" ? "로그 매뉴얼" : "보안제품 자산"}`, category: "장비운영", manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct } };
  }
  if (type === "vulnreport") {
    // ① 국내 웹취약점 점검 보고서(PDF/DOCX 서술형) — 텍스트를 추출해 규칙 파서로 시도한다.
    //    Nessus 계열이 아니라 예전엔 문서로만 저장돼 자산·취약점이 안 만들어졌다(2026-07-25 사용자 지적).
    const web = await tryWebReport(filename, base64, uploadedBy);
    if (web) return web;
    // ② Nessus 스타일 HTML(호스트/취약점 헤더) 구조로 시도 — 다른 스캐너(Oracle 등) 자체 포맷은
    // 구조가 달라 인식 못 할 수 있다. 그럴 땐 데이터를 잃지 않도록 문서로라도 저장한다(투명하게 사유 표시).
    const textish = Buffer.from(base64, "base64").toString("utf-8");
    const r = importVulnScan(textish, "html", filename);
    if (r.hosts > 0) {
      emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 취약점 스캔으로 등록 — 호스트 ${r.hosts}·finding ${r.findings}건` });
      return { filename, routedTo: "vulnscan", reason: "사용자 지정: 취약점 리포트/로그 (Nessus 스타일 HTML 파싱)", category: "취약점", vulnscan: { hosts: r.hosts, findings: r.findings, uncredentialedHosts: r.uncredentialedHosts } };
    }
    const ing = await tryIngest(filename, base64, false, "취약점", uploadedBy);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 알려진 스캐너 형식(Nessus 등)이 아니라 구조화 파싱 실패 — 문서로 저장${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return {
      filename,
      routedTo: "memory",
      reason: "사용자 지정: 취약점 리포트/로그 — 알려진 스캐너 HTML 구조가 아니라 findings로 반영하지 못함, 문서로 저장",
      category: "취약점",
      memory: { chunks: ing?.chunks ?? 0, docClass: "취약점 리포트", category: "취약점" },
    };
  }
  // document / guideline → 장기기억(RAG). guideline은 분류 생략(가이드로 태깅만).
  // 업무영역은 지정하지 않는다 — ingestText가 규칙(→ document는 LLM까지)으로 정한다.
  const ing = await tryIngest(filename, base64, type === "document", undefined, uploadedBy);
  if (!ing) {
    return { filename, routedTo: "memory", reason: `사용자 지정: ${type === "guideline" ? "가이드라인" : "문서"} · 검색수집 보류(임베딩 미기동)`, memory: { chunks: 0, docClass: type === "guideline" ? "가이드라인" : undefined } };
  }
  return { filename, routedTo: "memory", reason: `사용자 지정: ${type === "guideline" ? "가이드라인" : "문서"}`, category: ing.category, memory: { chunks: ing.chunks, docClass: type === "guideline" ? "가이드라인" : ing.docClass, linkedProduct: ing.linkedProduct, category: ing.category } };
}

export async function autoRouteUpload(
  filename: string,
  base64: string,
  forceType?: UploadType,
  productName?: string,
  uploadedBy?: string
): Promise<AutoUploadResult> {
  // 사용자가 결정창에서 유형을 골랐으면 그대로 라우팅(판별 생략).
  if (forceType) return routeByType(filename, base64, forceType, productName, uploadedBy);

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
    return { filename, routedTo: "vulnscan", reason: vulnReason, category: "취약점", vulnscan: { hosts: r.hosts, findings: r.findings, uncredentialedHosts: r.uncredentialedHosts } };
  }

  // ①-c 보안 로그 **원본** — 장비가 뱉은 로그 파일. 구조가 뚜렷해 자동으로 통합 분석에 넣는다.
  //   ⚠ 「로그 매뉴얼」(로그 읽는 법 설명서)과 헷갈리면 안 된다. 매뉴얼은 PDF/DOCX 산문이고
  //   원본 로그는 확장자가 .log/.syslog이거나 로그 줄 서명이 여러 줄 반복된다. 그래서
  //   **줄 수 기준**으로 보수적으로 잡는다 — 한두 줄 우연히 걸리는 문서를 끌고 오지 않게.
  if (looksLikeRawSecurityLog(textish, ext)) {
    const r = ingestAnalysisFile(filename, textish);
    const ing = await tryIngest(filename, base64, false, "위협대응", uploadedBy);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안 로그 원본으로 자동 인입 — 분석 이벤트 ${r.created}건${ing ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return {
      filename, routedTo: "analysis",
      reason: r.created > 0
        ? `보안 로그 원본 감지 — 통합 분석에 ${r.created}건 등록`
        : "보안 로그 원본 감지 — 읽었지만 탐지 규칙에 걸린 항목이 없어 이벤트는 만들지 않았습니다(원문은 저장)",
      category: "위협대응",
      analysis: { kind: r.kind, created: r.created },
      memory: ing ? { chunks: ing.chunks, docClass: "보안 로그", category: ing.category } : undefined,
    };
  }

  // ①-b 국내 웹취약점 점검 결과보고서(PDF/DOCX 서술형) — 제목·[IW-NN] 코드체계로 판별되고
  // 규칙 파서가 취약점을 실제로 뽑아낼 때만 취약점으로 반영한다(못 뽑으면 아래 경로로 계속).
  const webAuto = await tryWebReport(filename, base64, uploadedBy);
  if (webAuto) return webAuto;

  // ② 기존 제품과 확실히 매칭되면(모델/벤더/종류 일치) 자동으로 그 제품 매뉴얼로.
  const c = classifyManual(filename, listProducts());
  if (c.reason !== "new-product") {
    const ing = await tryIngest(filename, base64, false, "장비운영", uploadedBy);
    const m = importManual(filename, ing?.docName);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안제품 '${m.productName}'에 ${m.kind === "logManual" ? "로그" : "제품"} 매뉴얼로 자동 연결` });
    return { filename, routedTo: "product-manual", reason: `기존 제품 매칭(${c.reason})`, category: "장비운영", manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct } };
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
      // ⚠ 이 허용 목록은 **UploadType과 반드시 같이 늘려야 한다**(2026-08-01 실측 사고).
      //   유형을 새로 만들고 여기를 안 고치면 forceType이 조용히 버려져 "결정 필요"로 되돌아온다
      //   — 담당자는 골랐는데 아무 일도 안 일어나는 것으로 보인다. 타입에서 뽑아 어긋남을 막는다.
      const ALLOWED: UploadType[] = ["asset", "log", "document", "guideline", "vulnreport", "securitylog", "opsreport"];
      const valid = forceType && ALLOWED.includes(forceType) ? forceType : undefined;
      // 작업 귀속 — 인입되는 문서에 "누가 올렸는지"를 함께 기록한다(2026-07-25 RAG 전면 검토).
      const uploader = (req as Request & { user?: { displayName?: string; username?: string } }).user;
      const result = await autoRouteUpload(filename.trim(), content, valid, productName, uploader?.displayName ?? uploader?.username);
      // 유형이 확정돼 실제 반영된 업로드만 기록(needsDecision=재질문 단계는 행위가 아직 아님).
      if (!(result as { needsDecision?: boolean }).needsDecision) {
        const user = (req as Request & { user?: { displayName?: string } }).user;
        recordAudit({
          kind: "write", actor: user?.displayName ?? null, action: "파일 업로드 자동 분류",
          target: filename.trim(), detail: `유형: ${(result as { type?: string }).type ?? valid ?? "?"}`, result: "ok",
        });
      }
      // ➡ 반입 다음 칩(2026-08-19 사장님 QA — 「파일 올리면 다른 가이드라인이 없는데?」):
      //   반입은 대화 지시가 아니라 nextguide 경로 표를 안 타서 칩이 영영 안 붙던 사각지대다.
      //   문장은 시나리오 실측 ✓ 확인된 것만(nextguide와 같은 원칙).
      const routed = (result as { routedTo?: string }).routedTo;
      const 반입칩: Record<string, string[]> = {
        vulnscan: ["자산 현황 보여줘", "미조치 취약점 뭐 있어?", "오늘 뭐부터 할까?"],
        analysis: ["통합 분석 현황 알려줘", "지금 손댈 일 뭐야?"],
        "product-manual": ["보안제품 현황 알려줘", "점검 일정 현황 알려줘"],
        memory: ["새로 들어온 문서 알려줘", "지식 저장소 상태 알려줘"],
      };
      const nextChips = routed ? 반입칩[routed] : undefined;
      res.json(nextChips ? { ...result, nextChips } : result);
    })
  );
}
