// 조치 SLA 준수율 — 표본 0에서 두 도구가 같은 문장을 쓰는가 (B6-②, 2026-09-11 설계관 지시서
// · 계획서 중-3 평가 게이트 · 전-6 정직).
//
// ■ 뿌리: kpi.ts:187 `slaCompliance = tasks.length ? … : 100` — 조치 항목이 0건이면 표본 없이
//   100%를 준다. runExecBrief(임원 세 줄)는 이 사실에 단서를 붙여 왔는데, 같은 스냅샷을 찍는
//   runKpiStatus(대화 KPI)에는 그 단서가 없었다(4100 실측: 「조치 SLA 준수율 100%(기한초과
//   0건 · 마감임박 0건)」 — 단서 없음). **같은 사실을 두 곳이 다르게 말한 것.**
// ■ 고친 것: 단서 문구를 tone.ts 준수율집계전단서() 한 곳으로 모아 두 도구가 같이 쓴다.
// ⚠ 파일 이름 — kpiratio.test.ts는 이미 「사내 지표율」(FORCED_INTENTS[83], kpi_status 라우팅)
//   시험이 그 이름을 쓰고 있어(2026-09-06 신설) **겹쳐 쓰지 않는다**. 이 시험은 별도 파일이다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runKpiStatus, runExecBrief } from "../src/engine/agenttools/handlers";
import { computeKpiSnapshot, resetKpiForTests } from "../src/engine/kpi";
import { resetAssetsForTests, seedSampleAssetsIfEmpty } from "../src/engine/assets";
import { resetTasksForTests, createTask } from "../src/engine/tasks";

const 단서 = "조치 항목이 0건이라 아직 집계 전입니다";

describe("★ 표본 0 — runKpiStatus·runExecBrief가 같은 단서 문장을 쓴다", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
  });

  it("조치 항목 0건 — 둘 다 「집계 전」 단서를 담는다", async () => {
    resetTasksForTests();
    const s = await computeKpiSnapshot();
    expect(s.remediation.tasks, "이 시험의 전제: 조치 항목이 0건이다").toBe(0);
    expect(s.remediation.slaCompliance, "kpi.ts는 표본 0건이면 100%를 준다 — 만점이 아니라 미집계다").toBe(100);

    const kpi = await runKpiStatus();
    const brief = await runExecBrief();
    expect(kpi, `runKpiStatus 실제 답:\n${kpi}`).toContain(단서);
    expect(brief, `runExecBrief 실제 답:\n${brief}`).toContain(단서);
  });

  it("표본 0에서도 runKpiStatus는 여전히 「조치 SLA 준수율」 라벨과 %를 담는다(ops-sim 기대 보호)", async () => {
    resetTasksForTests();
    const kpi = await runKpiStatus();
    expect(kpi).toMatch(/조치 SLA 준수율 100%/);
  });

  it("조치 항목이 있으면 — 둘 다 「집계 전」 단서를 안 붙인다(늘 붙으면 그것도 거짓말이다)", async () => {
    resetTasksForTests();
    createTask({ text: "[조치] 샘플 취약점 조치", priority: "P1", dueAt: Date.now() + 5 * 86400000, ref: "vuln:slaclue-test" });
    const s = await computeKpiSnapshot();
    expect(s.remediation.tasks, "이 시험의 전제: 조치 항목이 1건 이상이다").toBeGreaterThan(0);

    const kpi = await runKpiStatus();
    const brief = await runExecBrief();
    expect(kpi, `runKpiStatus 실제 답:\n${kpi}`).not.toContain(단서);
    expect(brief, `runExecBrief 실제 답:\n${brief}`).not.toContain(단서);
  });
});

describe("★ 단서 문구는 tone.ts 한 곳에서 온다 — handlers.ts는 베끼지 않는다", () => {
  it("handlers.ts에는 그 리터럴이 없다(헬퍼로 옮겨졌다) · tone.ts에는 정확히 1번 있다", () => {
    const handlersSrc = fs.readFileSync(
      path.join(__dirname, "..", "src", "engine", "agenttools", "handlers.ts"),
      "utf8",
    );
    const toneSrc = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "tone.ts"), "utf8");

    const literal = "조치 항목이 0건이라 아직 집계 전입니다";
    const handlersHits = handlersSrc.split(literal).length - 1;
    const toneHits = toneSrc.split(literal).length - 1;

    expect(handlersHits, "handlers.ts에 문구가 그대로 남아 있다 — 헬퍼(준수율집계전단서)로 옮겨야 한다").toBe(0);
    expect(toneHits, "tone.ts에 문구가 정확히 1번 있어야 세 번째 소비자(report.ts)도 베끼지 않고 이 함수를 쓴다").toBe(1);

    // 두 도구가 헬퍼를 실제로 부르는지도 소스 감시로 못 박는다(만들어 두고 안 부르는 함정).
    expect(handlersSrc, "runKpiStatus가 준수율집계전단서를 안 부른다").toContain("준수율집계전단서(s.remediation.tasks)");
  });
});
