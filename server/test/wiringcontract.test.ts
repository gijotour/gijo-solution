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
  "supplychain.html": "부품", // 공급망 점검(2026-08-22) — 부품 행 클릭 = 📌 선택(등급·받게되는요구)
  "threat.html": "부품", // fields(title·plain: 유형·소스·탐지시각)도 보강(2026-08-20)
  "records.html": ["제외", "허브 껍데기 — 무대는 audit(배선됨)·syslog. 행 렌더가 이 파일에 없다(grouphub가 iframe으로 끼움)"],
  "audit.html": "부품", // records의 실제 무대 — 행 클릭=📌 선택(2026-08-20). 1단계: label+text만(감사 행은 자산이 아니라 fields를 실으면 선택카드가 「담당 미배정」 거짓 줄을 그린다)
  "syslog.html": ["제외", "records로 흡수된 화면(리다이렉트) — 시스템 내부 로그 줄은 업무 항목이 아니라 고를 대상이 얇다"],
  "compliance.html": "부품",
  "handover.html": ["제외", "위저드 화면 — 담기 버튼은 행위지 선택이 아니다(조사 2026-08-19 재확인)"],
  "products.html": "부품", // 행(.g-rows-r) 전체가 선택 영역(2026-08-21 엑셀형 — 조작은 ▸ 상세 안)(승인 시안 보안제품_카드선택, 2026-08-20) — 카드 안 조작 7종과 안 겹친다
  "maintenance.html": "부품",
  // "intro.html" — 2026-08-22 삭제(내 문서 📦 보안제품 자료로 흡수). 파일이 없으니 대장에서도 뺀다.
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
  // 2026-08-30 「제외」→「부품」 — 대장이 「항목 클릭은 화면 이동」이라 적어 두고 실제 코드는
  // 할 일 글자 클릭에서 gijo:select를 직접 발신하고 있었다(대장-코드 불일치, 검토관 적발).
  // 직접 발신을 selectnotify 부품으로 이관하며 분류도 사실대로 고친다.
  "dashboard.html": "부품",
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
        // ★ **넘기는 모양까지 본다**(2026-08-22 검토관 [높음]).
        //   ⚠ 위 두 줄은 「부른다」만 보므로, **규격을 틀리게 불러도 초록**이다.
        //     실제로 그랬다 — 새 화면이 `{screen, kind, label, detail}`로 불렀는데 규격은
        //     `{label, text, fields}`이고, **text가 없으면 공용 부품이 「해제」를 보낸다**.
        //     즉 행을 누르면 선택이 걸리는 게 아니라 **직전에 골라 둔 것까지 지워졌다.**
        //     시험은 3,966개가 통과하는데 기능은 반대로 도는 상태였다.
        //   객체를 넘기는 호출이 하나라도 있으면 그 안에 `text:`가 있어야 한다
        //   (인자 없는 `gijoSelectNotify()`는 해제라 정상 — 그것만 있는 화면은 위에서 이미 걸린다).
        const 객체호출 = /gijoSelectNotify\(\s*\{/.test(s);
        if (객체호출) {
          expect(s, `${f} — gijoSelectNotify에 text가 없다(규격: {label, text, fields}). text가 빠지면 「해제」로 전송돼 선택이 지워진다`)
            .toMatch(/gijoSelectNotify\(\s*\{[\s\S]{0,600}?\btext\s*:/);
        }
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
    // (--console-w 계약 이력: 무대 전환기에 죽은 값이 되어 폐지했었다(중9①) —
    //  0-4 끌개가 생산자를 만들면서 아래 「대화창 폭 끌개」 시험으로 **부활**했다.)
  });

  // 🖱 대화창 폭 끌개(셸 재구축 0-4, 2026-08-27 사장님 「대화창은 크기조정 기능」).
  //   ★ 이 시험이 지키는 것 셋:
  //   ① 생산자-소비자 짝 — --console-w는 「소비자 1곳·생산자 0」인 죽은 값이었던 이력이 있다.
  //     끌개(생산자)가 사라지면 다시 죽은 값이 되는데 화면은 멀쩡해 보인다(기본 380 폴백).
  //   ② 버벅임 계약 — 2026-07-28에 높이 손잡이를 「mousemove마다 iframe 재레이아웃」으로
  //     걷어냈다. 가로 끌개는 유령선 방식(드래그 중 반영 0회)이라서만 허용된 것이다 —
  //     mousemove 핸들러가 --console-w를 직접 바꾸기 시작하면 같은 병이 재발한다.
  //   ③ 저장·클램프 — 관문 앱이 userData(localStorage)를 실사용과 공유하므로, 클램프 없이
  //     0 근처 폭이 저장되면 다음 게시 관문(대화보임 offsetWidth>0)이 죽는다.
  it("대화창 폭 끌개 — 생산자·유령선(버벅임 계약)·클램프·저장(0-4)", () => {
    const s = 코드만(join(PAGES, "app.html"));
    // ① 생산자와 소비자가 짝으로 존재한다
    expect(s, "--console-w 소비자(격자)가 없다").toContain("var(--console-w");
    expect(s, "--console-w 생산자(끌개)가 없다 — 죽은 값으로 회귀").toContain('setProperty("--console-w"');
    // ② 버벅임 계약 — 드래그 이동 핸들러는 유령선만 옮긴다. 폭 반영은 mouseup(놓음)에서만.
    const 이동부 = s.match(/var 이동 = function[\s\S]{0,300}/);
    expect(이동부, "끌개의 이동 핸들러(이동)가 없다").toBeTruthy();
    expect(이동부![0], "드래그 중 폭을 실시간 반영한다 — 2026-07-28 버벅임 병 재발")
      .not.toContain("--console-w");
    // ③ 클램프 바닥 360(분리창 minWidth와 같은 실증값) + 저장키(콘솔 상태 가족)
    expect(s, "클램프 바닥(360)이 없다 — 0폭 저장이 게시 관문을 죽인다").toMatch(/Math\.max\(360,/);
    expect(s, "저장키(gijo:console:w)가 없다").toContain('"gijo:console:w"');
    // 복원 경로도 클램프를 지난다 — 대화폭적용이 클램프를 품으므로 복원이 그 함수를 부르면 된다.
    expect(s, "복원(대화폭복원)이 없다 — 폭이 세션을 못 넘긴다").toMatch(/function 대화폭복원[\s\S]{0,200}대화폭적용/);
    // stage-on 한정 — chat-home(대화 전폭)·분리창에는 끌 대상이 없다(설계 검토 [높음]).
    expect(s, "끌개가 stage-on 한정이 아니다").toMatch(/body\.pro-shell\.stage-on [^\n]*#conResize\{display:block/);
  });

  // 🗂 화면 메뉴 판(셸 재구축 0-3, 2026-08-27 사장님 「1+3」 — 화면 메뉴 + 접기).
  //   ★ 이 시험이 지키는 것:
  //   ① 두 줄 원자성 — 「두 칸 격자」와 「#gijoNav 표시」는 함께 산다. display:none만 남으면
  //     빈 200px 칸이 생기고, 격자만 한 칸으로 돌아가면 #gijoNav가 1행을 먹어 .work가
  //     암묵 2행으로 떨어진다(화면 전체가 아래로 밀리는 즉사형 — 설계 검토 [BLOCKER]).
  //   ② 한 원천 — 판 내용은 nav.js gijoRenderMenu 재사용이다. 셸이 메뉴를 따로 그리기
  //     시작하면 「같은 것을 두 곳에 적으면 어긋난다」가 메뉴에서 재발한다.
  //   ③ 계정 이사 방지 — 컨테이너가 .gn-mid면 titlebar.js mountUserArea 첫 갈래가 계정을
  //     판 하단으로 옮긴다(판을 접으면 계정·업데이트 배지가 사라진다 — 2026-08-01 계보).
  //   ④ 접기 키 격리 — 표준 LEFT_KEY를 같이 쓰면 프로에서 접은 것이 표준 사이드바를 접는다.
  it("화면 메뉴 판 — 두 칸 원자성·gijoRenderMenu 한 원천·계정 자리·접기 키(0-3)", () => {
    const s = 코드만(join(PAGES, "app.html"));
    // ① 두 칸 격자 + display:none 부재가 짝이다
    expect(s, "프로 #gijoNav가 아직 display:none이다 — 두 칸 격자에 빈 칸만 남는다")
      .not.toMatch(/body\.pro-shell #gijoNav\{display:none/);
    expect(s, "프로 #gijoNav 표시 복원이 없다").toMatch(/body\.pro-shell #gijoNav\{display:flex/);
    // nav.js가 주입하는 sticky·100vh(단독 화면용)를 프로에서 되돌렸나 — 안 하면 44px 상단바 밑에서 넘친다
    expect(s, "프로 #gijoNav의 sticky·100vh 되돌림이 없다").toMatch(/body\.pro-shell #gijoNav\{[^}]*position:static/);
    // ② 한 원천 — gijoRenderMenu 재사용
    expect(s, "판 내용이 gijoRenderMenu 재사용이 아니다").toContain("window.gijoRenderMenu(box)");
    // ③ 계정 이사 방지 — 판 컨테이너는 .pro-menu이고 gn-mid가 아니다
    const 설치부 = s.match(/function 메뉴판설치[\s\S]{0,700}/);
    expect(설치부, "메뉴판설치가 없다").toBeTruthy();
    expect(설치부![0], "판 컨테이너가 gn-mid다 — 계정·문서함이 판 하단으로 이사해 접으면 사라진다")
      .not.toMatch(/className = "[^"]*gn-mid/);
    // ④ 접기 — 새 키 + 표준 키 미사용 + 복원·토글·단추 배선
    expect(s, "접기 키(gijo:proMenu:collapsed)가 없다").toContain('"gijo:proMenu:collapsed"');
    // ⚠ 문자열 전체가 아니라 **localStorage 사용만** 본다 — 주석은 「이 키를 쓰지 말라」를
    //   이유와 함께 적을 수 있어야 한다(0-1 「← 대화로」 시험과 같은 교훈).
    expect(s, "표준 접기 키(leftPanel)를 프로가 같이 쓴다 — 프로에서 접으면 표준도 접힌다")
      .not.toMatch(/localStorage\.[gs]etItem\("gijo:leftPanel/);
    expect(s, "접기 CSS(--menu-w:0)가 없다").toMatch(/pro-menu-closed\{--menu-w:0px/);
    expect(s, "‖ 단추(railPane) 배선이 없다").toMatch(/눌러\("railPane", 메뉴판토글\)/);
    // 설치 시점 — 부팅 인라인 시점엔 nav.js가 아직 안 실렸다(DOMContentLoaded 계약)
    expect(s, "메뉴판설치가 DOMContentLoaded에 안 걸려 있다 — gijoRenderMenu가 undefined인 시점에 돈다")
      .toMatch(/DOMContentLoaded",\s*메뉴판설치/);
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
  it("프로 레일 로스터 — 부품 로드·구성(팀 7+부품 4)·클릭은 화면 열기만", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "railroster.js 로드가 없다").toContain('src="railroster.js"');
    const rr = 코드만(join(PAGES, "railroster.js"));
    for (const id of ["orchestrator", "scan", "analysis", "report", "ti", "normaltic", "curator", "embed", "search", "guard", "lora"]) {
      expect(rr, `로스터에 ${id}가 없다(팀 7+부품 4 기본 포함 — 사장님 지정·사서 2026-09-03)`).toContain(`"${id}"`);
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

describe("프로 확정 계약 — 메뉴 클릭 = 화면+카드 나란히(2026-08-31 사장님 개정 — 실화면 캡처 3장 「안티그래비티처럼, 3번 그림처럼」; 종전 「메뉴는 카드가 전부」 2026-08-20 ×3을 대체)", () => {
  it("open()이 메뉴성 열기를 화면으로 흘린다 — 카드만 갈래·부속 플래그가 되살아나면 옛 계약의 부활", () => {
    const s2 = 코드만(join(PAGES, "app.html"));
    // 카드-only 갈래의 부속 플래그 3종 — 코드에 하나라도 돌아오면 개정 전으로 되돌아간 것.
    for (const 플래그 of ["방금카드없음", "카드억제", "카드세대"]) {
      expect(s2, `옛 「카드가 전부」 부속(${플래그})이 코드에 되살아났다 — 2026-08-31 개정과 충돌`).not.toContain(플래그);
    }
    // 도킹 교체는 「다른 화면일 때만」 기존 도킹을 닫는다 — 이 조건이 빠지면 같은 메뉴
    // 재클릭이 iframe을 재로딩해 걸어 둔 조건·스크롤이 날아간다(설계관 2026-08-31).
    expect(s2, "도킹 교체의 다름 조건이 사라졌다(같은 화면 재클릭=재로딩)").toContain("도킹중.page !== page");
    // 개정은 카드 폐지가 아니다 — 「화면 열기→현황 카드 자동」(5.38 계약)이 살아
    // 화면(왼쪽)+카드(오른쪽 대화창)가 나란히 된다.
    expect(s2, "화면 열기→현황 카드 자동이 사라졌다(개정은 카드 폐지가 아니다)").toContain(".screenCard(page");
    expect(s2, "명시 열기(dock) 신호가 없다").toContain("{ dock: true }");
    const c2 = 코드만(join(PAGES, "console.js"));
    expect(c2, "🗔가 dock 신호를 안 단다").toContain("gijoTabs.open(page, label, { dock: true })");
    // 홈 히어로 절차 칩 — 5그룹 재편(2026-08-31)으로 단계 id가 그룹→항목으로 내려갔다.
    // 그룹 id(g.id)로 거르면 칩이 **조용히 0개**가 된다(설계관 적발, 시험 없던 자리).
    expect(c2, "홈 히어로 절차 칩이 항목 id(it.id)를 안 본다 — 칩 0개 부류").toMatch(/STAGE[\s\S]{0,400}it\.id/);
  });
  it("5그룹 재편 연쇄 감시 — TOP 다리·깊은 주소·화면찾기 중복(2026-08-31 검토관)", () => {
    const nv = 코드만(join(PAGES, "nav.js"));
    const s = 코드만(join(PAGES, "app.html"));
    // ① 셸 이름찾기의 TOP 다리 — 끊기면 오류 없이 옛 결함(mydocs 탭 이름 오인)으로 회귀한다.
    expect(nv, "nav.js가 gijoNavTop을 안 내준다").toContain("window.gijoNavTop = TOP");
    expect(s, "셸 화면이름찾기가 gijoNavTop을 안 읽는다").toContain("window.gijoNavTop");
    // ② 깊은 주소 메뉴 — 쿼리 값이 어긋나면 **오류 없이** 딴 화면·딴 판이 열린다.
    //    판 주소는 갈아타기 표(TAB_REDIRECT)의 도착 주소와 같은 문자열이어야 한다(단일 출처 대조).
    for (const [흡수원, 도착] of [["hardening.html", "verify.html?panel=hardening"], ["maintenance.html", "fix.html?panel=maintenance"]]) {
      expect(nv, `메뉴 깊은 주소가 사라졌다: ${도착}`).toContain(`page: "${도착}"`);
      expect(nv, `갈아타기 도착 주소와 어긋났다: ${흡수원}→${도착}`).toContain(`"${흡수원}": "${도착}"`);
    }
    expect(nv, "자산 관리 메뉴가 full=1 예외 없이 걸렸다 — 조용히 ⓪로 갈아탄다").toContain('page: "inventory.html?full=1"');
    const md = 코드만(join(PAGES, "mydocs.html"));
    for (const tab of ["ingest", "mine", "contacts", "watch", "req", "write"]) { // watch: 📂(08-31) · write: 📝 문서작성(09-01)
      expect(nv, `내 문서 탭 메뉴가 사라졌다: ${tab}`).toContain(`mydocs.html?tab=${tab}`);
      // ⚠ 옛 판은 `"${tab}"`만 찾았다 — 「req」·「mine」 같은 낱말은 상태 키·오류 표에도
      //   널려 있어 **탭이 하나도 없어도 통과**했다(2026-08-31 검토관 [낮음]: 부정 경로가
      //   없는 검사는 검사가 아니다). 실제 탭 단추의 표식(data-t)으로 못 박는다.
      expect(md, `내 문서에 ${tab} 탭 단추가 없다 — 메뉴가 유령 탭을 가리킨다`).toContain(`data-t="${tab}"`);
    }
    // ③ 🔍 화면찾기 중복 거름 — 작업 내역 이중 등재(TOP+📓, 승인 의도)가 목록에 두 줄로
    //    새지 않게 gijoScreenList가 같은 주소+이름을 거른다.
    expect(nv, "gijoScreenList가 중복을 안 거른다(작업 내역 두 줄)").toContain("본것[k]");
  });
  it("💬 대화창 온디맨드(2026-08-31 사장님 「필요할 때만 불러서 보고」) — 접힘 축·손잡이·강제 오픈", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "접힘 축(console-folded)이 없다").toContain("console-folded");
    expect(s, "💬 손잡이가 없다 — 접으면 되부를 길이 없다").toContain('b.id = "conSummon"');
    // 기본값=접힘은 소스로 못박는다(게시 관문은 프로필 기억이 섞여 비결정적 — 동작만 잰다).
    expect(s, "기본값이 접힘이 아니다(사장님 「필요할 때만」)").toContain('기억 === null ? true');
    expect(s, "toChat이 접힘을 강제로 안 푼다 — ⓘ·질문 얹기가 숨은 대화에 쓰는 무반응 부류").toMatch(/toChat:[\s\S]{0,200}대화접힘적용\(false/);
    const c4 = 코드만(join(PAGES, "console.js"));
    expect(c4, "도착 신호 훅(gijoConsoleActivity)이 없다 — 접힌 동안 소식이 조용히 사라진다").toContain("gijoConsoleActivity");
    expect(c4, "⊮ 접기 단추가 없다 — 부른 대화를 되접을 길이 없다").toContain('id="csFold"');
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
  // 🏠 셸 재구축 0-1(2026-08-23 사장님 「내 문서가 대시보드 메인 화면이 되고 +대화창+상단바」)로
  //   stage-on의 **뜻이 바뀌었다**: 「대화를 숨기고 화면이 전폭」 → 「왼쪽 화면 · 오른쪽 대화 나란히」.
  //   클래스 이름은 그대로 둔다(게시 관문·QA·titlebar가 읽는다 — 갈면 여섯 곳이 어긋난다).
  //   따라서 복귀 단추 문구도 「← 대화로」에서 「⊟ 화면 접기」로 바뀌었다 — 대화창이 늘 보이는데
  //   「대화로 돌아간다」고 적으면 화면이 거짓말을 한다.
  it("화면+대화 나란히(stage-on) — 상태·⊟ 화면 접기·골라서 복귀(2026-08-23 사장님 지시)", () => {
    const s = 코드만(join(PAGES, "app.html"));
    expect(s, "나란히 상태(stage-on)가 없다 — 화면이 대화 옆에 못 선다").toContain("stage-on");
    expect(s, "화면 접기(무대숨김)가 없다 — 대화를 넓게 쓸 길이 없다").toContain("무대숨김");
    expect(s, "무대 머리의 접기 단추가 없다").toContain("⊟ 화면 접기");
    // ★ 되돌아가기 방지 — 대화창이 늘 보이는데 단추가 「대화로 돌아간다」고 말하면 거짓말이다.
    //   ⚠ 파일 전체가 아니라 **단추 자리만** 본다 — 주석은 옛 이름을 역사로 적을 수 있고,
    //     전체를 막으면 「왜 그렇게 바뀌었는지」를 못 적게 하는 시험이 된다.
    expect(s, "복귀 단추 문구가 「← 대화로」로 되돌아갔다 — 대화창이 늘 보이므로 거짓말이다")
      .not.toMatch(/id="stageBack"[\s\S]{0,400}← 대화로/);
    // ★ 프로의 홈은 **대시보드**다 (2026-09-02 사장님 결정 「프로 첫 화면 대시보드로 하자」).
    //   ↩ 그전 두 결정을 대체한다 — 2026-08-23 「내 문서가 메인 화면」, 2026-08-31 시안의 「대화창 전면」.
    //   여정 점검 F3-01이 「코드·주석·시험이 서로 다른 말을 한다」고 짚어 사장님께 물어 받은 답이다.
    //   ⚠ 이 시험이 재는 것은 **첫 실행 분기가 무엇을 여는가**다 — 화면이 예쁜지가 아니다.
    //
    // ⚠⚠ 2026-09-02: 이 자리는 **거짓 초록이었다.** 처음 시험은 「`프로인가()` 근처 700자 안에
    //   open("dashboard.html")가 있나」만 봤는데, 그 열기는 실제로 boot()의 프로 분기가 **이미
    //   return한 뒤**의 else-if 안에 있었다 — 프로에서 영영 실행되지 않는 죽은 코드였다.
    //   글자는 있으니 시험은 초록이었고, 사장님 결정은 주석에만 존재했다.
    //   ⇒ 이제 **도달 가능성**을 잰다: boot()의 프로 분기 **안에서**, 그리고 **return보다 앞에서**
    //     여는지 확인한다. 자리를 다시 옮기면 이 시험이 빨간불을 낸다.
    const boot구간 = s.slice(s.indexOf("function boot()"), s.indexOf("var st = null;"));
    expect(boot구간, "boot()의 프로 분기를 못 찾았다 — 이 시험이 헛돈다").toContain("if (프로인가()) {");
    const i열기 = boot구간.indexOf('open("dashboard.html"');
    const i반환 = boot구간.lastIndexOf("return;");
    expect(i열기, "프로 첫 실행 분기 안에서 대시보드를 열지 않는다").toBeGreaterThan(0);
    expect(i반환, "프로 분기의 return을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(0);
    expect(i열기, "대시보드 열기가 프로 분기의 return **뒤**에 있다 — 죽은 코드다(2026-09-02 재발 방지)")
      .toBeLessThan(i반환);
    const i핀 = boot구간.indexOf("프로홈탭");
    expect(i핀, "홈 탭에 핀이 없다 — 「모두 닫기」로 홈이 사라진다").toBeGreaterThan(i열기);
    expect(boot구간.slice(i핀, i핀 + 90), "홈 탭에 pinned를 안 단다").toContain("pinned = true");
    // ★ 대화창을 숨기는 규칙이 남아 있으면 나란히가 성립하지 않는다(0-1의 핵심 한 줄).
    // 2026-08-31 개정: **접힘 축(console-folded)이 붙은 숨김만** 허용 — 「필요할 때만
    // 불러서」(온디맨드)의 접힘이다. 무조건 숨김이 되살아나면 여전히 여기서 잡힌다.
    expect(s, "stage-on이 접힘 축 없이 대화창을 숨긴다 — 나란히가 안 된다")
      .not.toMatch(/stage-on(?![^\n]*console-folded)[^\n]*\.console\{display:none/);
  });

  // 🏠 셸 재구축 0-2(2026-08-23) — 56px 세로 레일을 **상단바 안 가로 줄**로 옮겼다.
  //   ★ 이 시험이 지키는 것은 「예뻐졌나」가 아니라 **「지우지 않았나」**다.
  //     railroster.js:18과 titlebar.js mountUserArea가 #gijoRail을 **id로 찾는다**(위치는 안 본다).
  //     요소를 지우면 AI 팀 로스터 10개와 계정·문서함·업데이트 배지가 **통째로 사라지고
  //     오류도 안 난다** — 화면은 멀쩡히 뜬다. QA도 시험도 못 잡는 부류라 여기서 막는다.
  it("상단바 아이콘 줄 — 레일을 옮겼고 지우지 않았다(2026-08-23 셸 재구축 0-2)", () => {
    const s = 코드만(join(PAGES, "app.html"));
    // ① 요소가 살아 있다 — 이게 로스터·계정의 유일한 부착점이다.
    expect(s, "#gijoRail이 사라졌다 — AI 팀 로스터와 계정·문서함이 통째로 죽는다")
      .toMatch(/id="gijoRail"/);
    expect(s, ".rail-foot이 사라졌다 — titlebar.js가 계정을 붙일 자리가 없다")
      .toContain("rail-foot");
    // ② 배지 두 자리 — 없으면 「기한 지난 업무 6건이 어디에도 안 보이던」 2026-08-01 사고 재현.
    expect(s, ".gn-workbadge가 없다 — 기한 지난 업무 수가 어디에도 안 쓰인다").toContain("gn-workbadge");
    expect(s, ".gn-sessbadge가 없다 — 진행중 작업 수가 어디에도 안 쓰인다").toContain("gn-sessbadge");
    // ③ 자리가 상단바 안이다 — .topbar가 닫히기 전에 #gijoRail이 나와야 한다.
    const 상단바 = s.indexOf('class="topbar"');
    const 레일 = s.indexOf('id="gijoRail"');
    const 앱 = s.indexOf('<div class="app">');
    expect(상단바, "상단바를 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(-1);
    expect(앱, ".app을 못 찾았다 — 이 시험이 헛돈다").toBeGreaterThan(-1);
    expect(레일, "레일이 아직 .app 안에 있다 — 상단바로 안 옮겨졌다")
      .toBeGreaterThan(상단바);
    expect(레일, "레일이 .app 뒤에 있다 — 상단바 밖이다").toBeLessThan(앱);
    // ④ 왼쪽 56px 레일 칸은 돌려줬다(0-2) — 이후 0-3이 그 자리에 **메뉴 판 칸**을 세웠다.
    //   빈 칸(56px 레일 잔해)은 여전히 금지지만, 격자의 첫 칸은 이제 var(--menu-w)다.
    expect(s, "프로 .app이 아직 56px 칸을 잡고 있다 — 레일은 옮겼는데 자리가 남았다")
      .not.toMatch(/body\.pro-shell \.app\{grid-template-columns:56px/);
    expect(s, "프로 .app 첫 칸이 메뉴 판(var(--menu-w))이 아니다 — 0-3 두 칸 격자가 깨졌다")
      .toMatch(/body\.pro-shell \.app\{grid-template-columns:var\(--menu-w/);
    // ⑤ 가로로 눕혔다 — 세로 그대로면 44px 상단바에서 잘린다.
    expect(s, "레일이 프로에서 가로로 안 눕는다").toMatch(/body\.pro-shell #gijoRail\{[^}]*flex-direction:row/);
  });

  it("계정·문서함이 상단바 레일에 가로로 붙는다(0-2 짝 — 한쪽만 고치면 잘린다)", () => {
    const t = 코드만(join(PAGES, "titlebar.js"));
    // 부착 조건(#gijoRail + pro-shell)은 그대로여야 한다 — 이게 사라지면 계정이 통째로 없어진다.
    expect(t, "프로 갈래의 부착점(#gijoRail)이 사라졌다").toMatch(/getElementById\("gijoRail"\)/);
    expect(t, "프로 갈래 조건(pro-shell)이 사라졌다").toMatch(/rail && document\.body\.classList\.contains\("pro-shell"\)/);
    // ★ 방향 — 세로로 세우면 44px 상단바에서 아바타 아래가 잘린다.
    expect(t, "계정 영역이 아직 세로다 — 상단바(44px)에서 잘린다")
      .not.toMatch(/getElementById\("gijoRail"\)[\s\S]{0,900}flex-direction:column/);
    expect(t, "계정 영역이 가로로 안 붙는다")
      .toMatch(/getElementById\("gijoRail"\)[\s\S]{0,900}flex-direction:row/);
  });

  // 무대 배선의 나머지 계약(2026-08-20 검토관 상1~상5). 0-1·0-2에서 위 시험을 쪼개며
  // 이 묶음이 갈 곳을 잃어 따로 세웠다 — 검사 내용은 한 줄도 안 바꿨다.
  // ⚠ 제목의 「toChat」은 2026-08-20 당시 이름이다 — 2026-08-31에 그 규칙이 대화앞으로()로
  //   모이면서 「앞으로 낸다」에서 「덮지 말고 나란히」로 바뀌었다. 제목을 그대로 둔 채 아래만
  //   고치면 시험이 자기 이름과 어긋난다.
  it("무대 배선 — 자동 복귀 금지·대화앞으로()·분리창(2026-08-20 상1~상5 · 2026-08-31 개정)", () => {
    const s = 코드만(join(PAGES, "app.html"));
    // ⚠ 선택 자동 복귀는 금지 계약이다(검토관 상1) — gijo:select는 결재 확인창·모달·상세
    //   열기 직후에도 오므로(발신 18곳 중 10곳) 무대를 내리면 방금 연 것이 통째로 숨는다.
    //   허용은 표시(골랐습니다)까지다. (기호는 2026-08-20 맥락 문장 개편으로 📌→🎯)
    expect(s, "선택 자동 복귀가 되살아났다 — 결재 확인창을 삼키는 부류(상1)")
      .not.toMatch(/gijo:select[\s\S]{0,2000}무대숨김 = true/);
    expect(s, "선택 표시(골랐습니다) 피드백이 없다").toContain("🎯 골랐습니다");
    // 대화에 쓰는 부품(질문 얹기·ⓘ)은 무대를 내린다 — 숨은 콘솔에 쓰면 무반응(상4).
    expect(s, "toChat(대화 앞으로) 노출이 없다").toContain("toChat:");
    const c3 = 코드만(join(PAGES, "console.js"));
    // 세 길 모두 **한 규칙**(대화앞으로)을 거친다. 옛 판은 세 곳이 각자 toChat을 불렀는데,
    // 2026-08-31 온디맨드가 들어오며 규칙이 「앞으로」에서 「덮지 말고 나란히」로 바뀌었다 —
    // 규칙이 세 벌이면 하나만 고쳐 놓고 고쳤다고 하게 된다(이 저장소가 반복해 겪은 사본 함정).
    for (const fn of ["function ask(", "function prefill(", "function guideAsk("]) {
      const i = c3.indexOf(fn);
      expect(i, fn + "가 없다").toBeGreaterThan(-1);
      expect(c3.slice(i, i + 400), fn + "가 대화를 앞으로 안 낸다(숨은 콘솔에 쓰면 무반응 — 상4)").toContain("대화앞으로()");
    }
    // 그 한 규칙이 두 갈래를 다 갖췄는가: 화면이 열렸으면 접힘만 풀고(summonConsole),
    // 아니면 무대를 대화로 돌린다(toChat). 한 갈래가 빠지면 ⓘ가 화면을 지우거나(옛 결함)
    // 숨은 콘솔에 쓰거나(상4) 둘 중 하나로 돌아간다.
    const fi = c3.indexOf("function 대화앞으로(");
    expect(fi, "대화앞으로()가 없다").toBeGreaterThan(-1);
    const 규칙 = c3.slice(fi, fi + 420);
    expect(규칙, "화면이 열렸을 때 접힘만 푸는 갈래가 없다").toContain("summonConsole");
    expect(규칙, "무대 판정(stage-on)이 없다").toContain("stage-on");
    expect(규칙, "화면이 없을 때 무대를 대화로 돌리는 갈래가 없다").toContain("toChat");
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
    // 계약 개정(2026-08-31): 「카드가 뜨면 무대를 내린다」 갈래는 카드-only 경로와 함께
    // 사라졌다 — 이제 화면이 열리며 카드가 오른쪽 대화창에 나란히 뜬다. 그 자리의 불변식은
    // 「화면을 보이는 모든 길(show)은 무대를 올린다」다(무대 뒤 화면=무반응 방지).
    expect(s, "show()가 무대를 안 올린다(화면+대화 나란히가 안 된다)").toMatch(/function show\(page\) \{[\s\S]{0,400}무대숨김 = false/);
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

describe("지식 창고 잣대 통일 — 「올린 문서」 수는 한 가지로(2026-08-31 설계관)", () => {
  // 왜: 같은 화면에서 위 요약 카드(grouppanels)와 아래 목록 제목(memory.html)이 **다른 숫자**를
  //   말했다 — 카드는 개인 문서(personal:)를 빼고 세는데 목록은 포함해서. 카드 언어로 묶으면
  //   두 숫자가 나란히 서서 바로 눈에 띈다. 세 소비자(요약 카드·목록·내 문서 배지)가 같은
  //   규칙을 쓰는지 값으로 지킨다(「같은 것을 여러 곳에 적으면 어긋난다」의 계보).
  it("요약 카드·지식 창고 목록·내 문서 배지가 모두 personal:을 뺀다", () => {
    const gp = 코드만(join(PAGES, "grouppanels.js"));
    expect(gp, "요약 카드가 개인 문서를 안 뺀다").toMatch(/documentId\)\.indexOf\("personal:"\) !== 0/);
    const mem = 코드만(join(PAGES, "memory.html"));
    expect(mem, "지식 창고 목록이 개인 문서를 포함해 센다 — 카드와 딴말을 한다")
      .toMatch(/listMemoryDocuments\(\)[\s\S]{0,200}indexOf\("personal:"\) !== 0/);
    const md = 코드만(join(PAGES, "mydocs.html"));
    expect(md, "내 문서 배지의 회사문서만 잣대가 사라졌다").toContain("회사문서만");
  });
});

describe("카드 언어 — 지식 창고 보기 전환(2026-08-31 사장님 「히트맵은 있었으면」)", () => {
  it("히트맵은 있고 **기본은 목록**이다 — 기본이 뒤집히면 게시 관문이 막힌다", () => {
    const m = 코드만(join(PAGES, "memory.html"));
    expect(m, "보기 전환 칩이 없다").toContain('id="dmViewSeg"');
    expect(m, "히트맵 보기가 없다").toContain('dmView === "heat"');
    // ⚠ 기본값 계약: publish-gate ③′가 `.g-rows--docs .g-rows-r > 0`을 요구한다 —
    //   기본이 히트맵이 되면 행이 0이라 게시가 막힌다(설계관 ⑤-9가 미리 짚은 자리).
    expect(m, "기본 보기가 목록이 아니다 — 게시 관문(.g-rows-r>0)이 막힌다").toMatch(/dmView\s*=\s*"list"/);
    // 공용 부품을 쓴다(화면 전용 타일 CSS를 새로 만들지 않았는지)
    expect(m, "히트맵이 공용 타일 부품을 안 쓴다").toContain("g-tiles");
    const css = 코드만(join(PAGES, "gijo-ui.css"));
    // ⚠ 목록은 **쓰이는 것만**(2026-08-31 검토관): 안 쓰는 겉껍데기(.g-scard-h 등)를 계약에
    //   넣으면 죽은 CSS가 감시로 굳는다. 실제 소비자가 있는 셋만 지킨다.
    for (const 부품 of [".g-scard-k", ".g-seg", ".g-tiles", ".g-tile"]) {
      expect(css, `공용 카드 골격 ${부품}가 사라졌다`).toContain(부품);
    }
  });
});
