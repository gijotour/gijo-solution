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

  // ★ 2026-08-21 4차 시나리오 발견: 법적 신고 의무 질문이 「침해사고」 낱말로 초동에 채이던 것 수리.
  //   법 프레이밍(신고/통지 의무·대상·절차, 의무화, 과태료, 법률상…)으로 가르되, **활성 사고**면 초동 먼저.
  it("법적 신고 의무 질문은 침해가 아니다 — 단 활성 침해면 초동 보존(검토관 미아 방지)", () => {
    for (const q of [
      "정보통신망법상 침해사고 신고 의무가 어떻게 돼?",
      "신용정보법상 해킹 신고 의무 알려줘",
      "침해사고 통지 의무는 법률상 어떻게 규정돼?",
      "해킹 시 법적 신고 의무가 있어?",
      // 형제 어법(검토관 ①-2) — 과태료·신고 대상/절차·의무화도 법령 질문이라 침해 아님
      "침해사고 신고 안 하면 과태료 어떻게 돼?",
      "침해사고 신고 대상 어떻게 판단해?",
      "침해사고 신고가 의무화됐다는데 어떻게 적용돼?",
    ]) {
      expect(침해사고질문인가(q), `${q}는 법령 질문이라 침해가 아니다`).toBe(false);
    }
    // ★ 활성 침해(걸렸/당했) + 의무 낱말 → 여전히 침해(검토관 ①-1 미아 방지). 「신고해야」·「사내 보고 의무」도 침해.
    for (const q of [
      "랜섬웨어 걸렸는데 신고해야 하나?",
      "해킹당했는데 사내 보고 의무 있어 어떻게 해?",
      "해킹당했는데 신고 의무부터 알려줘, 어떻게 대응해?",
      "랜섬 걸렸어. 법적 책임 없이 어떻게 대응해야 하나?",
    ]) {
      expect(침해사고질문인가(q), `${q}는 활성 사고라 여전히 침해다`).toBe(true);
    }
  });

  // ★ 비켜 준 법령 질문이 FORCED law_lookup에 결정적으로 닿는가 — 약칭 「망법·신용정보법」 추가(설계관 뿌리).
  //   약칭이 침해아님·FORCED·법령질문RE **세 곳**에서 투명했던 것이 뿌리였다. 각 토큰을 **순서 무관**하게 검사.
  it("약칭 법이름(정보통신망법·신용정보법)이 FORCED law_lookup·법령질문RE 두 곳에 등록됐다", () => {
    const agentloopSrc = fs.readFileSync(
      path.join(__dirname, "..", "src", "engine", "agentloop.ts"),
      "utf8",
    );
    const memorySrc = fs.readFileSync(
      path.join(__dirname, "..", "src", "engine", "memory.ts"),
      "utf8",
    );
    // FORCED law_lookup 정규식 줄(두 약칭이 함께 있는 유일한 줄)에 각 토큰이 순서 무관하게 있어야 한다
    const forcedLine = agentloopSrc.split("\n").find((l) => /망법/.test(l) && /신용정보법/.test(l)) || "";
    expect(forcedLine, "FORCED law_lookup에 망법").toMatch(/망법/);
    expect(forcedLine, "FORCED law_lookup에 신용정보법").toMatch(/신용정보법/);
    // 법령질문RE(memory.ts)에도 같은 약칭이 있어야 세 정규식이 대칭이다
    const 법령질문Line = memorySrc.split("\n").find((l) => /법령질문RE\s*=/.test(l)) || "";
    expect(법령질문Line, "법령질문RE에 망법").toMatch(/망법/);
    expect(법령질문Line, "법령질문RE에 신용정보법").toMatch(/신용정보법/);
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
    expect(찾음!.표준전용).toBe(true); // 라이트엔 이 화면이 없다 — dispatcher가 이 표식으로 가른다
    // 경계 — 「접속기록」(보관연한) 질문은 장비류 낱말이 없어 안 잡힌다.
    expect(방법질문화면찾기("접속기록은 얼마나 보관하려면 되나?")).toBeNull();
  });

  it("★ 「서버 접속기록 조회하려면?」은 하드닝으로 안 간다 — 로그 조회≠장비 접속 (검토관 2026-08-14 ⓒ/⑦)", async () => {
    // 접속「기록」(로그)은 하드닝(장비 SSH 접속 점검)과 다른 일 — 부정형 선견으로 제외.
    const { 방법질문화면찾기 } = await import("../src/engine/screenguide");
    const r = 방법질문화면찾기("서버 접속기록 조회하려면 어떻게 해?");
    expect(r?.screen).not.toBe("hardening.html");
  });

  it("★ 라이트(도구 허용목록 걸림)에서는 표준전용 별칭이 없는 화면을 안내하지 않는다 (검토관 2026-08-14 ⓒ)", async () => {
    // dispatcher가 방법화면.표준전용 && 에디션제한중() 이면 비켜 준다 — 소스로 계약을 못박는다
    // (실행하려면 라이트 서버 부팅이 필요해 여기서는 배선 존재를 확인한다).
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(__dirname, "../src/engine/dispatcher.ts"), "utf8");
    expect(src).toContain("방법화면.표준전용 && 에디션제한중()");
    const reg = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools/registry.ts"), "utf8");
    expect(reg).toContain("export function 에디션제한중()");
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

// ══════════════════════════════════════════════════════════════════════════════
// ★ 사고 중 「~해도 되나요?」 — 2026-08-22 운영 실측으로 신설
//
// 실측한 거짓 답(운영 서버 /api/dispatch):
//   물음: 「랜섬웨어 걸렸을 때 전원을 꺼도 되나요?」
//   답  : 「판단 불가 — 이 행동을 판정할 사내 규정 문서 근거가 검색되지 않았습니다」
//   그런데 같은 답의 참고 자료 칸에 「전원을 끄지 말고 네트워크만 끊는다」를 **인용해 놓고**
//        「판정 근거로 **쓰지 않았습니다**」라고 적었다.
//   ★★ **정답을 손에 쥐고도 모른다고 답한 것**이다. 그것도 불난 집에서.
//   ⚠ 더 아픈 것: 정답이 지식 문서도 아니고 **이 파일의 침해사고초동절차()에 코드로** 있었다.
// ══════════════════════════════════════════════════════════════════════════════
describe("★ 사고 중에는 「~해도 되나」도 절차를 묻는 말이다", () => {
  it("★★ 활성 사고 + 허락 어형 → 침해 초동이 받는다", () => {
    for (const q of [
      "랜섬웨어 걸렸을 때 전원을 꺼도 되나요?",      // 실측으로 걸린 그 문장
      "랜섬웨어 걸렸는데 전원 꺼도 될까요?",
      "랜섬웨어 걸렸을 때 전원을 꺼도 됩니까?",       // 「됩」 — 잣대 두 벌이 어긋나 있던 어형
      "해킹당했는데 PC 꺼도 괜찮나요?",              // 앞말이 영문(장비 이름은 영문이 흔하다)
      "감염됐는데 랜선 뽑아도 되나요?",              // 「감염됐」 — 침해말 목록에 없던 어형
      "털렸는데 서버 꺼도 되나요?",
    ]) {
      expect(침해사고질문인가(q), `${q} — 사고 중 허락 물음은 초동이 받아야 한다`).toBe(true);
    }
  });

  it("★★ 반례 — **평시** 허락 물음은 삼키지 않는다 (행동 대조가 우리 차별 기능이다)", () => {
    // 이 갈래를 넓게 열면 계획서 전-2(행동 대조)가 죽는다. 좁힌 것이 맞는지 여기서 지킨다.
    for (const q of [
      "USB 써도 되나요?",
      "가명정보를 마케팅에 써도 되나요?",
      "점검 결과를 개인 메일로 보내도 됩니까?",
      "외부에 자료 공유해도 되나요?",
      "랜섬웨어 대응 교육자료 배포해도 되나요?",     // 침해 낱말이 있어도 사고 중이 아니다
      "악성코드 감염 통계 외부 공유해도 되나요?",     // 「감염」 홑낱말을 안 넣은 이유
    ]) {
      expect(침해사고질문인가(q), `${q} — 평시 허락 물음은 행동 대조 몫이다`).toBe(false);
    }
  });

  it("★ 사고 낱말이 없으면 허락 어형만으로는 안 걸린다", () => {
    for (const q of ["전원 꺼도 되나요?", "이거 지워도 될까요?"]) {
      expect(침해사고질문인가(q), `${q} — 무슨 사고인지 없으면 초동이 아니다`).toBe(false);
    }
  });

  it("★ 행동 대조 분기가 **사고 중이면 비켜 준다**(dispatcher 소스 계약)", () => {
    // 순서상 행동 대조가 침해보다 앞에 있어서, 배제 조건이 없으면 먼저 채 간다.
    expect(
      /ACTION_CHECK_RE\.test\(instructionText\)\s*&&\s*\n?\s*!침해사고질문인가\(instructionText\)/.test(dispatcherSrc),
      "행동 대조 조건에 `!침해사고질문인가(...)` 배제가 있어야 한다",
    ).toBe(true);
    expect(
      /ACTION_CHECK_RE[\s\S]{0,200}?!장애질문인가\(instructionText\)/.test(dispatcherSrc),
      "장애도 같이 비켜 줘야 한다 — 급한 절차는 코드가 즉답한다",
    ).toBe(true);
  });

  it("★ 「합치는 일은 다음 작업」이라는 약속이 코드에 적혀 있다", () => {
    // 같은 「허락 질문인가」 잣대가 지금 **세 벌**이다(ACTION_CHECK_RE·PERMISSION_ASK_RE·사고중허락물음).
    // 지금 합치면 행동 대조의 그물이 넓어져 **막다른 길(판단 불가)로 더 많이 떨어진다** —
    // 그 길을 여는 것이 「규정 판정 요청함」이고, 합치기는 그때 함께 한다.
    // 이 약속이 사라지면 세 벌이 조용히 굳는다.
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "incidentsteps.ts"), "utf8");
    expect(src, "세 벌이 된 사실과 합칠 시점이 적혀 있어야 한다").toMatch(/두 벌|세 번째/);
    expect(src, "언제 합칠지가 적혀 있어야 한다").toMatch(/규정\s*판정\s*요청함/);
  });
});

