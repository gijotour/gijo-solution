// exec_brief(임원 보고용 세 줄 요약) — 도구 자체 계약. B4 수리(2026-09-11, 평가 게이트
// kr-report-tone 23/24 · 계획서 중-3 평가 게이트 · 전-6 정직).
//
// ■ 무엇을 지키나
//   숫자 잣대는 computeKpiSnapshot() **한 곳**이고, 이 도구는 그 필드를 그대로 인용해
//   코드가 한글 세 줄을 만든다. 모델이 숫자를 다시 쓰지 않는다(directAnswer) — 가짜 요약
//   위험을 원리상 막는 것이 이 시험들의 뜻이다.
import { describe, it, expect, beforeEach } from "vitest";
import { findAgentTool } from "../src/engine/agenttools";
import { computeKpiSnapshot, resetKpiForTests } from "../src/engine/kpi";
import { resetAssetsForTests, seedSampleAssetsIfEmpty } from "../src/engine/assets";
import { hangulRatio } from "../src/engine/llm";

const run = () => Promise.resolve(findAgentTool("exec_brief")!.run({})).then(String);

// 평가 게이트 forbid와 같은 정규식(tools/evalgate/cases/korean.json kr-report-tone) — 게이트
// 기준 자체는 손대지 않고, 여기서는 **같은 잣대로** 우리 도구를 미리 잰다.
const 영어연속_RE = /[A-Za-z][A-Za-z0-9 ,'-]{55,}/;
// tools/drawer-audit.mjs FAIL_MARKS — 폴백 문구 목록. 정직한 답이 이 낱말을 쓰면 서랍 점검이
// 실패로 센다(citeguard.ts FAIL_MARKS-안전 관례와 같은 규율).
const FAIL_MARKS = [
  "구체적으로 질문", "명확히 알려주시면", "맥락을 더 알려", "정보를 제공해 주시면",
  "이해하지 못", "알 수 없습니다", "지원하지 않", "할 수 없습니다", "죄송",
  "그런 자산이 없", "찾지 못했습니다", "등록된 자산이 없", "해당하는 자산이 없",
  "실행 실패", "오류가 발생",
];

describe("★ exec_brief는 즉답이고 본문이 정확히 세 줄이다", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
  });

  it("registry에 directAnswer:true로 등록돼 있다 — 모델이 다시 쓰지 않는다", () => {
    expect(findAgentTool("exec_brief")?.directAnswer, "재작성 경로로 가면 가짜 숫자 위험이 열린다").toBe(true);
  });

  it("write:false·params:[]다 — 결재판 없이 즉시 조회다", () => {
    const t = findAgentTool("exec_brief")!;
    expect(t.write).toBe(false);
    expect(t.params).toEqual([]);
  });

  it("본문이 정확히 세 줄이다(예시데이터머리말 줄은 떼고 센다)", async () => {
    const out = await run();
    const 본문 = out.replace(/^⚠[^\n]*\n/, "");
    const 줄 = 본문.split("\n").filter(Boolean);
    expect(줄.length, `실제 본문:\n${out}`).toBe(3);
  });

  it("다음걸음()을 안 붙인다 — 그 함수는 자리가 네 곳뿐인 계약이다(agenttools-cross.test.ts)", async () => {
    const out = await run();
    // 다음걸음(handlers.ts)의 출력 표지는 "▸ 다음: " 고정이다 — 이게 있으면 자리가 다섯이 된다.
    expect(out).not.toContain("▸ 다음:");
  });
});

