// test/incidentsteps.route.test.ts — 계획서 전-4
//
// ⚠ 왜 이 시험이 있나(2026-08-10 실측): 「장비 장애 초동 절차」를 08-09에 만들어 넣었는데,
//   실제로는 **닿지 않았다.** 앞선 「조치 플레이북」 분기가 `어떻게 대응`을 먼저 채 가서
//   담당자는 장애 상황에 「일반 취약점 조치 · 30일 내」 표를 받았다.
//   → **「기능을 만들었다」와 「그 말이 그 기능에 닿는다」는 다르다.** 여기서 그 차이를 잰다.
//
// ⚠ 그래서 이 시험은 함수를 따로 부르지 않고 **판별자끼리 겨루게** 한다. 어느 쪽이 먼저
//   잡는지가 문제였지, 함수 자체는 처음부터 멀쩡했다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 장애질문인가, 침해사고질문인가 } from "../src/engine/incidentsteps";

const dispatcherSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "engine", "dispatcher.ts"),
  "utf8",
);

/**
 * 소스에서 **어떤 위치 바로 앞의** `re: /…/` 정규식을 꺼낸다.
 * ⚠ `match`는 첫 매치를 준다 — 그대로 쓰면 파일 앞쪽의 남의 규칙을 잡는다(그래서 마지막을 쓴다).
 * ⚠ 같은 코드를 세 번 베껴 쓰다 한 벌에서 이스케이프가 깨졌다(2026-08-10) — 그래서 한 곳으로 뺐다.
 */
function 앞의정규식(src: string, 위치: number): RegExp {
  const 앞 = src.slice(0, 위치);
  const 전부 = [...앞.matchAll(/re:\s*(\/(?:[^/\\\n]|\\.)+\/[a-z]*),\s*$/gm)];
  if (!전부.length) throw new Error("앞쪽에서 re: 정규식을 못 읽었습니다");
  const 리터럴 = 전부[전부.length - 1][1];
  const 끝 = 리터럴.lastIndexOf("/");
  return new RegExp(리터럴.slice(1, 끝), 리터럴.slice(끝 + 1));
}

/** dispatcher가 쓰는 플레이북 판별식을 **소스에서 그대로** 꺼낸다(베끼면 어긋난다). */
function 플레이북정규식(): RegExp {
  const m = dispatcherSrc.match(/const REMEDIATION_INTENT_RE\s*=\s*(\/.*\/i?);/);
  if (!m) throw new Error("REMEDIATION_INTENT_RE를 소스에서 못 찾았습니다 — 이름이 바뀌었나요?");
  const body = m[1].slice(1, m[1].lastIndexOf("/"));
  const flags = m[1].slice(m[1].lastIndexOf("/") + 1);
  return new RegExp(body, flags);
}

