// engine/attack-seed.ts — MITRE ATT&CK Enterprise(STIX) 온톨로지 시드.
// 인프라 취약점(Log4Shell·OpenSSH·Oracle 등)이 실제로 어떻게 악용되는지(전술·기법·완화통제)를 준다.
// ATLAS(AI 적대적 위협)의 인프라 짝. 취약점 악용 생애주기 전술(초기침투~영향)로 필터링한 93기법.
// 데이터는 attack-ontology-data.ts에 오프라인 번들 — server/attack-transform.cjs로 재생성.

import { ATTACK_ONTOLOGY } from "./attack-ontology-data";
import type { TripleInput } from "./ontology";

export const ATTACK_SOURCE = "MITRE ATT&CK Enterprise (STIX 스냅샷 2026)";

export function attackTriples(): TripleInput[] {
  return ATTACK_ONTOLOGY.map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object, source: ATTACK_SOURCE }));
}
