// 지원 종료(EOL) 점검 — 대화로 (2026-09-01 · 계획서 중-7 + 전-4)
//
// ⚠ **정정(2026-09-01 검토관 [중])**: 처음 이 시험을 쓸 때 「부르는 곳이 한 군데도 없었다」고
// 적었는데 **사실이 아니었다.** eol찾기·eol한줄은 sbom_coverage가 이미 쓰고 있었다(자산 하나를
// 집었을 때만). 내 grep이 engine/*.ts만 봐서 agenttools/ 하위를 놓쳤다 —
// **얕은 글로브가 만든 거짓 사실**이다. 소비자가 정말 0이던 것은 eol표상태 하나였다.
// 이 도구가 더하는 것: 자산을 안 집어도 전체를 보고, 「없다 ≠ 괜찮다」를 말한다.
//
// ★★ 이 도구의 급소는 「0건」의 뜻이다.
//    표는 9줄뿐이라 걸리는 게 없다는 건 **「모른다」이지 「지원 중」이 아니다.**
//    그 문장이 빠지면 이 도구는 틀린 안심을 주는 물건이 된다 — 없느니만 못하다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEolCheck } from "../src/engine/agenttools/handlers";
import { EOL_SEED, eol찾기, eol한줄, eol표상태, 이름이정확한가, eol한줄확실도 } from "../src/engine/eol-seed";

describe("★★ 「없다」를 「괜찮다」로 말하지 않는다", () => {
  it("답이 **덮는 범위(표 줄 수)**를 반드시 밝힌다", async () => {
    const 답 = await runEolCheck({});
    expect(답, "표가 몇 줄짜리인지 안 밝히면 담당자가 전수 점검으로 읽는다")
      .toContain(`${EOL_SEED.length}줄`);
  });

  it("★ 걸린 게 없어도 **「지원 중」이라고 말하지 않는다**", async () => {
    const 답 = await runEolCheck({});
    expect(답, "「모른다」와 「괜찮다」를 안 가른다").toMatch(/모른다|모릅니다/);
    expect(답, "전부 지원 중이라고 단정했다").not.toMatch(/나머지는?\s*(전부\s*)?지원\s*중입니다/);
  });

  it("표 전체 상태(확인 전 줄 수)를 함께 말한다", async () => {
    const 답 = await runEolCheck({});
    expect(답, "얼마나 믿을 수 있는 표인지 안 밝힌다").toContain("확인 전");
  });
});

describe("표 자체의 정직성 — 확인 전 값을 확인된 것처럼 보이게 하지 않는다", () => {
  it("★ 확인 전 줄의 한 줄 답에는 **대조 안 했다는 말**이 붙는다", () => {
    const 확인전 = EOL_SEED.filter((r) => r.확인필요);
    expect(확인전.length, "확인 전 줄이 없다 — 시험 전제가 낡았다").toBeGreaterThan(0);
    for (const r of 확인전) {
      expect(eol한줄(r), `${r.제품} ${r.버전 ?? ""}: 확인 안 했다는 말이 없다`).toContain("대조하지 않은 값");
    }
  });

  it("eol표상태()가 확인 전 줄 수를 숫자로 말한다", () => {
    const 확인전 = EOL_SEED.filter((r) => r.확인필요).length;
    expect(eol표상태()).toContain(String(확인전));
  });

  it("날짜 없는 줄을 추측해 채우지 않았다", () => {
    for (const r of EOL_SEED) {
      if (r.종료일) expect(r.종료일, `${r.제품}: 날짜 꼴이 아니다`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.출처.trim(), `${r.제품}: 출처 없는 줄`).not.toBe("");
    }
  });
});

describe("찾기 — 못 찾으면 null(모른다)", () => {
  it("제품·버전이 맞으면 찾는다", () => {
    expect(eol찾기("centos", "7.9")?.종료일).toBe("2024-06-30");
    expect(eol찾기("OpenSSL", "1.1.1w")?.종료일).toBe("2023-09-11");
  });

  it("★ 모르는 부품은 null — **지원 중이라는 뜻이 아니다**", () => {
    expect(eol찾기("냉장고펌웨어", "1.0")).toBeNull();
    expect(eol찾기("")).toBeNull();
  });
});

