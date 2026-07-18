// 번들 모델 라이선스 분류 — 상업 배포 가능/제약/BYOM 가시화(제품화 법무 blocker).
import { describe, it, expect } from "vitest";
import { classifyModelLicense, classifyAvailableModels } from "../src/engine/modellicense";

describe("classifyModelLicense", () => {
  it("Qwen2.5-7B/Coder는 permissive(번들 안전 추정)", () => {
    expect(classifyModelLicense("Qwen__Qwen2.5-Coder-7B-Instruct-GGUF").tier).toBe("permissive");
    expect(classifyModelLicense("bartowski__Qwen2.5-7B-Instruct-GGUF").bundleSafe).toBe(true);
  });
  it("Qwen2.5-3B는 비상업 → restricted(번들 불가)", () => {
    const m = classifyModelLicense("bartowski__Qwen2.5-3B-Instruct-GGUF");
    expect(m.tier).toBe("restricted");
    expect(m.bundleSafe).toBe(false);
  });
  it("Llama/Hermes는 restricted(조건부)", () => {
    expect(classifyModelLicense("NousResearch__Hermes-3-Llama-3.1-8B-GGUF").tier).toBe("restricted");
    expect(classifyModelLicense("bartowski__Meta-Llama-3.1-8B-Instruct-GGUF").tier).toBe("restricted");
  });
  it("합성/개조/출처불명은 byom(상업 번들 금지)", () => {
    expect(classifyModelLicense("merged-lily-gijo-loop-ai-securityllm").tier).toBe("byom");
    expect(classifyModelLicense("gijo-main-orchestrator").tier).toBe("byom");
    expect(classifyModelLicense("mradermacher__Qwen3-VL-8B-Instruct-abliterated-GGUF").tier).toBe("byom");
  });
});

describe("classifyAvailableModels", () => {
  it("요약 집계가 맞다", () => {
    const r = classifyAvailableModels([
      "Qwen__Qwen2.5-Coder-7B-Instruct-GGUF", // permissive
      "bartowski__Qwen2.5-3B-Instruct-GGUF", // restricted
      "gijo-main-orchestrator", // byom
    ]);
    expect(r.summary.total).toBe(3);
    expect(r.summary.permissive).toBe(1);
    expect(r.summary.bundleSafe).toBe(1);
    expect(r.summary.byom).toBe(1);
  });
});