describe("★ 세 줄의 숫자는 KPI 스냅샷을 그대로 인용한다 — 두 번 세지 않는다", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
  });

  it("posture.score·assets·vulnerabilities·remediation 필드가 답에 그대로 들어 있다", async () => {
    const s = await computeKpiSnapshot();
    const out = await run();
    // 잣대가 갈리면(별도로 다시 계산하면) 아래 중 하나가 숫자가 달라 실패한다.
    expect(out).toContain(`${s.posture.score}점`);
    expect(out).toContain(`자산 ${s.assets.total}대`);
    expect(out).toContain(`고위험 ${s.assets.highRisk}대`);
    expect(out).toContain(`취약점 ${s.vulnerabilities.active}건`);
    expect(out).toContain(`${s.vulnerabilities.critical}건`);
    expect(out).toContain(`KEV) ${s.vulnerabilities.kev}건`);
    expect(out).toContain(`기한 초과 ${s.remediation.overdue}건`);
    expect(out).toContain(`마감 임박 ${s.remediation.dueSoon}건`);
    expect(out).toContain(`기한 준수율 ${s.remediation.slaCompliance}%`);
    // 기준일 — 「이번 주」로 물어도 오늘 기준 스냅샷이라는 것을 답이 스스로 밝힌다.
    expect(out).toContain(`${s.date} 기준`);
  });

  it("심각도 낱말은 tone.ts 심각도한글() 한 곳만 쓴다 — 영어 이름을 새로 안 짓는다", async () => {
    const out = await run();
    expect(out).toContain("매우 심각"); // 심각도한글("critical")
    // finding_type·CVE 등 스캐너 원문 영어를 나열하지 않는다(briefing과 다른 도구라는 계약).
    expect(out).not.toMatch(/CVE-\d{4}-\d{4,}/);
  });
});

describe("★ 평가 게이트와 같은 잣대로 재도 초록이다 — 한글 비율·영어 연속", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
  });

  it("한글 비율 ≥ 0.5(kr-report-tone hangulMin)", async () => {
    const out = await run();
    expect(hangulRatio(out)).toBeGreaterThanOrEqual(0.5);
  });

  it("영어가 55자 넘게 안 이어진다(kr-report-tone forbid)", async () => {
    const out = await run();
    expect(영어연속_RE.test(out), out).toBe(false);
  });

  it("kr-report-tone expect(취약점|자산|점검|조치|현황) 중 하나 이상을 담는다", async () => {
    const out = await run();
    expect(out).toMatch(/취약점|자산|점검|조치|현황/);
  });
});

describe("★ 데이터가 0일 때 「안전하다」로 안 읽힌다 (고객 QA 4100 빈 서버)", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests(); // ⚠ seedSampleAssetsIfEmpty()를 안 불러 진짜 0-자산 상태를 만든다.
  });

  it("0건을 안전으로 읽히게 하지 않고, 다음 행동(등록하면)을 말한다", async () => {
    const s = await computeKpiSnapshot();
    expect(s.assets.total, "이 시험은 0-자산 전제다").toBe(0);
    const out = await run();
    expect(out, `실제 답:\n${out}`).toMatch(/아직|등록하/);
    expect(out).not.toMatch(/없습니다\s*$/); // "없습니다"로 끝내지 않는다(emptyanswer-guidance 규율)
  });

  it("FAIL_MARKS(tools/drawer-audit.mjs 폴백 문구)를 하나도 안 쓴다", async () => {
    const out = await run();
    const 걸린것 = FAIL_MARKS.find((m) => out.includes(m));
    expect(걸린것, `정직한 0건 답이 폴백 문구와 겹쳤다: "${걸린것}"`).toBeUndefined();
  });
});

describe("★ 「오늘 브리핑」 원문 경로는 그대로다 — 두 도구가 다른 것을 답한다", () => {
  it("briefing은 여전히 directAnswer다(overnight-routing.test.ts와 같은 계약)", () => {
    expect(findAgentTool("briefing")?.directAnswer, "재작성 경로로 가면 신규·기한 줄이 사라진다").toBe(true);
  });

  it("exec_brief와 briefing은 서로 다른 도구다 — 이름·본문이 겹치지 않는다", () => {
    expect(findAgentTool("exec_brief")).not.toBe(findAgentTool("briefing"));
    expect(findAgentTool("exec_brief")!.name).not.toBe(findAgentTool("briefing")!.name);
  });

  it("exec_brief 결과에는 briefing이 내는 영어 취약점 나열(finding_type)이 없다", async () => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
    const out = await run();
    // briefing.ts의 원문 나열 표지("- 오늘의 조치 상위", "@", "/") — exec_brief는 이 형식을 안 쓴다.
    expect(out).not.toContain("오늘의 조치 상위");
    expect(out).not.toContain("지난 브리핑 이후 신규");
  });
});
