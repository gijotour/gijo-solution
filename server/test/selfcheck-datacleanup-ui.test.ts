// UI C(2026-09-13) — 「자가 진단」·「실사용 전환(데이터 정리)」 화면 소비자 신설 소스 감시.
//
// 계획서 §13.5.2(전-7 「보여 주기」의 연장) — 서버는 진작부터 이 세 API(GET /api/system-health ·
// GET/POST /api/admin/data-cleanup · POST /api/admin/reset-live-data)를 갖고 있었는데
// 화면 소비자가 0건이었다(titlebar.js:1020의 안내가 막다른 골목이었다 — "설정 › 서버에서
// 확인한다"는데 그 화면이 없었다). 이 시험은 새로 놓은 화면 다리가 서버 계약과 어긋나지
// 않는지, 그리고 이 저장소가 반복해 겪은 함정(라벨 하드코딩·개수 단정·괄호 있는 이름의
// 별칭 누락) 대신 원천을 그대로 따라가는지를 잡는다.
//
// 시안: mockups/selfcheck-no-consumer/시안.html · mockups/settings-live-reset/시안.html
// 승인: 사장님 2026-09-13 「승인 계속진행」
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TARGETS } from "../src/engine/datacleanup";

const settingsPath = path.join(__dirname, "../../client/src/renderer/pages/settings.html");
const settingsSrc = fs.readFileSync(settingsPath, "utf-8");

describe("① 새 판 두 개가 이름 그대로 있다(screenguide panels 키와 한 글자까지 같아야 한다)", () => {
  it('data-gijo-fold="자가 진단" — 서버·AI 탭', () => {
    expect(settingsSrc.includes('data-gijo-fold="자가 진단"')).toBe(true);
  });
  it('data-gijo-fold="실사용 전환(데이터 정리)" — 관리자 탭, 괄호 포함 글자 그대로', () => {
    expect(settingsSrc.includes('data-gijo-fold="실사용 전환(데이터 정리)"')).toBe(true);
  });
});

describe("② 실사용 전환 판은 admin 전용 + 기본 접힘이고, admin 판정에서만 풀린다", () => {
  // 판 자체 — data-sec="admin"(비관리자에겐 안 보임) + data-gijo-fold-closed(기본 접힘,
  // fold.js:168 "매일 볼 것이 아닌 구역" 규칙) + style="display:none"(admin 게이트가 풀 때까지).
  const panelRe = /<div data-sec="admin" class="panel" id="liveResetPanel"[^>]*>/;
  it("판 자체가 data-sec=\"admin\" · id=\"liveResetPanel\" · style=\"display:none\" · data-gijo-fold-closed를 함께 갖는다", () => {
    const m = settingsSrc.match(panelRe);
    expect(m, "liveResetPanel 판 태그를 못 찾았다").toBeTruthy();
    const tag = m![0];
    expect(tag).toContain('style="display:none"');
    expect(tag).toContain("data-gijo-fold-closed");
    expect(tag).toContain('data-gijo-fold="실사용 전환(데이터 정리)"');
  });
  it("user.role === \"admin\" 판정 블록이 liveResetPanel의 display를 실제로 푼다", () => {
    // dbcryptPanel 바로 다음에 놓는다는 지시서 순서 그대로 — 같은 admin 블록 안에서 이어져야 한다.
    const 블록시작 = settingsSrc.indexOf('if (user.role === "admin")');
    expect(블록시작, "admin 판정 블록을 못 찾았다").toBeGreaterThan(-1);
    const 블록 = settingsSrc.slice(블록시작, 블록시작 + 2000);
    expect(블록).toMatch(/document\.getElementById\("liveResetPanel"\)\.style\.display\s*=\s*""/);
  });
});

describe("③ 전체 리셋 확인 문자열은 서버 계약과 정확히 같다(대문자 RESET)", () => {
  it('입력칸 placeholder·검사 로직이 정확히 "RESET"이다(대소문자·앞뒤 공백 없이)', () => {
    expect(settingsSrc).toMatch(/placeholder="RESET"/);
    // dcRunReset()·input 리스너 둘 다 엄격 일치(!==)로 검사해야 한다 — 서버(datacleanup.ts:257
    // `req.body?.confirm !== "RESET"`)와 같은 강도가 아니면 화면이 서버보다 헐거워진다.
    const 일치검사 = [...settingsSrc.matchAll(/\.value\s*!==\s*"RESET"/g)];
    expect(일치검사.length, "RESET 엄격 일치(!==) 검사가 화면 어디에도 없다").toBeGreaterThanOrEqual(2);
  });
});

describe("④ 라벨은 서버가 준 t.label 그대로다 — 화면이 새로 짓거나 줄여 적지 않는다", () => {
  const 라벨들 = Object.values(TARGETS).map((t) => t.label);
  it("cleanupTargets() 라벨 16종을 실제로 읽어 온다", () => {
    expect(라벨들.length).toBeGreaterThanOrEqual(16);
  });
  it("어느 라벨도 settings.html에 리터럴로 박혀 있지 않다(서버 값을 그대로 그려야 한다)", () => {
    const 하드코딩: string[] = [];
    for (const label of 라벨들) {
      if (settingsSrc.includes(label)) 하드코딩.push(label);
    }
    expect(
      하드코딩,
      "이 라벨들이 settings.html 소스에 문자 그대로 있다 — 화면이 서버 목록을 베껴 적었다는 뜻이다.\n" +
        "  대장이 바뀌면(이름이 늘거나 줄어도) 화면과 실제 삭제 대상이 조용히 어긋난다:\n  " +
        하드코딩.join("\n  "),
    ).toEqual([]);
  });
});

describe("⑤ 자가 진단 항목 개수를 9개로 못박지 않는다(SIEM 꺼짐이면 8개가 정상이다)", () => {
  it('"9개"를 전제하는 단정이 없다', () => {
    expect(settingsSrc).not.toMatch(/checks\.length\s*===\s*9/);
    expect(settingsSrc).not.toMatch(/9개\s*(항목|고정)/);
  });
});

describe("⑥ 파괴적 버튼은 확인 없이는 눌리지 않는다(silentbuttons·clientglobals와 짝)", () => {
  it("① 선택한 항목 정리 — 0개 선택이면 disabled 시작 + dcRunBtn.disabled를 세우는 로직이 있다", () => {
    expect(settingsSrc).toMatch(/id="dcRunBtn" disabled/);
    expect(settingsSrc).toMatch(/runBtn\.disabled\s*=\s*n\s*===\s*0/);
  });
  it("② 전체 리셋 실행 — disabled로 시작하고, RESET 정확 일치가 아니면 계속 잠겨 있다", () => {
    expect(settingsSrc).toMatch(/id="dcResetBtn" disabled/);
  });
  it("네이티브 확인창(window.confirm 등)을 쓰지 않는다 — 화면 안 입력칸 확인만 쓴다", () => {
    // clientglobals.test.ts가 전 화면을 이미 감시하지만, 이 화면은 파괴적 조작이라 한 번 더 못박는다.
    // ⚠ 주석 줄은 뺀다 — 이 파일 1370행 근처에 gijoDialog 사고 이력을 적어 둔 주석이 실제로
    //   "confirm(" 문자열을 담고 있다(클릭 전수 점검 관례, clientglobals.test.ts와 같은 결).
    const 코드 = settingsSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
    expect(코드).not.toMatch(/\bconfirm\(/);
    expect(코드).not.toMatch(/\bwindow\.confirm\(/);
  });
});
