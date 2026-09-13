// server/test/opssimprofile.test.ts — 야간 회귀 프로필·의존 표식·건너뜀 판정(tools/opssim-profile.mjs)
//
// ■ 왜 (2026-09-12 · ② 설계관 지시서 · 사장님 「추천으로진행」 확정안)
//   205문항을 4000(운영)·4100(고객 QA 인스턴스)에 돌려 보니 도구가 갈리는 자리가 있었고,
//   실체는 데이터 유무(업무·씨앗문서)와 설정 유무(법령·CTI)였다. tools/opssim-profile.mjs가
//   그 표식·프로필·건너뜀 판정·집계를 한 곳에 모은다 — 이 시험이 그 함수들을 직접 문다
//   (ops-sim.mjs 자체는 불러들이는 순간 하네스를 돌려 시험이 못 부른다 — 형제 파일들과 같은 이유).
//
// ■ 이 시험이 재는 것 (설계관 지시서 tests 항목 그대로)
//   ① 표식이 달린 물음이 마당에 실제로 있는가 — 표식표도 기대표처럼 썩을 수 있다.
//   ② 프로필별 건너뜀 수가 기대와 같은가.
//   ③ 건너뜀 줄이 「불편 없음」 분자에 안 들어가는가 — 이것이 이 기제의 유일한 거짓말 자리다.
//   ④ 두 마당에 같은 물음이 있는 경우(205행 중 204 유니크) 표식이 양쪽에 같이 걸리는가.
//   덧붙여: 계약부분집합() = 205 − 표식 수, 설정감지()의 세 상태(켜짐·꺼짐·모름), 영발화보고().
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  표식표, 프로필들, 프로필가져오기, 건너뜀사유, 계약부분집합, 집계, 설정감지, 영발화보고, 영발화대상,
} from "../../tools/opssim-profile.mjs";
import { 팀원문항 } from "../../tools/opssim-team.mjs";

const 루트 = path.join(__dirname, "..", "..");
const 하네스소스 = fs.readFileSync(path.join(루트, "tools", "ops-sim.mjs"), "utf8");

/**
 * ops-sim.mjs의 정적 마당(①~⑱·⑪) 물음을 소스에서 그대로 뽑는다(domainsense.test의 ⑯ 추출과
 * 같은 기법을 전체 마당으로 넓힌 것) — ops-sim.mjs를 **불러들이지 않는다**(하네스가 돈다).
 * ⚠ 각 마당은 `물음: [ "...", "..." ]},` 꼴로 끝난다(마당 배열의 마지막 항목 ⑲만 예외 —
 *   `팀원문항.map(...)`으로 동적이라 이 정규식엔 안 걸린다. 그래서 ⑲는 opssim-team.mjs에서
 *   직접 가져와 더한다).
 */
function 정적마당물음(): string[] {
  const re = /물음:\s*\[([\s\S]*?)\]\s*\},/g;
  const 전부: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(하네스소스))) {
    const 조각 = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
    전부.push(...조각);
  }
  return 전부;
}

/** 마당 205행(중복 포함) — ops-sim.mjs가 `문항` 배열을 만드는 것과 같은 재료. */
const 마당물음전체 = [...정적마당물음(), ...팀원문항.map((행) => 행.q)];
const 마당물음집합 = new Set(마당물음전체);

