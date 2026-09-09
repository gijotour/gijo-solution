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

// ── 자가 진단 답에 남의 질문이 되비치지 않는다 ──────────────────────────────────
//
// 왜(2026-09-10 야간 재료 실측): 「시스템 자가 진단 해줘」 답이 이렇게 나갔다 —
//   ✓ 최근 24시간 느린 답: 8초 초과 3건 — "제품 소개해봐
//   #범위 vuln:10.0.0.12
//   #셸 pro"(14초) · "자산 중에 개인정보보호법에 해당되는것은? …
// 문제가 셋이다.
//   ① 질문에 붙은 **내부 표식 줄**(#범위 vuln:… · #셸 pro — 화면·하네스가 붙이는 메타)이
//      그대로 나가 말투 감시 「내부 식별자」에 걸린다 → tone-realanswers 빨강 → 배포 게이트가 막힌다.
//   ② 관리자 답에 **다른 사용자가 친 질문 본문**이 되비친다. 자가 진단은 상태를 말하는 자리지
//      남의 대화를 보여 주는 자리가 아니다(사내 민감한 물음일 수 있다).
//   ③ 어제 재료에서는 우연히 안 걸렸다 — **내용에 의존하는 빨강**이라 언제 다시 터질지 모른다.
// 그래서 판정은 「질문 본문을 싣지 않는다」로 못 박는다. 원장(slow_answers)에는 그대로 남긴다 —
// 걷어내는 자리는 **자가 진단 답 출력**뿐이다(원장은 /api/slow-answers·tools/slow-report.mjs가 쓴다).
import { systemHealthText } from "../src/engine/observability";
import { 말투위반 } from "../src/engine/tone";

describe("★ 자가 진단 답 — 남의 질문 본문이 되비치지 않는다", () => {
  const 민감한질문 = "우리 회사 대표 계좌 비밀번호 정책 어떻게 돼";
  const 표식붙은질문 = "제품 소개해봐\n#범위 vuln:10.0.0.12\n#셸 pro";

  it("★ 질문 본문이 자가 진단 항목에 실리지 않는다", () => {
    recordAnswerTiming(민감한질문, SLOW_ANSWER_MS + 6000, false, "scan");
    const c = systemHealth().checks.find((x) => x.id === "slow")!;
    expect(c.detail, `느린 답 항목에 질문 본문이 그대로 실렸다: ${c.detail}`).not.toContain("대표 계좌");
    expect(c.detail).not.toContain(민감한질문.slice(0, 10));
  });

  it("★★ 내부 표식 줄(#…)과 내부 키(vuln:…)가 자가 진단 답에 안 나온다", () => {
    recordAnswerTiming(표식붙은질문, SLOW_ANSWER_MS + 6000, false, "scan");
    const 답 = systemHealthText();
    expect(답, "내부 키가 자가 진단 답에 샜다").not.toMatch(/\b(vuln|asset|finding|task):[\w.:-]+/);
    for (const line of 답.split("\n")) {
      expect(line.trimStart().startsWith("#"), `내부 표식 줄이 그대로 나갔다: ${line}`).toBe(false);
    }
  });

  it("★★ 말투 규범을 자가 진단 답 전체에 걸어 0건", () => {
    recordAnswerTiming(표식붙은질문, SLOW_ANSWER_MS + 6000, false, "scan");
    recordAnswerTiming(민감한질문, SLOW_ANSWER_MS + 5000, false, null);
    const 답 = systemHealthText();
    const 걸린것 = 말투위반(답);
    expect(걸린것.length, `자가 진단 답이 말투 규범을 어겼다: ${걸린것.map((x) => x.이름).join(", ")}\n${답}`).toBe(0);
  });

  it("본문을 뺐어도 건수·소요·경로는 남는다 — 통째로 지운 게 아니다", () => {
    recordAnswerTiming(표식붙은질문, SLOW_ANSWER_MS + 6000, false, "scan");
    const c = systemHealth().checks.find((x) => x.id === "slow")!;
    expect(c.detail).toContain("1건");
    expect(c.detail).toContain("14초");
    expect(c.detail, "어느 경로가 받았는지가 사라졌다").toContain("Scan Agent");
  });
});
