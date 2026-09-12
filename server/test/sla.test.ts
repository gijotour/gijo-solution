// engine/sla.ts — 조치 SLA 판정 단일 출처가 실제로 하나인가 (2026-09-12 설계관 지시서 ·
// 검토관 발견 항목 「report.ts SLA 산식 중복(순환)」 · 계획서 §13 B6 이관 · 계획서 중-3 평가
// 게이트 · 전-6 정직).
//
// ■ 뿌리: kpi.ts remediationMetrics()와 report.ts collectVulnReportData()에 「조치대상(vuln:
//   티켓) 걸러내기 → 기한초과/준수 집계 → 준수율」 산식이 글자까지 같게 두 벌 있었다. kpi.ts가
//   report.ts를 import하므로(kpi.ts:15 maintenanceSummary) 반대 방향은 순환이라 합치지
//   못했다. sla.ts를 **잎 모듈(import 0줄)**로 새로 만들어 둘 다 이것 하나만 부르게 했다.
// ■ 사각지대: 기존 slaclue.test.ts의 짝 감시는 완료(done)했거나 기한이 없는(dueAt==null)
//   조치 항목을 표본에 넣지 않았다 — 두 항이 값을 안 바꿔도 시험이 계속 초록이었다. 이 파일의
//   ㄴ)이 그 사각지대를 메운다.
// ■ 이미 난 실결함: report.ts의 산식 설명 문장(Word·HTML)이 「(기한 내 조치 완료 건) ÷ …」
//   이라 적혀 있었는데 코드는 미완료·기한 없음도 준수로 센다 — 임원 보고서에 모순된 근거가
//   나갔다(완료 0건인데 준수율 67%). 메인 결정(2026-09-12)으로 「(전체 − 기한초과) ÷ 전체 ×
//   100」 표현으로 통일했다. 이 파일의 ㄷ)·ㄹ)이 문장 단일 출처·문장-코드 일치를 못 박는다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 조치대상인가, 기한초과인가, 준수건인가, remediationSla, SLA산식설명 } from "../src/engine/sla";
import { computeKpiSnapshot, resetKpiForTests } from "../src/engine/kpi";
import { resetAssetsForTests, seedSampleAssetsIfEmpty } from "../src/engine/assets";
import { resetTasksForTests, createTask } from "../src/engine/tasks";
import { collectVulnReportData } from "../src/engine/report";

const ENGINE = path.join(__dirname, "..", "src", "engine");
const 소스 = (...조각: string[]) => fs.readFileSync(path.join(ENGINE, ...조각), "utf8");

describe("sla.ts — 잎 모듈 계약(import 0줄)", () => {
  it("sla.ts는 어떤 것도 import하지 않는다 — tasks.ts를 부르면 express·auth·db가 딸려 와 잎이 깨진다", () => {
    const src = 소스("sla.ts");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(
      importLines,
      "sla.ts에 import가 생겼다 — kpi.ts·report.ts 양쪽에서 순환 없이 쓰려면 잎(import 0줄)이어야 한다:\n  " +
        importLines.join("\n  "),
    ).toEqual([]);
  });
});

