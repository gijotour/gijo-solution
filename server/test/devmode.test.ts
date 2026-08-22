// 개발 모드 — **켜져 있으면 크게 말하고, 기본은 꺼져 있는가** (2026-08-23 신설)
//
// ■ 왜 생겼나 — 사장님 지시 「개발 동안 제약사항은 다 풀고 하자 · 등급도 개발 끝나면 지정」에
//   따라 등급 게이트를 끄는 스위치를 만들었다. 스위치 자체가 **가장 위험한 코드**다:
//   켜진 채 출하되면 기밀·민감 문서가 전원에게 열린다.
//
// ■ 이 시험이 지키는 것
//   ① **기본은 꺼짐** — env가 없거나 "1"이 아니면 꺼져 있다
//   ② **환경변수로만** 켜진다 — 화면·API로 켤 수 있는 길이 없다
//   ③ 켜지면 **자가 진단이 말한다** — 조용히 켜져 있는 것이 가장 나쁘다
//   ④ 등급 **원래 규칙**은 그대로 살아 있다(canReadStrict) — 개발 모드가 규칙을 지운 게 아니다
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { 개발모드 } from "../src/util/devmode";
import { canRead, canReadStrict, blockedGrades } from "../src/engine/grades";

const 서버루트 = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const 원래 = process.env.GIJO_DEV_MODE;
afterEach(() => {
  if (원래 === undefined) delete process.env.GIJO_DEV_MODE;
  else process.env.GIJO_DEV_MODE = 원래;
});

describe("★ 개발 모드 — 켜기는 어렵고 보이기는 쉬워야 한다", () => {
  it("★★ 기본은 **꺼짐** — env가 없으면 등급이 그대로 막는다", () => {
    delete process.env.GIJO_DEV_MODE;
    expect(개발모드(), "환경변수가 없는데 켜져 있다").toBe(false);
    expect(canRead("O", "C"), "공개 등급이 기밀을 읽는다 — 통제가 없는 것이다").toBe(false);
    expect(blockedGrades("O"), "공개 등급이 막히는 것이 없다").toContain("C");
  });

  it("★ \"1\"이 아닌 값으로는 안 켜진다 — 실수로 켜지지 않게", () => {
    for (const v of ["", "0", "true", "yes", "on", "TRUE", " 1"]) {
      process.env.GIJO_DEV_MODE = v;
      expect(개발모드(), `GIJO_DEV_MODE=${JSON.stringify(v)}로 켜졌다`).toBe(false);
    }
  });

  it("★★ 켜면 등급이 안 막는다 — 지시대로", () => {
    process.env.GIJO_DEV_MODE = "1";
    expect(개발모드()).toBe(true);
    expect(canRead("O", "C"), "개발 모드인데 기밀이 막힌다").toBe(true);
    expect(blockedGrades("O"), "개발 모드인데 막히는 등급이 있다").toEqual([]);
  });

  it("★★ 원래 규칙은 **지워지지 않았다** — 출하 때 되돌릴 것이 없어야 한다", () => {
    process.env.GIJO_DEV_MODE = "1";
    // canReadStrict는 개발 모드를 무시한다 — 규칙 자체가 살아 있다는 증거.
    expect(canReadStrict("O", "C"), "등급 규칙이 통째로 사라졌다").toBe(false);
    expect(canReadStrict("C", "C")).toBe(true);
    expect(canReadStrict("S", "O")).toBe(true);
  });

  it("★★ 화면·API로는 못 켠다 — 환경변수가 유일한 통로", () => {
    const 소스 = fs.readFileSync(path.join(서버루트, "src", "util", "devmode.ts"), "utf8");
    expect(소스, "환경변수 말고 다른 통로가 생겼다").toMatch(/process\.env\.GIJO_DEV_MODE === "1"/);
    // 라우트·DB에서 읽어 켜는 길이 생기면 통제가 아니다.
    expect(소스, "app_state·DB에서 읽어 켜는 길이 생겼다").not.toMatch(/db\.|app_state|prepare\(/);
    expect(소스, "라우트로 켜는 길이 생겼다").not.toMatch(/app\.(get|post|put)/);
  });

  it("★★ 켜지면 **자가 진단이 말한다** — 조용히 켜져 있으면 안 된다", () => {
    const 상태 = fs.readFileSync(path.join(서버루트, "src", "engine", "dbcrypt.ts"), "utf8");
    expect(상태, "자가 진단이 개발 모드를 안 싣는다").toMatch(/devMode/);
    expect(상태, "사람이 읽는 경고 문구가 없다").toMatch(/개발 모드.*켜져 있습니다|GIJO_DEV_MODE=1.*켜져/);
    const 부팅 = fs.readFileSync(path.join(서버루트, "src", "index.ts"), "utf8");
    expect(부팅, "부팅 때 경고를 안 한다").toMatch(/개발모드경고\(\)/);
  });
});
