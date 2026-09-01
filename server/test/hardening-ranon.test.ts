// 하드닝 — **점검하지 않은 장비를 점검했다고 적지 않는다** (2026-09-01 · 대장 §5)
//
// 왜: `runHardeningScan`은 러너를 `opts.run ?? defaultRunnerFor(...)`로 정하는데 `target`은
// **사람이 적은 표시용 글자**일 뿐이라 둘 사이에 아무 관계가 없었다. 그런데 보고서는 그 글자를
// 「대상 장비」라 부르고 점검 방식을 **조건 없이** 「장비 CLI 원격 점검」이라 단정했다.
// → 라벨만 주고 러너를 안 준 경로(챗봇 도구·화면 라우트)에서는 **서버 자신을 점검해 놓고
//   남의 장비를 점검했다고 쓰는 문서**가 만들어졌고, 그 마크다운은 내 문서로 저장돼
//   **증적으로 굳는다**. 준수율 보고에 쓰이면 거짓 보고가 된다.
//
// 고친 방식: 원격 실행을 새로 붙이지 않고(그건 파일럿 전제), **「어디서 돌았나」를 값(ranOn)으로
// 만들어 표기가 그 값만 읽게** 했다. 판정 근거는 라벨이 아니라 **러너를 받았는가**다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const 소스 = readFileSync(join(__dirname, "..", "src", "engine", "hardeningscan.ts"), "utf8");

describe("어디서 돌았나를 값으로 갖는다", () => {
  it("★ 보고서에 ranOn 칸이 있다(소비자보다 생산자를 먼저)", () => {
    expect(소스, "ranOn 선언이 없다").toMatch(/ranOn:\s*"self"\s*\|\s*"remote"/);
  });

  // ⚠⚠ **이 시험이 결함을 못 박고 있었다**(2026-09-01 검토관 [상]).
  //   「러너를 받았는가(opts.run)」를 근거로 삼으라고 시험이 요구했는데, runnerFor는
  //   authMethod="local" 대상에도 **로컬 러너**를 돌려주므로 opts.run이 채워진다.
  //   그래서 접속조차 안 한 점검이 「원격 점검」으로 기록됐다 — 시험이 그것을 지키고 있었다.
  //   ★ 소스 문자열만 보는 시험의 한계다. 이제 **부르는 쪽이 말한다**로 바꾸고,
  //     아래에서 **실제 실행 경로**를 태워 확인한다(문자열 감시로는 원리상 못 잡는다).
  it("★★ 판정 근거는 **부르는 쪽이 말한 ranOn**이다 — 러너를 받았는지가 아니다", () => {
    const i = 소스.indexOf("const ranOn");
    expect(i, "ranOn을 만드는 자리가 없다").toBeGreaterThan(-1);
    const 한줄 = 소스.slice(i, 소스.indexOf(String.fromCharCode(10), i));
    expect(한줄, "opts.run으로 가르면 로컬 대상이 원격으로 찍힌다").not.toContain("opts.run");
    expect(한줄, "부르는 쪽의 말을 안 쓴다").toContain("opts.ranOn");
    expect(한줄, "모를 때 remote로 기울면 안 된다 — 덜 주장하는 쪽이 안전하다").toContain(String.fromCharCode(34) + "self" + String.fromCharCode(34));
    expect(한줄, "target(라벨)으로 가르면 거짓이 된다").not.toContain("target");
  });

  it("보고서에 실어 보낸다(만들고 안 실으면 소비자가 못 읽는다)", () => {
    const i = 소스.indexOf("standardLabel: std.label");
    expect(소스.slice(i, i + 200), "반환에 ranOn이 없다").toContain("ranOn");
  });
});

