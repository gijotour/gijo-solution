// server/test/brainlogfield.test.ts — 🧠🧠 **팀원별 두뇌기록**(qa 전용 칸)의 잎 통로와 배관.
//
// ■ 왜 생겼나 (2026-09-10 · ⑲ 첫 실측 23/27)
//   두뇌 표식(brainmark 단일 값)은 **답 하나에 하나**다 — 「담당자가 그대로 읽는 답(explain)」의
//   첫 chat만 담는다. 그런데 야간 회귀 마당 ⑲가 재려는 것은 「팀원마다 다른 두뇌로 실제 도는가」
//   (정의 A)인데, **원격 배정 팀원 셋(report·normaltic·ti)의 chat은 explain 없이 돈다** —
//   표식이 원리상 안 생기고, ⑲는 그 셋을 「돎(표식 없음)」으로만 적었다.
//   「원격에 배정했다」는 말의 증거가 기록 어디에도 없었던 셈이다.
//   그래서 **표식은 그대로 두고**, 같은 자리·같은 값에서 chat마다 배열로도 쌓는다.
//
// ■ 이 시험이 무는 것
//   ① 잎(ALS 통로)은 **진짜로 돌린다** — 그릇 없으면 무동작 · 결정 호출·분류기도 쌓인다 ·
//      그릇끼리 안 섞인다 · 비동기 너머에서도 담긴다 · 상한과 「생략」 표기
//   ② **qa가 아니면 아무것도 안 나간다**(가리는 잣대가 한 곳인가)
//   ③ 표식과 기록이 **어긋나지 않는다**(두 벌 잣대 금지)
//   ④ 가운데 고리 소스 감시 — llm이 사실을 넘기는가 · 쌓기가 **게이트 위**인가 ·
//      라우트가 qa 칸으로 싣는가 · 하네스가 받아 적는가 · 판정이 그 칸을 보는가
//
// ⚠ 왜 소스 감시가 섞여 있나: 배관의 양 끝(운영 라우트·야간 하네스)은 로그인·LLM·직렬 자원이
//   있어야 돌아 이 파일이 못 만진다. citesourcefield.test가 같은 이유로 고른 무늬 그대로 —
//   **잎은 진짜로 돌리고, 가운데 고리는 소스로 문다**(끊겨도 초록인 배선을 처음부터 막는다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  새두뇌표식수거, 두뇌표식을수거하며, 두뇌표식보고, 두뇌기록실어보내기, 두뇌기록상한,
} from "../src/engine/brainmark";

const 읽기 = (rel: string) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");
const 잎소스 = 읽기("engine/brainmark.ts");
const llm소스 = 읽기("engine/llm.ts");
const disp소스 = 읽기("engine/dispatcher.ts");
const 뿌리 = path.join(__dirname, "..", "..");
const 하네스소스 = fs.readFileSync(path.join(뿌리, "tools", "ops-sim.mjs"), "utf8");
const 판정소스 = fs.readFileSync(path.join(뿌리, "tools", "opssim-team.mjs"), "utf8");

/** 보고 한 건 — 시험이 매번 일곱 칸을 손으로 적지 않게 한 곳에 둔다. */
const 보고 = (agentId: string, 덧: Partial<{ location: "local" | "remote"; fallback: boolean; model: string | null; 왕복ms: number; 결정호출: boolean; 사람이읽는답: boolean }> = {}) =>
  두뇌표식보고({
    agentId,
    location: 덧.location ?? "local",
    fallback: 덧.fallback ?? false,
    model: 덧.model ?? "qwen3-14b",
    왕복ms: 덧.왕복ms ?? 100,
    결정호출: 덧.결정호출 ?? false,
    사람이읽는답: 덧.사람이읽는답 ?? true,
  });

