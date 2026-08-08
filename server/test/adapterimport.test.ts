// 전문가 어댑터 반입 (2026-08-09, 사용자 지시 "학습이 잘된 LoRA 등을 넣어서 추가 교육")
//
// 계약: ① GGUF 매직이 맞는 .gguf만 반입 ② 반입=등록(미채택) — 채택 관문은 그대로
// ③ sha256·출처가 note에 남는다 ④ 이름 충돌은 해시 꼬리로 비켜 간다 ⑤ 없는 파일은
// "폴더에 넣어 달라"는 다음 걸음을 담아 거절.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gijo-lora-"));
process.env.GIJO_LORA_DIR = TMP; // ⚠ adapters.ts가 모듈 적재 때 읽는다 — import보다 먼저

type AdaptersMod = typeof import("../src/engine/adapters");
let mod: AdaptersMod;

function ggufFile(name: string, body = "dummy-lora-weights"): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, Buffer.concat([Buffer.from("GGUF"), Buffer.from(body)]));
  return p;
}

beforeAll(async () => {
  mod = await import("../src/engine/adapters");
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("어댑터 반입", () => {
  it("정상 GGUF를 반입하면 미채택으로 등록되고 sha256·출처가 남는다", () => {
    ggufFile("site-b-vuln-expert.gguf");
    const a = mod.importAdapterFromFile({ file: "site-b-vuln-expert.gguf", baseModelId: "qwen3-14b", topic: "취약점" });
    expect(a.adopted).toBe(false); // 반입≠채택 — 게이트+근거를 거쳐야 실린다
    expect(a.topic).toBe("취약점");
    expect(a.note).toContain("sha256");
    expect(a.note).toContain("반입(미채택)");
    expect(mod.getAdapter(a.id)?.file).toContain(TMP.split(path.sep).pop()!);
  });

  it("GGUF 매직이 아니면 거절한다 — 아무 파일이나 어댑터가 되지 않게", () => {
    const p = path.join(TMP, "fake.gguf");
    fs.writeFileSync(p, "NOT-A-GGUF-FILE");
    expect(() => mod.importAdapterFromFile({ file: "fake.gguf", baseModelId: "qwen3-14b" }))
      .toThrow(/GGUF 형식이 아닙니다/);
  });

  it(".gguf 확장자가 아니면 거절한다", () => {
    expect(() => mod.importAdapterFromFile({ file: "adapter.bin", baseModelId: "qwen3-14b" }))
      .toThrow(/gguf/i);
  });

  it("없는 파일은 다음 걸음(폴더에 넣기)을 담아 거절한다", () => {
    expect(() => mod.importAdapterFromFile({ file: "ghost.gguf", baseModelId: "qwen3-14b" }))
      .toThrow(/폴더에 넣어/);
  });

  it("같은 이름을 두 번 반입하면 해시 꼬리로 비켜 등록된다", () => {
    ggufFile("dup-name.gguf", "weights-v1");
    const a1 = mod.importAdapterFromFile({ file: "dup-name.gguf", baseModelId: "qwen3-14b" });
    ggufFile("dup-name.gguf", "weights-v2"); // 내용이 다른 같은 이름
    const a2 = mod.importAdapterFromFile({ file: "dup-name.gguf", baseModelId: "qwen3-14b" });
    expect(a1.id).toBe("dup-name");
    expect(a2.id).toMatch(/^dup-name-[0-9a-f]{8}$/);
  });

  it("베이스 모델 없이는 등록되지 않는다 — LoRA는 베이스 종속 계약", () => {
    ggufFile("no-base.gguf");
    expect(() => mod.importAdapterFromFile({ file: "no-base.gguf", baseModelId: " " }))
      .toThrow(/베이스 모델/);
  });
});
