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
// @ts-expect-error — .mjs 도구 모듈(타입 선언 없음). 게시가 쓰는 **그 파서**를 그대로 부른다.
import { 표읽기 } from "../../tools/lib/vendor-manifest.mjs";

const 저장소 = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SMARTMD = path.join(저장소, "client", "smartmd");
const VEND = path.join(SMARTMD, "vendor", "VERSIONS.md");

/** ★ **우리가 smartmd를 배포에 싣는가.**
 *  ⚠ `client/smartmd/`는 **git이 추적하지 않고**(client/.gitignore) 게시 직전에 외부 저장소에서
 *    받아온다. 그래서 새 클론·max·gb10에는 아예 없다 — 거기서 「빨간불」을 내면
 *    **감시가 사실이 아닌 것을 말하는 것**이고, 사람은 곧 이 시험을 무시하게 된다.
 *  ⚠ 반대로 **폴더는 있는데 원장이 깨진** 경우는 반드시 잡아야 한다 — 그것이 실제 사고였다.
 *    「없다」와 「못 읽는다」를 가르는 것이 이 감시의 전부다.
 *
 *  ★ 2026-08-22 — 판정 기준을 **「폴더가 있나」에서 「빌드가 담나」로** 바꿨다.
 *    그날 Smart MD 창을 없애면서 `client/package.json`·`electron-builder.lite.json`의
 *    `files`에서 `smartmd/**\/*`를 뺐다. 그런데 **개발 기계에는 옛 폴더가 그대로 남아 있어**
 *    폴더만 보면 「싣는 기계」로 읽혔다 — 안 싣는 것을 고지가 있나 없나 따지는 헛감시가 된다.
 *    지금은 **배포 목록에 들어 있을 때만** 잰다. 다시 실으면 이 감시가 저절로 되살아난다. */
/** ⚠ `files`만 보면 안 된다(2026-08-22 재검토 [낮음]) — 설치본에 폴더째 넣는 흔한 방식은
 *  **extraResources/extraFiles**다. 거기로 동봉하면 「안 싣는다」로 잘못 읽혀 고지가 빠진다.
 *  ★ 판정 로직은 게시가 쓰는 `tools/lib/…`가 아니라 여기와 gen-sbom-self 두 곳에 있다 —
 *    **일부러 그렇다**: 이 시험은 「관문이 판정을 제대로 하나」를 재는 쪽이 아니라
 *    「지금 우리가 싣나」를 스스로 판단해 검사할지 말지를 정한다. 어긋나면 아래 시험이 헛돌므로
 *    같은 넓이로 맞춰 둔다(넓히면 양쪽 다 넓힌다). */
function 배포에담나(): boolean {
  for (const 설정 of ["package.json", "electron-builder.lite.json"]) {
    const p = path.join(저장소, "client", 설정);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    const b = (j.build ?? j) as Record<string, unknown>;
    const 플랫 = (k: string) => (b[k] as unknown[]) ?? [];
    const 하위 = (os: string, k: string) => ((b[os] as Record<string, unknown> | undefined)?.[k] as unknown[]) ?? [];
    const 전부 = [
      ...플랫("files"), ...플랫("extraResources"), ...플랫("extraFiles"),
      ...하위("win", "extraResources"), ...하위("win", "extraFiles"),
      ...하위("mac", "extraResources"), ...하위("mac", "extraFiles"),
      ...하위("linux", "extraResources"), ...하위("linux", "extraFiles"),
    ];
    if (전부.some((e) => JSON.stringify(e).includes("smartmd"))) return true;
  }
  return false;
}
const 싣는기계 = 배포에담나() && fs.existsSync(SMARTMD);
const 실을때만 = 싣는기계 ? describe : describe.skip;

/** VERSIONS.md 원문. */
function 원문(): string {
  return fs.readFileSync(VEND, "utf8");
}

/** ★ **게시가 실제로 쓰는 그 파서를 부른다** — 사본을 두지 않는다(2026-08-22 검토관 [중]).
 *  처음엔 이 파일 안에 같은 로직을 손으로 옮겨 적었는데, 그러면 시험이 **자기 사본**만 재고
 *  정작 게시에 물린 파서가 깨져도 초록이었다. 이 저장소가 반복해 겪은
 *  「같은 것을 여러 곳에 적으면 어긋난다」가 감시 층에서 재현된 꼴이라 파서를 한 곳으로 뺐다. */
