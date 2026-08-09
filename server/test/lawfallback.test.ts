// 법령을 못 찾으면 모델에게 넘긴다 — 가로채기 회귀 수리 (2026-08-09, 계획서 후-3).
//
// 무슨 일이 있었나: 법령 도구가 생기자 모델이 그걸 집으면서, 답이 있던 질문에도
// "🔎 찾지 못했습니다"만 나갔다. 회귀 하네스(tools/regress)가 잡았다 —
// 150상황은 **통과시켰다**(그 문항에 기대 신호가 없어 형식만 봤다).
//
// 실측으로 확인한 것:
//   · 사내 지식에 답이 있나 → **0건**(두 질문 모두). 되짚을 곳이 없다.
//   · 모델이 직접 답하면?   → 제30조·1년을 정확히 답한다. 원래 답은 여기서 나왔다.
// 그래서 「사내 지식으로 되짚기」가 아니라 **「못 찾으면 모델에게 넘기기」**가 맞는 수리다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 법령한계를밝힌다 } from "../src/engine/agentloop";
import { NO_HIT_PREFIX } from "../src/engine/agenttools";

const 못찾음 = `${NO_HIT_PREFIX} "금융권 망분리"로는 법령 검색 결과가 없습니다.`;
const 찾음 = "법령 검색 — \"개인정보 보호법\" (상위 2건)\n1. 개인정보 보호법";

describe("못 찾았을 때만 딱지를 붙인다", () => {
  it("★ 못 찾아 모델이 대신 답했으면 — 확인 못 했다고 못 박는다", () => {
    const r = 법령한계를밝힌다("접속기록은 최소 1년 보관해야 합니다.", [
      { tool: "law_lookup", args: {}, result: 못찾음 },
    ] as never);
    expect(r).toContain("법제처에서 원문을 확인하지 못한 답입니다");
    expect(r).toContain("국가법령정보센터에서 대조");
    expect(r).toContain("1년 보관"); // 원래 답은 살아 있다
  });

  it("★★ 찾았으면 딱지를 안 붙인다 — 원문을 찾은 답까지 의심하게 만들면 안 된다", () => {
    const r = 법령한계를밝힌다(찾음, [{ tool: "law_lookup", args: {}, result: 찾음 }] as never);
    expect(r).toBe(찾음);
  });

  it("법령 도구를 안 썼으면 아무것도 안 붙인다", () => {
    const 답 = "미조치 취약점은 4건입니다.";
    expect(법령한계를밝힌다(답, [{ tool: "finding_status", args: {}, result: "4건" }] as never)).toBe(답);
    expect(법령한계를밝힌다(답, [] as never)).toBe(답);
  });

  it("빈 답에는 딱지만 남기지 않는다 — 딱지뿐인 답은 답이 아니다", () => {
    expect(법령한계를밝힌다("", [{ tool: "law_lookup", args: {}, result: 못찾음 }] as never)).toBe("");
  });
});

describe("직답 경로 예외 (소스 계약)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");

  it("★ 법령만 예외 — 못 찾으면 null을 돌려 모델에게 넘긴다", () => {
    expect(src).toContain('return only.tool === "law_lookup" ? null : 사람용으로다듬기(only.result);');
  });

  it("★★ 찾았을 땐 여전히 directAnswer — 조문을 모델이 고쳐 쓰지 못하게", () => {
    expect(src).toContain("return findAgentTool(only.tool)?.directAnswer ? 사람용으로다듬기(only.result) : null;");
  });

  it("딱지는 출구 두 곳 모두에 걸린다 — 한 곳만 걸면 다른 길로 샌다", () => {
    const 배선 = (src.match(/법령한계를밝힌다\(guardAgainstDenial\(composed, calls\), calls\)/g) ?? []).length;
    expect(배선, "강제 분기 경로와 일반 루프 경로 둘 다").toBe(2);
  });
});
