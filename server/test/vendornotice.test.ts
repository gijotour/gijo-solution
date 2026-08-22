// 동봉물 고지 — **우리가 배포하는데 고지에서 빠진 것이 없는가** (2026-08-22 신설).
//
// ■ 왜 생겼나 — 라이선스를 바로잡던 바로 그날, **다른 라이선스를 빠뜨리고 있었다.**
//   `client/smartmd/vendor/VERSIONS.md`는 우리가 CDN 대신 직접 싣는 JS·CSS·글꼴 4종의
//   판과 라이선스를 적어 둔 파일이다. 부품표 생성기가 그 파일을 읽기는 했는데
//   **`- 이름 | 판 | 라이선스` 꼴(목록)을 기다리는 정규식**이었고 파일은 **마크다운 표**였다.
//   → 한 줄도 안 걸렸고 **아무 오류도 안 났다.** 「없는 것」과 「못 읽은 것」이 구분되지 않았다.
//
//   그래서 **Font Awesome의 CC-BY-4.0(아이콘)·SIL OFL-1.1(글꼴)** 고지가 통째로 빠졌다.
//   둘 다 **고지가 의무**인 라이선스다. 고지 목록에 없으면 지키지 않는 것이다.
//
// ⚠ 이 시험이 지키는 것은 「파일이 있다」가 아니라 **「읽혀서 판정까지 됐다」**이다.
//   조용한 0이 이 사고의 본체였으므로, 0이면 여기서 빨개진다.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { 등급판정, 상용사용금지 } from "../src/engine/licenserisk.js";

const 저장소 = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const VEND = path.join(저장소, "client", "smartmd", "vendor", "VERSIONS.md");

/** VERSIONS.md 원문. 없으면 **ENOENT로 죽지 않고** 무엇이 없는지 말하고 실패시킨다.
 *  ⚠ 이 감시가 막으려는 사고가 「조용히 못 읽는 것」이라, 감시 자신이 알 수 없는 오류로
 *    죽으면 사람이 그것을 사본 문제인지 제품 문제인지 못 가른다(실제로 한 번 겪었다). */
function 원문(): string {
  if (!fs.existsSync(VEND)) {
    throw new Error(
      `동봉 원장을 못 찾았습니다: ${VEND}\n` +
      `  WSL 시험 사본이라면 tools/wsl-test.sh의 client 동기화에 smartmd/vendor/가 들어 있는지 보세요.`
    );
  }
  return fs.readFileSync(VEND, "utf8");
}

/** 부품표 생성기와 **같은 방식**으로 읽는다(tools/gen-sbom-self.mjs의 smartmd동봉).
 *  ⚠ 여기 사본을 두는 것이 마음에 걸리지만, 그 파일은 .mjs 도구라 vitest에서 못 부른다.
 *    대신 **결과를 대조**한다 — 아래 「고지에 그 이름이 있나」 시험이 두 벌이 어긋나는 것을 잡는다. */
function 표읽기(원문: string) {
  const 줄들 = 원문.split("\n").filter((l) => l.trim().startsWith("|"));
  if (줄들.length < 3) return [];
  const 칸 = (l: string) => l.split("|").slice(1, -1).map((s) => s.trim());
  const 머리 = 칸(줄들[0]);
  const iName = 머리.findIndex((h) => /library|name|이름/i.test(h));
  const iVer = 머리.findIndex((h) => /version|판/i.test(h));
  const iLic = 머리.findIndex((h) => /licen[cs]e|라이선스/i.test(h));
  if (iName < 0 || iLic < 0) return [];
  return 줄들.slice(2).map(칸)
    .filter((c) => c.length > Math.max(iName, iLic) && c[iName])
    .map((c) => ({ 이름: c[iName].replace(/`/g, ""), 판: iVer >= 0 ? c[iVer] : "", 라이선스: c[iLic] }));
}

describe("동봉 vendor 고지 — 조용히 0이 되지 않는다", () => {
  it("VERSIONS.md 가 있다 — 없으면 무엇을 싣는지 아무도 모른다", () => {
    expect(fs.existsSync(VEND), `${VEND} 가 없다`).toBe(true);
  });

  it("★★ 표에서 부품을 **하나 이상** 읽는다 (0이면 고지에서 통째로 빠진다)", () => {
    const 목록 = 표읽기(원문());
    expect(목록.length, "형식이 바뀌어 못 읽고 있다 — 표 머리글에 Library/Version/License 칸이 있어야 한다")
      .toBeGreaterThan(0);
  });

  it("★ 읽은 것마다 라이선스가 **판정된다** — 「판정불가」면 고지에 뭘 적을지 모른다는 뜻", () => {
    const 목록 = 표읽기(원문());
    const 못푼것 = 목록.filter((c) => 등급판정(c.라이선스).등급 === "판정불가");
    expect(못푼것.map((c) => `${c.이름} — ${c.라이선스}`), "판정기가 못 읽는 표기다")
      .toEqual([]);
  });

  it("★★ 동봉물 중 **상용으로 못 쓰는 것**이 없다", () => {
    // 이 저장소가 2026-08-22에 실제로 배포하다 걸린 그 조건(CC BY-NC-ND)이다.
    const 목록 = 표읽기(원문());
    const 걸린것 = 목록.filter((c) => 상용사용금지(c.라이선스));
    expect(걸린것.map((c) => `${c.이름} — ${c.라이선스}`),
      "비영리·변경금지 조건은 소스를 공개해도 안 풀린다 — 빼거나 허락을 받아야 한다").toEqual([]);
  });

  it("★ 고지가 의무인 것들이 실제로 목록에 있다 — 글꼴·아이콘을 빠뜨리기 쉽다", () => {
    // 코드(MIT)는 눈에 띄는데 **글꼴과 아이콘**은 라이선스가 따로인 것을 자주 잊는다.
    // 우리가 빠뜨린 것이 정확히 이 둘이었다.
    const 전부 = 표읽기(원문()).map((c) => c.라이선스).join(" | ");
    if (/font\s*awesome/i.test(원문())) {
      expect(전부, "Font Awesome을 싣는데 아이콘 라이선스(CC-BY)가 표에 없다").toMatch(/CC[\s-]?BY/i);
      expect(전부, "Font Awesome을 싣는데 글꼴 라이선스(OFL)가 표에 없다").toMatch(/OFL/i);
    }
  });
});

describe("고지 목록 파일 — 만들어졌다면 정직한가", () => {
  const 고지 = path.join(저장소, "THIRD-PARTY-NOTICES.md");

  it("「오픈소스 부품」이라고 뭉뚱그리지 않는다 — 오픈소스 아닌 동봉물도 있다", () => {
    if (!fs.existsSync(고지)) return;   // 아직 안 만든 기계에서는 건너뛴다(빌드 산출물이다)
    const s = fs.readFileSync(고지, "utf8").slice(0, 1200);
    expect(s, "마이크로소프트 재배포 런타임처럼 오픈소스가 아닌 것도 이 목록에 있다")
      .not.toMatch(/아래 오픈소스 부품이 포함/);
  });

  it("★ 만들어졌다면 smartmd 동봉물이 그 안에 있다", () => {
    if (!fs.existsSync(고지)) return;
    const s = fs.readFileSync(고지, "utf8");
    const 목록 = 표읽기(원문());
    const 빠진것 = 목록.filter((c) => !s.includes(c.이름));
    expect(빠진것.map((c) => c.이름), "부품표에 있는데 고지에 없다 — 생성기가 못 읽고 있다").toEqual([]);
  });
});
