// llama.cpp 바이너리 경로 플랫폼 분기 — WSL2 이관 대비(win: Release/*.exe, linux: */name).
import { describe, it, expect } from "vitest";
import * as path from "path";
import { llamaBinPath } from "../src/util/llamabin";

describe("llamaBinPath — 플랫폼별 바이너리 경로", () => {
  it("현재 플랫폼에 맞는 경로를 만든다", () => {
    const p = llamaBinPath("llama-server");
    if (process.platform === "win32") {
      expect(p).toBe(path.join("llama.cpp", "build", "bin", "Release", "llama-server.exe"));
    } else {
      expect(p).toBe(path.join("llama.cpp", "build", "bin", "llama-server"));
    }
  });

  it("cppDir를 지정하면 그 경로를 기준으로 만든다", () => {
    const p = llamaBinPath("llama-quantize", "/opt/llama.cpp");
    expect(p).toContain("llama-quantize");
    expect(p).toContain("/opt/llama.cpp".replace(/\//g, path.sep));
    if (process.platform === "win32") expect(p.endsWith(".exe")).toBe(true);
    else expect(p.endsWith("llama-quantize")).toBe(true);
  });
});
