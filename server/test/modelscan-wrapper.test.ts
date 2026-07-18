import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// modelscan_wrapper.py를 실제 Python + modelscan 패키지로 돌려보는 통합 테스트다(다른 테스트들과
// 달리 bridge.ts를 목킹하지 않는다). ci.yml이 Python을 세팅하고 모듈을 설치해준다 — 로컬에
// Python이 없으면 이 파일 전체를 조용히 skip한다(다른 테스트에 영향 없음).
const PYTHON = process.env.GIJO_TEST_PYTHON ?? "python";
const WRAPPER_PATH = path.join(__dirname, "..", "modelscan_wrapper.py");
const execFileAsync = promisify(execFile);

function pythonAndModelscanAvailable(): boolean {
  try {
    execFileSync(PYTHON, ["-c", "import modelscan"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(pythonAndModelscanAvailable())("modelscan_wrapper.py (real Python integration)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelscan-wrapper-test-"));
    // Python은 Windows에서도 forward slash 경로를 허용한다 — 백슬래시를 쓰면 Linux CI에서
    // 파일명에 '\'가 그대로 박혀 스캔 대상이 안 만들어진다(크로스플랫폼).
    const tmpFwd = tmpDir.replace(/\\/g, "/");
    // 악성 pickle 페이로드를 저장소에 커밋해두지 않고 테스트 시점에 즉석으로 만든다 — 실제 동작하는
    // exploit 파일을 레포에 넣으면 백신/GitHub 악성코드 스캐너 오탐을 부를 수 있다.
    const makeFixtures = `
import pickle

class Evil:
    def __reduce__(self):
        import os
        return (os.system, ("echo test",))

with open(r"${tmpFwd}/evil.pkl", "wb") as f:
    pickle.dump(Evil(), f)
with open(r"${tmpFwd}/safe.pkl", "wb") as f:
    pickle.dump({"a": 1}, f)
`;
    execFileSync(PYTHON, ["-c", makeFixtures]);
    fs.writeFileSync(path.join(tmpDir, "asset.gguf"), "not a real gguf, just needs to exist");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects a real unsafe pickle payload as a critical finding", async () => {
    const { stdout } = await execFileAsync(PYTHON, [WRAPPER_PATH, path.join(tmpDir, "evil.pkl")]);
    const findings = JSON.parse(stdout);
    expect(findings).toEqual([expect.objectContaining({ severity: "critical", source_tool: "modelscan" })]);
  });

  it("returns no findings for a clean pickle", async () => {
    const { stdout } = await execFileAsync(PYTHON, [WRAPPER_PATH, path.join(tmpDir, "safe.pkl")]);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  it("reports scan_not_supported instead of silently returning [] for an unsupported format (e.g. .gguf)", async () => {
    const { stdout } = await execFileAsync(PYTHON, [WRAPPER_PATH, path.join(tmpDir, "asset.gguf")]);
    const findings = JSON.parse(stdout);
    expect(findings).toEqual([expect.objectContaining({ finding_type: "scan_not_supported", severity: "low" })]);
  });

  it("reports a scan_error finding (not a crash) for a nonexistent path", async () => {
    expect.assertions(2);
    try {
      await execFileAsync(PYTHON, [WRAPPER_PATH, path.join(tmpDir, "does-not-exist.pkl")]);
    } catch (err) {
      expect((err as { code: number }).code).toBe(1);
      const findings = JSON.parse((err as { stdout: string }).stdout);
      expect(findings).toEqual([expect.objectContaining({ finding_type: "scan_error", severity: "low" })]);
    }
  });
});