describe("장애·침해 초동 절차가 플레이북에 먹히지 않는다 (전-4)", () => {
  const 플레이북 = 플레이북정규식();

  it("★ 장애 질문은 플레이북 분기에서 비켜 간다 — 실제 배제 조건까지 확인", () => {
    const 물음 = "방화벽 장비가 갑자기 죽었어. 어떻게 대응해?";
    // 플레이북 정규식 자체에는 걸린다(그래서 사고가 났다) — 배제가 없으면 채인다.
    expect(플레이북.test(물음), "이 말은 원래 플레이북 정규식에 걸린다(그게 사고의 원인)").toBe(true);
    expect(장애질문인가(물음), "장애로 인식해야 한다").toBe(true);
    // dispatcher가 실제로 배제하고 있는가 — 소스에 배제 조건이 있어야 한다.
    expect(
      /REMEDIATION_INTENT_RE\.test\(instructionText\)\s*&&\s*\n?\s*!장애질문인가\(instructionText\)/.test(
        dispatcherSrc,
      ),
      "플레이북 조건에 `!장애질문인가(...)` 배제가 있어야 한다",
    ).toBe(true);
  });

  it("★ 침해사고 질문도 플레이북에서 비켜 간다", () => {
    const 물음 = "침해사고 의심될 때 대응 절차 알려줘";
    expect(플레이북.test(물음)).toBe(true);
    expect(침해사고질문인가(물음)).toBe(true);
    expect(
      /!침해사고질문인가\(instructionText\)/.test(dispatcherSrc),
      "플레이북 조건에 `!침해사고질문인가(...)` 배제가 있어야 한다",
    ).toBe(true);
  });

  it("취약점 조치 물음은 여전히 플레이북 몫이다 — 영토를 뺏지 않았다", () => {
    for (const q of ["이 취약점 조치 절차 알려줘", "Log4Shell 어떻게 패치해?", "조치 방법 알려줘"]) {
      expect(플레이북.test(q), `${q}는 플레이북에 걸려야 한다`).toBe(true);
      expect(장애질문인가(q), `${q}는 장애가 아니다`).toBe(false);
      expect(침해사고질문인가(q), `${q}는 침해사고가 아니다`).toBe(false);
    }
  });

  it("침해사고 판별 — 당한 것만 잡고 교육·법령은 안 잡는다", () => {
    for (const q of ["해킹당한 것 같은데 뭐부터 해?", "랜섬웨어 감염됐어 어떻게 대응해?", "자료 유출 의심될 때 절차"]) {
      expect(침해사고질문인가(q), `${q}는 침해사고다`).toBe(true);
    }
    for (const q of ["침해사고 대응 교육 언제야?", "침해사고 신고 기한 법령 알려줘", "해킹 사례 연구 자료 있어?"]) {
      expect(침해사고질문인가(q), `${q}는 침해 절차 질문이 아니다`).toBe(false);
    }
  });

  it("★ 침해 절차는 증거 보전이 복구보다 먼저다 — 순서가 뒤집히면 증거가 사라진다", async () => {
    const { 침해사고초동절차 } = await import("../src/engine/incidentsteps");
    const 글 = 침해사고초동절차("침해사고 의심될 때 대응 절차 알려줘");
    const 증거 = 글.indexOf("증거 보전");
    const 복구 = 글.indexOf("근절·복구");
    expect(증거).toBeGreaterThan(-1);
    expect(복구).toBeGreaterThan(-1);
    expect(증거, "증거 보전이 복구보다 앞에 있어야 한다").toBeLessThan(복구);
    expect(글, "전원을 끄지 말라는 경고가 있어야 한다(메모리 증거가 사라진다)").toMatch(/전원을 끄지 말/);
  });
});

describe("「하려면」은 방법을 묻는 말이다 — 승인창을 띄우지 않는다", () => {
  /** agentloop의 자산 등록 강제 규칙을 소스에서 꺼낸다. */
  function 등록정규식(): RegExp {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const i = src.indexOf('tool: "register_asset"');
    expect(i, "register_asset 강제 규칙을 못 찾았습니다").toBeGreaterThan(-1);
    return 앞의정규식(src, i);
  }

  it("★ 「자산을 등록하려면 어떻게 해?」는 등록 실행으로 잡지 않는다", () => {
    expect(등록정규식().test("자산을 등록하려면 어떻게 해?")).toBe(false);
  });

  it("등록 의사를 밝힌 말은 그대로 잡는다 — 좁히다가 잃으면 안 된다", () => {
    const re = 등록정규식();
    for (const q of [
      "새 서버 10.0.0.99를 자산으로 등록해줘",
      "자산 등록할게",
      "장비 등록하려고",
      "신규 자산 추가",
    ]) {
      expect(re.test(q), `${q}는 등록 의사다`).toBe(true);
    }
  });
});

