// 대화창 「다음 단계」 안내 — 절차 띠(화면)와 한 쌍이다.
//
// 이 시험이 지키는 것(2026-08-02 실사고 기반):
//   ★ 지도에 적은 도구 이름이 **실제로 있는 도구**인가.
//     처음 만들 때 hardening_status·asset_status 두 개를 적었는데 **둘 다 없는 도구**였다.
//     타입은 Record<string, …>라 아무 문자열이나 통과하고, 없는 이름은 영원히 안 걸리므로
//     "④ 검증 다음은 ⑤ 보고" 안내가 아무 데도 안 나온다. 아무도 오류를 못 본다 —
//     기능 QA로는 절대 안 잡히는 **약속-코드 불일치**다.
//   ★ 안내가 가리키는 단계 이름이 사이드바(nav.js)의 단계 이름과 같은가.
//     "③ 조치로 가세요"라고 해 놓고 메뉴엔 그런 이름이 없으면 담당자는 헤맨다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 도구단계, 이어서 } from "../src/engine/agentloop";
import { listAgentTools } from "../src/engine/agenttools";

const navSrc = fs.readFileSync(
  path.join(__dirname, "../../client/src/renderer/pages/nav.js"),
  "utf8"
);

describe("대화창 「다음 단계」 안내", () => {
  it("지도에 적힌 도구가 전부 실제로 있는 도구다", () => {
    const 있는것 = new Set(listAgentTools().map((t) => t.name));
    const 없는것 = Object.keys(도구단계).filter((k) => !있는것.has(k));
    expect(
      없는것,
      `없는 도구 이름을 적으면 그 안내는 영원히 안 나온다:\n  ${없는것.join(", ")}`
    ).toEqual([]);
  });

  it("가리키는 단계 이름이 사이드바에 실제로 있다", () => {
    // nav.js의 단계 라벨은 "① 발견·수집"처럼 적혀 있다. 안내는 "① 발견"처럼 줄여 쓸 수
    // 있으므로 **번호+첫 낱말**이 사이드바에 있는지로 본다(줄여 쓰는 것까지 막으면 과하다).
    const 틀린것: string[] = [];
    for (const [도구, v] of Object.entries(도구단계)) {
      const 머리 = v.다음.trim().split("·")[0];              // "② 우선순위"
      if (!navSrc.includes(머리)) 틀린것.push(`${도구} → ${v.다음}`);
    }
    expect(틀린것, `사이드바에 없는 단계로 보낸다:\n  ${틀린것.join("\n  ")}`).toEqual([]);
  });

  it("이 대조가 헛돌고 있지 않다", () => {
    // ⚠ 지도가 비면 위 두 시험은 **전부 통과하면서 아무것도 안 본다**.
    //   "세는 것은 확인이 아니다"로 이미 당한 적이 있어 못 박는다.
    expect(Object.keys(도구단계).length).toBeGreaterThanOrEqual(10);
    expect(listAgentTools().length).toBeGreaterThanOrEqual(20);
    expect(navSrc).toContain("① 발견");
  });

  it("안내 문구는 담당자가 그대로 말할 수 있는 문장이다", () => {
    // 안내를 읽고 **무엇을 입력해야 하는지**가 안 보이면 없는 것과 같다.
    // 따옴표 안의 예시 문장이나 명확한 다음 행동 서술 중 하나는 있어야 한다.
    const 빈말: string[] = [];
    for (const [도구, v] of Object.entries(도구단계)) {
      const 예시있음 = /["'"'].{6,}["'"']/.test(v.말);
      const 서술있음 = v.말.length >= 15;
      if (!예시있음 && !서술있음) 빈말.push(도구);
    }
    expect(빈말, `무엇을 하라는지 없는 안내:\n  ${빈말.join(", ")}`).toEqual([]);
  });
});

// 절차 밖 조회 도구의 「이어서」 — 147상황 실전 시뮬레이션에서 가장 많았던 불편이
// **「숫자만 주고 갈 곳 없음」 9건**이었고, 원인은 그 도구가 지도에 없어서였다.
describe("절차 밖 도구의 「이어서」", () => {
  it("적힌 도구가 전부 실제로 있는 도구다", () => {
    const 있는것 = new Set(listAgentTools().map((t) => t.name));
    const 없는것 = Object.keys(이어서).filter((k) => !있는것.has(k));
    expect(없는것, `없는 도구 이름은 영영 안 걸린다:\n  ${없는것.join(", ")}`).toEqual([]);
  });

  it("절차 지도와 겹치지 않는다 — 겹치면 어느 쪽이 나올지 알 수 없다", () => {
    const 겹침 = Object.keys(이어서).filter((k) => k in 도구단계);
    expect(겹침, `같은 도구가 두 지도에 있다:\n  ${겹침.join(", ")}`).toEqual([]);
  });

  it("안내에 무엇을 하라는지가 들어 있다", () => {
    for (const [도구, 말] of Object.entries(이어서)) {
      expect(말.length, `${도구} 안내가 너무 짧다`).toBeGreaterThanOrEqual(12);
    }
  });

  it("이 대조가 헛돌고 있지 않다", () => {
    expect(Object.keys(이어서).length).toBeGreaterThanOrEqual(8);
  });
});
