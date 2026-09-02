// 첫 화면 라우팅 · 프로 규칙 배너 · 실시간 끊김 알림 — 2026-09-02 승인 시안 구현분의 감시.
//
// ■ 왜 이 시험이 있나
//   오늘 넣은 셋은 **조용히 깨지는 부류**다. 라우팅이 되돌아가도 오류가 안 나고(그냥 설정 화면이
//   다시 뜬다), 배너가 안 그려져도 아무도 모르고, 끊김 칩이 안 떠도 화면은 멀쩡해 보인다.
//   같은 날 「프로 첫 화면 대시보드」가 **죽은 코드인데 시험은 초록**이던 사고를 겪었으므로,
//   이번엔 **자리와 조건까지** 잰다 — 「글자가 있나」가 아니라 「그 조건이 그 자리에 있나」다.
//
// 계획서: 전-7(보여 주기) 갈래 — 첫인상과 「지시는 대화창」 규칙 전달이 여기 걸린다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const 읽기 = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const main = 읽기("../../client/src/main.ts");
const 셸 = 읽기("../../client/src/renderer/pages/app.html");
const 상단바 = 읽기("../../client/src/renderer/pages/titlebar.js");
const ws = 읽기("../../client/src/wsClient.ts");
const preload = 읽기("../../client/src/preload.ts");
const 학습 = 읽기("../../client/src/renderer/pages/learnloop.html");

