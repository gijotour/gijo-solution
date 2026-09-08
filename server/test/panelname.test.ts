// 구역 **이름**이 강제 도구의 말을 채 가지 않는가 — 전수 감시 (2026-09-08 · 계획서 중-1)
//
// ■ 무엇이 틀렸었나: 짝 시험 aliaspair.test는 모집단이 **별칭 142개**뿐이었다. 그런데
//   screenguide의 panelNameHit은 별칭만이 아니라 구역 **이름 자체**도 질문에 맞춘다.
//   그래서 이름 쪽으로 새는 가로채기 **20쌍**을 그 시험이 원리상 못 봤다 — 2026-09-07에
//   별칭 「조각이 없는 문서」를 걷어내고도 이름 「조각이 없는 문서(⚠)」가 그대로 남아
//   doc_chunk_gaps를 채 가고 있었던 것이 그 증거다(별칭만 고치고 초록을 받았다).
// ■ 가로채기의 판정은 두 마디다 — ① 그 말이 이미 강제 도구의 것인가(forcedToolFor)
//   ② 그런데 화면 안내가 먼저 채 가는가(isHelpIntent). dispatcher가 화면 안내를 강제 도구보다
//   **앞**에 두기 때문에(체인훑기 차례 22 vs 37) 둘 다 참이면 도구는 멀쩡한 채 말이 안 닿는다.
//   ⚠ 판정을 여기서 새로 짜지 않는다 — aliaspair.test와 **같은 두 마디**이고, 모집단만 이름으로 바꾼다.
// ■ 꼬리 10종은 **사람이 쓸 법한 말의 표본**이다(전수가 아니다). 표본 밖의 말투로 새는 것은
//   이 시험도 못 본다 — 새 말투가 발견되면 여기 꼬리에 더한다.
import { describe, it, expect } from "vitest";
import { 구역이름들, 안내화면열쇠들, isHelpIntent } from "../src/engine/screenguide";
import { forcedToolFor } from "../src/engine/agentloop";

