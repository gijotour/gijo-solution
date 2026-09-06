// server/test/memorymix.test.ts — **검색 자리 배분**이 사내 승인 문답에 독점되지 않는가.
//
// ★ 왜 이 파일이 생겼나(2026-09-07 라이브 사고):
//   「보안 교육을 몇 번 해야 해?」에 제품이 **「연 2회 이상 실시해야 합니다」**로 답했다.
//   근거 4건 중 3건이 사내 승인 문답이었고, 그 3건의 원문은 답이 아니라 **점검 질문**
//   (「…연 2회 이상 실시하고 있습니까?」)이었다. 숫자의 뿌리는 안내서의 **「예시: 연 2회」**다 —
//   예시 → 점검질문 → 의무 단정으로 3단 변질됐다. 지어낸 숫자(환각)가 아니라 **자리 독점**이다.
//
//   뿌리: 자리 배분이 **문서 단위**로만 나뉜다. 운영 코퍼스는 memory_documents 3,921건 중
//   3,778건(96.4%)이 승인 문답이고 **문서당 조각이 1.006개**다(내장 권위 문서는 63건에
//   1,424조각 = 문서당 22.6). 그래서 승인 문답은 **문서마다 제 몫을 하나씩** 챙기고,
//   권위 문서는 관련 조각이 아무리 많아도 「문서당 3칸」으로 묶인다.
//   실측: 같은 물음이 topK=4에서 승인문답 3/4, topK=16에서 7/16 — **자리가 좁을수록 심해진다**
//   (점수가 아니라 배분 문제라는 증거).
//
// ⚠ 이 시험은 **제품 함수를 직접 부른다**(사본 금지). 잣대(승인문답문서)도 docorigin 한 곳을 쓴다 —
//   여기에 접두 문자열을 베끼면 「같은 것을 두 곳에 적으면 어긋난다」가 그대로 재발한다.
//
// 계획서: 전-7(보여 주기) 곁가지 — 근거가 답을 이끄는 자리의 정직성.
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { 문서를섞어자르기 } from "../src/engine/memory";
import { 승인문답문서, 승인문답_접두 } from "../src/engine/docorigin";
import { APPROVED_QA_DOC_PREFIX, approvedQaDocId } from "../src/engine/learnmemory";

type 조각 = { documentId: string; text: string };

/** 라이브 코퍼스를 축소해 재현한다 — 1조각짜리 승인 문답 여러 건 + 조각 많은 권위 문서 하나. */
const 조각들 = (승인문답수: number, 권위조각수: number): 조각[] => {
  const 목록: 조각[] = [];
  // 실제 융합 순서를 흉내 낸다: 권위 문서 머리 조각 하나가 1위, 그 뒤로 승인 문답이 줄줄이,
  // 권위 문서의 나머지 조각(제28조 표·「연 1회 이상」 대목)은 그보다 뒤에 온다.
  목록.push({ documentId: "GIJO_지식_보안인식교육.md", text: "머리 요약" });
  for (let i = 0; i < 승인문답수; i += 1) 목록.push({ documentId: approvedQaDocId(`qa${i}`), text: `점검 질문 ${i}` });
  for (let i = 1; i < 권위조각수; i += 1) 목록.push({ documentId: "GIJO_지식_보안인식교육.md", text: `본문 ${i}` });
  return 목록;
};

const 가족수 = (목록: 조각[]): number => 목록.filter((c) => 승인문답문서(c.documentId)).length;

