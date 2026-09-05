// 사내 지표율 **주체어 규칙**(게이트) — 낱말 목록이 아니라 **주어**로 잡는다 (2026-09-06 · A1 · 전-4)
//
// ■ 무엇을 푸는가
//   [83]은 지표 **낱말 목록**(조치·제출·참여…)으로 잡는다. 목록에 없는 지표는 그대로 샌다:
//   「우리 회사 정보보호 예산 **집행률**」·「당사 취약점 **평균** 조치 기간」·「우리 자산 등록 **건수**」.
//   목록은 사고가 날 때마다 한 낱말씩 늘려 왔는데 늘리는 쪽이 사고를 못 따라간다.
//   주체어(우리·사내·자사·당사)가 붙은 수치 물음은 **정의상 사내 실적**이라 주어로 잡으면 된다.
//
// ■ 왜 게이트인가 — 넓은 규칙은 남의 답을 삼킨다. 이 파일이 2차 넓힘에서 실제로 겪었고 3차에서
//   되돌렸다(업계 평균 클릭률·국내 백신 설치율 통계가 통째로 kpi_status로 갔다).
//   그래서 기본은 **끈 채로** 두고 운영에서 켜서 재 본 뒤 승격 여부를 사람이 정한다.
//   켜기: 운영 env(gijo-as.env)에 `GIJO_KPI_SUBJECT_RULE=1`.
//
// ■ 이 시험이 지키는 두 가지
//   ① **꺼져 있을 때 한 글자도 안 바뀐다** — routes 표·guidance-check·route-explain이 전부
//      [83]의 정규식을 기준으로 서 있다. 기본 동작이 바뀌면 그 셋이 조용히 어긋난다.
//   ② **켰을 때 잡는 것과 비켜서는 것** — 양성 6 · 음성 8을 문장으로 못 박는다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { forcedToolFor, kpi주체어갈래붙이기 } from "../src/engine/agentloop";

