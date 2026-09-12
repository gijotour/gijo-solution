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

  it("표식표에 최소 16개(data_items 10 + config_items 5 + unsure 1)가 적혀 있다", () => {
    expect(Object.keys(표식표).length).toBeGreaterThanOrEqual(16);
  });

  it("④ 두 마당(⑧·⑭)에 같은 물음 「AI가 아낀 시간 얼마야?」가 있다 — 지금은 표식이 없어 계약(잰다)에 남는다", () => {
    const 겹치는물음 = "AI가 아낀 시간 얼마야?";
    expect(마당물음전체.filter((q) => q === 겹치는물음).length, "중복이 사라졌거나 늘었다 — 마당 구성이 바뀌었다").toBe(2);
    expect(표식표[겹치는물음], "중복 문항에 표식이 생겼다 — 아래 판정이 두 마당 모두에 걸리는지 다시 확인할 것").toBeUndefined();
    expect(계약부분집합([겹치는물음, 겹치는물음])).toEqual([겹치는물음, 겹치는물음]);
  });

  it("④ 건너뜀사유는 물음 문자열 하나만 열쇠로 쓴다 — 어느 마당에서 왔는지는 안 본다(같은 물음=같은 판정)", () => {
    // ops-sim.mjs의 실행 고리는 대상.map(c => 건너뜀사유(c.q, ...))처럼 c.q만 넘긴다(c.마당은 안 넘긴다).
    // 그래서 같은 물음이 두 마당에 있어도 판정은 항상 같다 — 실제 표식 문항(데이터:업무) 하나로 확인한다.
    const q = "10.0.0.100 에 뭐가 있어?"; // 표식표에 실재하는 문항 — 다른 「가상의 마당」에서 왔다고 가정해도
    const qa4100 = 프로필가져오기("qa4100");
    const 감지 = { 법령: true, CTI: true };
    const 첫번째마당에서온호출 = 건너뜀사유(q, qa4100, 감지);
    const 두번째마당에서온호출 = 건너뜀사유(q, qa4100, 감지); // 마당 정보를 아예 안 받으므로 결과는 항상 같다
    expect(첫번째마당에서온호출).toBe("데이터:업무");
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

  it("업무 3 · 씨앗문서 8(7+unsure 1) · 법령 5 — 표식표 구성이 설계관 지시서 수와 같다", () => {
    expect(업무목록.length).toBe(3);
    expect(씨앗목록.length).toBe(8);
    expect(법령목록.length).toBe(5);
    expect(업무목록.length + 씨앗목록.length + 법령목록.length).toBe(Object.keys(표식표).length);
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

  it("qa4100 + 법령 켜짐 — 데이터:업무 셋만 건너뛴다(씨앗문서는 있으므로 그 여덟은 계속 잰다 — B8 같은 결함을 안 가린다)", () => {
    for (const q of 업무목록) expect(건너뜀사유(q, qa4100, 켜짐)).toBe("데이터:업무");
    for (const q of [...씨앗목록, ...법령목록]) expect(건너뜀사유(q, qa4100, 켜짐), `"${q}"가 부당하게 건너뛰어졌다`).toBeNull();
  });

  it("qa4100 + 법령 꺼짐 — 업무 3 + 법령 5 = 8건 건너뜀, 씨앗문서 8건은 그대로 잰다", () => {
    const 건너뜀개수 = [...업무목록, ...씨앗목록, ...법령목록].filter((q) => 건너뜀사유(q, qa4100, 꺼짐)).length;
    expect(건너뜀개수).toBe(8);
    for (const q of 씨앗목록) expect(건너뜀사유(q, qa4100, 꺼짐)).toBeNull();
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
    const 문자열형 = 계약부분집합(["10.0.0.100 에 뭐가 있어?", "우리 자산 몇 대야?"]);
    const 객체형 = 계약부분집합([{ q: "10.0.0.100 에 뭐가 있어?" }, { q: "우리 자산 몇 대야?" }]);
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

  it("승인 문답 근거가 2건 미만이면 ⓐ가 0건 발화로 보고된다", () => {
    const 결과 = 사내문답문항.map((q) => ({ q, out: "연 1회", sources: ["승인문답:1"], 불편: [] }));
    const 줄 = 영발화보고(결과);
    expect(줄.some((s) => s.includes("사내문답과반금지"))).toBe(true);
    expect(줄.find((s) => s.includes("사내문답과반금지"))).toContain(`${사내문답문항.length}건 < 2`);
  });

  it("승인 문답 근거가 2건 이상인 행이 하나라도 있으면 발화한 것이다 — 보고에 안 나온다", () => {
    const 결과 = 사내문답문항.map((q, i) => ({
      q, out: "연 1회", sources: i === 0 ? ["승인문답:1", "승인문답:2"] : [], 불편: [],
    }));
    expect(영발화보고(결과).some((s) => s.includes("사내문답과반금지"))).toBe(false);
  });

  it("EPSS가 답에 한 번도 안 실리면 EPSS범위밖금지가 0건 발화(취약점 0건 기계)", () => {
    const 결과 = EPSS문항.map((q) => ({ q, out: "지금은 급한 게 없습니다", 불편: [] }));
    expect(영발화보고(결과).some((s) => s.includes("EPSS범위밖금지"))).toBe(true);
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
