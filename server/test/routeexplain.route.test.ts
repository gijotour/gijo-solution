// test/routeexplain.route.test.ts — **설명이 실제 도착지와 같은가** (2026-09-04 신설 · 계획서 전-1)
//
// ★★ 왜 있나 (실측 2026-09-04)
//   `tools/route-explain.mjs`가 FORCED_INTENTS(agentloop)와 routes.ts 표만 읽고,
//   dispatcher가 agentloop **앞에서** 부르는 결정적 판별자들(picklist·datacard·incidentsteps·
//   screenguide…)을 몰랐다. 그래서 이렇게 **틀리게** 설명했다:
//     · 「미조치 취약점 뭐 있어?」 → 「search로 갑니다」  (실제: isFindingListAsk → 목록+체크칸)
//     · 「취약점 알려주세여」       → 「걸리는 규칙 없음」 (실제: isFindingListAsk → 목록+체크칸)
//     · 「방화벽이 멈췄어」         → 「걸리는 규칙 없음」 (실제: 장애초동절차)
//   설명 도구의 도착지가 제품과 다르면 겹침 경보도 문서도 통째로 거짓이 된다
//   (2026-08-10 「거짓 겹침 경보」와 같은 부류 — 그때는 거짓 경보가 진짜 겹침을 묻었다).
//
// ■ 이 시험이 재는 두 가지
//   ① **짝**: 설명(결정적도착지)의 답 = 제품 판별자를 직접 불러 잰 답. 둘이 갈리면 실패.
//      ⚠ 「제품 함수를 떼어 내 내 정규식을 내가 확인」하지 않는다 — 양쪽 다 **제품 함수**를
//        부르되, 한쪽은 체인 순서까지 태우고 한쪽은 갈래를 하나씩 손으로 확인한다
//        (helpers/routing.ts 머리글이 세워 둔 계약).
//   ② **순서 감시**: `결정적도착지`는 dispatchInstructionCore의 **사본**이라 어긋날 수 있다.
//      각 단계의 `감시`(그 갈래를 여는 코드 글자 그대로)가 본문에 **그 순서대로** 있는지 잰다.
//      갈래를 옮기거나 판별자를 갈면 여기가 먼저 깨진다.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/engine/llm", () => ({
  // 2026-08-29 화살 #14·#15 — llm이 RAG·수집 훅을 내보낸다. 목도 표면을 따라가야 한다
  // (안 주면 그 모듈을 import하는 파일이 통째로 죽는다).
  setRagProvider: vi.fn(), hasRagProvider: vi.fn(() => false), onChatRecorded: vi.fn(), chatLogListenerCount: vi.fn(() => 0),
  chat: vi.fn(async () => "[mock] LLM 응답"),
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  registerLlmRoutes: vi.fn(),
}));

import fs from "node:fs";
import path from "node:path";
import { 결정적도착지, 결정적체인 } from "../src/engine/dispatcher";
import { 길목록 } from "../src/engine/routes";
import { forcedToolFor } from "../src/engine/agentloop";
import { isFindingListAsk, isMyWorkAsk, parsePickCommand } from "../src/engine/picklist";
import { 장애질문인가, 침해사고질문인가 } from "../src/engine/incidentsteps";
import { isHelpIntent, 이름으로화면찾기, 방법질문화면찾기 } from "../src/engine/screenguide";
import { isOutOfScope, isTooVague } from "../src/engine/scopeguard";
import { screenNameCard } from "../src/engine/datacard";
import { 문서지목질문 } from "../src/engine/memory";

/** 설명 도구가 말하는 도착지 — 첫 번째가 이긴다(빈 배열이면 ⑨ 모델 선택). */
async function 설명도착(문장: string, 역할 = "admin"): Promise<string> {
  const 걸림 = await 결정적도착지(문장, { 역할 });
  return 걸림.length ? 걸림[0].도착 : "(모델 선택)";
}

/**
 * **제품 판별자를 하나씩 손으로 불러** 잰 도착지 — 위와 독립된 두 번째 자.
 * ⚠ 여기 적힌 순서는 dispatchInstructionCore를 사람이 읽고 옮긴 것이다. 아래 「순서 감시」가
 *   그 읽기가 맞는지 소스와 대조하므로, 둘이 같이 틀릴 수는 없다.
 */
