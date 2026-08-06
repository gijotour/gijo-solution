// 시연용 데이터가 섞여 있으면 **숫자를 말할 때 밝힌다**.
//
// 왜 필요한가(2026-08-03 실측): 운영 서버의 취약점 14건이 **전부 `demo-scan.csv`**에서 왔는데
//   자산 출처는 `scanner`로 찍혀 있어 실제 스캔 결과와 구분되지 않았다.
//   담당자가 "우리 망에 Log4Shell이 있다"고 읽으면 **없는 사고를 쫓게 된다.**
//
// ⚠ 지우지도 숨기지도 않기로 했다(사용자 결정 2026-08-03):
//   지우면 시연·시험 기준선이 무너지고, 숨기면(origin=sample) 화면 기본 목록에서 사라져
//   지운 것과 같아진다. 남겨 두되 **말할 때 밝힌다.**
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { 시연데이터알림 } from "../src/engine/agenttools";
import { agenttoolsSource } from "./util/toolsrc";

const 시연 = { source_tool: "demo-scan.csv", finding_type: "cve" };
const 실제 = { source_tool: "tenable", finding_type: "cve" };
const 스캔실패 = { source_tool: "modelscan", finding_type: "scan_error" };

describe("섞여 있으면 밝힌다", () => {
  it("전부 시연이면 「전부」라고 말한다", () => {
    const out = 시연데이터알림([시연, 시연, 시연]);
    expect(out).toContain("전부");
    expect(out, "실제 스캔이 아니라는 말이 없다").toContain("실제 스캔 결과가 아닙니다");
  });

  it("일부만 시연이면 **몇 건 중 몇 건**인지 말한다", () => {
    const out = 시연데이터알림([시연, 시연, 실제, 실제, 실제]);
    expect(out).toContain("5건 중 2건");
  });

  it("★ 스캔 실패는 세지 않는다 — 취약점이 아니다", () => {
    // 스캔 실패 609건이 분모에 들어가면 "609건 중 14건"이 되어 뜻이 달라진다.
    const out = 시연데이터알림([시연, 스캔실패, 스캔실패, 스캔실패]);
    expect(out).toContain("전부");
    expect(out, "스캔 실패를 취약점으로 셌다").not.toContain("4건");
  });
});

describe("★ 안 섞여 있으면 아무 말도 안 붙인다 — 늘 붙는 단서는 아무도 안 읽는다", () => {
  it("실제 스캔만 있으면 빈 문자열", () => {
    expect(시연데이터알림([실제, 실제])).toBe("");
  });
  it("아무것도 없으면 빈 문자열", () => {
    expect(시연데이터알림([])).toBe("");
    expect(시연데이터알림(undefined as never)).toBe("");
  });
  it("스캔 실패만 있으면 빈 문자열", () => {
    expect(시연데이터알림([스캔실패, 스캔실패])).toBe("");
  });
});

describe("★ 숫자를 말하는 곳에 실제로 붙어 있다 — 소스 감시", () => {
  it("오늘 할 일과 취약점 현황 둘 다 부른다", () => {
    const s = agenttoolsSource();
    const 부른수 = (s.match(/시연데이터알림\(/g) ?? []).length;
    // 정의 1 + 부르는 곳 2 이상
    expect(부른수, "만들어 놓고 아무 데서도 안 부른다 — 담당자에겐 없는 기능이다").toBeGreaterThanOrEqual(3);
  });

  it("이 감시가 헛돌고 있지 않다", () => {
    expect(시연데이터알림([시연]).length, "알림 자체가 죽었다").toBeGreaterThan(10);
  });
});
