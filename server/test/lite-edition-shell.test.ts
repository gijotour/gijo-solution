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

  it("④ 로그인이 여전히 app.html을 부른다 — 이게 바뀌면 위 보정이 헛돈다", () => {
    // 보정은 「app.html을 부르면 돌린다」는 전제 위에 있다. 로그인이 다른 화면으로 가도록
    // 바뀌면 라이트는 조용히 그 화면으로 들어간다 — 그때 이 시험이 알려 준다.
    expect(loginSrc).toContain('navigateTo("app.html")');
  });
});