describe("「○○ 하려면 어떻게 해?」는 그 화면 안내로 간다 — 빈 자리를 모델이 채우지 않게", () => {
  it("★ 자산 등록 방법 질문이 자산 화면을 가리킨다", async () => {
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    const 찾음 = 방법질문화면찾기("자산을 등록하려면 어떻게 해?");
    expect(찾음, "자산 화면을 찾아야 한다").not.toBeNull();
    expect(찾음!.screen).toBe("inventory.html");
  });

  it("남의 제품을 물으면 화면 안내가 아니다 — 2026-07-26 사고와 같은 이유", async () => {
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    expect(방법질문화면찾기("Tenable에서 자산 등록하려면 어떻게 해?")).toBeNull();
  });

  it("방법 질문이 아니면 안 잡는다 — 자리 질문·조회와 갈라진다", async () => {
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    for (const q of ["자산 화면 어디야?", "우리 자산 몇 대야?", "자산 목록 보여줘"]) {
      expect(방법질문화면찾기(q), `${q}는 방법 질문이 아니다`).toBeNull();
    }
  });

  it("★ 「장비에 접속해서 확인하려면?」이 하드닝 화면 안내로 간다 — 정규식 별칭 (2026-08-14 ops-sim 회귀)", async () => {
    // 화면 이름이 안 든 말꼴 질문 — 이름 대조로는 영영 못 잡고 빈 자리를 7B가
    // 하드닝 준수율 **결과**로 채웠다(물은 건 방법). 152상황 ⑬마당 문항 그대로.
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    const 찾음 = 방법질문화면찾기("장비에 접속해서 확인하려면?");
    expect(찾음).not.toBeNull();
    expect(찾음!.screen).toBe("hardening.html");
    // 경계 — 「접속기록」(보관연한) 질문은 장비류 낱말이 없어 안 잡힌다.
    expect(방법질문화면찾기("접속기록은 얼마나 보관하려면 되나?")).toBeNull();
  });

  it("★ dispatcher가 실제로 이 갈래를 부른다 — 만들어 두고 안 부르면 없는 것과 같다", () => {
    expect(/const 방법화면 = 방법질문화면찾기\(instructionText\);/.test(dispatcherSrc)).toBe(true);
    // isHelpIntent보다 앞이어야 한다(다른 화면 이름을 대고 물을 때 엉뚱한 안내를 막는다).
    expect(dispatcherSrc.indexOf("방법질문화면찾기(instructionText)")).toBeLessThan(
      dispatcherSrc.indexOf("isHelpIntent(instructionText, screen)"),
    );
  });
});

describe("「어떻게 돌려?」도 방법 질문이다 — 다만 장애 질문을 삼키면 안 된다", () => {
  it("★ 「레드팀 점검 어떻게 돌려?」가 레드팀 화면을 가리킨다", async () => {
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    const 찾음 = 방법질문화면찾기("레드팀 점검 어떻게 돌려?");
    expect(찾음, "레드팀 화면을 찾아야 한다 — 고치기 전엔 엉뚱한 자산 이름을 답했다").not.toBeNull();
    expect(찾음!.screen).toBe("redteam.html");
  });

  it("★★ 장애 질문은 여전히 방법 질문이 아니다 — 넓히면 오늘 고친 것이 다시 막힌다", async () => {
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    // 이 갈래는 플레이북·장애 분기보다 **앞**에 있다. 여기서 잡히면 초동 절차에 영영 못 닿는다.
    expect(방법질문화면찾기("방화벽 장비가 갑자기 죽었어. 어떻게 대응해?")).toBeNull();
    expect(방법질문화면찾기("침해사고 의심될 때 대응 절차 알려줘")).toBeNull();
  });

  it("★ 「가드레일이 뭐야?」에 제품이 자기 기능을 설명한다", async () => {
    const { faqAnswerFor } = await import("../src/engine/productfaq");
    const 카드 = faqAnswerFor("가드레일이 뭐야?");
    expect(카드, "고치기 전엔 「근거가 없습니다」라고 답했다").not.toBeNull();
    expect(카드!.answer).toMatch(/프롬프트 인젝션/);
    expect(카드!.answer).toMatch(/작업 기록/);
  });

  it("설정 변경·결과 조회는 개념 카드가 아니다 — 뜻 묻는 말만 잡는다", async () => {
    const { faqAnswerFor } = await import("../src/engine/productfaq");
    expect(faqAnswerFor("가드레일 켜줘")).toBeNull();
    expect(faqAnswerFor("가드레일 차단 기록 보여줘")).toBeNull();
  });
});

