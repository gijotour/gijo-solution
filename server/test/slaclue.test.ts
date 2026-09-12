// 조치 SLA 준수율 — 표본 0에서 두 도구가 같은 문장을 쓰는가 (B6-②, 2026-09-11 설계관 지시서
// · 계획서 중-3 평가 게이트 · 전-6 정직).
//
// ■ 뿌리: `slaCompliance = tasks.length ? … : 100` — 조치 항목이 0건이면 표본 없이 100%를
//   준다. ⚠ 그 산식은 2026-09-12부터 **sla.ts remediationSla() 한 곳**이다(그전엔 kpi.ts:187에
//   있었고 이 주석도 그 줄을 가리켰다 — 옮겼으니 줄 번호를 지운다).
//   runExecBrief(임원 세 줄)는 이 사실에 단서를 붙여 왔는데, 같은 스냅샷을 찍는
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
import { collectVulnReportData } from "../src/engine/report";

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

// ★★★ 2026-09-11 검토관 [중] — **단서가 대화 도구 둘에만 붙었다.**
//   report.ts는 같은 스냅샷을 Word 문단·임원 요약 LLM 프롬프트·HTML 세 곳에 찍는데 전부
//   단서 없는 「SLA 준수율 100%」였다. 게다가 산식 주석이 표본 0에서
//   「÷ (전체 조치대상 0건) × 100」이라는 **말이 안 되는 문장**으로 나갔다.
//   B6-②의 목표가 「같은 사실을 한 문장으로」인데, 대화는 「집계 전」·보고서는 「100%」로
//   말하면 이중 기재가 줄지 않고 갈래만 는 것이다(handlers.ts 주석이 경고한 바로 그 장면 —
//   파일럿 첫날 임원에게 100%가 나간다).
describe("★ 세 번째 소비자(report.ts) — 보고서도 같은 단서를 쓴다", () => {
  const 소스 = (...조각: string[]) =>
    fs.readFileSync(path.join(__dirname, "..", "src", "engine", ...조각), "utf8");

  it("report.ts가 준수율을 찍는 세 자리에서 모두 헬퍼를 부른다(베낀 문구 0)", () => {
    const src = 소스("report.ts");
    const 호출수 = src.split("준수율집계전단서(vuln.remediation.tasks)").length - 1;
    expect(호출수, "Word 문단·임원 요약 프롬프트·HTML 셋 다 붙어야 한다 — 하나라도 빠지면 그 경로만 100%를 말한다").toBe(3);
    expect(src.includes("조치 항목이 0건이라 아직 집계 전입니다"), "report.ts가 문구를 베꼈다 — tone.ts 헬퍼를 쓸 것").toBe(false);
  });

  it("표본 0에서 산식 주석이 「÷ 0건 × 100」으로 안 나간다", () => {
    const src = 소스("report.ts");
    // 두 자리(Word·HTML) 모두 조치대상 0건이면 산식 대신 미집계라고 밝힌다.
    const 갈래수 = src.split("vuln.remediation.tasks === 0").length - 1;
    expect(갈래수, "Word·HTML 산식 주석 두 곳 모두 표본 0 갈래를 가져야 한다").toBe(2);
  });

  // ★ 2026-09-12 — 산식은 이제 **sla.ts(잎 모듈) 한 곳**이다. 전엔 kpi.ts·report.ts 두 곳에
  //   글자까지 같게 있었고 이 자리에 「합칠 수 없다 — kpi.ts가 report.ts를 import하므로 반대
  //   방향은 순환」이라고 적혀 있었는데, **잎 모듈로 피할 수 있었다**(sla.ts 의존 0줄 —
  //   server/test/sla.test.ts가 못 박는다). 그 낡은 문장을 그대로 두면 다음 사람이 「못 합친다」를
  //   사실로 받아들여 산식을 또 베낀다.
  // ★ 그래도 이 짝 감시는 남긴다 — 두 소비자가 **같은 값을 내는지 제품 함수로 재는** 안전망이다
  //   (글자 대조가 아니다). 한쪽이 다시 자기 산식을 쓰기 시작하면 여기가 운다.
  it("★ 짝 감시 — 같은 데이터에서 kpi.ts와 report.ts의 준수율이 같은 값이다", async () => {
    resetTasksForTests();
    // 표본 0
    expect((await computeKpiSnapshot()).remediation.slaCompliance).toBe(
      collectVulnReportData().remediation.slaCompliance,
    );
    // 표본 있음(기한 넘긴 것 1 + 기한 전 1 → 50%)
    createTask({ text: "[조치] 기한 지난 것", priority: "P1", dueAt: Date.now() - 86400000, ref: "vuln:slaclue-late" });
    createTask({ text: "[조치] 아직 여유", priority: "P2", dueAt: Date.now() + 5 * 86400000, ref: "vuln:slaclue-ok" });
    const k = (await computeKpiSnapshot()).remediation;
    const r = collectVulnReportData().remediation;
    expect(r.tasks, "조치 항목 수부터 같아야 같은 산식이라 할 수 있다").toBe(k.tasks);
    expect(r.slaCompliance, "kpi.ts와 report.ts가 같은 날 다른 준수율을 말한다 — 산식이 어긋났다").toBe(k.slaCompliance);
  });
});
