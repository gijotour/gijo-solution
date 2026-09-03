// approvedistill.test.ts — 증류 후보 자동 승인 도구의 계약 (증류학습 계획서 §12.2·§12.4, 2026-09-03).
//
// 왜 이 도구가 존재하나: 서버의 일괄 승인(acceptStrongCandidates)은 증류 후보를 **일부러 건너뛴다**
//   (「교사 문답은 사람 눈을 한 번은 지나야 한다」). 사다리 3일 동안만 사장님이 **증류분에 한해** 자동 심사를
//   위임했고, 그 위임의 경계가 이 시험이 지키는 것이다:
//   ① source==="distill"이 아닌 후보(실대화·작업내역)는 **절대** 손대지 않는다.
//   ② 품질 심사(JSON 조각·한자·60자 미만)는 순수 함수라 여기서 직접 잰다 — 서버에 붙지 않고 판정만 시험한다.
//   ③ 승인 사유는 서버 감사에 안 남는다(감사는 「승인 / <id>」뿐) → 결과 파일이 유일한 근거이므로 그 자리도 고정한다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 심사, 고르기, 오늘날짜, 답최소 } from "../../tools/approve-distill.mjs";

const 좋은답 = "KEV 목록은 실제로 악용이 확인된 취약점을 모아 둔 자료라서 조치 우선순위를 정할 때 가장 먼저 봅니다. 담당자는 이 목록에 오른 취약점부터 처리하도록 계획을 세우는 것이 좋습니다.";
const 후보 = (over: Record<string, unknown> = {}) => ({ id: "cl:d1", source: "distill", topic: "취약점", question: "KEV 목록은 어떻게 쓰나요?", answer: 좋은답, ...over });

describe("증류 후보 품질 심사", () => {
  it("멀쩡한 한국어 문답은 통과한다(null)", () => {
    expect(심사(후보())).toBeNull();
  });

  it(`답이 ${답최소}자 미만이면 떨어진다 — 서버 편입(30자)보다 엄하다, 가중치에 넣을 재료라서`, () => {
    expect(심사(후보({ answer: "가".repeat(답최소 - 1) }))).toBe(`답 ${답최소}자 미만`);
    expect(심사(후보({ answer: "가".repeat(답최소) }))).toBeNull();
  });

  it("한자가 섞이면 떨어진다 — 중국어 드리프트를 학습 재료로 굳히지 않는다", () => {
    expect(심사(후보({ answer: `취약점 관리는 中國式 접근과 다릅니다. ${좋은답}` }))).toBe("한자 섞임");
    expect(심사(후보({ question: "取扱 방법은?", answer: 좋은답 }))).toBe("한자 섞임"); // 질문 쪽도 본다
  });

  it("JSON·덤프 조각이 답에 있으면 떨어진다 — 교사가 자료 파일의 키 이름을 읽어 만든 문답이다", () => {
    expect(심사(후보({ answer: `{"cve":["CVE-2015-9251"],"epss_score":0.005} 라고 적혀 있습니다. ${좋은답}` }))).toBe("JSON 조각");
    expect(심사(후보({ answer: `[[표1]] 참고. ${좋은답}` }))).toBe("JSON 조각");
  });

  it("★ 영어 원문 인용이 든 답(--src-lang en 산출물)은 떨어지지 않는다 — 인용은 결함이 아니다", () => {
    const 인용답 = `KEV 목록은 악용이 확인된 취약점 모음입니다. 원문: "Organizations should use the KEV catalog as an input to their prioritization framework." 그래서 이 목록부터 처리합니다.`;
    expect(심사(후보({ answer: 인용답 }))).toBeNull();
  });

  it("빈 문답은 떨어진다", () => {
    expect(심사(후보({ answer: "" }))).toBe("빈 문답");
    expect(심사(후보({ question: "  " }))).toBe("빈 문답");
    expect(심사(undefined)).toBe("빈 문답"); // 목록이 이상해도 죽지 않는다
  });
});

