// 중첩 부품(components 안의 components) — 겉만 세던 것을 편다 (2026-09-01 · 계획서 중-7)
//
// ★★ 왜 중요한가: 부품 안에 든 부품도 **똑같이 라이선스 의무를 지운다.**
// GPL 라이브러리가 한 겹 안에 들어 있다고 소스 공개 의무가 사라지지 않는다.
// 겉만 세면 검수 결과가 **실제보다 안전해 보인다** — 이 화면에서 가장 위험한 종류의 틀림이다.
import { describe, it, expect } from "vitest";
import { sbom읽기 } from "../src/engine/sbomimport";

const 감싸기 = (comps: unknown[]) =>
  JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", metadata: { component: { name: "납품물" } }, components: comps });

describe("★★ 안쪽 부품을 센다", () => {
  it("한 겹 안에 든 부품이 목록에 들어온다", () => {
    const r = sbom읽기(감싸기([
      { name: "겉부품", version: "1.0", licenses: [{ license: { id: "MIT" } }], components: [
        { name: "속부품", version: "2.0", licenses: [{ license: { id: "GPL-3.0-only" } }] },
      ] },
    ]));
    const 이름들 = r.부품.map((p) => p.이름);
    expect(이름들, "안쪽 부품을 못 봤다 — 라이선스 의무가 통째로 숨는다").toContain("속부품");
    expect(이름들).toContain("겉부품");
  });

  it("★ 안쪽의 GPL이 살아서 나온다 — 의무가 사라지지 않는다", () => {
    const r = sbom읽기(감싸기([
      { name: "겉", version: "1", licenses: [{ license: { id: "MIT" } }], components: [
        { name: "안", version: "1", licenses: [{ license: { id: "GPL-3.0-only" } }] },
      ] },
    ]));
    expect(r.부품.find((p) => p.이름 === "안")?.라이선스).toContain("GPL");
  });

  it("여러 겹도 편다", () => {
    const r = sbom읽기(감싸기([
      { name: "a", components: [{ name: "b", components: [{ name: "c", components: [{ name: "d" }] }] }] },
    ]));
    expect(r.부품.map((p) => p.이름).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("중첩이 없으면 예전과 똑같다", () => {
    const r = sbom읽기(감싸기([{ name: "x", version: "1" }, { name: "y", version: "2" }]));
    expect(r.부품).toHaveLength(2);
    expect(r.알림.join(" "), "중첩이 없는데 중첩 얘기를 한다").not.toContain("펴서 셌습니다");
  });
});

describe("★ 숫자가 왜 겉보다 많은지 밝힌다", () => {
  it("맨 위 몇 개 + 안쪽 몇 개를 말한다", () => {
    const r = sbom읽기(감싸기([
      { name: "a", components: [{ name: "b" }, { name: "c" }] },
    ]));
    const 알림 = r.알림.join(" ");
    expect(알림, "안 밝히면 「목록엔 1개인데 왜 3개라 하나」가 된다").toContain("펴서 셌습니다");
    expect(알림).toContain("맨 위 1개");
    expect(알림).toContain("안쪽 2개");
  });
});

describe("★★ 말없는 잘라내기 금지", () => {
  it("깊이 상한에 걸리면 **몇 개를 못 봤는지** 말한다", () => {
    // 10겹짜리를 만든다. 상한은 8겹이다.
    let 안: Record<string, unknown> = { name: "d10" };
    for (let i = 9; i >= 1; i--) 안 = { name: `d${i}`, components: [안] };
    const r = sbom읽기(감싸기([안]));
    const 알림 = r.알림.join(" ");
    expect(알림, "조용히 자르면 「전부 봤다」로 읽힌다").toMatch(/못 읽었습니다/);
    expect(알림, "덜 센 값이라는 걸 안 말한다").toContain("덜 센 값");
  });

  it("상한 안쪽이면 잘랐다는 말을 하지 않는다", () => {
    const r = sbom읽기(감싸기([{ name: "a", components: [{ name: "b" }] }]));
    expect(r.알림.join(" ")).not.toContain("못 읽었습니다");
  });
});

describe("망가진 입력에 안 죽는다", () => {
  it("components가 배열이 아니어도 넘어간다", () => {
    const r = sbom읽기(감싸기([{ name: "a", components: "이건 배열이 아니다" }]));
    expect(r.부품.map((p) => p.이름)).toEqual(["a"]);
  });

  it("빈 중첩 배열은 아무 말도 안 만든다", () => {
    const r = sbom읽기(감싸기([{ name: "a", components: [] }]));
    expect(r.부품).toHaveLength(1);
    expect(r.알림.join(" ")).not.toContain("펴서 셌습니다");
  });

  it("이름 없는 안쪽 부품도 세지 못한 것으로 알린다", () => {
    const r = sbom읽기(감싸기([{ name: "a", components: [{ version: "1" }] }]));
    expect(r.알림.join(" ")).toContain("이름이 없는 항목");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-01 검토관 [상][중] — 위 시험이 **2겹 픽스처만** 써서 우연히 맞는 구간만 봤다.
// 3겹부터 숫자가 틀렸는데 시험이 통과했다. **숫자를 직접 검사한다.**
// ─────────────────────────────────────────────────────────────────────────────
describe("★★ 안내 숫자가 실제 부품 수와 맞는다 (3겹 이상)", () => {
  const 안쪽수 = (알림: string[]) => {
    const m = 알림.join(" ").match(/안쪽 (\d+)개 = (\d+)개/);
    return m ? { 안쪽: Number(m[1]), 합: Number(m[2]) } : null;
  };

  it("3겹 a>b>c — 「맨 위 1 + 안쪽 2 = 3」이어야 한다(예전엔 4라고 했다)", () => {
    const r = sbom읽기(감싸기([{ name: "a", components: [{ name: "b", components: [{ name: "c" }] }] }]));
    expect(r.부품).toHaveLength(3);
    const n = 안쪽수(r.알림);
    expect(n, "안내 문장을 못 찾았다").not.toBeNull();
    expect(n.안쪽, "겹마다 자손을 다시 더해 부풀었다").toBe(2);
    expect(n.합, "안내가 말한 합이 실제 부품 수와 다르다").toBe(r.부품.length);
  });

  it("★ 어떤 모양이든 **안내한 합 === 실제 부품 수**", () => {
    const 모양들 = [
      [{ name: "a", components: [{ name: "b" }] }],
      [{ name: "a", components: [{ name: "b", components: [{ name: "c" }] }] }],
      [{ name: "a", components: [{ name: "b", components: [{ name: "c", components: [{ name: "d" }] }] }] }],
      [{ name: "a", components: [{ name: "b" }, { name: "c", components: [{ name: "d" }, { name: "e" }] }] }],
      [{ name: "x" }, { name: "a", components: [{ name: "b", components: [{ name: "c" }] }] }],
    ];
    for (const 모양 of 모양들) {
      const r = sbom읽기(감싸기(모양));
      const n = 안쪽수(r.알림);
      if (!n) continue; // 중첩 없는 모양은 안내가 없다
      expect(n.합, `모양 ${JSON.stringify(모양).slice(0, 40)}…: 안내 합 ${n.합} ≠ 실제 ${r.부품.length}`)
        .toBe(r.부품.length);
    }
  });
});

describe("★★ 못 읽은 부품 수는 **서브트리 전체**다 (직계 자식만 세면 과소 보고)", () => {
  it("10겹 — d9·d10 두 개를 못 읽으므로 「2개」여야 한다(예전엔 1개라고 했다)", () => {
    let 안 = { name: "d10" };
    for (let i = 9; i >= 1; i--) 안 = { name: `d${i}`, components: [안] };
    const r = sbom읽기(감싸기([안]));
    expect(r.부품, "8겹까지 읽어야 한다").toHaveLength(8);
    const m = r.알림.join(" ").match(/(\d+)개는 못 읽었습니다/);
    expect(m, "못 읽었다는 말이 없다").not.toBeNull();
    expect(Number(m[1]), "직계 자식만 세어 실제보다 적게 보고한다").toBe(2);
  });

  it("★ 상한 아래에 자손이 여럿이면 그것을 다 센다", () => {
    // 9겹 자리에 2개, 각각 10겹에 3개씩 → 못 읽는 것은 2 + 6 = 8개
    const 손자 = () => ({ name: "손", components: [{ name: "증1" }, { name: "증2" }, { name: "증3" }] });
    let 안 = { name: "d8", components: [손자(), 손자()] };
    for (let i = 7; i >= 1; i--) 안 = { name: `d${i}`, components: [안] };
    const r = sbom읽기(감싸기([안]));
    const m = r.알림.join(" ").match(/(\d+)개는 못 읽었습니다/);
    expect(Number(m[1]), "그 아래 서브트리를 안 셌다").toBe(8);
  });

  it("망가진 문서(자기 자신을 품는 부품)에도 안 죽는다", () => {
    // JSON에는 순환이 없지만, 아주 깊은 문서가 스택을 터뜨리지 않는지 본다.
    let 안 = { name: "깊음" };
    for (let i = 0; i < 300; i++) 안 = { name: "d" + i, components: [안] };
    expect(() => sbom읽기(감싸기([안])), "깊은 문서에 죽는다").not.toThrow();
  });
});
