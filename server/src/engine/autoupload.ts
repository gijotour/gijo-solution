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
import { draftScanInterpretation } from "./scandrafts";
import { ingestAnalysisFile, detectIngestKind } from "./analysishub";
import { importVulnScan, parseNessusHtml } from "./vulnscan";
// ⚠ 보관총량()은 **거르지 않은 전체**라 화면 창구에서 쓰지 않는다(2026-08-22 검토관 [높음]).
//   운영·용량 판단용으로 uploadreceipt.ts에 남아 있고 시험이 지킨다.
import { 영수증남기기, 영수증목록, 되묻기영수증지우기, 갈래이름, type 반입갈래 } from "./uploadreceipt";
import { maskSecrets } from "./secretscan";
import { importManual, classifyManual, listProducts, guessProductName, guessCategory } from "./securityproducts";
// 📦 제품 소개자료 대장 — 보안제품 등록부와 **다른 대장**이다(productintro.ts 머리주석).
import { addProductIntro } from "./productintro";
import { ingestText, GLOBAL_SCOPE, saveDocArtifacts, cleanupOldOriginal, 열람불가공용, 등급판정가능 } from "./memory";

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
// ★ productintro(2026-08-23 사장님) — 도입 **검토 중인 타사** 제품 소개서. "asset"과 다른 대장이다:
//   asset = 우리가 **쓰는** 제품의 매뉴얼 / productintro = 아직 **우리 것이 아닌** 제품의 소개자료.
export type UploadType = "asset" | "log" | "document" | "guideline" | "vulnreport" | "securitylog" | "opsreport" | "sbom" | "productintro";

export interface AutoUploadResult {
  filename: string;
  routedTo: "vulnscan" | "product-manual" | "memory" | "analysis" | "sbom" | "productintro" | "decision"; // decision = 사용자 결정 필요
  reason: string; // 판별 근거(투명성)
  needsDecision?: boolean; // true면 프론트가 결정 카드(4유형)를 띄운다
  guess?: UploadType; // 결정 필요 시 추천 유형(미리 선택)
  guessProductName?: string; // 결정 필요 시 신규 제품명 추천값(사용자가 확인·수정 가능, 필요시 수동입력)
  /** uncredentialedHosts: 비인증(원격) 스캔으로 잡힌 호스트 — 로컬 취약점을 놓칠 수 있어
   *  조치 검증 신뢰도가 떨어진다. 취약점 화면 업로더에만 있던 경고인데, 파일 인입을 대시보드
   *  ＋로 모으면서(2026-07-27) 이 경고까지 사라지면 안 되므로 결과에 함께 싣는다. */
  vulnscan?: { hosts: number; findings: number; uncredentialedHosts?: string[] };
  manual?: { productName: string; kind: string; createdProduct: boolean };
  /** 타사 SBOM 검수 결과 — 카드가 「무엇을 요구받나」를 바로 보여 줄 수 있게 숫자를 함께 싣는다. */
  sbom?: { id: string; name: string; components: number; heavy: number; unknown: number };
  /** 통합 분석 인입 결과 — 로그/리포트 판별과 만들어진 이벤트 수(0건도 정직하게 싣는다). */
  analysis?: { kind: "log" | "report"; created: number };
  /** 📦 제품 소개자료 등록 결과(2026-08-23) — 대장에 **실제로 들어간 것만** 싣는다. */
  productIntro?: { id: string; name: string; category: string; vendor?: string | null };
  /** ★ **AI가 무엇을 읽었나** — 잰 숫자와 앞부분 원문(비밀은 가려서). LLM 요약이 아니다.
   *  사장님 지시(2026-08-23): 올린 그 자리에서 **한 번 보여 주고**, 고치기·삭제는 「내 문서」로 안내.
   *  ⚠ 텍스트 추출을 타는 갈래에만 붙는다 — 취약점 스캔처럼 안 타는 갈래는 없는 것이 정직하다. */
  추출?: { 글자수: number; 미리보기: string };
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
  /** ★ **비밀정보로 보이는 것**(2026-08-22 신설) — 회사 문서 반입에는 이 검사가 **아예 없었다.**
   *  개인 문서는 공유할 때 가리는데 회사 문서는 무검사로 지식이 됐다 — API 키가 든 문서가
   *  그대로 답변 근거로 인용될 수 있었다. 잣대가 어긋나 있던 자리다.
   *  ⚠ **막지 않고 알린다.** 회사 규정 문서에는 예시 키처럼 정당하게 비밀처럼 보이는 것이 있고,
   *    지우면 원문이 훼손된다. 담당자가 보고 판단하도록 **가려진 형태로만** 싣는다. */
  비밀경고?: { kind: string; masked: string }[];
}

