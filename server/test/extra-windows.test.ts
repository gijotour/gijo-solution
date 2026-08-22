// 별도 창 IPC — **라이트 문지기를 안 거치는 자리**를 세어 둔다 (2026-08-14 신설)
//
// ■ 왜 이 감시가 생겼나
//   `navigate:to`는 라이트에서 열 수 없는 제품 화면을 셸로 되돌린다(셸화면보정). 그런데
//   **별도 창을 여는 IPC는 그 길을 안 지난다** — main.ts:514-515가 스스로 그 틈을 적어 뒀다.
//   지금 그런 창이 사무실·팝업 셸·지휘소 셋이다(문서함은 2026-08-20 내 문서 허브에,
//   문서 작성(Smart MD)은 2026-08-22 내 문서 화면 안에 흡수돼 창 자체가 없어졌다):
//     · office  — 라이트 셸에 그 버튼이 없어 닿지 않는다
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
    "office:open": "팀 사무실 — 라이트 셸에 버튼이 없어 닿지 않는다",
    // "smartmd:open" — 2026-08-22 제거(사장님 「팝업은 필요없어」). 그 일은 「내 문서」 화면 안으로.
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

  it("★★ 창은 **우리 화면만** 싣는다 — 남의 렌더러를 창에 실은 것이 통제 밖 새 창의 뿌리였다", () => {
    // ⚠ 2026-08-22까지 여기서 잰 것은 **Smart MD 창의 setWindowOpenHandler**였다.
    //   Smart MD는 다른 저장소에서 받아온 마크다운 렌더러라, 문서 안 링크가 target=_blank면
    //   Electron이 우리 통제 밖 창을 띄웠다(will-navigate로는 못 막는다 — 다른 사건이다).
    //   그 창을 없애면서(문서 작성이 「내 문서」 화면 안으로) 잴 대상이 사라졌다.
    //
    // ★★ 첫 대체 시험은 **변수 이름 하나**(`smartMdWindow =`)만 봤다 — 같은 날 재검토가
    //   그것을 잡았다: 이름을 `mdEditorWindow`로 바꿔 다시 실으면 그대로 초록이다.
    //   4겹 봉인 감시를 뗀 대가가 이름 일치 검사여서는 안 된다. **뿌리를 잰다**:
    //   창이 무엇을 싣는지는 `loadFile`/`loadURL`이 정하므로, **그 인자가 전부 우리
    //   화면 폴더(src/renderer/pages) 안**이어야 한다. 남의 산출물을 실으면 여기서 걸린다.
    // ① 원격을 싣지 않는다 — `loadURL`이 생기면 화면이 우리 디스크 밖에서 온다.
    expect(mainSrc, "loadURL이 생겼다 — 창이 우리 디스크 밖의 것을 싣는다")
      .not.toMatch(/\.loadURL\s*\(/);

    // ② 싣는 파일 경로는 **전부 우리 화면 폴더 안**이어야 한다.
    //    실측(2026-08-22): main.ts의 화면 경로는 모두 `path.join(__dirname, "../src/renderer/pages/…")`
    //    꼴이고, `loadFile(target)`의 `target`도 그 꼴로만 만들어진다. 그러니 **경로 리터럴**을
    //    전수로 보면 된다 — 다른 폴더가 끼는 순간 걸린다.
    const 경로들 = [...mainSrc.matchAll(/path\.join\(\s*__dirname\s*,\s*([`"'])([^`"']*)\1/g)].map((m) => m[2]);
    expect(경로들.length, "화면 경로 리터럴을 하나도 못 찾았다 — 이 시험의 정규식을 확인하라")
      .toBeGreaterThan(0);
    const 화면밖 = 경로들.filter((p) => p.includes(".html") && !p.startsWith("../src/renderer/pages/"));
    expect(
      화면밖,
      "창에 우리 화면 폴더 밖의 화면을 싣는다 — 남의 렌더러라면 setWindowOpenHandler·CSP·전용 세션이 함께 필요하다(옛 Smart MD 봉인 4겹을 되살릴 것)"
    ).toEqual([]);
    // ③ 감시가 헛돌지 않는지 스스로 확인 — 실제로 우리 화면을 싣고 있어야 한다.
    expect(
      경로들.some((p) => p.startsWith("../src/renderer/pages/") && p.includes(".html")),
      "우리 화면을 싣는 경로가 하나도 안 보인다 — 위 검사가 저절로 통과하고 있다"
    ).toBe(true);
    // ④ 옛 창이 그대로 되살아나는 경로도 함께 막는다(이름 검사는 **보조** 잣대로만 남긴다).
    expect(mainSrc, "smartmd 창이 되살아났다").not.toMatch(/smartMdWindow\s*=/);
  });
});

/**
 * (★ Smart MD 창 봉인 시험 4개 — **2026-08-22에 뗐다.**
 *
 *  ■ 무엇을 지키던 것인가: 라이트 안내서·사용안내서의 「만든 글은 이 PC를 벗어나지 않습니다」의
 *    유일한 근거였다 — partition(전용 세션) · CSP connect-src 'none' · onBeforeRequest 로컬 스킴 ·
 *    setWindowOpenHandler deny, 이 네 겹이 main.ts에 있는지 소스로 감시했다.
 *
 *  ■ 왜 뗐나: 그 창 자체가 없어졌다(사장님 「내문서에서 문서작성을 할꺼니 팝업은 필요없어」).
 *    문서 작성은 이제 **우리 화면 안**(mydocs.html ✏ 문서 편집)이고, 그 글은 우리 서버의
 *    개인 문서 표에 들어간다 — 봉인의 대상도 방식도 달라졌다. 없는 창의 계약을 계속 재면
 *    시험은 영원히 빨갛고, 빨간 시험은 곧 아무도 안 보는 시험이 된다.
 *
 *  ■ 되살리려면: git show <이 커밋>^:server/test/extra-windows.test.ts
 *    (main.ts의 구현도 같은 커밋의 675줄 근처 주석이 어디서 꺼내는지 적어 두었다.)
 *
 *  ■ 대신 남긴 것: 위 describe의 「남의 렌더러를 창으로 싣지 않는다」 — 그 창이 되살아나면
 *    걸린다. 그때 이 네 겹을 함께 되살릴 것.)
 */