describe("★ opssim-profile — 표식표가 실제로 마당을 가리키는가", () => {
  it("정적 마당 추출이 하네스 소스와 어긋나지 않는다 — 205행·204 유니크·중복 하나", () => {
    // 이 숫자 자체가 설계관 지시서의 실측(4000 야간 205/205)과 같다 — 추출 함수가 옳다는 증거.
    expect(마당물음전체.length, "총 문항 수가 205가 아니다 — 마당이 늘었거나 추출 정규식이 깨졌다").toBe(205);
    expect(마당물음집합.size, "유니크 문항 수가 204가 아니다").toBe(204);
    const 중복 = 마당물음전체.filter((q, i) => 마당물음전체.indexOf(q) !== i);
    expect(중복, "겹치는 물음이 「AI가 아낀 시간 얼마야?」 하나가 아니다 — 마당이 바뀌었다").toEqual(["AI가 아낀 시간 얼마야?"]);
  });

  it("① 표식표의 모든 문항이 마당에 실제로 있다 — 없으면 그 표식은 영영 안 걸린다", () => {
    const 죽은표식 = Object.keys(표식표).filter((k) => !마당물음집합.has(k));
    expect(죽은표식, `마당에 없는 표식: ${JSON.stringify(죽은표식)}`).toEqual([]);
  });

  it("표식표에 최소 15개(data_items 9 + config_items 5 + unsure 1)가 적혀 있다", () => {
    // ★ 2026-09-13 SLA/라우팅 라운드 ⑤ — data_items가 10→9로 줄었다(「10.0.0.100 에 뭐가
    //   있어?」는 4100에서도 「자산」 갈래로 통과해 데이터 의존이 아니었다). 16→15.
    expect(Object.keys(표식표).length).toBeGreaterThanOrEqual(15);
  });

  it("④ 두 마당(⑧·⑭)에 같은 물음 「AI가 아낀 시간 얼마야?」가 있다 — 지금은 표식이 없어 계약(잰다)에 남는다", () => {
    const 겹치는물음 = "AI가 아낀 시간 얼마야?";
    expect(마당물음전체.filter((q) => q === 겹치는물음).length, "중복이 사라졌거나 늘었다 — 마당 구성이 바뀌었다").toBe(2);
    expect(표식표[겹치는물음], "중복 문항에 표식이 생겼다 — 아래 판정이 두 마당 모두에 걸리는지 다시 확인할 것").toBeUndefined();
    expect(계약부분집합([겹치는물음, 겹치는물음])).toEqual([겹치는물음, 겹치는물음]);
  });

  it("④ 건너뜀사유는 물음 문자열 하나만 열쇠로 쓴다 — 어느 마당에서 왔는지는 안 본다(같은 물음=같은 판정)", () => {
    // ops-sim.mjs의 실행 고리는 대상.map(c => 건너뜀사유(c.q, ...))처럼 c.q만 넘긴다(c.마당은 안 넘긴다).
    // 그래서 같은 물음이 두 마당에 있어도 판정은 항상 같다 — 실제 표식 문항(설정:법령) 하나로 확인한다.
    // ★ 2026-09-13 SLA/라우팅 라운드 ⑤ — 예전엔 여기서 「10.0.0.100 에 뭐가 있어?」(데이터:업무)를
    //   썼는데, 그 표식을 뺐으므로(4100에서도 자산 갈래로 통과 — 데이터 의존이 아니었다) 다른
    //   실재 표식 문항으로 바꾼다.
    const q = "개인정보 보호법 제29조 알려줘"; // 표식표에 실재하는 문항(설정:법령) — 다른 「가상의 마당」에서 왔다고 가정해도
    const qa4100 = 프로필가져오기("qa4100");
    const 감지 = { 법령: false, CTI: true };
    const 첫번째마당에서온호출 = 건너뜀사유(q, qa4100, 감지);
    const 두번째마당에서온호출 = 건너뜀사유(q, qa4100, 감지); // 마당 정보를 아예 안 받으므로 결과는 항상 같다
    expect(첫번째마당에서온호출).toBe("설정:법령");
    expect(두번째마당에서온호출).toBe(첫번째마당에서온호출);
  });
});

describe("★ 프로필가져오기 — 이름 없음(기본 4000)·qa4100·모르는 이름", () => {
  it("이름이 비면 null(데이터 의존을 아무것도 안 거른다)", () => {
    expect(프로필가져오기("")).toBeNull();
    expect(프로필가져오기(undefined as unknown as string)).toBeNull();
  });

  it("qa4100 — 업무데이터 없음 · 씨앗문서 있음", () => {
    const p = 프로필가져오기("qa4100");
    expect(p).toEqual(프로필들.qa4100);
    expect(p!.업무데이터).toBe(false);
    expect(p!.씨앗문서).toBe(true);
  });

  it("모르는 이름은 예외를 던진다 — 오타를 조용히 삼키지 않는다", () => {
    expect(() => 프로필가져오기("존재안함")).toThrow(/없는 프로필/);
  });
});

