import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { chat, systemPromptFor, resetChatHistoryForTests, stripLeadingPreamble, hasEnglishDrift, hangulRatio, 사내특정대상질문 } from "../src/engine/llm";

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

  // [전중후 계획서 정렬: 중-3] 평가 게이트 오염 차단 — 게이트 문답은 제품 경로(RAG 등)는
  // 그대로 타되 학습 수집(chat_logs)과 대화 이력에 남으면 안 된다. 기존 regress 11문항이
  // 실제로 학습 후보함에 새고 있었다(2026-07-29 발견) — 그 구멍을 막았음을 고정한다.
  it("qa:true — 답변은 정상, chat_logs·대화 이력에는 남지 않는다 (게이트 오염 차단)", async () => {
    // 2026-08-29 화살 #15 — 대화 수집은 이제 **등록된 수집기**가 한다(llm이 learnloop를
    //   직접 안 문다). 아래 「대조: qa 없으면 수집된다」가 성립하려면 여기서 배선해야 한다.
    //   ⚠ 이 줄이 없으면 chat_logs가 늘 0이라 **대조가 헛통과**한다(감시가 형해화).
    const { 대화수집_배선 } = await import("../src/engine/learnloop");
    대화수집_배선();
    const { db } = await import("../src/db");
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM chat_logs").get() as { n: number }).n;

    const before = count();
    const reply = await (stubLlm("게이트 검증 답변"), chat({ agentId: "orchestrator", message: "평가 게이트 문항 1", remember: true, qa: true }));
    expect(reply).toContain("게이트 검증");
    expect(count()).toBe(before); // 학습 수집 없음

    // 이력 미저장·미주입 — 다음 qa 호출의 메시지에 직전 문답이 없다(문항 간 독립)
    const fetchMock2 = stubLlm("다음 답변");
    await chat({ agentId: "orchestrator", message: "평가 게이트 문항 2", remember: true, qa: true });
    const body = JSON.parse(fetchMock2.mock.calls[0][1].body);
    expect(JSON.stringify(body.messages)).not.toContain("평가 게이트 문항 1");

    // 대조: qa 없는 같은 호출은 수집된다 — 플래그가 실제 분기임을 못박는다
    stubLlm("실사용 답변");
    await chat({ agentId: "orchestrator", message: "실사용 질문", remember: true });
    expect(count()).toBe(before + 1);
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
    // 2026-08-29 화살 #14 — llm이 memory를 물지 않고 **제공자를 등록받는다.**
    //   그래서 시험도 모듈을 갈아끼우지 않고 제공자를 직접 꽂는다(더 정직하고 짧다).
    const { setRagProvider } = await import("../src/engine/llm");
    setRagProvider(async () => ({ chunks: ["사내 규정: pickle 파일은 반드시 스캔 후 반입한다."], 약한근거만: false }));
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
    // 화살 #14 — 제공자가 던지는 상황(임베딩 서버 다운)을 그대로 재현한다.
    const { setRagProvider: setP } = await import("../src/engine/llm");
    setP(async () => { throw new Error("임베딩 서버에 연결할 수 없습니다"); });
    const fetchMock = stubLlm("RAG 없이 답변");

    const reply = await chat({ agentId: "orchestrator", message: "질문", remember: true });

    expect(reply).toBe("RAG 없이 답변");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
  });

  // 회귀 방지(2026-07-20): 어려운 용어 풀이 후처리를 chat() 전체에 무조건 걸었더니, 사람이 읽지 않는
  // 내부 호출까지 오염됐다 — intent.routeIntent는 응답 전체를 JSON.parse하므로 풀이가 붙으면 파싱이
  // 통째로 실패해 정규식 폴백으로 조용히 떨어졌고, 리포트 본문·파인튜닝 데이터셋에도 섞여 들어갔다.
  // chat()의 기본 반환은 모델 답변 그대로여야 한다. 풀이는 화면에 나가는 경로에서만 explain으로 켠다.
  describe("어려운 용어 풀이는 explain 옵션에서만 붙는다", () => {
    const WITH_TERMS = "이 자산에 RCE 취약점(CVE-2021-44228)이 확인되어 즉시 조치가 필요합니다.";

    it("기본 호출은 모델 답변을 그대로 돌려준다 — 내부 파서가 소비하는 경로", async () => {
      stubLlm(WITH_TERMS);
      const reply = await chat({ agentId: "analysis", message: "질문" });
      expect(reply).toBe(WITH_TERMS);
      expect(reply).not.toContain("🔎");
    });

    it("explain: true면 풀이를 덧붙인다 — 사람이 읽는 경로", async () => {
      stubLlm(WITH_TERMS);
      const reply = await chat({ agentId: "analysis", message: "질문", explain: true });
      expect(reply.startsWith(WITH_TERMS)).toBe(true); // 본문은 손대지 않는다
      expect(reply).toContain("🔎 쉬운 용어 풀이");
      expect(reply).toContain("**RCE**");
    });

    it("explain을 켜도 단기 기억에는 원문만 저장한다 — 맥락 오염·중복 방지", async () => {
      const fetchMock = stubLlm(WITH_TERMS);
      await chat({ agentId: "analysis", message: "첫 질문", remember: true, explain: true });
      await chat({ agentId: "analysis", message: "두 번째 질문", remember: true, explain: true });

      // ⚠ 호출 **순번**으로 집지 않는다(2026-08-12). 검색 질의 재작성(searchrewrite)이
      //   같은 /chat/completions를 한 번 더 부르면서 순번이 밀려 이 시험이 깨졌다.
      //   순번은 옆 기능이 늘 때마다 어긋난다 — **대화 이력을 실은 호출**을 내용으로 찾는다.
      const 대화호출 = fetchMock.mock.calls
        .map((c: unknown[]) => {
          try { return JSON.parse(String((c[1] as { body?: unknown })?.body ?? "{}")); } catch { return null; }
        })
        .filter((b: { messages?: { role: string }[] } | null) => b?.messages?.some((m) => m.role === "assistant"));
      expect(대화호출.length, "이전 답을 실어 보낸 호출이 없다").toBeGreaterThan(0);
      const assistantTurn = 대화호출[대화호출.length - 1].messages.find((m: { role: string }) => m.role === "assistant");
      expect(assistantTurn.content).toBe(WITH_TERMS);
    });
  });

  // ★ 근거 꼬리는 **사람이 보는 답에만** 남는다 (2026-09-07 검토관 [중간] 2건)
  //
  // ■ 무엇이 있었나: 「참고한 자료가 인용하는 근거: …」는 **제품이 붙인 글자**인데, 그대로 대화 이력과
  //   학습 로그로 들어갔다. 두 자리가 그것을 모델이 쓴 글로 읽는다:
  //   · learncandidates.CITE_RE(/참고했|근거|…/)가 「근거」를 인용 신호로 세어 점수 1→4 →
  //     신호 강한 후보 **일괄 승인 문턱(3)**을 넘는다. 꼬리가 붙는 조건이 「모델이 근거를 안 댔다」인데
  //     그 답이 인용 점수를 받는다 — 방향이 정확히 반대다.
  //   · 승인되면 learnmemory.approvedQaContent가 답 본문을 그대로 지식 문서로 만든다. 그 문서가
  //     조각으로 다시 검색돼 모델이 문장을 베끼면, 이미근거를댔나가 true라 **검증된 우리 꼬리는
  //     안 붙고 베낀 이름만** 남는다(2026-09-06 metaleak 실사고와 같은 경로).
  // ■ 그래서 여기서 **실제로 chat()을 부른다** — 소스 감시로는 「무엇이 저장됐나」를 못 잰다.
  describe("근거 꼬리는 답에만 남고 이력·학습 기록에는 안 남는다", () => {
    const 규범답 = "개인정보 교육은 연 1회 이상 실시해야 합니다.";
    const 법조각 = "개인정보 보호법 제28조 제2항과 개인정보의 안전성 확보조치 기준 제4조에 따라 취급자 교육을 실시한다.";

    it("사람이 받는 답에는 붙고, 수집기·이력에 가는 답에는 없다", async () => {
      const { setRagProvider, onChatRecorded } = await import("../src/engine/llm");
      setRagProvider(async () => ({ chunks: [법조각], titles: ["보안인식교육.md"], scored: [{ documentId: "보안인식교육.md" }], 약한근거만: false }));
      const 수집된: { q: string; a: string }[] = [];
      onChatRecorded((_agent, q, a) => { 수집된.push({ q, a }); });
      const fetchMock = stubLlm(규범답);

      const reply = await chat({ agentId: "orchestrator", message: "개인정보 교육 몇 번 해야 해?", remember: true });

      expect(reply, "사람이 보는 답에 근거가 안 실렸다").toContain("참고한 자료가 인용하는 근거");
      const 이번 = 수집된.filter((r) => r.q === "개인정보 교육 몇 번 해야 해?");
      expect(이번.length, "학습 수집이 안 됐다 — 시험 자체가 헛돈다").toBe(1);
      expect(이번[0].a, "우리가 붙인 꼬리가 학습 기록에 실렸다").toBe(규범답);

      // 다음 턴 프롬프트(=대화 이력)에도 꼬리가 없어야 한다 — 모델이 그 문장을 베끼는 길을 막는다.
      stubLlmOn(fetchMock, "두 번째 답");
      await chat({ agentId: "orchestrator", message: "그럼 대상자는?", remember: true });
      const 대화호출 = fetchMock.mock.calls
        .map((c: unknown[]) => { try { return JSON.parse(String((c[1] as { body?: unknown })?.body ?? "{}")); } catch { return null; } })
        .filter((b: { messages?: { role: string }[] } | null) => b?.messages?.some((m) => m.role === "assistant"));
      expect(대화호출.length, "이전 답을 실은 호출이 없다").toBeGreaterThan(0);
      const 지난답 = 대화호출[대화호출.length - 1].messages.find((m: { role: string }) => m.role === "assistant");
      expect(지난답.content).toBe(규범답);
    });
  });
});

