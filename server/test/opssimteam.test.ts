// server/test/opssimteam.test.ts — 야간 회귀 마당 ⑲ 「팀원 두뇌 — 누가 답했나」의 짝 시험.
//
// ■ 왜 생겼나 (2026-09-10 · 계획서 §9.1.1 · 사장님 「추천으로」 — 팀 구성 완료 정의 A)
//   하네스는 「무엇으로 알아들었나」(도구)만 재고 **「어느 팀원이 · 어느 두뇌로 답했나」**는
//   원리상 못 쟀다. ⑲가 그 자리인데, ⑲의 문항표는 **「이 말은 그 팀원에게 간다」는 주장**이다.
//   주장을 사람 기억에 맡기면 라우팅이 바뀌는 날 **거짓 초록**이 된다 — 그래서 여기서
//   **제품 함수로 매번 다시 잰다**(`결정적도착지`·`forcedToolFor`·`planInstruction`).
//
// ■ 이 시험이 무는 것 여덟
//   ① 27문항이 각자 적힌 도착지로 가는가 (제품 함수 — 흉내 내지 않는다)
//   ② 그 팀원의 **부르는 문**(chat({agentId})) 이 소스에 아직 있는가 (소스 감시)
//   ③ 두뇌 표식이 없으면 **건너뛰고 빨강이 아니다**(옛 서버)
//   ④ 배정과 다른 두뇌·상한 초과는 불편으로 잡히는가 (판정식)
//   ⑤ 보고서 표가 실제로 렌더되는가 (안 실으면 안 만든 것과 같다)
//   ⑥ ★ `표식남나`가 **소스와 맞는가** — 결정 호출(responseSchema)에는 표식이 원리상 안 남는다.
//      이 칸이 소스와 어긋나면 M2가 제대로 실린 서버에도 매일 밤 「M2 미반영」 거짓 진단이 찍힌다.
//   ⑦ ★ 실패한 줄(오류·빈 답)도 **분모에 남는가** — 빠지면 죽은 회차가 초록으로 읽힌다.
//   ⑧ ★ ⑲ 문항이 **운영 데이터를 바꾸지 않는가** — 복합 지시에 scan 단계가 있으면 자산이 갈린다.
//
// ⚠ 실행 금지 원칙: ⑲는 **운영 서버를 부르지 않고** 여기서 검증된다. 라우팅은 격리 단위로,
//   판정식은 가짜 답으로 잰다(이 파일은 fetch를 한 번도 하지 않는다).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { 결정적도착지, planInstruction } from "../src/engine/dispatcher";
import { 실제도착 } from "./helpers/routing";
import {
  팀원문항, 팀원기대, 팀원순서, 팀원판정, 팀원표, 배정표스냅샷, 두뇌말, 실패이유, 표식잴수있나,
  두뇌기록고르기, 상한MS, 지연상한MS, 마당이름, 마당화면,
} from "../../tools/opssim-team.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(__dirname, "..", "..");
const 읽기 = (상대: string) => readFileSync(join(뿌리, 상대), "utf8");

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

  // ★★ ⑧ 운영 데이터 — **야간 회귀는 재는 일이지 바꾸는 일이 아니다**(2026-09-10 검토관 적발).
  //    「전체 자산 스캔하고 …」는 planInstruction이 scan 단계를 만들고, 그 단계가 자산마다
  //    recordFindings로 스캔 이력 추가·findings 갈아끼움·자동배정 훅을 **결재판 없이** 돌렸다.
  //    문항을 늘리다 보면 「스캔」이 또 들어오기 쉬우므로 **제품 함수로** 매 회 막는다.
  it("★ ⑲ 문항은 운영 자산을 건드리지 않는다 — 복합 지시에 scan 단계가 없다 (planInstruction으로 잰다)", () => {
    for (const r of 팀원문항) {
      const steps = planInstruction(r.q).map((s: { action: string }) => s.action);
      if (steps.length >= 2) {
        expect(steps, `「${r.q}」가 복합 지시로 scan을 돌린다 — 매일 밤 운영 자산의 findings가 갈린다`).not.toContain("scan");
      }
    }
    // 해설 팀원의 오케스트레이션 문은 살아 있어야 한다(막느라 문을 없애 버리면 ⑲가 잴 것이 없다).
    const 복합행 = 팀원기대["우선순위 분석하고 리포트 작성해줘"];
    expect(복합행, "복합 지시 문항이 사라졌다 — 해설 팀원의 enrich 문을 아무도 안 잰다").toBeTruthy();
    expect(planInstruction(복합행.q).map((s: { action: string }) => s.action)).toEqual(["analyze", "report"]);
    // 「스캔 해석 초안 보여줘」는 낱말만 스캔이다 — 1단계라 오케스트레이션에 못 든다.
    expect(planInstruction("스캔 해석 초안 보여줘").length).toBeLessThan(2);
  });

  // ★ 반증 — 기대를 틀리게 적으면 이 시험이 **정말로** 빨개지는가.
  //   («시험이 시험을 시험한다» — 판정이 늘 통과하는 자라면 초록도 못 믿는다.)
  it("반증: 기대 팀원·도착을 틀리게 적으면 판정이 어긋난다", async () => {
    const 진짜 = 팀원기대["요즘 위협 있어?"];
    expect(await 첫도착(진짜.q)).toBe("threats");
    expect(await 첫도착(진짜.q)).not.toBe("generateReport"); // 리포트 팀원 것이라 적었다면 빨강
    expect(실제도착(진짜.q, "admin")).not.toBe("incident_cases");
    // 옛 판의 스캔 문항을 되살리면 ⑧ 감시가 잡는다.
    expect(planInstruction("전체 자산 스캔하고 우선순위 분석해줘").map((s: { action: string }) => s.action)).toContain("scan");
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
      const 소스 = 읽기(파일);
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

// ── ⑥ 표식남나 — **결정 호출에는 표식이 원리상 안 남는다**(2026-09-10 검토관 적발, 치명) ──────
//    M2(brainmark)는 responseSchema 호출을 **값으로** 건너뛴다. 그런데 ti·analysis·bom의 그 팀원
//    chat은 전부 스키마 호출이고 그 도구들은 directAnswer라 재작성 chat도 없다 → 표식이 영영 없다.
//    이것을 「표식 없음 = 옛 서버」로 읽으면 **거짓 진단**이 매일 밤 보고서에 실린다.
describe("⑲ 표식남나 칸이 소스와 맞는다 (M2의 약속을 그대로 읽는다)", () => {
  /** `chat({ … })` 한 덩이씩 — 중괄호 짝으로 끊는다(정규식으로는 여러 줄 인자를 못 끊는다). */
  function chat블록들(소스: string): string[] {
    const 블록: string[] = [];
    let i = 0;
    for (;;) {
      const s = 소스.indexOf("chat({", i);
      if (s < 0) break;
      let 깊이 = 0;
      let j = s + "chat(".length;
      for (; j < 소스.length; j++) {
        const c = 소스[j];
        if (c === "{") 깊이++;
        else if (c === "}") { 깊이--; if (깊이 === 0) { j++; break; } }
      }
      블록.push(소스.slice(s, j));
      i = j;
    }
    return 블록;
  }

  it("M2의 잣대가 아직 소스에 그대로 있다 — 바뀌면 이 마당의 칸도 바뀌어야 한다", () => {
    // ⚠ 2026-09-10 M2가 잣대를 넓혔다(결정 호출만 → **explain이 아닌 호출 전부**). 그날 그대로
    //   두었다면 ⑲는 리포트·해설 문항까지 「M2 미반영」이라 외쳤을 것이다.
    expect(읽기("server/src/engine/brainmark.ts")).toContain("if (보고.결정호출 || !보고.사람이읽는답) return;");
    expect(읽기("server/src/engine/llm.ts")).toContain("결정호출: !!args.responseSchema");
    expect(읽기("server/src/engine/llm.ts")).toContain("사람이읽는답: args.explain === true");
  });

  /** M2의 잣대 그대로 — **비-스키마이면서 explain을 켠** chat만 표식을 남긴다. */
  const 표식남기나 = (블록: string[]) =>
    블록.some((b) => !b.includes("responseSchema") && b.includes("explain: true"));

  const 돎행 = 팀원문항.filter((r) => r.두뇌돎);
  it.each(돎행.map((r) => [r.팀원, r.q, r.표식남나 !== false] as const))(
    "%s · 「%s」 표식남나=%s",
    (_팀원, q, 남나) => {
      const 행 = 팀원기대[q];
      const 블록 = chat블록들(읽기(행.문파일)).filter((b) => b.includes(행.문표식));
      expect(블록.length, `${행.문파일}에서 ${행.문표식} chat 블록을 못 찾았다 — 감시가 낡았다`).toBeGreaterThan(0);
      expect(
        표식남기나(블록),
        남나
          ? `${행.문파일}의 ${행.문표식} chat에서 표식이 사라졌다(스키마가 붙었거나 explain이 빠졌다). ` +
            "문항표에 `표식남나: false`를 적어야 「M2 미반영」이라는 거짓 진단이 안 나간다."
          : `${행.문파일}의 ${행.문표식}에 담당자용 답 chat(explain:true)이 생겼다 — 이제 표식이 남는다. ` +
            "문항표의 `표식남나: false`를 지우고 위치·지연 판정을 켤 때다(좋은 빨강이다).",
      ).toBe(남나);
    },
  );

  it("★ 표식이 남는 갈래는 총괄 4문항뿐이다 — 나머지 열넷은 「돌지만 안 남는」 갈래다", () => {
    const 안남 = 팀원문항.filter((r) => r.두뇌돎 && r.표식남나 === false);
    expect(안남).toHaveLength(14); // report 5 · ti 4 · analysis 3 · bom 1 · normaltic(복합) 1
    expect([...new Set(안남.map((r) => r.팀원))].sort()).toEqual(["analysis", "bom", "normaltic", "report", "ti"]);
    // 표식으로 위치를 견줄 수 있는 갈래는 총괄뿐 — 그런데 총괄은 코드로 이 PC 고정이다.
    expect([...new Set(팀원문항.filter(표식잴수있나).map((r) => r.팀원))]).toEqual(["orchestrator"]);
    expect(팀원문항.filter(표식잴수있나)).toHaveLength(4);
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
const 총괄행 = 팀원기대["CVE-2014-0160이 뭐야?"];
const 복합행 = 팀원기대["우선순위 분석하고 리포트 작성해줘"];

describe("⑲ 판정 — 도착·두뇌·지연", () => {
  it("배정표 스냅샷은 assignedLocation=null을 「전역 따름」으로 남긴다 (모르는 것을 아는 척하지 않는다)", () => {
    expect(배정.report.위치).toBe("remote");
    expect(배정.analysis.위치).toBeNull();
    expect(상한MS("remote")).toBe(지연상한MS.remote);
    expect(상한MS(null)).toBeNull();
    expect(상한MS("어디도아님")).toBeNull();
  });

  it("그 팀원의 문으로 가면 불편이 없다", () => {
    // 표식이 실제로 남는 갈래(총괄의 최종 답)로 잰다 — 배정도 로컬이라 아무 불편이 없다.
    const 판 = 팀원판정(총괄행, { 도구: ["explain"], ms: 4000, 두뇌: { location: "local" } }, 배정);
    expect(판.불편).toEqual([]);
    expect(판.기록.도착맞음).toBe(true);
    expect(두뇌말(판.기록)).toBe("로컬");
    // 리포트는 문으로는 가지만 표식이 안 남는 갈래다 — 도착만 초록이다.
    const 리 = 팀원판정(리포트행, { 팀원: "report", ms: 20000, 두뇌: { location: "remote" } }, 배정);
    expect(리.불편).toEqual([]);
    expect(리.기록.도착맞음).toBe(true);
    expect(두뇌말(리.기록)).toBe("돎(표식 안 남는 갈래)");
  });

  it("다른 팀원에게 가면 불편으로 잡힌다 — 도구·팀원·단계 세 신호 모두", () => {
    const a = 팀원판정(리포트행, { 팀원: "orchestrator", ms: 900 }, 배정);
    expect(a.불편.map((x: { 종류: string }) => x.종류)).toContain("다른 팀원에게 감");
    expect(a.불편[0].상세).toContain("실제 orchestrator");

    const b = 팀원판정(위협행, { 도구: ["search"], ms: 900 }, 배정);
    expect(b.불편.map((x: { 종류: string }) => x.종류)).toContain("다른 팀원에게 감");

    const c = 팀원판정(복합행, { 단계: [{ action: "analyze" }, { action: "report" }], ms: 900 }, 배정);
    expect(c.불편.map((x: { 종류: string }) => x.종류)).toContain("다른 팀원에게 감"); // enrich 단계가 없다 = 해설 팀원이 안 불렸다
    const d = 팀원판정(복합행, { 단계: [{ action: "analyze" }, { action: "enrich" }, { action: "report" }], ms: 900 }, 배정);
    expect(d.불편).toEqual([]);
  });

  it("★ 두뇌 표식이 없으면 건너뛴다 — 옛 서버는 빨강이 아니다", () => {
    const 판 = 팀원판정(총괄행, { 도구: ["explain"], ms: 8000 }, 배정); // j.brain 없음
    expect(판.불편).toEqual([]);
    expect(판.기록.표식있음).toBe(false);
    expect(판.기록.실제위치).toBeNull();
    expect(두뇌말(판.기록)).toBe("표식 없음(옛 서버)");
  });

  it("배정과 다른 두뇌·원격 폴백은 불편이다", () => {
    // 총괄은 로컬 배정인데 원격 표식이 왔다 + 폴백 자국이 있다.
    const 판 = 팀원판정(총괄행, { 도구: ["explain"], ms: 9000, 두뇌: { location: "remote", fallback: true } }, 배정);
    const 종류 = 판.불편.map((x: { 종류: string }) => x.종류);
    expect(종류).toContain("배정과 다른 두뇌");
    expect(종류).toContain("원격이 안 닿아 이 PC로");
    expect(두뇌말(판.기록)).toBe("폴백(remote)");
  });

  it("지연 상한 — 원격 30초·로컬 10초, 배정이 없으면 재지 않는다", () => {
    // 로컬 배정(총괄): 9초는 통과, 11초면 「두뇌 느림」
    expect(팀원판정(총괄행, { 도구: ["explain"], ms: 9000, 두뇌: { location: "local" } }, 배정).불편).toEqual([]);
    expect(
      팀원판정(총괄행, { 도구: ["explain"], ms: 11000, 두뇌: { location: "local" } }, 배정).불편.map((x: { 종류: string }) => x.종류),
    ).toContain("두뇌 느림");

    // 원격 배정이면 30초가 상한이다 — **판정식**을 재는 자리라 배정표를 그렇게 만들어 넣는다
    //   (운영에서 총괄은 이 PC 고정이다. 그 사실과 판정식의 옳음은 다른 문제다).
    const 배정원격 = 배정표스냅샷([{ id: "orchestrator", name: "Security Orchestrator", assignedLocation: "remote", assignedModelId: "flash-next" }]);
    expect(팀원판정(총괄행, { 도구: ["explain"], ms: 29000, 두뇌: { location: "remote" } }, 배정원격).불편).toEqual([]);
    const 느림 = 팀원판정(총괄행, { 도구: ["explain"], ms: 31000, 두뇌: { location: "remote" } }, 배정원격);
    expect(느림.불편.map((x: { 종류: string }) => x.종류)).toContain("두뇌 느림");
    expect(느림.불편.find((x: { 종류: string }) => x.종류 === "두뇌 느림")!.상세).toContain("30초");

    // 미배정(전역 따름)이면 상한이 없다 — 없는 약속으로 벌주지 않는다.
    const 미배정총괄 = 팀원판정(총괄행, { 도구: ["explain"], ms: 120000, 두뇌: { location: "local" } }, {});
    expect(미배정총괄.불편).toEqual([]);
    expect(미배정총괄.기록.상한).toBeNull();
  });

  it("겹쳐 세지 않는다 — 기존 30초 규칙이 이미 셌으면 「두뇌 느림」을 또 붙이지 않는다", () => {
    const 이미 = 팀원판정(총괄행, { 도구: ["explain"], ms: 45000, 두뇌: { location: "local" } }, 배정, true);
    expect(이미.불편.map((x: { 종류: string }) => x.종류)).not.toContain("두뇌 느림");
    expect(이미.기록.지연잼, "겹쳐 세지 않은 줄을 「쟀다」고 적으면 상한 칸이 거짓이 된다").toBe(false);
    // 리포트 전환(wouldHandoff)도 마찬가지 — 사람 경로는 3초에 물러난다.
    const 전환 = 팀원판정(총괄행, { 도구: ["explain"], ms: 45000, wouldHandoff: true, 두뇌: { location: "local" } }, 배정);
    expect(전환.불편.map((x: { 종류: string }) => x.종류)).not.toContain("두뇌 느림");
    expect(전환.기록.지연잼).toBe(false);
  });

  it("「문만」 문항에는 두뇌·지연 판정을 걸지 않는다 — 반입 때 도는 팀원을 벌주면 정의 A가 거짓이 된다", () => {
    const 판 = 팀원판정(사서행, { 도구: ["knowledge_status"], ms: 60000, 두뇌: { location: "local", fallback: true } }, 배정);
    expect(판.불편).toEqual([]);
    expect(판.기록.두뇌돎).toBe(false);
    expect(판.기록.상한).toBeNull();
    expect(두뇌말(판.기록)).toBe("문만(반입 때 돎)");
  });

  // ★★ ⑥ 표식이 **원리상** 없는 줄을 「옛 서버」로 적으면 매일 밤 거짓 진단이 나간다.
  it("★ 표식이 안 남는 갈래는 표식이 없어도 「옛 서버」라 하지 않는다 — 위치·폴백·지연도 안 잰다", () => {
    const 판 = 팀원판정(위협행, { 도구: ["threats"], ms: 41000 }, 배정); // 표식 없음(원리상)
    expect(판.불편).toEqual([]);
    expect(판.기록.표식남나).toBe(false);
    expect(판.기록.상한, "표식을 못 보는 줄에 상한을 걸면 배정과 무관한 시간으로 벌준다").toBeNull();
    expect(두뇌말(판.기록)).toBe("조건부 돎(표식 안 남는 갈래)");

    // 혹시 서버가 표식을 실어 보내도(다른 chat의 것) 그것으로 이 팀원을 견주지 않는다.
    const 남의표식 = 팀원판정(위협행, { 도구: ["threats"], ms: 900, 두뇌: { location: "local", fallback: true } }, 배정);
    expect(남의표식.불편, "표식 안 남는 줄에 남의 표식으로 「배정과 다른 두뇌」를 붙였다").toEqual([]);
    expect(남의표식.기록.표식있음).toBe(false);

    // 분석(결정 호출)·리포트(explain 없음) 둘 다 같은 갈래다.
    expect(팀원판정(분석행, { 팀원: "analysis", ms: 900 }, 배정).기록.표식남나).toBe(false);
    expect(두뇌말(팀원판정(분석행, { 팀원: "analysis", ms: 900 }, 배정).기록)).toBe("돎(표식 안 남는 갈래)");
    expect(팀원판정(리포트행, { 팀원: "report", ms: 900 }, 배정).기록.상한).toBeNull();
  });

  // ★ ⑤ 「돎」이 **데이터에 달린** 문항 — 매칭이 0건인 밤에는 두뇌가 안 돈다(scandrafts.ts:441).
  it("★ ti 문항은 「조건부 돎」이라 적혀 있다 — 매칭이 없던 밤에도 「돌았다」고 세면 거짓이다", () => {
    for (const r of 팀원문항.filter((x) => x.팀원 === "ti")) {
      expect(r.두뇌조건, `「${r.q}」에 두뇌조건이 없다`).toBeTruthy();
    }
    expect(읽기("server/src/engine/scandrafts.ts"))
      .toContain('if (!items.length || process.env.GIJO_TI_INTERPRET === "0") return "";');
    // 조건이 없는 문항(리포트)은 그냥 「돎」이다 — 조건부와 뭉개지 않는다.
    expect(리포트행.두뇌조건 ?? null).toBeNull();
  });

  // ★★ M2(brainmark)의 계약: 표식은 **첫 chat**의 것이다. 한 답에 팀원이 여럿 도는 문항에서
  //    그 표식으로 이 팀원을 견주면 **남의 두뇌로 벌주는** 없는 결함이 매일 밤 하나씩 난다.
  it("여럿이 도는 답(복합 지시)은 도착만 잰다 — 표식·지연은 첫 chat 것이라 이 팀원 것이 아니다", () => {
    expect(복합행.표식주인, "복합 지시 행에 표식주인:false가 없다 — 남의 두뇌로 해설을 벌주게 된다").toBe(false);
    const 판 = 팀원판정(
      복합행,
      // 분석(로컬·폴백)의 표식이 실리고 시간은 분석+해설+리포트 합계 — 해설은 원격 배정이다.
      { 단계: [{ action: "analyze" }, { action: "enrich" }, { action: "report" }], ms: 180000, 두뇌: { location: "local", fallback: true } },
      배정표스냅샷([{ id: "normaltic", name: "GIJO Agent", abbr: "해설", assignedLocation: "remote", assignedModelId: "flash-next" }]),
    );
    expect(판.불편, "여럿이 도는 답에 위치·지연 판정을 걸었다").toEqual([]);
    expect(판.기록.도착맞음).toBe(true);
    expect(판.기록.상한).toBeNull();
    expect(두뇌말(판.기록)).toBe("여럿이 돎(표식은 첫 것)");
  });

  it("배정표를 못 읽은 회차(빈 표)에도 도착만은 잰다", () => {
    expect(팀원판정(리포트행, { 팀원: "report", ms: 90000 }, {}).불편).toEqual([]);
    expect(팀원판정(리포트행, { 팀원: "scan", ms: 900 }, {}).불편.map((x: { 종류: string }) => x.종류)).toContain("다른 팀원에게 감");
  });
});

// ── ⑨ 팀원별 두뇌기록(계약 ⑦) — **표식이 못 보던 팀원을 눈으로 본다** ────────────────────
//
// ■ 왜 생겼나 (2026-09-10 · ⑲ 첫 실측 23/27)
//   표식은 답 하나뿐이라 원격 배정 팀원 셋(report·normaltic·ti)의 두뇌를 **원리상** 못 봤다 —
//   ⑲는 그 셋을 「돎(표식 없음)」으로만 적었고, 「원격에 배정했다」는 말의 증거가 없었다.
//   이제 서버가 qa 응답에 `두뇌기록`(항목마다 팀원 이름표가 붙은 배열)을 싣는다.
// ⚠ **기록이 없으면 종전 갈래 그대로**여야 한다 — 옛 서버·비-qa 회차에서 없는 결함이 나면 안 된다.
describe("⑲ 두뇌기록 — 그 팀원의 항목으로 견준다", () => {
  /** 서버가 싣는 기록 항목 한 개(기본값은 리포트 팀원이 원격에서 답한 꼴). */
  const 항목 = (덧: Record<string, unknown> = {}) => ({
    agentId: "report", location: "remote", fallback: false, model: "flash-next",
    왕복ms: 19000, 결정호출: false, 사람이읽는답: false, ...덧,
  });

  it("★ 표식이 원리상 없는 갈래(리포트)도 기록이 있으면 **위치를 잰다**", () => {
    const 판 = 팀원판정(리포트행, { 팀원: "report", ms: 21000, 두뇌기록: [항목()] }, 배정);
    expect(판.불편, "배정(remote)과 같은 위치인데 불편이 났다").toEqual([]);
    expect(판.기록.기록으로잼).toBe(true);
    expect(판.기록.실제위치, "기록을 안 읽었다 — 원격 팀원을 여전히 못 본다").toBe("remote");
    expect(판.기록.모델).toBe("flash-next");
    expect(판.기록.왕복ms, "그 팀원 두뇌의 제 시간을 안 적었다").toBe(19000);
    expect(판.기록.표식있음, "기록으로 본 줄을 「표식으로 봤다」고 적었다 — 무엇으로 쟀는지 사라진다").toBe(false);
    expect(두뇌말(판.기록), "표식으로 본 것과 같은 말로 적으면 무엇으로 쟀는지 사라진다").toBe("원격(기록)");
  });

  it("★ 배정과 다른 두뇌·되돌림을 기록으로 잡는다 — 상세에 **무엇으로 쟀는지**가 적힌다", () => {
    const 다름 = 팀원판정(리포트행, { 팀원: "report", ms: 9000, 두뇌기록: [항목({ location: "local" })] }, 배정);
    expect(다름.불편.map((x: { 종류: string }) => x.종류)).toContain("배정과 다른 두뇌");
    expect(다름.불편[0].상세, "표식으로 쟀는지 기록으로 쟀는지 안 적는다").toContain("(기록)");

    const 폴백 = 팀원판정(리포트행, { 팀원: "report", ms: 9000, 두뇌기록: [항목({ location: "local", fallback: true })] }, 배정);
    const 종류 = 폴백.불편.map((x: { 종류: string }) => x.종류);
    expect(종류).toContain("원격이 안 닿아 이 PC로");
    expect(두뇌말(폴백.기록)).toBe("폴백(local·기록)");
  });

  it("★★ 여럿이 도는 답(복합 지시)도 기록이 있으면 **그 팀원 것으로** 잰다 — 표식주인 잣대가 필요 없다", () => {
    const 해설원격 = 배정표스냅샷([{ id: "normaltic", name: "GIJO Agent", abbr: "해설", assignedLocation: "remote", assignedModelId: "flash-next" }]);
    const 단계 = [{ action: "analyze" }, { action: "enrich" }, { action: "report" }];
    // 분석(로컬)·해설(원격)·리포트(원격)가 잇달아 돈 답 — 표식은 첫 것이라 해설을 못 가리킨다.
    const 기록 = [
      항목({ agentId: "analysis", location: "local", model: "qwen3-14b", 왕복ms: 4000 }),
      항목({ agentId: "normaltic", location: "remote", 왕복ms: 22000 }),
      항목({ agentId: "report", 왕복ms: 30000 }),
    ];
    const 판 = 팀원판정(복합행, { 단계, ms: 180000, 두뇌: { location: "local", fallback: true }, 두뇌기록: 기록 }, 해설원격);
    expect(판.불편, "해설은 배정대로 원격이었는데 불편이 났다 — 남의 항목을 골랐다").toEqual([]);
    expect(판.기록.실제위치, "복합 지시에서 해설 항목을 못 골랐다").toBe("remote");
    expect(두뇌말(판.기록)).toBe("원격(기록)");

    // 해설이 실제로는 이 PC에서 돌았다면 그때는 잡아야 한다(좋은 빨강).
    const 갈림 = 팀원판정(
      복합행,
      { 단계, ms: 180000, 두뇌기록: [항목({ agentId: "normaltic", location: "local" }), 항목()] },
      해설원격,
    );
    expect(갈림.불편.map((x: { 종류: string }) => x.종류), "여럿이 도는 답에서 위치 판정이 안 켜졌다").toContain("배정과 다른 두뇌");
  });

  it("★ 반증 — 기록이 없거나 **남의 항목뿐**이면 종전 갈래 그대로다", () => {
    const 없음 = 팀원판정(리포트행, { 팀원: "report", ms: 21000, 두뇌: { location: "remote" } }, 배정);
    expect(없음.기록.기록으로잼, "기록이 없는데 「기록으로 쟀다」고 적었다").toBe(false);
    expect(두뇌말(없음.기록)).toBe("돎(표식 안 남는 갈래)");

    const 남의것 = 팀원판정(리포트행, { 팀원: "report", ms: 21000, 두뇌기록: [항목({ agentId: "orchestrator", location: "local" })] }, 배정);
    expect(남의것.기록.기록으로잼, "남의 팀원 항목으로 이 팀원을 견줬다").toBe(false);
    expect(남의것.불편, "남의 항목으로 「배정과 다른 두뇌」를 붙였다").toEqual([]);
    expect(두뇌말(남의것.기록)).toBe("돎(표식 안 남는 갈래)");

    // 「문만」 행(반입 때 돎)은 기록이 와도 안 잰다 — 계약 ①은 그대로다.
    const 문만 = 팀원판정(사서행, { 도구: ["knowledge_status"], ms: 1200, 두뇌기록: [항목({ agentId: "curator", location: "remote" })] }, 배정);
    expect(문만.기록.기록으로잼, "「문만」 행에 두뇌 판정을 걸었다").toBe(false);
    expect(두뇌말(문만.기록)).toBe("문만(반입 때 돎)");

    // 실패한 줄은 기록이 와도 재지 않는다(계약 ⑤ 그대로 — 같은 실패를 두 번 세지 않는다).
    const 실패 = 팀원판정(리포트행, { out: "", err: "HTTP 500", ms: 90, 두뇌기록: [항목()] }, 배정);
    expect(실패.기록.기록으로잼).toBe(false);
    expect(두뇌말(실패.기록)).toBe("실패(오류)");
  });

  it("★ 지연 잣대는 **안 바꾼다** — 왕복ms는 적기만 하고 벌주지 않는다", () => {
    // 상한 숫자(로컬 10초·원격 30초)는 요청 왕복으로 정한 값이다. 다른 자로 잰 숫자를 같은
    // 문턱에 대면 그 자체가 「무엇을 쟀는지 모르는 숫자」가 된다(계약 ⑦ ⚠).
    const 판 = 팀원판정(리포트행, { 팀원: "report", ms: 95000, 두뇌기록: [항목({ 왕복ms: 90000 })] }, 배정);
    expect(판.불편.map((x: { 종류: string }) => x.종류), "기록 갈래에 새 지연 잣대가 생겼다").not.toContain("두뇌 느림");
    expect(판.기록.상한, "표식이 안 남는 줄에 상한이 걸렸다").toBeNull();
    expect(판.기록.지연잼).toBe(false);
    expect(판.기록.왕복ms).toBe(90000);
  });

  it("★ 고르는 규칙 — 「담당자가 읽는 답」이 먼저, 개수와 잘림도 함께 적는다", () => {
    const 기록 = [
      항목({ agentId: "orchestrator", location: "local", model: "분류기-14b", 사람이읽는답: false }),
      항목({ agentId: "orchestrator", location: "local", model: "결정용-14b", 결정호출: true, 사람이읽는답: false }),
      항목({ agentId: "orchestrator", location: "local", model: "qwen3-14b", 사람이읽는답: true, 생략: 2 }),
    ];
    const 고른것 = 두뇌기록고르기(기록, "orchestrator");
    expect(고른것.항목.model, "첫 것을 골랐다 — 분류기가 답한 두뇌 행세를 한다(서버 brain과 어긋난다)").toBe("qwen3-14b");
    expect(고른것.개수, "몇 번 돌았는지 안 세면 「어느 호출인지 모른 채 쟀다」가 된다").toBe(3);
    expect(고른것.사람답).toBe(true);
    expect(고른것.생략, "서버가 잘라 버린 사실을 안 옮겼다").toBe(2);

    // 「담당자가 읽는 답」이 하나도 없으면 첫 것(리포트·위협 갈래가 그렇다).
    const 답없음 = 두뇌기록고르기([항목({ 왕복ms: 1 }), 항목({ 왕복ms: 2 })], "report");
    expect(답없음.항목.왕복ms).toBe(1);
    expect(답없음.사람답).toBe(false);
    expect(두뇌기록고르기([], "report"), "빈 배열에서 무언가를 골랐다").toBeNull();
    expect(두뇌기록고르기(undefined, "report"), "옛 서버(칸 없음)에서 무언가를 골랐다").toBeNull();
  });

  it("★★ 표가 「원격을 못 봤다」를 더는 거짓으로 적지 않는다 — 본 회차는 본 대로 적는다", () => {
    const 회차 = [
      { q: 리포트행.q, 불편: [], 팀원기록: 팀원판정(리포트행, { 팀원: "report", ms: 21000, 두뇌기록: [항목()] }, 배정).기록 },
      { q: 위협행.q, 불편: [], 팀원기록: 팀원판정(위협행, { 도구: ["threats"], ms: 8000, 두뇌기록: [항목({ agentId: "ti", 왕복ms: 5000 })] }, 배정).기록 },
    ];
    const md = 팀원표(회차, 배정).join("\n");
    expect(md).toContain("원격(기록) 1");
    expect(md, "원격 배정 둘을 다 봤는데 「확인 가능 0명」이라 적었다").toContain("원격 배정 2명 중 확인 가능 2명");
    expect(md, "기록으로 본 문항 수를 안 적는다").toContain("팀원별 기록으로 확인한 문항 2건");
    expect(md, "눈으로 본 회차에 「0건입니다」라는 거짓 경고가 찍혔다").not.toContain("원격 두뇌를 눈으로 확인한 문항은 0건입니다");
    expect(md, "기록이 실린 회차에 「M2 미반영」이 찍혔다").not.toContain("M2 미반영");
    // 팀원 두뇌의 제 시간은 **요청 왕복과 다른 자**라 괄호로 갈라 적는다.
    expect(md).toContain("(두뇌 19.0s)");
    // 이 회차의 둘은 다 봤으므로 「못 재는 팀원」 줄 자체가 없다 — 없는 한계를 지어내지 않는다.
    expect(md, "다 본 회차에 「못 재는 팀원」이 남았다").not.toContain("못 재는 팀원:");
  });

  it("하네스가 그 칸을 받아 적는다 — 서버가 실어 줘도 기록에 안 남으면 없는 것과 같다", () => {
    expect(읽기(join("tools", "ops-sim.mjs")), "두뇌기록을 안 받아 적는다").toContain("두뇌기록: j.두뇌기록,");
  });
});

// ── ⑦ 실패한 줄 — 분모에 남는다 ───────────────────────────────────────────────────
describe("⑲ 실패한 줄(오류·빈 답)도 분모에 남는다", () => {
  it("실패 잣대는 한 곳이다 — 답 본문이 아예 없는 가짜 그릇은 실패가 아니다", () => {
    expect(실패이유({ out: "", err: "HTTP 500", ms: 12 })).toBe("오류");
    expect(실패이유({ out: "   ", ms: 12 })).toBe("빈 답");
    expect(실패이유({ out: "답이 있다", ms: 12 })).toBeNull();
    // 판정식만 재는 가짜 답(out 칸이 없다)을 「빈 답」으로 세면 짝 시험이 통째로 딴것을 잰다.
    expect(실패이유({ 팀원: "report", ms: 12 })).toBeNull();
    expect(실패이유(null)).toBeNull();
  });

  it("★ 실패해도 기록은 남고, 도착·두뇌는 재지 않는다 — 같은 실패를 두 번 세지 않는다", () => {
    const 판 = 팀원판정(리포트행, { out: "", err: "HTTP 500", ms: 120 }, 배정);
    expect(판.불편, "하네스가 이미 「오류」로 셌는데 ⑲가 「다른 팀원에게 감」을 또 붙였다").toEqual([]);
    expect(판.기록, "실패 줄에 기록이 없으면 팀원표에서 통째로 빠져 분모가 줄어든다").toBeTruthy();
    expect(판.기록.실패).toBe("오류");
    expect(판.기록.도착맞음).toBe(false);
    expect(판.기록.상한).toBeNull();
    expect(두뇌말(판.기록)).toBe("실패(오류)");
    expect(팀원판정(위협행, { out: "" }, 배정).기록.실패).toBe("빈 답");
  });

  it("★ 실패가 섞인 회차는 분모가 안 줄어든다 — 살아남은 것만으로 100%가 되면 거짓 초록이다", () => {
    const 회차 = [
      { q: 리포트행.q, 불편: [], 팀원기록: 팀원판정(리포트행, { out: "잘 나온 답", 팀원: "report", ms: 12000, 두뇌: { location: "remote" } }, 배정).기록 },
      { q: "경영진 보고서 만들어줘", 불편: [{ 종류: "오류" }], 팀원기록: 팀원판정(팀원기대["경영진 보고서 만들어줘"], { out: "", err: "HTTP 500", ms: 90 }, 배정).기록 },
      { q: "주간 보안 리포트 만들어줘", 불편: [{ 종류: "빈 답" }], 팀원기록: 팀원판정(팀원기대["주간 보안 리포트 만들어줘"], { out: "" }, 배정).기록 },
    ];
    const md = 팀원표(회차, 배정).join("\n");
    expect(md).toContain("| 3 | 1/3 |");            // 분모가 3 그대로 — 1/1이 아니다
    expect(md).toContain("실패(오류) 1");
    expect(md).toContain("실패(빈 답) 1");
    expect(md).toContain("· 실패 2");
    expect(md).toContain("분모에 남겨 둡니다");
  });
});

// ── ⑤ 보고서 표 ───────────────────────────────────────────────────────────────────
describe("⑲ 보고서 팀원별 표", () => {
  const 회차 = [
    { q: 리포트행.q, 불편: [], 팀원기록: 팀원판정(리포트행, { 팀원: "report", ms: 21000, 두뇌: { location: "remote", model: "flash-next" } }, 배정).기록 },
    { q: 위협행.q, 불편: [{ 종류: "다른 팀원에게 감" }], 팀원기록: 팀원판정(위협행, { 도구: ["threats"], ms: 41000 }, 배정).기록 },
    { q: 사서행.q, 불편: [], 팀원기록: 팀원판정(사서행, { 도구: ["knowledge_status"], ms: 1200 }, 배정).기록 },
    { q: 총괄행.q, 불편: [], 팀원기록: 팀원판정(총괄행, { 도구: ["explain"], ms: 4000, 두뇌: { location: "local", model: "qwen3-14b" } }, 배정).기록 },
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
    expect(md).toContain("10s(잰 1)");   // 총괄(로컬) 상한 — **몇 번 쟀는지까지** 적는다
    expect(md).toContain("| - |");       // 표식이 안 남는 갈래는 상한을 안 건다
    expect(md).not.toContain("이건 ⑲가 아니다");
    // 합계 줄 — 「도착 맞음」·「두뇌가 도는 문항」·「조건부」는 서로 다른 수다.
    expect(md).toMatch(/합계: 문항 4\/27 · 도착 맞음 4 · 이 요청에서 두뇌가 도는 문항 3\(그중 조건부 1/);
    // 일부만 돈 회차라는 사실을 숨기지 않는다.
    expect(md).toContain("27문항 중 **4개만**");
  });

  it("★ 표식 안 남는 줄만 있는 회차는 「M2 미반영」이라 하지 않는다 — 없는 결함을 만들지 않는다", () => {
    const 안남회차 = 팀원문항
      .filter((r) => r.표식남나 === false && r.신호.종류 !== "단계")
      .map((r) => ({ q: r.q, 불편: [], 팀원기록: 팀원판정(r, { 도구: [r.신호.값], 팀원: r.신호.값, ms: 3000 }, 배정).기록 }));
    const md = 팀원표(안남회차, 배정).join("\n");
    expect(md, "표식이 원리상 없는 회차에 「M2 미반영」이 찍혔다 — 매일 밤 나가는 거짓 진단이다").not.toContain("M2 미반영");
    expect(md).toContain("돎(표식 안 남는 갈래)");
    // 그래도 **표식이 남는 갈래**(총괄)가 섞여 있고 그 줄에 표식이 없으면 그때는 밝힌다.
    const 섞임 = [...안남회차, { q: 총괄행.q, 불편: [], 팀원기록: 팀원판정(총괄행, { 도구: ["explain"], ms: 9000 }, 배정).기록 }];
    expect(팀원표(섞임, 배정).join("\n")).toContain("M2 미반영");
  });

  // ★ 검토관 적발 ② — 「원격 배정 팀원의 두뇌를 실제로는 한 번도 못 본다」를 표가 스스로 말해야 한다.
  it("★ 표가 「어디까지 증명했는지」를 밝힌다 — 못 재는 팀원과 그 이유를 적는다", () => {
    const md = 팀원표(회차, 배정).join("\n");
    // ⚠ 2026-09-10 둘째 판에서 문구가 늘었다 — 이제 **표식이 아닌 길**(팀원별 기록)로도 확인한다.
    expect(md).toContain("두뇌 위치를 **표식·기록으로 확인할 수 있는 팀원");
    expect(md, "기록으로 몇 건을 봤는지 안 적는다 — 0건인 회차와 구별이 안 된다").toContain("팀원별 기록으로 확인한 문항 0건");
    expect(md).toContain("원격 배정 2명 중 확인 가능 0명");   // report·ti 둘 다 표식이 안 남는 갈래다
    expect(md).toContain("못 재는 팀원:");
    expect(md).toContain("report(표식 안 남는 갈래 1)");
    expect(md).toContain("ti(표식 안 남는 갈래 1)");
    expect(md).toContain("curator(문만 1)");
    expect(md).toContain("전부 증명되지 않습니다");
    // ★★ 원격을 한 번도 못 본 회차는 그 사실을 **크게** 적는다 — 초록을 증명으로 읽으면 안 된다.
    expect(md).toContain("원격 두뇌를 눈으로 확인한 문항은 0건입니다");
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
    // 표식이 **남아야 하는** 갈래(총괄)에 표식이 없을 때만 그렇게 적는다.
    const md = 팀원표(
      [{ q: 총괄행.q, 불편: [], 팀원기록: 팀원판정(총괄행, { 도구: ["explain"], ms: 9000 }, 배정).기록 }],
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
  const 하네스 = 읽기(join("tools", "ops-sim.mjs"));

  it("ops-sim.mjs가 opssim-team.mjs에서 문항·판정·표를 불러 쓴다", () => {
    expect(하네스).toContain('from "./opssim-team.mjs"');
    for (const 이름 of ["팀원문항", "팀원기대", "팀원판정", "팀원표", "배정표스냅샷", "실패이유"]) {
      expect(하네스, `${이름}을 안 불러 쓴다 — 사본을 만들었다면 두 곳이 어긋난다`).toContain(이름);
    }
    // 마당은 문항표에서 만든다(물음을 손으로 다시 적으면 열쇠가 갈린다).
    expect(하네스).toContain("물음: 팀원문항.map((행) => 행.q)");
    // 배정표는 **회차마다** 읽는다 — 숫자를 박아 두지 않는다.
    expect(하네스).toContain('BASE + "/api/agents"');
    expect(하네스).toContain("팀원배정: 배정표"); // meta.json 스냅샷
  });

  // ★ 검토관 적발 ④ — ⑲ 배선이 조기 반환 **뒤**에 있으면 실패한 줄이 표에서 통째로 빠진다.
  it("★ ⑲ 배선이 오류·빈 답 조기 반환 밖에 있다 — 안에 있으면 실패 줄이 분모에서 사라진다", () => {
    const 시작 = 하네스.indexOf("function 불편찾기(q, r)");
    const 끝 = 하네스.indexOf("function 불편본체(q, r)");
    expect(시작, "불편찾기를 못 찾았다 — 이 감시가 낡았다").toBeGreaterThan(0);
    expect(끝, "불편본체가 없다 — ⑲ 배선이 다시 조기 반환 안으로 들어갔는지 확인할 것").toBeGreaterThan(시작);
    const 겉 = 하네스.slice(시작, 끝);
    expect(겉).toContain("팀원판정(팀원행, r, 배정표");
    expect(겉, "겉껍질에 조기 반환이 들어왔다 — 실패 줄이 다시 ⑲를 못 거친다").not.toContain("return [{ 종류:");
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
