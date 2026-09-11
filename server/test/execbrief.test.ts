// exec_brief(임원 보고용 세 줄 요약) — 도구 자체 계약. B4 수리(2026-09-11, 평가 게이트
// kr-report-tone 23/24 · 계획서 중-3 평가 게이트 · 전-6 정직).
//
// ■ 무엇을 지키나
//   숫자 잣대는 computeKpiSnapshot() **한 곳**이고, 이 도구는 그 필드를 그대로 인용해
//   코드가 한글 세 줄을 만든다. 모델이 숫자를 다시 쓰지 않는다(directAnswer) — 가짜 요약
//   위험을 원리상 막는 것이 이 시험들의 뜻이다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findAgentTool } from "../src/engine/agenttools";
import { computeKpiSnapshot, resetKpiForTests } from "../src/engine/kpi";
import { resetAssetsForTests, seedSampleAssetsIfEmpty, seedSampleVulnHostIfEmpty } from "../src/engine/assets";
import { resetTasksForTests } from "../src/engine/tasks";
import { hangulRatio } from "../src/engine/llm";

const run = () => Promise.resolve(findAgentTool("exec_brief")!.run({})).then(String);

// ★ 잣대를 여기 베껴 적지 않는다 — **원본 파일에서 읽는다**(2026-09-11 검토관 [하] 수리).
//   첫 판은 게이트 forbid 정규식과 FAIL_MARKS 15개를 손으로 복사했다. 지금 값은 맞았지만
//   원본이 늘면 이 시험만 **옛 목록으로 초록**이 되고(FAIL_MARKS는 2026-08-14·09-05에 실제로
//   늘었다) 서랍 점검만 빨개진다 — 어느 쪽이 옳은지 사람이 못 읽는다.
//   저장소 관례가 그 답이다: emptyanswer-guidance.test.ts가 drawer-audit.mjs를 읽어 대조하고
//   helpers/routing.ts가 agentloop.ts 원문을 읽어 판정한다(「같은 것을 여러 곳에 적으면 어긋난다」).
const 뿌리 = path.join(__dirname, "..", "..");
// 평가 게이트 문항 그대로 — 게이트 기준을 손대지 않고 **같은 잣대로** 우리 도구를 미리 잰다.
const 게이트문항 = (() => {
  const cases = JSON.parse(fs.readFileSync(path.join(뿌리, "tools", "evalgate", "cases", "korean.json"), "utf8")) as {
    cases: { id: string; q: string; expect?: string[]; forbid?: string[]; hangulMin?: number }[];
  };
  const c = cases.cases.find((x) => x.id === "kr-report-tone");
  if (!c) throw new Error("kr-report-tone 문항이 korean.json에 없다 — 이 시험이 낡았다(문항이 바뀌었나)");
  return c;
})();
const 영어연속_RE = new RegExp(게이트문항.forbid![0]);
// tools/drawer-audit.mjs FAIL_MARKS — 폴백 문구 목록. 정직한 답이 이 낱말을 쓰면 서랍 점검이
// 실패로 센다(citeguard.ts FAIL_MARKS-안전 관례와 같은 규율).
const FAIL_MARKS = (() => {
  const 소스 = fs.readFileSync(path.join(뿌리, "tools", "drawer-audit.mjs"), "utf8");
  const m = 소스.match(/const FAIL_MARKS = \[([\s\S]*?)\];/);
  if (!m) throw new Error("drawer-audit.mjs에서 FAIL_MARKS를 못 읽었다 — 목록이 옮겨 갔나");
  const 목록 = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (목록.length === 0) throw new Error("FAIL_MARKS가 0개로 읽혔다 — 0개면 이 시험은 늘 초록이다");
  return 목록;
})();

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

  it("한글 비율 ≥ kr-report-tone hangulMin(게이트 문항에서 읽어 온 값)", async () => {
    const out = await run();
    expect(hangulRatio(out)).toBeGreaterThanOrEqual(게이트문항.hangulMin!);
  });

  it("영어가 55자 넘게 안 이어진다(kr-report-tone forbid)", async () => {
    const out = await run();
    expect(영어연속_RE.test(out), out).toBe(false);
  });

  it("kr-report-tone expect 정규식(게이트 문항에서 읽어 온 값)을 담는다", async () => {
    const out = await run();
    expect(out).toMatch(new RegExp(게이트문항.expect![0]));
  });
});

