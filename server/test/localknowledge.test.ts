// 관문 ⑭ — **로컬 14B 단독**(원격 없음 · 근거 없음)에서 아는 것을 잃지 않았는가.
//
// ■ 왜 생겼나 (2026-09-10 · 계획서 §12.12)
//   회전 5의 목적이 「원격(gb10) 없는 설치본의 14B 바닥 올리기」로 바뀌었다. 그런데 관문 ①~⑬은
//   전부 **근거를 주거나 과제를 주는** 자리에서 잰다 — 고객 설치본에서 실제로 벌어지는
//   「근거도 원격도 없이 물어본다」를 재는 자가 **0개**였다. 목적을 재는 자가 없으면 그 회전은
//   무엇을 고쳤는지 말할 수 없다(⑧~⑪이 뒤늦게 생긴 그 이유와 같다).
//
// ■ 이 파일이 못 박는 것
//   ① 채점은 **⑧과 같은 자**(overlap20)다 — 새 잣대를 짓지 않았다
//   ② 근거 ref를 회수 못 한 문항은 **건너뜀**이지 0점이 아니다(재료 사정이 점수로 둔갑하면 안 된다)
//   ③ 문항이 24개 미만이면 **미측정=불합격**(8건짜리 표본으로 낸 초록은 통과가 아니다)
//   ④ 하네스의 knowledge 조건은 근거를 **프롬프트에 안 싣고** 정답 조각은 **파일에 적는다**
//      (persona와 조건은 같고 목적이 반대라, 한 이름으로 묶으면 관문 ⑨의 모집단이 오염된다)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { 지식정답률, 문항최소_지식, 판정 } from "../../tools/team-bench/gates.mjs";
import { MODES, 조각들, 조각기록, 조각필요, system만들기 } from "../../tools/team-bench/ask-samples.mjs";

const 정답조각 = "기본 관리자 계정명을 변경하지 않고 사용할 경우 공격자에 의한 계정 및 비밀번호 추측 공격이 가능함";
const 아는답 = "확인해 보면 「기본 관리자 계정명을 변경하지 않고 사용할 경우」 추측 공격이 가능합니다. 계정명을 먼저 바꾸세요.";
const 모르는답 = "잘 모르겠습니다. 담당 부서에 문의하시기 바랍니다. 일반적인 보안 권고를 참고하세요.";
const 행 = (text: string, chunk = 정답조각) => ({ id: "k", question: "기본 계정명을 그대로 두면?", text, chunk });

describe("관문 ⑭의 잣대 — 채점은 ⑧과 같은 자다", () => {
  it("정답 조각의 20자가 답에 남아 있으면 맞은 것으로 센다", () => {
    expect(지식정답률([행(아는답)])!.성립).toBe(1);
    expect(지식정답률([행(모르는답)])!.성립).toBe(0);
  });

  it("★ 근거 조각을 회수 못 한 문항은 **건너뜀**이지 0점이 아니다", () => {
    const r = 지식정답률([행(아는답), 행(모르는답, ""), 행(아는답, "짧음")])!;
    expect(r.대상, "채점할 수 있는 문항만 모집단이다").toBe(1);
    expect(r.건너뜀).toBe(2);
    expect(r.비율, "건너뛴 둘을 0점으로 세면 재료 사정이 점수가 된다").toBe(1);
  });

  it("답이 비었으면 모집단에서 뺀다(빈 답을 오답으로 세면 서버 장애가 점수가 된다)", () => {
    expect(지식정답률([행("")])).toBeNull();
  });
});

