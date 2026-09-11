// 미점검 하드닝 조회 라우팅 — 2026-09-10 고객 QA 예행 ㉔ / 계획서 전-7
//
// 뿌리: 「점검 안 한 장비 있어?」가 강제 규칙 없이 ⑨ 모델 선택으로 새 SBOM·지원종료
//   화면으로 갔다(결함 3). 「보안설정 점검 안 한 장비 있어?」는 반대로 FORCED_INTENTS[3]
//   (run_hardening_scan)에 걸려 **우리 호스트 자신**의 하드닝 결과(준수율·U-02…)가 그대로
//   나갔다 — 고객 인스턴스(4100)에서는 형태 ⓑ 격리 전제 위반이다.
// 고친 것 둘(이중 방어):
//   ① datacard.isHardeningStatusAsk — 「안 했다/조회」 꼴도 받아 [17] 특수경로(카드)로 보낸다.
//   ② agentloop FORCED_INTENTS[3](run_hardening_scan) 정규식 — 조회·부정형 낱말이 있으면
//      run_hardening_scan을 안 잡는다.
// screenguide.ts verify.html can[]이 이미 「점검 안 한 장비 있어?」를 제품이 답할 말로
//   약속하고 있었다(대장 문서 GIJO_AS_대화시나리오_대장_2026-08-19.md:277에 기록된 공백).
//
// ★★ 2026-09-11 검토관 수리 — 위 ②가 **금지 목록**이라 반대쪽으로 샜다.
//   조회 낱말(결과·목록·어느·몇…)을 금지어로 깔았더니 **금지어를 곁들인 실행 지시**가
//   통째로 빠져나가 결정적 갈래 어디에도 안 걸렸다(⑨ 모델 재량). 실측한 반례 셋을 아래
//   「혼합 꼴」에 못 박는다. 지금 규칙은 **주제 + 실행 지시를 둘 다 요구**하는 허용 조건이다.
//   함께 고친 것 셋: (가) 이웃영토에 「조치」 — 「검증 안 된 조치 있어?」가 장비 표로 가던 것,
//   (나) 조회말에 「몇」 — 세는 말투가 강제도구 list_assets로 새던 것,
//   (다) 카드·글 답의 「미점검 N곳」 — 물음에 숫자로 답하지 않던 것.
//
// ★★ B6-①(2026-09-11 설계관 지시서) — 「하드닝 점검 결과는?」류(현황말이 없는 **결과** 조회)가
//   [17]에 안 걸려 ⑨ 모델 선택으로 떨어지면, 거기서 모델이 고를 수 있는 하드닝 도구가
//   run_hardening_scan(실행) **하나뿐**이라 운영(자기점검 켜짐)에서 실 셸 점검이 돌던 결함.
//   이중 방어: ① isHardeningStatusAsk에 결과꼴을 더해 [17]이 먼저 받는다(실행 지시·보고서
//   만들기는 배제). ② agentloop.ts 결과조회꼴() — [17]도 못 받는 영토어 없는 조회(「점검 결과 좀」)는
//   ⑨에서 모델이 run_hardening_scan을 골라도 **실행하지 않는다**.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("../src/engine/llm", () => ({
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

// ⚠ B6-① ★ 2차 방어 시험 전용 — runHardeningScanTool을 스파이로 감싼다(나머지 exports는
//   실제 구현 그대로). 「⑨에서 골라도 점검은 안 돈다」가 **제품 경로**(runAgentLoop → tool.run)
//   가 실제로 이 함수를 안 부르는지 재려면 정규식을 다시 확인하는 게 아니라 이 창구를 봐야 한다.
vi.mock("../src/engine/agenttools/handlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/agenttools/handlers")>();
  return { ...actual, runHardeningScanTool: vi.fn(actual.runHardeningScanTool) };
});

import { isHardeningStatusAsk, hardeningStatusAnswer } from "../src/engine/datacard";
import { createTarget, createSchedule, runDueSchedules, resetHardeningForTests } from "../src/engine/hardeningtargets";
import type { RunFn } from "../src/engine/hardeningscan";
import { 실제도착 } from "./helpers/routing";
import { chat } from "../src/engine/llm";
import { runAgentLoop, 결과조회꼴 } from "../src/engine/agentloop";
import { runHardeningScanTool } from "../src/engine/agenttools/handlers";
import { 결정적도착지 } from "../src/engine/dispatcher";

