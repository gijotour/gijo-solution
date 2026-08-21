// engine/autoupload.ts — 스마트 통합 업로드: 파일만 올리면 유형을 판별해 알맞은 파이프라인으로
// 자동 라우팅한다(수동 입력칸 최소화 — 2026-07-17 요청). 판별은 결정적 규칙(확장자·헤더·파일명)
// 우선이고, LLM은 일반 문서의 종류 분류(memory.classify)에만 쓴다 — 무거운 판별에 LLM을 쓰지
// 않아 빠르고 재현 가능하다. 판별 근거(reason)를 응답에 담아 "왜 이렇게 처리됐는지" 투명하게 보여준다.

import path from "path";
import type { Express, Request } from "express";
import { authMiddleware } from "../auth/auth";
import { recordAudit } from "./audit";
import { asyncRoute } from "../util/asyncRoute";
import { emitCollaboration } from "./collaboration";
import { ingestAnalysisFile, detectIngestKind } from "./analysishub";
import { importVulnScan, parseNessusHtml } from "./vulnscan";
import { importManual, classifyManual, listProducts, guessProductName } from "./securityproducts";
import { ingestText, GLOBAL_SCOPE, saveDocArtifacts, cleanupOldOriginal, 열람불가공용 } from "./memory";

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
  /** 「원본도 보관」 토글의 **실제 결과**(2026-08-22). 켰다고 다 남는 게 아니다 —
   *  취약점 스캔으로 반영되는 갈래(Nessus HTML·자동 vulnscan)는 문서 인입을 안 타므로
   *  원본도 추출본도 만들지 않는다. 화면이 「보관했습니다」를 **요청값이 아니라 이 값으로만**
   *  말하게 해서 「켰는데 안 남았다」가 조용히 지나가지 않게 한다(정직 원칙). */
  savedOriginal?: boolean;
  /** 추출본(.md) 실제 저장 여부 — 파일이 생겼는지만 뜻한다. */
  mdSaved?: boolean;
  /** 검색 수집(임베딩)까지 실제로 끝났는가. **mdSaved와 다르다** — 파일은 남았는데 임베딩이
   *  죽어 수집을 못 하면 문서 메타 행이 안 생겨 「내 문서」 목록에도 안 뜨고 추출본 보기도 404다.
   *  화면이 「내 문서에서 보고 고칠 수 있습니다」를 말해도 되는지는 **이 값으로** 가른다. */
  ingested?: boolean;
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
// opts.keepOriginal — 「원본도 보관」 토글(콘솔 ＋). 새 인자는 **끝에 옵션 객체로** 붙인다:
//   tryIngest/routeByType/autoRouteUpload는 이미 위치 인자 5개이고 시험(threesourceingest)이
//   위치로 부르기 때문에, 중간에 끼우면 호출부 7곳이 `undefined, undefined, keep` 꼴이 된다.
async function tryIngest(
  filename: string,
  base64: string,
  classify = false,
  category?: string,
  uploadedBy?: string,
  opts?: { keepOriginal?: boolean }
): Promise<{ chunks: number; docClass?: string; linkedProduct?: string; docName?: string; category?: string; savedOriginal?: boolean; mdSaved?: boolean; ingested: boolean; 실패사유?: string } | null> {
  // ★ 보관 결과는 catch **밖**에 둔다 — 파일 보관은 검색 수집(임베딩)보다 **먼저** 끝나므로,
  //   임베딩이 죽었다고 「원본을 보관했다」는 사실까지 삼키면 화면이 거짓을 말하게 된다
  //   (0820 「삼켜진 실패」 계보의 거울상 — 이번엔 삼켜진 *성공*이다).
  let 보관: { mdSaved: boolean; originalSaved: boolean; sourcePath?: string } = { mdSaved: false, originalSaved: false };
  try {
    const { extractDocumentText } = await import("./dataset.js");
    const text = await extractDocumentText(filename, base64);
    if (!text.trim()) return null;
    // ★ 콘솔 ＋로 들어온 문서도 「내 문서」에서 추출본(.md)을 보고 고칠 수 있어야 한다(2026-08-22).
    //   예전엔 이 창구만 sourcePath=undefined로 넘겨 **추출본도 원본도 안 남았다** —
    //   같은 일을 하는 ingest-file 라우트와 잣대가 갈려 있었다. 이제 둘 다 saveDocArtifacts를 쓴다.
    보관 = await saveDocArtifacts({ documentId: filename, text, contentBase64: base64, keepOriginal: opts?.keepOriginal });
    const r = await ingestText(filename, text, GLOBAL_SCOPE, 보관.sourcePath, classify, uploadedBy, category);
    // 「보관 안 함」으로 다시 올린 경우의 옛 원본 정리는 **수집이 끝난 뒤에** 한다 —
    // 먼저 지우면 수집이 실패했을 때 옛 문서는 살아 있는데 그 원본만 사라진다.
    if (!opts?.keepOriginal) await cleanupOldOriginal(filename);
    // ⚠ chunks가 0이면 **문서 메타 행이 안 생긴다**(수집 함수가 그 전에 조기 반환한다).
    //   목록에도 안 뜨고 추출본 보기도 404이므로 「수집됐다」고 말하면 안 된다(재검토관 확정).
    return {
      chunks: r.chunks, docClass: r.docClass, linkedProduct: r.linkedProduct,
      docName: r.chunks > 0 ? filename : undefined, category: r.category,
      savedOriginal: 보관.originalSaved, mdSaved: 보관.mdSaved, ingested: r.chunks > 0,
    };
  } catch (e) {
    // 임베딩 미기동 등 — 검색 수집만 생략, 상위 처리는 계속.
    // ★ **사유를 들고 올라온다**(재검토관 2026-08-22). 예전엔 여기로 떨어진 것을 전부
    //   「임베딩 미기동」이라고 단정했는데, 같은 자리에 추출기 없음·읽을 수 없는 문서도 떨어진다.
    //   PDF 추출기가 죽은 날 담당자가 멀쩡한 임베딩 서버만 들여다보게 만드는 오진이었다.
    const 사유 = e instanceof Error ? e.message : String(e);
    // 다만 **보관까지는 됐다면** 그 사실은 살려 보낸다(ingested:false로 「수집은 못 했다」를 구분).
    if (보관.mdSaved || 보관.originalSaved) {
      // ⚠ docName은 **주지 않는다** — 「지식으로 수집된 문서의 이름」이라는 뜻이라, 실패했는데
      //   이름을 주면 제품 매뉴얼 등록부가 그 이름을 문서로 박아 화면에 「🔍 검색가능」 배지가
      //   붙는다(검토관 2026-08-22 확정). 파일은 남았지만 검색에는 없다.
      return { chunks: 0, savedOriginal: 보관.originalSaved, mdSaved: 보관.mdSaved, ingested: false, 실패사유: 사유 };
    }
    return null;
  }
}