describe("★ 「이번 주」로 물어도 오늘 스냅샷이라는 것을 답이 스스로 밝힌다", () => {
  // 2026-09-11 검토관 [하] — 날짜만 찍으면 「이번 주 집계의 산출일」로 읽힌다(주간이 아니라는
  // 정보가 답 어디에도 없었다). 게이트 문항 자체가 「이번 주」를 물으므로 그 물음을 그대로 쓴다.
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
  });

  it("게이트 문항이 여전히 「이번 주」를 묻는다 — 이 계약의 전제다", () => {
    expect(게이트문항.q).toContain("이번 주");
  });

  it("줄①이 「주간 집계가 아니라 오늘 시점」이라고 못 박는다", async () => {
    const s = await computeKpiSnapshot();
    const out = await run();
    expect(out, `실제 답:\n${out}`).toContain(`${s.date} 기준 · 주간 집계가 아니라 오늘 시점입니다`);
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

describe("★★ 자산은 있는데 **세어 본 적이 없어서** 0인 경우 — 「안전」으로 안 읽힌다", () => {
  // 2026-09-11 검토관 [중] 수리. 첫 판의 0건 가드는 `assets.total === 0` 하나뿐이라 반쪽이었다.
  //   파일럿 첫날(자산 등록은 했고 스캐너 연동 전)이 정확히 이 상태다 — kpi.ts는 취약점을
  //   **infra-host 자산의 스캔 결과**에서만 세므로 AI 자산만 있으면 active·critical·kev·scanFailed가
  //   전부 0이고, 조치 항목이 0건이면 slaCompliance가 표본 없이 100%다. 그대로 세 줄이 나가면
  //   임원은 「태세 N점 · 문제 0건 · 준수율 100%」를 **문제가 없다**로 읽는다.
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty(); // 샘플 자산은 전부 AI 자산이다 — infra-host가 없다(= 스캔 기록 0)
    // ⚠ 조치 항목도 비운다 — 안 비우면 다른 시험이 남긴 vuln: 태스크가 섞여 준수율이 67%로
    //   나온다(실측 2026-09-11). 그러면 「표본 0인데 100%」라는 이 시험의 전제가 성립하지 않는다.
    resetTasksForTests();
  });

  it("이 시험의 전제: 자산은 있고 점검 대상 호스트·조치 항목은 0이다", async () => {
    const s = await computeKpiSnapshot();
    expect(s.assets.total, "자산이 0이면 0-자산 갈래가 답해 이 시험의 뜻이 없다").toBeGreaterThan(0);
    expect(s.vulnerabilities.hosts).toBe(0);
    expect(s.remediation.tasks).toBe(0);
    // ⚠ 이 둘이 그대로 나가면 안 되는 값 — 왜 단서가 필요한지 숫자로 남긴다.
    expect(s.vulnerabilities.active).toBe(0);
    expect(s.remediation.slaCompliance, "kpi.ts는 표본이 0건이면 100%를 준다 — 만점이 아니라 미집계다").toBe(100);
  });

  it("줄②가 「0 = 안전」이 아님을 말한다", async () => {
    const out = await run();
    expect(out, `실제 답:\n${out}`).toContain("안전하다는 뜻이 아닙니다");
  });

  it("줄③이 기한 준수율 100%를 표본 없는 값이라고 밝힌다", async () => {
    const out = await run();
    expect(out, `실제 답:\n${out}`).toContain("조치 항목이 0건이라 아직 집계 전입니다");
  });

  it("줄 수는 그대로 세 줄이다 — 단서를 붙여도 임원용 세 줄 계약을 안 깬다", async () => {
    const out = await run();
    const 줄 = out.replace(/^⚠[^\n]*\n/, "").split("\n").filter(Boolean);
    expect(줄.length, `실제 답:\n${out}`).toBe(3);
  });

  it("FAIL_MARKS와 안 겹친다 — 정직한 단서에 실패 딱지가 붙으면 안 된다", async () => {
    const out = await run();
    const 걸린것 = FAIL_MARKS.find((m) => out.includes(m));
    expect(걸린것, `단서가 폴백 문구와 겹쳤다: "${걸린것}"`).toBeUndefined();
  });
});

describe("★ 반대로 **세어 봤는데** 0이 아닌 경우엔 그 단서를 안 붙인다(늘 붙는 장식이 아니다)", () => {
  beforeEach(() => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
    seedSampleVulnHostIfEmpty(); // 샘플 호스트 1대 + 스캔 결과 4건
  });

  it("스캔 결과가 있으면 「점검 결과가 아직 없어」 단서가 안 붙는다", async () => {
    const s = await computeKpiSnapshot();
    expect(s.vulnerabilities.hosts, "샘플 호스트가 안 심겼다 — 이 시험의 전제가 깨졌다").toBeGreaterThan(0);
    expect(s.vulnerabilities.active + s.vulnerabilities.newlyFixed + s.vulnerabilities.scanFailed).toBeGreaterThan(0);
    const out = await run();
    expect(out, `실제 답:\n${out}`).not.toContain("안전하다는 뜻이 아닙니다");
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
