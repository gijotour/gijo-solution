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
    // ⚠ `match`는 첫 매치를 준다 — 그대로 쓰면 **파일 앞쪽의 남의 규칙**을 잡는다
    //   (이 시험을 처음 쓸 때 그래서 멀쩡한 정규식이 틀린 것처럼 나왔다).
    //   register_asset **바로 앞**의 것을 써야 하므로 전부 모아 마지막을 쓴다.
    const 앞 = src.slice(0, i);
    const 전부 = [...앞.matchAll(/re:\s*(\/(?:[^/\\\n]|\\.)+\/[a-z]*),\s*$/gm)];
    if (!전부.length) throw new Error("register_asset 앞의 re: 정규식을 못 읽었습니다");
    const 리터럴 = 전부[전부.length - 1][1];
    const body = 리터럴.slice(1, 리터럴.lastIndexOf("/"));
    return new RegExp(body, 리터럴.slice(리터럴.lastIndexOf("/") + 1));
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

  it("★ dispatcher가 실제로 이 갈래를 부른다 — 만들어 두고 안 부르면 없는 것과 같다", () => {
    expect(/const 방법화면 = 방법질문화면찾기\(instructionText\);/.test(dispatcherSrc)).toBe(true);
    // isHelpIntent보다 앞이어야 한다(다른 화면 이름을 대고 물을 때 엉뚱한 안내를 막는다).
    expect(dispatcherSrc.indexOf("방법질문화면찾기(instructionText)")).toBeLessThan(
      dispatcherSrc.indexOf("isHelpIntent(instructionText, screen)"),
    );
  });
});
