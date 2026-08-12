// 온톨로지 한국어 별칭 — **한국어로 물어도 그래프에 닿는가** (2026-08-13 · 계획서 전-7)
//
// ■ 실측이 드러낸 것(`max`, 2026-08-13): 온톨로지 주어 2,166건 중 한글이 든 것은 264건(12%)뿐이고
//   나머지는 영문 ATT&CK 코드명이다. `expandOntology`는 주어 이름이 질문에 **그대로** 들어 있어야
//   걸리므로 —  `T1566 Phishing` 12건 · `T1566` **0건** · `피싱` **0건**.
//   담당자는 코드명을 외우고 있지 않다. **한국어로 물으면 절대 안 닿는 상태**였다.
// ■ ⚠ RAG의 「거리가 밀린다」와 다른 문제다 — 여기는 정확 매칭이라 0이고, 질의 재작성으로도 안 된다.
import { describe, it, expect } from "vitest";
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

  it("같은 낱말이 두 주어를 가리키지 않는다 — 어느 쪽으로 갈지 알 수 없어진다", () => {
    const 임자 = new Map<string, string>();
    const 충돌: string[] = [];
    for (const [주어, 낱말들] of Object.entries(별칭표)) {
      for (const w of 낱말들) {
        const k = norm(w);
        const 먼저 = 임자.get(k);
        if (먼저 && 먼저 !== 주어) 충돌.push(`「${w}」 → ${먼저} vs ${주어}`);
        else 임자.set(k, 주어);
      }
    }
    expect(충돌).toEqual([]);
  });

  it("주어가 비거나 낱말이 없는 항목이 없다", () => {
    for (const [주어, 낱말들] of Object.entries(별칭표)) {
      expect(주어.trim().length, 주어).toBeGreaterThan(0);
      expect(낱말들.length, 주어).toBeGreaterThan(0);
    }
  });
});
