// 분할 GGUF(여러 조각으로 나뉜 대용량 모델) 계약.
//
// [중-3 평가 게이트 / 전-7 하드웨어 갈래] 2026-09-01 Qwen3.8-Flash-Next(125B MoE)를 gb10에
// 올리며 만든 시험이다. 이 모델은 84GB라 `-00001-of-00003.gguf` 3조각으로 배포되는데,
// 그전 `modelFilePath()`는 `<id>/<id>.gguf` **단일 파일**만 찾아 목록에 아예 안 떴다.
//
// 이 시험이 지키는 것 셋 — 셋 다 실제로 밟은 함정이다:
//  ① 첫 조각을 준다 — llama.cpp 로더가 `split.no != 0`이면
//     「illegal split file idx … must be loaded with the first split」로 던진다.
//  ② **이름을 그대로** 준다 — llama.cpp가 경로 끝의 `-00001-of-00003.gguf`를 파싱해 형제를
//     찾으므로(`llama_split_prefix`), 심링크·이름바꾸기로 `<id>.gguf`를 만들면
//     「invalid split file name」으로 죽는다. 우회가 안 되는 이유가 이것이다.
//  ③ 크기는 **전 조각의 합**이다 — 1번 조각은 텐서가 0개인 메타데이터 조각이라 10MB 남짓이다.
//     그 값이 makeRoomFor에 들어가면 84GB 모델이 10MB로 읽혀 자리 확보가 그냥 통과하고
//     **조용히 OOM**으로 간다. ①만 고치고 ③을 빼먹는 것이 이 저장소가 반복해 겪은 반쪽 수리다.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// GIJO_MODELS_DIR은 모듈 로드 시점에 읽힌다 — import 전에 고정한다.
const tmpModels = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-split-"));
process.env.GIJO_MODELS_DIR = tmpModels;

const { modelFilePath, modelFileSizeMb, listAvailableModels, isModelAvailable } = await import(
  "../src/engine/localengine"
);

function 조각놓기(modelId: string, 조각들: [string, number][]): void {
  fs.mkdirSync(path.join(tmpModels, modelId), { recursive: true });
  for (const [이름, 바이트] of 조각들) {
    fs.writeFileSync(path.join(tmpModels, modelId, 이름), Buffer.alloc(바이트, 0));
  }
}

describe("분할 GGUF — 조각으로 나뉜 모델도 제품이 본다", () => {
  beforeEach(() => {
    fs.rmSync(tmpModels, { recursive: true, force: true });
    fs.mkdirSync(tmpModels, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpModels, { recursive: true, force: true });
  });

  it("단일 파일이 있으면 그대로 쓴다(기존 계약 무회귀)", () => {
    조각놓기("qwen3-14b", [["qwen3-14b.gguf", 4096]]);
    expect(modelFilePath("qwen3-14b")).toBe(path.join(tmpModels, "qwen3-14b", "qwen3-14b.gguf"));
    expect(modelFileSizeMb("qwen3-14b")).toBeCloseTo(4096 / (1024 * 1024), 6);
    expect(isModelAvailable("qwen3-14b")).toBe(true);
  });

  it("① 분할이면 **1번 조각**을 준다 — 2·3번을 주면 로더가 즉사한다", () => {
    조각놓기("qwen38-flash-next", [
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00002-of-00003.gguf", 3000],
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf", 100],
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00003-of-00003.gguf", 2000],
    ]);
    expect(path.basename(modelFilePath("qwen38-flash-next"))).toBe(
      "Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf"
    );
  });

  it("② 조각 **이름을 그대로** 넘긴다 — <id>.gguf로 바꾸면 llama.cpp가 형제를 못 찾는다", () => {
    조각놓기("qwen38-flash-next", [
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf", 100],
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00002-of-00003.gguf", 3000],
    ]);
    const 준경로 = modelFilePath("qwen38-flash-next");
    expect(준경로).toMatch(/-00001-of-00003\.gguf$/);
    expect(path.basename(준경로)).not.toBe("qwen38-flash-next.gguf");
  });

  it("③ 크기는 **전 조각의 합** — 첫 조각만 재면 84GB가 10MB로 읽혀 조용히 OOM 난다", () => {
    조각놓기("qwen38-flash-next", [
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf", 100], // 메타데이터 조각(텐서 0개)
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00002-of-00003.gguf", 3000],
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00003-of-00003.gguf", 2000],
    ]);
    const 합 = (100 + 3000 + 2000) / (1024 * 1024);
    expect(modelFileSizeMb("qwen38-flash-next")).toBeCloseTo(합, 6);
    // 첫 조각만 잰 값과 **확실히 다르다**는 것까지 못박는다.
    expect(modelFileSizeMb("qwen38-flash-next")).toBeGreaterThan((100 / (1024 * 1024)) * 10);
  });

  it("목록·존재판정이 분할 모델을 본다 — 화면과 에이전트 배정이 여기에 걸려 있다", () => {
    조각놓기("qwen38-flash-next", [
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf", 100],
      ["Qwen3.8-Flash-Next-UD-Q3_K_XL-00002-of-00003.gguf", 3000],
    ]);
    조각놓기("qwen3-14b", [["qwen3-14b.gguf", 4096]]);
    const ids = listAvailableModels().map((m) => m.id).sort();
    expect(ids).toContain("qwen38-flash-next");
    expect(ids).toContain("qwen3-14b");
    expect(isModelAvailable("qwen38-flash-next")).toBe(true);
  });

  it("1번 조각이 없으면 **없는 것으로 본다** — 반쯤 받다 만 폴더를 띄우려다 죽지 않게", () => {
    조각놓기("반쯤받음", [
      ["Foo-00002-of-00003.gguf", 3000],
      ["Foo-00003-of-00003.gguf", 2000],
    ]);
    expect(isModelAvailable("반쯤받음")).toBe(false);
    expect(listAvailableModels().map((m) => m.id)).not.toContain("반쯤받음");
  });

  it("gguf가 아예 없는 폴더는 목록에 안 든다", () => {
    fs.mkdirSync(path.join(tmpModels, "빈폴더"), { recursive: true });
    fs.writeFileSync(path.join(tmpModels, "빈폴더", "README.md"), "x");
    expect(isModelAvailable("빈폴더")).toBe(false);
    expect(modelFileSizeMb("빈폴더")).toBe(0);
  });
});
