// 프로 판정 — 사장님 결정 2026-08-18 「프로 판정부터 먼저 만들기」
//
// ■ 왜 이것부터인가
//   승인 시안 mockups/프로_대화창메인은 「프로 전용 셸」인데, 착수 전 검토가 **프로를 읽을 방법이
//   아예 없다**는 것을 찾았다: `main.ts`의 에디션이 `lite`가 아니면 **전부 `standard`로 접는다**.
//   시안 자신도 그 자리를 「추가 조사가 필요하다」고 정직하게 남겨 두었다.
//   ⇒ 셸을 그리기 전에 **무엇을 보고 프로라고 할지**부터 정한다.
//
// ■ 핵심 결정 — 에디션과 셸 모드는 **다른 축**이다
//     · 에디션(lite/standard) = 어떤 상품인가. 데이터 폴더·진입점·도구 개수(13 vs 78)를 가른다.
//     · 셸 모드(standard/pro) = 화면을 어떻게 그리나. 프로는 도구도 데이터도 스탠다드와 같다.
//   한 칸에 넣으면 프로를 고른 순간 **데이터 폴더가 갈리거나 도구가 줄어든다** — 아무도 원치 않는다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const main = 읽기("../../client/src/main.ts");
const preload = 읽기("../../client/src/preload.ts");
const 로그인 = 읽기("../../client/src/renderer/pages/login.html");
const 설정 = 읽기("../../client/src/renderer/pages/settings.html");

describe("프로 판정 — 축을 섞지 않는다", () => {
  it("★★ 에디션에 「pro」를 넣지 않았다 — 데이터 폴더가 갈리면 안 된다", () => {
    // `에디션()`이 pro를 돌려주면 라이트모드전환()·데이터 폴더 분기가 함께 흔들린다.
    const fn = main.slice(main.indexOf("function 에디션(): string"), main.indexOf("function 라이트모드전환"));
    expect(fn, "에디션 함수를 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
    expect(fn, "에디션이 pro를 돌려준다 — 데이터 폴더·도구 개수가 함께 흔들린다").not.toContain('"pro"');
  });

  it("셸 모드가 따로 있고, 라이트에서는 못 쓴다", () => {
    expect(main, "셸 모드 조회 통로가 없다").toContain('ipcMain.handle("shell:get"');
    expect(main, "셸 모드 저장 통로가 없다").toContain('ipcMain.handle("shell:set"');
    // 라이트는 자기 셸(lite-app.html)이 따로라 프로 셸이 뜻이 없다.
    expect(main, "라이트에서 프로 셸을 막지 않는다").toMatch(/if \(에디션\(\) === "lite"\) return \{ ok: false/);
  });

  it("★ 셸 모드는 재시작을 요구하지 않는다 — 에디션과 다르다", () => {
    // 에디션은 진입점·도구가 부팅 때 갈려 재시작이 필요하지만, 셸 모드는 화면 그리기일 뿐이다.
    // 여기서 재시작을 요구하면 「등급만 바꿨는데 왜 앱을 껐다 켜야 하지」가 된다.
    const fn = main.slice(main.indexOf('ipcMain.handle("shell:set"'), main.indexOf('ipcMain.handle("edition:set"'));
    expect(fn, "셸 모드가 재시작을 요구한다").not.toContain("재시작필요");
  });

  it("preload에 다리가 있다 — 없으면 「설계는 됐고 쓰인 적 없다」가 된다", () => {
    expect(preload, "셸 모드 조회 다리가 없다").toContain('ipcRenderer.invoke("shell:get")');
    expect(preload, "셸 모드 저장 다리가 없다").toContain('ipcRenderer.invoke("shell:set"');
  });
});

describe("★ 프로를 고르는 자리가 **둘 다** 같은 값을 쓴다", () => {
  it("로그인 화면의 프로 버튼이 셸 모드를 기록한다", () => {
    expect(로그인, "로그인에서 프로를 골라도 셸 모드가 안 남는다").toMatch(
      /window\.gijo\.shellModeSet\) await window\.gijo\.shellModeSet\(고른모드\.값\)/
    );
  });

  it("설정의 제품 구성 3택도 같은 값을 쓴다", () => {
    expect(설정, "설정에서 프로를 골라도 셸 모드가 안 남는다").toMatch(/shellModeSet\("pro"\)/);
    // ⚠ 내려올 때도 되돌려야 한다 — 안 되돌리면 등급은 표준인데 셸만 프로로 남는다.
    expect(설정, "프로에서 내려올 때 셸 모드를 안 되돌린다").toMatch(/shellModeSet\("standard"\)/);
  });

  it("★ 서버 등급 조회 실패를 스탠다드로 **단정하지 않는다**", () => {
    // 서버가 잠깐 죽었을 뿐인데 셸이 통째로 바뀌면 담당자는 제품이 고장 난 줄 안다.
    expect(설정, "등급 조회 실패를 스탠다드로 단정한다").toContain("등급실패");
    expect(설정, "실패를 화면에 안 알린다").toMatch(/엔진 등급 확인 실패/);
  });

  it("★ 셸 모드 기록이 서버 실패에 발목 잡히지 않는다", () => {
    // 등급을 못 바꿨다고 화면 선택까지 못 할 이유는 없다 — 두 축이 다르기 때문이다.
    const 구간 = 로그인.slice(로그인.indexOf("if (고른모드.값) {"), 로그인.indexOf("if (고른위치.값) {"));
    const iCatch = 구간.indexOf("못한것.push(\"구동 모드(");
    const iShell = 구간.indexOf("shellModeSet");
    expect(iShell, "셸 모드 기록이 없다").toBeGreaterThan(0);
    expect(iShell, "셸 모드 기록이 서버 호출 try 안에 있다 — 서버가 거절하면 같이 죽는다").toBeGreaterThan(iCatch);
  });
});

describe("★ 아직 안 만든 것을 만들었다고 하지 않는다", () => {
  it("프로 셸(화면 개편)은 아직 없다 — 그 사실이 주석에 남아 있다", () => {
    // 이 커밋은 **판정만** 만든다. 화면을 바꾸는 일(레일·팔레트·캔버스)은 다음이다.
    // 그런데 「프로를 골랐다」는 사실은 잃지 않고 담아 둔다 — 그래야 다음이 이어진다.
    expect(로그인, "아직 화면을 안 바꾼다는 사실이 안 적혀 있다").toMatch(/프로 셸\)은 \*\*아직 구현 전\*\*/);
    // 몸통이 없는데 body 클래스를 붙이는 코드가 미리 들어가 있으면 안 된다(반쪽 구현).
    const 셸 = 읽기("../../client/src/renderer/pages/app.html");
    expect(셸, "셸이 프로 분기를 반쯤 켰다 — 화면 개편은 아직 착수 전이다").not.toMatch(/pro-shell|chat-home/);
  });
});
