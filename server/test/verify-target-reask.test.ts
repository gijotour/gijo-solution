// 조치 검증 — **자산을 지목하지 않았으면 되묻는다** (2026-09-07 · 야간 회귀 ⑬ 수리)
//
// ★★ 실측 사고 (야간 회귀 2026-09-06 · .tmp-reports/ops-sim.json)
//   ⑬-124 「조치 다 했는데 어떻게 확인해?」
//     → 답: 「자산 "최근 취약점"을 찾을 수 없습니다. 자산 이름이나 ID로 다시 지정해 주세요.」
//   ⑬-128 「고쳤다고 했는데 정말 닫혔는지 봐줘」
//     → 답: 「자산 "web-01"을 찾을 수 없습니다. 닫혔는지 확인할 수 없습니다.」
//   둘 다 **자산을 지목하지 않은 물음**이다. 운영 자산은 0건이고 web-01은 도구 설명의 예문
//   (`예: {"assetId":"web-01"…}`)이다 — 모델이 그 예문을 그대로 인자로 넣었다.
//
//   결함 둘:
//   ⓐ 대상을 안 댄 절차 물음에 **지어낸 자산 인자로 실행 도구가 불렸다.** 대상이 없으면
//      답이 아니라 **되묻기**가 맞다(같은 파일의 27초 사고와 같은 병).
//   ⓑ 도구가 낸 **결정적 문구**(「자산 이름이나 id로 다시 지목해 주세요」)가 모델 재작성을
//      거쳐 「ID로 다시 **지정**해 주세요」·「닫혔는지 확인할 수 없습니다」로 **다시 쓰였다.**
//      제품이 정한 말이 회차마다 달라지면 그 말을 기대하는 어떤 잣대도 못 믿는다
//      (실제로 하네스 기대표의 「다시 지목」이 그래서 빗나갔다).
import { describe, it, expect, beforeEach, vi } from "vitest";

// ⚠ **배선까지 잰다**(2026-09-07 검토관 적발). 처음엔 순수 함수만 불러서, 관문 두 자리를
//   **둘 다 지워도 13개가 초록**이었다 — 「고쳤다는 실행으로」가 성립하지 않는 잣대였다.
//   장비에 접속하는 도구를 막는 관문이라 더더욱, 누가 그 배선을 지우면 시험이 말해야 한다.
const mockChat = vi.fn();
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: (...args: unknown[]) => mockChat(...args),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import {
  지목없는검증대상,
  검증대상되물음,
  모델을거치지않는답인가,
  forcedToolFor,
  runAgentLoop,
  setLastTarget,
  resetContextForTests,
} from "../src/engine/agentloop";
import { 되묻기표지, 자산못찾음되묻기 } from "../src/engine/agenttools";
import { isAssetStatusAsk } from "../src/engine/datacard";
import { resetAssetsForTests, registerAsset } from "../src/engine/assets";

beforeEach(() => { resetContextForTests(); resetAssetsForTests(); mockChat.mockReset(); });