describe("★ 건너뜀사유 — 프로필별 건너뜀 수가 기대와 같다", () => {
  const 켜짐 = { 법령: true, CTI: true };
  const 꺼짐 = { 법령: false, CTI: true };
  const 모름 = { 법령: null, CTI: null };
  const qa4100 = 프로필가져오기("qa4100");

  const 의존별목록 = (의존: string) =>
    Object.entries(표식표).filter(([, v]) => v.의존.includes(의존)).map(([k]) => k);
  const 업무목록 = 의존별목록("데이터:업무");
  const 씨앗목록 = 의존별목록("데이터:씨앗문서");
  const 법령목록 = 의존별목록("설정:법령");
  // ★ 2026-09-12 검토관 적발 수리 — 「표식이 붙었다」와 「건너뛴다」는 다른 말이다.
  //   기대가 데이터와 무관한 계약(도구 도착·금지)뿐인 문항은 `가리지않음`으로 **계속 잰다**.
  const 가리는업무 = 업무목록.filter((q) => !(표식표 as any)[q].가리지않음);
  const 안가리는업무 = 업무목록.filter((q) => (표식표 as any)[q].가리지않음);

  it("업무 2 · 씨앗문서 8(7+unsure 1) · 법령 5 — 표식표 구성이 실측값과 같다", () => {
    // ★ 2026-09-13 SLA/라우팅 라운드 ⑤ — 업무가 3→2(「10.0.0.100 에 뭐가 있어?」를 뺐다.
    //   4100에서도 「자산」 갈래로 통과해 데이터 의존이 아니었다).
    expect(업무목록.length).toBe(2);
    expect(씨앗목록.length).toBe(8);
    expect(법령목록.length).toBe(5);
    expect(업무목록.length + 씨앗목록.length + 법령목록.length).toBe(Object.keys(표식표).length);
  });

  it("★ 데이터와 무관한 계약만 남은 두 문항은 `가리지않음`이다 — 건너뛰면 그 계약이 함께 걷힌다", () => {
    // 「경영진 보고용…」=도구 exec_brief 도착 · 「sample-web01…」=금지 /근거 약함/ — 둘 다 업무
    // 데이터 유무와 무관하다. 4100에서 ⏭로만 찍히면 라우팅이 끊겨도 영영 못 본다(검토관 적발).
    expect(안가리는업무.sort()).toEqual(["sample-web01 취약점만 보여줘", "경영진 보고용으로 짧게 요약해줘"].sort());
    for (const q of 안가리는업무) {
      expect(typeof (표식표 as any)[q].가리지않음, `"${q}"에 왜 안 가리는지가 안 적혀 있다`).toBe("string");
      expect((표식표 as any)[q].가리지않음.length).toBeGreaterThan(20);
    }
    // 분류(③ 내장판 부분집합)는 그대로 — 가리지 않아도 「의존이 있는 문항」이다.
    for (const q of 안가리는업무) expect(계약부분집합([q])).toEqual([]);
  });

  it("기본(프로필 없음) + 법령 켜짐 — 아무것도 안 거른다", () => {
    for (const q of [...업무목록, ...씨앗목록, ...법령목록]) {
      expect(건너뜀사유(q, null, 켜짐), `"${q}"가 건너뛰어졌다`).toBeNull();
    }
  });

  it("기본(프로필 없음) + 법령 꺼짐 — 설정:법령 다섯만 건너뛴다(꺼진 기계용 안전망은 이름 없는 4000도 지킨다)", () => {
    for (const q of 법령목록) expect(건너뜀사유(q, null, 꺼짐)).toBe("설정:법령");
    for (const q of [...업무목록, ...씨앗목록]) expect(건너뜀사유(q, null, 꺼짐)).toBeNull();
  });

  // ★ 2026-09-13 SLA/라우팅 라운드 ⑤ — 「10.0.0.100 에 뭐가 있어?」(유일하게 가리던 업무 표식)를
  //   뺐으므로 이제 업무 표식 둘 다 `가리지않음`이라 qa4100에서도 아무것도 안 건너뛴다.
  it("qa4100 + 법령 켜짐 — 업무 표식 둘 다 가리지않음이라 아무것도 안 건너뛴다(씨앗문서 여덟도 계속 잰다 — B8·exec_brief 같은 결함을 안 가린다)", () => {
    expect(가리는업무.length, "가리는 업무 표식이 없어야 한다 — 「10.0.0.100…」을 뺐다").toBe(0);
    for (const q of [...업무목록, ...씨앗목록, ...법령목록]) {
      expect(건너뜀사유(q, qa4100, 켜짐), `"${q}"가 부당하게 건너뛰어졌다`).toBeNull();
    }
  });

  it("qa4100 + 법령 꺼짐 — 가리는 업무 0 + 법령 5 = 5건 건너뜀, 씨앗문서 8·업무 전체는 그대로 잰다", () => {
    const 건너뜀개수 = [...업무목록, ...씨앗목록, ...법령목록].filter((q) => 건너뜀사유(q, qa4100, 꺼짐)).length;
    expect(건너뜀개수, "10.0.0.100 표식을 뺀 뒤로는 6이 아니라 5다").toBe(5);
    for (const q of [...씨앗목록, ...업무목록]) expect(건너뜀사유(q, qa4100, 꺼짐)).toBeNull();
  });

  it("★ `가리지않음`은 **데이터 갈래에만** 든다 — 설정 의존(도구가 목록에서 빠지는 자리)은 그대로 건너뛴다", () => {
    // 설정 꺼짐은 도구 자체가 registry에서 빠져 원리상 못 맞히므로, 이 깃발이 그쪽을 열어 주면 안 된다.
    const 가짜표 = { 의존: ["설정:법령", "데이터:업무"], 왜: "시험용", 가리지않음: "데이터 갈래만 면제한다는 계약을 문는 자리" };
    const 원래 = (표식표 as any)["장비 로그 보관 기간 알려줘"];
    (표식표 as any)["장비 로그 보관 기간 알려줘"] = 가짜표;
    try {
      expect(건너뜀사유("장비 로그 보관 기간 알려줘", qa4100, 꺼짐)).toBe("설정:법령");
      expect(건너뜀사유("장비 로그 보관 기간 알려줘", qa4100, 켜짐)).toBeNull();
    } finally {
      (표식표 as any)["장비 로그 보관 기간 알려줘"] = 원래;
    }
  });

  it("설정을 못 읽었으면(모름=null) 「꺼짐」으로 단정하지 않는다 — 멀쩡한 문항을 안 건너뛴다", () => {
    for (const q of 법령목록) expect(건너뜀사유(q, qa4100, 모름)).toBeNull();
  });

  it("표식이 없는 문항은 어떤 프로필·설정에서도 건너뛰지 않는다", () => {
    expect(건너뜀사유("우리 자산 몇 대야?", qa4100, 꺼짐)).toBeNull();
  });
});

