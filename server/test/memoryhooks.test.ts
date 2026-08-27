// memoryhooks.test.ts — 지식 층이 업무 층을 **모르게** 뒤집은 훅의 등록 계약(2026-08-28 화살 #13).
//
// ★ 왜 이 시험이 있나
//   memory.ts가 매뉴얼 문서를 보안제품에 연결하려고 `await import("./securityproducts.js")`로
//   **위층을 직접** 불렀다(memory ⇄ securityproducts 순환). 훅으로 뒤집으면서 위험이
//   「직접 호출 빠뜨림」에서 **「등록을 잊음」**으로 옮겨 갔다 — 등록이 없으면 청취자 루프가
//   0회 돌고 매뉴얼 자동 연결이 **소리 없이** 안 된다(오류도 화면 변화도 없다).
//   autoassign 화살 #7과 같은 부류이고, 같은 방식으로 못 박는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { manualClassifiedListenerCount } from "../src/engine/memory";
import { 매뉴얼연결_배선 } from "../src/engine/securityproducts";

describe("★ 매뉴얼 자동 연결 배선 — 등록이 없으면 소리 없이 죽는다", () => {
  it("app.ts가 매뉴얼연결_배선을 부른다 — 이 줄이 빠지면 자동 연결 전체가 죽는다", () => {
    const app = readFileSync(join(__dirname, "..", "src", "app.ts"), "utf-8");
    expect(app, "app.ts에서 매뉴얼연결_배선() 호출이 사라졌다 — 매뉴얼을 올려도 제품에 안 붙는다")
      .toContain("매뉴얼연결_배선()");
  });

  it("배선하면 청취자가 실제로 는다", () => {
    const 전 = manualClassifiedListenerCount();
    매뉴얼연결_배선();
    expect(manualClassifiedListenerCount(), "등록이 청취자를 안 늘렸다 — 배선이 헛돈다").toBe(전 + 1);
  });

  it("지식 층은 업무 층을 모른다 — memory.ts가 securityproducts를 다시 안 문다", () => {
    const m = readFileSync(join(__dirname, "..", "src", "engine", "memory.ts"), "utf-8");
    expect(m, "memory가 securityproducts를 다시 문다 — 순환이 부활한다")
      .not.toContain('import("./securityproducts');
    expect(m, "memory가 securityproducts를 정적으로 문다 — 더 나쁘다")
      .not.toContain('from "./securityproducts"');
  });

  it("★ embed는 잎으로 내려갔다 — memory가 embed 하나 때문에 llm 전체를 물지 않는다(화살 #12)", () => {
    const m = readFileSync(join(__dirname, "..", "src", "engine", "memory.ts"), "utf-8");
    expect(m, "memory가 embed를 다시 llm에서 가져온다 — llm ⇄ memory 순환이 부활한다")
      .not.toMatch(/import \{[^}]*\bembed\b[^}]*\} from "\.\/llm"/);
    expect(m, "memory가 잎(embedding)을 안 쓴다").toContain('from "./embedding"');
    // 재수출은 살아 있어야 한다 — 옛 호출부(라우트·시험)가 llm.embed를 그대로 쓴다.
    const l = readFileSync(join(__dirname, "..", "src", "engine", "llm.ts"), "utf-8");
    expect(l, "llm이 embed 재수출을 잃었다 — 옛 호출부가 깨진다").toContain('export { embed } from "./embedding"');
  });
});