describe("★★ 출처 가족 몫 — 1조각짜리 사내 문답이 자리를 독점하지 못한다", () => {
  it("① top-4에 승인 문답은 **1건까지**다 — 라이브 사고 재현(그때는 3건이었다)", () => {
    const 결과 = 문서를섞어자르기(조각들(5, 3), 4);
    expect(결과.length, "개수 계약 — 돌려주는 개수는 전과 같아야 한다").toBe(4);
    expect(
      가족수(결과),
      `승인 문답이 top-4를 ${가족수(결과)}칸 먹었다 — 라이브에서 답이 뒤집힌 그 구성이다`,
    ).toBeLessThanOrEqual(1);
    // 밀려났던 권위 문서 본문이 그 자리에 들어와야 한다(자리만 비우고 안 채우면 근거가 준다).
    expect(결과.filter((c) => c.documentId === "GIJO_지식_보안인식교육.md").length).toBe(3);
  });

  it("② topK=16에서도 가족 몫은 topK/4 — 자리가 넓어져도 비율은 지킨다", () => {
    const 결과 = 문서를섞어자르기(조각들(30, 20), 16);
    expect(결과.length).toBe(16);
    expect(가족수(결과), "가족 몫 4칸(16/4)을 넘었다").toBeLessThanOrEqual(4);
  });

  it("③ **개수는 절대 줄지 않는다** — 고치려다 근거를 줄이면 그게 새 결함이다", () => {
    for (const [승인, 권위, topK] of [[5, 3, 4], [50, 1, 8], [2, 30, 16], [0, 40, 4]] as const) {
      const 후보 = 조각들(승인, 권위);
      const 결과 = 문서를섞어자르기(후보, topK);
      expect(결과.length, `승인${승인}·권위${권위}·topK${topK}`).toBe(Math.min(후보.length, topK));
    }
  });

  it("④ 후보가 **전부 승인 문답**이면 하한 1이 아니라 자리를 다 채운다 — 답이 사라지면 안 된다", () => {
    // ☑ 지정 범위(ragscope)로 승인 문답만 후보에 남는 경우가 원리상 가능하다.
    // 대체할 비가족 조각이 없으면 미룸 되채움이 자리를 끝까지 메운다(개수 계약).
    const 후보 = Array.from({ length: 9 }, (_, i) => ({ documentId: approvedQaDocId(`only${i}`), text: `문답 ${i}` }));
    const 결과 = 문서를섞어자르기(후보, 4);
    expect(결과.length, "가족 몫이 답을 통째로 지웠다").toBe(4);
  });

  it("⑤ 옛 계약 그대로 — 가족이 아닌 한 문서는 여전히 **3칸까지**", () => {
    const 후보: 조각[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ documentId: "big.pdf", text: `p${i}` })),
      { documentId: "small.md", text: "s0" },
      { documentId: "other.md", text: "o0" },
    ];
    const 결과 = 문서를섞어자르기(후보, 4);
    expect(결과.filter((c) => c.documentId === "big.pdf").length, "한 PDF 독점 방지가 깨졌다").toBe(3);
    expect(결과.length).toBe(4);
  });

  it("⑥ 침해사고 사례는 **가족이 아니다** — 「[사례] 제목」으로 내보내기로 한 결정과 충돌한다", () => {
    const 후보: 조각[] = [
      { documentId: "GIJO_지식.md", text: "머리" },
      ...Array.from({ length: 5 }, (_, i) => ({ documentId: `incident-case:ic-${i}`, text: `사례 ${i}` })),
    ];
    const 결과 = 문서를섞어자르기(후보, 4);
    expect(결과.filter((c) => c.documentId.startsWith("incident-case:")).length).toBe(3);
  });
});

describe("★★ 반증 — **가드를 빼면 다시 빨개진다**(안 그러면 이 시험은 아무것도 안 지킨다)", () => {
  // 4번째 인자 `가족인가`가 곧 가드다. `() => false`를 넣으면 **아무도 가족이 아니게** 되어
  // 옛 판(문서당 몫만) 그대로 돈다 — 그 결과가 라이브에서 답을 뒤집은 그 구성이어야 한다.
  it("가족 잣대를 끄면 top-4의 승인 문답이 **3건으로 되돌아온다** — 라이브 실물 구성", () => {
    const 옛판 = 문서를섞어자르기(조각들(5, 3), 4, 3, () => false);
    expect(가족수(옛판), "가드를 껐는데도 안 빨개진다면 이 시험은 다른 것을 재고 있다").toBe(3);
    expect(옛판.length).toBe(4);
  });

  it("미룸 되채움 순서도 가드다 — 끄면 **되채움이 몫을 그 자리에서 되돌린다**", () => {
    // topK=6이라야 첫 바퀴에 자리가 남아 되채움이 실제로 돈다(topK=4는 첫 바퀴에 다 찬다).
    const 후보 = 조각들(4, 5); // 권위 5조각 + 승인 문답 4건
    expect(가족수(문서를섞어자르기(후보, 6)), "비가족을 먼저 되채우지 않았다").toBe(1);
    // 가드를 끄면 승인 문답 4건이 **그대로 다 실린다**(문서당 몫은 1조각 문서에 원리상 안 걸린다).
    expect(가족수(문서를섞어자르기(후보, 6, 3, () => false)), "옛 판이 재현되지 않는다").toBe(4);
  });
});