describe("★ 표가 실제로 닿는다 — 부르는 곳이 있다", () => {
  it("등록부에 eol_check가 있다", () => {
    const 등록 = readFileSync(join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf8");
    expect(등록).toContain('name: "eol_check"');
  });

  it("★★ eol-seed의 창구가 **전부** 쓰인다 — 또 죽은 코드가 되지 않게", () => {
    const 핸들 = readFileSync(join(__dirname, "..", "src", "engine", "agenttools", "handlers.ts"), "utf8");
    for (const f of ["eol찾기", "eol한줄", "eol표상태"]) {
      expect(핸들, `${f}를 아무도 안 부른다 — 만들어 놓고 안 쓰던 그 상태로 돌아갔다`).toContain(f);
    }
  });
});

describe("낱말 가로채기 — 「지원」 홑낱말을 안 삼킨다", () => {
  const 셸 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
  const 규칙 = (() => {
    const i = 셸.indexOf('tool: "eol_check"');
    const j = 셸.lastIndexOf("re: /", i);
    const 끝 = 셸.indexOf("/i,", j);
    return new RegExp(셸.slice(j + 5, 끝), "i");
  })();

  for (const t of ["지원 끝난 부품 있어?", "EOL 확인해줘", "단종된 소프트웨어 알려줘", "EOS 정보 알려줘"]) {
    it(`"${t}" — 잡는다`, () => expect(규칙.test(t)).toBe(true));
  }
  for (const t of ["기술 지원 받을 수 있어?", "지원해줘", "이 제품 버전 뭐야", "자산 목록 보여줘", "취약점 알려줘", "계약 종료일 알려줘"]) {
    it(`"${t}" — 안 삼킨다`, () => expect(규칙.test(t), `EOL 규칙이 "${t}"을 가로챘다`).toBe(false));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-09-01 검토관 [중] — eol찾기의 느슨한 부분일치를 **전 부품에** 돌리면서,
// 이름만 겹치는 라이브러리를 「지원이 끝난 버전」이라 단정했다.
// ─────────────────────────────────────────────────────────────────────────────
describe("★★ 이름이 겹치기만 한 부품을 「지원 종료」로 단정하지 않는다", () => {
  const 남의것 = [
    ["python-dateutil", "2.7.5"],   // Python 2.7이 아니다 — 전혀 다른 꾸러미다
    ["python3-requests", "2.7.0"],
    ["libcentos-shim", "7.1"],
    ["ubuntu-advantage-tools", "20.04.1"],
    ["my-python-tool", "2.7"],
  ];
  for (const [이름, 판] of 남의것) {
    it(`"${이름} ${판}" — 단정하지 않고 확인을 청한다`, () => {
      const row = eol찾기(이름, 판);
      expect(row, "표에 걸리기는 한다(느슨한 맞춤)").not.toBeNull();
      expect(이름이정확한가(이름, row), `${이름}을 ${row.제품}과 같은 제품으로 봤다`).toBe(false);
      const 글 = eol한줄확실도(이름, row);
      expect(글, "이름이 겹칠 뿐인데 단정했다").toContain("이름이 겹칩니다");
      expect(글, "무엇을 하라는지 안 말한다").toContain("확인해 주세요");
    });
  }

  it("★ 이름이 똑같으면 그대로 단정한다 — 참인 경보를 잃지 않는다", () => {
    const row = eol찾기("centos", "7.9");
    expect(이름이정확한가("centos", row)).toBe(true);
    expect(eol한줄확실도("centos", row), "맞는 것까지 흐려 놓으면 경보가 죽는다")
      .not.toContain("이름이 겹칩니다");
  });

  it("확인 청하는 글에도 **원래 사실**이 함께 남는다", () => {
    const row = eol찾기("python-dateutil", "2.7.5");
    expect(eol한줄확실도("python-dateutil", row), "같은 것이었을 때의 뜻을 안 알려 준다")
      .toMatch(/같은 것이라면/);
  });
});