/** 결정적 체인에서 이 말이 **첫 번째로** 닿는 도착지 — routeexplain.route.test.ts 「설명도착」과 같은 방식. */
async function 첫도착(문장: string): Promise<string> {
  const 걸림 = await 결정적도착지(문장, { 역할: "admin" });
  return 걸림.length ? 걸림[0].도착 : "(모델 선택)";
}

/** 실 셸을 안 부르는 결정적 러너 — datacard.test.ts fakeRunner와 같은 뜻(점검 1회를 완주시킨다). */
function 붙박이러너(): RunFn {
  return async () => ({ code: 0, out: "", err: "" });
}

// ⚠ FAIL_MARKS는 **글자로 베끼지 않는다** — drawer-audit.mjs를 읽어 배열을 뽑는다
//   (approvalstatustool.test.ts:26-38과 같은 관례. 베끼면 두 곳이 어긋난다).
function FAIL_MARKS목록(): string[] {
  const 경로 = path.join(__dirname, "..", "..", "tools", "drawer-audit.mjs");
  const src = fs.readFileSync(경로, "utf8");
  const 시작 = src.indexOf("const FAIL_MARKS = [");
  if (시작 < 0) throw new Error("FAIL_MARKS를 못 찾았다 — drawer-audit.mjs가 낡았다(이 시험을 손볼 것)");
  const 끝 = src.indexOf("];", 시작);
  const 몸통 = src.slice(시작, 끝);
  const 마크 = [...몸통.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (마크.length === 0) throw new Error("FAIL_MARKS를 하나도 못 뽑았다 — 추출 정규식이 낡았다");
  return 마크;
}

describe("① isHardeningStatusAsk — 미점검 조회 갈래", () => {
  it("★ 예행 ㉔ + 실측 신규 양성 — 조회 꼴을 잡는다", () => {
    for (const q of [
      "점검 안 한 장비 있어?",
      "보안설정 점검 안 한 장비 있어?",
      "하드닝 점검 안 한 서버 있어?",
      "보안설정 점검 안 한 대상 있어?",
      "미점검 장비 어디야?",
      "점검 안 한 시스템 목록 보여줘",
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(true);
    }
  });

  it("★ 뺏김 0 — 이웃 영토(asset_coverage·finding_status)는 그대로 비켜 준다", () => {
    for (const q of [
      "미점검 대상 몇 개야?",           // asset_coverage — 「대상」은 장비류 낱말이 아니다
      "점검 안 된 자산 어떻게 처리해?", // asset_coverage — 「자산」이웃영토
      "점검 안 한 자산 있어?",          // asset_coverage — 「자산」이웃영토
      "유지보수 점검 뭐 남았어?",       // maintenance_status 영토
      // ★★ 2026-09-11 검토관 — ④ 검증 단계는 **조치 검증**도 담는다. 이 갈래가 켜진 뒤
      //   영토어 「검증」에 먼저 걸려 조치를 물었는데 장비 점검 표가 나갔다(수리 전 실측).
      "검증 안 된 조치 있어?",
      "점검 안 한 조치 뭐 있어?",
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(false);
    }
  });

  it("기존 음성(datacard.test.ts와 같은 계약) — 실행·스케줄·절차·취약점은 여전히 비켜 준다", () => {
    for (const q of [
      "하드닝 점검 돌려줘", "보안설정 점검 해줘",
      "하드닝 점검 스케줄 알려줘", "점검 일정 보여줘",
      "방화벽 월간 정기점검 절차를 알려줘", "하드닝 점검 방법 알려줘",
      "보안설정 점검 어떻게 하는지 알려줘", "정기점검 매뉴얼 보여줘",
      "취약점 현황 보여줘", "스캔결과 상태 알려줘",
      "자산 현황 보여줘", "",
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(false);
    }
  });

  it("기존 양성 반례 — 결과·현황은 여전히 카드다", () => {
    for (const q of ["하드닝 점검 결과 알려줘", "보안설정 점검 현황", "검증 현황 보여줘"]) {
      expect(isHardeningStatusAsk(q), q).toBe(true);
    }
  });

  // ★★ B6-①(2026-09-11 설계관 지시서) — 「하드닝 점검 결과는?」류는 **현황말(현황·상태·
  //   어때·보여줘·알려줘)이 하나도 없다.** 착수 전 route-explain 실측으로는 전부 ⑨(모델
  //   재량)였고, 4100에서는 run_hardening_scan이 골라져 자기점검꺼짐 안내로 끝났다.
  it("★★ B6-① 결과 조회 갈래 — 현황말이 없어도 받는다", () => {
    for (const q of [
      "하드닝 점검 결과는?",
      "하드닝 점검 결과가 어떻게 돼?",
      "보안설정 점검 결과 좀",
      "하드닝 점검 결과",
      "정기점검 결과는?",
      "검증 결과는?",
      "장비 점검 결과는?", // 영토어가 없다 — 80줄 (미점검조회||결과꼴) + 장비류 낱말로 받는다
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(true);
    }
  });

  // ★★ B6-① 뺏김 0 — 결과꼴을 열어도 이웃 도착지(maintenance_status·redteam·generateReport 등)를
  //   안 뺏는다. 전부 route-explain으로 도착지를 확인해 둔 문장이다.
  it("★★ B6-① 뺏김 0 — 결과꼴이 이웃 영토를 안 뺏는다", () => {
    for (const q of [
      "유지보수 점검 결과 알려줘",             // maintenance_status — 「유지보수」이웃영토
      "레드팀 점검 결과 알려줘",               // 장비류 낱말이 없다 — redteam 영토
      "스캔 결과는?",                          // 기존 「스캔결과」 배제가 이미 막는다
      "점검 결과를 개인 메일로 보내도 돼?",     // 장비류 낱말이 없다
      "우리 회사 2019년 정보보호 감사 결과 알려줘", // 「점검」 낱말 자체가 없다
      "sample-web01 스캔하고 결과 리포트까지 만들어줘", // 리포트 만들기 배제
    ]) {
      expect(isHardeningStatusAsk(q), q).toBe(false);
    }
  });

  // ★★★ 2026-09-11 검토관 [중] — **위 모집단은 구조적으로 통과만 났다.**
  //   여섯 문장이 전부 「…점검 결과…」꼴이라 장비류 낱말 게이트에 자동으로 막힌다 —
  //   결과꼴 문을 그냥 지나가던 **「검증」꼴**이 한 문장도 없었다. 실제로 넣어 보니
  //   route-explain 도착지가 전부 [17] 카드였다(수리 전). 이 시험은 판별자만 보지 않고
  //   **첫도착()으로 도착지까지** 재서, 이웃 규칙이 실제로 답을 가져가는지 확인한다.
  it("★★★ 진짜 뺏김 — 「검증 결과」꼴이 이웃 도착지를 그대로 남겨 둔다", async () => {
    const 카드 = "hardeningStatusAnswer(카드)";
    // 수리 전 실측: 아래 전부 ▸[17] 카드였다(뒤 순서의 진짜 주인이 밀렸다).
    expect(await 첫도착("레드팀 검증 결과는?")).toBe("redteam_status");
    expect(await 첫도착("가드레일 검증 결과는?")).not.toBe(카드);
    expect(await 첫도착("검증 결과 보고서 양식 어디 있어?")).toBe("화면위치안내 + 화면 열기");
    expect(await 첫도착("정기점검 결과 보고는 누구에게 하나요?")).not.toBe(카드);
    // 이웃영토 가드가 미점검조회와 **같은 곳**에서 결과꼴에도 걸리는지(반쪽 수리 방지)
    for (const q of ["조치 검증 결과는?", "SBOM 검증 결과는?", "유지보수 점검 결과 서버별로 정리해줘"]) {
      expect(await 첫도착(q), q).not.toBe(카드);
      expect(isHardeningStatusAsk(q), q).toBe(false);
    }
  });

  // ★★★ 2026-09-11 검토관 [상] — 「결과」가 붙었다고 **리포트 만들기·쓰기 지시**를 뺏으면 안 된다.
  //   뿌리: 배제용 정규식을 [36]에서 베껴 동사 「출력·뽑」이 빠지고 사이 간격이 4자 대 12자였다.
  //   대조 문장(「결과」만 뺀 짝)이 실제로 [36]에 닿는 것도 같은 도구로 확인한다 —
  //   「원래 [36]에 못 가던 말 아니냐」는 오탐 반증을 시험 안에 박아 둔다.
  it("★★★ 「결과」가 붙어도 리포트 만들기·배정은 [17]이 안 뺏는다", async () => {
    for (const [있음, 없음] of [
      ["하드닝 점검 결과 리포트 출력해줘", "하드닝 점검 리포트 출력해줘"],
      ["하드닝 점검 결과 보고서를 하나 새로 만들어줘", "하드닝 점검 보고서를 하나 새로 만들어줘"],
    ]) {
      expect(await 첫도착(없음), `대조(「결과」 없음): ${없음}`).toBe("generateReport");
      expect(await 첫도착(있음), `「결과」가 붙자 [36]을 뺏겼다: ${있음}`).toBe("generateReport");
    }
    // 쓰기 지시 — 조회로 못 박으면 배정이 영영 안 된다(agentloop 조회로못박지않을것과 같은 사고).
    expect(await 첫도착("정기점검 결과 김보안한테 배정해줘")).not.toBe("hardeningStatusAnswer(카드)");
  });

  // ★★ 2026-09-11 검토관 — **세는 말투**도 같은 물음이다. 조회말에 「몇」이 없던 동안
  //   「점검 안 한 장비 몇 대야?」는 강제도구 list_assets로 가서 **자산 목록**을 답했다
  //   (실측). 결함 3이 난 그 경로에 그대로 남아 있던 구멍이다.
  it("★ 세는 말투도 받는다 — 「점검 안 한 장비 몇 대야?」", () => {
    for (const q of ["점검 안 한 장비 몇 대야?", "하드닝 점검 안 한 서버 몇 개야?"]) {
      expect(isHardeningStatusAsk(q), q).toBe(true);
    }
  });

  // ⚠ **남은 구멍을 사실대로 못 박는다**(2026-09-11 — 고치지 않았다).
  //   「검증 안 된 조치 **목록 보여줘**」는 이웃영토(조치)가 아니라 **현황꼴**(보여줘)에서
  //   먼저 참이 되어 여전히 카드로 간다. 이 갈래는 미점검 조회가 생기기 **전부터** 그랬다
  //   (「검증」+「보여줘」는 2026-08-19부터의 계약) — 이번 라운드가 만든 것이 아니라서
  //   손대지 않았다. 고치려면 현황꼴 앞에서도 「조치」를 비켜야 하는데, 그건 오래된 계약을
  //   건드리는 일이라 따로 판단할 것. 지금 동작을 **기대로 적어 다음 사람이 알게** 한다.
  it("⚠ 아직 남은 것 — 「…목록 보여줘」 꼴은 현황꼴이 먼저 받는다(이번 라운드 밖)", () => {
    expect(isHardeningStatusAsk("검증 안 된 조치 목록 보여줘")).toBe(true);
  });
});

describe("② 실제 도착 — 강제도구(FORCED_INTENTS[3])가 조회 꼴을 안 잡는다(2차 방어)", () => {
  it("조회 꼴은 run_hardening_scan에 안 닿는다", () => {
    for (const q of ["보안설정 점검 안 한 장비 있어?", "하드닝 점검 안 한 서버 있어?", "점검 안 한 장비 목록 보여줘"]) {
      expect(실제도착(q), q).not.toBe("run_hardening_scan");
    }
  });
  it("실행 지시는 여전히 run_hardening_scan에 닿는다(유지)", () => {
    for (const q of [
      "보안장비 하드닝 점검 실행해줘", "CCE 기준 점검 돌려줘", "하드닝 점검해줘",
      "하드닝 점검 돌려줘", "보안설정 점검 해줘", "CIS 기준으로 점검해줘",
      "네트워크 장비 점검해줘", "내 PC 보안설정 점검해줘", "취약점 진단해줘",
      "내 PC 보안 설정 점검해줘", // evalgate lt-scan-1(라이트) — 띄어쓰기 판
    ]) {
      expect(실제도착(q), q).toBe("run_hardening_scan");
    }
  });

  // ★★ 2026-09-11 검토관 적발의 본체 — **조회 낱말이 섞인 실행 지시**.
  //   앞 판(금지 목록)에서는 셋 다 결정적 갈래에 하나도 안 걸려 ⑨ 모델 재량으로 떨어졌다
  //   (route-explain 실측: 「걸리는 규칙 없음」). 시킨 점검이 안 도는 쪽이 훨씬 나쁜 오답이다.
  it("★★ 혼합 꼴 — 조회 낱말이 섞여도 실행 지시면 run_hardening_scan이다", () => {
    for (const q of [
      "하드닝 점검 결과가 필요하니 지금 돌려줘", // 「결과」
      "어느 장비부터 하드닝 점검해줘",           // 「어느」
      "몇 개 장비 하드닝 점검해줘",             // 「몇 개」
      "어느 서버든 CCE 기준 점검 돌려줘",        // 「어느」
      "취약점 진단해줘 결과 정리해서",           // 「결과」
    ]) {
      expect(실제도착(q), q).toBe("run_hardening_scan");
    }
  });

  // ★★ B6-①(2026-09-11) — **결과꼴을 열어도** 실행 지시·보고서 만들기는 [17]에 안 뺏긴다.
  //   ⚠ 이 셋은 `실제도착()`(forcedToolFor만 재는 진단)으로는 못 잰다 — [17]은 forcedToolFor
  //   **앞**에 있는 특수경로라 원리상 안 보인다(helpers/routing.ts 머리글). `결정적도착지`로
  //   전체 체인을 태워야 한다(routeexplain.route.test.ts:49 「설명도착」과 같은 방식).
  it("★★ 결과가 붙어도 실행 지시·보고서는 [17](현황 카드)에 안 뺏긴다", async () => {
    expect(await 첫도착("하드닝 점검 결과가 필요하니 지금 돌려줘")).toBe("run_hardening_scan");
    expect(await 첫도착("하드닝 점검 결과 보고서 만들어줘")).toBe("generateReport");
    expect(await 첫도착("하드닝 점검 결과 리포트로 만들어줘")).toBe("generateReport");
  });

  // ★ 반대쪽 못 — 「실행」이란 낱말이 있어도 **조회**면 안 돈다.
  it("★ 「실행 이력」류는 실행 지시가 아니다", () => {
    for (const q of ["하드닝 점검 실행 이력 보여줘", "보안설정 점검 실행 결과 알려줘", "정기점검 언제 돌아?"]) {
      expect(실제도착(q), q).not.toBe("run_hardening_scan");
    }
  });

  it("★ 세는 말투 조회도 실행으로 안 샌다", () => {
    for (const q of ["점검 안 한 장비 몇 대야?", "하드닝 점검 안 한 서버 몇 개야?"]) {
      expect(실제도착(q), q).not.toBe("run_hardening_scan");
    }
  });
});

describe("③ 0-대상 안내 — FAIL_MARKS에 안 걸린다", () => {
  beforeEach(() => resetHardeningForTests());

  it("등록 대상 0일 때 안내 문구가 폴백 문구 감시에 안 걸린다", () => {
    const { output } = hardeningStatusAnswer();
    expect(output).toContain("등록된 점검 대상이 없습니다");
    const 마크 = FAIL_MARKS목록();
    const 걸린것 = 마크.filter((m) => output.includes(m));
    expect(걸린것, `0-대상 안내가 폴백 문구 감시에 걸렸다: ${걸린것.join(", ")}`).toEqual([]);
  });
});

// ★★ 2026-09-11 검토관 — 「점검 안 한 장비 있어?」에 **미점검 수로 직접 답한다.**
//   앞 판은 KPI 넷(등록 장비·활성 스케줄·평균 준수율·점검 실패) 어디에도 미점검이 없고
//   표는 전 대상이라, 대상이 다 점검된 곳에서 물으면 「없습니다」 대신 준수율 좋은 표가
//   나갔다. 0-대상 QA 인스턴스에서만 우연히 기대 답과 같아졌던 것이다.
describe("③-2 미점검 수 — 물음에 숫자로 답한다", () => {
  beforeEach(() => resetHardeningForTests());

  it("미점검이 있으면 KPI와 글 답이 그 수를 말한다", async () => {
    const 됨 = createTarget({ label: "점검됨", host: "10.9.9.8", port: 22, username: "a", authMethod: "key", secret: "/k" });
    createSchedule(됨.id, "kisa", 24);
    await runDueSchedules(Date.now(), () => 붙박이러너());
    createTarget({ label: "아직", host: "10.9.9.9", port: 22, username: "a", authMethod: "key", secret: "/k" });
    const { output, dataCard } = hardeningStatusAnswer();
    expect(dataCard.kpis.find((k) => k.label === "미점검")!.value).toBe("1");
    expect(output).toContain("미점검 1곳");
    expect(output).toContain("점검 안 한 장비가 1곳 있습니다");
  });

  it("전부 점검됐으면 「없습니다」라고 말한다 — 표만 돌려주지 않는다", async () => {
    const t = createTarget({ label: "점검됨", host: "10.9.9.8", port: 22, username: "a", authMethod: "key", secret: "/k" });
    createSchedule(t.id, "kisa", 24);
    await runDueSchedules(Date.now(), () => 붙박이러너());
    const { output, dataCard } = hardeningStatusAnswer();
    expect(dataCard.kpis.find((k) => k.label === "미점검")!.value).toBe("0");
    expect(output).toContain("점검 안 한 장비는 없습니다");
  });
});

describe("④ 소스 감시 — 만들어 두고 안 부르는 것 방지", () => {
  it("dispatcher.ts가 isHardeningStatusAsk(instructionText)를 실제로 부른다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    expect(src.includes("isHardeningStatusAsk(instructionText)"), "dispatcher.ts가 이 판별자를 안 부른다 — 표만 있고 실행이 없다").toBe(true);
  });

  // ★★★ 2026-09-11 검토관 [중]×2 — 앞 판의 짝 감시는 **자기가 만든 사본으로 초록이 됐다.**
  //   찾던 리터럴이 agentloop.ts에 두 번(FORCED_INTENTS[3]=run_hardening_scan 뒤 보기 ·
  //   새 결과조회꼴) 있었는데
  //   단언이 includes() 한 번뿐이라, 지키겠다고 선언한 짝(FORCED[3] ↔ datacard)이 갈라져도
  //   나머지 사본이 남아 계속 통과했다. 실패 메시지도 사실과 다르게 나왔다.
  //   ★ 지금은 **글자가 아니라 계약**을 잰다 — 아래 ⑥ 세 시험이 제품 함수로 확인한다.
  //   여기서는 「배제용 리터럴은 두 파일에 **정확히 한 번씩**」만 세어 사본이 늘어나는 것을 막는다.
  it("★★ 배제용 실행지시 리터럴이 agentloop.ts·datacard.ts에 정확히 1번씩 있다", () => {
    // ⚠ String.raw — 소스는 **정규식 리터럴**이라 파일에 역슬래시가 하나다(문자열로 적으면
    //   `\s`로 두 번 써야 해 한 글자만 틀려도 조용히 0번이 된다).
    const 리터럴 = String.raw`(점검|진단|스캔|체크)\s*(을|를)?\s*(다시|한\s*번|지금|좀|바로|새로)?\s*(해|하자|하라|하고(?!\s*(있|계|싶))|시켜|`;
    const agentloopSrc = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const datacardSrc = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "datacard.ts"), "utf8");
    const 셈 = (src: string) => src.split(리터럴).length - 1;
    expect(셈(agentloopSrc), "agentloop.ts 결과조회꼴의 배제 리터럴이 1번이 아니다 — 사본이 늘었거나 사라졌다").toBe(1);
    expect(셈(datacardSrc), "datacard.ts 실행지시_RE의 배제 리터럴이 1번이 아니다 — 두 배제가 어긋났다").toBe(1);
  });

  // ★ 베끼지 않는다 — 리포트 만들기 배제는 [36]과 **같은 상수**를 본다(reportintent.ts).
  it("★ datacard.ts·agentloop.ts가 [36]의 리포트 잣대를 베끼지 않고 공용 상수를 부른다", () => {
    const dc = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "datacard.ts"), "utf8");
    const al = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const dp = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");
    for (const [이름, src] of [["datacard.ts", dc], ["agentloop.ts", al]] as const) {
      expect(src.includes("리포트만들기지시"), `${이름}이 공용 잣대를 안 부른다 — 배제를 다시 베낀 것이다`).toBe(true);
      expect(src.includes("(보고서|리포트)"), `${이름}에 [36] 정규식 사본이 남아 있다`).toBe(false);
    }
    expect(dp.includes('from "./reportintent"'), "dispatcher.ts가 잎 모듈을 안 본다 — 원본이 둘이 됐다").toBe(true);
  });
});

