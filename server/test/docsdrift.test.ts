// 문서 동기화 재고 도구(tools/docs-drift.mjs)의 **거짓 경보 회귀 시험**. (계획서: 중-7 운영 게이트)
//
// ■ 무슨 일이 있었나 (2026-09-04 실사고)
//   배포 실행자가 이 도구를 **WSL 안에서** 돌렸더니 「30건 어긋남 · 문서 0건 인입 ·
//   ✗ 문서가 어긋나 있습니다」가 나왔다. 전부 거짓이었다 — win에서 다시 돌리니 30/30 초록.
//   이 도구는 운영 값을 `execFileSync("wsl", …)`로 읽는 **win 호스트 전용**인데,
//   WSL 안에는 wsl 명령이 없어 catch가 **빈 문자열**을 돌려주었고
//     · GIJO_DOCS_DIR 조회가 조용히 기본값으로 폴백(실제 운영 폴더와 다른 곳을 쟀다)
//     · 지식 저장소 조회도 빈 문자열 → 「0건 인입」
//   이 됐다. **같은 폴백은 반대 방향으로도 터진다** — 진짜 어긋남을 초록으로 덮을 수 있고,
//   그때는 아무도 눈치채지 못한다. 그래서 이제 「모르겠으면 멈춘다(exit 2)」로 바꿨고,
//   여기서 그 성질을 지킨다.
//
// ⚠ 이 시험은 **WSL이 없어도 돌아야 한다** — 순수 함수와 종료 코드만 본다.
//   (도구 본체는 진입점 가드 뒤에 있어 import해도 실행되지 않는다.)
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { 사본거르기, 제외요약 } from "../../tools/docs-drift.mjs";

const 뿌리 = path.resolve(__dirname, "..", "..");
const 도구 = path.join(뿌리, "tools", "docs-drift.mjs");
const 소스 = fs.readFileSync(도구, "utf8");

/** 도구를 자식 프로세스로 돌린다. wsl 헬퍼는 **없는 명령**으로 갈아끼워 일부러 실패시킨다. */
function 돌리기(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [도구], {
    cwd: 뿌리,
    encoding: "utf8",
    timeout: 10_000, // vitest testTimeout(15s)보다 짧게 — 아이가 멎어도 시험이 먼저 안 죽는다

    env: { ...process.env, DOCS_DRIFT_WSL_CMD: "gijo-없는명령-docs-drift-시험", ...env },
  });
}

describe("docs-drift — 판정 못 하면 멈춘다(빈 값으로 넘어가지 않는다)", () => {
  it("★ 헬퍼가 실패하면 exit 2 · 「win 호스트에서 실행」 안내가 나온다", () => {
    const r = 돌리기();
    const 말 = `${r.stdout ?? ""}${r.stderr ?? ""}`;

    // 1(어긋남)도 0(초록)도 아니어야 한다 — 둘 다 「쟀다」는 뜻이고, 이때는 재지 못했다.
    expect(r.status, `종료 코드가 2가 아니다 — 판정 못 한 것을 판정한 척했다.\n${말}`).toBe(2);
    expect(말).toContain("win 호스트에서 실행");

    // ⚠ **판정문을 한 줄도 내지 않아야 한다.** 거짓 경보의 얼굴은 「그럴듯한 보고서」다 —
    //   재지 못했으면서 「어긋남 30건 · 0건 인입」을 찍는 것이 2026-09-04에 벌어진 일이다.
    //   (안내문은 stderr다. 여기서는 **보고서가 나가는 stdout**만 본다 — 안내문 자체가
    //    그 사고를 인용하고 있어 두 흐름을 합쳐 재면 시험이 제 안내문에 걸린다.)
    const 보고서 = r.stdout ?? "";
    expect(보고서).not.toContain("운영이 읽는 문서 폴더");
    expect(보고서).not.toContain("리포지토리 ↔ 운영 문서 폴더");
    expect(보고서).not.toContain("인입됨");
    expect(보고서.trim()).toBe("");
  });

  it("★ win이 아닌 곳(WSL·gb10)에서는 wsl을 부르기도 전에 멈춘다", () => {
    const r = 돌리기();
    const 말 = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status).toBe(2);
    if (process.platform !== "win32") {
      // 플랫폼 관문이 먼저 걸렸다는 증거 — 헬퍼 실패 안내가 아니라 플랫폼 안내가 나와야 한다.
      expect(말).toContain(`지금 플랫폼: ${process.platform}`);
      expect(말).toContain("거짓 경보");
    }
  });

  it("플랫폼 관문이 **첫 wsl 호출보다 앞**에 있다(소스 감시)", () => {
    // 순서가 뒤집히면 WSL 안에서 wsl을 한 번 부르고 나서야 멈춘다 — 그 한 번이 사고의 자리였다.
    const 관문 = 소스.indexOf('process.platform !== "win32"');
    const 첫호출 = 소스.indexOf("const docsDir = wsl(");
    expect(관문, "플랫폼 관문이 없다").toBeGreaterThan(0);
    expect(첫호출).toBeGreaterThan(0);
    expect(관문).toBeLessThan(첫호출);
  });

  it("실패를 빈 문자열로 삼키는 catch가 없다 · GIJO_DOCS_DIR 기본값 폴백이 없다(소스 감시)", () => {
    // 옛 코드: `catch { return ""; }` + `|| "/home/gijo/gijo-as/server/docs"`
    expect(/catch\s*(\([^)]*\))?\s*\{\s*return\s*""/.test(소스), "헬퍼가 실패를 빈 문자열로 삼킨다").toBe(false);
    expect(소스.includes('|| "/home/gijo/gijo-as/server/docs"'), "GIJO_DOCS_DIR을 못 읽으면 기본값으로 떨어진다").toBe(false);
    // 「못 읽으면 멈춘다」가 실제로 걸려 있는지 — 조회에 이유를 달아 엄격 모드로 부른다.
    expect(소스).toMatch(/GIJO_DOCS_DIR 읽기/);
  });
});