// 보관 결과를 응답에 싣는다 — **요청값이 아니라 실제 저장 여부**를 말하게 하는 자리다.
// tryIngest를 안 타는 갈래(취약점 스캔 반영)는 ing이 null이라 아무 것도 안 실린다 = 「안 남았다」가 정직하게 드러난다.
//
// ⚠ ingested를 **반드시 함께 싣는다**(검토관 2026-08-22 [높음] 확정). 보관(파일)은 됐는데
//   수집(임베딩)은 실패한 상태가 있는데, 그 구분을 응답에서 빼 놓으면 화면이 「내 문서에서
//   보고 고칠 수 있습니다」라고 말한다 — 그 문서는 목록에 없고 열면 404다(문서 메타는
//   ingestText 맨 끝에서 쓰이므로 실패하면 행 자체가 없다). 삼켜진 성공을 살리려다 새 거짓말을
//   만들 뻔한 자리다.
function 보관결과(ing: { savedOriginal?: boolean; mdSaved?: boolean; ingested?: boolean } | null): { savedOriginal?: boolean; mdSaved?: boolean; ingested?: boolean } {
  return ing ? { savedOriginal: !!ing.savedOriginal, mdSaved: !!ing.mdSaved, ingested: !!ing.ingested } : {};
}

// 왜 검색에 안 들어갔나 — **아는 만큼만** 말한다.
//   같은 자리에 임베딩 미기동·추출기 없음·읽을 수 없는 문서가 함께 떨어지는데, 예전엔 전부
//   「임베딩 미기동」이라 단정했다. 틀린 사유를 확신에 차서 말하는 것이 모른다고 하는 것보다 나쁘다.
function 수집보류사유(ing: { 실패사유?: string; mdSaved?: boolean } | null): string {
  const 사유 = ing?.실패사유 ?? "";
  if (/추출 도구가 없습니다|추출 도구가 준비/.test(사유)) return "이 설치본에 문서 추출 도구가 없음";
  if (/글자가 아닌 것 같습니다|읽지 못했습니다/.test(사유)) return "문서를 글자로 읽지 못함";
  if (/fetch|ECONNREFUSED|임베딩|embedding/i.test(사유)) return "임베딩 미기동";
  if (사유) return 사유.slice(0, 40);
  return "사유 미상 — 서버 기록 확인";
}

