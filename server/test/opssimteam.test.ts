// server/test/opssimteam.test.ts — 야간 회귀 마당 ⑲ 「팀원 두뇌 — 누가 답했나」의 짝 시험.
//
// ■ 왜 생겼나 (2026-09-10 · 계획서 §9.1.1 · 사장님 「추천으로」 — 팀 구성 완료 정의 A)
//   하네스는 「무엇으로 알아들었나」(도구)만 재고 **「어느 팀원이 · 어느 두뇌로 답했나」**는
//   원리상 못 쟀다. ⑲가 그 자리인데, ⑲의 문항표는 **「이 말은 그 팀원에게 간다」는 주장**이다.
//   주장을 사람 기억에 맡기면 라우팅이 바뀌는 날 **거짓 초록**이 된다 — 그래서 여기서
//   **제품 함수로 매번 다시 잰다**(`결정적도착지`·`forcedToolFor`).
//
// ■ 이 시험이 무는 것 다섯
//   ① 27문항이 각자 적힌 도착지로 가는가 (제품 함수 — 흉내 내지 않는다)
//   ② 그 팀원의 **부르는 문**(chat({agentId})) 이 소스에 아직 있는가 (소스 감시)
//   ③ 두뇌 표식이 없으면 **건너뛰고 빨강이 아니다**(옛 서버)
//   ④ 배정과 다른 두뇌·상한 초과는 불편으로 잡히는가 (판정식)
//   ⑤ 보고서 표가 실제로 렌더되는가 (안 실으면 안 만든 것과 같다)
//
// ⚠ 실행 금지 원칙: ⑲는 **운영 서버를 부르지 않고** 여기서 검증된다. 라우팅은 격리 단위로,
//   판정식은 가짜 답으로 잰다(이 파일은 fetch를 한 번도 하지 않는다).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { 결정적도착지 } from "../src/engine/dispatcher";
import { 실제도착 } from "./helpers/routing";
import {
  팀원문항, 팀원기대, 팀원순서, 팀원판정, 팀원표, 배정표스냅샷, 두뇌말,
  상한MS, 지연상한MS, 마당이름, 마당화면,
} from "../../tools/opssim-team.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(__dirname, "..", "..");

/** 제품이 말하는 도착지 — 첫 번째가 이긴다(빈 배열이면 ⑨ 모델 선택). route-explain과 같은 자다. */
async function 첫도착(말: string): Promise<string | null> {
  const 걸림 = await 결정적도착지(말, { 역할: "admin", 화면: 마당화면 });
  return 걸림.length ? 걸림[0].도착 : null;
}

// ── ① 라우팅 — 27문항이 각자 적힌 자리로 간다 ────────────────────────────────────────
describe("⑲ 문항이 그 팀원의 문으로 간다 (제품 함수로 잰다)", () => {
  it("문항표의 꼴이 계획서 §9.1.1의 배분과 같다 — 27문항·팀원 8명", () => {
    expect(팀원문항).toHaveLength(27);
    const 세기 = Object.fromEntries(팀원순서.map((id) => [id, 팀원문항.filter((r) => r.팀원 === id).length]));
    expect(세기).toEqual({
      report: 5, ti: 4, normaltic: 3, analysis: 4, curator: 3, scan: 2, bom: 2, orchestrator: 4,
    });
    // 물음 글자가 열쇠다 — 하나라도 겹치면 한 답에 두 기대가 걸린다.
    expect(new Set(팀원문항.map((r) => r.q)).size).toBe(27);
    expect(Object.keys(팀원기대)).toHaveLength(27);
  });

  // ⚠ **여기가 이 파일의 심장이다.** 문항표에 적힌 `도착`은 2026-09-10 실측이고,
  //   이 시험이 매 회 제품에 다시 물어 같은 답이 나오는지 본다. 라우팅이 바뀌면 여기가 먼저 빨개진다.
  it.each(팀원문항.map((r) => [r.팀원, r.q, r.도착, r.결정적] as const))(
    "%s · 「%s」 → %s",
    async (_팀원, q, 도착, 결정적) => {
      const 잰것 = await 첫도착(q);
      if (결정적) {
        expect(잰것, `제품은 「${q}」를 ${잰것 ?? "(모델 선택)"}으로 보낸다 — 문항표의 「${도착}」이 낡았다`).toBe(도착);
      } else {
        // 결정적이 아니라고 적어 둔 둘(scan_drafts · license_explain)은 **정말로** 강제 규칙이 없어야 한다.
        // 규칙이 생기면 여기가 빨개진다 — 그때 문항표를 `결정적: true`로 고치는 것이 맞다(좋은 빨강이다).
        expect(잰것, `「${q}」에 강제 규칙이 생겼다(${잰것}) — 문항표의 결정적:false를 고칠 때다`).toBeNull();
      }
    },
  );

  it("강제 도구로 못 박힌 문항은 forcedToolFor도 같은 도구를 답한다 (두 번째 자)", () => {
    // 도착 이름이 곧 도구 이름인 행 = 강제 도구 갈래. 체인과 forcedToolFor 둘이 갈리면 설명이 거짓이다.
    const 강제행 = 팀원문항.filter((r) => r.결정적 && r.신호.종류 === "도구" && r.도착 === r.신호.값);
    expect(강제행.length, "강제 도구 갈래가 하나도 없다 — 문항표가 낡았다").toBeGreaterThanOrEqual(14);
    for (const r of 강제행) {
      expect(실제도착(r.q, "admin"), `「${r.q}」`).toBe(r.도착);
    }
  });

  // ★ 반증 — 기대를 틀리게 적으면 이 시험이 **정말로** 빨개지는가.
  //   («시험이 시험을 시험한다» — 판정이 늘 통과하는 자라면 초록도 못 믿는다.)
  it("반증: 기대 팀원·도착을 틀리게 적으면 판정이 어긋난다", async () => {
    const 진짜 = 팀원기대["요즘 위협 있어?"];
    expect(await 첫도착(진짜.q)).toBe("threats");
    expect(await 첫도착(진짜.q)).not.toBe("generateReport"); // 리포트 팀원 것이라 적었다면 빨강
    expect(실제도착(진짜.q, "admin")).not.toBe("incident_cases");
  });
});

