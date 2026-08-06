// 느린 답 원장 — [2026-08-07 · 계획서 후-1 관측성 몫]
//
// 왜: 147상황에서 30초 걸린 질문들을 매번 **사후에 수동으로** 추적했다. 온프렘에선 우리가
// 그 자리에 없다 — 담당자를 기다리게 한 질문을 제품이 스스로 적고, 자가 진단이 답해야 한다.
//
// 계약 셋:
//   ① 문턱(8초) 아래는 적지 않는다 — 원장은 빠른 답 수백 건이 아니라 느린 답을 보는 자리다
//   ② qa 호출은 적지 않는다 — 측정 도구(게이트·147상황)가 원장을 도배하면 실사용자가 묻힌다
//   ③ 자가 진단에 「최근 24시간 느린 답」 항목이 나온다 — 없으면 만든 보람이 없다
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { recordAnswerTiming, systemHealth, SLOW_ANSWER_MS } from "../src/engine/observability";

beforeEach(() => { db.prepare("DELETE FROM slow_answers").run(); });
const 건수 = () => (db.prepare("SELECT COUNT(*) AS n FROM slow_answers").get() as { n: number }).n;

describe("느린 답 원장 — 기록 규칙", () => {
  it("★ 문턱을 넘은 실사용 답만 적힌다", () => {
    recordAnswerTiming("이번 주 예정된 점검 있어?", SLOW_ANSWER_MS + 2000, false);
    recordAnswerTiming("취약점", 100, false);
    expect(건수()).toBe(1);
    const row = db.prepare("SELECT question, ms FROM slow_answers").get() as { question: string; ms: number };
    expect(row.question).toBe("이번 주 예정된 점검 있어?");
  });

  it("★★ qa 호출은 느려도 적지 않는다 — 측정이 원장을 도배하면 실사용자가 묻힌다", () => {
    recordAnswerTiming("게이트 문항", 60000, true);
    expect(건수()).toBe(0);
  });

  it("질문은 200자에서 자른다 — 원장은 실마리지 본문 보관소가 아니다", () => {
    recordAnswerTiming("가".repeat(500), SLOW_ANSWER_MS + 1, false);
    const row = db.prepare("SELECT question FROM slow_answers").get() as { question: string };
    expect(row.question.length).toBe(200);
  });
});

describe("자가 진단 연결", () => {
  it("★ 「최근 24시간 느린 답」 항목이 자가 진단에 나온다", () => {
    const c = systemHealth().checks.find((x) => x.id === "slow");
    expect(c, "slow 항목이 자가 진단 목록에 없다").toBeTruthy();
    expect(c!.level).toBe("ok");
  });

  it("몇 건 쌓이면 노랑(warn)을 든다 — 느린 답은 장애가 아니라 경향이라 1건으로는 안 든다", () => {
    recordAnswerTiming("느린 질문 하나", SLOW_ANSWER_MS + 1000, false);
    expect(systemHealth().checks.find((x) => x.id === "slow")!.level).toBe("ok");
    for (let i = 0; i < 5; i++) recordAnswerTiming(`느린 질문 ${i}`, SLOW_ANSWER_MS + 1000, false);
    const c = systemHealth().checks.find((x) => x.id === "slow")!;
    expect(c.level).toBe("warn");
    expect(c.detail).toContain("건");
  });
});