describe("관문 ⑭의 판정 — 없으면 불합격, 모자라면 불합격", () => {
  const 아무것도없음 = { easy: null, hard: null };

  it("★ 지식 결과가 없으면 미측정이고, 미측정은 통과가 아니다(fail-closed)", () => {
    const r = 판정(아무것도없음, {});
    const 칸 = r.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any;
    expect(칸.값).toBe("미측정");
    expect(칸.통과).toBe(false);
  });

  it("★ 베이스 지식 결과가 없으면 무엇과 견줄지 모른다 — 역시 미측정이다", () => {
    const r = 판정({ ...아무것도없음, 지식: [행(아는답)] }, {});
    const 칸 = r.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any;
    expect(칸.값).toBe("미측정");
    expect(칸.설명 ?? 칸.이름).toBeTruthy();
  });

  it("★ 문항이 24개 미만이면 미측정이다 — 작은 표본으로 낸 초록은 통과가 아니다", () => {
    expect(문항최소_지식).toBe(24);
    const 적음 = Array.from({ length: 8 }, () => 행(아는답));
    const r = 판정({ ...아무것도없음, 지식: 적음 }, { 지식: 적음 });
    const 칸 = r.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any;
    expect(칸.값).toBe("미측정");
  });

  it("★ 문항이 충분하면 **베이스 대비**로 판정한다 — 무하락이면 초록, 떨어지면 빨강", () => {
    const 스물넷 = (text: string) => Array.from({ length: 문항최소_지식 }, () => 행(text));
    const 좋아짐 = 판정({ ...아무것도없음, 지식: 스물넷(아는답) }, { 지식: 스물넷(모르는답) });
    expect((좋아짐.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any).통과).toBe(true);
    const 나빠짐 = 판정({ ...아무것도없음, 지식: 스물넷(모르는답) }, { 지식: 스물넷(아는답) });
    expect((나빠짐.검사.find((c: { 키: string }) => c.키 === "local_knowledge") as any).통과, "잊었으면 막는다").toBe(false);
  });
});

describe("하네스 — knowledge 조건은 근거를 **안 싣고** 정답 조각은 **적는다**", () => {
  it("조건 목록에 knowledge가 있다", () => {
    expect(MODES).toContain("knowledge");
  });

  it("★ 프롬프트에는 근거를 안 싣는다(그게 「단독」의 뜻이다)", () => {
    expect(조각필요("knowledge")).toBe(false);
    expect(조각들({ chunk: 정답조각, distractor: "방해" }, "knowledge"), "프롬프트에 실을 조각은 없다").toEqual([]);
    expect(system만들기("팀원 프롬프트", "머리말", [], "knowledge")).toBe("팀원 프롬프트");
  });

  it("★ 정답 조각이 없는 문항은 건너뛴다 — 채점할 수 없는 문항을 0점으로 세지 않는다", () => {
    expect(조각들({ chunk: "" }, "knowledge")).toBeNull();
  });

  it("★ 파일에는 정답 조각을 적는다 — 채점(overlap20)이 그것과 답을 견준다", () => {
    expect(조각기록("knowledge")).toBe(true);
    expect(조각기록("grounded")).toBe(true);
    expect(조각기록("persona"), "⑨의 모집단에는 정답 조각이 없다").toBe(false);
  });
});

// ── 사슬(day2-train.sh) 소스 감시 — 2026-09-11 회전5 r5a 판정 배선 ─────────
// ★ 왜 여기 있나: 채점자(지식정답률)와 측정자(ask-samples MODES)는 이미 다 있었다(위 describe 둘).
//   그런데 사슬이 그 조건을 **던지지도, 게이트에 넘기지도 않아** ⑭는 배선 공백으로 죽어 있었다
//   (설계관 실측, 2026-09-11). 이 describe가 그 배선을 지킨다 — day2-train.sh는 한 줄도 안 보던
//   이 시험 파일이 이제 그 사슬의 소스를 직접 읽는다.
describe("사슬이 ⑭를 실제로 재고 넘긴다(day2-train.sh 소스 감시)", () => {
  const 셸 = readFileSync(join(__dirname, "..", "..", "tools", "ladder", "day2-train.sh"), "utf8");

  it("① knowledge 표본을 실제로 던진다 — --mode knowledge 호출이 없으면 ⑭는 영영 미측정이다", () => {
    expect(셸).toContain("--mode knowledge");
  });

  it("② 이번 판의 knowledge 결과를 --local-knowledge 로 게이트에 넘긴다", () => {
    // ⚠ --samples-knowledge 로 넘기면 gates.mjs가 조용히 무시한다(그 인자를 모른다) — 관문이
    //   초록인데 아무것도 안 잰 상태가 된다. 반드시 --local-knowledge 라는 이름이어야 한다.
    expect(셸).toContain("--local-knowledge");
  });

  it("③ 베이스의 knowledge 결과를 --baseline-local-knowledge 로 넘긴다 — 없으면 무엇과 견줄지 모른다", () => {
    expect(셸).toContain("--baseline-local-knowledge");
  });

  it("④ 「무슨 인자로 쟀는지」 기록(harness-args.json)의 표본 목록에도 knowledge가 있다", () => {
    expect(셸, "이 칸이 knowledge를 빼먹으면 결과 파일만 보고 무슨 조건으로 쟀는지 가릴 수 없다")
      .toMatch(/\["grounded", "distractor-only", "bare", "persona", "knowledge"\]/);
  });

  it("★★⑤ 표본 만들기·게이트 넘기기 루프 문자열은 **그대로 남아 있다**", () => {
    // 이 문자열은 server/test/ladder.test.ts:1598-1599가 이미 못 박아 둔 것이다 — knowledge를
    // 저 루프 안에 끼워 넣으면 이 문자열이 깨지고 그 시험도 함께 죽는다. 이 시험이 곧
    // 「knowledge는 루프에 끼우지 말고 별도 블록으로 두라」의 못이다.
    const 루프문자열 = "for mode in grounded distractor-only bare persona; do";
    const 개수 = 셸.split(루프문자열).length - 1;
    expect(개수, "표본 만들기 루프 + 게이트 넘기기 루프 — 정확히 둘이어야 한다(늘어도 줄어도 이 계약이 깨진 것)").toBe(2);
  });
});

