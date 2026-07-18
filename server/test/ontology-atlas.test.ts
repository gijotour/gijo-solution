// MITRE ATLAS 온톨로지 시드 + KISA 위협과의 자동 연결.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { addTriples, expandOntology } from "../src/engine/ontology";
import { atlasTriples, ATLAS_SOURCE } from "../src/engine/atlas-seed";
import { owaspLlmTriples, OWASP_SOURCE } from "../src/engine/owasp-llm-seed";
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
