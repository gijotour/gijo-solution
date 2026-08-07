// 내부 키 치환 — [2026-08-07 · 150상황 선제 회차 실측]
//
// 실측: 「레드팀 점검 어떻게 돌려?」 답에 `샘플-웹서버(10.0.0.100)(vuln:sample-web01)`이
//   그대로 나갔다. 코드가 낸 문장이 아니라 **모델이 근거 자료에서 옮겨 적은 것**이라
//   도구 한 곳을 고쳐서는 못 막는다 — 답이 나가는 마지막 자리에서 건다.
// 계약: **막지 않고 바꾸기만** 한다(말투 감시와 같은 태도). 이름을 못 찾으면 접두사만 뗀다.
import { describe, it, expect } from "vitest";
import { 내부키치환 } from "../src/engine/tone";
import { 금지말투 } from "../src/engine/tone";

const 이름표 = (id: string) => (id === "vuln:sample-web01" ? "샘플-웹서버" : id);

describe("내부 키 치환", () => {
  it("★ 실측 문장의 내부 키가 사람이 읽는 이름으로 바뀐다", () => {
    const 원문 = "레드팀 점검을 수행할 수 없는 이유는 샘플-웹서버(10.0.0.100)(vuln:sample-web01)에는 연결된 모델이 없기 때문입니다.";
    const r = 내부키치환(원문, 이름표);
    expect(r).not.toContain("vuln:");
    expect(r).toContain("샘플-웹서버");
    // 말투 규범 자신의 판별자로도 확인 — 두 곳이 어긋나면 감시가 헛돈다
    const 규범 = 금지말투.find((x) => x.이름 === "내부 식별자")!;
    expect(규범.re.test(r), "치환 후에도 규범에 걸린다").toBe(false);
  });

  it("이름을 못 찾으면 접두사만 뗀다 — 답을 지우지 않는다", () => {
    const r = 내부키치환("대상: asset:unknown-host 를 보세요", (id) => id);
    expect(r).toContain("unknown-host");
    expect(r).not.toContain("asset:");
  });

  it("★★ 내부 키가 없는 답은 한 글자도 안 바꾼다", () => {
    const 원문 = "취약점 4,820건 — 미검토 4,820, 담당자 미배정 4,820건. 10.0.0.100은 그대로 둔다.";
    expect(내부키치환(원문, 이름표)).toBe(원문);
  });
});
