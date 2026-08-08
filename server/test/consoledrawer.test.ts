// 대화창 서랍(무엇을 할 수 있나) — [2026-08-06 사용자 신고 2건]
//   ① "등록 메뉴가 있는데 개인적으로 등록하려는데 안 되네" — ＋등록을 눌러도 아무 일이 없었다.
//      원인: 스타일(.cs-addbox)만 있고 **입력칸을 그리는 코드가 없었다**(만들어만 두고 안 부름).
//   ② "무엇을 할 수 있나를 해당 메뉴에서 할 수 있는 것으로" — 갈래가 화면과 무관하게 고정이었다.
//
// 이 시험은 소스를 읽는다 — 눌러 보는 시험(실앱)은 QA 스윕이 하고, 여기서는 **약속한 코드가
// 실제로 있는지**를 지킨다(2026-07-29 "주석에 적어 놓고 코드가 안 지키는 것" 계열 방지).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "..", "client", "src", "renderer", "pages", "console.js"), "utf8");

describe("서랍 ＋등록 — 만들어만 두지 않는다", () => {
  it("★ 입력칸·저장·취소를 실제로 그린다(id가 렌더 문자열에 있다)", () => {
    for (const id of ["csAddInput", "csAddSave", "csAddCancel"]) {
      // getElementById로 찾기만 하고 그리지 않으면 영원히 null이다 — 그리는 쪽(id=")도 있어야 한다.
      expect(src, `${id}를 찾기만 하고 그리지 않는다 — ＋등록이 죽는다`).toContain(`id="${id}"`);
    }
  });

  it("등록한 지시가 서랍 목록에 합쳐진다 — 저장만 하고 안 보이면 등록이 아니다", () => {
    expect(src).toMatch(/내지시목록\(\)[\s\S]{0,400}cats\.unshift/);
    expect(src, "내가 등록한 갈래에 삭제(✕)가 없다").toContain("data-del=");
  });

  it("우리 기본 목록은 담당자가 못 지운다 — 삭제는 내가 등록한 것만", () => {
    expect(src).toMatch(/c\.mine \?[\s\S]{0,120}cs-del/);
  });
});

describe("서랍 — 지금 보는 화면 것을 먼저", () => {
  it("★ 갈래마다 화면 태그가 있고, 지금 화면이면 위로 올린다", () => {
    expect(src, "갈래에 screens 태그가 없다").toMatch(/screens: \[/);
    expect(src, "지금 화면 갈래를 위로 올리는 정렬이 없다").toMatch(/cats\.sort\(/);
    expect(src, "「지금 화면」 표시가 없다 — 왜 위에 있는지 알 수 없다").toContain("지금 화면");
  });

  it("★ 탭이 바뀌면 서랍을 다시 그린다 — 안 그리면 옆 화면 것이 위에 남는다", () => {
    const i = src.indexOf("function applyCtx");
    expect(i).toBeGreaterThan(0);
    // 2026-08-09 메뉴 연동 재설계로 applyCtx가 길어졌다(구분선·칩·절차 띠) — 창을 함수 전체로 넓힌다.
    // 계약은 그대로다: renderDrawer 호출이 applyCtx **안**에 있어야 한다.
    expect(src.slice(i, i + 3500), "applyCtx가 renderDrawer를 안 부른다").toContain("renderDrawer()");
  });

  it("갈래를 지우지는 않는다 — 대화창은 화면 경계를 가로지른다(2026-07-31 결정 유지)", () => {
    // 화면에 맞는 것만 남기고 나머지를 **거르면** 안 된다. 정렬(sort)이지 필터가 아니어야 한다.
    expect(src).not.toMatch(/cats\s*=\s*cats\.filter\([^)]*지금/);
    for (const cat of ["지금 급한 것", "살펴보기", "처리하기", "정리하기", "설정·관리"]) {
      expect(src, `갈래 「${cat}」가 사라졌다`).toContain(cat);
    }
  });
});
