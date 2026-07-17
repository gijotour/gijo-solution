import { describe, it, expect, vi, beforeEach } from "vitest";

// 에이전트 루프의 결정·최종답변 호출을 순서대로 제어한다.
const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { runAgentLoop } from "../src/engine/agentloop";
import { listAgentTools, findAgentTool, validateToolArgs } from "../src/engine/agenttools";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";

function seedAsset(id = "fraud-detect-llm") {
  registerAsset({ id, name: id, path: `models/${id}.gguf` });
}

beforeEach(() => {
  mockChat.mockReset();
  resetAssetsForTests();
});

describe("agenttools — 「AI 자산」 조회 도구", () => {
  // 도구는 화면 메뉴가 아니라 사용자 의도 단위다(2026-07-17 확정) — 목록·상세·찾기·설명·오늘·등록.
  // search/explain/today는 메뉴를 가로지르므로 domain="cross".
  it("도구는 의도 단위로 등록돼 있다 (조회 5종 + 쓰기 3종)", () => {
    const tools = listAgentTools();
    expect(tools.map((t) => t.name)).toEqual([
      "list_assets", "get_asset", "search", "explain", "today",
      "register_asset", "assign_finding", "update_finding_status",
    ]);
    expect(tools.filter((t) => t.write).map((t) => t.name)).toEqual(["register_asset", "assign_finding", "update_finding_status"]);
    // 메뉴를 가로지르는 도구가 있어야 "오늘 뭐부터?" 같은 질문에 도구 1개로 답한다.
    expect(tools.filter((t) => t.domain === "cross").map((t) => t.name)).toEqual(["search", "explain", "today"]);
  });

  it("list_assets는 자산 개수·이름·finding 요약을 담는다", async () => {
    seedAsset();
    recordFindings("fraud-detect-llm", [
      { finding_type: "unsafe_pickle", severity: "critical", evidence: "e", source_tool: "modelscan" },
    ]);
    const out = String(await findAgentTool("list_assets")!.run({}));
    expect(out).toContain("1개");
    expect(out).toContain("fraud-detect-llm");
    expect(out).toContain("critical 1");
  });

  it("get_asset은 없는 자산이면 등록된 id 목록과 함께 안내한다", async () => {
    seedAsset();
    const out = String(await findAgentTool("get_asset")!.run({ assetId: "no-such" }));
    expect(out).toContain("찾을 수 없습니다");
    expect(out).toContain("fraud-detect-llm");
  });

  it("validateToolArgs는 필수 인자 누락을 잡는다", () => {
    const tool = findAgentTool("get_asset")!;
    expect(validateToolArgs(tool, {})).toContain("필수 인자 누락");
    expect(validateToolArgs(tool, { assetId: "x" })).toBeNull();
  });
});

describe("runAgentLoop — 결정→실행→최종답변", () => {
  it("도구 호출 후 최종 답변을 일반 chat 경로로 재작성한다", async () => {
    seedAsset();
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}') // 결정 1
      .mockResolvedValueOnce('{"action":"final"}') // 결정 2 — 결과로 충분
      .mockResolvedValueOnce("등록된 자산은 1개입니다: fraud-detect-llm"); // 최종 재작성(chat)
    const r = await runAgentLoop("자산 몇 개야?");
    expect(r).not.toBeNull();
    expect(r!.output).toBe("등록된 자산은 1개입니다: fraud-detect-llm");
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].tool).toBe("list_assets");
    expect(r!.toolCalls[0].result).toContain("fraud-detect-llm");
    // 결정 호출에는 스키마 강제, 최종 재작성에는 remember(이력·학습루프 수집)가 걸린다.
    expect(mockChat.mock.calls[0][0]).toMatchObject({ agentId: "orchestrator", responseSchema: expect.anything() });
    expect(mockChat.mock.calls[2][0]).toMatchObject({ remember: true });
    expect(mockChat.mock.calls[2][0].message).toContain("fraud-detect-llm");
  });

  it("도구 없이 final이면 null — 기존 채팅 폴백(회귀 없음)", async () => {
    mockChat.mockResolvedValueOnce('{"action":"final","answer":"안녕하세요"}');
    expect(await runAgentLoop("고마워")).toBeNull();
  });

  it("JSON이 아닌 응답(LLM 다운 안내 등)이면 null — 폴백", async () => {
    mockChat.mockResolvedValueOnce("⚠ 로컬 LLM 응답이 제한 시간을 초과했습니다");
    expect(await runAgentLoop("자산 몇 개야?")).toBeNull();
  });

  it("존재하지 않는 도구 이름이면 실행하지 않고 관찰로 알려 재결정시킨다", async () => {
    seedAsset();
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"made_up_tool","args":{}}')
      .mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}')
      .mockResolvedValueOnce('{"action":"final"}')
      .mockResolvedValueOnce("자산 1개");
    const r = await runAgentLoop("자산 보여줘");
    expect(r!.toolCalls[0].result).toContain("존재하지 않는 도구");
    expect(r!.toolCalls[1].tool).toBe("list_assets");
  });

  it("필수 인자 누락이면 실행하지 않고 인자 오류를 관찰로 준다", async () => {
    seedAsset();
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"get_asset","args":{}}')
      .mockResolvedValueOnce('{"action":"tool","tool":"get_asset","args":{"assetId":"fraud-detect-llm"}}')
      .mockResolvedValueOnce('{"action":"final"}')
      .mockResolvedValueOnce("상세 답변");
    const r = await runAgentLoop("fraud 상세");
    expect(r!.toolCalls[0].result).toContain("인자 오류");
    expect(r!.toolCalls[1].result).toContain("fraud-detect-llm");
  });

  it("반복 상한(5회)에 걸리면 모은 결과로라도 최종 답변을 만든다", async () => {
    seedAsset();
    for (let i = 0; i < 5; i++) mockChat.mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}');
    mockChat.mockResolvedValueOnce("상한 도달 답변");
    const r = await runAgentLoop("자산 계속 봐줘");
    expect(r!.toolCalls).toHaveLength(5);
    expect(r!.output).toBe("상한 도달 답변");
  });
});