describe("★ 잣대는 한 곳 — 접두 문자열을 두 곳에 적지 않는다", () => {
  it("learnmemory는 docorigin의 접두를 **재수출**만 한다", () => {
    expect(APPROVED_QA_DOC_PREFIX).toBe(승인문답_접두);
    expect(승인문답문서(approvedQaDocId("dtmtljmeoejfjk6d"))).toBe(true);
    expect(승인문답문서("GIJO_지식_보안인식교육.md")).toBe(false);
    expect(승인문답문서(null)).toBe(false);
  });

  it("learnmemory.ts 소스에 접두 **리터럴이 다시 적히지 않았다** — 되살아나면 어긋난다", () => {
    const src = fs.readFileSync(new URL("../src/engine/learnmemory.ts", import.meta.url), "utf8");
    const 리터럴 = src.match(/"승인문답:"/g) ?? [];
    expect(리터럴.length, "learnmemory가 접두를 다시 손으로 적었다 — docorigin에서 가져와야 한다").toBe(0);
  });

  it("memory.ts는 **자기 판정을 새로 적지 않고** docorigin을 부른다", () => {
    const src = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    // ⚠ 낱말만 찾으면 **주석에 남은 이름**으로도 통과한다(반증에서 실제로 그랬다).
    //   ① 잎에서 가져오는 import ② 자르기의 기본 잣대로 **묶여 있는가** — 둘을 다 본다.
    expect(src, "docorigin에서 가족 잣대를 가져오지 않는다").toMatch(
      /import\s*\{[^}]*승인문답문서[^}]*\}\s*from\s*["']\.\/docorigin["']/,
    );
    expect(src, "가족 잣대가 자르기에 안 묶여 있다 — 가져오기만 하면 아무 일도 안 한다").toContain(
      "가족인가: (documentId: string) => boolean = 승인문답문서",
    );
    expect(src.match(/"승인문답:"/g) ?? [], "memory.ts에 접두 사본이 생겼다").toHaveLength(0);
  });
});

describe("★ 하네스의 그림자 접두 — .mjs 도구가 TS를 못 불러 생긴 사본을 **시험이 붙든다**", () => {
  it("tools/opssim-rules.mjs의 접두가 docorigin과 같다", async () => {
    // 회귀 하네스(⑰)는 근거 목록에서 「승인문답:」을 세어 독점을 잡는다. 접두가 어긋나면
    // 하네스가 **0건**을 세고 조용히 초록이 된다 — 0건 초록이 가장 나쁜 거짓말이다.
    const rules = await import("../../tools/opssim-rules.mjs");
    expect(rules.승인문답_접두_그림자).toBe(승인문답_접두);
  });
});

describe("★ 후보 폭 — 몫을 걸어도 **대체할 조각이 후보에 없으면** 아무 일도 안 일어난다", () => {
  it("hybridSearch 후보 바닥이 64다 — 16이면 3변형 합집합을 1조각 문서가 먹는다", () => {
    // ⚠ 소스 감시인 이유: 이 숫자는 몫과 **짝**이다. 바닥을 16으로 되돌리면 시험 ①은 여전히
    //   초록인데(순수 함수라 후보를 내가 만든다) 라이브는 그대로 빨갛다 — 그 조합이 이 사고다.
    const src = fs.readFileSync(new URL("../src/engine/memory.ts", import.meta.url), "utf8");
    expect(src, "후보 폭이 되돌아갔다").toContain("Math.max(topK * 4, 64)");
  });
});
