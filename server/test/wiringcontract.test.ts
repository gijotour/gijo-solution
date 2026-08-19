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
  // ── 2026-08-20 백로그 라운드: 기존 「직접」 6곳 전부 부품 이관 완료 — 전송 규격은
  //    selectnotify.js 한 곳이 진다(top 한 겹·허용 키·200자 컷). 「직접」 분류는 이제 0이다.
  "vulnscan.html": "부품",
  "approvals.html": "부품",
  "analysis.html": "부품",
  "loganalysis.html": "부품",
  "sbom.html": "부품",
  "threat.html": "부품", // fields(title·plain: 유형·소스·탐지시각)도 보강(2026-08-20)
  "records.html": ["제외", "허브 껍데기 — 무대는 audit(배선됨)·syslog. 행 렌더가 이 파일에 없다(grouphub가 iframe으로 끼움)"],
  "audit.html": "부품", // records의 실제 무대 — 행 클릭=📌 선택(2026-08-20). 1단계: label+text만(감사 행은 자산이 아니라 fields를 실으면 선택카드가 「담당 미배정」 거짓 줄을 그린다)
  "syslog.html": ["제외", "records로 흡수된 화면(리다이렉트) — 시스템 내부 로그 줄은 업무 항목이 아니라 고를 대상이 얇다"],
  "compliance.html": "부품",
  "handover.html": ["제외", "위저드 화면 — 담기 버튼은 행위지 선택이 아니다(조사 2026-08-19 재확인)"],
  "products.html": "부품", // 카드 헤더 줄(.prod-top)만 선택 영역(승인 시안 보안제품_카드선택, 2026-08-20) — 카드 안 조작 7종과 안 겹친다
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
      // HTML 주석을 지우고 대조한다(2026-08-20 외부 조사 1순위 권고) — 문자열 포함 검사는
      // 주석 안 문구로도 참이 되는 것이 알려진 함정이고, 우리가 실제로 뚫렸다(검토관 심각1).
      const s = readFileSync(join(PAGES, f), "utf8").replace(/<!--[\s\S]*?-->/g, "");
      if (v === "부품") {
        // ⚠ 'selectnotify.js' 문자열 검사는 **주석으로도 통과**했다(2026-08-20 검토관 심각1 —
        //   5화면이 호출만 있고 로드가 없어 선택이 조용히 죽었는데 이 시험이 초록이었다).
        //   script 태그 원문으로 검사해야 거짓 통과가 없다.
        expect(s, `${f} — 부품 선언인데 selectnotify 로드(script 태그)가 없다`).toContain('src="selectnotify.js"');
        expect(s, `${f} — 부품 선언인데 gijoSelectNotify 호출이 없다`).toContain("gijoSelectNotify(");
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
    // 2026-08-20 백로그 라운드에서 25곳 중 24곳 이관 완료(셸 통로 우선 + navigateTo 최후 폴백).
    // ⚠ login.html 이동은 일부러 안 바꿨다 — 로그아웃·인증 만료는 본창 통째 교체가 맞다.
    // 남은 1곳(syslog)은 login 가드뿐이라 이관할 화면 이동 자체가 없다.
    // 목록에서 지우는 것(셸 통로로 이관)만 허용 — 이 목록이 0이 되는 것이 이관 완결이다.
    const 동결 = new Set([
      "syslog.html", // navigateTo가 login 가드 1곳뿐 — 화면 이동 통로가 없어 이관 대상 아님
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
    // 2026-08-20 정찰 발견 구멍: login까지 승격하면 로그인이 셸 탭으로 열려 로그아웃이 안 된다.
    expect(s, "승격 안전망에 login.html 예외가 없다 — 로그아웃·인증 만료는 본창 통째 교체가 맞다")
      .toMatch(/저장된셸모드\(\) === "pro" && file !== "login\.html"/);
    const app = readFileSync(join(PAGES, "app.html"), "utf8");
    expect(app, "셸이 승격 신호를 구독해야 한다").toContain("onOpenTabPush");
  });
});

