// server/test/orchanalyze.test.ts — 복합 지시의 **분석 단계**가 등록된 취약점을 실제로 보는가.
//
// 왜 생겼나 (2026-09-10 ⑲ 팀원 축 첫 실측):
//   「우선순위 분석하고 리포트 작성해줘」는 스캔 없이 analyze → report로 계획된다. 그런데 analyze
//   갈래가 **같은 오케스트레이션의 스캔 결과**(accumulated)만 보고 있어서, 비어 있으면 곧장
//   chat(지시문)으로 떨어졌다 — 모델이 「[KEV 취약점 이름]」처럼 대괄호 빈칸만 남은 틀을 냈다.
//   ⚠ 같은 답의 3단계 리포트는 실데이터(자산 45·취약점 2,854·KEV 13)를 썼다.
//     숫자가 없어서가 아니라 **분석 단계만 그것을 안 봐서** 난 결함이다.
//
// ⚠⚠ 출력 글자로는 두 갈래를 못 가른다 — 목 chat이 무엇을 주든 parseAnalysis의 폴백이 그 글자를
//   그대로 summary로 돌려주기 때문이다(analysis.ts). 「analyzeFindings를 탔나」와 「chat 폴백을
//   탔나」의 출력이 똑같다. 그래서 **chat에 무엇을 넣어 불렀나**(호출 인자)로 판정한다.
//
// 계획서: 전-7(보여 주기) 곁가지 — 야간 회귀 하네스 ⑲ 팀원 축이 잡은 실결함의 짝 시험.
import { describe, it, expect, vi, beforeEach } from "vitest";
// 잣대는 **베끼지 않는다** — 하네스가 쓰는 그 상수를 그대로 읽어 온다(사본을 두면 목록이 늘 때
// 이 시험만 옛 잣대로 헛통과한다 · emptyanswer-guidance.test가 FAIL_MARKS에 쓰는 방식과 같다).
import { 자리표시자 } from "../../tools/opssim-rules.mjs";

// 실 LLM을 띄우지 않는다. 표면(7개)을 줄이면 llm을 import하는 파일이 통째로 죽는다
// (2026-08-29 화살 #14·#15 — verifyroutes 6개가 실증).
vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
  smallTalkReply: vi.fn(() => null),
}));

import { chat } from "../src/engine/llm";
import { dispatchInstruction } from "../src/engine/dispatcher";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";
import type { StandardFinding } from "../src/engine/bridge";

type Chat인자 = { agentId?: string; message?: string };
const 목chat = chat as unknown as { mock: { calls: Chat인자[][] }; mockClear: () => void };
const 호출 = (): Chat인자[] => 목chat.mock.calls.map((c) => c[0] ?? {});

// analysis.ts buildPrompt의 첫 줄 — 이 글자가 들어간 message면 **analyzeFindings를 탄 것**이다.
const 분석프롬프트표식 = "시니어 보안 분석가";
const 지시 = "우선순위 분석하고 리포트 작성해줘";

const 취약점 = (i: number, kev = false): StandardFinding => ({
  finding_type: `cve-2026-${1000 + i}`,
  severity: "high",
  evidence: `점검에서 ${i}번 항목이 확인됨`,
  source_tool: "nessus",
  kev,
});

// qa=true로 부른다 — 「…리포트 작성해줘」는 보고서꼴이라 사람 경로에서는 3초에 긴 작업으로
// 넘어간다(longanswer REPORT_HANDOFF_MS). 야간 하네스와 같은 경로로 끝까지 기다려 재는 것이
// 이 시험이 보려는 자리다(수집도 함께 꺼진다 — dispatchcollect.test의 계약).
const 실행 = () => dispatchInstruction(지시, undefined, undefined, "test", true);

beforeEach(() => {
  목chat.mockClear();
  resetAssetsForTests();
});

