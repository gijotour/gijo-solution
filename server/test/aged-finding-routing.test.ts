// 「오래된/패치 안 된 지 오래된」류 미조치 취약점 물음 라우팅 — B7 ②(2026-09-11 22:33 야간
// 회귀 예행 205상황 중 2 · 계획서 전-6 정직 · 중-3 평가 게이트).
//
// ■ 뿌리
//   「패치 안 된 지 오래된 거 알려줘」(ops-sim ② 문항)가 route-explain 실측 「걸리는 규칙
//   없음 → ⑨ 모델 선택」이었고, 14B가 eol_check(부품 지원종료 표)를 골라 「전체 자산 부품
//   N개를 지원종료 표(9줄)와 맞춰 봤습니다」라는 엉뚱한 답을 냈다(기대: 오래 미조치된
//   취약점 목록). 「오래」는 제품에 잣대가 없는 말이다(발견일·age 필드가 없다 — bridge.ts
//   StandardFinding·approvals.ts FindingReview 전수 확인). picklist.isFindingListAsk에
//   picklist.오래미조치물음을 OR로 더해, 이미 같은 뜻을 받고 있는 [14] findingListAnswer로
//   모은다 — 새 정렬 잣대를 지어내지 않고 급한 순(KEV→EPSS→VPR) 목록 + 정직 단서로 답한다.
//   이 한 줄이 B7 root_causes ④(「오래된 취약점 알려줘」가 FORCED_INTENTS[1] search로
//   새어 query="오래된"이 되던 구멍)도 함께 닫는다 — [14]가 [37] search보다 먼저 돈다.
//
// ■ 판정은 제품 함수로 한다 — helpers/routing.ts 머리글(정규식을 떼어 혼자 재면 앞 규칙이
//   가로채는 것을 못 본다). 결정적도착지(dispatcher.ts)를 그대로 부른다.
// ⚠ 2026-09-12 검토관 [하] — forcedToolFor·실제도착 import를 지웠다. 한 번도 부르지 않는
//   창구였는데, 이 저장소에서 시험의 import는 「무엇으로 쟀는가」의 증거로 읽힌다(안 쓰는
//   창구를 적어 두면 다음 사람이 그 축까지 덮인 줄 알고 회귀를 따로 안 짠다). 여기 판정은
//   결정적도착지·isFindingListAsk·오래미조치물음·findingListAnswer **네 제품 함수**가 한다.
import { describe, it, expect } from "vitest";
import { 결정적도착지 } from "../src/engine/dispatcher";
import { isFindingListAsk, findingListAnswer, 오래미조치물음, 오래된순없음단서 } from "../src/engine/picklist";
import { 물음속심각도 } from "../src/engine/tone";

describe("★ 「오래된/패치 안 된 지 오래된」류는 findingListAnswer(목록+체크칸)로 결정적으로 간다", () => {
  const 양성 = [
    "패치 안 된 지 오래된 거 알려줘", // ← ops-sim ② 문항 그대로
    "오래된 취약점 알려줘",
    "오래 방치된 취약점 알려줘",
    "오랫동안 안 고친 취약점 알려줘",
    "오래된 미조치 건 알려줘",
    "장기간 방치된 취약점 알려줘",
    "한참 안 고친 취약점 있어?",
    "방치된 지 오래된 취약점 뭐 있어?",
    // 이미 [14]였던 이웃 6문장 — 회귀 못박기(같은 함수로 모였다는 증거).
    "묵은 취약점 뭐 있어?",
    "오래 묵은 취약점 보여줘",
    "조치 안 된 지 오래된 취약점 보여줘",
    "미조치 오래된 것 뭐 있어?",
    "패치 안 된 지 오래된 취약점 목록",
    "오래된 미조치 취약점 현황",
  ];
  for (const 문장 of 양성) {
    it(`「${문장}」 → findingListAnswer(목록+체크칸)`, async () => {
      const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
      expect(걸림[0]?.도착 ?? null, `실제 걸림: ${걸림.map((x) => x.도착).join(" → ") || "(아무것도 안 걸림)"}`).toBe(
        "findingListAnswer(목록+체크칸)",
      );
    });
  }

  // ④ B7 root_causes ④ 못박기 — 「오래된 취약점 알려줘」는 forcedToolFor 단독으로는 여전히
  //   search(query="오래된")로 답할 수 있지만, **결정적도착지의 첫 걸림은 [14]다**(자리가
  //   방어라는 것을 시험이 기록한다 — [14]가 forcedToolFor보다 먼저 도는 특수경로이므로).
  it('결정적도착지("오래된 취약점 알려줘")의 첫 걸림은 [14](자리가 방어다 — forcedToolFor보다 먼저 돈다)', async () => {
    const 걸림 = await 결정적도착지("오래된 취약점 알려줘", { 역할: "admin" });
    expect(걸림[0]?.이름).toBe("취약점 목록 고르기");
    expect(걸림[0]?.도착).toBe("findingListAnswer(목록+체크칸)");
  });
});

