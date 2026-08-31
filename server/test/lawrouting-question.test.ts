// 법령 물음이 **물음꼴이라 새던 것** — 라우팅 계약 (2026-08-31)
//
// 왜: 법령 강제 규칙이 「~해줘」 꼬리(찾아·알려·보여·검색)만 받도록 짜여 있어,
// **물음꼴로 물으면 통째로 투명**했다. 회귀 문항 access-log-retention이 그 자리다 —
// 「…최소 몇 년 보관해야 하고 근거 법령은?」이 모델 판단으로 새서 조문이 빠진 답이 나갔다.
// 명사(법령)는 걸리는데 동사가 하나도 안 맞았다(실측으로 갈라 확인).
//
// ⚠ 넓히면 **남의 물음을 채 간다** — 그래서 반례를 함께 못 박는다:
//   「접속기록 보여줘」는 로그 조회, 「로그 보관 방법 알려줘」·「이 취약점 조치 방법이 뭐야?」는
//   지식·조치의 몫이다. 넓힘과 반례는 **같은 시험에** 둔다(따로 두면 한쪽만 고쳐진다).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** agentloop의 강제 규칙에서 그 도구로 가는 정규식을 꺼낸다(원천 하나에서 읽는다). */
function 규칙(tool: string): RegExp {
  const 루프 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
  const i = 루프.indexOf(`tool: "${tool}"`);
  expect(i, `${tool} 강제 규칙이 없다`).toBeGreaterThan(-1);
  const 앞 = 루프.lastIndexOf("    re: ", i);
  return eval(루프.slice(앞 + 8, 루프.indexOf("\n", 앞)).replace(/,\s*$/, "").replace(/\r$/, "")) as RegExp;
}

describe("법령 물음 — 물음꼴도 결정적으로 간다", () => {
  const 법 = 규칙("law_lookup");

  it("★ 회귀 문항이 걸린다(access-log-retention의 그 문장)", () => {
    expect(법.test("개인정보처리시스템 접속기록은 최소 몇 년 보관해야 하고 근거 법령은?")).toBe(true);
  });

  it("물음꼴 여러 어형이 걸린다", () => {
    for (const q of [
      "개인정보 유출 관련 대법원 판례 있어?",
      "접속기록 몇 년 보관해야 해?",
      "망분리 의무의 근거 규정은 무엇인가?",
      "금융권 망분리 의무의 법적 근거 규정은 무엇이야?", // 회귀 문항 fin-mangbunri
    ]) {
      expect(법.test(q), q).toBe(true);
    }
  });

  it("시킴꼴은 그대로 걸린다(넓히다 옛 길을 잃지 않았다)", () => {
    expect(법.test("개인정보보호법 알려줘")).toBe(true);
  });

  it("★★ 남의 물음은 안 삼킨다 — 넓힘의 값은 여기서 정해진다", () => {
    for (const 남의것 of [
      "접속기록 보여줘", // 로그 조회 — 「접속기록」 홑낱말로 잡으면 이걸 채 간다
      "로그 보관 방법 알려줘", // 방법·절차는 지식의 몫
      "이 취약점 조치 방법이 뭐야?", // 조치의 몫
      "이거 해도 돼?", // 규정 판정(actioncheck)의 몫
      "이 규정 어겼어?", // ⚠ 「규정」 홑낱말로 명사를 넓히면 이걸 채 간다 — 「근거 규정」일 때만 받는다
      "사내 규정 보여줘", // 사내 규정은 법령이 아니다(actioncheck·문서의 몫)
    ]) {
      expect(법.test(남의것), `${남의것}을 삼킨다 — 낱말 가로채기`).toBe(false);
    }
  });
});

describe("코퍼스에 정답이 있는가 — 라우팅만 고쳐도 답이 되려면", () => {
  it("★ 접속기록 근거 세 겹이 지식 문서에 적혀 있다", () => {
    // 라우팅을 고쳐도 **근거가 없으면** 답이 못 나온다. 두 조건을 함께 못 박는다.
    // ⚠ 이 문서는 「개인정보 보호법 제30조」가 **틀린 답**이라고 경고까지 해 둔다 —
    //   맞는 계통은 법 제29조 → 시행령 제30조 → 고시 제8조다.
    const 지식 = readFileSync(
      join(__dirname, "..", "..", "knowledge", "보안규제_법적근거_모음.md"), "utf8");
    expect(지식, "법 제29조(안전조치의무)가 없다").toContain("제29조");
    expect(지식, "시행령 제30조가 없다").toContain("시행령 제30조");
    expect(지식, "고시 제8조(접속기록의 보관 및 점검)가 없다").toContain("제8조");
    expect(지식, "흔한 오답 경고가 사라졌다").toContain("자주 나는 오해");
  });

  it("그 문서가 매니페스트에 있다(반입되지 않으면 검색 밖이다)", () => {
    const m = readFileSync(join(__dirname, "..", "docs-manifest.json"), "utf8");
    expect(m, "매니페스트에 없으면 지식 저장소에 안 들어간다").toContain("knowledge/보안규제_법적근거_모음.md");
  });
});
