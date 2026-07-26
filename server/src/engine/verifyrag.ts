// engine/verifyrag.ts — 조치 검증에 사내 문서 근거를 붙인다 (계획서 Phase 3)
//
// RAG를 쓰는 자리는 딱 셋이다. 그 밖에는 쓰지 않는다:
//  ① 장비별 확인 방법 — "SECUI MF2·TrusGuard는 웹 콘솔 어느 메뉴에서 보나" 같은 국내 장비 지식은
//     사내 문서에만 있다. 글로벌 스캐너가 못 가지는 영역이라 이게 차별점이다.
//  ② 보상통제 근거 — "이 취약점은 IPS 시그니처로 차단 중" 같은 정보는 CVE DB에 없다.
//     남들은 "고쳐졌나"만 답하지만 우리는 "안 고쳐도 되나"까지 답한다.
//  ③ 사내 조치 기준 — "폐쇄망 자산은 P2로 강등" 같은 우리 회사 규칙.
//
// ⚠ 절대 하지 않는 것: **버전 비교를 RAG/LLM에 맡기지 않는다.**
//   판정은 versioncmp(순수 함수)가 하고, 여기서는 사람이 판단할 근거만 모아 온다.
//
// ⚠ 이 모듈의 두 번째 원칙: **근거는 제안이지 결론이 아니다.**
//   보상통제 문서를 찾았다고 자동으로 반려(not_affected) 처리하지 않는다. 화면에 근거를 띄우고
//   "반려 후보"라고 알릴 뿐, 확정은 사람이 한다. 문서 한 줄로 취약점이 자동으로 닫히면
//   그 자체가 사고 경로가 된다.

import { queryMemoryScored, RAG_RELEVANCE_MAX_DISTANCE, type ScoredChunk } from "./memory";
import type { VerifyOutcome } from "./verifyengine";

export interface RagBasis {
  kind: "device_howto" | "compensating" | "internal_rule";
  label: string;      // 화면에 보일 한 줄
  excerpt: string;    // 근거 발췌(문서 원문 일부)
  documentId: string; // 출처 — 담당자가 원문을 찾아갈 수 있게
}

/** 근거를 못 찾았을 때 "어떤 문서가 있으면 판단할 수 있는지" 알려준다(문서 보완 자체가 고객 가치). */
export interface MissingBasisHint {
  need: string;
}

export interface VerifyBasis {
  findingKey: string;
  basis: RagBasis[];
  hint?: MissingBasisHint;
}

/** 관련 있는 조각만 남긴다 — 임계값 밖은 근거가 아니라 소음이다(지어낸 근거 방지). */
function relevant(chunks: ScoredChunk[]): ScoredChunk[] {
  return chunks.filter((c) => c.distance <= RAG_RELEVANCE_MAX_DISTANCE || c.lexicalHit);
}

function excerptOf(text: string, max = 220): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// 보상통제로 볼 만한 표현 — 이 말이 있어야 "다른 보안으로 막고 있다"는 근거로 취급한다.
// (단순히 제품명이 스친 문서를 보상통제로 오해하지 않게 하는 장치)
const COMPENSATING_HINTS = /IPS|IDS|WAF|시그니처|차단|격리|폐쇄망|내부망|우회 불가|보상통제|완화/i;
// 사내 규칙으로 볼 만한 표현
const RULE_HINTS = /기준|정책|규정|원칙|등급|강등|예외|승인/;

/**
 * finding 하나에 대한 근거를 모은다.
 * 질의는 취약점 제목·CVE·자산명으로 만든다 — 담당자가 검색창에 칠 법한 말과 같아야 한다.
 */