describe("★ 잎 통로 — 그릇이 있을 때만 담는다(사람 응답 경로에는 아무 일도 안 난다)", () => {
  it("그릇이 없으면 무동작이다 — 던져도 조용하다", () => {
    expect(() => 보고("report")).not.toThrow();
  });

  it("담은 항목은 **보고한 그 값 그대로**다(모양을 바꾸지 않는다)", () => {
    const 그릇 = 새두뇌표식수거();
    두뇌표식을수거하며(그릇, () => 보고("report", { location: "remote", model: "qwen3.8-flash-next", 왕복ms: 19000, 사람이읽는답: false }));
    expect(그릇.기록).toEqual([{
      agentId: "report", location: "remote", fallback: false, model: "qwen3.8-flash-next",
      왕복ms: 19000, 결정호출: false, 사람이읽는답: false,
    }]);
  });

  // ★★ **이 대비가 이 판의 전부다.** 표식은 답 하나만 담는데 기록은 전부 담는다 —
  //    안 그러면 explain 없이 도는 원격 팀원 셋이 영영 안 보인다(⑲ 첫 실측 23/27).
  it("★★ 결정 호출·분류기도 **기록에는 담긴다** — 표식에는 안 담기는 바로 그 호출들이다", () => {
    const 그릇 = 새두뇌표식수거();
    두뇌표식을수거하며(그릇, () => {
      보고("orchestrator", { 사람이읽는답: false, model: "분류기-14b" });                       // 분류기
      보고("orchestrator", { 결정호출: true, 사람이읽는답: false, model: "결정용-14b" });        // 도구 결정
      보고("report", { location: "remote", model: "flash-next", 사람이읽는답: false });          // 리포트(explain 없음)
      보고("orchestrator", { model: "qwen3-14b", 사람이읽는답: true });                          // 담당자가 읽는 답
    });
    expect(그릇.기록, "표식 잣대가 기록에도 걸렸다 — 원격 팀원이 통째로 사라진다").toHaveLength(4);
    expect(그릇.기록!.map((x) => x.agentId)).toEqual(["orchestrator", "orchestrator", "report", "orchestrator"]);
    // 표식은 종전 계약 그대로 — 「사람이 읽는 답」 하나뿐이다.
    expect(그릇.값?.model, "표식 계약이 함께 바뀌었다 — 이 판은 표식을 건드리지 않는다").toBe("qwen3-14b");
    expect(그릇.값?.보고횟수).toBe(1);
  });

  it("★ 표식과 기록이 **어긋나지 않는다** — 배열의 「사람이 읽는 답」 첫 항목이 곧 표식이다", () => {
    const 그릇 = 새두뇌표식수거();
    두뇌표식을수거하며(그릇, () => {
      보고("orchestrator", { 사람이읽는답: false });                                   // 분류기(local)
      보고("report", { location: "remote", model: "flash-next", 사람이읽는답: true });  // 답(remote)
      보고("normaltic", { location: "remote", model: "flash-next", 사람이읽는답: true }); // 두 번째 답
    });
    const 답한것 = 그릇.기록!.find((x) => x.사람이읽는답 && !x.결정호출)!;
    expect(그릇.값?.location, "두 벌 잣대가 생겼다 — 표식과 기록이 다른 두뇌를 가리킨다").toBe(답한것.location);
    expect(그릇.값?.model).toBe(답한것.model);
    expect(그릇.값?.보고횟수, "표식의 횟수 계약이 바뀌었다").toBe(2);
  });

  it("비동기 안에서 보고해도 담긴다(chat은 await 너머에서 보고한다)", async () => {
    const 그릇 = 새두뇌표식수거();
    await 두뇌표식을수거하며(그릇, async () => {
      await new Promise((r) => setTimeout(r, 1));
      보고("ti", { location: "remote" });
    });
    expect(그릇.기록?.[0].agentId).toBe("ti");
  });

  it("그릇끼리 안 섞인다 — 요청 하나에 그릇 하나", () => {
    const A = 새두뇌표식수거(), B = 새두뇌표식수거();
    두뇌표식을수거하며(A, () => 보고("report"));
    두뇌표식을수거하며(B, () => 보고("ti"));
    expect([A.기록?.map((x) => x.agentId), B.기록?.map((x) => x.agentId)]).toEqual([["report"], ["ti"]]);
  });

  it("★ 상한을 넘으면 **잘렸다는 사실을 적는다** — 조용히 버리지 않는다", () => {
    const 그릇 = 새두뇌표식수거();
    두뇌표식을수거하며(그릇, () => {
      for (let i = 0; i < 두뇌기록상한 + 3; i++) 보고("orchestrator");
    });
    expect(그릇.기록, "상한이 안 걸린다 — 되풀이가 새면 응답이 무한정 커진다").toHaveLength(두뇌기록상한);
    expect(그릇.기록![두뇌기록상한 - 1].생략, "잘린 사실을 안 적었다 — 「안 돌았다」와 「못 담았다」가 뒤섞인다").toBe(3);
    expect(그릇.기록![0].생략, "안 잘린 항목에 생략이 붙었다").toBeUndefined();
  });
});