// ── ② 소스 감시 — 그 팀원의 부르는 문이 아직 살아 있는가 ────────────────────────────
describe("⑲ 팀원의 부르는 문이 소스에 있다", () => {
  // ⚠ 짝을 **배열 그대로** 넘긴다 — 한 글자로 이어 붙였다 나누면 그 글자가 경로에 들어 있을 때 조용히 어긋난다.
  const 문목록: [string, string][] = [
    ...new Map(팀원문항.map((r) => [r.문파일 + "::" + r.문표식, [r.문파일, r.문표식] as [string, string]])).values(),
  ];
  it.each(문목록)(
    "%s 에 %s 가 있다",
    (파일, 표식) => {
      const 소스 = readFileSync(join(뿌리, 파일), "utf8");
      expect(
        소스.includes(표식),
        `${파일}에서 「${표식}」이 사라졌다 — 그 팀원의 부르는 문이 없어졌거나 옮겨졌다. ` +
          "⑲ 문항표의 `문파일`·`문표식`을 새 자리로 고쳐야 한다(안 고치면 ⑲가 없는 팀원을 재게 된다).",
      ).toBe(true);
    },
  );

  it("두뇌가 도는 문항과 「문만」 문항이 섞여 있다 — 하나로 뭉개면 정의 A가 거짓 초록이 된다", () => {
    const 돎 = 팀원문항.filter((r) => r.두뇌돎).length;
    expect(돎).toBeGreaterThan(0);
    expect(돎).toBeLessThan(27);
    // 큐레이터·해석은 **대화 요청에서 두뇌가 안 돈다**(반입 때 돈다) — 이 사실이 표에 그대로 적혀 있어야 한다.
    expect(팀원문항.filter((r) => r.팀원 === "curator").every((r) => !r.두뇌돎)).toBe(true);
    expect(팀원문항.filter((r) => r.팀원 === "scan").every((r) => !r.두뇌돎)).toBe(true);
  });
});

// ── ③④ 판정식 ────────────────────────────────────────────────────────────────────
const 배정 = 배정표스냅샷([
  { id: "orchestrator", name: "Security Orchestrator", abbr: "분배", assignedLocation: "local", assignedModelId: "qwen3-14b" },
  { id: "report", name: "Report Agent", abbr: "보고", assignedLocation: "remote", assignedModelId: "flash-next" },
  { id: "ti", name: "TI Agent", abbr: "위협", assignedLocation: "remote", assignedModelId: "flash-next" },
  { id: "analysis", name: "Analyze Agent", abbr: "우선", assignedLocation: null, assignedModelId: null },
]);

const 리포트행 = 팀원기대["이번 달 보안 리포트 작성해줘"];
const 위협행 = 팀원기대["요즘 위협 있어?"];
const 사서행 = 팀원기대["지식 저장소 현황 알려줘"];
const 분석행 = 팀원기대["테스트 장비에서 방화벽을 잠깐 꺼도 돼?"];