describe("장비 로그 코드는 변하지 않는 지식이다 — 회차마다 답이 달라지면 안 된다", () => {
  it("★ ASA 106023을 결정적으로 설명한다 — 한 회차는 옳고 한 회차는 「찾지 못했습니다」였다", async () => {
    const { faqAnswerFor } = await import("../src/engine/productfaq");
    for (const q of [
      "ASA 106023 로그가 계속 올라오는데 무슨 의미야?",
      "%ASA-4-106023 무슨 뜻이야?",
      "ASA 로그 코드 의미 알려줘",
    ]) {
      const 카드 = faqAnswerFor(q);
      expect(카드, `${q}에 카드가 나와야 한다`).not.toBeNull();
      expect(카드!.answer).toMatch(/ACL|차단/);
    }
  });

  it("막힌 기록과 뚫린 기록을 구분해 말한다 — 이 구분이 담당자의 판단을 가른다", async () => {
    const { faqAnswerFor } = await import("../src/engine/productfaq");
    const a = faqAnswerFor("ASA 106023 로그가 계속 올라오는데 무슨 의미야?")!.answer;
    expect(a).toMatch(/막힌 기록/);
    expect(a).toMatch(/뚫린 기록이 아닙니다|뚫린 것/);
  });
});

describe("레드팀 — 「결과 조회」와 「점검 실행」을 가른다 (전-2)", () => {
  it("★ 결과를 묻는 말이 조회 도구로 간다 — 고치기 전엔 실행 도구의 인자 오류를 답했다", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const i = src.indexOf('tool: "redteam_status"');
    expect(i, "redteam_status 강제 규칙이 있어야 한다").toBeGreaterThan(-1);
    const re = 앞의정규식(src, i);
    for (const q of ["레드팀 점검 결과 알려줘", "레드팀 어땠어", "AI 견고성 점수 보여줘"]) {
      expect(re.test(q), `${q}는 결과 조회다`).toBe(true);
    }
    // ⚠ 실행 지시는 잡으면 안 된다 — 잡으면 「점검해줘」가 조회로 새어 아무 일도 안 일어난다.
    for (const q of ["레드팀 점검 해줘", "이 자산 레드팀 점검해줘", "레드팀 점검 어떻게 돌려?"]) {
      expect(re.test(q), `${q}는 실행·안내다`).toBe(false);
    }
  });

  it("★ 도구가 실제로 등록돼 있고 라우팅 표에도 적혀 있다 — 셋 중 하나만 빠져도 안 닿는다", () => {
    const reg = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agenttools", "registry.ts"), "utf8");
    const routes = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "routes.ts"), "utf8");
    expect(reg).toMatch(/name: "redteam_status"/);
    expect(reg).toMatch(/run: runRedteamStatus/);
    expect(routes).toMatch(/도착: "redteam_status"/);
  });

  it("한 번도 안 돌렸으면 없다고 말하고 돌리는 법을 알려 준다 — 빈손으로 돌려보내지 않는다", async () => {
    const { runRedteamStatus } = await import("../src/engine/agenttools/handlers");
    const 글 = runRedteamStatus();
    expect(typeof 글).toBe("string");
    expect(글.length).toBeGreaterThan(20);
    // 기록이 있든 없든, 다음에 무엇을 할 수 있는지는 항상 있어야 한다.
    expect(글).toMatch(/AI 공격 시험|이어서|화면/);
  });
});