// ★★★ 2026-09-11 검토관 [상]①·[중] — **경계는 글자가 아니라 계약으로 잰다.**
//   ⓐ 강제 실행으로 가는 말(FORCED_INTENTS[3] = run_hardening_scan)을 두 배제 잣대가
//      「조회」라고 읽으면 안 된다.
//      읽으면 시킨 점검이 [17] 카드가 되거나 2차 방어에 막혀 **조용히 아무 일도 안 난다.**
//   ⓑ 실행 지시 문장은 [17] 카드로 못 박히면 안 된다 — ⓐ만으로는 못 잡는다(FORCED[3]에
//      안 걸리는 실행 지시가 실제로 그 사고를 냈다: 「하드닝 점검 다시 해서 결과 내줘」).
//   앞 판의 시험은 경계를 「…지금 돌려줘」(실행지시 목록에 이미 든 낱말)로만 재서 원리상 못 봤다.
describe("⑥ 실행과 조회의 경계 — 제품 함수로 잰다(리터럴 대조 아님)", () => {
  // 실측으로 확인한 **실행 지시** 말뭉치. 수리 전 route-explain: 아래 ①은 [17] 카드,
  // ②③④는 「걸리는 규칙 없음」 뒤 2차 방어가 차단 → 첫 수면 null(조용한 무동작)이었다.
  const 실행지시말 = [
    "하드닝 점검 다시 해서 결과 내줘",        // ①
    "방화벽 점검하고 결과 알려줘",            // ②
    "CCE 점검하고 결과 보여줘",               // ③
    "스위치 KISA 기준 점검 진행하고 결과 줘", // ④
    "장비 점검 진행하고 결과 정리해줘",
    "점검 진행하고 결과 정리해줘",
    "하드닝 점검 결과가 필요하니 지금 돌려줘",
    "취약점 진단해줘 결과 정리해서",
  ];

  it("ⓐ 강제 실행으로 가는 말은 두 배제 잣대 어디서도 「조회」로 안 읽힌다", () => {
    for (const q of [...실행지시말, "하드닝 점검 해줘", "보안설정 점검 실행해줘", "어느 장비부터 하드닝 점검해줘"]) {
      if (실제도착(q) !== "run_hardening_scan") continue; // 강제로 안 가는 말은 ⓑ가 맡는다
      expect(isHardeningStatusAsk(q), `[37]로 가는 말인데 [17]도 참이다 — 순서가 바뀌면 카드가 뺏는다: ${q}`).toBe(false);
      expect(결과조회꼴(q), `[37]로 가는 말을 2차 방어가 조회로 읽는다: ${q}`).toBe(false);
    }
  });

  it("ⓑ 실행 지시는 [17] 카드로 못 박히지 않고, 2차 방어도 막지 않는다", async () => {
    for (const q of 실행지시말) {
      expect(await 첫도착(q), `시킨 점검이 조회 카드로 못 박혔다: ${q}`).not.toBe("hardeningStatusAnswer(카드)");
      expect(결과조회꼴(q), `시킨 점검을 2차 방어가 막는다(조용한 무동작): ${q}`).toBe(false);
    }
  });

  it("ⓒ 반대쪽 못 — 조회는 여전히 막힌다(2차 방어가 넓어지기만 한 게 아니다)", () => {
    for (const q of ["점검 결과 좀", "최근 점검 결과?", "하드닝 점검 결과는?", "점검 진행 결과 알려줘", "하드닝 점검 실시 결과는?"]) {
      expect(결과조회꼴(q), `조회인데 2차 방어를 지나간다: ${q}`).toBe(true);
    }
  });
});

