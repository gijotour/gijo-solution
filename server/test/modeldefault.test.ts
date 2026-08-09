// 기본 모델이 두 곳에서 어긋나지 않게 (2026-08-09, 계획서 중-4).
//
// 무슨 일이 있었나: 기준 모델을 14B 단일로 바꾸기로 한 결정(2026-08-07)이 **코드에
// 반영되지 않았다.** localengine.ts와 learnloop.ts 둘 다 7.6B(gijo-main-orchestrator)를
// 폴백으로 들고 있었다.
//
// ⚠ 그런데도 **아무 증상이 없었다.** 운영은 app_state의 lastModelId가 14B를 덮고 있어
//   멀쩡히 14B로 돌았기 때문이다(실측: llama-server -m models/qwen3-14b/qwen3-14b.gguf).
//   「돌고 있다」와 「기본값이 맞다」는 다르다 — 기억이 덮으면 기본값이 틀려도 안 드러난다.
//   새로 설치한 기계에는 그 기억이 없다. Mac 올인원 dmg가 7.6B로 뜨면서 드러났다.
//
// 그래서 **소스를 직접 대조**한다. 실행해서는 안 드러나는 종류의 어긋남이기 때문이다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 읽기 = (f: string) => fs.readFileSync(path.join(__dirname, "..", "src", "engine", f), "utf8");

/** `?? "..."` 꼴의 마지막 폴백 문자열을 뽑는다. */
function 폴백(src: string, 앵커: RegExp): string | null {
  const m = 앵커.exec(src);
  return m?.[1] ?? null;
}

describe("기본 모델 — 두 곳이 같은 값을 본다", () => {
  const engine = 폴백(
    읽기("localengine.ts"),
    /const DEFAULT_MODEL_ID = process\.env\.GIJO_DEFAULT_MODEL_ID \?\? "([^"]+)"/,
  );
  const learn = 폴백(
    읽기("learnloop.ts"),
    /return stored \?\? process\.env\.GIJO_DEFAULT_MODEL_ID \?\? "([^"]+)"/,
  );

  it("두 폴백을 소스에서 읽을 수 있다 — 모양이 바뀌면 이 시험부터 고쳐야 한다", () => {
    expect(engine, "localengine.ts의 DEFAULT_MODEL_ID").toBeTruthy();
    expect(learn, "learnloop.ts의 servingBaseModelId 폴백").toBeTruthy();
  });

  it("★ 두 곳이 같다 — 어긋나면 어댑터가 엉뚱한 그릇에 얹힌다", () => {
    expect(learn).toBe(engine);
  });

  it("★★ 승격된 기준 모델이다 — 7.6B 시절 값이 남아 있으면 실패", () => {
    // 2026-08-07 결정: 기준 모델 14B 단일(게이트 routing 66/66 · korean 24/24 · 견고성 29→71).
    // 값 자체를 못 박는다 — 「무엇이든 같기만 하면 된다」로 두면 둘 다 낡아도 통과한다.
    expect(engine).toBe("qwen3-14b");
    expect(engine).not.toBe("gijo-main-orchestrator");
  });
});
