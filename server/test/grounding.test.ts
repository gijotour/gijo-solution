import { describe, it, expect, vi, afterEach } from "vitest";

// 관련 자료가 없을 때 normaltic이 LLM을 부르지 않고 "자료 없음"을 돌려주는지.
// 프롬프트 규칙으로는 지켜지지 않던 것을 코드로 보장하는 부분이라 회귀가 특히 아프다.
describe("GIJO Agent 엄격 그라운딩", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.doUnmock("../src/engine/memory.js");
  });

  function mockMemory(relevant: string[]) {
    vi.doMock("../src/engine/memory.js", () => ({
      queryMemoryGraded: async () => ({ chunks: relevant, 약한근거만: false }),
      queryMemory: async () => relevant,
    }));
  }

  it("관련 자료가 없으면 LLM을 부르지 않고 '자료 없음'을 답한다", async () => {
    mockMemory([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    const reply = await chat({ agentId: "normaltic", message: "2026년 프로야구 우승팀이 어디야?" });

    expect(reply).toContain("등록된 사내 자료에는 관련 내용이 없습니다");
    expect(fetchMock).not.toHaveBeenCalled(); // 지어낼 기회 자체를 주지 않는다
  });

  it("관련 자료가 있으면 평소대로 LLM에 묻는다", async () => {
    mockMemory(["AI-BOM은 AI 시스템의 구성요소 명세다..."]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "AI-BOM은 ..." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    const reply = await chat({ agentId: "normaltic", message: "AI-BOM이 뭐야?" });

    expect(fetchMock).toHaveBeenCalled();
    expect(reply).not.toContain("관련 내용이 없습니다");
  });

  it("다른 에이전트는 이 제한을 받지 않는다", async () => {
    mockMemory([]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "일반 답변" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    await chat({ agentId: "analysis", message: "2026년 프로야구 우승팀이 어디야?" });

    expect(fetchMock).toHaveBeenCalled();
  });

  it("검색 자체가 실패하면 막지 않는다 — 임베딩 서버 장애가 채팅을 죽이면 안 된다", async () => {
    vi.doMock("../src/engine/memory.js", () => ({
      queryMemoryGraded: async () => { throw new Error("임베딩 서버 없음"); },
      queryMemory: async () => { throw new Error("임베딩 서버 없음"); },
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "답변" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    const reply = await chat({ agentId: "normaltic", message: "아무 질문" });

    expect(fetchMock).toHaveBeenCalled();
    expect(reply).not.toContain("관련 내용이 없습니다");
  });
});
