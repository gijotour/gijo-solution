import { describe, it, expect, vi, beforeEach } from "vitest";

// 에이전트 루프의 결정·최종답변 호출을 순서대로 제어한다.
const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { runAgentLoop, setLastTarget, resetContextForTests, 사람용으로다듬기 } from "../src/engine/agentloop";
import fs from "node:fs";
import { listAgentTools, findAgentTool, validateToolArgs } from "../src/engine/agenttools";
import { resetAssetsForTests, registerAsset, recordFindings } from "../src/engine/assets";

function seedAsset(id = "fraud-detect-llm") {
  registerAsset({ id, name: id, path: `models/${id}.gguf` });
}

beforeEach(() => {
  mockChat.mockReset();
  resetAssetsForTests();
  resetContextForTests();
});

describe("#8 대화 맥락 — '아까 그거' 후속 지시", () => {
  it("직전 대상이 있고 지시가 '아까 그거'면 프롬프트에 대상을 실어준다", async () => {
    seedAsset();
    setLastTarget("fraud-detect-llm", "프롬프트 인젝션", "취약점 배정");
    mockChat.mockResolvedValueOnce('{"action":"tool","tool":"assign_finding","args":{"assetId":"fraud-detect-llm","finding":"프롬프트 인젝션","assignee":"이영희"}}');
    const r = await runAgentLoop("아까 그거 이영희로 바꿔");
    expect(r?.approval?.tool).toBe("assign_finding");
    const firstMsg = mockChat.mock.calls[0][0].message as string;
    expect(firstMsg).toContain("직전에 다룬 취약점");
    expect(firstMsg).toContain("프롬프트 인젝션");
  });

  it("지시대명사가 없으면 직전 대상을 주입하지 않는다", async () => {
    seedAsset();
    setLastTarget("fraud-detect-llm", "프롬프트 인젝션", "x");
    mockChat.mockResolvedValueOnce('{"action":"tool","tool":"list_assets","args":{}}').mockResolvedValueOnce('{"action":"final"}').mockResolvedValueOnce("답");
    await runAgentLoop("자산 목록 보여줘");
    expect(mockChat.mock.calls[0][0].message as string).not.toContain("직전에 다룬 취약점");
  });
});

