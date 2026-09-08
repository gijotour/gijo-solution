// server/test/opssimevidence.test.ts — 야간 하네스 기록의 **근거 칸 스위치**를 시험이 문다.
//
// ■ 무엇이 걸려 있나 (2026-09-08)
//   `.tmp-reports/ops-sim.json`에는 가드가 본 **근거 조각 본문**이 평문으로 담긴다. 하네스
//   계정이 claude-deploy(admin)라 **등급 C(기밀) 사내 문답 조각**까지 들어간다. 사장님 결정은
//   「지우지 않는다(되먹임 값어치) + 출하 전 되돌리기 목록에 등재 + 끄는 스위치」였다.
//   → 이 시험은 그 셋 가운데 **코드로 지킬 수 있는 둘**을 문다:
//      ① 스위치를 켰는데 조각이 적히면 빨강(반증)
//      ② 하네스가 이 잣대를 실제로 부르는가(소스 감시) · 되돌리기 목록에 등재돼 있는가(문서 감시)
//
// ■ 왜 소스 감시까지 하나 — shipscripts.test.ts 계열
//   판정 함수만 초록이면 「함수는 맞는데 하네스는 옛 인라인 코드로 적는다」가 통과한다.
//   실제로 이 저장소가 반복해 겪은 「잣대가 두 곳」이다. 그래서 ops-sim.mjs가 이 모듈을
//   import하는지, 그리고 **인라인으로 근거조각을 적는 자리가 남아 있지 않은지**를 함께 본다.
//
// 계획서: 중-3(평가 게이트) 곁가지 — 야간 회귀 기록이 남기면 안 되는 것을 안 남기는가.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { 근거기록할까, 근거칸, 건너뛸사유 } from "../../tools/opssim-evidence.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(__dirname, "..", "..");
const 하네스 = readFileSync(join(뿌리, "tools", "ops-sim.mjs"), "utf8");

// 라이브 qa 응답을 본뜬 가짜 근거원천 — 조각 본문에 **사내 문서 냄새**를 일부러 넣는다.
const 가짜원천 = {
  조각: ["【사내】 2026년 침해사고 대응 절차 — 최초 신고는 정보보호팀장에게…", "두 번째 조각"],
  추가원천: ["용어사전: 침해사고란…"],
  보고횟수: 1,
};

