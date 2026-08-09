// 패키징본이 고객 데이터를 **앱 번들 안**에 쓰지 않는지 (2026-08-09).
//
// 무슨 일이 있었나: maybeStartBundledServer가 서버의 cwd를 serverRoot로 고정하는데,
// 패키징본에서 그 자리는 **앱 번들 안**이었다. mac 실측 — 첫 실행 한 번으로:
//     /Applications/GIJO AS.app/Contents/Resources/server-dist/data/
//       gijo-as.sqlite(마이그레이션 37건) · -wal 3.1MB · kev.json · memory.lancedb
//     codesign --verify → "a sealed resource is missing or invalid"
//
// 피해는 셋이었다.
//   ① **업데이트가 고객 데이터를 지운다** — 새 .app으로 교체하면 DB가 통째로 없어진다.
//   ② 서명 봉인이 첫 실행에 깨진다 — 같은 날 XProtect가 앱을 휴지통에 넣었던 그 상태다.
//      afterSign 훅으로 맞춰 내보내도 **앱 자신의 첫 실행이 되돌린다.**
//   ③ 쓰기 권한이 없는 자리(관리되는 mac, Windows의 Program Files)에서는 아예 못 뜬다.
//
// ⚠ 이 결함은 **개발 기계에서 절대 안 드러난다.** dev의 serverRoot는 server/라 원래 맞는
//   자리이고, 거기엔 데이터가 이미 쌓여 있어 아무 증상이 없다. 같은 날 나온 다른 두 결함
//   (기본 모델 7.6B · mac 통합메모리)도 뿌리가 같았다 — **우리 기계에는 있고 고객 기계에는
//   없는 것.** 그래서 실행이 아니라 소스를 대조한다.
//   (같은 계열: modeldefault.test.ts — 기억이 덮어서 안 드러나던 것)
import { describe, it, expect } from "vitest";
import fs from "fs";

const main = fs.readFileSync(new URL("../../client/src/main.ts", import.meta.url), "utf8");

/** maybeStartBundledServer 함수 본문만 잘라 본다 — 파일 전체를 보면 엉뚱한 곳에 걸린다. */
function 번들서버기동부(): string {
  const 시작 = main.indexOf("function maybeStartBundledServer");
  expect(시작, "maybeStartBundledServer를 찾지 못했습니다 — 함수 이름이 바뀌었나요?").toBeGreaterThan(-1);
  const 끝 = main.indexOf("\n}", 시작);
  return main.slice(시작, 끝 > 0 ? 끝 : undefined);
}

describe("패키징본 데이터 저장 위치", () => {
  it("★ 패키징본은 cwd를 userData로 보낸다 — 앱 번들 안에 쓰지 않는다", () => {
    const 본문 = 번들서버기동부();
    expect(
      /getPath\(\s*["']userData["']\s*\)/.test(본문),
      "패키징본의 cwd가 userData가 아닙니다. 이대로면 고객 DB가 앱 번들 안에 생기고, " +
        "업데이트할 때 통째로 사라집니다(그리고 코드 서명 봉인이 깨집니다).",
    ).toBe(true);
  });

  it("★ 읽기 전용 자산 경로를 환경변수로 알려 준다 — cwd를 옮겼으므로 필수다", () => {
    const 본문 = 번들서버기동부();
    // cwd만 옮기고 이 둘을 안 넘기면 docs/·docs-manifest.json을 못 찾는다
    // (knowledgebundle.ts·docsbundle.ts·docbox.ts가 cwd 기준 상대경로를 쓴다).
    expect(/GIJO_DOCS_DIR/.test(본문), "GIJO_DOCS_DIR을 넘기지 않습니다 — docs를 못 찾습니다").toBe(true);
    expect(/GIJO_DOCS_MANIFEST/.test(본문), "GIJO_DOCS_MANIFEST를 넘기지 않습니다").toBe(true);
  });

  it("dev에서는 서버 위치를 그대로 쓴다 — 담당자의 개발 DB가 보여야 한다", () => {
    const 본문 = 번들서버기동부();
    // 무조건 userData로 보내면 dev에서 server/data를 못 보게 된다. 갈래가 있어야 한다.
    expect(
      /serverRoot/.test(본문),
      "dev 갈래가 사라졌습니다 — 개발 실행이 개발 DB 대신 userData를 보게 됩니다",
    ).toBe(true);
  });

  it("읽기 전용 자산 경로는 **번들 기준**으로 만든다(userData 기준이면 못 찾는다)", () => {
    const 본문 = 번들서버기동부();
    const docs = /GIJO_DOCS_DIR[^\n]*\n?[^\n]*/.exec(본문)?.[0] ?? "";
    expect(
      /serverRoot/.test(docs),
      "GIJO_DOCS_DIR이 serverRoot(번들 안)를 가리키지 않습니다 — docs는 번들에 있고 userData에는 없습니다",
    ).toBe(true);
  });
});
