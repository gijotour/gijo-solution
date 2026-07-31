// 평가 게이트는 **끝까지 기다려서 잰다** (2026-07-31)
//
// 30초를 넘긴 답은 제품이 리포트로 넘긴다 — 사람을 기다리게 하지 않으려는 배려다.
// 그런데 게이트에는 그 배려가 해롭다. 안내 문구만 돌아와 문항이 재려던 것을 아예 못 재고,
// '측정 못 함'으로 분모에서 빠진다. **그 자리에 결함이 숨어도 점수에 안 나타난다**
// (실측: 라우팅 축 2문항이 그렇게 빠졌고, 그중 하나는 화면 안내 문항이었다).
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { LONG_ANSWER_MS, QA_LONG_ANSWER_MS } from "../src/engine/longanswer";

describe("★ 게이트는 사람보다 오래 기다린다", () => {
  it("qa 대기 시간이 사람 대기 시간보다 길다", () => {
    expect(QA_LONG_ANSWER_MS).toBeGreaterThan(LONG_ANSWER_MS);
  });

  it("무한정은 아니다 — 매달린 요청이 게이트를 멈추게 하면 안 된다", () => {
    expect(Number.isFinite(QA_LONG_ANSWER_MS)).toBe(true);
    expect(QA_LONG_ANSWER_MS).toBeLessThanOrEqual(600_000);
  });

  it("dispatch 라우트가 qa일 때 그 시간을 쓴다", () => {
    // 상수만 만들고 안 쓰면 아무것도 안 바뀐다 — 실제로 갈아 끼웠는지 소스로 본다.
    const src = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    expect(src).toContain("qa ? QA_LONG_ANSWER_MS : LONG_ANSWER_MS");
    expect(src, "만든 상수를 타이머에 안 물리면 소용없다").toContain("resolve(null), limitMs)");
  });

  it("사람 경로는 그대로 30초다 — 배려를 걷어내지 않았다", () => {
    expect(LONG_ANSWER_MS).toBe(30_000);
  });

  it("★ 게이트가 서버보다 오래 기다린다 — 기다리는 쪽이 먼저 포기하면 안 된다", () => {
    // 둘을 같게 두었더니 서버가 답을 막 돌려주는 순간 게이트가 끊어져
    // "aborted due to timeout"이 났다(2026-07-31 실측: multi-scan-report).
    // '측정 못 함'을 없애려고 서버 대기를 늘렸는데, 클라이언트가 그대로면 오류로 바뀔 뿐이다.
    const gate = fs.readFileSync(new URL("../../tools/evalgate/run.mjs", import.meta.url), "utf8");
    const m = gate.match(/GIJO_EVALGATE_TIMEOUT_MS \?\? (\d+)/);
    expect(m, "게이트 타임아웃 상수를 못 찾았다 — 시험이 헛돌고 있다").not.toBeNull();
    expect(Number(m![1]), "게이트가 서버 대기보다 짧으면 잰 것도 못 쓴다").toBeGreaterThan(QA_LONG_ANSWER_MS);
  });
});
