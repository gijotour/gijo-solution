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
// ⚠⚠ 목을 **스키마 JSON으로** 답하게 두는 것이 계약이다(2026-09-10 검토관 하 수리).
//   전에는 목이 늘 "[mock] LLM 응답"을 줘서 parseAnalysis가 **항상 폴백**을 탔다 — 즉 시험이 재는
//   조합이 언제나 「성공 머리말 + 실패 요약」이었고, 그것이 정확히 제품에서 문제가 되던 조합이라
//   결함을 **원리상 못 봤다.** 지금은 성공 갈래를 기본으로 재고, 실패 갈래는 아래에서 따로 문다.
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
  chat: vi.fn(),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
  smallTalkReply: vi.fn(() => null),
}));

import { chat } from "../src/engine/llm";
import { dispatchInstruction, ANALYZE_TOP_N } from "../src/engine/dispatcher";
import { registerAsset, recordFindings, resetAssetsForTests } from "../src/engine/assets";
import type { StandardFinding } from "../src/engine/bridge";

type Chat인자 = { agentId?: string; message?: string };
const 목chat = chat as unknown as {
  mock: { calls: Chat인자[][] };
  mockClear: () => void;
  mockImplementation: (f: (a: Chat인자) => Promise<string>) => void;
};
const 호출 = (): Chat인자[] => 목chat.mock.calls.map((c) => c[0] ?? {});

// analysis.ts buildPrompt의 첫 줄 — 이 글자가 들어간 message면 **analyzeFindings를 탄 것**이다.
const 분석프롬프트표식 = "시니어 보안 분석가";
const 지시 = "우선순위 분석하고 리포트 작성해줘";
// 분석 프롬프트에는 스키마 JSON을, 나머지에는 아무 글이나 — 제품의 성공 갈래를 재는 기본 목.
const 정상JSON = '{"summary":"즉시 조치 1건, 순차 조치 2건입니다.","prioritized":[],"plainExplanation":"쉬운 설명"}';
const 기본목 = async (a: Chat인자) => (String(a?.message ?? "").includes(분석프롬프트표식) ? 정상JSON : "[mock] LLM 응답");

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
const 실행 = (말: string = 지시) => dispatchInstruction(말, undefined, undefined, "test", true);

beforeEach(() => {
  목chat.mockClear();
  목chat.mockImplementation(기본목); // 갈래마다 다시 심는다 — mockClear는 구현을 안 지운다.
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
    expect(분석!.output).toContain("조치 대상 3건");
    // 「N건」을 말했으면 갈 곳도 함께 말한다(하네스의 「숫자만 주고 갈 곳 없음」 벌점).
    expect(분석!.output).toContain("▸ 다음:");
    // ⚠ 번호로 고르라고 안내하려면 **번호 목록이 있어야** 한다 — 이 답엔 없으므로 목록을 먼저 받으라고 말한다.
    expect(분석!.output).not.toContain("\"1번 담당자 배정해줘\"");
  });

  it("★ 상한을 넘겨 보내지 않는다 — 전량은 문맥에 원리상 안 들어간다", async () => {
    registerAsset({ id: "vuln:10.10.20.42", name: "웹서버-02 (10.10.20.42)", path: "-" });
    recordFindings("vuln:10.10.20.42", Array.from({ length: 100 }, (_, i) => 취약점(i)));

    const 분석 = ((await 실행()).steps ?? []).find((s) => s.action === "analyze");
    const 프롬프트 = 호출().map((a) => String(a.message)).find((m) => m.includes(분석프롬프트표식));
    expect(프롬프트, "분석 프롬프트를 못 찾았다").toBeTruthy();
    // buildPrompt의 예시(few-shot)에도 finding_type이 한 번 들어간다 — 그 1건을 뺀 수가 실제 재료다.
    const 실린건수 = (프롬프트!.match(/"finding_type"/g) ?? []).length - 1;
    expect(실린건수, "상한이 안 걸렸다 — 2,854건이면 약 20만 토큰이라 답이 통째로 죽는다").toBe(ANALYZE_TOP_N);
    // ★ **모수를 밝힌다** — 상한에 닿았으면 「닿았다고 말한다」(handlers 현황상한과 같은 규율).
    //   안 밝히면 담당자가 「우선순위 분석 = 8건」으로 읽는다.
    expect(분석!.output, "총계 없이 상위 N건만 말하면 그 수가 총계로 읽힌다").toContain("조치 대상 100건 가운데");
  });

  it("★ 스캔 잡음만 쌓였으면 그것을 재료로 삼지 않는다 — 등록 취약점을 본다", async () => {
    // bridge.모델스캔은 **대상이 아닌 자산마다 한 건**(scan_not_supported)을 돌려준다.
    // 그 한 건이 「스캔 결과가 있다」로 읽히면, 고치려던 결함이 형제 갈래에 그대로 남는다.
    registerAsset({ id: "vuln:10.10.20.44", name: "웹서버-04 (10.10.20.44)", path: "-" });
    recordFindings("vuln:10.10.20.44", [취약점(4, true), 취약점(5)]);

    const r = await 실행("스캔하고 우선순위 분석해줘");
    const 스캔 = (r.steps ?? []).find((s) => s.action === "scan");
    expect(스캔, "스캔 단계가 안 잡혔다 — 이 시험이 보려는 자리가 아니다").toBeTruthy();

    const 프롬프트 = 호출().map((a) => String(a.message)).find((m) => m.includes(분석프롬프트표식));
    expect(프롬프트, "분석이 아예 안 돌았다").toBeTruthy();
    expect(프롬프트!.includes("scan_not_supported"), "스캔 잡음을 취약점으로 분석했다").toBe(false);
    expect(프롬프트!.includes("cve-2026-1004"), "등록된 진짜 취약점을 안 봤다").toBe(true);

    const 분석 = (r.steps ?? []).find((s) => s.action === "analyze");
    expect(분석!.output, "원천이 갈렸는데 말하지 않으면 앞 단계 건수로 읽힌다").toContain("이번 스캔에서는 새로 나온 것이 없어");
  });

  it("★ 자동 분석에 실패하면 「분석했습니다」라고 말하지 않는다 (폴백을 정상 출력으로 취급 금지)", async () => {
    registerAsset({ id: "vuln:10.10.20.45", name: "웹서버-05 (10.10.20.45)", path: "-" });
    recordFindings("vuln:10.10.20.45", [취약점(9, true)]);
    // 응답 예산(800토큰)을 넘겨 JSON이 중간에 잘린 실물 — extractJson이 못 읽어 폴백이 된다.
    목chat.mockImplementation(async (a: Chat인자) =>
      String(a?.message ?? "").includes(분석프롬프트표식) ? '{"summary":"즉시 조치 1건","prioritized":[{"index":0,"sever' : "[mock] LLM 응답",
    );

    const 분석 = ((await 실행()).steps ?? []).find((s) => s.action === "analyze");
    expect(분석!.output, "실패한 분석에 성공 머리말을 씌웠다 — 자기모순 답이 나간다").not.toContain("분석했습니다");
    expect(분석!.output).toContain("형식대로 받지 못했습니다");
  });
});