describe("★ 구역 이름 전수 — 강제 도구의 말을 채 가는 이름은 대장에 적힌 것뿐이다", () => {
  const 꼬리 = ["알려줘", "보여줘", "뭐야?", "있어?", "어때?", "현황", "목록", "상태", "확인해줘", "몇 건이야?"];

  /** 남아 있는 가로채기 — **사유가 있어서 남긴 것**만 적는다(이름을 적어 두는 자리가 아니라
   *  「왜 안내가 이기는 것이 옳은가」를 적어 두는 자리다). 사유 없이 늘어나면 빨강이다.
   *  다섯 건의 뿌리는 하나다: 강제 규칙 workflow_status의 `(단계|절차)…(뭐|뭘|무엇|해야)`가
   *  「무슨 절차든 뭐냐고 물으면 내 것」이라 우긴다(낱말 가로채기 계보). 실측으로 확인했다 —
   *  같은 이름에 「보여줘·알려줘·있어?」를 붙이면 넷 다 그 규칙에 **안 걸린다**(1/4).
   *  즉 도구를 물어온 것은 이름이 아니라 **꼬리**이고, 여기서 도구에 넘기면
   *  「등급 5단계 뭐야?」에 라이선스 등급 대신 **업무 5단계 현황**이 나간다. */
  const 대장 = [
    { 화면: "handover.html", 이름: "이관 절차", 도구: "workflow_status",
      사유: "이름이 곧 「어떻게 하나」다. 도구는 업무 절차 5단계 **현황**이라 인수인계 절차 설명이 아니다" },
    { 화면: "hardening.html", 이름: "점검 방법", 도구: "explain",
      사유: "이름에 「방법」이 들어 있다 — 안내를 구하는 말이므로 화면 구역 설명이 맞다" },
    { 화면: "learnloop.html", 이름: "학습 루프 4단계", 도구: "workflow_status",
      사유: "학습 루프 4단계와 업무 절차 5단계는 **다른 표**다. 도구가 답하면 딴 숫자를 준다" },
    { 화면: "loganalysis.html", 이름: "대응 절차", 도구: "workflow_status",
      사유: "이벤트 유형별 대응 4단계 설명 — 업무 절차 5단계 현황과 다르다" },
    { 화면: "supplychain.html", 이름: "등급 5단계", 도구: "workflow_status",
      사유: "라이선스 위험 등급 5단계 — 업무 절차 5단계 현황과 이름만 닮았다" },
  ];
  const 대장열쇠 = 대장.map((x) => `${x.화면}|${x.이름}|${x.도구}`).sort();

  const 실측 = (): string[] => {
    const out = new Set<string>();
    for (const a of 구역이름들()) {
      for (const t of 꼬리) {
        const q = `${a.name} ${t}`;
        const f = forcedToolFor(q);
        if (!f) continue;
        // 공통 OVERVIEW 구역(screen="")은 **어느 화면에서 물어도** 걸린다(resolvePanelHit 둘째 훑기).
        const 화면들 = a.screen ? [a.screen] : 안내화면열쇠들();
        for (const sc of 화면들) if (isHelpIntent(q, sc)) out.add(`${sc}|${a.name}|${f.tool}`);
      }
    }
    return [...out].sort();
  };

  it("모집단이 살아 있다 — 구역 이름을 실제로 읽었나", () => {
    const 이름 = 구역이름들();
    // 못 읽으면 아래가 전부 **헛초록**이 된다. 화면 수·이름 수를 먼저 못 박는다.
    expect(이름.length, "구역 이름을 못 읽었다 — GUIDES 모양이 바뀌었는지 먼저 볼 것").toBeGreaterThan(160);
    expect(new Set(이름.map((x) => x.name)).size, "고유 이름이 너무 적다").toBeGreaterThan(140);
    expect(안내화면열쇠들().length, "GUIDES를 못 읽었다").toBeGreaterThan(20);
  });

  it("★★ 이름 가로채기가 대장과 **정확히** 같다(늘어도 줄어도 빨강)", () => {
    expect(실측(),
      "대장에 없는 가로채기가 생겼거나(새 구역 이름이 강제 도구를 죽였다), 고쳤는데 대장을 안 지웠다. " +
      "새 구역 이름을 지을 때는 forcedToolFor(이름 + ' 보여줘')가 null인지 먼저 보라."
    ).toEqual(대장열쇠);
  });

  it("대장의 다섯 줄에는 **사유**가 적혀 있다 — 이름만 적어 두는 자리가 아니다", () => {
    for (const x of 대장) expect(x.사유.length, `${x.이름}에 사유가 없다`).toBeGreaterThan(20);
  });

  it("★ 판정이 헛돌지 않는다(반증) — 대장의 다섯 줄은 실제로 두 마디를 다 만족한다", () => {
    // 대장이 비어 있으면 「이 감시가 헛도나」를 볼 길이 없다. 남은 줄로 판정 두 마디를 되짚는다.
    for (const x of 대장) {
      expect(forcedToolFor(`${x.이름} 뭐야?`)?.tool, `${x.이름}: 강제 규칙이 사라졌다`).toBe(x.도구);
      expect(isHelpIntent(`${x.이름} 뭐야?`, x.화면), `${x.이름}: 안내가 더는 안 이긴다`).toBe(true);
    }
  });

  it("★ 제품 물음은 도구로 간다 — 이름+홑물음 꼬리는 사용법 물음이 아니다", () => {
    // 2026-09-08 이전에는 이 다섯이 모두 **화면 안내**로 샜다(실측 20쌍의 대표).
    const 도구로 = [
      ["dashboard.html", "오늘 브리핑 알려줘", "briefing"],
      ["kpi.html", "AI가 아낀 시간 알려줘", "time_saved"],
      ["redteam.html", "견고성 점수 뭐야?", "redteam_status"],
      ["mydocs.html", "조각이 없는 문서(⚠) 알려줘", "doc_chunk_gaps"],
      ["threat.html", "최근 탐지 내역 보여줘", "threats"],
    ] as const;
    for (const [sc, q, tool] of 도구로) {
      expect(forcedToolFor(q)?.tool, `${q}: 강제 규칙이 사라졌다 — 이 감시의 전제가 무너졌다`).toBe(tool);
      expect(isHelpIntent(q, sc), `${q}: 화면 안내가 아직 채 간다`).toBe(false);
    }
  });

  it("★ 진짜 안내 물음은 그대로 안내다 — 안내낱말이 하나라도 있으면 손대지 않는다", () => {
    const 안내로 = [
      ["dashboard.html", "오늘 브리핑 사용법 알려줘"],
      ["redteam.html", "견고성 점수 설명해줘"],
      ["kpi.html", "AI가 아낀 시간 어떻게 세?"],
      ["threat.html", "최근 탐지 내역 어디 있어?"],
      ["mydocs.html", "지켜보는 폴더(📂) 어떻게 써?"],
    ] as const;
    for (const [sc, q] of 안내로) expect(isHelpIntent(q, sc), `${q}: 안내가 죽었다`).toBe(true);
  });

  it("★ 「알려줘」와 「보여줘」가 같은 답으로 간다 — 같은 뜻인데 답이 갈리지 않는다", () => {
    // 2026-09-08 실측: threat.html에서 「최근 탐지 내역 알려줘」는 안내로, 「보여줘」는 도구로 갔다.
    for (const [sc, name] of [["threat.html", "최근 탐지 내역"], ["report.html", "정기 리포트 스케줄"]] as const) {
      const a = isHelpIntent(`${name} 알려줘`, sc), b = isHelpIntent(`${name} 보여줘`, sc);
      expect(a, `${name}: 「알려줘」와 「보여줘」의 답이 갈린다`).toBe(b);
    }
  });
});
