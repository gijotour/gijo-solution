// 구역 **이름**이 강제 도구의 말을 채 가지 않는가 — 전수 감시 (2026-09-08 · 계획서 중-1)
//
// ■ 무엇이 틀렸었나: 짝 시험 aliaspair.test는 모집단이 **별칭 142개**뿐이었다. 그런데
//   screenguide의 panelNameHit은 별칭만이 아니라 구역 **이름 자체**도 질문에 맞춘다.
//   그래서 이름 쪽으로 새는 가로채기를 그 시험이 원리상 못 봤다 — 2026-09-07에 별칭
//   「조각이 없는 문서」를 걷어내고도 이름 「조각이 없는 문서(⚠)」가 그대로 남아
//   doc_chunk_gaps를 채 가고 있었던 것이 그 증거다(별칭만 고치고 초록을 받았다).
// ■ 가로채기의 판정은 두 마디다 — ① 그 말이 이미 강제 도구의 것인가(forcedToolFor)
//   ② 그런데 화면 안내가 먼저 채 가는가(isHelpIntent). dispatcher가 화면 안내를 강제 도구보다
//   **앞**에 두기 때문에(체인훑기 차례 22 vs 37) 둘 다 참이면 도구는 멀쩡한 채 말이 안 닿는다.
//   ⚠ 판정을 여기서 새로 짜지 않는다 — aliaspair.test와 **같은 두 마디**이고, 모집단만 이름으로 바꾼다.
// ■ **사유도 제품 함수가 낸다**(2026-09-08 검토관 [낮음] 수리). 「이 가로채기는 왜 옳은가」를
//   시험이 정규식으로 다시 재면, 낱말을 고칠 때 한쪽만 바뀌어 「시험은 초록, 제품은 결함」이 된다.
//   screenguide.안내가이기는이유가 말로 돌려주고 여기서는 그 말을 받아 적기만 한다.
// ■ **역할(role)을 함께 잰다**(2026-09-08 검토관 [중] 수리). forcedToolFor는 역할을 안 주면
//   requiredRole:"admin" 도구를 후보에서 뺀다 — 역할 없이 재던 앞 판은 admin 전용 강제 도구가
//   걸린 갈래를 **원리상 못 봤다**(실측: 「점검 승인 · 올린 점검서 알려줘」). 모집단 맹점이
//   별칭 축에서 이름 축으로 옮겨 갔던 것과 **같은 병이 역할 축에서** 재발한 것이다.
// ■ 꼬리 11종은 **사람이 쓸 법한 말의 표본**이다(전수가 아니다). 표본 밖의 말투로 새는 것은
//   이 시험도 못 본다 — 새 말투가 발견되면 여기 꼬리에 더한다. 「뭔데?」는 2026-09-08에
//   더했다 — 정체물음_RE에 「뭔」을 넣었으니 그 말투를 재는 자리도 함께 있어야 한다.
import { describe, it, expect } from "vitest";
import { 구역이름들, 구역별칭들, 대화창구역들, 안내화면열쇠들, isHelpIntent, 안내가이기는이유 } from "../src/engine/screenguide";
import { forcedToolFor } from "../src/engine/agentloop";

