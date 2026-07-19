import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { chat, systemPromptFor, resetChatHistoryForTests, stripLeadingPreamble, hasEnglishDrift, hangulRatio } from "../src/engine/llm";

// 실측(2026-07-19) 재현 사례: "취약점 조치 우선순위를 정할 때 무엇을 먼저 보나요?" 에 대한 전면 영어 응답.
const ENGLISH_DRIFT_REPLY =
  "When it comes to determining the priority for addressing vulnerabilities, the first thing to look at is the CVSS base score combined with the VPR. " +
  "Exploitability in the wild, asset criticality, and network exposure should all be weighed before scheduling a patch window.";

// 정상 한국어 답변 — 고유 표기(CVE·제품명·버전·명령어)가 잔뜩 섞여 있어도 드리프트가 아니다.
const KOREAN_WITH_PROPER_NOUNS =
  "CVE-2021-44228(Log4Shell)은 Apache Log4j 2.14.1 이하에서 발생하는 원격 코드 실행 취약점입니다. " +
  "CVSS 10.0, EPSS 0.975이며 CISA KEV 목록에 등재되어 우선 조치 대상입니다. " +
  "조치는 `log4j-core-2.17.1.jar` 로 교체하거나 JndiLookup 클래스를 제거하는 방식으로 합니다.";

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
    it("제목 라인 뒤 인사말도 제거", () => {
      expect(stripLeadingPreamble("[제목] 보안 현황 요약\n\n안녕하세요. 취약점 5건입니다.")).toBe("취약점 5건입니다.");
      expect(stripLeadingPreamble("# 주간 리포트\n안녕하세요. Critical 2건 발견.")).toBe("Critical 2건 발견.");
    });
  });

  describe("영어 드리프트 감지 (한글 음절 비율)", () => {
    it("전면 영어 응답을 드리프트로 판정", () => {
      expect(hasEnglishDrift(ENGLISH_DRIFT_REPLY)).toBe(true);
      expect(hangulRatio(ENGLISH_DRIFT_REPLY)).toBeLessThan(0.05);
    });

    it("정상 한국어 응답은 드리프트가 아님", () => {
      const ko =
        "취약점 조치 우선순위는 심각도 점수만으로 정하지 않습니다. 실제 악용 여부와 자산 중요도, 외부 노출 경로를 함께 봐야 합니다. " +
        "내부에만 열려 있고 보상 통제가 있는 자산은 점수가 높아도 뒤로 미룰 수 있습니다.";
      expect(hasEnglishDrift(ko)).toBe(false);
    });

    it("고유명사·코드가 많은 한국어 응답은 오탐하지 않음 (임계치 여유 확인)", () => {
      expect(hasEnglishDrift(KOREAN_WITH_PROPER_NOUNS)).toBe(false);
      expect(hangulRatio(KOREAN_WITH_PROPER_NOUNS)).toBeGreaterThan(0.25);
    });

    it("코드 블록은 측정에서 제외 — 코드가 본문을 압도해도 오탐하지 않음", () => {
      const withCode =
        "재현 명령은 아래와 같습니다. 실행 후 응답 헤더를 확인하세요.\n" +
        "```bash\ncurl -sS -H 'X-Api-Version: 2' https://example.internal/api/health --resolve example.internal:443:10.0.0.5 -o /dev/null -w '%{http_code}\\n'\n```";
      expect(hasEnglishDrift(withCode)).toBe(false);
    });

    it("표본이 짧으면 판정하지 않음 (비율 요동 방지)", () => {
      expect(hasEnglishDrift("OK")).toBe(false);
      expect(hasEnglishDrift("nginx 1.24.0")).toBe(false);
    });

    it("영어 응답이면 한국어 강제로 1회 재생성하고 한국어 쪽을 채택", async () => {
      const korean = "조치 우선순위는 CVSS 점수와 VPR을 함께 보고, 실제 악용 여부와 자산 중요도를 반영해 정합니다.";
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: ENGLISH_DRIFT_REPLY } }] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: korean } }] }) });
      vi.stubGlobal("fetch", fetchMock);

      const reply = await chat({ agentId: "analysis", message: "취약점 조치 우선순위를 정할 때 무엇을 먼저 보나요?" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      const roles = retryBody.messages.map((m: { role: string }) => m.role);
      expect(roles).toEqual(["system", "user", "assistant", "user"]);
      expect(retryBody.messages[3].content).toContain("영어로 작성");
      expect(reply).toBe(korean);
    });

    it("재생성도 영어면 원래 답을 버리지 않음 (더 나은 쪽 채택)", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: ENGLISH_DRIFT_REPLY } }] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const reply = await chat({ agentId: "analysis", message: "우선순위 기준은?" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(reply).toBe(ENGLISH_DRIFT_REPLY); // 빈 응답으로 떨어뜨리지 않는다
    });

    it("정상 한국어 응답이면 재생성하지 않음 (불필요한 추론 비용 방지)", async () => {
      const fetchMock = stubLlm(KOREAN_WITH_PROPER_NOUNS);
      await chat({ agentId: "analysis", message: "Log4Shell 설명해줘" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("each defined agent gets its own role in the prompt", () => {
    expect(systemPromptFor("analysis")).toContain("우선순위 판단");
    expect(systemPromptFor("scan")).toContain("초기 데이터 해석");
    expect(systemPromptFor("report")).toContain("보고서");
    expect(systemPromptFor("ti")).toContain("위협 인텔리전스");
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
