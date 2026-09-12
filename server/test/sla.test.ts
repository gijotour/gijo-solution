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
import { 조치대상인가, 기한초과인가, 준수건인가, remediationSla, SLA산식설명, SLA미집계설명 } from "../src/engine/sla";
import { computeKpiSnapshot, resetKpiForTests } from "../src/engine/kpi";
import { resetAssetsForTests, seedSampleAssetsIfEmpty } from "../src/engine/assets";
import { resetTasksForTests, createTask } from "../src/engine/tasks";
import { collectVulnReportData } from "../src/engine/report";

const ENGINE = path.join(__dirname, "..", "src", "engine");
const 소스 = (...조각: string[]) => fs.readFileSync(path.join(ENGINE, ...조각), "utf8");

/**
 * 잎(의존 0) 계약을 재는 유일한 잣대 — **`^import`만 보면 안 된다.**
 * `export { x } from "./tasks"`(재수출) · `await import("./tasks")`(동적) · `require("./tasks")`
 * 셋은 `^import`에 안 걸리는데 의존은 실제로 생긴다(2026-09-12 검토관 [하]).
 */
function 의존줄들(src: string): string[] {
  return src.split("\n").filter((l) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false; // 주석은 뜻이 없다
    if (/^\s*(import|export)\b[^;]*\bfrom\b/.test(l)) return true; // 정적 import · 재수출
    if (/\bimport\s*\(/.test(l)) return true; // 동적 import()
    if (/\brequire\s*\(/.test(l)) return true; // CommonJS require()
    return false;
  });
}

describe("sla.ts — 잎 모듈 계약(의존 0줄)", () => {
  it("sla.ts는 어떤 것도 끌어오지 않는다 — tasks.ts를 부르면 express·auth·db가 딸려 와 잎이 깨진다", () => {
    const 걸린줄 = 의존줄들(소스("sla.ts"));
    expect(
      걸린줄,
      "sla.ts에 의존이 생겼다 — kpi.ts·report.ts 양쪽에서 순환 없이 쓰려면 잎(의존 0줄)이어야 한다:\n  " +
        걸린줄.join("\n  "),
    ).toEqual([]);
  });

  it("이 잣대 자체가 재수출·동적 import·require를 실제로 잡는다(헛도는 감시 방지)", () => {
    expect(의존줄들('export { 기한초과인가 } from "./tasks";')).toHaveLength(1);
    expect(의존줄들('  const m = await import("./tasks");')).toHaveLength(1);
    expect(의존줄들('  const { listTasks } = require("./tasks");')).toHaveLength(1);
    expect(의존줄들('import { listTasks } from "./tasks";')).toHaveLength(1);
    // 주석·평범한 코드는 안 걸린다(거짓 빨강 방지)
    expect(의존줄들('//   import { listTasks } from "./tasks" 를 하지 않는다')).toEqual([]);
    expect(의존줄들("export function 조치대상인가(t: RemediationTaskLike): boolean {")).toEqual([]);
  });
});

describe("★ 소스 감시 — 조치 SLA 판정을 sla.ts 밖에서 다시 짜는 자리가 없는가", () => {
  // ⚠ 2026-09-12 검토관 [중] — 처음 판은 「집계 키워드(.filter/.some/.length…)가 **같은 줄**에
  //   있을 때만」 잡았다. 그래서 판정식을 한 줄로 따로 적는 흔한 꼴
  //   (`const overdue = !t.done && t.dueAt != null && t.dueAt < now;`)은 원리상 못 잡았고,
  //   실제로 저장소에 있는 같은 판정식들(mywork.ts·handlers.ts)도 안 걸려 예외에조차 없었다.
  //   → 집계 키워드 요구를 **빼고** 판정식 줄 자체를 잡되, 지금 걸리는 자리를 이유와 함께
  //     예외로 올린다. 예외는 **파일 이름이 아니라 줄 조각**으로 단다 — 파일로 빼 두면 그 파일에
  //     새로 생기는 딴 판정식까지 같이 눈감아 준다.
  const 예외파일: Record<string, string> = {
    "sla.ts": "판정 함수(조치대상인가·기한초과인가·준수건인가·remediationSla)가 사는 원본 — 여기가 잣대다",
  };

  /** 걸러도 되는 **줄** — 이유를 반드시 적는다(findingcount.test.ts 형식). 이유 없이 조각만 넣는 것은 시험을 끄는 것과 같다. */
  const 예외줄: Record<string, string> = {
    'getAsset(raw.startsWith("vuln:")':
      "handlers.ts — **자산 id**의 vuln: 접두사(importVulnScan이 스캔 호스트에 붙이는 것)를 되살리는 자리다. " +
      "조치 티켓의 task.ref와 글자만 같고 모집단이 다르다(자산 vs 조치 항목)",
    'if (a.id.startsWith("vuln:")) return false;':
      "assetcoverage.ts — 자산 id 접두사로 스캐너가 들여온 IP 호스트를 빼는 자리. 조치 티켓·SLA와 무관",
    'if (id.startsWith("vuln:")) return "scanner";':
      "assets.ts — 자산의 출처(스캐너)를 가리는 자리. 조치 티켓·SLA와 무관",
    'listTasks().some((t) => (t.ref ?? "").startsWith("vuln:"))':
      "tasks.ts 시드 가드(seedSampleRemediationTasksIfEmpty) — 조치 항목이 하나라도 있으면 시드를 건너뛰는 " +
      "**존재 여부** 확인이라 준수율·기한초과 집계와 무관하다",
    'r.startsWith("vulnhost:") || r.startsWith("vuln:")':
      "workguide.ts — 어느 절차 안내문을 쓸지 고르는 자리(vuln-remediate). 세는 일이 아니다",
    'const 기한지남 = typeof t.dueAt === "number" && t.dueAt < Date.now();':
      "handlers.ts 절차 안내 머리글 — **한 건**의 기한 지남 표시(⚠ 기한 지남)다. vuln: 모집단도 아니고 집계도 아니다",
    "const due = listTasks().filter((t) => !t.done && t.dueAt != null && t.dueAt <= soon);":
      "alertschedule.ts — 시스템 알림(sla_due)이 쓰는 모집단은 vuln:로 거르지 않은 **전체 조치 항목**이다. " +
      "remediationSla와 합치면 알릴 대상이 줄어든다",
    "const overdue = due.filter((t) => (t.dueAt ?? 0) < now);":
      "alertschedule.ts — 바로 위 알림 모집단의 초과분. 같은 이유로 SLA 준수율과 모집단이 다르다",
    "overdue: !t.done && t.dueAt != null && t.dueAt < now,":
      "mywork.ts — 내 업무 목록 **한 줄마다 붙는 표시용 깃발**이고 모집단이 vuln: 조치가 아니라 내 업무 전체다. " +
      "⚠ 다만 판정식 자체는 sla.ts 기한초과인가와 글자까지 같다 — mywork.ts가 그 함수를 부르게 하는 것은 " +
      "이번 묶음 범위 밖(다른 실행자 파일)이라 메인 결정 사안으로 올려 두고 예외로 둔다",
    "open.filter((t) => t.dueAt != null && t.dueAt <= todayEnd)":
      "mywork.ts — 오늘 안에 마감인 것을 묶는 자리(하루 끝 기준). SLA 준수율·기한초과 집계가 아니다",
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

  /** 조치대상(task.ref의 vuln: 접두사) 모집단을 다시 거르는 줄인가 — 집계 키워드를 **요구하지 않는다**. */
  function 조치대상줄인가(l: string): boolean {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    return /\.startsWith\(["']vuln:["']\)/.test(l);
  }

  /** dueAt을 지금/기준시각과 견줘 기한초과·준수를 **판정**하는 줄인가 — 집계 키워드를 요구하지 않는다. */
  function SLA판정줄인가(l: string): boolean {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (!/\bdueAt\b/.test(l)) return false;
    if (!/[<>]=?/.test(l)) return false;
    return /\b(now|soon|Date\.now|today)\b/.test(l);
  }

  const 예외줄조각들 = Object.keys(예외줄);
  const 예외줄인가 = (l: string) => 예외줄조각들.some((조각) => l.includes(조각));

  /** 파일별로 「예외에 없는 걸린 줄」을 모은다. */
  function 걸린줄모음(): { 파일: string; 줄: string[] }[] {
    const out: { 파일: string; 줄: string[] }[] = [];
    for (const f of ts파일들()) {
      if (예외파일[f]) continue;
      const 줄 = 소스(f)
        .split("\n")
        .filter((l) => (조치대상줄인가(l) || SLA판정줄인가(l)) && !예외줄인가(l));
      if (줄.length) out.push({ 파일: f, 줄: 줄.map((l) => l.trim().slice(0, 120)) });
    }
    return out;
  }

  it("조치대상 모집단·기한초과/준수 판정을 sla.ts 밖에서 다시 짜는 자리가 없다", () => {
    const 걸린것 = 걸린줄모음().map((x) => `${x.파일} — ${x.줄.length}곳:\n      ${x.줄.join("\n      ")}`);
    expect(
      걸린것,
      "SLA 판정식이 sla.ts 밖에서 다시 만들어졌다 — 판정 함수(조치대상인가·기한초과인가·준수건인가·remediationSla)를 " +
        "부르거나, 이 자리가 정말 다른 모집단이면 예외줄에 **이유와 함께** 적을 것:\n\n  " + 걸린것.join("\n  "),
    ).toEqual([]);
  });

  it("★ 이 감시가 「집계 키워드 없는 한 줄 판정식」도 잡는다 — 그것을 못 잡던 것이 2026-09-12 적발이다", () => {
    // 다음 사람이 새 화면·새 API에서 이 한 줄을 적고 그 값으로 세면, 옛 감시는 초록이었다.
    expect(SLA판정줄인가("  const overdue = !t.done && t.dueAt != null && t.dueAt < now;")).toBe(true);
    expect(SLA판정줄인가('  const 지남 = typeof t.dueAt === "number" && t.dueAt < Date.now();')).toBe(true);
    expect(조치대상줄인가('  const 조치 = t.ref?.startsWith("vuln:");')).toBe(true);
    // 거짓 빨강 방지 — 주석과 무관한 줄은 안 걸린다
    expect(SLA판정줄인가("  // t.dueAt < now 이면 기한초과다")).toBe(false);
    expect(SLA판정줄인가("  const dueAt = t.dueAt;")).toBe(false);
  });

  it("예외에는 전부 이유가 적혀 있다", () => {
    const 부실 = [...Object.entries(예외파일), ...Object.entries(예외줄)]
      .filter(([, 이유]) => 이유.trim().length < 20)
      .map(([k]) => k);
    expect(부실, "예외에 이유가 없거나 너무 짧다").toEqual([]);
  });

  it("낡은 예외가 없다 — 예외로 적은 줄·파일이 실제로 지금도 걸린다", () => {
    const 모든줄: string[] = [];
    for (const f of ts파일들()) {
      for (const l of 소스(f).split("\n")) if (조치대상줄인가(l) || SLA판정줄인가(l)) 모든줄.push(l);
    }
    const 안걸리는예외줄 = 예외줄조각들.filter((조각) => !모든줄.some((l) => l.includes(조각)));
    expect(
      안걸리는예외줄,
      "예외에 적힌 줄이 이제 코드에 없다 — 낡은 예외는 시험을 헐겁게 만든다(지우거나 조각을 고칠 것)",
    ).toEqual([]);
    const 없는파일 = Object.keys(예외파일).filter((f) => !fs.existsSync(path.join(ENGINE, f)));
    expect(없는파일, "없는 파일이 예외에 남아 있다").toEqual([]);
  });

  it("이 감시가 헛돌고 있지 않다 — 엔진 전체를 훑고, 하위 폴더(agenttools/handlers.ts)까지 실제로 읽는다", () => {
    // ⚠ 「걸린 파일이 2개 이상」은 전부 엔진 **최상위**라 하위 폴더를 안 훑어도 성립했다 —
    //   재귀가 망가져도 초록인 자가점검이었다(2026-09-12 검토관 [하]). tone.test.ts:406-409 형식으로 고친다.
    const 파일들 = ts파일들();
    expect(파일들.length, "엔진 .ts를 이만큼도 못 찾았다 — 재귀가 망가졌다").toBeGreaterThan(50);
    expect(파일들, "하위 폴더를 안 훑고 있다 — 새 판정식이 agenttools/에 생기면 못 잡는다").toContain(
      "agenttools/handlers.ts",
    );
    // 원본(sla.ts)의 판정 줄은 실제로 잡혀야 한다 — 정규식이 죽으면 여기가 먼저 운다.
    const 원본걸린줄 = 소스("sla.ts")
      .split("\n")
      .filter((l) => 조치대상줄인가(l) || SLA판정줄인가(l));
    expect(원본걸린줄.length, "sla.ts의 판정식조차 못 잡는다 — 잣대가 죽었다").toBeGreaterThanOrEqual(3);
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

  it("표본 0 문장도 단일 출처다 — sla.ts에 한 번, report.ts에는 리터럴 0번", () => {
    // ⚠ 2026-09-12 검토관 [하] — 표본 0 가드가 **호출부 ternary에만** 있었고, 그 문장이
    //   report.ts 두 곳(Word·HTML)에 글자로 복사돼 있었다. 상수(SLA미집계설명)로 모아
    //   세 번째 소비자가 생겨도 같은 문장이 나가게 한다.
    const 조각 = "0건이라 SLA 준수율은 아직 집계 전입니다";
    expect(소스("report.ts").split(조각).length - 1, "report.ts가 표본 0 문장을 베꼈다 — SLA미집계설명을 쓸 것").toBe(0);
    expect(소스("sla.ts").split(조각).length - 1, "표본 0 문장은 sla.ts에 정확히 한 번 있어야 한다").toBe(1);
    // ⚠ import 줄에도 이름이 한 번 나오므로 **쓰는 자리만** 센다(수입 1 + 사용 2 = 3이면 초록이 되는 셈법 금지).
    const 쓰는자리 = 소스("report.ts")
      .split("\n")
      .filter((l) => !/^\s*import\b/.test(l))
      .join("\n")
      .split("SLA미집계설명").length - 1;
    expect(쓰는자리, "Word·HTML 두 갈래 모두 상수를 써야 한다").toBe(2);
    expect(소스("report.ts"), "상수를 sla.ts에서 받아 와야 한다").toMatch(/import\s*\{[^}]*SLA미집계설명[^}]*\}\s*from\s*"\.\/sla"/);
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

describe("★ 표시 %와 문장이 어긋나 보이지 않는가 — 반올림을 문장이 스스로 밝힌다", () => {
  // ⚠ 2026-09-12 검토관 [중] — 문장에 숫자를 대입해 적으면서 표시 준수율(Math.round)과
  //   산수가 어긋나 보이게 됐다. 표본 3·7·9건처럼 100으로 안 나누어떨어질 때마다 재현된다:
  //   같은 문단에 「SLA 준수율 67%」와 「(3 − 1) ÷ 3 × 100」(=66.66…)이 나란히 실린다.
  //   감사·임원이 직접 검산하는 자리라, 문장이 반올림을 밝혀야 모순이 아니다.
  it("조치 3건·기한초과 1건 — 표시는 67%인데 산수는 66.66…이다. 문장이 반올림을 밝힌다", () => {
    const now = Date.now();
    const tasks = [
      { done: false, dueAt: now - 86400000, ref: "vuln:a" }, // 기한 초과
      { done: false, dueAt: now + 86400000, ref: "vuln:b" },
      { done: true, ref: "vuln:c" },
    ];
    const sla = remediationSla(tasks, now);
    expect(sla.tasks).toBe(3);
    expect(sla.overdue).toBe(1);
    expect(sla.slaCompliance, "kpi.test.ts:139와 같은 표본 — 반올림해서 67%").toBe(67);

    const 정확한값 = ((sla.tasks - sla.overdue) / sla.tasks) * 100;
    expect(Math.round(정확한값 * 100) / 100, "반올림 전 값은 66.67 — 표시 67%와 다르다").toBe(66.67);

    const 문장 = SLA산식설명(sla.tasks, sla.overdue);
    expect(문장, `반올림 고지가 없으면 검산하는 사람에게 66.7% ≠ 67%로 보인다:\n${문장}`).toContain("반올림");
  });

  it("나누어떨어지는 표본에서도 같은 문장을 쓴다(갈래를 늘리지 않는다)", () => {
    expect(SLA산식설명(4, 1)).toContain("반올림");
    expect(SLA산식설명(4, 1)).toContain("(4 − 1) ÷ 4 × 100");
  });
});

describe("★ 표본 0 가드는 함수 안에 있다 — 호출부가 빠뜨려도 「÷ 0 × 100」이 안 나간다", () => {
  it("SLA산식설명(0, 0)은 산식이 아니라 미집계 문장을 준다", () => {
    const 문장 = SLA산식설명(0, 0);
    expect(문장, "세 번째 소비자(대화 도구·라이트 등)가 가드를 안 쓰면 되살아나던 문장이다").toBe(SLA미집계설명);
    expect(문장).not.toContain("÷ 0 × 100");
    expect(문장).toContain("100%는 만점이 아니라");
  });

  it("음수·비정상 입력도 미집계로 떨어진다(0으로 나누지 않는다)", () => {
    expect(SLA산식설명(-1, 0)).toBe(SLA미집계설명);
    expect(SLA산식설명(Number.NaN, 0)).toBe(SLA미집계설명);
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
