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

/**
 * 그 화면이 이 파일을 **실제로 싣는가** — 주석에 이름만 적힌 것은 안 친다.
 *
 * ⚠⚠ 이 저장소가 두 번 밟은 함정이다. clientglobals.test.ts가 「「있다고 적힌 것」이 아니라
 *   **「실제로 싣는 태그」**를 봐야 한다」고 명문화해 뒀는데(lite-app.html이 주석 속
 *   「lite-nav.js」로 통과한 사고), 이 시험을 처음 쓸 때 또 `src.includes(…)`로 적었다.
 *   같은 파일 안에서 부품 이름은 태그꼴로 보면서 assetrules만 원문 문자열이라 비대칭이기도 했다.
 */
function 실제로싣나(원문: string, 파일: string): boolean {
  const 코드 = 원문.replace(/<!--[\s\S]*?-->/g, ""); // HTML 주석을 먼저 걷어낸다
  const 이스케이프 = 파일.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<script[^>]*\\ssrc\\s*=\\s*[\"'][^\"']*${이스케이프}[\"']`, "i").test(코드);
}

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
  // ★★ **기본 거부 + 이유 있는 예외**로 뒤집었다 (2026-09-01 4차 검토 [상]).
  //
  //   3차에서 「인구를 세는 꼴」을 정규식 셋으로 맞히려 했는데 **그물에 구멍이 뚫렸다** —
  //   `list.sort((a,b) => (a.sbomGeneratedAt ? 1 : 0) - ...)`와 `list.map(...)` 꼴이
  //   그냥 통과했고, 그 자리가 바로 프로 셸 SBOM 판 목록이었다(카드 12 vs 목록 4,888).
  //   **세는 꼴은 무한하다** — 맞히려 들면 진다.
  //
  //   → 뒤집는다: `sbomGeneratedAt`을 만지는 **모든 줄이 기본 거부**이고,
  //     ① 같은 줄에서 공용 잣대를 지나거나
  //     ② 아래 예외 목록에 **이유와 함께** 적혀 있어야 통과한다.
  //   예외는 「한 줄을 표시만 하는 자리」(배지·날짜·칸 내용)뿐이다 — 인구를 만들지 않는다.
  //   ⚠ 예외를 **줄 번호가 아니라 코드 조각**으로 적는다. 그 줄이 바뀌면 예외가 안 맞아
  //     시험이 깨지고, 사람이 다시 들여다보게 된다.
  const 표시전용예외: { 조각: string; 왜: string }[] = [
    { 조각: 'sbomCell: a.sbomGeneratedAt ?', 왜: "자산 목록의 한 칸 — 그 행 하나의 상태만 그린다" },
    { 조각: "relativeTime(a.lastScannedAt), a.sbomGeneratedAt", 왜: "CSV 내보내기의 한 칸" },
    { 조각: "if (!asset.sbomGeneratedAt) {", 왜: "자산 하나를 골랐을 때의 안내 — 인구가 아니다" },
    { 조각: "const statusCell = a.sbomGeneratedAt", 왜: "표의 한 칸(생성됨/미생성 배지)" },
    { 조각: "const actionCell = a.sbomGeneratedAt", 왜: "표의 한 칸(내려받기/생성 단추)" },
    { 조각: "a.sbomGeneratedAt ? '<span class=\"badge b-blue\">CycloneDX", 왜: "표의 한 칸(형식 배지)" },
    { 조각: "${fmtDate(a.sbomGeneratedAt)}", 왜: "표의 한 칸(생성 날짜)" },
    { 조각: "full && full.sbomGeneratedAt", 왜: "AI 자산 칩 하나의 표시" },
    { 조각: "a.sbomGeneratedAt ? 1 : 0", 왜: "정렬 기준 — 위에서 gijoSbomTargets로 모수를 이미 좁혔다" },
    { 조각: 'a.sbomGeneratedAt ? "생성됨" : "미생성"', 왜: "판 목록의 한 칸 — 모수는 위에서 좁혔다" },
    { 조각: 'activeFilter === "generated" && !a.sbomGeneratedAt', 왜: "모수는 같은 함수 위에서 gijoSbomApplies로 이미 좁혔다 — 여기선 상태만 본다" },
    { 조각: 'activeFilter === "missing" && a.sbomGeneratedAt', 왜: "모수는 같은 함수 위에서 gijoSbomApplies로 이미 좁혔다 — 여기선 상태만 본다" },
  ];

  it("★★ sbomGeneratedAt을 만지는 줄은 **공용 잣대를 지나거나 이유 있는 예외**여야 한다", () => {
    const 걸린: string[] = [];
    const 쓰인예외 = new Set<string>();
    for (const p of 화면파일들()) {
      const 코드 = 주석빼기(readFileSync(p, "utf8"));
      코드.split("\n").forEach((줄, i) => {
        if (!줄.includes("sbomGeneratedAt")) return;
        if (/gijoSbom(Applies|Targets|Missing|Generated)/.test(줄)) return; // ① 잣대를 지났다
        const 예외 = 표시전용예외.find((x) => 줄.includes(x.조각));
        if (예외) { 쓰인예외.add(예외.조각); return; }                      // ② 이유 있는 예외
        걸린.push(`${이름만(p)}:${i + 1}  ${줄.trim().slice(0, 100)}`);
      });
    }
    expect(
      걸린,
      `공용 잣대를 안 지나고 예외 목록에도 없는 자리 — 인구를 세는 자리면 잣대를 지나게 하고,\n` +
        `표시만 하는 자리면 **왜 그런지 적어** 예외에 넣어라:\n  ${걸린.join("\n  ")}`,
    ).toEqual([]);

    // ⚠ **낡은 예외도 걸린다.** 코드가 바뀌어 예외가 안 쓰이면 그 예외는 뜻을 잃은 것이다 —
    //   남겨 두면 다음에 같은 조각이 다시 나타났을 때 검사 없이 통과한다.
    const 안쓰인 = 표시전용예외.filter((x) => !쓰인예외.has(x.조각)).map((x) => x.조각);
    expect(안쓰인, `이제 없는 코드에 예외가 남아 있다 — 지워라:\n  ${안쓰인.join("\n  ")}`).toEqual([]);
  });

  it("★ 공용 잣대를 쓰는 화면은 assetrules.js를 **읽어 들인다** — 안 읽으면 런타임에 죽는다", () => {
    const 빠진: string[] = [];
    for (const p of 화면파일들()) {
      if (!p.endsWith(".html")) continue;
      const src = readFileSync(p, "utf8");
      if (!/gijoSbom(Applies|Targets|Missing|Generated)/.test(주석빼기(src))) continue;
      // ⚠ **주석의 낱말이 아니라 실제 태그**를 본다. 이 저장소는 같은 함정을 두 번 밟았고
      //   clientglobals.test.ts가 「「있다고 적힌 것」이 아니라 「실제로 싣는 태그」를 봐야
      //   한다」고 못 박아 뒀다(lite-app.html이 주석의 「lite-nav.js」로 통과한 사고).
      if (!실제로싣나(src, "assetrules.js")) 빠진.push(이름만(p));
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
        if (실제로싣나(src, 부품이름) && !실제로싣나(src, "assetrules.js")) {
          빠진.push(`${이름만(p)} — ${부품이름}을 싣는데 assetrules.js는 안 읽는다`);
        }
      }
    }
    expect(빠진, `부품이 쓰는 잣대가 없는 화면:\n  ${빠진.join("\n  ")}`).toEqual([]);
  });
});

