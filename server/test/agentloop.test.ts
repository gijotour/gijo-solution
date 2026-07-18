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
  it("도구는 의도 단위로 등록돼 있다 (조회 8종 + 쓰기 4종)", () => {
    const tools = listAgentTools();
    expect(tools.map((t) => t.name)).toEqual([
      "list_assets", "get_asset", "search", "explain", "today", "threats", "remediation", "scan_status",
      "register_asset", "assign_finding", "update_finding_status", "bulk_update",
    ]);
    expect(tools.filter((t) => t.write).map((t) => t.name)).toEqual(["register_asset", "assign_finding", "update_finding_status", "bulk_update"]);
    // 메뉴를 가로지르는 도구가 있어야 "오늘 뭐부터?"·"우리 관련 위협?" 같은 질문에 도구 1개로 답한다.
    expect(tools.filter((t) => t.domain === "cross").map((t) => t.name)).toEqual(["search", "explain", "today", "threats", "remediation", "scan_status", "bulk_update"]);
  });

  // threats(CTI×자산) — cti.ts가 기동 시 시드하는 샘플 위협(KoBERT·Qwen2.5·bge-m3 등)과
  // 자산 신호의 교집합. 벤더 키 없이도 매칭이 되도록 시드돼 있다(cti.ts 주석).
  it("threats는 자산이 없으면 겹치는 위협이 없다고 답한다", async () => {
    const out = String(await findAgentTool("threats")!.run({}));
    // 샘플 위협은 있지만(피드 시드) 자산이 0개라 매칭이 없다.
    expect(out).toMatch(/겹치는 것은 없습니다|새로 탐지된 위협이 없습니다/);
  });

  it("threats는 자산 신호가 CTI 탐지와 겹치면 해당 위협·자산 id를 준다", async () => {
    registerAsset({ id: "ai-kobert-01", name: "KoBERT 분류기", path: "models/kobert.onnx" });
    const out = String(await findAgentTool("threats")!.run({ limit: "5" }));
    expect(out).toContain("KoBERT"); // 시드 위협 target 텍스트
    expect(out).toContain("ai-kobert-01"); // 이어서 get_asset 할 수 있게 id 노출
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

  it("같은 도구를 같은 인자로 되풀이하면 재실행 없이 종료해 최종 답을 만든다(루프 낭비 차단)", async () => {
    seedAsset();
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}') // 결정 1 — 실행됨
      .mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}') // 결정 2 — 동일 반복 → 재실행 안 함
      .mockResolvedValueOnce("자산 1개 요약"); // 최종 재작성(composeFinalAnswer)
    const r = await runAgentLoop("자산 목록 계속 봐줘");
    expect(r).not.toBeNull();
    expect(r!.toolCalls).toHaveLength(1); // list_assets는 한 번만 실행
    expect(r!.output).toBe("자산 1개 요약");
    // 결정 2회 + 최종 재작성 1회 = 3회 (반복 재실행으로 MAX_STEPS까지 가지 않는다)
    expect(mockChat).toHaveBeenCalledTimes(3);
  });

  // 실측 버그(2026-07-18): action=final일 때 모델이 도구 결과(자산 목록 등)를 answer에 통째로
  // 뱉으면 maxTokens에서 잘려 JSON이 깨지고, parseDecision이 null을 줘 루프 전체가 폐기→환각 폴백됐다.
  it("최종 답이 잘려 JSON이 깨져도 도구 결과를 살린다(루프 폐기 안 함)", async () => {
    seedAsset();
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}') // step0: 도구 선택
      .mockResolvedValueOnce('{"action":"final","answer":"등록된 AI 자산 6개:\\n- fraud-detect-llm | 사내 | 유형=LLM | 담당=보안팀 | fin') // step1: 잘린 JSON
      .mockResolvedValueOnce("최종 답(재작성)"); // composeFinalAnswer
    const r = await runAgentLoop("자산 다 보여줘");
    expect(r).not.toBeNull(); // 폴백하지 않는다
    expect(r!.toolCalls.map((c) => c.tool)).toContain("list_assets");
    expect(r!.output).toBe("최종 답(재작성)");
  });

  it("도구 결정 JSON이 뒤에서 잘려도 tool·args를 회수한다", async () => {
    seedAsset();
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"get_asset","args":{"assetId":"fraud-detect-llm"}, "answer":"이 자산 상세를 보면 aaaaaaaa') // 잘림
      .mockResolvedValueOnce('{"action":"final"}')
      .mockResolvedValueOnce("상세 답");
    const r = await runAgentLoop("fraud 상세");
    expect(r!.toolCalls[0].tool).toBe("get_asset");
    expect(r!.toolCalls[0].args.assetId).toBe("fraud-detect-llm");
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
    // 서로 다른 인자(get_asset assetId 5종)로 매 스텝 다른 도구 호출 → 중복차단에 안 걸리고 상한까지 간다.
    for (let i = 0; i < 5; i++) {
      mockChat.mockResolvedValueOnce(`{"action":"tool","tool":"get_asset","args":{"assetId":"none-${i}"}}`);
    }
    mockChat.mockResolvedValueOnce("상한 도달 답변");
    const r = await runAgentLoop("자산 계속 봐줘");
    expect(r!.toolCalls).toHaveLength(5);
    expect(r!.output).toBe("상한 도달 답변");
  });
});