describe("★ 소스 감시 — 조치 SLA 산식을 sla.ts 밖에서 다시 세는 자리가 없는가", () => {
  /**
   * 걸러도 되는 자리 — **이유를 반드시 적는다.** (findingcount.test.ts 형식)
   * 이유 없이 이름만 추가하는 것은 시험을 끄는 것과 같다.
   */
  const 예외: Record<string, string> = {
    "sla.ts": "판정 함수(조치대상인가·기한초과인가·준수건인가·remediationSla)가 사는 원본 — 여기가 잣대다",
    "tasks.ts": "listTasks().some((t) => (t.ref ?? \"\").startsWith(\"vuln:\"))은 SLA 지표를 세는 것이 아니라 " +
      "시드 가드(seedSampleRemediationTasksIfEmpty)다 — 조치 항목이 하나라도 있으면 시드를 건너뛰는 존재 " +
      "여부 확인이라 준수율·기한초과 집계와 무관하다",
    "alertschedule.ts": "listTasks().filter(... dueAt <= soon)·due.filter(... dueAt < now)은 SLA 준수율이 " +
      "아닌 시스템 알림(sla_due 종류)이 쓰는 모집단이다 — vuln: 접두사로 거르지 않고 **전체 조치 항목** " +
      "중 마감 임박·초과를 알리는 것이라 모집단 자체가 remediationSla와 다르다(합치면 알림 대상이 준다)",
  };

  function ts파일들(): string[] {
    const out: string[] = [];
    const 걷기 = (rel: string) => {
      for (const e of fs.readdirSync(path.join(ENGINE, rel), { withFileTypes: true })) {
        if (e.name.startsWith("__")) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) 걷기(r);
        else if (e.name.endsWith(".ts")) out.push(r);
      }
    };
    걷기("");
    return out;
  }

  /** 조치대상(vuln: 접두사) 모집단을 다시 거르는 줄인가 — 집계 맥락(filter/some/length 등)에서만. */
  function 조치대상집계줄인가(l: string): boolean {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (!/\.startsWith\(["']vuln:["']\)/.test(l)) return false;
    return /\.filter\(|\.some\(|\.reduce\(|\.length|\.map\(|for\s*\(/.test(l);
  }

  /** dueAt을 now/soon과 견줘 기한초과·준수를 집계하는 줄인가(집계 맥락에서만). */
  function SLA집계줄인가(l: string): boolean {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (!/\.dueAt\b/.test(l)) return false;
    if (!/\b(now|soon)\b/.test(l)) return false;
    if (!/[<>]=?/.test(l)) return false;
    return /\.filter\(|\.some\(|\.reduce\(|\.length|\.map\(|for\s*\(/.test(l);
  }

  it("조치대상 모집단·기한초과/준수 집계를 sla.ts 밖에서 다시 짜는 자리가 없다", () => {
    const 걸린것: string[] = [];
    for (const f of ts파일들()) {
      if (예외[f]) continue;
      const src = 소스(f);
      const 걸린줄 = src.split("\n").filter((l) => 조치대상집계줄인가(l) || SLA집계줄인가(l));
      if (!걸린줄.length) continue;
      걸린것.push(`${f} — ${걸린줄.length}곳:\n      ${걸린줄.map((l) => l.trim().slice(0, 100)).join("\n      ")}`);
    }
    expect(
      걸린것,
      "SLA 산식이 sla.ts 밖에서 다시 만들어졌다 — 판정 함수(조치대상인가·기한초과인가·준수건인가·remediationSla)를 " +
        "부르거나, 이 자리가 정말 다른 모집단이면 예외에 이유를 적을 것:\n\n  " + 걸린것.join("\n  "),
    ).toEqual([]);
  });

  it("예외에는 전부 이유가 적혀 있다", () => {
    const 부실 = Object.entries(예외).filter(([, 이유]) => 이유.trim().length < 20).map(([f]) => f);
    expect(부실, "예외에 이유가 없거나 너무 짧다").toEqual([]);
  });

  it("예외에 적힌 파일이 실제로 있다 — 낡은 예외가 시험을 헐겁게 만든다", () => {
    const 없는것 = Object.keys(예외).filter((f) => f !== "sla.ts" && !fs.existsSync(path.join(ENGINE, f)));
    expect(없는것, "없는 파일이 예외에 남아 있다").toEqual([]);
  });

  it("이 감시가 헛돌고 있지 않다 — 최소 두 자리(원본 sla.ts + 예외 1개 이상)는 실제로 걸린다", () => {
    let 걸린파일수 = 0;
    for (const f of ts파일들()) {
      const src = 소스(f);
      if (src.split("\n").some((l) => 조치대상집계줄인가(l) || SLA집계줄인가(l))) 걸린파일수++;
    }
    expect(걸린파일수, "SLA 형태의 줄을 하나도 못 찾았다 — 감시가 헛돈다").toBeGreaterThanOrEqual(2);
  });
});

describe("★ 짝 감시 사각지대 메움 — kpi.ts와 report.ts가 done·dueAt==null 항에서도 같은 값을 낸다", () => {
  // 기존 slaclue.test.ts:107-120은 「기한 지난 미완료」·「기한 전 미완료」만 표본에 넣어
  // t.done·t.dueAt==null 두 항이 한쪽에서만 바뀌어도 안 걸렸다(설계관 지시서 root_cause ②).
  it("완료했는데 기한이 지난 건 + 기한 없는 건 + 완료·기한없음 셋을 섞어도 kpi·report가 같다", async () => {
    resetKpiForTests();
    resetAssetsForTests();
    seedSampleAssetsIfEmpty();
    resetTasksForTests();

    createTask({ text: "[조치] 완료·기한지남", priority: "P1", dueAt: Date.now() - 86400000, ref: "vuln:sla-done-late" });
    // 완료 표시(생성 시점엔 done을 못 주므로 방금 만든 걸 완료 처리)
    const { setTaskDone, listTasks } = await import("../src/engine/tasks");
    const 완료지남 = listTasks().find((t) => t.ref === "vuln:sla-done-late")!;
    setTaskDone(완료지남.id, true);

    createTask({ text: "[조치] 기한없음", priority: "P2", ref: "vuln:sla-no-due" });
    createTask({ text: "[조치] 완료·기한없음", priority: "P3", ref: "vuln:sla-done-nodue" });
    const 완료기한없음 = listTasks().find((t) => t.ref === "vuln:sla-done-nodue")!;
    setTaskDone(완료기한없음.id, true);

    const k = (await computeKpiSnapshot()).remediation;
    const r = collectVulnReportData().remediation;
    expect(r.tasks, "조치 항목 수부터 같아야 한다").toBe(k.tasks);
    expect(r.tasks, "이 시험의 전제 — 표본 3건").toBe(3);
    expect(r.done, "완료 건수 — 2건(완료·기한지남 + 완료·기한없음)").toBe(2);
    expect(r.done).toBe(k.done);
    expect(r.overdue, "완료된 건은 기한이 지났어도 기한초과로 안 센다 — 0건").toBe(0);
    expect(r.overdue).toBe(k.overdue);
    // 준수 = 완료(2) + 기한없음&미완료(1) = 3/3 = 100%
    expect(r.slaCompliance, "완료했거나 기한이 없으면 전부 준수 — 100%").toBe(100);
    expect(r.slaCompliance).toBe(k.slaCompliance);
  });
});

describe("★ 산식 설명 문장 — report.ts는 단일 출처(SLA산식설명)만 쓴다", () => {
  it("report.ts 소스에 「기한 내 조치 완료」 리터럴이 없다(옛 문장은 코드와 달랐다)", () => {
    const src = 소스("report.ts");
    expect(src.includes("기한 내 조치 완료"), "옛 산식 설명 문장이 남아 있다 — SLA산식설명()으로 옮겨야 한다").toBe(false);
  });

  it("report.ts가 SLA산식설명을 정확히 2번 부른다(Word·HTML)", () => {
    const src = 소스("report.ts");
    const 호출수 = src.split("SLA산식설명(vuln.remediation.tasks, vuln.remediation.overdue)").length - 1;
    expect(호출수, "Word 문단·HTML 두 자리 모두 헬퍼를 불러야 한다 — 하나라도 직접 문장을 지으면 다시 두 벌이 된다").toBe(2);
  });

  it("표본 0에서 산식 주석이 「÷ 0건 × 100」으로 안 나간다(기존 갈래 보존)", () => {
    const src = 소스("report.ts");
    const 갈래수 = src.split("vuln.remediation.tasks === 0").length - 1;
    expect(갈래수, "Word·HTML 산식 주석 두 곳 모두 표본 0 갈래를 가져야 한다").toBe(2);
  });
});

describe("★ 문장-코드 일치 — SLA산식설명이 말하는 분자·분모가 실제 slaCompliance와 같은 값을 낸다", () => {
  it("설명 문장에서 숫자를 뽑아 다시 계산해도 remediationSla의 값과 같다(값 대조, 글자 대조 아님)", () => {
    const now = Date.now();
    const tasks = [
      { done: false, dueAt: now - 86400000, ref: "vuln:a" }, // 기한 초과
      { done: false, dueAt: now + 86400000, ref: "vuln:b" }, // 기한 전
      { done: true, dueAt: now - 86400000, ref: "vuln:c" }, // 완료(기한 지났어도 준수)
      { done: false, ref: "vuln:d" }, // 기한 없음(준수)
    ];
    const sla = remediationSla(tasks, now);
    const 문장 = SLA산식설명(sla.tasks, sla.overdue);
    const m = /\((\d+) − (\d+)\) ÷ (\d+) × 100/.exec(문장);
    expect(m, `문장에서 산식 숫자를 못 뽑았다: ${문장}`).not.toBeNull();
    const [, 전체문자, 초과문자, 전체문자2] = m as RegExpExecArray;
    const 전체 = Number(전체문자);
    const 초과 = Number(초과문자);
    expect(전체문자2).toBe(전체문자); // 분모의 두 표기가 같은 수
    const 문장으로계산한값 = Math.round(((전체 - 초과) / 전체) * 100);
    expect(전체, "문장의 분모가 실제 조치대상 수와 같다").toBe(sla.tasks);
    expect(초과, "문장의 기한초과 수가 실제 값과 같다").toBe(sla.overdue);
    expect(문장으로계산한값, "문장이 말하는 산식으로 다시 계산한 값이 remediationSla().slaCompliance와 같아야 한다").toBe(
      sla.slaCompliance,
    );
  });
});

describe("sla.ts 판정 함수 — 단위 시험", () => {
  it("조치대상인가 — ref가 vuln:으로 시작할 때만 true", () => {
    expect(조치대상인가({ ref: "vuln:host1", done: false })).toBe(true);
    expect(조치대상인가({ ref: "other:host1", done: false })).toBe(false);
    expect(조치대상인가({ done: false })).toBe(false);
  });

  it("기한초과인가·준수건인가는 정확한 여집합이다", () => {
    const now = Date.now();
    const cases: { done: boolean; dueAt?: number }[] = [
      { done: false, dueAt: now - 1000 },
      { done: false, dueAt: now + 1000 },
      { done: true, dueAt: now - 1000 },
      { done: true, dueAt: now + 1000 },
      { done: false },
      { done: true },
    ];
    for (const t of cases) {
      expect(기한초과인가(t, now)).toBe(!준수건인가(t, now));
    }
  });

  it("remediationSla — 표본 0이면 100%(잴 것이 없다는 뜻)", () => {
    expect(remediationSla([]).slaCompliance).toBe(100);
    expect(remediationSla([]).tasks).toBe(0);
  });
});