// ★★ B6-① 2차 방어(2026-09-11 설계관 지시서) — [17] datacard 결과꼴은 영토어(하드닝·검증·
//   보안설정점검…)나 장비류 낱말을 요구한다. 「점검 결과 좀」·「최근 점검 결과?」처럼 그
//   어느 쪽도 없는 말은 [17]에 안 걸려 ⑨(모델 선택)에 남는다 — 거기서 모델이 그래도
//   run_hardening_scan을 고를 수 있다. agentloop.ts 결과조회꼴()이 그 마지막 벽이다.
describe("⑤ ⑨에서 골라도 점검은 안 돈다 — agentloop.ts 결과조회꼴() 2차 방어", () => {
  // ⚠ 「대조」시험은 진짜 실행 지시라 tool.run까지 간다 — GIJO_NO_SELF_SCAN=1로 자기점검을
  //   꺼서, runHardeningScanTool이 **불렸는지**는 재되 실 셸 명령(execFile)까지는 안 가게
  //   막는다(hardening-selfscan-off.test.ts와 같은 안전장치 · env 없이 돌리면 시험 기계에서
  //   진짜 점검 명령이 돈다).
  const ENV = "GIJO_NO_SELF_SCAN";
  const 원래값 = process.env[ENV];
  beforeEach(() => {
    vi.mocked(chat).mockReset();
    vi.mocked(runHardeningScanTool).mockClear();
    process.env[ENV] = "1";
  });
  afterEach(() => {
    if (원래값 === undefined) delete process.env[ENV];
    else process.env[ENV] = 원래값;
  });

  it("★ 「점검 결과 좀」·「최근 점검 결과?」 — 모델이 run_hardening_scan을 골라도 실행되지 않는다", async () => {
    for (const q of ["점검 결과 좀", "최근 점검 결과?"]) {
      vi.mocked(chat).mockReset();
      vi.mocked(runHardeningScanTool).mockClear();
      // 실 LLM을 안 띄운다 — 결정을 목으로 준다(다른 강제 규칙에 안 걸리는 문장인지는
      // ②의 실제도착() 부재로 이미 확인돼 있다 — 이 말들은 ⑨까지 떨어진다).
      vi.mocked(chat).mockResolvedValueOnce('{"action":"tool","tool":"run_hardening_scan","args":{}}');
      const r = await runAgentLoop(q);
      expect(runHardeningScanTool, `「${q}」에서 점검이 실제로 실행됐다`).not.toHaveBeenCalled();
      // 첫 수에서 막히면(calls.length===0) 루프는 null을 돌려주고 RAG 폴백으로 넘어간다 —
      // 점검 리포트 머리글이 나갈 자리 자체가 없다는 것을 답으로도 확인한다.
      const 답 = r?.output ?? "";
      expect(답, `「${q}」 답에 점검 리포트가 섞였다:\n${답}`).not.toContain("보안장비 하드닝 점검 리포트");
      expect(답, `「${q}」 답에 점검 리포트가 섞였다:\n${답}`).not.toContain("점검한 곳");
    }
  });

  it("대조 — B6-① 세 조건 중 어느 것도 아니면 ⑨에서 골랐을 때 여전히 실행된다", async () => {
    // 「점검 대상 등록해줘」는 FORCED_INTENTS 어디에도 안 걸려(하드닝 topic 없음 · 등록류
    // regex는 자산·장비·서버·모델만 받아 「대상」은 비켜난다) 결정 프롬프트(LLM 루프)까지
    // 간다 — isHowtoNotCommand·isHardeningStatusAsk·결과조회꼴 셋 다 거짓인 문장으로
    // 3153 분기 **자체**가 과하게 막지 않는지를 정확히 잰다(forcedToolFor 빠른 길이 아니다).
    expect(실제도착("점검 대상 등록해줘"), "이 시험의 전제 — 강제 규칙에 안 걸려야 LLM 루프(3153)를 실제로 지난다").toBeNull();
    vi.mocked(chat).mockResolvedValueOnce('{"action":"tool","tool":"run_hardening_scan","args":{"standard":"kisa"}}');
    await runAgentLoop("점검 대상 등록해줘");
    expect(runHardeningScanTool, "2차 방어가 아무 관계 없는 지시까지 실행을 막았다").toHaveBeenCalledTimes(1);
  });
});