describe("★★ qa가 아니면 한 글자도 안 나간다 — 가리는 잣대는 잎 한 곳이다", () => {
  const 담긴그릇 = () => {
    const 그릇 = 새두뇌표식수거();
    두뇌표식을수거하며(그릇, () => 보고("report", { location: "remote", model: "flash-next" }));
    return 그릇;
  };

  it("qa가 아니면 undefined — 라우트가 `if (qa)`를 따로 안 적어도 안 샌다", () => {
    expect(두뇌기록실어보내기(담긴그릇(), false), "사람 응답에 팀원 id·모델 이름이 샜다").toBeUndefined();
  });

  it("qa면 담긴 배열 그대로", () => {
    const 실은것 = 두뇌기록실어보내기(담긴그릇(), true);
    expect(실은것).toHaveLength(1);
    expect(실은것![0]).toMatchObject({ agentId: "report", location: "remote", model: "flash-next" });
  });

  it("담긴 것이 없으면 칸을 아예 안 만든다 — 「빈 배열」과 「LLM이 안 돈 답」을 뭉개지 않는다", () => {
    expect(두뇌기록실어보내기(새두뇌표식수거(), true), "빈 배열을 실었다 — 안 돈 답과 구별이 안 된다").toBeUndefined();
  });
});

// ── 가운데 고리 — 배선이 끊기면 조용히 옛 상태로 돌아간다 ─────────────────────────────
describe("★ 가운데 고리 — 소스 감시", () => {
  it("★★ 고리 ① 쌓기가 **게이트 위**에 있다 — 아래면 결정 호출·분류기가 통째로 빠진다", () => {
    // 이 순서가 뒤집히면 explain 없이 도는 원격 팀원 셋이 한 항목도 안 남아,
    // 이 판이 하려는 일(그 셋의 두뇌를 눈으로 보기)이 **원리상** 불가능해진다.
    const 쌓기 = 잎소스.indexOf("두뇌기록쌓기(그릇, 보고);");
    const 게이트 = 잎소스.indexOf("if (보고.결정호출 || !보고.사람이읽는답) return;");
    expect(쌓기, "잎이 기록을 안 쌓는다").toBeGreaterThan(0);
    expect(게이트, "표식 게이트가 사라졌다 — 표식 계약이 함께 깨졌다").toBeGreaterThan(0);
    expect(쌓기, "쌓기가 게이트 아래로 내려갔다 — 원격 팀원이 영영 안 보인다").toBeLessThan(게이트);
  });

  it("고리 ② llm이 **사실만** 넘긴다 — 팀원 id와 잰 시간이 함께 간다", () => {
    expect(llm소스, "팀원 id를 안 넘긴다 — 누구의 두뇌인지 못 가린다").toContain("agentId: args.agentId,");
    expect(llm소스, "왕복ms를 안 넘긴다").toContain("왕복ms: Date.now() - started,");
    // ⚠ 표식과 **같은 한 번의 보고**여야 한다 — 두 벌로 부르면 그날부터 값이 갈린다.
    expect(llm소스.match(/두뇌표식보고\(\{/g)?.length, "보고가 두 곳이 됐다 — 표식과 기록이 갈린다").toBe(1);
    expect(llm소스, "잎 모듈이 아닌 곳에서 가져왔다").toMatch(/두뇌표식보고[^\n]*from "\.\/brainmark"/);
  });

  it("★★ 고리 ③ dispatcher가 **llm이 아니라 잎 모듈**에서 가져와 qa 칸으로 싣는다", () => {
    // llm을 통째로 흉내 내는 목이 66파일이라, llm에서 심볼을 하나만 더 가져오면 그것들이 죽는다.
    expect(disp소스, "잎 모듈에서 안 가져온다").toContain("두뇌기록실어보내기");
    expect(disp소스.match(/import \{([^}]*)\} from "\.\/llm";/)?.[1].trim(), "llm import에 심볼이 늘었다 — 목 66개가 통째로 죽는다").toBe("chat");
    expect(disp소스, "qa 잣대를 라우트에 적었다 — 입구가 늘 때 한쪽만 고쳐져 샌다")
      .toContain("const 두뇌기록 = 두뇌기록실어보내기(두뇌그릇, qa);");
    expect(disp소스, "담긴 것이 없어도 싣는다 — 빈 칸이 「LLM이 안 돌았다」와 뒤섞인다")
      .toContain("if (두뇌기록) first.두뇌기록 = 두뇌기록;");
    expect(disp소스, "응답 타입에 칸이 없다 — 계산만 하고 버리면 하네스가 못 쓴다")
      .toMatch(/두뇌기록\?:\s*두뇌기록항목\[\];/);
  });

  it("고리 ④ 하네스가 그 칸을 받아 적고, ⑲ 판정이 팀원별로 골라 본다", () => {
    expect(하네스소스, "하네스가 두뇌기록을 안 받는다 — 서버가 실어 줘도 기록에 안 남는다")
      .toContain("두뇌기록: j.두뇌기록,");
    expect(판정소스, "판정이 그 칸을 안 본다 — 받아 적기만 하고 아무도 안 쓴다")
      .toContain("export function 두뇌기록고르기(두뇌기록, 팀원)");
    expect(판정소스, "팀원 이름표로 안 고른다 — 남의 두뇌로 이 팀원을 견주게 된다")
      .toContain("x.agentId === 팀원");
  });
});
