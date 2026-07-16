// engine/ontology-seed.ts — 온톨로지 초기 시드. 지어낸 데이터가 아니라 프로젝트에 이미 있는
// 실제 도메인 지식(compliance.ts의 KISA AI 보안 위협 카탈로그)을 트리플로 변환한다.
//
// 각 위협은 하나의 엔티티(주어)이고, 카탈로그의 매핑이 그대로 관계(술어→목적어)가 된다:
//   (탈옥)-[위협코드]->(M06), (탈옥)-[위협분류]->(모델 위협),
//   (탈옥)-[OWASP-LLM]->(LLM01:2025 Prompt Injection), (탈옥)-[영향영역]->(프롬프트) ...
// 서로 다른 위협이 같은 OWASP/NIST/MITRE 항목을 공유하면 그 항목을 통해 그래프가 연결되어,
// "탈옥"에서 2홉이면 같은 LLM01을 공유하는 "에이전트 하이재킹"까지 닿는다(하이브리드 확장의 실효).

import { THREAT_CATALOG, CATEGORY_LABEL, type AiBomArea } from "./compliance";
import { addTriples, deleteTriplesBySource, type TripleInput } from "./ontology";

// 시드 트리플의 출처 태그 — 재적재 시 이 출처의 기존 트리플만 지워 멱등하게 만든다(수동 입력분은 보존).
export const SEED_SOURCE = "KISA AI 보안 위협 대응 매뉴얼(2026.7)";

const AIBOM_AREA_LABEL: Record<AiBomArea, string> = {
  model: "모델",
  dataset: "데이터셋",
  prompt: "프롬프트",
  agentTool: "에이전트 도구",
  infrastructure: "인프라",
};

// 카탈로그 → 트리플 목록(순수 함수, DB 접근 없음 — 테스트에서 매핑만 따로 검증 가능).
export function threatCatalogTriples(): TripleInput[] {
  const triples: TripleInput[] = [];
  for (const t of THREAT_CATALOG) {
    const subject = t.name;
    triples.push({ subject, predicate: "위협코드", object: t.code, source: SEED_SOURCE });
    triples.push({ subject, predicate: "위협분류", object: CATEGORY_LABEL[t.category], source: SEED_SOURCE });
    for (const area of t.aibomAreas) {
      triples.push({ subject, predicate: "영향영역", object: AIBOM_AREA_LABEL[area], source: SEED_SOURCE });
    }
    for (const o of t.owasp) triples.push({ subject, predicate: "OWASP-LLM", object: o, source: SEED_SOURCE });
    for (const n of t.nist) triples.push({ subject, predicate: "NIST-ATLAS", object: n, source: SEED_SOURCE });
    for (const m of t.mitre) triples.push({ subject, predicate: "MITRE-ATLAS", object: m, source: SEED_SOURCE });
  }
  return triples;
}

// 멱등 적재: 이전 시드분을 지우고 카탈로그에서 다시 생성한다. 사용자가 손으로 넣은 트리플은
// 출처가 달라 보존된다. 반환값은 새로 넣은 트리플 수.
export function seedOntologyFromCatalog(): { inserted: number; source: string } {
  deleteTriplesBySource(SEED_SOURCE);
  const rows = addTriples(threatCatalogTriples());
  return { inserted: rows.length, source: SEED_SOURCE };
}
