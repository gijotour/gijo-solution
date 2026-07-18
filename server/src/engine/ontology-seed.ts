// engine/ontology-seed.ts — 온톨로지 초기 시드. 지어낸 데이터가 아니라 프로젝트에 이미 있는
// 실제 도메인 지식(compliance.ts의 KISA AI 보안 위협 카탈로그)을 트리플로 변환한다.
//
// 각 위협은 하나의 엔티티(주어)이고, 카탈로그의 매핑이 그대로 관계(술어→목적어)가 된다:
//   (탈옥)-[위협코드]->(M06), (탈옥)-[위협분류]->(모델 위협),
//   (탈옥)-[OWASP-LLM]->(LLM01:2025 Prompt Injection), (탈옥)-[영향영역]->(프롬프트) ...
// 서로 다른 위협이 같은 OWASP/NIST/MITRE 항목을 공유하면 그 항목을 통해 그래프가 연결되어,
// "탈옥"에서 2홉이면 같은 LLM01을 공유하는 "에이전트 하이재킹"까지 닿는다(하이브리드 확장의 실효).

import { THREAT_CATALOG, CATEGORY_LABEL, type AiBomArea } from "./compliance";
import { PRODUCT_CATEGORIES } from "./securityproducts";
import { addTriples, deleteTriplesBySource, type TripleInput } from "./ontology";
import { atlasTriples, ATLAS_SOURCE } from "./atlas-seed";
import { owaspLlmTriples, OWASP_SOURCE } from "./owasp-llm-seed";
import { nistAiRmfTriples, NIST_SOURCE } from "./nist-airmf-seed";
import { cweTriples, CWE_SOURCE } from "./cwe-seed";

// 시드 트리플의 출처 태그 — 재적재 시 이 출처의 기존 트리플만 지워 멱등하게 만든다(수동 입력분은 보존).
export const SEED_SOURCE = "KISA AI 보안 위협 대응 매뉴얼(2026.7)";
// 완화통제·보안제품·취약점분류 시드는 별도 출처 태그로 각각 독립 멱등.
export const MITIGATION_SOURCE = "KISA AI 보안 위협 대응 매뉴얼(2026.7) 별첨2 양호기준";
export const PRODUCT_SOURCE = "GIJO AS 보안제품 카탈로그";
export const VULN_SOURCE = "GIJO AS 취약점관리 지침";

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

// 위협별 완화통제(접근제어 중심). 각 트리플은 해당 위협의 '양호기준(good)' 지문에 직접 근거하며,
// 주어를 THREAT_CATALOG의 위협명 그대로 써서 위협 노드에 바로 연결된다(접근제어 서브그래프 ↔ 위협 연결).
// 근거: M02/M04/A01/A04/D03/M01의 양호기준 지문(compliance-criteria.ts).
export function mitigationTriples(): TripleInput[] {
  const pred = "완화통제";
  const map: [string, string][] = [
    ["벡터 DB·임베딩 유출", "문서 단위 접근제어(RBAC)"],       // M02 good: 문서 단위의 세밀한 접근 제어
    ["벡터 DB·임베딩 유출", "서버측 세션 기반 질의 필터"],      // M02 good: 서버 측 세션 정보 기반 필터
    ["모델 유출", "가중치 파일 인가 사용자 한정"],             // M04 good: 인가된 사용자만 접근
    ["모델 유출", "추론 API rate limit"],                     // M04 good: rate limit 적절
    ["부적절한 도구 설계", "도구 최소권한 원칙"],              // A01 good: 사용자 이하 권한으로 도구 실행
    ["부적절한 도구 설계", "역할별 도구 사용 제한"],           // A01 good: 권한별 사용 도구 제한
    ["에이전트 메모리 오염", "장기 메모리 역할기반 접근제어"],  // A04 good: 인증·역할 기반 권한
    ["개인정보 비식별화 미흡", "원본 데이터 최소인원 접근"],    // D03 good: 최소 인원에게만 접근 권한
    ["학습 데이터 유출", "응답 민감정보 필터링·마스킹"],       // M01 good: 반복 질의에도 복원 응답 차단
  ];
  return map.map(([threat, control]) => ({ subject: threat, predicate: pred, object: control, source: MITIGATION_SOURCE }));
}

// 보안제품 카탈로그(securityproducts.ts) → 트리플. 라벨의 괄호 안 설명이 곧 제품군의 기능이다:
// "EDR (단말탐지대응)" → (EDR)-[기능]->(단말탐지대응). 순수 카탈로그 사실만(해석 없음).
export function securityProductTriples(): TripleInput[] {
  const triples: TripleInput[] = [];
  for (const c of PRODUCT_CATEGORIES) {
    if (c.id === "기타") continue;
    triples.push({ subject: c.id, predicate: "유형", object: "보안제품", source: PRODUCT_SOURCE });
    const m = c.label.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m && m[2]) triples.push({ subject: c.id, predicate: "기능", object: m[2].trim(), source: PRODUCT_SOURCE });
  }
  return triples;
}