// 주석을 전부 지우고 **코드로만** 대조한다(검토관 M3 — 한 줄 주석 처리로 9건이 다 초록이 되면
// 감시가 있다고 믿는 만큼 없는 것보다 나쁘다). HTML 주석 + JS 블록/줄 주석 셋 다.
function 코드만(p: string): string {
  return readFileSync(p, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("배선 계약 ⑤층 — 수신부 발신자 검증 (외부 조사 2순위, 2026-08-20)", () => {
  // Electron file://라 origin은 전 프레임이 같다 — ev.source 기반 검증이 유일한 층이다.
  // 이 검사들이 빠지면 프레임 트리 밖·정체불명 발신이 셸/화면에 그대로 주입된다.
  it("셸(app.html) — 내것인가 가드 + openTab 값 재조립", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "발신자 검증 함수가 없다").toContain("function 내것인가(");
    expect(s, "수신부 첫 줄 가드가 없다").toContain("내것인가(ev.source)");
    expect(s, "openTab page 값 재조립(파일명 검증)이 없다").toContain("+\\.html(\\?");
  });
  it("팝업 릴레이(nav.js) — self+자손 검사(P4 회귀 방지 포함)", () => {
    const s = 코드만(join(PAGES, "nav.js"));
    expect(s).toContain("function 팝업발신자인가(");
    expect(s).toContain("팝업발신자인가(ev.source)");
  });
  it("scopefilter·assets — 부모(셸·허브) 또는 self(팝업 재주입)만", () => {
    for (const f of ["scopefilter.js", "assets.html"]) {
      const s = 코드만(join(PAGES, f));
      expect(s, `${f} — 범위 수신부 가드가 없다`).toContain("ev.source !== window && ev.source !== window.parent");
    }
  });
  it("허브(grouphub) — openTab은 무대 iframe만·scope는 부모/self만", () => {
    const s = 코드만(join(PAGES, "grouphub.js"));
    expect(s).toContain("ev.source !== st.contentWindow");
    expect(s).toContain("ev.source !== window.parent && ev.source !== window");
  });
  it("keepalive(preload) — 자손 프레임만 활동 신호로 받는다(세션 정책 우회 방지)", () => {
    const s = 코드만(join(PAGES, "..", "..", "preload.ts"));
    const i = s.indexOf("__gijoActivity) return;");
    expect(i, "keepalive 수신부에 발신자 검증이 없다").toBeGreaterThan(-1);
    expect(s.slice(i, i + 600), "자손 사슬 걷기가 없다").toContain("m.source");
  });
  it("main IPC — bridge는 팝업·대화·사무실 창만, broadcast는 본창만, openTab은 값 재조립", () => {
    const s = 코드만(join(PAGES, "..", "..", "main.ts"));
    const b = s.indexOf('ipcMain.on("gijo:bridge"');
    expect(s.slice(b, b + 500), "bridge 발신 창 화이트리스트가 없다").toContain("e.sender.id");
    const br = s.indexOf('ipcMain.on("gijo:broadcast"');
    expect(s.slice(br, br + 500), "broadcast 본창 검증이 없다(검토관 M5)").toContain("e.sender.id !== mainWindow.webContents.id");
    const ot = s.indexOf('ipcMain.handle("shell:openTab"');
    expect(s.slice(ot, ot + 500), "IPC 입구에 값 재조립이 없다(검토관 L7)").toContain("+\\.html(\\?");
  });
  it("죽은 배관(gijo:openChat)이 되살아나지 않는다", () => {
    const s = 코드만(join(PAGES, "chatwidget.js"));
    expect(s, "발신자 0곳의 수신부가 부활했다(2026-08-20 제거)").not.toMatch(/type === "gijo:openChat"/);
  });
});

describe("배선 계약 ⑤층 — 게시 전 UI 실화면 관문 (외부 조사 3순위, 2026-08-20)", () => {
  it("publish-release가 관문을 강제로 부른다(--skip-ui-gate로만 우회)", () => {
    const s = 코드만(join(__dirname, "..", "..", "client", "scripts", "publish-release.mjs"));
    expect(s, "게시가 UI 관문을 안 부른다").toContain("publish-gate-ui.mjs");
    expect(s, "우회 플래그 처리(명시적 사유 경고)가 없다").toContain("--skip-ui-gate");
  });
  it("관문이 fail-closed다 — 남의 앱에 안 붙고(전용 포트), 떠 있으면 게시 중단", () => {
    const s = 코드만(join(__dirname, "..", "..", "tools", "publish-gate-ui.mjs"));
    expect(s, "전용 포트(9227)가 아니다 — 9223은 남의 앱에 붙는 사고 통로").toContain("9227");
    expect(s, "선행 점검 실패 시 게시 중단(exit 3)이 없다").toContain("process.exit(3)");
    expect(s, "자기가 띄운 프로세스만 정리해야 한다").toContain("String(app.pid)");
  });
});

