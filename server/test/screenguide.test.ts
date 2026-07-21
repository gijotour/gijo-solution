// 화면별 챗봇 가이드 — 도움말 의도 감지와 화면별 안내 텍스트를 검증.
// 실 데이터 질문("취약점 몇 건")은 도움말로 오인하지 않아야 한다(도구가 답해야 하므로).
import { describe, it, expect } from "vitest";
import { isHelpIntent, getScreenGuide, formatScreenGuide } from "../src/engine/screenguide";

describe("screenguide — 도움말 의도 감지", () => {
  it("도움말성 질문은 감지한다", () => {
    for (const q of [
      "이 화면 뭐 할 수 있어?",
      "이 화면에서 뭐 할 수 있어?",
      "여기서 뭐 할 수 있어?",
      "사용법 알려줘",
      "이거 어떻게 써?",
      "도움말",
      "이 메뉴 기능 설명해줘",
      "가이드 보여줘",
    ]) {
      expect(isHelpIntent(q), q).toBe(true);
    }
  });

  it("구체 데이터 질문은 도움말로 오인하지 않는다", () => {
    for (const q of [
      "미조치 Critical 몇 건이야?",
      "KEV 있는 거 있어?",
      "하드닝 점검해줘",
      "자산 목록 보여줘",
      "다음 정기 리포트 언제야?",
    ]) {
      expect(isHelpIntent(q), q).toBe(false);
    }
  });
});

describe("screenguide — 화면별 가이드", () => {
  it("화면을 알면 그 화면 전용 가이드를 준다", () => {
    const g = getScreenGuide("vulnscan.html");
    expect(g.title).toContain("취약점");
    expect(g.can.length).toBeGreaterThan(0);
    const txt = formatScreenGuide("vulnscan.html");
    expect(txt).toContain("취약점");
    expect(txt).toContain("이 화면에서 챗봇으로 할 수 있는 것");
  });

  it("경로째 와도(pages/hardening.html) 파일명으로 해석한다", () => {
    expect(getScreenGuide("pages/hardening.html").title).toContain("하드닝");
    expect(getScreenGuide("/hardening.html").title).toContain("하드닝");
  });

  it("화면을 모르면 전체 개요를 준다", () => {
    expect(getScreenGuide(undefined).title).toContain("사용 안내");
    expect(getScreenGuide("nonexistent.html").title).toContain("사용 안내");
  });

  it("하드닝 화면 가이드는 4종 점검 기준을 안내한다", () => {
    const txt = formatScreenGuide("hardening.html");
    expect(txt).toContain("PC 점검");
    expect(txt).toContain("네트워크 장비");
    expect(txt).toContain("CIS");
  });
});