describe("★★ 잣대가 **쓰이기 전에** 읽힌다 (폴백을 없앴으므로 순서가 급소다)", () => {
  it("assetrules.js가 그것을 쓰는 코드보다 **먼저** 실린다", () => {
    // ⚠ 왜 시험까지 두나(2026-09-01 4차 준비): 조용한 폴백을 없애서 이제 잣대가 없으면
    //   화면이 **TypeError로 죽는다.** 옛날엔 폴백이 조용히 옛 값을 냈다 — 죽는 편이 낫지만,
    //   그러려면 순서가 확실해야 한다. sbom.html은 실제로 `<script src>`가 최상위 init()
    //   **뒤에** 있었고, refresh()의 첫 await 덕에 **우연히** 돌고 있었다.
    const 어긋남: string[] = [];
    for (const p of 화면파일들()) {
      if (!p.endsWith(".html")) continue;
      const src = readFileSync(p, "utf8");
      if (!실제로싣나(src, "assetrules.js")) continue;
      const 줄 = src.split("\n");
      const 실림 = 줄.findIndex((l) => /<script[^>]*src\s*=\s*["'][^"']*assetrules\.js/.test(l));
      // ⚠ 태그가 있다는데 줄을 못 찾으면 **검사가 헛도는 것**이다 — 조용히 넘기지 않는다.
      expect(실림, `${이름만(p)}: assetrules.js 태그 줄을 못 찾았다 — 이 검사가 헛돈다`).toBeGreaterThanOrEqual(0);
      const 첫쓰임 = 줄.findIndex((l) => /gijoSbom(Applies|Targets|Missing|Generated)/.test(l));
      if (첫쓰임 >= 0 && 실림 > 첫쓰임) {
        어긋남.push(`${이름만(p)}: assetrules.js는 ${실림 + 1}줄인데 첫 쓰임이 ${첫쓰임 + 1}줄`);
      }
    }
    expect(어긋남, `잣대를 쓰는 코드가 먼저 온다 — 그 화면은 죽는다:\n  ${어긋남.join("\n  ")}`).toEqual([]);
  });

  it("★ 부품(grouppanels.js)보다도 먼저 실린다", () => {
    const 어긋남: string[] = [];
    for (const p of 화면파일들()) {
      if (!p.endsWith(".html")) continue;
      const 줄 = readFileSync(p, "utf8").split("\n");
      const a = 줄.findIndex((l) => /<script[^>]*src\s*=\s*["'][^"']*assetrules\.js/.test(l));
      const g = 줄.findIndex((l) => /<script[^>]*src\s*=\s*["'][^"']*grouppanels\.js/.test(l));
      if (a >= 0 && g >= 0 && a > g) 어긋남.push(`${이름만(p)}: assetrules ${a + 1}줄 > grouppanels ${g + 1}줄`);
    }
    expect(어긋남, `부품이 먼저 실려 잣대를 못 찾는다:\n  ${어긋남.join("\n  ")}`).toEqual([]);
  });
});
