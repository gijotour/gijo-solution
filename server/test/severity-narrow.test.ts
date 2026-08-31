// 심각도로 좁혀 물으면 그 등급만 — (2026-08-31 · 대장 §3 끊김 5)
//
// 왜: 「critical 취약점 목록 보여줘」가 좁히기에서 **자산 이름만** 보고 심각도 낱말은 안 읽어
// 전체 건수를 답했다. 담당자는 그 수를 critical 수로 읽는다 — 일의 크기를 잘못 가늠하게 된다.
// (같은 부류를 2026-08-03에 겪었다: 대상을 안 봐서 4,827건을 쏟았다.)
//
// ⚠ 심각도 우리말은 tone.ts **한 곳**에서만 만든다는 계약이 있다. 이 수리는 그 표를 그대로
//   쓰고 사본을 만들지 않는다 — 사본을 두면 「매우 심각」과 「critical」이 갈린다.
import { describe, it, expect } from "vitest";
import { 물음속심각도, 심각도한글 } from "../src/engine/tone";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("물음에서 심각도 읽기", () => {
  it("영문·우리말 둘 다 읽는다", () => {
    expect(물음속심각도("critical 취약점 목록 보여줘")).toBe("critical");
    expect(물음속심각도("매우 심각 취약점만 보여줘")).toBe("critical");
    expect(물음속심각도("높음 취약점 알려줘")).toBe("high");
    expect(물음속심각도("low 취약점 목록")).toBe("low");
  });

  it("★ 없으면 null — 지어내지 않는다", () => {
    expect(물음속심각도("조치할 취약점 목록 보여줘")).toBeNull();
    expect(물음속심각도("")).toBeNull();
  });

  it("담당자가 자주 쓰는 갈래도 읽는다(값은 표의 것 그대로)", () => {
    expect(물음속심각도("긴급한 취약점 보여줘")).toBe("critical");
    expect(물음속심각도("치명적인 것부터 보여줘")).toBe("critical");
  });

  it("★★ 우리말 라벨을 **새로 짓지 않는다** — tone.ts 표 하나에서 온다", () => {
    // 사본이 생기면 이 두 값이 갈린다. 같은 원천을 쓰는지 여기서 못 박는다.
    expect(심각도한글(물음속심각도("critical 목록") as string)).toBe("매우 심각");
    const src = readFileSync(join(__dirname, "..", "src", "engine", "picklist.ts"), "utf8");
    expect(src, "picklist가 심각도 라벨 표를 따로 갖는다면 사본이다")
      .not.toMatch(/critical:\s*"매우\s*심각"/);
    expect(src, "판정을 picklist가 직접 하면 잣대가 두 벌이 된다").toContain("물음속심각도(text)");
  });
});

describe("목록 답이 그 등급만 보여 준다", () => {
  const 소스 = readFileSync(join(__dirname, "..", "src", "engine", "picklist.ts"), "utf8");

  it("★ 좁힌 사실을 **머리줄에 적는다** — 안 적으면 전체인 줄 안다", () => {
    // 이 저장소가 이미 정한 계약(자산으로 좁혔을 때도 이름을 머리줄에 적는다)의 연장이다.
    const i = 소스.indexOf("const 머리 =");
    expect(i, "머리줄 조립부가 없다").toBeGreaterThan(-1);
    const 머리 = 소스.slice(i, i + 420);
    expect(머리, "등급을 머리줄에 안 적는다").toContain("심각도한글(등급)");
    expect(머리, "전체 대비 몇 건인지 안 밝힌다").toContain("전체 ${전부.length}건 중");
  });

  it("★★ 좁혀서 0건이면 **전체를 쏟지 않는다**", () => {
    // 2026-08-03의 그 사고(대상을 못 찾자 전체를 쏟음)와 같은 원칙이다.
    const i = 소스.indexOf("if (등급 && rows.length === 0)");
    expect(i, "등급 0건 갈래가 없다 — 전체가 쏟아진다").toBeGreaterThan(-1);
    const 갈래 = 소스.slice(i, i + 420);
    expect(갈래, "picklist를 비우지 않는다").toContain("picklist: null");
    expect(갈래, "전체가 몇 건인지 알려 줘야 다음 지시를 할 수 있다").toContain("전부.length");
  });

  it("등급이 없으면 옛 길 그대로 — 넓히다 원래 동작을 잃지 않았다", () => {
    expect(소스, "등급 없을 때 전부를 쓰는 갈래가 사라졌다").toContain("등급 ? 전부.filter");
  });
});