describe("docs-drift — 시험 사본은 경고에서 빼되 **몇 건 뺐는지 말한다**", () => {
  const 시험사본들 = [
    "/home/gijo/gijo-as-test/server/docs/취약점관리_지침.md",
    "/home/gijo/gijo-as-test/runs/12345-101010/취약점관리_지침.md",
    "/home/gijo/gijo-as/_old-doc-copies-20260808/취약점관리_지침.md",
    // ⚠ 이름이 `gijo-as-test`로 시작하지 않는 시험 사본도 있다(2026-09-04 실측 — 워크트리 샌드박스).
    "/home/gijo/gijo-as-wt-test/취약점관리_지침.md",
  ];
  const 진짜사본 = "/home/gijo/gijo-as/server/docs/취약점관리_지침.md";

  it("★ 시험 사본·옛 보관함은 걸러지고, 진짜 위험한 사본은 남는다", () => {
    const { 남김, 제외 } = 사본거르기([...시험사본들, 진짜사본]);
    expect(남김).toEqual([진짜사본]);
    expect(제외).toHaveLength(4);
  });

  it("★ 뺀 것을 **조용히 빼지 않는다** — 건수와 내역이 한 줄로 나온다", () => {
    const { 제외 } = 사본거르기([...시험사본들, 진짜사본]);
    const 줄 = 제외요약(제외);
    expect(줄).toContain("4건");
    expect(줄).toContain("wsl-test 사본");
    expect(줄).toContain("옛 문서 보관함");
    // 한 줄이어야 한다(줄이 늘면 이번엔 이 안내가 잡음이 된다).
    expect(줄.split("\n")).toHaveLength(1);
  });

  it("뺀 게 없어도 줄은 나온다 — 「안 걸렀다」도 정보다", () => {
    expect(제외요약([])).toContain("0건");
    expect(제외요약(undefined as never)).toContain("0건");
  });

  it("제외 목록은 **상수 하나**다 — 여기저기 흩어 두면 어긋난다(소스 감시)", () => {
    expect((소스.match(/const 사본_제외 = \[/g) ?? []).length).toBe(1);
    // 거르기는 그 상수만 본다 — 함수 안에 또 다른 패턴을 박아 두면 이 시험이 헛돈다.
    expect(소스).toMatch(/사본_제외\.find/);
  });

  it("사본 조회는 거르기 **전에** 넉넉히 받는다(head -3이면 진짜 사본이 잘린다)", () => {
    // 실측: 한 문서에 시험 사본만 3개가 먼저 나온다. head -3이면 진짜 사본은 영영 안 보인다.
    expect(소스).not.toMatch(/find \/home\/gijo[^\n]*head -3/);
    expect(소스).toMatch(/find \/home\/gijo[^\n]*head -20/);
  });
});
