// 말투 감시를 제품에 켠 자리 — **막지 않고 기록만** 하는가.
//
// 왜 이 시험이 필요한가: 감시가 답을 막기 시작하면 오탐 하나로 담당자가 아무것도 못 받는다.
//   놓치는 것보다 나쁘다. "기록만 한다"는 약속은 말로만 하면 다음 사람이 쉽게 뒤집는다 —
//   여기서 코드로 못 박는다.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 말투재기, 말투현황, 말투현황줄, resetToneWatchForTests } from "../src/engine/tonewatch";

beforeEach(() => resetToneWatchForTests());

describe("★ 막지 않는다 — 답을 바꾸지 않는다", () => {
  it("말투재기는 아무것도 돌려주지 않는다(답을 갈아치울 수 없다)", () => {
    expect(말투재기("물음", "취약점 현황을 정리해 드리겠습니다.")).toBeUndefined();
  });

  it("★ 부르는 쪽이 답을 그대로 내보낸다 — 소스로 확인", () => {
    // 감시를 답 조립에 끼워 넣으면(예: output = 말투재기(...)) 이 시험이 잡는다.
    const d = fs.readFileSync(path.join(__dirname, "../src/engine/dispatcher.ts"), "utf8");
    const 부른줄 = d.split("\n").filter((l) => l.includes("말투재기("));
    expect(부른줄.length, "감시를 아무 데서도 안 부른다 — 켜지지 않았다").toBeGreaterThan(0);
    for (const l of 부른줄) {
      expect(l.trim().startsWith("말투재기("), `감시 결과를 답에 쓰고 있다: ${l.trim()}`).toBe(true);
    }
  });

  it("감시가 터져도 답이 안 막힌다", () => {
    // 이상한 값이 들어와도 예외가 밖으로 안 나가야 한다.
    expect(() => 말투재기(null as unknown as string, undefined as unknown as string)).not.toThrow();
    expect(() => 말투재기("q", "")).not.toThrow();
  });
});

describe("기록이 쓸모 있는가", () => {
  it("어긴 답만 쌓이고, 무엇을 어겼는지 남는다", () => {
    말투재기("취약점 알려줘", "미조치 취약점은 14건입니다.");            // 정상
    말투재기("현황 정리해줘", "취약점 현황을 정리해 드리겠습니다.");      // 예고
    const s = 말투현황();
    expect(s.잰답, "잰 답 수가 안 는다").toBe(2);
    expect(s.위반, "정상 답까지 세거나 위반을 못 센다").toBe(1);
    expect(s.최근[0].어긴것).toContain("예고");
    expect(s.최근[0].물음).toContain("현황");
  });

  it("★ 자가 진단 문구가 **막지 않는다는 것**을 분명히 말한다", () => {
    말투재기("q", "취약점 현황을 정리해 드리겠습니다.");
    const 줄 = 말투현황줄()!;
    expect(줄).toContain("말투 규범");
    expect(줄, "왜 안 막는지 안 적으면 고장으로 읽힌다").toContain("막지 않고");
  });

  it("아무것도 안 잰 상태면 줄을 만들지 않는다 — 빈 항목을 늘리지 않는다", () => {
    expect(말투현황줄()).toBeNull();
  });

  it("전부 지키면 지켰다고 말한다", () => {
    말투재기("q", "미조치 취약점은 14건입니다.");
    expect(말투현황줄()).toContain("모두 지킴");
  });

  it("기록이 무한히 쌓이지 않는다", () => {
    for (let i = 0; i < 260; i++) 말투재기(`q${i}`, "취약점 현황을 정리해 드리겠습니다.");
    expect(말투현황().위반, "상한 없이 쌓으면 메모리를 먹는다").toBeLessThanOrEqual(200);
  });

  it("이 시험이 헛돌고 있지 않다", () => {
    말투재기("q", "취약점 현황을 정리해 드리겠습니다.");
    expect(말투현황().위반, "감시가 아무것도 못 잡는다").toBe(1);
  });
});