describe("★ 근거 칸 스위치 — 켜면 조각 본문이 기록에 안 남는다", () => {
  it("기본은 **기록**이다 — 개발 기계(win)의 되먹임이 값어치다", () => {
    expect(근거기록할까([], {})).toBe(true);
    expect(근거기록할까(["node", "ops-sim.mjs", "--limit", "5"], {})).toBe(true);
    expect(근거기록할까([], { GIJO_OPSSIM_EVIDENCE: "1" })).toBe(true);
  });

  it("--no-evidence 를 주면 끈다", () => {
    expect(근거기록할까(["node", "ops-sim.mjs", "--no-evidence"], {})).toBe(false);
    // 다른 인자와 섞여도 자리를 안 탄다(값 받는 인자가 아니다).
    expect(근거기록할까(["node", "ops-sim.mjs", "--no-evidence", "--limit", "5"], {})).toBe(false);
    expect(근거기록할까(["node", "ops-sim.mjs", "--limit", "5", "--no-evidence"], {})).toBe(false);
  });

  it("GIJO_OPSSIM_EVIDENCE=0 으로도 끈다 — 인자를 못 주는 예약 실행 자리용", () => {
    expect(근거기록할까([], { GIJO_OPSSIM_EVIDENCE: "0" })).toBe(false);
    expect(근거기록할까([], { GIJO_OPSSIM_EVIDENCE: " 0 " })).toBe(false);
    // ⚠ 「비어 있음」은 끈 것이 아니다 — 빈 값으로 조용히 꺼지면 되먹임이 소리 없이 사라진다.
    expect(근거기록할까([], { GIJO_OPSSIM_EVIDENCE: "" })).toBe(true);
  });

  it("★★ **반증** — 스위치를 켰는데 조각·추가원천이 적히면 빨강", () => {
    const 칸 = 근거칸(가짜원천, false) as Record<string, unknown>;
    expect(Object.keys(칸), "끈 회차에 근거조각이 적혔다 — 등급 C 조각이 평문으로 남는다")
      .not.toContain("근거조각");
    expect(Object.keys(칸), "끈 회차에 추가원천이 적혔다").not.toContain("추가원천");
    // 통째로 훑어 본문이 한 글자도 안 새는지 본다(칸 이름만 보면 딴 이름으로 새는 것을 놓친다).
    const 적힌글 = JSON.stringify(칸);
    for (const 조각 of 가짜원천.조각) {
      expect(적힌글.includes(조각.slice(0, 12)), `조각 본문이 기록에 남았다: ${조각.slice(0, 20)}…`).toBe(false);
    }
    expect(적힌글.includes(가짜원천.추가원천[0].slice(0, 8)), "추가원천 본문이 남았다").toBe(false);
  });

  it("★ 껐어도 **가드횟수는 남는다** — 「일부러 안 적었다」가 보여야 한다", () => {
    const 칸 = 근거칸(가짜원천, false) as Record<string, unknown>;
    expect(칸.가드횟수, "가드횟수까지 지우면 「옛 서버라 못 받았다」와 구별이 안 된다").toBe(1);
    expect(칸.근거기록끔, "끈 표식이 없다 — 재료 없음을 고장으로 오해한다").toBe(true);
  });

  it("켜면 세 칸을 그대로 적는다 — 자르지 않는다(겹침 창 20자)", () => {
    const 칸 = 근거칸(가짜원천, true) as Record<string, unknown>;
    expect(칸.근거조각).toEqual(가짜원천.조각);
    expect(칸.추가원천).toEqual(가짜원천.추가원천);
    expect(칸.가드횟수).toBe(1);
    expect(칸.근거기록끔, "켠 회차에 끈 표식이 붙었다").toBeUndefined();
  });

  it("조각 null(판정 보류)을 []로 뭉개지 않는다", () => {
    // citeguard.test가 Array.isArray로 그 둘을 가른다 — 뭉개면 없던 오탐이 난다.
    const 칸 = 근거칸({ 조각: null, 추가원천: [], 보고횟수: 2 }, true) as Record<string, unknown>;
    expect(칸.근거조각).toBeNull();
    expect(Array.isArray(칸.근거조각)).toBe(false);
  });

  it("옛 서버(근거원천 없음)면 칸을 통째로 안 만든다", () => {
    expect(근거칸(undefined, true)).toEqual({});
    expect(근거칸(undefined, false)).toEqual({});
  });
});

describe("★ 건너뛸 사유 — 왜 건너뛰는지가 로그에 남는다", () => {
  it("재료가 없으면 **gb10은 일부러 안 옮긴다**는 사실까지 말한다", () => {
    const 사유 = 건너뛸사유(false, 0);
    expect(사유).toContain("재료 없음");
    expect(사유, "설계인지 고장인지 못 가린다").toContain("gb10");
    expect(사유, "왜 안 옮기는지 안 밝힌다").toMatch(/등급 C/);
  });

  it("반쪽 기록이면 건수와 최소를 숫자로 말한다", () => {
    const 사유 = 건너뛸사유(true, 11);
    expect(사유).toContain("11건");
    expect(사유).toContain("50건");
  });

  it("잴 수 있으면 빈 문자열이다 — 사유가 있으면 로그가 찍힌다", () => {
    expect(건너뛸사유(true, 162)).toBe("");
    expect(건너뛸사유(true, 50)).toBe("");
  });
});