describe("거짓을 적던 자리가 ranOn만 읽는다", () => {
  it("★ 「점검 방식」을 **조건 없이** 원격이라 적지 않는다", () => {
    // 옛 판: L.push(`- 점검 방식: 장비 CLI 원격 점검(실 명령 실행·실측)`) — 늘 원격이라 단정.
    const i = 소스.indexOf("점검 방식:");
    expect(i, "점검 방식 줄이 없다").toBeGreaterThan(-1);
    const 둘레 = 소스.slice(Math.max(0, i - 300), i + 300);
    expect(둘레, "ranOn을 안 보고 적는다").toContain("ranOn");
  });

  it("★ 「대상 장비」를 ranOn 없이 단정하지 않는다", () => {
    const i = 소스.indexOf("대상 장비:");
    expect(i, "대상 장비 줄이 없다").toBeGreaterThan(-1);
    expect(소스.slice(Math.max(0, i - 400), i + 200), "ranOn을 안 보고 적는다").toContain("ranOn");
  });

  it("★★ 자기 자신을 점검했으면 **적어 준 이름은 점검하지 않았다고 말한다**", () => {
    // 이름표만 남는다는 사실을 밝히지 않으면, 담당자는 그 장비가 점검된 줄 안다.
    expect(소스, "이름표뿐이라는 사실을 안 밝힌다").toContain("점검하지 않았습니다");
    expect(소스, "이 서버 자신을 점검했다는 말이 없다").toContain("이 서버 자신");
  });

  it("꼬리말도 어디서 돌았는지에 따라 달라진다", () => {
    const i = 소스.indexOf("본 리포트는");
    expect(i, "꼬리말이 없다").toBeGreaterThan(-1);
    expect(소스.slice(i, i + 300), "꼬리말이 늘 「대상 장비 CLI에서」라고 적는다").toContain("ranOn");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★ 2026-09-01 검토관 [상] — 위 시험들은 **전부 소스 문자열 grep**이라
//    실제 실행 경로를 한 번도 안 태웠다. 그래서 authMethod="local" 대상이
//    로컬 러너를 받고도 「원격 점검」으로 기록되던 것을 **원리상 못 잡았다.**
//    문자열 감시는 「적혀 있는가」를 볼 뿐 「도는가」를 못 본다.
// ─────────────────────────────────────────────────────────────────────────────
describe("★★ 실제로 돌려서 확인한다 (문자열 감시가 못 보는 자리)", () => {
  it("원격점검인가 — local로 등록한 대상은 원격이 아니다", async () => {
    const { 원격점검인가 } = await import("../src/engine/hardeningscan");
    const 기본 = { id: "t1", label: "방화벽-01", standard: "kisa" } as never;
    expect(원격점검인가({ ...(기본 as object), authMethod: "local", host: "10.0.0.9" } as never),
      "authMethod=local인데 원격이라 한다").toBe(false);
    expect(원격점검인가({ ...(기본 as object), authMethod: "key", host: "local" } as never),
      "host=local인데 원격이라 한다").toBe(false);
    expect(원격점검인가({ ...(기본 as object), authMethod: "key", host: "10.0.0.9" } as never),
      "진짜 원격을 로컬이라 한다").toBe(true);
  });

  it("★★ ranOn을 안 주면 **self**다 — 모르면 덜 주장한다", async () => {
    const { runHardeningScan } = await import("../src/engine/hardeningscan");
    // 러너를 주되 ranOn은 말하지 않는다. 예전 로직이면 이것만으로 remote가 됐다.
    const r = await runHardeningScan({
      standard: "kisa",
      target: "방화벽-01",
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
      skipWorkLog: true,
    });
    expect(r.ranOn, "러너를 받았다는 이유로 원격이라 단정했다 — 접속조차 안 했을 수 있다").toBe("self");
  });

  it("ranOn: remote를 명시하면 그대로 원격이다", async () => {
    const { runHardeningScan } = await import("../src/engine/hardeningscan");
    const r = await runHardeningScan({
      standard: "kisa",
      target: "방화벽-01",
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
      ranOn: "remote",
      skipWorkLog: true,
    });
    expect(r.ranOn).toBe("remote");
  });

  it("★ 감사 기록에 적을 대상 — self면 **장비 이름만 남기지 않는다**", async () => {
    const { 감사대상글 } = await import("../src/engine/hardeningscan");
    const self글 = 감사대상글({ target: "방화벽-01", ranOn: "self" });
    expect(self글, "붙지도 않은 장비 이름만 남으면 그것이 증적이 된다").not.toBe("방화벽-01");
    expect(self글, "이 서버를 점검했다는 사실이 없다").toContain("이 서버 자신");
    expect(self글, "사람이 적은 이름표를 잃으면 어느 점검인지 못 찾는다").toContain("방화벽-01");
    expect(감사대상글({ target: "방화벽-01", ranOn: "remote" }), "진짜 원격은 그대로 장비 이름")
      .toBe("방화벽-01");
  });
});