const __dirname = dirname(fileURLToPath(import.meta.url));
const 소스 = readFileSync(join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");

/** 소스에서 FORCED_INTENTS의 `re:` 리터럴을 순서대로 뽑는다(guidance-check와 **같은 방식**). */
function 규칙리터럴들(): { body: string; flags: string }[] {
  const i = 소스.indexOf("const FORCED_INTENTS");
  const 블록 = 소스.slice(i, 소스.indexOf("\n];", i));
  return [...블록.matchAll(/^\s*re:\s*(\/(?:[^/\\\n]|\\.)+\/[gimsuy]*)\s*,\s*$/gm)].map((m) => {
    const lit = m[1];
    const 끝 = lit.lastIndexOf("/");
    return { body: lit.slice(1, 끝), flags: lit.slice(끝 + 1) };
  });
}

// ── 종전 정규식(글자 그대로) ────────────────────────────────────────────────
// ⚠ 베껴 둔 값이다 — **바뀌면 이 시험이 실패해야 한다.** [83]을 손대는 사람은 여기도 함께 보고,
//   routes 표·route-explain 승인된겹침·guidance-check 결과를 다시 재라는 뜻이다.
const 종전 = String.raw`^(?![\s\S]*(?:절차|방법|기준|법령|규정|지침|뜻|정의|소개|설명|뭐야|뭐예요|뭐에요|뭔데|뭔가|무엇|이란|업계|타사|동종|국내|해외|글로벌|일반적|평균적|다른\s*(?:회사|기업|기관|조직)|올리|올려|올릴|높이|높여|높일|줄이|줄여|줄일|낮추|낮춰|낮출|어떻게\s*(?:계산|산출|구하|구해|재|측정|개선|향상)))[\s\S]*(?:(?:조치|완료|준수|대응|이행|패치|적용|이수|등록|제출|참여|응답|설치|가입|서명|서약|열람|클릭|훈련|교육|출석|백업)\s*(?:(?:완료|성공)\s*)?(?:율|률)|SLA\s*준수|(?:작년|전년|올해|전년도)\s*(?:대비|보다))`;

describe("★★ 게이트가 꺼져 있으면 [83]은 한 글자도 안 바뀐다", () => {
  const 리터럴 = 규칙리터럴들();
  const 끝 = 리터럴[리터럴.length - 1];

  it("감시가 헛돌지 않는다 — 규칙 리터럴을 실제로 뽑았다", () => {
    expect(리터럴.length, "소스에서 강제규칙 정규식을 못 읽었다").toBeGreaterThan(80);
  });

  it("[83] 정규식 문자열이 종전과 동일하다", () => {
    expect(끝.body, "기본(off) 정규식이 바뀌었다 — routes 표·guidance-check·겹침 표를 다시 재야 한다").toBe(종전);
    expect(끝.flags).toBe("i");
  });

  // ★★ 이것이 「조립식으로 안 바꾼」 이유다.
  //   tools/guidance-check.mjs의 강제규칙 추출기는 `re: /…/,` **정규식 리터럴만** 읽는다.
  //   `re: KPI_RE,`처럼 식별자를 쓰면 매치가 아예 안 되어 **못 읽은 규칙으로도 안 세고** 조용히
  //   빠진다 — 그 파일이 「조용히 버리면 그 규칙은 검사에서 통째로 빠지는데 도구는 멀쩡하다고
  //   답한다」고 적어 둔 함정이다. 그래서 기본형은 리터럴로 남기고 **켰을 때만** 조립한다.
  it("[83]은 조립식이 아니라 **정규식 리터럴**로 남아 있다 — 소스를 읽는 감시가 계속 본다", () => {
    const i = 소스.indexOf("const FORCED_INTENTS");
    const 블록 = 소스.slice(i, 소스.indexOf("\n];", i));
    expect(블록, "배열 안에서 정규식을 조립하면 guidance-check가 그 규칙을 통째로 못 읽는다")
      .not.toMatch(/^\s*re:\s*(?!\/)[A-Za-z_$]/m);
  });

  it("기본에서는 주체어만으로 안 잡는다 — 게이트가 정말 꺼져 있다", () => {
    // ⚠ 시험 환경에 env가 없으므로 이 파일이 재는 것은 **꺼진 제품**이다.
    expect(forcedToolFor("우리 회사 정보보호 예산 집행률")?.tool).not.toBe("kpi_status");
    expect(forcedToolFor("우리 자산 등록 건수")?.tool).not.toBe("kpi_status");
    // 낱말 목록으로 잡히던 것은 게이트와 무관하게 그대로 잡힌다.
    expect(forcedToolFor("사내 MFA 적용률")?.tool).toBe("kpi_status");
  });
});

describe("★ 게이트를 켜면 — 주체어 갈래", () => {
  // 켠 정규식은 제품이 쓰는 **바로 그 함수**로 만든다(사본을 두면 시험만 초록이 된다).
  const 켠것 = kpi주체어갈래붙이기(new RegExp(종전, "i"));

  it("조립이 실제로 넓혔다 — 안 넓혔으면 아래 판정이 전부 헛돈다", () => {
    expect(켠것.source.length, "갈래가 안 붙었다").toBeGreaterThan(종전.length);
    expect(켠것.source.startsWith(종전.slice(0, -1)), "기본형을 그대로 물려받지 않았다").toBe(true);
    expect(켠것.flags).toBe("i");
  });

  it("모양이 달라지면 아무것도 안 한다 — 틀린 정규식을 조용히 조립하지 않는다", () => {
    const 딴것 = /사내\s*지표/;
    expect(kpi주체어갈래붙이기(딴것)).toBe(딴것);
  });

  // ── 양성 6 — 낱말 목록에 없던 사내 수치 물음 ───────────────────────────────
  const 양성: [string, string][] = [
    ["우리 회사 정보보호 예산 집행률", "「집행률」은 낱말 목록에 없다 — 주어로만 잡힌다"],
    ["사내 MFA 적용률", "낱말(적용률)로도 잡히던 것 — 켜도 그대로 잡혀야 한다"],
    ["당사 취약점 평균 조치 기간", "「평균」 — 율/률이 아예 없는 사내 수치 물음"],
    ["우리 자산 등록 건수", "「건수」 — 세는 값인데 낱말 목록은 율/률만 본다"],
    ["사내 백업 성공률", "낱말(백업+성공+률)로도 잡히던 것"],
    ["자사 교육 참여율", "낱말(참여율)로도 잡히던 것"],
  ];
  for (const [말, 왜] of 양성) {
    it(`「${말}」 → 잡힌다 (${왜})`, () => {
      expect(켠것.test(말)).toBe(true);
    });
  }

  // ── 음성 8 — 켜도 비켜서야 하는 말 ────────────────────────────────────────
  const 음성: [string, string][] = [
    ["우리 회사 보안 규정 알려줘", "「규정」 배제 — 지식·법령의 영토(배제어를 그대로 물려받는다)"],
    ["사내 절차", "「절차」 배제 — 플레이북의 영토"],
    ["업계 평균 클릭률", "「업계」 배제 — 남의 통계다(3차 되돌림에서 넣은 배제어)"],
    // ⚠ 어느 쪽이 맞나 — **음성이 맞다**. 근거 둘:
    //   ① 「타사」는 3차 되돌림에서 넣은 배제어다. 남을 가리키는 말이 있으면 사내 표가 아니라
    //      문서·지식이 답해야 한다(그 값은 실제로 문서에 있다 — 없는 척하면 있는 답을 죽인다).
    //   ② 애초에 「점수」에는 율·률·비율·평균·건수가 없어 주체어 갈래도 안 문다.
    //   두 이유가 각각 독립으로 성립하므로 어느 하나가 바뀌어도 판정은 그대로다.
    ["타사 대비 우리 점수", "「타사」 배제 + 수치 낱말 자체가 없다"],
    ["우리 회사 이름이 뭐야", "「뭐야」 배제 — 뜻풀이·사실 물음이지 지표가 아니다"],
    // ⚠ 문서 **건수**는 도구가 세는 값이다(문서함·최근 문서). kpi_status의 사내 표에는 없어
    //   여기로 오면 「아직 집계하지 않습니다」가 나간다 — 있는 답을 없다고 하는 쪽이다.
    //   「몇 건」은 「건수」가 아니라 안 걸린다(갈래가 요구하는 글자는 율/률/비율/평균/건수).
    ["사내 문서 몇 건 등록됐어", "문서 수는 도구가 세는 값 — 강제로 채 가면 안 된다"],
    // ⚠ 이 파일이 이미 정한 계약이다: 탐지·차단·검출은 **제품 스펙** 물음이라 지식의 영토다.
    //   주어만 보면 걸리므로 주체어 갈래 **안에서** 따로 막는다(배제어에 넣으면 꺼진 기본형까지
    //   글자가 바뀐다 — 위 「한 글자도 안 바뀐다」와 충돌한다).
    ["우리 IPS 탐지율", "탐지·차단·검출은 사내 실적이 아니라 제품 스펙"],
    ["사내 규정 준수 기준", "「규정」·「기준」 배제 — 기준을 묻는 말은 지식의 영토"],
  ];
  for (const [말, 왜] of 음성) {
    it(`「${말}」 → 안 잡힌다 (${왜})`, () => {
      expect(켠것.test(말)).toBe(false);
    });
  }

  it("같은 계보의 형제도 함께 막힌다 — 「우리 WAF 차단율」·「사내 EDR 검출률」", () => {
    expect(켠것.test("우리 WAF 차단율")).toBe(false);
    expect(켠것.test("사내 EDR 검출률")).toBe(false);
  });
});

// ★ 배선까지 본다 — 함수가 맞아도 **env가 배열에 안 꽂히면** 운영에서 안 켜진다.
//   (이 저장소의 반복 실패: 부품은 맞는데 부르는 자리가 없다.)
describe("★★ env를 켜면 제품 경로(forcedToolFor)가 실제로 달라진다", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("GIJO_KPI_SUBJECT_RULE=1 이면 「우리 회사 정보보호 예산 집행률」이 kpi_status로 간다", async () => {
    vi.stubEnv("GIJO_KPI_SUBJECT_RULE", "1");
    const m = await import("../src/engine/agentloop");
    expect(m.forcedToolFor("우리 회사 정보보호 예산 집행률")?.tool).toBe("kpi_status");
    expect(m.forcedToolFor("우리 자산 등록 건수")?.tool).toBe("kpi_status");
    // 켜도 비켜설 것은 비켜선다.
    expect(m.forcedToolFor("우리 IPS 탐지율")?.tool).not.toBe("kpi_status");
    expect(m.forcedToolFor("업계 평균 클릭률")?.tool).not.toBe("kpi_status");
  });

  it("값이 1이 아니면 안 켜진다 — 실수로 켜지지 않게", async () => {
    vi.stubEnv("GIJO_KPI_SUBJECT_RULE", "true");
    const m = await import("../src/engine/agentloop");
    expect(m.forcedToolFor("우리 회사 정보보호 예산 집행률")?.tool).not.toBe("kpi_status");
  });
});