/** 이미 꽂아 둔 fetch 흉내에 **다음 답**을 얹는다(호출 기록은 그대로 이어 본다). */
function stubLlmOn(fetchMock: { mockResolvedValue: (v: unknown) => unknown }, reply: string) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: reply } }] }) });
}

// dispatch 실측(2026-07-23): "보안담당자입니다. 우리 회사는…"처럼 주어 없는 역할 소개로 시작하는
// 응답이 그대로 나갔다 — 기존 SELF_INTRO_RE는 "저는/제가/나는"으로 시작할 때만 잡았다.
describe("stripLeadingPreamble — 주어 없는 역할 자기소개 서두", () => {
  it("'보안담당자입니다.' 서두를 제거하고 본문을 남긴다", () => {
    expect(stripLeadingPreamble("보안담당자입니다. 우리 회사의 보안 태세 점수는 47점입니다.")).toBe("우리 회사의 보안 태세 점수는 47점입니다.");
  });

  it("'GIJO 보안 AI입니다.' 서두도 제거한다", () => {
    expect(stripLeadingPreamble("GIJO 보안 AI입니다. 취약점 3건을 발견했습니다.")).toBe("취약점 3건을 발견했습니다.");
  });

  it("본문 문장('~가 필요합니다')은 건드리지 않는다", () => {
    const t = "즉시 조치가 필요합니다. KEV 등재 취약점이 2건입니다.";
    expect(stripLeadingPreamble(t)).toBe(t);
  });

  it("역할 소개만 있고 본문이 없으면 원문 유지 — 빈 답 방지", () => {
    expect(stripLeadingPreamble("보안담당자입니다.")).toBe("보안담당자입니다.");
  });
});

