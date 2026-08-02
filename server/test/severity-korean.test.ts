// 심각도·상태를 **사람에게는 우리말로** — 소스 감시.
//
// 왜 소스를 보는가: 동작 QA는 "답이 나왔다"만 본다. `[critical]`이 섞여 나가도 답은 나온다.
//   실측(2026-08-03): 영문 심각도가 담당자 화면에 나가는 자리가 **여덟 곳**이었다 —
//   오늘 할 일 · 자산 상세 · 검색 · 조치 검증 · 하드닝 · 체크목록 라벨 ….
//   자리마다 따로 만들면 어떤 화면은 "critical", 어떤 화면은 "매우 심각"이 되어 같은 것이 둘로 보인다.
//
// ⚠ 이 감시는 **화면에 나가는 글자만** 본다. 저장·매칭·해시는 영문 그대로여야 한다
//   (승인키가 심각도를 해시에 넣는다 — 바꾸면 예전 결재가 전부 깨진다).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 심각도한글, 심각도표식, 표식 } from "../src/engine/tone";

const 소스 = fs.readFileSync(path.join(__dirname, "../src/engine/agenttools.ts"), "utf8");

describe("심각도 우리말 변환기", () => {
  it("네 등급을 우리말로 준다", () => {
    expect(심각도한글("critical")).toBe("매우 심각");
    expect(심각도한글("high")).toBe("높음");
    expect(심각도한글("medium")).toBe("보통");
    expect(심각도한글("low")).toBe("낮음");
  });

  it("★ 모르는 값은 **지어내지 않고** 그대로 돌려준다", () => {
    expect(심각도한글("unknown-xyz")).toBe("unknown-xyz");
    expect(심각도한글("")).toBe("");
  });

  it("표식이 사다리 순서와 맞는다", () => {
    expect(심각도표식("critical")).toBe(표식.위험);
    expect(심각도표식("high")).toBe(표식.높음);
    expect(심각도표식("medium")).toBe(표식.보통);
    expect(심각도표식("low")).toBe(표식.안전);
    expect(심각도표식("모름"), "모르는 값에 위험 표식을 붙이면 거짓 경보다").toBe("·");
  });
});

describe("★ 소스 감시 — 화면에 나가는 글자에 영문 심각도가 없다", () => {
  it("답변 문자열에 [${...severity}]를 직접 끼워 넣는 곳이 없다", () => {
    // `[${f.severity}]` 꼴 — 변환을 안 거치고 영문을 그대로 대괄호에 넣는 형태.
    const 걸린것 = [...소스.matchAll(/`[^`]*\[\$\{[^}]*\.severity\}\][^`]*`/g)].map((m) => m[0].slice(0, 90));
    expect(
      걸린것,
      `영문 심각도를 그대로 화면에 내보내는 곳이 있다 — 심각도한글()을 거칠 것:\n  ${걸린것.join("\n  ")}`
    ).toEqual([]);
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    // 소스를 못 읽었거나 정규식이 죽었으면 위 시험은 조용히 통과한다.
    expect(소스.length, "agenttools.ts를 못 읽었다").toBeGreaterThan(50000);
    expect(소스, "변환기를 아무도 안 쓴다 — 그럼 위 감시는 의미가 없다").toContain("심각도한글(");
    // 감시가 실제로 잡는지 — 일부러 만든 나쁜 예를 넣어 본다.
    const 나쁜예 = "const x = `  - [${f.severity}] ${f.finding_type}`;";
    expect([...나쁜예.matchAll(/`[^`]*\[\$\{[^}]*\.severity\}\][^`]*`/g)].length, "감시 정규식이 죽었다").toBe(1);
  });
});
