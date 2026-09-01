// 「SBOM 대상인가」 잣대가 서버와 화면 **전부**에서 같은가 (2026-09-01 · 세 라운드에 걸쳐 고쳤다)
//
// ★★ 세 번 내리 같은 병을 앓았다
//   1차: 서버만 고치고 화면을 안 고쳤다(대화창 12 vs 화면 4,812)
//   2차: 화면 KPI 두 칸만 고치고 **같은 화면의 필터·드롭다운·일괄생성**을 안 고쳤다
//        → 「같은 물음에 두 숫자」를 화면 **안으로** 옮겼을 뿐이다
//   3차: 네 번째 자리(프로 셸 현황 카드 grouppanels.js)가 통째로 남아 있었다
//
//   ⚠⚠ 그리고 **이 시험 자신이 거짓 초록이었다** — 화면 목록을 손으로 두 개만 적어 두었고,
//     금지 패턴이 `filter((a) => !a.sbomGeneratedAt).length`라는 **철자 하나**뿐이라
//     `return !a.sbomGeneratedAt;` 꼴은 통과했다. 주석에 낱말만 있어도 통과했다.
//
//   → 이제 **자리를 손으로 적지 않는다.** pages/ 아래를 훑어 `sbomGeneratedAt`을
//     **인구를 세거나 거르는 데** 쓰는 자리를 전부 찾고, 공용 잣대를 지나는지 본다.
//     새 화면이 생겨도 자동으로 걸린다.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const 서버 = readFileSync(join(__dirname, "..", "src", "engine", "assetcoverage.ts"), "utf8");
const 화면뿌리 = join(__dirname, "..", "..", "client", "src", "renderer", "pages");
const 화면규칙 = readFileSync(join(화면뿌리, "assetrules.js"), "utf8");

