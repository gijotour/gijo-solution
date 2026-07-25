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

  // 2026-07-26 실사용 사고: 벤더 제품을 물었는데 대시보드 사용 안내가 돌아왔다.
  // "기능 설명"만 걸린 약한 신호였고, 제품 이름이라는 분명한 대상이 함께 있었다.
  it("특정 제품·파일을 집어 물으면 화면 안내로 가로채지 않는다", () => {
    for (const q of [
      "Tenable Web App Scanning 주요기능 설명해줘",
      "FOCS 메뉴얼 ver1 2 기능 알려줘",
      "Tenable_Security_Center-User_Guide.pdf 기능 설명",
      "CVE-2021-44228 기능 설명해줘",
    ]) {
      expect(isHelpIntent(q, "dashboard.html"), q).toBe(false);
    }
  });

  it("화면을 가리키면 제품 이름이 섞여 있어도 화면 안내다", () => {
    expect(isHelpIntent("이 화면에서 Tenable 결과 어떻게 봐?", "dashboard.html")).toBe(true);
    expect(isHelpIntent("여기 사용법 알려줘", "dashboard.html")).toBe(true);
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

// 화면 가독성 개편(2026-07-23): 화면 상시 노출 설명을 panels로 이관 — 패널 이름을 물으면 상세만 답한다.
describe("패널 단위 상세 안내", () => {
  it("질문에 패널 이름이 있으면 그 상세만 답한다", async () => {
    const { formatScreenGuide } = await import("../src/engine/screenguide");
    const out = formatScreenGuide("settings.html", "SMTP 설정 방법 알려줘");
    expect(out).toContain("설정 › SMTP");
    expect(out).toContain("암호화 저장");
    expect(out).not.toContain("이 화면에서 챗봇으로 할 수 있는 것");
  });

  it("패널 이름이 없으면 전체 안내 + 구역 목차를 준다", async () => {
    const { formatScreenGuide } = await import("../src/engine/screenguide");
    const out = formatScreenGuide("settings.html", "이 화면 뭐 할 수 있어?");
    expect(out).toContain("구역별 상세");
    expect(out).toContain("구동 티어");
  });
});

// 패널 이름으로 물어도 화면 가이드가 답하는지 — "기능 설명은 챗봇이 담당" 원칙(2026-07-25 사용자 지시).
// 실측 배경: "표시 이름은 어떻게 바꿔?"가 HELP_RE에 안 걸려 RAG로 새고 엉뚱한 벤더 매뉴얼로 답했다.
describe("패널 이름 기반 도움말 의도", () => {
  it("패널명 + 설명 요구 말투면 도움말로 인정한다(현재 화면 기준)", () => {
    expect(isHelpIntent("표시 이름은 어떻게 바꿔?", "assethub.html")).toBe(true);
    expect(isHelpIntent("진행내역 리포트가 뭐야?", "assethub.html")).toBe(true);
    expect(isHelpIntent("파일별 보기 사용법 알려줘", "assethub.html")).toBe(true);
  });

  it("해당 화면에 없는 패널명이면 인정하지 않는다", () => {
    expect(isHelpIntent("표시 이름은 어떻게 바꿔?", "kpi.html")).toBe(false);
  });

  it("패널명이 있어도 설명 요구가 아니면 도구가 처리하게 남긴다", () => {
    expect(isHelpIntent("표시 이름 목록 CSV로 내려줘", "assethub.html")).toBe(false);
  });

  it("화면을 모르면 기존 HELP_RE만 적용된다", () => {
    expect(isHelpIntent("사용법 알려줘")).toBe(true);
    expect(isHelpIntent("표시 이름은 어떻게 바꿔?")).toBe(false);
  });

  it("패널 상세를 물으면 그 패널 설명만 답한다", () => {
    const out = formatScreenGuide("assethub.html", "표시 이름은 어떻게 바꿔?");
    expect(out).toContain("표시 이름");
    expect(out).toContain("원래대로");
    expect(out).not.toContain("파일별 보기 —"); // 다른 패널 설명이 섞이지 않는다
  });
});
