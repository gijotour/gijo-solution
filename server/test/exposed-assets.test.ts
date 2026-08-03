// 인터넷 노출 자산 판별 — [실전 147상황, 2026-08-03]
//
// 왜 이 시험이 있나: 운영에서 "인터넷에 노출된 자산 있어?"에 **0건**이 나왔다.
// 등록부 57건 중 인프라·서비스 칸이 채워진 것은 4건뿐이고 그 4건이 전부 온프레미스였으니
// 0건이 **맞는** 답이었다. 그런데 판별식이 고장 나 있어도 답은 똑같이 「0건」이다.
// 맞는 0과 고장 난 0을 가릴 수 없다면 그 기능은 재는 척만 하는 것이다 —
// 그래서 걸리는 경우·안 걸리는 경우를 여기서 못 박는다.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  chat: vi.fn(async () => "[mock]"),
  embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import { 인터넷노출로적혔나 } from "../src/engine/agenttools";

describe("인터넷노출로적혔나 — 등록부에 적힌 말로 판정한다", () => {
  // 값은 실제 운영 등록부에서 그대로 가져왔다(2026-08-03). 지어낸 예로 시험하면
  // 담당자가 실제로 쓰는 말을 못 잡는 채로 통과한다.
  it("실제 등록부의 온프레미스 자산 3건은 노출로 세지 않는다", () => {
    expect(인터넷노출로적혔나("온프레미스(사내 GPU 서버)", "보안 운영 자동화")).toBe(false);
    expect(인터넷노출로적혔나("온프레미스", "이상거래탐지")).toBe(false);
    expect(인터넷노출로적혔나("온프레미스", "고객 상담")).toBe(false);
  });

  it("적어 두지 않은 자산은 노출이 아니라 **모름**이다 — 판별식은 false를 준다", () => {
    // false를 "노출 안 됨"으로 읽으면 안 된다. 그래서 답에는 모르는 건수를 따로 밝힌다.
    expect(인터넷노출로적혔나("", "")).toBe(false);
  });

  it("★ 걸리는 경우가 실제로 있다 — 이게 없으면 0건이 늘 참이 된다", () => {
    expect(인터넷노출로적혔나("AWS(인터넷 구간)", "대외 서비스")).toBe(true);
    expect(인터넷노출로적혔나("Public Cloud", "")).toBe(true);
    expect(인터넷노출로적혔나("", "외부 고객 포털")).toBe(true);
    expect(인터넷노출로적혔나("DMZ 구간", "")).toBe(true);
    expect(인터넷노출로적혔나("공인 IP 직결", "")).toBe(true);
    expect(인터넷노출로적혔나("External Load Balancer", "")).toBe(true);
  });
});

describe("답이 판정 근거를 숨기지 않는다", () => {
  it("스캔이 아니라 등록부로 판정했다고 밝히고, 모르는 건수를 따로 말한다", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/engine/agenttools.ts", import.meta.url), "utf8")
    );
    const 시작 = src.indexOf("function runExposedAssets");
    const 끝 = src.indexOf("function runReportActivity", 시작);
    // ⚠ 먼저 **감시가 헛돌지 않는지** 본다. 함수 이름이 바뀌면 indexOf가 -1이 되고
    //   빈 문자열에는 무엇도 없으니 아래 not.toContain이 저절로 통과한다 — 그때가 제일 위험하다.
    expect(시작, "runExposedAssets를 못 찾았다 — 이름이 바뀌었으면 이 시험부터 고쳐야 한다").toBeGreaterThan(0);
    expect(끝, "구간 끝(runReportActivity)을 못 찾았다").toBeGreaterThan(시작);
    const 본문 = src.slice(시작, 끝);
    expect(본문.length, "잘라 낸 구간이 함수 본문이 맞는지").toBeGreaterThan(400);
    expect(본문, "판정 근거(등록부)를 밝히지 않으면 담당자가 스캔 결과로 오해한다").toContain("스캔이 아니라");
    expect(본문, "모르는 자산을 '노출 없음'으로 흘려보내면 안전하다고 착각한다").toContain("모릅니다");
    expect(본문, "현황 조회에는 「다음 걸음」을 붙이지 않는다").not.toContain("다음걸음(");
  });
});
