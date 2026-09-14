// server/test/plan-conjunction.test.ts — planInstruction의 접속사 규칙(2026-09-14 사장님 승인).
// 계획서: 중-7 + 전-4
//
// 왜 생겼나 (실측 2026-09-14, route-explain --no-build) — planInstruction이 낱말 공출현만으로
// 단계를 세어 「우선순위 리포트 작성해줘」·「스캔 결과 리포트 만들어줘」·「재스캔 리포트 보여줘」·
// 「취약점 분석 리포트 작성해줘」·「분석 보고서 뽑아줘」가 전부 2단계 오케스트레이션으로 갔다 —
// 동사가 사실 하나(문장 끝 동작)인데 스캔 낱말이 있으면 시키지 않은 전 자산 스캔이 결재판 없이
// 돌았다(2026-08-03 실측 190초 부류, dispatcher.ts resolveScopeFromText 주석 참고). 연이은 동작
// 낱말 **사이의 글**에 접속사(하고·해서·…)가 있을 때만 다음 단계로 세고, 없으면 뒤 낱말(문장 끝
// 동작)만 남기는 것이 수리다.
//
// ⚠ 정규식을 베끼지 않는다 — 제품이 내보내는 STEP_JOIN_RE를 그대로 부른다.
import { describe, it, expect } from "vitest";
import { planInstruction, STEP_JOIN_RE, 결정적도착지 } from "../src/engine/dispatcher";

describe("STEP_JOIN_RE 헛돌기 방지", () => {
  it("접속사 낱말은 참이다", () => {
    expect(STEP_JOIN_RE.test("하고")).toBe(true);
  });
  it("접속사가 없는 보통 글은 거짓이다", () => {
    expect(STEP_JOIN_RE.test("결과 ")).toBe(false);
  });
});

describe("planInstruction — 접속사가 있으면 2단계(이상)를 유지한다", () => {
  const 양성: string[] = [
    "스캔하고 리포트까지 만들어줘",
    "sample-web01 스캔하고 결과 리포트까지 만들어줘",
    "우선순위 분석하고 리포트 작성해줘",
    "스캔한 뒤 리포트 만들어줘",
    "스캔 끝나면 리포트 만들어줘",
    "스캔, 우선순위 분석해줘",
    // ⚠ 2026-09-14 검토관 [하] 수리 — 뜻이 같은 세 접속어가 서로 다르게 굴렀다. 「스캔 후
    //   리포트」만 2단계였고 「스캔 뒤·다음 리포트」는 앞에 「한」이 없어 1단계로 줄어
    //   **시킨 스캔이 조용히 빠졌다**. 셋을 같은 줄에 두어 대칭을 못 박는다.
    "스캔 후 리포트 만들어줘",
    "스캔 뒤 리포트 만들어줘",
    "스캔 다음 리포트 만들어줘",
  ];
  it.each(양성)("「%s」→ 2단계 이상", (q) => {
    expect(planInstruction(q).length, `「${q}」가 접속사가 있는데도 1단계로 줄었다`).toBeGreaterThanOrEqual(2);
  });

  it("3단계(스캔·분석·리포트가 전부 접속사로 이어지면)도 유지한다", () => {
    const steps = planInstruction("스캔하고 우선순위 분석해서 리포트 만들어줘");
    expect(steps.map((s) => s.action)).toEqual(["scan", "analyze", "report"]);
  });
});

describe("planInstruction — 접속사가 없으면 문장 끝 동작만 남긴다(수리 핵심)", () => {
  // 실측(2026-09-14): 다섯 문장 다 낱말은 둘 이상 걸리지만 접속사가 없다 — 앞 낱말을 버리고
  // 뒤 낱말(문장 끝 동작=report)만 남아야 한다.
  const 음성: string[] = [
    "우선순위 리포트 작성해줘",
    "스캔 결과 리포트 만들어줘",
    "취약점 분석 리포트 작성해줘",
    "분석 보고서 뽑아줘",
    "재스캔 리포트 보여줘",
  ];
  it.each(음성)("「%s」→ 문장 끝 동작(report)만", (q) => {
    expect(planInstruction(q).map((s) => s.action), `「${q}」가 접속사 없이도 2단계로 남았다`).toEqual(["report"]);
  });
});

// ── 도착지 회귀 — 제품 함수(결정적도착지)로 실제 라우팅 결과를 잰다 ──────────────────────
// ⚠ planInstruction의 action 배열만으로는 「어디로 가는가」를 못 본다 — REPORT_CREATE_RE가
//   「보여줘」를 안 받아서 5문장 중 4개는 [36] generateReport로, 「재스캔 리포트 보여줘」만은
//   ⑨ 모델 선택(빈 배열)으로 갈린다. 기대값을 섞으면 이 한 줄이 조용히 거짓이 된다.
// ★ 재현 경로(2026-09-14 검토관 [하]) — 수리 보고의 「7문장 before/after」는 사람이 손으로
//   붙이는 산문이라 낡는다. **이 describe가 그 7문장을 제품 함수로 매번 다시 잰다** — 보고를
//   못 믿겠으면 이 시험을 돌리면 된다(`tools/wsl-test.sh test/plan-conjunction.test.ts`).
describe("도착지 회귀 — 결정적도착지로 실제 라우팅을 잰다", () => {
  const 리포트로감: string[] = [
    "우선순위 리포트 작성해줘",
    "스캔 결과 리포트 만들어줘",
    "취약점 분석 리포트 작성해줘",
    "분석 보고서 뽑아줘",
  ];
  it.each(리포트로감)("「%s」→ [36] 리포트 만들기(generateReport)", async (q) => {
    const 걸림 = await 결정적도착지(q, { 역할: "admin" });
    expect(걸림[0]?.이름, `「${q}」가 리포트 만들기로 안 갔다`).toBe("리포트 만들기");
    expect(걸림[0]?.도착).toBe("generateReport");
  });

  it("「재스캔 리포트 보여줘」→ 걸리는 결정적 규칙이 없다(⑨ 모델 선택)", async () => {
    const 걸림 = await 결정적도착지("재스캔 리포트 보여줘", { 역할: "admin" });
    expect(걸림, "REPORT_CREATE_RE가 「보여줘」를 받게 됐거나, 다른 결정적 규칙이 새로 걸렸다").toEqual([]);
  });

  it("「sample-web01 스캔하고 결과 리포트까지 만들어줘」→ 그대로 [29] 복합 지시 2단계", async () => {
    const 걸림 = await 결정적도착지("sample-web01 스캔하고 결과 리포트까지 만들어줘", { 역할: "admin" });
    expect(걸림[0]?.이름).toBe("복합 지시");
    expect(걸림[0]?.도착).toBe("오케스트레이션 2단계");
  });

  it("「우선순위 분석하고 리포트 작성해줘」→ 그대로 [29] 복합 지시 2단계(승인된겹침과 짝)", async () => {
    const 걸림 = await 결정적도착지("우선순위 분석하고 리포트 작성해줘", { 역할: "admin" });
    expect(걸림[0]?.이름).toBe("복합 지시");
    expect(걸림[0]?.도착).toBe("오케스트레이션 2단계");
  });
});
