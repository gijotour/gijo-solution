// 문서 업무영역 분류 — [2026-08-07 · 대량 반입 실측이 잡은 오분류]
//
// 실측: 「방화벽 정책 변경 절차 + 담당자 연락망 + 피싱 대응 절차」 메모 5건이 전부
//   **「취약점」으로 분류**됐다. 규칙은 확신을 못 해 넘겼고(정상), **7B가 틀렸다**.
//   분류가 틀리면 나중에 그 문서를 못 찾고, 화면별 검색 우선순위(soft boost)도 어긋난다.
//
// 계약 둘:
//   ① 흔한 보안 낱말(방화벽·피싱 등)은 **규칙이 스스로** 잡는다 — 모델을 부르는 횟수를 줄인다
//      (7B에 프롬프트 규칙을 더해 행동을 고치려는 시도는 이 저장소에서 반복 실패했다)
//   ② 모델이 고른 영역의 **신호가 0점이면 그 분류를 거부**하고 「일반」으로 둔다 —
//      모르는 것은 모른다고 두는 편이 틀린 이름표보다 낫다
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const chatMock = vi.fn();
vi.mock("../src/engine/llm", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, chat: (...a: unknown[]) => chatMock(...a) };
});

import { categorizeByRules } from "../src/engine/memory";

describe("규칙이 스스로 잡는 범위 — 흔한 보안 낱말", () => {
  it("★ 실측 문서: 방화벽·피싱 메모는 「취약점」으로 가지 않는다", () => {
    const 본문 = "방화벽 정책 변경 절차와 담당자 연락망입니다. 피싱 대응 절차도 함께 적어 둡니다. 정기 점검 주기는 분기 1회입니다.";
    const r = categorizeByRules("운영메모.md", 본문);
    expect(r, "취약점 신호가 하나도 없는데 취약점으로 분류됐다").not.toBe("취약점");
    // 이 문서는 장비운영(방화벽·정기 점검) 2점 : 위협대응(피싱·대응 절차) 2점 **동점**이다.
    // 규칙은 동점에서 확신하지 않는다(null) — 억지 분류가 오분류보다 나쁘다는 기존 계약 그대로.
    // 이때 LLM이 「취약점」이라 답해도 아래 신호 0점 거부가 막는다(다음 시험).
    expect(r).toBeNull();
  });

  it("★★ 신호가 0점인 영역은 분류로 받지 않는다 — 근거 없는 이름표 금지", () => {
    const 본문 = "방화벽 정책 변경 절차와 담당자 연락망입니다. 피싱 대응 절차도 함께 적어 둡니다.";
    // 실측에서 7B가 고른 답이 바로 이것이었다 — 그런데 이 문서에 취약점 신호는 0점이다.
    const src = readFileSync(join(__dirname, "..", "src", "engine", "memory.ts"), "utf8");
    expect(src, "모델 답을 그대로 받으면 근거 없는 분류가 들어온다").toContain("분류 거부");
    expect(src).toMatch(/categorySignalScores\(text\)[\s\S]{0,80}\[고른것\] === 0/);
    // 신호 계산이 실제로 0인지도 확인(거부가 발동할 조건이 맞는지)
    expect(본문.match(/취약점|CVE-\d{4}|CVSS|위험도|스캔|패치|익스플로잇|EPSS|KEV/g)).toBeNull();
  });

  it("파일명이 분명하면 내용을 보지 않는다(기존 계약 유지)", () => {
    expect(categorizeByRules("2026-08 취약점 점검 결과.pdf", "아무 내용")).toBe("취약점");
    expect(categorizeByRules("개인정보 처리 지침.md", "아무 내용")).toBe("사내규정");
  });

  it("신호가 약하면 규칙은 확신하지 않는다 — 억지 분류가 오분류보다 나쁘다", () => {
    expect(categorizeByRules("회의록.md", "오늘 회의에서 일정과 담당자를 정했습니다.")).toBeNull();
  });
});
