// 배선 계약 전수 시험 (2026-08-19 사장님 「검증해주는 에이전트」·「왜 이런 문제가 계속 발생」)
//
// ■ 왜: 기존 사전 체크 4층(게이트·회귀·실화면·검토관)은 전부 **바꾼 것** 기준이라,
//   애초에 배선이 없던 화면(자산 고르기 미배선·구식 이동 통로)은 아무도 못 봤다 —
//   사장님이 실무 테스트 첫날 그대로 밟았다. 이 시험이 다섯 번째 층이다:
//   **전체 화면 × 대화창 연계 원칙**을 매 게이트마다 전수 대조한다.
//
// ■ 어떻게: 화면마다 「배선됨(방식)」 또는 「제외(이유)」를 아래 대장에 **강제로 분류**한다.
//   - 새 .html 화면이 생기면 대장에 없어서 실패한다 → 만들 때 분류(=배선 여부 결정)를 강제.
//   - 배선됨으로 적힌 화면은 실제 코드(gijoSelectNotify | gijo:select)가 있는지 값으로 검사.
//   - 제외는 이유가 있어야 한다 — 이유 없는 제외는 미룸이지 결정이 아니다.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PAGES = join(__dirname, "..", "..", "client", "src", "renderer", "pages");

// ── 선택 배선 대장 — 화면 전수(라이트 제외). 값: "부품"|"직접"|["제외", 이유] ─────────────
// "부품" = selectnotify.js 공용 부품 사용(신규 표준) · "직접" = gijo:select postMessage 직접
// (기존 5곳 — 부품 이관은 다음 라운드, 이관하면 "부품"으로 바꾼다).
const 선택배선대장: Record<string, "부품" | "직접" | ["제외", string]> = {
  "assets.html": "부품",
  "vulnscan.html": "직접",
  "approvals.html": "직접",
  "analysis.html": "직접",
  "loganalysis.html": "직접",
  "sbom.html": "직접",
  // ── 목록이 있으나 아직 미배선 — B16 잔여(2026-08-19 기준 정직하게 「제외」로 두되 사유 명기.
  //    배선하면 "부품"으로 올린다. 이 목록이 줄어드는 것이 B16 완결의 진행률이다.) ──
  "threat.html": "직접", // 선택보내기(gijo:select)가 이미 있었다 — 조사(2026-08-19)로 확인
  "records.html": ["제외", "B16 잔여 — 감사·로그 행 선택 미배선(항목이 행위 기록이라 카드 재료 설계 필요)"],
  "audit.html": ["제외", "records로 흡수된 화면(리다이렉트) — 직접 열람은 레거시"],
  "syslog.html": ["제외", "records로 흡수된 화면(리다이렉트)"],
  "compliance.html": "부품",
  "handover.html": ["제외", "위저드 화면 — 담기 버튼은 행위지 선택이 아니다(조사 2026-08-19 재확인)"],
  "products.html": ["제외", "카드 전체를 고르는 클릭이 없다(카드 안 개별 조작뿐 — 조사 2026-08-19). 카드 선택 UI가 생기면 배선"],
  "maintenance.html": "부품",
  "intro.html": "부품",
  "sessions.html": "부품",
  "lawlookup.html": ["제외", "결과가 대화창 답으로 오는 화면 — 고를 목록이 화면에 없음"],
  "kpi.html": ["제외", "숫자 대시보드 — 고를 항목 없음"],
  "report.html": "부품",
  "reporting.html": ["제외", "허브 껍데기(무대는 report·kpi·compliance)"],
  "discover.html": ["제외", "허브 껍데기(무대는 analysis·threat·inventory)"],
  "triage.html": ["제외", "허브 껍데기(무대는 vulnscan·sbom)"],
  "fix.html": ["제외", "허브 껍데기(무대는 approvals·maintenance·terminal)"],
  "verify.html": ["제외", "허브 껍데기(무대는 hardening)"],
  "aihub.html": ["제외", "허브 껍데기(무대는 agent·memory·learnloop·redteam)"],
  "inventory.html": "부품",
  "hardening.html": "부품",
  "memory.html": "부품",
  "learnloop.html": "부품",
  "redteam.html": ["제외", "결과 리포트 화면 — 고를 목록이 얇음"],
  "agent.html": ["제외", "팀 구성 화면 — 고를 목록 없음"],
  "dashboard.html": ["제외", "요약 카드 화면 — 항목 클릭은 화면 이동"],
  "terminal.html": ["제외", "CLI 화면 — 선택 개념 없음"],
  "settings.html": ["제외", "설정 화면 — 고를 업무 항목 없음"],
  "merge.html": ["제외", "관리자 도구(모델 합성)"],
  // ── 셸·창·비화면 ──
  "app.html": ["제외", "셸 자신(수신 쪽)"],
  "console.html": ["제외", "대화창 분리창(수신 쪽)"],
  "login.html": ["제외", "로그인 화면 — 셸 이전이라 대화창이 없다"],
  "setup.html": ["제외", "첫 실행 설정 — 셸 이전"],
  "office.html": ["제외", "팀 사무실 별도 창"],
  "docbox.html": ["제외", "문서함 별도 창"],
};

