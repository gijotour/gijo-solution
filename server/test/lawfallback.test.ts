// 법령 답이 부족하면 사내 지식으로 메운다 (2026-08-09, 계획서 후-3 + 중-3).
//
// 무슨 일이 있었나 — **두 번에 걸친 수리**다.
//
// 1차(오전): 법령 도구가 생기자 모델이 그걸 집으면서, 답이 있던 질문에도
//   "🔎 찾지 못했습니다"만 나갔다. 회귀 하네스(tools/regress)가 잡았다 —
//   150상황은 **통과시켰다**(그 문항에 기대 신호가 없어 형식만 봤다).
//   그때 「사내 지식은 0건이니 모델에게 넘기자」로 고쳤다.
//
// 2차(오후) — ⚠ **1차의 전제가 내 측정 실수였다.**
//   /api/memory/query에 본문 키를 question이 아닌 query로 보내 400을 받아 놓고 0건으로 읽었다.
//   제대로 재니 두 질문 다 사내 문서가 **1~2위로** 잡힌다:
//     · 「금융권 망분리」 → 전자금융감독규정 제15조 (1위·3위)
//     · 「접속기록 몇 년」 → 1년/2년 + 시행령 제30조·고시 제8조 (1위·2위)
//   즉 **지식은 있는데 라우팅이 거기 닿지 않았다.** 모델의 일반 지식으로 때우고 있었던 것이다.
//
// 그래서 지금 규칙: 법령 도구가 **부족할 때만** 사내 지식을 얹는다. 찾았으면 안 건드린다 —
// 조문 원문을 모델이 고쳐 쓰는 것이 이 영역에서 가장 위험하다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 법령한계를밝힌다, 법령답이부족한가, 사내지식꼬리표 } from "../src/engine/agentloop";
import { NO_HIT_PREFIX } from "../src/engine/agenttools";

const 못찾음 = `${NO_HIT_PREFIX} "금융권 망분리"로는 법령 검색 결과가 없습니다.`;
const 목록 = '법령 검색 — "개인정보 보호법" (상위 2건)\n1. 개인정보 보호법\n   원문: https://www.law.go.kr/...';
const 조문본문 = "개인정보 보호법 제29조(안전조치의무)\n개인정보처리자는 …";
const 사내근거 = { tool: 사내지식꼬리표, args: {}, result: "접속기록은 1년 이상, 5만명 이상은 2년 이상." };

describe("법령 답이 부족한가 — 판정은 코드가 한다", () => {
  it("★ 못 찾았으면 부족하다", () => {
    expect(법령답이부족한가("금융권 망분리 근거는?", 못찾음)).toBe(true);
  });

  it("★ 목록만 왔는데 「몇 년?」을 물었으면 부족하다 — 목록은 그 질문의 답이 아니다", () => {
    expect(법령답이부족한가("접속기록은 최소 몇 년 보관해야 하고 근거 법령은?", 목록)).toBe(true);
  });

  it("★★ 목록을 **달라고** 물었으면 목록이 정답이다 — 법령 조회의 본래 쓸모를 흔들지 않는다", () => {
    // 이걸 넓게 잡았다가 깨뜨리는 것이 어제 보류한 이유다. 값을 묻는 말일 때만 연다.
    expect(법령답이부족한가("개인정보 보호법 찾아줘", 목록)).toBe(false);
    expect(법령답이부족한가("전자금융거래법 관련 법령 보여줘", 목록)).toBe(false);
  });

  it("★★ 조문 본문을 받았으면 충분하다 — 모델을 태울 이유가 없다", () => {
    expect(법령답이부족한가("개인정보 보호법 제29조는 몇 년이야?", 조문본문)).toBe(false);
  });

  it("값을 묻는 여러 말꼴을 잡는다", () => {
    for (const q of ["몇 년 보관해?", "며칠 이내야?", "얼마나 걸려?", "몇 개월이야?", "몇 건이야?"]) {
      expect(법령답이부족한가(q, 목록), q).toBe(true);
    }
  });

  it("평범한 법령 질문을 값 질문으로 오인하지 않는다", () => {
    for (const q of ["개인정보 보호법 알려줘", "망분리 관련 고시 검색", "판례 찾아줘", "시행령 원문 보여줘"]) {
      expect(법령답이부족한가(q, 목록), q).toBe(false);
    }
  });
});

