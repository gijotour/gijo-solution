// 팝업 릴레이 목록 — 새 gijo:* 신호가 팝업에서만 조용히 죽지 않게 (2026-08-19 점검 보고 위험②)
//
// ■ 왜
//   프로 팝업의 배관은 두 겹이다: 탭은 postMessage, 별도 창은 IPC 릴레이(nav.js applyPopout).
//   릴레이할 타입이 nav.js에 **손목록**(select·scope·openTab)이라, 새 gijo:* 타입을 만들고
//   목록에 안 넣으면 **탭에서는 되는데 팝업에서만 조용히 죽는다** — 오류도 없다.
//   `#범위` 표식이 ALL_MARKS에 빠졌던 것과 같은 부류라, 같은 방식(전수 대조)으로 지킨다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const 읽기 = (p: string) => fs.readFileSync(new URL(`../../client/src/renderer/pages/${p}`, import.meta.url), "utf8");
const nav = 읽기("nav.js");
const 셸 = 읽기("app.html");

/** 셸이 message 리스너에서 받는 gijo:* 타입 전수 — 처리부의 d.type 비교에서 뽑는다. */
function 셸이받는타입(): string[] {
  return [...new Set([...셸.matchAll(/d\.type === "(gijo:[a-z:]+)"/gi)].map((m) => m[1]))];
}
/** nav.js 릴레이 목록 — applyPopout의 d.type 비교에서 뽑는다. */
function 릴레이타입(): string[] {
  const i = nav.indexOf("function applyPopout()");
  const 구간 = nav.slice(i, i + 2500);
  return [...new Set([...구간.matchAll(/d\.type !== "(gijo:[a-z:]+)"/gi)].map((m) => m[1]))];
}

describe("팝업 릴레이 — 목록이 어긋나면 팝업에서만 조용히 죽는다", () => {
  it("추출이 헛돌지 않는다 — 양쪽 다 실제로 잡힌다", () => {
    expect(셸이받는타입().length, "셸 수신 타입을 못 뽑았다 — 이 시험이 헛돈다").toBeGreaterThanOrEqual(4);
    expect(릴레이타입().length, "릴레이 목록을 못 뽑았다").toBeGreaterThanOrEqual(3);
  });

  it("★★ 화면이 셸로 보내는 상호작용 타입은 릴레이 목록에도 있다", () => {
    // 팝업에서도 뜻이 있는 타입만 요구한다. 제외는 **이유와 함께** 여기 적는다:
    //   gijo:view    — 「보는 목록」은 활성 탭 기준 개념이라 팝업에선 뜻이 없다(의도적 제외)
    //   gijo:explain·gijo:ask·gijo:prefill — 안내·대필은 화면 ⓘ가 셸 대화창을 부르는 것으로,
    //     팝업에는 자기 chatwidget이 있어 릴레이가 필요 없다
    //   gijo:scope:set — 방향이 반대다(셸→화면 배포용)
    const 제외 = new Set(["gijo:view", "gijo:explain", "gijo:ask", "gijo:prefill", "gijo:scope:set",
      // dockback — 팝업의 ⇤ 버튼이 bridgeToShell(IPC)로 **직접** 보낸다. postMessage를 안 거치므로
      // 릴레이 목록에 없어도 죽는 경로가 없다(2026-08-19 도킹 구현).
      "gijo:dockback",
      // pickdone — 고르기 모드(pick.html) 전용. 그 화면은 카드의 🎯 단추로 **무대에만** 열린다
      // (프로 팝업 자동 폐지·창은 (창) 메뉴뿐이라 팝업 안에서 열릴 진입로가 없다). 무대 내림이
      // 신호의 본질이라 팝업에선 애초에 뜻이 없다(승인 시안 stage-picker, 2026-08-20).
      "gijo:pickdone"]);
    const 빠진것 = 셸이받는타입().filter((t) => !제외.has(t) && !릴레이타입().includes(t));
    expect(빠진것, "릴레이 목록에 없는 타입 — 팝업에서 이 신호가 조용히 죽는다. 넣거나, 위 제외 목록에 이유와 함께 적어라").toEqual([]);
  });

  it("★ 릴레이는 출처(source)로 거르지 않는다 — 허브 안 iframe의 선택이 조용히 죽는다(P4)", () => {
    // 2026-08-19 계약 반전: 처음엔 source===window만 잡았는데, 허브형 화면을 창으로 열면
    // 안쪽 iframe發 선택의 source가 iframe이라 버려졌다(프로 사용자 테스트 P4 실측).
    // 이 창의 문서는 전부 로컬 파일 + 타입 화이트리스트가 지키므로 source 검사를 하지 않는다.
    const i = nav.indexOf("function applyPopout()");
    const 구간 = nav.slice(i, i + 2800);
    expect(구간, "source 필터가 되살아났다 — 허브-인-팝업 선택이 다시 죽는다").not.toContain("ev.source !== window");
    expect(구간, "빈 데이터 방어는 유지").toContain("if (!d) return;");
  });

  it("★ 본창은 받은 것을 재주입한다 — 처리 코드를 복제하지 않는다", () => {
    expect(셸, "재주입이 없다 — 릴레이가 와도 처리가 안 된다").toMatch(/onShellBridge[\s\S]{0,300}window\.postMessage\(d/);
  });
});

// ── 프로 홈 히어로(승인 시안 프로_홈_인사) — .cs-empty 계약 감시 ─────────────────
describe("프로 홈 히어로 — 빈 상태 계약", () => {
  const 콘솔 = fs.readFileSync(new URL("../../client/src/renderer/pages/console.js", import.meta.url), "utf8");
  it("★ .cs-empty는 build 마크업에 정확히 1곳 — 제거 지점 3곳(append·갈래카드·guideAsk)이 이 계약에 의존한다", () => {
    const n = (콘솔.match(/class="cs-empty"/g) || []).length;
    expect(n, `.cs-empty 마크업이 ${n}곳 — 1곳이어야 제거가 한 번에 된다`).toBe(1);
  });
  it("히어로 칩은 기존 통로만 부른다 — 새 입력칸·새 IPC 금지(시안 결정)", () => {
    const i = 콘솔.indexOf("function renderHero()");
    expect(i).toBeGreaterThan(0);
    const 본문 = 콘솔.slice(i, i + 2200);
    expect(본문).toContain("ask(b.dataset.q)");
    expect(본문).toContain("gijoTabs.open");
    expect(본문).not.toMatch(/<input|<textarea/i);
  });
});