describe("★ 계약부분집합 — 205 − 표식 수", () => {
  it("의존 표식이 하나도 없는 문항만 남는다", () => {
    const 부분집합 = 계약부분집합(마당물음전체);
    expect(부분집합.length).toBe(205 - Object.keys(표식표).length);
    for (const q of 부분집합) expect(표식표[q]).toBeUndefined();
  });

  it("문자열 배열과 {q} 객체 배열을 똑같이 받는다", () => {
    // ★ 2026-09-13 SLA/라우팅 라운드 ⑤ — 예전엔 「10.0.0.100 에 뭐가 있어?」(데이터:업무)를
    //   표식 있는 예시로 썼는데, 그 표식을 뺐으므로(4100에서도 자산 갈래로 통과) 다른 실재
    //   표식 문항으로 바꾼다.
    const 문자열형 = 계약부분집합(["sample-web01 취약점만 보여줘", "우리 자산 몇 대야?"]);
    const 객체형 = 계약부분집합([{ q: "sample-web01 취약점만 보여줘" }, { q: "우리 자산 몇 대야?" }]);
    expect(문자열형).toEqual(["우리 자산 몇 대야?"]);
    expect(객체형.map((x: any) => x.q)).toEqual(["우리 자산 몇 대야?"]);
  });
});