describe("★ 소스 감시 — 잣대가 두 곳이 되지 않게", () => {
  it("ops-sim.mjs가 opssim-evidence.mjs에서 판정을 가져온다", () => {
    expect(하네스, "하네스가 이 모듈을 안 부른다 — 시험이 딴 코드를 재고 있다")
      .toContain("opssim-evidence.mjs");
    expect(하네스).toContain("근거기록할까");
    expect(하네스).toContain("근거칸(");
  });

  it("★ 하네스에 **인라인 근거 칸**이 남아 있지 않다", () => {
    // 「함수는 맞는데 하네스는 옛 코드로 적는다」를 막는다. 칸 이름을 하네스가 직접 쓰면
    // 스위치를 우회하는 길이 생긴다 — 그 이름은 이제 opssim-evidence.mjs에만 산다.
    expect(하네스.includes("근거조각:"), "하네스가 근거조각을 직접 적는다 — 스위치를 우회한다").toBe(false);
    expect(하네스.includes("추가원천:"), "하네스가 추가원천을 직접 적는다").toBe(false);
  });

  it("★ 머리말이 **왜 이 스위치가 있는지**를 말한다", () => {
    const 머리 = 하네스.slice(0, 4000);
    expect(머리, "--no-evidence 안내가 없다").toContain("--no-evidence");
    expect(머리, "왜 끄는지(등급 C 조각 평문)를 안 밝힌다").toMatch(/등급 C|기밀/);
  });

  it("★ 하네스가 이번 회차에 적었는지 여부를 **메타에 남긴다**", () => {
    // 기록만 보고 「왜 조각이 없지」를 되짚는 사람이 생기지 않게, 회차 메타가 먼저 말한다.
    expect(하네스, "meta.json에 근거기록 칸이 없다").toContain("근거기록:");
  });
});

describe("★ 문서 감시 — 출하 전 되돌리기 목록에 등재돼 있다", () => {
  const 계획서 = readFileSync(join(뿌리, "GIJO_AS_AI팀_증류학습_계획서.md"), "utf8");

  it("「출하 전 되돌리기」 **절**이 있다 — 본문 어딘가에 낱말이 있는 것과 다르다", () => {
    // ⚠ 「출하 전 되돌리기」는 갱신 이력 본문에도 나온다. 낱말만 세면 절이 사라져도 초록이다.
    expect(계획서, "되돌리기 절이 사라졌다 — 되돌릴 것을 아무도 모른 채 출하된다")
      .toMatch(/^#{2,3} .*출하 전 되돌리기/m);
  });

  it("★ 하네스 기록 항목이 기존 둘(개발 모드·DB 평문)과 **같은 표**에 있다", () => {
    // ⚠ indexOf("출하 전 되돌리기")로 자르면 **갱신 이력의 낱말**에 먼저 걸려, 절이 비어 있어도
    //   뒤쪽 본문 아무 데나 있는 글자로 초록이 난다. 절의 **머리글**에서 자른다.
    const m = 계획서.match(/^#{2,3} .*출하 전 되돌리기.*$/m);
    expect(m, "되돌리기 절 머리글을 못 찾았다").not.toBeNull();
    const 절 = 계획서.slice(계획서.indexOf(m![0]));
    expect(절, "개발 모드 항목이 없다").toContain("GIJO_DEV_MODE");
    expect(절, "DB 평문 항목이 없다").toMatch(/encrypt-db|암호화/);
    expect(절, "야간 하네스 기록 항목이 없다 — 이번에 등재한 것이 빠졌다").toContain("--no-evidence");
    expect(절, "무엇이 남는지(등급 C 조각 평문)를 안 밝힌다").toMatch(/등급 C/);
    expect(절, "지우는 길(.tmp-reports)을 안 알려 준다").toContain(".tmp-reports");
  });
});

describe("★ 건너뛰는 시험들이 **사유를 로그에 찍는다**", () => {
  // 건너뜀은 조용해서 고장처럼 안 보인다. gb10 사본에서 이 넷이 늘 건너뛰는 것은
  // 고장이 아니라 설계인데, 사유가 안 찍히면 다음 사람이 재료를 옮기려 든다(=조각 유출).
  const 대상 = ["noevidence-mark", "numgrounding", "promptleak-retry", "tone-realanswers"];
  for (const 이름 of 대상) {
    it(`${이름}.test.ts가 건너뛸 사유를 찍는다`, () => {
      const 소스 = readFileSync(join(__dirname, `${이름}.test.ts`), "utf8");
      expect(소스, "공용 사유를 안 쓴다 — 파일마다 문구가 갈린다").toContain("opssim-evidence.mjs");
      expect(소스, "사유를 로그로 안 찍는다 — 건너뜀이 조용히 지나간다").toMatch(/console\.log\([^)]*⏭/);
    });
  }
});
