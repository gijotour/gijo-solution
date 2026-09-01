// 개발 모드가 켜진 채 출하되는 것을 잡는다 (2026-09-01)
//
// 왜: 운영 서버가 GIJO_DEV_MODE=1로 돌아 **업무정보 등급(기밀·민감) 열람 제한이 통째로 꺼져**
// 있다. 개발 동안 일부러 푼 것이라 끄는 시점은 사장님 결정이지만, **되돌리는 것을 잊으면
// 통제 없는 제품이 나간다.** 그런데 그것을 잡는 검사가 하나도 없었다.
//
// ⚠ 이 시험은 「지금 꺼라」가 아니다. **표지가 사라지지 않게** 하는 것이다 —
//   자가 진단에서 그 항목을 지우거나 warn으로 낮추면 여기서 걸린다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { 개발모드 } from "../src/util/devmode";

const 진단 = readFileSync(join(__dirname, "..", "src", "engine", "preflight.ts"), "utf8");

describe("자가 진단이 개발 모드를 말한다", () => {
  it("★ 「개발 모드」 항목이 있다", () => {
    expect(진단, "자가 진단에 개발 모드 항목이 없다 — 켜진 채 출하돼도 아무도 모른다")
      .toContain('name: "개발 모드"');
  });

  it("★★ 켜져 있으면 **fail**이다 — warn으로 낮추면 안 된다", () => {
    // 저장 암호화(warn)와 다르다: 암호화는 「안 켰다」는 선택이지만,
    // 개발 모드는 **제품이 스스로 규칙을 끈 상태**라 그대로 출하되면 안 된다.
    const i = 진단.indexOf('name: "개발 모드"');
    const 둘레 = 진단.slice(i, i + 260);
    expect(둘레, "켜졌을 때 fail이 아니다").toMatch(/개발\s*\?\s*"fail"/);
  });

  it("판정은 **원천 한 곳**에서 읽는다 — env를 직접 읽지 않는다", () => {
    expect(진단, "devmode 원천을 안 쓴다").toContain('from "../util/devmode"');
    const i = 진단.indexOf('name: "개발 모드"');
    expect(진단.slice(Math.max(0, i - 400), i), "env를 직접 읽으면 자리마다 답이 갈린다")
      .not.toContain("process.env.GIJO_DEV_MODE");
  });

  it("★ 켜져 있으면 **무엇이 꺼졌는지**와 **어떻게 되돌리는지**를 말한다", () => {
    const i = 진단.indexOf('name: "개발 모드"');
    const 둘레 = 진단.slice(i, i + 500);
    expect(둘레, "무엇이 꺼졌는지 안 밝힌다").toMatch(/등급|기밀|민감/);
    expect(둘레, "되돌리는 법을 안 알려 준다").toContain("GIJO_DEV_MODE");
  });

  it("상태를 못 읽으면 **막는 쪽**으로 판정한다(모호하면 fail)", () => {
    const i = 진단.indexOf('name: "개발 모드"');
    const 둘레 = 진단.slice(i, i + 700);
    expect(둘레, "확인 실패를 pass·warn으로 흘리면 조용히 새어 나간다").toContain("모호하면 막는다");
  });
});

describe("판정기 자체가 도는가 — 헛돌지 않는지", () => {
  it("개발모드()가 값을 돌려준다", () => {
    expect(typeof 개발모드()).toBe("boolean");
  });
});