describe("무엇을 건드리는가 — 위임의 경계", () => {
  const 목록 = [
    { id: "cl:d1", source: "distill", topic: "취약점" },
    { id: "cl:real", source: "chatlog", topic: "취약점" },
    { id: "ws:1:2", source: "worksession", topic: "취약점" },
    { id: "cl:d2", source: "distill", topic: "일반" },
  ];

  it("★ 증류분만 고른다 — 실대화·작업내역 후보는 사람 몫이라 이 도구가 절대 만지지 않는다", () => {
    expect(고르기(목록).map((c) => c.id)).toEqual(["cl:d1", "cl:d2"]);
  });

  it("주제를 주면 그 주제만 — 밤새 돌린 주제만 승인하고 나머지는 손대지 않는다", () => {
    expect(고르기(목록, { topic: "취약점" }).map((c) => c.id)).toEqual(["cl:d1"]);
  });

  it("목록이 비거나 모양이 이상해도 빈 배열 — 승인 도구가 죽으면 밤 사슬이 멈춘다", () => {
    expect(고르기(undefined)).toEqual([]);
    expect(고르기([null, { source: "distill" }] as never)).toHaveLength(1);
  });
});

describe("결과 파일 자리 — 승인 근거가 남는 유일한 곳", () => {
  it("날짜는 **그 지역 달력**으로 센다 — 밤 작업이 UTC로 넘어가 어제 폴더에 떨어지면 사다리 표가 어긋난다", () => {
    // KST(UTC+9) 기준 2026-09-05 00:30 → 하루가 넘어간 뒤이므로 05일이어야 한다(UTC로 자르면 04일이 된다).
    const kst = 9 * 60;
    const 실제 = 오늘날짜(new Date("2026-09-04T15:30:00Z"));
    const 기대 = -new Date("2026-09-04T15:30:00Z").getTimezoneOffset() === kst ? "2026-09-05" : 실제;
    expect(실제).toBe(기대);
    expect(실제).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("도구 소스 계약 — results-ladder/<날>/approve-<시각>.json · 기본은 force 로그인 아님 · 증류분만", () => {
    const 도구 = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "approve-distill.mjs"), "utf8");
    expect(도구).toContain('path.join(repo, "tools", "team-bench", "results-ladder", DAY)');
    expect(도구).toMatch(/approve-\$\{시각\}\.json/);
    // 기본 force면 밤새 돌던 증류 세션을 승인 스크립트가 끊는다(계정당 1세션).
    expect(도구).not.toContain("force: true");
    expect(도구).toContain('force: has("--force-login")');
    // 승인 창구는 decide 하나뿐 — 일괄 승인(accept-strong)을 부르면 증류 제외 원칙을 우회하게 된다.
    expect(도구).toContain("/api/learnloop/candidates/decide");
    expect(도구).not.toContain("accept-strong");
    // 승인은 되돌리기 어렵다(👍 + 지식 반입) → dry-run과 상한이 반드시 있어야 한다.
    expect(도구).toContain('const DRY = has("--dry-run")');
    expect(도구).toMatch(/결과\.approved >= MAX/);
    // 창 모자람(실대화가 창을 채워 증류가 0건으로 보이는 함정)을 숫자로 드러낸다.
    expect(도구).toContain("Number(kpis.distill ?? 0) > 증류전체.length");
  });

  it("import만으로는 아무 일도 안 일어난다 — 시험이 서버를 부르거나 승인해 버리면 안 된다", () => {
    const 도구 = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "approve-distill.mjs"), "utf8");
    // 본체는 스크립트로 실행할 때만 돈다(argv[1] 검사). 이 시험 파일이 이미 그 증거지만, 구조를 못으로 박아 둔다.
    expect(도구).toContain('if (process.argv[1] && process.argv[1].endsWith("approve-distill.mjs"))');
    expect(도구).toMatch(/async function main\(\)/);
  });
});