// ── night-r5-judge.sh 소스 감시(2026-09-11 신설) ──────────────────────────
// ⚠ 왜 필요한가: night-r5-bake.sh는 2026-09-11까지 이것을 보는 시험이 0건이었다(전수 grep).
//   새 밤 스크립트를 감시 표에 안 올리면 「밤 스크립트는 시험이 없다」가 관례가 된다 — 같은 구멍을
//   두 번 파지 않으려고 judge와 bake 둘 다 여기서 덮는다.
describe("night-r5-judge.sh 소스 감시 — 판정은 굽지 않는다(fail-closed)", () => {
  const 밤 = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "night-r5-judge.sh"), "utf8");

  it("★ 교사(8080) 감시견이 있다 — 교사가 말을 멈추면 판정을 내린다", () => {
    expect(밤).toContain("8080/health");
  });

  it("★ 08:30 데드라인 감시견이 있다 — 낮 서빙을 지키는 마지막 방어선", () => {
    expect(밤).toMatch(/DEADLINE/);
  });

  it("★★ 교사를 이름으로 죽이지 않는다 — pkill -f llama-server 는 교사(8080)까지 죽인다", () => {
    expect(밤, "이 패턴이 있으면 교사·임베딩까지 함께 죽는다").not.toMatch(/pkill -f ['"]?llama-server/);
  });

  it("★ 재학습 금지를 명시한다 — --skip-train 이 있다", () => {
    // 어댑터 없이 --round r5a 를 부르면 day2-train.sh:372의 DONE_MARK 검사가 거짓이 되어
    // 4bit 기본값으로 밤을 통째로 다시 굽는다(:427 학습 호출에 --precision이 없다).
    expect(밤).toContain("--skip-train");
  });

  it("★ 어댑터 존재를 **먼저** 본다(fail-closed) — 없으면 판정 없이 끝낸다", () => {
    expect(밤).toContain("adapter_model.safetensors");
    expect(밤).toMatch(/checkpoint-26/);
    expect(밤).toMatch(/checkpoint-52/);
  });
});

describe("night-r5-bake.sh 소스 감시 — 2026-09-11까지 시험 0건이던 구멍을 메운다", () => {
  const 밤 = readFileSync(join(__dirname, "..", "..", "tools", "team-bench", "night-r5-bake.sh"), "utf8");

  it("★ 교사(8080) 감시견이 있다", () => {
    expect(밤).toContain("8080/health");
  });

  it("★ 08:30 데드라인 감시견이 있다", () => {
    expect(밤).toContain("DEADLINE");
  });

  it("★★ 교사를 이름으로 죽이지 않는다", () => {
    expect(밤).not.toMatch(/pkill -f ['"]?llama-server/);
  });

  it("굽기 직전에 등급 관문을 다시 잰다 — 빨강이면 굽지 않는다", () => {
    expect(밤).toContain("GRADEGATE");
    expect(밤).toMatch(/GATE=red/);
    expect(밤).toMatch(/\[ "\$GATE" != "ok" \]/);
  });
});
