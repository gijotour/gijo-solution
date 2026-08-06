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

  it("★★ [행동] 모델이 근거 0점 영역을 골라도 받지 않는다 — 실제 경로로 증명", async () => {
    // 검토관 지적(2026-08-07): 이 계약이 소스 문자열 검사로만 증명돼 있었다 — 리팩터링으로
    // 조건이 무력화돼도 글자만 남으면 초록이었다. **모킹한 LLM으로 실제 함수를 태운다.**
    const { categorizeDocument } = await import("../src/engine/memory");
    // ⚠ 실측 본문 그대로 쓴다 — 문장을 줄이면 동점이 깨져 **규칙이 스스로 확정**해 버려
    //   모델 경로(이 시험의 대상)에 아예 안 간다(처음에 그렇게 틀렸다).
    const 본문 = "방화벽 정책 변경 절차와 담당자 연락망입니다. 피싱 대응 절차도 함께 적어 둡니다. 정기 점검 주기는 분기 1회입니다.";
    // 실측 재현: 7B가 「취약점」이라 답한다 — 이 문서에 취약점 신호는 0점이므로 거부 → 일반
    chatMock.mockResolvedValueOnce("취약점");
    expect(await categorizeDocument("운영메모.md", 본문, true), "근거 없는 분류를 받았다").toBe("일반");
    // 근거가 있는 답은 받는다 — 피싱·대응 절차는 위협대응 신호가 있다
    chatMock.mockResolvedValueOnce("위협대응");
    expect(await categorizeDocument("운영메모.md", 본문, true)).toBe("위협대응");
    // 모델이 죽어도 인입은 계속된다 — 「일반」 폴백
    chatMock.mockRejectedValueOnce(new Error("모델 다운"));
    expect(await categorizeDocument("운영메모.md", 본문, true)).toBe("일반");
  });

  it("파일명이 분명하면 내용을 보지 않는다(기존 계약 유지)", () => {
    expect(categorizeByRules("2026-08 취약점 점검 결과.pdf", "아무 내용")).toBe("취약점");
    expect(categorizeByRules("개인정보 처리 지침.md", "아무 내용")).toBe("사내규정");
  });

  it("신호가 약하면 규칙은 확신하지 않는다 — 억지 분류가 오분류보다 나쁘다", () => {
    expect(categorizeByRules("회의록.md", "오늘 회의에서 일정과 담당자를 정했습니다.")).toBeNull();
  });
});