describe("★ 구역 이름 전수 — 강제 도구의 말을 채 가는 이름은 대장에 적힌 것뿐이다", () => {
  const 꼬리 = ["알려줘", "보여줘", "뭐야?", "있어?", "어때?", "현황", "목록", "상태", "확인해줘", "몇 건이야?", "뭔데?"];

  /** 남아 있는 가로채기 — `화면|이름|도구|사유`. **사유는 제품 함수가 붙인 말**이라
   *  사람이 지어낼 수 없다. 두 부류뿐이고 둘 다 안내가 이기는 것이 옳다:
   *
   *  · **정체물음**(15줄) — 「○○ 뭐야?」는 그 구역이 *무엇인지*를 묻는 말이다. 도구에 넘기면
   *    「AI-BOM 뭐야?」에 뜻풀이 대신 결손 집계가, 「견고성 점수 뭐야?」에 점수표가 나간다.
   *    2026-07-25에 이 경로를 만든 실측(「진행내역 리포트가 뭐야?」가 RAG로 새어 벤더 매뉴얼을
   *    근거로 답했다)과 2026-09-07 짝 시험의 판단(「지켜보는 폴더(📂) 뭐야?」는 안내가 옳다)이
   *    가리키는 쪽이고, 제품 원칙(용어 풀이는 screenguide)과도 같다.
   *    ⚠ 2026-09-08에 **네 줄이 빠졌다**(이관 절차 · 대응 절차 · 학습 루프 4단계 · 등급 5단계).
   *      화면 안내를 손댄 것이 아니라 **뿌리를 고쳤다** — workflow_status 규칙이 「무슨 절차든
   *      뭐냐고 물으면 내 것」이라 남의 절차를 삼키던 것을 우리 업무 5단계 이름으로 좁혔다
   *      (agentloop FORCED_INTENTS[28] · 짝 시험 test/workflow-stage-routing.test.ts).
   *      이제 그 넷은 forcedToolFor가 null이라 **이 명부에 오를 일 자체가 없다** — 안내가
   *      이기는 것이 아니라 애초에 다툼이 없다. 명부에 남겨 두는 것은 **그 화면 안에서만**
   *      안전하다는 뜻이었다(화면 안내는 그 화면에서 물을 때만 이긴다) — 이제 대화창에서
   *      물어도 업무 5단계 숫자가 안 나간다.
   *  · **안내낱말**(1줄 — 점검 방법) — 이름 자체에 「방법」이 들어 있다. 그 이름을 부르는 것이
   *    곧 설명을 구하는 것이다.
   *
   *  ⚠ 여기 **값요구**(「알려줘·보여줘」)가 한 줄이라도 생기면 그것이 진짜 결함이다 —
   *    아래 「사유 없는 가로채기 0」이 그 자리를 따로 지킨다. */
  const 대장 = [
    "approvals.html|VEX 내보내기|vex_status|정체물음",
    "dashboard.html|오늘 브리핑|briefing|정체물음",
    "hardening.html|점검 방법|explain|안내낱말",
    "incidentcases.html|비슷한 사례 칩|incident_cases|정체물음",
    "incidentcases.html|사례의 샘|incident_sources|정체물음",
    "kpi.html|AI가 아낀 시간|time_saved|정체물음",
    "maintenance.html|점검 승인 · 올린 점검서|review_maintenance|정체물음",
    "memory.html|기본 지식 번들|knowledge_bundle_status|정체물음",
    "memory.html|지식 관계도(온톨로지)|ontology_query|정체물음",
    // ⚠ 2026-09-11 B7 ①이 한 줄(「mydocs.html|AI 포함과 공유의 차이|explain|정체물음」)을
    //   여기 더했다가 **2026-09-12 수리로 지웠다**(검토관 [중]). 그 줄의 근거였던
    //   「isHelpIntent가 forcedToolFor보다 앞이라 사용자 경험은 그대로」가 **틀린 설명**이었다 —
    //   isHelpIntent는 **자기 안에서**(screenguide.ts:495) forcedToolFor를 보고 값요구를
    //   넘긴다. 그대로였던 것은 「뭐야?」 꼬리(정체물음)뿐이고, 실측으로 「AI 포함과 공유의
    //   차이 **알려줘**」는 화면 안내를 잃고 explain(RAG)으로 갔다. 이제 뿌리에서 막는다 —
    //   agentloop.구역이름물음이 구역 이름과 겹치는 물음에서 비교 분기를 비켜 주어
    //   forcedToolFor가 다시 null이다. 가로채기가 아예 없으니 대장에 오를 줄도 없다.
    "mydocs.html|조각이 없는 문서(⚠)|doc_chunk_gaps|정체물음",
    "mydocs.html|지켜보는 폴더(📂)|watch_folder_list|정체물음",
    "redteam.html|견고성 점수|redteam_status|정체물음",
    "report.html|정기 리포트 스케줄|report_schedule_list|정체물음",
    "sbom.html|AI-BOM|aibom_status|정체물음",
    "settings.html|에어갭 봉인|airgap_status|정체물음",
    "threat.html|최근 탐지 내역|threats|정체물음",
  ].sort();

  /** 가로채기 전수. `역할`을 그대로 두 창구에 넘긴다 — dispatcher가 재는 것과 같은 눈이어야 한다. */
  const 실측 = (역할?: string): string[] => {
    const out = new Set<string>();
    for (const a of 구역이름들()) {
      for (const t of 꼬리) {
        const q = `${a.name} ${t}`;
        const f = forcedToolFor(q, 역할 ? { role: 역할 } : undefined);
        if (!f) continue;
        // 공통 OVERVIEW 구역(screen="")은 **어느 화면에서 물어도** 걸린다(resolvePanelHit 둘째 훑기).
        const 화면들 = a.screen ? [a.screen] : 안내화면열쇠들();
        for (const sc of 화면들) {
          if (isHelpIntent(q, sc, 역할)) out.add(`${sc}|${a.name}|${f.tool}|${안내가이기는이유(q) ?? "★사유없음"}`);
        }
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
    expect(실측("admin"),
      "대장에 없는 가로채기가 생겼거나(새 구역 이름이 강제 도구를 죽였다), 고쳤는데 대장을 안 지웠다. " +
      "새 구역 이름을 지을 때는 forcedToolFor(이름 + ' 보여줘')가 null인지 먼저 보라."
    ).toEqual(대장);
  });

  it("★★ **사유 없는** 가로채기가 0이다 — 값을 달라는 말은 언제나 도구로 간다", () => {
    // 이 시험이 이 파일의 심장이다. 대장은 이름이 바뀌면 손봐야 하지만 이 규칙은 안 바뀐다:
    // 「○○ 알려줘·보여줘·현황·목록」처럼 **값을 구하는 말**을 화면 안내가 채 가면 그것이 결함이다.
    const 사유없음 = 실측("admin").filter((x) => x.endsWith("★사유없음"));
    expect(사유없음,
      "값요구 꼬리를 화면 안내가 채 간다 — screenguide.안내가이기는이유가 null인데 안내가 이겼다: " + 사유없음.join(" · ")
    ).toEqual([]);
  });

  it("★ 대장의 사유는 두 부류뿐이다 — 새 부류가 생기면 사람이 판단해야 한다", () => {
    const 부류 = [...new Set(대장.map((x) => x.split("|")[3]))].sort();
    expect(부류, "사유 부류가 늘었다 — 안내가이기는이유가 새 말을 돌려준다").toEqual(["안내낱말", "정체물음"]);
  });

  it("★★ 역할을 본다 — admin 전용 강제 도구를 못 보면 안내가 그 말을 채 간다", () => {
    // 2026-09-08 검토관 [중]: isHelpIntent가 역할 없이 forcedToolFor를 불러, admin에게만 있는
    // review_maintenance가 **없는 것처럼 보여** 「알려줘」가 화면 안내로 샜다. dispatcher는
    // 사용자 역할로 부르므로 두 곳이 **같은 말에 다른 답**을 내던 자리다.
    const q = "점검 승인 · 올린 점검서 알려줘";
    expect(forcedToolFor(q, { role: "admin" })?.tool, "admin 전용 강제 규칙이 사라졌다 — 전제가 무너졌다").toBe("review_maintenance");
    expect(forcedToolFor(q)?.tool, "역할 없이도 보이면 이 시험이 헛돈다").toBeUndefined();
    expect(isHelpIntent(q, "maintenance.html", "admin"), "admin인데 안내가 아직 채 간다").toBe(false);
    // ⚠ 역할을 모르면 종전대로 안내가 이긴다 — 안전한 쪽으로 틀리는 것이고, 실경로는
    //   runWithViewer 꼬리표로 역할이 채워지므로 사람이 겪는 답은 위쪽이다.
    expect(isHelpIntent(q, "maintenance.html"), "역할을 모르면 안내가 이기는 계약이 바뀌었다").toBe(true);
    // 역할 없이 잰 명부는 admin 명부의 **부분집합**이어야 한다(도구가 더 보일 수는 없다).
    for (const x of 실측()) expect(대장, `역할 없이 잴 때만 나오는 가로채기: ${x}`).toContain(x);
  });

  it("★ 값요구는 도구로 간다 — 「알려줘·보여줘」는 사용법 물음이 아니다", () => {
    // 2026-09-08 이전에는 이 다섯이 모두 **화면 안내**로 샜다(실측 20쌍의 대표).
    const 도구로 = [
      ["dashboard.html", "오늘 브리핑 알려줘", "briefing"],
      ["kpi.html", "AI가 아낀 시간 알려줘", "time_saved"],
      ["report.html", "정기 리포트 스케줄 알려줘", "report_schedule_list"],
      ["mydocs.html", "조각이 없는 문서(⚠) 알려줘", "doc_chunk_gaps"],
      ["threat.html", "최근 탐지 내역 보여줘", "threats"],
    ] as const;
    for (const [sc, q, tool] of 도구로) {
      expect(forcedToolFor(q)?.tool, `${q}: 강제 규칙이 사라졌다 — 이 감시의 전제가 무너졌다`).toBe(tool);
      expect(안내가이기는이유(q), `${q}: 사유가 붙었다 — 이 줄은 더는 값요구가 아니다`).toBeNull();
      expect(isHelpIntent(q, sc), `${q}: 화면 안내가 아직 채 간다`).toBe(false);
    }
  });

  it("★★ 정체물음(「○○ 뭐야?」)은 **안내**다 — 강제 도구가 있어도 그렇다", () => {
    // ⚠ 이 다섯은 **비켜주기 가지를 실제로 지난다**(forcedToolFor가 살아 있는데도 안내가 이긴다).
    //   앞 판(c455dd97)의 「진짜 안내 물음」 다섯 줄은 전부 안내낱말·HELP_RE에 먼저 걸려
    //   이 가지를 **애초에 타지 못했고**, 그래서 회귀를 만든 자리를 한 줄도 못 봤다
    //   (2026-09-08 검토관 [낮음]). 여기서는 forcedToolFor가 null이 아님을 함께 못 박아
    //   「걸리지도 않는 말로 초록을 받는」 헛돎을 막는다.
    const 안내로 = [
      ["sbom.html", "AI-BOM 뭐야?", "aibom_status"],
      ["memory.html", "지식 관계도(온톨로지) 뭐야?", "ontology_query"],
      ["redteam.html", "견고성 점수가 뭔지 알려줘", "redteam_status"],
      ["mydocs.html", "지켜보는 폴더(📂) 뭐야?", "watch_folder_list"],   // 2026-09-07 짝 시험이 적어 둔 바로 그 예
      ["incidentcases.html", "사례의 샘 뭐야?", "incident_sources"],
    ] as const;
    for (const [sc, q, tool] of 안내로) {
      expect(forcedToolFor(q, { role: "admin" })?.tool, `${q}: 강제 규칙이 없다 — 이 줄은 가지를 안 타므로 헛돈다`).toBe(tool);
      expect(안내가이기는이유(q), `${q}: 정체물음으로 안 읽힌다`).toBe("정체물음");
      expect(isHelpIntent(q, sc, "admin"), `${q}: 뜻을 물었는데 도구가 채 간다`).toBe(true);
    }
  });

  it("★ 안내낱말이 있으면 그대로 안내다 — 이름에 든 것도 센다", () => {
    const 안내로 = [
      ["dashboard.html", "오늘 브리핑 사용법 알려줘"],
      ["redteam.html", "견고성 점수 설명해줘"],
      ["kpi.html", "AI가 아낀 시간 어떻게 세?"],
      ["hardening.html", "점검 방법 알려줘"],   // 이름 자체가 「방법」 — 부르는 것이 곧 설명 요청
    ] as const;
    for (const [sc, q] of 안내로) {
      expect(안내가이기는이유(q), `${q}: 안내낱말로 안 읽힌다`).toBe("안내낱말");
      expect(isHelpIntent(q, sc, "admin"), `${q}: 안내가 죽었다`).toBe(true);
    }
  });

  it("★★ 「알려줘」와 「보여줘」는 **갈리지 않는다** — 강제 도구가 있는 이름 전수", () => {
    // 2026-09-08 실측(고치기 전): threat.html에서 「최근 탐지 내역 알려줘」는 안내로,
    // 「보여줘」는 도구로 갔다. 같은 뜻인데 답이 갈린 것이다. 손으로 고른 두 이름만 재면
    // 다음에 다른 이름에서 같은 일이 난다 — 전수로 잰다.
    // ⚠ 반대로 「알려줘」와 「뭐야?」는 **일부러** 갈린다(값을 달라 vs 무엇인지) — 위 두 시험이 그 쪽이다.
    const 갈림: string[] = [];
    for (const a of 구역이름들()) {
      const fa = forcedToolFor(`${a.name} 알려줘`, { role: "admin" });
      const fb = forcedToolFor(`${a.name} 보여줘`, { role: "admin" });
      if (!fa || !fb) continue;   // 강제 도구가 없는 이름은 게이트(홑물음_RE)가 원래부터 갈라 왔다
      for (const sc of a.screen ? [a.screen] : 안내화면열쇠들()) {
        if (isHelpIntent(`${a.name} 알려줘`, sc, "admin") !== isHelpIntent(`${a.name} 보여줘`, sc, "admin")) {
          갈림.push(`${sc}|${a.name}`);
        }
      }
    }
    expect(갈림, "같은 뜻인데 답이 갈린다(알려줘 ↔ 보여줘): " + 갈림.join(" · ")).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ★★ B12 화면 안내 「X 뭐야?」 도달 (2026-09-12 · 설계관 지시서 · 계획서 전-7)
  //
  //  뿌리: resolvePanelHit이 **화면별**(:305, 지금)과 **공통**(:306, OVERVIEW) 두 곳만
  //  훑어서, mydocs.html 전용 구역(「근거 지정과 첨부(📎)」 등)은 그 화면 위에서만 닿고
  //  대화 홈에서는 안 닿았다. 셋째 훑기(대화창구역들 — 명시 allowlist)로 연다.
  // ═══════════════════════════════════════════════════════════════════════════
  it("★★ 대화창 전역 구역은 **어느 화면에서도** 같은 답을 낸다", () => {
    const 전역 = 대화창구역들();
    expect(전역.length, "전역표를 못 읽었다").toBeGreaterThanOrEqual(5);

    // ① 전제 — 전역표의 글자는 강제 도구의 것이 아니다(있으면 allowlist 전제가 무너진다).
    const 강제있음: string[] = [];
    for (const item of 전역) {
      for (const t of 꼬리) {
        if (forcedToolFor(`${item.글자} ${t}`, { role: "admin" })) 강제있음.push(`${item.글자} ${t}`);
      }
    }
    expect(강제있음, "전역표에 강제 도구가 있는 이름이 섞였다 — allowlist 전제가 무너졌다: " + 강제있음.join(" · ")).toEqual([]);

    // ② 안내화면열쇠들() 전부에서 「○○ 뭐야?」가 안내로 닿는다.
    const 화면들 = 안내화면열쇠들();
    for (const item of 전역) {
      for (const sc of 화면들) {
        expect(isHelpIntent(`${item.글자} 뭐야?`, sc, "admin"), `${sc} 화면에서 「${item.글자} 뭐야?」가 안내로 안 닿는다`).toBe(true);
      }
      // ③ 화면 없이(대화 홈)도 닿는다 — 이것이 B12가 닫는 자리다.
      expect(isHelpIntent(`${item.글자} 뭐야?`, undefined, "admin"), `대화 홈에서 「${item.글자} 뭐야?」가 안내로 안 닿는다`).toBe(true);
    }

    // ④ 전역표 도입으로 기존 이름 가로채기 대장이 늘지 않았다(한 줄도 안 늘어야 한다).
    expect(실측("admin"), "전역표 도입으로 이름 가로채기 대장이 바뀌었다 — allowlist가 순진판처럼 새고 있다").toEqual(대장);
  });

  it("★★ 화면 안내는 쓰기 흐름을 삼키지 않는다 — 전수", () => {
    // 승인·배정·할당·맡김이 붙은 말을 화면 안내가 한 수로 삼키면 그 지시는 영영 안 간다
    // (B5·B7·B10이 배열 밖 explain 분기에 건 잣대와 같은 것을 이 층에도 건다).
    const 쓰기꼬리 = ["알려주고 승인해줘", "알려주고 배정해줘", "알려주고 할당해줘", "알려주고 맡겨줘", "알려주고 담당자 정해줘", "알려주고 조치해줘"];
    const 이름들: { screen: string; name: string }[] = [
      ...구역이름들(),
      ...구역별칭들().map((a) => ({ screen: a.screen, name: a.shown })),
    ];
    const 샌곳: string[] = [];
    for (const a of 이름들) {
      for (const t of 쓰기꼬리) {
        const q = `${a.name} ${t}`;
        for (const sc of a.screen ? [a.screen] : 안내화면열쇠들()) {
          if (isHelpIntent(q, sc, "admin")) 샌곳.push(`${sc}|${q}`);
        }
      }
    }
    expect(샌곳, "화면 안내가 쓰기 흐름을 삼킨다(승인·배정·할당·맡김이 영영 안 간다): " + 샌곳.slice(0, 10).join(" · ")).toEqual([]);

    // 반증 — 잣대(쓰기흐름인가)가 없던 수리 전에는 아래 넷이 전부 isHelpIntent=true였다.
    const 반증문장: [string, string | undefined][] = [
      ["현황판 알려주고 배정해줘", undefined],
      ["옅은 숫자 알려주고 김보안한테 맡겨줘", undefined],
      ["근거 지정 알려주고 담당자 정해줘", "mydocs.html"],
      ["고칠 것 알려주고 할당해줘", "supervision.html"],
    ];
    for (const [q, sc] of 반증문장) {
      expect(isHelpIntent(q, sc, "admin"), `${q}: 화면 안내가 쓰기 흐름을 삼킨다(수리 전 실측 true)`).toBe(false);
    }
  });

  it("★ 「알려줘 ↔ 보여줘」 대칭이 전역 구역에서도 깨지지 않는다", () => {
    // ⚠ 기존 위 시험과 **같은 잣대**다 — 강제 도구가 없는 이름은 게이트(홑물음_RE)가 원래부터
    //   「알려」와 「보여」를 가른다(「보여」는 정체물음_RE·값요구_RE 어느 쪽에도 안 걸린다).
    //   그건 이 다섯 이름에도 똑같이 적용되는 **기존 계약**이지 이 라운드가 만든 비대칭이
    //   아니다 — 그래서 위와 똑같이 forcedToolFor가 **둘 다** 있을 때만 잰다(지금은 다섯
    //   전부 강제 도구가 없어 이 시험은 비어 돈다 — 강제 도구가 생기면 그때부터 값을 낸다).
    // ⚠ 「알려줘 ↔ 뭐야?」는 **일부러** 갈린다(값 vs 뜻) — 그쪽은 재지 않는다(위 시험들이 그 쪽).
    const 갈림: string[] = [];
    for (const item of 대화창구역들()) {
      const fa = forcedToolFor(`${item.글자} 알려줘`, { role: "admin" });
      const fb = forcedToolFor(`${item.글자} 보여줘`, { role: "admin" });
      if (!fa || !fb) continue;
      const 화면들 = [...안내화면열쇠들(), undefined] as (string | undefined)[];
      for (const sc of 화면들) {
        if (isHelpIntent(`${item.글자} 알려줘`, sc, "admin") !== isHelpIntent(`${item.글자} 보여줘`, sc, "admin")) {
          갈림.push(`${sc ?? "(대화 홈)"}|${item.글자}`);
        }
      }
    }
    expect(갈림, "전역 구역에서도 같은 뜻인데 답이 갈린다(알려줘 ↔ 보여줘): " + 갈림.join(" · ")).toEqual([]);
  });
});