describe("★ 스캔 단계가 없어도 등록된 취약점으로 분석한다 (2026-09-10 ⑲ 첫 실측 수리)", () => {
  it("등록 취약점이 있으면 지시문을 그대로 모델에 던지지 않는다 — analyzeFindings를 탄다", async () => {
    registerAsset({ id: "vuln:10.10.20.41", name: "웹서버-01 (10.10.20.41)", path: "-" });
    recordFindings("vuln:10.10.20.41", [취약점(1, true), 취약점(2), 취약점(3)]);

    const r = await 실행();
    const 분석 = (r.steps ?? []).find((s) => s.action === "analyze");
    expect(분석, "복합 지시가 오케스트레이션을 안 탔다 — 단계 계획이 바뀌었는지 먼저 볼 것").toBeTruthy();

    const 분석호출 = 호출().filter((a) => a.agentId === "analysis");
    expect(
      분석호출.some((a) => String(a.message).includes(분석프롬프트표식)),
      "등록된 취약점이 있는데 분석 단계가 그것을 안 봤다 — 이번 사고 그대로다",
    ).toBe(true);
    expect(
      분석호출.some((a) => a.message === 지시),
      "지시문을 그대로 모델에 던졌다 — 자리표시자 답이 나던 폴백 경로다",
    ).toBe(false);

    // 무엇을 몇 건 봤는지 답에 드러난다(숫자 없는 분석은 분석이 아니다).
    expect(분석!.output).toContain("등록된 취약점 가운데 우선순위 상위 3건");
    // 「N건」을 말했으면 갈 곳도 함께 말한다(하네스의 「숫자만 주고 갈 곳 없음」 벌점).
    expect(분석!.output).toContain("▸ 다음:");
  });

  it("★ 상한을 넘겨 보내지 않는다 — 전량은 문맥에 원리상 안 들어간다", async () => {
    registerAsset({ id: "vuln:10.10.20.42", name: "웹서버-02 (10.10.20.42)", path: "-" });
    recordFindings("vuln:10.10.20.42", Array.from({ length: 100 }, (_, i) => 취약점(i)));

    await 실행();
    const 프롬프트 = 호출().map((a) => String(a.message)).find((m) => m.includes(분석프롬프트표식));
    expect(프롬프트, "분석 프롬프트를 못 찾았다").toBeTruthy();
    // buildPrompt의 예시(few-shot)에도 finding_type이 한 번 들어간다 — 그 1건을 뺀 수가 실제 재료다.
    const 실린건수 = (프롬프트!.match(/"finding_type"/g) ?? []).length - 1;
    expect(실린건수, "상한이 안 걸렸다 — 2,854건이면 약 20만 토큰이라 답이 통째로 죽는다").toBe(30);
  });
});

describe("★ 등록 취약점이 0건이면 그 사실을 말한다 (정직)", () => {
  it("일반 안내로 떨어지되, 안내라는 것이 답에 드러난다", async () => {
    const r = await 실행();
    const 분석 = (r.steps ?? []).find((s) => s.action === "analyze");
    expect(분석).toBeTruthy();
    expect(분석!.output).toContain("아직 등록된 취약점이 없습니다");
    expect(분석!.output).toContain("일반 안내로 답합니다");

    const 분석호출 = 호출().filter((a) => a.agentId === "analysis");
    expect(분석호출.some((a) => a.message === 지시), "0건이면 종전처럼 지시문으로 물어본다").toBe(true);
    expect(분석호출.some((a) => String(a.message).includes(분석프롬프트표식)), "재료가 없는데 분석을 흉내 내면 안 된다").toBe(false);
  });
});

describe("★ 자리표시자 답 잣대에 안 걸린다 — 이번 사고를 잡은 그 잣대", () => {
  it("잣대가 헛돌지 않는다(사고 당시의 실물이 실제로 걸린다)", () => {
    expect(자리표시자.test("1. [KEV 취약점 이름] — 즉시 조치 필요"), "잣대가 안 문다 — 시험이 헛통과한다").toBe(true);
    expect(자리표시자.test("각주 [1] 과 [출처] 는 빈칸이 아니다"), "각주까지 물면 정답에 벌점이 붙는다").toBe(false);
  });

  it("새 분석 답(머리말·다음 걸음)이 잣대에 안 걸린다", async () => {
    registerAsset({ id: "vuln:10.10.20.43", name: "웹서버-03 (10.10.20.43)", path: "-" });
    recordFindings("vuln:10.10.20.43", [취약점(7, true)]);

    const r = await 실행();
    const 분석 = (r.steps ?? []).find((s) => s.action === "analyze");
    expect(자리표시자.test(String(분석!.output)), "우리가 붙인 글자가 빈칸 틀로 읽힌다").toBe(false);
  });
});