async function 손으로잰도착(문장: string, 역할 = "admin"): Promise<string> {
  if (screenNameCard(문장)) return screenNameCard(문장) === "finding" ? "findingListAnswer(목록+체크칸)" : "카드";
  if (isTooVague(문장)) return "vagueAnswer";
  if (parsePickCommand(문장)) return "결재판 직행";
  if (isOutOfScope(문장)) return "outOfScopeAnswer";
  if (isMyWorkAsk(문장)) return "myWorkAnswer(목록+체크칸)";
  if (isFindingListAsk(문장) && !문서지목질문(문장)) return "findingListAnswer(목록+체크칸)";
  if (이름으로화면찾기(문장)) return "화면위치안내 + 화면 열기";
  if (방법질문화면찾기(문장)) return "formatScreenGuide + 화면 열기";
  if (isHelpIntent(문장)) return "formatScreenGuide(지금 화면)";
  if (장애질문인가(문장)) return "장애초동절차";
  if (침해사고질문인가(문장)) return "침해사고초동절차";
  const 강제 = forcedToolFor(문장, { role: 역할 });
  return 강제 ? 강제.tool : "(모델 선택)";
}

describe("★★ 설명이 실제 도착지와 같다 — 6문장 짝 시험", () => {
  // ⚠ 표본은 **틀렸던 그 문장들**이다. 고친 것을 고친 자리에서 다시 잰다.
  const 짝 = [
    { 말: "미조치 취약점 뭐 있어?", 도착: "findingListAnswer(목록+체크칸)", 옛설명: "search" },
    { 말: "취약점 알려주세여", 도착: "findingListAnswer(목록+체크칸)", 옛설명: "(걸리는 규칙 없음)" },
    { 말: "사례 등록: 2024년 한빛물류 랜섬웨어, 초기 침투는 VPN 계정 탈취, 출처 https://example.com/case-1", 도착: "register_incident_case", 옛설명: "register_incident_case(맞았다)" },
    { 말: "방화벽이 멈췄어", 도착: "장애초동절차", 옛설명: "(걸리는 규칙 없음)" },
    { 말: "침해사고 히스토리 보여줘", 도착: "incident_cases", 옛설명: "incident_cases(맞았다)" },
    // ★ 이 도구가 **드러낸** 실제 겹침 1건(2026-09-04 --겹침): 「정기점검」+「알려줘」가
    //   isHardeningStatusAsk에 채여 현황 숫자 카드가 나가고 사내 매뉴얼(explain)이 밀렸다.
    //   datacard.ts에 방법·절차 배제어를 넣어 카드가 물러난다 — 여기가 그 짝이다.
    { 말: "방화벽 월간 정기점검 절차를 알려줘", 도착: "explain", 옛설명: "hardeningStatusAnswer(카드)가 가로챘다" },
  ];

  for (const { 말, 도착, 옛설명 } of 짝) {
    it(`「${말.slice(0, 24)}${말.length > 24 ? "…" : ""}」 → ${도착} (옛 설명: ${옛설명})`, async () => {
      expect(await 설명도착(말), "설명 도구의 답").toBe(도착);
      expect(await 손으로잰도착(말), "제품 판별자를 직접 불러 잰 답").toBe(도착);
    });
  }

  it("★ 여섯 문장 전부 — 설명과 손으로 잰 값이 **한 건도** 안 갈린다", async () => {
    const 갈린것: string[] = [];
    for (const { 말 } of 짝) {
      const a = await 설명도착(말);
      const b = await 손으로잰도착(말);
      if (a !== b) 갈린것.push(`「${말}」 설명=${a} / 실제=${b}`);
    }
    expect(갈린것, `설명이 실제와 갈렸다:\n  ${갈린것.join("\n  ")}`).toEqual([]);
  });

  it("⚠ 「미조치 취약점 뭐 있어?」는 **search가 아니다** — 옛 설명이 지목하던 도구로 가지 않는다", async () => {
    const 걸림 = await 결정적도착지("미조치 취약점 뭐 있어?", { 역할: "admin" });
    expect(걸림[0].판별).toBe("isFindingListAsk");
    // 강제도구(search가 아니라 finding_status)는 **뒤에 있어 밀린다** — 「겹치지만 진다」가 정답이다
    const 밀린것 = 걸림.slice(1).map((r) => r.도착);
    expect(밀린것).not.toContain("search");
    expect(걸림[0].차례).toBeLessThan(걸림[걸림.length - 1].차례);
  });

  it("★ 「…정기점검 절차를 알려줘」의 겹침이 **사라졌다** — 하드닝 현황 카드가 아예 안 걸린다", async () => {
    const 걸림 = await 결정적도착지("방화벽 월간 정기점검 절차를 알려줘", { 역할: "admin" });
    expect(걸림.map((r) => r.판별), "현황 카드가 다시 물면 오답(절차 물음에 숫자)").not.toContain("isHardeningStatusAsk");
    expect(걸림.length, "걸리는 규칙이 하나뿐이라야 겹침이 사라진다").toBe(1);
    expect(걸림[0].도착).toBe("explain");
  });

  it("★ 반례 — 「하드닝 점검 결과 알려줘」는 여전히 현황 카드가 이긴다(배제어가 넓게 먹지 않았다)", async () => {
    const 걸림 = await 결정적도착지("하드닝 점검 결과 알려줘", { 역할: "admin" });
    expect(걸림[0].판별).toBe("isHardeningStatusAsk");
  });
});

