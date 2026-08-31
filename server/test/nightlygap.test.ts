// 야간 회귀 결석 감지 — 2026-08-31
//
// 왜: 야간 회귀(152상황)가 **08-25·08-26 두 밤을 건너뛰고도 아무도 몰랐다.** 로그가
// 20260824 다음 20260827로 뛰어 있는데 그것을 보는 눈이 없었다. 처음도 아니다 —
// nightly-ops-sim.ps1 머리 주석이 이미 「예전 예약이 세션과 함께 사라져 이틀 결석했다
// (마지막 08-12, 발견 08-14)」고 적어 두었다. **두 번 같은 사고를 겪고서야 자를 만든다.**
//
// 결석은 **아무 일도 안 일어나는 것**이라 스스로 못 알린다. 그래서 셈하는 자(nightly-gap)를
// 따로 두고, ①다음 회차가 로그 머리에 공백을 적고 ②게시 관문이 사흘 넘게 비면 막는다.
// 이 시험은 그 **자 자체가 제대로 세는지**를 본다 — 자가 틀리면 위 둘이 다 헛돈다.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 결석현황, 회차들 } from "../../tools/nightly-gap.mjs";

/** 로그 파일만 있는 가짜 저장소를 만든다(내용은 안 본다 — 「돌았는가」만 세는 자다). */
function 가짜(회차: number[]): string {
  const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-nightly-"));
  mkdirSync(join(뿌리, ".tmp-reports"), { recursive: true });
  for (const d of 회차) writeFileSync(join(뿌리, ".tmp-reports", `ops-sim-nightly-${d}.log`), "끝");
  return 뿌리;
}

describe("야간 회귀 결석 — 셈하는 자가 제대로 센다", () => {
  it("빠진 날이 없으면 결석 0건", () => {
    const 뿌리 = 가짜([20260828, 20260829, 20260830]);
    try {
      const r = 결석현황(뿌리, 20260830);
      expect(r.회차수).toBe(3);
      expect(r.결석구간).toEqual([]);
      expect(r.빈날).toBe(0);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("★ 실제로 겪은 그 공백을 잡는다 — 08-24 다음이 08-27(2일)", () => {
    const 뿌리 = 가짜([20260823, 20260824, 20260827, 20260828]);
    try {
      const r = 결석현황(뿌리, 20260828);
      expect(r.결석구간.length, "공백을 못 봤다").toBe(1);
      expect(r.결석구간[0]).toMatchObject({ 앞: 20260824, 뒤: 20260827, 뜬날: 2 });
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("★★ 오늘까지 이어지는 공백을 센다 — 게시 관문이 막는 잣대", () => {
    // 관문은 빈날 > 2에서 멈춘다. 경계를 못 박아 둔다.
    const 뿌리 = 가짜([20260825]);
    try {
      expect(결석현황(뿌리, 20260825).빈날, "오늘 돌았으면 0").toBe(0);
      expect(결석현황(뿌리, 20260826).빈날, "하루 비면 1 — 흔한 일이라 안 막는다").toBe(1);
      expect(결석현황(뿌리, 20260828).빈날, "사흘 비면 3 — 여기서 막는다").toBe(3);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("달을 넘겨도 센다 — 08-31 다음 09-02", () => {
    const 뿌리 = 가짜([20260831, 20260902]);
    try {
      const r = 결석현황(뿌리, 20260902);
      expect(r.결석구간[0]).toMatchObject({ 앞: 20260831, 뒤: 20260902, 뜬날: 1 });
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("기록이 아예 없으면 그렇다고 말한다 — 조용히 0으로 통과하지 않는다", () => {
    const 뿌리 = mkdtempSync(join(tmpdir(), "gijo-nightly-none-"));
    try {
      const r = 결석현황(뿌리, 20260831);
      expect(r.회차수).toBe(0);
      expect(r.문장, "「기록이 없다」를 말해야 한다 — 0건 통과는 거짓 초록이다").toContain("없습니다");
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });

  it("이름이 다른 파일은 회차로 안 센다", () => {
    const 뿌리 = 가짜([20260830]);
    try {
      writeFileSync(join(뿌리, ".tmp-reports", "ops-sim.md"), "x");
      writeFileSync(join(뿌리, ".tmp-reports", "ops-sim-nightly-오류.log"), "x");
      expect(회차들(뿌리)).toEqual([20260830]);
    } finally { rmSync(뿌리, { recursive: true, force: true }); }
  });
});

describe("결석 감지가 실제로 배선돼 있다 — 자만 만들고 안 쓰면 소용없다", () => {
  it("다음 회차가 공백을 로그에 적는다(nightly-ops-sim.ps1)", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync(join(__dirname, "..", "..", "tools", "nightly-ops-sim.ps1"), "utf8");
    expect(s, "실행기가 결석을 안 적는다").toContain("nightly-gap.mjs");
  });

  it("게시 관문이 오래된 회귀에 게시를 막는다(publish-gate-ui.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync(join(__dirname, "..", "..", "tools", "publish-gate-ui.mjs"), "utf8");
    expect(s, "관문이 결석을 안 본다").toContain("nightly-gap.mjs");
    expect(s, "막는 잣대(빈날)가 없다").toMatch(/빈날\s*>\s*2/);
  });
});