describe("배선 계약 ⑤층 — 선택→대화창 (전수)", () => {
  const files = readdirSync(PAGES).filter((f) => f.endsWith(".html") && !f.startsWith("lite-"));

  it("★ 모든 화면이 대장에 분류돼 있다 — 새 화면은 배선 여부를 정하지 않고는 못 지나간다", () => {
    const 미분류 = files.filter((f) => !(f in 선택배선대장));
    expect(미분류, "새 화면이면 선택배선대장에 「부품」 또는 「제외(이유)」로 분류할 것").toEqual([]);
    const 유령 = Object.keys(선택배선대장).filter((f) => !files.includes(f));
    expect(유령, "대장에 있는데 파일이 없다 — 화면을 지웠으면 대장도 정리").toEqual([]);
  });

  it("배선됨으로 적힌 화면에는 실제 배선 코드가 있다(약속-코드 일치)", () => {
    for (const [f, v] of Object.entries(선택배선대장)) {
      if (Array.isArray(v)) continue;
      const s = readFileSync(join(PAGES, f), "utf8");
      if (v === "부품") {
        expect(s, `${f} — 부품 선언인데 selectnotify 로드가 없다`).toContain("selectnotify.js");
        expect(s, `${f} — 부품 선언인데 gijoSelectNotify 호출이 없다`).toContain("gijoSelectNotify");
      } else {
        expect(s, `${f} — 직접 선언인데 gijo:select가 없다`).toContain("gijo:select");
      }
    }
  });

  it("제외에는 전부 이유가 있다 — 이유 없는 제외는 미룸이지 결정이 아니다", () => {
    for (const [f, v] of Object.entries(선택배선대장)) {
      if (!Array.isArray(v)) continue;
      expect(v[1]?.trim().length ?? 0, f).toBeGreaterThan(5);
    }
  });
});

describe("배선 계약 ⑤층 — 이동 통로 (전수)", () => {
  it("★ navigateTo 단독 사용이 **늘지 않는다**(동결 대장 — 본창 직접 로드는 프로 셸 파괴)", () => {
    // navigateTo( 를 부르면서 셸 통로(gijoOpenScreen|openTabInShell|gijoTabs)가 없는 파일은
    // 클릭이 본창을 화면 파일로 직접 로드할 수 있다(2026-08-19 사장님 실사고의 뿌리).
    // 기존 25곳은 main의 승격 안전망이 전부 받아준다 — 그래서 지금 전부 고치는 대신
    // **동결**한다: 아래 목록에서 늘어나면(새 화면이 구식 통로를 새로 쓰면) 실패.
    // 목록에서 지우는 것(셸 통로로 이관)만 허용 — 이 목록이 0이 되는 것이 이관 완결이다.
    const 동결 = new Set([
      "agent.html", "analysis.html", "approvals.html", "audit.html", "compliance.html",
      "handover.html", "hardening.html", "inventory.html", "kpi.html", "lawlookup.html",
      "learnloop.html", "maintenance.html", "memory.html", "merge.html", "products.html",
      "redteam.html", "report.html", "sbom.html", "sessions.html", "settings.html",
      "syslog.html", "terminal.html", "threat.html", "vulnscan.html", "longnotice.js",
    ]);
    const 예외 = new Set([
      "login.html", "setup.html", // 로그인 전 — 셸이 없다
      "nav.js", // go()의 최종 구현부(분리창 자기 이동) — gijoOpenScreen이 이 파일에 있다
    ]);
    const dir = readdirSync(PAGES).filter((f) => (f.endsWith(".html") || f.endsWith(".js")) && !f.startsWith("lite-"));
    const 신규위반: string[] = [];
    for (const f of dir) {
      if (예외.has(f) || 동결.has(f)) continue;
      const s = readFileSync(join(PAGES, f), "utf8");
      if (!s.includes("navigateTo(")) continue;
      if (!/gijoOpenScreen|openTabInShell|gijoTabs/.test(s)) 신규위반.push(f);
    }
    expect(신규위반, "navigateTo 단독 사용이 새로 생겼다 — 셸 통로를 먼저 쓸 것(동결 목록은 늘리지 않는다)").toEqual([]);
  });

  it("main의 승격 안전망이 살아 있다(프로 셸에서 화면 파일 직접 로드 금지)", () => {
    const s = readFileSync(join(PAGES, "..", "..", "main.ts"), "utf8");
    expect(s).toContain("shell:openTabPush");
    expect(s).toMatch(/file !== "app\.html" && 저장된셸모드\(\) === "pro"/);
    const app = readFileSync(join(PAGES, "app.html"), "utf8");
    expect(app, "셸이 승격 신호를 구독해야 한다").toContain("onOpenTabPush");
  });
});

describe("배선 계약 ⑤층 — 반입 다음 칩", () => {
  it("업로드 응답에 다음 칩이 실리고 클라가 그린다(반입은 nextguide 사각지대)", () => {
    const up = readFileSync(join(__dirname, "..", "src", "engine", "autoupload.ts"), "utf8");
    expect(up).toContain("반입칩");
    expect(up).toContain("vulnscan:");
    const c = readFileSync(join(PAGES, "console.js"), "utf8");
    expect(c).toMatch(/r\.nextChips && P2 && P2\.nextChips/);
  });
});