describe("★★ 집계 — ③ 건너뜀 줄이 「불편 없음」 분자에 안 들어간다(이 기제의 유일한 거짓말 자리)", () => {
  it("잰결과·불편건이 건너뜀 행을 뺀다", () => {
    const 결과 = [
      { 마당: "①", q: "a", 불편: [] },
      { 마당: "①", q: "b", 불편: [{ 종류: "내용이 다름", 상세: "x" }] },
      { 마당: "①", q: "c", 건너뜀: "데이터:업무", out: "" },
      { 마당: "②", q: "d", 건너뜀: "설정:법령", out: "" },
    ];
    const { 건너뜀행, 잰결과, 불편건, 건너뜀사유별, 마당별 } = 집계(결과);
    expect(건너뜀행.length).toBe(2);
    expect(잰결과.length).toBe(2);
    expect(불편건.length, "건너뛴 줄이 불편으로 잘못 세어졌다").toBe(1);
    expect(건너뜀사유별).toEqual({ "데이터:업무": 1, "설정:법령": 1 });
    expect(마당별["①"]).toEqual({ 전체: 3, 불편: 1, 건너뜀: 1 });
    expect(마당별["②"]).toEqual({ 전체: 1, 불편: 0, 건너뜀: 1 });
  });

  it("빈 결과·건너뜀 0건도 안전하다", () => {
    expect(집계([]).마당별).toEqual({});
    const { 건너뜀행, 잰결과 } = 집계([{ 마당: "①", q: "a", 불편: [] }]);
    expect(건너뜀행).toEqual([]);
    expect(잰결과.length).toBe(1);
  });
});

describe("★ 설정감지 — 켜짐·꺼짐·모름(못 읽음)을 가른다", () => {
  const 가짜fetch = (법령응답: any, cti응답: any) => async (url: string) => {
    if (url.endsWith("/api/law/config")) return 법령응답;
    if (url.endsWith("/api/cti/feeds")) return cti응답;
    throw new Error("모르는 URL: " + url);
  };

  it("둘 다 켜짐", async () => {
    const 결과 = await 설정감지(
      "http://x", "Bearer t",
      가짜fetch({ ok: true, json: async () => ({ enabled: true }) }, { ok: true, json: async () => [{ connected: true }] })
    );
    expect(결과).toEqual({ 법령: true, CTI: true });
  });

  it("법령 꺼짐 · CTI 피드 전부 미연결", async () => {
    const 결과 = await 설정감지(
      "http://x", "Bearer t",
      가짜fetch({ ok: true, json: async () => ({ enabled: false }) }, { ok: true, json: async () => [{ connected: false }, { connected: false }] })
    );
    expect(결과).toEqual({ 법령: false, CTI: false });
  });

  it("HTTP 실패·예외는 null(모름)로 떨어진다 — 「꺼짐」으로 단정하지 않는다", async () => {
    const 결과 = await 설정감지(
      "http://x", "Bearer t",
      async () => { throw new Error("network down"); }
    );
    expect(결과).toEqual({ 법령: null, CTI: null });
  });

  it("HTTP는 ok지만 200이 아니면 null", async () => {
    const 결과 = await 설정감지(
      "http://x", "Bearer t",
      가짜fetch({ ok: false, status: 500 }, { ok: false, status: 500 })
    );
    expect(결과).toEqual({ 법령: null, CTI: null });
  });
});

