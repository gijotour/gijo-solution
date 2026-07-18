// MITRE ATLAS 온톨로지 시드 + KISA 위협과의 자동 연결.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { addTriples, expandOntology } from "../src/engine/ontology";
import { atlasTriples, ATLAS_SOURCE } from "../src/engine/atlas-seed";
import { owaspLlmTriples, OWASP_SOURCE } from "../src/engine/owasp-llm-seed";
import { nistAiRmfTriples, NIST_SOURCE } from "../src/engine/nist-airmf-seed";
import { cweTriples, CWE_SOURCE } from "../src/engine/cwe-seed";
import { attackTriples, ATTACK_SOURCE } from "../src/engine/attack-seed";
import { threatCatalogTriples } from "../src/engine/ontology-seed";

beforeEach(() => {
  db.exec("DELETE FROM ontology_triples");
});

describe("MITRE ATLAS 온톨로지 시드", () => {
  it("전술·기법·완화통제·상위기법 트리플을 담고 출처가 통일돼 있다", () => {
    const t = atlasTriples();
    expect(t.length).toBeGreaterThan(800);
    const preds = new Set(t.map((x) => x.predicate));
    for (const p of ["유형", "전술", "완화통제", "상위기법", "설명"]) expect(preds.has(p)).toBe(true);
    expect(t.every((x) => x.source === ATLAS_SOURCE)).toBe(true);
    // 기법 노드는 "{code} {name}" 형식(KISA 참조와 일치)
    expect(t.some((x) => /^AML\.T\d+ /.test(x.subject))).toBe(true);
  });

  it("KISA 위협이 ATLAS 코드로 국제 표준 그래프에 자동 연결된다", () => {
    addTriples([...threatCatalogTriples(), ...atlasTriples()]);
    // 데이터 포이즈닝 위협(KISA D01 '불균형 데이터')은 mitre=["AML.T0020 Poison Training Data"] 참조.
    const exp = expandOntology("불균형 데이터", undefined, { hops: 3, limit: 80 });
    const flat = exp.map((t) => `${t.subject}|${t.predicate}|${t.object}`).join("\n");
    // 1홉: KISA 위협 → ATLAS 기법 코드
    expect(flat).toContain("AML.T0020 Poison Training Data");
    // 2~3홉: ATLAS 기법 → 전술/완화통제까지 닿는다(하이브리드 확장이 국제 표준에 도달)
    expect(exp.some((t) => t.predicate === "전술" || t.predicate === "완화통제")).toBe(true);
  });

  it("ATLAS 기법에서 완화통제·전술을 직접 조회할 수 있다", () => {
    addTriples(atlasTriples());
    const exp = expandOntology("AML.T0020 Poison Training Data", undefined, { hops: 2, limit: 40 });
    expect(exp.some((t) => t.predicate === "전술")).toBe(true);
    expect(exp.some((t) => t.predicate === "완화통제")).toBe(true);
  });
});

describe("OWASP LLM Top 10 (2025) 온톨로지 시드", () => {
  it("LLM01~LLM10 위험을 유형·설명·완화통제·영향영역으로 담는다", () => {
    const t = owaspLlmTriples();
    expect(t.every((x) => x.source === OWASP_SOURCE)).toBe(true);
    const subjects = new Set(t.map((x) => x.subject));
    for (const s of ["LLM01:2025 Prompt Injection", "LLM04:2025 Data and Model Poisoning", "LLM10:2025 Unbounded Consumption"]) expect(subjects.has(s)).toBe(true);
    expect(t.some((x) => x.predicate === "완화통제")).toBe(true);
  });

  it("KISA 위협이 OWASP 코드로 그래프에 연결된다 (D01 → LLM04)", () => {
    addTriples([...threatCatalogTriples(), ...owaspLlmTriples()]);
    const exp = expandOntology("불균형 데이터", undefined, { hops: 2, limit: 60 });
    const flat = exp.map((t) => `${t.subject}|${t.predicate}|${t.object}`).join("\n");
    expect(flat).toContain("LLM04:2025 Data and Model Poisoning");
    // OWASP 노드의 완화통제까지 닿는다
    expect(exp.some((t) => t.subject.startsWith("LLM04") && t.predicate === "완화통제")).toBe(true);
  });
});

