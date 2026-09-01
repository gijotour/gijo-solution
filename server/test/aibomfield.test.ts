// AI-BOM 5영역 기입 도구 — 대화로 (2026-09-01 · 대장 §3-4 항목 5 · 계획서 중-7)
//
// 왜: 「이 AI 자산의 시스템 프롬프트·가드레일 기재해줘」가 **화면으로만** 가능했다.
// 그 화면(sbom.html)에 입력칸 13개가 살아 있는 것이 「메뉴는 보기용 · 새 화면에 입력칸 금지」
// 원칙과 어긋나 있었다 — 대화로 넣는 길을 내야 그 입력칸을 걷어낼 수 있다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AIBOM칸찾기, runSetAiBomField } from "../src/engine/agenttools/handlers";

const 셸 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
const 규칙 = (() => {
  const i = 셸.indexOf('tool: "set_aibom_field"');
  const j = 셸.lastIndexOf("re: /", i);
  const 줄 = 셸.slice(j + 5, 셸.indexOf("/,", j));
  return new RegExp(줄);
})();

describe("칸 이름 찾기 — 화면에서 본 이름을 대화창에 대도 먹어야 한다", () => {
  it("짧은 이름으로 찾는다", () => {
    expect(AIBOM칸찾기("가드레일")?.키).toBe("guardrails");
    expect(AIBOM칸찾기("시스템 프롬프트")?.키).toBe("systemPrompt");
  });

  it("★ 화면에 적힌 **긴 이름 그대로**도 먹는다 — 사람은 화면에서 본 것을 그대로 읽는다", () => {
    expect(AIBOM칸찾기("가드레일(Guardrail) 규칙")?.키).toBe("guardrails");
    expect(AIBOM칸찾기("기초 모델 (Foundation Model)")?.키).toBe("foundationModel");
  });

  it("★ 둘 이상 걸리면 **아무거나 고르지 않는다**", () => {
    // "모델"은 기초 모델·서빙 환경 등 여러 칸에 걸린다. 하나로 안 좁혀지면 null이라
    // 도구가 「어느 칸인지 모르겠습니다」라고 되묻는다 — 조용히 엉뚱한 칸에 적는 것보다 낫다.
    expect(AIBOM칸찾기("모델")).toBeNull();
  });

  it("모르는 이름은 null", () => {
    expect(AIBOM칸찾기("냉장고")).toBeNull();
    expect(AIBOM칸찾기("")).toBeNull();
  });
});