describe("★ 순서 감시 — 결정적도착지가 dispatchInstructionCore와 같은 순서다", () => {
  const 소스 = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "dispatcher.ts"), "utf8");

  /** dispatchInstructionCore의 몸통만 — `결정적도착지` 쪽 글자가 섞이면 감시가 헛돈다. */
  function 본문(): string {
    const 시작 = 소스.indexOf("async function dispatchInstructionCore(");
    const 끝 = 소스.indexOf("export interface 도착단계");
    expect(시작, "dispatchInstructionCore를 못 찾았다 — 이 시험이 낡았다").toBeGreaterThan(-1);
    expect(끝, "도착단계 선언을 못 찾았다 — 「결정적도착지가 core 뒤」라는 전제가 깨졌다").toBeGreaterThan(시작);
    // ⚠ 주석 줄은 걷어낸다 — 「isHelpIntent보다 먼저 본다」 같은 **설명문**이 실제 호출보다 앞에
    //   있어, 안 걷어내면 순서를 거꾸로 읽는다(2026-08-05·08-10에 route-explain이 밟은 함정).
    return 소스.slice(시작, 끝).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  }

  it("모든 단계의 `감시` 글자가 본문에 실재한다 — 없으면 그 갈래가 사라졌거나 이름이 바뀐 것이다", async () => {
    const b = 본문();
    const 없는것 = (await 결정적체인()).filter((s) => !b.includes(s.감시)).map((s) => `[${s.차례}] ${s.이름} — 「${s.감시}」`);
    expect(
      없는것,
      `아래 갈래를 dispatchInstructionCore에서 못 찾았다 — 코드가 바뀌었으면 결정적도착지의 \`감시\`도 고쳐야 한다:\n  ${없는것.join("\n  ")}`,
    ).toEqual([]);
  });

  it("★ 순서까지 같다 — 갈래를 위아래로 옮기면 여기가 깨진다", async () => {
    const b = 본문();
    const 체인 = await 결정적체인();
    const 어긋남: string[] = [];
    let 앞자리 = -1;
    let 앞이름 = "(시작)";
    for (const s of 체인) {
      const i = b.indexOf(s.감시);
      if (i < 0) continue; // 위 시험이 따로 잡는다
      if (i < 앞자리) 어긋남.push(`[${s.차례}] ${s.이름}이 「${앞이름}」보다 **앞**에 있다`);
      앞자리 = i;
      앞이름 = s.이름;
    }
    expect(
      어긋남,
      `실제 호출 순서와 설명 순서가 어긋났다(설명이 거짓이 된다):\n  ${어긋남.join("\n  ")}`,
    ).toEqual([]);
  });

  it("★ `--표`가 찍는 것(=결정적체인)과 routes.ts 길목록이 **같은 순서·같은 도착지**다", async () => {
    // 짝 시험 — `--표`는 결정적체인()을 그대로 찍고, routes.ts는 그 표를 사람 말로 옮긴 것이다.
    // 둘이 갈리면 「문서는 이렇게 적혀 있는데 도구는 저렇게 말한다」가 된다(빠뜨림은 routes.test가 잰다).
    const 체인 = await 결정적체인();
    const 표 = 길목록.filter((r) => r.차례 !== undefined).sort((a, b) => a.차례! - b.차례!);
    expect(표.map((r) => `[${r.차례}] ${r.이름} → ${r.도착}`)).toEqual(체인.map((s) => `[${s.차례}] ${s.이름} → ${s.도착}`));
  });

  it("체인이 통째로 비거나 강제도구가 맨 끝이 아니면 헛돌고 있는 것이다", async () => {
    const 체인 = await 결정적체인();
    expect(체인.length, "체인이 비었다 — 아무것도 안 재고 있다").toBeGreaterThan(20);
    expect(체인[체인.length - 1].판별, "강제도구(forcedToolFor)는 체인의 **맨 끝**이다 — 그 뒤는 모델 선택뿐이다").toBe("forcedToolFor");
    // 차례는 빈틈 없이 0,1,2… — 중간을 건너뛰면 「몇 번째로 본다」가 거짓이 된다
    expect(체인.map((s) => s.차례)).toEqual(체인.map((_, i) => i));
  });
});