/** 주석을 걷어낸다 — **주석 속 낱말로 통과하면 그게 거짓 초록이다.** */
function 주석빼기(원문: string): string {
  return 원문
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function 화면파일들(): string[] {
  return readdirSync(화면뿌리)
    .filter((f) => (f.endsWith(".html") || f.endsWith(".js")) && f !== "assetrules.js")
    .map((f) => join(화면뿌리, f));
}
const 이름만 = (p: string) => p.split(/[\\/]/).pop() as string;

describe("서버와 화면이 같은 잣대를 쓴다", () => {
  const 화면코드 = 주석빼기(화면규칙);

  it("★ 서버가 거르는 것을 화면 잣대도 거른다 (주석 말고 **코드**에서)", () => {
    expect(서버, "서버 규칙이 바뀌었다 — 이 시험이 낡았다").toContain('a.id.startsWith("vuln:")');
    expect(화면코드, "화면 **코드**가 스캐너 IP 호스트를 안 거른다").toContain("vuln:");
    const m = 서버.match(/NON_SOFTWARE_TYPES\s*=\s*new Set\(\[([^\]]*)\]/);
    expect(m, "NON_SOFTWARE_TYPES를 못 찾았다 — 이 시험이 낡았다").not.toBeNull();
    const 유형들 = [...(m as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(유형들.length).toBeGreaterThan(0);
    for (const t of 유형들) {
      expect(화면코드, `서버는 "${t}"를 빼는데 화면 코드는 안 뺀다 — 두 수가 갈린다`).toContain(t);
    }
  });

  it("★★ 서버가 유형을 **줄여도** 걸린다 — 한 방향만 보면 반쪽이다", () => {
    const m = 서버.match(/NON_SOFTWARE_TYPES\s*=\s*new Set\(\[([^\]]*)\]/);
    const 서버유형 = new Set([...(m as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    const 화면유형 = [...화면코드.matchAll(/assetType\s*!==?\s*"([^"]+)"/g)].map((x) => x[1]);
    expect(화면유형.length, "화면이 유형을 안 본다 — 시험 전제가 낡았다").toBeGreaterThan(0);
    for (const t of 화면유형) {
      expect(서버유형.has(t), `화면은 "${t}"를 빼는데 서버는 안 뺀다 — 화면이 더 적게 센다`).toBe(true);
    }
  });

  it("★ 「생성」과 「미생성」이 **같은 모수**다 — 합이 대상 수와 맞는다", () => {
    const win: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function("window", 화면규칙)(win);
    const 대상 = win.gijoSbomApplies as (a: unknown) => boolean;
    expect(대상({ id: "vuln:192.168.0.1", assetType: "server" })).toBe(false);
    expect(대상({ id: "fw-01", assetType: "infra-host" })).toBe(false);
    expect(대상({ id: "app-01", assetType: "LLM 서비스" })).toBe(true);
    expect(대상(null), "빈 값에 죽는다").toBe(false);

    const 자산 = [
      { id: "vuln:1", assetType: "server" },
      { id: "fw", assetType: "infra-host" },
      { id: "app-01", assetType: "LLM 서비스" },
      { id: "app-02", assetType: "LLM 서비스", sbomGeneratedAt: 1 },
    ];
    const 미 = (win.gijoSbomMissingCount as (a: unknown[]) => number)(자산);
    const 생 = (win.gijoSbomGeneratedCount as (a: unknown[]) => number)(자산);
    const 대상수 = (win.gijoSbomTargets as (a: unknown[]) => unknown[])(자산).length;
    expect(미).toBe(1);
    expect(생).toBe(1);
    expect(미 + 생, "나란히 놓이는 두 수의 합이 대상 수와 안 맞는다 — 「나머지는 어디 갔나」가 된다").toBe(대상수);
  });
});

describe("★★ 화면 어디에서도 각자 세지 않는다 (자리를 손으로 적지 않는다)", () => {
  it("sbomGeneratedAt으로 **인구를 세거나 거르는** 자리가 전부 공용 잣대를 지난다", () => {
    // 인구를 다루는 꼴만 본다. 한 줄 표시(a.sbomGeneratedAt ? "완료" : "…")는 잣대가 필요 없다.
    const 위반: string[] = [];
    for (const p of 화면파일들()) {
      const 코드 = 주석빼기(readFileSync(p, "utf8"));
      코드.split("\n").forEach((줄, i) => {
        if (!줄.includes("sbomGeneratedAt")) return;
        if (/gijoSbom(Applies|Targets|Missing|Generated)/.test(줄)) return; // 공용 잣대를 지났다
        const 인구꼴 =
          /\.filter\([^\n]*sbomGeneratedAt/.test(줄) ||
          /return\s+!?\s*[a-z]\.sbomGeneratedAt\s*;/.test(줄) ||
          /(activeFilter|k)\s*===\s*"(nosbom|missing|generated)"[^\n]*sbomGeneratedAt/.test(줄);
        if (인구꼴) 위반.push(`${이름만(p)}:${i + 1}  ${줄.trim().slice(0, 90)}`);
      });
    }
    expect(위반, `공용 잣대를 안 지나고 스스로 세는 자리:\n  ${위반.join("\n  ")}`).toEqual([]);
  });

  it("★ 공용 잣대를 쓰는 화면은 assetrules.js를 **읽어 들인다** — 안 읽으면 런타임에 죽는다", () => {
    const 빠진: string[] = [];
    for (const p of 화면파일들()) {
      if (!p.endsWith(".html")) continue;
      const src = readFileSync(p, "utf8");
      if (!/gijoSbom(Applies|Targets|Missing|Generated)/.test(주석빼기(src))) continue;
      if (!src.includes("assetrules.js")) 빠진.push(이름만(p));
    }
    expect(빠진, `공용 잣대를 쓰는데 assetrules.js를 안 읽는 화면: ${빠진.join(", ")}`).toEqual([]);
  });

  it("★★ 공용 잣대를 쓰는 **부품**을 싣는 화면도 그 잣대를 읽는다", () => {
    // grouppanels.js처럼 여러 화면에 실리는 부품은, 그 화면 전부가 assetrules.js를 읽어야 한다.
    // 하나라도 빠지면 그 화면에서만 조용히 undefined가 되어 카드가 죽거나 옛 수를 말한다.
    const 부품들 = 화면파일들().filter(
      (p) => p.endsWith(".js") && /gijoSbom(Applies|Targets|Missing|Generated)/.test(주석빼기(readFileSync(p, "utf8"))),
    );
    expect(부품들.length, "공용 잣대를 쓰는 부품이 없다 — 시험 전제가 낡았다").toBeGreaterThan(0);
    const 빠진: string[] = [];
    for (const 부품 of 부품들) {
      const 부품이름 = 이름만(부품);
      for (const p of 화면파일들()) {
        if (!p.endsWith(".html")) continue;
        const src = readFileSync(p, "utf8");
        if (src.includes(`src="${부품이름}"`) && !src.includes("assetrules.js")) {
          빠진.push(`${이름만(p)} — ${부품이름}을 싣는데 assetrules.js는 안 읽는다`);
        }
      }
    }
    expect(빠진, `부품이 쓰는 잣대가 없는 화면:\n  ${빠진.join("\n  ")}`).toEqual([]);
  });
});