describe("NIST AI RMF + GenAI Profile 온톨로지 시드", () => {
  it("4기능·7신뢰속성·GenAI 위험을 담고 GenAI 위험을 OWASP에 교차 연결한다", () => {
    const t = nistAiRmfTriples();
    expect(t.every((x) => x.source === NIST_SOURCE)).toBe(true);
    const funcs = t.filter((x) => x.subject === "NIST AI RMF" && x.predicate === "기능");
    expect(funcs).toHaveLength(4);
    expect(t.filter((x) => x.subject === "NIST AI RMF" && x.predicate === "신뢰속성")).toHaveLength(7);
    // GenAI '정보 보안' 위험 → OWASP LLM01 프롬프트 인젝션으로 연결
    expect(t.some((x) => x.subject === "정보 보안" && x.predicate === "관련" && x.object === "LLM01:2025 Prompt Injection")).toBe(true);
  });

  it("NIST GenAI 위험 → OWASP → KISA로 3단 그래프가 이어진다", () => {
    addTriples([...threatCatalogTriples(), ...owaspLlmTriples(), ...nistAiRmfTriples()]);
    // '데이터 프라이버시'(NIST) → LLM02(OWASP) 로 시작해 확장
    const exp = expandOntology("데이터 프라이버시", undefined, { hops: 3, limit: 80 });
    const flat = exp.map((t) => `${t.subject}|${t.predicate}|${t.object}`).join("\n");
    expect(flat).toContain("LLM02:2025 Sensitive Information Disclosure");
  });
});

describe("CWE(약점 클래스) 온톨로지 시드", () => {
  it("Top 25 + AI/LLM 약점을 담고 LLM CWE를 OWASP에 연결한다", () => {
    const t = cweTriples();
    expect(t.every((x) => x.source === CWE_SOURCE)).toBe(true);
    expect(t.filter((x) => x.predicate === "유형" && x.object === "CWE Top 25 위험 약점(2024)")).toHaveLength(25);
    // CWE-1427 프롬프트 인젝션 → OWASP LLM01
    expect(t.some((x) => x.subject.startsWith("CWE-1427") && x.predicate === "관련" && x.object === "LLM01:2025 Prompt Injection")).toBe(true);
    // CWE-1426 GenAI 출력검증 실패 → 전통 인젝션(유발가능)
    expect(t.some((x) => x.subject.startsWith("CWE-1426") && x.predicate === "유발가능")).toBe(true);
  });

  it("LLM CWE에서 OWASP를 거쳐 KISA까지 이어진다 (CWE-1427 → LLM01 → 위협)", () => {
    addTriples([...threatCatalogTriples(), ...owaspLlmTriples(), ...cweTriples()]);
    const exp = expandOntology("CWE-1427", undefined, { hops: 3, limit: 80 });
    const flat = exp.map((t) => `${t.subject}|${t.predicate}|${t.object}`).join("\n");
    expect(flat).toContain("LLM01:2025 Prompt Injection");
  });
});

describe("MITRE ATT&CK Enterprise 온톨로지 시드", () => {
  it("취약점 악용 전술의 기법·전술·완화통제를 담는다(top-level 필터)", () => {
    const t = attackTriples();
    expect(t.length).toBeGreaterThan(500);
    expect(t.every((x) => x.source === ATTACK_SOURCE)).toBe(true);
    for (const p of ["유형", "전술", "완화통제", "설명"]) expect(t.some((x) => x.predicate === p)).toBe(true);
    // 기법 노드는 "T#### Name" 형식, 하위기법(T####.###)은 제외됨
    expect(t.some((x) => /^T\d{4} /.test(x.subject))).toBe(true);
    expect(t.some((x) => /^T\d{4}\.\d{3} /.test(x.subject))).toBe(false);
  });

  it("공개 표준 기법(T1190 Exploit Public-Facing Application)에서 전술·완화통제를 조회한다", () => {
    addTriples(attackTriples());
    const exp = expandOntology("T1190 Exploit Public-Facing Application", undefined, { hops: 2, limit: 40 });
    expect(exp.some((t) => t.predicate === "전술")).toBe(true);
    expect(exp.some((t) => t.predicate === "완화통제")).toBe(true);
  });
});