describe("근거가 어디서 왔는지 답에 못 박는다", () => {
  it("★ 못 찾았지만 사내 자료로 답했으면 — 그렇게 밝힌다", () => {
    const r = 법령한계를밝힌다("전자금융감독규정 제15조입니다.", [
      { tool: "law_lookup", args: {}, result: 못찾음 },
      사내근거,
    ] as never);
    expect(r).toContain("사내 자료를 근거로 답했습니다");
    expect(r).toContain("법제처에서 원문은 확인하지 못했습니다");
    expect(r).toContain("제15조"); // 원래 답은 살아 있다
    // 사내 근거가 있는데 「일반 지식으로 답했다」는 딱지를 붙이면 거짓말이 된다.
    expect(r).not.toContain("법제처에서 원문을 확인하지 못한 답입니다");
  });

  it("★★ 목록 + 사내 자료면 — 법제처 원문(링크)을 그대로 보존한다", () => {
    const r = 법령한계를밝힌다("1년 이상입니다.", [
      { tool: "law_lookup", args: {}, result: 목록 },
      사내근거,
    ] as never);
    expect(r).toContain("사내 자료를 함께 근거로 답했습니다");
    // 모델이 링크를 고쳐 쓰거나 빠뜨려도 코드가 원문을 덧붙여 살린다.
    expect(r).toContain("▸ 법제처에서 찾은 법령");
    expect(r).toContain("https://www.law.go.kr/");
  });

  it("★ 사내 자료도 없으면 — 일반 지식으로 답했다고 못 박는다(1차 수리 그대로)", () => {
    const r = 법령한계를밝힌다("접속기록은 최소 1년 보관해야 합니다.", [
      { tool: "law_lookup", args: {}, result: 못찾음 },
    ] as never);
    expect(r).toContain("법제처에서 원문을 확인하지 못한 답입니다");
    expect(r).toContain("1년 보관");
  });

  it("★★ 찾았고 사내 자료도 안 붙었으면 딱지를 안 붙인다 — 멀쩡한 답을 의심하게 만들지 않는다", () => {
    expect(법령한계를밝힌다(목록, [{ tool: "law_lookup", args: {}, result: 목록 }] as never)).toBe(목록);
  });

  it("법령 도구를 안 썼으면 아무것도 안 붙인다", () => {
    const 답 = "미조치 취약점은 4건입니다.";
    expect(법령한계를밝힌다(답, [{ tool: "finding_status", args: {}, result: "4건" }] as never)).toBe(답);
    expect(법령한계를밝힌다(답, [] as never)).toBe(답);
  });

  it("빈 답에는 딱지만 남기지 않는다 — 딱지뿐인 답은 답이 아니다", () => {
    expect(법령한계를밝힌다("", [{ tool: "law_lookup", args: {}, result: 못찾음 }] as never)).toBe("");
  });
});

describe("배선 (소스 계약)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");

  it("★★ 찾았을 땐 여전히 directAnswer — 조문을 모델이 고쳐 쓰지 못하게", () => {
    expect(src).toContain("return findAgentTool(only.tool)?.directAnswer ? 사람용으로다듬기(only.result) : null;");
  });

  // ⚠ 2026-08-10: 출구가 **네 곳**이었다(강제 분기·final·조회형 즉답·반복 상한).
  //   두 곳에만 심었더니 law_lookup이 directAnswer라 「접속기록 몇 년?」이 즉답 출구로 샜다.
  //   그래서 갈래마다 세는 시험을 버리고 **출구가 하나뿐임**을 지킨다 — 새 갈래가 생겨도
  //   그 함수를 부르지 않으면 여기서 걸린다.
  const 루프본문 = src.slice(src.indexOf("export async function runAgentLoop"));

  it("★★ runAgentLoop의 모든 답 출구는 사람에게내보낸다()를 거친다", () => {
    // toolCalls를 실어 돌려주는 return = 사람에게 답이 나가는 자리.
    const 답출구 = [...루프본문.matchAll(/return \{[^}]*toolCalls: calls[^}]*\}/g)].map((m) => m[0]);
    expect(답출구.length, "답 출구를 하나도 못 찾았으면 이 시험이 헛돌고 있다").toBeGreaterThan(2);
    const 안거친것 = 답출구.filter((r) => !r.includes("사람에게내보낸다") && !r.includes("approvalMessage"));
    expect(안거친것, "결재판(approval) 말고는 전부 그 함수를 거쳐야 한다").toEqual([]);
  });

  it("★ 보강·딱지는 그 함수 **안에서 한 번씩만** 불린다 — 갈래로 흩어지면 또 샌다", () => {
    expect((src.match(/await 사내지식으로보강\(instruction, calls\)/g) ?? []).length).toBe(1);
    expect((src.match(/법령한계를밝힌다\(guardAgainstDenial\(/g) ?? []).length).toBe(1);
  });

  it("★★ 보강이 조립보다 **먼저** 온다 — 뒤면 이미 답이 만들어진 뒤다", () => {
    const 함수 = src.slice(src.indexOf("async function 사람에게내보낸다"));
    const 보강 = 함수.indexOf("await 사내지식으로보강");
    const 조립 = 함수.indexOf("composeFinalAnswer");
    expect(보강).toBeGreaterThan(-1);
    expect(보강, "보강 → 조립 순서여야 한다").toBeLessThan(조립);
  });
});
