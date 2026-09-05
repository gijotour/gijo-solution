// 「근거 없음」 표식 — 배너가 붙은 답은 **반드시** 표식도 붙는다 (2026-09-05 · 계획서 전-4)
//
// ■ 무엇을 지키나
//   담당자가 보는 사실은 하나다 — 「이 답의 숫자를 뒷받침할 사내 출처가 없다」.
//   그 사실을 말하는 배너가 넷(자료없음·지정범위·자료요청·근거약함)이고, 화면은 그 사실을
//   보고 숫자를 옅게 그린다. 배너와 표식이 어긋나면 **경고문은 있는데 숫자는 진한** 답이 나온다.
//
// ■ 왜 「근거세기」를 안 쓰고 새 칸을 뒀나 (실측이 결정했다 — 설계관 2026-09-05)
//   근거세기는 **배지용 재검색**의 세기다. 실전 답 152건에서 근거세기가 원리상 undefined인 답이
//   121건(79.6%)인데 그중 배너가 붙은 것은 1건뿐이다 — 「근거세기 없음 = 근거 없음」으로 읽으면
//   120건이 오탐으로 회색이 된다. 그래서 「없음」을 **명시적으로** 실어 보낸다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  자료없음배너, 지정범위배너, 자료요청배너, 근거약함배너, 근거없음종류판정,
} from "../src/engine/noevidence";

// ⚠ 배너 문장의 주인은 noevidence.ts다(2026-09-05 이관 — llm.ts는 다시 내보내기만 한다).
const 배너소스 = fs.readFileSync(path.join(__dirname, "../src/engine/noevidence.ts"), "utf8");
const disp소스 = fs.readFileSync(path.join(__dirname, "../src/engine/dispatcher.ts"), "utf8");

const 배너들: [string, string][] = [
  ["자료없음", 자료없음배너],
  ["지정범위", 지정범위배너],
  ["자료요청", 자료요청배너],
  ["근거약함", 근거약함배너],
];

describe("★ 근거 없음 표식 — 판정기", () => {
  it("배너 4종을 각각 제 종류로 읽는다", () => {
    for (const [종류, 배너] of 배너들) {
      expect(근거없음종류판정(`${배너}\n\n답 본문입니다.`), `${종류} 배너를 못 읽었다`).toBe(종류);
    }
  });

  it("배너가 없으면 표식도 없다 — 없는 경고를 만들지 않는다", () => {
    expect(근거없음종류판정("미조치 Critical 취약점은 3건입니다.")).toBeNull();
    expect(근거없음종류판정("")).toBeNull();
    expect(근거없음종류판정(undefined)).toBeNull();
    // ⚠ 표식만으로 「모른다」 답을 만들지 않는다 — ⚠로 시작해도 우리 배너가 아니면 아니다.
    expect(근거없음종류판정("⚠ 스캔이 실패했습니다 — 장비에 접속하지 못했습니다.")).toBeNull();
  });

  it("배너가 **답 맨 앞**일 때만 잡는다 — 본문에 인용된 배너 문장에 속지 않는다", () => {
    expect(근거없음종류판정(`제품은 이런 경고를 붙입니다: ${자료없음배너}`)).toBeNull();
    // 앞 공백·줄바꿈은 봐준다(코드가 붙이는 자리라 앞이 깨끗하지만, 손질 함수가 하나 더 끼어도 산다).
    expect(근거없음종류판정(`\n  ${근거약함배너}\n\n답`)).toBe("근거약함");
  });

  it("배너를 새로 만들면 판정표에도 실린다 — 표를 안 늘리면 새 배너는 조용히 표식 없이 나간다", () => {
    // noevidence.ts가 export하는 「…배너」 상수 개수 ↔ 판정표 항목 개수.
    const 상수들 = [...배너소스.matchAll(/export const (\S*배너) =/g)].map((m) => m[1]);
    const 표에실린것 = 배너들.map(([종류]) => 종류);
    expect(상수들.length, `배너 상수 ${상수들.length}개(${상수들.join(", ")}) vs 판정표 ${표에실린것.length}개 — 새 배너를 표에 안 넣었다`)
      .toBe(표에실린것.length);
  });
});