function 목록읽기() {
  return 표읽기(원문());
}

실을때만("동봉 vendor 고지 — 조용히 0이 되지 않는다", () => {
  it("VERSIONS.md 가 있다 — 없으면 무엇을 싣는지 아무도 모른다", () => {
    expect(fs.existsSync(VEND), `${VEND} 가 없다`).toBe(true);
  });

  it("★★ 표에서 부품을 **하나 이상** 읽는다 (0이면 고지에서 통째로 빠진다)", () => {
    const 목록 = 목록읽기();
    expect(목록.length, "형식이 바뀌어 못 읽고 있다 — 표 머리글에 Library/Version/License 칸이 있어야 한다")
      .toBeGreaterThan(0);
  });

  it("★ 읽은 것마다 라이선스가 **판정된다** — 「판정불가」면 고지에 뭘 적을지 모른다는 뜻", () => {
    const 목록 = 목록읽기();
    const 못푼것 = 목록.filter((c) => 등급판정(c.라이선스).등급 === "판정불가");
    expect(못푼것.map((c) => `${c.이름} — ${c.라이선스}`), "판정기가 못 읽는 표기다")
      .toEqual([]);
  });

  it("★★ 동봉물 중 **상용으로 못 쓰는 것**이 없다", () => {
    // 이 저장소가 2026-08-22에 실제로 배포하다 걸린 그 조건(CC BY-NC-ND)이다.
    const 목록 = 목록읽기();
    const 걸린것 = 목록.filter((c) => 상용사용금지(c.라이선스));
    expect(걸린것.map((c) => `${c.이름} — ${c.라이선스}`),
      "비영리·변경금지 조건은 소스를 공개해도 안 풀린다 — 빼거나 허락을 받아야 한다").toEqual([]);
  });

  it("★ 고지가 의무인 것들이 실제로 목록에 있다 — 글꼴·아이콘을 빠뜨리기 쉽다", () => {
    // 코드(MIT)는 눈에 띄는데 **글꼴과 아이콘**은 라이선스가 따로인 것을 자주 잊는다.
    // 우리가 빠뜨린 것이 정확히 이 둘이었다.
    const 전부 = 목록읽기().map((c) => c.라이선스).join(" | ");
    if (/font\s*awesome/i.test(원문())) {
      expect(전부, "Font Awesome을 싣는데 아이콘 라이선스(CC-BY)가 표에 없다").toMatch(/CC[\s-]?BY/i);
      expect(전부, "Font Awesome을 싣는데 글꼴 라이선스(OFL)가 표에 없다").toMatch(/OFL/i);
    }
  });
});

const 고지 = path.join(저장소, "THIRD-PARTY-NOTICES.md");
// ⚠ **조용한 `return`을 쓰지 않는다**(2026-08-22 검토관 [낮음]). vitest에서 조기 return은
//   skip이 아니라 **pass로 집계**된다 — 아무것도 검사하지 않고 초록이 뜬다.
//   이 파일이 막으려는 사고가 「조용히 아무 일도 안 하는 것」이라 그 모양을 여기 두면 안 된다.
//   `skipIf`는 「건너뜀」으로 표시되므로 사람이 **검사되지 않았음을 본다.**
const 고지있을때만 = it.skipIf(!fs.existsSync(고지));

실을때만("고지 목록 파일 — 만들어졌다면 정직한가 (빌드 산출물이라 없으면 건너뜀)", () => {
  고지있을때만("「오픈소스 부품」이라고 뭉뚱그리지 않는다 — 오픈소스 아닌 동봉물도 있다", () => {
    const s = fs.readFileSync(고지, "utf8").slice(0, 1200);
    expect(s, "마이크로소프트 재배포 런타임처럼 오픈소스가 아닌 것도 이 목록에 있다")
      .not.toMatch(/아래 오픈소스 부품이 포함/);
  });

  고지있을때만("★ 만들어졌다면 smartmd 동봉물이 그 안에 있다", () => {
    const s = fs.readFileSync(고지, "utf8");
    const 목록 = 목록읽기();
    const 빠진것 = 목록.filter((c) => !s.includes(c.이름));
    expect(빠진것.map((c) => c.이름), "부품표에 있는데 고지에 없다 — 생성기가 못 읽고 있다").toEqual([]);
  });
});

