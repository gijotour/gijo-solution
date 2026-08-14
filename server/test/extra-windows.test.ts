// 별도 창 IPC — **라이트 문지기를 안 거치는 자리**를 세어 둔다 (2026-08-14 신설)
//
// ■ 왜 이 감시가 생겼나
//   `navigate:to`는 라이트에서 열 수 없는 제품 화면을 셸로 되돌린다(셸화면보정). 그런데
//   **별도 창을 여는 IPC는 그 길을 안 지난다** — main.ts:514-515가 스스로 그 틈을 적어 뒀다.
//   지금 그런 창이 문서함·사무실·**문서 작성(Smart MD)** 셋이다. 셋 다 지금은 맞다:
//     · docbox·office — 라이트 셸에 그 버튼이 없어 닿지 않는다
//     · smartmd       — 전 에디션 무료 도구다(사장님 결정). 막지 않는 것이 의도다
//   문제는 **네 번째가 제품 화면일 때 조용히 새는 것**이다. 그때 이 시험이 실패해,
//   「새로 만든 창은 라이트에서 열려도 되는가」를 사람이 판단하게 만든다.
//   ▶ 「세 번째면 소스 감시」(이 저장소 원칙)에 따라 셋이 된 지금 세워 둔다.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mainSrc = fs.readFileSync(path.join(__dirname, "../../client/src/main.ts"), "utf8");

/**
 * 창을 여는 IPC 통로 전부.
 *
 * ⚠ 처음엔 `"<이름>:open"`만 셌다가 **전제가 틀렸다**(재검토 B-5): `shell:popout`·
 *   `console:popout`이 빠져 있었다. 그중 `shell:popout`은 **렌더러가 준 페이지 이름으로**
 *   새 창을 열어(main.ts) 이미 임의 화면을 띄운다 — 「네 번째가 제품 화면일 때 새는 것을
 *   막는다」는 목적이 그 시점에 이미 성립하지 않았다. `:open`과 `:popout`을 함께 센다.
 */
function 창통로(): string[] {
  return [...mainSrc.matchAll(/ipcMain\.handle\(\s*["']([a-zA-Z]+):(open|popout)["']/g)].map((m) => `${m[1]}:${m[2]}`);
}

describe("별도 창을 여는 IPC — 문지기를 안 거치는 자리", () => {
  // 판단이 끝난 것만 적는다. 새 이름이 생기면 아래 시험이 실패하고, 그때 판단해서 올린다.
  const 검토됨: Record<string, string> = {
    "docbox:open": "문서함 — 읽기 전용 문서. 라이트 셸에 버튼이 없어 닿지 않는다",
    "office:open": "팀 사무실 — 라이트 셸에 버튼이 없어 닿지 않는다",
    "smartmd:open": "문서 작성(Smart MD) — 전 에디션 무료 도구다(2026-08-14 사장님 결정). 막지 않는 것이 의도",
    // ⚠ 아래 둘은 **임의 화면을 연다** — 재검토(B-5)로 드러났다. 라이트 셸(lite-app)에는 분리 단추가
    //   없어 지금은 닿지 않지만, 위 셋과 성격이 다르다: 화면 이름을 **렌더러가 준다.**
    //   라이트에서 이 길이 열리는 날 셸화면보정과 같은 문지기가 반드시 필요하다.
    "shell:popout": "팝업 셸 분리창 — ⚠ 렌더러가 준 페이지를 연다(고정 상수가 아니다). 라이트 셸에 단추 없음",
    "console:popout": "지휘소(대화 창) — 고정 화면(console.html). 라이트 셸에 단추 없음",
  };

  it("★ 새로 생긴 창 통로는 판단을 받아야 한다 — 목록에 없으면 실패한다", () => {
    const 통로 = 창통로();
    expect(통로.length, "창 통로를 하나도 못 찾았다 — 이 시험의 정규식을 확인하라").toBeGreaterThan(0);
    const 미검토 = 통로.filter((t) => !(t in 검토됨));
    expect(
      미검토,
      `창을 여는 IPC가 새로 생겼다: ${미검토.join(", ")} — 라이트에서 열려도 되는지 판단하고 이 목록에 이유와 함께 올릴 것`
    ).toEqual([]);
  });

  it("목록의 이유가 빈칸이 아니다 — 이름만 올려 두면 감시가 헛돈다", () => {
    for (const [이름, 이유] of Object.entries(검토됨)) {
      expect(이유.length, `${이름}의 판단 이유가 너무 짧다`).toBeGreaterThan(15);
    }
  });

  it("★ 별도 창은 새 창 열기를 통제한다 — 문서 안 링크가 통제 밖 창을 띄우면 안 된다", () => {
    // Smart MD는 **다른 저장소에서 받아온** 마크다운 렌더러다. 문서 안 링크가 target=_blank면
    // Electron이 우리 통제 밖의 창을 띄운다(will-navigate는 그 길을 막지 못한다 — 다른 사건이다).
    expect(mainSrc, "smartMd 창에 setWindowOpenHandler가 없다").toMatch(
      /smartMdWindow\.webContents\.setWindowOpenHandler/
    );
  });
});