// 취약점 분류 도메인 — GIJO AS 취약점관리 지침(Tenable VM 기반)의 구조화 데이터를 트리플로.
// 생애주기 4단계(루프)·CVSS 심각도 밴드·우선순위 지표(CVSS/EPSS/VPR/CISA KEV)·VPR 결정요인·상태 추적.
// 전부 지침 문서에 명시된 사실만(밴드 수치·명칭·정의). AI 위협 시드와 별개의 '취약 자산관리' 서브그래프.
export function vulnClassificationTriples(): TripleInput[] {
  const t = (subject: string, predicate: string, object: string): TripleInput => ({ subject, predicate, object, source: VULN_SOURCE });
  const rows: TripleInput[] = [];

  // 생애주기 4단계 + 루프 연결
  const stages = ["발견·평가", "우선순위", "조치", "측정"];
  for (const s of stages) rows.push(t("취약점 관리", "생애주기", s));
  for (let i = 0; i < stages.length; i++) rows.push(t(stages[i], "다음단계", stages[(i + 1) % stages.length]));

  // CVSS 심각도 등급 밴드 (지침 §2)
  const cvss: [string, string][] = [["Critical", "9.0–10.0"], ["High", "7.0–8.9"], ["Medium", "4.0–6.9"], ["Low", "0.1–3.9"], ["Info", "0"]];
  for (const [grade, range] of cvss) { rows.push(t("CVSS 심각도", "등급", grade)); rows.push(t(grade, "점수범위", range)); }

  // 우선순위 판단 지표
  for (const ind of ["CVSS", "EPSS", "VPR", "CISA KEV", "자산 중요도"]) rows.push(t("취약점 우선순위", "판단지표", ind));
  rows.push(t("CVSS", "의미", "기술적 심각도"));
  rows.push(t("EPSS", "정식명칭", "Exploit Prediction Scoring System"));
  rows.push(t("EPSS", "의미", "향후 30일 내 악용 확률"));
  rows.push(t("VPR", "정식명칭", "Vulnerability Priority Rating"));
  rows.push(t("VPR", "출처", "Tenable"));
  rows.push(t("VPR", "범위", "0.1–10.0"));
  rows.push(t("CISA KEV", "의미", "실제 악용이 확인된 취약점"));
  rows.push(t("CISA KEV", "우선순위", "최우선 조치"));
  rows.push(t("Tenable 권고", "내용", "VPR 높은 것부터 조치"));

  // VPR 결정요인 (Key Drivers)
  for (const d of ["익스플로잇 성숙도", "악용확률(EPSS)", "CISA KEV 등재", "언론·다크웹 언급"]) rows.push(t("VPR", "결정요인", d));

  // 상태 추적 (재스캔 기반 자동 판정)
  const states: [string, string][] = [
    ["New", "처음 1회 탐지"], ["Active", "2회 이상 탐지(계속 존재)"],
    ["Fixed", "재스캔에서 사라짐(조치 완료 검증)"], ["Resurfaced", "Fixed 후 재발"],
  ];
  for (const [st, meaning] of states) { rows.push(t("취약점 상태", "값", st)); rows.push(t(st, "의미", meaning)); }

  return rows;
}

// 멱등 적재: 각 시드 그룹을 자기 출처 태그로 지우고 다시 생성한다. 사용자가 손으로 넣은 트리플은
// 출처가 달라 보존된다. 반환값은 새로 넣은 트리플 수(전체).
export function seedOntologyFromCatalog(): { inserted: number; sources: string[] } {
  deleteTriplesBySource(SEED_SOURCE);
  deleteTriplesBySource(MITIGATION_SOURCE);
  deleteTriplesBySource(PRODUCT_SOURCE);
  deleteTriplesBySource(VULN_SOURCE);
  deleteTriplesBySource(ATLAS_SOURCE);
  deleteTriplesBySource(OWASP_SOURCE);
  deleteTriplesBySource(NIST_SOURCE);
  deleteTriplesBySource(CWE_SOURCE);
  const rows = addTriples([
    ...threatCatalogTriples(),
    ...mitigationTriples(),
    ...securityProductTriples(),
    ...vulnClassificationTriples(),
    ...atlasTriples(), // MITRE ATLAS 국제 표준(전술·기법·완화통제) — KISA 위협과 코드로 자동 연결
    ...owaspLlmTriples(), // OWASP LLM Top 10(2025) — KISA 위협과 OWASP 코드로 자동 연결
    ...nistAiRmfTriples(), // NIST AI RMF + GenAI Profile(거버넌스) — GenAI 위험을 OWASP에 교차 연결
    ...cweTriples(), // CWE Top 25(2024) + AI/LLM 약점 — 약점 클래스 축, LLM CWE를 OWASP에 연결
  ]);
  return { inserted: rows.length, sources: [SEED_SOURCE, MITIGATION_SOURCE, PRODUCT_SOURCE, VULN_SOURCE, ATLAS_SOURCE, OWASP_SOURCE, NIST_SOURCE, CWE_SOURCE] };
}
