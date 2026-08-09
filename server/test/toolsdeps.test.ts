// 도구가 빌려 쓰는 의존성이 선언돼 있는가 (2026-08-09, Mac 지적).
//
// 무슨 일이 있었나: tools/의 화면 검사·스크린샷 도구 10여 개가 playwright-core를
// **client/node_modules에서 빌려** 쓴다(createRequire로 client/package.json 기준 명시 해석).
// 그런데 client/package.json에 **선언이 없었다.** 어쩌다 설치돼 있어서 이 기계에서는
// 돌았고, Mac에서는 처음부터 못 돌았다 — `npm ci` 한 번이면 이 기계에서도 사라진다.
//
// 「어쩌다 있어서 돌고 있다」는 상태는 조용히 깨진다. 도구가 빌려 쓰겠다고 코드에 적었으면
// 빌려주는 쪽 package.json이 그것을 보장해야 한다. 그래서 **코드가 적은 것과 선언을 대조**한다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 루트 = path.join(__dirname, "..", "..");
const 도구들 = path.join(루트, "tools");

/** tools/*.mjs 가 client/package.json 기준으로 require 하는 꾸러미 이름을 모은다. */
function 빌려쓰는꾸러미(): Map<string, string[]> {
  const 결과 = new Map<string, string[]>();
  for (const f of fs.readdirSync(도구들).filter((n) => n.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(도구들, f), "utf8");
    // client/package.json 기준 createRequire를 쓰는 파일만 본다(server 기준·상대경로는 해당 없음).
    // ⚠ 경로를 쪼개 쓰는 꼴도 잡는다 — path.join(ROOT, "client", "package.json") 처럼.
    //   좁게 잡았다가 10개 중 2개만 걸렸다(2026-08-09). 감시는 놓치는 쪽이 무섭다.
    const 씀 = src
      .split("\n")
      .some((줄) => 줄.includes("createRequire") && 줄.includes("client") && 줄.includes("package.json"));
    if (!씀) continue;
    for (const m of src.matchAll(/\brequire\(["']([^"'./][^"']*)["']\)/g)) {
      const 이름 = m[1].split("/").slice(0, m[1].startsWith("@") ? 2 : 1).join("/");
      결과.set(이름, [...(결과.get(이름) ?? []), f]);
    }
  }
  return 결과;
}

describe("도구가 빌려 쓰는 꾸러미는 선언돼 있어야 한다", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(루트, "client", "package.json"), "utf8"));
  const 선언 = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const 빌린것 = 빌려쓰는꾸러미();

  it("검사할 대상을 실제로 찾았다 — 0건이면 이 시험이 헛돌고 있다", () => {
    // 정규식이 낡아 아무것도 안 잡으면 **조용히 통과**한다. 그게 가장 나쁜 실패다.
    expect(빌린것.size, "tools/에서 client 기준 require를 하나도 못 찾았다").toBeGreaterThan(0);
  });

  it("★ 빌려 쓰는 꾸러미가 전부 client/package.json에 선언돼 있다", () => {
    const 빠진것 = [...빌린것.entries()]
      .filter(([이름]) => !(이름 in 선언))
      .map(([이름, 파일들]) => `${이름} (${파일들.slice(0, 3).join(", ")}${파일들.length > 3 ? " 외" : ""})`);
    expect(빠진것, "선언이 없으면 npm ci 한 번에 도구가 통째로 죽는다").toEqual([]);
  });

  it("★★ playwright-core는 devDependencies에 있다 — dependencies면 앱에 실려 나간다", () => {
    // electron-builder는 dependencies만 패키징한다. 화면 검사 도구가 고객 앱에 들어갈 이유가 없다.
    expect(pkg.devDependencies?.["playwright-core"], "devDependencies에 있어야 한다").toBeTruthy();
    expect(pkg.dependencies?.["playwright-core"], "dependencies에 있으면 앱이 커진다").toBeFalsy();
  });
});