describe("⑲ 판정 — 도착·두뇌·지연", () => {
  it("배정표 스냅샷은 assignedLocation=null을 「전역 따름」으로 남긴다 (모르는 것을 아는 척하지 않는다)", () => {
    expect(배정.report.위치).toBe("remote");
    expect(배정.analysis.위치).toBeNull();
    expect(상한MS("remote")).toBe(지연상한MS.remote);
    expect(상한MS(null)).toBeNull();
    expect(상한MS("어디도아님")).toBeNull();
  });

  it("그 팀원의 문으로 가면 불편이 없다", () => {
    const 판 = 팀원판정(리포트행, { 팀원: "report", 도구: [], ms: 20000, 두뇌: { location: "remote" } }, 배정);
    expect(판.불편).toEqual([]);
    expect(판.기록.도착맞음).toBe(true);
    expect(두뇌말(판.기록)).toBe("원격");
  });

  it("다른 팀원에게 가면 불편으로 잡힌다 — 도구·팀원·단계 세 신호 모두", () => {
    const a = 팀원판정(리포트행, { 팀원: "orchestrator", ms: 900 }, 배정);
    expect(a.불편.map((x) => x.종류)).toContain("다른 팀원에게 감");
    expect(a.불편[0].상세).toContain("실제 orchestrator");

    const b = 팀원판정(위협행, { 도구: ["search"], ms: 900 }, 배정);
    expect(b.불편.map((x) => x.종류)).toContain("다른 팀원에게 감");

    const 복합행 = 팀원기대["전체 자산 스캔하고 우선순위 분석해줘"];
    const c = 팀원판정(복합행, { 단계: [{ action: "scan" }, { action: "analyze" }], ms: 900 }, 배정);
    expect(c.불편.map((x) => x.종류)).toContain("다른 팀원에게 감"); // enrich 단계가 없다 = 해설 팀원이 안 불렸다
    const d = 팀원판정(복합행, { 단계: [{ action: "scan" }, { action: "analyze" }, { action: "enrich" }], ms: 900 }, 배정);
    expect(d.불편).toEqual([]);
  });

  it("★ 두뇌 표식이 없으면 건너뛴다 — 옛 서버는 빨강이 아니다", () => {
    const 판 = 팀원판정(리포트행, { 팀원: "report", ms: 20000 }, 배정); // j.brain 없음
    expect(판.불편).toEqual([]);
    expect(판.기록.표식있음).toBe(false);
    expect(판.기록.실제위치).toBeNull();
    expect(두뇌말(판.기록)).toBe("표식 없음(옛 서버)");
  });

  it("배정과 다른 두뇌·원격 폴백은 불편이다", () => {
    const 판 = 팀원판정(리포트행, { 팀원: "report", ms: 9000, 두뇌: { location: "local", fallback: true } }, 배정);
    const 종류 = 판.불편.map((x) => x.종류);
    expect(종류).toContain("배정과 다른 두뇌");
    expect(종류).toContain("원격이 안 닿아 이 PC로");
    expect(두뇌말(판.기록)).toBe("폴백(local)");
  });

  it("지연 상한 — 원격 30초·로컬 10초, 배정이 없으면 재지 않는다", () => {
    // 원격 배정: 29초는 통과, 31초는 「두뇌 느림」
    expect(팀원판정(리포트행, { 팀원: "report", ms: 29000, 두뇌: { location: "remote" } }, 배정).불편).toEqual([]);
    const 느림 = 팀원판정(리포트행, { 팀원: "report", ms: 31000, 두뇌: { location: "remote" } }, 배정);
    expect(느림.불편.map((x) => x.종류)).toContain("두뇌 느림");
    expect(느림.불편.find((x) => x.종류 === "두뇌 느림")!.상세).toContain("30초");

    // 로컬 배정(총괄): 11초면 느림
    const 총괄행 = 팀원기대["CVE-2014-0160이 뭐야?"];
    expect(팀원판정(총괄행, { 도구: ["explain"], ms: 9000, 두뇌: { location: "local" } }, 배정).불편).toEqual([]);
    expect(
      팀원판정(총괄행, { 도구: ["explain"], ms: 11000, 두뇌: { location: "local" } }, 배정).불편.map((x) => x.종류),
    ).toContain("두뇌 느림");

    // 미배정(전역 따름)이면 상한이 없다 — 없는 약속으로 벌주지 않는다.
    expect(팀원판정(분석행, { 팀원: "analysis", ms: 120000 }, 배정).불편).toEqual([]);
    expect(팀원판정(분석행, { 팀원: "analysis", ms: 120000 }, 배정).기록.상한).toBeNull();
  });

  it("겹쳐 세지 않는다 — 기존 30초 규칙이 이미 셌으면 「두뇌 느림」을 또 붙이지 않는다", () => {
    const 이미 = 팀원판정(리포트행, { 팀원: "report", ms: 45000, 두뇌: { location: "remote" } }, 배정, true);
    expect(이미.불편.map((x) => x.종류)).not.toContain("두뇌 느림");
    // 리포트 전환(wouldHandoff)도 마찬가지 — 사람 경로는 3초에 물러난다.
    const 전환 = 팀원판정(리포트행, { 팀원: "report", ms: 45000, wouldHandoff: true, 두뇌: { location: "remote" } }, 배정);
    expect(전환.불편.map((x) => x.종류)).not.toContain("두뇌 느림");
  });

  it("「문만」 문항에는 두뇌·지연 판정을 걸지 않는다 — 반입 때 도는 팀원을 벌주면 정의 A가 거짓이 된다", () => {
    const 판 = 팀원판정(사서행, { 도구: ["knowledge_status"], ms: 60000, 두뇌: { location: "local", fallback: true } }, 배정);
    expect(판.불편).toEqual([]);
    expect(판.기록.두뇌돎).toBe(false);
    expect(판.기록.상한).toBeNull();
    expect(두뇌말(판.기록)).toBe("문만(반입 때 돎)");
  });

  // ★★ M2(brainmark)의 계약: 표식은 **첫 chat**의 것이다. 한 답에 팀원이 여럿 도는 문항에서
  //    그 표식으로 이 팀원을 견주면 **남의 두뇌로 벌주는** 없는 결함이 매일 밤 하나씩 난다.
  it("여럿이 도는 답(복합 지시)은 도착만 잰다 — 표식·지연은 첫 chat 것이라 이 팀원 것이 아니다", () => {
    const 복합행 = 팀원기대["전체 자산 스캔하고 우선순위 분석해줘"];
    expect(복합행.표식주인, "복합 지시 행에 표식주인:false가 없다 — 남의 두뇌로 해설을 벌주게 된다").toBe(false);
    const 판 = 팀원판정(
      복합행,
      // 분석(로컬·폴백)의 표식이 실리고 시간은 스캔+분석+해설 합계 — 해설은 원격 배정이다.
      { 단계: [{ action: "scan" }, { action: "analyze" }, { action: "enrich" }], ms: 180000, 두뇌: { location: "local", fallback: true } },
      배정표스냅샷([{ id: "normaltic", name: "GIJO Agent", abbr: "해설", assignedLocation: "remote", assignedModelId: "flash-next" }]),
    );
    expect(판.불편, "여럿이 도는 답에 위치·지연 판정을 걸었다").toEqual([]);
    expect(판.기록.도착맞음).toBe(true);
    expect(판.기록.상한).toBeNull();
    expect(두뇌말(판.기록)).toBe("여럿이 돎(표식은 첫 것)");
  });

  it("배정표를 못 읽은 회차(빈 표)에도 도착만은 잰다", () => {
    expect(팀원판정(리포트행, { 팀원: "report", ms: 90000 }, {}).불편).toEqual([]);
    expect(팀원판정(리포트행, { 팀원: "scan", ms: 900 }, {}).불편.map((x) => x.종류)).toContain("다른 팀원에게 감");
  });
});

