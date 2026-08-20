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
  "products.html": "부품", // 행(.g-rows-r) 전체가 선택 영역(2026-08-21 엑셀형 — 조작은 ▸ 상세 안)(승인 시안 보안제품_카드선택, 2026-08-20) — 카드 안 조작 7종과 안 겹친다
  "maintenance.html": "부품",
  "intro.html": "부품",
  "sessions.html": "부품",
  "supervision.html": "부품", // AI 팀 감독(2026-08-20 ②) — 팀원 카드 클릭=📌(일반형, label+text만)
  "mydocs.html": "부품", // 내 문서(2026-08-20 LLM 위키) — 행 클릭=📌(일반형, label+text만)
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
  "pick.html": ["제외", "고르기 모드(승인 시안 stage-picker) — 행 클릭=gijo:pickdone 전용 신호(셸이 선택+무대 내림). 부품(gijo:select)을 안 쓰는 이유: 확인창 발신이 섞인 그 신호에 자동 내림을 붙이면 상1 재발"],
  "app.html": ["제외", "셸 자신(수신 쪽)"],
  "console.html": ["제외", "대화창 분리창(수신 쪽)"],
  "login.html": ["제외", "로그인 화면 — 셸 이전이라 대화창이 없다"],
  "setup.html": ["제외", "첫 실행 설정 — 셸 이전"],
  "office.html": ["제외", "팀 사무실 별도 창"],
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
    // 무대 전환(2026-08-20 사장님 「팝업 및 옆에 붙는 메뉴를 없애는」·「승인 추천안으로 끝까지
    // 진행」이 같은 날 앞선 예외 「필요한 거 빼고」를 대체): 도킹 머리 ⧉(dockPop)는 폐지 —
    // 프로의 창은 (창) 메뉴(팀 사무실·문서함)뿐이다. 상단 ⧉(tbPopout)는 표준 셸 전용으로
    // 남는다(프로는 .shellfoot 자체가 숨음 — shelllayout.test가 마크업을 지킨다).
    // theme 4번째 인자(2026-08-20 배색 중8) — 프로 팝업도 흰 바탕 신호를 잇는다.
    expect(s).toContain('openShellPopout(active.page, active.label, undefined, 프로인가() ? "light" : undefined)');
    expect(s, "도킹 머리 ⧉(dockPop)가 되살아났다 — 무대 전환으로 폐지된 조작이다")
      .not.toContain("openShellPopout(t.page, t.label || undefined)");
    // 도킹 진입 전 그 화면의 팝업을 닫는다(검토관 S2 — 안 닫으면 메뉴 재선택 시 두 벌)
    expect(s, "메뉴 선택 시 기존 팝업 닫기(두 벌 방지)가 없다").toContain("closeShellPopout(page)");
    // (옛 대화 폭 클램프 계약은 폐지 — 무대 전환으로 프로에서 화면·대화가 폭을 나누는 조합이
    //  없어져 --console-w가 죽은 값이 됐다. 죽은 값을 지키는 계약은 감시를 형해화한다 — 중9①.)
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
    // 저장 **방식**이 아니라 「원본을 담고 되살린다」는 계약을 지킨다 — 2026-08-20에 현황판
    // 자리를 비워 담도록 바뀌었고(관문 적발), 그때 문구를 못박은 이 단언이 함께 깨졌다.
    expect(c, "build가 대화 홈 원본을 저장하지 않는다").toMatch(/빈상태원본 = [_\w]+\.outerHTML/);
    expect(c, "newSession이 대화 홈을 되살리지 않는다").toMatch(/function newSession\([\s\S]{0,900}빈상태원본/);
    // 현황판 자리는 **비운 채로** 담아야 한다 — 「확인하는 중…」+딱지째 담기면 새 세션이
    // 되살린 순간 renderPanels가 조기 반환해 홈에 스트립이 영영 안 뜬다(실화면 실측 0개).
    expect(c, "홈 원본에 현황판 자리를 비우는 처리가 없다").toMatch(/cePanels[\s\S]{0,200}removeAttribute\("data-mounted"\)/);
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

describe("프로 확정 계약 — 메뉴는 카드가 전부(2026-08-20 사장님 ×3 최종)", () => {
  it("open()이 메뉴성 열기를 카드로 보낸다 — 화면은 dock 명시·쿼리·카드 없음뿐", () => {
    const s2 = 코드만(join(PAGES, "app.html"));
    expect(s2, "카드 우선 갈래가 사라졌다 — 같은 요청이 네 번째 반복된다").toContain("카드가 전부");
    expect(s2, "명시 열기(dock) 신호가 없다").toContain("{ dock: true }");
    const c2 = 코드만(join(PAGES, "console.js"));
    expect(c2, "🗔가 dock 신호를 안 단다 — 카드 경로에 먹혀 화면을 영영 못 연다").toContain("gijoTabs.open(page, label, { dock: true })");
  });
  it("문서 허브 §6 — 신고 시한 템플릿 수신 계약(발신자 가드·템플릿 id) 소스 감시", () => {
    // 계약(승인 시안 docs-hub-v3 §6): 신고 시한 카운트다운 카드(미래)가
    // {type:"gijo:newDocFromTemplate", templateId, prefill}를 보내면 허브가 편집기를 연다.
    // 발신자 가드가 빠지면 아무 창이나 편집기를 열고, 템플릿 id가 바뀌면 카드 발신과 어긋난다
    // (검토관 하11 — 필드명 원천 대조 4연발 유형의 예방 감시).
    const s = 코드만(join(PAGES, "mydocs.html"));
    expect(s, "수신 계약이 사라졌다").toContain("gijo:newDocFromTemplate");
    expect(s, "발신자 가드가 없다 — 아무 창이나 편집기를 연다").toContain("ev.source !== window.parent");
    for (const id of ["incident_report", "breach_notice"]) {
      expect(s, `신고 템플릿 id가 바뀌면 카드 쪽 발신과 어긋난다: ${id}`).toContain(`"${id}"`);
    }
  });

  it("카드 커버리지 — 전 메뉴 확장(창 예외 제외)", () => {
    const d = 코드만(join(__dirname, "..", "src", "engine", "datacard.ts"));
    for (const p of ["sessions.html", "fix.html", "reporting.html", "products.html", "records.html", "threat.html", "aihub.html"]) {
      expect(d, p + " 카드 매핑이 없다(사장님 「나머지는 카드 다 만들어서」)").toContain(String.fromCharCode(34) + p + String.fromCharCode(34));
    }
  });
  it("메뉴 화면 = 카드 맵 ∪ 명시 예외 — 암묵 예외 금지(검토관 5.41 중11)", () => {
    const d = readFileSync(join(__dirname, "..", "src", "engine", "datacard.ts"), "utf8");
    // 맵은 화면파일카드 블록만 잘라 뽑는다 — 전체 grep이면 카드예외 블록의 키까지 맵으로
    // 오인한다(검토관 백로그 하6②).
    const 맵블록 = d.slice(d.indexOf("const 화면파일카드"), d.indexOf("};", d.indexOf("const 화면파일카드")));
    const 맵 = new Set([...맵블록.matchAll(/"([\w-]+\.html)":\s*"/g)].map((m) => m[1]));
    const 예외블록 = d.slice(d.indexOf("export const 카드예외"), d.indexOf("};", d.indexOf("export const 카드예외")));
    const 예외 = new Set([...예외블록.matchAll(/"([\w-]+\.html)":/g)].map((m) => m[1]));
    const nv = readFileSync(join(PAGES, "nav.js"), "utf8");
    // 쿼리 딸린 메뉴(settings.html?s=my 등)도 잡는다(하6① — 안 잡으면 새 암묵 통로).
    const 메뉴 = [...nv.matchAll(/page:\s*"([\w-]+\.html)(?:\?[^"]*)?"/g)].map((m) => m[1]);
    const 미분류 = [...new Set(메뉴)].filter((p) => !맵.has(p) && !예외.has(p));
    expect(미분류, "새 메뉴 화면은 카드 맵 또는 카드예외(이유 명시)에 넣을 것").toEqual([]);
    // 맵∩예외 = ∅ — 카드를 만들었으면 예외에서 지워야 두 곳이 다른 말을 안 한다(하6③).
    const 겹침 = [...맵].filter((p) => 예외.has(p));
    expect(겹침, "카드 맵과 카드예외에 같은 화면이 있다").toEqual([]);
  });
  it("무대(대화창 자리) — 전면/대화 상태·← 대화로·골라서 복귀(2026-08-20 사장님 승인)", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "전면 상태(stage-on)가 없다 — 화면이 대화창 자리를 못 쓴다").toContain("stage-on");
    expect(s, "← 대화로(무대숨김)가 없다 — 화면에서 대화로 돌아올 길이 없다").toContain("무대숨김");
    expect(s, "무대 머리의 복귀 단추가 없다").toContain("← 대화로");
    // ⚠ 선택 자동 복귀는 금지 계약이다(검토관 상1) — gijo:select는 결재 확인창·모달·상세
    //   열기 직후에도 오므로(발신 18곳 중 10곳) 무대를 내리면 방금 연 것이 통째로 숨는다.
    //   허용은 표시(골랐습니다)까지다. (기호는 2026-08-20 맥락 문장 개편으로 📌→🎯)
    expect(s, "선택 자동 복귀가 되살아났다 — 결재 확인창을 삼키는 부류(상1)")
      .not.toMatch(/gijo:select[\s\S]{0,2000}무대숨김 = true/);
    expect(s, "선택 표시(골랐습니다) 피드백이 없다").toContain("🎯 골랐습니다");
    // 대화에 쓰는 부품(질문 얹기·ⓘ)은 무대를 내린다 — 숨은 콘솔에 쓰면 무반응(상4).
    expect(s, "toChat(대화 앞으로) 노출이 없다").toContain("toChat:");
    const c3 = 코드만(join(PAGES, "console.js"));
    for (const fn of ["function ask(", "function prefill(", "function guideAsk("]) {
      const i = c3.indexOf(fn);
      expect(i, fn + "가 없다").toBeGreaterThan(-1);
      expect(c3.slice(i, i + 400), fn + "가 무대를 안 내린다(숨은 콘솔에 쓰면 무반응 — 상4)").toContain("toChat");
    }
    // 분리창 되붙이기·빼기는 무대 상태를 다시 계산한다(상2·상3 — 안 하면 대화가 어디에도 없다).
    expect(s, "setPopped가 무대 상태를 안 다룬다").toMatch(/function setPopped\([\s\S]{0,900}무대숨김 = popped \? false : tabs\.length > 0/);
    // 무대를 오르내린 모든 길에서 대화 맥락을 다시 읽는다(상5 — syncCtx가 show/close에서만
    // 불리면 「마지막 카드=맥락」 갈래가 실사용에서 영영 안 닿는다).
    expect(s, "대화홈갱신이 syncCtx를 안 부른다(맥락 갱신 끊김 — 상5)").toMatch(/function 대화홈갱신\([\s\S]{0,3000}gijoConsoleSyncCtx/);
    // 🎨 프로=흰 바탕(2026-08-20 배색 확정) — 셸 클래스·화면 전달·수신 세 고리가 다 있어야 한다.
    // 한 고리만 빠지면 「셸은 흰데 무대만 다크」 같은 반쪽이 된다(배색=에디션 이름표).
    expect(s, "프로 셸이 theme-light를 안 단다").toContain('documentElement.classList.add("theme-light")');
    expect(s, "embedSrc가 화면에 theme=light를 안 싣는다").toMatch(/embedSrc[\s\S]{0,400}theme=light/);
    const nv = 코드만(join(PAGES, "nav.js"));
    expect(nv, "화면이 theme=light를 안 받는다(nav.js)").toContain("theme=light");
    expect(nv, "pro-white.css 주입이 없다").toContain("pro-white.css");
    // 카드가 뜨면 무대를 내린다 — 무대 뒤(숨은 대화)에 카드만 붙으면 사람 눈엔 무반응이다.
    expect(s, "메뉴 카드가 무대를 안 내린다(무대 뒤 카드=무반응)").toMatch(/if \(shown\) \{[\s\S]{0,400}무대숨김 = tabs\.length > 0/);
    const c = 코드만(join(PAGES, "console.js"));
    // 무대가 내려간 동안의 대화 맥락은 마지막 카드다(검토관 중7) — 숨은 탭이 아니라.
    expect(c, "무대 내림 상태의 화면 맥락(마지막 카드) 반영이 없다").toMatch(/stage-on[\s\S]{0,300}화면카드직전/);
    // 같은 메뉴 재클릭은 무반응이 아니라 기존 카드를 비춰 준다(검토관 중5).
    expect(c, "같은 메뉴 재클릭이 여전히 무반응이다").toContain("화면카드행.scrollIntoView");
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
