// 학습 실행 환경 — **세 단계가 같은 환경을 보는가**를 소스로 지킨다.
//
// 실사고(2026-08-08): 원클릭 루프의 사전 점검·학습·GGUF 변환이 각자 `python`을 불렀다.
// 그 파이썬은 서버 자신의 가상환경이라 학습 의존성이 없었고, 루프는 "No module named
// 'unsloth'"로 죽었다. 게다가 화면 처방("pip install unsloth")은 낡아서, 그대로 따랐다면
// 설치 후 다음 단계에서 또 막혔을 것이다 — 지금 학습 스크립트는 unsloth를 쓰지 않는다.
//
// 함수를 만들어 두는 것만으로는 재발을 못 막는다(이 저장소에서 아홉 곳이 새어 나간 전례).
// 그래서 **호출부가 실제로 그 함수를 부르는지 소스를 읽어** 확인한다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { trainPython, TRAIN_SCRIPT, TRAIN_DEPS, adapterWorkDir, hfSnapshotDir } from "../src/engine/trainenv";

const src = (rel: string) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

describe("학습 환경은 한 곳에서만 정한다", () => {
  it("학습·변환·사전 점검이 모두 trainenv를 거친다", () => {
    const finetune = src("engine/finetune.ts");
    const learnloop = src("engine/learnloop.ts");
    expect(finetune).toContain("from \"./trainenv\"");
    expect(learnloop).toContain("from \"./trainenv\"");
    // 학습 스폰 · 변환 스폰 · 사전 점검 — 세 곳 모두 trainPython()으로 파이썬을 고른다.
    expect(finetune).toMatch(/const python = trainPython\(\)/);
    expect((learnloop.match(/trainPython\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("맨 `python`을 직접 스폰하는 자리가 남아 있지 않다", () => {
    for (const rel of ["engine/finetune.ts", "engine/learnloop.ts"]) {
      const code = src(rel).replace(/\/\/[^\n]*/g, ""); // 주석의 설명 문구는 제외
      expect(code, `${rel}에 spawn("python") 잔존`).not.toMatch(/spawn(Sync)?\(\s*"python"/);
    }
  });

  it("은퇴한 unsloth 경로를 다시 부르지 않는다", () => {
    // 주석에는 "예전엔 …를 불렀다"는 내력이 남아도 된다 — 실행되는 코드만 본다.
    const finetune = src("engine/finetune.ts").replace(/\/\/[^\n]*/g, "");
    expect(finetune).not.toContain("finetune_unsloth.py");
    // 사전 점검도 unsloth를 필수로 요구하지 않는다(요구하면 설치해도 다음 단계에서 막힌다).
    expect(TRAIN_DEPS.map((d) => d.key)).not.toContain("unsloth");
    expect(TRAIN_DEPS.map((d) => d.key)).toEqual(
      expect.arrayContaining(["torch", "transformers", "peft", "bitsandbytes", "gguf"])
    );
  });

  it("학습이 떨구는 자리와 변환이 읽는 자리가 같다", () => {
    const learnloop = src("engine/learnloop.ts");
    const finetune = src("engine/finetune.ts");
    // 두 곳 모두 adapterWorkDir()를 쓴다 — 한쪽이 경로를 직접 적으면 조용히 어긋난다.
    expect(finetune).toContain("adapterWorkDir(");
    expect(learnloop).toContain("adapterWorkDir(");
    expect(learnloop).not.toMatch(/path\.join\("outputs",\s*datasetId,\s*"lora-adapter"\)/);
  });

  it("GGUF 변환에 베이스 스냅샷 실경로를 넘긴다", () => {
    // convert_lora_to_gguf.py는 config.json이 든 폴더를 --base로 요구한다. 리포지터리 id를
    // 그대로 주면 네트워크를 타 폐쇄망에서 실패한다(1회전에서 실경로로 통과시킨 길).
    const learnloop = src("engine/learnloop.ts");
    expect(learnloop).toContain("hfSnapshotDir(");
    expect(learnloop).toMatch(/args\.push\("--base"/);
  });

  it("학습 스크립트는 현행(unsloth 없는) 경로이고 실재한다", () => {
    expect(TRAIN_SCRIPT).toContain("finetune_qlora14b.py");
    expect(fs.existsSync(path.join(__dirname, "..", TRAIN_SCRIPT))).toBe(true);
  });

  it("스모크 모드가 학습 스크립트에 실재한다(시험 계약)", () => {
    // 배선을 새 스크립트로 옮기면서 --smoke가 없으면 스모크 시험이 통째로 죽는다.
    const py = fs.readFileSync(path.join(__dirname, "..", TRAIN_SCRIPT), "utf8");
    expect(py).toContain("--smoke");
  });
});

describe("경로 해석", () => {
  it("파이썬 경로는 항상 무언가를 돌려준다(마지막 폴백 포함)", () => {
    expect(trainPython().length).toBeGreaterThan(0);
  });

  it("데이터셋별 산출 자리는 결정적이다", () => {
    expect(adapterWorkDir("loop-20260808-1200")).toBe(path.join("outputs", "loop-20260808-1200", "lora-adapter"));
  });

  it("캐시에 없는 베이스는 null — 없는 경로를 지어내지 않는다", () => {
    expect(hfSnapshotDir("no-such-org/no-such-model-" + Date.now())).toBeNull();
  });
});