describe("게시 관문 배선 — 판정 함수를 부르고 **막는지**", () => {
  // ⚠ 검토관 [낮음]: 판정 함수 시험만 있고 **관문이 그것을 불러 exit(1)하는 배선**은
  //   아무도 안 봤다. 관문 분기를 통째로 지워도 전 시험이 초록이었다.
  //   이 저장소의 처방은 「세 번째면 소스 감시」다 — 배선은 소스로 못 박는다.
  const 관문 = fs.readFileSync(path.join(저장소, "tools", "gen-sbom-self.mjs"), "utf8");

  it("★ 상용 못 쓰는 부품이 있으면 게시를 **막는다**", () => {
    expect(관문, "상용사용금지()를 불러야 한다").toMatch(/상용사용금지\s*\(/);
    expect(관문, "그 결과가 종료코드로 이어져야 한다 — 경고만으로는 게시가 그대로 나간다")
      .toMatch(/상용불가[\s\S]{0,400}?process\.exit\(1\)/);
  });

  it("★★ 동봉 원장을 **못 읽어도** 막는다 — 이 사고의 본체가 「조용한 0」이었다", () => {
    expect(관문, "원장 고장이 종료코드로 이어져야 한다")
      .toMatch(/동봉원장고장[\s\S]{0,400}?process\.exit\(1\)/);
  });

  it("★ 판정 규칙을 관문이 **복사해 두지 않았다** — 잣대는 licenserisk 한 곳", () => {
    expect(관문, "관문이 licenserisk를 불러 써야 한다").toMatch(/licenserisk/);
    expect(관문, "관문에 등급 규칙표가 복사돼 있으면 반드시 하나가 낡는다")
      .not.toMatch(/서비스도공개.*=.*\/\^AGPL/);
  });

  it("★ 파서가 한 곳이다 — 시험과 관문이 같은 것을 부른다", () => {
    expect(관문, "관문도 공용 파서를 써야 한다").toMatch(/vendor-manifest\.mjs/);
  });
});

// ★★ **일부러 둔 두 벌이 어긋나지 않는가** (2026-08-22 2라운드 검토관 [낮음])
//
// ■ `배포에담나()`는 여기와 `tools/gen-sbom-self.mjs`(smartmd배포에담나) **두 곳**에 있다.
//   일부러 그렇다 — 관문은 「고지에 적을까」를, 시험은 「검사할까」를 정하므로 쓰임이 다르다.
//   ⚠ 하지만 **넓이가 어긋나면** 한쪽은 「싣는다」, 다른 쪽은 「안 싣는다」로 갈려서
//     시험은 전부 skip인데 관문은 고지를 적거나, 그 반대가 된다 — 둘 다 조용한 실패다.
//   ■ 그래서 **같은 자리를 보는지**를 소스로 못박는다. 새 자리를 넓히면 양쪽 다 넓히게 된다.
describe("★ 동봉 판정 두 벌이 같은 넓이를 본다", () => {
  const 관문 = fs.readFileSync(path.join(저장소, "tools", "gen-sbom-self.mjs"), "utf8");
  const 나 = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");

  it("★★ 양쪽 다 files·extraResources·extraFiles를 본다", () => {
    for (const [이름, src] of [["관문(gen-sbom-self)", 관문], ["시험(vendornotice)", 나]] as [string, string][]) {
      for (const 자리 of ["files", "extraResources", "extraFiles"]) {
        expect(src, `${이름}이 ${자리}를 안 본다 — 그 갈래로 동봉하면 고지가 빠진다`)
          .toContain(자리);
      }
      // win/mac 하위 블록도 — 라이트가 실제로 거기 쓴다.
      expect(src, `${이름}이 win/mac 하위 extraResources를 안 본다`).toMatch(/win|mac/);
    }
  });

  it("★ 두 설정 파일을 **둘 다** 본다 — 한쪽만 보면 라이트/스탠다드가 갈린다", () => {
    for (const [이름, src] of [["관문", 관문], ["시험", 나]] as [string, string][]) {
      expect(src, `${이름}이 package.json을 안 본다`).toContain("package.json");
      expect(src, `${이름}이 electron-builder.lite.json을 안 본다`).toContain("electron-builder.lite.json");
    }
  });
});
