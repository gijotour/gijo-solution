import { describe, it, expect, afterEach, vi } from "vitest";
import { chat, systemPromptFor } from "../src/engine/llm";

describe("llm chat system prompt (한국어 기본 처리)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("every agent call carries a Korean system prompt with the agent's role", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "답변" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await chat({ agentId: "orchestrator", message: "SQL 인젝션이 뭐야?" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("오케스트레이터");
    expect(body.messages[0].content).toContain("반드시 한국어로");
    expect(body.messages[0].content).toContain("지어내지 않습니다");
    expect(body.messages[1]).toEqual({ role: "user", content: "SQL 인젝션이 뭐야?" });
  });

  it("unknown agentId still gets the generic Korean security-assistant prompt", () => {
    const prompt = systemPromptFor("nonexistent-agent");
    expect(prompt).toContain("보안 어시스턴트");
    expect(prompt).toContain("반드시 한국어로");
  });

  it("each defined agent gets its own role in the prompt", () => {
    expect(systemPromptFor("analysis")).toContain("우선순위 판단");
    expect(systemPromptFor("cti")).toContain("딥웹");
    expect(systemPromptFor("report")).toContain("보고서");
  });
});
