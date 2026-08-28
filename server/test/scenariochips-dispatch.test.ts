// [전-7 연장 — 시나리오 행동 묶음(2026-08-21)] 📖 칩 문구의 **배관 실측**.
//
// scenariochips.test.ts는 순수 함수 2개(isScenarioAsk·scenarioAnswer)까지만 증명한다.
// 실제 칩 문구는 dispatcher의 결정적 분기 8개(가드·카드·되묻기·목록·범위 등)를 **먼저**
// 지나므로, 앞 분기가 하나 넓어지면 칩이 조용히 죽고 그 시험은 초록으로 남는다 —
// 검토관 ③낮6이 정확히 이 공백을 지적했다. 여기서는 dispatchInstruction을 그대로 태워
// 「앞에서 안 삼키고 시나리오 답이 나온다」를 배관 수준으로 못박는다.
import { describe, it, expect, vi } from "vitest";

// LLM은 모의로 — 문구가 결정적 분기를 놓치고 LLM까지 흘러가면 답이 "[mock]"이 되므로,
// 그 자체가 「칩이 죽었다」의 검출기가 된다.
vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다 — verifyroutes 6개가 실증).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import { dispatchInstruction } from "../src/engine/dispatcher";

const PANELS = path.join(__dirname, "..", "..", "client", "src", "renderer", "pages", "grouppanels.js");
const 이름들 = [...new Set(
  [...fs.readFileSync(PANELS, "utf-8").matchAll(/scenario:\s*"([^"]+)"/g)].map((m) => m[1])
)];

describe("📖 시나리오 칩 — dispatcher 배관 실측", () => {
  it("칩 이름을 하나라도 못 뽑으면 이 시험은 빈 검사다", () => {
    expect(이름들.length).toBeGreaterThanOrEqual(12); // 13판 · 이름 12종(경영 보고 준비 공유, 2026-08-21 2종 추가)
  });

  for (const 이름 of 이름들) {
    it(`「시나리오: ${이름}」이 앞 분기에 안 삼키고 단계 안내에 닿는다`, async () => {
      const r = await dispatchInstruction("시나리오: " + 이름);
      expect(r.output, "LLM으로 샜다 — 결정적 분기가 못 받았다").not.toBe("[mock]");
      expect(r.output).toContain(`시나리오 「${이름}」`);
    });
  }

  it("셸 표식이 붙어도 같다 — 실제 칩은 「\\n#셸 pro」를 달고 온다", async () => {
    const r = await dispatchInstruction("시나리오: 아침 브리핑\n#셸 pro");
    expect(r.output).toContain("시나리오 「아침 브리핑」");
  });
});