describe("★★ 이웃 갈래를 안 뺏는다 — 착수 전 도착지가 그대로다(회귀 못박기)", () => {
  const 이웃 = [
    { 문장: "기한 지난 취약점 있어", 기대: "finding_status" },
    { 문장: "기한 지난 일 있어", 기대: "urgent_todo" },
    { 문장: "기한 지난 점검 일정 알려줘", 기대: "maintenance_status" },
    { 문장: "오래된 문서 정리해줘", 기대: "kbhygiene 리포트" },
    { 문장: "자료가 오래됐어", 기대: "scan_status" },
    { 문장: "지원 끝난 부품 있어?", 기대: "eol_check" },
    { 문장: "EOL 확인해줘", 기대: "eol_check" },
    { 문장: "조각 없는 문서 있어?", 기대: "doc_chunk_gaps" },
    { 문장: "오래된 취약점 보고서 만들어줘", 기대: "generateReport" },
    { 문장: "오래된 취약점 조치해줘", 기대: null },
    { 문장: "오래된 취약점 김보안한테 배정해줘", 기대: null },
    { 문장: "취약점이 오래되면 왜 위험해?", 기대: null },
  ];
  for (const { 문장, 기대 } of 이웃) {
    it(`「${문장}」 → ${기대 ?? "∅(모델 선택, 새 규칙에게 안 뺏긴다)"}`, async () => {
      const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
      const 첫 = 걸림[0]?.도착 ?? null;
      if (기대 === null) {
        expect(첫, "새 규칙이 채 갔다면 회귀다").not.toBe("findingListAnswer(목록+체크칸)");
        expect(첫, "착수 전 ∅였다").toBeNull();
      } else {
        expect(첫).toBe(기대);
      }
    });
  }
});

describe("★★ [상] 등급·KEV가 붙은 말은 여기로 안 온다 — 조건이 조용히 사라지면 안 된다(2026-09-12 수리)", () => {
  // ■ 무엇이 틀렸었나: findingListAnswer는 **물음속심각도(tone.ts)로만** 좁히는데 그 표에
  //   「고위험」·「KEV」가 없다. 그래서 첫 판은 「오래된 고위험 취약점 알려줘」를 [14]로
  //   확정하면서 **등급 조건을 통째로 잃었다** — 머리줄은 「조치할 취약점 N건」이라 담당자는
  //   그 N을 고위험 건수로 읽는다. picklist.ts:150 머리글이 못 박아 둔 함정이 같은 파일에서
  //   재발한 것이다(「상태어가 붙은 말은 여기가 아니다 … 가로채면 필터가 사라진다」).
  // ■ 착수 전엔 ∅이었다(상태어취약점은 ^로 문장 머리를 요구해 「오래된 …」을 못 잡고,
  //   LIST_VERB_RE에는 「알려」가 없다) — 즉 이 문장을 처음 확정한 것이 새 규칙이다.
  const 못거르는조건 = ["오래된 고위험 취약점 알려줘", "오래된 KEV 취약점 알려줘", "오래 방치된 고위험 취약점 알려줘"];
  for (const 문장 of 못거르는조건) {
    it(`「${문장}」 → [14] 목록 아님(등급·KEV를 못 거르므로 비켜 준다)`, async () => {
      expect(물음속심각도(문장), "이 시험의 전제 — 이 말은 좁히기 표에 없다").toBeNull();
      expect(오래미조치물음(문장)).toBe(false);
      const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
      expect(걸림[0]?.도착 ?? null).not.toBe("findingListAnswer(목록+체크칸)");
    });
  }
  // ★ 반대쪽 — 표에 **있는** 등급말은 실제로 걸러지므로 그대로 받는다(배제를 넓히면 여기가 빨개진다).
  const 거르는조건: [string, string][] = [["오래된 매우 심각한 취약점 알려줘", "critical"], ["오래된 critical 취약점 알려줘", "critical"]];
  for (const [문장, 등급] of 거르는조건) {
    it(`「${문장}」 → [14] 목록 그대로(물음속심각도=${등급}로 실제로 좁힌다)`, async () => {
      expect(물음속심각도(문장)).toBe(등급);
      const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
      expect(걸림[0]?.도착 ?? null).toBe("findingListAnswer(목록+체크칸)");
    });
  }
});

