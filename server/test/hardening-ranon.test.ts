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

  it("★★ 판정 근거는 **러너를 받았는가**다 — 라벨이 아니다", () => {
    // ⚠ **그 한 줄만** 본다 — 창을 넓게 잡으면 다음 줄(target 기본값)까지 읽어
    //   「라벨로 가른다」고 잘못 잡는다(이 시험을 처음 쓸 때 실제로 그랬다).
    const i = 소스.indexOf("const ranOn");
    expect(i, "ranOn을 만드는 자리가 없다").toBeGreaterThan(-1);
    const 한줄 = 소스.slice(i, 소스.indexOf(String.fromCharCode(10), i));
    expect(한줄, "opts.run으로 안 가른다").toContain("opts.run");
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
