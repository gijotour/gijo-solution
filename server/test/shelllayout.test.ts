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

  it("세로 3층이다 — 몸통이 flex 세로이고 위·아래 바는 줄어들지 않는다", () => {
    expect(APP).toMatch(/body\{[^}]*flex-direction:column/s);
    const 상단 = APP.match(/#shellHeader\{[^}]*\}/s);
    const 하단 = APP.match(/\.shellfoot\{[^}]*\}/s);
    expect(상단![0]).toContain("flex:0 0 auto");   // 눌리면 OS 창 버튼이 삐져나온다
    expect(하단![0]).toContain("flex:0 0 auto");
  });

  it("가운데 칸만 늘어난다(flex:1) — 그래야 위·아래가 제자리에 남는다", () => {
    const m = APP.match(/\.app\{[^}]*\}/s);
    expect(m![0]).toContain("flex:1");
    expect(m![0]).toContain("min-height:0");
  });

  it("상단 바 높이는 OS 창 버튼(titleBarOverlay)과 같은 46px이다", () => {
    const 상단 = APP.match(/#shellHeader\{[^}]*\}/s);
    expect(상단![0]).toMatch(/min-height:46px/);
  });
});
