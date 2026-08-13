// 온톨로지 한국어 별칭 — **한국어로 물어도 그래프에 닿는가** (2026-08-13 · 계획서 전-7)
//
// ■ 실측이 드러낸 것(`max`, 2026-08-13): 온톨로지 주어 2,166건 중 한글이 든 것은 264건(12%)뿐이고
//   나머지는 영문 ATT&CK 코드명이다. `expandOntology`는 주어 이름이 질문에 **그대로** 들어 있어야
//   걸리므로 —  `T1566 Phishing` 12건 · `T1566` **0건** · `피싱` **0건**.
//   담당자는 코드명을 외우고 있지 않다. **한국어로 물으면 절대 안 닿는 상태**였다.
// ■ ⚠ RAG의 「거리가 밀린다」와 다른 문제다 — 여기는 정확 매칭이라 0이고, 질의 재작성으로도 안 된다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 별칭주어찾기 } from "../src/engine/ontology";
import aliases from "../src/engine/onto-aliases-ko.json";

const 별칭표 = (aliases as { 별칭: Record<string, string[]> }).별칭;
// 매칭은 정규화(공백·가운뎃점 제거 + 소문자) 뒤에 일어난다 — 시험도 같은 자로 잰다.
const norm = (s: string) => s.replace(/[\s·•・\-/]/g, "").toLowerCase();

describe("별칭주어찾기 — 한국어 낱말이 온톨로지 주어로 바뀐다", () => {
  it("★ 「피싱 막으려면 뭘 해야 돼?」가 T1566에 닿는다 — 0건이던 자리", () => {
    expect(별칭주어찾기(norm("피싱 막으려면 뭘 해야 돼?"))).toContain("T1566 Phishing");
  });

  it("담당자가 실제로 쓰는 말들이 닿는다", () => {
    const 확인 = (질문: string, 주어: string) =>
      expect(별칭주어찾기(norm(질문)), 질문).toContain(주어);
    확인("랜섬웨어 대응 어떻게 해?", "T1486 Data Encrypted for Impact");
    확인("망 분리 해야 하나?", "M1030 Network Segmentation");
    확인("다중 인증 적용하려면?", "M1032 Multi-factor Authentication");
    확인("공급망 공격이 뭐야?", "T1195 Supply Chain Compromise");
    확인("프롬프트 인젝션 막는 법", "LLM01:2025 Prompt Injection");
  });

  it("★ 긴 낱말이 먼저 이긴다 — 「무차별 대입」이 「대입」보다 먼저", () => {
    // 짧은 쪽이 먼저 먹으면 엉뚱한 주어가 붙는다. 먹은 자리를 지워 겹침을 막는다.
    const 주어들 = 별칭주어찾기(norm("무차별 대입 공격 막으려면?"));
    expect(주어들).toContain("T1110 Brute Force");
  });

  it("관계 없는 질문에는 아무 주어도 안 붙는다 — 과발동은 엉뚱한 근거를 만든다", () => {
    expect(별칭주어찾기(norm("오늘 점심 뭐 먹지?"))).toEqual([]);
    expect(별칭주어찾기(norm("리포트 만들어줘"))).toEqual([]);
  });
});

describe("별칭표 자체의 무결성 — 틀리면 조용히 안 맞는다", () => {
  it("한 글자 낱말이 없다 — 부분문자열 매칭이라 오탐이 심하다", () => {
    for (const [주어, 낱말들] of Object.entries(별칭표)) {
      for (const w of 낱말들) {
        expect(norm(w).length, `${주어} ← 「${w}」`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  // ★ 2026-08-13 — 계약이 바뀌었다. 옛 시험은 「같은 낱말이 두 주어를 가리키지 않는다」였다.
  //
  //   그 걱정은 **옳았다**: 그때 코드는 먼저 걸린 하나가 자리를 지워 나머지를 영영 못 보게 했고,
  //   어느 쪽이 이기는지가 JSON에 적힌 순서에 달려 있었다("어느 쪽으로 갈지 알 수 없어진다").
  //
  //   그런데 ATLAS 별칭이 들어오자 충돌이 18건 생겼고, 그것들은 **사전의 잘못이 아니었다** —
  //   같은 개념이 표준마다 있을 뿐이다(「코드 서명」 = ATT&CK M1045 + ATLAS AML.M0013).
  //   사전에서 한쪽을 지우면 그 표준이 한국어로 다시 안 닿고, 낱말을 갈라 쓰면(「AI 코드 서명」)
  //   아무도 그렇게 묻지 않는다. → **코드가 둘 다 답하게** 고쳤다(ontology.ts 별칭주어찾기).
  //
  //   그래서 재는 것을 바꾼다: 「충돌이 없는가」가 아니라 **「충돌하는 낱말이 전부 나오는가」**.
  //   ⚠ 이 시험이 옛 계약을 그대로 두면, 옳은 사전이 영원히 빨간불이 된다.
  it("★ 한 낱말이 여러 표준을 가리키면 **전부** 돌려준다 (순서로 하나만 고르지 않는다)", () => {
    const 임자 = new Map<string, string[]>();
    for (const [주어, 낱말들] of Object.entries(별칭표)) {
      for (const w of 낱말들) {
        const k = norm(w);
        임자.set(k, [...(임자.get(k) ?? []), 주어]);
      }
    }
    const 겹친낱말 = [...임자.entries()].filter(([, ss]) => new Set(ss).size > 1);
    // 감시가 헛돌지 않는지 — 겹치는 낱말이 실제로 있어야 이 시험이 뜻을 갖는다.
    expect(겹친낱말.length, "겹치는 낱말이 하나도 없다 — 사전이 바뀌었으면 이 시험을 다시 볼 것").toBeGreaterThan(0);

    const 빠뜨림: string[] = [];
    for (const [낱말, 주어들] of 겹친낱말) {
      const 나온것 = new Set(별칭주어찾기(낱말));
      for (const s of new Set(주어들)) {
        if (!나온것.has(s)) 빠뜨림.push(`「${낱말}」 → ${s} 가 안 나옴 (나온 것: ${[...나온것].join(", ") || "없음"})`);
      }
    }
    expect(빠뜨림, "겹치는 낱말인데 일부 표준만 나온다 — 순서에 따라 답이 갈린다").toEqual([]);
  });

  // 소스 감시 — 날 NUL 문자를 소스에 넣으면 grep이 파일을 **binary로 보고 통째로 건너뛴다.**
  //   2026-08-13 실사고: ontology.ts에 NUL이 하나 섞여 들어가(구분자를 이스케이프 없이 적었다)
  //   소스 수색·정찰 조사에서 이 파일이 빠져 있었다. 기능은 멀쩡해 보여 아무도 몰랐다.
  //   ⚠ 같은 이유로 memory.ts·hybridsearch.ts도 지금 grep에서 빠진다(별건으로 남김).
  it("★ 온톨로지 소스에 날 NUL 문자가 없다 (있으면 grep이 파일을 통째로 건너뛴다)", () => {
    const buf = fs.readFileSync(path.join(__dirname, "../src/engine/ontology.ts"));
    expect(buf.includes(0), "ontology.ts에 날 NUL이 있다 — \\u0000 이스케이프 표기로 적을 것").toBe(false);
  });

  it("주어가 비거나 낱말이 없는 항목이 없다", () => {
    for (const [주어, 낱말들] of Object.entries(별칭표)) {
      expect(주어.trim().length, 주어).toBeGreaterThan(0);
      expect(낱말들.length, 주어).toBeGreaterThan(0);
    }
  });
});