describe("F1-01 — 고른 것을 기억한다(매번 「관리자 계정 만들기」를 다시 묻지 않는다)", () => {
  it("★ 첫 화면 라우팅이 「전에 로그인한 적이 있나」를 함께 본다", () => {
    // 분산 모드 담당자는 로컬 DB가 없어 첫설치가 **영원히 참**이다 — 그것만 보면 매번 설정 화면이다.
    expect(main, "라우팅이 로그인 기록을 안 본다 — 매번 설정 화면이 다시 뜬다").toMatch(
      /첫설치인가\(\)\s*&&\s*!로그인한적있나\(\)\s*\?\s*"setup\.html"/
    );
  });

  it("★★ 판정 함수(첫설치)는 **그대로** 둔다 — 합치면 돌아갈 길이 막힌다", () => {
    // 첫설치 = 「로컬 DB가 없다 = 설정이 **가능**하다」. setupNeeded()가 이 값을 그대로 준다.
    // 여기에 로그인 기록 조건을 합치면, 원격 서버를 쓰던 사람이 나중에 자기 PC에 서버를 세우려 할 때
    // 로그인 화면의 「처음 설정으로」가 영영 안 뜬다 — 갈 곳을 잃는다.
    const fn = main.slice(main.indexOf("export function 첫설치인가()"), main.indexOf("export function 로그인한적있나()"));
    expect(fn, "첫설치인가를 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
    expect(fn, "첫설치 판정에 로그인 기록이 섞였다 — 「처음 설정으로」 돌아갈 길이 막힌다")
      .not.toContain("로그인한적있나");
  });

  it("새 파일·새 통로를 만들지 않았다 — 이미 쌓이는 로그인 기록을 읽기만 한다", () => {
    const fn = main.slice(main.indexOf("export function 로그인한적있나()"), main.indexOf("export function 로그인한적있나()") + 200);
    expect(fn, "로그인한적있나가 readCreds를 안 쓴다 — 새 저장소를 만들었나").toContain("readCreds()");
  });
});

describe("F3-10 — 프로 규칙 한 줄이 **한 번만** 보인다", () => {
  it("★ 배너를 켜는 자리가 boot()의 프로 분기 **안**이다(죽은 코드 재발 방지)", () => {
    // 2026-09-02에 「프로 첫 화면 대시보드」가 프로 분기 **밖**에 있어 영영 안 돌던 사고가 있었다.
    const boot구간 = 셸.slice(셸.indexOf("function boot()"), 셸.indexOf("var st = null;"));
    const i배너 = boot구간.indexOf("규칙배너()");
    const i반환 = boot구간.lastIndexOf("return;");
    expect(i배너, "프로 분기 안에서 규칙배너를 안 부른다").toBeGreaterThan(0);
    expect(i배너, "규칙배너 호출이 return 뒤에 있다 — 죽은 코드다").toBeLessThan(i반환);
  });

  it("★ 한 번 닫으면 다시 안 그린다(저장하고 그 값을 본다)", () => {
    expect(셸, "배너를 닫은 기록을 저장하지 않는다 — 매번 다시 뜬다").toContain('localStorage.setItem(RULE_KEY, "1")');
    expect(셸, "저장값을 읽지 않는다 — 저장만 하고 안 본다").toMatch(/getItem\(RULE_KEY\)/);
  });

  it("배너가 세로 층에서 눌리지 않는다(flex 자식 계약)", () => {
    const css = 셸.match(/#proRule\{[^}]*\}/s);
    expect(css, "#proRule 규칙을 못 찾았다").toBeTruthy();
    expect(css![0], "flex:0 0 auto가 없다 — 좁은 창에서 배너가 눌린다").toContain("flex:0 0 auto");
  });

  it("★ 없는 색을 쓰지 않는다 — --blue-soft는 이 저장소에 없다", () => {
    // 승인 시안이 `var(--blue-soft)`를 쓰겠다고 적었는데 그 토큰은 저장소 어디에도 없었다(설계 검토).
    expect(셸, "존재하지 않는 색 토큰을 쓴다").not.toContain("--blue-soft");
    expect(셸, "다크 배색 폴백이 없다 — 표준 배색에서 글자가 안 보인다").toMatch(/var\(--blue-ink,\s*#/);
  });
});

describe("F6-11 — 실시간 연결이 끊긴 것을 알린다", () => {
  it("★ 끊긴 시각이 재시도마다 밀리지 않는다 — 밀리면 문턱을 영영 못 센다", () => {
    // 5초마다 재접속이 실패할 때 끊긴 시각을 새로 찍으면 「15초 넘게 끊겼나」가 영원히 거짓이 된다.
    expect(ws, "끊긴 시각을 재시도마다 새로 찍는다 — 문턱을 못 센다").toMatch(
      /끊긴시각:\s*상태\.끊긴시각\s*\?\?\s*Date\.now\(\)/
    );
  });

  it("재접속 로직을 건드리지 않았다 — 5초 간격은 그대로다", () => {
    expect(ws, "재접속 간격이 사라졌다").toMatch(/setTimeout\(connectWebSocket,\s*5000\)/);
  });

  it("화면까지 다리가 이어져 있다 — 없으면 「설계는 됐고 쓰인 적 없다」가 된다", () => {
    expect(ws, "상태를 바깥에 알리는 통로가 없다").toContain("export function onWsState");
    expect(preload, "preload 다리가 없다").toContain("onWsState:");
    expect(상단바, "상단바가 상태를 구독하지 않는다").toContain("window.gijo.onWsState");
  });

  it("★ 상시 배지를 되살리지 않았다 — 문턱을 넘겨야 그린다(2026-08-08 결정 유지)", () => {
    expect(상단바, "끊김 문턱이 없다 — 짧은 끊김에도 뜬다").toMatch(/끊김문턱\s*=\s*15000/);
  });

  it("★ 세션 칩을 죽이지 않는다 — gtb-sess 이름을 재사용하지 않는다", () => {
    // 세션 칩은 querySelector(".gtb-sess")로 중복을 막는다 — 그 이름을 쓰면 세션 칩이 안 그려진다.
    const 구간 = 상단바.slice(상단바.indexOf("끊김칩 = document.createElement"), 상단바.indexOf("끊김칩.textContent"));
    expect(구간, "끊김 칩 생성부를 못 찾았다 — 이 시험이 헛돈다").toBeTruthy();
    expect(구간, "끊김 칩이 gtb-sess를 쓴다 — 세션 칩이 사라진다").not.toContain("gtb-sess");
  });
});

describe("약속과 코드가 같은 말을 한다", () => {
  it("★ 학습 단계 이름이 실제 동작과 맞는다 — 「배포」는 거짓말이었다", () => {
    // 이 단계가 실제로 하는 일은 어댑터를 **미채택으로 등록**하는 것뿐이다(learnloop.ts).
    // 「배포」라 적으면 담당자는 이미 쓰이는 줄 알고 채택을 안 한다 — 만들어 놓고 안 쓰게 된다.
    expect(학습, "학습 단계가 아직 「에이전트 배포」라고 말한다").not.toMatch(/label:\s*"에이전트 배포"/);
    expect(학습, "채택 대기임을 단계 이름이 안 알린다").toMatch(/key:\s*"deploying",\s*label:\s*"[^"]*채택 대기/);
  });
});
