// 메뉴 항목이 **아무 데도 연결되지 않은 채** 남지 않는지 본다 (클라 nav.js ↔ preload.ts 대조).
//
// ⚠ 실사고(2026-07-31, 4.9.0): 문서함을 메뉴에 더했는데 **눌러도 아무 일도 일어나지 않았다.**
//   클릭 처리가 `it.office`(팀 사무실)만 보고 있어서, 창 항목인 문서함이 탭 열기로 떨어졌고
//   `it.page`가 없으니 undefined 탭을 열려다 조용히 실패했다. 오류도 안 났다.
//
//   왜 못 잡았나 — 세 겹이 전부 이 유형을 못 본다:
//     · 스윕(menu-sweep)은 `(창)` 항목을 **일부러 건너뛴다**(탭으로 안 열리니 거짓 실패가 난다)
//     · 게시 전 실화면 검증에서 나는 `window.gijo.openDocbox()`를 **직접 불렀다** — 메뉴를
//       거치지 않아 통과했다. 창은 정상이었고 그 창으로 가는 길만 끊겨 있었다
//     · 서버 시험은 클라를 안 본다
//   그래서 여기서 **연결 자체**를 본다: 모든 항목은 page(탭) 아니면 win(창)을 가져야 하고,
//   win은 preload가 실제로 노출한 이름이어야 한다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const navSrc = fs.readFileSync(new URL("../../client/src/renderer/pages/nav.js", import.meta.url), "utf8");
const preloadSrc = fs.readFileSync(new URL("../../client/src/preload.ts", import.meta.url), "utf8");

/** nav.js의 메뉴 선언에서 항목을 뽑는다(정규식 — 항목은 한 줄 리터럴로 적는 것이 이 파일의 관례). */
function menuItems(): { line: string; label: string; page?: string; win?: string }[] {
  const out: { line: string; label: string; page?: string; win?: string }[] = [];
  for (const line of navSrc.split("\n")) {
    const label = line.match(/label:\s*"([^"]+)"/);
    if (!label) continue;
    if (!/^\s*\{/.test(line)) continue; // 항목 리터럴만
    // 그룹 머리(`{ id: "monitor", ic: "🖥", label: "관제", items: [`)는 누르는 항목이 아니라
    // 접었다 펴는 가지다 — page도 win도 없는 게 정상이므로 뺀다.
    if (/\bitems:\s*\[/.test(line)) continue;
    out.push({
      line: line.trim(),
      label: label[1],
      page: line.match(/page:\s*"([^"]+)"/)?.[1],
      win: line.match(/win:\s*"([^"]+)"/)?.[1],
    });
  }
  return out;
}

describe("메뉴 항목은 전부 어딘가로 연결돼 있다", () => {
  const items = menuItems();

  it("항목을 실제로 읽어 온다 — 정규식이 헛돌면 이 시험 전체가 거짓 통과다", () => {
    expect(items.length).toBeGreaterThan(20);
    expect(items.some((i) => i.label.includes("문서함"))).toBe(true);
    expect(items.some((i) => i.label.includes("팀 사무실"))).toBe(true);
  });

  it("모든 항목이 page(탭) 또는 win(창) 중 하나를 가진다", () => {
    const 미연결 = items.filter((i) => !i.page && !i.win);
    expect(미연결.map((i) => i.label), "이 항목들은 눌러도 아무 일도 일어나지 않는다").toEqual([]);
  });

  it("win 이름은 preload가 실제로 노출한 것이어야 한다", () => {
    // 오타 하나면 클릭이 죽는다. preload에 `openDocbox: () => ...` 형태로 있어야 한다.
    for (const it_ of items.filter((i) => i.win)) {
      expect(preloadSrc, `preload에 ${it_.win}이 없다 — "${it_.label}"이 안 열린다`)
        .toMatch(new RegExp(`\\b${it_.win}\\s*:`));
    }
  });

  it("창 항목은 이름 끝에 (창)을 달아 스윕이 알아본다", () => {
    // menu-sweep은 이 표기로 창 항목을 건너뛴다 — 안 달면 스윕이 거짓 실패를 낸다.
    for (const it_ of items.filter((i) => i.win)) {
      expect(it_.label, `창으로 여는 "${it_.label}"에 (창) 표기가 없다`).toMatch(/\(창\)/);
    }
  });

  it("탭 항목에는 (창) 표기가 없다 — 붙이면 스윕이 그 화면을 영영 안 본다", () => {
    const 오표기 = items.filter((i) => i.page && /\(창\)/.test(i.label));
    expect(오표기.map((i) => i.label)).toEqual([]);
  });
});

describe("클릭 처리가 항목별 이름을 다시 하드코딩하지 않는다", () => {
  // 원인은 "문서함을 안 더한 것"이 아니라 **분기를 이름으로 짠 것**이었다.
  // win을 보고 처리하면 창 항목을 더해도 클릭 처리를 고칠 일이 없다.
  it("win으로 일반 처리한다", () => {
    expect(navSrc).toMatch(/if\s*\(it\.win\)/);
    expect(navSrc, "항목 이름으로 분기하면 다음 창 항목에서 같은 사고가 난다").not.toMatch(/if\s*\(it\.office\)/);
  });

  it("열 함수가 없으면 조용히 넘기지 않는다", () => {
    // 조용히 실패하면 "눌러도 안 열린다"는 증상만 남고 단서가 없다(4.9.0에서 그랬다).
    const 블록 = navSrc.slice(navSrc.indexOf("if (it.win)"), navSrc.indexOf("if (it.win)") + 600);
    expect(블록).toMatch(/alert|console\.(error|warn)/);
  });
});

describe("내 업무 — 고르면 직전 가이드가 남지 않는다", () => {
  // ⚠ 실사고(2026-07-31, 게시본 4.10.0 실측): 다른 업무를 골랐는데 **직전 업무의 단계가
  //   그대로 떠 있었다**("AI-BOM 점검"을 골랐는데 "보고서 파일 올리기"가 보였다).
  //   가이드를 받아오는 동안 이전 화면이 남아서였다. 담당자가 그걸 보고 따라 하면
  //   엉뚱한 일을 한다 — 안내 화면에서 이건 느린 것보다 나쁘다.
  //   (내 검증 하네스도 '단계 수 > 0'만 보고 통과시킬 뻔했다 — 제목까지 봐야 한다.)
  const src = fs.readFileSync(new URL("../../client/src/renderer/pages/mywork.html", import.meta.url), "utf8");

  it("가이드를 받아오기 전에 머리글을 먼저 바꾼다", () => {
    expect(src, "받아오는 동안 이전 가이드가 남는다").toContain("순서를 불러오는 중…");
  });

  it("늦게 온 응답이 새로 고른 화면을 덮어쓰지 않는다", () => {
    // 기다리는 사이 다른 업무를 골랐으면 그 결과는 버려야 한다(같은 버그의 반대 방향).
    expect(src).toMatch(/if\s*\(selId\s*!==\s*t\.id\)\s*return;/);
  });
});
