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
import { 구역이름들 } from "../src/engine/screenguide";

const settingsPath = path.join(__dirname, "../../client/src/renderer/pages/settings.html");
const settingsSrc = fs.readFileSync(settingsPath, "utf-8");

// [2026-09-13 검토관 [중] 수리] ①은 **제목이 말한 것을 안 재고 있었다** — 「screenguide panels
//   키와 한 글자까지 같아야 한다」면서 screenguide를 읽지 않고 화면 소스만 두 줄 봤다. 그러면
//   D가 키를 고치거나 지워도 이 시험은 초록이다(실제로 kpi 두 키는 그 사이 이모지로 어긋나 있었다).
//   ⇒ 제품 함수 `구역이름들()`로 **양쪽을 맞댄다**. 판정 규칙을 여기서 새로 짜지 않는다.
//   ⚠ settings 전체를 양방향 전수로 묶지는 않는다 — panels 28개 중 8개는 fold 제목이 아니라
//     별칭·판 안쪽 소제목이다(SMTP·정기 알림·에어갭 봉인 …). 이 라운드가 만든 두 이름만 못 박는다.
const 새판이름 = ["자가 진단", "실사용 전환(데이터 정리)"];
describe("① 새 판 두 개가 이름 그대로 있다(screenguide panels 키와 한 글자까지 같아야 한다)", () => {
  const settings구역 = 구역이름들().filter((x) => x.screen === "settings.html").map((x) => x.name);
  for (const 이름 of 새판이름) {
    it(`「${이름}」 — 화면 fold 제목과 screenguide panels 키가 한 글자까지 같다`, () => {
      expect(settingsSrc.includes(`data-gijo-fold="${이름}"`), `settings.html에 data-gijo-fold="${이름}"이 없다`).toBe(true);
      expect(settings구역, `screenguide GUIDES["settings.html"].panels에 「${이름}」 키가 없다 — 화면은 이 이름으로 접기 머리줄을 그리는데 ⓘ가 열 안내가 없다`).toContain(이름);
    });
  }
});