// 국내 웹취약점 점검 결과보고서(PDF·DOCX 등 서술형)를 규칙 파서로 시도한다.
// 성공(자산·취약점 1건 이상)하면 취약점으로 반영하고, 원문도 RAG에 남겨 근거 조회가 가능하게 한다.
// 실패하면 null을 돌려 호출자가 다음 경로(Nessus HTML → 문서 저장)로 넘어간다.
async function tryWebReport(filename: string, base64: string, uploadedBy?: string, opts?: { keepOriginal?: boolean }): Promise<AutoUploadResult | null> {
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
    const ing = await tryIngest(filename, base64, false, "취약점", uploadedBy, opts);
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
      }${ing?.ingested ? "" : " · 검색수집 보류(임베딩 미기동)"}`,
    });
    return {
      filename,
      routedTo: "vulnscan",
      reason: `국내 웹취약점 점검 보고서 파싱 — ${parsed.notes.join(" · ")}`,
      category: "취약점",
      vulnscan: { hosts: r.hosts, findings: r.findings, uncredentialedHosts: r.uncredentialedHosts },
      memory: ing ? { chunks: ing.chunks, docClass: ing.docClass, category: ing.category } : undefined,
      ...보관결과(ing),
    };
  } catch {
    return null; // 텍스트 추출 실패 등 — 다음 경로로
  }
}

// 사용자가 유형을 지정(결정창)했을 때 그 유형으로 바로 라우팅한다.
// productName: 결정 카드에서 사용자가 확인·수정한 제품명(신규 등록 시에만 반영, 없으면 자동 추천값).
// 라우팅 경로가 업무영역(category)을 이미 아는 경우 그 값을 인입에 그대로 전달한다 —
// 제품 매뉴얼=장비운영, 취약점 리포트=취약점. LLM 분류보다 정확하고 결정적이다.
async function routeByType(filename: string, base64: string, type: UploadType, productName?: string, uploadedBy?: string, opts?: { keepOriginal?: boolean }): Promise<AutoUploadResult> {
  // 보안로그 원본·운영 리포트 → **통합 분석 이벤트**. 제품 1차 목표의 소스 ②③이다.
  // ⚠ 파싱만 하고 끝내지 않는다 — 이벤트로 저장돼야 관제 목록·상관분석에 올라온다.
  if (type === "securitylog" || type === "opsreport") {
    const text = Buffer.from(base64, "base64").toString("utf-8");
    const r = ingestAnalysisFile(filename, text);
    // 원문도 지식베이스에 남긴다 — 취약점 리포트와 같은 대우(챗봇이 근거로 인용할 수 있게).
    const ing = await tryIngest(filename, base64, false, "위협대응", uploadedBy, opts);
    const 종류 = r.kind === "log" ? "보안 로그" : "운영 리포트";
    emitCollaboration({
      from: "scan", to: "orchestrator",
      message: `${filename} → ${종류}로 인입 — 분석 이벤트 ${r.created}건 생성${r.created === 0 ? " (탐지 규칙에 걸린 항목 없음)" : ""}${ing?.ingested ? "" : " · 검색수집 보류(임베딩 미기동)"}`,
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
      ...보관결과(ing),
    };
  }
  if (type === "asset" || type === "log") {
    const ing = await tryIngest(filename, base64, false, "장비운영", uploadedBy, opts);
    const m = importManual(filename, ing?.docName, undefined, type === "log" ? "logManual" : "manual", productName);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안제품 '${m.productName}'에 ${type === "log" ? "로그" : "제품"} 매뉴얼로 등록${m.createdProduct ? " (신규 제품 자동 등록)" : ""}${ing?.ingested ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return { filename, routedTo: "product-manual", reason: `사용자 지정: ${type === "log" ? "로그 매뉴얼" : "보안제품 자산"}`, category: "장비운영", manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct }, ...보관결과(ing) };
  }
  if (type === "vulnreport") {
    // ① 국내 웹취약점 점검 보고서(PDF/DOCX 서술형) — 텍스트를 추출해 규칙 파서로 시도한다.
    //    Nessus 계열이 아니라 예전엔 문서로만 저장돼 자산·취약점이 안 만들어졌다(2026-07-25 사용자 지적).
    const web = await tryWebReport(filename, base64, uploadedBy, opts);
    if (web) return web;
    // ② Nessus 스타일 HTML(호스트/취약점 헤더) 구조로 시도 — 다른 스캐너(Oracle 등) 자체 포맷은
    // 구조가 달라 인식 못 할 수 있다. 그럴 땐 데이터를 잃지 않도록 문서로라도 저장한다(투명하게 사유 표시).
    const textish = Buffer.from(base64, "base64").toString("utf-8");
    const r = importVulnScan(textish, "html", filename);
    if (r.hosts > 0) {
      emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 취약점 스캔으로 등록 — 호스트 ${r.hosts}·finding ${r.findings}건` });
      return { filename, routedTo: "vulnscan", reason: "사용자 지정: 취약점 리포트/로그 (Nessus 스타일 HTML 파싱)", category: "취약점", vulnscan: { hosts: r.hosts, findings: r.findings, uncredentialedHosts: r.uncredentialedHosts } };
    }
    const ing = await tryIngest(filename, base64, false, "취약점", uploadedBy, opts);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 알려진 스캐너 형식(Nessus 등)이 아니라 구조화 파싱 실패 — 문서로 저장${ing?.ingested ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return {
      filename,
      routedTo: "memory",
      reason: "사용자 지정: 취약점 리포트/로그 — 알려진 스캐너 HTML 구조가 아니라 findings로 반영하지 못함, 문서로 저장",
      category: "취약점",
      memory: { chunks: ing?.chunks ?? 0, docClass: "취약점 리포트", category: "취약점" },
      ...보관결과(ing),
    };
  }
  // document / guideline → 장기기억(RAG). guideline은 분류 생략(가이드로 태깅만).
  // 업무영역은 지정하지 않는다 — ingestText가 규칙(→ document는 LLM까지)으로 정한다.
  const ing = await tryIngest(filename, base64, type === "document", undefined, uploadedBy, opts);
  const 유형말 = type === "guideline" ? "가이드라인" : "문서";
  // ⚠ 판정 기준은 `ing`의 존재가 아니라 **`ing?.ingested`**다(검토관 2026-08-22 [높음] 회귀 수리).
  //   보관(.md·원본)을 살려 보내면서 tryIngest가 실패해도 non-null을 돌려주게 됐는데, 여기만
  //   `!ing`로 남아 **임베딩이 죽어도 「검색수집 보류」 경고가 안 뜨게** 됐다 — 콘솔 ＋의 주
  //   경로라 가장 자주 밟는 자리인데, 담당자는 「0청크」라는 숫자만 보고 왜인지 알 수 없었다.
  if (!ing?.ingested) {
    return {
      filename, routedTo: "memory",
      // ⚠ 원인을 **지어내지 않는다** — 아는 사유가 있으면 그것을 말하고, 모르면 모른다고 한다.
      //   예전엔 전부 「임베딩 미기동」이라 단정해, 추출기가 죽은 날에도 담당자가 멀쩡한
      //   임베딩 서버만 들여다보게 만들었다(재검토관 2026-08-22 확정).
      reason: `사용자 지정: ${유형말} · 검색수집 보류(${수집보류사유(ing)})`,
      memory: { chunks: 0, docClass: type === "guideline" ? "가이드라인" : undefined },
      ...보관결과(ing),
    };
  }
  return { filename, routedTo: "memory", reason: `사용자 지정: ${유형말}`, category: ing.category, memory: { chunks: ing.chunks, docClass: type === "guideline" ? "가이드라인" : ing.docClass, linkedProduct: ing.linkedProduct, category: ing.category }, ...보관결과(ing) };
}

