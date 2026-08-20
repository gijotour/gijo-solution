// [전중후 계획서 정렬: 전-7 「보여 주기」 연장 — 시나리오 행동 묶음(2026-08-21 ⓐ안)]
// 현황판 판의 📖 시나리오 칩(grouppanels.js scenario 필드)이 보내는 「시나리오: <이름>」이
// 서버 시나리오 분기(scenarios.ts)에 **결정적으로** 닿는지 대조한다.
//
// 왜 필요한가: 이름을 클라와 서버 두 곳에 적는 순간 「같은 것을 여러 곳에 적으면 어긋난다」가
// 성립한다 — 한쪽만 고치면 칩이 조용히 죽고(라우팅이 LLM으로 새고), 화면은 멀쩡해 보인다.
// QA도 이 부류를 못 잡는다(칩은 눌러야 죽은 걸 안다). 그래서 기계가 글자 단위로 대조한다.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SCENARIOS, isScenarioAsk, scenarioAnswer } from "../src/engine/scenarios";

const PANELS = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "grouppanels.js");

function 칩이름들(): string[] {
  const src = fs.readFileSync(PANELS, "utf-8");
  return [...src.matchAll(/scenario:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("현황판 📖 시나리오 칩 ↔ 시나리오 등록부 대조", () => {
  it("판에 적힌 시나리오 이름이 전부 등록부에 글자까지 있다", () => {
    const names = 칩이름들();
    // 빈 검사 방지 — 대응표는 12판이다(kpi·report가 「경영 보고 준비」를 공유해 이름은 11종).
    expect(names.length, "scenario 필드를 하나도 못 찾았다 — 추출 정규식부터 의심할 것").toBeGreaterThanOrEqual(10);
    for (const n of names) {
      expect(
        SCENARIOS.some((s) => s.name === n),
        `등록부(scenarios.ts)에 없는 이름: "${n}" — 칩이 조용히 죽는다(이름 검사 불일치)`
      ).toBe(true);
    }
  });

  it("칩 문구 「시나리오: <이름>」이 시나리오 분기에 결정적으로 닿고, 그 시나리오를 집는다", () => {
    for (const n of 칩이름들()) {
      const 문구 = "시나리오: " + n;
      expect(isScenarioAsk(문구), `분기가 못 받는 문구: ${문구}`).toBe(true);
      const 답 = scenarioAnswer(문구);
      // 목록 답으로 새면 안 된다 — 그 시나리오의 단계 안내가 나와야 한다.
      expect(답.output, `이름을 집지 못하고 목록으로 샜다: ${문구}`).toContain(`시나리오 「${n}」`);
    }
  });
});