describe("② 실사용 전환 판은 admin 전용 + 기본 접힘이고, 두 잠금이 **다른 요소**를 쓴다", () => {
  // ★★ [2026-09-13 검토관 [상] 수리] 첫 판은 한 요소에 admin 게이트(style="display:none")와
  //   접기(data-gijo-fold-closed)를 함께 달았다. 둘 다 **같은 인라인 style.display**를 쓴다 —
  //   fold.js:99가 접으며 "none"을 적고, loadUser()의 HTTP 왕복이 끝난 뒤 admin 해제 줄이 ""로
  //   덮는다. 결과: 되돌릴 수 없는 「전체 리셋」 판이 펼쳐진 채로 떴다. 그런데 **이 시험은 초록이었다**
  //   — 소스에 표식이 있는 것과 실행 결과가 같다고 믿었기 때문이다(약속만 재고 충돌을 안 쟀다).
  //   ⇒ 이제 **자리를 나눈 것 자체**를 잰다: 껍데기(#liveResetGate)=권한, 판(#liveResetPanel)=접기.
  const gateRe = /<div data-sec="admin" id="liveResetGate"[^>]*>/;
  const panelRe = /<div class="panel" id="liveResetPanel"[^>]*>/;
  it("게이트 껍데기가 권한을 진다 — data-sec=\"admin\" · style=\"display:none\"", () => {
    const m = settingsSrc.match(gateRe);
    expect(m, "#liveResetGate 껍데기를 못 찾았다 — admin 게이트가 판으로 되돌아갔을 수 있다").toBeTruthy();
    expect(m![0]).toContain('style="display:none"');
  });
  it("판은 접기만 진다 — data-gijo-fold-closed를 갖고, 인라인 display·data-sec은 갖지 않는다", () => {
    const m = settingsSrc.match(panelRe);
    expect(m, "liveResetPanel 판 태그를 못 찾았다").toBeTruthy();
    const tag = m![0];
    expect(tag).toContain("data-gijo-fold-closed");
    expect(tag).toContain('data-gijo-fold="실사용 전환(데이터 정리)"');
    expect(tag, "판이 인라인 style을 다시 가졌다 — 접기와 다투게 된다").not.toContain("style=");
    expect(tag, "판이 data-sec을 다시 가졌다 — 권한은 껍데기 몫이다").not.toContain("data-sec=");
  });
  it("user.role === \"admin\" 판정 블록이 **껍데기**의 display를 푼다", () => {
    // dbcryptPanel 바로 다음에 놓는다는 지시서 순서 그대로 — 같은 admin 블록 안에서 이어져야 한다.
    const 블록시작 = settingsSrc.indexOf('if (user.role === "admin")');
    expect(블록시작, "admin 판정 블록을 못 찾았다").toBeGreaterThan(-1);
    const 블록 = settingsSrc.slice(블록시작, 블록시작 + 2600);
    expect(블록).toMatch(/document\.getElementById\("liveResetGate"\)\.style\.display\s*=\s*""/);
  });
  it("★ 화면 어디에서도 liveResetPanel의 style.display를 쓰지 않는다(접기 말고는 아무도 못 만진다)", () => {
    const 코드 = settingsSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
    expect(
      코드,
      "liveResetPanel의 display를 JS가 다시 쓴다 — 그 순간 fold.js의 기본 접힘이 덮여 " +
        "「전체 리셋」 판이 펼쳐진 채로 뜬다(2026-09-13에 실제로 그랬다). 권한은 #liveResetGate로 건다.",
    ).not.toMatch(/getElementById\("liveResetPanel"\)\.style\.display/);
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

// ── [2026-09-13 검토관 수리 재발 감시] ─────────────────────────────────────────
//   아래 셋은 전부 「구현이 반쪽에서 멈춘」 부류다 — 잠갔는데 잠긴 티가 안 나고, 숫자를 채웠는데
//   머리줄에는 안 알리고, 실패 갈래에서 문장이 반만 남았다. 셋 다 화면을 안 열면 안 보여서
//   시험으로 못 박는다(실화면 관문 9227은 게시 때만 돈다).
describe("⑦ 잠긴 파괴 버튼은 잠긴 것처럼 보인다", () => {
  it(".btn-danger:disabled 규칙이 있다 — 없으면 「전체 리셋 실행」이 살아 있는 빨간 버튼으로 보인다", () => {
    // .btn-primary는 :29에 같은 규칙을 갖고 있었다. gijo-ui.css의 :disabled는 .g-btn 전용이라
    // 이 화면의 .btn-danger를 덮지 않는다 — 전역 button:disabled 규칙은 없다(실측).
    expect(settingsSrc).toMatch(/\.btn-danger:disabled\s*\{[^}]*(opacity|cursor)/);
  });
});

describe("⑧ 자가 진단 배지를 채운 뒤 접기 머리줄에 알린다", () => {
  it("loadSystemHealth()가 badge를 쓴 뒤 gijoFold.refresh()를 부른다", () => {
    const i = settingsSrc.indexOf("async function loadSystemHealth(");
    expect(i, "loadSystemHealth를 못 찾았다").toBeGreaterThan(-1);
    const 본문 = settingsSrc.slice(i, i + 2200);
    expect(본문).toMatch(/badge\.textContent\s*=/);
    expect(
      본문,
      "배지 글자만 바꾸고 gijoFold.refresh()를 안 부른다 — fold.js의 자동 재도색(watch)은 12초면 " +
        "멈추므로 그 뒤에 눌리는 「새로고침」은 머리줄에 옛 숫자를 그대로 남긴다(이 파일 :1150·:1449·:1525 관례).",
    ).toMatch(/window\.gijoFold\s*(?:&&|\))\s*window\.gijoFold\.refresh\(\)/);
  });
});

describe("⑨ 목록을 못 불러와도 문장이 반만 남지 않는다", () => {
  it("dcSelCount 초기 글자에 「종 중」 조각을 두지 않는다", () => {
    // 앞 판 초기값은 `종 중 0개 선택됨` — 앞의 수(total)는 dcSyncSelUi()만 채우는데 그 함수는
    // dcRenderGrid 안에서만 불린다. 로딩 전·실패 뒤에는 수가 빠진 문장이 그대로 보였다.
    expect(settingsSrc).not.toMatch(/id="dcSelCount">\s*종\s*중/);
  });
  it("loadDataCleanup()의 실패 갈래가 dcSelCount를 갱신한다", () => {
    const i = settingsSrc.indexOf("async function loadDataCleanup(");
    expect(i, "loadDataCleanup을 못 찾았다").toBeGreaterThan(-1);
    const 본문 = settingsSrc.slice(i, i + 1400);
    const c = 본문.indexOf("catch");
    expect(c, "loadDataCleanup에 실패 갈래가 없다").toBeGreaterThan(-1);
    expect(본문.slice(c)).toMatch(/dcSelCount"\)\.textContent\s*=/);
  });
});