describe("ⓐ 자산을 지목하지 않았으면 도구를 부르지 않는다", () => {
  it("「조치 다 했는데 어떻게 확인해?」 — 모델이 넣은 「최근 취약점」은 지시문에 없다", () => {
    expect(지목없는검증대상("조치 다 했는데 어떻게 확인해?", "최근 취약점")).toBe(true);
  });

  it("「고쳤다고 했는데 정말 닫혔는지 봐줘」 — 「web-01」은 도구 예문이지 사람 말이 아니다", () => {
    expect(지목없는검증대상("고쳤다고 했는데 정말 닫혔는지 봐줘", "web-01")).toBe(true);
  });

  it("인자 자체가 비면 당연히 지목 없음", () => {
    expect(지목없는검증대상("검증해줘", "")).toBe(true);
    expect(지목없는검증대상("검증해줘", undefined)).toBe(true);
  });

  it("★ 사람이 실제로 그 이름을 말했으면 **막지 않는다** — 등록에 없어도 도구가 정직하게 답한다", () => {
    expect(지목없는검증대상("web-01 조치 검증해줘", "web-01"), "진짜 지시를 되묻기로 막으면 그게 더 나쁘다").toBe(false);
    // 지시문에서도 낱말 경계로 본다 — 「payment-web-01 검증해줘」에 「web-01」을 넣은 것은 지목이 아니다.
    expect(지목없는검증대상("payment-web-01 조치 검증해줘", "web-01"), "일부만 겹치는 값이 통과한다").toBe(true);
    expect(지목없는검증대상("WEB-01 정말 닫혔는지 봐줘", "web-01"), "대소문자·띄어쓰기로 갈리면 안 된다").toBe(false);
  });


  it("★ 🗂 지금 범위로 담당자가 직접 걸어 둔 자산이면 막지 않는다", () => {
    expect(지목없는검증대상("검증 실행해줘", "web-01", { 범위자산: "web-01" }), "범위를 걸어 놓고 물었는데 되묻는다").toBe(false);
    // ⚠ 값이 다르면(모델이 범위를 무시하고 딴 자산을 지어냄) 그건 지목이 아니다.
    expect(지목없는검증대상("검증 실행해줘", "db-02", { 범위자산: "web-01" })).toBe(true);
  });


  it("★ 앞선 조회 결과에 있던 이름이면 **읽고 옮긴 값**이다 — 「목록 보고 → 그 자산 검증」을 막지 않는다", () => {
    const 앞선결과 = ["자산 3대", "  · payment-web-01 (미조치 2건)", "  · db-02 (미조치 0건)"].join("\n");
    expect(지목없는검증대상("이 중에 조치 끝난 거 정말 닫혔는지 봐줘", "payment-web-01", { 앞선결과 })).toBe(false);
    // ★★ 앞선 결과에도 없으면 여전히 지어낸 값이다. 「web-01」은 「payment-web-01」의 **일부**일 뿐
    //   — 그냥 포함으로 재면 지어낸 값이 근거 있는 값으로 둔갑하고, 느슨한 자산 해석과 만나면
    //   **엉뚱한 장비**로 간다(2026-09-07 반증에서 실제로 잡힌 구멍이다).
    expect(지목없는검증대상("이 중에 조치 끝난 거 정말 닫혔는지 봐줘", "web-01", { 앞선결과 })).toBe(true);
  });

  it("★ 화면에서 고른 항목(⌗이름::키)이 실려 있으면 지목한 것이다", () => {
    expect(지목없는검증대상("⌗결제서버::0123456789abcdef 검증 실행", "결제서버")).toBe(false);
  });

  it("★ 직전 대상(「아까 그거」)이 있으면 맥락으로 풀린 것이다 — #8 흐름을 끊지 않는다", () => {
    setLastTarget("fraud-detect-llm", "프롬프트 인젝션", "취약점 배정");
    expect(지목없는검증대상("아까 그거 정말 닫혔는지 봐줘", "fraud-detect-llm")).toBe(false);
  });
});