// ── 📚 「사례 등록: …」이 장애말에 가로채이던 것 (2026-09-03 gb10 격리 실측) ────────────────
//
// ■ 무엇이 났나
//   침해사고 히스토리에 담당자가 넣는 문장은 **사고 이야기**다 — 「…서버 153대가 **중단**됐다」,
//   「송유관 운영이 **멈춤**」, 「전산이 **다운**」. 그 낱말이 곧 장애말이라, dispatcher가
//   `장애질문인가`에서 먼저 채 가 **장비 장애 초동 절차**를 답으로 냈다.
//   담당자 눈에는 「등록해 달라고 했는데 웬 절차 안내」이고, 등록은 **안 됐다.**
//   격리 실측(gb10) 6문장 중 **5문장**이 그렇게 샜다(안 샌 하나는 장애말이 없던 「새어 나간」).
//
// ■ 왜 여기서 재나
//   `register_incident_case`(FORCED_INTENTS[79])의 정규식만 따로 `.test()`하면 **늘 통과한다** —
//   제품은 강제 규칙 배열에 닿기 **전에** dispatcher의 결정적 판별자들을 먼저 지난다.
//   그래서 이 시험은 ① 앞 층 판별자(장애·침해·화면안내)를 비켜 가는지와
//   ② 제품 함수(forcedToolFor)가 실제로 register_incident_case를 주는지를 **함께** 잰다.
describe("📚 「사례 등록: …」은 장비 장애 초동에 가로채이지 않는다 (전-4 · 2026-09-03)", () => {
  /** 실측으로 샌 여섯 문장 — 화면·screenguide가 약속한 「사례 등록: 제목, 연도, …, 출처 URL」 꼴 그대로. */
  const 등록문장: [string, string][] = [
    ["중단", "사례 등록: 인터넷나야나 랜섬웨어 사고, 2017, 호스팅, 국내, 웹호스팅 서버 153대가 중단됐다, 백업 서버까지 같은 망에 있어 함께 암호화됐다, 교훈: 백업은 망을 갈라 보관한다, 출처 https://www.boannews.com/media/view.asp?idx=45690"],
    ["멈춤", "사례 등록: 콜로니얼 파이프라인 랜섬웨어, 2021, 에너지, 해외, 송유관 운영 멈춤으로 미 동부 연료 공급이 끊겼다, 청구서 시스템 감염만으로 송유를 세웠다, 교훈: 운영망과 사무망을 가른다, 출처 https://example.com/colonial"],
    ["죽었", "사례 등록: 공공기관 디도스 사고, 2022, 공공, 국내, 대외 서비스 서버가 죽었다, 초당 요청이 평소의 300배로 들어왔다, 교훈: 트래픽 상한을 미리 건다, 출처 https://example.com/ddos"],
    ["접속이 안 되던", "사례 등록: 쇼핑몰 디도스 사고, 2023, 유통, 국내, 사흘간 사이트 접속이 안 되던 사고, 결제 창구가 함께 멎었다, 교훈: 우회 경로를 미리 시험한다, 출처 https://example.com/shop"],
    ["다운", "사례 등록: 은행 전산 다운 사고, 2024, 금융, 국내, 인증 서버 장애로 창구 업무가 두 시간 다운됐다, 이중화가 같은 랙에 있었다, 교훈: 이중화는 물리적으로 가른다, 출처 https://example.com/bank"],
    ["새어 나간", "사례 등록: 통신사 고객정보 유출, 2024, 통신, 국내, 가입자 정보가 협력사 계정을 타고 새어 나간 사고, 계정 하나로 전체 조회가 됐다, 교훈: 협력사 계정도 최소권한으로 준다, 출처 https://example.com/telco"],
  ];

  it("★★ 여섯 문장 모두 장애 초동에 안 채인다 — 이것이 그날 샌 자리다", () => {
    for (const [낱말, 문장] of 등록문장) {
      expect(장애질문인가(문장), `「${낱말}」 문장 — 사고 이야기지 우리 장비가 죽은 게 아니다`).toBe(false);
    }
  });

  it("★★ 여섯 문장 모두 침해 초동에도 안 채인다 — 형제 판별자도 같은 문장으로 잰다", () => {
    for (const [낱말, 문장] of 등록문장) {
      expect(침해사고질문인가(문장), `「${낱말}」 문장 — 등록 명령이지 「어떻게 대응하나」가 아니다`).toBe(false);
    }
  });

  it("★★ 여섯 문장 모두 화면 안내(isHelpIntent)에도 안 채인다", async () => {
    const { isHelpIntent } = await import("../src/engine/screenguide");
    for (const [낱말, 문장] of 등록문장) {
      expect(isHelpIntent(문장, "incidentcases.html"), `「${낱말}」 문장 — 쓰는 법을 묻는 게 아니다`).toBe(false);
    }
  });

  it("★★ 여섯 문장 모두 **실제로** register_incident_case에 닿는다 (제품 함수 판정)", async () => {
    const { 실제도착 } = await import("./helpers/routing");
    for (const [낱말, 문장] of 등록문장) {
      expect(실제도착(문장), `「${낱말}」 문장의 도착지`).toBe("register_incident_case");
    }
  });

  it("★ 반례 — 순수 장애 문장은 여전히 초동 절차다 (영토를 뺏지 않았다)", () => {
    for (const q of [
      "방화벽이 멈췄어 어떻게 해",
      "인증 서버가 갑자기 죽었어",
      "IPS 장비가 다운됐는데 뭐부터 봐야 해?",
      "웹서버 접속이 안 돼",
    ]) {
      expect(장애질문인가(q), `${q} — 지금 우리 장비가 멎은 말이다`).toBe(true);
    }
  });

  it("★ 반례 — 「사례 등록하려면 어떻게 해?」(방법 질문)는 등록으로 잡지 않는다", async () => {
    const { 실제도착 } = await import("./helpers/routing");
    // 콜론이 없으면 등록 명령이 아니다 — 화면 안내(screenguide) 몫이라 결재판을 띄우지 않는다.
    expect(실제도착("침해사고 사례 등록하려면 어떻게 해?")).not.toBe("register_incident_case");
  });

  it("★ 사례 삭제(ic-번호)도 장애말에 안 채인다 — 되돌리기가 막히면 등록도 못 믿는다", () => {
    // 「사례 삭제 ic-…」은 등록 답·화면 상세가 되돌리기로 약속한 말이다(FORCED delete_incident_case).
    const 문장 = "사례 삭제 ic-2f9c1a4b7e6d8035 — 서버 다운 건은 잘못 넣었어";
    expect(장애질문인가(문장), "삭제 명령이지 장애 신고가 아니다").toBe(false);
  });
});
