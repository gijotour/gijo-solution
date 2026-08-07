// 셸의 상단·하단 고정 바가 **창 안에 머무는 구조인지** 지킨다 (2026-08-02 신설).
//
// 왜: 사용자 신고 "상단 하단 고정탭 아직도 문제있음 … 고정값이 필요할듯".
//   실측하니 하단 바가 창 밖(위치 912 / 창 900)으로 밀려나 아예 안 보였다.
//   원인은 격자 줄 높이가 **auto**라 내용이 요구하는 만큼 늘어난 것 —
//   안쪽이 900px를 요구해 854px 칸을 넘겼고 그만큼 아래가 밀렸다.
//   좌표는 실앱에서만 재지만, **줄 높이를 못 박는 규칙이 사라지는 것**은 여기서 잡는다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP = fs.readFileSync(
  path.resolve(__dirname, "../../client/src/renderer/pages/app.html"),
  "utf-8"
);

describe("셸 뼈대 — 상단·하단 고정 바", () => {
  it("본문 격자의 **줄 높이를 못 박는다** — auto면 내용이 밀어내 하단 바가 창 밖으로 나간다", () => {
    const m = APP.match(/\.app\{[^}]*\}/s);
    expect(m, ".app 규칙이 없다").toBeTruthy();
    expect(m![0]).toContain("grid-template-rows:minmax(0,1fr)");
  });

  // 2026-08-07 상단 통합(시안 승인): 조작줄(#shellHeader 46px)을 없애고 **탭줄 하나(44px)**가
  // 상단 바다. 경로 표시가 두 함수에서 따로 갱신돼 어긋나던 사고의 구조적 제거 — 옛 조작줄이
  // 되살아나면 그 사고도 되살아나므로, 없는 것을 여기서 못 박는다.
  it("옛 조작줄(#shellHeader)은 없다 — 되살리면 경로 어긋남 사고도 되살아난다", () => {
    expect(APP).not.toContain('id="shellHeader"');
  });

  it("세로 층 — 몸통이 flex 세로이고 탭줄·하단 바는 줄어들지 않는다", () => {
    expect(APP).toMatch(/body\{[^}]*flex-direction:column/s);
    const 탭줄 = APP.match(/\.tabbar\{[^}]*\}/s);
    const 하단 = APP.match(/\.shellfoot\{[^}]*\}/s);
    expect(탭줄![0]).toContain("flex:0 0 auto");   // 눌리면 OS 창 버튼이 삐져나온다
    expect(하단![0]).toContain("flex:0 0 auto");
  });

  it("가운데 칸만 늘어난다(flex:1) — 그래야 위·아래가 제자리에 남는다", () => {
    const m = APP.match(/\.app\{[^}]*\}/s);
    expect(m![0]).toContain("flex:1");
    expect(m![0]).toContain("min-height:0");
  });

  it("탭줄 높이(44px)는 OS 창 버튼(titleBarOverlay)과 같다 — 다르면 버튼이 삐져나온다", () => {
    const 탭줄 = APP.match(/\.tabbar\{[^}]*\}/s);
    expect(탭줄![0]).toMatch(/height:44px/);
    const MAIN = fs.readFileSync(path.resolve(__dirname, "../../client/src/main.ts"), "utf-8");
    expect(MAIN, "main.ts 오버레이 높이가 탭줄과 다르다").toMatch(/titleBarOverlay:\s*\{[^}]*height:\s*44/);
  });

  it("탭줄에 정보 자리(#tbInfo)가 있다 — 시계·서버상태·세션이 셸 한 곳에 모인 자리", () => {
    expect(APP).toContain('id="tbInfo"');
  });
});