describe("프로 셸 — 팝업 최소화·💬 새 세션 (2026-08-20 사장님 확정)", () => {
  it("open()에 자동 팝업 갈래가 없다 — 팝업은 사람이 직접 누른 ⧉·「(창)」 메뉴뿐", () => {
    const s = 코드만(join(PAGES, "app.html"));
    // ⚠ 정확 일치 부정 단언은 변형(label 없이 등)으로 우회된다(검토관 L4) — page 변수 직접 호출 자체를 금지.
    expect(s, "좁은 창 자동 팝업(④)이 되살아났다 — 프로에서 팝업이 저절로 생기면 안 된다")
      .not.toMatch(/openShellPopout\(page[,)]/);
    // 명시적 ⧉ 두 곳(상단 버튼·도킹 머리)은 남아 있어야 한다 — 사장님 예외(「필요한 거 빼고」)
    expect(s).toContain("openShellPopout(active.page, active.label)");
    expect(s).toContain("openShellPopout(t.page, t.label || undefined)");
    // 도킹 진입 전 그 화면의 팝업을 닫는다(검토관 S2 — 안 닫으면 메뉴 재선택 시 두 벌)
    expect(s, "메뉴 선택 시 기존 팝업 닫기(두 벌 방지)가 없다").toContain("closeShellPopout(page)");
    // 대화 폭 클램프(검토관 S1 — 700 고정이면 좁은 창에서 화면이 144px까지 찌그러진다)
    expect(s, "프로 대화 폭 클램프가 없다").toContain('"clamp(380px, 50%, 700px)"');
  });
  it("💬 대화 홈 = 새 세션 확인(작업 내역 저장 안내) 후 대화·선택·범위 초기화", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "확인창에 「작업 내역에 저장」 안내가 없다 — 없으면 누르길 겁낸다").toContain("「작업 내역」에 저장");
    expect(s, "새 세션 시작이 콘솔에 안 이어진다").toContain("gijoConsole.newSession()");
    const c = 코드만(join(PAGES, "console.js"));
    expect(c).toContain("function newSession(");
    expect(c, "새 세션이 범위 해제를 화면들에 안 알린다").toMatch(/function newSession\([\s\S]{0,800}gijo:scope/);
    expect(c, "gijoConsole에 노출 안 됨").toContain("newSession: newSession");
  });
  it("분리 대화창이 컨텍스트마다 현황 카드를 띄운다(창으로 빼면 정보가 빠지던 결함 — 검토관 M2)", () => {
    const c = 코드만(join(PAGES, "console.js"));
    expect(c, "분리창 onConsoleContext가 카드를 안 띄운다").toMatch(/onConsoleContext\(function \(i\) \{[\s\S]{0,400}screenCard\(i\.screen/);
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "셸 훅이 콘솔 분리 상태를 안 가린다(숨은 콘솔에 그리는 낭비)").toContain('console-popped');
  });
  it("새 세션 뒤는 처음 화면(대화 홈)이다 — 히어로 복원(검토관 M4)", () => {
    const c = 코드만(join(PAGES, "console.js"));
    expect(c, "build가 대화 홈 원본을 저장하지 않는다").toContain("빈상태원본 = _e0.outerHTML");
    expect(c, "newSession이 대화 홈을 되살리지 않는다").toMatch(/function newSession\([\s\S]{0,900}빈상태원본/);
  });
});

describe("AI 팀 가시화 — 실신호 배선(2026-08-20 사장님 「추천으로 작업 진행」)", () => {
  // 원칙: 깜박임은 전부 서버 실신호 — 가짜 연출이 생기면 이 계약이 잡는다.
  it("서버 신호 2종(search·guard)이 실동작 지점에 심어져 있다", () => {
    const la = 코드만(join(__dirname, "..", "src", "engine", "llmactivity.ts"));
    expect(la, "kind 유니언에 search·guard가 없다").toContain('"search" | "guard"');
    const mem = 코드만(join(__dirname, "..", "src", "engine", "memory.ts"));
    expect(mem, "RAG 신호가 hybridSearch(4경로 공용 지점)에 없다").toMatch(/hybridSearch[\s\S]{0,4000}kind: "search"/);
    const gw = 코드만(join(__dirname, "..", "src", "engine", "gateway.ts"));
    expect(gw, "가드 신호 래퍼가 없다(호출처 5곳 공용 지점)").toContain("gateUserInputInner");
    expect(gw).toContain('kind: "guard"');
  });
  it("프로 레일 로스터 — 부품 로드·구성(팀 6+부품 4)·클릭은 화면 열기만", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "railroster.js 로드가 없다").toContain('src="railroster.js"');
    const rr = 코드만(join(PAGES, "railroster.js"));
    for (const id of ["orchestrator", "scan", "analysis", "report", "ti", "normaltic", "embed", "search", "guard", "lora"]) {
      expect(rr, `로스터에 ${id}가 없다(팀 6+부품 4 기본 포함 — 사장님 지정)`).toContain(`"${id}"`);
    }
    expect(rr, "실신호 구독이 없다").toContain("onLlmActivity");
    expect(rr, "신호 유실 대비 소등 타임아웃이 없다").toContain("소등타이머");
    expect(rr, "지시 전송 금지 — 클릭은 화면 열기만").not.toContain("dispatch");
  });
  it("대시보드 — 팀 카드·부품·지식창고가 실데이터 API만 쓴다", () => {
    const d = 코드만(join(PAGES, "dashboard.html"));
    expect(d).toContain("aiteamRow");
    expect(d, "지식창고(라이트 이식)가 없다").toContain("loadKnowledgeBox");
    expect(d, "부품 실신호 플래시가 없다").toContain("부품플래시");
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
