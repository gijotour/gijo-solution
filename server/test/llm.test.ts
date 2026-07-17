import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { chat, systemPromptFor, resetChatHistoryForTests, stripLeadingPreamble } from "../src/engine/llm";

function stubLlm(reply = "답변") {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: reply } }] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("llm chat system prompt (한국어 기본 처리)", () => {
  beforeEach(() => {
    resetChatHistoryForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../src/engine/memory");
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
    // 프롬프트엔 (표시 이름이 아니라) 역할이 들어간다 — orchestrator 역할 "작업 분배 · 결과 취합".
    expect(body.messages[0].content).toContain("작업 분배");
    // 페르소나 자기소개 방지 회귀: 표시 이름을 프롬프트에 주입하지 않는다.
    expect(body.messages[0].content).not.toContain('입니다. 담당 역할');
    expect(body.messages[0].content).toContain("반드시 한국어로");
    expect(body.messages[0].content).toContain("지어내지 않습니다");
    expect(body.messages[1]).toEqual({ role: "user", content: "SQL 인젝션이 뭐야?" });
  });

  it("unknown agentId still gets the generic Korean security-assistant prompt", () => {
    const prompt = systemPromptFor("nonexistent-agent");
    expect(prompt).toContain("보안 어시스턴트");
    expect(prompt).toContain("반드시 한국어로");
  });

  describe("stripLeadingPreamble (응답 후처리 — 인사말·예고 서두 제거, 본문 보존)", () => {
    it("쉼표로 붙은 선행 인사 제거", () => {
      expect(stripLeadingPreamble("안녕하세요, 이번 주 보안 현황은 양호합니다.")).toBe("이번 주 보안 현황은 양호합니다.");
    });
    it("인사 문장 제거", () => {
      expect(stripLeadingPreamble("안녕하세요. 취약점 3건입니다.")).toBe("취약점 3건입니다.");
    });
    it("응답-메타 예고 문장 제거", () => {
      expect(stripLeadingPreamble("이번 달 취약점 조치 현황을 보고드리겠습니다. 총 50건입니다.")).toBe("총 50건입니다.");
    });
    it("자기소개 문장 제거", () => {
      expect(stripLeadingPreamble("저는 보안 담당 AI입니다. Log4Shell은 즉시 패치해야 합니다.")).toBe("Log4Shell은 즉시 패치해야 합니다.");
    });
    it("실제 조치문(메타어 없음)은 보존", () => {
      const t = "즉시 패치를 적용하겠습니다. 그다음 재스캔합니다.";
      expect(stripLeadingPreamble(t)).toBe(t);
    });
    it("구조화 출력(상태:/번호목록)은 건드리지 않음", () => {
      expect(stripLeadingPreamble("상태: partial\n근거: 부분 대응")).toBe("상태: partial\n근거: 부분 대응");
      expect(stripLeadingPreamble("1. Apache Log4j RCE\n2. OpenSSH")).toBe("1. Apache Log4j RCE\n2. OpenSSH");
    });
    it("응답 전체가 인사/예고뿐이면(뒤 본문 없음) 지우지 않음", () => {
      expect(stripLeadingPreamble("안녕하세요.")).toBe("안녕하세요.");
    });
  });

  it("each defined agent gets its own role in the prompt", () => {
    expect(systemPromptFor("analysis")).toContain("우선순위 판단");
    expect(systemPromptFor("scan")).toContain("스캔 결과");
    expect(systemPromptFor("report")).toContain("보고서");
  });

  it("remember:true carries prior turns into the next call (단기 기억)", async () => {
    // 개발 머신에 실제 LanceDB가 있어도 테스트가 흔들리지 않도록 장기 기억은 빈 결과로 고정
    vi.doMock("../src/engine/memory", () => ({ queryMemory: vi.fn().mockResolvedValue([]) }));
    const fetchMock = stubLlm("첫 번째 답변");
    await chat({ agentId: "orchestrator", message: "첫 질문", remember: true });

    stubLlm("두 번째 답변");
    const fetchMock2 = global.fetch as ReturnType<typeof vi.fn>;
    await chat({ agentId: "orchestrator", message: "두 번째 질문", remember: true });

    const body = JSON.parse(fetchMock2.mock.calls[0][1].body);
    const roles = body.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("첫 질문");
    expect(body.messages[2].content).toBe("첫 번째 답변");
    expect(body.messages[3].content).toBe("두 번째 질문");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("history is capped at 20 messages (컨텍스트 창 보호)", async () => {
    vi.doMock("../src/engine/memory", () => ({ queryMemory: vi.fn().mockResolvedValue([]) }));
    for (let i = 0; i < 15; i++) {
      stubLlm(`답변${i}`);
      await chat({ agentId: "orchestrator", message: `질문${i}`, remember: true });
    }
    const fetchMock = stubLlm("최종");
    await chat({ agentId: "orchestrator", message: "최종 질문", remember: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // system 1 + 이력 최대 20 + 새 user 1
    expect(body.messages.length).toBeLessThanOrEqual(22);
  });

  it("programmatic calls (remember 미지정) stay stateless and don't pollute history", async () => {
    stubLlm("분석 결과");
    await chat({ agentId: "analysis", message: "findings JSON..." });

    const fetchMock = stubLlm("다음");
    await chat({ agentId: "analysis", message: "또 다른 findings..." });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  it("injects RAG context into the single system prompt (장기 기억 — Mistral 템플릿은 system 2개를 거부)", async () => {
    vi.doMock("../src/engine/memory", () => ({
      queryMemory: vi.fn().mockResolvedValue(["사내 규정: pickle 파일은 반드시 스캔 후 반입한다."]),
    }));
    const fetchMock = stubLlm();

    await chat({ agentId: "orchestrator", message: "pickle 파일 반입 규정 알려줘", remember: true });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemMessages = body.messages.filter((m: { role: string }) => m.role === "system");
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain("반드시 한국어로");
    expect(systemMessages[0].content).toContain("참고 자료");
    expect(systemMessages[0].content).toContain("pickle 파일은 반드시 스캔 후 반입");
    expect(body.messages[1]).toEqual({ role: "user", content: "pickle 파일 반입 규정 알려줘" });
  });

  it("chat still works when the embedding server / knowledge base is unavailable", async () => {
    vi.doMock("../src/engine/memory", () => ({
      queryMemory: vi.fn().mockRejectedValue(new Error("임베딩 서버에 연결할 수 없습니다")),
    }));
    const fetchMock = stubLlm("RAG 없이 답변");

    const reply = await chat({ agentId: "orchestrator", message: "질문", remember: true });

    expect(reply).toBe("RAG 없이 답변");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });
});