/**
 * 타사 **제품 소개서**로 보이는가 — 우리 제품 매뉴얼과 가르는 자물쇠 (2026-08-23).
 *
 * ⚠ **좁게 잡는다.** 자료의 **성격**을 말하는 말만 본다 — 제품 종류(방화벽·EDR…)를 넣으면
 *   진짜 매뉴얼까지 끌고 와 매뉴얼 자동 연결이 조용히 죽는다.
 * ⚠ 낱말 경계(\b)를 쓰지 않는다 — 자바스크립트에서 밑줄·한글 경계가 기대대로 안 걸린다
 *   (같은 함정을 SBOM 판별이 실측으로 겪었다 — guessType 주석 참고).
 */
function 제품소개서인가(filename: string): boolean {
  return /제품\s*소개|소개\s*서|소개자료|브로슈어|brochure|datasheet|data\s*sheet|product\s*overview|제품\s*설명\s*서/i.test(filename);
}
// 파일명으로 애매할 때의 추천 유형. 취약점 리포트·로그·가이드라인·매뉴얼 신호를 순서대로 본다.
function guessType(filename: string): UploadType {
  // 타사 SBOM(부품표) — **파일 이름 신호**를 먼저 본다(2026-08-22 검토관 [중]).
  //   ⚠ 이 줄이 없으면 `제품A_SBOM.json`·`bom.cyclonedx.json`·`x.spdx.json`이 전부
  //     「일반 문서」로 추천돼, 담당자가 **매번 손으로 유형을 골라야** 한다.
  //     추천이 틀리면 결정 카드에서 고치면 되지만, 추천이 아예 없으면 그 기능이 있는 줄도 모른다.
  //   ⚠ 취약점보다 먼저 본다 — `SBOM_취약점_리포트.json` 같은 이름에서 부품표가 먼저다.
  //     (진짜 취약점 스캔 결과는 아래 looksLikeVulnJson이 내용으로 다시 가른다.)
  //   ⚠ `\b`를 쓰면 **밑줄에서 안 걸린다** — `제품A_SBOM.json`이 실측에서 「일반 문서」로 갔다.
  //     자바스크립트에서 `_`는 낱말 문자라 `\bsbom`이 `_SBOM` 앞에서 경계를 못 찾는다.
  //     그래서 경계를 직접 적는다(문자열 시작·끝 또는 영숫자가 아닌 것).
  if (/(^|[^a-z0-9])sbom([^a-z0-9]|$)|부품표|cyclonedx|\.spdx([^a-z0-9]|$)|spdx[-_.]?json|bill\s*of\s*materials/i.test(filename)) return "sbom";
  // 📦 제품 소개자료 — **매뉴얼보다 먼저** 본다(「방화벽 제품소개」는 소개서지 매뉴얼이 아니다).
  if (제품소개서인가(filename)) return "productintro";
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
): Promise<{ chunks: number; docClass?: string; linkedProduct?: string; docName?: string; category?: string; savedOriginal?: boolean; mdSaved?: boolean; ingested: boolean; 실패사유?: string; 비밀경고?: { kind: string; masked: string }[]; 추출?: { 글자수: number; 미리보기: string } } | null> {
  // ★★ **AI가 무엇을 읽었는지 한 번 보여 준다** (2026-08-23 사장님 지시
  //   「자료를 올리면 추출한 텍스트에 대한 요약 데이터를 한번 보여주고,
  //     수정 및 삭제는 내 문서에서 가능하다고 알려주는 게 좋을 것 같아」).
  //
  // ■ 왜 필요한가 — 사장님이 pptx를 올렸는데 **무엇이 읽혔는지 볼 길이 없었다.**
  //   추출본(.md) 뷰어는 「내 문서」에 있지만, 올린 **그 순간**에는 아무 것도 안 보여 줘서
  //   「제대로 읽혔나」를 알 수 없었다. 반입의 첫 관문이 그 물음이다.
  //
  // ⚠ **LLM 요약을 쓰지 않는다.** 이 저장소 원칙이 「지어내지 않는다」이고, 요약은
  //   **틀릴 수 있는데 틀린 줄 모른다.** 여기서 보여 줄 것은 「AI가 실제로 읽은 글」이지
  //   「그 글에 대한 해석」이 아니다. 그래서 **잰 숫자 + 앞부분 원문 그대로**만 싣는다.
  //   (문서 세 줄 요약은 docdigest가 따로 만든다 — 그건 백그라운드라 이 시점에 없다.)
  // ⚠ 미리보기는 **가려서** 싣는다 — 비밀정보가 앞부분에 있으면 그대로 나간다.
  const 추출요약 = (t: string): { 글자수: number; 미리보기: string } => {
    const 한줄 = maskSecrets(t).text.replace(/\s+/g, " ").trim();
    return { 글자수: t.length, 미리보기: 한줄.slice(0, 300) + (한줄.length > 300 ? "…" : "") };
  };

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
    // ★★ **비밀정보 검사 — 회사 문서 반입에는 이게 아예 없었다**(2026-08-22 설계관 적발).
    //   개인 문서는 **공유할 때** 가리는데(personaldocs.ts) 회사 문서는 아무 검사도 없이 지식이 됐다.
    //   즉 API 키가 든 문서를 올리면 그대로 **답변 근거로 인용**된다 — 잣대가 어긋나 있었다.
    //   ⚠ **막지 않는다.** 이 저장소 원칙은 「막지 않고 알린다」이고, 회사 규정 문서에는
    //     예시 키처럼 **정당하게 비밀처럼 보이는 것**이 들어 있을 수 있다. 지우면 원문이 훼손된다.
    //   ⚠ **maskSecrets를 쓴다(findSecrets가 아니다)** — 밖으로 나가는 자리에 원본 값을 실으면
    //     경고하려다 유출하는 셈이다(2026-07-31 시험이 잡은 계보 그대로).
    const 비밀 = maskSecrets(text).hits.map((h) => ({ kind: h.kind, masked: h.masked }));
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
      비밀경고: 비밀.length ? 비밀 : undefined,
      추출: 추출요약(text),
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
/** 어디로 갔는지에서 갈래를 되짚는다 — **자동 판별 갈래에는 유형 값이 없다.**
 *  `forceType`은 사람이 고를 때만, `guess`는 되물을 때만 채워진다. 그래서 자동으로 처리된
 *  취약점 스캔·로그는 유형 칸이 비는데, **어디로 갔는지는 알고 있다.**
 *  ⚠ 모르는 척하지 않는다 — 영수증에 「미정」이 뜨면 담당자는 제품이 판별에 실패한 줄 안다. */
function 갈래되짚기(routedTo?: string): 반입갈래 {
  switch (routedTo) {
    case "vulnscan": return "vulnreport";
    case "analysis": return "securitylog";     // 로그·리포트 공통 입구 — 더 좁히려면 analysis.kind가 필요하다
    case "sbom": return "sbom";
    case "product-manual": return "asset";
    case "productintro": return "productintro";
    case "memory": return "document";
    default: return "unknown";                 // decision(되묻는 중)만 진짜로 모른다
  }
}

function 보관결과(ing: {
  savedOriginal?: boolean; mdSaved?: boolean; ingested?: boolean;
  비밀경고?: { kind: string; masked: string }[];
} | null): { savedOriginal?: boolean; mdSaved?: boolean; ingested?: boolean; 비밀경고?: { kind: string; masked: string }[] } {
  // ⚠ 비밀경고를 여기서 함께 나른다 — 이 함수를 지나는 갈래가 여럿이라(문서·매뉴얼·리포트)
  //   한 곳에서 실어야 갈래마다 빠뜨리지 않는다.
  return ing
    ? {
        savedOriginal: !!ing.savedOriginal, mdSaved: !!ing.mdSaved, ingested: !!ing.ingested,
        ...(ing.비밀경고?.length ? { 비밀경고: ing.비밀경고 } : {}),
      }
    : {};
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
    // 스캔 팀원의 부르는 문(2026-09-03, 계획서 §7 2단계) — 등록 결과를 위협 관점의 정형 초안으로 해석해 남긴다.
    //   규칙 파서의 등록은 그대로다(LLM이 대신하지 않는다). 반입 응답을 기다리게 하지 않는다 — 뒤에서 만들고 협업 창에 남긴다.
    //   ⚠ 이 경로(웹취약점 보고서)에서만 부른다 — 자동 갈래는 보고서라는 신호가 없어 초안을 만들 근거가 없다(설계관).
    void draftScanInterpretation({
      source: filename, hosts: r.hosts, findings: r.findings,
      vulns: parsed.vulns.map((v) => ({ code: v.pluginId, name: v.name, risk: v.risk, host: v.host })),
    });
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
  // ── 타사 SBOM(부품표) 검수 — 2026-08-22, 계획서 중-7 확장 ─────────────────────
  //
  // ⚠ **tryIngest를 부르지 않는다.** SBOM은 수천 줄 JSON이라 조각내 지식 저장소에 넣으면
  //   다른 질문의 근거를 밀어낸다(스키마 551조각으로 실제로 겪었다). 읽을 글이 아니라
  //   **점검할 자료**다 — 취약점 자동 반영 갈래가 이미 같은 모양으로 되어 있다.
  if (type === "sbom") {
    const { sbom검수 } = await import("./sbomreview.js");
    const 내용 = Buffer.from(base64, "base64").toString("utf-8");
    const r = sbom검수({ 파일이름: filename, 내용, 검수자: uploadedBy });
    if (!r.ok) {
      // 못 읽었으면 **왜 못 읽었는지** 그대로 말한다 — 「실패」 한 마디로 끝내지 않는다.
      return {
        filename, routedTo: "sbom",
        reason: `사용자 지정: 타사 SBOM — ${r.사유}${r.알림.length ? " (" + r.알림[0] + ")" : ""}`,
        category: "일반",
      };
    }
    const s = r.결과.summary;
    const 무거움 = (s.서비스도공개 ?? 0) + (s.전체소스공개 ?? 0);
    emitCollaboration({
      from: "scan", to: "orchestrator",
      message: `${filename} → 타사 SBOM 검수 — 부품 ${r.결과.componentCount}개 · ` +
        (무거움 ? `**소스 공개 요구 ${무거움}건**` : "소스 공개 요구 없음") +
        (s.판정불가 ? ` · 라이선스 모름 ${s.판정불가}건` : ""),
    });
    return {
      filename, routedTo: "sbom",
      reason: `사용자 지정: 타사 SBOM(${r.결과.format}) — 부품 ${r.결과.componentCount}개 검수` +
        (무거움 ? ` · 소스 공개를 요구받을 수 있는 부품 ${무거움}건` : " · 소스 공개 요구 없음") +
        (s.판정불가 ? ` · 라이선스 모름 ${s.판정불가}건` : "") +
        // ⚠ **못 읽은 것을 여기서도 말한다**(2026-08-22 실측으로 발견). 화면에는 적히는데
        //   인입 답에는 안 나와서, 대화창만 보는 담당자는 「부품 1개 검수」만 보고 **다 셌다고 읽는다**
        //   — 실제로는 그 안에 부품 2개가 더 있었다(중첩). 「다 셌다」가 사실이 아닐 때 그렇게
        //   말하는 것이 이 기능의 값어치다.
        // ⚠⚠ **notes[0]만 보이면 안 된다**(2026-09-01 재검토 [중]). 중첩 안내(「펴서 셌습니다」)가
        //   먼저 들어가면서 **「못 읽었습니다」 경고를 밀어냈다** — 하필 그게 「다 안 셌다」를
        //   알리는 유일한 문장이었다. 알림 하나만 보여 주는 구조 자체가 이 사고를 만든다.
        //   → **못 읽은 것을 먼저** 보여 주고, 나머지는 뒤에 붙인다(있으면 몇 개 더 있다고 말한다).
        (() => {
          const ns = r.결과.notes ?? [];
          if (!ns.length) return "";
          const 급한것 = ns.filter((x) => /못 읽었|세지 못|비어 있|안 셌/.test(x));
          const 순서 = [...급한것, ...ns.filter((x) => !급한것.includes(x))];
          return ` ⚠ ${순서[0]}` + (순서.length > 1 ? ` (알림 ${순서.length - 1}건 더 — 검수 화면에서 봅니다)` : "");
        })(),
      category: "일반",
      sbom: { id: r.결과.id, name: r.결과.name, components: r.결과.componentCount, heavy: 무거움, unknown: s.판정불가 ?? 0 },
    };
  }
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
  // ★★ 📦 제품 소개자료 — 도입 **검토 중인 타사** 제품 (2026-08-23 사장님 지시)
  //
  // ■ 왜 이 갈래가 필요했나 — 결재판 유형에 이것이 없어서, 사장님이 제품 소개 pptx를 올렸을 때
  //   「📄 일반 문서」밖에 고를 수 없었고 대장에는 0건이 남았다. 그런데 화면은
  //   「대화창 ＋로 제품 소개서를 올리면 등록됩니다」라고 **약속하고 있었다.** 그 약속을 참으로 만든다.
  //
  // ⚠ `asset`과 다른 대장이다 — 섞으면 「운영 중」과 「검토 중」을 구분 못 하게 된다
  //   (productintro.ts 머리주석이 그 이유를 적어 두었다).
  // ★★ **지식 저장소에 넣지 않는다** (2026-08-23 사장님 결정
  //   「소개자료는 원본보관과 제품비교용이랑 깊은학습은 아닌 것 같아」).
  //
  //   왜 옳은가 — 소개자료는 **남의 회사 홍보 문서**다. 통째로 지식에 넣으면
  //   「우리 보안 정책은?」 같은 질문에 **벤더 마케팅 문구가 근거로 섞인다.**
  //   이 저장소는 이미 그 사고를 겪었다(타사 문서 53%가 근거 배지를 흔들었다).
  //   ⚠ 타사 SBOM이 **같은 이유로** 지식에 안 들어간다 — 그 선례를 그대로 따른다.
  //
  //   대신 남기는 것: **원본**(브로슈어를 그대로 다시 열 수 있게) + **추출본(.md)**
  //   (무엇이 적혀 있는지 사람이 읽고 비교할 수 있게) + **대장 한 줄**(무엇을 검토 중인가).
  //   ⚠ 원본 보관은 **강제로 켠다** — 프라이버시 기본값(꺼짐)의 예외다.
  //     소개자료는 개인정보가 아니라 벤더가 배포한 자료이고, 비교의 근거가 되려면
  //     「그때 받은 그 파일」이 남아야 한다.
  //
  // ⚠ 분류는 **이미 있는 잣대**를 쓴다(`guessCategory` — 보안제품 등록부와 같은 닫힌 목록).
  //   여기서 새 분류 규칙을 만들면 같은 축에 잣대가 두 벌이 된다(설계관 지적 ③).
  // ⚠ 제조사·요약은 **비운다** — 파일에서 확실히 얻을 길이 없다. 지어내지 않는다.
  if (type === "productintro") {
    const 이름 = (productName ?? "").trim() || guessProductName(filename) || filename.replace(/\.[^.]+$/, "");
    let 보관: { mdSaved: boolean; originalSaved: boolean } = { mdSaved: false, originalSaved: false };
    let 추출: { 글자수: number; 미리보기: string } | undefined;
    let 비밀: { kind: string; masked: string }[] = [];
    let 추출실패: string | undefined;
    try {
      const { extractDocumentText } = await import("./dataset.js");
      const text = await extractDocumentText(filename, base64);
      if (text.trim()) {
        비밀 = maskSecrets(text).hits.map((h) => ({ kind: h.kind, masked: h.masked }));
        const 한줄 = maskSecrets(text).text.replace(/\s+/g, " ").trim();
        추출 = { 글자수: text.length, 미리보기: 한줄.slice(0, 300) + (한줄.length > 300 ? "…" : "") };
        // ⚠ keepOriginal을 **요청값과 무관하게 true**로 준다(위 결정).
        보관 = await saveDocArtifacts({ documentId: filename, text, contentBase64: base64, keepOriginal: true });
      } else {
        추출실패 = "글자를 뽑지 못했습니다(그림만 있는 자료일 수 있습니다)";
      }
    } catch (e) {
      // 추출이 안 돼도 **대장 등록은 계속한다** — 「무엇을 검토 중인가」는 여전히 사실이다.
      추출실패 = e instanceof Error ? e.message : String(e);
    }
    let pi: { id: string; name: string; category: string; vendor: string | null };
    try {
      const p = addProductIntro({
        name: 이름,
        category: guessCategory(filename) ?? "기타",
        // ⚠ docName은 「지식 저장소에 올린 것」을 뜻하는 칸이다. 우리는 지식에 안 넣으므로
        //   **비운다** — 채우면 비교가 있지도 않은 검색 근거를 찾으러 간다.
        actor: uploadedBy ?? null,
      });
      pi = { id: p.id, name: p.name, category: p.category, vendor: p.vendor };
    } catch (e) {
      // 등록 실패를 삼키지 않는다 — 「올렸는데 대장에 없다」가 조용히 생기면 안 된다.
      return {
        filename, routedTo: "productintro",
        reason: `제품 소개자료 등록에 실패했습니다 — ${e instanceof Error ? e.message : String(e)}`,
        savedOriginal: 보관.originalSaved, mdSaved: 보관.mdSaved, ingested: false,
        추출, 비밀경고: 비밀.length ? 비밀 : undefined,
      };
    }
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 📦 제품 소개자료 '${pi.name}' 등록(원본 보관 · 지식에는 넣지 않음)` });
    return {
      filename, routedTo: "productintro",
      reason: `사용자 지정: 제품 소개자료 — 「${pi.name}」을 검토 대장에 등록했습니다` +
        (추출실패 ? ` (⚠ ${추출실패})` : "") +
        " · **지식 저장소에는 넣지 않습니다** — 남의 홍보 문구가 답변 근거로 섞이지 않게 합니다",
      productIntro: pi,
      // ⚠ `ingested: false`가 사실이다 — 「AI지식」 배지가 붙으면 안 된다.
      savedOriginal: 보관.originalSaved, mdSaved: 보관.mdSaved, ingested: false,
      추출, 비밀경고: 비밀.length ? 비밀 : undefined,
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

  // ★★ ①′ **타사 제품 소개서는 매뉴얼 매칭보다 먼저 가른다** (2026-08-23 설계관 지적 A).
  //
  // ⚠ 왜 여기인가 — 아래 ②(`classifyManual`)가 **먼저 돌면** 「Fortinet_방화벽_제품소개.pdf」처럼
  //   파일명에 제품 종류가 든 타사 브로슈어가, 그 종류의 등록 제품이 하나뿐일 때
  //   `category-single`로 **묻지도 않고** 우리 제품의 **매뉴얼로 등록된다.**
  //   도입 **검토 중인 남의 제품** 자료가 **우리가 운영 중인 제품의 설명서**로 둔갑하는 것이라,
  //   두 대장을 일부러 갈라 놓은 뜻(productintro.ts 머리주석)이 통째로 무너진다.
  //   ⚠ 이건 이번 변경이 만든 결함이 아니라 **원래 있던 길**이다 — 새 유형을 넣으며 함께 막는다.
  //
  // ⚠ **좁게 잡는다.** 「제품소개·소개서·브로슈어·datasheet」처럼 **자료의 성격을 말하는 말**만 본다.
  //   넓히면 매뉴얼 자동 연결(그 자체로 값이 있는 기능)이 조용히 죽는다.
  //   여기서 확정하지 않고 **되묻는다** — 제품명·분류를 사람에게 받아야 대장이 쓸모가 있다.
  if (제품소개서인가(filename)) {
    emitCollaboration({ from: "scan", to: "orchestrator", message: `${filename} → 타사 제품 소개자료로 보여 유형을 되묻는다` });
    return {
      filename,
      routedTo: "decision",
      needsDecision: true,
      guess: "productintro",
      guessProductName: guessProductName(filename),
      reason: "파일명이 제품 소개자료를 가리킴 — 우리 제품 매뉴얼과 갈라야 해서 되묻습니다",
    };
  }

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
    // ⚠ 제품명을 되묻는 유형이 늘면 **여기와 console.js의 PRODUCT_NAME_TYPES를 함께** 고쳐야 한다
    //   (설계관 지적 B: 한쪽만 고치면 입력칸이 아예 안 뜬다).
    guessProductName: guess === "asset" || guess === "log" || guess === "productintro" ? guessProductName(filename) : undefined,
    reason: "파일명으로 유형을 확신하기 어려움 — 사용자 결정 필요",
  };
}

export function registerAutoUploadRoutes(app: Express): void {
  // ★ **반입 영수증**(2026-08-22 사장님 「사용자가 넣는 파일 내문서에서 다 확인 가능해야 해」).
  //   내 문서의 🩹 반입 탭이 지금은 `/api/memory/documents`를 쓰는데, 그 목록은
  //   **지식 조각이 있는 문서만** 준다. 취약점·SBOM은 일부러 지식에 안 넣으므로 거기 안 뜬다.
  //   이 창구가 그 빈자리를 메운다 — 갈래와 무관하게 **넣은 사실은 전부** 여기 있다.
  //
  // ★★ 등급·소유자를 **반드시 건다** (2026-08-22 게시 전 검토관 [높음] 수리).
  //   ⚠ 처음엔 여기에 「개인 격리·등급은 걸지 않는다: 영수증은 사실이지 내용이 아니다」라고
  //     적어 두었다. **그 판단이 틀렸다.** 파일명 자체가 내용이다 —
  //     `gradeblock.test:169`가 이미 그렇게 못 박아 두었다:
  //       「★ 제목도 가린다 — "퇴사자명단_최종.xlsx"는 열어 보지 않아도 알려 준다」
  //     게다가 이 탭은 **그전에 `/api/memory/documents`(등급 필터를 지난 목록)를 쓰고 있었다.**
  //     원천을 갈아타면서 잣대를 떨어뜨린 것이라, 새로 연 구멍이다.
  //
  //   잣대 네 겹(순서대로 — 2026-08-22 2라운드 검토관 [높음]으로 ③이 더해졌다):
  //     ① **내가 올린 것**은 언제나 보인다 — `uploadedById`(바뀌지 않는 id)로 가른다.
  //        ⚠ 표시 이름(uploadedBy)으로 가르지 않는다: 동명이인·개명에서 어긋난다.
  //          같은 날 오전 basename 키잉으로 기밀이 샌 것과 같은 부류다.
  //     ② **관리자**는 팀 반입을 본다(감사·운영). 등급은 그대로 건다.
  //     ③ ★ **판정할 근거가 없으면 감춘다.** 문서 메타 행이 없는 갈래(되묻는 중·SBOM·
  //        취약점 스캔·수집 실패)는 등급을 매길 자리 자체가 없다 — 여기서 「없으니 통과」로
  //        두면 그게 fail-open이다.
  //     ④ **남의 것**(과 id가 없는 옛 줄)은 등급 검사를 지나야 보인다 —
  //        `열람불가공용` **단일 잣대**를 그대로 부른다(사본을 만들지 않는다).
  //        ⚠ 「영수증의 filename이 곧 documentId다」는 **문서 갈래에만 참**이다 —
  //          전칭으로 적었던 첫 주석이 바로 위 ③의 구멍을 못 보게 했다.
  app.get("/api/upload/receipts", authMiddleware, (req, res) => {
    const 상한 = Math.min(1000, Math.max(1, Number((req.query.limit as string) ?? 300) || 300));
    const me = (req as Request & { user?: { id?: string | number; username?: string; role?: string } }).user;
    const 내id = me?.id != null ? String(me.id) : (me?.username ?? null);
    const 관리자 = me?.role === "admin";
    const r = 영수증목록(상한, (row) => {
      // ① 내가 올린 것 — 언제나 보인다.
      if (내id && row.uploadedById && row.uploadedById === 내id) return true;
      // ② 관리자 — 팀이 무엇을 넣었는지 **전부** 본다(감사·운영).
      //   ⚠⚠ 2026-08-22 3라운드 검토관 [중]: 여기 「등급은 그대로 건다」라고 적어 두었는데
      //     **그 말이 이 갈래에서 공허하다.** 이 분기는 ③(판정 근거 확인)을 건너뛰므로,
      //     등급을 매길 행이 없는 줄(되묻는 중·SBOM·취약점 스캔)은 관리자에게 그대로 보인다.
      //     즉 이 분기의 실질은 **「관리자는 전부 본다」** 하나다.
      //   ▶ 그래서 **의도를 코드가 말하게** 바꾼다: 등급 검사를 하는 척하지 않고 true를 준다.
      //     이것이 의도인 근거: 이 탭은 「누가 언제 무엇을 올렸나」의 **감사 창구**이고,
      //     관리자는 어차피 자기 clearance를 올릴 수 있다(users.ts — 그 길은 감사에 남는다).
      //     감사하는 사람이 못 보는 감사 창구는 뜻이 없다.
      //   ⚠ **일반 사용자에게는 절대 이 길을 열지 않는다** — 아래 ③④가 그것을 지킨다.
      if (관리자) return true;
      // ③ ★★ **판정할 근거가 없으면 감춘다** (2026-08-22 2라운드 검토관 [높음] 수리).
      //    `열람불가공용`은 문서 메타 행이 없으면 false(=열어 준다)를 준다 — 문서 라우트에선
      //    옳지만 **여기서는 fail-open**이다. 되묻는 중(decision)·SBOM·취약점 스캔·수집 실패는
      //    애초에 문서 행이 없어, 남의 「퇴사자명단_최종.xlsx」가 그대로 보였다.
      //    ⚠ 내가 게이트를 넣고도 이 갈래를 놓쳤다. 그래서 **막힘이 아니라 판정 가능함을 먼저** 묻는다.
      if (!등급판정가능(row.filename)) return false;
      // ④ 판정할 수 있으면 단일 잣대에 맡긴다.
      return !열람불가공용(row.filename, req);
    });
    res.json({
      // ★ **「내 것인가」를 서버가 표시해 준다** (2026-08-22 3라운드 [중] 수리의 짝).
      //   목록에 남의 반입이 섞여 오므로 화면이 그걸 구분해 보여야 하는데, 클라는
      //   자기 id를 모른다. 여기서 한 칸을 더해 주면 화면이 **열을 늘리지 않고** 표시할 수 있다
      //   (400px 목록에 6칸을 넣었더니 파일명 칸이 0px로 접혔다 — 그 수리의 대체안이다).
      목록: r.목록.map((x) => ({ ...x, 내것: !!(내id && x.uploadedById && x.uploadedById === 내id) })),
      // ⚠ 「거른 뒤의」 총계를 준다. 안 그러면 못 보는 것까지 세어 숫자가 거짓이 된다.
      총량: { 건수: r.건수, 전체바이트: r.전체바이트, 원본보관바이트: r.원본보관바이트 },
      갈래이름,
    });
  });

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
      const ALLOWED: UploadType[] = ["asset", "log", "document", "guideline", "vulnreport", "securitylog", "opsreport", "sbom", "productintro"];
      const valid = forceType && ALLOWED.includes(forceType) ? forceType : undefined;
      // 작업 귀속 — 인입되는 문서에 "누가 올렸는지"를 함께 기록한다(2026-07-25 RAG 전면 검토).
      const uploader = (req as Request & { user?: { displayName?: string; username?: string } }).user;
      const result = await autoRouteUpload(filename, content, valid, productName, uploader?.displayName ?? uploader?.username, { keepOriginal: keepOriginal === true });
      const 되묻는중 = !!(result as { needsDecision?: boolean }).needsDecision;
      // ⚠ id도 함께 읽는다 — 영수증의 「내 것인가」는 **표시 이름이 아니라 id**로 가른다
      //   (2026-08-22 검토관 [높음]. 이름으로 가르면 동명이인·개명에서 어긋난다).
      const user = (req as Request & { user?: { displayName?: string; id?: string | number; username?: string } }).user;
      // 유형이 확정돼 실제 반영된 업로드만 감사에 기록(needsDecision=재질문 단계는 행위가 아직 아님).
      if (!되묻는중) {
        // ★ 원본이 서버에 남는 것 자체가 감사 대상이다(2026-08-22) — **요청값이 아니라 실제 저장 여부**를 적는다.
        //   유형은 routedTo를 쓴다: 결과에 `type` 필드는 없어서 예전엔 자동 라우팅이 늘 「유형: ?」로 남았다.
        //   ⚠ **누가 정했는지도 적는다**(2026-08-22 설계관) — 그전엔 `valid ?? routedTo`라
        //     사람이 고른 것과 제품이 판별한 것이 **글자로만 우연히** 갈렸다.
        //     「이 문서를 사내규정으로 분류한 것은 누구인가」에 답할 수 있어야 한다.
        recordAudit({
          kind: "write", actor: user?.displayName ?? null, action: "파일 업로드 자동 분류",
          target: filename,
          detail: `유형: ${valid ?? result.routedTo ?? "?"}(${valid ? "사람 지정" : "자동 판별"})` +
            `${result.category ? ` · 영역: ${result.category}` : ""}` +
            `${result.savedOriginal ? " · 원본 보관" : ""}`,
          result: "ok",
        });
      }

      // ★★ **반입 영수증** — 사장님 「사용자가 넣는 파일 내문서에서 다 확인 가능해야 해. 취약점파일도」
      //   ⚠ **되묻는 중에도 남긴다.** 그게 이 기능의 절반이다 —
      //     그전엔 결정 카드를 무시하면 **감사에도 아무 데도 안 남아**, 파일을 올린 사실 자체가 사라졌다.
      //     「물었는데 답을 안 했다」도 사실이므로 기록으로 남는다(routedTo="decision").
      // ★ 되묻기 줄 정리(2026-08-22 검토관 [중]) — 답이 왔으면 **물음 줄을 지우고** 확정 줄만 남긴다.
      //   사람의 행위는 한 번인데 영수증이 두 줄이면, 앞 줄은 영영 「되묻는 중」으로 남아
      //   미처리 파일이 있는 것처럼 보인다.
      //   ⚠ 파일명이 아니라 **클라가 돌려준 그 영수증의 id**로 짝을 찾는다(이름 키잉 금지).
      //     ★ 단, 지우는 문에는 **filename도 함께** 건다(2라운드 [중]) — id만 믿으면
      //       무관한 업로드로 내 다른 파일의 물음 줄을 지울 수 있다.
      //   ⚠ 지우기가 실패해도 반입은 계속한다 — 정리는 부가 가치이지 전제가 아니다.
      const 지울영수증 = typeof (req.body as { replacesReceiptId?: unknown })?.replacesReceiptId === "string"
        ? String((req.body as { replacesReceiptId?: string }).replacesReceiptId)
        : undefined;
      let 영수증id: string | null = null;
      try {
        영수증id = 영수증남기기({
          filename,
          uploadedBy: user?.displayName ?? undefined,
          uploadedById: user?.id != null ? String(user.id) : (user?.username ?? undefined),
          // ⚠ 갈래를 「미정」으로 두지 않는다(2026-08-22 실측으로 잡음). 자동 판별 갈래는
          //   `valid`(사람 지정)도 `guess`(되물을 때만)도 없어서 **아는데도 「미정」**이 나왔다.
          //   어디로 갔는지는 아니까 거기서 되짚는다 — 모르는 척하는 것이 이 저장소의 반대 원칙이다.
          kind: (valid ?? (result as { guess?: UploadType }).guess ?? 갈래되짚기(result.routedTo)) as 반입갈래,
          routedTo: result.routedTo ?? "unknown",
          decidedBy: valid ? "user" : "auto",
          category: result.category,
          originalSaved: !!result.savedOriginal,
          mdSaved: !!result.mdSaved,
          ingested: !!result.ingested,
          // base64 길이에서 실제 바이트를 되짚는다(4글자 = 3바이트, 꼬리 `=`만큼 뺀다).
          bytes: Math.max(0, Math.floor((content.length * 3) / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0)),
          detail: 되묻는중 ? "유형을 되물었습니다 — 아직 반영되지 않았습니다" : result.reason,
          note: 되묻는중 ? "사람이 유형을 고르면 그때 반영됩니다" : undefined,
        });
      } catch { /* 영수증은 부가 기록이다 — 실패해도 반입을 막지 않는다(uploadreceipt가 이미 삼키지만 이중 방어) */ }
      // ★★ 물음 줄은 **새 줄이 실제로 생긴 뒤에** 지운다 (2026-08-22 2라운드 검토관 [중]).
      //   그전엔 지우기가 넣기보다 **먼저** 돌았다. 넣기가 실패하면(디스크 가득·IO 오류)
      //   두 실패가 모두 조용히 삼켜져 **옛 줄도 새 줄도 없는 상태**가 된다 —
      //   이 표가 막으려던 「올린 사실 자체가 사라진다」로 정확히 되돌아간다.
      //   트랜잭션으로 묶지 않는 이유: 영수증은 반입을 막으면 안 되는 부가 기록이라
      //   실패해도 본체가 굴러가야 한다. 순서만 뒤집으면 **최악이 「두 줄」**이 된다 —
      //   두 줄은 보기 싫을 뿐이고, 0줄은 기록이 사라지는 것이다. 나쁜 쪽을 고르지 않는다.
      if (지울영수증 && !되묻는중 && 영수증id) {
        되묻기영수증지우기(지울영수증, filename, user?.id != null ? String(user.id) : (user?.username ?? undefined));
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
        // ⚠ 문구는 **실측으로 되는 것만** 적는다(이 표의 규칙) — 아래 둘은 도구·화면이 실제로 있다.
        sbom: ["SBOM 검수 결과 알려줘", "소스 공개 요구받는 부품 뭐 있어?"],
      };
      // ⚠ **못 읽은 SBOM에는 칩을 안 붙인다**(2026-08-22 검토관 [중]). 붙이면 「SBOM 검수
      //   결과 알려줘」가 **딴 검수**(가장 최근의 다른 건)를 보여 주거나 「없습니다」라고 한다 —
      //   방금 실패한 그 파일에 대한 답이 아니다. 실패는 실패라고만 말한다.
      const sbom실패 = routed === "sbom" && !(result as { sbom?: unknown }).sbom;
      const nextChips = routed && !sbom실패 ? 반입칩[routed] : undefined;
      // ★ 영수증 id를 함께 준다 — 되묻기 카드가 답할 때 **그 줄을 지목**해 돌려주기 위해서다
      //   (파일명으로 짝을 찾으면 같은 이름의 다른 파일을 지운다). null이면 클라가 안 보낸다.
      res.json({ ...result, ...(nextChips ? { nextChips } : {}), ...(영수증id ? { receiptId: 영수증id } : {}) });
    })
  );
}
