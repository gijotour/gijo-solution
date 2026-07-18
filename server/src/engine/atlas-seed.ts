// engine/atlas-seed.ts — MITRE ATLAS(STIX) 온톨로지 시드.
// AI 적대적 위협의 국제 표준 지식(전술·기법·완화통제·상위기법 관계)을 트리플로 넣는다.
// 기존 KISA 위협이 이미 MITRE-ATLAS 코드("AML.T0020 Poison Training Data")를 참조하므로,
// ATLAS 기법 노드의 subject를 같은 "{code} {name}" 형식으로 두면 KISA 위협 ↔ ATLAS 그래프가
// 코드 노드를 통해 자동으로 이어진다(하이브리드 확장이 국제 표준까지 닿음).
//
// 데이터는 atlas-ontology-data.ts에 오프라인 번들(에어갭 대응) — server/atlas-transform.cjs로 재생성.

import { ATLAS_ONTOLOGY } from "./atlas-ontology-data";
import type { TripleInput } from "./ontology";

export const ATLAS_SOURCE = "MITRE ATLAS (STIX 스냅샷 2026)";

export function atlasTriples(): TripleInput[] {
  return ATLAS_ONTOLOGY.map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object, source: ATLAS_SOURCE }));
}
