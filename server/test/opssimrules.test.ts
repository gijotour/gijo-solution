// server/test/opssimrules.test.ts — 회귀 하네스의 내용 판정 규칙을 **시험이 직접 문다**.
//
// 왜 생겼나 (2026-09-06 검토관 적발):
//   「경고 없는 % 단정」 규칙을 tools/ops-sim.mjs 안에 인라인으로 넣어 두었더니, 그 규칙을
//   대조하는 시험이 **한 개도 없었다**(ops-sim.json을 읽는 시험 다섯 중 어느 것도 안 본다).
//   ops-sim.mjs는 불러들이는 순간 하네스를 통째로 돌리는 최상위 스크립트라 시험이 못 부른다.
//   → 규칙을 tools/opssim-rules.mjs로 꺼내 **양쪽이 같은 함수를 부르게** 했고, 여기서 문다.
//   이 규칙이 없으면 누가 판정을 고쳐도 vitest는 초록이고, 규칙이 도는 것은 실서버로 하네스를
//   돌릴 때(하루 한 번, 03:00)뿐이었다.
//
// 계획서: 중-3(평가 게이트) 곁가지 — 야간 회귀 하네스의 잣대를 시험이 지킨다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { 경고없는퍼센트단정, 퍼센트꼴 } from "../../tools/opssim-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("★★ 경고 없는 % 단정 — 라이브에서 실제로 샌 답을 문다", () => {
  it("라이브 실물 「제출률은 92%입니다」가 걸린다", () => {
    // 2026-09-06 실측: 조각 8건에 '제출률' 0건 · 배너 없음 · 도구 없음.
    // 92는 문서에 있던 **랜섬웨어 건수**였다 — 숫자 관문은 「조각에 그 숫자가 있나」만 보므로 통과시킨다.
    expect(경고없는퍼센트단정("사내 보안서약서 제출률은 92%입니다.", [], false)).toBe(true);
  });

  it("도구가 답한 %는 **계산값**이라 안 걸린다", () => {
    // 벌하면 제품이 숫자를 안 내게 된다 — 그건 이 규칙이 바라는 바가 아니다.
    expect(경고없는퍼센트단정("취약점 조치율은 74.2%입니다.", ["kpi_status"], false)).toBe(false);
  });

  it("근거없음 표식이 붙었으면 안 걸린다 — 정직을 벌점으로 만들지 않는다", () => {
    expect(경고없는퍼센트단정("업계 평균은 16.2%로 알려져 있습니다.", [], true)).toBe(false);
  });

  it("%가 없으면 안 걸린다 — 「기록이 없습니다」가 정답인 답", () => {
    expect(경고없는퍼센트단정("사내 자료에 제출률 기록이 없습니다.", [], false)).toBe(false);
  });

  it("「퍼센트」라고 풀어 써도 같은 숫자다 — 표기만 바꿔 빠져나가지 못한다", () => {
    expect(경고없는퍼센트단정("설치율은 95 퍼센트입니다.", [], false)).toBe(true);
    expect(경고없는퍼센트단정("클릭률은 16.2퍼센트입니다.", [], false)).toBe(true);
  });

  it("도구 목록이 없거나(undefined) 빈 배열이면 **둘 다** 「도구 없음」이다", () => {
    expect(경고없는퍼센트단정("제출률 92%입니다.", undefined, undefined)).toBe(true);
    expect(경고없는퍼센트단정("제출률 92%입니다.", [], undefined)).toBe(true);
  });

  it("답이 비어 있으면 안 걸린다(빈 답은 따로 세는 불편이다)", () => {
    expect(경고없는퍼센트단정("", [], false)).toBe(false);
    expect(경고없는퍼센트단정(null as unknown as string, [], false)).toBe(false);
  });

  it("퍼센트꼴은 **숫자에 붙은 %만** 본다 — 「% 단위로」 같은 말은 숫자가 아니다", () => {
    expect(퍼센트꼴.test("비율은 % 단위로 표시합니다.")).toBe(false);
    expect(퍼센트꼴.test("100%")).toBe(true);
  });
});

// ⚠ 사본 금지 — 하네스가 **이 모듈을 부르는지**까지 본다. 규칙을 꺼내 놓고 하네스가 옛 인라인
//   식을 그대로 쓰면, 이 파일은 초록인데 실제로 도는 잣대는 딴 것이다(이 저장소의 「사본이
//   어긋난다」 계보 — doctitle 정규식이 같은 실수를 2026-09-06에 한 번 냈다).
describe("★ 하네스가 이 모듈을 실제로 부른다", () => {
  const src = readFileSync(join(__dirname, "../../tools/ops-sim.mjs"), "utf8");

  it("ops-sim.mjs가 opssim-rules.mjs에서 판정을 가져온다", () => {
    expect(src, "하네스가 규칙 모듈을 안 부른다 — 사본이 생겼다").toMatch(
      /import\s*\{[^}]*경고없는퍼센트단정[^}]*\}\s*from\s*["']\.\/opssim-rules\.mjs["']/,
    );
  });

  // ⚠ 이 줄이 실제로 물었다(2026-09-06) — 규칙을 꺼내 놓고도 **보고 통계 쪽에 사본이 하나 더**
  //   남아 있었다(「백분율이 든 답 N건」). 같은 것을 두 곳에 적으면 어긋난다.
  it("규칙 모듈이 없으면 하네스가 아예 못 돈다 — 퍼센트꼴도 저쪽에서 온다", () => {
    expect(src).toMatch(/import\s*\{[^}]*퍼센트꼴[^}]*\}\s*from\s*["']\.\/opssim-rules\.mjs["']/);
  });

  it("ops-sim.mjs에 % 정규식 사본이 남아 있지 않다", () => {
    expect(src.includes("(?:%|퍼센트)"), "판정 식이 하네스에 다시 베껴졌다 — 두 곳이 어긋난다").toBe(false);
  });
});
