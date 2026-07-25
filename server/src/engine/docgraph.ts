// engine/docgraph.ts — 문서↔자산↔제품↔취약점 온톨로지 연결 (GraphRAG-lite, 2026-07-25 P3).
//
// 왜: 벡터 RAG는 "비슷한 문장"을 찾을 뿐, "FW-2000 관련 문서·취약점 전부"처럼 관계를 따라가는
// 질문(멀티홉)에는 약하다. 정통 GraphRAG(엔티티 추출 파이프라인+그래프 DB)는 비용·복잡도가 커서
// 채택하지 않고, 이미 있는 온톨로지(트리플 저장소 + 채팅 주입 expandOntology 2홉 BFS)에
// 문서 인입 시점의 "확실한 관계"만 결정적으로 심는다 — LLM 추출 없음, 완전 온프렘.
//
// 관계는 인입 경로가 이미 아는 것만 만든다(지어내지 않는다):
//   웹취약점 보고서 → (보고서, 점검 보고서, 자산호스트) + (호스트, 발견 취약점, [코드] 명칭)
//   제품 매뉴얼    → (제품명, 제품/로그 매뉴얼, 파일명)
//   유지보수 점검서 → (제품명, 점검 리포트, 파일명)
//
// 멱등성: 트리플 source를 "doc:<파일명>"으로 통일 — 같은 문서 재업로드 시 이전 트리플을 지우고
// 다시 만들며, 문서 삭제 시 함께 지운다(고아 트리플 방지).

import { addTriples, deleteTriplesBySource, type TripleInput } from "./ontology";
import type { WebReportParseResult } from "./webreport";

// 문서 하나가 만들 수 있는 트리플 상한. 서술형 웹보고서는 수십 건이지만, 혹시 모를 대형 입력이
// 온톨로지를 잡음으로 채우지 않게 막는다(expandOntology 주입 한도도 12개라 그 이상은 효용 없음).
const MAX_TRIPLES_PER_DOC = 60;

export function docSource(filename: string): string {
  return `doc:${filename}`;
}

/** 웹취약점 점검 보고서의 관계 — 보고서→자산, 자산→취약점, 취약점→위험도. */
export function webReportTriples(filename: string, parsed: Pick<WebReportParseResult, "assets" | "vulns">): TripleInput[] {
  const out: TripleInput[] = [];
  const src = docSource(filename);
  for (const a of parsed.assets) {
    out.push({ subject: filename, predicate: "점검 보고서", object: a.host, source: src });
    // 서비스명은 담당자가 부르는 이름("본인인증 웹 서버")이라 호스트와 이어 둔다 — 이름으로 물어도 걸리게.
    if (a.name && a.name !== a.host) out.push({ subject: a.host, predicate: "서비스명", object: a.name, source: src });
  }
  for (const v of parsed.vulns) {
    // 웹리포트 파서의 name에는 코드가 이미 붙어 있을 수 있다("[IW-20] 디렉토리 인덱싱") —
    // 그대로 두고, 없을 때만 붙인다(운영 실측: 이중 표기 "[IW-20] [IW-20] …" 방지).
    const vulnLabel = v.pluginId && !v.name.includes(`[${v.pluginId}]`) ? `[${v.pluginId}] ${v.name}` : v.name;
    out.push({ subject: v.host, predicate: "발견 취약점", object: vulnLabel, source: src });
    if (v.risk) out.push({ subject: vulnLabel, predicate: "위험도", object: v.risk, source: src });
  }
  return out.slice(0, MAX_TRIPLES_PER_DOC);
}

/** 제품 매뉴얼 연결 관계 — 제품에서 문서로. (제품명이 질문에 나오면 매뉴얼 파일명이 근거로 붙는다.) */
export function manualTriples(filename: string, productName: string, kind: string): TripleInput[] {
  return [
    {
      subject: productName,
      predicate: kind === "logManual" ? "로그 매뉴얼" : "제품 매뉴얼",
      object: filename,
      source: docSource(filename),
    },
  ];
}

/** 유지보수 점검 리포트 관계 — 제품에서 점검서로. */
export function maintenanceReportTriples(filename: string, productName: string): TripleInput[] {
  return [{ subject: productName, predicate: "점검 리포트", object: filename, source: docSource(filename) }];
}

/**
 * 문서의 트리플을 온톨로지에 동기화한다(이전 것 삭제 → 새로 추가 = 멱등).
 * 실패해도 인입/등록 자체를 막지 않는다 — 그래프는 보조 계층이다.
 */
export function syncDocTriples(filename: string, triples: TripleInput[]): number {
  try {
    deleteTriplesBySource(docSource(filename));
    if (triples.length === 0) return 0;
    return addTriples(triples).length;
  } catch (err) {
    console.warn(`[docgraph] 온톨로지 동기화 실패(${filename}): ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/** 문서 삭제 시 그 문서가 만든 트리플도 지운다(고아 방지). */
export function removeDocTriples(filename: string): number {
  try {
    return deleteTriplesBySource(docSource(filename));
  } catch {
    return 0;
  }
}
