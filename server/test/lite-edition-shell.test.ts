// 라이트 에디션 첫 화면 — **두 파일이 서로를 잃어버리지 않게 지킨다** (2026-08-13 · 계획서 전-1)
//
// ■ 무엇을 지키나
//   라이트 배포본은 로그인 뒤 `lite-app.html`로 들어가야 한다. 그 판정이 **두 곳에 나뉘어** 있다:
//     ① electron-builder.lite.json  — 라이트 빌드의 package.json에 `gijoEdition: "lite"`를 박는다
//     ② client/src/main.ts          — 그 값을 읽어 app.html → lite-app.html로 돌린다
//   하나만 있으면 **조용히 본 제품 화면으로 들어간다**(도구 13개 · 화면 40개 — 가장 나쁜 조합).
//
// ■ ⚠ 왜 이 시험이 필요한가 — 실제로 그 함정에 들어갈 뻔했다(2026-08-13).
//   인계는 「main.ts에서 GIJO_EDITION=lite면 돌려라」였는데, `GIJO_EDITION`은 저장소에
//   **문서에만** 있는 이름이었다. 클라 빌드·실행 어디에도 그걸 넣는 곳이 없어서,
//   시킨 대로 했으면 패키징본에서 **분기가 영원히 거짓**이 된다 — 고쳤다고 믿는데 안 고쳐진다.
//   「설계는 다 됐고 쓰인 적 없다」가 이 저장소의 반복 유형이라, 짝을 시험으로 묶는다.
import { describe, it, expect } from "vitest";
import * as fs from "fs";

const builderLite = JSON.parse(
  fs.readFileSync(new URL("../../client/electron-builder.lite.json", import.meta.url), "utf8")
);
const mainSrc = fs.readFileSync(new URL("../../client/src/main.ts", import.meta.url), "utf8");
const loginSrc = fs.readFileSync(new URL("../../client/src/renderer/pages/login.html", import.meta.url), "utf8");