export async function autoRouteUpload(
  filename: string,
  base64: string,
  forceType?: UploadType,
  productName?: string,
  uploadedBy?: string,
  opts?: { keepOriginal?: boolean }
): Promise<AutoUploadResult> {
  // 사용자가 결정창에서 유형을 골랐으면 그대로 라우팅(판별 생략).
  if (forceType) return routeByType(filename, base64, forceType, productName, uploadedBy, opts);

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
    const ing = await tryIngest(filename, base64, false, "위협대응", uploadedBy, opts);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안 로그 원본으로 자동 인입 — 분석 이벤트 ${r.created}건${ing?.ingested ? "" : " · 검색수집 보류(임베딩 미기동)"}` });
    return {
      filename, routedTo: "analysis",
      reason: r.created > 0
        ? `보안 로그 원본 감지 — 통합 분석에 ${r.created}건 등록`
        : "보안 로그 원본 감지 — 읽었지만 탐지 규칙에 걸린 항목이 없어 이벤트는 만들지 않았습니다(원문은 저장)",
      category: "위협대응",
      analysis: { kind: r.kind, created: r.created },
      memory: ing ? { chunks: ing.chunks, docClass: "보안 로그", category: ing.category } : undefined,
      ...보관결과(ing),
    };
  }

  // ①-b 국내 웹취약점 점검 결과보고서(PDF/DOCX 서술형) — 제목·[IW-NN] 코드체계로 판별되고
  // 규칙 파서가 취약점을 실제로 뽑아낼 때만 취약점으로 반영한다(못 뽑으면 아래 경로로 계속).
  const webAuto = await tryWebReport(filename, base64, uploadedBy, opts);
  if (webAuto) return webAuto;

  // ② 기존 제품과 확실히 매칭되면(모델/벤더/종류 일치) 자동으로 그 제품 매뉴얼로.
  const c = classifyManual(filename, listProducts());
  if (c.reason !== "new-product") {
    const ing = await tryIngest(filename, base64, false, "장비운영", uploadedBy, opts);
    const m = importManual(filename, ing?.docName);
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 보안제품 '${m.productName}'에 ${m.kind === "logManual" ? "로그" : "제품"} 매뉴얼로 자동 연결` });
    return { filename, routedTo: "product-manual", reason: `기존 제품 매칭(${c.reason})`, category: "장비운영", manual: { productName: m.productName, kind: m.kind, createdProduct: m.createdProduct }, ...보관결과(ing) };
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
      const { filename: rawFilename, content, forceType, productName, keepOriginal } = req.body as {
        filename?: string;
        content?: string;
        forceType?: UploadType;
        productName?: string;
        keepOriginal?: boolean;
      };
      if (!rawFilename || !content) {
        res.status(400).json({ error: "filename과 content(base64)가 필요합니다" });
        return;
      }
      // ⚠ 파일명을 basename으로 접는다 — ingest-file 창구(memory.ts)와 **같은 이유·같은 모양**이다.
      //   경로 구분자가 든 documentId는 추출본 .md가 basename으로만 키잉돼(전체 documentId로 보는
      //   등급 검사와 어긋나) 남의 기밀 .md를 읽거나 덮는 통로가 된다(132f19c6). 그 창구만 막고
      //   이 창구를 열어 두면 같은 구멍이 두 번째 문으로 열린다 — 이번에 추출본 보관을 여기에도
      //   붙이므로 반드시 함께 접는다. 실사용 UI(File.name)엔 경로가 없어 화면 동작은 그대로다.
      //   trim은 그대로 유지한다 — basename만 하면 앞뒤 공백이 documentId에 남는다(예전 동작 보존).
      const filename = path.basename(String(rawFilename).trim());
      if (!filename || filename === "." || filename === "..") {
        res.status(400).json({ error: "쓸 수 있는 파일 이름이 아닙니다" });
        return;
      }
      // ★ **볼 수 없는 문서는 덮어쓸 수도 없다**(검토관 2026-08-22 [높음] 확정).
      //   인입은 같은 documentId면 옛 조각을 지우고 새로 넣으며 추출본 .md도 덮는다. 그런데
      //   등급 칸은 그대로 남는다 — 즉 O등급 사용자가 흔한 이름(「보안점검_결과.pdf」)으로 올리면
      //   기밀(C) 문서의 내용이 조용히 바뀌고 라벨만 C로 남는다. 읽기 창구·쓰기 창구(등급변경·
      //   삭제·추출본 고치기)는 이미 막혀 있었는데 업로드 문만 열려 있어 통제가 우회됐다.
      if (열람불가공용(filename, req)) {
        res.status(403).json({ error: "같은 이름의 문서가 이미 있고, 그 문서를 열람할 권한이 없습니다 — 다른 이름으로 올리세요" });
        return;
      }
      // ⚠ 이 허용 목록은 **UploadType과 반드시 같이 늘려야 한다**(2026-08-01 실측 사고).
      //   유형을 새로 만들고 여기를 안 고치면 forceType이 조용히 버려져 "결정 필요"로 되돌아온다
      //   — 담당자는 골랐는데 아무 일도 안 일어나는 것으로 보인다. 타입에서 뽑아 어긋남을 막는다.
      const ALLOWED: UploadType[] = ["asset", "log", "document", "guideline", "vulnreport", "securitylog", "opsreport"];
      const valid = forceType && ALLOWED.includes(forceType) ? forceType : undefined;
      // 작업 귀속 — 인입되는 문서에 "누가 올렸는지"를 함께 기록한다(2026-07-25 RAG 전면 검토).
      const uploader = (req as Request & { user?: { displayName?: string; username?: string } }).user;
      const result = await autoRouteUpload(filename, content, valid, productName, uploader?.displayName ?? uploader?.username, { keepOriginal: keepOriginal === true });
      // 유형이 확정돼 실제 반영된 업로드만 기록(needsDecision=재질문 단계는 행위가 아직 아님).
      if (!(result as { needsDecision?: boolean }).needsDecision) {
        const user = (req as Request & { user?: { displayName?: string } }).user;
        // ★ 원본이 서버에 남는 것 자체가 감사 대상이다(2026-08-22) — **요청값이 아니라 실제 저장 여부**를 적는다.
        //   유형은 routedTo를 쓴다: 결과에 `type` 필드는 없어서 예전엔 자동 라우팅이 늘 「유형: ?」로 남았다.
        recordAudit({
          kind: "write", actor: user?.displayName ?? null, action: "파일 업로드 자동 분류",
          target: filename,
          detail: `유형: ${valid ?? result.routedTo ?? "?"}${result.savedOriginal ? " · 원본 보관" : ""}`,
          result: "ok",
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
