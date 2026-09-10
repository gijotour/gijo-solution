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