describe("ⓐ 되묻는 말이 담당자를 막다른 곳에 두지 않는다", () => {
  const 말 = 검증대상되물음();

  it("무엇이 필요한지·그다음에 뭘 하는지까지 준다", () => {
    expect(말).toContain("어느 자산");
    expect(말).toContain("검증");
    expect(말, "다음 걸음이 없다").toContain("▸");
    expect((말.match(/"/g) ?? []).length, "그대로 쓸 예시 문장이 없다").toBeGreaterThanOrEqual(4);
  });

  it("★ 야간 회귀 두 문항의 기대를 실제로 만족한다(하네스 기대표 그대로)", () => {
    expect(말, "⑬-124 기대 /확인|검증|승인|판정/").toMatch(/확인|검증|승인|판정/);
    expect(말, "⑬-128 기대 /취약점|조치|다시 지목|어느 자산/").toMatch(/취약점|조치|다시 지목|어느 자산/);
  });
});

describe("ⓑ 결정적 문구는 모델을 거치지 않고 **그대로** 나간다", () => {
  it("되묻기 표지가 붙은 답은 재작성 경로로 안 간다", () => {
    expect(모델을거치지않는답인가(검증대상되물음()), "모델이 다시 쓰면 「지목」이 「지정」으로 바뀐다").toBe(true);
  });

  it("도구의 「자산을 못 찾았다」 문구도 그대로 나간다", () => {
    const 문구 = 자산못찾음되묻기("web-01");
    expect(문구.startsWith(되묻기표지), "표지가 없으면 재작성 경로로 샌다").toBe(true);
    expect(문구).toContain("다시 지목해 주세요");
    // 빈 값도 사람이 읽을 글이어야 한다 — 예전엔 `자산 "undefined"을 …`이 그대로 나갔다.
    const 빈것 = 자산못찾음되묻기("");
    expect(빈것).not.toContain("undefined");
    expect(빈것).toContain("어느 자산");
    expect(모델을거치지않는답인가(빈것)).toBe(true);
    expect(모델을거치지않는답인가(문구)).toBe(true);
  });

  it("★ 보통 도구 결과까지 통째로 그대로 내보내지는 않는다 — 표지가 있을 때만이다", () => {
    expect(모델을거치지않는답인가("자산 3대 중 2대는 조치가 끝났습니다.")).toBe(false);
    expect(모델을거치지않는답인가("")).toBe(false);
  });
});

// ── 검토관 라운드 수리 (2026-09-07) — 아래 넷은 **첫 판이 놓친 자리**다 ────────────────
describe("⑤ 등록 자산 갈래 — 이름이 있다고 **아무 id나** 통과시키지 않는다", () => {
  beforeEach(() => {
    registerAsset({ id: "payment-web-01", name: "결제서버", path: "-" });
    registerAsset({ id: "db-02", name: "회계DB", path: "-" });
  });

  it("★★ 사람은 결제서버를 말했는데 모델이 **딴 실재 자산**을 넣으면 막는다", () => {
    // 안 막으면 resolveAsset이 db-02를 즉시 찾아 **회계DB에 접속한다.**
    // 관문 머리글이 적어 둔 「그 자산이 우연히 실재하면 엉뚱한 장비에 붙는다」가 바로 이것이다.
    expect(지목없는검증대상("결제서버 조치 정말 닫혔는지 봐줘", "db-02")).toBe(true);
    expect(지목없는검증대상("결제서버 조치 정말 닫혔는지 봐줘", "web-01")).toBe(true);
  });

  it("사람이 이름으로 부르고 모델이 그 자산의 id로 바꾼 정상 흐름은 막지 않는다", () => {
    expect(지목없는검증대상("결제서버 조치 정말 닫혔는지 봐줘", "payment-web-01")).toBe(false);
    // vuln: 접두어가 붙고 안 붙고로 갈리면 안 된다(resolveAsset이 둘을 같게 본다).
    expect(지목없는검증대상("결제서버 조치 정말 닫혔는지 봐줘", "vuln:payment-web-01")).toBe(false);
  });

  it("자산 이름이 아예 없는 물음은 등록부가 있어도 되묻는다", () => {
    expect(지목없는검증대상("조치 다 했는데 어떻게 확인해?", "db-02")).toBe(true);
  });
});

describe("① 낱말 경계 — 한국어 조사는 **경계**다(식별자 글자가 아니다)", () => {
  // ⚠ 여기서 막히면 관문이 스스로 적어 둔 계약(「사람이 없는 이름을 댔으면 막지 않는다」)을
  //   어기고, 「지시에 자산이 없어」라는 **사실과 다른 말**이 나간다.
  const 조사들 = [
    ["web-01의 조치 검증해줘", "web-01"],
    ["web-01은 닫혔어?", "web-01"],
    ["web-01이 정말 닫혔는지 봐줘", "web-01"],
    ["web-01에서 조치 검증해줘", "web-01"],
    ["결제서버의 조치 검증해줘", "결제서버"],
    ["결제서버를 검증해줘", "결제서버"],
    ["결제서버는 닫혔어?", "결제서버"],
  ] as const;
  for (const [문장, id] of 조사들) {
    it(`「${문장}」 — 사람이 또렷이 지목했다`, () => {
      expect(지목없는검증대상(문장, id)).toBe(false);
    });
  }

  it("★ 조사를 허용해도 **딴 낱말의 앞부분**은 여전히 지목이 아니다", () => {
    expect(지목없는검증대상("회계DB서버 검증해줘", "회계DB"), "서버는 조사가 아니다").toBe(true);
    expect(지목없는검증대상("payment-web-01 조치 검증해줘", "web-01")).toBe(true);
  });
});

describe("안내한 말은 못 박는다 — 되묻기가 가르치는 문장은 **결정적으로** 닿아야 한다", () => {
  // ★★ 되묻기는 「모델의 도구 선택이 흔들려서」 만든 관문이다. 그 되묻기가 권하는 말이 다시
  //   모델 판단으로 돌아가면, 회복 경로를 또 운에 맡기는 것이다(검토관 적발).
  const 예시들 = [...검증대상되물음().matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  it("예시 문장이 실제로 실려 있다", () => {
    expect(예시들.length).toBeGreaterThanOrEqual(3);
  });

  for (const 문장 of 예시들) {
    it(`「${문장}」 — 모델을 안 태워도 도착지가 정해진다`, () => {
      const 도착 = forcedToolFor(문장) ?? (isAssetStatusAsk(문장) ? { tool: "자산 현황 카드", args: {} } : null);
      expect(도착, "이 말은 모델 판단으로 간다 — 가르치면 안 되는 말이다").not.toBeNull();
    });
  }

  it("★ 가르친 검증 문장은 **대상까지** 실어 보낸다 — 되묻기가 되묻기를 부르면 막다른 길이다", () => {
    const r = forcedToolFor("결제서버 조치 검증 실행해줘");
    expect(r?.tool).toBe("verify_finding");
    expect(r?.args.assetId, "인자가 비면 도구가 또 「어느 자산인지 몰라」를 낸다").toBe("결제서버");
  });

  it("대상을 안 댄 「이거 검증 실행해줘」는 지어내지 않는다(빈 인자로 정직하게 되묻는다)", () => {
    expect(forcedToolFor("이거 검증 실행해줘")?.args.assetId ?? "").toBe("");
    expect(forcedToolFor("검증 실행해줘")?.args.assetId ?? "").toBe("");
  });

  it("대상 추출은 조사·군더더기를 떼고 **이름만** 넘긴다", () => {
    const 뽑기 = (t: string) => forcedToolFor(t)?.args.assetId;
    expect(뽑기("결제서버의 조치 검증 실행해줘"), "조사가 이름에 붙으면 자산을 못 찾는다").toBe("결제서버");
    expect(뽑기("회계DB는 검증 실행해줘")).toBe("회계DB");
    expect(뽑기("결제서버 취약점 조치 검증 실행해줘"), "「취약점 조치」가 이름에 붙었다").toBe("결제서버");
    expect(뽑기("web-01 조치 검증 돌려줘")).toBe("web-01");
    expect(뽑기("인도 검증 실행해줘"), "두 글자 이름의 끝 글자를 조사로 오해했다").toBe("인도");
  });

  it("화면에서 고른 항목(⌗이름::키)은 registry autoFill과 **같은 값**을 넘긴다", () => {
    // ⚠ verify_finding은 write:false라 autoFill이 안 돈다 — 여기서 안 하면 아무도 안 한다.
    const r = forcedToolFor("⌗결제서버::0123456789abcdef 검증 실행해줘");
    expect(r?.args.assetId).toBe("결제서버");
    expect(r?.args.finding).toBe("key:0123456789abcdef");
  });

  it("「이거 검증 실행해줘」에 직전 대상이 있으면 그것을 쓴다(#8 흐름)", () => {
    setLastTarget("payment-web-01", "critical Log4j", "취약점 배정");
    expect(forcedToolFor("이거 검증 실행해줘")?.args.assetId).toBe("payment-web-01");
  });
});

describe("배선 — 관문을 지우면 시험이 빨개진다", () => {
  const 결정 = (tool: string, args: Record<string, string>) =>
    JSON.stringify({ action: "tool", tool, args });

  it("★★ 모델이 지어낸 자산으로 verify_finding을 고르면 **도구를 안 부르고** 되묻는다", async () => {
    registerAsset({ id: "payment-web-01", name: "결제서버", path: "-" });
    mockChat.mockResolvedValueOnce(결정("verify_finding", { assetId: "web-01" }));
    const r = await runAgentLoop("고쳤다고 했는데 정말 닫혔는지 봐줘");
    expect(r?.output).toContain("어느 자산");
    expect(r?.output, "제품이 정한 말이 모델에게 다시 쓰였다").toBe(검증대상되물음());
    expect(r?.toolCalls.map((c) => c.tool), "실행 도구가 불렸다").not.toContain("verify_finding");
    expect(mockChat.mock.calls.length, "되묻기는 끝난 답이다 — 한 수 더 돌 이유가 없다").toBe(1);
  });

  it("★★ 앞선 도구가 있어도 되묻는 말은 **그대로** 나간다(재작성 경로를 안 탄다)", async () => {
    // ⚠ 앞선 도구를 **둘** 넣는다 — 하나면 calls.length === 1이라 옛 조건으로도 우연히 통과해
    //   이 시험이 아무것도 안 지킨다(반증에서 실제로 그랬다).
    mockChat
      .mockResolvedValueOnce(결정("compliance_status", {}))
      .mockResolvedValueOnce(결정("system_log_status", {}))
      .mockResolvedValueOnce(결정("verify_finding", { assetId: "web-01" }))
      .mockResolvedValueOnce("◆모델이 다시 쓴 답◆ 자산 ID로 다시 지정해 주세요.");
    const r = await runAgentLoop("고쳤다고 했는데 정말 닫혔는지 봐줘");
    expect(r?.output).not.toContain("◆모델이 다시 쓴 답◆");
    // 첫 줄이 **글자 그대로** 나가야 한다 — 뒤에 다음걸음이 붙는 것은 재작성이 아니다.
    expect(r?.output?.split("\n")[0]).toBe(검증대상되물음().split("\n")[0]);
    expect(r?.toolCalls.map((c) => c.tool)).not.toContain("verify_finding");
  });

  it("★★ 도구가 낸 되묻는 말도 **모델을 안 거치고** 나간다 — 사람이 없는 이름을 댄 회차", async () => {
    // 관문은 통과한다(사람이 그 말을 실제로 했다). 그다음은 도구가 정직하게 못 찾았다고 답하는데,
    // 그 문구가 재작성 경로를 타면 「다시 지목」이 「다시 지정」으로 바뀐다(⑬-124·128의 실제 사고).
    mockChat
      .mockResolvedValueOnce(결정("verify_finding", { assetId: "zzz-없는서버-99" }))
      .mockResolvedValueOnce("◆모델이 다시 쓴 답◆ 자산 ID로 다시 지정해 주세요.");
    const r = await runAgentLoop("zzz-없는서버-99 조치 정말 닫혔는지 봐줘");
    expect(r?.output).toBe(자산못찾음되묻기("zzz-없는서버-99"));
    expect(r?.output).toContain("다시 지목해 주세요");
    expect(r?.output).not.toContain("◆모델이 다시 쓴 답◆");
  });

  it("사람이 실제로 지목했으면 도구가 그대로 돈다(관문이 진짜 지시를 안 막는다)", async () => {
    registerAsset({ id: "payment-web-01", name: "결제서버", path: "-" });
    mockChat
      .mockResolvedValueOnce(결정("verify_finding", { assetId: "payment-web-01" }))
      .mockResolvedValueOnce('{"action":"final"}')
      .mockResolvedValueOnce("검증을 돌렸습니다.");
    const r = await runAgentLoop("결제서버 조치 정말 닫혔는지 봐줘");
    expect(r?.toolCalls.map((c) => c.tool)).toContain("verify_finding");
  });
});