describe("★★ 화면과 칸 목록이 어긋나지 않는다", () => {
  it("sbom.html의 칸이 **전부** 대화에서도 적을 수 있다", () => {
    // 한쪽만 늘면 여기서 걸린다. 화면에 칸이 생겼는데 대화로 못 적으면
    // 「대화로 다 된다」는 말이 거짓이 되고, 그 화면의 입력칸을 못 걷어낸다.
    const 화면 = readFileSync(
      join(__dirname, "..", "..", "client", "src", "renderer", "pages", "sbom.html"),
      "utf8",
    );
    const 화면칸 = [...화면.matchAll(/\{ k: "([a-zA-Z]+)", label: "([^"]+)" \}/g)].map((m) => m[1]);
    expect(화면칸.length, "화면에서 칸 목록을 못 읽었다").toBeGreaterThan(10);
    // ⚠ **예외는 하나뿐이고 이유가 있다.** 이유 없는 예외를 늘리면 이 시험이 무력해진다.
    //   weightsHash — 모델 파일에서 계산하는 값이라 손으로 적으면 「검증했다」는 거짓 증거가 된다.
    //   (modelRef는 이 목록에 없다 — 화면에서도 자유 글이 아니라 드롭다운이다.)
    const 일부러뺀칸 = new Set(["weightsHash"]);
    const 못적는것 = 화면칸.filter((k) => !일부러뺀칸.has(k) && !AIBOM칸찾기(k));
    expect(못적는것, `화면에는 있는데 대화로 못 적는 칸: ${못적는것.join(", ")}`).toEqual([]);
    // 예외 자체도 감시한다 — 실수로 열리면 여기서 걸린다.
    for (const k of 일부러뺀칸) {
      expect(AIBOM칸찾기(k), `${k}는 대화로 적을 수 없어야 한다`).toBeNull();
    }
  });
});

describe("⛔ 손대지 않는 두 칸 — 막는 이유가 서로 다르다", () => {
  it("가중치 해시는 **계산값**이라 손으로 적으면 거짓 증거가 된다", async () => {
    const 답 = await runSetAiBomField({ asset: "아무거나", field: "가중치 해시", value: "abc123" });
    expect(답).toContain("⛔");
    expect(답, "왜 안 되는지 안 말한다").toContain("계산하는 값");
  });

  it("서빙 모델 연결은 **목록 선택**이라 자유 글이면 연결이 끊긴다", async () => {
    const 답 = await runSetAiBomField({ asset: "아무거나", field: "서빙 모델", value: "qwen" });
    expect(답).toContain("⛔");
    expect(답, "왜 안 되는지 안 말한다").toContain("목록에서 고르는");
  });

  it("★ 막을 때 **어디서 하면 되는지** 알려 준다 — 그냥 안 된다고 두지 않는다", async () => {
    for (const f of ["가중치 해시", "서빙 모델"]) {
      const 답 = await runSetAiBomField({ asset: "x", field: f, value: "v" });
      expect(답, `${f}: 대신 어디서 하는지 안 알려 준다`).toContain("AI-BOM 화면");
    }
  });
});

describe("★★ 낱말 가로채기 — 훨씬 흔한 조회를 삼키면 안 된다", () => {
  const 삼키면안됨 = [
    "AI-BOM 현황 알려줘",
    "AI-BOM 보여줘",
    "SBOM 얼마나 채워졌어?",
    "AI-BOM 얼마나 채워졌어?",
    "가드레일 규칙 뭐야?",
    "가드레일이 어떻게 동작해?",
    "시스템 프롬프트 보여줘",
    "SBOM 없는 자산 알려줘",
    "fraud-detect-llm SBOM 생성해줘",
    "MCP 서버 목록 보여줘",
    "자산 등록해줘",
    "문서 입력해줘",
  ];
  for (const 문장 of 삼키면안됨) {
    it(`"${문장}" — 안 삼킨다`, () => {
      expect(규칙.test(문장), `기입 규칙이 "${문장}"을 가로챘다`).toBe(false);
    });
  }

  const 잡아야함 = [
    "fraud-detect-llm 가드레일 기재해줘",
    "이 자산 시스템 프롬프트 적어줘",
    "AI-BOM에 데이터셋 출처 채워줘",
    "호스팅 공급업체 기입해줘",
  ];
  for (const 문장 of 잡아야함) {
    it(`"${문장}" — 잡는다`, () => {
      expect(규칙.test(문장), `기입 규칙이 "${문장}"을 놓쳤다`).toBe(true);
    });
  }
});

describe("계약 — 쓰기 도구다", () => {
  const 등록 = readFileSync(join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf8");

  it("write:true다 — 결재판이 떠야 한다(남의 명세를 덮어쓸 수 있다)", () => {
    const i = 등록.indexOf('name: "set_aibom_field"');
    expect(i, "등록부에 없다").toBeGreaterThan(-1);
    expect(등록.slice(i, i + 400)).toContain("write: true");
  });

  it("★ 결재판 문구가 **덮어쓴다는 사실**을 미리 말한다", () => {
    const i = 등록.indexOf('name: "set_aibom_field"');
    expect(등록.slice(i, i + 1800), "덮어쓴다는 걸 결재 전에 안 알린다").toContain("덮어씀");
  });
});

describe("「SBOM 없는 자산 알려줘」 — 전용 분기 (대장 §3-4 항목 2)", () => {
  // ⚠ 규칙을 손수 떼어 내 홀로 test하던 것을 걷어냈다(2026-09-01 검토관 [상]).
  //   그 방식은 **자기가 만든 정규식을 자기가 확인하는** 꼴이라, 앞 규칙이 이미 삼키고
  //   있어도 초록이었다. 도착지 자체가 옳은지는 routing-order.test.ts가 실제 순서로 본다.
  //   여기서는 규칙 **글자**에만 남은 함정 하나를 지킨다.
  it("★ 「미생성」이 「생성」을 품는 함정 — (?<!미)가 살아 있다", () => {
    // 이 한 글자가 빠지면 「SBOM 미생성 자산 보여줘」가 스스로 배제돼 규칙이 통째로 헛돈다.
    // 헛도는 규칙은 시험 없이는 안 보인다 — 아무 일도 안 일어나는 것처럼 보이기 때문이다.
    const i = 셸.indexOf("📦 SBOM 없는 자산 —");
    expect(i, "규칙을 못 찾았다 — 이 시험이 낡았다").toBeGreaterThan(-1);
    const 둘레 = 셸.slice(i, i + 1400);
    expect(둘레, "(?<!미) 예외가 사라졌다").toContain("(?<!미)");
  });
});
