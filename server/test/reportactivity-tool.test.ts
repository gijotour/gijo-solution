// 「이번 주 보고서 썼어?」 — 이번 주를 물었는데 지난주를 답하던 자리.
//
// 실측(2026-08-03 실전 147상황): "이번 주 보고서 썼어?"에
//   **"지난주 보고서는 7월 5일에 작성되었습니다"**라고 답했다.
//   숫자가 틀린 게 아니라 **뜻이 다른** 답이다 — 담당자는 "썼구나" 하고 넘어간다.
//   같은 숫자를 절차 띠 ⑤ 보고 칸은 이미 결정적으로 세고 있었다(reportActivity).
//
// ★ 여기서 못 박는 것은 셋이다: 도구가 있는가 · 같은 함수를 쓰는가 · 만들기를 가로채지 않는가.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findAgentTool } from "../src/engine/agenttools";

const 소스 = (f: string) => fs.readFileSync(path.join(__dirname, "../src/engine", f), "utf8");

describe("보고서 작성 현황을 챗봇이 답한다", () => {
  it("도구가 등록돼 있고 LLM 재작성을 안 거친다", async () => {
    const t = findAgentTool("report_activity");
    expect(t, "report_activity 도구가 없다 — 물어도 모델이 지어낸다").toBeTruthy();
    expect(t!.write, "조회인데 결재판이 뜬다").toBeFalsy();
    // 이미 우리말 요약이라 모델에 다시 쓰게 하면 숫자만 흔들린다.
    expect((t as { directAnswer?: boolean }).directAnswer, "즉답이 아니다").toBe(true);
  });

  it("★ 절차 띠 ⑤ 보고 칸과 **같은 함수**로 센다", () => {
    // ⚠ 따로 세면 반드시 어긋나고, 어긋난 두 숫자는 담당자가 **둘 다** 안 믿게 만든다.
    const a = 소스("agenttools.ts");
    const w = 소스("workflow.ts");
    expect(a, "agenttools가 reportActivity를 안 쓴다 — 따로 세고 있다").toContain("reportActivity(");
    expect(w, "workflow가 reportActivity를 안 쓴다").toContain("reportActivity(");
  });

  it("답이 이번 주를 말하고, 0건이어도 갈 곳을 준다", async () => {
    const out = String(await findAgentTool("report_activity")!.run({}));
    expect(out.length, "빈 답").toBeGreaterThan(10);
    expect(/이번\s*주/.test(out), `이번 주를 안 말한다: ${out}`).toBe(true);
    // 0건일 때 "없습니다"로 끝내면 "그래서 뭘 하지"가 남는다.
    if (/없습니다/.test(out)) expect(out, "0건인데 다음 걸음이 없다").toContain("▸");
  });

  it("★ 「만들어줘」를 가로채지 않는다", () => {
    // 물음(냈나?)과 지시(만들어)는 다른 일이다. 넓게 잡으면 리포트 생성이 막힌다.
    const a = 소스("agentloop.ts");
    const i = a.indexOf('tool: "report_activity"');
    expect(i, "강제 라우팅 규칙이 없다").toBeGreaterThan(0);
    const 규칙 = /re: (\/.+\/)[a-z]*,/.exec(a.slice(a.lastIndexOf("{", i), i));
    expect(규칙, "정규식을 못 읽었다 — 이 시험이 헛돌고 있다").toBeTruthy();
    const re = eval(규칙![1]) as RegExp;
    for (const 물음 of ["이번 주 보고서 썼어?", "보고서 언제 마지막으로 냈지?", "이번 달 보고 했나"]) {
      expect(re.test(물음), `못 잡는다: ${물음}`).toBe(true);
    }
    for (const 지시 of ["이번 주 취약점 보고서 만들어줘", "월간 보고서 작성해줘", "경영진 보고서 뽑아줘"]) {
      expect(re.test(지시), `만들기를 가로챈다: ${지시}`).toBe(false);
    }
  });
});
