// 제목으로 문서를 지목한 물음이 **그 문서로 가는가** (2026-09-08 · 라이브 재현 수리)
//
// ★★ 왜 이 시험이 필요한가 (라이브 실측, 운영 WSL 4000)
//   ① 「AI 시대 소프트웨어 보안 점검표에서 출시 전 점검 항목 알려줘」
//      → explain은 탔는데 sources=null·근거세기=「-」, 답은 시큐어코딩 일반론이었다.
//        정작 그 문서 98행에 「## 5. ② 출시 전 보안 점검」 표가 버젓이 있다.
//   ② 「금융 취약점 평가기준 항목 알려줘」
//      → **아무 강제 규칙에도 안 걸려**(route-explain: 「걸리는 규칙 없음」) ⑨ 모델 선택으로
//        떨어졌고, 모델이 compliance_status를 골라 KISA 위협 카탈로그(S01 데이터 포이즈닝 ·
//        S02 모델 포이즈닝…)를 「평가기준 항목」이라며 답했다. 지목 문서와 아무 상관이 없다.
//   ⚠ ②는 compliance_status 규칙을 좁혀서는 못 고친다 — 규칙이 채 간 게 아니라 **아무 규칙도
//     없어서** 모델 재량이 답했다. 막히는 층은 라우팅뿐이다.
//
// ■ 뿌리: 「지목했는가」를 재는 기계가 두 층 모두 **실제 문서 제목을 몰랐다**
//   · 라우팅(memory.문서지목질문)은 문서 목록을 인자로도 안 받는다 — 유형어+조사라는 언어패턴뿐.
//     그래서 유형어가 없는 제목(「…평가기준」)이나 조사가 안 붙는 제목(「가이드라인에서」 —
//     가이드 뒤가 '라')은 이름을 정확히 대도 **지목 아님**이 된다.
//   · 랭킹(hybridsearch.docScopeMatch)은 업로드 문서만 봤고, 지식 문서는 전부 origin='builtin'이라
//     지목 부스트를 **원리상** 못 받았다. 게다가 토큰 규칙 length>=4가 한글에서 죽었다.
//
// ■ 판정은 **제품 함수**(forcedToolFor)가 한다 — 정규식을 떼어 혼자 재면 앞 규칙이
//   가로채는 것을 못 본다(helpers/routing.ts 머리글).
import { describe, it, expect, beforeAll } from "vitest";
import { 실제도착, 가로챈규칙 } from "./helpers/routing";

// 운영 코퍼스의 실제 이름들(지식 35편 중 이 라운드에 걸린 것 + 회귀를 지킬 이웃).
const 문서들: [string, string | null][] = [
  ["GIJO_지식_AI시대_소프트웨어_보안점검표.md", "builtin"],
  ["GIJO_지식_금융_취약점_평가기준.md", "builtin"],
  ["GIJO_지식_금융_AI_보안_가이드라인.md", "builtin"],
  ["GIJO_지식_개인정보_자율점검표.md", "builtin"],
  ["GIJO_지식_중소기업_정보보호_점검표.md", "builtin"],
  ["GIJO_지식_랜섬웨어_대응.md", "builtin"],
  ["GIJO_지식_침해사고_대응절차.md", "builtin"],
  ["GIJO_AS_취약점관리_지침.md", "builtin"],
  ["GIJO_AS_용어사전.md", "builtin"],
  ["solidstep_manual.pdf", null],
];

beforeAll(async () => {
  const { db } = await import("../src/db");
  const ins = db.prepare(
    "INSERT OR REPLACE INTO memory_documents (documentId, scope, chunks, ingestedAt, origin) VALUES (?, 'global', 1, datetime('now'), ?)",
  );
  for (const [id, origin] of 문서들) ins.run(id, origin);
});