// ── ⑤ 보고서 표 ───────────────────────────────────────────────────────────────────
describe("⑲ 보고서 팀원별 표", () => {
  const 회차 = [
    { q: 리포트행.q, 불편: [], 팀원기록: 팀원판정(리포트행, { 팀원: "report", ms: 21000, 두뇌: { location: "remote", model: "flash-next" } }, 배정).기록 },
    { q: 위협행.q, 불편: [{ 종류: "두뇌 느림" }], 팀원기록: 팀원판정(위협행, { 도구: ["threats"], ms: 41000, 두뇌: { location: "remote" } }, 배정).기록 },
    { q: 사서행.q, 불편: [], 팀원기록: 팀원판정(사서행, { 도구: ["knowledge_status"], ms: 1200 }, 배정).기록 },
    { q: "이건 ⑲가 아니다", 불편: [] }, // 형제 마당 줄 — 표에 섞이면 안 된다
  ];

  it("팀원마다 한 줄 — 문항 수·도착 맞음·두뇌·평균 지연·상한·불편이 실린다", () => {
    const md = 팀원표(회차, 배정).join("\n");
    expect(md).toContain(마당이름);
    expect(md).toContain("| 팀원 | 배정 위치 | 배정 두뇌 | 문항 | 도착 맞음 | 두뇌 | 평균 지연 | 상한 | 불편 |");
    expect(md).toContain("Report Agent(보고)");
    expect(md).toContain("remote");
    expect(md).toContain("flash-next");
    expect(md).toContain("21.0s");
    expect(md).toContain("문만(반입 때 돎)");
    expect(md).toContain("30s");   // 원격 상한
    expect(md).not.toContain("이건 ⑲가 아니다");
    // 합계 줄 — 「도착 맞음」과 「두뇌가 도는 문항」은 다른 수다.
    expect(md).toMatch(/합계: 문항 3 · 도착 맞음 3 · 이 요청에서 두뇌가 도는 문항 2/);
  });

  it("미배정 팀원이 있으면 표가 그것을 말한다 — 전원 미배정이면 초록이어도 팀은 안 갈라진 것이다", () => {
    const md = 팀원표(
      [{ q: 분석행.q, 불편: [], 팀원기록: 팀원판정(분석행, { 팀원: "analysis", ms: 3000 }, 배정).기록 }],
      배정,
    ).join("\n");
    expect(md).toContain("전역 따름");
    expect(md).toContain("두뇌 위치가 배정되지 않은 팀원 1명");
  });

  it("두뇌 표식이 없는 회차는 보고서가 「옛 서버」라고 밝힌다", () => {
    const md = 팀원표(
      [{ q: 리포트행.q, 불편: [], 팀원기록: 팀원판정(리포트행, { 팀원: "report", ms: 9000 }, 배정).기록 }],
      배정,
    ).join("\n");
    expect(md).toContain("두뇌 표식이 없는 회차입니다");
  });

  it("★ ⑲를 안 돈 회차에는 빈 표를 만들지 않는다 — 0건 초록이 가장 나쁜 거짓말이다", () => {
    expect(팀원표([], 배정)).toEqual([]);
    expect(팀원표([{ q: "형제 마당 줄", 불편: [] }], 배정)).toEqual([]);
  });
});

