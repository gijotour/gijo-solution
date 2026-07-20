// util/date.ts — koDateTimeString 회귀 테스트.
// 실측(2026-07-21): dayPeriod를 명시 안 하면 Node 버전에 따라 "오전/오후" 대신 영어 "AM/PM"이
// 나온다(운영 Node 20에서 재현, 이 개발머신 Node 24에선 재현 안 됨 — 버전에 좌우되는 버그라
// 실행 환경이 바뀌어도 깨지지 않게 dayPeriod를 강제 고정했는지 회귀로 잠근다).
import { describe, it, expect } from "vitest";
import { koDateTimeString } from "../src/util/date";

describe("koDateTimeString — 한국어 오전/오후 고정(Node 버전 무관)", () => {
  it("영어 AM/PM이 아니라 오전/오후로 표기한다", () => {
    const morning = new Date(2026, 6, 27, 9, 0).getTime();
    const afternoon = new Date(2026, 6, 27, 15, 0).getTime();
    expect(koDateTimeString(morning)).toContain("오전");
    expect(koDateTimeString(morning)).not.toMatch(/\bAM\b/);
    expect(koDateTimeString(afternoon)).toContain("오후");
    expect(koDateTimeString(afternoon)).not.toMatch(/\bPM\b/);
  });

  it("연/월/일/시/분/초를 모두 담는다", () => {
    const ms = new Date(2026, 6, 27, 9, 5, 3).getTime();
    const s = koDateTimeString(ms);
    expect(s).toContain("2026");
    expect(s).toContain("9:05:03");
  });
});