describe("★★ 제목 지목 — 증상 문장이 explain(지목 문서)으로 간다", () => {
  for (const 문장 of [
    "AI 시대 소프트웨어 보안 점검표에서 출시 전 점검 항목 알려줘",
    "금융 취약점 평가기준 항목 알려줘",
    "금융 AI 보안 가이드라인에서 안전성 요건 알려줘",
    "개인정보 자율점검표에 접속기록 점검 항목 뭐야",
  ]) {
    it(`「${문장}」 → explain`, () => {
      const 도둑 = 가로챈규칙(문장, "explain");
      expect(
        실제도착(문장),
        도둑 ? `앞 규칙 [${도둑.차례}] ${도둑.도구}가 가로챘다` : "아무 규칙에도 안 걸린다 — ⑨ 모델이 엉뚱한 도구를 고른다",
      ).toBe("explain");
    });
  }

  it("★ 지목한 문장은 지시문을 **통째로** topic으로 넘긴다 — 발췌 검색이 같은 말을 봐야 한다", async () => {
    const { forcedToolFor } = await import("../src/engine/agentloop");
    const 문장 = "금융 취약점 평가기준 항목 알려줘";
    expect(forcedToolFor(문장)).toEqual({ tool: "explain", args: { topic: 문장 } });
  });
});

describe("★ 반례 — 새 갈래가 남의 말을 삼키지 않는다", () => {
  // ⚠ 「개인정보 보호법 제28조 알려줘」는 **원래도 강제가 아니다**(제품 실측: forcedToolFor=null →
  //   ⑨ 모델이 law_lookup을 고른다). 여기서 잴 것은 「law_lookup으로 간다」가 아니라
  //   **「새 갈래가 안 삼킨다」**이다 — 안 그러면 제품이 안 하는 일을 시험이 요구하게 된다
  //   (「기대표는 제품을 보고 적는다」).
  it("법령 질문을 새 갈래가 삼키지 않는다 — 종전 그대로(강제 없음 → 모델이 law_lookup)", () => {
    expect(실제도착("개인정보 보호법 제28조 알려줘"), "법령질문RE가 앞에서 뺀다").toBe(null);
    // 문서 이름 토큰이 통째로 들어 있어도 법령어가 있으면 비켜선다
    expect(실제도착("개인정보 보호법에서 금융 취약점 평가기준이 뭐야?")).toBe(null);
  });

  it("KPI(사내 지표율)는 그대로 kpi_status", () => {
    expect(실제도착("우리 조치율 어떻게 돼?")).toBe("kpi_status");
  });

  it("제품 설명 질문은 앞머리 갈래가 먼저 잡아 **이름만** topic으로 넘긴다", async () => {
    const { forcedToolFor } = await import("../src/engine/agentloop");
    const r = forcedToolFor("Tenable Web App Scanning이 무슨 제품이야?");
    expect(r?.tool).toBe("explain");
    expect(r?.args.topic, "지시문 전체가 아니라 이름이어야 한다(앞머리 갈래가 이겼다는 증거)")
      .toBe("Tenable Web App Scanning");
  });

  it("SolidStep 매뉴얼 콕집기는 무변 — 업로드 경로도 같은 잣대로 잡힌다", () => {
    expect(실제도착("SolidStep 매뉴얼에서 Windows 수동진단 알려줘")).toBe("explain");
  });

  it("★★ 침해·장애는 **dispatcher 특수경로**([32]~[34])가 앞이라 안 뺏긴다", async () => {
    const { 침해사고질문인가 } = await import("../src/engine/incidentsteps");
    // 「랜섬웨어_대응」·「침해사고_대응절차」는 제목 토큰이 그대로 들어맞아 **앞머리에 뒀다면
    //   실제로 뺏겼을** 문장이다(설계관 정정의 핵심 근거). 체인이 먼저 잡는지 확인한다.
    expect(침해사고질문인가("랜섬웨어 대응 절차 알려줘"), "체인 [33]이 먼저 잡아야 한다").toBe(true);
    expect(침해사고질문인가("침해사고 의심될 때 대응 절차 알려줘")).toBe(true);
  });

  it("일반 주제 질문은 강제하지 않는다 — 종전 길 그대로", () => {
    expect(실제도착("취약점 관리는 어떻게 해?"), "「취약점관리」 5자 한 토큰 → 미성립").not.toBe("explain");
    expect(실제도착("오늘 뭐부터 볼까?")).toBe("today");
  });
});