describe("agenttools — 「AI 자산」 조회 도구", () => {
  // 도구는 화면 메뉴가 아니라 사용자 의도 단위다(2026-07-17 확정) — 목록·상세·찾기·설명·오늘·등록.
  // search/explain/today는 메뉴를 가로지르므로 domain="cross".
  // 전수 목록을 하드코딩하면 역량을 하나 추가할 때마다 이 테스트가 깨진다(B단계에서 30종까지
  // 늘어난다). 지키려던 것은 "목록이 이것뿐"이 아니라 아래 세 가지 성질이므로 그것만 검사한다.
  it("도구는 의도 단위로 등록돼 있다", () => {
    const tools = listAgentTools();
    const names = tools.map((t) => t.name);

    // ① 기본 조회 도구가 빠지지 않았다
    for (const n of ["list_assets", "get_asset", "search", "explain", "today"]) expect(names).toContain(n);

    // ② 상태를 바꾸는 도구는 전부 write=true여야 한다 — 결재판을 우회하면 안 된다
    for (const n of ["register_asset", "assign_finding", "update_finding_status", "bulk_update", "review_finding"]) {
      expect(tools.find((t) => t.name === n)?.write, n).toBe(true);
    }

    // ③ 메뉴를 가로지르는 도구가 있어야 "오늘 뭐부터?"·"우리 관련 위협?"에 도구 1개로 답한다.
    const cross = tools.filter((t) => t.domain === "cross").map((t) => t.name);
    for (const n of ["search", "explain", "today", "threats", "briefing"]) expect(cross).toContain(n);

    // 이름 중복이 없다(레지스트리 무결성)
    expect(new Set(names).size).toBe(names.length);
  });

  // threats(CTI×자산) — cti.ts가 기동 시 시드하는 샘플 위협(KoBERT·Qwen2.5·bge-m3 등)과
  // 자산 신호의 교집합. 벤더 키 없이도 매칭이 되도록 시드돼 있다(cti.ts 주석).
  it("threats는 자산이 없으면 겹치는 위협이 없다고 답한다", async () => {
    const out = String(await findAgentTool("threats")!.run({}));
    // 샘플 위협은 있지만(피드 시드) 자산이 0개라 매칭이 없다.
    expect(out).toMatch(/겹치는 것은 없습니다|새로 탐지된 위협이 없습니다/);
  });

  it("threats는 겹치는 위협과 **자산 이름**을 준다 (내부 id·영문 상태값은 안 낸다)", async () => {
    // ⚠ 예전에는 `이름(id=…)`과 `[critical]`을 실어 LLM이 이어서 파고들게 했다.
    //   그 답이 **담당자 화면에 그대로 나갔다**(2026-08-03 실전 147상황: 30.5초 + 영문 상태값).
    //   지금은 즉답(directAnswer)이라 LLM 재작성을 안 거친다 — 그러니 **사람이 읽을 글자**여야 한다.
    registerAsset({ id: "ai-kobert-01", name: "KoBERT 분류기", path: "models/kobert.onnx" });
    const out = String(await findAgentTool("threats")!.run({ limit: "5" }));
    expect(out).toContain("KoBERT"); // 시드 위협 target 텍스트 + 자산 이름
    expect(out, "내부 id가 사람에게 나간다").not.toContain("id=");
    expect(out, "영문 심각도가 그대로 나간다").not.toMatch(/\[(critical|warning|info)\]/);
    expect(out, "다음 걸음이 없다").toContain("▸");
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
    // LLM이 다시 쓴 문장이 그대로 앞에 온다. 뒤에 붙는 「다음 단계」 한 줄은 규칙으로 만든
    // 고정 문장이라 재작성이 아니다 — 이 시험이 지키는 것은 **재작성 경로를 탔는가**이고,
    // 그건 아래 mockChat 호출 3회(결정2 + 재작성1)로 직접 못 박는다.
    expect(r!.output.startsWith("등록된 자산은 1개입니다: fraud-detect-llm")).toBe(true);
    expect(r!.output).toContain("▸ 다음 단계 ② 우선순위");
    expect(r!.toolCalls).toHaveLength(1);
    expect(r!.toolCalls[0].tool).toBe("list_assets");
    expect(r!.toolCalls[0].result).toContain("fraud-detect-llm");
    // 결정 호출에는 스키마 강제, 최종 재작성에는 생성 길이 상한(maxTokens)이 걸린다. remember(임베딩
    // 재호출)은 최종답 경로에서 뺐다 — 단일 GPU에서 채팅 모델과 경합해 멈추던 원인이라(오늘 수정).
    expect(mockChat.mock.calls[0][0]).toMatchObject({ agentId: "orchestrator", responseSchema: expect.anything() });
    expect(mockChat.mock.calls[2][0]).toMatchObject({ maxTokens: 800 });
    expect(mockChat.mock.calls[2][0].remember).toBeFalsy();
    expect(mockChat.mock.calls[2][0].message).toContain("fraud-detect-llm");
  });

  it("대표 문구 '오늘 뭐부터 조치해야 해?'는 LLM 결정을 건너뛰고 today를 강제 실행한다", async () => {
    seedAsset();
    // mockChat을 큐잉하지 않는다 — 강제 실행이면 LLM 결정 호출 자체가 없어야 한다.
    const r = await runAgentLoop("오늘 뭐부터 조치해야 해?");
    expect(r).not.toBeNull();
    expect(r!.toolCalls[0].tool).toBe("today");
    // directAnswer라 도구 결과가 **그대로** 앞에 온다. 2026-08-02부터 뒤에 「다음 단계」
    // 한 줄이 붙는다 — 이건 규칙으로 만든 고정 문장이라 LLM 재작성이 아니다.
    // ⚠ 이 시험이 지키는 것은 "글자 수가 안 변한다"가 아니라 **"LLM이 다시 안 쓴다"**이고,
    //   그건 아래 mockChat 미호출로 직접 못 박는다.
    expect(r!.output.startsWith(r!.toolCalls[0].result)).toBe(true);
    expect(r!.output).toContain("▸ 다음 단계 ③ 조치");
    expect(mockChat).not.toHaveBeenCalled(); // LLM 라우팅 흔들림 원천 차단
  });

  it("directAnswer 도구(today)는 LLM 재작성 없이 결과를 그대로 답한다", async () => {
    seedAsset();
    // 강제 문구가 아닌 지시로 LLM이 today를 고르게 한다(강제 가드 경로와 분리해 재작성 생략만 검증).
    mockChat
      .mockResolvedValueOnce('{"action":"tool","tool":"today","args":{}}') // 결정 1
      .mockResolvedValueOnce('{"action":"final"}'); // 결정 2 — 결과로 충분
    const r = await runAgentLoop("위험 순위 목록 보여줘");
    expect(r).not.toBeNull();
    expect(r!.toolCalls[0].tool).toBe("today");
    // 최종 답 = today 결과 그대로(+규칙으로 붙인 「다음 단계」 한 줄). LLM 재작성이 없다 =
    // 멈춤 원천 차단 — 그 성질은 아래 호출 1회로 못 박는다.
    expect(r!.output.startsWith(r!.toolCalls[0].result)).toBe(true);
    expect(r!.output).toContain("▸ 다음 단계");
    // 호출 1회(결정) — 2026-07-30부터 directAnswer 도구가 성공하고 조회만 요구한 지시면
    // "더 할 일 있나?"를 다시 묻지 않는다. 그 한 번이 프롬프트 3천 토큰을 다시 읽느라 5초 넘게
    // 걸렸고 결과는 바뀌지 않았다(실측). 예전엔 2회였다 — 줄어든 것이 이 시험의 취지에 맞다.
    expect(mockChat).toHaveBeenCalledTimes(1);
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
    // 실측(2026-07-19): 이 내부 오류 메시지가 최종 답변 작성 프롬프트에 그대로 섞여 들어가
    // "도구가 없어서..." 같은 내부 과정 얘기가 사용자 답변에 새어나왔다 — composeFinalAnswer로
    // 보내는 마지막 chat() 호출에는 이 오류가 빠져야 한다.
    const finalCallMessage = mockChat.mock.calls.at(-1)![0].message as string;
    expect(finalCallMessage).not.toContain("존재하지 않는 도구");
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

describe("★ 내부 식별자는 사람에게 안 보인다", () => {
  // 도구는 `자산이름(id=vuln:sample-web01)` 꼴로 id를 함께 낸다 — LLM이 후속 지시에서
  // 그 id로 다음 도구를 부르기 때문에 **일부러** 그렇게 만든 것이다.
  // 문제는 그 문자열이 그대로 담당자 화면까지 간다는 것.
  // 실측(2026-08-01 하루 실전 115상황): "오늘 뭐부터 볼까?"의 답 첫 줄에 그대로 떴다.
  it("(id=…)를 지운다", () => {
    expect(사람용으로다듬기("1. [high] OpenSSH 취약점 @ 샘플-웹서버(id=vuln:sample-web01) — KEV"))
      .toBe("1. [high] OpenSSH 취약점 @ 샘플-웹서버 — KEV");
  });

  it("여러 개도 전부 지운다", () => {
    expect(사람용으로다듬기("A(id=asset:a1), B(id=asset:b2)")).toBe("A, B");
  });

  it("★ 사람이 읽는 괄호는 건드리지 않는다 — 넓히다 본문을 깎으면 안 된다", () => {
    expect(사람용으로다듬기("경계 방화벽(FW-01)에서 발견")).toBe("경계 방화벽(FW-01)에서 발견");
    expect(사람용으로다듬기("CVE-2021-44228 (Log4Shell)")).toBe("CVE-2021-44228 (Log4Shell)");
  });

  it("빈 값·null에도 죽지 않는다", () => {
    expect(사람용으로다듬기("")).toBe("");
    expect(사람용으로다듬기(undefined as unknown as string)).toBe("");
  });

  it("★ 도구 결과 원본은 그대로다 — LLM이 id를 잃으면 후속 지시가 끊긴다", () => {
    // 지우는 자리는 사람에게 나가는 마지막 지점 한 곳이어야 한다.
    const src = fs.readFileSync(new URL("../src/engine/agenttools.ts", import.meta.url), "utf8");
    expect(src, "도구가 id를 안 내면 '1번 자산 자세히 봐줘'가 동작하지 않는다").toContain("(id=${r.assetId})");
  });
});
