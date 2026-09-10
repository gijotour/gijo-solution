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
  it("★ 문턱을 넘은 실사용 답만 적힌다", async () => {
    recordAnswerTiming("이번 주 예정된 점검 있어?", SLOW_ANSWER_MS + 2000, false);
    recordAnswerTiming("취약점", 100, false);
    expect(건수()).toBe(1);
    const row = db.prepare("SELECT question, ms FROM slow_answers").get() as { question: string; ms: number };
    expect(row.question).toBe("이번 주 예정된 점검 있어?");
  });

  it("★★ qa 호출은 느려도 적지 않는다 — 측정이 원장을 도배하면 실사용자가 묻힌다", async () => {
    recordAnswerTiming("게이트 문항", 60000, true);
    expect(건수()).toBe(0);
  });

  it("질문은 200자에서 자른다 — 원장은 실마리지 본문 보관소가 아니다", async () => {
    recordAnswerTiming("가".repeat(500), SLOW_ANSWER_MS + 1, false);
    const row = db.prepare("SELECT question FROM slow_answers").get() as { question: string };
    expect(row.question.length).toBe(200);
  });
});

describe("자가 진단 연결", () => {
  it("★ 「최근 24시간 느린 답」 항목이 자가 진단에 나온다", async () => {
    const c = (await systemHealth()).checks.find((x) => x.id === "slow");
    expect(c, "slow 항목이 자가 진단 목록에 없다").toBeTruthy();
    expect(c!.level).toBe("ok");
  });

  it("몇 건 쌓이면 노랑(warn)을 든다 — 느린 답은 장애가 아니라 경향이라 1건으로는 안 든다", async () => {
    recordAnswerTiming("느린 질문 하나", SLOW_ANSWER_MS + 1000, false);
    expect((await systemHealth()).checks.find((x) => x.id === "slow")!.level).toBe("ok");
    for (let i = 0; i < 5; i++) recordAnswerTiming(`느린 질문 ${i}`, SLOW_ANSWER_MS + 1000, false);
    const c = (await systemHealth()).checks.find((x) => x.id === "slow")!;
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

  it("★ 질문 본문이 자가 진단 항목에 실리지 않는다", async () => {
    recordAnswerTiming(민감한질문, SLOW_ANSWER_MS + 6000, false, "scan");
    const c = (await systemHealth()).checks.find((x) => x.id === "slow")!;
    expect(c.detail, `느린 답 항목에 질문 본문이 그대로 실렸다: ${c.detail}`).not.toContain("대표 계좌");
    expect(c.detail).not.toContain(민감한질문.slice(0, 10));
  });

  it("★★ 내부 표식 줄(#…)과 내부 키(vuln:…)가 자가 진단 답에 안 나온다", async () => {
    recordAnswerTiming(표식붙은질문, SLOW_ANSWER_MS + 6000, false, "scan");
    const 답 = (await systemHealthText());
    expect(답, "내부 키가 자가 진단 답에 샜다").not.toMatch(/\b(vuln|asset|finding|task):[\w.:-]+/);
    for (const line of 답.split("\n")) {
      expect(line.trimStart().startsWith("#"), `내부 표식 줄이 그대로 나갔다: ${line}`).toBe(false);
    }
  });

  it("★★ 말투 규범을 자가 진단 답 전체에 걸어 0건", async () => {
    recordAnswerTiming(표식붙은질문, SLOW_ANSWER_MS + 6000, false, "scan");
    recordAnswerTiming(민감한질문, SLOW_ANSWER_MS + 5000, false, null);
    const 답 = (await systemHealthText());
    const 걸린것 = 말투위반(답);
    expect(걸린것.length, `자가 진단 답이 말투 규범을 어겼다: ${걸린것.map((x) => x.이름).join(", ")}\n${답}`).toBe(0);
  });

  it("본문을 뺐어도 건수·소요·경로는 남는다 — 통째로 지운 게 아니다", async () => {
    recordAnswerTiming(표식붙은질문, SLOW_ANSWER_MS + 6000, false, "scan");
    const c = (await systemHealth()).checks.find((x) => x.id === "slow")!;
    expect(c.detail).toContain("1건");
    expect(c.detail).toContain("14초");
    expect(c.detail, "어느 경로가 받았는지가 사라졌다").toContain("Scan Agent");
  });
});

// ── 검토관 적발 3건(2026-09-10) — 같은 까닭이 남아 있던 자리들 ────────────────────
//
// 앞 수리는 「자가 진단 답에 남의 질문 본문을 싣지 않는다」였다. 검토관이 그 **까닭**을
// 들고 파일을 다시 훑어 셋을 찾았다.
//   ① 좁은 자리만 막고 **넓은 자리는 열려 있었다** — 원장 정문 GET /api/slow-answers가
//      authMiddleware라 로그인한 아무 담당자나 남의 질문 원문(각 200자·14일치)을 받아 갔다.
//      같은 성질의 원장(답변 지적)은 2026-09-07에 이미 admin으로 닫았다 — 자물쇠가 원장마다 달랐다.
//   ② 「내용에 따라 갈리는 빨강」이 **구조적으로 닫히지 않았다** — 질문 대신 실은 값(팀원 표시
//      이름)도 사람이 자유롭게 적는 글이라, 이름을 `vuln:10.0.0.99`로 바꾸면 같은 빨강이 다시 난다.
//      (agents.ts:setAgentName은 길이 30자만 본다.)
//   ③ 파일 안 머리말 하나가 이 변경으로 거짓이 됐다 — 아래 ③은 소스 대조로 못 박는다.
import fs from "node:fs";
import { setAgentName } from "../src/engine/agents";

const 관측성소스 = fs.readFileSync(new URL("../src/engine/observability.ts", import.meta.url), "utf8");

describe("★ 적발① 느린 답 원장 정문 — 남의 질문 원문은 admin만", () => {
  it("GET /api/slow-answers가 adminMiddleware로 닫혀 있다", async () => {
    const 줄 = 관측성소스.split("\n").find((l) => /app\.get\(\s*"\/api\/slow-answers"/.test(l)) ?? "";
    expect(줄, "/api/slow-answers 라우트를 못 찾았다 — 경로가 바뀌었으면 이 시험부터 고친다").not.toBe("");
    expect(줄, `로그인한 아무 계정이 남의 질문 원문을 받아 간다: ${줄.trim()}`).toContain("adminMiddleware");
  });

  it("자가 진단(GET /api/system-health)은 admin 전용이 아니다 — 담당자도 상태는 본다", async () => {
    // ⚠ 이 짝을 함께 못 박는 이유: ①을 고치면서 자가 진단까지 admin으로 닫으면
    //   담당자가 「지금 이상 있나」를 못 본다(system_health 도구도 requiredRole이 없다).
    //   즉 **본문을 안 싣는 것**이 유일한 방어선이라, 위 「본문 안 싣기」 시험들이 더 중요해진다.
    const 줄 = 관측성소스.split("\n").find((l) => /app\.get\(\s*"\/api\/system-health"/.test(l)) ?? "";
    expect(줄).not.toBe("");
    expect(줄, "자가 진단을 admin 전용으로 닫았다 — 담당자가 상태를 못 본다").not.toContain("adminMiddleware");
  });
});

describe("★ 적발② 팀원 표시 이름이 자가 진단 답을 다시 빨갛게 만들지 않는다", () => {
  const 되돌리기 = () => setAgentName("scan", null, "test");

  it("★★ 이름에 내부 키가 들어가도 자가 진단 답은 말투 규범 0건", async () => {
    try {
      setAgentName("scan", "vuln:10.0.0.99", "test");
      recordAnswerTiming("아무 질문", SLOW_ANSWER_MS + 6000, false, "scan");
      const 답 = (await systemHealthText());
      const 걸린것 = 말투위반(답);
      expect(걸린것.length, `팀원 이름이 말투 규범을 어겼다: ${걸린것.map((x) => x.이름).join(", ")}\n${답}`).toBe(0);
      // 지우는 게 아니라 **우리가 지은 기본 이름으로 돌아간다** — 어느 경로였는지는 남는다.
      expect(답, "경로가 통째로 사라졌다").toContain("Scan Agent");
    } finally { 되돌리기(); }
  });

  it("겹치는 기호가 든 이름도 마찬가지다", async () => {
    try {
      setAgentName("scan", "✅점검반", "test");
      recordAnswerTiming("아무 질문", SLOW_ANSWER_MS + 6000, false, "scan");
      const 답 = (await systemHealthText());
      expect(말투위반(답).length, `기호 든 이름이 답에 그대로 실렸다:\n${답}`).toBe(0);
    } finally { 되돌리기(); }
  });

  it("★ 규범을 지키는 커스텀 이름은 그대로 쓴다 — 과잉 차단이 아니다", async () => {
    try {
      setAgentName("scan", "우리팀 점검반", "test");
      recordAnswerTiming("아무 질문", SLOW_ANSWER_MS + 6000, false, "scan");
      const c = (await systemHealth()).checks.find((x) => x.id === "slow")!;
      expect(c.detail, "조직이 지은 이름을 안 쓰고 기본 이름으로 덮었다").toContain("우리팀 점검반");
    } finally { 되돌리기(); }
  });
});

describe("★ 적발③ 원장 머리말이 이 변경 뒤에도 참인가", () => {
  it("자가 진단이 「어떤 질문이 느린가」를 답한다고 적어 두지 않는다", async () => {
    // 이제 자가 진단은 어떤 질문이었는지 답하지 않는다(그것이 위 수리의 요지다).
    // 한 파일이 정반대를 말하면 다음 사람은 틀린 쪽을 믿는다.
    const 머리말 = 관측성소스.slice(0, 관측성소스.indexOf("export const SLOW_ANSWER_MS"));
    expect(머리말, "원장 머리말이 아직 「자가 진단이 어떤 질문이 느린가를 답한다」고 적는다").not.toMatch(
      /자가\s*진단이\s*"?요즘\s*어떤\s*질문이\s*느린가"?/,
    );
  });
});