describe("stripLeadingPreamble — 2인칭 정체성 복창 서두(37f5ca3 흡수)", () => {
  it("정체성 복창 두 문장을 걷어내고 본문을 남긴다", () => {
    const echoed = "당신은 안전한 AI입니다. 당신은 GIJO AS에서 AI 자산 보안 관리를 담당하고 있습니다. 취약점 3건을 발견했습니다.";
    expect(stripLeadingPreamble(echoed)).toBe("취약점 3건을 발견했습니다.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 이력은 개수만이 아니라 **글자 예산**으로도 잘린다 (2026-08-13 · max 근본 규명)
//
// ■ 무엇이 있었나 — 라이트(ctx 8192)에서 긴 문서를 다루면 그 뒤로 긴 질문만 0초에 죽었다.
//   f57c2bd 진단 로그가 밝힘: HTTP 400 "request (8861 tokens) exceeds … (8192)".
//   HISTORY_LIMIT=20은 개수 상한이라, 정리본이 긴 문서를 연달아 보내면 이력이 문맥을 다 먹는다.
//   「10분 뒤 저절로 나음」=짧은 질문이 긴 이력을 밀어냄 · 「재시작하면 나음」=histories.clear().
//
// ■ 왜 소스 감시인가 — 조립부는 chat() 깊숙이 있어 순수 함수로 못 뗀다(모듈 상태·동적 import).
//   대신 ① 예산 로직이 실제로 배선돼 있는지 ② 쌍 경계 셈이 맞는지(여기서 재현)를 본다.
import * as fsw from "fs";

describe("★ 이력 글자 예산 (2026-08-13)", () => {
  const src = fsw.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");

  it("예산 로직이 배선돼 있다 — ctx의 절반·보수 환산 1.2자/토큰", () => {
    expect(src, "ctx를 티어에서 안 읽는다").toMatch(/currentTierSettings\(\)\.ctxSize/);
    expect(src, "이력 예산이 없다").toContain("이력예산자");
    // 보수 환산 — 1.44(실측 평균)로 잡으면 영문·코드 섞일 때 초과가 난다.
    expect(src, "환산 계수가 보수적이지 않다").toMatch(/\* 1\.2/);
  });

  it("★ 쌍 경계를 지킨다 — 홀수로 자르면 Mistral류가 roles must alternate로 거부한다", () => {
    expect(src).toMatch(/시작 % 2 === 1/);
    // 셈을 여기서 재현해 확인한다(로직 사본이 아니라 **경계 조건의 진리표**다).
    // ⚠ 실코드의 마지막 단계(시작 ≥ 길이면 전부 비움)까지 포함해 **남기는 개수**로 잰다 —
    //   처음엔 날 인덱스로 쟀다가 그 단계를 빼먹어 시험 자신이 틀렸다(2026-08-13).
    const 남기는수 = (lens: number[], 예산: number) => {
      let 합 = 0, 시작 = lens.length;
      for (let i = lens.length - 1; i >= 0; i--) {
        합 += lens[i];
        if (합 > 예산) break;
        시작 = i;
      }
      if (시작 % 2 === 1) 시작 += 1;
      return 시작 >= lens.length ? 0 : lens.length - 시작;
    };
    // [u,a,u,a] 각 100자, 예산 250 → 뒤에서 2개(200)까지 담고 3번째에서 초과 → 2개 남김(u부터, 쌍 유지)
    expect(남기는수([100, 100, 100, 100], 250)).toBe(2);
    // 예산 350 → 뒤에서 3개(300)까지 담김 → 홀수 경계(assistant부터)라 2개로 보정
    expect(남기는수([100, 100, 100, 100], 350)).toBe(2);
    // 전부 담기면 그대로 — 이력을 안 자른다
    expect(남기는수([100, 100], 500)).toBe(2);
    // 최신 한 턴조차 예산 초과 → 전부 버린다
    expect(남기는수([9000], 100)).toBe(0);
  });

  it("개수 상한(HISTORY_LIMIT)은 그대로다 — 크기 상한이 개수 상한을 대체하지 않는다", () => {
    expect(src).toMatch(/HISTORY_LIMIT = 20/);
  });
});

// ★ #8 「네 자료엔 없음」 정직 응답 (2026-08-13 · max 인계 ★높음) — 소스 감시
describe("★ RAG 0건 정직 배너 (#8)", () => {
  const src2 = fsw.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
  it("성공-0건(자료없음)과 오류(catch)를 가른다 — 고장을 「없다」로 단정하면 안 된다", () => {
    expect(src2).toMatch(/자료없음: chunks\.length === 0/);
    // ⚠ 2026-09-05 — chunks를 함께 돌려주게 바뀌었다(인용 가드가 조각을 봐야 해서).
    //   `chunks: null`이 여기 **붙어 있어야** 하는 이유가 이 시험의 원래 뜻과 같다: 검색 실패는
    //   「근거가 없다」가 아니라 **모른다**이므로, 가드가 그 자리에서 인용을 떼면 안 된다.
    //   (뭉개서 `chunks: []`로 두면 고장 났을 때 정상 인용까지 뗀다 — 「고장을 없다로 단정」의 재판.)
    //   ⚠ 2026-09-05 수리 — 번호 없는 원천(온톨로지·용어 정의·📎첨부)도 함께 나른다(추가원천).
    //     고장 자리에서는 그것도 **비어 있다**고 말해야 한다(모르는 것을 안다고 하지 않는다).
    //   ⚠ 2026-09-07 수리 — 조각마다의 documentId도 함께 나른다(조각문서id · 근거 이름 꼬리가
    //     승인 문답 조각을 재료에서 뺄 때 쓴다). **고장 자리에서는 이것도 비어 있어야** 한다:
    //     빈 배열은 「조각이 없다」와 같은 뜻이라 꼬리가 원리상 안 붙는다(모르는 것을 안 붙인다).
    expect(src2, "catch가 자료없음=false·chunks=null을 안 돌려준다")
      .toMatch(/catch \{[\s\S]{0,240}?return \{ context: null, 약한근거만: false, 자료없음: false, chunks: null, 조각문서id: \[\], 추가원천: \[\] \}/);
  });
  it("배너가 배선돼 있고 문구가 실패 목록과 안 겹친다", () => {
    expect(src2).toMatch(/ragResult\?\.자료없음 && reply/);
    // ⚠ 2026-09-05: 배너 **문장**은 noevidence.ts로 이관됐다(dispatcher가 판정기를 쓰려면 llm을
    //   흉내 내는 시험 76개를 안 건드려야 해서). llm.ts는 그 상수를 가져다 붙이기만 한다.
    expect(src2, "배너 상수를 안 쓴다 — 문장을 다시 적었는지 보라").toContain("자료없음배너");
    const 배너파일 = fsw.readFileSync(new URL("../src/engine/noevidence.ts", import.meta.url), "utf8");
    expect(배너파일).toContain("이 PC의 사내 자료에는 이 내용이 없습니다");
    // FAIL_MARKS 전체 대조는 emptyanswer-guidance(파일 전체 감시)가 맡는다 — 여기서는 배너 문구가
    // 그 감시 대상 파일에 실제로 있는지만 본다(검토관: 항상-참 검사는 무의미했다).
  });
});

// ★ 자료없음 + **사내 특정 대상** 질문일 때만 표적 배너(자료를 넣어 달라) — 2026-08-21 사장님
//   「부족하면 부족하다 하고 필요한 자료를 요청」. 좁게 잡는 게 핵심이다 — 개념 질문까지 억누르면 회귀.
describe("★ 사내 특정 대상 판별 — 자료 요청 배너의 방아쇠", () => {
  const src3 = fsw.readFileSync(new URL("../src/engine/llm.ts", import.meta.url), "utf8");
  it("우리 문서·명령·설정을 콕 집으면 참", () => {
    for (const q of [
      "SolidStep 매뉴얼에서 스캔 명령어 알려줘",
      "우리 회사 방화벽 설정 어떻게 해",
      "이 제품 옵션 뭐 있어",
      "사내 백업 절차 보여줘",
      "저희 서버 접속 방법 알려줘",
    ]) expect(사내특정대상질문(q), q).toBe(true);
  });
  it("일반·개념 질문은 거짓 — 자료 0건이어도 일반지식 답을 억누르지 않는다", () => {
    for (const q of [
      "SQL 인젝션이 뭐야",
      "취약점 관리가 뭐야",
      "방법 알려줘",
      "오늘 브리핑",
      "CVE-2021-44228 설명해줘",
      // ⚠ 「우리/저희」 홑낱말 과포착 회귀(2026-08-21 검토관 3갈래 적발) — 회사 무관 일반 표현.
      "우리나라 개인정보보호법이 뭐야",
      "우리말로 알려줘",
      "우리 사회의 보안 규정은 어떻게 되나",
      "우리 팀 협업 도구 뭐 써",
      "우리 동네 CCTV 규정 알려줘",
    ]) expect(사내특정대상질문(q), q).toBe(false);
  });
  it("배너 분기가 판별기를 실제로 쓴다(배선 감시)", () => {
    expect(src3).toMatch(/사내특정대상질문\(args\.message\)\s*\?\s*자료요청배너\s*:\s*자료없음배너/);
  });
});
