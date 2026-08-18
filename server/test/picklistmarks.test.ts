// 대화창이 실어 보내는 **기계용 표식**이 담당자 눈에 새지 않게 지킨다.
//
// ⚠ 이 시험이 있는 이유 — **같은 사고를 두 번 겪었다**:
//   ① 2026-07-31 — 목록에서 고를 때 붙는 sha1 해시가 그대로 저장돼 작업 내역이 해시 범벅이 됐다.
//      담당자가 자기 대화를 못 알아봤다. 그래서 `stripPickMarks`를 만들었다.
//   ② 2026-08-18 — 새로 만든 `#범위`를 그 목록에 **안 넣어** 또 샜다. 접힌 줄이
//      「자산 몇 개야? #범위 asset:vuln:10.10.20.11」로 저장된 것을 **실화면 확인에서** 잡았다.
//      시험은 초록이었다.
//   ⇒ 손으로 관리하는 목록은 반복해 샌다. **선언된 표식이 전부 제거 목록에 있는지** 센다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { stripPickMarks, ALL_MARKS, PICK_MARK, VIEW_MARK, SCOPE_MARK } from "../src/engine/picklist";

const 소스 = fs.readFileSync(new URL("../src/engine/picklist.ts", import.meta.url), "utf8");

describe("기계용 표식이 사람 눈에 새지 않는다", () => {
  it("★★ **선언된 표식이 전부** 제거 목록에 있다 — 하나라도 빠지면 그 글자가 저장된다", () => {
    // 소스에서 `#…` 꼴 표식 상수를 전부 찾아 ALL_MARKS와 대조한다.
    // 새 표식을 만들고 ALL_MARKS에 안 넣으면 **여기서 잡힌다**.
    const 선언된 = [...소스.matchAll(/^(?:export )?const \w*_MARK = "(#[^"]+)";/gm)].map((m) => m[1]);
    expect(선언된.length, "표식 상수를 하나도 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThanOrEqual(5);
    const 빠진것 = 선언된.filter((m) => !(ALL_MARKS as readonly string[]).includes(m));
    expect(빠진것, "제거 목록에 없는 표식이 있다 — 그 글자가 작업 내역에 그대로 저장된다").toEqual([]);
  });

  it("★ 실제로 떼어진다 — 표식 줄만 사라지고 사람 말은 남는다", () => {
    const 원문 = [
      "자산 몇 개야?",
      `${VIEW_MARK} a::1,b::2`,
      `${SCOPE_MARK} asset:vuln:10.10.20.11`,
      `${PICK_MARK} x::1`,
    ].join("\n");
    const 남은 = stripPickMarks(원문);
    expect(남은).toBe("자산 몇 개야?");
    for (const m of ALL_MARKS) expect(남은, `${m}이 남았다`).not.toContain(m);
  });

  it("★ 2026-08-18에 실제로 샜던 그 문장이 이제 깨끗하다", () => {
    // 운영에서 실제로 저장됐던 값이다. 회귀하면 여기서 걸린다.
    const 샜던것 = "자산 몇 개야?\n#범위 asset:vuln:10.10.20.11";
    expect(stripPickMarks(샜던것)).toBe("자산 몇 개야?");
  });

  it("사람이 친 `#`으로 시작하는 말은 안 지운다 — 표식 꼴일 때만 뗀다", () => {
    // "#긴급 처리해줘"처럼 사람이 해시태그를 쓸 수 있다. 표식과 정확히 같지 않으면 남긴다.
    expect(stripPickMarks("#긴급 이거 처리해줘")).toBe("#긴급 이거 처리해줘");
    // 표식 이름이 앞에 붙어도 **뒤에 공백이 없으면** 표식이 아니다.
    expect(stripPickMarks("#범위설정 어떻게 해?")).toBe("#범위설정 어떻게 해?");
  });

  it("★ dispatcher가 **기록에는 뗀 글**을 남긴다 — 표식이 턴에 저장되면 안 된다", () => {
    const d = fs.readFileSync(new URL("../src/engine/dispatcher.ts", import.meta.url), "utf8");
    expect(d, "기록용 글을 안 만든다").toMatch(/const 기록문 = stripPickMarks\(instructionText\)/);
    // 그 글이 실제로 턴·접힌 줄에 쓰여야 한다.
    expect(d, "턴에 원문을 그대로 남긴다").toMatch(/appendTurn\(session\.id, "user", 기록문\)/);
    expect(d, "접힌 줄에 원문을 그대로 남긴다").toMatch(/세션축\(result, 기록문/);
  });
});
