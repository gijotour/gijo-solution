import { describe, it, expect } from "vitest";
import { playbookFor, remediationFor, applyKevUrgency, formatRemediation } from "../src/engine/playbook";

describe("조치 플레이북", () => {
  it("RCE/Log4j를 RCE 플레이북으로 매칭", () => {
    expect(playbookFor("Apache Log4j2 Log4Shell RCE").id).toBe("rce");
    expect(playbookFor("역직렬화 취약점").id).toBe("rce");
  });
  it("OWASP LLM/프롬프트 인젝션을 AI 플레이북으로", () => {
    expect(playbookFor("LLM01 프롬프트 인젝션").id).toBe("llm-prompt-injection");
  });
  it("매칭 없으면 일반 플레이북", () => {
    expect(playbookFor("알 수 없는 항목").id).toBe("generic");
  });
  it("KEV면 SLA 절반으로 단축(최소 1일)", () => {
    expect(applyKevUrgency(7, false)).toBe(7);
    expect(applyKevUrgency(7, true)).toBe(4);
    expect(applyKevUrgency(1, true)).toBe(1);
  });
  it("remediationFor — 심각도별 기한과 단계 반환", () => {
    const r = remediationFor({ findingType: "SQL Injection", severity: "critical", kev: false });
    expect(r.playbookId).toBe("injection");
    expect(r.slaDays).toBe(5);
    expect(r.steps.length).toBeGreaterThan(2);
    expect(r.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("formatRemediation — 사람이 읽을 텍스트에 단계·기한 포함", () => {
    const t = formatRemediation({ findingType: "Log4Shell RCE", severity: "critical", kev: true, assetName: "was-01" });
    expect(t).toContain("조치 플레이북");
    expect(t).toContain("was-01");
    expect(t).toContain("KEV");
  });
});
