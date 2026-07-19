import { describe, it, expect, vi, afterEach } from "vitest";
import { smallTalkReply } from "../src/engine/llm";

describe("인사·잡담 처리 (LLM 미호출)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("인사에는 무엇을 시킬 수 있는지 안내한다", () => {
    for (const g of ["안녕", "안녕하세요", "하이", "반갑습니다", "ㅎㅇ", "hello", "Hi!"]) {
      const r = smallTalkReply(g);
      expect(r, g).toBeTruthy();
      expect(r).toContain("도와드릴까요");
    }
  });

  it("감사·격려에는 짧게 응대한다", () => {
    for (const g of ["고마워", "감사합니다", "수고했어", "굿", "thanks"]) {
      expect(smallTalkReply(g), g).toBeTruthy();
    }
  });

  it("실제 질문은 LLM으로 보낸다(가로채지 않는다)", () => {
    for (const q of [
      "취약점 조치 우선순위 알려줘",
      "안녕하세요, 이번 주 스캔 결과 정리해주실 수 있나요?", // 인사로 시작하지만 실제 요청
      "자산 스캔해줘",
      "",
    ]) {
      expect(smallTalkReply(q), q).toBeNull();
    }
  });

  it("인사에 LLM을 호출하지 않는다 — GPU를 쓰지 않고 환각도 없다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    const reply = await chat({ agentId: "orchestrator", message: "안녕" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply).toContain("도와드릴까요");
  });

  it("구조화 호출(responseSchema)은 가로채지 않는다 — JSON을 기대하는 경로", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chat } = await import("../src/engine/llm");
    await chat({ agentId: "orchestrator", message: "안녕", responseSchema: { type: "object" } });

    expect(fetchMock).toHaveBeenCalled();
  });
});