describe("★ 데이터가 갈라 주는 갈래는 「간다」고 단정하지 않는다", () => {
  it("내 업무·내 문서 갈래는 조건부로 표시된다 — 없는 확신을 주지 않는다", async () => {
    const 체인 = await 결정적체인();
    const 조건부들 = 체인.filter((s) => s.조건부).map((s) => s.판별);
    // 이 넷은 **열려 있는 내 할 일·내 문서 조각과 겹칠 때만** 채 간다(dispatcher 주석 그대로).
    expect(조건부들).toContain("내문서찾기질문");
    expect(조건부들).toContain("되열기_RE");
    expect(조건부들).toContain("내할일완료말");
    expect(조건부들).toContain("내할일절차질문");
    // 반대로 글자만으로 갈리는 갈래는 조건부가 아니다 — 아무 데나 붙이면 표시가 뜻을 잃는다
    expect(체인.find((s) => s.판별 === "isFindingListAsk")?.조건부).toBeUndefined();
    expect(체인.find((s) => s.판별 === "forcedToolFor")?.조건부).toBeUndefined();
  });
});

describe("★ 소스 감시 — route-explain은 낡은 dist로 답하지 않는다", () => {
  // ★★ 왜 있나 (실측 2026-09-04 · 9b7b9ac5)
  //   위 「순서 감시」는 **dispatcher.ts의 체인 순서만** 대조한다. 그래서 datacard.ts처럼
  //   **다른 소스**만 고치고 빌드를 안 하면 도구가 아무 말도 못 했다 — 겹침이 9로 그대로
  //   나왔고 경보도 없었다(사람이 `npm run build`를 손으로 하고서야 답이 바뀌었다).
  //   낡은 dist를 설명하면 겹침 표도 문서도 통째로 거짓이 되므로, 도구가 **스스로 다시 빌드**한다.
  // ⚠ 이 시험은 시각(mtime)을 재지 않는다 — CI가 언제 무엇을 빌드했는지에 시험이 매달리면
  //   깜빡이는 시험이 된다. 대신 **그 분기가 코드에 실재하는가**만 글자로 잰다.
  const 도구 = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "route-explain.mjs"), "utf8");

  it("소스(.ts)가 짝 .js보다 새로운지 **시각으로** 재는 분기가 있다", () => {
    expect(도구, "낡은 소스를 찾는 함수가 사라졌다").toContain("function 낡은소스찾기(");
    expect(도구, "mtime 비교가 사라지면 낡은 dist를 못 본다").toContain("mtimeMs");
    expect(도구, ".d.ts는 .js를 안 뽑는다 — 안 걸러내면 영원히 「낡음」이 된다").toContain(".d.ts");
  });

  it("★ 낡았으면 **멈추지 않고 다시 빌드**한다 — tsc를 실제로 부른다", () => {
    // 00b47a67에서 mtime을 뺀 이유는 거짓 경보였는데, 잘못은 mtime이 아니라 **멈춘 것**이었다.
    // 거짓 경보의 값은 tsc 한 번(약 40초)뿐이다.
    expect(도구, "빌드 분기가 사라졌다").toContain("function 필요하면빌드(");
    expect(도구, "tsc를 부르지 않으면 「낡았다」고 알리고 마는 옛 판으로 돌아간 것이다").toContain("spawnSync");
    expect(도구, "server/tsconfig.json 기준으로 빌드해야 dist 자리가 맞는다").toContain('"tsconfig.json"');
    expect(도구, "빌드 실패는 종료코드 2로 멈춘다 — 낡은 dist로 답하면 거짓 설명이 된다").toContain("process.exit(2)");
  });

  it("--no-build면 건너뛰고 「낡았을 수 있음」 경고만 남긴다", () => {
    expect(도구, "--no-build 갈래가 사라졌다").toContain("--no-build");
    expect(도구, "경고 문구가 없으면 조용히 낡은 답을 준다").toMatch(/낡았을 수 있습니다/);
  });

  it("★★ 두 감시가 **둘 다** 살아 있다 — 서로 다른 함정을 잡는다", () => {
    // ① 시각(빌드를 했나) ② 내용(체인이 그대로인가). 하나로 줄이면 다른 쪽 함정이 되살아난다:
    //   ①만 두면 갈래를 옮겼는데 빌드가 최신인 경우를 못 보고,
    //   ②만 두면 dispatcher 아닌 파일만 고친 경우를 못 본다(9b7b9ac5가 바로 그 사고였다).
    expect(도구, "체인 순서 대조(내용 자)가 사라졌다").toContain("function 체인이소스와같나(");
    expect(도구, "시각 자가 사라졌다").toContain("function 낡은소스찾기(");
  });
});
