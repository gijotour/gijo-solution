// 강제 규칙이 **실제 순서로** 제 도구에 닿는가 (2026-09-01 신설 · 검토관 [상])
//
// ★★ 이 시험이 왜 필요한가
//   라우팅 시험을 규칙 하나만 떼어 `정규식.test(문장)`으로 써 왔다. 그건 **자기가 만든
//   정규식을 자기가 확인하는** 꼴이라 늘 통과한다. 제품은 FORCED_INTENTS를 **순서대로**
//   훑어 **첫 매치에서 끝내므로**, 앞 규칙이 삼키고 있으면 내 규칙은 영영 안 걸린다.
//
//   2026-09-01 실측: `set_aibom_field`(기입)가 앞의 `/ai[-\s_]?bom/i`(조회)에 가로채여
//   「AI-BOM에 가드레일 기재해줘」가 **읽기 도구로 갔다.** 적으라고 시켰는데 목록만 오고
//   아무것도 안 적혔는데 시험은 초록이었다.
import { describe, it, expect } from "vitest";
import { 강제규칙들, 실제도착, 가로챈규칙 } from "./helpers/routing";

const 규칙 = 강제규칙들();

describe("★★ 쓰기 요청이 읽기 도구로 새지 않는다", () => {
  const 기입해야함 = [
    "AI-BOM에 데이터셋 출처 채워줘",
    "fraud-detect-llm AI-BOM 가드레일 기재해줘",
    "AI-BOM에 시스템 프롬프트 적어줘",
    "fraud-detect-llm 가드레일 기재해줘",
    "이 자산 시스템 프롬프트 적어줘",
    "호스팅 공급업체 기입해줘",
  ];
  for (const 문장 of 기입해야함) {
    it(`"${문장}" → set_aibom_field`, () => {
      const 도착 = 실제도착(문장, 규칙);
      const 도둑 = 가로챈규칙(문장, "set_aibom_field", 규칙);
      expect(도착, 도둑 ? `앞 규칙 [${도둑.차례}] ${도둑.도구}가 가로챘다` : "아무 규칙에도 안 걸린다")
        .toBe("set_aibom_field");
    });
  }

  it("★ 물음꼴은 그대로 조회로 간다 — 시킴말만 비켜 준 것이다", () => {
    // 「뭘 기재해야 해?」는 무엇을 적을지 **묻는** 말이라 조회(미기재 목록)가 맞다.
    expect(실제도착("AI-BOM 뭘 기재해야 해?", 규칙)).toBe("aibom_status");
    expect(실제도착("AI-BOM 현황 알려줘", 규칙)).toBe("aibom_status");
    expect(실제도착("AI-BOM 보여줘", 규칙)).toBe("aibom_status");
  });
});

describe("★ SBOM 없는 자산 — AI 자산만 세는 도구로 보내지 않는다", () => {
  // aibom_status는 `all.filter(isAiAsset)`로 **AI 자산만** 센다. 거기로 보내면
  // IT·일반 소프트웨어 자산이 통째로 빠지고, 자산이 전부 IT면 「AI 자산이 없습니다」라고
  // 답한다 — SBOM 없는 자산이 12건 있는데 없다고 말하는 셈이다(검토관 [상]).
  for (const 문장 of ["SBOM 없는 자산 알려줘", "SBOM 미생성 자산 보여줘", "부품표 없는 자산 뭐야", "SBOM 누락 자산 목록"]) {
    it(`"${문장}" → sbom_coverage`, () => {
      expect(실제도착(문장, 규칙), "AI 자산만 세는 도구로 가면 IT 자산이 빠진다").toBe("sbom_coverage");
    });
  }

  it("★★ 생성 요청은 여전히 generate_sbom으로 — 조회로 돌리면 안 만들고 만든 줄 안다", () => {
    for (const 문장 of ["fraud-detect-llm SBOM 생성해줘", "SBOM 만들어줘"]) {
      expect(실제도착(문장, 규칙), `"${문장}"이 조회로 샜다`).not.toBe("sbom_coverage");
    }
  });
});

describe("★ VEX — 개념 물음을 건수표로 답하지 않는다", () => {
  for (const 문장 of ["VEX 파일 내보내줘", "VEX 현황 알려줘", "VEX로 나가면 어떤 상태야?"]) {
    it(`"${문장}" → vex_status`, () => expect(실제도착(문장, 규칙)).toBe("vex_status"));
  }
  for (const 문장 of ["VEX가 뭐야?", "VEX 표준 설명해줘", "VEX란 무엇인가?", "VEX 어떻게 쓰는 거야?"]) {
    it(`"${문장}" — 건수표로 답하지 않는다`, () => {
      expect(실제도착(문장, 규칙), "무엇인지 물었는데 「실릴 취약점 312건」이 나온다").not.toBe("vex_status");
    });
  }
});

describe("★ EOL — 「지원해줘」를 삼키지 않는다(실제 순서로)", () => {
  for (const 문장 of ["지원 끝난 부품 있어?", "EOL 확인해줘", "단종된 소프트웨어 알려줘"]) {
    it(`"${문장}" → eol_check`, () => expect(실제도착(문장, 규칙)).toBe("eol_check"));
  }
  for (const 문장 of ["기술 지원 받을 수 있어?", "지원해줘"]) {
    it(`"${문장}" — eol_check로 안 간다`, () => expect(실제도착(문장, 규칙)).not.toBe("eol_check"));
  }
});

describe("계약 — 규칙이 죽어 있지 않다", () => {
  it("★★ **닿을 수 없는 규칙이 없다** — 앞 규칙에 100% 가려진 규칙은 없어야 한다", () => {
    // 규칙마다 그 규칙만 잡는 문장을 만들 수는 없으니, 대신 **이번에 넣은 새 도구들**이
    // 하나라도 도달 가능한지 본다. 도달 0이면 그 규칙은 죽은 코드다.
    const 확인할것: Record<string, string[]> = {
      set_aibom_field: ["가드레일 기재해줘", "AI-BOM에 데이터셋 출처 채워줘"],
      vex_status: ["VEX 파일 내보내줘"],
      eol_check: ["지원 끝난 부품 있어?"],
      sbom_coverage: ["SBOM 없는 자산 알려줘"],
    };
    for (const [도구, 문장들] of Object.entries(확인할것)) {
      const 닿음 = 문장들.filter((t) => 실제도착(t, 규칙) === 도구);
      expect(닿음.length, `${도구}에 닿는 문장이 하나도 없다 — 죽은 규칙이다`).toBeGreaterThan(0);
    }
  });

  it("규칙을 다 읽었다(뽑는 방식이 낡지 않았다)", () => {
    expect(규칙.length).toBeGreaterThan(70);
  });
});
