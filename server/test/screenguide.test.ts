// 화면별 챗봇 가이드 — 도움말 의도 감지와 화면별 안내 텍스트를 검증.
// 실 데이터 질문("취약점 몇 건")은 도움말로 오인하지 않아야 한다(도구가 답해야 하므로).
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { isHelpIntent, getScreenGuide, formatScreenGuide } from "../src/engine/screenguide";
import { isMyWorkAsk } from "../src/engine/picklist";
import fs from "node:fs";

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

  // 이름이 포개지는 구역은 **더 구체적인 쪽**이 이겨야 한다. 선언 순서로 고르면 짧은 이름이
  // 긴 이름을 가려, "담당자 2차 인증 해제하는 방법"에 내 계정 안내가 나왔다(2026-07-30 실측).
  it("이름이 포개질 때 더 구체적인 구역이 이긴다", () => {
    const out = formatScreenGuide("settings.html", "담당자 2차 인증 해제하는 방법");
    expect(out).toContain("계정별 2차 인증");
    expect(out).toContain("감사 기록"); // 관리자 해제 안내가 실제로 실렸는지
  });

  it("짧은 이름만 물으면 그쪽이 답한다(구체적 이름 우선이 반대로 새지 않는다)", () => {
    const out = formatScreenGuide("settings.html", "2차 인증 사용법 알려줘");
    expect(out).toContain("설정 › 2차 인증");
    expect(out).toContain("인증앱");
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

  // 곤란을 털어놓는 말투도 안내를 구하는 것이다 — "복구 코드 잃어버렸어"에 일반 LLM이
  // "지원 센터에 문의하세요"라고 답했다(2026-07-30 실측). 폐쇄망 제품에 지원 센터는 없다.
  it("곤란 말투(잃어버렸어·안 보여)도 구역 이름이 걸리면 안내로 본다", () => {
    expect(isHelpIntent("복구 코드 잃어버렸어", "settings.html")).toBe(true);
    expect(isHelpIntent("2차 인증 막혔어", "settings.html")).toBe(true);
  });

  it("⚠ 구역 이름이 없는 하소연은 여전히 도구·LLM 몫이다(안내로 가로채지 않는다)", () => {
    expect(isHelpIntent("스캔 실패했어", "settings.html")).toBe(false);
    expect(isHelpIntent("서버가 안 보여", "kpi.html")).toBe(false);
    expect(isHelpIntent("자산을 못 찾겠어", "assethub.html")).toBe(false);
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

// ── 강제 도구 라우팅: 스케줄 조회 vs 절차 질문 ──────────────────────────────
// 실사고(2026-07-31 QA-M04 재발): "방화벽 월간 정기점검 **절차를 알려줘**"가 하드닝 스케줄
// 조회 도구로 새어 "등록된 스케줄이 없습니다"가 돌아왔다. 담당자는 점검일 아침에 그렇게 묻는데
// 절차 대신 빈 스케줄을 받았다. 원인은 `정기점검.{0,6}알려`가 절차 질문까지 삼킨 것.
// 이 갈림은 좁혔다 넓혔다를 반복한 자리라(2026-07-29에도 한 번) 양방향을 못으로 박는다.
describe("정기점검 — 스케줄 조회와 절차 질문을 가른다", () => {
  const RE = /^(?!.*(절차|방법|항목|순서|단계|체크\s*리스트|어떻게\s*하))(?:.*(?:(원격|하드닝|정기)\s*점검\s*(스케줄|일정|주기)|정기점검.{0,6}(언제|어떻게|확인|알려|보여)|(원격|하드닝)\s*점검.{0,4}자동.{0,6}(돌|실행|되)))/;

  it("스케줄·주기를 묻는 말은 조회 도구로 간다", () => {
    for (const q of [
      "원격 정기점검 스케줄 어떻게 되어 있어?",
      "정기점검 언제야?",
      "정기점검 일정 보여줘",
      "하드닝 점검 스케줄 확인",
      "원격 점검 자동으로 돌아가?",
    ]) expect(RE.test(q), `조회로 가야 한다: ${q}`).toBe(true);
  });

  it("⚠ 절차·방법을 묻는 말은 삼키지 않는다 — 이쪽이 재발한 지점이다", () => {
    for (const q of [
      "방화벽 월간 정기점검 절차를 알려줘",
      "정기점검 방법 알려줘",
      "정기점검 항목이 뭐야",
      "월간 점검 순서 알려줘",
      "정기점검 어떻게 하는지 알려줘",
      "정기점검 체크리스트 알려줘",
    ]) expect(RE.test(q), `절차 질문을 삼키면 안 된다: ${q}`).toBe(false);
  });

  // 절차 질문을 지식(explain)으로 잇는 규칙. 처음엔 넓게 잡았다가 회귀 하네스 kisa-u01
  // ("리눅스 SSH root 로그인 차단은 KISA 어떤 **점검항목**이야?")을 삼켜 U-01 답이 사라졌다
  // (2026-07-31). 주기어(정기·월간…)나 '유지보수'가 함께 있을 때만 잡도록 좁혔다.
  const PROC = /((정기|월간|주간|분기|연간)\s*점검|유지보수(\s*점검)?)\s*.{0,8}(절차|방법|순서|단계|항목|체크\s*리스트)|(점검|유지보수)\s+(절차|방법|순서|단계|체크\s*리스트)/;

  it("절차 질문은 지식 경로로 잇는다", () => {
    for (const q of ["방화벽 월간 정기점검 절차를 알려줘", "정기점검 방법 알려줘", "유지보수 점검 항목 뭐야", "분기 점검 체크리스트"])
      expect(PROC.test(q), `지식으로 가야 한다: ${q}`).toBe(true);
  });

  it("⚠ 하드닝 기준 코드·스케줄 질문은 삼키지 않는다 — 실제로 깨졌던 자리다", () => {
    for (const q of [
      "리눅스 SSH root 원격 로그인 차단은 KISA 어떤 점검항목이야?", // 회귀 하네스 kisa-u01
      "U-01 점검항목 뭐야",
      "CIS 점검항목 알려줘",
      "정기점검 언제야?",
      "하드닝 점검 실행해줘",
    ]) expect(PROC.test(q), `삼키면 안 된다: ${q}`).toBe(false);
  });

  it("제품 코드가 이 규칙을 실제로 쓴다 — 시험만 맞고 코드가 다르면 소용없다", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "engine", "agentloop.ts"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toContain("정기|월간|주간|분기|연간");
    expect(code).toContain("hardening_schedule_list");
  });
});

describe("★ 화면 설명을 물으면 화면 설명이 나온다 — 자료를 쏟지 않는다", () => {
  // 챗봇 전수 점검(2026-08-01)에서 잡힌 두 자리.
  //   · "여기 내 업무 화면은 뭐 하는 곳이야?" → 남은 일 4건이 쏟아졌다
  //   · "여기 보안 KPI 화면은 뭐 하는 곳이야?" → KPI 숫자가 쏟아졌다
  // 답 자체는 멀쩡해서 길이·폴백·누출 검사를 전부 통과한다. **물은 것과 다른 답**이라는 게
  // 문제고, 담당자에겐 그게 곧 "안 직관적인 화면"이다.
  it("영문 섞인 화면 이름도 화면 질문으로 잡는다", () => {
    // 앞 가지가 [가-힣]{2,10}이라 KPI·AI-BOM·CLI를 못 받았다.
    expect(isHelpIntent("여기 보안 KPI 화면은 뭐 하는 곳이야?", "kpi.html")).toBe(true);
    expect(isHelpIntent("여기 AI-BOM 화면은 뭐 하는 곳이야?", "sbom.html")).toBe(true);
    expect(isHelpIntent("여기 터미널 (CLI) 화면은 뭐 하는 곳이야?", "terminal.html")).toBe(true);
  });

  it("★ 화면을 안 물은 질문은 여전히 안 걸린다 — 넓히다 새면 안 된다", () => {
    // 낱말 「화면」을 요구하므로 2026-07-26 사고(벤더 제품 질문이 화면 안내로 샘)는 재발하지 않는다.
    expect(isHelpIntent("Tenable Web App Scanning 주요기능 설명해줘", "dashboard.html")).toBe(false);
    expect(isHelpIntent("미조치 취약점 알려줘", "vulnscan.html")).toBe(false);
    expect(isHelpIntent("오늘 뭐부터 볼까?", "dashboard.html")).toBe(false);
    expect(isHelpIntent("우리 자산 몇 대야?", "inventory.html")).toBe(false);
  });

  it("할 일 목록 경로가 화면 질문에서 비켜선다", () => {
    // isMyWorkAsk가 isHelpIntent보다 먼저 돌기 때문에, 여기서 안 비키면 화면 안내에 닿지 못한다.
    expect(isMyWorkAsk("여기 내 업무 화면은 뭐 하는 곳이야?"), "화면을 물었는데 할 일을 쏟는다").toBe(false);
    expect(isMyWorkAsk("내 업무 보여줘"), "진짜 할 일 질문까지 막으면 안 된다").toBe(true);
    expect(isMyWorkAsk("오늘 할 일 알려줘")).toBe(true);
  });
});

describe("★ 있는 기능을 없다고 하지 않는다 (챗봇 전수 2026-08-01)", () => {
  it("「할 수 있는 게 뭐야」를 화면 안내로 받는다", () => {
    // `뭐 할 수`는 잡는데 `할 수 있는 게 뭐`는 어순이 반대라 어느 가지에도 안 걸렸다.
    expect(isHelpIntent("작업 내역에서 내가 할 수 있는 게 뭐야?", "sessions.html")).toBe(true);
    expect(isHelpIntent("여기서 할 수 있는 일이 뭐야?", "kpi.html")).toBe(true);
  });

  it("★ 특정 제품을 콕 집으면 여전히 비켜선다 — 약한 가지에 둔 이유", () => {
    // 강한 가지에 넣었으면 "Tenable로 할 수 있는 게 뭐야?"가 화면 안내로 샜을 것이다.
    expect(isHelpIntent("Tenable로 할 수 있는 게 뭐야?", "dashboard.html")).toBe(false);
    expect(isHelpIntent("CVE-2021-44228로 할 수 있는 게 뭐야?", "vulnscan.html")).toBe(false);
  });
});

describe("★ 메뉴에 있는 화면은 챗봇 안내도 있어야 한다", () => {
  // 제품 규칙: 화면 설명·사용법은 전부 챗봇(screenguide)이 맡는다. 화면엔 정체성 한 줄과 ⚠경고만.
  // 그래서 안내가 빠진 화면은 **아무 데서도 설명되지 않는 화면**이 된다 —
  // 담당자가 "여기 뭐 하는 곳이야?"라고 물으면 화면과 무관한 답이 나온다.
  // 새 화면을 만들 때 이걸 잊기 쉬워(2026-08-01 maintenance.html 신설) 대조로 못 박는다.
  it("nav.js 메뉴와 screenguide 목록이 어긋나지 않는다", () => {
    const nav = fs.readFileSync(new URL("../../client/src/renderer/pages/nav.js", import.meta.url), "utf8");
    const 메뉴: string[] = [];
    for (const m of nav.matchAll(/\{\s*page:\s*"([a-z0-9_-]+\.html)(?:\?[^"]*)?",\s*label:/g)) {
      if (!메뉴.includes(m[1])) 메뉴.push(m[1]);
    }
    expect(메뉴.length, "nav에서 화면을 못 찾았다 — 시험이 헛돌고 있다").toBeGreaterThan(20);
    const 없음 = 메뉴.filter((p) => !getScreenGuide(p));
    expect(없음, "이 화면들은 챗봇이 설명하지 못한다").toEqual([]);
  });
});
