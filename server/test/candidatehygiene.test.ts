// 후보함에 **못 쓸 것이 담기지 않는가**.
//
// 실측(2026-08-09): 후보함 대기 4건이 전부 학습 재료가 못 되는 것이었다 —
//   "오늘 할 일" · "이번 주 보안 현황을 요약해줘" · "기한 지난 일 보여줘"(셋 다 그날의 숫자)
//   + CrowdStrike 위협보고서 본문이 통째로 들어온 것.
// 데이터셋을 만들 때는 걸러졌지만 **후보함에는 그대로 쌓여** 있었다. 담당자는 그걸 한 건씩
// 들여다보며 시간을 쓰고, 주제별 진척(300건)도 가짜로 부푼다. 담기 전에 막는다.
import { describe, it, expect } from "vitest";
import { 학습재료가못되나 } from "../src/engine/datasethygiene";

describe("학습 재료 사전 판별", () => {
  it("그날의 숫자는 재료가 아니다 — 배우면 낡은 사실을 외운다", () => {
    expect(학습재료가못되나("오늘 할 일", "남은 일 3건 — 기한 지남 2건 · 미검토 5건 · 완료 1건")).toContain("시점");
    expect(학습재료가못되나("기한 지난 일 보여줘", "2026-08-09 기준 다음과 같습니다: Log4Shell …")).toContain("시점");
  });

  it("문서 본문이 통째로 들어온 것은 문답이 아니다", () => {
    const 질문 = "글로벌 위협 보고서에 따르면 2026년 가장 많은 공격을 한 것은 회피형 공격자였습니다.";
    const 답 = "가".repeat(1500);
    expect(학습재료가못되나(질문, 답)).toContain("문서 본문");
  });

  it("멀쩡한 문답은 통과시킨다 — 규칙이 넓으면 가르칠 것까지 사라진다", () => {
    expect(학습재료가못되나("Log4Shell이 뭐야?", "Apache Log4j의 원격코드실행 취약점으로, 로그 문자열에 담긴 JNDI 조회를 통해 임의 코드가 실행됩니다. 사내 지침은 2.15.0 이상으로 올리는 것입니다.")).toBeNull();
    expect(학습재료가못되나("방화벽 정책은 누가 승인해?", "변경 전 담당자 승인을 받고, 적용 후 24시간 트래픽을 모니터링합니다. 문제가 생기면 즉시 이전 정책으로 롤백합니다.")).toBeNull();
  });

  it("긴 답이라도 물음에 답한 것이면 남긴다", () => {
    const 답 = "네, 있습니다. " + "자세한 절차는 다음과 같습니다. ".repeat(60);
    expect(학습재료가못되나("방화벽 점검 절차 알려줘", 답)).toBeNull();
  });
});

describe("후보 수집이 이 판별을 실제로 부른다", () => {
  it("learncandidates의 제외 규칙이 위생 모듈을 쓴다 — 두 곳에 적으면 어긋난다", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/engine/learncandidates.ts", import.meta.url), "utf8");
    expect(src).toContain("학습재료가못되나(question, answer)");
    expect(src).toMatch(/import \{ 학습재료가못되나 \} from ".\/datasethygiene"/);
  });
});