describe("★ 지금 조치할 것이 0건이면 그 사실을 말한다 (정직)", () => {
  it("일반 안내로 떨어지되, 안내라는 것이 답에 드러난다 — 그리고 배너 자리를 뺏지 않는다", async () => {
    const r = await 실행();
    const 분석 = (r.steps ?? []).find((s) => s.action === "analyze");
    expect(분석).toBeTruthy();
    expect(분석!.output).toContain("지금 조치할 취약점이 없습니다");
    expect(분석!.output).toContain("일반 안내입니다");
    // ⚠ **앞머리는 모델 답의 것**이다. 정직 문구를 앞에 두면 llm.ts가 붙인 배너가 둘째 줄로 밀려
    //   noevidence.근거없음종류판정(단계 본문의 startsWith)이 「근거 없음」 표식을 통째로 놓친다 —
    //   배너 글자는 보이는데 화면이 추정 숫자를 진하게 그린다(2026-09-06에 닫은 그 함정).
    expect(분석!.output.startsWith("[mock] LLM 응답"), "정직 문구가 배너 자리를 뺏었다").toBe(true);

    const 분석호출 = 호출().filter((a) => a.agentId === "analysis");
    expect(분석호출.some((a) => a.message === 지시), "0건이면 종전처럼 지시문으로 물어본다").toBe(true);
    expect(분석호출.some((a) => String(a.message).includes(분석프롬프트표식)), "재료가 없는데 분석을 흉내 내면 안 된다").toBe(false);
  });
});

describe("★ 한 답 안에서 범위가 어긋나지 않는다", () => {
  it("지시문이 콕 집은 자산이면 리포트 단계도 같은 범위를 받는다", async () => {
    registerAsset({ id: "vuln:10.10.20.46", name: "웹서버-06 (10.10.20.46)", path: "-" });
    recordFindings("vuln:10.10.20.46", [취약점(6, true)]);
    registerAsset({ id: "vuln:10.10.20.47", name: "웹서버-07 (10.10.20.47)", path: "-" });
    recordFindings("vuln:10.10.20.47", [취약점(8)]);

    const r = await 실행("10.10.20.46 우선순위 분석하고 리포트 작성해줘");
    const 리포트 = (r.steps ?? []).find((s) => s.action === "report");
    expect(리포트, "리포트 단계가 안 잡혔다").toBeTruthy();
    expect(리포트!.assetIds, "분석은 자산 1대, 리포트는 전사 — 한 답에 모수가 둘이면 그게 거짓말이다")
      .toEqual(["vuln:10.10.20.46"]);

    const 프롬프트 = 호출().map((a) => String(a.message)).find((m) => m.includes(분석프롬프트표식));
    expect(프롬프트!.includes("cve-2026-1008"), "범위 밖 자산의 취약점까지 분석했다").toBe(false);
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