describe("★ 표식을 싣는 자리 — 소스 감시", () => {
  it("응답 타입에 근거없음 칸이 있다(계산만 하고 버리면 화면이 못 쓴다)", () => {
    expect(disp소스, "DispatchResult에 근거없음 칸이 없다").toMatch(/근거없음\?:\s*근거없음종류/);
  });

  it("판정은 noevidence.ts의 판정기로 한다 — dispatcher가 배너 문구를 다시 적지 않는다", () => {
    expect(disp소스, "판정기를 안 쓴다").toContain("근거없음종류판정(");
    // ⚠ llm이 아니라 noevidence에서 가져와야 한다 — llm을 통째로 흉내 내는 시험 76개가 죽는다.
    expect(disp소스, "판정기를 llm에서 가져왔다").toMatch(/근거없음종류판정[^\n]*from "\.\/noevidence"/);
    for (const [종류, 배너] of 배너들) {
      const 머리 = 배너.replace(/^⚠\s*\*\*/, "").slice(0, 12);
      expect(disp소스.includes(머리), `${종류} 배너 문구가 dispatcher에 복제됐다: ${머리}`).toBe(false);
    }
  });

  it("★ 판정은 **모든 거르개 뒤**에서 한다 — 본문이 갈리면 표식도 함께 사라져야 한다", () => {
    // 거짓완료 대체답(falseclaim)이 본문을 통째로 갈면 배너도 사라진다. 앞에서 판정하면
    // **없는 배너를 가리키는 표식**이 남아, 화면이 멀쩡한 답의 숫자를 옅게 그린다.
    const 거르개 = disp소스.indexOf("해석을단다(기계데이터를걸러낸다(");
    const 판정 = disp소스.indexOf("근거없음종류판정(");
    expect(거르개, "출구 거르개 줄을 못 찾았다 — 코드가 바뀌었으면 이 시험도 같이 볼 것").toBeGreaterThan(-1);
    expect(판정, "판정 호출을 못 찾았다").toBeGreaterThan(거르개);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 실전 답 기록으로 **어긋남 0**을 잰다.
//   내가 고른 표본으로 재면 내 그물에 걸리는 것만 고르게 된다(tone-realanswers와 같은 취지).
const 기록 = path.join(__dirname, "../../.tmp-reports/ops-sim.json");
const 답들: { q: string; out: string }[] = (() => {
  if (!fs.existsSync(기록)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(기록, "utf8"));
    return (Array.isArray(j) ? j : j.results || [])
      .map((x: any) => ({ q: String(x.q ?? ""), out: String(x.out ?? "") }))
      .filter((x: any) => x.out.trim().length > 0);
  } catch {
    return []; // 시뮬레이션이 쓰는 중이면 반쪽 JSON일 수 있다
  }
})();
// 반쪽 기록으로는 「어긋남 0」을 증명할 수 없다 — 그럴 땐 통과시키지 말고 **건너뛴다**.
const 잴수있음 = 답들.length >= 50;

describe.skipIf(!잴수있음)(`★ 실전 답 ${답들.length}건 — 배너 ↔ 표식 어긋남 0`, () => {
  it("⚠ 배너로 시작하는 답은 **전부** 표식이 붙는다", () => {
    // 판정기와 **다른 방법**으로 후보를 고른다(앞머리 ⚠ 한 글자) — 판정기로 후보를 고르면
    // 「자기가 잡은 것을 자기가 잡았나」를 재는 헛시험이 된다.
    const 어긋남 = 답들
      .filter((a) => /^\s*⚠/.test(a.out))
      .filter((a) => 근거없음종류판정(a.out) === null);
    const 보고 = 어긋남.map((a) => `  「${a.q.slice(0, 30)}」 → ${a.out.slice(0, 70).replace(/\n/g, " ⏎ ")}`).join("\n");
    expect(어긋남.length, `⚠로 시작하는데 표식이 안 붙은 답 ${어긋남.length}건 — 배너가 늘었는지 먼저 보라:\n${보고}`).toBe(0);
  });

  it("표식이 붙은 답은 **전부** 배너로 시작한다(없는 경고를 만들지 않는다)", () => {
    const 헛표식 = 답들.filter((a) => 근거없음종류판정(a.out) !== null && !/^\s*⚠/.test(a.out));
    expect(헛표식.length, "배너 없이 표식만 붙은 답이 있다").toBe(0);
  });

  it("★ 옛 신호(sources 유무)로는 못 갈랐다는 것을 기록해 둔다 — 새 칸을 둔 이유", () => {
    // 이 시험은 제품을 막지 않는다. 「근거세기/sources가 없다」를 「근거 없음」으로 읽으면
    // 안 되는 이유를 **숫자로 남긴다** — 다음 사람이 그 지름길을 다시 밟지 않도록.
    const 배너답 = 답들.filter((a) => 근거없음종류판정(a.out) !== null);
    expect(배너답.length, "배너가 붙은 답이 하나도 없다 — 기록이 낡았는지 보라").toBeGreaterThan(0);
    console.log(`[근거없음] 실전 ${답들.length}건 중 배너 답 ${배너답.length}건 — 종류: ` +
      배너답.map((a) => 근거없음종류판정(a.out)).join(", "));
  });
});

describe("★ 평가 게이트도 배너 4종을 뗀다 — 배너 문장만으로 자동 통과하지 않게", () => {
  it("배너_RE가 배너 4종을 전부 떼어 낸다", () => {
    const 게이트 = fs.readFileSync(path.join(__dirname, "../../tools/evalgate/run.mjs"), "utf8");
    const m = /const 배너_RE = \/(.+)\/([gimsuy]*);/.exec(게이트);
    expect(m, "배너_RE를 못 읽었다 — 이름이 바뀌었으면 이 시험도 같이 볼 것").toBeTruthy();
    const re = new RegExp(m![1], m![2]);
    for (const [종류, 배너] of 배너들) {
      const 답 = `${배너}\n\n지어낸 숫자가 들어간 본문.`;
      expect(답.replace(re, ""), `${종류} 배너가 안 떨어진다 — no-hit-honest 축이 배너만으로 통과한다`)
        .toBe("지어낸 숫자가 들어간 본문.");
    }
  });
});
