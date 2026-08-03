// 강제 라우팅이 **쓰기 도구를 만났을 때** — 실행하지 않고 결재판을 띄운다.
//
// 왜 필요한가(2026-08-03 서랍 점검): "새 자산 등록할게"에
//   **Tenable Security Center 로그인 → Explore > Assets** 남의 제품 매뉴얼 절차를 답했다.
//   `register_asset` 도구도 있고 라우팅 규칙도 넣었는데, **실행 문턱에서 조용히 샜다** —
//   강제 경로가 `!tool.write`일 때만 실행하고, 쓰기 도구면 아무 일도 안 하고 빠져나갔다.
//   그래서 LLM에게 넘어갔고 벤더 문서를 읽어 줬다.
//
// ★ 지킬 것 둘 (둘 다 중요하다):
//   ① **강제로 쓰지 않는다** — 사람 확인 없이 상태를 바꾸면 안 된다
//   ② **조용히 빠져나가지도 않는다** — 결재판을 띄워 무엇을 할지 보여준다
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { runAgentLoop, resetContextForTests } from "../src/engine/agentloop";
import { findAgentTool } from "../src/engine/agenttools";
import { resetAssetsForTests } from "../src/engine/assets";

beforeEach(() => {
  mockChat.mockReset();
  resetAssetsForTests();
  resetContextForTests();
});

describe("★ 강제 라우팅 × 쓰기 도구", () => {
  it("「새 자산 등록할게」가 결재판을 띄운다 — LLM에게 새지 않는다", async () => {
    // mockChat을 큐잉하지 않는다 — 강제 경로면 LLM 호출 자체가 없어야 한다.
    const r = await runAgentLoop("새 자산 등록할게");
    expect(r, "루프가 아무것도 안 돌려줬다 — LLM으로 샌다").not.toBeNull();
    expect(r!.approval?.tool, "결재판이 안 뜬다").toBe("register_asset");
    expect(mockChat, "LLM을 불렀다 — 강제 경로가 안 먹었다").not.toHaveBeenCalled();
  });

  it("★ 승인 전에는 **아무것도 쓰지 않는다**", async () => {
    const { listAssets } = await import("../src/engine/assets");
    const 전 = listAssets().length;
    await runAgentLoop("새 자산 등록할게");
    expect(listAssets().length, "확인도 안 받고 자산을 만들었다").toBe(전);
  });

  it("결재판이 **무엇이 필요한지** 되묻는다(빈 칸을 남긴다)", async () => {
    const r = await runAgentLoop("새 자산 등록할게");
    const 필수 = r!.approval!.fields.filter((f) => f.required);
    expect(필수.length, "필수 항목이 하나도 없다 — 결재판이 빈 껍데기다").toBeGreaterThan(0);
    // 이름을 안 말했으니 비어 있어야 한다 — 지어내면 사람이 무심코 승인한다.
    expect(r!.approval!.missing.length, "안 말한 값을 채워 놨다").toBeGreaterThan(0);
  });

  it("등록 도구는 실제로 쓰기 도구다 — 이 시험의 전제", () => {
    expect(findAgentTool("register_asset")?.write, "쓰기가 아니면 이 시험이 헛돈다").toBe(true);
  });

  it("★ 조회는 그대로 실행된다 — 결재판을 남발하지 않는다", async () => {
    const r = await runAgentLoop("오늘 뭐부터 해야 해?");
    expect(r!.approval, "조회인데 결재판이 뜬다 — 아무도 안 쓴다").toBeFalsy();
    expect(r!.toolCalls[0]?.tool).toBe("today");
  });
});
