// ✂ 인용 제거 **사유**를 한 곳에서 세는가 — 승인 시안 mockups/cite-reasons §⑧의 짝 시험
// (2026-09-06 · 계획서 **전-4 정직한 구현**).
//
// ■ 무엇을 지키나
//   감독 화면(supervision.html)의 ✂ 줄이 「답 N개」만 말하던 것을 「왜 뗐는지」까지 편다.
//   그 순간 **같은 것을 세는 자리가 둘이 될 위험**이 생긴다 — 실시간 한 줄(detail 문장)과
//   감독 표(cite_reason_daily). 두 벌이면 반드시 갈라진다(이 저장소가 반복해 덴 자리).
//   그래서 셈은 `citeguard.사유별집계()` **하나**로 모았고, 이 파일이 그것을 값과 소스로 지킨다.
//
// ■ 시안 §⑧의 네 가지 + 소스 감시
//   ① 문장과 표가 안 갈린다 — 뗀인용요약()이 만든 **글자**와 사유별집계()의 **숫자**가 같다.
//   ② 두 잣대가 안 섞인다 — 답 개수(calls=1)와 사유 건수(합=3)가 서로 안 물든다.
//   ③ 「못 뗌」을 뗀 걸로 안 센다 — 화면 배지 N에서 빠진다.
//   ④ 내부 경로만 뗀 답도 사유가 있다 — 사유가 텅 빈 ✂ 답이 없다.
//   ⑤ 소스 감시 — 두 emit 자리·트랜잭션·날짜 계산.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 사유별집계, 뗀인용요약, 못뗌사유, guardCitations, 자료없음안내, type 뗀인용 } from "../src/engine/citeguard";
import { 메타줄걷기 } from "../src/engine/metaleak";
import { 가드사유 } from "../src/engine/llm";
import { emitLlmActivity, citeReasonsDaily, activityDaily, resetLlmActivityForTests } from "../src/engine/llmactivity";

const 엔진 = path.join(__dirname, "../src/engine");
const 페이지 = path.join(__dirname, "../../client/src/renderer/pages");
const citeguardSrc = fs.readFileSync(path.join(엔진, "citeguard.ts"), "utf8");
const llmSrc = fs.readFileSync(path.join(엔진, "llm.ts"), "utf8");
const cloudSrc = fs.readFileSync(path.join(엔진, "cloudllm.ts"), "utf8");
const activitySrc = fs.readFileSync(path.join(엔진, "llmactivity.ts"), "utf8");
const supSrc = fs.readFileSync(path.join(페이지, "supervision.html"), "utf8");

function 뗀것(kind: 뗀인용["kind"]): 뗀인용 {
  return { kind, quote: "", reason: `${kind} 시험용` };
}

/* ═══ 화면의 순수 함수를 **소스에서 그대로 떼어** 온다 ═══════════════════════════════
 * 셈을 시험에 베껴 적으면 제품과 시험이 따로 늙는다(dimestimates-scope.test와 같은 판단).
 * supervision.html은 인라인 <script>라 모듈로 못 부르므로 함수 하나만 떼어 실행한다.
 * ⚠ 못 떼면 **거짓 통과**하므로 아래 첫 시험이 떼어 왔는지부터 본다(헛돎 방지). */
const 떼어낸 = supSrc.match(/\r?\n {2}function 사유줄계산\(rows\) \{[\s\S]*?\r?\n {2}\}\r?\n/);
type 사유줄 = { 항목: { reason: string; count: number; 못뗌: boolean }[]; 배지: number; 못뗌: number };
const 사유줄계산: ((rows: unknown) => 사유줄) | null =
  떼어낸 ? (new Function("return " + 떼어낸[0].trim())() as (rows: unknown) => 사유줄) : null;