describe("★ 영발화보고 — 문항은 재고 있지만 잣대가 이 회차에 발화할 재료가 없었다", () => {
  const 사내문답문항 = 영발화대상["사내문답과반금지(⑰ⓐ)"].문항;
  const EPSS문항 = 영발화대상["EPSS범위밖금지"].문항;

  it("승인 문답 근거가 2건 미만이면 ⓐ가 0건 발화로 보고된다 — 숫자는 **잰 값**이다(문항 수가 아니다)", () => {
    const 결과 = 사내문답문항.map((q) => ({ q, out: "연 1회", sources: ["승인문답:1"], 불편: [] }));
    const 줄 = 영발화보고(결과);
    const 사내문답줄 = 줄.find((s) => s.includes("사내문답과반금지"))!;
    expect(사내문답줄).toBeDefined();
    // 가장 많이 실린 답도 1건 — 그 1이 찍혀야 한다.
    expect(사내문답줄, "잰 값(최대 1건)이 아니라 딴 숫자가 찍혔다").toContain("최대 1건 < 2");
    // ★★ 2026-09-12 검토관 적발(상) — 여기에 **문항 수**가 찍혀 「근거 답 5건 < 2」라는 자기모순
    //   숫자가 매일 밤 사람이 읽는 자리에 나갔다. 문항 수는 「잰 N문항」 자리에서만 쓴다.
    expect(사내문답줄).toContain(`잰 ${사내문답문항.length}문항`);
    expect(사내문답줄, "문항 수가 잰 값 자리에 다시 찍혔다 — 옛 거짓 문구가 되살아났다")
      .not.toContain(`최대 ${사내문답문항.length}건`);
  });

  it("잰 값이 1이 아니라 0이면 0이 찍힌다 — 숫자가 행 수를 따라가지 않는다", () => {
    const 결과 = 사내문답문항.map((q) => ({ q, out: "연 1회", sources: ["지식:법령"], 불편: [] }));
    const 사내문답줄 = 영발화보고(결과).find((s) => s.includes("사내문답과반금지"))!;
    expect(사내문답줄).toContain("최대 0건 < 2");
  });

  it("승인 문답 근거가 2건 이상인 행이 하나라도 있으면 발화한 것이다 — 보고에 안 나온다", () => {
    const 결과 = 사내문답문항.map((q, i) => ({
      q, out: "연 1회", sources: i === 0 ? ["승인문답:1", "승인문답:2"] : [], 불편: [],
    }));
    expect(영발화보고(결과).some((s) => s.includes("사내문답과반금지"))).toBe(false);
  });

  it("EPSS가 답에 한 번도 안 실리면 EPSS범위밖금지가 0건 발화(취약점 0건 기계) — 「실린 답 0건」이라 적는다", () => {
    const 결과 = EPSS문항.map((q) => ({ q, out: "지금은 급한 게 없습니다", 불편: [] }));
    const 줄 = 영발화보고(결과).find((s) => s.includes("EPSS범위밖금지"))!;
    expect(줄).toBeDefined();
    expect(줄, "「EPSS가 실린 답 4건인데 볼 글자가 없다」는 자기모순이 다시 찍혔다").toContain("EPSS가 실린 답 0건");
    expect(줄).toContain(`잰 ${EPSS문항.length}문항`);
  });

  it("EPSS가 실린 답이 하나라도 있으면 발화한 것이다", () => {
    const 결과 = EPSS문항.map((q, i) => ({ q, out: i === 0 ? "EPSS 92%입니다" : "괜찮습니다", 불편: [] }));
    expect(영발화보고(결과).some((s) => s.includes("EPSS범위밖금지"))).toBe(false);
  });

  it("그 문항 자체를 안 물은 회차(--only 등)는 조용히 지나간다 — 적을 것이 없다", () => {
    expect(영발화보고([{ q: "전혀 다른 물음", out: "답", 불편: [] }])).toEqual([]);
    expect(영발화보고([])).toEqual([]);
  });

  it("건너뛴 행은 재료로 안 쓴다(잰 것만 본다)", () => {
    const 결과 = 사내문답문항.map((q) => ({ q, out: "", 건너뜀: "설정:법령" }));
    // 전부 건너뛰었으니 「그 문항 자체를 안 물었다」와 같은 결과 — 보고할 것이 없다.
    expect(영발화보고(결과).some((s) => s.includes("사내문답과반금지"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 2026-09-12 검토관 적발 수리 — 영발화대상은 **기대표의 두 번째 사본**이다
//
// 그 표의 문항 목록은 ops-sim.mjs 기대표에서 `사내문답과반금지: true`·`금지: [EPSS범위밖_RE]`가
// 걸린 문항을 **손으로 옮겨 적은 것**이라, 물음이 한 글자 바뀌거나 플래그가 다른 문항으로 옮겨
// 가면 대상행이 0이 되어 영발화보고()가 **조용히 침묵**한다 — 보고서엔 아무 줄도 안 나오고,
// 읽는 사람은 「잣대가 발화했다」로 읽는다(확정안 ④가 통째로 무효가 되는데 아무도 모른다).
// 그래서 ⓐ 마당 실재 ⓑ 기대표 플래그 일치 ⓒ 하네스 자기점검 포함을 여기서 못박는다.
describe("★★ 영발화대상 — 기대표·마당과 어긋나면 조용히 침묵한다", () => {
  /** 기대표에서 그 물음 한 항목의 소스 글자만 잘라 낸다(항목은 2칸 들여쓴 `"물음": {` 로 시작한다). */
  function 기대표항목(q: string): string {
    const 머리 = "\n  " + JSON.stringify(q) + ": {";   // 기대표 항목은 2칸 들여쓴 `"물음": {`
    const 시작 = 하네스소스.indexOf(머리);
    if (시작 === -1) return "";
    const 끝 = 하네스소스.indexOf("\n  \"", 시작 + 4);   // 다음 항목이 시작하는 자리
    return 끝 === -1 ? 하네스소스.slice(시작) : 하네스소스.slice(시작, 끝);
  }

  it("① 영발화대상의 모든 문항이 마당에 실제로 있다 — 없으면 그 잣대는 영영 침묵한다", () => {
    const 죽은문항 = Object.values(영발화대상)
      .flatMap((d: any) => d.문항)
      .filter((q: string) => !마당물음집합.has(q));
    expect(죽은문항, `마당에 없는 영발화 문항: ${JSON.stringify(죽은문항)}`).toEqual([]);
  });

  it("② ⓐ 목록 = 기대표에서 `사내문답과반금지: true`가 걸린 문항과 정확히 같다", () => {
    const 문항 = 영발화대상["사내문답과반금지(⑰ⓐ)"].문항;
    // 갯수 — 기대표에 그 플래그가 몇 번 적혀 있나(손으로 옮긴 목록이 모자라거나 남지 않는지).
    const 플래그수 = (하네스소스.match(/사내문답과반금지:\s*true/g) ?? []).length;
    expect(플래그수, "기대표의 ⓐ 플래그 수와 영발화대상 문항 수가 어긋났다").toBe(문항.length);
    // 짝 — 목록의 문항이 **저마다** 그 플래그를 실제로 달고 있나.
    for (const q of 문항) {
      expect(기대표항목(q), `"${q}" 기대표 항목을 못 찾았다`).not.toBe("");
      expect(기대표항목(q), `"${q}"에 사내문답과반금지 플래그가 없다 — 목록이 낡았다`).toMatch(/사내문답과반금지:\s*true/);
    }
  });

  it("③ EPSS 목록 = 기대표에서 금지 칸에 EPSS범위밖_RE가 걸린 문항과 정확히 같다", () => {
    const 문항 = 영발화대상["EPSS범위밖금지"].문항;
    const 걸린수 = (하네스소스.match(/금지:\s*\[[^\]]*EPSS범위밖_RE/g) ?? []).length;
    expect(걸린수, "기대표의 EPSS 금지 수와 영발화대상 문항 수가 어긋났다").toBe(문항.length);
    for (const q of 문항) {
      expect(기대표항목(q), `"${q}" 기대표 항목을 못 찾았다`).not.toBe("");
      expect(기대표항목(q), `"${q}"에 EPSS범위밖_RE 금지가 없다 — 목록이 낡았다`).toContain("EPSS범위밖_RE");
    }
  });

  it("④ 하네스의 「죽은 표식」 자기점검이 영발화대상도 본다 — 표식표만 보면 이 표가 조용히 썩는다", () => {
    expect(하네스소스, "ops-sim.mjs가 영발화대상을 가져오지 않는다").toContain("영발화대상,");
    const 시작 = 하네스소스.indexOf("const 죽은표식");
    expect(시작, "죽은 표식 자기점검 자리를 못 찾았다").toBeGreaterThan(0);
    // 자기점검 대목(후보를 모으는 줄들 + 죽은표식 계산)을 넉넉히 잘라 본다.
    const 자기점검 = 하네스소스.slice(Math.max(0, 시작 - 900), 시작 + 400);
    expect(자기점검, "죽은 표식 자기점검이 영발화대상 문항을 안 본다 — 물음이 바뀌면 조용히 침묵한다")
      .toContain("영발화대상");
  });

  it("⑤ 「승인문답:」 접두를 여기서 다시 적지 않는다 — 잣대는 opssim-rules 한 곳", () => {
    const 프로필소스 = fs.readFileSync(path.join(루트, "tools", "opssim-profile.mjs"), "utf8");
    expect(프로필소스, "접두를 import하지 않는다").toContain("승인문답_접두_그림자");
    expect(프로필소스.includes('"승인문답:"'), "접두 문자열 사본이 다시 생겼다 — 한쪽만 고쳐지는 날 판정이 조용히 0건이 된다").toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 2026-09-12 검토관 적발 수리 — 「분모가 바뀐 첫 밤」 마커는 **회차마다** 따로다
//   4000·4100 두 패스가 같은 저장소(.tmp-reports)를 쓰므로, 마커 이름이 하나면 한쪽이 먹고
//   다른 쪽은 그 안내를 영영 못 본다. 또 보고서를 쓰기 **전에** 마커를 남기면, 그 뒤 회차가
//   깨졌을 때 안내만 소비되고 사라진다.
describe("★ 분모가 바뀐 첫 밤 마커 — 회차 이름이 들어가고, 보고서를 쓴 뒤에 남긴다", () => {
  it("마커 파일 이름에 회차 이름(파일이름)이 들어간다", () => {
    const m = 하네스소스.match(/const 분모전환마커 = path\.join\(OUT, ([^)]*)\)/);
    expect(m, "분모전환마커 자리를 못 찾았다").not.toBeNull();
    expect(m![1], "마커 이름이 회차와 무관해 두 패스가 서로의 첫 밤 안내를 먹는다").toContain("파일이름");
  });

  it("마커 쓰기가 보고서 쓰기보다 **뒤**에 있다", () => {
    const 보고서쓰기 = 하네스소스.indexOf("fs.writeFileSync(보고서파일, md");
    const 마커쓰기 = 하네스소스.indexOf("fs.writeFileSync(분모전환마커");
    expect(보고서쓰기).toBeGreaterThan(0);
    expect(마커쓰기).toBeGreaterThan(0);
    expect(마커쓰기, "보고서보다 먼저 마커를 남기면 회차가 깨졌을 때 안내가 소비만 되고 사라진다")
      .toBeGreaterThan(보고서쓰기);
  });
});

describe("★ ops-sim.mjs CLI — --profile 오탈자는 네트워크 시도 전에 즉시 멈춘다", () => {
  it("모르는 프로필 이름이면 exit 2 · 사유를 stderr에 적는다", () => {
    const r = spawnSync(process.execPath, [path.join(루트, "tools", "ops-sim.mjs"), "--profile", "bogus"], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("없는 프로필");
  });

  it("--profile 뒤에 값이 없으면 값인자()가 멈춘다(오타로 전 문항이 도는 사고 재발 방지)", () => {
    const r = spawnSync(process.execPath, [path.join(루트, "tools", "ops-sim.mjs"), "--profile"], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--profile 뒤에 값이 없습니다");
  });
});

describe("★ ops-sim.mjs 소스 — 프로필 기제가 실제로 배선돼 있다(약속-코드 일치)", () => {
  it("opssim-profile.mjs를 불러온다", () => {
    expect(하네스소스).toContain('from "./opssim-profile.mjs"');
  });

  it("건너뜀 줄은 대상에서 안 뺀다 — out:''로 결과에 남는다(불편 계산에서 자동으로 빠진다)", () => {
    expect(하네스소스).toMatch(/r\s*=\s*\{\s*out:\s*"",\s*건너뜀:\s*건너뜀값\s*\}/);
  });

  it("집계()를 한 번만 부른다 — 사본을 두면 md·meta·console이 어긋난다", () => {
    const 호출수 = (하네스소스.match(/=\s*집계\(결과\)/g) || []).length;
    expect(호출수).toBe(1);
  });

  it("4000 패스 완주 조건(대상.length === 문항.length)이 여전히 완주 판정의 전부다 — 건너뜀 줄도 대상에 남는다는 계약", () => {
    expect(하네스소스).toContain("완주: 대상.length === 문항.length,");
  });
});
