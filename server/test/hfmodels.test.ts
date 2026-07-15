import { describe, it, expect } from "vitest";
import { pickGgufFile } from "../src/engine/hfmodels";

describe("hfmodels pickGgufFile — 받을 양자화본 선택", () => {
  const llama = [
    "Meta-Llama-3.1-8B-Instruct-IQ2_M.gguf",
    "Meta-Llama-3.1-8B-Instruct-Q2_K.gguf",
    "Meta-Llama-3.1-8B-Instruct-Q4_K_S.gguf",
    "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    "Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf",
    "Meta-Llama-3.1-8B-Instruct-Q8_0.gguf",
  ];

  it("prefers Q4_K_M when present", () => {
    expect(pickGgufFile(llama)).toBe("Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf");
  });

  it("falls back through the preference list when Q4_K_M is absent", () => {
    const noQ4KM = llama.filter((f) => !/Q4_K_M/.test(f));
    expect(pickGgufFile(noQ4KM)).toBe("Meta-Llama-3.1-8B-Instruct-Q4_K_S.gguf");
  });

  it("prefers single-file quants over sharded splits", () => {
    const files = [
      "model-Q4_K_M-00001-of-00003.gguf",
      "model-Q4_K_M-00002-of-00003.gguf",
      "model-Q4_K_M-00003-of-00003.gguf",
      "model-Q3_K_S.gguf",
    ];
    expect(pickGgufFile(files)).toBe("model-Q3_K_S.gguf"); // 분할본 대신 단일 파일
  });

  it("returns null when there are no gguf files", () => {
    expect(pickGgufFile([])).toBeNull();
  });

  it("returns the first gguf when no preferred quant matches", () => {
    const odd = ["weird-model-F16.gguf", "weird-model-BF16.gguf"];
    expect(pickGgufFile(odd)).toBe("weird-model-F16.gguf");
  });
});