describe("라이트 에디션 — 로그인 뒤 라이트 셸로 들어간다", () => {
  it("① 라이트 빌드가 package.json에 에디션을 박는다", () => {
    expect(builderLite.extraMetadata?.gijoEdition).toBe("lite");
  });

  it("② main.ts가 그 값을 실제로 읽는다 — env만 보고 있으면 패키징본에서 안 걸린다", () => {
    expect(mainSrc).toContain("gijoEdition");
  });

  it("③ 돌려보낼 라이트 셸이 실제로 있다", () => {
    const 라이트셸 = new URL("../../client/src/renderer/pages/lite-app.html", import.meta.url);
    expect(fs.existsSync(라이트셸)).toBe(true);
  });

  it("④ 표준 화면으로 가는 길을 막는다 — 도구 13개인데 화면 40개가 보이면 안 된다", () => {
    // 접두사 문지기 + 입구 예외(setup·login). 정확한 9개 대조는 셸의 lite-nav.js 몫이다.
    expect(mainSrc).toContain("라이트에서열수있나");
    expect(mainSrc).toMatch(/startsWith\("lite-"\)/);
    // ⚠ 입구를 막으면 첫 실행과 로그아웃이 죽는다 — 예외가 사라지면 알려 준다.
    expect(mainSrc).toContain('file === "login.html"');
    expect(mainSrc).toContain('file === "setup.html"');
  });

  it("⑤ 라이트 화면 파일이 전부 lite- 접두사다 — 문지기의 전제", () => {
    const 목록 = JSON.parse(
      fs.readFileSync(new URL("../../client/src/renderer/pages/lite-screens.json", import.meta.url), "utf8")
    );
    const ids: string[] = [...목록.screens.map((s: { id: string }) => s.id), 목록.settings.id];
    for (const id of ids) expect(id, `화면 id ${id}`).toMatch(/^lite-/);
  });

  it("⑥ 로그인이 여전히 app.html을 부른다 — 이게 바뀌면 위 보정이 헛돈다", () => {
    // 보정은 「app.html을 부르면 돌린다」는 전제 위에 있다. 로그인이 다른 화면으로 가도록
    // 바뀌면 라이트는 조용히 그 화면으로 들어간다 — 그때 이 시험이 알려 준다.
    expect(loginSrc).toContain('navigateTo("app.html")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 에디션별 기본 포트 — **네 곳이 하나에서 흐르는가** (2026-08-13 · 사장님 지시)
//
// ■ 지시: 라이트 7445 · 스탠다드 7446 · 프로 7446(스탠다드와 공유 — 사장님 결정).
//   프로는 별도 빌드가 아니라 스탠다드의 런타임 티어라 **같은 프로세스**다. 포트는 부팅 때
//   정해지는데 티어는 부팅 후 DB에서 읽으므로, 가르려면 런처가 부팅 전에 티어를 알아야 한다 —
//   어긋나면 엉뚱한 포트로 뜬다. 「기능 등급」이지 「다른 서버」가 아니라 가를 실익이 없다.
//
// ■ ⚠ 왜 시험이 필요한가 — `4000`이 **네 곳에 따로 박혀** 있었다(max 전수):
//     ① server/src/index.ts       서버가 실제로 listen
//     ② client/src/main.ts        설치 후 헬스 폴링
//     ③ client/src/api/core.ts    렌더러가 실제로 접속하는 기본값
//     ④ login.html                안내 문구
//   **네 곳이 전부 같아야 첫 로그인이 된다.** 하나만 어긋나면 화면은 멀쩡히 뜨는데
//   로그인만 **조용히** 실패한다 — main.ts 주석이 이미 그렇게 경고하고 있었다.
//   그래서 재는 것은 「값이 맞나」가 아니라 **「한 곳에서 흐르나」**다.
describe("★ 에디션별 기본 포트가 한 곳에서 흐른다 (2026-08-13)", () => {
  // ⚠ 이 파일은 `new URL(…, import.meta.url)`로 읽는다(ESM — __dirname이 없다).
  //   그리고 mainSrc·loginSrc는 위에서 이미 읽어 두었으므로 **그대로 쓴다** — 두 벌로 두면
  //   한쪽만 고쳐져 어긋난다(이 파일이 지키려는 바로 그 원칙이다).
  const main = mainSrc;
  const login = loginSrc;
  const liteEnv = fs.readFileSync(new URL("../src/lite/env.ts", import.meta.url), "utf8");

  it("단일 출처(서버포트)가 있고 라이트 7445 · 스탠다드/프로 7446이다", () => {
    expect(main, "서버포트() 단일 출처가 없다").toMatch(/function 서버포트\(\)/);
    expect(main, "라이트 7445가 없다").toMatch(/7445/);
    expect(main, "스탠다드/프로 7446이 없다").toMatch(/7446/);
    // 프로를 따로 가르지 않았는지 — 7447이 코드에 있으면 사장님 결정과 어긋난다.
    expect(main, "프로 7447이 살아 있다 — 스탠다드와 7446 공유가 결정 사항이다").not.toMatch(/7447/);
  });

  it("★ 클라 어디에도 literal 4000이 남아 있지 않다 (네 곳 중 셋이 여기였다)", () => {
    // ⚠ 서버(index.ts)의 `?? 4000`은 **남겨 둔다** — spawn env가 이기고, 서버를 직접 띄우는
    //   개발 경로를 깨지 않기 위해서다. 여기서 보는 것은 **클라**다.
    //
    // ⚠ **주석은 빼고 코드만 본다**(2026-08-13에 이 시험이 스스로 헛실패했다).
    //   이 저장소는 주석에 사고 이력을 남기는 방식이라, 「예전엔 4000이 네 곳에 박혀 있었다」
    //   같은 설명이 그대로 걸렸다. 역사를 적는 것을 시험이 막으면 안 된다 —
    //   그러면 다음 사람은 **왜 이렇게 됐는지 못 적는다.**
    // ⚠⚠ 줄 끝 주석을 `//`로 잘라내면 **URL이 잘린다** — `"http://localhost:4000"`의 `//`를
    //   주석으로 보고 뒤를 통째로 지워, 정작 잡아야 할 4000이 사라진다.
    //   처음에 그렇게 썼다가 **감시가 헛돌았다**(코드에 4000을 넣어도 안 잡혔다).
    //   앞 글자가 `:`가 아닐 때만 주석으로 본다 — `://`는 URL, ` //`는 주석.
    const 코드만 = (src: string) =>
      src
        .split("\n")
        .filter((l) => !/^\s*[*/]/.test(l)) // 블록 주석 본문(* …)과 // 로 시작하는 줄
        .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")) // 줄 끝 주석(URL의 :// 는 남긴다)
        .join("\n");

    const 남은것: string[] = [];
    if (/\b4000\b/.test(코드만(main))) 남은것.push("client/src/main.ts");
    if (/localhost:4000|127\.0\.0\.1:4000/.test(login.replace(/<!--[\s\S]*?-->/g, ""))) 남은것.push("login.html(안내문)");
    expect(남은것, "포트 숫자가 다시 흩어졌다 — 하나만 어긋나면 첫 로그인이 조용히 실패한다").toEqual([]);
  });

  it("라이트 서버를 직접 띄워도 7445다 — 제품이 가는 길과 재는 길이 같아야 한다", () => {
    // max가 라이트 게이트 32/33을 `node dist/lite/index.js`로 쟀는데 그건 제품 경로가 아니었다.
    // 그 길이 4000으로 뜨면 「겨눈 대상이 다른」 측정이 또 나온다.
    expect(liteEnv, "라이트 진입점이 7445를 안 세운다").toMatch(/GIJO_SERVER_PORT\s*=\s*"7445"/);
    // 클라가 넘긴 값이 있으면 안 덮어야 한다(반쪽 상태 방지).
    expect(liteEnv, "이미 지정된 포트를 덮어쓴다").toMatch(/if \(!process\.env\.GIJO_SERVER_PORT\)/);
  });

  it("서버 listen이 env를 따른다 — 클라가 정한 포트가 실제로 먹는다", () => {
    const idx = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(idx, "서버가 GIJO_SERVER_PORT를 안 읽는다").toMatch(/GIJO_SERVER_PORT/);
    expect(main, "클라가 spawn env로 포트를 안 넘긴다").toMatch(/GIJO_SERVER_PORT:\s*String\(서버포트\(\)\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ 스탠다드 배포본의 **라이트 모드 옵션** — 자리(seam) (2026-08-13 · 사장님 지시 2번)
//
// ■ 지시: 기존(스탠다드) 클라이언트에 라이트 모드를 「선택 사항」으로.
// ■ 사장님 결정: **데이터 폴더 분리** — 같은 폴더를 쓰면 스탠다드로 쌓은 회사 데이터가
//   라이트 화면엔 안 보이고, 같은 DB에 **도구 13개와 78개가 번갈아** 답한다.
//
// ⚠ **화면(설정 스위치)은 아직 없다 — 일부러다.** UI는 시안 1개 승인 후가 이 제품의 규칙이라,
//   여기까지가 「자리를 여는」 몫이다(BridgeAI 1단계와 같은 구조).
//   그래서 이 시험은 **소비자(화면)가 아니라 생산자(통로)가 있는지**를 본다.
//   화면이 생기면 이 시험을 「실제로 부르는가」까지 강화할 것.
describe("★ 라이트 모드 옵션 — 자리가 열려 있다 (2026-08-13)", () => {
  const main = mainSrc;

  it("★ 빌드 고정이 런타임 선택보다 먼저다 — 라이트 전용 배포본은 잠긴다", () => {
    expect(main, "빌드에디션() 이 없다").toMatch(/function 빌드에디션\(\)/);
    expect(main, "저장된에디션() 이 없다").toMatch(/function 저장된에디션\(\)/);
    // 에디션() 본문에서 빌드값을 저장값보다 **먼저** 본다 — 순서가 뒤집히면
    // 라이트 전용 dmg에서도 고객이 스탠다드로 바꿀 수 있게 된다(그 상품이 아니다).
    const 본문 = main.slice(main.indexOf("function 에디션()"));
    const 빌드 = 본문.indexOf("빌드에디션()");
    const 저장 = 본문.indexOf("저장된에디션()");
    expect(빌드, "에디션()이 빌드값을 안 본다").toBeGreaterThan(-1);
    expect(저장, "에디션()이 저장값을 안 본다").toBeGreaterThan(-1);
    expect(빌드, "런타임 선택이 빌드 고정을 이긴다 — 라이트 전용 배포본이 안 잠긴다").toBeLessThan(저장);
  });

  it("★ 데이터 폴더는 **전환한 경우만** 가른다 (전용 배포본은 건드리지 않는다)", () => {
    expect(main, "라이트모드전환() 판정이 없다").toMatch(/function 라이트모드전환\(\)/);
    // 판정이 「라이트다」가 아니라 「라이트인데 빌드는 아니다」여야 한다.
    expect(main, "전환 판정이 빌드값을 안 본다 — 전용 dmg의 데이터가 하루아침에 안 보이게 된다")
      .toMatch(/라이트모드전환[\s\S]{0,200}빌드에디션\(\)\s*!==\s*"lite"/);
    expect(main, "dataRoot가 전환을 안 본다").toMatch(/라이트모드전환\(\)[\s\S]{0,120}userData[\s\S]{0,40}"lite"/);
  });

  it("모드 변경 통로가 있고, 변경은 재시작을 요구한다", () => {
    expect(main, "edition:get 통로가 없다").toMatch(/ipcMain\.handle\("edition:get"/);
    expect(main, "edition:set 통로가 없다").toMatch(/ipcMain\.handle\("edition:set"/);
    // 도구 13 vs 78과 진입점이 부팅 때 갈리므로, 실행 중 반영은 반쪽 상태를 만든다.
    expect(main, "재시작 필요를 안 알린다").toMatch(/재시작필요:\s*true/);
    // 라이트 전용 배포본에서는 거절해야 한다.
    expect(main, "전용 배포본에서 모드 변경을 안 막는다").toMatch(/빌드에디션\(\) === "lite"[\s\S]{0,120}ok:\s*false/);
  });
});