describe("★★★ 단서 — 「오래된 순」은 아직 없다고 정직하게 말한다", () => {
  it('findingListAnswer("패치 안 된 지 오래된 거 알려줘")는 단서를 포함한다', () => {
    const { output } = findingListAnswer("패치 안 된 지 오래된 거 알려줘");
    expect(output).toContain(오래된순없음단서);
  });
  it('findingListAnswer("미조치 취약점 뭐 있어?")는 단서를 포함하지 않는다(아무 목록에나 안 붙는다)', () => {
    const { output } = findingListAnswer("미조치 취약점 뭐 있어?");
    expect(output).not.toContain(오래된순없음단서);
  });
});

// ⚠ 「아직 안 닫힌 자리 — 시간어 없는 같은 뜻」describe는 2026-09-12 B10-②로 닫혔다
//   (picklist.미패치물음 신설). 그 문장(「패치 안 한 취약점 알려줘」)은 이제 [14]로 확정되므로
//   여기 남겨 두면 이 라운드부터 빨간불이 난다 — 주석이 지시한 대로 지우고,
//   양성 못박기는 server/test/unpatched-finding-routing.test.ts로 옮겼다(그 파일의 Q01~).

describe("★ 잎 함수 직접 — isFindingListAsk·오래미조치물음·미패치물음", () => {
  it("오래미조치물음(\"패치 안 된 지 오래된 거 알려줘\") === true", () => {
    expect(오래미조치물음("패치 안 된 지 오래된 거 알려줘")).toBe(true);
  });
  it("isFindingListAsk(\"패치 안 된 지 오래된 거 알려줘\") === true", () => {
    expect(isFindingListAsk("패치 안 된 지 오래된 거 알려줘")).toBe(true);
  });
  // B10-② — 오래미조치물음의 이웃(시간어 없는 미패치)은 미패치물음이 받는다. 잎 함수만
  // 여기서 확인하고, 양성·이웃 전체 표는 unpatched-finding-routing.test.ts가 못박는다.
  it("오래미조치물음(\"패치 안 한 취약점 알려줘\") === false (시간어가 없다 — 미패치물음의 몫)", async () => {
    const { 미패치물음 } = await import("../src/engine/picklist");
    expect(오래미조치물음("패치 안 한 취약점 알려줘")).toBe(false);
    expect(미패치물음("패치 안 한 취약점 알려줘")).toBe(true);
  });
});

describe("★★ 이웃 보호 — 침해사고 조회 8문장은 오래미조치물음이 안 걸린다", () => {
  // incidentcases.route.test.ts:165-166과 같은 문장 — 그 시험이 isFindingListAsk=false를
  // 이미 못 박고 있다(오래 신호가 없어 그대로 false).
  const 조회들 = ["침해사고 히스토리 보여줘", "사고 사례 보여줘", "비슷한 사례 있어?", "CVE-2021-44228 비슷한 사례 있어?", "랜섬웨어 사고 사례 알려줘"];
  const 샘들 = ["해외 보안 유튜브 추천해줘", "보안 사고 소식 어디서 봐?", "사례의 샘 보여줘"];
  for (const 문장 of [...조회들, ...샘들]) {
    it(`오래미조치물음("${문장}") === false`, () => {
      expect(오래미조치물음(문장)).toBe(false);
    });
  }
});