export async function collectBasis(args: {
  findingKey: string;
  title: string;
  cve?: string;
  assetName?: string;
  status: VerifyOutcome["status"];
  expectedKind: VerifyOutcome["expectedKind"];
}): Promise<VerifyBasis> {
  const basis: RagBasis[] = [];
  const q = [args.title, args.cve, args.assetName].filter(Boolean).join(" ");

  // ① 아직 취약(FAIL)하거나 판단 불가(NA)일 때만 보상통제를 찾는다.
  //    이미 조치된 건에 "안 고쳐도 된다"는 근거를 들이밀 이유가 없다.
  if (args.status === "FAIL" || args.status === "NA") {
    try {
      const hits = relevant(await queryMemoryScored(`${q} 차단 완화 보상통제 IPS WAF 격리`, 4));
      for (const h of hits) {
        if (!COMPENSATING_HINTS.test(h.text)) continue;
        basis.push({
          kind: "compensating",
          label: "다른 보안으로 방어 중일 수 있습니다 — 반려 후보(확정은 담당자가)",
          excerpt: excerptOf(h.text),
          documentId: h.documentId,
        });
        break; // 한 건이면 충분하다 — 근거 더미로 화면을 덮지 않는다
      }
    } catch { /* RAG가 죽어도 검증 결과는 그대로 보여준다 */ }
  }

  // ② 자동 판정이 안 된 건(NA)에는 "이 장비는 어디서 확인하나"를 붙인다 — 사람이 직접 볼 차례라서.
  if (args.status === "NA") {
    try {
      const hits = relevant(await queryMemoryScored(`${q} 관리 콘솔 메뉴 버전 확인 방법`, 4));
      for (const h of hits) {
        if (!/메뉴|콘솔|경로|>|확인/.test(h.text)) continue;
        basis.push({
          kind: "device_howto",
          label: "이 장비는 이렇게 확인합니다",
          excerpt: excerptOf(h.text),
          documentId: h.documentId,
        });
        break;
      }
    } catch { /* noop */ }
  }

  // ③ 사내 조치 기준 — 우선순위·예외 규칙이 있으면 알려준다.
  if (args.status === "FAIL") {
    try {
      const hits = relevant(await queryMemoryScored(`${q} 사내 조치 기준 우선순위 예외`, 4));
      for (const h of hits) {
        if (!RULE_HINTS.test(h.text)) continue;
        basis.push({
          kind: "internal_rule",
          label: "사내 조치 기준",
          excerpt: excerptOf(h.text),
          documentId: h.documentId,
        });
        break;
      }
    } catch { /* noop */ }
  }

  // 근거를 못 찾았고 자동 판정도 안 된 상태라면 — 무엇이 있으면 되는지 알려준다.
  // "자료가 없다"로 끝내지 않는 게 이 제품의 태도다.
  let hint: MissingBasisHint | undefined;
  if (!basis.length && args.status === "NA") {
    hint = {
      need:
        args.expectedKind === "version"
          ? "이 제품의 버전 확인 방법(콘솔 메뉴·명령)이 담긴 문서를 지식베이스에 올리면 다음부터 자동으로 판정합니다."
          : "이 취약점의 조치 기준이나 확인 절차가 담긴 문서를 올리면 다음부터 근거와 함께 판단해 드립니다.",
    };
  }

  return { findingKey: args.findingKey, basis, hint };
}

/** 검증 결과 목록에 근거를 붙인다. 조치확인(PASS)만 있는 경우엔 조회 자체를 건너뛴다(불필요한 부하 방지). */
export async function attachBasis(
  results: VerifyOutcome[],
  assetName?: string
): Promise<(VerifyOutcome & { basis?: RagBasis[]; hint?: MissingBasisHint })[]> {
  const out: (VerifyOutcome & { basis?: RagBasis[]; hint?: MissingBasisHint })[] = [];
  for (const r of results) {
    if (r.status === "PASS") { out.push(r); continue; }
    const b = await collectBasis({
      findingKey: r.findingKey, title: r.title, cve: r.cve, assetName,
      status: r.status, expectedKind: r.expectedKind,
    });
    out.push({ ...r, ...(b.basis.length ? { basis: b.basis } : {}), ...(b.hint ? { hint: b.hint } : {}) });
  }
  return out;
}
