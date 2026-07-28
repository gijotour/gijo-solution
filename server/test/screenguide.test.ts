// 화면별 챗봇 가이드 — 도움말 의도 감지와 화면별 안내 텍스트를 검증.
// 실 데이터 질문("취약점 몇 건")은 도움말로 오인하지 않아야 한다(도구가 답해야 하므로).
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
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

  // 2026-07-28 실측: 구역 이름에 보기 좋으라고 넣은 가운뎃점("모델 받기 · 인증") 때문에
  // 담당자가 실제로 치는 "모델 받기 인증 뭐야?"가 안 걸려, LLM이 사내 문서에서 무관한
  // 반입 절차를 끌어와 답했다. 표기 기호는 무시하고 이름만 본다.
  it("구역 이름의 표기 기호(·)를 안 쳐도 그 구역 안내로 간다", () => {
    for (const q of ["모델 받기 인증 뭐야?", "모델받기인증 어떻게 써?", "허깅페이스 토큰 어디서 등록해?", "gated 모델 받는 법 알려줘"]) {
      expect(isHelpIntent(q, "settings.html"), q).toBe(true);
    }
    expect(formatScreenGuide("settings.html", "모델 받기 인증 뭐야?")).toContain("HuggingFace 토큰");
  });

  // 2026-07-28: "어떤 모델 받으면 좋아?"가 안 걸려 사내 문서에서 SBOM 라이브러리를 끌어와 답했다.
  it("고르는 말투('좋아?')도 그 구역 안내로 간다", () => {
    expect(isHelpIntent("어떤 모델 받으면 좋아?", "settings.html")).toBe(true);
    expect(formatScreenGuide("settings.html", "어떤 모델 받으면 좋아?")).toContain("추천 에이전트");
    // 구역 이름이 없으면 말투만으로는 화면 안내가 열리지 않는다(도구·대화가 처리해야 한다)
    expect(isHelpIntent("이 취약점 어떻게 고치면 좋아?", "settings.html")).toBe(false);
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

// 구역을 기본으로 접게 되면서(2026-07-27) 담당자는 화면에 보이는 글자 그대로 물어본다.
// 안내(panels) 이름과 화면 구역 이름이 다른 곳은 별명표(PANEL_ALIASES)가 이어 준다.
describe("screenguide — 화면에 적힌 구역 이름으로 물어도 찾는다", () => {
  it("위협 인텔: '구독 중인 CTI 피드' → '피드 구독' 설명", () => {
    expect(isHelpIntent("구독 중인 CTI 피드 어디 있어?", "threat.html")).toBe(true);
    const out = formatScreenGuide("threat.html", "구독 중인 CTI 피드 어디 있어?");
    expect(out).toContain("피드 구독");
    expect(out).toContain("벤더명");
  });

  it("유지보수: '유지보수 일정 · 점검서 · 승인' → '점검 승인' 설명", () => {
    const out = formatScreenGuide("opsguide.html", "유지보수 일정 · 점검서 · 승인 어떻게 써?");
    expect(out).toContain("점검 승인");
  });

  it("설정: '이메일(SMTP) 설정' → 'SMTP' 설명", () => {
    const out = formatScreenGuide("settings.html", "이메일(SMTP) 설정 어떻게 해?");
    expect(out).toContain("SMTP");
  });

  it("별명이 없는 화면·이름은 예전처럼 전체 안내로 떨어진다", () => {
    const out = formatScreenGuide("threat.html", "없는구역이름 알려줘");
    expect(out).toContain("이 화면 사용 안내");
  });
});

// 화면을 열면 대시보드 대화가 이 라우트로 안내를 받아 띄운다(ⓘ 아이콘 대체, 2026-07-27).
// LLM을 거치지 않으므로 응답이 매번 같고 빨라야 한다.
describe("screenguide — /api/screen-guide 라우트", () => {
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    app = createApp();
    const res = await request(app).post("/api/auth/login").send({ username: "jyh", password: "changeme" });
    token = res.body.accessToken as string;
  });

  it("화면 이름을 주면 그 화면 안내를 그대로 준다", async () => {
    const res = await request(app).get("/api/screen-guide?screen=assethub.html").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe(getScreenGuide("assethub.html").title);
    expect(res.body.text).toBe(formatScreenGuide("assethub.html"));
  });

  it("구역 이름을 함께 주면 그 구역 설명만 준다", async () => {
    const res = await request(app)
      .get("/api/screen-guide?screen=assethub.html&question=" + encodeURIComponent("표시 이름은 어떻게 바꿔?"))
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.text).toContain("표시 이름");
    expect(res.body.text).not.toContain("파일별 보기 —");
  });

  it("인증 없이는 열리지 않는다", async () => {
    const res = await request(app).get("/api/screen-guide?screen=assethub.html");
    expect(res.status).toBe(401);
  });
});