describe("✂ 사유 — 세는 곳은 하나다 (전-4 · 시안 mockups/cite-reasons §⑧)", () => {
  it("헛돎 방지 — supervision.html에서 사유줄계산()을 실제로 떼어 왔다", () => {
    expect(떼어낸, "supervision.html에서 사유줄계산()을 못 떼어 왔다(이름·들여쓰기가 바뀌었나)").not.toBeNull();
    expect(typeof 사유줄계산).toBe("function");
  });

  // ── ① 문장과 표가 갈리지 않는다 — **가장 중요한 시험**(두 벌 세기의 유일한 자물쇠) ──
  it("① 사유별집계의 합 = removed.length이고, 뗀인용요약() 문장의 숫자와 글자로 일치한다", () => {
    const removed = [뗀것("겹침없음"), 뗀것("겹침없음"), 뗀것("범위밖"), 뗀것("출처미확인"), 뗀것("겹침없음")];
    const 집계 = 사유별집계(removed);
    const 합 = Object.values(집계).reduce((s, v) => s + v, 0);
    expect(합, "사유 합이 뗀 건수와 다르다").toBe(removed.length);
    expect(집계).toEqual({ 겹침없음: 3, 범위밖: 1, 출처미확인: 1 });

    // 문장에서 **글자로** 뽑아 대조한다 — 문장이 다른 셈에서 나오면 여기서 갈라진다.
    const 문장 = 뗀인용요약(removed);
    expect(문장.startsWith(`근거 없는 인용 ${removed.length}건 제거 — `), `문장이 예상 꼴이 아니다: ${문장}`).toBe(true);
    const 문장집계: Record<string, number> = {};
    for (const 조각 of 문장.split(" — ")[1].split(" · ")) {
      const m = 조각.match(/^(.+) (\d+)$/);
      expect(m, `사유 조각을 못 읽었다: ${조각}`).not.toBeNull();
      문장집계[m![1]] = Number(m![2]);
    }
    expect(문장집계, "문장과 표가 갈렸다").toEqual(집계);
  });

  it("① 보류는 「못 뗌」으로 센다 — 이름은 상수 하나에서 나온다", () => {
    const 집계 = 사유별집계([뗀것("겹침없음")], [뗀것("통째교체")]);
    expect(집계).toEqual({ 겹침없음: 1, [못뗌사유]: 1 });
    expect(못뗌사유).toBe("못 뗌");
  });

  it("★ ①의 자물쇠 — 뗀인용요약()이 **자기 안에서 따로 세지 않고** 사유별집계()를 부른다", () => {
    // 값만 보면 셈을 두 벌 적어도 통과한다(같은 답이 나오니까). 그 날이 오면 갈라진다 —
    // 그래서 「부르는가」를 소스로 못박는다(반증: 이 호출을 되돌리면 이 줄이 빨개진다).
    const 몸통 = citeguardSrc.match(/export function 뗀인용요약\([\s\S]*?\n\}/);
    expect(몸통, "뗀인용요약()을 못 찾았다").not.toBeNull();
    expect(몸통![0], "뗀인용요약()이 사유별집계()를 안 부른다 — 셈이 두 벌이 됐다").toContain("사유별집계(");
    expect(몸통![0], "뗀인용요약() 안에서 다시 세고 있다").not.toMatch(/for \(const r of removed\)/);
  });

  // ── ② 답 개수와 사유 건수는 다른 잣대다 ──────────────────────────────────────────
  it("② emit 한 번 — 답은 1, 사유 합은 3. 두 숫자가 서로 안 물든다", () => {
    resetLlmActivityForTests();
    const 팀원 = "시험-사유-②";
    emitLlmActivity({ kind: "cite", phase: "done", agent: 팀원, citeReasons: { 겹침없음: 2, 범위밖: 1 } });

    const 답 = activityDaily(1).filter((d) => d.agent === 팀원 && d.kind === "cite");
    expect(답.length, "kind=cite 집계가 한 줄이 아니다").toBe(1);
    expect(답[0].calls, "답 개수가 1이 아니다(건수에 물들었다)").toBe(1);

    const 사유 = citeReasonsDaily(1).filter((r) => r.agent === 팀원);
    const 합 = 사유.reduce((s, r) => s + r.count, 0);
    expect(합, "사유 건수 합이 3이 아니다(답 개수에 물들었다)").toBe(3);
    expect(사유.find((r) => r.reason === "겹침없음")?.count).toBe(2);
    expect(사유.find((r) => r.reason === "범위밖")?.count).toBe(1);
  });

  it("② 같은 사유가 두 번 오면 **누적**된다 — 하루치가 덮어써지지 않는다", () => {
    const 팀원 = "시험-사유-누적";
    emitLlmActivity({ kind: "cite", phase: "done", agent: 팀원, citeReasons: { 겹침없음: 2 } });
    emitLlmActivity({ kind: "cite", phase: "done", agent: 팀원, citeReasons: { 겹침없음: 1, 자기인용: 1 } });
    const 사유 = citeReasonsDaily(1).filter((r) => r.agent === 팀원);
    expect(사유.find((r) => r.reason === "겹침없음")?.count).toBe(3);
    expect(사유.find((r) => r.reason === "자기인용")?.count).toBe(1);
    expect(activityDaily(1).filter((d) => d.agent === 팀원 && d.kind === "cite")[0].calls).toBe(2);
  });

  it("② citeReasons가 없는 이벤트는 사유 표를 건드리지 않는다 — 다른 kind가 안 샌다", () => {
    const 팀원 = "시험-사유-무관";
    emitLlmActivity({ kind: "chat", phase: "done", agent: 팀원, latencyMs: 10 });
    expect(citeReasonsDaily(1).filter((r) => r.agent === 팀원).length).toBe(0);
  });

  // ── ③ 「못 뗌」을 뗀 걸로 안 센다 ────────────────────────────────────────────────
  it("③ 못 뗌만 있으면 화면 배지 N=0이고, 표에는 「못 뗌 1」이 남는다", () => {
    const 팀원 = "시험-사유-③";
    emitLlmActivity({ kind: "cite", phase: "done", agent: 팀원, citeReasons: { [못뗌사유]: 1 } });
    const 사유 = citeReasonsDaily(1).filter((r) => r.agent === 팀원);
    expect(사유, "표에서 못 뗌이 사라졌다").toEqual([expect.objectContaining({ reason: 못뗌사유, count: 1 })]);

    // 화면 쪽 — supervision.html의 순수 함수를 그대로 불러 잰다(셈을 베끼지 않는다).
    const 줄 = 사유줄계산!(사유.map((r) => ({ agent: r.agent, reason: r.reason, count: r.count })));
    expect(줄.배지, "못 뗌을 뗀 건수로 셌다(없던 제거를 있다고 세는 거짓 계수)").toBe(0);
    expect(줄.못뗌, "못 뗌 신호가 사라졌다").toBe(1);
    expect(줄.항목, "표에서까지 못 뗌이 빠졌다 — 접어서 가리면 안 된다")
      .toEqual([{ reason: 못뗌사유, count: 1, 못뗌: true, 안셈: true }]);
  });

  it("③ 배지는 못 뗌만 빼고 더한다 · 0인 사유는 버리고 · 큰 순으로 준다", () => {
    const 줄 = 사유줄계산!([
      { agent: "a", reason: "겹침없음", count: 2 },
      { agent: "b", reason: "겹침없음", count: 1 }, // (날짜 × 팀원)으로 갈려 온 같은 사유 — 합산해야 한다
      { agent: "a", reason: "출처미확인", count: 2 },
      { agent: "a", reason: "범위밖", count: 1 },
      { agent: "a", reason: 못뗌사유, count: 1 },
      { agent: "a", reason: "자기인용", count: 0 }, // 0은 소음이다 — 버린다
    ]);
    expect(줄.배지, "시안 ②의 hot 판(사유 5건)과 값이 다르다").toBe(6);
    expect(줄.항목.map((x) => x.reason)).toEqual(["겹침없음", "출처미확인", "범위밖", 못뗌사유]);
    expect(줄.항목[0]).toEqual({ reason: "겹침없음", count: 3, 못뗌: false, 안셈: false });
    expect(줄.항목[3].못뗌, "그리는 쪽이 이름을 다시 적지 않도록 표시를 함께 준다").toBe(true);
    expect(줄.못뗌).toBe(1);
  });

  it("③ 사유가 하나도 없으면 빈 줄을 준다 — 눌러도 빈 상자가 나오는 조작은 안 만든다", () => {
    const 빈것 = { 항목: [], 배지: 0, 못뗌: 0, 통째: 0, 경로: 0, 인용: 0 };
    expect(사유줄계산!([])).toEqual(빈것);
    expect(사유줄계산!(null)).toEqual(빈것);
  });

  // ── ④ 사유가 텅 빈 ✂ 답이 없다 ──────────────────────────────────────────────────
  it("④ 인용 removed 0 + 메타줄걷기만 운 답 → 사유 「내부 경로 1」이 실린다", () => {
    const 답 = "요약입니다.\n출처 파일: models/qwen3-14b/qwen3-14b.gguf";
    const 경로가드 = 메타줄걷기(답);
    expect(경로가드.뗀줄수, "메타줄걷기가 안 돌았다 — 이 시험이 헛돈다").toBe(1);
    expect(경로가드.경로.length, "진짜 경로를 못 잡았다").toBeGreaterThan(0);

    const { 사유, 경로이름 } = 가드사유({ text: 경로가드.text, removed: [], 보류: [] }, 경로가드);
    expect(경로이름).toBe("내부 경로");
    expect(사유, "사유가 텅 빈 ✂ 답이 생겼다").toEqual({ "내부 경로": 1 });
    expect(Object.values(사유).reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
  });

  it("④ 라벨만 뗐으면 「내부 메타」다 — 없는 경로를 있다고 세지 않는다", () => {
    const 답 = "요약입니다.\n교사 모델: 27B 계열";
    const 경로가드 = 메타줄걷기(답);
    expect(경로가드.뗀줄수).toBe(1);
    expect(경로가드.경로.length).toBe(0);
    const { 사유, 경로이름 } = 가드사유({ text: 경로가드.text, removed: [], 보류: [] }, 경로가드);
    expect(경로이름).toBe("내부 메타");
    expect(사유).toEqual({ "내부 메타": 1 });
  });

  it("④ 통째메타는 **못 뗌**으로 센다 — 0줄로 조용히 지나가지 않는다", () => {
    const 답 = "교사 모델: 27B 계열";
    const 경로가드 = 메타줄걷기(답);
    expect(경로가드.통째메타, "통째메타 신호가 안 섰다").toBe(true);
    expect(경로가드.뗀줄수, "통째메타는 원문을 그대로 두므로 뗀줄수는 0이라야 정직하다").toBe(0);
    const { 사유 } = 가드사유({ text: 답, removed: [], 보류: [] }, 경로가드);
    expect(사유).toEqual({ [못뗌사유]: 1 });
  });

  it("④ 인용과 경로가 함께 뗀 답은 두 몫이 **한 Record에** 합쳐진다", () => {
    const 답 = "요약입니다.\n출처 파일: models/qwen3-14b/qwen3-14b.gguf";
    const { 사유 } = 가드사유({ text: 답, removed: [뗀것("겹침없음"), 뗀것("범위밖")], 보류: [] }, 메타줄걷기(답));
    expect(사유).toEqual({ 겹침없음: 1, 범위밖: 1, "내부 경로": 1 });
  });

  // ── ⑤ 소스 감시 — 한쪽이 빠지면 조용히 반쪽이 된다 ─────────────────────────────
  it("⑤ kind:\"cite\" emit **두 자리 모두** citeReasons를 넘긴다(로컬·클라우드)", () => {
    for (const [이름, src] of [["llm.ts", llmSrc], ["cloudllm.ts", cloudSrc]] as const) {
      const 자리 = [...src.matchAll(/emitLlmActivity\(\{[\s\S]{0,600}?\}\)/g)]
        .map((m) => m[0]).filter((b) => /kind: *"cite"/.test(b));
      expect(자리.length, `${이름}에서 kind="cite" emit을 못 찾았다 — 이 감시가 헛돈다`).toBeGreaterThan(0);
      for (const b of 자리) {
        expect(b, `${이름}의 ✂ emit이 citeReasons를 안 넘긴다 — 그 경로만 사유가 빈다`).toMatch(/citeReasons/);
      }
    }
  });

  it("⑤ 두 표는 **같은 트랜잭션**으로 쓴다 — 반쪽만 남는 자리가 없다", () => {
    const 트랜 = activitySrc.match(/const 집계쓰기 = db\.transaction\([\s\S]*?\n\}\);/);
    expect(트랜, "집계쓰기 트랜잭션을 못 찾았다").not.toBeNull();
    expect(트랜![0], "답 개수 upsert가 트랜잭션 밖이다").toContain("dailyUpsert.run(");
    expect(트랜![0], "사유 upsert가 트랜잭션 밖이다").toContain("citeReasonUpsert.run(");
    // emit은 두 upsert를 직접 부르지 않고 트랜잭션만 부른다.
    const emit본 = activitySrc.match(/export function emitLlmActivity\([\s\S]*?\n\}/);
    expect(emit본, "emitLlmActivity를 못 찾았다").not.toBeNull();
    expect(emit본![0]).toContain("집계쓰기(");
    expect(emit본![0], "emit이 트랜잭션을 건너뛰고 직접 쓴다").not.toContain("dailyUpsert.run(");
  });

  it("⑤ citeReasonsDaily는 activityDaily와 **같은 날짜 계산**(todayLocal)을 쓴다", () => {
    // UTC로 재면 0~9시에 하루가 밀려 **답 개수와 사유가 다른 날을 가리킨다**(중6과 같은 함정).
    const 몸통 = activitySrc.match(/export function citeReasonsDaily\([\s\S]*?\n\}/);
    expect(몸통, "citeReasonsDaily를 못 찾았다").not.toBeNull();
    expect(몸통![0], "로컬 달력을 안 쓴다").toContain("todayLocal(");
    expect(몸통![0], "UTC 계산(toISOString)이 섞였다").not.toContain("toISOString");
    // 값으로도 본다 — 오늘 넣은 사유가 오늘 조회에 나온다.
    const 팀원 = "시험-사유-날짜";
    emitLlmActivity({ kind: "cite", phase: "done", agent: 팀원, citeReasons: { 블록없음: 1 } });
    expect(citeReasonsDaily(1).some((r) => r.agent === 팀원), "오늘 넣은 사유가 오늘 조회에 없다").toBe(true);
  });

  it("⑤ 화면은 **새 API를 안 만든다** — 감독 창구 하나의 응답 칸으로 온다", () => {
    expect(activitySrc, "/api/aiteam/supervision 응답에 citeReasons 칸이 없다")
      .toMatch(/citeReasons: citeReasonsDaily\(days\)/);
    expect(supSrc, "화면이 사유를 다른 창구에서 읽고 있다").toContain("사유줄계산(sup.citeReasons)");
  });

  it("⑤ 화면의 펼침 기억은 fold.js 이름 공간을 안 쓴다(try/catch 필수)", () => {
    expect(supSrc).toContain('"gijo:cite-reasons-open"');
    expect(supSrc, "fold.js가 관리하는 구역이 아닌데 그 이름 공간에 끼었다").not.toMatch(/gijo:fold:[^"]*cite/);
    const 읽기 = supSrc.match(/function 펼침읽기\(\)[^\n]*/);
    const 쓰기 = supSrc.match(/function 펼침쓰기\([^\n]*/);
    expect(읽기, "펼침읽기()를 못 찾았다").not.toBeNull();
    expect(읽기![0], "저장 차단(사생활 모드)에서 화면이 통째로 죽는다").toContain("catch");
    expect(쓰기![0], "쓰기가 감싸이지 않았다 — 저장 차단에서 클릭이 죽는다").toContain("catch");
  });
});

/* ═══ 2026-09-06 검토관 수리분 — 「센 것」과 「일어난 일」을 가른다 ═══════════════════
 * 검토관 count 갈래 실측: 인용이 **한 개뿐인** 답이 「근거 없는 인용 2건 제거」로 나갔다.
 * ⑥ 통째 교체는 인용을 뗀 자리가 아니라 **다 떼고 나서 답 전체를 안내로 바꾼 결과**인데,
 * removed 배열에 한 건 더 얹혀 문장·화면 배지·cite_reason_daily(영속 지표)까지 +1 됐다.
 * 조각이 0건이면 그 자리까지 가지도 않으므로(citeguard.ts `if (!조각들.length) return 없음;`)
 * **언제나 결정적으로 +1**이다. 그래서 「일어난 일」을 removed에서 빼고 따로 싣는다.
 */
describe("✂ 통째교체는 뗀 인용이 아니다 (검토관 2026-09-06 · count)", () => {
  // 3번째 인자(통째교체)를 넣기 전 상태에서도 이 파일이 컴파일되도록 자리를 넓혀 잡는다.
  const 요약 = 뗀인용요약 as (r: 뗀인용[], b?: 뗀인용[], t?: boolean) => string;
  const 집계 = 사유별집계 as (r: 뗀인용[], b?: 뗀인용[], t?: boolean) => Record<string, number>;
  type 결과 = ReturnType<typeof guardCitations> & { 통째교체?: boolean };

  it("★ 인용 1개짜리 답을 「2건 제거」라 하지 않는다 — 결정적 +1 과대계상", () => {
    const r = guardCitations('[1] "존재하지 않는 근거 문장입니다"', []) as 결과;
    expect(r.text, "이 시험이 헛돈다 — 통째교체까지 안 갔다").toBe(자료없음안내);
    expect(r.removed.length, "뗀 인용은 1건인데 배열에 한 건이 더 얹혔다").toBe(1);
    expect(r.통째교체, "「답 전체를 바꿨다」를 실을 자리가 없다").toBe(true);
    expect(요약(r.removed, r.보류, r.통째교체), "문장이 없는 인용을 있다고 센다")
      .toContain("근거 없는 인용 1건 제거");
  });

  it("★ 그래도 「답을 통째로 바꿨다」는 사라지지 않는다 — 사유 표와 문장에 남는다", () => {
    const r = guardCitations('[1] "존재하지 않는 근거 문장입니다"', []) as 결과;
    expect(집계(r.removed, r.보류, r.통째교체), "통째교체 신호가 표에서 사라졌다")
      .toEqual({ 블록없음: 1, 통째교체: 1 });
    expect(요약(r.removed, r.보류, r.통째교체)).toContain("통째");
  });

  it("★ 화면 배지 N에서도 빠진다 — 뗀 자리의 수가 아니라 그 답에 일어난 일이다", () => {
    const 줄 = 사유줄계산!([
      { agent: "a", reason: "겹침없음", count: 1 },
      { agent: "a", reason: "통째교체", count: 1 },
    ]);
    expect(줄.배지, "「사유 2건」이라 적으면 인용 1건짜리 답이 2건으로 보인다").toBe(1);
    expect(줄.항목.map((x) => x.reason), "표에서까지 지우면 안 된다 — 맨 뒤로만 민다")
      .toEqual(["겹침없음", "통째교체"]);
  });
});

/* ═══ 2026-09-06 검토관 수리분 — 사유를 **조용히 버리지** 않는다 ═══════════════════
 * 집계쓰기()가 kind를 안 봐서, citeReasons가 kind≠cite(또는 phase=error) 이벤트에 실리면
 * cite_reason_daily에는 쌓이는데 화면의 「뗀 답」(kind=cite의 calls)은 안 늘었다.
 * 그러면 화면은 사유를 가진 채 「0개 — 이 기간에 뗀 인용이 없습니다」라고 말한다
 * (`if (뗀답 && 사유.항목.length)`가 거짓이라 사유가 흔적 없이 사라진다).
 * 타입 주석은 「kind="cite"에서만 쓴다」고 약속하는데 코드가 그것을 안 지켰다.
 */
describe("✂ 사유는 kind=cite·done에서만 쌓인다 (검토관 2026-09-06 · wiring)", () => {
  it("kind가 cite가 아니면 사유를 쌓지 않는다 — 반쪽 기록을 만들지 않는다", () => {
    const 팀원 = "시험-사유-딴kind";
    emitLlmActivity({ kind: "chat", phase: "done", agent: 팀원, citeReasons: { 겹침없음: 2 } });
    expect(citeReasonsDaily(1).filter((r) => r.agent === 팀원),
      "답 개수는 kind=cite로만 세는데 사유만 남아 화면이 그것을 통째로 버린다").toEqual([]);
  });

  it("오류로 끝난 cite 이벤트도 안 쌓는다 — 답 개수(calls)가 안 늘기 때문이다", () => {
    const 팀원 = "시험-사유-오류";
    emitLlmActivity({ kind: "cite", phase: "error", agent: 팀원, citeReasons: { 겹침없음: 1 } });
    expect(citeReasonsDaily(1).filter((r) => r.agent === 팀원)).toEqual([]);
    expect(activityDaily(1).filter((d) => d.agent === 팀원 && d.kind === "cite")[0]?.calls ?? 0,
      "이 시험이 헛돈다 — 오류 이벤트인데 답 개수가 늘었다").toBe(0);
  });
});