// ── 하네스가 이 표를 **베끼지 않고 불러 쓰는가** ──────────────────────────────────
describe("⑲ 하네스가 문항표를 사본으로 두지 않는다", () => {
  const 하네스 = readFileSync(join(뿌리, "tools", "ops-sim.mjs"), "utf8");

  it("ops-sim.mjs가 opssim-team.mjs에서 문항·판정·표를 불러 쓴다", () => {
    expect(하네스).toContain('from "./opssim-team.mjs"');
    for (const 이름 of ["팀원문항", "팀원기대", "팀원판정", "팀원표", "배정표스냅샷"]) {
      expect(하네스, `${이름}을 안 불러 쓴다 — 사본을 만들었다면 두 곳이 어긋난다`).toContain(이름);
    }
    // 마당은 문항표에서 만든다(물음을 손으로 다시 적으면 열쇠가 갈린다).
    expect(하네스).toContain("물음: 팀원문항.map((행) => 행.q)");
    // 배정표는 **회차마다** 읽는다 — 숫자를 박아 두지 않는다.
    expect(하네스).toContain('BASE + "/api/agents"');
    expect(하네스).toContain("팀원배정: 배정표"); // meta.json 스냅샷
  });

  it("⑲ 물음이 다른 마당과 겹치지 않는다 — 겹치면 형제 마당의 답까지 ⑲ 잣대로 재게 된다", () => {
    const 시작 = 하네스.indexOf("const 마당 = [");
    const 끝 = 하네스.indexOf("\n];", 시작);
    expect(시작, "ops-sim.mjs에서 마당 배열을 못 찾았다 — 이 감시가 낡았다").toBeGreaterThan(0);
    const 몸통 = 하네스.slice(시작, 끝);
    // ⑲ 줄은 문항표에서 만들어지므로 이 몸통에 물음 글자가 없다 — 남은 것은 전부 형제 마당이다.
    const 형제물음 = new Set([...몸통.matchAll(/"([^"\n]{1,80})"/g)].map((m) => m[1]));
    const 겹침 = 팀원문항.map((r) => r.q).filter((q) => 형제물음.has(q));
    expect(겹침, `겹치는 물음: ${겹침.join(" · ")}`).toEqual([]);
  });
});
